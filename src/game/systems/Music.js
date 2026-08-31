/**
 * Music.js - one looping ambient bed, for the duration of a run and nothing outside
 * one. The title screen stays silent.
 *
 * WebAudio rather than `<audio loop>`: an MP3 cannot loop gaplessly through an audio
 * element, because the encoder's delay and padding frames land on the seam and tick
 * every pass. An AudioBufferSourceNode loops at sample accuracy and lets
 * loopStart/loopEnd sit *inside* the decoded audio, past whatever padding the decoder
 * did or did not strip.
 *
 * The asset is one 133.3-second period cut from a much longer recording, the period
 * measured by autocorrelation rather than guessed, so the seam is inaudible. It is
 * encoded with 0.3s of lead-in and 0.4s of tail as margin for that padding, which is
 * why the file is slightly longer than the loop inside it.
 *
 * Shares Sfx's AudioContext and master gain, so mute and volume cover music for free.
 */

import { getContext, getMaster, unlock as unlockSfx } from './Sfx.js';
import eventManager, { EVENTS } from './EventManager.js';

const SRC = `${import.meta.env?.BASE_URL || '/'}audio/blackout-theme.mp3`;

/** Loop window inside the decoded buffer, in seconds. See the note above. */
const LOOP_START = 0.30;
const LOOP_LENGTH = 133.3;
const LOOP_END = LOOP_START + LOOP_LENGTH;

/** Bed level. Sits under the effects rather than alongside them. */
const LEVEL = 0.55;
/** How far the bed drops while someone is talking to you. */
const DUCK = 0.34;

const FADE_IN = 2.4;
const FADE_OUT = 0.9;
const DUCK_TIME = 0.35;

let buffer = null;
let loading = null;
let source = null;
let gain = null;
let playing = false;
let ducked = false;
let unsubs = [];

/** Fetch and decode once, then hold the buffer for the rest of the session. */
function load() {
  if (buffer) return Promise.resolve(buffer);
  if (loading) return loading;

  loading = fetch(SRC)
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.arrayBuffer();
    })
    .then((bytes) => {
      const ctx = getContext();
      if (!ctx) throw new Error('no AudioContext');
      // The callback form is used because Safari still ships the pre-promise
      // signature, and it is the one both understand.
      return new Promise((resolve, reject) => {
        ctx.decodeAudioData(bytes, resolve, reject);
      });
    })
    .then((decoded) => {
      buffer = decoded;
      return decoded;
    })
    .catch((err) => {
      // Music is not load-bearing. A failed fetch or an unsupported decode leaves
      // the game entirely playable, so this warns and gives up rather than throwing
      // into the phase transition that called it.
      console.warn('[Music] could not load the score', err);
      loading = null;
      return null;
    });

  return loading;
}

/** Warm the cache while someone is reading the landing page. */
export function preload() {
  // Without a gesture there is no context yet, so decoding has to wait; the bytes
  // do not, and they are the slow half.
  if (buffer || loading) return;
  if (getContext()) load();
}

export function unlock() {
  unlockSfx();
}

/** Begin the bed, fading up from silence. Safe to call when already playing. */
export async function start() {
  if (playing) return;
  playing = true;

  unlockSfx();
  const ctx = getContext();
  if (!ctx) { playing = false; return; }

  const decoded = await load();
  // A stop() may have landed while the fetch was in flight.
  if (!decoded || !playing) return;

  const master = getMaster();
  gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(LEVEL, ctx.currentTime + FADE_IN);
  gain.connect(master);

  source = ctx.createBufferSource();
  source.buffer = decoded;
  source.loop = true;
  // Clamp to what actually decoded, so a short buffer degrades to a plain loop
  // rather than to silence.
  source.loopStart = LOOP_START;
  source.loopEnd = Math.min(LOOP_END, decoded.duration);
  source.connect(gain);
  source.start(0, LOOP_START);

  listen();
}

/** Fade out and release the source. */
export function stop() {
  playing = false;
  ducked = false;
  unlisten();

  const ctx = getContext();
  const node = source;
  const g = gain;
  source = null;
  gain = null;
  if (!ctx || !node || !g) return;

  const end = ctx.currentTime + FADE_OUT;
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  try { node.stop(end + 0.05); } catch { /* already stopped */ }
  node.onended = () => { node.disconnect(); g.disconnect(); };
}

/** Drop under a conversation, and come back up after it. */
function setDucked(value) {
  if (ducked === value) return;
  ducked = value;
  const ctx = getContext();
  if (!ctx || !gain) return;
  const target = value ? LEVEL * DUCK : LEVEL;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(target, ctx.currentTime + DUCK_TIME);
}

function listen() {
  unlisten();
  unsubs = [
    eventManager.on(EVENTS.DIALOGUE_OPEN, () => setDucked(true)),
    eventManager.on(EVENTS.DIALOGUE_CLOSE, () => setDucked(false)),
    // The win and lose stings need the room to themselves.
    eventManager.on(EVENTS.GAME_OVER, (result) => { if (result) setDucked(true); }),
    eventManager.on(EVENTS.GAME_PAUSED, (isPaused) => setDucked(Boolean(isPaused))),
  ];
}

function unlisten() {
  unsubs.forEach((off) => off());
  unsubs = [];
}

export function dispose() {
  stop();
  buffer = null;
  loading = null;
}

export const music = { preload, unlock, start, stop, dispose };
export default music;
