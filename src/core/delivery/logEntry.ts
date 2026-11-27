/**
 * Message log entries (ZLE1), Hypercore-style: each sender keeps a signed,
 * append-only log per conversation. An entry carries the sender's sequence
 * number and the hash of the sender's previous entry, so receivers can detect
 * gaps, replays and reordering, whichever transport delivered it (ICP mailbox
 * today, blind peers later). The payload is an end-to-end encrypted envelope.
 */
import { fromBase64, fromUtf8, sha256, toBase64, toHex, utf8 } from '../crypto/bytes';
import { OpenSocialError } from '../types';

export interface LogEntryFields {
  /** Format version: 3 = MLS (kind byte: 1 Welcome, 2 MLS message). */
  v: 3;
  /** Conversation id (hex). */
  conv: string;
  /** Sender's sequence number in this conversation, starting at 1. */
  seq: number;
  /** Hex SHA-256 of the sender's previous entry, '' for the first. */
  prev: string;
  /** Sender account principal (text). */
  from: string;
  /** Sender device id. */
  device: string;
  sentAt: number;
  /** Base64 ciphertext for the recipient device (v3: kind byte + MLS message). */
  envelope: string;
}

export interface LogEntry extends LogEntryFields {
  /** Base64 ECDSA P-256 / SHA-256 signature by the sender device over the fields. */
  sig: string;
}

const canonical = (f: LogEntryFields) =>
  utf8(JSON.stringify([f.v, f.conv, f.seq, f.prev, f.from, f.device, f.sentAt, f.envelope]));

export async function signEntry(fields: LogEntryFields, signingKey: CryptoKey): Promise<LogEntry> {
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, canonical(fields)),
  );
  return { ...fields, sig: toBase64(sig) };
}

export async function verifyEntry(entry: LogEntry, signingPublicKey: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    signingPublicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    fromBase64(entry.sig),
    canonical(entry),
  );
}

export async function entryHash(entry: LogEntry): Promise<string> {
  return toHex(await sha256(encodeEntry(entry)));
}

export function encodeEntry(entry: LogEntry): Uint8Array {
  return utf8(JSON.stringify(entry));
}

export function decodeEntry(bytes: Uint8Array): LogEntry {
  let e: Partial<LogEntry>;
  try {
    e = JSON.parse(fromUtf8(bytes)) as Partial<LogEntry>;
  } catch {
    throw new OpenSocialError('ENTRY_MALFORMED', 'Not a log entry.');
  }
  const ok =
    e.v === 3 &&
    typeof e.conv === 'string' &&
    Number.isInteger(e.seq) &&
    (e.seq ?? 0) >= 1 &&
    typeof e.prev === 'string' &&
    typeof e.from === 'string' &&
    typeof e.device === 'string' &&
    typeof e.sentAt === 'number' &&
    typeof e.envelope === 'string' &&
    typeof e.sig === 'string';
  if (!ok) throw new OpenSocialError('ENTRY_MALFORMED', 'Log entry has an unexpected shape.');
  return e as LogEntry;
}

/** Conversation id for two accounts: SHA-256 of the sorted principals. */
export async function directConversationId(a: string, b: string): Promise<string> {
  const [x, y] = [a, b].sort();
  return toHex(await sha256(utf8(`opensocial/v1/direct:${x}:${y}`)));
}
