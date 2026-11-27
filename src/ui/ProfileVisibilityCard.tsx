/**
 * Settings: who can see your profile.
 * - Friends only (default): name, photo and about go to people you chat with,
 *   inside the end-to-end encrypted stream.
 * - Public: also listed in the OpenSocial directory; anyone can find you by a
 *   similar name and see your profile. Can be switched off at any time.
 */
import { useState } from 'react';
import type { Profile, ProfileVisibility } from '../core/profile/profile';

interface Props {
  visibility: ProfileVisibility;
  profile: Profile | null;
  ready: boolean;
  onChange: (v: ProfileVisibility) => Promise<void>;
  onOpenProfile: () => void;
}

export function ProfileVisibilityCard({ visibility, profile, ready, onChange, onOpenProfile }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const missing = !profile?.displayName.trim() || !profile?.username;

  const choose = async (v: ProfileVisibility) => {
    if (v === visibility || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await onChange(v);
      setMsg({
        ok: true,
        text:
          v === 'public'
            ? 'Your profile is now public. Anyone can find you by name.'
            : 'Your profile is no longer public. Only people you chat with see it.',
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card" aria-labelledby="set-visibility">
      <h3 id="set-visibility">Who can see your profile</h3>
      <div className="visibility-options" role="radiogroup" aria-label="Profile visibility">
        <label className={`option ${visibility === 'friends' ? 'on' : ''}`}>
          <input
            type="radio"
            name="visibility"
            checked={visibility === 'friends'}
            disabled={busy || !ready}
            onChange={() => void choose('friends')}
          />
          <span className="option-box radio" aria-hidden="true" />
          <span className="option-text">
            <span className="option-title">
              Only people I chat with <span className="rec">Default</span>
            </span>
            <span className="option-detail">
              Your name, photo and about are sent, end-to-end encrypted, only to people you chat
              with. Nobody can search for you; share your OpenSocial ID to be added.
            </span>
          </span>
        </label>
        <label className={`option ${visibility === 'public' ? 'on' : ''}`}>
          <input
            type="radio"
            name="visibility"
            checked={visibility === 'public'}
            disabled={busy || !ready}
            onChange={() => void choose('public')}
          />
          <span className="option-box radio" aria-hidden="true" />
          <span className="option-text">
            <span className="option-title">Public</span>
            <span className="option-detail">
              Anyone can find you by a similar name or username and see your name, photo and
              about. Strangers’ first messages arrive as requests.
            </span>
          </span>
        </label>
      </div>
      {missing && (
        <p className="settings-note">
          To go public, add a display name and a username first.{' '}
          <button type="button" className="link-btn" onClick={onOpenProfile}>
            Open Profile settings
          </button>
        </p>
      )}
      <p className="settings-note">
        You can switch at any time. Turning public off removes you from search at once, but
        people who already saw your profile may have kept a copy.
      </p>
      {busy && <p className="settings-note">Updating…</p>}
      {msg && (
        <p className={`result ${msg.ok ? 'ok' : 'bad'}`} role="status">
          {msg.text}
        </p>
      )}
    </section>
  );
}
