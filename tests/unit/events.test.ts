import { describe, expect, it } from 'vitest';
import {
  eventDays,
  monthGrid,
  pastEvents,
  pendingInvites,
  rsvpCounts,
  sanitizeEvent,
  toIcs,
  upcomingEvents,
  wireEvent,
  type ZEvent,
} from '../../src/core/events/events';

const ORG = 'aaaaa-bbbbb-ccccc-ddddd-eee';
const BOB = 'fffff-ggggg-hhhhh-iiiii-jjj';
const ev = (over: Partial<ZEvent> = {}): ZEvent => ({
  id: '0123456789abcdef',
  organizer: ORG,
  title: 'Launch party',
  start: Date.UTC(2026, 11, 5, 18),
  invitees: [BOB],
  responses: {},
  updatedAt: 1,
  ...over,
});

describe('events', () => {
  it('accepts only well-formed events from their organizer', () => {
    const raw = {
      ...ev(),
      title: '  Launch  ',
      link: 'http://x.example',
      responses: { [BOB]: 'going', 'zzzzz-zzzzz': 'going' },
      invitees: [BOB, BOB, ORG, 'Bad!'],
      end: 0,
    };
    const e = sanitizeEvent(raw, ORG)!;
    expect(e.title).toBe('Launch');
    expect(e.invitees).toEqual([BOB]);
    expect(e.responses).toEqual({ [BOB]: 'going' });
    expect(e.link).toBeUndefined();
    expect(e.end).toBeUndefined();
    expect(sanitizeEvent(raw, BOB)).toBeUndefined();
    expect(sanitizeEvent({ ...raw, id: 'x' }, ORG)).toBeUndefined();
    expect(sanitizeEvent({ ...raw, title: ' ' }, ORG)).toBeUndefined();
    expect(sanitizeEvent({ ...ev(), link: 'https://meet.example/abc' }, ORG)!.link).toBe('https://meet.example/abc');
  });

  it('sorts upcoming, past and pending invites', () => {
    const now = Date.UTC(2026, 11, 1);
    const soon = ev({ id: '1'.repeat(16), start: now + 3_600_000 });
    const later = ev({ id: '2'.repeat(16), start: now + 86_400_000 });
    const over = ev({ id: '3'.repeat(16), start: now - 86_400_000 });
    const answered = ev({ id: '4'.repeat(16), start: now + 7_200_000, responses: { [BOB]: 'maybe' } });
    const all = [later, over, soon, answered];
    expect(upcomingEvents(all, now).map((e) => e.id)).toEqual([soon.id, answered.id, later.id]);
    expect(pastEvents(all, now)).toEqual([over]);
    expect(pendingInvites(all, BOB, now).map((e) => e.id)).toEqual([soon.id, later.id]);
    expect(pendingInvites(all, ORG, now)).toEqual([]);
    expect(rsvpCounts(answered)).toEqual({ going: 0, maybe: 1, declined: 0, waiting: 0 });
  });

  it('lays out a month and the days an event covers', () => {
    const weeks = monthGrid(2026, 11); // December 2026 starts on a Tuesday
    expect(weeks[0]![0]).toBeNull();
    expect(weeks[0]![1]).toBe('2026-12-01');
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    const allDay = ev({ allDay: true, start: Date.UTC(2026, 11, 5), end: Date.UTC(2026, 11, 8) });
    expect(eventDays(allDay)).toEqual(['2026-12-05', '2026-12-06', '2026-12-07']);
  });

  it('exports iCalendar with escaped text and no local settings on the wire', () => {
    const e = ev({ description: 'Bring snacks, drinks; and friends\nSee you', location: '100 Main Street, Portland' });
    const raw = toIcs(e, Date.UTC(2026, 10, 26));
    expect(raw.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const ics = raw.replace(/\r\n /g, '');
    expect(ics).toContain('UID:0123456789abcdef@opensocial.cc');
    expect(ics).toContain('DTSTART:20261205T180000Z');
    expect(ics).toContain('DTEND:20261205T190000Z');
    expect(ics).toContain('DESCRIPTION:Bring snacks\\, drinks\\; and friends\\nSee you');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(Object.keys(wireEvent({ ...e, remind: 15 } as ZEvent))).not.toContain('remind');
  });
});
