/**
 * Candid interface of the OpenSocial search canister (backend/search).
 * Keep in sync with backend/search/open_social_search.did.
 */
import { IDL } from '@icp-sdk/core/candid';

export const SEARCH_CANISTER_ID = '4z5lu-zyaaa-aaaao-qqouq-cai';

export const searchIdl: IDL.InterfaceFactory = ({ IDL }) => {
  const Hit = IDL.Record({
    kind: IDL.Text,
    id: IDL.Text,
    owner: IDL.Principal,
    title: IDL.Text,
    snippet: IDL.Text,
    score: IDL.Float32,
    updated_at_ns: IDL.Nat64,
  });
  const Query = IDL.Record({ text: IDL.Text, kinds: IDL.Vec(IDL.Text), offset: IDL.Nat32, limit: IDL.Nat32 });
  const Page = IDL.Record({ hits: IDL.Vec(Hit), total: IDL.Nat64, next_offset: IDL.Opt(IDL.Nat32) });
  return IDL.Service({
    search: IDL.Func([Query], [Page], ['query']),
    search_ids: IDL.Func([IDL.Text, IDL.Text, IDL.Nat32], [IDL.Vec(IDL.Text)], ['query']),
  });
};
