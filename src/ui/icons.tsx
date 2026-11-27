/** Inline SVG icons. Decorative unless the caller passes a label and role. */
import { useId, type SVGProps } from 'react';
import { siBitcoin } from 'simple-icons';

type P = SVGProps<SVGSVGElement>;

const base = (props: P, size = 20, strokeWidth = 1.8) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...props,
});

export const MenuIcon = (p: P) => (
  <svg {...base(p, 22)}>
    <path d="M3 4.5h18M3 9.5h18M3 14.5h18M3 19.5h18" />
  </svg>
);
export const SignInIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <path d="m10 17 5-5-5-5M15 12H3" />
  </svg>
);
export const SignOutIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </svg>
);
/** The Chats button in the rail: a speech bubble with three bold dots. */
/**
 * The Chats rail icon: two overlapping speech bubbles, the front one with
 * three dots, traced from the OpenSocial design (drawn in a 264 x 236 box).
 * The back bubble is hidden behind the front one with a small gap.
 */
const CHAT_FRONT =
  'M27.5 61A32 32 0 0 1 59.5 29H150A32 32 0 0 1 182 61V109.5A32 32 0 0 1 150 141.5H103L63.5 177V141.5H59.5A32 32 0 0 1 27.5 109.5Z';
const CHAT_BACK =
  'M112.5 110.5A32 32 0 0 1 144.5 78.5H209.5A32 32 0 0 1 241.5 110.5V151A32 32 0 0 1 209.5 183V213L174 183H144.5A32 32 0 0 1 112.5 151Z';
export function ChatsRailIcon(p: P) {
  // useId() may contain characters that url(#…) does not accept.
  const id = `chats${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg {...base(p, 22, 19.05)} stroke="none" viewBox="8 -3 254 254">
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: railColor('chat-a') }} />
          <stop offset="1" style={{ stopColor: railColor('chat-b') }} />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: railColor('chat-c') }} />
          <stop offset="0.55" style={{ stopColor: railColor('chat-d') }} />
          <stop offset="1" style={{ stopColor: railColor('chat-e') }} />
        </linearGradient>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="270" height="250">
          <rect width="270" height="250" fill="#fff" />
          <path d={CHAT_FRONT} fill="#000" stroke="#000" strokeWidth={25.05} />
        </mask>
      </defs>
      <path d={CHAT_BACK} stroke={`url(#${id}b)`} mask={`url(#${id}m)`} />
      <path d={CHAT_FRONT} stroke={`url(#${id}f)`} />
      <g style={{ fill: railColor('dot') }}>
        <circle cx="72.6" cy="84.5" r="9.5" />
        <circle cx="106" cy="84.5" r="9.5" />
        <circle cx="139.2" cy="84.5" r="9.5" />
      </g>
    </svg>
  );
}
/*
 * Rail icons from the OpenSocial design. Each colour is a CSS variable that
 * falls back to the icon colour: grey in the rail at rest, the design's navy
 * and purples while hovered or selected (set in styles.css).
 */
const railColor = (name: string) => `var(--rail-${name}, currentColor)`;
const RAIL_INK = { stroke: railColor('ink') };
const RAIL_PURPLE = { stroke: railColor('purple') };
const RAIL_LILAC = { stroke: railColor('lilac') };

export const ContactsBookIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_INK}>
    {/* An index card: A, a dot and Z down the side, a line beside each. */}
    <rect x="3" y="3" width="18" height="18" rx="4.6" />
    <path d="M5.6 9.6 7.3 5.4 9 9.6M6.2 8.2h2.2M5.8 14.6h3.1l-3.1 4h3.1" />
    <circle cx="7.4" cy="12.1" r="0.95" stroke="none" style={{ fill: railColor('ink') }} />
    <path d="M11.6 7.5h6M11.6 12.1h6M11.6 16.6h6" />
  </svg>
);

export const NetworkIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_INK}>
    <path d="M12.0 5.8L12.0 18.2M17.4 8.9L6.6 15.1M17.4 15.1L6.6 8.9" style={RAIL_LILAC} />
    <path d="M13.5 4.3L17.9 6.8M19.4 9.5L19.4 14.5M17.9 17.2L13.5 19.7M10.5 19.7L6.1 17.2M4.6 14.5L4.6 9.5M6.1 6.8L10.5 4.3" />
    <circle cx="12.0" cy="3.4" r="1.75" /><circle cx="19.4" cy="7.7" r="1.75" /><circle cx="19.4" cy="16.3" r="1.75" /><circle cx="12.0" cy="20.6" r="1.75" /><circle cx="4.6" cy="16.3" r="1.75" /><circle cx="4.6" cy="7.7" r="1.75" />
  </svg>
);

export const CircleIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_INK}>
    {/* Two dashes between each pair of people. */}
    <path d="M15.51 3.90A9.1 9.1 0 0 1 18.90 6.37M21.07 13.04A9.1 9.1 0 0 1 19.77 17.03M14.10 21.15A9.1 9.1 0 0 1 9.90 21.15M4.23 17.03A9.1 9.1 0 0 1 2.93 13.04M5.10 6.37A9.1 9.1 0 0 1 8.49 3.90" style={RAIL_PURPLE} strokeDasharray="0.25 3.74" />
    <circle cx="12.0" cy="3.2" r="2.0" /><circle cx="20.7" cy="9.5" r="2.0" /><circle cx="17.3" cy="19.7" r="2.0" /><circle cx="6.7" cy="19.7" r="2.0" /><circle cx="3.3" cy="9.5" r="2.0" />
  </svg>
);

export const NewsIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_INK}>
    {/* An N whose left stem is a page with three lines of text. */}
    <path d="M20.5 3v18L9.7 3H5.4a1.9 1.9 0 0 0-1.9 1.9v14.2a1.9 1.9 0 0 0 1.9 1.9h2.4a1.9 1.9 0 0 0 1.9-1.9V3" />
    <path d="M5.6 10h2.1M5.6 12.6h2.1M5.6 15.2h2.1" style={RAIL_LILAC} />
  </svg>
);

export const CoffeeIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_INK}>
    <path d="M7 6.5c-.9-.8-.9-1.5 0-2.2s.9-1.4 0-2.1M10.2 6.5c-.9-.8-.9-1.5 0-2.2s.9-1.4 0-2.1" />
    <path d="M13.4 6.5c-.9-.8-.9-1.5 0-2.2s.9-1.4 0-2.1" style={RAIL_LILAC} />
    <path d="M3.5 9.5h13.5v2.7a6.75 6.75 0 0 1-13.5 0z" />
    <path d="M17 11h1.2a2.6 2.6 0 0 1 0 5.2h-2" />
    <path d="M3 21.2h15" />
  </svg>
);

export const SpaceIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_INK}>
    {/* A personal space: a rounded frame with a four-point sparkle and a small star. */}
    <rect x="3" y="3" width="18" height="18" rx="4.6" />
    <path d="M10.4 8.2c.5 2.4 1.4 3.3 3.8 3.8-2.4.5-3.3 1.4-3.8 3.8-.5-2.4-1.4-3.3-3.8-3.8 2.4-.5 3.3-1.4 3.8-3.8z" style={RAIL_PURPLE} />
    <circle cx="16.6" cy="7.4" r="0.9" stroke="none" style={{ fill: railColor('lilac') }} />
  </svg>
);

export const MarketIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_INK}>
    {/* A shopping cart: handle, basket, two wheels; a lilac line inside the basket. */}
    <path d="M2.5 3.5h2.4l2.2 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2l1.6-6.6H6" />
    <path d="M9.2 11.6h8.2" style={RAIL_LILAC} />
    <circle cx="9.4" cy="19.6" r="1.5" />
    <circle cx="17" cy="19.6" r="1.5" style={RAIL_PURPLE} />
  </svg>
);

export const CalendarIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_INK}>
    <rect x="3" y="4.5" width="18" height="17" rx="3.2" />
    <path d="M3 9.2h18M8 2.5v4M16 2.5v4" />
    <g stroke="none" style={{ fill: railColor('lilac') }}>
      {[7.6, 10.6, 13.6].flatMap((x) =>
        [12.6, 15.4, 18.2].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.95" />),
      )}
    </g>
    <g stroke="none" style={{ fill: railColor('purple') }}>
      {[12.6, 15.4, 18.2].map((y) => (
        <circle key={y} cx="16.6" cy={y} r="1.05" />
      ))}
    </g>
  </svg>
);

export const IdeaIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_INK}>
    <path d="M12 1v1.6M4.9 3.6l1.1 1.1M19.1 3.6 18 4.7M1.8 9.6h1.6M20.6 9.6h1.6" />
    <path d="M9.2 16.2c-.4-1.8-3.2-3.2-3.2-6.4a6 6 0 0 1 12 0c0 3.2-2.8 4.6-3.2 6.4z" />
    <path d="M9.4 18.6h5.2M10.6 21.2h2.8" style={RAIL_PURPLE} />
  </svg>
);

export const LayersIcon = (p: P) => (
  <svg {...base(p, 22)} style={RAIL_PURPLE}>
    <path d="M12 3.2 20.5 8 12 12.8 3.5 8z" style={{ stroke: railColor('layer') }} />
    <path d="m3.5 12.2 8.5 4.8 8.5-4.8" style={RAIL_LILAC} />
    <path d="m3.5 16.4 8.5 4.8 8.5-4.8" />
  </svg>
);

export const ChatsIcon = (p: P) => (
  <svg {...base(p, 22)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
export const ZapIcon = (p: P) => (
  <svg {...base(p, 22)}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);
/**
 * A handset with two sound waves, traced from the OpenSocial design (drawn in
 * a 1254 x 1254 box). Line weights are set to match the other icons at 22px.
 */
export const PhoneIcon = (p: P) => (
  <svg {...base(p, 22)} viewBox="74.5 99.5 1070 1070">
    <path strokeWidth={80.25} d="M249 200C242 206 231 218 223 227C215 236 209 243 202 255C195 267 185 285 179 297C173 309 171 316 168 327C165 338 162 351 161 362C160 373 160 382 160 392C160 402 162 411 163 421C164 431 166 439 169 451C172 463 176 477 180 491C184 505 192 525 196 536C200 547 198 544 205 557C212 570 225 596 236 616C247 636 259 654 272 674C285 694 298 713 313 733C328 753 345 775 360 793C375 811 383 822 404 843C425 864 464 902 485 922C506 942 517 950 533 962C549 974 564 985 580 996C596 1007 615 1018 630 1027C645 1036 658 1042 670 1048C682 1054 690 1057 702 1062C714 1067 729 1072 743 1076C757 1080 774 1084 785 1086C796 1088 801 1088 810 1089C819 1090 830 1090 841 1090C852 1090 863 1089 875 1086C887 1083 903 1078 914 1074C925 1070 932 1066 941 1061C950 1056 961 1050 971 1042C981 1034 991 1027 1002 1016C1013 1005 1031 984 1038 976C1045 968 1042 970 1043 966C1044 962 1046 955 1047 949C1048 943 1048 936 1047 928C1046 920 1046 911 1044 900C1042 889 1038 873 1034 862C1030 851 1024 840 1019 833C1014 826 1009 822 1002 818C995 814 994 812 976 807C958 802 921 794 895 787C869 780 836 768 820 763C804 758 803 760 797 760C791 760 787 762 782 764C777 766 780 761 767 772C754 783 717 821 705 832C693 843 698 836 693 836C688 836 680 837 673 835C666 833 664 833 653 826C642 819 620 804 604 792C588 780 575 769 560 755C545 741 526 722 513 708C500 694 490 683 480 670C470 657 461 646 450 630C439 614 423 589 415 574C407 559 404 551 402 542C400 533 401 524 401 519C401 514 394 520 404 510C414 500 448 468 459 456C470 444 468 443 470 437C472 431 474 427 474 422C474 417 483 439 473 407C463 375 425 260 414 229C403 198 412 223 409 219C406 215 402 209 397 205C392 201 384 197 377 194C370 191 363 188 352 186C341 184 322 180 311 179C300 178 289 178 283 178C277 178 280 178 277 180C274 182 268 185 263 188C258 191 256 194 249 200Z" />
    {/* Two sound waves around one centre, clear of the handset. */}
    <g strokeWidth={80.25}>
      <path d="M675 423A200 200 0 0 1 837 585" />
      <path d="M704 256A370 370 0 0 1 1004 556" />
    </g>
  </svg>
);
export const SettingsIcon = (p: P) => (
  <svg {...base(p, 22)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base(p, 18, 2)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base(p, 16, 2)}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);
/** Envelope in the same box and stroke as SearchIcon, sized to look as large. */
export const MailIcon = (p: P) => (
  <svg {...base(p, 16, 2)}>
    <rect x="2" y="4" width="20" height="16" rx="2.5" />
    <path d="m2.5 6.5 9.5 7 9.5-7" />
  </svg>
);
export const MicIcon = (p: P) => (
  <svg {...base(p, 18, 2)}>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
  </svg>
);
export const SendIcon = (p: P) => (
  <svg {...base(p, 16, 2.5)}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
);
export const VideoIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m23 7-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
  </svg>
);
export const MoreIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </svg>
);
export const MapPinIcon = (p: P) => (
  <svg {...base(p, 16)}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>
);
export const CakeIcon = (p: P) => (
  <svg {...base(p, 16)}>
    <path d="M4 20h16M5.5 20v-6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6" />
    <path d="M5.5 16c1.1.9 2.2.9 3.3 0s2.2-.9 3.2 0 2.1.9 3.2 0 2.2-.9 3.3 0M12 12V9" />
    <path d="M12 6.8c.9-.6 1-1.5 0-2.8-1 1.3-.9 2.2 0 2.8Z" />
  </svg>
);
/** Sort: arrows up and down. */
export const SortIcon = (p: P) => (
  <svg {...base(p, 16)}>
    <path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4M12.5 16.5 16 20l3.5-3.5" />
  </svg>
);
export const ZoomOutIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M8 11h6M16.5 16.5 20 20" />
  </svg>
);
export const ZoomInIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M8 11h6M11 8v6M16.5 16.5 20 20" />
  </svg>
);
export const BackIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 18 9 12l6-6" />
  </svg>
);
export const InfoIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const LockIcon = (p: P) => (
  <svg {...base(p, 12, 2)}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base(p, 13, 2.2)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
/**
 * The tick by a message's time: the check drawn edge to edge (no padding in
 * its box), so CSS can give it exactly the height of the digits beside it.
 */
export const TickIcon = (p: P) => (
  <svg {...base(p, 12, 2.4)} viewBox="2.8 4.8 18.4 13.4">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
/** A voice message: five rounded bars, tallest in the middle. */
export const AudioWaveIcon = (p: P) => (
  <svg {...base(p, 20, 2)}>
    <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
  </svg>
);
export const ClockIcon = (p: P) => (
  <svg {...base(p, 12, 2)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
/**
 * Wallet, after the supplied design: a wallet with a pill-shaped clasp and two
 * short antennas ending in rings (top right, bottom left). 16 px wide with
 * 1.35 px lines like the other menu icons; it is a little taller than wide, so
 * it overhangs its slot by 1 px top and bottom without moving the row.
 */
export const WalletIcon = (p: P) => (
  <svg
    width={18}
    height={20}
    viewBox="103.7 71.7 368.6 409.6"
    aria-hidden
    focusable={false}
    style={{ margin: '-1px 0' }}
    {...p}
  >
    <g fill="none" stroke="currentColor" strokeWidth="27.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="M415 253.5V206a22 22 0 0 0-22-22H160a22 22 0 0 0-22 22V347a22 22 0 0 0 22 22H393a22 22 0 0 0 22-22V299.5" />
      <rect x="300" y="253.5" width="138" height="46" rx="23" />
      <path d="M369 184V138M207 369V415" />
      <circle cx="369" cy="115" r="23" />
      <circle cx="207" cy="438" r="23" />
    </g>
  </svg>
);
/**
 * Profile: a round head (11 dots) on an open, semicircular body (15 dots),
 * drawn in blue, after the supplied design.
 */
export const ProfileIcon = (p: P) => (
  // 16 px wide like the other menu icons, with 1.35 px dots.
  <svg {...base(p, 18, 2)} viewBox="-1.1 -1.1 26.2 26.2" stroke="#157ffb" {...p}>
    <circle cx="12" cy="5.9" r="4.8" strokeDasharray="0 2.742" />
    <path d="M1.4 22.0a10.6 10.6 0 0 1 21.2 0" strokeDasharray="0 2.379" />
  </svg>
);
/** Gem in blue outline. */
export const DiamondIcon = (p: P) => (
  <svg {...base(p, 18)} stroke="#3b9de0" {...p}>
    <path d="M6.5 3.5h11l4 5.5L12 20.5 2.5 9z" />
    <path d="M2.5 9h19M9 9l3 11.5L15 9M6.5 3.5 9 9l3-5.5L15 9l2.5-5.5" />
  </svg>
);
/**
 * Home: one green line that runs round a rounded square and folds in at the
 * bottom into a house, after the supplied design.
 */
export const HomeIcon = (p: P) => (
  <svg width={18} height={18} viewBox="0 0 512 512" aria-hidden focusable={false} {...p}>
    <path
      d="M157 316V451a15 15 0 0 1-15 15H80a35 35 0 0 1-35-35V80a35 35 0 0 1 35-35h351a35 35 0 0 1 35 35v351a35 35 0 0 1-35 35h-62a15 15 0 0 1-15-15V316q0-14 13-18l19-5L256 178 126 293l19 5q12 4 12 18z"
      fill="none"
      stroke="#3bc43e"
      strokeWidth="38.4"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);
export const ExpandIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M4 5v14M8 12h12M15 7l5 5-5 5" />
  </svg>
);
export const CollapseIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M4 5v14M20 12H8M13 7l-5 5 5 5" />
  </svg>
);
export const ArrowRightIcon = (p: P) => (
  <svg {...base(p, 18, 2)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
/*
 * Sign-in glyphs share one 18 px wide box whose artwork reaches both edges, so
 * the email, Internet Identity and passkey icons line up left and right.
 */
const SIGNIN_W = 18;

/** Envelope for the email field. */
export const SignInMailIcon = (p: P) => (
  <svg width={SIGNIN_W} height={14} viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true" {...p}>
    <rect x="0.75" y="0.75" width="16.5" height="12.5" rx="1.5" />
    <path d="m1.5 1.75 7.5 5.5 7.5-5.5" />
  </svg>
);
/** Internet Identity: an infinity loop (not the brand logo). */
export const IdentityIcon = (p: P) => (
  <svg width={SIGNIN_W} height={10} viewBox="0 0 18 10" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...p}>
    <path d="M9 5C7.6 2.9 6.3 1.5 4.6 1.5a3.5 3.5 0 0 0 0 7C6.3 8.5 7.6 7.1 9 5Zm0 0c1.4 2.1 2.7 3.5 4.4 3.5a3.5 3.5 0 0 0 0-7C11.7 1.5 10.4 2.9 9 5Z" />
  </svg>
);
/** Passkey: a 3 x 3 grid of dots. */
export const PasskeyIcon = (p: P) => (
  <svg width={SIGNIN_W} height={SIGNIN_W} viewBox="0 0 18 18" fill="currentColor" aria-hidden="true" {...p}>
    {[2, 9, 16].flatMap((y) => [2, 9, 16].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" />))}
  </svg>
);
export const FileIcon = (p: P) => (
  <svg {...base(p, 22)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
export const DownloadIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
export const CameraPlusIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <path d="M14.5 5H9.6L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />
    <circle cx="12" cy="13" r="3.5" />
    <path d="M19 2v6M16 5h6" />
  </svg>
);
export const MoreVerticalIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <circle cx="12" cy="5" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="12" cy="19" r="1.2" />
  </svg>
);
/** Sticker: a smiling face whose bottom-right corner is peeled up. */
export const StickerIcon = (p: P) => (
  <svg {...base(p, 22)}>
    <path d="M20.5 12.5V7A3.5 3.5 0 0 0 17 3.5H7A3.5 3.5 0 0 0 3.5 7v10A3.5 3.5 0 0 0 7 20.5h5.5z" />
    <path d="M12.5 20.5v-4a4 4 0 0 1 4-4h4" />
    <path d="M8.5 13.5c.9 1.2 2.1 1.8 3.5 1.8" />
    <circle cx="9" cy="9.5" r="0.6" fill="currentColor" />
    <circle cx="15" cy="9.5" r="0.6" fill="currentColor" />
  </svg>
);
export const TrashIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-12M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
  </svg>
);
export const PauseIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M8 5v14M16 5v14" strokeWidth={2.4} />
  </svg>
);
export const PlayIcon = (p: P) => (
  <svg {...base(p, 18)} fill="currentColor">
    <path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.4-7.2a1 1 0 0 0 0-1.7L8.5 3.9A1 1 0 0 0 7 4.8z" />
  </svg>
);
export const ChevronDownIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const PaletteIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />
    <circle cx="7.5" cy="11.5" r="1.2" />
    <circle cx="10.5" cy="7.5" r="1.2" />
    <circle cx="15.5" cy="8" r="1.2" />
  </svg>
);

export const TextSizeIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <path d="M3 18 8 6l5 12M4.7 14h6.6M14.5 18l3-7.5 3 7.5M15.4 16h4.2" />
  </svg>
);

/** The Bitcoin logo (Simple Icons, CC0): orange disc, white ₿. */
export const BitcoinIcon = (p: P) => (
  <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <circle cx="12" cy="12" r="10.6" fill="#ffffff" />
    <path d={siBitcoin.path} fill={`#${siBitcoin.hex}`} />
  </svg>
);

export const SmileIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    <circle cx="9" cy="9.8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9.8" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const ReplyIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M9.5 6.5 4 12l5.5 5.5" />
    <path d="M4.5 12h9a6.5 6.5 0 0 1 6.5 6.5V19" />
  </svg>
);

/** Four corners pointing out: view an image larger. */
export const MaximizeIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M14.5 4H20v5.5M9.5 20H4v-5.5M20 4l-6.5 6.5M4 20l6.5-6.5" />
  </svg>
);

export const ChevronRightIcon = (p: P) => (
  <svg {...base(p, 16)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const ArchiveIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <rect x="3.5" y="4" width="17" height="4.5" rx="1" />
    <path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" />
  </svg>
);
export const BellOffIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M9.5 20a2.7 2.7 0 0 0 5 0M6.2 6.2A6 6 0 0 0 6 8c0 6-2.5 7.5-2.5 7.5h13.3M18 13.5V8a6 6 0 0 0-9.2-5.1M3 3l18 18" />
  </svg>
);
export const StarIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M12 3.6l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />
  </svg>
);
export const PinIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M9 3.5h6M10 3.5v5.2L7 13h10l-3-4.3V3.5M12 13v7.5" />
  </svg>
);
export const MarkUnreadIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M13.5 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.5M8 11h6M8 14.5h8" />
    <circle cx="18.5" cy="5.5" r="2.5" fill="currentColor" />
  </svg>
);
export const HeartIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M12 19.5s-7.5-4.6-7.5-9.8A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.3c0 5.2-7.5 9.8-7.5 9.8z" />
  </svg>
);
export const ListAddIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M4 6.5h11M4 11.5h11M4 16.5h7M17.5 14v6M14.5 17h6" />
  </svg>
);
export const BlockIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 6l12 12" />
  </svg>
);
export const ClearIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8 12h8" />
  </svg>
);
export const EditIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);
/** The same person with − at the top right (remove contact). */
export const UserMinusIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <circle cx="9" cy="9.5" r="3.5" />
    <path d="M2.5 20.5c.6-3.3 3.2-5.3 6.5-5.3s5.9 2 6.5 5.3M16.25 5.75h5.5" />
  </svg>
);
export const ProfileCardIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="11" r="2.2" />
    <path d="M5.8 16.5c.5-1.5 1.7-2.4 3.2-2.4s2.7.9 3.2 2.4M14.5 10h3.5M14.5 13.5h3.5" />
  </svg>
);
export const PhoneOffIcon = (p: P) => (
  <svg {...base(p, 22)}>
    <path d="M4.5 13.2c4.4-3.6 10.6-3.6 15 0l-1.6 2.7a1 1 0 0 1-1.3.4l-2.4-1a1 1 0 0 1-.6-.9v-1.6a10 10 0 0 0-3.2 0v1.6a1 1 0 0 1-.6.9l-2.4 1a1 1 0 0 1-1.3-.4z" />
  </svg>
);
export const MicOffIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.5V6a3 3 0 0 0-5.8-1M5.5 11a6.5 6.5 0 0 0 10.6 5M18.5 11c0 .8-.1 1.5-.4 2.2M12 17.5V21M3 3l18 18" />
  </svg>
);
export const VideoOffIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <path d="M10.5 6H14a2 2 0 0 1 2 2v3.5l5-3.5v8M16 16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2M3 3l18 18" />
  </svg>
);
export const CopyIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </svg>
);
/** One person: friends. */
export const PersonIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M5.5 20c.6-3.4 3.2-5.4 6.5-5.4s5.9 2 6.5 5.4" />
  </svg>
);
/** Two people: groups. */
export const GroupIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <circle cx="9" cy="9" r="3.2" />
    <path d="M3 19.5c.5-3 2.9-4.9 6-4.9s5.5 1.9 6 4.9M15.2 6.1a3.2 3.2 0 0 1 0 5.8M17.3 14.9c2 .6 3.4 2.2 3.7 4.6" />
  </svg>
);
/** Three people: communities. */
export const CommunityIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <circle cx="12" cy="8" r="2.8" />
    <circle cx="5" cy="10.5" r="2.1" />
    <circle cx="19" cy="10.5" r="2.1" />
    <path d="M7.2 18.5c.4-2.6 2.4-4.2 4.8-4.2s4.4 1.6 4.8 4.2M1.8 18.5c.3-1.9 1.5-3.2 3.2-3.5M22.2 18.5c-.3-1.9-1.5-3.2-3.2-3.5" />
  </svg>
);
export const ChevronUpIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M6 15l6-6 6 6" />
  </svg>
);
/** Collapse the right panel: a panel outline with » toward the edge. */
export const PanelCollapseIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M15 4.5v15M7.5 9.5l2.5 2.5-2.5 2.5" />
  </svg>
);
/** Expand the right panel: the same outline with « into the panel. */
export const PanelExpandIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M15 4.5v15M10 9.5L7.5 12l2.5 2.5" />
  </svg>
);
/** Photos and files shared in a chat. */
/** What was shared in a chat: a stack of layers (media, files, links). */
export const SharedIcon = (p: P) => (
  <svg {...base(p, 20)}>
    <path d="M12 3.2 20.5 8 12 12.8 3.5 8z" />
    <path d="m3.5 12.2 8.5 4.8 8.5-4.8" />
    <path d="m3.5 16.4 8.5 4.8 8.5-4.8" />
  </svg>
);
/** Translate: a character and an "A" (the usual translate mark). */
export const TranslateIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M3.5 5.5h9M8 3.5v2M10.5 5.5c-1 4-3.5 7-7 8.5M5.5 9c1.2 2 3 3.5 5.5 4.5M12.5 20.5l4-10 4 10M14 17h5" />
  </svg>
);
export const LinkIcon = (p: P) => (
  <svg {...base(p, 18)}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);
export const ExternalLinkIcon = (p: P) => (
  <svg {...base(p, 16)}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </svg>
);
export const ShareIcon = (p: P) => (
  <svg {...base(p, 16)}>
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </svg>
);
