/**
 * Sign-up page for new users (replaces the sign-in page): pick a username and display name, optionally
 * name the person who invited you, then create the account with a new passkey.
 * The profile is published and the inviter added as a contact once the
 * account is ready (see App).
 */
import { useEffect, useRef, useState } from "react";
import { LIMITS } from "../core/profile/profile";
import {
  normalizeUsername,
  usernameKey,
  usernameProblem,
  USERNAME_MAX,
} from "../core/profile/username";
import {
  ProfilesClient,
  type PublicProfile,
} from "../modules/profiles/profilesClient";
import { AppLogo } from "./AppLogo";
import { ProfileAvatar } from "./ProfileAvatar";
import { TermsDialog } from "./TermsDialog";
import { ArrowRightIcon, CloseIcon, MailIcon, SearchIcon } from "./icons";

export interface SignUpDetails {
  username: string;
  displayName: string;
  /** Optional recovery email, verified with a code after the account exists. */
  email: string;
  /** Account principal of the person who invited the user. */
  inviter: { account: string; name: string } | null;
}

interface Props {
  busy: boolean;
  error?: string | null;
  /** Stops waiting for a passkey prompt the user closed. */
  onCancel?: () => void;
  onSubmit: (details: SignUpDetails) => void;
  onClose: () => void;
  /** Overridable for tests. */
  profiles?: Pick<ProfilesClient, "search" | "getPublicAvatar">;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field marks: red for required, grey for optional. */
const Required = () => (
  <span className="mark required" aria-hidden="true">
    *
  </span>
);
const Optional = () => (
  <span className="mark" aria-hidden="true">
    *
  </span>
);

type Availability = "unknown" | "checking" | "free" | "taken";

/** Shows `text` with the part that matched the search in bold (a prefix of a word). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  let at = -1;
  for (let i = 0; q && i <= lower.length - q.length; i++) {
    const wordStart = i === 0 || !/[\p{L}\p{N}]/u.test(lower.charAt(i - 1));
    if (wordStart && lower.startsWith(q, i)) {
      at = i;
      break;
    }
  }
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <strong>{text.slice(at, at + q.length)}</strong>
      {text.slice(at + q.length)}
    </>
  );
}

export function SignUpPage({
  busy,
  error = null,
  onSubmit,
  onCancel,
  onClose,
  profiles,
}: Props) {
  const client = useRef<Pick<ProfilesClient, "search" | "getPublicAvatar">>(
    profiles ?? new ProfilesClient(() => null),
  );
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [availability, setAvailability] = useState<Availability>("unknown");
  const [inviterQuery, setInviterQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  /** The query the shown results belong to ('' when nothing was searched). */
  const [searchedFor, setSearchedFor] = useState("");
  const [inviter, setInviter] = useState<
    (SignUpDetails["inviter"] & { profile: PublicProfile }) | null
  >(null);
  const first = useRef<HTMLInputElement>(null);

  const name = normalizeUsername(username);
  const nameProblem = name ? usernameProblem(name) : null;
  const validName = name !== "" && nameProblem === null;

  // Focus the first field once, when the page opens (not again when the
  // terms open or close, which would bring the phone keyboard back).
  useEffect(() => {
    first.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && !busy && !termsOpen && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose, termsOpen]);

  // Usernames are unique: check while typing (the profiles canister enforces it too).
  useEffect(() => {
    if (!validName) {
      setAvailability("unknown");
      return;
    }
    setAvailability("checking");
    let alive = true;
    const t = setTimeout(() => {
      client.current
        .search(name)
        .then(
          (found) =>
            alive &&
            setAvailability(
              found.some((p) => usernameKey(p.username) === usernameKey(name))
                ? "taken"
                : "free",
            ),
        )
        .catch(() => alive && setAvailability("unknown"));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [name, validName]);

  useEffect(() => {
    const q = inviterQuery.trim().replace(/^@/, "");
    if (inviter || q.length < 1) {
      setResults([]);
      setSearchedFor("");
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      client.current
        .search(q)
        .then((found) => {
          if (!alive) return;
          setResults(found);
          setSearchedFor(q);
        })
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [inviterQuery, inviter]);

  const usernameHint =
    nameProblem !== null
      ? nameProblem
      : availability === "taken"
        ? "This username is taken."
        : availability === "free"
          ? "Available."
          : null;
  // The check is advisory; the profiles canister rejects a taken username in any case.
  const emailBad = email !== "" && !EMAIL.test(email);
  const canSubmit =
    validName && availability !== "taken" && !emailBad && agreed && !busy;

  return (
    <main className="signin-page" aria-label="Sign up">
      <form
        className="signup"
        aria-labelledby="signup-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onSubmit({
            username: name,
            displayName: displayName.trim() || name,
            email,
            inviter: inviter && {
              account: inviter.account,
              name: inviter.name,
            },
          });
        }}
      >
        <header className="signup-head">
          <AppLogo />
          <div>
            <h2 id="signup-title">Sign up to OpenSocial</h2>
            <p>Private by design. Encrypted on your device.</p>
          </div>
          <button
            type="button"
            className="signup-back"
            aria-label="Back to sign-in"
            disabled={busy}
            onClick={onClose}
          >
            <ArrowRightIcon className="flip-x" />
          </button>
        </header>

        <label className="signup-field">
          <span>
            Username <Required />{" "}
            <small>
              (alphanumerics, numbers, dots &amp; underscores)
            </small>
          </span>
          <span className="signup-input">
            <input
              ref={first}
              value={username}
              maxLength={USERNAME_MAX * 2}
              autoComplete="username"
              spellCheck={false}
              placeholder="Choose a username"
              aria-invalid={usernameHint !== null && availability !== "free"}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
            />
            <span className="signup-count">{[...name].length || ""}</span>
          </span>
          {usernameHint && (
            <span
              className={`signup-hint ${availability === "free" ? "ok" : "bad"}`}
            >
              {usernameHint}
            </span>
          )}
        </label>

        <label className="signup-field">
          <span>
            Display name <Optional /> <small>(shown to your contacts)</small>
          </span>
          <span className="signup-input">
            <input
              value={displayName}
              maxLength={LIMITS.displayName}
              autoComplete="name"
              placeholder="Enter your name (optional)"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </span>
        </label>

        <label className="signup-field">
          <span>
            Email address <Optional />{" "}
            <small>(used to recover your account)</small>
          </span>
          <span className="signup-input">
            <MailIcon />
            <input
              type="email"
              value={email}
              autoComplete="email"
              placeholder="Enter your email address (optional)"
              aria-invalid={emailBad}
              onChange={(e) => setEmail(e.target.value.trim())}
            />
          </span>
          {emailBad && (
            <span className="signup-hint bad">
              Enter a valid email address.
            </span>
          )}
        </label>

        <div className="signup-field">
          <span id="signup-inviter">
            Did someone invite you? <Optional />
          </span>
          {inviter ? (
            <span className="signup-input signup-chosen">
              <ProfileAvatar
                profiles={client.current}
                profile={inviter.profile}
                className="avatar-24"
              />
              <span className="signup-chosen-name">
                {inviter.name} <span>@{inviter.profile.username}</span>
              </span>
              <button
                type="button"
                className="signup-clear"
                aria-label="Remove the person who referred you"
                onClick={() => setInviter(null)}
              >
                <CloseIcon />
              </button>
            </span>
          ) : (
            <span className="signup-input">
              <SearchIcon />
              <input
                aria-labelledby="signup-inviter"
                value={inviterQuery}
                placeholder="Search for the user who referred you"
                onChange={(e) => setInviterQuery(e.target.value)}
              />
              {inviterQuery && (
                <button
                  type="button"
                  className="signup-clear"
                  aria-label="Clear search"
                  onClick={() => setInviterQuery("")}
                >
                  <CloseIcon />
                </button>
              )}
            </span>
          )}
          {!inviter && results.length > 0 && (
            <ul className="signup-results" aria-label="People found">
              {results.map((p) => (
                <li key={p.account}>
                  <button
                    type="button"
                    aria-label={`${p.displayName || p.username} @${p.username}`}
                    onClick={() => {
                      setInviter({
                        account: p.account,
                        name: p.displayName || `@${p.username}`,
                        profile: p,
                      });
                      setInviterQuery("");
                    }}
                  >
                    <ProfileAvatar profiles={client.current} profile={p} />
                    <span className="signup-result-text">
                      <span className="signup-result-name">
                        <Highlight
                          text={p.displayName || p.username}
                          query={searchedFor}
                        />
                      </span>
                      <span className="signup-result-user">
                        @<Highlight text={p.username} query={searchedFor} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!inviter && searchedFor && results.length === 0 && (
            <span className="signup-hint">
              No public profiles match “{searchedFor}”.
            </span>
          )}
        </div>

        <p className="signup-note">
          Your username and display name are public so friends can find you; you
          can make your profile friends-only later in Settings. A new passkey on
          this device signs you in.
        </p>

        {busy && onCancel && (
          <p className="signup-note">
            Nothing happened or you closed the passkey prompt?{" "}
            <button type="button" className="link-btn" onClick={onCancel}>
              Cancel
            </button>
          </p>
        )}
        {error && (
          <p className="result bad" role="alert">
            {error}
          </p>
        )}

        <div className="signup-actions">
          <label className="signup-terms">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I agree to the{" "}
              <button
                type="button"
                className="signup-terms-link"
                onClick={() => setTermsOpen(true)}
              >
                OpenSocial terms &amp; conditions
              </button>
            </span>
          </label>
          <button
            type="submit"
            className="signup-proceed"
            disabled={!canSubmit}
          >
            {busy ? "Creating your account…" : "Create account"}
          </button>
        </div>
      </form>
      {termsOpen && (
        <TermsDialog
          onAgree={() => {
            setAgreed(true);
            setTermsOpen(false);
          }}
          onClose={() => setTermsOpen(false)}
        />
      )}
    </main>
  );
}
