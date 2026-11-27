/** "Version 1.0.3 · Released Nov 14, 2026", from the build (see docs/VERSIONING.md). */
export const releasedOn = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function AppVersion() {
  return (
    <p className="app-version">
      Version {__APP_VERSION__} · Released {releasedOn(__APP_RELEASED__)}
    </p>
  );
}
