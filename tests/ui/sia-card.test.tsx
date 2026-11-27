// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiaStorageCard, type SiaClientLike } from '../../src/ui/SiaStorageCard';

const PHRASE = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';

function fakeClient(opts: { returning?: boolean; saved?: boolean } = {}) {
  let connected = false;
  const items = [
    { id: 'b1', kind: 'backup' as const, createdAt: new Date('2026-11-01'), sizeBytes: 2048 },
    { id: 'f1', kind: 'file' as const, createdAt: new Date('2026-11-02'), sizeBytes: 23 * 1024 * 1024 },
  ];
  let stored: Uint8Array | null = null;
  const c: SiaClientLike & { uploads: number } = {
    uploads: 0,
    isConnected: () => connected,
    resume: vi.fn(async () => (connected = !!opts.saved)),
    requestApproval: vi.fn(async () => 'https://sia.storage/approve/abc'),
    waitForApproval: vi.fn(async () => !!opts.returning),
    registerNew: vi.fn(async () => {
      connected = true;
      return PHRASE;
    }),
    registerExisting: vi.fn(async (p: string) => {
      if (p.trim() !== PHRASE) throw new Error('This phrase does not match');
      connected = true;
    }),
    disconnect: vi.fn(async () => {
      connected = false;
    }),
    account: vi.fn(async () => ({ pinnedBytes: 2e6, remainingBytes: 49.9e9, maxBytes: 50e9 })),
    uploadBackup: vi.fn(async (d: Uint8Array) => {
      stored = d;
      c.uploads++;
      return 'obj1';
    }),
    latestBackup: vi.fn(async () =>
      stored ? { id: 'obj1', createdAt: new Date(0), sizeBytes: stored.length } : null,
    ),
    downloadBackup: vi.fn(async () => stored!),
    uploadShared: vi.fn(async () => ({ seed: 's', objectId: 'o' })),
    deleteAll: vi.fn(async () => {
      const n = items.length;
      items.length = 0;
      return n;
    }),
    listMine: vi.fn(async () => [...items]),
    deleteObject: vi.fn(async (id: string) => {
      items.splice(
        items.findIndex((i) => i.id === id),
        1,
      );
    }),
  };
  return c;
}

describe('SiaStorageCard', () => {
  it('connects a new Sia account, shows the phrase once, backs up and restores', async () => {
    const client = fakeClient();
    const importChats = vi.fn(async () => 3);
    render(
      <SiaStorageCard
        client={client}
        exportChats={() => new TextEncoder().encode('{"v":1}')}
        importChats={importChats}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Sia storage' }));
    const grid = await screen.findByRole('list', { name: 'Sia recovery phrase' });
    expect(grid).toHaveTextContent('alpha');
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /saved my Sia recovery phrase/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Back up chats now' }));
    expect(await screen.findByText('Chats backed up to your Sia storage.')).toBeInTheDocument();
    expect(client.uploads).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Restore last backup' }));
    expect(await screen.findByText('Restored 3 messages from your Sia storage.')).toBeInTheDocument();
  });

  it('asks a returning Sia account for its saved phrase', async () => {
    const client = fakeClient({ returning: true });
    render(<SiaStorageCard client={client} exportChats={() => new Uint8Array()} importChats={async () => 0} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Sia storage' }));
    const box = await screen.findByRole('textbox', { name: 'Sia recovery phrase' });
    await userEvent.type(box, 'wrong words');
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/does not match/);
    await userEvent.clear(box);
    await userEvent.type(box, PHRASE);
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });

  it('resumes automatically with a saved key', async () => {
    const client = fakeClient({ saved: true });
    render(<SiaStorageCard client={client} exportChats={() => new Uint8Array()} importChats={async () => 0} />);
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(client.resume).toHaveBeenCalled();
  });
});

describe('Managing OpenSocial data in Sia', () => {
  it('lists backups and shared files, deletes one after confirming, then all', async () => {
    const c = fakeClient({ saved: true });
    render(<SiaStorageCard client={c} exportChats={() => new Uint8Array([1])} importChats={async () => 0} />);
    const list = await screen.findByRole('list', { name: 'OpenSocial data in your Sia storage' });
    expect(within(list).getByText('Chat backup')).toBeInTheDocument();
    expect(within(list).getByText('Shared file')).toBeInTheDocument();
    expect(within(list).getByText(/23\.0 MB/)).toBeInTheDocument();

    const del = within(list).getAllByRole('button', { name: /^Delete chat backup/ })[0]!;
    await userEvent.click(del);
    expect(c.deleteObject).not.toHaveBeenCalled(); // first click only asks to confirm
    await userEvent.click(within(list).getByRole('button', { name: /^Delete chat backup/ }));
    expect(c.deleteObject).toHaveBeenCalledWith('b1');
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted from your Sia storage.');
    await waitFor(() => expect(screen.queryByText('Chat backup')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Delete all OpenSocial data' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm: delete all 1' }));
    expect(c.deleteAll).toHaveBeenCalled();
    expect(await screen.findByText('Nothing stored yet.')).toBeInTheDocument();
  });
});
