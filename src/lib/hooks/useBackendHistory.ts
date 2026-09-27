import { useCallback, useEffect, useRef, useState } from "react";
import { getHistoryPage, invalidateHistoryCache } from "../api/history";
import type { HistoryFilters, HistoryPage, HistoryStats, Position } from "../api/types";

const EMPTY_STATS: HistoryStats = {
  trade_count: 0, win_count: 0, loss_count: 0, total_realized_pnl: 0,
};

export interface InfiniteHistoryResult {
  trades: Position[];
  stats: HistoryStats;
  totalFiltered: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  // How many new trades arrived at the top while the user is scrolled down
  newTradeCount: number;
  dismissNewTrades: () => void;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Infinite-scroll history hook.
 *
 * - Fetches page 1 on mount / filter change.
 * - `loadMore()` fetches the next cursor page and deduplicates by trade id.
 * - Polls for new trades at the top; surfaces them as `newTradeCount`
 *   rather than shifting rows while the user is scrolled down.
 * - `refresh()` resets to page 1 (invalidates client-side cache too).
 */
export function useInfiniteHistory(
  token: string | null,
  filters: HistoryFilters,
): InfiniteHistoryResult {
  const [trades, setTrades] = useState<Position[]>([]);
  const [stats, setStats] = useState<HistoryStats>(EMPTY_STATS);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTradeCount, setNewTradeCount] = useState(0);

  // Cursor for the next page
  const nextCursorRef = useRef<string | null>(null);
  // Seen IDs for deduplication
  const seenIdsRef = useRef(new Set<string>());
  // The id of the most recent trade we already know about (for new-trades poll)
  const topTradeIdRef = useRef<string | null>(null);
  // Abort controller for in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  const filtersKey = JSON.stringify(filters);

  // Fetch the first page. Resets all state.
  const fetchFirstPage = useCallback(async () => {
    if (!token) {
      setTrades([]);
      setStats(EMPTY_STATS);
      setTotalFiltered(0);
      setHasMore(false);
      setError(null);
      setNewTradeCount(0);
      nextCursorRef.current = null;
      seenIdsRef.current = new Set();
      topTradeIdRef.current = null;
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setNewTradeCount(0);
    seenIdsRef.current = new Set();

    try {
      const page = await getHistoryPage(token, null, filters);
      // Deduplicate (shouldn't happen on first page but be safe)
      const fresh = page.trades.filter(t => !seenIdsRef.current.has(t.id));
      fresh.forEach(t => seenIdsRef.current.add(t.id));

      setTrades(fresh);
      setStats(page.stats);
      setTotalFiltered(page.total_filtered);
      setHasMore(page.next_cursor !== null);
      nextCursorRef.current = page.next_cursor;
      topTradeIdRef.current = fresh[0]?.id ?? null;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load history");
      setTrades([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filtersKey]);

  // Load the next page and append, deduplicating by id
  const loadMore = useCallback(async () => {
    if (!token || !hasMore || loadingMore || !nextCursorRef.current) return;

    setLoadingMore(true);
    try {
      const page = await getHistoryPage(token, nextCursorRef.current, filters);
      const fresh = page.trades.filter(t => !seenIdsRef.current.has(t.id));
      fresh.forEach(t => seenIdsRef.current.add(t.id));

      setTrades(prev => [...prev, ...fresh]);
      setStats(page.stats);
      setTotalFiltered(page.total_filtered);
      setHasMore(page.next_cursor !== null);
      nextCursorRef.current = page.next_cursor;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, hasMore, loadingMore, filtersKey]);

  // Poll for new trades that arrived at the top while the user is scrolled down.
  // We fetch cursor=null (first page) and count how many IDs we haven't seen.
  const checkForNewTrades = useCallback(async () => {
    if (!token || loading || loadingMore) return;
    try {
      const page: HistoryPage = await getHistoryPage(token, null, filters);
      const unseen = page.trades.filter(t => !seenIdsRef.current.has(t.id));
      if (unseen.length > 0) {
        setNewTradeCount(unseen.length);
      }
    } catch {
      // silently ignore poll errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loading, loadingMore, filtersKey]);

  // Reset and refetch from scratch (also invalidates client cache)
  const refresh = useCallback(() => {
    invalidateHistoryCache();
    fetchFirstPage();
  }, [fetchFirstPage]);

  const dismissNewTrades = useCallback(() => {
    setNewTradeCount(0);
    refresh();
  }, [refresh]);

  // Refetch on mount / filter / token change
  useEffect(() => {
    fetchFirstPage();
    return () => { abortRef.current?.abort(); };
  }, [fetchFirstPage]);

  // Poll every 30 s for new trades
  useEffect(() => {
    const id = setInterval(checkForNewTrades, 30_000);
    return () => clearInterval(id);
  }, [checkForNewTrades]);

  return {
    trades, stats, totalFiltered,
    loading, loadingMore, hasMore, error,
    newTradeCount, dismissNewTrades,
    loadMore, refresh,
  };
}

// Keep the old hook name as a thin re-export so nothing else breaks
export function useBackendHistory(token: string | null) {
  const result = useInfiniteHistory(token, {});
  return {
    trades: result.trades,
    stats: result.stats,
    loading: result.loading,
    refresh: result.refresh,
  };
}
