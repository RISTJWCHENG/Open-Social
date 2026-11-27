// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentTray } from '../../src/ui/AttachmentTray';

URL.createObjectURL = vi.fn(() => 'blob:preview');
URL.revokeObjectURL = vi.fn();

describe('Attachment tray', () => {
  it('previews photos, shows other files as cards, removes and adds', async () => {
    const onRemove = vi.fn();
    const onAddMore = vi.fn();
    const onClear = vi.fn();
    const files = [
      { id: 'a', file: new File([new Uint8Array(10)], 'slavia.jpg', { type: 'image/jpeg' }) },
      { id: 'b', file: new File([new Uint8Array(2048)], 'report.pdf', { type: 'application/pdf' }) },
    ];
    render(<AttachmentTray files={files} onRemove={onRemove} onAddMore={onAddMore} onClear={onClear} />);
    expect(screen.getByRole('group', { name: '2 attachments to send' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'slavia.jpg' })).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove report.pdf' }));
    expect(onRemove).toHaveBeenCalledWith('b');
    await userEvent.click(screen.getByRole('button', { name: 'Add more files' }));
    expect(onAddMore).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove all attachments' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
