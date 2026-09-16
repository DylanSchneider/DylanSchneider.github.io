/* Eager enhancement with a working check-in even if the CDN/WebGL fails. */
(() => {
  const view = document.getElementById('v-name');
  const tunnel = document.querySelector('.fall-tunnel');
  const overlay = document.getElementById('fall-transition');
  const canvas = document.getElementById('fall-canvas');
  const stage = document.createElement('div');
  stage.id = 'tunnel-stage';
  stage.setAttribute('aria-hidden', 'true');
  stage.append(canvas);
  document.body.prepend(stage);
  const hud = document.createElement('div');
  hud.id = 'tunnel-hud';
  hud.innerHTML = `<div class="tunnel-heading"><span id="tunnel-hint">SCROLL TO DESCEND</span><span id="tunnel-depth">I / VII</span></div>
    <div class="tunnel-foot"><button type="button" id="tunnel-return">↑ Your invitation</button><span aria-hidden="true">↓</span><button type="submit" form="form-name" data-skip-tunnel="true">Skip journey</button></div>
    <button type="submit" form="form-name" id="tunnel-enter">Enter Wonderland →</button><div class="tunnel-meter"><i></i></div>`;
  document.body.append(hud);
  tunnel.replaceChildren();
  tunnel.removeAttribute('aria-hidden');
  tunnel.setAttribute('aria-label', 'Scroll through the rabbit hole');
  view.append(tunnel);
  const invitation = document.createElement('dialog');
  invitation.id = 'tunnel-invitation';
  invitation.setAttribute('aria-labelledby', 'invitation-title');
  const shell = document.querySelector('.landing-shell');
  document.querySelector('.entry-stage__title').id = 'invitation-title';
  invitation.append(shell);
  view.append(invitation);
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'tunnel-close'; close.textContent = '← Back to the tunnel';
  shell.prepend(close);
  close.onclick = () => invitation.close();
  const openInvitation = () => { if (!invitation.open) invitation.showModal(); };
  window.openTunnelInvitation = openInvitation;
  hud.querySelectorAll('[type="submit"]').forEach(button => button.addEventListener('click', event => {
    const name = document.getElementById('in-name').value.trim();
    const phone = document.getElementById('in-phone').value.replace(/\D/g, '');
    if (!name.includes(' ') || phone.length < 10) { event.preventDefault(); openInvitation(); }
  }));
  overlay.replaceChildren();
  overlay.className = 'tunnel-transition';
  overlay.innerHTML = '<div id="tunnel-white-flash"></div><div id="tunnel-blackout"></div><p id="tunnel-wait" role="status">Opening your invitation…</p>';
  overlay.removeAttribute('aria-hidden');
  let animation, waitTimer, resolveFade;
  const fade = (from, to, duration) => {
    animation?.cancel();
    resolveFade?.();
    const black = document.getElementById('tunnel-blackout');
    black.style.opacity = String(to);
    return new Promise(resolve => {
      resolveFade = resolve;
      animation = black.animate([{ opacity: from }, { opacity: to }], { duration });
      animation.finished.catch(() => {}).then(() => { resolve(); if (resolveFade === resolve) resolveFade = null; });
    });
  };
  const fallback = {
    explore: () => false,
    start: () => {
      invitation.close();
      document.body.classList.add('rabbit-fall');
      overlay.classList.add('is-live');
      waitTimer = setTimeout(() => overlay.classList.add('is-waiting'), 1600);
      return fade(0, 1, 180);
    },
    finish: async () => {
      clearTimeout(waitTimer);
      overlay.classList.remove('is-waiting');
      await fade(1, 0, 180);
      overlay.classList.remove('is-live');
      document.body.classList.remove('rabbit-fall');
    },
    cancel: () => {
      clearTimeout(waitTimer);
      animation?.cancel();
      overlay.classList.remove('is-live', 'is-waiting');
      document.body.classList.remove('rabbit-fall');
      hud.inert = !view.classList.contains('is-active');
      if (view.classList.contains('is-active')) openInvitation();
    }
  };
  window.rabbitFall = fallback;
  document.body.classList.add('tunnel-loading');
  const loading = document.createElement('p');
  loading.id = 'tunnel-loading'; loading.setAttribute('role', 'status');
  loading.textContent = 'Opening the rabbit hole…';
  stage.append(loading);
  const useFallback = () => {
    document.body.classList.remove('tunnel-loading');
    document.body.classList.add('tunnel-fallback');
    document.getElementById('btn-name').textContent = 'Enter Wonderland →';
  };
  const sync = () => {
    const active = view.classList.contains('is-active');
    document.body.classList.toggle('tunnel-home', active);
    hud.inert = !active;
  };
  window.addEventListener('party:view', sync);
  sync();
  document.getElementById('tunnel-return').onclick = openInvitation;
  // Optional future assets/fallback/tunnel_poster.webp; never required to enter.
  if (window.PARTY_CONFIG?.TUNNEL_POSTER) stage.style.backgroundImage = `url("${window.PARTY_CONFIG.TUNNEL_POSTER}")`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches || new URLSearchParams(location.search).get('tunnelQuality') === 'fallback') {
    useFallback();
    return;
  }
  let abandoned = false;
  const timeout = setTimeout(() => { abandoned = true; useFallback(); }, 12000);
  import('./rabbit-v2.js').then(module => {
    clearTimeout(timeout);
    // Don't replace an in-flight fallback controller on a slow connection.
    if (abandoned || document.body.classList.contains('rabbit-fall')) { useFallback(); return; }
    module.initTunnel({ fallback, reduced });
  }).catch(error => {
    clearTimeout(timeout);
    console.warn('Tunnel enhancement unavailable; check-in remains available.', error);
    useFallback();
  });
})();
