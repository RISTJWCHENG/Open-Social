import { afterEach, describe, expect, it, vi } from 'vitest';
import { Calls, RING_MS, parseCallSignal, type CallKind, type CallLog, type CallPeer, type CallSignal } from '../../src/core/calls/calls';

/** Minimal stand-ins for media streams and tracks. */
class FakeTrack {
  enabled = true;
  stopped = false;
  constructor(readonly kind: 'audio' | 'video') {}
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

/** Two fake peers connect once each has the other's description. */
class FakePeer implements CallPeer {
  connectionState = 'new';
  iceGatheringState = 'complete';
  localDescription: { sdp: string } | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: CallPeer['ontrack'] = null;
  tracks: FakeTrack[] = [];
  remoteSdp = '';
  closed = false;
  constructor(readonly name: string, private registry: Map<string, FakePeer>) {
    registry.set(name, this);
  }
  addTrack(t: MediaStreamTrack) {
    this.tracks.push(t as unknown as FakeTrack);
  }
  async createOffer() {
    return { type: 'offer', sdp: `sdp:${this.name}` };
  }
  async createAnswer() {
    return { type: 'answer', sdp: `sdp:${this.name}` };
  }
  async setLocalDescription(d: { sdp?: string }) {
    this.localDescription = { sdp: d.sdp! };
    this.maybeConnect();
  }
  async setRemoteDescription(d: { sdp: string }) {
    this.remoteSdp = d.sdp;
    this.maybeConnect();
  }
  private maybeConnect() {
    if (!this.localDescription || !this.remoteSdp) return;
    const other = this.registry.get(this.remoteSdp.slice(4));
    if (!other || other.remoteSdp !== `sdp:${this.name}`) return;
    for (const [a, b] of [
      [this, other],
      [other, this],
    ] as const) {
      a.connectionState = 'connected';
      a.ontrack?.({ streams: [new FakeStream(b.tracks) as unknown as MediaStream], track: b.tracks[0] as unknown as MediaStreamTrack });
      a.onconnectionstatechange?.();
    }
  }
  close() {
    this.closed = true;
  }
}

type Device = { account: string; device: string; calls: Calls; logs: { account: string; dir: string; log: CallLog }[] };

function network(opts: { friends?: boolean; denyMedia?: boolean } = {}) {
  const devices: Device[] = [];
  const peers = new Map<string, FakePeer>();
  let n = 0;
  const add = (account: string, device: string) => {
    const d: Device = { account, device, logs: [], calls: null as unknown as Calls };
    d.calls = new Calls({
      myDevice: device,
      send: async (to, signal, toDevice) => {
        for (const t of devices.filter((x) => x.account === to && (!toDevice || x.device === toDevice))) {
          await Promise.resolve();
          await t.calls.handle(account, device, structuredClone(signal));
        }
      },
      newPeer: () => new FakePeer(`${device}-${n++}`, peers),
      getMedia: async (kind: CallKind) => {
        if (opts.denyMedia) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        return new FakeStream([new FakeTrack('audio'), ...(kind === 'video' ? [new FakeTrack('video')] : [])]) as unknown as MediaStream;
      },
      isFriend: () => opts.friends !== false,
      log: (acc, dir, log) => d.logs.push({ account: acc, dir, log }),
      onChange: () => undefined,
    });
    devices.push(d);
    return d;
  };
  return { add };
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => vi.useRealTimers());

describe('Calls', () => {
  it('rings, connects both ways with media, and logs the call on both sides when hung up', async () => {
    const net = network();
    const alice = net.add('alice', 'a1');
    const bob = net.add('bob', 'b1');
    await alice.calls.start('bob', 'video');
    await settle();
    expect(alice.calls.current).toMatchObject({ phase: 'ringing', direction: 'out', kind: 'video' });
    expect(bob.calls.current).toMatchObject({ phase: 'ringing', direction: 'in', account: 'alice', kind: 'video' });
    await bob.calls.accept();
    await settle();
    expect(alice.calls.current?.phase).toBe('active');
    expect(bob.calls.current?.phase).toBe('active');
    expect(alice.calls.current?.remote?.getVideoTracks()).toHaveLength(1);
    expect(bob.calls.current?.remote?.getAudioTracks()).toHaveLength(1);
    const local = alice.calls.current!.local!;
    alice.calls.toggleMute();
    expect(local.getAudioTracks()[0]!.enabled).toBe(false);
    alice.calls.toggleCamera();
    expect(local.getVideoTracks()[0]!.enabled).toBe(false);
    alice.calls.hangUp();
    await settle();
    expect(alice.calls.current).toBeNull();
    expect(bob.calls.current).toBeNull();
    expect(local.getTracks().every((t) => (t as unknown as FakeTrack).stopped)).toBe(true);
    expect(alice.logs.map((l) => [l.dir, l.log.outcome])).toEqual([['out', 'ended']]);
    expect(bob.logs.map((l) => [l.dir, l.log.outcome])).toEqual([['in', 'ended']]);
    expect(alice.logs[0]!.log.ms).toBeGreaterThanOrEqual(0);
  });

  it('declined: the caller is told; both log it', async () => {
    const net = network();
    const alice = net.add('alice', 'a1');
    const bob = net.add('bob', 'b1');
    await alice.calls.start('bob', 'voice');
    await settle();
    bob.calls.hangUp();
    await settle();
    expect(alice.calls.current).toBeNull();
    expect(alice.calls.notice).toBe('Call declined');
    expect(alice.logs[0]!.log.outcome).toBe('declined');
    expect(bob.logs[0]!.log.outcome).toBe('declined');
  });

  it('no answer after 45 s: caller logs no answer, the friend a missed call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const net = network();
    const alice = net.add('alice', 'a1');
    const bob = net.add('bob', 'b1');
    await alice.calls.start('bob', 'video');
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(RING_MS);
    expect(alice.calls.current).toBeNull();
    expect(alice.calls.notice).toBe('No answer');
    expect(alice.logs[0]!.log.outcome).toBe('no-answer');
    expect(bob.calls.current).toBeNull();
    expect(bob.logs[0]!.log.outcome).toBe('missed');
  });

  it('an old invite (read from the mailbox later) is a missed call, not a ring', async () => {
    const net = network();
    const bob = net.add('bob', 'b1');
    const old: CallSignal = { t: 'call', id: 'a'.repeat(24), op: 'invite', kind: 'video', device: 'a1', at: Date.now() - RING_MS - 1000 };
    await bob.calls.handle('alice', 'a1', old);
    expect(bob.calls.current).toBeNull();
    expect(bob.logs[0]!.log.outcome).toBe('missed');
    await bob.calls.handle('alice', 'a1', old); // a copy via the other path: logged once
    expect(bob.logs).toHaveLength(1);
  });

  it('busy: a second caller gets busy; the friend logs a missed call', async () => {
    const net = network();
    const alice = net.add('alice', 'a1');
    const bob = net.add('bob', 'b1');
    const carol = net.add('carol', 'c1');
    await alice.calls.start('bob', 'voice');
    await settle();
    await carol.calls.start('bob', 'voice');
    await settle();
    expect(carol.calls.current).toBeNull();
    expect(carol.calls.notice).toBe('They are on another call');
    expect(bob.calls.current?.account).toBe('alice');
    expect(bob.logs.map((l) => [l.account, l.log.outcome])).toEqual([['carol', 'missed']]);
  });

  it('rings all of the friend’s devices; answering on one stops the others', async () => {
    const net = network();
    const alice = net.add('alice', 'a1');
    const bob1 = net.add('bob', 'b1');
    const bob2 = net.add('bob', 'b2');
    await alice.calls.start('bob', 'video');
    await settle();
    expect(bob1.calls.current?.phase).toBe('ringing');
    expect(bob2.calls.current?.phase).toBe('ringing');
    await bob2.calls.accept();
    await settle();
    expect(bob2.calls.current?.phase).toBe('active');
    expect(bob1.calls.current).toBeNull();
    expect(bob1.logs).toEqual([]); // answered elsewhere: not a missed call
    expect(alice.calls.current?.peerDevice).toBe('b2');
  });

  it('only friends can call; blocked camera gives a clear message', async () => {
    const strangers = network({ friends: false });
    const a = strangers.add('alice', 'a1');
    await expect(a.calls.start('bob', 'video')).rejects.toThrow('You can call friends only.');
    const denied = network({ denyMedia: true });
    const b = denied.add('alice', 'a1');
    denied.add('bob', 'b1');
    await expect(b.calls.start('bob', 'video')).rejects.toThrow(/Access to the camera and microphone is blocked/);
    expect(b.calls.current).toBeNull();
  });

  it('validates signals', () => {
    const ok = { t: 'call', id: 'f'.repeat(24), op: 'accept', kind: 'video', device: 'd', at: 1, sdp: 'v=0' };
    expect(parseCallSignal(ok)).toEqual(ok);
    expect(parseCallSignal({ ...ok, op: 'hack' })).toBeNull();
    expect(parseCallSignal({ ...ok, id: 'short' })).toBeNull();
    expect(parseCallSignal({ ...ok, sdp: 'x'.repeat(40_000) })).toBeNull();
  });
});
