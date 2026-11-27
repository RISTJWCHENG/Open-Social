/**
 * Profile card (first card in Settings): photo, display name, username, bio
 * and links. Saved encrypted on this device and to open-social-profiles: a
 * sealed copy only friends can open, and a public copy when it is public.
 */
import { LinkIcon, linkServiceName, useLinkPlatforms } from './LinkIcon';
import { avatarStyle, initial } from './Avatar';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  LIMITS,
  emptyProfile,
  COVER_ASPECT,
  coverImage,
  squareImage,
  validateProfile,
  type MyProfile,
  type Profile,
  type ImageCrop,
} from '../core/profile/profile';
import { ImageCropDialog } from './ImageCropDialog';

/** Today as YYYY-MM-DD (local time), the latest birth date. */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
import { normalizeProfile } from '../core/profile/sealedProfile';
import { CameraPlusIcon, CloseIcon } from './icons';

interface Props {
  value: MyProfile | null;
  ready: boolean;
  /** Shown as the display name placeholder (e.g. the short account id). */
  fallbackName: string;
  onSave: (next: MyProfile) => Promise<void>;
  /** Picks the colours of the letter avatar (the account id). */
  seed?: string;
  /** The profile is being copied from another of our devices (saving is blocked). */
  restoring?: boolean;
  /** Stops waiting for the copy: the next save makes a new profile. */
  onStartNew?: () => void;
}

export function ProfileCard({ value, ready, fallbackName, onSave, seed, restoring = false, onStartNew }: Props) {
  const [profile, setProfile] = useState<Profile>(value ? normalizeProfile(value.profile) : emptyProfile());
  const [dirty, setDirty] = useState(false);
  useLinkPlatforms();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const errors = validateProfile(profile);
  const valid = Object.keys(errors).length === 0;
  const visibility = value?.visibility ?? 'friends';

  /** Fields the user has changed since the last save. */
  const touched = useRef(new Set<keyof Profile>());

  // Loaded after the page opened (the device store is asynchronous, and a new
  // account's profile arrives a moment after sign-up): take the loaded values,
  // except for fields the user has already changed.
  useEffect(() => {
    if (!value) return;
    const loaded = normalizeProfile(value.profile);
    setProfile((p) => {
      const merged: Profile = { ...loaded };
      for (const k of touched.current) (merged as unknown as Record<string, unknown>)[k] = p[k];
      return merged;
    });
  }, [value]);

  const update = (patch: Partial<Profile>) => {
    for (const k of Object.keys(patch) as (keyof Profile)[]) touched.current.add(k);
    setProfile((p) => ({ ...p, ...patch }));
    setDirty(true);
    setMsg(null);
  };
  const setLink = (i: number, patch: Partial<Profile['links'][number]>) =>
    update({
      links: profile.links.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    });
  /**
   * A new address: when it belongs to a known service, its name fills the name
   * field — unless the user has typed a name of their own, which is kept.
   */
  const setLinkUrl = (i: number, url: string) => {
    const link = profile.links[i]!;
    const before = linkServiceName(link.url);
    const after = linkServiceName(url);
    const nameIsAuto = !link.label.trim() || link.label === before;
    setLink(i, nameIsAuto ? { url, label: after ?? '' } : { url });
  };

  // A new photo or cover opens the crop dialog first (move and zoom it).
  const [cropping, setCropping] = useState<{ file: File; kind: 'avatar' | 'cover' } | null>(null);
  const pickImage = (file: File | undefined, kind: 'avatar' | 'cover') => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMsg({ ok: false, text: 'Choose an image file.' });
      return;
    }
    setCropping({ file, kind });
  };
  const applyCrop = async (crop: ImageCrop) => {
    if (!cropping) return;
    const { file, kind } = cropping;
    setCropping(null);
    try {
      update(
        kind === 'avatar'
          ? { avatar: await squareImage(file, 256, 0.82, crop) }
          : { cover: await coverImage(file, crop) },
      );
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const save = async (e: FormEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setMsg(null);
    try {
      await onSave({ profile, visibility });
      touched.current.clear();
      setDirty(false);
      setMsg({ ok: true, text: 'Profile saved. Your friends see the update.' });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const letter = initial(profile.displayName.trim() || fallbackName);

  return (
    <form className="pf" id="set-profile" onSubmit={save} aria-label="Your profile">
      {cropping && (
        <ImageCropDialog
          file={cropping.file}
          aspect={cropping.kind === 'avatar' ? 1 : COVER_ASPECT}
          round={cropping.kind === 'avatar'}
          title={cropping.kind === 'avatar' ? 'Edit photo' : 'Edit cover'}
          onApply={(c) => void applyCrop(c)}
          onCancel={() => setCropping(null)}
        />
      )}
      {restoring && (
        <div className="pf-restoring" role="status">
          <p>
            Your profile was set up on another device. It is copied here, end-to-end encrypted, the next time OpenSocial
            is open on that device.
          </p>
          {onStartNew && (
            <button type="button" className="link-btn" onClick={onStartNew}>
              That device is lost: start a new profile here
            </button>
          )}
        </div>
      )}
      {/* Same size and layout as the top of the profile panel, so this is exactly what friends see. */}
      <div
        className={`cover pf-cover ${profile.cover ? 'has-image' : ''}`}
        style={profile.cover ? { backgroundImage: `url(${profile.cover})` } : undefined}
      >
        <div className="pf-cover-actions">
          <button
            type="button"
            className="pf-round"
            onClick={() => coverRef.current?.click()}
            aria-label={profile.cover ? 'Change cover image' : 'Add cover image'}
            title={profile.cover ? 'Change cover image' : 'Add cover image'}
          >
            <CameraPlusIcon />
          </button>
          {profile.cover && (
            <button
              type="button"
              className="pf-round"
              onClick={() => update({ cover: '' })}
              aria-label="Remove cover image"
              title="Remove cover image"
            >
              <CloseIcon />
            </button>
          )}
        </div>
        <div className="profile-avatar pf-avatar">
          {profile.avatar ? (
            <img src={profile.avatar} alt="Your profile photo" />
          ) : (
            <span className="pf-letter" style={avatarStyle(seed ?? fallbackName)} aria-hidden="true">
              {letter}
            </span>
          )}
          <button
            type="button"
            className="pf-round pf-avatar-btn"
            onClick={() => fileRef.current?.click()}
            aria-label={profile.avatar ? 'Change photo' : 'Add photo'}
            title={profile.avatar ? 'Change photo' : 'Add photo'}
          >
            <CameraPlusIcon />
          </button>
        </div>
        {profile.avatar && (
          <button type="button" className="pf-avatar-remove" onClick={() => update({ avatar: '' })}>
            Remove photo
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Profile photo"
          onChange={(e) => {
            pickImage(e.target.files?.[0], 'avatar');
            e.target.value = '';
          }}
        />
        <input
          ref={coverRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Cover image"
          onChange={(e) => {
            pickImage(e.target.files?.[0], 'cover');
            e.target.value = '';
          }}
        />
      </div>

      <div className="pf-fields">
        <label className="pf-field">
          <span className="pf-label">Display name (optional)</span>
          <input
            className="pf-input"
            value={profile.displayName}
            maxLength={LIMITS.displayName + 10}
            onChange={(e) => update({ displayName: e.target.value })}
            placeholder={fallbackName}
            aria-invalid={!!errors.displayName}
          />
          {errors.displayName && <span className="field-error">{errors.displayName}</span>}
        </label>

        <label className="pf-field">
          <span className="pf-label">Username (optional)</span>
          <span className="pf-input pf-prefixed">
            <span aria-hidden="true">@</span>
            <input
              value={profile.username}
              maxLength={LIMITS.username * 2}
              onChange={(e) =>
                update({
                  username: e.target.value.replace(/\s/g, ''),
                })
              }
              placeholder="username"
              aria-label="Username"
              aria-invalid={!!errors.username}
            />
          </span>
          {errors.username && <span className="field-error">{errors.username}</span>}
        </label>

        <label className="pf-field">
          <span className="pf-label pf-label-row">
            <span>Bio</span>
            <span className={`pf-count ${profile.bio.length > LIMITS.bio ? 'over' : ''}`}>
              {profile.bio.length}/{LIMITS.bio}
            </span>
          </span>
          <textarea
            className="pf-input pf-textarea"
            rows={3}
            value={profile.bio}
            onChange={(e) => update({ bio: e.target.value })}
            placeholder="A short line about you"
            aria-invalid={!!errors.bio}
          />
          {errors.bio && <span className="field-error">{errors.bio}</span>}
        </label>

        <label className="pf-field">
          <span className="pf-label pf-label-row">
            <span>Location (optional)</span>
            <span className={`pf-count ${profile.location.length > LIMITS.location ? 'over' : ''}`}>
              {profile.location.length}/{LIMITS.location}
            </span>
          </span>
          <input
            className="pf-input"
            value={profile.location}
            maxLength={LIMITS.location}
            onChange={(e) => update({ location: e.target.value })}
            placeholder="City, country"
            autoComplete="off"
            aria-invalid={!!errors.location}
          />
          {errors.location && <span className="field-error">{errors.location}</span>}
        </label>

        <label className="pf-field">
          <span className="pf-label">Birth date (optional)</span>
          <span className="pf-date-row">
            <input
              className="pf-input pf-date"
              type="date"
              value={profile.birthDate}
              min="1900-01-01"
              max={todayIso()}
              onChange={(e) => update({ birthDate: e.target.value })}
              aria-invalid={!!errors.birthDate}
            />
            {profile.birthDate && (
              <button
                type="button"
                className="pf-x"
                onClick={() => update({ birthDate: '' })}
                aria-label="Remove birth date"
                title="Remove birth date"
              >
                ×
              </button>
            )}
          </span>
          {errors.birthDate && <span className="field-error">{errors.birthDate}</span>}
          <span className="pf-hint">Location and birth date are shown to friends only.</span>
        </label>

        <div className="pf-field" role="group" aria-labelledby="pf-links">
          <span className="pf-label" id="pf-links">
            Links
          </span>
          {profile.links.map((l, i) => (
            <div key={i} className="pf-link-wrap">
              <div className="pf-link">
                <LinkIcon url={l.url} size={30} />
                <input
                  className="pf-input"
                  value={l.url}
                  onChange={(e) => setLinkUrl(i, e.target.value)}
                  placeholder="https://"
                  inputMode="url"
                  aria-label={`Link ${i + 1} address`}
                />
                <input
                  className="pf-input"
                  value={l.label}
                  maxLength={LIMITS.linkLabel + 5}
                  onChange={(e) => setLink(i, { label: e.target.value })}
                  placeholder={linkServiceName(l.url) ?? 'Name (e.g. My website)'}
                  aria-label={`Link ${i + 1} name`}
                />
                <button
                  type="button"
                  className="pf-x"
                  onClick={() => update({ links: profile.links.filter((_, j) => j !== i) })}
                  aria-label={`Remove link ${i + 1}`}
                >
                  ×
                </button>
              </div>
              {/* Only once something was typed: a fresh row (just "https://") is not an error yet. */}
              {errors.link?.[i] && (l.label || l.url.replace(/^https:\/\/$/, '')) && (
                <span className="field-error">{errors.link[i]}</span>
              )}
            </div>
          ))}
          {profile.links.length < LIMITS.links && (
            <button
              type="button"
              className="pf-add"
              onClick={() =>
                update({
                  links: [...profile.links, { label: '', url: 'https://' }],
                })
              }
            >
              + Add link
            </button>
          )}
        </div>

        <div className="pf-actions">
          <button type="submit" className="pill-btn" disabled={!ready || !valid || saving || !dirty || restoring}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          {dirty && <span className="settings-note">Unsaved changes</span>}
        </div>

        {restoring && dirty ? (
          <div className="pf-restoring pf-restoring-save" role="status">
            <p>
              This device is still waiting for your profile from your other device, so saving here would replace it.
              Open OpenSocial on that device once and it arrives here by itself, end-to-end encrypted.
            </p>
            {onStartNew && (
              <button
                type="button"
                className="pill-btn"
                disabled={!ready || !valid || saving}
                onClick={(e) => {
                  onStartNew();
                  void save(e);
                }}
              >
                No other device: save as my profile
              </button>
            )}
          </div>
        ) : (
          msg && (
            <p className={`result ${msg.ok ? 'ok' : 'bad'}`} role="status">
              {msg.text}
            </p>
          )
        )}

        <p className="settings-note">
          {visibility === 'public'
            ? 'Your profile is public: anyone can find it. Change this in Settings.'
            : 'Only people you chat with see your profile. It is encrypted on this device; OpenSocial can’t read it.'}
        </p>
      </div>
    </form>
  );
}
