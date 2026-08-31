import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import eventManager, { EVENTS } from '../game/systems/EventManager.js';
import { IconChevron } from './Icons.jsx';

/**
 * HudPanel - a floating HUD window that gets out of the player's way.
 *
 * Three behaviours, all fixing the same complaint - panels were occluding the thing
 * you are controlling:
 *
 *   1. Proximity fade. The scene publishes the player's *screen* position on the
 *      MINIMAP channel at 15Hz; when the body walks under a panel it fades and stops
 *      taking clicks, then returns when you step out. Written straight to
 *      `style.opacity`, so a 15Hz signal costs React zero re-renders.
 *   2. Collapse to the title bar, remembered across runs.
 *   3. Global hide (Tab, or the eye button) for a clean look at the floor.
 *
 * Layout belongs to the caller; this owns only its own chrome.
 */

/** Player must be this many px clear of the panel edge before it is fully opaque. */
const FADE_MARGIN = 110;
/** How see-through a panel goes when the player is directly under it. */
const FADE_MIN = 0.12;
/** Below this the panel stops intercepting the mouse, so clicks reach the canvas. */
const CLICK_THROUGH_BELOW = 0.55;

const STORE_KEY = 'blackout:hud';

function readCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCollapsed(map) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* private mode - the panel still works, it just forgets */
  }
}

/**
 * Shortest distance from a point to a rectangle. Zero when the point is inside it.
 * @returns {number} px
 */
function distanceToRect(x, y, rect) {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

export default function HudPanel({
  id,
  title,
  icon = null,
  badge = null,
  children,
  hidden = false,
  /** false = no title bar and no body padding. For readouts that are their own chrome. */
  chrome = true,
  collapsible = true,
  defaultCollapsed = false,
  className = '',
  bodyClassName = '',
  width,
}) {
  const nodeRef = useRef(null);
  const rectRef = useRef(null);
  const hiddenRef = useRef(hidden);
  const appliedRef = useRef(1);

  const [collapsed, setCollapsed] = useState(() => {
    const saved = readCollapsed();
    return id in saved ? Boolean(saved[id]) : defaultCollapsed;
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed({ ...readCollapsed(), [id]: next });
      return next;
    });
  }, [id]);

  useEffect(() => { hiddenRef.current = hidden; }, [hidden]);

  // Keep a cached rect. Measuring inside the 15Hz handler would force layout on
  // every frame; a ResizeObserver plus a scroll/resize listener is free by comparison.
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return undefined;

    const measure = () => { rectRef.current = node.getBoundingClientRect(); };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [collapsed]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return undefined;

    const apply = (opacity) => {
      // Skip sub-pixel churn; the browser still has to recomposite on every write.
      if (Math.abs(opacity - appliedRef.current) < 0.01) return;
      appliedRef.current = opacity;
      node.style.opacity = String(opacity);
      node.style.pointerEvents = opacity < CLICK_THROUGH_BELOW ? 'none' : 'auto';
    };

    const off = eventManager.on(EVENTS.MINIMAP, ({ sx, sy }) => {
      if (hiddenRef.current) return;             // hide/show is CSS-driven, leave it alone
      const rect = rectRef.current;
      if (!rect || !Number.isFinite(sx)) return;
      const d = distanceToRect(sx, sy, rect);
      const t = Math.min(1, d / FADE_MARGIN);
      apply(FADE_MIN + (1 - FADE_MIN) * t);
    }, { replay: true });

    return () => {
      off();
      if (node) { node.style.opacity = ''; node.style.pointerEvents = ''; }
    };
  }, []);

  // The global hide wins over the proximity fade, so reset the inline opacity the
  // 15Hz handler wrote - otherwise a panel unhides at whatever it faded to.
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    if (hidden) {
      node.style.opacity = '';
      node.style.pointerEvents = '';
      appliedRef.current = 1;
    }
  }, [hidden]);

  return (
    <div
      ref={nodeRef}
      data-hud-panel={id}
      style={width ? { width } : undefined}
      className={`panel overflow-hidden transition-[opacity,transform] duration-200 ${
        hidden
          ? 'pointer-events-none translate-y-1 opacity-0'
          : 'pointer-events-auto opacity-100'
      } ${className}`}
    >
      {chrome && (
        <button
          type="button"
          onClick={collapsible ? toggle : undefined}
          disabled={!collapsible}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
            collapsible ? 'hover:bg-neon/5' : 'cursor-default'
          }`}
        >
          {icon && <span className="shrink-0 text-dim">{icon}</span>}
          <span className="panel-title flex-1 truncate">{title}</span>
          {badge}
          {collapsible && (
            <span className="shrink-0 text-dim">
              <IconChevron open={!collapsed} size={14} />
            </span>
          )}
        </button>
      )}

      {(!chrome || !collapsed) && (
        <div
          className={
            chrome
              ? `border-t border-edge/70 px-2.5 pb-2.5 pt-2 ${bodyClassName}`
              : bodyClassName
          }
        >
          {children}
        </div>
      )}
    </div>
  );
}
