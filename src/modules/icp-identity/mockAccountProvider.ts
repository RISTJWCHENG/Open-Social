/**
 * MOCK account provider for automated tests. Never used by the app at runtime.
 */
import type {
  AccountProvider,
  AccountSession,
  EmailCodeParams,
  EmailCodeSent,
  SignInMethod,
} from '../../core/interfaces';
import { OpenSocialError } from '../../core/types';


export const MOCK_PRINCIPAL = 'mock-principal-for-tests';

export class MockAccountProvider implements AccountProvider {
  lastMethod: string | undefined;
  signInCalls = 0;
  signOutCalls = 0;
  failNextSignIn = false;
  /** When set, the next sign-in never settles (like a closed popup). */
  hangNextSignIn = false;

  constructor(
    private session: AccountSession | null = null,
    readonly methods: readonly SignInMethod[] = ['ii', 'passkey', 'passkey-new', 'email'],
  ) {}

  async restore(): Promise<AccountSession | null> {
    return this.session;
  }

  /** The code the mock "emails"; tests read it to sign in. */
  readonly emailCode = '424242';
  emailsSent: string[] = [];

  async sendEmailCode(email: string): Promise<EmailCodeSent> {
    if (!email.includes('@')) throw new OpenSocialError('BAD_EMAIL', 'Enter a valid email address');
    this.emailsSent.push(email);
    return { challengeId: `mock-${this.emailsSent.length}`, sentTo: email.replace(/^(.).*@/, '$1***@') };
  }

  /** Recovery emails linked by tests, by challenge id. */
  linkedEmails: string[] = [];

  async linkEmail(challengeId: string, code: string): Promise<void> {
    if (code.trim() !== this.emailCode) throw new OpenSocialError('EMAIL_CODE', 'Wrong code. 4 tries left.');
    this.linkedEmails.push(challengeId);
  }

  async signIn(method: SignInMethod = 'ii', params?: EmailCodeParams): Promise<AccountSession> {
    if (method === 'email' && params?.code !== this.emailCode) {
      throw new OpenSocialError('EMAIL_CODE', 'Wrong code. 4 tries left.');
    }
    this.signInCalls++;
    this.lastMethod = method;
    if (this.hangNextSignIn) {
      this.hangNextSignIn = false;
      return new Promise<AccountSession>(() => {});
    }
    if (this.failNextSignIn) {
      this.failNextSignIn = false;
      throw new OpenSocialError('AUTH_SIGN_IN_FAILED', 'Sign-in window was closed.');
    }
    this.session = { principal: MOCK_PRINCIPAL, provider: 'mock', method };
    return this.session;
  }

  async signOut(): Promise<void> {
    this.signOutCalls++;
    this.session = null;
  }
}
