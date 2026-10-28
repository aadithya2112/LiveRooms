import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  ArrowRight,
  Video,
  Link2,
  MonitorUp,
  AudioLines,
  Check,
  Globe2,
} from 'lucide-react';
import { createRoomId, parseRoomInput } from '../../shared/protocol';
import { Brand } from './components/Brand';

export default function HomePage() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  function join(event: FormEvent) {
    event.preventDefault();
    const room = parseRoomInput(input);
    if (!room) {
      setError('Enter a valid room code or invitation link.');
      return;
    }
    navigate(`/room/${room}`);
  }
  return (
    <div className="home">
      <header className="home-header">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a
            className="source-link"
            href="https://github.com/aadithya2112/LiveRooms"
            target="_blank"
            rel="noreferrer"
          >
            View source <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" /> A little closer, wherever you are
            </div>
            <h1 id="hero-title">
              Good company.
              <br />
              Just a <span>link away.</span>
            </h1>
            <p className="hero-description">
              A room for the two of you. Clear video, easy screen sharing, and nothing to download.
            </p>
            <div className="start-actions">
              <button
                className="button primary"
                onClick={() => navigate(`/room/${createRoomId()}`)}
              >
                <Video size={19} /> Start a conversation <ArrowUpRight size={19} />
              </button>
              <span>No account. No calendar invite.</span>
            </div>
            <form className="join-form" onSubmit={join} noValidate>
              <label htmlFor="room-link">Already have an invite?</label>
              <div className={`join-input ${error ? 'invalid' : ''}`}>
                <Link2 size={18} />
                <input
                  id="room-link"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setError('');
                  }}
                  placeholder="Paste a room link or code"
                  autoComplete="off"
                  aria-describedby={error ? 'join-error' : undefined}
                  aria-invalid={!!error}
                />
                <button aria-label="Join room" title="Join room">
                  <ArrowRight size={20} />
                </button>
              </div>
              {error && (
                <p id="join-error" className="form-error" role="alert">
                  {error}
                </p>
              )}
            </form>
            <div className="hero-footnote">
              <span>
                <Check size={14} /> Built for two
              </span>
              <span>
                <Check size={14} /> Peer-to-peer calls
              </span>
            </div>
          </div>
          <div
            className="hero-art"
            aria-label="Two abstract figures sharing a conversation"
            role="img"
          >
            <div className="art-grid" />
            <div className="art-caption">
              <span className="live-dot" /> Room for a real conversation <span>01 / 02</span>
            </div>
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="figure figure-one">
              <div className="figure-face">
                <span />
                <span />
                <i />
              </div>
            </div>
            <div className="figure figure-two">
              <div className="figure-face">
                <span />
                <span />
                <i />
              </div>
            </div>
            <div className="conversation-line line-one" />
            <div className="conversation-line line-two" />
            <div className="art-bottom">
              <AudioLines size={28} strokeWidth={1.3} />
              <span>
                Less setting up.
                <br />
                <strong>More catching up.</strong>
              </span>
              <span className="art-spark">✳</span>
            </div>
          </div>
        </section>
        <section className="how-section" id="how-it-works">
          <div className="section-heading">
            <span className="eyebrow">Connection, without the ceremony</span>
            <h2>
              Three steps.
              <br />
              Then it’s just you two.
            </h2>
          </div>
          <ol className="steps">
            <li>
              <span className="step-number">01</span>
              <Video size={23} />
              <h3>Make yourself a room.</h3>
              <p>Check your camera and mic. Join when you’re ready.</p>
            </li>
            <li>
              <span className="step-number">02</span>
              <Link2 size={23} />
              <h3>Send a little invitation.</h3>
              <p>Copy the link and share it with your person.</p>
            </li>
            <li>
              <span className="step-number">03</span>
              <MonitorUp size={23} />
              <h3>Pick up the conversation.</h3>
              <p>Catch up, work together, or show what’s on your screen.</p>
            </li>
          </ol>
        </section>
        <section className="closing">
          <Globe2 size={34} strokeWidth={1} />
          <p>
            Different places.
            <br />
            <span>Same room.</span>
          </p>
          <button className="button primary" onClick={() => navigate(`/room/${createRoomId()}`)}>
            Find your room <ArrowUpRight size={18} />
          </button>
        </section>
      </main>
      <footer className="home-footer">
        <Brand />
        <span>Made for the moments in between.</span>
        <a href="https://github.com/aadithya2112/LiveRooms" target="_blank" rel="noreferrer">
          Open source <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}
