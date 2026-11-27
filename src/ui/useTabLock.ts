/**
 * One active OpenSocial tab per account in this browser (Web Locks API).
 *
 * Tabs of one browser share the device keys, the MLS state and the mailbox.
 * Two running at once take each other's messages and overwrite each other's
 * encryption state, so messages can disappear in one direction. Only the tab
 * holding the lock runs messaging; another tab can take over ("Use here").
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type LockManagerLike = {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<void>;
};

const locks = (): LockManagerLike | null =>
  typeof navigator !== 'undefined' && 'locks' in navigator
    ? (navigator as unknown as { locks: LockManagerLike }).locks
    : null;

export interface TabLock {
  /** This tab may run messaging (true where Web Locks aren't available). */
  active: boolean;
  /** Still finding out. */
  pending: boolean;
  /** Take over from the other tab. */
  takeOver(): void;
}

export function useTabLock(principal: string | null): TabLock {
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(true);
  const release = useRef<(() => void) | null>(null);

  const hold = useCallback(
    (steal: boolean) => {
      const lm = locks();
      if (!principal || !lm) {
        setActive(true);
        setPending(false);
        return;
      }
      const name = `open-social-tab:${principal}`;
      void lm
        .request(name, steal ? { steal: true } : { ifAvailable: true }, async (lock) => {
          setPending(false);
          if (!lock) {
            setActive(false);
            return;
          }
          setActive(true);
          // Hold the lock until this tab closes, signs out or another tab takes over.
          await new Promise<void>((resolve) => {
            release.current = resolve;
          });
        })
        .catch(() => {
          // Another tab took over (its request used steal).
          release.current = null;
          setActive(false);
          setPending(false);
        });
    },
    [principal],
  );

  useEffect(() => {
    setPending(true);
    hold(false);
    return () => {
      release.current?.();
      release.current = null;
    };
  }, [hold]);

  const takeOver = useCallback(() => hold(true), [hold]);
  return { active, pending, takeOver };
}
