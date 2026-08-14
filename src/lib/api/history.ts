import { apiGet } from "./client";
import type { HistoryResponse } from "./types";

export function getHistory(token: string): Promise<HistoryResponse> {
  return apiGet("/api/v1/history", token);
}
