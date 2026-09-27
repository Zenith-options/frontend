import { bs, type Greeks } from "./pricing";

export interface PricedLeg {
  side: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  contracts: number;
  greeks: Greeks;
  /** Days to this leg's own expiry. Only needed when legs expire on
   *  different dates (calendars/diagonals); omitted means "all legs share
   *  one expiry", which is what every single-expiry caller assumes. */
  expiryDays?: number;
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

/** Days to the earliest leg expiry, or null if no leg carries one. */
export function nearestExpiryDays(legs: PricedLeg[]): number | null {
  const days = legs.map(l => l.expiryDays).filter((d): d is number => d !== undefined);
  return days.length > 0 ? Math.min(...days) : null;
}

export function isMultiExpiry(legs: PricedLeg[]): boolean {
  return new Set(legs.map(l => l.expiryDays).filter(d => d !== undefined)).size > 1;
}

/**
 * Net P&L at a horizon `horizonDays` from now: legs expiring by then are
 * worth intrinsic, legs still alive are marked to model (Black-Scholes at
 * the leg's own entry IV and remaining time). With every leg expiring at
 * the horizon this is exactly `combinedPnl`.
 */
export function markToModelPnl(legs: PricedLeg[], spotAtHorizon: number, horizonDays: number): number {
  return legs.reduce((total, leg) => {
    const remaining = (leg.expiryDays ?? horizonDays) - horizonDays;
    const value = remaining > 0
      ? bs(spotAtHorizon, leg.strike, leg.greeks.iv, remaining / 365, leg.side === "call").premium
      : leg.side === "call"
        ? Math.max(0, spotAtHorizon - leg.strike)
        : Math.max(0, leg.strike - spotAtHorizon);
    const perContract = leg.action === "buy" ? value - leg.greeks.premium : leg.greeks.premium - value;
    return total + perContract * leg.contracts;
  }, 0);
}

/**
 * P&L at the strategy's nearest expiry: plain intrinsic payoff for a
 * single-expiry structure, mark-to-model of the longer-dated legs for a
 * calendar/diagonal (there is no single "at expiry" for those).
 */
export function strategyPnl(legs: PricedLeg[], spot: number): number {
  if (!isMultiExpiry(legs)) return combinedPnl(legs, spot);
  return markToModelPnl(legs, spot, nearestExpiryDays(legs)!);
}

/** Series of {s, p} points across a spot range, for charting the combined curve. */
export function combinedPayoffSeries(legs: PricedLeg[], loSpot: number, hiSpot: number, steps = 200) {
  const range = hiSpot - loSpot;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const s = loSpot + (range * i) / steps;
    return { s, p: strategyPnl(legs, s) };
  });
}

/** Positive = net debit paid to enter; negative = net credit received. */
export function netPremium(legs: PricedLeg[]): number {
  return legs.reduce(
    (total, leg) => total + (leg.action === "buy" ? leg.greeks.premium : -leg.greeks.premium) * leg.contracts,
    0
  );
}
