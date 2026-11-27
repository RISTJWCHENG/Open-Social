/**
 * Plays an item's uploaded video or audio. The file is fetched only when the
 * viewer presses play (it can be several MB), with progress shown.
 */
import { useEffect, useState } from 'react';
import type { SpaceItem } from '../../core/space/space';
import { hostOf } from '../../core/space/space';
import type { SpaceClient } from '../../modules/space/spaceClient';
import { ExternalLinkIcon, PlayIcon } from '../icons';
import { usePhoto, type PhotoLoader } from '../market/marketPhotos';

const loaded = new Map<string, string>();

export function MediaPlayer({ item, client, image }: { item: SpaceItem; client: SpaceClient; image: PhotoLoader }) {
  const m = item.media;
  const cover = item.images[0];
  const coverUrl = usePhoto(image, item.id, cover?.hash, cover?.mime);
  const [src, setSrc] = useState<string | null>(m ? (loaded.get(m.id) ?? null) : null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = item.kind === 'video';

  useEffect(() => {
    setSrc(m ? (loaded.get(m.id) ?? null) : null);
    setProgress(null);
    setError(null);
  }, [m]);

  if (!m) {
    if (!item.url) return null;
    return (
      <div className={`sp-player is-link${video ? ' is-video' : ''}`}>
        {coverUrl && <img src={coverUrl} alt="" />}
        <a className="ev-btn is-primary sp-open-link" href={item.url} target="_blank" rel="noopener noreferrer">
          <PlayIcon />
          {video ? 'Watch' : 'Listen'} on {hostOf(item.url)}
          <ExternalLinkIcon />
        </a>
      </div>
    );
  }

  const play = async () => {
    setError(null);
    setProgress(0);
    try {
      const blob = await client.media(m, setProgress);
      const url = URL.createObjectURL(blob);
      loaded.set(m.id, url);
      setSrc(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  if (src) {
    return video ? (
      <video className="sp-video" src={src} controls autoPlay playsInline poster={coverUrl ?? undefined} />
    ) : (
      <div className="sp-audio">
        {coverUrl && <img src={coverUrl} alt="" />}
        <audio src={src} controls autoPlay />
      </div>
    );
  }

  return (
    <div className={`sp-player${video ? ' is-video' : ' is-audio'}`}>
      {coverUrl && <img src={coverUrl} alt="" />}
      <button
        type="button"
        className="sp-play"
        onClick={() => void play()}
        disabled={progress !== null}
        aria-label={video ? 'Play video' : 'Play track'}
      >
        {progress === null ? <PlayIcon /> : <span className="sp-progress">{Math.round(progress * 100)}%</span>}
      </button>
      {error && <p className="ev-error sp-player-error">{error}</p>}
    </div>
  );
}
