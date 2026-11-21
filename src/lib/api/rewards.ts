/**
 * Vault LP incentive claims (cumulative Merkle distributor).
 *
 * Depositors verify their own allocation. The API supplies `cumulative` and a
 * Merkle proof, and this module recomputes the leaf and root locally. An
 * allocation that does not verify is never reported as claimable.
 *
 * Leaf encoding (must match contracts/rewards-distributor/src/lib.rs):
 *   leaf = sha256(0x00 || utf8(account) || 0x00 || u128_be(cumulative))
 * Internal node (sorted pair, so proofs carry no direction bits):
 *   node = sha256(0x01 || min(a, b) || max(a, b))
 * A level with no sibling is promoted unchanged; proofs omit it.
 *
 * Amounts are base units of the reward token (decimal strings on the wire).
 *
 * Wire (v1, additive):
 *   GET /api/v1/vaults/{id}/rewards/{account} → RewardClaimWire
 */
import { apiGet } from "./client";

export const REWARD_LEAF_PREFIX = 0x00;
export const REWARD_NODE_PREFIX = 0x01;
const U128_MAX = (1n << 128n) - 1n;

export interface RewardClaimWire {
  vault_id: string;
  epoch: number;
  account: string;
  /** 0x-prefixed hex root of the latest published tree, or null if none. */
  root: string | null;
  /** Cumulative reward owed to the account under `root`, base units. */
  cumulative: string;
  /** Cumulative amount already paid out to the account, base units. */
  claimed: string;
  /** 0x-prefixed sibling hashes, leaf to root. Empty when cumulative is 0. */
  proof: string[];
  /** Decimals of the reward token. */
  decimals: number;
}

/**
 * - `no_allocation`: the wallet has no reward under the latest root.
 * - `claimable`: proof verified and there is an unpaid amount.
 * - `claimed`: proof verified and everything owed has been paid.
 * - `unverified`: the proof did not recompute the published root. Nothing is claimable.
 */
export type RewardClaimStatus = "no_allocation" | "claimable" | "claimed" | "unverified";

export interface RewardClaim {
  vaultId: string;
  epoch: number;
  account: string;
  decimals: number;
  root: string | null;
  status: RewardClaimStatus;
  cumulative: bigint;
  claimed: bigint;
  /** Base units. Zero unless `status === "claimable"`. */
  claimable: bigint;
}

const HEX_RE = /^0x[0-9a-f]+$/i;

function parseWire(raw: unknown): RewardClaimWire {
  const r = raw as Partial<RewardClaimWire> | null;
  const decimal = (v: unknown) => typeof v === "string" && /^\d+$/.test(v);
  if (
    !r ||
    typeof r.vault_id !== "string" ||
    typeof r.epoch !== "number" ||
    typeof r.account !== "string" ||
    !(r.root === null || (typeof r.root === "string" && HEX_RE.test(r.root))) ||
    !decimal(r.cumulative) ||
    !decimal(r.claimed) ||
    !Array.isArray(r.proof) ||
    !r.proof.every(p => typeof p === "string" && HEX_RE.test(p)) ||
    typeof r.decimals !== "number"
  ) {
    throw new Error("Malformed reward claim response");
  }
  return r as RewardClaimWire;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.slice(2);
  if (h.length % 2 !== 0) throw new Error("Odd-length hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

/** u128 big-endian, 16 bytes. Rejects negative or out-of-range values. */
function u128Be(value: bigint): Uint8Array {
  if (value < 0n || value > U128_MAX) throw new Error("Amount out of u128 range");
  const out = new Uint8Array(16);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, value >> 64n);
  view.setBigUint64(8, value & ((1n << 64n) - 1n));
  return out;
}

/** Leaf hash for `(account, cumulative)`, as 0x-prefixed hex. */
export async function rewardLeafHash(account: string, cumulative: bigint): Promise<string> {
  const leaf = await sha256(
    new Uint8Array([REWARD_LEAF_PREFIX]),
    new TextEncoder().encode(account),
    new Uint8Array([0x00]),
    u128Be(cumulative),
  );
  return bytesToHex(leaf);
}

/** Recomputes the root from a leaf and its sibling path and compares it to `root`. */
export async function verifyRewardProof(
  account: string,
  cumulative: bigint,
  proof: readonly string[],
  root: string,
): Promise<boolean> {
  let node = hexToBytes(await rewardLeafHash(account, cumulative));
  for (const sibling of proof) {
    const s = hexToBytes(sibling);
    const [lo, hi] = compareBytes(node, s) <= 0 ? [node, s] : [s, node];
    node = await sha256(new Uint8Array([REWARD_NODE_PREFIX]), lo, hi);
  }
  return bytesToHex(node).toLowerCase() === root.toLowerCase();
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Turns a wire response into a claim the UI can show, verifying the proof first. */
export async function toRewardClaim(wire: RewardClaimWire): Promise<RewardClaim> {
  const cumulative = BigInt(wire.cumulative);
  const claimed = BigInt(wire.claimed);
  const base = {
    vaultId: wire.vault_id,
    epoch: wire.epoch,
    account: wire.account,
    decimals: wire.decimals,
    root: wire.root,
    cumulative,
    claimed,
  };

  if (cumulative === 0n) return { ...base, status: "no_allocation", claimable: 0n };
  if (wire.root === null || !(await verifyRewardProof(wire.account, cumulative, wire.proof, wire.root))) {
    return { ...base, status: "unverified", claimable: 0n };
  }
  const owed = cumulative - claimed;
  return owed > 0n
    ? { ...base, status: "claimable", claimable: owed }
    : { ...base, status: "claimed", claimable: 0n };
}

/** Latest reward claim for `account` in `vaultId`, verified locally. */
export async function fetchRewardClaim(vaultId: string, account: string): Promise<RewardClaim> {
  if (process.env.NEXT_PUBLIC_VAULTS === "live") {
    const wire = parseWire(await apiGet<RewardClaimWire>(`/api/v1/vaults/${vaultId}/rewards/${account}`));
    return toRewardClaim(wire);
  }
  // Mock: no allocation for any wallet until the mock tree is wired up.
  return toRewardClaim({
    vault_id: vaultId,
    epoch: 0,
    account,
    root: null,
    cumulative: "0",
    claimed: "0",
    proof: [],
    decimals: 7,
  });
}
