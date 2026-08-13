import { useEffect, useState } from "react";

// True only after this component's own mount effect has run. Persisted-store
// values must be gated behind this rather than trusting global rehydration
// timing — a Suspense boundary (e.g. around useSearchParams) can hydrate
// later than a root-level effect that already updated the store, so the
// deferred boundary's hydration pass would then diff against stale
// server HTML. Gating locally makes correctness independent of ordering.
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
