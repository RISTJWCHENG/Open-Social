/**
 * An event in the main area: date, title, when, where, online link and
 * description; replies (with buttons for invitees); guests; this device's
 * reminder; add to calendar; and for the organizer edit, cancel and delete.
 */
import { useState } from 'react';
import {
  eventWhen,
  REMINDER_LABELS,
  REMINDERS,
  RSVP_LABELS,
  RSVPS,
  rsvpCounts,
  toIcs,
  type Reminder,
  type Rsvp,
  type ZEvent,
} from '../../core/events/events';
import { Avatar } from '../Avatar';
import { BackIcon, ExternalLinkIcon, MapPinIcon } from '../icons';
import { dateTile, downloadIcs, myStatus, type PeopleLookup } from './eventUi';

interface Props {
  event: ZEvent | null;
  me: string;
  people: PeopleLookup;
  reminder: Reminder;
  onReminder(r: Reminder): void;
  onRespond(r: Rsvp): Promise<void>;
  onEdit(): void;
  onCancelEvent(): Promise<void>;
  onDelete(): Promise<void>;
  onOpenChat(account: string): void;
  onBack(): void;
  onNew(): void;
}

export function EventDetail(p: Props) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const e = p.event;

  if (!e) {
    return (
      <main className="chat-main chat-empty" aria-label="No event open">
        <div className="chat-empty-inner">
          <h2>Events</h2>
          <p>
            Plan something with friends: pick a time and place, invite them, and see who's coming. Everything is
            end-to-end encrypted.
          </p>
          <button type="button" className="pill-btn" onClick={p.onNew}>
            New event
          </button>
        </div>
      </main>
    );
  }

  const mine = e.organizer === p.me;
  const tile = dateTile(e);
  const counts = rsvpCounts(e);
  const status = myStatus(e, p.me);
  const organizer = p.people(e.organizer);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <main className="chat-main ev-main" aria-label={e.title}>
      <header className="ev-bar">
        <button type="button" className="hdr-btn back" onClick={p.onBack} aria-label="Back to events">
          <BackIcon />
        </button>
        <span className={`ev-status is-${status.tone}`}>{status.label}</span>
      </header>
      <div className="ev-detail">
        <div className="ev-hero">
          <span className={`ev-tile${e.cancelled ? ' is-cancelled' : ''}`} aria-hidden="true">
            <span>{tile.month}</span>
            <strong>{tile.day}</strong>
          </span>
          <div className="ev-hero-text">
            <h1 className={e.cancelled ? 'is-cancelled' : ''}>{e.title}</h1>
            <p className="ev-when-line">{eventWhen(e)}</p>
            {e.cancelled && <p className="ev-cancelled-note">This event was cancelled.</p>}
          </div>
        </div>

        {(e.location || e.link) && (
          <div className="ev-facts">
            {e.location && (
              <p className="ev-fact">
                <MapPinIcon />
                <span>{e.location}</span>
                <a
                  className="link-btn"
                  href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(e.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Map
                </a>
              </p>
            )}
            {e.link && (
              <a className="ev-btn is-primary ev-join" href={e.link} target="_blank" rel="noopener noreferrer">
                Join online
                <ExternalLinkIcon />
              </a>
            )}
          </div>
        )}

        {e.description && <p className="ev-description">{e.description}</p>}

        <section className="ev-section" aria-label="Your reply">
          {!mine && !e.cancelled && e.invitees.includes(p.me) && (
            <>
              <h3>Are you going?</h3>
              <div className="ev-rsvp" role="group" aria-label="Your reply">
                {RSVPS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`ev-rsvp-btn is-${r}`}
                    aria-pressed={e.responses[p.me] === r}
                    disabled={busy}
                    onClick={() => void run(() => p.onRespond(r))}
                  >
                    {RSVP_LABELS[r]}
                  </button>
                ))}
              </div>
            </>
          )}
          <label className="ev-field ev-reminder">
            <span>Remind me</span>
            <select value={p.reminder} onChange={(ev) => p.onReminder(Number(ev.target.value) as Reminder)}>
              {REMINDERS.map((r) => (
                <option key={r} value={r}>
                  {REMINDER_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="ev-section" aria-label="Guests">
          <h3>Guests</h3>
          <p className="ev-counts">
            {counts.going} going · {counts.maybe} maybe · {counts.declined} can't go
            {counts.waiting ? ` · ${counts.waiting} not answered` : ''}
          </p>
          <ul className="ev-guests">
            <li className="ev-guest">
              <Avatar name={organizer.name} src={organizer.avatar} seed={e.organizer} className="avatar-32" />
              <span className="ev-guest-name">{organizer.name}</span>
              <span className="ev-status is-organizer">Organizer</span>
            </li>
            {e.invitees.map((a) => {
              const who = p.people(a);
              const r = e.responses[a];
              return (
                <li key={a} className="ev-guest">
                  <Avatar name={who.name} src={who.avatar} seed={a} className="avatar-32" />
                  <span className="ev-guest-name">{who.name}</span>
                  <span className={`ev-status is-${r ?? 'invited'}`}>{r ? RSVP_LABELS[r] : 'Invited'}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="ev-actions">
          <button type="button" className="ev-btn" onClick={() => downloadIcs(e.title, toIcs(e))}>
            Add to calendar (.ics)
          </button>
          {!mine && (
            <button type="button" className="ev-btn" onClick={() => p.onOpenChat(e.organizer)}>
              Message organizer
            </button>
          )}
          {mine && !e.cancelled && (
            <button type="button" className="ev-btn" onClick={p.onEdit}>
              Edit
            </button>
          )}
          {mine && !e.cancelled && (
            <button type="button" className="ev-btn is-danger" onClick={() => setConfirm('cancel')}>
              Cancel event
            </button>
          )}
          <button type="button" className="ev-btn is-danger" onClick={() => setConfirm('delete')}>
            {mine ? 'Delete' : 'Remove from my events'}
          </button>
        </div>
        {confirm && (
          <div className="ev-confirm" role="alertdialog" aria-label="Confirm">
            <p>
              {confirm === 'cancel'
                ? 'Cancel this event for everyone invited?'
                : mine && !e.cancelled
                  ? 'Delete this event? Everyone invited will see it as cancelled.'
                  : 'Remove this event from this device?'}
            </p>
            <div className="ev-form-actions">
              <button type="button" className="ev-btn" onClick={() => setConfirm(null)} disabled={busy}>
                Keep it
              </button>
              <button
                type="button"
                className="ev-btn is-danger-solid"
                disabled={busy}
                onClick={() => void run(confirm === 'cancel' ? p.onCancelEvent : p.onDelete)}
              >
                {confirm === 'cancel' ? 'Cancel event' : 'Delete'}
              </button>
            </div>
          </div>
        )}
        <p className="ev-privacy">Shared only with the people invited, end-to-end encrypted.</p>
      </div>
    </main>
  );
}
