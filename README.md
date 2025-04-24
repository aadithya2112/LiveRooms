# LiveRooms

LiveRooms is a live video chat application using WebRTC, allowing users to create and join rooms for real-time communication. The project is built with React with typescript and Socket.io (nodejs) as the signaling server.

## Installation

To get started with the LiveRooms project, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/aadithya2112/LiveRooms.git
   cd LiveRooms
   ```
2. Go to the server directory:
   ```bash
   cd server
   ```
3. Install the server dependencies:
   ```bash
    npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Go to the client directory:
   ```bash
   cd ../frontend
   ```
6. Install the client dependencies:
   ```bash
   npm install
   ```
7. Edit frontend/config.ts
   ```typescript
   export const VITE_SIGNALLING_SERVER_URL = "http://localhost:3000";
   ```
   - Make sure to replace `http://localhost:3000` with the actual URL of your signaling server if it's hosted elsewhere.
8. Start the client:
   ```bash
   npm start
   ```
   Alternatively use docker to run the server and client:

```bash
docker-compose up
```
