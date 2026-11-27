/** A small modal asking for one line of text (e.g. a contact's name). Enter saves, Escape cancels. */
import { useEffect, useRef, useState, type FormEvent } from 'react';

interface Props {
  title: string;
  label: string;
  initial: string;
  hint?: string;
  confirmLabel: string;
  maxLength?: number;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({ title, label, initial, hint, confirmLabel, maxLength = 60, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onConfirm(value.trim());
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-title" onSubmit={submit}>
        <h2 id="prompt-title">{title}</h2>
        <label className="field">
          <span>{label}</span>
          <input ref={input} value={value} maxLength={maxLength} onChange={(e) => setValue(e.target.value)} />
        </label>
        {hint && <p>{hint}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost-pill" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="pill-btn">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
