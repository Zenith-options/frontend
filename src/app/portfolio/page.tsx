"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { useBackendData } from "../../lib/context/BackendDataContext";
import { useSpotFeedContext } from "../../lib/context/SpotFeedContext";
import { useWalletStore } from "../../lib/store/wallet";
import { ApiError } from "../../lib/api/client";
import type { Position } from "../../lib/api/types";
import { MARKETS, EXPIRIES, bs, smileVol, fmtN, fmtK } from "../../lib/pricing";
import { collateralRequired } from "../../lib/collateral";
import { toCsv, downloadCsv } from "../../lib/csv";
import { ExportButton } from "../../components/ExportButton";
import { PortfolioRiskPanel } from "../../components/PortfolioRiskPanel";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { aggregateClosePreview, clampCloseQty, previewPartialClosePnl, CONTRACT_STEP } from "../../lib/close/partialPnl";
import type { BatchItem, CloseMode } from "../../lib/close/batchExecutor";
import { detectCloseFeatures, type FeatureFlags } from "../../lib/api/close";

interface Marked extends Position {
  spot: number;
  currentPremium: number;
  currentPremiumPer: number;
  pnl: number;
  pnlPct: number;
  liveDelta: number;
  liveGamma: number;
  liveTheta: number;
  liveVega: number;
}

export default function PortfolioPage() {
  const token = useWalletStore(s => s.token);
  const {
    account, positions: backendPositions, greeks: netGreeks,
    close, closeStrategyGroup, closeBatch, roll,
  } = useBackendData();
  const balance = account?.balance ?? 0;
  const collateralLocked = account?.collateral_locked ?? 0;
  const notSignedIn = !token;
  const [actionError, setActionError] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureFlags>({ partialClose: false, strategyClose: false });

  const { data: spotFeed } = useSpotFeedContext();
  const spots = spotFeed?.prices ?? Object.fromEntries(MARKETS.map(m => [m.sym, m.price]));
  const vols = spotFeed?.vols ?? Object.fromEntries(MARKETS.map(m => [m.sym, m.vol]));

  useEffect(() => {
    detectCloseFeatures(token).then(setFeatures).catch(() => undefined);
  }, [token]);

  const marked = useMemo<Marked[]>(() => backendPositions.map(p => {
    const spot = spots[p.underlying] ?? MARKETS.find(m => m.sym === p.underlying)?.price ?? 0;
    const baseVol = vols[p.underlying] ?? MARKETS.find(m => m.sym === p.underlying)?.vol ?? 0.5;
    const t = p.expiry_days / 365;
    const vol = smileVol(baseVol, p.strike / spot);
    const g = bs(spot, p.strike, vol, t, p.option_type === "call");
    const entryTotal = p.entry_premium * p.contracts;
    const currentPremium = g.premium * p.contracts;
    const pnl = p.position_type === "short" ? entryTotal - currentPremium : currentPremium - entryTotal;
    return {
      ...p, spot, currentPremium, currentPremiumPer: g.premium, pnl,
      pnlPct: entryTotal > 0 ? (pnl / entryTotal) * 100 : 0,
      liveDelta: g.delta, liveGamma: g.gamma, liveTheta: g.theta, liveVega: g.vega,
    };
  }), [backendPositions, spots, vols]);

  const totalPnl = useMemo(() => marked.reduce((s, p) => s + p.pnl, 0), [marked]);

  const strategyGroups = useMemo(() => {
    const byId = new Map<string, Marked[]>();
    for (const p of marked) {
      if (!p.strategy_id) continue;
      if (!byId.has(p.strategy_id)) byId.set(p.strategy_id, []);
      byId.get(p.strategy_id)!.push(p);
    }
    return Array.from(byId.entries()).map(([id, legs]) => ({
      id, legs,
      sym: legs[0].underlying,
      totalPnl: legs.reduce((s, l) => s + l.pnl, 0),
      totalCollateral: legs.reduce((s, l) => s + l.collateral, 0),
      totalPremium: legs.reduce((s, l) => s + l.currentPremium, 0),
    }));
  }, [marked]);

  const soloPositions = useMemo(() => marked.filter(p => !p.strategy_id), [marked]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [partialTarget, setPartialTarget] = useState<Marked | null>(null);
  const [partialQty, setPartialQty] = useState("1");
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [strategyConfirm, setStrategyConfirm] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState<CloseMode>("continue");
  const [batchProgress, setBatchProgress] = useState<BatchItem[] | null>(null);
  const [closing, setClosing] = useState(false);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedMarked = useMemo(
    () => marked.filter(p => selected.has(p.id)),
    [marked, selected]
  );

  const batchPreview = useMemo(
    () => aggregateClosePreview(selectedMarked.map(p => ({
      entryPremiumTotal: p.entry_premium * p.contracts,
      currentPremium: p.currentPremium,
      pnl: p.pnl,
      collateral: p.collateral,
    }))),
    [selectedMarked]
  );

  const partialPreview = useMemo(() => {
    if (!partialTarget) return null;
    return previewPartialClosePnl(partialTarget, partialTarget.currentPremiumPer, parseFloat(partialQty) || 0);
  }, [partialTarget, partialQty]);

  const openPartial = (p: Marked) => {
    setPartialTarget(p);
    setPartialQty(String(p.contracts));
    setActionError(null);
  };

  const execPartial = async () => {
    if (!partialTarget || !partialPreview || closing) return;
    setClosing(true);
    setActionError(null);
    try {
      await close(partialTarget.id, partialPreview.closedQty);
      setPartialTarget(null);
    } catch (err) {
      setActionError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to close");
    } finally {
      setClosing(false);
    }
  };

  const execBatch = async () => {
    if (selectedMarked.length === 0 || closing) return;
    setClosing(true);
    setActionError(null);
    setBatchProgress(selectedMarked.map(p => ({ id: p.id, label: `${p.underlying} ${p.option_type}`, status: "pending" })));
    try {
      const result = await closeBatch(selectedMarked.map(p => p.id), {
        mode: batchMode,
        onUpdate: setBatchProgress,
      });
      if (result.failCount > 0) {
        setActionError(`Batch close: ${result.okCount} ok, ${result.failCount} failed${result.stoppedEarly ? " (stopped early)" : ""}`);
      } else {
        setBatchConfirm(false);
        setSelected(new Set());
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Batch close failed");
    } finally {
      setClosing(false);
    }
  };

  const execStrategyClose = async (groupId: string) => {
    const group = strategyGroups.find(g => g.id === groupId);
    if (!group || closing) return;
    setClosing(true);
    setActionError(null);
    setBatchProgress(group.legs.map(l => ({ id: l.id, label: `${l.option_type} ${l.strike}`, status: "pending" })));
    try {
      if (!features.strategyClose) {
        // Prominent non-atomic warning already shown in dialog
      }
      const result = await closeStrategyGroup(groupId, group.legs.map(l => l.id), {
        mode: batchMode,
        onUpdate: setBatchProgress,
      });
      if (Array.isArray(result)) {
        setStrategyConfirm(null);
      } else if (result.failCount > 0) {
        setActionError(`Strategy close: ${result.okCount} ok, ${result.failCount} failed`);
      } else {
        setStrategyConfirm(null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to close strategy");
    } finally {
      setClosing(false);
    }
  };

  const [rollTargetId, setRollTargetId] = useState<string | null>(null);
  const rollTarget = soloPositions.find(p => p.id === rollTargetId) ?? null;
  const [rollStrikeOffsetPct, setRollStrikeOffsetPct] = useState(0);
  const [rollExpiry, setRollExpiry] = useState(EXPIRIES[2]);

  useEffect(() => {
    if (!rollTarget) return;
    setRollStrikeOffsetPct(0);
    setRollExpiry(EXPIRIES.find(e => e.days === rollTarget.expiry_days) ?? EXPIRIES[2]);
  }, [rollTargetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rollPreview = useMemo(() => {
    if (!rollTarget) return null;
    const spot = spots[rollTarget.underlying] ?? MARKETS.find(m => m.sym === rollTarget.underlying)?.price ?? 0;
    const baseVol = vols[rollTarget.underlying] ?? MARKETS.find(m => m.sym === rollTarget.underlying)?.vol ?? 0.5;
    const newStrike = Math.round(rollTarget.strike * (1 + rollStrikeOffsetPct / 100) * 10000) / 10000;
    const t = rollExpiry.days / 365;
    const vol = smileVol(baseVol, newStrike / spot);
    const greeks = bs(spot, newStrike, vol, t, rollTarget.option_type === "call");
    const newPremium = greeks.premium * rollTarget.contracts;
    const newCollateral = rollTarget.position_type === "short"
      ? collateralRequired(rollTarget.option_type, rollTarget.contracts, newStrike, spot) : 0;
    const closeCashEffect = rollTarget.position_type === "short"
      ? rollTarget.collateral - rollTarget.currentPremium
      : rollTarget.currentPremium;
    const openCashEffect = rollTarget.position_type === "short"
      ? newPremium - newCollateral
      : -newPremium;
    const netCashEffect = closeCashEffect + openCashEffect;
    return { spot, newStrike, greeks, newPremium, newCollateral, closeCashEffect, netCashEffect };
  }, [rollTarget, rollStrikeOffsetPct, rollExpiry, spots, vols]);

  const rollInsufficientFunds = rollTarget && rollPreview
    ? balance + rollPreview.closeCashEffect < (rollTarget.position_type === "short" ? rollPreview.newCollateral : rollPreview.newPremium)
    : false;

  const [rolling, setRolling] = useState(false);
  const executeRoll = async () => {
    if (!rollTarget || !rollPreview || rollInsufficientFunds || rolling) return;
    setRolling(true);
    setActionError(null);
    try {
      await roll(rollTarget.id, { newStrike: rollPreview.newStrike, newExpiryDays: rollExpiry.days });
      setRollTargetId(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to roll position");
    } finally {
      setRolling(false);
    }
  };

  const strategyToClose = strategyGroups.find(g => g.id === strategyConfirm) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
      <AppHeader>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--call)" }} />
          <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Marked to market · Stellar Testnet</span>
          <div style={{ width: 1, height: 16, background: "var(--border-default)", margin: "0 8px" }} />
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 64px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Portfolio</h1>
              <p style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 28 }}>
                {notSignedIn
                  ? "Connect your wallet to see your positions."
                  : `${backendPositions.length} open position${backendPositions.length === 1 ? "" : "s"} · live premium repriced off current spot`}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {selected.size > 0 && (
                <button
                  onClick={() => { setBatchProgress(null); setBatchConfirm(true); }}
                  disabled={notSignedIn}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: "6px 12px", cursor: "pointer",
                    background: "var(--brand)", color: "var(--bg)", border: "none",
                  }}
                >
                  Close selected ({selected.size})
                </button>
              )}
              {marked.length > 0 && (
                <ExportButton onClick={() => downloadCsv(
                  `zenith-positions-${new Date().toISOString().slice(0, 10)}.csv`,
                  toCsv(marked, [
                    { header: "Asset", value: p => p.underlying },
                    { header: "Type", value: p => p.position_type },
                    { header: "Side", value: p => p.option_type },
                    { header: "Strike", value: p => p.strike },
                    { header: "Expiry", value: p => `${p.expiry_days}D` },
                    { header: "Qty", value: p => p.contracts },
                    { header: "Strategy", value: p => p.strategy_id ?? "" },
                    { header: "Collateral", value: p => p.collateral },
                    { header: "Entry Premium", value: p => p.entry_premium * p.contracts },
                    { header: "Current Value", value: p => p.currentPremium },
                    { header: "P&L", value: p => p.pnl },
                  ])
                )} />
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 0, marginBottom: 32, border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
            {[
              { label: "Available Balance", value: `$${fmtN(balance, 2)}`, color: "var(--text-hi)" },
              { label: "Collateral Locked", value: `$${fmtN(collateralLocked, 2)}`, color: "var(--atm)" },
              { label: "Unrealized P&L", value: `${totalPnl >= 0 ? "+" : "−"}$${fmtN(Math.abs(totalPnl), 2)}`, color: totalPnl >= 0 ? "var(--call)" : "var(--put)" },
              { label: "Net Delta", value: `${netGreeks.delta >= 0 ? "+" : "−"}${Math.abs(netGreeks.delta).toFixed(3)}`, color: "var(--text-hi)" },
              { label: "Net Theta", value: `${netGreeks.theta >= 0 ? "+" : "−"}${Math.abs(netGreeks.theta).toFixed(4)}`, color: "var(--put)" },
              { label: "Net Vega", value: `${netGreeks.vega >= 0 ? "+" : "−"}${Math.abs(netGreeks.vega).toFixed(3)}`, color: "var(--atm)" },
            ].map((s, i) => (
              <div key={s.label} style={{ flex: 1, padding: "14px 18px", borderRight: i < 5 ? "1px solid var(--border-default)" : "none" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 6 }}>{s.label}</div>
                <div className="num" style={{ fontSize: 17, fontWeight: 600, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {actionError && (
            <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
              {actionError}
            </div>
          )}

          {backendPositions.length > 0 && <PortfolioRiskPanel positions={backendPositions} spots={spots} />}

          {strategyGroups.length > 0 && (
            <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 4 }}>
                Strategy groups
              </div>
              {strategyGroups.map(g => {
                const isCollapsed = !!collapsed[g.id];
                return (
                  <div key={g.id} style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
                      <button
                        onClick={() => setCollapsed(c => ({ ...c, [g.id]: !c[g.id] }))}
                        style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>
                          {isCollapsed ? "▸" : "▾"} {g.sym} Strategy · {g.legs.length} legs
                        </span>
                        <span className="num" style={{ marginLeft: 10, fontSize: 11, color: g.totalPnl >= 0 ? "var(--call)" : "var(--put)" }}>
                          {g.totalPnl >= 0 ? "+" : "−"}${fmtN(Math.abs(g.totalPnl), 2)}
                        </span>
                      </button>
                      <button
                        onClick={() => { setBatchProgress(null); setStrategyConfirm(g.id); }}
                        style={{
                          fontSize: 10, color: "var(--text-lo)", background: "none",
                          border: "1px solid var(--border-default)", padding: "2px 8px", cursor: "pointer",
                        }}
                      >
                        Close strategy
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div style={{ padding: "0 14px 12px" }}>
                        {g.legs.map(leg => (
                          <div key={leg.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", fontSize: 11 }}>
                            <input type="checkbox" checked={selected.has(leg.id)} onChange={() => toggleSelect(leg.id)} />
                            <span style={{ color: leg.position_type === "short" ? "var(--put)" : "var(--call)", textTransform: "uppercase", minWidth: 90 }}>
                              {leg.position_type} {leg.option_type}
                            </span>
                            <span className="num" style={{ color: "var(--text-mid)" }}>K={leg.strike.toFixed(4)}</span>
                            <span className="num" style={{ color: "var(--text-mid)" }}>×{leg.contracts}</span>
                            <span className="num" style={{ marginLeft: "auto", color: leg.pnl >= 0 ? "var(--call)" : "var(--put)" }}>
                              {leg.pnl >= 0 ? "+" : "−"}${fmtN(Math.abs(leg.pnl), 2)}
                            </span>
                            <button onClick={() => openPartial(leg)} style={{
                              fontSize: 10, color: "var(--text-lo)", background: "none",
                              border: "1px solid var(--border-default)", padding: "2px 6px", cursor: "pointer",
                            }}>Partial</button>
                          </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
                          <span style={{ fontSize: 11, color: "var(--text-lo)" }}>
                            {g.totalCollateral > 0 ? `Collateral: $${fmtN(g.totalCollateral, 2)}` : ""}
                          </span>
                          <span className="num" style={{ fontSize: 12, fontWeight: 600, color: g.totalPnl >= 0 ? "var(--call)" : "var(--put)" }}>
                            Combined: {g.totalPnl >= 0 ? "+" : "−"}${fmtN(Math.abs(g.totalPnl), 2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {marked.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: "80px 0", border: "1px solid var(--border-subtle)", background: "var(--bg-raised)", gap: 12,
            }}>
              <div style={{ fontSize: 14, color: "var(--text-mid)" }}>No open positions</div>
              <Link href="/options" style={{ fontSize: 13, color: "var(--brand)", textDecoration: "none" }}>
                Open the options chain →
              </Link>
            </div>
          ) : soloPositions.length === 0 ? null : (
            <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                    <th style={{ padding: "8px 10px", width: 28, background: "var(--bg-overlay)" }}>
                      <input
                        type="checkbox"
                        checked={soloPositions.length > 0 && soloPositions.every(p => selected.has(p.id))}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelected(prev => {
                              const next = new Set(prev);
                              soloPositions.forEach(p => next.add(p.id));
                              return next;
                            });
                          } else {
                            setSelected(prev => {
                              const next = new Set(prev);
                              soloPositions.forEach(p => next.delete(p.id));
                              return next;
                            });
                          }
                        }}
                        aria-label="Select all"
                      />
                    </th>
                    {["Asset", "Type", "Side", "Strike", "Expiry", "Qty", "Collateral", "Entry", "Current", "P&L", "Δ", ""].map(h => (
                      <th key={h} style={{
                        padding: "8px 10px", fontSize: 10, fontWeight: 500, textTransform: "uppercase",
                        letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "right", background: "var(--bg-overlay)",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {soloPositions.map(p => {
                    const sign = p.position_type === "short" ? -1 : 1;
                    return [
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                        </td>
                        <td style={{ padding: "10px", fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{p.underlying}</td>
                        <td style={{ padding: "10px 4px" }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: "2px 6px",
                            background: p.position_type === "short" ? "var(--put-dim)" : "var(--call-dim)",
                            color: p.position_type === "short" ? "var(--put)" : "var(--call)", textTransform: "uppercase",
                          }}>{p.position_type}</span>
                        </td>
                        <td style={{ padding: "10px 4px" }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: "2px 6px",
                            background: p.option_type === "call" ? "var(--call-dim)" : "var(--put-dim)",
                            color: p.option_type === "call" ? "var(--call)" : "var(--put)", textTransform: "uppercase",
                          }}>{p.option_type}</span>
                        </td>
                        <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>
                          {p.strike >= 1000 ? p.strike.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p.strike.toFixed(4)}
                        </td>
                        <td style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{p.expiry_days}D</td>
                        <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>{p.contracts}</td>
                        <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>
                          {p.collateral > 0 ? `$${fmtN(p.collateral, 2)}` : "—"}
                        </td>
                        <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>
                          {p.position_type === "short" ? "+" : ""}${fmtN(p.entry_premium * p.contracts, 2)}
                        </td>
                        <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>${fmtN(p.currentPremium, 2)}</td>
                        <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", fontWeight: 600, color: p.pnl >= 0 ? "var(--call)" : "var(--put)" }}>
                          {p.pnl >= 0 ? "+" : "−"}${fmtN(Math.abs(p.pnl), 2)} <span style={{ opacity: 0.6 }}>({p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(1)}%)</span>
                        </td>
                        <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>
                          {(sign * p.liveDelta * p.contracts).toFixed(3)}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <button onClick={() => setRollTargetId(rollTargetId === p.id ? null : p.id)} disabled={notSignedIn} style={{
                            fontSize: 10, color: rollTargetId === p.id ? "var(--brand)" : "var(--text-lo)", background: "none",
                            border: "1px solid var(--border-default)", padding: "2px 8px", cursor: notSignedIn ? "default" : "pointer", marginRight: 6, opacity: notSignedIn ? 0.5 : 1,
                          }}>Roll</button>
                          <button onClick={() => openPartial(p)} disabled={notSignedIn} style={{
                            fontSize: 10, color: "var(--text-lo)", background: "none", border: "1px solid var(--border-default)",
                            padding: "2px 8px", cursor: notSignedIn ? "default" : "pointer", marginRight: 6, opacity: notSignedIn ? 0.5 : 1,
                          }}>Close…</button>
                        </td>
                      </tr>,
                      rollTargetId === p.id && (
                        <tr key={`${p.id}-roll`} style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                          <td colSpan={13} style={{ padding: "12px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                              <div>
                                <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>New Strike</div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <button onClick={() => setRollStrikeOffsetPct(v => v - 5)} style={{
                                    background: "var(--bg-overlay)", border: "1px solid var(--border-default)",
                                    color: "var(--text-mid)", padding: "3px 8px", cursor: "pointer",
                                  }}>−5%</button>
                                  <span className="num" style={{ fontSize: 12, color: "var(--text-hi)", minWidth: 70, textAlign: "center" }}>
                                    {fmtK(p.strike * (1 + rollStrikeOffsetPct / 100))}
                                  </span>
                                  <button onClick={() => setRollStrikeOffsetPct(v => v + 5)} style={{
                                    background: "var(--bg-overlay)", border: "1px solid var(--border-default)",
                                    color: "var(--text-mid)", padding: "3px 8px", cursor: "pointer",
                                  }}>+5%</button>
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>New Expiry</div>
                                <div style={{ display: "flex", gap: 2 }}>
                                  {EXPIRIES.map(e => (
                                    <button key={e.label} onClick={() => setRollExpiry(e)} style={{
                                      padding: "3px 7px", border: "none", cursor: "pointer", fontSize: 11,
                                      background: rollExpiry.label === e.label ? "var(--atm-dim)" : "transparent",
                                      color: rollExpiry.label === e.label ? "var(--atm)" : "var(--text-lo)",
                                    }}>{e.label}</button>
                                  ))}
                                </div>
                              </div>
                              {rollPreview && (
                                <>
                                  <div>
                                    <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>New Premium</div>
                                    <span className="num" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)" }}>
                                      ${fmtN(rollPreview.newPremium, 2)}
                                    </span>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>
                                      {rollPreview.netCashEffect >= 0 ? "Net Credit" : "Net Cost"}
                                    </div>
                                    <span className="num" style={{
                                      fontSize: 13, fontWeight: 600,
                                      color: rollPreview.netCashEffect >= 0 ? "var(--call)" : "var(--put)",
                                    }}>
                                      ${fmtN(Math.abs(rollPreview.netCashEffect), 2)}
                                    </span>
                                  </div>
                                </>
                              )}
                              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                                {rollInsufficientFunds && (
                                  <span style={{ fontSize: 11, color: "var(--put)" }}>Insufficient balance for the new leg</span>
                                )}
                                <button onClick={() => setRollTargetId(null)} style={{
                                  fontSize: 11, color: "var(--text-lo)", background: "none",
                                  border: "1px solid var(--border-default)", padding: "5px 12px", cursor: "pointer",
                                }}>Cancel</button>
                                <button onClick={executeRoll} disabled={!!rollInsufficientFunds || rolling} style={{
                                  fontSize: 11, color: "var(--bg)", background: "var(--brand)", border: "none",
                                  padding: "5px 12px", cursor: rollInsufficientFunds || rolling ? "default" : "pointer",
                                  opacity: rollInsufficientFunds || rolling ? 0.5 : 1,
                                }}>{rolling ? "Rolling…" : "Confirm Roll"}</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {partialTarget && partialPreview && (
        <ConfirmDialog
          title={`Close ${partialTarget.underlying} ${partialTarget.option_type.toUpperCase()}`}
          confirmLabel={closing ? "Closing…" : partialPreview.closedQty >= partialTarget.contracts - CONTRACT_STEP / 2 ? "Confirm full close" : `Close ${partialPreview.closedQty} contracts`}
          onConfirm={execPartial}
          onCancel={() => setPartialTarget(null)}
          disabled={closing || notSignedIn}
        >
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>Quantity (of {partialTarget.contracts})</div>
            <input
              type="number"
              min={CONTRACT_STEP}
              max={partialTarget.contracts}
              step={CONTRACT_STEP}
              value={partialQty}
              onChange={e => setPartialQty(e.target.value)}
              onBlur={() => setPartialQty(String(clampCloseQty(parseFloat(partialQty) || 0, partialTarget.contracts)))}
              style={{
                width: "100%", padding: "8px 10px", background: "var(--bg-overlay)",
                border: "1px solid var(--border-default)", color: "var(--text-hi)", fontFamily: "var(--font-mono)",
              }}
            />
            {!features.partialClose && partialPreview.closedQty < partialTarget.contracts - CONTRACT_STEP / 2 && (
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--atm)", padding: "8px", background: "var(--atm-dim)", border: "1px solid var(--atm)" }}>
                Backend partial close not detected. Closing a partial qty will be rejected until the API supports it — use full quantity or wait for feature support.
              </div>
            )}
          </div>
          {[
            ["Closed qty", String(partialPreview.closedQty)],
            ["Remaining", String(partialPreview.remaining)],
            ["Entry (portion)", `$${fmtN(partialPreview.entryTotal, 2)}`],
            ["Mark (portion)", `$${fmtN(partialPreview.exitTotal, 2)}`],
            ["Est. realized P&L", `${partialPreview.realizedPnl >= 0 ? "+" : "−"}$${fmtN(Math.abs(partialPreview.realizedPnl), 2)}`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
              <span style={{ color: "var(--text-lo)" }}>{k}</span>
              <span className="num" style={{ color: k.includes("P&L") ? (partialPreview.realizedPnl >= 0 ? "var(--call)" : "var(--put)") : "var(--text-hi)" }}>{v}</span>
            </div>
          ))}
        </ConfirmDialog>
      )}

      {batchConfirm && (
        <ConfirmDialog
          title={`Close ${batchPreview.count} position${batchPreview.count === 1 ? "" : "s"}`}
          confirmLabel={closing ? "Closing…" : "Confirm batch close"}
          onConfirm={execBatch}
          onCancel={() => { setBatchConfirm(false); setBatchProgress(null); }}
          disabled={closing || selectedMarked.length === 0}
        >
          <div style={{
            marginBottom: 10, padding: 8, fontSize: 11, color: "var(--atm)",
            background: "var(--atm-dim)", border: "1px solid var(--atm)",
          }}>
            Sequential fallback — not atomic. Legs can leave residual risk if a later close fails.
          </div>
          <label style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--text-mid)", marginBottom: 10 }}>
            On failure:
            <select value={batchMode} onChange={e => setBatchMode(e.target.value as CloseMode)} style={{
              background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11,
            }}>
              <option value="continue">Continue remaining</option>
              <option value="stop">Stop on first failure</option>
            </select>
          </label>
          {[
            ["Positions", String(batchPreview.count)],
            ["Total mark premium", `$${fmtN(batchPreview.totalPremium, 2)}`],
            ["Est. realized P&L", `${batchPreview.realizedPnl >= 0 ? "+" : "−"}$${fmtN(Math.abs(batchPreview.realizedPnl), 2)}`],
            ["Collateral released", `$${fmtN(batchPreview.collateralReleased, 2)}`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
              <span style={{ color: "var(--text-lo)" }}>{k}</span>
              <span className="num" style={{ color: "var(--text-hi)" }}>{v}</span>
            </div>
          ))}
          {batchProgress && (
            <div style={{ marginTop: 10, maxHeight: 120, overflowY: "auto" }}>
              {batchProgress.map(item => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
                  <span style={{ color: "var(--text-mid)" }}>{item.label}</span>
                  <span style={{
                    color: item.status === "ok" ? "var(--call)" : item.status === "failed" ? "var(--put)" : "var(--text-lo)",
                  }}>{item.status}{item.error ? `: ${item.error}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </ConfirmDialog>
      )}

      {strategyToClose && (
        <ConfirmDialog
          title={`Close strategy (${strategyToClose.legs.length} legs)`}
          confirmLabel={closing ? "Closing…" : features.strategyClose ? "Confirm atomic close" : "Confirm sequential close"}
          onConfirm={() => execStrategyClose(strategyToClose.id)}
          onCancel={() => { setStrategyConfirm(null); setBatchProgress(null); }}
          disabled={closing}
        >
          {!features.strategyClose && (
            <div style={{
              marginBottom: 10, padding: 8, fontSize: 11, fontWeight: 600, color: "var(--put)",
              background: "var(--put-dim)", border: "1px solid var(--put)",
            }}>
              Atomic strategy close not available — falling back to sequential per-leg closes. Residual leg risk if a close fails mid-batch.
            </div>
          )}
          <label style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--text-mid)", marginBottom: 10 }}>
            On failure:
            <select value={batchMode} onChange={e => setBatchMode(e.target.value as CloseMode)} style={{
              background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11,
            }}>
              <option value="stop">Stop on first failure</option>
              <option value="continue">Continue remaining</option>
            </select>
          </label>
          {[
            ["Legs", String(strategyToClose.legs.length)],
            ["Total mark premium", `$${fmtN(strategyToClose.totalPremium, 2)}`],
            ["Est. realized P&L", `${strategyToClose.totalPnl >= 0 ? "+" : "−"}$${fmtN(Math.abs(strategyToClose.totalPnl), 2)}`],
            ["Collateral released", `$${fmtN(strategyToClose.totalCollateral, 2)}`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
              <span style={{ color: "var(--text-lo)" }}>{k}</span>
              <span className="num" style={{ color: "var(--text-hi)" }}>{v}</span>
            </div>
          ))}
          {batchProgress && (
            <div style={{ marginTop: 10 }}>
              {batchProgress.map(item => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
                  <span style={{ color: "var(--text-mid)" }}>{item.label}</span>
                  <span style={{ color: item.status === "ok" ? "var(--call)" : item.status === "failed" ? "var(--put)" : "var(--text-lo)" }}>
                    {item.status}{item.error ? `: ${item.error}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
