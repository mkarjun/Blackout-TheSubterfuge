# Blackout: The Subterfuge

A 2D top-down stealth and social-deduction game set in a locked-down research lab.
You are the infiltrator. Five people work this floor, they talk to each other, they
remember what you told them, and they build their own theories about who is sabotaging
the place. Your job is to make sure the theory they settle on is not you.

Built with **Vite + React + Phaser 3 + Dexie**, with a **dual-layer NPC engine**: the
bodies run locally at 60fps, and an optional LLM writes what comes out of their mouths.

```bash
npm install
npm run dev      # http://localhost:5173
```

The dev server binds every interface, so anyone on the same network can join at
`http://<your-lan-ip>:5173` - Vite prints the Network URL when it starts. On Windows,
accept the firewall prompt for Node the first time.

The game is fully playable with **no AI provider configured** - NPCs fall back to a
local rule-based dialogue system. Connecting a model changes the writing, not the game.

---

## Controls

| Key | Touch | Action |
|-----|-------|--------|
| WASD / Arrows | Left thumb, anywhere on the left half | Move. The stick is analog - a half push is a genuine creep |
| Shift | **Sneak** (latches) | Silent, and 38% harder to spot |
| E | **Use** | Interact / sabotage / pick up - again to abort a job in progress |
| F | **Plant** | Plant the evidence you are carrying |
| H | **Lights** | Hack lights - facility-wide at a breaker panel, otherwise just this room |
| Space | **Talk** | Talk to whoever is closest |
| Tab | eye button | Show or hide the HUD panels |
| Esc | pause button | Close a conversation, then pause |

Nothing above needs to be memorised first. A first run walks you through the five
verbs one at a time, each step clearing itself as soon as you do the thing, and the
HUD panels arrive as the steps earn them.

The side panels **fade out when you walk under them** and stop taking clicks, so the
body is never lost behind a window. Each one also folds to its title bar, and Tab
clears all of them at once.

**Exit** lives under the gear menu (top right), on the pause overlay, and on the
end-of-run screen. It saves and returns to the title screen; the run is then offered
as **Resume run**.

**Win:** sabotage all three systems on the floor, then reach the exit.

**Three floors**, under *Change* on the title screen:
| # | Level | Character |
|---|-------|-----------|
| 1 | Halden Institute | Rooms around a corridor ring. Short sightlines, two ways out of everywhere. |
| 2 | Cryo Annex | One spine, one crossing. Fewer routes, denser cover, everyone funnels through the middle. |
| 3 | Ardent Tower | Three long halls and a perimeter walkway. Almost nowhere to hide - kill the lights. |

**Three difficulties** - Recruit, Operative, Ghost - which change vision range, how fast
being watched condemns you, how quickly suspicion cools, the catch window, and how many
convinced staff trigger a lockdown. Ghost is harder because it *notices* you, not
because it wins footraces: no NPC on any setting outruns the player, and a test enforces
that.
**Lose:** let someone who is already sure it was you keep hands on you for a full
second. You get a warning and they stagger when they grab - move and you are out of it.

---

## On a phone

The game installs. Chrome and Edge offer an **Install** button in the title-screen
nav; on iOS, Safari's Share sheet has *Add to Home Screen* and the button explains
where to find it. Installed, it launches fullscreen and landscape with no browser
chrome, and a service worker keeps the shell, the icons and the music cached, so
after the first visit it opens offline.

Controls are a floating analog stick under the left thumb and an action cluster under
the right. The stick spawns wherever your thumb lands rather than sitting in a fixed
spot, and buttons light up only when they are live - **Use** near a machine, **Talk**
with a name on it when someone is in range, **Plant** when you are carrying. The
radar moves to the top right on touch so it is not underneath the Use button, and the
HUD panels start hidden on narrow screens.

Portrait is refused rather than squeezed: the floor is wider than it is tall and both
thumbs need a corner, so the game asks for the quarter turn and picks the run back up
when you make it.

---

## The dual-layer engine

The design constraint was that a network round trip must never be able to stall a
frame or freeze a body.

**Physical layer** (`src/game/`) - runs every frame, entirely local:
vision cones with DDA line-of-sight, grid A* pathfinding, an eight-state FSM driven by
a behaviour tree, collisions, patrols, noise. This layer is the game.

**Cognitive layer** (`src/game/systems/CognitiveEngine.js`) - runs on a timer, never in
`update()`. When something happens, the NPC *immediately* reacts physically (turns,
watches, investigates, raises the alarm) and a request is queued in the background. When
a payload arrives - 200ms or 4s later, or never - it is folded in as dialogue, an
emotion, and suspicion deltas. `action_intent` is treated as a nudge, not a command, so
a stale answer cannot yank a body that has since been alerted by something closer.

Scheduling: one in-flight request per NPC, two concurrent globally, per-NPC cooldowns,
priority replacement of queued triggers, and a single 4-second wall-clock deadline
spanning all retries. Past the deadline, the request aborts and the NPC uses the local
fallback - which returns the *same schema*, so nothing downstream has two shapes to
handle.

The circular minimap in the bottom-right corner shows the whole floor live: your
position and facing, and the sabotage targets as diamonds that fill in as you complete
them. It dims during a blackout. It does **not** plot the staff - finding out where
they are is the game.

Watch the "Cognitive layer" strip above it: it counts model replies vs local
fallbacks live, and every speech bubble in the event feed is tagged when it came from
rules.

---

## Connecting a model

Click **AI** in the HUD (or **AI provider** on the title screen).

| Provider | Base URL | Key |
|----------|----------|-----|
| Ollama | `http://localhost:11434/v1` | none |
| LM Studio | `http://localhost:1234/v1` | none |
| OpenAI | `https://api.openai.com/v1` | required |
| Anthropic | `https://api.anthropic.com/v1` | required |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | required |

Gemini model names turn over quickly - if **Test** returns a 404 naming a replacement,
a one-click **Use &lt;model&gt;** button appears next to the error. **Fetch** lists everything
your key can actually reach.
| OpenRouter | `https://openrouter.ai/api/v1` | required |
| Custom | anything OpenAI-compatible | optional |

Anthropic uses `/v1/messages` with `x-api-key`; everything else uses
`/chat/completions` with a bearer token - including Gemini, via Google's
OpenAI-compatible endpoint (get a key from Google AI Studio). If any gateway rejects
`response_format`, untick **Request JSON mode**; the parser recovers fenced and
prose-wrapped JSON anyway. Custom headers are supported for gateways.
**Keys are runtime-only** - they live in IndexedDB, never in the bundle or `.env`, and
they are stripped from every exported or uploaded snapshot. Uncheck "remember this key"
on a shared machine.

In dev, `localhost:11434` and `localhost:1234` are routed through a Vite proxy, so
Ollama and LM Studio need no CORS setup. Press **Test** to prove the endpoint, key and
model name all work before you rely on them.

Every request is budgeted: a fixed ~150-token system contract plus a context assembled
from the last 3 interactions with that NPC and up to 4 compressed one-sentence world
facts, trimmed cheapest-section-first until it fits. Replies are constrained to:

```json
{
  "dialogue": "max 20 words",
  "internal_thought": "max 15 words",
  "emotion_state": "NEUTRAL|SUSPICIOUS|ALARMED|COOPERATIVE|HOSTILE",
  "action_intent": "INVESTIGATE|FLEE|ACCUSE|FOLLOW|IGNORE",
  "target_entity": "NPC_ID or PLAYER",
  "suspicion_delta": { "PLAYER": 10, "NPC_GUARD_1": -5 }
}
```

Malformed JSON gets one repair retry; schema violations get a retry naming the exact
field. Word caps and delta clamps are enforced locally regardless, so a chatty model
cannot break the bubble layout or the balance.

---

## How the deduction actually works

- **Suspicion** is per-NPC and per-target - each of the five tracks an opinion of you
  *and* of each other, and those opinions start non-zero.
- **Gossip** diffuses it: NPCs within earshot and line of sight pull each other toward
  the stronger opinion every few seconds. One planted chip can snowball.
- **Secret roles** are re-rolled each session (Witness, Paranoid, Turncoat, Careerist,
  Steady) and scale how fast an NPC gains suspicion and how hard they spread it.
- **Framing:** evidence planted in a room implicates whoever is associated with that
  room. The finder's suspicion of them jumps - and their suspicion of you drops.
- **Consensus ends the run:** three convinced staff and Chief Rook calls a lockdown.

---

## Rival Infiltrators (multiplayer, in progress)

Two spies, one lab, and five witnesses who will only convict one of you. You both break
into the same floor; the staff track suspicion against each of you separately; you win
by walking out with the blame pointing at the other one. No meetings, no voting, no
lying in a chat box - you compete at manipulating the simulation.

**Working now:** room codes and display names, cross-tab and cross-machine rooms,
synced NPCs and world state, rivals visible and moving in your game.

**Not working yet:** the staff still track suspicion against one player, so the verdict
half of the premise is not live. That is the next piece of work.

Same machine? Open two tabs and join your own code - the loopback transport needs no
server at all.

---

## Saves

Everything persists to IndexedDB automatically - session state, the full NPC suspicion
matrix, per-NPC conversation memory and the event log. Refresh mid-run and "Resume last
run" picks it back up.

**Saves** in the HUD offers a downloadable snapshot file, import (merge or replace), and
optional Google sign-in for cloud backup. Firebase is entirely opt-in: copy
`.env.example` to `.env` and fill in the `VITE_FIREBASE_*` values. Without it, the
cloud section explains itself and the local half works normally.

---

## Development

```bash
npm run dev      # dev server with the local-provider proxy
npm run build    # production build
npm run smoke    # 29 headless tests, no browser or network required
```

`npm run smoke` covers map connectivity, A* correctness, the token budget, schema
validation, every rule-based fallback, and each provider transport including the
timeout and retry paths.

In dev, `window.__BLACKOUT__` exposes `{ game, scene(), step(frames) }` for poking at a
live run from the console, and `localStorage.blackoutDebug = '1'` turns on Arcade
Physics debug rendering.

See [PROGRESS.md](PROGRESS.md) for the architecture ledger, export signatures and
verification notes.

---

## Credits

The score is *Stealth Mission Music Loop* by **Enchanted Hive**. It ships as a single
133.3-second loop, cut on a period measured by autocorrelation so it repeats with no
seam, levelled to about -20 LUFS and encoded at 96 kbps (1.5 MB).

> **Licensing note:** confirm the track's licence terms and the attribution the
> artist requires before publishing this build. It is included here because it was
> supplied for the project, not because its licence has been verified.
