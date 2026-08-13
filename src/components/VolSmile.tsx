"use client";

import { useMemo } from "react";

interface VolSmileProps {
  spot: number;
  baseVol: number;   // e.g. 0.82
  width?: number;
  height?: number;
}

export function VolSmile({ spot, baseVol, width = 260, height = 110 }: VolSmileProps) {
  const PAD = { t: 12, r: 12, b: 24, l: 36 };
  const W = width  - PAD.l - PAD.r;
  const H = height - PAD.t - PAD.b;

  const data = useMemo(() => {
    // Generate a realistic crypto vol smile with left skew
    // Moneyness = strike / spot
    const moneyness = Array.from({ length: 41 }, (_, i) => 0.70 + i * 0.015);

    const smile = moneyness.map(m => {
      // Crypto exhibits pronounced put skew + wings
      const atm   = baseVol;
      const skew  = -0.15 * (m - 1);           // left skew: OTM puts have higher IV
      const smile_ = 0.08 * (m - 1) ** 2;      // smile curvature
      const wing   = 0.12 * Math.max(0, (Math.abs(m - 1) - 0.15) ** 2); // far wing steepening
      return Math.max(0.1, atm + skew + smile_ + wing);
    });

    const minVol = Math.min(...smile) * 0.95;
    const maxVol = Math.max(...smile) * 1.05;
    const volRange = maxVol - minVol;
    const mRange = moneyness[moneyness.length - 1] - moneyness[0];

    const toX = (m: number) => ((m - moneyness[0]) / mRange) * W;
    const toY = (v: number) => H - ((v - minVol) / volRange) * H;

    const pts = moneyness.map((m, i) => ({ m, v: smile[i], x: toX(m), y: toY(smile[i]) }));
    const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const area = path + ` L${W},${H} L0,${H} Z`;

    // ATM position
    const atmX = toX(1.0);
    const atmY = toY(baseVol);

    // Y-axis labels
    const yLabels = [minVol, baseVol, maxVol].map(v => ({
      v, y: toY(v), label: `${Math.round(v * 100)}%`
    }));

    return { pts, path, area, atmX, atmY, yLabels };
  }, [spot, baseVol]);

  return (
    <div>
      <div style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
        color: "var(--text-lo)", marginBottom: 8
      }}>
        Volatility Smile
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="smile-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(139,92,246,0.20)" />
            <stop offset="100%" stopColor="rgba(139,92,246,0.02)" />
          </linearGradient>
          <clipPath id="smile-clip">
            <rect x={PAD.l} y={PAD.t} width={W} height={H} />
          </clipPath>
        </defs>

        <g transform={`translate(${PAD.l}, ${PAD.t})`}>
          {/* Grid */}
          {data.yLabels.map(l => (
            <line key={l.v}
              x1={0} y1={l.y} x2={W} y2={l.y}
              stroke="rgba(255,255,255,0.04)" strokeWidth={0.5}
            />
          ))}

          {/* ATM vertical */}
          <line
            x1={data.atmX} y1={0} x2={data.atmX} y2={H}
            stroke="rgba(234,179,8,0.2)" strokeWidth={1}
            strokeDasharray="3 3"
          />

          {/* Area */}
          <path d={data.area} fill="url(#smile-grad)" clipPath="url(#smile-clip)" />

          {/* Smile curve */}
          <path d={data.path} fill="none"
            stroke="#8B5CF6" strokeWidth={1.5}
            strokeLinecap="round" strokeLinejoin="round"
            clipPath="url(#smile-clip)"
          />

          {/* ATM dot */}
          <circle cx={data.atmX} cy={data.atmY} r={3}
            fill="var(--bg-elevated)" stroke="#EAB308" strokeWidth={1.5}
          />

          {/* Y labels */}
          {data.yLabels.map(l => (
            <text key={l.v}
              x={-4} y={l.y}
              textAnchor="end" dominantBaseline="middle"
              fontSize={8} fontFamily="'JetBrains Mono',monospace"
              fill="var(--text-lo)"
            >
              {l.label}
            </text>
          ))}

          {/* X labels */}
          {[0.75, 1.00, 1.25].map(m => {
            const x = ((m - 0.70) / (0.70 * 41/40)) * W;
            return (
              <text key={m}
                x={x} y={H + 14}
                textAnchor="middle"
                fontSize={8} fontFamily="'JetBrains Mono',monospace"
                fill={m === 1.0 ? "rgba(234,179,8,0.6)" : "var(--text-lo)"}
              >
                {m === 1.0 ? "ATM" : `${Math.round(m * 100)}%`}
              </text>
            );
          })}

          {/* Border */}
          <rect x={0} y={0} width={W} height={H}
            fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={1}
          />
        </g>
      </svg>
    </div>
  );
}
