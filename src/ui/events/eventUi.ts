/** Shared helpers for the Event views. */
import { localDay, RSVP_LABELS, type Rsvp, type ZEvent } from '../../core/events/events';

export interface PersonInfo {
  name: string;
  avatar?: string;
}

/** Looks up a friend's name and photo (ourselves as "You"). */
export type PeopleLookup = (account: string) => PersonInfo;

/** Our standing for an event: organizer, our reply, invited (no reply yet) or cancelled. */
export function myStatus(e: ZEvent, me: string): { label: string; tone: 'organizer' | Rsvp | 'invited' | 'cancelled' } {
  if (e.cancelled) return { label: 'Cancelled', tone: 'cancelled' };
  if (e.organizer === me) return { label: 'Organizer', tone: 'organizer' };
  const r = e.responses[me];
  return r ? { label: RSVP_LABELS[r], tone: r } : { label: 'Invited', tone: 'invited' };
}

/** "Today", "Tomorrow", or "Thu, Dec 3" (with the year when not this year). */
export function dayHeading(day: string, now = Date.now()): string {
  if (day === localDay(now)) return 'Today';
  if (day === localDay(now + 86_400_000)) return 'Tomorrow';
  if (day === localDay(now - 86_400_000)) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(y !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Month abbreviation and day number for a date tile. */
export function dateTile(e: ZEvent): { month: string; day: string } {
  const d = new Date(e.start);
  const opts = e.allDay ? { timeZone: 'UTC' } : {};
  return {
    month: d.toLocaleDateString(undefined, { month: 'short', ...opts }).toUpperCase(),
    day: d.toLocaleDateString(undefined, { day: 'numeric', ...opts }),
  };
}

/** Saves the event as an .ics file. */
export function downloadIcs(name: string, ics: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${
    name
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .slice(0, 60) || 'event'
  }.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "2026-12-05" and "18:30" in local time, for date and time inputs. */
export function toInputs(at: number): { date: string; time: string } {
  const d = new Date(at);
  return {
    date: localDay(at),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

/** Local date and time inputs to ms (NaN when incomplete). */
export function fromInputs(date: string, time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = time.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, h, min).getTime();
}

/** A date input to midnight UTC of that day (all-day events). */
export function utcDayStart(date: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
}
