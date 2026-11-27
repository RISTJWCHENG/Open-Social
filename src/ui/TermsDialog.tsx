/** The OpenSocial Terms and Conditions in a scrollable dialog with an Agree button. */
import { useCallback, useEffect, useRef, useState } from "react";
import { TERMS, TERMS_INTRO, TERMS_VERSION } from "./terms";

interface Props {
  onAgree: () => void;
  onClose: () => void;
}

const updated = new Date(`${TERMS_VERSION}T00:00:00Z`).toLocaleDateString(
  "en-GB",
  {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  },
);

export function TermsDialog({ onAgree, onClose }: Props) {
  const agree = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(
    null,
  );

  // Phone browsers (iOS in particular) ignore scrollbar colours, so on touch
  // screens the native bar is hidden and this lavender thumb is drawn instead.
  const measure = useCallback(() => {
    const el = body.current;
    if (!el || el.scrollHeight <= el.clientHeight) return setThumb(null);
    const track = el.clientHeight - 8;
    const height = Math.max(32, (track * el.clientHeight) / el.scrollHeight);
    const top =
      4 +
      ((track - height) * el.scrollTop) / (el.scrollHeight - el.clientHeight);
    setThumb({ top, height });
  }, []);
  useEffect(() => {
    const el = body.current;
    measure();
    // Re-measure once layout and fonts settle, and whenever the size changes.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (el && ro) {
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);
  useEffect(() => {
    // A field on the page behind may still have focus (and the phone keyboard
    // open): release it. Only move focus to Agree where there is a mouse, since
    // on a touch screen focusing it brings nothing but can scroll the page.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    if (window.matchMedia?.('(pointer: fine)').matches) agree.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop terms-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="terms"
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-title"
      >
        <header className="terms-head">
          <h2 id="terms-title">OpenSocial Terms and Conditions</h2>
          <p>Last updated {updated}</p>
        </header>
        <div className="terms-scroll">
          <div
            className="terms-body"
            ref={body}
            onScroll={measure}
            tabIndex={0}
            aria-label="Terms text"
          >
            {TERMS_INTRO.map((p) => (
              <p key={p} className="terms-intro">
                {p}
              </p>
            ))}
            {TERMS.map((section, i) => (
              <section key={section.title}>
                <h3>
                  {i + 1}. {section.title}
                </h3>
                <ol>
                  {section.clauses.map((c, j) => (
                    <li key={c}>
                      <span className="terms-num">
                        {i + 1}.{j + 1}
                      </span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          {thumb && (
            <span
              className="terms-thumb"
              aria-hidden="true"
              style={{
                transform: `translateY(${thumb.top}px)`,
                height: thumb.height,
              }}
            />
          )}
        </div>
        <footer className="terms-foot">
          <button type="button" className="link-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            ref={agree}
            className="signup-proceed"
            onClick={onAgree}
          >
            Agree
          </button>
        </footer>
      </div>
    </div>
  );
}
