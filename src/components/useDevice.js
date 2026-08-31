import { useEffect, useState } from 'react';

/**
 * useDevice.js - what this is being played on, and how to get the browser out of the
 * way.
 *
 * Touch detection is `(pointer: coarse) and (hover: none)` rather than "has a
 * touchscreen": plenty of laptops report touch points and are still played with a
 * keyboard, and a virtual stick on those is worse than useless. The pair asks whether
 * the *primary* pointer is a finger, which a 2-in-1 in tablet mode correctly answers
 * yes to.
 */

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => globalThis.matchMedia?.(query).matches ?? false,
  );
  useEffect(() => {
    const mq = globalThis.matchMedia?.(query);
    if (!mq) return undefined;
    const on = (e) => setMatches(e.matches);
    mq.addEventListener('change', on);
    setMatches(mq.matches);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** True when the primary pointer is a finger. */
export function useIsTouch() {
  return useMediaQuery('(pointer: coarse) and (hover: none)');
}

/** True when the window is taller than it is wide. */
export function useIsPortrait() {
  return useMediaQuery('(orientation: portrait)');
}

/** True on the small end, where the two HUD gutters would own the screen. */
export function useIsCompact() {
  return useMediaQuery('(max-width: 1023px)');
}

/**
 * Go fullscreen and ask for landscape. Both are best-effort by design: iOS Safari has
 * no Fullscreen API on iPhone and no orientation lock anywhere, so this must degrade
 * to "nothing happened" rather than throw into the phase transition that called it.
 * The rotate-your-phone hint covers the devices that refuse.
 */
export async function enterImmersive(element) {
  const node = element || document.documentElement;
  try {
    if (!document.fullscreenElement && node.requestFullscreen) {
      await node.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch { /* denied, or unsupported - keep going */ }

  try {
    await globalThis.screen?.orientation?.lock?.('landscape');
  } catch { /* Safari, Firefox, and any browser without a fullscreen grant */ }
}

export async function exitImmersive() {
  try { globalThis.screen?.orientation?.unlock?.(); } catch { /* not supported */ }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch { /* already out */ }
}

/** True when the game is running as an installed app rather than in a browser tab. */
export function isStandalone() {
  return Boolean(
    globalThis.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)').matches
    || globalThis.navigator?.standalone,
  );
}

const IOS = /iP(hone|ad|od)/.test(globalThis.navigator?.userAgent || '')
  // iPadOS reports itself as a Mac, and is only distinguishable by its touch points.
  || (/Macintosh/.test(globalThis.navigator?.userAgent || '')
      && (globalThis.navigator?.maxTouchPoints || 0) > 1);

/**
 * Install affordance.
 *
 * Chromium fires `beforeinstallprompt` and hands over a deferred prompt we can
 * trigger from a real click. Safari fires nothing and has no API at all, so iOS gets
 * instructions instead of a button - which is the honest option, since the alternative
 * is a button that does nothing.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const onPrompt = (e) => {
      // Chrome shows its own mini-infobar unless the event is cancelled.
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return false;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use; a dismissed prompt cannot be re-fired.
    setDeferred(null);
    return outcome === 'accepted';
  };

  return {
    canInstall: Boolean(deferred) && !installed,
    // iOS can install, just not by asking - it needs the Share sheet.
    needsManualInstall: IOS && !installed && !deferred,
    installed,
    install,
  };
}

export default {
  useIsTouch, useIsPortrait, useIsCompact, useInstallPrompt,
  isStandalone, enterImmersive, exitImmersive,
};
