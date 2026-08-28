/**
 * smoke.mjs - Headless checks for every module that does not need a DOM.
 *
 *   node scripts/smoke.mjs      (or: npm run smoke)
 *
 * Covers the parts that are expensive to verify by playing: the map's connectivity,
 * A* correctness and budget guard, the prompt/token contract, schema validation and
 * coercion, and each llmClient transport (including the 4s deadline and the retry).
 * fetch is stubbed, so this runs with no provider and no network.
 */

import assert from 'node:assert/strict';

import {
  buildMapData, validateMap, validateAllLevels, roomIdAt, roomNameAt, TILE_SIZE,
  ITEMS, itemLabel, LEVEL_LIST, getLevel, setActiveLevel,
} from '../src/assets/tilemaps/labMap.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, getDifficulty } from '../src/game/difficulty.js';
import { GridPathfinder } from '../src/game/systems/Pathfinding.js';
import {
  buildNpcPrompt, validateNpcResponse, estimateTokens, compressEvent, pushSummary, TOKEN,
} from '../src/services/promptBuilder.js';
import { ruleBasedResponse, TRIGGERS } from '../src/game/systems/BehaviorTree.js';
import {
  LLMClient, extractJson, applyPreset, DEFAULT_LLM_CONFIG, PROVIDER_PRESETS,
} from '../src/services/llmClient.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        () => { passed++; console.log(`  ok   ${name}`); },
        (err) => { failed++; console.log(`  FAIL ${name}\n       ${err.message}`); },
      );
    }
    passed++;
    console.log(`  ok   ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
    return Promise.resolve();
  }
}

const section = (name) => console.log(`\n${name}`);

/* ------------------------------------------------------------------- map */

async function mapTests() {
  section('levels');

  await test('all three levels are fully connected and completable', () => {
    const reports = validateAllLevels();
    assert.equal(reports.length, 3);
    for (const r of reports) {
      assert.equal(r.ok, true, `${r.id} unreachable: ${r.unreachable.join(', ')}`);
      assert.ok(r.reachedTiles > 1000, `${r.id} has only ${r.reachedTiles} reachable tiles`);
    }
  });

  await test('every level defines a distinct layout and a full cast', () => {
    const seen = new Set();
    for (const level of LEVEL_LIST) {
      assert.ok(level.rooms.length >= 3, `${level.id} needs rooms`);
      assert.ok(level.cast.length >= 4, `${level.id} needs a cast`);
      const signature = JSON.stringify(level.rooms.map((r) => r.rect));
      assert.equal(seen.has(signature), false, `${level.id} reuses another level's layout`);
      seen.add(signature);
      for (const id of level.cast) {
        assert.ok(level.spawn.npcs[id], `${level.id} missing spawn for ${id}`);
        assert.ok(level.patrols[id], `${level.id} missing patrol for ${id}`);
      }
    }
  });

  await test('room lookups resolve rooms, doors and corridors', () => {
    setActiveLevel('HALDEN');
    assert.equal(roomIdAt(8, 5), 'CONTROL');
    assert.equal(roomNameAt(47, 21), 'Security Hub');
    assert.equal(roomIdAt(18, 20), 'CORRIDOR');
    assert.equal(roomIdAt(16, 5), 'CONTROL', 'a door belongs to its room');
  });

  await test('setActiveLevel switches what the lookups answer', () => {
    setActiveLevel('CRYO');
    assert.equal(roomNameAt(8, 5), 'Cryo Hall A');
    setActiveLevel('ARDENT');
    assert.equal(roomNameAt(8, 5), 'Corridor', 'Ardent has a perimeter walkway there');
    assert.equal(roomNameAt(12, 12), 'Reception');
    setActiveLevel('HALDEN');
  });

  await test('item labels are defined for every carryable', () => {
    assert.equal(itemLabel('PROTOTYPE_CHIP'), ITEMS.PROTOTYPE_CHIP.label);
    assert.equal(itemLabel('UNKNOWN_THING'), 'unknown_thing');
  });
}

/* ----------------------------------------------------------- pathfinding */

async function pathfindingTests() {
  section('Pathfinding (A*)');
  setActiveLevel('HALDEN');
  const grid = buildMapData();
  const pf = new GridPathfinder(grid);

  await test('every level is navigable spawn-to-exit', () => {
    for (const level of LEVEL_LIST) {
      const lpf = new GridPathfinder(buildMapData(level));
      const exit = level.props.find((p) => p.action === 'ESCAPE');
      const path = lpf.findPathTiles(level.spawn.player.x, level.spawn.player.y, exit.x, exit.y);
      assert.ok(path.length > 5, `${level.id}: no route from spawn to ${exit.id}`);
      for (const step of path) {
        assert.ok(lpf.isWalkable(step.x, step.y), `${level.id}: path crosses ${step.x},${step.y}`);
      }
    }
  });

  await test('finds a path across the map through doors', () => {
    const path = pf.findPathTiles(8, 5, 47, 21);   // Control Room -> Security Hub
    assert.ok(path.length > 30, `path too short: ${path.length}`);
    for (const step of path) assert.ok(pf.isWalkable(step.x, step.y), `walks through ${step.x},${step.y}`);
  });

  await test('path steps are contiguous (no teleports)', () => {
    const path = pf.findPathTiles(27, 30, 27, 4);
    let prev = { x: 27, y: 30 };
    for (const step of path) {
      const d = Math.max(Math.abs(step.x - prev.x), Math.abs(step.y - prev.y));
      assert.equal(d, 1, `jump from ${prev.x},${prev.y} to ${step.x},${step.y}`);
      prev = step;
    }
  });

  await test('never cuts a wall corner diagonally', () => {
    const path = pf.findPathTiles(8, 5, 27, 22);
    let prev = { x: 8, y: 5 };
    for (const step of path) {
      const dx = step.x - prev.x;
      const dy = step.y - prev.y;
      if (dx && dy) {
        assert.ok(pf.isWalkable(prev.x + dx, prev.y), 'diagonal past a wall');
        assert.ok(pf.isWalkable(prev.x, prev.y + dy), 'diagonal past a wall');
      }
      prev = step;
    }
  });

  await test('targets standing on furniture resolve to an adjacent tile', () => {
    const path = pf.findPathTiles(27, 30, 8, 20);  // generator core tile itself
    assert.ok(path.length > 0);
  });

  await test('node budget is respected', () => {
    const path = pf.findPathTiles(8, 5, 47, 27, { maxNodes: 40 });
    assert.ok(Array.isArray(path), 'returns a partial path rather than hanging');
  });

  await test('world-space paths land on tile centres', () => {
    const path = pf.findPath(27 * TILE_SIZE, 30 * TILE_SIZE, 27 * TILE_SIZE, 22 * TILE_SIZE);
    assert.ok(path.length > 0);
    for (const p of path) assert.equal(p.x % TILE_SIZE, TILE_SIZE / 2);
  });
}

/* -------------------------------------------------------- prompt builder */

const NPC_FIXTURE = {
  id: 'NPC_GUARD_1',
  name: 'Vance Ruiz',
  role: 'a floor guard',
  persona: 'twitchy, trusts nobody',
  secret: 'You falsified a patrol log.',
  emotion: 'SUSPICIOUS',
};
const ROSTER = ['NPC_GUARD_1', 'NPC_SCI_1', 'NPC_CHIEF'];

async function promptTests() {
  section('promptBuilder');

  await test('prompt stays inside the token budget', () => {
    const p = buildNpcPrompt({
      npc: NPC_FIXTURE,
      world: { lightsOn: false, alertLevel: 2, room: 'Generator Bay', time: '03:12' },
      suspicion: { PLAYER: 62, NPC_SCI_1: 41 },
      rosterIds: ROSTER,
      nearby: ['NPC_SCI_1(Dr. Imani Osei)'],
      summaries: ['Power was cut in sublevel 3.', 'A terminal in Lab A was breached.'],
      memories: [
        { speaker: 'PLAYER', text: 'I am with the contractor crew.' },
        { speaker: 'SELF', text: 'Badge visible at all times.' },
        { speaker: 'PLAYER', text: 'Did you see anyone near the generator?' },
      ],
      trigger: 'the intruder speaks to you',
    });
    assert.ok(p.estTokens <= TOKEN.PROMPT_BUDGET, `estTokens ${p.estTokens} > ${TOKEN.PROMPT_BUDGET}`);
    assert.ok(estimateTokens(p.context) <= TOKEN.CONTEXT_BUDGET);
  });

  await test('oversized context is trimmed, never truncated mid-section', () => {
    const huge = Array.from({ length: 40 }, (_, i) => `Fact number ${i} that is quite long indeed.`);
    const p = buildNpcPrompt({
      npc: NPC_FIXTURE,
      world: { lightsOn: true, alertLevel: 0 },
      suspicion: { PLAYER: 10 },
      rosterIds: ROSTER,
      summaries: huge,
      memories: huge.map((t) => ({ speaker: 'PLAYER', text: t })),
      trigger: 'nothing has happened',
    });
    assert.ok(estimateTokens(p.context) <= TOKEN.CONTEXT_BUDGET, 'context over budget after trim');
    assert.match(p.context, /^WORLD:/, 'world state survives trimming');
    assert.match(p.context, /EVENT: nothing has happened$/, 'trigger survives trimming');
  });

  await test('system prompt names only valid ids', () => {
    const p = buildNpcPrompt({ npc: NPC_FIXTURE, rosterIds: ROSTER, trigger: 'x' });
    assert.match(p.system, /Valid IDs: PLAYER, NPC_SCI_1, NPC_CHIEF/);
    assert.ok(!p.system.includes('Valid IDs: PLAYER, NPC_GUARD_1'), 'an NPC is not its own target');
  });

  await test('world summaries stay bounded and de-duplicated', () => {
    let s = [];
    for (let i = 0; i < 10; i++) s = pushSummary(s, compressEvent({ type: 'ALARM', room: `room ${i}` }));
    assert.equal(s.length, TOKEN.SUMMARY_WINDOW);
    s = pushSummary(s, s[0]);
    assert.equal(new Set(s).size, s.length, 'duplicates were not collapsed');
  });
}

/* ------------------------------------------------------------ validation */

async function schemaTests() {
  section('Response schema');

  await test('accepts a well-formed payload', () => {
    const v = validateNpcResponse({
      dialogue: 'Stand where I can see your hands.',
      internal_thought: 'Two coincidences is a pattern.',
      emotion_state: 'SUSPICIOUS',
      action_intent: 'INVESTIGATE',
      target_entity: 'PLAYER',
      suspicion_delta: { PLAYER: 12, NPC_SCI_1: -4 },
    }, { rosterIds: ROSTER, selfId: 'NPC_GUARD_1' });
    assert.equal(v.ok, true);
    assert.deepEqual(v.value.suspicion_delta, { PLAYER: 12, NPC_SCI_1: -4 });
  });

  await test('coerces casing and alias field names', () => {
    const v = validateNpcResponse({
      say: 'Move along.', thought: 'Nothing here.',
      emotion: 'neutral', action: 'ignore', target: 'player',
    }, { rosterIds: ROSTER, selfId: 'NPC_GUARD_1' });
    assert.equal(v.ok, true);
    assert.equal(v.value.emotion_state, 'NEUTRAL');
    assert.equal(v.value.action_intent, 'IGNORE');
    assert.equal(v.value.target_entity, 'PLAYER');
  });

  await test('clamps deltas and drops unknown or self ids', () => {
    const v = validateNpcResponse({
      dialogue: 'x', emotion_state: 'HOSTILE', action_intent: 'ACCUSE', target_entity: 'NPC_SCI_1',
      suspicion_delta: { PLAYER: 999, NPC_GUARD_1: 50, NPC_GHOST: 20, NPC_CHIEF: -900 },
    }, { rosterIds: ROSTER, selfId: 'NPC_GUARD_1' });
    assert.equal(v.value.suspicion_delta.PLAYER, 25);
    assert.equal(v.value.suspicion_delta.NPC_CHIEF, -25);
    assert.equal('NPC_GUARD_1' in v.value.suspicion_delta, false, 'self delta not dropped');
    assert.equal('NPC_GHOST' in v.value.suspicion_delta, false, 'unknown id not dropped');
  });

  await test('enforces the word caps', () => {
    const v = validateNpcResponse({
      dialogue: Array(40).fill('word').join(' '),
      internal_thought: Array(40).fill('idea').join(' '),
      emotion_state: 'NEUTRAL', action_intent: 'IGNORE', target_entity: 'PLAYER',
    }, { rosterIds: ROSTER });
    assert.ok(v.value.dialogue.split(/\s+/).length <= 21);
    assert.ok(v.value.internal_thought.split(/\s+/).length <= 16);
  });

  await test('rejects payloads missing the fields behaviour depends on', () => {
    assert.equal(validateNpcResponse({}, {}).ok, false);
    assert.equal(validateNpcResponse({ dialogue: 'hi', emotion_state: 'SLEEPY' }, {}).ok, false);
    assert.equal(validateNpcResponse({ dialogue: 'hi', emotion_state: 'NEUTRAL', action_intent: 'DANCE' }, {}).ok, false);
  });

  await test('every rule-based fallback satisfies the same schema', () => {
    for (const trigger of TRIGGERS) {
      for (const archetype of ['GUARD', 'SCIENTIST', 'TECH', 'CHIEF']) {
        for (const suspicion of [0, 50, 95]) {
          const payload = ruleBasedResponse({
            npc: { id: 'NPC_X', name: 'X', archetype, emotion: 'NEUTRAL' },
            trigger,
            suspicion,
            world: { lightsOn: false, alertLevel: 1 },
          });
          const v = validateNpcResponse(payload, { rosterIds: ROSTER, selfId: 'NPC_X' });
          assert.equal(v.ok, true, `${trigger}/${archetype}/${suspicion}: ${v.error}`);
          assert.equal(payload._source, 'rules');
        }
      }
    }
  });
}

/* -------------------------------------------------------------- llm client */

function stubFetch(handler) {
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return handler(url, opts);
  };
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const openAiReply = (content) => jsonResponse({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 210, completion_tokens: 48 },
});

const GOOD_JSON = JSON.stringify({
  dialogue: 'You again. That is twice in ten minutes.',
  internal_thought: 'Their timing keeps lining up.',
  emotion_state: 'SUSPICIOUS',
  action_intent: 'FOLLOW',
  target_entity: 'PLAYER',
  suspicion_delta: { PLAYER: 8 },
});

async function llmTests() {
  section('llmClient');
  const originalFetch = globalThis.fetch;

  await test('extractJson survives fences, prose and trailing commas', () => {
    assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('Sure! Here you go: {"a":2} Hope that helps.'), { a: 2 });
    assert.deepEqual(extractJson('{"a":3,}'), { a: 3 });
    assert.deepEqual(extractJson('{"text":"a } brace in a string","b":4}').b, 4);
    assert.equal(extractJson('no json here'), null);
  });

  await test('openai dialect: posts to /chat/completions with a bearer token', async () => {
    let seen = null;
    stubFetch((url, opts) => { seen = { url, opts }; return openAiReply(GOOD_JSON); });
    const client = new LLMClient({ provider: 'openai', dialect: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' });
    const r = await client.chatJSON({ system: 's', messages: [{ role: 'user', content: 'u' }] });
    assert.equal(r.ok, true);
    assert.equal(seen.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(seen.opts.headers.Authorization, 'Bearer sk-test');
    assert.equal(JSON.parse(seen.opts.body).messages[0].role, 'system');
    assert.equal(r.data.emotion_state, 'SUSPICIOUS');
  });

  await test('anthropic dialect: posts to /messages with x-api-key and a system field', async () => {
    let seen = null;
    stubFetch((url, opts) => {
      seen = { url, opts };
      return jsonResponse({ content: [{ type: 'text', text: GOOD_JSON }], usage: { input_tokens: 200, output_tokens: 40 } });
    });
    const client = new LLMClient({ provider: 'anthropic', dialect: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant', model: 'claude-sonnet-5' });
    const r = await client.chatJSON({ system: 'you are a guard', messages: [{ role: 'user', content: 'u' }] });
    assert.equal(r.ok, true);
    assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(seen.opts.headers['x-api-key'], 'sk-ant');
    assert.equal(seen.opts.headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(seen.opts.body);
    assert.equal(body.system, 'you are a guard');
    assert.equal(body.response_format, undefined, 'anthropic must not receive response_format');
  });

  await test('gemini preset talks the openai dialect with a bearer token', async () => {
    let seen = null;
    stubFetch((url, opts) => { seen = { url, opts }; return openAiReply(GOOD_JSON); });
    const cfg = applyPreset({ ...DEFAULT_LLM_CONFIG }, 'gemini');
    const client = new LLMClient({ ...cfg, apiKey: 'AIza-test' });
    const r = await client.chatJSON({ system: 's', messages: [{ role: 'user', content: 'u' }] });
    assert.equal(r.ok, true);
    assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(seen.opts.headers.Authorization, 'Bearer AIza-test');
    // Pinned to the preset rather than a literal: Gemini model names turn over,
    // and the contract under test is the transport, not the model of the month.
    assert.equal(JSON.parse(seen.opts.body).model, PROVIDER_PRESETS.gemini.defaultModel);
  });

  await test('custom headers are merged into every request', async () => {
    let seen = null;
    stubFetch((url, opts) => { seen = opts; return openAiReply(GOOD_JSON); });
    const client = new LLMClient({ provider: 'custom', baseUrl: 'http://localhost:8000/v1', model: 'm', customHeaders: { 'X-Gateway': 'edge-1' } });
    await client.chatJSON({ system: 's', messages: [] });
    assert.equal(seen.headers['X-Gateway'], 'edge-1');
  });

  await test('retries malformed JSON once, then succeeds', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return openAiReply(calls === 1 ? 'I think the guard would say something suspicious.' : GOOD_JSON);
    });
    const client = new LLMClient({ provider: 'custom', baseUrl: 'http://x/v1', model: 'm' });
    const r = await client.chatJSON({ system: 's', messages: [{ role: 'user', content: 'u' }] });
    assert.equal(calls, 2);
    assert.equal(r.ok, true);
    assert.equal(r.meta.attempts, 2);
  });

  await test('schema violations are retried with a repair instruction', async () => {
    let calls = 0;
    let secondBody = null;
    stubFetch((url, opts) => {
      calls++;
      if (calls === 2) secondBody = JSON.parse(opts.body);
      return openAiReply(calls === 1 ? '{"dialogue":"hi","emotion_state":"SLEEPY"}' : GOOD_JSON);
    });
    const client = new LLMClient({ provider: 'custom', baseUrl: 'http://x/v1', model: 'm' });
    const { npcValidator } = await import('../src/services/promptBuilder.js');
    const r = await client.chatJSON({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      validate: npcValidator({ rosterIds: ROSTER, selfId: 'NPC_GUARD_1' }),
    });
    assert.equal(r.ok, true);
    assert.equal(calls, 2);
    assert.match(JSON.stringify(secondBody.messages), /Invalid: emotion_state/);
  });

  await test('gives up inside the deadline and reports TIMEOUT', async () => {
    stubFetch((url, opts) => new Promise((resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      setTimeout(() => resolve(openAiReply(GOOD_JSON)), 5000);
    }));
    const client = new LLMClient({ provider: 'custom', baseUrl: 'http://x/v1', model: 'm', timeoutMs: 400 });
    const started = Date.now();
    const r = await client.chatJSON({ system: 's', messages: [] });
    const elapsed = Date.now() - started;
    assert.equal(r.ok, false);
    assert.equal(r.code, 'TIMEOUT');
    assert.ok(elapsed < 1200, `took ${elapsed}ms, deadline was 400ms`);
  });

  await test('auth failures are not retried', async () => {
    let calls = 0;
    stubFetch(() => { calls++; return jsonResponse({ error: 'bad key' }, 401); });
    const client = new LLMClient({ provider: 'openai', baseUrl: 'http://x/v1', apiKey: 'nope', model: 'm' });
    const r = await client.chatJSON({ system: 's', messages: [] });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'AUTH');
    assert.equal(calls, 1, 'a bad key was retried');
  });

  await test('unconfigured client fails fast without a request', async () => {
    let calls = 0;
    stubFetch(() => { calls++; return openAiReply(GOOD_JSON); });
    const client = new LLMClient({ provider: 'openai', baseUrl: 'http://x/v1', apiKey: '', model: 'm' });
    const r = await client.chatJSON({ system: 's', messages: [] });
    assert.equal(r.code, 'UNCONFIGURED');
    assert.equal(calls, 0);
  });

  await test('presets configure a coherent client', () => {
    const cfg = applyPreset({ ...DEFAULT_LLM_CONFIG }, 'anthropic');
    assert.equal(cfg.dialect, 'anthropic');
    assert.equal(cfg.jsonMode, false, 'anthropic has no response_format');
    assert.match(cfg.baseUrl, /api\.anthropic\.com/);
  });

  globalThis.fetch = originalFetch;
}

/* ------------------------------------------------------------ difficulty */

async function difficultyTests() {
  section('difficulty');

  await test('presets are ordered from forgiving to punishing', () => {
    const [easy, mid, hard] = DIFFICULTY_ORDER.map((id) => DIFFICULTIES[id]);
    assert.ok(easy.visionRangeMul < mid.visionRangeMul && mid.visionRangeMul < hard.visionRangeMul);
    assert.ok(easy.watchGainMul < mid.watchGainMul && mid.watchGainMul < hard.watchGainMul);
    assert.ok(easy.decayMul > mid.decayMul && mid.decayMul > hard.decayMul, 'suspicion must cool fastest on easy');
    assert.ok(easy.catchGraceMs > mid.catchGraceMs && mid.catchGraceMs > hard.catchGraceMs);
    assert.ok(easy.lockdownCount > mid.lockdownCount && mid.lockdownCount > hard.lockdownCount);
    assert.equal(mid.visionRangeMul, 1, 'the middle setting must be the unmodified baseline');
  });

  await test('unknown ids fall back to the default rather than throwing', () => {
    assert.equal(getDifficulty('NOPE').id, 'OPERATIVE');
    assert.equal(getDifficulty(undefined).id, 'OPERATIVE');
  });

  await test('no NPC outruns the player on any difficulty', async () => {
    // PLAYER_SPEED.WALK is 198; a chase the player cannot ever escape is a dead end.
    const { NPC_ROSTER } = await import('../src/game/entities/roster.js');
    for (const id of DIFFICULTY_ORDER) {
      const d = DIFFICULTIES[id];
      for (const npc of NPC_ROSTER) {
        const speed = npc.runSpeed * d.npcSpeedMul;
        assert.ok(speed < 198, `${npc.id} runs ${speed.toFixed(0)} on ${id}, player walks 198`);
      }
    }
  });
}

/* ----------------------------------------------------------------- runner */

console.log('Blackout: The Subterfuge - headless smoke tests');
await mapTests();
await pathfindingTests();
await promptTests();
await schemaTests();
await difficultyTests();
await llmTests();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
