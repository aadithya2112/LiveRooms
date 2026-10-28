import { DurableObject } from 'cloudflare:workers';
import {
  handleMessage,
  handleLeave,
  roomIdSchema,
  type RoomClient,
  type Session,
} from '../../shared/protocol';
import { allowedOrigin, iceConfig, type TurnConfig } from '../../shared/ice';

type Bindings = Env & TurnConfig;
export class Room extends DurableObject<Bindings> {
  private client(ws: WebSocket): RoomClient {
    const attachment = ws.deserializeAttachment() as Session & { id: string };
    return {
      id: attachment.id,
      read: () => ws.deserializeAttachment() as Session,
      write: (state) => ws.serializeAttachment({ ...state, id: attachment.id }),
      send: (message) => {
        try {
          ws.send(JSON.stringify(message));
        } catch {
          ws.close(1011, 'Connection lost');
        }
      },
      close: (code, reason) => ws.close(code, reason),
    };
  }
  async fetch(): Promise<Response> {
    // Bound even unjoined sockets; membership capacity is checked by the shared protocol.
    if (this.ctx.getWebSockets().length >= 6) return new Response('Room busy', { status: 429 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID(), windowStart: Date.now(), messages: 0 });
    await this.ctx.storage.setAlarm(Date.now() + 10_000);
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') {
      ws.close(1003, 'Text messages only');
      return;
    }
    handleMessage(
      this.client(ws),
      this.ctx
        .getWebSockets()
        .filter((s) => s.readyState === 1)
        .map((s) => this.client(s)),
      raw,
    );
  }
  webSocketClose(ws: WebSocket) {
    handleLeave(
      this.client(ws),
      this.ctx
        .getWebSockets()
        .filter((s) => s !== ws && s.readyState === 1)
        .map((s) => this.client(s)),
    );
    // The runtime replies to close frames with this compatibility date.
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as Session;
      if (!state.participant) ws.close(1008, 'Join timeout');
    }
  }
  webSocketError(ws: WebSocket) {
    ws.close(1011, 'Connection error');
  }
}
export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ status: 'ok' });
    if (!allowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS))
      return new Response('Origin not allowed', { status: 403 });
    const { success } = await env.CONNECTION_LIMITER.limit({
      key: request.headers.get('CF-Connecting-IP') || 'unknown',
    });
    if (!success) return new Response('Too many requests', { status: 429 });
    if (url.pathname === '/ice' && request.method === 'GET') {
      const headers = {
        'Access-Control-Allow-Origin': request.headers.get('Origin')!,
        Vary: 'Origin',
        'Cache-Control': 'no-store',
      };
      try {
        return Response.json(await iceConfig(env), { headers });
      } catch {
        console.error(JSON.stringify({ event: 'turn-unavailable' }));
        return new Response('Connectivity service unavailable', { status: 503, headers });
      }
    }
    const match = /^\/rooms\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!match || !roomIdSchema.safeParse(match[1]).success)
      return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('WebSocket required', { status: 426 });
    return env.ROOMS.getByName(match[1]).fetch(request);
  },
} satisfies ExportedHandler<Bindings>;
