// Fetch wrapper for the zenith-backend API. Standardizes the request/error
// shape, validates responses at runtime when a schema is passed
// (ContractError), and runs every request through the resilience stack in
// ./resilience (dedup → retry → circuit breaker → timeout). See
// docs/api-resilience.md for the full policy.
import type { z } from "zod";
import { ContractError, reportContractError } from "./contractError";
import {
  CircuitOpenError,
  createResilientFetch,
  IDEMPOTENCY_HEADER,
  parseRetryAfter,
  RateLimitedError,
  TimeoutError,
  type Fetcher,
} from "./resilience";
import { safeText } from "../sanitize";

type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

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

/** Why the client (not the backend) failed a request, when it did. */
export type ApiErrorReason = "timeout" | "circuit_open" | "rate_limited";

export class ApiError extends Error {
  status: number;
  /** Server-requested backoff (Retry-After) or time until the circuit re-probes. */
  retryAfterMs?: number;
  reason?: ApiErrorReason;
  constructor(status: number, message: string, extra: { retryAfterMs?: number; reason?: ApiErrorReason } = {}) {
    super(message);
    this.status = status;
    this.retryAfterMs = extra.retryAfterMs;
    this.reason = extra.reason;
    this.name = "ApiError";
  }
}

/** Per-call options. Callers pass TanStack Query's `signal` so unmounted queries cancel. */
export interface RequestOptions {
  signal?: AbortSignal;
  /** Per-attempt timeout in ms (default 10s). */
  timeoutMs?: number;
  /**
   * For POSTs that create effects (open/close/roll/claim). Must be stable
   * across resubmits of the same intent — use IntentKeyManager /
   * useIdempotencyKey rather than minting one per call.
   */
  idempotencyKey?: string;
  /** Disable automatic retries for this GET. POSTs are never retried. */
  noRetry?: boolean;
}

let transport: Fetcher = createResilientFetch();

/** Test seam: swap the resilience stack (e.g. with fake timers / custom options). */
export function setApiTransport(next: Fetcher) {
  transport = next;
}

/**
 * Injected by the wallet store (keeps this layer from importing it and
 * creating a cycle). Resolves to a fresh token, or null if the user
 * rejected / re-auth failed.
 */
type UnauthorizedHandler = () => Promise<string | null>;
let onUnauthorized: UnauthorizedHandler | null = null;
let reauthInFlight: Promise<string | null> | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

/** Single-flight: every concurrent 401 awaits the same re-auth call. */
function reauthenticate(): Promise<string | null> {
  if (!onUnauthorized) return Promise.resolve(null);
  if (!reauthInFlight) {
    reauthInFlight = onUnauthorized()
      .catch(() => null)
      .finally(() => {
        reauthInFlight = null;
      });
  }
  return reauthInFlight;
}

/** Translate resilience-layer errors into ApiError so UI code has one type to handle. */
function toApiError(err: unknown): unknown {
  const now = Date.now();
  if (err instanceof TimeoutError) return new ApiError(408, err.message, { reason: "timeout" });
  if (err instanceof CircuitOpenError) {
    return new ApiError(503, err.message, { reason: "circuit_open", retryAfterMs: Math.max(0, err.retryAt - now) });
  }
  if (err instanceof RateLimitedError) {
    return new ApiError(429, err.message, { reason: "rate_limited", retryAfterMs: Math.max(0, err.retryAt - now) });
  }
  return err;
}

async function request<T>(
  path: string,
  init: RequestInit,
  token: string | null | undefined,
  schema: Schema<T> | undefined,
  opts: RequestOptions = {},
  retried = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (opts.idempotencyKey) headers.set(IDEMPOTENCY_HEADER, opts.idempotencyKey);

  const { apiUrl } = await getRuntimeConfig();
  let res: Response;
  try {
    res = await transport({
      url: `${apiUrl}${path}`,
      init: { ...init, headers },
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      noRetry: opts.noRetry,
    });
  } catch (err) {
    throw toApiError(err);
  }

  // Only authed requests are recovered; auth endpoints (nonce/verify) never loop.
  if (res.status === 401 && token && !retried && !path.startsWith("/api/v1/auth/")) {
    const fresh = await reauthenticate();
    if (!fresh) throw new ApiError(401, "Session expired");
    const method = (init.method ?? "GET").toUpperCase();
    // Never silently replay non-idempotent calls (open/close/roll): the
    // session is restored, but the user must re-confirm the action.
    if (method !== "GET") throw new ApiError(401, "Session restored — please confirm and retry this action");
    return request<T>(path, init, fresh, schema, opts, true);
  }

  if (!res.ok) {
    let message = res.statusText || `request failed with ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // Body wasn't JSON (or was empty) — keep the statusText fallback.
    }
    // Backend strings are untrusted: strip control/bidi chars and cap length.
    const retryAfterMs = res.status === 429 || res.status === 503
      ? parseRetryAfter(res.headers.get("retry-after")) ?? undefined
      : undefined;
    throw new ApiError(res.status, safeText(message, { maxLength: 300 }) || `request failed with ${res.status}`, {
      retryAfterMs,
      reason: res.status === 429 ? "rate_limited" : undefined,
    });
  }

  // Some successful responses (e.g. POST /watchlist's 201, DELETE's 204)
  // have no body at all — checking status codes for this is brittle
  // (easy to miss one), so just check whether there's actually anything
  // to parse instead.
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!schema) return body as T;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const err = new ContractError(path, parsed.error.issues);
    reportContractError(err);
    throw err;
  }
  return parsed.data;
}

export function apiGet<T>(path: string, token?: string | null, schema?: Schema<T>, opts?: RequestOptions): Promise<T> {
  return request<T>(path, { method: "GET" }, token, schema, opts);
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  token?: string | null,
  schema?: Schema<T>,
  opts?: RequestOptions,
): Promise<T> {
  return request<T>(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    token,
    schema,
    opts,
  );
}

export function apiDelete<T>(path: string, token?: string | null, opts?: RequestOptions): Promise<T> {
  return request<T>(path, { method: "DELETE" }, token, undefined, opts);
}

export async function wsUrl(path: string): Promise<string> {
  const { apiUrl } = await getRuntimeConfig();
  return `${apiUrl.replace(/^http/, "ws")}${path}`;
}
