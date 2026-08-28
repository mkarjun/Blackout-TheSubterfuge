/**
 * Pathfinding.js - Grid A* for the Physical Layer.
 *
 * Runs entirely locally at 60fps. Design constraints:
 *   - Bounded work per call (maxNodes) so one bad request cannot stall a frame.
 *   - 8-way movement with corner-cutting disabled, so bodies never clip a wall
 *     diagonal at a doorway.
 *   - Paths are returned in *world* coordinates (tile centres) because every consumer
 *     is a Phaser sprite.
 */

import { TILE_SIZE, MAP_W, MAP_H, isColliding } from '../../assets/tilemaps/labMap.js';

/** Binary min-heap. A sorted-array frontier is O(n) per pop and shows up in profiles. */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }

  push(node) {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].f <= items[i].f) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && items[l].f < items[smallest].f) smallest = l;
        if (r < items.length && items[r].f < items[smallest].f) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

const DIAGONAL_COST = Math.SQRT2;

export class GridPathfinder {
  /**
   * @param {number[][]} grid Tile indices from buildMapData().
   */
  constructor(grid) {
    this.grid = grid;
    this.width = grid[0].length;
    this.height = grid.length;
    // Precompute walkability once; isColliding() does an array scan per call.
    this.walkable = grid.map((row) => row.map((t) => !isColliding(t)));
    this._cache = new Map();
    this._cacheOrder = [];
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isWalkable(x, y) {
    return this.inBounds(x, y) && this.walkable[y][x];
  }

  /** Mark a tile blocked/unblocked at runtime (a sealed blast door, a dropped crate). */
  setBlocked(x, y, blocked) {
    if (!this.inBounds(x, y)) return;
    this.walkable[y][x] = !blocked;
    this.clearCache();
  }

  clearCache() {
    this._cache.clear();
    this._cacheOrder.length = 0;
  }

  /** Nearest walkable tile to (x,y) within `radius`, for targets standing on furniture. */
  nearestWalkable(x, y, radius = 4) {
    if (this.isWalkable(x, y)) return { x, y };
    for (let r = 1; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (this.isWalkable(nx, ny)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  /**
   * A* in tile space.
   * @returns {Array<{x:number,y:number}>} tile path excluding the start tile; [] if none.
   */
  findPathTiles(sx, sy, tx, ty, { maxNodes = 2500 } = {}) {
    const start = this.nearestWalkable(sx, sy, 2);
    const goal = this.nearestWalkable(tx, ty, 4);
    if (!start || !goal) return [];
    if (start.x === goal.x && start.y === goal.y) return [];

    const key = `${start.x},${start.y}>${goal.x},${goal.y}`;
    const cached = this._cache.get(key);
    if (cached) return cached.map((p) => ({ ...p }));

    const w = this.width;
    const idx = (x, y) => y * w + x;
    const open = new MinHeap();
    const gScore = new Map();
    const cameFrom = new Map();
    const closed = new Set();

    const h = (x, y) => {
      // Octile distance - admissible for 8-way movement with diagonal cost sqrt(2).
      const dx = Math.abs(x - goal.x);
      const dy = Math.abs(y - goal.y);
      return (dx + dy) + (DIAGONAL_COST - 2) * Math.min(dx, dy);
    };

    const startIdx = idx(start.x, start.y);
    gScore.set(startIdx, 0);
    open.push({ x: start.x, y: start.y, f: h(start.x, start.y) });

    let expanded = 0;
    let best = null;
    let bestH = Infinity;

    while (open.size) {
      const current = open.pop();
      const cIdx = idx(current.x, current.y);
      if (closed.has(cIdx)) continue;
      closed.add(cIdx);

      const curH = h(current.x, current.y);
      if (curH < bestH) { bestH = curH; best = current; }

      if (current.x === goal.x && current.y === goal.y) {
        return this._cachePath(key, this._reconstruct(cameFrom, cIdx, w));
      }

      if (++expanded > maxNodes) break;   // hard frame-budget guard

      const g = gScore.get(cIdx);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = current.x + dx;
          const ny = current.y + dy;
          if (!this.isWalkable(nx, ny)) continue;
          // No corner cutting: a diagonal step needs both orthogonal neighbours free.
          if (dx && dy && (!this.isWalkable(current.x + dx, current.y) || !this.isWalkable(current.x, current.y + dy))) {
            continue;
          }
          const nIdx = idx(nx, ny);
          if (closed.has(nIdx)) continue;
          const tentative = g + (dx && dy ? DIAGONAL_COST : 1);
          if (tentative < (gScore.get(nIdx) ?? Infinity)) {
            gScore.set(nIdx, tentative);
            cameFrom.set(nIdx, cIdx);
            open.push({ x: nx, y: ny, f: tentative + h(nx, ny) });
          }
        }
      }
    }

    // Out of budget or unreachable: walk toward the closest node we did reach, so the
    // NPC still moves and the intent reads correctly to the player.
    if (best) {
      const path = this._reconstruct(cameFrom, idx(best.x, best.y), w);
      if (path.length) return this._cachePath(key, path);
    }
    return [];
  }

  _reconstruct(cameFrom, endIdx, w) {
    const path = [];
    let cur = endIdx;
    while (cur !== undefined) {
      path.push({ x: cur % w, y: Math.floor(cur / w) });
      cur = cameFrom.get(cur);
    }
    path.pop();          // drop the start tile - the body is already standing there
    return path.reverse();
  }

  _cachePath(key, path) {
    this._cache.set(key, path);
    this._cacheOrder.push(key);
    if (this._cacheOrder.length > 120) {
      this._cache.delete(this._cacheOrder.shift());
    }
    return path.map((p) => ({ ...p }));
  }

  /** Same as findPathTiles but in world pixels, ready to feed a movement controller. */
  findPath(sxWorld, syWorld, txWorld, tyWorld, opts) {
    const tiles = this.findPathTiles(
      Math.floor(sxWorld / TILE_SIZE),
      Math.floor(syWorld / TILE_SIZE),
      Math.floor(txWorld / TILE_SIZE),
      Math.floor(tyWorld / TILE_SIZE),
      opts,
    );
    return tiles.map((t) => ({
      x: t.x * TILE_SIZE + TILE_SIZE / 2,
      y: t.y * TILE_SIZE + TILE_SIZE / 2,
    }));
  }

  /** A random walkable tile, optionally constrained to a room rect. */
  randomWalkable(rect = null, rng = Math.random) {
    for (let i = 0; i < 60; i++) {
      const x = rect ? rect.x + Math.floor(rng() * rect.w) : Math.floor(rng() * MAP_W);
      const y = rect ? rect.y + Math.floor(rng() * rect.h) : Math.floor(rng() * MAP_H);
      if (this.isWalkable(x, y)) return { x, y };
    }
    return null;
  }
}

export default GridPathfinder;
