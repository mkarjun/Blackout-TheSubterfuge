/**
 * NPC.js - Body (Physical Layer) + the socket the Cognitive Layer plugs into.
 *
 * The contract that keeps the game at 60fps:
 *   - update() never awaits anything. It ticks a behaviour tree, steers along a
 *     cached A* path, and repaints a vision cone. All local, all synchronous.
 *   - setThinking(true) is *cosmetic plus scheduling*: the NPC shows an ellipsis and
 *     will not queue a second request, but its tree keeps running unchanged.
 *   - applyCognition(payload) folds an LLM (or rule-based) result into physical state
 *     whenever it lands - 200ms or 4s later, or never. Nothing waits for it.
 */

import Phaser from 'phaser';
import { TILE_SIZE, roomNameAt } from '../../assets/tilemaps/labMap.js';
import { buildNpcTree, FSM } from '../systems/BehaviorTree.js';
import VisionCone from '../systems/VisionCone.js';
import SpeechBubble from './SpeechBubble.js';

const REPATH_INTERVAL_MS = 320;
const ARRIVE_EPSILON = 15;
const NODE_EPSILON = 9;
const SUSPICION_DECAY_PER_SEC = 0.55;

export class NPC extends Phaser.Physics.Arcade.Sprite {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} def       Roster entry (see entities/roster.js)
   * @param {object} spawn     { x, y } in tiles
   * @param {object} deps      { pathfinder, sightGrid, voiceIndex, secretRole }
   */
  constructor(scene, def, spawn, deps = {}) {
    super(scene, spawn.x * TILE_SIZE + TILE_SIZE / 2, spawn.y * TILE_SIZE + TILE_SIZE / 2, 'actor');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    /* ---- identity ---- */
    this.id = def.id;
    this.npcName = def.name;
    this.role = def.role;
    this.archetype = def.archetype;
    this.persona = def.persona;
    this.secret = def.secret;
    this.secretRole = deps.secretRole || null;

    /* ---- tuning (roster baseline x secret role x difficulty) ---- */
    const diff = deps.difficulty || {};
    const mul = (value, m) => value * (m ?? 1);
    this.difficulty = diff;
    this.walkSpeed = mul(def.speed, diff.npcSpeedMul);
    this.runSpeed = mul(def.runSpeed, diff.npcSpeedMul);
    this.chaseThreshold = Phaser.Math.Clamp(def.chaseThreshold + (diff.chaseThresholdDelta || 0), 10, 100);
    this.watchGainPerSec = mul(def.watchGainPerSec, diff.watchGainMul);
    this.suspicionBias = (def.suspicionBias || 1)
      * (this.secretRole?.suspicionMultiplier ?? 1)
      * (diff.suspicionBiasMul ?? 1);

    /* ---- physical state ---- */
    this.setTint(def.color);
    this.setDepth(11);
    // Body sits at the feet of the 36x44 frame, not its centre.
    this.body.setSize(26, 26);
    this.body.setOffset(5, 16);
    this.setCollideWorldBounds(true);
    this.body.setDrag(600, 600);

    this.fsm = FSM.PATROL;
    this.facing = 0;
    this.path = [];
    this.pathIndex = 0;
    this.pathTargetKey = '';
    this.lastRepathAt = 0;

    this.patrolPoints = (deps.patrol || []).map((p) => ({
      x: p.x * TILE_SIZE + TILE_SIZE / 2,
      y: p.y * TILE_SIZE + TILE_SIZE / 2,
    }));
    this.patrolIndex = 0;

    this.pointOfInterest = null;
    this.poiExpiresAt = 0;
    this.conversationWith = null;
    this.stunnedUntil = 0;
    this.fleeUntil = 0;
    this.workUntil = 0;
    this.canSeePlayer = false;
    this.catchTimer = 0;          // ms of unbroken contact, see MainLabScene._checkCatch
    this.lastKnownPlayerPos = null;
    this.lastSawPlayerAt = -Infinity;

    /* ---- social state ---- */
    this.emotion = 'NEUTRAL';
    this.intent = 'IGNORE';
    this.suspicion = { PLAYER: 0 };
    this.alertLevel = 0;
    this.isThinking = false;
    this.lastCognitionAt = -Infinity;
    this.cognitionSource = 'none';

    /* ---- deps ---- */
    this.pathfinder = deps.pathfinder;
    this.tree = buildNpcTree();
    this.cone = new VisionCone(scene, this, {
      sightGrid: deps.sightGrid,
      range: mul(def.visionRange, diff.visionRangeMul),
      fov: def.fov,
    });
    this.bubble = new SpeechBubble(scene, { voice: deps.voiceIndex ?? 0 });

    /* ---- presentation ---- */
    this.label = scene.add.text(this.x, this.y - 40, def.name.split(' ').slice(-1)[0], {
      fontFamily: 'Consolas, monospace',
      fontSize: '13px',
      color: '#9fb0c4',
    }).setOrigin(0.5, 1).setDepth(14);

    this.glyph = scene.add.text(this.x, this.y - 52, '', {
      fontFamily: 'Consolas, monospace',
      fontSize: '18px',
      color: '#ffc14d',
      fontStyle: 'bold',
    }).setOrigin(0.5, 1).setDepth(15);

    this.faceMark = scene.add.image(this.x, this.y, 'facemark').setTint(def.color).setDepth(12).setAlpha(0.8);
    this._labelTimer = 0;
  }

  /* --------------------------------------------------------- accessors */

  get tileX() { return Math.floor(this.x / TILE_SIZE); }
  get tileY() { return Math.floor(this.y / TILE_SIZE); }
  get roomName() { return roomNameAt(this.tileX, this.tileY); }

  suspicionOfPlayer() { return this.suspicion.PLAYER || 0; }

  suspicionOf(id) { return this.suspicion[id] || 0; }

  /* ------------------------------------------------- behaviour tree API */

  setFsm(state) {
    if (this.fsm !== state) {
      this.fsm = state;
      this.scene?.events.emit('npc-fsm', { id: this.id, fsm: state });
    }
  }

  stopMoving() {
    this.setVelocity(0, 0);
    this.path = [];
    this.pathIndex = 0;
  }

  faceTarget(target) {
    if (!target) return;
    this.facing = Math.atan2(target.y - this.y, target.x - this.x);
  }

  /**
   * Steer along a cached A* path toward a world point.
   * @returns {boolean} true once within ARRIVE_EPSILON of the destination.
   */
  moveTowardPoint(point, { run = false } = {}) {
    if (!point) return true;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, point.x, point.y);
    if (dist <= ARRIVE_EPSILON) {
      this.stopMoving();
      return true;
    }

    const key = `${Math.round(point.x / TILE_SIZE)},${Math.round(point.y / TILE_SIZE)}`;
    const now = this.scene.time.now;
    const stale = now - this.lastRepathAt > REPATH_INTERVAL_MS;
    if (key !== this.pathTargetKey || (stale && this.pathIndex >= this.path.length)) {
      this.pathTargetKey = key;
      this.lastRepathAt = now;
      this.path = this.pathfinder.findPath(this.x, this.y, point.x, point.y);
      this.pathIndex = 0;
    }

    const speed = run ? this.runSpeed : this.walkSpeed;
    const node = this.path[this.pathIndex];

    // No path (or already at the last node): steer straight at the goal. Physics
    // collision keeps this honest rather than letting a body walk into a wall.
    const goal = node || point;
    const d = Phaser.Math.Distance.Between(this.x, this.y, goal.x, goal.y);
    if (node && d <= NODE_EPSILON) {
      this.pathIndex++;
      return false;
    }

    const angle = Math.atan2(goal.y - this.y, goal.x - this.x);
    this.facing = angle;
    this.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    return false;
  }

  followPatrol() {
    if (!this.patrolPoints.length) {
      this.stopMoving();
      return true;
    }
    return this.moveTowardPoint(this.patrolPoints[this.patrolIndex], { run: false });
  }

  scheduleWaypointPause(time) {
    this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
    this.workUntil = time + Phaser.Math.Between(900, 2600);
    this.pathTargetKey = '';
  }

  /** Run away from the last known threat, using the patrol ring as escape geometry. */
  fleeFromThreat() {
    const threat = this.lastKnownPlayerPos || { x: this.x, y: this.y };
    const away = Math.atan2(this.y - threat.y, this.x - threat.x);
    const target = {
      x: Phaser.Math.Clamp(this.x + Math.cos(away) * 330, 60, this.scene.physics.world.bounds.width - 60),
      y: Phaser.Math.Clamp(this.y + Math.sin(away) * 330, 60, this.scene.physics.world.bounds.height - 60),
    };
    this.moveTowardPoint(target, { run: true });
  }

  clearPointOfInterest() {
    this.pointOfInterest = null;
    this.poiExpiresAt = 0;
    this.pathTargetKey = '';
  }

  /* ------------------------------------------------------- perception */

  /** Something audible happened. Only reacts if it is close enough to hear. */
  hear(point, radius = 285) {
    const dist = Phaser.Math.Distance.Between(this.x, this.y, point.x, point.y);
    if (dist > radius) return false;
    // A louder, closer noise overrides a stale point of interest.
    this.setPointOfInterest(point, 6000);
    return true;
  }

  setPointOfInterest(point, ttlMs = 8000) {
    this.pointOfInterest = { x: point.x, y: point.y };
    this.poiExpiresAt = this.scene.time.now + ttlMs;
    this.pathTargetKey = '';
  }

  /**
   * @returns {boolean} true on the *rising edge* of seeing the player, which is what
   * the scene uses to fire a cognition trigger (not every frame of contact).
   */
  perceive(player, { lightsOn = true } = {}) {
    this.cone.setLighting(lightsOn);
    const result = this.cone.canSee(player.x, player.y, { rangeScale: player.visibilityScale });
    const wasSeeing = this.canSeePlayer;
    this.canSeePlayer = result.seen;

    if (result.seen) {
      this.lastKnownPlayerPos = { x: player.x, y: player.y };
      this.lastSawPlayerAt = this.scene.time.now;
    }
    return result.seen && !wasSeeing;
  }

  /* ------------------------------------------------------- social API */

  /**
   * @param {string} id  'PLAYER' or an NPC id
   * @param {number} amount Raw delta; personality bias and clamping applied here.
   */
  accrueSuspicion(id, amount) {
    if (!amount) return this.suspicion[id] || 0;
    const biased = amount > 0 ? amount * this.suspicionBias : amount;
    const next = Phaser.Math.Clamp((this.suspicion[id] || 0) + biased, 0, 100);
    this.suspicion[id] = next;
    return next;
  }

  setSuspicion(id, value) {
    this.suspicion[id] = Phaser.Math.Clamp(value, 0, 100);
  }

  speak(text, emotion = this.emotion) {
    if (!text) return;
    this.bubble.say(text, { emotion });
  }

  setThinking(value) {
    this.isThinking = value;
    if (value) this.bubble.think();
    else if (this.bubble.mode === 'thinking') this.bubble.hide();
  }

  /**
   * Fold a cognition payload (LLM or rules) into physical state.
   * Dialogue is spoken, deltas are applied, and action_intent becomes a *nudge* the
   * behaviour tree may act on - never a direct command, so a stale 4-second-old
   * intent cannot yank a body that has since been alerted by something closer.
   *
   * @returns {{deltas:object}} applied suspicion deltas, for the scene's event log.
   */
  applyCognition(payload, { playerPos = null } = {}) {
    if (!payload) return { deltas: {} };
    this.setThinking(false);
    this.lastCognitionAt = this.scene.time.now;
    this.cognitionSource = payload._source || 'llm';

    this.emotion = payload.emotion_state || this.emotion;
    this.intent = payload.action_intent || this.intent;

    const applied = {};
    for (const [id, delta] of Object.entries(payload.suspicion_delta || {})) {
      const before = this.suspicion[id] || 0;
      const after = this.accrueSuspicion(id, delta);
      if (after !== before) applied[id] = Math.round(after - before);
    }

    this.speak(payload.dialogue, this.emotion);

    const now = this.scene.time.now;
    switch (payload.action_intent) {
      case 'INVESTIGATE':
        if (playerPos && !this.conversationWith) this.setPointOfInterest(playerPos, 7000);
        break;
      case 'FLEE':
        this.fleeUntil = now + 3800;
        this.conversationWith = null;
        break;
      case 'FOLLOW':
        if (playerPos) this.setPointOfInterest(playerPos, 5200);
        break;
      case 'ACCUSE':
        // Accusing costs a beat of standing still - it reads as a confrontation.
        this.stunnedUntil = Math.max(this.stunnedUntil, now + 420);
        break;
      case 'IGNORE':
      default:
        break;
    }

    return { deltas: applied };
  }

  startConversation(target) {
    this.conversationWith = target;
    this.stopMoving();
  }

  endConversation() {
    this.conversationWith = null;
    this.bubble.finish();
  }

  /* ------------------------------------------------------------ update */

  /**
   * @param {number} time  scene.time.now
   * @param {number} delta ms
   * @param {object} world { lightsOn, alertLevel }
   */
  update(time, delta, world = {}) {
    // 1. Local decision making - never blocked, never async.
    this.tree.tick({ npc: this, time, delta, world });

    // 2. Suspicion cools while the player is out of sight, so a single glimpse does
    //    not condemn you forever. Being watched (handled in the tree) outpaces this.
    if (!this.canSeePlayer && time - this.lastSawPlayerAt > 4000) {
      const decay = SUSPICION_DECAY_PER_SEC * (this.difficulty.decayMul ?? 1);
      const cooled = (this.suspicion.PLAYER || 0) - decay * (delta / 1000);
      this.suspicion.PLAYER = Math.max(0, cooled);
    }

    // 3. Derived alert level drives cone colour and the '!' glyph.
    const s = this.suspicionOfPlayer();
    this.alertLevel = this.fsm === FSM.CHASE || s >= 75 ? 2 : (s >= 40 || this.fsm === FSM.INVESTIGATE ? 1 : 0);

    // 4. Presentation.
    this.cone.setFacing(this.facing);
    this.cone.setAlertColor(Math.max(this.alertLevel, world.alertLevel ? world.alertLevel - 1 : 0));
    this.cone.redraw(time);
    this.bubble.update(time, delta, this.x, this.y - 46);
    this.faceMark.setPosition(this.x + Math.cos(this.facing) * 20, this.y + Math.sin(this.facing) * 20);

    this._labelTimer += delta;
    if (this._labelTimer > 120) {
      this._labelTimer = 0;
      this.label.setPosition(Math.round(this.x), Math.round(this.y) - 34);
      this.glyph.setPosition(Math.round(this.x), Math.round(this.y) - 50);
      const glyph = this.isThinking ? '~' : this.alertLevel >= 2 ? '!' : this.alertLevel === 1 ? '?' : '';
      this.glyph.setText(glyph);
      this.glyph.setColor(this.alertLevel >= 2 ? '#ff4d5e' : this.isThinking ? '#64748b' : '#ffc14d');
      this.label.setColor(s >= 70 ? '#ff8a8a' : s >= 40 ? '#ffd489' : '#9fb0c4');
    }
  }

  /* ------------------------------------------------------ persistence */

  serialize() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      fsm: this.fsm,
      emotion: this.emotion,
      intent: this.intent,
      suspicion: { ...this.suspicion },
      patrolIndex: this.patrolIndex,
      secretRole: this.secretRole ? this.secretRole.id : null,
      alertLevel: this.alertLevel,
    };
  }

  hydrate(state) {
    if (!state) return;
    this.setPosition(state.x ?? this.x, state.y ?? this.y);
    this.fsm = state.fsm || this.fsm;
    this.emotion = state.emotion || this.emotion;
    this.intent = state.intent || this.intent;
    this.suspicion = { PLAYER: 0, ...(state.suspicion || {}) };
    this.patrolIndex = state.patrolIndex ?? 0;
    this.alertLevel = state.alertLevel ?? 0;
    this.pathTargetKey = '';
  }

  destroy(fromScene) {
    this.cone?.destroy();
    this.bubble?.destroy();
    this.label?.destroy();
    this.glyph?.destroy();
    this.faceMark?.destroy();
    super.destroy(fromScene);
  }
}

export default NPC;
