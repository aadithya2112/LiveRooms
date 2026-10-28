import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../../shared/protocol';
// Exercise both adapters over real network sockets, including the Workers runtime.
for (const port of [3001, 8787]) {
  test(`signaling lifecycle, isolation and capacity on ${port}`, async ({ request }) => {
    const room = crypto.randomUUID();
    const sockets: WebSocket[] = [];
    const inbox = new Map<WebSocket, ServerMessage[]>();
    async function open(roomId = room) {
      const ws = new WebSocket(`ws://localhost:${port}/rooms/${roomId}`, {
        origin: 'http://localhost:5173',
      });
      sockets.push(ws);
      inbox.set(ws, []);
      ws.on('message', (raw) => inbox.get(ws)!.push(JSON.parse(raw.toString())));
      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      return ws;
    }
    const join = (ws: WebSocket, name: string) =>
      ws.send(
        JSON.stringify({ type: 'join', name, media: { audio: true, video: true, sharing: false } }),
      );
    try {
      const a = await open();
      join(a, 'Alex');
      const b = await open();
      join(b, 'Sam');
      await expect
        .poll(() => inbox.get(a)!.find((m) => m.type === 'ready'))
        .toMatchObject({ type: 'ready', initiator: false });
      await expect
        .poll(() => inbox.get(b)!.find((m) => m.type === 'ready'))
        .toMatchObject({ type: 'ready', initiator: true });
      const c = await open();
      join(c, 'Third');
      await expect
        .poll(() => inbox.get(c)!.at(-1))
        .toMatchObject({ type: 'error', code: 'room-full' });
      const isolated = await open(crypto.randomUUID());
      join(isolated, 'Elsewhere');
      const ready = inbox.get(a)!.find((m) => m.type === 'ready');
      if (ready?.type !== 'ready') throw new Error('No session');
      const description = {
        type: 'description',
        session: ready.session,
        description: { type: 'offer', sdp: 'test-offer' },
      };
      b.send(JSON.stringify(description));
      await expect.poll(() => inbox.get(a)!.at(-1)).toEqual(description);
      expect(inbox.get(isolated)!.some((m) => m.type === 'description')).toBe(false);
      b.close();
      await expect.poll(() => inbox.get(a)!.at(-1)).toEqual({ type: 'peer-left' });
      const replacement = await open();
      join(replacement, 'Taylor');
      await expect
        .poll(() => inbox.get(a)!.at(-1))
        .toMatchObject({ type: 'ready', peer: { name: 'Taylor' } });
      const config = await request.get(`http://localhost:${port}/ice`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(config.status()).toBe(200);
      expect(await config.json()).toMatchObject({ relayConfigured: false });
      expect(
        (
          await request.get(`http://localhost:${port}/ice`, {
            headers: { Origin: 'https://evil.test' },
          })
        ).status(),
      ).toBe(403);
    } finally {
      sockets.forEach((s) => s.close());
    }
  });
}
