import { describe, expect, it } from 'vitest';
import { friendlyNetworkError } from '../../src/ui/useRealMessaging';

const reject = (code: number, text: string, ic: string) =>
  new Error(
    `The replica returned a rejection error:\n  Request ID: ab12\n  Reject code: ${code}\n  Reject text: ${text}\n  Error code: ${ic}\n`,
  );

describe('friendlyNetworkError', () => {
  it('shows an Internet Computer rejection by its reason, not its first line', () => {
    expect(friendlyNetworkError(reject(5, 'Canister abc trapped: out of bounds', 'IC0502'))).toBe(
      'Canister abc trapped: out of bounds (IC0502)',
    );
  });

  it('says a passing busy moment plainly', () => {
    expect(friendlyNetworkError(reject(2, 'Ingress message rate limited', 'IC0101'))).toMatch(/busy for a moment/);
  });

  it('says offline plainly', () => {
    expect(friendlyNetworkError(new TypeError('Failed to fetch'))).toMatch(/No connection/);
  });
  it('names HTTP errors from the boundary nodes by their status', () => {
    const http = (status: number, text: string) =>
      `HTTP request failed:\n  Status: ${status} (${text})\n  Headers: []\n  Body: x\n`;
    expect(friendlyNetworkError(new Error(http(503, 'Service Unavailable')))).toBe(
      'The Internet Computer did not answer for a moment. Retrying…',
    );
    expect(friendlyNetworkError(new Error(http(429, 'Too Many Requests')))).toBe(
      'Too many requests to the Internet Computer for a moment. Retrying…',
    );
    expect(friendlyNetworkError(new Error(http(400, 'Bad Request')))).toBe(
      'The Internet Computer refused the request (HTTP 400).',
    );
  });
});
