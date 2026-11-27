/**
 * A photo from a chat, shown large on a dark backdrop at its own proportions
 * (as big as the window allows, never cropped). Escape, the close button or a
 * click on the backdrop closes it.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';

export function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <img src={src} alt={alt} className="image-viewer-img" onClick={(e) => e.stopPropagation()} />
      <button type="button" ref={closeRef} className="image-viewer-close" aria-label="Close" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>,
    document.body,
  );
}
