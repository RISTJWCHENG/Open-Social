/**
 * Loader for OpenMLS (RFC 9420, MIT licence) compiled to WebAssembly in
 * wasm/mls. Loaded lazily the first time real messaging starts.
 */
type Mod = typeof import('../../vendor/open-social-mls/open_social_mls.js');
export type MlsDevice = import('../../vendor/open-social-mls/open_social_mls.js').MlsDevice;

let loading: Promise<Mod> | null = null;
let wasmOverride: Uint8Array | null = null;

/** Tests (Node): provide the wasm bytes instead of fetching them. */
export function setMlsWasm(bytes: Uint8Array) {
  wasmOverride = bytes;
  loading = null;
}

export function loadMls(): Promise<Mod> {
  return (loading ??= (async () => {
    const mod = await import('../../vendor/open-social-mls/open_social_mls.js');
    await mod.default(wasmOverride ? { module_or_path: wasmOverride } : undefined);
    return mod;
  })());
}

/** Safety-number style digits from a public key. */
export async function keyFingerprint(key: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', key));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const n = ((d[i * 2]! << 8) | d[i * 2 + 1]!) % 100000;
    groups.push(n.toString().padStart(5, '0'));
  }
  return groups.join(' ');
}
