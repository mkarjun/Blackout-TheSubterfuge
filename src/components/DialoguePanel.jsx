import React, { useEffect, useRef, useState } from 'react';
import eventManager, { EVENTS } from '../game/systems/EventManager.js';
import { getGame } from '../game/GameConfig.js';

/**
 * DialoguePanel - the interrogation surface.
 *
 * Two things here are load-bearing:
 *   1. While this panel is open Phaser's keyboard is disabled, otherwise typing "was"
 *      into the input walks the player across the room.
 *   2. The reply is *streamed by the game*, not by this component. The bubble over the
 *      NPC's head is the primary channel; this panel mirrors the last line plus the
 *      metadata a developer wants (source, latency), so you can see at a glance
 *      whether a line came from the model or the local fallback.
 */

const QUICK_LINES = [
  'What are you doing down here at this hour?',
  'Did you see anyone near the generator?',
  'The lights are not my doing. Ask maintenance.',
  'I am with the contractor crew. Relax.',
  'You look nervous. Something on your mind?',
];

export default function DialoguePanel() {
  const [dialogue, setDialogue] = useState(null);
  const [reply, setReply] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  // Event handlers are registered once; the ref is how they read the live partner
  // without re-subscribing on every state change.
  const partnerRef = useRef(null);
  useEffect(() => { partnerRef.current = dialogue ? dialogue.npcId : null; }, [dialogue]);

  useEffect(() => {
    const offs = [
      eventManager.on(EVENTS.DIALOGUE_OPEN, (payload) => {
        setDialogue(payload);
        setReply(null);
        setDraft('');
        setTimeout(() => inputRef.current?.focus(), 30);
      }),
      eventManager.on(EVENTS.DIALOGUE_CLOSE, () => {
        setDialogue(null);
        setReply(null);
      }),
      eventManager.on(EVENTS.NPC_SPEAK, (payload) => {
        if (payload.npcId !== partnerRef.current) return;
        setReply(payload);
      }),
      eventManager.on(EVENTS.NPC_THOUGHT, (payload) => {
        if (payload.npcId !== partnerRef.current) return;
        setReply((current) => (current && current.npcId === payload.npcId
          ? { ...current, thought: payload.thought, latencyMs: payload.latencyMs, intent: payload.intent }
          : current));
      }),
      eventManager.on(EVENTS.COGNITION_STATE, ({ npcId, thinking: isThinking }) => {
        if (npcId !== partnerRef.current) return;
        setThinking(isThinking);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Hand the keyboard to the DOM while the panel is open.
  useEffect(() => {
    const game = getGame();
    if (!game?.input?.keyboard) return undefined;
    game.input.keyboard.enabled = !dialogue;
    return () => {
      const g = getGame();
      if (g?.input?.keyboard) g.input.keyboard.enabled = true;
    };
  }, [dialogue]);

  if (!dialogue) return null;

  const send = (text, accuse = null) => {
    const line = String(text || '').trim();
    if (!line) return;
    setReply(null);
    eventManager.emit(EVENTS.REQUEST_SAY, { text: line, accuse });
    setDraft('');
  };

  const close = () => eventManager.emit(EVENTS.REQUEST_CLOSE_DIALOGUE);

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 w-[560px] max-w-[92vw] -translate-x-1/2">
      <div className="panel p-3">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-slate-100">{dialogue.name}</div>
            <div className="text-[10px] text-dim">{dialogue.role}</div>
          </div>
          <div className="flex items-center gap-3">
            <SuspicionPip value={dialogue.suspicion} />
            <button className="btn" onClick={close}>Leave</button>
          </div>
        </div>

        <div className="mb-2 min-h-[46px] rounded border border-edge bg-ink/70 p-2">
          {thinking && !reply && (
            <div className="text-[12px] text-dim">
              <span className="animate-pulse">{dialogue.name} is thinking...</span>
            </div>
          )}
          {!thinking && !reply && (
            <div className="text-[12px] text-dim">Say something, or accuse someone and watch it spread.</div>
          )}
          {reply && (
            <>
              <div className="text-[12.5px] leading-snug text-slate-200">&ldquo;{reply.text}&rdquo;</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-dim">
                <span className={`rounded px-1.5 py-0.5 ${
                  reply.source === 'llm' ? 'bg-neon/10 text-neon' : 'bg-edge text-slate-400'
                }`}
                >
                  {reply.source === 'llm' ? 'model' : 'local rules'}
                </span>
                <span>{reply.emotion}</span>
                {reply.intent && <span>intent: {reply.intent}</span>}
                {reply.latencyMs ? <span>{reply.latencyMs}ms</span> : null}
                {reply.thought && <span className="italic text-slate-500">thinks: {reply.thought}</span>}
              </div>
            </>
          )}
        </div>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_LINES.map((line) => (
            <button key={line} className="btn text-left" onClick={() => send(line)}>
              {line.length > 38 ? `${line.slice(0, 36)}...` : line}
            </button>
          ))}
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-dim">Accuse</span>
          {dialogue.others.map((other) => (
            <button
              key={other.id}
              className="btn border-alarm/40 text-alarm/90 hover:border-alarm hover:text-alarm"
              onClick={() => send(`It was ${other.name}. I saw them where they should not have been.`, other.id)}
            >
              {other.name}
            </button>
          ))}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input
            ref={inputRef}
            className="field"
            value={draft}
            maxLength={160}
            placeholder="Say something in your own words..."
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
          />
          <button className="btn-primary" type="submit" disabled={!draft.trim()}>Say</button>
        </form>
      </div>
    </div>
  );
}

function SuspicionPip({ value = 0 }) {
  const color = value >= 70 ? 'text-alarm' : value >= 40 ? 'text-caution' : 'text-neon';
  return (
    <div className="text-right">
      <div className="text-[9px] uppercase tracking-widest text-dim">suspects you</div>
      <div className={`text-[13px] font-semibold ${color}`}>{value}%</div>
    </div>
  );
}
