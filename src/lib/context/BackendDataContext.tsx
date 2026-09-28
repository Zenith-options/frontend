"use client";

import { createContext, useContext } from "react";
import { useBackendAccount } from "../hooks/useBackendAccount";
import { useBackendPositions } from "../hooks/useBackendPositions";
import { useBackendWatchlist } from "../hooks/useBackendWatchlist";
import { useBackendAlerts } from "../hooks/useBackendAlerts";
import { useWalletStore } from "../store/wallet";
import { useHydrated } from "../useHydrated";
import type { Account, Alert, WatchlistItem } from "../api/types";
import type { QueryState } from "../query";
import type { PositionsData } from "../hooks/useBackendPositions";

/**
 * - unknown:    pre-hydration; the persisted session hasn't been read yet
 * - signing-in: a wallet connection/backend sign-in is in progress
 * - signed-out: nobody is signed in — show the connect CTA, not "empty"
 * - signed-in:  a bearer token is available
 */
export type AuthStatus = "unknown" | "signing-in" | "signed-out" | "signed-in";

export function deriveAuthStatus(params: {
  hydrated: boolean;
  token: string | null;
  walletStatus: string;
  checking: boolean;
}): AuthStatus {
  if (!params.hydrated) return "unknown";
  if (params.token) return "signed-in";
  if (params.walletStatus === "connecting" || params.checking) return "signing-in";
  return "signed-out";
}

interface BackendData {
  authStatus: AuthStatus;
  accountQuery: QueryState<Account>;
  positionsQuery: QueryState<PositionsData>;
  watchlistQuery: QueryState<WatchlistItem[]>;
  alertsQuery: QueryState<Alert[]>;
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
  const walletStatus = useWalletStore(s => s.status);
  const checking = useWalletStore(s => s.checking);
  // Same reasoning as every other persisted-store read on this page tree:
  // pass null until this component's own mount effect has fired, so the
  // first client render matches SSR regardless of when the wallet store
  // itself rehydrates.
  const effectiveToken = hydrated ? token : null;

  const authStatus = deriveAuthStatus({ hydrated, token, walletStatus, checking });

  const { account, loading: accountLoading, refresh: refreshAccount, query: accountQuery } = useBackendAccount(effectiveToken);
  const {
    positions, greeks, loading: positionsLoading, refresh: refreshPositions,
    open, openStrategy, close, roll, query: positionsQuery,
  } = useBackendPositions(effectiveToken);
  const {
    items: watchlist, loading: watchlistLoading,
    add: addToWatchlist, remove: removeFromWatchlist, query: watchlistQuery,
  } = useBackendWatchlist(effectiveToken);
  const { alerts, loading: alertsLoading, add: addAlert, remove: removeAlert, query: alertsQuery } = useBackendAlerts(effectiveToken);

  // Every position mutation changes the account balance/collateral too —
  // refresh it here rather than trusting every call site to remember to.
  const openAndRefreshAccount: typeof open = async (params) => {
    const result = await open(params);
    refreshAccount();
    return result;
  };
  const openStrategyAndRefreshAccount: typeof openStrategy = async (legs) => {
    const result = await openStrategy(legs);
    refreshAccount();
    return result;
  };
  const closeAndRefreshAccount: typeof close = async (id) => {
    const result = await close(id);
    refreshAccount();
    return result;
  };
  const rollAndRefreshAccount: typeof roll = async (id, params) => {
    const result = await roll(id, params);
    refreshAccount();
    return result;
  };

  return (
    <BackendDataContext.Provider
      value={{
        authStatus, accountQuery, positionsQuery, watchlistQuery, alertsQuery,
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

export { BackendDataContext };
export type { BackendData };

export function useBackendData(): BackendData {
  const ctx = useContext(BackendDataContext);
  if (!ctx) throw new Error("useBackendData must be used within BackendDataProvider");
  return ctx;
}
