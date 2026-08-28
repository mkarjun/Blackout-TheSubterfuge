/**
 * labMap.js - Level registry and map construction.
 *
 * Levels are *data*. Each one supplies rooms, corridors, doors, cover, props, a cast
 * and patrol routes; this module carves them into a tile grid, answers "what room is
 * this tile in" queries, and proves the result is playable.
 *
 * Every map is carved rather than hand-drawn: start from solid rock, cut corridors,
 * cut rooms, punch doors, then drop cover. Carving keeps the geometry provably
 * consistent - validateMap() flood-fills from the player spawn and asserts every room,
 * prop, NPC spawn and patrol node is reachable, and it runs for all three levels at
 * boot in dev and in the smoke tests. A sealed room is otherwise a bug you discover
 * ten minutes into a playthrough.
 *
 * One level is "active" at a time. The scene calls setActiveLevel() before building
 * the world, and the accessors below read from it.
 */

import level1 from './levels/level1.js';
import level2 from './levels/level2.js';
import level3 from './levels/level3.js';

export {
  TILE_SIZE, MAP_W, MAP_H, T, COLLIDING, SIGHT_BLOCKING,
  isColliding, isSightBlocking, ITEMS, itemLabel, toTile, toWorld,
} from './tiles.js';

import { MAP_W, MAP_H, T, isColliding } from './tiles.js';

export const LEVELS = { [level1.id]: level1, [level2.id]: level2, [level3.id]: level3 };
export const LEVEL_ORDER = [level1.id, level2.id, level3.id];
export const LEVEL_LIST = LEVEL_ORDER.map((id) => LEVELS[id]);

let activeId = LEVEL_ORDER[0];

export function setActiveLevel(id) {
  activeId = LEVELS[id] ? id : LEVEL_ORDER[0];
  return LEVELS[activeId];
}

export function getActiveLevel() {
  return LEVELS[activeId];
}

export function getLevel(id) {
  return LEVELS[id] || LEVELS[LEVEL_ORDER[0]];
}

/* ------------------------------------------------- active-level accessors */

export const getRooms = (level = getActiveLevel()) => level.rooms;
export const getCorridors = (level = getActiveLevel()) => level.corridors;
export const getDoors = (level = getActiveLevel()) => level.doors;
export const getProps = (level = getActiveLevel()) => level.props;
export const getSpawn = (level = getActiveLevel()) => level.spawn;
export const getPatrols = (level = getActiveLevel()) => level.patrols;
export const getCast = (level = getActiveLevel()) => level.cast;

/* --------------------------------------------------------------- carving */

function fill(grid, rect, tile) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) grid[y][x] = tile;
    }
  }
}

/**
 * @param {object} [level] Defaults to the active level.
 * @returns {number[][]} 2D tile-index array for `make.tilemap({ data })`.
 */
export function buildMapData(level = getActiveLevel()) {
  const grid = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(T.WALL));

  for (const c of level.corridors) fill(grid, c.rect, T.FLOOR);
  for (const r of level.rooms) fill(grid, r.rect, r.floor);
  for (const d of level.doors) fill(grid, { x: d.x, y: d.y, w: d.w, h: d.h }, T.DOOR);
  for (const g of level.glass || []) grid[g.y][g.x] = T.GLASS;
  for (const c of level.crates || []) grid[c.y][c.x] = T.CRATE;

  return grid;
}

/* --------------------------------------------------------------- lookups */

export function roomAt(tx, ty, level = getActiveLevel()) {
  for (const r of level.rooms) {
    const { x, y, w, h } = r.rect;
    if (tx >= x && tx < x + w && ty >= y && ty < y + h) return r;
  }
  for (const d of level.doors) {
    if (tx >= d.x && tx < d.x + d.w && ty >= d.y && ty < d.y + d.h) {
      return level.rooms.find((r) => r.id === d.room) || null;
    }
  }
  return null;
}

export function roomNameAt(tx, ty, level = getActiveLevel()) {
  const r = roomAt(tx, ty, level);
  return r ? r.name : 'Corridor';
}

export function roomIdAt(tx, ty, level = getActiveLevel()) {
  const r = roomAt(tx, ty, level);
  return r ? r.id : 'CORRIDOR';
}

export function roomCenter(roomId, level = getActiveLevel()) {
  const r = level.rooms.find((room) => room.id === roomId);
  if (!r) return null;
  return {
    x: Math.floor(r.rect.x + r.rect.w / 2),
    y: Math.floor(r.rect.y + r.rect.h / 2),
  };
}

/* ------------------------------------------------------------ validation */

/**
 * Flood-fill from the player spawn and confirm everything the level needs is
 * reachable. Returns { ok, unreachable[], reachedTiles }.
 */
export function validateMap(level = getActiveLevel(), grid = buildMapData(level)) {
  const seen = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));
  const start = level.spawn.player;
  const queue = [start];
  seen[start.y][start.x] = true;
  let reached = 0;

  while (queue.length) {
    const { x, y } = queue.pop();
    reached++;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (seen[ny][nx] || isColliding(grid[ny][nx])) continue;
      seen[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }

  const unreachable = [];
  for (const r of level.rooms) {
    const c = roomCenter(r.id, level);
    if (!seen[c.y][c.x]) unreachable.push(`room:${r.id}`);
  }
  for (const p of level.props) {
    // A prop is furniture; the player stands beside it, so check its neighbours.
    const adjacent = [[p.x + 1, p.y], [p.x - 1, p.y], [p.x, p.y + 1], [p.x, p.y - 1]]
      .some(([x, y]) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && seen[y][x]);
    if (!adjacent) unreachable.push(`prop:${p.id}`);
  }
  for (const [id, s] of Object.entries(level.spawn.npcs)) {
    if (!seen[s.y][s.x]) unreachable.push(`spawn:${id}`);
  }
  for (const [id, points] of Object.entries(level.patrols)) {
    points.forEach((p, i) => {
      if (!seen[p.y][p.x]) unreachable.push(`patrol:${id}[${i}]`);
    });
  }
  // A level is unfinishable without all three sabotage targets and an exit.
  const sabotage = new Set(level.props.filter((p) => p.sabotage).map((p) => p.sabotage));
  for (const key of ['POWER', 'DATA', 'CAMERAS']) {
    if (!sabotage.has(key)) unreachable.push(`missing-objective:${key}`);
  }
  if (!level.props.some((p) => p.action === 'ESCAPE')) unreachable.push('missing-exit');
  for (const id of level.cast) {
    if (!level.spawn.npcs[id]) unreachable.push(`missing-spawn:${id}`);
    if (!level.patrols[id]) unreachable.push(`missing-patrol:${id}`);
  }

  return { ok: unreachable.length === 0, unreachable, reachedTiles: reached };
}

/** Validate every level at once. Used at boot in dev and by the smoke tests. */
export function validateAllLevels() {
  return LEVEL_ORDER.map((id) => ({ id, ...validateMap(LEVELS[id]) }));
}

export default {
  LEVELS, LEVEL_ORDER, LEVEL_LIST, setActiveLevel, getActiveLevel, getLevel,
  getRooms, getCorridors, getDoors, getProps, getSpawn, getPatrols, getCast,
  buildMapData, roomAt, roomIdAt, roomNameAt, roomCenter, validateMap, validateAllLevels,
};
