import React, { useCallback, useEffect, useRef, useState } from 'react';
import eventManager, { EVENTS } from '../game/systems/EventManager.js';
import InventoryUI from './InventoryUI.jsx';
import DialoguePanel from './DialoguePanel.jsx';
import Minimap from './Minimap.jsx';
import HudPanel from './HudPanel.jsx';
import SuspicionWeb from './SuspicionWeb.jsx';
import FirstRunCoach from './FirstRunCoach.jsx';
import TouchControls from './TouchControls.jsx';
import RotateHint from './RotateHint.jsx';
import { useIsTouch, useIsPortrait } from './useDevice.js';
import sfx from '../game/systems/Sfx.js';
import {
  IconCoffee, IconPlay, IconPause, IconEye, IconEyeOff, IconSound, IconMuted,
  IconGear, IconRestart, IconExit, IconSpark, IconCloud, IconUsers,
} from './Icons.jsx';

/**
 * GameOverlay - the React HUD floating above the Phaser canvas.
 *
 * The root is pointer-events-none so the canvas keeps the mouse; individual panels
 * opt back in. Every value here arrives on the event bus (GAME_TICK at 4Hz), so this
 * component never reaches into a scene and re-renders are bounded.
 *
 * Three layout rules, each one fixing something the previous version broke:
 *   - Nothing sits on top of the player. Panels live in two narrow gutters and fade
 *     when the body walks under them (see HudPanel).
 *   - All of it can go away. Tab or the eye button clears the screen to the floor,
 *     and each panel folds to its title bar on its own.
 *   - Controls are icons. Seven identical text buttons in a row read as clutter.
 */

/** Subscribe to one bus event as React state. */
function useGameEvent(event, initial = null, { replay = true } = {}) {
  const [value, setValue] = useState(() => eventManager.last(event, initial));
  useEffect(() => eventManager.on(event, setValue, { replay }), [event, replay]);
  return value;
}

const ALERT_LABEL = ['CALM', 'UNEASY', 'ALARM', 'LOCKDOWN'];

const HUD_VISIBLE_KEY = 'blackout:hudVisible';

/** Below this the two gutters would take most of the screen, so they start hidden. */
const WIDE_ENOUGH = '(min-width: 1024px)';

/** Window size, for the handful of layout decisions CSS cannot make on its own. */
function useViewport() {
  const [size, setSize] = useState(() => ({
    w: globalThis.innerWidth || 1280,
    h: globalThis.innerHeight || 720,
  }));
  useEffect(() => {
    const on = () => setSize({ w: globalThis.innerWidth, h: globalThis.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

export default function GameOverlay({
  onOpenApi, onOpenAuth, onRestart, onExit, onOpenSupport, modalOpen = false,
}) {
  const tick = useGameEvent(EVENTS.GAME_TICK, null);
  const gameOver = useGameEvent(EVENTS.GAME_OVER, null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(sfx.isMuted());
  const [menuOpen, setMenuOpen] = useState(false);
  const [coachStep, setCoachStep] = useState(-1);
  const viewport = useViewport();
  const isTouch = useIsTouch();
  const isPortrait = useIsPortrait();
  const [hudVisible, setHudVisible] = useState(() => {
    const stored = localStorage.getItem(HUD_VISIBLE_KEY);
    // An explicit choice wins; otherwise a narrow window starts clean, because two
    // 260px gutters on a 900px screen is most of the screen.
    if (stored !== null) return stored !== '0';
    return globalThis.matchMedia?.(WIDE_ENOUGH).matches ?? true;
  });

  // The suspicion graph is the tallest thing in the right gutter. On a short window
  // it shrinks rather than pushing the radar off the bottom.
  const webSize = Math.max(170, Math.min(250, viewport.h - 430));

  /*
   * Phone layout is a different arrangement, not a scaled-down desktop one. Both
   * bottom corners belong to the thumbs - stick on the left, actions on the right -
   * so the radar leaves the bottom right (where it was sitting *underneath* the Use
   * button) and docks under the toolbar instead, the way a shooter does it. The
   * gutters stop short of the control zone so an opened panel can never swallow a
   * thumb.
   */
  const radarSize = isTouch ? 118 : 190;
  const gutterBottom = isTouch ? 'bottom-[132px]' : 'bottom-3';
  const rightGutterTop = isTouch ? 'top-[150px]' : 'top-16';

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      eventManager.emit(next ? EVENTS.REQUEST_PAUSE : EVENTS.REQUEST_RESUME);
      return next;
    });
  }, []);

  // Reading the AI settings or the support page should not cost you the run. The
  // explicit pause is tracked separately so closing a modal you opened *while*
  // paused does not silently un-pause the floor underneath you.
  const explicitPause = useRef(false);
  useEffect(() => { explicitPause.current = paused; }, [paused]);

  useEffect(() => {
    if (!modalOpen || gameOver) return undefined;
    eventManager.emit(EVENTS.REQUEST_PAUSE);
    return () => {
      if (!explicitPause.current) eventManager.emit(EVENTS.REQUEST_RESUME);
    };
  }, [modalOpen, gameOver]);

  const toggleHud = useCallback(() => {
    setHudVisible((prev) => {
      localStorage.setItem(HUD_VISIBLE_KEY, prev ? '0' : '1');
      return !prev;
    });
  }, []);

  const [dialogueOpen, setDialogueOpen] = useState(false);
  useEffect(() => {
    const offs = [
      eventManager.on(EVENTS.DIALOGUE_OPEN, () => setDialogueOpen(true)),
      eventManager.on(EVENTS.DIALOGUE_CLOSE, () => setDialogueOpen(false)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      // Never steal a key from a text field - the dialogue input lives in this tree.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      // A modal owns the keyboard while it is up; it closes itself on Escape.
      if (modalOpen) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        toggleHud();
        return;
      }
      if (e.key !== 'Escape') return;
      // Escape closes a conversation first; only a second press pauses.
      if (dialogueOpen) eventManager.emit(EVENTS.REQUEST_CLOSE_DIALOGUE);
      else if (menuOpen) setMenuOpen(false);
      else togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, toggleHud, dialogueOpen, menuOpen, modalOpen]);

  useEffect(() => {
    if (gameOver) setPaused(false);
  }, [gameOver]);

  const alert = tick?.alertLevel ?? 0;
  // Three reasons to clear the gutters:
  //   - the player asked (Tab / the eye button, or a narrow window on first load)
  //   - a conversation is open, and the panel to read is the one at the bottom
  //   - the walkthrough is still on "walk" and "sneak", where a job list and a
  //     gossip feed are noise. The HUD arrives as each step earns it, which is also
  //     what keeps the coach card from colliding with a gutter on a small screen.
  const coaching = coachStep >= 0 && coachStep < 2;
  const panelsHidden = !hudVisible || dialogueOpen || coaching;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* ------------------------------------------------------- status rail */}
      <StatusRail tick={tick} alert={alert} hidden={!hudVisible} />

      {/* ----------------------------------------------------------- toolbar */}
      <div className="pointer-events-auto absolute right-2 top-2 flex items-center gap-1 sm:right-3 sm:top-3">
        <IconButton label="Support the game" tone="support" onClick={onOpenSupport}>
          <IconCoffee />
        </IconButton>

        <div className="mx-1 h-5 w-px bg-edge" />

        <IconButton label={hudVisible ? 'Hide panels (Tab)' : 'Show panels (Tab)'} onClick={toggleHud}>
          {hudVisible ? <IconEye /> : <IconEyeOff />}
        </IconButton>
        <IconButton
          label={muted ? 'Unmute' : 'Mute'}
          onClick={() => { sfx.setMuted(!muted); setMuted(!muted); }}
        >
          {muted ? <IconMuted /> : <IconSound />}
        </IconButton>
        <IconButton label={paused ? 'Resume (Esc)' : 'Pause (Esc)'} onClick={togglePause}>
          {paused ? <IconPlay /> : <IconPause />}
        </IconButton>

        <div className="relative">
          <IconButton label="Settings" onClick={() => setMenuOpen((v) => !v)} active={menuOpen}>
            <IconGear />
          </IconButton>
          {menuOpen && (
            <SettingsMenu
              onClose={() => setMenuOpen(false)}
              onOpenApi={onOpenApi}
              onOpenAuth={onOpenAuth}
              onRestart={onRestart}
              onExit={onExit}
              cognition={tick?.cognition}
            />
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- left gutter */}
      <div className={`absolute left-3 top-16 flex max-w-[calc(50vw-16px)] w-[250px] min-h-0 flex-col gap-2 overflow-hidden ${gutterBottom}`}>
        <HudPanel
          id="run"
          title="The job"
          badge={<Badge>{tick?.objectives?.done ?? 0}/3</Badge>}
          hidden={panelsHidden}
        >
          <InventoryUI inventory={tick?.inventory || []} objectives={tick?.objectives || {}} />
        </HudPanel>

        <HudPanel
          id="feed"
          title="Floor activity"
          hidden={panelsHidden}
          className="flex min-h-0 flex-1 flex-col"
          bodyClassName="min-h-0 flex-1 overflow-y-auto"
        >
          <EventFeed />
        </HudPanel>
      </div>

      {/* ------------------------------------------------------ right gutter */}
      <div className={`absolute right-3 flex max-w-[calc(50vw-16px)] w-[268px] min-h-0 flex-col items-end gap-2 overflow-hidden ${rightGutterTop} ${gutterBottom}`}>
        <HudPanel
          id="web"
          title="The theory"
          hidden={panelsHidden}
          className="w-full"
          badge={<Badge tone={(tick?.heat ?? 0) >= 70 ? 'alarm' : (tick?.heat ?? 0) >= 40 ? 'caution' : 'neon'}>
            {tick?.heat ?? 0}% heat
          </Badge>}
        >
          <SuspicionWeb size={webSize} />
        </HudPanel>

        <HudPanel
          id="cognition"
          title="Cognitive layer"
          hidden={panelsHidden}
          defaultCollapsed
          className="w-full"
          icon={<IconSpark size={13} />}
        >
          <CognitionStrip stats={tick?.cognition} />
        </HudPanel>

        {!isTouch && (
          <>
            <div className="flex-1" />
            <MinimapDock hidden={!hudVisible} size={radarSize} />
          </>
        )}
      </div>

      {/* On a phone the radar gets its own dock under the toolbar, clear of both thumbs. */}
      {isTouch && (
        <div className="absolute right-2 top-14">
          <MinimapDock hidden={!hudVisible} size={radarSize} />
        </div>
      )}

      {!hudVisible && !gameOver && !isTouch && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.2em] text-dim/70">
          Tab to bring the panels back
        </div>
      )}

      <DialoguePanel />
      <FirstRunCoach active={!gameOver && !paused} onStep={setCoachStep} touch={isTouch} />

      {isTouch && (
        <TouchControls hidden={paused || Boolean(gameOver) || dialogueOpen || isPortrait} />
      )}
      {isTouch && isPortrait && <RotateHint />}

      {paused && !gameOver && (
        <PauseOverlay
          onResume={togglePause}
          onRestart={onRestart}
          onExit={onExit}
          onOpenSupport={onOpenSupport}
        />
      )}

      {gameOver && (
        <GameOverModal
          result={gameOver}
          onRestart={onRestart}
          onExit={onExit}
          onOpenSupport={onOpenSupport}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * The four numbers you read without taking your hands off the keys. Kept on one
 * line, top left, and faded like any other panel when the player walks under it -
 * which happens at the top edge of every map.
 */
function StatusRail({ tick, alert, hidden }) {
  const heat = tick?.heat ?? 0;
  return (
    <HudPanel
      id="status"
      hidden={hidden}
      chrome={false}
      className="absolute left-3 top-3"
      bodyClassName="px-3 py-2"
    >
      <div className="flex items-center gap-4">
        <Stat label="clock" value={tick?.clock || '00:00'} />
        <Stat label="location" value={tick?.room || '-'} />
        <Stat
          label="facility"
          value={ALERT_LABEL[alert] || 'CALM'}
          tone={alert >= 2 ? 'alarm' : alert === 1 ? 'caution' : 'neon'}
        />
        <Stat
          label="heat"
          value={`${heat}%`}
          tone={heat >= 70 ? 'alarm' : heat >= 40 ? 'caution' : 'neon'}
        />
      </div>
    </HudPanel>
  );
}

/**
 * The minimap is the one thing that must never fade - it is how you navigate, and
 * you read it precisely when you are moving. It gets its own dock rather than a
 * HudPanel, and the global hide still clears it.
 */
function MinimapDock({ hidden, size }) {
  return (
    <div
      className={`pointer-events-none transition-opacity duration-200 ${
        hidden ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <Minimap size={size} />
    </div>
  );
}

function IconButton({ children, label, onClick, tone = 'default', active = false }) {
  const tones = {
    default: 'border-edge bg-panel/85 text-slate-300 hover:border-neon/60 hover:text-neon',
    support: 'border-caution/50 bg-caution/10 text-caution hover:border-caution hover:bg-caution/20',
    danger: 'border-alarm/50 bg-alarm/10 text-alarm hover:bg-alarm/20',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`group relative grid h-8 w-8 place-items-center rounded border backdrop-blur-sm
                  transition-colors ${tones[tone]} ${active ? 'border-neon/60 text-neon' : ''}`}
    >
      {children}
      <span
        className="pointer-events-none absolute right-0 top-9 z-10 hidden whitespace-nowrap rounded
                   border border-edge bg-panel px-2 py-1 text-[10px] text-slate-300 group-hover:block"
      >
        {label}
      </span>
    </button>
  );
}

function SettingsMenu({ onClose, onOpenApi, onOpenAuth, onRestart, onExit, cognition }) {
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    // Deferred so the click that opened the menu does not immediately close it.
    const id = setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
    return () => { clearTimeout(id); document.removeEventListener('pointerdown', onDown); };
  }, [onClose]);

  const item = 'flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-[12px] '
    + 'text-slate-300 transition-colors hover:bg-neon/10 hover:text-neon';

  return (
    <div
      ref={ref}
      className="panel absolute right-0 top-10 z-20 w-56 p-1.5"
    >
      <button className={item} onClick={() => { onClose(); onOpenApi(); }}>
        <IconSpark size={14} /> AI provider
      </button>
      <button className={item} onClick={() => { onClose(); onOpenAuth(); }}>
        <IconCloud size={14} /> Saves &amp; cloud sync
      </button>
      <div className="my-1 h-px bg-edge" />
      <button className={item} onClick={() => { onClose(); onRestart(); }}>
        <IconRestart size={14} /> Restart run
      </button>
      <button
        className={`${item} text-alarm/90 hover:bg-alarm/10 hover:text-alarm`}
        onClick={() => { onClose(); onExit(); }}
      >
        <IconExit size={14} /> Exit to title
      </button>
      {cognition && (
        <div className="mt-1 border-t border-edge px-2 pb-0.5 pt-1.5 text-[10px] leading-relaxed text-dim">
          {cognition.enabled
            ? <>Dialogue: <span className="text-neon">{cognition.model}</span></>
            : <>Dialogue: <span className="text-caution">local rules</span>. Connect a model for improvised lines.</>}
        </div>
      )}
    </div>
  );
}

function Badge({ children, tone = 'dim' }) {
  const color = {
    dim: 'text-dim',
    neon: 'text-neon',
    caution: 'text-caution',
    alarm: 'text-alarm',
  }[tone];
  return <span className={`shrink-0 text-[9.5px] tabular-nums ${color}`}>{children}</span>;
}

function Stat({ label, value, tone = 'default' }) {
  const color = {
    neon: 'text-neon',
    caution: 'text-caution',
    alarm: 'text-alarm',
    default: 'text-slate-200',
  }[tone];
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.16em] text-dim">{label}</div>
      <div className={`text-[13px] font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function shortId(id) {
  return String(id).replace('NPC_', '').replace(/_\d+$/, '').toLowerCase();
}

const TONE_COLOR = {
  info: 'text-slate-400',
  warn: 'text-caution',
  alarm: 'text-alarm',
  success: 'text-neon',
};

function EventFeed() {
  const [entries, setEntries] = useState([]);
  const seq = useRef(0);

  useEffect(() => {
    const offs = [
      eventManager.on(EVENTS.WORLD_EVENT, (row) => {
        seq.current += 1;
        setEntries((prev) => [...prev.slice(-24), { ...row, key: seq.current }]);
      }),
      eventManager.on(EVENTS.NPC_SPEAK, (row) => {
        seq.current += 1;
        setEntries((prev) => [...prev.slice(-24), {
          key: seq.current,
          tone: 'info',
          speech: true,
          detail: `${row.name}: "${row.text}"`,
          source: row.source,
        }]);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const visible = entries.slice(-12);

  return (
    <div className="flex flex-col-reverse gap-1.5">
      {[...visible].reverse().map((row) => (
        <div key={row.key} className="animate-slidein text-[11px] leading-snug">
          <span className={TONE_COLOR[row.tone] || 'text-slate-400'}>
            {row.speech ? '' : '> '}{row.detail}
          </span>
          {row.speech && row.source === 'rules' && (
            <span className="ml-1 text-[9px] text-slate-600">[local]</span>
          )}
        </div>
      ))}
      {visible.length === 0 && <div className="text-[11px] text-dim">Nothing yet. Stay quiet.</div>}
    </div>
  );
}

function CognitionStrip({ stats }) {
  if (!stats) return <div className="text-[11px] text-dim">Not running.</div>;
  const llm = stats.llm || {};
  return (
    <div>
      <div className="mb-1.5 text-[10px]">
        <span className={stats.enabled ? 'text-neon' : 'text-caution'}>
          {stats.enabled ? `${stats.provider} / ${stats.model}` : 'rule-based fallback'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-[10px] text-dim">
        <Metric label="reqs" value={stats.requested} />
        <Metric label="model" value={stats.llmOk} />
        <Metric label="local" value={stats.fallback} />
        <Metric label="avg ms" value={llm.avgLatency || 0} />
      </div>
      {stats.queued + stats.inFlight > 0 && (
        <div className="mt-1 text-[9px] text-slate-500">
          {stats.inFlight} thinking, {stats.queued} queued - the floor keeps moving regardless
        </div>
      )}
      {llm.lastError && (
        <div className="mt-1 truncate text-[9px] text-alarm/80" title={llm.lastError}>
          {llm.lastError}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="text-[11px] tabular-nums text-slate-300">{value}</div>
    </div>
  );
}

function PauseOverlay({ onResume, onRestart, onExit, onOpenSupport }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink/70 backdrop-blur-[2px]">
      <div className="panel w-[380px] max-w-[92vw] p-6 text-center">
        <div className="text-lg tracking-[0.3em] text-neon">PAUSED</div>
        <div className="mt-2 text-[11px] text-dim">The floor is frozen. Esc to go back in.</div>
        <div className="mt-5 flex flex-col gap-2">
          <button className="btn-primary py-2" onClick={onResume}>Resume</button>
          <div className="flex gap-2">
            <button className="btn flex-1 py-2" onClick={onRestart}>Restart</button>
            <button className="btn-danger flex-1 py-2" onClick={onExit}>Exit to title</button>
          </div>
        </div>
        <SupportNudge onClick={onOpenSupport} className="mt-5" />
      </div>
    </div>
  );
}

/** The ask, shown after a run or on the pause screen. Never during play. */
export function SupportNudge({ onClick, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-2.5 rounded border border-caution/40
                  bg-caution/[0.07] px-4 py-2.5 text-[11.5px] text-caution transition-colors
                  hover:border-caution/80 hover:bg-caution/15 ${className}`}
    >
      <IconCoffee size={16} />
      <span>Free, and staying free &mdash; buy me a coffee</span>
    </button>
  );
}

function GameOverModal({ result, onRestart, onExit, onOpenSupport }) {
  const won = result.outcome === 'won';
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-y-auto bg-ink/85 p-4 backdrop-blur-[2px]">
      <div className="panel w-[520px] max-w-[92vw] p-6">
        <div className={`text-[11px] uppercase tracking-[0.4em] ${won ? 'text-neon' : 'text-alarm'}`}>
          {won ? 'Extraction complete' : 'Run terminated'}
        </div>
        <h2 className="mt-2 text-2xl font-semibold text-slate-100">
          {won ? 'You walked out clean' : 'They got you'}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{result.reason}</p>

        <div className="mt-4 grid grid-cols-3 gap-3 border-y border-edge py-3 text-center">
          <div>
            <div className="text-[9px] uppercase tracking-widest text-dim">time</div>
            <div className="text-[15px] text-slate-200">{result.clock}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-widest text-dim">systems</div>
            <div className="text-[15px] text-slate-200">{result.objectives?.done ?? 0}/3</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-widest text-dim">peak heat</div>
            <div className="text-[15px] text-slate-200">{result.suspicion?.heat ?? 0}%</div>
          </div>
        </div>

        <div className="mt-3 space-y-1">
          <div className="panel-title flex items-center gap-1.5">
            <IconUsers size={12} /> Where suspicion landed
          </div>
          {(result.suspicion?.rows || []).map((row) => {
            const topPeer = Object.entries(row.peers || {}).sort((a, b) => b[1] - a[1])[0];
            return (
              <div key={row.id} className="flex justify-between text-[11px]">
                <span className="text-slate-400">{row.name}</span>
                <span className="text-dim">
                  you {row.player}%
                  {topPeer ? ` / ${shortId(topPeer[0])} ${topPeer[1]}%` : ''}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex gap-2">
          <button className="btn-primary flex-1 py-2.5 text-[12px]" onClick={onRestart}>
            Run it again
          </button>
          <button className="btn px-4" onClick={onExit}>Exit to title</button>
        </div>

        <SupportNudge onClick={onOpenSupport} className="mt-3" />
      </div>
    </div>
  );
}
