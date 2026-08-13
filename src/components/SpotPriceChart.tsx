"use client";

import { useMemo } from "react";
import type { PricePoint } from "../lib/usePriceHistory";

interface Props {
  history: PricePoint[];
  width?: number;
  height?: number;
}

export function SpotPriceChart({ history, width = 212, height = 90 }: Props) {
  const PAD = { t: 6, r: 6, b: 6, l: 6 };
  const W = width - PAD.l - PAD.r;
  const H = height - PAD.t - PAD.b;

  const data = useMemo(() => {
    if (history.length < 2) return null;
    const prices = history.map(p => p.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const range = Math.max(hi - lo, hi * 0.0001);
    const toX = (i: number) => (i / (history.length - 1)) * W;
    const toY = (p: number) => H - ((p - lo) / range) * H;
    return { lo, hi, toX, toY };
  }, [history, W, H]);

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
