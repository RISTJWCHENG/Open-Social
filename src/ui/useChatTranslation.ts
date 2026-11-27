/**
 * Translates a chat's incoming messages into the language chosen for it,
 * on this device (see core/translate/onDeviceTranslation). Messages are done
 * one at a time, newest first, and results are kept for the session.
 *
 * The browser downloads its language models once, and only after a click:
 * `missing` lists what is still to be downloaded and `download()` (called from
 * a click) gets all of it, reporting progress.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatTranslator, type TranslationApi, type TranslationResult } from '../core/translate/onDeviceTranslation';
import type { RealMessage } from '../core/delivery/realMessaging';

/** How many of the latest messages are translated. */
const LATEST = 200;

export type MessageTranslation = TranslationResult | { kind: 'pending' } | { kind: 'error' };

export interface ChatTranslation {
  /** Translation state of a message (undefined: translation is off or not applicable). */
  of(id: string): MessageTranslation | undefined;
  /** Source languages waiting for a model download (DETECTOR: the language detector). */
  missing: string[];
  /** Messages that could not be translated. */
  failed: number;
  /** Download progress from 0 to 1 while downloading, else null. */
  progress: number | null;
  /** Why the last download failed, if it did. */
  downloadError: string | null;
  /** From a click: downloads every missing model, then translates again. */
  download(): Promise<void>;
  /** From the click that turns translation on: starts the language detector's download. */
  warmUp(): void;
}

export function useChatTranslation(
  api: TranslationApi | null,
  messages: RealMessage[],
  target: string | null,
): ChatTranslation {
  const translator = useRef<ChatTranslator | null>(null);
  if (api && !translator.current) translator.current = new ChatTranslator(api);
  const [results, setResults] = useState<Map<string, MessageTranslation>>(() => new Map());
  const [round, setRound] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const prefix = `${target}|`;

  useEffect(() => {
    const t = translator.current;
    if (!t || !target) return;
    let alive = true;
    const todo = messages
      .filter((m) => m.direction === 'in' && m.body.trim() && !m.deleted)
      .slice(-LATEST)
      .reverse()
      .filter((m) => {
        const r = results.get(`${target}|${m.id}`);
        return !r || r.kind === 'pending';
      });
    if (!todo.length) return;
    setResults((prev) => {
      const next = new Map(prev);
      for (const m of todo) if (!next.has(`${target}|${m.id}`)) next.set(`${target}|${m.id}`, { kind: 'pending' });
      return next;
    });
    void (async () => {
      for (const m of todo) {
        let r: MessageTranslation;
        try {
          r = await t.translate(m.body, target);
        } catch {
          r = { kind: 'error' };
        }
        if (!alive) return;
        setResults((prev) => new Map(prev).set(`${target}|${m.id}`, r));
      }
    })();
    return () => {
      alive = false;
    };
    // `results` is read only to skip finished messages; rerunning on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, messages, target, round]);

  const mine = [...results].filter(([k]) => k.startsWith(prefix)).map(([, r]) => r);
  const missing = [...new Set(mine.flatMap((r) => (r.kind === 'needs-download' ? [r.from] : [])))];
  const failed = mine.filter((r) => r.kind === 'error').length;

  const download = useCallback(async () => {
    const t = translator.current;
    if (!t || !target) return;
    setDownloadError(null);
    setProgress(0);
    try {
      await t.prepare(missing, target, setProgress);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
    // Translate again every message that waited for a download or failed.
    setResults((prev) => {
      const next = new Map(prev);
      for (const [k, r] of next) {
        if (k.startsWith(`${target}|`) && (r.kind === 'needs-download' || r.kind === 'error')) {
          next.set(k, { kind: 'pending' });
        }
      }
      return next;
    });
    setRound((n) => n + 1);
  }, [missing, target]);

  return {
    of: (id) => (target ? results.get(prefix + id) : undefined),
    missing,
    failed,
    progress,
    downloadError,
    download,
    warmUp: () => void translator.current?.prepare([], 'en').catch(() => undefined),
  };
}
