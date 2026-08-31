import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createGame, destroyGame } from './game/GameConfig.js';
import { loadResumePayload } from './game/scenes/MainLabScene.js';
import eventManager, { EVENTS } from './game/systems/EventManager.js';
import { llmClient, DEFAULT_LLM_CONFIG } from './services/llmClient.js';
import {
  loadLlmConfig, flushPendingSave, getSetting, setSetting, SETTINGS_KEYS,
} from './services/memoryStore.js';
import { LEVEL_LIST } from './assets/tilemaps/labMap.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY } from './game/difficulty.js';
import sfx from './game/systems/Sfx.js';
import GameOverlay from './components/GameOverlay.jsx';
import ApiConfigModal from './components/ApiConfigModal.jsx';
import AuthModal from './components/AuthModal.jsx';
import LandingPage from './components/LandingPage.jsx';

const CONTROLS = [
  ['WASD / Arrows', 'Move'],
  ['Shift', 'Sneak - quieter, harder to spot'],
  ['E', 'Interact / sabotage'],
  ['F', 'Plant evidence'],
  ['H', 'Hack lights (facility-wide at a breaker)'],
  ['Space', 'Talk to whoever is closest'],
  ['Esc', 'Pause'],
];

export default function App() {
  const hostRef = useRef(null);
  const startedRef = useRef(false);

  // boot -> landing (the pitch) -> briefing (loadout) -> playing
  const [phase, setPhase] = useState('boot');
  const [resume, setResume] = useState(null);
  const [showApi, setShowApi] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [llmReady, setLlmReady] = useState(false);
  const [levelId, setLevelId] = useState(LEVEL_LIST[0].id);
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY);

  /* ---------------------------------------------------------------- boot */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Rehydrate the LLM config before anything can trigger a cognition request.
      const saved = await loadLlmConfig(null);
      if (saved) llmClient.updateConfig({ ...DEFAULT_LLM_CONFIG, ...saved });
      const resumable = await loadResumePayload();
      const gameplay = await getSetting(SETTINGS_KEYS.GAMEPLAY, null);
      if (cancelled) return;
      if (gameplay?.levelId) setLevelId(gameplay.levelId);
      if (gameplay?.difficulty) setDifficulty(gameplay.difficulty);
      setResume(resumable);
      setLlmReady(llmClient.isConfigured());
      setPhase('landing');
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => llmClient.subscribe(() => setLlmReady(llmClient.isConfigured())), []);

  /* ------------------------------------------------------------- lifecycle */

  const [pendingResume, setPendingResume] = useState(null);

  const startGame = useCallback((resumeData) => {
    sfx.unlock();
    setPendingResume(resumeData || null);
    setPhase('playing');
  }, []);

  // Remember the menu selection between sessions.
  useEffect(() => {
    if (phase === 'boot') return;
    setSetting(SETTINGS_KEYS.GAMEPLAY, { levelId, difficulty }).catch(() => {});
  }, [levelId, difficulty, phase]);

  // Boot Phaser once the host node is actually in the DOM. Doing this in an effect
  // rather than a rAF callback means it does not depend on the tab compositing.
  useEffect(() => {
    if (phase !== 'playing' || startedRef.current || !hostRef.current) return;
    startedRef.current = true;
    createGame(hostRef.current, { resume: pendingResume, levelId, difficulty });
  }, [phase, pendingResume, levelId, difficulty]);

  useEffect(() => () => {
    destroyGame();
    flushPendingSave().catch(() => {});
  }, []);

  // Any real gesture unlocks WebAudio; browsers refuse to play before one.
  useEffect(() => {
    const unlock = () => sfx.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Save on tab close - a browser refresh mid-run should not lose the session.
  useEffect(() => {
    const onHide = () => { flushPendingSave().catch(() => {}); };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const handleRestart = useCallback(() => {
    eventManager.emit(EVENTS.REQUEST_RESTART);
  }, []);

  /** Leave the run: save, tear the engine down, and go back to the title screen. */
  const handleExit = useCallback(async () => {
    eventManager.emit(EVENTS.REQUEST_SAVE);
    await flushPendingSave().catch(() => {});
    destroyGame();
    startedRef.current = false;
    setPhase('landing');
    // Re-read the save so the title screen offers Resume straight away.
    const resumable = await loadResumePayload();
    setResume(resumable);
  }, []);

  /* ---------------------------------------------------------------- render */

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink">
      {phase === 'playing' && (
        <>
          <div id="game-root" ref={hostRef} className="absolute inset-0" />
          <GameOverlay
            onOpenApi={() => setShowApi(true)}
            onOpenAuth={() => setShowAuth(true)}
            onRestart={handleRestart}
            onExit={handleExit}
          />
        </>
      )}

      {phase === 'landing' && (
        <LandingPage
          resume={resume}
          llmReady={llmReady}
          provider={llmClient.getConfig().model}
          onStart={() => setPhase('briefing')}
          onResume={() => startGame(resume)}
        />
      )}

      {(phase === 'boot' || phase === 'briefing') && (
        <BriefingScreen
          phase={phase}
          resume={resume}
          llmReady={llmReady}
          levelId={levelId}
          difficulty={difficulty}
          onSelectLevel={setLevelId}
          onSelectDifficulty={setDifficulty}
          onNew={() => startGame(null)}
          onResume={() => startGame(resume)}
          onOpenApi={() => setShowApi(true)}
          onOpenAuth={() => setShowAuth(true)}
          onBack={() => setPhase('landing')}
        />
      )}

      {showApi && <ApiConfigModal onClose={() => setShowApi(false)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}

/* --------------------------------------------------------- briefing screen */

function BriefingScreen({
  phase, resume, llmReady, levelId, difficulty,
  onSelectLevel, onSelectDifficulty, onNew, onResume, onOpenApi, onOpenAuth, onBack,
}) {
  const cfg = llmClient.getConfig();

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-4xl">
        <div className="mb-8">
          {onBack && (
            <button
              onClick={onBack}
              className="mb-4 text-[10px] uppercase tracking-[0.2em] text-dim transition-colors hover:text-neon"
            >
              &larr; Back
            </button>
          )}
          <div className="text-[11px] uppercase tracking-[0.4em] text-neon/70">Mission briefing</div>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-100">
            Pick your floor<span className="text-neon">.</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
            Three systems to sabotage, then the exit. The staff decide for themselves who did it.
          </p>
        </div>

        {/* level select */}
        <div className="mb-4">
          <div className="panel-title mb-2">Facility</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {LEVEL_LIST.map((level) => {
              const selected = level.id === levelId;
              return (
                <button
                  key={level.id}
                  onClick={() => onSelectLevel(level.id)}
                  className={`panel p-3 text-left transition-colors ${
                    selected ? 'border-neon/70 bg-neon/5' : 'hover:border-edge/80'
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className={`text-[13px] font-semibold ${selected ? 'text-neon' : 'text-slate-200'}`}>
                      {level.name}
                    </span>
                    <span className="text-[10px] text-dim">0{level.index}</span>
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-dim">{level.subtitle}</div>
                  <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{level.brief}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* difficulty select */}
        <div className="mb-4">
          <div className="panel-title mb-2">Difficulty</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {DIFFICULTY_ORDER.map((id) => {
              const d = DIFFICULTIES[id];
              const selected = id === difficulty;
              return (
                <button
                  key={id}
                  onClick={() => onSelectDifficulty(id)}
                  className={`panel p-3 text-left transition-colors ${
                    selected ? 'border-caution/70 bg-caution/5' : 'hover:border-edge/80'
                  }`}
                >
                  <div className={`text-[13px] font-semibold ${selected ? 'text-caution' : 'text-slate-200'}`}>
                    {d.label}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">{d.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="panel p-4">
            <div className="panel-title mb-3">Controls</div>
            <dl className="grid grid-cols-1 gap-1.5 text-[12px] sm:grid-cols-2">
              {CONTROLS.map(([key, label]) => (
                <div key={key} className="flex items-baseline gap-2">
                  <dt className="min-w-[104px] shrink-0 text-neon/80">{key}</dt>
                  <dd className="text-slate-400">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="panel flex flex-col gap-2 p-4">
            <div className="panel-title mb-1">Start</div>
            <button className="btn-primary" onClick={onNew} disabled={phase === 'boot'}>
              {phase === 'boot' ? 'Loading...' : 'New run'}
            </button>
            <button className="btn" onClick={onResume} disabled={!resume}>
              {resume ? `Resume ${LEVEL_LIST.find((l) => l.id === resume.levelId)?.name || 'last run'}` : 'No saved run'}
            </button>
            <div className="my-1 h-px bg-edge" />
            <button className="btn" onClick={onOpenApi}>AI provider</button>
            <button className="btn" onClick={onOpenAuth}>Saves &amp; cloud sync</button>

            <div className="mt-2 text-[10px] leading-relaxed text-dim">
              {llmReady ? (
                <>
                  Cognition: <span className="text-neon">{cfg.provider}</span> / {cfg.model}
                </>
              ) : (
                <>
                  Cognition: <span className="text-caution">rule-based only</span>. The game is fully
                  playable; connect a provider for improvised dialogue.
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
