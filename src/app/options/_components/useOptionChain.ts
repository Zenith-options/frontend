import { useEffect, useState } from "react";
import { EXPIRIES, bs, smileVol } from "../../../lib/pricing";
import { getChain, getExpiryCalendar } from "../../../lib/api/market";
import type { OptionChainEntry } from "../../../lib/api/types";
import type { ChainRow, Expiry } from "./types";

// Single mapper for backend chain entries (was copy-pasted twice in page.tsx).
export function mapChainEntries(entries:OptionChainEntry[]):ChainRow[]{
  return entries.map(e=>({
    strike:e.strike,
    call:{premium:e.call.premium,delta:e.call.delta,gamma:e.call.gamma,theta:e.call.theta,vega:e.call.vega,iv:e.call.iv},
    put:{premium:e.put.premium,delta:e.put.delta,gamma:e.put.gamma,theta:e.put.theta,vega:e.put.vega,iv:e.put.iv},
    itmCall:e.is_itm_call,itmPut:e.is_itm_put,
  }));
}

// Backend's expiry list happens to be the same across every underlying,
// but fetching per-symbol keeps this correct if that ever changes.
export function useExpiries(sym:string):Expiry[]{
  const [expiries,setExpiries]=useState<Expiry[]>(EXPIRIES);
  useEffect(()=>{
    let cancelled=false;
    getExpiryCalendar(sym).then(cal=>{
      if(cancelled)return;
      setExpiries(cal.expiries.map(e=>({label:e.label,days:e.days_to_expiry})));
    }).catch(()=>{/* keep showing the local EXPIRIES fallback */});
    return ()=>{cancelled=true;};
  },[sym]);
  return expiries;
}

// Fetch + 4s polling + local Black-Scholes fallback when the backend is down.
export function useOptionChain(sym:string,expiryDays:number,spot:number,vol:number){
  const [chain,setChain]=useState<ChainRow[]>([]);
  const [loading,setLoading]=useState(true);
  const t=expiryDays/365;

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    getChain(sym,expiryDays).then(entries=>{
      if(cancelled)return;
      setChain(mapChainEntries(entries));
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
    }).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
    // Deliberately not re-fetching on every spot tick (every 2s) — the
    // chain refreshes on its own 4s interval below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sym,expiryDays]);

  useEffect(()=>{
    const id=setInterval(()=>{
      getChain(sym,expiryDays).then(entries=>{
        setChain(mapChainEntries(entries));
      }).catch(()=>{/* keep showing the last known chain */});
    },4000);
    return ()=>clearInterval(id);
  },[sym,expiryDays]);

  return{chain,loading};
}
