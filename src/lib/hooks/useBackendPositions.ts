import { useCallback, useEffect, useState } from "react";
import {
  closePosition,
  closePositionPartial,
  closeStrategy,
  detectCloseFeatures,
  isUnsupportedCloseError,
  getPortfolioGreeks,
  listPositions,
  openPosition,
  rollPosition,
  type OpenPositionParams,
} from "../api/positions";
import { executeStrategy } from "../api/strategies";
import type { AggregateGreeks, Position } from "../api/types";
import { runBatchClose, type CloseMode, type BatchResult } from "../close/batchExecutor";

const ZERO_GREEKS: AggregateGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };

/**
 * Open positions + aggregate portfolio Greeks from the backend, plus the
 * open/close/roll/strategy mutations — each refetches both after it
 * settles rather than trying to predict the resulting state locally,
 * since the backend (not this hook) is the source of truth for premium,
 * collateral, and realized P&L. See useBackendAccount's doc comment for
 * why `token` should be `null` pre-hydration.
 */
export function useBackendPositions(token: string | null) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [greeks, setGreeks] = useState<AggregateGreeks>(ZERO_GREEKS);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!token) {
      setPositions([]);
      setGreeks(ZERO_GREEKS);
      return;
    }
    setLoading(true);
    Promise.all([listPositions(token, { status: "open" }), getPortfolioGreeks(token)])
      .then(([pos, g]) => {
        setPositions(pos);
        setGreeks(g);
      })
      .catch(() => {
        setPositions([]);
        setGreeks(ZERO_GREEKS);
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    async (id: string, contracts?: number) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      let position: Position;
      if (contracts != null) {
        const flags = await detectCloseFeatures(token);
        if (flags.partialClose) {
          try {
            position = await closePositionPartial(id, { contracts }, token);
          } catch (err) {
            if (!isUnsupportedCloseError(err)) throw err;
            // Body rejected — fall back to full close only when qty matches full size
            const full = positions.find(p => p.id === id);
            if (full && Math.abs(full.contracts - contracts) > 1e-9) {
              throw new Error(
                "Partial close is not supported by the backend yet. Close the full position, or wait for API support."
              );
            }
            position = await closePosition(id, token);
          }
        } else {
          const full = positions.find(p => p.id === id);
          if (full && Math.abs(full.contracts - contracts) > 1e-9) {
            throw new Error(
              "Partial close is not supported by the backend yet. Close the full position, or wait for API support."
            );
          }
          position = await closePosition(id, token);
        }
      } else {
        position = await closePosition(id, token);
      }
      refresh();
      return position;
    },
    [token, refresh, positions]
  );

  const closeStrategyGroup = useCallback(
    async (
      strategyId: string,
      legIds: string[],
      opts?: { mode?: CloseMode; onUpdate?: Parameters<typeof runBatchClose>[1]["onUpdate"] }
    ): Promise<BatchResult | Position[]> => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      const flags = await detectCloseFeatures(token);
      if (flags.strategyClose) {
        try {
          const closed = await closeStrategy(strategyId, token);
          refresh();
          return closed;
        } catch (err) {
          if (!isUnsupportedCloseError(err)) throw err;
          // fall through to sequential
        }
      }
      const result = await runBatchClose(
        legIds.map(id => ({
          id,
          label: id.slice(0, 8),
          run: async () => {
            await closePosition(id, token);
          },
        })),
        { mode: opts?.mode ?? "stop", onUpdate: opts?.onUpdate }
      );
      refresh();
      return result;
    },
    [token, refresh]
  );

  const closeBatch = useCallback(
    async (
      ids: string[],
      opts?: { mode?: CloseMode; onUpdate?: Parameters<typeof runBatchClose>[1]["onUpdate"] }
    ) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      const result = await runBatchClose(
        ids.map(id => ({
          id,
          label: id.slice(0, 8),
          run: async () => {
            await closePosition(id, token);
          },
        })),
        { mode: opts?.mode ?? "continue", onUpdate: opts?.onUpdate }
      );
      refresh();
      return result;
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

  return {
    positions, greeks, loading, refresh, open, openStrategy,
    close, closeStrategyGroup, closeBatch, roll,
  };
}
