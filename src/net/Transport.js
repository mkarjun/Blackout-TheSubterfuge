/**
 * Transport.js - How bytes get between players.
 *
 * Two implementations behind one interface, and the split is deliberate:
 *
 *   LoopbackTransport   - BroadcastChannel, same machine, cross-tab. Needs no server,
 *                         no account and no deploy, which means the whole multiplayer
 *                         stack is testable *right now* by opening two tabs. Every
 *                         netcode bug that is really a state-sync bug gets caught here
 *                         instead of over a socket.
 *   SocketTransport     - WebSocket to a Cloudflare Durable Object. Same interface, so
 *                         the game code cannot tell which one it is talking to.
 *
 * The interface is intentionally tiny: connect, send, close, and an onMessage sink.
 * Anything smarter (host election, rosters, retries) belongs in NetSession, not here.
 */

/** @abstract */
export class Transport {
  constructor() {
    this.onMessage = null;     // (msg, meta) => void
    this.onOpen = null;
    this.onClose = null;
    this.onError = null;
    this.connected = false;
  }

  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  async connect(_room) { throw new Error('not implemented'); }
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  send(_msg) { throw new Error('not implemented'); }
  // eslint-disable-next-line class-methods-use-this
  close() { throw new Error('not implemented'); }

  _emit(msg, meta) {
    if (this.onMessage) {
      try { this.onMessage(msg, meta); } catch (err) { console.error('[Transport] handler threw', err); }
    }
  }
}

/* ------------------------------------------------------------- loopback */

/**
 * Cross-tab transport over BroadcastChannel.
 *
 * BroadcastChannel echoes to every listener *except* the sender, which is exactly the
 * fan-out semantic we want, so no filtering is needed. Messages are tagged with the
 * sender's clientId so the session layer can address replies.
 */
export class LoopbackTransport extends Transport {
  constructor(clientId) {
    super();
    this.clientId = clientId;
    this.channel = null;
  }

  async connect(room) {
    this.channel = new BroadcastChannel(`blackout:${room}`);
    this.channel.onmessage = (ev) => {
      const { from, msg } = ev.data || {};
      if (!msg) return;
      this._emit(msg, { from });
    };
    this.connected = true;
    this.onOpen?.();
    return true;
  }

  send(msg) {
    if (!this.channel) return false;
    this.channel.postMessage({ from: this.clientId, msg });
    return true;
  }

  close() {
    this.connected = false;
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.onClose?.();
  }
}

/* --------------------------------------------------------------- socket */

/**
 * WebSocket transport to a Durable Object room.
 *
 * The DO is a relay plus room registry: it does not simulate anything, it just fans
 * messages out and remembers who the host is. Keeping the authority in the host's
 * browser (rather than in the DO) is what lets single-player and multiplayer share
 * one simulation - and it keeps the Worker inside the free tier, since it burns no
 * CPU per frame.
 */
export class SocketTransport extends Transport {
  /**
   * @param {string} clientId
   * @param {object} opts
   * @param {string} [opts.baseUrl] Defaults to same-origin, which is correct once the
   *                                game and the Worker are deployed together.
   */
  constructor(clientId, { baseUrl = '' } = {}) {
    super();
    this.clientId = clientId;
    this.baseUrl = baseUrl;
    this.ws = null;
    this.room = null;
    this._retries = 0;
    this._closing = false;
    this._queue = [];
  }

  _url(room) {
    const base = this.baseUrl || `${location.protocol}//${location.host}`;
    const url = new URL(`/room/${encodeURIComponent(room)}`, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('id', this.clientId);
    return url.toString();
  }

  async connect(room) {
    this.room = room;
    this._closing = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(this._url(room));
      } catch (err) {
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        this.connected = true;
        this._retries = 0;
        settled = true;
        // Anything queued while connecting goes out in order.
        for (const m of this._queue.splice(0)) this.send(m);
        this.onOpen?.();
        resolve(true);
      };

      this.ws.onmessage = (ev) => {
        let parsed;
        try { parsed = JSON.parse(ev.data); } catch { return; }
        this._emit(parsed.msg || parsed, { from: parsed.from });
      };

      this.ws.onerror = (err) => {
        this.onError?.(err);
        if (!settled) { settled = true; reject(new Error('websocket failed to open')); }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.onClose?.();
        if (!this._closing) this._reconnect();
      };
    });
  }

  /** Exponential backoff, capped. A dropped host ends the run; a dropped guest rejoins. */
  _reconnect() {
    if (this._retries >= 5) return;
    const delay = Math.min(8000, 400 * 2 ** this._retries);
    this._retries++;
    setTimeout(() => {
      if (!this._closing) this.connect(this.room).catch(() => {});
    }, delay);
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Only buffer lobby-critical traffic; dropping a stale movement frame is correct.
      if (this._queue.length < 32) this._queue.push(msg);
      return false;
    }
    this.ws.send(JSON.stringify({ from: this.clientId, msg }));
    return true;
  }

  close() {
    this._closing = true;
    this.connected = false;
    this._queue.length = 0;
    if (this.ws) {
      try { this.ws.close(); } catch { /* already gone */ }
      this.ws = null;
    }
  }
}

/**
 * Pick a transport. Loopback is used when explicitly asked for, and as the automatic
 * choice on a dev origin with no Worker behind it, so two tabs always work locally.
 */
export function createTransport(clientId, { mode = 'auto', baseUrl = '' } = {}) {
  if (mode === 'loopback') return new LoopbackTransport(clientId);
  if (mode === 'socket') return new SocketTransport(clientId, { baseUrl });
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  return isDev ? new LoopbackTransport(clientId) : new SocketTransport(clientId, { baseUrl });
}

export default { Transport, LoopbackTransport, SocketTransport, createTransport };
