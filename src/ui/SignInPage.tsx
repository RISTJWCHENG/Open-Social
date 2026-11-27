/**
 * Standalone sign-in page with several sign-in methods. Which methods work
 * depends on the account provider: with the OpenSocial identity canister
 * configured, Internet Identity and passkey work; email needs a configured
 * mail service and stays "Soon" without one.
 */
import { useState } from "react";
import type {
  EmailCodeParams,
  EmailCodeSent,
  SignInMethod,
} from "../core/interfaces";
import type { AuthStatus } from "./useAccount";
import {
  ArrowRightIcon,
  IdentityIcon,
  PasskeyIcon,
  SignInMailIcon,
} from "./icons";
import { AppLogo } from "./AppLogo";
import { AppVersion } from "./AppVersion";
import { useNoZoom } from "./useNoZoom";
import { SignUpPage, type SignUpDetails } from "./SignUpPage";

interface Props {
  status: AuthStatus;
  error: string | null;
  methods: readonly SignInMethod[];
  busyWith: SignInMethod | null;
  onSignIn: (method: SignInMethod, params?: EmailCodeParams) => void;
  onCancel: () => void;
  emailStep?: (EmailCodeSent & { email: string }) | null;
  emailSending?: boolean;
  onSendEmail?: (email: string) => void;
  onResetEmail?: () => void;
  /** Creates a new account with a new passkey and the chosen profile details. */
  onSignUp?: (details: SignUpDetails) => void;
}

const SOON = "Not available yet";

const METHODS: {
  id: SignInMethod;
  label: string;
  waiting: string;
  icon: JSX.Element;
}[] = [
  {
    id: "ii",
    label: "Sign in with Internet Identity",
    waiting: "Waiting for Internet Identity…",
    icon: <IdentityIcon />,
  },
  {
    id: "passkey",
    label: "Sign in with Passkey",
    waiting: "Waiting for your passkey…",
    icon: <PasskeyIcon />,
  },
];

export function SignInPage({
  status,
  error,
  methods,
  busyWith,
  onSignIn,
  onCancel,
  emailStep = null,
  emailSending = false,
  onSendEmail,
  onResetEmail,
  onSignUp,
}: Props) {
  useNoZoom();
  const busy = status === "signing-in";
  const emailOn = methods.includes("email") && !!onSendEmail;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [signingUp, setSigningUp] = useState(false);

  if (signingUp && onSignUp && status !== "checking") {
    return (
      <SignUpPage
        busy={busy && busyWith === "passkey-new"}
        error={error}
        onSubmit={onSignUp}
        onCancel={onCancel}
        onClose={() => setSigningUp(false)}
      />
    );
  }

  if (status === "checking") {
    return (
      <main className="signin-page" aria-label="Signed out">
        <div className="signin-card">
          <AppLogo />
          <h2>Checking sign-in…</h2>
          <p className="signin-sub">
            Looking for an existing session on this device.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="signin-page" aria-label="Signed out">
      <div className="signin-stack">
        <div className="signin-card">
          <AppLogo />
          <h2>Sign in to OpenSocial</h2>
          <p className="signin-sub">
            Private messages, encrypted on your device.
          </p>

          {emailStep ? (
            <form
              className="signin-code"
              aria-label="Enter email code"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim().length === 6) {
                  onSignIn("email", {
                    challengeId: emailStep.challengeId,
                    code: code.trim(),
                  });
                }
              }}
            >
              <p className="signin-code-sent">
                We sent a 6-digit code to <strong>{emailStep.sentTo}</strong>.
                It expires in 10 minutes.
              </p>
              <label htmlFor="signin-code" className="sr-only">
                Code from the email
              </label>
              <input
                id="signin-code"
                className="signin-code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                autoFocus
              />
              <button
                type="submit"
                className="signin-method is-primary signin-code-submit"
                disabled={busy || code.length !== 6}
              >
                <span className="signin-method-label">
                  {busy && busyWith === "email" ? "Checking code…" : "Sign in"}
                </span>
              </button>
              <p className="signin-note">
                <button
                  type="button"
                  className="link-btn"
                  disabled={emailSending || busy}
                  onClick={() => {
                    setCode("");
                    onSendEmail?.(emailStep.email);
                  }}
                >
                  Send a new code
                </button>{" "}
                ·{" "}
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => {
                    setCode("");
                    onResetEmail?.();
                  }}
                >
                  Use another sign-in method
                </button>
              </p>
            </form>
          ) : (
            <form
              className="signin-email"
              aria-label="Sign in with email"
              title={emailOn ? undefined : `${SOON}: needs an email service`}
              onSubmit={(e) => {
                e.preventDefault();
                if (emailOn && email.trim()) onSendEmail?.(email.trim());
              }}
            >
              <span className="signin-email-icon" aria-hidden="true">
                <SignInMailIcon />
              </span>
              <label htmlFor="signin-email" className="sr-only">
                Email
              </label>
              <input
                id="signin-email"
                type="email"
                autoComplete="email"
                placeholder="Sign in with email"
                disabled={!emailOn || emailSending || busy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {!emailOn && <span className="soon">Soon</span>}
              <button
                type="submit"
                className={`signin-email-send ${emailOn ? "is-on" : ""}`}
                disabled={!emailOn || emailSending || busy || !email.trim()}
                aria-label={emailSending ? "Sending code" : "Send sign-in code"}
              >
                <ArrowRightIcon />
              </button>
            </form>
          )}

          {!emailStep && (
            <>
              <div className="signin-or" aria-hidden="true">
                <span>or</span>
              </div>

              <div className="signin-methods">
                {METHODS.map((m, i) => {
                  const available = methods.includes(m.id);
                  const active = busy && busyWith === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`signin-method ${i === 0 ? "is-primary" : ""}`}
                      aria-disabled={!available || undefined}
                      aria-label={
                        available ? undefined : `${m.label} (not available yet)`
                      }
                      title={available ? undefined : SOON}
                      disabled={available && busy}
                      onClick={(e) => {
                        if (!available) {
                          e.preventDefault();
                          return;
                        }
                        onSignIn(m.id);
                      }}
                    >
                      <span className="signin-method-icon" aria-hidden="true">
                        {m.icon}
                      </span>
                      <span className="signin-method-label">
                        {active ? m.waiting : m.label}
                      </span>
                      {!available && <span className="soon">Soon</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {!emailStep && methods.includes("passkey-new") && (
            <p className="signin-new">
              Don’t have an OpenSocial account yet?
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onSignUp ? setSigningUp(true) : onSignIn("passkey-new")
                }
              >
                Create your OpenSocial account
              </button>
            </p>
          )}

          {busy && (
            <p className="signin-note">
              Nothing happened or you closed the{" "}
              {busyWith === "ii" ? "Internet Identity tab" : "sign-in prompt"}?{" "}
              <button type="button" className="link-btn" onClick={onCancel}>
                Cancel sign-in
              </button>
            </p>
          )}
          {error && (
            <p className="result bad" role="alert">
              {error}
            </p>
          )}

          <p className="signin-foot">
            OpenSocial never sees a password. After sign{"\u2011"}in, message keys
            are created on this device; signing out deletes them and all
            messages.
          </p>
        </div>
        <AppVersion />
      </div>
    </main>
  );
}
