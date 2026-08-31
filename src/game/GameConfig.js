/**
 * GameConfig.js - Phaser bootstrap and lifecycle.
 *
 * React owns the DOM; this owns the canvas. App.jsx calls createGame() once on mount
 * and destroyGame() on unmount (which matters under StrictMode double-mounting in
 * dev - two live Phaser instances would double every input and halve the framerate).
 */

import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import MainLabScene from './scenes/MainLabScene.js';
import HUDScene from './scenes/HUDScene.js';

export function buildConfig(parent) {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#05070c',
    // RESIZE + antialias renders at the window's own resolution. FIT was drawing a
    // 1280x720 buffer and letting the browser upscale it, which is what made the art
    // look soft and blocky on a large display.
    pixelArt: false,
    antialias: true,
    roundPixels: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: '100%',
      height: '100%',
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 0 },
        // Toggle in the console: localStorage.blackoutDebug = '1'
        debug: Boolean(globalThis.localStorage?.getItem('blackoutDebug')),
      },
    },
    // Let the React overlay own the keyboard when a text field is focused.
    input: {
      keyboard: { capture: [] },
    },
    scene: [BootScene, MainLabScene, HUDScene],
  };
}

let activeGame = null;

/**
 * @param {HTMLElement|string} parent
 * @param {object} [opts]
 * @param {object} [opts.resume] Saved session row to restore into MainLabScene.
 * @returns {Phaser.Game}
 */
export function createGame(parent, { resume = null, levelId = null, difficulty = null, net = null } = {}) {
  if (activeGame) destroyGame();
  activeGame = new Phaser.Game(buildConfig(parent));
  activeGame.registry.set('resume', resume);
  activeGame.registry.set('levelId', resume?.levelId || levelId);
  activeGame.registry.set('difficulty', resume?.difficulty || difficulty);
  activeGame.registry.set('net', net);

  // Dev handle for the console: inspect scenes, force-step the loop, dump suspicion.
  if (import.meta.env?.DEV) {
    globalThis.__BLACKOUT__ = {
      game: activeGame,
      scene: () => activeGame.scene.getScene('MainLabScene'),
      /**
       * Advance N frames by hand (useful when rAF is throttled, e.g. a hidden tab).
       * Phaser zeroes delta while the window is blurred, so focus is forced on each
       * step - otherwise a manually driven frame advances nothing.
       */
      step(frames = 1) {
        const loop = activeGame.loop;
        for (let i = 0; i < frames; i++) {
          loop.inFocus = true;
          loop._coolDown = 0;
          // step() expects the rAF timestamp; omitting it makes delta NaN permanently.
          loop.step(performance.now());
        }
        return loop.frame;
      },
    };
  }
  return activeGame;
}

export function getGame() {
  return activeGame;
}

export function destroyGame() {
  if (!activeGame) return;
  const dying = activeGame;
  activeGame = null;
  dying.destroy(true);

  /*
   * Phaser's destroy() only *schedules* the teardown - the real work happens on the
   * instance's next step. If that step never comes, and it does not when the loop is
   * throttled (a hidden tab, a backgrounded window), the dead game keeps its
   * window-level keyboard listener. That listener still calls preventDefault, so
   * every key the *next* instance should have received arrives already handled and
   * Phaser drops it: exit to the title, start a new run, and the game is unplayable
   * with a keyboard that looks fine in every diagnostic.
   *
   * Running the teardown here makes it synchronous, which is what the caller assumed
   * it already was.
   */
  if (dying.pendingDestroy) {
    try {
      dying.runDestroy();
    } catch (err) {
      console.warn('[GameConfig] forced teardown failed', err);
    }
  }
}

/** Restart the run from scratch, keeping the same Phaser instance. */
export function restartGame() {
  if (!activeGame) return;
  activeGame.registry.set('resume', null);
  activeGame.scene.stop('HUDScene');
  activeGame.scene.stop('MainLabScene');
  activeGame.scene.start('BootScene');
}

export default { createGame, destroyGame, restartGame, getGame, buildConfig };
