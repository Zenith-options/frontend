"use client";

import { createContext, useContext } from "react";
import { useBackendAccount } from "../hooks/useBackendAccount";
import { useBackendPositions } from "../hooks/useBackendPositions";
import { useBackendWatchlist } from "../hooks/useBackendWatchlist";
import { useBackendAlerts } from "../hooks/useBackendAlerts";
import { useWalletStore } from "../store/wallet";
import { useHydrated } from "../useHydrated";
import type { Account } from "../api/types";
import { publishNotification } from "../notifications/bus";

function publishFill(severity: "success" | "error", title: string, body?: string) {
  publishNotification({ category: "fill", severity, title, body, href: "/portfolio" });
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Unknown error");

interface BackendData {
  account: Account | null;
  accountLoading: boolean;
  refreshAccount: () => void;
  positions: ReturnType<typeof useBackendPositions>["positions"];
  greeks: ReturnType<typeof useBackendPositions>["greeks"];
  positionsLoading: boolean;
  refreshPositions: () => void;
  open: ReturnType<typeof useBackendPositions>["open"];
  openStrategy: ReturnType<typeof useBackendPositions>["openStrategy"];
  close: ReturnType<typeof useBackendPositions>["close"];
  roll: ReturnType<typeof useBackendPositions>["roll"];
  watchlist: ReturnType<typeof useBackendWatchlist>["items"];
  watchlistLoading: boolean;
  addToWatchlist: ReturnType<typeof useBackendWatchlist>["add"];
  removeFromWatchlist: ReturnType<typeof useBackendWatchlist>["remove"];
  alerts: ReturnType<typeof useBackendAlerts>["alerts"];
  alertsLoading: boolean;
  addAlert: ReturnType<typeof useBackendAlerts>["add"];
  removeAlert: ReturnType<typeof useBackendAlerts>["remove"];
}

const BackendDataContext = createContext<BackendData | null>(null);

/**
 * Single shared instance of the account/positions/watchlist/alerts hooks,
 * mounted once at the root — every consumer (AppHeader's balance chip,
 * StarButton, AlertsPanel, the options and portfolio pages) reads the
 * same state instead of each running its own independent fetch. That
 * matters specifically because each hook's mutation methods only refresh
 * *their own* instance's data; without a shared instance, e.g.
 * AppHeader's balance would go stale after a trade made through a
 * different component's copy of the hook until the next full remount.
 */
export function BackendDataProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const token = useWalletStore(s => s.token);
  // Same reasoning as every other persisted-store read on this page tree:
  // pass null until this component's own mount effect has fired, so the
  // first client render matches SSR regardless of when the wallet store
  // itself rehydrates.
  const effectiveToken = hydrated ? token : null;

  const { account, loading: accountLoading, refresh: refreshAccount } = useBackendAccount(effectiveToken);
  const {
    positions, greeks, loading: positionsLoading, refresh: refreshPositions,
    open, openStrategy, close, roll,
  } = useBackendPositions(effectiveToken);
  const {
    items: watchlist, loading: watchlistLoading,
    add: addToWatchlist, remove: removeFromWatchlist,
  } = useBackendWatchlist(effectiveToken);
  const { alerts, loading: alertsLoading, add: addAlert, remove: removeAlert } = useBackendAlerts(effectiveToken);

  // Every position mutation changes the account balance/collateral too —
  // refresh it here rather than trusting every call site to remember to.
  // This is also where a fill's outcome is known, so it's where fill
  // notifications are published from.
  const openAndRefreshAccount: typeof open = async (params) => {
    try {
      const result = await open(params);
      refreshAccount();
      publishFill("success", `${params.positionType === "short" ? "Wrote" : "Bought"} ${params.contracts} ${params.underlying} ${params.optionType} @ ${params.strike}`, `${params.expiryDays}D expiry`);
      return result;
    } catch (err) {
      publishFill("error", `Order failed: ${params.underlying} ${params.optionType} @ ${params.strike}`, errorMessage(err));
      throw err;
    }
  };
  const openStrategyAndRefreshAccount: typeof openStrategy = async (legs) => {
    try {
      const result = await openStrategy(legs);
      refreshAccount();
      publishFill("success", `Strategy filled: ${legs.length} legs on ${legs[0]?.underlying ?? ""}`,
        legs.map(l => `${l.positionType === "short" ? "−" : "+"}${l.contracts} ${l.optionType} ${l.strike}`).join(", "));
      return result;
    } catch (err) {
      publishFill("error", `Strategy failed: ${legs.length} legs on ${legs[0]?.underlying ?? ""}`, errorMessage(err));
      throw err;
    }
  };
  const closeAndRefreshAccount: typeof close = async (id) => {
    try {
      const result = await close(id);
      refreshAccount();
      publishFill("success", `Closed ${result.underlying} ${result.option_type} @ ${result.strike}`,
        result.realized_pnl !== null ? `Realized P&L ${result.realized_pnl >= 0 ? "+" : "−"}$${Math.abs(result.realized_pnl).toFixed(2)}` : undefined);
      return result;
    } catch (err) {
      publishFill("error", "Close failed", errorMessage(err));
      throw err;
    }
  };
  const rollAndRefreshAccount: typeof roll = async (id, params) => {
    try {
      const result = await roll(id, params);
      refreshAccount();
      publishFill("success", `Rolled ${result.opened.underlying} ${result.opened.option_type} to ${result.opened.strike}`, `${result.opened.expiry_days}D expiry`);
      return result;
    } catch (err) {
      publishFill("error", "Roll failed", errorMessage(err));
      throw err;
    }
  };

  return (
    <BackendDataContext.Provider
      value={{
        account, accountLoading, refreshAccount,
        positions, greeks, positionsLoading, refreshPositions,
        open: openAndRefreshAccount, openStrategy: openStrategyAndRefreshAccount,
        close: closeAndRefreshAccount, roll: rollAndRefreshAccount,
        watchlist, watchlistLoading, addToWatchlist, removeFromWatchlist,
        alerts, alertsLoading, addAlert, removeAlert,
      }}
    >
      {children}
    </BackendDataContext.Provider>
  );
}

export function useBackendData(): BackendData {
  const ctx = useContext(BackendDataContext);
  if (!ctx) throw new Error("useBackendData must be used within BackendDataProvider");
  return ctx;
}
