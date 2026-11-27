// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LevelBadge } from '../../src/ui/LevelBadge';

describe('LevelBadge', () => {
  it('names the level for screen readers and on hover, without adding to the text', () => {
    const { container } = render(<LevelBadge />);
    const badge = screen.getByRole('img', { name: 'Level 1 · New member' });
    expect(badge).toHaveAttribute('title', 'Level 1 · New member');
    expect(container.textContent).toBe('');
  });
});
