"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { useHistoryStore } from "../../lib/store/history";
import { fmtN, fmtK } from "../../lib/pricing";
import { toCsv, downloadCsv } from "../../lib/csv";
import { ExportButton } from "../../components/ExportButton";

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function HistoryPage() {
  const records = useHistoryStore(s => s.records);

  const stats = useMemo(() => {
    const closed = records.filter(r => r.realizedPnl !== undefined);
    const totalPnl = closed.reduce((s, r) => s + (r.realizedPnl ?? 0), 0);
    const wins = closed.filter(r => (r.realizedPnl ?? 0) > 0).length;
    return {
      closedCount: closed.length,
      totalPnl,
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
    };
  }, [records]);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"var(--bg)",overflow:"hidden",fontFamily:"var(--font-sans)"}}>
      <AppHeader>
        <div style={{marginLeft:"auto"}}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{flex:1,overflowY:"auto"}}>
        <div style={{maxWidth:1080,margin:"0 auto",padding:"32px 24px 64px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <h1 style={{fontFamily:"var(--font-serif)",fontSize:26,fontWeight:600,marginBottom:4}}>Trade History</h1>
              <p style={{fontSize:13,color:"var(--text-mid)",marginBottom:28}}>
                {records.length} record{records.length===1?"":"s"}
              </p>
            </div>
            {records.length>0 && (
              <ExportButton onClick={()=>downloadCsv(
                `zenith-history-${new Date().toISOString().slice(0,10)}.csv`,
                toCsv(records,[
                  {header:"Date",value:r=>new Date(r.timestamp).toISOString()},
                  {header:"Asset",value:r=>r.sym},
                  {header:"Type",value:r=>r.positionType},
                  {header:"Side",value:r=>r.side},
                  {header:"Action",value:r=>r.action},
                  {header:"Strike",value:r=>r.strike},
                  {header:"Expiry",value:r=>r.expiryLabel},
                  {header:"Qty",value:r=>r.contracts},
                  {header:"Premium",value:r=>r.premium},
                  {header:"Realized P&L",value:r=>r.realizedPnl??""},
                ])
              )}/>
            )}
          </div>

          {stats.closedCount>0 && (
            <div style={{display:"flex",gap:0,marginBottom:24,border:"1px solid var(--border-default)",background:"var(--bg-raised)"}}>
              {[
                {label:"Closed Trades", value:String(stats.closedCount), color:"var(--text-hi)"},
                {label:"Total Realized P&L", value:`${stats.totalPnl>=0?"+":"−"}$${fmtN(Math.abs(stats.totalPnl),2)}`, color:stats.totalPnl>=0?"var(--call)":"var(--put)"},
                {label:"Win Rate", value:`${stats.winRate.toFixed(0)}%`, color:"var(--atm)"},
              ].map((s,i)=>(
                <div key={s.label} style={{flex:1,padding:"14px 18px",borderRight:i<2?"1px solid var(--border-default)":"none"}}>
                  <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)",marginBottom:6}}>{s.label}</div>
                  <div className="num" style={{fontSize:17,fontWeight:600,color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {records.length===0 ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              padding:"80px 0",border:"1px solid var(--border-subtle)",background:"var(--bg-raised)",gap:12}}>
              <div style={{fontSize:14,color:"var(--text-mid)"}}>No trades yet</div>
              <Link href="/options" style={{fontSize:13,color:"var(--brand)",textDecoration:"none"}}>
                Open the options chain →
              </Link>
            </div>
          ) : (
            <div style={{border:"1px solid var(--border-default)",background:"var(--bg-raised)",overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:820}}>
                <thead>
                  <tr style={{borderBottom:"1px solid var(--border-default)"}}>
                    {["Date","Asset","Type","Side","Action","Strike","Expiry","Qty","Premium","Realized P&L"].map(h=>(
                      <th key={h} style={{padding:"8px 10px",fontSize:10,fontWeight:500,textTransform:"uppercase",
                        letterSpacing:"0.05em",color:"var(--text-lo)",textAlign:"right",background:"var(--bg-overlay)"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map(r=>(
                    <tr key={r.id} style={{borderBottom:"1px solid var(--border-subtle)"}}>
                      <td style={{padding:"8px 10px",fontSize:11,color:"var(--text-mid)"}}>{fmtDate(r.timestamp)}</td>
                      <td style={{padding:"8px 10px",fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{r.sym}</td>
                      <td style={{padding:"8px 10px"}}>
                        <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                          background:r.positionType==="short"?"var(--put-dim)":"var(--call-dim)",
                          color:r.positionType==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                          {r.positionType}
                        </span>
                      </td>
                      <td style={{padding:"8px 10px"}}>
                        <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                          background:r.side==="call"?"var(--call-dim)":"var(--put-dim)",
                          color:r.side==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                          {r.side}
                        </span>
                      </td>
                      <td style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-mid)",textTransform:"capitalize"}}>{r.action}</td>
                      <td className="num" style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{fmtK(r.strike)}</td>
                      <td style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{r.expiryLabel}</td>
                      <td className="num" style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{r.contracts}</td>
                      <td className="num" style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>${fmtN(r.premium,2)}</td>
                      <td className="num" style={{padding:"8px 10px",fontSize:11,textAlign:"right",fontWeight:600,
                        color:r.realizedPnl===undefined?"var(--text-lo)":r.realizedPnl>=0?"var(--call)":"var(--put)"}}>
                        {r.realizedPnl===undefined?"—":`${r.realizedPnl>=0?"+":"−"}$${fmtN(Math.abs(r.realizedPnl),2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
