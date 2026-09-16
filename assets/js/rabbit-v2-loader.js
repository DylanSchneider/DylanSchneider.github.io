/* Load the experimental 3D landing scene only when the v2 test URL is used. */
(function () {
  if (new URLSearchParams(window.location.search).get('v2') !== '1') return;

  let modulePromise;
  const load = () => modulePromise || (modulePromise = import('./rabbit-v2.js'));
  window.rabbitFall = {
    start: async () => {
      await load();
      return window.rabbitFall.start();
    },
    finish: () => load().then(() => window.rabbitFall.finish()),
    cancel: () => load().then(() => window.rabbitFall.cancel())
  };
}());
