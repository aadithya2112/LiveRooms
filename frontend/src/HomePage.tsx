import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Video, ArrowRight, Plus } from "lucide-react"

function HomePage() {
  const [roomIdInput, setRoomIdInput] = useState("")
  const navigate = useNavigate()

  const handleJoinRoom = (event: React.FormEvent) => {
    event.preventDefault()
    if (roomIdInput.trim()) {
      navigate(`/room/${roomIdInput.trim()}`)
    }
  }

  const handleCreateRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 9)
    navigate(`/room/${newRoomId}`)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <Card className="w-full max-w-md bg-gray-900 border-gray-800 shadow-2xl">
        <CardHeader className="text-center space-y-4 pt-8">
          <div className="mx-auto w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center">
            <Video className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-white">
            LiveRooms
          </CardTitle>
          <CardDescription className="text-gray-400">
            Connect with others through high-quality video calls
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 px-6">
          <form onSubmit={handleJoinRoom} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="roomId"
                className="text-sm font-medium text-gray-300"
              >
                Room ID
              </label>
              <Input
                id="roomId"
                type="text"
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value)}
                placeholder="Enter room ID"
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500"
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Join Room
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4 px-6 pb-8">
          <div className="relative w-full">
            <Separator className="bg-gray-700" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 px-3 text-sm text-gray-400">
              OR
            </span>
          </div>
          <Button
            variant="outline"
            onClick={handleCreateRoom}
            className="w-full border-gray-700 text-gray-800 hover:bg-gray-800 hover:text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create New Room
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export default HomePage
