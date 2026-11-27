/**
 * A friend's presence line: online or offline, and while online the status
 * they chose (busy, do not disturb, away). Online is judged peer to peer — a
 * direct connection to one of their devices, or a message in the last two
 * minutes — so no server records when anyone is online.
 */
import type { PresenceStatus } from './sealedProfile';

export const STATUS_LABEL: Record<PresenceStatus, string> = {
  available: 'Available',
  busy: 'Busy',
  dnd: 'Do not disturb',
  away: 'Away',
};

export type PresenceTone = 'offline' | PresenceStatus;

export interface PresenceLine {
  text: string;
  tone: PresenceTone;
}

export function presenceLine(online: boolean, status: PresenceStatus | undefined): PresenceLine {
  if (!online) return { text: 'Offline', tone: 'offline' };
  if (!status || status === 'available') return { text: 'Online', tone: 'available' };
  return { text: `Online (${STATUS_LABEL[status]})`, tone: status };
}
