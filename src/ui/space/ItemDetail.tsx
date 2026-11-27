/**
 * One item, full size: its media or images, text, link or dapp, tags and
 * likes; Share and Message for visitors, Edit / Pin / Delete for the owner.
 */
import { useEffect, useState } from 'react';
import { listedAgo } from '../../core/market/market';
import { hostOf, kindLabel, spaceLink, type SpaceItem } from '../../core/space/space';
import type { SpaceClient } from '../../modules/space/spaceClient';
import { Avatar } from '../Avatar';
import { CopyButton } from '../CopyButton';
import { BackIcon, ChevronRightIcon, ExternalLinkIcon, HeartIcon, ShareIcon } from '../icons';
import { usePhoto, type PhotoLoader } from '../market/marketPhotos';
import { linkParts } from '../../core/delivery/linkPreview';
import { MediaPlayer } from './MediaPlayer';
import type { Person } from './useSpace';

const REPORT_REASONS = ['Illegal content', 'Scam or fraud', 'Spam', 'Offensive content', 'Copyright', 'Something else'];

interface Props {
  item: SpaceItem | null | undefined;
  me?: string;
  owner: Person;
  client: SpaceClient;
  image: PhotoLoader;
  liked: boolean;
  likes: number;
  pinned: boolean;
  onBack(): void;
  onOpenOwner(): void;
  onLike(): Promise<void>;
  onMessage(): void;
  onEdit(): void;
  onPin(pin: boolean): Promise<void>;
  onDelete(): Promise<void>;
  onReport(reason: string): Promise<void>;
}

function Gallery({ item, image }: { item: SpaceItem; image: PhotoLoader }) {
  const [i, setI] = useState(0);
  const im = item.images[Math.min(i, item.images.length - 1)];
  const url = usePhoto(image, item.id, im?.hash, im?.mime);
  if (!im) return null;
  const n = item.images.length;
  return (
    <div className="sp-gallery">
      <div className="mk-gallery-main sp-gallery-main">
        {url ? <img src={url} alt={item.title} /> : <span className="mk-photo-wait" aria-hidden="true" />}
        {n > 1 && (
          <>
            <button
              type="button"
              className="mk-nav is-prev"
              aria-label="Previous image"
              onClick={() => setI((i - 1 + n) % n)}
            >
              <ChevronRightIcon />
            </button>
            <button type="button" className="mk-nav is-next" aria-label="Next image" onClick={() => setI((i + 1) % n)}>
              <ChevronRightIcon />
            </button>
            <span className="mk-gallery-count">
              {i + 1} / {n}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function ItemDetail(p: Props) {
  const it = p.item;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0]!);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirm(false);
    setReporting(false);
    setNotice(null);
    setError(null);
  }, [it?.id]);

  if (!it) {
    return (
      <main className="chat-main mk-main" aria-label="Item">
        <header className="ev-bar">
          <button type="button" className="hdr-btn back mk-back" onClick={p.onBack} aria-label="Back">
            <BackIcon />
          </button>
        </header>
        <div className="mk-empty">
          <p>{it === null ? 'This item is no longer available.' : 'Loading…'}</p>
        </div>
      </main>
    );
  }

  const mine = !!p.me && it.owner === p.me;
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
    const link = spaceLink(it.owner, it.id, location.origin);
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Link copied.');
    } catch {
      setNotice(link);
    }
  };
  const media = it.kind === 'video' || it.kind === 'music';

  return (
    <main className="chat-main mk-main sp-detail-main" aria-label={it.title || kindLabel(it.kind)}>
      <header className="ev-bar">
        <button type="button" className="hdr-btn back mk-back" onClick={p.onBack} aria-label="Back">
          <BackIcon />
        </button>
        <button type="button" className="sp-owner-btn" onClick={p.onOpenOwner}>
          <Avatar name={p.owner.name} src={p.owner.avatar} seed={it.owner} className="avatar-32" />
          <span className="sp-owner-name">{mine ? 'My Space' : `${p.owner.name}'s Space`}</span>
        </button>
      </header>
      <article className="sp-detail">
        <p className="sp-detail-meta">
          <span className="sp-kind">{kindLabel(it.kind)}</span> · {listedAgo(it.createdAt)}
          {it.updatedAt - it.createdAt > 60_000 && ' · edited'}
        </p>
        {it.title && <h1>{it.title}</h1>}
        {media && <MediaPlayer item={it} client={p.client} image={p.image} />}
        {!media && it.images.length > 0 && <Gallery item={it} image={p.image} />}
        {it.body && (
          <div className="sp-detail-body">
            {linkParts(it.body).map((part, k) =>
              part.url ? (
                <a key={k} href={part.url} target="_blank" rel="noopener noreferrer">
                  {part.text}
                </a>
              ) : (
                <span key={k}>{part.text}</span>
              ),
            )}
          </div>
        )}
        {(it.kind === 'link' || it.kind === 'dapp') && it.url && (
          <a className="sp-link-card" href={it.url} target="_blank" rel="noopener noreferrer">
            <span>
              <strong>{it.kind === 'dapp' ? 'Open dapp' : 'Open link'}</strong>
              <span>{it.url}</span>
            </span>
            <ExternalLinkIcon />
          </a>
        )}
        {media && it.media && it.url && (
          <a className="link-btn" href={it.url} target="_blank" rel="noopener noreferrer">
            Also on {hostOf(it.url)}
          </a>
        )}
        {it.canisterId && (
          <p className="sp-canister">
            <span>Canister</span>
            <code>{it.canisterId}</code>
            <CopyButton text={it.canisterId} label="Copy canister ID" />
            <a
              className="link-btn"
              href={`https://dashboard.internetcomputer.org/canister/${it.canisterId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Dashboard
            </a>
          </p>
        )}
        {it.tags.length > 0 && (
          <p className="sp-detail-tags">
            {it.tags.map((t) => (
              <span key={t} className="sp-tag">
                #{t}
              </span>
            ))}
          </p>
        )}

        <div className="mk-actions sp-actions">
          <button
            type="button"
            className="ev-btn sp-like-btn"
            aria-pressed={p.liked}
            disabled={!p.me || busy}
            onClick={() => void run(p.onLike)}
          >
            <HeartIcon />
            {p.likes > 0 ? p.likes : ''} {p.liked ? 'Liked' : 'Like'}
          </button>
          <button type="button" className="ev-btn" onClick={() => void share()}>
            <ShareIcon />
            Share
          </button>
          {!mine && p.me && (
            <button type="button" className="ev-btn" onClick={p.onMessage}>
              Message {p.owner.name}
            </button>
          )}
          {mine && (
            <>
              <button type="button" className="ev-btn" onClick={p.onEdit} disabled={it.hidden}>
                Edit
              </button>
              <button
                type="button"
                className="ev-btn"
                disabled={busy || it.hidden}
                onClick={() =>
                  void run(() => p.onPin(!p.pinned), p.pinned ? 'Unpinned.' : 'Pinned to the top of your space.')
                }
              >
                {p.pinned ? 'Unpin' : 'Pin to top'}
              </button>
              <button type="button" className="ev-btn is-danger" onClick={() => setConfirm(true)}>
                Delete
              </button>
            </>
          )}
        </div>
        {it.hidden && mine && <p className="mk-warn">This item was reported and is hidden while it is reviewed.</p>}
        {confirm && (
          <div className="ev-confirm" role="alertdialog" aria-label="Delete item">
            <p>Delete this {kindLabel(it.kind).toLowerCase()} and its files? This can't be undone.</p>
            <div className="ev-form-actions">
              <button type="button" className="ev-btn" onClick={() => setConfirm(false)} disabled={busy}>
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
        {!mine && p.me && (
          <div className="sp-report">
            {!reporting ? (
              <button type="button" className="link-btn" onClick={() => setReporting(true)}>
                Report
              </button>
            ) : (
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
                      }, 'Thanks. It was reported.')
                    }
                  >
                    Report
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </article>
    </main>
  );
}
