import { useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  MediaState,
  Participant,
  ServerMessage,
} from '../../../shared/protocol';
import { signalingUrl } from '../config';

type Status =
  'joining' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'full';
export function useCall(
  roomId: string,
  name: string,
  joined: boolean,
  stream: MediaStream | null,
  media: MediaState,
) {
  const [status, setStatus] = useState<Status>('joining');
  const [error, setError] = useState('');
  const [peer, setPeer] = useState<Participant | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [relayConfigured, setRelayConfigured] = useState(false);
  const [connectionType, setConnectionType] = useState('Checking connection');
  const [roundTrip, setRoundTrip] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef(stream);
  const mediaRef = useRef(media);
  useEffect(() => {
    streamRef.current = stream;
    mediaRef.current = media;
  });
  const { audio, video, sharing } = media;
  useEffect(() => {
    const pc = pcRef.current;
    if (pc)
      for (const transceiver of pc.getTransceivers()) {
        const track =
          stream?.getTracks().find((t) => t.kind === transceiver.receiver.track.kind) || null;
        void transceiver.sender
          .replaceTrack(track)
          .catch(() => setError('Device switch failed. Rejoin to restore your media.'));
      }
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'media', media: { audio, video, sharing } }));
  }, [stream, audio, video, sharing]); // primitive media values prevent unnecessary messages
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let connectionTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    let terminal = false;
    let session = '';
    let initiator = false;
    let candidates: RTCIceCandidateInit[] = [];
    let iceServers: RTCIceServer[] = [];
    let restarting = false;
    const abort = new AbortController();
    const send = (message: ClientMessage) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const resetPeer = () => {
      clearTimeout(connectionTimer);
      session = '';
      candidates = [];
      pcRef.current?.getReceivers().forEach((receiver) => receiver.track.stop());
      pcRef.current?.close();
      pcRef.current = null;
      setRemoteStream(null);
      setPeer(null);
      setRoundTrip(null);
      setConnectionType('Checking connection');
    };
    const fail = (message: string) => {
      if (!cancelled) {
        setError(message);
        setStatus('error');
      }
    };
    const offer = async (pc: RTCPeerConnection, iceRestart = false) => {
      if (pc !== pcRef.current || pc.signalingState !== 'stable') return;
      const description = await pc.createOffer({ iceRestart });
      if (pc !== pcRef.current || cancelled) return;
      await pc.setLocalDescription(description);
      send({ type: 'description', session, description: { type: 'offer', sdp: description.sdp! } });
    };
    const restart = async () => {
      if (restarting || !session || !pcRef.current) return;
      restarting = true;
      setStatus('reconnecting');
      if (initiator) await offer(pcRef.current, true);
      else send({ type: 'restart', session });
      clearTimeout(connectionTimer);
      connectionTimer = setTimeout(() => {
        restarting = false;
        fail('The call could not reconnect. Please rejoin the room.');
      }, 20_000);
    };
    const handle = async (message: ServerMessage) => {
      if (cancelled) return;
      if (message.type === 'error') {
        setError(message.message);
        setStatus(message.code === 'room-full' ? 'full' : 'error');
        if (message.code === 'room-full' || message.code === 'rate-limit') {
          retries = 5;
          terminal = true;
          socket?.close();
        }
        return;
      }
      if (message.type === 'joined') {
        clearTimeout(connectTimer);
        retries = 0;
        setError('');
        setStatus('waiting');
        return;
      }
      if (message.type === 'peer-left') {
        resetPeer();
        setStatus('waiting');
        return;
      }
      if (message.type === 'media') {
        setPeer(message.peer);
        return;
      }
      if (message.type === 'ready') {
        resetPeer();
        session = message.session;
        initiator = message.initiator;
        restarting = false;
        setPeer(message.peer);
        setStatus('connecting');
        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;
        const remote = new MediaStream();
        setRemoteStream(remote);
        pc.ontrack = (event) => {
          remote.addTrack(event.track);
          setRemoteStream(new MediaStream(remote.getTracks()));
        };
        pc.onicecandidate = (event) => {
          if (event.candidate && pc === pcRef.current)
            send({
              type: 'candidate',
              session,
              candidate: event.candidate.toJSON() as RTCIceCandidateInit & { candidate: string },
            });
        };
        pc.onconnectionstatechange = () => {
          if (pc !== pcRef.current || cancelled) return;
          if (pc.connectionState === 'connected') {
            restarting = false;
            clearTimeout(connectionTimer);
            setStatus('connected');
            setError('');
          }
          if (pc.connectionState === 'failed')
            void restart().catch(() => fail('Connection recovery failed. Please rejoin.'));
          if (pc.connectionState === 'disconnected') {
            setStatus('reconnecting');
            clearTimeout(connectionTimer);
            connectionTimer = setTimeout(() => {
              void restart().catch(() => fail('Connection recovery failed.'));
            }, 4000);
          }
        };
        const tracks = streamRef.current?.getTracks() || [];
        await Promise.all(
          ['audio', 'video'].map(async (kind) => {
            const transceiver = pc.addTransceiver(kind, { direction: 'sendrecv' });
            await transceiver.sender.replaceTrack(tracks.find((t) => t.kind === kind) || null);
          }),
        );
        connectionTimer = setTimeout(() => {
          void restart().catch(() => fail('Could not connect. Please rejoin.'));
        }, 20_000);
        if (initiator) await offer(pc);
        return;
      }
      if (message.session !== session) return;
      const pc = pcRef.current;
      if (!pc) return;
      if (message.type === 'restart') {
        if (initiator) await offer(pc, true);
        return;
      }
      if (message.type === 'description') {
        await pc.setRemoteDescription(message.description);
        if (pc !== pcRef.current) return;
        for (const candidate of candidates.splice(0)) await pc.addIceCandidate(candidate);
        if (message.description.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (pc === pcRef.current)
            send({
              type: 'description',
              session,
              description: { type: 'answer', sdp: answer.sdp! },
            });
        }
      }
      if (message.type === 'candidate') {
        if (pc.remoteDescription) await pc.addIceCandidate(message.candidate);
        else candidates.push(message.candidate);
      }
    };
    const connect = () => {
      if (cancelled) return;
      setStatus(retries ? 'reconnecting' : 'joining');
      socket = new WebSocket(`${signalingUrl.replace(/^http/, 'ws')}/rooms/${roomId}`);
      wsRef.current = socket;
      connectTimer = setTimeout(() => {
        socket?.close();
      }, 12_000);
      socket.onopen = () => send({ type: 'join', name, media: mediaRef.current });
      // Serialize async SDP processing; an answer must never overtake setting an offer.
      let queue = Promise.resolve();
      socket.onmessage = (event) => {
        queue = queue
          .then(async () => {
            if (!cancelled) await handle(JSON.parse(event.data) as ServerMessage);
          })
          .catch(() => {
            if (!cancelled) fail('Call setup failed. Check your connection and rejoin.');
          });
      };
      socket.onclose = (event) => {
        clearTimeout(connectTimer);
        resetPeer();
        if (cancelled || terminal) return;
        if (event.code === 1008) {
          fail('The server closed this session. Please rejoin.');
          return;
        }
        if (retries >= 5) {
          fail('The room server is unavailable. Please try rejoining.');
          return;
        }
        setStatus('reconnecting');
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retries++, 10_000));
      };
    };
    setError('');
    void (async () => {
      try {
        if (!signalingUrl) throw new Error('missing-config');
        const response = await fetch(`${signalingUrl}/ice`, {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error('ice-config');
        const config = (await response.json()) as {
          iceServers: RTCIceServer[];
          relayConfigured: boolean;
        };
        if (cancelled) return;
        iceServers = config.iceServers;
        setRelayConfigured(config.relayConfigured);
        connect();
      } catch {
        if (!cancelled)
          fail(
            signalingUrl
              ? 'Could not reach the room server. Check your connection and try again.'
              : 'The signaling server has not been configured for this deployment.',
          );
      }
    })();
    const stats = setInterval(() => {
      const pc = pcRef.current;
      if (!pc || pc.connectionState !== 'connected') return;
      void pc
        .getStats()
        .then((report) => {
          if (cancelled || pc !== pcRef.current) return;
          report.forEach((item) => {
            if (item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated) {
              setRoundTrip(
                typeof item.currentRoundTripTime === 'number'
                  ? Math.round(item.currentRoundTripTime * 1000)
                  : null,
              );
              const local = report.get(item.localCandidateId);
              const remote = report.get(item.remoteCandidateId);
              setConnectionType(
                local?.candidateType === 'relay' || remote?.candidateType === 'relay'
                  ? 'TURN relay'
                  : 'Direct peer-to-peer',
              );
            }
          });
        })
        .catch(() => {});
    }, 3000);
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(retryTimer);
      clearTimeout(connectTimer);
      clearTimeout(connectionTimer);
      clearInterval(stats);
      socket?.close();
      wsRef.current = null;
      pcRef.current?.getReceivers().forEach((receiver) => receiver.track.stop());
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [roomId, name, joined, attempt]);
  return {
    status,
    error,
    peer,
    remoteStream,
    relayConfigured,
    connectionType,
    roundTrip,
    retry: () => setAttempt((n) => n + 1),
  };
}
