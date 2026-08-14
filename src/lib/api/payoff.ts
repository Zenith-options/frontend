import { apiPost } from "./client";
import type { OptionType, PositionType } from "./types";

export interface PayoffLeg {
  optionType: OptionType;
  positionType: PositionType;
  strike: number;
  contracts: number;
  premium: number;
}

export interface PayoffPoint {
  spot: number;
  pnl: number;
}

export interface PayoffResponse {
  points: PayoffPoint[];
  net_premium: number;
}

export function getCombinedPayoff(params: {
  legs: PayoffLeg[];
  loSpot: number;
  hiSpot: number;
  steps?: number;
}): Promise<PayoffResponse> {
  return apiPost("/api/v1/portfolio/payoff", {
    legs: params.legs.map((leg) => ({
      option_type: leg.optionType,
      position_type: leg.positionType,
      strike: leg.strike,
      contracts: leg.contracts,
      premium: leg.premium,
    })),
    lo_spot: params.loSpot,
    hi_spot: params.hiSpot,
    steps: params.steps,
  });
}
