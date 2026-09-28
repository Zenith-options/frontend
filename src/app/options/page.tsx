"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { StarButton } from "../../components/StarButton";
import dynamic from "next/dynamic";
import { MARKETS, EXPIRIES, bs, smileVol, fmtN, fmtSpot, fmtK } from "../../lib/pricing";
import { getExpiryCalendar } from "../../lib/api/market";
import { ApiError } from "../../lib/api/client";
import { useBackendData } from "../../lib/context/BackendDataContext";
import { useSpotFeedContext } from "../../lib/context/SpotFeedContext";
import { useEnvironment } from "../../lib/context/EnvironmentContext";
import { collateralRequired } from "../../lib/collateral";
import { usePriceHistory } from "../../lib/usePriceHistory";
import { useHydrated } from "../../lib/useHydrated";
import { useMediaQuery, COMPACT_LAYOUT_QUERY } from "../../lib/hooks/useMediaQuery";
import { type StrategyTemplate } from "../../lib/strategies";
import { netPremium, type PricedLeg } from "../../lib/payoff";
import type { Position } from "../../lib/api/types";
import { useChain, type ChainRow } from "../../features/options/useChain";
import { ChainView, type TradeMode, type TradeSide } from "../../features/options/ChainView";
import type { TicketTrade } from "../../features/options/OrderTicket";
import { PositionsView } from "../../features/options/PositionsView";
import { MarketSidebar } from "../../features/options/MarketSidebar";
import { describeTrade, type TradeLeg } from "../../features/onboarding/describeTrade";
import { useOnboardingStore } from "../../features/onboarding/store";
import { Term } from "../../features/onboarding/Term";

// Everything that only appears after interaction (a tab other than Chain, the
// ticket, confirmations) is split out of the initial bundle — on a throttled
// phone CPU the terminal's first-load script cost was the main drag on
// Lighthouse performance.
const VolSurfaceHeatmap = dynamic(() => import("../../components/VolSurfaceHeatmap").then(m => m.VolSurfaceHeatmap), { ssr: false });
const StrategiesView = dynamic(() => import("../../features/options/StrategiesView").then(m => m.StrategiesView), { ssr: false });
const OrderTicket = dynamic(() => import("../../features/options/OrderTicket").then(m => m.OrderTicket), { ssr: false });
const BottomSheet = dynamic(() => import("../../components/BottomSheet").then(m => m.BottomSheet), { ssr: false });
const ConfirmDialog = dynamic(() => import("../../components/ConfirmDialog").then(m => m.ConfirmDialog), { ssr: false });
const TradeSummary = dynamic(() => import("../../features/onboarding/TradeSummary").then(m => m.TradeSummary), { ssr: false });

const TABS = ["chain", "positions", "strategies", "surface", "market"] as const;
type ViewTab = typeof TABS[number];
const SWIPE_MIN_PX = 60;

export default function OptionsPage() {
  // `?u=` is read after mount rather than via useSearchParams(): that hook
  // opts the whole page out of static rendering (everything under its
  // Suspense boundary renders client-side only), which delayed first paint
  // of the terminal on phones.
  const [sym, setSym] = useState("XLM");
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("u");
    if (u && MARKETS.some(m => m.sym === u)) setSym(u);
  }, []);
  const [expiry, setExpiry] = useState(EXPIRIES[2]);
  // Live from the shared WebSocket feed (SpotFeedProvider, mounted at
  // the root) — null until the first message arrives or if the socket's
  // still reconnecting, in which case the static seed constants below
  // are what render instead.
  const { data: spotData } = useSpotFeedContext();
  const { network, tradingBlocked, tradingBlockReason } = useEnvironment();
  const practice = useOnboardingStore(s => s.practice);
  const [trade, setTrade] = useState<TicketTrade | null>(null);
  const [showTradeConfirm, setShowTradeConfirm] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [practiceResult, setPracticeResult] = useState<string | null>(null);
  const hydrated = useHydrated();
  const compactLayout = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const {
    authStatus, account, positions: backendPositions, greeks: portGreeks, watchlist,
    open: openBackendPosition, openStrategy: openBackendStrategy,
  } = useBackendData();
  const favorites = useMemo(() => watchlist.map(w => w.underlying), [watchlist]);
  // null = unknown (loading or signed out). Never treated as $0.
  const balance = account?.balance ?? null;
  const market = MARKETS.find(m => m.sym === sym) ?? MARKETS[0];
  const spot = spotData?.prices[sym] ?? market.price;
  const vol = spotData?.vols[sym] ?? market.vol;
  const priceHistory = usePriceHistory(sym, spot);
  const [contracts, setContracts] = useState("1");
  const [viewTab, setViewTab] = useState<ViewTab>("chain");
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyTemplate | null>(null);
  const [showStrategyConfirm, setShowStrategyConfirm] = useState(false);
  const prevSpotRef = useRef(spot);

  const t = expiry.days / 365;

  // Standard "previous value" pattern: this effect runs after the
  // render that already shows the current `spot`, so the ref always
  // holds what was rendered last time — which is exactly what
  // `priceDir` below needs to compare against.
  useEffect(() => {
    prevSpotRef.current = spot;
  }, [spot]);

  // Backend's expiry list happens to be the same across every underlying
  // (it's not derived from anything symbol-specific yet), but fetching
  // per-symbol anyway keeps this correct if that ever changes, and
  // matches how spot/chain are already fetched per-symbol.
  const [expiries, setExpiries] = useState(EXPIRIES);
  useEffect(() => {
    let cancelled = false;
    getExpiryCalendar(sym).then(cal => {
      if (cancelled) return;
      setExpiries(cal.expiries.map(e => ({ label: e.label, days: e.days_to_expiry })));
    }).catch(() => { /* keep showing the local EXPIRIES fallback */ });
    return () => { cancelled = true; };
  }, [sym]);

  const sortedMarkets = useMemo(() => {
    if (!hydrated) return MARKETS; // matches SSR order until this component's own mount effect fires
    return [...MARKETS].sort((a, b) => {
      const aFav = favorites.includes(a.sym), bFav = favorites.includes(b.sym);
      return aFav === bFav ? 0 : aFav ? -1 : 1;
    });
  }, [favorites, hydrated]);

  const chain = useChain(sym, expiry.days, spot, vol);

  // Backend positions don't store per-position Greeks (only the entry
  // premium/spot) — GET /api/v1/portfolio/greeks gives the aggregate, but
  // the per-row columns need a live figure for each position individually,
  // so this recomputes them the same way /api/v1/portfolio/greeks does
  // server-side: reprice at current spot/vol for that position's own
  // underlying, same static expiry_days-as-t simplification the backend
  // uses for closing.
  const positionLiveGreeks = (pos: Position) => {
    const posSpot = spotData?.prices[pos.underlying] ?? MARKETS.find(m => m.sym === pos.underlying)?.price ?? spot;
    const posVol = spotData?.vols[pos.underlying] ?? MARKETS.find(m => m.sym === pos.underlying)?.vol ?? vol;
    const v = smileVol(posVol, pos.strike / posSpot);
    return bs(posSpot, pos.strike, v, pos.expiry_days / 365, pos.option_type === "call");
  };

  const tradeGreeks = trade ? (trade.side === "call" ? trade.row.call : trade.row.put) : null;
  const qty = Math.max(0.01, parseFloat(contracts) || 1);

  // Strategy leg pricing still uses the local bs()/smileVol() calc (with
  // the static seed vol, not the live-polled one) rather than a backend
  // round trip per leg. Premiums here won't always match a leg's
  // corresponding chain row exactly once vol has drifted from its seed value.
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
  const collateral = trade && trade.mode === "write" ? collateralRequired(trade.side, qty, trade.row.strike, spot) : 0;
  const requiredFunds = trade ? (trade.mode === "write" ? collateral : (tradeGreeks?.premium ?? 0) * qty) : 0;

  /**
   * Why a trade can't be sent right now, in priority order — or null.
   * Practice mode never sends anything, so nothing blocks it.
   */
  const blockReason = (needed: number, insufficientMessage: string): string | null => {
    if (practice) return null;
    if (!network.apiUrl) return `No backend is configured for ${network.label}, so trading is unavailable here.`;
    if (authStatus === "signing-in" || authStatus === "unknown") return "Signing in…";
    if (authStatus !== "signed-in") return "Connect your wallet to trade.";
    if (tradingBlocked) return tradingBlockReason;
    if (balance === null) return "Loading your balance…";
    if (balance < needed) return insufficientMessage;
    return null;
  };
  const tradeBlock = trade
    ? blockReason(requiredFunds, `Insufficient balance ${trade.mode === "write" ? "to post collateral" : "to cover premium"}.`)
    : null;
  const strategyBlock = pricedLegs.length > 0 ? blockReason(strategyRequiredFunds, "Insufficient balance.") : null;

  const tradeLegs = useMemo((): TradeLeg[] => (trade && tradeGreeks
    ? [{ side: trade.side, action: trade.mode === "write" ? "sell" : "buy", strike: trade.row.strike, contracts: qty, premium: tradeGreeks.premium }]
    : []), [trade, tradeGreeks, qty]);
  const tradeContext = useMemo(() => ({ underlying: sym, expiryDays: expiry.days, collateral }), [sym, expiry.days, collateral]);
  const strategyLegs = useMemo((): TradeLeg[] => pricedLegs.map(l => ({
    side: l.side, action: l.action, strike: l.strike, contracts: l.contracts, premium: l.greeks.premium,
  })), [pricedLegs]);
  const strategyContext = useMemo(() => ({ underlying: sym, expiryDays: expiry.days, collateral: strategyCollateral }), [sym, expiry.days, strategyCollateral]);

  const openTrade = (row: ChainRow, side: TradeSide, mode: TradeMode) => {
    setTradeError(null);
    setTrade({ row, side, mode });
  };

  const execTrade = async () => {
    if (!trade || !tradeGreeks || tradeBlock || submitting) return;
    if (practice) {
      setPracticeResult(describeTrade(tradeLegs, tradeContext).text);
      setTrade(null);
      setShowTradeConfirm(false);
      return;
    }
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
    if (!selectedStrategy || pricedLegs.length === 0 || strategyBlock || submitting) return;
    if (practice) {
      setPracticeResult(describeTrade(strategyLegs, strategyContext).text);
      setSelectedStrategy(null);
      setShowStrategyConfirm(false);
      return;
    }
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

  // Swipe left/right on the content area to change tabs (touch layouts).
  // Gestures that start inside horizontally-scrolling content (the phone
  // chain, charts, the surface table) are theirs, not the tab bar's.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    swipeStart.current = target.closest("[data-swipe-ignore], .chart-touch") ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || !compactLayout) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 2) return;
    const i = TABS.indexOf(viewTab);
    const next = TABS[Math.min(TABS.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)))];
    setViewTab(next);
    document.getElementById(`tab-${next}`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
  };

  const priceDir = spot >= prevSpotRef.current;
  const positionsCount = authStatus === "signed-in" ? backendPositions.length : 0;

  const ticket = trade && tradeGreeks && (
    <OrderTicket
      trade={trade} greeks={tradeGreeks} sym={sym} spot={spot} expiryLabel={expiry.label}
      contracts={contracts} onContractsChange={setContracts} qty={qty} collateral={collateral}
      balance={balance} blockReason={tradeBlock} error={tradeError} practice={practice}
      onReview={() => { setTradeError(null); setShowTradeConfirm(true); }}
      onClose={() => setTrade(null)}
      inSheet={compactLayout}
    />
  );

  return (
    <div className="app-shell">

      {/* TOP BAR */}
      <AppHeader>
        <div style={{ display: "flex", gap: 1 }} role="group" aria-label="Underlying">
          {sortedMarkets.map(m => (
            <div key={m.sym} style={{
              display: "flex", alignItems: "center",
              background: sym === m.sym ? "var(--bg-overlay)" : "transparent",
              borderBottom: sym === m.sym ? "2px solid var(--brand)" : "2px solid transparent",
            }}>
              <button type="button" className="tap" aria-pressed={sym === m.sym} onClick={() => setSym(m.sym)} style={{
                padding: "4px 4px 4px 10px", border: "none", background: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600, transition: "all 120ms",
                color: sym === m.sym ? "var(--text-hi)" : "var(--text-mid)",
              }}>{m.sym}</button>
              <StarButton sym={m.sym} />
            </div>
          ))}
        </div>
        <div className="app-header-sep" />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="num" style={{ fontSize: 16, fontWeight: 600, color: "var(--text-hi)" }}>{fmtSpot(spot)}</span>
          <span className="num" style={{ fontSize: 12, color: priceDir ? "var(--call)" : "var(--put)" }}>
            {priceDir ? "+" : "−"}{Math.abs((spot / market.price - 1) * 100).toFixed(2)}%
          </span>
          <span style={{ fontSize: 11, color: "var(--text-lo)", whiteSpace: "nowrap" }}><Term id="iv">IV</Term> {Math.round(vol * 100)}%</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }} role="group" aria-label="Expiry">
          {expiries.map(e => (
            <button type="button" key={e.label} className="tap" aria-pressed={expiry.label === e.label} onClick={() => setExpiry(e)} style={{
              padding: "3px 7px", border: "none", cursor: "pointer", fontSize: 11,
              background: expiry.label === e.label ? "var(--atm-dim)" : "transparent",
              color: expiry.label === e.label ? "var(--atm)" : "var(--text-lo)",
            }}>{e.label}</button>
          ))}
          <div className="app-header-sep" style={{ height: 16, margin: "0 8px" }} />
          <WalletConnect />
        </div>
      </AppHeader>

      {/* MAIN */}
      <div className="terminal-main">

        {/* LEFT SIDEBAR (desktop; the "Market" tab on smaller screens) */}
        <aside className="terminal-sidebar">
          <MarketSidebar sym={sym} spot={spot} vol={vol} priceHistory={priceHistory} />
        </aside>

        {/* CENTER */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div className="terminal-tabs" role="tablist" aria-label="Terminal views">
            {TABS.map(tab => (
              <button
                key={tab}
                id={`tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={viewTab === tab}
                aria-controls="terminal-panel"
                className={tab === "market" ? "mobile-only" : undefined}
                onClick={() => setViewTab(tab)}
                style={{
                  padding: "8px 14px", border: "none", background: "transparent", cursor: "pointer",
                  fontSize: 12, fontWeight: 500, textTransform: "capitalize",
                  color: viewTab === tab ? "var(--text-hi)" : "var(--text-lo)",
                  borderBottom: viewTab === tab ? "2px solid var(--brand)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >{tab}{tab === "positions" && positionsCount > 0 ? ` (${positionsCount})` : ""}</button>
            ))}
            <div className="terminal-tabs-hint">
              <span style={{ fontSize: 10, color: "var(--text-lo)" }}>
                {sym}-USD · {expiry.label} · {chain.rows.length} strikes · Click ask to buy, bid to write
              </span>
            </div>
          </div>

          {practiceResult && (
            <div role="status" data-testid="practice-result" style={{
              display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 16px", fontSize: 12, lineHeight: 1.5,
              background: "var(--call-dim)", borderBottom: "1px solid var(--call)", color: "var(--text-hi)",
            }}>
              <span style={{ flex: 1 }}><strong style={{ color: "var(--call)" }}>Practice trade simulated. Nothing was sent.</strong> {practiceResult}</span>
              <button type="button" className="tap" onClick={() => setPracticeResult(null)} aria-label="Dismiss" style={{
                background: "none", border: "none", color: "var(--text-mid)", cursor: "pointer", fontSize: 16,
              }}>×</button>
            </div>
          )}

          <div
            id="terminal-panel"
            role="tabpanel"
            aria-labelledby={`tab-${viewTab}`}
            style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {viewTab === "chain" && (
              <ChainView chain={chain} sym={sym} expiryLabel={expiry.label} onTrade={openTrade} />
            )}

            {viewTab === "positions" && (
              <PositionsView liveGreeks={positionLiveGreeks} onBackToChain={() => setViewTab("chain")} />
            )}

            {viewTab === "strategies" && (
              <StrategiesView
                selected={selectedStrategy} onSelect={setSelectedStrategy} legs={pricedLegs} spot={spot}
                netPremium={strategyNetPremium} collateral={strategyCollateral} requiredFunds={strategyRequiredFunds}
                balance={balance} blockReason={strategyBlock}
                onExecute={() => { setTradeError(null); setShowStrategyConfirm(true); }}
              />
            )}

            {viewTab === "surface" && (
              <div style={{ padding: 16, overflowX: "auto" }} data-swipe-ignore>
                <VolSurfaceHeatmap baseVol={vol} selectedExpiryDays={expiry.days} />
              </div>
            )}

            {viewTab === "market" && (
              <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", gap: 18 }}>
                <MarketSidebar sym={sym} spot={spot} vol={vol} priceHistory={priceHistory} />
              </div>
            )}
          </div>

          {authStatus === "signed-in" && backendPositions.length > 0 && (
            <div className="desktop-only" style={{
              height: 36, flexShrink: 0, borderTop: "1px solid var(--border-default)",
              display: "flex", alignItems: "center", gap: 20, padding: "0 16px", background: "var(--bg-raised)",
            }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)" }}>Portfolio</span>
              {[{ g: "Net Δ", v: portGreeks.delta, dp: 3 }, { g: "Net Γ", v: portGreeks.gamma, dp: 4 },
                { g: "Daily Θ", v: portGreeks.theta, dp: 4 }, { g: "Vega", v: portGreeks.vega, dp: 3 },
              ].map(item => (
                <div key={item.g} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 10, color: "var(--text-lo)" }}>{item.g}</span>
                  <span className="num" style={{ fontSize: 11, color: item.g.includes("Θ") ? "var(--put)" : item.v >= 0 ? "var(--call)" : "var(--put)" }}>
                    {item.v >= 0 ? "+" : "−"}{Math.abs(item.v).toFixed(item.dp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT PANEL: order ticket (desktop). Phones/tablets use a bottom sheet. */}
        {ticket && !compactLayout && (
          <aside style={{
            width: 316, flexShrink: 0, borderLeft: "1px solid var(--border-default)",
            overflowY: "auto", background: "var(--bg-raised)",
          }}>
            {ticket}
          </aside>
        )}
      </div>

      <BottomSheet open={!!ticket && compactLayout && !showTradeConfirm} onClose={() => setTrade(null)} title="Order ticket" testId="ticket-sheet">
        {ticket}
      </BottomSheet>

      {/* STATUS BAR */}
      <div className="terminal-status" style={{
        borderTop: "1px solid var(--border-subtle)",
        display: "flex", alignItems: "center", gap: 16, padding: "0 16px", background: "var(--bg)",
      }}>
        <span style={{ fontSize: 10, color: "var(--text-lo)" }}>
          Black-Scholes · r=5.0% · Vol smile applied · {chain.rows.length} strikes
        </span>
        <span className="terminal-status-hint" style={{ fontSize: 10, color: "var(--text-lo)" }}>
          · Click an <b>ask</b> to buy, a <b>bid</b> to write (sell) and collect premium
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: network.color, opacity: 0.8 }} />
          <span style={{ fontSize: 10, color: "var(--text-lo)" }}>{chain.source === "model" ? "Model" : "Live"} · {network.label}</span>
        </div>
      </div>

      {showTradeConfirm && trade && tradeGreeks && (
        <ConfirmDialog
          title={`${practice ? "Practice: " : ""}${trade.mode === "write" ? "Write" : "Buy"} ${sym} ${trade.side.toUpperCase()}`}
          confirmLabel={submitting ? "Submitting…" : practice ? "Simulate trade" : `Confirm ${trade.mode === "write" ? "Write" : "Buy"}`}
          onConfirm={execTrade}
          onCancel={() => setShowTradeConfirm(false)}
          disabled={!!tradeBlock || submitting || !!tradeError}
          disabledReason={tradeError ?? tradeBlock ?? undefined}
          summary={<TradeSummary legs={tradeLegs} context={tradeContext} />}
          practice={practice}
          tourId="confirm-dialog"
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
          title={`${practice ? "Practice: " : ""}Execute ${selectedStrategy.name}`}
          confirmLabel={submitting ? "Submitting…" : practice ? "Simulate trade" : "Confirm Execute"}
          onConfirm={execStrategy}
          onCancel={() => setShowStrategyConfirm(false)}
          disabled={!!strategyBlock || submitting || !!tradeError}
          disabledReason={tradeError ?? strategyBlock ?? undefined}
          summary={<TradeSummary legs={strategyLegs} context={strategyContext} />}
          practice={practice}
        >
          {pricedLegs.map((leg, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
              <span style={{ color: leg.action === "buy" ? "var(--call)" : "var(--put)", textTransform: "uppercase" }}>{leg.action} {leg.side}</span>
              <span className="num" style={{ color: "var(--text-mid)" }}>K={fmtK(leg.strike)}</span>
              <span className="num" style={{ color: "var(--text-hi)" }}>${fmtN(leg.greeks.premium * leg.contracts, 2)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", marginTop: 6, borderTop: "1px solid var(--border-default)", fontSize: 12 }}>
            <span style={{ color: "var(--text-lo)" }}>{strategyNetPremium >= 0 ? "Net Debit" : "Net Credit"}</span>
            <span className="num" style={{ color: "var(--text-hi)" }}>${fmtN(Math.abs(strategyNetPremium), 2)}</span>
          </div>
          {strategyCollateral > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
              <span style={{ color: "var(--text-lo)" }}>Collateral Required</span>
              <span className="num" style={{ color: "var(--text-hi)" }}>${fmtN(strategyCollateral, 2)}</span>
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
