/**
 * What a reply shows of a quoted file: the photo or video's small preview, a
 * sound-wave icon for a voice message, or a file icon with the file's type
 * (PDF, DOC, ZIP…) under it. Nothing for a text message.
 */
import type { Attachment } from '../core/delivery/realMessaging';
import { AudioWaveIcon, FileIcon, PlayIcon } from './icons';

/** Colour families for common file types (others use the app's purple). */
const FAMILIES: Record<string, string> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  odt: 'doc',
  rtf: 'doc',
  pages: 'doc',
  xls: 'sheet',
  xlsx: 'sheet',
  csv: 'sheet',
  ods: 'sheet',
  numbers: 'sheet',
  ppt: 'slides',
  pptx: 'slides',
  odp: 'slides',
  key: 'slides',
};

/** The file's type as a short label: its extension in capitals (at most 4 letters), else FILE. */
export function fileTypeLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  return /^[a-z0-9]{1,4}$/i.test(ext) ? ext.toUpperCase() : 'FILE';
}

export function QuoteMedia({ a, className }: { a: Attachment | undefined; className: string }) {
  if (!a) return null;
  const video = a.mime.startsWith('video/');
  if ((a.mime.startsWith('image/') || video) && a.thumb) {
    return (
      <span className={`${className} quote-media-thumb`} aria-hidden="true">
        <img src={a.thumb} alt="" />
        {video && (
          <span className="quote-media-play">
            <PlayIcon />
          </span>
        )}
      </span>
    );
  }
  if (a.voice) {
    return (
      <span className={`${className} quote-media-icon`} aria-hidden="true">
        <AudioWaveIcon />
      </span>
    );
  }
  const label = fileTypeLabel(a.name);
  const family = FAMILIES[label.toLowerCase()] ?? 'other';
  return (
    <span className={`${className} quote-media-icon quote-media-file is-${family}`} aria-hidden="true">
      <FileIcon />
      <span className="quote-media-type">{label}</span>
    </span>
  );
}
