import { useMemo, useState } from "react";
import { ApiError } from "../../../lib/api/client";
import { useBackendData } from "../../../lib/context/BackendDataContext";
import { useWalletStore } from "../../../lib/store/wallet";
import { collateralRequired } from "../../../lib/collateral";
import { useIdempotencyKey } from "../../../lib/hooks/useIdempotencyKey";
import { firstError, quantitySchema } from "../../../lib/validation";
import type { Expiry, TradeState } from "./types";

interface Args{trade:TradeState|null;sym:string;expiry:Expiry;spot:number;contracts:string;onDone:()=>void;}

/** Instrument lot rules for single-leg options. */
export const CONTRACT_STEP=0.01;
export const MAX_CONTRACTS=1_000_000;
const contractsSchema=quantitySchema({step:CONTRACT_STEP,min:CONTRACT_STEP,max:MAX_CONTRACTS});

// Validation, collateral and funds checks + submit for the single-leg ticket.
// `contracts` is the raw text from the input: an invalid value yields
// qty=null + qtyError and disables submit — it is never coerced to a default.
export function useTradeTicket({trade,sym,expiry,spot,contracts,onDone}:Args){
  const [showTradeConfirm,setShowTradeConfirm]=useState(false);
  const [tradeError,setTradeError]=useState<string|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const token=useWalletStore(s=>s.token);
  const {account,open:openBackendPosition}=useBackendData();
  const {keyFor,complete}=useIdempotencyKey();
  const balance=account?.balance ?? 0;
  const parsed=useMemo(()=>contractsSchema.safeParse(contracts),[contracts]);
  const qty=parsed.success?parsed.data:null;
  const qtyError=firstError(parsed);
  const q=qty??0;
  const tradeGreeks=trade?(trade.side==="call"?trade.row.call:trade.row.put):null;
  const collateral=trade&&trade.mode==="write"?collateralRequired(trade.side,q,trade.row.strike,spot):0;
  const requiredFunds=trade?(trade.mode==="write"?collateral:(tradeGreeks?.premium??0)*q):0;
  const insufficientFunds=balance<requiredFunds;
  const notSignedIn=!token;
  const invalidQty=qty===null;

  const execTrade=async()=>{
    if(!trade||!tradeGreeks||qty===null||insufficientFunds||submitting)return;
    setSubmitting(true);
    setTradeError(null);
    const params={
      underlying:sym,strike:trade.row.strike,expiryDays:expiry.days,
      optionType:trade.side,positionType:trade.mode==="write"?"short" as const:"long" as const,contracts:qty,
    };
    try{
      // Same params on a re-click (after a timeout / 5xx) reuse the key, so
      // the backend can dedupe; the API client itself never retries POSTs.
      // BackendDataContext.open forwards opts to openPosition(params, token, opts).
      await openBackendPosition(params,{idempotencyKey:keyFor(params)});
      complete();
      setShowTradeConfirm(false);
      onDone();
    }catch(err){
      setTradeError(err instanceof ApiError?err.message:"Failed to open position");
    }finally{
      setSubmitting(false);
    }
  };
  return{showTradeConfirm,setShowTradeConfirm,tradeError,setTradeError,submitting,balance,qty,qtyError,invalidQty,
    tradeGreeks,collateral,insufficientFunds,notSignedIn,execTrade};
}
