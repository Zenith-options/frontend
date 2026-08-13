"use client";

import { useEffect } from "react";
import { useAccountStore } from "../lib/store/account";
import { useAlertsStore } from "../lib/store/alerts";
import { useHistoryStore } from "../lib/store/history";
import { usePositionsStore } from "../lib/store/positions";
import { useWalletStore } from "../lib/store/wallet";
import { useWatchlistStore } from "../lib/store/watchlist";

// Every persisted store uses skipHydration, so both the server-rendered HTML
// and the client's first hydration pass use the plain default state — a
// store with real localStorage data (e.g. an already-favorited symbol)
// would otherwise mismatch the server's empty-state markup and blow up
// hydration for the whole page. This pulls the real persisted state in
// after mount, which is a normal state update, not a hydration diff.
export function StoreHydrator() {
  useEffect(() => {
    useAccountStore.persist.rehydrate();
    useAlertsStore.persist.rehydrate();
    useHistoryStore.persist.rehydrate();
    usePositionsStore.persist.rehydrate();
    useWalletStore.persist.rehydrate();
    useWatchlistStore.persist.rehydrate();
  }, []);
  return null;
}
