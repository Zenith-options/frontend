import { apiGet } from "./client";
import { MAX_PAGE_SIZE } from "./positions";
import type { HistoryResponse, Position } from "./types";

export function getHistory(token: string, page?: { limit?: number; offset?: number }): Promise<HistoryResponse> {
  const q = new URLSearchParams();
  if (page?.limit !== undefined) q.set("limit", String(page.limit));
  if (page?.offset !== undefined) q.set("offset", String(page.offset));
  const qs = q.toString();
  return apiGet(`/api/v1/history${qs ? `?${qs}` : ""}`, token);
}

/**
 * The full closed/rolled ledger. /history returns 50 rows by default
 * (200 max) — statements need every row, so this pages through until
 * the backend says there's nothing left.
 */
export async function getFullHistory(token: string): Promise<Position[]> {
  const all: Position[] = [];
  for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
    const page = await getHistory(token, { limit: MAX_PAGE_SIZE, offset });
    all.push(...page.trades);
    const more = page.has_more ?? page.trades.length === MAX_PAGE_SIZE;
    if (!more || page.trades.length === 0) return all;
  }
}
