"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { useBackendData } from "../lib/context/BackendDataContext";
import { fmtN } from "../lib/pricing";

const TABS = [
  { label: "Chain", href: "/options" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "History", href: "/history" },
];

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  // BackendDataProvider already handles the hydration-safety gating
  // (null token pre-hydration) — this just reads its shared result.
  const { account } = useBackendData();
  const balance = account?.balance ?? 0;
  const collateralLocked = account?.collateral_locked ?? 0;

  // Layout: single flat row on desktop (the .app-header-row / .app-header-context
  // wrappers are `display: contents` there, so the DOM order is exactly what it
  // always was). Below 1024px the header stacks: nav row on top, page context
  // in a horizontally scrollable strip underneath — no page-level overflow.
  return (
    <header className="app-header">
      <div className="app-header-row">
        <Link href="/" className="app-header-brand">
          <Logo size={16} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--font-serif)" }}>Zenith</span>
        </Link>
        <div className="app-header-sep wide-only" />
        <nav className="app-header-tabs">
          {TABS.map(tab => (
            <Link key={tab.href} href={tab.href} className="app-header-tab" style={{
              padding: "4px 10px",
              fontSize: 12, fontWeight: 600,
              color: pathname?.startsWith(tab.href) ? "var(--text-hi)" : "var(--text-mid)",
              borderBottom: pathname?.startsWith(tab.href) ? "2px solid var(--brand)" : "2px solid transparent",
            }}>
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="app-header-sep wide-only" />

        <Link href="/portfolio" title="Go to portfolio" className="app-header-balance">
          <span className="wide-only" style={{ fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Balance</span>
          <span className="num" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>${fmtN(balance,2)}</span>
          {collateralLocked > 0 && (
            <span className="num wide-only" style={{ fontSize: 10, color: "var(--atm)" }}>(${fmtN(collateralLocked,2)} locked)</span>
          )}
        </Link>
        <div className="app-header-sep wide-only" />
      </div>

      <div className="app-header-context">{children}</div>
    </header>
  );
}
