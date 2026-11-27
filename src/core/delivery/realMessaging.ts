/**
 * Real one-to-one messaging between OpenSocial accounts.
 *
 * Send: for each of the recipient's devices, seal the text for that device
 * (OSE1 envelope), wrap it in a signed log entry (OLE1, per-device chain)
 * and deposit it through OfflineDelivery.
 * Receive: fetch entries for this device, check the transport-reported
 * sender, the entry signature against the sender's published device key,
 * the envelope signature, and the per-device chain; store; acknowledge.
 *
 * Encryption: MLS (RFC 9420) with OpenMLS compiled to WebAssembly. Each
 * device is an MLS member "<account>.<deviceId>". For every pair of devices
 * each side owns one outbound two-member group (it alone commits there), set
 * up from the other device's key package; the Welcome goes through the
 * mailbox first. Forward secrecy from MLS; the sender heals its leaf with
 * periodic self-update commits. Log entries (OLE1 v3) are still signed by the
 * device key from the directory, which binds MLS traffic to the account.
 */
import { createIdentity } from '../crypto/identity';
import { fromBase64, fromUtf8, randomBytes, toBase64, toHex, utf8 } from '../crypto/bytes';
import { OpenSocialError } from '../types';
import {
  decodeEntry,
  directConversationId,
  encodeEntry,
  entryHash,
  signEntry,
  verifyEntry,
  type LogEntry,
} from './logEntry';
import type { DeviceDirectory, OfflineDelivery, PublishedDevice } from './offlineDelivery';
import { sanitizeLinkPreview, type LinkPreview } from './linkPreview';
import { eventEnd, RSVPS, sanitizeEvent, wireEvent, type Reminder, type Rsvp, type ZEvent } from '../events/events';
import { BLOB_CHUNK, StaleEpoch, type GroupTransport, type StreamEntry, type StreamHead } from '../groups/transport';
import {
  GROUP_LIMITS,
  canPost,
  diffGroup,
  groupIdOf,
  groupKey,
  isAdmin,
  isGroupId,
  isGroupKey,
  isMember,
  isNewer,
  mayChange,
  nextGroup,
  roleOf,
  sanitizeGroup,
  withoutMember,
  type GroupMember,
  type GroupState,
} from '../groups/groups';

import type { LocalStore, StoredDevice } from './localStore';
import { keyFingerprint, loadMls, type MlsDevice } from '../mls/mls';
import { normalizeProfile, openProfile, type ProfileContent } from '../profile/sealedProfile';
import { Calls, parseCallSignal, type CallKind, type CallLog, type CallPeer, type CallSignal } from '../calls/calls';
import {
  FILE_CHUNK_BYTES,
  MAX_FILE_BYTES,
  chunkCount,
  ciphertextSize,
  decryptStream,
  encryptStream,
  importFileKey,
  openChunk,
  sealChunk,
  type FileSource,
} from '../files/chunkedFile';
import {
  DirectLinks,
  FILE_PART_BYTES,
  type ConnectReason,
  type FilePart,
  type LinkStatus,
  type RtcLike,
  type SignalPayload,
} from '../direct/directLinks';

const KEY_PACKAGE_BATCH = 50;
const KEY_PACKAGE_LOW = 20;
/** Envelope kinds inside v3 entries. */
const KIND_WELCOME = 1;
const KIND_MESSAGE = 2;

export interface RealContact {
  account: string;
  /** Name shown in the list: nickname, else their profile name, else a short id. */
  name: string;
  /** Name the user chose (only on this account). */
  nickname?: string;
  addedAt: number;
  /** False for senders who wrote first and were not accepted yet (message request). */
  known: boolean;
  blocked?: boolean;
  /** Their friends-only profile, decrypted with the key they shared. */
  profile?: ProfileContent;
  /** Key to their sealed profile, and its version (their profile's updatedAt). */
  profileKey?: { key: string; version: number };
  /** Version of our profile key last sent to this contact. */
  keySent?: number;
  /** They deleted their account. */
  deleted?: boolean;
  /** How many of their messages have been read (counted in arrival order, so clocks don't matter). */
  readIn?: number;
  /** Their messages this device couldn't decrypt (each asked their app to repair the channel). */
  repaired?: number;
  /** Latest of their messages (by their send time) we confirmed as delivered / read. */
  receiptDelivered?: number;
  receiptRead?: number;
  /* How the chat is listed on this device (never shared). */
  /** In Archived; a new message from them brings it back. */
  archived?: boolean;
  /** Pinned to the top (time pinned, newest first); at most MAX_PINNED. */
  pinnedAt?: number;
  /** Muted until this time (MUTED_ALWAYS for always). */
  mutedUntil?: number;
  favorite?: boolean;
  /** Language this chat's incoming messages are translated into, on this device. */
  translateTo?: string;
  /** This chat's colour theme, on this device (absent: the default). */
  chatTheme?: string;
  /** This chat's text size, on this device (absent: the default). */
  textSize?: 'small' | 'large';
  /** Marked as unread by the user (cleared when the chat is read). */
  markedUnread?: boolean;
  /** Chat deleted: not listed until they write again or it is opened anew. */
  hidden?: boolean;
  /** A group chat (`account` is its chat key, see groupKey). */
  group?: true;
  /** A group's photo (data URL). */
  photo?: string;
}

/** Payload inside the encrypted envelope. Plain strings from older clients are text. */
interface FileMeta {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  thumb?: string;
  voice?: VoiceInfo;
  /** Text sent with the file (shown under it). */
  caption?: string;
}

/** Longest caption sent with a file. */
export const MAX_CAPTION = 4096;

/**
 * How a file of `size` bytes is split into inline chunks: [start, end) each.
 * Every chunk holds CHUNK_BYTES, except the first, which gives up room for the
 * preview, waveform and caption that ride with it, so no entry passes the
 * mailbox's 64 KB limit.
 */
export function inlineChunks(size: number, extras: { thumb?: string; voice?: VoiceInfo; caption?: string }): [number, number][] {
  const extraChars = (extras.thumb?.length ?? 0) + (extras.voice ? 120 : 0) + new TextEncoder().encode(extras.caption ?? '').length * 2;
  // Base64 carries 3 bytes per 4 characters; captions may be escaped in JSON (up to 2x).
  const first = Math.max(0, CHUNK_BYTES - Math.ceil((extraChars * 3) / 4));
  const out: [number, number][] = [[0, Math.min(size, first)]];
  for (let at = Math.min(size, first); at < size; at += CHUNK_BYTES) out.push([at, Math.min(size, at + CHUNK_BYTES)]);
  return out;
}

/** A voice message: its length and a waveform (one byte per bar, 0..255), so it can be drawn before playing. */
export interface VoiceInfo {
  ms: number;
  /** Base64 of up to 64 amplitude bytes. */
  wave: string;
}

/** Longest voice message accepted (15 minutes). */
export const MAX_VOICE_MS = 15 * 60_000;

/** The preview details that travel with a file (only those present). */
function mediaInfo(x: { thumb?: string; voice?: VoiceInfo; caption?: string }): {
  thumb?: string;
  voice?: VoiceInfo;
  caption?: string;
} {
  return {
    ...(x.thumb ? { thumb: x.thumb } : {}),
    ...(x.voice ? { voice: x.voice } : {}),
    ...(x.caption ? { caption: x.caption.slice(0, MAX_CAPTION) } : {}),
  };
}

function validVoice(v: unknown): v is VoiceInfo {
  const o = v as VoiceInfo;
  return (
    !!o &&
    Number.isInteger(o.ms) &&
    o.ms > 0 &&
    o.ms <= MAX_VOICE_MS &&
    typeof o.wave === 'string' &&
    o.wave.length <= 88 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(o.wave)
  );
}
/** What the organizer fills in for an event. */
export type EventInput = Omit<ZEvent, 'id' | 'organizer' | 'responses' | 'updatedAt' | 'cancelled'>;

type FileChunk = FileMeta & { t: 'file'; i: number; n: number; data: string };
type FileSia = FileMeta & { t: 'file-sia'; seed: string; objectId: string; key: string; iv: string };
/** A large file offered over direct links: the key travels here, the chunks over the link. */
type FileP2P = FileMeta & { t: 'file-p2p'; key: string; iv: string; chunks: number };
/** On the wire: a reply's quote, `by` from the sender's point of view. */
type WireReply = { ref: string; by: 'me' | 'you'; text: string; a?: string };
/** On the wire: a link preview (see linkPreview.ts). */
type WireLinkPreview = { url: string; title?: string; description?: string; site?: string; image?: string };
type Payload =
  /** `mid`: the sender's id for the message (so it can be retracted); `re`: the message it replies to. */
  | { t: 'text'; text: string; mid?: string; re?: WireReply; lp?: WireLinkPreview }
  /** The sender changed the text of one of their messages (`ref`). */
  | { t: 'edit'; ref: string; text: string }
  /** Adds (`on`) or takes back one of our reactions to a message (`ref`). */
  | { t: 'react'; ref: string; emoji: string; on: boolean }
  /** "Delete for everyone": the sender withdraws a message (text id or file id). */
  | { t: 'retract'; id: string }
  | { t: 'profile-key'; key: string; version: number }
  /** From a new device of our own account: "send me our profile key". */
  | { t: 'profile-key-request' }
  | { t: 'account-deleted' }
  /** Call setup (see core/calls). */
  | CallSignal
  /** "Your messages up to (your send time) `upTo` reached a device of mine / were read." */
  | { t: 'receipt'; kind: 'delivered' | 'read'; upTo: number }
  /** "Your channel to my device `from` is broken (since `since`): start a new one and re-send." */
  | { t: 'mls-reset'; to: string; from: string; since: number }
  /** From an event's organizer to each invitee: the event as it is now (see core/events). */
  | { t: 'event'; ev: unknown }
  /** From an invitee to the organizer: their reply. */
  | { t: 'event-rsvp'; id: string; r: Rsvp }
  | SignalPayload
  /**
   * A group message: `p` for group `g`, sent by a member who holds version `v`
   * of the group and calls themselves `n`.
   */
  | { t: 'group'; g: string; v: number; n?: string; p: GroupInner }
  /**
   * "You are in group `g` (called `name`)": its Welcome is blob `blob`
   * (`chunks` parts) in `shard`, for the commit at `seq`. The group itself
   * (members, roles...) follows in the stream.
   */
  | { t: 'group-invite'; g: string; shard: string; seq: number; blob: string; chunks: number; name: string }
  /** "`by` removed you from group `g`." */
  | { t: 'group-removed'; g: string; by: string }
  /** A kind this build doesn't know (from a newer app): ignored, never shown as text. */
  | { t: 'unknown' }
  | FileChunk
  | FileSia
  | FileP2P;

/** What travels inside a group message (the plaintext of one MLS message in the group's stream). */
type GroupInner =
  | Extract<Payload, { t: 'text' | 'edit' | 'react' | 'retract' }>
  | FileChunk
  | FileSia
  /** The group as it is now, after a change by the sender. */
  | { t: 'group-state'; s: unknown };

/** Largest file sent in a group: stored once in the group's shard; larger ones need Sia. */
export const GROUP_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** Accounts added per commit (keeps a commit and its Welcome within one call). */
const GROUP_ADD_BATCH = 100;
/** Renew our MLS keys in a group after this many messages, or this long. */
const GROUP_KEY_UPDATE_EVERY = 200;
const GROUP_KEY_UPDATE_MS = 7 * 86_400_000;
/** Marks a group file's location (shard and group) where a Sia file has its seed. */
const GROUP_BLOB_SEED = 'zgroup:';
/** Group files up to this size are fetched as soon as they arrive. */
const GROUP_AUTO_FETCH_BYTES = 5 * 1024 * 1024;
/** How often we look for devices of ours missing from our groups. */
const GROUP_DEVICE_CHECK_MS = 10 * 60_000;

/** What an MLS group operation returns (see wasm/mls groupAdd...). */
type MlsCommit = { commit: Uint8Array; welcome?: Uint8Array };

/** A line in a group chat about a change to the group (who did what), drawn by the app. */
export interface GroupNotice {
  kind: 'created' | 'added' | 'joined' | 'removed' | 'left' | 'promoted' | 'demoted' | 'owner' | 'renamed' | 'photo' | 'about' | 'settings';
  /** Who made the change. */
  by: string;
  /** Who it was about (added, removed, promoted...). */
  who?: string[];
  /** The new name (renamed). */
  text?: string;
}

/** A group as this device holds it. */
interface GroupRecord {
  state: GroupState;
  /** Names members gave themselves (sent with their messages). */
  names: Record<string, string>;
  /** We left or were removed: the chat stays, read-only. */
  left?: boolean;
  /** The inbox shard holding the group's stream. */
  shard: string;
  /** The last stream entry applied here. */
  cursor: number;
  /** Our own entries past the cursor, already applied here. */
  own?: number[];
  /** Messages we sent since our last key update, and when that was (ms). */
  sent?: number;
  keysAt?: number;
}

/** Files up to this size go inline (direct link or mailbox); larger ones through Sia. */
/** Waits before trying a failed mailbox call again (tests shorten them). */
export const DEPOSIT_RETRY_MS = [1000, 3000];

/** The mailbox's per-minute sending limit (counted in whole minutes since the epoch). */
function isRateLimited(e: unknown): boolean {
  return /Sending too fast/i.test(e instanceof Error ? e.message : String(e));
}

/** Waits at the rate limit before giving up (each up to a minute). */
const MAX_PACED_WAITS = 30;

/** Time until the canister's next minute window, plus a second of margin (tests shorten it). */
export const pacing = { msToNextMinute: () => 60_000 - (Date.now() % 60_000) + 1000 };
const msToNextMinute = () => pacing.msToNextMinute();

/** Errors worth trying again: not the canister refusing the request itself. */
function isTransient(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return !/must be|Unknown recipient|Send 1 to|too large|not signed in|Unauthorized/i.test(msg);
}

/** Chats that can be pinned at once. */
export const MAX_PINNED = 3;
/** mutedUntil for "always" (the largest Date). */
export const MUTED_ALWAYS = 8_640_000_000_000_000;

/** How a chat is listed: what the chat menu changes. */
export type ChatListPatch = Partial<Pick<RealContact, 'archived' | 'favorite' | 'markedUnread'>> & {
  pinned?: boolean;
  /** Mute for this many ms (Infinity for always); 0 to unmute. */
  muteFor?: number;
  /** Translate into this language; null to stop. */
  translateTo?: string | null;
  /** Colour theme; null for the default. */
  chatTheme?: string | null;
  /** Text size; 'default' to reset. */
  textSize?: 'small' | 'default' | 'large';
};

/** Up to this size files travel in encrypted entries (direct link or mailbox) and arrive even offline. */
export const INLINE_MAX_BYTES = 10 * 1024 * 1024;
/** Raw bytes per chunk: after base64, MLS and the entry's base64 it stays under 64 KB. */
const CHUNK_BYTES = 32 * 1024;
/** Canister limits per deposit_batch call (50 entries, 512 KB), with margin. */
const BATCH_MAX_ENTRIES = 45;
const BATCH_MAX_BYTES = 480 * 1024;

/**
 * Uploads an encrypted stream (OSF1) to the user's Sia space and shares it.
 * `ciphertext` returns a fresh stream of the same bytes each time it is called,
 * so the upload can be retried.
 */
export type SiaUploader = (
  ciphertext: () => ReadableStream<Uint8Array>,
  ciphertextBytes: number,
  onProgress: (fraction: number) => void,
) => Promise<{ seed: string; objectId: string }>;
/** Opens a shared Sia object as a stream of its (encrypted) bytes. */
export type SiaDownloader = (seed: string, objectId: string) => Promise<ReadableStream<Uint8Array>>;

/** An attachment opened for saving or viewing: plaintext as a stream. */
export interface OpenedFile {
  name: string;
  mime: string;
  size: number;
  stream: ReadableStream<Uint8Array>;
}

export interface DirectOptions {
  newPeer(): RtcLike;
  enabled(): boolean;
  /** Tests: how long an entry sent over a link may go unacknowledged. */
  ackTimeoutMs?: number;
  /** Voice and video calls (browsers with WebRTC media). */
  calls?: { newPeer(): CallPeer; getMedia(kind: CallKind): Promise<MediaStream> };
}

/** Fetches an account's sealed (encrypted) friends-only profile. */
export type SealedProfileFetcher = (account: string) => Promise<Uint8Array | null>;

export interface Attachment {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  /** 'inline': sent in encrypted chunks; 'sia': in the sender's Sia space, shared by key. */
  /** inline: entries; p2p: chunks over a direct link (sender's device to receiver's); sia: sender's Sia. */
  via: 'inline' | 'sia' | 'p2p';
  state: 'sending' | 'receiving' | 'ready' | 'remote' | 'failed';
  /** Chunks done / total (inline), or upload progress 0..1 scaled to total = 100 (sia). */
  done: number;
  total: number;
  /** Small preview (data URL) for images and videos. */
  thumb?: string;
  /** Voice message: length and waveform. */
  voice?: VoiceInfo;
  /** Large files: where the OSF1 stream is and its key (iv = 8-byte nonce base). */
  sia?: { seed: string; objectId: string; key: string; iv: string };
  /** Incoming inline file: the chunk indexes received so far. */
  have?: number[];
  /** Kept on this device in this many chunks (large files sent, received or noted). */
  localChunks?: number;
  /** Incoming p2p file: key, chunk count, progress, and the sending device. */
  p2p?: { key: string; iv: string; chunks: number; received: number; fromDevice: string };
  /** A copy the user saved to their own Sia space. */
  backup?: { seed: string; objectId: string; key: string; iv: string };
}

/** A reply's quote of an earlier message. */
export interface ReplyQuote {
  /** The quoted message's ref (see messageRef). */
  ref: string;
  /** Its text, or a short description of its file; '' once it was deleted for everyone. */
  text: string;
  /** We wrote the quoted message. */
  mine: boolean;
  /** In a group: who wrote the quoted message. */
  author?: string;
  /** Deleted for everyone since. */
  deleted?: boolean;
}

/**
 * Version of the key packages this build publishes. 2: the last-resort
 * package lists its LastResort extension in its capabilities (version 1's
 * was rejected by everyone, so once single-use packages ran out nobody could
 * start a channel to that device).
 */
const KEY_PACKAGES_VERSION = 2;

/** How long a friend's device we could not start a channel to is skipped. */
const UNREACHABLE_MS = 10 * 60_000;

/** The longest quote a reply carries. */
const MAX_QUOTE = 200;
const REF = /^[0-9a-f]{16,24}$/;

/**
 * A message's id as both sides know it: what replies, reactions and
 * retractions refer to (its file id, or the sender's message id).
 */
export function messageRef(m: RealMessage): string | undefined {
  return m.attachment?.fileId ?? (m.direction === 'out' ? m.id : m.remoteId);
}

/** What a quote shows of a message: its text, or what kind of file it is. */
export function quoteOf(m: RealMessage): string {
  if (m.body) return m.body.slice(0, MAX_QUOTE);
  const a = m.attachment;
  if (!a) return '';
  if (a.voice) return 'Voice message';
  if (a.mime.startsWith('image/')) return 'Photo';
  if (a.mime.startsWith('video/')) return 'Video';
  return a.name.slice(0, MAX_QUOTE);
}

/** An emoji reaction: a short string with a pictograph in it. */
function validEmoji(e: unknown): e is string {
  return typeof e === 'string' && e.length > 0 && e.length <= 16 && /\p{Extended_Pictographic}/u.test(e);
}

/** Asking friends for a profile key we lack: how often we look, and per friend. */
const KEYS_CHECK_MS = 5 * 60_000;
const KEY_ASK_MS = 30 * 60_000;
/** Answering a device that asks for our profile key: at most this often. */
const KEY_ANSWER_MS = 10 * 60_000;
/** How long after sending a text can still be changed. */
export const EDIT_WINDOW_MS = 24 * 3_600_000;

/** Whether we can still change this message's text. */
export function canEdit(m: RealMessage, now = Date.now()): boolean {
  return m.direction === 'out' && !m.deleted && !m.call && !m.attachment && !!m.body && now - m.sentAt < EDIT_WINDOW_MS;
}

/** Different reactions one person may put on one message. */
const MAX_REACTIONS = 12;

/** One side's reactions with `emoji` added or taken back; undefined when none are left. */
function toggled(list: string[] | undefined, emoji: string, on: boolean): string[] | undefined {
  const rest = (list ?? []).filter((e) => e !== emoji);
  const next = on ? [...rest, emoji].slice(-MAX_REACTIONS) : rest;
  return next.length ? next : undefined;
}

/** A message's reactions with one side's list replaced (dropped when both are empty). */
function withReactions(m: RealMessage, side: 'me' | 'them', list: string[] | undefined) {
  const r = { ...m.reactions };
  if (list) r[side] = list;
  else delete r[side];
  if (r.me || r.them) m.reactions = r;
  else delete m.reactions;
}

export interface RealMessage {
  id: string;
  direction: 'out' | 'in';
  body: string;
  attachment?: Attachment;
  /** An event invite: the event's id (the card shows the event's current state). */
  eventId?: string;
  sentAt: number;
  /** out: 'sent' once deposited for every device; in: always 'delivered'. */
  /** Outgoing: sending, sent (left this device), delivered (on a device of theirs), read, or failed. */
  status: 'sending' | 'sent' | 'failed' | 'delivered' | 'read';
  /** Incoming: the sender's time when it was later than ours (sentAt is capped at arrival). */
  remoteSentAt?: number;
  /** A call, logged in the chat (no text). */
  call?: CallLog;
  /** Incoming: the sender's id for this message (what a retraction refers to). */
  remoteId?: string;
  /** Deleted for everyone: only a placeholder remains (no text, no file). */
  deleted?: boolean;
  /** Highlighted (starred) in this chat, on this device, to find again (when). */
  highlightedAt?: number;
  /** The message this one replies to, quoted. */
  replyTo?: ReplyQuote;
  /** A preview card for the first link in the text (fetched by the sender). */
  linkPreview?: LinkPreview;
  /** When its text was last changed by its sender. */
  edited?: number;
  /** Each side's reactions (emoji, in the order added; each at most once). */
  reactions?: { me?: string[]; them?: string[] };
  verified: boolean;
  /** Chain gap detected before this message (earlier entries missing). */
  gap?: boolean;
  /** In a group: who sent it (incoming). */
  from?: string;
  /** In a group: a change to the group, shown as a line in the chat (no text, no sender bubble). */
  notice?: GroupNotice;
  /** In a group: each member's reactions (`reactions.them` holds them all together). */
  memberReactions?: Record<string, string[]>;
}

interface ChainState {
  seq: number;
  hash: string;
}

interface State {
  contacts: Record<string, RealContact>;
  messages: Record<string, RealMessage[]>;
  /** "conv:device" -> last sent entry (per recipient device). */
  sendChains: Record<string, ChainState>;
  /** "account:device" -> last received entry. */
  recvChains: Record<string, ChainState>;
  cursor: string;
  /** Exported OpenMLS state of this device (base64). */
  mls?: string;
  /** Key packages published at least once. */
  /** The key-package format last published (KEY_PACKAGES_VERSION); a newer one republishes all. */
  keyPackagesPublished?: number;
  /** Version of our profile key last sent to our other devices. */
  ownKeySent?: number;
  /** When we last asked each friend for their profile key (we have none yet). */
  keyAsked?: Record<string, number>;
  /** Large files waiting to be fetched over direct links, by fileId. */
  outgoing?: Record<string, OutgoingFile>;
  /** Remote devices ("account.device") that asked for a new MLS channel from us. */
  resetOutbound?: string[];
  /** Send read receipts (default on). Off also hides others' read state (as delivered). */
  readReceipts?: boolean;
  /** Ids (message or file) friends retracted: parts arriving later are dropped. Most recent 500. */
  retracted?: string[];
  /** Events we organize or were invited to, by id. */
  events?: Record<string, ZEvent>;
  /** This device's reminder per event (minutes before; local only). */
  eventReminders?: Record<string, Reminder>;
  /** Group chats, by group id. */
  groups?: Record<string, GroupRecord>;
}

interface OutgoingFile {
  account: string;
  chunks: number;
  key: string;
  iv: string;
  /** Recipient devices at send time, and those that have the whole file. */
  devices: string[];
  done: string[];
}

/** One entry for one recipient device, ready for the mailbox. */
type OutItem = {
  to: { account: string; deviceId: string };
  entry: Uint8Array;
  ephemeral?: boolean;
  chainKey: string;
  chain: ChainState;
  payloadIndex: number;
};

const empty = (): State => ({ contacts: {}, messages: {}, sendChains: {}, recvChains: {}, cursor: '0' });


/**
 * Inserts an incoming message by when it was sent, so a message that arrives
 * late shows where it belongs, not after replies written in the meantime.
 * The sender's clock is trusted only up to now: a time in the future is
 * treated as "just now".
 */
function insertBySentAt(list: RealMessage[], m: RealMessage): void {
  if (m.sentAt > Date.now()) m.remoteSentAt = m.sentAt; // receipts refer to the sender's own time
  m.sentAt = Math.min(m.sentAt, Date.now());
  let i = list.length;
  while (i > 0 && list[i - 1]!.sentAt > m.sentAt) i--;
  list.splice(i, 0, m);
}

export class RealMessaging {
  private device!: StoredDevice;
  private state: State = empty();
  private listeners = new Set<() => void>();
  private polling = false;
  private devicesCache = new Map<string, { at: number; list: PublishedDevice[] }>();
  /** Our profile key and version, shared with friends. */
  private myKey: { key: string; version: number } | null = null;
  private mls!: MlsDevice;
  /** OpenMLS operations run one at a time (its state is shared). */
  private mlsQueue: Promise<unknown> = Promise.resolve();
  private welcomesSinceCheck = 0;
  /**
   * Sends run one at a time: each one reads and advances the per-device entry
   * chain (sequence number, previous hash) and must deposit in that order.
   */
  private sendQueue: Promise<unknown> = Promise.resolve();
  /** Receiving (mailbox and direct links) is serialized too. */
  private recvQueue: Promise<unknown> = Promise.resolve();
  private links: DirectLinks | null = null;
  /** When each friend was last seen active (an entry arrived from them), in this session. */
  private lastSeen = new Map<string, number>();
  /** Devices we could not start a channel to ("account.device" -> retry after). */
  private unreachable = new Map<string, number>();
  /** When we last answered a friend's device asking for our profile key. */
  private keyAnswered = new Map<string, number>();
  /** Friends' devices that asked for our profile key before it was loaded. */
  private keyRequests = new Map<string, { account: string; device: string }>();
  private keysCheckedAt = 0;

  constructor(
    readonly account: string,
    private readonly directory: DeviceDirectory,
    private readonly delivery: OfflineDelivery,
    private readonly store: LocalStore,
    private readonly deviceLabel = 'Browser',
    private readonly direct?: DirectOptions,
    private readonly fetchSealed?: SealedProfileFetcher,
    /** Group chat streams in the inbox shards (absent: no group chats). */
    private readonly groupNet?: GroupTransport,
  ) {}

  private serialRecv<T>(f: () => Promise<T>): Promise<T> {
    const run = this.recvQueue.then(f, f);
    this.recvQueue = run.catch(() => undefined);
    return run;
  }

  /** Voice and video calls, when the browser supports them. */
  calls: Calls | null = null;

  private setupCalls() {
    const media = this.direct?.calls;
    if (!media || this.calls) return;
    this.calls = new Calls({
      myDevice: this.device.deviceId,
      send: (account, signal, toDevice) => this.deliverMany(account, [signal], Date.now(), false, undefined, toDevice),
      newPeer: () => media.newPeer(),
      getMedia: (kind) => media.getMedia(kind),
      isFriend: (account) => {
        const c = this.state.contacts[account];
        return !!c?.known && !c.blocked && account !== this.account;
      },
      log: (account, direction, entry, at) => {
        insertBySentAt((this.state.messages[account] ??= []), {
          id: toHex(randomBytes(8)),
          direction,
          body: '',
          sentAt: at,
          status: direction === 'out' ? 'sent' : 'delivered',
          verified: true,
          call: entry,
        });
        void this.persist();
      },
      onChange: () => this.emit(),
    });
  }

  private setupDirect() {
    this.setupCalls();
    if (!this.direct || this.links) return;
    const d = this.direct;
    this.links = new DirectLinks({
      myAddress: this.address(this.account, this.device.deviceId),
      myDeviceId: this.device.deviceId,
      newPeer: () => d.newPeer(),
      enabled: () => d.enabled(),
      ...(d.ackTimeoutMs ? { ackTimeoutMs: d.ackTimeoutMs } : {}),
      onChange: () => this.emit(),
      sendSignal: (account, payload) => this.deliver(account, payload, Date.now(), true),
      lastReceived: (account, deviceId) => this.state.recvChains[`${account}:${deviceId}`]?.seq ?? 0,
      onEntry: (account, deviceId, bytes) =>
        this.serialRecv(async () => {
          const added = await this.acceptEntry(account, bytes, deviceId);
          await this.persist();
          void added;
          return this.state.recvChains[`${account}:${deviceId}`]?.seq ?? null;
        }),
      onLinkOpen: (account, deviceId) => this.requestMissing(account, deviceId),
      onFileControl: (account, deviceId, msg) => {
        if (msg.t === 'file-want') void this.serveFile(account, deviceId, msg.fileId, msg.from);
        else void this.fileDelivered(account, deviceId, msg.fileId);
      },
      onFilePart: (account, deviceId, part) => void this.receivePart(account, deviceId, part),
      onFallback: (account, deviceId, entries) => {
        void this.delivery
          .depositMany?.(entries.map((e) => ({ to: { account, deviceId }, entry: e.bytes })))
          .catch((e) => console.warn('OpenSocial: mailbox fallback failed:', e));
      },
    });
  }

  /** Direct-link status to an account, for the UI. */
  linkStatus(account: string): LinkStatus {
    return this.links?.status(account) ?? 'none';
  }

  /** The friend sent something in the last 2 minutes (they are probably online). */
  isActive(account: string): boolean {
    return this.seenRecently(account);
  }

  /**
   * Online, judged peer to peer: a direct link to one of their devices is
   * open, or they sent something in the last 2 minutes.
   */
  isOnline(account: string): boolean {
    return this.isDirect(account) || this.isActive(account);
  }

  /** True when a direct link to one of the account's devices is open. */
  isDirect(account: string): boolean {
    return this.links?.isDirect(account) ?? false;
  }

  /**
   * Offers direct links to the account's devices. 'startup' and 'resume' (we
   * just came back) always offer; 'chat', 'accept' and 'activity' only if the
   * friend was active in the last 2 minutes, so a friend who is offline or
   * whose phone is locked gets no offers: they offer when they come back.
   */
  async warm(account: string, reason: ConnectReason = 'chat'): Promise<void> {
    if (!this.links || !this.direct?.enabled()) return;
    const c = this.state.contacts[account];
    if (!c || !c.known || c.blocked || c.group) return; // direct links only with friends
    // Typing is a strong sign a message is coming: a friend active in the last
    // 10 minutes is worth a link now, so it's ready when the message is sent.
    const recent = reason === 'typing' ? this.seenWithin(account, 10 * 60_000) : this.seenRecently(account);
    if (reason !== 'startup' && reason !== 'resume' && !recent) return;
    for (const d of await this.devicesOf(account)) void this.links.connect(account, d.deviceId, reason);
  }

  /** Offers for direct links in the last hour to one device (diagnostics). */
  offersLastHour(account: string, deviceId: string): number {
    return this.links?.offersLastHour(account, deviceId) ?? 0;
  }

  private seenRecently(account: string) {
    return this.seenWithin(account, 120_000);
  }

  private seenWithin(account: string, ms: number) {
    return Date.now() - (this.lastSeen.get(account) ?? 0) < ms;
  }

  /** When we start or come back: one offer each to up to 5 friends active in the last 7 days. */
  async warmRecent(reason: ConnectReason = 'startup'): Promise<void> {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const recent = this.contacts()
      .filter((c) => c.known && (this.state.messages[c.account]?.at(-1)?.sentAt ?? 0) > weekAgo)
      .slice(0, 5);
    for (const c of recent) await this.warm(c.account, reason).catch(() => undefined);
  }

  /** Closes all direct links (e.g. when the setting is turned off). */
  closeDirect() {
    this.links?.closeAll();
  }

  /** Loads or creates this device's keys, publishes them, and loads local state. */
  async init(): Promise<void> {
    const existing = await this.store.loadDevice(this.account);
    if (existing) {
      this.device = existing;
    } else {
      this.device = { deviceId: toHex(randomBytes(12)), identity: await createIdentity() };
      await this.store.saveDevice(this.account, this.device);
    }
    await this.directory.register({
      deviceId: this.device.deviceId,
      encryptionKey: this.device.identity.publicIdentity.encryptionKey,
      signingKey: this.device.identity.publicIdentity.signingKey,
      label: this.deviceLabel,
    });
    this.state = (await this.store.getJson<State>(this.key())) ?? empty();
    // Reactions stored as one emoji per side (first format): lists now.
    for (const list of Object.values(this.state.messages)) {
      for (const m of list) {
        // Pinned messages (earlier builds) are highlighted ones now.
        const old = m as RealMessage & { pinnedAt?: number };
        if (old.pinnedAt) old.highlightedAt ??= old.pinnedAt;
        delete old.pinnedAt;
        const r = m.reactions as { me?: unknown; them?: unknown } | undefined;
        if (!r) continue;
        const asList = (v: unknown) => (typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : undefined);
        m.reactions = { ...(asList(r.me) ? { me: asList(r.me) } : {}), ...(asList(r.them) ? { them: asList(r.them) } : {}) };
      }
    }
    // Our own account is never a contact (earlier builds could add it when
    // another of our devices wrote to us); "Myself" is the notes chat.
    delete this.state.contacts[this.account];
    // Profiles stored by any earlier build: always read through the normalizer.
    for (const c of Object.values(this.state.contacts)) {
      if (c.profile) c.profile = normalizeProfile(c.profile);
    }
    const lib = await loadMls();
    this.mls = this.state.mls
      ? lib.MlsDevice.restore(fromBase64(this.state.mls))
      : lib.MlsDevice.create(this.address(this.account, this.device.deviceId));
    if (this.state.keyPackagesPublished !== KEY_PACKAGES_VERSION) {
      await this.publishKeyPackages(true);
    } else {
      await this.saveMls();
      void this.withMls(() => this.topUpKeyPackages()).catch(() => undefined);
    }
    await this.refreshFingerprint();
    this.setupDirect();
    this.emit();
  }

  private address(account: string, deviceId: string) {
    return `${account}.${deviceId}`;
  }

  private withMls<T>(f: () => Promise<T>): Promise<T> {
    const run = this.mlsQueue.then(f, f);
    this.mlsQueue = run.catch(() => undefined);
    return run;
  }

  private withMlsDevice<T>(f: (m: MlsDevice) => Promise<T>): Promise<T> {
    return this.withMls(() => f(this.mls));
  }

  private async saveMls() {
    this.state.mls = toBase64(this.mls.exportState());
    await this.store.setJson(this.key(), this.state);
  }

  /** Publishes single-use key packages; with `withLastResort`, also a new last-resort one. */
  private async publishKeyPackages(withLastResort: boolean) {
    const single = (this.mls.keyPackages(KEY_PACKAGE_BATCH, false) as Uint8Array[]).map((k) => new Uint8Array(k));
    const last = withLastResort ? new Uint8Array((this.mls.keyPackages(0, true) as Uint8Array[])[0]!) : null;
    await this.saveMls();
    await this.directory.publishKeyPackages(this.device.deviceId, last, single);
    this.state.keyPackagesPublished = KEY_PACKAGES_VERSION;
    await this.saveMls();
  }

  /** Adds key packages when fewer than KEY_PACKAGE_LOW remain; republishes all if none are there. */
  private async topUpKeyPackages() {
    let left: number;
    try {
      left = await this.directory.publishKeyPackages(this.device.deviceId, null, []);
    } catch {
      await this.publishKeyPackages(true);
      return;
    }
    if (left < KEY_PACKAGE_LOW) await this.publishKeyPackages(false);
  }

  private key() {
    return `messaging:${this.account}`;
  }

  private async persist() {
    await this.store.setJson(this.key(), this.state);
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  get deviceId(): string {
    return this.device.deviceId;
  }

  /** Safety number of this device's MLS signature key. */
  myFingerprint = '';
  async refreshFingerprint() {
    this.myFingerprint = await keyFingerprint(this.mls.signatureKey());
  }

  private static shortId(account: string) {
    return `${account.slice(0, 5)}…${account.slice(-3)}`;
  }

  private refreshName(c: RealContact) {
    c.name = c.deleted
      ? 'Deleted account'
      : c.nickname?.trim() || c.profile?.displayName || RealMessaging.shortId(c.account);
  }

  /** Called when another device of ours sends our profile key (a new device restoring its profile). */
  onOwnProfileKey?: (k: { key: string; version: number }) => void;

  /**
   * A new device asks our other devices for the profile key (the profile
   * itself is sealed on the canister). They answer when they are online.
   */
  async requestOwnProfileKey(): Promise<void> {
    const others = (await this.devicesOf(this.account, true)).filter((d) => d.deviceId !== this.device.deviceId);
    if (others.length === 0) return;
    await this.deliver(this.account, { t: 'profile-key-request' }, Date.now());
  }

  /**
   * Friends' profile keys reach the devices we had when they sent them. A
   * device added later (or the app opened at a new address) has none: ask
   * those friends for theirs (each at most every 6 hours). The app calls this
   * when it starts and every few minutes; checks closer together are skipped.
   */
  async requestMissingProfileKeys(now = Date.now()): Promise<void> {
    if (now - this.keysCheckedAt < KEYS_CHECK_MS) return;
    this.keysCheckedAt = now;
    const asked = (this.state.keyAsked ??= {});
    for (const c of Object.values(this.state.contacts)) {
      if (!c.known || c.blocked || c.deleted || c.profileKey || c.account === this.account) continue;
      if (now - (asked[c.account] ?? 0) < KEY_ASK_MS) continue;
      asked[c.account] = now;
      await this.deliver(c.account, { t: 'profile-key-request' }, now).catch(() => undefined);
    }
    await this.persist();
  }

  /**
   * Sends our profile key to one device of a friend that asked for it (at most
   * every few minutes per device). Asked before our key is loaded, the answer
   * waits until it is.
   */
  private answerKeyRequest(account: string, device: string) {
    const remote = this.address(account, device);
    if (!this.myKey) {
      this.keyRequests.set(remote, { account, device });
      return;
    }
    if (Date.now() - (this.keyAnswered.get(remote) ?? 0) <= KEY_ANSWER_MS) return;
    this.keyAnswered.set(remote, Date.now());
    void this.deliverMany(account, [{ t: 'profile-key', ...this.myKey }], Date.now(), false, undefined, device).catch(
      () => undefined,
    );
  }

  /** Our profile key (shared with friends) after the sealed profile was saved. */
  async setMyProfileKey(k: { key: string; version: number } | null, fromOwnDevice = false): Promise<void> {
    this.myKey = k;
    if (k) {
      const waiting = [...this.keyRequests.values()];
      this.keyRequests.clear();
      for (const r of waiting) this.answerKeyRequest(r.account, r.device);
    }
    // A key that came from another of our devices needn't go back to them.
    if (k && fromOwnDevice) this.state.ownKeySent = k.version;
    await this.shareKeyWithOwnDevices();
    await this.shareKeyWithFriends();
  }

  /**
   * Sends our profile key to our other devices when it changed (a save
   * here), so they open the new profile from the canister and show it too.
   */
  private async shareKeyWithOwnDevices(): Promise<void> {
    if (!this.myKey || this.state.ownKeySent === this.myKey.version) return;
    const others = (await this.devicesOf(this.account, true).catch(() => [])).filter((d) => d.deviceId !== this.device.deviceId);
    if (others.length > 0) {
      await this.deliver(this.account, { t: 'profile-key', ...this.myKey }, Date.now()).catch(() => undefined);
    }
    this.state.ownKeySent = this.myKey.version;
    await this.persist();
  }

  /** Sends our profile key to every accepted, unblocked contact that has an older one. */
  async shareKeyWithFriends(): Promise<void> {
    if (!this.myKey) return;
    for (const c of Object.values(this.state.contacts)) {
      if (c.known && !c.blocked && !c.deleted && c.keySent !== this.myKey.version) {
        await this.sendKey(c.account).catch(() => undefined);
      }
    }
  }

  private async sendKey(account: string) {
    if (!this.myKey) return;
    await this.deliver(account, { t: 'profile-key', ...this.myKey }, Date.now());
    const c = this.state.contacts[account];
    if (c) c.keySent = this.myKey.version;
    await this.persist();
  }

  /** Fetches and decrypts a friend's sealed profile with the key they shared. */
  async refreshProfile(account: string): Promise<void> {
    const c = this.state.contacts[account];
    if (!c?.profileKey || !this.fetchSealed) return;
    const blob = await this.fetchSealed(account);
    if (!blob) return;
    c.profile = await openProfile(blob, c.profileKey.key);
    this.refreshName(c);
    await this.persist();
  }

  /** Refreshes the profiles of all friends who shared a key (on start). */
  async refreshProfiles(): Promise<void> {
    for (const c of Object.values(this.state.contacts)) {
      if (c.profileKey && !c.blocked && !c.deleted) await this.refreshProfile(c.account).catch(() => undefined);
    }
  }

  /** Before deleting our account: tell every friend, so their apps drop our profile. */
  async notifyAccountDeleted(): Promise<void> {
    for (const c of Object.values(this.state.contacts)) {
      if (c.known && !c.blocked && !c.deleted && !c.group) {
        await this.deliver(c.account, { t: 'account-deleted' }, Date.now(), true).catch(() => undefined);
      }
    }
  }

  private incoming(account: string): number {
    return (this.state.messages[account] ?? []).filter((m) => m.direction === 'in' && !m.notice).length;
  }

  /**
   * Chats for a backup (to the user's own Sia space): contacts and messages,
   * including notes to self. Attachments keep their details, not their bytes.
   * No keys: a restored device makes its own.
   */
  exportBackup(): Uint8Array {
    const contacts = Object.values(this.state.contacts)
      .filter((c) => !c.group)
      .map((c) => ({
      account: c.account,
      nickname: c.nickname,
      known: c.known,
      blocked: c.blocked,
      addedAt: c.addedAt,
    }));
    const groups = Object.values(this.state.groups ?? {}).map((r) => ({ state: r.state, names: r.names, left: !!r.left }));
    return utf8(JSON.stringify({ format: 'open-social-chats', v: 1, contacts, groups, messages: this.state.messages }));
  }

  /** Restores a backup: adds contacts and messages that aren't here yet. Returns the messages added. */
  async importBackup(bytes: Uint8Array): Promise<number> {
    const data = JSON.parse(fromUtf8(bytes)) as {
      format?: string;
      contacts?: { account: string; nickname?: string; known?: boolean; blocked?: boolean; addedAt?: number }[];
      groups?: { state?: unknown; names?: unknown; left?: unknown }[];
      messages?: Record<string, RealMessage[]>;
    };
    if (data.format !== 'open-social-chats') throw new OpenSocialError('BACKUP_FORMAT', 'This is not an OpenSocial chat backup.');
    for (const g of data.groups ?? []) {
      const state = sanitizeGroup(g?.state);
      if (!state || this.state.groups?.[state.id]) continue;
      // Only the chat comes back: the group's keys stay on the devices that are in it.
      (this.state.groups ??= {})[state.id] = { state, names: {}, shard: '', cursor: 0, left: true };
      this.state.contacts[groupKey(state.id)] = {
        account: groupKey(state.id),
        name: state.name,
        addedAt: Date.now(),
        known: true,
        group: true,
        ...(state.photo ? { photo: state.photo } : {}),
      };
    }
    for (const c of data.contacts ?? []) {
      if (typeof c.account !== 'string' || isGroupKey(c.account) || this.state.contacts[c.account]) continue;
      const contact: RealContact = {
        account: c.account,
        name: RealMessaging.shortId(c.account),
        addedAt: c.addedAt ?? Date.now(),
        known: !!c.known,
        ...(c.nickname ? { nickname: String(c.nickname).slice(0, 60) } : {}),
        ...(c.blocked ? { blocked: true } : {}),
      };
      this.refreshName(contact);
      this.state.contacts[c.account] = contact;
    }
    let added = 0;
    for (const [account, list] of Object.entries(data.messages ?? {})) {
      if (!Array.isArray(list)) continue;
      const mine = (this.state.messages[account] ??= []);
      const have = new Set(mine.map((m) => m.id));
      for (const m of list) {
        if (!m || typeof m.id !== 'string' || have.has(m.id) || typeof m.sentAt !== 'number') continue;
        if (m.direction !== 'in' && m.direction !== 'out') continue;
        // Restored files show their details; the bytes are not part of the backup.
        const attachment = m.attachment ? { ...m.attachment, state: 'failed' as const, localChunks: undefined } : undefined;
        mine.push({
          id: m.id,
          direction: m.direction,
          body: typeof m.body === 'string' ? m.body : '',
          sentAt: m.sentAt,
          status: m.direction === 'out' ? 'sent' : 'delivered',
          verified: !!m.verified,
          ...(attachment && (attachment.sia || attachment.backup) ? { attachment: { ...attachment, state: 'remote' as const } } : attachment ? { attachment } : {}),
          ...(isGroupKey(account) && typeof m.from === 'string' ? { from: m.from } : {}),
          ...(isGroupKey(account) && m.notice && typeof m.notice === 'object' ? { notice: m.notice } : {}),
        });
        added++;
      }
      mine.sort((x, y) => x.sentAt - y.sentAt);
    }
    await this.persist();
    return added;
  }

  /** Last repair request per remote device (at most one per 10 minutes). */
  private repairAsked = new Map<string, number>();

  /**
   * Receiver: a friend's device sent something this device can't decrypt.
   * Ask that device (through our own, working channel to it) to start a new
   * channel and re-send what it sent since then.
   */
  private requestRepair(account: string, deviceId: string, since: number) {
    const remote = this.address(account, deviceId);
    const last = this.repairAsked.get(remote) ?? 0;
    if (Date.now() - last < 10 * 60_000) return;
    this.repairAsked.set(remote, Date.now());
    const c = this.state.contacts[account];
    if (c) c.repaired = (c.repaired ?? 0) + 1;
    void this.deliverMany(account, [{ t: 'mls-reset', to: deviceId, from: this.device.deviceId, since }], Date.now(), false, undefined, deviceId)
      .catch((e) => console.warn('OpenSocial: could not ask for a channel repair:', e));
  }

  /**
   * Sender: a friend's device lost our channel. Start a new one on the next
   * send, and re-send our text messages to that device since `since`.
   */
  private async repairChannel(account: string, deviceId: string, since: number) {
    const remote = this.address(account, deviceId);
    const pending = (this.state.resetOutbound ??= []);
    if (!pending.includes(remote)) pending.push(remote);
    await this.persist();
    const resend = (this.state.messages[account] ?? [])
      .filter((m) => m.direction === 'out' && (m.body || m.eventId) && m.sentAt >= since)
      .slice(-200);
    for (const m of resend) {
      await this.deliverMany(account, [this.payloadOf(m)], m.sentAt, false, undefined, deviceId).catch(() => undefined);
    }
    if (resend.length === 0) {
      // Nothing to re-send: still open the new channel now (a short note-free hello).
      if (this.myKey) await this.deliverMany(account, [{ t: 'profile-key', ...this.myKey }], Date.now(), false, undefined, deviceId).catch(() => undefined);
    }
  }

  /** Messages from this contact not read yet (kept with the chats, so it survives reloads). */
  unreadCount(account: string): number {
    return Math.max(0, this.incoming(account) - (this.state.contacts[account]?.readIn ?? 0));
  }

  /** Marks everything received from this contact as read. */
  async markRead(account: string): Promise<void> {
    const c = this.state.contacts[account];
    if (!c) return;
    const n = this.incoming(account);
    if (c.readIn !== n || c.markedUnread) {
      c.readIn = n;
      c.markedUnread = false;
      await this.persist();
    }
    if (this.readReceipts) this.sendReceipt(account, 'read');
  }

  /* --------------------------------------------------------- receipts --- */

  get readReceipts(): boolean {
    return this.state.readReceipts !== false;
  }

  /** Turns read receipts on or off. Off: none are sent, and friends' read state shows as delivered. */
  async setReadReceipts(on: boolean): Promise<void> {
    this.state.readReceipts = on;
    await this.persist();
    this.emit();
  }

  private receiptTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Their latest message here, by their send time. */
  private latestIncoming(account: string): number {
    let latest = 0;
    for (const m of this.state.messages[account] ?? []) {
      if (m.direction === 'in') latest = Math.max(latest, m.remoteSentAt ?? m.sentAt);
    }
    return latest;
  }

  /**
   * Confirms to a friend that their messages up to now were delivered (soon
   * after they arrive, one receipt for a burst) or read (when the chat is
   * open). Only to accepted contacts, never to ourselves; each receipt covers
   * every earlier message, and a receipt already sent isn't repeated.
   */
  private sendReceipt(account: string, kind: 'delivered' | 'read') {
    const c = this.state.contacts[account];
    if (!c?.known || c.blocked || c.group || account === this.account) return;
    const send = () => {
      this.receiptTimers.delete(`${kind}:${account}`);
      const upTo = this.latestIncoming(account);
      const done = kind === 'read' ? c.receiptRead ?? 0 : Math.max(c.receiptDelivered ?? 0, c.receiptRead ?? 0);
      if (!upTo || upTo <= done) return;
      if (kind === 'read') c.receiptRead = upTo;
      else c.receiptDelivered = upTo;
      void this.deliver(account, { t: 'receipt', kind, upTo }, Date.now()).catch((e) =>
        console.warn('OpenSocial: receipt not sent:', e),
      );
    };
    const key = `${kind}:${account}`;
    clearTimeout(this.receiptTimers.get(key));
    this.receiptTimers.set(key, setTimeout(send, kind === 'read' ? 300 : 800));
  }

  /** A friend's receipt: mark our messages to them up to that time. */
  private applyReceipt(account: string, kind: 'delivered' | 'read', upTo: number) {
    for (const m of this.state.messages[account] ?? []) {
      if (m.direction !== 'out' || m.sentAt > upTo) continue;
      if (kind === 'read' && (m.status === 'sent' || m.status === 'delivered')) m.status = 'read';
      else if (kind === 'delivered' && m.status === 'sent') m.status = 'delivered';
    }
  }

  /** Accepts a message request: the sender becomes a friend and gets our profile key. */
  async accept(account: string): Promise<void> {
    const c = this.state.contacts[account];
    if (!c) return;
    if (c.group) return this.joinGroup(groupIdOf(account)!);
    c.known = true;
    c.blocked = false;
    await this.persist();
    await this.sendKey(account).catch((e) => console.warn('OpenSocial: profile key not sent:', e));
    void this.warm(account, 'accept');
  }

  /** Blocks an account: hidden, and its future messages are dropped unread. */
  async block(account: string): Promise<void> {
    const c = this.state.contacts[account] ?? {
      account,
      name: RealMessaging.shortId(account),
      addedAt: Date.now(),
      known: false,
    };
    c.blocked = true;
    c.known = false;
    this.state.contacts[account] = c;
    await this.persist();
  }

  async unblock(account: string): Promise<void> {
    const c = this.state.contacts[account];
    if (c) {
      c.blocked = false;
      await this.persist();
    }
  }

  /**
   * Removes someone from the address book: the chat, its files and the
   * contact are deleted from this device. If they write again, they show up
   * as a new request.
   */
  async removeContact(account: string): Promise<void> {
    if (account === this.account || !this.state.contacts[account]) return;
    if (isGroupKey(account)) return this.deleteGroup(groupIdOf(account)!);
    await this.clearChat(account);
    delete this.state.contacts[account];
    delete this.state.messages[account];
    await this.persist();
  }

  /** People blocked on this device, by name. */
  blockedContacts(): RealContact[] {
    return Object.values(this.state.contacts)
      .filter((c) => c.blocked)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  async setNickname(account: string, nickname: string): Promise<void> {
    const c = this.state.contacts[account];
    if (!c) return;
    c.nickname = nickname.trim() || undefined;
    this.refreshName(c);
    await this.persist();
  }

  contact(account: string): RealContact | undefined {
    return this.state.contacts[account];
  }

  /** Listed chats: pinned first (latest pinned first), then by latest message. Archived ones included. */
  contacts(): RealContact[] {
    return Object.values(this.state.contacts)
      .filter((c) => !c.blocked && !c.hidden && c.account !== this.account)
      .sort((a, b) => {
        if ((a.pinnedAt ?? 0) !== (b.pinnedAt ?? 0)) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
        const la = this.state.messages[a.account]?.at(-1)?.sentAt ?? a.addedAt;
        const lb = this.state.messages[b.account]?.at(-1)?.sentAt ?? b.addedAt;
        return lb - la;
      });
  }

  /**
   * Everyone in the address book (friends and pending requests, not blocked),
   * by name. Includes chats that were archived or deleted: deleting a chat
   * doesn't remove the friend.
   */
  addressBook(): RealContact[] {
    return Object.values(this.state.contacts)
      .filter((c) => !c.blocked && !c.group && c.account !== this.account)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /* ------------------------------------------------- chat list settings --- */

  /** Archive, pin, mute, favourite, translate or mark unread (stored on this device only). */
  async updateChat(account: string, patch: ChatListPatch): Promise<void> {
    const c = this.state.contacts[account];
    if (!c) return;
    if (patch.pinned === true && !c.pinnedAt) {
      const pinned = Object.values(this.state.contacts).filter((x) => x.pinnedAt && !x.hidden && !x.blocked).length;
      if (pinned >= MAX_PINNED) throw new OpenSocialError('PIN_LIMIT', `You can pin up to ${MAX_PINNED} chats.`);
      c.pinnedAt = Date.now();
    } else if (patch.pinned === false) delete c.pinnedAt;
    if (patch.archived !== undefined) {
      c.archived = patch.archived;
      if (patch.archived) delete c.pinnedAt; // archived chats aren't pinned
    }
    if (patch.favorite !== undefined) c.favorite = patch.favorite;
    if (patch.translateTo === null) delete c.translateTo;
    else if (patch.translateTo !== undefined) c.translateTo = patch.translateTo;
    if (patch.chatTheme === null) delete c.chatTheme;
    else if (patch.chatTheme !== undefined) c.chatTheme = patch.chatTheme;
    if (patch.textSize === 'default') delete c.textSize;
    else if (patch.textSize !== undefined) c.textSize = patch.textSize;
    if (patch.markedUnread !== undefined) c.markedUnread = patch.markedUnread;
    if (patch.muteFor !== undefined) {
      if (patch.muteFor === 0) delete c.mutedUntil;
      else c.mutedUntil = patch.muteFor === Infinity ? MUTED_ALWAYS : Date.now() + patch.muteFor;
    }
    await this.persist();
  }

  isMuted(account: string): boolean {
    return (this.state.contacts[account]?.mutedUntil ?? 0) > Date.now();
  }

  /** Deletes the chat's messages and their files from this device; the chat stays listed. */
  async clearChat(account: string): Promise<void> {
    for (const m of this.state.messages[account] ?? []) {
      if (m.attachment) await this.store.deleteBytes(this.fileKey(m.attachment.fileId));
    }
    for (const [id, out] of Object.entries(this.state.outgoing ?? {})) {
      if (out.account === account) delete this.state.outgoing![id];
    }
    this.state.messages[account] = [];
    const c = this.state.contacts[account];
    if (c) {
      c.readIn = 0;
      c.markedUnread = false;
    }
    await this.persist();
  }

  /** Clears the chat and removes it from the list until they write again or it is opened anew. */
  async deleteChat(account: string): Promise<void> {
    await this.clearChat(account);
    const c = this.state.contacts[account];
    if (c && account !== this.account) {
      c.hidden = true;
      c.archived = false;
      delete c.pinnedAt;
      c.favorite = false;
      delete c.translateTo;
      delete c.chatTheme;
      delete c.textSize;
    }
    await this.persist();
  }

  messages(account: string): RealMessage[] {
    return this.state.messages[account] ?? [];
  }

  private async devicesOf(account: string, fresh = false): Promise<PublishedDevice[]> {
    const c = this.devicesCache.get(account);
    if (!fresh && c && Date.now() - c.at < 60_000) return c.list;
    const list = await this.directory.devicesOf(account);
    this.devicesCache.set(account, { at: Date.now(), list });
    return list;
  }

  /** Safety number of a contact's first device we share an MLS group with. */
  async contactFingerprint(account: string): Promise<string | null> {
    if (isGroupKey(account)) return null;
    for (const d of await this.devicesOf(account)) {
      const key = this.mls.remoteSignatureKey(this.address(account, d.deviceId));
      if (key) return keyFingerprint(key);
    }
    return null;
  }

  async addContact(account: string, name?: string): Promise<RealContact> {
    const acct = account.trim();
    if (acct === this.account) throw new OpenSocialError('CONTACT_SELF', 'That is your own OpenSocial ID.');
    let devices: PublishedDevice[];
    try {
      devices = await this.devicesOf(acct, true);
    } catch {
      throw new OpenSocialError('CONTACT_INVALID', 'That is not a valid OpenSocial ID.');
    }
    if (devices.length === 0) {
      throw new OpenSocialError(
        'CONTACT_UNKNOWN',
        'No OpenSocial account with this ID has signed in yet. Ask them to open OpenSocial first.',
      );
    }
    const existing = this.state.contacts[acct];
    const contact: RealContact = {
      ...existing,
      account: acct,
      name: '',
      nickname: name?.trim() || existing?.nickname,
      addedAt: existing?.addedAt ?? Date.now(),
      known: true,
      blocked: false,
      hidden: false,
    };
    this.refreshName(contact);
    this.state.contacts[acct] = contact;
    this.state.messages[acct] ??= [];
    await this.persist();
    await this.sendKey(acct).catch(() => undefined);
    return contact;
  }

  /**
   * Sends a text, optionally as a reply to one of the chat's messages (its id),
   * with a preview of its first link.
   */
  async send(account: string, body: string, replyToId?: string, preview?: LinkPreview): Promise<void> {
    const text = body.trim();
    if (!text) throw new OpenSocialError('MESSAGE_EMPTY', 'Message is empty.');
    const gid = groupIdOf(account);
    if (gid) this.checkCanPost(gid);
    const quoted = replyToId ? (this.state.messages[account] ?? []).find((x) => x.id === replyToId) : undefined;
    const quotedRef = quoted && !quoted.deleted && !quoted.call && !quoted.notice ? messageRef(quoted) : undefined;
    const linkPreview = preview ? sanitizeLinkPreview(preview, text) : undefined;
    const msg: RealMessage = {
      id: toHex(randomBytes(8)),
      direction: 'out',
      body: text,
      sentAt: Date.now(),
      status: 'sending',
      verified: false,
      ...(quoted && quotedRef
        ? {
            replyTo: {
              ref: quotedRef,
              text: quoteOf(quoted),
              mine: quoted.direction === 'out',
              ...(gid ? { author: quoted.direction === 'out' ? this.account : quoted.from! } : {}),
            },
          }
        : {}),
      ...(linkPreview ? { linkPreview } : {}),
    };
    (this.state.messages[account] ??= []).push(msg);
    if (account === this.account) {
      // Notes to yourself stay on this device.
      msg.status = 'sent';
      await this.persist();
      return;
    }
    this.emit();
    // Replying to a message request accepts it.
    const c = this.state.contacts[account];
    const firstReply = !!c && !c.known && !c.blocked;
    if (c && firstReply) c.known = true;
    try {
      await this.deliver(account, textPayload(msg), msg.sentAt);
      msg.status = 'sent';
    } catch (e) {
      msg.status = 'failed';
      await this.persist();
      throw e;
    }
    await this.persist();
    if (!gid && (firstReply || (c && this.myKey && c.keySent !== this.myKey.version))) {
      await this.sendKey(account).catch(() => undefined);
    }
  }

  /** Encrypts a payload with MLS for every device of the account and deposits it, in order. */
  private deliver(account: string, payload: Payload, sentAt: number, mailboxOnly = false): Promise<void> {
    return this.deliverMany(account, [payload], sentAt, mailboxOnly);
  }

  /** Several payloads in order (e.g. file chunks); progress counts delivered payloads. */
  private deliverMany(
    account: string,
    payloads: Payload[],
    sentAt: number,
    mailboxOnly = false,
    onProgress?: (done: number) => void,
    onlyDevice?: string,
  ): Promise<void> {
    const id = groupIdOf(account);
    if (id) return this.deliverToGroup(id, payloads).then(() => onProgress?.(payloads.length));
    const run = this.sendQueue.then(
      () => this.deliverNow(account, payloads, sentAt, mailboxOnly, onProgress, onlyDevice),
      () => this.deliverNow(account, payloads, sentAt, mailboxOnly, onProgress, onlyDevice),
    );
    this.sendQueue = run.catch(() => undefined);
    return run;
  }

  private async deliverNow(
    account: string,
    payloads: Payload[],
    sentAt: number,
    mailboxOnly: boolean,
    onProgress?: (done: number) => void,
    onlyDevice?: string,
  ): Promise<void> {
    // Device list from the 60-second cache (saves a round trip per message);
    // fetched fresh when the cache is empty.
    let devices = await this.devicesOf(account);
    if (devices.length === 0) devices = await this.devicesOf(account, true);
    // To our own account: our other devices only.
    if (account === this.account) devices = devices.filter((d) => d.deviceId !== this.device.deviceId);
    if (onlyDevice) devices = devices.filter((d) => d.deviceId === onlyDevice);
    if (devices.length === 0) throw new OpenSocialError('CONTACT_NO_DEVICES', 'This contact has no devices.');
    const { mailbox, lastEntry, delivered } = await this.prepare(account, devices, payloads, sentAt, mailboxOnly, false);
    if (delivered === 0) {
      throw new OpenSocialError('CONTACT_OUTDATED', 'This contact needs to open the latest OpenSocial before you can message them.');
    }
    if (mailbox.length === 0) {
      onProgress?.(payloads.length);
      return;
    }
    // Canister-sized batches, in order. After each accepted batch the chains
    // advance to its last entries, so a later failure never reuses a seq. A
    // device whose mailbox is full is dropped from this send (its chain stays
    // where it was); the others still get everything.
    const fullDevices = new Set<string>();
    try {
      await this.depositInBatches(mailbox, fullDevices, onProgress);
    } finally {
      this.markUnfinished(lastEntry);
      await this.persist();
    }
    const mailboxDevices = new Set(mailbox.map((i) => i.chainKey));
    if (mailboxDevices.size > 0 && [...mailboxDevices].every((k) => fullDevices.has(k)) && delivered === mailboxDevices.size) {
      throw new OpenSocialError('MAILBOX_FULL', 'Your friend’s mailbox is full. They need to open OpenSocial to receive messages.');
    }
  }

  /**
   * Encrypts the payloads for each of the account's devices (over its MLS
   * channel, started first if needed) and signs them into that device's
   * entry chain. Entries for devices with an open direct link are sent there;
   * the rest are returned for the mailbox. `deferSave`: the caller saves the
   * MLS state once, before depositing (a group send covers many devices).
   */
  private async prepare(
    account: string,
    devices: PublishedDevice[],
    payloads: Payload[],
    sentAt: number,
    mailboxOnly: boolean,
    deferSave: boolean,
  ): Promise<{ mailbox: OutItem[]; lastEntry: Map<string, { remote: string; seq: number }>; delivered: number }> {
    const conv = await directConversationId(this.account, account);
    const mailbox: OutItem[] = [];
    let delivered = 0;
    // Per device: the last entry of this send. If it doesn't all reach the
    // mailbox, the channel may be missing a setup (Welcome) or a key update
    // (commit) the receiver needs, so the next send starts a fresh channel.
    const lastEntry = new Map<string, { remote: string; seq: number }>();
    for (const d of devices) {
      const remote = this.address(account, d.deviceId);
      const chainKey = `${conv}:${d.deviceId}`;
      let prev = this.state.sendChains[chainKey] ?? { seq: 0, hash: '' };
      const forDevice: (OutItem & { seq: number })[] = [];
      let usable = true;
      for (const [pi, payload] of payloads.entries()) {
        const body = utf8(JSON.stringify(payload));
        const parts = await this.withMls(async () => {
          const out: { kind: number; bytes: Uint8Array }[] = [];
          const reset = this.state.resetOutbound?.includes(remote) ?? false;
          if (!this.mls.hasOutbound(remote) || reset) {
            // A device found unreachable lately is skipped (no claim, an update call, per message).
            if ((this.unreachable.get(remote) ?? 0) > Date.now()) return null;
            let welcome: Uint8Array;
            try {
              const claimed = await this.directory.claimKeyPackage(account, d.deviceId);
              if (!claimed) throw new Error('no key packages');
              // A new group replaces the old one (the receiver lost or broke its copy).
              welcome = this.mls.startOutbound(remote, claimed.singleUse ?? claimed.lastResort);
            } catch {
              // No key package, an invalid one (an outdated app), or the claim refused:
              // skip this device for a while, so the friend's other devices still get
              // the message without waiting.
              this.unreachable.set(remote, Date.now() + UNREACHABLE_MS);
              return null;
            }
            out.push({ kind: KIND_WELCOME, bytes: welcome });
            if (reset) this.state.resetOutbound = this.state.resetOutbound!.filter((r) => r !== remote);
          }
          for (const m of this.mls.encrypt(remote, body) as Uint8Array[]) {
            out.push({ kind: KIND_MESSAGE, bytes: new Uint8Array(m) });
          }
          if (!deferSave) await this.saveMls();
          return out;
        });
        if (!parts) {
          usable = false;
          break;
        }
        for (const [i, part] of parts.entries()) {
          // Only the signaling message itself is short-lived; never a Welcome or a commit.
          const ephemeral = payload.t === 'rtc' && part.kind === KIND_MESSAGE && i === parts.length - 1;
          const packed = new Uint8Array(1 + part.bytes.length);
          packed[0] = part.kind;
          packed.set(part.bytes, 1);
          const entry = await signEntry(
            {
              v: 3,
              conv,
              seq: prev.seq + 1,
              prev: prev.hash,
              from: this.account,
              device: this.device.deviceId,
              sentAt,
              envelope: toBase64(packed),
            },
            this.device.identity.signingPrivateKey,
          );
          prev = { seq: entry.seq, hash: await entryHash(entry) };
          lastEntry.set(chainKey, { remote, seq: entry.seq });
          forDevice.push({
            to: { account, deviceId: d.deviceId },
            entry: encodeEntry(entry),
            ...(ephemeral ? { ephemeral: true } : {}),
            chainKey,
            chain: prev,
            payloadIndex: pi,
            seq: entry.seq,
          });
        }
      }
      if (!usable) continue;
      // Direct link first (when open and in order), else the mailbox.
      if (!mailboxOnly && this.links?.trySend(account, d.deviceId, forDevice.map((e) => ({ seq: e.seq, bytes: e.entry })))) {
        this.state.sendChains[chainKey] = prev;
      } else {
        mailbox.push(...forDevice);
      }
      delivered++;
    }
    return { mailbox, lastEntry, delivered };
  }

  /**
   * A send whose last entry to a device did not all reach the mailbox may have
   * left out a setup (Welcome) or a key update (commit) that device needs:
   * the next send starts a fresh channel to it.
   */
  private markUnfinished(lastEntry: Map<string, { remote: string; seq: number }>) {
    for (const [chainKey, w] of lastEntry) {
      if ((this.state.sendChains[chainKey]?.seq ?? 0) < w.seq) {
        const pending = (this.state.resetOutbound ??= []);
        if (!pending.includes(w.remote)) pending.push(w.remote);
      }
    }
  }

  /**
   * One send to many accounts: device lists are fetched in parallel, every
   * device's entries prepared (the MLS state saved once), then deposited
   * together, several canister calls at a time. Accounts that can't be
   * reached are skipped; it fails only if nobody could be.
   */
  private async deliverAcross(accounts: string[], payloads: Payload[], sentAt: number, onProgress?: (done: number) => void): Promise<void> {
    const lists = await Promise.all(
      accounts.map(async (a) => {
        try {
          const list = await this.devicesOf(a);
          return list.length > 0 ? list : await this.devicesOf(a, true);
        } catch {
          return [];
        }
      }),
    );
    const all: OutItem[] = [];
    const lastEntry = new Map<string, { remote: string; seq: number }>();
    let delivered = 0;
    let tried = 0;
    try {
      for (const [i, account] of accounts.entries()) {
        const devices = lists[i]!.filter((d) => account !== this.account || d.deviceId !== this.device.deviceId);
        if (devices.length === 0) continue;
        if (account !== this.account) tried++;
        const plan = await this.prepare(account, devices, payloads, sentAt, false, true);
        all.push(...plan.mailbox);
        for (const [k, v] of plan.lastEntry) lastEntry.set(k, v);
        if (account !== this.account) delivered += plan.delivered;
      }
    } finally {
      await this.withMls(() => this.saveMls());
    }
    if (tried > 0 && delivered === 0) {
      throw new OpenSocialError('GROUP_UNREACHABLE', 'No one in this group could be reached. Try again later.');
    }
    if (all.length > 0) {
      const full = new Set<string>();
      try {
        if (payloads.length === 1) await this.depositParallel(all, full);
        else await this.depositInBatches(all, full, onProgress);
      } finally {
        this.markUnfinished(lastEntry);
        await this.persist();
      }
    }
    onProgress?.(payloads.length);
  }

  /** Deposits one payload's entries for many devices: whole devices per batch, up to 4 batches at once. */
  private async depositParallel(items: OutItem[], full: Set<string>): Promise<void> {
    const byDevice = new Map<string, OutItem[]>();
    for (const i of items) {
      const list = byDevice.get(i.chainKey);
      if (list) list.push(i);
      else byDevice.set(i.chainKey, [i]);
    }
    const batches: OutItem[][] = [];
    let cur: OutItem[] = [];
    let bytes = 0;
    for (const list of byDevice.values()) {
      const size = list.reduce((n, i) => n + i.entry.length, 0);
      if (cur.length > 0 && (cur.length + list.length > BATCH_MAX_ENTRIES || bytes + size > BATCH_MAX_BYTES)) {
        batches.push(cur);
        cur = [];
        bytes = 0;
      }
      cur.push(...list);
      bytes += size;
    }
    if (cur.length > 0) batches.push(cur);
    let next = 0;
    const worker = async () => {
      while (next < batches.length) await this.depositInBatches(batches[next++]!, full);
    };
    await Promise.all(Array.from({ length: Math.min(4, batches.length) }, worker));
  }

  /** Deposits entries in canister-sized batches, in order (see deliverNow). */
  private async depositInBatches(mailbox: OutItem[], fullDevices: Set<string>, onProgress?: (done: number) => void): Promise<void> {
    let start = 0;
    while (start < mailbox.length) {
      const pending = mailbox.slice(start).filter((i) => !fullDevices.has(i.chainKey));
      if (pending.length === 0) break;
      let end = 0;
      let bytes = 0;
      while (end < pending.length && end < BATCH_MAX_ENTRIES && bytes + pending[end]!.entry.length <= BATCH_MAX_BYTES) {
        bytes += pending[end]!.entry.length;
        end++;
      }
      if (end === 0) end = 1;
      const chunk = pending.slice(0, end);
      const items = chunk.map((i) => ({ to: i.to, entry: i.entry, ...(i.ephemeral ? { ephemeral: true } : {}) }));
      let skipped: number[] = [];
      // A failed call is tried again twice (network hiccups, timeouts). If an
      // attempt did store the entries after all, the copies are dropped by the
      // receiver (same seq).
      for (let attempt = 0, paced = 0; ; attempt++) {
        try {
          if (this.delivery.depositMany) {
            skipped = (await this.delivery.depositMany(items)) ?? [];
          } else {
            for (const item of items) await this.delivery.deposit(item.to, item.entry);
          }
          break;
        } catch (e) {
          // At the per-minute limit (large files): wait for the next minute and go on.
          if (isRateLimited(e) && paced++ < MAX_PACED_WAITS) {
            attempt = -1;
            await new Promise((r) => setTimeout(r, msToNextMinute()));
            continue;
          }
          if (attempt >= DEPOSIT_RETRY_MS.length || !isTransient(e)) throw e;
          await new Promise((r) => setTimeout(r, DEPOSIT_RETRY_MS[attempt]));
        }
      }
      for (const k of skipped) fullDevices.add(chunk[k]!.chainKey);
      for (const i of chunk) if (!fullDevices.has(i.chainKey)) this.state.sendChains[i.chainKey] = i.chain;
      onProgress?.(chunk[chunk.length - 1]!.payloadIndex + 1);
      start = mailbox.indexOf(chunk[chunk.length - 1]!) + 1;
    }
  }

  /* ------------------------------------------------------------ files --- */

  private fileKey(fileId: string) {
    return `file:${this.account}:${fileId}`;
  }

  /** The bytes of a file in this conversation, if stored on this device. */
  fileBytes(fileId: string): Promise<Uint8Array | null> {
    return this.store.getBytes(this.fileKey(fileId));
  }

  findMessage(account: string, fileId: string) {
    return this.state.messages[account]?.find((m) => m.attachment?.fileId === fileId);
  }

  /** Sources of large files still being sent in this session (for retry). */
  private sending = new Map<string, { account: string; source: FileSource & { thumb?: string; voice?: VoiceInfo; caption?: string }; sia: SiaUploader }>();

  /**
   * Sends a file of up to MAX_FILE_BYTES. Up to INLINE_MAX_BYTES it travels in
   * encrypted chunks (direct link or mailbox) and is kept on this device.
   * Larger files are encrypted as a stream (OSF1, fresh key), uploaded to the
   * sender's Sia space while being read, and shared by a sharing key; nothing
   * large is held in memory or copied into the device store.
   */
  async sendFile(account: string, source: FileSource & { thumb?: string; voice?: VoiceInfo; caption?: string }, sia?: SiaUploader): Promise<void> {
    if (source.size > MAX_FILE_BYTES) {
      throw new OpenSocialError('FILE_TOO_LARGE', 'Files can be up to 2 GB.');
    }
    const fileId = toHex(randomBytes(12));
    if (account === this.account) return this.saveNoteFile(fileId, source);
    const gid = groupIdOf(account);
    if (gid) {
      this.checkCanPost(gid);
      // In a group a file is stored once (in the group's shard), or in the sender's Sia when larger.
      if (source.size <= GROUP_FILE_MAX_BYTES) sia = this.groupUploader(gid);
      else if (!sia) {
        throw new OpenSocialError('FILE_TOO_LARGE', 'Files over 25 MB in groups go through Sia storage. Connect Sia in Settings to send them.');
      }
    }
    const large = !!gid || source.size > INLINE_MAX_BYTES;
    if (large && !sia) return this.sendP2P(account, fileId, source);
    const meta: FileMeta = {
      fileId,
      name: source.name.slice(0, 200),
      mime: source.mime || 'application/octet-stream',
      size: source.size,
      ...mediaInfo(source),
    };
    const plan = inlineChunks(source.size, meta);
    const n = large ? 100 : plan.length;
    const msg: RealMessage = {
      id: toHex(randomBytes(8)),
      direction: 'out',
      body: meta.caption ?? '',
      sentAt: Date.now(),
      status: 'sending',
      verified: false,
      attachment: { ...meta, via: large ? 'sia' : 'inline', state: 'sending', done: 0, total: n },
    };
    (this.state.messages[account] ??= []).push(msg);
    this.emit();
    if (large) {
      this.sending.set(fileId, { account, source, sia: sia! });
      return this.uploadLarge(account, msg, meta);
    }
    const bytes = await source.read(0, source.size);
    await this.store.setBytes(this.fileKey(fileId), bytes);
    await this.deliverInline(account, msg, meta, bytes);
  }

  /** Sends a file kept here in inline chunks (again, after a failure). */
  private async deliverInline(account: string, msg: RealMessage, meta: FileMeta, bytes: Uint8Array): Promise<void> {
    const plan = inlineChunks(bytes.length, meta);
    const n = plan.length;
    msg.status = 'sending';
    msg.attachment!.state = 'sending';
    msg.attachment!.done = 0;
    msg.attachment!.total = n;
    this.emit();
    const progress = (done: number) => {
      msg.attachment!.done = done;
      this.emit();
    };
    try {
      // The preview, waveform and caption ride on the first chunk only.
      const chunks: Payload[] = plan.map(([start, end], i) => ({
        t: 'file',
        ...meta,
        ...(i > 0 ? { thumb: undefined, voice: undefined, caption: undefined } : {}),
        i,
        n,
        data: toBase64(bytes.subarray(start, end)),
      }));
      await this.deliverMany(account, chunks, msg.sentAt, false, progress);
      msg.status = 'sent';
      msg.attachment!.state = 'ready';
    } catch (e) {
      msg.status = 'failed';
      msg.attachment!.state = 'failed';
      await this.persist();
      throw e;
    }
    await this.persist();
  }

  private async uploadLarge(account: string, msg: RealMessage, meta: FileMeta): Promise<void> {
    const job = this.sending.get(meta.fileId)!;
    const a = msg.attachment!;
    a.state = 'sending';
    a.done = 0;
    msg.status = 'sending';
    this.emit();
    try {
      const raw = randomBytes(32);
      const base = randomBytes(8);
      const key = await importFileKey(raw);
      // Same key and nonce base each time: every reopened stream has the same bytes.
      const cipher = () => encryptStream(job.source, key, base);
      const shared = await job.sia(cipher, ciphertextSize(job.source.size), (f) => {
        a.done = Math.min(99, Math.round(f * 100));
        this.emit();
      });
      const ref = { seed: shared.seed, objectId: shared.objectId, key: toBase64(raw), iv: toBase64(base) };
      a.sia = ref;
      await this.deliver(account, { t: 'file-sia', ...meta, ...ref }, msg.sentAt);
      a.done = 100;
      a.state = 'remote'; // the sender keeps no copy; it opens from Sia like the recipient
      msg.status = 'sent';
      this.sending.delete(meta.fileId);
    } catch (e) {
      a.state = 'failed';
      msg.status = 'failed';
      await this.persist();
      throw e;
    }
    await this.persist();
  }

  /** Retries a large file that failed, while its source is still available in this session. */
  /** Told when files are deleted here, so views can release what they hold (object URLs). */
  onFilesDeleted: ((fileIds: string[]) => void) | null = null;

  /** Deletes a message's file from this device (all of its stored parts). */
  private async dropFile(a: Attachment) {
    await this.store.deleteBytes(this.fileKey(a.fileId));
    this.partial.delete(a.fileId);
    delete this.state.outgoing?.[a.fileId];
    this.sending.delete(a.fileId);
    this.onFilesDeleted?.([a.fileId]);
  }

  /** Turns a message into a "deleted" placeholder: no text, no file, no preview. */
  private async tombstone(m: RealMessage) {
    if (m.attachment) await this.dropFile(m.attachment);
    m.body = '';
    delete m.attachment;
    delete m.call;
    delete m.highlightedAt; // nothing left to highlight
    delete m.reactions;
    delete m.replyTo;
    m.deleted = true;
  }

  /**
   * Delete for everyone: withdraws one of your messages. Their app deletes the
   * text and the file it keeps (also parts still arriving); a placeholder
   * says it was deleted. What they saved outside the app (a screenshot, a
   * file saved to disk) can't be reached.
   */
  async deleteForEveryone(account: string, messageId: string): Promise<void> {
    const m = (this.state.messages[account] ?? []).find((x) => x.id === messageId);
    if (!m || m.direction !== 'out' || m.deleted || m.call) return;
    const ref = m.attachment?.fileId ?? m.id;
    // Also for "not sent": part of it (a file cut off) may have arrived.
    if (account !== this.account) await this.deliver(account, { t: 'retract', id: ref }, Date.now());
    await this.tombstone(m);
    this.forgetQuotes(account, ref);
    await this.persist();
  }

  /**
   * Adds (`on`) or takes back one of our reactions to a message. Each person
   * can put several different emoji on a message; the friend sees them too.
   */
  async react(account: string, messageId: string, emoji: string, on: boolean): Promise<void> {
    const m = (this.state.messages[account] ?? []).find((x) => x.id === messageId);
    const ref = m && !m.deleted && !m.call ? messageRef(m) : undefined;
    if (!m || !ref || !validEmoji(emoji)) return;
    withReactions(m, 'me', toggled(m.reactions?.me, emoji, on));
    await this.persist();
    this.emit();
    if (account !== this.account) await this.deliver(account, { t: 'react', ref, emoji, on }, Date.now());
  }

  /**
   * Changes the text of one of our messages (within EDIT_WINDOW_MS); the
   * friend's app shows the new text, marked as edited.
   */
  async editMessage(account: string, messageId: string, body: string): Promise<void> {
    const text = body.trim();
    if (!text) throw new OpenSocialError('MESSAGE_EMPTY', 'Message is empty.');
    const m = (this.state.messages[account] ?? []).find((x) => x.id === messageId);
    if (!m || !canEdit(m)) throw new OpenSocialError('EDIT_CLOSED', 'This message can no longer be edited.');
    if (text === m.body) return;
    m.body = text;
    m.edited = Date.now();
    dropStalePreview(m);
    this.updateQuotes(account, m.id, text);
    await this.persist();
    this.emit();
    if (account !== this.account) await this.deliver(account, { t: 'edit', ref: m.id, text }, Date.now());
  }

  /** The friend changed one of their messages (only theirs, only text). */
  private applyEdit(key: string, from: string, ref: string, text: string) {
    const m = (this.state.messages[key] ?? []).find(
      (x) => x.direction === 'in' && (x.from ?? key) === from && x.remoteId === ref && !x.deleted && !x.attachment,
    );
    if (!m) return;
    m.body = text;
    m.edited = Date.now();
    dropStalePreview(m);
    this.updateQuotes(key, ref, text);
  }

  /** Replies quoting an edited message show its new text. */
  private updateQuotes(account: string, ref: string, text: string) {
    for (const x of this.state.messages[account] ?? []) {
      if (x.replyTo?.ref === ref && !x.replyTo.deleted) x.replyTo = { ...x.replyTo, text: text.slice(0, MAX_QUOTE) };
    }
  }

  /** A friend's reaction added or taken back, on a message in our chat. */
  private applyReaction(key: string, from: string, ref: string, emoji: string, on: boolean) {
    const m = (this.state.messages[key] ?? []).find((x) => !x.deleted && !x.notice && messageRef(x) === ref);
    if (!m) return;
    if (!isGroupKey(key)) {
      withReactions(m, 'them', toggled(m.reactions?.them, emoji, on));
      return;
    }
    // In a group each member's reactions are kept apart; `them` shows them all.
    const by = (m.memberReactions ??= {});
    const list = toggled(by[from], emoji, on);
    if (list) by[from] = list;
    else delete by[from];
    const all = [...new Set(Object.values(by).flat())];
    withReactions(m, 'them', all.length > 0 ? all : undefined);
    if (Object.keys(by).length === 0) delete m.memberReactions;
  }

  /** Replies quoting a message deleted for everyone show only that it was deleted. */
  private forgetQuotes(account: string, ref: string) {
    for (const x of this.state.messages[account] ?? []) {
      if (x.replyTo?.ref === ref) x.replyTo = { ref, text: '', mine: x.replyTo.mine, deleted: true };
    }
  }

  /** Highlights or un-highlights a message (on this device). */
  async highlightMessage(account: string, messageId: string, on: boolean): Promise<void> {
    const m = (this.state.messages[account] ?? []).find((x) => x.id === messageId);
    if (!m || m.deleted || m.call) return;
    if (on) m.highlightedAt = Date.now();
    else delete m.highlightedAt;
    await this.persist();
  }

  /** The chat's highlighted messages in chat order (oldest first, newest last). */
  highlightedMessages(account: string): RealMessage[] {
    return (this.state.messages[account] ?? []).filter((m) => m.highlightedAt && !m.deleted);
  }

  /** Delete for me: removes a message and its file from this device only. */
  async deleteForMe(account: string, messageId: string): Promise<void> {
    const list = this.state.messages[account] ?? [];
    const i = list.findIndex((x) => x.id === messageId);
    if (i < 0) return;
    const [m] = list.splice(i, 1);
    if (m!.attachment) await this.dropFile(m!.attachment);
    if (m!.direction === 'in') {
      const c = this.state.contacts[account];
      if (c?.readIn) c.readIn = Math.max(0, c.readIn - 1); // the unread count stays right
    }
    await this.persist();
  }

  /** A friend withdrew one of their messages: delete it here. */
  private async applyRetract(key: string, from: string, id: string) {
    const r = (this.state.retracted ??= []);
    if (!r.includes(id)) r.push(id);
    if (r.length > 500) r.splice(0, r.length - 500);
    const m = (this.state.messages[key] ?? []).find(
      (x) => x.direction === 'in' && (x.from ?? key) === from && !x.deleted && (x.remoteId === id || x.attachment?.fileId === id),
    );
    if (m) await this.tombstone(m);
    this.forgetQuotes(key, id);
    await this.persist();
  }

  /** Sends a failed message again: text as it was, a file from what is kept here. */
  /** What to (re)send for one of our messages: an event invite sends the event as it is now. */
  private payloadOf(m: RealMessage): Payload {
    const ev = m.eventId ? this.state.events?.[m.eventId] : undefined;
    return ev ? { t: 'event', ev: wireEvent(ev) } : textPayload(m);
  }

  /* ------------------------------------------------------------- groups --- */
  // One MLS group per chat; its stream lives in an inbox shard (docs/GROUPS.md).

  /** The name we give ourselves in groups (our profile name), sent with our group messages. */
  private myName = '';

  setMyName(name: string) {
    this.myName = name.trim().slice(0, 60);
  }

  /** Groups on this device (also those we left), newest first. */
  groups(): { state: GroupState; left: boolean }[] {
    return Object.values(this.state.groups ?? {})
      .map((r) => ({ state: r.state, left: !!r.left }))
      .sort((a, b) => b.state.updatedAt - a.state.updatedAt);
  }

  /** A group by id. */
  group(id: string): { state: GroupState; left: boolean } | undefined {
    const r = this.state.groups?.[id];
    return r ? { state: r.state, left: !!r.left } : undefined;
  }

  /**
   * How a group member is called here: our name for them if they are a
   * contact, else the name they gave themselves, else a short id.
   */
  memberName(groupId: string | null, account: string): string {
    if (account === this.account) return 'You';
    const c = this.state.contacts[account];
    if (c && !c.group && (c.nickname || c.profile?.displayName)) return c.name;
    const own = groupId ? this.state.groups?.[groupId]?.names[account] : undefined;
    return own || c?.name || RealMessaging.shortId(account);
  }

  private net(): GroupTransport {
    if (!this.groupNet) throw new OpenSocialError('GROUPS_UNAVAILABLE', 'Group chats are not available here.');
    return this.groupNet;
  }

  /** Runs `f` alone for this group (stream reads, posts and commits never interleave). */
  private inGroup<T>(id: string, f: () => Promise<T>): Promise<T> {
    const run = (this.groupLocks.get(id) ?? Promise.resolve()).then(f, f);
    this.groupLocks.set(
      id,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private readonly groupLocks = new Map<string, Promise<void>>();
  /** When each group's stream was last read to its end (ms). */
  private readonly groupSyncedAt = new Map<string, number>();

  /** Creates a group with us as its owner and the given friends as members. */
  async createGroup(input: { name: string; about?: string; photo?: string; members: string[] }): Promise<string> {
    const others = [...new Set(input.members.map((a) => a.trim()))].filter((a) => a && a !== this.account);
    if (others.length === 0) throw new OpenSocialError('GROUP_EMPTY', 'Choose at least one person for the group.');
    if (others.length + 1 > GROUP_LIMITS.members) {
      throw new OpenSocialError('GROUP_FULL', `A group can have up to ${GROUP_LIMITS.members} members.`);
    }
    const now = Date.now();
    const id = toHex(randomBytes(8));
    const member = (account: string, role: GroupMember['role']): GroupMember => ({
      account,
      role,
      addedBy: this.account,
      addedAt: now,
    });
    const state = sanitizeGroup({
      id,
      name: input.name,
      about: input.about ?? '',
      photo: input.photo ?? '',
      members: [member(this.account, 'owner')],
      onlyAdminsPost: false,
      onlyAdminsEdit: false,
      version: 1,
      updatedAt: now,
      updatedBy: this.account,
    });
    if (!state) throw new OpenSocialError('GROUP_INVALID', 'Give the group a name.');
    const net = this.net();
    const shard = await net.homeShard();
    await this.withMlsDevice(async (m) => {
      m.groupCreate(id);
      await this.saveMls();
    });
    await net.create(shard, id);
    const rec = this.addGroup(state, shard, 0, true, { kind: 'created', by: this.account }, now);
    await this.persist();
    this.emit();
    const next = nextGroup(state, this.account, { members: [...state.members, ...others.map((a) => member(a, 'member'))] });
    await this.inGroup(id, () => this.addAccounts(rec, others, next, true));
    return groupKey(id);
  }

  /** Changes the group's name, description, photo or (owner) settings. */
  async updateGroup(
    id: string,
    patch: Partial<Pick<GroupState, 'name' | 'about' | 'photo' | 'onlyAdminsPost' | 'onlyAdminsEdit'>>,
  ): Promise<void> {
    const rec = this.liveGroup(id);
    const next = sanitizeGroup(nextGroup(rec.state, this.account, patch));
    if (!next) throw new OpenSocialError('GROUP_INVALID', 'Give the group a name.');
    await this.inGroup(id, () => this.publishState(rec, next));
  }

  /** Adds people (admins only). */
  async addMembers(id: string, accounts: string[]): Promise<void> {
    const rec = this.liveGroup(id);
    const now = Date.now();
    const added = [...new Set(accounts)].filter((a) => a && a !== this.account && !isMember(rec.state, a));
    if (added.length === 0) return;
    if (rec.state.members.length + added.length > GROUP_LIMITS.members) {
      throw new OpenSocialError('GROUP_FULL', `A group can have up to ${GROUP_LIMITS.members} members.`);
    }
    const members = [
      ...rec.state.members,
      ...added.map((account) => ({ account, role: 'member' as const, addedBy: this.account, addedAt: now })),
    ];
    const next = nextGroup(rec.state, this.account, { members });
    this.checkChange(rec, next);
    await this.inGroup(id, () => this.addAccounts(rec, added, next, false));
  }

  /** Removes someone (admins remove members; the owner anyone): their devices leave the MLS group and the stream. */
  async removeMember(id: string, account: string): Promise<void> {
    const rec = this.liveGroup(id);
    if (!isMember(rec.state, account) || account === this.account) return;
    const next = nextGroup(rec.state, this.account, { members: rec.state.members.filter((m) => m.account !== account) });
    this.checkChange(rec, next);
    await this.inGroup(id, async () => {
      await this.commitRemoval(rec, account, [account]);
      await this.publishState(rec, next);
    });
    // Tell them over their own channel: they can no longer read the group.
    void this.deliverAcross([account], [{ t: 'group-removed', g: id, by: this.account }], Date.now()).catch(() => undefined);
  }

  /** Makes a member an admin, or an admin a member again. */
  async setMemberRole(id: string, account: string, role: 'admin' | 'member'): Promise<void> {
    const rec = this.liveGroup(id);
    const cur = roleOf(rec.state, account);
    if (!cur || cur === 'owner' || cur === role) return;
    const next = nextGroup(rec.state, this.account, {
      members: rec.state.members.map((m) => (m.account === account ? { ...m, role } : m)),
    });
    this.checkChange(rec, next);
    await this.inGroup(id, async () => {
      await this.net().setRole(rec.shard, id, account, role === 'admin' ? 'Admin' : 'Member');
      await this.publishState(rec, next);
    });
  }

  /** Makes another member the owner; we become an admin. */
  async transferOwnership(id: string, account: string): Promise<void> {
    const rec = this.liveGroup(id);
    if (roleOf(rec.state, this.account) !== 'owner' || !isMember(rec.state, account) || account === this.account) return;
    const next = nextGroup(rec.state, this.account, {
      members: rec.state.members.map((m) =>
        m.account === account
          ? { ...m, role: 'owner' as const }
          : m.account === this.account
            ? { ...m, role: 'admin' as const }
            : m,
      ),
    });
    this.checkChange(rec, next);
    await this.inGroup(id, async () => {
      await this.net().setRole(rec.shard, id, account, 'Owner');
      await this.publishState(rec, next);
    });
  }

  /**
   * Leaves the group: everyone is told, an owner hands the group on (see
   * withoutMember), and the shard stops serving us. An admin then removes
   * our devices from the MLS group. The chat stays here, read-only.
   */
  async leaveGroup(id: string): Promise<void> {
    const rec = this.liveGroup(id);
    const key = groupKey(id);
    await this.inGroup(id, async () => {
      const members = withoutMember(rec.state, this.account);
      const heir = members.find((m) => m.role === 'owner' && roleOf(rec.state, this.account) === 'owner')?.account;
      if (members.length > 0) await this.publishState(rec, nextGroup(rec.state, this.account, { members }));
      else this.addNotice(key, { kind: 'left', by: this.account }, Date.now());
      await this.net().leave(rec.shard, id, heir);
      rec.left = true;
      await this.withMlsDevice(async (m) => {
        m.groupDelete(id);
        await this.saveMls();
      });
    });
    await this.persist();
    this.emit();
  }

  /** Deletes a group's chat from this device, leaving the group first if we are still in it. */
  async deleteGroup(id: string): Promise<void> {
    const rec = this.state.groups?.[id];
    if (!rec) return;
    if (!rec.left) await this.leaveGroup(id).catch((e) => console.warn('OpenSocial: could not leave the group:', e));
    await this.clearChat(groupKey(id));
    delete this.state.groups![id];
    delete this.state.contacts[groupKey(id)];
    delete this.state.messages[groupKey(id)];
    await this.persist();
    this.emit();
  }

  /** Joins a group someone who is not our friend added us to (until then it is listed as a request). */
  async joinGroup(id: string): Promise<void> {
    const c = this.state.contacts[groupKey(id)];
    if (!c) return;
    c.known = true;
    await this.persist();
    this.emit();
  }

  /** Throws unless we may post in the group. */
  private checkCanPost(id: string) {
    const rec = this.liveGroup(id);
    if (!canPost(rec.state, this.account)) {
      throw new OpenSocialError('GROUP_ADMINS_ONLY', 'Only admins can send messages in this group.');
    }
  }

  /** A group we are still in, or an error. */
  private liveGroup(id: string): GroupRecord {
    const rec = this.state.groups?.[id];
    if (!rec || rec.left || !isMember(rec.state, this.account)) {
      throw new OpenSocialError('GROUP_LEFT', 'You are no longer in this group.');
    }
    return rec;
  }

  private checkChange(rec: GroupRecord, next: GroupState) {
    if (!mayChange(rec.state, next, this.account)) {
      throw new OpenSocialError('GROUP_FORBIDDEN', 'Only the group’s admins can do that.');
    }
  }

  /** Applies a change of ours here and posts it to the group (encrypted). */
  private async publishState(rec: GroupRecord, next: GroupState): Promise<void> {
    this.checkChange(rec, next);
    this.applyChange(rec, next, this.account, Date.now());
    await this.persist();
    this.emit();
    await this.postToGroup(rec, [{ t: 'group-state', s: next } as unknown as Payload]);
  }

  /** Records that stream entry `seq` is ours and already applied here. */
  private markOwn(rec: GroupRecord, seq: number) {
    if (seq <= rec.cursor) return;
    if (seq === rec.cursor + 1) {
      rec.cursor = seq;
      const own = rec.own ?? [];
      while (own.includes(rec.cursor + 1)) own.splice(own.indexOf(++rec.cursor), 1);
      if (own.length === 0) delete rec.own;
    } else {
      (rec.own ??= []).push(seq);
    }
  }

  /** Encrypts each payload once (MLS) and posts it to the group's stream. Call inside inGroup. */
  private async postToGroup(rec: GroupRecord, payloads: Payload[]): Promise<void> {
    const id = rec.state.id;
    const net = this.net();
    for (const p of payloads) {
      const plain = utf8(
        JSON.stringify({ t: 'group', g: id, v: rec.state.version, ...(this.myName ? { n: this.myName } : {}), p }),
      );
      const { data, epoch } = await this.withMlsDevice(async (m) => {
        const data = m.groupEncrypt(id, plain);
        await this.saveMls();
        return { data, epoch: Number(m.groupEpoch(id)) };
      });
      const seq = await net.post(rec.shard, id, this.device.deviceId, epoch, data);
      this.markOwn(rec, seq);
      rec.sent = (rec.sent ?? 0) + 1;
    }
    await this.persist();
    // Post-compromise security: renew our keys now and then.
    if ((rec.sent ?? 0) >= GROUP_KEY_UPDATE_EVERY || Date.now() - (rec.keysAt ?? 0) > GROUP_KEY_UPDATE_MS) {
      rec.sent = 0;
      rec.keysAt = Date.now();
      await this.groupCommit(rec, (m) => m.groupSelfUpdate(id) as MlsCommit, [], []).catch((e) =>
        console.warn('OpenSocial: group key update:', e),
      );
    }
  }

  /** Sends payloads to a group (see deliverMany): our messages, edits, reactions, files. */
  private deliverToGroup(id: string, payloads: Payload[]): Promise<void> {
    const rec = this.state.groups?.[id];
    if (!rec) return Promise.reject(new OpenSocialError('GROUP_UNKNOWN', 'This group is not on this device.'));
    if (rec.left) return Promise.reject(new OpenSocialError('GROUP_LEFT', 'You are no longer in this group.'));
    // Catch up first, so the message is encrypted in the group's current epoch
    // (members added since can read it).
    // (Skipped when the stream was read a moment ago: the open chat is read twice a second.)
    return this.inGroup(id, async () => {
      if (Date.now() - (this.groupSyncedAt.get(id) ?? 0) > 1_000) await this.syncGroup(rec).catch(() => undefined);
      await this.postToGroup(rec, payloads);
    });
  }

  /**
   * Makes a commit and posts it in the current epoch, with the access-list
   * change it brings. If another commit came first, catches up and makes it
   * again. Call inside inGroup. Returns the commit's seq and its Welcome blob.
   */
  private async groupCommit(
    rec: GroupRecord,
    make: (m: MlsDevice) => MlsCommit,
    add: string[],
    remove: string[],
  ): Promise<{ seq: number; welcome?: { blob: bigint; chunks: number } }> {
    const id = rec.state.id;
    const net = this.net();
    for (let attempt = 0; ; attempt++) {
      await this.syncGroup(rec);
      const { out, epoch } = await this.withMlsDevice(async (m) => {
        const out = make(m);
        await this.saveMls();
        return { out, epoch: Number(m.groupEpoch(id)) };
      });
      const welcome = out.welcome ? await this.uploadBlob(rec, out.welcome) : undefined;
      try {
        const seq = await net.postCommit(rec.shard, {
          group: id,
          device: this.device.deviceId,
          epoch,
          commit: out.commit,
          ...(welcome ? { welcome: welcome.blob } : {}),
          add,
          remove,
        });
        await this.withMlsDevice(async (m) => {
          m.groupMerge(id);
          await this.saveMls();
        });
        this.markOwn(rec, seq);
        await this.persist();
        return { seq, ...(welcome ? { welcome } : {}) };
      } catch (e) {
        await this.withMlsDevice(async (m) => {
          m.groupDiscard(id);
          await this.saveMls();
        });
        if (!(e instanceof StaleEpoch) || attempt >= 4) throw e;
      }
    }
  }

  /** Stores bytes once in the group's shard (a Welcome or an encrypted file). */
  private async uploadBlob(
    rec: GroupRecord,
    bytes: Uint8Array,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ blob: bigint; chunks: number }> {
    const blob = BigInt('0x' + toHex(randomBytes(8)));
    const chunks = Math.max(1, Math.ceil(bytes.length / BLOB_CHUNK));
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < chunks) {
        const i = next++;
        await this.net().blobPut(
          rec.shard,
          rec.state.id,
          blob,
          i,
          chunks,
          bytes.length,
          bytes.subarray(i * BLOB_CHUNK, (i + 1) * BLOB_CHUNK),
        );
        onProgress?.(++done, chunks);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, chunks) }, worker));
    return { blob, chunks };
  }

  private async downloadBlob(shard: string, group: string, blob: bigint, chunks: number): Promise<Uint8Array> {
    const parts = await Promise.all(Array.from({ length: chunks }, (_, i) => this.net().blobGet(shard, group, blob, i)));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  /**
   * Adds accounts (and, when `withOwnDevices`, our other devices): their
   * devices' key packages, one commit per 100 accounts with the access-list
   * change, then the new state for everyone, then an invitation to each new
   * account over its own channel. Call inside inGroup.
   */
  private async addAccounts(rec: GroupRecord, accounts: string[], next: GroupState, withOwnDevices: boolean) {
    const id = rec.state.id;
    const invites: { accounts: string[]; seq: number; welcome: { blob: bigint; chunks: number } }[] = [];
    const batches: string[][] = [];
    for (let i = 0; i < accounts.length; i += GROUP_ADD_BATCH) batches.push(accounts.slice(i, i + GROUP_ADD_BATCH));
    if (withOwnDevices) (batches[0] ??= []).push(this.account);
    for (const batch of batches) {
      const lists = await Promise.all(batch.map((a) => this.devicesOf(a, true).catch(() => [] as PublishedDevice[])));
      const devices = batch.flatMap((account, i) =>
        lists[i]!.filter((d) => account !== this.account || d.deviceId !== this.device.deviceId).map((d) => ({
          account,
          deviceId: d.deviceId,
        })),
      );
      const kps = (await this.net().claimKeyPackages(devices)).filter((k): k is Uint8Array => !!k);
      const acl = batch.filter((a) => a !== this.account);
      if (kps.length === 0) {
        // Nobody to add to the MLS group yet (no devices with keys): still give access.
        if (acl.length > 0) await this.groupCommit(rec, (m) => m.groupSelfUpdate(id) as MlsCommit, acl, []);
        continue;
      }
      const usable = await this.usableKeyPackages(id, kps);
      if (usable.length === 0) throw new OpenSocialError('GROUP_ADD_FAILED', 'Could not add these people right now. Try again later.');
      const r = await this.groupCommit(rec, (m) => m.groupAdd(id, usable) as MlsCommit, acl, []);
      if (r.welcome) invites.push({ accounts: batch, seq: r.seq, welcome: r.welcome });
    }
    if (next.version !== rec.state.version) await this.publishState(rec, next);
    for (const inv of invites) {
      const payload: Payload = {
        t: 'group-invite',
        g: id,
        shard: rec.shard,
        seq: inv.seq,
        blob: inv.welcome.blob.toString(),
        chunks: inv.welcome.chunks,
        name: rec.state.name,
      };
      await this.deliverAcross(inv.accounts, [payload], Date.now()).catch((e) => console.warn('OpenSocial: group invite:', e));
    }
  }

  /**
   * The key packages the group can take: normally all of them; when one is
   * refused (e.g. from an outdated app), each is tried alone and the bad ones
   * are left out (those devices join later, once updated).
   */
  private async usableKeyPackages(id: string, kps: Uint8Array[]): Promise<Uint8Array[]> {
    return this.withMlsDevice(async (m) => {
      try {
        m.groupAdd(id, kps);
        return kps;
      } catch (e) {
        console.warn('OpenSocial: a key package was refused, checking each:', e);
        return kps.filter((kp) => {
          try {
            m.groupAdd(id, [kp]);
            return true;
          } catch (err) {
            console.warn('OpenSocial: left out a device key package:', err);
            return false;
          } finally {
            m.groupDiscard(id);
          }
        });
      } finally {
        m.groupDiscard(id);
      }
    });
  }

  /** Commits the removal of an account's devices from the MLS group (and, with `acl`, from the stream). */
  private async commitRemoval(rec: GroupRecord, account: string, acl: string[]) {
    const id = rec.state.id;
    const leaves = await this.withMlsDevice(async (m) =>
      (m.groupMembers(id) as string[]).filter((d) => d.startsWith(`${account}.`)),
    );
    await this.groupCommit(
      rec,
      (m) => {
        const still = (m.groupMembers(id) as string[]).filter((d) => leaves.includes(d));
        return (still.length > 0 ? m.groupRemove(id, still) : m.groupSelfUpdate(id)) as MlsCommit;
      },
      [],
      acl,
    );
  }

  /** A new group on this device, with its chat. */
  private addGroup(state: GroupState, shard: string, cursor: number, known: boolean, notice: GroupNotice, at: number) {
    const key = groupKey(state.id);
    const rec: GroupRecord = { state, names: {}, shard, cursor, keysAt: at };
    (this.state.groups ??= {})[state.id] = rec;
    this.state.contacts[key] = {
      account: key,
      name: state.name,
      addedAt: at,
      known,
      group: true,
      ...(state.photo ? { photo: state.photo } : {}),
    };
    this.addNotice(key, notice, at);
    return rec;
  }

  private addNotice(key: string, notice: GroupNotice, at: number) {
    insertBySentAt((this.state.messages[key] ??= []), {
      id: toHex(randomBytes(8)),
      direction: 'in',
      body: '',
      sentAt: at,
      status: 'delivered',
      verified: true,
      notice,
    });
  }

  /** Takes a newer group state: the chat's name and photo, our membership, and a line per change. */
  private applyChange(rec: GroupRecord, next: GroupState, by: string, at: number) {
    const cur = rec.state;
    const key = groupKey(next.id);
    const d = diffGroup(cur, next);
    rec.state = next;
    const c = this.state.contacts[key];
    if (c) {
      c.name = next.name;
      if (next.photo) c.photo = next.photo;
      else delete c.photo;
    }
    const left = d.removed.filter((a) => a === by);
    const removed = d.removed.filter((a) => a !== by);
    if (d.added.length > 0) this.addNotice(key, { kind: 'added', by, who: d.added }, at);
    if (removed.length > 0) this.addNotice(key, { kind: 'removed', by, who: removed }, at);
    if (left.length > 0) this.addNotice(key, { kind: 'left', by }, at);
    if (d.owner) this.addNotice(key, { kind: 'owner', by, who: [d.owner] }, at);
    if (d.promoted.length > 0) this.addNotice(key, { kind: 'promoted', by, who: d.promoted }, at);
    if (d.demoted.length > 0) this.addNotice(key, { kind: 'demoted', by, who: d.demoted }, at);
    if (d.renamed) this.addNotice(key, { kind: 'renamed', by, text: d.renamed }, at);
    if (d.photo) this.addNotice(key, { kind: 'photo', by }, at);
    if (d.about) this.addNotice(key, { kind: 'about', by }, at);
    if (d.settings) this.addNotice(key, { kind: 'settings', by }, at);
    if (!isMember(next, this.account)) rec.left = true;
    // Someone left: an admin's device removes their devices from the MLS group.
    if (left.length > 0 && by !== this.account && isAdmin(next, this.account)) {
      const id = next.id;
      queueMicrotask(() => {
        void this.inGroup(id, () => this.commitRemoval(rec, by, [])).catch(() => undefined);
      });
    }
  }

  /**
   * An invitation to a group (over our own channel, from an admin, or from
   * our other device): fetch the Welcome from the group's shard, join the MLS
   * group, and read the stream from the commit that added us.
   */
  private async receiveInvite(from: string, inv: Extract<Payload, { t: 'group-invite' }>): Promise<string | null> {
    if (!this.groupNet) return null;
    const existing = this.state.groups?.[inv.g];
    if (existing && !existing.left && existing.shard === inv.shard && existing.cursor >= inv.seq) return null;
    let welcome: Uint8Array;
    try {
      welcome = await this.downloadBlob(inv.shard, inv.g, BigInt(inv.blob), inv.chunks);
    } catch (e) {
      console.warn('OpenSocial: group Welcome:', e);
      return null;
    }
    const joined = await this.withMlsDevice(async (m) => {
      try {
        const gid = m.groupJoin(welcome);
        await this.saveMls();
        return gid;
      } catch {
        return null; // a Welcome for other devices of ours, or one we already used
      }
    });
    if (joined !== inv.g) return null;
    const key = groupKey(inv.g);
    const now = Date.now();
    if (existing) {
      existing.shard = inv.shard;
      existing.cursor = inv.seq;
      delete existing.own;
      delete existing.left;
      this.addNotice(key, { kind: 'joined', by: from }, now);
      return key;
    }
    // Until the group's state arrives in the stream: its name, us, and who added us (version 0).
    const placeholder: GroupState = {
      id: inv.g,
      name: inv.name,
      about: '',
      photo: '',
      members: [
        { account: from, role: 'owner', addedBy: from, addedAt: now },
        ...(from === this.account ? [] : [{ account: this.account, role: 'member' as const, addedBy: from, addedAt: now }]),
      ],
      onlyAdminsPost: false,
      onlyAdminsEdit: false,
      version: 0,
      updatedAt: 0,
      updatedBy: from,
    };
    const friend = from === this.account || (!!this.state.contacts[from]?.known && !this.state.contacts[from]?.blocked);
    this.addGroup(
      placeholder,
      inv.shard,
      inv.seq,
      friend,
      from === this.account ? { kind: 'created', by: this.account } : { kind: 'joined', by: from },
      now,
    );
    return key;
  }

  /**
   * Reads every group we are in that has new entries: one heads query per
   * shard (free), then the new entries in order. `only`: just this group (the
   * open chat, polled more often).
   */
  async pollGroups(only?: string): Promise<void> {
    if (!this.groupNet) return;
    if (only) return this.pollOpenGroup(only);
    const live = Object.values(this.state.groups ?? {}).filter((r) => !r.left && (!only || r.state.id === only));
    if (live.length === 0) return;
    const byShard = new Map<string, GroupRecord[]>();
    for (const r of live) byShard.set(r.shard, [...(byShard.get(r.shard) ?? []), r]);
    let changed = false;
    await Promise.all(
      [...byShard].map(async ([shard, recs]) => {
        let heads: StreamHead[];
        try {
          heads = await this.net().heads(
            shard,
            recs.map((r) => r.state.id),
          );
        } catch {
          return;
        }
        for (const rec of recs) {
          const h = heads.find((x) => x.group === rec.state.id);
          if (!h) {
            // The shard no longer lets us in: we were removed.
            if (!rec.left) {
              rec.left = true;
              this.addNotice(groupKey(rec.state.id), { kind: 'removed', by: '', who: [this.account] }, Date.now());
              changed = true;
            }
            continue;
          }
          if (h.lastSeq <= rec.cursor) {
            this.groupSyncedAt.set(rec.state.id, Date.now());
            continue;
          }
          const keys = await this.inGroup(rec.state.id, () => this.syncGroup(rec));
          for (const key of keys) {
            const c = this.state.contacts[key];
            if (c && (c.archived || c.hidden)) {
              c.archived = false;
              c.hidden = false;
            }
          }
          changed = true;
        }
      }),
    );
    if (changed) {
      await this.persist();
      this.emit();
    }
    if (!only && Date.now() - this.devicesCheckedAt > GROUP_DEVICE_CHECK_MS) {
      this.devicesCheckedAt = Date.now();
      void this.addOwnDevices().catch((e) => console.warn('OpenSocial: group devices:', e));
    }
  }

  private devicesCheckedAt = 0;

  /** The open chat's group: its stream read directly (one query, no heads first). */
  private async pollOpenGroup(id: string): Promise<void> {
    const rec = this.state.groups?.[id];
    if (!rec || rec.left || rec.shard === '') return;
    // The read itself happens outside the group's lock, so sending never waits for it.
    let first: StreamEntry[];
    try {
      first = await this.net().read(rec.shard, id, rec.cursor);
    } catch (e) {
      if (e instanceof OpenSocialError && e.code === 'GROUP_NOT_MEMBER') await this.pollGroups();
      return;
    }
    this.groupSyncedAt.set(id, Date.now());
    if (first.length === 0) return;
    const keys = await this.inGroup(id, async () => {
      const got = new Set<string>();
      for (const e of first) {
        if (e.seq <= rec.cursor) continue;
        const key = await this.applyEntry(rec, e);
        if (key) got.add(key);
      }
      // A full page: there is more to read.
      if (first.length >= 500) for (const key of await this.syncGroup(rec)) got.add(key);
      return [...got];
    });
    if (keys.length > 0 || rec.left) {
      await this.persist();
      this.emit();
    }
  }

  /**
   * Our devices signed in after we joined a group are not in its MLS group
   * yet: our device with the smallest id among those in it adds them, and
   * tells them over our own channel.
   */
  private async addOwnDevices(): Promise<void> {
    const mine = await this.devicesOf(this.account, true);
    for (const rec of Object.values(this.state.groups ?? {})) {
      if (rec.left || rec.state.version === 0) continue;
      const id = rec.state.id;
      const inGroup = await this.withMlsDevice(async (m) =>
        (m.groupMembers(id) as string[]).filter((d) => d.startsWith(`${this.account}.`)).map((d) => d.slice(this.account.length + 1)),
      );
      const missing = mine.filter((d) => !inGroup.includes(d.deviceId));
      if (missing.length === 0 || [...inGroup].sort()[0] !== this.device.deviceId) continue;
      await this.inGroup(id, async () => {
        const kps = (
          await this.net().claimKeyPackages(missing.map((d) => ({ account: this.account, deviceId: d.deviceId })))
        ).filter((k): k is Uint8Array => !!k);
        if (kps.length === 0) return;
        const r = await this.groupCommit(rec, (m) => m.groupAdd(id, kps) as MlsCommit, [], []);
        if (!r.welcome) return;
        const invite: Payload = {
          t: 'group-invite',
          g: id,
          shard: rec.shard,
          seq: r.seq,
          blob: r.welcome.blob.toString(),
          chunks: r.welcome.chunks,
          name: rec.state.name,
        };
        await this.deliverAcross([this.account], [invite], Date.now());
        // The group as it is, for the new device (the others already have it).
        await this.postToGroup(rec, [{ t: 'group-state', s: rec.state } as unknown as Payload]);
      });
    }
  }

  /** Reads and applies a group's new stream entries, in order. Call inside inGroup. Returns chats that got messages. */
  private async syncGroup(rec: GroupRecord): Promise<string[]> {
    const keys = new Set<string>();
    this.groupSyncedAt.set(rec.state.id, Date.now());
    for (;;) {
      if (rec.left) break;
      let entries: StreamEntry[];
      try {
        entries = await this.net().read(rec.shard, rec.state.id, rec.cursor);
      } catch (e) {
        if (e instanceof OpenSocialError && e.code === 'GROUP_NOT_MEMBER') {
          rec.left = true;
          break;
        }
        throw e;
      }
      if (entries.length === 0) break;
      for (const e of entries) {
        const key = await this.applyEntry(rec, e);
        if (key) keys.add(key);
      }
    }
    return [...keys];
  }

  /** One stream entry: a commit (next epoch) or a message for the chat. */
  private async applyEntry(rec: GroupRecord, e: StreamEntry): Promise<string | null> {
    const id = rec.state.id;
    const own = rec.own?.indexOf(e.seq) ?? -1;
    if (own >= 0 || e.seq <= rec.cursor) {
      if (own >= 0) rec.own!.splice(own, 1);
      rec.cursor = Math.max(rec.cursor, e.seq);
      return null;
    }
    rec.cursor = e.seq;
    if (e.from === this.account && e.device === this.device.deviceId) {
      // Ours, from before a restart: a commit we made is taken.
      if (e.kind === 'Commit') {
        await this.withMlsDevice(async (m) => {
          if (m.groupHasPending(id)) m.groupMerge(id);
          await this.saveMls();
        });
      }
      return null;
    }
    let r: { kind: string; sender: string; data?: Uint8Array; selfRemoved?: boolean };
    try {
      r = await this.withMlsDevice(async (m) => {
        const out = m.groupProcess(id, e.data) as typeof r;
        await this.saveMls();
        return out;
      });
    } catch (err) {
      console.warn('OpenSocial: group entry', e.seq, err);
      return null;
    }
    // The MLS sender must be the account the shard saw posting it.
    if (!r.sender.startsWith(`${e.from}.`)) return null;
    if (r.kind === 'commit') {
      if (r.selfRemoved) {
        rec.left = true;
        await this.withMlsDevice(async (m) => {
          m.groupDelete(id);
          await this.saveMls();
        });
      }
      return null;
    }
    const payload = parsePayload(fromUtf8(r.data!));
    if (payload.t !== 'group' || payload.g !== id) return null;
    return this.receiveGroup(e.from, payload, Math.min(e.atMs, Date.now()), `g:${id}`, e.seq);
  }

  /** A group message from `from`; returns the group's chat if a message or a line was added. */
  private async receiveGroup(
    from: string,
    w: Extract<Payload, { t: 'group' }>,
    sentAt: number,
    chainKey: string,
    seq: number,
  ): Promise<string | null> {
    const key = groupKey(w.g);
    const rec = this.state.groups?.[w.g];
    if (!rec || rec.left) return null;
    if (w.n && from !== this.account) rec.names[from] = w.n;
    const p = w.p;
    if (p.t === 'group-state') {
      const s = sanitizeGroup(p.s);
      if (!s || s.id !== w.g || !isNewer(s, rec.state)) return null;
      if (rec.state.version === 0) {
        // Just joined: the first full state, from someone in charge of the group (or our own device), that lists us.
        if (!(isAdmin(s, from) || from === this.account) || !isMember(s, this.account)) return null;
        rec.state = s;
        const c = this.state.contacts[key];
        if (c) {
          c.name = s.name;
          if (s.photo) c.photo = s.photo;
        }
        return key;
      }
      if (!mayChange(rec.state, s, from)) return null;
      this.applyChange(rec, s, from, sentAt);
      return key;
    }
    if (!isMember(rec.state, from)) return null;
    if ((p.t === 'text' || p.t === 'file' || p.t === 'file-sia') && !canPost(rec.state, from)) return null;
    return (await this.receiveContent(key, from, p, sentAt, chainKey, seq, false)) ? key : null;
  }

  /** Sends a group file: encrypted once, stored once in the group's shard; the key goes in the message. */
  private groupUploader(id: string): SiaUploader {
    return async (cipher, size, progress) => {
      const rec = this.liveGroup(id);
      const parts: Uint8Array[] = [];
      const reader = cipher().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
      const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let off = 0;
      for (const p of parts) {
        bytes.set(p, off);
        off += p.length;
      }
      if (bytes.length !== size) throw new OpenSocialError('FILE_FAILED', 'The file changed while it was being sent.');
      const { blob, chunks } = await this.uploadBlob(rec, bytes, (d, n) => progress(d / n));
      return { seed: `${GROUP_BLOB_SEED}${rec.shard}:${id}`, objectId: `${blob}:${chunks}` };
    };
  }

  /** Fetches a small group file into this device's store (then it shows like an inline file). */
  private async fetchGroupFile(key: string, fileId: string): Promise<void> {
    const a = this.findMessage(key, fileId)?.attachment;
    if (!a || a.state !== 'remote') return;
    const opened = await this.openFile(key, fileId, async () => {
      throw new OpenSocialError('FILE_UNKNOWN', 'Not a Sia file.');
    });
    const bytes = new Uint8Array(await new Response(opened.stream).arrayBuffer());
    await this.store.setBytes(this.fileKey(fileId), bytes);
    a.state = 'ready';
    a.done = a.total;
    await this.persist();
    this.emit();
  }

  /** Downloads a group file's encrypted bytes (see groupUploader). */
  private groupDownload(seed: string, objectId: string): ReadableStream<Uint8Array> {
    const [shard, group] = seed.slice(GROUP_BLOB_SEED.length).split(':');
    const [blob, chunks] = objectId.split(':');
    const all = this.downloadBlob(shard!, group!, BigInt(blob!), Number(chunks));
    return new ReadableStream<Uint8Array>({
      start: async (c) => {
        try {
          c.enqueue(await all);
          c.close();
        } catch (e) {
          c.error(e);
        }
      },
    });
  }

  /* ------------------------------------------------------------- events --- */

  /** Events we organize or were invited to. */
  events(): ZEvent[] {
    return Object.values(this.state.events ?? {});
  }

  event(id: string): ZEvent | undefined {
    return this.state.events?.[id];
  }

  eventReminder(id: string): Reminder {
    return this.state.eventReminders?.[id] ?? 15;
  }

  async setEventReminder(id: string, minutes: Reminder): Promise<void> {
    (this.state.eventReminders ??= {})[id] = minutes;
    await this.persist();
  }

  /**
   * Creates an event and invites friends: each gets it in our chat with them.
   * Returns its id.
   */
  async createEvent(input: EventInput): Promise<string> {
    const id = toHex(randomBytes(8));
    const ev = this.checkEvent({ ...input, id, responses: {}, updatedAt: Date.now() });
    (this.state.events ??= {})[id] = ev;
    await this.persist();
    await this.inviteAll(ev, ev.invitees);
    return id;
  }

  /** Changes one of our events; everyone invited gets the new version, newly invited friends an invite. */
  async updateEvent(id: string, input: EventInput): Promise<void> {
    const old = this.ownEvent(id);
    const responses = Object.fromEntries(Object.entries(old.responses).filter(([who]) => input.invitees.includes(who)));
    const ev = this.checkEvent({ ...input, id, responses, updatedAt: Date.now(), cancelled: old.cancelled });
    this.state.events![id] = ev;
    await this.persist();
    const added = ev.invitees.filter((a) => !old.invitees.includes(a));
    const removed = old.invitees.filter((a) => !ev.invitees.includes(a));
    // Uninvited friends get the event once more without them in it: their app drops it.
    await Promise.all([
      this.inviteAll(ev, added),
      this.broadcast(ev, ev.invitees.filter((a) => !added.includes(a))),
      this.broadcast(ev, removed),
    ]);
  }

  /** Cancels one of our events (it stays, marked cancelled, for everyone). */
  async cancelEvent(id: string): Promise<void> {
    const ev = this.ownEvent(id);
    ev.cancelled = true;
    ev.updatedAt = Date.now();
    await this.persist();
    await this.broadcast(ev, ev.invitees);
  }

  /** Removes an event from this device (ours are cancelled for everyone first). */
  async deleteEvent(id: string): Promise<void> {
    const ev = this.state.events?.[id];
    if (!ev) return;
    if (ev.organizer === this.account && !ev.cancelled && eventEnd(ev) > Date.now()) await this.cancelEvent(id);
    delete this.state.events![id];
    delete this.state.eventReminders?.[id];
    await this.persist();
  }

  /** Our reply to an event we were invited to; the organizer shares it with everyone invited. */
  async respondEvent(id: string, r: Rsvp): Promise<void> {
    const ev = this.state.events?.[id];
    if (!ev || ev.organizer === this.account || !ev.invitees.includes(this.account)) return;
    ev.responses = { ...ev.responses, [this.account]: r };
    await this.persist();
    await this.deliver(ev.organizer, { t: 'event-rsvp', id, r }, Date.now());
  }

  private ownEvent(id: string): ZEvent {
    const ev = this.state.events?.[id];
    if (!ev || ev.organizer !== this.account) throw new OpenSocialError('NOT_FOUND', 'Only the organizer can change this event.');
    return ev;
  }

  /** Checks an event we are about to save: friends only, valid fields. */
  private checkEvent(raw: Omit<ZEvent, 'organizer'>): ZEvent {
    const ev = sanitizeEvent({ ...raw, organizer: this.account }, this.account);
    if (!ev) throw new OpenSocialError('INVALID_INPUT', 'The event needs a title and a start time.');
    const strangers = ev.invitees.filter((a) => !this.state.contacts[a]?.known || this.state.contacts[a]?.blocked);
    if (strangers.length) throw new OpenSocialError('INVALID_INPUT', 'Only friends can be invited.');
    return ev;
  }

  /** Invites: a message with the event in our chat with each friend. */
  private async inviteAll(ev: ZEvent, accounts: string[]): Promise<void> {
    await Promise.all(
      accounts.map(async (account) => {
        const msg: RealMessage = {
          id: toHex(randomBytes(8)),
          direction: 'out',
          body: '',
          eventId: ev.id,
          sentAt: Date.now(),
          status: 'sending',
          verified: false,
        };
        (this.state.messages[account] ??= []).push(msg);
        this.emit();
        try {
          await this.deliver(account, { t: 'event', ev: wireEvent(ev) }, msg.sentAt);
          msg.status = 'sent';
        } catch {
          msg.status = 'failed';
        }
      }),
    );
    await this.persist();
  }

  /** Sends the event as it is now (no new chat message). */
  private async broadcast(ev: ZEvent, accounts: string[]): Promise<void> {
    await Promise.all(
      accounts.map((a) => this.deliver(a, { t: 'event', ev: wireEvent(ev) }, Date.now()).catch(() => undefined)),
    );
  }

  /** An event from its organizer: new ones arrive as a message in their chat. */
  private receiveEvent(from: string, raw: unknown, sentAt: number): boolean {
    const contact = this.state.contacts[from];
    if (!contact?.known || contact.blocked) return false;
    const ev = sanitizeEvent(raw, from);
    if (!ev) return false;
    const existing = this.state.events?.[ev.id];
    if (existing && (existing.organizer !== from || existing.updatedAt > ev.updatedAt)) return false;
    if (!ev.invitees.includes(this.account)) {
      // We were taken off the list.
      if (existing) delete this.state.events![ev.id];
      void this.persist();
      return false;
    }
    (this.state.events ??= {})[ev.id] = ev;
    const shown = (this.state.messages[from] ?? []).some((m) => m.eventId === ev.id);
    if (shown) {
      void this.persist();
      return false;
    }
    insertBySentAt((this.state.messages[from] ??= []), {
      id: `event:${ev.id}`,
      direction: 'in',
      body: '',
      eventId: ev.id,
      sentAt,
      status: 'delivered',
      verified: true,
    });
    return true;
  }

  /** A reply to one of our events: recorded and shared with everyone invited. */
  private receiveRsvp(from: string, id: string, r: Rsvp) {
    const ev = this.state.events?.[id];
    if (!ev || ev.organizer !== this.account || ev.cancelled || !ev.invitees.includes(from)) return;
    if (ev.responses[from] === r) return;
    ev.responses = { ...ev.responses, [from]: r };
    ev.updatedAt = Date.now();
    void this.persist();
    void this.broadcast(ev, ev.invitees);
  }

  async retryMessage(account: string, messageId: string): Promise<void> {
    const m = (this.state.messages[account] ?? []).find((x) => x.id === messageId);
    if (!m || m.direction !== 'out' || m.status !== 'failed') return;
    if (m.attachment) return this.retryFile(account, m.attachment.fileId);
    m.status = 'sending';
    this.emit();
    try {
      await this.deliver(account, this.payloadOf(m), m.sentAt);
      m.status = 'sent';
    } catch (e) {
      m.status = 'failed';
      throw e;
    } finally {
      await this.persist();
    }
  }

  canRetry(fileId: string): boolean {
    if (this.sending.has(fileId)) return true;
    // Inline files are kept here: any that failed can be sent again.
    return Object.values(this.state.messages).some((list) =>
      list.some((m) => m.direction === 'out' && m.attachment?.fileId === fileId && m.attachment.via === 'inline' && m.attachment.state === 'failed'),
    );
  }

  async retryFile(account: string, fileId: string): Promise<void> {
    const m = this.findMessage(account, fileId);
    const a = m?.attachment;
    if (m && a?.via === 'inline' && a.state === 'failed') {
      const bytes = await this.fileBytes(fileId);
      if (!bytes) throw new OpenSocialError('FILE_MISSING', 'This file is no longer on this device. Send it again.');
      const { name, mime, size } = a;
      await this.deliverInline(account, m, { fileId, name, mime, size, ...mediaInfo({ ...a, caption: m.body }) }, bytes);
      return;
    }
    if (!m?.attachment || !this.sending.has(fileId)) throw new OpenSocialError('FILE_UNKNOWN', 'Send the file again.');
    const { name, mime, size } = m.attachment;
    await this.uploadLarge(account, m, { fileId, name, mime, size, ...mediaInfo({ ...m.attachment, caption: m.body }) });
  }

  /** Copies a file into the device store in chunks, never whole in memory. Returns the chunk count. */
  private async storeChunks(fileId: string, source: FileSource): Promise<number> {
    const chunks = chunkCount(source.size);
    for (let i = 0; i < chunks; i++) {
      const part = await source.read(i * FILE_CHUNK_BYTES, Math.min(source.size, (i + 1) * FILE_CHUNK_BYTES));
      await this.store.setBytes(`${this.fileKey(fileId)}:c${i}`, part);
    }
    return chunks;
  }

  /** Reads a file kept in chunks on this device as a FileSource (chunk-aligned reads). */
  private chunkSource(fileId: string, a: Attachment): FileSource {
    return {
      name: a.name,
      mime: a.mime,
      size: a.size,
      read: async (start) => {
        const i = Math.floor(start / FILE_CHUNK_BYTES);
        const part = await this.store.getBytes(`${this.fileKey(fileId)}:c${i}`);
        if (!part) throw new OpenSocialError('FILE_MISSING', 'Part of this file is missing on this device.');
        return part;
      },
    };
  }

  /** A note-to-self file: on this device only; large ones in chunks, never whole in memory. */
  private async saveNoteFile(fileId: string, source: FileSource & { thumb?: string; voice?: VoiceInfo; caption?: string }) {
    const large = source.size > INLINE_MAX_BYTES;
    let chunks = 0;
    if (large) {
      chunks = await this.storeChunks(fileId, source);
    } else {
      await this.store.setBytes(this.fileKey(fileId), await source.read(0, source.size));
    }
    (this.state.messages[this.account] ??= []).push({
      id: toHex(randomBytes(8)),
      direction: 'out',
      body: source.caption?.slice(0, MAX_CAPTION) ?? '',
      sentAt: Date.now(),
      status: 'sent',
      verified: true,
      attachment: {
        fileId,
        name: source.name.slice(0, 200),
        mime: source.mime || 'application/octet-stream',
        size: source.size,
        via: 'inline',
        state: 'ready',
        done: 1,
        total: 1,
        ...(large ? { localChunks: chunks } : {}),
        ...mediaInfo(source),
      },
    });
    await this.persist();
  }

  /* ----------------------------------------------- large files over links --- */

  /**
   * Large file without Sia: kept on this device (in chunks) and offered to
   * every device of the friend. Each device fetches it over a direct link when
   * one is open, from its first missing chunk, so it resumes after a drop.
   */
  private async sendP2P(account: string, fileId: string, source: FileSource & { thumb?: string; voice?: VoiceInfo; caption?: string }) {
    const chunks = await this.storeChunks(fileId, source);
    const devices = (await this.devicesOf(account, true)).map((d) => d.deviceId);
    const raw = randomBytes(32);
    const base = randomBytes(8);
    const meta: FileMeta = {
      fileId,
      name: source.name.slice(0, 200),
      mime: source.mime || 'application/octet-stream',
      size: source.size,
      ...mediaInfo(source),
    };
    const msg: RealMessage = {
      id: toHex(randomBytes(8)),
      direction: 'out',
      body: meta.caption ?? '',
      sentAt: Date.now(),
      status: 'sending',
      verified: false,
      attachment: { ...meta, via: 'p2p', state: 'sending', done: 0, total: 100, localChunks: chunks },
    };
    (this.state.messages[account] ??= []).push(msg);
    (this.state.outgoing ??= {})[fileId] = { account, chunks, key: toBase64(raw), iv: toBase64(base), devices, done: [] };
    await this.persist();
    await this.deliver(account, { t: 'file-p2p', ...meta, key: toBase64(raw), iv: toBase64(base), chunks }, msg.sentAt);
    msg.status = 'sent';
    await this.persist();
    // Don't only wait for the friend: offer a link ourselves (within the offer budget).
    void this.warm(account, 'resume');
  }

  /**
   * While large files wait for a friend who is active, keep trying to open a
   * link (bounded by the per-device offer budget). Called on each poll.
   */
  private retryWaitingLinks() {
    const accounts = new Set(Object.values(this.state.outgoing ?? {}).map((o) => o.account));
    for (const account of accounts) {
      if (this.seenRecently(account) && this.linkStatus(account) === 'none') void this.warm(account, 'activity');
    }
  }

  /** Receiver: asks a sending device for the next chunk of each file still coming from it. */
  private requestMissing(account: string, deviceId: string) {
    for (const m of this.state.messages[account] ?? []) {
      const p = m.attachment?.p2p;
      if (p && p.fromDevice === deviceId && p.received < p.chunks) {
        this.links?.sendFileControl(account, deviceId, { t: 'file-want', fileId: m.attachment!.fileId, from: p.received });
      }
    }
  }

  /** Sender: which (file, device) streams are running, so a request doesn't start a second one. */
  private serving = new Set<string>();

  /** Sender: streams sealed chunks from `from` to a device that asked for them. */
  private async serveFile(account: string, deviceId: string, fileId: string, from: number) {
    const out = this.state.outgoing?.[fileId];
    if (!out || out.account !== account || from >= out.chunks) return;
    const job = `${fileId}:${deviceId}`;
    if (this.serving.has(job)) return;
    this.serving.add(job);
    const a = this.findMessage(account, fileId)?.attachment;
    try {
      const key = await importFileKey(fromBase64(out.key));
      const base = fromBase64(out.iv);
      for (let i = from; i < out.chunks; i++) {
        const plain = await this.store.getBytes(`${this.fileKey(fileId)}:c${i}`);
        if (!plain) return;
        const sealed = await sealChunk(key, base, i, out.chunks, plain);
        for (let off = 0; off < sealed.length; off += FILE_PART_BYTES) {
          const end = off + FILE_PART_BYTES >= sealed.length;
          const ok = await this.links!.sendFilePart(account, deviceId, {
            fileId,
            chunk: i,
            end,
            data: sealed.subarray(off, off + FILE_PART_BYTES),
          });
          if (!ok) return; // link closed: the receiver asks again from where it is
        }
        if (a && a.state === 'sending') {
          a.done = Math.max(a.done, Math.round(((i + 1) / out.chunks) * 100));
          this.emit();
        }
      }
    } finally {
      this.serving.delete(job);
    }
  }

  /** Sender: a device has the whole file. When all have it, the offer is closed. */
  private async fileDelivered(account: string, deviceId: string, fileId: string) {
    const out = this.state.outgoing?.[fileId];
    if (!out || out.account !== account) return;
    if (!out.done.includes(deviceId)) out.done.push(deviceId);
    const a = this.findMessage(account, fileId)?.attachment;
    if (a) {
      a.state = 'ready';
      a.done = 100;
    }
    if (out.devices.every((d) => out.done.includes(d))) delete this.state.outgoing![fileId];
    await this.persist();
  }

  /** Receiver: parts of the chunk being received, by fileId. */
  private partial = new Map<string, Uint8Array[]>();

  /** Receiver: parts are handled strictly one after another per file (decrypting and storing take time). */
  private partQueue = new Map<string, Promise<void>>();

  private receivePart(account: string, deviceId: string, part: FilePart): Promise<void> {
    const prev = this.partQueue.get(part.fileId) ?? Promise.resolve();
    const next = prev.then(() => this.receivePartNow(account, deviceId, part)).catch(() => undefined);
    this.partQueue.set(part.fileId, next);
    return next;
  }

  /** Receiver: collects parts; checks and stores each completed chunk; confirms the whole file. */
  private async receivePartNow(account: string, deviceId: string, part: FilePart) {
    const a = this.findMessage(account, part.fileId)?.attachment;
    const p = a?.p2p;
    if (!a || !p || p.fromDevice !== deviceId || part.chunk !== p.received) return;
    const parts = this.partial.get(part.fileId) ?? [];
    parts.push(part.data);
    this.partial.set(part.fileId, parts);
    if (!part.end) return;
    this.partial.delete(part.fileId);
    const sealed = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let off = 0;
    for (const x of parts) {
      sealed.set(x, off);
      off += x.length;
    }
    let plain: Uint8Array;
    try {
      plain = await openChunk(await importFileKey(fromBase64(p.key)), fromBase64(p.iv), p.received, p.chunks, sealed);
    } catch {
      // Damaged or out of place: ask for this chunk again.
      this.links?.sendFileControl(account, deviceId, { t: 'file-want', fileId: part.fileId, from: p.received });
      return;
    }
    await this.store.setBytes(`${this.fileKey(part.fileId)}:c${p.received}`, plain);
    p.received++;
    a.done = p.received;
    if (p.received === p.chunks) {
      a.localChunks = p.chunks;
      a.state = 'ready';
      delete a.p2p;
      this.links?.sendFileControl(account, deviceId, { t: 'file-done', fileId: part.fileId });
      queueMicrotask(() => this.partQueue.delete(part.fileId));
    }
    await this.persist();
  }

  /** Sender: sends a waiting large file through the user's Sia space instead (no waiting for the friend). */
  async sendViaSia(account: string, fileId: string, sia: SiaUploader): Promise<void> {
    const out = this.state.outgoing?.[fileId];
    const m = this.findMessage(account, fileId);
    const a = m?.attachment;
    if (!out || !a) throw new OpenSocialError('FILE_UNKNOWN', 'This file is no longer waiting.');
    const key = await importFileKey(fromBase64(out.key));
    a.done = 0;
    this.emit();
    // Same key and nonce base as offered: the friend can decrypt either copy.
    const shared = await sia(() => encryptStream(this.chunkSource(fileId, a), key, fromBase64(out.iv)), ciphertextSize(a.size), (f) => {
      a.done = Math.min(99, Math.round(f * 100));
      this.emit();
    });
    const ref = { seed: shared.seed, objectId: shared.objectId, key: out.key, iv: out.iv };
    const { name, mime, size } = a;
    await this.deliver(account, { t: 'file-sia', fileId, name, mime, size, ...mediaInfo({ ...a, caption: m!.body }), ...ref }, m!.sentAt);
    a.sia = ref;
    a.state = 'ready';
    a.done = 100;
    delete this.state.outgoing![fileId];
    await this.persist();
  }

  /** Keeps a copy of a file (stored on this device) in the user's own Sia space. */
  async saveToMySia(account: string, fileId: string, sia: SiaUploader): Promise<void> {
    const a = this.findMessage(account, fileId)?.attachment;
    if (!a) throw new OpenSocialError('FILE_UNKNOWN', 'File not found.');
    const small = !a.localChunks ? await this.fileBytes(fileId) : null;
    if (!a.localChunks && !small) throw new OpenSocialError('FILE_MISSING', 'This file is not on this device yet.');
    const source = small ? { name: a.name, mime: a.mime, size: small.length, read: async (s0: number, e: number) => small.subarray(s0, e) } : this.chunkSource(fileId, a);
    const raw = randomBytes(32);
    const base = randomBytes(8);
    const fileKey = await importFileKey(raw);
    const shared = await sia(() => encryptStream(source, fileKey, base), ciphertextSize(source.size), () => undefined);
    a.backup = { seed: shared.seed, objectId: shared.objectId, key: toBase64(raw), iv: toBase64(base) };
    await this.persist();
  }

  /** A waiting outgoing large file (offered over links, not yet everywhere). */
  isWaiting(fileId: string): boolean {
    return !!this.state.outgoing?.[fileId];
  }

  /**
   * Opens an attachment as a plaintext stream (to save or play): from this
   * device when stored here, else from the sender's Sia space, decrypted while
   * it downloads.
   */
  async openFile(account: string, fileId: string, download: SiaDownloader): Promise<OpenedFile> {
    const a = this.findMessage(account, fileId)?.attachment;
    if (!a) throw new OpenSocialError('FILE_UNKNOWN', 'File not found.');
    const info = { name: a.name, mime: a.mime, size: a.size };
    if (a.localChunks) {
      let i = 0;
      const n = a.localChunks;
      const key = this.fileKey(fileId);
      return {
        ...info,
        stream: new ReadableStream<Uint8Array>({
          pull: async (c) => {
            if (i >= n) return c.close();
            const part = await this.store.getBytes(`${key}:c${i++}`);
            if (!part) return c.error(new Error('Part of this file is missing on this device.'));
            c.enqueue(part);
          },
        }),
      };
    }
    const local = await this.fileBytes(fileId);
    if (local) {
      return { ...info, stream: new Response(new Blob([local])).body! };
    }
    const remote = a.sia ?? a.backup;
    if (!remote) throw new OpenSocialError('FILE_UNKNOWN', 'This file is not on this device yet.');
    const cipher = remote.seed.startsWith(GROUP_BLOB_SEED)
      ? this.groupDownload(remote.seed, remote.objectId)
      : await download(remote.seed, remote.objectId);
    const key = await importFileKey(fromBase64(remote.key));
    return { ...info, stream: decryptStream(cipher, key, fromBase64(remote.iv), a.size) };
  }

  /** Stores one received chunk; assembles the file when all chunks are in. */
  private async receiveChunk(key: string, from: string, c: FileChunk, sentAt: number, verified: boolean) {
    if (this.state.retracted?.includes(c.fileId)) return; // withdrawn by the sender
    const list = (this.state.messages[key] ??= []);
    let m = list.find((x) => x.attachment?.fileId === c.fileId);
    if (!m) {
      m = {
        id: `file:${c.fileId}`,
        direction: 'in',
        body: c.caption ?? '',
        sentAt,
        status: 'delivered',
        verified,
        ...(isGroupKey(key) ? { from } : {}),
        attachment: {
          fileId: c.fileId,
          name: c.name,
          mime: c.mime,
          size: c.size,
          via: 'inline',
          state: 'receiving',
          done: 0,
          total: c.n,
          ...mediaInfo(c),
        },
      };
      insertBySentAt(list, m);
    }
    const a = m.attachment!;
    if (c.thumb && !a.thumb) a.thumb = c.thumb;
    if (c.voice && !a.voice) a.voice = c.voice;
    if (c.caption && !m.body) m.body = c.caption;
    // A resent file repeats chunks already here: count each chunk once.
    const have = (a.have ??= []);
    if (have.includes(c.i)) return;
    await this.store.setBytes(`${this.fileKey(c.fileId)}:${c.i}`, fromBase64(c.data));
    have.push(c.i);
    a.done = have.length;
    if (a.done === a.total) {
      const parts: Uint8Array[] = [];
      for (let i = 0; i < a.total; i++) {
        const p = await this.store.getBytes(`${this.fileKey(c.fileId)}:${i}`);
        if (!p) return; // not complete yet (shouldn't happen: chunks arrive in order)
        parts.push(p);
      }
      const all = new Uint8Array(parts.reduce((x, p) => x + p.length, 0));
      let off = 0;
      for (const p of parts) {
        all.set(p, off);
        off += p.length;
      }
      await this.store.setBytes(this.fileKey(c.fileId), all);
      a.state = 'ready';
      delete a.have;
    }
  }

  /** Fetches, verifies and stores new messages. Returns how many were added. */
  /** Fetches our inbox (one-to-one messages, group invitations), then the group streams. */
  async poll(): Promise<number> {
    const added = await this.serialRecv(() => this.pollNow());
    await this.pollGroups().catch((e) => console.warn('OpenSocial: group poll:', e));
    return added;
  }

  private async pollNow(): Promise<number> {
    if (this.polling) return 0;
    this.retryWaitingLinks();
    this.polling = true;
    let added = 0;
    try {
      const items = await this.delivery.fetch(this.device.deviceId, BigInt(this.state.cursor));
      let maxId = BigInt(this.state.cursor);
      for (const item of items) {
        if (item.id > maxId) maxId = item.id;
        try {
          if (await this.acceptEntry(item.from, item.entry)) added++;
        } catch (e) {
          // Unverifiable entries are dropped; the sender is not trusted.
          console.warn('OpenSocial: dropped an incoming entry:', e instanceof Error ? e.message : e);
        }
      }
      if (items.length > 0) {
        this.state.cursor = maxId.toString();
        await this.persist();
        await this.delivery.ack(this.device.deviceId, maxId);
        // Tell direct peers how far their chains are processed (lets them switch to the link).
        if (this.links) {
          // A friend who just sent something is online: try a direct link (bounded by the budget).
          for (const from of new Set(items.map((i) => i.from))) {
            if (!this.isDirect(from)) void this.warm(from, 'activity');
          }
          for (const item of items) {
            try {
              const e = decodeEntry(item.entry);
              const last = this.state.recvChains[`${e.from}:${e.device}`]?.seq;
              if (last) this.links.ack(e.from, e.device, last);
            } catch {
              // ignore
            }
          }
        }
      }
    } finally {
      this.polling = false;
    }
    return added;
  }

  /** Accepts one entry; a new message from a friend is confirmed as delivered. */
  private async acceptEntry(transportFrom: string, raw: Uint8Array, transportDevice?: string): Promise<boolean> {
    const key = await this.acceptEntryNow(transportFrom, raw, transportDevice);
    if (!key) return false;
    // A new message brings an archived or deleted chat back into the list.
    const c = this.state.contacts[key];
    if (c && (c.archived || c.hidden)) {
      c.archived = false;
      c.hidden = false;
    }
    if (key === transportFrom) this.sendReceipt(transportFrom, 'delivered');
    return true;
  }

  /** Accepts one entry; returns the chat that got a new message, if any. */
  private async acceptEntryNow(transportFrom: string, raw: Uint8Array, transportDevice?: string): Promise<string | null> {
    const entry: LogEntry = decodeEntry(raw);
    if (entry.from !== transportFrom) throw new OpenSocialError('ENTRY_SENDER', 'Sender mismatch.');
    if (transportDevice && entry.device !== transportDevice) throw new OpenSocialError('ENTRY_SENDER', 'Device mismatch.');
    if (this.state.contacts[entry.from]?.blocked) return null;
    const senderDevice = (await this.devicesOf(entry.from)).find((d) => d.deviceId === entry.device) ??
      (await this.devicesOf(entry.from, true)).find((d) => d.deviceId === entry.device);
    if (!senderDevice) throw new OpenSocialError('ENTRY_DEVICE', 'Unknown sender device.');
    if (!(await verifyEntry(entry, senderDevice.signingKey))) {
      throw new OpenSocialError('ENTRY_SIGNATURE', 'Bad entry signature.');
    }
    // Only fresh entries show the friend is active now (not old mail read later).
    if (Date.now() - entry.sentAt < 120_000) this.lastSeen.set(entry.from, Date.now());
    if (entry.conv !== (await directConversationId(this.account, entry.from))) {
      throw new OpenSocialError('ENTRY_CONV', 'Wrong conversation.');
    }
    const chainKey = `${entry.from}:${entry.device}`;
    const last = this.state.recvChains[chainKey] ?? { seq: 0, hash: '' };
    if (entry.seq <= last.seq) return null; // duplicate or replay
    if (entry.v !== 3) throw new OpenSocialError('ENTRY_VERSION', 'Unsupported message format.');
    const packed = fromBase64(entry.envelope);
    const kind = packed[0]!;
    const remote = this.address(entry.from, entry.device);
    const plain = await this.withMls(async () => {
      let p: Uint8Array | undefined;
      try {
        if (kind === KIND_WELCOME) {
          this.mls.acceptWelcome(remote, packed.subarray(1));
          this.welcomesSinceCheck++;
        } else if (kind === KIND_MESSAGE) {
          p = this.mls.decrypt(remote, packed.subarray(1)) ?? undefined;
        } else {
          throw new OpenSocialError('ENTRY_KIND', 'Unknown message kind.');
        }
      } catch (e) {
        // A verified entry from a known device we can't decrypt: our copy of
        // their channel is missing or out of step. Ask them for a new one.
        if (kind === KIND_WELCOME || kind === KIND_MESSAGE) this.requestRepair(entry.from, entry.device, entry.sentAt);
        throw e;
      }
      await this.saveMls();
      return p;
    });
    // The device is alive and running an app that reached us: try it again at once.
    this.unreachable.delete(this.address(entry.from, entry.device));
    const gap = entry.seq !== last.seq + 1 || entry.prev !== last.hash;
    // The entry is consumed either way (a Welcome or a commit carries no text).
    this.state.recvChains[chainKey] = { seq: entry.seq, hash: await entryHash(entry) };
    if (this.welcomesSinceCheck >= 5) {
      this.welcomesSinceCheck = 0;
      void this.withMls(() => this.topUpKeyPackages()).catch(() => undefined);
    }
    // A Welcome or a commit carries no message.
    if (!plain) return null;
    const payload = parsePayload(fromUtf8(plain));
    const sentAt = entry.sentAt;
    // From another device of our own account: profile-key sync, and the groups we change there.
    if (entry.from === this.account) {
      if (payload.t === 'profile-key-request' && this.myKey) {
        void this.deliverMany(this.account, [{ t: 'profile-key', ...this.myKey }], Date.now(), false, undefined, entry.device).catch(
          () => undefined,
        );
      }
      if (payload.t === 'profile-key') this.onOwnProfileKey?.({ key: payload.key, version: payload.version });
      // A group made (or joined) on another device of ours.
      if (payload.t === 'group-invite') return this.receiveInvite(entry.from, payload);
      return null;
    }
    // Group invitations never make the sender a contact (group messages come from the group's stream).
    if (payload.t === 'group-invite') return this.receiveInvite(entry.from, payload);
    if (payload.t === 'group-removed') {
      const rec = this.state.groups?.[payload.g];
      if (rec && !rec.left && roleOf(rec.state, entry.from) && isAdmin(rec.state, entry.from)) {
        rec.left = true;
        this.addNotice(groupKey(payload.g), { kind: 'removed', by: entry.from, who: [this.account] }, sentAt);
        return groupKey(payload.g);
      }
      return null;
    }
    if (payload.t === 'group') return null;
    const contact = (this.state.contacts[entry.from] ??= {
      account: entry.from,
      name: RealMessaging.shortId(entry.from),
      addedAt: Date.now(),
      known: false,
    });
    if (payload.t === 'call') {
      // Call setup: only from friends, from the device that signed it.
      if (contact.known && !contact.blocked && payload.device === entry.device) {
        void this.calls?.handle(entry.from, entry.device, payload).catch((e) => console.warn('OpenSocial: call:', e));
      }
      return null;
    }
    if (payload.t === 'rtc') {
      // Direct-link signaling: only from friends; never shown as a message.
      if (contact.known && !contact.blocked && payload.from === entry.device) {
        void this.links?.handleSignal(entry.from, payload);
      }
      return null;
    }
    if (payload.t === 'file-p2p') {
      if (this.state.retracted?.includes(payload.fileId)) return null;
      insertBySentAt((this.state.messages[entry.from] ??= []), {
        id: `file:${payload.fileId}`,
        direction: 'in',
        body: payload.caption ?? '',
        sentAt,
        status: 'delivered',
        verified: true,
        attachment: {
          fileId: payload.fileId,
          name: payload.name,
          mime: payload.mime,
          size: payload.size,
          via: 'p2p',
          state: 'receiving',
          done: 0,
          total: payload.chunks,
          ...mediaInfo(payload),
          p2p: { key: payload.key, iv: payload.iv, chunks: payload.chunks, received: 0, fromDevice: entry.device },
        },
      });
      // Already linked to the sending device: start fetching now.
      queueMicrotask(() => this.requestMissing(entry.from, entry.device));
      return entry.from;
    }
    if (payload.t === 'profile-key') {
      if (!contact.profileKey || payload.version >= contact.profileKey.version) {
        contact.profileKey = { key: payload.key, version: payload.version };
        void this.refreshProfile(entry.from).then(() => this.emit()).catch(() => undefined);
      }
      return null;
    }
    if (payload.t === 'receipt') {
      this.applyReceipt(entry.from, payload.kind, payload.upTo);
      void this.persist();
      return null;
    }
    if (payload.t === 'profile-key-request') {
      // A friend's device without our key (added later): send it there only
      // (at most every 10 minutes per device).
      if (contact.known && !contact.blocked) this.answerKeyRequest(entry.from, entry.device);
      return null;
    }
    if (payload.t === 'unknown') return null;
    if (payload.t === 'event') return this.receiveEvent(entry.from, payload.ev, sentAt) ? entry.from : null;
    if (payload.t === 'event-rsvp') {
      this.receiveRsvp(entry.from, payload.id, payload.r);
      return null;
    }
    if (payload.t === 'mls-reset') {
      if (payload.to === this.device.deviceId) void this.repairChannel(entry.from, payload.from, payload.since);
      return null;
    }
    if (payload.t === 'account-deleted') {
      contact.deleted = true;
      delete contact.profile;
      delete contact.profileKey;
      this.refreshName(contact);
      return null;
    }
    return (await this.receiveContent(entry.from, entry.from, payload, sentAt, chainKey, entry.seq, gap && last.seq > 0)) ? entry.from : null;
  }

  /**
   * What a chat shows from one sender: a text, a file (chunks or on Sia), or a
   * change to one of their messages (edit, reaction, deletion). `key` is the
   * chat (the sender's account, or a group's key). Returns whether a new
   * message was added.
   */
  private async receiveContent(
    key: string,
    from: string,
    payload: Payload | GroupInner,
    sentAt: number,
    chainKey: string,
    seq: number,
    gap: boolean,
  ): Promise<boolean> {
    const group = isGroupKey(key);
    const author = group ? { from } : {};
    switch (payload.t) {
      case 'file':
        await this.receiveChunk(key, from, payload, sentAt, true);
        return payload.i === 0;
      case 'file-sia': {
        if (this.state.retracted?.includes(payload.fileId)) return false;
        const existing = this.findMessage(key, payload.fileId)?.attachment;
        if (existing) {
          // The sender switched a waiting file to Sia: fetch it from there.
          existing.sia = { seed: payload.seed, objectId: payload.objectId, key: payload.key, iv: payload.iv };
          if (existing.state !== 'ready') {
            existing.via = 'sia';
            existing.state = 'remote';
            delete existing.p2p;
          }
          return false;
        }
        insertBySentAt((this.state.messages[key] ??= []), {
          id: `file:${payload.fileId}`,
          direction: 'in',
          body: payload.caption ?? '',
          sentAt,
          status: 'delivered',
          verified: true,
          ...author,
          attachment: {
            fileId: payload.fileId,
            name: payload.name,
            mime: payload.mime,
            size: payload.size,
            via: 'sia',
            state: 'remote',
            done: 0,
            total: 1,
            ...mediaInfo(payload),
            sia: { seed: payload.seed, objectId: payload.objectId, key: payload.key, iv: payload.iv },
          },
        });
        // Group photos and other small files: fetched at once (a free query), so they show like inline ones.
        if (payload.seed.startsWith(GROUP_BLOB_SEED) && payload.size <= GROUP_AUTO_FETCH_BYTES) {
          queueMicrotask(() => void this.fetchGroupFile(key, payload.fileId).catch(() => undefined));
        }
        return true;
      }
      case 'retract':
        await this.applyRetract(key, from, payload.id);
        return false;
      case 'edit':
        this.applyEdit(key, from, payload.ref, payload.text);
        void this.persist();
        return false;
      case 'react':
        this.applyReaction(key, from, payload.ref, payload.emoji, payload.on);
        void this.persist();
        return false;
      case 'text': {
        if (payload.mid && this.state.retracted?.includes(payload.mid)) return false;
        const re = payload.re;
        insertBySentAt((this.state.messages[key] ??= []), {
          id: `${chainKey}:${seq}`,
          ...(payload.mid ? { remoteId: payload.mid } : {}),
          direction: 'in',
          body: payload.text,
          sentAt,
          status: 'delivered',
          verified: true,
          ...author,
          ...(re
            ? {
                replyTo: group
                  ? { ref: re.ref, text: re.text, mine: re.a === this.account, ...(re.a ? { author: re.a } : {}) }
                  : { ref: re.ref, text: re.text, mine: re.by === 'you' },
              }
            : {}),
          ...(payload.lp ? { linkPreview: payload.lp } : {}),
          ...(gap ? { gap: true } : {}),
        });
        return true;
      }
      default:
        return false;
    }
  }
}

/** A text message as sent: its text, id and (for a reply) the quote, `by` as the sender sees it. */
function textPayload(m: RealMessage): Payload {
  return {
    t: 'text',
    text: m.body,
    mid: m.id,
    ...(m.replyTo && !m.replyTo.deleted
      ? {
          re: {
            ref: m.replyTo.ref,
            by: m.replyTo.mine ? ('me' as const) : ('you' as const),
            text: m.replyTo.text,
            ...(m.replyTo.author ? { a: m.replyTo.author } : {}),
          },
        }
      : {}),
    ...(m.linkPreview ? { lp: m.linkPreview } : {}),
  };
}

/** After an edit, a preview whose link is no longer in the text goes away. */
function dropStalePreview(m: RealMessage) {
  if (m.linkPreview && !sanitizeLinkPreview(m.linkPreview, m.body)) delete m.linkPreview;
}

/** An account (an ICP principal in text form). */
const ACCOUNT = /^(?=.{1,64}$)[a-z0-9]+(-[a-z0-9]+)*$/;
/** What may travel inside a group message (checked again as a payload of its own). */
const GROUP_CONTENT = ['text', 'edit', 'react', 'retract', 'file', 'file-sia'];

function parseGroup(p: object): Payload {
  const w = p as { g?: unknown; v?: unknown; n?: unknown; p?: unknown };
  const inner = w.p as { t?: unknown; s?: unknown } | undefined;
  if (!isGroupId(w.g) || !Number.isInteger(w.v) || (w.v as number) < 0 || !inner || typeof inner.t !== 'string') return { t: 'unknown' };
  let parsed: GroupInner | null = null;
  if (inner.t === 'group-state' && inner.s && typeof inner.s === 'object') {
    parsed = { t: 'group-state', s: inner.s };
  } else if (GROUP_CONTENT.includes(inner.t)) {
    const q = parsePayload(JSON.stringify(inner));
    if (q.t === inner.t) parsed = q as GroupInner;
  }
  if (!parsed) return { t: 'unknown' };
  const n = typeof w.n === 'string' ? w.n.trim().slice(0, 60) : '';
  return { t: 'group', g: w.g, v: w.v as number, ...(n ? { n } : {}), p: parsed };
}

function parsePayload(body: string): Payload {
  try {
    const p = JSON.parse(body) as Partial<Payload> & { t?: string };
    if (p.t === 'text' && typeof (p as { text?: unknown }).text === 'string') {
      const mid = (p as { mid?: unknown }).mid;
      const re = (p as { re?: Partial<WireReply> }).re;
      const okRe =
        !!re && typeof re.ref === 'string' && REF.test(re.ref) && (re.by === 'me' || re.by === 'you') && typeof re.text === 'string';
      const author = okRe && typeof re.a === 'string' && ACCOUNT.test(re.a) ? { a: re.a } : {};
      const text = (p as { text: string }).text;
      const lp = sanitizeLinkPreview((p as { lp?: unknown }).lp, text);
      return {
        t: 'text',
        text,
        ...(typeof mid === 'string' && /^[0-9a-f]{16}$/.test(mid) ? { mid } : {}),
        ...(okRe ? { re: { ref: re.ref!, by: re.by!, text: re.text!.slice(0, MAX_QUOTE), ...author } } : {}),
        ...(lp ? { lp } : {}),
      };
    }
    if (p.t === 'edit') {
      const e = p as { ref?: unknown; text?: unknown };
      if (typeof e.ref === 'string' && /^[0-9a-f]{16}$/.test(e.ref) && typeof e.text === 'string' && e.text.trim()) {
        return { t: 'edit', ref: e.ref, text: e.text };
      }
    }
    if (p.t === 'react') {
      const r = p as { ref?: unknown; emoji?: unknown; on?: unknown };
      if (typeof r.ref === 'string' && REF.test(r.ref) && validEmoji(r.emoji) && typeof r.on === 'boolean') {
        return { t: 'react', ref: r.ref, emoji: r.emoji, on: r.on };
      }
    }
    if (p.t === 'profile-key') {
      const k = p as { key?: unknown; version?: unknown };
      if (typeof k.key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(k.key) && typeof k.version === 'number') {
        return { t: 'profile-key', key: k.key, version: k.version };
      }
    }
    if (p.t === 'account-deleted') return { t: 'account-deleted' };
    if (p.t === 'group') return parseGroup(p);
    if (p.t === 'group-invite') {
      const v = p as { g?: unknown; shard?: unknown; seq?: unknown; blob?: unknown; chunks?: unknown; name?: unknown };
      if (
        isGroupId(v.g) &&
        typeof v.shard === 'string' &&
        ACCOUNT.test(v.shard) &&
        Number.isInteger(v.seq) &&
        typeof v.blob === 'string' &&
        /^\d{1,20}$/.test(v.blob) &&
        Number.isInteger(v.chunks) &&
        (v.chunks as number) >= 1 &&
        (v.chunks as number) <= 20 &&
        typeof v.name === 'string'
      ) {
        const name = v.name.trim().slice(0, GROUP_LIMITS.name) || 'Group';
        return { t: 'group-invite', g: v.g, shard: v.shard, seq: v.seq as number, blob: v.blob, chunks: v.chunks as number, name };
      }
      return { t: 'unknown' };
    }
    if (p.t === 'group-removed') {
      const v = p as { g?: unknown; by?: unknown };
      return isGroupId(v.g) && typeof v.by === 'string' ? { t: 'group-removed', g: v.g, by: v.by } : { t: 'unknown' };
    }
    if (p.t === 'event' && (p as { ev?: unknown }).ev) return { t: 'event', ev: (p as { ev: unknown }).ev };
    if (p.t === 'event-rsvp') {
      const r = p as { id?: unknown; r?: unknown };
      if (typeof r.id === 'string' && /^[0-9a-f]{16}$/.test(r.id) && RSVPS.includes(r.r as Rsvp)) {
        return { t: 'event-rsvp', id: r.id, r: r.r as Rsvp };
      }
    }
    if (p.t === 'profile-key-request') return { t: 'profile-key-request' };
    if (p.t === 'receipt') {
      const r = p as { kind?: unknown; upTo?: unknown };
      if ((r.kind === 'delivered' || r.kind === 'read') && typeof r.upTo === 'number' && Number.isFinite(r.upTo)) {
        return { t: 'receipt', kind: r.kind, upTo: r.upTo };
      }
    }
    if (p.t === 'retract') {
      const id = (p as { id?: unknown }).id;
      if (typeof id === 'string' && /^[0-9a-f]{16,24}$/.test(id)) return { t: 'retract', id };
    }
    if (p.t === 'mls-reset') {
      const r = p as { to?: unknown; from?: unknown; since?: unknown };
      if (typeof r.to === 'string' && typeof r.from === 'string' && typeof r.since === 'number') {
        return { t: 'mls-reset', to: r.to, from: r.from, since: r.since };
      }
    }
    if (p.t === 'file' || p.t === 'file-sia' || p.t === 'file-p2p') {
      const f = p as unknown as Partial<Omit<FileChunk, 't'> & Omit<FileSia, 't'> & Omit<FileP2P, 't'>>;
      const okMeta =
        typeof f.fileId === 'string' &&
        /^[0-9a-f]{24}$/.test(f.fileId) &&
        typeof f.name === 'string' &&
        typeof f.mime === 'string' &&
        typeof f.size === 'number' &&
        (f.thumb === undefined || (typeof f.thumb === 'string' && /^data:image\/(webp|jpeg|png);base64,/.test(f.thumb) && f.thumb.length < 40_000)) &&
        (f.voice === undefined || (validVoice(f.voice) && f.mime.startsWith('audio/'))) &&
        (f.caption === undefined || (typeof f.caption === 'string' && f.caption.length <= MAX_CAPTION));
      if (okMeta && p.t === 'file' && Number.isInteger(f.i) && Number.isInteger(f.n) && f.n! > 0 && f.n! <= 1000 && f.i! >= 0 && f.i! < f.n! && typeof f.data === 'string') {
        return { ...(p as unknown as FileChunk), name: f.name!.slice(0, 200) };
      }
      if (okMeta && p.t === 'file-sia' && typeof f.seed === 'string' && typeof f.objectId === 'string' && typeof f.key === 'string' && typeof f.iv === 'string') {
        return { ...(p as unknown as FileSia), name: f.name!.slice(0, 200) };
      }
      if (
        okMeta &&
        p.t === 'file-p2p' &&
        typeof f.key === 'string' &&
        typeof f.iv === 'string' &&
        f.size! > 0 &&
        f.size! <= MAX_FILE_BYTES &&
        f.chunks === chunkCount(f.size!)
      ) {
        return { ...(p as unknown as FileP2P), name: f.name!.slice(0, 200) };
      }
    }
    if (p.t === 'call') {
      const sig = parseCallSignal(p);
      if (sig) return sig;
    }
    if (p.t === 'rtc') {
      const r = p as Partial<SignalPayload>;
      if ((r.kind === 'offer' || r.kind === 'answer') && typeof r.sdp === 'string' && typeof r.to === 'string' && typeof r.from === 'string' && typeof r.ts === 'number' && r.sdp.length < 20_000) {
        return p as Payload;
      }
    }
    // A structured message of a kind this build doesn't know (or malformed):
    // drop it rather than show its JSON as a text.
    if (typeof p?.t === 'string') return { t: 'unknown' };
  } catch {
    // Older clients sent plain text.
  }
  return { t: 'text', text: body };
}
