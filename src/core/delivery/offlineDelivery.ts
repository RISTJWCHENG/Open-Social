/**
 * Offline delivery interface. The ICP mailbox canister implements it today;
 * a blind-peer implementation can replace it later without touching callers.
 */
export interface DeviceAddress {
  /** Recipient account principal (text). */
  account: string;
  deviceId: string;
}

export interface DeliveredItem {
  /** Transport-specific id, increasing per mailbox. */
  id: bigint;
  /** Sender account principal as authenticated by the transport. */
  from: string;
  receivedAtMs: number;
  entry: Uint8Array;
}

export interface OfflineDelivery {
  /** Store an encrypted entry for a device. */
  deposit(to: DeviceAddress, entry: Uint8Array): Promise<void>;
  /**
   * Store several entries in one call, in order (optional). Returns the indexes
   * of entries skipped because their device's mailbox is full (that device
   * gets none of its entries; the others get theirs).
   */
  depositMany?(items: { to: DeviceAddress; entry: Uint8Array; ephemeral?: boolean }[]): Promise<number[] | void>;
  /** Entries waiting for this device, after `after`. */
  fetch(deviceId: string, after: bigint): Promise<DeliveredItem[]>;
  /** Let the transport delete entries up to and including `upTo`. */
  ack(deviceId: string, upTo: bigint): Promise<void>;
}

export interface PublishedDevice {
  deviceId: string;
  encryptionKey: Uint8Array;
  signingKey: Uint8Array;
  label: string;
}

/** Where device public keys are published and looked up. */
export interface DeviceDirectory {
  register(device: PublishedDevice): Promise<void>;
  devicesOf(account: string): Promise<PublishedDevice[]>;
  /** Publishes MLS key packages: a new last-resort one (replacing the set) and/or single-use ones. Returns single-use ones left. */
  publishKeyPackages(deviceId: string, lastResort: Uint8Array | null, singleUse: Uint8Array[]): Promise<number>;
  /** A device's last-resort key package and one single-use key package (each handed out once). */
  claimKeyPackage(account: string, deviceId: string): Promise<{ lastResort: Uint8Array; singleUse: Uint8Array | null } | null>;
}
