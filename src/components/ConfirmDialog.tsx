"use client";
import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel",
  danger = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    // Focus the cancel button first (safer default for destructive actions)
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusable?.[0]?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
      if (e.key !== "Tab") return;
      const all = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (!all.length) return;
      const first = all[0]; const last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [open, onCancel]);

  useEffect(() => {
    if (!open && returnFocusRef.current instanceof HTMLElement) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const focusStyle = { outline: "2px solid var(--brand)", outlineOffset: "2px" };
  const noOutline = { outline: "none" };

  return (
    <div
      role="presentation"
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={body ? "confirm-dialog-body" : undefined}
        style={{
          width: 420, maxWidth: "90vw",
          background: "var(--bg-raised)",
          border: `1px solid ${danger ? "var(--put)" : "var(--border-default)"}`,
          padding: 24,
        }}
      >
        <h2
          id="confirm-dialog-title"
          style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: danger ? "var(--put)" : "var(--text-hi)" }}
        >
          {title}
        </h2>
        {body && (
          <p id="confirm-dialog-body" style={{ margin: "0 0 20px", fontSize: 13, color: "var(--text-mid)", lineHeight: 1.5 }}>
            {body}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 18px", background: "none", border: "1px solid var(--border-default)",
              color: "var(--text-mid)", fontSize: 12, fontWeight: 600, cursor: "pointer", outline: "none",
            }}
            onFocus={e => Object.assign(e.currentTarget.style, focusStyle)}
            onBlur={e => Object.assign(e.currentTarget.style, noOutline)}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "6px 18px",
              background: danger ? "var(--put)" : "var(--brand)",
              color: "var(--bg)", border: "none",
              fontSize: 12, fontWeight: 700, cursor: "pointer", outline: "none",
            }}
            onFocus={e => Object.assign(e.currentTarget.style, focusStyle)}
            onBlur={e => Object.assign(e.currentTarget.style, noOutline)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
