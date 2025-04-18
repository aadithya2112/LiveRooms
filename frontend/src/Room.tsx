import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";

// Define types for socket events
interface ServerToClientEvents {
  ready: () => void;
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  "ice-candidate": (candidate: RTCIceCandidateInit) => void;
  peer_disconnected: () => void;
}

interface ClientToServerEvents {
  join: (roomId: string) => void;
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  "ice-candidate": (candidate: RTCIceCandidateInit) => void;
}

// --- Socket Connection ---
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  import.meta.env.VITE_SIGNALLING_SERVER_URL || "http://localhost:3000"
);

// STUN server config
const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
};

// --- The Room Component ---
export default function Room() {
  // --- Hooks ---
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  // --- State & Refs ---
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isPeerConnected, setIsPeerConnected] = useState(false);

  const videoElement1 = useRef<HTMLVideoElement>(null);
  const videoElement2 = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  // --- Ref for Queueing ICE Candidates ---
  const queuedIceCandidates = useRef<RTCIceCandidateInit[]>([]);

  // --- Helper Function to Process Queued ICE Candidates ---
  const processQueuedCandidates = useCallback(async () => {
    if (!peerConnection.current || !peerConnection.current.remoteDescription) {
      // Should not happen if called correctly, but safety check
      console.warn(
        `[${roomId}] Attempted to process queue but remote description still null.`
      );
      return;
    }

    if (queuedIceCandidates.current.length > 0) {
      console.log(
        `[${roomId}] Processing ${queuedIceCandidates.current.length} queued ICE candidates...`
      );
      const candidatesToProcess = [...queuedIceCandidates.current]; // Copy queue
      queuedIceCandidates.current = []; // Clear original queue immediately

      for (const queuedCandidate of candidatesToProcess) {
        if (
          peerConnection.current?.remoteDescription &&
          peerConnection.current.signalingState !== "closed"
        ) {
          try {
            await peerConnection.current.addIceCandidate(
              new RTCIceCandidate(queuedCandidate)
            );
            console.log(`[${roomId}] Added queued ICE candidate.`);
          } catch (error: any) {
            // Log non-benign errors
            if (
              !error.message.includes(
                "The RTCPeerConnection's signalingState is 'closed'"
              )
            ) {
              console.error(
                `[${roomId}] Error adding QUEUED ICE candidate:`,
                error
              );
            } else {
              console.log(
                `[${roomId}] Attempted to add QUEUED ICE candidate to closed connection. Ignoring.`
              );
            }
          }
        } else {
          console.warn(
            `[${roomId}] Could not process queued candidate, state changed. State: ${
              peerConnection.current?.signalingState
            }, RemoteDesc: ${!!peerConnection.current?.remoteDescription}`
          );
          // Optionally re-queue if state is temporarily wrong, but usually indicates a bigger issue
          // queuedIceCandidates.current.push(queuedCandidate);
        }
      }
    }
  }, [roomId]); // roomId dependency for logging

  // --- WebRTC Callbacks (Offer/Answer) ---
  const createOffer = useCallback(async () => {
    if (!peerConnection.current || !roomId) return;
    console.log(`[${roomId}] Creating offer...`);
    try {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      console.log(`[${roomId}] Offer created and set locally`);
      socket.emit("offer", offer);
    } catch (error) {
      console.error(`[${roomId}] Error creating offer:`, error);
    }
  }, [roomId]);

  const createAnswer = useCallback(
    async (offer: RTCSessionDescriptionInit) => {
      if (!peerConnection.current || !roomId) return;
      console.log(`[${roomId}] Received offer, creating answer...`);
      try {
        // --- Set Remote Description (Offer) ---
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(offer)
        );
        console.log(`[${roomId}] Remote description (offer) set`);

        // --- Process any queued candidates NOW ---
        await processQueuedCandidates();

        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        console.log(`[${roomId}] Answer created and set locally`);
        socket.emit("answer", answer);
      } catch (error) {
        console.error(`[${roomId}] Error creating answer:`, error);
      }
    },
    [roomId, processQueuedCandidates] // Add processQueuedCandidates dependency
  );

  // --- Effect 1: Get User Media & Join Room ---
  useEffect(() => {
    if (!roomId) {
      console.error("No Room ID provided!");
      navigate("/");
      return;
    }

    let didCancel = false;

    const startVideo = async () => {
      console.log(`[${roomId}] Requesting user media...`);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (didCancel) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        console.log(`[${roomId}] Media stream obtained`);
        setLocalStream(stream);
        if (videoElement1.current) {
          videoElement1.current.srcObject = stream;
        }
        console.log(`[${roomId}] Joining room via signaling server...`);
        socket.connect();
        socket.emit("join", roomId);
      } catch (error) {
        console.error(`[${roomId}] Error accessing webcam/microphone:`, error);
        navigate("/");
      }
    };

    startVideo();

    // --- Cleanup Function ---
    return () => {
      didCancel = true;
      console.log(`[${roomId}] Cleaning up Room component.`);
      localStream?.getTracks().forEach((track) => track.stop());
      peerConnection.current?.close();
      peerConnection.current = null;
      if (socket.connected) {
        socket.disconnect();
      }
      setLocalStream(null);
      setRemoteStream(null);
      setIsPeerConnected(false);
      queuedIceCandidates.current = []; // Clear queue on cleanup
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, navigate]);

  // --- Effect 2: Setup Peer Connection & Socket Listeners ---
  useEffect(() => {
    if (!localStream || !roomId) {
      return;
    }

    console.log(`[${roomId}] Setting up PeerConnection and listeners.`);
    peerConnection.current = new RTCPeerConnection(servers);
    setIsPeerConnected(false);
    queuedIceCandidates.current = []; // Ensure queue is clear on new setup

    localStream.getTracks().forEach((track) => {
      console.log(`[${roomId}] Adding local track:`, track.kind);
      peerConnection.current?.addTrack(track, localStream);
    });

    const newRemoteStream = new MediaStream();
    setRemoteStream(newRemoteStream);
    if (videoElement2.current) {
      videoElement2.current.srcObject = newRemoteStream;
    }

    peerConnection.current.onconnectionstatechange = () => {
      if (peerConnection.current) {
        console.log(
          `[${roomId}] Peer Connection State: ${peerConnection.current.connectionState}`
        );
        setIsPeerConnected(
          peerConnection.current.connectionState === "connected"
        );
      }
    };

    peerConnection.current.ontrack = (event: RTCTrackEvent) => {
      console.log(`[${roomId}] Remote track received:`, event.track.kind);
      event.streams[0].getTracks().forEach((track) => {
        console.log(
          `[${roomId}] Adding remote track to remote stream:`,
          track.kind
        );
        newRemoteStream.addTrack(track);
      });
    };

    peerConnection.current.onicecandidate = (
      event: RTCPeerConnectionIceEvent
    ) => {
      if (event.candidate) {
        console.log(`[${roomId}] Sending ICE candidate`);
        socket.emit("ice-candidate", event.candidate);
      }
    };

    // --- Socket Event Listeners ---

    // --- Modified handleIceCandidate ---
    const handleIceCandidate = async (candidateInit: RTCIceCandidateInit) => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState === "closed"
      ) {
        console.log(
          `[${roomId}] Ignoring ICE candidate, PC not ready or closed.`
        );
        return;
      }

      // If remote description isn't set, queue the candidate
      if (!peerConnection.current.remoteDescription) {
        console.warn(
          `[${roomId}] Received ICE candidate but remote description is not set yet. Queueing.`
        );
        queuedIceCandidates.current.push(candidateInit);
        return;
      }

      // If remote description IS set, process the current candidate directly
      try {
        console.log(`[${roomId}] Adding received ICE candidate immediately.`);
        await peerConnection.current.addIceCandidate(
          new RTCIceCandidate(candidateInit)
        );
        // Note: We now process the queue *only* after setRemoteDescription succeeds
        // So, no need to call processQueuedCandidates() here.
      } catch (error: any) {
        if (
          !error.message.includes(
            "The RTCPeerConnection's signalingState is 'closed'"
          )
        ) {
          console.error(
            `[${roomId}] Error adding received ICE candidate:`,
            error
          );
        } else {
          console.log(
            `[${roomId}] Attempted to add ICE candidate to closed connection. Ignoring.`
          );
        }
      }
    };

    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState !== "stable"
      ) {
        console.warn(
          `[${roomId}] Received offer but signaling state is ${peerConnection.current?.signalingState}. Potentially ignoring.`
        );
        return;
      }
      // createAnswer now handles setRemoteDescription and processing the queue
      await createAnswer(offer);
    };

    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState !== "have-local-offer"
      ) {
        console.warn(
          `[${roomId}] Received answer but signaling state is ${peerConnection.current?.signalingState}. Ignoring.`
        );
        return;
      }
      try {
        console.log(`[${roomId}] Received answer, setting remote description.`);
        // --- Set Remote Description (Answer) ---
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
        console.log(`[${roomId}] Remote description (answer) set`);

        // --- Process any queued candidates NOW ---
        await processQueuedCandidates();
      } catch (error) {
        console.error(
          `[${roomId}] Error setting remote description (answer):`,
          error
        );
      }
    };

    const handleReady = async () => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState !== "stable"
      ) {
        console.log(
          `[${roomId}] Received 'ready' but signaling state is ${peerConnection.current?.signalingState}. Not creating offer.`
        );
        return;
      }
      console.log(`[${roomId}] Received 'ready' signal, creating offer...`);
      await createOffer();
    };

    const handlePeerDisconnected = () => {
      console.log(`[${roomId}] Peer disconnected signal received.`);
      setRemoteStream(new MediaStream());
      if (videoElement2.current) {
        videoElement2.current.srcObject = null;
      }
      setIsPeerConnected(false);
      peerConnection.current?.close();
      peerConnection.current = null;
      queuedIceCandidates.current = []; // Clear queue
      console.warn(
        `[${roomId}] Peer connection closed due to peer disconnect signal.`
      );
    };

    // Attach listeners
    socket.on("ice-candidate", handleIceCandidate);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ready", handleReady);
    socket.on("peer_disconnected", handlePeerDisconnected);

    // Cleanup listeners
    return () => {
      console.log(
        `[${roomId}] Cleaning up PeerConnection setup effect listeners.`
      );
      socket.off("ice-candidate", handleIceCandidate);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ready", handleReady);
      socket.off("peer_disconnected", handlePeerDisconnected);
    };
    // Add processQueuedCandidates to dependency array if it wasn't stable (it is due to useCallback with roomId)
  }, [localStream, roomId, createOffer, createAnswer, processQueuedCandidates]);

  // --- Render Logic ---
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <header className="p-4 bg-gray-800 text-center">
        <h1 className="text-xl font-semibold">Room: {roomId}</h1>
        <p
          className={`text-sm ${
            isPeerConnected ? "text-green-400" : "text-yellow-400"
          }`}
        >
          Status: {isPeerConnected ? "Connected" : "Waiting for peer..."}
        </p>
      </header>
      <main className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4 p-4 overflow-hidden">
        {/* Local Video */}
        <div className="bg-black rounded-lg overflow-hidden relative">
          <video
            ref={videoElement1}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
            muted
          />
          <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded text-xs">
            Local
          </div>
        </div>
        {/* Remote Video */}
        <div className="bg-black rounded-lg overflow-hidden relative">
          <video
            ref={videoElement2}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
          />
          <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded text-xs">
            Remote
          </div>
          {!isPeerConnected && !remoteStream?.getTracks().length && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              Waiting for peer to connect...
            </div>
          )}
        </div>
      </main>
      <footer className="p-2 bg-gray-800 text-center">
        <button
          onClick={() => navigate("/")}
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm"
        >
          Leave Room
        </button>
      </footer>
    </div>
  );
}
