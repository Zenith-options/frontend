"use client";

export function ExportButton({ onClick, label = "Export CSV", disabled = false, busy = false }: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  /** Shows a working state (e.g. while a PDF renders) and blocks double clicks. */
  busy?: boolean;
}) {
  const off = disabled || busy;
  return (
    <button onClick={onClick} disabled={off} aria-busy={busy || undefined} style={{
      fontSize: 11, color: "var(--text-mid)", background: "none",
      border: "1px solid var(--border-default)", padding: "5px 12px",
      cursor: off ? "default" : "pointer", opacity: off ? 0.5 : 1,
    }}>
      {busy ? "Generating…" : label}
    </button>
  );
}
