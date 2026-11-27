/**
 * Username rules, mirroring the profiles canister (backend/profiles/src/model.rs),
 * which has the final say.
 *
 * - Letters and digits of any language, plus dots and underscores; 2–20 characters.
 * - Case is kept as typed, but "Rist", "rist" and "ＲＩＳＴ" are the same username.
 * - One writing system per username (Latin may be combined with Chinese, Japanese
 *   or Korean), so look-alike letters from different alphabets cannot be mixed to
 *   imitate someone else's name.
 */
export const USERNAME_MIN = 2;
export const USERNAME_MAX = 20;

/** Stored form: compatibility forms (full-width etc.) become ordinary characters. */
export function normalizeUsername(u: string): string {
  return u.trim().normalize("NFKC");
}

/** Uniqueness and lookup key. */
export function usernameKey(u: string): string {
  return normalizeUsername(u).toLowerCase().normalize("NFKC");
}

const ALLOWED = /^[\p{L}\p{M}\p{N}_.]*$/u;
const MARK = /^\p{M}/u;
const NEUTRAL = /[\p{Script=Common}\p{Script=Inherited}]/u;

const SCRIPTS = [
  "Latin",
  "Greek",
  "Cyrillic",
  "Armenian",
  "Georgian",
  "Hebrew",
  "Arabic",
  "Syriac",
  "Thaana",
  "Devanagari",
  "Bengali",
  "Gurmukhi",
  "Gujarati",
  "Oriya",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Sinhala",
  "Thai",
  "Lao",
  "Tibetan",
  "Myanmar",
  "Khmer",
  "Mongolian",
  "Ethiopic",
  "Cherokee",
  "Han",
  "Hiragana",
  "Katakana",
  "Bopomofo",
  "Hangul",
].map((name) => ({ name, re: new RegExp(`\\p{Script=${name}}`, "u") }));

const COMBINED = [
  ["Latin", "Han", "Hiragana", "Katakana"],
  ["Latin", "Han", "Hangul"],
  ["Latin", "Han", "Bopomofo"],
];

function scriptOf(c: string): string {
  return SCRIPTS.find((s) => s.re.test(c))?.name ?? "Other";
}

function oneWritingSystem(u: string): boolean {
  const used = new Set([...u].filter((c) => !NEUTRAL.test(c)).map(scriptOf));
  if (used.size <= 1) return true;
  return COMBINED.some((set) => [...used].every((s) => set.includes(s)));
}

/** Why a (normalized) username is not allowed, or null when it is fine. */
export function usernameProblem(u: string): string | null {
  const n = [...u].length;
  if (n < USERNAME_MIN || n > USERNAME_MAX)
    return `Use ${USERNAME_MIN}–${USERNAME_MAX} characters.`;
  if (!ALLOWED.test(u))
    return "Use only letters, numbers, dots and underscores.";
  if (MARK.test(u))
    return "A username cannot start with an accent or vowel sign.";
  if (!oneWritingSystem(u)) return "Use letters from one writing system.";
  return null;
}
