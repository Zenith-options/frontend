"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { useBackendData } from "../lib/context/BackendDataContext";
import { fmtN } from "../lib/pricing";
import { EnvironmentSelector } from "./env/EnvironmentSelector";
import { Skeleton } from "./states";
import { HelpMenu } from "../features/onboarding/HelpMenu";

const TABS = [
  { label: "Chain", href: "/options", tour: "nav-chain" },
  { label: "Portfolio", href: "/portfolio", tour: "portfolio" },
  { label: "History", href: "/history", tour: "nav-history" },
];

/**
 * The account chip's four states. Never renders a balance it doesn't
 * have: while loading it's a same-size skeleton, not "$0.00".
 */
export function AccountChip() {
  const { authStatus, accountQuery } = useBackendData();
  const label = <span style={{ fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Balance</span>;

  if (authStatus === "signed-out") {
    return (
      <span data-testid="account-chip" data-state="signed-out" style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
        {label}
        <span style={{ fontSize: 11, color: "var(--text-lo)" }}>Not signed in</span>
      </span>
    );
  }

  const account = accountQuery.data;
  if (!account && accountQuery.status === "error") {
    return (
      <span data-testid="account-chip" data-state="error" role="alert" style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
        {label}
        <span style={{ fontSize: 11, color: "var(--put)" }}>Unavailable</span>
        <button type="button" onClick={accountQuery.refetch} aria-label="Retry loading balance" className="tap" style={{
          background: "none", border: "1px solid var(--border-default)", color: "var(--text-mid)", fontSize: 11, cursor: "pointer", padding: "0 6px",
        }}>↻</button>
      </span>
    );
  }

  if (!account) {
    return (
      <span data-testid="account-chip" data-state="loading" role="status" aria-busy="true" style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
        {label}
        <span className="sr-only">Loading balance</span>
        <Skeleton width={72} height={14} />
      </span>
    );
  }

  return (
    <Link href="/portfolio" title="Go to portfolio" data-testid="account-chip" data-state="ready" style={{
      display: "flex", alignItems: "center", gap: 6, textDecoration: "none", whiteSpace: "nowrap",
    }}>
      {label}
      <span className="num" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>${fmtN(account.balance, 2)}</span>
      {account.collateral_locked > 0 && (
        <span className="num" style={{ fontSize: 10, color: "var(--atm)" }}>(${fmtN(account.collateral_locked, 2)} locked)</span>
      )}
    </Link>
  );
}

/**
 * `children` are page-specific controls (market selector, expiries,
 * wallet). On tablets/phones they move to their own horizontally
 * scrollable row under the nav instead of overflowing the header.
 */
export function AppHeader({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="app-header">
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
        <Logo size={16} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--font-serif)" }}>Zenith</span>
      </Link>
      <EnvironmentSelector />
      <div className="app-header-sep" />
      <nav className="app-header-nav" aria-label="Terminal">
        {TABS.map(tab => {
          const active = pathname?.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} data-tour={tab.tour} aria-current={active ? "page" : undefined} style={{
              padding: "4px 10px", fontSize: 12, fontWeight: 600, textDecoration: "none",
              color: active ? "var(--text-hi)" : "var(--text-mid)",
              borderBottom: active ? "2px solid var(--brand)" : "2px solid transparent",
            }}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="app-header-sep" />
      <AccountChip />
      <HelpMenu />
      <div className="app-header-sep" />
      <div className="app-header-extra">{children}</div>
    </header>
  );
}
