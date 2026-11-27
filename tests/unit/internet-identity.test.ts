import { beforeEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.fn();
const signOut = vi.fn();
const isAuthenticated = vi.fn();
const getIdentity = vi.fn();
const ctorArgs: unknown[] = [];

vi.mock('@icp-sdk/auth/client', () => ({
  AuthClient: class {
    constructor(options: unknown) {
      ctorArgs.push(options);
    }
    signIn = signIn;
    signOut = signOut;
    isAuthenticated = isAuthenticated;
    getIdentity = getIdentity;
  },
}));

import { InternetIdentityProvider } from '../../src/modules/icp-identity';

const identity = (text: string) => ({ getPrincipal: () => ({ toText: () => text }) });

describe('InternetIdentityProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctorArgs.length = 0;
  });

  it('restores nothing when there is no session', async () => {
    isAuthenticated.mockReturnValue(false);
    expect(await new InternetIdentityProvider().restore()).toBeNull();
    expect(getIdentity).not.toHaveBeenCalled();
  });

  it('restores an existing session principal', async () => {
    isAuthenticated.mockReturnValue(true);
    getIdentity.mockResolvedValue(identity('abcde-principal'));
    expect(await new InternetIdentityProvider().restore()).toEqual({
      principal: 'abcde-principal',
      provider: 'internet-identity',
    });
  });

  it('signs in with a bounded session length and returns the principal', async () => {
    signIn.mockResolvedValue(identity('new-principal'));
    const session = await new InternetIdentityProvider().signIn();
    expect(session.principal).toBe('new-principal');
    const opts = signIn.mock.calls[0]![0] as { maxTimeToLive: bigint };
    expect(opts.maxTimeToLive).toBe(BigInt(8 * 3600) * BigInt(1_000_000_000));
  });

  it('uses mainnet by default and passes local overrides when given', async () => {
    isAuthenticated.mockReturnValue(false);
    await new InternetIdentityProvider().restore();
    expect(ctorArgs[0]).not.toHaveProperty('identityProvider');
    await new InternetIdentityProvider({
      identityProvider: { authorizeUrl: 'http://localhost:4943/authorize', canisterId: 'x' },
      derivationOrigin: 'https://example.icp0.io',
    }).restore();
    expect(ctorArgs[1]).toMatchObject({
      identityProvider: { authorizeUrl: 'http://localhost:4943/authorize' },
      derivationOrigin: 'https://example.icp0.io',
    });
  });

  it('wraps sign-in failures in an OpenSocialError', async () => {
    signIn.mockRejectedValue(new Error('UserInterrupt'));
    await expect(new InternetIdentityProvider().signIn()).rejects.toMatchObject({
      code: 'AUTH_SIGN_IN_FAILED',
    });
  });

  it('signs out through the SDK', async () => {
    await new InternetIdentityProvider().signOut();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
