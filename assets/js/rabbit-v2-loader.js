/* The original v2 tunnel is the main homepage scene. Load it immediately so
   the first visit starts in the same experience that used to require ?v2=1. */
(function () {
  let modulePromise;
  const load = () => modulePromise || (modulePromise = import('./rabbit-v2.js'));
  const api = {
    start: () => load().then(() => window.rabbitFall?.start?.()),
    finish: () => load().then(() => window.rabbitFall?.finish?.()),
    cancel: () => load().then(() => window.rabbitFall?.cancel?.())
  };
  window.rabbitFall = api;
  load().catch((error) => {
    console.warn('The v2 tunnel could not load; the check-in form remains available.', error);
    if (window.rabbitFall === api) window.rabbitFall = null;
  });
}());
