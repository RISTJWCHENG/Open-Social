/**
 * Settings card: delete the account and everything OpenSocial can delete.
 * Asks the user to type DELETE first.
 */
import { useState } from 'react';

export function DeleteAccountCard({ onDelete }: { onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="settings-card danger-card" aria-labelledby="set-delete">
      <h3 id="set-delete">Delete account</h3>
      {!open ? (
        <>
          <p className="settings-note">
            Permanently deletes your account, profile and photo, the files and backups in your Sia
            space, and everything on this device.
          </p>
          <div className="settings-actions">
            <button type="button" className="ghost-pill danger" onClick={() => setOpen(true)}>
              Delete my account…
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="settings-note">This will delete:</p>
          <ul className="settings-list">
            <li>your account, sign-in methods, devices and waiting messages (identity canister);</li>
            <li>your profile and photos, public and friends-only (profiles canister);</li>
            <li>your backups and the files you shared from your Sia space (if connected);</li>
            <li>all chats, files and keys on this device.</li>
          </ul>
          <p className="settings-note">
            Your friends’ apps are told to remove your profile. Messages and files you already sent
            stay on their devices, and nobody can undo screenshots. This can’t be undone.
          </p>
          <label className="field">
            <span>Type DELETE to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label="Type DELETE to confirm" />
          </label>
          <div className="settings-actions">
            <button
              type="button"
              className="pill-btn danger"
              disabled={typed !== 'DELETE' || busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onDelete();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Deleting…' : 'Delete everything'}
            </button>
            <button type="button" className="link-btn" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {error && (
            <p className="result bad" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
