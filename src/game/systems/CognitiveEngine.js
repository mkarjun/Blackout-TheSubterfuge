/**
 * CognitiveEngine.js - The Cognitive Layer scheduler.
 *
 * This is the async half of the dual-layer engine. It owns everything slow:
 * prompt assembly, the network call, Dexie memory writes, and the fallback decision.
 * It touches an NPC only through applyCognition(), and only when a payload is ready.
 *
 * Scheduling rules (all of them exist to bound cost and latency):
 *   - One in-flight request per NPC. A newer, higher-priority trigger replaces a
 *     queued one for the same NPC rather than stacking.
 *   - MAX_CONCURRENT global cap, so five NPCs reacting to a blackout do not open five
 *     sockets at once.
 *   - Per-NPC cooldown, so a player standing in a doorway cannot farm requests.
 *   - Every request is answered. If the LLM is off, unconfigured, slow (>4s) or
 *     broken, the *same* schema comes back from ruleBasedResponse() instead. Callers
 *     have exactly one shape to handle and the game never stalls waiting.
 *
 * The pump runs on a timer, not in Phaser's update loop, so a slow JSON parse can
 * never eat a frame budget.
 */

import { llmClient } from '../../services/llmClient.js';
import { buildNpcPrompt, npcValidator } from '../../services/promptBuilder.js';
import { ruleBasedResponse } from './BehaviorTree.js';
import { appendMemory, getRecentMemories, pruneMemories } from '../../services/memoryStore.js';
import eventManager, { EVENTS } from './EventManager.js';

const MAX_CONCURRENT = 2;
const PUMP_INTERVAL_MS = 120;
const DEFAULT_COOLDOWN_MS = 5200;

/** Higher wins. Drives both queue order and replacement of a queued trigger. */
export const PRIORITY = {
  IDLE: 0,
  PLAYER_APPROACH: 2,
  PLAYER_TALK: 5,
  FOUND_EVIDENCE: 4,
  LIGHTS_OUT: 3,
  ACCUSED: 5,
  SAW_TAMPERING: 6,
};

export class CognitiveEngine {
  /**
   * @param {object} deps
   * @param {string}   deps.sessionId
   * @param {Function} deps.getWorldContext  () => { lightsOn, alertLevel, room, time }
   * @param {Function} deps.getRosterIds     () => string[]
   * @param {Function} deps.getSummaries     () => string[]
   * @param {Function} deps.getNearby        (npc) => string[]
   * @param {Function} deps.onThinking       (npc, isThinking) => void
   * @param {Function} deps.onResult         (npc, payload, meta) => void
   */
  constructor(deps = {}) {
    this.deps = deps;
    this.sessionId = deps.sessionId || 'session';
    this.queue = [];                 // pending requests, highest priority first
    this.inFlight = new Map();       // npcId -> AbortController
    this.cooldowns = new Map();      // npcId -> timestamp
    this.paused = false;

    this.stats = {
      requested: 0,
      llmOk: 0,
      fallback: 0,
      dropped: 0,
      promptTokens: 0,
      lastLatency: 0,
      lastSource: 'none',
    };

    this._timer = setInterval(() => this._pump(), PUMP_INTERVAL_MS);
  }

  setSessionId(id) {
    this.sessionId = id;
  }

  setPaused(value) {
    this.paused = value;
  }

  /**
   * Ask for a thought. Returns immediately - always. The caller should have already
   * put the NPC into a local physical state before calling this.
   *
   * @param {object} npc      NPC instance
   * @param {string} trigger  See TRIGGERS in BehaviorTree.js
   * @param {object} [opts]
   * @param {string} [opts.playerText]  What the player just said, if anything.
   * @param {object} [opts.playerPos]   { x, y } for INVESTIGATE/FOLLOW intents.
   * @param {string} [opts.detail]      Extra one-line context for the prompt.
   * @param {number} [opts.cooldownMs]
   * @param {boolean} [opts.force]      Bypass the cooldown (player-initiated talk).
   */
  request(npc, trigger, opts = {}) {
    if (!npc || npc.destroyed) return false;
    const now = performance.now();

    if (!opts.force) {
      const readyAt = this.cooldowns.get(npc.id) || 0;
      if (now < readyAt) {
        this.stats.dropped++;
        return false;
      }
    }

    const priority = opts.priority ?? PRIORITY[trigger] ?? 1;
    const existing = this.queue.findIndex((q) => q.npc.id === npc.id);
    if (existing !== -1) {
      // Keep only the most important pending trigger per NPC.
      if (this.queue[existing].priority >= priority) {
        this.stats.dropped++;
        return false;
      }
      this.queue.splice(existing, 1);
    }

    if (this.inFlight.has(npc.id)) {
      // Already thinking. A high-priority trigger cancels the stale request so the
      // NPC reacts to what just happened, not what happened four seconds ago.
      if (priority >= PRIORITY.SAW_TAMPERING) {
        this.inFlight.get(npc.id).abort();
        this.inFlight.delete(npc.id);
      } else {
        this.stats.dropped++;
        return false;
      }
    }

    this.queue.push({
      npc,
      trigger,
      priority,
      playerText: opts.playerText || null,
      playerPos: opts.playerPos || null,
      detail: opts.detail || '',
      cooldownMs: opts.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      queuedAt: now,
    });
    this.queue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);

    this.stats.requested++;
    npc.setThinking(true);
    this.deps.onThinking?.(npc, true);
    eventManager.emit(EVENTS.COGNITION_STATE, { npcId: npc.id, thinking: true });
    return true;
  }

  _pump() {
    if (this.paused) return;
    while (this.queue.length && this.inFlight.size < MAX_CONCURRENT) {
      const job = this.queue.shift();
      if (!job.npc || !job.npc.scene) continue;   // NPC left the scene while queued
      this._run(job);
    }
  }

  async _run(job) {
    const { npc, trigger } = job;
    const controller = new AbortController();
    this.inFlight.set(npc.id, controller);
    this.cooldowns.set(npc.id, performance.now() + job.cooldownMs);

    const world = this.deps.getWorldContext?.() || {};
    const rosterIds = this.deps.getRosterIds?.() || [];

    try {
      // The player's line is remembered before the reply exists, so the memory
      // window is correct even if this request times out.
      if (job.playerText) {
        await appendMemory({
          sessionId: this.sessionId,
          npcId: npc.id,
          speaker: 'PLAYER',
          text: job.playerText,
        });
      }

      let payload = null;
      let meta = { source: 'rules', latencyMs: 0, tokens: 0 };

      if (llmClient.isConfigured()) {
        const memories = await getRecentMemories(this.sessionId, npc.id, 3);
        const prompt = buildNpcPrompt({
          npc: {
            id: npc.id,
            name: npc.npcName,
            role: npc.role,
            persona: npc.persona,
            secret: npc.secretRole ? `${npc.secret} ${npc.secretRole.motive}` : npc.secret,
            emotion: npc.emotion,
          },
          world: { ...world, room: npc.roomName },
          suspicion: npc.suspicion,
          rosterIds,
          nearby: this.deps.getNearby?.(npc) || [],
          summaries: this.deps.getSummaries?.() || [],
          memories,
          trigger: this._describeTrigger(job, world),
        });

        this.stats.promptTokens += prompt.estTokens;

        const result = await llmClient.chatJSON({
          system: prompt.system,
          messages: prompt.messages,
          validate: npcValidator({ rosterIds, selfId: npc.id }),
          signal: controller.signal,
        });

        if (result.ok) {
          payload = { ...result.data, _source: 'llm' };
          meta = {
            source: 'llm',
            latencyMs: result.meta.latencyMs,
            tokens: prompt.estTokens,
            model: result.meta.model,
            attempts: result.meta.attempts,
          };
          this.stats.llmOk++;
        } else {
          meta.error = result.error;
          meta.code = result.code;
          meta.latencyMs = result.meta?.latencyMs || 0;
        }
      }

      // Mandated fallback: unconfigured, disabled, timed out, or malformed.
      if (!payload) {
        payload = ruleBasedResponse({
          npc: { id: npc.id, name: npc.npcName, archetype: npc.archetype, emotion: npc.emotion },
          trigger,
          suspicion: npc.suspicionOfPlayer(),
          world,
        });
        this.stats.fallback++;
      }

      this.stats.lastLatency = meta.latencyMs;
      this.stats.lastSource = payload._source;

      // The NPC may have been destroyed (restart) while the request was in flight.
      if (!npc.scene) return;

      const { deltas } = npc.applyCognition(payload, { playerPos: job.playerPos });

      await appendMemory({
        sessionId: this.sessionId,
        npcId: npc.id,
        speaker: 'SELF',
        text: payload.dialogue,
        meta: { emotion: payload.emotion_state, intent: payload.action_intent, source: payload._source },
      });
      pruneMemories(this.sessionId, npc.id).catch(() => {});

      eventManager.emit(EVENTS.NPC_SPEAK, {
        npcId: npc.id,
        name: npc.npcName,
        text: payload.dialogue,
        emotion: payload.emotion_state,
        source: payload._source,
      });
      eventManager.emit(EVENTS.NPC_THOUGHT, {
        npcId: npc.id,
        name: npc.npcName,
        thought: payload.internal_thought,
        intent: payload.action_intent,
        target: payload.target_entity,
        source: payload._source,
        latencyMs: meta.latencyMs,
      });

      this.deps.onResult?.(npc, payload, { ...meta, deltas });
    } catch (err) {
      console.warn('[CognitiveEngine] job failed', npc.id, err);
    } finally {
      this.inFlight.delete(npc.id);
      npc.setThinking?.(false);
      this.deps.onThinking?.(npc, false);
      eventManager.emit(EVENTS.COGNITION_STATE, { npcId: npc.id, thinking: false });
      eventManager.emit(EVENTS.COGNITION_STATS, this.getStats());
    }
  }

  /** One sentence describing why this NPC is thinking right now. */
  _describeTrigger(job, world) {
    const name = 'the intruder';
    switch (job.trigger) {
      case 'PLAYER_TALK':
        return `${name} speaks to you: "${String(job.playerText || '').slice(0, 120)}"`;
      case 'PLAYER_APPROACH':
        return `${name} has walked up to you in ${world.room || 'the corridor'}.`;
      case 'SAW_TAMPERING':
        return `You just watched ${name} tampering with ${job.detail || 'equipment'}.`;
      case 'LIGHTS_OUT':
        return 'The lights just died across this section.';
      case 'FOUND_EVIDENCE':
        return `You found ${job.detail || 'strange hardware'} on the floor here.`;
      case 'ACCUSED':
        return `${job.detail || 'Someone'} just accused you of sabotage.`;
      case 'IDLE':
      default:
        return job.detail || 'Nothing has happened for a while. You are on shift.';
    }
  }

  getStats() {
    const cfg = llmClient.getConfig();
    return {
      ...this.stats,
      queued: this.queue.length,
      inFlight: this.inFlight.size,
      provider: cfg.provider,
      model: cfg.model,
      enabled: llmClient.isConfigured(),
      llm: llmClient.getStats(),
      avgPromptTokens: this.stats.requested ? Math.round(this.stats.promptTokens / this.stats.requested) : 0,
    };
  }

  cancelAll() {
    for (const ctrl of this.inFlight.values()) ctrl.abort();
    this.inFlight.clear();
    this.queue.length = 0;
  }

  destroy() {
    clearInterval(this._timer);
    this.cancelAll();
    this.deps = {};
  }
}

export default CognitiveEngine;
