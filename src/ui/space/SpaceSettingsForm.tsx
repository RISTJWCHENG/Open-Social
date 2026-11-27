/** Edit your space: about text, accent colour, visibility, Market tab, and storage used. */
import { useState, type FormEvent } from 'react';
import {
  ACCENT_COLORS,
  ACCENTS,
  formatBytes,
  LIMITS,
  type Accent,
  type SpaceInfo,
  type SpaceSettingsInput,
} from '../../core/space/space';
import { BackIcon } from '../icons';

interface Props {
  info: SpaceInfo;
  onSave(s: SpaceSettingsInput): Promise<void>;
  onCancel(): void;
}

export function SpaceSettingsForm({ info, onSave, onCancel }: Props) {
  const [about, setAbout] = useState(info.about);
  const [accent, setAccent] = useState<Accent>(info.accent);
  const [visible, setVisible] = useState(info.visible);
  const [showMarket, setShowMarket] = useState(info.showMarket);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const used = info.usedBytes ?? 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ about: about.trim(), accent, pinned: info.pinned, visible, showMarket });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="chat-main ev-main" aria-label="Edit space">
      <header className="ev-bar">
        <button type="button" className="hdr-btn back mk-back" onClick={onCancel} aria-label="Back">
          <BackIcon />
        </button>
        <h2>Edit space</h2>
      </header>
      <form className="ev-form" onSubmit={(e) => void submit(e)}>
        <label className="ev-field">
          <span>About</span>
          <textarea
            value={about}
            maxLength={LIMITS.about}
            rows={4}
            placeholder="What you make, what you're into, where to find you"
            onChange={(e) => setAbout(e.target.value)}
          />
          <span className="ev-hint mk-counter">
            {about.length} / {LIMITS.about}
          </span>
        </label>
        <fieldset className="ev-field">
          <legend>Colour</legend>
          <div className="sp-swatches" role="radiogroup" aria-label="Colour">
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={accent === a}
                aria-label={a}
                className="sp-swatch"
                style={{ background: `linear-gradient(135deg, ${ACCENT_COLORS[a][0]}, ${ACCENT_COLORS[a][1]})` }}
                onClick={() => setAccent(a)}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="ev-field">
          <legend>Visibility</legend>
          <label className="ev-switch">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
            Anyone can see my space
          </label>
          <p className="ev-hint sp-hint">Turned off, only you can see it and it is left out of Explore.</p>
          <label className="ev-switch">
            <input type="checkbox" checked={showMarket} onChange={(e) => setShowMarket(e.target.checked)} />
            Show my Market listings in my space
          </label>
        </fieldset>
        <div className="ev-field">
          <span>Storage</span>
          <span className="sp-usage">
            <span style={{ width: `${Math.min(100, (used / info.quotaBytes) * 100)}%` }} />
          </span>
          <span className="ev-hint sp-hint">
            {formatBytes(used)} of {formatBytes(info.quotaBytes)} used by your images, videos and music.
          </span>
        </div>
        {error && <p className="ev-error">{error}</p>}
        <div className="ev-form-actions">
          <button type="button" className="ev-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="ev-btn is-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </main>
  );
}
