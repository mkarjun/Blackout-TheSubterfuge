/**
 * tiles.js - Tile vocabulary shared by every level.
 *
 * Split out from labMap so level modules can reference floor types without importing
 * the registry that in turn imports them.
 */

export const TILE_SIZE = 48;
/** Every level uses the same grid so the tileset, pathfinder bounds and the minimap
 *  projection are constants rather than per-level state. */
export const MAP_W = 56;
export const MAP_H = 33;

export const T = {
  WALL: 0,
  FLOOR: 1,        // corridor
  FLOOR_CTRL: 2,
  FLOOR_LAB: 3,
  FLOOR_VAULT: 4,
  FLOOR_GEN: 5,
  FLOOR_ATRIUM: 6,
  FLOOR_SEC: 7,
  DOOR: 8,
  GLASS: 9,        // blocks movement, sight passes through
  CRATE: 10,       // blocks movement and sight
};

/** Tiles a body cannot walk through. */
export const COLLIDING = [T.WALL, T.GLASS, T.CRATE];
/** Tiles a vision ray cannot pass. Glass is deliberately absent. */
export const SIGHT_BLOCKING = [T.WALL, T.CRATE];

export const isColliding = (idx) => COLLIDING.includes(idx);
export const isSightBlocking = (idx) => SIGHT_BLOCKING.includes(idx);

/** Carryable items. Shared by the scene and the React inventory panel. */
export const ITEMS = {
  PROTOTYPE_CHIP: {
    id: 'PROTOTYPE_CHIP',
    label: 'prototype chip',
    hint: 'Lab hardware. Damning wherever it turns up.',
  },
  SPLICER: {
    id: 'SPLICER',
    label: 'signal splicer',
    hint: 'Maintenance tool. Points squarely at whoever works the room.',
  },
  KEYCARD: {
    id: 'KEYCARD',
    label: 'stolen keycard',
    hint: 'Someone else\'s access. Awkward to explain if it is found on the floor.',
  },
};

export const itemLabel = (id) => ITEMS[id]?.label || String(id || '').toLowerCase();

export const toTile = (worldValue) => Math.floor(worldValue / TILE_SIZE);
export const toWorld = (tileValue) => tileValue * TILE_SIZE + TILE_SIZE / 2;
