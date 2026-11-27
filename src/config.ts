/**
 * Build-time configuration. Set VITE_OPENSOCIAL_IDENTITY_CANISTER_ID to the
 * OpenSocial identity canister to enable passkey and email sign-in; without it
 * the app signs in with Internet Identity directly.
 */
export const IDENTITY_CANISTER_ID: string | undefined =
  import.meta.env.VITE_OPENSOCIAL_IDENTITY_CANISTER_ID || undefined;

/**
 * The app's original address. Internet Identity principals and passkeys stay
 * tied to it, so on the app's own domain (chat.opensocial.cc) accounts are the
 * same as here: the canister lists that domain in
 * /.well-known/ii-alternative-origins and /.well-known/webauthn.
 */
export const CANONICAL_ORIGIN = 'https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io';

/** Addresses the app is published at besides the canonical one. */
export const APP_ORIGINS = ['https://chat.opensocial.cc'] as const;

/** The derivation origin for Internet Identity on this page, if it is not the canonical address. */
export function iiDerivationOrigin(origin: string): string | undefined {
  return (APP_ORIGINS as readonly string[]).includes(origin) ? CANONICAL_ORIGIN : undefined;
}
