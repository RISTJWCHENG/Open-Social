import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { setMlsWasm } from '../../src/core/mls/mls';

beforeAll(() => {
  // Retry quickly in tests.
  DEPOSIT_RETRY_MS.splice(0, DEPOSIT_RETRY_MS.length, 5, 5);
  pacing.msToNextMinute = () => 5;
  setMlsWasm(readFileSync('src/vendor/open-social-mls/open_social_mls_bg.wasm'));
});
import { DEPOSIT_RETRY_MS, RealMessaging, pacing } from '../../src/core/delivery/realMessaging';
import { openProfile, sealProfile } from '../../src/core/profile/sealedProfile';
import { bytesSource, readAll } from '../../src/core/files/chunkedFile';
import { MemoryStore } from '../../src/core/delivery/localStore';
import { decodeEntry, encodeEntry } from '../../src/core/delivery/logEntry';

import { FakeNetwork, user } from './fakeNetwork';

describe('RealMessaging over an offline mailbox', () => {
  it('delivers to an offline recipient, replies, and clears the mailbox', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice-principal');
    const { m: bob } = await user(net, 'bob-principal');

    await expect(alice.addContact('nobody')).rejects.toMatchObject({ code: 'CONTACT_UNKNOWN' });
    await expect(alice.addContact('alice-principal')).rejects.toMatchObject({ code: 'CONTACT_SELF' });
    await alice.addContact('bob-principal', 'Bob');

    // Bob is offline: nothing polls on his side.
    await alice.send('bob-principal', 'Hi Bob, are you there?');
    await alice.send('bob-principal', 'Second message');
    expect(alice.messages('bob-principal').map((x) => x.status)).toEqual(['sent', 'sent']);
    // A Welcome (to join Alice's outbound MLS group) and two MLS messages.
    expect(net.boxes.get(`bob-principal:${bob.deviceId}`)).toHaveLength(3);
    // The mailbox only ever holds ciphertext.
    const raw = new TextDecoder().decode(net.boxes.get(`bob-principal:${bob.deviceId}`)![0]!.entry);
    expect(raw).not.toContain('Hi Bob');

    // Bob comes online.
    expect(await bob.poll()).toBe(2);
    expect(bob.messages('alice-principal').map((x) => x.body)).toEqual([
      'Hi Bob, are you there?',
      'Second message',
    ]);
    expect(bob.contacts()[0]).toMatchObject({ account: 'alice-principal', known: false });
    expect(net.boxes.get(`bob-principal:${bob.deviceId}`)).toHaveLength(0);

    await bob.send('alice-principal', 'Yes! Got both.');
    expect(await alice.poll()).toBe(1);
    expect(alice.messages('bob-principal').at(-1)).toMatchObject({
      direction: 'in',
      body: 'Yes! Got both.',
      verified: true,
    });
  });

  it('keeps device keys, contacts and cursor across a reload', async () => {
    const net = new FakeNetwork();
    const store = new MemoryStore();
    const { m: alice1 } = await user(net, 'alice', store);
    const { m: bob } = await user(net, 'bob');
    await bob.addContact('alice');
    await bob.send('alice', 'before reload');
    await alice1.poll();
    const { m: alice2 } = await user(net, 'alice', store);
    expect(alice2.deviceId).toBe(alice1.deviceId);
    expect(alice2.messages('bob').map((x) => x.body)).toEqual(['before reload']);
    expect(await alice2.poll()).toBe(0);
    expect(net.devices.get('alice')).toHaveLength(1);
  });

  it('keeps notes to yourself on this device: text and files, nothing delivered', async () => {
    const net = new FakeNetwork();
    const store = new MemoryStore();
    const { m: alice } = await user(net, 'alice', store);
    const deposits = net.batches;
    await alice.send('alice', 'buy milk');
    await alice.sendFile('alice', bytesSource('big.bin', 'application/octet-stream', new Uint8Array(11 * 1024 * 1024).fill(1)));
    expect(net.batches).toBe(deposits);
    expect([...net.boxes.values()].flat()).toHaveLength(0);
    const notes = alice.messages('alice');
    expect(notes.map((m) => m.status)).toEqual(['sent', 'sent']);
    expect(notes[1]!.attachment).toMatchObject({ state: 'ready', size: 11 * 1024 * 1024 });
    expect(alice.contacts()).toEqual([]); // not a contact
    const { m: again } = await user(net, 'alice', store); // reload
    expect(again.messages('alice').map((m) => m.body)).toEqual(['buy milk', '']);
    // Over 10 MB: kept in chunks on the device, opened as a stream.
    expect(notes[1]!.attachment!.localChunks).toBe(3);
    expect(await again.fileBytes(notes[1]!.attachment!.fileId)).toBeNull();
    const opened = await again.openFile('alice', notes[1]!.attachment!.fileId, async () => {
      throw new Error('not from Sia');
    });
    expect((await readAll(opened.stream)).length).toBe(11 * 1024 * 1024);
  });

  it('backs up real chats and restores them on a fresh device (no keys in the backup)', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'one');
    await bob.poll();
    await bob.send('alice', 'two');
    await alice.poll();
    await alice.setNickname('bob', 'Bobby');
    await alice.send('alice', 'a note');
    const backup = alice.exportBackup();
    const text = new TextDecoder().decode(backup);
    expect(text).not.toMatch(/mls|signingPrivateKey|profileKey/);

    const { m: fresh } = await user(net, 'alice', new MemoryStore()); // a new device, empty
    expect(await fresh.importBackup(backup)).toBe(3);
    expect(fresh.messages('bob').map((m) => m.body)).toEqual(['one', 'two']);
    expect(fresh.messages('alice').map((m) => m.body)).toEqual(['a note']);
    expect(fresh.contact('bob')).toMatchObject({ known: true, nickname: 'Bobby', name: 'Bobby' });
    expect(await fresh.importBackup(backup)).toBe(0); // restoring twice adds nothing
    await expect(fresh.importBackup(new TextEncoder().encode('{}'))).rejects.toThrow(/not an OpenSocial chat backup/);
  });

  it('repairs a channel the receiver lost (e.g. an older tab overwrote its state) and re-sends', async () => {
    const net = new FakeNetwork();
    const aliceStore = new MemoryStore();
    const { m: alice } = await user(net, 'alice', aliceStore);
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'hi bob');
    await bob.poll();
    await bob.accept('alice');
    // Alice's device state before Bob's channel to her exists...
    await alice.poll();
    const snapshot = structuredClone((aliceStore as unknown as { kv: Map<string, string> }).kv);
    await bob.send('alice', 'one');
    await alice.poll();
    expect(alice.messages('bob').map((m) => m.body)).toContain('one');
    // ...is written back over the newer one (two tabs saving in turn): Bob's channel is gone.
    (aliceStore as unknown as { kv: Map<string, string> }).kv = snapshot;
    const { m: alice2 } = await user(net, 'alice', aliceStore);

    await bob.send('alice', 'two'); // Alice can't decrypt this...
    await alice2.poll();
    expect(alice2.messages('bob').map((m) => m.body)).not.toContain('two');
    expect(alice2.contact('bob')?.repaired).toBe(1);
    // ...so her app asked Bob's for a new channel; Bob's app re-sends through it.
    await vi.waitFor(async () => {
      await bob.poll();
      await alice2.poll();
      expect(alice2.messages('bob').map((m) => m.body)).toContain('two');
    });
    await bob.send('alice', 'three');
    await alice2.poll();
    expect(alice2.messages('bob').at(-1)?.body).toBe('three');
    // Alice -> Bob kept working all along.
    await alice2.send('bob', 'still here');
    await bob.poll();
    expect(bob.messages('alice').at(-1)?.body).toBe('still here');
  });

  it('shows a late message where it was sent, not after replies written meanwhile', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'first');
    await bob.poll();
    await bob.accept('alice');
    await alice.send('bob', 'question'); // sent...
    await new Promise((r) => setTimeout(r, 5));
    await bob.send('alice', 'unrelated'); // ...before Bob writes this
    await bob.poll(); // ...but Alice's message arrives only now
    expect(bob.messages('alice').map((m) => m.body)).toEqual(['first', 'question', 'unrelated']);
  });

  it('never places a message in the future when the sender clock runs ahead', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3_600_000); // Alice's clock is an hour fast
    await alice.send('bob', 'from the future');
    vi.useRealTimers();
    await bob.poll();
    await bob.send('alice', 'later reply');
    const msgs = bob.messages('alice');
    expect(msgs.map((m) => m.body)).toEqual(['from the future', 'later reply']);
    expect(msgs[0]!.sentAt).toBeLessThanOrEqual(Date.now());
  });

  const voiceBytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

  it('sends a photo with the largest preview and a long caption (entries stay under 64 KB)', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    const thumb = `data:image/webp;base64,${'QUJD'.repeat(9475)}`; // 37,900 characters
    const caption = 'Kavárna Slavia, Prague ☕ ' + 'x'.repeat(3000);
    const photo = voiceBytes(1_500_000);
    await alice.sendFile('bob', { ...bytesSource('slavia.jpg', 'image/jpeg', photo), thumb, caption });
    const sent = alice.messages('bob').at(-1)!;
    expect(sent).toMatchObject({ status: 'sent', body: caption });
    await bob.poll();
    const got = bob.messages('alice').at(-1)!;
    expect(got.body).toBe(caption);
    expect(got.attachment).toMatchObject({ state: 'ready', thumb });
    expect(Buffer.from((await bob.fileBytes(got.attachment!.fileId))!).equals(Buffer.from(photo))).toBe(true);
  });

  it('a failed first message does not break the channel: the next one arrives without a repair', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await bob.poll();
    net.failBatches = 3;
    await expect(alice.send('bob', 'lost')).rejects.toThrow();
    await alice.send('bob', 'second try');
    await bob.poll();
    expect(bob.messages('alice').map((m) => m.body)).toContain('second try');
    expect(bob.contact('alice')?.repaired ?? 0).toBe(0);
  });

  it('a large file paces itself at the per-minute limit instead of failing', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'hi');
    await bob.poll();
    net.rateLimit = 40; // entries per window; the file is ~160
    const video = voiceBytes(5_300_000);
    await alice.sendFile('bob', bytesSource('j.mp4', 'video/mp4', video));
    expect(alice.messages('bob').at(-1)!.status).toBe('sent');
    await bob.poll();
    const got = bob.messages('alice').at(-1)!.attachment!;
    expect(got.state).toBe('ready');
    expect(Buffer.from((await bob.fileBytes(got.fileId))!).equals(Buffer.from(video))).toBe(true);
  });

  it('a short network failure is retried automatically', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    net.failBatches = 2; // fails twice, the third try works
    await alice.send('bob', 'made it');
    expect(alice.messages('bob').at(-1)!.status).toBe('sent');
    await bob.poll();
    expect(bob.messages('alice').at(-1)!.body).toBe('made it');
  });

  it('a file cut off halfway can be sent again; the receiver completes it once', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'hi');
    await bob.poll();
    const video = voiceBytes(5_300_000);
    net.failAfter = 6; // six batches go through, then the network is down
    net.failBatches = 3;
    await expect(alice.sendFile('bob', bytesSource('j.mp4', 'video/mp4', video))).rejects.toThrow();
    const sent = alice.messages('bob').at(-1)!;
    expect(sent.status).toBe('failed');
    await bob.poll();
    const half = bob.messages('alice').at(-1)!.attachment!;
    expect(half.state).toBe('receiving');
    expect(half.done).toBeGreaterThan(0);
    expect(half.done).toBeLessThan(half.total);
    // "Not sent" > retry.
    net.failAfter = 0;
    await alice.retryMessage('bob', sent.id);
    expect(sent.status).toBe('sent');
    await bob.poll();
    const got = bob.messages('alice').at(-1)!.attachment!;
    expect(got).toMatchObject({ state: 'ready', done: got.total });
    expect(Buffer.from((await bob.fileBytes(got.fileId))!).equals(Buffer.from(video))).toBe(true);
  }, 30_000); // a 5.3 MB file, encrypted in chunks

  it('a failed text message can be sent again', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'hello');
    net.failBatches = 3;
    await expect(alice.send('bob', 'try me')).rejects.toThrow();
    const m = alice.messages('bob').at(-1)!;
    expect(m.status).toBe('failed');
    await alice.retryMessage('bob', m.id);
    expect(m.status).toBe('sent');
    await bob.poll();
    expect(bob.messages('alice').map((x) => x.body)).toEqual(['hello', 'try me']);
  });

  it('a file that failed to send can be retried', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    net.failBatches = 3;
    await expect(alice.sendFile('bob', { ...bytesSource('a.jpg', 'image/jpeg', voiceBytes(5000)), caption: 'look' })).rejects.toThrow();
    const m = alice.messages('bob').at(-1)!;
    expect(m.attachment!.state).toBe('failed');
    expect(alice.canRetry(m.attachment!.fileId)).toBe(true);
    await alice.retryFile('bob', m.attachment!.fileId);
    expect(m).toMatchObject({ status: 'sent', attachment: { state: 'ready' } });
    await bob.poll();
    expect(bob.messages('alice').at(-1)).toMatchObject({ body: 'look', attachment: { name: 'a.jpg', state: 'ready' } });
  });

  it('voice messages carry their length and waveform, end to end', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    const voice = { ms: 12_400, wave: btoa(String.fromCharCode(...Array.from({ length: 48 }, (_, i) => i * 5))) };
    await alice.sendFile('bob', { ...bytesSource('Voice message.webm', 'audio/webm', voiceBytes(40_000)), voice });
    expect(alice.messages('bob').at(-1)!.attachment!.voice).toEqual(voice);
    await bob.poll();
    const got = bob.messages('alice').at(-1)!.attachment!;
    expect(got).toMatchObject({ mime: 'audio/webm', state: 'ready', voice });
    // Notes to self keep it too.
    await alice.sendFile('alice', { ...bytesSource('memo.webm', 'audio/webm', voiceBytes(1000)), voice });
    expect(alice.messages('alice').at(-1)!.attachment!.voice).toEqual(voice);
  });

  it('drops voice details that are malformed or on a non-audio file', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    const bad = [
      { ms: -1, wave: '' },
      { ms: 16 * 60_000, wave: '' },
      { ms: 1000, wave: 'x'.repeat(200) },
    ];
    for (const voice of bad) {
      await alice.sendFile('bob', { ...bytesSource('v.webm', 'audio/webm', voiceBytes(100)), voice });
    }
    await alice.sendFile('bob', { ...bytesSource('x.pdf', 'application/pdf', voiceBytes(100)), voice: { ms: 1000, wave: '' } });
    await bob.poll();
    expect(bob.messages('alice').filter((m) => m.attachment)).toHaveLength(0);
  });

  describe('chat list settings', () => {
    const setup = async () => {
      const net = new FakeNetwork();
      const { m: alice } = await user(net, 'alice');
      const others: RealMessaging[] = [];
      for (const name of ['bob', 'carol', 'dave', 'erin']) {
        const { m } = await user(net, name);
        others.push(m);
        await alice.addContact(name);
        await alice.send(name, `hi ${name}`);
        await new Promise((r) => setTimeout(r, 3));
      }
      return { net, alice, others };
    };
    const order = (m: RealMessaging) => m.contacts().map((c) => c.account);

    it('pins to the top (latest pinned first, at most 3) and unpins', async () => {
      const { alice } = await setup();
      expect(order(alice)).toEqual(['erin', 'dave', 'carol', 'bob']);
      await alice.updateChat('bob', { pinned: true });
      await new Promise((r) => setTimeout(r, 3));
      await alice.updateChat('carol', { pinned: true });
      expect(order(alice)).toEqual(['carol', 'bob', 'erin', 'dave']);
      await alice.updateChat('dave', { pinned: true });
      await expect(alice.updateChat('erin', { pinned: true })).rejects.toMatchObject({ code: 'PIN_LIMIT' });
      await alice.updateChat('bob', { pinned: false });
      expect(alice.contact('bob')?.pinnedAt).toBeUndefined();
    });

    it('archives, and a new message brings the chat back', async () => {
      const { alice, others } = await setup();
      await alice.updateChat('bob', { archived: true, pinned: true });
      expect(alice.contact('bob')).toMatchObject({ archived: true });
      await others[0]!.poll();
      await others[0]!.accept('alice');
      await others[0]!.send('alice', 'are you there?');
      await alice.poll();
      expect(alice.contact('bob')?.archived).toBe(false);
    });

    it('mutes for a while or always, and unmutes', async () => {
      const { alice } = await setup();
      await alice.updateChat('bob', { muteFor: 8 * 3_600_000 });
      expect(alice.isMuted('bob')).toBe(true);
      await alice.updateChat('bob', { muteFor: Infinity });
      expect(alice.contact('bob')?.mutedUntil).toBe(8_640_000_000_000_000);
      await alice.updateChat('bob', { muteFor: 0 });
      expect(alice.isMuted('bob')).toBe(false);
    });

    it('marks unread until read; favourites', async () => {
      const { alice } = await setup();
      await alice.updateChat('bob', { markedUnread: true, favorite: true });
      expect(alice.contact('bob')).toMatchObject({ markedUnread: true, favorite: true });
      await alice.markRead('bob');
      expect(alice.contact('bob')?.markedUnread).toBe(false);
    });

    it('clear deletes messages and their files here; delete also hides the chat until they write', async () => {
      const { net, alice, others } = await setup();
      const store = (alice as unknown as { store: MemoryStore }).store;
      await alice.sendFile('bob', bytesSource('a.txt', 'text/plain', new Uint8Array(100).fill(1)));
      const fileId = alice.messages('bob').at(-1)!.attachment!.fileId;
      expect(await alice.fileBytes(fileId)).not.toBeNull();
      await alice.clearChat('bob');
      expect(alice.messages('bob')).toEqual([]);
      expect(await alice.fileBytes(fileId)).toBeNull();
      expect(order(alice)).toContain('bob');
      void store;
      await alice.deleteChat('carol');
      expect(order(alice)).not.toContain('carol');
      await others[1]!.poll();
      await others[1]!.accept('alice');
      await others[1]!.send('alice', 'back again');
      await alice.poll();
      expect(order(alice)[0]).toBe('carol');
      expect(alice.messages('carol').map((m) => m.body)).toEqual(['back again']);
      void net;
    });
  });

  it('removes a contact (and the chat) from this device; they come back as a request if they write', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'hi');
    await bob.poll();
    await bob.accept('alice');
    await alice.removeContact('bob');
    expect(alice.contact('bob')).toBeUndefined();
    expect(alice.messages('bob')).toEqual([]);
    expect(alice.addressBook().map((c) => c.account)).not.toContain('bob');
    await bob.send('alice', 'still there?');
    await alice.poll();
    expect(alice.contact('bob')).toMatchObject({ known: false });
    await alice.block('bob');
    expect(alice.blockedContacts().map((c) => c.account)).toEqual(['bob']);
    await alice.unblock('bob');
    expect(alice.blockedContacts()).toEqual([]);
  });

  it('starts a channel with the last-resort key package when the single-use ones have run out', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    for (const e of net.prekeys.values()) if (e) e.oneTime.length = 0; // everyone's single-use keys used up
    await alice.addContact('bob');
    await alice.send('bob', 'hello via last resort');
    await bob.poll();
    expect(bob.messages('alice').map((m) => m.body)).toEqual(['hello via last resort']);
  });

  it('ignores message kinds it does not know (from a newer app) instead of showing their JSON', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'hi');
    const deliver = (alice as unknown as { deliver: (a: string, p: object, at: number) => Promise<void> }).deliver.bind(alice);
    await deliver('bob', { t: 'sticker-v9', id: 'x' }, Date.now());
    await bob.poll();
    expect(bob.messages('alice').map((m) => m.body)).toEqual(['hi']);
  });

  it('a new device of the same account gets the profile key from another of its devices', async () => {
    const net = new FakeNetwork();
    const { m: phone } = await user(net, 'alice');
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    await phone.setMyProfileKey({ key, version: 5 });
    const { m: laptop } = await user(net, 'alice', new MemoryStore()); // signs in later
    const got: { key: string; version: number }[] = [];
    laptop.onOwnProfileKey = (k) => got.push(k);
    await laptop.requestOwnProfileKey();
    await phone.poll(); // the phone comes online and answers
    await new Promise((r) => setTimeout(r, 50)); // its answer goes out in the background
    await laptop.poll();
    expect(got).toEqual([{ key, version: 5 }]);
    // Our own devices never show up as contacts or chats.
    expect(phone.contacts().some((c) => c.account === 'alice')).toBe(false);
    expect(laptop.contacts().some((c) => c.account === 'alice')).toBe(false);
  });

  it('a profile saved on one device reaches the account\'s other devices (newer key and version)', async () => {
    const net = new FakeNetwork();
    const { m: phone } = await user(net, 'alice');
    const { m: laptop } = await user(net, 'alice', new MemoryStore());
    const k = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));
    await laptop.setMyProfileKey({ key: k(1), version: 10 });
    const got: { key: string; version: number }[] = [];
    phone.onOwnProfileKey = (x) => got.push(x);
    await phone.poll();
    expect(got).toEqual([{ key: k(1), version: 10 }]);
    // The phone adopts it without sending it back; a later save on the phone goes to the laptop.
    await phone.setMyProfileKey({ key: k(1), version: 10 }, true);
    const back: { key: string; version: number }[] = [];
    laptop.onOwnProfileKey = (x) => back.push(x);
    await laptop.poll();
    expect(back).toEqual([]);
    await phone.setMyProfileKey({ key: k(1), version: 20 });
    await laptop.poll();
    expect(back).toEqual([{ key: k(1), version: 20 }]);
  });

  it('never lists our own account as a contact (a stray record from an earlier build is dropped)', async () => {
    const net = new FakeNetwork();
    const store = new MemoryStore();
    const { m: alice } = await user(net, 'alice', store);
    const state = (alice as unknown as { state: { contacts: Record<string, unknown> } }).state;
    state.contacts['alice'] = { account: 'alice', name: 'alice', addedAt: 1, known: false };
    expect(alice.contacts().some((c) => c.account === 'alice')).toBe(false);
  });

  describe('replies and reactions', () => {
    const friends = async () => {
      const net = new FakeNetwork();
      const { m: alice } = await user(net, 'alice');
      const { m: bob } = await user(net, 'bob');
      await alice.addContact('bob');
      await alice.send('bob', 'hello');
      await bob.poll();
      await bob.accept('alice');
      return { net, alice, bob };
    };

    it('events: invite, reply, update and cancel reach everyone invited; only the organizer can change them', async () => {
      const { alice, bob } = await friends();
      const start = Date.now() + 86_400_000;
      const id = await alice.createEvent({ title: 'Launch party', start, location: 'Brussels', invitees: ['bob'] });
      expect(alice.messages('bob').at(-1)).toMatchObject({ eventId: id, status: 'sent' });
      await bob.poll();
      expect(bob.event(id)).toMatchObject({ title: 'Launch party', organizer: 'alice', location: 'Brussels' });
      expect(bob.messages('alice').at(-1)!.eventId).toBe(id);
      // Bob answers; Alice records it and shares it with everyone invited.
      await bob.respondEvent(id, 'going');
      await alice.poll();
      expect(alice.event(id)!.responses).toEqual({ bob: 'going' });
      await bob.poll();
      expect(bob.event(id)!.responses).toEqual({ bob: 'going' });
      // An update replaces the event without a second invite message.
      await alice.updateEvent(id, { title: 'Launch party (moved)', start: start + 3_600_000, invitees: ['bob'] });
      await bob.poll();
      expect(bob.event(id)!.title).toBe('Launch party (moved)');
      expect(bob.event(id)!.responses).toEqual({ bob: 'going' });
      expect(bob.messages('alice').filter((m) => m.eventId === id)).toHaveLength(1);
      // Bob can't change Alice's event, and his copy of an "event" from himself as organizer is refused.
      await expect(bob.updateEvent(id, { title: 'Hijack', start, invitees: [] })).rejects.toThrow();
      await alice.cancelEvent(id);
      await bob.poll();
      expect(bob.event(id)!.cancelled).toBe(true);
      // Only friends can be invited.
      await expect(alice.createEvent({ title: 'x', start, invitees: ['carol'] })).rejects.toThrow('Only friends');
    });

    it('a reply carries a quote of the message, and who wrote it as each side sees it', async () => {
      const { alice, bob } = await friends();
      const hello = bob.messages('alice').find((m) => m.body === 'hello')!;
      await bob.send('alice', 'hi Alice!', hello.id);
      expect(bob.messages('alice').at(-1)!.replyTo).toMatchObject({ text: 'hello', mine: false });
      await alice.poll();
      const reply = alice.messages('bob').at(-1)!;
      expect(reply.body).toBe('hi Alice!');
      expect(reply.replyTo).toMatchObject({ text: 'hello', mine: true });
      // The quote points at Alice's own message.
      expect(alice.messages('bob').find((m) => m.id === reply.replyTo!.ref)?.body).toBe('hello');
    });

    it('editing: the friend sees the new text, marked edited, and quotes of it follow', async () => {
      const { alice, bob } = await friends();
      const sent = alice.messages('bob')[0]!;
      await bob.send('alice', 'what do you mean?', bob.messages('alice')[0]!.id);
      await alice.poll();
      await alice.editMessage('bob', sent.id, 'hello there');
      expect(sent).toMatchObject({ body: 'hello there' });
      expect(sent.edited).toBeGreaterThan(0);
      await bob.poll();
      const got = bob.messages('alice')[0]!;
      expect(got.body).toBe('hello there');
      expect(got.edited).toBeGreaterThan(0);
      expect(bob.messages('alice').at(-1)!.replyTo?.text).toBe('hello there');
      // Only our own texts can be edited.
      await expect(bob.editMessage('alice', got.id, 'nope')).rejects.toMatchObject({ code: 'EDIT_CLOSED' });
    });

    it('a link preview travels with the text; a forged one or one for another address is dropped', async () => {
      const { alice, bob } = await friends();
      const image = 'data:image/webp;base64,UklGRg==';
      const preview = { url: 'https://example.com/post', title: 'A post', description: 'About things', site: 'Example', image };
      await alice.send('bob', 'look http://example.com/post!', undefined, preview);
      expect(alice.messages('bob').at(-1)!.linkPreview).toEqual(preview);
      await bob.poll();
      expect(bob.messages('alice').at(-1)!.linkPreview).toEqual(preview);
      // The card must point where the text does, and carry only a small image.
      const deliver = (alice as unknown as { deliver: (a: string, p: object, at: number) => Promise<void> }).deliver.bind(alice);
      await deliver('bob', { t: 'text', text: 'see https://good.example/', mid: 'aaaaaaaaaaaaaaaa', lp: { url: 'https://evil.example/', title: 'Bank' } }, Date.now());
      await deliver('bob', { t: 'text', text: 'https://a.example/x', mid: 'bbbbbbbbbbbbbbbb', lp: { url: 'https://a.example/x', title: 'T', image: 'javascript:alert(1)' } }, Date.now());
      await bob.poll();
      const [forged, badImage] = bob.messages('alice').slice(-2);
      expect(forged!.linkPreview).toBeUndefined();
      expect(badImage!.linkPreview).toEqual({ url: 'https://a.example/x', title: 'T' });
      // Editing the link out of the text takes the card away on both sides.
      const sent = alice.messages('bob').find((m) => m.linkPreview)!;
      await alice.editMessage('bob', sent.id, 'never mind');
      expect(sent.linkPreview).toBeUndefined();
      await bob.poll();
      expect(bob.messages('alice').find((m) => m.body === 'never mind')!.linkPreview).toBeUndefined();
    });

    it('a quote of a message deleted for everyone shows only that it was deleted', async () => {
      const { alice, bob } = await friends();
      const sent = alice.messages('bob').find((m) => m.body === 'hello')!;
      await bob.send('alice', 'what?', bob.messages('alice')[0]!.id);
      await alice.poll();
      await alice.deleteForEveryone('bob', sent.id);
      expect(alice.messages('bob').at(-1)!.replyTo).toMatchObject({ text: '', deleted: true });
      await bob.poll();
      expect(bob.messages('alice').at(-1)!.replyTo).toMatchObject({ text: '', deleted: true });
    });

    it('reactions: several per person, seen by both, each taken back on its own', async () => {
      const { alice, bob } = await friends();
      const atBob = bob.messages('alice')[0]!;
      await bob.react('alice', atBob.id, '👍', true);
      await bob.react('alice', atBob.id, '😂', true);
      expect(atBob.reactions).toEqual({ me: ['👍', '😂'] });
      await alice.poll();
      const atAlice = alice.messages('bob')[0]!;
      expect(atAlice.reactions).toEqual({ them: ['👍', '😂'] });
      await alice.react('bob', atAlice.id, '👍', true);
      await bob.poll();
      expect(atBob.reactions).toEqual({ me: ['👍', '😂'], them: ['👍'] });
      await bob.react('alice', atBob.id, '👍', false);
      await alice.poll();
      expect(atAlice.reactions).toEqual({ me: ['👍'], them: ['😂'] });
      // Adding the same emoji again changes nothing; a reaction is not a new message.
      await bob.react('alice', atBob.id, '😂', true);
      await alice.poll();
      expect(atAlice.reactions).toEqual({ me: ['👍'], them: ['😂'] });
      expect(alice.messages('bob')).toHaveLength(1);
    });
  });

  describe('delete for everyone', () => {
    const friends = async () => {
      const net = new FakeNetwork();
      const { m: alice } = await user(net, 'alice');
      const { m: bob } = await user(net, 'bob');
      await alice.addContact('bob');
      await alice.send('bob', 'hello');
      await bob.poll();
      await bob.accept('alice');
      return { net, alice, bob };
    };

    it('withdraws a text: their app deletes it and shows a placeholder; works when they were offline', async () => {
      const { alice, bob } = await friends();
      await alice.send('bob', 'oops, wrong chat');
      await alice.send('bob', 'this one stays');
      const sent = alice.messages('bob').find((m) => m.body === 'oops, wrong chat')!;
      await alice.deleteForEveryone('bob', sent.id); // Bob hasn't fetched yet
      expect(sent).toMatchObject({ deleted: true, body: '' });
      await bob.poll(); // message and retraction arrive together
      const bodies = bob.messages('alice').map((m) => (m.deleted ? '[deleted]' : m.body));
      expect(bodies).toEqual(['hello', '[deleted]', 'this one stays']);
    });

    it('withdraws a file: the bytes are deleted from their device', async () => {
      const { alice, bob } = await friends();
      const deleted: string[] = [];
      bob.onFilesDeleted = (ids) => deleted.push(...ids);
      await alice.sendFile('bob', { ...bytesSource('secret.pdf', 'application/pdf', new Uint8Array(50_000).fill(9)), caption: 'see this' });
      await bob.poll();
      const got = bob.messages('alice').at(-1)!;
      const fileId = got.attachment!.fileId;
      expect(await bob.fileBytes(fileId)).not.toBeNull();
      await alice.deleteForEveryone('bob', alice.messages('bob').at(-1)!.id);
      await bob.poll();
      expect(got).toMatchObject({ deleted: true, body: '' });
      expect(got.attachment).toBeUndefined();
      expect(await bob.fileBytes(fileId)).toBeNull();
      expect(deleted).toEqual([fileId]);
    });

    it('a file withdrawn while arriving: the parts here are deleted and later parts dropped', async () => {
      const { net, alice, bob } = await friends();
      const big = new Uint8Array(3_000_000).fill(4);
      net.failAfter = 2; // part of the file gets through
      net.failBatches = 3;
      await expect(alice.sendFile('bob', bytesSource('half.bin', 'application/octet-stream', big))).rejects.toThrow();
      await bob.poll();
      const partial = bob.messages('alice').at(-1)!;
      expect(partial.attachment!.state).toBe('receiving');
      const fileId = partial.attachment!.fileId;
      await alice.deleteForEveryone('bob', alice.messages('bob').at(-1)!.id);
      await bob.poll();
      expect(partial.deleted).toBe(true);
      // Even if the rest arrived now (an old copy), nothing would come back.
      net.failAfter = 0;
      await alice.retryFile('bob', fileId).catch(() => undefined);
      await bob.poll();
      expect(bob.messages('alice').filter((m) => m.attachment?.fileId === fileId)).toEqual([]);
    });

    it('only the sender can withdraw their message', async () => {
      const { net, alice, bob } = await friends();
      const { m: carol } = await user(net, 'carol');
      await bob.addContact('carol');
      await carol.poll();
      await carol.accept('bob');
      await alice.send('bob', 'from alice');
      await bob.poll();
      const target = bob.messages('alice').at(-1)!;
      // Carol knows the id somehow and tries to withdraw Alice's message.
      await (carol as unknown as { deliver: (a: string, p: unknown, at: number) => Promise<void> }).deliver(
        'bob',
        { t: 'retract', id: target.remoteId },
        Date.now(),
      );
      await bob.poll();
      expect(target.deleted).toBeUndefined();
      expect(target.body).toBe('from alice');
    });

    it('delete for me removes it here only', async () => {
      const { alice, bob } = await friends();
      await alice.send('bob', 'keep for bob');
      await bob.poll();
      await alice.deleteForMe('bob', alice.messages('bob').at(-1)!.id);
      expect(alice.messages('bob').map((m) => m.body)).toEqual(['hello']);
      expect(bob.messages('alice').at(-1)!.body).toBe('keep for bob');
    });
  });

  it('highlights messages (listed in chat order, newest last); deleting one takes its highlight away', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'one');
    await alice.send('bob', 'two');
    const [one, two] = alice.messages('bob');
    await alice.highlightMessage('bob', two!.id, true);
    await new Promise((r) => setTimeout(r, 3));
    await alice.highlightMessage('bob', one!.id, true);
    expect(alice.highlightedMessages('bob').map((m) => m.body)).toEqual(['one', 'two']); // chat order
    await alice.highlightMessage('bob', two!.id, false);
    expect(alice.highlightedMessages('bob').map((m) => m.body)).toEqual(['one']);
    expect(alice.messages('bob')[1]!.highlightedAt).toBeUndefined();
    await alice.deleteForEveryone('bob', one!.id);
    expect(alice.highlightedMessages('bob')).toEqual([]);
    expect(alice.messages('bob')[0]!.highlightedAt).toBeUndefined();
  });

  describe('receipts', () => {
    const settle = () => new Promise((r) => setTimeout(r, 900)); // receipts go out after a short pause

    const friends = async () => {
      const net = new FakeNetwork();
      const { m: alice } = await user(net, 'alice');
      const { m: bob } = await user(net, 'bob');
      await alice.addContact('bob');
      await alice.send('bob', 'hello');
      await bob.poll();
      await bob.accept('alice');
      await settle();
      await alice.poll();
      return { net, alice, bob };
    };

    it('marks messages sent, then delivered, then read; one receipt covers a burst', async () => {
      const { net, alice, bob } = await friends();
      await alice.send('bob', 'one');
      await alice.send('bob', 'two');
      expect(alice.messages('bob').slice(-2).map((m) => m.status)).toEqual(['sent', 'sent']);
      const before = net.batches;
      await bob.poll();
      await settle();
      expect(net.batches - before).toBe(1); // one delivered receipt for both
      await alice.poll();
      expect(alice.messages('bob').slice(-2).map((m) => m.status)).toEqual(['delivered', 'delivered']);
      await bob.markRead('alice');
      await settle();
      await alice.poll();
      expect(alice.messages('bob').map((m) => m.status)).toEqual(['read', 'read', 'read']);
      // Reading again sends nothing new.
      const n = net.deposits;
      await bob.markRead('alice');
      await settle();
      expect(net.deposits).toBe(n);
      // Receipts are not messages.
      expect(alice.messages('bob').filter((m) => m.direction === 'in')).toHaveLength(0);
    });

    it('sends no receipts to someone not accepted yet, nor for notes to yourself', async () => {
      const net = new FakeNetwork();
      const { m: alice } = await user(net, 'alice');
      const { m: bob } = await user(net, 'bob');
      await alice.addContact('bob');
      await alice.send('bob', 'a request');
      await bob.poll();
      await bob.markRead('alice');
      await settle();
      await alice.poll();
      expect(alice.messages('bob').at(-1)!.status).toBe('sent');
      const n = net.deposits;
      await alice.send('alice', 'note');
      await alice.markRead('alice');
      await settle();
      expect(net.deposits).toBe(n);
    });

    it('with read receipts off: no read receipts sent; delivered still works', async () => {
      const { alice, bob } = await friends();
      await bob.setReadReceipts(false);
      expect(bob.readReceipts).toBe(false);
      await alice.send('bob', 'quiet');
      await bob.poll();
      await bob.markRead('alice');
      await settle();
      await alice.poll();
      expect(alice.messages('bob').at(-1)!.status).toBe('delivered');
    });

    it('works when the sender clock runs ahead (receipt uses the sender time)', async () => {
      const { alice, bob } = await friends();
      const realNow = Date.now;
      Date.now = () => realNow() + 3_600_000;
      await alice.send('bob', 'from the future');
      Date.now = realNow;
      await bob.poll();
      await bob.markRead('alice');
      await settle();
      await alice.poll();
      expect(alice.messages('bob').at(-1)!.status).toBe('read');
    });
  });

  it('remembers what was read across a reload', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const bobStore = new MemoryStore();
    const { m: bob } = await user(net, 'bob', bobStore);
    await alice.addContact('bob');
    await alice.send('bob', 'one');
    await alice.send('bob', 'two');
    await bob.poll();
    expect(bob.unreadCount('alice')).toBe(2);
    await bob.markRead('alice');
    expect(bob.unreadCount('alice')).toBe(0);

    // Reload: same device store.
    const { m: bob2 } = await user(net, 'bob', bobStore);
    expect(bob2.unreadCount('alice')).toBe(0);
    await alice.send('bob', 'three');
    await bob2.poll();
    expect(bob2.unreadCount('alice')).toBe(1);
  });

  it('rejects forged, tampered and replayed entries', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    const { m: eve } = await user(net, 'eve');
    await alice.addContact('bob');
    await alice.send('bob', 'genuine');
    const box = net.boxes.get(`bob:${bob.deviceId}`)!;
    const genuine = box[0]!;

    // Eve re-deposits Alice's entry under her own account: sender mismatch.
    await net.as('eve').deposit({ account: 'bob', deviceId: bob.deviceId }, genuine.entry);
    // Tampered body field.
    const t = decodeEntry(genuine.entry);
    await net.as('alice').deposit(
      { account: 'bob', deviceId: bob.deviceId },
      encodeEntry({ ...t, sentAt: t.sentAt + 1 }),
    );
    // Exact replay from Alice.
    await net.as('alice').deposit({ account: 'bob', deviceId: bob.deviceId }, genuine.entry);
    void eve;

    expect(await bob.poll()).toBe(1);
    expect(bob.messages('alice').map((x) => x.body)).toEqual(['genuine']);
    expect(bob.contacts().map((c) => c.account)).toEqual(['alice']);
  });
});

describe('Profiles, requests and blocking', () => {
  /** Saves a sealed profile to the fake profiles canister and shares the key. */
  const publish = async (net: FakeNetwork, m: RealMessaging, account: string, name: string, version: number, key = 'k'.repeat(43) + '=') => {
    const p = { displayName: name, username: name.toLowerCase().replace(/\W/g, ''), bio: `About ${name}`, location: '', birthDate: '', avatar: '', cover: '', links: [], status: 'available' as const, updatedAt: version };
    // A real 32-byte key per account (base64), stable across versions.
    const k = net.keys.get(account) ?? key.replace(/k/g, account.length % 2 ? 'A' : 'B');
    net.keys.set(account, k);
    net.sealed.set(account, await sealProfile(p, k));
    await m.setMyProfileKey({ key: k, version });
  };

  it("a device added later asks friends for their profile key, and gets it there only", async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await publish(net, alice, 'alice', 'Alice', 1);
    await bob.addContact('alice');
    await alice.addContact('bob');
    await alice.send('bob', 'hi'); // Alice's key goes with it, to Bob's only device
    await bob.poll();
    await vi.waitFor(() => expect(bob.contact('alice')?.profile?.displayName).toBe('Alice'));

    // Bob opens OpenSocial on a new device (or at a new address): no key for Alice there.
    const { m: bob2 } = await user(net, 'bob', new MemoryStore());
    await bob2.addContact('alice');
    expect(bob2.contact('alice')?.profileKey).toBeUndefined();
    await bob2.requestMissingProfileKeys();
    await alice.poll(); // Alice answers that device (in the background)
    await vi.waitFor(async () => {
      await bob2.poll();
      expect(bob2.contact('alice')?.profile?.displayName).toBe('Alice');
    });

    // Asked at most every half hour: no second request right away.
    const before = net.batches;
    await bob2.requestMissingProfileKeys(Date.now() + 10 * 60_000);
    expect(net.batches).toBe(before);
  });

  it('a profile key request that arrives before our key is loaded is answered once it is', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await bob.addContact('alice');
    await alice.addContact('bob');
    await alice.send('bob', 'hi');
    await bob.poll();
    await bob.accept('alice');
    // Bob asks while Alice's app hasn't loaded her key yet (none was ever set here).
    await bob.requestMissingProfileKeys();
    await alice.poll();
    const waiting = (alice as unknown as { keyRequests: Map<string, unknown> }).keyRequests;
    expect(waiting.size).toBe(1);
    await publish(net, alice, 'alice', 'Alice', 1);
    expect(waiting.size).toBe(0);
    await vi.waitFor(async () => {
      await bob.poll();
      expect(bob.contact('alice')?.profile?.displayName).toBe('Alice');
    });
  });

  it('shares the profile key with friends only after they are accepted, and updates them', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await publish(net, alice, 'alice', 'Alice', 1);
    await publish(net, bob, 'bob', 'Bob', 1);

    await alice.addContact('bob'); // Alice -> Bob: profile key, then message
    await alice.send('bob', 'hi');
    await bob.poll();
    await vi.waitFor(() => expect(bob.contact('alice')?.profile?.bio).toBe('About Alice'));
    expect(bob.contact('alice')).toMatchObject({ known: false, name: 'Alice' });
    expect(bob.messages('alice').map((m) => m.body)).toEqual(['hi']); // the key is not a message

    // Bob has not accepted yet: Alice has not received his key.
    await alice.poll();
    expect(alice.contact('bob')?.profileKey).toBeUndefined();

    await bob.accept('alice');
    await alice.poll();
    await vi.waitFor(() => expect(alice.contact('bob')).toMatchObject({ name: 'Bob', profile: { displayName: 'Bob' } }));

    // A profile change reaches friends (new version -> they fetch it again).
    await publish(net, alice, 'alice', 'Alice Liddell', 2);
    await bob.poll();
    await vi.waitFor(() => expect(bob.contact('alice')?.name).toBe('Alice Liddell'));

    // Nicknames win over profile names.
    await bob.setNickname('alice', 'Ali');
    expect(bob.contact('alice')?.name).toBe('Ali');
  });

  it('accepting and replying at the same moment delivers both, in order', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await publish(net, alice, 'alice', 'Alice', 1);
    await publish(net, bob, 'bob', 'Bob', 1);
    await alice.addContact('bob');
    await alice.send('bob', 'hello');
    await bob.poll();
    // The user taps Accept and sends a reply right away: two sends race.
    await Promise.all([bob.accept('alice'), bob.send('alice', 'Accepted!')]);
    const seqs = net.boxes.get(`alice:${alice.deviceId}`)!.map((i) => decodeEntry(i.entry).seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    await alice.poll();
    await vi.waitFor(() => expect(alice.contact('bob')?.profile?.displayName).toBe('Bob'));
    expect(alice.messages('bob').at(-1)?.body).toBe('Accepted!');
  });

  it('replying to a request accepts it', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await publish(net, bob, 'bob', 'Bob', 1);
    await alice.addContact('bob');
    await alice.send('bob', 'hello');
    await bob.poll();
    await bob.send('alice', 'hey');
    expect(bob.contact('alice')?.known).toBe(true);
    await alice.poll();
    await vi.waitFor(() => expect(alice.contact('bob')?.name).toBe('Bob'));
  });

  it('drops messages from blocked accounts and hides them', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: eve } = await user(net, 'eve');
    await eve.addContact('alice');
    await eve.send('alice', 'spam 1');
    await alice.poll();
    await alice.block('eve');
    expect(alice.contacts()).toEqual([]);
    await eve.send('alice', 'spam 2');
    expect(await alice.poll()).toBe(0);
    expect(alice.messages('eve').map((m) => m.body)).toEqual(['spam 1']);
  });

  it('a deleted account disappears from friends: profile and key removed', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await publish(net, alice, 'alice', 'Alice', 1);
    await alice.addContact('bob');
    await alice.send('bob', 'hi');
    await bob.poll();
    await bob.accept('alice');
    await alice.poll();
    await vi.waitFor(() => expect(bob.contact('alice')?.profile?.displayName).toBe('Alice'));
    await alice.notifyAccountDeleted();
    await bob.poll();
    expect(bob.contact('alice')).toMatchObject({ deleted: true, name: 'Deleted account' });
    expect(bob.contact('alice')?.profile).toBeUndefined();
    expect(bob.contact('alice')?.profileKey).toBeUndefined();
  });

  it('a sealed profile can only be opened with the right key, and fields are limited', async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
    const blob = await sealProfile(
      { displayName: 'A'.repeat(100), username: 'a', bio: '', location: 'L'.repeat(50), birthDate: '2999-01-01', avatar: 'javascript:alert(1)', cover: 'data:text/html;base64,PHNjcmlwdD4=', links: [{ label: 'x', url: 'javascript:alert(1)' }, { label: 'Site', url: 'https://example.com' }], status: 'available', updatedAt: 1 },
      key,
    );
    const opened = await openProfile(blob, key);
    expect(opened.displayName.length).toBe(40);
    expect(opened.avatar).toBe('');
    expect(opened.cover).toBe(''); // only image data URLs
    expect(opened.location).toHaveLength(30);
    expect(opened.birthDate).toBe(''); // not a past date
    expect(opened.links).toEqual([{ label: 'Site', url: 'https://example.com' }]); // unsafe link dropped
    const wrong = btoa(String.fromCharCode(...new Uint8Array(32).fill(6)));
    await expect(openProfile(blob, wrong)).rejects.toThrow();
  });
});

describe('Batched delivery', () => {
  it('a full mailbox on one device does not stop the other devices from receiving', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bobOld } = await user(net, 'bob'); // an abandoned device
    const { m: bobNew } = await user(net, 'bob', new MemoryStore());
    await alice.addContact('bob');
    net.boxLimit = 5;
    for (let i = 0; i < 8; i++) {
      await alice.send('bob', `m${i}`); // the old device fills up; the active one keeps reading
      await bobNew.poll();
    }
    expect(net.boxes.get(`bob:${bobOld.deviceId}`)!.length).toBeLessThanOrEqual(5);
    expect(bobNew.messages('alice').map((m) => m.body)).toContain('m7');
    expect(bobNew.messages('alice').some((m) => m.gap)).toBe(false);
    // Once the old device catches up, it gets new messages again, in order.
    await bobOld.poll();
    await alice.send('bob', 'after');
    await bobOld.poll();
    expect(bobOld.messages('alice').at(-1)?.body).toBe('after');
  });

  it('a device with an invalid key package (an outdated app) does not stop the friend\'s other devices', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bobOld } = await user(net, 'bob');
    const { m: bobNew } = await user(net, 'bob', new MemoryStore());
    // The old device's key packages are unusable.
    net.prekeys.set(`bob:${bobOld.deviceId}`, { bundle: new Uint8Array([1, 2, 3]), oneTime: [] });
    await alice.addContact('bob');
    await alice.send('bob', 'still arrives');
    expect(alice.messages('bob').at(-1)?.status).not.toBe('failed');
    await bobNew.poll();
    expect(bobNew.messages('alice').map((m) => m.body)).toEqual(['still arrives']);
  });

  it('does not ask for an unreachable device\'s key package again on every message', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bobOld } = await user(net, 'bob');
    const { m: bobNew } = await user(net, 'bob', new MemoryStore());
    net.prekeys.set(`bob:${bobOld.deviceId}`, { bundle: new Uint8Array([1, 2, 3]), oneTime: [] });
    let claims = 0;
    const api = net.as('alice');
    const claim = api.claimKeyPackage;
    (alice as unknown as { directory: typeof api }).directory = {
      ...api,
      claimKeyPackage: async (a: string, d: string) => {
        claims++;
        return claim(a, d);
      },
    };
    await alice.addContact('bob');
    for (let i = 0; i < 4; i++) await alice.send('bob', `m${i}`);
    expect(claims).toBe(2); // once per device: the new one's channel, the old one found unusable
    await bobNew.poll();
    expect(bobNew.messages('alice').map((m) => m.body)).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('says plainly when no device of the friend can be reached with valid keys', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    net.prekeys.set(`bob:${bob.deviceId}`, { bundle: new Uint8Array([1, 2, 3]), oneTime: [] });
    await alice.addContact('bob');
    await expect(alice.send('bob', 'hi')).rejects.toMatchObject({ code: 'CONTACT_OUTDATED' });
  });

  it('says so when every device of the friend is full', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    await user(net, 'bob');
    await alice.addContact('bob');
    net.boxLimit = 3;
    await alice.send('bob', 'a');
    await alice.send('bob', 'b');
    await expect(async () => {
      for (let i = 0; i < 5; i++) await alice.send('bob', `x${i}`);
    }).rejects.toMatchObject({ code: 'MAILBOX_FULL' });
  });


  it('sends Welcome and message in one mailbox call, to every device', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob1 } = await user(net, 'bob');
    const { m: bob2 } = await user(net, 'bob', new MemoryStore()); // Bob's second device
    await alice.addContact('bob');
    const before = net.batches;
    await alice.send('bob', 'to all my devices');
    expect(net.batches - before).toBe(1);
    expect(await bob1.poll()).toBe(1);
    expect(await bob2.poll()).toBe(1);
  });

  it('a failed send does not advance the chain, so a retry is not seen as a gap', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.send('bob', 'first');
    net.failBatches = 3;
    await expect(alice.send('bob', 'lost')).rejects.toThrow('network down');
    await alice.send('bob', 'second');
    await bob.poll();
    const got = bob.messages('alice');
    expect(got.map((m) => m.body)).toEqual(['first', 'second']);
    expect(got.some((m) => m.gap)).toBe(false);
  });
});

describe('MLS (OpenMLS) in the message flow', () => {
  it('sends a Welcome first, then MLS messages; key packages are used once', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    const before = net.prekeys.get(`bob:${bob.deviceId}`)!.oneTime.length;
    await alice.addContact('bob');
    await alice.send('bob', 'one');
    await alice.send('bob', 'two');
    const kinds = net.boxes
      .get(`bob:${bob.deviceId}`)!
      .map((i) => decodeEntry(i.entry))
      .map((e) => [e.v, Buffer.from(e.envelope, 'base64')[0]]);
    expect(kinds).toEqual([
      [3, 1], // Welcome
      [3, 2], // MLS application message
      [3, 2],
    ]);
    expect(net.prekeys.get(`bob:${bob.deviceId}`)!.oneTime.length).toBe(before - 1);
    // The mailbox never sees plaintext.
    for (const i of net.boxes.get(`bob:${bob.deviceId}`)!) {
      expect(new TextDecoder().decode(i.entry)).not.toMatch(/"one"|"two"/);
    }
    await bob.poll();
    await bob.send('alice', 'three');
    await alice.poll();
    expect(alice.messages('bob').at(-1)?.body).toBe('three');
    expect(alice.myFingerprint).toMatch(/^\d{5}( \d{5}){11}$/);
    expect(await alice.contactFingerprint('bob')).toBe(bob.myFingerprint);
  });

  it('keeps working across self-update commits (every 50 messages)', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    for (let i = 0; i < 55; i++) await alice.send('bob', `m${i}`);
    expect(await bob.poll()).toBe(55);
    expect(bob.messages('alice').map((m) => m.body).slice(-2)).toEqual(['m53', 'm54']);
  });

  it('refuses to send to a device that has no key packages', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    net.prekeys.clear();
    await alice.addContact('bob');
    await expect(alice.send('bob', 'hi')).rejects.toMatchObject({ code: 'CONTACT_OUTDATED' });
    void bob;
  });
});

describe('Attachments', () => {
  const bytesOf = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251);

  it('sends a small file in encrypted chunks and reassembles it', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    const data = bytesOf(100_000);
    await alice.sendFile('bob', bytesSource('photo.jpg', 'image/jpeg', data));
    expect(alice.messages('bob').at(-1)?.attachment).toMatchObject({ state: 'ready', via: 'inline', total: 4 });
    await bob.poll();
    const got = bob.messages('alice').at(-1)!;
    expect(got.attachment).toMatchObject({ name: 'photo.jpg', mime: 'image/jpeg', size: 100_000, state: 'ready' });
    expect(Buffer.from((await bob.fileBytes(got.attachment!.fileId))!).equals(Buffer.from(data))).toBe(true);
    // The mailbox never held the plaintext.
    expect(bob.messages('alice').filter((m) => m.attachment)).toHaveLength(1);
  });

  it('splits a 2 MB file into several canister-sized batches', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    const before = net.batches;
    const data = bytesOf(2 * 1024 * 1024 - 10, 3);
    await alice.sendFile('bob', bytesSource('clip.mp4', 'video/mp4', data));
    expect(net.batches - before).toBeGreaterThan(1);
    for (let i = 0; i < 5; i++) await bob.poll();
    const a = bob.messages('alice').at(-1)!.attachment!;
    expect(a.state).toBe('ready');
    expect(Buffer.from((await bob.fileBytes(a.fileId))!).equals(Buffer.from(data))).toBe(true);
    // Text after the file still arrives in order.
    await alice.send('bob', 'did you get it?');
    await bob.poll();
    expect(bob.messages('alice').at(-1)?.body).toBe('did you get it?');
  });

  it('sends large files through Sia as an encrypted stream, opened as a stream', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    const data = bytesOf(11 * 1024 * 1024 + 123, 11); // three 4 MiB chunks
    const fakeSia = new Map<string, Uint8Array>();
    let fractions: number[] = [];
    await alice.sendFile('bob', bytesSource('big.mov', 'video/quicktime', data), async (stream, size, p) => {
      const ct = await readAll(stream());
      expect(ct.length).toBe(size);
      p(0.5);
      p(1);
      fractions = [0.5, 1];
      fakeSia.set('obj1', ct);
      return { seed: 'seed1', objectId: 'obj1' };
    });
    expect(fractions).toEqual([0.5, 1]);
    const sent = alice.messages('bob').at(-1)!;
    expect(sent.attachment).toMatchObject({ via: 'sia', state: 'remote' });
    expect(await alice.fileBytes(sent.attachment!.fileId)).toBeNull(); // no local copy of large files
    const stored = fakeSia.get('obj1')!;
    expect(Buffer.from(stored).includes(Buffer.from(data.subarray(0, 64)))).toBe(false); // ciphertext only

    await bob.poll();
    const m = bob.messages('alice').at(-1)!;
    expect(m.attachment).toMatchObject({ via: 'sia', state: 'remote', size: data.length });
    const opened = await bob.openFile('alice', m.attachment!.fileId, async (seed, id) => {
      expect(seed).toBe('seed1');
      return new Blob([fakeSia.get(id)!]).stream();
    });
    expect(Buffer.from(await readAll(opened.stream)).equals(Buffer.from(data))).toBe(true);

    // Tampered storage is detected while streaming.
    const bad = stored.slice();
    bad[5_000_000] = bad[5_000_000]! ^ 1;
    const tampered = await bob.openFile('alice', m.attachment!.fileId, async () => new Blob([bad]).stream());
    await expect(readAll(tampered.stream)).rejects.toThrow(/integrity/);
  });

  it('refuses files over 2 GB before reading them', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    let reads = 0;
    const huge = {
      name: 'huge.iso',
      mime: 'application/octet-stream',
      size: 2 * 1024 * 1024 * 1024 + 1,
      read: async () => {
        reads++;
        return new Uint8Array(0);
      },
    };
    await expect(alice.sendFile('bob', huge, async () => ({ seed: 's', objectId: 'o' }))).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    expect(reads).toBe(0);
  });

  it('a failed large upload can be retried in the same session', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    let fail = true;
    const sia = async (stream: () => ReadableStream<Uint8Array>) => {
      await readAll(stream());
      if (fail) throw new Error('network down');
      return { seed: 's', objectId: 'o' };
    };
    await expect(alice.sendFile('bob', bytesSource('v.mp4', 'video/mp4', bytesOf(11 * 1024 * 1024)), sia)).rejects.toThrow(
      'network down',
    );
    const m = alice.messages('bob').at(-1)!;
    expect(m.attachment!.state).toBe('failed');
    expect(alice.canRetry(m.attachment!.fileId)).toBe(true);
    fail = false;
    await alice.retryFile('bob', m.attachment!.fileId);
    expect(m.attachment!.state).toBe('remote');
    expect(alice.canRetry(m.attachment!.fileId)).toBe(false);
    await bob.poll();
    expect(bob.messages('alice').at(-1)!.attachment).toMatchObject({ via: 'sia', name: 'v.mp4' });
  });

  it('rejects malformed file payloads', async () => {
    const net = new FakeNetwork();
    const { m: alice } = await user(net, 'alice');
    const { m: bob } = await user(net, 'bob');
    await alice.addContact('bob');
    await alice.sendFile('bob', bytesSource('x'.repeat(500), 'text/plain', bytesOf(10)));
    await bob.poll();
    expect(bob.messages('alice').at(-1)!.attachment!.name.length).toBe(200);
  });
});
