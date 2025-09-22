// Configuration for signalling server URL
// Defaults to localhost for development, can be overridden with environment variable

const getSignallingServerUrl = () => {
  // Check if we're in development mode
  const isDevelopment = import.meta.env.DEV

  // Use environment variable if available, otherwise fallback to defaults
  const envUrl = import.meta.env.VITE_SIGNALLING_SERVER_URL

  if (envUrl) {
    return envUrl
  }

  // Default URLs based on environment
  if (isDevelopment) {
    return "http://localhost:3000"
  } else {
    // Production fallback - you may want to update this
    return "https://roomsnew-ss.aadithya.tech"
  }
}

export const VITE_SIGNALLING_SERVER_URL = getSignallingServerUrl()
