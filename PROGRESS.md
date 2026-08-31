# PROGRESS.md - Blackout: The Subterfuge

> Living ledger of completed features, file paths, export signatures, and architectural
> decisions. Read this first in any fresh chat session, then inspect the codebase.

**Project:** 2D top-down stealth & social-deduction mystery.
**Stack:** Vite 6 + React 18 + Tailwind 3 + Phaser 3.90 + Dexie 4 + universal OpenAI-compatible LLM client.
**Ledger created:** 2026-08-28 · **Last updated:** 2026-08-31 (rev 5: Cloudflare hosting, landing page, multiplayer foundation)

---

## 1. Phase Status

| Phase | Name                                       | Status | Notes |
|-------|--------------------------------------------|--------|-------|
| 0     | Ledger / scaffolding                       | DONE   | Vite + React + Tailwind + Phaser installed and building |
| 1     | Universal LLM client                       | DONE   | 4 dialect targets, wall-clock deadline, structural retry |
| 2     | Dexie database & state management          | DONE   | 4 tables, throttled autosave, snapshot import/export |
| 3     | Phaser world & entities                    | DONE   | Carved tilemap, A* pathfinding, vision cones, 5 NPCs |
| 4     | Async cognitive engine & context pipeline  | DONE   | Queue + concurrency cap + fallback, typewriter bubbles |
| 5     | React HUD & settings overlay               | DONE   | HUD, provider config, saves/cloud, dialogue panel |

**Verified working** (see §6): full run loop, win, loss, restart, save/resume, gossip
propagation, lockdown, evidence framing, model path and rule-based fallback path.

---

## 2. Architectural Decisions

**AD-1. The behaviour tree is the game; the LLM is garnish.**
`update()` in `MainLabScene` is fully synchronous: perception, A*, FSM, collisions.
Cognition is requested and forgotten. Every trigger site sets a local physical
reaction *before* calling `cognition.request()`, so pulling the network cable changes
the writing, never the game. `applyCognition()` treats `action_intent` as a nudge
(a point of interest, a flee timer), never a direct command - a 4-second-old intent
cannot yank a body that has since been alerted by something closer.

**AD-2. One wall-clock deadline spanning all retries.**
`llmClient.chatJSON()` takes a single 4000ms budget for the whole call including
retries, rather than a per-attempt timeout. Two attempts × 4s would have been 8s of an
NPC standing mute. Past the deadline the request aborts and the caller falls back.

**AD-3. The fallback emits the identical schema.**
`ruleBasedResponse()` in `BehaviorTree.js` returns the same six fields as the model,
tagged `_source: 'rules'`. Downstream code has exactly one shape to handle. A smoke
test asserts every (trigger × archetype × suspicion-band) combination validates
against the real validator.

**AD-4. Cognition is scheduled off the render loop.**
`CognitiveEngine` pumps on a `setInterval`, not in `update()`. One in-flight request
per NPC, `MAX_CONCURRENT = 2` globally, per-NPC cooldowns, and priority replacement of
queued triggers. A blackout with five witnesses costs two sockets, not five.

**AD-5. The map is carved, not hand-drawn, and validated at boot.**
`buildMapData()` fills solid rock, then cuts corridors, rooms and doors from data.
`validateMap()` flood-fills from the player spawn and asserts every room centre, prop,
NPC spawn and patrol node is reachable. It runs in dev at boot and in the smoke test -
a sealed room is otherwise a bug you find ten minutes into a playthrough.

**AD-6. Zero binary assets.**
Every texture is drawn in `BootScene` with Canvas2D; every sound is a WebAudio
oscillator envelope in `Sfx.js`. No loading screen, no licences, and the repo reads
end to end.

**AD-7. Glass blocks movement but not sight.**
`COLLIDING` and `SIGHT_BLOCKING` are separate tile lists. This is what makes the
Server Vault dangerous to cross and gives cover (crates) a distinct meaning.

**AD-8. React never reaches into a scene.**
All traffic goes through `eventManager`. Engine → UI is `GAME_TICK` at 4Hz plus
discrete events; UI → engine is `REQUEST_*`. The bus retains the last payload per
event so late-mounting components hydrate immediately (`{ replay: true }`).

**AD-9. Local-first persistence.**
IndexedDB is the source of truth. Firebase is dynamically imported and entirely
optional - unconfigured, every cloud function returns `{ ok:false, reason:'not-configured' }`
and the game is unaffected. Snapshots scrub the API key before upload or download.

**AD-10. Provider config is runtime, not build-time.**
No key ever enters the bundle. `.env` carries only optional Firebase values. Localhost
providers are routed through a Vite dev proxy (`/ollama`, `/lmstudio`) so Ollama and
LM Studio need no CORS configuration.

**AD-11. StrictMode is off** (`main.jsx`). Double-invoked effects would boot two Phaser
instances against one parent node: doubled input, halved framerate.

**AD-15. Levels are data; difficulty is multipliers.**
`assets/tilemaps/levels/*.js` each supply rooms, corridors, doors, cover, props, a cast
and patrol routes. `labMap.js` is now a registry that carves whichever level is active
and answers room lookups against it - `setActiveLevel()` is the only switch. All three
share the 56x33 grid so the tileset, pathfinder bounds and minimap projection stay
constants rather than per-level state.

Difficulty (`game/difficulty.js`) is *only* multipliers and overrides applied at NPC
construction or at the check site - never a branch in the logic - so the same code path
runs on every setting and a balance change cannot silently break one of them.

The level validator now also asserts each level is *completable*: three sabotage
targets, an exit, and a spawn plus a patrol for every cast member. A smoke test enforces
that no NPC on any difficulty outruns the player - it caught Ghost's speed multiplier
pushing the guard to 207 against the player's 198, which would have reintroduced the
unescapable chase AD-14 exists to prevent.

**AD-14. Losing must always have had counterplay.**
Three fixes came out of actually playing the game, all of the same shape - a state the
player could enter with no legal way out:
  * A sabotage channel locked you in place for up to 3.4s with no cancel, so a guard
    walking in was an unavoidable loss. E now aborts the channel (progress is lost).
  * Detention triggered on the single frame you became catchable. It now needs
    CATCH_GRACE_MS (800ms) of unbroken contact, announces itself, and staggers the
    grabber for 420ms - because NPC run speeds sit within ~6px/s of the player's walk,
    so without the stagger "break away" was advice you could not act on. Verified both
    ways: run immediately and you clear to 103px and survive; stand still and you are
    detained at 802ms.
  * Chief Rook ran at 207 against a player walking 198 - literally impossible to
    outrun. Now 189.
Planted evidence also no longer frames an NPC who is currently hunting you: they walked
over, found it themselves, and it counted against the player instead of misdirecting.

**AD-13. The minimap bypasses React's render cycle.**
`GAME_TICK` stays at 4Hz because it re-renders the whole overlay; a 4Hz player blip
reads as broken. So the minimap has its own 15Hz `MINIMAP` event carrying only
positions, and `Minimap.jsx` draws straight to a canvas from the event handler - it
never calls setState, so it costs zero React renders while you play. Terrain is
rasterised once at mount and blitted; per-frame work is one drawImage plus ~10 dots.

**AD-12. The world is authored at 48px tiles and rendered at native resolution.**
The first build drew a fixed 1280x720 buffer with `Scale.FIT` and `pixelArt: true`, so
on any larger window the browser upscaled it with nearest-neighbour - which is exactly
what "low graphics" looks like. Now `Scale.RESIZE` sizes the canvas to the window,
antialiasing is on, and TILE_SIZE is 48 with the camera at zoom <= 1.0, so art renders
at or below 1:1 rather than being magnified. Every pixel constant (speeds, vision
ranges, interaction radii, body sizes, epsilons) was scaled by the same 1.5, so
traversal times and detection balance are unchanged from the tuned values. Textures are
authored at the new size with gradients, panel lines, rivets and rim lighting, and
rooms carry additive light pools that a blackout extinguishes.

### Deviations from the original spec (all additive)

- Extra files beyond the spec's tree: `game/systems/CognitiveEngine.js`, `Pathfinding.js`,
  `Sfx.js`, `entities/SpeechBubble.js`, `entities/roster.js`, `components/DialoguePanel.jsx`,
  `assets/tilemaps/labMap.js`, `scripts/smoke.mjs`.
- Extra Dexie table `event_log` (spec named three; the dynamic log needed its own).
- The tilemap is generated from data rather than a Tiled `.json` export. It is still a
  real Phaser tilemap with a collision layer, just built by `make.tilemap({ data })`.
- Added Shift-to-sneak (reduces NPC effective vision range and silences footsteps).
- Added an Exit button (HUD, pause overlay and end-of-run modal) that saves, tears down
  the engine and returns to the title screen with Resume offered.
- Dev server binds all interfaces (`server.host: true`) for LAN play.
- Google Gemini added as a provider preset. It needs no new dialect - Google's
  OpenAI-compatible endpoint (`/v1beta/openai`) works with the existing `openai` path,
  bearer auth and `/models` listing.
- Circular minimap in the bottom-right corner (`components/Minimap.jsx`).

---

## 3. File Map

```
PROGRESS.md, README.md, .env.example, .claude/launch.json
scripts/smoke.mjs                 29 headless tests (npm run smoke)
src/
  main.jsx                        React root (no StrictMode - see AD-11)
  App.jsx                         Boot, start screen, Phaser lifecycle, modal hosting
  index.css                       Tailwind layers + .panel/.btn/.field component classes
  components/
    GameOverlay.jsx               HUD root, suspicion panel, event feed, cognition strip, end modal
    ApiConfigModal.jsx            Provider config + connection test (exports shared Modal)
    AuthModal.jsx                 Local snapshots, Google sign-in, cloud backup/restore
    InventoryUI.jsx               Objectives checklist + carried items
    Minimap.jsx                   Circular map: layout + player + objectives, no NPCs
                                  (NPC plotting deliberately removed - finding people is the game)
    DialoguePanel.jsx             Interrogation UI, quick lines, accusations, free text
  services/
    llmClient.js                  Universal provider client
    memoryStore.js                Dexie schema + queries + snapshots
    promptBuilder.js              Prompt assembly, token budget, schema validation
    authService.js                Firebase auth + cloud/local snapshot bridge
  game/
    GameConfig.js                 Phaser config + create/destroy/restart + dev handle
    scenes/BootScene.js           Procedural textures, map validation, scene handoff
    scenes/MainLabScene.js        The game: world, actions, social simulation, persistence
    scenes/HUDScene.js            Canvas-space prompt, channel bar, alert vignette
    entities/Player.js            Input, movement, sneak, noise emission
    entities/NPC.js               Body + FSM + cognition socket
    entities/SpeechBubble.js      Typewriter bubbles with per-speaker blips
    entities/roster.js            Cast definitions + per-session secret roles
    systems/BehaviorTree.js       Node set, the NPC tree, rule-based dialogue fallback
    systems/CognitiveEngine.js    Async cognition scheduler
    systems/Pathfinding.js        Grid A* (binary heap, no corner cutting, node budget)
    systems/VisionCone.js         DDA line of sight + cone rendering
    systems/EventManager.js       Phaser <-> React bus
    systems/Sfx.js                Procedural WebAudio
  assets/tilemaps/labMap.js       Level registry, carving, room lookups, validation
  assets/tilemaps/tiles.js        Tile vocabulary + items, shared by every level
  assets/tilemaps/levels/         level1 Halden / level2 Cryo Annex / level3 Ardent Tower
  game/difficulty.js              Recruit / Operative / Ghost tuning presets
```

---

## 4. Export Signatures

### services/llmClient.js
```js
PROVIDER_PRESETS            // { openai, anthropic, openrouter, ollama, lmstudio, custom }
DEFAULT_LLM_CONFIG          // provider, baseUrl, apiKey, model, customHeaders, temperature,
                            // maxTokens, timeoutMs=4000, maxAttempts=2, jsonMode, enabled, ...
applyPreset(config, providerId) -> config
resolveBaseUrl(config) -> string          // dev-proxy aware
extractJson(text) -> object|null          // fences, prose, trailing commas, braces in strings
class LLMClient
  updateConfig(patch) / getConfig() / subscribe(fn) -> unsubscribe
  getStats() -> { calls, ok, failed, timeouts, parseFailures, retries, avgLatency, successRate, lastError }
  isConfigured() -> boolean
  chatJSON({ system, messages, validate?, timeoutMs?, maxTokens?, temperature?, signal? })
      -> { ok, data?, raw?, error?, code?, meta:{ provider, model, attempts, latencyMs, usage } }
      // code: UNCONFIGURED | TIMEOUT | AUTH | HTTP | NETWORK | PARSE | SCHEMA | CANCELLED
  chatText(opts) -> { ok, data?, error?, code?, meta }
  testConnection(timeoutMs?) -> { ok, latencyMs, error, code, model, provider }
  listModels(timeoutMs?) -> { ok, models[], error? }
llmClient                   // singleton, rehydrated from Dexie in App.jsx
```

### services/promptBuilder.js
```js
EMOTION_STATES, ACTION_INTENTS, NPC_RESPONSE_SCHEMA
TOKEN = { PROMPT_BUDGET:340, CONTEXT_BUDGET:200, RESPONSE_BUDGET:150, MEMORY_WINDOW:3, SUMMARY_WINDOW:4 }
estimateTokens(text) -> number
buildSystemPrompt(npc, rosterIds) -> string
buildNpcPrompt({ npc, world, suspicion, rosterIds, nearby, summaries, memories, trigger })
    -> { system, messages, context, estTokens }
validateNpcResponse(raw, { rosterIds, selfId }) -> { ok, value?, error? }
npcValidator(opts) -> (raw) => validateNpcResponse(raw, opts)
compressEvent(event) -> string            // one-sentence world fact
pushSummary(summaries, sentence) -> string[]   // bounded + de-duplicated
```

### services/memoryStore.js
```js
db, DB_NAME, SNAPSHOT_VERSION, SETTINGS_KEYS
// tables: user_settings &key | game_sessions &id,updatedAt,status
//         npc_memories ++id,[sessionId+npcId],sessionId,npcId,timestamp
//         event_log ++id,sessionId,timestamp,type
getSetting(key, fallback) / setSetting(key, value) / getAllSettings()
saveLlmConfig(config) / loadLlmConfig(fallback)      // honours persistApiKey
newSessionId() / blankSession(overrides) -> session
saveSession(state) / loadSession(id) / loadLatestSession() / listSessions(limit) / deleteSession(id)
saveSessionThrottled(state, delay=1500) / flushPendingSave()
appendMemory({ sessionId, npcId, speaker, text, meta }) 
getRecentMemories(sessionId, npcId, limit=3)          // oldest-first
pruneMemories(sessionId, npcId, keep=24) / getAllMemories(sessionId)
appendEvent(sessionId, event) / getEvents(sessionId, limit)
exportSnapshot({ includeSecrets=false }) / importSnapshot(snapshot, { mode:'merge'|'replace' })
clearAll() / getDbStats()
```

### services/authService.js
```js
isCloudConfigured() -> boolean
signInWithGoogle() / signOutUser() / onAuthChanged(cb) -> Promise<unsubscribe> / getCurrentUser()
backupToCloud() -> { ok, bytes, counts, at } | { ok:false, reason }
restoreFromCloud(mode='replace') / getCloudMeta()
downloadSnapshotFile({ includeSecrets }) / importSnapshotFile(file, mode)
```

### game/GameConfig.js
```js
buildConfig(parent) / createGame(parent, { resume }) / getGame() / destroyGame() / restartGame()
// Scale.RESIZE (canvas follows the window), antialias on, pixelArt off.
// dev only: globalThis.__BLACKOUT__ = { game, scene(), step(frames) }
//   step() forces loop.inFocus and passes a real timestamp - Phaser zeroes delta while
//   the window is blurred, and step() without a timestamp makes delta NaN permanently.
```

### game/systems/EventManager.js
```js
EVENTS = {
  // engine -> UI
  GAME_READY, GAME_TICK, MINIMAP, GAME_OVER, GAME_PAUSED, WORLD_EVENT, LIGHTS_CHANGED,
  ALERT_CHANGED, SUSPICION_CHANGED, NPC_SPEAK, NPC_THOUGHT, COGNITION_STATE,
  COGNITION_STATS, INVENTORY_CHANGED, OBJECTIVES_CHANGED, INTERACT_PROMPT,
  DIALOGUE_OPEN, DIALOGUE_CLOSE,
  // UI -> engine
  REQUEST_PAUSE, REQUEST_RESUME, REQUEST_RESTART, REQUEST_SAVE, REQUEST_SAY,
  REQUEST_CLOSE_DIALOGUE,
}
eventManager.on(event, handler, { replay }) -> off | once | off | emit | last(event, fallback) | clear
// GAME_TICK payload: { clock, room, lightsOn, alertLevel, lockdown, heat, suspicion[],
//                      objectives, inventory, sneaking, channel, hackReadyIn, cognition }
// MINIMAP payload (15Hz, deliberately tiny): { px, py, pf, dark,
//                      done:{POWER,DATA,CAMERAS}, ready }   - no NPC positions
```

### game/systems/CognitiveEngine.js
```js
PRIORITY = { IDLE:0, PLAYER_APPROACH:2, LIGHTS_OUT:3, FOUND_EVIDENCE:4, PLAYER_TALK:5, ACCUSED:5, SAW_TAMPERING:6 }
new CognitiveEngine({ sessionId, getWorldContext, getRosterIds, getSummaries, getNearby, onThinking, onResult })
  request(npc, trigger, { playerText, playerPos, detail, priority, cooldownMs, force }) -> boolean
  setSessionId(id) / setPaused(bool) / getStats() / cancelAll() / destroy()
```

### game/systems/BehaviorTree.js
```js
NODE = { SUCCESS, FAILURE, RUNNING }
FSM  = { IDLE, PATROL, INVESTIGATE, ALERT, CHASE, CONVERSE, FLEE, WORK }
BehaviorNode, Selector, Sequence, Condition, Action, Inverter, Cooldown
buildNpcTree() -> Selector      // ctx = { npc, time, delta, world }
ruleBasedResponse({ npc, trigger, suspicion, world, rng }) -> NPC response payload
TRIGGERS = ['PLAYER_APPROACH','PLAYER_TALK','SAW_TAMPERING','LIGHTS_OUT','FOUND_EVIDENCE','ACCUSED','IDLE']
```

### game/systems/Pathfinding.js · VisionCone.js · Sfx.js
```js
new GridPathfinder(grid)
  isWalkable(x,y) / setBlocked(x,y,bool) / nearestWalkable(x,y,radius) / randomWalkable(rect,rng)
  findPathTiles(sx,sy,tx,ty,{maxNodes=2500}) -> [{x,y}]      // tiles, excludes start
  findPath(sx,sy,tx,ty,opts) -> [{x,y}]                       // world px, tile centres
buildSightGrid(mapData) -> boolean[][]
hasLineOfSight(sightGrid, x0,y0,x1,y1) -> boolean
new VisionCone(scene, owner, { sightGrid, range, fov, rays, depth })
  setFacing(rad) / setAlertColor(level) / setLighting(bool) / setEnabled(bool)
  canSee(x,y,{rangeScale}) -> { seen, dist, angleDelta } / redraw(time) / destroy()
sfx.{ unlock, setMuted, isMuted, setVolume, blip, interact, pickup, deny, powerDown,
      powerUp, alarm, suspicionUp, sabotage, win, lose }
```

### game/entities
```js
new Player(scene, x, y, { onInteract, onPlant, onHack, onTalk, onNoise })
  tileX / tileY / visibilityScale / sneaking / setDisabled(bool) / update(time, delta)
new NPC(scene, def, spawn, { pathfinder, sightGrid, patrol, voiceIndex, secretRole })
  perceive(player,{lightsOn}) -> boolean   // rising edge of sight
  update(time, delta, world) / applyCognition(payload,{playerPos}) -> { deltas }
  accrueSuspicion(id, amount) / setSuspicion(id, value) / suspicionOf(id) / suspicionOfPlayer()
  speak(text, emotion) / setThinking(bool) / hear(point, radius) / setPointOfInterest(point, ttl)
  startConversation(target) / endConversation() / serialize() / hydrate(state)
new SpeechBubble(scene, { maxWidth, depth, voice })
  say(line,{emotion,holdMs,cps}) / think() / finish() / hide() / update(time,delta,x,y)
NPC_ROSTER, ROSTER_IDS, ARCHETYPES, SECRET_ROLES, assignSecretRoles(rng), getNpcDef(id)
```

### assets/tilemaps/labMap.js + tiles.js + difficulty.js
```js
// tiles.js
TILE_SIZE=48, MAP_W=56, MAP_H=33, T, COLLIDING, SIGHT_BLOCKING,
isColliding, isSightBlocking, ITEMS, itemLabel, toTile, toWorld

// labMap.js - registry over levels/level{1,2,3}.js
LEVELS, LEVEL_ORDER, LEVEL_LIST
setActiveLevel(id) / getActiveLevel() / getLevel(id)
getRooms|getCorridors|getDoors|getProps|getSpawn|getPatrols|getCast(level?)
buildMapData(level?) -> number[][]
validateMap(level?, grid?) -> { ok, unreachable[], reachedTiles }
validateAllLevels() -> [{ id, ok, unreachable, reachedTiles }]
roomAt|roomIdAt|roomNameAt(tx,ty,level?) / roomCenter(id, level?)

// difficulty.js
DIFFICULTIES { RECRUIT, OPERATIVE, GHOST }, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY
getDifficulty(id) -> { visionRangeMul, watchGainMul, suspicionBiasMul, decayMul,
                       npcSpeedMul, chaseThresholdDelta, catchGraceMs, lockdownCount,
                       hackCooldownMul, noiseMul }
```

### Level roster
| # | Level | Shape | Cast | Character |
|---|-------|-------|------|-----------|
| 1 | Halden Institute | 2x3 rooms round a corridor ring | 5 | Short sightlines, two exits everywhere |
| 2 | Cryo Annex | Spine + one crossing | 4 | Chokepoints, dense cover, observation glass |
| 3 | Ardent Tower | 3 long halls + perimeter walkway | 5 | Long sightlines, sparse cover, blackouts matter |

---

## 5. Game Design (as built)

- **Role:** the player *is* the infiltrator. Five NPCs run the deduction against you.
- **Win:** sabotage all three systems (Generator Core, Server Rack, Camera Hub), then
  channel the Blast Door Terminal in the Control Room.
- **Lose:** an NPC at >=85 suspicion reaching within 44px while it can see you.
- **Lockdown:** three NPCs at >=78 suspicion → alert 3, chase thresholds drop to 45.
- **Suspicion sources:** being seen (+3, +7 in the dark), being watched (per-NPC
  gain/sec), witnessed sabotage (+30), footstep noise, accusations, gossip diffusion.
- **Framing:** plant a chip/splicer (F) in a room; the NPC most associated with that
  room becomes the frame target. A finder gains +28 (× spread) suspicion of them and
  loses 10 of you.
- **Gossip:** every 3.8s, NPC pairs within 130px with line of sight pull each other
  toward the stronger opinion (22% of the gap × the listener's spread multiplier).
- **Secret roles** re-rolled per session: WITNESS and PARANOID always dealt, then
  TURNCOAT / CAREERIST / STEADY. They scale suspicion gain and gossip spread.
- **Blackouts:** H at a breaker panel = facility-wide (16s); anywhere else = local room
  (9s). Cooldown 24s. Darkness cuts NPC vision range to 42% and boosts hearing.

---

## 6. Verification Performed

`npm run smoke` - 29/29 passing: map connectivity, A* contiguity / no corner cutting /
node budget / world-space conversion, prompt token budget and trimming order, schema
validation + coercion + clamping + word caps, every rule-based fallback against the real
validator, `extractJson` edge cases, OpenAI and Anthropic request shapes, custom headers,
malformed-JSON retry, schema-violation repair retry, deadline abort, no-retry-on-auth,
unconfigured fast-fail, preset coherence.

`npm run build` - clean (Phaser, Firebase and app chunked separately).

In-browser (driven through the dev handle, dev server on :5173):
- Boot → 5 NPCs patrolling on A* paths, `[BootScene] map ok - 1452 reachable tiles`.
- Perception → guard entered ALERT locally, suspicion climbed, cognition fell back to
  rules in 18ms when no Ollama server answered, and spoke an in-character line.
- Stubbed provider → fenced JSON parsed, validated and applied: line spoken, emotion
  SUSPICIOUS, intent FOLLOW, suspicion 0 → 17. Request went to `/ollama/v1/chat/completions`
  with `response_format: json_object`; context payload was 3 lines.
- Sabotage → channel completed, POWER done, blackout, alert 1, world summaries compressed.
- Framing → chip planted in the Generator Bay implicated the tech; the Chief's suspicion
  of him rose 12 → 27.
- Gossip → a peer's suspicion of the tech moved 13 → 23 after a conversation.
- Lockdown → 3 convinced NPCs → alert 3, all chase thresholds 45.
- Win → blast door channel → "Extraction complete" modal with run summary.
- Loss → Chief at 95 suspicion within range → "They got you", detained in the Security Hub.
- Restart → fresh session id, objectives reset, modal cleared.
- Persistence → session, 5 NPC rows, memories and events written to IndexedDB;
  snapshot export scrubs the API key.

Re-verified after the 48px rescale and render change: walls block on both axes (east
wall at x=2640 stopped the body at 2627; corridor ceiling stopped it at y=1398), the
2-tile Atrium door is passable (walked tile 27,30 -> 27,22), all 5 NPCs patrol on
walkable tiles with 8-29 node paths, the guard still detects at the scaled cone range
(354px), 40 light pools built, and Exit returns to the title with Resume offered.

Playtested three runs end to end by driving the real input path (key state + stepped
frames), not by teleporting: picked up items, sabotaged all three systems across
separate runs, was caught mid-job twice, planted evidence, aborted a channel at 36%,
and escaped a grab. Two of those runs were losses, which is where AD-14 came from.
A door-frame snag turned out to be my test harness steering diagonally rather than a
collision bug (aligning first cleared it in 7 frames) - but corner correction was added
anyway so a player walking straight into a frame slides into the opening.

Minimap verified by sampling canvas pixels: terrain rasterises (147 distinct colours),
the player blip sits at the projected position, follows a teleport and vacates the old
spot, an alerted NPC renders red, and the panel's bounding box overlaps none of the
other HUD panels.

Levels and difficulty verified in-browser: Ardent Tower on Ghost (5 NPCs patrolling on
walkable tiles, guard cone 354 -> 418 from the x1.18 multiplier, chase thresholds down
15, grace 550ms, lockdown at 2) and Cryo Annex on Recruit (4-person cast as designed,
cone 354 -> 290, grace 1200ms, lockdown at 4). All three layouts flood-fill clean.

**Not verified:** the Gemini preset against the live API (no key used - see below),
Firebase cloud backup/restore (needs real credentials), and rendered
pixel output (the test browser pane could not composite; the game was driven by stepping
the loop manually). Both paths are code-complete.

---

### A note on API keys

Provider keys are entered by the user at runtime, in the app. They are never committed,
never placed in `.env`, and never typed in on the user's behalf - a key supplied in chat
should be pasted into the AI panel by the person who owns it, and rotated afterwards if
it has been shared in plaintext.

---

## 7. Multiplayer - Rival Infiltrators (foundation built, premise NOT yet wired)

**Design.** Co-op and asymmetric were both rejected: they put humans at the centre and
demote the AI staff to scenery, which throws away the only thing this game has that
nothing else does. Instead the NPCs are the jury. Two to four players infiltrate the
same floor, the staff track suspicion against each player independently, and you win by
leaving with the blame pointing at a rival. No meetings, no voting, no lying in a chat
box - you compete at manipulating a social simulation.

**Topology.** Host-authoritative for the world, self-reported for bodies:
  * The host runs the existing single-player simulation completely unchanged - NPCs,
    suspicion, cognition - and broadcasts snapshots at 15Hz. Single-player therefore
    stays the reference implementation; multiplayer is a shell around it.
  * Guests never tick NPC AI (two machines deciding what a guard thinks desynchronise
    within seconds). They interpolate NPCs toward the host's report.
  * Each client simulates and reports its *own* body. This removes input latency and a
    whole class of reconciliation bugs, at the cost of trusting peers about their own
    position. For friends on a shared code that is the right side of the trade; it is
    not acceptable for ranked or public play.

**Transport.** Two implementations behind one interface:
  * `LoopbackTransport` (BroadcastChannel) - same machine, cross-tab, no server, no
    account, no deploy. This is what makes the whole stack testable, and it is how the
    sync below was verified.
  * `SocketTransport` -> Cloudflare Durable Object relay. The DO is deliberately dumb:
    it accepts sockets and fans bytes out, never parsing game state. Authority stays in
    the host browser, so an idle room burns no CPU and the Hibernation API lets the
    object leave memory while keeping sockets open.

### Built and verified (cross-tab, two live tabs)
- Room create/join by 5-character code, display names, roster with per-player colours,
  host election (joining an empty code makes you the host and says so), heartbeat
  pruning, and BYE on disconnect.
- Host -> guest: NPC positions and alert levels (all 5 driven by the host), world state
  (lights, alert, lockdown). Guest saw the host at x=1647 against a reported 1653 -
  interpolation lag, correct.
- Guest -> host: guest moved to x=1175, host rendered the rival at x=1185.
- Host presses Start and every client launches into the same level and difficulty.

### NOT built - the mode does not yet play as designed
- **Per-player suspicion.** NPCs still track a single `PLAYER` key, so the staff
  currently react only to the host and a guest is effectively a ghost to them. This is
  the core of the premise and the next piece of work: widen the suspicion map to
  per-client ids, and extend gossip, framing, catching and lockdown to name a player.
- **The verdict screen** - per-player scoring at end of run (who escaped, who the floor
  blamed).
- **The Durable Object path has never been executed.** Only the loopback transport has
  run. The Worker and DO code are written and configured but unverified until deploy.

---

## 7b. Multiplayer - original design notes (superseded)

Not started, deliberately. It is an architecture change rather than a feature: the game
today runs one authoritative simulation in one browser, and nothing in the loop is
written to reconcile a remote authority.

Recommended shape - **host-authoritative over Firebase Realtime Database**:
  * One player hosts. Their browser keeps running the existing simulation unchanged
    (NPCs, suspicion, cognition), which means single-player stays the reference build.
  * Guests send input intent (direction, action presses) at ~20Hz; the host applies it
    to a second Player body and broadcasts authoritative positions for every actor plus
    the event feed at ~10Hz. Guests interpolate between snapshots.
  * Rooms live at `rooms/{code}` with `{ hostUid, levelId, difficulty, players{} }`.
    Google sign-in already exists in `authService.js`, so identity is solved.
  * Suspicion becomes per-player. The gossip and lockdown logic already keys on entity
    ids, so it extends without redesign; `CATCH` and the objectives need a per-player
    pass, and the cognition prompt needs a second name in the roster.
  * The transport should sit behind an interface with two implementations: a
    BroadcastChannel one (same machine, cross-tab) that is testable with no
    credentials, and the Firebase one for real play.

Blocking question for the user: co-op (all players are infiltrators, NPCs are the
opposition) or asymmetric (one player is the saboteur, others are staff)? Co-op reuses
almost everything above; asymmetric needs a per-player fog of war and a different
win condition, and roughly doubles the work.

Also blocking: a configured Firebase project. Until `.env` has real credentials, none
of the network path can be executed even once, and shipping untested netcode alongside
a working single-player build is a bad trade.

---

## 8. Next Up (suggestions, not commitments)

1. Point the client at a real local model (Ollama `llama3.2`) and tune
   `temperature` / `maxTokens` against actual dialogue quality.
2. NPC-to-NPC *spoken* exchanges - gossip currently moves numbers silently; the
   engine already supports a second speaker.
3. A minimap or camera-feed panel as a reward for the CAMERAS sabotage.
4. Difficulty presets (suspicion gain, vision range, lockdown threshold).
5. Firebase rules + a real credential test for the cloud path.
