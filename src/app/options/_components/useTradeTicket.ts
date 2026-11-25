import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "../../../lib/api/client";
import { useBackendData } from "../../../lib/context/BackendDataContext";
import { useWalletStore } from "../../../lib/store/wallet";
import { collateralRequired } from "../../../lib/collateral";
import { useIntegrityStore } from "../../../lib/integrity/integrityStore";
import type { Expiry, TradeState } from "./types";

interface Args {
  trade: TradeState | null;
  sym: string;
  expiry: Expiry;
  spot: number;
  contracts: string;
  onDone: () => void;
}

// Validation, collateral and funds checks + submit for the single-leg ticket.
export function useTradeTicket({ trade, sym, expiry, spot, contracts, onDone }: Args) {
  const t = useTranslations();
  const [showTradeConfirm, setShowTradeConfirm] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const token = useWalletStore((s) => s.token);
  const { account, open: openBackendPosition } = useBackendData();
  const balance = account?.balance ?? 0;
  const qty = Math.max(0.01, parseFloat(contracts) || 1);
  const tradeGreeks = trade ? (trade.side === "call" ? trade.row.call : trade.row.put) : null;
  const collateral =
    trade && trade.mode === "write"
      ? collateralRequired(trade.side, qty, trade.row.strike, spot)
      : 0;
  const requiredFunds = trade
    ? trade.mode === "write"
      ? collateral
      : (tradeGreeks?.premium ?? 0) * qty
    : 0;
  const insufficientFunds = balance < requiredFunds;
  const notSignedIn = !token;

  // ── Integrity block ───────────────────────────────────────────────────────
  // Read whether trading is currently blocked for this symbol.  This is a
  // synchronous read from the zustand store (no subscription overhead here —
  // we just call the selector function directly during render).
  const isTradingBlocked = useIntegrityStore((s) => s.isTradingBlocked);
  const integrityBlocked = isTradingBlocked(sym);

  // Classify error and return i18n key
  function classifyTradeError(err: unknown): string {
    if (err instanceof ApiError) {
      // Wallet rejection (user cancelled)
      if (/user (declined|rejected|denied)|declined access|rejected|denied|cancel/i.test(err.message)) {
        return t("tradeTicket.errors.wallet_rejected");
      }
      // Backend validation errors (4xx)
      if (err.status >= 400 && err.status < 500) {
        return t("tradeTicket.errors.validation_failed");
      }
      // Network/retryable errors (5xx) or circuit open/timeout
      if (err.status >= 500 || err.reason === "circuit_open" || err.reason === "timeout") {
        return t("tradeTicket.errors.network_error");
      }
      // Fallback to backend error
      return t("tradeTicket.errors.backend_error");
    }
    // Network/fetch errors
    if (err instanceof TypeError) {
      return t("tradeTicket.errors.network_error");
    }
    // Wallet-related errors
    const msg = typeof err === "string" ? err : err instanceof Error ? err.message : (err as { message?: string })?.message;
    if (typeof msg === "string" && /user (declined|rejected|denied)|declined access|rejected|denied|cancel/i.test(msg)) {
      return t("tradeTicket.errors.wallet_rejected");
    }
    // Generic backend error fallback
    return t("tradeTicket.errors.backend_error");
  }

  const execTrade = async () => {
    if (!trade || !tradeGreeks || insufficientFunds || submitting || integrityBlocked) return;
    setSubmitting(true);
    setTradeError(null);
    try {
      await openBackendPosition({
        underlying: sym,
        strike: trade.row.strike,
        expiryDays: expiry.days,
        optionType: trade.side,
        positionType: trade.mode === "write" ? "short" : "long",
        contracts: qty,
      });
      setShowTradeConfirm(false);
      onDone();
    } catch (err) {
      setTradeError(classifyTradeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return {
    showTradeConfirm,
    setShowTradeConfirm,
    tradeError,
    setTradeError,
    submitting,
    balance,
    qty,
    tradeGreeks,
    collateral,
    insufficientFunds,
    notSignedIn,
    /** True when the integrity guard has flagged this symbol as suspect. */
    integrityBlocked,
    execTrade,
  };
}
