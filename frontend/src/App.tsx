import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

// Define types for socket events if possible (optional but good practice)
interface ServerToClientEvents {
  ready: () => void;
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  "ice-candidate": (candidate: RTCIceCandidateInit) => void;
}

interface ClientToServerEvents {
  join: (roomId: string) => void;
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  "ice-candidate": (candidate: RTCIceCandidateInit) => void;
}

// Use types with the socket instance
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  import.meta.env.VITE_SIGNALLING_SERVER_URL
); // Adjust if needed

// STUN server config
const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
};

export default function App() {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const videoElement1 = useRef<HTMLVideoElement>(null); // Local video
  const videoElement2 = useRef<HTMLVideoElement>(null); // Remote video
  const peerConnection = useRef<RTCPeerConnection | null>(null); // WebRTC connection

  // 🔹 Create and send WebRTC offer to remote peer
  const createOffer = useCallback(async () => {
    if (!peerConnection.current) return;

    try {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      console.log("Offer created and set locally");
      socket.emit("offer", offer);
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  }, []); // No external dependencies needed if socket is stable

  // 🔹 Create and send WebRTC answer to received offer
  const createAnswer = useCallback(
    async (offer: RTCSessionDescriptionInit) => {
      if (!peerConnection.current) return;

      try {
        // Set remote description first
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(offer)
        );
        console.log("Remote description (offer) set");

        // Then create and set local answer
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        console.log("Answer created and set locally");
        socket.emit("answer", answer);
      } catch (error) {
        console.error("Error creating answer:", error);
      }
    },
    [] // No external dependencies needed if socket is stable
  );

  // Effect to get user media and join room
  useEffect(() => {
    const startVideo = async () => {
      console.log("Requesting user media...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true, // Usually want audio too for a call
        });
        console.log("Media stream obtained");
        setLocalStream(stream);
        if (videoElement1.current) {
          videoElement1.current.srcObject = stream;
        }
        // Join the room once the stream is ready
        console.log("Joining room 'main'");
        socket.emit("join", "main"); // Hardcoded to "main"
      } catch (error) {
        console.error("Error accessing webcam/microphone:", error);
      }
    };

    startVideo();

    // Cleanup function
    return () => {
      console.log("Cleaning up: stopping tracks and disconnecting socket");
      localStream?.getTracks().forEach((track) => track.stop());
      peerConnection.current?.close(); // Close the connection
      peerConnection.current = null;
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount

  // Effect to set up PeerConnection and Socket listeners
  useEffect(() => {
    if (!localStream) {
      console.log("SetupConnection effect: No local stream yet.");
      return; // Don't run setup if local stream isn't ready
    }

    console.log(
      "SetupConnection effect: Local stream ready, setting up PeerConnection."
    );
    // Create Peer Connection only once when localStream is available
    peerConnection.current = new RTCPeerConnection(servers);
    console.log("PeerConnection created");

    // 🔹 Add local tracks to the peer connection
    localStream.getTracks().forEach((track) => {
      console.log("Adding local track:", track.kind);
      peerConnection.current?.addTrack(track, localStream);
    });

    // 🔹 Prepare empty remote stream and attach to video element
    const newRemoteStream = new MediaStream();
    setRemoteStream(newRemoteStream); // Update state
    if (videoElement2.current) {
      videoElement2.current.srcObject = newRemoteStream;
    }

    // 🔹 When remote tracks arrive, add to remote stream
    peerConnection.current.ontrack = (event: RTCTrackEvent) => {
      console.log("Remote track received:", event.track.kind);
      event.streams[0].getTracks().forEach((track) => {
        console.log("Adding remote track to remote stream:", track.kind);
        newRemoteStream.addTrack(track);
      });
    };

    // 🔹 Send ICE candidates to remote peer
    peerConnection.current.onicecandidate = (
      event: RTCPeerConnectionIceEvent
    ) => {
      if (event.candidate) {
        console.log("Sending ICE candidate");
        socket.emit("ice-candidate", event.candidate);
      }
    };

    // --- Socket Event Listeners ---

    // 🔹 Receive ICE candidate from remote peer
    const handleIceCandidate = async (candidateInit: RTCIceCandidateInit) => {
      try {
        console.log("Received ICE candidate");
        const candidate = new RTCIceCandidate(candidateInit);
        await peerConnection.current?.addIceCandidate(candidate);
        console.log("Added received ICE candidate");
      } catch (error) {
        console.error("Error adding received ICE candidate:", error);
      }
    };

    // 🔹 Receive offer, respond with answer
    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
      console.log("Received offer");
      if (!peerConnection.current) {
        console.error("PeerConnection not initialized when offer received");
        return;
      }
      // If we receive an offer, it means we are the 'callee'
      // Ensure connection state allows setting remote description
      if (
        peerConnection.current.signalingState !== "stable" &&
        peerConnection.current.signalingState !== "have-local-offer"
      ) {
        console.warn(
          `Cannot handle offer in state: ${peerConnection.current.signalingState}`
        );
        // Potentially implement rollback or ignore if needed
        // For simplicity, we'll proceed, but this indicates a potential signaling issue
      }
      await createAnswer(offer); // createAnswer handles setRemoteDescription + create/set/send Answer
    };

    // 🔹 Receive answer from remote peer
    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
      console.log("Received answer");
      if (!peerConnection.current) {
        console.error("PeerConnection not initialized when answer received");
        return;
      }
      // Ensure connection state allows setting remote description
      if (peerConnection.current.signalingState !== "have-local-offer") {
        console.warn(
          `Cannot handle answer in state: ${peerConnection.current.signalingState}. Ignoring.`
        );
        return; // Should only receive answer after sending offer
      }
      try {
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
        console.log("Remote description (answer) set");
      } catch (error) {
        console.error("Error setting remote description (answer):", error);
      }
    };

    // 🔹 Trigger offer creation when server signals ready
    const handleReady = async () => {
      console.log("Received ready signal from server");
      // Typically, only one side (e.g., the one that joined first or based on some logic) creates the offer.
      // However, in a simple 2-peer setup, having both try might lead to glare,
      // but RTCPeerConnection is designed to handle it (using offer/answer precedence).
      // A more robust solution uses negotiationneeded event or explicit roles.
      // For this simple case, let's assume the initiator logic is handled implicitly or both attempt is okay.
      if (peerConnection.current?.signalingState === "stable") {
        console.log("Signaling state is stable, creating offer...");
        await createOffer();
      } else {
        console.log(
          `Signaling state is ${peerConnection.current?.signalingState}, not creating offer on 'ready'.`
        );
      }
    };

    // Attach listeners
    socket.on("ice-candidate", handleIceCandidate);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ready", handleReady);

    // Cleanup listeners when component unmounts or localStream changes
    return () => {
      console.log("Cleaning up PeerConnection setup effect listeners.");
      socket.off("ice-candidate", handleIceCandidate);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ready", handleReady);
      // Don't close the peer connection here, cleanup is handled in the first useEffect
    };
    // Dependencies: Run when localStream is set, and include callbacks if they aren't stable
  }, [localStream, createOffer, createAnswer]);

  return (
    <div className="grid grid-cols-2 gap-8 p-2">
      <div>
        <h2 className="text-center text-white">Local Video</h2>
        <video
          ref={videoElement1}
          className="bg-black w-full aspect-video" // Added aspect-video for better layout
          autoPlay
          playsInline
          muted // Mute local video to prevent echo
        />
      </div>
      <div>
        <h2 className="text-center text-white">Remote Video</h2>
        <video
          ref={videoElement2}
          className="bg-black w-full aspect-video" // Added aspect-video
          autoPlay
          playsInline
        />
      </div>
    </div>
  );
}
