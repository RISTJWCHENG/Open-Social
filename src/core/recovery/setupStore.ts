/**
 * Remembers, per Internet Identity principal and per browser, which recovery
 * methods the user set up. Stores only the recovery key commitment, never the
 * key. Registration with the recovery canister is Phase C; until then this
 * record exists only in this browser.
 */
export type RecoveryMethod = 'recovery-key' | 'email' | 'phone' | 'zpass';

export interface RecoverySetup {
  readonly methods: RecoveryMethod[];
  readonly recoveryKeyCommitment?: string;
  readonly completedAt: number;
  readonly skipped: boolean;
}

const keyFor = (principal: string) => `opensocial:recovery-setup:${principal}`;

export function loadRecoverySetup(principal: string): RecoverySetup | null {
  try {
    const raw = window.localStorage.getItem(keyFor(principal));
    if (!raw) return null;
    const v = JSON.parse(raw) as RecoverySetup;
    return Array.isArray(v.methods) && typeof v.completedAt === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function saveRecoverySetup(principal: string, setup: RecoverySetup): void {
  try {
    window.localStorage.setItem(keyFor(principal), JSON.stringify(setup));
  } catch {
    // Storage unavailable (private mode): the wizard will simply show again.
  }
}
