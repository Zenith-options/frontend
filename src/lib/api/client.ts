// Thin fetch wrapper for the zenith-backend API. No caching/retry layer —
// callers (stores, components) own their own loading/error state, this
// just standardizes the request/error shape.

import { activeStellarNetwork, env } from "../../env";

interface RuntimeConfig {
  apiUrl: string;
  network: "testnet" | "mainnet";
  rpcUrl: string;
  passphrase: string;
  contractId: string | null;
}

let runtimeConfigPromise: Promise<RuntimeConfig> | undefined;

export function getRuntimeConfig(): Promise<RuntimeConfig> {
  runtimeConfigPromise ??= typeof window === "undefined"
    ? Promise.resolve({
        apiUrl: env.NEXT_PUBLIC_API_URL,
        network: env.NEXT_PUBLIC_STELLAR_NETWORK,
        rpcUrl: activeStellarNetwork.rpcUrl,
        passphrase: activeStellarNetwork.passphrase,
        contractId: activeStellarNetwork.contractId ?? null,
      })
    : fetch("/api/runtime-config", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`Runtime config request failed (${response.status})`);
        return response.json() as Promise<RuntimeConfig>;
      });
  return runtimeConfigPromise;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);

  const { apiUrl } = await getRuntimeConfig();
  const res = await fetch(`${apiUrl}${path}`, { ...init, headers });

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

export async function wsUrl(path: string): Promise<string> {
  const { apiUrl } = await getRuntimeConfig();
  return `${apiUrl.replace(/^http/, "ws")}${path}`;
}
