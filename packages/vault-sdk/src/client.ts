/**
 * Thin vault client over `fetch` with an injectable transport.
 *
 * Auth: the caller supplies the bearer token through `getToken`. The SDK
 * neither stores nor logs it. Browser apps that use the BFF session model
 * can omit `getToken` and point `baseUrl` at the BFF prefix; the cookie
 * is sent with `credentials: "same-origin"`.
 */

import { httpError, timeoutError, VaultSdkError } from "./errors";
import type { DepositResult, VaultDetail, VaultSummary, WithdrawResult } from "./types";
import { parseDepositResult, parseVaultDetail, parseVaultSummaries, parseWithdrawResult } from "./validate";

/** Per-request time budget. Covers the response body read as well as the headers. */
export const DEFAULT_VAULT_TIMEOUT_MS = 10_000;

export interface VaultTransportRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  /** Aborted when the request times out; custom transports should forward it to their I/O. */
  signal?: AbortSignal;
}

export interface VaultTransportResponse {
  status: number;
  /** Parsed JSON body, or `undefined` when the body is empty or not JSON. */
  body: unknown;
}

export type VaultTransport = (request: VaultTransportRequest) => Promise<VaultTransportResponse>;

export interface VaultClientOptions {
  /** Origin or path prefix that serves `/api/v1/vaults`, without a trailing slash. */
  baseUrl: string;
  /** Returns the bearer token for a request. Called per request; never cached by the SDK. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Replaces the default fetch transport, e.g. with a fake in unit tests or the e2e mock backend. */
  transport?: VaultTransport;
  /** Per-request timeout in milliseconds. Defaults to `DEFAULT_VAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface VaultClient {
  listVaults(): Promise<VaultSummary[]>;
  /** Resolves `null` when the vault does not exist. */
  getVault(id: string): Promise<VaultDetail | null>;
  deposit(id: string, amount: number): Promise<DepositResult>;
  withdraw(id: string, shares: number): Promise<WithdrawResult>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const defaultTransport: VaultTransport = async ({ method, url, headers, body, signal }) => {
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  const text = await res.text();
  return { status: res.status, body: text ? parseJson(text) : undefined };
};

function errorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new VaultSdkError("validation", `${name} must be a positive finite number`);
  }
}

export function createVaultClient(options: VaultClientOptions): VaultClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const transport = options.transport ?? defaultTransport;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VAULT_TIMEOUT_MS;
  assertPositive(timeoutMs, "timeoutMs");

  async function send(method: "GET" | "POST", path: string, body?: unknown) {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const token = await options.getToken?.();
    if (token) headers.authorization = `Bearer ${token}`;
    // The race covers transports that ignore `signal`; the abort cancels transports that honour it.
    const controller = new AbortController();
    const timedOut = timeoutError(timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timedOut);
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        transport({ method, url: `${baseUrl}${path}`, headers, body, signal: controller.signal }),
        deadline,
      ]);
    } catch (cause) {
      if (cause === timedOut) throw cause;
      throw new VaultSdkError("transport", "Vault API request could not be completed", { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  function checked(res: VaultTransportResponse): unknown {
    if (res.status < 200 || res.status > 299) throw httpError(res.status, errorCode(res.body));
    return res.body;
  }

  const vaultPath = (id: string) => {
    if (!id) throw new VaultSdkError("validation", "vault id must be a non-empty string");
    return `/api/v1/vaults/${encodeURIComponent(id)}`;
  };

  return {
    async listVaults() {
      return parseVaultSummaries(checked(await send("GET", "/api/v1/vaults")), "VaultSummary[]");
    },

    async getVault(id) {
      const res = await send("GET", vaultPath(id));
      if (res.status === 404) return null;
      return parseVaultDetail(checked(res), "VaultDetail");
    },

    async deposit(id, amount) {
      assertPositive(amount, "amount");
      const res = await send("POST", `${vaultPath(id)}/deposit`, { amount });
      return parseDepositResult(checked(res), "DepositResult");
    },

    async withdraw(id, shares) {
      assertPositive(shares, "shares");
      const res = await send("POST", `${vaultPath(id)}/withdraw`, { shares });
      return parseWithdrawResult(checked(res), "WithdrawResult");
    },
  };
}
