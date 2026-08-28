/**
 * memoryStore.js - Dexie.js (IndexedDB) schema + query handlers.
 *
 * Everything the game needs to resume lives here: player settings, the active game
 * state (including the NPC relationship matrix), per-NPC conversational memory, and
 * the dynamic event log. Cloud sync (authService.js) only ever moves *snapshots*
 * produced by exportSnapshot() - there is no online-only path in the game.
 *
 * Tables
 *   user_settings  &key                                   - singleton config rows
 *   game_sessions  &id, updatedAt, status                  - full serialisable game state
 *   npc_memories   ++id, [sessionId+npcId], sessionId, timestamp
 *   event_log      ++id, sessionId, timestamp, type        - dynamic log / event feed
 */

import Dexie from 'dexie';

export const DB_NAME = 'blackout_subterfuge';
export const SNAPSHOT_VERSION = 1;

export const db = new Dexie(DB_NAME);

db.version(1).stores({
  user_settings: '&key',
  game_sessions: '&id, updatedAt, status',
  npc_memories: '++id, [sessionId+npcId], sessionId, npcId, timestamp',
  event_log: '++id, sessionId, timestamp, type',
});

/* ------------------------------------------------------------- settings */

export const SETTINGS_KEYS = {
  LLM: 'llm_config',
  AUDIO: 'audio',
  GAMEPLAY: 'gameplay',
  LAST_SESSION: 'last_session_id',
  CLOUD: 'cloud',
};

export async function getSetting(key, fallback = null) {
  try {
    const row = await db.user_settings.get(key);
    return row ? row.value : fallback;
  } catch (err) {
    console.warn('[memoryStore] getSetting failed', key, err);
    return fallback;
  }
}

export async function setSetting(key, value) {
  await db.user_settings.put({ key, value, updatedAt: Date.now() });
  return value;
}

export async function getAllSettings() {
  const rows = await db.user_settings.toArray();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * LLM config persistence. The API key is only written when persistApiKey is on, so a
 * shared machine can run a session without leaving a key in IndexedDB.
 */
export async function saveLlmConfig(config) {
  const toStore = { ...config };
  if (!config.persistApiKey) toStore.apiKey = '';
  return setSetting(SETTINGS_KEYS.LLM, toStore);
}

export async function loadLlmConfig(fallback = null) {
  return getSetting(SETTINGS_KEYS.LLM, fallback);
}

/* ------------------------------------------------------------- sessions */

export function newSessionId() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Canonical shape of a persisted game session. Anything not in here is derived at
 * runtime and must not be relied on after a reload.
 */
export function blankSession(overrides = {}) {
  const now = Date.now();
  return {
    id: newSessionId(),
    createdAt: now,
    updatedAt: now,
    status: 'active',            // active | won | lost
    elapsedMs: 0,
    difficulty: 'standard',
    player: {
      x: 0,
      y: 0,
      inventory: [],
      objectives: {},
      detected: 0,
    },
    npcs: [],                    // [{ id, x, y, fsm, emotion, alive, lastSeenRoom }]
    suspicionMatrix: {},         // { NPC_ID: { PLAYER: n, NPC_OTHER: n } }
    world: {
      lightsOn: true,
      alertLevel: 0,
      sabotage: {},
      lockdown: false,
    },
    worldSummaries: [],          // compressed one-sentence facts (shared context)
    ...overrides,
  };
}

export async function saveSession(state) {
  const row = { ...state, updatedAt: Date.now() };
  await db.game_sessions.put(row);
  await setSetting(SETTINGS_KEYS.LAST_SESSION, row.id);
  return row;
}

export async function loadSession(id) {
  return db.game_sessions.get(id);
}

export async function loadLatestSession() {
  const lastId = await getSetting(SETTINGS_KEYS.LAST_SESSION, null);
  if (lastId) {
    const byId = await db.game_sessions.get(lastId);
    if (byId) return byId;
  }
  const all = await db.game_sessions.orderBy('updatedAt').reverse().limit(1).toArray();
  return all[0] || null;
}

export async function listSessions(limit = 20) {
  return db.game_sessions.orderBy('updatedAt').reverse().limit(limit).toArray();
}

export async function deleteSession(id) {
  await db.transaction('rw', db.game_sessions, db.npc_memories, db.event_log, async () => {
    await db.game_sessions.delete(id);
    await db.npc_memories.where('sessionId').equals(id).delete();
    await db.event_log.where('sessionId').equals(id).delete();
  });
}

/**
 * Throttled writer for the hot path. The game calls this every few seconds and on
 * every notable event; IndexedDB writes must never land inside a frame budget.
 */
let _saveTimer = null;
let _pending = null;
export function saveSessionThrottled(state, delay = 1500) {
  _pending = state;
  if (_saveTimer) return;
  _saveTimer = setTimeout(async () => {
    _saveTimer = null;
    const s = _pending;
    _pending = null;
    if (s) {
      try { await saveSession(s); } catch (err) { console.warn('[memoryStore] autosave failed', err); }
    }
  }, delay);
}

export async function flushPendingSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (_pending) {
    const s = _pending;
    _pending = null;
    await saveSession(s);
  }
}

/* ---------------------------------------------------------- npc memory */

/**
 * @param {object} entry { sessionId, npcId, speaker:'PLAYER'|'SELF'|npcId, text, meta? }
 */
export async function appendMemory(entry) {
  const row = {
    sessionId: entry.sessionId,
    npcId: entry.npcId,
    speaker: entry.speaker || 'PLAYER',
    text: String(entry.text || '').slice(0, 240),
    meta: entry.meta || null,
    timestamp: Date.now(),
  };
  await db.npc_memories.add(row);
  return row;
}

/** Sliding window of the last N direct interactions, oldest-first for prompt order. */
export async function getRecentMemories(sessionId, npcId, limit = 3) {
  const rows = await db.npc_memories
    .where('[sessionId+npcId]')
    .equals([sessionId, npcId])
    .reverse()
    .limit(limit)
    .toArray();
  return rows.reverse();
}

/** Keep the table from growing without bound over a long session. */
export async function pruneMemories(sessionId, npcId, keep = 24) {
  const ids = await db.npc_memories
    .where('[sessionId+npcId]')
    .equals([sessionId, npcId])
    .reverse()
    .offset(keep)
    .primaryKeys();
  if (ids.length) await db.npc_memories.bulkDelete(ids);
  return ids.length;
}

export async function getAllMemories(sessionId) {
  return db.npc_memories.where('sessionId').equals(sessionId).toArray();
}

/* ------------------------------------------------------------ event log */

export async function appendEvent(sessionId, event) {
  const row = {
    sessionId,
    type: event.type || 'INFO',
    actor: event.actor || null,
    room: event.room || null,
    detail: event.detail || '',
    tone: event.tone || 'info',    // info | warn | alarm | success
    timestamp: Date.now(),
  };
  await db.event_log.add(row);
  return row;
}

export async function getEvents(sessionId, limit = 50) {
  const rows = await db.event_log
    .where('sessionId')
    .equals(sessionId)
    .reverse()
    .limit(limit)
    .toArray();
  return rows.reverse();
}

/* ------------------------------------------------------------ snapshots */

/**
 * Full database export. This is the unit of cloud backup and of the
 * "Download save" button in the HUD.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeSecrets=false] Include the stored API key.
 */
export async function exportSnapshot({ includeSecrets = false } = {}) {
  const [settings, sessions, memories, events] = await Promise.all([
    db.user_settings.toArray(),
    db.game_sessions.toArray(),
    db.npc_memories.toArray(),
    db.event_log.toArray(),
  ]);

  const scrubbed = settings.map((row) => {
    if (row.key === SETTINGS_KEYS.LLM && !includeSecrets) {
      return { ...row, value: { ...(row.value || {}), apiKey: '' } };
    }
    return row;
  });

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'blackout-the-subterfuge',
    counts: {
      settings: scrubbed.length,
      sessions: sessions.length,
      memories: memories.length,
      events: events.length,
    },
    tables: { user_settings: scrubbed, game_sessions: sessions, npc_memories: memories, event_log: events },
  };
}

/**
 * Restore a snapshot.
 * @param {object} snapshot
 * @param {object} [opts]
 * @param {'merge'|'replace'} [opts.mode='merge']  replace wipes local data first.
 */
export async function importSnapshot(snapshot, { mode = 'merge' } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.tables) {
    throw new Error('Not a Blackout snapshot: missing "tables"');
  }
  if (snapshot.snapshotVersion > SNAPSHOT_VERSION) {
    throw new Error(`Snapshot v${snapshot.snapshotVersion} is newer than this build (v${SNAPSHOT_VERSION})`);
  }

  const { user_settings = [], game_sessions = [], npc_memories = [], event_log = [] } = snapshot.tables;

  await db.transaction('rw', db.user_settings, db.game_sessions, db.npc_memories, db.event_log, async () => {
    if (mode === 'replace') {
      await Promise.all([
        db.user_settings.clear(),
        db.game_sessions.clear(),
        db.npc_memories.clear(),
        db.event_log.clear(),
      ]);
    }
    // Auto-increment rows are re-added without their old primary keys so a merge
    // cannot collide with locally generated ids.
    await db.user_settings.bulkPut(user_settings);
    await db.game_sessions.bulkPut(game_sessions);
    await db.npc_memories.bulkAdd(npc_memories.map(({ id, ...rest }) => rest));
    await db.event_log.bulkAdd(event_log.map(({ id, ...rest }) => rest));
  });

  return {
    settings: user_settings.length,
    sessions: game_sessions.length,
    memories: npc_memories.length,
    events: event_log.length,
  };
}

export async function clearAll() {
  await db.transaction('rw', db.user_settings, db.game_sessions, db.npc_memories, db.event_log, async () => {
    await Promise.all([
      db.user_settings.clear(),
      db.game_sessions.clear(),
      db.npc_memories.clear(),
      db.event_log.clear(),
    ]);
  });
}

export async function getDbStats() {
  const [settings, sessions, memories, events] = await Promise.all([
    db.user_settings.count(),
    db.game_sessions.count(),
    db.npc_memories.count(),
    db.event_log.count(),
  ]);
  return { settings, sessions, memories, events };
}

export default db;
