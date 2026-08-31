import React from 'react';

/**
 * RotateHint - the portrait blocker.
 *
 * The floor is a wide map and the controls need both bottom corners; portrait has
 * neither the width nor the reach. Asking for the quarter turn beats shipping a
 * cramped second layout.
 *
 * It does not pause the simulation: `enterImmersive` may already have rotated the
 * device, and a pause undone by an orientation event is a race. The touch controls
 * hide themselves in portrait, which is enough - the body stops and nothing is lost.
 */

export default function RotateHint() {
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-ink/95 px-8 text-center">
      <svg
        width="86"
        height="86"
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-neon"
        aria-hidden="true"
      >
        <rect x="32" y="14" width="36" height="62" rx="5">
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="0 50 45; 0 50 45; -90 50 45; -90 50 45"
            keyTimes="0; 0.35; 0.75; 1"
            dur="2.8s"
            repeatCount="indefinite"
          />
        </rect>
        <path d="M18 86a34 34 0 0 1 8-46" opacity="0.55" />
        <path d="M18 86h10M18 86v-10" opacity="0.55" />
      </svg>

      <div>
        <h2 className="text-[17px] font-semibold text-slate-100">Turn your phone sideways</h2>
        <p className="mx-auto mt-2 max-w-[280px] text-[12.5px] leading-relaxed text-slate-400">
          The floor is wider than it is tall, and both thumbs need a corner.
        </p>
      </div>

      <p className="text-[10px] uppercase tracking-[0.2em] text-dim">
        Your run is still here
      </p>
    </div>
  );
}
