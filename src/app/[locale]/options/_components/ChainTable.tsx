"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { seededRandom, fmtN, fmtK } from "../../../../lib/pricing";
import type { ChainRow, TradeState } from "./types";

interface Props{chain:ChainRow[];chainLoading:boolean;setTrade:(t:TradeState)=>void;}

// ─── Memoized row ─────────────────────────────────────────────────────────────
// Each strike row is memoized: only re-renders when its own `row` object
// identity changes (the chain hook uses mergeChain structural-sharing so
// unchanged strikes keep their object identity across repaints).
interface RowProps {
  row: ChainRow;
  isAtm: boolean;
  noQuote: string;
  setTrade: (t: TradeState) => void;
}

const ChainRowMemo = memo(function ChainRowMemo({ row, isAtm, noQuote, setTrade }: RowProps) {
  const sp = Math.max(0.00001, row.call.premium * 0.003);
  const vol = Math.round(seededRandom(row.strike * 1000) * 200 + 20);
  const oi = Math.round(seededRandom(row.strike * 1000 + 7) * 5000 + 100);

  const callBid = Number.isFinite(row.call.premium) && row.call.premium > 0
    ? fmtN(Math.max(0, row.call.premium - sp))
    : noQuote;
  const callAsk = Number.isFinite(row.call.premium) && row.call.premium > 0
    ? fmtN(row.call.premium + sp)
    : noQuote;
  const putAsk = Number.isFinite(row.put.premium) && row.put.premium > 0
    ? fmtN(row.put.premium + sp)
    : noQuote;
  const putBid = Number.isFinite(row.put.premium) && row.put.premium > 0
    ? fmtN(Math.max(0, row.put.premium - sp))
    : noQuote;

  return (
    <div
      key={row.strike}
      className={`chain-row${row.itmCall ? " itm-call" : ""}${row.itmPut ? " itm-put" : ""}`}
      style={{ background: isAtm ? "var(--atm-dim)" : undefined }}
    >
      <div className="cc">{vol}</div>
      <div className="cc">{oi.toLocaleString()}</div>
      <div
        className="cc tradeable call"
        title="Click to write (sell)"
        onClick={() => setTrade({ row, side: "call", mode: "write" })}
      >
        {callBid}
      </div>
      <div
        className="cc tradeable call"
        title="Click to buy"
        onClick={() => setTrade({ row, side: "call", mode: "buy" })}
      >
        {callAsk}
      </div>
      <div className="cc brand">{(row.call.iv * 100).toFixed(1)}</div>
      <div className={`strike-cell${isAtm ? " atm" : ""}`}>
        {fmtK(row.strike)}
        {isAtm && <div style={{ fontSize: 7, marginTop: 1, opacity: 0.6 }}>ATM</div>}
      </div>
      <div className="cc brand">{(row.put.iv * 100).toFixed(1)}</div>
      <div
        className="cc tradeable put"
        title="Click to buy"
        onClick={() => setTrade({ row, side: "put", mode: "buy" })}
      >
        {putAsk}
      </div>
      <div
        className="cc tradeable put"
        title="Click to write (sell)"
        onClick={() => setTrade({ row, side: "put", mode: "write" })}
      >
        {putBid}
      </div>
      <div className="cc">{oi.toLocaleString()}</div>
      <div className="cc">{vol}</div>
    </div>
  );
},
// Custom comparator: skip re-render when row identity and ATM flag are unchanged.
// setTrade is stable (useCallback in the parent) so comparing it is optional but safe.
(prev, next) => prev.row === next.row && prev.isAtm === next.isAtm && prev.setTrade === next.setTrade && prev.noQuote === next.noQuote);

// ─── Table ─────────────────────────────────────────────────────────────────────
function ChainTableImpl({ chain, chainLoading, setTrade }: Props) {
  const t = useTranslations("chain");
  const noQuote = t("noQuote");
  const atmIdx = chain.findIndex((r) => !r.itmCall);
  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      {chainLoading && chain.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            fontSize: 12,
            color: "var(--text-lo)",
          }}
        >
          Loading chain…
        </div>
      ) : (
        <>
          {/* Headers */}
          <div className="chain-header">
            {["Vol", "OI", "Bid", "Ask", "IV"].map((h) => (
              <div key={"c" + h} className="ch call">
                {h}
              </div>
            ))}
            <div className="ch center">Strike</div>
            {["IV", "Ask", "Bid", "OI", "Vol"].map((h) => (
              <div key={"p" + h} className="ch put">
                {h}
              </div>
            ))}
          </div>

          {chain.map((row, i) => (
            <ChainRowMemo
              key={row.strike}
              row={row}
              isAtm={i === atmIdx}
              noQuote={noQuote}
              setTrade={setTrade}
            />
          ))}
        </>
      )}
    </div>
  );
}

export const ChainTable = memo(ChainTableImpl);
