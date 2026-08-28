/**
 * SpeechBubble.js - Overhead streaming speech with a typewriter reveal.
 *
 * One bubble per NPC, created once and reused, because allocating a Text object per
 * line is the classic way to make a Phaser scene stutter. The bubble redraws its
 * background only when the wrapped line count changes, not per character.
 *
 * A bubble in THINKING mode shows an animated ellipsis: that is the visible tell that
 * the Cognitive Layer is working while the body keeps acting locally.
 */

import Phaser from 'phaser';
import sfx from '../systems/Sfx.js';

const EMOTION_STYLE = {
  NEUTRAL: { bg: 0x0c1119, border: 0x38f2c4, text: '#dbe6f2' },
  SUSPICIOUS: { bg: 0x1a1408, border: 0xffc14d, text: '#ffe9b8' },
  ALARMED: { bg: 0x1c0d10, border: 0xff8a5c, text: '#ffd9c9' },
  COOPERATIVE: { bg: 0x081a15, border: 0x4ade80, text: '#c8f6dd' },
  HOSTILE: { bg: 0x1e0a0e, border: 0xff4d5e, text: '#ffd0d5' },
  THINKING: { bg: 0x0b0f18, border: 0x475569, text: '#8fa1b8' },
};

export class SpeechBubble {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} [opts]
   * @param {number} [opts.maxWidth=190] Wrap width in pixels.
   * @param {number} [opts.voice=0]      Blip pitch index, per speaker.
   */
  constructor(scene, { maxWidth = 250, depth = 40, voice = 0 } = {}) {
    this.scene = scene;
    this.maxWidth = maxWidth;
    this.voice = voice;

    this.container = scene.add.container(0, 0);
    this.container.setDepth(depth);
    this.container.setVisible(false);

    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, '', {
      fontFamily: 'Consolas, "JetBrains Mono", monospace',
      fontSize: '14px',
      color: '#dbe6f2',
      wordWrap: { width: maxWidth },
      align: 'left',
    });
    this.text.setOrigin(0.5, 1);

    this.container.add([this.bg, this.text]);

    this.fullText = '';
    this.visibleChars = 0;
    this.charTimer = 0;
    this.charIntervalMs = 26;
    this.holdUntil = 0;
    this.mode = 'idle';           // idle | typing | holding | thinking
    this.style = EMOTION_STYLE.NEUTRAL;
    this._lastRenderedHeight = -1;
    this._lastRenderedWidth = -1;
    this._thinkPhase = 0;
  }

  get isBusy() {
    return this.mode === 'typing' || this.mode === 'holding';
  }

  /**
   * Start streaming a line.
   * @param {string} line
   * @param {object} [opts]
   * @param {string} [opts.emotion='NEUTRAL']
   * @param {number} [opts.holdMs]  Time on screen after the last character.
   */
  say(line, { emotion = 'NEUTRAL', holdMs = null, cps = 38 } = {}) {
    this.fullText = String(line || '').trim();
    if (!this.fullText) return this.hide();

    this.style = EMOTION_STYLE[emotion] || EMOTION_STYLE.NEUTRAL;
    this.visibleChars = 0;
    this.charTimer = 0;
    this.charIntervalMs = 1000 / cps;
    this.mode = 'typing';
    // Long lines need proportionally longer on screen to be readable.
    this._holdMs = holdMs ?? Math.min(6200, 1600 + this.fullText.length * 42);

    this.text.setColor(this.style.text);
    this.text.setText('');
    this.container.setVisible(true);
    return this;
  }

  /** Show the "cognition in flight" ellipsis. Superseded by the next say(). */
  think() {
    if (this.mode === 'typing' || this.mode === 'holding') return this;
    this.style = EMOTION_STYLE.THINKING;
    this.mode = 'thinking';
    this.fullText = '';
    this.text.setColor(this.style.text);
    this.text.setText('. . .');
    this.container.setVisible(true);
    return this;
  }

  hide() {
    this.mode = 'idle';
    this.fullText = '';
    this.visibleChars = 0;
    this.container.setVisible(false);
    return this;
  }

  /** Skip the animation to the final frame (used when the player walks away). */
  finish() {
    if (this.mode !== 'typing') return;
    this.visibleChars = this.fullText.length;
    this.text.setText(this.fullText);
    this.mode = 'holding';
    this.holdUntil = this.scene.time.now + this._holdMs;
    this._redrawBackground();
  }

  /**
   * @param {number} time  scene.time.now
   * @param {number} delta ms since last frame
   * @param {number} x     Owner world x
   * @param {number} y     Owner world y (top of head)
   */
  update(time, delta, x, y) {
    if (this.mode === 'idle') return;

    this.container.setPosition(Math.round(x), Math.round(y));

    if (this.mode === 'thinking') {
      // Three dots cycling at ~3Hz.
      this._thinkPhase += delta;
      const dots = 1 + Math.floor(this._thinkPhase / 320) % 3;
      const next = '. '.repeat(dots).trim();
      if (this.text.text !== next) {
        this.text.setText(next);
        this._redrawBackground();
      }
      return;
    }

    if (this.mode === 'typing') {
      this.charTimer += delta;
      let advanced = false;
      while (this.charTimer >= this.charIntervalMs && this.visibleChars < this.fullText.length) {
        this.charTimer -= this.charIntervalMs;
        this.visibleChars++;
        advanced = true;
      }
      if (advanced) {
        const shown = this.fullText.slice(0, this.visibleChars);
        this.text.setText(shown);
        const lastChar = shown[shown.length - 1];
        if (lastChar && lastChar !== ' ') sfx.blip(this.voice);
        this._redrawBackground();
      }
      if (this.visibleChars >= this.fullText.length) {
        this.mode = 'holding';
        this.holdUntil = time + this._holdMs;
      }
      return;
    }

    if (this.mode === 'holding' && time >= this.holdUntil) {
      this.hide();
    }
  }

  /** Only repaints when the text box actually changed size. */
  _redrawBackground() {
    const w = Math.ceil(this.text.width) + 14;
    const h = Math.ceil(this.text.height) + 10;
    if (w === this._lastRenderedWidth && h === this._lastRenderedHeight) return;
    this._lastRenderedWidth = w;
    this._lastRenderedHeight = h;

    const g = this.bg;
    g.clear();
    g.fillStyle(this.style.bg, 0.92);
    g.lineStyle(1, this.style.border, 0.9);
    g.fillRoundedRect(-w / 2, -h - 5, w, h, 5);
    g.strokeRoundedRect(-w / 2, -h - 5, w, h, 5);
    // Tail
    g.fillStyle(this.style.border, 0.9);
    g.fillTriangle(-4, -5, 4, -5, 0, 1);
  }

  setVoice(index) {
    this.voice = index;
  }

  destroy() {
    this.container.destroy(true);
    this.scene = null;
  }
}

export default SpeechBubble;
