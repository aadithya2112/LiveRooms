import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  Copy,
  Info,
  Link2,
  LoaderCircle,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Settings2,
  ShieldCheck,
  Video,
  VideoOff,
  Wifi,
  X,
} from 'lucide-react';
import { roomIdSchema } from '../../shared/protocol';
import { Brand } from './components/Brand';
import { useMedia } from './hooks/useMedia';
import { useCall } from './hooks/useCall';

function StreamVideo({
  stream,
  muted = false,
  mirror = false,
  contain = false,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  contain?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (video) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }
    return () => {
      if (video) video.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={`${mirror ? 'mirrored' : ''} ${contain ? 'video-contain' : ''}`}
    />
  );
}
function Control({
  label,
  active = false,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`control ${active ? 'control-active' : ''} ${danger ? 'control-danger' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={danger ? undefined : active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
export default function Room() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  if (!roomIdSchema.safeParse(roomId).success)
    return (
      <div className="invalid-room">
        <Brand />
        <h1>This room link doesn’t look right.</h1>
        <p>Ask for a new invitation, or start your own conversation.</p>
        <Link className="button primary" to="/">
          Back to home <ArrowRight size={18} />
        </Link>
      </div>
    );
  return <RoomExperience key={roomId} roomId={roomId} leave={() => navigate('/?left=1')} />;
}
function RoomExperience({ roomId, leave }: { roomId: string; leave: () => void }) {
  const media = useMedia();
  const [name, setName] = useState(() => sessionStorage.getItem('liverooms-name') || '');
  const [joined, setJoined] = useState(false);
  const call = useCall(roomId, name.trim() || 'Guest', joined, media.stream, {
    audio: media.audio,
    video: media.video,
    sharing: media.sharing,
  });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [settings, setSettings] = useState(false);
  const [details, setDetails] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (!joined) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [joined]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetails(false);
        setSettings(false);
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  const invite = `${window.location.origin}/room/${roomId}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setCopyError(false);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(true);
      setDetails(true);
    }
  }
  function join() {
    sessionStorage.setItem('liverooms-name', name.trim() || 'Guest');
    setJoined(true);
  }
  const statusText = {
    joining: 'Joining your room',
    waiting: 'Waiting for your person',
    connecting: 'Connecting your call',
    connected: 'You’re connected',
    reconnecting: 'Reconnecting',
    error: 'Let’s try that again',
    full: 'This room is full',
  }[call.status];
  const devices = (
    <div className="device-fields">
      <label>
        Camera{' '}
        <select
          value={media.cameraId}
          disabled={media.loading}
          onChange={(e) => void media.start(e.target.value, media.microphoneId)}
        >
          <option value="">Default camera</option>
          {media.devices
            .filter((d) => d.kind === 'videoinput')
            .map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
        </select>
        <ChevronDown size={14} />
      </label>
      <label>
        Microphone{' '}
        <select
          value={media.microphoneId}
          disabled={media.loading}
          onChange={(e) => void media.start(media.cameraId, e.target.value)}
        >
          <option value="">Default microphone</option>
          {media.devices
            .filter((d) => d.kind === 'audioinput')
            .map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
        </select>
        <ChevronDown size={14} />
      </label>
    </div>
  );
  const mediaError = media.error && (
    <div className="notice" role="alert">
      <Info size={17} />
      <span>{media.error}</span>
      <button onClick={() => void media.start(media.cameraId, media.microphoneId)}>
        Try again
      </button>
      <button className="icon-button" aria-label="Dismiss device error" onClick={media.clearError}>
        <X size={15} />
      </button>
    </div>
  );
  if (!joined)
    return (
      <div className="lobby">
        <header className="home-header">
          <Brand />
          <Link className="text-link" to="/">
            <ArrowLeft size={15} /> Back to home
          </Link>
        </header>
        <main className="lobby-main">
          <div className="lobby-title">
            <span className="eyebrow">A moment before you connect</span>
            <h1>Come as you are.</h1>
            <p>Get comfortable. Check your devices. The room is yours.</p>
          </div>
          <div className="lobby-layout">
            <div className="preview-wrap">
              <div className="camera-preview">
                <StreamVideo stream={media.stream} muted mirror />
                {(!media.video || media.loading) && (
                  <div className="camera-placeholder">
                    {media.loading ? (
                      <LoaderCircle className="spin" size={30} />
                    ) : (
                      <>
                        <span className="avatar">
                          {name.trim().slice(0, 1).toUpperCase() || 'Y'}
                        </span>
                        <p>Your camera is off</p>
                      </>
                    )}
                  </div>
                )}
                <span className="video-label">
                  {name.trim() || 'You'} <span>(you)</span>
                </span>
                <div className="preview-controls">
                  <Control
                    label={media.audio ? 'Mute microphone' : 'Unmute microphone'}
                    active={!media.audio}
                    disabled={media.loading}
                    onClick={media.toggleAudio}
                  >
                    {media.audio ? <Mic size={20} /> : <MicOff size={20} />}
                  </Control>
                  <Control
                    label={media.video ? 'Turn camera off' : 'Turn camera on'}
                    active={!media.video}
                    disabled={media.loading}
                    onClick={media.toggleVideo}
                  >
                    {media.video ? <Video size={20} /> : <VideoOff size={20} />}
                  </Control>
                </div>
              </div>
              {devices}
            </div>
            <div className="lobby-join">
              <div className="small-room-icon">
                <Video size={24} />
              </div>
              <h2>Your room is ready.</h2>
              <p>
                Just two people.
                <br />A little space to connect.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  join();
                }}
              >
                <label htmlFor="display-name">What should we call you?</label>
                <input
                  id="display-name"
                  maxLength={40}
                  autoComplete="given-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name (optional)"
                />
                <button disabled={media.loading} className="button primary" type="submit">
                  {media.loading ? 'Checking devices…' : 'Join room'}
                  <ArrowRight size={18} />
                </button>
              </form>
              <button className="text-link invite-link" onClick={() => void copy()}>
                {copied ? <Check size={16} /> : <Link2 size={16} />}{' '}
                {copied ? 'Link copied' : 'Copy invitation link'}
              </button>
              {copyError && (
                <input
                  aria-label="Invitation link"
                  readOnly
                  value={invite}
                  onFocus={(e) => e.target.select()}
                />
              )}
              <button
                className="text-link audio-only-link"
                disabled={media.loading}
                onClick={() => void media.start(undefined, media.microphoneId, true)}
              >
                <Mic size={14} /> Use microphone only
              </button>
              <span className="privacy-note">
                <ShieldCheck size={15} /> No account needed. No recording.
              </span>
            </div>
          </div>
          {mediaError}
          <div className="lobby-footer">
            <span className="live-dot" /> A good conversation starts with a simple hello.
          </div>
        </main>
      </div>
    );
  return (
    <div className="call-page">
      <header className="call-header">
        <Brand light />
        <div className="call-heading">
          <span className={`live-dot ${call.status === 'connected' ? '' : 'dot-waiting'}`} />
          <span>{statusText}</span>
          <span className="call-time">
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
            {String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>
        <button className="button invite-button" onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Link2 size={16} />}
          <span>{copied ? 'Link copied' : 'Invite someone'}</span>
        </button>
      </header>
      <main className="call-main">
        {mediaError}
        {call.error && (
          <div className="notice" role="alert">
            <Info size={17} />
            <span>{call.error}</span>
            <button onClick={call.retry}>Rejoin room</button>
          </div>
        )}
        <div
          ref={stage}
          className={`video-stage ${media.sharing || call.peer?.media.sharing ? 'is-sharing' : ''}`}
        >
          <div className="remote-tile">
            <StreamVideo stream={call.remoteStream} contain={call.peer?.media.sharing} />
            {(call.status !== 'connected' ||
              (!call.peer?.media.video && !call.peer?.media.sharing)) && (
              <div className="remote-placeholder">
                {call.peer && call.status === 'connected' ? (
                  <>
                    <span className="avatar remote-avatar">
                      {call.peer.name.slice(0, 1).toUpperCase()}
                    </span>
                    <h2>{call.peer.name}</h2>
                    <p>Camera is off. The conversation is still on.</p>
                  </>
                ) : (
                  <>
                    <div className="waiting-art">
                      <span />
                      <span />
                      <i />
                    </div>
                    <span className="eyebrow">
                      {call.status === 'waiting'
                        ? 'Good company is on the way'
                        : 'Your space to connect'}
                    </span>
                    <h1>
                      {statusText}
                      {call.status === 'waiting' ? '.' : '…'}
                    </h1>
                    <p>
                      {call.status === 'waiting'
                        ? 'Send them the link. We’ll take care of the rest.'
                        : call.status === 'full'
                          ? 'Start another room or wait for a space to open.'
                          : 'Take a breath. We’re getting things ready.'}
                    </p>
                    {call.status === 'waiting' && (
                      <button className="button stage-invite" onClick={() => void copy()}>
                        {copied ? <Check size={17} /> : <Copy size={17} />}{' '}
                        {copied ? 'Invitation copied' : 'Copy invitation'}
                      </button>
                    )}
                    {(call.status === 'error' || call.status === 'full') && (
                      <button className="button stage-invite" onClick={call.retry}>
                        Try joining again <ArrowRight size={17} />
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="tile-top">
              <span className="tile-tag">
                <span className="live-dot" />
                {call.peer?.media.sharing ? `${call.peer.name}’s screen` : 'Live room'}
              </span>
              <button
                className="icon-button"
                aria-label="Toggle fullscreen"
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
                  else void stage.current?.requestFullscreen().catch(() => {});
                }}
              >
                <Maximize2 size={17} />
              </button>
            </div>
            {call.peer && (
              <span className="video-label">
                {call.peer.name} {!call.peer.media.audio && <MicOff size={14} />}
              </span>
            )}
          </div>
          <div className="local-tile">
            <StreamVideo
              stream={media.stream}
              muted
              mirror={!media.sharing}
              contain={media.sharing}
            />
            {!media.video && !media.sharing && (
              <div className="camera-placeholder">
                <span className="avatar">{name.trim().slice(0, 1).toUpperCase() || 'Y'}</span>
              </div>
            )}
            <span className="video-label">
              {name.trim() || 'You'} <span>(you)</span>
              {!media.audio && <MicOff size={14} />}
            </span>
            {media.sharing && (
              <span className="sharing-tag">
                <MonitorUp size={13} /> Sharing your screen
              </span>
            )}
          </div>
        </div>
      </main>
      <footer className="call-footer">
        <div className="room-info">
          <button className="text-link" onClick={() => setDetails(!details)}>
            <Info size={16} />
            <span>Room details</span>
          </button>
          <span>Just the two of you.</span>
        </div>
        <div className="call-controls">
          <Control
            label={media.audio ? 'Mute microphone' : 'Unmute microphone'}
            active={!media.audio}
            onClick={media.toggleAudio}
          >
            <span className="control-icon">
              {media.audio ? <Mic size={21} /> : <MicOff size={21} />}
            </span>
          </Control>
          <Control
            label={media.video ? 'Turn camera off' : 'Turn camera on'}
            active={!media.video}
            onClick={media.toggleVideo}
          >
            {media.video ? <Video size={21} /> : <VideoOff size={21} />}
          </Control>
          {typeof navigator.mediaDevices?.getDisplayMedia === 'function' && (
            <Control
              label={media.sharing ? 'Stop sharing' : 'Share screen'}
              active={media.sharing}
              onClick={() => void media.toggleShare()}
            >
              <MonitorUp size={21} />
            </Control>
          )}
          <span className="control-divider" />
          <Control label="Device settings" active={settings} onClick={() => setSettings(!settings)}>
            <Settings2 size={21} />
          </Control>
          <Control label="Leave call" danger onClick={leave}>
            <PhoneOff size={21} />
          </Control>
        </div>
        <div className="connection-note">
          <ShieldCheck size={15} />
          <span>WebRTC encrypted media</span>
        </div>
      </footer>
      {settings && (
        <div className="panel" role="dialog" aria-modal="false" aria-label="Device settings">
          <div className="panel-header">
            <h2>Make yourself comfortable.</h2>
            <button
              className="icon-button"
              onClick={() => setSettings(false)}
              aria-label="Close device settings"
            >
              <X size={18} />
            </button>
          </div>
          <p>Choose your camera and microphone.</p>
          {devices}
          <button
            className="text-link audio-only-link"
            disabled={media.loading}
            onClick={() => void media.start(undefined, media.microphoneId, true)}
          >
            <Mic size={14} /> Use microphone only
          </button>
          <button
            className="button secondary"
            onClick={() => void media.start(media.cameraId, media.microphoneId)}
            disabled={media.loading}
          >
            {media.loading ? 'Checking devices…' : 'Retry device access'}
          </button>
        </div>
      )}
      {details && (
        <div className="panel" role="dialog" aria-modal="false" aria-label="Room details">
          <div className="panel-header">
            <h2>A little room information.</h2>
            <button
              className="icon-button"
              onClick={() => setDetails(false)}
              aria-label="Close room details"
            >
              <X size={18} />
            </button>
          </div>
          <label htmlFor="invite-url">Invitation link</label>
          <input id="invite-url" value={invite} readOnly onFocus={(e) => e.target.select()} />
          <button className="text-link" onClick={() => void copy()}>
            <Copy size={15} />
            {copied ? 'Copied' : copyError ? 'Select the link above to copy it' : 'Copy link'}
          </button>
          <div className="diagnostics">
            <span>
              <Wifi size={16} /> {call.connectionType}
            </span>
            <span>
              <AudioLines size={16} />{' '}
              {call.roundTrip === null
                ? 'Latency available once connected'
                : `${call.roundTrip} ms round-trip latency`}
            </span>
            <span>
              <ShieldCheck size={16} />{' '}
              {call.relayConfigured
                ? 'TURN fallback available'
                : 'Direct connections only · TURN not configured'}
            </span>
          </div>
          <p className="details-note">
            Anyone with this link can join when there’s space. Share it with someone you trust.
          </p>
        </div>
      )}
    </div>
  );
}
