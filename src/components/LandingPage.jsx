import React, { useEffect, useRef, useState } from 'react';
import { LEVEL_LIST } from '../assets/tilemaps/labMap.js';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../game/difficulty.js';
import SuspicionWebDemo from './SuspicionWebDemo.jsx';
import { useInstallPrompt, useIsTouch } from './useDevice.js';
import {
  IconCoffee, IconGithub, IconPlay, IconUsers, IconChevron, IconSpark, IconDownload,
  IconClose,
} from './Icons.jsx';

/**
 * LandingPage - the only screen between a visitor and a run.
 *
 * Play starts immediately on the last-used settings; level and difficulty live in a
 * disclosure for the people who want them, and the keybinds are taught in-game rather
 * than in a table nobody reads. The briefing screen this replaced asked for all four
 * before anyone had seen the game move.
 *
 * The differentiator section exists because "five people, one saboteur" reads as one
 * specific other game to almost everyone, and a screenshot cannot show the difference.
 * So the page runs the real suspicion panel against a scripted run instead.
 *
 * All art is drawn in SVG/canvas rather than loaded, which keeps the page one request
 * with nothing to 404.
 */

/* --------------------------------------------------------------- backdrop */

/**
 * Drifting dust + a slow searchlight sweep. Cheap enough to leave running: ~70
 * particles, one gradient, no per-frame allocation. Respects reduced-motion by
 * rendering a single static frame.
 */
function Backdrop() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let w = 0;
    let h = 0;
    let raf = 0;
    const dust = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const seed = () => {
      dust.length = 0;
      for (let i = 0; i < 70; i++) {
        dust.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.4 + Math.random() * 1.4,
          vx: (Math.random() - 0.5) * 0.16,
          vy: -0.05 - Math.random() * 0.18,
          a: 0.08 + Math.random() * 0.3,
        });
      }
    };

    const frame = (t) => {
      ctx.clearRect(0, 0, w, h);

      // Searchlight: one wide, very soft cone crossing the page.
      const sweep = (t / 14000) % 1;
      const cx = -0.2 * w + sweep * w * 1.4;
      const grad = ctx.createRadialGradient(cx, h * 0.15, 0, cx, h * 0.15, h * 0.95);
      grad.addColorStop(0, 'rgba(56,242,196,0.10)');
      grad.addColorStop(0.5, 'rgba(56,242,196,0.03)');
      grad.addColorStop(1, 'rgba(56,242,196,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      for (const p of dust) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(163,199,224,${p.a})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    };

    resize();
    seed();
    if (reduced) frame(0);
    else raf = requestAnimationFrame(frame);

    const onResize = () => { resize(); seed(); };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Floor grid, receding */}
      <div
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(56,242,196,0.35) 1px, transparent 1px),'
            + 'linear-gradient(90deg, rgba(56,242,196,0.35) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 90% 60% at 50% 40%, #000 20%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 60% at 50% 40%, #000 20%, transparent 78%)',
        }}
      />
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      {/* Scanlines + vignette */}
      <div
        className="absolute inset-0 opacity-[0.35] mix-blend-overlay"
        style={{
          backgroundImage: 'repeating-linear-gradient(180deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 1px, transparent 1px, transparent 3px)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 45%, transparent 30%, #05070c 92%)' }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ story beats */

const PANEL_VIEWBOX = '0 0 220 140';

/** Beat 1: the floor, lit, five people on shift. */
function BeatFacility() {
  return (
    <svg viewBox={PANEL_VIEWBOX} className="h-full w-full">
      <rect width="220" height="140" fill="#080d15" />
      {[
        { x: 12, y: 14, w: 60, h: 44, f: '#1d3348' },
        { x: 80, y: 14, w: 56, h: 44, f: '#17362f' },
        { x: 144, y: 14, w: 64, h: 44, f: '#2b2246' },
        { x: 12, y: 78, w: 60, h: 46, f: '#3a2d17' },
        { x: 80, y: 78, w: 56, h: 46, f: '#1d3324' },
        { x: 144, y: 78, w: 64, h: 46, f: '#3d1d26' },
      ].map((r, i) => (
        <g key={i}>
          <rect {...r} fill={r.f} />
          <rect {...r} fill="none" stroke="#2b374a" strokeWidth="1.5" />
          <circle cx={r.x + r.w / 2} cy={r.y + r.h / 2} r="20" fill="#a8c4e8" opacity="0.06" />
        </g>
      ))}
      {/* corridors */}
      <rect x="12" y="62" width="196" height="12" fill="#141d29" />
      <rect x="72" y="14" width="8" height="110" fill="#141d29" />
      <rect x="136" y="14" width="8" height="110" fill="#141d29" />
      {/* staff */}
      {[[40, 30], [104, 40], [176, 28], [40, 100], [170, 104]].map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="9" fill="#8ea3bd" opacity="0.12">
            <animate attributeName="r" values="7;11;7" dur="3.5s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
          </circle>
          <circle cx={cx} cy={cy} r="3.4" fill="#cfe0f2" />
        </g>
      ))}
    </svg>
  );
}

/** Beat 2: the lights go out. */
function BeatBlackout() {
  return (
    <svg viewBox={PANEL_VIEWBOX} className="h-full w-full">
      <rect width="220" height="140" fill="#080d15" />
      <rect x="14" y="16" width="192" height="108" fill="#1c1811" />
      <rect x="14" y="16" width="192" height="108" fill="none" stroke="#2b374a" strokeWidth="1.5" />
      {/* generator core */}
      <g>
        <rect x="92" y="46" width="36" height="48" rx="4" fill="#241b12" stroke="#ffc14d" strokeWidth="2" />
        <rect x="100" y="56" width="20" height="4" fill="#ffc14d" opacity="0.8" />
        <rect x="100" y="66" width="14" height="4" fill="#ffc14d" opacity="0.6" />
        <rect x="100" y="76" width="18" height="4" fill="#ffc14d" opacity="0.4" />
        <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />
      </g>
      {/* arcs */}
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M${110 - i * 4} 46 l${6 - i * 3} -12 l${-8 + i * 2} -6 l${10 - i} -14`}
          fill="none"
          stroke="#ffe6a8"
          strokeWidth="1.6"
          opacity="0"
        >
          <animate attributeName="opacity" values="0;0.95;0" dur="1.1s" begin={`${i * 0.33}s`} repeatCount="indefinite" />
        </path>
      ))}
      {/* infiltrator */}
      <circle cx="70" cy="72" r="12" fill="#38f2c4" opacity="0.12" />
      <circle cx="70" cy="72" r="4.5" fill="#38f2c4" />
      {/* darkness creeping in */}
      <rect x="14" y="16" width="192" height="108" fill="#000010">
        <animate attributeName="opacity" values="0;0.72;0" dur="4s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

/** Beat 3: they talk, and the suspicion moves. */
function BeatSuspicion() {
  const heads = [[42, 44], [110, 30], [178, 50], [70, 104], [150, 104]];
  return (
    <svg viewBox={PANEL_VIEWBOX} className="h-full w-full">
      <rect width="220" height="140" fill="#080d15" />
      {/* gossip links */}
      {[[0, 1], [1, 2], [0, 3], [2, 4], [3, 4], [1, 4]].map(([a, b], i) => (
        <line
          key={i}
          x1={heads[a][0]} y1={heads[a][1]} x2={heads[b][0]} y2={heads[b][1]}
          stroke="#38f2c4" strokeWidth="1" strokeDasharray="3 4" opacity="0.35"
        >
          <animate attributeName="stroke-dashoffset" values="14;0" dur="1.6s" begin={`${i * 0.25}s`} repeatCount="indefinite" />
        </line>
      ))}
      {heads.map(([cx, cy], i) => {
        const accused = i === 3;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r="13" fill={accused ? '#ff4d5e' : '#8ea3bd'} opacity="0.14" />
            <circle cx={cx} cy={cy} r="6" fill={accused ? '#ff8a94' : '#cfe0f2'} />
            {/* suspicion bar */}
            <rect x={cx - 12} y={cy + 12} width="24" height="3" rx="1.5" fill="#1c2534" />
            <rect x={cx - 12} y={cy + 12} height="3" rx="1.5" fill={accused ? '#ff4d5e' : '#ffc14d'} width="4">
              <animate
                attributeName="width"
                values={accused ? '4;24;24' : '3;11;5'}
                dur="4s" begin={`${i * 0.3}s`} repeatCount="indefinite"
              />
            </rect>
          </g>
        );
      })}
      <text x="70" y="128" textAnchor="middle" fill="#ff8a94" fontSize="9" fontFamily="monospace">
        it was them
      </text>
    </svg>
  );
}

/** Beat 4: the door, and whether you reach it. */
function BeatExit() {
  return (
    <svg viewBox={PANEL_VIEWBOX} className="h-full w-full">
      <rect width="220" height="140" fill="#080d15" />
      <rect x="14" y="16" width="192" height="108" fill="#101c28" />
      <rect x="14" y="16" width="192" height="108" fill="none" stroke="#2b374a" strokeWidth="1.5" />
      {/* blast door */}
      <rect x="150" y="30" width="46" height="80" rx="3" fill="#0f1620" stroke="#7dd3fc" strokeWidth="2" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={154 + i * 11} y="36" width="6" height="68" fill="#7dd3fc" opacity="0.25" />
      ))}
      {/* opening light */}
      <rect x="150" y="30" width="46" height="80" fill="#7dd3fc" opacity="0">
        <animate attributeName="opacity" values="0;0.35;0" dur="3.2s" repeatCount="indefinite" />
      </rect>
      {/* the infiltrator heading out */}
      <g>
        <circle cx="60" cy="70" r="14" fill="#38f2c4" opacity="0.1" />
        <circle cx="60" cy="70" r="5" fill="#38f2c4" />
        <animateTransform attributeName="transform" type="translate" values="0 0; 68 0; 68 0" dur="3.2s" repeatCount="indefinite" />
      </g>
      {/* pursuit */}
      <g opacity="0.75">
        <circle cx="30" cy="86" r="4.5" fill="#ff4d5e" />
        <animateTransform attributeName="transform" type="translate" values="0 0; 40 -8; 40 -8" dur="3.2s" repeatCount="indefinite" />
      </g>
    </svg>
  );
}

const BEATS = [
  {
    n: '01',
    title: 'Five people, one night cycle',
    body: 'A sealed research floor. Everyone on it has a job, a patrol, and something they would rather you did not find out.',
    art: BeatFacility,
  },
  {
    n: '02',
    title: 'You are the reason the lights go out',
    body: 'Three systems to kill. Cut the power and the dark is yours - but a blackout is not something anyone mistakes for an accident.',
    art: BeatBlackout,
  },
  {
    n: '03',
    title: 'They compare notes',
    body: 'They see, they hear, they gossip. Suspicion spreads between them on its own. Plant the right thing in the right room and it lands on somebody else.',
    art: BeatSuspicion,
  },
  {
    n: '04',
    title: 'Leave before they agree',
    body: 'Consensus is the clock. Once enough of them are sure it was you, the floor goes into lockdown and the only question is who reaches the door first.',
    art: BeatExit,
  },
];

const PILLARS = [
  {
    k: 'Characters, not barks',
    v: 'Every line is written in character, in context, against what that person actually saw. Bring any model - or none, and the local writer carries it.',
  },
  {
    k: 'A social sim you can push',
    v: 'Suspicion is tracked per person and per target. Frame someone and watch the accusation travel the room without you in it.',
  },
  {
    k: 'Three floors, three difficulties',
    v: 'From a corridor ring you can learn on, to an open tower where the only cover is the dark you make.',
  },
];

/** The three lines that separate this from the game everybody assumes it is. */
const CONTRASTS = [
  {
    k: 'No meetings, no voting',
    v: 'Suspicion is a number in five heads. It moves on where you were seen and what you said, not on how well you argued in a chat box.',
  },
  {
    k: 'Nobody is waiting on you',
    v: 'No lobby to fill, no ghost mode, no sitting out while other people finish. Six minutes, start to end, all yours.',
  },
  {
    k: 'The other five are the game',
    v: 'They patrol, witness, gossip and change their minds in real time, while you are still in the room. You are not lying to players. You are steering what a simulation concludes.',
  },
];

/* ------------------------------------------------------------------ page */

export default function LandingPage({
  onPlay, onRival, onResume, onSupport, onOpenApi, onOpenAuth,
  resume, llmReady, provider,
  levelId, difficulty, onSelectLevel, onSelectDifficulty,
}) {
  const [showOptions, setShowOptions] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const { canInstall, needsManualInstall, install } = useInstallPrompt();
  const isTouch = useIsTouch();
  const level = LEVEL_LIST.find((l) => l.id === levelId) || LEVEL_LIST[0];
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES[DIFFICULTY_ORDER[0]];

  return (
    <div className="relative h-full w-full overflow-y-auto bg-ink">
      <Backdrop />

      {/* ------------------------------------------------------------- nav */}
      <nav className="sticky top-0 z-30 border-b border-edge/60 bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-2.5 sm:px-10">
          <span className="text-[12px] font-black tracking-[0.2em] text-slate-100">BLACKOUT</span>
          <span className="hidden text-[10px] uppercase tracking-[0.28em] text-dim sm:inline">
            The Subterfuge
          </span>

          <span className="flex-1" />

          <a
            href="#different"
            className="hidden px-2 text-[11px] uppercase tracking-[0.16em] text-dim
                       transition-colors hover:text-slate-200 sm:inline"
          >
            How it plays
          </a>

          {(canInstall || needsManualInstall) && (
            <button
              onClick={() => (canInstall ? install() : setShowIosHelp(true))}
              className="flex items-center gap-2 rounded border border-neon/40 bg-neon/5 px-3 py-1.5
                         text-[11.5px] text-neon transition-colors hover:border-neon/80 hover:bg-neon/15"
            >
              <IconDownload size={15} />
              <span className="hidden sm:inline">Install</span>
            </button>
          )}

          <a
            href="https://github.com/mkarjun/Blackout-TheSubterfuge"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Source on GitHub"
            title="Source on GitHub"
            className="hidden h-8 w-8 place-items-center rounded border border-edge text-slate-400
                       transition-colors hover:border-neon/50 hover:text-neon sm:grid"
          >
            <IconGithub size={15} />
          </a>

          {/* The ask, given a real target size, a colour of its own and an icon -
              rather than nine grey pixels at the bottom of the page. */}
          <button
            onClick={onSupport}
            className="flex items-center gap-2 rounded border border-caution/50 bg-caution/10 px-3 py-1.5
                       text-[11.5px] font-semibold text-caution transition-colors
                       hover:border-caution hover:bg-caution/20"
          >
            <IconCoffee size={15} />
            <span className="hidden sm:inline">Support</span>
          </button>
        </div>
      </nav>

      <div className="relative mx-auto flex w-full max-w-5xl flex-col px-5 pb-10 sm:px-10">
        {/* ---------------------------------------------------------- hero */}
        <header className="flex min-h-[72vh] flex-col justify-center py-10">
          <div className="mb-5 flex items-center gap-3">
            <span className="h-px w-10 bg-neon/60" />
            <span className="text-[10px] uppercase tracking-[0.42em] text-neon/80">
              Halden Institute &middot; Sublevel 3
            </span>
          </div>

          <h1 className="text-[13vw] leading-[0.82] tracking-tighter text-slate-100 sm:text-[104px]">
            <span className="block font-black animate-flicker">BLACKOUT</span>
            <span className="mt-2 block text-[5.2vw] font-light tracking-[0.16em] text-neon sm:text-[34px]">
              THE SUBTERFUGE
            </span>
          </h1>

          <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-slate-400">
            A stealth game where the guards think for themselves. Sabotage the floor,
            frame someone else for it, and get out before five people who talk to each
            other agree on your name.
          </p>

          {/* One button. Everything else on this row is optional. */}
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button
              onClick={onPlay}
              className="group flex items-center gap-3 rounded border border-neon/70 bg-neon/10 px-9 py-4
                         text-[14px] font-semibold uppercase tracking-[0.24em] text-neon transition-all
                         hover:bg-neon/20 hover:shadow-[0_0_36px_-6px_rgba(56,242,196,0.7)]"
            >
              <IconPlay size={17} />
              Play now
            </button>

            {resume && (
              <button
                onClick={onResume}
                className="rounded border border-edge px-6 py-4 text-[12px] uppercase tracking-[0.2em]
                           text-slate-300 transition-colors hover:border-neon/50 hover:text-neon"
              >
                Resume run
              </button>
            )}

            <button
              onClick={onRival}
              className="flex items-center gap-2 rounded border border-edge px-5 py-4 text-[12px]
                         uppercase tracking-[0.2em] text-slate-300 transition-colors
                         hover:border-neon/50 hover:text-neon"
            >
              <IconUsers size={15} />
              Play a rival
            </button>
          </div>

          {/*
            The mission row. This started as a grey sentence with the word "Change"
            at the end of it and nobody saw it, which meant two floors and two
            difficulties may as well not have shipped. It is a bordered control now,
            it names what it will change, and it says how many alternatives are behind
            it - the number is what makes it worth a tap.
          */}
          <div className="mt-5 max-w-2xl">
            <button
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              className={`group flex w-full items-center gap-3 rounded border px-4 py-3 text-left
                          transition-colors sm:w-auto ${
                showOptions
                  ? 'border-neon/60 bg-neon/5'
                  : 'border-edge bg-panel/50 hover:border-neon/50 hover:bg-neon/5'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[9.5px] uppercase tracking-[0.22em] text-dim">Mission</div>
                <div className="mt-0.5 truncate text-[13px] text-slate-200">
                  {level.name}
                  <span className="text-edge"> / </span>
                  <span className="text-caution">{diff.label}</span>
                  <span className="text-dim"> / ~6 min</span>
                </div>
              </div>
              <span
                className="flex shrink-0 items-center gap-1.5 rounded border border-neon/40 bg-neon/10
                           px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-neon"
              >
                {showOptions ? 'Done' : '3 floors, 3 levels'}
                <IconChevron open={showOptions} size={13} />
              </span>
            </button>

            {showOptions && (
              <MissionOptions
                levelId={levelId}
                difficulty={difficulty}
                onSelectLevel={onSelectLevel}
                onSelectDifficulty={onSelectDifficulty}
                onOpenApi={onOpenApi}
                onOpenAuth={onOpenAuth}
                llmReady={llmReady}
                provider={provider}
              />
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] uppercase tracking-[0.18em] text-dim">
            <span>Runs in the browser</span>
            <span className="text-edge">/</span>
            <span>No account</span>
            <span className="text-edge">/</span>
            <span>{isTouch ? 'Phone controls built in' : 'Phone, tablet or desktop'}</span>
            <span className="text-edge">/</span>
            <span className={llmReady ? 'text-neon/80' : ''}>
              {llmReady ? `AI: ${provider}` : 'Plays with or without an AI key'}
            </span>
          </div>
        </header>

        {/* ------------------------------------------------ the differentiator */}
        <section id="different" className="scroll-mt-16 border-t border-edge py-16">
          <div className="mb-3 text-[10px] uppercase tracking-[0.4em] text-neon/80">
            Not the game you are thinking of
          </div>
          <h2 className="max-w-2xl text-[28px] font-semibold leading-tight tracking-tight text-slate-100 sm:text-[34px]">
            No meeting. No vote.
            <span className="text-neon"> Five people who make up their own minds.</span>
          </h2>

          <div className="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-6">
              {CONTRASTS.map((c) => (
                <div key={c.k} className="border-l-2 border-edge pl-4">
                  <h3 className="mb-1.5 text-[15px] font-semibold text-slate-100">{c.k}</h3>
                  <p className="text-[13px] leading-relaxed text-slate-400">{c.v}</p>
                </div>
              ))}
            </div>

            {/* The live instrument, running a scripted frame job. */}
            <figure className="panel p-5">
              <figcaption className="mb-3 flex items-baseline justify-between">
                <span className="panel-title">Live: the theory</span>
                <span className="text-[9px] uppercase tracking-widest text-dim">replaying a run</span>
              </figcaption>
              <SuspicionWebDemo size={300} />
              <p className="mt-3 border-t border-edge pt-3 text-[10.5px] leading-relaxed text-dim">
                The real HUD panel, not an illustration. Lines pointing in are cases against
                you. Purple lines between them are the case you built for someone else.
              </p>
            </figure>
          </div>
        </section>

        {/* --------------------------------------------------------- story */}
        <section id="story" className="scroll-mt-16 border-t border-edge py-16">
          <div className="mb-10 flex items-baseline gap-4">
            <h2 className="text-[11px] uppercase tracking-[0.4em] text-neon/80">The job</h2>
            <span className="h-px flex-1 bg-edge" />
          </div>

          <div className="space-y-5">
            {BEATS.map((beat, i) => {
              const Art = beat.art;
              const flip = i % 2 === 1;
              return (
                <article
                  key={beat.n}
                  className={`panel grid items-center gap-6 overflow-hidden p-5 md:grid-cols-2 ${
                    flip ? 'md:[&>figure]:order-2' : ''
                  }`}
                >
                  <figure className="aspect-[220/140] w-full overflow-hidden rounded border border-edge bg-ink">
                    <Art />
                  </figure>
                  <div>
                    <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-neon/70">{beat.n}</div>
                    <h3 className="mb-2.5 text-[19px] font-semibold leading-snug text-slate-100">{beat.title}</h3>
                    <p className="text-[13.5px] leading-relaxed text-slate-400">{beat.body}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* -------------------------------------------------------- pillars */}
        <section className="border-t border-edge py-16">
          <div className="mb-8 flex items-baseline gap-4">
            <h2 className="text-[11px] uppercase tracking-[0.4em] text-neon/80">Under the hood</h2>
            <span className="h-px flex-1 bg-edge" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.k} className="panel p-5">
                <h3 className="mb-2 text-[14px] font-semibold text-slate-100">{p.k}</h3>
                <p className="text-[12.5px] leading-relaxed text-slate-400">{p.v}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ final CTA */}
        <section className="panel mb-8 flex flex-col items-center gap-5 px-6 py-12 text-center">
          <h2 className="text-[26px] font-semibold tracking-tight text-slate-100">
            The night cycle has already started.
          </h2>
          <p className="max-w-md text-[13px] leading-relaxed text-slate-400">
            Six minutes a run. The end screen shows you whose story won.
          </p>
          <button
            onClick={onPlay}
            className="flex items-center gap-3 rounded border border-neon/70 bg-neon/10 px-10 py-4
                       text-[14px] font-semibold uppercase tracking-[0.24em] text-neon transition-all
                       hover:bg-neon/20 hover:shadow-[0_0_36px_-6px_rgba(56,242,196,0.7)]"
          >
            <IconPlay size={17} />
            Play now
          </button>
        </section>

        {/* --------------------------------------------------------- footer */}
        <footer className="mb-6 border-t border-edge pt-6">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <div className="text-[12px] text-slate-300">Free, and staying free.</div>
              <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-dim">
                No ads, no paywall, nothing locked. A coffee is the whole business model.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                onClick={onSupport}
                className="flex items-center gap-2 rounded border border-caution/50 bg-caution/10 px-4 py-2.5
                           text-[12px] font-semibold text-caution transition-colors
                           hover:border-caution hover:bg-caution/20"
              >
                <IconCoffee size={16} />
                Buy me a coffee
              </button>
              <a
                href="https://github.com/mkarjun/Blackout-TheSubterfuge"
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 rounded border border-edge px-4 py-2.5 text-[12px]
                           text-slate-300 transition-colors hover:border-neon/50 hover:text-neon"
              >
                <IconGithub size={15} />
                Source
              </a>
            </div>
          </div>
          <div className="mt-6 text-[10px] uppercase tracking-[0.2em] text-dim">
            Blackout &middot; The Subterfuge
          </div>
        </footer>
      </div>

      {showIosHelp && <IosInstallHelp onClose={() => setShowIosHelp(false)} />}
    </div>
  );
}

/* ---------------------------------------------------------- iOS install */

/**
 * Safari has no install API, so the only honest thing to offer is the three taps
 * that do it. Shown only on iOS, and only when the browser has not offered a real
 * prompt of its own.
 */
function IosInstallHelp({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/85 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div className="panel w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-100">Add it to your home screen</h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              It runs fullscreen and offline, without browser bars eating the floor.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 text-dim hover:text-slate-200">
            <IconClose size={16} />
          </button>
        </div>
        <ol className="space-y-2.5">
          {[
            'Tap the Share button at the bottom of Safari.',
            'Scroll down and choose "Add to Home Screen".',
            'Tap Add. Blackout appears with your apps.',
          ].map((line, i) => (
            <li key={line} className="flex gap-3 text-[12.5px] leading-snug text-slate-300">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-neon/50 text-[10px] text-neon">
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- mission options */

/**
 * The old briefing screen, folded into a disclosure. Everything here has a working
 * default, so nobody has to open it - which is the point. Level and difficulty are
 * chips rather than cards because at this size the blurbs were being skipped anyway.
 */
function MissionOptions({
  levelId, difficulty, onSelectLevel, onSelectDifficulty,
  onOpenApi, onOpenAuth, llmReady, provider,
}) {
  const level = LEVEL_LIST.find((l) => l.id === levelId) || LEVEL_LIST[0];
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES[DIFFICULTY_ORDER[0]];

  return (
    <div className="panel mt-3 animate-slidein p-4">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <div className="panel-title mb-2">Facility</div>
          <div className="flex flex-wrap gap-1.5">
            {LEVEL_LIST.map((l) => (
              <Chip key={l.id} selected={l.id === levelId} onClick={() => onSelectLevel(l.id)}>
                {l.name}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-dim">{level.brief}</p>
        </div>

        <div>
          <div className="panel-title mb-2">How hard they are looking</div>
          <div className="flex flex-wrap gap-1.5">
            {DIFFICULTY_ORDER.map((id) => (
              <Chip
                key={id}
                selected={id === difficulty}
                tone="caution"
                onClick={() => onSelectDifficulty(id)}
              >
                {DIFFICULTIES[id].label}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-dim">{diff.blurb}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-edge pt-3">
        <button className="btn flex items-center gap-1.5" onClick={onOpenApi}>
          <IconSpark size={13} /> AI provider
        </button>
        <button className="btn" onClick={onOpenAuth}>Saves &amp; cloud sync</button>
        <span className="ml-auto text-[10px] text-dim">
          {llmReady
            ? <>Dialogue written by <span className="text-neon">{provider}</span></>
            : 'Dialogue written locally. Optional.'}
        </span>
      </div>
    </div>
  );
}

function Chip({ children, selected, onClick, tone = 'neon' }) {
  const on = tone === 'caution'
    ? 'border-caution/70 bg-caution/10 text-caution'
    : 'border-neon/70 bg-neon/10 text-neon';
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[11.5px] transition-colors ${
        selected ? on : 'border-edge text-slate-400 hover:border-edge/80 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}
