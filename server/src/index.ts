import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";

interface ClientToServerEvents {
  join: (roomId: string) => void;
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  "ice-candidate": (candidate: RTCIceCandidateInit) => void;
  // Optional: leave event if needed for explicit leave button
  // leave: (roomId: string) => void;
}

interface ServerToClientEvents {
  ready: () => void;
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  "ice-candidate": (candidate: RTCIceCandidateInit) => void;
  // Add event for peer disconnection
  peer_disconnected: () => void;
}

interface InterServerEvents {}

interface SocketData {
  currentRoom?: string;
}

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join", (roomIdInput) => {
    // Ensure roomId is treated as string
    const targetRoom = String(roomIdInput || "default_fallback_room"); // Ensure string, avoid 'main' default maybe?

    const previousRoom = socket.data.currentRoom;
    if (previousRoom && previousRoom !== targetRoom) {
      console.log(`User ${socket.id} leaving room: ${previousRoom}`);
      // Notify the other user in the previous room
      socket.to(previousRoom).emit("peer_disconnected");
      socket.leave(previousRoom);
    }

    // Prevent joining excessively large rooms or validate roomId format if needed
    const clientsInRoom = io.sockets.adapter.rooms.get(targetRoom);
    const numClients = clientsInRoom ? clientsInRoom.size : 0;

    if (numClients >= 2) {
      console.warn(`User ${socket.id} tried to join full room: ${targetRoom}`);
      // Optionally emit an error back to the joining client
      // socket.emit('room_full', targetRoom);
      return; // Don't allow joining if room is full (for 1-on-1)
    }

    socket.join(targetRoom);
    socket.data.currentRoom = targetRoom;
    console.log(`User ${socket.id} joined room: ${targetRoom}`);

    // Recalculate after joining
    const updatedNumClients =
      io.sockets.adapter.rooms.get(targetRoom)?.size || 0;
    console.log(`Room ${targetRoom} now has ${updatedNumClients} client(s)`);

    if (updatedNumClients === 2) {
      console.log(`Room ${targetRoom} is ready, emitting 'ready'`);
      // Emit 'ready' only to others in the room (the new joiner doesn't need it immediately)
      // socket.to(targetRoom).emit("ready"); // This only sends to others
      // Emit to everyone including sender might be simpler for initial offer logic
      io.to(targetRoom).emit("ready");
    }
  });

  const forwardEvent = (
    eventName: "offer" | "answer" | "ice-candidate",
    data: any
  ) => {
    const currentRoom = socket.data.currentRoom;
    if (currentRoom) {
      // socket.to sends to everyone in the room *except* the sender
      console.log(
        `Forwarding '${eventName}' from ${socket.id} in room ${currentRoom}`
      );
      socket.to(currentRoom).emit(eventName, data);
    } else {
      console.warn(
        `Cannot forward '${eventName}', user ${socket.id} is not in a room.`
      );
    }
  };

  socket.on("offer", (offer) => forwardEvent("offer", offer));
  socket.on("answer", (answer) => forwardEvent("answer", answer));
  socket.on("ice-candidate", (candidate) =>
    forwardEvent("ice-candidate", candidate)
  );

  socket.on("disconnect", () => {
    const currentRoom = socket.data.currentRoom;
    console.log(
      `User disconnected: ${socket.id}${
        currentRoom ? ` from room ${currentRoom}` : ""
      }`
    );
    if (currentRoom) {
      // Notify the other client in the room that the peer has disconnected
      console.log(
        `Notifying room ${currentRoom} about peer disconnect from ${socket.id}`
      );
      socket.to(currentRoom).emit("peer_disconnected");
      // Socket.IO automatically handles leaving the room on disconnect
    }
    // Clean up custom data if necessary
    socket.data.currentRoom = undefined;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});
