import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addToWatchlist, getWatchlist, removeFromWatchlist } from "../api/watchlist";
import { queryKeys } from "../api/queryKeys";

const NO_TOKEN = "Connect and sign in with your wallet first";

/**
 * Watchlist from the backend. `token` should be `null` pre-hydration,
 * which disables the query.
 */
export function useBackendWatchlist(token: string | null) {
  const qc = useQueryClient();
  const key = queryKeys.watchlist(token);
  const q = useQuery({ queryKey: key, queryFn: () => getWatchlist(token as string), enabled: !!token });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const addM = useMutation({
    mutationFn: (underlying: string) => {
      if (!token) throw new Error(NO_TOKEN);
      return addToWatchlist(underlying, token);
    },
    onSuccess: invalidate,
  });
  const removeM = useMutation({
    mutationFn: (underlying: string) => {
      if (!token) throw new Error(NO_TOKEN);
      return removeFromWatchlist(underlying, token);
    },
    onSuccess: invalidate,
  });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, token]);

  return {
    items: token ? q.data ?? [] : [],
    loading: q.isFetching,
    error: q.error,
    refresh,
    add: async (underlying: string) => {
      await addM.mutateAsync(underlying);
    },
    remove: async (underlying: string) => {
      await removeM.mutateAsync(underlying);
    },
  };
}
