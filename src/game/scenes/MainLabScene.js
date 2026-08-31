/**
 * MainLabScene.js - The game.
 *
 * Layer discipline, top to bottom:
 *   - update() is the Physical Layer. Movement, perception, collisions, FSM ticks.
 *     Everything in it is synchronous and local. It must never await.
 *   - CognitiveEngine is the Cognitive Layer. The scene *triggers* it and forgets;
 *     results arrive later through applyCognitionResult(). Every trigger site sets a
 *     local physical reaction first (alert stance, point of interest, alarm), so the
 *     game reads correctly even if no payload ever comes back.
 *   - Dexie writes go through saveSessionThrottled(), never inline in a frame.
 *
 * The social simulation (gossip, framing, lockdown) is intentionally local rules too.
 * The LLM colours it - it does not run it.
 */

import Phaser from 'phaser';
import {
  TILE_SIZE, MAP_W, MAP_H, T,
  setActiveLevel, getActiveLevel, getRooms, getCorridors, getProps, getSpawn, getPatrols, getCast,
  buildMapData, roomNameAt, roomIdAt, roomCenter, itemLabel,
} from '../../assets/tilemaps/labMap.js';
import { getDifficulty, DEFAULT_DIFFICULTY } from '../difficulty.js';
import { NPC_ROSTER, assignSecretRoles } from '../entities/roster.js';
import Player from '../entities/Player.js';
import NPC from '../entities/NPC.js';
import GridPathfinder from '../systems/Pathfinding.js';
import { buildSightGrid, hasLineOfSight } from '../systems/VisionCone.js';
import CognitiveEngine, { PRIORITY } from '../systems/CognitiveEngine.js';
import { FSM } from '../systems/BehaviorTree.js';
import RemotePlayer from '../entities/RemotePlayer.js';
import { MSG, buildSnapshot } from '../../net/protocol.js';
import eventManager, { EVENTS } from '../systems/EventManager.js';
import sfx from '../systems/Sfx.js';
import { compressEvent, pushSummary } from '../../services/promptBuilder.js';
import {
  blankSession, saveSessionThrottled, flushPendingSave, appendEvent, loadLatestSession,
} from '../../services/memoryStore.js';

const INTERACT_RANGE = 69;
const TALK_RANGE = 156;
const APPROACH_RANGE = 225;
const CATCH_RANGE = 66;
const CATCH_SUSPICION = 85;
/**
 * How long a convinced NPC must stay on top of you before you are detained.
 * Playtesting: without this you lose on the single frame you become catchable, which
 * reads as an instant-death trap rather than a chase you lost. The window is short
 * enough to stay tense and long enough to sprint out of.
 */
const CATCH_GRACE_MS = 800;
const BLACKOUT_MS = 16000;
const ROOM_BLACKOUT_MS = 9000;
const HACK_COOLDOWN_MS = 24000;

export class MainLabScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainLabScene' });
  }

  init(data) {
    this.resumeData = data?.resume || null;
    this.sessionState = null;
    // A resumed session carries its own level and difficulty; a fresh run takes them
    // from the menu selection stashed in the registry.
    this.levelId = this.resumeData?.levelId || data?.levelId || this.registry.get('levelId');
    this.difficultyId = this.resumeData?.difficulty || data?.difficulty
      || this.registry.get('difficulty') || DEFAULT_DIFFICULTY;
    this.level = setActiveLevel(this.levelId);
    this.levelId = this.level.id;
    this.difficulty = getDifficulty(this.difficultyId);

    /**
     * Multiplayer role. 'solo' is the default and the reference implementation - the
     * networked roles are a shell around the same simulation, never a second one.
     *   host  - authoritative for NPCs, world state and suspicion; broadcasts snapshots.
     *   guest - simulates only its own body, renders NPCs from snapshots.
     *
     * Player positions are self-reported by each client rather than host-simulated.
     * That is a deliberate trade: it removes input latency and a whole class of
     * reconciliation bugs, at the cost of trusting peers about where they are. For a
     * game played with a friend on a shared code that is the right side of the trade.
     */
    this.net = data?.net || null;
    this.netRole = this.net ? (this.net.isHost ? 'host' : 'guest') : 'solo';
  }

  /* =================================================================== create */

  create() {
    this.gameOverState = null;
    this.channel = null;            // in-progress timed action
    this.isPaused = false;
    this.activeDialogue = null;
    this.hackReadyAt = 0;
    this.darkRooms = new Set();
    this.plantedEvidence = [];
    this.lastTickAt = 0;

    this.state = {
      lightsOn: true,
      alertLevel: 0,
      lockdown: false,
      sabotage: { POWER: false, DATA: false, CAMERAS: false },
      objectivesDone: 0,
      escaped: false,
      worldSummaries: [],
      elapsedMs: 0,
    };
    this.inventory = [];

    this.remotePlayers = new Map();
    this._netTick = 0;

    this._buildWorld();
    this._buildProps();
    this._buildActors();
    this._buildCamera();
    this._buildCognition();
    this._wireUiRequests();
    this._buildTimers();

    this.session = blankSession();
    if (this.resumeData) this._applySavedState(this.resumeData);
    this.cognition.setSessionId(this.session.id);

    if (this.net) this._wireNet();

    this.logEvent({
      type: 'INFO',
      detail: `${this.level.name} sealed for the night cycle. ${this.level.brief}`,
      tone: 'info',
    });
    // Clear any stale end-of-run payload so a restart does not replay the modal.
    eventManager.emit(EVENTS.GAME_OVER, null);
    eventManager.emit(EVENTS.GAME_READY, {
      sessionId: this.session.id,
      roster: this.npcs.map((n) => ({ id: n.id, name: n.npcName, role: n.role, color: n.tintTopLeft })),
    });
    this._emitTick(true);
  }

  _buildWorld() {
    this.mapData = buildMapData();
    this.sightGrid = buildSightGrid(this.mapData);
    this.pathfinder = new GridPathfinder(this.mapData);

    const map = this.make.tilemap({ data: this.mapData, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = map.addTilesetImage('lab', 'tiles', TILE_SIZE, TILE_SIZE, 0, 0);
    this.groundLayer = map.createLayer(0, tileset, 0, 0);
    this.groundLayer.setCollision([T.WALL, T.GLASS, T.CRATE]);
    this.groundLayer.setDepth(0);
    this.map = map;

    this.physics.world.setBounds(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE);

    // Room name plates - cheap orientation without a minimap.
    getRooms().forEach((room) => {
      const c = roomCenter(room.id);
      this.add.text(c.x * TILE_SIZE, (room.rect.y + 0.5) * TILE_SIZE, room.name.toUpperCase(), {
        fontFamily: 'Consolas, monospace',
        fontSize: '15px',
        color: '#3d4d68',
      }).setOrigin(0.5, 0).setDepth(1).setLetterSpacing?.(2);
    });

    this._buildLighting();

    // Darkness overlay sits above the floor and the light pools but below actors, so a
    // blackout hides the room without hiding the characters you are trying to read.
    this.darkness = this.add.graphics().setDepth(5);
    this._redrawDarkness();
  }

  _buildProps() {
    this.props = getProps().map((def) => {
      const x = def.x * TILE_SIZE + TILE_SIZE / 2;
      const y = def.y * TILE_SIZE + TILE_SIZE / 2;
      const glow = this.add.image(x, y, 'lightpool')
        .setDepth(3)
        .setScale(0.55)
        .setTint(def.color || 0x38f2c4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.5);
      const sprite = this.add.image(x, y, 'prop').setDepth(6).setTint(def.color || 0x38f2c4);
      this.tweens.add({
        targets: sprite,
        alpha: { from: 0.55, to: 1 },
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      const label = this.add.text(x, y - 26, def.label, {
        fontFamily: 'Consolas, monospace',
        fontSize: '11px',
        color: '#5a6c85',
      }).setOrigin(0.5, 1).setDepth(6);
      return { def, sprite, glow, label, used: false, x, y };
    });
  }

  _buildActors() {
    const spawn = getSpawn();
    this.player = new Player(this, spawn.player.x * TILE_SIZE + TILE_SIZE / 2, spawn.player.y * TILE_SIZE + TILE_SIZE / 2, {
      onInteract: () => this.handleInteract(),
      onPlant: () => this.handlePlant(),
      onHack: () => this.handleHack(),
      onTalk: () => this.handleTalk(),
      onNoise: (n) => this.handleNoise(n),
    });

    const cast = getCast();
    const patrols = getPatrols();
    this.secretRoles = assignSecretRoles(Math.random, cast);
    this.npcs = NPC_ROSTER
      .filter((def) => cast.includes(def.id))
      .map((def, index) => new NPC(this, def, spawn.npcs[def.id], {
        pathfinder: this.pathfinder,
        sightGrid: this.sightGrid,
        patrol: patrols[def.id] || [],
        voiceIndex: index,
        secretRole: this.secretRoles[def.id],
        difficulty: this.difficulty,
      }));

    // Suspicion between NPCs starts at a low simmer, not zero: they already have
    // history with each other, which gives the deduction somewhere to move.
    this.npcs.forEach((npc) => {
      cast.filter((id) => id !== npc.id).forEach((id) => {
        npc.setSuspicion(id, Phaser.Math.Between(4, 14));
      });
    });

    this.npcGroup = this.physics.add.group(this.npcs);
    this.physics.add.collider(this.player, this.groundLayer);
    this.physics.add.collider(this.npcGroup, this.groundLayer);
    this.physics.add.collider(this.npcGroup, this.npcGroup);
    this.physics.add.collider(this.player, this.npcGroup);
  }

  _buildCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE);
    cam.startFollow(this.player, true, 0.14, 0.14);
    cam.setBackgroundColor('#05070c');
    this._syncZoom();
    // RESIZE mode means the viewport follows the window; keep the framing sane.
    this.scale.on('resize', this._syncZoom, this);
    this.events.once('shutdown', () => this.scale.off('resize', this._syncZoom, this));
  }

  /**
   * Zoom 1.0 renders the 48px art at its authored size - the crispest it can be. Only
   * short windows zoom out, so a small viewport still shows a usable slice of the map.
   */
  _syncZoom() {
    const cam = this.cameras.main;
    if (!cam) return;
    const zoom = Math.min(1, Math.max(0.62, this.scale.height / 760));
    cam.setZoom(zoom);
  }

  /**
   * Ceiling light pools, drawn additively beneath the darkness overlay. Purely
   * atmospheric - detection uses _isLitAt(), never these sprites - but they are most
   * of what makes the lab read as a lit interior rather than a flat grid.
   */
  _buildLighting() {
    this.lights2d = [];
    const add = (tx, ty, scale, tint, alpha) => {
      const img = this.add.image(tx * TILE_SIZE, ty * TILE_SIZE, 'lightpool')
        .setDepth(3)
        .setScale(scale)
        .setTint(tint)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(alpha);
      this.lights2d.push(img);
      return img;
    };

    const ROOM_LIGHT = {
      CONTROL: 0x9fd8ff, LAB_A: 0x9ff5e2, VAULT: 0xc9b6ff,
      GENERATOR: 0xffd79a, ATRIUM: 0xc3f0c8, SECURITY: 0xffb3bd,
    };

    for (const room of getRooms()) {
      const { x, y, w, h } = room.rect;
      const tint = ROOM_LIGHT[room.id] || 0xbcd2ee;
      // Two lamps per room, offset along the long axis.
      add(x + w * 0.32, y + h * 0.34, 1.5, tint, 0.5);
      add(x + w * 0.7, y + h * 0.7, 1.5, tint, 0.42);
    }

    // Corridor strip lighting - one pool every six tiles along each run.
    for (const corridor of getCorridors()) {
      const { x, y, w, h } = corridor.rect;
      if (w >= h) {
        for (let tx = x + 3; tx < x + w; tx += 6) add(tx, y + h / 2, 0.95, 0xa8c4e8, 0.4);
      } else {
        for (let ty = y + 3; ty < y + h; ty += 6) add(x + w / 2, ty, 0.95, 0xa8c4e8, 0.4);
      }
    }
  }

  _buildCognition() {
    this.cognition = new CognitiveEngine({
      sessionId: this.session?.id,
      getWorldContext: () => ({
        lightsOn: this.state.lightsOn && !this.darkRooms.size,
        alertLevel: this.state.alertLevel,
        room: roomNameAt(this.player.tileX, this.player.tileY),
        time: this._clock(),
      }),
      getRosterIds: () => this.npcs.map((n) => n.id),
      getSummaries: () => this.state.worldSummaries,
      getNearby: (npc) => this.npcs
        .filter((o) => o !== npc && Phaser.Math.Distance.Between(o.x, o.y, npc.x, npc.y) < 330)
        .slice(0, 3)
        .map((o) => `${o.id}(${o.npcName})`),
      onResult: (npc, payload, meta) => this.applyCognitionResult(npc, payload, meta),
    });
  }

  _wireUiRequests() {
    this._unsubs = [
      eventManager.on(EVENTS.REQUEST_SAY, ({ text, accuse }) => this.handlePlayerSay(text, accuse)),
      eventManager.on(EVENTS.REQUEST_CLOSE_DIALOGUE, () => this.closeDialogue()),
      eventManager.on(EVENTS.REQUEST_PAUSE, () => this.setPaused(true)),
      eventManager.on(EVENTS.REQUEST_RESUME, () => this.setPaused(false)),
      eventManager.on(EVENTS.REQUEST_SAVE, () => this.saveNow()),
      eventManager.on(EVENTS.REQUEST_RESTART, () => this.restart()),
    ];

    this.events.once('shutdown', () => {
      this._unsubs.forEach((off) => off());
      this.cognition.destroy();
    });
  }

  _buildTimers() {
    // HUD snapshot: 4/sec is plenty for bars and counters and keeps React quiet.
    this.time.addEvent({ delay: 250, loop: true, callback: () => this._emitTick() });
    // Minimap runs faster than the HUD: a 4Hz player blip reads as broken.
    this.time.addEvent({ delay: 66, loop: true, callback: () => this._emitMinimap() });
    // Social simulation between NPCs.
    this.time.addEvent({ delay: 3800, loop: true, callback: () => this.gossipTick() });
    // Ambient cognition so the world talks when the player is not poking it.
    this.time.addEvent({ delay: 26000, loop: true, callback: () => this.ambientTick() });
    this.time.addEvent({ delay: 6000, loop: true, callback: () => this.saveNow() });
  }

  /* =================================================================== update */

  update(time, delta) {
    if (this.gameOverState || this.isPaused) return;

    this.state.elapsedMs += delta;
    this.player.update(time, delta);

    const worldCtx = { lightsOn: this.state.lightsOn, alertLevel: this.state.alertLevel };

    if (this.netRole === 'guest') {
      // A guest never runs NPC AI: two machines deciding what a guard thinks would
      // desynchronise immediately. It interpolates toward the host's report.
      for (const npc of this.npcs) npc.followNetTarget(time, delta);
    } else {
      for (const npc of this.npcs) {
        const litHere = this._isLitAt(npc.x, npc.y);
        const sawPlayerNow = npc.perceive(this.player, { lightsOn: litHere });
        npc.update(time, delta, worldCtx);

        if (sawPlayerNow) this._onNpcSpotsPlayer(npc);
        this._witnessSabotage(npc);
        this._checkCatch(npc, delta);
      }
    }

    for (const [, sprite] of this.remotePlayers) sprite.update();

    this._updateInteractPrompt();
    this._updateChannel(delta);
    this._checkEvidenceDiscovery();
    this._updateDialogueRange();
  }

  /**
   * Being watched mid-sabotage is checked continuously, not just on the rising edge of
   * sight: an NPC already looking at you when you start the job must still catch you.
   * One reaction per witness per channel.
   */
  _witnessSabotage(npc) {
    if (!this.channel || this.channel.kind !== 'SABOTAGE') return;
    if (!npc.canSeePlayer || this.channel.witnesses.has(npc.id)) return;
    this.channel.witnesses.add(npc.id);

    npc.accrueSuspicion('PLAYER', 30);
    npc.setPointOfInterest({ x: this.player.x, y: this.player.y }, 9000);
    this.raiseAlert(2, `${npc.npcName} caught you at the ${this.channel.label}`);
    this.cognition.request(npc, 'SAW_TAMPERING', {
      playerPos: { x: this.player.x, y: this.player.y },
      detail: this.channel.label,
      priority: PRIORITY.SAW_TAMPERING,
      force: true,
    });
  }

  /** Walking away ends a conversation - no invisible tether across the map. */
  _updateDialogueRange() {
    if (!this.activeDialogue) return;
    const d = Phaser.Math.Distance.Between(
      this.player.x, this.player.y, this.activeDialogue.x, this.activeDialogue.y,
    );
    if (d > TALK_RANGE * 1.8) this.closeDialogue();
  }

  /**
   * Rising edge of an NPC seeing the player. Note the ordering: the *physical*
   * reaction (turn, watch, remember position) has already happened inside the
   * behaviour tree this frame. The cognition request is pure garnish on top.
   */
  _onNpcSpotsPlayer(npc) {
    const distance = Phaser.Math.Distance.Between(npc.x, npc.y, this.player.x, this.player.y);
    if (distance > APPROACH_RANGE) return;

    // Sabotage witnessing is handled by _witnessSabotage, which fires for anyone
    // watching at any point during the channel, not only on first sight.
    if (this.channel && this.channel.kind === 'SABOTAGE') return;

    npc.accrueSuspicion('PLAYER', this.state.lightsOn ? 3 : 7);
    this.cognition.request(npc, 'PLAYER_APPROACH', {
      playerPos: { x: this.player.x, y: this.player.y },
    });
  }

  /**
   * Detention requires CATCH_GRACE_MS of unbroken contact. Breaking line of sight or
   * opening any distance resets it, so the escape is always in the player's hands.
   */
  _checkCatch(npc, delta) {
    if (this.gameOverState) return;

    const inReach = npc.canSeePlayer
      && npc.suspicionOfPlayer() >= CATCH_SUSPICION
      && Phaser.Math.Distance.Between(npc.x, npc.y, this.player.x, this.player.y) <= CATCH_RANGE;

    if (!inReach) {
      npc.catchTimer = 0;
      return;
    }

    if (!npc.catchTimer) {
      sfx.alarm();
      // The grab itself staggers them for a beat. Without this the window is a lie:
      // NPC run speeds sit within ~6px/s of the player's walk, so a straight sprint
      // gains nothing and "break away" would be advice you cannot act on. The stagger
      // buys roughly 80px - enough to clear CATCH_RANGE if you move immediately.
      npc.stunnedUntil = Math.max(npc.stunnedUntil, this.time.now + 420);
      this.logEvent({
        type: 'ALARM',
        actor: npc.npcName,
        detail: `${npc.npcName} has hands on you - break away NOW.`,
        tone: 'alarm',
      });
    }

    npc.catchTimer += delta;
    if (npc.catchTimer >= this.difficulty.catchGraceMs) {
      this.endGame('lost', `${npc.npcName} detained you in the ${roomNameAt(npc.tileX, npc.tileY)}.`);
    }
  }

  /* ============================================================ interactions */

  _nearestProp(range = INTERACT_RANGE) {
    let best = null;
    let bestD = range;
    for (const prop of this.props) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, prop.x, prop.y);
      if (d < bestD) { bestD = d; best = prop; }
    }
    return best;
  }

  _nearestNpc(range = TALK_RANGE) {
    let best = null;
    let bestD = range;
    for (const npc of this.npcs) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.x, npc.y);
      if (d < bestD) { bestD = d; best = npc; }
    }
    return best;
  }

  _updateInteractPrompt() {
    const prop = this._nearestProp();
    const npc = !prop ? this._nearestNpc() : null;
    let payload = null;

    if (this.channel) {
      payload = { key: 'E', label: `${this.channel.label}... (E to abort)`, progress: this.channel.progress };
    } else if (prop) {
      payload = { key: 'E', label: this._propPrompt(prop) };
    } else if (npc) {
      payload = { key: 'SPACE', label: `Talk to ${npc.npcName}` };
    } else if (this.inventory.length) {
      payload = { key: 'F', label: `Plant ${this._itemLabel(this.inventory[0])}` };
    }

    const key = payload ? `${payload.key}:${payload.label}:${Math.round((payload.progress || 0) * 20)}` : 'none';
    if (key !== this._lastPromptKey) {
      this._lastPromptKey = key;
      eventManager.emit(EVENTS.INTERACT_PROMPT, payload);
    }
  }

  _propPrompt(prop) {
    const { def } = prop;
    if (def.action === 'SABOTAGE' && this.state.sabotage[def.sabotage]) return `${def.label} (done)`;
    if (def.action === 'PICKUP' && prop.used) return `${def.label} (empty)`;
    if (def.action === 'ESCAPE' && this.state.objectivesDone < 3) return 'Blast door - 3 systems required';
    return def.prompt;
  }

  handleInteract() {
    sfx.unlock();
    if (this.channel) return;
    const prop = this._nearestProp();
    if (!prop) return;
    const { def } = prop;

    switch (def.action) {
      case 'PICKUP': {
        if (prop.used) return sfx.deny();
        prop.used = true;
        prop.sprite.setAlpha(0.25);
        this.tweens.killTweensOf(prop.sprite);
        this.inventory.push(def.item);
        sfx.pickup();
        eventManager.emit(EVENTS.INVENTORY_CHANGED, [...this.inventory]);
        this.logEvent({ type: 'INFO', detail: `Picked up ${this._itemLabel(def.item)}.`, tone: 'success' });
        break;
      }
      case 'SABOTAGE': {
        if (this.state.sabotage[def.sabotage]) return sfx.deny();
        this._startChannel({
          kind: 'SABOTAGE',
          label: def.prompt,
          duration: def.duration,
          prop,
          onComplete: () => this._completeSabotage(prop),
        });
        break;
      }
      case 'BREAKER': {
        this.logEvent({ type: 'INFO', detail: 'Breaker panel open. Press H here to black out the facility.', tone: 'info' });
        sfx.interact();
        break;
      }
      case 'ESCAPE': {
        if (this.state.objectivesDone < 3) {
          sfx.deny();
          this.logEvent({ type: 'INFO', detail: 'The blast door needs all three systems down first.', tone: 'warn' });
          return;
        }
        this._startChannel({
          kind: 'ESCAPE',
          label: def.prompt,
          duration: def.duration,
          prop,
          onComplete: () => this.endGame('won', 'You walked out through the blast door before anyone put it together.'),
        });
        break;
      }
      default:
        break;
    }
  }

  _startChannel({ kind, label, duration, prop, onComplete }) {
    this.channel = {
      kind, label, duration, elapsed: 0, progress: 0, prop, onComplete,
      witnesses: new Set(),
    };
    this.player.setDisabled(true);
    sfx.interact();
  }

  _updateChannel(delta) {
    if (!this.channel) return;

    // Abort with E. Playtesting found the old behaviour indefensible: the channel
    // locked you in place for ~3s with no way out, so a guard walking in mid-job was
    // an unavoidable loss rather than a moment you could react to. Progress is lost.
    if (Phaser.Input.Keyboard.JustDown(this.player.keys.interact)) {
      const label = this.channel.label;
      this.channel = null;
      this.player.setDisabled(false);
      sfx.deny();
      this.logEvent({ type: 'INFO', detail: `Aborted: ${label}.`, tone: 'warn' });
      return;
    }

    this.channel.elapsed += delta;
    this.channel.progress = Math.min(1, this.channel.elapsed / this.channel.duration);
    if (this.channel.progress < 1) return;

    const done = this.channel;
    this.channel = null;
    this.player.setDisabled(false);
    done.onComplete?.();
  }

  _completeSabotage(prop) {
    const { def } = prop;
    this.state.sabotage[def.sabotage] = true;
    this.state.objectivesDone = Object.values(this.state.sabotage).filter(Boolean).length;
    prop.sprite.setTint(0x334155);
    this.tweens.killTweensOf(prop.sprite);
    prop.sprite.setAlpha(0.4);
    sfx.sabotage();

    const room = roomNameAt(def.x, def.y);
    this.logEvent({ type: 'TERMINAL_HACKED', room, detail: `${def.label} sabotaged.`, tone: 'alarm' });
    this.raiseAlert(1, `${def.label} went offline`);

    if (def.sabotage === 'POWER') this._setLights(false, BLACKOUT_MS);
    if (def.sabotage === 'CAMERAS') {
      // Cameras down cuts everyone's effective reach - the reward for the risk.
      this.npcs.forEach((npc) => { npc.cone.baseRange *= 0.82; });
    }

    // Everyone who could plausibly notice reacts. The nearest witness gets the
    // strongest reaction, and only NPCs in earshot are asked to think about it.
    this.npcs.forEach((npc) => {
      const d = Phaser.Math.Distance.Between(npc.x, npc.y, prop.x, prop.y);
      if (d < 630) {
        npc.setPointOfInterest({ x: prop.x, y: prop.y }, 12000);
        npc.accrueSuspicion('PLAYER', 4);
        this.cognition.request(npc, 'LIGHTS_OUT', {
          detail: `${def.label} just failed in ${room}.`,
          priority: PRIORITY.LIGHTS_OUT,
        });
      }
    });

    eventManager.emit(EVENTS.OBJECTIVES_CHANGED, this._objectives());
    this.saveNow();
  }

  handlePlant() {
    sfx.unlock();
    if (this.channel || !this.inventory.length) return sfx.deny();

    const item = this.inventory.shift();
    const roomId = roomIdAt(this.player.tileX, this.player.tileY);
    const room = roomNameAt(this.player.tileX, this.player.tileY);

    // Framing logic: the evidence implicates whoever is most associated with this
    // room right now. Planting the chip in the Generator Bay points at the tech.
    const frameTarget = this._npcMostAssociatedWith(roomId);

    const sprite = this.add.image(this.player.x, this.player.y, 'dot')
      .setTint(0xa78bfa).setDepth(6).setScale(1.6);
    this.tweens.add({ targets: sprite, alpha: { from: 1, to: 0.35 }, duration: 900, yoyo: true, repeat: -1 });

    this.plantedEvidence.push({
      item, x: this.player.x, y: this.player.y, roomId, room, frameTarget, sprite, found: false,
    });

    sfx.interact();
    eventManager.emit(EVENTS.INVENTORY_CHANGED, [...this.inventory]);
    this.logEvent({
      type: 'EVIDENCE_PLANTED',
      room,
      detail: `${this._itemLabel(item)} planted in ${room}${frameTarget ? ` to implicate ${frameTarget.npcName}` : ''}.`,
      tone: 'success',
    });
  }

  /**
   * Whoever patrols/works this room most - the natural suspect for planted evidence.
   *
   * Anyone currently hunting the player is excluded: framing the person watching you
   * plant it is nonsense, and in playtesting it produced the worst possible outcome
   * (they walk over, find it themselves, and it counts against you instead).
   */
  _npcMostAssociatedWith(roomId) {
    const plausible = this.npcs.filter((n) => !n.canSeePlayer && n.fsm !== FSM.CHASE);
    if (!plausible.length) return null;

    const inRoom = plausible.filter((n) => roomIdAt(n.tileX, n.tileY) === roomId);
    if (inRoom.length) return inRoom[0];

    const center = roomCenter(roomId);
    if (!center) return null;
    const cx = center.x * TILE_SIZE;
    const cy = center.y * TILE_SIZE;
    let best = null;
    let bestD = Infinity;
    for (const npc of plausible) {
      for (const p of npc.patrolPoints) {
        const d = Phaser.Math.Distance.Between(p.x, p.y, cx, cy);
        if (d < bestD) { bestD = d; best = npc; }
      }
    }
    return best;
  }

  /** An NPC walking past planted evidence finds it and redirects their suspicion. */
  _checkEvidenceDiscovery() {
    for (const ev of this.plantedEvidence) {
      if (ev.found) continue;
      for (const npc of this.npcs) {
        const d = Phaser.Math.Distance.Between(npc.x, npc.y, ev.x, ev.y);
        if (d > 114) continue;
        if (!hasLineOfSight(this.sightGrid, npc.x, npc.y, ev.x, ev.y)) continue;

        ev.found = true;
        ev.sprite.setTint(0xff4d5e);

        const target = ev.frameTarget && ev.frameTarget !== npc ? ev.frameTarget : null;
        if (target) {
          const spread = npc.secretRole?.spreadMultiplier ?? 1;
          npc.accrueSuspicion(target.id, 28 * spread);
          npc.accrueSuspicion('PLAYER', -10);   // misdirection actually pays
        } else {
          npc.accrueSuspicion('PLAYER', 6);
        }

        this.logEvent({
          type: 'FOUND_EVIDENCE',
          room: ev.room,
          actor: npc.npcName,
          detail: `${npc.npcName} found ${this._itemLabel(ev.item)} in ${ev.room}${target ? `, and it points at ${target.npcName}` : ''}.`,
          tone: 'warn',
        });

        this.cognition.request(npc, 'FOUND_EVIDENCE', {
          detail: `${this._itemLabel(ev.item)}${target ? ` that belongs near ${target.npcName}` : ''}`,
          priority: PRIORITY.FOUND_EVIDENCE,
          force: true,
        });
        break;
      }
    }
  }

  handleHack() {
    sfx.unlock();
    const now = this.time.now;
    if (now < this.hackReadyAt) {
      this.logEvent({ type: 'INFO', detail: 'Bypass tool still cycling.', tone: 'warn' });
      return sfx.deny();
    }

    const nearBreaker = this.props.find((p) => p.def.action === 'BREAKER'
      && Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y) < 96);

    this.hackReadyAt = now + HACK_COOLDOWN_MS * this.difficulty.hackCooldownMul;

    if (nearBreaker) {
      this._setLights(false, BLACKOUT_MS);
      this.raiseAlert(1, 'Facility-wide blackout');
      this.logEvent({ type: 'LIGHTS_HACKED', room: 'the facility', detail: 'You pulled the main breaker. Every light on sublevel 3 is out.', tone: 'alarm' });
      this.npcs.forEach((npc) => {
        npc.accrueSuspicion('PLAYER', 3);
        this.cognition.request(npc, 'LIGHTS_OUT', { priority: PRIORITY.LIGHTS_OUT });
      });
    } else {
      const roomId = roomIdAt(this.player.tileX, this.player.tileY);
      if (roomId === 'CORRIDOR') {
        this.logEvent({ type: 'INFO', detail: 'No local circuit to splice out here. Find a room or a breaker panel.', tone: 'warn' });
        this.hackReadyAt = now + 2000;
        return sfx.deny();
      }
      this._darkenRoom(roomId, ROOM_BLACKOUT_MS);
      this.logEvent({ type: 'LIGHTS_HACKED', room: roomNameAt(this.player.tileX, this.player.tileY), detail: `You spliced the lighting circuit in ${roomNameAt(this.player.tileX, this.player.tileY)}.`, tone: 'warn' });
      this.npcs
        .filter((npc) => roomIdAt(npc.tileX, npc.tileY) === roomId)
        .forEach((npc) => this.cognition.request(npc, 'LIGHTS_OUT', { priority: PRIORITY.LIGHTS_OUT }));
    }
    sfx.powerDown();
  }

  handleTalk() {
    sfx.unlock();
    const npc = this._nearestNpc();
    if (!npc) return;
    if (this.activeDialogue) return;

    this.activeDialogue = npc;
    npc.startConversation(this.player);
    eventManager.emit(EVENTS.DIALOGUE_OPEN, {
      npcId: npc.id,
      name: npc.npcName,
      role: npc.role,
      emotion: npc.emotion,
      suspicion: Math.round(npc.suspicionOfPlayer()),
      others: this.npcs.filter((o) => o !== npc).map((o) => ({ id: o.id, name: o.npcName })),
    });
  }

  handlePlayerSay(text, accuseId = null) {
    const npc = this.activeDialogue;
    if (!npc || !text) return;

    if (accuseId) {
      const accused = this.npcs.find((n) => n.id === accuseId);
      if (accused) {
        const spread = npc.secretRole?.spreadMultiplier ?? 1;
        npc.accrueSuspicion(accused.id, 14 * spread);
        // Accusing without evidence is itself suspicious behaviour.
        npc.accrueSuspicion('PLAYER', 6);
        this.logEvent({
          type: 'ACCUSATION', actor: 'You', detail: `You told ${npc.npcName} that ${accused.npcName} is the saboteur.`, tone: 'warn',
        });
        // The accused hears about it and reacts on their own schedule.
        this.cognition.request(accused, 'ACCUSED', {
          detail: `The intruder told ${npc.npcName} you did it`,
          priority: PRIORITY.ACCUSED,
          force: true,
        });
      }
    }

    this.cognition.request(npc, 'PLAYER_TALK', {
      playerText: text,
      playerPos: { x: this.player.x, y: this.player.y },
      priority: PRIORITY.PLAYER_TALK,
      force: true,
    });
  }

  closeDialogue() {
    if (this.activeDialogue) {
      this.activeDialogue.endConversation();
      this.activeDialogue = null;
    }
    eventManager.emit(EVENTS.DIALOGUE_CLOSE, null);
  }

  handleNoise({ x, y, radius, source }) {
    for (const npc of this.npcs) {
      if (npc.canSeePlayer) continue;
      // Louder in the dark: NPCs are listening harder when they cannot see.
      const reach = (this.state.lightsOn ? radius : radius * 1.35) * this.difficulty.noiseMul;
      if (npc.hear({ x, y }, reach) && source === 'FOOTSTEP') {
        npc.accrueSuspicion('PLAYER', 0.4);
      }
    }
  }

  /* ============================================================== world state */

  _setLights(on, durationMs = 0) {
    this.state.lightsOn = on;
    this._redrawDarkness();
    eventManager.emit(EVENTS.LIGHTS_CHANGED, on);
    if (!on) {
      sfx.powerDown();
      this.pushWorldSummary({ type: 'LIGHTS_HACKED', room: 'sublevel 3' });
      if (durationMs) {
        this.time.delayedCall(durationMs, () => {
          if (this.gameOverState) return;
          this.state.lightsOn = true;
          this._redrawDarkness();
          sfx.powerUp();
          eventManager.emit(EVENTS.LIGHTS_CHANGED, true);
          this.logEvent({ type: 'INFO', detail: 'Backup power restored the lights.', tone: 'info' });
        });
      }
    }
  }

  _darkenRoom(roomId, durationMs) {
    this.darkRooms.add(roomId);
    this._redrawDarkness();
    this.time.delayedCall(durationMs, () => {
      this.darkRooms.delete(roomId);
      this._redrawDarkness();
    });
  }

  _redrawDarkness() {
    const g = this.darkness;
    g.clear();
    if (!this.state.lightsOn) {
      g.fillStyle(0x000010, 0.8);
      g.fillRect(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE);
      return;
    }
    g.fillStyle(0x000010, 0.72);
    for (const id of this.darkRooms) {
      const room = getRooms().find((r) => r.id === id);
      if (!room) continue;
      g.fillRect(room.rect.x * TILE_SIZE, room.rect.y * TILE_SIZE, room.rect.w * TILE_SIZE, room.rect.h * TILE_SIZE);
    }
  }

  _isLitAt(x, y) {
    if (!this.state.lightsOn) return false;
    return !this.darkRooms.has(roomIdAt(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)));
  }

  raiseAlert(level, reason) {
    if (level <= this.state.alertLevel) return;
    this.state.alertLevel = level;
    eventManager.emit(EVENTS.ALERT_CHANGED, { level, reason });
    if (level >= 2) sfx.alarm();
    this.logEvent({ type: 'ALARM', detail: `Alert level ${level}: ${reason}.`, tone: level >= 2 ? 'alarm' : 'warn' });
  }

  /* ========================================================= social simulation */

  /**
   * NPCs standing together compare notes. Suspicion diffuses toward whoever the pair
   * already distrusts most, scaled by the listener's secret role. This is what makes
   * a single planted chip snowball into a facility-wide consensus.
   */
  gossipTick() {
    if (this.gameOverState || this.isPaused) return;

    for (let i = 0; i < this.npcs.length; i++) {
      for (let j = i + 1; j < this.npcs.length; j++) {
        const a = this.npcs[i];
        const b = this.npcs[j];
        if (Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) > 195) continue;
        if (!hasLineOfSight(this.sightGrid, a.x, a.y, b.x, b.y)) continue;

        for (const subject of ['PLAYER', ...this.npcs.map((n) => n.id)]) {
          if (subject === a.id || subject === b.id) continue;
          const av = a.suspicionOf(subject);
          const bv = b.suspicionOf(subject);
          const gap = av - bv;
          if (Math.abs(gap) < 6) continue;
          // The more convinced party pulls the other, not a simple average.
          if (gap > 0) b.accrueSuspicion(subject, gap * 0.22 * (b.secretRole?.spreadMultiplier ?? 1));
          else a.accrueSuspicion(subject, -gap * 0.22 * (a.secretRole?.spreadMultiplier ?? 1));
        }
      }
    }

    this._checkLockdown();
    eventManager.emit(EVENTS.SUSPICION_CHANGED, this._suspicionSnapshot());
  }

  /** Consensus check: enough of the staff agreeing about you ends the shift early. */
  _checkLockdown() {
    if (this.state.lockdown || this.gameOverState) return;
    const convinced = this.npcs.filter((n) => n.suspicionOfPlayer() >= 78).length;
    if (convinced < this.difficulty.lockdownCount) return;

    this.state.lockdown = true;
    this.raiseAlert(3, 'Chief Rook called a lockdown');
    this.logEvent({
      type: 'ALARM',
      detail: 'Lockdown. Every hand on this floor is looking for you now.',
      tone: 'alarm',
    });
    this.npcs.forEach((npc) => {
      npc.chaseThreshold = Math.min(npc.chaseThreshold, 45);
      npc.walkSpeed *= 1.12;
      npc.setPointOfInterest({ x: this.player.x, y: this.player.y }, 14000);
    });
    this.pushWorldSummary({ type: 'ALARM', room: 'the facility' });
  }

  /** Occasional unprompted thought so the cast is not mute between player actions. */
  ambientTick() {
    if (this.gameOverState || this.isPaused) return;
    const candidates = this.npcs.filter((n) => !n.isThinking && !n.conversationWith && !n.bubble.isBusy);
    if (!candidates.length) return;
    const npc = Phaser.Utils.Array.GetRandom(candidates);
    this.cognition.request(npc, 'IDLE', {
      detail: `You are in ${npc.roomName}. Alert level ${this.state.alertLevel}.`,
      priority: PRIORITY.IDLE,
      cooldownMs: 20000,
    });
  }

  /** Cognition landed. Fold the social consequences into the world. */
  applyCognitionResult(npc, payload, meta) {
    if (payload.action_intent === 'ACCUSE' && payload.target_entity && payload.target_entity !== 'PLAYER') {
      const target = this.npcs.find((n) => n.id === payload.target_entity);
      if (target) {
        this.logEvent({
          type: 'ACCUSATION', actor: npc.npcName, detail: `${npc.npcName} accused ${target.npcName}.`, tone: 'warn',
        });
        // A public accusation moves everyone who can see the accuser.
        this.npcs.filter((o) => o !== npc && Phaser.Math.Distance.Between(o.x, o.y, npc.x, npc.y) < 300)
          .forEach((o) => o.accrueSuspicion(target.id, 8 * (o.secretRole?.spreadMultiplier ?? 1)));
      }
    }

    if (payload.action_intent === 'ACCUSE' && payload.target_entity === 'PLAYER') {
      this.raiseAlert(Math.min(2, this.state.alertLevel + 1), `${npc.npcName} named you`);
      this.npcs.filter((o) => o !== npc && Phaser.Math.Distance.Between(o.x, o.y, npc.x, npc.y) < 300)
        .forEach((o) => o.accrueSuspicion('PLAYER', 7 * (o.secretRole?.spreadMultiplier ?? 1)));
    }

    if (meta.deltas && Object.keys(meta.deltas).length) sfx.suspicionUp();
    eventManager.emit(EVENTS.SUSPICION_CHANGED, this._suspicionSnapshot());
  }

  /* ================================================================ reporting */

  _suspicionSnapshot() {
    const rows = this.npcs.map((n) => ({
      id: n.id,
      name: n.npcName,
      player: Math.round(n.suspicionOfPlayer()),
      emotion: n.emotion,
      fsm: n.fsm,
      thinking: n.isThinking,
      peers: Object.fromEntries(
        Object.entries(n.suspicion)
          .filter(([k]) => k !== 'PLAYER')
          .map(([k, v]) => [k, Math.round(v)]),
      ),
      source: n.cognitionSource,
    }));
    return { rows, heat: Math.max(0, ...rows.map((r) => r.player)) };
  }

  _objectives() {
    return {
      POWER: this.state.sabotage.POWER,
      DATA: this.state.sabotage.DATA,
      CAMERAS: this.state.sabotage.CAMERAS,
      ESCAPE: this.state.escaped,
      done: this.state.objectivesDone,
    };
  }

  _itemLabel(id) {
    return itemLabel(id);
  }

  _clock() {
    const total = Math.floor(this.state.elapsedMs / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  _emitTick(force = false) {
    if (this.gameOverState && !force) return;
    const snapshot = this._suspicionSnapshot();
    eventManager.emit(EVENTS.GAME_TICK, {
      levelId: this.levelId,
      levelName: this.level.name,
      difficulty: this.difficulty.id,
      clock: this._clock(),
      room: roomNameAt(this.player.tileX, this.player.tileY),
      lightsOn: this.state.lightsOn && this.darkRooms.size === 0,
      alertLevel: this.state.alertLevel,
      lockdown: this.state.lockdown,
      heat: snapshot.heat,
      suspicion: snapshot.rows,
      objectives: this._objectives(),
      inventory: [...this.inventory],
      sneaking: this.player.sneaking,
      channel: this.channel ? { label: this.channel.label, progress: this.channel.progress } : null,
      hackReadyIn: Math.max(0, Math.round((this.hackReadyAt - this.time.now) / 1000)),
      cognition: this.cognition.getStats(),
    });
  }

  /** Compact position payload. Kept tiny - it fires 15x a second. */
  _emitMinimap() {
    if (this.isPaused) return;
    eventManager.emit(EVENTS.MINIMAP, {
      levelId: this.levelId,
      px: this.player.x,
      py: this.player.y,
      pf: this.player.facing,
      dark: !this.state.lightsOn || this.darkRooms.size > 0,
      // NPC positions are deliberately not sent - the minimap shows layout and
      // objectives only, so the radar cannot replace actually watching the floor.
      done: { ...this.state.sabotage },
      ready: this.state.objectivesDone >= 3,
    });
  }

  /* ============================================================== networking */

  _wireNet() {
    const net = this.net;

    // Everyone reports their own body; the host additionally reports the world.
    this.time.addEvent({ delay: 66, loop: true, callback: () => this._netBroadcast() });

    this._netOffs = [
      net.on('snapshot', (snap) => this._applySnapshot(snap)),
      net.on('input', (msg) => this._applyPeerState(msg)),
      net.on('roster', () => this._syncRemoteRoster()),
      net.on('event', (e) => {
        if (this.netRole !== 'guest') return;
        eventManager.emit(EVENTS.WORLD_EVENT, { ...e, timestamp: Date.now() });
      }),
    ];

    this._syncRemoteRoster();
    this.events.once('shutdown', () => this._netOffs?.forEach((off) => off()));
  }

  /** Bodies for everyone in the room except us. */
  _syncRemoteRoster() {
    if (!this.net) return;
    const roster = this.net.roster();
    const wanted = new Set(roster.filter((p) => p.id !== this.net.clientId).map((p) => p.id));

    for (const [id, sprite] of this.remotePlayers) {
      if (!wanted.has(id)) { sprite.destroy(); this.remotePlayers.delete(id); }
    }
    for (const p of roster) {
      if (p.id === this.net.clientId || this.remotePlayers.has(p.id)) continue;
      const color = Phaser.Display.Color.HexStringToColor(p.color).color;
      this.remotePlayers.set(p.id, new RemotePlayer(this, { id: p.id, name: p.name, color }));
    }
  }

  _selfState() {
    return {
      id: this.net.clientId,
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
      f: Number(this.player.facing.toFixed(2)),
      sn: this.player.sneaking,
      done: this.state.objectivesDone,
      out: this.gameOverState === 'won',
    };
  }

  _netBroadcast() {
    if (!this.net || this.isPaused) return;

    if (this.netRole === 'guest') {
      // Guests report only themselves. The host folds that into its world.
      this.net.sendInput({ seq: this._netTick++, self: this._selfState() });
      return;
    }

    // Host: authoritative world + every body it knows about.
    const players = [this._selfState()];
    for (const [, sprite] of this.remotePlayers) {
      players.push({
        id: sprite.playerId,
        x: Math.round(sprite.target.x),
        y: Math.round(sprite.target.y),
        f: sprite.target.f,
        sn: sprite.sneaking,
        out: sprite.escaped,
      });
    }

    this.net.broadcastSnapshot(buildSnapshot({
      tick: this._netTick++,
      players,
      npcs: this.npcs.map((n) => ({
        id: n.id,
        x: Math.round(n.x),
        y: Math.round(n.y),
        f: Number(n.facing.toFixed(2)),
        a: n.alertLevel,
      })),
      world: {
        lights: this.state.lightsOn,
        alert: this.state.alertLevel,
        lockdown: this.state.lockdown,
        clock: this._clock(),
      },
    }));
  }

  /** Host side: a guest told us where it is. */
  _applyPeerState(msg) {
    if (this.netRole !== 'host' || !msg.self) return;
    const sprite = this.remotePlayers.get(msg.self.id || msg.from);
    if (sprite) sprite.apply(msg.self);
  }

  /** Guest side: adopt the host's world. */
  _applySnapshot(snap) {
    if (this.netRole !== 'guest') return;

    for (const p of snap.players || []) {
      if (p.id === this.net.clientId) continue;
      this.remotePlayers.get(p.id)?.apply(p);
    }

    for (const row of snap.npcs || []) {
      const npc = this.npcs.find((n) => n.id === row.id);
      if (!npc) continue;
      npc.netTarget = row;
    }

    if (snap.world) {
      if (snap.world.lights !== this.state.lightsOn) {
        this.state.lightsOn = snap.world.lights;
        this._redrawDarkness();
        eventManager.emit(EVENTS.LIGHTS_CHANGED, snap.world.lights);
      }
      this.state.alertLevel = snap.world.alert;
      this.state.lockdown = snap.world.lockdown;
    }
  }

  logEvent(event) {
    const row = {
      ...event,
      room: event.room || roomNameAt(this.player.tileX, this.player.tileY),
      timestamp: Date.now(),
    };
    eventManager.emit(EVENTS.WORLD_EVENT, row);
    appendEvent(this.session.id, row).catch(() => {});
    if (['LIGHTS_HACKED', 'EVIDENCE_PLANTED', 'TERMINAL_HACKED', 'ACCUSATION', 'ALARM'].includes(event.type)) {
      this.pushWorldSummary(event);
    }
  }

  /** One compressed sentence carried into every future prompt. Bounded to 4 entries. */
  pushWorldSummary(event) {
    this.state.worldSummaries = pushSummary(this.state.worldSummaries, compressEvent(event));
  }

  /* ============================================================== lifecycle */

  setPaused(value) {
    this.isPaused = value;
    this.cognition.setPaused(value);
    if (value) this.physics.pause();
    else this.physics.resume();
    eventManager.emit(EVENTS.GAME_PAUSED, value);
  }

  serializeState() {
    return {
      ...this.session,
      levelId: this.levelId,
      difficulty: this.difficulty.id,
      status: this.gameOverState || 'active',
      elapsedMs: this.state.elapsedMs,
      player: {
        x: this.player.x,
        y: this.player.y,
        inventory: [...this.inventory],
        objectives: this._objectives(),
      },
      npcs: this.npcs.map((n) => n.serialize()),
      suspicionMatrix: Object.fromEntries(this.npcs.map((n) => [n.id, { ...n.suspicion }])),
      world: {
        lightsOn: this.state.lightsOn,
        alertLevel: this.state.alertLevel,
        lockdown: this.state.lockdown,
        sabotage: { ...this.state.sabotage },
      },
      worldSummaries: [...this.state.worldSummaries],
    };
  }

  _applySavedState(saved) {
    this.session = { ...saved };
    this.state.elapsedMs = saved.elapsedMs || 0;
    this.state.worldSummaries = saved.worldSummaries || [];
    Object.assign(this.state, {
      lightsOn: saved.world?.lightsOn ?? true,
      alertLevel: saved.world?.alertLevel ?? 0,
      lockdown: saved.world?.lockdown ?? false,
      sabotage: { POWER: false, DATA: false, CAMERAS: false, ...(saved.world?.sabotage || {}) },
    });
    this.state.objectivesDone = Object.values(this.state.sabotage).filter(Boolean).length;

    if (saved.player) {
      this.player.setPosition(saved.player.x, saved.player.y);
      this.inventory = [...(saved.player.inventory || [])];
    }
    (saved.npcs || []).forEach((row) => {
      const npc = this.npcs.find((n) => n.id === row.id);
      npc?.hydrate(row);
    });

    // Sabotaged props should look sabotaged after a reload.
    this.props.forEach((prop) => {
      if (prop.def.action === 'SABOTAGE' && this.state.sabotage[prop.def.sabotage]) {
        this.tweens.killTweensOf(prop.sprite);
        prop.sprite.setTint(0x334155).setAlpha(0.4);
      }
    });

    this._redrawDarkness();
    eventManager.emit(EVENTS.INVENTORY_CHANGED, [...this.inventory]);
    eventManager.emit(EVENTS.OBJECTIVES_CHANGED, this._objectives());
    this.logEvent({ type: 'INFO', detail: 'Session restored from local storage.', tone: 'info' });
  }

  saveNow() {
    if (this.gameOverState) return;
    saveSessionThrottled(this.serializeState());
  }

  endGame(outcome, reason) {
    if (this.gameOverState) return;
    this.gameOverState = outcome;
    this.state.escaped = outcome === 'won';
    this.player.setDisabled(true);
    this.cognition.cancelAll();
    this.npcs.forEach((npc) => npc.stopMoving());

    if (outcome === 'won') sfx.win(); else sfx.lose();

    this.logEvent({ type: 'INFO', detail: reason, tone: outcome === 'won' ? 'success' : 'alarm' });
    eventManager.emit(EVENTS.GAME_OVER, {
      outcome,
      reason,
      levelId: this.levelId,
      levelName: this.level.name,
      difficulty: this.difficulty.id,
      clock: this._clock(),
      objectives: this._objectives(),
      suspicion: this._suspicionSnapshot(),
      cognition: this.cognition.getStats(),
    });

    flushPendingSave().catch(() => {});
    saveSessionThrottled(this.serializeState(), 0);
  }

  restart() {
    this.cognition.destroy();
    this.scene.restart({ resume: null, levelId: this.levelId, difficulty: this.difficulty.id });
  }
}

/** Resume helper used by App.jsx before the scene mounts. */
export async function loadResumePayload() {
  const saved = await loadLatestSession();
  return saved && saved.status === 'active' ? saved : null;
}

export default MainLabScene;
