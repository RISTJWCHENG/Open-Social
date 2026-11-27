/**
 * Confirms the recovery email given at sign-up: the user types the 6-digit
 * code that was emailed, which links the address to the new account.
 */
import { useEffect, useRef, useState } from 'react';

interface Props {
  sentTo: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  onSkip: () => void;
}

export function VerifyEmailDialog({ sentTo, onVerify, onResend, onSkip }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog verify-email"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verify-email-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) void run(() => onVerify(code));
        }}
      >
        <h2 id="verify-email-title">Confirm your recovery email</h2>
        <p>
          We sent a 6-digit code to <strong>{sentTo}</strong>. Enter it to add this email to your account, so you
          can sign in with it if you lose this device. The code expires in 10 minutes.
        </p>
        <label htmlFor="verify-email-code" className="sr-only">
          Code from the email
        </label>
        <input
          id="verify-email-code"
          ref={input}
          className="signin-code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error && (
          <p className="result bad" role="alert">
            {error}
          </p>
        )}
        {resent && !error && <p className="verify-email-note">A new code is on its way.</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="link-btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onResend();
                setCode('');
                setResent(true);
              })
            }
          >
            Send a new code
          </button>
          <button type="button" className="ghost-pill" disabled={busy} onClick={onSkip}>
            Skip
          </button>
          <button type="submit" className="pill-btn" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}
