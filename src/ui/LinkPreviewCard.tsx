/**
 * Link preview cards: in a message bubble (opens the page in a new tab) and,
 * while writing, in a bar above the composer that can be removed before sending.
 */
import { previewHost, type LinkPreview } from '../core/delivery/linkPreview';
import { CloseIcon, LinkIcon } from './icons';

export function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  const host = previewHost(preview.url);
  return (
    <a className="link-card" href={preview.url} target="_blank" rel="noopener noreferrer">
      {preview.image && <img className="link-card-image" src={preview.image} alt="" loading="lazy" />}
      <span className="link-card-body">
        <span className="link-card-site">{preview.site || host}</span>
        <span className="link-card-title">{preview.title}</span>
        {preview.description && <span className="link-card-text">{preview.description}</span>}
        {preview.site && host && <span className="link-card-host">{host}</span>}
      </span>
    </a>
  );
}

interface BarProps {
  url: string;
  /** undefined while loading. */
  preview: LinkPreview | undefined;
  onRemove(): void;
}

export function LinkPreviewBar({ url, preview, onRemove }: BarProps) {
  return (
    <div className="link-bar" role="status" aria-busy={!preview}>
      {preview?.image ? (
        <img className="link-bar-image" src={preview.image} alt="" />
      ) : (
        <span className="link-bar-icon" aria-hidden="true">
          <LinkIcon />
        </span>
      )}
      <span className="link-bar-text">
        <span className="link-bar-title">{preview ? preview.title : 'Loading link preview…'}</span>
        <span className="link-bar-sub">{preview?.description || previewHost(url)}</span>
      </span>
      <button type="button" className="reply-bar-close" aria-label="Remove link preview" onClick={onRemove}>
        <CloseIcon />
      </button>
    </div>
  );
}
