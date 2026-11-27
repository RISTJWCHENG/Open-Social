/**
 * Events: a time and place shared with friends, like the event invites of
 * other messengers. The organizer's app is the source of truth: it sends the
 * event (end-to-end encrypted, over MLS) to every invitee and again after any
 * change, including each invitee's reply. Everything received is checked here.
 */

export type Rsvp = 'going' | 'maybe' | 'declined';
export const RSVPS: Rsvp[] = ['going', 'maybe', 'declined'];
export const RSVP_LABELS: Record<Rsvp, string> = { going: 'Going', maybe: 'Maybe', declined: "Can't go" };

export interface ZEvent {
  /** 16 hex characters, chosen by the organizer. */
  id: string;
  /** The organizer's account. */
  organizer: string;
  title: string;
  description?: string;
  /** Start, in ms. For all-day events: midnight UTC of the first day. */
  start: number;
  /** End, in ms (after start); for all-day events midnight UTC after the last day. */
  end?: number;
  allDay?: boolean;
  location?: string;
  /** An https link to join online. */
  link?: string;
  /** Invited accounts (not the organizer). */
  invitees: string[];
  /** Replies, by invitee. */
  responses: Record<string, Rsvp>;
  /** The organizer's last change (ms); newer copies replace older ones. */
  updatedAt: number;
  cancelled?: boolean;
}

/** Local only (never sent): minutes before the start to remind this device; 0: none. */
export type Reminder = 0 | 15 | 60 | 1440;
export const REMINDERS: Reminder[] = [0, 15, 60, 1440];
export const REMINDER_LABELS: Record<Reminder, string> = {
  0: 'No reminder',
  15: '15 minutes before',
  60: '1 hour before',
  1440: '1 day before',
};

export const LIMITS = { title: 120, description: 2000, location: 200, link: 500, invitees: 50 } as const;
const ID = /^[0-9a-f]{16}$/;
/** An account (an ICP principal in text form: lowercase groups joined by dashes). */
const ACCOUNT = /^(?=.{1,64}$)[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY = 86_400_000;

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
};

/** An https link, or undefined. */
export function cleanLink(v: unknown): string | undefined {
  const s = clean(v, LIMITS.link);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks an event from the wire. `from`: who sent it, who must be its
 * organizer. Returns undefined for anything malformed.
 */
export function sanitizeEvent(raw: unknown, from: string): ZEvent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID.test(r.id) || r.organizer !== from) return undefined;
  const title = clean(r.title, LIMITS.title);
  const start = typeof r.start === 'number' && Number.isFinite(r.start) ? r.start : NaN;
  const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : NaN;
  if (!title || !Number.isFinite(start) || !Number.isFinite(updatedAt)) return undefined;
  const end = typeof r.end === 'number' && Number.isFinite(r.end) && r.end > start ? r.end : undefined;
  const invitees = Array.isArray(r.invitees)
    ? [...new Set(r.invitees.filter((a): a is string => typeof a === 'string' && ACCOUNT.test(a) && a !== from))].slice(
        0,
        LIMITS.invitees,
      )
    : [];
  const responses: Record<string, Rsvp> = {};
  if (r.responses && typeof r.responses === 'object') {
    for (const [who, answer] of Object.entries(r.responses as Record<string, unknown>)) {
      if (invitees.includes(who) && RSVPS.includes(answer as Rsvp)) responses[who] = answer as Rsvp;
    }
  }
  const description = clean(r.description, LIMITS.description);
  const location = clean(r.location, LIMITS.location);
  const link = cleanLink(r.link);
  return {
    id: r.id,
    organizer: from,
    title,
    start,
    ...(end ? { end } : {}),
    ...(r.allDay === true ? { allDay: true } : {}),
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(link ? { link } : {}),
    invitees,
    responses,
    updatedAt,
    ...(r.cancelled === true ? { cancelled: true } : {}),
  };
}

/** The event as sent: everything but local settings. */
export function wireEvent(e: ZEvent): ZEvent {
  return {
    id: e.id,
    organizer: e.organizer,
    title: e.title,
    start: e.start,
    ...(e.end ? { end: e.end } : {}),
    ...(e.allDay ? { allDay: true } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.location ? { location: e.location } : {}),
    ...(e.link ? { link: e.link } : {}),
    invitees: e.invitees,
    responses: e.responses,
    updatedAt: e.updatedAt,
    ...(e.cancelled ? { cancelled: true } : {}),
  };
}

/** When the event ends (its end, or an hour after the start; the end of the day when all-day). */
export function eventEnd(e: ZEvent): number {
  return e.end ?? e.start + (e.allDay ? DAY : 3_600_000);
}

/** Events not yet over, soonest first (cancelled ones last). */
export function upcomingEvents(events: ZEvent[], now = Date.now()): ZEvent[] {
  return events
    .filter((e) => eventEnd(e) > now)
    .sort((a, b) => Number(!!a.cancelled) - Number(!!b.cancelled) || a.start - b.start);
}

/** Events that are over, most recent first. */
export function pastEvents(events: ZEvent[], now = Date.now()): ZEvent[] {
  return events.filter((e) => eventEnd(e) <= now).sort((a, b) => b.start - a.start);
}

/** Events I was invited to and haven't answered (not cancelled, not over). */
export function pendingInvites(events: ZEvent[], me: string, now = Date.now()): ZEvent[] {
  return upcomingEvents(events, now).filter((e) => e.organizer !== me && !e.cancelled && !e.responses[me]);
}

/** The local day ("2026-11-26") an event starts on (all-day events by their UTC date). */
export function eventDay(e: ZEvent): string {
  return e.allDay ? new Date(e.start).toISOString().slice(0, 10) : localDay(e.start);
}

export function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The days an event covers (local; all-day events by UTC date), up to 31. */
export function eventDays(e: ZEvent): string[] {
  const fmt = (at: number) => (e.allDay ? new Date(at).toISOString().slice(0, 10) : localDay(at));
  const last = fmt(e.allDay ? eventEnd(e) - DAY : eventEnd(e) - 1);
  const days: string[] = [];
  for (let at = e.start; days.length < 31; at += DAY) {
    const day = fmt(at);
    if (day > last) break;
    if (!days.includes(day)) days.push(day);
  }
  if (!days.includes(last) && days.length < 31) days.push(last);
  return days;
}

/** The weeks of a month (Monday first) as local day strings; days of other months are null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => localDay(new Date(year, month, i + 1).getTime())),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Counts of replies. */
export function rsvpCounts(e: ZEvent): Record<Rsvp | 'waiting', number> {
  const counts = { going: 0, maybe: 0, declined: 0, waiting: 0 };
  for (const who of e.invitees) counts[e.responses[who] ?? 'waiting']++;
  return counts;
}

/** "Thu, Nov 26 · 18:30 – 20:00", "Thu, Nov 26 · All day", across days with both dates. */
export function eventWhen(e: ZEvent, locale?: string): string {
  const date = (at: number) =>
    new Date(at).toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(e.allDay ? { timeZone: 'UTC' } : {}),
    });
  const time = (at: number) => new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (e.allDay) {
    const last = eventEnd(e) - DAY;
    return last > e.start ? `${date(e.start)} – ${date(last)} · All day` : `${date(e.start)} · All day`;
  }
  const end = eventEnd(e);
  if (localDay(end - 1) !== localDay(e.start)) return `${date(e.start)} ${time(e.start)} – ${date(end)} ${time(end)}`;
  return `${date(e.start)} · ${time(e.start)}${e.end ? ` – ${time(end)}` : ''}`;
}

const icsText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (at: number) =>
  new Date(at)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const icsDate = (at: number) => new Date(at).toISOString().slice(0, 10).replace(/-/g, '');

/** Folds a content line at 75 octets, as RFC 5545 asks. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 75;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

/** The event as an iCalendar file, for Google, Apple or Outlook calendars. */
export function toIcs(e: ZEvent, now = Date.now()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenSocial//Events//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${e.id}@opensocial.cc`,
    `DTSTAMP:${icsTime(now)}`,
    ...(e.allDay
      ? [`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(eventEnd(e))}`]
      : [`DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(eventEnd(e))}`]),
    `SUMMARY:${icsText(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.link ? [`URL:${e.link}`] : []),
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
