/**
 * Real messaging between OpenSocial accounts in the UI: device keys in
 * IndexedDB, directory and offline mailbox in the identity canister,
 * polling every few seconds while the app is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountProvider } from '../core/interfaces';
import { RealMessaging, type RealContact, type RealMessage } from '../core/delivery/realMessaging';
import { IcpMailbox } from '../modules/icp-identity/icpMailbox';
import { ShardedMailbox } from '../modules/icp-identity/shardedMailbox';
import { GatewayClient } from '../modules/gateway/gatewayClient';
import { SpaceClient } from '../modules/space/spaceClient';
import { downloadSharedFromSia } from '../modules/sia-storage';
import { releaseFile } from './AttachmentView';
import { type ChatListPatch, type SiaUploader, type VoiceInfo } from '../core/delivery/realMessaging';
import type { CallKind, CallPeer, CallState } from '../core/calls/calls';
import { MAX_FILE_BYTES, type FileSource } from '../core/files/chunkedFile';
import { previewTarget, sanitizeLinkPreview, type FetchedPreview, type LinkPreview } from '../core/delivery/linkPreview';
import { previewImage } from './linkPreviewImage';
import type { NewsFeed } from '../core/news/news';
import type { Reminder, Rsvp, ZEvent } from '../core/events/events';
import type { GroupState } from '../core/groups/groups';
import type { EventInput } from '../core/delivery/realMessaging';
import { sanitizeArticle } from './sanitizeArticle';
import { articleApiPath, parseArticleJson } from '../core/news/hashfirst';

/**
 * A short, plain error for the screen. "Failed to fetch …" means the device
 * is offline. An Internet Computer rejection has its reason on later lines
 * ("Reject text: …", with a code): show that reason, not the first line.
 */
export function friendlyNetworkError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|network request failed|ERR_INTERNET/i.test(msg)) {
    return 'No connection. Messages will arrive when you are back online.';
  }
  // An HTTP error from the boundary nodes (the SDK's text starts "HTTP request failed:" and puts the status below).
  const status = Number(/HTTP request failed:\s*Status:\s*(\d{3})/.exec(msg)?.[1] ?? 0);
  if (status === 429) return 'Too many requests to the Internet Computer for a moment. Retrying…';
  if (status >= 500) return 'The Internet Computer did not answer for a moment. Retrying…';
  if (status > 0) return `The Internet Computer refused the request (HTTP ${status}).`;
  const reject = /Reject text:\s*(.+)/.exec(msg)?.[1]?.trim();
  if (reject) {
    const code = /Reject code:\s*(\d+)/.exec(msg)?.[1];
    // Code 2 (SysTransient): the subnet was busy for a moment; the next check retries.
    if (code === '2') return 'The Internet Computer is busy for a moment. Retrying…';
    const errorCode = /Error code:\s*(IC\d+)/.exec(msg)?.[1];
    return `${reject.slice(0, 180)}${errorCode ? ` (${errorCode})` : ''}`;
  }
  return msg.split('\n')[0]!.slice(0, 200);
}

/** Uploader for the user's Sia space (connects with the saved key). */
async function siaUploader(sia: SiaClientLike | null): Promise<SiaUploader> {
  if (!sia || !(await sia.resume())) throw new Error('Connect your Sia storage in Settings › Account first.');
  return (ct, size, p) => sia.uploadShared(ct, size, p);
}

/** The part of the File System Access API used to save files. */
interface FileSystemFileHandleLike {
  createWritable(): Promise<WritableStream<Uint8Array>>;
}
import type { RtcLike } from '../core/direct/directLinks';
import {
  dataUrlToBytes,
  loadMyProfile,
  saveMyProfile,
  squareImage,
  type MyProfile,
} from '../core/profile/profile';
import { newProfileKey, normalizeProfile, openProfile, sealProfile } from '../core/profile/sealedProfile';
import { ProfilesClient } from '../modules/profiles/profilesClient';
import { secureGet, secureSet, secureStore, wipeDevice } from '../core/storage/secureStore';

/** Poll quickly while the app is visible (queries are free), slowly in the background. */
const POLL_VISIBLE_MS = 1_500;
/** The open group chat's stream is read again this long after the last read started, at least (a free query). */
const OPEN_GROUP_GAP_MS = 250;
/** After a failed start, try again this often until it works. */
const START_RETRY_MS = 10_000;
const POLL_HIDDEN_MS = 5_000;

/** Public STUN servers used to find this device's public address for direct links. */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Previews fetched in this session, by address (a site without one is remembered as null). */
const previewCache = new Map<string, Promise<FetchedPreview | null>>();
/** Preview images fetched in this session (resized data URLs), by image address. */
const previewImageCache = new Map<string, Promise<string | undefined>>();
/** News covers fetched in this session (object URLs), by story. */
const newsCoverCache = new Map<string, Promise<string | undefined>>();
const directKey = (p: string) => `opensocial:direct-links:${p}`;
export function loadDirectSetting(principal: string): boolean {
  try {
    return window.localStorage.getItem(directKey(principal)) !== 'off';
  } catch {
    return true;
  }
}

/** Messaging, or an error for an action taken before it started. */
function need(rm: RealMessaging | null): RealMessaging {
  if (!rm) throw new Error('Messaging is still starting.');
  return rm;
}

export interface RealMessagingView {
  ready: boolean;
  available: boolean;
  error: string | null;
  /** Why secure messaging could not start on this device; null while starting or once running. */
  startError: string | null;
  /** Try to start secure messaging again now. */
  retryStart(): void;
  contacts: RealContact[];
  messages(account: string): RealMessage[];
  unreadCount(account: string): number;
  markRead(account: string): void;
  addContact(account: string, name?: string): Promise<void>;
  /** Sends a text; `replyToId`: the message it replies to; `preview`: its first link's card. */
  send(account: string, body: string, replyToId?: string, preview?: LinkPreview): Promise<void>;
  /** Reads the preview card for a link (through the canister), or null when the site has none. */
  fetchLinkPreview(url: string): Promise<FetchedPreview | null>;
  /** Fetches and shrinks a preview's image, as a data URL. */
  fetchPreviewImage(imageUrl: string): Promise<string | undefined>;
  /** The news feed from the canister; `refresh` asks it to fetch the feed again first (skipped when fresh). */
  fetchNews(refresh: boolean): Promise<NewsFeed>;
  /** A story's body, cleaned to safe text markup (empty when the story has no text, e.g. a video). */
  fetchNewsArticle(id: string): Promise<string>;
  /** A HashFirst Global API response (allowed paths only), through the canister. */
  fetchHashFirst(path: string): Promise<string>;
  /** A story's cover as an object URL (kept for the session). */
  fetchNewsCover(id: string): Promise<string | undefined>;
  /** Changes the text of one of our messages (within a day of sending). */
  editMessage(account: string, messageId: string, body: string): Promise<void>;
  /** Adds (`on`) or takes back one of our emoji reactions to a message. */
  react(account: string, messageId: string, emoji: string, on: boolean): Promise<void>;
  contactFingerprint(account: string): Promise<string | null>;
  myFingerprint: string | null;
  contact(account: string): RealContact | undefined;
  accept(account: string): Promise<void>;
  block(account: string): Promise<void>;
  setNickname(account: string, nickname: string): Promise<void>;
  /** Public profiles: search, public photos, reports. Null until ready. */
  profiles: ProfilesClient | null;
  /** The user's own profile (from the encrypted device store). */
  myProfile: MyProfile | null;
  /**
   * This device has no copy of our profile yet while one exists on the
   * canister: it waits for the key from another of our devices. Saving is
   * blocked meanwhile (it would replace the profile for our friends).
   */
  profileRestoring: boolean;
  /** Gives up waiting (the other devices are lost): the next save starts a new profile. */
  startNewProfile(): void;
  /** Saves the profile: sealed copy for friends, public copy if public, key to friends. */
  publishProfile(next: MyProfile): Promise<void>;
  /** Deletes the account and everything that can be deleted, then wipes this device. */
  deleteAccount(deleteSia?: () => Promise<void>): Promise<void>;
  /** Direct (WebRTC) links with friends. */
  directEnabled: boolean;
  setDirectEnabled(on: boolean): void;
  isDirect(account: string): boolean;
  warm(account: string): void;
  /** The user started typing to this friend: open a direct link now if they were active lately. */
  warmTyping(account: string): void;
  /** Sends a file of up to 2 GB (photos over 1.8 MB are resized). Over 2 MB needs Sia. */
  /** Sends a file; `caption` is text sent with it. */
  sendFile(account: string, file: File, sia: SiaClientLike | null, extra?: { voice?: VoiceInfo; caption?: string }): Promise<void>;
  retryFile(account: string, fileId: string): Promise<void>;
  /** Sends a failed message (text or file) again. */
  retryMessage(account: string, messageId: string): Promise<void>;
  /** A large file waiting for the friend: send it through the user's Sia space now. */
  sendViaSia(account: string, fileId: string, sia: SiaClientLike | null): Promise<void>;
  /** Keep a copy of a file on this device in the user's own Sia space. */
  saveToMySia(account: string, fileId: string, sia: SiaClientLike | null): Promise<void>;
  isWaiting(fileId: string): boolean;
  /** Withdraws one of your messages from both sides (their app deletes it and its file). */
  deleteForEveryone(account: string, messageId: string): Promise<void>;
  /** Deletes a message and its file from this device only. */
  deleteForMe(account: string, messageId: string): Promise<void>;
  /** Highlights / un-highlights a message in its chat (this device), and the highlighted ones in chat order. */
  highlightMessage(account: string, messageId: string, on: boolean): Promise<void>;
  /** Events we organize or were invited to. */
  events: ZEvent[];
  event(id: string): ZEvent | undefined;
  createEvent(input: EventInput): Promise<string>;
  updateEvent(id: string, input: EventInput): Promise<void>;
  cancelEvent(id: string): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  respondEvent(id: string, r: Rsvp): Promise<void>;
  eventReminder(id: string): Reminder;
  setEventReminder(id: string, minutes: Reminder): Promise<void>;
  highlightedMessages(account: string): RealMessage[];
  /** The call in progress (ringing, connecting or active), and what to say after one. */
  call: CallState | null;
  callNotice: string | null;
  canCall: boolean;
  startCall(account: string, kind: CallKind): Promise<void>;
  acceptCall(): void;
  /** Declines, cancels or hangs up. */
  hangUp(): void;
  toggleMute(): void;
  toggleCamera(): void;
  dismissCallNotice(): void;
  /** Group chats on this device (also those we left). */
  groups: { state: GroupState; left: boolean }[];
  group(id: string): { state: GroupState; left: boolean } | undefined;
  /** What a group member is called here (see RealMessaging.memberName). */
  memberName(groupId: string | null, account: string): string;
  createGroup(input: { name: string; about?: string; photo?: string; members: string[] }): Promise<string>;
  updateGroup(id: string, patch: Partial<Pick<GroupState, 'name' | 'about' | 'photo' | 'onlyAdminsPost' | 'onlyAdminsEdit'>>): Promise<void>;
  addMembers(id: string, accounts: string[]): Promise<void>;
  removeMember(id: string, account: string): Promise<void>;
  setMemberRole(id: string, account: string, role: 'admin' | 'member'): Promise<void>;
  transferOwnership(id: string, account: string): Promise<void>;
  leaveGroup(id: string): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  /** The group chat on screen (its stream is read continuously), or null. */
  setOpenGroup(id: string | null): void;
  /** Friends and pending requests (not blocked), by name; includes archived and deleted chats. */
  addressBook: RealContact[];
  /** Blocked on this device, and unblocking. */
  blockedContacts: RealContact[];
  unblock(account: string): Promise<void>;
  /** Removes a contact and their chat from this device (they can write again as a request). */
  removeContact(account: string): Promise<void>;
  /** Chat list settings on this device: archive, pin, mute, favourite, mark unread. */
  updateChat(account: string, patch: ChatListPatch): Promise<void>;
  /** Deletes a chat's messages and files here (clear keeps it listed; delete removes it). */
  clearChat(account: string): Promise<void>;
  deleteChat(account: string): Promise<void>;
  isMuted(account: string): boolean;
  /** Read receipts on (sent to friends, and theirs shown). */
  readReceipts: boolean;
  setReadReceipts(on: boolean): void;
  /** Chats as a backup file (contacts and messages, no keys) and restoring one. */
  exportBackup(): Uint8Array;
  importBackup(bytes: Uint8Array): Promise<number>;
  /** Direct-link status to an account and whether they were active in the last 2 minutes. */
  linkStatus(account: string): 'open' | 'connecting' | 'failed' | 'none';
  isActive(account: string): boolean;
  /** Online, judged peer to peer (direct link, or a message in the last 2 minutes). */
  isOnline(account: string): boolean;
  canRetry(fileId: string): boolean;
  /** Small files kept on this device (for previews). */
  fileBytes(fileId: string): Promise<Uint8Array | null>;
  /** The whole file as a Blob (for playing videos in the chat), with progress. */
  openBlob(account: string, fileId: string, onProgress: (fraction: number) => void): Promise<Blob>;
  /** Saves an attachment to disk, streaming (downloads and decrypts large ones). */
  saveFile(account: string, fileId: string, onProgress: (fraction: number) => void): Promise<void>;
}

/** The parts of the Sia client used for large attachments. */
export interface SiaClientLike {
  isConnected(): boolean;
  resume(): Promise<boolean>;
  uploadShared(
    ct: () => ReadableStream<Uint8Array>,
    size: number,
    onProgress?: (f: number) => void,
  ): Promise<{ seed: string; objectId: string }>;
}

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draws an image scaled to fit `max` px; returns a Blob in the given type. */
async function scaleImage(img: HTMLImageElement, max: number, type: string, quality: number): Promise<Blob> {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality));
}

/**
 * A preview frame of a video (about 10% in, at most 1 s), as a small WebP
 * data URL. The browser reads only what it needs to show that frame.
 */
async function videoThumbnail(file: Blob): Promise<string | undefined> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;
    const wait = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 8000);
        video.addEventListener(event, () => (clearTimeout(t), resolve()), { once: true });
        video.addEventListener('error', () => (clearTimeout(t), reject(new Error('video'))), { once: true });
      });
    await wait('loadedmetadata');
    video.currentTime = Math.min(1, (video.duration || 0) * 0.1);
    await wait('seeked');
    for (const [w, q] of [[320, 0.6], [240, 0.5], [160, 0.5]] as const) {
      const scale = w / Math.max(1, video.videoWidth);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = Math.max(1, Math.round(video.videoHeight * scale));
      c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
      const out = c.toDataURL('image/webp', q);
      if (out.startsWith('data:image/webp') && out.length < 38_000) return out;
    }
    return undefined;
  } finally {
    // Stop reading the file before releasing its address.
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(b);
  });

export function useRealMessaging(
  principal: string | undefined,
  provider: AccountProvider,
  signedIn: boolean,
  /** Only the active tab runs messaging (see useTabLock). */
  activeTab = true,
): RealMessagingView {
  const [rm, setRm] = useState<RealMessaging | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Bumped to start again after a failed start (by the timer below or by the user).
  const [startAttempt, setStartAttempt] = useState(0);
  const [mailbox, setMailbox] = useState<IcpMailbox | null>(null);
  const [profiles, setProfiles] = useState<ProfilesClient | null>(null);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // The open group chat: its stream is read again as soon as the last read
  // returns (queries are free), so a new message shows about one query after
  // it is written.
  useEffect(() => {
    if (!rm || !openGroup) return;
    let alive = true;
    void (async () => {
      while (alive) {
        const started = Date.now();
        if (document.visibilityState === 'visible') await rm.pollGroups(openGroup).catch(() => undefined);
        await new Promise((r) => setTimeout(r, Math.max(0, OPEN_GROUP_GAP_MS - (Date.now() - started))));
      }
    })();
    return () => {
      alive = false;
    };
  }, [rm, openGroup]);
  // Our profile name travels with our group messages, so members who aren't our friends see it.
  useEffect(() => {
    rm?.setMyName(myProfile?.profile.displayName || myProfile?.profile.username || '');
  }, [rm, myProfile]);
  const [profileRestoring, setProfileRestoring] = useState(false);
  const restoringRef = useRef(false);
  restoringRef.current = profileRestoring;
  const [directEnabled, setDirectState] = useState(() => (principal ? loadDirectSetting(principal) : true));
  const directRef = useRef(directEnabled);
  useEffect(() => {
    const v = principal ? loadDirectSetting(principal) : true;
    directRef.current = v;
    setDirectState(v);
  }, [principal]);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupListeners = useRef<(() => void) | null>(null);
  const available = !!(activeTab && signedIn && principal && provider.agentIdentity?.() && provider.mailboxCanisterId);

  useEffect(() => {
    if (!available || !principal) {
      setRm(null);
      return;
    }
    let alive = true;
    const mailbox = new ShardedMailbox(provider.mailboxCanisterId!, () => provider.agentIdentity?.() ?? null);
    const profilesClient = new ProfilesClient(() => provider.agentIdentity?.() ?? null);
    // One store for the whole app (one connection, one at-rest key).
    const store = secureStore();
    const m = new RealMessaging(
      principal,
      mailbox,
      mailbox,
      store,
      navigator.userAgent.includes('Mobile') ? 'Phone' : 'Browser',
      typeof RTCPeerConnection === 'undefined'
        ? undefined
        : {
            newPeer: () => new RTCPeerConnection({ iceServers: ICE_SERVERS }) as unknown as RtcLike,
            ...(typeof RTCPeerConnection !== 'undefined' && navigator.mediaDevices?.getUserMedia
              ? {
                  calls: {
                    newPeer: () => new RTCPeerConnection({ iceServers: ICE_SERVERS }) as unknown as CallPeer,
                    getMedia: (kind: CallKind) =>
                      navigator.mediaDevices.getUserMedia({
                        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                        video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
                      }),
                  },
                }
              : {}),
            enabled: () => directRef.current,
          },
      (account) => profilesClient.getSealed(account),
      mailbox,
    );
    const off = m.subscribe(() => alive && setTick((t) => t + 1));
    // Deleted files leave no copy in memory either.
    m.onFilesDeleted = (ids) => ids.forEach(releaseFile);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    m.init()
      .then(async () => {
        if (!alive) return;
        setStartError(null);
        setRm(m);
        setMailbox(mailbox);
        setProfiles(profilesClient);
        setError(null);
        // Our profile and its key from the encrypted store; friends' profiles from the canister.
        const mine = await loadMyProfile(principal);
        if (alive) setMyProfile(mine);
        const key = await secureGet<{ key: string; version: number }>(`profile-key:${principal}`);
        if (key) await m.setMyProfileKey(key);
        // A device signed in after the profile was made elsewhere: get the key
        // from our other devices, then open the sealed profile from the canister.
        m.onOwnProfileKey = (k) => {
          void (async () => {
            const current = await secureGet<{ key: string; version: number }>(`profile-key:${principal}`);
            if (current && current.version >= k.version) return;
            const blob = await profilesClient.getSealed(principal);
            if (!blob) return;
            const profile = await openProfile(blob, k.key);
            const visibility = (await profilesClient.getPublic(principal).catch(() => null)) ? 'public' : 'friends';
            const restored: MyProfile = { profile, visibility };
            await saveMyProfile(principal, restored);
            await secureSet(`profile-key:${principal}`, k);
            await m.setMyProfileKey(k, true);
            if (!alive) return;
            setMyProfile(restored);
            setProfileRestoring(false);
          })().catch(() => undefined);
        };
        // Another device of ours may have saved a newer profile: open the
        // canister's copy with our key; if our key can't open it (that device
        // made a new one), ask our devices for theirs.
        if (mine && key) {
          void (async () => {
            const blob = await profilesClient.getSealed(principal);
            if (!blob) return;
            let latest;
            try {
              latest = await openProfile(blob, key.key);
            } catch {
              await m.requestOwnProfileKey();
              return;
            }
            if (latest.updatedAt <= mine.profile.updatedAt) return;
            const visibility = (await profilesClient.getPublic(principal).catch(() => null)) ? 'public' : 'friends';
            const updated: MyProfile = { profile: latest, visibility };
            await saveMyProfile(principal, updated);
            if (alive) setMyProfile(updated);
          })().catch(() => undefined);
        }
        if (!mine && !key) {
          const [sealed, pub] = await Promise.all([
            profilesClient.getSealed(principal).catch(() => null),
            profilesClient.getPublic(principal).catch(() => null),
          ]);
          if (alive && (sealed || pub)) {
            setProfileRestoring(true);
            // A public profile shows at once (in memory only) while we wait.
            if (pub) {
              const bytes = pub.avatarHash ? await profilesClient.getPublicAvatar(principal).catch(() => null) : null;
              const avatar = bytes ? `data:image/webp;base64,${btoa(String.fromCharCode(...bytes))}` : '';
              if (alive)
                setMyProfile({
                  profile: normalizeProfile({ displayName: pub.displayName, username: pub.username, bio: pub.bio, links: pub.links, avatar }),
                  visibility: 'public',
                });
            }
            void m.requestOwnProfileKey().catch(() => undefined);
          }
        }
        void m.refreshProfiles();
        // A failed check shows its error; the next good one clears it (e.g. back online).
        // Each check also asks friends whose profile key this device lacks
        // (throttled inside: every few minutes, each friend every few hours).
        // One failed check is usually a passing hiccup (the next one, 1.5 s later,
        // retries): the error shows only once checks have failed 3 times in a row.
        let failures = 0;
        const tick = () =>
          m
            .poll()
            .then(() => {
              failures = 0;
              if (alive) setError(null);
              void m.requestMissingProfileKeys().catch(() => undefined);
            })
            .catch((e) => {
              failures++;
              if (alive && failures >= 3) setError(friendlyNetworkError(e));
            });
        await tick();
        void m.warmRecent();
        const schedule = () => {
          if (!alive) return;
          const ms = document.visibilityState === 'visible' ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
          timer.current = setTimeout(async () => {
            await tick();
            schedule();
          }, ms) as unknown as ReturnType<typeof setInterval>;
        };
        schedule();
        // Coming back (foreground again, or network back): catch up, and offer
        // direct links to recent friends ourselves; links still open are kept.
        let hiddenSince = 0;
        const onVisibility = () => {
          if (document.visibilityState === 'hidden') {
            hiddenSince = Date.now();
            return;
          }
          void tick();
          if (hiddenSince && Date.now() - hiddenSince > 10_000) void m.warmRecent('resume');
          hiddenSince = 0;
        };
        const onOnline = () => {
          void tick();
          void m.warmRecent('resume');
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('online', onOnline);
        cleanupListeners.current = () => {
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('online', onOnline);
        };
      })
      .catch((e) => {
        if (!alive) return;
        setStartError(friendlyNetworkError(e));
        retryTimer = setTimeout(() => setStartAttempt((n) => n + 1), START_RETRY_MS);
      });
    return () => {
      alive = false;
      clearTimeout(retryTimer);
      // Stop everything this tab ran (another tab may take over the device).
      m.calls?.dispose();
      m.closeDirect();
      off();
      if (timer.current) clearTimeout(timer.current as unknown as ReturnType<typeof setTimeout>);
      timer.current = null;
      cleanupListeners.current?.();
      cleanupListeners.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, principal, startAttempt]);

  const publishProfile = useCallback(
    async (next: MyProfile) => {
      if (!rm || !profiles || !principal) throw new Error('Messaging is still starting.');
      if (restoringRef.current) {
        throw new Error(
          'This device is still waiting for your profile from your other device. Open OpenSocial there once, or save it here as a new profile.',
        );
      }
      const profile = {
        ...next.profile,
        displayName: next.profile.displayName.trim(),
        bio: next.profile.bio.trim(),
        links: next.profile.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
        updatedAt: Date.now(),
      };
      // Checked before anything is written, so a refused save changes nothing.
      if (next.visibility === 'public' && (!profile.displayName || !profile.username)) {
        throw new Error('Add a display name and a username to go public.');
      }
      // Friends-only copy, sealed with our profile key.
      const keyName = `profile-key:${principal}`;
      const existing = await secureGet<{ key: string; version: number }>(keyName);
      const key = existing?.key ?? newProfileKey();
      await profiles.setSealed(await sealProfile(profile, key));
      // Public copy, only when public.
      if (next.visibility === 'public') {
        let avatar: Parameters<ProfilesClient['setPublic']>[0]['avatar'] = { remove: true };
        if (profile.avatar) {
          for (const [size, q] of [[256, 0.8], [192, 0.7], [128, 0.6]] as const) {
            const b = dataUrlToBytes(await squareImage(profile.avatar, size, q));
            if (b.length <= 64 * 1024) {
              avatar = { set: b };
              break;
            }
          }
        }
        await profiles.setPublic({
          username: profile.username,
          displayName: profile.displayName.trim(),
          bio: profile.bio.trim(),
          links: profile.links,
          avatar,
        });
      } else {
        await profiles.clearPublic();
      }
      const saved = { profile, visibility: next.visibility };
      await saveMyProfile(principal, saved);
      setMyProfile(saved);
      const k = { key, version: profile.updatedAt };
      await secureSet(keyName, k);
      await rm.setMyProfileKey(k);
    },
    [rm, profiles, principal],
  );

  const deleteAccount = useCallback(
    async (deleteSia?: () => Promise<void>) => {
      if (!rm || !profiles || !mailbox) throw new Error('Messaging is still starting.');
      await rm.notifyAccountDeleted();
      await profiles.deleteMyData();
      // Listings and the personal space live in the space canister.
      await new SpaceClient(() => provider.agentIdentity?.() ?? null).deleteMyData();
      if (deleteSia) await deleteSia();
      await mailbox.deleteAccount();
      // Once more, now that the account is gone: a profile update still in
      // flight (e.g. the one published right after sign-up) could have been
      // saved after the first deletion; with the account deleted, no new one
      // can be.
      await profiles.deleteMyData().catch(() => undefined);
      await provider.signOut().catch(() => undefined);
      await wipeDevice();
    },
    [rm, profiles, mailbox, provider],
  );

  const addContact = useCallback(
    async (account: string, name?: string) => {
      if (!rm) throw new Error('Messaging is still starting.');
      await rm.addContact(account, name);
    },
    [rm],
  );
  const send = useCallback(
    async (account: string, body: string, replyToId?: string, preview?: LinkPreview) => {
      if (!rm) throw new Error('Messaging is still starting.');
      await rm.send(account, body, replyToId, preview);
    },
    [rm],
  );
  // Web reads (link previews, news, HashFirst) go to the gateway canister.
  const gateway = useMemo(
    () => (mailbox ? new GatewayClient(() => provider.agentIdentity?.() ?? null) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mailbox],
  );
  const fetchLinkPreview = useCallback(
    (url: string): Promise<FetchedPreview | null> => {
      if (!gateway) return Promise.resolve(null);
      const target = previewTarget(url);
      let pending = previewCache.get(target);
      if (!pending) {
        pending = gateway.linkPreview(target).then(
          (raw) => {
            const preview = sanitizeLinkPreview({ ...raw, url: target }, target);
            return preview ? { preview, ...(raw.imageUrl ? { imageUrl: raw.imageUrl } : {}) } : null;
          },
          (err) => {
            console.info('Link preview unavailable:', target, err instanceof Error ? err.message : err);
            return null;
          },
        );
        previewCache.set(target, pending);
      }
      return pending;
    },
    [gateway],
  );
  const fetchNews = useCallback(
    async (refresh: boolean): Promise<NewsFeed> => {
      if (!gateway) throw new Error('News is still starting.');
      return refresh ? gateway.refreshNews() : gateway.news();
    },
    [gateway],
  );
  const fetchNewsArticle = useCallback(
    async (id: string): Promise<string> => {
      if (!gateway) throw new Error('News is still starting.');
      const api = articleApiPath(id);
      const html = api ? parseArticleJson(await gateway.hashfirst(api)) : await gateway.newsArticle(id);
      return sanitizeArticle(html);
    },
    [gateway],
  );
  const fetchHashFirst = useCallback(
    async (path: string): Promise<string> => {
      if (!gateway) throw new Error('News is still starting.');
      return gateway.hashfirst(path);
    },
    [gateway],
  );
  const fetchNewsCover = useCallback(
    (id: string): Promise<string | undefined> => {
      if (!gateway) return Promise.resolve(undefined);
      let pending = newsCoverCache.get(id);
      if (!pending) {
        pending = gateway.newsCover(id).then(
          (c) =>
            c.type.startsWith('image/') && c.type !== 'image/svg+xml'
              ? URL.createObjectURL(new Blob([c.bytes as BlobPart], { type: c.type }))
              : undefined,
          () => {
            newsCoverCache.delete(id);
            return undefined;
          },
        );
        newsCoverCache.set(id, pending);
      }
      return pending;
    },
    [gateway],
  );
  const fetchPreviewImage = useCallback(
    (imageUrl: string): Promise<string | undefined> => {
      if (!gateway) return Promise.resolve(undefined);
      let pending = previewImageCache.get(imageUrl);
      if (!pending) {
        pending = gateway.linkPreviewImage(imageUrl).then(
          (img) => previewImage(img.bytes, img.type),
          (err) => {
            console.info('Link preview image unavailable:', imageUrl, err instanceof Error ? err.message : err);
            return undefined;
          },
        );
        previewImageCache.set(imageUrl, pending);
      }
      return pending;
    },
    [gateway],
  );

  return {
    ready: !!rm,
    available,
    error,
    startError,
    retryStart: () => setStartAttempt((n) => n + 1),
    contacts: rm ? rm.contacts() : [],
    messages: (a: string) => (rm ? rm.messages(a) : []),
    addContact,
    send,
    fetchLinkPreview,
    fetchPreviewImage,
    fetchNews,
    fetchNewsArticle,
    fetchHashFirst,
    fetchNewsCover,
    contactFingerprint: (a: string) => (rm ? rm.contactFingerprint(a) : Promise.resolve(null)),
    myFingerprint: rm ? rm.myFingerprint : null,
    contact: (a: string) => rm?.contact(a),
    accept: async (a: string) => {
      await rm?.accept(a);
    },
    block: async (a: string) => {
      await rm?.block(a);
    },
    setNickname: async (a: string, n: string) => {
      await rm?.setNickname(a, n);
    },
    profiles,
    myProfile,
    publishProfile,
    profileRestoring,
    startNewProfile: () => {
      // Takes effect at once, so a save right after this goes through.
      restoringRef.current = false;
      setProfileRestoring(false);
    },
    deleteAccount,
    directEnabled,
    setDirectEnabled: (on: boolean) => {
      directRef.current = on;
      setDirectState(on);
      if (principal) {
        try {
          window.localStorage.setItem(directKey(principal), on ? 'on' : 'off');
        } catch {
          // ignore
        }
      }
      if (!on) rm?.closeDirect();
      else void rm?.warmRecent('resume');
    },
    isDirect: (a: string) => rm?.isDirect(a) ?? false,
    unreadCount: (a: string) => rm?.unreadCount(a) ?? 0,
    markRead: (a: string) => void rm?.markRead(a),
    sendFile: async (account: string, file: File, sia: SiaClientLike | null, extra?: { voice?: VoiceInfo; caption?: string }) => {
      const voice = extra?.voice;
      const caption = extra?.caption?.trim() || undefined;
      if (!rm) throw new Error('Messaging is still starting.');
      if (file.size > MAX_FILE_BYTES) throw new Error(`“${file.name}” is larger than 2 GB. Files can be up to 2 GB.`);
      let blob: Blob = file;
      let mime = file.type || 'application/octet-stream';
      let name = file.name || 'file';
      let thumb: string | undefined;
      // Photos: a small preview, and big photos resized (they then travel inline).
      const resizable = /^image\/(jpeg|png|webp|heic|heif|bmp)$/.test(mime) && file.size <= 50 * 1024 * 1024;
      if (resizable) {
        try {
          const img = await loadImage(file);
          if (file.size > 1.8 * 1024 * 1024) {
            blob = await scaleImage(img, 2560, 'image/jpeg', 0.85);
            mime = 'image/jpeg';
            name = name.replace(/\.[^.]+$/, '') + '.jpg';
          }
          thumb = await blobToDataUrl(await scaleImage(img, 160, 'image/webp', 0.6));
          if (thumb.length > 38_000 || !thumb.startsWith('data:image/webp')) thumb = undefined;
        } catch {
          // Not decodable here: send as a plain file.
        }
      }
      // Videos: a frame as preview (the video itself is not loaded into memory).
      if (mime.startsWith('video/')) thumb = await videoThumbnail(file).catch(() => undefined);
      // Read in ranges straight from the file: large files are never loaded whole.
      const source: FileSource & { thumb?: string; voice?: VoiceInfo; caption?: string } = {
        name,
        mime,
        size: blob.size,
        read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()),
        ...(thumb ? { thumb } : {}),
        ...(voice ? { voice } : {}),
        ...(caption ? { caption } : {}),
      };
      // Large files go device to device over a direct link; Sia is optional (sendViaSia).
      await rm.sendFile(account, source);
      void sia;
    },
    sendViaSia: async (account: string, fileId: string, sia: SiaClientLike | null) => {
      if (!rm) return;
      await rm.sendViaSia(account, fileId, await siaUploader(sia));
    },
    saveToMySia: async (account: string, fileId: string, sia: SiaClientLike | null) => {
      if (!rm) return;
      await rm.saveToMySia(account, fileId, await siaUploader(sia));
    },
    isWaiting: (fileId: string) => rm?.isWaiting(fileId) ?? false,
    deleteForEveryone: async (a: string, id: string) => {
      await rm?.deleteForEveryone(a, id);
    },
    editMessage: async (a: string, id: string, body: string) => {
      if (!rm) throw new Error('Messaging is still starting.');
      await rm.editMessage(a, id, body);
    },
    react: async (a: string, id: string, emoji: string, on: boolean) => {
      await rm?.react(a, id, emoji, on);
    },
    events: rm ? rm.events() : [],
    event: (id: string) => rm?.event(id),
    createEvent: async (input: EventInput) => {
      if (!rm) throw new Error('Messaging is still starting.');
      return rm.createEvent(input);
    },
    updateEvent: async (id: string, input: EventInput) => {
      if (!rm) throw new Error('Messaging is still starting.');
      await rm.updateEvent(id, input);
    },
    cancelEvent: async (id: string) => {
      await rm?.cancelEvent(id);
    },
    deleteEvent: async (id: string) => {
      await rm?.deleteEvent(id);
    },
    respondEvent: async (id: string, r: Rsvp) => {
      await rm?.respondEvent(id, r);
    },
    eventReminder: (id: string) => rm?.eventReminder(id) ?? 15,
    setEventReminder: async (id: string, minutes: Reminder) => {
      await rm?.setEventReminder(id, minutes);
    },
    highlightedMessages: (a: string) => rm?.highlightedMessages(a) ?? [],
    highlightMessage: async (a: string, id: string, on: boolean) => {
      await rm?.highlightMessage(a, id, on);
    },
    deleteForMe: async (a: string, id: string) => {
      await rm?.deleteForMe(a, id);
    },
    call: rm?.calls?.current ?? null,
    callNotice: rm?.calls?.notice ?? null,
    canCall: !!rm?.calls,
    startCall: async (a: string, kind: CallKind) => {
      if (!rm?.calls) throw new Error('Calls are not available in this browser.');
      await rm.calls.start(a, kind);
    },
    acceptCall: () => void rm?.calls?.accept().catch((e) => console.warn('OpenSocial: call:', e)),
    hangUp: () => rm?.calls?.hangUp(),
    toggleMute: () => rm?.calls?.toggleMute(),
    toggleCamera: () => rm?.calls?.toggleCamera(),
    dismissCallNotice: () => {
      if (rm?.calls) {
        rm.calls.notice = null;
        setTick((n) => n + 1);
      }
    },
    addressBook: rm?.addressBook() ?? [],
    blockedContacts: rm?.blockedContacts() ?? [],
    unblock: async (a: string) => {
      await rm?.unblock(a);
    },
    groups: rm?.groups() ?? [],
    group: (id: string) => rm?.group(id),
    memberName: (id: string | null, a: string) => rm?.memberName(id, a) ?? a,
    createGroup: (input) => need(rm).createGroup(input),
    updateGroup: (id, patch) => need(rm).updateGroup(id, patch),
    addMembers: (id, accounts) => need(rm).addMembers(id, accounts),
    removeMember: (id, a) => need(rm).removeMember(id, a),
    setMemberRole: (id, a, role) => need(rm).setMemberRole(id, a, role),
    transferOwnership: (id, a) => need(rm).transferOwnership(id, a),
    leaveGroup: (id) => need(rm).leaveGroup(id),
    deleteGroup: (id) => need(rm).deleteGroup(id),
    setOpenGroup,
    removeContact: async (a: string) => {
      await rm?.removeContact(a);
    },
    updateChat: async (a: string, patch: ChatListPatch) => {
      await rm?.updateChat(a, patch);
    },
    clearChat: async (a: string) => {
      await rm?.clearChat(a);
    },
    deleteChat: async (a: string) => {
      await rm?.deleteChat(a);
    },
    isMuted: (a: string) => rm?.isMuted(a) ?? false,
    readReceipts: rm?.readReceipts ?? true,
    setReadReceipts: (on: boolean) => void rm?.setReadReceipts(on),
    exportBackup: () => {
      if (!rm) throw new Error('Messaging is still starting.');
      return rm.exportBackup();
    },
    importBackup: async (bytes: Uint8Array) => {
      if (!rm) throw new Error('Messaging is still starting.');
      return rm.importBackup(bytes);
    },
    linkStatus: (a: string) => rm?.linkStatus(a) ?? 'none',
    isActive: (a: string) => rm?.isActive(a) ?? false,
    isOnline: (a: string) => rm?.isOnline(a) ?? false,
    retryMessage: async (account: string, messageId: string) => {
      await rm?.retryMessage(account, messageId);
    },
    retryFile: async (account: string, fileId: string) => {
      await rm?.retryFile(account, fileId);
    },
    canRetry: (fileId: string) => rm?.canRetry(fileId) ?? false,
    fileBytes: (id: string) => (rm ? rm.fileBytes(id) : Promise.resolve(null)),
    openBlob: async (account: string, fileId: string, onProgress: (fraction: number) => void) => {
      if (!rm) throw new Error('Messaging is still starting.');
      const opened = await rm.openFile(account, fileId, downloadSharedFromSia);
      let done = 0;
      const counted = opened.stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, c) {
            done += chunk.length;
            onProgress(opened.size ? done / opened.size : 1);
            c.enqueue(chunk);
          },
        }),
      );
      const blob = await new Response(counted).blob();
      return new Blob([blob], { type: opened.mime });
    },
    saveFile: async (account: string, fileId: string, onProgress: (fraction: number) => void) => {
      if (!rm) return;
      const a = rm.findMessage(account, fileId)?.attachment;
      if (!a) return;
      // Ask where to save first, while the click still counts as a user action.
      const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandleLike> })
        .showSaveFilePicker;
      let handle: FileSystemFileHandleLike | null = null;
      if (picker) {
        try {
          handle = await picker({ suggestedName: a.name });
        } catch (e) {
          if ((e as Error).name === 'AbortError') return; // the user cancelled
          handle = null;
        }
      }
      const opened = await rm.openFile(account, fileId, downloadSharedFromSia);
      let done = 0;
      const counted = opened.stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, c) {
            done += chunk.length;
            onProgress(opened.size ? done / opened.size : 1);
            c.enqueue(chunk);
          },
        }),
      );
      if (handle) {
        // Written straight to disk as it downloads and decrypts.
        await counted.pipeTo(await handle.createWritable());
        return;
      }
      // Without a save dialog (e.g. Safari, Firefox): the browser assembles the
      // file, then downloads it.
      const blob = await new Response(counted).blob();
      const url = URL.createObjectURL(new Blob([blob], { type: opened.mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = opened.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    warm: (a: string) => void rm?.warm(a, 'chat'),
    warmTyping: (a: string) => void rm?.warm(a, 'typing'),
  };
}
