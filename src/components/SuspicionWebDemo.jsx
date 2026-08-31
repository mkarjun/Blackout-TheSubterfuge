import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SuspicionWeb from './SuspicionWeb.jsx';

/**
 * SuspicionWebDemo - the landing page's moving argument.
 *
 * A stealth screenshot looks like every other stealth screenshot, and what this game
 * does is invisible in one. So the page runs the same SuspicionWeb the HUD mounts
 * against a scripted run: the room turns on you, you plant a keycard, the accusation
 * moves onto a guard, you leave while they argue. Swap the feed and it is the HUD.
 */

const CAST = [
  { id: 'NPC_TECH_1', name: 'Milo Frey' },
  { id: 'NPC_SCI_1', name: 'Dr. Imani Osei' },
  { id: 'NPC_GUARD_1', name: 'Vance Ruiz' },
  { id: 'NPC_CHIEF', name: 'Chief Dana Rook' },
  { id: 'NPC_SCI_2', name: 'Dr. Petra Kall' },
];

/** Vance is the mark. Everyone else can be talked into blaming him. */
const MARK = 'NPC_GUARD_1';

/**
 * Keyframes. `player` is per-cast-member suspicion of you, in CAST order; `blame` is
 * how hard the rest of the floor is pointing at the mark. Values between keys are
 * interpolated, so five rows of numbers produce a continuous scene.
 */
const SCRIPT = [
  {
    t: 0,
    caption: 'Five people on shift. Nobody has seen anything yet.',
    heat: 6,
    player: [5, 8, 4, 10, 6],
    blame: 0,
  },
  {
    t: 5.5,
    caption: 'You overload the generator. Milo hears it two rooms away.',
    heat: 44,
    player: [58, 22, 31, 46, 18],
    blame: 0,
  },
  {
    t: 10,
    caption: 'Security is asking who was on this floor. It is pointing at you.',
    heat: 63,
    player: [74, 41, 38, 67, 33],
    blame: 4,
  },
  {
    t: 14,
    caption: "You plant Vance's keycard in the vault, and tell Imani where to look.",
    heat: 58,
    player: [66, 35, 30, 58, 29],
    blame: 34,
  },
  {
    t: 19,
    caption: 'She tells Petra. Petra tells the Chief. You never say it twice.',
    heat: 34,
    player: [41, 19, 17, 33, 15],
    blame: 68,
  },
  {
    t: 24,
    caption: 'The floor has a theory, and it is not you. Walk to the door.',
    heat: 11,
    player: [17, 8, 9, 14, 7],
    blame: 86,
  },
  {
    t: 27.5,
    caption: 'The floor has a theory, and it is not you. Walk to the door.',
    heat: 6,
    player: [5, 8, 4, 10, 6],
    blame: 0,
  },
];

const LOOP_SECONDS = SCRIPT[SCRIPT.length - 1].t;

const lerp = (a, b, k) => a + (b - a) * k;

/** Sample the script at time `t` seconds, wrapped into the loop. */
function sampleAt(t) {
  const time = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  let i = 0;
  while (i < SCRIPT.length - 2 && SCRIPT[i + 1].t <= time) i++;
  const a = SCRIPT[i];
  const b = SCRIPT[i + 1];
  const k = Math.min(1, Math.max(0, (time - a.t) / (b.t - a.t)));
  // Ease so values settle rather than ramping linearly - the simulation does not
  // move in straight lines either.
  const e = k * k * (3 - 2 * k);

  const blame = lerp(a.blame, b.blame, e);
  const suspicion = CAST.map((member, idx) => {
    const player = Math.round(lerp(a.player[idx], b.player[idx], e));
    const peers = {};
    if (member.id !== MARK && blame > 1) {
      // Stagger the spread so the accusation visibly travels person to person
      // instead of every edge lighting up on the same frame.
      const delay = [0, 0.55, 0, 1, 0.8][idx];
      peers[MARK] = Math.max(0, Math.round(blame * (1 - delay * 0.35)));
    }
    return {
      id: member.id,
      name: member.name,
      player,
      peers,
      emotion: 'WARY',
      fsm: 'PATROL',
      thinking: false,
    };
  });

  // Captions describe a *state*, so the line has to flip to the one being moved
  // toward rather than lagging a whole beat behind the numbers on screen.
  const caption = e > 0.25 ? b.caption : a.caption;

  return { suspicion, heat: Math.round(lerp(a.heat, b.heat, e)), caption, phase: i };
}

export default function SuspicionWebDemo({ size = 300 }) {
  // SuspicionWeb subscribes twice - once for the canvas, once for the verdict line -
  // so this has to be a set, not a single slot.
  const listenersRef = useRef(new Set());
  const barRef = useRef(null);
  const [caption, setCaption] = useState(SCRIPT[0].caption);

  // Stable identity: SuspicionWeb re-subscribes whenever this changes, and it must
  // not change on every caption update.
  const subscribe = useCallback((cb) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);

  useEffect(() => {
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    let lastCaption = null;

    const step = (now) => {
      // Reduced motion gets the payoff frame, held still.
      const t = reduced ? 24 : (now - start) / 1000;
      const frame = sampleAt(t);
      for (const cb of listenersRef.current) cb(frame);
      if (frame.caption !== lastCaption) {
        lastCaption = frame.caption;
        setCaption(frame.caption);
      }
      // The bar is written straight to the DOM: at 60fps a setState here would be
      // sixty React renders a second for one changing width.
      if (barRef.current) {
        barRef.current.style.width = `${((t % LOOP_SECONDS) / LOOP_SECONDS) * 100}%`;
      }
      if (!reduced) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const web = useMemo(
    () => <SuspicionWeb size={size} subscribe={subscribe} />,
    [size, subscribe],
  );

  return (
    <div className="flex flex-col items-center">
      {web}
      <div className="mt-3 h-px w-full max-w-[340px] overflow-hidden bg-edge">
        <div ref={barRef} className="h-full bg-neon/50" style={{ width: '0%' }} />
      </div>
      <p className="mt-3 min-h-[34px] max-w-[340px] text-center text-[12px] leading-snug text-slate-400">
        {caption}
      </p>
    </div>
  );
}
