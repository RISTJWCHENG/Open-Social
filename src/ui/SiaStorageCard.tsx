/**
 * Settings card: connect the user's own Sia Storage space and back up /
 * restore this device's chats there.
 */
import { useEffect, useMemo, useState } from 'react';
import type { BackupInfo, SiaAccountInfo, SiaItem } from '../modules/sia-storage';
import { formatSize } from './AttachmentView';

/** The subset of SiaStorageClient the card uses (lets tests pass a fake). */
export interface SiaClientLike {
  isConnected(): boolean;
  resume(): Promise<boolean>;
  requestApproval(): Promise<string>;
  waitForApproval(): Promise<boolean>;
  registerNew(): Promise<string>;
  registerExisting(phrase: string): Promise<void>;
  disconnect(): Promise<void>;
  account(): Promise<SiaAccountInfo>;
  uploadBackup(data: Uint8Array): Promise<string>;
  latestBackup(): Promise<BackupInfo | null>;
  downloadBackup(id: string): Promise<Uint8Array>;
  uploadShared(
    ct: () => ReadableStream<Uint8Array>,
    size: number,
    onProgress?: (f: number) => void,
  ): Promise<{ seed: string; objectId: string }>;
  deleteAll(): Promise<number>;
  listMine(): Promise<SiaItem[]>;
  deleteObject(id: string): Promise<void>;
}

type Stage =
  | { s: 'loading' }
  | { s: 'disconnected' }
  | { s: 'approve'; url: string }
  | { s: 'phrase-new'; phrase: string }
  | { s: 'phrase-existing' }
  | { s: 'connected' };

const gb = (n: number) => `${(n / 1e9).toFixed(n < 1e8 ? 2 : 1)} GB`;

export function SiaStorageCard({
  client,
  exportChats,
  importChats,
}: {
  client: SiaClientLike;
  exportChats: () => Uint8Array;
  importChats: (data: Uint8Array) => Promise<number>;
}) {
  const [stage, setStage] = useState<Stage>({ s: 'loading' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [account, setAccount] = useState<SiaAccountInfo | null>(null);
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMsg({
        ok: false,
        text: /error sending request|failed to fetch|network/i.test(text)
          ? 'Couldn’t reach Sia Storage. Check your connection and try again. On Safari, turn off iCloud Private Relay for this site.'
          : text,
      });
    } finally {
      setBusy(false);
    }
  };

  const [items, setItems] = useState<SiaItem[] | null>(null);
  /** Which delete is waiting for its confirming second click ('all' or an id). */
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = async () => {
    setAccount(await client.account());
    setBackup(await client.latestBackup());
    setItems(await client.listMine());
  };
  const remove = (id: string | 'all') =>
    run(async () => {
      if (confirm !== id) {
        setConfirm(id);
        return;
      }
      setConfirm(null);
      if (id === 'all') {
        const n = await client.deleteAll();
        setMsg({ ok: true, text: `Deleted ${n} item${n === 1 ? '' : 's'} from your Sia storage.` });
      } else {
        await client.deleteObject(id);
        setMsg({ ok: true, text: 'Deleted from your Sia storage.' });
      }
      await refresh();
    });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ok = await client.resume();
        if (!alive) return;
        setStage(ok ? { s: 'connected' } : { s: 'disconnected' });
        if (ok) await refresh();
      } catch (e) {
        if (!alive) return;
        setStage({ s: 'disconnected' });
        setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const connect = () =>
    run(async () => {
      const url = await client.requestApproval();
      setStage({ s: 'approve', url });
      const returning = await client.waitForApproval();
      if (returning) {
        setStage({ s: 'phrase-existing' });
      } else {
        const phrase = await client.registerNew();
        setSaved(false);
        setStage({ s: 'phrase-new', phrase });
      }
    });

  const words = useMemo(() => (stage.s === 'phrase-new' ? stage.phrase.split(' ') : []), [stage]);

  return (
    <section className="settings-card" aria-labelledby="set-sia">
      <div className="settings-row">
        <h3 id="set-sia">Your Sia storage</h3>
        <span className={`status-pill ${stage.s === 'connected' ? 'is-on' : 'is-off'}`}>
          {stage.s === 'connected' ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <p className="settings-note">
        Keep encrypted chat backups and large files you send in your own space on the Sia
        network. You own the account; OpenSocial can’t read what you store. Sia Storage gives each account
        free space to start with.
      </p>

      {stage.s === 'loading' && <p className="settings-note">Checking…</p>}

      {stage.s === 'disconnected' && (
        <div className="settings-actions">
          <button type="button" className="pill-btn" disabled={busy} onClick={connect}>
            {busy ? 'Connecting…' : 'Connect Sia storage'}
          </button>
        </div>
      )}

      {stage.s === 'approve' && (
        <div className="sia-step">
          <p className="settings-note">
            Open Sia Storage and approve OpenSocial. Create a free Sia Storage account there if you
            don’t have one yet. This page continues by itself once you approve.
          </p>
          <div className="settings-actions">
            <a className="pill-btn" href={stage.url} target="_blank" rel="noopener noreferrer">
              Open Sia Storage to approve
            </a>
            <span className="settings-note">Waiting for approval…</span>
          </div>
        </div>
      )}

      {stage.s === 'phrase-new' && (
        <div className="sia-step">
          <p className="settings-note">
            <strong>Save this Sia recovery phrase.</strong> It is shown only now. You need it to
            reach your backups from a new device. Anyone with it can read your Sia data.
          </p>
          <ol className="phrase-grid" aria-label="Sia recovery phrase">
            {words.map((w, i) => (
              <li key={i}>
                <span className="key-pos">{i + 1}</span>
                <code>{w}</code>
              </li>
            ))}
          </ol>
          <label className="confirm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I’ve saved my Sia recovery phrase
          </label>
          <div className="settings-actions">
            <button
              type="button"
              className="pill-btn"
              disabled={!saved}
              onClick={() =>
                run(async () => {
                  setStage({ s: 'connected' });
                  await refresh();
                })
              }
            >
              Done
            </button>
          </div>
        </div>
      )}

      {stage.s === 'phrase-existing' && (
        <form
          className="sia-step"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await client.registerExisting(phraseInput);
              setPhraseInput('');
              setStage({ s: 'connected' });
              await refresh();
            });
          }}
        >
          <p className="settings-note">
            This Sia account has used OpenSocial before. Enter the Sia recovery phrase you saved then.
          </p>
          <label className="sr-only" htmlFor="sia-phrase">
            Sia recovery phrase
          </label>
          <textarea
            id="sia-phrase"
            className="phrase-input"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            value={phraseInput}
            onChange={(e) => setPhraseInput(e.target.value)}
            placeholder="twelve words separated by spaces"
          />
          <div className="settings-actions">
            <button type="submit" className="pill-btn" disabled={busy || !phraseInput.trim()}>
              Reconnect
            </button>
          </div>
        </form>
      )}

      {stage.s === 'connected' && (
        <div className="sia-step">
          {account && (
            <p className="settings-note">
              Using {gb(account.pinnedBytes)}. {gb(account.remainingBytes)} free.
            </p>
          )}
          <p className="settings-note">
            {backup
              ? `Last backup: ${backup.createdAt.toLocaleString()}.`
              : 'No backup yet.'}
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="pill-btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await client.uploadBackup(exportChats());
                  await refresh();
                  setMsg({ ok: true, text: 'Chats backed up to your Sia storage.' });
                })
              }
            >
              {busy ? 'Working…' : 'Back up chats now'}
            </button>
            {backup && (
              <button
                type="button"
                className="link-btn"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const n = await importChats(await client.downloadBackup(backup.id));
                    setMsg({ ok: true, text: `Restored ${n} messages from your Sia storage.` });
                  })
                }
              >
                Restore last backup
              </button>
            )}
            <button
              type="button"
              className="link-btn danger"
              disabled={busy}
              onClick={() => {
                void client.disconnect();
                setAccount(null);
                setBackup(null);
                setStage({ s: 'disconnected' });
              }}
            >
              Disconnect
            </button>
          </div>

          <div className="sia-data">
            <p className="sia-data-title">Your OpenSocial data in Sia</p>
            {items === null ? (
              <p className="settings-note">Loading…</p>
            ) : items.length === 0 ? (
              <p className="settings-note">Nothing stored yet.</p>
            ) : (
              <>
                <ul className="sia-items" aria-label="OpenSocial data in your Sia storage">
                  {items.map((it) => (
                    <li key={it.id}>
                      <span className="sia-item-text">
                        <span className="sia-item-kind">{it.kind === 'backup' ? 'Chat backup' : 'Shared file'}</span>
                        <span className="settings-note">
                          {formatSize(it.sizeBytes)} · {it.createdAt.toLocaleDateString()}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="link-btn danger"
                        disabled={busy}
                        onClick={() => remove(it.id)}
                        aria-label={`Delete ${it.kind === 'backup' ? 'chat backup' : 'shared file'} from ${it.createdAt.toLocaleDateString()}`}
                      >
                        {confirm === it.id ? 'Confirm delete' : 'Delete'}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="settings-note">
                  Deleting frees the space. Friends can no longer download a shared file you delete, unless
                  they already saved it.
                </p>
                <div className="settings-actions">
                  <button type="button" className="ghost-pill danger" disabled={busy} onClick={() => remove('all')}>
                    {confirm === 'all' ? `Confirm: delete all ${items.length}` : 'Delete all OpenSocial data'}
                  </button>
                  {confirm && (
                    <button type="button" className="link-btn" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {msg && (
        <p className={`result ${msg.ok ? 'ok' : 'bad'}`} role="status">
          {msg.text}
        </p>
      )}
    </section>
  );
}
