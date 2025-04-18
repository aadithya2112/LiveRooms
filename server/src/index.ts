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
  // ready: () => void; // REMOVED - Replaced by more specific events
  initiate_offer: () => void; // ADDED - Tells the client to create and send an offer
  peer_ready: () => void; // ADDED - Tells the client a peer has joined and is waiting
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  "ice-candidate": (candidate: RTCIceCandidateInit) => void;
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
    origin: "*", // Adjust for production
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join", (roomIdInput) => {
    const targetRoom = String(roomIdInput || "default_fallback_room");

    const previousRoom = socket.data.currentRoom;
    if (previousRoom && previousRoom !== targetRoom) {
      console.log(`User ${socket.id} leaving room: ${previousRoom}`);
      socket.to(previousRoom).emit("peer_disconnected");
      socket.leave(previousRoom);
    }

    const clientsInRoom = io.sockets.adapter.rooms.get(targetRoom);
    const numClients = clientsInRoom ? clientsInRoom.size : 0;

    if (numClients >= 2) {
      console.warn(`User ${socket.id} tried to join full room: ${targetRoom}`);
      // Optional: socket.emit('room_full', targetRoom);
      return;
    }

    socket.join(targetRoom);
    socket.data.currentRoom = targetRoom;
    console.log(`User ${socket.id} joined room: ${targetRoom}`);

    // Recalculate after joining
    const updatedClientsInRoom = io.sockets.adapter.rooms.get(targetRoom);
    const updatedNumClients = updatedClientsInRoom
      ? updatedClientsInRoom.size
      : 0;
    console.log(`Room ${targetRoom} now has ${updatedNumClients} client(s)`);

    if (updatedNumClients === 2) {
      console.log(`Room ${targetRoom} is full. Notifying peers to connect.`);
      // The current socket is the second one to join. Designate it as the initiator.
      const initiatorSocketId = socket.id;
      console.log(
        `Designating ${initiatorSocketId} (new joiner) as initiator.`
      );

      // Tell the new joiner (initiator) to start the offer process
      socket.emit("initiate_offer");

      // Tell the *other* client in the room that a peer is ready and waiting for the offer
      socket.to(targetRoom).emit("peer_ready");
    } else if (updatedNumClients === 1) {
      console.log(
        `Room ${targetRoom} has only one client. Waiting for another.`
      );
      // Optionally emit a 'waiting_for_peer' event if needed by the UI
      // socket.emit("waiting_for_peer");
    }
  });

  const forwardEvent = (
    eventName: "offer" | "answer" | "ice-candidate",
    data: any
  ) => {
    const currentRoom = socket.data.currentRoom;
    if (currentRoom) {
      // Forward to the other client(s) in the room
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
      console.log(
        `Notifying room ${currentRoom} about peer disconnect from ${socket.id}`
      );
      socket.to(currentRoom).emit("peer_disconnected");
    }
    socket.data.currentRoom = undefined; // Clean up custom data
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});
