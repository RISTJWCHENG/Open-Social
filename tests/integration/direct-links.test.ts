import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeEntry } from '../../src/core/delivery/logEntry';
import { bytesSource, readAll } from '../../src/core/files/chunkedFile';
import { readFileSync } from 'node:fs';
import { setMlsWasm } from '../../src/core/mls/mls';
import { RealMessaging } from '../../src/core/delivery/realMessaging';
import { MemoryStore } from '../../src/core/delivery/localStore';
import type { DataChannelLike, RtcLike } from '../../src/core/direct/directLinks';
import type {
  DeliveredItem,
  DeviceAddress,
  DeviceDirectory,
  OfflineDelivery,
  PublishedDevice,
} from '../../src/core/delivery/offlineDelivery';

beforeAll(() => setMlsWasm(readFileSync('src/vendor/open-social-mls/open_social_mls_bg.wasm')));

const tick = () => new Promise((r) => setTimeout(r, 0));

/** In-memory WebRTC: SDP strings are ids; data channels deliver asynchronously. */
class FakeRtcHub {
  peers = new Map<string, FakePeer>();
  n = 0;
  failConnect = false;
  /** Drop data silently (link looks open but nothing arrives). */
  blackhole = false;
}

class FakeChannel implements DataChannelLike {
  readyState = 'connecting';
  binaryType = 'blob';
  other: FakeChannel | null = null;
  hub: FakeRtcHub | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer | Uint8Array }) => void) | null = null;
  send(data: string | Uint8Array) {
    if (this.readyState !== 'open') throw new Error('not open');
    if (this.hub?.blackhole) return;
    const o = this.other!;
    const copy = typeof data === 'string' ? data : data.slice().buffer;
    setTimeout(() => o.readyState === 'open' && o.onmessage?.({ data: copy }), 0);
  }
  close() {
    for (const c of [this, this.other]) {
      if (c && c.readyState !== 'closed') {
        c.readyState = 'closed';
        setTimeout(() => c.onclose?.(), 0);
      }
    }
  }
}

class FakePeer implements RtcLike {
  id: string;
  localDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState = 'complete';
  connectionState = 'new';
  onicegatheringstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: DataChannelLike }) => void) | null = null;
  channel: FakeChannel | null = null;
  constructor(private hub: FakeRtcHub) {
    this.id = `peer${++hub.n}`;
    hub.peers.set(this.id, this);
  }
  createDataChannel() {
    this.channel = new FakeChannel();
    this.channel.hub = this.hub;
    return this.channel;
  }
  async createOffer() {
    return { type: 'offer' as const, sdp: this.id };
  }
  async createAnswer() {
    return { type: 'answer' as const, sdp: this.id };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    if (d.type !== 'answer') return;
    const answerer = this.hub.peers.get(d.sdp!)!;
    if (this.hub.failConnect) {
      this.connectionState = 'failed';
      setTimeout(() => this.onconnectionstatechange?.(), 0);
      return;
    }
    const remote = new FakeChannel();
    remote.hub = this.hub;
    remote.other = this.channel!;
    this.channel!.other = remote;
    this.connectionState = answerer.connectionState = 'connected';
    answerer.channel = remote; // closing either peer closes the channel, like real WebRTC
    setTimeout(() => {
      answerer.ondatachannel?.({ channel: remote });
      for (const c of [this.channel!, remote]) {
        c.readyState = 'open';
        c.onopen?.();
      }
    }, 0);
  }
  close() {
    this.channel?.close();
    this.connectionState = 'closed';
  }
}

class FakeNetwork {
  devices = new Map<string, PublishedDevice[]>();
  prekeys = new Map<string, { bundle: Uint8Array; oneTime: Uint8Array[] }>();
  boxes = new Map<string, DeliveredItem[]>();
  nextId = 1n;
  deposits = 0;
  /** (to account, ephemeral, envelope kind byte) of every batched deposit. */
  log: { to: string; ephemeral: boolean; kind: number }[] = [];
  as(account: string): DeviceDirectory & OfflineDelivery {
    const deposit = async (to: DeviceAddress, entry: Uint8Array) => {
      this.deposits++;
      const k = `${to.account}:${to.deviceId}`;
      this.boxes.set(k, [...(this.boxes.get(k) ?? []), { id: this.nextId++, from: account, receivedAtMs: 0, entry }]);
    };
    return {
      register: async (d) => {
        const l = this.devices.get(account) ?? [];
        if (!l.some((x) => x.deviceId === d.deviceId)) l.push(d);
        this.devices.set(account, l);
      },
      devicesOf: async (a) => this.devices.get(a) ?? [],
      publishKeyPackages: async (deviceId, lastResort, singleUse) => {
        const k = `${account}:${deviceId}`;
        const e = this.prekeys.get(k);
        if (!e && !lastResort) throw new Error('Publish a last-resort key package first');
        const next = lastResort ? { bundle: lastResort, oneTime: [] as Uint8Array[] } : e!;
        next.oneTime.push(...singleUse);
        this.prekeys.set(k, next);
        return next.oneTime.length;
      },
      claimKeyPackage: async (a, d) => {
        const e = this.prekeys.get(`${a}:${d}`);
        return e ? { lastResort: e.bundle, singleUse: e.oneTime.shift() ?? null } : null;
      },
      deposit,
      depositMany: async (items) => {
        for (const i of items) {
          const e = decodeEntry(i.entry);
          this.log.push({ to: i.to.account, ephemeral: !!i.ephemeral, kind: Buffer.from(e.envelope, 'base64')[0]! });
          await deposit(i.to, i.entry);
        }
      },
      fetch: async (d, after) => (this.boxes.get(`${account}:${d}`) ?? []).filter((m) => m.id > after),
      ack: async (d, upTo) => {
        const k = `${account}:${d}`;
        this.boxes.set(k, (this.boxes.get(k) ?? []).filter((m) => m.id > upTo));
      },
    };
  }
}

async function pair(enabled = { a: true, b: true }) {
  const net = new FakeNetwork();
  const hub = new FakeRtcHub();
  const mk = async (name: string, on: () => boolean) => {
    const api = net.as(name);
    const m = new RealMessaging(name, api, api, new MemoryStore(), 'Test', {
      newPeer: () => new FakePeer(hub),
      enabled: on,
      ackTimeoutMs: 400,
      // Calls: signalling is what's tested here (media needs a browser).
      calls: {
        newPeer: () => {
          throw new Error('no media in tests');
        },
        getMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) as unknown as MediaStream,
      },
    });
    await m.init();
    return m;
  };
  const alice = await mk('alice', () => enabled.a);
  const bob = await mk('bob', () => enabled.b);
  // Friends both ways.
  await alice.addContact('bob');
  await alice.send('bob', 'hi bob');
  await bob.poll();
  await bob.accept('alice');
  await alice.poll();
  return { net, hub, alice, bob };
}

/** Lets mailbox signaling and fake channels run to completion. */
async function settle(a: RealMessaging, b: RealMessaging) {
  for (let i = 0; i < 6; i++) {
    await a.poll();
    await b.poll();
    for (let j = 0; j < 5; j++) await tick();
  }
}

describe('Direct links (WebRTC) with mailbox fallback', () => {
  it('opens a link through mailbox signaling and then delivers without the mailbox', async () => {
    const { net, alice, bob } = await pair();
    await alice.warm('bob', 'resume');
    await settle(alice, bob);
    expect(alice.isDirect('bob')).toBe(true);
    expect(bob.isDirect('alice')).toBe(true);

    const before = net.deposits;
    await alice.send('bob', 'over the link');
    for (let j = 0; j < 5; j++) await tick();
    expect(net.deposits).toBe(before); // nothing went to the mailbox
    expect(bob.messages('alice').at(-1)?.body).toBe('over the link'); // no poll needed
    await bob.send('alice', 'and back');
    for (let j = 0; j < 5; j++) await tick();
    expect(alice.messages('bob').at(-1)?.body).toBe('and back');
    expect(net.deposits).toBe(before);
  });

  it('keeps order: after a mailbox send, the link is used only once the peer caught up', async () => {
    const { net, alice, bob } = await pair();
    await alice.warm('bob');
    await settle(alice, bob);
    // Simulate a send that had to use the mailbox (e.g. while reconnecting).
    alice.closeDirect();
    for (let j = 0; j < 5; j++) await tick();
    await alice.send('bob', 'via mailbox');
    const deposits = net.deposits;
    await alice.warm('bob', 'resume'); // Alice comes back and offers
    for (let j = 0; j < 5; j++) await tick();
    await settle(alice, bob); // Bob polls the mailbox entry, then the link reopens
    await alice.send('bob', 'via link');
    for (let j = 0; j < 5; j++) await tick();
    const bodies = bob.messages('alice').map((m) => m.body);
    expect(bodies.slice(-2)).toEqual(['via mailbox', 'via link']);
    expect(bob.messages('alice').some((m) => m.gap)).toBe(false);
    expect(net.deposits).toBeGreaterThanOrEqual(deposits);
  });

  it('re-sends unacknowledged entries through the mailbox when a link drops', async () => {
    const { hub, alice, bob } = await pair();
    await alice.warm('bob', 'resume');
    await settle(alice, bob);
    expect(alice.isDirect('bob')).toBe(true);
    hub.blackhole = true;
    await alice.send('bob', 'lost on the wire');
    for (let j = 0; j < 5; j++) await tick();
    expect(bob.messages('alice').at(-1)?.body).not.toBe('lost on the wire');
    alice.closeDirect(); // the link drops
    hub.blackhole = false;
    for (let j = 0; j < 10; j++) await tick();
    await bob.poll();
    expect(bob.messages('alice').at(-1)?.body).toBe('lost on the wire');
    expect(bob.messages('alice').filter((m) => m.body === 'lost on the wire')).toHaveLength(1);
  });

  it('a stalled link (the friend\'s page frozen, the link still looking open) hands over to the mailbox within moments', async () => {
    const { hub, alice, bob } = await pair();
    await alice.warm('bob', 'resume');
    await settle(alice, bob);
    expect(alice.isDirect('bob')).toBe(true);
    hub.blackhole = true; // nothing arrives, nothing is acknowledged, nothing closes
    await alice.send('bob', 'do not wait for the link');
    await new Promise((r) => setTimeout(r, 700)); // past the acknowledgement timeout
    for (let j = 0; j < 10; j++) await tick();
    expect(alice.isDirect('bob')).toBe(false);
    hub.blackhole = false;
    await bob.poll();
    expect(bob.messages('alice').at(-1)?.body).toBe('do not wait for the link');
  });

  it('falls back to the mailbox when the link cannot be established', async () => {
    const { hub, alice, bob } = await pair();
    hub.failConnect = true;
    await alice.warm('bob', 'resume');
    await settle(alice, bob);
    expect(alice.isDirect('bob')).toBe(false);
    await alice.send('bob', 'still arrives');
    await bob.poll();
    expect(bob.messages('alice').at(-1)?.body).toBe('still arrives');
  });

  it('does nothing when direct connections are turned off', async () => {
    const { net, alice, bob } = await pair({ a: false, b: true });
    await alice.warm('bob', 'resume');
    await settle(alice, bob);
    expect(alice.isDirect('bob')).toBe(false);
    const before = net.deposits;
    await alice.send('bob', 'mailbox only');
    expect(net.deposits).toBe(before + 1);
  });

  it('never opens links with strangers (requests not accepted)', async () => {
    const net = new FakeNetwork();
    const hub = new FakeRtcHub();
    const mk = async (name: string) => {
      const api = net.as(name);
      const m = new RealMessaging(name, api, api, new MemoryStore(), 'Test', {
        newPeer: () => new FakePeer(hub),
        enabled: () => true,
      });
      await m.init();
      return m;
    };
    const eve = await mk('eve');
    const bob = await mk('bob');
    await eve.addContact('bob');
    await eve.send('bob', 'hello stranger');
    await eve.warm('bob', 'resume');
    await settle(eve, bob);
    expect(bob.isDirect('eve')).toBe(false);
    expect(hub.n).toBe(1); // Eve's own attempt only; Bob never answered
  });
});

describe('Bounded direct-link offers (cost and mailbox safety)', () => {
  afterEach(() => vi.useRealTimers());

  it('sends no offers to a friend who is offline or locked, however often the chat is opened', async () => {
    const { net, alice } = await pair(); // Bob stays offline (never polls)
    const bobDevice = net.devices.get('bob')![0]!.deviceId;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    await vi.advanceTimersByTimeAsync(5 * 60_000); // Bob has been quiet for a while
    const before = net.log.filter((l) => l.to === 'bob' && l.ephemeral).length;
    for (let i = 0; i < 60; i++) {
      await alice.warm('bob', 'chat'); // Alice opens Bob's chat every minute for an hour
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(net.log.filter((l) => l.to === 'bob' && l.ephemeral).length - before).toBe(0);
    expect(alice.offersLastHour('bob', bobDevice)).toBe(0);
  });

  it('a dropped link is not retried by the side that stayed; the side that comes back offers', async () => {
    const { net, alice, bob } = await pair();
    await alice.warm('bob', 'resume');
    await settle(alice, bob);
    expect(alice.isDirect('bob')).toBe(true);
    const bobDevice = net.devices.get('bob')![0]!.deviceId;
    const aliceDevice = net.devices.get('alice')![0]!.deviceId;
    const offersBefore = alice.offersLastHour('bob', bobDevice);
    bob.closeDirect(); // Bob's phone locks: the link drops
    for (let j = 0; j < 10; j++) await tick();
    expect(alice.isDirect('bob')).toBe(false);
    expect(alice.offersLastHour('bob', bobDevice)).toBe(offersBefore); // Alice sends nothing
    await bob.warmRecent('resume'); // Bob unlocks and comes back
    await settle(alice, bob);
    expect(bob.offersLastHour('alice', aliceDevice)).toBe(1);
    expect(alice.isDirect('bob')).toBe(true);
  });

  it('still caps offers at 6 per hour per device as a safety net', async () => {
    const { net, alice } = await pair();
    const bobDevice = net.devices.get('bob')![0]!.deviceId;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    for (let i = 0; i < 30; i++) {
      await alice.warm('bob', 'resume');
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(alice.offersLastHour('bob', bobDevice)).toBeLessThanOrEqual(6);
  });

  it('marks only the signaling message as short-lived, never a Welcome or a commit', async () => {
    const { net, alice, bob } = await pair();
    await alice.warm('bob', 'resume');
    await bob.warm('alice', 'resume');
    await settle(alice, bob);
    const signaling = net.log.filter((l) => l.ephemeral);
    expect(signaling.length).toBeGreaterThan(0);
    expect(signaling.every((l) => l.kind === 2)).toBe(true); // MLS message, not Welcome (1)
    expect(net.log.filter((l) => l.kind === 1).every((l) => !l.ephemeral)).toBe(true);
  });

  it('tries a link when a friend shows activity, without being asked', async () => {
    const { net, alice, bob } = await pair();
    const bobDevice = net.devices.get('bob')![0]!.deviceId;
    alice.closeDirect();
    bob.closeDirect();
    for (let j = 0; j < 5; j++) await tick();
    // Bob's earlier offers have expired (the canister drops them after 10 minutes).
    net.boxes.set(`alice:${net.devices.get('alice')![0]!.deviceId}`, []);
    expect(alice.offersLastHour('bob', bobDevice)).toBe(0);
    await bob.send('alice', 'I am online');
    for (let j = 0; j < 5; j++) await tick();
    // Alice offers a link herself, unless Bob's own offer (sent with his
    // message) reached her first and she is answering it: either way a link
    // is being made without anyone asking.
    await vi.waitFor(
      async () => {
        await alice.poll();
        expect(
          alice.offersLastHour('bob', bobDevice) >= 1 || alice.linkStatus('bob') !== 'none',
        ).toBe(true);
      },
      { timeout: 10_000, interval: 200 },
    );
  }, 20_000);
});

describe('Large files over direct links (no Sia)', () => {
  const bytesOf = (n: number, seed = 5) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + seed) % 251);
  const big = bytesOf(11 * 1024 * 1024 + 77); // 3 chunks of 4 MiB
  const until = async (ok: () => boolean, a: RealMessaging, b: RealMessaging) => {
    for (let i = 0; i < 400 && !ok(); i++) {
      if (i % 20 === 0) {
        await a.poll();
        await b.poll();
      }
      await tick();
    }
  };

  it('streams a large file to an online friend over the link, then confirms it', async () => {
    const { net, alice, bob } = await pair();
    await alice.warm('bob', 'resume');
    await settle(alice, bob);
    expect(alice.isDirect('bob')).toBe(true);
    const before = net.deposits;
    await alice.sendFile('bob', bytesSource('clip.mov', 'video/quicktime', big));
    const got = () => bob.messages('alice').find((m) => m.attachment?.name === 'clip.mov')?.attachment;
    await until(() => got()?.state === 'ready', alice, bob);
    expect(got()).toMatchObject({ state: 'ready', localChunks: 3, via: 'p2p' });
    const opened = await bob.openFile('alice', got()!.fileId, async () => {
      throw new Error('not from Sia');
    });
    expect(Buffer.from(await readAll(opened.stream)).equals(Buffer.from(big))).toBe(true);
    await until(() => !alice.isWaiting(got()!.fileId), alice, bob);
    expect(alice.isWaiting(got()!.fileId)).toBe(false);
    expect(alice.messages('bob').at(-1)!.attachment).toMatchObject({ state: 'ready', done: 100 });
    expect(net.deposits - before).toBeLessThan(5); // the file itself never went to the mailbox
  });

  it('waits while the friend is offline and delivers when they are back', async () => {
    const { alice, bob } = await pair();
    await alice.sendFile('bob', bytesSource('later.zip', 'application/zip', big)); // no link yet
    await bob.poll();
    const got = () => bob.messages('alice').find((m) => m.attachment?.name === 'later.zip')?.attachment;
    expect(got()).toMatchObject({ state: 'receiving', done: 0, via: 'p2p' });
    expect(alice.isWaiting(got()!.fileId)).toBe(true);
    await bob.warm('alice', 'resume'); // Bob comes online
    await until(() => got()?.state === 'ready', alice, bob);
    expect(got()!.state).toBe('ready');
    const opened = await bob.openFile('alice', got()!.fileId, async () => new ReadableStream());
    expect(Buffer.from(await readAll(opened.stream)).equals(Buffer.from(big))).toBe(true);
  });

  it('resumes from the first missing chunk after the link drops', async () => {
    const { alice, bob } = await pair();
    await alice.warm('bob', 'resume');
    await settle(alice, bob);
    await alice.sendFile('bob', bytesSource('resume.bin', 'application/octet-stream', big));
    const got = () => bob.messages('alice').find((m) => m.attachment?.name === 'resume.bin')?.attachment;
    await until(() => (got()?.p2p?.received ?? 0) >= 1, alice, bob);
    const doneBefore = got()!.p2p!.received;
    expect(doneBefore).toBeGreaterThanOrEqual(1);
    bob.closeDirect(); // the link drops mid-transfer
    for (let j = 0; j < 10; j++) await tick();
    if (got()!.state !== 'ready') {
      await bob.warm('alice', 'resume');
      await until(() => got()?.state === 'ready', alice, bob);
    }
    expect(got()!.state).toBe('ready');
    const opened = await bob.openFile('alice', got()!.fileId, async () => new ReadableStream());
    expect(Buffer.from(await readAll(opened.stream)).equals(Buffer.from(big))).toBe(true);
  });

  it('a waiting file can be sent through Sia instead; the friend opens it from there', async () => {
    const { alice, bob } = await pair();
    await alice.sendFile('bob', bytesSource('via-sia.mov', 'video/quicktime', big));
    await bob.poll();
    const sent = alice.messages('bob').at(-1)!.attachment!;
    const store = new Map<string, Uint8Array>();
    await alice.sendViaSia('bob', sent.fileId, async (stream) => {
      store.set('o', await readAll(stream()));
      return { seed: 's', objectId: 'o' };
    });
    expect(alice.isWaiting(sent.fileId)).toBe(false);
    await bob.poll();
    const got = bob.messages('alice').find((m) => m.attachment?.name === 'via-sia.mov')!.attachment!;
    expect(got).toMatchObject({ via: 'sia', state: 'remote' });
    const opened = await bob.openFile('alice', got.fileId, async () => new Blob([store.get('o')!]).stream());
    expect(Buffer.from(await readAll(opened.stream)).equals(Buffer.from(big))).toBe(true);
  });
});

describe('Waiting large files: link status', () => {
  const big = new Uint8Array(11 * 1024 * 1024).fill(3);
  afterEach(() => vi.useRealTimers());

  it('the sender offers a link itself right after sending a large file', async () => {
    const { net, alice } = await pair();
    const bobDevice = net.devices.get('bob')![0]!.deviceId;
    alice.closeDirect();
    expect(alice.offersLastHour('bob', bobDevice)).toBe(0);
    await alice.sendFile('bob', bytesSource('x.bin', 'application/octet-stream', big));
    await vi.waitFor(() => expect(alice.offersLastHour('bob', bobDevice)).toBe(1));
  });

  it('typing to a friend active in the last 10 minutes opens a link; not for long-inactive friends', async () => {
    const { net, alice, bob } = await pair();
    const bobDevice = net.devices.get('bob')![0]!.deviceId;
    alice.closeDirect();
    await bob.send('alice', 'hey'); // Bob is active
    await alice.poll();
    alice.closeDirect();
    await alice.warm('bob', 'typing');
    await vi.waitFor(() => expect(alice.offersLastHour('bob', bobDevice)).toBeGreaterThanOrEqual(1));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    alice.closeDirect();
    await alice.warm('bob', 'typing');
    expect(alice.offersLastHour('bob', bobDevice)).toBe(0);
  });

  it('reports "failed" after repeated attempts never connect (no direct path)', async () => {
    const { hub, alice, bob } = await pair();
    hub.failConnect = true;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    for (let i = 0; i < 2; i++) {
      await alice.warm('bob', 'resume');
      for (let j = 0; j < 3; j++) {
        await alice.poll();
        await bob.poll();
        await vi.advanceTimersByTimeAsync(100);
      }
      await vi.advanceTimersByTimeAsync(25_000); // setup timeout and offer gap
    }
    expect(alice.linkStatus('bob')).toBe('failed');
  });
});

describe('Call signalling through encrypted messages', () => {
  it('an invite reaches the friend (ringing), a decline comes back, and both chats log it', async () => {
    const { alice, bob } = await pair({ a: false, b: false }); // mailbox path
    await alice.calls!.start('bob', 'video');
    await bob.poll();
    expect(bob.calls!.current).toMatchObject({ direction: 'in', phase: 'ringing', kind: 'video', account: 'alice' });
    bob.calls!.hangUp(); // decline
    await vi.waitFor(async () => {
      await alice.poll();
      expect(alice.calls!.current).toBeNull();
    });
    expect(alice.messages('bob').at(-1)!.call).toMatchObject({ kind: 'video', outcome: 'declined' });
    expect(bob.messages('alice').at(-1)!.call).toMatchObject({ kind: 'video', outcome: 'declined' });
    // Call setup messages are not chat messages.
    expect(bob.messages('alice').filter((m) => !m.call).map((m) => m.body)).toEqual(['hi bob']);
  });

  it('a stranger cannot ring you', async () => {
    const { alice, bob } = await pair({ a: false, b: false });
    await bob.removeContact('alice'); // no longer a friend
    await expect(alice.calls!.start('bob', 'voice')).resolves.toBeUndefined();
    await bob.poll();
    expect(bob.calls!.current).toBeNull();
  });
});
