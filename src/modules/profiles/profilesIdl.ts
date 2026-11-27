/**
 * Candid interface of open-social-profiles (backend/profiles).
 * Keep in sync with backend/profiles/open_social_profiles.did.
 */
import { IDL } from '@icp-sdk/core/candid';

export const PROFILES_CANISTER_ID = 'bansl-ciaaa-aaaam-ajq7a-cai';

export const profilesIdl: IDL.InterfaceFactory = ({ IDL }) => {
  const AvatarMeta = IDL.Record({ hash: IDL.Text, mime: IDL.Text, size: IDL.Nat32, updated_at_ns: IDL.Nat64 });
  const SealedMeta = IDL.Record({ hash: IDL.Text, size: IDL.Nat32, updated_at_ns: IDL.Nat64 });
  const Visibility = IDL.Variant({ Friends: IDL.Null, Public: IDL.Null });
  const ProfileLink = IDL.Record({ label: IDL.Text, url: IDL.Text });
  const ProfileRecord = IDL.Record({
    visibility: Visibility,
    username: IDL.Opt(IDL.Text),
    display_name: IDL.Opt(IDL.Text),
    bio: IDL.Opt(IDL.Text),
    links: IDL.Vec(ProfileLink),
    avatar: IDL.Opt(AvatarMeta),
    sealed: IDL.Opt(SealedMeta),
    created_at_ns: IDL.Nat64,
    updated_at_ns: IDL.Nat64,
  });
  const AvatarChange = IDL.Variant({ Keep: IDL.Null, Remove: IDL.Null, Set: IDL.Vec(IDL.Nat8) });
  const PublicProfileInput = IDL.Record({
    username: IDL.Text,
    display_name: IDL.Text,
    bio: IDL.Text,
    links: IDL.Vec(ProfileLink),
    avatar: AvatarChange,
  });
  const PublicProfileView = IDL.Record({
    account: IDL.Principal,
    username: IDL.Text,
    display_name: IDL.Text,
    bio: IDL.Text,
    links: IDL.Vec(ProfileLink),
    avatar: IDL.Opt(AvatarMeta),
    updated_at_ns: IDL.Nat64,
  });
  const Unit = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
  return IDL.Service({
    set_public_profile: IDL.Func([PublicProfileInput], [Unit], []),
    clear_public_profile: IDL.Func([], [Unit], []),
    get_public_profile: IDL.Func([IDL.Principal], [IDL.Opt(PublicProfileView)], ['query']),
    get_public_avatar: IDL.Func([IDL.Principal], [IDL.Opt(IDL.Vec(IDL.Nat8))], ['query']),
    search_profiles: IDL.Func([IDL.Text], [IDL.Variant({ Ok: IDL.Vec(PublicProfileView), Err: IDL.Text })], ['query']),
    set_sealed_profile: IDL.Func([IDL.Opt(IDL.Vec(IDL.Nat8))], [Unit], []),
    get_sealed_profile: IDL.Func(
      [IDL.Principal],
      [IDL.Opt(IDL.Record({ blob: IDL.Vec(IDL.Nat8), meta: SealedMeta }))],
      ['query'],
    ),
    my_data: IDL.Func([], [IDL.Record({ record: IDL.Opt(ProfileRecord), stored_bytes: IDL.Nat64 })], ['query']),
    delete_my_data: IDL.Func([], [Unit], []),
    report_profile: IDL.Func([IDL.Principal, IDL.Text], [Unit], []),
    stats: IDL.Func(
      [],
      [
        IDL.Record({
          profiles: IDL.Nat64,
          public_avatars: IDL.Nat64,
          sealed_profiles: IDL.Nat64,
          usernames: IDL.Nat64,
        }),
      ],
      ['query'],
    ),
  });
};
