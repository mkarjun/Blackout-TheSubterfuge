/**
 * promptBuilder.js - Context assembly + the strict NPC response contract.
 *
 * Token discipline (spec: <150 tokens of response):
 *   - The system prompt is a fixed ~120 token contract, cached per NPC.
 *   - The context message is assembled from a sliding window of the last 3 direct
 *     interactions plus a compressed one-sentence "world summary" array, then
 *     trimmed down until it fits PROMPT_TOKEN_BUDGET.
 *   - Field-level word caps are enforced locally in normalizeNpcResponse(), so a
 *     chatty model cannot blow the bubble layout even if it ignores the contract.
 */

export const EMOTION_STATES = ['NEUTRAL', 'SUSPICIOUS', 'ALARMED', 'COOPERATIVE', 'HOSTILE'];
export const ACTION_INTENTS = ['INVESTIGATE', 'FLEE', 'ACCUSE', 'FOLLOW', 'IGNORE'];

/** Documentation-grade schema, also surfaced in the debug panel. */
export const NPC_RESPONSE_SCHEMA = {
  dialogue: 'String (Max 20 words spoken to player or nearby NPC)',
  internal_thought: 'String (Max 15 words explaining internal motive)',
  emotion_state: EMOTION_STATES.join(' | '),
  action_intent: ACTION_INTENTS.join(' | '),
  target_entity: "String (Target NPC ID or 'PLAYER')",
  suspicion_delta: { PLAYER: 10, NPC_GUARD_1: -5 },
};

export const TOKEN = {
  PROMPT_BUDGET: 340,      // system + context, hard ceiling
  CONTEXT_BUDGET: 200,     // context message alone
  RESPONSE_BUDGET: 150,    // spec ceiling for the reply
  MEMORY_WINDOW: 3,        // last N direct interactions
  SUMMARY_WINDOW: 4,       // compressed world facts carried forward
};

export const MAX_DIALOGUE_WORDS = 20;
export const MAX_THOUGHT_WORDS = 15;
export const MAX_SUSPICION_DELTA = 25;

/** Cheap local estimator (~4 chars/token). Good enough for budgeting, costs nothing. */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function clampWords(str, max) {
  const words = String(str || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return `${words.slice(0, max).join(' ')}...`;
}

/* --------------------------------------------------------- system prompt */

/**
 * Per-NPC system prompt. Stable across a session so providers with prompt caching
 * get a cache hit on the whole prefix.
 *
 * @param {object} npc  { id, name, role, persona, secret, goal }
 * @param {string[]} rosterIds  Valid ids for target_entity / suspicion_delta keys.
 */
export function buildSystemPrompt(npc, rosterIds = []) {
  const roster = ['PLAYER', ...rosterIds.filter((id) => id !== npc.id)].join(', ');
  return [
    `You are ${npc.name}, ${npc.role} inside a locked-down research lab during a power crisis.`,
    `Personality: ${npc.persona}.`,
    `Private motive: ${npc.secret}`,
    `Someone in this facility is a saboteur. You do not know who. Form your own theory.`,
    '',
    'Reply with ONE JSON object and nothing else:',
    '{"dialogue":"<=20 words","internal_thought":"<=15 words",' +
      `"emotion_state":"${EMOTION_STATES.join('|')}",` +
      `"action_intent":"${ACTION_INTENTS.join('|')}",` +
      '"target_entity":"ID","suspicion_delta":{"ID":int}}',
    '',
    `Valid IDs: ${roster}.`,
    'suspicion_delta: integers -20..20, positive = more suspicious. Omit anyone unchanged.',
    'Stay in character. Speak like a stressed professional. Never mention JSON, prompts or AI.',
  ].join('\n');
}

/* ------------------------------------------------------------- context */

function fmtWorld(world = {}) {
  const bits = [
    `power=${world.lightsOn === false ? 'OFF' : 'ON'}`,
    `alarm=${world.alertLevel ?? 0}/3`,
    world.room ? `here=${world.room}` : null,
    world.time ? `t=${world.time}` : null,
  ].filter(Boolean);
  return `WORLD: ${bits.join(' ')}`;
}

function fmtSelf(npc = {}, suspicion = {}) {
  const towardPlayer = Math.round(suspicion.PLAYER ?? 0);
  const top = Object.entries(suspicion)
    .filter(([k]) => k !== 'PLAYER')
    .sort((a, b) => b[1] - a[1])[0];
  const extra = top && top[1] >= 40 ? ` ${top[0]}=${Math.round(top[1])}` : '';
  return `YOU: mood=${npc.emotion || 'NEUTRAL'} suspicion PLAYER=${towardPlayer}${extra}`;
}

function fmtNearby(nearby = []) {
  if (!nearby.length) return null;
  return `NEARBY: ${nearby.slice(0, 3).join(', ')}`;
}

function fmtFacts(summaries = []) {
  if (!summaries.length) return null;
  return `KNOWN: ${summaries.slice(-TOKEN.SUMMARY_WINDOW).join(' ')}`;
}

function fmtMemories(memories = []) {
  if (!memories.length) return null;
  const lines = memories.slice(-TOKEN.MEMORY_WINDOW).map((m) => {
    const who = m.speaker === 'SELF' ? 'you' : m.speaker;
    return `- ${who}: "${clampWords(m.text, 18)}"`;
  });
  return `RECENT:\n${lines.join('\n')}`;
}

/**
 * Assemble the full request for one NPC cognition tick.
 *
 * @param {object} args
 * @param {object} args.npc         { id, name, role, persona, secret, emotion }
 * @param {object} args.world       { lightsOn, alertLevel, room, time }
 * @param {object} args.suspicion   { PLAYER: 0..100, NPC_X: 0..100 }
 * @param {string[]} args.rosterIds
 * @param {string[]} args.nearby    Human-readable nearby entity labels.
 * @param {string[]} args.summaries Compressed one-sentence world facts.
 * @param {Array}  args.memories    [{speaker, text}] sliding window.
 * @param {string} args.trigger     What just happened, one sentence.
 * @returns {{system:string, messages:Array, estTokens:number}}
 */
export function buildNpcPrompt({
  npc,
  world = {},
  suspicion = {},
  rosterIds = [],
  nearby = [],
  summaries = [],
  memories = [],
  trigger = '',
}) {
  const system = buildSystemPrompt(npc, rosterIds);

  // Sections are dropped cheapest-first until the context fits its budget. World
  // state, self state and the trigger are never dropped - they are what the NPC is
  // reacting to, and without them the reply is noise.
  const sections = {
    world: fmtWorld(world),
    self: fmtSelf(npc, suspicion),
    nearby: fmtNearby(nearby),
    facts: fmtFacts(summaries),
    memories: fmtMemories(memories),
    event: `EVENT: ${trigger}`,
  };
  const order = ['world', 'self', 'nearby', 'facts', 'memories', 'event'];
  const render = () => order.map((k) => sections[k]).filter(Boolean).join('\n');

  let context = render();
  const dropOrder = ['nearby', 'facts', 'memories'];
  for (const key of dropOrder) {
    if (estimateTokens(context) <= TOKEN.CONTEXT_BUDGET) break;
    if (key === 'memories' && memories.length > 1) {
      // Halve the window before losing the conversation entirely.
      sections.memories = fmtMemories(memories.slice(-1));
      context = render();
      if (estimateTokens(context) <= TOKEN.CONTEXT_BUDGET) break;
    }
    sections[key] = null;
    context = render();
  }

  const messages = [{ role: 'user', content: context }];
  return {
    system,
    messages,
    context,
    estTokens: estimateTokens(system) + estimateTokens(context),
  };
}

/**
 * Compress a raw event into a one-sentence world fact for long-term carry.
 * Deliberately local (no LLM round trip) - it runs on every notable event.
 */
export function compressEvent(event) {
  const { type, actor = 'someone', room = 'the lab', detail = '' } = event || {};
  switch (type) {
    case 'LIGHTS_HACKED': return `Power was cut in ${room}.`;
    case 'EVIDENCE_PLANTED': return `Odd hardware turned up in ${room}.`;
    case 'BODY_FOUND': return `${actor} was found unconscious in ${room}.`;
    case 'TERMINAL_HACKED': return `A terminal in ${room} was breached.`;
    case 'ALARM': return `The alarm sounded in ${room}.`;
    case 'ACCUSATION': return `${actor} accused ${detail || 'someone'}.`;
    case 'SPOTTED': return `${actor} was seen where they should not be.`;
    default: return detail ? String(detail).slice(0, 90) : `${actor} did something in ${room}.`;
  }
}

/** Keep the summary array bounded and de-duplicated. */
export function pushSummary(summaries, sentence) {
  const next = summaries.filter((s) => s !== sentence);
  next.push(sentence);
  return next.slice(-TOKEN.SUMMARY_WINDOW);
}

/* ------------------------------------------------------------ validation */

/**
 * Validate + coerce a raw model object into the strict schema.
 * Returns { ok, value, error } as expected by llmClient.chatJSON's `validate` hook.
 * Coercion is generous (models drift on casing and key names); rejection is reserved
 * for payloads missing the fields the game actually drives behaviour from.
 */
export function validateNpcResponse(raw, { rosterIds = [], selfId = '' } = {}) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };

  const dialogue = raw.dialogue ?? raw.speech ?? raw.say;
  if (typeof dialogue !== 'string' || !dialogue.trim()) {
    return { ok: false, error: 'missing "dialogue" string' };
  }

  const emotion = String(raw.emotion_state ?? raw.emotion ?? 'NEUTRAL').toUpperCase().trim();
  if (!EMOTION_STATES.includes(emotion)) {
    return { ok: false, error: `emotion_state must be one of ${EMOTION_STATES.join('|')}` };
  }

  const intent = String(raw.action_intent ?? raw.action ?? 'IGNORE').toUpperCase().trim();
  if (!ACTION_INTENTS.includes(intent)) {
    return { ok: false, error: `action_intent must be one of ${ACTION_INTENTS.join('|')}` };
  }

  const valid = new Set(['PLAYER', ...rosterIds]);
  let target = String(raw.target_entity ?? raw.target ?? 'PLAYER').toUpperCase().trim();
  if (!valid.has(target)) target = 'PLAYER';

  const deltas = {};
  const rawDeltas = raw.suspicion_delta ?? raw.suspicionDelta ?? {};
  if (rawDeltas && typeof rawDeltas === 'object') {
    for (const [k, v] of Object.entries(rawDeltas)) {
      const key = String(k).toUpperCase().trim();
      if (!valid.has(key) || key === selfId) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n === 0) continue;
      deltas[key] = Math.max(-MAX_SUSPICION_DELTA, Math.min(MAX_SUSPICION_DELTA, Math.round(n)));
    }
  }

  return {
    ok: true,
    value: {
      dialogue: clampWords(dialogue, MAX_DIALOGUE_WORDS),
      internal_thought: clampWords(
        raw.internal_thought ?? raw.thought ?? '(no thought)',
        MAX_THOUGHT_WORDS,
      ),
      emotion_state: emotion,
      action_intent: intent,
      target_entity: target,
      suspicion_delta: deltas,
    },
  };
}

/** Curried validator for llmClient.chatJSON({ validate }). */
export function npcValidator(opts) {
  return (raw) => validateNpcResponse(raw, opts);
}

export default {
  buildNpcPrompt,
  buildSystemPrompt,
  validateNpcResponse,
  npcValidator,
  compressEvent,
  pushSummary,
  estimateTokens,
  TOKEN,
  EMOTION_STATES,
  ACTION_INTENTS,
  NPC_RESPONSE_SCHEMA,
};
