import { useEffect, useState } from "react";
import { subscribeToSpotFeed } from "../api/ws";
import type { SpotResponse } from "../api/types";

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000]; // caps at 10s between attempts
/** ~10 minutes of 2s ticks per symbol, for sparklines. */
export const SESSION_BUFFER_POINTS = 300;

export type SpotFeedStatus = "connecting" | "open" | "closed";

export interface SessionTick {
  t: number;
  price: number;
}

/**
 * Everything the feed has shown this browser session, per symbol: a
 * rolling tick buffer plus the first price seen. The backend has no 24h
 * change, so "change" in the UI is measured from `open` and labelled as
 * session change.
 */
export interface SessionBuffer {
  ticks: Record<string, SessionTick[]>;
  open: Record<string, SessionTick>;
}

export function appendSessionTicks(buf: SessionBuffer, prices: Record<string, number>, t: number): SessionBuffer {
  const ticks = { ...buf.ticks };
  const open = { ...buf.open };
  for (const [sym, price] of Object.entries(prices)) {
    if (!Number.isFinite(price)) continue;
    ticks[sym] = [...(ticks[sym] ?? []), { t, price }].slice(-SESSION_BUFFER_POINTS);
    open[sym] ??= { t, price };
  }
  return { ticks, open };
}

const EMPTY_BUFFER: SessionBuffer = { ticks: {}, open: {} };

/**
 * Subscribes once to the backend's live spot-price WebSocket feed and
 * reconnects with backoff if the connection drops — a dev-server
 * restart, a laptop sleeping, or the backend itself restarting are all
 * realistic enough that "just open it once" isn't good enough for
 * something billed as a live feed.
 */
export function useSpotFeed(): { data: SpotResponse | null; status: SpotFeedStatus; session: SessionBuffer } {
  const [data, setData] = useState<SpotResponse | null>(null);
  const [session, setSession] = useState<SessionBuffer>(EMPTY_BUFFER);
  const [status, setStatus] = useState<SpotFeedStatus>("connecting");

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let unsubscribe: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      unsubscribe = subscribeToSpotFeed(
        (update) => {
          if (cancelled) return;
          attempt = 0; // a successful message means the connection is healthy again
          setStatus("open");
          setData(update);
          setSession(buf => appendSessionTicks(buf, update.prices, Date.now()));
        },
        () => {
          if (cancelled) return;
          setStatus("closed");
          const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
          attempt += 1;
          retryTimer = setTimeout(connect, delay);
        }
      );
    };

    connect();
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return { data, status, session };
}
