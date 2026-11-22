"use client";

import { useState } from "react";
import { ChainTable } from "./_components/ChainTable";
import { ViewTabs } from "./_components/ViewTabs";
import type { TradeState, ViewTab } from "./_components/types";

export default function OptionsPage() {
  const [viewTab, setViewTab] = useState<ViewTab>("chain");
  const [, setTrade] = useState<TradeState | null>(null);
  return (
    <>
      <a href="#options-main" className="skip-link">
        Skip to main content
      </a>
      <main id="options-main" tabIndex={-1} style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        {/* shortcut: chain data hook (useOptionChain.ts) is empty upstream, so the chain renders headers only until it lands. */}
        <ViewTabs viewTab={viewTab} setViewTab={setViewTab} sym="XLM" expiryLabel="—" strikes={0} />
        {viewTab === "chain" && <ChainTable chain={[]} chainLoading={false} setTrade={setTrade} />}
      </main>
    </>
  );
}
