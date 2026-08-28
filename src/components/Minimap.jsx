import React, { useEffect, useRef } from 'react';
import eventManager, { EVENTS } from '../game/systems/EventManager.js';
import {
  TILE_SIZE, MAP_W, MAP_H, T, getLevel, getActiveLevel, buildMapData,
} from '../assets/tilemaps/labMap.js';

/**
 * Minimap - circular live radar, bottom right.
 *
 * Two things keep this cheap enough to run at 15Hz next to a 60fps game:
 *   1. The terrain is rasterised **once** into an offscreen canvas at mount and
 *      blitted every frame. Per-frame work is one drawImage plus five markers.
 *   2. It never calls setState. The MINIMAP event handler draws straight to the
 *      canvas, so React re-renders exactly zero times while you play.
 *
 * The whole floor is shown rather than a player-centred scroll, and it deliberately
 * shows layout only - your position and your objectives. NPCs are NOT plotted: a radar
 * that tracks all five would do the work the vision cones, speech bubbles and footstep
 * noise are there to make you do, and would gut the tension of a blind corner. Scale is
 * chosen so the map's diagonal equals the circle's, which is the largest it can be
 * without the clip cutting the corner rooms off.
 */

const SIZE = 190;                       // CSS px
const MAP_DIAGONAL = Math.hypot(MAP_W, MAP_H);
const SCALE = SIZE / MAP_DIAGONAL;      // px per tile
const OFFSET_X = (SIZE - MAP_W * SCALE) / 2;
const OFFSET_Y = (SIZE - MAP_H * SCALE) / 2;

/** Per-room tint. Unlisted rooms fall back to a neutral floor colour. */
const ROOM_TINT = {
  // Halden
  CONTROL: '#1d3348', LAB_A: '#17362f', VAULT: '#2b2246',
  GENERATOR: '#3a2d17', ATRIUM: '#1d3324', SECURITY: '#3d1d26',
  // Cryo Annex
  CRYO_A: '#2b2246', CRYO_B: '#17362f', PUMPS: '#3a2d17', DISPATCH: '#3d1d26',
  // Ardent Tower
  RECEPTION: '#1d3324', FLOOR_OPS: '#1d3348', EXEC: '#2b2246',
};

const TILE_TINT = {
  [T.WALL]: '#0d131c',
  [T.FLOOR]: '#1a2434',
  [T.DOOR]: '#2f6f63',
  [T.GLASS]: '#2f5f5c',
  [T.CRATE]: '#3d2f1c',
};

/** Rasterise one level's floor plan. Returns a canvas sized SIZE x SIZE in CSS px. */
function buildTerrain(dpr, level) {
  const grid = buildMapData(level);
  const roomAtTile = new Map();
  for (const room of level.rooms) {
    const { x, y, w, h } = room.rect;
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) roomAtTile.set(`${tx},${ty}`, room.id);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // A hair of overdraw closes the seams between tiles at fractional scale.
  const cell = SCALE + 0.5;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const idx = grid[ty][tx];
      let color = TILE_TINT[idx];
      if (!color) color = ROOM_TINT[roomAtTile.get(`${tx},${ty}`)] || '#233046';
      ctx.fillStyle = color;
      ctx.fillRect(OFFSET_X + tx * SCALE, OFFSET_Y + ty * SCALE, cell, cell);
    }
  }
  return canvas;
}

export default function Minimap() {
  const canvasRef = useRef(null);
  const terrainRef = useRef(null);
  const stateRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    let builtLevel = getActiveLevel();
    terrainRef.current = buildTerrain(dpr, builtLevel);

    const toX = (worldX) => OFFSET_X + (worldX / TILE_SIZE) * SCALE;
    const toY = (worldY) => OFFSET_Y + (worldY / TILE_SIZE) * SCALE;

    const draw = () => {
      const data = stateRef.current;
      ctx.clearRect(0, 0, SIZE, SIZE);

      ctx.save();
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.globalAlpha = data?.dark ? 0.45 : 1;
      ctx.drawImage(terrainRef.current, 0, 0, SIZE, SIZE);
      ctx.globalAlpha = 1;

      if (data) {
        // Objective markers, hollow once complete. Marker ids differ per level, so
        // they are matched by role rather than by a hardcoded prop id.
        const props = builtLevel.props;
        const byRole = [
          { prop: props.find((p) => p.sabotage === 'POWER'), key: 'POWER', color: '#ffc14d' },
          { prop: props.find((p) => p.sabotage === 'DATA'), key: 'DATA', color: '#38f2c4' },
          { prop: props.find((p) => p.sabotage === 'CAMERAS'), key: 'CAMERAS', color: '#ff4d5e' },
          { prop: props.find((p) => p.action === 'ESCAPE'), key: null, color: '#7dd3fc' },
        ];
        for (const marker of byRole) {
          const prop = marker.prop;
          if (!prop) continue;
          const done = marker.key ? data.done?.[marker.key] : data.ready;
          const x = toX(prop.x * TILE_SIZE + TILE_SIZE / 2);
          const y = toY(prop.y * TILE_SIZE + TILE_SIZE / 2);
          ctx.beginPath();
          ctx.moveTo(x, y - 3.5); ctx.lineTo(x + 3.5, y);
          ctx.lineTo(x, y + 3.5); ctx.lineTo(x - 3.5, y);
          ctx.closePath();
          if (marker.key ? done : !done) {
            ctx.strokeStyle = marker.color;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 1;
            ctx.stroke();
          } else {
            ctx.fillStyle = marker.color;
            ctx.globalAlpha = 0.9;
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // Player: dot plus a facing wedge.
        const px = toX(data.px);
        const py = toY(data.py);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.arc(px, py, 11, data.pf - 0.42, data.pf + 0.42);
        ctx.closePath();
        ctx.fillStyle = 'rgba(56,242,196,0.22)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, 3.1, 0, Math.PI * 2);
        ctx.fillStyle = '#38f2c4';
        ctx.fill();
        ctx.strokeStyle = 'rgba(5,7,12,0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.restore();

      // Bezel.
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
      ctx.strokeStyle = data?.dark ? 'rgba(255,193,77,0.5)' : 'rgba(56,242,196,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Crosshair ticks.
      ctx.strokeStyle = 'rgba(123,135,152,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i;
        const r1 = SIZE / 2 - 1;
        const r2 = SIZE / 2 - 6;
        ctx.beginPath();
        ctx.moveTo(SIZE / 2 + Math.cos(a) * r1, SIZE / 2 + Math.sin(a) * r1);
        ctx.lineTo(SIZE / 2 + Math.cos(a) * r2, SIZE / 2 + Math.sin(a) * r2);
        ctx.stroke();
      }
    };

    draw();
    const off = eventManager.on(EVENTS.MINIMAP, (payload) => {
      // The floor plan changes with the level; re-rasterise only when it actually does.
      if (payload.levelId && payload.levelId !== builtLevel.id) {
        builtLevel = getLevel(payload.levelId);
        terrainRef.current = buildTerrain(dpr, builtLevel);
      }
      stateRef.current = payload;
      draw();
    }, { replay: true });

    return () => off();
  }, []);

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <canvas
        ref={canvasRef}
        style={{ width: SIZE, height: SIZE, display: 'block' }}
      />
      <span className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.2em] text-dim">
        sublevel 3
      </span>
    </div>
  );
}
