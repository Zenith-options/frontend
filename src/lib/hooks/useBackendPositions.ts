import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closePosition,
  getPortfolioGreeks,
  listPositions,
  openPosition,
  rollPosition,
  type OpenPositionParams,
} from "../api/positions";
import { executeStrategy } from "../api/strategies";
import { queryKeys } from "../api/queryKeys";
import type { AggregateGreeks } from "../api/types";

const ZERO_GREEKS: AggregateGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
const NO_TOKEN = "Connect and sign in with your wallet first";

/**
 * Open positions + aggregate portfolio Greeks from the backend, plus the
 * open/close/roll/strategy mutations. Every mutation invalidates
 * positions, greeks and account — the backend (not this hook) is the source
 * of truth for premium, collateral and realized P&L. Queries are disabled
 * while `token` is null (pre-hydration / signed out) and failures surface
 * as `error` instead of an empty list.
 */
export function useBackendPositions(token: string | null) {
  const qc = useQueryClient();
  const positionsQ = useQuery({
    queryKey: queryKeys.openPositions(token),
    queryFn: () => listPositions(token as string, { status: "open" }),
    enabled: !!token,
  });
  const greeksQ = useQuery({
    queryKey: queryKeys.greeks(token),
    queryFn: () => getPortfolioGreeks(token as string),
    enabled: !!token,
  });

  const invalidateAll = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.positions(token) }),
        qc.invalidateQueries({ queryKey: queryKeys.greeks(token) }),
        qc.invalidateQueries({ queryKey: queryKeys.account(token) }),
        // History changes when a position is closed or rolled.
        qc.invalidateQueries({ queryKey: queryKeys.history(token) }),
      ]),
    [qc, token]
  );

  const requireToken = () => {
    if (!token) throw new Error(NO_TOKEN);
    return token;
  };
  const openM = useMutation({
    mutationFn: (p: OpenPositionParams) => openPosition(p, requireToken()),
    onSuccess: invalidateAll,
  });
  const strategyM = useMutation({
    mutationFn: (legs: OpenPositionParams[]) => executeStrategy(legs, requireToken()),
    onSuccess: invalidateAll,
  });
  const closeM = useMutation({
    mutationFn: (id: string) => closePosition(id, requireToken()),
    onSuccess: invalidateAll,
  });
  const rollM = useMutation({
    mutationFn: (v: { id: string; newStrike: number; newExpiryDays: number }) =>
      rollPosition(v.id, { newStrike: v.newStrike, newExpiryDays: v.newExpiryDays }, requireToken()),
    onSuccess: invalidateAll,
  });

  const refresh = useCallback(() => {
    void invalidateAll();
  }, [invalidateAll]);

  return {
    positions: token ? positionsQ.data ?? [] : [],
    greeks: token ? greeksQ.data ?? ZERO_GREEKS : ZERO_GREEKS,
    loading: positionsQ.isFetching || greeksQ.isFetching,
    error: positionsQ.error ?? greeksQ.error,
    refresh,
    open: openM.mutateAsync,
    openStrategy: strategyM.mutateAsync,
    close: closeM.mutateAsync,
    roll: (id: string, params: { newStrike: number; newExpiryDays: number }) => rollM.mutateAsync({ id, ...params }),
  };
}
