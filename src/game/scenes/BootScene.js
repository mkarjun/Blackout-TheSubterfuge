/**
 * BootScene.js - Procedural asset generation.
 *
 * Every texture in the game is drawn here at boot: the tileset, the actor sprite, the
 * prop chip, the light pool. That means zero binary assets, zero load screens, and a
 * repo you can read end to end.
 *
 * Art is authored at TILE_SIZE (48px) so it renders close to 1:1 on screen at the
 * camera's default zoom - textures drawn smaller than their on-screen size are exactly
 * what "low graphics" looks like. Shading is painted in black over white shapes so the
 * per-character tint (which multiplies) keeps its contrast.
 *
 * Also runs the tilemap connectivity assertion in dev. A sealed room is a bug that
 * only shows up ten minutes into a playthrough, so it gets caught at boot instead.
 */

import Phaser from 'phaser';
import { TILE_SIZE, T, validateAllLevels } from '../../assets/tilemaps/labMap.js';

/** Per-tile palette. Room floors differ so the map reads without labels. */
const TILE_PAINT = {
  [T.WALL]: { base: '#161d29', edge: '#2b374a', accent: '#3d4c64', kind: 'wall' },
  [T.FLOOR]: { base: '#0f1622', edge: '#1b2635', accent: '#243043', kind: 'floor' },
  [T.FLOOR_CTRL]: { base: '#101c28', edge: '#1d2f40', accent: '#2b4459', kind: 'floor' },
  [T.FLOOR_LAB]: { base: '#0e1d1c', edge: '#193332', accent: '#245049', kind: 'floor' },
  [T.FLOOR_VAULT]: { base: '#171423', edge: '#282139', accent: '#3b3057', kind: 'floor' },
  [T.FLOOR_GEN]: { base: '#1c1811', edge: '#312a1a', accent: '#4a3c22', kind: 'floor' },
  [T.FLOOR_ATRIUM]: { base: '#111a14', edge: '#1e2d22', accent: '#2c4433', kind: 'floor' },
  [T.FLOOR_SEC]: { base: '#1f1216', edge: '#361f25', accent: '#4d2c34', kind: 'floor' },
  [T.DOOR]: { base: '#101822', edge: '#38f2c4', accent: '#1d3b3a', kind: 'door' },
  [T.GLASS]: { base: '#0f1f26', edge: '#5eead4', accent: '#8ff3e2', kind: 'glass' },
  [T.CRATE]: { base: '#291e14', edge: '#54401f', accent: '#7a5c2c', kind: 'crate' },
};

const TILE_COUNT = Object.keys(TILE_PAINT).length;

const ACTOR_W = 36;
const ACTOR_H = 44;

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create() {
    this._buildTileset();
    this._buildActor();
    this._buildProp();
    this._buildFaceMark();
    this._buildDot();
    this._buildLightPool();

    if (import.meta.env?.DEV) {
      for (const report of validateAllLevels()) {
        if (!report.ok) {
          console.error(`[BootScene] LEVEL ${report.id} FAILED VALIDATION -`, report.unreachable);
        } else {
          console.info(`[BootScene] level ${report.id} ok - ${report.reachedTiles} reachable tiles`);
        }
      }
    }

    // createGame() stashes the menu selection and any resumable session in the registry.
    this.scene.start('MainLabScene', {
      resume: this.registry.get('resume'),
      levelId: this.registry.get('levelId'),
      difficulty: this.registry.get('difficulty'),
    });
    this.scene.launch('HUDScene');
  }

  /* ------------------------------------------------------------ tileset */

  _buildTileset() {
    if (this.textures.exists('tiles')) return;
    const S = TILE_SIZE;
    const canvas = this.textures.createCanvas('tiles', S * TILE_COUNT, S);
    const ctx = canvas.getContext();

    for (let index = 0; index < TILE_COUNT; index++) {
      const paint = TILE_PAINT[index];
      const ox = index * S;

      ctx.save();
      ctx.translate(ox, 0);
      ctx.fillStyle = paint.base;
      ctx.fillRect(0, 0, S, S);

      switch (paint.kind) {
        case 'wall': this._paintWall(ctx, S, paint); break;
        case 'floor': this._paintFloor(ctx, S, paint); break;
        case 'door': this._paintDoor(ctx, S, paint); break;
        case 'glass': this._paintGlass(ctx, S, paint); break;
        case 'crate': this._paintCrate(ctx, S, paint); break;
        default: break;
      }
      ctx.restore();
    }

    canvas.refresh();
  }

  /** Panelled bulkhead: lit top face, recessed centre panel, rivets, floor shadow. */
  _paintWall(ctx, S, paint) {
    const grad = ctx.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, paint.edge);
    grad.addColorStop(0.35, paint.base);
    grad.addColorStop(1, '#0b0f16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);

    // Lit cap along the top edge.
    ctx.fillStyle = paint.accent;
    ctx.fillRect(0, 0, S, 3);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 3, S, 1);
    ctx.globalAlpha = 1;

    // Recessed panel.
    ctx.strokeStyle = '#0c111a';
    ctx.lineWidth = 2;
    ctx.strokeRect(7, 9, S - 14, S - 18);
    ctx.strokeStyle = paint.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 10, S - 16, S - 20);

    // Rivets.
    ctx.fillStyle = paint.accent;
    for (const [x, y] of [[4, 8], [S - 5, 8], [4, S - 9], [S - 5, S - 9]]) {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Contact shadow so walls sit on the floor rather than float.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, S - 3, S, 3);
  }

  /** Plated floor: grout lines, a lighter inset plate, wear speckle. */
  _paintFloor(ctx, S, paint) {
    ctx.fillStyle = paint.edge;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(3, 3, S - 6, S - 6);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = paint.accent;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
    ctx.globalAlpha = 0.28;
    ctx.strokeRect(6.5, 6.5, S - 13, S - 13);
    ctx.globalAlpha = 1;

    // Corner ticks give the grid a machined feel at this size.
    ctx.fillStyle = paint.accent;
    ctx.globalAlpha = 0.55;
    for (const [x, y, w, h] of [[0, 0, 5, 1], [0, 0, 1, 5], [S - 5, S - 1, 5, 1], [S - 1, S - 5, 1, 5]]) {
      ctx.fillRect(x, y, w, h);
    }

    // Deterministic speckle - a fixed pattern reads as grime, random reads as noise.
    ctx.globalAlpha = 0.4;
    for (const [x, y, w, h] of [[11, 29, 3, 1], [31, 13, 1, 3], [21, 38, 2, 1], [38, 22, 1, 2]]) {
      ctx.fillRect(x, y, w, h);
    }
    ctx.globalAlpha = 1;
  }

  /** Threshold plate with hazard chevrons and a lit edge strip. */
  _paintDoor(ctx, S, paint) {
    ctx.fillStyle = paint.accent;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(2, 2, S - 4, S - 4);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = paint.edge;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 2); ctx.lineTo(S, 2);
    ctx.moveTo(0, S - 2); ctx.lineTo(S, S - 2);
    ctx.stroke();

    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 3;
    for (let i = -S; i < S; i += 12) {
      ctx.beginPath();
      ctx.moveTo(i, S - 6);
      ctx.lineTo(i + 10, 6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Reinforced pane: frame, tint, diagonal highlight. */
  _paintGlass(ctx, S, paint) {
    ctx.fillStyle = paint.edge;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(3, 3, S - 6, S - 6);

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = paint.edge;
    ctx.fillRect(0, 0, S, 4);
    ctx.fillRect(0, S - 4, S, 4);

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = paint.accent;
    ctx.beginPath();
    ctx.moveTo(8, S - 6);
    ctx.lineTo(20, 6);
    ctx.lineTo(27, 6);
    ctx.lineTo(15, S - 6);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Shipping crate: metal body, corner brackets, hazard band. */
  _paintCrate(ctx, S, paint) {
    const grad = ctx.createLinearGradient(0, 4, 0, S - 4);
    grad.addColorStop(0, paint.edge);
    grad.addColorStop(1, paint.base);
    ctx.fillStyle = grad;
    ctx.fillRect(3, 4, S - 6, S - 8);

    ctx.strokeStyle = paint.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 4, S - 6, S - 8);

    ctx.fillStyle = paint.accent;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(3, S / 2 - 3, S - 6, 6);
    ctx.globalAlpha = 0.5;
    for (const [x, y] of [[3, 4], [S - 11, 4], [3, S - 12], [S - 11, S - 12]]) {
      ctx.fillRect(x, y, 8, 8);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(3, S - 4, S - 6, 4);
  }

  /* -------------------------------------------------------------- actors */

  /**
   * White silhouette tinted per character. Shading is black-on-white so the tint
   * multiply keeps its volume instead of flattening into a coloured blob.
   */
  _buildActor() {
    if (this.textures.exists('actor')) return;
    const canvas = this.textures.createCanvas('actor', ACTOR_W, ACTOR_H);
    const ctx = canvas.getContext();
    const cx = ACTOR_W / 2;

    // Contact shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, ACTOR_H - 4, 12, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Torso.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(cx - 11, 17, 22, 22, 7);
    ctx.fill();

    // Shoulders.
    ctx.beginPath();
    ctx.ellipse(cx, 20, 12.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head.
    ctx.beginPath();
    ctx.arc(cx, 12, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // Volume: darken the lower right of both masses.
    const shade = ctx.createLinearGradient(0, 6, ACTOR_W, ACTOR_H - 6);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.55, 'rgba(0,0,0,0.05)');
    shade.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, ACTOR_W, ACTOR_H);

    // Collar seam and belt line.
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 8, 22);
    ctx.lineTo(cx + 8, 22);
    ctx.moveTo(cx - 9, 33);
    ctx.lineTo(cx + 9, 33);
    ctx.stroke();

    // Rim light on the top-left keeps bodies readable against a dark floor.
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, 12, 8.5, Math.PI * 0.85, Math.PI * 1.6);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    canvas.refresh();
  }

  /** Wall-mounted interactable: bezel, screen, status pip. */
  _buildProp() {
    if (this.textures.exists('prop')) return;
    const size = 34;
    const canvas = this.textures.createCanvas('prop', size, size);
    const ctx = canvas.getContext();

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.roundRect(3, 5, size - 6, size - 6, 6);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(2, 2, size - 4, size - 4, 6);
    ctx.fill();

    // Punch out the screen, then paint the readout back in.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.roundRect(7, 7, size - 14, size - 14, 3);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(11, 12, size - 22, 2);
    ctx.fillRect(11, 17, size - 26, 2);
    ctx.fillRect(11, 22, size - 20, 2);

    canvas.refresh();
  }

  _buildFaceMark() {
    if (this.textures.exists('facemark')) return;
    const canvas = this.textures.createCanvas('facemark', 12, 12);
    const ctx = canvas.getContext();
    const grad = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 12, 12);
    canvas.refresh();
  }

  _buildDot() {
    if (this.textures.exists('dot')) return;
    const canvas = this.textures.createCanvas('dot', 10, 10);
    const ctx = canvas.getContext();
    const grad = ctx.createRadialGradient(5, 5, 0, 5, 5, 5);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 10, 10);
    canvas.refresh();
  }

  /** Soft radial falloff used additively for ceiling lights. */
  _buildLightPool() {
    if (this.textures.exists('lightpool')) return;
    const size = 256;
    const canvas = this.textures.createCanvas('lightpool', size, size);
    const ctx = canvas.getContext();
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.22)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    canvas.refresh();
  }
}

export default BootScene;
