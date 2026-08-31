import React, { useCallback, useEffect, useRef, useState } from 'react';
import eventManager, { EVENTS } from '../game/systems/EventManager.js';
import touch from '../game/systems/TouchInput.js';

/**
 * TouchControls - the phone gamepad. Stick under the left thumb, actions under the
 * right, nothing in the middle where the game is.
 *
 * Four things here are load-bearing:
 *   - The stick floats: it spawns wherever the thumb lands in a large invisible zone,
 *     so you never look down to find it.
 *   - Buttons fire on `pointerdown`; waiting for `click` adds tap-resolution latency
 *     to every action.
 *   - Buttons are lit only when live (Use near a prop, Talk near a person, Plant when
 *     carrying), which is how the verbs get taught without a keybind table.
 *   - Sneak latches. A hold would cost a thumb the player has not got spare.
 *
 * Pointers are captured and the zones set `touch-action: none`, so dragging never
 * scrolls or zooms the page.
 */

/** Radius the knob can travel from the stick's origin, in CSS px. */
const STICK_RADIUS = 58;

export default function TouchControls({ hidden = false }) {
  const [prompt, setPrompt] = useState(null);
  const [sneaking, setSneaking] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const [hackIn, setHackIn] = useState(0);
  const [talkTarget, setTalkTarget] = useState(null);

  useEffect(() => {
    touch.setActive(true);
    return () => touch.setActive(false);
  }, []);

  useEffect(() => eventManager.on(EVENTS.INTERACT_PROMPT, setPrompt, { replay: true }), []);

  useEffect(() => eventManager.on(EVENTS.GAME_TICK, (tick) => {
    setCarrying((tick?.inventory?.length ?? 0) > 0);
    setHackIn(tick?.hackReadyIn ?? 0);
    setTalkTarget(tick?.talkTarget ?? null);
  }, { replay: true }), []);

  const promptKey = prompt?.key || null;
  const channelling = Boolean(prompt?.progress !== undefined && prompt?.progress !== null);

  const fire = useCallback((action) => {
    touch.press(action);
  }, []);

  const toggleSneak = useCallback(() => {
    setSneaking((prev) => {
      touch.setSneak(!prev);
      return !prev;
    });
  }, []);

  if (hidden) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      <Stick />

      {/* ------------------------------------------------- action cluster */}
      <div
        className="pointer-events-none absolute bottom-0 right-0 h-[230px] w-[268px]"
        style={{ touchAction: 'none' }}
      >
        <ActionButton
          label={channelling ? 'Stop' : 'Use'}
          sub={promptKey === 'E' ? shortLabel(prompt?.label) : null}
          size={88}
          style={{ right: 12, bottom: 14 }}
          tone={channelling ? 'alarm' : 'primary'}
          enabled={promptKey === 'E'}
          onPress={() => fire('interact')}
        />

        <ActionButton
          label="Talk"
          sub={talkTarget ? firstName(talkTarget) : null}
          size={62}
          style={{ right: 28, bottom: 112 }}
          enabled={Boolean(talkTarget)}
          onPress={() => fire('talk')}
        />

        <ActionButton
          label="Plant"
          size={58}
          style={{ right: 108, bottom: 118 }}
          enabled={carrying}
          onPress={() => fire('plant')}
        />

        <ActionButton
          label="Lights"
          sub={hackIn > 0 ? `${hackIn}s` : null}
          size={62}
          style={{ right: 112, bottom: 34 }}
          enabled={hackIn === 0}
          onPress={() => fire('hack')}
        />

        <ActionButton
          label="Sneak"
          size={64}
          style={{ right: 192, bottom: 16 }}
          tone={sneaking ? 'active' : 'default'}
          enabled
          onPress={toggleSneak}
          latching
        />
      </div>
    </div>
  );
}

/** The given name, so the Talk button can say who it will talk to. */
function firstName(name) {
  const parts = String(name).split(/\s+/).filter(Boolean);
  const skip = /^(dr|mr|mrs|ms|prof|chief)\.?$/i;
  return (parts.find((part) => !skip.test(part)) || parts[0] || '').slice(0, 8);
}

/** Trim a scene prompt down to something that fits on a thumb-sized button. */
function shortLabel(label) {
  if (!label) return null;
  const clean = String(label).replace(/\s*\(.*\)\s*$/, '');
  return clean.length > 16 ? `${clean.slice(0, 15)}...` : clean;
}

/* -------------------------------------------------------------- the stick */

function Stick() {
  const zoneRef = useRef(null);
  const ringRef = useRef(null);
  const knobRef = useRef(null);
  const hintRef = useRef(null);
  const pointerRef = useRef(null);
  const originRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const zone = zoneRef.current;
    const ring = ringRef.current;
    const knob = knobRef.current;
    if (!zone || !ring || !knob) return undefined;

    const show = (x, y) => {
      originRef.current = { x, y };
      const rect = zone.getBoundingClientRect();
      ring.style.left = `${x - rect.left}px`;
      ring.style.top = `${y - rect.top}px`;
      ring.style.opacity = '1';
      knob.style.transform = 'translate(-50%, -50%)';
    };

    const hide = () => {
      ring.style.opacity = '0';
      knob.style.transform = 'translate(-50%, -50%)';
      touch.setAxis(0, 0);
    };

    const move = (x, y) => {
      const dx = x - originRef.current.x;
      const dy = y - originRef.current.y;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, STICK_RADIUS);
      const nx = dist ? (dx / dist) * clamped : 0;
      const ny = dist ? (dy / dist) * clamped : 0;
      knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
      touch.setAxis(nx / STICK_RADIUS, ny / STICK_RADIUS);
    };

    const onDown = (e) => {
      if (pointerRef.current !== null) return;
      pointerRef.current = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      show(e.clientX, e.clientY);
      // The hint has done its job the first time a thumb lands. It never comes back.
      if (hintRef.current) hintRef.current.style.display = 'none';
      e.preventDefault();
    };

    const onMove = (e) => {
      if (pointerRef.current !== e.pointerId) return;
      move(e.clientX, e.clientY);
      e.preventDefault();
    };

    const onUp = (e) => {
      if (pointerRef.current !== e.pointerId) return;
      pointerRef.current = null;
      try { zone.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      hide();
    };

    zone.addEventListener('pointerdown', onDown);
    zone.addEventListener('pointermove', onMove);
    zone.addEventListener('pointerup', onUp);
    zone.addEventListener('pointercancel', onUp);
    return () => {
      zone.removeEventListener('pointerdown', onDown);
      zone.removeEventListener('pointermove', onMove);
      zone.removeEventListener('pointerup', onUp);
      zone.removeEventListener('pointercancel', onUp);
      touch.setAxis(0, 0);
    };
  }, []);

  return (
    <div
      ref={zoneRef}
      className="pointer-events-auto absolute bottom-0 left-0 h-[62%] w-[46%]"
      style={{ touchAction: 'none' }}
    >
      <div
        ref={ringRef}
        className="pointer-events-none absolute opacity-0 transition-opacity duration-150"
        style={{ transform: 'translate(-50%, -50%)' }}
      >
        <div
          className="rounded-full border-2 border-neon/35 bg-ink/30 backdrop-blur-[1px]"
          style={{
            width: STICK_RADIUS * 2,
            height: STICK_RADIUS * 2,
            transform: 'translate(-50%, -50%)',
          }}
        />
        <div
          ref={knobRef}
          className="absolute left-0 top-0 rounded-full border border-neon/70 bg-neon/25"
          style={{ width: 54, height: 54, transform: 'translate(-50%, -50%)' }}
        />
      </div>

      {/*
        Where to put the thumb, until a thumb goes there. Pinned to the far corner
        rather than the middle of the zone, which is where the player's own body sits
        - the old placement printed the hint straight across the character.
      */}
      <span
        ref={hintRef}
        className="pointer-events-none absolute bottom-4 left-4 rounded border border-edge/60
                   bg-ink/50 px-2 py-1 text-[9px] uppercase tracking-[0.18em] text-dim/80"
      >
        drag here to move
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- one button */

function ActionButton({
  label, sub, size, style, onPress, enabled = true, tone = 'default', latching = false,
}) {
  const [held, setHeld] = useState(false);

  const tones = {
    default: 'border-slate-400/40 bg-ink/55 text-slate-200',
    primary: 'border-neon/70 bg-neon/20 text-neon',
    alarm: 'border-alarm/70 bg-alarm/20 text-alarm',
    active: 'border-caution/80 bg-caution/25 text-caution',
  };

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={latching ? tone === 'active' : undefined}
      disabled={!enabled}
      onPointerDown={(e) => {
        e.preventDefault();
        if (!enabled) return;
        setHeld(true);
        onPress();
      }}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-auto absolute flex flex-col items-center justify-center rounded-full
                  border-2 backdrop-blur-sm transition-[transform,opacity,background-color] duration-100
                  ${tones[tone]} ${enabled ? '' : 'opacity-25'} ${held ? 'scale-95 brightness-150' : ''}`}
      style={{ ...style, width: size, height: size, touchAction: 'none' }}
    >
      <span
        className="font-semibold uppercase leading-none tracking-wider"
        style={{ fontSize: Math.max(9, size * 0.145) }}
      >
        {label}
      </span>
      {sub && (
        <span className="mt-1 max-w-[92%] truncate text-[8.5px] leading-none opacity-70">
          {sub}
        </span>
      )}
    </button>
  );
}
