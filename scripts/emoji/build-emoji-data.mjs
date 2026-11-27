// Builds src/ui/emoji/emojiData.json from emojibase-data (MIT): the emoji the
// picker offers, with their name, search keywords and category. Limited to
// Emoji 15.0 and earlier, which current systems display. Flags are the flags
// of countries and regions only (no chequered, pirate or other symbol flags),
// sorted by name, each with its code (BE, CN, ENG...).
// Row: [emoji, name, keywords, category, code?]
// Run: node scripts/emoji/build-emoji-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const data = JSON.parse(readFileSync(require.resolve('emojibase-data/en/data.json'), 'utf8'));
const messages = JSON.parse(readFileSync(require.resolve('emojibase-data/en/messages.json'), 'utf8'));
const MAX_VERSION = 15.0;
const FLAGS = 7;

// emojibase groups -> picker categories (smileys and people share one, as is usual).
const CATEGORY = { 0: 0, 1: 0, 3: 1, 4: 2, 6: 3, 5: 4, 7: 5, 8: 6, 9: FLAGS };
const subgroup = Object.fromEntries(messages.subgroups.map((s) => [s.order, s.key]));
const NATIONAL = new Set(['country-flag', 'subdivision-flag']);

/** "BE" from regional indicators; "ENG" from a subdivision tag sequence (gbeng). */
function flagCode(emoji) {
  const cps = [...emoji].map((c) => c.codePointAt(0));
  const regional = cps.filter((c) => c >= 0x1f1e6 && c <= 0x1f1ff);
  if (regional.length === 2) return regional.map((c) => String.fromCharCode(c - 0x1f1e6 + 65)).join('');
  const tags = cps.filter((c) => c >= 0xe0061 && c <= 0xe007a).map((c) => String.fromCharCode(c - 0xe0061 + 65));
  return tags.length > 2 ? tags.slice(2).join('') : '';
}

const rows = [];
const flags = [];
for (const e of [...data].sort((a, b) => a.order - b.order)) {
  if (!(e.group in CATEGORY) || e.version > MAX_VERSION) continue;
  const tags = [...new Set(e.tags ?? [])];
  if (CATEGORY[e.group] === FLAGS) {
    if (!NATIONAL.has(subgroup[e.subgroup])) continue; // symbol flags are not countries
    const code = flagCode(e.emoji);
    const name = e.label.replace(/^flag: /, '');
    flags.push([e.emoji, name, [...tags, code.toLowerCase()].join(' '), FLAGS, code]);
  } else {
    rows.push([e.emoji, e.label, tags.join(' '), CATEGORY[e.group]]);
  }
}
flags.sort((a, b) => a[1].localeCompare(b[1], 'en'));

const out = [...rows, ...flags];
writeFileSync(new URL('../../src/ui/emoji/emojiData.json', import.meta.url), JSON.stringify(out));
console.log(`${out.length} emoji written (${flags.length} flags)`);
