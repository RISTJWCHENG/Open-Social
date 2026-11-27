/**
 * One listing: photo gallery, price, details, description and seller; for
 * buyers Message seller, Save, Share and Report; for the seller Edit,
 * Reserved / Sold / Available and Delete.
 */
import { useEffect, useState } from 'react';
import {
  categoryLabel,
  conditionLabel,
  formatPrice,
  listedAgo,
  listingLink,
  STATUS_LABELS,
  type Listing,
} from '../../core/market/market';
import { Avatar } from '../Avatar';
import { BackIcon, ChevronRightIcon, HeartIcon, MapPinIcon, ShareIcon } from '../icons';
import { usePhoto, type PhotoLoader } from './marketPhotos';

const REPORT_REASONS = [
  'Prohibited or illegal item',
  'Scam or fraud',
  'Wrong category or spam',
  'Offensive content',
  'Something else',
];

interface Props {
  /** undefined while loading; null when not found. */
  listing: Listing | null | undefined;
  me?: string;
  saved: boolean;
  photo: PhotoLoader;
  onBack(): void;
  onToggleSave(): void;
  onMessage(l: Listing): void;
  onSellerListings(l: Listing): void;
  onEdit(): void;
  onStatus(s: 'active' | 'reserved' | 'sold'): Promise<void>;
  onDelete(): Promise<void>;
  onReport(reason: string): Promise<void>;
}

function Photo({
  load,
  id,
  hash,
  mime,
  alt,
}: {
  load: PhotoLoader;
  id: string;
  hash?: string;
  mime?: string;
  alt: string;
}) {
  const url = usePhoto(load, id, hash, mime);
  return url ? <img src={url} alt={alt} /> : <span className="mk-photo-wait" aria-hidden="true" />;
}

export function ListingDetail(p: Props) {
  const l = p.listing;
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0]!);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIndex(0);
    setConfirmDelete(false);
    setReporting(false);
    setNotice(null);
    setError(null);
  }, [l?.id]);

  if (l === undefined || l === null) {
    return (
      <main className="chat-main mk-main" aria-label="Listing">
        <header className="ev-bar">
          <button type="button" className="hdr-btn back mk-back" onClick={p.onBack} aria-label="Back to listings">
            <BackIcon />
          </button>
        </header>
        <div className="mk-empty">
          <p>{l === null ? 'This listing is no longer available.' : 'Loading…'}</p>
        </div>
      </main>
    );
  }

  const mine = !!p.me && l.seller === p.me;
  const photos = l.photos;
  const current = photos[Math.min(index, photos.length - 1)];
  const run = async (f: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    const link = listingLink(l.id, location.origin);
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Link copied.');
    } catch {
      setNotice(link);
    }
  };

  return (
    <main className="chat-main mk-main mk-detail-main" aria-label={l.title}>
      <header className="ev-bar">
        <button type="button" className="hdr-btn back mk-back" onClick={p.onBack} aria-label="Back to listings">
          <BackIcon />
        </button>
        <span className="mk-crumb">{categoryLabel(l.category)}</span>
      </header>
      <div className="mk-detail">
        <div className="mk-gallery">
          <div className="mk-gallery-main">
            <Photo load={p.photo} id={l.id} hash={current?.hash} mime={current?.mime} alt={l.title} />
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  className="mk-nav is-prev"
                  aria-label="Previous photo"
                  onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
                >
                  <ChevronRightIcon />
                </button>
                <button
                  type="button"
                  className="mk-nav is-next"
                  aria-label="Next photo"
                  onClick={() => setIndex((i) => (i + 1) % photos.length)}
                >
                  <ChevronRightIcon />
                </button>
                <span className="mk-gallery-count">
                  {index + 1} / {photos.length}
                </span>
              </>
            )}
          </div>
          {photos.length > 1 && (
            <div className="mk-thumbs" role="group" aria-label="Photos">
              {photos.map((ph, i) => (
                <button
                  key={ph.hash}
                  type="button"
                  className="mk-thumb"
                  aria-pressed={i === index}
                  aria-label={`Photo ${i + 1}`}
                  onClick={() => setIndex(i)}
                >
                  <Photo load={p.photo} id={l.id} hash={ph.hash} mime={ph.mime} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mk-info">
          {l.status !== 'active' && (
            <span className={`mk-badge is-${l.status} is-inline`}>{STATUS_LABELS[l.status]}</span>
          )}
          <h1>{l.title}</h1>
          <p className="mk-price">
            {formatPrice(l.price, l.currency)}
            {l.negotiable && l.price > 0 && <span className="mk-nego">Negotiable</span>}
          </p>
          <p className="mk-listed">
            Listed {listedAgo(l.createdAt)}
            {l.location && (
              <>
                {' '}
                in <MapPinIcon /> {l.location}
              </>
            )}
          </p>

          {!mine && (
            <div className="mk-actions">
              <button
                type="button"
                className="ev-btn is-primary mk-message"
                disabled={!p.me || l.status === 'sold'}
                onClick={() => p.onMessage(l)}
              >
                Message seller
              </button>
              <button type="button" className="ev-btn" aria-pressed={p.saved} onClick={p.onToggleSave}>
                <HeartIcon />
                {p.saved ? 'Saved' : 'Save'}
              </button>
              <button type="button" className="ev-btn" onClick={() => void share()}>
                <ShareIcon />
                Share
              </button>
            </div>
          )}
          {mine && (
            <div className="mk-actions">
              <button type="button" className="ev-btn is-primary" onClick={p.onEdit} disabled={l.status === 'hidden'}>
                Edit listing
              </button>
              {l.status === 'active' && (
                <button
                  type="button"
                  className="ev-btn"
                  disabled={busy}
                  onClick={() => void run(() => p.onStatus('reserved'))}
                >
                  Mark reserved
                </button>
              )}
              {(l.status === 'reserved' || l.status === 'sold') && (
                <button
                  type="button"
                  className="ev-btn"
                  disabled={busy}
                  onClick={() => void run(() => p.onStatus('active'))}
                >
                  Mark available
                </button>
              )}
              {l.status !== 'sold' && l.status !== 'hidden' && (
                <button
                  type="button"
                  className="ev-btn"
                  disabled={busy}
                  onClick={() => void run(() => p.onStatus('sold'))}
                >
                  Mark sold
                </button>
              )}
              <button type="button" className="ev-btn" onClick={() => void share()}>
                <ShareIcon />
                Share
              </button>
              <button type="button" className="ev-btn is-danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            </div>
          )}
          {l.status === 'hidden' && mine && (
            <p className="mk-warn">This listing was reported and is hidden while it is reviewed.</p>
          )}
          {confirmDelete && (
            <div className="ev-confirm" role="alertdialog" aria-label="Delete listing">
              <p>Delete this listing and its photos? This can't be undone.</p>
              <div className="ev-form-actions">
                <button type="button" className="ev-btn" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Keep it
                </button>
                <button
                  type="button"
                  className="ev-btn is-danger-solid"
                  disabled={busy}
                  onClick={() => void run(p.onDelete)}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          {notice && (
            <p className="mk-notice" role="status">
              {notice}
            </p>
          )}
          {error && <p className="ev-error">{error}</p>}

          <dl className="mk-facts">
            <div>
              <dt>Condition</dt>
              <dd>{conditionLabel(l.condition)}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{categoryLabel(l.category)}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>{[l.pickup && 'Pickup', l.shipping && 'Shipping'].filter(Boolean).join(' · ')}</dd>
            </div>
          </dl>

          {l.description && (
            <section className="mk-section">
              <h3>Description</h3>
              <p className="mk-description">{l.description}</p>
            </section>
          )}

          <section className="mk-section">
            <h3>Seller</h3>
            <button type="button" className="mk-seller" onClick={() => p.onSellerListings(l)}>
              <Avatar name={l.sellerName || 'Seller'} seed={l.seller} className="avatar-40" />
              <span className="mk-seller-text">
                <strong>{mine ? 'You' : l.sellerName || 'OpenSocial user'}</strong>
                <span>
                  {l.seller.slice(0, 5)}…{l.seller.slice(-3)} · See all listings
                </span>
              </span>
              <ChevronRightIcon />
            </button>
          </section>

          <section className="mk-section mk-safety">
            <h3>Stay safe</h3>
            <p>
              Meet in a public place, check the item before you pay, and never share codes or passwords. OpenSocial does
              not handle payments.
            </p>
            {!mine && p.me && !reporting && (
              <button type="button" className="link-btn" onClick={() => setReporting(true)}>
                Report this listing
              </button>
            )}
            {reporting && (
              <div className="mk-report">
                <label className="ev-field">
                  <span>Why are you reporting it?</span>
                  <select value={reason} onChange={(e) => setReason(e.target.value)}>
                    {REPORT_REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <div className="ev-form-actions">
                  <button type="button" className="ev-btn" onClick={() => setReporting(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="ev-btn is-danger-solid"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await p.onReport(reason);
                        setReporting(false);
                      }, 'Thanks. The listing was reported.')
                    }
                  >
                    Report
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
