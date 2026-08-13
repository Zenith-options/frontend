"use client";

import { useWatchlistStore } from "../lib/store/watchlist";
import { useHydrated } from "../lib/useHydrated";

export function StarButton({ sym }: { sym: string }) {
  const storeIsFavorite = useWatchlistStore(s => s.isFavorite(sym));
  const toggleFavorite = useWatchlistStore(s => s.toggleFavorite);
  const isFavorite = useHydrated() && storeIsFavorite;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggleFavorite(sym); }}
      title={isFavorite ? `Remove ${sym} from watchlist` : `Add ${sym} to watchlist`}
      style={{
        background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 1,
        color: isFavorite ? "var(--atm)" : "var(--text-lo)", fontSize: 13,
      }}
    >
      {isFavorite ? "★" : "☆"}
    </button>
  );
}
