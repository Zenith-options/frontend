"use client";

import { useId } from "react";
import { useFocusTrap } from "../lib/hooks/useFocusTrap";
import { ModeStamp } from "./env/ModeStamp";

interface Props {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  disabledReason?: string;
  /** Plain-language description of what confirming will do (see describeTrade). */
  summary?: React.ReactNode;
  /** Trade is simulated locally (onboarding practice mode) — never sent. */
  practice?: boolean;
  /** Enter confirms while focus is on the dialog itself. Off for decisions
   *  that should need a deliberate click (e.g. switching to mainnet). */
  enterToConfirm?: boolean;
  /** Anchor for the onboarding tour. */
  tourId?: string;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  title, confirmLabel, onConfirm, onCancel, disabled, disabledReason,
  summary, practice = false, enterToConfirm = true, tourId, children,
}: Props) {
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const titleId = useId();
  const summaryId = useId();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
    // Only when the panel itself has focus — Enter on a focused button
    // already activates that button, and must not *also* confirm.
    if (e.key === "Enter" && enterToConfirm && e.target === panelRef.current && !disabled) onConfirm();
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summary ? summaryId : undefined}
        tabIndex={-1}
        data-autofocus
        data-tour={tourId}
        className="dialog-panel"
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <ModeStamp practice={practice} />
        <h2 id={titleId} style={{ fontSize: 14, fontWeight: 700, color: "var(--text-hi)", marginBottom: 14 }}>{title}</h2>
        {summary && (
          <div id={summaryId} data-testid="trade-summary" style={{
            fontSize: 12, lineHeight: 1.55, color: "var(--text-hi)", padding: "10px 12px", marginBottom: 12,
            background: "var(--bg-overlay)", borderLeft: "2px solid var(--brand)",
          }}>
            {summary}
          </div>
        )}
        {children}
        {disabled && disabledReason && (
          <div role="alert" style={{ marginTop: 10, fontSize: 11, color: "var(--put)" }}>{disabledReason}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" className="tap" onClick={onCancel} style={{
            flex: 1, padding: "9px 0", background: "none", border: "1px solid var(--border-default)",
            color: "var(--text-mid)", fontSize: 12, cursor: "pointer",
          }}>Cancel</button>
          <button type="button" className="tap" onClick={onConfirm} disabled={disabled} style={{
            flex: 1, padding: "9px 0", background: "var(--brand)", border: "none",
            color: "var(--bg)", fontSize: 12, fontWeight: 700,
            cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
