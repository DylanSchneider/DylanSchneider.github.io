/* Local-only browser verification. Config and RPC requests are isolated from
   the live party; no test attendees or writes reach Supabase. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.tmp', 'tunnel-tests');
fs.mkdirSync(artifacts, { recursive: true });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('window.PARTY_CONFIG={PARTY_ID:"tunnel-test",PARTY_YEAR:"2026",FALLBACK_CLOSES_AT:"2030-10-31T23:00:00Z"};'); return; }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(data); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await context.route('**/*.supabase.co/**', route => route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('BROWSER', msg.text()); });
    await page.goto(base + '/?debugTunnel=1');
    await page.waitForFunction(() => window.tunnelDebug, null, { timeout: 25000 });
    console.log('INITIAL', await page.evaluate(() => ({ mode: tunnelDebug.state.mode, quality: tunnelDebug.quality, length: tunnelDebug.path.position.getLength(), calls: tunnelDebug.renderer.info.render.calls, triangles: tunnelDebug.renderer.info.render.triangles })));
    const checkpoints = [0, .18, .32, .43, .47, .61, .75, .86, .915];
    for (const p of checkpoints) {
      await page.evaluate(p => scrollTo(0, p / .92 * 7500), p);
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(artifacts, `scene-${p}.png`) });
      console.log('SHOT', p, await page.evaluate(() => ({ p: tunnelDebug.state.progress, calls: tunnelDebug.renderer.info.render.calls, triangles: tunnelDebug.renderer.info.render.triangles, fps: tunnelDebug.fps })));
    }
    // Reverse to the same physical pose; animation is derived from progress.
    await page.evaluate(() => scrollTo(0, 3000)); await page.waitForTimeout(1000);
    const pose = await page.evaluate(() => ({ p: tunnelDebug.state.progress, xyz: tunnelDebug.camera.position.toArray(), q: tunnelDebug.camera.quaternion.toArray() }));
    await page.evaluate(() => scrollTo(0, 4500)); await page.waitForTimeout(600);
    await page.evaluate(() => scrollTo(0, 3000)); await page.waitForTimeout(1000);
    const reverse = await page.evaluate(() => ({ p: tunnelDebug.state.progress, xyz: tunnelDebug.camera.position.toArray(), q: tunnelDebug.camera.quaternion.toArray() }));
    assert(Math.abs(pose.p - reverse.p) < .0001, 'reverse progress matches');
    assert(pose.xyz.every((n, i) => Math.abs(n - reverse.xyz[i]) < .01), 'reverse camera matches');
    for (const [width, height] of [[320, 568], [375, 812], [390, 844], [430, 932]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      await page.click('#tunnel-return');
      await page.screenshot({ path: path.join(artifacts, `invitation-${width}.png`) });
      assert(await page.locator('#in-name').isVisible());
      await page.click('.tunnel-close');
    }
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(300);
    assert(await page.evaluate(() => Math.abs(tunnelDebug.camera.aspect - innerWidth / innerHeight) < .00001), 'orientation updates camera');
    await page.setViewportSize({ width: 390, height: 844 });
    // Fast scroll stops at the deterministic handoff and requests check-in.
    await page.evaluate(() => scrollTo(0, 100000));
    await page.waitForFunction(() => document.getElementById('tunnel-invitation').open, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => tunnelDebug.state.progress), .92);
    await page.fill('#in-name', 'Tunnel Tester'); await page.fill('#in-phone', '5551234567');
    await page.evaluate(() => {
      window.proof = { camera: tunnelDebug.camera, canvas: document.getElementById('fall-canvas'), position: tunnelDebug.camera.position.clone(), quaternion: tunnelDebug.camera.quaternion.clone(), activations: [] };
      window.addEventListener('party:view', event => proof.activations.push({ id: event.detail.id, black: getComputedStyle(document.getElementById('tunnel-blackout')).opacity }));
    });
    await page.click('#btn-name');
    await page.waitForFunction(() => tunnelDebug.state.mode === 'complete' && !document.body.classList.contains('rabbit-fall'), null, { timeout: 10000 });
    const handoff = await page.evaluate(() => ({
      count: tunnelDebug.state.handedOff, sameCamera: proof.camera === tunnelDebug.camera, sameCanvas: proof.canvas === document.getElementById('fall-canvas'),
      capturedDistance: proof.position.distanceTo(tunnelDebug.startPose.position), capturedAngle: proof.quaternion.angleTo(tunnelDebug.startPose.quaternion),
      travelled: tunnelDebug.startPose.position.distanceTo(tunnelDebug.camera.position), crossed: tunnelDebug.camera.position.y < tunnelDebug.scene.getObjectByName('LOC_Keyhole').position.y,
      activations: proof.activations, raf: tunnelDebug.raf, frames: tunnelDebug.state.renderedFrames
    }));
    console.log('HANDOFF', handoff);
    assert.equal(handoff.count, 1); assert(handoff.sameCamera && handoff.sameCanvas);
    assert(handoff.capturedDistance < .000001 && handoff.capturedAngle < .000001);
    assert(handoff.crossed && handoff.travelled >= 10);
    assert(handoff.activations.some(e => e.id === 'v-costume' && e.black === '1'));
    assert.equal(handoff.raf, 0);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => tunnelDebug.state.renderedFrames), handoff.frames, 'no scene work after handoff');
    assert(await page.locator('#costume-slot').isVisible());
    await page.screenshot({ path: path.join(artifacts, 'costume.png') });
    // Re-enter without constructing another renderer; then exercise error/retry.
    await page.click('#btn-back'); await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => tunnelDebug.state.mode), 'scroll');
    assert(await page.evaluate(() => tunnelDebug.state.progress < .001));
    await page.evaluate(async () => { const { api } = await import('/assets/js/store.js'); window.realJoin = api.joinParty; window.failedJoins = 0; api.joinParty = async () => { failedJoins++; throw new Error('Simulated test network failure'); }; });
    await page.evaluate(() => scrollTo(0, 100000)); await page.waitForTimeout(1700);
    assert.equal(await page.evaluate(() => failedJoins), 1, 'failed request is not auto-repeated');
    assert(await page.locator('#tunnel-invitation').evaluate(dialog => dialog.open));
    await page.evaluate(async () => { const { api } = await import('/assets/js/store.js'); api.joinParty = realJoin; });
    await page.click('#btn-name');
    await page.waitForFunction(() => tunnelDebug.state.mode === 'complete' && !document.body.classList.contains('rabbit-fall'));
    // Existing stored check-in still skips the opening on a fresh page load.
    await page.reload(); await page.waitForSelector('#v-costume.is-active');
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => tunnelDebug?.raf || 0), 0);
    await page.goto(base + '/?debugTunnel=1&replayTunnel=1');
    await page.waitForFunction(() => window.tunnelDebug && document.getElementById('v-name').classList.contains('is-active'));
    assert.equal(await page.inputValue('#in-name'), 'Tunnel Tester');
    assert(await page.evaluate(() => tunnelDebug.state.progress < .001));
    await context.close();

    for (const scenario of ['reduced', 'webgl', 'cdn', 'nogsap', 'low', 'contextloss']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: scenario === 'reduced' ? 'reduce' : 'no-preference' });
      await ctx.route('**/*.supabase.co/**', route => route.abort());
      if (scenario === 'webgl') await ctx.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); }; });
      if (scenario === 'cdn') await ctx.route('**/three@*/**', route => route.abort());
      if (scenario === 'nogsap') await ctx.route('**/gsap@*/**', route => route.abort());
      const tab = await ctx.newPage(), faults = [];
      tab.on('pageerror', error => faults.push(error.message));
      await tab.goto(base + '/?debugTunnel=1' + (scenario === 'low' ? '&tunnelQuality=low' : ''));
      await tab.waitForSelector('#v-name.is-active');
      if (['nogsap', 'low', 'contextloss'].includes(scenario)) {
        await tab.waitForFunction(() => window.tunnelDebug);
        if (scenario === 'low') assert.equal(await tab.evaluate(() => tunnelDebug.quality), 'LOW');
        await tab.evaluate(() => scrollTo(0, 100000));
        await tab.waitForFunction(() => document.getElementById('tunnel-invitation').open);
      } else {
        await tab.waitForFunction(() => document.body.classList.contains('tunnel-fallback'));
        await tab.click('#tunnel-enter');
      }
      await tab.fill('#in-name', 'Fallback Tester'); await tab.fill('#in-phone', '5559876543');
      await tab.click('#btn-name');
      if (scenario === 'contextloss') await tab.evaluate(() => tunnelDebug.renderer.forceContextLoss());
      await tab.waitForSelector('#v-costume.is-active');
      await tab.waitForFunction(() => !document.body.classList.contains('rabbit-fall'));
      assert.deepEqual(faults, []); console.log('PASS', scenario); await ctx.close();
    }
    for (const scenario of ['loss-failure', 'loss-skip', 'loss-after-black']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.route('**/*.supabase.co/**', route => route.abort());
      const tab = await ctx.newPage(), faults = [];
      tab.on('pageerror', error => faults.push(error.message));
      await tab.goto(base + '/?debugTunnel=1'); await tab.waitForFunction(() => window.tunnelDebug);
      await tab.evaluate(async () => {
        const { api } = await import('/assets/js/store.js'); window.originalJoin = api.joinParty;
        api.joinParty = (...args) => new Promise((resolve, reject) => { window.releaseJoin = () => resolve(originalJoin(...args)); window.rejectJoin = () => reject(new Error('Simulated connection loss')); });
        window.blackAtActivation = null;
        window.addEventListener('party:view', e => { if (e.detail.id === 'v-costume') blackAtActivation = getComputedStyle(document.getElementById('tunnel-blackout')).opacity; });
        scrollTo(0, 100000);
      });
      await tab.waitForFunction(() => document.getElementById('tunnel-invitation').open);
      await tab.fill('#in-name', 'Recovery Tester'); await tab.fill('#in-phone', '5551231234');
      await tab.click(scenario === 'loss-skip' ? '.tunnel-skip' : '#btn-name');
      await tab.waitForFunction(() => window.releaseJoin);
      if (scenario === 'loss-after-black') await tab.waitForFunction(() => tunnelDebug.state.elapsed >= 1.35);
      await tab.evaluate(() => tunnelDebug.renderer.forceContextLoss());
      await tab.waitForFunction(() => document.body.classList.contains('tunnel-fallback'));
      if (scenario === 'loss-failure') {
        await tab.evaluate(() => rejectJoin());
        await tab.waitForFunction(() => document.getElementById('tunnel-invitation').open);
        assert.equal(await tab.locator('#tunnel-hud').evaluate(node => node.inert), false);
        await tab.evaluate(async () => { const { api } = await import('/assets/js/store.js'); api.joinParty = originalJoin; });
        await tab.click('#btn-name');
      } else await tab.evaluate(() => releaseJoin());
      await tab.waitForSelector('#v-costume.is-active');
      await tab.waitForFunction(() => !document.body.classList.contains('rabbit-fall'));
      assert.equal(await tab.evaluate(() => blackAtActivation), '1');
      assert.equal(await tab.locator('#tunnel-invitation').evaluate(node => node.open), false);
      assert.deepEqual(faults, []); console.log('PASS', scenario); await ctx.close();
    }
    assert.deepEqual(errors, []);
    console.log('ARTIFACTS', artifacts);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
