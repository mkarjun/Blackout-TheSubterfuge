/**
 * HUDScene.js - Canvas-space overlay that must stay glued to the game.
 *
 * The split with the React overlay is deliberate: anything the player reads *while
 * their hands are on WASD* lives here (interaction prompt, channel progress, alert
 * vignette), because it has to be frame-accurate and camera-fixed. Anything they read
 * while stopped - event feed, suspicion table, settings - is React, where text layout
 * and scrolling are free.
 */

import Phaser from 'phaser';
import eventManager, { EVENTS } from '../systems/EventManager.js';
import touchInput from '../systems/TouchInput.js';

/**
 * Keyboard key -> the on-screen button that does the same job. The prompt has to
 * name something the player can actually see; "[E]" on a phone names nothing.
 */
const TOUCH_LABEL = { E: 'USE', SPACE: 'TALK', F: 'PLANT', H: 'LIGHTS' };

export class HUDScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HUDScene', active: false });
  }

  create() {
    const { width, height } = this.scale;

    this.vignette = this.add.graphics().setDepth(1);
    this.flicker = this.add.rectangle(width / 2, height / 2, width, height, 0x000010, 0)
      .setDepth(2);

    this.promptBg = this.add.graphics().setDepth(3);
    this.promptText = this.add.text(width / 2, height - 68, '', {
      fontFamily: 'Consolas, monospace',
      fontSize: '14px',
      color: '#dbe6f2',
      align: 'center',
    }).setOrigin(0.5).setDepth(4);

    this.progressBg = this.add.graphics().setDepth(3);
    this.progressFill = this.add.graphics().setDepth(4);

    this.stateText = this.add.text(width / 2, height - 44, '', {
      fontFamily: 'Consolas, monospace',
      fontSize: '11px',
      color: '#7b8798',
    }).setOrigin(0.5).setDepth(4);

    this.alertLevel = 0;
    this.channel = null;

    // RESIZE scale mode: every fixed position here has to be recomputed on resize.
    this._onResize = () => this._layout();
    this.scale.on('resize', this._onResize);

    this._unsubs = [
      eventManager.on(EVENTS.INTERACT_PROMPT, (p) => this._setPrompt(p), { replay: true }),
      eventManager.on(EVENTS.ALERT_CHANGED, ({ level }) => this._setAlert(level)),
      eventManager.on(EVENTS.LIGHTS_CHANGED, (on) => this._onLights(on)),
      eventManager.on(EVENTS.GAME_TICK, (t) => this._onTick(t)),
      eventManager.on(EVENTS.GAME_OVER, () => this._setPrompt(null)),
    ];

    this.events.once('shutdown', () => {
      this._unsubs.forEach((off) => off());
      this.scale.off('resize', this._onResize);
    });
    this._layout();
  }

  /** Re-anchor the fixed HUD furniture to the current viewport. */
  _layout() {
    const { width, height } = this.scale;
    this.flicker.setPosition(width / 2, height / 2).setSize(width, height);
    this.promptText.setPosition(width / 2, height - 68);
    this.stateText.setPosition(width / 2, height - 44);
    this._drawVignette();
    this._drawProgress();
    if (this._lastPrompt) this._setPrompt(this._lastPrompt);
  }

  _setPrompt(payload) {
    this._lastPrompt = payload;
    if (!payload) {
      this.promptText.setText('');
      this.promptBg.clear();
      return;
    }
    const key = payload.key
      ? (touchInput.isActive() ? TOUCH_LABEL[payload.key] || payload.key : payload.key)
      : null;
    // "(E to abort)" is baked into the scene's own label text, so swap that too.
    const body = touchInput.isActive()
      ? String(payload.label).replace(/\(E to abort\)/i, '(tap Use to abort)')
      : payload.label;
    this.promptText.setText(key ? `[${key}]  ${body}` : body);

    const w = this.promptText.width + 22;
    const h = 26;
    const x = this.scale.width / 2 - w / 2;
    const y = this.promptText.y - h / 2;

    this.promptBg.clear();
    this.promptBg.fillStyle(0x0c1119, 0.85);
    this.promptBg.lineStyle(1, 0x38f2c4, 0.55);
    this.promptBg.fillRoundedRect(x, y, w, h, 5);
    this.promptBg.strokeRoundedRect(x, y, w, h, 5);
  }

  _onTick(tick) {
    this.channel = tick.channel;
    this._drawProgress();

    const bits = [];
    if (tick.sneaking) bits.push('SNEAKING');
    if (!tick.lightsOn) bits.push('DARK');
    if (tick.hackReadyIn > 0) bits.push(`BYPASS ${tick.hackReadyIn}s`);
    if (tick.lockdown) bits.push('LOCKDOWN');
    this.stateText.setText(bits.join('   '));
    this.stateText.setColor(tick.lockdown ? '#ff4d5e' : '#7b8798');

    if (tick.alertLevel !== this.alertLevel) this._setAlert(tick.alertLevel);
  }

  _drawProgress() {
    this.progressBg.clear();
    this.progressFill.clear();
    if (!this.channel) return;

    const w = 220;
    const h = 6;
    const x = this.scale.width / 2 - w / 2;
    const y = this.scale.height - 48;

    this.progressBg.fillStyle(0x1c2534, 0.9);
    this.progressBg.fillRoundedRect(x, y, w, h, 3);
    this.progressFill.fillStyle(0x38f2c4, 1);
    this.progressFill.fillRoundedRect(x, y, Math.max(4, w * this.channel.progress), h, 3);
  }

  _setAlert(level) {
    this.alertLevel = level;
    this._drawVignette();
    if (level >= 2) {
      // Colour first: setFillStyle() resets fillAlpha, which would fight the tween.
      this.flicker.setFillStyle(0xff4d5e, 0);
      this.tweens.add({
        targets: this.flicker,
        fillAlpha: { from: 0.28, to: 0 },
        duration: 420,
        repeat: 2,
      });
    }
  }

  /** Screen-edge tint that darkens and reddens as the facility turns against you. */
  _drawVignette() {
    const { width, height } = this.scale;
    const g = this.vignette;
    g.clear();

    const color = this.alertLevel >= 3 ? 0xff2d44 : this.alertLevel === 2 ? 0xff4d5e : this.alertLevel === 1 ? 0xffc14d : 0x38f2c4;
    const strength = this.alertLevel >= 3 ? 0.3 : this.alertLevel === 2 ? 0.2 : this.alertLevel === 1 ? 0.1 : 0.05;

    const band = 46;
    for (let i = 0; i < band; i += 2) {
      const a = strength * (1 - i / band);
      g.fillStyle(color, a * 0.5);
      g.fillRect(0, i, width, 2);
      g.fillRect(0, height - i - 2, width, 2);
      g.fillRect(i, 0, 2, height);
      g.fillRect(width - i - 2, 0, 2, height);
    }
  }

  _onLights(on) {
    if (on) return;
    this.flicker.setFillStyle(0x000010, 0);
    this.tweens.add({
      targets: this.flicker,
      fillAlpha: { from: 0.55, to: 0.12 },
      duration: 700,
      ease: 'Sine.easeOut',
    });
    this.time.delayedCall(900, () => { this.flicker.fillAlpha = 0; });
  }
}

export default HUDScene;
