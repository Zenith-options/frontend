import { useMemo, useRef } from "react";
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
 * Fetch + 4s polling + local Black-Scholes fallback when the backend is down.
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

  // Monotonically increasing request id. Every fetch (and every market
  // switch) claims a new id; only the latest id may commit state, so a stale
  // response that resolves after an abort can never overwrite newer data.
  const requestIdRef = useRef(0);
  const committedIdRef = useRef(0);
  const committedKeyRef = useRef<string | null>(null);

  const marketKey = `${sym}:${expiryDays}`;

  // A market switch invalidates every in-flight request: claim a fresh id so
  // responses started for the previous market can never commit.
  const lastMarketKeyRef = useRef(marketKey);
  if (lastMarketKeyRef.current !== marketKey) {
    lastMarketKeyRef.current = marketKey;
    requestIdRef.current += 1;
  }

  const q = useQuery({
    queryKey: queryKeys.chain(sym, expiryDays),
    queryFn: async () => {
      const id = ++requestIdRef.current;
      const entries = await getChain(sym, expiryDays);
      return { id, entries };
    },
    select: (res) => ({ id: res.id, rows: mapChainEntries(res.entries) }),
    refetchInterval: 4000,
  });

  const t = expiryDays / 365;

  // Commit the query result only if it belongs to the latest request for the
  // currently selected market. Anything older is dropped.
  const committed = useMemo(() => {
    if (!q.data) return null;
    if (q.data.id < requestIdRef.current) return null;
    if (committedKeyRef.current !== marketKey) {
      committedKeyRef.current = marketKey;
      committedIdRef.current = q.data.id;
    } else if (q.data.id < committedIdRef.current) {
      return null;
    } else {
      committedIdRef.current = q.data.id;
    }
    return q.data.rows;
  }, [q.data, marketKey]);

  const chain = useMemo((): ChainRow[] => {
    if (committed) return committed;
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
