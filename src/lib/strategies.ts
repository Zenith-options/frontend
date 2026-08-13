// Multi-leg options strategy templates. Each leg's strike is expressed as a
// multiple of spot (1.0 = ATM) so a template renders sensibly for any
// underlying and any spot price, rather than hardcoding strikes.

export interface StrategyLeg {
  side: "call" | "put";
  action: "buy" | "sell";
  strikeOffset: number;
}

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  legs: StrategyLeg[];
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: "straddle",
    name: "Long Straddle",
    description:
      "Buy a call and a put at the same (ATM) strike. Profits from a big move in either direction — max loss is both premiums paid if spot pins the strike at expiry.",
    legs: [
      { side: "call", action: "buy", strikeOffset: 1.0 },
      { side: "put", action: "buy", strikeOffset: 1.0 },
    ],
  },
];
