/**
 * The signed-in OpenSocial account: restore on load, sign in with any supported
 * method (Internet Identity, passkey, email code), cancel a
 * pending sign-in, and sign out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountProvider, AccountSession, EmailCodeParams, EmailCodeSent, SignInMethod } from '../core/interfaces';
import { InternetIdentityProvider } from '../modules/icp-identity';
import { OpenSocialIdentityProvider } from '../modules/icp-identity/openSocialIdentity';
import { IDENTITY_CANISTER_ID, iiDerivationOrigin } from '../config';

export type AuthStatus = 'checking' | 'signed-out' | 'signing-in' | 'signed-in';

let defaultProvider: AccountProvider | null = null;
// With an identity canister configured, every sign-in method goes through it;
// otherwise fall back to Internet Identity only.
const getDefaultProvider = () =>
  (defaultProvider ??= IDENTITY_CANISTER_ID
    ? new OpenSocialIdentityProvider({ canisterId: IDENTITY_CANISTER_ID })
    : new InternetIdentityProvider({ derivationOrigin: iiDerivationOrigin(window.location.origin) }));

export function useAccount({ accountProvider }: { accountProvider?: AccountProvider } = {}) {
  const provider = useRef<AccountProvider>(accountProvider ?? getDefaultProvider()).current;
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [account, setAccount] = useState<AccountSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingInWith, setSigningInWith] = useState<SignInMethod | null>(null);
  const [emailStep, setEmailStep] = useState<(EmailCodeSent & { email: string }) | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  // Each sign-in attempt gets a number so a cancelled attempt that settles late is ignored.
  const attempt = useRef(0);

  useEffect(() => {
    let alive = true;
    provider
      .restore()
      .then((restored) => {
        if (!alive) return;
        setAccount(restored);
        setAuthStatus(restored ? 'signed-in' : 'signed-out');
      })
      .catch((e) => {
        if (!alive) return;
        setAuthError(e instanceof Error ? e.message : String(e));
        setAuthStatus('signed-out');
      });
    return () => {
      alive = false;
    };
  }, [provider]);

  const sendEmailCode = useCallback(
    async (email: string) => {
      if (!provider.sendEmailCode) return;
      setAuthError(null);
      setEmailSending(true);
      try {
        setEmailStep({ ...(await provider.sendEmailCode(email)), email });
      } catch (e) {
        setAuthError(e instanceof Error ? e.message : String(e));
      } finally {
        setEmailSending(false);
      }
    },
    [provider],
  );

  const resetEmail = useCallback(() => {
    setEmailStep(null);
    setAuthError(null);
  }, []);

  const signIn = useCallback(
    async (method: SignInMethod = 'ii', params?: EmailCodeParams) => {
      const mine = ++attempt.current;
      setAuthError(null);
      setAuthStatus('signing-in');
      setSigningInWith(method);
      try {
        const next = await provider.signIn(method, params);
        if (mine !== attempt.current) return;
        setAccount(next);
        setEmailStep(null);
        setAuthStatus('signed-in');
      } catch (e) {
        if (mine !== attempt.current) return;
        setAuthError(e instanceof Error ? e.message : String(e));
        setAuthStatus('signed-out');
      }
    },
    [provider],
  );

  /**
   * The SDK only notices a closed sign-in window after its own timeout, so the
   * user can cancel a pending attempt here.
   */
  const cancelSignIn = useCallback(() => {
    attempt.current++;
    setAuthStatus('signed-out');
  }, []);

  const signOut = useCallback(async () => {
    setAccount(null);
    setAuthStatus('signed-out');
    try {
      await provider.signOut();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    }
  }, [provider]);

  return {
    provider,
    signedIn: authStatus === 'signed-in',
    authStatus,
    authError,
    account,
    signingInWith,
    signInMethods: provider.methods,
    emailStep,
    emailSending,
    emailAdmin: provider.emailAdmin,
    sendEmailCode,
    resetEmail,
    signIn,
    cancelSignIn,
    signOut,
  };
}
