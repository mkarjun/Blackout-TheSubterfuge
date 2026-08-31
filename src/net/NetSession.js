/**
 * NetSession.js - Room membership, host election and message routing.
 *
 * Sits between a Transport (dumb pipe) and the game (which should never see a raw
 * message). Owns exactly three things:
 *
 *   1. Who is in the room, in join order, with a stable colour.
 *   2. Which peer is authoritative. The room creator hosts. A join that gets no
 *      WELCOME inside JOIN_TIMEOUT_MS concludes the room is empty and claims the host
 *      role itself - which is what makes "join a code nobody created yet" behave sanely
 *      on the serverless loopback transport.
 *   3. Turning wire messages into named events the UI and scene subscribe to.
 *
 * Deliberately not here: any game state. The session does not know what a suspicion
 * is. It moves envelopes.
 */

import {
  MSG, makeClientId, makeRoomCode, normaliseRoomCode, sanitiseName,
  PLAYER_COLORS_CSS, MAX_PLAYERS, PROTOCOL_VERSION,
} from './protocol.js';
import { createTransport } from './Transport.js';

const JOIN_TIMEOUT_MS = 1400;
const PEER_TIMEOUT_MS = 12000;
const HEARTBEAT_MS = 3000;

export class NetSession {
  constructor({ name = 'Infiltrator', mode = 'auto', baseUrl = '' } = {}) {
    this.clientId = makeClientId();
    this.name = sanitiseName(name);
    this.mode = mode;
    this.baseUrl = baseUrl;

    this.room = null;
    this.isHost = false;
    this.connected = false;
    this.started = false;

    /** @type {Map<string, {id,name,color,colorIndex,isHost,lastSeen}>} */
    this.players = new Map();

    this.transport = null;
    this._listeners = new Map();
    this._heartbeat = null;
  }

  /* ------------------------------------------------------------ events */

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this._listeners.get(event)?.delete(handler);
  }

  _emit(event, payload) {
    for (const fn of this._listeners.get(event) || []) {
      try { fn(payload); } catch (err) { console.error(`[NetSession] ${event} handler threw`, err); }
    }
  }

  /* ------------------------------------------------------- lifecycle */

  /** Create a room and become its authority. */
  async host(code = makeRoomCode()) {
    await this._open(normaliseRoomCode(code));
    this.isHost = true;
    this._addPlayer({ id: this.clientId, name: this.name, isHost: true });
    this._emit('status', this.status());
    this._emit('roster', this.roster());
    return this.room;
  }

  /**
   * Join an existing room. Resolves once the host acknowledges. If nobody answers,
   * the room does not exist yet and this peer becomes the host instead - reported
   * back so the UI can say so rather than silently changing what the player asked for.
   *
   * @returns {Promise<{role:'guest'|'host', room:string}>}
   */
  async join(code) {
    const room = normaliseRoomCode(code);
    await this._open(room);

    return new Promise((resolve) => {
      let settled = false;
      const offWelcome = this.on('welcome', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        offWelcome();
        resolve({ role: 'guest', room });
      });

      const timer = setTimeout(async () => {
        if (settled) return;
        settled = true;
        offWelcome();
        this.isHost = true;
        this._addPlayer({ id: this.clientId, name: this.name, isHost: true });
        this._emit('status', this.status());
        this._emit('roster', this.roster());
        resolve({ role: 'host', room });
      }, JOIN_TIMEOUT_MS);

      this.transport.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: this.name, clientId: this.clientId });
    });
  }

  async _open(room) {
    this.room = room;
    this.transport = createTransport(this.clientId, { mode: this.mode, baseUrl: this.baseUrl });
    this.transport.onMessage = (msg, meta) => this._receive(msg, meta);
    this.transport.onClose = () => {
      this.connected = false;
      this._emit('status', this.status());
    };
    await this.transport.connect(room);
    this.connected = true;
    this._startHeartbeat();
    this._emit('status', this.status());
  }

  leave() {
    if (this.transport) {
      this.transport.send({ t: MSG.BYE, clientId: this.clientId });
      this.transport.close();
      this.transport = null;
    }
    clearInterval(this._heartbeat);
    this._heartbeat = null;
    this.players.clear();
    this.connected = false;
    this.isHost = false;
    this.started = false;
    this.room = null;
    this._emit('status', this.status());
    this._emit('roster', this.roster());
  }

  _startHeartbeat() {
    clearInterval(this._heartbeat);
    this._heartbeat = setInterval(() => {
      if (!this.transport) return;
      this.transport.send({ t: MSG.PING, clientId: this.clientId });
      // The host is the only peer that prunes, so the roster has one owner.
      if (this.isHost) {
        const now = Date.now();
        let dropped = false;
        for (const [id, p] of this.players) {
          if (id === this.clientId) continue;
          if (now - p.lastSeen > PEER_TIMEOUT_MS) { this.players.delete(id); dropped = true; }
        }
        if (dropped) this._broadcastRoster();
      }
    }, HEARTBEAT_MS);
  }

  /* -------------------------------------------------------- roster ops */

  _addPlayer({ id, name, isHost = false }) {
    if (this.players.has(id)) {
      const p = this.players.get(id);
      p.lastSeen = Date.now();
      return p;
    }
    if (this.players.size >= MAX_PLAYERS) return null;
    const colorIndex = this.players.size;
    const player = {
      id,
      name: sanitiseName(name),
      colorIndex,
      color: PLAYER_COLORS_CSS[colorIndex % PLAYER_COLORS_CSS.length],
      isHost,
      lastSeen: Date.now(),
    };
    this.players.set(id, player);
    return player;
  }

  roster() {
    return [...this.players.values()].map((p) => ({ ...p }));
  }

  status() {
    return {
      room: this.room,
      connected: this.connected,
      isHost: this.isHost,
      started: this.started,
      you: this.clientId,
      count: this.players.size,
    };
  }

  _broadcastRoster() {
    if (!this.isHost) return;
    this.transport?.send({ t: MSG.ROSTER, players: this.roster() });
    this._emit('roster', this.roster());
  }

  /* ---------------------------------------------------------- receive */

  _receive(msg, meta) {
    const from = meta?.from || msg.clientId;
    const known = this.players.get(from);
    if (known) known.lastSeen = Date.now();

    switch (msg.t) {
      case MSG.HELLO: {
        if (!this.isHost) return;                       // only the host admits players
        if (msg.v !== PROTOCOL_VERSION) return;
        const player = this._addPlayer({ id: msg.clientId, name: msg.name });
        if (!player) return;                            // room full
        this.transport.send({
          t: MSG.WELCOME,
          to: msg.clientId,
          you: player,
          room: this.room,
          players: this.roster(),
        });
        this._broadcastRoster();
        break;
      }

      case MSG.WELCOME: {
        if (msg.to !== this.clientId) return;           // fan-out; not addressed to us
        this.isHost = false;
        this.players.clear();
        for (const p of msg.players) this.players.set(p.id, { ...p, lastSeen: Date.now() });
        this._emit('welcome', msg);
        this._emit('roster', this.roster());
        this._emit('status', this.status());
        break;
      }

      case MSG.ROSTER: {
        if (this.isHost) return;
        this.players.clear();
        for (const p of msg.players) this.players.set(p.id, { ...p, lastSeen: Date.now() });
        this._emit('roster', this.roster());
        break;
      }

      case MSG.BYE: {
        if (this.players.delete(msg.clientId) && this.isHost) this._broadcastRoster();
        else this._emit('roster', this.roster());
        break;
      }

      case MSG.START:
        this.started = true;
        this._emit('start', msg);
        this._emit('status', this.status());
        break;

      case MSG.INPUT:
        if (this.isHost) this._emit('input', { from, ...msg });
        break;

      case MSG.SNAPSHOT:
        if (!this.isHost) this._emit('snapshot', msg);
        break;

      case MSG.EVENT:
        if (!this.isHost) this._emit('event', msg);
        break;

      case MSG.VERDICT:
        this._emit('verdict', msg);
        break;

      case MSG.PING:
        if (!known && this.isHost) {
          // A peer we pruned (or never saw) is still alive - re-admit rather than
          // leaving them invisible until they reload.
          this._addPlayer({ id: from, name: 'Infiltrator' });
          this._broadcastRoster();
        }
        break;

      default:
        break;
    }
  }

  /* ------------------------------------------------------------- send */

  /** Host only: begin the run for everyone. */
  startRun({ levelId, difficulty, seed }) {
    if (!this.isHost) return false;
    const msg = { t: MSG.START, levelId, difficulty, seed, startedAt: Date.now() };
    this.transport.send(msg);
    this.started = true;
    this._emit('start', msg);
    this._emit('status', this.status());
    return true;
  }

  /** Guest only: report intent for one frame. */
  sendInput(payload) {
    if (this.isHost || !this.transport) return false;
    return this.transport.send({ t: MSG.INPUT, ...payload });
  }

  /** Host only. */
  broadcastSnapshot(snapshot) {
    if (!this.isHost || !this.transport) return false;
    return this.transport.send(snapshot);
  }

  broadcastEvent(event) {
    if (!this.isHost || !this.transport) return false;
    return this.transport.send({ t: MSG.EVENT, ...event });
  }

  broadcastVerdict(verdict) {
    if (!this.isHost || !this.transport) return false;
    return this.transport.send({ t: MSG.VERDICT, ...verdict });
  }
}

/** One session per tab. */
export const netSession = new NetSession();

export default netSession;
