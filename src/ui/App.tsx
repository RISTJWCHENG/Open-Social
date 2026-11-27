import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { secureGet, secureSet } from '../core/storage/secureStore';
import { useAccount } from './useAccount';
import type { AccountProvider } from '../core/interfaces';
import { NOT_IN_PROTOTYPE, ProfilePanel, type ProfileTab } from './ProfilePanel';
import { Onboarding } from './Onboarding';
import { SettingsPage, type SettingsTab } from './SettingsPage';
import { AppLogo } from './AppLogo';
import { SignInPage } from './SignInPage';
import type { SignUpDetails } from './SignUpPage';
import { VerifyEmailDialog } from './VerifyEmailDialog';
import { emptyProfile, type ProfileVisibility } from '../core/profile/profile';
import { presenceLine, STATUS_LABEL } from '../core/profile/presence';
import { PRESENCE_STATUSES, type PresenceStatus } from '../core/profile/sealedProfile';
import { PeopleSearch } from './PeopleSearch';
import { useTabLock } from './useTabLock';
import { Avatar, initial } from './Avatar';
import { useNoZoom } from './useNoZoom';
import { usePhone } from './usePhone';
import { ChatSettingsMenu } from './ChatSettingsMenu';
import { chatTheme, chatThemeStyle } from './chatThemes';
import { friendlyNetworkError, useRealMessaging, type SiaClientLike as AttachmentSia } from './useRealMessaging';
import { AttachmentView } from './AttachmentView';
import { ComposerActions } from './ComposerActions';
import { AttachmentTray, MAX_STAGED, type StagedFile } from './AttachmentTray';
import { ChatMenu, type ChatMenuAction } from './ChatMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { ChatToolbar } from './ChatToolbar';
import { MessageText } from './MessageText';
import { NewsPanel } from './NewsPanel';
import { NewsList } from './NewsList';
import { NewsArticle } from './NewsArticle';
import { useNews } from './useNews';
import { useHashFirst } from './useHashFirst';
import { NewsHome } from './NewsHome';
import { EventsPanel } from './events/EventsPanel';
import { SpacePanel } from './space/SpacePanel';
import { SpacePeople } from './space/SpacePeople';
import { SpaceHome } from './space/SpaceHome';
import { SpaceFeed } from './space/SpaceFeed';
import { ItemDetail } from './space/ItemDetail';
import { ItemEditor } from './space/ItemEditor';
import { SpaceSettingsForm } from './space/SpaceSettingsForm';
import { useSpace } from './space/useSpace';
import { spaceLink, spaceRouteFromHash, type ItemKind } from '../core/space/space';

type SpaceNav =
  | { page: 'space'; owner: string }
  | { page: 'explore' }
  | { page: 'following' }
  | { page: 'item'; id: string }
  | { page: 'edit'; id?: string; kind?: ItemKind }
  | { page: 'settings' };
import { useRailPrefs } from './useRailPrefs';
import { visibleRail, type RailId } from '../core/settings/railPrefs';
import { MarketPanel, type MarketTab } from './market/MarketPanel';
import { MarketGrid } from './market/MarketGrid';
import { ListingDetail } from './market/ListingDetail';
import { ListingEditor } from './market/ListingEditor';
import { EMPTY_QUERY, useMarket } from './market/useMarket';
import { listingIdFromHash, listingLink } from '../core/market/market';
import { EventDetail } from './events/EventDetail';
import { EventEditor } from './events/EventEditor';
import { EventCard } from './events/EventCard';
import { askNotificationPermission, useEventReminders } from './events/useEventReminders';
import { eventWhen, pendingInvites } from '../core/events/events';
import { IndexDetail, IndexList, PriceDetail, PriceList } from './NewsMarkets';
import type { NewsSection } from '../core/news/hashfirst';
import type { NewsItem } from '../core/news/news';
import { LinkPreviewBar, LinkPreviewCard } from './LinkPreviewCard';
import { useLinkDraftPreview } from './useLinkDraftPreview';
import { TranslationBar } from './TranslationBar';
import { browserTranslationApi, canTranslateHere } from '../core/translate/onDeviceTranslation';
import { useChatTranslation } from './useChatTranslation';
import { HighlightsPanel } from './HighlightsPanel';
import { QuoteMedia } from './QuoteMedia';
import { LevelBadge } from './LevelBadge';
import { PanelBar, type PanelView } from './PanelBar';
import { PopoverMenu } from './PopoverMenu';
import { ContactsPanel } from './ContactsPanel';
import { canPost, groupIdOf } from '../core/groups/groups';
import { NewGroupDialog } from './groups/NewGroupDialog';
import { GroupInfoPanel } from './groups/GroupInfoPanel';
import { groupPreview, memberCount, noticeText } from './groups/groupText';
import { MessagingStatus } from './MessagingStatus';
import { CallScreen } from './calls/CallScreen';
import type { CallLog } from '../core/calls/calls';
import { EmojiPicker } from './emoji/EmojiPicker';
import { VoiceRecorderBar } from './voice/VoiceRecorderBar';
import { formatDuration } from './voice/recorder';
import { canEdit, messageRef, quoteOf, type RealMessage } from '../core/delivery/realMessaging';
import { dayLabel, isNewDay } from './dayLabel';
import { ReactionBadge, ReactionEmojiPanel, ReactionPicker, ReactionRow, withRecentReaction } from './Reactions';
import { SiaStorageClient } from '../modules/sia-storage';
import type { SiaClientLike } from './SiaStorageCard';
import {
  loadRecoverySetup,
  saveRecoverySetup,
  type RecoverySetup,
} from '../core/recovery/setupStore';
import {
  ArchiveIcon,
  BackIcon,
  BellOffIcon,
  ChevronDownIcon,
  EditIcon,
  ReplyIcon,
  SmileIcon,
  MoreVerticalIcon,
  CloseIcon,
  BlockIcon,
  TrashIcon,
  CopyIcon,
  PinIcon,
  StarIcon,
  TickIcon,
  GroupIcon,
  ChatsIcon,
  CalendarIcon,
  MarketIcon,
  SpaceIcon,
  ChatsRailIcon,
  CircleIcon,
  ContactsBookIcon,
  CoffeeIcon,
  NewsIcon,
  IdeaIcon,
  LayersIcon,
  NetworkIcon,
  CheckIcon,
  ClockIcon,
  LockIcon,
  MenuIcon,
  MicIcon,
  StickerIcon,
  PhoneIcon,
  SignInIcon,
  SignOutIcon,
  WalletIcon,
  ExpandIcon,
  CollapseIcon,
  ProfileIcon,
  DiamondIcon,
  IdentityIcon,
  PasskeyIcon,
  SignInMailIcon,
  HomeIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  VideoIcon,
  ZapIcon,
} from './icons';

/** The OpenSocial Official Website (open-social-website canister), opened from the main menu. */
const WEBSITE_URL = 'https://opensocial.cc/';

type Filter = 'all' | 'unread' | 'groups' | 'favorites';

/** Marks the notes-to-self chat in the chat list: "Ada Lovelace (Myself)". */
const SELF_MARK = 'Myself';

/**
 * What a large file waiting on a direct link is doing, from the link status:
 * clearer than a generic "waiting" when the friend is in fact online.
 */
function p2pNote(link: 'open' | 'connecting' | 'failed' | 'none', active: boolean, dir: 'in' | 'out', sia: boolean): string {
  const who = dir === 'out' ? 'your friend' : 'the sender';
  if (link === 'open') return 'Starting the transfer…';
  if (link === 'connecting' || (link === 'none' && active)) return `Connecting directly to ${who}…`;
  if (link === 'failed') {
    return dir === 'out'
      ? sia
        ? 'Your networks can’t connect directly. Send it via Sia instead'
        : 'Your networks can’t connect directly. Connect Sia in Settings › Account to send it another way'
      : 'Your networks can’t connect directly. Ask the sender to send it via Sia';
  }
  return `Waiting for ${who} to come online`;
}

/** One-line preview of a message for the chat list ("You: " for own messages; files by name). */
/** A steady colour per group member for their name above their messages. */
function authorColor(account: string): string {
  let h = 0;
  for (const ch of account) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 40%)`;
}

function previewOf(
  m: {
    direction: 'in' | 'out';
    body: string;
    attachment?: { name: string; voice?: { ms: number } };
    call?: CallLog;
    deleted?: boolean;
    eventId?: string;
  },
  mark = true,
  eventTitle?: string,
): string {
  if (m.deleted) return m.direction === 'out' ? 'You deleted this message' : '🚫 This message was deleted';
  if (m.eventId) return `${mark && m.direction === 'out' ? 'You: ' : ''}📅 ${eventTitle ?? 'Event'}`;
  if (m.call) return `${m.call.kind === 'video' ? '📹' : '📞'} ${callText(m.call, m.direction)}`;
  const text = m.attachment?.voice
    ? `🎤 Voice message (${formatDuration(m.attachment.voice.ms)})`
    : m.attachment
      ? `📎 ${m.attachment.name}${m.body ? ` ${m.body}` : ''}`
      : m.body || 'Message';
  return `${mark && m.direction === 'out' ? 'You: ' : ''}${text}`;
}

/** A call in words, for the chat and the chat list. */
function callText(c: CallLog, direction: 'in' | 'out'): string {
  const what = c.kind === 'video' ? 'video call' : 'voice call';
  switch (c.outcome) {
    case 'ended':
      return `${direction === 'out' ? 'Outgoing' : 'Incoming'} ${what}${c.ms ? ` · ${formatDuration(c.ms)}` : ''}`;
    case 'missed':
      return `Missed ${what}`;
    case 'no-answer':
      return `${what[0]!.toUpperCase()}${what.slice(1)} · No answer`;
    case 'declined':
      return `${what[0]!.toUpperCase()}${what.slice(1)} · Declined`;
    case 'busy':
      return `${what[0]!.toUpperCase()}${what.slice(1)} · Busy`;
    case 'cancelled':
      return `${what[0]!.toUpperCase()}${what.slice(1)} · Cancelled`;
    case 'failed':
      return `${what[0]!.toUpperCase()}${what.slice(1)} · Couldn’t connect`;
  }
}

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * One tick on your own messages, coloured by state: grey sent, green
 * delivered, magenta read (shown as delivered when read receipts are off).
 * The label says it too.
 */
function StatusMark({ m, showRead, onRetry }: { m: RealMessage; showRead: boolean; onRetry?: () => void }) {
  // Their messages carry no tick: the state only matters for what you sent.
  if (m.direction === 'in') return null;
  if (m.status === 'sending') return <ClockIcon className="msg-clock" aria-hidden={false} aria-label="Sending" role="img" />;
  if (m.status === 'failed') {
    return onRetry ? (
      <button type="button" className="failed retry-btn" onClick={onRetry} title="Tap to retry" aria-label="Not sent. Send again">
        Not sent · Retry
      </button>
    ) : (
      <span className="failed">Not sent</span>
    );
  }
  const state = m.status === 'read' && !showRead ? 'delivered' : m.status;
  const label = state === 'read' ? 'Read' : state === 'delivered' ? 'Delivered' : 'Sent';
  return (
    <span className={`tick tick-${state}`} title={label}>
      <TickIcon aria-hidden={false} aria-label={label} role="img" />
    </span>
  );
}

function RailButton({
  label,
  children,
  active = false,
  badge,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  const disabled = !onClick;
  return (
    <button
      type="button"
      className={`rail-item ${active ? 'active' : ''}`}
      aria-label={disabled ? `${label} (${NOT_IN_PROTOTYPE.toLowerCase()})` : label}
      aria-current={active ? 'page' : undefined}
      title={disabled ? NOT_IN_PROTOTYPE : label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="sidebar-icon">
        {children}
        {badge ? (
          <span className="badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="rail-label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

export function App(options: { accountProvider?: AccountProvider; siaClientFor?: (principal: string) => SiaClientLike } = {}) {
  const z = useAccount(options);
  /** Open chat: "real:<account principal>", or none. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  // The profile sits beside the chat on wide screens; on narrow screens it is an overlay.
  const [profileOpen, setProfileOpen] = useState(
    () => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1181px)').matches,
  );
  const [profileTab, setProfileTab] = useState<ProfileTab>('media');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  // Files chosen to send, waiting above the message box until send is pressed.
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const stage = (files: File[]) => {
    if (!files.length) return;
    const tooBig = files.find((f) => f.size > 2 * 1024 * 1024 * 1024);
    if (tooBig) setSendError(`“${tooBig.name}” is larger than 2 GB. Files can be up to 2 GB.`);
    const ok = files.filter((f) => f.size <= 2 * 1024 * 1024 * 1024);
    setStaged((s) =>
      [...s, ...ok.map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file }))].slice(0, MAX_STAGED),
    );
    requestAnimationFrame(() => draftInput.current?.focus());
  };
  // Chat list: the open ▾ menu, a pending confirmation, and the Archived view.
  const [chatMenu, setChatMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [confirm, setConfirm] = useState<{
    item: { id: string; name: string };
    action: 'block' | 'clear' | 'delete' | 'remove';
  } | null>(null);
  // An invite link (#add=<OpenSocial ID>) opens Add contact with the ID filled in.
  const [inviteId, setInviteId] = useState<string | null>(() => {
    const m = /^#add=([a-z0-9-]{20,80})$/.exec(window.location.hash);
    return m ? m[1]! : null;
  });
  useEffect(() => {
    if (!inviteId) return;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setRailView('contacts');
  }, [inviteId]);
  const [showArchived, setShowArchived] = useState(false);
  // A message's ▾ menu, and confirming a deletion.
  const [msgMenu, setMsgMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [msgConfirm, setMsgConfirm] = useState<{ id: string; everyone: boolean } | null>(null);
  // Left column: chats or contacts (the rail switches between them).
  const [railView, setRailView] = useState<'chats' | 'contacts' | 'news' | 'events' | 'market' | 'space'>('chats');
  const [spaceStack, setSpaceStack] = useState<SpaceNav[]>([]);
  const [spaceItemMissing, setSpaceItemMissing] = useState(false);
  const [marketTab, setMarketTab] = useState<MarketTab>('browse');
  const [listingId, setListingId] = useState<string | null>(null);
  const [listingMissing, setListingMissing] = useState(false);
  /** The listing form: a new listing, or editing one. */
  const [listingForm, setListingForm] = useState<{ id?: string } | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  /** The event form: a new event (on a picked day) or editing one. */
  const [eventForm, setEventForm] = useState<{ id?: string; day?: string } | null>(null);
  const [newsItem, setNewsItem] = useState<NewsItem | null>(null);
  const [newsSection, setNewsSection] = useState<NewsSection>('ecosystem');
  const [newsCoinId, setNewsCoinId] = useState<string | null>(null);
  const [newsIndexSlug, setNewsIndexSlug] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  // Voice messages need a microphone API and a recorder (all current browsers on HTTPS).
  const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const draftInput = useRef<HTMLInputElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recentEmoji, setRecentEmoji] = useState<string[]>([]);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newChatId, setNewChatId] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [newChatBusy, setNewChatBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mainMenu, setMainMenu] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);
  const principal = z.account?.principal;
  // Read synchronously so the setup screen never flashes for users who already finished it.
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const recovery = useMemo(
    () => (principal ? loadRecoverySetup(principal) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [principal, recoveryVersion],
  );
  const needsOnboarding = z.signedIn && !!principal && recovery === null;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const makeSia = options.siaClientFor ?? ((p: string) => new SiaStorageClient(p));
  const siaClient = useMemo(
    () => (principal ? makeSia(principal) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [principal],
  );
  const [keyFlow, setKeyFlow] = useState(false);
  const recoveryMissing = !!recovery && recovery.methods.length === 0;
  const tab = useTabLock(z.signedIn ? principal ?? null : null);
  const real = useRealMessaging(principal, z.provider, z.signedIn, tab.active);
  const eventInvites = principal ? pendingInvites(real.events, principal).length : 0;
  const reminders = useEventReminders(real.events, real.eventReminder);
  const openEvent = (id: string) => {
    setRailView('events');
    setEventId(id);
    setEventForm(null);
    setMobileView('chat');
  };
  const personOf = (account: string) =>
    account === principal
      ? { name: 'You', avatar: myProfile?.avatar || undefined }
      : (() => {
          const c = real.contacts.find((x) => x.account === account);
          return { name: c?.name ?? `${account.slice(0, 5)}…${account.slice(-3)}`, avatar: c?.profile?.avatar || undefined };
        })();
  const market = useMarket(() => z.provider.agentIdentity?.() ?? null, principal, railView === 'market');
  const openListing = (id: string) => {
    setRailView('market');
    setListingId(id);
    setListingForm(null);
    setListingMissing(false);
    setMobileView('chat');
    void market.load(id).then((l) => setListingMissing(!l), () => undefined);
  };
  // Links such as https://chat.opensocial.cc/#/market/12 open that listing.
  useEffect(() => {
    const go = () => {
      const id = listingIdFromHash(location.hash);
      if (id) openListing(id);
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [railPrefs, setRailPrefs] = useRailPrefs(principal);
  // A hidden feature can't stay open.
  useEffect(() => {
    const map: Partial<Record<typeof railView, RailId>> = { news: 'news', contacts: 'contacts', events: 'events', market: 'market', space: 'space' };
    const id = map[railView];
    if (id && railPrefs.hidden.includes(id)) setRailView('chats');
  }, [railPrefs, railView]);
  const news = useNews(
    railView === 'news' && (newsSection === 'ecosystem' || newsSection === 'home') && !!principal,
    real.fetchNews,
  );
  const hashfirst = useHashFirst(railView === 'news' && principal ? newsSection : null, real.fetchHashFirst);
  const newsCoin = hashfirst.coins.find((c) => c.id === newsCoinId) ?? hashfirst.coins[0] ?? null;
  const newsIndex = hashfirst.indexes.find((i) => i.slug === newsIndexSlug) ?? hashfirst.indexes[0] ?? null;
  /** The open section's list: in the right column, or (on a phone) under the sections. */
  const newsColumn = (className?: string) => {
    if (newsSection === 'price')
      return (
        <PriceList
          className={className}
          coins={hashfirst.coins}
          state={hashfirst}
          selectedId={newsCoin?.id ?? null}
          onSelect={(c) => {
            setNewsCoinId(c.id);
            setMobileView('chat');
          }}
        />
      );
    if (newsSection === 'index')
      return (
        <IndexList
          className={className}
          indexes={hashfirst.indexes}
          state={hashfirst}
          selectedSlug={newsIndex?.slug ?? null}
          onSelect={(i) => {
            setNewsIndexSlug(i.slug);
            setMobileView('chat');
          }}
        />
      );
    const stories =
      newsSection === 'ecosystem'
        ? news
        : {
            items:
              newsSection === 'home'
                ? hashfirst.stories.slice(0, 40)
                : hashfirst.stories.filter((s) => s.section === newsSection).slice(0, 40),
            fetchedAt: 0,
            loading: hashfirst.loading,
            error: hashfirst.error,
            reload: hashfirst.reload,
          };
    return (
      <NewsList
        key={newsSection}
        className={className}
        section={newsSection}
        news={stories}
        selectedId={newsItem?.id ?? null}
        onSelect={(item) => {
          setNewsItem(item);
          setMobileView('chat');
        }}
      />
    );
  };
  // Sia buttons on attachments only when the user's Sia storage is connected.
  const [siaReady, setSiaReady] = useState(false);
  useEffect(() => {
    let alive = true;
    if (siaClient) void siaClient.resume().then((ok) => alive && setSiaReady(ok)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [siaClient]);
  const siaConnected = siaReady || !!siaClient?.isConnected();
  const myProfile = real.myProfile?.profile ?? null;
  const space = useSpace(
    () => z.provider.agentIdentity?.() ?? null,
    principal,
    real.profiles ?? null,
    useCallback(
      (a: string) => {
        if (a === principal) return { name: myProfile?.displayName?.trim() || 'You', avatar: myProfile?.avatar || undefined };
        const c = real.contacts.find((x) => x.account === a && x.known);
        return c ? { name: c.name, avatar: c.profile?.avatar || undefined } : null;
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [principal, myProfile, real.contacts],
    ),
  );
  const spaceNav: SpaceNav =
    spaceStack[spaceStack.length - 1] ?? (principal ? { page: 'space', owner: principal } : { page: 'explore' });
  const spaceGo = (n: SpaceNav, mode: 'push' | 'replace' | 'root' = 'push') => {
    setRailView('space');
    setSpaceItemMissing(false);
    setSpaceStack((st) => (mode === 'root' ? [n] : mode === 'replace' ? [...st.slice(0, -1), n] : [...st, n].slice(-30)));
    setMobileView('chat');
    if (n.page === 'item' && !space.items[n.id]) {
      void space.loadItem(n.id).then((i) => setSpaceItemMissing(!i), () => setSpaceItemMissing(true));
    }
  };
  const spaceBack = () => {
    if (spaceStack.length <= 1) setMobileView('list');
    setSpaceStack((st) => st.slice(0, -1));
    if (location.hash.startsWith('#/space/')) history.replaceState(null, '', location.pathname + location.search);
  };
  useEffect(() => {
    if (spaceNav.page === 'space' && railView === 'space') void space.loadSpace(spaceNav.owner);
    if (spaceNav.page === 'settings' && principal && railView === 'space') void space.loadSpace(principal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railView, spaceNav.page, spaceNav.page === 'space' ? spaceNav.owner : '']);
  /** Opens a chat with someone, with a message ready to send. */
  const messageAccount = (account: string, name: string, draftText: string) => {
    void (async () => {
      if (!real.contacts.some((c) => c.account === account)) await real.addContact(account, name);
      setRailView('chats');
      openChat(`real:${account}`);
      setDraft(draftText);
    })().catch((e: unknown) => setSendError(e instanceof Error ? e.message : String(e)));
  };
  const spacePeople = (inline: boolean) => (
    <SpacePeople
          inline={inline}
          me={principal}
          myPerson={principal ? space.person(principal) : { name: 'You' }}
          friends={real.contacts
            .filter((c) => c.known && !c.blocked && !c.deleted && !c.group && c.account !== principal)
            .map((c) => ({
              account: c.account,
              name: c.name,
              username: c.profile?.username || undefined,
              avatar: c.profile?.avatar || undefined,
            }))}
          openOwner={
            spaceNav.page === 'space'
              ? spaceNav.owner
              : spaceNav.page === 'item'
                ? (space.items[spaceNav.id]?.owner ?? null)
                : null
          }
          profiles={real.profiles ?? null}
          onOpenSpace={(owner) => spaceGo({ page: 'space', owner }, 'root')}
        />
  );
  // Links such as https://chat.opensocial.cc/#/space/<id>/3 open that space or item.
  useEffect(() => {
    const go = () => {
      const r = spaceRouteFromHash(location.hash);
      if (!r) return;
      spaceGo(r.itemId ? { page: 'item', id: r.itemId } : { page: 'space', owner: r.owner }, 'root');
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const visibility: ProfileVisibility = real.myProfile?.visibility ?? 'friends';
  const changeVisibility = async (v: ProfileVisibility) => {
    await real.publishProfile({ profile: real.myProfile?.profile ?? emptyProfile(), visibility: v });
  };
  // Our presence status, shared with friends in the sealed profile.
  // Shown at once while the change is being saved.
  const [pendingStatus, setPendingStatus] = useState<PresenceStatus | null>(null);
  const myStatus: PresenceStatus = pendingStatus ?? myProfile?.status ?? 'available';
  const [statusMenu, setStatusMenu] = useState(false);
  useEffect(() => {
    if (!mainMenu) setStatusMenu(false);
  }, [mainMenu]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const changeStatus = async (status: PresenceStatus) => {
    setStatusMenu(false);
    if (status === myStatus) return;
    setStatusError(null);
    setPendingStatus(status);
    try {
      await real.publishProfile({ profile: { ...(real.myProfile?.profile ?? emptyProfile()), status }, visibility });
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Could not change your status.');
    } finally {
      setPendingStatus(null);
    }
  };
  const fullPage = needsOnboarding || keyFlow;

  // Sign-up: the account is created with a new passkey; the chosen profile
  // details are published (and the inviter added) once messaging is ready.
  const [signUp, setSignUp] = useState<SignUpDetails | null>(null);
  const [signUpError, setSignUpError] = useState<string | null>(null);
  const [verifyEmail, setVerifyEmail] = useState<{ email: string; challengeId: string; sentTo: string } | null>(
    null,
  );
  useEffect(() => {
    if (signUp && z.authStatus === 'signed-out') setSignUp(null); // failed or cancelled
  }, [signUp, z.authStatus]);
  useEffect(() => {
    if (!signUp || !z.signedIn || !real.ready) return;
    const details = signUp;
    setSignUp(null);
    void (async () => {
      try {
        await real.publishProfile({
          profile: {
            ...(real.myProfile?.profile ?? emptyProfile()),
            username: details.username,
            displayName: details.displayName,
          },
          visibility: 'public',
        });
        if (details.inviter) await real.addContact(details.inviter.account, details.inviter.name);
      } catch (e) {
        setSignUpError(
          `Your account is ready, but your profile could not be saved (${e instanceof Error ? e.message : String(e)}). ` +
            'Set your username in Settings › Profile.',
        );
      }
      if (details.email && z.provider.sendEmailCode && z.provider.linkEmail) {
        try {
          const sent = await z.provider.sendEmailCode(details.email);
          setVerifyEmail({ email: details.email, ...sent });
        } catch (e) {
          setSignUpError(
            `Your account is ready, but the code for your recovery email could not be sent (${
              e instanceof Error ? e.message : String(e)
            }).`,
          );
        }
      }
    })();
  }, [signUp, z.signedIn, real.ready, real, z.provider]);

  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile');
  const openSettings = (tab: SettingsTab = 'profile') => {
    setSettingsTab(tab);
    setMainMenu(false);
    setMyProfileOpen(false);
    setSettingsOpen(true);
    setKeyFlow(false);
  };

  /** Own profile in the right panel, shown like a friend's (editing is in Settings). */
  const [myProfileOpen, setMyProfileOpen] = useState(false);
  const openMyProfile = () => {
    setMainMenu(false);
    setSettingsOpen(false);
    setKeyFlow(false);
    setMyProfileOpen(true);
  };

  /** Settings with the Profile card (its first card) in view. */
  const openProfileSettings = () => {
    openSettings('profile');
    // Profile is the first card: show the top of the panel. (Not scrollIntoView,
    // which would also scroll the page itself and hide the top of the app.)
    requestAnimationFrame(() => document.querySelector('.settings-panel .settings-body')?.scrollTo({ top: 0 }));
  };

  const saveNewKey = (setup: RecoverySetup) => {
    if (!principal) return;
    saveRecoverySetup(principal, {
      ...setup,
      methods: ['recovery-key'],
      skipped: false,
    });
    setRecoveryVersion((v) => v + 1);
    setKeyFlow(false);
  };

  const removeKey = () => {
    if (!principal || !recovery) return;
    saveRecoverySetup(principal, {
      methods: recovery.methods.filter((m) => m !== 'recovery-key'),
      completedAt: Date.now(),
      skipped: false,
    });
    setRecoveryVersion((v) => v + 1);
  };

  const completeOnboarding = (setup: RecoverySetup) => {
    if (!principal) return;
    saveRecoverySetup(principal, setup);
    setRecoveryVersion((v) => v + 1);
  };

  const endRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the main menu on outside click or Escape.
  useEffect(() => {
    if (!mainMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMainMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMainMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [mainMenu]);

  const handleSignOut = () => {
    setMainMenu(false);
    setDraft('');
    setActiveId(null);
    setMobileView('list');
    void z.signOut();
  };

  const handleSignIn = () => {
    setMainMenu(false);
    void z.signIn();
  };


  const realAccount = activeId?.startsWith('real:') ? activeId.slice(5) : null;
  const realContact = realAccount ? real.contacts.find((c) => c.account === realAccount) : undefined;
  // A group chat: its state, and whether we may write in it.
  const groupId = realAccount ? groupIdOf(realAccount) : null;
  const groupInfo = groupId ? real.group(groupId) : undefined;
  const groupLocked = !!groupId && (!groupInfo || groupInfo.left || !principal || !canPost(groupInfo.state, principal));
  const setOpenGroup = real.setOpenGroup;
  useEffect(() => setOpenGroup(groupId), [groupId, setOpenGroup]);
  const memberName = (account: string) => real.memberName(groupId, account);
  const memberAvatar = (account: string) =>
    account === principal
      ? myProfile?.avatar || undefined
      : real.contacts.find((c) => c.account === account && !c.group)?.profile?.avatar || undefined;
  /** Who wrote a quoted message: in a group, the quote names its author. */
  const quoteAuthor = (q: { author?: string }) => (q.author ? memberName(q.author) : active.name);
  /** Who reacted to a message in a group, for the reactions' label. */
  const reactorNames = (m: RealMessage) =>
    Object.keys(m.memberReactions ?? {})
      .map(memberName)
      .join(', ') || 'Others';
  const pickFriends = real.addressBook
    .filter((c) => c.known && !c.deleted)
    .map((c) => ({ account: c.account, name: c.name, avatar: c.profile?.avatar || undefined }));
  // Replying to a message (shown above the message box) and the 😊 picker beside a message.
  const [replyTo, setReplyTo] = useState<RealMessage | null>(null);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  // Every emoji, to react with one not in the quick row.
  const [reactAll, setReactAll] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  // Recently used reactions (the quick row), per account, in the encrypted device store.
  const [recentReactions, setRecentReactions] = useState<string[]>([]);
  // Editing one of our messages: its text is in the message box until saved or cancelled.
  const [editing, setEditing] = useState<RealMessage | null>(null);
  // Preview of the first link in the text being written (not for edits or file captions).
  const linkDraft = useLinkDraftPreview(
    draft,
    !!realAccount && !editing && staged.length === 0,
    real.fetchLinkPreview,
    real.fetchPreviewImage,
  );
  useEffect(() => {
    setReplyTo(null);
    setReactingTo(null);
    setEditing(null);
  }, [activeId]);
  const startEdit = (m: RealMessage) => {
    setReplyTo(null);
    setEditing(m);
    setDraft(m.body);
    requestAnimationFrame(() => draftInput.current?.focus());
  };
  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
  };
  const react = (m: RealMessage, emoji: string, on: boolean) => {
    if (!realAccount) return;
    setSendError(null);
    if (on) {
      const recent = withRecentReaction(recentReactions, emoji);
      setRecentReactions(recent);
      if (principal) void secureSet(`recent-reactions:${principal}`, recent);
    }
    void real.react(realAccount, m.id, emoji, on).catch((err) => setSendError(friendlyNetworkError(err)));
  };
  /** Messages that can be replied to and reacted to (not deleted, not calls, known to both sides). */
  const canRespond = (m: RealMessage) => !m.deleted && !m.call && !!messageRef(m);
  const startReply = (m: RealMessage) => {
    if (editing) cancelEdit();
    setReplyTo(m);
    draftInput.current?.focus();
  };
  // The ⋮ chat settings in the phone header: theme and text size, on this device.
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => setSettingsAnchor(null), [activeId]);
  const updateLook = (patch: { chatTheme?: string | null; textSize?: 'small' | 'default' | 'large' }) => {
    if (realAccount)
      void real.updateChat(realAccount, patch).catch((err) => setSendError(friendlyNetworkError(err)));
  };
  // Online / offline, and the friend's status while online (friends who shared their profile).
  const presence =
    realAccount && realContact?.known && !groupId ? presenceLine(real.isOnline(realAccount), realContact.profile?.status) : null;
  /** The notes-to-self chat (opened from the account avatar in the rail). */
  const isSelf = !!realAccount && realAccount === principal;
  const myName = myProfile?.displayName || (principal ? `${principal.slice(0, 5)}…${principal.slice(-3)}` : '');
  const active = {
    id: activeId,
    name: isSelf ? myName : realContact?.name ?? realAccount ?? '',
  };
  const messages: RealMessage[] = realAccount ? real.messages(realAccount) : [];
  const translationApi = useMemo(() => browserTranslationApi(), []);
  const [canTranslate, setCanTranslate] = useState(false);
  useEffect(() => {
    void canTranslateHere(translationApi).then(setCanTranslate);
  }, [translationApi]);
  const translateTo = (!isSelf && realContact?.translateTo) || null;
  const translation = useChatTranslation(canTranslate ? translationApi : null, messages, translateTo);

  const messagesBox = useRef<HTMLDivElement>(null);

  // Right panel: the profile, or the chat's highlighted messages (same panel, same width).
  const [rightView, setRightView] = useState<PanelView>('profile');
  const highlighted = realAccount ? real.highlightedMessages(realAccount) : [];
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  /** Highlights / un-highlights a message; highlighting shows the highlighted messages on the right. */
  const highlightMessage = async (id: string, on: boolean) => {
    if (!realAccount) return;
    await real.highlightMessage(realAccount, id, on);
    if (on) {
      setMyProfileOpen(false);
      setSettingsOpen(false);
      setProfileOpen(true);
      setRightView('highlights');
    }
  };
  /** The right panel's top bar: collapse, and the view switcher. */
  const panelBar = (
    <PanelBar
      view={rightView}
      onView={setRightView}
      highlightCount={highlighted.length}
      onCollapse={() => setProfileOpen(false)}
      overlay={rightView === 'profile'}
      title={rightView === 'highlights' ? 'Highlights' : rightView === 'shared' ? 'Shared' : undefined}
    />
  );

  /** Shows a message in the chat, its bubble ringed in colour for 3 seconds. */
  const jumpTo = (id: string) => {
    atBottom.current = false; // stop following the newest message
    messagesBox.current?.querySelector(`[data-mid="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // Restart the ring when the same message is chosen again.
    clearTimeout(flashTimer.current);
    setFlashId(null);
    requestAnimationFrame(() => setFlashId(id));
    flashTimer.current = setTimeout(() => setFlashId(null), 3000);
  };

  // Search in this chat: text, captions and file names; newest match first.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const matches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!searchOpen || !q) return [] as string[];
    return messages
      .filter((m) => !m.deleted && `${m.body} ${m.attachment?.name ?? ''}`.toLowerCase().includes(q))
      .map((m) => m.id)
      .reverse();
  }, [messages, searchOpen, searchQuery]);
  const currentMatch = matches[matchIndex];
  // Jump to a result when it changes (not on every refresh of the chat).
  useEffect(() => {
    if (!currentMatch) return;
    atBottom.current = false;
    messagesBox.current
      ?.querySelector(`[data-mid="${CSS.escape(currentMatch)}"]`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [currentMatch]);
  // A new chat starts without search or toolbar.
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setRightView('profile');
  }, [activeId]);

  const realUnread = (account: string) => real.unreadCount(account);
  // The open chat counts as read, including messages that arrive while it is open.
  useEffect(() => {
    if (realAccount && real.ready) real.markRead(realAccount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realAccount, messages.length, real.ready]);

  // Opening a friend's chat tries a direct link once (bounded per friend and hour).
  useEffect(() => {
    if (realAccount) real.warm(realAccount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realAccount, real.ready]);

  const [realFingerprint, setRealFingerprint] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setRealFingerprint(null);
    if (realAccount) void real.contactFingerprint(realAccount).then((f) => alive && setRealFingerprint(f));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realAccount, real.ready]);

  type ListItem = {
    id: string;
    name: string;
    preview: string;
    lastAt?: number;
    unread: number;
    avatar?: string;
    request?: boolean;
    self?: boolean;
    /** A group chat. */
    group?: boolean;
    pinned?: boolean;
    muted?: boolean;
    archived?: boolean;
    favorite?: boolean;
    markedUnread?: boolean;
  };
  // "Myself" is listed (at the top) only while it is the open chat: it appears
  // when the account avatar is clicked and goes away when another chat opens.
  const selfLast = principal ? real.messages(principal).at(-1) : undefined;
  const selfItems: ListItem[] =
    principal && isSelf
      ? [
          {
            id: `real:${principal}`,
            name: `${myName} (${SELF_MARK})`,
            avatar: myProfile?.avatar || undefined,
            preview: selfLast ? previewOf(selfLast, false, selfLast.eventId ? real.event(selfLast.eventId)?.title : undefined) : 'Notes to yourself',
            lastAt: selfLast?.sentAt,
            unread: 0,
            self: true,
          },
        ]
      : [];
  const realItems: ListItem[] = [...selfItems, ...real.contacts.map((c) => {
    const last = real.messages(c.account).at(-1);
    return {
      id: `real:${c.account}`,
      name: c.name,
      avatar: c.photo || c.profile?.avatar || undefined,
      request: !c.known,
      group: !!c.group,
      preview: last
        ? c.group
          ? groupPreview(last, previewOf(last, true), (a) => real.memberName(c.account.slice(2), a))
          : previewOf(last, true, last.eventId ? real.event(last.eventId)?.title : undefined)
        : c.known
          ? 'Say hello. Messages are end-to-end encrypted.'
          : 'New contact',
      lastAt: last?.sentAt,
      unread: activeId === `real:${c.account}` ? 0 : realUnread(c.account),
      pinned: !!c.pinnedAt,
      muted: real.isMuted(c.account),
      archived: !!c.archived,
      favorite: !!c.favorite,
      markedUnread: !!c.markedUnread && activeId !== `real:${c.account}`,
    };
  })];
  const totalUnread = realItems.reduce((n, i) => n + (i.muted ? 0 : i.unread), 0);
  const goRail = (v: typeof railView) => () => {
    setRailView(v);
    setMobileView('list');
  };
  const railDefs: {
    id: RailId;
    label: string;
    icon: React.ReactNode;
    active?: boolean;
    badge?: number;
    onClick?: () => void;
  }[] = [
    { id: 'chats', label: 'Chats', icon: <ChatsRailIcon />, active: railView === 'chats', badge: totalUnread, onClick: goRail('chats') },
    { id: 'updates', label: 'Updates', icon: <ZapIcon /> },
    { id: 'news', label: 'News', icon: <NewsIcon />, active: railView === 'news', onClick: goRail('news') },
    // 20px icon: a heavier line draws at the rail's common 1.65px.
    { id: 'video', label: 'Video calls', icon: <VideoIcon strokeWidth={1.98} /> },
    { id: 'contacts', label: 'Contacts', icon: <ContactsBookIcon />, active: railView === 'contacts', onClick: goRail('contacts') },
    { id: 'lounge', label: 'Lounge', icon: <CoffeeIcon /> },
    {
      id: 'events',
      label: 'Event',
      icon: <CalendarIcon />,
      active: railView === 'events',
      badge: eventInvites || undefined,
      onClick: goRail('events'),
    },
    { id: 'market', label: 'Market', icon: <MarketIcon />, active: railView === 'market', onClick: goRail('market') },
    { id: 'space', label: 'Space', icon: <SpaceIcon />, active: railView === 'space', onClick: goRail('space') },
    { id: 'ideas', label: 'Ideas', icon: <IdeaIcon /> },
    { id: 'spaces', label: 'Spaces', icon: <LayersIcon /> },
    { id: 'network', label: 'Network', icon: <NetworkIcon /> },
    { id: 'circles', label: 'Circles', icon: <CircleIcon /> },
  ];
  const archivedCount = realItems.filter((i) => i.archived).length;

  const visibleContacts = realItems.filter((c) => {
    if (!c.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (!!c.archived !== showArchived) return false;
    if (filter === 'unread') return c.unread > 0 || !!c.markedUnread;
    if (filter === 'favorites') return !!c.favorite;
    if (filter === 'groups') return !!c.group;
    return true;
  });

  /** A message's file as shown in the chat (also used for highlighted messages). */
  const renderAttachment = (m: RealMessage, realAccount: string) =>
    m.attachment ? (
    <AttachmentView
      a={m.attachment}
      load={real.fileBytes}
      save={(p) => real.saveFile(realAccount, m.attachment!.fileId, p)}
      openBlob={(p) => real.openBlob(realAccount, m.attachment!.fileId, p)}
      waitNote={m.attachment.via === 'p2p' ? p2pNote(real.linkStatus(realAccount), real.isActive(realAccount), m.direction, !!siaConnected) : undefined}
      retry={
        real.canRetry(m.attachment.fileId)
          ? () => real.retryFile(realAccount, m.attachment!.fileId)
          : undefined
      }
      sendViaSia={
        m.direction === 'out' && real.isWaiting(m.attachment.fileId) && siaConnected
          ? () => real.sendViaSia(realAccount, m.attachment!.fileId, siaClient as unknown as AttachmentSia)
          : undefined
      }
      saveToSia={
        siaConnected && (m.attachment.localChunks || m.attachment.via === 'inline') && m.attachment.state === 'ready'
          ? () => real.saveToMySia(realAccount, m.attachment!.fileId, siaClient as unknown as AttachmentSia)
          : undefined
      }
    />
    ) : null;

  /** Starts a call with the open chat's friend. */
  const call = async (kind: 'video' | 'voice') => {
    if (!realAccount) return;
    setSendError(null);
    try {
      await real.startCall(realAccount, kind);
    } catch (e) {
      setSendError(friendlyNetworkError(e));
    }
  };

  /** Runs an action from a chat's menu. */
  const chatAction = async (item: ListItem, action: ChatMenuAction) => {
    const account = item.id.slice(5);
    setSendError(null);
    try {
      if (typeof action === 'object') return await real.updateChat(account, { muteFor: action.mute });
      switch (action) {
        case 'archive':
        case 'unarchive':
          await real.updateChat(account, { archived: action === 'archive' });
          if (action === 'archive' && activeId === item.id) setActiveId(null);
          return;
        case 'pin':
        case 'unpin':
          return await real.updateChat(account, { pinned: action === 'pin' });
        case 'favorite':
        case 'unfavorite':
          return await real.updateChat(account, { favorite: action === 'favorite' });
        case 'unmute':
          return await real.updateChat(account, { muteFor: 0 });
        case 'mark-unread':
          // Opening a chat reads it: leave it, so the mark stays.
          if (activeId === item.id) setActiveId(null);
          return await real.updateChat(account, { markedUnread: true });
        case 'mark-read':
          return await real.markRead(account);
        case 'block':
        case 'clear':
        case 'delete':
          return setConfirm({ item, action });
      }
    } catch (e) {
      setSendError(friendlyNetworkError(e));
    }
  };

  const confirmed = async () => {
    if (!confirm) return;
    const { item, action } = confirm;
    const account = item.id.slice(5);
    setConfirm(null);
    if (action === 'block') {
      await real.block(account);
      if (activeId === item.id) setActiveId(null);
    } else if (action === 'remove') {
      await real.removeContact(account);
      if (activeId === item.id) setActiveId(null);
    } else if (action === 'clear') {
      await real.clearChat(account);
    } else {
      await real.deleteChat(account);
      if (activeId === item.id) setActiveId(null);
    }
  };

  // Scrolling: follow new messages only when already at the bottom; otherwise
  // keep the place and count what arrived (shown on the ↓ button).
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const atBottom = useRef(true);
  const seenCount = useRef(0);
  // The toolbar (search, pin, calls, info, ⋮) shows while scrolling up, when the
  // pointer nears the top of the chat, or when there is nothing to scroll; it
  // hides again on scrolling down.
  const [toolbarShown, setToolbarShown] = useState(true);
  // Phones: the app does not zoom, and the chat actions sit in a round button.
  const phone = usePhone();
  useNoZoom(phone);
  // Phones, in a chat: the side bar slides in from the right on a leftward swipe.
  const [railDrawer, setRailDrawer] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const horizontalSwipe = (e: ReactTouchEvent): number => {
    const t = e.touches[0];
    if (!swipe.current || !t) return 0;
    const dx = t.clientX - swipe.current.x;
    const dy = t.clientY - swipe.current.y;
    return Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy) ? dx : 0;
  };
  // Going somewhere (another chat, the list, a wider window) puts it away.
  useEffect(() => setRailDrawer(false), [activeId, mobileView, phone]);
  const swipeStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    swipe.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const lastScrollTop = useRef(0);
  const nearTop = useRef(false);
  const touchY = useRef<number | null>(null);
  const onMessagesScroll = () => {
    const el = messagesBox.current;
    if (!el) return;
    const delta = el.scrollTop - lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    if ((!phone && el.scrollHeight <= el.clientHeight + 1) || delta < -4) setToolbarShown(true);
    else if (delta > 4 && !nearTop.current) setToolbarShown(false);
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Only the reader scrolls away from the bottom: a photo growing as it
    // loads moves the bottom away, but we keep following it.
    if (distance < 80) atBottom.current = true;
    else if (Date.now() - userScrolledAt.current < 1000) atBottom.current = false;
    setAwayFromBottom(distance > 160);
    if (atBottom.current) setNewBelow(0);
  };
  const userScrolledAt = useRef(0);
  const userScrolls = () => {
    userScrolledAt.current = Date.now();
  };
  // Photos, videos and previews take their full height only once loaded, and
  // the message box changes height (staged files, keyboard): while following
  // the newest message, stay at the bottom so a message just sent shows whole.
  useEffect(() => {
    const box = messagesBox.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const stick = () => {
      if (atBottom.current) box.scrollTop = box.scrollHeight;
    };
    const sizes = new ResizeObserver(stick);
    sizes.observe(box);
    for (const child of box.children) sizes.observe(child);
    const added = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n instanceof Element && sizes.observe(n));
      stick();
    });
    added.observe(box, { childList: true });
    return () => {
      sizes.disconnect();
      added.disconnect();
    };
  }, [activeId, mobileView, phone]);
  const scrollToBottom = (smooth = true) => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
    setNewBelow(0);
  };
  // A chat opens at its newest message.
  useEffect(() => {
    atBottom.current = true;
    setAwayFromBottom(false);
    setNewBelow(0);
    seenCount.current = messages.length;
    endRef.current?.scrollIntoView?.({ block: 'end' });
    const el = messagesBox.current;
    if (el) lastScrollTop.current = el.scrollTop;
    // Phones: the round actions button waits for a downward swipe.
    setToolbarShown(!phone && (!el || el.scrollHeight <= el.clientHeight + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  useEffect(() => {
    const added = messages.length - seenCount.current;
    seenCount.current = messages.length;
    if (added <= 0) return;
    const last = messages.at(-1);
    // Your own message, or already at the bottom: follow it.
    if (atBottom.current || last?.direction === 'out') endRef.current?.scrollIntoView?.({ block: 'end' });
    else setNewBelow((n) => n + added);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Reopen the chat that was open last time (per account), else the most recent one.
  const restored = useRef<string | null>(null);

  // Recently used emoji, per account, in the encrypted device store.
  useEffect(() => {
    if (!principal) return;
    void secureGet<string[]>(`recent-emoji:${principal}`).then((r) => setRecentEmoji(Array.isArray(r) ? r : []));
    void secureGet<string[]>(`recent-reactions:${principal}`).then((r) =>
      setRecentReactions(Array.isArray(r) ? r : []),
    );
  }, [principal]);

  /** Inserts an emoji at the cursor (replacing any selection) and keeps typing there. */
  const insertEmoji = (emoji: string) => {
    const el = draftInput.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    if (!draft && realAccount && realAccount !== principal) real.warmTyping(realAccount);
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
    const recent = [emoji, ...recentEmoji.filter((e) => e !== emoji)].slice(0, 36);
    setRecentEmoji(recent);
    if (principal) void secureSet(`recent-emoji:${principal}`, recent);
  };
  useEffect(() => {
    if (!principal || !real.ready || restored.current === principal) return;
    restored.current = principal;
    void secureGet<string>(`last-chat:${principal}`).then((saved) => {
      const exists = (id: string | null | undefined) =>
        !!id &&
        (id === `real:${principal}` || real.contacts.some((c) => `real:${c.account}` === id));
      const target = exists(saved) ? saved! : (realItems[0]?.id ?? (real.contacts[0] ? `real:${real.contacts[0].account}` : undefined));
      if (target) setActiveId(target);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal, real.ready]);
  useEffect(() => {
    if (principal && restored.current === principal && activeId) void secureSet(`last-chat:${principal}`, activeId);
  }, [principal, activeId]);

  const openChat = (id: string) => {
    if (id !== activeId) setStaged([]);
    setMyProfileOpen(false);
    setActiveId(id);
    setMobileView('chat');
    setSendError(null);
  };

  const startNewChat = async (e: FormEvent) => {
    e.preventDefault();
    setNewChatBusy(true);
    setNewChatError(null);
    try {
      await real.addContact(newChatId.trim(), newChatName);
      const id = `real:${newChatId.trim()}`;
      setNewChatOpen(false);
      setNewChatId('');
      setNewChatName('');
      openChat(id);
    } catch (err) {
      setNewChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setNewChatBusy(false);
    }
  };

  const showAbout = () => {
    setRightView('profile');
    setProfileOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (editing) {
      if (!realAccount || !body) return;
      const target = editing;
      setEditing(null);
      setDraft('');
      setSendError(null);
      try {
        await real.editMessage(realAccount, target.id, body);
      } catch (err) {
        setSendError(friendlyNetworkError(err));
      }
      return;
    }
    if (!realAccount || (!body && staged.length === 0)) return;
    setDraft('');
    setSendError(null);
    if (staged.length) {
      // Files go in order; the text is the first file's caption.
      const files = staged;
      setStaged([]);
      for (const [i, f] of files.entries()) {
        try {
          await real.sendFile(realAccount, f.file, siaClient as unknown as AttachmentSia | null, {
            ...(i === 0 && body ? { caption: body } : {}),
          });
        } catch (err) {
          setSendError(friendlyNetworkError(err));
        }
      }
      return;
    }
    const quoted = replyTo;
    setReplyTo(null);
    try {
      const preview = await linkDraft.take(body);
      await real.send(realAccount, body, quoted?.id, preview);
    } catch (err) {
      setSendError(friendlyNetworkError(err));
    }
  };

  const emptyListText: Record<Filter, string> = {
    all: query.trim() ? `No chats match “${query}”.` : 'No chats yet. Start one with + or find people in search.',
    unread: 'You’re all caught up.',
    groups: 'No groups yet. Group chats are not part of this prototype.',
    favorites: 'No favorites yet. Add a chat with its ▾ menu.',
  };

  if (!z.signedIn) {
    // Signed out: a standalone page with no chat UI behind it.
    return (
      <SignInPage
        status={z.authStatus}
        error={z.authError}
        methods={z.signInMethods}
        busyWith={z.signingInWith}
        onSignIn={(method, params) => void z.signIn(method, params)}
        onCancel={z.cancelSignIn}
        emailStep={z.emailStep}
        emailSending={z.emailSending}
        onSendEmail={(email) => void z.sendEmailCode(email)}
        onResetEmail={z.resetEmail}
        onSignUp={(details) => {
          setSignUp(details);
          void z.signIn('passkey-new');
        }}
      />
    );
  }

  if (!tab.active && !tab.pending) {
    // Another tab of this browser runs OpenSocial for this account.
    return (
      <main className="signin-page" aria-label="Open in another tab">
        <div className="signin-card other-tab">
          <AppLogo />
          <h1>OpenSocial is open in another tab</h1>
          <p className="signin-sub">
            One tab at a time keeps your messages and encryption in step. Use OpenSocial here, and the other tab
            pauses.
          </p>
          <button type="button" className="pill-btn" onClick={tab.takeOver}>
            Use here
          </button>
        </div>
      </main>
    );
  }

  return (
    <div
      className="app"
      data-view={mobileView}
      data-profile={profileOpen || myProfileOpen ? 'open' : 'closed'}
      data-settings={settingsOpen ? 'open' : 'closed'}
      data-signed={z.signedIn ? 'in' : 'out'}
      data-rail={railExpanded ? 'expanded' : 'collapsed'}
      data-onboarding={fullPage ? 'yes' : 'no'}
      data-drawer={railDrawer ? 'open' : 'closed'}
    >
      {verifyEmail && z.provider.linkEmail && z.provider.sendEmailCode && (
        <VerifyEmailDialog
          sentTo={verifyEmail.sentTo}
          onVerify={async (code) => {
            await z.provider.linkEmail?.(verifyEmail.challengeId, code);
            setVerifyEmail(null);
          }}
          onResend={async () => {
            const sent = await z.provider.sendEmailCode!(verifyEmail.email);
            setVerifyEmail({ email: verifyEmail.email, ...sent });
          }}
          onSkip={() => setVerifyEmail(null)}
        />
      )}
      {signUpError && (
        <div className="app-notice" role="alert">
          <span>{signUpError}</span>
          <button type="button" className="link-btn" onClick={() => setSignUpError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {/* Left sidebar: slim icon bar */}
      {railDrawer && <div className="rail-backdrop" aria-hidden="true" onClick={() => setRailDrawer(false)} />}
      <nav
        className="sidebar"
        aria-label="Main menu"
        onTouchStart={swipeStart}
        onTouchMove={(e) => {
          if (railDrawer && horizontalSwipe(e) > 0) setRailDrawer(false);
        }}
      >
        <button
          type="button"
          className={`rail-item rail-me ${isSelf ? 'active' : ''}`}
          disabled={!z.signedIn || !principal || !real.ready}
          onClick={() => principal && openChat(`real:${principal}`)}
          aria-label={z.signedIn ? `${myName} (${SELF_MARK}): notes to yourself` : 'Signed out'}
          title={z.signedIn ? `${myName} (${SELF_MARK}): notes to yourself` : 'Signed out'}
        >
          <span className="sidebar-me">
            {myProfile?.avatar ? (
              <img className="avatar avatar-40 avatar-img" src={myProfile.avatar} alt="" />
            ) : (
              <Avatar
                name={z.signedIn ? myProfile?.displayName || 'You' : '?'}
                className="avatar-40"
                seed={principal ?? undefined}
              />
            )}
          </span>
          <span className="rail-label" aria-hidden="true">
            {z.signedIn ? myName : 'Signed out'}
          </span>
        </button>
        {/* The sections; they scroll when the window is too short to show them all. */}
        <div className="rail-scroll">
          {visibleRail(railPrefs).map((id) => {
            const d = railDefs.find((x) => x.id === id)!;
            return (
              <RailButton key={id} label={d.label} active={d.active} badge={d.badge} onClick={d.onClick}>
                {d.icon}
              </RailButton>
            );
          })}
        </div>
        {/* Main menu: at the bottom of the rail, just above the expand / collapse button. */}
        <div className="menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`rail-item ${mainMenu ? 'active' : ''}`}
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={mainMenu}
            onClick={() => setMainMenu((o) => !o)}
          >
            <span className="sidebar-icon">
              <MenuIcon />
            </span>
            <span className="rail-label" aria-hidden="true">
              Menu
            </span>
          </button>
          {mainMenu && (
            <div className="main-menu" role="menu" aria-label="Account">
              {z.signedIn && z.account?.method && (
                <>
                  <p className="main-menu-status">
                    <span className="main-menu-status-icon" aria-hidden="true">
                      {z.account.method === 'ii' ? (
                        <IdentityIcon />
                      ) : z.account.method === 'email' ? (
                        <SignInMailIcon />
                      ) : (
                        <PasskeyIcon />
                      )}
                    </span>
                    <span>
                      Signed in with{' '}
                      <strong>
                        {z.account.method === 'ii'
                          ? 'Internet Identity'
                          : z.account.method === 'email'
                            ? 'an email code'
                            : 'a passkey'}
                      </strong>
                    </span>
                  </p>
                  <span className="main-menu-divider" role="separator" />
                  {/* Status: shown to friends while we are online. */}
                  <button
                    type="button"
                    role="menuitem"
                    className="main-menu-item main-menu-presence"
                    aria-haspopup="true"
                    aria-expanded={statusMenu}
                    onClick={() => setStatusMenu((o) => !o)}
                  >
                    <span className={`presence-dot is-${myStatus}`} aria-hidden="true" />
                    <span>{STATUS_LABEL[myStatus]}</span>
                    <span className="main-menu-chevron" aria-hidden="true">
                      <ChevronDownIcon />
                    </span>
                  </button>
                  {statusMenu && (
                    <div className="main-menu-statuses" role="group" aria-label="Your status">
                      {PRESENCE_STATUSES.map((st) => (
                        <button
                          key={st}
                          type="button"
                          role="menuitemradio"
                          aria-checked={st === myStatus}
                          className="main-menu-item main-menu-status-option"
                          onClick={() => void changeStatus(st)}
                        >
                          <span className={`presence-dot is-${st}`} aria-hidden="true" />
                          <span>{STATUS_LABEL[st]}</span>
                          {st === myStatus && (
                            <span className="main-menu-check" aria-hidden="true">
                              <CheckIcon />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {statusError && (
                    <p className="main-menu-error" role="alert">
                      {statusError}
                    </p>
                  )}
                  <span className="main-menu-divider" role="separator" />
                </>
              )}
              <button
                type="button"
                role="menuitem"
                className="main-menu-item"
                onClick={openMyProfile}
              >
                {/* Your own photo when you have one, at the size of the other menu icons. */}
                {myProfile?.avatar ? (
                  <img className="main-menu-avatar" src={myProfile.avatar} alt="" />
                ) : (
                  <ProfileIcon />
                )}
                <span className="main-menu-label">My Profile</span>
              </button>
              {(
                [
                  ['Wallet', <WalletIcon key="w" />],
                  ['Diamond', <DiamondIcon key="d" />],
                ] as const
              ).map(([label, icon]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  className="main-menu-item is-soon"
                  aria-disabled="true"
                  aria-label={`${label} (${NOT_IN_PROTOTYPE.toLowerCase()})`}
                  title={NOT_IN_PROTOTYPE}
                  onClick={(e) => e.preventDefault()}
                >
                  {icon}
                  <span className="main-menu-label">{label}</span>
                  <span className="soon">Soon</span>
                </button>
              ))}
              <span className="main-menu-divider" role="separator" />
              <a
                role="menuitem"
                className="main-menu-item"
                href={WEBSITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMainMenu(false)}
              >
                <HomeIcon />
                <span className="main-menu-label">Home Page</span>
              </a>
              <span className="main-menu-divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="main-menu-item menu-settings"
                disabled={!z.signedIn}
                onClick={() => openSettings()}
              >
                {/* 16 px wide with 1.35 px lines, like the other menu icons. */}
                <SettingsIcon width={16} height={16} strokeWidth={2.03} style={{ margin: '0 1px' }} />
                Settings
              </button>
              <span className="main-menu-divider" role="separator" />
              {/* Only the action that applies right now is shown. */}
              {z.signedIn ? (
                <button
                  type="button"
                  role="menuitem"
                  className="main-menu-item is-danger"
                  onClick={handleSignOut}
                >
                  <SignOutIcon width={19.4} height={19.4} strokeWidth={1.67} style={{ margin: '0 -0.7px' }} />
                  Sign out
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="main-menu-item"
                  disabled={z.authStatus !== 'signed-out'}
                  onClick={handleSignIn}
                >
                  <SignInIcon />
                  Sign in
                </button>
              )}
              <p className="main-menu-note">
                Signing out deletes this device’s message keys and all messages.
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          className="rail-item rail-toggle"
          aria-label={railExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={railExpanded}
          title={railExpanded ? 'Collapse' : 'Expand'}
          onClick={() => setRailExpanded((v) => !v)}
        >
          <span className="sidebar-icon">
            {railExpanded ? <CollapseIcon strokeWidth={2.2} /> : <ExpandIcon strokeWidth={2.2} />}
          </span>
          <span className="rail-label" aria-hidden="true">
            Collapse
          </span>
        </button>
      </nav>

      {/* Left column: the chat list, or the address book */}
      {railView === 'space' ? (
        <SpacePanel
          me={principal}
          myPerson={principal ? space.person(principal) : { name: 'You' }}
          page={
            spaceNav.page === 'explore'
              ? 'explore'
              : spaceNav.page === 'following'
                ? 'following'
                : spaceNav.page === 'space'
                  ? spaceNav.owner === principal
                    ? 'mine'
                    : 'other'
                  : spaceNav.page === 'item'
                    ? space.items[spaceNav.id]?.owner === principal
                      ? 'mine'
                      : 'other'
                    : 'mine'
          }
          openOwner={spaceNav.page === 'space' ? spaceNav.owner : null}
          follows={space.follows}
          person={space.person}
          profiles={real.profiles ?? null}
          onMine={() => principal && spaceGo({ page: 'space', owner: principal }, 'root')}
          onExplore={() => spaceGo({ page: 'explore' }, 'root')}
          onFollowing={() => spaceGo({ page: 'following' }, 'root')}
          onOpenSpace={(owner) => spaceGo({ page: 'space', owner }, 'root')}
          people={spacePeople(true)}
        />
      ) : railView === 'market' ? (
        <MarketPanel
          tab={marketTab}
          onTab={(t) => {
            setMarketTab(t);
            setListingId(null);
            setListingForm(null);
            setMobileView('chat');
          }}
          query={market.query}
          onQuery={(q) => {
            setListingId(null);
            setListingForm(null);
            market.setQuery(q);
          }}
          counts={market.counts}
          savedCount={market.saved.length}
          sellingCount={market.mine.length}
          onSell={() => {
            setListingForm({});
            setMobileView('chat');
          }}
        />
      ) : railView === 'events' && principal ? (
        <EventsPanel
          events={real.events}
          me={principal}
          selectedId={eventForm ? null : eventId}
          onSelect={(id) => {
            setEventId(id);
            setEventForm(null);
            setMobileView('chat');
          }}
          onNew={(day) => {
            setEventForm({ day });
            setMobileView('chat');
          }}
        />
      ) : railView === 'news' && principal ? (
        <NewsPanel
          section={newsSection}
          onSection={(s) => {
            setNewsSection(s);
            setNewsItem(null);
            setMobileView('list');
          }}
        >
          {newsColumn('is-inline')}
        </NewsPanel>
      ) : railView === 'contacts' && principal ? (
        <ContactsPanel
          myAccount={principal}
          contacts={real.addressBook}
          blocked={real.blockedContacts}
          ready={real.ready}
          status={<MessagingStatus ready={real.ready} available={real.available} error={real.startError} onRetry={real.retryStart} />}
          profiles={real.profiles}
          prefillId={inviteId ?? undefined}
          isActive={real.isActive}
          lastChatAt={(account) => real.messages(account).at(-1)?.sentAt}
          onAdd={async (account, name) => {
            await real.addContact(account, name);
            setInviteId(null);
          }}
          onOpen={(account) => {
            setRailView('chats');
            openChat(`real:${account}`);
          }}
          onProfile={(account) => {
            setRailView('chats');
            openChat(`real:${account}`);
            setMyProfileOpen(false);
            setProfileOpen(true);
          }}
          onAccept={(account) => real.accept(account)}
          onRename={(account, name) => real.setNickname(account, name)}
          onFavorite={(account, favorite) => real.updateChat(account, { favorite })}
          onRemove={(account) =>
            setConfirm({ item: { id: `real:${account}`, name: real.contact(account)?.name ?? account }, action: 'remove' })
          }
          onBlock={(account) =>
            setConfirm({ item: { id: `real:${account}`, name: real.contact(account)?.name ?? account }, action: 'block' })
          }
          onUnblock={(account) => real.unblock(account)}
          groups={real.groups.map((g) => {
            const key = `g:${g.state.id}`;
            const c = real.contact(key);
            return {
              key,
              name: g.state.name,
              photo: g.state.photo || undefined,
              members: g.state.members.length,
              left: g.left,
              request: !!c && !c.known,
            };
          })}
          onNewGroup={() => setNewGroupOpen(true)}
        />
      ) : (
      <section className="chat-list" aria-label="Chats">
        <div className="chat-list-header">
          <h2>Chats</h2>
          <button
            type="button"
            className="plus-btn"
            disabled={!real.ready}
            title={!real.ready ? 'Starting secure messaging…' : newChatOpen ? 'Close' : 'New chat'}
            aria-label={real.ready ? 'New chat' : 'New chat (not available yet)'}
            aria-expanded={newChatOpen}
            onClick={() => {
              setNewChatOpen((o) => !o);
              setNewChatError(null);
            }}
          >
            <PlusIcon />
          </button>
        </div>
        <MessagingStatus ready={real.ready} available={real.available} error={real.startError} onRetry={real.retryStart} />
        {newChatOpen && principal && (
          // Closed with the × at the top (the + while open) or Escape.
          <form
            className="new-chat"
            onSubmit={startNewChat}
            aria-label="Start a new chat"
            onKeyDown={(e) => e.key === 'Escape' && setNewChatOpen(false)}
          >
            {real.profiles && (
              <PeopleSearch
                profiles={real.profiles}
                myAccount={principal}
                isContact={(a) => !!real.contact(a)?.known}
                onAdd={async (r) => {
                  await real.addContact(r.account, r.displayName);
                  setNewChatOpen(false);
                  openChat(`real:${r.account}`);
                }}
              />
            )}
            <p className="settings-note">Or add someone by their OpenSocial ID:</p>
            <label className="field">
              <span>Their OpenSocial ID</span>
              <input
                value={newChatId}
                onChange={(e) => setNewChatId(e.target.value)}
                placeholder="xxxxx-xxxxx-…-xxx"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="field">
              <span>Nickname (optional, only you see it)</span>
              <input
                value={newChatName}
                onChange={(e) => setNewChatName(e.target.value)}
                placeholder="e.g. Alice from work"
              />
            </label>
            {newChatError && (
              <p className="result bad" role="alert">
                {newChatError}
              </p>
            )}
            <div className="settings-actions">
              <button type="submit" className="pill-btn" disabled={newChatBusy || !newChatId.trim()}>
                {newChatBusy ? 'Checking…' : 'Start chat'}
              </button>
              <button
                type="button"
                className="ghost-pill"
                onClick={() => {
                  setNewChatOpen(false);
                  setNewGroupOpen(true);
                }}
              >
                <GroupIcon /> New group
              </button>
            </div>
          </form>
        )}
        <label className="search-box">
          <SearchIcon />
          <span className="sr-only">Search conversations</span>
          <input
            type="search"
            placeholder="Search conversations..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="filters" role="group" aria-label="Filter chats">
          {(
            [
              ['all', 'All'],
              ['unread', 'Unread'],
              ['groups', 'Groups'],
              ['favorites', 'Favorites'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`filter ${filter === id ? 'active' : ''}`}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              {id === 'unread' && totalUnread > 0 && <span className="count">{totalUnread}</span>}
            </button>
          ))}
        </div>
        {recoveryMissing && (
          <div className="recovery-nudge" role="note">
            <p>
              Recovery isn’t set up. If you lose this device, you can’t get your chats back.
            </p>
            <button type="button" className="link-btn" onClick={() => openSettings('account')}>
              Set up in Settings
            </button>
          </div>
        )}
        <ul className="conversations">
          {(showArchived || archivedCount > 0) && !query.trim() && (
            <li>
              <button
                type="button"
                className="convo archived-row"
                onClick={() => {
                  setShowArchived((v) => !v);
                  setChatMenu(null);
                }}
              >
                {showArchived ? <BackIcon /> : <ArchiveIcon />}
                <span className="archived-label">{showArchived ? 'Back to chats' : 'Archived'}</span>
                {!showArchived && <span className="archived-count">{archivedCount}</span>}
              </button>
            </li>
          )}
          {filter === 'groups' && visibleContacts.length === 0 && !query.trim() && (
            <li className="list-empty groups-empty">
              <p>No group chats yet.</p>
              <button type="button" className="pill-btn" disabled={!real.ready} onClick={() => setNewGroupOpen(true)}>
                New group
              </button>
            </li>
          )}
          {visibleContacts.map((c) => {
            const count = c.unread;
            const menuOpen = chatMenu?.id === c.id;
            return (
              <li key={c.id} className={`convo-row ${menuOpen ? 'menu-open' : ''}`}>
                <button
                  type="button"
                  className={`convo ${c.id === activeId ? 'active' : ''}`}
                  aria-current={c.id === activeId ? 'true' : undefined}
                  onClick={() => openChat(c.id)}
                >
                  <Avatar name={c.name} className="avatar-40" src={c.avatar} seed={c.id.replace(/^real:/, '')} />
                  <span className="convo-info">
                    <span className="convo-top">
                      <span className="convo-name">
                        <span className="name-text">{c.name}</span>
                        {!c.group && <LevelBadge size={14} />}
                      </span>
                      {c.lastAt && <span className="convo-time">{timeOf(c.lastAt)}</span>}
                    </span>
                    <span className="convo-preview">
                      {c.request && <span className="request-tag">{c.group ? 'Invitation' : 'Request'}</span>}
                      {c.preview}
                    </span>
                  </span>
                  <span className="convo-marks">
                    {c.muted && <BellOffIcon aria-label="Muted" role="img" aria-hidden={false} />}
                    {c.pinned && <PinIcon aria-label="Pinned" role="img" aria-hidden={false} />}
                    {count > 0 ? (
                      <span className={`unread ${c.muted ? 'muted' : ''}`} aria-label={`${count} unread`}>
                        {count}
                      </span>
                    ) : (
                      c.markedUnread && <span className="unread unread-dot" aria-label="Marked as unread" />
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="convo-more"
                  aria-label={`Options for ${c.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={(e) => setChatMenu(menuOpen ? null : { id: c.id, anchor: e.currentTarget })}
                >
                  <ChevronDownIcon />
                </button>
                {menuOpen && (
                  <ChatMenu
                    anchor={chatMenu.anchor}
                    state={{
                      archived: !!c.archived,
                      pinned: !!c.pinned,
                      muted: !!c.muted,
                      favorite: !!c.favorite,
                      unread: count > 0 || !!c.markedUnread,
                      self: !!c.self,
                    }}
                    onAction={(action) => void chatAction(c, action)}
                    onClose={() => setChatMenu(null)}
                  />
                )}
              </li>
            );
          })}
          {visibleContacts.length === 0 && (
            <li className="list-empty">{emptyListText[filter]}</li>
          )}
        </ul>
      </section>
      )}

      {real.call && (
        <CallScreen
          call={real.call}
          name={real.contact(real.call.account)?.name ?? real.call.account}
          avatar={real.contact(real.call.account)?.profile?.avatar || undefined}
          onAccept={real.acceptCall}
          onHangUp={real.hangUp}
          onToggleMute={real.toggleMute}
          onToggleCamera={real.toggleCamera}
        />
      )}
      {!real.call && real.callNotice && (
        <div className="call-notice" role="status">
          {real.callNotice}
          <button type="button" className="tray-remove" aria-label="Dismiss" onClick={real.dismissCallNotice}>
            <CloseIcon />
          </button>
        </div>
      )}

      {newGroupOpen && (
        <NewGroupDialog
          friends={pickFriends}
          onCancel={() => setNewGroupOpen(false)}
          onCreate={async (input) => {
            const key = await real.createGroup(input);
            setNewGroupOpen(false);
            setRailView('chats');
            openChat(`real:${key}`);
          }}
        />
      )}
      {msgConfirm && realAccount && (
        <ConfirmDialog
          title={msgConfirm.everyone ? 'Delete for everyone?' : 'Delete for you?'}
          body={
            msgConfirm.everyone
              ? `The message and its file are deleted from your devices and from ${active.name}’s, who sees that it was deleted. A screenshot or a file they saved outside OpenSocial can’t be removed.`
              : `The message and its file are deleted from this device. ${active.name} still has it.`
          }
          confirmLabel={msgConfirm.everyone ? 'Delete for everyone' : 'Delete for me'}
          danger
          onConfirm={() => {
            const { id, everyone } = msgConfirm;
            setMsgConfirm(null);
            setSendError(null);
            void (everyone ? real.deleteForEveryone(realAccount, id) : real.deleteForMe(realAccount, id)).catch((e) =>
              setSendError(friendlyNetworkError(e)),
            );
          }}
          onCancel={() => setMsgConfirm(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm.action === 'remove'
              ? `Remove ${confirm.item.name} from contacts?`
              : confirm.action === 'block'
              ? `Block ${confirm.item.name}?`
              : confirm.action === 'clear'
                ? `Clear this chat?`
                : `Delete chat with ${confirm.item.name}?`
          }
          body={
            confirm.action === 'remove'
              ? 'They and your chat with them are deleted from this device. If they write to you again, they appear as a new request.'
              : confirm.action === 'block'
              ? 'They won’t be able to message you, and their messages won’t reach you. You can unblock them later.'
              : confirm.action === 'clear'
                ? 'All messages and files in this chat are deleted from this device. The chat stays in your list.'
                : 'All messages and files in this chat are deleted from this device, and the chat leaves your list. It comes back if they write again.'
          }
          confirmLabel={
            confirm.action === 'remove'
              ? 'Remove'
              : confirm.action === 'block'
                ? 'Block'
                : confirm.action === 'clear'
                  ? 'Clear chat'
                  : 'Delete chat'
          }
          danger={confirm.action !== 'clear'}
          onConfirm={() => void confirmed()}
          onCancel={() => setConfirm(null)}
        />
      )}

      {reminders.due && (
        <div className="ev-toast" role="alert">
          <span className="ev-toast-text">
            <strong>{reminders.due.title}</strong>
            <span>{eventWhen(reminders.due)}</span>
          </span>
          <button
            type="button"
            className="ev-btn is-primary"
            onClick={() => {
              openEvent(reminders.due!.id);
              reminders.dismiss();
            }}
          >
            Open
          </button>
          <button type="button" className="ev-toast-close" aria-label="Dismiss reminder" onClick={reminders.dismiss}>
            ×
          </button>
        </div>
      )}

      {/* Main chat */}
      {needsOnboarding && principal ? (
        <Onboarding principal={principal} onComplete={completeOnboarding} />
      ) : keyFlow && principal ? (
        <Onboarding
          principal={principal}
          mode="key"
          onComplete={saveNewKey}
          onCancel={() => setKeyFlow(false)}
        />
      ) : railView === 'space' && spaceNav.page === 'edit' && principal ? (
        <ItemEditor
          key={spaceNav.id ?? `new-${spaceNav.kind ?? ''}-${spaceStack.length}`}
          item={spaceNav.id ? space.items[spaceNav.id] : undefined}
          kind={spaceNav.kind}
          image={space.image}
          onUpload={(file, mime, onProgress, signal) => space.client.upload(file, mime, onProgress, signal)}
          fetchPreview={real.fetchLinkPreview}
          fetchPreviewImage={real.fetchPreviewImage}
          onCancel={spaceBack}
          onSave={async (input) => {
            const id = spaceNav.id ?? (await space.client.create(input));
            if (spaceNav.id) await space.client.update(id, input);
            await space.loadItem(id);
            void space.loadSpace(principal);
            spaceGo({ page: 'item', id }, 'replace');
          }}
        />
      ) : railView === 'space' && spaceNav.page === 'settings' && principal ? (
        space.spaces[principal] ? (
          <SpaceSettingsForm
            info={space.spaces[principal]!}
            onCancel={spaceBack}
            onSave={async (st) => {
              await space.client.setSettings(st);
              await space.loadSpace(principal);
              spaceBack();
            }}
          />
        ) : (
          <main className="chat-main mk-main" aria-label="Edit space">
            <div className="mk-empty">
              <p>Loading…</p>
            </div>
          </main>
        )
      ) : railView === 'space' && spaceNav.page === 'item' ? (
        (() => {
          const it = space.items[spaceNav.id];
          const info = it ? space.spaces[it.owner] : undefined;
          return (
            <ItemDetail
              item={it ?? (spaceItemMissing ? null : undefined)}
              me={principal}
              owner={it ? space.person(it.owner) : { name: '' }}
              client={space.client}
              image={space.image}
              liked={!!it && space.liked.has(it.id)}
              likes={it ? space.likeCount(it) : 0}
              pinned={!!it && info?.pinned === it.id}
              onBack={spaceBack}
              onOpenOwner={() => it && spaceGo({ page: 'space', owner: it.owner })}
              onLike={() => (it ? space.toggleLike(it) : Promise.resolve())}
              onMessage={() =>
                it &&
                messageAccount(
                  it.owner,
                  space.person(it.owner).name,
                  `About “${it.title || 'your post'}” in your space:\n${spaceLink(it.owner, it.id, location.origin)}`,
                )
              }
              onEdit={() => it && spaceGo({ page: 'edit', id: it.id })}
              onPin={async (pin) => {
                if (!it || !principal) return;
                const cur = space.spaces[principal] ?? (await space.loadSpace(principal));
                if (!cur) return;
                await space.client.setSettings({ ...cur, pinned: pin ? it.id : null });
                await space.loadSpace(principal);
              }}
              onDelete={async () => {
                if (!it) return;
                await space.client.remove(it.id);
                space.forget(it.id);
                void space.loadSpace(it.owner);
                spaceBack();
              }}
              onReport={(reason) => (it ? space.client.report(it.id, reason) : Promise.resolve())}
            />
          );
        })()
      ) : railView === 'space' && (spaceNav.page === 'explore' || spaceNav.page === 'following') ? (
        <SpaceFeed
          mode={spaceNav.page}
          me={principal}
          space={space}
          onOpenItem={(id) => spaceGo({ page: 'item', id })}
          onOpenSpace={(owner) => spaceGo({ page: 'space', owner })}
          onBack={() => setMobileView('list')}
        />
      ) : railView === 'space' && spaceNav.page === 'space' ? (
        <SpaceHome
          owner={spaceNav.owner}
          me={principal}
          person={space.person(spaceNav.owner)}
          space={space}
          info={space.spaces[spaceNav.owner]}
          following={space.follows.includes(spaceNav.owner)}
          onFollow={() => space.toggleFollow(spaceNav.owner)}
          onOpenItem={(id) => spaceGo({ page: 'item', id })}
          onAdd={(kind) => spaceGo({ page: 'edit', kind })}
          onEditSpace={() => spaceGo({ page: 'settings' })}
          onMessage={() => messageAccount(spaceNav.owner, space.person(spaceNav.owner).name, '')}
          onBack={() => (spaceStack.length > 1 ? spaceBack() : setMobileView('list'))}
          loadListings={(owner) =>
            market.client.search({ ...EMPTY_QUERY, seller: owner }, 0, 60).then((pg) => pg.items)
          }
          listingPhoto={market.photo}
          onOpenListing={openListing}
        />
      ) : railView === 'market' && listingForm && principal ? (
        <ListingEditor
          key={listingForm.id ?? 'new'}
          listing={listingForm.id ? market.known[listingForm.id] : undefined}
          sellerName={myProfile?.displayName?.trim() || ''}
          location={myProfile?.location?.trim() || ''}
          photo={market.photo}
          onCancel={() => {
            setListingForm(null);
            if (!listingId) setMobileView('list');
          }}
          onSave={async (input) => {
            if (listingForm.id) {
              await market.update(listingForm.id, input);
              setListingId(listingForm.id);
            } else {
              setListingId(await market.create(input));
              setMarketTab('selling');
            }
            setListingMissing(false);
            setListingForm(null);
          }}
        />
      ) : railView === 'market' && listingId ? (
        <ListingDetail
          listing={market.known[listingId] ?? (listingMissing ? null : undefined)}
          me={principal}
          saved={market.saved.includes(listingId)}
          photo={market.photo}
          onBack={() => {
            setListingId(null);
            if (location.hash) history.replaceState(null, '', location.pathname + location.search);
          }}
          onToggleSave={() => market.toggleSave(listingId)}
          onMessage={(l) => {
            void (async () => {
              if (!real.contacts.some((c) => c.account === l.seller)) await real.addContact(l.seller, l.sellerName);
              setRailView('chats');
              openChat(`real:${l.seller}`);
              setDraft(`Hi! Is “${l.title}” still available?\n${listingLink(l.id, location.origin)}`);
            })().catch((e: unknown) => setSendError(e instanceof Error ? e.message : String(e)));
          }}
          onSellerListings={(l) => {
            setListingId(null);
            setMarketTab('browse');
            market.setQuery({ ...EMPTY_QUERY, seller: l.seller });
          }}
          onEdit={() => setListingForm({ id: listingId })}
          onStatus={(st) => market.setStatus(listingId, st)}
          onDelete={async () => {
            await market.remove(listingId);
            setListingId(null);
          }}
          onReport={(reason) => market.report(listingId, reason)}
        />
      ) : railView === 'market' ? (
        <MarketGrid
          tab={marketTab}
          items={marketTab === 'saved' ? market.savedItems : marketTab === 'selling' ? market.mine : market.items}
          total={market.total}
          loading={marketTab === 'browse' && market.loading}
          error={marketTab === 'browse' ? market.error : null}
          hasMore={marketTab === 'browse' && market.nextOffset !== null}
          query={market.query}
          onQuery={market.setQuery}
          onMore={() => void market.loadMore()}
          onRetry={() => void market.retry()}
          onOpen={openListing}
          saved={market.saved}
          onToggleSave={market.toggleSave}
          photo={market.photo}
          me={principal}
          onBack={() => setMobileView('list')}
          onSell={() => {
            if (!principal) return;
            setListingForm({});
          }}
        />
      ) : railView === 'events' && principal && eventForm ? (
        <EventEditor
          key={eventForm.id ?? `new:${eventForm.day ?? ''}`}
          event={eventForm.id ? real.event(eventForm.id) : undefined}
          day={eventForm.day}
          friends={real.contacts
            .filter((c) => c.known && !c.blocked && !c.group && c.account !== principal)
            .map((c) => ({ account: c.account, name: c.name, avatar: c.profile?.avatar || undefined }))}
          reminder={eventForm.id ? real.eventReminder(eventForm.id) : 15}
          onSave={async (input, reminder) => {
            const id = eventForm.id ?? (await real.createEvent(input));
            if (eventForm.id) await real.updateEvent(id, input);
            await real.setEventReminder(id, reminder);
            if (reminder) askNotificationPermission();
            setEventId(id);
            setEventForm(null);
          }}
          onCancel={() => setEventForm(null)}
        />
      ) : railView === 'events' && principal ? (
        <EventDetail
          event={eventId ? real.event(eventId) ?? null : null}
          me={principal}
          people={personOf}
          reminder={eventId ? real.eventReminder(eventId) : 15}
          onReminder={(r) => {
            if (!eventId) return;
            void real.setEventReminder(eventId, r);
            if (r) askNotificationPermission();
          }}
          onRespond={(r) => real.respondEvent(eventId!, r)}
          onEdit={() => setEventForm({ id: eventId! })}
          onCancelEvent={() => real.cancelEvent(eventId!)}
          onDelete={async () => {
            await real.deleteEvent(eventId!);
            setEventId(null);
            setMobileView('list');
          }}
          onOpenChat={(account) => {
            setRailView('chats');
            openChat(`real:${account}`);
          }}
          onBack={() => setMobileView('list')}
          onNew={() => setEventForm({})}
        />
      ) : railView === 'news' && newsSection === 'home' ? (
        <NewsHome
          stories={hashfirst.stories}
          ecosystem={news.items}
          loading={hashfirst.loading}
          loadCover={real.fetchNewsCover}
          onOpen={(item) => {
            setNewsSection((item.section ?? 'ecosystem') as NewsSection);
            setNewsItem(item);
            setMobileView('chat');
          }}
          onSection={(section) => {
            setNewsSection(section);
            setNewsItem(null);
          }}
        />
      ) : railView === 'news' && newsSection === 'price' ? (
        <PriceDetail coin={newsCoin} onBack={() => setMobileView('list')} />
      ) : railView === 'news' && newsSection === 'index' ? (
        <IndexDetail index={newsIndex} onBack={() => setMobileView('list')} />
      ) : railView === 'news' ? (
        <NewsArticle
          item={newsItem}
          chats={real.contacts
            .filter((c) => !c.blocked)
            .map((c) => ({ account: c.account, name: c.name, avatar: c.profile?.avatar || undefined }))}
          loadBody={real.fetchNewsArticle}
          loadCover={real.fetchNewsCover}
          onBack={() => setMobileView('list')}
          onShare={(account, item) => {
            setRailView('chats');
            openChat(`real:${account}`);
            setDraft(`${item.title}\n${item.url}`);
          }}
        />
      ) : !realAccount ? (
        <main className="chat-main chat-empty" aria-label="No chat open">
          <div className="chat-empty-inner">
            <ChatsIcon />
            <h2>{real.contacts.length ? 'Choose a chat' : 'No chats yet'}</h2>
            <p>
              {real.contacts.length
                ? 'Pick a conversation on the left, or start a new one.'
                : 'Start a chat with someone’s OpenSocial ID, or find people who made their profile public.'}
            </p>
            <button type="button" className="pill-btn" onClick={() => setNewChatOpen(true)} disabled={!real.ready}>
              New chat
            </button>
          </div>
        </main>
      ) : (
      <main
        className={`chat-main ${dragging ? 'dragging' : ''}`}
        aria-label={`Conversation with ${active.name}`}
        style={isSelf ? undefined : chatThemeStyle(realContact?.chatTheme)}
        data-text-size={(!isSelf && realContact?.textSize) || undefined}
        data-tone={!isSelf && chatTheme(realContact?.chatTheme).dark ? 'dark' : undefined}
        onTouchStart={swipeStart}
        onTouchMove={(e) => {
          if (phone && !railDrawer && horizontalSwipe(e) < 0) setRailDrawer(true);
        }}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          setSendError(null);
          stage(Array.from(e.dataTransfer.files));
        }}
      >
        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            Drop files to add them
          </div>
        )}
        <header className="chat-header">
          <button
            type="button"
            className="hdr-btn back"
            onClick={() => setMobileView('list')}
            aria-label="Back to chats"
          >
            <BackIcon />
          </button>
          <Avatar
            name={active.name}
            className="avatar-40"
            src={(isSelf ? myProfile?.avatar : realContact?.photo || realContact?.profile?.avatar) || undefined}
            seed={realAccount ?? undefined}
          />
          <div className="info">
            <div className="name">
              <span className="name-text">{active.name}</span>
              {!groupId && <LevelBadge size={15} />}
            </div>
            <div className="status is-real">
              {isSelf
                ? 'Notes to yourself, on this device'
                : groupInfo
                  ? groupInfo.left
                    ? 'You are no longer in this group'
                    : `${memberCount(groupInfo.state.members.length)} · end-to-end encrypted`
                  : real.isDirect(realAccount)
                  ? 'End-to-end encrypted, direct connection'
                  : 'End-to-end encrypted, via ICP mailbox'}
            </div>
            {!isSelf && presence && (
              <div className={`presence is-${presence.tone}`}>
                <span className={`presence-dot is-${presence.tone}`} aria-hidden="true" />
                {presence.text}
              </div>
            )}
          </div>
          {realAccount && !isSelf && (
            <button
              type="button"
              className="hdr-btn hdr-more"
              aria-label="Chat settings"
              aria-haspopup="menu"
              aria-expanded={!!settingsAnchor}
              onClick={(e) => setSettingsAnchor(settingsAnchor ? null : e.currentTarget)}
            >
              <MoreVerticalIcon />
            </button>
          )}
          {realAccount && !isSelf && settingsAnchor && (
            <ChatSettingsMenu
              anchor={settingsAnchor}
              theme={realContact?.chatTheme}
              textSize={realContact?.textSize ?? 'default'}
              onTheme={(id) => updateLook({ chatTheme: id === 'default' ? null : id })}
              onTextSize={(size) => updateLook({ textSize: size })}
              onInfo={() => {
                setMyProfileOpen(false);
                setSettingsOpen(false);
                setProfileOpen(true);
                setRightView('profile');
              }}
              onClose={() => setSettingsAnchor(null)}
            />
          )}
        </header>

        <div
          className="messages-wrap"
          // A finger dragging down shows the round actions button; dragging up hides it
          // (also in a chat too short to scroll).
          onTouchStart={(e) => (touchY.current = e.touches[0]?.clientY ?? null)}
          onTouchMove={(e) => {
            const y = e.touches[0]?.clientY;
            if (touchY.current === null || y === undefined) return;
            if (y - touchY.current > 24) setToolbarShown(true);
            else if (touchY.current - y > 24) setToolbarShown(false);
            else return;
            touchY.current = y;
          }}
          onMouseMove={(e) => {
            const near = e.clientY - e.currentTarget.getBoundingClientRect().top < 72;
            if (near !== nearTop.current) {
              nearTop.current = near;
              if (near) setToolbarShown(true);
            }
          }}
          onMouseLeave={() => (nearTop.current = false)}
        >
        <ChatToolbar
          compact={phone}
          hidden={!toolbarShown}
          shared={{
            open: profileOpen && rightView === 'shared',
            onToggle: () => {
              if (profileOpen && rightView === 'shared') {
                setProfileOpen(false);
              } else {
                setMyProfileOpen(false);
                setSettingsOpen(false);
                setProfileOpen(true);
                setRightView('shared');
              }
            },
          }}
          info={{
            open: profileOpen && rightView === 'profile',
            onToggle: () => {
              if (profileOpen && rightView === 'profile') {
                setProfileOpen(false);
              } else {
                setMyProfileOpen(false);
                setSettingsOpen(false);
                setProfileOpen(true);
                setRightView('profile');
              }
            },
          }}
          more={
            realAccount && !isSelf
              ? {
                  state: {
                    favorite: !!realContact?.favorite,
                    muted: real.isMuted(realAccount),
                    translateTo,
                    canTranslate,
                    look: phone
                      ? undefined
                      : { theme: realContact?.chatTheme, textSize: realContact?.textSize ?? 'default' },
                  },
                  onAction: (a) => {
                    setSendError(null);
                    if ('chatTheme' in a) return updateLook({ chatTheme: a.chatTheme === 'default' ? null : a.chatTheme });
                    if ('textSize' in a) return updateLook({ textSize: a.textSize });
                    if ('translateTo' in a && a.translateTo) translation.warmUp();
                    const patch =
                      'favorite' in a
                        ? { favorite: a.favorite }
                        : 'mute' in a
                          ? { muteFor: a.mute }
                          : 'unmute' in a
                            ? { muteFor: 0 }
                            : { translateTo: a.translateTo };
                    void real
                      .updateChat(realAccount, patch)
                      .catch((err) => setSendError(friendlyNetworkError(err)));
                  },
                }
              : undefined
          }
          onExpand={!profileOpen && !myProfileOpen && !settingsOpen ? () => setProfileOpen(true) : undefined}
          onCall={!isSelf && !groupId && real.canCall && realContact?.known && !real.call ? (kind) => void call(kind) : undefined}
          highlights={{
            count: highlighted.length,
            open: profileOpen && rightView === 'highlights',
            onToggle: () => {
              if (profileOpen && rightView === 'highlights') {
                setRightView('profile');
              } else {
                setMyProfileOpen(false);
                setSettingsOpen(false);
                setProfileOpen(true);
                setRightView('highlights');
              }
            },
          }}
          search={{
            open: searchOpen,
            query: searchQuery,
            count: matches.length,
            index: matchIndex,
            onOpen: () => setSearchOpen(true),
            onClose: () => {
              setSearchOpen(false);
              setSearchQuery('');
            },
            onQuery: (q) => {
              setSearchQuery(q);
              setMatchIndex(0);
            },
            onPrev: () => setMatchIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0)),
            onNext: () => setMatchIndex((i) => (matches.length ? (i + 1) % matches.length : 0)),
          }}
        />
        {translateTo && canTranslate && <TranslationBar translation={translation} target={translateTo} />}
        <div
          className="messages"
          aria-live="polite"
          ref={messagesBox}
          onScroll={onMessagesScroll}
          onWheel={userScrolls}
          onTouchMove={userScrolls}
          onKeyDown={userScrolls}
          onPointerDown={userScrolls}
        >
          <p className="proto-note">
            <LockIcon />{' '}
            {isSelf
              ? 'Notes to yourself: text and files you keep here stay encrypted on this device only.'
              : 'Messages are encrypted on your devices and wait in an ICP mailbox until delivered. Prototype encryption, not yet audited.'}{' '}
            <button type="button" className="link-btn" onClick={showAbout}>
              Details
            </button>
          </p>
          {realContact && !realContact.known && groupId && (
            <div className="request-banner" role="region" aria-label="Group invitation">
              <p>
                Someone who isn’t in your contacts added you to <strong>{realContact.name}</strong>. Join to show it
                with your chats, or leave the group.
              </p>
              <div className="settings-actions">
                <button type="button" className="pill-btn" onClick={() => void real.accept(realContact.account)}>
                  Join
                </button>
                <button
                  type="button"
                  className="link-btn danger"
                  onClick={() => {
                    void real.deleteGroup(groupId).catch((err) => setSendError(friendlyNetworkError(err)));
                    setActiveId(null);
                  }}
                >
                  Leave group
                </button>
              </div>
            </div>
          )}
          {realContact && !realContact.known && !groupId && (
            <div className="request-banner" role="region" aria-label="Message request">
              <p>
                <strong>{realContact.name}</strong> isn’t in your contacts yet. Accept to chat and
                share your profile with them, or block them.
              </p>
              <div className="settings-actions">
                <button type="button" className="pill-btn" onClick={() => void real.accept(realContact.account)}>
                  Accept
                </button>
                <button
                  type="button"
                  className="link-btn danger"
                  onClick={() => {
                    void real.block(realContact.account);
                    setActiveId(null);
                  }}
                >
                  Block
                </button>
              </div>
            </div>
          )}
          {messages.map((m, i) => [
            isNewDay(messages[i - 1]?.sentAt, m.sentAt) && (
              <div key={`day-${m.id}`} className="day-divider" role="separator">
                <span>{dayLabel(m.sentAt)}</span>
              </div>
            ),
            m.notice ? (
              <div key={m.id} className="call-log group-notice" role="note">
                <span className="call-log-pill">{noticeText(m.notice, memberName)}</span>
              </div>
            ) : m.call ? (
              <div key={m.id} className={`call-log ${m.call.outcome === 'missed' ? 'missed' : ''}`} role="note">
                <span className="call-log-pill">
                  {m.call.kind === 'video' ? <VideoIcon /> : <PhoneIcon />}
                  {callText(m.call, m.direction)}
                  <time dateTime={new Date(m.sentAt).toISOString()}>{timeOf(m.sentAt)}</time>
                </span>
              </div>
            ) : (
            <div
              key={m.id}
              data-mid={m.id}
              className={`message ${m.direction} ${currentMatch === m.id ? 'search-current' : ''} ${flashId === m.id ? 'flash' : ''}`}
            >
              <Avatar
                name={m.direction === 'out' ? myProfile?.displayName || 'You' : m.from ? memberName(m.from) : active.name}
                className="msg-avatar"
                seed={(m.direction === 'out' ? principal : m.from ?? realAccount) ?? undefined}
                src={
                  m.direction === 'out'
                    ? myProfile?.avatar || undefined
                    : m.from
                      ? memberAvatar(m.from)
                      : realContact?.profile?.avatar || undefined
                }
              />
              <div
                className={`bubble ${m.attachment ? 'has-attachment' : ''} ${m.attachment?.voice ? 'has-voice' : ''} ${m.deleted ? 'is-deleted' : ''} ${msgMenu?.id === m.id ? 'menu-open' : ''}`}
                // Phones: no ▾ button; tapping the message opens its options
                // (except taps on its links, buttons and players).
                onClick={(e) => {
                  if (!phone || (e.target as HTMLElement).closest('a, button, input, audio, video, [role="slider"]')) return;
                  setMsgMenu(msgMenu?.id === m.id ? null : { id: m.id, anchor: e.currentTarget });
                }}
              >
                {msgMenu?.id === m.id && (
                  <PopoverMenu
                    label="Message options"
                    anchor={msgMenu.anchor}
                    onClose={() => setMsgMenu(null)}
                    header={
                      canRespond(m) ? (
                        <ReactionRow
                          recent={recentReactions}
                          mine={m.reactions?.me}
                          onToggle={(emoji, on) => {
                            setMsgMenu(null);
                            react(m, emoji, on);
                          }}
                          onMore={() => {
                            // The menu closes; the panel opens by what opened the menu.
                            setReactAll({ id: m.id, anchor: msgMenu.anchor });
                            setMsgMenu(null);
                          }}
                        />
                      ) : undefined
                    }
                    items={[
                      ...(canRespond(m) ? [{ label: 'Reply', icon: <ReplyIcon />, onSelect: () => startReply(m) }] : []),
                      ...(canEdit(m) ? [{ label: 'Edit', icon: <EditIcon />, onSelect: () => startEdit(m) }] : []),
                      ...(m.body && !m.deleted
                        ? [{ label: 'Copy text', icon: <CopyIcon />, onSelect: () => void navigator.clipboard?.writeText(m.body) }]
                        : []),
                      ...(!m.deleted
                        ? [
                            {
                              label: m.highlightedAt ? 'Remove highlight' : 'Highlight',
                              icon: <StarIcon />,
                              onSelect: () => void highlightMessage(m.id, !m.highlightedAt),
                            },
                          ]
                        : []),
                      { label: 'Delete for me', icon: <TrashIcon />, onSelect: () => setMsgConfirm({ id: m.id, everyone: false }) },
                      ...(m.direction === 'out' && !m.deleted && !isSelf
                        ? [
                            {
                              label: 'Delete for everyone',
                              icon: <TrashIcon />,
                              danger: true,
                              onSelect: () => setMsgConfirm({ id: m.id, everyone: true }),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
                {m.from && m.direction === 'in' && (
                  <span className="bubble-author" style={{ color: authorColor(m.from) }}>
                    {memberName(m.from)}
                  </span>
                )}
                {m.replyTo && (() => {
                  const ref = m.replyTo.ref;
                  const target = messages.find((x) => messageRef(x) === ref);
                  return (
                    <button
                      type="button"
                      className={`bubble-quote${m.replyTo.mine ? ' is-mine' : ''}`}
                      onClick={() => target && jumpTo(target.id)}
                    >
                      <span className="bubble-quote-body">
                        <span className="bubble-quote-name">
                          <Avatar
                            name={m.replyTo.mine ? myProfile?.displayName || 'You' : quoteAuthor(m.replyTo)}
                            className="bubble-quote-avatar"
                            seed={(m.replyTo.mine ? principal : m.replyTo.author ?? realAccount) ?? undefined}
                            src={
                              (m.replyTo.mine
                                ? myProfile?.avatar
                                : m.replyTo.author
                                  ? memberAvatar(m.replyTo.author)
                                  : realContact?.profile?.avatar) || undefined
                            }
                          />
                          {m.replyTo.mine ? myProfile?.displayName || 'You' : quoteAuthor(m.replyTo)}
                        </span>
                        <span className="bubble-quote-text">
                          {m.replyTo.deleted ? 'Deleted message' : m.replyTo.text}
                        </span>
                      </span>
                      {!m.replyTo.deleted && <QuoteMedia a={target?.attachment} className="bubble-quote-media" />}
                    </button>
                  );
                })()}
                {m.deleted && (
                  <p className="bubble-deleted">
                    <BlockIcon />
                    {m.direction === 'out' ? 'You deleted this message' : 'This message was deleted'}
                  </p>
                )}
                {m.attachment && renderAttachment(m, realAccount)}
                {m.eventId && !m.deleted && principal && (
                  <EventCard
                    event={real.event(m.eventId)}
                    me={principal}
                    onRespond={(r) => void real.respondEvent(m.eventId!, r)}
                    onOpen={() => openEvent(m.eventId!)}
                  />
                )}
                {m.linkPreview && !m.deleted && <LinkPreviewCard preview={m.linkPreview} />}
                {m.body && <MessageText m={m} translation={translation} search={searchOpen ? searchQuery : ''} />}
                <div className="time">
                  {m.highlightedAt && (
                    <StarIcon className="msg-star" role="img" aria-hidden={false} aria-label="Highlighted" />
                  )}
                  {m.edited && <span className="msg-edited">edited</span>}
                  <time dateTime={new Date(m.sentAt).toISOString()}>{timeOf(m.sentAt)}</time>
                  <StatusMark
                    m={m}
                    showRead={real.readReceipts}
                    onRetry={
                      m.direction === 'out' &&
                      m.status === 'failed' &&
                      (!m.attachment || real.canRetry(m.attachment.fileId))
                        ? () => {
                            setSendError(null);
                            void real
                              .retryMessage(realAccount, m.id)
                              .catch((err) => setSendError(friendlyNetworkError(err)));
                          }
                        : undefined
                    }
                  />
                </div>
                {m.reactions && (
                  <ReactionBadge
                    reactions={m.reactions}
                    theirName={groupId ? reactorNames(m) : active.name}
                    onToggle={(emoji, on) => react(m, emoji, on)}
                  />
                )}
              </div>
              {/* Computers: react, reply and ⋮ options beside the message, on hover. */}
              <div
                className={`msg-actions${reactingTo === m.id || msgMenu?.id === m.id || reactAll?.id === m.id ? ' is-open' : ''}`}
              >
                {canRespond(m) && (
                  <>
                    <button
                      type="button"
                      className="msg-action"
                      aria-label="React"
                      title="React"
                      aria-expanded={reactingTo === m.id}
                      onClick={() => setReactingTo(reactingTo === m.id ? null : m.id)}
                    >
                      <SmileIcon />
                    </button>
                    <button type="button" className="msg-action" aria-label="Reply" title="Reply" onClick={() => startReply(m)}>
                      <ReplyIcon />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="msg-action"
                  aria-label="Message options"
                  title="More"
                  aria-haspopup="menu"
                  aria-expanded={msgMenu?.id === m.id}
                  onClick={(e) => setMsgMenu(msgMenu?.id === m.id ? null : { id: m.id, anchor: e.currentTarget })}
                >
                  <MoreVerticalIcon />
                </button>
                {reactingTo === m.id && (
                  <ReactionPicker
                    recent={recentReactions}
                    mine={m.reactions?.me}
                    onToggle={(emoji, on) => react(m, emoji, on)}
                    onMore={(button) => {
                      const actions = button.closest<HTMLElement>('.msg-actions');
                      if (actions) setReactAll({ id: m.id, anchor: actions });
                    }}
                    onClose={() => setReactingTo(null)}
                  />
                )}
                {reactAll?.id === m.id && (
                  <ReactionEmojiPanel
                    anchor={reactAll.anchor}
                    recent={recentReactions}
                    mine={m.reactions?.me}
                    onToggle={(emoji, on) => react(m, emoji, on)}
                    onClose={() => setReactAll(null)}
                  />
                )}
              </div>
            </div>
            ),
          ])}
          <div ref={endRef} />
        </div>
        {(awayFromBottom || newBelow > 0) && (
          <button
            type="button"
            className="to-latest"
            onClick={() => scrollToBottom()}
            aria-label={newBelow ? `${newBelow} new message${newBelow === 1 ? '' : 's'}, go to latest` : 'Go to latest message'}
            title="Latest messages"
          >
            <ChevronDownIcon />
            {newBelow > 0 && <span className="to-latest-count">{newBelow > 99 ? '99+' : newBelow}</span>}
          </button>
        )}
        </div>

        {/* Hidden (not removed) while searching the chat, so a draft or recording is kept. */}
        {groupLocked && groupInfo && (
          <p className="group-locked" role="status">
            {groupInfo.left ? 'You are no longer in this group.' : 'Only admins can send messages in this group.'}
          </p>
        )}
        <form className="composer" onSubmit={submit} hidden={searchOpen || groupLocked}>
          {(sendError ?? real.error) && (
            <p className="result bad" role="alert">
              {sendError ?? real.error}
            </p>
          )}
          {editing && !recording && (
            <div className="reply-bar is-editing" role="status">
              <span className="reply-bar-icon" aria-hidden="true">
                <EditIcon />
              </span>
              <span className="reply-bar-text">
                <span className="reply-bar-name">Editing message</span>
                <span className="reply-bar-quote">{editing.body}</span>
              </span>
              <button type="button" className="reply-bar-close" aria-label="Cancel editing" onClick={cancelEdit}>
                <CloseIcon />
              </button>
            </div>
          )}
          {replyTo && !recording && (
            <div className="reply-bar" role="status">
              <span className="reply-bar-icon" aria-hidden="true">
                <ReplyIcon />
              </span>
              <span className="reply-bar-text">
                <span className="reply-bar-name">
                  Replying to {replyTo.direction === 'out' ? myProfile?.displayName || 'yourself' : active.name}
                </span>
                <span className="reply-bar-quote">{quoteOf(replyTo)}</span>
              </span>
              <QuoteMedia a={replyTo.attachment} className="reply-bar-media" />
              <button type="button" className="reply-bar-close" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                <CloseIcon />
              </button>
            </div>
          )}
          {linkDraft.shown && !recording && (
            <LinkPreviewBar url={linkDraft.shown.url} preview={linkDraft.shown.preview} onRemove={linkDraft.dismiss} />
          )}
          {staged.length > 0 && !recording && (
            <AttachmentTray
              files={staged}
              onRemove={(id) => setStaged((s) => s.filter((f) => f.id !== id))}
              onAddMore={() => fileInput.current?.click()}
              onClear={() => {
                setStaged([]);
                draftInput.current?.focus();
              }}
            />
          )}
          {recording ? (
            <div className="composer-inner">
              <VoiceRecorderBar
                onCancel={() => setRecording(false)}
                onError={(msg) => {
                  setRecording(false);
                  setSendError(msg);
                }}
                onSend={async (r) => {
                  setRecording(false);
                  if (!realAccount) return;
                  const ext = r.mime.includes('mp4') ? 'm4a' : r.mime.includes('ogg') ? 'ogg' : 'webm';
                  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                  try {
                    await real.sendFile(
                      realAccount,
                      new File([r.blob], `Voice message ${stamp}.${ext}`, { type: r.mime }),
                      null,
                      { voice: { ms: r.ms, wave: r.wave } },
                    );
                  } catch (err) {
                    setSendError(friendlyNetworkError(err));
                  }
                }}
              />
            </div>
          ) : (
          <div className="composer-inner">
            {/* Left: attach files, stickers and emoji. */}
            <button
              type="button"
              className="ghost-btn composer-tool composer-plus"
              aria-label="Attach files"
              title="Send photos, videos or any file (end-to-end encrypted)"
              onClick={() => fileInput.current?.click()}
            >
              <PlusIcon />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="sr-only"
              aria-label="Files to send"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                setSendError(null);
                stage(files);
              }}
            />
            <button
              type="button"
              ref={emojiButton}
              className="ghost-btn composer-tool"
              aria-label="Emoji, GIFs and stickers"
              aria-expanded={emojiOpen}
              aria-haspopup="dialog"
              title="Emoji, GIFs and stickers"
              onClick={() => setEmojiOpen((o) => !o)}
            >
              <StickerIcon />
            </button>
            {emojiOpen && (
              <EmojiPicker
                recent={recentEmoji}
                onPick={insertEmoji}
                onClose={() => setEmojiOpen(false)}
                anchor={emojiButton.current}
              />
            )}
            <label htmlFor="draft" className="sr-only">
              Message
            </label>
            <input
              id="draft"
              ref={draftInput}
              type="text"
              autoComplete="off"
              placeholder={staged.length ? 'Add a caption…' : 'Type a message...'}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  stage(files);
                }
              }}
              value={draft}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                if (editing) cancelEdit();
                else if (replyTo) setReplyTo(null);
              }}
              onChange={(e) => {
                // First keystroke: start a direct link in the background (bounded per friend and hour).
                if (!draft && e.target.value && realAccount && realAccount !== principal) real.warmTyping(realAccount);
                setDraft(e.target.value);
              }}
            />
            {/* Voice message only while there is nothing typed; typing shows send instead. */}
            {!draft.trim() && staged.length === 0 && (
              <button
                type="button"
                className="ghost-btn composer-tool appear"
                aria-label="Record a voice message"
                title="Voice message"
                disabled={!real.ready || !canRecord}
                onClick={() => {
                  setSendError(null);
                  setRecording(true);
                }}
              >
                <MicIcon />
              </button>
            )}
            <ComposerActions
              hasText={!!draft.trim() || staged.length > 0}
              disabled={!real.ready}
            />
          </div>
          )}
        </form>
      </main>
      )}

      {/* Right panel: Settings (sized to its cards), else the contact profile. */}
      {settingsOpen && principal && !fullPage && (
          <SettingsPage
            principal={principal}
            recovery={recovery}
            onCreateKey={() => setKeyFlow(true)}
            onRemoveKey={removeKey}
            onBack={() => setSettingsOpen(false)}
            emailAdmin={z.emailAdmin}
            tab={settingsTab}
          onTabChange={setSettingsTab}
          rail={{
            prefs: railPrefs,
            onChange: setRailPrefs,
            items: railDefs.map((d) => ({ id: d.id, label: d.label, icon: d.icon, available: !!d.onClick })),
          }}
          profile={{
            value: real.myProfile,
            ready: real.ready,
            fallbackName: `${principal.slice(0, 5)}…${principal.slice(-3)}`,
            seed: principal,
            onSave: real.publishProfile,
            restoring: real.profileRestoring,
            onStartNew: real.startNewProfile,
          }}
          direct={{ enabled: real.directEnabled, onChange: real.setDirectEnabled, available: real.ready }}
          receipts={{ enabled: real.readReceipts, onChange: real.setReadReceipts, available: real.ready }}
            onDeleteAccount={
              real.ready
                ? async () => {
                    await real.deleteAccount(
                      siaClient
                        ? async () => {
                            if (await siaClient.resume()) await siaClient.deleteAll();
                          }
                        : undefined,
                    );
                    window.location.reload();
                  }
                : undefined
            }
            visibility={{
              value: visibility,
              profile: myProfile,
              ready: real.ready,
              onChange: changeVisibility,
              onOpenProfile: openProfileSettings,
            }}
            sia={
              siaClient && real.ready
                ? { client: siaClient, exportChats: real.exportBackup, importChats: real.importBackup }
                : undefined
            }
          />
      )}
      {myProfileOpen && !settingsOpen && principal && z.signedIn && !fullPage && (
        <ProfilePanel
          contactName={myName}
          contactInitial={initial(myName)}
          contactSeed={principal}
          messages={real.messages(principal)}
          myFingerprint={real.myFingerprint ?? undefined}
          accountPrincipal={principal}
          contactFingerprint={undefined}
          realAccount={principal}
          self={{ profile: myProfile, emptyBio: 'No bio yet. Add one in Settings.' }}
          attachments={{
            list: real.messages(principal).flatMap((m) => (m.attachment ? [m.attachment] : [])).reverse(),
            load: real.fileBytes,
            save: (fileId: string, p: (f: number) => void) => real.saveFile(principal, fileId, p),
            openBlob: (fileId: string, p: (f: number) => void) => real.openBlob(principal, fileId, p),
          }}
          section="profile"
          tab={profileTab}
          onTabChange={setProfileTab}
          bar={<PanelBar view="profile" highlightCount={0} onCollapse={() => setMyProfileOpen(false)} overlay />}
        />
      )}
      {railView === 'space' && !fullPage && spacePeople(false)}
      {railView === 'news' && newsSection !== 'home' && principal && !fullPage && (
        <aside className="news-stories-panel" aria-label="Stories">
          {newsColumn()}
        </aside>
      )}
      {railView !== 'news' && railView !== 'events' && railView !== 'market' && railView !== 'space' && !settingsOpen && !myProfileOpen && profileOpen && realAccount && z.signedIn && !fullPage && rightView === 'highlights' && (
        <HighlightsPanel
          me={{ name: myProfile?.displayName || 'You', avatar: myProfile?.avatar || undefined, seed: principal ?? undefined }}
          them={{ name: active.name, avatar: realContact?.profile?.avatar || undefined, seed: realAccount ?? undefined }}
          messages={highlighted}
          renderAttachment={(m) => renderAttachment(m, realAccount)}
          onJump={jumpTo}
          onRemove={(id) => void highlightMessage(id, false)}
          bar={panelBar}
        />
      )}
      {railView !== 'news' && railView !== 'events' && railView !== 'market' && railView !== 'space' && !settingsOpen && !myProfileOpen && profileOpen && realAccount && z.signedIn && !fullPage && rightView !== 'highlights' && (groupInfo && groupId && principal && rightView === 'profile' ? (
        <GroupInfoPanel
          group={groupInfo.state}
          left={groupInfo.left}
          me={principal}
          name={memberName}
          avatar={memberAvatar}
          isFriend={(a) => real.addressBook.some((c) => c.account === a && c.known)}
          friends={pickFriends}
          bar={panelBar}
          actions={{
            update: (patch) => real.updateGroup(groupId, patch),
            add: (accounts) => real.addMembers(groupId, accounts),
            remove: (a) => real.removeMember(groupId, a),
            setRole: (a, role) => real.setMemberRole(groupId, a, role),
            makeOwner: (a) => real.transferOwnership(groupId, a),
            leave: () => real.leaveGroup(groupId),
            delete: async () => {
              await real.deleteGroup(groupId);
              setProfileOpen(false);
              setActiveId(null);
            },
            message: (a) => openChat(`real:${a}`),
          }}
        />
      ) : (
        <ProfilePanel
          contactName={active.name}
          contactInitial={initial(active.name)}
          contactSeed={realAccount ?? active.name}
          messages={messages}
          myFingerprint={real.myFingerprint ?? undefined}
          accountPrincipal={z.account?.principal}
          contactFingerprint={realFingerprint ?? undefined}
          direct={!!realAccount && real.isDirect(realAccount)}
          realAccount={realAccount}
          realContact={realContact}
          self={
            isSelf
              ? { profile: myProfile, emptyBio: 'Notes to yourself. Only you can see this chat.' }
              : undefined
          }
          attachments={
            realAccount
              ? {
                  list: real.messages(realAccount).flatMap((m) => (m.attachment ? [m.attachment] : [])).reverse(),
                  load: real.fileBytes,
                  save: (fileId: string, p: (f: number) => void) => real.saveFile(realAccount, fileId, p),
                  openBlob: (fileId: string, p: (f: number) => void) => real.openBlob(realAccount, fileId, p),
                }
              : undefined
          }
          section={rightView === 'shared' ? 'shared' : 'profile'}
          tab={profileTab}
          onTabChange={setProfileTab}
          bar={panelBar}
        />
      ))}
    </div>
  );
}
