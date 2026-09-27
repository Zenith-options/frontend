"use client";

import { useMemo, useState } from "react";
import type { Position } from "../lib/api/types";
import { groupPositionsByUnderlying, positionsToLegs, riskProfile, stressTestPortfolio } from "../lib/risk";
import { netPremium } from "../lib/payoff";
import { fmtN, fmtSpot } from "../lib/pricing";
import { expectedValue } from "../lib/probability";
import { MultiLegPayoffDiagram } from "./MultiLegPayoffDiagram";
import { ProbabilityStats } from "./ProbabilityStats";

interface Props {
  positions: Position[];
  spots: Record<string, number>;
  vols: Record<string, number>;
}

// Positions on one underlying can have different expiries, but the
// payoff curve above already treats them as all expiring together — the
// probability horizon is the nearest expiry, the first point at which
// any of those payoffs actually becomes realized.
function horizonYears(posns: Position[]): number {
  return posns.length === 0 ? 0 : Math.min(...posns.map(p => p.expiry_days)) / 365;
}

const pnlColor = (v: number) => (v >= 0 ? "var(--call)" : "var(--put)");
const fmtPnl = (v: number) => `${v >= 0 ? "+" : "−"}$${fmtN(Math.abs(v), 2)}`;

export function PortfolioRiskPanel({ positions, spots, vols }: Props) {
  const groups = useMemo(() => groupPositionsByUnderlying(positions), [positions]);
  const underlyings = useMemo(() => Array.from(groups.keys()).sort(), [groups]);
  const [selected, setSelected] = useState(underlyings[0] ?? "");
  const activeUnderlying = underlyings.includes(selected) ? selected : underlyings[0];

  const legs = useMemo(
    () => (activeUnderlying ? positionsToLegs(groups.get(activeUnderlying) ?? []) : []),
    [groups, activeUnderlying]
  );
  const spot = spots[activeUnderlying] ?? 0;
  const profile = useMemo(() => riskProfile(legs, spot), [legs, spot]);
  const premium = useMemo(() => netPremium(legs), [legs]);
  const stress = useMemo(() => stressTestPortfolio(positions, spots), [positions, spots]);
  const vol = vols[activeUnderlying] ?? 0;
  const horizon = useMemo(() => horizonYears(groups.get(activeUnderlying) ?? []), [groups, activeUnderlying]);

  // EV is additive, so unlike PoP it can be summed across underlyings
  // without assuming anything about how they're correlated.
  const accountEv = useMemo(() => {
    let total = 0;
    for (const [u, posns] of Array.from(groups.entries())) {
      const s = spots[u] ?? 0;
      if (s > 0) total += expectedValue(positionsToLegs(posns), { spot: s, vol: vols[u] ?? 0, t: horizonYears(posns) });
    }
    return total;
  }, [groups, spots, vols]);

  if (underlyings.length === 0) return null;

  return (
    <div style={{ marginBottom: 24, border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>Portfolio Risk</div>
        <div style={{ display: "flex", gap: 2 }}>
          {underlyings.map(u => (
            <button key={u} onClick={() => setSelected(u)} style={{
              padding: "3px 10px", border: "none", cursor: "pointer", fontSize: 11,
              background: activeUnderlying === u ? "var(--atm-dim)" : "transparent",
              color: activeUnderlying === u ? "var(--atm)" : "var(--text-lo)",
            }}>{u}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, padding: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 8 }}>
            Combined payoff at expiry · {activeUnderlying} · all open legs
          </div>
          <MultiLegPayoffDiagram legs={legs} spot={spot} width={420} height={200} distribution={{ vol, t: horizon }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 160, paddingTop: 20 }}>
          {[
            { label: "Net Premium", value: `${premium >= 0 ? "−" : "+"}$${fmtN(Math.abs(premium), 2)}`, color: "var(--text-hi)" },
            {
              label: "Max Profit",
              value: profile.maxProfitUnlimited ? "Unlimited" : `+$${fmtN(profile.maxProfit, 2)}`,
              color: "var(--call)",
            },
            {
              label: "Max Loss",
              value: profile.maxLossUnlimited ? "Unlimited" : `−$${fmtN(Math.abs(profile.maxLoss), 2)}`,
              color: "var(--put)",
            },
            {
              label: profile.breakevens.length === 1 ? "Breakeven" : "Breakevens",
              value: profile.breakevens.length === 0 ? "—" : profile.breakevens.map(b => fmtSpot(b)).join(" / "),
              color: "var(--text-hi)",
            },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-lo)", marginBottom: 2 }}>{s.label}</div>
              <div className="num" style={{ fontSize: 13, fontWeight: 600, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ minWidth: 240, flex: "1 1 240px", paddingTop: 20 }}>
          <ProbabilityStats
            legs={legs} spot={spot} vol={vol} t={horizon}
            note={`Measured at the nearest ${activeUnderlying} expiry (${Math.round(horizon * 365)}D); every leg is treated as expiring then.`}
          />
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-lo)", marginBottom: 2 }}>
              Account EV · all underlyings
            </div>
            <div className="num" style={{ fontSize: 12, fontWeight: 600, color: pnlColor(accountEv) }}>{fmtPnl(accountEv)}</div>
          </div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border-default)", padding: "12px 16px" }}>
        <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 8 }}>
          Stress test · account-wide P&amp;L if every underlying moved this much and every position ran to expiry
        </div>
        <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
          {stress.map(r => (
            <div key={r.shock} style={{
              flex: "1 0 90px", padding: "8px 10px", textAlign: "center",
              borderLeft: "1px solid var(--border-subtle)",
              background: r.shock === 0 ? "var(--bg-elevated)" : "transparent",
            }}>
              <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>
                {r.shock === 0 ? "Now" : `${r.shock > 0 ? "+" : ""}${(r.shock * 100).toFixed(0)}%`}
              </div>
              <div className="num" style={{ fontSize: 12, fontWeight: 600, color: pnlColor(r.totalPnl) }}>
                {fmtPnl(r.totalPnl)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
