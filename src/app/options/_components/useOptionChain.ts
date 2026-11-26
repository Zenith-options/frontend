import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../../lib/api/queryKeys";
import { EXPIRIES, bs, smileVol } from "../../../lib/pricing";
import { getChain, getExpiryCalendar } from "../../../lib/api/market";
import type { OptionChainEntry } from "../../../lib/api/types";
import type { ChainRow, Expiry } from "./types";
import { useIntegrityStore } from "../../../lib/integrity/integrityStore";
import { captureMessage } from "../../../lib/monitoring";
// ─── Config ───────────────────────────────────────────────────────────────────
/**
 * Maximum deviation (fraction) between any chain strike premium and the ATM
 * premium before we flag the chain as suspect.
 *
 * This is a coarse sanity check: if every chain row has a call premium of $0
 * or a negative IV, the backend feed may have a pricing bug.
 */
const MAX_CHAIN_IV_FRACTION = 20.0; // 2000% — hard ceiling inherited from validateTick
const MIN_CHAIN_IV_FRACTION = 0.001; // 0.1%  — hard floor
/**
 * Maximum ratio between the ATM chain strike and the live spot price.
 * If no chain strike lands within ATM_RATIO of spot, we suspect the chain
 * was generated for a different underlying price.
 */
const ATM_RATIO = 0.40; // 40% — wide enough to never false-fire in normal markets

/**
 * How often the chain is polled from the backend (ms).
 *
 * Also used as the react-query staleTime so that switching between tabs
 * (which remounts the hook) reuses the data already in the query cache
 * instead of immediately triggering a new fetch. The chain is never served
 * stale across this window: if more than CHAIN_POLL_INTERVAL ms have elapsed
 * since the last fetch, react-query treats the entry as stale and refetches
 * in the background, exactly as before. A genuine market change (sym or
 * expiryDays change) produces a different query key and always fetches fresh.
 */
const CHAIN_POLL_INTERVAL = 4000;
// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Single mapper for backend chain entries (was copy-pasted twice in page.tsx). */
export function mapChainEntries(entries: OptionChainEntry[]): ChainRow[] {
  return entries.map((e) => ({
    strike: e.strike,
    call: {
      premium: e.call.premium,
      delta: e.call.delta,
      gamma: e.call.gamma,
      theta: e.call.theta,
      vega: e.call.vega,
      iv: e.call.iv,
    },
    put: {
      premium: e.put.premium,
      delta: e.put.delta,
      gamma: e.put.gamma,
      theta: e.put.theta,
      vega: e.put.vega,
      iv: e.put.iv,
    },
    itmCall: e.is_itm_call,
    itmPut: e.is_itm_put,
  }));
}
/**
 * Cross-check a chain snapshot against the live spot price.
 *
 * Returns `null` if the chain looks healthy, or a human-readable reason string
 * if we detect an anomaly. Anomalies are logged to monitoring (sampled) but do
 * NOT block the chain from displaying — we want to surface the warning without
 * hiding all data.
 */
function checkChainConsistency(
  sym: string,
  rows: ChainRow[],
  spot: number,
): string | null {
  if (rows.length === 0) return null;
  // 1. IV sanity — every row's IV must be within the global bounds.
  for (const row of rows) {
    if (
      !Number.isFinite(row.call.iv) ||
      row.call.iv < MIN_CHAIN_IV_FRACTION ||
      row.call.iv > MAX_CHAIN_IV_FRACTION
    ) {
      return `call IV out of range at strike ${row.strike} (${row.call.iv})`;
    }
    if (
      !Number.isFinite(row.put.iv) ||
      row.put.iv < MIN_CHAIN_IV_FRACTION ||
      row.put.iv > MAX_CHAIN_IV_FRACTION
    ) {
      return `put IV out of range at strike ${row.strike} (${row.put.iv})`;
    }
  }
  // 2. Strike proximity — at least one strike should land within ATM_RATIO of spot.
  const hasNearStrike = rows.some(
    (r) => Math.abs(r.strike - spot) / spot <= ATM_RATIO,
  );
  if (!hasNearStrike) {
    return `no chain strike within ${ATM_RATIO * 100}% of spot (${spot}) — chain may be for a different price`;
  }
  // 3. Premium monotonicity isn't strictly required (skew is real), but
  //    negative premiums are impossible.
  for (const row of rows) {
    if (row.call.premium < 0)
      return `negative call premium at strike ${row.strike}`;
    if (row.put.premium < 0)
      return `negative put premium at strike ${row.strike}`;
  }
  return null;
}
// ─── Hooks ────────────────────────────────────────────────────────────────────
// Backend's expiry list happens to be the same across every underlying,
// but fetching per-symbol keeps this correct if that ever changes. Falls
// back to the local EXPIRIES until/unless the backend answers.
export function useExpiries(sym: string): Expiry[] {
  const q = useQuery({
    queryKey: queryKeys.expiries(sym),
    queryFn: () => getExpiryCalendar(sym),
    select: (cal) => cal.expiries.map((e) => ({ label: e.label, days: e.days_to_expiry })),
  });
  return q.data ?? EXPIRIES;
}
/**
 * Fetch + polling + local Black-Scholes fallback when the backend is down.
 *
 * The chain is polled every CHAIN_POLL_INTERVAL ms and cached in react-query
 * with staleTime set to the same interval. This means:
 *
 * - Switching between tabs (Positions, Strategies, Surface) remounts this
 *   hook but does NOT trigger a new fetch while the cached entry is still
 *   fresh — the data already in memory is reused.
 * - After CHAIN_POLL_INTERVAL ms the entry becomes stale and react-query
 *   refetches in the background on the next mount or focus event, exactly
 *   as it did before.
 * - Changing sym or expiryDays produces a different query key, so a genuine
 *   market change always fetches fresh data. The existing abort-on-new-query
 *   behaviour from react-query's signal handling is preserved.
 *
 * Chain integrity cross-check is applied on every successful backend fetch:
 * if the chain's IVs or strikes look inconsistent with the live spot price,
 * the `chainIntegrityWarning` field is set and the symbol is recorded as
 * having a chain anomaly in the integrity store so the trade ticket can show
 * an additional caution.
 *
 * Deliberately not re-fetching on every spot tick: spot/vol only feed the
 * fallback, never the query key.
 */
export function useOptionChain(
  sym: string,
  expiryDays: number,
  spot: number,
  vol: number,
) {
  const recordReject = useIntegrityStore((s) => s.recordReject);
  const q = useQuery({
    queryKey: queryKeys.chain(sym, expiryDays),
    queryFn: () => getChain(sym, expiryDays),
    select: mapChainEntries,
    refetchInterval: CHAIN_POLL_INTERVAL,
    // Keep the cached entry "fresh" for the full poll interval so that
    // remounting the hook (tab switch) does not trigger a redundant fetch.
    staleTime: CHAIN_POLL_INTERVAL,
  });
  const t = expiryDays / 365;
  const chain = useMemo((): ChainRow[] => {
    if (q.data) return q.data;
    if (!q.isError) return [];
    // Backend unreachable — fall back to the local Black-Scholes calc
    // so the chain still renders something usable.
    return Array.from({ length: 21 }, (_, i) => {
      const n = i - 10;
      const strike = Math.round(spot * (1 + n * 0.04) * 10000) / 10000;
      const v = smileVol(vol, strike / spot);
      return {
        strike,
        call: bs(spot, strike, v, t, true),
        put: bs(spot, strike, v, t, false),
        itmCall: spot > strike,
        itmPut: spot < strike,
      };
    });
  }, [q.data, q.isError, spot, vol, t]);
  // ── Cross-check chain vs spot ────────────────────────────────────────────
  // Only run the check when we have real backend data (skip fallback rows
  // since those are computed from spot and are inherently consistent).
  const chainIntegrityWarning = useMemo((): string | null => {
    if (!q.data || spot <= 0) return null;
    const warning = checkChainConsistency(sym, q.data, spot);
    if (warning) {
      // Record the symbol as having a chain-level anomaly so the trade
      // ticket can read it from the store.
      recordReject(sym, "price_jump_too_large");
      // Sampled telemetry.
      if (Math.random() < 0.1) {
        void captureMessage(
          `[integrity] chain inconsistency for ${sym}: ${warning}`,
          "warning",
        );
      }
    }
    return warning;
  }, [q.data, spot, sym, recordReject]);
  return { chain, loading: q.isLoading, error: q.error, chainIntegrityWarning };
}
