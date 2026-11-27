/** One item in a space or a feed, drawn to suit its kind. */
import { hostOf, kindLabel, type SpaceItem } from '../../core/space/space';
import { listedAgo } from '../../core/market/market';
import { Avatar } from '../Avatar';
import { HeartIcon, PinIcon, PlayIcon } from '../icons';
import { usePhoto, type PhotoLoader } from '../market/marketPhotos';
import type { Person } from './useSpace';

interface Props {
  item: SpaceItem;
  image: PhotoLoader;
  liked: boolean;
  likes: number;
  onLike?(): void;
  onOpen(): void;
  /** In feeds: who posted it. */
  owner?: Person;
  onOpenOwner?(): void;
  pinned?: boolean;
}

function Img({ item, index, image }: { item: SpaceItem; index: number; image: PhotoLoader }) {
  const im = item.images[index];
  const url = usePhoto(image, item.id, im?.hash, im?.mime);
  return url ? <img src={url} alt="" loading="lazy" /> : <span className="mk-photo-wait" aria-hidden="true" />;
}

export function ItemCard({ item: i, image, liked, likes, onLike, onOpen, owner, onOpenOwner, pinned }: Props) {
  const n = i.images.length;
  return (
    <article className={`sp-card is-${i.kind}${i.hidden ? ' is-hidden' : ''}`}>
      {owner && (
        <header className="sp-card-owner">
          <button type="button" className="sp-owner-btn" onClick={onOpenOwner}>
            <Avatar name={owner.name} src={owner.avatar} seed={i.owner} className="avatar-32" />
            <span className="sp-owner-name">{owner.name}</span>
          </button>
          <span className="sp-card-when">{listedAgo(i.createdAt)}</span>
        </header>
      )}
      <button
        type="button"
        className="sp-card-open"
        onClick={onOpen}
        aria-label={`Open ${kindLabel(i.kind).toLowerCase()}: ${i.title || i.body.slice(0, 40) || hostOf(i.url)}`}
      >
        {(i.kind === 'work' || i.kind === 'video' || (i.kind === 'link' && n > 0)) && (
          <span className={`sp-cover${i.kind === 'video' ? ' is-wide' : ''}`}>
            {n > 0 ? <Img item={i} index={0} image={image} /> : <span className="sp-cover-blank" aria-hidden="true" />}
            {i.kind === 'video' && (
              <span className="sp-cover-play" aria-hidden="true">
                <PlayIcon />
              </span>
            )}
            {i.kind === 'work' && n > 1 && <span className="sp-cover-count">{n}</span>}
          </span>
        )}
        {i.kind === 'post' && n > 0 && (
          <span className={`sp-post-grid is-${Math.min(n, 4)}`}>
            {i.images.slice(0, 4).map((im, k) => (
              <span key={im.hash} className="sp-post-img">
                <Img item={i} index={k} image={image} />
                {k === 3 && n > 4 && <span className="sp-more-imgs">+{n - 4}</span>}
              </span>
            ))}
          </span>
        )}
        {(i.kind === 'music' || i.kind === 'dapp') && (
          <span className="sp-row">
            <span className={`sp-thumb is-${i.kind}`}>
              {n > 0 ? <Img item={i} index={0} image={image} /> : <span className="sp-thumb-mark" aria-hidden="true" />}
              {i.kind === 'music' && (
                <span className="sp-thumb-play" aria-hidden="true">
                  <PlayIcon />
                </span>
              )}
            </span>
            <span className="sp-row-text">
              <span className="sp-kind">{kindLabel(i.kind)}</span>
              <span className="sp-title">{i.title}</span>
              {i.kind === 'dapp' && <span className="sp-host">{hostOf(i.url)}</span>}
              {i.kind === 'music' && !i.media && i.url && <span className="sp-host">{hostOf(i.url)}</span>}
            </span>
          </span>
        )}
        {i.kind !== 'music' && i.kind !== 'dapp' && (
          <span className="sp-card-text">
            {i.kind !== 'post' && (
              <span className="sp-kind">{i.kind === 'link' ? hostOf(i.url) : kindLabel(i.kind)}</span>
            )}
            {i.title && <span className="sp-title">{i.title}</span>}
            {i.body && <span className={`sp-body${i.kind === 'post' ? ' is-post' : ''}`}>{i.body}</span>}
          </span>
        )}
      </button>
      <footer className="sp-card-foot">
        {pinned && (
          <span className="sp-pinned">
            <PinIcon />
            Pinned
          </span>
        )}
        {i.hidden && <span className="mk-badge is-hidden is-inline">Under review</span>}
        {i.tags.length > 0 && <span className="sp-tags">{i.tags.map((t) => `#${t}`).join(' ')}</span>}
        <button
          type="button"
          className="sp-like"
          aria-pressed={liked}
          aria-label={`${liked ? 'Unlike' : 'Like'} (${likes})`}
          disabled={!onLike}
          onClick={onLike}
        >
          <HeartIcon />
          {likes > 0 && <span>{likes}</span>}
        </button>
      </footer>
    </article>
  );
}
