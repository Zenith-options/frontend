// Collateral requirements for writing options, mirroring the on-chain rules
// described in the protocol README: covered calls are 100% covered by the
// underlying's current value, cash-secured puts are over-collateralized by 110%
// of the strike (protects against a further drop before the writer can react).

export type OptionSide = "call" | "put";

export function collateralRequired(side: OptionSide, contracts: number, strike: number, spot: number): number {
  return side === "call" ? contracts * spot : contracts * strike * 1.1;
}
