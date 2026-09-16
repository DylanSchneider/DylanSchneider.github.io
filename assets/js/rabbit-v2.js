import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const overlay = document.getElementById('fall-transition');
const canvas = document.getElementById('fall-canvas');
const tunnel = document.querySelector('.fall-tunnel');
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

if (!overlay || !canvas || !tunnel) throw new Error('Rabbit Hole v2 could not find its scene elements.');

document.body.classList.add('homepage-v2');

const stage = document.createElement('div');
stage.className = 'v2-tunnel-stage';
stage.innerHTML = `
  <div class="v2-tunnel-stage__topline">THE WAY IS DOWN <span>DON'T BE LATE</span></div>
  <div class="v2-tunnel-stage__title">Keep falling<small>tea is waiting at the bottom</small></div>
`;
stage.append(canvas);
tunnel.replaceChildren(stage);

const state = { progress: 0, drift: 0 };
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, .018);

const camera = new THREE.PerspectiveCamera(66, 1, .1, 160);
camera.position.set(0, 0, 6);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'low-power'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

const tunnelGroup = new THREE.Group();
scene.add(tunnelGroup);

const shell = new THREE.Mesh(
  new THREE.CylinderGeometry(8.2, 8.2, 112, 32, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide, transparent: true, opacity: .92 })
);
shell.rotation.x = Math.PI / 2;
tunnelGroup.add(shell);

const wireShell = new THREE.Mesh(
  new THREE.CylinderGeometry(8.05, 8.05, 112, 24, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x686868, side: THREE.BackSide, wireframe: true, transparent: true, opacity: .14 })
);
wireShell.rotation.x = Math.PI / 2;
tunnelGroup.add(wireShell);

const rings = [];
for (let i = 0; i < 32; i++) {
  const radius = 2.6 + Math.sin(i * 1.7) * .18 + (i % 5 === 0 ? .24 : 0);
  const material = new THREE.MeshBasicMaterial({
    color: i % 5 === 0 ? 0xffffff : i % 2 ? 0x8d8d8d : 0xd6d6d6,
    transparent: true,
    opacity: i % 5 === 0 ? .62 : .25
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, i % 5 === 0 ? .045 : .018, 6, 72), material);
  ring.position.z = 3 - i * 3.55;
  ring.position.x = Math.sin(i * 1.41) * .16;
  ring.position.y = Math.cos(i * 1.17) * .13;
  ring.scale.set(1 + Math.sin(i * 1.9) * .08, .84 + Math.cos(i * 1.23) * .08, 1);
  ring.rotation.z = (i % 2 ? -.12 : .12) + i * .025;
  tunnelGroup.add(ring);
  rings.push(ring);
}

// A distant keyhole gives the camera a Wonderland destination instead of an
// abstract vanishing point. It grows into the blackout at the end of the fall.
const keyhole = new THREE.Group();
const keyholeMaterial = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: .58, side: THREE.DoubleSide });
const keyholeHead = new THREE.Mesh(new THREE.CircleGeometry(.72, 32), keyholeMaterial);
keyholeHead.position.y = .5;
const keyholeStem = new THREE.Mesh(new THREE.BoxGeometry(.58, 1.45, .04), keyholeMaterial);
keyholeStem.position.y = -.35;
const keyholeFrame = new THREE.Mesh(
  new THREE.TorusGeometry(1.02, .035, 6, 40),
  new THREE.MeshBasicMaterial({ color: 0x858585, transparent: true, opacity: .42 })
);
keyhole.add(keyholeHead, keyholeStem, keyholeFrame);
keyhole.position.set(.12, .08, -111);
keyhole.rotation.z = -.08;
tunnelGroup.add(keyhole);

// A pocket watch drifts past the camera—an Alice cue that also supports the
// "don't be late" copy without adding another color to the palette.
const watch = new THREE.Group();
const watchFace = new THREE.Mesh(
  new THREE.CircleGeometry(.78, 32),
  new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: .72, side: THREE.DoubleSide })
);
const watchRim = new THREE.Mesh(
  new THREE.TorusGeometry(.84, .06, 6, 32),
  new THREE.MeshBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: .55 })
);
const watchHand = new THREE.Mesh(
  new THREE.BoxGeometry(.045, .48, .035),
  new THREE.MeshBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: .78 })
);
watchHand.position.y = .2;
const watchMinute = new THREE.Mesh(
  new THREE.BoxGeometry(.035, .62, .035),
  new THREE.MeshBasicMaterial({ color: 0x8f8f8f, transparent: true, opacity: .8 })
);
watchMinute.position.y = .27;
watchMinute.rotation.z = 1.05;
watch.add(watchFace, watchRim, watchHand, watchMinute);
watch.position.set(-3.2, 1.9, -28);
watch.rotation.z = -.22;
tunnelGroup.add(watch);

// A quiet Cheshire grin appears off-axis, then slips away as the camera
// moves deeper. The shape is intentionally suggestive rather than literal.
const grin = new THREE.Group();
const grinMaterial = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: .28, side: THREE.DoubleSide });
const grinSmile = new THREE.Mesh(new THREE.TorusGeometry(.72, .035, 5, 28, Math.PI), grinMaterial);
const grinEye = new THREE.Mesh(new THREE.CircleGeometry(.055, 12), grinMaterial);
const grinEyeTwo = grinEye.clone();
grinEye.position.set(-.32, .42, 0);
grinEyeTwo.position.set(.32, .42, 0);
grin.add(grinSmile, grinEye, grinEyeTwo);
grin.position.set(3.15, -1.45, -53);
grin.rotation.z = .12;
tunnelGroup.add(grin);

const suits = ['♠', '♣', '♦', '♥', '♠', '♣', '♦', '♥'];
const cards = [];
function cardTexture(suit, index) {
  const card = document.createElement('canvas');
  card.width = 128;
  card.height = 192;
  const c = card.getContext('2d');
  c.fillStyle = '#080808';
  c.fillRect(0, 0, card.width, card.height);
  c.strokeStyle = index % 3 === 0 ? '#ffffff' : '#8d8d8d';
  c.lineWidth = 4;
  c.strokeRect(7, 7, card.width - 14, card.height - 14);
  c.fillStyle = '#f0f0f0';
  c.font = '700 52px Georgia';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(suit, card.width / 2, card.height / 2 + 4);
  const texture = new THREE.CanvasTexture(card);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

for (let i = 0; i < suits.length; i++) {
  const material = new THREE.MeshBasicMaterial({ map: cardTexture(suits[i], i), transparent: true, opacity: .45, side: THREE.DoubleSide });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(.7, 1.05), material);
  card.position.set(Math.sin(i * 2.4) * (2.7 + i % 3), Math.cos(i * 1.8) * (2.1 + i % 2), 1 - i * 8.5);
  card.rotation.set(i * .21, i * .34, i * .7);
  card.userData = { baseX: card.position.x, baseY: card.position.y, speed: .35 + i * .025 };
  tunnelGroup.add(card);
  cards.push(card);
}

const particlePositions = new Float32Array(420 * 3);
for (let i = 0; i < 420; i++) {
  const angle = i * 2.399963;
  const radius = 1.2 + (i % 100) / 100 * 7.1;
  particlePositions[i * 3] = Math.cos(angle) * radius;
  particlePositions[i * 3 + 1] = Math.sin(angle) * radius * .72;
  particlePositions[i * 3 + 2] = 4 - (i % 120) * 1.05;
}
const particles = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(particlePositions, 3)),
  new THREE.PointsMaterial({ color: 0xffffff, size: .045, transparent: true, opacity: .52, sizeAttenuation: true })
);
tunnelGroup.add(particles);

let width = 1;
let height = 1;
let raf = 0;
let running = true;
let transitioning = false;
let scrollTrigger = null;
let fallbackScroll = null;
let timeline = null;
let finishTimeline = null;
let resolveFlight = null;

function resize() {
  width = Math.max(1, window.innerWidth);
  height = Math.max(1, window.innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function render() {
  if (!running) { raf = 0; return; }
  const p = state.progress;
  state.drift += .006 + p * .014;
  camera.position.z = 6 - p * 72;
  camera.position.x = Math.sin(state.drift * .8) * (.12 + p * .28);
  camera.position.y = Math.cos(state.drift * .67) * (.1 + p * .22);
  camera.rotation.z = Math.sin(state.drift * .43) * (.018 + p * .06);
  camera.rotation.x = Math.sin(state.drift * .31) * (.012 + p * .025);
  tunnelGroup.rotation.z = state.drift * .24 + p * .22;

  rings.forEach((ring, i) => {
    ring.rotation.z += (i % 2 ? -.0005 : .0007) * (1 + p * 2);
  });
  cards.forEach((card, i) => {
    card.rotation.x += .002 * card.userData.speed;
    card.rotation.y += .003 * card.userData.speed;
    card.position.x = card.userData.baseX + Math.sin(state.drift * card.userData.speed + i) * (.12 + p * .25);
    card.position.y = card.userData.baseY + Math.cos(state.drift * card.userData.speed + i) * (.1 + p * .18);
  });
  watch.rotation.z += .0018;
  watch.position.x = -3.2 + Math.sin(state.drift * .7) * (.12 + p * .32);
  watch.position.y = 1.9 + Math.cos(state.drift * .52) * (.08 + p * .16);
  grin.rotation.z += .0008;
  grin.position.x = 3.15 + Math.sin(state.drift * .45) * .2;
  particles.rotation.z = state.drift * .12;
  renderer.render(scene, camera);
  raf = requestAnimationFrame(render);
}

function installScroll() {
  if (window.gsap && window.ScrollTrigger) {
    window.gsap.registerPlugin(window.ScrollTrigger);
    scrollTrigger = window.ScrollTrigger.create({
      trigger: tunnel,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 1,
      onUpdate: (self) => {
        if (!transitioning) state.progress = self.progress;
      }
    });
    return;
  }

  fallbackScroll = () => {
    if (transitioning) return;
    const rect = tunnel.getBoundingClientRect();
    state.progress = Math.max(0, Math.min(1, -rect.top / Math.max(1, tunnel.offsetHeight - height)));
  };
  window.addEventListener('scroll', fallbackScroll, { passive: true });
  fallbackScroll();
}

function handoffComplete() {
  overlay.classList.add('is-black');
  resolveFlight?.();
  resolveFlight = null;
}

function start() {
  if (resolveFlight) return new Promise((resolve) => {
    const previous = resolveFlight;
    resolveFlight = () => { previous(); resolve(); };
  });

  transitioning = true;
  scrollTrigger?.kill();
  if (fallbackScroll) window.removeEventListener('scroll', fallbackScroll);
  overlay.style.opacity = '';
  overlay.classList.add('is-live');
  overlay.classList.remove('is-black', 'is-finishing');
  document.body.classList.add('rabbit-fall');
  overlay.append(canvas);
  resize();

  const flight = new Promise((resolve) => { resolveFlight = resolve; });
  if (reduced) {
    state.progress = 1.6;
    handoffComplete();
    return flight;
  }

  if (window.gsap) {
    timeline?.kill();
    const finishProgress = Math.max(1.55, state.progress + .7);
    timeline = window.gsap.timeline({ onUpdate: render, onComplete: handoffComplete });
    timeline
      .to(state, { progress: Math.max(1.08, state.progress + .18), duration: .9, ease: 'power2.in' })
      .to(state, { progress: finishProgress, duration: 1.45, ease: 'expo.in' })
      .to(overlay.querySelector('.fall-transition__iris'), { scale: 5, duration: .5, ease: 'power3.in' }, '<-.35')
      .to(overlay.querySelector('.fall-transition__copy'), { opacity: 0, y: -26, duration: .3 }, '<-.06')
      .to(overlay.querySelector('.fall-transition__flash'), { opacity: .94, duration: .1 }, '>-0.02')
      .to(overlay.querySelector('.fall-transition__flash'), { opacity: 0, duration: .2 });
  } else {
    const from = state.progress;
    const started = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / 3000);
      state.progress = from + (Math.max(1.55, from + .7) - from) * (t * t * t * t);
      render();
      if (t < 1) requestAnimationFrame(step);
      else handoffComplete();
    };
    requestAnimationFrame(step);
  }
  return flight;
}

function finish() {
  finishTimeline?.kill();
  if (window.gsap) {
    finishTimeline = window.gsap.timeline({ onComplete: () => {
      overlay.style.opacity = '';
      overlay.classList.remove('is-live', 'is-black', 'is-finishing');
      document.body.classList.remove('rabbit-fall');
      running = false;
      if (raf) cancelAnimationFrame(raf);
    } });
    finishTimeline.to(overlay, { opacity: 0, duration: .46, ease: 'power2.out' });
  }
}

function cancel() {
  timeline?.kill();
  finishTimeline?.kill();
  resolveFlight?.();
  resolveFlight = null;
  transitioning = false;
  overlay.classList.remove('is-live', 'is-black', 'is-finishing');
  overlay.style.opacity = '';
  document.body.classList.remove('rabbit-fall');
  stage.append(canvas);
  resize();
  running = true;
  if (!raf) render();
  installScroll();
}

resize();
window.addEventListener('resize', resize, { passive: true });
installScroll();
render();
window.rabbitFall = { start, finish, cancel };
