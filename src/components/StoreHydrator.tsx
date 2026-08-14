"use client";

import { useEffect } from "react";
import { useWalletStore } from "../lib/store/wallet";

// wallet uses skipHydration, so both the server-rendered HTML and the
// client's first hydration pass use the plain default state — a store
// with real localStorage data (e.g. an already-connected wallet) would
// otherwise mismatch the server's empty-state markup and blow up
// hydration for the whole page. This pulls the real persisted state in
// after mount, which is a normal state update, not a hydration diff.
//
// account/alerts/history/positions/watchlist used to be persisted local
// stores hydrated here too, before this app's data for those moved to
// the backend (see BackendDataContext) — removed once nothing read from
// them anymore.
export function StoreHydrator() {
  useEffect(() => {
    useWalletStore.persist.rehydrate();
  }, []);
  return null;
}
