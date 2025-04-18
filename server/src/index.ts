import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";

interface ClientToServerEvents {
  join: (roomId: string) => void;
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  "ice-candidate": (candidate: RTCIceCandidateInit) => void;
}

interface ServerToClientEvents {
  ready: () => void;
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  "ice-candidate": (candidate: RTCIceCandidateInit) => void;
}

interface InterServerEvents {
  // ping: () => void; // Example if needed
}

interface SocketData {
  currentRoom?: string; // Store room info directly on socket data
}

const app = express();

// Use cors middleware
app.use(cors()); // Basic CORS setup allowing all origins

const server = http.createServer(app);

// Use types with the Server instance
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData // Use SocketData for type safety
>(server, {
  cors: {
    origin: "*", // Or specify your client origin e.g., "http://localhost:5173"
    methods: ["GET", "POST"],
  },
});

io.on(
  "connection",
  (
    socket: Socket<
      ClientToServerEvents,
      ServerToClientEvents,
      InterServerEvents,
      SocketData
    >
  ) => {
    console.log("A user connected:", socket.id);

    socket.on("join", (roomIdInput) => {
      const targetRoom = roomIdInput || "main"; // Default to "main" if no room ID provided
      const previousRoom = socket.data.currentRoom;

      // Leave previous room if exists
      if (previousRoom && previousRoom !== targetRoom) {
        console.log(`User ${socket.id} leaving room: ${previousRoom}`);
        socket.leave(previousRoom);
      }

      // Join the new room
      socket.join(targetRoom);
      socket.data.currentRoom = targetRoom; // Store current room on the socket
      console.log(`User ${socket.id} joined room: ${targetRoom}`);

      // Check room size and notify if ready (2 clients)
      const clients = io.sockets.adapter.rooms.get(targetRoom);
      const numClients = clients ? clients.size : 0;
      console.log(`Room ${targetRoom} now has ${numClients} client(s)`);

      if (numClients === 2) {
        console.log(`Room ${targetRoom} is ready, emitting 'ready'`);
        // Emit 'ready' to all clients *in that specific room*
        io.to(targetRoom).emit("ready");
      } else if (numClients > 2) {
        console.warn(
          `Room ${targetRoom} has more than 2 clients (${numClients}). Current logic might need adjustment for >2 peers.`
        );
      }
    });

    // Forwarding events to the other client in the room
    const forwardEvent = (
      eventName: "offer" | "answer" | "ice-candidate",
      data: any
    ) => {
      const currentRoom = socket.data.currentRoom;
      if (currentRoom) {
        // socket.to(room) sends to everyone in the room *except* the sender
        console.log(
          `Forwarding '${eventName}' from ${socket.id} to room ${currentRoom}`
        );
        socket.to(currentRoom).emit(eventName, data);
      } else {
        console.warn(
          `Cannot forward '${eventName}', user ${socket.id} is not in a room.`
        );
      }
    };

    socket.on("offer", (offer) => {
      forwardEvent("offer", offer);
    });

    socket.on("answer", (answer) => {
      forwardEvent("answer", answer);
    });

    socket.on("ice-candidate", (candidate) => {
      forwardEvent("ice-candidate", candidate);
    });

    socket.on("disconnect", () => {
      const currentRoom = socket.data.currentRoom;
      console.log(
        "User disconnected:",
        socket.id,
        currentRoom ? `from room ${currentRoom}` : ""
      );
      // No need to explicitly call socket.leave(currentRoom) here,
      // Socket.IO handles it automatically on disconnect.
      // You might want to notify the other user in the room if needed.
      if (currentRoom) {
        // Optionally notify the other client
        // socket.to(currentRoom).emit('peer-disconnected', { peerId: socket.id });
      }
    });
  }
);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});
