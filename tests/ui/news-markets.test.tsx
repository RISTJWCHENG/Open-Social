// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatPercent, formatPrice, IndexDetail, PriceDetail, PriceList } from '../../src/ui/NewsMarkets';
import type { Coin } from '../../src/core/news/hashfirst';

const coins: Coin[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1, price: 91234.5, change24h: 2.1, sparkline: [1, 2, 3] },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2, price: 3100, change24h: -1, sparkline: [3, 2, 1] },
];
const state = { loading: false, error: null, reload: () => undefined };

describe('PRICE and INDEX', () => {
  it('formats like the news site', () => {
    expect(formatPrice(91234.5)).toBe('$91,234.50');
    expect(formatPrice(0.000123)).toBe('$0.000123');
    expect(formatPercent(2.1)).toBe('+2.10%');
    expect(formatPercent(undefined)).toBe('—');
  });

  it('lists coins, searches and selects one; the detail shows its numbers', () => {
    const onSelect = vi.fn();
    render(<PriceList coins={coins} state={state} selectedId="bitcoin" onSelect={onSelect} />);
    fireEvent.change(screen.getByPlaceholderText('Search coin...'), { target: { value: 'eth' } });
    fireEvent.click(screen.getByRole('button', { name: /Ethereum/ }));
    expect(onSelect).toHaveBeenCalledWith(coins[1]);
    render(<PriceDetail coin={coins[0]!} onBack={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Bitcoin' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bitcoin price over the last 7 days' })).toBeInTheDocument();
  });

  it('shows a placeholder until an index is chosen', () => {
    render(<IndexDetail index={null} onBack={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Choose an index' })).toBeInTheDocument();
  });
});
