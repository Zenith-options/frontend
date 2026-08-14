import { useEffect, useState } from "react";
import { subscribeToSpotFeed } from "../api/ws";
import type { SpotResponse } from "../api/types";

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000]; // caps at 10s between attempts

export type SpotFeedStatus = "connecting" | "open" | "closed";

/**
 * Subscribes once to the backend's live spot-price WebSocket feed and
 * reconnects with backoff if the connection drops — a dev-server
 * restart, a laptop sleeping, or the backend itself restarting are all
 * realistic enough that "just open it once" isn't good enough for
 * something billed as a live feed.
 */
export function useSpotFeed(): { data: SpotResponse | null; status: SpotFeedStatus } {
  const [data, setData] = useState<SpotResponse | null>(null);
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

  return { data, status };
}
