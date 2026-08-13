"use client";

import { useMemo } from "react";
import { buildSurfaceGrid } from "../lib/volSurface";

const MONEYNESS = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2];
const EXPIRY_DAYS = [7, 14, 30, 60, 90, 180];

interface Props {
  baseVol: number;
}

export function VolSurfaceHeatmap({ baseVol }: Props) {
  const grid = useMemo(() => buildSurfaceGrid(baseVol, MONEYNESS, EXPIRY_DAYS), [baseVol]);

  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)", marginBottom: 8 }}>
        Volatility Surface
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          {grid.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={{ width: 32, height: 24, border: "1px solid var(--border-subtle)" }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
