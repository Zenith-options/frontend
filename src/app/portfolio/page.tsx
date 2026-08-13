"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { usePositionsStore, aggregateGreeks, type Position } from "../../lib/store/positions";
import { useAccountStore } from "../../lib/store/account";
import { useHistoryStore } from "../../lib/store/history";
import { MARKETS, bs, smileVol, fmtN } from "../../lib/pricing";
import { toCsv, downloadCsv } from "../../lib/csv";
import { ExportButton } from "../../components/ExportButton";

interface Marked extends Position {
  spot: number;
  tRemaining: number;
  currentPremium: number;
  pnl: number;
  pnlPct: number;
  liveDelta: number;
  liveGamma: number;
  liveTheta: number;
  liveVega: number;
}

export default function PortfolioPage() {
  const positions = usePositionsStore(s => s.positions);
  const closePosition = usePositionsStore(s => s.closePosition);
  const balance = useAccountStore(s => s.balance);
  const collateralLocked = useAccountStore(s => s.collateralLocked);
  const releaseCollateral = useAccountStore(s => s.releaseCollateral);
  const credit = useAccountStore(s => s.credit);
  const debit = useAccountStore(s => s.debit);
  const addHistoryRecord = useHistoryStore(s => s.addRecord);

  // Tick every underlying's spot so open positions can be marked-to-market live,
  // same random-walk model the chain page uses.
  const [spots, setSpots] = useState<Record<string, number>>(() =>
    Object.fromEntries(MARKETS.map(m => [m.sym, m.price]))
  );
  useEffect(() => {
    const id = setInterval(() => {
      setSpots(prev => {
        const next = { ...prev };
        for (const m of MARKETS) next[m.sym] = Math.max(0.0001, next[m.sym] + (Math.random() - 0.5) * 0.001 * m.price);
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const marked = useMemo<Marked[]>(() => positions.map(p => {
    const market = MARKETS.find(m => m.sym === p.sym) ?? MARKETS[0];
    const spot = spots[p.sym] ?? market.price;
    const tRemaining = Math.max(0, (p.expiresAt - Date.now()) / (365 * 86_400_000));
    const vol = smileVol(market.vol, p.strike / spot);
    const g = bs(spot, p.strike, vol, tRemaining, p.side === "call");
    const currentPremium = g.premium * p.contracts;
    // Long: profit when current value rises above what was paid.
    // Short: profit when it costs less than the premium collected to close it out.
    const pnl = p.positionType === "short" ? p.premium - currentPremium : currentPremium - p.premium;
    return {
      ...p, spot, tRemaining, currentPremium, pnl,
      pnlPct: p.premium > 0 ? (pnl / p.premium) * 100 : 0,
      liveDelta: g.delta, liveGamma: g.gamma, liveTheta: g.theta, liveVega: g.vega,
    };
  }), [positions, spots]);

  const totalPnl = useMemo(() => marked.reduce((s, p) => s + p.pnl, 0), [marked]);

  const strategyGroups = useMemo(() => {
    const byId = new Map<string, Marked[]>();
    for (const p of marked) {
      if (!p.strategyId) continue;
      if (!byId.has(p.strategyId)) byId.set(p.strategyId, []);
      byId.get(p.strategyId)!.push(p);
    }
    return Array.from(byId.entries()).map(([id, legs]) => ({
      id, legs,
      sym: legs[0].sym,
      totalPnl: legs.reduce((s, l) => s + l.pnl, 0),
      totalCollateral: legs.reduce((s, l) => s + l.collateral, 0),
    }));
  }, [marked]);

  const soloPositions = useMemo(() => marked.filter(p => !p.strategyId), [marked]);

  const netGreeks = useMemo(() => aggregateGreeks(
    marked.map(p => ({ ...p, delta: p.liveDelta, gamma: p.liveGamma, theta: p.liveTheta, vega: p.liveVega }))
  ), [marked]);

  // Realize the position's P&L into the account balance and release any
  // collateral, then remove it. This is the one place a position actually
  // settles — the quick view on the chain page just links here.
  const handleClose = (p: Marked) => {
    if (p.positionType === "short") {
      releaseCollateral(p.collateral);
      debit(p.currentPremium);
    } else {
      credit(p.currentPremium);
    }
    addHistoryRecord({
      sym: p.sym, side: p.side, positionType: p.positionType, action: "close",
      strike: p.strike, expiryLabel: p.expiryLabel, contracts: p.contracts,
      premium: p.currentPremium, realizedPnl: p.pnl,
    });
    closePosition(p.id);
  };

  const handleCloseStrategy = (legs: Marked[]) => {
    for (const leg of legs) handleClose(leg);
  };

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
                {positions.length} open position{positions.length===1?"":"s"} · live premium repriced off current spot
              </p>
            </div>
            {marked.length>0 && (
              <ExportButton onClick={()=>downloadCsv(
                `zenith-positions-${new Date().toISOString().slice(0,10)}.csv`,
                toCsv(marked,[
                  {header:"Asset",value:p=>p.sym},
                  {header:"Type",value:p=>p.positionType},
                  {header:"Side",value:p=>p.side},
                  {header:"Strike",value:p=>p.strike},
                  {header:"Expiry",value:p=>p.expiryLabel},
                  {header:"Qty",value:p=>p.contracts},
                  {header:"Collateral",value:p=>p.collateral},
                  {header:"Entry Premium",value:p=>p.premium},
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
                      <span style={{color:leg.positionType==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                        {leg.positionType} {leg.side}
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
                    const expired = p.tRemaining<=0;
                    const sign = p.positionType==="short"?-1:1;
                    return (
                      <tr key={p.id} style={{borderBottom:"1px solid var(--border-subtle)"}}>
                        <td style={{padding:"10px",fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{p.sym}</td>
                        <td style={{padding:"10px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                            background:p.positionType==="short"?"var(--put-dim)":"var(--call-dim)",
                            color:p.positionType==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                            {p.positionType}
                          </span>
                        </td>
                        <td style={{padding:"10px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                            background:p.side==="call"?"var(--call-dim)":"var(--put-dim)",
                            color:p.side==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                            {p.side}
                          </span>
                        </td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{p.strike>=1000?p.strike.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):p.strike.toFixed(4)}</td>
                        <td style={{padding:"10px",fontSize:11,textAlign:"right",color:expired?"var(--put)":"var(--text-mid)"}}>{expired?"Expired":p.expiryLabel}</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{p.contracts}</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{p.collateral>0?`$${fmtN(p.collateral,2)}`:"—"}</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>
                          {p.positionType==="short"?"+":""}${fmtN(p.premium,2)}
                        </td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>${fmtN(p.currentPremium,2)}</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",fontWeight:600,color:p.pnl>=0?"var(--call)":"var(--put)"}}>
                          {p.pnl>=0?"+":"−"}${fmtN(Math.abs(p.pnl),2)} <span style={{opacity:0.6}}>({p.pnlPct>=0?"+":""}{p.pnlPct.toFixed(1)}%)</span>
                        </td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{(sign*p.liveDelta*p.contracts).toFixed(3)}</td>
                        <td style={{padding:"6px 10px",textAlign:"right"}}>
                          <button onClick={()=>handleClose(p)} style={{
                            fontSize:10,color:"var(--text-lo)",background:"none",border:"1px solid var(--border-default)",
                            padding:"2px 8px",cursor:"pointer"}}>
                            {p.positionType==="short"?"Buy to close":"Sell to close"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
