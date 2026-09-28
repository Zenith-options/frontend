import { useCallback } from "react";
import { addToWatchlist, getWatchlist, removeFromWatchlist } from "../api/watchlist";
import type { WatchlistItem } from "../api/types";
import { useAsyncQuery } from "../query";

const NO_ITEMS: WatchlistItem[] = [];

/**
 * Watchlist from the backend. `token` should be `null` pre-hydration —
 * see useBackendAccount's doc comment for why.
 */
export function useBackendWatchlist(token: string | null) {
  const query = useAsyncQuery<WatchlistItem[]>(
    token ? `watchlist:${token}` : null,
    () => getWatchlist(token!),
    { authed: true }
  );
  const refresh = query.refetch;
  const items = query.data ?? NO_ITEMS;
  const loading = query.status === "loading";

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

  return { items, loading, refresh, add, remove, query };
}
