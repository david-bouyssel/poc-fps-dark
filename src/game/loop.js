// Animation loop with injected frame scheduler (pure, testable under Node).

/**
 * Boucle d'animation à dépendances injectées (testable sous Node).
 * À chaque image : dt = (t - tPrécédent) / 1000 en secondes, puis update(dt), puis
 * render(). Première image après start : dt = 0. Le temps vient du paramètre `t`
 * fourni par requestFrame (horodatage en millisecondes) ; un dt non fini ou négatif
 * est ramené à 0.
 * @param {{
 *   update: (dt: number) => void,
 *   render: () => void,
 *   requestFrame: (cb: (t: number) => void) => number,
 *   cancelFrame: (id: number) => void,
 * }} deps  toutes obligatoires
 * @returns {{ start(): void, stop(): void, isRunning(): boolean }}
 *   start idempotent (pas de double boucle) ; stop annule l'image en attente.
 * @throws {TypeError} deps absent, ou dépendance manquante ou non fonction
 */
export function createGameLoop(deps) {
  if (deps === null || typeof deps !== 'object') {
    throw new TypeError('deps must be an object');
  }
  const { update, render, requestFrame, cancelFrame } = deps;
  const required = { update, render, requestFrame, cancelFrame };
  for (const name of Object.keys(required)) {
    if (typeof required[name] !== 'function') {
      throw new TypeError(`deps.${name} must be a function`);
    }
  }

  let running = false;
  let frameId = null;
  let lastTime = null;
  // Incremented on each start/stop so that stale callbacks never run.
  let generation = 0;

  function schedule(currentGeneration) {
    frameId = requestFrame((t) => onFrame(t, currentGeneration));
  }

  function onFrame(t, frameGeneration) {
    if (!running || frameGeneration !== generation) return;
    frameId = null;
    let dt = lastTime === null ? 0 : (t - lastTime) / 1000;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    lastTime = t;
    update(dt);
    render();
    // update or render may have stopped (or restarted) the loop.
    if (running && frameGeneration === generation && frameId === null) {
      schedule(frameGeneration);
    }
  }

  return Object.freeze({
    start() {
      if (running) return;
      running = true;
      lastTime = null;
      generation += 1;
      schedule(generation);
    },
    stop() {
      if (!running) return;
      running = false;
      generation += 1;
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
    },
    isRunning() {
      return running;
    },
  });
}
