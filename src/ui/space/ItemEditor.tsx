/**
 * Add or edit an item in your space. A new item starts by choosing its
 * kind; each kind then asks for what it needs: text and photos for a post,
 * an address for a link or dapp, images for a work, a file or a link for
 * video and music, plus a title, tags and a cover where they fit.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  formatBytes,
  IMAGE_SLOTS,
  itemDraftErrors,
  KINDS,
  kindLabel,
  LIMITS,
  mediaMime,
  parseTags,
  type ItemDraft,
  type ItemInput,
  type ItemKind,
  type SpaceItem,
} from '../../core/space/space';
import type { FetchedPreview } from '../../core/delivery/linkPreview';
import { BackIcon, CameraPlusIcon, CloseIcon } from '../icons';
import { shrinkPhoto, usePhoto, type PhotoLoader } from '../market/marketPhotos';

type EditorImage = { key: string; hash: string; mime: string } | { key: string; bytes: Uint8Array; url: string };

interface Props {
  item?: SpaceItem;
  kind?: ItemKind;
  image: PhotoLoader;
  onUpload(file: Blob, mime: string, onProgress: (p: number) => void, signal: AbortSignal): Promise<string>;
  onSave(input: ItemInput): Promise<void>;
  onCancel(): void;
  fetchPreview?(url: string): Promise<FetchedPreview | null>;
  fetchPreviewImage?(imageUrl: string): Promise<string | undefined>;
}

function Thumb({ img, itemId, load }: { img: EditorImage; itemId?: string; load: PhotoLoader }) {
  const stored = usePhoto(
    load,
    itemId ?? '',
    'hash' in img ? img.hash : undefined,
    'hash' in img ? img.mime : undefined,
  );
  const url = 'url' in img ? img.url : stored;
  return url ? <img src={url} alt="" /> : <span className="mk-photo-wait" aria-hidden="true" />;
}

const dataUrlBytes = (d: string) => Uint8Array.from(atob(d.split(',')[1] ?? ''), (c) => c.charCodeAt(0));

function KindPicker({ onPick, onCancel }: { onPick(k: ItemKind): void; onCancel(): void }) {
  return (
    <main className="chat-main ev-main" aria-label="Add to your space">
      <header className="ev-bar">
        <button type="button" className="hdr-btn back mk-back" onClick={onCancel} aria-label="Back">
          <BackIcon />
        </button>
        <h2>Add to your space</h2>
      </header>
      <div className="ev-form">
        <div className="sp-kinds">
          {KINDS.map((k) => (
            <button key={k.id} type="button" className={`sp-kind-pick is-${k.id}`} onClick={() => onPick(k.id)}>
              <span className="sp-kind-dot" aria-hidden="true" />
              <strong>{k.label}</strong>
              <span>{k.hint}</span>
            </button>
          ))}
        </div>
        <p className="ev-hint">Everything in your space is public. Anyone with the link can see it.</p>
      </div>
    </main>
  );
}

export function ItemEditor(props: Props) {
  const [kind, setKind] = useState<ItemKind | undefined>(props.item?.kind ?? props.kind);
  if (!kind) return <KindPicker onPick={setKind} onCancel={props.onCancel} />;
  return <Form {...props} kind={kind} />;
}

function Form({
  item,
  kind,
  image,
  onUpload,
  onSave,
  onCancel,
  fetchPreview,
  fetchPreviewImage,
}: Props & { kind: ItemKind }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [tags, setTags] = useState(item?.tags.join(' ') ?? '');
  const [canisterId, setCanisterId] = useState(item?.canisterId ?? '');
  const [images, setImages] = useState<EditorImage[]>(
    () => item?.images.map((i) => ({ key: i.hash, hash: i.hash, mime: i.mime })) ?? [],
  );
  /** The media to save: the current file (its id), a new upload, or none. */
  const [media, setMedia] = useState<{ id: string; name: string; size: number } | null>(
    item?.media ? { id: item.media.id, name: 'Current file', size: item.media.size } : null,
  );
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const slots = IMAGE_SLOTS[kind];
  const isMedia = kind === 'video' || kind === 'music';

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  const draft: ItemDraft = { kind, title, body, url, tags, canisterId, imageCount: images.length, hasMedia: !!media };
  const errors = tried ? itemDraftErrors(draft) : {};

  const addImages = async (files: FileList | Blob[] | null) => {
    if (!files || !files.length) return;
    setAdding(true);
    setError(null);
    try {
      const room = slots - images.length;
      const out: EditorImage[] = [];
      for (const f of Array.from(files).slice(0, Math.max(0, room))) {
        const bytes = await shrinkPhoto(f);
        out.push({ key: `n${++seq.current}`, bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart])) });
      }
      setImages((l) => [...l, ...out].slice(0, slots));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
      if (imgInput.current) imgInput.current.value = '';
    }
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    const mime = mediaMime(f.name, f.type);
    const max = kind === 'video' ? LIMITS.video : LIMITS.audio;
    setError(null);
    if (!(kind === 'video' ? /^video\//.test(mime) : /^audio\//.test(mime) || mime === 'video/webm')) {
      setError(
        kind === 'video' ? 'Choose a video file (MP4 or WebM).' : 'Choose an audio file (MP3, M4A, OGG, WAV or FLAC).',
      );
      return;
    }
    if (f.size > max) {
      setError(`That file is ${formatBytes(f.size)}; the limit is ${formatBytes(max)}.`);
      return;
    }
    abort.current = new AbortController();
    setUpload({ name: f.name, progress: 0 });
    try {
      const id = await onUpload(f, mime, (p) => setUpload({ name: f.name, progress: p }), abort.current.signal);
      setMedia({ id, name: f.name, size: f.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpload(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const fill = async () => {
    if (!fetchPreview || !/^https:\/\//i.test(url.trim())) return;
    setFilling(true);
    try {
      const p = await fetchPreview(url.trim());
      if (!p) {
        setError("Couldn't read that page. Fill in the details yourself.");
        return;
      }
      if (!title.trim() && p.preview.title) setTitle(p.preview.title.slice(0, LIMITS.title));
      if (!body.trim() && p.preview.description) setBody(p.preview.description);
      if (images.length === 0 && p.imageUrl && fetchPreviewImage) {
        const d = await fetchPreviewImage(p.imageUrl);
        if (d) await addImages([new Blob([dataUrlBytes(d) as BlobPart])]);
      }
    } finally {
      setFilling(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(itemDraftErrors(draft)).length) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        kind,
        title: title.trim(),
        body: body.trim(),
        url: url.trim(),
        tags: parseTags(tags),
        images: images.map((i) => ('hash' in i ? { keep: i.hash } : { add: i.bytes })),
        media: isMedia ? (media?.id ?? null) : null,
        canisterId: kind === 'dapp' ? canisterId.trim() : '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const urlLabel =
    kind === 'link'
      ? 'Link'
      : kind === 'dapp'
        ? 'Dapp address'
        : kind === 'video'
          ? 'Or a link to the video'
          : 'Or a link to the track';
  const imagesLabel =
    kind === 'post'
      ? 'Photos'
      : kind === 'work'
        ? 'Images of your work'
        : kind === 'dapp'
          ? 'Icon or screenshot'
          : 'Cover image';

  return (
    <main
      className="chat-main ev-main sp-editor"
      aria-label={item ? `Edit ${kindLabel(kind)}` : `New ${kindLabel(kind)}`}
    >
      <header className="ev-bar">
        <button type="button" className="hdr-btn back mk-back" onClick={onCancel} aria-label="Back">
          <BackIcon />
        </button>
        <h2>{item ? `Edit ${kindLabel(kind).toLowerCase()}` : `New ${kindLabel(kind).toLowerCase()}`}</h2>
      </header>
      <form className="ev-form" onSubmit={(e) => void submit(e)} noValidate>
        {(kind === 'link' || kind === 'dapp' || isMedia) && (
          <label className="ev-field">
            <span>{urlLabel}</span>
            <div className="sp-url-row">
              <input
                value={url}
                inputMode="url"
                placeholder="https://"
                maxLength={LIMITS.url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={!!errors.url}
              />
              {fetchPreview && (kind === 'link' || kind === 'dapp') && (
                <button
                  type="button"
                  className="ev-btn"
                  disabled={filling || !/^https:\/\//i.test(url.trim())}
                  onClick={() => void fill()}
                >
                  {filling ? 'Reading…' : 'Fill in details'}
                </button>
              )}
            </div>
            {errors.url && <span className="ev-error">{errors.url}</span>}
          </label>
        )}

        {isMedia && (
          <div className="ev-field">
            <span>{kind === 'video' ? 'Video file' : 'Audio file'}</span>
            {upload ? (
              <div className="sp-upload">
                <span className="sp-upload-name">{upload.name}</span>
                <span className="sp-upload-bar">
                  <span style={{ width: `${Math.round(upload.progress * 100)}%` }} />
                </span>
                <button type="button" className="link-btn" onClick={() => abort.current?.abort()}>
                  Cancel
                </button>
              </div>
            ) : media ? (
              <div className="sp-upload">
                <span className="sp-upload-name">
                  {media.name} · {formatBytes(media.size)}
                </span>
                <button type="button" className="link-btn" onClick={() => fileInput.current?.click()}>
                  Replace
                </button>
                <button type="button" className="link-btn" onClick={() => setMedia(null)}>
                  Remove
                </button>
              </div>
            ) : (
              <button type="button" className="sp-file-pick" onClick={() => fileInput.current?.click()}>
                Upload{' '}
                {kind === 'video'
                  ? 'a video (MP4 or WebM, up to 25 MB)'
                  : 'a track (MP3, M4A, OGG, WAV, FLAC, up to 12 MB)'}
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              hidden
              data-testid="space-media"
              accept={
                kind === 'video' ? 'video/mp4,video/webm,.mp4,.webm,.m4v,.mov' : 'audio/*,.mp3,.m4a,.ogg,.wav,.flac'
              }
              onChange={(e) => void pickFile(e.target.files?.[0])}
            />
          </div>
        )}

        {kind !== 'post' && (
          <label className="ev-field">
            <span>Title{kind === 'link' ? ' (optional)' : ''}</span>
            <input
              value={title}
              maxLength={LIMITS.title}
              placeholder={kind === 'dapp' ? 'Name of the dapp' : 'Give it a title'}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={!!errors.title}
            />
            {errors.title && <span className="ev-error">{errors.title}</span>}
          </label>
        )}

        <label className="ev-field">
          <span>{kind === 'post' ? 'What do you want to share?' : 'Description (optional)'}</span>
          <textarea
            value={body}
            rows={kind === 'post' ? 6 : 4}
            maxLength={LIMITS.body}
            placeholder={kind === 'post' ? 'Write something…' : 'Tell people about it'}
            onChange={(e) => setBody(e.target.value)}
            aria-invalid={!!errors.body}
          />
          {errors.body && <span className="ev-error">{errors.body}</span>}
        </label>

        <fieldset className="ev-field">
          <legend>
            {imagesLabel}{' '}
            <span className="ev-hint">
              {images.length} / {slots}
              {kind === 'work' ? ' · the first is the cover' : ''}
            </span>
          </legend>
          <div className="mk-photos">
            {images.map((img, i) => (
              <div key={img.key} className="mk-photo-slot">
                <Thumb img={img} itemId={item?.id} load={image} />
                {i === 0 && slots > 1 && <span className="mk-cover-tag">Cover</span>}
                <button
                  type="button"
                  className="mk-photo-remove"
                  aria-label={`Remove image ${i + 1}`}
                  onClick={() => setImages((l) => l.filter((x) => x.key !== img.key))}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
            {images.length < slots && (
              <button
                type="button"
                className="mk-photo-add"
                disabled={adding}
                onClick={() => imgInput.current?.click()}
              >
                <CameraPlusIcon />
                <span>{adding ? 'Adding…' : slots > 1 ? 'Add images' : 'Add image'}</span>
              </button>
            )}
          </div>
          <input
            ref={imgInput}
            type="file"
            accept="image/*"
            multiple={slots > 1}
            hidden
            data-testid="space-images"
            onChange={(e) => void addImages(e.target.files)}
          />
          {errors.imageCount && <span className="ev-error">{errors.imageCount}</span>}
        </fieldset>

        {kind === 'dapp' && (
          <label className="ev-field">
            <span>Canister ID (optional)</span>
            <input
              value={canisterId}
              placeholder="xxxxx-xxxxx-xxxxx-xxxxx-cai"
              onChange={(e) => setCanisterId(e.target.value)}
              aria-invalid={!!errors.canisterId}
            />
            {errors.canisterId && <span className="ev-error">{errors.canisterId}</span>}
          </label>
        )}

        <label className="ev-field">
          <span>Tags (optional)</span>
          <input value={tags} placeholder="e.g. art photography icp" onChange={(e) => setTags(e.target.value)} />
          {errors.tags && <span className="ev-error">{errors.tags}</span>}
        </label>

        <p className="ev-hint mk-public-hint">Public: anyone who opens your space can see this.</p>
        {error && <p className="ev-error">{error}</p>}
        <div className="ev-form-actions">
          <button type="button" className="ev-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="ev-btn is-primary" disabled={busy || adding || !!upload}>
            {busy ? 'Saving…' : item ? 'Save changes' : 'Publish'}
          </button>
        </div>
      </form>
    </main>
  );
}
