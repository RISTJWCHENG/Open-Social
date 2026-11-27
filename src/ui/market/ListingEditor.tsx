/**
 * Create or edit a listing: photos (up to 6, first is the cover), title,
 * price and currency (or free), category, condition, description, location,
 * and pickup / shipping.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CATEGORIES,
  CONDITIONS,
  CURRENCIES,
  draftErrors,
  LIMITS,
  MAX_PHOTOS,
  parsePrice,
  priceText,
  type Listing,
  type ListingDraft,
  type ListingInput,
} from '../../core/market/market';
import { BackIcon, CameraPlusIcon, CloseIcon } from '../icons';
import { shrinkPhoto, usePhoto, type PhotoLoader } from './marketPhotos';

type EditorPhoto = { key: string; hash: string; mime: string } | { key: string; bytes: Uint8Array; url: string };

interface Props {
  listing?: Listing;
  sellerName: string;
  location: string;
  photo: PhotoLoader;
  onSave(input: ListingInput): Promise<void>;
  onCancel(): void;
}

function Thumb({ p, listingId, load }: { p: EditorPhoto; listingId?: string; load: PhotoLoader }) {
  const stored = usePhoto(load, listingId ?? '', 'hash' in p ? p.hash : undefined, 'hash' in p ? p.mime : undefined);
  const url = 'url' in p ? p.url : stored;
  return url ? <img src={url} alt="" /> : <span className="mk-photo-wait" aria-hidden="true" />;
}

export function ListingEditor({ listing, sellerName, location, photo, onSave, onCancel }: Props) {
  const [d, setD] = useState<ListingDraft>(() => ({
    title: listing?.title ?? '',
    description: listing?.description ?? '',
    category: listing?.category ?? '',
    condition: listing?.condition ?? '',
    price: listing ? priceText(listing.price, listing.currency) : '',
    free: listing ? listing.price === 0 : false,
    currency: listing?.currency ?? 'EUR',
    negotiable: listing?.negotiable ?? false,
    location: listing?.location ?? location,
    shipping: listing?.shipping ?? false,
    pickup: listing?.pickup ?? true,
    photoCount: listing?.photos.length ?? 0,
  }));
  const [photos, setPhotos] = useState<EditorPhoto[]>(
    () => listing?.photos.map((p) => ({ key: p.hash, hash: p.hash, mime: p.mime })) ?? [],
  );
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(
    () => () => {
      photos.forEach((p) => 'url' in p && URL.revokeObjectURL(p.url));
    },
    // Revoke previews only when the editor closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const draft = { ...d, photoCount: photos.length };
  const errors = tried ? draftErrors(draft) : {};
  const set = <K extends keyof ListingDraft>(k: K, v: ListingDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setAdding(true);
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const picked = Array.from(files).slice(0, room);
      const added: EditorPhoto[] = [];
      for (const f of picked) {
        const bytes = await shrinkPhoto(f);
        added.push({ key: `new-${++seq.current}`, bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart])) });
      }
      setPhotos((ps) => [...ps, ...added].slice(0, MAX_PHOTOS));
      if (files.length > room) setError(`Only ${MAX_PHOTOS} photos fit; the rest were left out.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
      if (file.current) file.current.value = '';
    }
  };

  const move = (i: number, to: number) =>
    setPhotos((ps) => {
      const next = [...ps];
      const [p] = next.splice(i, 1);
      next.splice(to, 0, p!);
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(draftErrors(draft)).length) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        sellerName: sellerName.slice(0, LIMITS.sellerName),
        title: d.title.trim(),
        description: d.description.trim(),
        category: d.category,
        condition: d.condition,
        price: d.free ? 0 : (parsePrice(d.price, d.currency) ?? 0),
        currency: d.currency,
        negotiable: !d.free && d.negotiable,
        location: d.location.trim(),
        shipping: d.shipping,
        pickup: d.pickup,
        photos: photos.map((p) => ('hash' in p ? { keep: p.hash } : { add: p.bytes })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="chat-main ev-main mk-editor" aria-label={listing ? 'Edit listing' : 'Sell an item'}>
      <header className="ev-bar">
        <button type="button" className="hdr-btn back mk-back" onClick={onCancel} aria-label="Back">
          <BackIcon />
        </button>
        <h2>{listing ? 'Edit listing' : 'Sell an item'}</h2>
      </header>
      <form className="ev-form" onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="ev-field">
          <legend>
            Photos{' '}
            <span className="ev-hint">
              {photos.length} / {MAX_PHOTOS} · the first photo is the cover
            </span>
          </legend>
          <div className="mk-photos">
            {photos.map((p, i) => (
              <div key={p.key} className="mk-photo-slot">
                <Thumb p={p} listingId={listing?.id} load={photo} />
                {i === 0 && <span className="mk-cover-tag">Cover</span>}
                <button
                  type="button"
                  className="mk-photo-remove"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => {
                    if ('url' in p) URL.revokeObjectURL(p.url);
                    setPhotos((ps) => ps.filter((x) => x.key !== p.key));
                  }}
                >
                  <CloseIcon />
                </button>
                {i > 0 && (
                  <button type="button" className="mk-photo-cover" onClick={() => move(i, 0)}>
                    Make cover
                  </button>
                )}
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                className="mk-photo-add"
                disabled={adding}
                onClick={() => file.current?.click()}
                aria-label="Add photos"
              >
                <CameraPlusIcon />
                <span>{adding ? 'Adding…' : 'Add photos'}</span>
              </button>
            )}
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="listing-photos"
            onChange={(e) => void addFiles(e.target.files)}
          />
          {errors.photoCount && <p className="ev-error">{errors.photoCount}</p>}
        </fieldset>

        <label className="ev-field">
          <span>Title</span>
          <input
            value={d.title}
            maxLength={LIMITS.title}
            placeholder="What are you selling?"
            onChange={(e) => set('title', e.target.value)}
            aria-invalid={!!errors.title}
          />
          {errors.title && <span className="ev-error">{errors.title}</span>}
        </label>

        <div className="ev-field">
          <span>Price</span>
          <div className="mk-price-row">
            <select
              aria-label="Currency"
              value={d.currency}
              disabled={d.free}
              onChange={(e) => set('currency', e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
            <input
              aria-label="Price"
              inputMode="decimal"
              placeholder="0.00"
              value={d.free ? '' : d.price}
              disabled={d.free}
              onChange={(e) => set('price', e.target.value)}
              aria-invalid={!!errors.price}
            />
          </div>
          <div className="mk-checks">
            <label className="ev-switch">
              <input type="checkbox" checked={d.free} onChange={(e) => set('free', e.target.checked)} />
              Free
            </label>
            <label className="ev-switch">
              <input
                type="checkbox"
                checked={d.negotiable && !d.free}
                disabled={d.free}
                onChange={(e) => set('negotiable', e.target.checked)}
              />
              Price is negotiable
            </label>
          </div>
          {errors.price && <span className="ev-error">{errors.price}</span>}
        </div>

        <div className="ev-when">
          <label className="ev-field">
            <span>Category</span>
            <select
              value={d.category}
              onChange={(e) => set('category', e.target.value)}
              aria-invalid={!!errors.category}
            >
              <option value="">Choose…</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {errors.category && <span className="ev-error">{errors.category}</span>}
          </label>
          <label className="ev-field">
            <span>Condition</span>
            <select
              value={d.condition}
              onChange={(e) => set('condition', e.target.value)}
              aria-invalid={!!errors.condition}
            >
              <option value="">Choose…</option>
              {CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {errors.condition && <span className="ev-error">{errors.condition}</span>}
          </label>
        </div>

        <label className="ev-field">
          <span>Description</span>
          <textarea
            value={d.description}
            maxLength={LIMITS.description}
            rows={6}
            placeholder="Brand, size, age, what's included, any flaws…"
            onChange={(e) => set('description', e.target.value)}
          />
          <span className="ev-hint mk-counter">
            {d.description.length} / {LIMITS.description}
          </span>
        </label>

        <label className="ev-field">
          <span>Location</span>
          <input
            value={d.location}
            maxLength={LIMITS.location}
            placeholder="City or neighbourhood (no street address)"
            onChange={(e) => set('location', e.target.value)}
          />
        </label>

        <fieldset className="ev-field">
          <legend>Delivery</legend>
          <div className="mk-checks">
            <label className="ev-switch">
              <input type="checkbox" checked={d.pickup} onChange={(e) => set('pickup', e.target.checked)} />
              Pickup in person
            </label>
            <label className="ev-switch">
              <input type="checkbox" checked={d.shipping} onChange={(e) => set('shipping', e.target.checked)} />
              Can ship
            </label>
          </div>
          {errors.shipping && <span className="ev-error">{errors.shipping}</span>}
        </fieldset>

        <p className="ev-hint mk-public-hint">
          Listings are public: anyone can see them, with your name ({sellerName || 'OpenSocial user'}) and OpenSocial ID.
        </p>
        {error && <p className="ev-error">{error}</p>}
        <div className="ev-form-actions">
          <button type="button" className="ev-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="ev-btn is-primary" disabled={busy || adding}>
            {busy ? 'Publishing…' : listing ? 'Save changes' : 'Publish listing'}
          </button>
        </div>
      </form>
    </main>
  );
}
