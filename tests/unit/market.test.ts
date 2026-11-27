import { describe, expect, it } from 'vitest';
import { firstUrl, inAppHash } from '../../src/core/delivery/linkPreview';
import {
  draftErrors,
  formatPrice,
  listingIdFromHash,
  listingLink,
  parsePrice,
  priceText,
  type ListingDraft,
} from '../../src/core/market/market';

const draft: ListingDraft = {
  title: 'Road bike',
  description: '',
  category: 'sports',
  condition: 'good',
  price: '450',
  free: false,
  currency: 'EUR',
  negotiable: false,
  location: 'Portland',
  shipping: false,
  pickup: true,
  photoCount: 1,
};

describe('market', () => {
  it('formats prices in each currency', () => {
    expect(formatPrice(0, 'EUR')).toBe('Free');
    expect(formatPrice(125_000, 'EUR')).toBe('€1,250');
    expect(formatPrice(125_050, 'USD')).toBe('$1,250.50');
    expect(formatPrice(1_500_000, 'BTC')).toBe('0.015 BTC');
    expect(formatPrice(3000, 'JPY')).toBe('¥3,000');
  });

  it('parses typed prices into minor units and back', () => {
    expect(parsePrice('1,250.5', 'EUR')).toBe(125_050);
    expect(parsePrice('0.015', 'BTC')).toBe(1_500_000);
    expect(parsePrice('1.001', 'EUR')).toBeNull();
    expect(parsePrice('12.5', 'JPY')).toBeNull();
    expect(parsePrice('abc', 'EUR')).toBeNull();
    expect(priceText(125_050, 'EUR')).toBe('1250.5');
    expect(priceText(1_500_000, 'BTC')).toBe('0.015');
  });

  it('checks a draft', () => {
    expect(draftErrors(draft)).toEqual({});
    expect(Object.keys(draftErrors({ ...draft, title: 'ab', price: '', photoCount: 0, pickup: false }))).toEqual([
      'title',
      'price',
      'shipping',
      'photoCount',
    ]);
    expect(draftErrors({ ...draft, price: '', free: true })).toEqual({});
  });

  it('links to a listing', () => {
    expect(listingLink('12')).toBe('https://chat.opensocial.cc/#/market/12');
    expect(listingIdFromHash('#/market/12')).toBe('12');
    expect(listingIdFromHash('#/market/x')).toBeNull();
    expect(inAppHash('https://chat.opensocial.cc/#/market/12')).toBe('#/market/12');
    expect(inAppHash('https://example.com/#/market/12')).toBeNull();
    expect(firstUrl('see https://chat.opensocial.cc/#/market/12 and https://example.com')).toBe('https://example.com');
  });
});
