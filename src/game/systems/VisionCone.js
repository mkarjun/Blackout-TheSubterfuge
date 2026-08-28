/**
 * VisionCone.js - Line-of-sight for the Physical Layer.
 *
 * Two jobs, deliberately separated by cost:
 *   1. canSee(x, y)  - one DDA ray. Exact, cheap, safe to call every frame per NPC.
 *   2. redraw()      - the fan of rays that renders the visible cone polygon. Costly,
 *                      so it is throttled and skipped entirely when the cone is off
 *                      camera. The polygon is presentation only; detection never
 *                      depends on it.
 *
 * Glass is walkable-blocking but sight-transparent (see SIGHT_BLOCKING in labMap),
 * which is what makes the Server Vault genuinely dangerous to cross.
 */

import Phaser from 'phaser';
import { TILE_SIZE, MAP_W, MAP_H, isSightBlocking } from '../../assets/tilemaps/labMap.js';

/** Precomputed sight-blocking lookup shared by every cone in the scene. */
export function buildSightGrid(mapData) {
  return mapData.map((row) => row.map((t) => isSightBlocking(t)));
}

/**
 * Tile-stepping DDA between two world points.
 * @returns {boolean} true when nothing sight-blocking sits between them.
 */
export function hasLineOfSight(sightGrid, x0, y0, x1, y1) {
  let tx = Math.floor(x0 / TILE_SIZE);
  let ty = Math.floor(y0 / TILE_SIZE);
  const endX = Math.floor(x1 / TILE_SIZE);
  const endY = Math.floor(y1 / TILE_SIZE);

  const dx = Math.abs(endX - tx);
  const dy = Math.abs(endY - ty);
  const stepX = tx < endX ? 1 : -1;
  const stepY = ty < endY ? 1 : -1;
  let err = dx - dy;
  let guard = dx + dy + 2;

  while (guard-- > 0) {
    if (tx === endX && ty === endY) return true;
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    // The origin tile never blocks its own ray.
    if (!(tx === Math.floor(x0 / TILE_SIZE) && ty === Math.floor(y0 / TILE_SIZE)) && sightGrid[ty][tx]) {
      return false;
    }
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; tx += stepX; }
    if (e2 < dx) { err += dx; ty += stepY; }
  }
  return false;
}

/** March a single ray until it hits geometry; returns the stop point in world coords. */
function castRay(sightGrid, ox, oy, angle, range, step = 12) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let d = step; d <= range; d += step) {
    const x = ox + cos * d;
    const y = oy + sin * d;
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return { x, y, d };
    if (sightGrid[ty][tx]) return { x: x - cos * step * 0.5, y: y - sin * step * 0.5, d };
  }
  return { x: ox + cos * range, y: oy + sin * range, d: range };
}

export const CONE_COLORS = {
  CALM: 0x38f2c4,
  SUSPICIOUS: 0xffc14d,
  ALERTED: 0xff4d5e,
};

export class VisionCone {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} owner            Anything with { x, y } - normally the NPC sprite.
   * @param {object} opts
   * @param {boolean[][]} opts.sightGrid
   * @param {number} [opts.range=224]  Pixels.
   * @param {number} [opts.fov=1.5]    Radians, total spread.
   * @param {number} [opts.rays=26]    Polygon resolution (drawing only).
   */
  constructor(scene, owner, { sightGrid, range = 336, fov = 1.5, rays = 30, depth = 4 } = {}) {
    this.scene = scene;
    this.owner = owner;
    this.sightGrid = sightGrid;
    this.baseRange = range;
    this.range = range;
    this.fov = fov;
    this.rays = rays;
    this.facing = 0;
    this.enabled = true;
    this.darkFactor = 1;

    this.gfx = scene.add.graphics();
    this.gfx.setDepth(depth);
    this.gfx.setBlendMode(Phaser.BlendModes.ADD);

    this._color = CONE_COLORS.CALM;
    this._lastDraw = 0;
    this._drawIntervalMs = 55;   // ~18 redraws/sec is indistinguishable from 60
  }

  setFacing(radians) {
    this.facing = radians;
  }

  setAlertColor(level) {
    this._color = level >= 2 ? CONE_COLORS.ALERTED : level === 1 ? CONE_COLORS.SUSPICIOUS : CONE_COLORS.CALM;
  }

  /** Blackouts shorten sight; the guard is still looking, just not seeing far. */
  setLighting(lightsOn) {
    this.darkFactor = lightsOn ? 1 : 0.42;
    this.range = this.baseRange * this.darkFactor;
  }

  setEnabled(on) {
    this.enabled = on;
    this.gfx.setVisible(on);
  }

  /**
   * Exact detection test. One ray, no allocation.
   * @returns {{seen:boolean, dist:number, angleDelta:number}}
   */
  canSee(x, y, { rangeScale = 1 } = {}) {
    const ox = this.owner.x;
    const oy = this.owner.y;
    const dx = x - ox;
    const dy = y - oy;
    const dist = Math.hypot(dx, dy);
    const effectiveRange = this.range * rangeScale;

    if (!this.enabled || dist > effectiveRange) return { seen: false, dist, angleDelta: Math.PI };

    const angle = Math.atan2(dy, dx);
    const delta = Math.abs(Phaser.Math.Angle.Wrap(angle - this.facing));

    // Anything close enough is "sensed" regardless of facing - people notice bodies
    // brushing past them. Beyond that, the FOV half-angle applies.
    const peripheral = dist < TILE_SIZE * 1.2;
    if (!peripheral && delta > this.fov / 2) return { seen: false, dist, angleDelta: delta };

    const seen = hasLineOfSight(this.sightGrid, ox, oy, x, y);
    return { seen, dist, angleDelta: delta };
  }

  /** Throttled cone repaint. Safe to call every frame. */
  redraw(time) {
    if (!this.enabled) return;
    if (time - this._lastDraw < this._drawIntervalMs) return;
    this._lastDraw = time;

    const cam = this.scene.cameras.main;
    const ox = this.owner.x;
    const oy = this.owner.y;
    // Skip cones the player cannot possibly see; keeps 20+ NPCs affordable.
    if (!cam.worldView.contains(ox, oy)
        && Phaser.Math.Distance.Between(ox, oy, cam.worldView.centerX, cam.worldView.centerY)
           > cam.worldView.width) {
      this.gfx.clear();
      return;
    }

    const g = this.gfx;
    g.clear();
    g.fillStyle(this._color, 0.13);
    g.lineStyle(1, this._color, 0.25);

    const half = this.fov / 2;
    const points = [{ x: ox, y: oy }];
    for (let i = 0; i <= this.rays; i++) {
      const angle = this.facing - half + (this.fov * i) / this.rays;
      points.push(castRay(this.sightGrid, ox, oy, angle, this.range));
    }

    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.closePath();
    g.fillPath();
    g.strokePath();
  }

  destroy() {
    this.gfx.destroy();
    this.scene = null;
    this.owner = null;
  }
}

export default VisionCone;
