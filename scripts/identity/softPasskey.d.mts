import type { Identity } from '@icp-sdk/core/agent';

export interface SoftPasskeyResult {
  prepared: {
    user_key: Uint8Array | number[];
    expiration_ns: bigint;
    account_principal: { toText(): string };
    new_account: boolean;
  };
  identity: Identity;
}

export declare class SoftPasskey {
  constructor(options: { canisterId: string; origin: string; host?: string });
  register(sessionTtlSeconds?: number): Promise<SoftPasskeyResult>;
  signIn(sessionTtlSeconds?: number, options?: { tamper?: boolean }): Promise<SoftPasskeyResult>;
}
