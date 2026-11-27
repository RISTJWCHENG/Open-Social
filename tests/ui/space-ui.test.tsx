// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SpaceItem } from '../../src/core/space/space';
import { ItemCard } from '../../src/ui/space/ItemCard';
import { ItemEditor } from '../../src/ui/space/ItemEditor';

const image = vi.fn(async () => null);
const item = (over: Partial<SpaceItem> = {}): SpaceItem => ({
  id: '3',
  owner: 'aaaaa-bbbbb-ccc',
  kind: 'dapp',
  title: 'OpenSocial',
  body: 'Private chat',
  url: 'https://chat.opensocial.cc',
  tags: ['icp'],
  images: [],
  media: null,
  canisterId: '',
  likes: 2,
  hidden: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
});

describe('Space views', () => {
  it('a card shows the item and likes it', () => {
    const onLike = vi.fn();
    const onOpen = vi.fn();
    render(<ItemCard item={item()} image={image} liked={false} likes={2} onLike={onLike} onOpen={onOpen} />);
    expect(screen.getByText('chat.opensocial.cc')).toBeInTheDocument();
    expect(screen.getByText('#icp')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Like (2)' }));
    expect(onLike).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Open dapp: OpenSocial/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('the editor picks a kind, checks it, and saves a link', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ItemEditor image={image} onUpload={async () => '1'} onSave={onSave} onCancel={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Link/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Add the address.')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('https://'), { target: { value: 'https://example.com' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. art photography icp'), { target: { value: '#Web, icp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((onSave.mock.calls as unknown as [unknown][])[0]![0]).toMatchObject({
      kind: 'link',
      url: 'https://example.com',
      tags: ['web', 'icp'],
      media: null,
    });
  });
});
