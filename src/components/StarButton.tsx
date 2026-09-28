"use client";

import { useState } from "react";
import { useBackendData } from "../lib/context/BackendDataContext";
import { useWalletStore } from "../lib/store/wallet";
import { ApiError } from "../lib/api/client";

export function StarButton({ sym }: { sym: string }) {
  const token = useWalletStore(s => s.token);
  const { watchlist, watchlistQuery, addToWatchlist, removeFromWatchlist } = useBackendData();
  const [pending, setPending] = useState(false);
  const isFavorite = watchlist.some(w => w.underlying === sym);
  // Loading: the star can't claim "not starred" before the watchlist is known.
  const loading = !!token && watchlistQuery.data === undefined && watchlistQuery.status !== "error";
  const failed = !!token && watchlistQuery.status === "error";

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token || pending || loading) return;
    setPending(true);
    try {
      if (isFavorite) await removeFromWatchlist(sym);
      else await addToWatchlist(sym);
    } catch (err) {
      // A no-op click (e.g. a stale double-click racing a removal that
      // already landed) shouldn't surface as a user-facing error — the
      // watchlist state itself is the source of truth, not this button.
      if (!(err instanceof ApiError)) throw err;
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      className="tap"
      onClick={toggle}
      disabled={!token || pending || loading}
      aria-pressed={isFavorite}
      aria-busy={loading || pending}
      aria-label={`${sym} watchlist`}
      title={!token ? "Connect your wallet to use the watchlist"
        : loading ? "Loading watchlist…"
        : failed ? "Watchlist couldn't be loaded"
        : isFavorite ? `Remove ${sym} from watchlist` : `Add ${sym} to watchlist`}
      style={{
        background: "none", border: "none", cursor: !token || loading ? "default" : "pointer", padding: 2, lineHeight: 1,
        color: failed ? "var(--put)" : isFavorite ? "var(--atm)" : "var(--text-lo)", fontSize: 13, opacity: !token || loading ? 0.4 : 1,
      }}
    >
      {isFavorite ? "★" : "☆"}
    </button>
  );
}
