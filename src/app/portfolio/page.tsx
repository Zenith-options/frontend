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
import { toCsv, downloadCsv } from "../../lib/csv";
import { ExportButton } from "../../components/ExportButton";
import { PortfolioRiskPanel } from "../../components/PortfolioRiskPanel";
import { RollWizard } from "../../components/RollWizard";
import { getChain } from "../../lib/api/market";

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

export default function PortfolioPage() {
  const token = useWalletStore(s => s.token);
  const { account, positions: backendPositions, greeks: netGreeks, close, roll } = useBackendData();
  const balance = account?.balance ?? 0;
  const collateralLocked = account?.collateral_locked ?? 0;
  const notSignedIn = !token;
  const [actionError, setActionError] = useState<string|null>(null);

  // Live from the shared WebSocket feed (SpotFeedProvider) — one
  // connection covers every underlying, so marking every open position
  // to market doesn't need its own per-symbol subscription or poll.
  const { data: spotFeed } = useSpotFeedContext();
  const spots = spotFeed?.prices ?? Object.fromEntries(MARKETS.map(m => [m.sym, m.price]));
  const vols = spotFeed?.vols ?? Object.fromEntries(MARKETS.map(m => [m.sym, m.vol]));

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
  const rollTarget = marked.find(p => p.id === rollTargetId) ?? null;
  const [rollChain, setRollChain] = useState<{ strikes: number[]; expiries: number[]; entries: { strike: number; call?: { premium: number; delta: number }; put?: { premium: number; delta: number } }[] }>({
    strikes: [],
    expiries: EXPIRIES.map(e => e.days),
    entries: [],
  });

  useEffect(() => {
    if (!rollTarget) return;
    let cancelled = false;
    getChain(rollTarget.underlying, rollTarget.expiry_days).then(entries => {
      if (cancelled) return;
      setRollChain({
        strikes: entries.map(e => e.strike),
        expiries: EXPIRIES.map(e => e.days),
        entries: entries.map(e => ({
          strike: e.strike,
          call: { premium: e.call.premium, delta: e.call.delta },
          put: { premium: e.put.premium, delta: e.put.delta },
        })),
      });
    }).catch(() => {
      if (cancelled) return;
      // Fallback strike grid around spot
      const spot = spots[rollTarget.underlying] ?? rollTarget.strike;
      setRollChain({
        strikes: Array.from({ length: 21 }, (_, i) => Math.round(spot * (1 + (i - 10) * 0.04) * 10000) / 10000),
        expiries: EXPIRIES.map(e => e.days),
        entries: [],
      });
    });
    return () => { cancelled = true; };
  }, [rollTargetId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"var(--bg)",overflow:"hidden",fontFamily:"var(--font-sans)"}}>
      <AppHeader>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:"var(--call)"}}/>
          <span style={{fontSize:10,color:"var(--text-lo)"}}>Marked to market · Stellar Testnet</span>
          <div style={{width:1,height:16,background:"var(--border-default)",margin:"0 8px"}}/>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{flex:1,overflowY:"auto"}}>
        <div style={{maxWidth:1080,margin:"0 auto",padding:"32px 24px 64px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <h1 style={{fontFamily:"var(--font-serif)",fontSize:26,fontWeight:600,marginBottom:4}}>Portfolio</h1>
              <p style={{fontSize:13,color:"var(--text-mid)",marginBottom:28}}>
                {notSignedIn
                  ? "Connect your wallet to see your positions."
                  : `${backendPositions.length} open position${backendPositions.length===1?"":"s"} · live premium repriced off current spot`}
              </p>
            </div>
            {marked.length>0 && (
              <ExportButton onClick={()=>downloadCsv(
                `zenith-positions-${new Date().toISOString().slice(0,10)}.csv`,
                toCsv(marked,[
                  {header:"Asset",value:p=>p.underlying},
                  {header:"Type",value:p=>p.position_type},
                  {header:"Side",value:p=>p.option_type},
                  {header:"Strike",value:p=>p.strike},
                  {header:"Expiry",value:p=>`${p.expiry_days}D`},
                  {header:"Qty",value:p=>p.contracts},
                  {header:"Strategy",value:p=>p.strategy_id??""},
                  {header:"Collateral",value:p=>p.collateral},
                  {header:"Entry Premium",value:p=>p.entry_premium*p.contracts},
                  {header:"Current Value",value:p=>p.currentPremium},
                  {header:"P&L",value:p=>p.pnl},
                ])
              )}/>
            )}
          </div>

          {/* Summary bar */}
          <div style={{display:"flex",gap:0,marginBottom:32,border:"1px solid var(--border-default)",background:"var(--bg-raised)"}}>
            {[
              {label:"Available Balance", value:`$${fmtN(balance,2)}`, color:"var(--text-hi)"},
              {label:"Collateral Locked", value:`$${fmtN(collateralLocked,2)}`, color:"var(--atm)"},
              {label:"Unrealized P&L", value:`${totalPnl>=0?"+":"−"}$${fmtN(Math.abs(totalPnl),2)}`, color:totalPnl>=0?"var(--call)":"var(--put)"},
              {label:"Net Delta", value:`${netGreeks.delta>=0?"+":"−"}${Math.abs(netGreeks.delta).toFixed(3)}`, color:"var(--text-hi)"},
              {label:"Net Theta", value:`${netGreeks.theta>=0?"+":"−"}${Math.abs(netGreeks.theta).toFixed(4)}`, color:"var(--put)"},
              {label:"Net Vega", value:`${netGreeks.vega>=0?"+":"−"}${Math.abs(netGreeks.vega).toFixed(3)}`, color:"var(--atm)"},
            ].map((s,i)=>(
              <div key={s.label} style={{flex:1,padding:"14px 18px",borderRight:i<5?"1px solid var(--border-default)":"none"}}>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)",marginBottom:6}}>{s.label}</div>
                <div className="num" style={{fontSize:17,fontWeight:600,color:s.color}}>{s.value}</div>
              </div>
            ))}
          </div>

          {actionError && (
            <div style={{marginBottom:16,padding:"10px 14px",border:"1px solid var(--put)",background:"var(--put-dim)",fontSize:12,color:"var(--put)"}}>
              {actionError}
            </div>
          )}

          {backendPositions.length>0 && <PortfolioRiskPanel positions={backendPositions} spots={spots} />}

          {strategyGroups.length>0 && (
            <div style={{marginBottom:24,display:"flex",flexDirection:"column",gap:8}}>
              {strategyGroups.map(g=>(
                <div key={g.id} style={{border:"1px solid var(--border-default)",background:"var(--bg-raised)",padding:"12px 16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{g.sym} Strategy · {g.legs.length} legs</div>
                    <button onClick={()=>handleCloseStrategy(g.legs)} style={{
                      fontSize:10,color:"var(--text-lo)",background:"none",border:"1px solid var(--border-default)",
                      padding:"2px 8px",cursor:"pointer"}}>Close all legs</button>
                  </div>
                  {g.legs.map(leg=>(
                    <div key={leg.id} style={{display:"flex",justifyContent:"space-between",padding:"2px 0",fontSize:11}}>
                      <span style={{color:leg.position_type==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                        {leg.position_type} {leg.option_type}
                      </span>
                      <span className="num" style={{color:"var(--text-mid)"}}>K={leg.strike.toFixed(4)}</span>
                      <span className="num" style={{color:leg.pnl>=0?"var(--call)":"var(--put)"}}>
                        {leg.pnl>=0?"+":"−"}${fmtN(Math.abs(leg.pnl),2)}
                      </span>
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:8,borderTop:"1px solid var(--border-subtle)"}}>
                    <span style={{fontSize:11,color:"var(--text-lo)"}}>
                      {g.totalCollateral>0?`Collateral: $${fmtN(g.totalCollateral,2)}`:""}
                    </span>
                    <span className="num" style={{fontSize:12,fontWeight:600,color:g.totalPnl>=0?"var(--call)":"var(--put)"}}>
                      Combined: {g.totalPnl>=0?"+":"−"}${fmtN(Math.abs(g.totalPnl),2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {marked.length===0 ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              padding:"80px 0",border:"1px solid var(--border-subtle)",background:"var(--bg-raised)",gap:12}}>
              <div style={{fontSize:14,color:"var(--text-mid)"}}>No open positions</div>
              <Link href="/options" style={{fontSize:13,color:"var(--brand)",textDecoration:"none"}}>
                Open the options chain →
              </Link>
            </div>
          ) : soloPositions.length===0 ? null : (
            <div style={{border:"1px solid var(--border-default)",background:"var(--bg-raised)",overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:940}}>
                <thead>
                  <tr style={{borderBottom:"1px solid var(--border-default)"}}>
                    {["Asset","Type","Side","Strike","Expiry","Qty","Collateral","Entry","Current","P&L","Δ",""].map(h=>(
                      <th key={h} style={{padding:"8px 10px",fontSize:10,fontWeight:500,textTransform:"uppercase",
                        letterSpacing:"0.05em",color:"var(--text-lo)",textAlign:"right",background:"var(--bg-overlay)"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {soloPositions.map(p=>{
                    const sign = p.position_type==="short"?-1:1;
                    return [
                      <tr key={p.id} style={{borderBottom:"1px solid var(--border-subtle)"}}>
                        <td style={{padding:"10px",fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{p.underlying}</td>
                        <td style={{padding:"10px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                            background:p.position_type==="short"?"var(--put-dim)":"var(--call-dim)",
                            color:p.position_type==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                            {p.position_type}
                          </span>
                        </td>
                        <td style={{padding:"10px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                            background:p.option_type==="call"?"var(--call-dim)":"var(--put-dim)",
                            color:p.option_type==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                            {p.option_type}
                          </span>
                        </td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{p.strike>=1000?p.strike.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):p.strike.toFixed(4)}</td>
                        <td style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{p.expiry_days}D</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{p.contracts}</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{p.collateral>0?`$${fmtN(p.collateral,2)}`:"—"}</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>
                          {p.position_type==="short"?"+":""}${fmtN(p.entry_premium*p.contracts,2)}
                        </td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>${fmtN(p.currentPremium,2)}</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",fontWeight:600,color:p.pnl>=0?"var(--call)":"var(--put)"}}>
                          {p.pnl>=0?"+":"−"}${fmtN(Math.abs(p.pnl),2)} <span style={{opacity:0.6}}>({p.pnlPct>=0?"+":""}{p.pnlPct.toFixed(1)}%)</span>
                        </td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{(sign*p.liveDelta*p.contracts).toFixed(3)}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <button onClick={() => setRollTargetId(p.id)} disabled={notSignedIn} style={{
                            fontSize: 10, color: "var(--text-lo)", background: "none",
                            border: "1px solid var(--border-default)", padding: "2px 8px", cursor: notSignedIn ? "default" : "pointer", marginRight: 6, opacity: notSignedIn ? 0.5 : 1
                          }}>
                            Roll
                          </button>
                          <button onClick={() => handleClose(p)} disabled={notSignedIn} style={{
                            fontSize: 10, color: "var(--text-lo)", background: "none", border: "1px solid var(--border-default)",
                            padding: "2px 8px", cursor: notSignedIn ? "default" : "pointer", opacity: notSignedIn ? 0.5 : 1
                          }}>
                            {p.position_type === "short" ? "Buy to close" : "Sell to close"}
                          </button>
                        </td>
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rollTarget && (
            <RollWizard
              position={{
                id: rollTarget.id,
                underlying: rollTarget.underlying,
                strike: rollTarget.strike,
                expiryDays: rollTarget.expiry_days,
                optionType: rollTarget.option_type,
                positionType: rollTarget.position_type,
                contracts: rollTarget.contracts,
                entryPremium: rollTarget.entry_premium,
                strategyId: rollTarget.strategy_id,
                currentPremiumTotal: rollTarget.currentPremium,
              }}
              spot={spots[rollTarget.underlying] ?? rollTarget.spot}
              vol={vols[rollTarget.underlying] ?? 0.5}
              balance={balance}
              chain={rollChain}
              onClose={() => setRollTargetId(null)}
              onRoll={async (id, params) => {
                setActionError(null);
                return roll(id, params);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
