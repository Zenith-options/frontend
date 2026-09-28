"use client";

import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { useBackendData } from "../../lib/context/BackendDataContext";
import { useSpotFeedContext } from "../../lib/context/SpotFeedContext";
import { useEnvironment } from "../../lib/context/EnvironmentContext";
import { ApiError } from "../../lib/api/client";
import type { Position } from "../../lib/api/types";
import { MARKETS, EXPIRIES, bs, smileVol, fmtN, fmtK, type Expiry } from "../../lib/pricing";
import { collateralRequired } from "../../lib/collateral";
import { toCsv, downloadCsv } from "../../lib/csv";
import { ExportButton } from "../../components/ExportButton";
import { PortfolioRiskPanel } from "../../components/PortfolioRiskPanel";
import { ExpandableCard } from "../../components/ExpandableCard";
import { AuthGate, DataBoundary, EmptyState, Skeleton, SkeletonRows } from "../../components/states";
import { Term } from "../../features/onboarding/Term";
import type { GlossaryId } from "../../features/onboarding/i18n";

interface Marked extends Position {
  spot: number;
  currentPremium: number;
  pnl: number;
  pnlPct: number;
  liveDelta: number;
  liveGamma: number;
  liveTheta: number;
  liveVega: number;
}

const fmtPnl = (v: number) => `${v >= 0 ? "+" : "−"}$${fmtN(Math.abs(v), 2)}`;
const fmtStrike = (k: number) => (k >= 1000 ? k.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : k.toFixed(4));
const smallBtn = { fontSize: 10, color: "var(--text-lo)", background: "none", border: "1px solid var(--border-default)", padding: "2px 8px", cursor: "pointer" } as const;

function Badge({ tone, children }: { tone: "call" | "put"; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 6px", textTransform: "uppercase",
      background: tone === "call" ? "var(--call-dim)" : "var(--put-dim)", color: tone === "call" ? "var(--call)" : "var(--put)",
    }}>{children}</span>
  );
}

export default function PortfolioPage() {
  const { authStatus, accountQuery, positionsQuery, account, positions: backendPositions, greeks: netGreeks, close, roll } = useBackendData();
  const { network, tradingBlocked, tradingBlockReason } = useEnvironment();
  const balance = account?.balance ?? null;
  const actionsDisabled = authStatus !== "signed-in" || tradingBlocked;
  const [actionError, setActionError] = useState<string|null>(null);

  // Live from the shared WebSocket feed (SpotFeedProvider) — one
  // connection covers every underlying, so marking every open position
  // to market doesn't need its own per-symbol subscription or poll.
  const { data: spotFeed } = useSpotFeedContext();
  const spots = useMemo(() => spotFeed?.prices ?? Object.fromEntries(MARKETS.map(m => [m.sym, m.price])), [spotFeed]);
  const vols = useMemo(() => spotFeed?.vols ?? Object.fromEntries(MARKETS.map(m => [m.sym, m.vol])), [spotFeed]);

  // Reprices with the same static expiry_days-as-t the backend itself
  // uses for closing/rolling (see the note in backend/README.md) — this
  // way the preview shown here matches what a close/roll will actually
  // produce, rather than decaying against a real elapsed-time clock the
  // backend doesn't track.
  const marked = useMemo<Marked[]>(() => backendPositions.map(p => {
    const spot = spots[p.underlying] ?? MARKETS.find(m => m.sym === p.underlying)?.price ?? 0;
    const baseVol = vols[p.underlying] ?? MARKETS.find(m => m.sym === p.underlying)?.vol ?? 0.5;
    const t = p.expiry_days / 365;
    const vol = smileVol(baseVol, p.strike / spot);
    const g = bs(spot, p.strike, vol, t, p.option_type === "call");
    const entryTotal = p.entry_premium * p.contracts;
    const currentPremium = g.premium * p.contracts;
    // Long: profit when current value rises above what was paid.
    // Short: profit when it costs less than the premium collected to close it out.
    const pnl = p.position_type === "short" ? entryTotal - currentPremium : currentPremium - entryTotal;
    return {
      ...p, spot, currentPremium, pnl,
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
    }));
  }, [marked]);

  const soloPositions = useMemo(() => marked.filter(p => !p.strategy_id), [marked]);

  // Realize the position's P&L into the account balance and release any
  // collateral, then remove it. This is the one place a position actually
  // settles — the quick view on the chain page just links here.
  const handleClose = async (p: Marked) => {
    setActionError(null);
    try {
      await close(p.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to close position");
    }
  };

  const handleCloseStrategy = async (legs: Marked[]) => {
    setActionError(null);
    try {
      for (const leg of legs) await close(leg.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to close strategy");
    }
  };

  const [rollTargetId, setRollTargetId] = useState<string|null>(null);
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

    // Same cash math as handleClose (old leg) + open (new leg), just summed
    // into one net figure instead of applied as two separate trades. This
    // is a client-side estimate only — the backend computes the real
    // numbers atomically when Confirm Roll is actually clicked.
    const closeCashEffect = rollTarget.position_type === "short"
      ? rollTarget.collateral - rollTarget.currentPremium
      : rollTarget.currentPremium;
    const openCashEffect = rollTarget.position_type === "short"
      ? newPremium - newCollateral
      : -newPremium;
    const netCashEffect = closeCashEffect + openCashEffect;

    return { spot, newStrike, greeks, newPremium, newCollateral, closeCashEffect, netCashEffect };
  }, [rollTarget, rollStrikeOffsetPct, rollExpiry, spots, vols]);

  // After releasing the old leg's collateral and settling its P&L, does the
  // resulting balance actually cover what opening the new leg needs? Just a
  // preview check — the backend is the final authority when Confirm Roll runs.
  // Unknown balance (still loading) counts as "can't tell yet", not "enough".
  const rollInsufficientFunds = rollTarget && rollPreview
    ? balance === null || balance + rollPreview.closeCashEffect < (rollTarget.position_type === "short" ? rollPreview.newCollateral : rollPreview.newPremium)
    : false;

  const [rolling, setRolling] = useState(false);
  const executeRoll = async () => {
    if (!rollTarget || !rollPreview || rollInsufficientFunds || rolling || actionsDisabled) return;
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

  const rollEditor = (p: Marked) => (
    <RollEditor
      position={p} offsetPct={rollStrikeOffsetPct} onOffset={setRollStrikeOffsetPct}
      expiry={rollExpiry} onExpiry={setRollExpiry} preview={rollPreview}
      insufficient={!!rollInsufficientFunds} rolling={rolling} disabled={actionsDisabled}
      onCancel={() => setRollTargetId(null)} onConfirm={executeRoll}
    />
  );
  const rowActions = (p: Marked) => (
    <>
      <button type="button" className="tap" onClick={() => setRollTargetId(rollTargetId === p.id ? null : p.id)} disabled={actionsDisabled}
        aria-expanded={rollTargetId === p.id}
        style={{ ...smallBtn, color: rollTargetId === p.id ? "var(--brand)" : "var(--text-lo)", marginRight: 6, opacity: actionsDisabled ? 0.5 : 1, cursor: actionsDisabled ? "default" : "pointer" }}>
        Roll
      </button>
      <button type="button" className="tap" onClick={() => handleClose(p)} disabled={actionsDisabled}
        style={{ ...smallBtn, opacity: actionsDisabled ? 0.5 : 1, cursor: actionsDisabled ? "default" : "pointer" }}>
        {p.position_type === "short" ? "Buy to close" : "Sell to close"}
      </button>
    </>
  );

  const positionsLoaded = positionsQuery.data !== undefined;
  const subtitle =
    authStatus === "signed-out" ? "Connect your wallet to see your positions."
    : !positionsLoaded ? (positionsQuery.status === "error" ? "Positions couldn't be loaded." : "Loading your positions…")
    : `${backendPositions.length} open position${backendPositions.length === 1 ? "" : "s"} · live premium repriced off current spot`;

  // Summary bar: skeletons while loading (never "$0.00"), "Unavailable" on error.
  const accountValue = (render: (a: NonNullable<typeof account>) => string) =>
    account ? render(account)
      : accountQuery.status === "error" ? <span style={{ fontSize: 12, color: "var(--put)" }}>Unavailable</span>
      : <Skeleton width={90} height={17} />;
  const positionsValue = (value: string) =>
    positionsLoaded ? value
      : positionsQuery.status === "error" ? <span style={{ fontSize: 12, color: "var(--put)" }}>Unavailable</span>
      : <Skeleton width={70} height={17} />;

  const stats: { label: React.ReactNode; value: React.ReactNode; color: string }[] = [
    { label: "Available Balance", value: accountValue(a => `$${fmtN(a.balance, 2)}`), color: "var(--text-hi)" },
    { label: <Term id="collateral">Collateral Locked</Term>, value: accountValue(a => `$${fmtN(a.collateral_locked, 2)}`), color: "var(--atm)" },
    { label: <Term id="pnl">Unrealized P&amp;L</Term>, value: positionsValue(fmtPnl(totalPnl)), color: totalPnl >= 0 ? "var(--call)" : "var(--put)" },
    { label: <Term id="delta">Net Delta</Term>, value: positionsValue(`${netGreeks.delta >= 0 ? "+" : "−"}${Math.abs(netGreeks.delta).toFixed(3)}`), color: "var(--text-hi)" },
    { label: <Term id="theta">Net Theta</Term>, value: positionsValue(`${netGreeks.theta >= 0 ? "+" : "−"}${Math.abs(netGreeks.theta).toFixed(4)}`), color: "var(--put)" },
    { label: <Term id="vega">Net Vega</Term>, value: positionsValue(`${netGreeks.vega >= 0 ? "+" : "−"}${Math.abs(netGreeks.vega).toFixed(3)}`), color: "var(--atm)" },
  ];

  const HEAD: { label: string; term?: GlossaryId }[] = [
    { label: "Asset" }, { label: "Type" }, { label: "Side" }, { label: "Strike", term: "strike" }, { label: "Expiry", term: "expiry" },
    { label: "Qty" }, { label: "Collateral", term: "collateral" }, { label: "Entry", term: "premium" }, { label: "Current" },
    { label: "P&L", term: "pnl" }, { label: "Δ", term: "delta" }, { label: "" },
  ];

  return (
    <div className="app-shell">
      <AppHeader>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: network.color }} />
          <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Marked to market · {network.label}</span>
          <div className="app-header-sep" style={{ height: 16, margin: "0 8px" }} />
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="page-pad" style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 64px" }}>
          <div className="page-title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Portfolio</h1>
              <p style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 28 }}>{subtitle}</p>
            </div>
            {marked.length > 0 && (
              <ExportButton onClick={() => downloadCsv(
                `zenith-${network.mode}-positions-${new Date().toISOString().slice(0, 10)}.csv`,
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

          {authStatus === "signed-out" ? (
            <AuthGate
              title="Connect your wallet to see your portfolio"
              description={`Positions, balances and risk for ${network.label} are tied to your wallet's session.`}
            />
          ) : (
            <>
              <div className="stat-bar" style={{ marginBottom: 32 }} data-testid="portfolio-summary">
                {stats.map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 6 }}>{s.label}</div>
                    <div className="num" style={{ fontSize: 17, fontWeight: 600, color: s.color, minHeight: 22, display: "flex", alignItems: "center" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {tradingBlocked && (
                <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
                  {tradingBlockReason}
                </div>
              )}
              {actionError && (
                <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
                  {actionError}
                </div>
              )}

              <PortfolioRiskPanel query={positionsQuery} auth={authStatus} spots={spots} />

              <DataBoundary
                query={positionsQuery}
                auth={authStatus}
                errorTitle="Couldn't load positions"
                skeleton={<div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
                  <SkeletonRows rows={5} rowHeight={41} columns={8} label="Loading positions" testId="portfolio-skeleton" />
                </div>}
                isEmpty={d => d.positions.length === 0}
                empty={<EmptyState title="No open positions" description="Positions you open from the chain are marked to market here." action={{ label: "Open the options chain →", href: "/options" }} testId="portfolio-empty" />}
              >
                {() => (
                  <>
                    {strategyGroups.length > 0 && (
                      <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 8 }}>
                        {strategyGroups.map(g => (
                          <div key={g.id} style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "12px 16px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{g.sym} Strategy · {g.legs.length} legs</div>
                              <button type="button" className="tap" onClick={() => handleCloseStrategy(g.legs)} disabled={actionsDisabled}
                                style={{ ...smallBtn, opacity: actionsDisabled ? 0.5 : 1 }}>Close all legs</button>
                            </div>
                            {g.legs.map(leg => (
                              <div key={leg.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11, gap: 8 }}>
                                <span style={{ color: leg.position_type === "short" ? "var(--put)" : "var(--call)", textTransform: "uppercase" }}>
                                  {leg.position_type} {leg.option_type}
                                </span>
                                <span className="num" style={{ color: "var(--text-mid)" }}>K={leg.strike.toFixed(4)}</span>
                                <span className="num" style={{ color: leg.pnl >= 0 ? "var(--call)" : "var(--put)" }}>{fmtPnl(leg.pnl)}</span>
                              </div>
                            ))}
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-subtle)", gap: 8 }}>
                              <span style={{ fontSize: 11, color: "var(--text-lo)" }}>
                                {g.totalCollateral > 0 ? `Collateral: $${fmtN(g.totalCollateral, 2)}` : ""}
                              </span>
                              <span className="num" style={{ fontSize: 12, fontWeight: 600, color: g.totalPnl >= 0 ? "var(--call)" : "var(--put)" }}>
                                Combined: {fmtPnl(g.totalPnl)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {soloPositions.length > 0 && (
                      <div className="responsive-list" data-testid="portfolio-positions">
                        <div className="rl-table" style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                                {HEAD.map((h, i) => (
                                  <th key={i} style={{ padding: "8px 10px", fontSize: 10, fontWeight: 500, textTransform: "uppercase",
                                    letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "right", background: "var(--bg-overlay)" }}>
                                    {h.term ? <Term id={h.term}>{h.label}</Term> : h.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {soloPositions.map(p => {
                                const sign = p.position_type === "short" ? -1 : 1;
                                return [
                                  <tr key={p.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                                    <td style={{ padding: "10px", fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{p.underlying}</td>
                                    <td style={{ padding: "10px 4px" }}><Badge tone={p.position_type === "short" ? "put" : "call"}>{p.position_type}</Badge></td>
                                    <td style={{ padding: "10px 4px" }}><Badge tone={p.option_type}>{p.option_type}</Badge></td>
                                    <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>{fmtStrike(p.strike)}</td>
                                    <td style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{p.expiry_days}D</td>
                                    <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>{p.contracts}</td>
                                    <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{p.collateral > 0 ? `$${fmtN(p.collateral, 2)}` : "—"}</td>
                                    <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>
                                      {p.position_type === "short" ? "+" : ""}${fmtN(p.entry_premium * p.contracts, 2)}
                                    </td>
                                    <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>${fmtN(p.currentPremium, 2)}</td>
                                    <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", fontWeight: 600, color: p.pnl >= 0 ? "var(--call)" : "var(--put)" }}>
                                      {fmtPnl(p.pnl)} <span style={{ opacity: 0.6 }}>({p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(1)}%)</span>
                                    </td>
                                    <td className="num" style={{ padding: "10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{(sign * p.liveDelta * p.contracts).toFixed(3)}</td>
                                    <td style={{ padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" }}>{rowActions(p)}</td>
                                  </tr>,
                                  rollTargetId === p.id && (
                                    <tr key={`${p.id}-roll`} style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                                      <td colSpan={12} style={{ padding: "12px 16px" }}>{rollEditor(p)}</td>
                                    </tr>
                                  ),
                                ];
                              })}
                            </tbody>
                          </table>
                        </div>

                        <div className="rl-cards">
                          {soloPositions.map(p => {
                            const sign = p.position_type === "short" ? -1 : 1;
                            return (
                              <ExpandableCard
                                key={p.id}
                                testId="portfolio-card"
                                title={<>{p.underlying} <Badge tone={p.position_type === "short" ? "put" : "call"}>{p.position_type}</Badge> <Badge tone={p.option_type}>{p.option_type}</Badge></>}
                                meta={<span className="num">K={fmtK(p.strike)} · {p.expiry_days}D · {p.contracts} contracts</span>}
                                trailing={<span className="num" style={{ fontSize: 13, fontWeight: 600, color: p.pnl >= 0 ? "var(--call)" : "var(--put)" }}>{fmtPnl(p.pnl)}</span>}
                                fields={[
                                  { label: "Entry", value: `${p.position_type === "short" ? "+" : ""}$${fmtN(p.entry_premium * p.contracts, 2)}` },
                                  { label: "Current", value: `$${fmtN(p.currentPremium, 2)}` },
                                  { label: <Term id="pnl">P&amp;L</Term>, value: `${fmtPnl(p.pnl)} (${p.pnlPct >= 0 ? "+" : ""}${p.pnlPct.toFixed(1)}%)` },
                                  { label: <Term id="collateral">Collateral</Term>, value: p.collateral > 0 ? `$${fmtN(p.collateral, 2)}` : "—" },
                                  { label: <Term id="delta">Δ</Term>, value: (sign * p.liveDelta * p.contracts).toFixed(3) },
                                  { label: <Term id="theta">Θ</Term>, value: (sign * p.liveTheta * p.contracts).toFixed(4) },
                                ]}
                                actions={rowActions(p)}
                              >
                                {rollTargetId === p.id && <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>{rollEditor(p)}</div>}
                              </ExpandableCard>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </DataBoundary>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RollEditor({ position: p, offsetPct, onOffset, expiry, onExpiry, preview, insufficient, rolling, disabled, onCancel, onConfirm }: {
  position: Marked;
  offsetPct: number;
  onOffset: (fn: (v: number) => number) => void;
  expiry: Expiry;
  onExpiry: (e: Expiry) => void;
  preview: { newPremium: number; netCashEffect: number } | null;
  insufficient: boolean;
  rolling: boolean;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const stepBtn = { background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-mid)", padding: "3px 8px", cursor: "pointer" } as const;
  const blocked = insufficient || rolling || disabled;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }} data-testid="roll-editor">
      <div>
        <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>New Strike</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" className="tap" onClick={() => onOffset(v => v - 5)} style={stepBtn} aria-label="Lower strike 5%">−5%</button>
          <span className="num" style={{ fontSize: 12, color: "var(--text-hi)", minWidth: 70, textAlign: "center" }}>
            {fmtK(p.strike * (1 + offsetPct / 100))}
          </span>
          <button type="button" className="tap" onClick={() => onOffset(v => v + 5)} style={stepBtn} aria-label="Raise strike 5%">+5%</button>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>New Expiry</div>
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {EXPIRIES.map(e => (
            <button key={e.label} type="button" className="tap" aria-pressed={expiry.label === e.label} onClick={() => onExpiry(e)} style={{
              padding: "3px 7px", border: "none", cursor: "pointer", fontSize: 11,
              background: expiry.label === e.label ? "var(--atm-dim)" : "transparent",
              color: expiry.label === e.label ? "var(--atm)" : "var(--text-lo)",
            }}>{e.label}</button>
          ))}
        </div>
      </div>
      {preview && (
        <>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>New Premium</div>
            <span className="num" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)" }}>${fmtN(preview.newPremium, 2)}</span>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>{preview.netCashEffect >= 0 ? "Net Credit" : "Net Cost"}</div>
            <span className="num" style={{ fontSize: 13, fontWeight: 600, color: preview.netCashEffect >= 0 ? "var(--call)" : "var(--put)" }}>
              ${fmtN(Math.abs(preview.netCashEffect), 2)}
            </span>
          </div>
        </>
      )}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {insufficient && <span style={{ fontSize: 11, color: "var(--put)" }}>Insufficient balance for the new leg</span>}
        <button type="button" className="tap" onClick={onCancel} style={{
          fontSize: 11, color: "var(--text-lo)", background: "none", border: "1px solid var(--border-default)", padding: "5px 12px", cursor: "pointer",
        }}>Cancel</button>
        <button type="button" className="tap" onClick={onConfirm} disabled={blocked} style={{
          fontSize: 11, color: "var(--bg)", background: "var(--brand)", border: "none",
          padding: "5px 12px", cursor: blocked ? "default" : "pointer", opacity: blocked ? 0.5 : 1,
        }}>{rolling ? "Rolling…" : "Confirm Roll"}</button>
      </div>
    </div>
  );
}
