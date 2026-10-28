import { useCallback, useEffect, useRef, useState } from 'react';

export function useMedia() {
  const camera = useRef<MediaStreamTrack | null>(null);
  const microphone = useRef<MediaStreamTrack | null>(null);
  const screen = useRef<MediaStreamTrack | null>(null);
  const alive = useRef(true);
  const request = useRef(0);
  const sharePending = useRef(false);
  const invalidate = useCallback(() => {
    request.current++;
  }, []);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [microphoneId, setMicrophoneId] = useState('');
  const refresh = useCallback(() => {
    setStream(
      new MediaStream(
        [screen.current || camera.current, microphone.current].filter(
          (t): t is MediaStreamTrack => !!t && t.readyState === 'live',
        ),
      ),
    );
  }, []);
  const start = useCallback(
    async (cameraDevice?: string, microphoneDevice?: string, audioOnly = false) => {
      const id = ++request.current;
      setLoading(true);
      setError('');
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        const next = await navigator.mediaDevices.getUserMedia({
          video: audioOnly
            ? false
            : cameraDevice
              ? { deviceId: { exact: cameraDevice } }
              : { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: microphoneDevice
            ? { deviceId: { exact: microphoneDevice }, echoCancellation: true }
            : { echoCancellation: true, noiseSuppression: true },
        });
        if (!alive.current || request.current !== id) {
          next.getTracks().forEach((t) => t.stop());
          return;
        }
        const audioEnabled = microphone.current?.enabled ?? true;
        const videoEnabled = camera.current?.enabled ?? true;
        camera.current?.stop();
        microphone.current?.stop();
        camera.current = next.getVideoTracks()[0] || null;
        microphone.current = next.getAudioTracks()[0] || null;
        setCameraId(camera.current?.getSettings().deviceId || '');
        setMicrophoneId(microphone.current?.getSettings().deviceId || '');
        if (microphone.current) microphone.current.enabled = audioEnabled;
        if (camera.current) camera.current.enabled = videoEnabled;
        setAudio(!!microphone.current && audioEnabled);
        setVideo(!!camera.current && videoEnabled);
        refresh();
        const available = await navigator.mediaDevices.enumerateDevices();
        if (alive.current && request.current === id) setDevices(available);
      } catch (cause) {
        if (!alive.current || request.current !== id) return;
        const name = cause instanceof Error ? cause.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'Camera or microphone access was blocked. Allow access in your browser, then try again. You can also join with both off.'
            : name === 'NotFoundError'
              ? 'No camera or microphone found. Connect a device, or join with both off.'
              : 'Could not start your devices. Check browser permissions and whether another app is using them.',
        );
        if (!camera.current) setVideo(false);
        if (!microphone.current) setAudio(false);
      } finally {
        if (alive.current && request.current === id) setLoading(false);
      }
    },
    [refresh],
  );
  useEffect(() => {
    alive.current = true;
    void start();
    const updateDevices = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((d) => {
          if (alive.current) setDevices(d);
        })
        .catch(() => {});
    };
    navigator.mediaDevices?.addEventListener('devicechange', updateDevices);
    return () => {
      alive.current = false;
      invalidate();
      navigator.mediaDevices?.removeEventListener('devicechange', updateDevices);
      [camera.current, microphone.current, screen.current].forEach((t) => t?.stop());
    };
  }, [start, invalidate]);
  const stopShare = useCallback(() => {
    if (screen.current) {
      screen.current.onended = null;
      screen.current.stop();
      screen.current = null;
    }
    setSharing(false);
    refresh();
  }, [refresh]);
  const toggleShare = useCallback(async () => {
    if (screen.current) {
      stopShare();
      return;
    }
    if (sharePending.current) return;
    sharePending.current = true;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (!alive.current) {
        display.getTracks().forEach((t) => t.stop());
        return;
      }
      screen.current = display.getVideoTracks()[0];
      screen.current.onended = stopShare;
      setSharing(true);
      refresh();
    } catch (cause) {
      if (cause instanceof Error && cause.name !== 'NotAllowedError')
        setError('Screen sharing is unavailable in this browser.');
    } finally {
      sharePending.current = false;
    }
  }, [refresh, stopShare]);
  const toggleAudio = () => {
    if (!microphone.current || microphone.current.readyState !== 'live') {
      setError('Enable your microphone in device settings first.');
      return;
    }
    microphone.current.enabled = !microphone.current.enabled;
    setAudio(microphone.current.enabled);
  };
  const toggleVideo = () => {
    if (!camera.current || camera.current.readyState !== 'live') {
      setError('Enable your camera in device settings first.');
      return;
    }
    camera.current.enabled = !camera.current.enabled;
    setVideo(camera.current.enabled);
  };
  return {
    stream,
    devices,
    audio,
    video,
    sharing,
    loading,
    error,
    cameraId,
    microphoneId,
    start,
    toggleAudio,
    toggleVideo,
    toggleShare,
    clearError: () => setError(''),
  };
}
