"use client";

import { useMemo } from "react";
import { buildSurfaceGrid, type SurfaceCell } from "../lib/volSurface";

const MONEYNESS = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2];
const EXPIRY_DAYS = [7, 14, 30, 60, 90, 180];

interface Props {
  baseVol: number;
}

function cellColor(cell: SurfaceCell, minIv: number, maxIv: number): string {
  const t = maxIv > minIv ? (cell.iv - minIv) / (maxIv - minIv) : 0.5;
  // Muted ochre accent, intensity scaled by how far this cell's IV is from
  // the surface's low end — higher IV reads as a stronger fill, not a
  // different hue, since IV is a magnitude, not a good/bad direction.
  const alpha = 0.06 + t * 0.34;
  return `rgba(181,150,101,${alpha.toFixed(3)})`;
}

export function VolSurfaceHeatmap({ baseVol }: Props) {
  const grid = useMemo(() => buildSurfaceGrid(baseVol, MONEYNESS, EXPIRY_DAYS), [baseVol]);
  const { minIv, maxIv } = useMemo(() => {
    const all = grid.flat().map(c => c.iv);
    return { minIv: Math.min(...all), maxIv: Math.max(...all) };
  }, [grid]);

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
                <td key={j} title={`${Math.round(cell.moneyness * 100)}% strike, ${cell.days}D: ${(cell.iv * 100).toFixed(1)}% IV`} style={{
                  width: 32, height: 24, border: "1px solid var(--border-subtle)",
                  background: cellColor(cell, minIv, maxIv),
                  textAlign: "center", fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-mid)",
                }}>
                  {Math.round(cell.iv * 100)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
