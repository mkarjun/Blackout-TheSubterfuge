/**
 * Sfx.js - Procedural WebAudio effects. No audio files, no loading, no licences.
 *
 * The one thing here that is not procedural is the music, and it deliberately lives
 * elsewhere (systems/Music.js) - but it shares this module's AudioContext and routes
 * through the same master gain, so unlock, mute and volume cover both with no second
 * code path and no second context competing for the output device.
 *
 * The typewriter blip is the one that matters: it fires per character as speech
 * bubbles stream, so it must be allocation-light and must never queue up. Every
 * effect is a short oscillator + gain envelope that disconnects itself on stop.
 *
 * Browsers block audio until a user gesture, so the context stays suspended until
 * unlock() is called from the first keypress/click.
 */

let ctx = null;
let master = null;
let unlocked = false;
let muted = false;
let volume = 0.35;
let lastBlipAt = 0;

function ensureContext() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  return ctx;
}

/** Call from any real user gesture (keydown / pointerdown). Safe to call repeatedly. */
/** The shared context, so Music can decode into it. Null before the first unlock. */
export function getContext() {
  return ensureContext();
}

/**
 * The shared output bus. Everything muted by setMuted() is muted because it is
 * downstream of this node.
 */
export function getMaster() {
  ensureContext();
  return master;
}

export function unlock() {
  const c = ensureContext();
  if (!c) return false;
  if (c.state === 'suspended') c.resume().catch(() => {});
  unlocked = true;
  return true;
}

export function setMuted(value) {
  muted = Boolean(value);
  if (master) master.gain.value = muted ? 0 : volume;
}

export function isMuted() {
  return muted;
}

export function setVolume(value) {
  volume = Math.max(0, Math.min(1, value));
  if (master && !muted) master.gain.value = volume;
}

function tone({ freq = 440, dur = 0.08, type = 'square', gain = 0.2, sweepTo = null, delay = 0 }) {
  const c = ensureContext();
  if (!c || muted || !unlocked) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + dur);

  // Fast attack, exponential decay - a click-free envelope without a filter node.
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}

/**
 * Typewriter tick. Pitch varies slightly per speaker so overlapping bubbles read as
 * different voices. Rate-limited to 60ms so fast text does not become a buzz.
 */
export function blip(voice = 0) {
  const now = performance.now();
  if (now - lastBlipAt < 55) return;
  lastBlipAt = now;
  const base = 520 + (voice % 5) * 70;
  tone({ freq: base + Math.random() * 40, dur: 0.045, type: 'square', gain: 0.055 });
}

export const sfx = {
  unlock,
  setMuted,
  isMuted,
  setVolume,
  getContext,
  getMaster,
  blip,
  interact: () => tone({ freq: 660, dur: 0.09, type: 'triangle', gain: 0.16, sweepTo: 880 }),
  pickup: () => {
    tone({ freq: 620, dur: 0.07, type: 'triangle', gain: 0.16 });
    tone({ freq: 930, dur: 0.09, type: 'triangle', gain: 0.14, delay: 0.06 });
  },
  deny: () => tone({ freq: 190, dur: 0.16, type: 'sawtooth', gain: 0.14, sweepTo: 90 }),
  powerDown: () => {
    tone({ freq: 340, dur: 0.7, type: 'sawtooth', gain: 0.2, sweepTo: 42 });
    tone({ freq: 170, dur: 0.9, type: 'sine', gain: 0.16, sweepTo: 30 });
  },
  powerUp: () => tone({ freq: 90, dur: 0.5, type: 'sawtooth', gain: 0.16, sweepTo: 420 }),
  alarm: () => {
    for (let i = 0; i < 3; i++) {
      tone({ freq: 880, dur: 0.16, type: 'square', gain: 0.13, delay: i * 0.34 });
      tone({ freq: 660, dur: 0.16, type: 'square', gain: 0.13, delay: i * 0.34 + 0.17 });
    }
  },
  suspicionUp: () => tone({ freq: 300, dur: 0.12, type: 'triangle', gain: 0.11, sweepTo: 420 }),
  sabotage: () => {
    tone({ freq: 140, dur: 0.4, type: 'sawtooth', gain: 0.2, sweepTo: 60 });
    tone({ freq: 900, dur: 0.12, type: 'square', gain: 0.1, delay: 0.3 });
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'triangle', gain: 0.17, delay: i * 0.13 })),
  lose: () => [440, 349, 262, 175].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'sawtooth', gain: 0.17, delay: i * 0.18 })),
};

export default sfx;
