// Set explicitly for hosted builds; never silently connect to an old production server.
export const signalingUrl = (
  import.meta.env.VITE_SIGNALLING_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')
).replace(/\/$/, '');
