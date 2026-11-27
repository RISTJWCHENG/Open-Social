/**
 * The message bar while recording a voice message, grouped at the right:
 * - recording: delete, blinking dot and time, live level meter, pause, send;
 * - paused (or stopped at the length limit): delete, play the recording so
 *   far (seek on its waveform), its length, the microphone to continue, send.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { MicIcon, PauseIcon, PlayIcon, SendIcon, TrashIcon } from '../icons';
import { formatDuration, microphoneError, VoiceRecorder, type Recording } from './recorder';

interface Props {
  onSend: (recording: Recording) => Promise<void> | void;
  onCancel: () => void;
  onError: (message: string) => void;
}

const PREVIEW_BARS = 40;
const METER_BARS = 36;

export function VoiceRecorderBar({ onSend, onCancel, onError }: Props) {
  const rec = useRef<VoiceRecorder | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [sending, setSending] = useState(false);
  // Listening to what was recorded so far (paused only).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewAt, setPreviewAt] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let alive = true;
    VoiceRecorder.start(rerender)
      .then((r) => {
        if (alive) {
          rec.current = r;
          rerender();
        } else r.cancel();
      })
      .catch((e) => {
        if (alive) onError(microphoneError(e));
      });
    return () => {
      alive = false;
      // Leaving the bar without sending throws the recording away.
      if (rec.current && rec.current.state !== 'stopped') rec.current.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  const r = rec.current;
  const recording = r?.state === 'recording';
  const ms = r?.ms() ?? 0;

  /** Paused or stopped: get the recording so far for listening. */
  useEffect(() => {
    if (!r || recording) return;
    let alive = true;
    void r.soFar().then((blob) => {
      if (alive) setPreviewUrl(URL.createObjectURL(blob));
    });
    return () => {
      alive = false;
    };
  }, [r, recording, r?.state]);

  const stopPreview = () => {
    audio.current?.pause();
    setPreviewing(false);
    setPreviewAt(0);
    setPreviewUrl(null);
  };

  const pause = () => r?.pause();
  const resume = () => {
    stopPreview();
    r?.resume();
  };

  const send = async () => {
    if (!r || sending) return;
    setSending(true);
    audio.current?.pause();
    try {
      await onSend(await r.done());
    } finally {
      setSending(false);
    }
  };

  const togglePreview = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const seek = (fraction: number) => {
    const a = audio.current;
    if (!a || !ms) return;
    a.currentTime = (fraction * ms) / 1000;
    setPreviewAt(a.currentTime);
  };

  const progress = ms ? Math.min(1, (previewAt * 1000) / ms) : 0;

  return (
    <div className="voice-bar" role="group" aria-label="Recording a voice message">
      <button
        type="button"
        className="ghost-btn composer-tool"
        aria-label="Delete recording"
        title="Delete"
        onClick={() => {
          stopPreview();
          r?.cancel();
          onCancel();
        }}
      >
        <TrashIcon />
      </button>

      {recording || !r ? (
        <>
          <span className="voice-dot live" aria-hidden="true" />
          <span className="voice-time">{formatDuration(ms)}</span>
          <span className="voice-meter" aria-hidden="true">
            {Array.from({ length: METER_BARS }, (_, i) => {
              const level = r?.levels[r.levels.length - METER_BARS + i] ?? 0;
              return <span key={i} style={{ height: `${Math.max(10, Math.round(level * 100))}%` }} />;
            })}
          </span>
          <button
            type="button"
            className="ghost-btn composer-tool voice-red"
            aria-label="Pause recording"
            title="Pause"
            disabled={!r}
            onClick={pause}
          >
            <PauseIcon />
          </button>
        </>
      ) : (
        <>
          {previewUrl && (
            <audio
              ref={audio}
              src={previewUrl}
              preload="auto"
              onPlay={() => setPreviewing(true)}
              onPause={() => setPreviewing(false)}
              onEnded={() => {
                setPreviewing(false);
                setPreviewAt(0);
              }}
              onTimeUpdate={(e) => setPreviewAt(e.currentTarget.currentTime)}
            />
          )}
          <button
            type="button"
            className="ghost-btn composer-tool"
            aria-label={previewing ? 'Pause playback' : 'Play recording'}
            title={previewing ? 'Pause' : 'Listen'}
            disabled={!previewUrl}
            onClick={togglePreview}
          >
            {previewing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span
            className="voice-preview"
            role="slider"
            tabIndex={0}
            aria-label="Position in recording"
            aria-valuemin={0}
            aria-valuemax={Math.round(ms / 1000)}
            aria-valuenow={Math.round(previewAt)}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              seek(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') seek(Math.min(1, progress + 0.05));
              if (e.key === 'ArrowLeft') seek(Math.max(0, progress - 0.05));
            }}
          >
            {r.bars(PREVIEW_BARS).map((b, i) => (
              <span
                key={i}
                className={(i + 0.5) / PREVIEW_BARS <= progress ? 'played' : ''}
                style={{ height: `${Math.max(14, Math.round(b * 100))}%` }}
              />
            ))}
            <span className="voice-playhead" style={{ left: `${progress * 100}%` }} aria-hidden="true" />
          </span>
          <span className="voice-time">{formatDuration(previewing || previewAt > 0 ? previewAt * 1000 : ms)}</span>
          {r.state === 'paused' && (
            <button
              type="button"
              className="ghost-btn composer-tool voice-red"
              aria-label="Continue recording"
              title="Continue recording"
              onClick={resume}
            >
              <MicIcon />
            </button>
          )}
        </>
      )}

      <button
        type="button"
        className="send-btn appear"
        aria-label="Send voice message"
        aria-disabled={!r || sending}
        onClick={() => void send()}
      >
        <SendIcon />
      </button>
    </div>
  );
}
