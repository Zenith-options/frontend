// Address validation for the Vault SDK.
// The backend expects a 56-character G… address (Stellar ed25519 public key).
// An empty string or any non-conforming value is rejected here so callers
// never reach the network with an unusable recipient.

import { InvalidAddressError } from "./errors";

/** Stellar base32 alphabet used in StrKey encoding (SEP-23). */
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

/**
 * Throws {@link InvalidAddressError} when `address` is empty or is not a
 * well-formed 56-character G… Stellar address.
 *
 * The error type is intentionally kept stable so existing callers do not need
 * to change their `catch` branches.
 */
export function validateAddress(address: string): void {
  if (typeof address !== "string" || address.trim().length === 0) {
    throw new InvalidAddressError("");
  }

  const trimmed = address.trim();

  if (!STELLAR_ADDRESS_RE.test(trimmed)) {
    throw new InvalidAddressError(trimmed);
  }
}
