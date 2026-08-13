"use client";

import { useAlertsStore } from "../lib/store/alerts";

export function AlertsPanel({ sym }: { sym: string }) {
  const alerts = useAlertsStore(s => s.alerts.filter(a => a.sym === sym));

  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)", marginBottom: 8 }}>
        Price Alerts
      </div>
      {alerts.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-lo)" }}>No alerts set for {sym}.</div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--text-mid)" }}>{alerts.length} alert{alerts.length === 1 ? "" : "s"}</div>
      )}
    </div>
  );
}
