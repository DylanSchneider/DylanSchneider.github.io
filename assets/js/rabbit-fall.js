/* Cinematic rabbit-hole handoff. The canvas is deliberately self-contained:
   if GSAP is unavailable, the same scene falls back to requestAnimationFrame. */
(function () {
  const overlay = document.getElementById('fall-transition');
  const canvas = document.getElementById('fall-canvas');
  if (!overlay || !canvas) return;

  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const prefersTouch = window.matchMedia?.('(pointer: coarse)').matches;
  const scene = { progress: 0, drift: 0, flash: 0 };
  const particles = Array.from({ length: prefersTouch ? 90 : 150 }, (_, i) => ({
    angle: (i * 2.399963) % (Math.PI * 2),
    radius: .08 + ((i * 37) % 100) / 100 * .92,
    depth: ((i * 71) % 100) / 100,
    size: 0.45 + ((i * 17) % 100) / 100 * 1.8,
    warm: i % 5 === 0
  }));

  let width = 1;
  let height = 1;
  let dpr = 1;
  let raf = 0;
  let timeline = null;
  let finishTimeline = null;
  let resolveFlight = null;
  let rendering = false;

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const easeIn = (n) => n * n * n * n;
  const easeOut = (n) => 1 - Math.pow(1 - n, 3);

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function polygon(points, fill, stroke) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function drawTunnel(progress) {
    const p = clamp(progress, 0, 1);
    const cx = width * (.5 + Math.sin(scene.drift) * .018);
    const cy = height * (.48 + Math.cos(scene.drift * .8) * .018);
    const maxR = Math.hypot(width, height) * .72;
    const segments = width < 600 ? 12 : 16;
    const layers = 16;
    const rotation = scene.drift * .16 + p * .44;

    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.3);
    bg.addColorStop(0, '#1d1117');
    bg.addColorStop(.35, '#09060b');
    bg.addColorStop(1, '#000');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Perspective walls: each slice is a real quadrilateral, so the eye sees
    // a camera moving through depth instead of a flat background scaling up.
    for (let layer = layers; layer >= 0; layer--) {
      const z = (layer / layers + p * 2.2) % 1;
      const near = Math.pow(z, .72);
      const far = Math.pow(Math.max(0, z - .075), .72);
      const inner = 7 + far * maxR;
      const outer = 7 + near * maxR;
      const twist = rotation + z * .85;

      for (let segment = 0; segment < segments; segment++) {
        const a0 = twist + segment / segments * Math.PI * 2;
        const a1 = twist + (segment + 1) / segments * Math.PI * 2;
        const hue = segment % 4 === 0 ? '181,18,60' : segment % 3 === 0 ? '217,180,109' : '245,239,227';
        const alpha = (.08 + near * .16) * (segment % 2 ? .7 : 1);
        polygon([
          [cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner * .82],
          [cx + Math.cos(a1) * inner, cy + Math.sin(a1) * inner * .82],
          [cx + Math.cos(a1) * outer, cy + Math.sin(a1) * outer * .82],
          [cx + Math.cos(a0) * outer, cy + Math.sin(a0) * outer * .82]
        ], `rgba(${hue},${alpha})`, `rgba(255,247,231,${.035 + near * .08})`);
      }
    }

    // The bright mouth at the end of the fall gives the transition a target.
    const mouth = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * .24);
    mouth.addColorStop(0, `rgba(255,247,231,${.34 * easeOut(p)})`);
    mouth.addColorStop(.18, `rgba(217,180,109,${.16 * easeOut(p)})`);
    mouth.addColorStop(1, 'rgba(181,18,60,0)');
    ctx.fillStyle = mouth;
    ctx.fillRect(0, 0, width, height);

    // Dust and debris accelerate toward the edges as the camera dives.
    particles.forEach((particle) => {
      const depth = (particle.depth + p * 2.8) % 1;
      const radius = 10 + Math.pow(depth, .72) * maxR * (0.42 + particle.radius * .58);
      const angle = particle.angle + rotation + depth * .7;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * .82;
      const alpha = clamp((depth - .08) * 1.5, 0, .75) * (1 - p * .15);
      if (alpha <= 0) return;
      ctx.fillStyle = particle.warm
        ? `rgba(217,180,109,${alpha})`
        : `rgba(255,247,231,${alpha * .78})`;
      ctx.beginPath();
      ctx.arc(x, y, particle.size * (.7 + depth * 2.4), 0, Math.PI * 2);
      ctx.fill();
    });

    // A small falling rabbit mark creates a recognizable focal beat without
    // requiring an external image asset.
    if (p > .08 && p < .82) {
      const rabbitP = easeOut(clamp((p - .08) / .74, 0, 1));
      const rabbitScale = 10 + rabbitP * 34;
      ctx.save();
      ctx.translate(cx + Math.sin(p * 12) * 18, cy - rabbitP * height * .12);
      ctx.rotate(-.12 + rabbitP * .25);
      ctx.fillStyle = `rgba(255,247,231,${.12 + rabbitP * .35})`;
      ctx.beginPath();
      ctx.ellipse(0, rabbitScale * .48, rabbitScale * .62, rabbitScale * .9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-rabbitScale * .35, -rabbitScale * .42, rabbitScale * .18, rabbitScale * .7, -.18, 0, Math.PI * 2);
      ctx.ellipse(rabbitScale * .08, -rabbitScale * .5, rabbitScale * .18, rabbitScale * .74, .18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function render() {
    if (!rendering) { raf = 0; return; }
    scene.drift += .018;
    drawTunnel(scene.progress);
    raf = requestAnimationFrame(render);
  }

  function setLive(on) {
    overlay.classList.toggle('is-live', on);
    document.body.classList.toggle('rabbit-fall', on);
  }

  function fallbackFlight() {
    const started = performance.now();
    const duration = 1900;
    return new Promise((resolve) => {
      const step = (now) => {
        const t = clamp((now - started) / duration, 0, 1);
        scene.progress = easeIn(t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function start() {
    if (resolveFlight) return new Promise((resolve) => {
      const previous = resolveFlight;
      resolveFlight = () => { previous(); resolve(); };
    });

    resize();
    scene.progress = 0;
    scene.drift = 0;
    scene.flash = 0;
    setLive(true);
    overlay.style.opacity = '';
    overlay.classList.remove('is-black', 'is-finishing');
    if (!rendering) {
      rendering = true;
      render();
    }

    const flight = new Promise((resolve) => { resolveFlight = resolve; });
    if (reduced) {
      scene.progress = 1;
      overlay.classList.add('is-black');
      resolveFlight();
      resolveFlight = null;
      return flight;
    }

    if (window.gsap) {
      timeline?.kill();
      timeline = window.gsap.timeline({
        onComplete: () => {
          overlay.classList.add('is-black');
          resolveFlight?.();
          resolveFlight = null;
        }
      });
      timeline
        .to(scene, { progress: .18, duration: .32, ease: 'power2.in' })
        .to(scene, { progress: .72, duration: .62, ease: 'power4.in' })
        .to(scene, { progress: 1, duration: .48, ease: 'expo.in' })
        .to(overlay.querySelector('.fall-transition__iris'), { scale: 5, duration: .25, ease: 'power3.in' }, '<-.18')
        .to(overlay.querySelector('.fall-transition__copy'), { opacity: 0, y: -26, duration: .2 }, '<-.05')
        .to(overlay.querySelector('.fall-transition__flash'), { opacity: .94, duration: .08, ease: 'power2.in' }, '>-0.02')
        .to(overlay.querySelector('.fall-transition__flash'), { opacity: 0, duration: .14, ease: 'power2.out' });
    } else {
      fallbackFlight().then(() => {
        overlay.classList.add('is-black');
        resolveFlight?.();
        resolveFlight = null;
      });
    }
    return flight;
  }

  function finish() {
    finishTimeline?.kill();
    if (window.gsap) {
      finishTimeline = window.gsap.timeline({ onComplete: () => {
        setLive(false);
        overlay.style.opacity = '';
        rendering = false;
        if (raf) cancelAnimationFrame(raf);
      } });
      finishTimeline.to(overlay, { opacity: 0, duration: .46, ease: 'power2.out' });
    } else {
      overlay.classList.add('is-finishing');
      window.setTimeout(() => {
        setLive(false);
        overlay.style.opacity = '';
        rendering = false;
        if (raf) cancelAnimationFrame(raf);
      }, 460);
    }
  }

  function cancel() {
    timeline?.kill();
    finishTimeline?.kill();
    resolveFlight?.();
    resolveFlight = null;
    overlay.classList.remove('is-live', 'is-black', 'is-finishing');
    overlay.style.opacity = '';
    document.body.classList.remove('rabbit-fall');
    rendering = false;
    if (raf) cancelAnimationFrame(raf);
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('beforeunload', () => cancel(), { once: true });
  window.rabbitFall = { start, finish, cancel };
}());
