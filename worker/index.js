/**
 * worker/index.js - Static asset host + WebSocket room relay.
 *
 * The Durable Object here is deliberately dumb. It does not simulate the game, does
 * not parse messages, and holds no game state: it accepts sockets and fans bytes out
 * to the other members of the room. Authority stays in the host player's browser.
 *
 * That is a cost decision as much as an architectural one. A relay burns CPU only
 * when a message arrives, and the Hibernation API lets the object drop out of memory
 * between messages while keeping sockets open - so an idle lobby costs nothing. If the
 * DO ran the simulation instead, every room would be billing CPU at 60fps.
 *
 * It also means single-player remains the reference implementation: the same scene
 * code runs whether or not anyone else is connected.
 */

import { DurableObject } from 'cloudflare:workers';

/** Rooms are addressed by their 5-character code via getByName(). */
export class RoomRelay extends DurableObject {
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const url = new URL(request.url);
    const clientId = (url.searchParams.get('id') || crypto.randomUUID()).slice(0, 64);

    const [client, server] = Object.values(new WebSocketPair());
    // Tagging with the client id lets us address a single peer later without
    // keeping an in-memory map that would not survive hibernation.
    this.ctx.acceptWebSocket(server, [clientId]);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    // Pure fan-out. Everything the game needs to interpret is inside the payload,
    // which this object never opens.
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      if (peer.readyState !== WebSocket.OPEN) continue;
      try {
        peer.send(message);
      } catch {
        // A peer that fails a send is already gone; close() will arrive shortly.
      }
    }
  }

  webSocketClose(ws) {
    // Tell the remaining peers so the host can prune its roster immediately rather
    // than waiting out the heartbeat timeout.
    const [clientId] = this.ctx.getTags(ws);
    if (!clientId) return;
    const bye = JSON.stringify({ from: clientId, msg: { t: 'bye', clientId } });
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws || peer.readyState !== WebSocket.OPEN) continue;
      try { peer.send(bye); } catch { /* peer already gone */ }
    }
  }

  webSocketError(ws, error) {
    console.error('[RoomRelay] socket error', error);
  }
}

/** Room codes are the alphabet in protocol.js: A-Z minus lookalikes, plus 2-9. */
const ROOM_PATH = /^\/room\/([A-Za-z0-9]{4,8})$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(ROOM_PATH);

    if (match) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }
      const room = match[1].toUpperCase();
      return env.ROOMS.getByName(room).fetch(request);
    }

    // Everything else is the game itself. `not_found_handling` in the Wrangler config
    // turns unknown paths into index.html so the SPA keeps working.
    return env.ASSETS.fetch(request);
  },
};
