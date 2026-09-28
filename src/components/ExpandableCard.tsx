"use client";

import { useId, useState } from "react";

export interface CardField {
  label: React.ReactNode;
  value: React.ReactNode;
}

/**
 * Phone replacement for a table row: a one-line summary that expands to the
 * full set of columns. The summary is a real button (aria-expanded), so the
 * card works with a keyboard and screen reader, and it's ≥44px tall.
 */
export function ExpandableCard({ title, meta, trailing, fields, actions, defaultOpen = false, children, testId }: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  fields: CardField[];
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  /** Extra expanded content (e.g. the roll editor). */
  children?: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const detailsId = useId();
  return (
    <div className="rl-card" data-testid={testId}>
      <button type="button" className="rl-card-summary" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(o => !o)}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{title}</span>
          {meta && <span style={{ fontSize: 11, color: "var(--text-mid)" }}>{meta}</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {trailing}
          <span aria-hidden style={{ color: "var(--text-lo)", fontSize: 12, transform: open ? "rotate(180deg)" : undefined }}>▾</span>
        </span>
      </button>
      {open && (
        <div id={detailsId}>
          <dl className="rl-card-details">
            {fields.map((f, i) => (
              <div key={i}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
            {actions && <div className="rl-card-actions">{actions}</div>}
          </dl>
          {children}
        </div>
      )}
    </div>
  );
}
