"use client";

import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { useBackendHistory } from "../../lib/hooks/useBackendHistory";
import { useWalletStore } from "../../lib/store/wallet";
import { useHydrated } from "../../lib/useHydrated";
import { useBackendData } from "../../lib/context/BackendDataContext";
import { useEnvironment } from "../../lib/context/EnvironmentContext";
import { fmtN, fmtK } from "../../lib/pricing";
import { toCsv, downloadCsv } from "../../lib/csv";
import { ExportButton } from "../../components/ExportButton";
import { ExpandableCard } from "../../components/ExpandableCard";
import { AuthGate, DataBoundary, EmptyState, SkeletonRegion, Skeleton, SkeletonRows } from "../../components/states";
import { Term } from "../../features/onboarding/Term";
import type { Position } from "../../lib/api/types";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const fmtPnl = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}$${fmtN(Math.abs(v), 2)}`);
const pnlColor = (v: number | null) => (v === null ? "var(--text-lo)" : v >= 0 ? "var(--call)" : "var(--put)");

function Badge({ tone, children }: { tone: "call" | "put"; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 6px", textTransform: "uppercase",
      background: tone === "call" ? "var(--call-dim)" : "var(--put-dim)", color: tone === "call" ? "var(--call)" : "var(--put)",
    }}>{children}</span>
  );
}

function HistorySkeleton() {
  return (
    <>
      <SkeletonRegion label="Loading trade stats" style={{ marginBottom: 24 }} testId="history-stats-skeleton">
        <div className="stat-bar">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i}><Skeleton height={10} width={90} style={{ marginBottom: 8 }} /><Skeleton height={17} width={70} /></div>
          ))}
        </div>
      </SkeletonRegion>
      <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
        <SkeletonRows rows={8} rowHeight={37} columns={9} label="Loading trade history" testId="history-skeleton" />
      </div>
    </>
  );
}

export default function HistoryPage() {
  const hydrated = useHydrated();
  const token = useWalletStore(s => s.token);
  const { authStatus } = useBackendData();
  const { network } = useEnvironment();
  const { trades, stats, query } = useBackendHistory(hydrated ? token : null);

  const subtitle =
    authStatus === "signed-out" ? "Connect your wallet to see your trade history."
    : query.data ? `${trades.length} closed trade${trades.length === 1 ? "" : "s"}`
    : query.status === "error" ? "Trade history couldn't be loaded."
    : "Loading your trade history…";

  return (
    <div className="app-shell">
      <AppHeader>
        <div style={{ marginLeft: "auto" }}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="page-pad" style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 64px" }}>
          <div className="page-title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Trade History</h1>
              <p style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 28 }}>{subtitle}</p>
            </div>
            {trades.length > 0 && (
              <ExportButton onClick={() => downloadCsv(
                `zenith-${network.mode}-history-${new Date().toISOString().slice(0, 10)}.csv`,
                toCsv(trades, [
                  { header: "Opened", value: r => r.opened_at },
                  { header: "Closed", value: r => r.closed_at ?? "" },
                  { header: "Asset", value: r => r.underlying },
                  { header: "Type", value: r => r.position_type },
                  { header: "Side", value: r => r.option_type },
                  { header: "Status", value: r => r.status },
                  { header: "Strike", value: r => r.strike },
                  { header: "Expiry Days", value: r => r.expiry_days },
                  { header: "Qty", value: r => r.contracts },
                  { header: "Entry Premium", value: r => r.entry_premium },
                  { header: "Close Premium", value: r => r.close_premium ?? "" },
                  { header: "Realized P&L", value: r => r.realized_pnl ?? "" },
                ])
              )} />
            )}
          </div>

          <DataBoundary
            query={query}
            auth={authStatus}
            skeleton={<HistorySkeleton />}
            signedOut={<AuthGate title="Connect your wallet to see your trade history" description={`Closed and rolled trades on ${network.label} are tied to your wallet's session.`} />}
            errorTitle="Couldn't load trade history"
            isEmpty={d => d.trades.length === 0}
            empty={<EmptyState title="No trades yet" description="Trades you close or roll show up here with their realized P&L." action={{ label: "Open the options chain →", href: "/options" }} testId="history-empty" />}
          >
            {() => (
              <>
                <div className="stat-bar" style={{ marginBottom: 24 }} data-testid="history-stats">
                  {[
                    { label: "Closed Trades", value: String(stats.trade_count), color: "var(--text-hi)" },
                    { label: <Term id="realized-pnl">Total Realized P&amp;L</Term>, value: fmtPnl(stats.total_realized_pnl), color: pnlColor(stats.total_realized_pnl) },
                    { label: "Win Rate", value: `${stats.trade_count > 0 ? ((stats.win_count / stats.trade_count) * 100).toFixed(0) : "0"}%`, color: "var(--atm)" },
                  ].map((s, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 6 }}>{s.label}</div>
                      <div className="num" style={{ fontSize: 17, fontWeight: 600, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                <div className="responsive-list" data-testid="history-list">
                  <div className="rl-table" style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                          {["Closed", "Asset", "Type", "Side", "Status", "Strike", "Expiry", "Qty", "Entry", "Close", "Realized P&L"].map(h => (
                            <th key={h} style={{ padding: "8px 10px", fontSize: 10, fontWeight: 500, textTransform: "uppercase",
                              letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "right", background: "var(--bg-overlay)" }}>
                              {h === "Realized P&L" ? <Term id="realized-pnl">{h}</Term> : h === "Strike" ? <Term id="strike">{h}</Term> : h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map(r => (
                          <tr key={r.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-mid)" }}>{fmtDate(r.closed_at)}</td>
                            <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{r.underlying}</td>
                            <td style={{ padding: "8px 10px" }}><Badge tone={r.position_type === "short" ? "put" : "call"}>{r.position_type}</Badge></td>
                            <td style={{ padding: "8px 10px" }}><Badge tone={r.option_type}>{r.option_type}</Badge></td>
                            <td style={{ padding: "8px 10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)", textTransform: "capitalize" }}>{r.status}</td>
                            <td className="num" style={{ padding: "8px 10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>{fmtK(r.strike)}</td>
                            <td style={{ padding: "8px 10px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{r.expiry_days}D</td>
                            <td className="num" style={{ padding: "8px 10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>{r.contracts}</td>
                            <td className="num" style={{ padding: "8px 10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>${fmtN(r.entry_premium * r.contracts, 2)}</td>
                            <td className="num" style={{ padding: "8px 10px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>
                              {r.close_premium === null ? "—" : `$${fmtN(r.close_premium * r.contracts, 2)}`}
                            </td>
                            <td className="num" style={{ padding: "8px 10px", fontSize: 11, textAlign: "right", fontWeight: 600, color: pnlColor(r.realized_pnl) }}>
                              {fmtPnl(r.realized_pnl)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rl-cards">
                    {trades.map((r: Position) => (
                      <ExpandableCard
                        key={r.id}
                        testId="history-card"
                        title={<>{r.underlying} <Badge tone={r.position_type === "short" ? "put" : "call"}>{r.position_type}</Badge> <Badge tone={r.option_type}>{r.option_type}</Badge></>}
                        meta={<span className="num">K={fmtK(r.strike)} · {fmtDate(r.closed_at)}</span>}
                        trailing={<span className="num" style={{ fontSize: 13, fontWeight: 600, color: pnlColor(r.realized_pnl) }}>{fmtPnl(r.realized_pnl)}</span>}
                        fields={[
                          { label: "Status", value: <span style={{ textTransform: "capitalize" }}>{r.status}</span> },
                          { label: "Expiry", value: `${r.expiry_days}D` },
                          { label: "Qty", value: r.contracts },
                          { label: "Opened", value: fmtDate(r.opened_at) },
                          { label: "Entry", value: `$${fmtN(r.entry_premium * r.contracts, 2)}` },
                          { label: "Close", value: r.close_premium === null ? "—" : `$${fmtN(r.close_premium * r.contracts, 2)}` },
                        ]}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </DataBoundary>
        </div>
      </div>
    </div>
  );
}
