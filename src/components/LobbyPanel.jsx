import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NetSession } from '../net/NetSession.js';
import { isValidRoomCode, makeRoomCode, normaliseRoomCode, MAX_PLAYERS } from '../net/protocol.js';
import { LEVEL_LIST } from '../assets/tilemaps/labMap.js';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../game/difficulty.js';

/**
 * LobbyPanel - room creation and the pre-run roster for Rival Infiltrators.
 *
 * The mode's premise, which the copy here has to carry because it is not the genre
 * players expect: you are not hunting each other and you are not lying to each other
 * in a chat box. You are both infiltrating the same floor, and the NPCs decide which
 * of you takes the blame. The other player is a rival for a verdict handed down by
 * the simulation.
 *
 * The host runs the authoritative simulation, so the host also owns level and
 * difficulty. Guests see the choice but cannot change it.
 */

export default function LobbyPanel({ onBack, onLaunch, levelId, difficulty, onSelectLevel, onSelectDifficulty }) {
  const sessionRef = useRef(null);
  const [name, setName] = useState(() => localStorage.getItem('blackout:name') || '');
  const [codeInput, setCodeInput] = useState('');
  const [status, setStatus] = useState(null);
  const [roster, setRoster] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  /** One session per mounted lobby; torn down on unmount unless a run launched. */
  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      sessionRef.current = new NetSession({ name: name || 'Infiltrator' });
    }
    sessionRef.current.name = name || 'Infiltrator';
    return sessionRef.current;
  }, [name]);

  useEffect(() => () => {
    // Leaving the lobby without launching should free the room.
    if (sessionRef.current && !sessionRef.current.started) sessionRef.current.leave();
  }, []);

  const wire = useCallback((session) => {
    session.on('status', setStatus);
    session.on('roster', setRoster);
    session.on('start', (msg) => onLaunch(session, msg));
  }, [onLaunch]);

  const doHost = async () => {
    setError(null);
    setBusy('host');
    try {
      const session = ensureSession();
      wire(session);
      const code = await session.host(makeRoomCode());
      localStorage.setItem('blackout:name', name || 'Infiltrator');
      setNotice(`Room ${code} is open. Share the code.`);
    } catch (err) {
      setError(err?.message || 'Could not open a room.');
    } finally {
      setBusy(null);
    }
  };

  const doJoin = async () => {
    const code = normaliseRoomCode(codeInput);
    if (!isValidRoomCode(code)) {
      setError('A room code is 5 characters.');
      return;
    }
    setError(null);
    setBusy('join');
    try {
      const session = ensureSession();
      wire(session);
      const result = await session.join(code);
      localStorage.setItem('blackout:name', name || 'Infiltrator');
      setNotice(result.role === 'host'
        ? `Nobody was in ${code}, so you are hosting it.`
        : `Joined ${code}.`);
    } catch (err) {
      setError(err?.message || 'Could not join that room.');
    } finally {
      setBusy(null);
    }
  };

  const doLeave = () => {
    sessionRef.current?.leave();
    sessionRef.current = null;
    setStatus(null);
    setRoster([]);
    setNotice(null);
  };

  const doStart = () => {
    const session = sessionRef.current;
    if (!session?.isHost) return;
    session.startRun({ levelId, difficulty, seed: Math.floor(Math.random() * 1e9) });
  };

  const inRoom = Boolean(status?.room && status?.connected);
  const isHost = Boolean(status?.isHost);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-3xl">
        <button
          onClick={onBack}
          className="mb-4 text-[10px] uppercase tracking-[0.2em] text-dim transition-colors hover:text-neon"
        >
          &larr; Back
        </button>

        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-[0.4em] text-neon/70">Rival infiltrators</div>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-100">
            Two spies. One verdict<span className="text-neon">.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dim">
            You both break into the same floor, and the staff track suspicion against each
            of you separately. Nobody votes. Nobody argues in a chat box. You win by walking
            out with the blame pointing at the other one &mdash; so plant your evidence in
            the room they were just seen in, and let the guard draw his own conclusion.
          </p>
        </div>

        {!inRoom && (
          <div className="panel mb-4 p-5">
            <label className="field-label" htmlFor="mp-name">Display name</label>
            <input
              id="mp-name"
              className="field mb-4"
              value={name}
              maxLength={16}
              placeholder="Infiltrator"
              onChange={(e) => setName(e.target.value)}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="panel-title mb-2">Open a room</div>
                <button className="btn-primary w-full" onClick={doHost} disabled={busy !== null}>
                  {busy === 'host' ? 'Opening...' : 'Host a room'}
                </button>
                <p className="mt-1.5 text-[10px] leading-relaxed text-dim">
                  You get a 5-character code and run the simulation for everyone.
                </p>
              </div>

              <div>
                <div className="panel-title mb-2">Join a room</div>
                <div className="flex gap-2">
                  <input
                    className="field uppercase tracking-[0.3em]"
                    value={codeInput}
                    maxLength={5}
                    placeholder="CODE"
                    onChange={(e) => setCodeInput(normaliseRoomCode(e.target.value))}
                    onKeyDown={(e) => { if (e.key === 'Enter') doJoin(); }}
                  />
                  <button className="btn whitespace-nowrap" onClick={doJoin} disabled={busy !== null}>
                    {busy === 'join' ? '...' : 'Join'}
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-dim">
                  Same machine works too &mdash; open a second tab and join your own code.
                </p>
              </div>
            </div>
          </div>
        )}

        {inRoom && (
          <div className="panel mb-4 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="panel-title">Room code</div>
                <div className="font-mono text-3xl tracking-[0.4em] text-neon">{status.room}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn"
                  onClick={() => navigator.clipboard?.writeText(status.room).catch(() => {})}
                >
                  Copy
                </button>
                <button className="btn-danger" onClick={doLeave}>Leave</button>
              </div>
            </div>

            <div className="panel-title mb-2">
              Infiltrators ({roster.length}/{MAX_PLAYERS})
            </div>
            <ul className="mb-4 space-y-1.5">
              {roster.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 text-[12px]">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
                  <span className="text-slate-200">{p.name}</span>
                  {p.isHost && <span className="text-[9px] uppercase tracking-widest text-dim">host</span>}
                  {p.id === status.you && <span className="text-[9px] uppercase tracking-widest text-neon/70">you</span>}
                </li>
              ))}
              {roster.length < 2 && (
                <li className="text-[11px] text-dim">Waiting for a rival to join...</li>
              )}
            </ul>

            {isHost ? (
              <>
                <div className="panel-title mb-2">Floor</div>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {LEVEL_LIST.map((l) => (
                    <button
                      key={l.id}
                      className={`btn ${l.id === levelId ? 'border-neon text-neon' : ''}`}
                      onClick={() => onSelectLevel(l.id)}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
                <div className="panel-title mb-2">Difficulty</div>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {DIFFICULTY_ORDER.map((id) => (
                    <button
                      key={id}
                      className={`btn ${id === difficulty ? 'border-caution text-caution' : ''}`}
                      onClick={() => onSelectDifficulty(id)}
                    >
                      {DIFFICULTIES[id].label}
                    </button>
                  ))}
                </div>
                <button
                  className="btn-primary w-full"
                  onClick={doStart}
                  disabled={roster.length < 1}
                >
                  Start the run
                </button>
                {roster.length < 2 && (
                  <p className="mt-1.5 text-center text-[10px] text-dim">
                    You can start solo &mdash; but the mode only means anything with a rival.
                  </p>
                )}
              </>
            ) : (
              <div className="rounded border border-edge bg-ink/60 p-3 text-[12px] text-dim">
                Waiting for the host to start. They pick the floor and the difficulty.
              </div>
            )}
          </div>
        )}

        {notice && (
          <div className="panel mb-3 border-neon/40 bg-neon/5 p-3 text-[11px] text-neon">{notice}</div>
        )}
        {error && (
          <div className="panel mb-3 border-alarm/40 bg-alarm/5 p-3 text-[11px] text-alarm">{error}</div>
        )}
      </div>
    </div>
  );
}
