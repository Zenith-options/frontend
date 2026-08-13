"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { PayoffDiagram } from "../components/PayoffDiagram";
import { Logo } from "../components/Logo";

function normCDF(x:number){if(x<-7)return 0;if(x>7)return 1;const k=1/(1+0.2316419*Math.abs(x));const p=k*(0.31938153+k*(-0.356563782+k*(1.781477937+k*(-1.821255978+k*1.330274429))));const pdf=Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);return x>=0?1-pdf*p:pdf*p;}
function normPDF(x:number){return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);}
function bs(S:number,K:number,vol:number,t:number,isCall:boolean){
  if(t<=0)return{premium:isCall?Math.max(0,S-K):Math.max(0,K-S),delta:isCall?1:-1,iv:vol};
  const st=Math.sqrt(t),d1=(Math.log(S/K)+(0.05+0.5*vol*vol)*t)/(vol*st),d2=d1-vol*st,disc=Math.exp(-0.05*t);
  return{premium:Math.max(0,isCall?S*normCDF(d1)-K*disc*normCDF(d2):K*disc*normCDF(-d2)-S*normCDF(-d1)),
    delta:isCall?normCDF(d1):normCDF(d1)-1,iv:vol};
}
function smileVol(b:number,m:number){return Math.max(0.1,b-0.15*(m-1)+0.08*(m-1)**2+0.12*Math.max(0,(Math.abs(m-1)-0.15)**2));}
const fmtN=(n:number,d=4)=>Math.abs(n)<0.0001?n.toExponential(2):n.toFixed(d);
const fmtK=(n:number)=>n>=100?n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):n.toFixed(4);

const XLMPRICE=0.1182, XLMVOL=0.82, T=30/365;

export default function Home() {
  const [spot,setSpot]=useState(XLMPRICE);

  useEffect(()=>{
    const id=setInterval(()=>setSpot(p=>Math.max(0.05,p+(Math.random()-0.5)*0.0004)),2000);
    return ()=>clearInterval(id);
  },[]);

  const previewChain=useMemo(()=>{
    const strikes=[spot*0.90,spot*0.95,spot,spot*1.05,spot*1.10];
    return strikes.map(K=>{
      const vol=smileVol(XLMVOL,K/spot);
      return{strike:K,call:bs(spot,K,vol,T,true),put:bs(spot,K,vol,T,false),itm:spot>K};
    });
  },[spot]);

  return (
    <div style={{fontFamily:"var(--font-sans)",background:"var(--bg)",minHeight:"100vh",color:"var(--text-hi)"}}>

      {/* NAV */}
      <nav style={{position:"sticky",top:0,zIndex:50,height:52,display:"flex",alignItems:"center",
        justifyContent:"space-between",padding:"0 24px",
        borderBottom:"1px solid var(--border-default)",background:"rgba(9,9,11,0.85)",backdropFilter:"blur(12px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:32}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Logo size={18} />
            <span style={{fontSize:14,fontWeight:700,letterSpacing:"-0.01em",fontFamily:"var(--font-serif)"}}>Zenith</span>
          </div>
          <div style={{display:"flex",gap:20}}>
            {[["Options Chain","/options"],["Portfolio","/portfolio"],["Docs","#"]].map(([l,h])=>(
              <Link key={l} href={h} style={{fontSize:13,color:"var(--text-mid)",textDecoration:"none",
                transition:"color 120ms"}}
                onMouseOver={e=>{(e.target as HTMLElement).style.color="var(--text-hi)"}}
                onMouseOut={e=>{(e.target as HTMLElement).style.color="var(--text-mid)"}}>
                {l}
              </Link>
            ))}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"var(--call)"}}/>
            <span style={{fontSize:11,color:"var(--text-lo)"}}>Stellar Testnet</span>
          </div>
          <Link href="/options" style={{padding:"7px 14px",background:"var(--brand)",color:"#000",
            border:"none",borderRadius:4,fontSize:13,fontWeight:700,cursor:"pointer",textDecoration:"none"}}>
            Trade Options
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section style={{maxWidth:1080,margin:"0 auto",padding:"72px 24px 48px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 420px",gap:64,alignItems:"start"}}>
          <div>
            <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"5px 12px",
              borderRadius:99,border:"1px solid rgba(139,92,246,0.25)",background:"rgba(139,92,246,0.08)",
              marginBottom:24}}>
              <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#8B5CF6"/></svg>
              <span style={{fontSize:11,color:"var(--brand)",fontWeight:500,letterSpacing:"0.04em"}}>
                FIRST OPTIONS PROTOCOL ON STELLAR
              </span>
            </div>

            <h1 style={{fontSize:"clamp(2.2rem,4vw,3.25rem)",fontWeight:800,letterSpacing:"-0.03em",
              lineHeight:1.05,marginBottom:16}}>
              On-chain puts &<br/>calls on Stellar.
            </h1>

            <p style={{fontSize:16,color:"var(--text-mid)",lineHeight:1.65,maxWidth:440,marginBottom:32}}>
              Buy European options on XLM, BTC, ETH, and SOL.
              Write covered calls to earn premium. Black-Scholes pricing.
              Full settlement on Stellar Soroban.
            </p>

            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:48}}>
              <Link href="/options" style={{padding:"11px 22px",background:"var(--brand)",color:"#fff",
                borderRadius:4,fontWeight:700,fontSize:14,cursor:"pointer",textDecoration:"none",
                boxShadow:"0 4px 20px rgba(139,92,246,0.3)"}}>
                Open Options Chain →
              </Link>
              <a href="https://github.com/zenith-protocol" style={{padding:"11px 22px",
                border:"1px solid var(--border-strong)",color:"var(--text-mid)",
                borderRadius:4,fontWeight:500,fontSize:14,cursor:"pointer",textDecoration:"none"}}>
                View on GitHub
              </a>
            </div>

            {/* Stats — plain, no cards */}
            <div style={{display:"flex",gap:0}}>
              {[["$2.2M","Open Interest"],["84","Active Series"],["312","Traders"],["25%","Avg IV"]].map(([v,l],i)=>(
                <div key={l} style={{paddingRight:32,marginRight:32,
                  borderRight:i<3?"1px solid var(--border-subtle)":"none"}}>
                  <div className="num" style={{fontSize:22,fontWeight:700,color:"var(--text-hi)",marginBottom:2}}>{v}</div>
                  <div style={{fontSize:11,color:"var(--text-lo)",textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: payoff diagram showcase */}
          <div>
            <div style={{marginBottom:12}}>
              <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-lo)"}}>
                Example · XLM 30D Call · K={fmtK(spot*1.05)}
              </span>
            </div>
            <div style={{padding:20,background:"var(--bg-raised)",border:"1px solid var(--border-default)",borderRadius:8}}>
              <PayoffDiagram
                spot={spot} strike={spot*1.05}
                premium={bs(spot,spot*1.05,smileVol(XLMVOL,1.05),T,true).premium}
                isCall={true} contracts={100}
                width={380} height={200}
              />
            </div>
            <div style={{display:"flex",gap:16,marginTop:12,justifyContent:"center"}}>
              {[
                {dot:"var(--call)",label:"Profit zone (above breakeven)"},
                {dot:"var(--put)",label:"Max loss = premium paid"},
              ].map(item=>(
                <div key={item.label} style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:8,height:8,borderRadius:2,background:item.dot}}/>
                  <span style={{fontSize:11,color:"var(--text-lo)"}}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* LIVE CHAIN PREVIEW */}
      <section style={{maxWidth:1080,margin:"0 auto",padding:"0 24px 64px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-lo)",marginBottom:4}}>
              Live Preview
            </div>
            <h2 style={{fontSize:18,fontWeight:700}}>XLM-USD Options Chain · 30D</h2>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"var(--call)"}}/>
            <span className="num" style={{fontSize:14,fontWeight:600}}>{fmtK(spot)}</span>
            <Link href="/options" style={{padding:"6px 14px",border:"1px solid var(--border-strong)",
              borderRadius:4,fontSize:12,color:"var(--text-mid)",textDecoration:"none",
              transition:"color 120ms"}}
              onMouseOver={e=>{(e.currentTarget as HTMLElement).style.color="var(--text-hi)"}}
              onMouseOut={e=>{(e.currentTarget as HTMLElement).style.color="var(--text-mid)"}}>
              Full chain →
            </Link>
          </div>
        </div>

        <div style={{border:"1px solid var(--border-default)",borderRadius:6,overflow:"hidden",background:"var(--bg-raised)"}}>
          {/* Chain header */}
          <div style={{display:"grid",gridTemplateColumns:"52px 60px 68px 68px 48px 88px 48px 68px 68px 60px 52px",
            padding:"0",borderBottom:"1px solid var(--border-default)",background:"var(--bg-overlay)"}}>
            {["Vol","OI","Bid","Ask","IV","Strike","IV","Ask","Bid","OI","Vol"].map((h,i)=>(
              <div key={i} style={{padding:"6px 6px",fontSize:10,fontWeight:500,textTransform:"uppercase",
                letterSpacing:"0.05em",textAlign:i===5?"center":"right",
                color:i<5?"rgba(34,197,94,0.5)":i===5?"var(--text-lo)":"rgba(244,63,94,0.5)"}}>
                {h}
              </div>
            ))}
          </div>

          {previewChain.map((row,i)=>{
            const isAtm=i===2;
            const sp=Math.max(0.00001,row.call.premium*0.003);
            return(
              <div key={i} style={{display:"grid",
                gridTemplateColumns:"52px 60px 68px 68px 48px 88px 48px 68px 68px 60px 52px",
                height:28,alignItems:"center",
                borderBottom:"1px solid var(--border-subtle)",
                background:isAtm?"var(--atm-dim)":row.itm?"rgba(34,197,94,0.03)":"transparent"}}>
                {[80,320,fmtN(Math.max(0,row.call.premium-sp)),fmtN(row.call.premium+sp),`${(row.call.iv*100).toFixed(1)}`].map((v,j)=>(
                  <div key={j} className="num" style={{fontSize:11,textAlign:"right",padding:"0 6px",
                    color:j===3?"var(--call)":j===4?"var(--brand)":"var(--text-mid)"}}>{v}</div>
                ))}
                <div style={{fontSize:11,fontWeight:700,textAlign:"center",padding:"0 6px",fontFamily:"var(--font-mono)",
                  color:isAtm?"var(--atm)":"var(--text-mid)"}}>
                  {fmtK(row.strike)}{isAtm&&<span style={{fontSize:8,marginLeft:3,opacity:0.6}}>ATM</span>}
                </div>
                {[`${(row.put.iv*100).toFixed(1)}`,fmtN(row.put.premium+sp),fmtN(Math.max(0,row.put.premium-sp)),320,80].map((v,j)=>(
                  <div key={j} className="num" style={{fontSize:11,textAlign:"right",padding:"0 6px",
                    color:j===0?"var(--brand)":j===1?"var(--put)":"var(--text-mid)"}}>{v}</div>
                ))}
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",justifyContent:"center",gap:24,marginTop:12}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:10,height:10,borderRadius:1,background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)"}}/>
            <span style={{fontSize:11,color:"var(--text-lo)"}}>ITM Call</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:10,height:10,borderRadius:1,background:"rgba(234,179,8,0.12)",border:"1px solid rgba(234,179,8,0.3)"}}/>
            <span style={{fontSize:11,color:"var(--text-lo)"}}>ATM Strike</span>
          </div>
          <div style={{fontSize:11,color:"var(--text-lo)"}}>Click ask price to trade</div>
        </div>
      </section>

      {/* HOW IT WORKS — no cards, just structured text */}
      <section style={{maxWidth:1080,margin:"0 auto",padding:"0 24px 80px"}}>
        <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-lo)",marginBottom:8}}>
          Protocol
        </div>
        <h2 style={{fontSize:24,fontWeight:700,letterSpacing:"-0.02em",marginBottom:40}}>How Zenith works</h2>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1px",background:"var(--border-default)",border:"1px solid var(--border-default)",borderRadius:6,overflow:"hidden"}}>
          {[
            {n:"01",color:"var(--call)",side:"Buyer",
              title:"Buy a call or put",
              body:"Pay a USDC premium. If the option expires in-the-money, you receive the difference between spot and strike × your contracts. Maximum loss is the premium paid."},
            {n:"02",color:"var(--brand)",side:"Writer",
              title:"Write covered options",
              body:"Lock collateral (110%+ for puts, 100% for covered calls), receive the premium immediately. If the option expires worthless, you keep everything. If exercised, your collateral covers the payout."},
            {n:"03",color:"var(--atm)",side:"Pricing",
              title:"Black-Scholes with vol smile",
              body:"Premiums use the Black-Scholes formula with a realistic crypto vol smile — higher IV for OTM puts, lower for ATM, slight wing steepening. Greeks (Δ, Γ, Θ, V) available per option."},
            {n:"04",color:"var(--put)",side:"Settlement",
              title:"Oracle settlement at expiry",
              body:"The Reflector oracle posts the final spot price on-chain at expiry. Option holders have 24 hours to exercise. Writers reclaim unused collateral. Fully non-custodial."},
          ].map(item=>(
            <div key={item.n} style={{padding:"24px 28px",background:"var(--bg-raised)"}}>
              <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}>
                <span style={{fontSize:11,fontFamily:"var(--font-mono)",color:item.color}}>{item.n}</span>
                <span style={{fontSize:10,padding:"2px 8px",borderRadius:2,fontWeight:600,
                  background:`rgba(${item.color==="var(--call)"?"34,197,94":item.color==="var(--brand)"?"139,92,246":item.color==="var(--atm)"?"234,179,8":"244,63,94"},0.12)`,
                  color:item.color,textTransform:"uppercase",letterSpacing:"0.08em"}}>
                  {item.side}
                </span>
              </div>
              <div style={{fontSize:14,fontWeight:600,marginBottom:8}}>{item.title}</div>
              <p style={{fontSize:13,color:"var(--text-mid)",lineHeight:1.6}}>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{borderTop:"1px solid var(--border-subtle)",padding:"20px 24px"}}>
        <div style={{maxWidth:1080,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:"var(--text-lo)"}}>Zenith Protocol · MIT License · Stellar Soroban</span>
          <div style={{display:"flex",gap:20}}>
            {["GitHub","Discord","Docs"].map(l=>(
              <a key={l} href="#" style={{fontSize:12,color:"var(--text-lo)",textDecoration:"none",
                transition:"color 120ms"}}
                onMouseOver={e=>{(e.target as HTMLElement).style.color="var(--text-hi)"}}
                onMouseOut={e=>{(e.target as HTMLElement).style.color="var(--text-lo)"}}>
                {l}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
