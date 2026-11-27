import { describe, expect, it } from 'vitest';
import { CANONICAL_ORIGIN, iiDerivationOrigin } from '../../src/config';

describe('App origins', () => {
  it('signs in with Internet Identity as the canonical address on chat.opensocial.cc only', () => {
    expect(iiDerivationOrigin('https://chat.opensocial.cc')).toBe(CANONICAL_ORIGIN);
    expect(iiDerivationOrigin(CANONICAL_ORIGIN)).toBeUndefined();
    expect(iiDerivationOrigin('http://localhost:5173')).toBeUndefined();
  });
});
