/**
 * Shown above a list while secure messaging is not running on this device:
 * "starting" at first, or why it could not start, with a way to try again.
 * Without it, buttons that need messaging (new chat, add person) just look
 * dead.
 */
export function MessagingStatus(p: { ready: boolean; available: boolean; error: string | null; onRetry: () => void }) {
  if (p.ready || !p.available) return null;
  if (!p.error) {
    return (
      <p className="msg-status" role="status">
        Starting secure messaging on this device…
      </p>
    );
  }
  return (
    <div className="msg-status is-bad" role="alert">
      <p>Secure messaging could not start on this device: {p.error}</p>
      <button type="button" className="pill-btn" onClick={p.onRetry}>
        Try again
      </button>
    </div>
  );
}
