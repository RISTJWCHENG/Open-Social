/**
 * Direct device-to-device links over WebRTC data channels.
 *
 * - Signaling (offer/answer with all ICE candidates, no trickle) travels as
 *   MLS-encrypted payloads through the mailbox, so it is authenticated and
 *   the DTLS fingerprints can't be swapped by the transport.
 * - Glare: the device with the smaller address is "impolite" and keeps its
 *   own offer; the other one answers.
 * - Ordering: the receiver reports, over the channel, the last sequence
 *   number it has processed from us ("hello" on open, "ack" after every
 *   entry, whichever path delivered it). We send entry n over the channel
 *   only when n-1 was already sent over the channel or acknowledged, so the
 *   receiver always processes entries in order. Anything unacknowledged
 *   when a channel closes is handed back for mailbox delivery.
 */

export interface RtcLike {
  createDataChannel(label: string, opts?: RTCDataChannelInit): DataChannelLike;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(d: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void>;
  readonly localDescription: RTCSessionDescriptionInit | null;
  readonly iceGatheringState: string;
  readonly connectionState: string;
  onicegatheringstatechange: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  ondatachannel: ((e: { channel: DataChannelLike }) => void) | null;
  close(): void;
}

export interface DataChannelLike {
  readonly readyState: string;
  binaryType: string;
  /** Bytes queued but not yet sent (for flow control). */
  readonly bufferedAmount?: number;
  send(data: string | Uint8Array): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((e: { data: string | ArrayBuffer | Uint8Array }) => void) | null;
}

export interface SignalPayload {
  t: 'rtc';
  /** Target device id (the payload goes to every device of the account). */
  to: string;
  from: string;
  kind: 'offer' | 'answer';
  sdp: string;
  ts: number;
}

export interface DirectLinksOptions {
  myAddress: string;
  myDeviceId: string;
  /** Sends a signaling payload to one device of an account (via the mailbox). */
  sendSignal(account: string, payload: SignalPayload): Promise<void>;
  /** Processes an entry received over a channel. Returns the receiver's new last seq. */
  onEntry(account: string, deviceId: string, entry: Uint8Array): Promise<number | null>;
  /** Last seq we processed from that device's chain to us. */
  lastReceived(account: string, deviceId: string): number;
  /** Unacknowledged entries for mailbox delivery after a channel closed. */
  onFallback(account: string, deviceId: string, entries: { seq: number; bytes: Uint8Array }[]): void;
  newPeer(): RtcLike;
  enabled(): boolean;
  /** Tests: how long an entry may go unacknowledged (default ACK_TIMEOUT_MS). */
  ackTimeoutMs?: number;
  onChange?(): void;
  /** A link to this device is open and the peer said hello (file transfers can start). */
  onLinkOpen?(account: string, deviceId: string): void;
  /** File transfer control from the peer ({ t: 'file-want' | 'file-done', ... }). */
  onFileControl?(account: string, deviceId: string, msg: FileControl): void;
  /** A part of a sealed file chunk from the peer. */
  onFilePart?(account: string, deviceId: string, part: FilePart): void;
}

/** File transfer messages on a link (receiver-driven: it asks from the first missing chunk). */
export type FileControl = { t: 'file-want'; fileId: string; from: number } | { t: 'file-done'; fileId: string };

export interface FilePart {
  fileId: string;
  chunk: number;
  /** Last part of this chunk. */
  end: boolean;
  data: Uint8Array;
}

/* Binary frames: one type byte, then the payload. */
const FRAME_ENTRY = 1;
const FRAME_FILE = 2;
/** File parts stay well under the 256 KB SCTP message limit of browsers. */
export const FILE_PART_BYTES = 60 * 1024;
/** Pause sending file parts while this much is queued in the channel. */
const MAX_BUFFERED = 8 * 1024 * 1024;

const hexBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const bytesHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function frameEntry(entry: Uint8Array): Uint8Array {
  const f = new Uint8Array(1 + entry.length);
  f[0] = FRAME_ENTRY;
  f.set(entry, 1);
  return f;
}

/** [2][fileId: 12 bytes][chunk: u32][end: u8][data] */
function frameFilePart(p: FilePart): Uint8Array {
  const f = new Uint8Array(1 + 12 + 4 + 1 + p.data.length);
  f[0] = FRAME_FILE;
  f.set(hexBytes(p.fileId), 1);
  new DataView(f.buffer).setUint32(13, p.chunk);
  f[17] = p.end ? 1 : 0;
  f.set(p.data, 18);
  return f;
}

type LinkState = 'idle' | 'offering' | 'answering' | 'open' | 'closed';

interface Link {
  account: string;
  deviceId: string;
  pc: RtcLike | null;
  dc: DataChannelLike | null;
  state: LinkState;
  /** Highest seq the peer told us it processed. */
  acked: number;
  /** Highest seq sent over this channel in order. */
  sentUpTo: number;
  pending: Map<number, Uint8Array>;
  /** Times of recent offers (for the hourly budget). */
  offers: number[];
  peerSaidHello: boolean;
  /** Attempts that ended without ever opening (setup timeout or ICE failure) since the last open. */
  failures: number;
}

/** What the UI can say about the link to an account. */
export type LinkStatus = 'open' | 'connecting' | 'failed' | 'none';

/**
 * Why a connection is attempted. There is no retrying: a device that comes
 * back (start, back to the foreground, network back) makes the offer, and
 * the waiting side only offers when it has seen the friend active.
 */
export type ConnectReason = 'startup' | 'resume' | 'activity' | 'chat' | 'accept' | 'typing';

const OFFER_MAX_AGE_MS = 60_000;
const GATHER_TIMEOUT_MS = 3_000;
/** Minimum gap between two offers to the same device. */
const MIN_GAP_MS = 5_000;
/** Offers per device per hour, whatever the reason. */
const OFFERS_PER_HOUR = 6;

/** An offer or answer that doesn't lead to an open channel in time is abandoned. */
const SETUP_TIMEOUT_MS = 20_000;
/**
 * An entry sent over a link must be acknowledged within this time, or the
 * link is taken as stalled (the friend's phone locked or switched apps: its
 * page is frozen while the connection still looks up): it is closed and the
 * unacknowledged entries go by mailbox at once.
 */
const ACK_TIMEOUT_MS = 4_000;

const key = (account: string, deviceId: string) => `${account}.${deviceId}`;

export class DirectLinks {
  private links = new Map<string, Link>();

  constructor(private readonly o: DirectLinksOptions) {}

  private link(account: string, deviceId: string): Link {
    const k = key(account, deviceId);
    let l = this.links.get(k);
    if (!l) {
      l = { account, deviceId, pc: null, dc: null, state: 'idle', acked: 0, sentUpTo: 0, pending: new Map(), offers: [], peerSaidHello: false, failures: 0 };
      this.links.set(k, l);
    }
    return l;
  }

  isOpen(account: string, deviceId: string): boolean {
    const l = this.links.get(key(account, deviceId));
    return !!l && l.state === 'open' && l.dc?.readyState === 'open' && l.peerSaidHello;
  }

  /** Any open link to this account (for the UI). */
  /**
   * Link status to an account (any of its devices): open; connecting (an
   * offer or answer in progress); failed (two or more attempts never
   * connected, e.g. networks that block direct connections); or none.
   */
  status(account: string): LinkStatus {
    const ls = [...this.links.values()].filter((l) => l.account === account);
    if (ls.some((l) => this.isOpen(account, l.deviceId))) return 'open';
    if (ls.some((l) => l.state === 'offering' || l.state === 'answering')) return 'connecting';
    if (ls.some((l) => l.failures >= 2)) return 'failed';
    return 'none';
  }

  isDirect(account: string): boolean {
    return [...this.links.values()].some((l) => l.account === account && this.isOpen(account, l.deviceId));
  }

  private polite(account: string, deviceId: string) {
    return this.o.myAddress > key(account, deviceId);
  }

  private async gathered(pc: RtcLike): Promise<void> {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, GATHER_TIMEOUT_MS);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(t);
          resolve();
        }
      };
    });
  }

  private setup(l: Link, pc: RtcLike) {
    l.pc = pc;
    setTimeout(() => {
      if (l.pc === pc && l.state !== 'open') this.closed(l, pc);
    }, SETUP_TIMEOUT_MS);
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.closed(l, pc);
    };
    pc.ondatachannel = (e) => this.attach(l, e.channel, pc);
  }

  /** Handlers are bound to their own peer connection, so events from a replaced one are ignored. */
  private attach(l: Link, dc: DataChannelLike, pc: RtcLike) {
    if (l.pc !== pc) return;
    l.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      if (l.pc !== pc) return;
      l.state = 'open';
      l.failures = 0;
      dc.send(JSON.stringify({ t: 'hello', last: this.o.lastReceived(l.account, l.deviceId) }));
      this.o.onChange?.();
    };
    dc.onclose = () => this.closed(l, pc);
    dc.onmessage = (e) => {
      if (l.pc === pc) void this.onMessage(l, e.data);
    };
    if (dc.readyState === 'open') dc.onopen();
  }

  private async onMessage(l: Link, data: string | ArrayBuffer | Uint8Array) {
    if (typeof data === 'string') {
      let m: { t?: string; last?: number };
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if ((m.t === 'hello' || m.t === 'ack') && typeof m.last === 'number') {
        const first = m.t === 'hello' && !l.peerSaidHello;
        if (m.t === 'hello') {
          l.peerSaidHello = true;
          l.sentUpTo = Math.max(l.sentUpTo, m.last);
        }
        l.acked = Math.max(l.acked, m.last);
        l.sentUpTo = Math.max(l.sentUpTo, l.acked);
        for (const s of [...l.pending.keys()]) if (s <= l.acked) l.pending.delete(s);
        this.o.onChange?.();
        if (first) this.o.onLinkOpen?.(l.account, l.deviceId);
        return;
      }
      const f = m as { t?: string; fileId?: unknown; from?: unknown };
      if (typeof f.fileId === 'string' && /^[0-9a-f]{24}$/.test(f.fileId)) {
        if (f.t === 'file-want' && Number.isInteger(f.from) && (f.from as number) >= 0) {
          this.o.onFileControl?.(l.account, l.deviceId, { t: 'file-want', fileId: f.fileId, from: f.from as number });
        } else if (f.t === 'file-done') {
          this.o.onFileControl?.(l.account, l.deviceId, { t: 'file-done', fileId: f.fileId });
        }
      }
      return;
    }
    const frame = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (frame[0] === FRAME_ENTRY) {
      const last = await this.o.onEntry(l.account, l.deviceId, frame.subarray(1)).catch(() => null);
      if (last !== null) this.ack(l.account, l.deviceId, last);
    } else if (frame[0] === FRAME_FILE && frame.length >= 18) {
      this.o.onFilePart?.(l.account, l.deviceId, {
        fileId: bytesHex(frame.subarray(1, 13)),
        chunk: new DataView(frame.buffer, frame.byteOffset).getUint32(13),
        end: frame[17] === 1,
        data: frame.slice(18),
      });
    }
  }

  /** Sends a file-transfer control message; false if the link isn't open. */
  sendFileControl(account: string, deviceId: string, msg: FileControl): boolean {
    const l = this.links.get(key(account, deviceId));
    if (!l || !this.isOpen(account, deviceId)) return false;
    try {
      l.dc!.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sends one file part, waiting while the channel's send buffer is full.
   * False if the link closed (the receiver asks again later).
   */
  async sendFilePart(account: string, deviceId: string, part: FilePart): Promise<boolean> {
    const l = this.links.get(key(account, deviceId));
    if (!l) return false;
    while (this.isOpen(account, deviceId) && (l.dc?.bufferedAmount ?? 0) > MAX_BUFFERED) {
      await new Promise((r) => setTimeout(r, 30));
    }
    if (!this.isOpen(account, deviceId)) return false;
    try {
      l.dc!.send(frameFilePart(part));
      return true;
    } catch {
      return false;
    }
  }

  /** Tells the peer how far we have processed its chain (after any delivery path). */
  ack(account: string, deviceId: string, last: number) {
    const l = this.links.get(key(account, deviceId));
    if (l?.dc?.readyState === 'open') {
      try {
        l.dc.send(JSON.stringify({ t: 'ack', last }));
      } catch {
        // channel closing; the next hello carries the same information
      }
    }
  }

  /**
   * Sends entries with consecutive seqs over the channel if order allows.
   * Returns false if the caller must use the mailbox instead.
   */
  trySend(account: string, deviceId: string, entries: { seq: number; bytes: Uint8Array }[]): boolean {
    const l = this.links.get(key(account, deviceId));
    if (!l || !this.isOpen(account, deviceId) || entries.length === 0) return false;
    if (entries[0]!.seq !== l.sentUpTo + 1) return false;
    try {
      for (const e of entries) {
        l.dc!.send(frameEntry(e.bytes));
        l.pending.set(e.seq, e.bytes);
        l.sentUpTo = e.seq;
      }
      const pc = l.pc!;
      const upTo = l.sentUpTo;
      setTimeout(() => {
        if (l.pc === pc && l.acked < upTo) this.closed(l, pc);
      }, this.o.ackTimeoutMs ?? ACK_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  private closed(l: Link, pc: RtcLike) {
    if (l.pc !== pc) return;
    const wasOpen = l.state === 'open';
    if (!wasOpen && (l.state === 'offering' || l.state === 'answering')) l.failures++;
    l.state = 'closed';
    l.peerSaidHello = false;
    try {
      pc.close();
    } catch {
      // ignore
    }
    l.pc = null;
    l.dc = null;
    const lost = [...l.pending.entries()].filter(([s]) => s > l.acked).sort(([a], [b]) => a - b);
    l.pending.clear();
    l.sentUpTo = l.acked;
    if (lost.length) this.o.onFallback(l.account, l.deviceId, lost.map(([seq, bytes]) => ({ seq, bytes })));
    this.o.onChange?.();
    // No reconnect offers: the friend's device offers when it comes back.
    void wasOpen;
  }

  /** Offers sent to this device in the last hour (for tests and diagnostics). */
  offersLastHour(account: string, deviceId: string): number {
    const l = this.links.get(key(account, deviceId));
    return l ? l.offers.filter((t) => Date.now() - t < 3_600_000).length : 0;
  }

  /**
   * Starts a connection (offer) unless one is open or in progress, the last
   * offer was under 5 s ago, or the hourly budget for this device is used up.
   * Returns true if an offer was sent.
   */
  async connect(account: string, deviceId: string, reason: ConnectReason = 'chat'): Promise<boolean> {
    void reason;
    if (!this.o.enabled()) return false;
    const l = this.link(account, deviceId);
    if (l.state === 'open' && l.dc?.readyState === 'open') return false;
    if (l.state === 'offering' || l.state === 'answering') return false;
    const now = Date.now();
    l.offers = l.offers.filter((t) => now - t < 3_600_000);
    if (l.offers.length >= OFFERS_PER_HOUR) return false;
    if (l.offers.length && now - l.offers[l.offers.length - 1]! < MIN_GAP_MS) return false;
    l.offers.push(now);
    l.state = 'offering';
    const pc = this.o.newPeer();
    this.setup(l, pc);
    this.attach(l, pc.createDataChannel('opensocial', { ordered: true }), pc);
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await this.gathered(pc);
      await this.o.sendSignal(account, {
        t: 'rtc',
        to: deviceId,
        from: this.o.myDeviceId,
        kind: 'offer',
        sdp: pc.localDescription?.sdp ?? '',
        ts: Date.now(),
      });
    } catch {
      this.closed(l, pc);
      return false;
    }
    return true;
  }

  /** Handles an offer or answer received (already decrypted and authenticated). */
  async handleSignal(account: string, p: SignalPayload): Promise<void> {
    if (p.to !== this.o.myDeviceId || !this.o.enabled()) return;
    if (Date.now() - p.ts > OFFER_MAX_AGE_MS) return;
    const l = this.link(account, p.from);
    if (p.kind === 'answer') {
      if (l.state !== 'offering' || !l.pc) return;
      try {
        await l.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
      } catch {
        this.closed(l, l.pc);
      }
      return;
    }
    // Offer.
    if (l.state === 'open' && l.dc?.readyState === 'open') return;
    if (l.state === 'offering' && !this.polite(account, p.from)) return; // keep ours
    if (l.pc) {
      const old = l.pc;
      l.pc = null;
      try {
        old.close();
      } catch {
        // ignore
      }
    }
    l.state = 'answering';
    const pc = this.o.newPeer();
    this.setup(l, pc);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await this.gathered(pc);
      await this.o.sendSignal(account, {
        t: 'rtc',
        to: p.from,
        from: this.o.myDeviceId,
        kind: 'answer',
        sdp: pc.localDescription?.sdp ?? '',
        ts: Date.now(),
      });
    } catch {
      this.closed(l, pc);
    }
  }

  /** Closes every link and forgets retry back-off (used when the setting changes). */
  closeAll() {
    for (const l of this.links.values()) {
      if (l.pc) this.closed(l, l.pc);
      l.offers = [];
    }
  }
}
