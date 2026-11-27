/**
 * Files chosen to send, shown above the message box before they go: photos
 * and videos as previews, other files as cards; each can be removed, and more
 * can be added. Nothing is sent until the user presses send (the text in the
 * message box goes with them as a caption).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatSize } from './AttachmentView';
import { CloseIcon, FileIcon, PlayIcon, PlusIcon } from './icons';

export interface StagedFile {
  id: string;
  file: File;
}

export const MAX_STAGED = 30;

interface Props {
  files: StagedFile[];
  onRemove: (id: string) => void;
  onAddMore: () => void;
  /** Discards every file at once (the typed text stays). */
  onClear: () => void;
}

export function AttachmentTray({ files, onRemove, onAddMore, onClear }: Props) {
  // Object URLs for previews, released when the tray changes or closes.
  const urls = useMemo(
    () =>
      new Map(
        files
          .filter((f) => /^(image|video)\//.test(f.file.type))
          .map((f) => [f.id, URL.createObjectURL(f.file)] as const),
      ),
    [files],
  );
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  // Whether the previews overflow (a scrollbar shows): only then keep room for it.
  const list = useRef<HTMLUListElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [files.length]);

  return (
    <div className="tray" role="group" aria-label={`${files.length} attachment${files.length === 1 ? '' : 's'} to send`}>
      <button type="button" className="tray-clear" aria-label="Remove all attachments" title="Remove all" onClick={onClear}>
        <CloseIcon />
      </button>
      <ul className={`tray-list ${overflowing ? 'overflowing' : ''}`} ref={list}>
        {files.map((f) => {
          const url = urls.get(f.id);
          const video = f.file.type.startsWith('video/');
          return (
            <li key={f.id} className={`tray-item ${url ? 'media' : 'doc'}`} title={`${f.file.name} · ${formatSize(f.file.size)}`}>
              {url && !video && <img src={url} alt={f.file.name} />}
              {url && video && (
                <>
                  <video src={url} muted preload="metadata" aria-label={f.file.name} />
                  <span className="tray-play" aria-hidden="true">
                    <PlayIcon />
                  </span>
                </>
              )}
              {!url && (
                <span className="tray-doc">
                  <FileIcon />
                  <span className="tray-name">{f.file.name}</span>
                  <span className="tray-size">{formatSize(f.file.size)}</span>
                </span>
              )}
              <button type="button" className="tray-remove" aria-label={`Remove ${f.file.name}`} onClick={() => onRemove(f.id)}>
                <CloseIcon />
              </button>
            </li>
          );
        })}
        {files.length < MAX_STAGED && (
          <li>
            <button type="button" className="tray-add" aria-label="Add more files" onClick={onAddMore}>
              <PlusIcon />
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
