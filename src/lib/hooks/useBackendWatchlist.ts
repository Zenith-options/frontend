import { useCallback, useEffect, useState } from "react";
import { addToWatchlist, getWatchlist, removeFromWatchlist } from "../api/watchlist";
import type { WatchlistItem } from "../api/types";

/**
 * Watchlist from the backend. `token` should be `null` pre-hydration —
 * see useBackendAccount's doc comment for why.
 */
export function useBackendWatchlist(token: string | null) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!token) {
      setItems([]);
      return;
    }
    setLoading(true);
    getWatchlist(token)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (underlying: string) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      await addToWatchlist(underlying, token);
      refresh();
    },
    [token, refresh]
  );

  const remove = useCallback(
    async (underlying: string) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      await removeFromWatchlist(underlying, token);
      refresh();
    },
    [token, refresh]
  );

  return { items, loading, refresh, add, remove };
}
