/** Sign-in and account interfaces (implemented in src/modules/icp-identity). */

export type SignInMethod = 'ii' | 'passkey' | 'passkey-new' | 'email';

/** Second step of email sign-in: the code from the email. */
export interface EmailCodeParams {
  readonly challengeId: string;
  readonly code: string;
}

export interface EmailCodeSent {
  readonly challengeId: string;
  /** Masked address, e.g. a***e@example.com */
  readonly sentTo: string;
}

export interface EmailServiceStatus {
  readonly configured: boolean;
  readonly from: string | null;
  readonly sentToday: number;
  readonly dailyLimit: number;
}

export interface AccountSession {
  /** Text form of the account principal. */
  readonly principal: string;
  readonly provider: 'internet-identity' | 'open-social-identity' | 'mock';
  /** How the user signed in this time. */
  readonly method?: SignInMethod;
}

/**
 * Account sign-in. Distinct from message encryption keys: the account says
 * who the user is to ICP canisters; message keys stay on the device.
 */
export interface AccountProvider {
  /** Sign-in methods this provider can perform right now. */
  readonly methods: readonly SignInMethod[];
  /** Restore a previous, still valid session without user interaction. */
  restore(): Promise<AccountSession | null>;
  /** Start an interactive sign-in. Must be called from a user gesture. */
  signIn(method?: SignInMethod, params?: EmailCodeParams): Promise<AccountSession>;
  signOut(): Promise<void>;
  /** Email sign-in, step 1: send a code. Only when `methods` includes 'email'. */
  sendEmailCode?(email: string): Promise<EmailCodeSent>;
  /**
   * Adds a verified recovery email to the signed-in account (only right after
   * it was created), so signing in with that email opens the same account.
   */
  linkEmail?(challengeId: string, code: string): Promise<void>;
  /** Identity for calling OpenSocial canisters as the signed-in account (null if not available). */
  agentIdentity?(): import('@icp-sdk/core/agent').Identity | null;
  /** Canister holding the device directory and mailbox, if this provider has one. */
  readonly mailboxCanisterId?: string;
  /** Administration of the email service (identity canister admins only). */
  emailAdmin?: {
    isAdmin(): Promise<boolean>;
    status(): Promise<EmailServiceStatus>;
    configure(config: { apiKey: string; from: string; dailyLimit?: number } | null): Promise<void>;
  };
}

/* --------------------------------------------------------- Aleo zPass --- */

/** Claims the application may ask a user to prove without revealing data. */
