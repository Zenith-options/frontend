"use client";

import { createContext, useContext } from "react";
import { useSpotFeed, type SpotFeedStatus } from "../hooks/useSpotFeed";
import type { SpotResponse } from "../api/types";

interface SpotFeedData {
  data: SpotResponse | null;
  status: SpotFeedStatus;
}

const SpotFeedContext = createContext<SpotFeedData | null>(null);

/**
 * One shared WebSocket connection for the whole app, mounted at the
 * root — options and portfolio both need live spot/vol data, and
 * without this each would open its own independent socket to the same
 * feed for no benefit (same broadcast, same reconnect logic, just
 * duplicated).
 */
export function SpotFeedProvider({ children }: { children: React.ReactNode }) {
  const feed = useSpotFeed();
  return <SpotFeedContext.Provider value={feed}>{children}</SpotFeedContext.Provider>;
}

export function useSpotFeedContext(): SpotFeedData {
  const ctx = useContext(SpotFeedContext);
  if (!ctx) throw new Error("useSpotFeedContext must be used within SpotFeedProvider");
  return ctx;
}
