import React, { useCallback, useEffect, useRef, useState } from 'react';
import eventManager, { EVENTS } from '../game/systems/EventManager.js';
import InventoryUI from './InventoryUI.jsx';
import DialoguePanel from './DialoguePanel.jsx';
import Minimap from './Minimap.jsx';
import sfx from '../game/systems/Sfx.js';

/**
 * GameOverlay - the React HUD floating above the Phaser canvas.
 *
 * The root is pointer-events-none so the canvas keeps the mouse; individual panels
 * opt back in. Every value here arrives on the event bus (GAME_TICK at 4Hz), so this
 * component never reaches into a scene and re-renders are bounded.
 */

/** Subscribe to one bus event as React state. */
function useGameEvent(event, initial = null, { replay = true } = {}) {
  const [value, setValue] = useState(() => eventManager.last(event, initial));
  useEffect(() => eventManager.on(event, setValue, { replay }), [event, replay]);
  return value;
}

const ALERT_LABEL = ['CALM', 'UNEASY', 'ALARM', 'LOCKDOWN'];

export default function GameOverlay({ onOpenApi, onOpenAuth, onRestart, onExit, onOpenSupport }) {
  const tick = useGameEvent(EVENTS.GAME_TICK, null);
  const gameOver = useGameEvent(EVENTS.GAME_OVER, null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(sfx.isMuted());

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      eventManager.emit(next ? EVENTS.REQUEST_PAUSE : EVENTS.REQUEST_RESUME);
      return next;
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
      if (e.key !== 'Escape') return;
      // Escape closes a conversation first; only a second press pauses.
      if (dialogueOpen) eventManager.emit(EVENTS.REQUEST_CLOSE_DIALOGUE);
      else togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, dialogueOpen]);

  useEffect(() => {
    if (gameOver) setPaused(false);
  }, [gameOver]);

  const alert = tick?.alertLevel ?? 0;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* ---------------------------------------------------------- top bar */}
      <div className="pointer-events-auto absolute left-3 top-3 flex items-stretch gap-2">
        <div className="panel flex items-center gap-4 px-3 py-2">
          <Stat label="clock" value={tick?.clock || '00:00'} />
          <Stat label="location" value={tick?.room || '-'} />
          <Stat
            label="facility"
            value={ALERT_LABEL[alert] || 'CALM'}
            tone={alert >= 3 ? 'alarm' : alert === 2 ? 'alarm' : alert === 1 ? 'caution' : 'neon'}
          />
          <Stat
            label="heat"
            value={`${tick?.heat ?? 0}%`}
            tone={(tick?.heat ?? 0) >= 70 ? 'alarm' : (tick?.heat ?? 0) >= 40 ? 'caution' : 'neon'}
          />
        </div>
      </div>

      <div className="pointer-events-auto absolute right-3 top-3 flex gap-1.5">
        <button className="btn" onClick={onOpenApi}>AI</button>
        <button className="btn" onClick={onOpenAuth}>Saves</button>
        <button className="btn" onClick={onOpenSupport}>Support</button>
        <button
          className="btn"
          onClick={() => { sfx.setMuted(!muted); setMuted(!muted); }}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button className="btn" onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>
        <button className="btn" onClick={onRestart}>Restart</button>
        <button className="btn-danger" onClick={onExit}>Exit</button>
      </div>

      {/* ------------------------------------------------------ left column */}
      <div className="pointer-events-auto absolute left-3 top-[68px] w-64">
        <SuspicionPanel rows={tick?.suspicion || []} />
      </div>

      <div className="pointer-events-auto absolute bottom-3 left-3">
        <InventoryUI inventory={tick?.inventory || []} objectives={tick?.objectives || {}} />
      </div>

      {/* ----------------------------------------------------- right column */}
      <div className="pointer-events-auto absolute right-3 top-[68px] w-80">
        <EventFeed />
      </div>

      <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col items-end gap-2">
        <div className="w-80">
          <CognitionStrip stats={tick?.cognition} />
        </div>
        <Minimap />
      </div>

      <DialoguePanel />

      {paused && !gameOver && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink/70">
          <div className="panel px-8 py-6 text-center">
            <div className="text-lg tracking-[0.3em] text-neon">PAUSED</div>
            <div className="mt-2 text-[11px] text-dim">Esc or Resume to continue.</div>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn" onClick={togglePause}>Resume</button>
              <button className="btn" onClick={onRestart}>Restart</button>
              <button className="btn-danger" onClick={onExit}>Exit to title</button>
            </div>
          </div>
        </div>
      )}

      {gameOver && <GameOverModal result={gameOver} onRestart={onRestart} onExit={onExit} />}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

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

function SuspicionPanel({ rows }) {
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="panel-title">Who suspects you</span>
        <span className="text-[9px] text-dim">live</span>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <div className="text-[11px] text-dim">Reading the floor...</div>}
        {rows.map((row) => {
          const topPeer = Object.entries(row.peers || {}).sort((a, b) => b[1] - a[1])[0];
          return (
            <div key={row.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11.5px] text-slate-300">
                  {row.name}
                  {row.thinking && <span className="ml-1 animate-pulse text-[9px] text-slate-500">thinking</span>}
                </span>
                <span
                  className={`text-[11px] tabular-nums ${
                    row.player >= 70 ? 'text-alarm' : row.player >= 40 ? 'text-caution' : 'text-dim'
                  }`}
                >
                  {row.player}%
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-edge">
                <div
                  className={`h-full transition-all duration-300 ${
                    row.player >= 70 ? 'bg-alarm' : row.player >= 40 ? 'bg-caution' : 'bg-neon'
                  }`}
                  style={{ width: `${Math.min(100, row.player)}%` }}
                />
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[9px] text-dim">
                <span>{row.emotion.toLowerCase()} / {row.fsm.toLowerCase()}</span>
                {topPeer && topPeer[1] >= 35 && (
                  <span className="text-[#c084fc]">blames {shortId(topPeer[0])} {topPeer[1]}%</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
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

  const visible = entries.slice(-9);

  return (
    <div className="panel flex max-h-[46vh] flex-col p-3">
      <div className="mb-2 panel-title">Floor activity</div>
      <div className="flex flex-col-reverse gap-1.5 overflow-y-auto">
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
    </div>
  );
}

function CognitionStrip({ stats }) {
  if (!stats) return null;
  const llm = stats.llm || {};
  return (
    <div className="panel px-3 py-2">
      <div className="flex items-center justify-between text-[10px]">
        <span className="panel-title">Cognitive layer</span>
        <span className={stats.enabled ? 'text-neon' : 'text-caution'}>
          {stats.enabled ? `${stats.provider} / ${stats.model}` : 'rule-based fallback'}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-2 text-[10px] text-dim">
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

function GameOverModal({ result, onRestart, onExit }) {
  const won = result.outcome === 'won';
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink/85">
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
          <div className="panel-title">Where suspicion landed</div>
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
          <button className="btn-primary flex-1" onClick={onRestart}>Run it again</button>
          <button className="btn" onClick={onExit}>Exit to title</button>
        </div>
      </div>
    </div>
  );
}
