/**
 * Colour themes for one chat, chosen on this device: the chat's background
 * and its two bubble colours (both sides tinted). Our bubbles are always deep
 * enough for white text. Light themes have light incoming bubbles with dark
 * text; dark themes have a gradient background and dark incoming bubbles with
 * light text (the chat is marked data-tone="dark" for the rest of its colours).
 */
import type { CSSProperties } from 'react';

export interface ChatTheme {
  id: string;
  name: string;
  background: string;
  bubbleIn: string;
  bubbleOut: string;
  /** Dark background (with a gradient) and dark incoming bubbles. */
  dark?: boolean;
}

export const CHAT_THEMES: readonly ChatTheme[] = [
  { id: 'default', name: 'Default', background: '#faf9f7', bubbleIn: '#e8f4f8', bubbleOut: '#6a5a9b' },
  {
    id: 'lavender',
    name: 'Lavender',
    background: '#f3f0fb',
    bubbleIn: '#e3ddfa',
    bubbleOut: '#6a54d8',
  },
  { id: 'mint', name: 'Mint', background: '#eef7f2', bubbleIn: '#d4eee1', bubbleOut: '#26805c' },
  { id: 'sky', name: 'Sky', background: '#edf4fb', bubbleIn: '#d6e7f8', bubbleOut: '#2f6fb7' },
  { id: 'peach', name: 'Peach', background: '#fbf1ea', bubbleIn: '#f8dccb', bubbleOut: '#b85a28' },
  { id: 'rose', name: 'Rose', background: '#fbeff3', bubbleIn: '#f6d7e2', bubbleOut: '#b83a66' },
  { id: 'sand', name: 'Sand', background: '#f6f1e7', bubbleIn: '#eadfc8', bubbleOut: '#8a6a3d' },
  {
    id: 'graphite',
    name: 'Graphite',
    background: '#eef0f3',
    bubbleIn: '#dce0e7',
    bubbleOut: '#3d4451',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    background: 'linear-gradient(160deg, #0b1026 0%, #151c3d 52%, #221a45 100%)',
    bubbleIn: '#2a3358',
    bubbleOut: '#4f5fe0',
    dark: true,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    background: 'linear-gradient(160deg, #06161d 0%, #0b2d2e 50%, #102638 100%)',
    bubbleIn: '#1f3f44',
    bubbleOut: '#11806a',
    dark: true,
  },
  {
    id: 'nebula',
    name: 'Nebula',
    background: 'linear-gradient(160deg, #130b26 0%, #2a0f3d 52%, #170f2e 100%)',
    bubbleIn: '#33254f',
    bubbleOut: '#8440e6',
    dark: true,
  },
  {
    id: 'sunset',
    name: 'Sunset',
    background: 'linear-gradient(160deg, #1f0b18 0%, #3a1426 50%, #22142f 100%)',
    bubbleIn: '#40263a',
    bubbleOut: '#c23d63',
    dark: true,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    background: 'linear-gradient(160deg, #04121f 0%, #082641 52%, #071a33 100%)',
    bubbleIn: '#183553',
    bubbleOut: '#2473c0',
    dark: true,
  },
  {
    id: 'ember',
    name: 'Ember',
    background: 'linear-gradient(160deg, #150e0b 0%, #2f180d 52%, #1b120e 100%)',
    bubbleIn: '#3a2a22',
    bubbleOut: '#b5521c',
    dark: true,
  },
  {
    id: 'forest',
    name: 'Forest',
    background: 'linear-gradient(160deg, #08130e 0%, #10281c 52%, #0b1c15 100%)',
    bubbleIn: '#22392c',
    bubbleOut: '#2b7a47',
    dark: true,
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    background: 'linear-gradient(160deg, #0d0e11 0%, #1a1c22 52%, #121317 100%)',
    bubbleIn: '#2c2e36',
    bubbleOut: '#6a5a9b',
    dark: true,
  },
];

export function chatTheme(id: string | undefined): ChatTheme {
  return CHAT_THEMES.find((t) => t.id === id) ?? CHAT_THEMES[0]!;
}

/** CSS variables for the chat area (the default theme sets none). */
export function chatThemeStyle(id: string | undefined): CSSProperties | undefined {
  const t = chatTheme(id);
  if (t.id === 'default') return undefined;
  return { '--chat-bg': t.background, '--bubble-in': t.bubbleIn, '--bubble-out': t.bubbleOut } as CSSProperties;
}

export type ChatTextSize = 'small' | 'default' | 'large';
export const TEXT_SIZES: readonly { id: ChatTextSize; name: string }[] = [
  { id: 'small', name: 'Small' },
  { id: 'default', name: 'Default' },
  { id: 'large', name: 'Large' },
];
