// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ChatsRailIcon } from '../../src/ui/icons';

describe('Chats rail icon', () => {
  it('is two speech bubbles, the front one with three dots', () => {
    const { container } = render(<ChatsRailIcon />);
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelector('g')!.getAttribute('style')).toContain('var(--rail-dot, currentColor)');
    expect(container.querySelectorAll('svg > path')).toHaveLength(2);
  });

  it('gives each copy its own gradient and mask ids', () => {
    const { container } = render(
      <>
        <ChatsRailIcon />
        <ChatsRailIcon />
      </>,
    );
    const masks = [...container.querySelectorAll('mask')].map((m) => m.id);
    expect(new Set(masks).size).toBe(2);
    for (const id of masks) expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    const back = container.querySelector('svg > path')!;
    expect(back.getAttribute('mask')).toBe(`url(#${masks[0]})`);
  });
});
