import { useCallback, useEffect, useState } from "react";
import { getHistory } from "../api/history";
import type { HistoryResponse } from "../api/types";

const EMPTY: HistoryResponse = { trades: [], stats: { trade_count: 0, win_count: 0, loss_count: 0, total_realized_pnl: 0 } };

/**
 * Closed/rolled positions + win/loss/pnl stats from the backend. Unlike
 * account/positions, nothing else on the page needs this at the same
 * time, so it's a standalone hook rather than part of
 * BackendDataContext — no risk of two independent copies going out of
 * sync with each other the way AppHeader's balance did.
 */
export function useBackendHistory(token: string | null) {
  const [data, setData] = useState<HistoryResponse>(EMPTY);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!token) {
      setData(EMPTY);
      return;
    }
    setLoading(true);
    getHistory(token)
      .then(setData)
      .catch(() => setData(EMPTY))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...data, loading, refresh };
}
