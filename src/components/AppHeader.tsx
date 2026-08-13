"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";

const TABS = [
  { label: "Chain", href: "/options" },
  { label: "Portfolio", href: "/portfolio" },
];

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <header style={{
      height: 44, flexShrink: 0, display: "flex", alignItems: "center",
      borderBottom: "1px solid var(--border-default)", padding: "0 16px", gap: 16,
      background: "var(--bg-raised)",
    }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
        <Logo size={16} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--font-serif)" }}>Zenith</span>
      </Link>
      <div style={{ width: 1, height: 20, background: "var(--border-default)" }} />
      <div style={{ display: "flex", gap: 2 }}>
        {TABS.map(tab => (
          <Link key={tab.href} href={tab.href} style={{
            padding: "4px 10px", border: "none", cursor: "pointer",
            fontSize: 12, fontWeight: 600, textDecoration: "none",
            color: pathname?.startsWith(tab.href) ? "var(--text-hi)" : "var(--text-mid)",
            borderBottom: pathname?.startsWith(tab.href) ? "2px solid var(--brand)" : "2px solid transparent",
          }}>
            {tab.label}
          </Link>
        ))}
      </div>
      <div style={{ width: 1, height: 20, background: "var(--border-default)" }} />

      {children}
    </header>
  );
}
