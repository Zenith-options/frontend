"use client";

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PayoffDiagram } from "../../components/PayoffDiagram";
import { VolSmile } from "../../components/VolSmile";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { MARKETS, EXPIRIES, bs, smileVol, seededRandom, fmtN, fmtSpot, fmtK, type Greeks } from "../../lib/pricing";
import { usePositionsStore, aggregateGreeks } from "../../lib/store/positions";
import { useAccountStore } from "../../lib/store/account";
import { collateralRequired } from "../../lib/collateral";
import { useHistoryStore } from "../../lib/store/history";

interface ChainRow{strike:number;call:Greeks;put:Greeks;itmCall:boolean;itmPut:boolean;}
interface TradeState{row:ChainRow;side:"call"|"put";mode:"buy"|"write";}

export default function OptionsPage() {
  return (
    <Suspense fallback={null}>
      <OptionsPageContent />
    </Suspense>
  );
}

function OptionsPageContent() {
  const params = useSearchParams();
  const [sym, setSym] = useState(params.get("u")??"XLM");
  const [expiry, setExpiry] = useState(EXPIRIES[2]);
  const [spot, setSpot] = useState(MARKETS.find(m=>m.sym===sym)!.price);
  const [trade, setTrade] = useState<TradeState|null>(null);
  const positions = usePositionsStore(s=>s.positions);
  const addPosition = usePositionsStore(s=>s.addPosition);
  const debit = useAccountStore(s=>s.debit);
  const credit = useAccountStore(s=>s.credit);
  const reserveCollateral = useAccountStore(s=>s.reserveCollateral);
  const addHistoryRecord = useHistoryStore(s=>s.addRecord);
  const balance = useAccountStore(s=>s.balance);
  const [contracts, setContracts] = useState("1");
  const [viewTab, setViewTab] = useState<"chain"|"positions">("chain");
  const prevSpotRef = useRef(spot);

  const market = MARKETS.find(m=>m.sym===sym)??MARKETS[0];
  const t = expiry.days/365;

  useEffect(()=>{
    setSpot(market.price);
    const id=setInterval(()=>{
      setSpot(p=>{prevSpotRef.current=p;return p+(Math.random()-0.5)*0.001*market.price;});
    },1800);
    return ()=>clearInterval(id);
  },[sym,market.price]);

  const chain=useMemo(():ChainRow[]=>{
    return Array.from({length:21},(_,i)=>{
      const n=i-10;
      const strike=Math.round(spot*(1+n*0.04)*10000)/10000;
      const vol=smileVol(market.vol,strike/spot);
      return{strike,call:bs(spot,strike,vol,t,true),put:bs(spot,strike,vol,t,false),
        itmCall:spot>strike,itmPut:spot<strike};
    });
  },[spot,market.vol,t]);

  const atmIdx=chain.findIndex(r=>!r.itmCall);
  const tradeGreeks=trade?(trade.side==="call"?trade.row.call:trade.row.put):null;

  const portGreeks=useMemo(()=>aggregateGreeks(positions),[positions]);

  const qty=Math.max(0.01,parseFloat(contracts)||1);
  const collateral=trade&&trade.mode==="write"?collateralRequired(trade.side,qty,trade.row.strike,spot):0;
  const requiredFunds=trade?(trade.mode==="write"?collateral:(tradeGreeks?.premium??0)*qty):0;
  const insufficientFunds=balance<requiredFunds;

  const execTrade=()=>{
    if(!trade||!tradeGreeks||insufficientFunds)return;
    const totalPremium=tradeGreeks.premium*qty;
    if(trade.mode==="write"){
      if(!reserveCollateral(collateral))return;
      addPosition({
        sym,side:trade.side,positionType:"short",strike:trade.row.strike,
        expiryLabel:expiry.label,expiryDays:expiry.days,
        contracts:qty,entrySpot:spot,premium:totalPremium,collateral,
        delta:tradeGreeks.delta,gamma:tradeGreeks.gamma,theta:tradeGreeks.theta,vega:tradeGreeks.vega,
      });
      credit(totalPremium);
      addHistoryRecord({
        sym,side:trade.side,positionType:"short",action:"open",
        strike:trade.row.strike,expiryLabel:expiry.label,contracts:qty,premium:totalPremium,
      });
    }else{
      addPosition({
        sym,side:trade.side,positionType:"long",strike:trade.row.strike,
        expiryLabel:expiry.label,expiryDays:expiry.days,
        contracts:qty,entrySpot:spot,premium:totalPremium,collateral:0,
        delta:tradeGreeks.delta,gamma:tradeGreeks.gamma,theta:tradeGreeks.theta,vega:tradeGreeks.vega,
      });
      debit(totalPremium);
    }
    setTrade(null);
    setViewTab("positions");
  };

  const priceDir = spot >= prevSpotRef.current;

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"var(--bg)",overflow:"hidden",fontFamily:"var(--font-sans)"}}>

      {/* TOP BAR */}
      <AppHeader>
        <div style={{display:"flex",gap:1}}>
          {MARKETS.map(m=>(
            <button key={m.sym} onClick={()=>setSym(m.sym)} style={{
              padding:"4px 10px",border:"none",cursor:"pointer",
              fontSize:12,fontWeight:600,transition:"all 120ms",
              background:sym===m.sym?"var(--bg-overlay)":"transparent",
              color:sym===m.sym?"var(--text-hi)":"var(--text-mid)",
              borderBottom:sym===m.sym?"2px solid var(--brand)":"2px solid transparent",
            }}>{m.sym}</button>
          ))}
        </div>
        <div style={{width:1,height:20,background:"var(--border-default)"}}/>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span className="num" style={{fontSize:16,fontWeight:600,color:"var(--text-hi)"}}>{fmtSpot(spot)}</span>
          <span className="num" style={{fontSize:12,color:priceDir?"var(--call)":"var(--put)"}}>
            {priceDir?"+":"\u2212"}{Math.abs((spot/market.price-1)*100).toFixed(2)}%
          </span>
          <span style={{fontSize:11,color:"var(--text-lo)"}}>IV {Math.round(market.vol*100)}%</span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4}}>
          {EXPIRIES.map(e=>(
            <button key={e.label} onClick={()=>setExpiry(e)} style={{
              padding:"3px 7px",border:"none",borderRadius:0,cursor:"pointer",fontSize:11,
              background:expiry.label===e.label?"var(--atm-dim)":"transparent",
              color:expiry.label===e.label?"var(--atm)":"var(--text-lo)",
            }}>{e.label}</button>
          ))}
          <div style={{width:1,height:16,background:"var(--border-default)",margin:"0 8px"}}/>
          <WalletConnect />
        </div>
      </AppHeader>

      {/* MAIN */}
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

        {/* LEFT SIDEBAR */}
        <aside style={{width:236,flexShrink:0,borderRight:"1px solid var(--border-default)",
          overflowY:"auto",padding:"14px 12px",display:"flex",flexDirection:"column",gap:18,
          background:"var(--bg-raised)"}}>

          <VolSmile spot={spot} baseVol={market.vol} width={212} height={110}/>

          <div>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--text-lo)",marginBottom:8}}>Market</div>
            {[["Spot",fmtSpot(spot)],["ATM IV",`${Math.round(market.vol*100)}%`],
              ["25Δ Skew","-4.2%"],["OI Calls","$284K"],["OI Puts","$198K"],["P/C Ratio","0.70"]
            ].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",
                borderBottom:"1px solid var(--border-subtle)"}}>
                <span style={{fontSize:11,color:"var(--text-lo)"}}>{k}</span>
                <span className="num" style={{fontSize:11,color:"var(--text-hi)"}}>{v}</span>
              </div>
            ))}
          </div>

          <div>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--text-lo)",marginBottom:8}}>OI by Expiry</div>
            {EXPIRIES.slice(0,4).map((e,i)=>{
              const pct=[42,28,18,12][i];
              return(
                <div key={e.label} style={{marginBottom:6}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                    <span style={{fontSize:10,color:"var(--text-lo)"}}>{e.label}</span>
                    <span className="num" style={{fontSize:10,color:"var(--text-mid)"}}>{pct}%</span>
                  </div>
                  <div style={{height:3,background:"var(--bg-overlay)",borderRadius:0}}>
                    <div style={{width:`${pct}%`,height:"100%",borderRadius:0,background:`rgba(181,150,101,${0.3+pct/100*0.5})`}}/>
                  </div>
                </div>
              );
            })}
          </div>

          {positions.length>0&&(
            <div>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--text-lo)",marginBottom:8}}>Portfolio Greeks</div>
              {[{g:"Δ Net Delta",v:portGreeks.delta,dp:3},{g:"Γ Net Gamma",v:portGreeks.gamma,dp:4},
                {g:"Θ Daily",v:portGreeks.theta,dp:4},{g:"V Vega",v:portGreeks.vega,dp:3}
              ].map(item=>(
                <div key={item.g} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",
                  borderBottom:"1px solid var(--border-subtle)"}}>
                  <span style={{fontSize:10,color:"var(--text-lo)",fontFamily:"var(--font-mono)"}}>{item.g}</span>
                  <span className="num" style={{fontSize:11,
                    color:item.g.includes("Θ")?"var(--put)":item.v>=0?"var(--call)":"var(--put)"}}>
                    {item.v>=0?"+":"\u2212"}{Math.abs(item.v).toFixed(item.dp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* CENTER: CHAIN */}
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",minWidth:0}}>
          <div style={{display:"flex",borderBottom:"1px solid var(--border-default)",padding:"0 8px",background:"var(--bg-raised)"}}>
            {(["chain","positions"] as const).map(tab=>(
              <button key={tab} onClick={()=>setViewTab(tab)} style={{
                padding:"8px 14px",border:"none",background:"transparent",cursor:"pointer",
                fontSize:12,fontWeight:500,textTransform:"capitalize",
                color:viewTab===tab?"var(--text-hi)":"var(--text-lo)",
                borderBottom:viewTab===tab?"2px solid var(--brand)":"2px solid transparent",
                marginBottom:-1,
              }}>{tab}{tab==="positions"&&positions.length>0?` (${positions.length})`:""}</button>
            ))}
            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",paddingRight:4}}>
              <span style={{fontSize:10,color:"var(--text-lo)"}}>{sym}-USD · {expiry.label} · {chain.length} strikes · Click ask to buy, bid to write</span>
            </div>
          </div>

          {viewTab==="chain"&&(
            <div style={{flex:1,overflowY:"auto"}}>
              {/* Headers */}
              <div className="chain-header">
                {["Vol","OI","Bid","Ask","IV"].map(h=><div key={"c"+h} className="ch call">{h}</div>)}
                <div className="ch center">Strike</div>
                {["IV","Ask","Bid","OI","Vol"].map(h=><div key={"p"+h} className="ch put">{h}</div>)}
              </div>

              {chain.map((row,i)=>{
                const isAtm=i===atmIdx;
                const sp=Math.max(0.00001,row.call.premium*0.003);
                const vol=Math.round(seededRandom(row.strike*1000)*200+20);
                const oi=Math.round(seededRandom(row.strike*1000+7)*5000+100);
                return(
                  <div key={row.strike}
                    className={`chain-row${row.itmCall?" itm-call":""}${row.itmPut?" itm-put":""}`}
                    style={{background:isAtm?"var(--atm-dim)":undefined}}>
                    <div className="cc">{vol}</div>
                    <div className="cc">{oi.toLocaleString()}</div>
                    <div className="cc tradeable call" title="Click to write (sell)" onClick={()=>setTrade({row,side:"call",mode:"write"})}>
                      {fmtN(Math.max(0,row.call.premium-sp))}
                    </div>
                    <div className="cc tradeable call" title="Click to buy" onClick={()=>setTrade({row,side:"call",mode:"buy"})}>
                      {fmtN(row.call.premium+sp)}
                    </div>
                    <div className="cc brand">{(row.call.iv*100).toFixed(1)}</div>
                    <div className={`strike-cell${isAtm?" atm":""}`}>
                      {fmtK(row.strike)}
                      {isAtm&&<div style={{fontSize:7,marginTop:1,opacity:0.6}}>ATM</div>}
                    </div>
                    <div className="cc brand">{(row.put.iv*100).toFixed(1)}</div>
                    <div className="cc tradeable put" title="Click to buy" onClick={()=>setTrade({row,side:"put",mode:"buy"})}>
                      {fmtN(row.put.premium+sp)}
                    </div>
                    <div className="cc tradeable put" title="Click to write (sell)" onClick={()=>setTrade({row,side:"put",mode:"write"})}>
                      {fmtN(Math.max(0,row.put.premium-sp))}
                    </div>
                    <div className="cc">{oi.toLocaleString()}</div>
                    <div className="cc">{vol}</div>
                  </div>
                );
              })}
            </div>
          )}

          {viewTab==="positions"&&(
            <div style={{flex:1,overflowY:"auto"}}>
              {positions.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:8}}>
                  <div style={{fontSize:13,color:"var(--text-lo)"}}>No open positions</div>
                  <button onClick={()=>setViewTab("chain")} style={{fontSize:11,color:"var(--brand)",background:"none",border:"none",cursor:"pointer"}}>← Back to chain</button>
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid var(--border-default)"}}>
                      {["Asset","Type","Side","Strike","Expiry","Qty","Δ","Γ","Θ","V",""].map(h=>(
                        <th key={h} style={{padding:"6px 8px",fontSize:10,fontWeight:500,textTransform:"uppercase",
                          letterSpacing:"0.05em",color:"var(--text-lo)",textAlign:"right",background:"var(--bg-raised)"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(pos=>{
                      const sign=pos.positionType==="short"?-1:1;
                      return(
                      <tr key={pos.id} style={{borderBottom:"1px solid var(--border-subtle)"}}>
                        <td style={{padding:"8px",fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{pos.sym}</td>
                        <td style={{padding:"8px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",borderRadius:0,
                            background:pos.positionType==="short"?"var(--put-dim)":"var(--call-dim)",
                            color:pos.positionType==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                            {pos.positionType}
                          </span>
                        </td>
                        <td style={{padding:"8px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",borderRadius:0,
                            background:pos.side==="call"?"var(--call-dim)":"var(--put-dim)",
                            color:pos.side==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                            {pos.side}
                          </span>
                        </td>
                        {[fmtK(pos.strike),pos.expiryLabel,pos.contracts.toFixed(0),
                          (sign*pos.delta*pos.contracts).toFixed(3),(sign*pos.gamma*pos.contracts).toFixed(4),
                          (sign*pos.theta*pos.contracts).toFixed(4),(sign*pos.vega*pos.contracts).toFixed(3)
                        ].map((v,j)=>(
                          <td key={j} className="num" style={{padding:"8px",fontSize:11,textAlign:"right",
                            color:j===5?"var(--put)":"var(--text-hi)"}}>{v}</td>
                        ))}
                        <td style={{padding:"4px 8px",textAlign:"right"}}>
                          <Link href="/portfolio" style={{fontSize:10,color:"var(--brand)",textDecoration:"none"}}>Manage →</Link>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {positions.length>0&&(
            <div style={{height:36,flexShrink:0,borderTop:"1px solid var(--border-default)",
              display:"flex",alignItems:"center",gap:20,padding:"0 16px",background:"var(--bg-raised)"}}>
              <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)"}}>Portfolio</span>
              {[{g:"Net Δ",v:portGreeks.delta,dp:3},{g:"Net Γ",v:portGreeks.gamma,dp:4},
                {g:"Daily Θ",v:portGreeks.theta,dp:4},{g:"Vega",v:portGreeks.vega,dp:3}
              ].map(item=>(
                <div key={item.g} style={{display:"flex",alignItems:"center",gap:5}}>
                  <span style={{fontSize:10,color:"var(--text-lo)"}}>{item.g}</span>
                  <span className="num" style={{fontSize:11,
                    color:item.g.includes("Θ")?"var(--put)":item.v>=0?"var(--call)":"var(--put)"}}>
                    {item.v>=0?"+":"\u2212"}{Math.abs(item.v).toFixed(item.dp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        {trade&&tradeGreeks&&(
          <aside style={{width:316,flexShrink:0,borderLeft:"1px solid var(--border-default)",
            overflowY:"auto",background:"var(--bg-raised)",display:"flex",flexDirection:"column"}}>

            <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border-default)",
              display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",
                  color:trade.side==="call"?"var(--call)":"var(--put)",marginBottom:4}}>
                  {trade.mode==="write"?"WRITE ":"BUY "}{trade.side==="call"?"▲ CALL":"▼ PUT"}
                </div>
                <div style={{fontSize:15,fontWeight:700,color:"var(--text-hi)"}}>
                  {sym} {trade.side==="call"?"Call":"Put"}
                </div>
                <div className="num" style={{fontSize:12,color:"var(--text-mid)"}}>
                  K={fmtK(trade.row.strike)} · {expiry.label}
                </div>
              </div>
              <button onClick={()=>setTrade(null)} style={{background:"none",border:"none",
                color:"var(--text-lo)",fontSize:18,cursor:"pointer",lineHeight:1,padding:4}}>×</button>
            </div>

            {/* Payoff diagram */}
            <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border-default)"}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",
                color:"var(--text-lo)",marginBottom:8}}>P&L at Expiry</div>
              <PayoffDiagram
                spot={spot} strike={trade.row.strike} premium={tradeGreeks.premium}
                isCall={trade.side==="call"} short={trade.mode==="write"} contracts={qty}
                width={284} height={155}
              />
            </div>

            {/* Greeks grid */}
            <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border-default)"}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",
                color:"var(--text-lo)",marginBottom:10}}>Option Greeks</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[{g:"Δ Delta",v:tradeGreeks.delta,dp:3,c:"var(--brand)"},
                  {g:"Γ Gamma",v:tradeGreeks.gamma,dp:4,c:"var(--text-hi)"},
                  {g:"Θ Theta",v:tradeGreeks.theta,dp:4,c:"var(--put)"},
                  {g:"V Vega", v:tradeGreeks.vega, dp:3,c:"var(--atm)"},
                ].map(item=>(
                  <div key={item.g} style={{padding:"9px 10px",borderRadius:0,
                    border:"1px solid var(--border-default)",background:"var(--bg-elevated)"}}>
                    <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",
                      color:"var(--text-lo)",marginBottom:4}}>{item.g}</div>
                    <div className="num" style={{fontSize:14,fontWeight:600,color:item.c}}>
                      {item.v>=0?"+":"\u2212"}{Math.abs(item.v).toFixed(item.dp)}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:6,marginTop:6}}>
                {[{label:"Premium",v:`$${fmtN(tradeGreeks.premium)}`,c:"var(--text-hi)"},
                  {label:"Impl. Vol",v:`${(tradeGreeks.iv*100).toFixed(1)}%`,c:"var(--brand)"},
                ].map(item=>(
                  <div key={item.label} style={{flex:1,padding:"9px 10px",borderRadius:0,
                    border:"1px solid var(--border-default)",background:"var(--bg-elevated)"}}>
                    <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",
                      color:"var(--text-lo)",marginBottom:4}}>{item.label}</div>
                    <div className="num" style={{fontSize:14,fontWeight:600,color:item.c}}>{item.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Order entry */}
            <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border-default)"}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",
                color:"var(--text-lo)",marginBottom:8}}>Order</div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:10,color:"var(--text-lo)",marginBottom:4}}>Contracts</div>
                <div style={{display:"flex",alignItems:"center",
                  background:"var(--bg-overlay)",border:"1px solid var(--border-default)",
                  borderRadius:0,overflow:"hidden"}}>
                  <button onClick={()=>setContracts(c=>String(Math.max(0.01,(parseFloat(c)||1)-1)))}
                    style={{width:36,height:40,border:"none",background:"none",color:"var(--text-mid)",fontSize:18,cursor:"pointer"}}>−</button>
                  <input type="number" min="0.01" step="0.01" value={contracts}
                    onChange={e=>setContracts(e.target.value)}
                    onBlur={e=>setContracts(String(Math.max(0.01,parseFloat(e.target.value)||1)))}
                    style={{flex:1,height:40,border:"none",background:"none",textAlign:"center",
                      fontFamily:"var(--font-mono)",fontSize:16,color:"var(--text-hi)",outline:"none"}}/>
                  <button onClick={()=>setContracts(c=>String((parseFloat(c)||0)+1))}
                    style={{width:36,height:40,border:"none",background:"none",color:"var(--text-mid)",fontSize:18,cursor:"pointer"}}>+</button>
                </div>
              </div>
              <div style={{background:"var(--bg-elevated)",borderRadius:0,padding:"9px 12px",marginBottom:10}}>
                {(trade.mode==="write"?[
                  ["Qty",`${contracts} × ${sym}`],
                  ["Premium received",`+$${fmtN(tradeGreeks.premium*qty)}`],
                  ["Collateral required",`$${fmtN(collateral)}`],
                  ["Available balance",`$${fmtN(balance,2)}`],
                ]:[
                  ["Qty",`${contracts} × ${sym}`],
                  ["Total premium",`$${fmtN(tradeGreeks.premium*qty)}`],
                  ["Max loss",`$${fmtN(tradeGreeks.premium*qty)}`],
                  ["Available balance",`$${fmtN(balance,2)}`],
                ]).map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                    <span style={{fontSize:11,color:"var(--text-lo)"}}>{k}</span>
                    <span className="num" style={{fontSize:11,
                      color:k==="Premium received"?"var(--call)":"var(--text-hi)"}}>{v}</span>
                  </div>
                ))}
                {insufficientFunds&&(
                  <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid var(--border-default)",
                    fontSize:11,color:"var(--put)"}}>
                    Insufficient balance {trade.mode==="write"?"to post collateral":"to cover premium"}.
                  </div>
                )}
              </div>
              <button onClick={execTrade} disabled={insufficientFunds} style={{width:"100%",height:44,borderRadius:0,border:"none",
                cursor:insufficientFunds?"default":"pointer",fontSize:14,fontWeight:700,
                opacity:insufficientFunds?0.5:1,
                background:trade.side==="call"?"var(--call)":"var(--put)",color:"var(--bg)"}}>
                {trade.mode==="write"?"Write":"Buy"} {trade.side.toUpperCase()} @ {fmtK(trade.row.strike)}
              </button>
            </div>

            <div style={{padding:"14px 16px"}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)",marginBottom:8}}>
                Strategies using this strike
              </div>
              {(trade.side==="call"
                ?["Covered Call — sell this call against stock","Bull Call Spread — buy this, sell higher strike","Long Call — pure directional bet"]
                :["Protective Put — hedge long exposure","Bear Put Spread — buy this, sell lower strike","Cash-Secured Put — sell this for income"]
              ).map(s=>(
                <div key={s} style={{padding:"7px 0",borderBottom:"1px solid var(--border-subtle)",fontSize:11,color:"var(--text-mid)",cursor:"pointer",transition:"color 100ms"}}
                  onMouseOver={e=>{(e.currentTarget as HTMLElement).style.color="var(--text-hi)"}}
                  onMouseOut={e=>{(e.currentTarget as HTMLElement).style.color="var(--text-mid)"}}>
                  → {s}
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* STATUS BAR */}
      <div style={{height:26,flexShrink:0,borderTop:"1px solid var(--border-subtle)",
        display:"flex",alignItems:"center",gap:16,padding:"0 16px",background:"var(--bg)"}}>
        <span style={{fontSize:10,color:"var(--text-lo)"}}>
          Black-Scholes · r=5.0% · Vol smile applied · {chain.length} strikes
        </span>
        <span style={{fontSize:10,color:"var(--text-lo)"}}>·</span>
        <span style={{fontSize:10,color:"var(--text-lo)"}}>Click an <b>ask</b> to buy, a <b>bid</b> to write (sell) and collect premium</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:"var(--call)",opacity:0.8}}/>
          <span style={{fontSize:10,color:"var(--text-lo)"}}>Live · Stellar Testnet</span>
        </div>
      </div>
    </div>
  );
}
