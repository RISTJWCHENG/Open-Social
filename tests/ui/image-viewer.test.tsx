// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../src/ui/ImageViewer';

describe('ImageViewer', () => {
  it('shows the photo large and closes with the button, Escape or the backdrop, not the photo', async () => {
    const onClose = vi.fn();
    render(<ImageViewer src="blob:x" alt="dinner.jpg" onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'dinner.jpg' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.click(screen.getByRole('img', { name: 'dinner.jpg' }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
