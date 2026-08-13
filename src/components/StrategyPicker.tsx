"use client";

import { STRATEGY_TEMPLATES, type StrategyTemplate } from "../lib/strategies";

interface Props {
  selectedId: string | null;
  onSelect: (template: StrategyTemplate) => void;
}

export function StrategyPicker({ selectedId, onSelect }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {STRATEGY_TEMPLATES.map(t => (
        <button key={t.id} onClick={() => onSelect(t)} style={{
          textAlign: "left", padding: "12px 14px", border: "1px solid var(--border-default)",
          background: selectedId === t.id ? "var(--bg-overlay)" : "var(--bg-raised)",
          cursor: "pointer",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)", marginBottom: 4 }}>{t.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-mid)", lineHeight: 1.5 }}>{t.description}</div>
          <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 6 }}>{t.legs.length} legs</div>
        </button>
      ))}
    </div>
  );
}
