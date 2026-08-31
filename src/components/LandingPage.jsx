import React, { useEffect, useRef } from 'react';

/**
 * LandingPage - the cinematic front door.
 *
 * Deliberately separate from the briefing screen: this page's only job is to make
 * someone want to press the button, and it is the surface a link gets shared with.
 * The briefing (level, difficulty, controls) comes after, so nothing here competes
 * with the pitch.
 *
 * All art is drawn in SVG/canvas rather than loaded - same constraint as the game
 * itself, and it keeps the page a single fast request with nothing to 404.
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
    v: 'Every line is generated in character, in context, against what they actually saw. Bring any model - or none, and the local fallback carries it.',
  },
  {
    k: 'A social sim you can push',
    v: 'Suspicion is tracked per person and per target. Frame someone and watch the accusation travel through the room without you.',
  },
  {
    k: 'Three floors, three difficulties',
    v: 'From a corridor ring you can learn on, to an open tower where the only cover is the dark you make.',
  },
];

/* ------------------------------------------------------------------ page */

export default function LandingPage({ onStart, onResume, resume, llmReady, provider }) {
  return (
    <div className="relative h-full w-full overflow-y-auto bg-ink">
      <Backdrop />

      <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col px-6 py-10 sm:px-10">
        {/* ---------------------------------------------------------- hero */}
        <header className="flex min-h-[76vh] flex-col justify-center">
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

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button
              onClick={onStart}
              className="group relative overflow-hidden rounded border border-neon/70 bg-neon/10 px-9 py-3.5
                         text-[13px] uppercase tracking-[0.3em] text-neon transition-all
                         hover:bg-neon/20 hover:shadow-[0_0_30px_-6px_rgba(56,242,196,0.6)]"
            >
              <span className="relative z-10">Enter the facility</span>
            </button>

            {resume && (
              <button
                onClick={onResume}
                className="rounded border border-edge px-6 py-3.5 text-[12px] uppercase tracking-[0.2em]
                           text-slate-300 transition-colors hover:border-neon/50 hover:text-neon"
              >
                Resume run
              </button>
            )}

            <a
              href="#story"
              className="px-2 py-3.5 text-[11px] uppercase tracking-[0.2em] text-dim transition-colors hover:text-slate-300"
            >
              How it plays &darr;
            </a>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] uppercase tracking-[0.18em] text-dim">
            <span>Runs in the browser</span>
            <span className="text-edge">/</span>
            <span>No install</span>
            <span className="text-edge">/</span>
            <span className={llmReady ? 'text-neon/80' : ''}>
              {llmReady ? `AI: ${provider}` : 'Plays with or without an AI key'}
            </span>
          </div>
        </header>

        {/* --------------------------------------------------------- story */}
        <section id="story" className="scroll-mt-8 py-16">
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
        <section className="pb-16">
          <div className="mb-8 flex items-baseline gap-4">
            <h2 className="text-[11px] uppercase tracking-[0.4em] text-neon/80">Why it is different</h2>
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
        <section className="panel mb-10 flex flex-col items-center gap-5 px-6 py-12 text-center">
          <h2 className="text-[26px] font-semibold tracking-tight text-slate-100">
            The night cycle has already started.
          </h2>
          <p className="max-w-md text-[13px] leading-relaxed text-slate-400">
            Pick a floor, pick how hard they are looking, and go. A run takes a few minutes.
            Losing one is the interesting part.
          </p>
          <button
            onClick={onStart}
            className="rounded border border-neon/70 bg-neon/10 px-10 py-3.5 text-[13px] uppercase
                       tracking-[0.3em] text-neon transition-all hover:bg-neon/20
                       hover:shadow-[0_0_30px_-6px_rgba(56,242,196,0.6)]"
          >
            Begin briefing
          </button>
        </section>

        <footer className="mb-6 flex flex-wrap items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-dim">
          <span>Blackout &middot; The Subterfuge</span>
          <a
            href="https://github.com/mkarjun/Blackout-TheSubterfuge"
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-neon"
          >
            Source on GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
