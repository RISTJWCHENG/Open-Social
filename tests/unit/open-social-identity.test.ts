// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { OpenSocialIdentityProvider } from '../../src/modules/icp-identity/openSocialIdentity';
import type { InternetIdentityProvider } from '../../src/modules/icp-identity';

describe('OpenSocialIdentityProvider', () => {
  it('opens the Internet Identity window synchronously within the click', () => {
    const startSignIn = vi.fn(() => new Promise<never>(() => {}));
    const ii = { startSignIn, signInIdentity: vi.fn(), preload: vi.fn(), signOut: vi.fn() };
    const provider = new OpenSocialIdentityProvider({
      canisterId: 'bbyqw-cyaaa-aaaao-qqlna-cai',
      ii: ii as unknown as InternetIdentityProvider,
    });
    void provider.signIn('ii');
    // No await between the click and opening the II window.
    expect(startSignIn).toHaveBeenCalledTimes(1);
  });

  it('does not open Internet Identity for other methods', () => {
    const startSignIn = vi.fn();
    const ii = { startSignIn, signInIdentity: vi.fn(), preload: vi.fn(), signOut: vi.fn() };
    const provider = new OpenSocialIdentityProvider({
      canisterId: 'bbyqw-cyaaa-aaaao-qqlna-cai',
      ii: ii as unknown as InternetIdentityProvider,
    });
    void provider.signIn('passkey').catch(() => undefined);
    expect(startSignIn).not.toHaveBeenCalled();
  });
});
