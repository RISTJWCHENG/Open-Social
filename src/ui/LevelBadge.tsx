/**
 * The account level badge shown after a person's name: a scalloped purple
 * seal with a check. Every account starts at level 1 (new member).
 */
import { useId } from 'react';

export const LEVELS: Record<number, string> = { 1: 'New member' };

const SEAL =
  'M10.85 2.50Q12.00 1.60 13.15 2.50Q14.30 3.40 15.75 3.20Q17.20 2.99 17.75 4.35Q18.29 5.71 19.65 6.25Q21.01 6.80 20.80 8.25Q20.60 9.70 21.50 10.85Q22.40 12.00 21.50 13.15Q20.60 14.30 20.80 15.75Q21.01 17.20 19.65 17.75Q18.29 18.29 17.75 19.65Q17.20 21.01 15.75 20.80Q14.30 20.60 13.15 21.50Q12.00 22.40 10.85 21.50Q9.70 20.60 8.25 20.80Q6.80 21.01 6.25 19.65Q5.71 18.29 4.35 17.75Q2.99 17.20 3.20 15.75Q3.40 14.30 2.50 13.15Q1.60 12.00 2.50 10.85Q3.40 9.70 3.20 8.25Q2.99 6.80 4.35 6.25Q5.71 5.71 6.25 4.35Q6.80 2.99 8.25 3.20Q9.70 3.40 10.85 2.50Z';

export function LevelBadge({ level = 1, size = 16 }: { level?: number; size?: number }) {
  const id = useId();
  const label = `Level ${level} · ${LEVELS[level] ?? 'Member'}`;
  return (
    <span className="level-badge" role="img" aria-label={label} title={label}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable={false}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a48bf5" />
            <stop offset="1" stopColor="#7457e3" />
          </linearGradient>
        </defs>
        <path d={SEAL} fill={`url(#${id})`} />
        <path
          d="m8.1 12.3 2.6 2.6 5.3-5.6"
          fill="none"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
