"use client";

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../lib/hooks/useFocusTrap";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the sheet. */
  title: string;
  children: React.ReactNode;
  testId?: string;
}

const DISMISS_FRACTION = 0.25; // dragged down past a quarter of its height
const DISMISS_VELOCITY = 0.6;  // px/ms flick

/**
 * Modal sheet anchored to the bottom of the screen (the phone order ticket).
 * Focus-trapped, Escape/backdrop to close, drag the handle down to dismiss.
 * Sits above the safe-area inset and lifts itself above the on-screen
 * keyboard (visualViewport), so the quantity input is never covered.
 */
export function BottomSheet({ open, onClose, title, children, testId = "bottom-sheet" }: Props) {
  const panelRef = useFocusTrap<HTMLDivElement>(open);
  const [dragY, setDragY] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const drag = useRef<{ startY: number; startT: number; lastY: number; lastT: number } | null>(null);

  // Lock page scroll behind the sheet.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Virtual keyboard: visualViewport shrinks when it opens; the gap between
  // the layout viewport's bottom and the visual viewport's bottom is how
  // much of the sheet the keyboard would cover.
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => setKeyboardInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setDragY(0);
  }, [open]);

  if (!open) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const now = performance.now();
    drag.current = { startY: e.clientY, startT: now, lastY: e.clientY, lastT: now };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.lastY = e.clientY;
    drag.current.lastT = performance.now();
    setDragY(Math.max(0, e.clientY - drag.current.startY));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const height = panelRef.current?.offsetHeight ?? 1;
    const dy = d.lastY - d.startY;
    const velocity = dy / Math.max(1, d.lastT - d.startT);
    if (dy > height * DISMISS_FRACTION || velocity > DISMISS_VELOCITY) onClose();
    else setDragY(0);
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="sheet-panel"
        onKeyDown={e => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        onFocus={e => {
          // Keep a focused field visible above the keyboard.
          const el = e.target as HTMLElement;
          if (el.tagName === "INPUT") setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
        }}
        style={{
          bottom: keyboardInset,
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current ? "none" : undefined,
        }}
      >
        <div
          className="sheet-handle"
          role="button"
          tabIndex={0}
          aria-label={`Close ${title}`}
          data-focus-skip
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}
