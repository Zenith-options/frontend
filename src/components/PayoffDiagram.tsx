"use client";

import { useMemo, useRef, useState } from "react";
import { useElementWidth } from "../lib/useElementWidth";

interface PayoffDiagramProps {
  spot: number;
  strike: number;
  premium: number;
  isCall: boolean;
  /** True for a written/short position — mirrors the payoff curve (writer's P&L is the buyer's, negated). */
  short?: boolean;
  contracts?: number;
  width?: number;
  height?: number;
  /** Upper bound for the responsive (mobile) growth of the chart. */
  maxWidth?: number;
  /** Lower bound — below this the chart stops shrinking and its container scrolls instead. */
  minWidth?: number;
  compact?: boolean;
}

export function PayoffDiagram({
  spot,
  strike,
  premium,
  isCall,
  short = false,
  contracts = 1,
  width = 340,
  height = 180,
  maxWidth,
  minWidth = 240,
  compact = false,
}: PayoffDiagramProps) {
  // Responsive geometry: at the declared width (i.e. every desktop call site,
  // where the container measures exactly `width`) this is a no-op; inside a
  // narrower container — a phone's bottom sheet, a stacked risk panel — the
  // chart tracks the container instead of overflowing it.
  const [containerRef, measured] = useElementWidth<HTMLDivElement>();
  const cap = Math.max(minWidth, maxWidth ?? width);
  const w = Math.max(minWidth, Math.min(measured ?? width, cap));
  const h = Math.max(120, Math.round(height * (w / width)));
  const PAD = compact ? { t: 8, r: 8, b: 20, l: 40 } : { t: 16, r: 16, b: 28, l: 52 };
  const W = w - PAD.l - PAD.r;
  const H = h - PAD.t - PAD.b;

  const data = useMemo(() => {
    // Spot price range: ±35% from current spot
    const lo = spot * 0.65;
    const hi = spot * 1.35;
    const range = hi - lo;

    // Payoff function — writer's P&L is the buyer's, negated
    const pnl = (s: number) => {
      const intrinsic = isCall ? Math.max(0, s - strike) : Math.max(0, strike - s);
      const buyerPnl = (intrinsic - premium) * contracts;
      return short ? -buyerPnl : buyerPnl;
    };

    const steps = 200;
    const pts = Array.from({ length: steps + 1 }, (_, i) => {
      const s = lo + (range * i) / steps;
      return { s, p: pnl(s) };
    });

    const breakeven = isCall ? strike + premium : strike - premium;

    // Y scale: worst/best pnl actually visible in this window, with headroom
    const maxPnl = pts.reduce((m, pt) => Math.max(m, pt.p), 0);
    const worstPnl = pts.reduce((m, pt) => Math.min(m, pt.p), 0);
    const minPnl = Math.min(worstPnl * 1.3, -premium * contracts * 1.2);
    const yRange = Math.max(maxPnl * 1.2, premium * 2) - minPnl;

    const toX = (s: number) => ((s - lo) / range) * W;
    const toY = (p: number) => H - ((p - minPnl) / yRange) * H;
    const zeroY = toY(0);

    const pathData = pts.map((pt, i) => {
      const x = toX(pt.s);
      const y = toY(pt.p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

    // Area fills — above zero (profit) and below zero (loss)
    const profitArea = pts
      .map(pt => ({ x: toX(pt.s), y: toY(Math.max(0, pt.p)) }));
    const lossArea = pts
      .map(pt => ({ x: toX(pt.s), y: toY(Math.min(0, pt.p)) }));

    const profitPath = profitArea
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
      .join(" ") + ` L${toX(hi).toFixed(1)},${zeroY.toFixed(1)} L${toX(lo).toFixed(1)},${zeroY.toFixed(1)} Z`;

    const lossPath = lossArea
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
      .join(" ") + ` L${toX(hi).toFixed(1)},${zeroY.toFixed(1)} L${toX(lo).toFixed(1)},${zeroY.toFixed(1)} Z`;

    // Y-axis labels
    const yLabels = [-premium * contracts, 0, premium * contracts * 2].map(v => ({
      value: v,
      y: toY(v),
      label: v === 0 ? "0" : v > 0 ? `+$${v.toFixed(2)}` : `−$${Math.abs(v).toFixed(2)}`,
    }));

    // X-axis labels
    const xLabels = [lo, spot, strike, hi].filter((v, i, a) => {
      const dists = a.map(x => Math.abs(x - v));
      return !dists.some((d, j) => j < i && d < range * 0.08);
    }).map(s => ({
      value: s,
      x: toX(s),
      label: s >= 1 ? `$${s.toFixed(2)}` : `$${s.toFixed(4)}`,
    }));

    return {
      pathData, profitPath, lossPath,
      zeroY,
      spotX: toX(spot),
      strikeX: toX(strike),
      breakevenX: toX(breakeven),
      breakevenInRange: breakeven >= lo && breakeven <= hi,
      yLabels, xLabels,
      breakeven, maxPnl,
      // Helpers for the touch/hover readout — the probe maps a position in
      // chart user units back to a spot price and a P&L on the curve.
      toX, toY,
      probeAt: (x: number) => {
        const clamped = Math.max(0, Math.min(W, x));
        const s = lo + (clamped / W) * range;
        return { s, p: pnl(s) };
      },
    };
  }, [spot, strike, premium, isCall, short, contracts, W, H]);

  const color = isCall ? "#5C9A6B" : "#B65640";

  // Touch/hover readout. `pan-y` keeps vertical page scrolling working while
  // a horizontal drag along the chart inspects the payoff curve.
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
        style={{ overflow: "visible", touchAction: "pan-y" }}
        onPointerDown={e => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          moveProbe(e.clientX, e.currentTarget);
        }}
        onPointerMove={e => {
          // Mouse: follow the cursor. Touch/pen: only while pressed, so a
          // swipe that starts on the chart still scrolls the page vertically.
          if (e.pointerType === "mouse" || dragging.current) moveProbe(e.clientX, e.currentTarget);
        }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerLeave={() => { if (!dragging.current) setProbe(null); }}
        onPointerCancel={() => { dragging.current = false; setProbe(null); }}
      >
        <defs>
          <clipPath id="chart-clip">
            <rect x={PAD.l} y={PAD.t} width={W} height={H} />
          </clipPath>
          <linearGradient id="profit-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(92,154,107,0.25)" />
            <stop offset="100%" stopColor="rgba(92,154,107,0.04)" />
          </linearGradient>
          <linearGradient id="loss-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgba(182,86,64,0.25)" />
            <stop offset="100%" stopColor="rgba(182,86,64,0.04)" />
          </linearGradient>
        </defs>

        <g transform={`translate(${PAD.l}, ${PAD.t})`}>
          {/* Grid lines */}
          {data.yLabels.map(l => (
            <line
              key={l.value}
              x1={0} y1={l.y} x2={W} y2={l.y}
              stroke={l.value === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}
              strokeWidth={l.value === 0 ? 1 : 0.5}
              strokeDasharray={l.value === 0 ? "none" : "3 4"}
            />
          ))}

          {/* Loss area fill */}
          <path
            d={data.lossPath}
            fill="url(#loss-grad)"
            clipPath="url(#chart-clip)"
          />

          {/* Profit area fill */}
          <path
            d={data.profitPath}
            fill="url(#profit-grad)"
            clipPath="url(#chart-clip)"
          />

          {/* Current spot vertical */}
          <line
            x1={data.spotX} y1={0} x2={data.spotX} y2={H}
            stroke="rgba(255,255,255,0.2)" strokeWidth={1}
            strokeDasharray="3 3"
          />

          {/* Strike vertical */}
          <line
            x1={data.strikeX} y1={0} x2={data.strikeX} y2={H}
            stroke="rgba(181,150,101,0.4)" strokeWidth={1}
            strokeDasharray="4 3"
          />

          {/* Breakeven vertical */}
          {data.breakevenInRange && (
            <line
              x1={data.breakevenX} y1={0} x2={data.breakevenX} y2={H}
              stroke={color} strokeWidth={1} strokeOpacity={0.5}
            />
          )}

          {/* Payoff curve */}
          <path
            d={data.pathData}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            clipPath="url(#chart-clip)"
          />

          {/* Y-axis labels */}
          {data.yLabels.map(l => (
            <text
              key={l.value}
              x={-6} y={l.y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={9}
              fontFamily="var(--font-mono)"
              fill={l.value === 0 ? "rgba(255,255,255,0.4)"
                  : l.value > 0 ? "rgba(92,154,107,0.7)"
                  : "rgba(182,86,64,0.7)"}
            >
              {l.label}
            </text>
          ))}

          {/* X-axis labels */}
          {!compact && data.xLabels.map(l => (
            <text
              key={l.value}
              x={l.x} y={H + 14}
              textAnchor="middle"
              fontSize={8}
              fontFamily="var(--font-mono)"
              fill="rgba(255,255,255,0.25)"
            >
              {l.label}
            </text>
          ))}

          {/* Strike label */}
          <text
            x={data.strikeX} y={-6}
            textAnchor="middle"
            fontSize={9}
            fontFamily="var(--font-mono)"
            fill="rgba(181,150,101,0.8)"
          >
            K
          </text>

          {/* Current spot label */}
          <text
            x={data.spotX} y={-6}
            textAnchor="middle"
            fontSize={9}
            fontFamily="var(--font-mono)"
            fill="rgba(255,255,255,0.5)"
          >
            S
          </text>

          {/* Breakeven label */}
          {!compact && data.breakevenInRange && (
            <text
              x={data.breakevenX + 3} y={data.zeroY - 5}
              textAnchor="start"
              fontSize={8}
              fontFamily="var(--font-mono)"
              fill={color} fillOpacity={0.7}
            >
              BE
            </text>
          )}

          {/* Chart border */}
          <rect x={0} y={0} width={W} height={H}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />

          {/* Touch / hover readout (mouse hover and finger drag) */}
          {probe && (() => {
            const px = data.toX(probe.s);
            const py = data.toY(probe.p);
            const right = px < W * 0.6;
            return (
              <g pointerEvents="none">
                <line x1={px} y1={0} x2={px} y2={H}
                  stroke="rgba(245,238,220,0.35)" strokeWidth={1} />
                <circle cx={px} cy={py} r={3.5}
                  fill="var(--bg-elevated)" stroke={color} strokeWidth={1.5} />
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

      {/* Legend below */}
      {!compact && (
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 4 }}>
          {[
            short
              ? { label: "Max gain", value: `+$${(premium * contracts).toFixed(2)}`, color: "#5C9A6B" }
              : { label: "Max loss", value: `−$${(premium * contracts).toFixed(2)}`, color: "#B65640" },
            { label: "Breakeven", value: data.breakeven >= 1 ? `$${data.breakeven.toFixed(2)}` : `$${data.breakeven.toFixed(4)}`, color: color },
          ].map(item => (
            <div key={item.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)" }}>
                {item.label}
              </span>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: item.color }}>
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
