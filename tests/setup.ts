import { webcrypto } from 'node:crypto';

// jsdom does not always expose SubtleCrypto; fall back to Node's Web Crypto.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
import '@testing-library/jest-dom/vitest';
