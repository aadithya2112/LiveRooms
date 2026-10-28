import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  handleMessage,
  handleLeave,
  roomIdSchema,
  type RoomClient,
  type Session,
} from '../../shared/protocol.js';
import { allowedOrigin, iceConfig } from '../../shared/ice.js';

const origins = process.env.ALLOWED_ORIGINS || 'http://localhost:5173';
const rooms = new Map<string, Map<WebSocket, RoomClient>>();
const requests = new Map<string, { count: number; start: number }>();
function permitted(ip: string) {
  const now = Date.now();
  for (const [key, value] of requests) if (now - value.start > 60_000) requests.delete(key);
  const entry = requests.get(ip) || { count: 0, start: now };
  entry.count++;
  requests.set(ip, entry);
  return entry.count <= 30;
}
const server = createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (!allowedOrigin(req.headers.origin, origins)) {
    res.writeHead(403);
    res.end('Origin not allowed');
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin!);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  if (path === '/ice' && req.method === 'GET') {
    if (!permitted(req.socket.remoteAddress || 'unknown')) {
      res.writeHead(429);
      res.end('Too many requests');
      return;
    }
    try {
      const config = await iceConfig(process.env);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
    } catch {
      res.writeHead(503);
      res.end('Connectivity service unavailable');
    }
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 64_000 });
server.on('upgrade', (req, socket, head) => {
  const match = /^\/rooms\/([a-z0-9-]+)$/.exec(
    new URL(req.url || '/', 'http://localhost').pathname,
  );
  if (
    !match ||
    !roomIdSchema.safeParse(match[1]).success ||
    !allowedOrigin(req.headers.origin, origins) ||
    !permitted(req.socket.remoteAddress || 'unknown')
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const roomId = match[1];
    const room = rooms.get(roomId) || new Map<WebSocket, RoomClient>();
    rooms.set(roomId, room);
    let state: Session = { windowStart: Date.now(), messages: 0 };
    const client: RoomClient = {
      id: crypto.randomUUID(),
      read: () => state,
      write: (next) => {
        state = next;
      },
      send: (message) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      },
      close: (code, reason) => ws.close(code, reason),
    };
    room.set(ws, client);
    const joinTimeout = setTimeout(() => {
      if (!state.participant) ws.close(1008, 'Join timeout');
    }, 10_000);
    ws.on('message', (raw, binary) => {
      if (binary) {
        ws.close(1003, 'Text messages only');
        return;
      }
      handleMessage(client, [...room.values()], raw.toString());
    });
    ws.on('close', () => {
      clearTimeout(joinTimeout);
      handleLeave(client, [...room.values()]);
      room.delete(ws);
      if (!room.size) rooms.delete(roomId);
    });
    ws.on('error', () => ws.close());
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30_000);
    ws.on('close', () => clearInterval(heartbeat));
  });
});
server.listen(Number(process.env.PORT || 3001), '0.0.0.0', () =>
  console.log(JSON.stringify({ event: 'listening', port: Number(process.env.PORT || 3001) })),
);
function shutdown() {
  wss.clients.forEach((ws) => ws.close(1012, 'Server restarting'));
  server.close();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
