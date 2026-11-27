/**
 * Client for open-social-profiles: public profile (searchable) and the
 * friends-only sealed profile. Calls are made as the signed-in account.
 */
import { profilesIdl, PROFILES_CANISTER_ID } from './profilesIdl';

type Identity = import('@icp-sdk/core/agent').Identity;
type Res<T> = { Ok: T } | { Err: string };

const ok = <T>(r: Res<T>): T => {
  if ('Err' in r) throw new Error(r.Err);
  return r.Ok;
};
const bytes = (v: Uint8Array | number[]) => (v instanceof Uint8Array ? v : Uint8Array.from(v));

export interface PublicProfile {
  account: string;
  username: string;
  displayName: string;
  bio: string;
  links: ProfileLink[];
  /** Content hash of the public photo, if any (cache key). */
  avatarHash: string | null;
}

export interface ProfileLink {
  label: string;
  url: string;
}

export type AvatarChange = { keep: true } | { remove: true } | { set: Uint8Array };

interface RawView {
  account: { toText(): string };
  username: string;
  display_name: string;
  bio: string;
  links: ProfileLink[];
  avatar: [] | [{ hash: string }];
}

const view = (v: RawView): PublicProfile => ({
  account: v.account.toText(),
  username: v.username,
  displayName: v.display_name,
  bio: v.bio,
  links: v.links,
  avatarHash: v.avatar[0]?.hash ?? null,
});

export class ProfilesClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actorPromise: Promise<any> | null = null;

  constructor(
    private readonly identity: () => Identity | null,
    private readonly canisterId = PROFILES_CANISTER_ID,
    private readonly host?: string,
  ) {}

  private actor() {
    return (this.actorPromise ??= (async () => {
      const { Actor, HttpAgent } = await import('@icp-sdk/core/agent');
      const id = this.identity();
      const agent = await HttpAgent.create({ ...(id ? { identity: id } : {}), ...(this.host ? { host: this.host } : {}) });
      return Actor.createActor(profilesIdl, { agent, canisterId: this.canisterId });
    })());
  }

  private async principal(text: string) {
    const { Principal } = await import('@icp-sdk/core/principal');
    return Principal.fromText(text);
  }

  async setPublic(p: {
    username: string;
    displayName: string;
    bio: string;
    links: ProfileLink[];
    avatar: AvatarChange;
  }): Promise<void> {
    const avatar = 'set' in p.avatar ? { Set: p.avatar.set } : 'remove' in p.avatar ? { Remove: null } : { Keep: null };
    ok(
      await (await this.actor()).set_public_profile({
        username: p.username,
        display_name: p.displayName,
        bio: p.bio,
        links: p.links,
        avatar,
      }),
    );
  }

  async clearPublic(): Promise<void> {
    ok(await (await this.actor()).clear_public_profile());
  }

  async getPublic(account: string): Promise<PublicProfile | null> {
    const r = (await (await this.actor()).get_public_profile(await this.principal(account))) as [] | [RawView];
    return r[0] ? view(r[0]) : null;
  }

  async getPublicAvatar(account: string): Promise<Uint8Array | null> {
    const r = (await (await this.actor()).get_public_avatar(await this.principal(account))) as [] | [Uint8Array | number[]];
    return r[0] ? bytes(r[0]) : null;
  }

  async search(query: string): Promise<PublicProfile[]> {
    return (ok(await (await this.actor()).search_profiles(query)) as RawView[]).map(view);
  }

  async setSealed(blob: Uint8Array | null): Promise<void> {
    ok(await (await this.actor()).set_sealed_profile(blob ? [blob] : []));
  }

  async getSealed(account: string): Promise<Uint8Array | null> {
    const r = (await (await this.actor()).get_sealed_profile(await this.principal(account))) as
      | []
      | [{ blob: Uint8Array | number[] }];
    return r[0] ? bytes(r[0].blob) : null;
  }

  async report(account: string, reason: string): Promise<void> {
    ok(await (await this.actor()).report_profile(await this.principal(account), reason));
  }

  async deleteMyData(): Promise<void> {
    ok(await (await this.actor()).delete_my_data());
  }
}
