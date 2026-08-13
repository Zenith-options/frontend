"use client";

import { useMemo } from "react";
import type { PricePoint } from "../lib/usePriceHistory";

interface Props {
  history: PricePoint[];
  width?: number;
  height?: number;
}

const fmtPrice = (n: number) => (n >= 100 ? n.toFixed(2) : n.toFixed(4));

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

    const first = prices[0];
    const last = prices[prices.length - 1];
    const up = last >= first;
    const color = up ? "#5C9A6B" : "#B65640";
    const pctChange = first > 0 ? ((last - first) / first) * 100 : 0;

    const pathData = history.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.price).toFixed(1)}`).join(" ");
    const areaPath = pathData + ` L${toX(history.length - 1).toFixed(1)},${H} L0,${H} Z`;

    return { lo, hi, up, color, pctChange, pathData, areaPath };
  }, [history, W, H]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)" }}>
          Price History
        </span>
        <span className="num" style={{ fontSize: 11, fontWeight: 600, color: data ? data.color : "var(--text-lo)" }}>
          {data ? `${data.pctChange >= 0 ? "+" : ""}${data.pctChange.toFixed(2)}%` : "—"}
        </span>
      </div>
      <div style={{ width, height }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id="spot-chart-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={data ? `${data.color}33` : "transparent"} />
              <stop offset="100%" stopColor={data ? `${data.color}05` : "transparent"} />
            </linearGradient>
          </defs>
          <g transform={`translate(${PAD.l}, ${PAD.t})`}>
            {data && (
              <>
                <path d={data.areaPath} fill="url(#spot-chart-grad)" />
                <path d={data.pathData} fill="none" stroke={data.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
              </>
            )}
            <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          </g>
        </svg>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span className="num" style={{ fontSize: 9, color: "var(--text-lo)" }}>Low {data ? `$${fmtPrice(data.lo)}` : "—"}</span>
        <span className="num" style={{ fontSize: 9, color: "var(--text-lo)" }}>High {data ? `$${fmtPrice(data.hi)}` : "—"}</span>
      </div>
    </div>
  );
}
