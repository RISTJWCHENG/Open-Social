/**
 * The ⋮ menu at the right end of a chat's toolbar: favourite, translate this
 * chat (on this device, into a chosen language), mute notifications and, on
 * computers, this chat's theme and text size.
 * Opens below the button, right-aligned. A choice with options (translate,
 * mute) opens them in the same panel with a back row, which also fits phones.
 * Escape or a click elsewhere closes it. Rendered into <body>: the toolbar's
 * backdrop blur would otherwise make `position: fixed` relative to the toolbar.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  BackIcon,
  BellOffIcon,
  CheckIcon,
  ChevronRightIcon,
  HeartIcon,
  PaletteIcon,
  TextSizeIcon,
  TranslateIcon,
} from './icons';
import { ChatThemePanel, TextSizePanel } from './ChatSettingsMenu';
import { TEXT_SIZES, chatTheme, type ChatTextSize } from './chatThemes';
import { TRANSLATE_LANGUAGES } from '../core/translate/onDeviceTranslation';

const HOUR = 3_600_000;
const MUTE_OPTIONS: { label: string; ms: number }[] = [
  { label: '8 hours', ms: 8 * HOUR },
  { label: '1 week', ms: 7 * 24 * HOUR },
  { label: 'Always', ms: Infinity },
];

export interface ChatMoreState {
  favorite: boolean;
  muted: boolean;
  /** Language the chat is translated into, or null. */
  translateTo: string | null;
  /** This browser can translate on the device. */
  canTranslate: boolean;
  /** This chat's look on this device (offered here on computers; phones have it in the header). */
  look?: { theme: string | undefined; textSize: ChatTextSize };
}

export type ChatMoreAction =
  | { favorite: boolean }
  | { mute: number }
  | { unmute: true }
  | { translateTo: string | null }
  | { chatTheme: string }
  | { textSize: ChatTextSize };

interface Props {
  state: ChatMoreState;
  anchor: HTMLElement;
  onAction: (action: ChatMoreAction) => void;
  onClose: () => void;
}

type Sub = 'translate' | 'mute' | 'theme' | 'text';
type Item = {
  label: string;
  icon: ReactElement;
  action?: ChatMoreAction;
  sub?: Sub;
  on?: boolean;
  /** The current choice, shown before the arrow. */
  value?: string;
};

export function ChatMoreMenu({ state, anchor, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [sub, setSub] = useState<Sub | null>(null);

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

  const choose = (a: ChatMoreAction) => {
    onAction(a);
    onClose();
  };

  const items: Item[] = [
    state.favorite
      ? {
          label: 'Remove from Favorites',
          icon: <HeartIcon className="is-favorite" />,
          action: { favorite: false },
        }
      : {
          label: 'Add to Favorites',
          icon: <HeartIcon />,
          action: { favorite: true },
        },
    {
      label: 'Translate this chat',
      icon: <TranslateIcon />,
      sub: 'translate',
      on: !!state.translateTo,
    },
    state.muted
      ? {
          label: 'Unmute notifications',
          icon: <BellOffIcon />,
          action: { unmute: true },
        }
      : { label: 'Mute notifications', icon: <BellOffIcon />, sub: 'mute' },
    ...(state.look
      ? [
          { label: 'Chat theme', icon: <PaletteIcon />, sub: 'theme', value: chatTheme(state.look.theme).name },
          {
            label: 'Text size',
            icon: <TextSizeIcon />,
            sub: 'text',
            value: TEXT_SIZES.find((t) => t.id === state.look!.textSize)?.name,
          },
        ]
      : []),
  ] as Item[];

  // Keyboard focus follows the panel: its back row, or the first item.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
  }, [sub]);

  // Arrow keys move between items.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' && sub) {
      e.preventDefault();
      return setSub(null);
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  };

  const back = (label: string) => (
    <button type="button" role="menuitem" className="chat-menu-item chat-menu-back" onClick={() => setSub(null)}>
      <span className="chat-menu-icon" aria-hidden="true">
        <BackIcon />
      </span>
      <span className="chat-menu-label">{label}</span>
    </button>
  );

  return createPortal(
    <div
      className="chat-menu chat-more-menu"
      role="menu"
      aria-label="More chat options"
      ref={ref}
      style={{ top: pos.top, left: pos.left }}
      onKeyDown={onKeyDown}
    >
      {sub === null &&
        items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className="chat-menu-item"
            aria-haspopup={it.sub ? 'menu' : undefined}
            onClick={() => (it.sub ? setSub(it.sub) : choose(it.action!))}
            onKeyDown={(e) => {
              if (it.sub && e.key === 'ArrowRight') {
                e.preventDefault();
                setSub(it.sub);
              }
            }}
          >
            <span className="chat-menu-icon" aria-hidden="true">
              {it.icon}
            </span>
            <span className="chat-menu-label">{it.label}</span>
            {it.on && <span className="chat-menu-on">On</span>}
            {it.value && <span className="chat-menu-value">{it.value}</span>}
            {it.sub && (
              <span className="chat-menu-more" aria-hidden="true">
                <ChevronRightIcon />
              </span>
            )}
          </button>
        ))}

      {sub === 'theme' && state.look && (
        <>
          {back('Chat theme')}
          <span className="chat-menu-divider" role="separator" />
          {/* Stays open, to try one theme after another. */}
          <ChatThemePanel theme={state.look.theme} onPick={(id) => onAction({ chatTheme: id })} />
        </>
      )}

      {sub === 'text' && state.look && (
        <>
          {back('Text size')}
          <span className="chat-menu-divider" role="separator" />
          <TextSizePanel textSize={state.look.textSize} onPick={(size) => onAction({ textSize: size })} />
        </>
      )}

      {sub === 'mute' && (
        <>
          {back('Mute notifications')}
          <span className="chat-menu-divider" role="separator" />
          {MUTE_OPTIONS.map((o) => (
            <button
              key={o.label}
              type="button"
              role="menuitem"
              className="chat-menu-item"
              onClick={() => choose({ mute: o.ms })}
            >
              {o.label}
            </button>
          ))}
        </>
      )}

      {sub === 'translate' && (
        <>
          {back('Translate this chat')}
          <span className="chat-menu-divider" role="separator" />
          {!state.canTranslate ? (
            <p className="chat-menu-note">
              Translation runs on your device, so messages stay private. It needs Chrome or Edge on a computer; this
              browser can’t translate yet.
            </p>
          ) : (
            <>
              <p className="chat-menu-note">Translated on this device: messages never leave it.</p>
              {state.translateTo && (
                <button
                  type="button"
                  role="menuitem"
                  className="chat-menu-item"
                  onClick={() => choose({ translateTo: null })}
                >
                  Stop translating
                </button>
              )}
              <div className="chat-lang-list">
                {TRANSLATE_LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    role="menuitemradio"
                    aria-checked={state.translateTo === l.code}
                    lang={l.code}
                    className="chat-menu-item chat-lang"
                    onClick={() => choose({ translateTo: l.code })}
                  >
                    <span className="chat-menu-label">{l.name}</span>
                    {state.translateTo === l.code && <CheckIcon />}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
