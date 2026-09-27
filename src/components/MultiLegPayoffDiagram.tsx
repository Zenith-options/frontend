"use client";

import { useMemo, useRef, useState } from "react";
import { combinedPayoffSeries, type PricedLeg } from "../lib/payoff";
import { useElementWidth } from "../lib/useElementWidth";

interface Props {
  legs: PricedLeg[];
  spot: number;
  width?: number;
  height?: number;
  /** Upper bound for the responsive (mobile) growth of the chart. */
  maxWidth?: number;
  minWidth?: number;
}

export function MultiLegPayoffDiagram({ legs, spot, width = 340, height = 180, maxWidth, minWidth = 240 }: Props) {
  // Responsive geometry — identical to the declared size wherever the
  // container is at least `width` wide (all desktop call sites), scaled down
  // to the container otherwise so it never overflows a phone viewport.
  const [containerRef, measured] = useElementWidth<HTMLDivElement>();
  const cap = Math.max(minWidth, maxWidth ?? width);
  const w = Math.max(minWidth, Math.min(measured ?? width, cap));
  const h = Math.max(120, Math.round(height * (w / width)));
  const PAD = { t: 16, r: 16, b: 28, l: 52 };
  const W = w - PAD.l - PAD.r;
  const H = h - PAD.t - PAD.b;

  const data = useMemo(() => {
    const lo = spot * 0.65;
    const hi = spot * 1.35;
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

    // Combined payoff at an arbitrary spot — used by the touch/hover readout.
    // `series` is sampled, so interpolate between the two nearest samples.
    const payoffAt = (s: number) => {
      const step = series.length > 1 ? range / (series.length - 1) : range;
      const idx = Math.max(0, Math.min(series.length - 2, Math.floor((s - lo) / step)));
      const a = series[idx];
      const b = series[idx + 1] ?? a;
      if (!a) return 0;
      const span = b.s - a.s;
      const t = span === 0 ? 0 : (s - a.s) / span;
      return a.p + (b.p - a.p) * t;
    };

    const pathData = series.map((pt, i) => `${i === 0 ? "M" : "L"}${toX(pt.s).toFixed(1)},${toY(pt.p).toFixed(1)}`).join(" ");
    const profitPath = series.map(pt => ({ x: toX(pt.s), y: toY(Math.max(0, pt.p)) }))
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")
      + ` L${toX(hi).toFixed(1)},${zeroY.toFixed(1)} L${toX(lo).toFixed(1)},${zeroY.toFixed(1)} Z`;
    const lossPath = series.map(pt => ({ x: toX(pt.s), y: toY(Math.min(0, pt.p)) }))
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")
      + ` L${toX(hi).toFixed(1)},${zeroY.toFixed(1)} L${toX(lo).toFixed(1)},${zeroY.toFixed(1)} Z`;

    return {
      lo, hi, pathData, profitPath, lossPath, zeroY, spotX: toX(spot), maxPnl, minPnl,
      yLabels: [minPnl, 0, maxPnl].map(v => ({ v, y: toY(v) })),
      toX, toY, payoffAt,
      probeAt: (x: number) => {
        const clamped = Math.max(0, Math.min(W, x));
        const s = lo + (clamped / W) * range;
        return { s, p: payoffAt(s) };
      },
    };
  }, [legs, spot, W, H]);

  // Touch/hover readout — see PayoffDiagram for the rationale on `pan-y`.
  const [probe, setProbe] = useState<{ s: number; p: number } | null>(null);
  const dragging = useRef(false);

  const moveProbe = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((clientX - rect.left) * (w / rect.width)) - PAD.l;
    if (x < -10 || x > W + 10) { setProbe(null); return; }
    setProbe(data.probeAt(x));
  };

  return (
    <div ref={containerRef} className="zn-chart" style={{ width: "100%" }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ touchAction: "pan-y" }}
        onPointerDown={e => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          moveProbe(e.clientX, e.currentTarget);
        }}
        onPointerMove={e => {
          if (e.pointerType === "mouse" || dragging.current) moveProbe(e.clientX, e.currentTarget);
        }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerLeave={() => { if (!dragging.current) setProbe(null); }}
        onPointerCancel={() => { dragging.current = false; setProbe(null); }}
      >
        <defs>
          <clipPath id="ml-chart-clip"><rect x={PAD.l} y={PAD.t} width={W} height={H} /></clipPath>
        </defs>
        <g transform={`translate(${PAD.l}, ${PAD.t})`}>
          <line x1={0} y1={data.zeroY} x2={W} y2={data.zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          <path d={data.lossPath} fill="rgba(182,86,64,0.15)" clipPath="url(#ml-chart-clip)" />
          <path d={data.profitPath} fill="rgba(92,154,107,0.15)" clipPath="url(#ml-chart-clip)" />
          <line x1={data.spotX} y1={0} x2={data.spotX} y2={H} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3" />
          <path d={data.pathData} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" clipPath="url(#ml-chart-clip)" />
          {data.yLabels.map(l => (
            <text key={l.v} x={-6} y={l.y} textAnchor="end" dominantBaseline="middle" fontSize={9} fontFamily="var(--font-mono)"
              fill={l.v === 0 ? "rgba(255,255,255,0.4)" : l.v > 0 ? "rgba(92,154,107,0.7)" : "rgba(182,86,64,0.7)"}>
              {l.v === 0 ? "0" : `${l.v > 0 ? "+" : "−"}$${Math.abs(l.v).toFixed(2)}`}
            </text>
          ))}
          <text x={data.spotX} y={-6} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.5)">S</text>
          <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

          {/* Touch / hover readout (mouse hover and finger drag) */}
          {probe && (() => {
            const px = data.toX(probe.s);
            const py = data.toY(probe.p);
            const right = px < W * 0.6;
            return (
              <g pointerEvents="none">
                <line x1={px} y1={0} x2={px} y2={H} stroke="rgba(245,238,220,0.35)" strokeWidth={1} />
                <circle cx={px} cy={py} r={3.5} fill="var(--bg-elevated)" stroke="var(--brand)" strokeWidth={1.5} />
                <text
                  x={right ? px + 6 : px - 6} y={8}
                  textAnchor={right ? "start" : "end"}
                  fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-hi)"
                >
                  {probe.s >= 1 ? `$${probe.s.toFixed(2)}` : `$${probe.s.toFixed(4)}`}
                </text>
                <text
                  x={right ? px + 6 : px - 6} y={20}
                  textAnchor={right ? "start" : "end"}
                  fontSize={9} fontFamily="var(--font-mono)"
                  fill={probe.p >= 0 ? "#5C9A6B" : "#B65640"}
                >
                  {probe.p >= 0 ? "+" : "\u2212"}${Math.abs(probe.p).toFixed(2)}
                </text>
              </g>
            );
          })()}
        </g>
      </svg>
    </div>
  );
}
