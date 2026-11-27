/** Labels for the day markers between messages: Today, Yesterday, a weekday, or a date. */

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Whether two times fall on different calendar days (local time). */
export function isNewDay(prev: number | undefined, ts: number): boolean {
  return prev === undefined || startOfDay(prev) !== startOfDay(ts);
}

/** "Today", "Yesterday", the weekday within the last week, else the date (with the year when not this year). */
export function dayLabel(ts: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const d = new Date(ts);
  if (days > 1 && days < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${weekday} ${d.getDate()} ${month}${year}`;
}
