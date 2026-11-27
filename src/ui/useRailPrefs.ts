/** The rail preferences of the signed-in account, kept in this browser. */
import { useCallback, useEffect, useState } from 'react';
import { normalizeRail, type RailPrefs } from '../core/settings/railPrefs';

const key = (account: string | undefined) => `zc-rail:${account ?? 'signed-out'}`;

function read(account: string | undefined): RailPrefs {
  try {
    return normalizeRail(JSON.parse(localStorage.getItem(key(account)) ?? 'null'));
  } catch {
    return normalizeRail(null);
  }
}

export function useRailPrefs(account: string | undefined) {
  const [prefs, setPrefs] = useState<RailPrefs>(() => read(account));
  useEffect(() => {
    setPrefs(read(account));
    // Other tabs of this browser follow changes.
    const onStorage = (e: StorageEvent) => {
      if (e.key === key(account)) setPrefs(read(account));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [account]);
  const save = useCallback(
    (p: RailPrefs) => {
      setPrefs(p);
      try {
        localStorage.setItem(key(account), JSON.stringify(p));
      } catch {
        /* storage unavailable: kept for this session */
      }
    },
    [account],
  );
  return [prefs, save] as const;
}
