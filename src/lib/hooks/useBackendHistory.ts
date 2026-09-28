import { getHistory } from "../api/history";
import type { HistoryResponse } from "../api/types";
import { useAsyncQuery } from "../query";

const EMPTY: HistoryResponse = { trades: [], stats: { trade_count: 0, win_count: 0, loss_count: 0, total_realized_pnl: 0 } };

/**
 * Closed/rolled positions + win/loss/pnl stats from the backend. Unlike
 * account/positions, nothing else on the page needs this at the same
 * time, so it's a standalone hook rather than part of
 * BackendDataContext — no risk of two independent copies going out of
 * sync with each other the way AppHeader's balance did.
 */
export function useBackendHistory(token: string | null) {
  const query = useAsyncQuery<HistoryResponse>(
    token ? `history:${token}` : null,
    () => getHistory(token!),
    { authed: true }
  );
  return { ...(query.data ?? EMPTY), loading: query.status === "loading", refresh: query.refetch, query };
}
