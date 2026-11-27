/**
 * Settings card for identity-canister administrators: connect the email
 * service used for email sign-in. The API key goes from this browser straight
 * to the identity canister and is never shown again.
 */
import { useEffect, useState, type FormEvent } from 'react';
import type { AccountProvider, EmailServiceStatus } from '../core/interfaces';

type Admin = NonNullable<AccountProvider['emailAdmin']>;

export function EmailServiceCard({ admin }: { admin: Admin }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [status, setStatus] = useState<EmailServiceStatus | null>(null);
  const [from, setFrom] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = async () => setStatus(await admin.status());

  useEffect(() => {
    let alive = true;
    admin
      .isAdmin()
      .then(async (yes) => {
        if (!alive) return;
        setIsAdmin(yes);
        if (yes) await refresh();
      })
      .catch(() => setIsAdmin(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  if (!isAdmin) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await admin.configure({ apiKey: apiKey.trim(), from: from.trim() });
      setApiKey('');
      await refresh();
      setMessage({ ok: true, text: 'Email sign-in is on.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await admin.configure(null);
      await refresh();
      setMessage({ ok: true, text: 'Email sign-in is off.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card" aria-labelledby="set-email-service">
      <div className="settings-row">
        <h3 id="set-email-service">Email sign-in service</h3>
        <span className={`status-pill ${status?.configured ? 'is-on' : 'is-off'}`}>
          {status?.configured ? 'On' : 'Off'}
        </span>
      </div>
      <p className="settings-note">
        Administrators only. OpenSocial sends sign-in codes through Resend. Your key goes straight
        from this browser to the identity canister and is never shown again.
      </p>
      {status?.configured && (
        <p className="settings-note">
          Sending as <code>{status.from}</code>. {status.sentToday} of {status.dailyLimit} emails
          sent today.
        </p>
      )}
      <form className="email-service-form" onSubmit={save}>
        <label>
          <span>Sender</span>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="OpenSocial <login@yourdomain.com>"
            required
          />
        </label>
        <label>
          <span>Resend API key (sending access only)</span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="re_…"
            required
          />
        </label>
        <div className="settings-actions">
          <button type="submit" className="pill-btn" disabled={busy}>
            {status?.configured ? 'Replace key' : 'Turn on email sign-in'}
          </button>
          {status?.configured && (
            <button type="button" className="link-btn danger" disabled={busy} onClick={turnOff}>
              Turn off
            </button>
          )}
        </div>
      </form>
      {message && (
        <p className={`result ${message.ok ? 'ok' : 'bad'}`} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
