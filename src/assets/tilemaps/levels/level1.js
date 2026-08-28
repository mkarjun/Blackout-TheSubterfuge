/**
 * level1.js - The Halden Institute, sublevel 3.
 *
 * The tutorial floor: a clean 2x3 grid of rooms around a corridor ring. Sightlines are
 * short, every room has two ways out, and the corridor ring means you are never more
 * than one turn from cover. Learn the loop here.
 *
 * All levels share the 56x33 grid so the tileset, pathfinder bounds and minimap
 * projection stay constant; what changes is the carving, the cast and the objectives.
 */

import { T } from '../tiles.js';

export default {
  id: 'HALDEN',
  index: 1,
  name: 'Halden Institute',
  subtitle: 'Sublevel 3',
  brief: 'Six rooms around a corridor ring. Short sightlines, two ways out of everywhere.',

  rooms: [
    { id: 'CONTROL',   name: 'Control Room',   rect: { x: 1,  y: 1,  w: 15, h: 11 }, floor: T.FLOOR_CTRL },
    { id: 'LAB_A',     name: 'Lab A',          rect: { x: 21, y: 1,  w: 14, h: 11 }, floor: T.FLOOR_LAB },
    { id: 'VAULT',     name: 'Server Vault',   rect: { x: 40, y: 1,  w: 15, h: 11 }, floor: T.FLOOR_VAULT },
    { id: 'GENERATOR', name: 'Generator Bay',  rect: { x: 1,  y: 17, w: 15, h: 11 }, floor: T.FLOOR_GEN },
    { id: 'ATRIUM',    name: 'Atrium',         rect: { x: 21, y: 17, w: 14, h: 11 }, floor: T.FLOOR_ATRIUM },
    { id: 'SECURITY',  name: 'Security Hub',   rect: { x: 40, y: 17, w: 15, h: 11 }, floor: T.FLOOR_SEC },
  ],

  corridors: [
    { id: 'V_LEFT',  rect: { x: 17, y: 1,  w: 3,  h: 31 } },
    { id: 'V_RIGHT', rect: { x: 36, y: 1,  w: 3,  h: 31 } },
    { id: 'H_NORTH', rect: { x: 1,  y: 13, w: 54, h: 3 } },
    { id: 'H_SOUTH', rect: { x: 1,  y: 29, w: 54, h: 3 } },
  ],

  doors: [
    { room: 'CONTROL',   x: 16, y: 5,  w: 1, h: 2 },
    { room: 'CONTROL',   x: 7,  y: 12, w: 2, h: 1 },
    { room: 'LAB_A',     x: 20, y: 5,  w: 1, h: 2 },
    { room: 'LAB_A',     x: 35, y: 5,  w: 1, h: 2 },
    { room: 'LAB_A',     x: 27, y: 12, w: 2, h: 1 },
    { room: 'VAULT',     x: 39, y: 5,  w: 1, h: 2 },
    { room: 'GENERATOR', x: 16, y: 21, w: 1, h: 2 },
    { room: 'GENERATOR', x: 7,  y: 28, w: 2, h: 1 },
    { room: 'ATRIUM',    x: 20, y: 21, w: 1, h: 2 },
    { room: 'ATRIUM',    x: 35, y: 21, w: 1, h: 2 },
    { room: 'ATRIUM',    x: 27, y: 16, w: 2, h: 1 },
    { room: 'ATRIUM',    x: 27, y: 28, w: 2, h: 1 },
    { room: 'SECURITY',  x: 39, y: 21, w: 1, h: 2 },
    { room: 'SECURITY',  x: 47, y: 16, w: 2, h: 1 },
    { room: 'SECURITY',  x: 47, y: 28, w: 2, h: 1 },
  ],

  crates: [
    { x: 24, y: 20 }, { x: 25, y: 20 }, { x: 31, y: 24 }, { x: 32, y: 24 },
    { x: 24, y: 25 }, { x: 44, y: 24 }, { x: 45, y: 24 }, { x: 12, y: 19 },
    { x: 12, y: 20 }, { x: 30, y: 4 },  { x: 31, y: 4 },  { x: 4,  y: 8 },
    { x: 51, y: 8 },  { x: 51, y: 9 },
  ],

  glass: [
    { x: 28, y: 8 }, { x: 29, y: 8 }, { x: 30, y: 8 },
    { x: 45, y: 4 }, { x: 45, y: 5 }, { x: 45, y: 6 },
  ],

  props: [
    { id: 'GENERATOR_CORE', label: 'Generator Core', room: 'GENERATOR', x: 8, y: 20,
      action: 'SABOTAGE', sabotage: 'POWER', duration: 2600, prompt: 'Overload coolant loop', color: 0xffc14d },
    { id: 'SERVER_RACK', label: 'Core Server Rack', room: 'VAULT', x: 48, y: 5,
      action: 'SABOTAGE', sabotage: 'DATA', duration: 3000, prompt: 'Wipe research archive', color: 0x38f2c4 },
    { id: 'CAMERA_HUB', label: 'Camera Hub', room: 'SECURITY', x: 47, y: 21,
      action: 'SABOTAGE', sabotage: 'CAMERAS', duration: 2200, prompt: 'Loop camera feeds', color: 0xff4d5e },
    { id: 'EXIT_TERMINAL', label: 'Blast Door Terminal', room: 'CONTROL', x: 8, y: 3,
      action: 'ESCAPE', duration: 3400, prompt: 'Release blast door', color: 0x7dd3fc },
    { id: 'SAMPLE_CABINET', label: 'Sample Cabinet', room: 'LAB_A', x: 27, y: 4,
      action: 'PICKUP', item: 'PROTOTYPE_CHIP', prompt: 'Take prototype chip', color: 0xa78bfa },
    { id: 'TOOL_LOCKER', label: 'Tool Locker', room: 'ATRIUM', x: 27, y: 22,
      action: 'PICKUP', item: 'SPLICER', prompt: 'Take signal splicer', color: 0xa78bfa },
    { id: 'BREAKER_CTRL', label: 'Breaker Panel', room: 'CONTROL',   x: 14, y: 9,  action: 'BREAKER', prompt: 'Facility breaker', color: 0x38f2c4 },
    { id: 'BREAKER_GEN',  label: 'Breaker Panel', room: 'GENERATOR', x: 2,  y: 25, action: 'BREAKER', prompt: 'Facility breaker', color: 0x38f2c4 },
    { id: 'BREAKER_SEC',  label: 'Breaker Panel', room: 'SECURITY',  x: 53, y: 25, action: 'BREAKER', prompt: 'Facility breaker', color: 0x38f2c4 },
    { id: 'BREAKER_LAB',  label: 'Breaker Panel', room: 'LAB_A',     x: 22, y: 9,  action: 'BREAKER', prompt: 'Facility breaker', color: 0x38f2c4 },
  ],

  cast: ['NPC_GUARD_1', 'NPC_SCI_1', 'NPC_SCI_2', 'NPC_TECH_1', 'NPC_CHIEF'],

  spawn: {
    player: { x: 27, y: 30 },
    npcs: {
      NPC_GUARD_1: { x: 18, y: 30 },
      NPC_CHIEF: { x: 47, y: 22 },
      NPC_SCI_1: { x: 26, y: 6 },
      NPC_SCI_2: { x: 30, y: 6 },
      NPC_TECH_1: { x: 8, y: 24 },
    },
  },

  patrols: {
    NPC_GUARD_1: [{ x: 18, y: 30 }, { x: 18, y: 14 }, { x: 37, y: 14 }, { x: 37, y: 30 }],
    NPC_CHIEF: [{ x: 47, y: 22 }, { x: 47, y: 30 }, { x: 18, y: 30 }, { x: 8, y: 6 }, { x: 18, y: 14 }],
    NPC_SCI_1: [{ x: 26, y: 6 }, { x: 33, y: 6 }, { x: 37, y: 6 }, { x: 48, y: 6 }],
    NPC_SCI_2: [{ x: 30, y: 9 }, { x: 27, y: 14 }, { x: 27, y: 22 }, { x: 24, y: 18 }],
    NPC_TECH_1: [{ x: 8, y: 24 }, { x: 14, y: 22 }, { x: 18, y: 22 }, { x: 27, y: 24 }, { x: 8, y: 19 }],
  },
};
