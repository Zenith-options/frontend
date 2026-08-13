"use client";

import { useMemo } from "react";
import { combinedPayoffSeries, type PricedLeg } from "../lib/payoff";

interface Props {
  legs: PricedLeg[];
  spot: number;
  width?: number;
  height?: number;
}

export function MultiLegPayoffDiagram({ legs, spot, width = 340, height = 180 }: Props) {
  const PAD = { t: 16, r: 16, b: 28, l: 52 };
  const W = width - PAD.l - PAD.r;
  const H = height - PAD.t - PAD.b;

  const data = useMemo(() => {
    const lo = spot * 0.65;
    const hi = spot * 1.35;
    const series = combinedPayoffSeries(legs, lo, hi);
    return { lo, hi, series };
  }, [legs, spot]);

  return (
    <div style={{ width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <g transform={`translate(${PAD.l}, ${PAD.t})`}>
          <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        </g>
      </svg>
    </div>
  );
}
