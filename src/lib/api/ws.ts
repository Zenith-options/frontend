import { wsUrl } from "./client";
import type { SpotResponse } from "./types";

/**
 * Subscribes to the backend's live spot-price feed. Calls `onUpdate`
 * with every snapshot (the immediate one on connect, then a tick every
 * ~2s) and returns a cleanup function that closes the socket.
 */
export function subscribeToSpotFeed(onUpdate: (data: SpotResponse) => void): () => void {
  const socket = new WebSocket(wsUrl("/api/v1/ws/spot"));

  socket.onmessage = (event) => {
    try {
      onUpdate(JSON.parse(event.data));
    } catch {
      // Ignore a malformed frame rather than tearing down the socket.
    }
  };

  return () => socket.close();
}
