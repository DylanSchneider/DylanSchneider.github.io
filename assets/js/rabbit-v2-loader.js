/* Load the experimental 3D landing scene only when the v2 test URL is used. */
(function () {
  if (new URLSearchParams(window.location.search).get('v2') !== '1') return;

  let modulePromise;
  const load = () => modulePromise || (modulePromise = import('./rabbit-v2.js'));
  const fallback = () => {
    const overlay = document.getElementById('fall-transition');
    const start = () => {
      overlay?.classList.add('is-live', 'is-black');
      document.body.classList.add('rabbit-fall');
      return Promise.resolve();
    };
    const finish = () => {
      if (window.gsap && overlay) {
        window.gsap.to(overlay, {
          opacity: 0,
          duration: .35,
          onComplete: () => {
            overlay.style.opacity = '';
            overlay.classList.remove('is-live', 'is-black');
            document.body.classList.remove('rabbit-fall');
          }
        });
      } else {
        overlay?.classList.remove('is-live', 'is-black');
        document.body.classList.remove('rabbit-fall');
      }
    };
    const cancel = () => {
      overlay?.classList.remove('is-live', 'is-black');
      document.body.classList.remove('rabbit-fall');
    };
    window.rabbitFall = { start, finish, cancel };
    return window.rabbitFall;
  };
  const ready = async () => {
    try { await load(); return window.rabbitFall; }
    catch { return fallback(); }
  };
  window.rabbitFall = {
    start: async () => (await ready()).start(),
    finish: async () => (await ready()).finish(),
    cancel: async () => (await ready()).cancel()
  };
}());
