/**
 * Events in the left column: a month calendar (days with events marked) over
 * Upcoming / Invites / Past lists grouped by day. Picking a day shows that
 * day's events; + starts a new event.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  eventDay,
  eventDays,
  eventWhen,
  localDay,
  monthGrid,
  pastEvents,
  pendingInvites,
  upcomingEvents,
  type ZEvent,
} from '../../core/events/events';
import { PlusIcon } from '../icons';
import { dayHeading, myStatus } from './eventUi';

type Tab = 'upcoming' | 'invites' | 'past';

interface Props {
  events: ZEvent[];
  me: string;
  selectedId: string | null;
  onSelect(id: string): void;
  /** New event (on the chosen day, if any). */
  onNew(day?: string): void;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function EventsPanel({ events, me, selectedId, onSelect, onNew }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [day, setDay] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');

  const marked = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) if (!e.cancelled) for (const d of eventDays(e)) m.set(d, (m.get(d) ?? 0) + 1);
    return m;
  }, [events]);
  const invites = useMemo(() => pendingInvites(events, me, now), [events, me, now]);
  const list = useMemo(() => {
    if (day) return events.filter((e) => eventDays(e).includes(day)).sort((a, b) => a.start - b.start);
    if (tab === 'invites') return invites;
    return tab === 'past' ? pastEvents(events, now) : upcomingEvents(events, now);
  }, [events, day, tab, invites, now]);
  const groups = useMemo(() => {
    const g: { day: string; items: ZEvent[] }[] = [];
    for (const e of list) {
      const d = eventDay(e);
      const last = g.at(-1);
      if (last?.day === d) last.items.push(e);
      else g.push({ day: d, items: [e] });
    }
    return g;
  }, [list]);

  const weeks = monthGrid(month.y, month.m);
  const today = localDay(now);
  const title = new Date(month.y, month.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shift = (n: number) =>
    setMonth(({ y, m }) => {
      const d = new Date(y, m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <section className="chat-list events-panel" aria-label="Events">
      <div className="chat-list-header">
        <h2>Events</h2>
        <button
          type="button"
          className="plus-btn"
          aria-label="New event"
          title="New event"
          onClick={() => onNew(day ?? undefined)}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="ev-month" aria-label="Calendar">
        <div className="ev-month-head">
          <button type="button" className="ev-month-nav" aria-label="Previous month" onClick={() => shift(-1)}>
            ‹
          </button>
          <span className="ev-month-title">{title}</span>
          <button type="button" className="ev-month-nav" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </button>
        </div>
        <div className="ev-grid" role="grid">
          <div className="ev-row" role="row">
            {WEEKDAYS.map((w) => (
              <span key={w} className="ev-weekday" role="columnheader">
                {w}
              </span>
            ))}
          </div>
          {weeks.map((week, i) => (
            <div key={i} className="ev-row" role="row">
              {week.map((d, j) =>
                d ? (
                  <button
                    key={d}
                    type="button"
                    role="gridcell"
                    className={`ev-day${d === today ? ' is-today' : ''}${d === day ? ' is-picked' : ''}${
                      marked.has(d) ? ' has-events' : ''
                    }`}
                    aria-pressed={d === day}
                    aria-label={`${dayHeading(d, now)}${marked.has(d) ? `, ${marked.get(d)} event${marked.get(d)! > 1 ? 's' : ''}` : ''}`}
                    onClick={() => setDay(d === day ? null : d)}
                  >
                    {Number(d.slice(8))}
                  </button>
                ) : (
                  <span key={`x${j}`} className="ev-day is-blank" role="gridcell" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      {day ? (
        <div className="ev-picked">
          <span>{dayHeading(day, now)}</span>
          <button type="button" className="link-btn" onClick={() => setDay(null)}>
            Show all
          </button>
        </div>
      ) : (
        <div className="contacts-tabs" role="tablist" aria-label="Show">
          {(
            [
              ['upcoming', 'Upcoming'],
              ['invites', 'Invites'],
              ['past', 'Past'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="contacts-tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
              {id === 'invites' && invites.length > 0 && <span className="ev-count">{invites.length}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="ev-list">
        {groups.map((g) => (
          <div key={g.day} className="ev-group">
            <p className="ev-group-day">{dayHeading(g.day, now)}</p>
            {g.items.map((e) => {
              const status = myStatus(e, me);
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`ev-row-item${e.id === selectedId ? ' active' : ''}${e.cancelled ? ' is-cancelled' : ''}`}
                  aria-current={e.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(e.id)}
                >
                  <span className="ev-row-when">{eventWhen(e).split(' · ').slice(1).join(' · ') || 'All day'}</span>
                  <span className="ev-row-title">{e.title}</span>
                  {e.location && <span className="ev-row-where">{e.location}</span>}
                  <span className={`ev-status is-${status.tone}`}>{status.label}</span>
                </button>
              );
            })}
          </div>
        ))}
        {!groups.length && (
          <div className="ev-empty">
            <p>
              {day
                ? 'Nothing on this day.'
                : tab === 'invites'
                  ? 'No invites waiting for an answer.'
                  : tab === 'past'
                    ? 'No past events.'
                    : 'No upcoming events.'}
            </p>
            {tab === 'upcoming' || day ? (
              <button type="button" className="pill-btn" onClick={() => onNew(day ?? undefined)}>
                New event
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
