/**
 * Settings: account and recovery. Users who skipped recovery at first sign-in
 * set it up here, and anyone can replace or remove their recovery key.
 * Recovery = Internet Identity + any ONE registered second factor. Parts that
 * need later phases are listed with their status so nothing appears to work
 * that doesn't yet.
 */
import { RailPreferences, type RailItemInfo } from './RailPreferences';
import type { RailPrefs } from '../core/settings/railPrefs';
import { useState } from 'react';
import type { RecoverySetup } from '../core/recovery/setupStore';
import { CloseIcon } from './icons';
import type { ComponentProps } from 'react';
import { DeleteAccountCard } from './DeleteAccountCard';
import { ProfileCard } from './ProfileCard';
import { EmailServiceCard } from './EmailServiceCard';
import { CopyButton } from './CopyButton';
import { SiaStorageCard, type SiaClientLike } from './SiaStorageCard';
import { ProfileVisibilityCard } from './ProfileVisibilityCard';
import type { Profile, ProfileVisibility } from '../core/profile/profile';
import type { AccountProvider } from '../core/interfaces';
import { RECOVERY_METHODS, waitLabel } from '../core/recovery/methods';
import { releasedOn } from './AppVersion';

interface Props {
  principal: string;
  recovery: RecoverySetup | null;
  onCreateKey: () => void;
  onRemoveKey: () => void;
  onBack: () => void;
  emailAdmin?: AccountProvider['emailAdmin'];
  sia?: { client: SiaClientLike; exportChats: () => Uint8Array; importChats: (d: Uint8Array) => Promise<number> };
  /** Open section, controlled by the app (links can open a given one). */
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  /** Profile section. */
  profile?: ComponentProps<typeof ProfileCard>;
  direct?: { enabled: boolean; onChange: (on: boolean) => void; available: boolean };
  /** Read receipts on or off (Community tab). */
  receipts?: { enabled: boolean; onChange: (on: boolean) => void; available: boolean };
  /** Deletes the account (shown once real messaging is ready). */
  onDeleteAccount?: () => Promise<void>;
  visibility?: {
    value: ProfileVisibility;
    profile: Profile | null;
    ready: boolean;
    onChange: (v: ProfileVisibility) => Promise<void>;
    onOpenProfile: () => void;
  };
  rail?: { prefs: RailPrefs; items: RailItemInfo[]; onChange: (p: RailPrefs) => void };
}

/** Settings sections. Profile and Community fit the normal side panel; Account is wider. */
export type SettingsTab = 'profile' | 'account' | 'community' | 'preferences';
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'account', label: 'Account' },
  { id: 'community', label: 'Community' },
  { id: 'preferences', label: 'Preferences' },
];

type Status = 'on' | 'off' | 'later';

function Pill({ status, children }: { status: Status; children: React.ReactNode }) {
  return <span className={`status-pill is-${status}`}>{children}</span>;
}

export function SettingsPage({
  principal,
  recovery,
  onCreateKey,
  onRemoveKey,
  onBack,
  emailAdmin,
  sia,
  visibility,
  direct,
  receipts,
  onDeleteAccount,
  profile,
  tab,
  onTabChange,
  rail,
}: Props) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const hasKey = !!recovery?.methods.includes('recovery-key') && !!recovery.recoveryKeyCommitment;
  const hasSecondFactor = !!recovery && recovery.methods.length > 0;
  const otherFactors = (recovery?.methods ?? []).filter((m) => m !== 'recovery-key').length;

  return (
    <aside className="settings-panel" aria-label="Settings" data-tab={tab}>
      <header className="settings-head">
        <h2>Settings</h2>
        <button type="button" className="hdr-btn settings-close" onClick={onBack} aria-label="Close settings">
          <CloseIcon />
        </button>
      </header>
      <div className="tabs settings-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-body">
        {tab === 'profile' && profile && <ProfileCard {...profile} />}
        {tab === 'account' && (
          <>
            <section className="settings-card" aria-labelledby="set-account">
              <h3 id="set-account">Account</h3>
              <p className="settings-row">
                <span>Internet Identity</span>
                <Pill status="on">Signed in</Pill>
              </p>
              <p className="principal-row">
                <code className="principal">{principal}</code>
                <CopyButton text={principal} label="Copy principal" />
              </p>
              <p className="settings-note">
                Lost every device? Internet Identity has its own recovery (passkeys on other devices or
                a recovery phrase). Manage it at{' '}
                <a href="https://id.ai" target="_blank" rel="noopener noreferrer">
                  id.ai
                </a>
                .
              </p>
            </section>

            <section className="settings-card" aria-labelledby="set-recovery">
              <div className="settings-row">
                <h3 id="set-recovery">Account recovery</h3>
                {hasSecondFactor ? <Pill status="on">Set up</Pill> : <Pill status="off">Not set up</Pill>}
              </div>
              <p className="settings-note">
                Lost this device? Sign in with Internet Identity on a new one, then confirm with any
                one second factor below. Add more than one as a backup.
              </p>

              <div className="factor">
                <div className="settings-row">
                  <span className="step-title">First factor: Internet Identity</span>
                  <Pill status="on">Set up</Pill>
                </div>
                <p className="settings-note">Your passkey. Required for every recovery.</p>
              </div>

              <div className="factor">
                <div className="settings-row">
                  <span className="step-title">Second factor: any one of these</span>
                  {hasSecondFactor ? <Pill status="on">Set up</Pill> : <Pill status="off">Not set up</Pill>}
                </div>
                <ul className="method-list" aria-label="Second factors">
                  {RECOVERY_METHODS.map((m) => {
                    const isSet = !!recovery?.methods.includes(m.id) && (m.id !== 'recovery-key' || hasKey);
                    return (
                      <li key={m.id} className={`method ${m.available ? '' : 'is-off'}`}>
                        <div className="settings-row">
                          <span>
                            {m.title}
                            {m.recommended && <span className="rec">Recommended</span>}
                            {m.optional && <span className="soon">Optional</span>}
                          </span>
                          {!m.available ? (
                            <Pill status="later">Coming later</Pill>
                          ) : isSet ? (
                            <Pill status="on">Set up</Pill>
                          ) : (
                            <Pill status="off">Not set up</Pill>
                          )}
                        </div>
                        <p className="settings-note">
                          {m.id === 'recovery-key' ? m.detail : m.note ?? m.detail}{' '}
                          {waitLabel(m.waitHours)} before a recovery completes.
                        </p>
                        {m.id === 'recovery-key' && (
                          <>
                            {hasKey && (
                              <p className="settings-note">
                                Fingerprint <code>{recovery!.recoveryKeyCommitment!.slice(0, 16)}</code>
                              </p>
                            )}
                            {!confirmRemove ? (
                              <div className="settings-actions">
                                <button type="button" className="pill-btn" onClick={onCreateKey}>
                                  {hasKey ? 'Replace recovery key' : 'Create recovery key'}
                                </button>
                                {hasKey && (
                                  <button
                                    type="button"
                                    className="link-btn danger"
                                    onClick={() => setConfirmRemove(true)}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div
                                className="confirm-box"
                                role="alertdialog"
                                aria-label="Remove recovery key"
                              >
                                <p>
                                  Remove your recovery key?
                                  {otherFactors === 0 &&
                                    ' It’s your only second factor, so a lost device couldn’t be recovered.'}
                                </p>
                                <div className="settings-actions">
                                  <button
                                    type="button"
                                    className="pill-btn danger-btn"
                                    onClick={() => {
                                      setConfirmRemove(false);
                                      onRemoveKey();
                                    }}
                                  >
                                    Remove key
                                  </button>
                                  <button
                                    type="button"
                                    className="link-btn"
                                    onClick={() => setConfirmRemove(false)}
                                  >
                                    Keep it
                                  </button>
                                </div>
                              </div>
                            )}
                            {hasKey && (
                              <p className="settings-note">
                                Replacing makes the old key useless. You’ll save and check the new one.
                              </p>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="factor">
                <div className="settings-row">
                  <span className="step-title">Protection during recovery</span>
                  <Pill status="later">Later phase</Pill>
                </div>
                <p className="settings-note">
                  A waiting period (shown per factor above) and a notice to your other devices, so you
                  can stop a recovery you didn’t start.
                </p>
              </div>

              <div className="factor">
                <div className="settings-row">
                  <span className="step-title">After recovery</span>
                  <Pill status="later">Later phase</Pill>
                </div>
                <ul className="after-list">
                  <li>New device key registered on ICP, old keys revoked</li>
                  <li>Chats restored from your encrypted Sia backup</li>
                  <li>Contacts see your new safety number</li>
                </ul>
              </div>

              <p className="settings-note">
                Until the ICP recovery service exists, this setup is saved in this browser only.
              </p>
            </section>
            {sia && (
              <SiaStorageCard
                client={sia.client}
                exportChats={sia.exportChats}
                importChats={sia.importChats}
              />
            )}
            {emailAdmin && <EmailServiceCard admin={emailAdmin} />}
            {onDeleteAccount && <DeleteAccountCard onDelete={onDeleteAccount} />}
            <section className="settings-card" aria-labelledby="set-about">
              <h3 id="set-about">About OpenSocial</h3>
              <p className="settings-note">
                Version {__APP_VERSION__}, released {releasedOn(__APP_RELEASED__)} (build{' '}
                <code>{__BUILD_COMMIT__}</code>). End-to-end encryption uses MLS (RFC 9420) with
                OpenMLS. Third-party components are used under their own licences.
              </p>
              <div className="settings-actions">
                <a className="ghost-pill" href="./third-party-licenses.txt" target="_blank" rel="noopener">
                  Third-party licences
                </a>
              </div>
            </section>
          </>
        )}
        {tab === 'preferences' && rail && <RailPreferences {...rail} />}
        {tab === 'community' && (
          <>
            {direct && (
              <section className="settings-card" aria-labelledby="set-direct">
                <h3 id="set-direct">Connections</h3>
                <label className="option-toggle">
                  <input
                    type="checkbox"
                    checked={direct.enabled}
                    disabled={!direct.available}
                    onChange={(e) => direct.onChange(e.target.checked)}
                  />
                  <span>
                    <span className="option-title">Allow direct connections with friends</span>
                    <span className="option-detail">
                      When you and a friend are both online, messages go straight between your devices
                      and arrive in about a second. Your friend can see your IP address. Turned off,
                      messages always go through the encrypted ICP mailbox (a few seconds). Only people
                      you added or accepted can connect directly. High-privacy mode (Nym) will turn this
                      off automatically.
                    </span>
                  </span>
                </label>
              </section>
            )}
            {receipts && (
              <section className="settings-card" aria-labelledby="set-receipts">
                <h3 id="set-receipts">Read receipts</h3>
                <label className="option-toggle">
                  <input
                    type="checkbox"
                    checked={receipts.enabled}
                    disabled={!receipts.available}
                    onChange={(e) => receipts.onChange(e.target.checked)}
                  />
                  <span>
                    <span className="option-title">Send read receipts</span>
                    <span className="option-detail">
                      Friends see a magenta tick when you have read their messages. Turned off, they don’t, and
                      you don’t see when they read yours either. Delivered (green tick) is always shown.
                    </span>
                  </span>
                </label>
              </section>
            )}
            {visibility && (
              <ProfileVisibilityCard
                visibility={visibility.value}
                profile={visibility.profile}
                ready={visibility.ready}
                onChange={visibility.onChange}
                onOpenProfile={visibility.onOpenProfile}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}
