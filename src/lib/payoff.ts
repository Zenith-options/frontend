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
