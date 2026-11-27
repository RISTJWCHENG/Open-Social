/** Icons for the emoji picker's category tabs (original line drawings, 24-unit grid). */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P): P => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  ...p,
});

export const RecentIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const SmileysIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14.2c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
    <circle cx="9.2" cy="9.8" r=".7" fill="currentColor" />
    <circle cx="14.8" cy="9.8" r=".7" fill="currentColor" />
  </svg>
);
export const NatureIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" />
    <path d="M5 19l8-8" />
  </svg>
);
export const FoodIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" />
    <path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16" />
    <path d="M9 3.5c-.6.8-.6 1.7 0 2.5M12.5 3.5c-.6.8-.6 1.7 0 2.5" />
  </svg>
);
export const ActivityIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.1 3.8 8.5s-1.3 6.2-3.8 8.5M12 3.5C9.5 5.8 8.2 8.6 8.2 12s1.3 6.2 3.8 8.5" />
  </svg>
);
export const TravelIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 15.5l1.6-5.2A2 2 0 0 1 7.5 9h9a2 2 0 0 1 1.9 1.3l1.6 5.2v2.5a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1V17H7.5v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <path d="M4 15.5h16" />
    <circle cx="7.5" cy="13" r=".6" fill="currentColor" />
    <circle cx="16.5" cy="13" r=".6" fill="currentColor" />
  </svg>
);
export const ObjectsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 17.5h6M9.5 20.5h5" />
    <path d="M12 3.5a6 6 0 0 0-3.4 10.9c.5.4.9 1 .9 1.6v1.5h5V16c0-.6.4-1.2.9-1.6A6 6 0 0 0 12 3.5z" />
  </svg>
);
export const SymbolsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 19.5s-7-4.3-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.3c0 4.9-7 9.2-7 9.2z" />
  </svg>
);
export const FlagsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 20.5V4" />
    <path d="M6 4.5h10.5l-2 4 2 4H6" />
  </svg>
);
export const StickerTabIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.5 12.5V7A2.5 2.5 0 0 0 17 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h5.5z" />
    <path d="M12.5 19.5v-3a4 4 0 0 1 4-4h3" />
  </svg>
);
