import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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
    const newRoomId = Math.random().toString(36).substring(2, 9);
    navigate(`/room/${newRoomId}`);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-950 p-6">
      <Card className="w-full max-w-md bg-zinc-900 border border-zinc-800 text-white shadow-xl rounded-2xl">
        <CardHeader className="text-center space-y-2">
          <CardTitle className="text-3xl font-semibold text-indigo-500">
            🎥 WebRTC Video Call
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Join an existing room or create a new one to start calling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJoinRoom} className="space-y-5">
            <Input
              id="roomId"
              type="text"
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value)}
              placeholder="Enter Room ID"
              className="text-center bg-zinc-800 border-zinc-700 placeholder-zinc-500 focus:ring-indigo-500 text-white"
              required
            />
            <Button
              type="submit"
              className="w-full bg-indigo-500 hover:bg-indigo-700 text-white text-base"
            >
              Join Room
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col">
          <div className="relative flex justify-center items-center w-full my-4">
            <Separator className="absolute w-full bg-zinc-700" />
            <span className="relative bg-zinc-900 px-3 text-sm text-zinc-400">
              OR
            </span>
          </div>
          <Button
            variant="outline"
            onClick={handleCreateRoom}
            className="w-full border-indigo-500 text-indigo-500 hover:bg-zinc-800 text-base hover:text-white"
          >
            ➕ Create New Room
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default HomePage;
