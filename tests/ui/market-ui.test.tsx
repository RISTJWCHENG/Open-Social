// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Listing } from '../../src/core/market/market';
import { ListingDetail } from '../../src/ui/market/ListingDetail';
import { ListingEditor } from '../../src/ui/market/ListingEditor';
import { MarketGrid } from '../../src/ui/market/MarketGrid';
import { MarketPanel } from '../../src/ui/market/MarketPanel';
import { EMPTY_QUERY } from '../../src/ui/market/useMarket';

const photo = vi.fn(async () => null);
const listing = (over: Partial<Listing> = {}): Listing => ({
  id: '7',
  seller: 'aaaaa-bbbbb-ccc',
  sellerName: 'Alice',
  title: 'Road bike',
  description: 'Carbon frame',
  category: 'sports',
  condition: 'good',
  price: 45_000,
  currency: 'EUR',
  negotiable: true,
  location: 'Brussels',
  shipping: false,
  pickup: true,
  photos: [{ hash: 'h1', mime: 'image/webp', size: 10 }],
  status: 'active',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
});

describe('Market views', () => {
  it('the panel picks a category and searches', () => {
    const onQuery = vi.fn();
    const onTab = vi.fn();
    render(
      <MarketPanel
        tab="browse"
        onTab={onTab}
        query={EMPTY_QUERY}
        onQuery={onQuery}
        counts={{ sports: 3 }}
        savedCount={0}
        sellingCount={1}
        onSell={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Sports & outdoors/ }));
    expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'sports' }));
    fireEvent.change(screen.getByPlaceholderText('Search the market...'), { target: { value: 'bike' } });
    expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'bike' }));
  });

  it('the grid shows listings, filters and saves', () => {
    const onQuery = vi.fn();
    const onToggleSave = vi.fn();
    const onOpen = vi.fn();
    render(
      <MarketGrid
        tab="browse"
        items={[listing()]}
        total={1}
        loading={false}
        error={null}
        hasMore={false}
        query={EMPTY_QUERY}
        onQuery={onQuery}
        onMore={() => undefined}
        onRetry={() => undefined}
        onOpen={onOpen}
        saved={[]}
        onToggleSave={onToggleSave}
        photo={photo}
        onSell={() => undefined}
        onBack={() => undefined}
        me="someone-else"
      />,
    );
    expect(screen.getByText('€450')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Free' }));
    expect(onQuery).toHaveBeenCalledWith(expect.objectContaining({ freeOnly: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onToggleSave).toHaveBeenCalledWith('7');
    fireEvent.click(screen.getByRole('button', { name: /Road bike/ }));
    expect(onOpen).toHaveBeenCalledWith('7');
  });

  it('the detail lets a buyer message the seller, and the seller manage it', () => {
    const onMessage = vi.fn();
    const props = {
      saved: false,
      photo,
      onBack: () => undefined,
      onToggleSave: () => undefined,
      onMessage,
      onSellerListings: () => undefined,
      onEdit: () => undefined,
      onStatus: vi.fn(async () => undefined),
      onDelete: async () => undefined,
      onReport: async () => undefined,
    };
    const { unmount } = render(<ListingDetail {...props} listing={listing()} me="buyer" />);
    expect(screen.getByText('Negotiable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message seller' }));
    expect(onMessage).toHaveBeenCalled();
    unmount();
    render(<ListingDetail {...props} listing={listing()} me="aaaaa-bbbbb-ccc" />);
    expect(screen.queryByRole('button', { name: 'Message seller' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mark sold' }));
    expect(props.onStatus).toHaveBeenCalledWith('sold');
  });

  it('the editor asks for the missing fields and keeps existing photos', async () => {
    const onSave = vi.fn(async () => undefined);
    const { unmount } = render(
      <ListingEditor sellerName="Alice" location="Brussels" photo={photo} onSave={onSave} onCancel={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish listing' }));
    expect(await screen.findByText('Add at least one photo.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    unmount();
    render(
      <ListingEditor
        listing={listing()}
        sellerName="Alice"
        location=""
        photo={photo}
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((onSave.mock.calls as unknown as [unknown][])[0]![0]).toMatchObject({ price: 40_000, photos: [{ keep: 'h1' }], title: 'Road bike' });
  });
});
