/**
 * Market: public classified listings. Types, categories, conditions,
 * currencies and price handling shared by the client and the UI.
 * Prices travel in minor units of their currency (cents; 1e-8 for crypto).
 */

export type ListingStatus = 'active' | 'reserved' | 'sold' | 'hidden';
export type MarketSort = 'newest' | 'price-low' | 'price-high';

export interface PhotoMeta {
  hash: string;
  mime: string;
  size: number;
}

export interface Listing {
  id: string;
  seller: string;
  sellerName: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  /** Minor units of `currency`; 0 means free. */
  price: number;
  currency: string;
  negotiable: boolean;
  location: string;
  shipping: boolean;
  pickup: boolean;
  photos: PhotoMeta[];
  status: ListingStatus;
  createdAt: number;
  updatedAt: number;
}

export type PhotoInput = { keep: string } | { add: Uint8Array };

export interface ListingInput {
  sellerName: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  price: number;
  currency: string;
  negotiable: boolean;
  location: string;
  shipping: boolean;
  pickup: boolean;
  photos: PhotoInput[];
}

export interface MarketQuery {
  text: string;
  category?: string;
  condition?: string;
  currency?: string;
  minPrice?: number;
  maxPrice?: number;
  freeOnly: boolean;
  shippingOnly: boolean;
  location: string;
  seller?: string;
  sort: MarketSort;
}

export interface MarketPage {
  items: Listing[];
  total: number;
  nextOffset: number | null;
}

export const PAGE_SIZE = 24;
export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 240 * 1024;
export const LIMITS = { title: 80, description: 3000, location: 80, sellerName: 40 };

export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'electronics', label: 'Electronics' },
  { id: 'computers', label: 'Computers' },
  { id: 'phones', label: 'Phones & tablets' },
  { id: 'home', label: 'Home & garden' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'fashion', label: 'Clothing & shoes' },
  { id: 'beauty', label: 'Health & beauty' },
  { id: 'kids', label: 'Baby & kids' },
  { id: 'sports', label: 'Sports & outdoors' },
  { id: 'hobbies', label: 'Hobbies & games' },
  { id: 'books', label: 'Books & media' },
  { id: 'music', label: 'Music instruments' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'property', label: 'Property rentals' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'services', label: 'Services' },
  { id: 'tickets', label: 'Tickets & events' },
  { id: 'pets', label: 'Pet supplies' },
  { id: 'crypto', label: 'Crypto & hardware wallets' },
  { id: 'other', label: 'Other' },
];

export const CONDITIONS: { id: string; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'like_new', label: 'Like new' },
  { id: 'good', label: 'Good' },
  { id: 'fair', label: 'Fair' },
  { id: 'for_parts', label: 'For parts' },
  { id: 'not_applicable', label: 'Not applicable' },
];

export const CURRENCIES: { code: string; decimals: number; symbol: string }[] = [
  { code: 'EUR', decimals: 2, symbol: '€' },
  { code: 'USD', decimals: 2, symbol: '$' },
  { code: 'GBP', decimals: 2, symbol: '£' },
  { code: 'CHF', decimals: 2, symbol: 'CHF ' },
  { code: 'CNY', decimals: 2, symbol: '¥' },
  { code: 'JPY', decimals: 0, symbol: '¥' },
  { code: 'ICP', decimals: 8, symbol: '' },
  { code: 'BTC', decimals: 8, symbol: '' },
  { code: 'ETH', decimals: 8, symbol: '' },
  { code: 'USDC', decimals: 2, symbol: '' },
  { code: 'USDT', decimals: 2, symbol: '' },
];

const currency = (code: string) => CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]!;

export const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';
export const conditionLabel = (id: string) => CONDITIONS.find((c) => c.id === id)?.label ?? '';

/** "€1,250", "0.015 BTC", "Free". */
export function formatPrice(minor: number, code: string): string {
  if (minor === 0) return 'Free';
  const c = currency(code);
  const value = minor / 10 ** c.decimals;
  const text = value.toLocaleString('en-US', {
    minimumFractionDigits: c.decimals > 2 || Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: c.decimals,
  });
  return c.symbol ? `${c.symbol}${text}` : `${text} ${c.code}`;
}

/** Parses a typed price ("1,250.50") into minor units; null when not a valid price. */
export function parsePrice(text: string, code: string): number | null {
  const t = text.trim().replace(/[,\s]/g, '');
  if (!t) return null;
  const c = currency(code);
  const m = /^(\d{1,15})(?:\.(\d*))?$/.exec(t);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > c.decimals) return null;
  const minor = Number(m[1]) * 10 ** c.decimals + Number(frac.padEnd(c.decimals, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

/** The typed form of a price in minor units (for editing). */
export function priceText(minor: number, code: string): string {
  if (!minor) return '';
  const c = currency(code);
  const whole = Math.floor(minor / 10 ** c.decimals);
  const frac = String(minor % 10 ** c.decimals)
    .padStart(c.decimals, '0')
    .replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

export interface ListingDraft {
  title: string;
  description: string;
  category: string;
  condition: string;
  price: string;
  free: boolean;
  currency: string;
  negotiable: boolean;
  location: string;
  shipping: boolean;
  pickup: boolean;
  photoCount: number;
}

/** Problems with a draft, by field (empty when it can be published). */
export function draftErrors(d: ListingDraft): Partial<Record<keyof ListingDraft, string>> {
  const e: Partial<Record<keyof ListingDraft, string>> = {};
  const title = d.title.trim();
  if (title.length < 3) e.title = 'Add a title (at least 3 characters).';
  else if (title.length > LIMITS.title) e.title = `At most ${LIMITS.title} characters.`;
  if (d.description.trim().length > LIMITS.description) e.description = `At most ${LIMITS.description} characters.`;
  if (!d.category) e.category = 'Pick a category.';
  if (!d.condition) e.condition = 'Pick a condition.';
  if (!d.free) {
    const p = parsePrice(d.price, d.currency);
    if (p === null || p === 0) e.price = 'Enter a price, or mark the item as free.';
  }
  if (d.location.trim().length > LIMITS.location) e.location = `At most ${LIMITS.location} characters.`;
  if (!d.shipping && !d.pickup) e.shipping = 'Choose pickup, shipping or both.';
  if (d.photoCount === 0) e.photoCount = 'Add at least one photo.';
  return e;
}

/** "Just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
export function listedAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A link that opens the listing in OpenSocial. */
export const listingLink = (id: string, origin = 'https://chat.opensocial.cc') => `${origin}/#/market/${id}`;

/** The listing id in a location hash such as "#/market/12". */
export function listingIdFromHash(hash: string): string | null {
  return /^#\/market\/(\d{1,19})$/.exec(hash)?.[1] ?? null;
}

export const STATUS_LABELS: Record<ListingStatus, string> = {
  active: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
  hidden: 'Under review',
};
