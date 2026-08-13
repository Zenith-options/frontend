"use client";

import { useEffect, useState } from "react";
import { useAlertsStore, type AlertDirection } from "../lib/store/alerts";
import { requestNotificationPermission, sendNotification } from "../lib/notify";

export function AlertsPanel({ sym, spot }: { sym: string; spot: number }) {
  const alerts = useAlertsStore(s => s.alerts.filter(a => a.sym === sym));
  const addAlert = useAlertsStore(s => s.addAlert);
  const removeAlert = useAlertsStore(s => s.removeAlert);
  const markTriggered = useAlertsStore(s => s.markTriggered);
  const [price, setPrice] = useState(() => spot.toFixed(4));
  const [direction, setDirection] = useState<AlertDirection>("above");

  // Evaluate this symbol's still-active alerts against the live spot on every tick.
  useEffect(() => {
    for (const a of alerts) {
      if (a.triggeredAt) continue;
      const hit = a.direction === "above" ? spot >= a.targetPrice : spot <= a.targetPrice;
      if (hit) {
        markTriggered(a.id);
        sendNotification(`${sym} ${a.direction} $${a.targetPrice.toFixed(4)}`, `Spot is now $${spot.toFixed(4)}`);
      }
    }
  }, [spot, alerts, markTriggered, sym]);

  const submit = () => {
    const target = parseFloat(price);
    if (!target || target <= 0) return;
    requestNotificationPermission();
    addAlert(sym, target, direction);
  };

  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)", marginBottom: 8 }}>
        Price Alerts
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <select value={direction} onChange={e => setDirection(e.target.value as AlertDirection)} style={{
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
        <button onClick={submit} style={{
          background: "var(--brand)", color: "var(--bg)", border: "none", fontSize: 11, fontWeight: 700,
          padding: "4px 10px", cursor: "pointer",
        }}>Add</button>
      </div>

      {alerts.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-lo)" }}>No alerts set for {sym}.</div>
      ) : (
        <div>
          {alerts.filter(a => !a.triggeredAt).map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
              <span className="num" style={{ fontSize: 11, color: "var(--text-mid)" }}>
                {a.direction === "above" ? "≥" : "≤"} ${a.targetPrice.toFixed(4)}
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
