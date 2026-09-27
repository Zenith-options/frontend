"use client";

import { PayoffDiagram } from "./PayoffDiagram";
import { fmtK, fmtN, type Greeks } from "../lib/pricing";

export interface OrderTicketProps {
  sym: string;
  /** Expiry label, e.g. "30D". */
  expiryLabel: string;
  side: "call" | "put";
  mode: "buy" | "write";
  strike: number;
  greeks: Greeks;
  spot: number;
  /** Raw contracts input value (string, as typed). */
  contracts: string;
  setContracts: (value: string) => void;
  /** Parsed/clamped contracts. */
  qty: number;
  collateral: number;
  balance: number;
  insufficientFunds: boolean;
  notSignedIn: boolean;
  tradeError: string | null;
  /** Close the ticket (dismiss the bottom sheet / hide the panel). */
  onClose: () => void;
  /** Raise the confirm dialog — the page owns the actual trade execution. */
  onConfirm: () => void;
}

/**
 * The order ticket body: payoff, greeks, size/order entry and strike context.
 *
 * Extracted verbatim from the options page so the *same* markup can be
 * presented either as the desktop right-hand panel or, on phones/tablets, as
 * a bottom sheet. No pricing/trading logic lives here — every figure and
 * callback is passed in, so both presentations stay in lockstep.
 */
export function OrderTicket({
  sym, expiryLabel, side, mode, strike, greeks, spot,
  contracts, setContracts, qty, collateral, balance,
  insufficientFunds, notSignedIn, tradeError, onClose, onConfirm,
}: OrderTicketProps) {
  const sideColor = side === "call" ? "var(--call)" : "var(--put)";

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>

      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)",
        display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
            color: sideColor, marginBottom: 4 }}>
            {mode === "write" ? "WRITE " : "BUY "}{side === "call" ? "▲ CALL" : "▼ PUT"}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}>
            {sym} {side === "call" ? "Call" : "Put"}
          </div>
          <div className="num" style={{ fontSize: 12, color: "var(--text-mid)" }}>
            K={fmtK(strike)} · {expiryLabel}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close order ticket" className="zn-tap-sq" style={{
          background: "none", border: "none", color: "var(--text-lo)", fontSize: 18,
          cursor: "pointer", lineHeight: 1, padding: 4 }}>
          ×
        </button>
      </div>

      {/* Payoff diagram */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
          color: "var(--text-lo)", marginBottom: 8 }}>P&L at Expiry</div>
        <PayoffDiagram
          spot={spot} strike={strike} premium={greeks.premium}
          isCall={side === "call"} short={mode === "write"} contracts={qty}
          width={284} height={155} maxWidth={420}
        />
      </div>

      {/* Greeks grid */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
          color: "var(--text-lo)", marginBottom: 10 }}>Option Greeks</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {[{ g: "Δ Delta", v: greeks.delta, dp: 3, c: "var(--brand)" },
            { g: "Γ Gamma", v: greeks.gamma, dp: 4, c: "var(--text-hi)" },
            { g: "Θ Theta", v: greeks.theta, dp: 4, c: "var(--put)" },
            { g: "V Vega", v: greeks.vega, dp: 3, c: "var(--atm)" },
          ].map(item => (
            <div key={item.g} style={{ padding: "9px 10px", borderRadius: 0,
              border: "1px solid var(--border-default)", background: "var(--bg-elevated)" }}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em",
                color: "var(--text-lo)", marginBottom: 4 }}>{item.g}</div>
              <div className="num" style={{ fontSize: 14, fontWeight: 600, color: item.c }}>
                {item.v >= 0 ? "+" : "\u2212"}{Math.abs(item.v).toFixed(item.dp)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {[{ label: "Premium", v: `$${fmtN(greeks.premium)}`, c: "var(--text-hi)" },
            { label: "Impl. Vol", v: `${(greeks.iv * 100).toFixed(1)}%`, c: "var(--brand)" },
          ].map(item => (
            <div key={item.label} style={{ flex: 1, padding: "9px 10px", borderRadius: 0,
              border: "1px solid var(--border-default)", background: "var(--bg-elevated)" }}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em",
                color: "var(--text-lo)", marginBottom: 4 }}>{item.label}</div>
              <div className="num" style={{ fontSize: 14, fontWeight: 600, color: item.c }}>{item.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Order entry */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
          color: "var(--text-lo)", marginBottom: 8 }}>Order</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>Contracts</div>
          <div style={{ display: "flex", alignItems: "center",
            background: "var(--bg-overlay)", border: "1px solid var(--border-default)",
            borderRadius: 0, overflow: "hidden" }}>
            <button onClick={() => setContracts(String(Math.max(0.01, (parseFloat(contracts) || 1) - 1)))}
              aria-label="Decrease contracts" className="zn-tap-w"
              style={{ width: 36, height: 40, border: "none", background: "none", color: "var(--text-mid)", fontSize: 18, cursor: "pointer" }}>−</button>
            <input type="number" min="0.01" step="0.01" value={contracts}
              inputMode="decimal" aria-label="Contracts"
              onChange={e => setContracts(e.target.value)}
              onBlur={e => setContracts(String(Math.max(0.01, parseFloat(e.target.value) || 1)))}
              style={{ flex: 1, height: 40, border: "none", background: "none", textAlign: "center",
                fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--text-hi)", outline: "none", minWidth: 0 }}/>
            <button onClick={() => setContracts(String((parseFloat(contracts) || 0) + 1))}
              aria-label="Increase contracts" className="zn-tap-w"
              style={{ width: 36, height: 40, border: "none", background: "none", color: "var(--text-mid)", fontSize: 18, cursor: "pointer" }}>+</button>
          </div>
        </div>
        <div style={{ background: "var(--bg-elevated)", borderRadius: 0, padding: "9px 12px", marginBottom: 10 }}>
          {(mode === "write" ? [
            ["Qty", `${contracts} × ${sym}`],
            ["Premium received", `+$${fmtN(greeks.premium * qty)}`],
            ["Collateral required", `$${fmtN(collateral)}`],
            ["Available balance", `$${fmtN(balance, 2)}`],
          ] : [
            ["Qty", `${contracts} × ${sym}`],
            ["Total premium", `$${fmtN(greeks.premium * qty)}`],
            ["Max loss", `$${fmtN(greeks.premium * qty)}`],
            ["Available balance", `$${fmtN(balance, 2)}`],
          ]).map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-lo)" }}>{k}</span>
              <span className="num" style={{ fontSize: 11,
                color: k === "Premium received" ? "var(--call)" : "var(--text-hi)" }}>{v}</span>
            </div>
          ))}
          {insufficientFunds && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border-default)",
              fontSize: 11, color: "var(--put)" }}>
              Insufficient balance {mode === "write" ? "to post collateral" : "to cover premium"}.
            </div>
          )}
          {notSignedIn && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border-default)",
              fontSize: 11, color: "var(--put)" }}>
              Connect your wallet to trade.
            </div>
          )}
          {tradeError && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border-default)",
              fontSize: 11, color: "var(--put)" }}>
              {tradeError}
            </div>
          )}
        </div>
        <button onClick={onConfirm} disabled={insufficientFunds || notSignedIn} style={{ width: "100%", height: 44, borderRadius: 0, border: "none",
          cursor: insufficientFunds || notSignedIn ? "default" : "pointer", fontSize: 14, fontWeight: 700,
          opacity: insufficientFunds || notSignedIn ? 0.5 : 1,
          background: sideColor, color: "var(--bg)" }}>
          {mode === "write" ? "Write" : "Buy"} {side.toUpperCase()} @ {fmtK(strike)}
        </button>
      </div>

      <div style={{ padding: "14px 16px" }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 8 }}>
          Strategies using this strike
        </div>
        {(side === "call"
          ? ["Covered Call — sell this call against stock", "Bull Call Spread — buy this, sell higher strike", "Long Call — pure directional bet"]
          : ["Protective Put — hedge long exposure", "Bear Put Spread — buy this, sell lower strike", "Cash-Secured Put — sell this for income"]
        ).map(s => (
          <div key={s} style={{ padding: "7px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: 11, color: "var(--text-mid)", cursor: "pointer", transition: "color 100ms" }}
            onMouseOver={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-hi)"; }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-mid)"; }}>
            → {s}
          </div>
        ))}
      </div>
    </div>
  );
}
