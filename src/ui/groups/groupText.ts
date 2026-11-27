/**
 * Words for group chats: the lines about changes ("Alice added Bob"), the
 * chat list preview, and the member count.
 */
import type { GroupNotice, RealMessage } from '../../core/delivery/realMessaging';

/** `name(account)` gives "You" for ourselves. */
export function noticeText(n: GroupNotice, name: (account: string) => string): string {
  const by = name(n.by);
  // "You" in the middle of a sentence is "you".
  const obj = (a: string) => (name(a) === 'You' ? 'you' : name(a));
  const list = (who: string[] = []) => {
    const names = who.map(obj);
    return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  };
  switch (n.kind) {
    case 'created':
      return `${by} created the group`;
    case 'joined':
      return `${by} added you`;
    case 'added':
      return `${by} added ${list(n.who)}`;
    case 'removed':
      // The shard stopped serving us: we don't know who did it.
      if (!n.by) return 'You were removed from the group';
      return `${by} removed ${list(n.who)}`;
    case 'left':
      return `${by} left`;
    case 'promoted':
      return `${by} made ${list(n.who)} ${n.who && n.who.length > 1 ? 'admins' : 'an admin'}`;
    case 'demoted':
      return `${list(n.who)} ${n.who && n.who.length > 1 ? 'are' : 'is'} no longer ${n.who && n.who.length > 1 ? 'admins' : 'an admin'}`;
    case 'owner': {
      const who = list(n.who);
      return who === 'you' ? 'You are now the owner' : `${who} is now the owner`;
    }
    case 'renamed':
      return `${by} renamed the group to “${n.text ?? ''}”`;
    case 'photo':
      return `${by} changed the group photo`;
    case 'about':
      return `${by} changed the group description`;
    case 'settings':
      return `${by} changed who can send messages or edit the group`;
  }
}

/** The chat list line for a group's latest message: the sender's name first. */
export function groupPreview(m: RealMessage, text: string, name: (account: string) => string): string {
  if (m.notice) return noticeText(m.notice, name);
  if (m.direction === 'out' || !m.from || m.deleted) return text;
  return `${name(m.from)}: ${text}`;
}

export const memberCount = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`;
