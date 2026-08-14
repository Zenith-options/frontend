import { apiDelete, apiGet, apiPost } from "./client";
import type { WatchlistItem } from "./types";

export function getWatchlist(token: string): Promise<WatchlistItem[]> {
  return apiGet("/api/v1/watchlist", token);
}

export function addToWatchlist(underlying: string, token: string): Promise<void> {
  return apiPost("/api/v1/watchlist", { underlying }, token);
}

export function removeFromWatchlist(underlying: string, token: string): Promise<void> {
  return apiDelete(`/api/v1/watchlist/${underlying}`, token);
}
