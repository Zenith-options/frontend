"use client";

import { createContext, useCallback, useContext, useEffect, useState, type RefObject } from "react";
import { useSpotFeed, type SpotFeedStatus } from "../hooks/useSpotFeed";
import type { SpotResponse } from "../api/types";

interface SpotFeedData {
  data: SpotResponse | null;
  status: SpotFeedStatus;
  /** Ask the provider to open the shared socket (idempotent). */
  request: () => void;
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
  // Lazy: the socket opens on first consumer demand (see useSpotFeedContext),
  // not at root mount, so pages that never show live data never connect.
  const [demanded, setDemanded] = useState(false);
  const request = useCallback(() => setDemanded(true), []);
  const feed = useSpotFeed(demanded);
  return <SpotFeedContext.Provider value={{ ...feed, request }}>{children}</SpotFeedContext.Provider>;
}

/**
 * Consume the shared feed. By default the first consumer to mount triggers
 * the connection. Pass `visibleRef` to defer until that element scrolls
 * into the viewport (IntersectionObserver) — used by the landing preview.
 */
export function useSpotFeedContext(visibleRef?: RefObject<Element | null>): SpotFeedData {
  const ctx = useContext(SpotFeedContext);
  if (!ctx) throw new Error("useSpotFeedContext must be used within SpotFeedProvider");
  const { request } = ctx;
  useEffect(() => {
    const el = visibleRef?.current;
    if (!visibleRef) return request();
    if (!el || typeof IntersectionObserver === "undefined") return request();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        request();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [request, visibleRef]);
  return ctx;
}
