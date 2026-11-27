/**
 * Reminders while the app is open: at each event's reminder time (minutes
 * before the start, per event on this device) a notice appears, as a system
 * notification when the browser allows it, else inside the app.
 */
import { useEffect, useRef, useState } from 'react';
import { eventWhen, type Reminder, type ZEvent } from '../../core/events/events';

const MAX_DELAY = 2 ** 31 - 1;

export function useEventReminders(events: ZEvent[], reminderOf: (id: string) => Reminder) {
  const [due, setDue] = useState<ZEvent | null>(null);
  const shown = useRef(new Set<string>());

  useEffect(() => {
    const now = Date.now();
    const next = events
      .filter((e) => !e.cancelled && reminderOf(e.id) > 0 && e.start > now)
      .map((e) => ({ e, at: e.start - reminderOf(e.id) * 60_000 }))
      .filter(({ e, at }) => !shown.current.has(`${e.id}:${e.start}`) && at < e.start)
      .sort((a, b) => a.at - b.at)[0];
    if (!next) return;
    const timer = setTimeout(
      () => {
        shown.current.add(`${next.e.id}:${next.e.start}`);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
          new Notification(next.e.title, { body: eventWhen(next.e), tag: `event-${next.e.id}` });
        } else {
          setDue(next.e);
        }
      },
      Math.min(Math.max(0, next.at - now), MAX_DELAY),
    );
    return () => clearTimeout(timer);
  }, [events, reminderOf, due]);

  return { due, dismiss: () => setDue(null) };
}

/** Asks once for permission to show system notifications (from a user action). */
export function askNotificationPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default')
    void Notification.requestPermission();
}
