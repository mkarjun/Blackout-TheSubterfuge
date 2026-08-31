import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

/**
 * StrictMode is deliberately left off. It double-invokes effects in dev, which would
 * boot two Phaser instances against the same parent node - doubled input handlers and
 * a halved framerate that looks exactly like a performance bug. App.jsx guards its own
 * teardown; the engine only ever wants one instance.
 */
ReactDOM.createRoot(document.getElementById('root')).render(<App />);

/**
 * Register the offline shell, production only.
 *
 * A service worker in dev is actively harmful: it caches modules Vite is trying to
 * hot-replace, and the resulting "my edit did nothing" is very hard to diagnose.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // Offline play is a bonus, not a requirement. Losing it must not break boot.
      console.warn('[pwa] service worker registration failed', err);
    });
  });
}
