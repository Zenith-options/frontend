import { useCallback } from "react";
import {
  closePosition,
  getPortfolioGreeks,
  listPositions,
  openPosition,
  rollPosition,
  type OpenPositionParams,
} from "../api/positions";
import { executeStrategy } from "../api/strategies";
import type { AggregateGreeks, Position } from "../api/types";
import { useAsyncQuery } from "../query";

const ZERO_GREEKS: AggregateGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
const NO_POSITIONS: Position[] = [];

export interface PositionsData {
  positions: Position[];
  greeks: AggregateGreeks;
}

/**
 * Open positions + aggregate portfolio Greeks from the backend, plus the
 * open/close/roll/strategy mutations — each refetches both after it
 * settles rather than trying to predict the resulting state locally,
 * since the backend (not this hook) is the source of truth for premium,
 * collateral, and realized P&L. See useBackendAccount's doc comment for
 * why `token` should be `null` pre-hydration.
 */
export function useBackendPositions(token: string | null) {
  const query = useAsyncQuery<PositionsData>(
    token ? `positions:${token}` : null,
    () =>
      Promise.all([listPositions(token!, { status: "open" }), getPortfolioGreeks(token!)])
        .then(([positions, greeks]) => ({ positions, greeks })),
    { authed: true }
  );
  const refresh = query.refetch;
  const positions = query.data?.positions ?? NO_POSITIONS;
  const greeks = query.data?.greeks ?? ZERO_GREEKS;
  const loading = query.status === "loading";

  const open = useCallback(
    async (params: OpenPositionParams) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      const position = await openPosition(params, token);
      refresh();
      return position;
    },
    [token, refresh]
  );

  const openStrategy = useCallback(
    async (legs: OpenPositionParams[]) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      const opened = await executeStrategy(legs, token);
      refresh();
      return opened;
    },
    [token, refresh]
  );

  const close = useCallback(
    async (id: string) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      const position = await closePosition(id, token);
      refresh();
      return position;
    },
    [token, refresh]
  );

  const roll = useCallback(
    async (id: string, params: { newStrike: number; newExpiryDays: number }) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      const result = await rollPosition(id, params, token);
      refresh();
      return result;
    },
    [token, refresh]
  );

  return { positions, greeks, loading, refresh, open, openStrategy, close, roll, query };
}
