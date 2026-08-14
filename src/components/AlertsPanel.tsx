"use client";

import { useEffect, useRef, useState } from "react";
import { useBackendData } from "../lib/context/BackendDataContext";
import { useWalletStore } from "../lib/store/wallet";
import { ApiError } from "../lib/api/client";
import { requestNotificationPermission, sendNotification } from "../lib/notify";
import type { AlertCondition } from "../lib/api/types";

export function AlertsPanel({ sym, spot }: { sym: string; spot: number }) {
  const token = useWalletStore(s => s.token);
  const { alerts: allAlerts, addAlert, removeAlert } = useBackendData();
  const alerts = allAlerts.filter(a => a.underlying === sym);
  const [price, setPrice] = useState(() => spot.toFixed(4));
  const [condition, setCondition] = useState<AlertCondition>("above");
  const [error, setError] = useState<string|null>(null);

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

  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)", marginBottom: 8 }}>
        Price Alerts
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <select value={condition} onChange={e => setCondition(e.target.value as AlertCondition)} style={{
          background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)",
          fontSize: 11, padding: "4px 2px",
        }}>
          <option value="above">Above</option>
          <option value="below">Below</option>
        </select>
        <input value={price} onChange={e => setPrice(e.target.value)} type="number" step="any" style={{
          flex: 1, background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)",
          fontFamily: "var(--font-mono)", fontSize: 11, padding: "4px 6px", width: 0,
        }}/>
        <button onClick={submit} disabled={!token} title={!token?"Connect your wallet to set alerts":undefined} style={{
          background: "var(--brand)", color: "var(--bg)", border: "none", fontSize: 11, fontWeight: 700,
          padding: "4px 10px", cursor: token?"pointer":"default", opacity: token?1:0.5,
        }}>Add</button>
      </div>

      {error && <div style={{ fontSize: 10, color: "var(--put)", marginBottom: 8 }}>{error}</div>}

      {alerts.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-lo)" }}>No alerts set for {sym}.</div>
      ) : (
        <div>
          {alerts.filter(a => !a.triggered).map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
              <span className="num" style={{ fontSize: 11, color: "var(--text-mid)" }}>
                {a.condition === "above" ? "≥" : "≤"} ${a.target_price.toFixed(4)}
              </span>
              <button onClick={() => removeAlert(a.id)} style={{
                background: "none", border: "none", color: "var(--text-lo)", fontSize: 14, cursor: "pointer", padding: "0 4px",
              }}>×</button>
            </div>
          ))}
        </div>
      )}

      {alerts.some(a => a.triggered) && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--atm)", marginBottom: 4 }}>
            Triggered
          </div>
          {alerts.filter(a => a.triggered).map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
              <span className="num" style={{ fontSize: 11, color: "var(--atm)" }}>
                {a.condition === "above" ? "≥" : "≤"} ${a.target_price.toFixed(4)}
              </span>
              <button onClick={() => removeAlert(a.id)} style={{
                background: "none", border: "none", color: "var(--text-lo)", fontSize: 14, cursor: "pointer", padding: "0 4px",
              }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
