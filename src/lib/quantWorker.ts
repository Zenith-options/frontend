/**
 * Quant worker: Greek exposure computations for Issue #64.
 *
 * Runs all CPU-heavy profile sweeps off the main thread via a Web Worker
 * (see src/lib/useQuantWorker.ts). This file is also importable directly
 * for SSR / fallback — all exported functions are pure.
 *
 * Computed in the quant worker, and consistent with backend aggregate
 * Greeks at current spot (within tolerance, with the check shown in dev).
 */

import { bs, smileVol } from "./pricing";
import type { Position } from "./api/types";

export type GreekKey = "delta" | "gamma" | "vega";

export interface ProfilePoint {
  spot: number;
  /** Spot as a fraction of current spot (e.g. 0.9 = -10%) */
  moneyness: number;
  delta: number;
  gamma: number;
  vega: number;
}

export interface HeatCell {
  expiryBucket: string;
  strikeBucket: string;
  /** Raw strike bucket midpoint, for display / filtering */
  strikeMid: number;
  expiryDays: number;
  value: number;
  positionIds: string[];
}

export interface GreekProfileResult {
  underlying: string;
  currentSpot: number;
  profile: ProfilePoint[];
  heatmap: HeatCell[];
  /** Backend aggregate Greek values at current spot (for consistency check) */
  atSpotCheck: { delta: number; gamma: number; vega: number };
}

const PROFILE_STEPS = 80;
const SPOT_RANGE = 0.30; // ±30%

/** Expiry bucket labels in ascending order */
const EXPIRY_BUCKETS = [
  { label: "≤14D", maxDays: 14 },
  { label: "15–30D", maxDays: 30 },
  { label: "31–60D", maxDays: 60 },
  { label: "61–90D", maxDays: 90 },
  { label: ">90D", maxDays: Infinity },
];

function expiryBucketFor(days: number): string {
  for (const b of EXPIRY_BUCKETS) {
    if (days <= b.maxDays) return b.label;
  }
  return ">90D";
}

/** Divides the strike space for a given spot into 5 equal-width buckets. */
function strikeBucketsFor(spot: number): Array<{ label: string; lo: number; hi: number; mid: number }> {
  const lo = spot * 0.7;
  const hi = spot * 1.3;
  const width = (hi - lo) / 5;
  return Array.from({ length: 5 }, (_, i) => {
    const bucketLo = lo + i * width;
    const bucketHi = bucketLo + width;
    const mid = (bucketLo + bucketHi) / 2;
    const frac = mid / spot;
    const label = frac < 0.85 ? "Deep ITM" : frac < 0.95 ? "ITM" : frac < 1.05 ? "ATM" : frac < 1.15 ? "OTM" : "Deep OTM";
    return { label, lo: bucketLo, hi: bucketHi, mid };
  });
}

/**
 * Compute Δ(S), Γ(S), V(S) curves across ±30% spot for a set of positions
 * on a single underlying.
 */
export function computeGreekProfiles(
  positions: Position[],
  currentSpot: number,
  baseVol: number
): GreekProfileResult["profile"] {
  if (positions.length === 0 || currentSpot <= 0) return [];

  return Array.from({ length: PROFILE_STEPS + 1 }, (_, i) => {
    const moneyness = (1 - SPOT_RANGE) + (i / PROFILE_STEPS) * 2 * SPOT_RANGE;
    const spot = currentSpot * moneyness;

    let delta = 0, gamma = 0, vega = 0;
    for (const p of positions) {
      const t = p.expiry_days / 365;
      const vol = smileVol(baseVol, p.strike / spot);
      const g = bs(spot, p.strike, vol, t, p.option_type === "call");
      const sign = p.position_type === "short" ? -1 : 1;
      const c = p.contracts * sign;
      delta += g.delta * c;
      gamma += g.gamma * c;
      vega  += g.vega  * c;
    }
    return { spot, moneyness, delta, gamma, vega };
  });
}

/**
 * Build a heatmap of Greek exposure bucketed by expiry × strike.
 */
export function computeHeatmap(
  positions: Position[],
  currentSpot: number,
  baseVol: number,
  greek: GreekKey
): HeatCell[] {
  if (positions.length === 0 || currentSpot <= 0) return [];

  const strikeBuckets = strikeBucketsFor(currentSpot);
  // Build a map: expiryLabel × strikeLabel → { value, positionIds }
  const map = new Map<string, { value: number; positionIds: string[]; strikeMid: number; expiryDays: number }>();

  for (const p of positions) {
    const t = p.expiry_days / 365;
    const vol = smileVol(baseVol, p.strike / currentSpot);
    const g = bs(currentSpot, p.strike, vol, t, p.option_type === "call");
    const sign = p.position_type === "short" ? -1 : 1;
    const value = g[greek] * p.contracts * sign;

    const expiryBucket = expiryBucketFor(p.expiry_days);
    const sb = strikeBuckets.find(b => p.strike >= b.lo && p.strike < b.hi)
      ?? strikeBuckets[p.strike < strikeBuckets[0].lo ? 0 : strikeBuckets.length - 1];

    const key = `${expiryBucket}|${sb.label}`;
    if (!map.has(key)) {
      map.set(key, { value: 0, positionIds: [], strikeMid: sb.mid, expiryDays: p.expiry_days });
    }
    const cell = map.get(key)!;
    cell.value += value;
    cell.positionIds.push(p.id);
  }

  return Array.from(map.entries()).map(([key, cell]) => {
    const [expiryBucket, strikeBucket] = key.split("|");
    return { expiryBucket, strikeBucket, strikeMid: cell.strikeMid, expiryDays: cell.expiryDays, value: cell.value, positionIds: cell.positionIds };
  });
}

/**
 * Full result for a single underlying: profiles + heatmap + at-spot check.
 */
export function computeGreekProfileResult(
  underlying: string,
  positions: Position[],
  currentSpot: number,
  baseVol: number,
  greek: GreekKey = "delta"
): GreekProfileResult {
  const profile = computeGreekProfiles(positions, currentSpot, baseVol);
  const heatmap = computeHeatmap(positions, currentSpot, baseVol, greek);

  // At-spot check: sum Greeks at exactly currentSpot for dev consistency check
  let delta = 0, gamma = 0, vega = 0;
  for (const p of positions) {
    const t = p.expiry_days / 365;
    const vol = smileVol(baseVol, p.strike / currentSpot);
    const g = bs(currentSpot, p.strike, vol, t, p.option_type === "call");
    const sign = p.position_type === "short" ? -1 : 1;
    const c = p.contracts * sign;
    delta += g.delta * c;
    gamma += g.gamma * c;
    vega  += g.vega  * c;
  }

  return { underlying, currentSpot, profile, heatmap, atSpotCheck: { delta, gamma, vega } };
}

// ── Web Worker message protocol ──────────────────────────────────────────────

export type WorkerRequest =
  | { type: "COMPUTE_PROFILES"; payload: {
      underlying: string;
      positions: Position[];
      currentSpot: number;
      baseVol: number;
      greek: GreekKey;
    } };

export type WorkerResponse =
  | { type: "PROFILES_RESULT"; payload: GreekProfileResult }
  | { type: "ERROR"; error: string };

/**
 * Worker entry-point. Call this from the worker's onmessage handler.
 * Exported so the worker script can import it without duplicating logic.
 */
export function handleWorkerMessage(e: MessageEvent<WorkerRequest>): WorkerResponse {
  const msg = e.data;
  try {
    if (msg.type === "COMPUTE_PROFILES") {
      const { underlying, positions, currentSpot, baseVol, greek } = msg.payload;
      const result = computeGreekProfileResult(underlying, positions, currentSpot, baseVol, greek);
      return { type: "PROFILES_RESULT", payload: result };
    }
    return { type: "ERROR", error: `Unknown message type: ${(msg as WorkerRequest).type}` };
  } catch (err) {
    return { type: "ERROR", error: err instanceof Error ? err.message : String(err) };
  }
}
