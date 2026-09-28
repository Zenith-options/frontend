import { wsUrl } from "./client";
import type { SpotResponse } from "./types";

/**
 * Subscribes to the backend's live spot-price feed. Calls `onUpdate`
 * with every snapshot (the immediate one on connect, then a tick every
 * ~2s) and `onClose` once if the connection drops or fails to open
 * (callers that want to reconnect should do so from there — this
 * function itself doesn't retry). Returns a cleanup function that
 * closes the socket and suppresses the pending onClose call.
 */
export function subscribeToSpotFeed(onUpdate: (data: SpotResponse) => void, onClose?: () => void): () => void {
  const url = wsUrl("/api/v1/ws/spot");
  let closed = false;
  if (!url) {
    // No backend for this mode — report "closed" asynchronously, same as a
    // failed connection, so callers only have one code path to handle.
    const id = setTimeout(() => { if (!closed) { closed = true; onClose?.(); } }, 0);
    return () => { closed = true; clearTimeout(id); };
  }
  const socket = new WebSocket(url);

  socket.onmessage = (event) => {
    try {
      onUpdate(JSON.parse(event.data));
    } catch {
      // Ignore a malformed frame rather than tearing down the socket.
    }
  };

  const handleClose = () => {
    if (closed) return;
    closed = true;
    onClose?.();
  };
  socket.onclose = handleClose;
  socket.onerror = handleClose;

  return () => {
    closed = true; // cleanup shouldn't trigger the caller's reconnect logic
    socket.close();
  };
}
