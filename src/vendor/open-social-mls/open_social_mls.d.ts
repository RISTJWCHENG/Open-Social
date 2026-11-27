/* tslint:disable */
/* eslint-disable */
export function mlsVersion(): string;
export class MlsDevice {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  exportState(): Uint8Array;
  hasOutbound(remote: string): boolean;
  /**
   * `count` single-use KeyPackages, or one last-resort KeyPackage, TLS-serialized.
   */
  keyPackages(count: number, last_resort: boolean): Array<any>;
  signatureKey(): Uint8Array;
  /**
   * Joins the remote device's outbound group from its Welcome.
   */
  acceptWelcome(remote: string, welcome: Uint8Array): void;
  /**
   * Creates our outbound group with the remote device; returns the Welcome to send it.
   */
  startOutbound(remote: string, key_package: Uint8Array): Uint8Array;
  /**
   * Signature key of the remote device in our inbound or outbound group (for safety numbers).
   */
  remoteSignatureKey(remote: string): Uint8Array | undefined;
  /**
   * New device with a fresh Ed25519 signature key. `identity` is the device address.
   */
  static create(identity: string): MlsDevice;
  /**
   * Processes a message from the remote device's outbound group.
   * Returns the plaintext of application messages, or undefined for commits.
   */
  decrypt(remote: string, bytes: Uint8Array): Uint8Array | undefined;
  /**
   * Encrypts for the remote device. Returns 1 or 2 MLS messages (a self-update commit first, sometimes).
   */
  encrypt(remote: string, plaintext: Uint8Array): Array<any>;
  /**
   * Restores a device from `exportState`.
   */
  static restore(bytes: Uint8Array): MlsDevice;
  /**
   * Joins a group chat from a Welcome; returns the chat's id.
   */
  groupJoin(welcome: Uint8Array): string;
  groupEpoch(gid: string): bigint;
  /**
   * The shard took our pending commit: move to the next epoch.
   */
  groupMerge(gid: string): void;
  /**
   * Starts a group chat with only this device in it (epoch 0).
   */
  groupCreate(gid: string): void;
  /**
   * Forgets a group chat (left, removed, or deleted).
   */
  groupDelete(gid: string): void;
  /**
   * A pending commit removing every leaf of these device addresses: { commit }.
   */
  groupRemove(gid: string, identities: string[]): object;
  /**
   * The shard refused our pending commit (another came first): forget it.
   */
  groupDiscard(gid: string): void;
  /**
   * Encrypts one message for everyone in the group.
   */
  groupEncrypt(gid: string, plaintext: Uint8Array): Uint8Array;
  /**
   * Device addresses in the group.
   */
  groupMembers(gid: string): Array<any>;
  /**
   * Processes a message from the group's stream:
   * { kind: 'app', sender, data } or
   * { kind: 'commit', sender, epoch, added: [address], removed: [address], selfRemoved }.
   */
  groupProcess(gid: string, bytes: Uint8Array): object;
  groupHasPending(gid: string): boolean;
  /**
   * A pending commit renewing our own leaf's keys (post-compromise security): { commit }.
   */
  groupSelfUpdate(gid: string): object;
  /**
   * A pending commit adding these devices (TLS key packages): { commit, welcome }.
   */
  groupAdd(gid: string, key_packages: Array<any>): object;
  groupHas(gid: string): boolean;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_mlsdevice_free: (a: number, b: number) => void;
  readonly mlsVersion: (a: number) => void;
  readonly mlsdevice_acceptWelcome: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly mlsdevice_create: (a: number, b: number, c: number) => void;
  readonly mlsdevice_decrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly mlsdevice_encrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly mlsdevice_exportState: (a: number, b: number) => void;
  readonly mlsdevice_groupAdd: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly mlsdevice_groupCreate: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_groupDelete: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_groupDiscard: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_groupEncrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly mlsdevice_groupEpoch: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_groupHas: (a: number, b: number, c: number) => number;
  readonly mlsdevice_groupHasPending: (a: number, b: number, c: number) => number;
  readonly mlsdevice_groupJoin: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_groupMembers: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_groupMerge: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_groupProcess: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly mlsdevice_groupRemove: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly mlsdevice_groupSelfUpdate: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_hasOutbound: (a: number, b: number, c: number) => number;
  readonly mlsdevice_keyPackages: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_remoteSignatureKey: (a: number, b: number, c: number, d: number) => void;
  readonly mlsdevice_restore: (a: number, b: number, c: number) => void;
  readonly mlsdevice_signatureKey: (a: number, b: number) => void;
  readonly mlsdevice_startOutbound: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly __wbindgen_export_0: (a: number) => void;
  readonly __wbindgen_export_1: (a: number, b: number) => number;
  readonly __wbindgen_export_2: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export_3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
