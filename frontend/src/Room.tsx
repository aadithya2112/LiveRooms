import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { VITE_SIGNALLING_SERVER_URL } from "../config"; // Adjust the import based on your project structure

// --- Shadcn UI Imports ---
// Adjust the import path based on your project structure
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// --- End Shadcn UI Imports ---

// Define types for socket events
interface ServerToClientEvents {
  initiate_offer: () => void;
  peer_ready: () => void;
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
  VITE_SIGNALLING_SERVER_URL || "http://localhost:3000",
  { autoConnect: false } // Start disconnected
);

// STUN server config
const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

// --- The Room Component ---
export default function Room() {
  console.log("Server ", VITE_SIGNALLING_SERVER_URL);
  // --- Hooks ---
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  // --- State & Refs ---
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isPeerConnected, setIsPeerConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>(
    "Waiting for peer..."
  );

  const videoElement1 = useRef<HTMLVideoElement>(null);
  const videoElement2 = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const queuedIceCandidates = useRef<RTCIceCandidateInit[]>([]);
  const isSignalingSetup = useRef(false);

  // --- Helper Function to Process Queued ICE Candidates ---
  const processQueuedCandidates = useCallback(async () => {
    // ... (keep existing logic)
    if (!peerConnection.current || !peerConnection.current.remoteDescription) {
      return;
    }
    if (queuedIceCandidates.current.length > 0) {
      console.log(
        `[${roomId}] Processing ${queuedIceCandidates.current.length} queued ICE candidates...`
      );
      const candidatesToProcess = [...queuedIceCandidates.current];
      queuedIceCandidates.current = [];
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
            if (
              !error.message.includes("closed") &&
              !error.message.includes("candidate cannot be added")
            ) {
              console.error(
                `[${roomId}] Error adding QUEUED ICE candidate:`,
                error
              );
            } else {
              console.log(
                `[${roomId}] Ignored adding QUEUED ICE candidate to closed/invalid state connection.`
              );
            }
          }
        } else {
          console.warn(
            `[${roomId}] Could not process queued candidate, state changed. State: ${
              peerConnection.current?.signalingState
            }, RemoteDesc: ${!!peerConnection.current?.remoteDescription}.`
          );
        }
      }
    }
  }, [roomId]);

  // --- WebRTC Callbacks (Offer/Answer) ---
  const createOffer = useCallback(async () => {
    // ... (keep existing logic)
    if (
      !peerConnection.current ||
      !roomId ||
      peerConnection.current.signalingState !== "stable"
    ) {
      console.log(
        `[${roomId}] createOffer called in non-stable state (${peerConnection.current?.signalingState}) or PC null. Aborting.`
      );
      return;
    }
    console.log(`[${roomId}] Creating offer...`);
    setConnectionStatus("Creating offer...");
    try {
      const offer = await peerConnection.current.createOffer();
      if (peerConnection.current.signalingState !== "stable") {
        console.warn(
          `[${roomId}] State changed to ${peerConnection.current.signalingState} before setLocalDescription in createOffer. Aborting offer.`
        );
        return;
      }
      await peerConnection.current.setLocalDescription(offer);
      console.log(
        `[${roomId}] Offer created and set locally. State: ${peerConnection.current.signalingState}. Sending...`
      );
      socket.emit("offer", offer);
    } catch (error) {
      console.error(`[${roomId}] Error creating offer:`, error);
      setConnectionStatus("Error creating offer");
    }
  }, [roomId]);

  const createAnswer = useCallback(
    async (offer: RTCSessionDescriptionInit) => {
      // ... (keep existing logic)
      if (!peerConnection.current || !roomId) return;

      const currentState = peerConnection.current.signalingState;
      if (
        currentState !== "stable" &&
        currentState !== "have-remote-offer" &&
        currentState !== "have-local-offer"
      ) {
        console.warn(
          `[${roomId}] createAnswer called in unexpected state: ${currentState}. Ignoring offer.`
        );
        return;
      }

      console.log(
        `[${roomId}] Received offer, attempting to create answer... Current State: ${currentState}`
      );
      setConnectionStatus("Received offer, creating answer...");
      try {
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(offer)
        );
        console.log(
          `[${roomId}] Remote description (offer) set. New state: ${peerConnection.current.signalingState}`
        );

        await processQueuedCandidates();

        if (peerConnection.current.signalingState === "have-remote-offer") {
          const answer = await peerConnection.current.createAnswer();
          await peerConnection.current.setLocalDescription(answer);
          console.log(
            `[${roomId}] Answer created and set locally. New state: ${peerConnection.current.signalingState}. Sending...`
          );
          socket.emit("answer", answer);
        } else {
          console.warn(
            `[${roomId}] State after setting remote description was not 'have-remote-offer' (${peerConnection.current.signalingState}). Cannot create answer.`
          );
        }
      } catch (error) {
        console.error(`[${roomId}] Error in createAnswer:`, error);
        setConnectionStatus("Error handling offer");
      }
    },
    [roomId, processQueuedCandidates]
  );

  // --- Effect 1: Get User Media & Join Room ---
  useEffect(() => {
    // ... (keep existing logic, only UI related cleanup is adjusted below)
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

        console.log(`[${roomId}] Connecting signaling server...`);
        socket.connect();

        socket.on("connect", () => {
          if (didCancel) return;
          console.log(
            `[${roomId}] Socket connected (${socket.id}), emitting join.`
          );
          socket.emit("join", roomId);
          setConnectionStatus("Signaling connected, waiting for peer...");
        });

        socket.on("disconnect", (reason) => {
          console.warn(`[${roomId}] Socket disconnected: ${reason}`);
          setConnectionStatus("Signaling server disconnected");
        });

        socket.on("connect_error", (error) => {
          console.error(`[${roomId}] Socket connection error:`, error);
          setConnectionStatus("Signaling connection error");
          navigate("/");
        });
      } catch (error) {
        console.error(`[${roomId}] Error accessing webcam/microphone:`, error);
        setConnectionStatus("Media access denied");
        navigate("/");
      }
    };

    startVideo();

    return () => {
      didCancel = true;
      console.log(`[${roomId}] Cleaning up Room component.`);

      if (peerConnection.current) {
        console.log(`[${roomId}] Closing PeerConnection.`);
        peerConnection.current.close();
        peerConnection.current = null;
      }

      localStream?.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
      console.log(`[${roomId}] Local stream stopped.`);

      if (socket.connected) {
        console.log(`[${roomId}] Disconnecting socket.`);
        socket.disconnect();
      }
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");

      setRemoteStream(null);
      setIsPeerConnected(false);
      queuedIceCandidates.current = [];
      isSignalingSetup.current = false;
      console.log(`[${roomId}] Room cleanup finished.`);
    };
  }, [roomId, navigate]);

  // --- Effect 2: Setup Peer Connection & Socket Listeners ---
  useEffect(() => {
    // ... (keep existing logic, only UI related cleanup/listeners are adjusted below)
    if (!localStream || !roomId || isSignalingSetup.current) {
      return;
    }

    if (
      peerConnection.current &&
      peerConnection.current.connectionState !== "closed"
    ) {
      console.log(
        `[${roomId}] PeerConnection already exists and is not closed. Skipping setup.`
      );
      return;
    }

    console.log(
      `[${roomId}] Setting up PeerConnection and signaling listeners.`
    );
    peerConnection.current = new RTCPeerConnection(servers);
    setIsPeerConnected(false);
    queuedIceCandidates.current = [];

    localStream.getTracks().forEach((track) => {
      try {
        console.log(`[${roomId}] Adding local track:`, track.kind);
        peerConnection.current?.addTrack(track, localStream);
      } catch (error) {
        console.error(
          `[${roomId}] Error adding local track (${track.kind}):`,
          error
        );
      }
    });

    const newRemoteStream = new MediaStream();
    setRemoteStream(newRemoteStream);
    if (videoElement2.current) {
      videoElement2.current.srcObject = newRemoteStream;
    } else {
      setTimeout(() => {
        if (videoElement2.current) {
          videoElement2.current.srcObject = newRemoteStream;
        }
      }, 100);
    }

    peerConnection.current.onconnectionstatechange = () => {
      if (peerConnection.current) {
        const newState = peerConnection.current.connectionState;
        console.log(`[${roomId}] Peer Connection State Changed: ${newState}`);
        setConnectionStatus(`Connection: ${newState}`);
        setIsPeerConnected(newState === "connected");
        if (
          newState === "failed" ||
          newState === "disconnected" ||
          newState === "closed"
        ) {
          if (newState === "failed") {
            console.error(
              `[${roomId}] Peer Connection Failed! Attempting ICE restart...`
            );
            setConnectionStatus("Connection failed");
          }
          if (newState === "disconnected") {
            setConnectionStatus("Peer disconnected");
          }
          if (newState === "closed") {
            setConnectionStatus("Connection closed");
            if (videoElement2.current?.srcObject)
              videoElement2.current.srcObject = null;
            setRemoteStream(null);
          }
          setIsPeerConnected(false);
        } else if (newState === "connecting") {
          setConnectionStatus("Connecting...");
        }
      }
    };

    peerConnection.current.ontrack = (event: RTCTrackEvent) => {
      console.log(`[${roomId}] Remote track received:`, event.track.kind);
      event.streams[0].getTracks().forEach((track) => {
        if (!newRemoteStream.getTrackById(track.id)) {
          console.log(
            `[${roomId}] Adding remote track (${track.kind}) to remote stream.`
          );
          newRemoteStream.addTrack(track);
        } else {
          console.log(
            `[${roomId}] Track ${track.id} (${track.kind}) already in remote stream.`
          );
        }
      });
      if (
        videoElement2.current &&
        videoElement2.current.srcObject !== newRemoteStream
      ) {
        videoElement2.current.srcObject = newRemoteStream;
      }
    };

    peerConnection.current.onicecandidate = (
      event: RTCPeerConnectionIceEvent
    ) => {
      if (
        event.candidate &&
        peerConnection.current?.signalingState !== "closed"
      ) {
        console.log(`[${roomId}] Sending ICE candidate`);
        socket.emit("ice-candidate", event.candidate);
      }
    };

    peerConnection.current.onicecandidateerror = (event: Event) => {
      const iceErrorEvent = event as RTCPeerConnectionIceErrorEvent;
      console.error(
        `[${roomId}] ICE Candidate Error: Code ${iceErrorEvent.errorCode} - ${iceErrorEvent.errorText}`
      );
    };

    peerConnection.current.onsignalingstatechange = () => {
      console.log(
        `[${roomId}] Signaling state changed to: ${peerConnection.current?.signalingState}`
      );
    };

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

      if (!peerConnection.current.remoteDescription) {
        console.warn(
          `[${roomId}] Received ICE candidate but remote description is not set yet. Queueing.`
        );
        if (
          !queuedIceCandidates.current.some(
            (c) => c.candidate === candidateInit.candidate
          )
        ) {
          queuedIceCandidates.current.push(candidateInit);
        }
        return;
      }

      try {
        console.log(`[${roomId}] Adding received ICE candidate immediately.`);
        await peerConnection.current.addIceCandidate(
          new RTCIceCandidate(candidateInit)
        );
      } catch (error: any) {
        if (
          !error.message.includes("closed") &&
          !error.message.includes("candidate cannot be added")
        ) {
          console.error(
            `[${roomId}] Error adding received ICE candidate:`,
            error
          );
        } else {
          console.log(
            `[${roomId}] Ignored adding received ICE candidate to closed/invalid state connection.`
          );
        }
      }
    };

    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState === "closed"
      ) {
        console.warn(
          `[${roomId}] Received offer but PC is null or closed. Ignoring.`
        );
        return;
      }
      if (peerConnection.current.remoteDescription) {
        console.warn(
          `[${roomId}] Received offer but remote description already set. Ignoring potentially duplicate offer.`
        );
        return;
      }

      console.log(
        `[${roomId}] Received offer signal. Current state: ${peerConnection.current.signalingState}. Forwarding to createAnswer...`
      );
      await createAnswer(offer);
    };

    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState !== "have-local-offer"
      ) {
        console.warn(
          `[${roomId}] Received answer but signaling state is not 'have-local-offer' (it's ${peerConnection.current?.signalingState}). Ignoring answer.`
        );
        return;
      }
      try {
        console.log(`[${roomId}] Received answer, setting remote description.`);
        setConnectionStatus("Received answer, connecting...");
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
        console.log(
          `[${roomId}] Remote description (answer) set. New state: ${peerConnection.current.signalingState}`
        );

        await processQueuedCandidates();
      } catch (error) {
        console.error(
          `[${roomId}] Error setting remote description (answer):`,
          error
        );
        setConnectionStatus("Error handling answer");
      }
    };

    const handleInitiateOffer = async () => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState !== "stable" ||
        peerConnection.current.remoteDescription
      ) {
        console.warn(
          `[${roomId}] Received 'initiate_offer' but state is not stable (${peerConnection.current?.signalingState}), PC null, or connection already progressing. Not creating offer.`
        );
        return;
      }
      console.log(
        `[${roomId}] Received 'initiate_offer' signal, creating offer...`
      );
      await createOffer();
    };

    const handlePeerReady = () => {
      console.log(`[${roomId}] Received 'peer_ready'. Waiting for offer.`);
      setConnectionStatus("Peer detected, waiting for offer...");
    };

    const handlePeerDisconnected = () => {
      console.log(`[${roomId}] Peer disconnected signal received.`);
      setConnectionStatus("Peer disconnected");
      setIsPeerConnected(false);

      if (!peerConnection.current) {
        console.log(
          `[${roomId}] PeerConnection already null on peer disconnect signal.`
        );
        return;
      }

      if (peerConnection.current.signalingState !== "closed") {
        console.log(
          `[${roomId}] Closing peer connection due to peer disconnect signal.`
        );
        peerConnection.current.close();
      } else {
        console.log(
          `[${roomId}] Peer connection already closed when peer disconnect signal received.`
        );
      }

      if (videoElement2.current) {
        videoElement2.current.srcObject = null;
      }
      setRemoteStream(null);
      queuedIceCandidates.current = [];

      console.warn(
        `[${roomId}] Peer connection handling finished for peer disconnect signal.`
      );
    };

    socket.on("ice-candidate", handleIceCandidate);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("initiate_offer", handleInitiateOffer);
    socket.on("peer_ready", handlePeerReady);
    socket.on("peer_disconnected", handlePeerDisconnected);

    isSignalingSetup.current = true;

    return () => {
      console.log(
        `[${roomId}] Cleaning up PeerConnection setup effect listeners.`
      );
      socket.off("ice-candidate", handleIceCandidate);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("initiate_offer", handleInitiateOffer);
      socket.off("peer_ready", handlePeerReady);
      socket.off("peer_disconnected", handlePeerDisconnected);

      isSignalingSetup.current = false;
    };
  }, [localStream, roomId, createOffer, createAnswer, processQueuedCandidates]);

  // --- Render Logic ---
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="p-4 bg-zinc-900 border-b border-zinc-700 text-center shadow-md">
        <h1 className="text-xl font-semibold text-indigo-400">
          Room: <span className="font-mono text-indigo-300">{roomId}</span>
        </h1>
        <p
          className={`text-sm mt-1 ${
            isPeerConnected ? "text-green-400" : "text-yellow-400"
          }`}
        >
          {connectionStatus}
        </p>
      </header>

      {/* Main Video Area */}
      <main className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4 p-4 overflow-hidden">
        {/* Local Video Card */}
        <Card className="bg-zinc-900 border-zinc-800 overflow-hidden relative aspect-video shadow-lg">
          <CardContent className="p-0 h-full w-full relative">
            <video
              ref={videoElement1}
              className="w-full h-full object-cover"
              autoPlay
              playsInline
              muted // Important for local video
            />
            <Badge
              variant="secondary"
              className="absolute bottom-2 left-2 bg-zinc-800 text-zinc-200 text-xs"
            >
              You
            </Badge>
          </CardContent>
        </Card>

        {/* Remote Video Card */}
        <Card className="bg-zinc-900 border-zinc-800 overflow-hidden relative aspect-video shadow-lg">
          <CardContent className="p-0 h-full w-full relative">
            <video
              ref={videoElement2}
              className="w-full h-full object-cover"
              autoPlay
              playsInline
            />
            <Badge
              variant="secondary"
              className="absolute bottom-2 left-2 bg-zinc-800 text-zinc-200 text-xs"
            >
              Remote
            </Badge>
            {/* Placeholder */}
            {!isPeerConnected &&
              (!remoteStream || remoteStream.getTracks().length === 0) && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500 bg-zinc-900 bg-opacity-80">
                  <p>
                    {connectionStatus.startsWith("Waiting") ||
                    connectionStatus.startsWith("Signaling")
                      ? "Waiting for peer..."
                      : connectionStatus}
                  </p>
                </div>
              )}
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="p-3 bg-zinc-900 border-t border-zinc-700 text-center shadow-md">
        <Button
          onClick={() => navigate("/")}
          variant="destructive" // Use destructive variant for leaving/danger actions
          size="sm"
          className="bg-red-600 hover:bg-red-700 text-white font-bold"
        >
          Leave Room
        </Button>
      </footer>
    </div>
  );
}
