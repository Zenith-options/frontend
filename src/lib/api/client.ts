// Thin fetch wrapper for the zenith-backend API. No caching/retry layer —
// callers (stores, components) own their own loading/error state, this
// just standardizes the request/error shape.
//
// The base URL comes from the active environment mode (src/lib/env) at call
// time, not from a module-level constant: switching modes must immediately
// point every subsequent request at that mode's backend.

import { getCurrentNetwork } from "../env/mode";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/** Status used for "this mode has no backend configured" — never sent by a server. */
export const NOT_CONFIGURED_STATUS = 0;

export function apiBaseUrl(): string {
  const network = getCurrentNetwork();
  if (!network.apiUrl) {
    // Refuse rather than fall back to another mode's backend: a missing
    // mainnet URL must not quietly route mainnet traffic to paper (or the
    // other way round).
    throw new ApiError(NOT_CONFIGURED_STATUS, `No backend is configured for ${network.label}.`);
  }
  return network.apiUrl;
}

async function request<T>(path: string, init: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });

  if (!res.ok) {
    let message = res.statusText || `request failed with ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // Body wasn't JSON (or was empty) — keep the statusText fallback.
    }
    throw new ApiError(res.status, message);
  }

  // Some successful responses (e.g. POST /watchlist's 201, DELETE's 204)
  // have no body at all — checking status codes for this is brittle
  // (easy to miss one), so just check whether there's actually anything
  // to parse instead.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function apiGet<T>(path: string, token?: string | null): Promise<T> {
  return request<T>(path, { method: "GET" }, token);
}

export function apiPost<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
  return request<T>(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    token
  );
}

export function apiDelete<T>(path: string, token?: string | null): Promise<T> {
  return request<T>(path, { method: "DELETE" }, token);
}

/** WebSocket URL for the active mode, or null when it has no backend configured. */
export function wsUrl(path: string): string | null {
  const base = getCurrentNetwork().apiUrl;
  return base ? `${base.replace(/^http/, "ws")}${path}` : null;
}
