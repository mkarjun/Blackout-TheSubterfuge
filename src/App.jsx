import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createGame, destroyGame } from './game/GameConfig.js';
import { loadResumePayload } from './game/scenes/MainLabScene.js';
import eventManager, { EVENTS } from './game/systems/EventManager.js';
import { llmClient, DEFAULT_LLM_CONFIG } from './services/llmClient.js';
import {
  loadLlmConfig, flushPendingSave, getSetting, setSetting, SETTINGS_KEYS,
} from './services/memoryStore.js';
import { LEVEL_LIST } from './assets/tilemaps/labMap.js';
import { DEFAULT_DIFFICULTY } from './game/difficulty.js';
import sfx from './game/systems/Sfx.js';
import music from './game/systems/Music.js';
import GameOverlay from './components/GameOverlay.jsx';
import ApiConfigModal from './components/ApiConfigModal.jsx';
import AuthModal from './components/AuthModal.jsx';
import LandingPage from './components/LandingPage.jsx';
import LobbyPanel from './components/LobbyPanel.jsx';
import SupportPanel from './components/SupportPanel.jsx';
import { enterImmersive, exitImmersive, useIsTouch } from './components/useDevice.js';

/**
 * App - phase machine and Phaser lifecycle owner.
 *
 * boot -> landing -> playing, with lobby as the multiplayer detour. The "briefing"
 * phase that used to sit between landing and playing is gone; Play starts a run on
 * the last-used settings and the settings live in a landing-page disclosure.
 */

export default function App() {
  const hostRef = useRef(null);
  const startedRef = useRef(false);
  const isTouch = useIsTouch();

  // boot -> landing (the pitch) -> playing. lobby is the multiplayer detour.
  const [phase, setPhase] = useState('boot');
  const [resume, setResume] = useState(null);
  const [showApi, setShowApi] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
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
      // Pull the score down while they read the page, so Play does not wait on it.
      music.preload();
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => llmClient.subscribe(() => setLlmReady(llmClient.isConfigured())), []);

  /* ------------------------------------------------------------- lifecycle */

  const [pendingResume, setPendingResume] = useState(null);
  const [netSession, setNetSession] = useState(null);

  const startGame = useCallback((resumeData) => {
    sfx.unlock();
    // Fullscreen and the orientation lock both require a user gesture, so they have
    // to be requested here, inside the click, and not from the phase effect below.
    if (isTouch) enterImmersive(document.documentElement);
    setPendingResume(resumeData || null);
    setNetSession(null);
    setPhase('playing');
  }, [isTouch]);

  /** Host pressed start, or a guest received START. Same path either way. */
  const launchMultiplayer = useCallback((session, msg) => {
    sfx.unlock();
    if (isTouch) enterImmersive(document.documentElement);
    if (msg?.levelId) setLevelId(msg.levelId);
    if (msg?.difficulty) setDifficulty(msg.difficulty);
    setPendingResume(null);
    setNetSession(session);
    setPhase('playing');
  }, [isTouch]);

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
    createGame(hostRef.current, { resume: pendingResume, levelId, difficulty, net: netSession });
  }, [phase, pendingResume, levelId, difficulty, netSession]);

  // The score follows the run, not the app: silence on the title screen, fade in
  // when a floor loads, fade out on the way back out.
  useEffect(() => {
    if (phase === 'playing') music.start();
    else music.stop();
  }, [phase]);

  useEffect(() => () => {
    destroyGame();
    music.dispose();
    flushPendingSave().catch(() => {});
  }, []);

  // Any real gesture unlocks WebAudio; browsers refuse to play before one.
  useEffect(() => {
    const unlock = () => { sfx.unlock(); music.unlock(); };
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
    // The title screen is a document: give the browser chrome and the rotation back.
    if (isTouch) exitImmersive();
    setPhase('landing');
    // Re-read the save so the title screen offers Resume straight away.
    const resumable = await loadResumePayload();
    setResume(resumable);
  }, [isTouch]);

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
            onOpenSupport={() => setShowSupport(true)}
            modalOpen={showApi || showAuth || showSupport}
          />
        </>
      )}

      {(phase === 'landing' || phase === 'boot') && (
        <LandingPage
          resume={resume}
          llmReady={llmReady}
          provider={llmClient.getConfig().model}
          levelId={levelId}
          difficulty={difficulty}
          onSelectLevel={setLevelId}
          onSelectDifficulty={setDifficulty}
          onPlay={() => startGame(null)}
          onRival={() => setPhase('lobby')}
          onResume={() => startGame(resume)}
          onSupport={() => setShowSupport(true)}
          onOpenApi={() => setShowApi(true)}
          onOpenAuth={() => setShowAuth(true)}
        />
      )}

      {phase === 'lobby' && (
        <LobbyPanel
          levelId={levelId}
          difficulty={difficulty}
          onSelectLevel={setLevelId}
          onSelectDifficulty={setDifficulty}
          onBack={() => setPhase('landing')}
          onLaunch={launchMultiplayer}
        />
      )}

      {showApi && <ApiConfigModal onClose={() => setShowApi(false)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showSupport && <SupportPanel onClose={() => setShowSupport(false)} />}
    </div>
  );
}
