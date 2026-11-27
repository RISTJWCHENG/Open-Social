/**
 * The ⋮ menu in a chat's header on phones: this chat's colour theme and text
 * size (kept on this device only) and the contact's info. (On computers the
 * theme and text size are in the toolbar's ⋮ menu.) Opens below the
 * button, right-aligned; theme and text size open in the same panel with a
 * back row. Escape or a tap elsewhere closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { BackIcon, CheckIcon, ChevronRightIcon, InfoIcon, PaletteIcon, TextSizeIcon } from './icons';
import { CHAT_THEMES, TEXT_SIZES, chatTheme, type ChatTextSize, type ChatTheme } from './chatThemes';

interface Props {
  anchor: HTMLElement;
  theme: string | undefined;
  textSize: ChatTextSize;
  onTheme: (id: string) => void;
  onTextSize: (size: ChatTextSize) => void;
  onInfo: () => void;
  onClose: () => void;
}

type Sub = 'theme' | 'text';

export function ChatSettingsMenu({ anchor, theme, textSize, onTheme, onTextSize, onInfo, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [sub, setSub] = useState<Sub | null>(null);
  const current = chatTheme(theme);

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    // offsetWidth: the real width (the opening animation scales the box).
    const width = ref.current!.offsetWidth;
    setPos({
      top: a.bottom + 6,
      left: Math.min(Math.max(8, a.right - width), window.innerWidth - width - 8),
    });
  }, [anchor, sub]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
  }, [sub]);

  const back = (label: string) => (
    <button type="button" role="menuitem" className="chat-menu-item chat-menu-back" onClick={() => setSub(null)}>
      <span className="chat-menu-icon" aria-hidden="true">
        <BackIcon />
      </span>
      <span className="chat-menu-label">{label}</span>
    </button>
  );

  const row = (label: string, icon: JSX.Element, onClick: () => void, value?: string, opens = false) => (
    <button
      type="button"
      role="menuitem"
      className="chat-menu-item"
      aria-haspopup={opens ? 'menu' : undefined}
      onClick={onClick}
    >
      <span className="chat-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="chat-menu-label">{label}</span>
      {value && <span className="chat-menu-value">{value}</span>}
      {opens && (
        <span className="chat-menu-more" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      )}
    </button>
  );

  return createPortal(
    <div
      className="chat-menu chat-more-menu chat-settings-menu"
      role="menu"
      aria-label="Chat settings"
      ref={ref}
      style={{ top: pos.top, left: pos.left }}
    >
      {sub === null && (
        <>
          {row('Chat theme', <PaletteIcon />, () => setSub('theme'), current.name, true)}
          {row(
            'Text size',
            <TextSizeIcon />,
            () => setSub('text'),
            TEXT_SIZES.find((t) => t.id === textSize)!.name,
            true,
          )}
          <span className="chat-menu-divider" role="separator" />
          {row('Contact info', <InfoIcon />, () => {
            onInfo();
            onClose();
          })}
        </>
      )}

      {sub === 'theme' && (
        <>
          {back('Chat theme')}
          <span className="chat-menu-divider" role="separator" />
          {/* Stays open, to try one theme after another. */}
          <ChatThemePanel theme={theme} onPick={onTheme} />
        </>
      )}

      {sub === 'text' && (
        <>
          {back('Text size')}
          <span className="chat-menu-divider" role="separator" />
          <TextSizePanel textSize={textSize} onPick={onTextSize} />
        </>
      )}
    </div>,
    document.body,
  );
}

/** The theme swatches (also in the desktop chat menu). */
export function ChatThemePanel({ theme, onPick }: { theme: string | undefined; onPick: (id: string) => void }) {
  const current = chatTheme(theme);
  const swatch = (t: ChatTheme) => (
    <button
      key={t.id}
      type="button"
      role="menuitemradio"
      aria-checked={t.id === current.id}
      aria-label={t.name}
      className="chat-theme-swatch"
      style={{ '--sw-bg': t.background, '--sw-in': t.bubbleIn, '--sw-out': t.bubbleOut } as CSSProperties}
      onClick={() => onPick(t.id)}
    >
      <span className="chat-theme-preview" aria-hidden="true">
        <span className="sw-in" />
        <span className="sw-out" />
      </span>
      <span className="chat-theme-name">{t.name}</span>
    </button>
  );
  return (
    <>
      <div className="chat-theme-scroll">
        <p className="chat-theme-group">Light</p>
        <div className="chat-theme-grid">{CHAT_THEMES.filter((t) => !t.dark).map(swatch)}</div>
        <p className="chat-theme-group">Dark</p>
        <div className="chat-theme-grid">{CHAT_THEMES.filter((t) => t.dark).map(swatch)}</div>
      </div>
      <p className="chat-menu-note">Only on this device: your friend doesn't see it.</p>
    </>
  );
}

/** The text sizes (also in the desktop chat menu). */
export function TextSizePanel({ textSize, onPick }: { textSize: ChatTextSize; onPick: (size: ChatTextSize) => void }) {
  return (
    <>
      {TEXT_SIZES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="menuitemradio"
          aria-checked={t.id === textSize}
          className={`chat-menu-item chat-text-size is-${t.id}`}
          onClick={() => onPick(t.id)}
        >
          <span className="chat-menu-label">{t.name}</span>
          {t.id === textSize && (
            <span className="chat-menu-check" aria-hidden="true">
              <CheckIcon />
            </span>
          )}
        </button>
      ))}
    </>
  );
}
