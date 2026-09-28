"use client";

import { useEffect } from "react";
import { useWalletStore } from "../lib/store/wallet";
import { useEnvironmentStore } from "../lib/env/mode";
import { useOnboardingStore } from "../features/onboarding/store";

// wallet uses skipHydration, so both the server-rendered HTML and the
// client's first hydration pass use the plain default state — a store
// with real localStorage data (e.g. an already-connected wallet) would
// otherwise mismatch the server's empty-state markup and blow up
// hydration for the whole page. This pulls the real persisted state in
// after mount, which is a normal state update, not a hydration diff.
//
// Order matters: the wallet session is stored per environment mode
// (zenith:<mode>:wallet), so the mode has to be known before the wallet
// store reads its namespace.
//
// account/alerts/history/positions/watchlist used to be persisted local
// stores hydrated here too, before this app's data for those moved to
// the backend (see BackendDataContext) — removed once nothing read from
// them anymore.
export function StoreHydrator() {
  useEffect(() => {
    void useEnvironmentStore.persist.rehydrate();
    void useWalletStore.persist.rehydrate();
    void useOnboardingStore.persist.rehydrate();
  }, []);
  return null;
}
