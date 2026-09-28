"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useBackendData } from "../lib/context/BackendDataContext";
import { useWalletStore } from "../lib/store/wallet";
import { ApiError } from "../lib/api/client";
import { requestNotificationPermission, sendNotification } from "../lib/notify";
import type { Alert, AlertCondition } from "../lib/api/types";
import { DataBoundary, Skeleton, SkeletonRegion } from "./states";
import { AuthGate } from "./states/AuthGate";

export function AlertsPanel({ sym, spot }: { sym: string; spot: number }) {
  const token = useWalletStore(s => s.token);
  const { alerts: allAlerts, addAlert, removeAlert, alertsQuery, authStatus } = useBackendData();
  const [price, setPrice] = useState(() => spot.toFixed(4));
  const [condition, setCondition] = useState<AlertCondition>("above");
  const [error, setError] = useState<string|null>(null);
  const id = useId();

  // Re-seed the default price whenever the selected underlying changes —
  // otherwise switching from XLM to BTC leaves the form showing a stale
  // ~$0.12 default in a market where that's meaningless.
  useEffect(() => {
    setPrice(spot.toFixed(4));
  }, [sym]); // eslint-disable-line react-hooks/exhaustive-deps

  // The backend checks alerts against spot server-side every 10s (this
  // panel just polls its result via useBackendAlerts) — this only
  // notices a triggered->true transition to fire a browser notification,
  // it doesn't do any of its own spot-vs-target comparison anymore.
  const seenTriggered = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const a of allAlerts) {
      if (!a.triggered || seenTriggered.current.has(a.id)) continue;
      seenTriggered.current.add(a.id);
      sendNotification(`${a.underlying} ${a.condition} $${a.target_price.toFixed(4)}`, "Alert triggered");
    }
  }, [allAlerts]);

  const submit = async () => {
    const target = parseFloat(price);
    if (!target || target <= 0 || !token) return;
    setError(null);
    requestNotificationPermission();
    try {
      await addAlert({ underlying: sym, condition, targetPrice: target });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create alert");
    }
  };

  const row = (a: Alert, color: string) => (
    <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
      <span className="num" style={{ fontSize: 11, color }}>
        {a.condition === "above" ? "≥" : "≤"} ${a.target_price.toFixed(4)}
      </span>
      <button type="button" className="tap" onClick={() => removeAlert(a.id)}
        aria-label={`Remove alert ${a.condition} ${a.target_price.toFixed(4)}`} style={{
          background: "none", border: "none", color: "var(--text-lo)", fontSize: 14, cursor: "pointer", padding: "0 4px",
        }}>×</button>
    </div>
  );

  return (
    <div data-testid="alerts-panel">
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)", marginBottom: 8 }}>
        Price Alerts
      </div>

      <DataBoundary
        query={alertsQuery}
        auth={authStatus}
        compact
        errorTitle="Couldn't load alerts"
        skeleton={
          <SkeletonRegion label="Loading alerts" testId="alerts-skeleton">
            <Skeleton height={26} style={{ marginBottom: 8 }} />
            <Skeleton height={12} width="70%" />
          </SkeletonRegion>
        }
        signedOut={<AuthGate compact description="Connect your wallet to set price alerts." testId="alerts-auth" />}
      >
        {data => {
          const alerts = data.filter(a => a.underlying === sym);
          const pending = alerts.filter(a => !a.triggered);
          const triggered = alerts.filter(a => a.triggered);
          return (
            <>
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                <label htmlFor={`${id}-cond`} className="sr-only">Condition</label>
                <select id={`${id}-cond`} value={condition} onChange={e => setCondition(e.target.value as AlertCondition)} style={{
                  background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)",
                  fontSize: 11, padding: "4px 2px",
                }}>
                  <option value="above">Above</option>
                  <option value="below">Below</option>
                </select>
                <label htmlFor={`${id}-price`} className="sr-only">Target price</label>
                <input id={`${id}-price`} value={price} onChange={e => setPrice(e.target.value)} type="number" inputMode="decimal" step="any" style={{
                  flex: 1, background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)",
                  fontFamily: "var(--font-mono)", fontSize: 11, padding: "4px 6px", width: 0,
                }}/>
                <button type="button" className="tap" onClick={submit} style={{
                  background: "var(--brand)", color: "var(--bg)", border: "none", fontSize: 11, fontWeight: 700,
                  padding: "4px 10px", cursor: "pointer",
                }}>Add</button>
              </div>

              {error && <div role="alert" style={{ fontSize: 10, color: "var(--put)", marginBottom: 8 }}>{error}</div>}

              {alerts.length === 0
                ? <div data-testid="alerts-empty" style={{ fontSize: 11, color: "var(--text-lo)" }}>No alerts set for {sym}.</div>
                : <div data-testid="alerts-list">{pending.map(a => row(a, "var(--text-mid)"))}</div>}

              {triggered.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--atm)", marginBottom: 4 }}>
                    Triggered
                  </div>
                  {triggered.map(a => row(a, "var(--atm)"))}
                </div>
              )}
            </>
          );
        }}
      </DataBoundary>
    </div>
  );
}
