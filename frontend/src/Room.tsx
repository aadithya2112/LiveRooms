import { useEffect, useRef, useState, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { io, Socket } from "socket.io-client"
import { VITE_SIGNALLING_SERVER_URL } from "./config"

// --- Shadcn UI Imports ---
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// --- Lucide Icons ---
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  User,
  Users,
  Dot,
} from "lucide-react"

// Define types for socket events
interface ServerToClientEvents {
  initiate_offer: () => void
  peer_ready: () => void
  offer: (offer: RTCSessionDescriptionInit) => void
  answer: (answer: RTCSessionDescriptionInit) => void
  "ice-candidate": (candidate: RTCIceCandidateInit) => void
  peer_disconnected: () => void
}

interface ClientToServerEvents {
  join: (roomId: string) => void
  offer: (offer: RTCSessionDescriptionInit) => void
  answer: (answer: RTCSessionDescriptionInit) => void
  "ice-candidate": (candidate: RTCIceCandidateInit) => void
}

// --- Socket Connection ---
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  VITE_SIGNALLING_SERVER_URL || "http://localhost:3000",
  { autoConnect: false }
)

// STUN server config
const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
}

// --- The Room Component ---
export default function Room() {
  // --- Hooks ---
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()

  // --- State & Refs ---
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [isPeerConnected, setIsPeerConnected] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<string>(
    "Waiting for peer..."
  )

  // Media control states
  const [isAudioEnabled, setIsAudioEnabled] = useState(true)
  const [isVideoEnabled, setIsVideoEnabled] = useState(true)
  const [isScreenSharing, setIsScreenSharing] = useState(false)

  const videoElement1 = useRef<HTMLVideoElement>(null)
  const videoElement2 = useRef<HTMLVideoElement>(null)
  const peerConnection = useRef<RTCPeerConnection | null>(null)
  const queuedIceCandidates = useRef<RTCIceCandidateInit[]>([])
  const isSignalingSetup = useRef(false)

  // --- Media Control Functions ---
  const toggleAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsAudioEnabled(audioTrack.enabled)
      }
    }
  }, [localStream])

  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setIsVideoEnabled(videoTrack.enabled)
      }
    }
  }, [localStream])

  const toggleScreenShare = useCallback(async () => {
    if (!peerConnection.current) return

    try {
      if (isScreenSharing) {
        // Stop screen sharing and switch back to camera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        })

        const videoTrack = stream.getVideoTracks()[0]
        const sender = peerConnection.current
          .getSenders()
          .find((s) => s.track && s.track.kind === "video")

        if (sender && videoTrack) {
          await sender.replaceTrack(videoTrack)
        }

        if (localStream) {
          localStream.getVideoTracks().forEach((track) => track.stop())
          localStream.removeTrack(localStream.getVideoTracks()[0])
          localStream.addTrack(videoTrack)
        }

        setIsScreenSharing(false)
      } else {
        // Start screen sharing
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        })

        const videoTrack = displayStream.getVideoTracks()[0]
        const sender = peerConnection.current
          .getSenders()
          .find((s) => s.track && s.track.kind === "video")

        if (sender && videoTrack) {
          await sender.replaceTrack(videoTrack)
        }

        if (localStream) {
          localStream.getVideoTracks().forEach((track) => track.stop())
          localStream.removeTrack(localStream.getVideoTracks()[0])
          localStream.addTrack(videoTrack)
        }

        setIsScreenSharing(true)

        videoTrack.onended = () => {
          toggleScreenShare()
        }
      }
    } catch (error) {
      console.error("Error toggling screen share:", error)
    }
  }, [isScreenSharing, localStream])

  // --- Cleanup Function ---
  const leaveRoom = useCallback(() => {
    // Stop all local media tracks
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        track.stop()
        console.log(`Stopped ${track.kind} track`)
      })
    }

    // Close peer connection
    if (peerConnection.current) {
      peerConnection.current.close()
      peerConnection.current = null
    }

    // Disconnect socket
    if (socket.connected) {
      socket.disconnect()
    }

    // Clear video elements
    if (videoElement1.current) {
      videoElement1.current.srcObject = null
    }
    if (videoElement2.current) {
      videoElement2.current.srcObject = null
    }

    // Navigate to home
    navigate("/")
  }, [localStream, navigate])

  // --- Helper Function to Process Queued ICE Candidates ---
  const processQueuedCandidates = useCallback(async () => {
    if (!peerConnection.current || !peerConnection.current.remoteDescription) {
      return
    }
    if (queuedIceCandidates.current.length > 0) {
      console.log(
        `[${roomId}] Processing ${queuedIceCandidates.current.length} queued ICE candidates...`
      )
      const candidatesToProcess = [...queuedIceCandidates.current]
      queuedIceCandidates.current = []
      for (const queuedCandidate of candidatesToProcess) {
        if (
          peerConnection.current?.remoteDescription &&
          peerConnection.current.signalingState !== "closed"
        ) {
          try {
            await peerConnection.current.addIceCandidate(
              new RTCIceCandidate(queuedCandidate)
            )
            console.log(`[${roomId}] Added queued ICE candidate.`)
          } catch (error: any) {
            if (
              !error.message.includes("closed") &&
              !error.message.includes("candidate cannot be added")
            ) {
              console.error(
                `[${roomId}] Error adding QUEUED ICE candidate:`,
                error
              )
            }
          }
        }
      }
    }
  }, [roomId])

  // --- WebRTC Callbacks (Offer/Answer) ---
  const createOffer = useCallback(async () => {
    if (
      !peerConnection.current ||
      !roomId ||
      peerConnection.current.signalingState !== "stable"
    ) {
      return
    }
    console.log(`[${roomId}] Creating offer...`)
    setConnectionStatus("Creating offer...")
    try {
      const offer = await peerConnection.current.createOffer()
      if (peerConnection.current.signalingState !== "stable") {
        return
      }
      await peerConnection.current.setLocalDescription(offer)
      socket.emit("offer", offer)
    } catch (error) {
      console.error(`[${roomId}] Error creating offer:`, error)
      setConnectionStatus("Error creating offer")
    }
  }, [roomId])

  const createAnswer = useCallback(
    async (offer: RTCSessionDescriptionInit) => {
      if (!peerConnection.current || !roomId) return

      const currentState = peerConnection.current.signalingState
      if (
        currentState !== "stable" &&
        currentState !== "have-remote-offer" &&
        currentState !== "have-local-offer"
      ) {
        return
      }

      console.log(`[${roomId}] Received offer, attempting to create answer...`)
      setConnectionStatus("Received offer, creating answer...")
      try {
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(offer)
        )
        await processQueuedCandidates()

        if (peerConnection.current.signalingState === "have-remote-offer") {
          const answer = await peerConnection.current.createAnswer()
          await peerConnection.current.setLocalDescription(answer)
          socket.emit("answer", answer)
        }
      } catch (error) {
        console.error(`[${roomId}] Error in createAnswer:`, error)
        setConnectionStatus("Error handling offer")
      }
    },
    [roomId, processQueuedCandidates]
  )

  // --- Effect 1: Get User Media & Join Room ---
  useEffect(() => {
    if (!roomId) {
      navigate("/")
      return
    }

    let didCancel = false

    const startVideo = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        })
        if (didCancel) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        setLocalStream(stream)
        if (videoElement1.current) {
          videoElement1.current.srcObject = stream
        }

        socket.connect()

        socket.on("connect", () => {
          if (didCancel) return
          socket.emit("join", roomId)
          setConnectionStatus("Connected, waiting for peer...")
        })

        socket.on("disconnect", () => {
          setConnectionStatus("Disconnected")
        })

        socket.on("connect_error", () => {
          setConnectionStatus("Connection error")
          leaveRoom()
        })
      } catch (error) {
        setConnectionStatus("Media access denied")
        leaveRoom()
      }
    }

    startVideo()

    return () => {
      didCancel = true
      if (peerConnection.current) {
        peerConnection.current.close()
        peerConnection.current = null
      }
      localStream?.getTracks().forEach((track) => track.stop())
      setLocalStream(null)
      if (socket.connected) {
        socket.disconnect()
      }
      socket.off("connect")
      socket.off("disconnect")
      socket.off("connect_error")
      setRemoteStream(null)
      setIsPeerConnected(false)
      queuedIceCandidates.current = []
      isSignalingSetup.current = false
    }
  }, [roomId, navigate])

  // --- Effect 2: Setup Peer Connection & Socket Listeners ---
  useEffect(() => {
    if (!localStream || !roomId || isSignalingSetup.current) {
      return
    }

    if (
      peerConnection.current &&
      peerConnection.current.connectionState !== "closed"
    ) {
      return
    }

    peerConnection.current = new RTCPeerConnection(servers)
    setIsPeerConnected(false)
    queuedIceCandidates.current = []

    localStream.getTracks().forEach((track) => {
      peerConnection.current?.addTrack(track, localStream)
    })

    const newRemoteStream = new MediaStream()
    setRemoteStream(newRemoteStream)
    if (videoElement2.current) {
      videoElement2.current.srcObject = newRemoteStream
    }

    peerConnection.current.onconnectionstatechange = () => {
      if (peerConnection.current) {
        const newState = peerConnection.current.connectionState
        setConnectionStatus(`Connection: ${newState}`)
        setIsPeerConnected(newState === "connected")
        if (
          newState === "failed" ||
          newState === "disconnected" ||
          newState === "closed"
        ) {
          setIsPeerConnected(false)
          if (newState === "closed") {
            if (videoElement2.current?.srcObject)
              videoElement2.current.srcObject = null
            setRemoteStream(null)
          }
        }
      }
    }

    peerConnection.current.ontrack = (event: RTCTrackEvent) => {
      event.streams[0].getTracks().forEach((track) => {
        if (!newRemoteStream.getTrackById(track.id)) {
          newRemoteStream.addTrack(track)
        }
      })
      if (
        videoElement2.current &&
        videoElement2.current.srcObject !== newRemoteStream
      ) {
        videoElement2.current.srcObject = newRemoteStream
      }
    }

    peerConnection.current.onicecandidate = (
      event: RTCPeerConnectionIceEvent
    ) => {
      if (
        event.candidate &&
        peerConnection.current?.signalingState !== "closed"
      ) {
        socket.emit("ice-candidate", event.candidate)
      }
    }

    const handleIceCandidate = async (candidateInit: RTCIceCandidateInit) => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState === "closed"
      ) {
        return
      }

      if (!peerConnection.current.remoteDescription) {
        if (
          !queuedIceCandidates.current.some(
            (c) => c.candidate === candidateInit.candidate
          )
        ) {
          queuedIceCandidates.current.push(candidateInit)
        }
        return
      }

      try {
        await peerConnection.current.addIceCandidate(
          new RTCIceCandidate(candidateInit)
        )
      } catch (error: any) {
        if (
          !error.message.includes("closed") &&
          !error.message.includes("candidate cannot be added")
        ) {
          console.error(`Error adding ICE candidate:`, error)
        }
      }
    }

    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState === "closed"
      ) {
        return
      }
      if (peerConnection.current.remoteDescription) {
        return
      }
      await createAnswer(offer)
    }

    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState !== "have-local-offer"
      ) {
        return
      }
      try {
        setConnectionStatus("Received answer, connecting...")
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        )
        await processQueuedCandidates()
      } catch (error) {
        setConnectionStatus("Error handling answer")
      }
    }

    const handleInitiateOffer = async () => {
      if (
        !peerConnection.current ||
        peerConnection.current.signalingState !== "stable" ||
        peerConnection.current.remoteDescription
      ) {
        return
      }
      await createOffer()
    }

    const handlePeerReady = () => {
      setConnectionStatus("Peer detected, waiting for offer...")
    }

    const handlePeerDisconnected = () => {
      setConnectionStatus("Peer disconnected")
      setIsPeerConnected(false)

      if (!peerConnection.current) {
        return
      }

      if (peerConnection.current.signalingState !== "closed") {
        peerConnection.current.close()
      }

      if (videoElement2.current) {
        videoElement2.current.srcObject = null
      }
      setRemoteStream(null)
      queuedIceCandidates.current = []
    }

    socket.on("ice-candidate", handleIceCandidate)
    socket.on("offer", handleOffer)
    socket.on("answer", handleAnswer)
    socket.on("initiate_offer", handleInitiateOffer)
    socket.on("peer_ready", handlePeerReady)
    socket.on("peer_disconnected", handlePeerDisconnected)

    isSignalingSetup.current = true

    return () => {
      socket.off("ice-candidate", handleIceCandidate)
      socket.off("offer", handleOffer)
      socket.off("answer", handleAnswer)
      socket.off("initiate_offer", handleInitiateOffer)
      socket.off("peer_ready", handlePeerReady)
      socket.off("peer_disconnected", handlePeerDisconnected)
      isSignalingSetup.current = false
    }
  }, [localStream, roomId, createOffer, createAnswer, processQueuedCandidates])

  // --- Clean, Modern Render Logic ---
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Clean Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <h1 className="text-xl font-semibold">LiveRooms</h1>
              <span className="text-gray-400">•</span>
              <span className="text-gray-300 font-mono text-sm">{roomId}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Dot
                className={`w-4 h-4 ${
                  isPeerConnected ? "text-green-400" : "text-yellow-400"
                }`}
              />
              <span className="text-sm text-gray-300">{connectionStatus}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Video Area */}
      <main className="flex-1 p-6">
        <div className="max-w-7xl mx-auto h-full">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
            {/* Local Video */}
            <Card className="relative bg-gray-900 border-gray-800 overflow-hidden">
              <CardContent className="p-0 aspect-video">
                <video
                  ref={videoElement1}
                  className="w-full h-full object-cover"
                  autoPlay
                  playsInline
                  muted
                />
                <Badge
                  variant="secondary"
                  className="absolute bottom-3 left-3 bg-black/60 text-white border-0"
                >
                  <User className="w-3 h-3 mr-1" />
                  You
                </Badge>
                {!isVideoEnabled && (
                  <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
                        <User className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-gray-400 text-sm">Camera is off</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Remote Video */}
            <Card className="relative bg-gray-900 border-gray-800 overflow-hidden">
              <CardContent className="p-0 aspect-video">
                <video
                  ref={videoElement2}
                  className="w-full h-full object-cover"
                  autoPlay
                  playsInline
                />
                <Badge
                  variant="secondary"
                  className="absolute bottom-3 left-3 bg-black/60 text-white border-0"
                >
                  <Users className="w-3 h-3 mr-1" />
                  Remote
                </Badge>
                {!isPeerConnected &&
                  (!remoteStream || remoteStream.getTracks().length === 0) && (
                    <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
                          <Users className="w-8 h-8 text-gray-400" />
                        </div>
                        <p className="text-gray-300 font-medium mb-2">
                          {connectionStatus.startsWith("Waiting") ||
                          connectionStatus.startsWith("Connected")
                            ? "Waiting for someone to join..."
                            : connectionStatus}
                        </p>
                        <p className="text-gray-500 text-sm">
                          Share the room ID to invite others
                        </p>
                      </div>
                    </div>
                  )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Clean Controls Footer */}
      <footer className="border-t border-gray-800 bg-gray-900/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-center space-x-4">
            {/* Audio Toggle */}
            <Button
              onClick={toggleAudio}
              variant={isAudioEnabled ? "secondary" : "destructive"}
              size="lg"
              className={`w-12 h-12 rounded-full text-white ${
                isAudioEnabled
                  ? "bg-gray-700 hover:bg-gray-600"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {isAudioEnabled ? (
                <Mic className="w-5 h-5 text-white" />
              ) : (
                <MicOff className="w-5 h-5 text-white" />
              )}
            </Button>

            {/* Video Toggle */}
            <Button
              onClick={toggleVideo}
              variant={isVideoEnabled ? "secondary" : "destructive"}
              size="lg"
              className={`w-12 h-12 rounded-full text-white ${
                isVideoEnabled
                  ? "bg-gray-700 hover:bg-gray-600"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {isVideoEnabled ? (
                <Video className="w-5 h-5 text-white" />
              ) : (
                <VideoOff className="w-5 h-5 text-white" />
              )}
            </Button>

            {/* Screen Share */}
            <Button
              onClick={toggleScreenShare}
              variant={isScreenSharing ? "default" : "secondary"}
              size="lg"
              className={`w-12 h-12 rounded-full text-white ${
                isScreenSharing
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
            >
              <Monitor className="w-5 h-5 text-white" />
            </Button>

            {/* Divider */}
            <div className="w-px h-8 bg-gray-600 mx-2" />

            {/* Leave Call */}
            <Button
              onClick={leaveRoom}
              variant="destructive"
              size="lg"
              className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white"
            >
              <PhoneOff className="w-5 h-5 text-white" />
            </Button>
          </div>

          {/* Status Indicators */}
          <div className="text-center mt-3">
            <div className="flex items-center justify-center space-x-4 text-sm">
              <div
                className={`flex items-center space-x-1 ${
                  isAudioEnabled ? "text-white" : "text-gray-400"
                }`}
              >
                {isAudioEnabled ? (
                  <Mic className="w-3 h-3" />
                ) : (
                  <MicOff className="w-3 h-3" />
                )}
                <span>Microphone</span>
              </div>
              <div
                className={`flex items-center space-x-1 ${
                  isVideoEnabled ? "text-white" : "text-gray-400"
                }`}
              >
                {isVideoEnabled ? (
                  <Video className="w-3 h-3" />
                ) : (
                  <VideoOff className="w-3 h-3" />
                )}
                <span>Camera</span>
              </div>
              {isScreenSharing && (
                <div className="flex items-center space-x-1 text-blue-400">
                  <Monitor className="w-3 h-3" />
                  <span>Screen Sharing</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
