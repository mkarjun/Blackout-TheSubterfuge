import React, { useEffect, useRef, useState } from 'react';
import eventManager, { EVENTS } from '../game/systems/EventManager.js';
import { IconClose } from './Icons.jsx';

/**
 * FirstRunCoach - the first ninety seconds.
 *
 * One instruction at a time, each clearing itself the moment the player does the
 * thing. No modal and no "next" button: it advances on evidence from the simulation,
 * so someone who already knows the verbs clears all five in about fifteen seconds.
 * This replaces a table of seven keybinds shown before anyone had seen the game move.
 *
 * Steps carry both keyboard and touch copy - a phone player is told to drag and tap
 * Use, never to press E. Shown once per browser, skippable on the first card.
 */

const SEEN_KEY = 'blackout:coached';

const STEPS = [
  {
    id: 'move',
    key: 'WASD',
    touchKey: 'Drag',
    title: 'Walk the floor',
    body: 'Arrows work too. Five people are on shift and none of them know you.',
    touchBody: 'Put a thumb anywhere on the left half and drag. Push it gently to creep.',
  },
  {
    id: 'sneak',
    key: 'Shift',
    touchKey: 'Sneak',
    title: 'Hold to sneak',
    touchTitle: 'Tap Sneak',
    body: 'Silent, and far harder to spot. Slow, though - it costs you the clock.',
    touchBody: 'Bottom right. Silent and far harder to spot, but it costs you the clock.',
  },
  {
    id: 'talk',
    key: 'Space',
    touchKey: 'Talk',
    title: 'Talk to whoever is nearest',
    body: 'Say anything. They answer in character, they remember it, and they repeat it to each other.',
    touchBody: 'The Talk button lights up with a name on it. They answer in character, and they repeat what you say to each other.',
  },
  {
    id: 'sabotage',
    key: 'E',
    touchKey: 'Use',
    title: 'Hold at a marked system',
    touchTitle: 'Stand on a marked system and tap Use',
    body: 'Three of them on this floor. The radar bottom-right shows where. Do not get watched doing it.',
    touchBody: 'Three of them on this floor - the radar shows where. Do not get watched doing it.',
  },
  {
    id: 'read',
    key: null,
    title: 'Now watch the theory',
    body: 'Top right is who blames whom. Purple lines between them are good for you. Lines pointing at the middle are not.',
    autoAdvanceMs: 9000,
  },
];

export default function FirstRunCoach({ active = true, onStep, touch = false }) {
  const [index, setIndex] = useState(() => (localStorage.getItem(SEEN_KEY) ? STEPS.length : 0));
  const [dialogueOpen, setDialogueOpen] = useState(false);
  const movedRef = useRef(0);
  const lastPosRef = useRef(null);

  const step = STEPS[index] || null;
  const stepId = step?.id;

  // The HUD uses this to bring its panels in as the steps earn them, rather than
  // dropping the whole instrument panel on someone who has not walked yet.
  useEffect(() => {
    onStep?.(index >= STEPS.length ? -1 : index);
  }, [index, onStep]);

  const finish = () => {
    localStorage.setItem(SEEN_KEY, '1');
    setIndex(STEPS.length);
  };

  const advance = (from) => {
    setIndex((current) => {
      if (STEPS[current]?.id !== from) return current;
      const next = current + 1;
      if (next >= STEPS.length) localStorage.setItem(SEEN_KEY, '1');
      return next;
    });
  };

  // The panel hides itself during a conversation - the dialogue box is the lesson at
  // that point - but the step still completes underneath.
  useEffect(() => {
    const offs = [
      eventManager.on(EVENTS.DIALOGUE_OPEN, () => setDialogueOpen(true)),
      eventManager.on(EVENTS.DIALOGUE_CLOSE, () => setDialogueOpen(false)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  /* --------------------------------------------------- completion detectors */

  // Movement: accumulate real travel rather than firing on the first sub-pixel
  // nudge, so a player who bumps a wall does not clear the step by accident.
  useEffect(() => {
    if (stepId !== 'move') return undefined;
    movedRef.current = 0;
    lastPosRef.current = null;
    return eventManager.on(EVENTS.MINIMAP, ({ px, py }) => {
      const last = lastPosRef.current;
      lastPosRef.current = { px, py };
      if (!last) return;
      movedRef.current += Math.hypot(px - last.px, py - last.py);
      if (movedRef.current > 150) advance('move');
    });
  }, [stepId]);

  useEffect(() => {
    if (stepId !== 'sneak') return undefined;
    return eventManager.on(EVENTS.GAME_TICK, (tick) => {
      if (tick?.sneaking) advance('sneak');
    });
  }, [stepId]);

  useEffect(() => {
    if (stepId !== 'talk') return undefined;
    return eventManager.on(EVENTS.DIALOGUE_OPEN, () => advance('talk'));
  }, [stepId]);

  useEffect(() => {
    if (stepId !== 'sabotage') return undefined;
    return eventManager.on(EVENTS.GAME_TICK, (tick) => {
      if ((tick?.objectives?.done ?? 0) >= 1) advance('sabotage');
    });
  }, [stepId]);

  useEffect(() => {
    if (!step?.autoAdvanceMs) return undefined;
    const id = setTimeout(() => advance(step.id), step.autoAdvanceMs);
    return () => clearTimeout(id);
  }, [step?.id, step?.autoAdvanceMs]);

  if (!step || !active || dialogueOpen) return null;

  const label = (touch && step.touchKey) || step.key;
  const title = (touch && step.touchTitle) || step.title;
  const body = (touch && step.touchBody) || step.body;

  return (
    // Sits on its own row under the status rail and the toolbar, never across them.
    <div className="pointer-events-none absolute left-1/2 top-16 z-10 w-[420px] max-w-[calc(100vw-24px)] -translate-x-1/2">
      <div className="panel animate-slidein flex items-start gap-3 border-neon/30 px-3.5 py-2.5">
        {label ? (
          <kbd
            className="mt-0.5 shrink-0 rounded border border-neon/50 bg-neon/10 px-2 py-1 text-[11px]
                       font-semibold tracking-wide text-neon"
          >
            {label}
          </kbd>
        ) : (
          <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-neon" />
        )}

        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-slate-100">{title}</div>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{body}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            onClick={finish}
            aria-label="Skip the walkthrough"
            title="Skip the walkthrough"
            className="pointer-events-auto rounded p-1.5 text-dim transition-colors hover:text-slate-200"
          >
            <IconClose size={16} />
          </button>
          <span className="text-[9px] tabular-nums text-dim">
            {index + 1}/{STEPS.length}
          </span>
        </div>
      </div>
    </div>
  );
}
