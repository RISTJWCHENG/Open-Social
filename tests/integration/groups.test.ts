import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { setMlsWasm } from '../../src/core/mls/mls';
import { DEPOSIT_RETRY_MS, pacing, type RealMessaging } from '../../src/core/delivery/realMessaging';
import { groupKey } from '../../src/core/groups/groups';
import { bytesSource } from '../../src/core/files/chunkedFile';
import { FakeNetwork, user } from './fakeNetwork';

beforeAll(() => {
  DEPOSIT_RETRY_MS.splice(0, DEPOSIT_RETRY_MS.length, 5, 5);
  pacing.msToNextMinute = () => 5;
  setMlsWasm(readFileSync('src/vendor/open-social-mls/open_social_mls_bg.wasm'));
});

const A = 'alice-principal';
const B = 'bob-principal';
const C = 'carol-principal';
const D = 'dave-principal';

/** Three friends of Alice's; Bob and Carol are not friends of each other. */
async function setup() {
  const net = new FakeNetwork();
  const alice = (await user(net, A)).m;
  const bob = (await user(net, B)).m;
  const carol = (await user(net, C)).m;
  const dave = (await user(net, D)).m;
  for (const x of [B, C, D]) await alice.addContact(x);
  await bob.addContact(A);
  await carol.addContact(A);
  alice.setMyName('Alice');
  bob.setMyName('Bob');
  carol.setMyName('Carol');
  dave.setMyName('Dave');
  return { net, alice, bob, carol, dave };
}

const texts = (m: RealMessaging, key: string) =>
  m
    .messages(key)
    .filter((x) => !x.notice)
    .map((x) => x.body);
const notices = (m: RealMessaging, key: string) => m.messages(key).flatMap((x) => (x.notice ? [x.notice.kind] : []));

describe('group chats', () => {
  it('creates a group, and every member gets the messages of every other member', async () => {
    const { alice, bob, carol } = await setup();
    const key = await alice.createGroup({ name: 'Trip to Portland', members: [B, C] });
    const id = key.slice(2);
    await bob.poll();
    await carol.poll();
    for (const m of [bob, carol]) {
      expect(m.group(id)!.state.name).toBe('Trip to Portland');
      expect(m.group(id)!.state.members.map((x) => [x.account, x.role])).toEqual([
        [A, 'owner'],
        [B, 'member'],
        [C, 'member'],
      ]);
      // "Alice added you"
      expect(notices(m, key)).toEqual(['joined']);
    }
    // Added by a friend: joined at once. A group never makes its members contacts.
    expect(bob.contact(key)).toMatchObject({ group: true, known: true, name: 'Trip to Portland' });
    expect(bob.addressBook().map((c) => c.account)).toEqual([A]);

    await alice.send(key, 'Train at 9?');
    await bob.poll();
    await carol.poll();
    await bob.send(key, 'Works for me');
    await alice.poll();
    await carol.poll();
    expect(texts(carol, key)).toEqual(['Train at 9?', 'Works for me']);
    expect(
      carol
        .messages(key)
        .filter((x) => !x.notice)
        .map((x) => x.from),
    ).toEqual([A, B]);
    // Bob is no contact of Carol's: no request appears, and his own name is shown.
    expect(carol.contact(B)).toBeUndefined();
    expect(carol.memberName(id, B)).toBe('Bob');
    expect(texts(alice, key)).toEqual(['Train at 9?', 'Works for me']);
    expect(alice.unreadCount(key)).toBe(1);
  });

  it('replies, edits, reactions per member and delete for everyone work in groups', async () => {
    const { alice, bob, carol } = await setup();
    const key = await alice.createGroup({ name: 'G', members: [B, C] });
    await bob.poll();
    await carol.poll();
    await alice.send(key, 'Lunch?');
    await bob.poll();
    await carol.poll();
    const lunchAtBob = bob.messages(key).find((m) => m.body === 'Lunch?')!;
    await bob.send(key, 'Yes', lunchAtBob.id);
    await bob.react(key, lunchAtBob.id, '👍', true);
    const lunchAtCarol = carol.messages(key).find((m) => m.body === 'Lunch?')!;
    await carol.react(key, lunchAtCarol.id, '👍', true);
    await carol.react(key, lunchAtCarol.id, '🎉', true);
    await alice.poll();
    await carol.poll();
    const lunch = alice.messages(key).find((m) => m.body === 'Lunch?')!;
    expect(lunch.memberReactions).toEqual({ [B]: ['👍'], [C]: ['👍', '🎉'] });
    expect(lunch.reactions?.them).toEqual(['👍', '🎉']);
    // Carol sees Bob's reply quoting Alice's message, with its author.
    const reply = carol.messages(key).find((m) => m.body === 'Yes')!;
    expect(reply.replyTo).toMatchObject({ text: 'Lunch?', author: A, mine: false });
    // At Alice's the quote is hers.
    expect(alice.messages(key).find((m) => m.body === 'Yes')!.replyTo).toMatchObject({ mine: true, author: A });

    // Bob takes back his reaction: Carol's stay.
    await bob.react(key, lunchAtBob.id, '👍', false);
    await alice.poll();
    expect(lunch.memberReactions).toEqual({ [C]: ['👍', '🎉'] });

    const mine = alice.messages(key).find((m) => m.body === 'Lunch?')!;
    await alice.editMessage(key, mine.id, 'Lunch at 1?');
    await bob.poll();
    expect(texts(bob, key)).toContain('Lunch at 1?');
    await alice.deleteForEveryone(key, mine.id);
    await bob.poll();
    await carol.poll();
    expect(bob.messages(key).find((m) => m.remoteId === mine.id)!.deleted).toBe(true);
    expect(carol.messages(key).find((m) => m.remoteId === mine.id)!.deleted).toBe(true);
  });

  it('admins add and remove members; removed members get nothing more', async () => {
    const { alice, bob, carol, dave } = await setup();
    const key = await alice.createGroup({ name: 'G', members: [B, C] });
    const id = key.slice(2);
    await bob.poll();
    await carol.poll();

    // A member who is not an admin can't add people.
    await expect(bob.addMembers(id, [D])).rejects.toMatchObject({ code: 'GROUP_FORBIDDEN' });

    await alice.addMembers(id, [D]);
    await bob.poll();
    await carol.poll();
    await dave.poll();
    expect(bob.group(id)!.state.members.map((m) => m.account)).toEqual([A, B, C, D]);
    expect(notices(bob, key)).toEqual(['joined', 'added']);
    // Dave was added by a friend? No: Alice is not his contact, so the group waits as a request.
    expect(dave.contact(key)).toMatchObject({ known: false });
    expect(notices(dave, key)).toEqual(['joined']);
    await dave.joinGroup(id);
    expect(dave.contact(key)!.known).toBe(true);

    await alice.removeMember(id, C);
    await carol.poll();
    await bob.poll();
    expect(carol.group(id)!.left).toBe(true);
    expect(notices(carol, key).at(-1)).toBe('removed');
    await expect(carol.send(key, 'still here?')).rejects.toMatchObject({ code: 'GROUP_LEFT' });

    await bob.send(key, 'Hello all');
    await carol.poll();
    await dave.poll();
    expect(texts(carol, key)).toEqual([]);
    expect(texts(dave, key)).toEqual(['Hello all']);
  });

  it('roles: admins, admin-only posting, owner leaving hands the group on', async () => {
    const { alice, bob, carol } = await setup();
    const key = await alice.createGroup({ name: 'G', members: [B, C] });
    const id = key.slice(2);
    await bob.poll();
    await carol.poll();

    await alice.setMemberRole(id, B, 'admin');
    await alice.updateGroup(id, { onlyAdminsPost: true, name: 'Announcements' });
    await bob.poll();
    await carol.poll();
    expect(carol.group(id)!.state).toMatchObject({ name: 'Announcements', onlyAdminsPost: true });
    expect(carol.contact(key)!.name).toBe('Announcements');
    await expect(carol.send(key, 'hi')).rejects.toMatchObject({ code: 'GROUP_ADMINS_ONLY' });
    await bob.send(key, 'From an admin');
    await carol.poll();
    expect(texts(carol, key)).toEqual(['From an admin']);

    // An admin can't change the owner's settings.
    await expect(bob.updateGroup(id, { onlyAdminsPost: false })).rejects.toMatchObject({ code: 'GROUP_FORBIDDEN' });

    // The owner leaves: the longest-serving admin (Bob) becomes the owner.
    await alice.leaveGroup(id);
    await bob.poll();
    await carol.poll();
    expect(alice.group(id)!.left).toBe(true);
    expect(carol.group(id)!.state.members.map((m) => [m.account, m.role])).toEqual([
      [B, 'owner'],
      [C, 'member'],
    ]);
    expect(notices(carol, key)).toContain('left');
    expect(notices(carol, key)).toContain('owner');
  });

  it('ignores group changes from members who may not make them', async () => {
    const { alice, bob, carol } = await setup();
    const key = await alice.createGroup({ name: 'G', members: [B, C] });
    const id = key.slice(2);
    await bob.poll();
    await carol.poll();
    // Bob posts a state that makes him the owner.
    const forged = { ...bob.group(id)!.state, version: 9, updatedBy: B, updatedAt: Date.now() + 1 };
    forged.members = forged.members.map((m) => ({
      ...m,
      role: m.account === B ? ('owner' as const) : ('member' as const),
    }));
    await (bob as unknown as { deliverToGroup: (...a: unknown[]) => Promise<void> }).deliverToGroup(id, [
      { t: 'group-state', s: forged },
    ]);
    await carol.poll();
    expect(carol.group(id)!.state.members.find((m) => m.role === 'owner')!.account).toBe(A);
  });

  it('stores a group file once in the shard; every member opens it', async () => {
    const { alice, bob, carol, net } = await setup();
    const key = await alice.createGroup({ name: 'G', members: [B, C] });
    await bob.poll();
    await carol.poll();
    const bytes = new Uint8Array(300_000).map((_, i) => i % 251);
    const before = net.groupShard.posts;
    await alice.sendFile(key, bytesSource('photo.jpg', 'image/jpeg', bytes));
    expect(net.groupShard.posts - before).toBe(1); // one message for everyone; the file is one blob
    await bob.poll();
    await carol.poll();
    for (const m of [bob, carol]) {
      const msg = m.messages(key).find((x) => x.attachment)!;
      expect(msg).toMatchObject({ from: A, attachment: { name: 'photo.jpg', via: 'sia' } });
      // Small files are fetched as they arrive.
      await new Promise((r) => setTimeout(r, 200));
      expect(msg.attachment!.state).toBe('ready');
      expect(await m.fileBytes(msg.attachment!.fileId)).toEqual(bytes);
      const opened = await m.openFile(key, msg.attachment!.fileId, async () => {
        throw new Error('not Sia');
      });
      expect(new Uint8Array(await new Response(opened.stream).arrayBuffer())).toEqual(bytes);
    }
    await expect(
      alice.sendFile(key, bytesSource('big.bin', 'application/octet-stream', new Uint8Array(26 * 1024 * 1024))),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('a group made on one device reaches our other devices, and so do our changes', async () => {
    const net = new FakeNetwork();
    const alice1 = (await user(net, A)).m;
    const alice2 = (await user(net, A)).m;
    const bob = (await user(net, B)).m;
    await alice1.addContact(B);
    const key = await alice1.createGroup({ name: 'Family', members: [B] });
    const id = key.slice(2);
    await alice2.poll();
    expect(alice2.group(id)!.state.name).toBe('Family');
    expect(alice2.contact(key)!.known).toBe(true);
    await alice1.updateGroup(id, { about: 'Weekend plans' });
    await alice2.poll();
    expect(alice2.group(id)!.state.about).toBe('Weekend plans');
    await bob.poll();
    await bob.send(key, 'hi');
    await alice1.poll();
    await alice2.poll();
    expect(texts(alice1, key)).toEqual(['hi']);
    expect(texts(alice2, key)).toEqual(['hi']);
    expect(groupKey(id)).toBe(key);
  });

  it('one message is one post, whatever the size of the group; members away catch up from the stream', async () => {
    const { alice, bob, carol, dave, net } = await setup();
    const key = await alice.createGroup({ name: 'G', members: [B, C, D] });
    const id = key.slice(2);
    await bob.poll();
    const before = net.groupShard.posts;
    for (let i = 0; i < 5; i++) await alice.send(key, `m${i}`);
    expect(net.groupShard.posts - before).toBe(5);
    await alice.updateGroup(id, { name: 'Renamed' });
    // Carol and Dave were away the whole time.
    await carol.poll();
    await dave.poll();
    for (const m of [carol, dave]) {
      expect(texts(m, key)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
      expect(m.group(id)!.state.name).toBe('Renamed');
    }
  });

  it('a device we sign in on later is added to our groups by one of our devices', async () => {
    const net = new FakeNetwork();
    const alice1 = (await user(net, A)).m;
    const bob = (await user(net, B)).m;
    await alice1.addContact(B);
    const key = await alice1.createGroup({ name: 'Later', members: [B] });
    const id = key.slice(2);
    await bob.poll();
    const alice2 = (await user(net, A)).m;
    (alice1 as unknown as { devicesCheckedAt: number }).devicesCheckedAt = 0;
    await alice1.pollGroups();
    await new Promise((r) => setTimeout(r, 300));
    await alice2.poll();
    expect(alice2.group(id)!.state.name).toBe('Later');
    expect(alice2.group(id)!.state.members.map((m) => m.account)).toEqual([A, B]);
    // Bob's app reads the stream before sending (unless it did so within the last second).
    await new Promise((r) => setTimeout(r, 1_100));
    await bob.send(key, 'hello both');
    await alice2.poll();
    expect(texts(alice2, key)).toEqual(['hello both']);
  });
});
