/**
 * level3.js - Ardent Tower, executive floor.
 *
 * The hard one, and hard for a structural reason rather than a numeric one: three long
 * open halls with a perimeter walkway around them. Sightlines run the full 14 tiles of
 * each hall, cover is sparse and freestanding, and the perimeter means a patrol can
 * come at you from behind while you are watching the door.
 *
 * The compensations are lateral: every hall connects directly to its neighbours, so
 * you can cut sideways instead of retreating to a corridor, and four breaker panels
 * make facility-wide blackouts the real tool on this floor.
 */

import { T } from '../tiles.js';

export default {
  id: 'ARDENT',
  index: 3,
  name: 'Ardent Tower',
  subtitle: 'Executive floor',
  brief: 'Three long halls, a perimeter walkway, and almost nowhere to hide. Kill the lights.',

  rooms: [
    { id: 'RECEPTION', name: 'Reception',    rect: { x: 6,  y: 6, w: 14, h: 21 }, floor: T.FLOOR_ATRIUM },
    { id: 'FLOOR_OPS', name: 'Trading Floor', rect: { x: 21, y: 6, w: 14, h: 21 }, floor: T.FLOOR_CTRL },
    { id: 'EXEC',      name: 'Executive Row', rect: { x: 36, y: 6, w: 14, h: 21 }, floor: T.FLOOR_VAULT },
  ],

  // A full perimeter walkway. Corners overlap, so the ring is continuous.
  corridors: [
    { id: 'NORTH', rect: { x: 1,  y: 1,  w: 54, h: 3 } },
    { id: 'SOUTH', rect: { x: 1,  y: 29, w: 54, h: 3 } },
    { id: 'WEST',  rect: { x: 1,  y: 1,  w: 3,  h: 31 } },
    { id: 'EAST',  rect: { x: 51, y: 1,  w: 4,  h: 31 } },
  ],

  doors: [
    { room: 'RECEPTION', x: 12, y: 5,  w: 2, h: 1 },
    { room: 'RECEPTION', x: 12, y: 27, w: 2, h: 1 },
    { room: 'RECEPTION', x: 5,  y: 15, w: 1, h: 2 },
    { room: 'RECEPTION', x: 20, y: 15, w: 1, h: 2 },   // straight through to the floor
    { room: 'FLOOR_OPS', x: 27, y: 5,  w: 2, h: 1 },
    { room: 'FLOOR_OPS', x: 27, y: 27, w: 2, h: 1 },
    { room: 'FLOOR_OPS', x: 35, y: 15, w: 1, h: 2 },   // and through to Executive Row
    { room: 'EXEC',      x: 42, y: 5,  w: 2, h: 1 },
    { room: 'EXEC',      x: 42, y: 27, w: 2, h: 1 },
    { room: 'EXEC',      x: 50, y: 15, w: 1, h: 2 },
  ],

  // Sparse, freestanding cover. Never a wall - just enough to break one sightline.
  crates: [
    { x: 9,  y: 10 }, { x: 10, y: 10 },
    { x: 16, y: 17 }, { x: 16, y: 18 },
    { x: 9,  y: 23 }, { x: 10, y: 23 },
    { x: 24, y: 9 },  { x: 25, y: 9 },
    { x: 30, y: 14 }, { x: 31, y: 14 },
    { x: 24, y: 22 }, { x: 25, y: 22 }, { x: 26, y: 22 },
    { x: 39, y: 10 }, { x: 40, y: 10 },
    { x: 45, y: 19 }, { x: 46, y: 19 },
    { x: 39, y: 24 }, { x: 40, y: 24 },
  ],

  // Interior partitions you can see through - they shape movement, not sight.
  glass: [
    { x: 15, y: 8 },  { x: 15, y: 9 },  { x: 15, y: 10 },
    { x: 28, y: 18 }, { x: 28, y: 19 }, { x: 28, y: 20 },
    { x: 43, y: 12 }, { x: 43, y: 13 }, { x: 43, y: 14 },
  ],

  props: [
    { id: 'FLOOR_UPS', label: 'Floor UPS', room: 'RECEPTION', x: 8, y: 25,
      action: 'SABOTAGE', sabotage: 'POWER', duration: 3000, prompt: 'Short the UPS bank', color: 0xffc14d },
    { id: 'TRADE_LEDGER', label: 'Ledger Core', room: 'FLOOR_OPS', x: 30, y: 8,
      action: 'SABOTAGE', sabotage: 'DATA', duration: 3400, prompt: 'Corrupt the ledger', color: 0x38f2c4 },
    { id: 'EXEC_FEEDS', label: 'Security Desk', room: 'EXEC', x: 47, y: 24,
      action: 'SABOTAGE', sabotage: 'CAMERAS', duration: 2600, prompt: 'Blind the desk', color: 0xff4d5e },
    { id: 'EXIT_TERMINAL', label: 'Executive Lift', room: 'EXEC', x: 39, y: 7,
      action: 'ESCAPE', duration: 3800, prompt: 'Override the lift', color: 0x7dd3fc },
    { id: 'RECEPTION_DESK', label: 'Reception Desk', room: 'RECEPTION', x: 13, y: 12,
      action: 'PICKUP', item: 'KEYCARD', prompt: 'Lift a keycard', color: 0xa78bfa },
    { id: 'IT_CART', label: 'IT Cart', room: 'FLOOR_OPS', x: 23, y: 25,
      action: 'PICKUP', item: 'SPLICER', prompt: 'Take signal splicer', color: 0xa78bfa },
    { id: 'BREAKER_RECEPTION', label: 'Breaker Panel', room: 'RECEPTION', x: 18, y: 7,  action: 'BREAKER', prompt: 'Tower breaker', color: 0x38f2c4 },
    { id: 'BREAKER_OPS',       label: 'Breaker Panel', room: 'FLOOR_OPS', x: 22, y: 13, action: 'BREAKER', prompt: 'Tower breaker', color: 0x38f2c4 },
    { id: 'BREAKER_EXEC',      label: 'Breaker Panel', room: 'EXEC',      x: 48, y: 8,  action: 'BREAKER', prompt: 'Tower breaker', color: 0x38f2c4 },
    { id: 'BREAKER_NORTH',     label: 'Breaker Panel', room: null,        x: 33, y: 2,  action: 'BREAKER', prompt: 'Tower breaker', color: 0x38f2c4 },
  ],

  cast: ['NPC_GUARD_1', 'NPC_SCI_1', 'NPC_SCI_2', 'NPC_TECH_1', 'NPC_CHIEF'],

  spawn: {
    player: { x: 2, y: 30 },
    npcs: {
      NPC_GUARD_1: { x: 27, y: 2 },
      NPC_CHIEF: { x: 43, y: 30 },
      NPC_SCI_1: { x: 13, y: 15 },
      NPC_SCI_2: { x: 28, y: 12 },
      NPC_TECH_1: { x: 45, y: 21 },
    },
  },

  patrols: {
    // The guard walks the whole perimeter - there is no safe side.
    NPC_GUARD_1: [{ x: 27, y: 2 }, { x: 53, y: 2 }, { x: 53, y: 30 }, { x: 27, y: 30 }, { x: 2, y: 30 }, { x: 2, y: 2 }],
    NPC_CHIEF: [{ x: 43, y: 30 }, { x: 43, y: 22 }, { x: 27, y: 22 }, { x: 13, y: 22 }, { x: 13, y: 30 }],
    NPC_SCI_1: [{ x: 13, y: 15 }, { x: 13, y: 8 }, { x: 8, y: 20 }, { x: 17, y: 24 }],
    NPC_SCI_2: [{ x: 28, y: 12 }, { x: 32, y: 20 }, { x: 24, y: 24 }, { x: 27, y: 7 }],
    NPC_TECH_1: [{ x: 45, y: 21 }, { x: 47, y: 10 }, { x: 39, y: 16 }, { x: 46, y: 26 }],
  },
};
