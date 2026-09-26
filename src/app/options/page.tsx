"use client";

import { useState, useEffect, useMemo, useRef, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PayoffDiagram } from "../../components/PayoffDiagram";
import { VolSmile } from "../../components/VolSmile";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { MARKETS, EXPIRIES, bs, smileVol, fmtN, fmtSpot, fmtK, type Greeks } from "../../lib/pricing";
import { getChain, getExpiryCalendar } from "../../lib/api/market";
import { ApiError } from "../../lib/api/client";
import { useBackendData } from "../../lib/context/BackendDataContext";
import { useSpotFeedContext } from "../../lib/context/SpotFeedContext";
import { useWalletStore } from "../../lib/store/wallet";
import { collateralRequired } from "../../lib/collateral";
import { AlertsPanel } from "../../components/AlertsPanel";
import { StarButton } from "../../components/StarButton";
import { SpotPriceChart } from "../../components/SpotPriceChart";
import { usePriceHistory } from "../../lib/usePriceHistory";
import { useHydrated } from "../../lib/useHydrated";
import { StrategyPicker } from "../../components/StrategyPicker";
import { MultiLegPayoffDiagram } from "../../components/MultiLegPayoffDiagram";
import { VolSurfaceHeatmap } from "../../components/VolSurfaceHeatmap";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { type StrategyTemplate } from "../../lib/strategies";
import { netPremium, type PricedLeg } from "../../lib/payoff";
import { AdvancedChain } from "../../features/chain/AdvancedChain";
import { WorkspaceGrid } from "../../features/workspace/WorkspaceGrid";
import type { PanelId } from "../../features/workspace/layouts";
import { findAtmIndex } from "../../features/chain/chainUtils";

interface ChainRow { strike: number; call: Greeks; put: Greeks; itmCall: boolean; itmPut: boolean; }
interface TradeState { row: ChainRow; side: "call" | "put"; mode: "buy" | "write"; }

export default function OptionsPage() {
  return (
    <Suspense fallback={null}>
      <OptionsPageContent />
    </Suspense>
  );
}

function OptionsPageContent() {
  const params = useSearchParams();
  const [sym, setSym] = useState(params.get("u") ?? "XLM");
  const [expiry, setExpiry] = useState(EXPIRIES[2]);
  const [compareExpiry, setCompareExpiry] = useState(EXPIRIES[1]);
  const { data: spotData } = useSpotFeedContext();
  const [trade, setTrade] = useState<TradeState | null>(null);
  const [showTradeConfirm, setShowTradeConfirm] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useHydrated();
  const token = useWalletStore(s => s.token);
  const address = useWalletStore(s => s.address);
  const {
    account, positions: backendPositions, greeks: portGreeks, watchlist,
    open: openBackendPosition, openStrategy: openBackendStrategy,
  } = useBackendData();
  const favorites = useMemo(() => watchlist.map(w => w.underlying), [watchlist]);
  const balance = account?.balance ?? 0;
  const market = MARKETS.find(m => m.sym === sym) ?? MARKETS[0];
  const spot = spotData?.prices[sym] ?? market.price;
  const vol = spotData?.vols[sym] ?? market.vol;
  const priceHistory = usePriceHistory(sym, spot);
  const [contracts, setContracts] = useState("1");
  const [viewTab, setViewTab] = useState<"chain" | "positions" | "strategies" | "surface">("chain");
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyTemplate | null>(null);
  const [showStrategyConfirm, setShowStrategyConfirm] = useState(false);
  const [focusedStrike, setFocusedStrike] = useState<number | null>(null);
  const [jumpToken, setJumpToken] = useState(0);
  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [viewportW, setViewportW] = useState(1200);
  const prevSpotRef = useRef(spot);

  const t = expiry.days / 365;

  useEffect(() => { prevSpotRef.current = spot; }, [spot]);

  useEffect(() => {
    const measure = () => {
      const w = window.innerWidth;
      setViewportW(w);
      setWorkspaceMode(w >= 1024);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const [expiries, setExpiries] = useState(EXPIRIES);
  useEffect(() => {
    let cancelled = false;
    getExpiryCalendar(sym).then(cal => {
      if (cancelled) return;
      setExpiries(cal.expiries.map(e => ({ label: e.label, days: e.days_to_expiry })));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [sym]);

  const sortedMarkets = useMemo(() => {
    if (!hydrated) return MARKETS;
    return [...MARKETS].sort((a, b) => {
      const aFav = favorites.includes(a.sym), bFav = favorites.includes(b.sym);
      return aFav === bFav ? 0 : aFav ? -1 : 1;
    });
  }, [favorites, hydrated]);

  const [chain, setChain] = useState<ChainRow[]>([]);
  const [compareChain, setCompareChain] = useState<ChainRow[]>([]);
  const [chainLoading, setChainLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setChainLoading(true);
    getChain(sym, expiry.days).then(entries => {
      if (cancelled) return;
      setChain(entries.map(e => ({
        strike: e.strike,
        call: { premium: e.call.premium, delta: e.call.delta, gamma: e.call.gamma, theta: e.call.theta, vega: e.call.vega, iv: e.call.iv },
        put: { premium: e.put.premium, delta: e.put.delta, gamma: e.put.gamma, theta: e.put.theta, vega: e.put.vega, iv: e.put.iv },
        itmCall: e.is_itm_call, itmPut: e.is_itm_put,
      })));
    }).catch(() => {
      if (cancelled) return;
      setChain(Array.from({ length: 21 }, (_, i) => {
        const n = i - 10;
        const strike = Math.round(spot * (1 + n * 0.04) * 10000) / 10000;
        const v = smileVol(vol, strike / spot);
        return { strike, call: bs(spot, strike, v, t, true), put: bs(spot, strike, v, t, false), itmCall: spot > strike, itmPut: spot < strike };
      }));
    }).finally(() => { if (!cancelled) setChainLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, expiry.days]);

  useEffect(() => {
    let cancelled = false;
    getChain(sym, compareExpiry.days).then(entries => {
      if (cancelled) return;
      setCompareChain(entries.map(e => ({
        strike: e.strike,
        call: { premium: e.call.premium, delta: e.call.delta, gamma: e.call.gamma, theta: e.call.theta, vega: e.call.vega, iv: e.call.iv },
        put: { premium: e.put.premium, delta: e.put.delta, gamma: e.put.gamma, theta: e.put.theta, vega: e.put.vega, iv: e.put.iv },
        itmCall: e.is_itm_call, itmPut: e.is_itm_put,
      })));
    }).catch(() => {
      if (cancelled) return;
      const ct = compareExpiry.days / 365;
      setCompareChain(Array.from({ length: 21 }, (_, i) => {
        const n = i - 10;
        const strike = Math.round(spot * (1 + n * 0.04) * 10000) / 10000;
        const v = smileVol(vol, strike / spot);
        return { strike, call: bs(spot, strike, v, ct, true), put: bs(spot, strike, v, ct, false), itmCall: spot > strike, itmPut: spot < strike };
      }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, compareExpiry.days]);

  useEffect(() => {
    const id = setInterval(() => {
      getChain(sym, expiry.days).then(entries => {
        setChain(entries.map(e => ({
          strike: e.strike,
          call: { premium: e.call.premium, delta: e.call.delta, gamma: e.call.gamma, theta: e.call.theta, vega: e.call.vega, iv: e.call.iv },
          put: { premium: e.put.premium, delta: e.put.delta, gamma: e.put.gamma, theta: e.put.theta, vega: e.put.vega, iv: e.put.iv },
          itmCall: e.is_itm_call, itmPut: e.is_itm_put,
        })));
      }).catch(() => undefined);
    }, 4000);
    return () => clearInterval(id);
  }, [sym, expiry.days]);

  useEffect(() => {
    setJumpToken(t => t + 1);
    const atm = findAtmIndex(chain);
    if (atm >= 0) setFocusedStrike(chain[atm].strike);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, expiry.days]);

  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent).detail as Record<string, unknown>;
      if (!detail) return;
      if (detail.type === "tab" && typeof detail.tab === "string") {
        setViewTab(detail.tab as typeof viewTab);
        setWorkspaceMode(false);
      }
      if (detail.type === "symbol" && typeof detail.sym === "string") {
        setSym(detail.sym);
        if (typeof detail.expiryDays === "number") {
          const ex = expiries.find(x => x.days === detail.expiryDays) ?? EXPIRIES.find(x => x.days === detail.expiryDays);
          if (ex) setExpiry(ex);
        }
      }
      if (detail.type === "expiry" && typeof detail.dir === "number") {
        const idx = expiries.findIndex(x => x.days === expiry.days);
        const next = expiries[Math.max(0, Math.min(expiries.length - 1, idx + (detail.dir as number)))];
        if (next) setExpiry(next);
      }
      if (detail.type === "jumpAtm") {
        setJumpToken(t => t + 1);
        setViewTab("chain");
      }
      if (detail.type === "trade") {
        const mode = detail.mode === "write" ? "write" : "buy";
        const side = detail.side === "put" ? "put" : detail.side === "call" ? "call" : undefined;
        const row = focusedStrike != null
          ? chain.find(r => r.strike === focusedStrike)
          : chain[findAtmIndex(chain)] ?? chain[Math.floor(chain.length / 2)];
        if (!row) return;
        setTrade({ row, side: side ?? "call", mode });
      }
    };
    window.addEventListener("zenith:options", onCmd);
    return () => window.removeEventListener("zenith:options", onCmd);
  }, [expiries, expiry.days, chain, focusedStrike]);

  const positionLiveGreeks = (pos: { underlying: string; strike: number; expiry_days: number; option_type: "call" | "put" }) => {
    const posSpot = spotData?.prices[pos.underlying] ?? MARKETS.find(m => m.sym === pos.underlying)?.price ?? spot;
    const posVol = spotData?.vols[pos.underlying] ?? MARKETS.find(m => m.sym === pos.underlying)?.vol ?? vol;
    const posT = pos.expiry_days / 365;
    const v = smileVol(posVol, pos.strike / posSpot);
    return bs(posSpot, pos.strike, v, posT, pos.option_type === "call");
  };

  const tradeGreeks = trade ? (trade.side === "call" ? trade.row.call : trade.row.put) : null;
  const qty = Math.max(0.01, parseFloat(contracts) || 1);

  const pricedLegs = useMemo((): PricedLeg[] => {
    if (!selectedStrategy) return [];
    return selectedStrategy.legs.map(leg => {
      const strike = Math.round(spot * leg.strikeOffset * 10000) / 10000;
      const legVol = smileVol(market.vol, leg.strikeOffset);
      const greeks = bs(spot, strike, legVol, t, leg.side === "call");
      return { side: leg.side, action: leg.action, strike, contracts: qty, greeks };
    });
  }, [selectedStrategy, spot, market.vol, t, qty]);

  const strategyNetPremium = useMemo(() => netPremium(pricedLegs), [pricedLegs]);
  const strategyCollateral = useMemo(() => pricedLegs.reduce((sum, leg) =>
    leg.action === "sell" ? sum + collateralRequired(leg.side, leg.contracts, leg.strike, spot) : sum, 0
  ), [pricedLegs, spot]);
  const strategyRequiredFunds = strategyCollateral + Math.max(0, strategyNetPremium);
  const strategyInsufficientFunds = pricedLegs.length > 0 && balance < strategyRequiredFunds;
  const collateral = trade && trade.mode === "write" ? collateralRequired(trade.side, qty, trade.row.strike, spot) : 0;
  const requiredFunds = trade ? (trade.mode === "write" ? collateral : (tradeGreeks?.premium ?? 0) * qty) : 0;
  const insufficientFunds = balance < requiredFunds;
  const notSignedIn = !token;

  const execTrade = async () => {
    if (!trade || !tradeGreeks || insufficientFunds || submitting) return;
    setSubmitting(true);
    setTradeError(null);
    try {
      await openBackendPosition({
        underlying: sym, strike: trade.row.strike, expiryDays: expiry.days,
        optionType: trade.side, positionType: trade.mode === "write" ? "short" : "long", contracts: qty,
      });
      setTrade(null);
      setShowTradeConfirm(false);
      setViewTab("positions");
    } catch (err) {
      setTradeError(err instanceof ApiError ? err.message : "Failed to open position");
    } finally {
      setSubmitting(false);
    }
  };

  const execStrategy = async () => {
    if (!selectedStrategy || pricedLegs.length === 0 || strategyInsufficientFunds || submitting) return;
    setSubmitting(true);
    setTradeError(null);
    try {
      await openBackendStrategy(pricedLegs.map(leg => ({
        underlying: sym, strike: leg.strike, expiryDays: expiry.days,
        optionType: leg.side, positionType: leg.action === "buy" ? "long" : "short", contracts: leg.contracts,
      })));
      setSelectedStrategy(null);
      setShowStrategyConfirm(false);
      setViewTab("positions");
    } catch (err) {
      setTradeError(err instanceof ApiError ? err.message : "Failed to execute strategy");
    } finally {
      setSubmitting(false);
    }
  };

  const priceDir = spot >= prevSpotRef.current;

  const onTradeFromChain = useCallback((row: ChainRow, side: "call" | "put", mode: "buy" | "write") => {
    setFocusedStrike(row.strike);
    setTrade({ row, side, mode });
  }, []);

  const chainPanel = (
    <AdvancedChain
      chain={chain}
      spot={spot}
      loading={chainLoading}
      compareChain={compareChain}
      compareLabel={compareExpiry.label}
      focusedStrike={focusedStrike}
      onFocusStrike={setFocusedStrike}
      onTrade={onTradeFromChain}
      jumpToken={jumpToken}
    />
  );

  const ticketPanel = trade && tradeGreeks ? (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-hi)", marginBottom: 8 }}>
        {trade.mode === "write" ? "WRITE" : "BUY"} {trade.side.toUpperCase()} @ {fmtK(trade.row.strike)}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 8 }}>
        Premium ${fmtN(tradeGreeks.premium)} · IV {(tradeGreeks.iv * 100).toFixed(1)}%
      </div>
      <button
        onClick={() => { setTradeError(null); setShowTradeConfirm(true); }}
        disabled={insufficientFunds || notSignedIn}
        style={{
          width: "100%", padding: "10px", border: "none",
          cursor: insufficientFunds || notSignedIn ? "default" : "pointer",
          background: trade.side === "call" ? "var(--call)" : "var(--put)", color: "var(--bg)", fontWeight: 700,
          opacity: insufficientFunds || notSignedIn ? 0.5 : 1,
        }}
      >Review order</button>
    </div>
  ) : (
    <div style={{ padding: 16, fontSize: 12, color: "var(--text-lo)" }}>Click a bid/ask or press B/S on a focused strike</div>
  );

  const renderPanel = (id: PanelId) => {
    switch (id) {
      case "chain": return chainPanel;
      case "ticket": return ticketPanel;
      case "payoff": return trade && tradeGreeks ? (
        <div style={{ padding: 8 }}>
          <PayoffDiagram spot={spot} strike={trade.row.strike} premium={tradeGreeks.premium} isCall={trade.side === "call"} short={trade.mode === "write"} contracts={qty} width={280} height={140} />
        </div>
      ) : <div style={{ padding: 12, fontSize: 11, color: "var(--text-lo)" }}>Open a ticket to see payoff</div>;
      case "spotChart": return <div style={{ padding: 8 }}><SpotPriceChart history={priceHistory} width={Math.max(200, viewportW / 4)} height={120} /></div>;
      case "volSmile": return <div style={{ padding: 8 }}><VolSmile baseVol={vol} width={Math.max(200, viewportW / 4)} height={120} /></div>;
      case "alerts": return <div style={{ padding: 8 }}><AlertsPanel sym={sym} spot={spot} /></div>;
      case "surface": return <div style={{ padding: 8 }}><VolSurfaceHeatmap baseVol={vol} selectedExpiryDays={expiry.days} /></div>;
      case "strategies": return (
        <div style={{ padding: 8 }}>
          <StrategyPicker selectedId={selectedStrategy?.id ?? null} onSelect={setSelectedStrategy} />
        </div>
      );
      case "positions": return (
        <div style={{ padding: 8, fontSize: 11 }}>
          {backendPositions.length === 0 ? "No open positions" : backendPositions.slice(0, 12).map(p => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ color: "var(--text-hi)" }}>{p.underlying} {p.option_type}</span>
              <span className="num" style={{ color: "var(--text-mid)" }}>{fmtK(p.strike)} ×{p.contracts}</span>
            </div>
          ))}
        </div>
      );
      default: return null;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
      <AppHeader>
        <div style={{ display: "flex", gap: 1 }}>
          {sortedMarkets.map(m => (
            <div key={m.sym} style={{
              display: "flex", alignItems: "center",
              background: sym === m.sym ? "var(--bg-overlay)" : "transparent",
              borderBottom: sym === m.sym ? "2px solid var(--brand)" : "2px solid transparent",
            }}>
              <button onClick={() => setSym(m.sym)} style={{
                padding: "4px 4px 4px 10px", border: "none", background: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600, color: sym === m.sym ? "var(--text-hi)" : "var(--text-mid)",
              }}>{m.sym}</button>
              <StarButton sym={m.sym} />
            </div>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: "var(--border-default)" }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="num" style={{ fontSize: 16, fontWeight: 600, color: "var(--text-hi)" }}>{fmtSpot(spot)}</span>
          <span className="num" style={{ fontSize: 12, color: priceDir ? "var(--call)" : "var(--put)" }}>
            {priceDir ? "+" : "\u2212"}{Math.abs((spot / market.price - 1) * 100).toFixed(2)}%
          </span>
          <span style={{ fontSize: 11, color: "var(--text-lo)" }}>IV {Math.round(vol * 100)}%</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          {expiries.map(e => (
            <button key={e.label} onClick={() => setExpiry(e)} style={{
              padding: "3px 7px", border: "none", cursor: "pointer", fontSize: 11,
              background: expiry.label === e.label ? "var(--atm-dim)" : "transparent",
              color: expiry.label === e.label ? "var(--atm)" : "var(--text-lo)",
            }}>{e.label}</button>
          ))}
          <select
            aria-label="Compare expiry"
            value={compareExpiry.label}
            onChange={e => {
              const ex = expiries.find(x => x.label === e.target.value) ?? EXPIRIES.find(x => x.label === e.target.value);
              if (ex) setCompareExpiry(ex);
            }}
            style={{ marginLeft: 6, fontSize: 10, background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-lo)" }}
          >
            {expiries.map(e => <option key={e.label} value={e.label}>vs {e.label}</option>)}
          </select>
          {viewportW >= 1024 && (
            <button onClick={() => setWorkspaceMode(v => !v)} style={{
              marginLeft: 8, padding: "3px 8px", fontSize: 10, cursor: "pointer",
              background: workspaceMode ? "var(--atm-dim)" : "transparent",
              border: "1px solid var(--border-default)", color: workspaceMode ? "var(--atm)" : "var(--text-lo)",
            }}>{workspaceMode ? "Tabs" : "Workspace"}</button>
          )}
          <div style={{ width: 1, height: 16, background: "var(--border-default)", margin: "0 8px" }} />
          <WalletConnect />
        </div>
      </AppHeader>

      {workspaceMode && viewportW >= 1024 ? (
        <WorkspaceGrid wallet={address} renderPanel={renderPanel} width={viewportW} />
      ) : (
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
          <aside style={{
            width: 236, flexShrink: 0, borderRight: "1px solid var(--border-default)",
            overflowY: "auto", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 18,
            background: "var(--bg-raised)",
          }}>
            <SpotPriceChart history={priceHistory} width={212} height={70} />
            <VolSmile baseVol={vol} width={212} height={110} />
            <AlertsPanel sym={sym} spot={spot} />
            {hydrated && backendPositions.length > 0 && (
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)", marginBottom: 8 }}>Portfolio Greeks</div>
                {[{ g: "Δ Net Delta", v: portGreeks.delta, dp: 3 }, { g: "Γ Net Gamma", v: portGreeks.gamma, dp: 4 },
                  { g: "Θ Daily", v: portGreeks.theta, dp: 4 }, { g: "V Vega", v: portGreeks.vega, dp: 3 }
                ].map(item => (
                  <div key={item.g} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: 10, color: "var(--text-lo)", fontFamily: "var(--font-mono)" }}>{item.g}</span>
                    <span className="num" style={{ fontSize: 11, color: item.g.includes("Θ") ? "var(--put)" : item.v >= 0 ? "var(--call)" : "var(--put)" }}>
                      {item.v >= 0 ? "+" : "\u2212"}{Math.abs(item.v).toFixed(item.dp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </aside>

          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", borderBottom: "1px solid var(--border-default)", padding: "0 8px", background: "var(--bg-raised)" }}>
              {(["chain", "positions", "strategies", "surface"] as const).map(tab => (
                <button key={tab} onClick={() => setViewTab(tab)} style={{
                  padding: "8px 14px", border: "none", background: "transparent", cursor: "pointer",
                  fontSize: 12, fontWeight: 500, textTransform: "capitalize",
                  color: viewTab === tab ? "var(--text-hi)" : "var(--text-lo)",
                  borderBottom: viewTab === tab ? "2px solid var(--brand)" : "2px solid transparent",
                  marginBottom: -1,
                }}>{tab}{tab === "positions" && hydrated && backendPositions.length > 0 ? ` (${backendPositions.length})` : ""}</button>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingRight: 4 }}>
                <span style={{ fontSize: 10, color: "var(--text-lo)" }}>{sym}-USD · {expiry.label} · ⌘K · ?</span>
              </div>
            </div>

            {viewTab === "chain" && chainPanel}

            {viewTab === "positions" && (
              <div style={{ flex: 1, overflowY: "auto" }}>
                {backendPositions.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
                    <div style={{ fontSize: 13, color: "var(--text-lo)" }}>No open positions</div>
                    <button onClick={() => setViewTab("chain")} style={{ fontSize: 11, color: "var(--brand)", background: "none", border: "none", cursor: "pointer" }}>← Back to chain</button>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                        {["Asset", "Type", "Side", "Strike", "Expiry", "Qty", "Δ", "Γ", "Θ", "V", ""].map(h => (
                          <th key={h} style={{ padding: "6px 8px", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "right", background: "var(--bg-raised)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {backendPositions.map(pos => {
                        const sign = pos.position_type === "short" ? -1 : 1;
                        const g = positionLiveGreeks(pos);
                        return (
                          <tr key={pos.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: "8px", fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{pos.underlying}</td>
                            <td style={{ padding: "8px 4px" }}>
                              <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", background: pos.position_type === "short" ? "var(--put-dim)" : "var(--call-dim)", color: pos.position_type === "short" ? "var(--put)" : "var(--call)", textTransform: "uppercase" }}>{pos.position_type}</span>
                            </td>
                            <td style={{ padding: "8px 4px" }}>
                              <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", background: pos.option_type === "call" ? "var(--call-dim)" : "var(--put-dim)", color: pos.option_type === "call" ? "var(--call)" : "var(--put)", textTransform: "uppercase" }}>{pos.option_type}</span>
                            </td>
                            {[fmtK(pos.strike), `${pos.expiry_days}D`, pos.contracts.toFixed(0),
                              (sign * g.delta * pos.contracts).toFixed(3), (sign * g.gamma * pos.contracts).toFixed(4),
                              (sign * g.theta * pos.contracts).toFixed(4), (sign * g.vega * pos.contracts).toFixed(3)
                            ].map((v, j) => (
                              <td key={j} className="num" style={{ padding: "8px", fontSize: 11, textAlign: "right", color: j === 5 ? "var(--put)" : "var(--text-hi)" }}>{v}</td>
                            ))}
                            <td style={{ padding: "4px 8px", textAlign: "right" }}>
                              <Link href="/portfolio" style={{ fontSize: 10, color: "var(--brand)", textDecoration: "none" }}>Manage →</Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {viewTab === "strategies" && (
              <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
                <StrategyPicker selectedId={selectedStrategy?.id ?? null} onSelect={setSelectedStrategy} />
                {selectedStrategy && (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-hi)", marginBottom: 12 }}>{selectedStrategy.name}</div>
                    {pricedLegs.map((leg, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                        <span style={{ fontSize: 11, color: leg.action === "buy" ? "var(--call)" : "var(--put)", textTransform: "uppercase" }}>{leg.action} {leg.side}</span>
                        <span className="num" style={{ fontSize: 11, color: "var(--text-mid)" }}>K={fmtK(leg.strike)}</span>
                        <span className="num" style={{ fontSize: 11, color: "var(--text-hi)" }}>${fmtN(leg.greeks.premium, 4)}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 16 }}>
                      <MultiLegPayoffDiagram legs={pricedLegs} spot={spot} width={420} height={220} />
                    </div>
                    <button onClick={() => { setTradeError(null); setShowStrategyConfirm(true); }} disabled={strategyInsufficientFunds || notSignedIn} style={{
                      marginTop: 12, padding: "10px 20px", background: "var(--brand)", color: "var(--bg)", border: "none", fontSize: 13, fontWeight: 700,
                      cursor: strategyInsufficientFunds || notSignedIn ? "default" : "pointer", opacity: strategyInsufficientFunds || notSignedIn ? 0.5 : 1,
                    }}>Execute {selectedStrategy.name} ({pricedLegs.length} legs)</button>
                  </div>
                )}
              </div>
            )}

            {viewTab === "surface" && (
              <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                <VolSurfaceHeatmap baseVol={vol} selectedExpiryDays={expiry.days} />
              </div>
            )}
          </div>

          {trade && tradeGreeks && (
            <aside style={{ width: 316, flexShrink: 0, borderLeft: "1px solid var(--border-default)", overflowY: "auto", background: "var(--bg-raised)", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: trade.side === "call" ? "var(--call)" : "var(--put)", marginBottom: 4 }}>
                    {trade.mode === "write" ? "WRITE " : "BUY "}{trade.side === "call" ? "▲ CALL" : "▼ PUT"}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}>{sym} {trade.side === "call" ? "Call" : "Put"}</div>
                  <div className="num" style={{ fontSize: 12, color: "var(--text-mid)" }}>K={fmtK(trade.row.strike)} · {expiry.label}</div>
                </div>
                <button onClick={() => setTrade(null)} style={{ background: "none", border: "none", color: "var(--text-lo)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
              </div>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-default)" }}>
                <PayoffDiagram spot={spot} strike={trade.row.strike} premium={tradeGreeks.premium} isCall={trade.side === "call"} short={trade.mode === "write"} contracts={qty} width={284} height={155} />
              </div>
              <div style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>Contracts</div>
                <div style={{ display: "flex", alignItems: "center", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", marginBottom: 10 }}>
                  <button onClick={() => setContracts(c => String(Math.max(0.01, (parseFloat(c) || 1) - 1)))} style={{ width: 36, height: 40, border: "none", background: "none", color: "var(--text-mid)", fontSize: 18, cursor: "pointer" }}>−</button>
                  <input type="number" min="0.01" step="0.01" value={contracts} onChange={e => setContracts(e.target.value)} onBlur={e => setContracts(String(Math.max(0.01, parseFloat(e.target.value) || 1)))} style={{ flex: 1, height: 40, border: "none", background: "none", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--text-hi)", outline: "none" }} />
                  <button onClick={() => setContracts(c => String((parseFloat(c) || 0) + 1))} style={{ width: 36, height: 40, border: "none", background: "none", color: "var(--text-mid)", fontSize: 18, cursor: "pointer" }}>+</button>
                </div>
                <button onClick={() => { setTradeError(null); setShowTradeConfirm(true); }} disabled={insufficientFunds || notSignedIn} style={{
                  width: "100%", height: 44, border: "none", cursor: insufficientFunds || notSignedIn ? "default" : "pointer", fontSize: 14, fontWeight: 700,
                  opacity: insufficientFunds || notSignedIn ? 0.5 : 1, background: trade.side === "call" ? "var(--call)" : "var(--put)", color: "var(--bg)",
                }}>{trade.mode === "write" ? "Write" : "Buy"} {trade.side.toUpperCase()} @ {fmtK(trade.row.strike)}</button>
              </div>
            </aside>
          )}
        </div>
      )}

      <div style={{ height: 26, flexShrink: 0, borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 16, padding: "0 16px", background: "var(--bg)" }}>
        <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Black-Scholes · ⌘K palette · ? shortcuts · {chain.length} strikes</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--call)", opacity: 0.8 }} />
          <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Live · Stellar Testnet</span>
        </div>
      </div>

      {showTradeConfirm && trade && tradeGreeks && (
        <ConfirmDialog
          title={`${trade.mode === "write" ? "Write" : "Buy"} ${sym} ${trade.side.toUpperCase()}`}
          confirmLabel={submitting ? "Submitting…" : `Confirm ${trade.mode === "write" ? "Write" : "Buy"}`}
          onConfirm={execTrade}
          onCancel={() => setShowTradeConfirm(false)}
          disabled={insufficientFunds || notSignedIn || submitting || !!tradeError}
          disabledReason={tradeError ?? (insufficientFunds ? `Insufficient balance ${trade.mode === "write" ? "to post collateral" : "to cover premium"}.` : undefined)}
        >
          {[
            ["Strike", fmtK(trade.row.strike)],
            ["Expiry", expiry.label],
            ["Contracts", String(qty)],
            [trade.mode === "write" ? "Premium received" : "Total premium", `$${fmtN(tradeGreeks.premium * qty, 2)}`],
            ...(trade.mode === "write" ? [["Collateral required", `$${fmtN(collateral, 2)}`]] : []),
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
              <span style={{ color: "var(--text-lo)" }}>{k}</span>
              <span className="num" style={{ color: "var(--text-hi)" }}>{v}</span>
            </div>
          ))}
        </ConfirmDialog>
      )}

      {showStrategyConfirm && selectedStrategy && (
        <ConfirmDialog
          title={`Execute ${selectedStrategy.name}`}
          confirmLabel={submitting ? "Submitting…" : "Confirm Execute"}
          onConfirm={execStrategy}
          onCancel={() => setShowStrategyConfirm(false)}
          disabled={strategyInsufficientFunds || notSignedIn || submitting || !!tradeError}
          disabledReason={tradeError ?? (strategyInsufficientFunds ? `Insufficient balance — needs $${fmtN(strategyRequiredFunds, 2)}, have $${fmtN(balance, 2)}.` : notSignedIn ? "Connect your wallet to trade." : undefined)}
        >
          {pricedLegs.map((leg, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
              <span style={{ color: leg.action === "buy" ? "var(--call)" : "var(--put)", textTransform: "uppercase" }}>{leg.action} {leg.side}</span>
              <span className="num" style={{ color: "var(--text-mid)" }}>K={fmtK(leg.strike)}</span>
              <span className="num" style={{ color: "var(--text-hi)" }}>${fmtN(leg.greeks.premium * leg.contracts, 2)}</span>
            </div>
          ))}
        </ConfirmDialog>
      )}
    </div>
  );
}
