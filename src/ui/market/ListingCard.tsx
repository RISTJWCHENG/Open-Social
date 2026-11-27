/** A listing tile in the grid: cover photo, price, title, place and age. */
import { formatPrice, listedAgo, STATUS_LABELS, type Listing } from '../../core/market/market';
import { HeartIcon } from '../icons';
import { usePhoto, type PhotoLoader } from './marketPhotos';

interface Props {
  listing: Listing;
  saved: boolean;
  photo: PhotoLoader;
  onOpen(): void;
  onToggleSave?(): void;
}

export function ListingCard({ listing: l, saved, photo, onOpen, onToggleSave }: Props) {
  const cover = l.photos[0];
  const url = usePhoto(photo, l.id, cover?.hash, cover?.mime);
  return (
    <article className={`mk-card is-${l.status}`}>
      <button
        type="button"
        className="mk-card-open"
        onClick={onOpen}
        aria-label={`${l.title}, ${formatPrice(l.price, l.currency)}`}
      >
        <span className="mk-card-photo">
          {url ? <img src={url} alt="" loading="lazy" /> : <span className="mk-photo-wait" aria-hidden="true" />}
          {l.status !== 'active' && <span className={`mk-badge is-${l.status}`}>{STATUS_LABELS[l.status]}</span>}
        </span>
        <span className="mk-card-price">{formatPrice(l.price, l.currency)}</span>
        <span className="mk-card-title">{l.title}</span>
        <span className="mk-card-meta">{[l.location, listedAgo(l.createdAt)].filter(Boolean).join(' · ')}</span>
      </button>
      {onToggleSave && (
        <button
          type="button"
          className="mk-save"
          aria-pressed={saved}
          aria-label={saved ? 'Remove from saved' : 'Save'}
          title={saved ? 'Remove from saved' : 'Save'}
          onClick={onToggleSave}
        >
          <HeartIcon />
        </button>
      )}
    </article>
  );
}
