import React, { useEffect } from 'react';
import InventoryUI from './InventoryUI.jsx';
import SuspicionWeb from './SuspicionWeb.jsx';
import { IconClose } from './Icons.jsx';

/**
 * IntelSheet - the two HUD gutters, folded into one panel you open on purpose.
 *
 * On a phone the gutters were the wrong shape twice over: they ate half a 740px
 * screen, and hiding them by default (which is the only way the floor stays legible)
 * meant the objective list and the suspicion graph were simply unreachable. Neither
 * is optional information - one is what you are here to do and the other is the whole
 * game.
 *
 * So on touch they move behind a single Intel button. The floor pauses while it is
 * open, because the sheet covers the screen and being caught by something you cannot
 * see is not difficulty.
 */
export default function IntelSheet({ open, onClose, tick }) {
  // Escape closes it, in the capture phase so the HUD does not also read the key and
  // toss a pause overlay up behind the sheet.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const heat = tick?.heat ?? 0;
  const heatTone = heat >= 70 ? 'text-alarm' : heat >= 40 ? 'text-caution' : 'text-neon';

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close intel"
        className="absolute inset-0 bg-ink/70 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <aside className="relative flex h-full w-[360px] max-w-[86vw] flex-col border-l border-edge bg-panel">
        <header className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-slate-100">Intel</div>
            <div className="text-[10px] text-dim">
              {tick?.clock || '00:00'} &middot; {tick?.room || '-'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded border border-edge text-slate-300
                       transition-colors hover:border-neon/60 hover:text-neon"
          >
            <IconClose size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Section title="The job" badge={`${tick?.objectives?.done ?? 0}/3`}>
            <InventoryUI inventory={tick?.inventory || []} objectives={tick?.objectives || {}} />
          </Section>

          <Section title="The theory" badge={<span className={heatTone}>{heat}% heat</span>}>
            <div className="flex justify-center">
              <SuspicionWeb size={244} />
            </div>
            <SuspicionList rows={tick?.suspicion || []} />
          </Section>
        </div>

        <footer className="shrink-0 border-t border-edge px-4 py-3 text-[10px] text-dim">
          The floor is paused while this is open.
        </footer>
      </aside>
    </div>
  );
}

function Section({ title, badge, children }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="panel-title">{title}</h3>
        <span className="text-[10px] tabular-nums text-dim">{badge}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * The graph shows the shape; this shows the numbers. On a phone the node labels are
 * small enough that a plain list is the readable half, so both are shown rather than
 * making someone squint at a 244px canvas to find out who is at 71%.
 */
function SuspicionList({ rows }) {
  if (!rows.length) return null;
  return (
    <ul className="mt-3 space-y-1.5 border-t border-edge pt-3">
      {rows.map((row) => {
        const tone = row.player >= 70 ? 'text-alarm' : row.player >= 40 ? 'text-caution' : 'text-dim';
        const bar = row.player >= 70 ? 'bg-alarm' : row.player >= 40 ? 'bg-caution' : 'bg-neon';
        return (
          <li key={row.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11.5px] text-slate-300">{row.name}</span>
              <span className={`text-[11px] tabular-nums ${tone}`}>{row.player}%</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-edge">
              <div
                className={`h-full transition-all duration-300 ${bar}`}
                style={{ width: `${Math.min(100, row.player)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
