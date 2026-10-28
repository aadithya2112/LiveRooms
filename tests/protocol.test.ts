import { describe, expect, it, vi } from 'vitest';
import {
  createRoomId,
  handleLeave,
  handleMessage,
  parseMessage,
  parseRoomInput,
  type RoomClient,
  type ServerMessage,
  type Session,
} from '../shared/protocol';
import { allowedOrigin, iceConfig } from '../shared/ice';
const media = { audio: true, video: true, sharing: false };
function client(id: string) {
  let state: Session = { windowStart: Date.now(), messages: 0 };
  const messages: ServerMessage[] = [];
  return {
    id,
    read: () => state,
    write: (next: Session) => {
      state = structuredClone(next);
    },
    send: (message: ServerMessage) => messages.push(message),
    close: vi.fn(),
    messages,
  } satisfies RoomClient & { messages: ServerMessage[] };
}
function join(c: RoomClient, all: RoomClient[], name = c.id) {
  handleMessage(c, all, JSON.stringify({ type: 'join', name, media }));
}
describe('room identity and input', () => {
  it('generates unpredictable room IDs and accepts complete invitation links', () => {
    const ids = new Set(Array.from({ length: 100 }, createRoomId));
    expect(ids.size).toBe(100);
    for (const id of ids)
      expect(parseRoomInput(`https://example.com/room/${id}?from=invite`)).toBe(id);
    expect(parseRoomInput('  ABCDEF-123456  ')).toBe('abcdef-123456');
  });
  it.each([
    '',
    'abc',
    '../admin',
    'room/abc123',
    'https://site.test/other/abc123',
    'https://site.test/room/abc123/extra',
    'abc123<script>',
  ])('rejects unsafe room input %s', (input) => expect(parseRoomInput(input)).toBeNull());
  it('rejects malformed, oversized and unknown signaling payloads', () => {
    expect(parseMessage('{')).toBeNull();
    expect(parseMessage('x'.repeat(64001))).toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'join', name: 'a'.repeat(41), media }))).toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'admin' }))).toBeNull();
    expect(
      parseMessage(
        JSON.stringify({
          type: 'candidate',
          session: crypto.randomUUID(),
          candidate: { candidate: 'candidate', usernameFragment: null },
        }),
      ),
    ).not.toBeNull();
  });
});
describe('two-person room lifecycle', () => {
  it('assigns exactly one initiator and rejects the third participant explicitly', () => {
    const a = client('a'),
      b = client('b'),
      c = client('c'),
      all = [a, b, c];
    join(a, all);
    join(b, all);
    join(c, all);
    expect(a.messages.at(-1)).toMatchObject({
      type: 'ready',
      initiator: false,
      peer: { name: 'b' },
    });
    expect(b.messages.at(-1)).toMatchObject({
      type: 'ready',
      initiator: true,
      peer: { name: 'a' },
    });
    expect(a.read().session).toBe(b.read().session);
    expect(c.messages.at(-1)).toMatchObject({ type: 'error', code: 'room-full' });
    expect(c.close).toHaveBeenCalled();
  });
  it('makes joins idempotent and ignores signaling from unjoined clients or stale sessions', () => {
    const a = client('a'),
      b = client('b'),
      c = client('c'),
      all = [a, b, c];
    join(a, all);
    join(b, all);
    const session = a.read().session!;
    const count = b.messages.length;
    join(a, all);
    expect(b.messages.length).toBe(count);
    const offer = { type: 'description', session, description: { type: 'offer', sdp: 'test' } };
    handleMessage(c, all, JSON.stringify(offer));
    expect(b.messages.length).toBe(count);
    handleMessage(a, all, JSON.stringify({ ...offer, session: crypto.randomUUID() }));
    expect(b.messages.length).toBe(count);
    handleMessage(a, all, JSON.stringify(offer));
    expect(b.messages.at(-1)).toEqual(offer);
  });
  it('allows a replacement peer and invalidates negotiation after a departure', () => {
    const a = client('a'),
      b = client('b'),
      c = client('c');
    join(a, [a, b]);
    join(b, [a, b]);
    const oldSession = a.read().session;
    handleLeave(b, [a, b]);
    expect(a.messages.at(-1)).toEqual({ type: 'peer-left' });
    expect(a.read().session).toBeUndefined();
    join(c, [a, c]);
    expect(a.read().session).not.toBe(oldSession);
    expect(c.read().session).toBe(a.read().session);
    handleMessage(c, [a, c], JSON.stringify({ type: 'media', media: { ...media, sharing: true } }));
    expect(a.messages.at(-1)).toMatchObject({ type: 'media', peer: { media: { sharing: true } } });
  });
  it('bounds per-client messages and resets the rate window', () => {
    const a = client('a');
    const now = Date.now();
    for (let i = 0; i < 151; i++) handleMessage(a, [a], '{}', now);
    expect(a.close).toHaveBeenCalledWith(1008, 'Rate limit');
    handleMessage(a, [a], JSON.stringify({ type: 'join', name: 'a', media }), now + 10001);
    expect(a.read().participant?.name).toBe('a');
  });
});
describe('connectivity configuration', () => {
  it('does not issue TURN credentials when explicitly disabled, even if credentials exist', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    expect(
      await iceConfig({ TURN_ENABLED: 'false', TURN_KEY_ID: 'key', TURN_API_TOKEN: 'secret' }),
    ).toMatchObject({ relayConfigured: false });
    expect(request).not.toHaveBeenCalled();
  });

  it('checks exact origins and never allows arbitrary sites', () => {
    expect(allowedOrigin('http://localhost:5173', 'https://app.test, http://localhost:5173')).toBe(
      true,
    );
    expect(allowedOrigin('https://app.test.evil.test', 'https://app.test')).toBe(false);
    expect(allowedOrigin(null, '*')).toBe(false);
  });
  it('clearly reports a missing TURN configuration', async () =>
    expect(await iceConfig({})).toMatchObject({ relayConfigured: false }));
  it('generates expiring credentials on the server and does not expose the API token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        iceServers: [{ urls: 'turn:relay.test', username: 'temporary', credential: 'temporary' }],
      }),
    );
    const config = await iceConfig({ TURN_KEY_ID: 'key', TURN_API_TOKEN: 'secret' });
    expect(config.relayConfigured).toBe(true);
    expect(JSON.stringify(config)).not.toContain('secret');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/key/credentials/generate-ice-servers'),
      expect.objectContaining({ body: '{"ttl":3600}' }),
    );
  });
  it('fails explicitly when the TURN service fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    await expect(iceConfig({ TURN_KEY_ID: 'key', TURN_API_TOKEN: 'secret' })).rejects.toThrow(
      'unavailable',
    );
  });
});
