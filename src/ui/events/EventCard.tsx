/**
 * An event invite in a chat bubble: date tile, title, when and where, the
 * current replies, and (for invitees) Going / Maybe / Can't go buttons.
 */
import { eventWhen, RSVP_LABELS, RSVPS, rsvpCounts, type Rsvp, type ZEvent } from '../../core/events/events';
import { dateTile } from './eventUi';

interface Props {
  event: ZEvent | undefined;
  me: string;
  onRespond(r: Rsvp): void;
  onOpen(): void;
}

export function EventCard({ event: e, me, onRespond, onOpen }: Props) {
  if (!e) return <p className="ev-card is-gone">This event is no longer available.</p>;
  const tile = dateTile(e);
  const counts = rsvpCounts(e);
  const invited = e.organizer !== me && e.invitees.includes(me) && !e.cancelled;
  return (
    <div className={`ev-card${e.cancelled ? ' is-cancelled' : ''}`}>
      <button type="button" className="ev-card-main" onClick={onOpen} aria-label={`Open event ${e.title}`}>
        <span className="ev-tile is-small" aria-hidden="true">
          <span>{tile.month}</span>
          <strong>{tile.day}</strong>
        </span>
        <span className="ev-card-text">
          <span className="ev-card-kicker">{e.cancelled ? 'Cancelled event' : 'Event'}</span>
          <span className="ev-card-title">{e.title}</span>
          <span className="ev-card-when">{eventWhen(e)}</span>
          {e.location && <span className="ev-card-where">{e.location}</span>}
          <span className="ev-card-counts">
            {counts.going} going{counts.maybe ? ` · ${counts.maybe} maybe` : ''}
          </span>
        </span>
      </button>
      {invited && (
        <div className="ev-card-rsvp" role="group" aria-label="Your reply">
          {RSVPS.map((r) => (
            <button
              key={r}
              type="button"
              className={`ev-rsvp-btn is-${r}`}
              aria-pressed={e.responses[me] === r}
              onClick={() => onRespond(r)}
            >
              {RSVP_LABELS[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
