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
