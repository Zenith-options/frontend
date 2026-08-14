import { useCallback, useEffect, useState } from "react";
import { getAccount } from "../api/positions";
import type { Account } from "../api/types";

/**
 * Account balance/collateral from the backend. `token` should be `null`
 * whenever the caller hasn't finished its own hydration-safety check —
 * passing a token before that point risks fetching (and rendering) data
 * the server-rendered HTML didn't have, which is exactly the mismatch
 * the useHydrated() pattern documented in the README exists to avoid.
 */
export function useBackendAccount(token: string | null) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!token) {
      setAccount(null);
      return;
    }
    setLoading(true);
    getAccount(token)
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { account, loading, refresh };
}
