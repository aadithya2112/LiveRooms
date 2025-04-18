import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";

// Define types for socket events
interface ServerToClientEvents {
  // ready: () => void; // REMOVED
  initiate_offer: () => void; // ADDED
  peer_ready: () => void; // ADDED
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
  import.meta.env.VITE_SIGNALLING_SERVER_URL || "http://localhost:3000",
  { autoConnect: false } // Start disconnected
);

// STUN server config
const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10, // Optional: Gather some ICE candidates proactively
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
  const [connectionStatus, setConnectionStatus] = useState<string>(
    "Waiting for peer..."
  ); // More detailed status

  const videoElement1 = useRef<HTMLVideoElement>(null);
  const videoElement2 = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const queuedIceCandidates = useRef<RTCIceCandidateInit[]>([]);
  const isSignalingSetup = useRef(false); // Prevent duplicate listener setup

  // --- Helper Function to Process Queued ICE Candidates ---
  const processQueuedCandidates = useCallback(async () => {
    if (!peerConnection.current || !peerConnection.current.remoteDescription) {
      // console.warn(`[${roomId}] Attempted to process queue but remote description still null or PC closed.`);
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
      if (!peerConnection.current || !roomId) return;

      const currentState = peerConnection.current.signalingState;
      // Should be 'stable' or 'have-remote-offer' (if offer arrived before PC setup finished)
      // Or potentially 'have-local-offer' if perfect glare happened despite server logic (unlikely but possible)
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
        // Set Remote Description (Offer)
        // This handles glare implicitly if state was 'have-local-offer'
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(offer)
        );
        console.log(
          `[${roomId}] Remote description (offer) set. New state: ${peerConnection.current.signalingState}`
        ); // Should be have-remote-offer

        // Process any queued candidates NOW
        await processQueuedCandidates();

        // Only create the answer if the state correctly transitioned to have-remote-offer
        if (peerConnection.current.signalingState === "have-remote-offer") {
          const answer = await peerConnection.current.createAnswer();
          await peerConnection.current.setLocalDescription(answer);
          console.log(
            `[${roomId}] Answer created and set locally. New state: ${peerConnection.current.signalingState}. Sending...`
          ); // Should be stable (or closing)
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
          audio: true, // Enable audio
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
        // Explicitly connect the socket
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
          // Handle potential need to reconnect or clean up state
        });

        socket.on("connect_error", (error) => {
          console.error(`[${roomId}] Socket connection error:`, error);
          setConnectionStatus("Signaling connection error");
          navigate("/"); // Navigate away on connection error
        });
      } catch (error) {
        console.error(`[${roomId}] Error accessing webcam/microphone:`, error);
        setConnectionStatus("Media access denied");
        navigate("/"); // Navigate away if media access fails
      }
    };

    startVideo();

    // --- Cleanup Function ---
    return () => {
      didCancel = true;
      console.log(`[${roomId}] Cleaning up Room component.`);

      // Close PeerConnection first
      if (peerConnection.current) {
        console.log(`[${roomId}] Closing PeerConnection.`);
        peerConnection.current.close();
        peerConnection.current = null;
      }

      // Stop media tracks
      localStream?.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
      console.log(`[${roomId}] Local stream stopped.`);

      // Disconnect socket
      if (socket.connected) {
        console.log(`[${roomId}] Disconnecting socket.`);
        socket.disconnect();
      }
      // Remove listeners added in this effect
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");

      setRemoteStream(null);
      setIsPeerConnected(false);
      queuedIceCandidates.current = [];
      isSignalingSetup.current = false; // Reset flag
      console.log(`[${roomId}] Room cleanup finished.`);
    };
  }, [roomId, navigate]); // Keep dependencies minimal

  // --- Effect 2: Setup Peer Connection & Socket Listeners ---
  useEffect(() => {
    // Only setup PC if we have a local stream, a room ID, and haven't set up listeners yet
    if (!localStream || !roomId || isSignalingSetup.current) {
      return;
    }

    // Avoid re-creating PC if one exists and isn't closed
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
    queuedIceCandidates.current = []; // Ensure queue is clear

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
            // Optional: Try restarting ICE
            // peerConnection.current?.restartIce();
            setConnectionStatus("Connection failed");
          }
          if (newState === "disconnected") {
            setConnectionStatus("Peer disconnected");
          }
          if (newState === "closed") {
            setConnectionStatus("Connection closed");
            // Ensure remote video is cleared if not already
            if (videoElement2.current?.srcObject)
              videoElement2.current.srcObject = null;
            setRemoteStream(null); // Clear the stream state
          }
          // Don't close PC here, let peer_disconnected signal or unmount handle it
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
      // Re-assign in case the stream object reference itself changed? (Usually not needed)
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
      const iceErrorEvent = event as RTCPeerConnectionIceErrorEvent; // Type assertion
      console.error(
        `[${roomId}] ICE Candidate Error: Code ${iceErrorEvent.errorCode} - ${iceErrorEvent.errorText}`
      );
    };

    peerConnection.current.onsignalingstatechange = () => {
      console.log(
        `[${roomId}] Signaling state changed to: ${peerConnection.current?.signalingState}`
      );
      // Optional: Update detailed status based on signaling state
      // setConnectionStatus(`Signaling: ${peerConnection.current?.signalingState}`);
    };

    // --- Socket Event Listeners ---

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
      // Check if we *already* have a remote description set (avoid processing duplicate offers)
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
        ); // Should be stable

        // Process any queued candidates NOW
        await processQueuedCandidates();
      } catch (error) {
        console.error(
          `[${roomId}] Error setting remote description (answer):`,
          error
        );
        setConnectionStatus("Error handling answer");
      }
    };

    // --- Handle initiate_offer ---
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

    // --- Handle peer_ready ---
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

      // Close the connection gracefully if not already closed
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
      // Setting peerConnection.current to null is handled by the main cleanup or state change handler

      // Clear remote video display explicitly
      if (videoElement2.current) {
        videoElement2.current.srcObject = null;
      }
      setRemoteStream(null);
      queuedIceCandidates.current = []; // Clear queue

      console.warn(
        `[${roomId}] Peer connection handling finished for peer disconnect signal.`
      );
      // Consider navigating away or showing a 'disconnected' message persistently
    };

    // Attach listeners
    socket.on("ice-candidate", handleIceCandidate);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("initiate_offer", handleInitiateOffer);
    socket.on("peer_ready", handlePeerReady);
    socket.on("peer_disconnected", handlePeerDisconnected);

    isSignalingSetup.current = true; // Mark listeners as attached

    // Cleanup listeners on effect unmount or when dependencies change significantly
    return () => {
      console.log(
        `[${roomId}] Cleaning up PeerConnection setup effect listeners.`
      );
      // Remove listeners specific to this effect
      socket.off("ice-candidate", handleIceCandidate);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("initiate_offer", handleInitiateOffer);
      socket.off("peer_ready", handlePeerReady);
      socket.off("peer_disconnected", handlePeerDisconnected);

      isSignalingSetup.current = false; // Reset flag if effect re-runs

      // Note: PeerConnection closing is primarily handled by the *first* useEffect's cleanup
      // to ensure it happens on component unmount, regardless of dependency changes here.
    };
  }, [localStream, roomId, createOffer, createAnswer, processQueuedCandidates]); // Dependencies

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
          Status: {connectionStatus}
        </p>
      </header>
      <main className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4 p-4 overflow-hidden">
        {/* Local Video */}
        <div className="bg-black rounded-lg overflow-hidden relative aspect-video">
          {" "}
          {/* Added aspect-video */}
          <video
            ref={videoElement1}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
            muted // Important for local video
          />
          <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded text-xs">
            Local
          </div>
        </div>
        {/* Remote Video */}
        <div className="bg-black rounded-lg overflow-hidden relative aspect-video">
          {" "}
          {/* Added aspect-video */}
          <video
            ref={videoElement2}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
          />
          <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded text-xs">
            Remote
          </div>
          {/* Improved placeholder logic */}
          {!isPeerConnected &&
            (!remoteStream || remoteStream.getTracks().length === 0) && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                {connectionStatus.startsWith("Waiting") ||
                connectionStatus.startsWith("Signaling")
                  ? "Waiting for peer..."
                  : connectionStatus}
              </div>
            )}
        </div>
      </main>
      <footer className="p-2 bg-gray-800 text-center">
        <button
          onClick={() => navigate("/")} // Use navigate for consistency
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm"
        >
          Leave Room
        </button>
      </footer>
    </div>
  );
}
