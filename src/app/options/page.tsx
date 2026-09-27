"use client";

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PayoffDiagram } from "../../components/PayoffDiagram";
import { VolSmile } from "../../components/VolSmile";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { MARKETS, EXPIRIES, bs, smileVol, seededRandom, fmtN, fmtSpot, fmtK, type Greeks } from "../../lib/pricing";
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
import { BottomSheet } from "../../components/BottomSheet";
import { ExpandableCard } from "../../components/ExpandableCard";
import { OrderTicket } from "../../components/OrderTicket";
import { useIsCompact } from "../../lib/useMediaQuery";

interface ChainRow{strike:number;call:Greeks;put:Greeks;itmCall:boolean;itmPut:boolean;}
interface TradeState{row:ChainRow;side:"call"|"put";mode:"buy"|"write";}

type ChainColKey = "vol"|"oi"|"bid"|"ask"|"iv";
interface CompactCol{key:ChainColKey;label:string;mode?:"buy"|"write";tradeable?:boolean;}

// Column order for the compact (single-side) chain. Mirrors the desktop
// reading direction of each side — calls are Vol · OI · Bid · Ask · IV and
// puts are their mirror image — but the strike is always the sticky left
// anchor, so either side fits a 375px screen with no horizontal page scroll.
const COMPACT_COLS:Record<"call"|"put",CompactCol[]> = {
  call:[
    {key:"vol",label:"Vol"},
    {key:"oi", label:"OI"},
    {key:"bid",label:"Bid",mode:"write",tradeable:true},
    {key:"ask",label:"Ask",mode:"buy",  tradeable:true},
    {key:"iv", label:"IV"},
  ],
  put:[
    {key:"iv", label:"IV"},
    {key:"ask",label:"Ask",mode:"buy",  tradeable:true},
    {key:"bid",label:"Bid",mode:"write",tradeable:true},
    {key:"oi", label:"OI"},
    {key:"vol",label:"Vol"},
  ],
};

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
  // Live from the shared WebSocket feed (SpotFeedProvider, mounted at
  // the root) — null until the first message arrives or if the socket's
  // still reconnecting, in which case the static seed constants below
  // are what render instead.
  const { data: spotData } = useSpotFeedContext();
  const [trade, setTrade] = useState<TradeState|null>(null);
  const [showTradeConfirm, setShowTradeConfirm] = useState(false);
  const [tradeError, setTradeError] = useState<string|null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useHydrated();
  const token = useWalletStore(s=>s.token);
  const {account,positions:backendPositions,greeks:portGreeks,watchlist,
    open:openBackendPosition,openStrategy:openBackendStrategy} = useBackendData();
  const favorites = useMemo(()=>watchlist.map(w=>w.underlying),[watchlist]);
  const balance = account?.balance ?? 0;
  const market = MARKETS.find(m=>m.sym===sym)??MARKETS[0];
  const spot = spotData?.prices[sym] ?? market.price;
  const vol = spotData?.vols[sym] ?? market.vol;
  const priceHistory = usePriceHistory(sym, spot);
  const [contracts, setContracts] = useState("1");
  const [viewTab, setViewTab] = useState<"chain"|"positions"|"strategies"|"surface">("chain");
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyTemplate|null>(null);
  const [showStrategyConfirm, setShowStrategyConfirm] = useState(false);
  const prevSpotRef = useRef(spot);

  // Compact terminal (phones + tablets in portrait): the chain shows a single
  // side behind a Call/Put toggle, the sidebar folds into a collapsible market
  // panel, and the ticket is presented as a bottom sheet. `false` until after
  // hydration, so the server/desktop markup is what renders first.
  const isCompact = useIsCompact();
  const [chainSide, setChainSide] = useState<"call"|"put">("call");
  const compactChainRef = useRef<HTMLDivElement|null>(null);
  const autoScrolledRef = useRef("");

  const t = expiry.days/365;

  // Standard "previous value" pattern: this effect runs after the
  // render that already shows the current `spot`, so the ref always
  // holds what was rendered last time — which is exactly what
  // `priceDir` below needs to compare against.
  useEffect(()=>{
    prevSpotRef.current=spot;
  },[spot]);

  // Backend's expiry list happens to be the same across every underlying
  // (it's not derived from anything symbol-specific yet), but fetching
  // per-symbol anyway keeps this correct if that ever changes, and
  // matches how spot/chain are already fetched per-symbol.
  const [expiries,setExpiries]=useState(EXPIRIES);
  useEffect(()=>{
    let cancelled=false;
    getExpiryCalendar(sym).then(cal=>{
      if(cancelled)return;
      setExpiries(cal.expiries.map(e=>({label:e.label,days:e.days_to_expiry})));
    }).catch(()=>{/* keep showing the local EXPIRIES fallback */});
    return ()=>{cancelled=true;};
  },[sym]);

  const sortedMarkets=useMemo(()=>{
    if(!hydrated)return MARKETS; // matches SSR order until this component's own mount effect fires
    return [...MARKETS].sort((a,b)=>{
      const aFav=favorites.includes(a.sym),bFav=favorites.includes(b.sym);
      return aFav===bFav?0:aFav?-1:1;
    });
  },[favorites,hydrated]);

  const [chain,setChain]=useState<ChainRow[]>([]);
  const [chainLoading,setChainLoading]=useState(true);

  useEffect(()=>{
    let cancelled=false;
    setChainLoading(true);
    getChain(sym,expiry.days).then(entries=>{
      if(cancelled)return;
      setChain(entries.map(e=>({
        strike:e.strike,
        call:{premium:e.call.premium,delta:e.call.delta,gamma:e.call.gamma,theta:e.call.theta,vega:e.call.vega,iv:e.call.iv},
        put:{premium:e.put.premium,delta:e.put.delta,gamma:e.put.gamma,theta:e.put.theta,vega:e.put.vega,iv:e.put.iv},
        itmCall:e.is_itm_call,itmPut:e.is_itm_put,
      })));
    }).catch(()=>{
      // Backend unreachable — fall back to the local Black-Scholes calc
      // so the chain still renders something usable.
      if(cancelled)return;
      setChain(Array.from({length:21},(_,i)=>{
        const n=i-10;
        const strike=Math.round(spot*(1+n*0.04)*10000)/10000;
        const v=smileVol(vol,strike/spot);
        return{strike,call:bs(spot,strike,v,t,true),put:bs(spot,strike,v,t,false),
          itmCall:spot>strike,itmPut:spot<strike};
      }));
    }).finally(()=>{if(!cancelled)setChainLoading(false);});
    return ()=>{cancelled=true;};
    // Deliberately not re-fetching on every spot tick (every 2s) — the
    // chain refreshes on its own 4s interval below instead, so premiums
    // update visibly without refetching/re-rendering 21 rows twice a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sym,expiry.days]);

  useEffect(()=>{
    const id=setInterval(()=>{
      getChain(sym,expiry.days).then(entries=>{
        setChain(entries.map(e=>({
          strike:e.strike,
          call:{premium:e.call.premium,delta:e.call.delta,gamma:e.call.gamma,theta:e.call.theta,vega:e.call.vega,iv:e.call.iv},
          put:{premium:e.put.premium,delta:e.put.delta,gamma:e.put.gamma,theta:e.put.theta,vega:e.put.vega,iv:e.put.iv},
          itmCall:e.is_itm_call,itmPut:e.is_itm_put,
        })));
      }).catch(()=>{/* keep showing the last known chain */});
    },4000);
    return ()=>clearInterval(id);
  },[sym,expiry.days]);

  // Backend positions don't store per-position Greeks (only the entry
  // premium/spot) — GET /api/v1/portfolio/greeks gives the aggregate, but
  // the per-row columns in the table below need a live figure for each
  // position individually, so this recomputes them the same way
  // /api/v1/portfolio/greeks does server-side: reprice at current
  // spot/vol for that position's own underlying, same static
  // expiry_days-as-t simplification the backend uses for closing.
  const positionLiveGreeks=(pos:{underlying:string;strike:number;expiry_days:number;option_type:"call"|"put"})=>{
    const posSpot=spotData?.prices[pos.underlying]
      ?? MARKETS.find(m=>m.sym===pos.underlying)?.price ?? spot;
    const posVol=spotData?.vols[pos.underlying]
      ?? MARKETS.find(m=>m.sym===pos.underlying)?.vol ?? vol;
    const posT=pos.expiry_days/365;
    const v=smileVol(posVol,pos.strike/posSpot);
    return bs(posSpot,pos.strike,v,posT,pos.option_type==="call");
  };

  const atmIdx=chain.findIndex(r=>!r.itmCall);
  const tradeGreeks=trade?(trade.side==="call"?trade.row.call:trade.row.put):null;

  const qty=Math.max(0.01,parseFloat(contracts)||1);

  // Strategy leg pricing still uses the local bs()/smileVol() calc (with
  // the static seed vol, not the live-polled one) rather than a backend
  // round trip per leg — out of scope for this pass, which only moved
  // the chain table and spot ticker over. Premiums here won't always
  // match a leg's corresponding chain row exactly once vol has drifted
  // from its seed value.
  const pricedLegs=useMemo(():PricedLeg[]=>{
    if(!selectedStrategy)return[];
    return selectedStrategy.legs.map(leg=>{
      const strike=Math.round(spot*leg.strikeOffset*10000)/10000;
      const legVol=smileVol(market.vol,leg.strikeOffset);
      const greeks=bs(spot,strike,legVol,t,leg.side==="call");
      return{side:leg.side,action:leg.action,strike,contracts:qty,greeks};
    });
  },[selectedStrategy,spot,market.vol,t,qty]);

  const strategyNetPremium=useMemo(()=>netPremium(pricedLegs),[pricedLegs]);
  const strategyCollateral=useMemo(()=>pricedLegs.reduce((sum,leg)=>
    leg.action==="sell"?sum+collateralRequired(leg.side,leg.contracts,leg.strike,spot):sum,0
  ),[pricedLegs,spot]);
  const strategyRequiredFunds=strategyCollateral+Math.max(0,strategyNetPremium);
  const strategyInsufficientFunds=pricedLegs.length>0&&balance<strategyRequiredFunds;
  const collateral=trade&&trade.mode==="write"?collateralRequired(trade.side,qty,trade.row.strike,spot):0;
  const requiredFunds=trade?(trade.mode==="write"?collateral:(tradeGreeks?.premium??0)*qty):0;
  const insufficientFunds=balance<requiredFunds;
  const notSignedIn=!token;

  const execTrade=async()=>{
    if(!trade||!tradeGreeks||insufficientFunds||submitting)return;
    setSubmitting(true);
    setTradeError(null);
    try{
      await openBackendPosition({
        underlying:sym,strike:trade.row.strike,expiryDays:expiry.days,
        optionType:trade.side,positionType:trade.mode==="write"?"short":"long",contracts:qty,
      });
      setTrade(null);
      setShowTradeConfirm(false);
      setViewTab("positions");
    }catch(err){
      setTradeError(err instanceof ApiError?err.message:"Failed to open position");
    }finally{
      setSubmitting(false);
    }
  };

  const execStrategy=async()=>{
    if(!selectedStrategy||pricedLegs.length===0||strategyInsufficientFunds||submitting)return;
    setSubmitting(true);
    setTradeError(null);
    try{
      await openBackendStrategy(pricedLegs.map(leg=>({
        underlying:sym,strike:leg.strike,expiryDays:expiry.days,
        optionType:leg.side,positionType:leg.action==="buy"?"long":"short",contracts:leg.contracts,
      })));
      setSelectedStrategy(null);
      setShowStrategyConfirm(false);
      setViewTab("positions");
    }catch(err){
      setTradeError(err instanceof ApiError?err.message:"Failed to execute strategy");
    }finally{
      setSubmitting(false);
    }
  };

  const priceDir = spot >= prevSpotRef.current;

  // Compact chain: park the ATM strike mid-viewport when a symbol/expiry
  // loads. The desktop table shows all 21 strikes at once; a phone shows ~8,
  // so scrolling to the money is the sensible default. The key guard keeps the
  // 4s premium refresh from yanking the user's scroll position.
  useEffect(()=>{
    if(!isCompact||viewTab!=="chain")return;
    const el=compactChainRef.current;
    if(!el||chain.length===0)return;
    const key=`${sym}|${expiry.days}|${chainSide}|${chain.length}`;
    if(autoScrolledRef.current===key)return;
    const atm=el.querySelector('[data-atm="true"]') as HTMLElement|null;
    if(!atm)return;
    autoScrolledRef.current=key;
    const top=atm.getBoundingClientRect().top-el.getBoundingClientRect().top+el.scrollTop;
    el.scrollTop=Math.max(0,top-(el.clientHeight-atm.clientHeight)/2);
  },[isCompact,viewTab,chainSide,chain,sym,expiry.days]);

  const compactColValue=(row:ChainRow,key:ChainColKey,sp:number,vol:number,oi:number)=>{
    const g=chainSide==="call"?row.call:row.put;
    switch(key){
      case "vol": return String(vol);
      case "oi":  return oi.toLocaleString();
      case "iv":  return (g.iv*100).toFixed(1);
      case "bid": return fmtN(Math.max(0,g.premium-sp));
      case "ask": return fmtN(g.premium+sp);
    }
  };

  // Sidebar content — rendered as the desktop <aside> or, on compact screens,
  // inside a collapsible market panel. Single source either way.
  const marketPanel=(
    <>
      <SpotPriceChart history={priceHistory} width={212} height={70}/>

      <VolSmile baseVol={vol} width={212} height={110}/>

      <AlertsPanel sym={sym} spot={spot}/>

      <div>
        <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--text-lo)",marginBottom:8}}>Market</div>
        {[["Spot",fmtSpot(spot)],["ATM IV",`${Math.round(vol*100)}%`],
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

      {hydrated&&backendPositions.length>0&&(
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
    </>
  );

  return (
    <div className="zn-shell" style={{display:"flex",flexDirection:"column",background:"var(--bg)",fontFamily:"var(--font-sans)"}}>

      {/* TOP BAR */}
      <AppHeader>
        <div className="hdr-markets" style={{display:"flex",gap:1}}>
          {sortedMarkets.map(m=>(
            <div key={m.sym} style={{display:"flex",alignItems:"center",
              background:sym===m.sym?"var(--bg-overlay)":"transparent",
              borderBottom:sym===m.sym?"2px solid var(--brand)":"2px solid transparent"}}>
              <button onClick={()=>setSym(m.sym)} className="zn-tap" style={{
                padding:"4px 4px 4px 10px",border:"none",background:"none",cursor:"pointer",
                fontSize:12,fontWeight:600,transition:"all 120ms",
                color:sym===m.sym?"var(--text-hi)":"var(--text-mid)",
              }}>{m.sym}</button>
              <StarButton sym={m.sym}/>
            </div>
          ))}
        </div>
        <div className="wide-only" style={{width:1,height:20,background:"var(--border-default)"}}/>
        <div className="hdr-spot" style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span className="num" style={{fontSize:16,fontWeight:600,color:"var(--text-hi)"}}>{fmtSpot(spot)}</span>
          <span className="num" style={{fontSize:12,color:priceDir?"var(--call)":"var(--put)"}}>
            {priceDir?"+":"\u2212"}{Math.abs((spot/market.price-1)*100).toFixed(2)}%
          </span>
          <span style={{fontSize:11,color:"var(--text-lo)"}}>IV {Math.round(vol*100)}%</span>
        </div>
        <div className="hdr-alt" style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4}}>
          {expiries.map(e=>(
            <button key={e.label} onClick={()=>setExpiry(e)} className="zn-tap" style={{
              padding:"3px 7px",border:"none",borderRadius:0,cursor:"pointer",fontSize:11,
              background:expiry.label===e.label?"var(--atm-dim)":"transparent",
              color:expiry.label===e.label?"var(--atm)":"var(--text-lo)",
            }}>{e.label}</button>
          ))}
          <div className="wide-only" style={{width:1,height:16,background:"var(--border-default)",margin:"0 8px"}}/>
          <WalletConnect />
        </div>
      </AppHeader>

      {/* MAIN */}
      <div className="zn-main">

        {/* LEFT SIDEBAR — desktop only; below 1024px the same content lives in
            the collapsible "Market" card at the top of the center column. */}
        {!isCompact&&(
        <aside style={{width:236,flexShrink:0,borderRight:"1px solid var(--border-default)",
          overflowY:"auto",padding:"14px 12px",display:"flex",flexDirection:"column",gap:18,
          background:"var(--bg-raised)"}}>
          {marketPanel}
        </aside>
        )}
        {/* CENTER: CHAIN */}
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",minWidth:0}}>
          <div className="zn-tabbar">
            {(["chain","positions","strategies","surface"] as const).map(tab=>(
              <button key={tab} onClick={()=>setViewTab(tab)} style={{
                padding:"8px 14px",border:"none",background:"transparent",cursor:"pointer",
                fontSize:12,fontWeight:500,textTransform:"capitalize",
                color:viewTab===tab?"var(--text-hi)":"var(--text-lo)",
                borderBottom:viewTab===tab?"2px solid var(--brand)":"2px solid transparent",
                marginBottom:-1,
              }}>{tab}{tab==="positions"&&hydrated&&backendPositions.length>0?` (${backendPositions.length})`:""}</button>
            ))}
            <div className="wide-only" style={{marginLeft:"auto",display:"flex",alignItems:"center",paddingRight:4}}>
              <span style={{fontSize:10,color:"var(--text-lo)"}}>{sym}-USD · {expiry.label} · {chain.length} strikes · Click ask to buy, bid to write</span>
            </div>
          </div>

          {viewTab==="chain"&&(<>
            {/* Compact: the sidebar content, folded into one collapsible card. */}
            {isCompact&&(
              <div className="zn-market-card">
                <ExpandableCard
                  title={<span style={{fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>Market · Alerts · Greeks</span>}
                  subtitle={<span className="num">{fmtSpot(spot)} · IV {Math.round(vol*100)}%</span>}
                  details={<div style={{display:"flex",flexDirection:"column",gap:18}}>{marketPanel}</div>}
                />
              </div>
            )}

            {/* Compact: Call/Put toggle — one side of the chain at a time. */}
            {isCompact&&(
              <div className="zn-segmented" role="group" aria-label="Option side">
                {(["call","put"] as const).map(side=>(
                  <button key={side} type="button" aria-pressed={chainSide===side}
                    className={side==="call"?"is-call":"is-put"}
                    onClick={()=>setChainSide(side)}>
                    {side==="call"?"Calls \u25B2":"Puts \u25BC"}
                  </button>
                ))}
              </div>
            )}

            <div ref={compactChainRef} className="zn-scroll zn-no-scrollbar">
              {chainLoading&&chain.length===0?(
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",fontSize:12,color:"var(--text-lo)"}}>
                  Loading chain…
                </div>
              ):isCompact?(<>
              {/* Compact: strike (sticky) + the active side's five columns. */}
              <div className="chain-compact">
                <div className="chain-header chain-header-tall">
                  <div className="ch center">Strike</div>
                  {COMPACT_COLS[chainSide].map(col=>(
                    <div key={col.key} className={`ch ${chainSide==="call"?"call":"put"}`}>{col.label}</div>
                  ))}
                </div>

                {chain.map((row,i)=>{
                  const isAtm=i===atmIdx;
                  const sp=Math.max(0.00001,row.call.premium*0.003);
                  const vol=Math.round(seededRandom(row.strike*1000)*200+20);
                  const oi=Math.round(seededRandom(row.strike*1000+7)*5000+100);
                  return(
                    <div key={row.strike}
                      data-atm={isAtm?"true":undefined}
                      className={`chain-row chain-row-tall${row.itmCall?" itm-call":""}${row.itmPut?" itm-put":""}`}
                      style={{background:isAtm?"var(--atm-dim)":undefined}}>
                      <div className={`strike-cell${isAtm?" atm":""}`}>
                        {fmtK(row.strike)}
                        {isAtm&&<div style={{fontSize:7,marginTop:1,opacity:0.6}}>ATM</div>}
                      </div>
                      {COMPACT_COLS[chainSide].map(col=>{
                        const text=compactColValue(row,col.key,sp,vol,oi);
                        if(!col.tradeable){
                          return <div key={col.key} className={`cc${col.key==="iv"?" brand":""}`}>{text}</div>;
                        }
                        const openTicket=()=>setTrade({row,side:chainSide,mode:col.mode!});
                        const label=col.mode==="buy"?`Buy ${chainSide} at ${text}`:`Write ${chainSide} at ${text}`;
                        return(
                          <div key={col.key} className={`cc tradeable ${chainSide}`}
                            role="button" tabIndex={0} aria-label={label}
                            title={col.mode==="buy"?"Tap to buy":"Tap to write (sell)"}
                            onClick={openTicket}
                            onKeyDown={e=>{
                              if(e.key==="Enter"||e.key===" "){e.preventDefault();openTicket();}
                            }}>
                            {text}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              </>):(<>
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
              </>)}
            </div>
          </>)}

          {viewTab==="positions"&&(
            <div className="zn-scroll zn-no-scrollbar">
              {backendPositions.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:8}}>
                  <div style={{fontSize:13,color:"var(--text-lo)"}}>No open positions</div>
                  <button onClick={()=>setViewTab("chain")} className="zn-tap" style={{fontSize:11,color:"var(--brand)",background:"none",border:"none",cursor:"pointer"}}>← Back to chain</button>
                </div>
              ):isCompact?(
                // Compact: one expandable card per position — the essentials
                // (asset, side/type, strike, size, net delta) stay on the card
                // face, the remaining greeks live in the expanded body.
                <div style={{padding:8}}>
                  {backendPositions.map(pos=>{
                    const sign=pos.position_type==="short"?-1:1;
                    const g=positionLiveGreeks(pos);
                    return(
                      <ExpandableCard key={pos.id}
                        title={<>
                          <span style={{fontSize:13,fontWeight:600,color:"var(--text-hi)"}}>{pos.underlying}</span>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                            background:pos.position_type==="short"?"var(--put-dim)":"var(--call-dim)",
                            color:pos.position_type==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                            {pos.position_type}
                          </span>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                            background:pos.option_type==="call"?"var(--call-dim)":"var(--put-dim)",
                            color:pos.option_type==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                            {pos.option_type}
                          </span>
                        </>}
                        subtitle={<span className="num">K={fmtK(pos.strike)} · {pos.expiry_days}D · {pos.contracts.toFixed(0)}×</span>}
                        trailing={<span className="num" style={{fontSize:13,fontWeight:600,color:"var(--text-hi)"}}>
                          {(sign*g.delta*pos.contracts).toFixed(3)}
                        </span>}
                        details={<>
                          {([["Delta",(sign*g.delta*pos.contracts).toFixed(3),"var(--text-hi)"],
                            ["Gamma",(sign*g.gamma*pos.contracts).toFixed(4),"var(--text-hi)"],
                            ["Theta",(sign*g.theta*pos.contracts).toFixed(4),"var(--put)"],
                            ["Vega",(sign*g.vega*pos.contracts).toFixed(3),"var(--text-hi)"]
                          ] as const).map(([k,v,c])=>(
                            <div key={k} className="zn-kv">
                              <span style={{color:"var(--text-lo)"}}>{k}</span>
                              <span className="num" style={{color:c}}>{v}</span>
                            </div>
                          ))}
                          <div className="zn-actions">
                            <Link href="/portfolio" style={{border:"1px solid var(--border-default)",
                              color:"var(--brand)",textDecoration:"none"}}>Manage →</Link>
                          </div>
                        </>}
                      />
                    );
                  })}
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
                    {backendPositions.map(pos=>{
                      const sign=pos.position_type==="short"?-1:1;
                      const g=positionLiveGreeks(pos);
                      return(
                      <tr key={pos.id} style={{borderBottom:"1px solid var(--border-subtle)"}}>
                        <td style={{padding:"8px",fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{pos.underlying}</td>
                        <td style={{padding:"8px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",borderRadius:0,
                            background:pos.position_type==="short"?"var(--put-dim)":"var(--call-dim)",
                            color:pos.position_type==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                            {pos.position_type}
                          </span>
                        </td>
                        <td style={{padding:"8px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",borderRadius:0,
                            background:pos.option_type==="call"?"var(--call-dim)":"var(--put-dim)",
                            color:pos.option_type==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                            {pos.option_type}
                          </span>
                        </td>
                        {[fmtK(pos.strike),`${pos.expiry_days}D`,pos.contracts.toFixed(0),
                          (sign*g.delta*pos.contracts).toFixed(3),(sign*g.gamma*pos.contracts).toFixed(4),
                          (sign*g.theta*pos.contracts).toFixed(4),(sign*g.vega*pos.contracts).toFixed(3)
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

          {viewTab==="strategies"&&(
            <div className="zn-scroll zn-strategy-grid" style={{padding:16}}>
              <StrategyPicker selectedId={selectedStrategy?.id??null} onSelect={setSelectedStrategy}/>

              {selectedStrategy&&(
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"var(--text-hi)",marginBottom:12}}>{selectedStrategy.name}</div>
                  {pricedLegs.map((leg,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",
                      borderBottom:"1px solid var(--border-subtle)"}}>
                      <span style={{fontSize:11,color:leg.action==="buy"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                        {leg.action} {leg.side}
                      </span>
                      <span className="num" style={{fontSize:11,color:"var(--text-mid)"}}>K={fmtK(leg.strike)}</span>
                      <span className="num" style={{fontSize:11,color:"var(--text-hi)"}}>${fmtN(leg.greeks.premium,4)}</span>
                    </div>
                  ))}
                  <div style={{display:"flex",gap:16,marginTop:10}}>
                    <div>
                      <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)"}}>
                        {strategyNetPremium>=0?"Net Debit":"Net Credit"}
                      </div>
                      <div className="num" style={{fontSize:13,fontWeight:600,color:strategyNetPremium>=0?"var(--put)":"var(--call)"}}>
                        ${fmtN(Math.abs(strategyNetPremium),2)}
                      </div>
                    </div>
                    {strategyCollateral>0&&(
                      <div>
                        <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)"}}>Collateral Required</div>
                        <div className="num" style={{fontSize:13,fontWeight:600,color:"var(--atm)"}}>${fmtN(strategyCollateral,2)}</div>
                      </div>
                    )}
                  </div>
                  <div style={{marginTop:16}}>
                    <MultiLegPayoffDiagram legs={pricedLegs} spot={spot} width={420} height={220}/>
                  </div>
                  <button onClick={()=>{setTradeError(null);setShowStrategyConfirm(true);}} className="zn-tap" disabled={strategyInsufficientFunds||notSignedIn} style={{marginTop:12,padding:"10px 20px",
                    background:"var(--brand)",color:"var(--bg)",border:"none",fontSize:13,fontWeight:700,
                    cursor:strategyInsufficientFunds||notSignedIn?"default":"pointer",opacity:strategyInsufficientFunds||notSignedIn?0.5:1}}>
                    Execute {selectedStrategy.name} ({pricedLegs.length} legs)
                  </button>
                  {strategyInsufficientFunds&&(
                    <div style={{marginTop:6,fontSize:11,color:"var(--put)"}}>
                      Insufficient balance — needs ${fmtN(strategyRequiredFunds,2)}, have ${fmtN(balance,2)}.
                    </div>
                  )}
                  {notSignedIn&&(
                    <div style={{marginTop:6,fontSize:11,color:"var(--put)"}}>
                      Connect your wallet to trade.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {viewTab==="surface"&&(
            <div style={{flex:1,overflowY:"auto",padding:16}}>
              <VolSurfaceHeatmap baseVol={vol} selectedExpiryDays={expiry.days}/>
            </div>
          )}

          {hydrated&&backendPositions.length>0&&(
            <div style={{height:36,flexShrink:0,borderTop:"1px solid var(--border-default)",
              display:"flex",alignItems:"center",gap:20,padding:"0 16px",background:"var(--bg-raised)",
              overflowX:"auto",whiteSpace:"nowrap",scrollbarWidth:"none"}}>
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

        {/* RIGHT PANEL — desktop presentation of the shared order ticket. */}
        {trade&&tradeGreeks&&!isCompact&&(
          <aside className="zn-ticket-aside">
            <OrderTicket
              sym={sym} expiryLabel={expiry.label} side={trade.side} mode={trade.mode}
              strike={trade.row.strike} greeks={tradeGreeks} spot={spot}
              contracts={contracts} setContracts={setContracts} qty={qty}
              collateral={collateral} balance={balance}
              insufficientFunds={insufficientFunds} notSignedIn={notSignedIn}
              tradeError={tradeError}
              onClose={()=>setTrade(null)}
              onConfirm={()=>{setTradeError(null);setShowTradeConfirm(true);}}
            />
          </aside>
        )}

        {/* MOBILE ORDER TICKET — the same ticket as a bottom sheet, so the
            on-screen keyboard never buries the size/confirm controls. */}
        {isCompact&&trade&&tradeGreeks&&(
          <BottomSheet
            open
            onClose={()=>setTrade(null)}
            suspended={showTradeConfirm}
            ariaLabel={`${sym} ${trade.side} ${trade.mode==="write"?"write":"buy"} order ticket`}
          >
            <OrderTicket
              sym={sym} expiryLabel={expiry.label} side={trade.side} mode={trade.mode}
              strike={trade.row.strike} greeks={tradeGreeks} spot={spot}
              contracts={contracts} setContracts={setContracts} qty={qty}
              collateral={collateral} balance={balance}
              insufficientFunds={insufficientFunds} notSignedIn={notSignedIn}
              tradeError={tradeError}
              onClose={()=>setTrade(null)}
              onConfirm={()=>{setTradeError(null);setShowTradeConfirm(true);}}
            />
          </BottomSheet>
        )}

      </div>

      {/* STATUS BAR — .zn-statusbar scrolls horizontally on narrow screens
          (nowrap spans) and picks up the iOS home-indicator inset on mobile */}
      <div className="zn-statusbar">
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

      {showTradeConfirm&&trade&&tradeGreeks&&(
        <ConfirmDialog
          title={`${trade.mode==="write"?"Write":"Buy"} ${sym} ${trade.side.toUpperCase()}`}
          confirmLabel={submitting?"Submitting…":`Confirm ${trade.mode==="write"?"Write":"Buy"}`}
          onConfirm={execTrade}
          onCancel={()=>setShowTradeConfirm(false)}
          disabled={insufficientFunds||notSignedIn||submitting||!!tradeError}
          disabledReason={tradeError??(insufficientFunds?`Insufficient balance ${trade.mode==="write"?"to post collateral":"to cover premium"}.`:undefined)}
        >
          {[
            ["Strike",fmtK(trade.row.strike)],
            ["Expiry",expiry.label],
            ["Contracts",String(qty)],
            [trade.mode==="write"?"Premium received":"Total premium",`$${fmtN(tradeGreeks.premium*qty,2)}`],
            ...(trade.mode==="write"?[["Collateral required",`$${fmtN(collateral,2)}`]]:[]),
          ].map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:12}}>
              <span style={{color:"var(--text-lo)"}}>{k}</span>
              <span className="num" style={{color:"var(--text-hi)"}}>{v}</span>
            </div>
          ))}
        </ConfirmDialog>
      )}

      {showStrategyConfirm&&selectedStrategy&&(
        <ConfirmDialog
          title={`Execute ${selectedStrategy.name}`}
          confirmLabel={submitting?"Submitting…":"Confirm Execute"}
          onConfirm={execStrategy}
          onCancel={()=>setShowStrategyConfirm(false)}
          disabled={strategyInsufficientFunds||notSignedIn||submitting||!!tradeError}
          disabledReason={tradeError??(strategyInsufficientFunds?`Insufficient balance — needs $${fmtN(strategyRequiredFunds,2)}, have $${fmtN(balance,2)}.`:notSignedIn?"Connect your wallet to trade.":undefined)}
        >
          {pricedLegs.map((leg,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:12}}>
              <span style={{color:leg.action==="buy"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>{leg.action} {leg.side}</span>
              <span className="num" style={{color:"var(--text-mid)"}}>K={fmtK(leg.strike)}</span>
              <span className="num" style={{color:"var(--text-hi)"}}>${fmtN(leg.greeks.premium*leg.contracts,2)}</span>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 0",marginTop:6,borderTop:"1px solid var(--border-default)",fontSize:12}}>
            <span style={{color:"var(--text-lo)"}}>{strategyNetPremium>=0?"Net Debit":"Net Credit"}</span>
            <span className="num" style={{color:"var(--text-hi)"}}>${fmtN(Math.abs(strategyNetPremium),2)}</span>
          </div>
          {strategyCollateral>0&&(
            <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:12}}>
              <span style={{color:"var(--text-lo)"}}>Collateral Required</span>
              <span className="num" style={{color:"var(--text-hi)"}}>${fmtN(strategyCollateral,2)}</span>
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
