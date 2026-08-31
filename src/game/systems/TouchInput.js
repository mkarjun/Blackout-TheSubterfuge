/**
 * TouchInput.js - the virtual gamepad, as far as the simulation is concerned.
 *
 * The React overlay writes here; Player and MainLabScene read it where they read the
 * keyboard. With no finger on the glass every read returns neutral, so the desktop
 * path is unchanged.
 *
 * Two details matter:
 *   - The stick is analog. It reports a vector, not four booleans, so magnitude can
 *     scale speed and a phone player gets a slow creep with no modifier key.
 *   - Buttons are edge-triggered and consumed, mirroring Phaser's JustDown contract
 *     (first reader wins). The engine depends on it: while a sabotage channels, the
 *     Player is disabled and never polls, which is how the same press aborts the job
 *     rather than restarting it.
 */

/** A press older than this was aimed at a frame that never came. Drop it. */
const EDGE_TTL_MS = 400;

/** Thumb wobble below this is not an input. */
const DEAD_ZONE = 0.16;

const state = {
  x: 0,
  y: 0,
  sneak: false,
  active: false,
  edges: new Map(),
};

/** True once anything has actually touched the controls this session. */
export function isActive() {
  return state.active;
}

export function setActive(value) {
  state.active = Boolean(value);
  if (!state.active) reset();
}

/**
 * @param {number} x -1..1
 * @param {number} y -1..1 (screen space: positive is down)
 */
export function setAxis(x, y) {
  state.x = x;
  state.y = y;
}

/** @returns {{x: number, y: number, magnitude: number}} zeroed inside the dead zone */
export function axis() {
  const m = Math.hypot(state.x, state.y);
  if (m < DEAD_ZONE) return { x: 0, y: 0, magnitude: 0 };
  // Rescale so the first millimetre past the dead zone is a crawl rather than a jump.
  const scaled = Math.min(1, (m - DEAD_ZONE) / (1 - DEAD_ZONE));
  return { x: (state.x / m) * scaled, y: (state.y / m) * scaled, magnitude: scaled };
}

export function setSneak(value) {
  state.sneak = Boolean(value);
}

export function isSneaking() {
  return state.sneak;
}

/** Raise an edge for one of: interact, plant, hack, talk. */
export function press(action) {
  state.edges.set(action, performance.now());
}

/** Consume an edge. Mirrors Phaser.Input.Keyboard.JustDown - the first reader wins. */
export function justDown(action) {
  const at = state.edges.get(action);
  if (at === undefined) return false;
  state.edges.delete(action);
  return performance.now() - at < EDGE_TTL_MS;
}

export function reset() {
  state.x = 0;
  state.y = 0;
  state.sneak = false;
  state.edges.clear();
}

export const touch = {
  isActive, setActive, setAxis, axis, setSneak, isSneaking, press, justDown, reset,
};

export default touch;
