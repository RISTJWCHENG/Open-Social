/**
 * New or edit event, in the main area: title, all day or start and end
 * times, location, online link, description, friends to invite and this
 * device's reminder.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { cleanLink, LIMITS, REMINDER_LABELS, REMINDERS, type Reminder, type ZEvent } from '../../core/events/events';
import type { EventInput } from '../../core/delivery/realMessaging';
import { Avatar } from '../Avatar';
import { BackIcon, SearchIcon } from '../icons';
import { fromInputs, toInputs, utcDayStart } from './eventUi';

export interface Friend {
  account: string;
  name: string;
  avatar?: string;
}

interface Props {
  /** The event being edited, or none for a new one. */
  event?: ZEvent;
  /** For a new event: the day picked in the calendar ("2026-12-05"). */
  day?: string;
  friends: Friend[];
  reminder: Reminder;
  onSave(input: EventInput, reminder: Reminder): Promise<void>;
  onCancel(): void;
}

const DAY = 86_400_000;

/** Defaults for a new event: the next whole hour (on the picked day), one hour long. */
function defaults(day?: string) {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const start = day ? { date: day, time: toInputs(d.getTime()).time } : toInputs(d.getTime());
  // One hour later, which may be the next day (a 23:00 start ends at 00:00 the day after).
  const end = toInputs(fromInputs(start.date, start.time) + 3_600_000);
  return { start, end };
}

export function EventEditor({ event, day, friends, reminder: initialReminder, onSave, onCancel }: Props) {
  const init = useMemo(() => {
    if (!event) return { ...defaults(day), allDay: false };
    if (event.allDay) {
      const s = new Date(event.start).toISOString().slice(0, 10);
      const e = new Date((event.end ?? event.start + DAY) - DAY).toISOString().slice(0, 10);
      return { start: { date: s, time: '09:00' }, end: { date: e, time: '10:00' }, allDay: true };
    }
    return { start: toInputs(event.start), end: toInputs(event.end ?? event.start + 3_600_000), allDay: false };
  }, [event, day]);

  const [title, setTitle] = useState(event?.title ?? '');
  const [allDay, setAllDay] = useState(init.allDay);
  const [startDate, setStartDate] = useState(init.start.date);
  const [startTime, setStartTime] = useState(init.start.time);
  const [endDate, setEndDate] = useState(init.end.date);
  const [endTime, setEndTime] = useState(init.end.time);
  const [location, setLocation] = useState(event?.location ?? '');
  const [link, setLink] = useState(event?.link ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [invitees, setInvitees] = useState<string[]>(event?.invitees ?? []);
  const [reminder, setReminder] = useState<Reminder>(initialReminder);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return friends.filter((f) => !q || f.name.toLowerCase().includes(q) || f.account.includes(q));
  }, [friends, query]);

  const toggle = (account: string) =>
    setInvitees((list) => (list.includes(account) ? list.filter((a) => a !== account) : [...list, account]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const start = allDay ? utcDayStart(startDate) : fromInputs(startDate, startTime);
    const end = allDay ? utcDayStart(endDate) + DAY : fromInputs(endDate, endTime);
    if (!title.trim()) return setError('Give the event a title.');
    if (!Number.isFinite(start)) return setError('Choose when it starts.');
    if (!Number.isFinite(end) || end <= start) return setError('The end must be after the start.');
    if (link.trim() && !cleanLink(link)) return setError('The online link must start with https://');
    setBusy(true);
    try {
      await onSave(
        {
          title: title.trim(),
          start,
          end,
          ...(allDay ? { allDay: true } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(link.trim() ? { link: cleanLink(link)! } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          invitees,
        },
        reminder,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event could not be saved.');
      setBusy(false);
    }
  };

  return (
    <main className="chat-main ev-main" aria-label={event ? 'Edit event' : 'New event'}>
      <header className="ev-bar">
        <button type="button" className="hdr-btn back" onClick={onCancel} aria-label="Back to events">
          <BackIcon />
        </button>
        <h2>{event ? 'Edit event' : 'New event'}</h2>
      </header>
      <form className="ev-form" onSubmit={(e) => void submit(e)}>
        <label className="ev-field">
          <span>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={LIMITS.title}
            placeholder="e.g. Launch party"
            required
            autoFocus
          />
        </label>

        <label className="ev-switch">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span>All day</span>
        </label>

        <div className="ev-when">
          <label className="ev-field">
            <span>Starts</span>
            <span className="ev-pair">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate < e.target.value) setEndDate(e.target.value);
                }}
                required
              />
              {!allDay && (
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              )}
            </span>
          </label>
          <label className="ev-field">
            <span>Ends</span>
            <span className="ev-pair">
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
              {!allDay && <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />}
            </span>
          </label>
        </div>
        <p className="ev-hint">Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>

        <label className="ev-field">
          <span>Location</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={LIMITS.location}
            placeholder="Address or place (optional)"
          />
        </label>
        <label className="ev-field">
          <span>Online link</span>
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            maxLength={LIMITS.link}
            placeholder="https://… (optional)"
          />
        </label>
        <label className="ev-field">
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={LIMITS.description}
            rows={4}
            placeholder="What to expect, what to bring (optional)"
          />
        </label>

        <fieldset className="ev-field ev-invite">
          <legend>
            Invite friends <span className="ev-hint">{invitees.length} selected</span>
          </legend>
          {friends.length > 0 ? (
            <>
              <label className="search-box ev-invite-search">
                <SearchIcon />
                <span className="sr-only">Search friends</span>
                <input
                  type="search"
                  placeholder="Search friends..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <ul className="ev-invite-list">
                {shown.map((f) => (
                  <li key={f.account}>
                    <label className={`ev-invite-row${invitees.includes(f.account) ? ' is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={invitees.includes(f.account)}
                        onChange={() => toggle(f.account)}
                      />
                      <Avatar name={f.name} src={f.avatar} seed={f.account} className="avatar-32" />
                      <span>{f.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="ev-hint">
              Add friends in Contacts to invite them. You can still save the event for yourself.
            </p>
          )}
        </fieldset>

        <label className="ev-field">
          <span>Remind me</span>
          <select value={reminder} onChange={(e) => setReminder(Number(e.target.value) as Reminder)}>
            {REMINDERS.map((r) => (
              <option key={r} value={r}>
                {REMINDER_LABELS[r]}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="ev-error" role="alert">
            {error}
          </p>
        )}
        <div className="ev-form-actions">
          <button type="button" className="ev-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="ev-btn is-primary" disabled={busy}>
            {busy ? 'Saving…' : event ? 'Save changes' : invitees.length ? 'Create and invite' : 'Create event'}
          </button>
        </div>
      </form>
    </main>
  );
}
