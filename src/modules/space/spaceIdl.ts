/**
 * Candid interface of the space module (backend/space/src/space.rs), in the
 * space canister (open-social-app-space). Keep in sync with
 * backend/space/open_social_space.did.
 */
import { IDL } from '@icp-sdk/core/candid';
export const SPACE_CANISTER_ID = '464na-uaaaa-aaaao-qqoua-cai';

export const spaceIdl: IDL.InterfaceFactory = ({ IDL }) => {
  const Kind = IDL.Variant({
    Post: IDL.Null,
    Link: IDL.Null,
    Work: IDL.Null,
    Video: IDL.Null,
    Music: IDL.Null,
    Dapp: IDL.Null,
  });
  const ImageMeta = IDL.Record({ hash: IDL.Text, mime: IDL.Text, size: IDL.Nat32 });
  const MediaMeta = IDL.Record({
    id: IDL.Nat64,
    owner: IDL.Principal,
    mime: IDL.Text,
    size: IDL.Nat64,
    chunks: IDL.Nat32,
    received: IDL.Nat32,
    item: IDL.Opt(IDL.Nat64),
    created_at_ns: IDL.Nat64,
  });
  const Item = IDL.Record({
    id: IDL.Nat64,
    owner: IDL.Principal,
    kind: Kind,
    title: IDL.Text,
    body: IDL.Text,
    url: IDL.Text,
    tags: IDL.Vec(IDL.Text),
    images: IDL.Vec(ImageMeta),
    media: IDL.Opt(MediaMeta),
    canister_id: IDL.Text,
    likes: IDL.Nat32,
    hidden: IDL.Bool,
    created_at_ns: IDL.Nat64,
    updated_at_ns: IDL.Nat64,
  });
  const Page = IDL.Record({ items: IDL.Vec(Item), total: IDL.Nat64, next_offset: IDL.Opt(IDL.Nat64) });
  const PhotoInput = IDL.Variant({ Keep: IDL.Text, Add: IDL.Vec(IDL.Nat8) });
  const ItemInput = IDL.Record({
    kind: Kind,
    title: IDL.Text,
    body: IDL.Text,
    url: IDL.Text,
    tags: IDL.Vec(IDL.Text),
    images: IDL.Vec(PhotoInput),
    media: IDL.Opt(IDL.Nat64),
    canister_id: IDL.Text,
  });
  const SpaceView = IDL.Record({
    owner: IDL.Principal,
    about: IDL.Text,
    accent: IDL.Text,
    pinned: IDL.Opt(IDL.Nat64),
    visible: IDL.Bool,
    show_market: IDL.Bool,
    items: IDL.Nat64,
    likes: IDL.Nat64,
    used_bytes: IDL.Opt(IDL.Nat64),
    quota_bytes: IDL.Nat64,
  });
  const SpaceInput = IDL.Record({
    about: IDL.Text,
    accent: IDL.Text,
    pinned: IDL.Opt(IDL.Nat64),
    visible: IDL.Bool,
    show_market: IDL.Bool,
  });
  const Unit = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
  const Id = IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text });
  return IDL.Service({
    space_get: IDL.Func([IDL.Principal], [IDL.Opt(SpaceView)], ['query']),
    space_set: IDL.Func([SpaceInput], [Unit], []),
    space_items: IDL.Func([IDL.Principal, IDL.Opt(Kind), IDL.Nat64, IDL.Nat32], [Page], ['query']),
    space_item: IDL.Func([IDL.Nat64], [IDL.Opt(Item)], ['query']),
    space_items_by_ids: IDL.Func([IDL.Vec(IDL.Nat64)], [IDL.Vec(Item)], ['query']),
    space_recent: IDL.Func([IDL.Opt(Kind), IDL.Nat64, IDL.Nat32], [Page], ['query']),
    space_feed: IDL.Func([IDL.Vec(IDL.Principal), IDL.Nat64, IDL.Nat32], [Page], ['query']),
    space_image: IDL.Func([IDL.Nat64, IDL.Text], [IDL.Opt(IDL.Vec(IDL.Nat8))], ['query']),
    space_media_chunk: IDL.Func([IDL.Nat64, IDL.Nat32], [IDL.Opt(IDL.Vec(IDL.Nat8))], ['query']),
    space_upload_begin: IDL.Func([IDL.Text, IDL.Nat64], [Id], []),
    space_upload_chunk: IDL.Func([IDL.Nat64, IDL.Nat32, IDL.Vec(IDL.Nat8)], [Unit], []),
    space_upload_cancel: IDL.Func([IDL.Nat64], [Unit], []),
    space_create: IDL.Func([ItemInput], [Id], []),
    space_update: IDL.Func([IDL.Nat64, ItemInput], [Unit], []),
    space_delete: IDL.Func([IDL.Nat64], [Unit], []),
    space_like: IDL.Func([IDL.Nat64, IDL.Bool], [IDL.Variant({ Ok: IDL.Nat32, Err: IDL.Text })], []),
    space_liked: IDL.Func([IDL.Vec(IDL.Nat64)], [IDL.Vec(IDL.Nat64)], ['query']),
    space_report: IDL.Func([IDL.Nat64, IDL.Text], [Unit], []),
    delete_my_data: IDL.Func([], [Unit], []),
  });
};
