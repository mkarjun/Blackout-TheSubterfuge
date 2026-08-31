import React, { useEffect, useRef, useState } from 'react';
import eventManager, { EVENTS } from '../game/systems/EventManager.js';

/**
 * SuspicionWeb - the theory, drawn as it forms.
 *
 * Replaces a column of progress bars. The game's subject is a belief network: each of
 * the five holds an opinion about you *and* about each other, and those move between
 * them without you. Bars show only the first half; the graph shows an accusation
 * travelling from the person you told to the person who repeats it.
 *
 * You are the centre. Lines aimed inward are cases against you; the chords between
 * outer nodes are them blaming each other, which is where you want the attention.
 *
 * Driven by GAME_TICK at 4Hz, animated on rAF with every value eased toward its
 * target - a 4Hz snapshot drawn raw looks like a slideshow. Nothing in the animation
 * path calls setState; only the one-line verdict underneath re-renders.
 */

const DEFAULT_SIZE = 250;

/** How much of a peer opinion is worth drawing. Below this it is just noise. */
const PEER_FLOOR = 22;

const COL = {
  ink: '#05070c',
  neon: '#38f2c4',
  alarm: '#ff4d5e',
  caution: '#ffc14d',
  peer: '#c084fc',
  dim: '#5b6778',
  text: '#a8b6c8',
};

/** Threat colour for a 0-100 suspicion value. */
function heatColor(v) {
  if (v >= 70) return COL.alarm;
  if (v >= 40) return COL.caution;
  return COL.neon;
}

/**
 * The label under a node. Titles are stripped first - the roster is half doctors and
 * a chief, and taking the leading word gave three nodes reading "Dr." and "Chief".
 * What identifies someone at a glance is their given name.
 */
const TITLES = /^(dr|mr|mrs|ms|prof|chief|capt|sgt|lt)\.?$/i;

function shortName(name = '') {
  const parts = String(name).split(/[\s_]+/).filter(Boolean);
  const first = parts.find((part) => !TITLES.test(part)) || parts[0] || '';
  return first.slice(0, 9);
}

function shortId(id) {
  return String(id).replace('NPC_', '').replace(/_\d+$/, '').toLowerCase();
}

/**
 * Default source: the live game. The landing page passes a scripted one instead, so
 * the same instrument that runs during a run is also what sells the game - what you
 * see on the front page is the real widget, not a mock-up of it.
 *
 * @param {(snapshot: {suspicion: Array, heat: number}) => void} cb
 * @returns {() => void} unsubscribe
 */
function subscribeToGame(cb) {
  return eventManager.on(EVENTS.GAME_TICK, cb, { replay: true });
}

export default function SuspicionWeb({ size = DEFAULT_SIZE, subscribe = subscribeToGame }) {
  const canvasRef = useRef(null);
  // Live model: one entry per NPC holding both the target value from the last tick
  // and the eased value actually drawn.
  const modelRef = useRef({ rows: [], heat: 0, heatEased: 0, byId: new Map() });

  const CENTER = size / 2;
  const RING = size * 0.29;
  const NODE_R = Math.max(10, size * 0.052);
  const S = size / DEFAULT_SIZE;          // linear scale for text and the centre mark

  useEffect(() => {
    const off = subscribe((tick) => {
      const rows = tick?.suspicion || [];
      const m = modelRef.current;
      m.rows = rows;
      m.heat = tick?.heat ?? 0;

      for (const row of rows) {
        let node = m.byId.get(row.id);
        if (!node) {
          node = { player: 0, peers: new Map() };
          m.byId.set(row.id, node);
        }
        node.target = row.player;
        node.thinking = row.thinking;
        node.emotion = row.emotion;
        for (const [peerId, value] of Object.entries(row.peers || {})) {
          const prev = node.peers.get(peerId) || { v: 0, t: 0 };
          prev.t = value;
          node.peers.set(peerId, prev);
        }
      }
    });
    return off;
  }, [subscribe]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    let raf = 0;

    const draw = (t) => {
      const m = modelRef.current;
      const rows = m.rows;
      const n = rows.length;

      // --- ease everything one step toward its target -----------------------
      const k = 0.12;
      m.heatEased += (m.heat - m.heatEased) * k;
      for (const node of m.byId.values()) {
        node.player += ((node.target ?? 0) - node.player) * k;
        for (const p of node.peers.values()) p.v += (p.t - p.v) * k;
      }

      ctx.clearRect(0, 0, size, size);

      // --- backdrop ---------------------------------------------------------
      const bg = ctx.createRadialGradient(CENTER, CENTER, 4, CENTER, CENTER, CENTER);
      bg.addColorStop(0, 'rgba(56,242,196,0.05)');
      bg.addColorStop(1, 'rgba(5,7,12,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = 'rgba(28,37,52,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, RING, 0, Math.PI * 2);
      ctx.stroke();

      if (n === 0) {
        ctx.fillStyle = COL.dim;
        ctx.font = `${(10 * S).toFixed(1)}px Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('reading the floor...', CENTER, CENTER + 3);
        raf = requestAnimationFrame(draw);
        return;
      }

      // --- node positions ---------------------------------------------------
      const pos = new Map();
      rows.forEach((row, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        pos.set(row.id, { x: CENTER + Math.cos(a) * RING, y: CENTER + Math.sin(a) * RING, a });
      });

      // --- peer accusations: the chords between them ------------------------
      // Drawn first and bowed toward the centre so they read as a web rather than
      // a polygon. These are the lines you are trying to create.
      for (const row of rows) {
        const node = m.byId.get(row.id);
        const from = pos.get(row.id);
        if (!node || !from) continue;
        for (const [peerId, p] of node.peers) {
          const to = pos.get(peerId);
          if (!to || p.v < PEER_FLOOR) continue;
          const strength = Math.min(1, (p.v - PEER_FLOOR) / (100 - PEER_FLOOR));
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.quadraticCurveTo(
            CENTER + (from.x + to.x - 2 * CENTER) * 0.22,
            CENTER + (from.y + to.y - 2 * CENTER) * 0.22,
            to.x, to.y,
          );
          ctx.strokeStyle = COL.peer;
          ctx.globalAlpha = 0.18 + strength * 0.55;
          ctx.lineWidth = 0.8 + strength * 2.2;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // --- inbound accusations: the lines aimed at you ----------------------
      for (const row of rows) {
        const node = m.byId.get(row.id);
        const from = pos.get(row.id);
        if (!node || !from) continue;
        const v = node.player;
        const strength = Math.min(1, v / 100);
        const color = heatColor(v);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(CENTER, CENTER);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.12 + strength * 0.6;
        ctx.lineWidth = 0.7 + strength * 3;
        // The dashes crawl inward, and faster the surer they are - the visual
        // language for "this is closing in".
        if (v >= 25) {
          ctx.setLineDash([4, 5]);
          ctx.lineDashOffset = (t / (26 - Math.min(18, strength * 18))) % 9;
        }
        ctx.stroke();
        ctx.restore();
      }

      // --- you --------------------------------------------------------------
      const heat = m.heatEased;
      const pulse = 1 + Math.sin(t / 320) * (0.05 + (heat / 100) * 0.22);
      const youColor = heatColor(heat);

      const half = 7 * S;
      ctx.save();
      ctx.translate(CENTER, CENTER);
      ctx.globalAlpha = 0.10 + (heat / 100) * 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, 21 * S * pulse, 0, Math.PI * 2);
      ctx.fillStyle = youColor;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = youColor;
      ctx.fillRect(-half, -half, half * 2, half * 2);
      ctx.strokeStyle = COL.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-half, -half, half * 2, half * 2);
      ctx.restore();

      ctx.fillStyle = COL.ink;
      ctx.font = `bold ${(9 * S).toFixed(1)}px Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('YOU', CENTER, CENTER + 0.5);

      // --- the five ---------------------------------------------------------
      for (const row of rows) {
        const node = m.byId.get(row.id);
        const p = pos.get(row.id);
        if (!node || !p) continue;
        const v = node.player;
        const color = heatColor(v);

        // Thinking halo - the tell that a model call is in flight for this NPC.
        if (node.thinking) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, NODE_R + 5 + Math.sin(t / 220) * 1.6, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(168,182,200,0.45)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, NODE_R, 0, Math.PI * 2);
        ctx.fillStyle = '#0e141e';
        ctx.fill();
        ctx.strokeStyle = 'rgba(43,55,74,1)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Suspicion as a gauge arc around the rim.
        ctx.beginPath();
        ctx.arc(p.x, p.y, NODE_R, -Math.PI / 2, -Math.PI / 2 + (Math.min(100, v) / 100) * Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.6;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = v >= 70 ? color : COL.text;
        ctx.fill();

        // Name, set just outside its own node and pointing away from the centre, so
        // it never lands on a chord and never runs off the canvas edge.
        const dirX = Math.cos(p.a);
        const dirY = Math.sin(p.a);
        const vertical = Math.abs(dirX) < 0.35;
        const gap = NODE_R + 7 * S;
        const lx = vertical ? p.x : p.x + (dirX > 0 ? gap : -gap);
        const ly = vertical
          ? p.y + (dirY < 0 ? -(NODE_R + 16 * S) : NODE_R + 14 * S)
          : p.y - 1;
        ctx.textAlign = vertical ? 'center' : (dirX > 0 ? 'left' : 'right');
        ctx.textBaseline = 'middle';
        ctx.font = `${(9 * S).toFixed(1)}px Consolas, monospace`;
        ctx.fillStyle = v >= 70 ? color : COL.text;
        ctx.fillText(shortName(row.name), lx, ly);
        ctx.font = `${(8 * S).toFixed(1)}px Consolas, monospace`;
        ctx.fillStyle = COL.dim;
        ctx.fillText(`${Math.round(v)}%`, lx, ly + 10 * S);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, CENTER, RING, NODE_R, S]);

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, display: 'block' }}
        role="img"
        aria-label="Live map of who suspects whom"
      />
      <Verdict subscribe={subscribe} />
    </div>
  );
}

/**
 * One line of plain English under the graph. The web shows the shape of the theory;
 * this says what the shape means, which is what a new player actually needs.
 */
function Verdict({ subscribe = subscribeToGame }) {
  const [line, setLine] = useState(null);

  useEffect(() => {
    const off = subscribe((tick) => {
      const rows = tick?.suspicion || [];
      if (!rows.length) return setLine(null);

      const sure = rows.filter((r) => r.player >= 70).length;

      // Who is the floor blaming instead of you? Take the strongest peer opinion
      // anyone holds - that is the decoy you have managed to set up.
      let decoy = null;
      for (const row of rows) {
        for (const [peerId, value] of Object.entries(row.peers || {})) {
          if (!decoy || value > decoy.value) decoy = { id: peerId, value };
        }
      }

      if (sure >= 2) {
        return setLine({ tone: 'alarm', text: `${sure} of them are sure it was you` });
      }
      if (decoy && decoy.value >= 45) {
        return setLine({ tone: 'peer', text: `they are blaming ${shortId(decoy.id)} (${Math.round(decoy.value)}%)` });
      }
      if (sure === 1) return setLine({ tone: 'caution', text: 'one of them is sure it was you' });

      // Between "nothing" and "certain" there is a long stretch that matters most,
      // and calling it "no theory yet" next to a 55% reads as a broken readout.
      const worst = Math.max(...rows.map((r) => r.player));
      if (worst >= 45) return setLine({ tone: 'caution', text: 'they are starting to look at you' });
      if (worst >= 25) return setLine({ tone: 'calm', text: 'someone is not sure about you' });
      return setLine({ tone: 'calm', text: 'no one has a theory yet' });
    });
    return off;
  }, [subscribe]);

  if (!line) return null;

  const color = {
    alarm: 'text-alarm',
    caution: 'text-caution',
    peer: 'text-[#c084fc]',
    calm: 'text-dim',
  }[line.tone];

  return (
    <div className={`-mt-1 text-center text-[10.5px] leading-tight ${color}`}>
      {line.text}
    </div>
  );
}
