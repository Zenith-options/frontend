"use client";

import { useId, useMemo } from "react";
import { combinedPnl, combinedPayoffSeries, type PricedLeg } from "../lib/payoff";
import { useChartGestures } from "../lib/hooks/useChartGestures";
import { useElementWidth } from "../lib/hooks/useElementWidth";

interface Props {
  legs: PricedLeg[];
  spot: number;
  /** Preferred width; the chart shrinks to fit a narrower container. */
  width?: number;
  height?: number;
}

const fmtMoney = (v: number) => (v === 0 ? "0" : `${v > 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`);
const fmtPrice = (s: number) => (s >= 1 ? `$${s.toFixed(2)}` : `$${s.toFixed(4)}`);

export function MultiLegPayoffDiagram({ legs, spot, width: preferredWidth = 340, height = 180 }: Props) {
  const [containerRef, measured] = useElementWidth<HTMLDivElement>(preferredWidth);
  const width = Math.min(preferredWidth, measured);
  const PAD = { t: 16, r: 16, b: 28, l: 52 };
  const W = width - PAD.l - PAD.r;
  const H = height - PAD.t - PAD.b;
  const uid = useId().replace(/:/g, "");
  const { zoom, cursor, resetZoom, svgProps } = useChartGestures({ svgWidth: width, plotLeft: PAD.l, plotWidth: W });

  const data = useMemo(() => {
    const half = 0.35 / zoom;
    const lo = spot * (1 - half);
    const hi = spot * (1 + half);
    const range = hi - lo;
    const series = combinedPayoffSeries(legs, lo, hi);

    const maxPnl = series.reduce((m, pt) => Math.max(m, pt.p), 0);
    const minPnl = series.reduce((m, pt) => Math.min(m, pt.p), 0);
    const yRange = Math.max(maxPnl - minPnl, 0.01) * 1.3;
    const yMid = (maxPnl + minPnl) / 2;
    const yLo = yMid - yRange / 2;

    const toX = (s: number) => ((s - lo) / range) * W;
    const toY = (p: number) => H - ((p - yLo) / yRange) * H;
    const zeroY = toY(0);

    const pathData = series.map((pt, i) => `${i === 0 ? "M" : "L"}${toX(pt.s).toFixed(1)},${toY(pt.p).toFixed(1)}`).join(" ");
    const profitPath = series.map(pt => ({ x: toX(pt.s), y: toY(Math.max(0, pt.p)) }))
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")
      + ` L${toX(hi).toFixed(1)},${zeroY.toFixed(1)} L${toX(lo).toFixed(1)},${zeroY.toFixed(1)} Z`;
    const lossPath = series.map(pt => ({ x: toX(pt.s), y: toY(Math.min(0, pt.p)) }))
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")
      + ` L${toX(hi).toFixed(1)},${zeroY.toFixed(1)} L${toX(lo).toFixed(1)},${zeroY.toFixed(1)} Z`;

    return {
      lo, hi, range, toY, pathData, profitPath, lossPath, zeroY, spotX: toX(spot), maxPnl, minPnl,
      yLabels: [minPnl, 0, maxPnl].map(v => ({ v, y: toY(v) })),
    };
  }, [legs, spot, W, H, zoom]);

  const crosshair = cursor === null ? null : (() => {
    const s = data.lo + (cursor / W) * data.range;
    const p = combinedPnl(legs, s);
    return { x: cursor, y: Math.min(H, Math.max(0, data.toY(p))), s, p };
  })();

  return (
    <div ref={containerRef} style={{ width: "100%", maxWidth: preferredWidth, height, position: "relative" }}>
      <svg
        {...svgProps}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block" }}
        role="group"
        aria-label="Combined payoff at expiry chart. Arrow keys move the crosshair; plus and minus zoom; 0 resets."
      >
        <defs>
          <clipPath id={`ml-chart-clip-${uid}`}><rect x={PAD.l} y={PAD.t} width={W} height={H} /></clipPath>
        </defs>
        <g transform={`translate(${PAD.l}, ${PAD.t})`}>
          <line x1={0} y1={data.zeroY} x2={W} y2={data.zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          <path d={data.lossPath} fill="rgba(182,86,64,0.15)" clipPath={`url(#ml-chart-clip-${uid})`} />
          <path d={data.profitPath} fill="rgba(92,154,107,0.15)" clipPath={`url(#ml-chart-clip-${uid})`} />
          <line x1={data.spotX} y1={0} x2={data.spotX} y2={H} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3" />
          <path d={data.pathData} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#ml-chart-clip-${uid})`} />
          {data.yLabels.map(l => (
            <text key={l.v} x={-6} y={l.y} textAnchor="end" dominantBaseline="middle" fontSize={9} fontFamily="var(--font-mono)"
              fill={l.v === 0 ? "rgba(255,255,255,0.4)" : l.v > 0 ? "rgba(92,154,107,0.7)" : "rgba(182,86,64,0.7)"}>
              {fmtMoney(l.v)}
            </text>
          ))}
          <text x={data.spotX} y={-6} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.5)">S</text>
          {crosshair && (
            <g pointerEvents="none" data-testid="chart-crosshair">
              <line x1={crosshair.x} y1={0} x2={crosshair.x} y2={H} stroke="rgba(243,238,227,0.45)" strokeWidth={1} />
              <circle cx={crosshair.x} cy={crosshair.y} r={3} fill={crosshair.p >= 0 ? "#5C9A6B" : "#B65640"} />
              <g transform={`translate(${Math.min(Math.max(crosshair.x - 55, 0), W - 110)}, 2)`}>
                <rect width={110} height={26} fill="rgba(20,19,15,0.92)" stroke="rgba(255,255,255,0.12)" />
                <text x={6} y={10} fontSize={9} fontFamily="var(--font-mono)" fill="rgba(243,238,227,0.7)">S {fmtPrice(crosshair.s)}</text>
                <text x={6} y={21} fontSize={9} fontFamily="var(--font-mono)" fill={crosshair.p >= 0 ? "#5C9A6B" : "#B65640"}>P&amp;L {fmtMoney(crosshair.p)}</text>
              </g>
            </g>
          )}
          <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        </g>
      </svg>
      <span className="sr-only" aria-live="polite">
        {crosshair ? `At ${fmtPrice(crosshair.s)}, P&L ${fmtMoney(crosshair.p)}` : ""}
      </span>
      {zoom > 1.01 && (
        <button type="button" onClick={resetZoom} style={{
          position: "absolute", top: 0, right: 0, fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-mid)",
          background: "var(--bg-raised)", border: "1px solid var(--border-default)", padding: "2px 6px", cursor: "pointer",
        }}>{zoom.toFixed(1)}× · reset</button>
      )}
    </div>
  );
}
