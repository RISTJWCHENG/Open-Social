/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENSOCIAL_IDENTITY_CANISTER_ID?: string;
}

declare const __BUILD_COMMIT__: string;
/** App version, e.g. "1.0.3" (see docs/VERSIONING.md). */
declare const __APP_VERSION__: string;
/** ISO date of the commit this build was made from. */
declare const __APP_RELEASED__: string;
