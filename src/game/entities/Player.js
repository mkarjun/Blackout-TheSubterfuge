/**
 * Player.js - The infiltrator.
 *
 * Movement and input only. Every world-changing action (interact, plant, hack) is
 * raised as a callback so MainLabScene owns the rules and the Player stays a
 * controller. Noise is modelled here because it is a function of *how* you move:
 * running broadcasts a point of interest that NPCs can path to, sneaking does not.
 */

import Phaser from 'phaser';
import { TILE_SIZE } from '../../assets/tilemaps/labMap.js';

export const PLAYER_SPEED = {
  WALK: 198,
  SNEAK: 102,
};

/** Sideways slide applied when you walk into a door frame instead of the opening. */
const CORNER_NUDGE = 70;

/** How far a footstep carries, per movement mode. */
export const NOISE_RADIUS = {
  SNEAK: 0,
  WALK: 285,
};

export class Player extends Phaser.Physics.Arcade.Sprite {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x world px
   * @param {number} y world px
   * @param {object} handlers { onInteract, onPlant, onHack, onTalk, onNoise }
   */
  constructor(scene, x, y, handlers = {}) {
    super(scene, x, y, 'actor');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setTint(0xe2e8f0);
    this.setDepth(12);
    // Body sits at the feet of the 36x44 frame, not its centre.
    this.body.setSize(26, 26);
    this.body.setOffset(5, 16);
    this.setCollideWorldBounds(true);

    this.handlers = handlers;
    this.sneaking = false;
    this.facing = -Math.PI / 2;
    this.noiseTimer = 0;
    this.disabled = false;

    const kb = scene.input.keyboard;
    this.keys = kb.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      interact: Phaser.Input.Keyboard.KeyCodes.E,
      plant: Phaser.Input.Keyboard.KeyCodes.F,
      hack: Phaser.Input.Keyboard.KeyCodes.H,
      talk: Phaser.Input.Keyboard.KeyCodes.SPACE,
      sneak: Phaser.Input.Keyboard.KeyCodes.SHIFT,
    });
    this.cursors = kb.createCursorKeys();

    // A dim marker showing which way the body is turned - readable in a blackout.
    this.faceMark = scene.add.image(x, y, 'facemark');
    this.faceMark.setTint(0x38f2c4).setDepth(13).setAlpha(0.85);
  }

  get tileX() { return Math.floor(this.x / TILE_SIZE); }
  get tileY() { return Math.floor(this.y / TILE_SIZE); }

  /** Detection multiplier applied to NPC vision range. Sneaking is genuinely stealthier. */
  get visibilityScale() {
    return this.sneaking ? 0.62 : 1;
  }

  setDisabled(value) {
    this.disabled = value;
    if (value) {
      this.setVelocity(0, 0);
    }
  }

  update(time, delta) {
    if (this.disabled) {
      this.setVelocity(0, 0);
      this._syncFaceMark();
      return;
    }

    const k = this.keys;
    const c = this.cursors;
    const left = k.left.isDown || c.left.isDown;
    const right = k.right.isDown || c.right.isDown;
    const up = k.up.isDown || c.up.isDown;
    const down = k.down.isDown || c.down.isDown;

    this.sneaking = k.sneak.isDown;
    const speed = this.sneaking ? PLAYER_SPEED.SNEAK : PLAYER_SPEED.WALK;

    let vx = (right ? 1 : 0) - (left ? 1 : 0);
    let vy = (down ? 1 : 0) - (up ? 1 : 0);

    if (vx || vy) {
      const len = Math.hypot(vx, vy);
      vx = (vx / len) * speed;
      vy = (vy / len) * speed;
      this.facing = Math.atan2(vy, vx);
      this._emitNoise(delta);
    } else {
      this.noiseTimer = 0;
    }
    this.setVelocity(vx, vy);
    this._cornerCorrect(vx, vy);

    // Subtle bob while moving so the sprite reads as alive without an animation sheet.
    this.setScale(1, (vx || vy) ? 1 + Math.sin(time / 90) * 0.035 : 1);
    this._syncFaceMark();

    this._pollActions();
  }

  /**
   * Corner correction. Walking straight at a doorway while slightly off-centre used to
   * stop you dead against the frame, which reads as a collision bug rather than as your
   * own aim. If exactly one of the two tiles flanking your direction of travel is open,
   * nudge toward it so you slide into the gap.
   */
  _cornerCorrect(vx, vy) {
    const pf = this.scene.pathfinder;
    if (!pf) return;
    const tx = this.tileX;
    const ty = this.tileY;

    if (vy !== 0 && vx === 0 && this.body.blocked[vy > 0 ? 'down' : 'up']) {
      const ny = vy > 0 ? ty + 1 : ty - 1;
      const left = pf.isWalkable(tx - 1, ny);
      const right = pf.isWalkable(tx + 1, ny);
      if (left !== right) this.setVelocityX(left ? -CORNER_NUDGE : CORNER_NUDGE);
    } else if (vx !== 0 && vy === 0 && this.body.blocked[vx > 0 ? 'right' : 'left']) {
      const nx = vx > 0 ? tx + 1 : tx - 1;
      const up = pf.isWalkable(nx, ty - 1);
      const down = pf.isWalkable(nx, ty + 1);
      if (up !== down) this.setVelocityY(up ? -CORNER_NUDGE : CORNER_NUDGE);
    }
  }

  _syncFaceMark() {
    this.faceMark.setPosition(
      this.x + Math.cos(this.facing) * 20,
      this.y + Math.sin(this.facing) * 20,
    );
  }

  /** Walking leaks a periodic point of interest; sneaking leaks nothing. */
  _emitNoise(delta) {
    const radius = this.sneaking ? NOISE_RADIUS.SNEAK : NOISE_RADIUS.WALK;
    if (!radius) return;
    this.noiseTimer += delta;
    if (this.noiseTimer < 620) return;
    this.noiseTimer = 0;
    this.handlers.onNoise?.({ x: this.x, y: this.y, radius, source: 'FOOTSTEP' });
  }

  _pollActions() {
    const k = this.keys;
    if (Phaser.Input.Keyboard.JustDown(k.interact)) this.handlers.onInteract?.();
    if (Phaser.Input.Keyboard.JustDown(k.plant)) this.handlers.onPlant?.();
    if (Phaser.Input.Keyboard.JustDown(k.hack)) this.handlers.onHack?.();
    if (Phaser.Input.Keyboard.JustDown(k.talk)) this.handlers.onTalk?.();
  }

  destroy(fromScene) {
    this.faceMark?.destroy();
    super.destroy(fromScene);
  }
}

export default Player;
