import { useCallback, useEffect, useState } from "react";
import { createAlert, deleteAlert, getAlerts } from "../api/alerts";
import type { Alert, AlertCondition } from "../api/types";

/**
 * Alerts from the backend, polled every 5s so a wallet's other tabs (and
 * this one) pick up server-side triggers reasonably quickly — the
 * backend's own check loop runs every 10s, so polling faster than that
 * wouldn't surface anything new. `token` should be `null` pre-hydration
 * — see useBackendAccount's doc comment for why.
 */
export function useBackendAlerts(token: string | null) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!token) {
      setAlerts([]);
      return;
    }
    setLoading(true);
    getAlerts(token)
      .then(setAlerts)
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
    if (!token) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh, token]);

  const add = useCallback(
    async (params: { underlying: string; condition: AlertCondition; targetPrice: number }) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      const alert = await createAlert(params, token);
      refresh();
      return alert;
    },
    [token, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!token) throw new Error("Connect and sign in with your wallet first");
      await deleteAlert(id, token);
      refresh();
    },
    [token, refresh]
  );

  return { alerts, loading, refresh, add, remove };
}
