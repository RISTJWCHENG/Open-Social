/** "New group": a name, an optional photo and description, and the friends to put in it. */
import { useEffect, useState, type FormEvent } from 'react';
import { GROUP_LIMITS } from '../../core/groups/groups';
import { FriendPicker, type PickFriend } from './FriendPicker';
import { GroupPhotoPicker } from './GroupPhotoPicker';

export function NewGroupDialog(p: {
  friends: PickFriend[];
  onCreate: (input: { name: string; about: string; photo: string; members: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [photo, setPhoto] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && p.onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, p]);
  const ready = name.trim().length > 0 && members.length > 0 && !busy;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await p.onCreate({ name: name.trim(), about: about.trim(), photo, members });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && p.onCancel()}>
      <form
        className="dialog grp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-group-title"
        onSubmit={submit}
      >
        <h2 id="new-group-title">New group</h2>
        <GroupPhotoPicker photo={photo} name={name} seed="new-group" onChange={setPhoto} onError={setError} />
        <label className="field">
          <span>Group name</span>
          <input
            value={name}
            maxLength={GROUP_LIMITS.name}
            placeholder="e.g. Weekend in Portland"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Description (optional)</span>
          <textarea value={about} maxLength={GROUP_LIMITS.about} rows={2} onChange={(e) => setAbout(e.target.value)} />
        </label>
        <FriendPicker
          friends={p.friends}
          picked={members}
          onChange={setMembers}
          legend="Members"
          empty="Add friends in Contacts first: groups are made from your friends."
        />
        <p className="grp-note">
          Messages are end-to-end encrypted for every member. In the group, each member is shown with the name on their
          own profile.
        </p>
        {error && (
          <p className="result bad" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="ghost-pill" onClick={p.onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="pill-btn" disabled={!ready}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </form>
    </div>
  );
}
