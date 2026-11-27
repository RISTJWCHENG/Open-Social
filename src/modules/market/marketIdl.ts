/**
 * Candid interface of the market module (backend/space/src/market.rs), in the
 * space canister. Keep in sync with backend/space/open_social_space.did.
 */
import { IDL } from '@icp-sdk/core/candid';
import { SPACE_CANISTER_ID } from '../space/spaceIdl';

export const MARKET_CANISTER_ID = SPACE_CANISTER_ID;

export const marketIdl: IDL.InterfaceFactory = ({ IDL }) => {
  const Status = IDL.Variant({ Active: IDL.Null, Reserved: IDL.Null, Sold: IDL.Null, Hidden: IDL.Null });
  const PhotoMeta = IDL.Record({ hash: IDL.Text, mime: IDL.Text, size: IDL.Nat32 });
  const Listing = IDL.Record({
    id: IDL.Nat64,
    seller: IDL.Principal,
    seller_name: IDL.Text,
    title: IDL.Text,
    description: IDL.Text,
    category: IDL.Text,
    condition: IDL.Text,
    price: IDL.Nat64,
    currency: IDL.Text,
    negotiable: IDL.Bool,
    location: IDL.Text,
    shipping: IDL.Bool,
    pickup: IDL.Bool,
    photos: IDL.Vec(PhotoMeta),
    status: Status,
    created_at_ns: IDL.Nat64,
    updated_at_ns: IDL.Nat64,
  });
  const PhotoInput = IDL.Variant({ Keep: IDL.Text, Add: IDL.Vec(IDL.Nat8) });
  const ListingInput = IDL.Record({
    seller_name: IDL.Text,
    title: IDL.Text,
    description: IDL.Text,
    category: IDL.Text,
    condition: IDL.Text,
    price: IDL.Nat64,
    currency: IDL.Text,
    negotiable: IDL.Bool,
    location: IDL.Text,
    shipping: IDL.Bool,
    pickup: IDL.Bool,
    photos: IDL.Vec(PhotoInput),
  });
  const Sort = IDL.Variant({ Newest: IDL.Null, PriceLow: IDL.Null, PriceHigh: IDL.Null });
  const Query = IDL.Record({
    text: IDL.Text,
    category: IDL.Opt(IDL.Text),
    condition: IDL.Opt(IDL.Text),
    currency: IDL.Opt(IDL.Text),
    min_price: IDL.Opt(IDL.Nat64),
    max_price: IDL.Opt(IDL.Nat64),
    free_only: IDL.Bool,
    shipping_only: IDL.Bool,
    location: IDL.Text,
    seller: IDL.Opt(IDL.Principal),
    sort: Sort,
    offset: IDL.Nat64,
    limit: IDL.Nat32,
    ids: IDL.Opt(IDL.Vec(IDL.Nat64)),
  });
  const Page = IDL.Record({ items: IDL.Vec(Listing), total: IDL.Nat64, next_offset: IDL.Opt(IDL.Nat64) });
  const Unit = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
  return IDL.Service({
    market_create: IDL.Func([ListingInput], [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })], []),
    market_update: IDL.Func([IDL.Nat64, ListingInput], [Unit], []),
    market_set_status: IDL.Func([IDL.Nat64, Status], [Unit], []),
    market_delete: IDL.Func([IDL.Nat64], [Unit], []),
    market_report: IDL.Func([IDL.Nat64, IDL.Text], [Unit], []),
    market_search: IDL.Func([Query], [Page], ['query']),
    market_listing: IDL.Func([IDL.Nat64], [IDL.Opt(Listing)], ['query']),
    market_listings: IDL.Func([IDL.Vec(IDL.Nat64)], [IDL.Vec(Listing)], ['query']),
    market_my_listings: IDL.Func([], [IDL.Vec(Listing)], ['query']),
    market_photo: IDL.Func([IDL.Nat64, IDL.Text], [IDL.Opt(IDL.Vec(IDL.Nat8))], ['query']),
    market_counts: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, IDL.Nat64))], ['query']),
  });
};
