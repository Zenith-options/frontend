"use client";

import { useEffect } from "react";
import type { SorobanFeeBreakdown } from "../lib/soroban/types";
import { FeeSurface } from "./FeeSurface";

interface Props {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  disabledReason?: string;
  children: React.ReactNode;
  /**
   * Soroban fee breakdown surfaced from simulation.
   * When provided, a FeeSurface is rendered before the action buttons.
   */
  fees?: SorobanFeeBreakdown | null;
  /**
   * XLM balance of the signer — passed to FeeSurface for reserve warnings.
   */
  xlmBalance?: number;
  /**
   * Called when the user changes fee priority inside the FeeSurface.
   * Only meaningful when `fees` is provided.
   */
  onPriorityChange?: (priority: "standard" | "fast") => void;
}

export function ConfirmDialog({
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  disabled,
  disabledReason,
  children,
  fees,
  xlmBalance,
  onPriorityChange,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && !disabled) onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm, disabled]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-default)",
          padding: 20,
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-hi)", marginBottom: 14 }}>
          {title}
        </div>

        {children}

        {/* Fee breakdown — shown once simulation results are available */}
        {fees && (
          <FeeSurface
            fees={fees}
            xlmBalance={xlmBalance}
            onPriorityChange={onPriorityChange}
          />
        )}

        {disabled && disabledReason && (
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--put)" }}>
            {disabledReason}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: "9px 0", background: "none",
              border: "1px solid var(--border-default)",
              color: "var(--text-mid)", fontSize: 12, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            style={{
              flex: 1, padding: "9px 0", background: "var(--brand)", border: "none",
              color: "var(--bg)", fontSize: 12, fontWeight: 700,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
