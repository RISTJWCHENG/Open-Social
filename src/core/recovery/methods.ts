/**
 * Second-factor methods for account recovery. Internet Identity is the first
 * factor; any ONE registered second factor is enough to start a recovery.
 * Weaker factors get a longer waiting period before the recovery takes effect,
 * so the real owner has time to notice and stop it.
 */
import type { RecoveryMethod } from './setupStore';

export interface RecoveryMethodInfo {
  readonly id: RecoveryMethod;
  readonly title: string;
  readonly detail: string;
  readonly available: boolean;
  readonly recommended?: boolean;
  readonly optional?: boolean;
  /** Waiting period before a recovery with this method takes effect. */
  readonly waitHours: number;
  readonly note?: string;
}

export const RECOVERY_METHODS: readonly RecoveryMethodInfo[] = [
  {
    id: 'recovery-key',
    title: 'Recovery key',
    detail: 'A 36-character key you write down or store offline. Works without any service.',
    available: true,
    recommended: true,
    waitHours: 24,
  },
  {
    id: 'email',
    title: 'Email',
    detail: 'A one-time code by email. Weaker: a taken-over mailbox could start a recovery.',
    available: false,
    waitHours: 72,
    note: 'Coming later: needs an email service',
  },
  {
    id: 'phone',
    title: 'Phone number',
    detail: 'A one-time code by SMS. Weaker: SIM swaps are common.',
    available: false,
    waitHours: 72,
    note: 'Coming later: needs an SMS service',
  },
  {
    id: 'zpass',
    title: 'Aleo zPass credential',
    detail:
      'OpenSocial issues a credential to your Aleo wallet after you sign in with Internet Identity. To recover, prove in zero knowledge that you hold it. Not an ID check: keep your Aleo wallet backed up, or this factor is lost with your device.',
    available: false,
    optional: true,
    waitHours: 24,
    note: 'Optional, coming later: needs the OpenSocial issuer service and an Aleo wallet',
  },
];

export const waitLabel = (hours: number) => `${hours} h wait`;
