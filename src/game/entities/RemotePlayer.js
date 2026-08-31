import Phaser from 'phaser';
import { TILE_SIZE } from '../../assets/tilemaps/labMap.js';

/**
 * RemotePlayer - another human, drawn from the network rather than simulated.
 *
 * No physics body: a remote player is a *report*, not a simulation. Giving it one
 * would mean two machines both deciding where it is, and they would disagree within
 * seconds. It interpolates toward the last reported position instead, which hides
 * jitter and makes a dropped packet look like a pause rather than a teleport.
 *
 * Snapping (rather than easing) past SNAP_DISTANCE keeps a genuinely late update from
 * showing a rival gliding through walls.
 */

const LERP = 0.22;
const SNAP_DISTANCE = TILE_SIZE * 4;

export class RemotePlayer extends Phaser.GameObjects.Container {
  constructor(scene, { id, name, color }) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(11);

    this.playerId = id;
    this.playerName = name;
    this.tint = color;

    this.body2d = scene.add.image(0, 0, 'actor').setTint(color);
    this.faceMark = scene.add.image(0, 0, 'facemark').setTint(color).setAlpha(0.8);
    this.label = scene.add.text(0, -40, name, {
      fontFamily: 'Consolas, monospace',
      fontSize: '13px',
      color: '#dbe6f2',
    }).setOrigin(0.5, 1);

    this.add([this.body2d, this.faceMark, this.label]);

    this.target = { x: 0, y: 0, f: 0 };
    this.sneaking = false;
    this.escaped = false;
    this._seen = 0;
  }

  /** Fold in one authoritative report. */
  apply({ x, y, f, sn, out }) {
    this.target.x = x;
    this.target.y = y;
    this.target.f = f ?? this.target.f;
    this.sneaking = Boolean(sn);
    this.escaped = Boolean(out);
    this._seen = this.scene ? this.scene.time.now : 0;

    if (Phaser.Math.Distance.Between(this.x, this.y, x, y) > SNAP_DISTANCE) {
      this.setPosition(x, y);
    }
  }

  update() {
    this.x = Phaser.Math.Linear(this.x, this.target.x, LERP);
    this.y = Phaser.Math.Linear(this.y, this.target.y, LERP);

    this.faceMark.setPosition(Math.cos(this.target.f) * 20, Math.sin(this.target.f) * 20);
    // Sneaking rivals are harder to read, exactly as they are for the NPCs.
    this.body2d.setAlpha(this.escaped ? 0.25 : this.sneaking ? 0.55 : 1);
    this.label.setAlpha(this.escaped ? 0.3 : 0.85);
  }

  destroy(fromScene) {
    super.destroy(fromScene);
  }
}

export default RemotePlayer;
