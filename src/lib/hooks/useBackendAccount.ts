import { getAccount } from "../api/positions";
import type { Account } from "../api/types";
import { useAsyncQuery } from "../query";

/**
 * Account balance/collateral from the backend. `token` should be `null`
 * whenever the caller hasn't finished its own hydration-safety check —
 * passing a token before that point risks fetching (and rendering) data
 * the server-rendered HTML didn't have, which is exactly the mismatch
 * the useHydrated() pattern documented in the README exists to avoid.
 *
 * `account` is null until loaded: callers must not treat that as a zero
 * balance (see the `query.status` they get alongside it).
 */
export function useBackendAccount(token: string | null) {
  const query = useAsyncQuery<Account>(
    token ? `account:${token}` : null,
    () => getAccount(token!),
    { authed: true }
  );
  return { account: query.data ?? null, loading: query.status === "loading", refresh: query.refetch, query };
}
