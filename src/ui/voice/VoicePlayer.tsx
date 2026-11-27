/**
 * A voice message in a chat bubble: play / pause, its waveform (played part
 * highlighted; click to jump there) and the playback speed in one row, with
 * the length (or time played) under the play button.
 */
import { useEffect, useRef, useState } from 'react';
import type { VoiceInfo } from '../../core/delivery/realMessaging';
import { CheckIcon, ChevronDownIcon, PauseIcon, PlayIcon } from '../icons';
import { PopoverMenu } from '../PopoverMenu';
import { formatDuration } from './recorder';

const SPEEDS = [1, 1.5, 2];
/** Bars drawn: few enough to be thick, rounded strokes. */
const BARS = 30;

/** The loudest value of each of `n` equal parts (all of them when there are fewer). */
export function fewerBars(values: number[], n: number): number[] {
  if (values.length <= n) return values;
  return Array.from({ length: n }, (_, i) => {
    const part = values.slice(Math.floor((i * values.length) / n), Math.floor(((i + 1) * values.length) / n));
    return Math.max(0, ...part);
  });
}

/**
 * Safari's audio session (iOS 16.4+, macOS 13.3+). Right after the microphone
 * was used it can stay in "play and record" mode, where the first playback is
 * routed to the earpiece or not heard at all; "playback" plays out loud.
 */
function setAudioSession(type: 'playback' | 'auto') {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session && session.type !== type) {
    try {
      session.type = type;
    } catch {
      // Not supported here: the browser picks.
    }
  }
}

interface Props {
  voice: VoiceInfo;
  /** Object URL of the audio, or null while it isn't on this device yet. */
  src: string | null;
  /** Shown instead of the time while the message is still arriving. */
  status?: string | null;
}

export function VoicePlayer({ voice, src, status }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [speedMenu, setSpeedMenu] = useState<HTMLElement | null>(null);
  // Recordings from Chrome carry no length: the browser learns it only by
  // reading to the end, which it otherwise does during the first playback.
  const measuring = useRef(false);
  const bars = fewerBars(Array.from(atob(voice.wave), (c) => c.charCodeAt(0)), BARS);
  const progress = voice.ms ? Math.min(1, (at * 1000) / voice.ms) : 0;

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, src]);

  const toggle = () => {
    const a = audio.current;
    if (!a || !src) return;
    if (a.paused) {
      measuring.current = false;
      setAudioSession('playback');
      void a.play();
    } else a.pause();
  };

  const seek = (fraction: number) => {
    const a = audio.current;
    if (!a || !src) return;
    a.currentTime = (fraction * voice.ms) / 1000;
    setAt(a.currentTime);
  };

  return (
    <div className="voice-msg">
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="auto"
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            if (Number.isFinite(a.duration) || !a.paused) return;
            measuring.current = true;
            a.currentTime = 1e9; // to the end, so the length is known before playing
          }}
          onDurationChange={(e) => {
            const a = e.currentTarget;
            if (!measuring.current || !Number.isFinite(a.duration)) return;
            measuring.current = false;
            a.currentTime = 0;
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            setAudioSession('auto');
          }}
          onEnded={() => {
            setPlaying(false);
            setAt(0);
            setAudioSession('auto');
          }}
          onTimeUpdate={(e) => {
            if (!measuring.current) setAt(e.currentTarget.currentTime);
          }}
        />
      )}
      <button
        type="button"
        className="voice-play"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div
        className="voice-wave"
        role="slider"
        tabIndex={src ? 0 : -1}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(voice.ms / 1000)}
        aria-valuenow={Math.round(at)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') seek(Math.min(1, progress + 0.05));
          if (e.key === 'ArrowLeft') seek(Math.max(0, progress - 0.05));
        }}
      >
        {bars.map((b, i) => (
          <span
            key={i}
            className={(i + 0.5) / bars.length <= progress ? 'played' : ''}
            style={{ height: `${Math.max(14, Math.round((b / 255) * 100))}%` }}
          />
        ))}
      </div>
      <button
        type="button"
        className="voice-speed"
        aria-label={`Playback speed ${speed}×`}
        aria-haspopup="menu"
        aria-expanded={!!speedMenu}
        onClick={(e) => setSpeedMenu(speedMenu ? null : e.currentTarget)}
      >
        <span className="voice-speed-value">{speed}×</span>
        <span className="voice-speed-divider" aria-hidden="true" />
        <ChevronDownIcon />
      </button>
      {speedMenu && (
        <PopoverMenu
          label="Playback speed"
          anchor={speedMenu}
          onClose={() => setSpeedMenu(null)}
          items={SPEEDS.map((v) => ({
            label: `${v}×`,
            icon: v === speed ? <CheckIcon /> : <span />,
            onSelect: () => setSpeed(v),
          }))}
        />
      )}
      <span className="voice-length">{status ?? formatDuration(playing || at > 0 ? at * 1000 : voice.ms)}</span>
    </div>
  );
}
