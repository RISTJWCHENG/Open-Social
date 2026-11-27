/** In-memory group streams with the same rules as backend/inbox_core/src/groups.rs. */
import {
  StaleEpoch,
  type CommitPost,
  type GroupRole,
  type GroupTransport,
  type StreamEntry,
} from '../../src/core/groups/transport';
import { OpenSocialError } from '../../src/core/types';

interface Group {
  epoch: number;
  nextSeq: number;
  members: Map<string, GroupRole>;
  entries: StreamEntry[];
}

const rank = { Member: 0, Admin: 1, Owner: 2 } as const;
const notMember = () => new OpenSocialError('GROUP_NOT_MEMBER', 'You are not in this group.');
const notAllowed = (m: string) => new OpenSocialError('GROUP_REJECTED', m);

export class FakeGroupShard {
  groups = new Map<string, Group>();
  blobs = new Map<string, { by: string; chunks: Map<number, Uint8Array>; total: number }>();
  posts = 0;
  /** Accounts' key packages come from the mailbox fake. */
  constructor(
    private readonly claim: (account: string, deviceId: string) => Promise<Uint8Array | null>,
    readonly shard = 'shard-000',
  ) {}

  private member(g: string, me: string) {
    const grp = this.groups.get(g);
    if (!grp) throw new OpenSocialError('GROUP_REJECTED', 'NotFound');
    const role = grp.members.get(me);
    if (!role) throw notMember();
    return { grp, role };
  }

  /** The transport as seen by account `me`. */
  as(me: string): GroupTransport {
    return {
      homeShard: async () => this.shard,
      create: async (_s, g) => {
        if (this.groups.has(g)) throw notAllowed('taken');
        this.groups.set(g, { epoch: 0, nextSeq: 1, members: new Map([[me, 'Owner']]), entries: [] });
      },
      post: async (_s, g, device, epoch, data) => {
        const { grp } = this.member(g, me);
        this.posts++;
        const seq = grp.nextSeq++;
        grp.entries.push({ seq, from: me, device, kind: 'Message', epoch, atMs: Date.now(), data });
        return seq;
      },
      postCommit: async (_s, c: CommitPost) => {
        const { grp, role } = this.member(c.group, me);
        if (c.epoch !== grp.epoch) throw new StaleEpoch(grp.epoch);
        if ((c.add.length || c.remove.length) && role === 'Member')
          throw notAllowed('Only admins add or remove members');
        for (const p of c.remove) {
          const r = grp.members.get(p);
          if (r === 'Owner') throw notAllowed("The owner can't be removed");
          if (r === 'Admin' && role !== 'Owner' && p !== me) throw notAllowed('Only the owner removes admins');
        }
        if (c.welcome !== undefined) {
          const b = this.blobs.get(`${c.group}:${c.welcome}`);
          if (!b || b.chunks.size !== b.total) throw notAllowed('Welcome not uploaded');
        }
        for (const p of c.remove) grp.members.delete(p);
        for (const p of c.add) if (!grp.members.has(p)) grp.members.set(p, 'Member');
        this.posts++;
        const seq = grp.nextSeq++;
        grp.entries.push({
          seq,
          from: me,
          device: c.device,
          kind: 'Commit',
          epoch: grp.epoch,
          atMs: Date.now(),
          data: c.commit,
          ...(c.welcome !== undefined ? { welcome: c.welcome } : {}),
        });
        grp.epoch++;
        return seq;
      },
      setRole: async (_s, g, account, role) => {
        const { grp, role: mine } = this.member(g, me);
        const cur = grp.members.get(account);
        if (!cur) throw notAllowed('NotFound');
        const ok =
          (cur === 'Member' && role === 'Admin' && rank[mine] >= 1) ||
          (cur === 'Admin' && role === 'Member' && (mine === 'Owner' || account === me)) ||
          (role === 'Owner' && mine === 'Owner');
        if (!ok) throw notAllowed('Not allowed');
        if (role === 'Owner') grp.members.set(me, 'Admin');
        grp.members.set(account, role);
      },
      leave: async (_s, g, heir) => {
        const { grp, role } = this.member(g, me);
        if (role === 'Owner' && grp.members.size > 1) {
          if (!heir || !grp.members.has(heir) || heir === me) throw notAllowed('Name the next owner');
          grp.members.set(heir, 'Owner');
        }
        grp.members.delete(me);
      },
      blobPut: async (_s, g, blob, index, chunks, _size, data) => {
        this.member(g, me);
        const k = `${g}:${blob}`;
        const b = this.blobs.get(k) ?? { by: me, chunks: new Map(), total: chunks };
        if (b.by !== me) throw notAllowed('taken');
        b.chunks.set(index, data.slice());
        this.blobs.set(k, b);
      },
      blobGet: async (_s, g, blob, index) => {
        this.member(g, me);
        const d = this.blobs.get(`${g}:${blob}`)?.chunks.get(index);
        if (!d) throw notAllowed('NotFound');
        return d;
      },
      read: async (_s, g, after) =>
        this.member(g, me)
          .grp.entries.filter((e) => e.seq > after)
          .slice(0, 500),
      heads: async (_s, gs) =>
        gs.flatMap((g) => {
          const grp = this.groups.get(g);
          const role = grp?.members.get(me);
          return grp && role ? [{ group: g, lastSeq: grp.nextSeq - 1, epoch: grp.epoch, role }] : [];
        }),
      claimKeyPackages: async (devices) => Promise.all(devices.map((d) => this.claim(d.account, d.deviceId))),
    };
  }
}
