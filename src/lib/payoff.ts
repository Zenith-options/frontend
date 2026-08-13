import type { Greeks } from "./pricing";

export interface PricedLeg {
  side: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  contracts: number;
  greeks: Greeks;
}

/** Net P&L across all legs at a given spot price at expiry. */
export function combinedPnl(legs: PricedLeg[], spotAtExpiry: number): number {
  return legs.reduce((total, leg) => {
    const intrinsic = leg.side === "call"
      ? Math.max(0, spotAtExpiry - leg.strike)
      : Math.max(0, leg.strike - spotAtExpiry);
    const perContract = leg.action === "buy" ? intrinsic - leg.greeks.premium : leg.greeks.premium - intrinsic;
    return total + perContract * leg.contracts;
  }, 0);
}

/** Series of {s, p} points across a spot range, for charting the combined curve. */
export function combinedPayoffSeries(legs: PricedLeg[], loSpot: number, hiSpot: number, steps = 200) {
  const range = hiSpot - loSpot;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const s = loSpot + (range * i) / steps;
    return { s, p: combinedPnl(legs, s) };
  });
}

/** Positive = net debit paid to enter; negative = net credit received. */
export function netPremium(legs: PricedLeg[]): number {
  return legs.reduce(
    (total, leg) => total + (leg.action === "buy" ? leg.greeks.premium : -leg.greeks.premium) * leg.contracts,
    0
  );
}
