// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Attachment } from '../../src/core/delivery/realMessaging';
import { QuoteMedia, fileTypeLabel } from '../../src/ui/QuoteMedia';

const file = (over: Partial<Attachment>): Attachment => ({
  fileId: 'f'.repeat(24),
  name: 'x',
  mime: 'application/pdf',
  size: 10,
  via: 'inline',
  state: 'ready',
  done: 1,
  total: 1,
  ...over,
});

describe('QuoteMedia', () => {
  it('labels files by extension', () => {
    expect(fileTypeLabel('notes.txt')).toBe('TXT');
    expect(fileTypeLabel('a.tar.gz')).toBe('GZ');
    expect(fileTypeLabel('deck.pptx')).toBe('PPTX');
    expect(fileTypeLabel('README')).toBe('FILE');
    expect(fileTypeLabel('weird.extension')).toBe('FILE');
  });

  it('shows a quoted photo or video as its preview (videos with a play mark)', () => {
    const photo = render(
      <QuoteMedia a={file({ mime: 'image/jpeg', thumb: 'data:image/webp;base64,AA==' })} className="q" />,
    );
    expect(photo.container.querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,AA==');
    expect(photo.container.querySelector('.quote-media-play')).toBeNull();
    const video = render(
      <QuoteMedia a={file({ mime: 'video/mp4', thumb: 'data:image/webp;base64,AA==' })} className="q" />,
    );
    expect(video.container.querySelector('.quote-media-play')).not.toBeNull();
  });

  it('shows an icon for voice messages and other files, and nothing for text', () => {
    expect(
      render(<QuoteMedia a={file({})} className="q" />).container.querySelector('.quote-media-icon'),
    ).not.toBeNull();
    expect(render(<QuoteMedia a={undefined} className="q" />).container.innerHTML).toBe('');
  });
});
