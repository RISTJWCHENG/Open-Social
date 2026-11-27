/**
 * A group's details beside its chat: photo, name and description (editable
 * by those allowed), the owner's settings, the members with their roles and
 * what we may do to each, adding friends, and leaving or deleting the group.
 */
import { useState, type ReactNode } from 'react';
import {
  canEditInfo,
  GROUP_LIMITS,
  isAdmin,
  roleOf,
  type GroupMember,
  type GroupState,
} from '../../core/groups/groups';
import { Avatar } from '../Avatar';
import { ConfirmDialog } from '../ConfirmDialog';
import { PopoverMenu, type MenuItem } from '../PopoverMenu';
import { ChatsIcon, EditIcon, MoreVerticalIcon, PersonIcon, PlusIcon, StarIcon, UserMinusIcon } from '../icons';
import { FriendPicker, type PickFriend } from './FriendPicker';
import { GroupPhotoPicker } from './GroupPhotoPicker';
import { memberCount } from './groupText';

export interface GroupActions {
  update(
    patch: Partial<Pick<GroupState, 'name' | 'about' | 'photo' | 'onlyAdminsPost' | 'onlyAdminsEdit'>>,
  ): Promise<void>;
  add(accounts: string[]): Promise<void>;
  remove(account: string): Promise<void>;
  setRole(account: string, role: 'admin' | 'member'): Promise<void>;
  makeOwner(account: string): Promise<void>;
  leave(): Promise<void>;
  delete(): Promise<void>;
  /** Opens a one-to-one chat with a member who is a friend. */
  message(account: string): void;
}

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: '' } as const;

export function GroupInfoPanel(p: {
  group: GroupState;
  left: boolean;
  me: string;
  name: (account: string) => string;
  avatar: (account: string) => string | undefined;
  isFriend: (account: string) => boolean;
  friends: PickFriend[];
  actions: GroupActions;
  bar: ReactNode;
}) {
  const g = p.group;
  const myRole = p.left ? null : roleOf(g, p.me);
  const admin = !p.left && isAdmin(g, p.me);
  const mayEdit = !p.left && canEditInfo(g, p.me);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: g.name, about: g.about });
  const [adding, setAdding] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<{ member: GroupMember; anchor: HTMLElement } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    label: string;
    run: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Owner first, then admins, then members; by name within each.
  const rank = { owner: 0, admin: 1, member: 2 } as const;
  const members = [...g.members].sort(
    (a, b) => rank[a.role] - rank[b.role] || p.name(a.account).localeCompare(p.name(b.account)),
  );
  const candidates = p.friends.filter((f) => !g.members.some((m) => m.account === f.account));

  const memberMenu = (m: GroupMember): MenuItem[] => {
    const items: MenuItem[] = [];
    if (p.isFriend(m.account))
      items.push({ label: 'Message', icon: <ChatsIcon />, onSelect: () => p.actions.message(m.account) });
    if (admin && m.role === 'member') {
      items.push({
        label: 'Make admin',
        icon: <StarIcon />,
        onSelect: () => void run(() => p.actions.setRole(m.account, 'admin')),
      });
    }
    if (myRole === 'owner' && m.role === 'admin') {
      items.push({
        label: 'Remove as admin',
        icon: <PersonIcon />,
        onSelect: () => void run(() => p.actions.setRole(m.account, 'member')),
      });
    }
    if (myRole === 'owner' && m.role !== 'owner') {
      items.push({
        label: 'Make owner',
        icon: <StarIcon />,
        onSelect: () =>
          setConfirm({
            title: `Make ${p.name(m.account)} the owner?`,
            body: 'They will be able to change the group’s settings and remove admins. You stay in the group as an admin.',
            label: 'Make owner',
            run: () => p.actions.makeOwner(m.account),
          }),
      });
    }
    // Admins remove members; the owner removes anyone.
    if ((admin && m.role === 'member') || (myRole === 'owner' && m.role !== 'owner')) {
      items.push('divider', {
        label: 'Remove from group',
        icon: <UserMinusIcon />,
        danger: true,
        onSelect: () =>
          setConfirm({
            title: `Remove ${p.name(m.account)}?`,
            body: 'They will no longer get the group’s messages. Messages they already have stay on their devices.',
            label: 'Remove',
            run: () => p.actions.remove(m.account),
          }),
      });
    }
    return items;
  };

  return (
    <aside className="profile-panel section-profile grp-panel" aria-label="Group info">
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.label}
          danger
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            void run(c.run);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {menu && (
        <PopoverMenu
          label="Member options"
          anchor={menu.anchor}
          items={memberMenu(menu.member)}
          onClose={() => setMenu(null)}
        />
      )}
      <div className="cover">
        {p.bar}
        <Avatar name={g.name} seed={`g:${g.id}`} src={g.photo || undefined} className="profile-avatar" />
      </div>

      <div className="profile-info">
        {editing ? (
          <form
            className="grp-edit"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.name.trim()) return;
              void run(async () => {
                await p.actions.update({ name: draft.name.trim(), about: draft.about.trim() });
                setEditing(false);
              });
            }}
          >
            <GroupPhotoPicker
              photo={g.photo}
              name={g.name}
              seed={`g:${g.id}`}
              onChange={(photo) => void run(() => p.actions.update({ photo }))}
              onError={setMsg}
            />
            <label className="field">
              <span>Group name</span>
              <input
                value={draft.name}
                maxLength={GROUP_LIMITS.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea
                value={draft.about}
                rows={3}
                maxLength={GROUP_LIMITS.about}
                onChange={(e) => setDraft({ ...draft, about: e.target.value })}
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="ghost-pill" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="submit" className="pill-btn" disabled={busy || !draft.name.trim()}>
                Save
              </button>
            </div>
          </form>
        ) : (
          <>
            <h2 className="profile-name">
              <span className="name-text">{g.name}</span>
            </h2>
            <p className="handle">Group · {memberCount(g.members.length)}</p>
            {g.about && <p className="bio">{g.about}</p>}
            {mayEdit && (
              <button
                type="button"
                className="ghost-pill grp-edit-btn"
                onClick={() => {
                  setDraft({ name: g.name, about: g.about });
                  setEditing(true);
                }}
              >
                <EditIcon /> Edit group
              </button>
            )}
          </>
        )}
        {p.left && (
          <p className="grp-left">You are no longer in this group. Its messages stay here until you delete it.</p>
        )}
        {msg && (
          <p className="result bad" role="alert">
            {msg}
          </p>
        )}
      </div>

      <div className="profile-details">
        <div className="about">
          {myRole === 'owner' && (
            <section className="about-section">
              <h3>Settings</h3>
              <label className="grp-toggle">
                <input
                  type="checkbox"
                  checked={g.onlyAdminsPost}
                  disabled={busy}
                  onChange={(e) => void run(() => p.actions.update({ onlyAdminsPost: e.target.checked }))}
                />
                <span>Only admins can send messages</span>
              </label>
              <label className="grp-toggle">
                <input
                  type="checkbox"
                  checked={g.onlyAdminsEdit}
                  disabled={busy}
                  onChange={(e) => void run(() => p.actions.update({ onlyAdminsEdit: e.target.checked }))}
                />
                <span>Only admins can change the name, photo and description</span>
              </label>
            </section>
          )}

          <section className="about-section">
            <div className="grp-members-head">
              <h3>{memberCount(g.members.length)}</h3>
              {admin && adding === null && (
                <button type="button" className="ghost-pill" onClick={() => setAdding([])}>
                  <PlusIcon /> Add people
                </button>
              )}
            </div>
            {adding !== null && (
              <div className="grp-add">
                <FriendPicker
                  friends={candidates}
                  picked={adding}
                  onChange={setAdding}
                  legend="Add friends"
                  empty="All your friends are already in this group."
                />
                <div className="dialog-actions">
                  <button type="button" className="ghost-pill" onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="pill-btn"
                    disabled={busy || adding.length === 0}
                    onClick={() =>
                      void run(async () => {
                        await p.actions.add(adding);
                        setAdding(null);
                      })
                    }
                  >
                    Add {adding.length || ''}
                  </button>
                </div>
              </div>
            )}
            <ul className="grp-members">
              {members.map((m) => {
                const items = m.account === p.me ? [] : memberMenu(m);
                return (
                  <li key={m.account} className="grp-member">
                    <Avatar name={p.name(m.account)} seed={m.account} src={p.avatar(m.account)} className="avatar-32" />
                    <span className="grp-member-name">{p.name(m.account)}</span>
                    {ROLE_LABEL[m.role] && <span className={`grp-role is-${m.role}`}>{ROLE_LABEL[m.role]}</span>}
                    {items.length > 0 && (
                      <button
                        type="button"
                        className="hdr-btn grp-member-more"
                        aria-label={`Options for ${p.name(m.account)}`}
                        aria-haspopup="menu"
                        onClick={(e) => setMenu({ member: m, anchor: e.currentTarget })}
                      >
                        <MoreVerticalIcon />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="about-section grp-danger">
            {!p.left && (
              <button
                type="button"
                className="link-btn danger"
                onClick={() =>
                  setConfirm({
                    title: 'Leave this group?',
                    body:
                      myRole === 'owner'
                        ? 'You will no longer get its messages. The group passes to its longest-serving admin (or member).'
                        : 'You will no longer get its messages. The chat stays here until you delete it.',
                    label: 'Leave group',
                    run: p.actions.leave,
                  })
                }
              >
                Leave group
              </button>
            )}
            <button
              type="button"
              className="link-btn danger"
              onClick={() =>
                setConfirm({
                  title: 'Delete this group?',
                  body: p.left
                    ? 'The chat and its files are deleted from this device.'
                    : 'You leave the group, and the chat and its files are deleted from this device.',
                  label: 'Delete group',
                  run: p.actions.delete,
                })
              }
            >
              {p.left ? 'Delete group' : 'Leave and delete group'}
            </button>
          </section>
        </div>
      </div>
    </aside>
  );
}
