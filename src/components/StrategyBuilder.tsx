"use client";

import { fmtK, fmtN, type Expiry } from "../lib/pricing";
import { isMultiExpiry, nearestExpiryDays, type PricedLeg } from "../lib/payoff";
import { legsHaveUnboundedLoss, type StrategyOutlook, type StrategyVolView } from "../lib/strategies";
import { MultiLegPayoffDiagram } from "./MultiLegPayoffDiagram";
import { StrategyBadges } from "./StrategyPicker";

/** One concrete leg in the builder — per strategy unit, before contracts. */
export interface BuilderLeg {
  side: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  expiryDays: number;
  ratio: number;
}

export interface BuilderState {
  /** "template": still exactly a library template (re-resolved when the
   *  selected expiry changes); "custom": edited by hand or loaded from
   *  the finder, so its strikes/expiries are left alone. */
  source: "template" | "custom";
  templateId: string | null;
  name: string;
  outlook?: StrategyOutlook;
  volView?: StrategyVolView;
  legs: BuilderLeg[];
  /** Strikes were widened off their nearest listed strike to stay distinct. */
  adjusted: boolean;
  error: string | null;
}

interface Props {
  builder: BuilderState;
  pricedLegs: PricedLeg[];
  spot: number;
  listedStrikes: number[];
  expiries: Expiry[];
  netPremium: number;
  collateral: number;
  onChange: (next: BuilderState) => void;
  children?: React.ReactNode;
}

const cellBtn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border-default)", color: "var(--text-mid)",
  fontSize: 10, cursor: "pointer", padding: "2px 6px",
};

export function StrategyBuilder({ builder, pricedLegs, spot, listedStrikes, expiries, netPremium, collateral, onChange, children }: Props) {
  const strikes = Array.from(new Set(listedStrikes)).sort((a, b) => a - b);
  const undefinedRisk = legsHaveUnboundedLoss(pricedLegs);
  const multiExpiry = isMultiExpiry(pricedLegs);
  const nearDays = nearestExpiryDays(pricedLegs);

  const edit = (legs: BuilderLeg[]) => onChange({
    ...builder, legs, source: "custom", adjusted: false, error: null,
    name: builder.source === "template" ? `Custom (from ${builder.name})` : builder.name,
    // Hand-edited legs may no longer match the template's outlook/vol labels.
    outlook: builder.source === "template" ? undefined : builder.outlook,
    volView: builder.source === "template" ? undefined : builder.volView,
  });
  const patchLeg = (i: number, patch: Partial<BuilderLeg>) =>
    edit(builder.legs.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const stepStrike = (i: number, dir: 1 | -1) => {
    const cur = builder.legs[i].strike;
    const next = dir > 0 ? strikes.find(k => k > cur + 1e-12) : [...strikes].reverse().find(k => k < cur - 1e-12);
    if (next !== undefined) patchLeg(i, { strike: next });
  };
  const addLeg = (side: "call" | "put") => {
    const atm = strikes.length ? strikes.reduce((b, k) => (Math.abs(k - spot) < Math.abs(b - spot) ? k : b), strikes[0]) : spot;
    const expiryDays = builder.legs[0]?.expiryDays ?? expiries[0]?.days ?? 30;
    edit([...builder.legs, { side, action: "buy", strike: atm, expiryDays, ratio: 1 }]);
  };

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-hi)", marginBottom: 8 }}>{builder.name}</div>
      <div style={{ marginBottom: 12 }}>
        <StrategyBadges outlook={builder.outlook} volView={builder.volView}
          risk={undefinedRisk ? "undefined" : "defined"} multiExpiry={multiExpiry} />
      </div>

      {builder.error && (
        <div role="alert" style={{ fontSize: 11, color: "var(--put)", marginBottom: 10 }}>{builder.error}</div>
      )}

      {undefinedRisk && (
        <div role="alert" style={{
          padding: "10px 12px", marginBottom: 12, border: "1px solid var(--put)", background: "var(--put-dim)",
          fontSize: 11, color: "var(--text-hi)", lineHeight: 1.5,
        }}>
          <b style={{ color: "var(--put)" }}>⚠ Undefined risk.</b> This position is net short options on at least one side,
          so its loss is not capped by the other legs. A large move against it can lose far more than the premium
          collected — only the posted collateral stands behind it.
        </div>
      )}

      {pricedLegs.map((leg, i) => {
        const b = builder.legs[i];
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
            <button onClick={() => patchLeg(i, { action: b.action === "buy" ? "sell" : "buy" })}
              aria-label={`Leg ${i + 1}: switch to ${b.action === "buy" ? "sell" : "buy"}`}
              style={{ ...cellBtn, width: 40, color: b.action === "buy" ? "var(--call)" : "var(--put)", textTransform: "uppercase" }}>
              {b.action}
            </button>
            <span className="num" style={{ fontSize: 11, color: "var(--text-mid)", width: 22 }}>{b.ratio}×</span>
            <button onClick={() => patchLeg(i, { side: b.side === "call" ? "put" : "call" })}
              aria-label={`Leg ${i + 1}: switch to ${b.side === "call" ? "put" : "call"}`}
              style={{ ...cellBtn, width: 38, textTransform: "uppercase" }}>{b.side}</button>
            <button onClick={() => stepStrike(i, -1)} aria-label={`Leg ${i + 1}: lower strike`} style={cellBtn}>◀</button>
            <span className="num" style={{ fontSize: 11, color: "var(--text-hi)", minWidth: 70, textAlign: "center" }}>K={fmtK(leg.strike)}</span>
            <button onClick={() => stepStrike(i, 1)} aria-label={`Leg ${i + 1}: raise strike`} style={cellBtn}>▶</button>
            <select value={b.expiryDays} onChange={e => patchLeg(i, { expiryDays: Number(e.target.value) })}
              aria-label={`Leg ${i + 1}: expiry`}
              style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 10, padding: "2px" }}>
              {(expiries.some(e => e.days === b.expiryDays) ? expiries : [...expiries, { label: `${b.expiryDays}D`, days: b.expiryDays }])
                .map(e => <option key={e.days} value={e.days}>{e.label}</option>)}
            </select>
            <span className="num" style={{ fontSize: 11, color: "var(--text-hi)", marginLeft: "auto" }}>${fmtN(leg.greeks.premium, 4)}</span>
            <button onClick={() => edit(builder.legs.filter((_, j) => j !== i))} aria-label={`Remove leg ${i + 1}`}
              style={{ background: "none", border: "none", color: "var(--text-lo)", fontSize: 14, cursor: "pointer", padding: "0 4px" }}>×</button>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button onClick={() => addLeg("call")} style={cellBtn}>+ Call leg</button>
        <button onClick={() => addLeg("put")} style={cellBtn}>+ Put leg</button>
      </div>

      {builder.adjusted && (
        <div style={{ marginTop: 8, fontSize: 10, color: "var(--atm)" }}>
          Some strikes were widened to the next listed strike: at this price the template&apos;s offsets rounded onto the same strike.
        </div>
      )}

      {pricedLegs.length > 0 && (<>
        <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
          <div>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)" }}>
              {netPremium >= 0 ? "Net Debit" : "Net Credit"}
            </div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, color: netPremium >= 0 ? "var(--put)" : "var(--call)" }}>
              ${fmtN(Math.abs(netPremium), 2)}
            </div>
          </div>
          {collateral > 0 && (
            <div>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)" }}>Collateral Required</div>
              <div className="num" style={{ fontSize: 13, fontWeight: 600, color: "var(--atm)" }}>${fmtN(collateral, 2)}</div>
            </div>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <MultiLegPayoffDiagram legs={pricedLegs} spot={spot} width={420} height={220} />
          {multiExpiry && nearDays !== null && (
            <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-mid)", lineHeight: 1.5, maxWidth: 420 }}>
              Legs expire on different dates, so this curve is P&amp;L at the nearest expiry ({nearDays}D): expired legs at
              intrinsic value, longer-dated legs marked to model (Black-Scholes at today&apos;s IV for their remaining time).
              Real P&amp;L will differ if implied vol moves before then.
            </div>
          )}
        </div>
      </>)}

      {children}
    </div>
  );
}
