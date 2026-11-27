import { LinkIcon, linkServiceName, useLinkPlatforms } from './LinkIcon';
import { avatarStyle } from './Avatar';
import type { ReactNode } from 'react';
import type { Attachment, RealContact, RealMessage } from '../core/delivery/realMessaging';
import { CopyIconButton } from './CopyButton';
import type { ProfileContent } from '../core/profile/sealedProfile';
import { AttachmentView } from './AttachmentView';
import { CakeIcon, MapPinIcon } from './icons';
import { LevelBadge } from './LevelBadge';
import { ShareContactCard } from './ShareContactCard';
import { InfoTip } from './InfoTip';

/** "March 4, 1990" from 1990-03-04 (the date as written, whatever the time zone). */
export function birthDateText(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export const NOT_IN_PROTOTYPE = 'Not available in this prototype';

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/g;

/** Kinds of things shared in a chat (the Shared view). */
export type ProfileTab = 'media' | 'files' | 'links';

export interface ProfilePanelProps {
  contactName: string;
  contactInitial: string;
  /** Picks the colours of the letter avatar (the account id). */
  contactSeed: string;
  messages: RealMessage[];
  myFingerprint: string | undefined;
  accountPrincipal?: string | undefined;
  contactFingerprint: string | undefined;
  /** A direct connection to the contact is open. */
  direct?: boolean;
  /** Which view: the person, or what was shared in the chat. */
  section: 'profile' | 'shared';
  tab: ProfileTab;
  onTabChange: (t: ProfileTab) => void;
  /** The panel's top bar (collapse and view switcher). */
  bar: ReactNode;
  /** Set for real OpenSocial contacts (their account principal). */
  realAccount?: string | null;
  realContact?: RealContact;
  /** The notes-to-self chat: show the user's own profile with an edit button. */
  self?: { profile: ProfileContent | null; emptyBio: string };
  /** Real chats: files shared in this conversation. */
  attachments?: {
    list: Attachment[];
    load: (fileId: string) => Promise<Uint8Array | null>;
    save: (fileId: string, onProgress: (fraction: number) => void) => Promise<void>;
    openBlob?: (fileId: string, onProgress: (fraction: number) => void) => Promise<Blob>;
  };
}

export function ProfilePanel(p: ProfilePanelProps) {
  useLinkPlatforms();
  const links = p.messages.flatMap((m) => m.body.match(URL_PATTERN) ?? []);
  /** Whose profile is shown: the user's own (notes to self) or the contact's. */
  const shown = p.self ? p.self.profile : p.realContact?.profile;
  const shared = p.attachments?.list ?? [];
  const media = shared.filter((a) => a.mime.startsWith('image/') || a.mime.startsWith('video/'));
  const files = shared.filter((a) => !a.mime.startsWith('image/') && !a.mime.startsWith('video/'));
  const tabs: { id: ProfileTab; label: string; n: number }[] = [
    { id: 'media', label: 'Media', n: media.length },
    { id: 'files', label: 'Files', n: files.length },
    { id: 'links', label: 'Links', n: links.length },
  ];
  if (p.section === 'shared') {
    return (
      <aside className="profile-panel section-shared" aria-label="Shared in this chat">
        {p.bar}
        <div className="tabs" role="tablist" aria-label="Shared in this chat">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={p.tab === t.id}
              aria-controls={`panel-${t.id}`}
              className={`tab ${p.tab === t.id ? 'active' : ''}`}
              onClick={() => p.onTabChange(t.id)}
            >
              {t.label}
              {t.n > 0 && <span className="tab-count">{t.n}</span>}
            </button>
          ))}
        </div>
        <div className="tab-panel" role="tabpanel" id={`panel-${p.tab}`} aria-labelledby={`tab-${p.tab}`}>
          {p.tab === 'media' &&
            (p.attachments && media.length ? (
              <div className="media-grid">
                {media.map((a) => (
                  <AttachmentView
                    key={a.fileId}
                    a={a}
                    load={p.attachments!.load}
                    save={(pr) => p.attachments!.save(a.fileId, pr)}
                    openBlob={p.attachments?.openBlob ? (pr) => p.attachments!.openBlob!(a.fileId, pr) : undefined}
                  />
                ))}
              </div>
            ) : (
              <p className="panel-empty">No photos or videos shared yet.</p>
            ))}
          {p.tab === 'files' &&
            (p.attachments && files.length ? (
              <div className="file-list">
                {files.map((a) => (
                  <AttachmentView
                    key={a.fileId}
                    a={a}
                    load={p.attachments!.load}
                    save={(pr) => p.attachments!.save(a.fileId, pr)}
                    openBlob={p.attachments?.openBlob ? (pr) => p.attachments!.openBlob!(a.fileId, pr) : undefined}
                  />
                ))}
              </div>
            ) : (
              <p className="panel-empty">No files shared yet.</p>
            ))}
          {p.tab === 'links' &&
            (links.length ? (
              <ul className="link-list">
                {links.map((l, i) => (
                  <li key={`${l}-${i}`}>
                    <a href={l} target="_blank" rel="noopener noreferrer">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-empty">Links you share in this chat will show up here.</p>
            ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="profile-panel section-profile" aria-label="Contact profile">
      <div
        className={`cover ${shown?.cover ? 'has-image' : ''}`}
        style={shown?.cover ? { backgroundImage: `url(${shown.cover})` } : undefined}
      >
        {p.bar}
        {shown?.avatar ? (
          <img className="profile-avatar" src={shown.avatar} alt="" />
        ) : (
          <span className="profile-avatar" style={avatarStyle(p.contactSeed)} aria-hidden="true">
            {p.contactInitial}
          </span>
        )}
      </div>
      <div className="profile-info">
        <h2 className="profile-name">
          <span className="name-text">{p.contactName}</span>
          <LevelBadge size={20} />
        </h2>
        <>
          {shown?.username && <p className="handle">@{shown.username}</p>}
          <p className="bio">
            {shown?.bio ||
              (p.self
                ? p.self.emptyBio
                : shown
                  ? ''
                  : `${p.contactName} hasn’t shared a profile with you yet. It appears once they accept your chat.`)}
          </p>
          {(shown?.location || shown?.birthDate) && (
            <ul className="profile-facts">
              {shown.location && (
                <li>
                  <MapPinIcon aria-hidden="true" />
                  <span>{shown.location}</span>
                </li>
              )}
              {shown.birthDate && (
                <li>
                  <CakeIcon aria-hidden="true" />
                  <span>Born {birthDateText(shown.birthDate)}</span>
                </li>
              )}
            </ul>
          )}
          {!!shown?.links?.length && (
            <ul className="profile-socials" aria-label="Links">
              {shown.links.map((l) => {
                const host = new URL(l.url).hostname.replace(/^www\./, '');
                const service = linkServiceName(l.url);
                const name = l.label || service || host;
                return (
                  <li key={l.url}>
                    {/* Links come from other people: their address is shown, and they open without access to this page. */}
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      title={`${name} · ${host}`}
                      aria-label={`${name} (${host})`}
                    >
                      <LinkIcon url={l.url} />
                      <span className="profile-social-label">{name}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      </div>

      <div className="profile-details">
        <div className="about">
          <section className="about-section">
            {/* The long account ID: here rather than under the name, with a copy icon after it. */}
            <div className="about-heading">
              <h3>{p.self ? 'Your OpenSocial ID' : 'OpenSocial ID'}</h3>
              <InfoTip label="What is an OpenSocial ID?">
                {p.self ? 'Your' : 'Their'} account’s address on the Internet Computer (its principal). It stays the same
                whichever way {p.self ? 'you sign' : 'they sign'} in (Internet Identity, passkey or email) and on every
                device. Share it so people can add {p.self ? 'you' : 'them'}. It is not a password: no one can sign in
                or read messages with it.
              </InfoTip>
            </div>
            <p className="small id-line">
              <code className="principal">{(p.self ? p.accountPrincipal : p.realAccount) ?? 'Not signed in'}</code>
              {(p.self ? p.accountPrincipal : p.realAccount) && (
                <CopyIconButton text={(p.self ? p.accountPrincipal : p.realAccount)!} label="Copy ID" />
              )}
            </p>
          </section>

          {p.self && p.accountPrincipal && (
            <section className="about-section">
              <ShareContactCard account={p.accountPrincipal} />
            </section>
          )}

          {!p.self && (
            <section className="about-section">
              <h3>Safety numbers</h3>
              <p className="muted small">Compare these with {p.contactName} in person before trusting the contact.</p>
              <dl className="safety">
                <div>
                  <dt>{p.contactName}</dt>
                  <dd>
                    <code>{p.contactFingerprint ?? '…'}</code>
                  </dd>
                </div>
                <div>
                  <dt>You</dt>
                  <dd>
                    <code>{p.myFingerprint ?? '…'}</code>
                  </dd>
                </div>
              </dl>
            </section>
          )}

          <section className="about-section">
            <h3>How this chat is protected</h3>
            <ul className="small about-facts">
              <li>End-to-end encrypted with MLS (OpenMLS) on your devices.</li>
              {p.self ? (
                <li>Notes to yourself never leave this device.</li>
              ) : (
                <li>
                  {p.direct
                    ? 'Delivered over a direct connection between your devices.'
                    : 'Delivered through an encrypted ICP mailbox; removed once received.'}
                </li>
              )}
              <li>Chats are stored encrypted on this device.</li>
              {!!p.realContact?.repaired && (
                <li>
                  Repaired {p.realContact.repaired === 1 ? 'once' : `${p.realContact.repaired} times`}: some messages
                  from {p.contactName} couldn’t be decrypted here, so their app started a new encrypted channel and sent
                  them again.
                </li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </aside>
  );
}
