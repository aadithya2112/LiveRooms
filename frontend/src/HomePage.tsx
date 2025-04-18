import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

function HomePage() {
  const [roomIdInput, setRoomIdInput] = useState("");
  const navigate = useNavigate();

  const handleJoinRoom = (event: React.FormEvent) => {
    event.preventDefault();
    if (roomIdInput.trim()) {
      navigate(`/room/${roomIdInput.trim()}`);
    }
  };

  const handleCreateRoom = () => {
    // Generate a simple random room ID (you might want a more robust solution)
    const newRoomId = Math.random().toString(36).substring(2, 9);
    navigate(`/room/${newRoomId}`);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-800 text-white p-4">
      <h1 className="text-3xl font-bold mb-8">WebRTC Video Call</h1>
      <form
        onSubmit={handleJoinRoom}
        className="mb-4 flex flex-col items-center"
      >
        <input
          type="text"
          value={roomIdInput}
          onChange={(e) => setRoomIdInput(e.target.value)}
          placeholder="Enter Room ID"
          className="p-2 rounded border border-gray-600 bg-gray-700 text-white mb-2 w-64 text-center"
          required
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded w-64"
        >
          Join Room
        </button>
      </form>
      <div className="text-center">
        <p className="mb-2">Or</p>
        <button
          onClick={handleCreateRoom}
          className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded w-64"
        >
          Create New Room
        </button>
      </div>
    </div>
  );
}

export default HomePage;
