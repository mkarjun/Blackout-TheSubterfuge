/**
 * EventManager.js - The single bus between Phaser and React.
 *
 * Deliberately dependency-free (no Phaser import) so React components can subscribe
 * without pulling the engine into their chunk. Phaser scenes publish; React renders.
 * Nothing in React ever reaches into a scene directly - it emits a REQUEST_* event.
 */

export const EVENTS = {
  /* engine -> UI */
  GAME_READY: 'game:ready',
  GAME_TICK: 'game:tick',                 // throttled HUD snapshot (4/sec)
  MINIMAP: 'game:minimap',                // compact positions only (15/sec)
  GAME_OVER: 'game:over',
  GAME_PAUSED: 'game:paused',
  WORLD_EVENT: 'world:event',             // event feed entries
  LIGHTS_CHANGED: 'world:lights',
  ALERT_CHANGED: 'world:alert',
  SUSPICION_CHANGED: 'npc:suspicion',
  NPC_SPEAK: 'npc:speak',
  NPC_THOUGHT: 'npc:thought',             // debug/observer channel
  COGNITION_STATE: 'cognition:state',     // { npcId, thinking }
  COGNITION_STATS: 'cognition:stats',
  INVENTORY_CHANGED: 'player:inventory',
  OBJECTIVES_CHANGED: 'player:objectives',
  INTERACT_PROMPT: 'player:prompt',       // { label, key } | null
  DIALOGUE_OPEN: 'dialogue:open',
  DIALOGUE_CLOSE: 'dialogue:close',

  /* UI -> engine */
  REQUEST_PAUSE: 'req:pause',
  REQUEST_RESUME: 'req:resume',
  REQUEST_RESTART: 'req:restart',
  REQUEST_SAVE: 'req:save',
  REQUEST_SAY: 'req:say',                 // { text } player dialogue choice
  REQUEST_CLOSE_DIALOGUE: 'req:close-dialogue',
};

class EventManager {
  constructor() {
    this._handlers = new Map();
    this._lastValue = new Map();   // late subscribers get the current state
  }

  /**
   * @param {string} event
   * @param {Function} handler
   * @param {object} [opts]
   * @param {boolean} [opts.replay=false] Immediately fire with the last payload, if any.
   * @returns {Function} unsubscribe
   */
  on(event, handler, { replay = false } = {}) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    if (replay && this._lastValue.has(event)) {
      try { handler(this._lastValue.get(event)); } catch (err) { console.error('[EventManager] replay handler threw', event, err); }
    }
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const wrapped = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  off(event, handler) {
    const set = this._handlers.get(event);
    if (set) {
      set.delete(handler);
      if (!set.size) this._handlers.delete(event);
    }
  }

  emit(event, payload) {
    this._lastValue.set(event, payload);
    const set = this._handlers.get(event);
    if (!set) return;
    // Copy first: a handler may unsubscribe itself mid-dispatch.
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventManager] handler for "${event}" threw`, err);
      }
    }
  }

  /** Last payload seen for an event, for components mounting after the fact. */
  last(event, fallback = null) {
    return this._lastValue.has(event) ? this._lastValue.get(event) : fallback;
  }

  clear() {
    this._handlers.clear();
    this._lastValue.clear();
  }
}

export const eventManager = new EventManager();
export default eventManager;
