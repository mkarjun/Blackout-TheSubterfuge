/**
 * level2.js - Cryo Annex.
 *
 * A spine, not a ring. One central corridor runs the height of the floor and one
 * crosses it; every room hangs off that junction. The consequence is that there is
 * usually exactly one sensible route between two rooms, so patrols and players share
 * the same chokepoints far more than on Halden - and the crossing at the middle is
 * where runs die.
 *
 * Compensating cover: the cryo halls are dense with crates, and the glass wall down
 * the middle of the spine means the corridor is visible from both cryo rooms.
 */

import { T } from '../tiles.js';

export default {
  id: 'CRYO',
  index: 2,
  name: 'Cryo Annex',
  subtitle: 'Cold storage, level B',
  brief: 'One spine, one crossing. Fewer routes, denser cover, and everyone funnels through the middle.',

  rooms: [
    { id: 'CRYO_A',   name: 'Cryo Hall A',   rect: { x: 1,  y: 1,  w: 23, h: 13 }, floor: T.FLOOR_VAULT },
    { id: 'CRYO_B',   name: 'Cryo Hall B',   rect: { x: 31, y: 1,  w: 24, h: 13 }, floor: T.FLOOR_LAB },
    { id: 'PUMPS',    name: 'Pump Room',     rect: { x: 1,  y: 19, w: 23, h: 13 }, floor: T.FLOOR_GEN },
    { id: 'DISPATCH', name: 'Dispatch',      rect: { x: 31, y: 19, w: 24, h: 13 }, floor: T.FLOOR_SEC },
  ],

  corridors: [
    { id: 'SPINE', rect: { x: 25, y: 1,  w: 5,  h: 31 } },
    { id: 'CROSS', rect: { x: 1,  y: 15, w: 54, h: 3 } },
  ],

  doors: [
    { room: 'CRYO_A',   x: 24, y: 5,  w: 1, h: 2 },
    { room: 'CRYO_A',   x: 10, y: 14, w: 2, h: 1 },
    { room: 'CRYO_B',   x: 30, y: 5,  w: 1, h: 2 },
    { room: 'CRYO_B',   x: 43, y: 14, w: 2, h: 1 },
    { room: 'PUMPS',    x: 24, y: 25, w: 1, h: 2 },
    { room: 'PUMPS',    x: 10, y: 18, w: 2, h: 1 },
    { room: 'DISPATCH', x: 30, y: 25, w: 1, h: 2 },
    { room: 'DISPATCH', x: 43, y: 18, w: 2, h: 1 },
  ],

  // Dense cover - this level would be unplayable without it.
  crates: [
    { x: 5, y: 4 },  { x: 6, y: 4 },  { x: 5, y: 5 },
    { x: 14, y: 3 }, { x: 15, y: 3 }, { x: 14, y: 4 },
    { x: 8, y: 9 },  { x: 9, y: 9 },  { x: 18, y: 8 }, { x: 19, y: 8 },
    { x: 35, y: 4 }, { x: 36, y: 4 }, { x: 35, y: 5 },
    { x: 45, y: 3 }, { x: 46, y: 3 }, { x: 49, y: 9 }, { x: 50, y: 9 },
    { x: 6, y: 22 }, { x: 7, y: 22 }, { x: 15, y: 24 }, { x: 16, y: 24 },
    { x: 11, y: 29 }, { x: 12, y: 29 },
    { x: 36, y: 22 }, { x: 37, y: 22 }, { x: 47, y: 23 }, { x: 48, y: 23 },
    { x: 41, y: 29 }, { x: 42, y: 29 },
  ],

  // Observation glass onto the spine: the corridor is watched from both cryo halls.
  glass: [
    { x: 24, y: 9 },  { x: 24, y: 10 }, { x: 24, y: 11 },
    { x: 30, y: 9 },  { x: 30, y: 10 }, { x: 30, y: 11 },
    { x: 24, y: 21 }, { x: 24, y: 22 },
    { x: 30, y: 21 }, { x: 30, y: 22 },
  ],

  props: [
    { id: 'CRYO_MANIFOLD', label: 'Coolant Manifold', room: 'PUMPS', x: 12, y: 26,
      action: 'SABOTAGE', sabotage: 'POWER', duration: 2800, prompt: 'Vent the coolant', color: 0xffc14d },
    { id: 'SAMPLE_ARCHIVE', label: 'Sample Archive', room: 'CRYO_A', x: 4, y: 11,
      action: 'SABOTAGE', sabotage: 'DATA', duration: 3200, prompt: 'Spoil the samples', color: 0x38f2c4 },
    { id: 'DISPATCH_RELAY', label: 'Dispatch Relay', room: 'DISPATCH', x: 51, y: 27,
      action: 'SABOTAGE', sabotage: 'CAMERAS', duration: 2400, prompt: 'Kill the uplink', color: 0xff4d5e },
    { id: 'EXIT_TERMINAL', label: 'Freight Lift', room: 'CRYO_B', x: 52, y: 3,
      action: 'ESCAPE', duration: 3600, prompt: 'Call the freight lift', color: 0x7dd3fc },
    { id: 'PARTS_BIN', label: 'Parts Bin', room: 'PUMPS', x: 20, y: 21,
      action: 'PICKUP', item: 'SPLICER', prompt: 'Take signal splicer', color: 0xa78bfa },
    { id: 'COAT_HOOK', label: 'Coat Hooks', room: 'CRYO_B', x: 33, y: 11,
      action: 'PICKUP', item: 'KEYCARD', prompt: 'Lift a keycard', color: 0xa78bfa },
    { id: 'BREAKER_CRYO_A', label: 'Breaker Panel', room: 'CRYO_A',   x: 22, y: 2,  action: 'BREAKER', prompt: 'Annex breaker', color: 0x38f2c4 },
    { id: 'BREAKER_DISP',   label: 'Breaker Panel', room: 'DISPATCH', x: 32, y: 30, action: 'BREAKER', prompt: 'Annex breaker', color: 0x38f2c4 },
    { id: 'BREAKER_PUMPS',  label: 'Breaker Panel', room: 'PUMPS',    x: 2,  y: 30, action: 'BREAKER', prompt: 'Annex breaker', color: 0x38f2c4 },
  ],

  // Four on shift. Fewer eyes, but the chokepoints do the work instead.
  cast: ['NPC_GUARD_1', 'NPC_SCI_1', 'NPC_TECH_1', 'NPC_CHIEF'],

  spawn: {
    player: { x: 27, y: 30 },
    npcs: {
      NPC_GUARD_1: { x: 27, y: 16 },
      NPC_CHIEF: { x: 45, y: 25 },
      NPC_SCI_1: { x: 8, y: 6 },
      NPC_TECH_1: { x: 12, y: 24 },
    },
  },

  patrols: {
    NPC_GUARD_1: [{ x: 27, y: 16 }, { x: 27, y: 3 }, { x: 27, y: 16 }, { x: 27, y: 30 }],
    NPC_CHIEF: [{ x: 45, y: 25 }, { x: 33, y: 21 }, { x: 27, y: 16 }, { x: 12, y: 21 }, { x: 20, y: 30 }],
    NPC_SCI_1: [{ x: 8, y: 6 }, { x: 20, y: 4 }, { x: 20, y: 11 }, { x: 4, y: 10 }],
    NPC_TECH_1: [{ x: 12, y: 24 }, { x: 20, y: 28 }, { x: 27, y: 16 }, { x: 40, y: 21 }, { x: 50, y: 28 }],
  },
};
