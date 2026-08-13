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
  {
    id: "bull-call-spread",
    name: "Bull Call Spread",
    description:
      "Buy an ATM call, sell a further OTM call to offset the cost. Caps both the upside and the downside — cheaper than a naked long call, bullish but capped.",
    legs: [
      { side: "call", action: "buy", strikeOffset: 1.0 },
      { side: "call", action: "sell", strikeOffset: 1.1 },
    ],
  },
  {
    id: "bear-put-spread",
    name: "Bear Put Spread",
    description:
      "Buy an ATM put, sell a further OTM put to offset the cost. Bearish but capped, cheaper than a naked long put.",
    legs: [
      { side: "put", action: "buy", strikeOffset: 1.0 },
      { side: "put", action: "sell", strikeOffset: 0.9 },
    ],
  },
  {
    id: "iron-condor",
    name: "Iron Condor",
    description:
      "Sell an OTM put and OTM call, buy further-out put and call as protection. Collects premium if spot stays in the middle range through expiry; loss is capped by the protective legs.",
    legs: [
      { side: "put", action: "buy", strikeOffset: 0.85 },
      { side: "put", action: "sell", strikeOffset: 0.92 },
      { side: "call", action: "sell", strikeOffset: 1.08 },
      { side: "call", action: "buy", strikeOffset: 1.15 },
    ],
  },
];
