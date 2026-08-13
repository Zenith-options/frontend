import { smileVol } from "./pricing";

export interface SurfaceCell {
  moneyness: number;
  days: number;
  iv: number;
}

// Real crypto vol surfaces aren't just a smile repeated at every expiry — the
// skew/curvature away from ATM typically dampens for longer-dated options
// (near-term uncertainty is sharper, far-dated smooths out). This isolates
// smileVol's non-ATM component and shrinks it as days-to-expiry grows.
export function surfaceVol(baseVol: number, moneyness: number, days: number): number {
  const smile = smileVol(baseVol, moneyness);
  const nonAtmComponent = smile - baseVol;
  const dampen = 1 / (1 + (days / 365) * 1.5);
  return baseVol + nonAtmComponent * dampen;
}

export function buildSurfaceGrid(baseVol: number, moneyness: number[], expiryDays: number[]): SurfaceCell[][] {
  return expiryDays.map(days =>
    moneyness.map(m => ({ moneyness: m, days, iv: surfaceVol(baseVol, m, days) }))
  );
}
