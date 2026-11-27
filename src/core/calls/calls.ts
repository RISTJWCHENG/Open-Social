/**
 * One-to-one voice and video calls between friends.
 *
 * Media flows device to device over WebRTC (DTLS-SRTP, end to end); nothing
 * passes a server. The call setup travels as MLS-encrypted messages (direct
 * link when open, else the mailbox), so the DTLS fingerprints in the SDP are
 * authenticated and the connection can't be intercepted.
 *
 * Setup: the caller's device sends "invite" to all of the friend's devices;
 * the device that accepts sends "accept" with an SDP offer; the caller replies
 * "answer" and tells the friend's other devices to stop ringing ("answered").
 * "decline", "busy", "cancel" and "end" close it. Calls ring for 45 s; an
 * invite older than that (e.g. read from the mailbox later) is a missed call.
 */

export type CallKind = 'video' | 'voice';
export type CallOp = 'invite' | 'accept' | 'answer' | 'answered' | 'decline' | 'busy' | 'cancel' | 'end';

export interface CallSignal {
  t: 'call';
  id: string;
  op: CallOp;
  kind: CallKind;
  /** Sending device. */
  device: string;
  /** Sender's time (invites older than RING_MS are missed calls). */
  at: number;
  sdp?: string;
}

/** How a call ended, as logged in the chat on each side. */
export type CallOutcome = 'ended' | 'missed' | 'no-answer' | 'declined' | 'busy' | 'failed' | 'cancelled';

export interface CallLog {
  kind: CallKind;
  outcome: CallOutcome;
  /** Talk time, for calls that connected. */
  ms?: number;
}

export type CallPhase = 'ringing' | 'connecting' | 'active';

export interface CallState {
  id: string;
  account: string;
  kind: CallKind;
  direction: 'out' | 'in';
  phase: CallPhase;
  /** The friend's device in the call (set once one answers). */
  peerDevice?: string;
  startedAt: number;
  connectedAt?: number;
  local?: MediaStream;
  remote?: MediaStream;
  muted: boolean;
  cameraOff: boolean;
}

/** The parts of RTCPeerConnection used here. */
export interface CallPeer {
  readonly connectionState: string;
  readonly iceGatheringState: string;
  readonly localDescription: { sdp: string } | null;
  onicegatheringstatechange: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  ontrack: ((e: { streams: readonly MediaStream[]; track: MediaStreamTrack }) => void) | null;
  addTrack(track: MediaStreamTrack, stream: MediaStream): unknown;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  createAnswer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(d: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(d: { type: 'offer' | 'answer'; sdp: string }): Promise<void>;
  close(): void;
}

export interface CallDeps {
  myDevice: string;
  /** Sends a signal to a friend: to one device, or all of theirs. */
  send(account: string, signal: CallSignal, toDevice?: string): Promise<void>;
  newPeer(): CallPeer;
  getMedia(kind: CallKind): Promise<MediaStream>;
  /** Only friends can call (and be rung). */
  isFriend(account: string): boolean;
  /** Records the call in the chat. */
  log(account: string, direction: 'in' | 'out', entry: CallLog, at: number): void;
  onChange(): void;
}

export const RING_MS = 45_000;
const CONNECT_MS = 30_000;
const GATHER_MS = 3_000;

export class CallError extends Error {}

/** Why media could not start, in words. */
export function mediaError(e: unknown, kind: CallKind): string {
  const name = (e as { name?: string })?.name;
  const what = kind === 'video' ? 'camera and microphone' : 'microphone';
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Access to the ${what} is blocked. Allow it for this site, then try again.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${kind === 'video' ? 'camera' : 'microphone'} was found.`;
  if (name === 'NotReadableError') return `The ${what} is in use by another app.`;
  return 'The call could not start.';
}

export class Calls {
  current: CallState | null = null;
  /** Shown after a call stops for a reason worth saying ("No answer", "Couldn't connect"). */
  notice: string | null = null;
  private pc: CallPeer | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Call ids already logged (a signal may arrive twice: link and mailbox). */
  private seen = new Set<string>();

  constructor(private d: CallDeps) {}

  /** Starts a call to a friend (asks for the camera / microphone first). */
  async start(account: string, kind: CallKind): Promise<void> {
    if (this.current) throw new CallError('You are already in a call.');
    if (!this.d.isFriend(account)) throw new CallError('You can call friends only.');
    this.notice = null;
    let local: MediaStream;
    try {
      local = await this.d.getMedia(kind);
    } catch (e) {
      throw new CallError(mediaError(e, kind));
    }
    const id = randomId();
    this.seen.add(id);
    this.current = { id, account, kind, direction: 'out', phase: 'ringing', startedAt: Date.now(), local, muted: false, cameraOff: false };
    this.d.onChange();
    this.arm(RING_MS, () => this.finish('no-answer', 'No answer', true));
    try {
      await this.d.send(account, this.signal('invite'));
    } catch (e) {
      this.finish('failed', `The call could not be placed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Answers the ringing call. */
  async accept(): Promise<void> {
    const c = this.current;
    if (!c || c.direction !== 'in' || c.phase !== 'ringing') return;
    clearTimeout(this.timer!);
    try {
      c.local = await this.d.getMedia(c.kind);
    } catch (e) {
      this.notice = mediaError(e, c.kind);
      void this.d.send(c.account, this.signal('decline'), c.peerDevice).catch(() => undefined);
      return this.finish('failed', this.notice);
    }
    c.phase = 'connecting';
    this.d.onChange();
    this.arm(CONNECT_MS, () => this.fail());
    const pc = this.peer(c);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await gathered(pc);
    await this.d.send(c.account, { ...this.signal('accept'), sdp: pc.localDescription!.sdp }, c.peerDevice);
  }

  /** Declines a ringing call, cancels an outgoing one, or hangs up. */
  hangUp(): void {
    const c = this.current;
    if (!c) return;
    if (c.phase === 'ringing') {
      const op: CallOp = c.direction === 'in' ? 'decline' : 'cancel';
      void this.d.send(c.account, this.signal(op), c.direction === 'in' ? c.peerDevice : undefined).catch(() => undefined);
      return this.finish(c.direction === 'in' ? 'declined' : 'cancelled', null);
    }
    void this.d.send(c.account, this.signal('end'), c.peerDevice).catch(() => undefined);
    this.finish(c.connectedAt ? 'ended' : 'cancelled', null);
  }

  toggleMute(): void {
    const c = this.current;
    if (!c?.local) return;
    c.muted = !c.muted;
    c.local.getAudioTracks().forEach((t) => (t.enabled = !c.muted));
    this.d.onChange();
  }

  toggleCamera(): void {
    const c = this.current;
    if (!c?.local || c.kind !== 'video') return;
    c.cameraOff = !c.cameraOff;
    c.local.getVideoTracks().forEach((t) => (t.enabled = !c.cameraOff));
    this.d.onChange();
  }

  /** A call signal from a friend's device (already decrypted and verified). */
  async handle(account: string, fromDevice: string, s: CallSignal): Promise<void> {
    const c = this.current;
    const mine = c && c.id === s.id && c.account === account;
    switch (s.op) {
      case 'invite': {
        if (this.seen.has(s.id) || !this.d.isFriend(account)) return;
        this.seen.add(s.id);
        // Too old to ring (read from the mailbox later): a missed call.
        if (Date.now() - s.at > RING_MS) return this.d.log(account, 'in', { kind: s.kind, outcome: 'missed' }, s.at);
        if (c) {
          void this.d.send(account, { ...this.signal('busy', s), id: s.id, kind: s.kind }, fromDevice).catch(() => undefined);
          return this.d.log(account, 'in', { kind: s.kind, outcome: 'missed' }, s.at);
        }
        this.notice = null;
        this.current = {
          id: s.id,
          account,
          kind: s.kind,
          direction: 'in',
          phase: 'ringing',
          peerDevice: fromDevice,
          startedAt: s.at,
          muted: false,
          cameraOff: false,
        };
        this.arm(RING_MS - (Date.now() - s.at), () => this.finish('missed', null, true));
        return this.d.onChange();
      }
      case 'accept': {
        if (!mine || c.direction !== 'out' || c.phase !== 'ringing' || !s.sdp) return;
        clearTimeout(this.timer!);
        c.peerDevice = fromDevice;
        c.phase = 'connecting';
        this.d.onChange();
        this.arm(CONNECT_MS, () => this.fail());
        // The friend's other devices stop ringing.
        void this.d.send(account, { ...this.signal('answered'), sdp: undefined }).catch(() => undefined);
        const pc = this.peer(c);
        await pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        await this.d.send(account, { ...this.signal('answer'), sdp: pc.localDescription!.sdp }, fromDevice);
        return;
      }
      case 'answer': {
        if (!mine || c.direction !== 'in' || fromDevice !== c.peerDevice || !s.sdp || !this.pc) return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
        return;
      }
      case 'answered': {
        // Answered on another of my devices: stop ringing here.
        if (mine && c.direction === 'in' && c.phase === 'ringing') this.finish('cancelled', null, false, false);
        return;
      }
      case 'decline':
        if (mine && c.direction === 'out' && c.phase === 'ringing') this.finish('declined', 'Call declined');
        return;
      case 'busy':
        if (mine && c.direction === 'out' && c.phase === 'ringing') this.finish('busy', 'They are on another call');
        return;
      case 'cancel':
        if (mine && c.direction === 'in' && c.phase === 'ringing') this.finish('missed', null);
        else if (!mine && !this.seen.has(s.id)) {
          // Cancelled before it reached this device: still a missed call.
          this.seen.add(s.id);
          this.d.log(account, 'in', { kind: s.kind, outcome: 'missed' }, s.at);
        }
        return;
      case 'end':
        if (mine && (!c.peerDevice || c.peerDevice === fromDevice)) this.finish(c.connectedAt ? 'ended' : 'failed', 'Call ended');
        return;
    }
  }

  /** The friend's device signed out or the app is closing. */
  dispose(): void {
    if (this.current) this.hangUp();
  }

  private peer(c: CallState): CallPeer {
    const pc = this.d.newPeer();
    this.pc = pc;
    for (const t of c.local?.getTracks() ?? []) pc.addTrack(t, c.local!);
    pc.ontrack = (e) => {
      if (this.current !== c) return;
      c.remote = e.streams[0] ?? new MediaStream([e.track]);
      this.d.onChange();
    };
    pc.onconnectionstatechange = () => {
      if (this.current !== c) return;
      if (pc.connectionState === 'connected' && c.phase !== 'active') {
        clearTimeout(this.timer!);
        c.phase = 'active';
        c.connectedAt = Date.now();
        this.d.onChange();
      } else if (pc.connectionState === 'failed') {
        this.fail();
      }
    };
    return pc;
  }

  private fail() {
    const c = this.current;
    if (!c) return;
    void this.d.send(c.account, this.signal('end'), c.peerDevice).catch(() => undefined);
    this.finish(
      'failed',
      c.connectedAt ? 'The connection was lost.' : 'Couldn’t connect. Your networks may not allow direct calls.',
    );
  }

  private signal(op: CallOp, base?: CallSignal): CallSignal {
    const c = this.current;
    return { t: 'call', id: base?.id ?? c!.id, op, kind: base?.kind ?? c!.kind, device: this.d.myDevice, at: Date.now() };
  }

  private arm(ms: number, then: () => void) {
    clearTimeout(this.timer!);
    this.timer = setTimeout(then, Math.max(0, ms));
  }

  /** Ends the call here: stops media, closes the connection, logs it. */
  private finish(outcome: CallOutcome, notice: string | null, timedOut = false, log = true) {
    const c = this.current;
    if (!c) return;
    clearTimeout(this.timer!);
    if (timedOut && c.direction === 'out') void this.d.send(c.account, this.signal('cancel')).catch(() => undefined);
    c.local?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.pc = null;
    this.current = null;
    this.notice = notice;
    if (log) {
      this.d.log(c.account, c.direction, { kind: c.kind, outcome, ...(c.connectedAt ? { ms: Date.now() - c.connectedAt } : {}) }, c.startedAt);
    }
    this.d.onChange();
  }
}

/** Waits until ICE candidates are in the local description (or a few seconds). */
async function gathered(pc: CallPeer): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, GATHER_MS);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    };
  });
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Checks a call signal received from a friend (shape and sizes). */
export function parseCallSignal(p: unknown): CallSignal | null {
  const s = p as Partial<CallSignal>;
  const ops: CallOp[] = ['invite', 'accept', 'answer', 'answered', 'decline', 'busy', 'cancel', 'end'];
  if (
    s?.t === 'call' &&
    typeof s.id === 'string' &&
    /^[0-9a-f]{24}$/.test(s.id) &&
    ops.includes(s.op as CallOp) &&
    (s.kind === 'video' || s.kind === 'voice') &&
    typeof s.device === 'string' &&
    typeof s.at === 'number' &&
    (s.sdp === undefined || (typeof s.sdp === 'string' && s.sdp.length < 30_000))
  ) {
    return { t: 'call', id: s.id, op: s.op as CallOp, kind: s.kind, device: s.device, at: s.at, ...(s.sdp ? { sdp: s.sdp } : {}) };
  }
  return null;
}
