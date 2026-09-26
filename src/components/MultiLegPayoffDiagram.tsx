"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  combinedPnl,
  combinedPayoffSeries,
  markToModelGreeks,
  markToModelPnl,
  markToModelSeries,
  nearestExpiryDays,
  type PricedLeg,
} from "../lib/payoff";
import { createQuantScheduler } from "../lib/quantWorker";
import { fmtN } from "../lib/pricing";

interface Props {
  legs: PricedLeg[];
  spot: number;
  baseVol?: number;
  width?: number;
  height?: number;
  /** Listed strikes for draggable handles (#32). */
  strikes?: number[];
  onStrikeDrag?: (legIndex: number, newStrike: number) => void;
  /** When true, show today / T+n / expiry curves + controls (#33). */
  timeAware?: boolean;
}

const CURVE_COLORS = {
  today: "#8B9DC3",
  forward: "#B59665",
  expiry: "#5C9A6B",
};

export function MultiLegPayoffDiagram({
  legs,
  spot,
  baseVol = 0.5,
  width = 340,
  height = 180,
  strikes,
  onStrikeDrag,
  timeAware = true,
}: Props) {
  const PAD = { t: 20, r: 16, b: 28, l: 52 };
  const W = width - PAD.l - PAD.r;
  const H = height - PAD.t - PAD.b;

  const maxForward = nearestExpiryDays(legs);
  const [daysForward, setDaysForward] = useState(0);
  const [ivShiftPct, setIvShiftPct] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [curves, setCurves] = useState<{
    today: { s: number; p: number }[];
    forward: { s: number; p: number }[];
    expiry: { s: number; p: number }[];
  } | null>(null);

  const lo = spot * 0.65;
  const hi = spot * 1.35;
  const ivShift = ivShiftPct / 100;

  useEffect(() => {
    if (daysForward > maxForward) setDaysForward(maxForward);
  }, [maxForward, daysForward]);

  useEffect(() => {
    if (!timeAware) {
      setCurves({
        today: [],
        forward: [],
        expiry: combinedPayoffSeries(legs, lo, hi),
      });
      return;
    }
    const sched = createQuantScheduler(bundle => {
      setCurves({ today: bundle.today, forward: bundle.forward, expiry: bundle.expiry });
    });
    sched.schedule({ legs, lo, hi, tForwardDays: daysForward, ivShift, baseVol, steps: 160 });
    return () => sched.cancel();
  }, [legs, lo, hi, daysForward, ivShift, baseVol, timeAware]);

  const seriesExpiry = useMemo(
    () => curves?.expiry ?? combinedPayoffSeries(legs, lo, hi),
    [curves, legs, lo, hi]
  );
  const seriesToday = useMemo(
    () => curves?.today ?? (timeAware ? markToModelSeries(legs, lo, hi, 0, ivShift, baseVol) : []),
    [curves, timeAware, legs, lo, hi, ivShift, baseVol]
  );
  const seriesFwd = useMemo(
    () => curves?.forward ?? (timeAware ? markToModelSeries(legs, lo, hi, daysForward, ivShift, baseVol) : []),
    [curves, timeAware, legs, lo, hi, daysForward, ivShift, baseVol]
  );

  const data = useMemo(() => {
    const all = [...seriesExpiry, ...seriesToday, ...seriesFwd];
    const maxPnl = all.reduce((m, pt) => Math.max(m, pt.p), 0);
    const minPnl = all.reduce((m, pt) => Math.min(m, pt.p), 0);
    const yRange = Math.max(maxPnl - minPnl, 0.01) * 1.3;
    const yMid = (maxPnl + minPnl) / 2;
    const yLo = yMid - yRange / 2;
    const range = hi - lo;

    const toX = (s: number) => ((s - lo) / range) * W;
    const toY = (p: number) => H - ((p - yLo) / yRange) * H;
    const zeroY = toY(0);
    const pathOf = (series: { s: number; p: number }[]) =>
      series.map((pt, i) => `${i === 0 ? "M" : "L"}${toX(pt.s).toFixed(1)},${toY(pt.p).toFixed(1)}`).join(" ");

    const profitPath = seriesExpiry.map(pt => ({ x: toX(pt.s), y: toY(Math.max(0, pt.p)) }))
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")
      + ` L${toX(hi).toFixed(1)},${zeroY.toFixed(1)} L${toX(lo).toFixed(1)},${zeroY.toFixed(1)} Z`;
    const lossPath = seriesExpiry.map(pt => ({ x: toX(pt.s), y: toY(Math.min(0, pt.p)) }))
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")
      + ` L${toX(hi).toFixed(1)},${zeroY.toFixed(1)} L${toX(lo).toFixed(1)},${zeroY.toFixed(1)} Z`;

    return {
      lo, hi, toX, toY, zeroY, maxPnl, minPnl, range,
      expiryPath: pathOf(seriesExpiry),
      todayPath: pathOf(seriesToday),
      forwardPath: pathOf(seriesFwd),
      profitPath, lossPath,
      yLabels: [minPnl, 0, maxPnl].map(v => ({ v, y: toY(v) })),
      spotX: toX(spot),
    };
  }, [seriesExpiry, seriesToday, seriesFwd, lo, hi, W, H, spot]);

  const hoverSpot = hoverX == null ? null : data.lo + (hoverX / W) * (data.hi - data.lo);
  const hoverInfo = useMemo(() => {
    if (hoverSpot == null) return null;
    const expiryP = combinedPnl(legs, hoverSpot);
    const todayP = markToModelPnl(legs, hoverSpot, 0, ivShift, baseVol);
    const fwdP = markToModelPnl(legs, hoverSpot, daysForward, ivShift, baseVol);
    const greeks = markToModelGreeks(legs, hoverSpot, daysForward, ivShift, baseVol);
    return { todayP, fwdP, expiryP, greeks, spot: hoverSpot };
  }, [hoverSpot, legs, daysForward, ivShift, baseVol]);

  // Drag strike handles
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ legIndex: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent, legIndex: number) => {
    if (!onStrikeDrag || !strikes?.length) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { legIndex };
  }, [onStrikeDrag, strikes]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !svgRef.current || !onStrikeDrag || !strikes?.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - PAD.l;
    const raw = data.lo + (x / W) * (data.hi - data.lo);
    const snapped = strikes.reduce((best, s) =>
      Math.abs(s - raw) < Math.abs(best - raw) ? s : best
    );
    onStrikeDrag(dragRef.current.legIndex, snapped);
  }, [onStrikeDrag, strikes, data.lo, data.hi, W, PAD.l]);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  return (
    <div>
      {timeAware && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 10, color: "var(--text-lo)", minWidth: 72 }}>T+{daysForward}d</label>
            <input
              type="range" min={0} max={Math.max(0, maxForward)} step={1}
              value={daysForward}
              onChange={e => setDaysForward(Number(e.target.value))}
              style={{ flex: 1 }}
              aria-label="Days forward"
            />
            <span className="num" style={{ fontSize: 10, color: "var(--text-mid)", minWidth: 36 }}>
              {daysForward}/{maxForward}d
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 10, color: "var(--text-lo)", minWidth: 72 }}>IV shift</label>
            <input
              type="range" min={-50} max={100} step={1}
              value={ivShiftPct}
              onChange={e => setIvShiftPct(Number(e.target.value))}
              style={{ flex: 1 }}
              aria-label="IV shift percent"
            />
            <span className="num" style={{ fontSize: 10, color: "var(--text-mid)", minWidth: 36 }}>
              {ivShiftPct >= 0 ? "+" : ""}{ivShiftPct}%
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 9, color: "var(--text-lo)" }}>
            <span><span style={{ color: CURVE_COLORS.today }}>━</span> Today</span>
            <span><span style={{ color: CURVE_COLORS.forward }}>━</span> T+{daysForward}</span>
            <span><span style={{ color: CURVE_COLORS.expiry }}>━</span> Expiry</span>
          </div>
        </div>
      )}

      <div style={{ width, height, position: "relative" }}>
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onPointerMove={e => {
            onPointerMove(e);
            if (!dragRef.current) {
              const rect = svgRef.current?.getBoundingClientRect();
              if (rect) setHoverX(Math.max(0, Math.min(W, e.clientX - rect.left - PAD.l)));
            }
          }}
          onPointerLeave={() => { setHoverX(null); onPointerUp(); }}
          onPointerUp={onPointerUp}
        >
          <defs>
            <clipPath id="ml-chart-clip"><rect x={PAD.l} y={PAD.t} width={W} height={H} /></clipPath>
          </defs>
          <g transform={`translate(${PAD.l}, ${PAD.t})`}>
            <line x1={0} y1={data.zeroY} x2={W} y2={data.zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
            <path d={data.lossPath} fill="rgba(182,86,64,0.12)" clipPath="url(#ml-chart-clip)" />
            <path d={data.profitPath} fill="rgba(92,154,107,0.12)" clipPath="url(#ml-chart-clip)" />
            <line x1={data.spotX} y1={0} x2={data.spotX} y2={H} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3" />

            {timeAware && seriesToday.length > 0 && (
              <path d={data.todayPath} fill="none" stroke={CURVE_COLORS.today} strokeWidth={1.5} strokeDasharray="4 3" clipPath="url(#ml-chart-clip)" />
            )}
            {timeAware && daysForward > 0 && seriesFwd.length > 0 && (
              <path d={data.forwardPath} fill="none" stroke={CURVE_COLORS.forward} strokeWidth={1.75} clipPath="url(#ml-chart-clip)" />
            )}
            <path d={data.expiryPath} fill="none" stroke={CURVE_COLORS.expiry} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" clipPath="url(#ml-chart-clip)" />

            {/* Strike drag handles */}
            {onStrikeDrag && legs.map((leg, i) => {
              const x = data.toX(leg.strike);
              if (x < 0 || x > W) return null;
              return (
                <g key={leg.strike + "-" + i}>
                  <line x1={x} y1={0} x2={x} y2={H} stroke="rgba(181,150,101,0.35)" strokeWidth={1} strokeDasharray="3 2" />
                  <circle
                    cx={x} cy={data.zeroY}
                    r={7}
                    fill="var(--brand)"
                    stroke="var(--bg)"
                    strokeWidth={2}
                    style={{ cursor: "ew-resize" }}
                    tabIndex={0}
                    role="slider"
                    aria-label={`Leg ${i + 1} strike ${leg.strike}`}
                    aria-valuenow={leg.strike}
                    onPointerDown={e => onPointerDown(e, i)}
                    onKeyDown={e => {
                      if (!strikes?.length) return;
                      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                        e.preventDefault();
                        const sorted = [...strikes].sort((a, b) => a - b);
                        const idx = sorted.findIndex(s => Math.abs(s - leg.strike) < 1e-9);
                        const next = e.key === "ArrowLeft" ? Math.max(0, idx - 1) : Math.min(sorted.length - 1, idx + 1);
                        if (idx >= 0) onStrikeDrag(i, sorted[next]);
                      }
                    }}
                  />
                </g>
              );
            })}

            {hoverX != null && (
              <line x1={hoverX} y1={0} x2={hoverX} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
            )}

            {data.yLabels.map(l => (
              <text key={l.v} x={-6} y={l.y} textAnchor="end" dominantBaseline="middle" fontSize={9} fontFamily="var(--font-mono)"
                fill={l.v === 0 ? "rgba(255,255,255,0.4)" : l.v > 0 ? "rgba(92,154,107,0.7)" : "rgba(182,86,64,0.7)"}>
                {l.v === 0 ? "0" : `${l.v > 0 ? "+" : "−"}$${Math.abs(l.v).toFixed(2)}`}
              </text>
            ))}
            <text x={data.spotX} y={-6} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.5)">S</text>
            <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          </g>
        </svg>

        {hoverInfo && (
          <div style={{
            position: "absolute", top: 4, right: 8, padding: "6px 8px",
            background: "rgba(0,0,0,0.75)", border: "1px solid var(--border-default)",
            fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-hi)", pointerEvents: "none",
          }}>
            <div>Spot {fmtN(hoverInfo.spot, 4)}</div>
            {timeAware && <div style={{ color: CURVE_COLORS.today }}>Today {hoverInfo.todayP >= 0 ? "+" : "−"}${fmtN(Math.abs(hoverInfo.todayP), 2)}</div>}
            {timeAware && <div style={{ color: CURVE_COLORS.forward }}>T+{daysForward} {hoverInfo.fwdP >= 0 ? "+" : "−"}${fmtN(Math.abs(hoverInfo.fwdP), 2)}</div>}
            <div style={{ color: CURVE_COLORS.expiry }}>Expiry {hoverInfo.expiryP >= 0 ? "+" : "−"}${fmtN(Math.abs(hoverInfo.expiryP), 2)}</div>
            <div style={{ marginTop: 4, color: "var(--text-lo)" }}>
              Δ{hoverInfo.greeks.delta.toFixed(3)} Γ{hoverInfo.greeks.gamma.toFixed(4)} Θ{hoverInfo.greeks.theta.toFixed(4)} V{hoverInfo.greeks.vega.toFixed(3)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
