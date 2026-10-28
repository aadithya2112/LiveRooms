import { z } from 'zod';

export const roomIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{5,63}$/);
export const mediaSchema = z.object({
  audio: z.boolean(),
  video: z.boolean(),
  sharing: z.boolean(),
});
export type MediaState = z.infer<typeof mediaSchema>;
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), name: z.string().trim().min(1).max(40), media: mediaSchema }),
  z.object({
    type: z.literal('description'),
    session: z.string().uuid(),
    description: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(48_000) }),
  }),
  z.object({
    type: z.literal('candidate'),
    session: z.string().uuid(),
    candidate: z.object({
      candidate: z.string().max(4096),
      sdpMid: z.string().nullable().optional(),
      sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
      usernameFragment: z.string().nullable().optional(),
    }),
  }),
  z.object({ type: z.literal('media'), media: mediaSchema }),
  z.object({ type: z.literal('restart'), session: z.string().uuid() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type Participant = { id: string; name: string; media: MediaState };
export type ServerMessage =
  | { type: 'joined'; self: Participant }
  | { type: 'ready'; peer: Participant; session: string; initiator: boolean }
  | Extract<ClientMessage, { type: 'description' | 'candidate' | 'restart' }>
  | { type: 'media'; peer: Participant }
  | { type: 'peer-left' }
  | { type: 'error'; code: 'room-full' | 'invalid-message' | 'rate-limit'; message: string };

export function parseMessage(raw: string): ClientMessage | null {
  if (raw.length > 64_000) return null;
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function parseRoomInput(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (/^https?:\/\//.test(value)) {
    try {
      const url = new URL(value);
      const match = /^\/room\/([^/]+)\/?$/.exec(url.pathname);
      if (!match) return null;
      value = match[1];
    } catch {
      return null;
    }
  }
  return roomIdSchema.safeParse(value).success ? value : null;
}

export function createRoomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) =>
    n.toString(16).padStart(2, '0'),
  )
    .join('')
    .match(/.{1,8}/g)!
    .join('-');
}

// Attachments are serializable so membership and rate limits survive DO hibernation.
export type Session = {
  participant?: Participant;
  session?: string;
  windowStart: number;
  messages: number;
};
export interface RoomClient {
  id: string;
  read(): Session;
  write(session: Session): void;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}
export function handleMessage(
  client: RoomClient,
  clients: RoomClient[],
  raw: string,
  now = Date.now(),
): void {
  const state = client.read();
  if (now - state.windowStart > 10_000) {
    state.windowStart = now;
    state.messages = 0;
  }
  state.messages++;
  client.write(state);
  if (state.messages > 150) {
    client.send({
      type: 'error',
      code: 'rate-limit',
      message: 'Too many messages. Please rejoin in a moment.',
    });
    client.close(1008, 'Rate limit');
    return;
  }
  const message = parseMessage(raw);
  if (!message) {
    client.send({ type: 'error', code: 'invalid-message', message: 'Invalid signaling message.' });
    return;
  }
  const peers = clients.filter((p) => p.id !== client.id && p.read().participant);
  if (message.type === 'join') {
    if (state.participant) return; // Idempotent: duplicate joins never restart negotiation.
    if (peers.length >= 2) {
      client.send({
        type: 'error',
        code: 'room-full',
        message: 'This room already has two people. Try a new room.',
      });
      client.close(1008, 'Room full');
      return;
    }
    state.participant = { id: client.id, name: message.name, media: message.media };
    client.write(state);
    client.send({ type: 'joined', self: state.participant });
    if (peers[0]) {
      const session = crypto.randomUUID();
      state.session = session;
      client.write(state);
      const peer = peers[0];
      const peerState = peer.read();
      peerState.session = session;
      peer.write(peerState);
      peer.send({ type: 'ready', peer: state.participant, session, initiator: false });
      client.send({ type: 'ready', peer: peerState.participant!, session, initiator: true });
    }
    return;
  }
  if (!state.participant) return;
  if (message.type === 'media') {
    state.participant.media = message.media;
    client.write(state);
    peers.forEach((peer) => peer.send({ type: 'media', peer: state.participant! }));
  } else if (message.session === state.session) {
    peers
      .filter((peer) => peer.read().session === message.session)
      .forEach((peer) => peer.send(message));
  }
}
export function handleLeave(client: RoomClient, clients: RoomClient[]): void {
  if (!client.read().participant) return;
  for (const peer of clients.filter((p) => p.id !== client.id && p.read().participant)) {
    const state = peer.read();
    state.session = undefined;
    peer.write(state);
    peer.send({ type: 'peer-left' });
  }
}
