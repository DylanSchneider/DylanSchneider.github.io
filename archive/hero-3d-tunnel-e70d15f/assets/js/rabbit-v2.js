import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { createTunnelWorld } from './tunnel-world.js';

const HANDOFF = .92;
const SCROLL_DISTANCE = 7500;
const CHAPTERS = [[0, 'Entrance'], [.08, 'The crooked hall'], [.2, 'Descent'], [.32, 'House of cards'], [.47, 'Borrowed time'], [.6, 'Impossible doors'], [.72, 'Looking glass'], [.82, 'The shaft'], [.92, 'The fall']];
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const vec = (x, y, z) => new THREE.Vector3(x, y, z);

function sample(stops, p) {
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const [a, x] = stops[i - 1], [b, y] = stops[i];
      return THREE.MathUtils.lerp(x, y, smooth(p, a, b));
    }
  }
  return stops.at(-1)[1];
}

function createCameraPaths() {
  const points = [
    [0, 0, 5], [0, -.2, 0], [0, -1, -5], [-.7, -2, -10], [-1.8, -3.5, -14],
    [-2.5, -5, -18], [-.5, -7, -23], [2.5, -8.5, -27], [.8, -10, -30],
    [-.8, -12, -34], [0, -14, -38], [.7, -17, -42], [-.8, -20, -45],
    [.4, -23, -48], [-.6, -26, -51], [0, -28, -53], [0, -30, -55],
    [0, -35, -58], [0, -43, -60], [0, -50, -60], [0, -64, -60]
  ].map(p => vec(...p));
  const position = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  // Authored attention, separate from the position spline: anticipate the room,
  // glance toward the watch, then look through the doorway before descending.
  const targets = points.map((point, i) => {
    const p = i / (points.length - 1);
    const ahead = position.getPoint(Math.min(1, p + .065));
    if (p >= .94) return point.clone().add(vec(0, -9, 0));
    if (p >= .25 && p <= .4) ahead.x += p < .33 ? 1.1 : -.6;
    if (p >= .43 && p <= .5) { ahead.y += 1.35; ahead.x += .4; }
    if (p >= .7 && p <= .8) ahead.x -= .3;
    return ahead;
  });
  return { position, target: new THREE.CatmullRomCurve3(targets, false, 'centripetal') };
}

export function initTunnel({ fallback, reduced }) {
  const params = new URLSearchParams(location.search);
  const debugEnabled = params.get('debugTunnel') === '1';
  const canvas = document.getElementById('fall-canvas');
  const runway = document.querySelector('.fall-tunnel');
  const view = document.getElementById('v-name');
  const dialog = document.getElementById('tunnel-invitation');
  const hud = document.getElementById('tunnel-hud');
  const overlay = document.getElementById('fall-transition');
  const flash = document.getElementById('tunnel-white-flash');
  const black = document.getElementById('tunnel-blackout');
  const form = document.getElementById('form-name');
  const tiers = { HIGH: { dpr: 1.75 }, MEDIUM: { dpr: 1.5 }, LOW: { dpr: 1 } };
  const requested = params.get('tunnelQuality')?.toUpperCase();
  let quality = tiers[requested] ? requested : (navigator.deviceMemory && navigator.deviceMemory <= 2 ? 'LOW' : matchMedia('(pointer: coarse)').matches ? 'MEDIUM' : 'HIGH');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'LOW', alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050505);
  scene.fog = new THREE.FogExp2(0x070707, .02);
  const camera = new THREE.PerspectiveCamera(42, 1, .05, 160);
  const path = createCameraPaths();
  let world;
  try { world = createTunnelWorld(THREE, scene, path, quality); }
  catch (error) { renderer.dispose(); throw error; }
  const ambient = new THREE.HemisphereLight(0xe7e0d2, 0x080808, .42); scene.add(ambient);
  const travelLight = new THREE.PointLight(0xf4f0e7, 48, 22, 1.5);
  const poolLight = new THREE.PointLight(0xe7e0d2, 65, 19, 1.6);
  scene.add(travelLight, poolLight);
  const lights = [[.04, .085], [.18, .205], [.34, .35], [.47, .505], [.63, .67], [.75, .79], [.85, .875], [.92, .966]];
  const state = { progress: 0, mode: 'scroll', elapsed: 0, handedOff: 0, renderedFrames: 0 };
  const scroll = { progress: 0 };
  let triggerTween, raf = 0, previousTime = 0, disposed = false, autoAttempted = false;
  let resolveFlight, flight, startPose, waitTimer, fadeAnimation;
  let fallbackFlight = false, blackReady = false;
  const lifecycle = new AbortController();
  let statsAt = 0, statsFrames = 0, fps = 0, slowTime = 0, lastChapter = '';
  let lastWidth = 0;
  const target = vec(0, 0, 0), tangent = vec(0, 0, -1), transport = new THREE.Quaternion();
  const initialPosition = vec(0, 0, 0), initialQuaternion = new THREE.Quaternion();
  let debug;
  if (debugEnabled) {
    debug = document.createElement('pre'); debug.id = 'tunnel-debug'; document.body.append(debug);
    if (params.get('tunnelHelpers') === '1') {
      for (const curve of [path.position, path.target]) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(220)), new THREE.LineBasicMaterial({ color: 0xe7e0d2, depthTest: false })));
    }
  }
  for (const [name, p] of [['Entrance', 0], ['Cards', .32], ['Watch', .47], ['Doors', .6], ['Handoff', HANDOFF], ['Keyhole', .966]]) {
    const marker = new THREE.Object3D(); marker.name = `LOC_Camera_${name}`; marker.position.copy(path.position.getPoint(p)); scene.add(marker);
  }
  function active() { return view.classList.contains('is-active'); }
  function ready() {
    const name = document.getElementById('in-name').value.trim();
    let phone = document.getElementById('in-phone').value.replace(/\D/g, '');
    if (phone.length === 11 && phone.startsWith('1')) phone = phone.slice(1);
    return name.includes(' ') && phone.length === 10;
  }
  function resize() {
    if (disposed) return;
    const width = innerWidth, height = innerHeight;
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tiers[quality].dpr));
    renderer.setSize(width, height, false);
    if (width !== lastWidth) { lastWidth = width; triggerTween?.scrollTrigger?.refresh(); }
    wake();
  }
  function updateTunnel(progress) {
    const p = clamp(progress, 0, 1); state.progress = p;
    camera.position.copy(path.position.getPoint(p));
    path.target.getPoint(p, target);
    path.position.getTangent(p, tangent);
    transport.setFromUnitVectors(vec(0, 0, -1), tangent);
    // Transported up stays stable when looking straight down the shaft.
    camera.up.set(0, 1, 0).applyQuaternion(transport);
    const direction = target.clone().sub(camera.position);
    if (direction.lengthSq() < .000001) target.copy(camera.position).add(tangent);
    if (Math.abs(direction.normalize().dot(camera.up)) > .98) camera.up.set(1, 0, 0);
    camera.lookAt(target);
    const roll = sample([[0, 0], [.2, -3], [.32, 7], [.47, -6], [.6, 4], [.74, -8], [.87, 3], [.92, 0], [1, 0]], p);
    camera.rotateZ(THREE.MathUtils.degToRad(roll));
    world.update(p);
    scene.fog.density = sample([[0, .02], [.3, .028], [.6, .035], [.82, .045], [.92, .025], [1, .02]], p);
    travelLight.position.copy(camera.position).add(vec(.65, 1.1, .1).applyQuaternion(camera.quaternion));
    travelLight.intensity = sample([[0, 42], [.27, 28], [.32, 65], [.43, 22], [.47, 52], [.58, 28], [.74, 45], [.84, 32], [.92, 62], [1, 10]], p);
    const cueProgress = sample(lights, p);
    poolLight.position.copy(path.position.getPoint(cueProgress)).add(vec(-1.2, 2, .8));
    poolLight.intensity = quality === 'LOW' ? 0 : 60;
    hud.style.setProperty('--tunnel-progress', String(p));
    document.body.classList.toggle('tunnel-at-door', p >= HANDOFF - .001);
    const chapter = CHAPTERS.filter(c => p >= c[0]).at(-1)[1];
    if (chapter !== lastChapter) {
      lastChapter = chapter;
      document.getElementById('tunnel-hint').textContent = p < .08 ? 'SCROLL TO DESCEND' : p < .92 ? 'KEEP SCROLLING ↓' : 'YOUR INVITATION AWAITS';
    }
    document.getElementById('tunnel-depth').textContent = `${Math.round(p * 100)}%`;
  }
  function pause() { if (raf) cancelAnimationFrame(raf); raf = 0; previousTime = 0; }
  function wake() {
    if (!disposed && !document.hidden && state.mode !== 'complete' && (active() || state.mode === 'transition') && !raf) raf = requestAnimationFrame(frame);
  }
  function renderStats(now) {
    statsFrames++;
    if (!statsAt) statsAt = now;
    if (now - statsAt >= 750) {
      fps = statsFrames * 1000 / (now - statsAt); statsFrames = 0; statsAt = now;
      // Reduce secondary work only after sustained slow rendered frames.
      slowTime = fps < 32 ? slowTime + .75 : Math.max(0, slowTime - .75);
      if (slowTime > 4.5 && quality !== 'LOW' && !requested) {
        quality = quality === 'HIGH' ? 'MEDIUM' : 'LOW'; slowTime = 0;
        if (quality === 'LOW') world.low(); resize();
      }
    }
    if (debug) debug.textContent = `${fps.toFixed(0)} FPS · ${quality}\n${state.mode} · ${lastChapter}\np ${state.progress.toFixed(4)} · handoffs ${state.handedOff}\nXYZ ${camera.position.toArray().map(x => x.toFixed(2)).join(' ')}\ntarget ${target.toArray().map(x => x.toFixed(2)).join(' ')}\nroll ${THREE.MathUtils.radToDeg(camera.rotation.z).toFixed(1)}°\n${renderer.info.render.calls} calls · ${renderer.info.render.triangles.toLocaleString()} triangles\npath ${path.position.getLength().toFixed(1)} m`;
  }
  function atBlack() {
    blackReady = true;
    black.style.opacity = '1'; flash.style.opacity = '0';
    if (resolveFlight) { resolveFlight(); resolveFlight = null; }
  }
  function frame(now) {
    raf = 0;
    if (disposed || document.hidden || state.mode === 'complete' || (!active() && state.mode !== 'transition')) return;
    const dt = previousTime ? Math.min(.05, (now - previousTime) / 1000) : 0; previousTime = now;
    if (state.mode === 'scroll') {
      if (!triggerTween) {
        const raw = clamp(-runway.getBoundingClientRect().top / SCROLL_DISTANCE, 0, 1) * HANDOFF;
        scroll.progress += (raw - scroll.progress) * (1 - Math.exp(-dt / .12));
        if (Math.abs(raw - scroll.progress) < .00002) scroll.progress = raw;
      }
      if (!dialog.open) updateTunnel(Math.min(HANDOFF, scroll.progress));
      if (state.progress < .88) autoAttempted = false;
      if (state.progress >= HANDOFF - .00002 && !autoAttempted && !dialog.open) {
        updateTunnel(HANDOFF); autoAttempted = true;
        if (ready()) form.requestSubmit();
        else window.openTunnelInvitation();
      }
    } else if (state.mode === 'transition') {
      state.elapsed += dt;
      const t = Math.min(1, state.elapsed / 1.22);
      const p = startPose.progress + (1 - startPose.progress) * Math.pow(t, 5);
      updateTunnel(p);
      // Exact captured world transform at t=0; no scene or canvas replacement.
      if (state.elapsed < .12) {
        const blend = smooth(state.elapsed, 0, .12);
        camera.position.lerpVectors(initialPosition, camera.position.clone(), blend);
        camera.quaternion.slerpQuaternions(initialQuaternion, camera.quaternion.clone(), blend);
      }
      const crossed = camera.position.y < world.portal.position.y;
      flash.style.opacity = crossed && state.elapsed < 1.24 ? String(Math.max(0, 1 - (state.elapsed - 1.1) / .14)) : '0';
      if (state.elapsed >= 1.25) black.style.opacity = '1';
      if (state.elapsed >= 1.35) { atBlack(); pause(); return; }
    }
    renderer.render(scene, camera); state.renderedFrames++;
    renderStats(now);
    // Exactly one scheduling site owns the next rendered frame.
    wake();
  }
  function installScroll() {
    if (!window.gsap || !window.ScrollTrigger) return;
    window.gsap.registerPlugin(window.ScrollTrigger);
    triggerTween = window.gsap.to(scroll, {
      progress: HANDOFF, duration: 1, ease: 'none',
      scrollTrigger: { trigger: runway, start: 'top top', end: `+=${SCROLL_DISTANCE}`, scrub: .35, invalidateOnRefresh: true }
    });
    // Canvas itself is fixed, avoiding ScrollTrigger reparenting at handoff.
    if (!active()) triggerTween.scrollTrigger.disable(false);
  }
  function explore() {
    if (disposed) return false;
    if (state.progress >= HANDOFF - .00002) return false;
    dialog.close();
    if (state.mode === 'complete') reset();
    wake(); return true;
  }
  function start({ skip = false } = {}) {
    if (disposed) return fallback.start();
    if (state.mode === 'transition') return flight;
    if (skip || reduced.matches) {
      startPose = null;
      fallbackFlight = true;
      state.mode = 'complete'; pause(); triggerTween?.scrollTrigger?.disable(false);
      return fallback.start();
    }
    dialog.close();
    fallbackFlight = false; blackReady = false;
    initialPosition.copy(camera.position); initialQuaternion.copy(camera.quaternion);
    startPose = { progress: state.progress, position: initialPosition.clone(), quaternion: initialQuaternion.clone(), target: target.clone() };
    state.mode = 'transition'; state.elapsed = 0; state.handedOff++;
    triggerTween?.scrollTrigger?.disable(false);
    overlay.classList.add('is-live'); document.body.classList.add('rabbit-fall');
    hud.inert = true;
    black.style.opacity = flash.style.opacity = '0';
    flight = new Promise(resolve => { resolveFlight = resolve; });
    waitTimer = setTimeout(() => overlay.classList.add('is-waiting'), 2300);
    previousTime = 0; wake();
    return flight;
  }
  async function finish() {
    if (disposed) return fallback.finish();
    state.mode = 'complete'; pause(); clearTimeout(waitTimer);
    overlay.classList.remove('is-waiting');
    if (!startPose) { await fallback.finish(); fallbackFlight = false; return; }
    fadeAnimation = black.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
    await fadeAnimation.finished.catch(() => {});
    overlay.classList.remove('is-live'); black.style.opacity = '0'; fadeAnimation.cancel();
    document.body.classList.remove('rabbit-fall');
  }
  function cancel() {
    if (disposed) return fallback.cancel();
    clearTimeout(waitTimer); fadeAnimation?.cancel(); fallback.cancel();
    resolveFlight?.(); resolveFlight = null; flight = null;
    state.mode = 'scroll'; state.elapsed = 0; startPose = null; autoAttempted = true;
    fallbackFlight = false; blackReady = false;
    flash.style.opacity = black.style.opacity = '0';
    hud.inert = !active();
    triggerTween?.scrollTrigger?.enable(false, false);
    updateTunnel(Math.min(HANDOFF, scroll.progress));
    if (active()) window.openTunnelInvitation();
    wake();
  }
  function reset() {
    if (disposed) return;
    triggerTween?.scrollTrigger?.kill(); triggerTween?.kill(); triggerTween = null;
    window.scrollTo({ top: 0, behavior: 'instant' });
    clearTimeout(waitTimer); state.mode = 'scroll'; state.progress = 0; scroll.progress = 0;
    autoAttempted = false; startPose = null; state.elapsed = 0;
    fallbackFlight = false; blackReady = false;
    installScroll(); updateTunnel(0); hud.inert = false; wake();
  }
  function viewChanged() {
    if (disposed) return;
    if (active()) { if (state.mode === 'complete') reset(); triggerTween?.scrollTrigger?.enable(false, true); wake(); }
    else { triggerTween?.scrollTrigger?.disable(false); if (state.mode !== 'transition') pause(); }
  }
  function loseContext(event) {
    event?.preventDefault();
    if (disposed) return;
    pause(); disposed = true;
    triggerTween?.scrollTrigger?.kill(); triggerTween?.kill();
    clearTimeout(waitTimer);
    const pending = resolveFlight; resolveFlight = null;
    // Preserve a completed blackout or an in-flight skip/final fade. Restarting
    // from transparent would expose the destination before the API returns.
    const overlayActive = overlay.classList.contains('is-live');
    if (blackReady) { black.style.opacity = '1'; pending?.(); }
    else if (state.mode === 'transition' && !fallbackFlight) fallback.start().then(() => pending?.());
    else if (!overlayActive) fallback.cancel();
    hud.inert = !active();
    document.body.classList.add('tunnel-fallback');
    window.rabbitFall = fallback;
    document.getElementById('btn-name').textContent = 'Enter Wonderland →';
    if (active() && !overlayActive) window.openTunnelInvitation();
    const geometries = new Set(), materials = new Set();
    scene.traverse(node => { if (node.geometry) geometries.add(node.geometry); if (node.material) for (const m of [node.material].flat()) materials.add(m); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    renderer.dispose();
    lifecycle.abort();
  }
  window.addEventListener('party:view', viewChanged, { signal: lifecycle.signal });
  window.addEventListener('resize', resize, { passive: true, signal: lifecycle.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else { statsAt = 0; statsFrames = 0; wake(); }
  }, { signal: lifecycle.signal });
  canvas.addEventListener('webglcontextlost', loseContext, { signal: lifecycle.signal });
  reduced.addEventListener('change', event => { if (event.matches) loseContext(); }, { signal: lifecycle.signal });
  window.addEventListener('pagehide', pause, { signal: lifecycle.signal });
  window.addEventListener('pageshow', wake, { signal: lifecycle.signal });
  installScroll(); resize(); updateTunnel(0);
  // Only expose the normal canvas once its first real 3D frame exists.
  renderer.render(scene, camera);
  document.body.classList.remove('tunnel-loading', 'tunnel-fallback');
  window.rabbitFall = { start, finish, cancel, explore };
  if (debugEnabled) window.tunnelDebug = { state, camera, scene, renderer, path, get quality() { return quality; }, get startPose() { return startPose; }, get fps() { return fps; }, get raf() { return raf; } };
  wake();
}
