/**
 * Shows an attachment in a chat bubble or a panel list. Small files (kept on
 * this device) show as images, video or audio; large ones as a card that
 * saves them to disk, downloading and decrypting as a stream.
 */
import { useEffect, useState } from 'react';
import { INLINE_MAX_BYTES, type Attachment } from '../core/delivery/realMessaging';
import { DownloadIcon, FileIcon, MaximizeIcon } from './icons';
import { ImageViewer } from './ImageViewer';
import { VoicePlayer } from './voice/VoicePlayer';

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** One object URL per small file for the whole session (released when the file is deleted). */
const urlCache = new Map<string, string>();

/** Forgets a deleted file's in-memory copy (its object URL). */
export function releaseFile(fileId: string): void {
  const url = urlCache.get(fileId);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(fileId);
}

interface Props {
  a: Attachment;
  load: (fileId: string) => Promise<Uint8Array | null>;
  /** Saves the file to disk; reports progress 0..1. */
  save: (onProgress: (fraction: number) => void) => Promise<void>;
  /** Retries a failed upload (only while its file is still available). */
  retry?: () => Promise<void>;
  /** Outgoing large file still waiting for the friend: send it through Sia now. */
  sendViaSia?: () => Promise<void>;
  /** Keep a copy in the user's own Sia space. */
  saveToSia?: () => Promise<void>;
  /** For a large file waiting on a direct link: what is happening (replaces the generic wait text). */
  waitNote?: string;
  /** Loads the whole file as a Blob, to play a large video in the chat. */
  openBlob?: (onProgress: (fraction: number) => void) => Promise<Blob>;
}

/** Larger videos are saved to the device and played there (a Blob this big may not fit in memory). */
export const INLINE_PLAY_MAX_BYTES = 1024 * 1024 * 1024;

export function AttachmentView({ a, load, save, retry, sendViaSia, saveToSia, openBlob, waitNote }: Props) {
  const [playing, setPlaying] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const [url, setUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewable = a.size <= INLINE_MAX_BYTES && !a.localChunks && a.via === 'inline';

  useEffect(() => {
    let alive = true;
    if (!previewable) return;
    const cached = urlCache.get(a.fileId);
    if (cached) {
      setUrl(cached);
      return;
    }
    if (a.state === 'ready' || a.state === 'sending' || a.state === 'failed') {
      void load(a.fileId).then((bytes) => {
        if (!alive || !bytes) return;
        const made = urlCache.get(a.fileId) ?? URL.createObjectURL(new Blob([bytes], { type: a.mime }));
        urlCache.set(a.fileId, made);
        setUrl(made);
      });
    }
    return () => {
      alive = false;
    };
  }, [a.fileId, a.state, a.mime, load, previewable]);

  const kind = a.mime.startsWith('image/')
    ? 'image'
    : a.mime.startsWith('video/')
      ? 'video'
      : a.mime.startsWith('audio/')
        ? 'audio'
        : 'file';
  const pct = a.total ? Math.round((a.done / a.total) * 100) : 0;
  const large = a.size > INLINE_MAX_BYTES;
  const status =
    saving !== null
      ? `Saving… ${Math.round(saving * 100)}%`
      : busy
        ? busy
        : a.state === 'sending'
          ? a.via === 'p2p'
            ? pct === 0
              ? (waitNote ?? 'Waiting for your friend to come online')
              : `Sending… ${pct}% · keep this page open`
            : large
              ? `Uploading… ${pct}% · keep this page open`
              : `Sending… ${pct}%`
          : a.state === 'receiving'
            ? a.via === 'p2p' && a.done === 0
              ? (waitNote ?? 'Waiting for the sender to come online')
              : `Receiving… ${pct}%`
          : a.state === 'failed'
            ? 'Not sent'
            : null;

  const doSave = async () => {
    setError(null);
    setSaving(0);
    try {
      await save((f) => setSaving(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  const showProgress = a.state === 'sending' || a.state === 'receiving' || saving !== null;
  const progress = saving !== null ? Math.round(saving * 100) : pct;

  // Large videos: preview frame with a play button; the file is loaded when played.
  const playable = (a.state === 'ready' || a.state === 'remote') && a.size <= INLINE_PLAY_MAX_BYTES && !!openBlob;
  const play = async () => {
    if (!openBlob) return;
    setError(null);
    setPlaying(0);
    try {
      const cached = urlCache.get(a.fileId);
      const src = cached ?? URL.createObjectURL(await openBlob((f) => setPlaying(f)));
      urlCache.set(a.fileId, src);
      setUrl(src);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlaying(null);
    }
  };
  if (a.voice) {
    return (
      <div className="attachment kind-voice">
        <VoicePlayer
          voice={a.voice}
          src={url}
          status={a.state === 'sending' || a.state === 'receiving' || a.state === 'failed' ? status : null}
        />
        {a.state === 'failed' && retry && (
          <button type="button" className="att-retry" onClick={() => void retry().catch((e) => setError(String(e?.message ?? e)))}>
            Retry
          </button>
        )}
        {error && <span className="att-error">{error}</span>}
      </div>
    );
  }

  if (kind === 'video' && !previewable) {
    return (
      <div className="attachment kind-video">
        {url ? (
          <video src={url} controls autoPlay className="att-media" />
        ) : (
          <button
            type="button"
            className="att-video-tile"
            disabled={!playable || playing !== null}
            onClick={() => void play()}
            aria-label={playable ? `Play ${a.name}` : a.name}
            title={a.size > INLINE_PLAY_MAX_BYTES ? 'Save it to play (over 1 GB)' : undefined}
          >
            {a.thumb ? <img src={a.thumb} alt="" /> : <span className="att-video-blank" aria-hidden="true" />}
            {playable && (
              <span className="att-play" aria-hidden="true">
                {playing === null ? '▶' : `${Math.round(playing * 100)}%`}
              </span>
            )}
          </button>
        )}
        <div className="att-card att-card-slim">
          <span className="att-meta">
            <span className="att-name">{a.name}</span>
            <span className="att-size">
              {formatSize(a.size)}
              {status ? ` · ${status}` : playing !== null ? ' · Loading…' : ''}
            </span>
          </span>
          {a.state === 'failed' && retry && (
            <button type="button" className="att-retry" onClick={() => void retry().catch((e) => setError(String(e?.message ?? e)))}>
              Retry
            </button>
          )}
          {sendViaSia && !busy && (
            <button type="button" className="att-retry" onClick={() => void run('Uploading to Sia…', sendViaSia)}>
              Send via Sia now
            </button>
          )}
          {saveToSia && !busy && !a.backup && (
            <button type="button" className="att-retry" onClick={() => void run('Saving to your Sia…', saveToSia)}>
              Save to my Sia
            </button>
          )}
          {a.backup && <span className="att-saved">In your Sia ✓</span>}
          {(a.state === 'ready' || a.state === 'remote') && (
            <button
              type="button"
              className="att-btn"
              disabled={saving !== null}
              onClick={() => void doSave()}
              aria-label={`Save ${a.name}`}
              title="Save to this device"
            >
              {saving !== null ? '…' : <DownloadIcon />}
            </button>
          )}
        </div>
        {showProgress && (
          <div className="att-progress" aria-hidden="true">
            <span style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
        )}
        {error && <span className="att-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className={`attachment kind-${kind}`}>
      {url && kind === 'image' && (
        // The image opens large (at its own proportions); on hover an expand icon shows.
        <button type="button" className="att-image" aria-label={`View ${a.name}`} onClick={() => setViewing(true)}>
          <img src={url} alt={a.name} className="att-media" />
          <span className="att-expand" aria-hidden="true">
            <MaximizeIcon />
          </span>
        </button>
      )}
      {viewing && url && <ImageViewer src={url} alt={a.name} onClose={() => setViewing(false)} />}
      {url && kind === 'video' && <video src={url} controls className="att-media" preload="metadata" />}
      {url && kind === 'audio' && <audio src={url} controls className="att-audio" />}
      {!url && a.thumb && (kind === 'image' || kind === 'video') && (
        <img src={a.thumb} alt="" className="att-media att-thumb" />
      )}
      {(kind === 'file' || !url) && (
        <div className="att-card">
          <FileIcon />
          <span className="att-meta">
            <span className="att-name">{a.name}</span>
            <span className="att-size">
              {formatSize(a.size)}
              {status ? ` · ${status}` : ''}
            </span>
          </span>
          {a.state === 'failed' && retry && (
            <button type="button" className="att-retry" onClick={() => void retry().catch((e) => setError(String(e?.message ?? e)))}>
              Retry
            </button>
          )}
          {sendViaSia && !busy && (
            <button type="button" className="att-retry" onClick={() => void run('Uploading to Sia…', sendViaSia)}>
              Send via Sia now
            </button>
          )}
          {saveToSia && !busy && !a.backup && (
            <button type="button" className="att-retry" onClick={() => void run('Saving to your Sia…', saveToSia)}>
              Save to my Sia
            </button>
          )}
          {a.backup && <span className="att-saved">In your Sia ✓</span>}
          {(a.state === 'ready' || a.state === 'remote') && (
            <button
              type="button"
              className="att-btn"
              disabled={saving !== null}
              onClick={() => void doSave()}
              aria-label={`Save ${a.name}`}
              title="Save to this device"
            >
              {saving !== null ? '…' : <DownloadIcon />}
            </button>
          )}
        </div>
      )}
      {showProgress && (
        <div className="att-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(4, progress)}%` }} />
        </div>
      )}
      {error && <span className="att-error">{error}</span>}
    </div>
  );
}
