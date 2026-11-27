import { describe, expect, it, vi } from 'vitest';
import {
  canTranslateHere,
  ChatTranslator,
  sameLanguage,
  type Availability,
  type TranslationApi,
} from '../../src/core/translate/onDeviceTranslation';

/** A fake of the browser APIs: detects by a "lang:" prefix, "translates" by tagging. */
function fakeApi(models: Record<string, Availability>) {
  const create = vi.fn(
    async ({ sourceLanguage, targetLanguage }: { sourceLanguage: string; targetLanguage: string }) => {
      models[`${sourceLanguage}>${targetLanguage}`] = 'available';
      return { translate: async (t: string) => `[${targetLanguage}] ${t.replace(/^\w+(-\w+)?:/, '')}` };
    },
  );
  const api: TranslationApi = {
    Translator: {
      availability: async ({ sourceLanguage, targetLanguage }) =>
        models[`${sourceLanguage}>${targetLanguage}`] ?? 'unavailable',
      create,
    },
    LanguageDetector: {
      availability: async () => 'available',
      create: async () => ({
        detect: async (text: string) => {
          const m = /^(\w+(?:-\w+)?):/.exec(text);
          return m ? [{ detectedLanguage: m[1]!, confidence: 0.9 }] : [{ detectedLanguage: 'und', confidence: 1 }];
        },
      }),
    },
  };
  return { api, create };
}

describe('on-device translation', () => {
  it('translates with a model that is already on the device', async () => {
    const { api } = fakeApi({ 'zh>en': 'available' });
    const t = new ChatTranslator(api);
    expect(await t.translate('zh:你好', 'en')).toEqual({ kind: 'done', text: '[en] 你好', from: 'zh' });
  });

  it('leaves text that is already in the language, or unknown', async () => {
    const t = new ChatTranslator(fakeApi({}).api);
    expect(await t.translate('en-US:hello', 'en')).toEqual({ kind: 'same' });
    expect(await t.translate('no idea', 'en')).toEqual({ kind: 'same' });
  });

  it('waits for a click before downloading a model, then translates', async () => {
    const { api, create } = fakeApi({ 'fr>en': 'downloadable' });
    const t = new ChatTranslator(api);
    expect(await t.translate('fr:bonjour', 'en')).toEqual({ kind: 'needs-download', from: 'fr' });
    expect(create).not.toHaveBeenCalled();
    await t.prepare(['fr'], 'en');
    expect(await t.translate('fr:bonjour', 'en')).toEqual({ kind: 'done', text: '[en] bonjour', from: 'fr' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('says when the browser cannot translate a language', async () => {
    const t = new ChatTranslator(fakeApi({}).api);
    expect(await t.translate('xx:abc', 'en')).toEqual({ kind: 'unsupported', from: 'xx' });
  });

  it('tells Chinese scripts apart but not regions', () => {
    expect(sameLanguage('en-GB', 'en')).toBe(true);
    expect(sameLanguage('zh', 'zh-Hant')).toBe(false);
    expect(sameLanguage('zh-TW', 'zh-Hant')).toBe(true);
    expect(sameLanguage('fr', 'en')).toBe(false);
  });

  it('treats a browser that never answers as unable to translate', async () => {
    vi.useFakeTimers();
    try {
      const { api } = fakeApi({});
      api.Translator.availability = () => new Promise(() => undefined);
      const hung = {
        ...api,
        LanguageDetector: { ...api.LanguageDetector, availability: () => new Promise<never>(() => undefined) },
      };
      const can = canTranslateHere(hung);
      const result = new ChatTranslator(api).translate('zh:你好', 'en');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await can).toBe(false);
      expect(await result).toEqual({ kind: 'unsupported', from: 'zh' });
      expect(await canTranslateHere(null)).toBe(false);
      expect(await canTranslateHere(fakeApi({}).api)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a click when the language detector itself must be downloaded', async () => {
    const { api } = fakeApi({ 'fr>en': 'downloadable' });
    api.LanguageDetector.availability = async () => 'downloadable';
    const t = new ChatTranslator(api);
    expect(await t.translate('fr:bonjour', 'en')).toEqual({ kind: 'needs-download', from: '' });
    const progress: number[] = [];
    await t.prepare(['', 'fr'], 'en', (p) => progress.push(p));
    expect(progress.at(-1)).toBe(1);
    expect(await t.translate('fr:bonjour', 'en')).toEqual({ kind: 'done', text: '[en] bonjour', from: 'fr' });
  });
});
