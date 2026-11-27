/**
 * Chat translation on this device only, with the browser's built-in
 * Translator and LanguageDetector APIs (Chrome and Edge on computers).
 * Message text never leaves the device: the browser downloads a language
 * model once and translates locally. Where the APIs are missing,
 * `browserTranslationApi()` returns null and the app says translation is
 * not available in this browser.
 */

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface TranslatorLike {
  translate(text: string): Promise<string>;
}

export interface DetectorLike {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
}

/** Reports model download progress: `downloadprogress` events with `loaded` from 0 to 1. */
export type DownloadMonitor = (m: EventTarget) => void;

export interface TranslationApi {
  Translator: {
    availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
    create(o: { sourceLanguage: string; targetLanguage: string; monitor?: DownloadMonitor }): Promise<TranslatorLike>;
  };
  LanguageDetector: {
    availability(): Promise<Availability>;
    create(o?: { monitor?: DownloadMonitor }): Promise<DetectorLike>;
  };
}

/** `from` of a result that waits for the language detector itself (not a language pair). */
export const DETECTOR = '';

/** The browser's translation APIs, or null where this browser has none. */
export function browserTranslationApi(): TranslationApi | null {
  const g = globalThis as unknown as Partial<TranslationApi>;
  return g.Translator && g.LanguageDetector ? { Translator: g.Translator, LanguageDetector: g.LanguageDetector } : null;
}

/** Some browsers expose the APIs but never answer; give up after this long. */
const ANSWER_MS = 8000;

function inTime<T>(p: Promise<T>, ms = ANSWER_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The browser did not answer')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Whether this browser can actually translate on the device (it has the APIs and answers). */
export async function canTranslateHere(api: TranslationApi | null): Promise<boolean> {
  if (!api) return false;
  try {
    return (await inTime(api.LanguageDetector.availability(), 4000)) !== 'unavailable';
  } catch {
    return false;
  }
}

/** Languages a chat can be translated into (codes as the browser APIs name them). */
export const TRANSLATE_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文（简体）' },
  { code: 'zh-Hant', name: '中文（繁體）' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'pl', name: 'Polski' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'id', name: 'Bahasa Indonesia' },
];

/** English name of a language code ("zh" → "Chinese"). */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Whether text detected as `from` is already in `to` ("en-US" is English; Chinese scripts differ). */
export function sameLanguage(from: string, to: string): boolean {
  const a = from.toLowerCase();
  const b = to.toLowerCase();
  if (a === b) return true;
  const base = (x: string) => x.split('-')[0];
  if (base(a) !== base(b)) return false;
  if (base(a) !== 'zh') return true;
  const hant = (x: string) => /-(hant|tw|hk|mo)\b/.test(x);
  return hant(a) === hant(b);
}

export type TranslationResult =
  | { kind: 'done'; text: string; from: string }
  /** Already in the chosen language, or the language could not be told. */
  | { kind: 'same' }
  /** The browser can translate this pair once its model is downloaded (needs a click). */
  | { kind: 'needs-download'; from: string }
  | { kind: 'unsupported'; from: string };

/** Detects and translates, keeping one detector and one translator per language pair. */
export class ChatTranslator {
  private detector: Promise<DetectorLike> | null = null;
  private translators = new Map<string, Promise<TranslatorLike>>();

  constructor(private readonly api: TranslationApi) {}

  /**
   * The most likely language of `text`, or null when unsure. Throws 'needs-download'
   * while the detector's model still has to be downloaded (that needs a click).
   */
  async detect(text: string): Promise<string | null> {
    if (!this.detector) {
      const a = await inTime(this.api.LanguageDetector.availability());
      if (a === 'unavailable') throw new Error('unsupported');
      if (a !== 'available') throw new Error('needs-download');
      this.detector = this.api.LanguageDetector.create();
    }
    let found;
    try {
      found = (await inTime((await inTime(this.detector, 120_000)).detect(text)))[0];
    } catch (e) {
      this.detector = null;
      throw e;
    }
    return found && found.detectedLanguage !== 'und' && found.confidence >= 0.5 ? found.detectedLanguage : null;
  }

  /**
   * Gets the translator for a pair. Without a user gesture, a pair whose model
   * still has to be downloaded is reported instead of downloaded.
   */
  async translatorFor(
    from: string,
    to: string,
    gesture: boolean,
  ): Promise<TranslatorLike | 'needs-download' | 'unsupported'> {
    const key = `${from}>${to}`;
    const ready = this.translators.get(key);
    if (ready) return ready;
    let availability: Availability;
    try {
      availability = await inTime(this.api.Translator.availability({ sourceLanguage: from, targetLanguage: to }));
    } catch {
      return 'unsupported';
    }
    if (availability === 'unavailable') return 'unsupported';
    if (availability !== 'available' && !gesture) return 'needs-download';
    const created = this.api.Translator.create({
      sourceLanguage: from,
      targetLanguage: to,
    });
    this.translators.set(key, created);
    created.catch(() => this.translators.delete(key));
    return created;
  }

  async translate(text: string, to: string): Promise<TranslationResult> {
    let from: string | null;
    try {
      from = await this.detect(text);
    } catch (e) {
      const why = e instanceof Error ? e.message : '';
      if (why === 'needs-download' || why === 'unsupported') return { kind: why, from: DETECTOR };
      throw e;
    }
    if (!from || sameLanguage(from, to)) return { kind: 'same' };
    const t = await this.translatorFor(from, to, false);
    if (t === 'needs-download' || t === 'unsupported') return { kind: t, from };
    return { kind: 'done', text: await inTime(t.translate(text), 30_000), from };
  }

  /**
   * From a click: downloads what is still missing (the detector, and each
   * `from` → `to` model), reporting overall progress from 0 to 1. All downloads
   * start at once, while the click still counts as the user's gesture.
   */
  async prepare(froms: string[], to: string, onProgress?: (loaded: number) => void): Promise<void> {
    const parts = new Map<string, number>();
    const monitor =
      (name: string): DownloadMonitor =>
      (m) => {
        parts.set(name, 0);
        m.addEventListener('downloadprogress', (e) => {
          parts.set(name, (e as Event & { loaded?: number }).loaded ?? 0);
          onProgress?.([...parts.values()].reduce((a, b) => a + b, 0) / parts.size);
        });
      };
    const jobs: Promise<unknown>[] = [];
    if (!this.detector) {
      const d = this.api.LanguageDetector.create({ monitor: monitor('detector') });
      this.detector = d;
      d.catch(() => {
        if (this.detector === d) this.detector = null;
      });
      jobs.push(d);
    }
    for (const from of froms) {
      if (from === DETECTOR) continue;
      const key = `${from}>${to}`;
      let created = this.translators.get(key);
      if (!created) {
        created = this.api.Translator.create({ sourceLanguage: from, targetLanguage: to, monitor: monitor(key) });
        const c = created;
        this.translators.set(key, c);
        c.catch(() => {
          if (this.translators.get(key) === c) this.translators.delete(key);
        });
      }
      jobs.push(created);
    }
    await Promise.all(jobs);
    onProgress?.(1);
  }
}
