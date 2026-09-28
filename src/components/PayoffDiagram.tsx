"use client";

import { useId, useMemo } from "react";
import { useChartGestures } from "../lib/hooks/useChartGestures";
import { useElementWidth } from "../lib/hooks/useElementWidth";

interface PayoffDiagramProps {
  spot: number;
  strike: number;
  premium: number;
  isCall: boolean;
  /** True for a written/short position — mirrors the payoff curve (writer's P&L is the buyer's, negated). */
  short?: boolean;
  contracts?: number;
  /** Preferred width; the chart shrinks to fit a narrower container. */
  width?: number;
  height?: number;
  compact?: boolean;
  /** Crosshair + pinch/wheel zoom. Off for decorative uses (e.g. the home page). */
  interactive?: boolean;
}

const fmtMoneyLabel = (v: number) => (v === 0 ? "0" : v > 0 ? `+$${v.toFixed(2)}` : `−$${Math.abs(v).toFixed(2)}`);
const fmtPriceLabel = (s: number) => (s >= 1 ? `$${s.toFixed(2)}` : `$${s.toFixed(4)}`);

export function PayoffDiagram({
  spot,
  strike,
  premium,
  isCall,
  short = false,
  contracts = 1,
  width: preferredWidth = 340,
  height = 180,
  compact = false,
  interactive = true,
}: PayoffDiagramProps) {
  const [containerRef, measured] = useElementWidth<HTMLDivElement>(preferredWidth);
  const width = Math.min(preferredWidth, measured);
  const PAD = compact ? { t: 8, r: 8, b: 20, l: 40 } : { t: 16, r: 16, b: 28, l: 52 };
  const W = width  - PAD.l - PAD.r;
  const H = height - PAD.t - PAD.b;
  const uid = useId().replace(/:/g, "");
  const gestures = useChartGestures({ svgWidth: width, plotLeft: PAD.l, plotWidth: W });
  const zoom = interactive ? gestures.zoom : 1;

  const data = useMemo(() => {
    // Spot price range: ±35% from current spot, narrowed by zoom
    const half = 0.35 / zoom;
    const lo = spot * (1 - half);
    const hi = spot * (1 + half);
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
      lo, range, pnl, toY,
      pathData, profitPath, lossPath,
      zeroY,
      spotX: toX(spot),
      strikeX: toX(strike),
      breakevenX: toX(breakeven),
      breakevenInRange: breakeven >= lo && breakeven <= hi,
      yLabels, xLabels,
      breakeven, maxPnl,
    };
  }, [spot, strike, premium, isCall, short, contracts, W, H, zoom]);

  const color = isCall ? "#5C9A6B" : "#B65640";
  const cursor = interactive ? gestures.cursor : null;
  const crosshair = cursor === null ? null : (() => {
    const s = data.lo + (cursor / W) * data.range;
    const p = data.pnl(s);
    return { x: cursor, y: Math.min(H, Math.max(0, data.toY(p))), s, p };
  })();
  const interactiveProps = interactive ? gestures.svgProps : {};

  // The legend (non-compact) sits under the chart; reserve its height so it
  // never spills onto whatever follows.
  return (
    <div ref={containerRef} style={{ width: "100%", maxWidth: preferredWidth, minHeight: compact ? height : height + 34 }}>
      <svg
        {...interactiveProps}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ overflow: "visible", display: "block" }}
        role={interactive ? "group" : "img"}
        aria-label={interactive
          ? "Payoff at expiry chart. Arrow keys move the crosshair; plus and minus zoom; 0 resets."
          : "Payoff at expiry chart"}
      >
        <defs>
          <clipPath id={`chart-clip-${uid}`}>
            <rect x={PAD.l} y={PAD.t} width={W} height={H} />
          </clipPath>
          <linearGradient id={`profit-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(92,154,107,0.25)" />
            <stop offset="100%" stopColor="rgba(92,154,107,0.04)" />
          </linearGradient>
          <linearGradient id={`loss-grad-${uid}`} x1="0" y1="1" x2="0" y2="0">
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
            fill={`url(#loss-grad-${uid})`}
            clipPath={`url(#chart-clip-${uid})`}
          />

          {/* Profit area fill */}
          <path
            d={data.profitPath}
            fill={`url(#profit-grad-${uid})`}
            clipPath={`url(#chart-clip-${uid})`}
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
            clipPath={`url(#chart-clip-${uid})`}
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

          {crosshair && (
            <g pointerEvents="none" data-testid="chart-crosshair">
              <line x1={crosshair.x} y1={0} x2={crosshair.x} y2={H} stroke="rgba(243,238,227,0.45)" strokeWidth={1} />
              <circle cx={crosshair.x} cy={crosshair.y} r={3} fill={crosshair.p >= 0 ? "#5C9A6B" : "#B65640"} />
              <g transform={`translate(${Math.min(Math.max(crosshair.x - 55, 0), W - 110)}, 2)`}>
                <rect width={110} height={26} fill="rgba(20,19,15,0.92)" stroke="rgba(255,255,255,0.12)" />
                <text x={6} y={10} fontSize={9} fontFamily="var(--font-mono)" fill="rgba(243,238,227,0.7)">S {fmtPriceLabel(crosshair.s)}</text>
                <text x={6} y={21} fontSize={9} fontFamily="var(--font-mono)" fill={crosshair.p >= 0 ? "#5C9A6B" : "#B65640"}>P&amp;L {fmtMoneyLabel(crosshair.p)}</text>
              </g>
            </g>
          )}

          {/* Chart border */}
          <rect x={0} y={0} width={W} height={H}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        </g>
      </svg>

      {interactive && (
        <span className="sr-only" aria-live="polite">
          {crosshair ? `At ${fmtPriceLabel(crosshair.s)}, P&L ${fmtMoneyLabel(crosshair.p)}` : ""}
        </span>
      )}

      {/* Legend below */}
      {!compact && (
        <div style={{ display: "flex", gap: 16, justifyContent: "center", alignItems: "center", marginTop: 4 }}>
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
          {zoom > 1.01 && (
            <button type="button" onClick={gestures.resetZoom} style={{
              fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-mid)", background: "none",
              border: "1px solid var(--border-default)", padding: "2px 6px", cursor: "pointer",
            }}>{zoom.toFixed(1)}× · reset</button>
          )}
        </div>
      )}
    </div>
  );
}
