/**
 * First sign-in setup: the user picks second factors for account recovery.
 * Recovery = Internet Identity (first factor) + any ONE registered second factor.
 *
 * Available now: recovery key (generated and verified on this device).
 * Shown but not yet available: email, phone, and the optional verified-identity
 * Aleo zPass credential (issued by OpenSocial to the user's Aleo wallet).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  generateRecoveryKey,
  normalizeRecoveryInput,
  type RecoveryKey,
} from '../core/recovery/recoveryKey';
import type { RecoveryMethod, RecoverySetup } from '../core/recovery/setupStore';
import { CheckIcon } from './icons';
import { CopyButton } from './CopyButton';
import { RECOVERY_METHODS, waitLabel } from '../core/recovery/methods';

type Step = 'choose' | 'show-key' | 'verify-key' | 'done';

interface Props {
  principal: string;
  onComplete: (setup: RecoverySetup) => void;
  /**
   * 'setup': first sign-in, starts with the method choice.
   * 'key': create or replace only the recovery key (from Settings).
   */
  mode?: 'setup' | 'key';
  /** Leave the key flow without changes (mode 'key' only). */
  onCancel?: () => void;
}


/** Two distinct group positions (1-based) for the user to re-type. */
function pickPositions(): [number, number] {
  const a = 1 + Math.floor(Math.random() * 8);
  let b = 1 + Math.floor(Math.random() * 8);
  if (b === a) b = (a % 8) + 1;
  return a < b ? [a, b] : [b, a];
}

export function Onboarding({ principal, onComplete, mode = 'setup', onCancel }: Props) {
  const [step, setStep] = useState<Step>(mode === 'key' ? 'show-key' : 'choose');
  const [selected, setSelected] = useState<Set<RecoveryMethod>>(new Set(['recovery-key']));
  const [key, setKey] = useState<RecoveryKey | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const positions = useMemo(pickPositions, [key]);
  const [answers, setAnswers] = useState(['', '']);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    if (step === 'show-key' && !key) void generateRecoveryKey().then(setKey);
  }, [step, key]);

  const toggle = (id: RecoveryMethod) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const finish = (skipped: boolean) => {
    const setup: RecoverySetup = {
      methods: skipped ? [] : [...selected],
      ...(key && !skipped ? { recoveryKeyCommitment: key.commitment } : {}),
      completedAt: Date.now(),
      skipped,
    };
    onComplete(setup);
  };

  const verify = () => {
    if (!key) return;
    const ok = positions.every(
      (pos, i) => normalizeRecoveryInput(answers[i] ?? '') === key.groups[pos - 1],
    );
    if (ok) {
      setVerifyError(null);
      setStep('done');
    } else {
      setVerifyError('Those groups don’t match. Check what you wrote down and try again.');
    }
  };

  const copy = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const stepNumber =
    mode === 'key'
      ? { choose: 1, 'show-key': 1, 'verify-key': 2, done: 3 }[step]
      : { choose: 1, 'show-key': 2, 'verify-key': 3, done: 4 }[step];
  const stepTotal = mode === 'key' ? 3 : 4;

  return (
    <main
      className="chat-main onboard-page"
      aria-label={mode === 'key' ? 'Create recovery key' : 'Set up account recovery'}
    >
      <div className="onboard">
        <p className="onboard-step">
          Step {stepNumber} of {stepTotal}
        </p>

        {step === 'choose' && (
          <>
            <h2>Protect your account</h2>
            <p className="onboard-lead">
              Lost this device? Sign in with Internet Identity on a new one, then confirm with any
              one of the second factors you add here. Add more than one as a backup.
            </p>

            <fieldset className="onboard-options">
              <legend>Second factor: add one or more</legend>
              {RECOVERY_METHODS.map((m) => (
                <label
                  key={m.id}
                  className={`option ${selected.has(m.id) ? 'on' : ''} ${m.available ? '' : 'off'}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    disabled={!m.available}
                    onChange={() => toggle(m.id)}
                  />
                  <span className="option-box" aria-hidden="true">
                    {selected.has(m.id) && <CheckIcon width={12} height={12} />}
                  </span>
                  <span className="option-text">
                    <span className="option-title">
                      {m.title}
                      {m.recommended && <span className="rec">Recommended</span>}
                      {m.optional && <span className="soon">Optional</span>}
                    </span>
                    <span className="option-detail">{m.detail}</span>
                    <span className="option-wait">{waitLabel(m.waitHours)} before recovery completes</span>
                    {m.note && <span className="option-note">{m.note}</span>}
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="onboard-actions">
              <button
                type="button"
                className="pill-btn"
                disabled={!selected.has('recovery-key')}
                onClick={() => setStep('show-key')}
              >
                Continue
              </button>
              <button type="button" className="link-btn" onClick={() => finish(true)}>
                Skip for now
              </button>
            </div>
            <p className="small muted">
              Skipping means a lost device can’t be recovered. You can set this up later in
              Settings.
            </p>
          </>
        )}

        {step === 'show-key' && (
          <>
            <h2>Save your recovery key</h2>
            <p className="onboard-lead">
              Write it down or store it in a password manager. It’s shown only now. Anyone with
              this key can take over recovery, so keep it private.
            </p>
            {key ? (
              <ol className="key-grid" aria-label="Recovery key">
                {key.groups.map((g, i) => (
                  <li key={i}>
                    <span className="key-pos">{i + 1}</span>
                    <code>{g}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Generating…</p>
            )}
            <div className="onboard-actions">
              <button type="button" className="ghost-pill" onClick={copy} disabled={!key}>
                {copied ? 'Copied' : 'Copy key'}
              </button>
            </div>
            <label className="confirm">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              I’ve saved my recovery key somewhere safe
            </label>
            <div className="onboard-actions">
              <button
                type="button"
                className="pill-btn"
                disabled={!key || !saved}
                onClick={() => setStep('verify-key')}
              >
                Continue
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => (mode === 'key' ? onCancel?.() : setStep('choose'))}
              >
                {mode === 'key' ? 'Cancel' : 'Back'}
              </button>
            </div>
          </>
        )}

        {step === 'verify-key' && key && (
          <>
            <h2>Check your recovery key</h2>
            <p className="onboard-lead">
              Type groups {positions[0]} and {positions[1]} from the key you saved.
            </p>
            <div className="verify-row">
              {positions.map((pos, i) => (
                <label key={pos} className="verify-field">
                  <span>Group {pos}</span>
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={6}
                    value={answers[i]}
                    onChange={(e) =>
                      setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))
                    }
                  />
                </label>
              ))}
            </div>
            {verifyError && (
              <p className="result bad" role="alert">
                {verifyError}
              </p>
            )}
            <div className="onboard-actions">
              <button type="button" className="pill-btn" onClick={verify}>
                Verify
              </button>
              <button type="button" className="link-btn" onClick={() => setStep('show-key')}>
                Show key again
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <h2>{mode === 'key' ? 'New recovery key saved' : 'Recovery is set up'}</h2>
            <ul className="summary">
              <li>
                <CheckIcon /> Recovery key saved and checked
              </li>
              <li className="pending">
                Registration with the ICP recovery service: added when that service exists. Until
                then this setup is remembered only in this browser.
              </li>
            </ul>
            <p className="small muted">
              Key fingerprint <code>{key?.commitment.slice(0, 16)}</code>. Only this fingerprint is
              stored, never the key.
            </p>
            <div className="onboard-actions">
              <button type="button" className="pill-btn" onClick={() => finish(false)}>
                {mode === 'key' ? 'Back to settings' : 'Start chatting'}
              </button>
            </div>
          </>
        )}
        <p className="onboard-account small muted">
          Account <code>{principal}</code> <CopyButton text={principal} label="Copy" />
        </p>
      </div>
    </main>
  );
}
