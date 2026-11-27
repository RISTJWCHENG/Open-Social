// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyIconButton } from '../../src/ui/CopyButton';

describe('CopyIconButton', () => {
  it('copies the text and says so for a moment', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyIconButton text="aaaaa-bbbbb" label="Copy ID" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }));
    });
    expect(writeText).toHaveBeenCalledWith('aaaaa-bbbbb');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
