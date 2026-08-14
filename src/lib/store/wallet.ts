import { create } from "zustand";
import { persist } from "zustand/middleware";
import freighterApi from "@stellar/freighter-api";
import { getMe, requestNonce, verifySignature } from "../api/auth";

export type WalletStatus = "idle" | "connecting" | "connected" | "not-installed" | "error";

interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  /** Bearer token from the backend's sign-in-with-wallet flow. Wallet
   *  connection and backend login are separate steps — a wallet can be
   *  connected with `token: null` if the sign step failed or is still
   *  pending, and every store/component that calls an auth-gated
   *  endpoint needs to handle that. */
  token: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
}

// Signs the backend's nonce message with Freighter and exchanges it for a
// bearer token. Kept separate from connect()/checkConnection() so a
// failure here (backend down, user rejects the signature prompt) doesn't
// also tear down an otherwise-successful wallet connection — it just
// leaves `token: null`, which callers already have to handle.
async function signInWithBackend(address: string): Promise<string> {
  const { message } = await requestNonce(address);
  const signedBlob = await freighterApi.signBlob(message);
  // NOTE: assumes signBlob returns a base64-encoded 64-byte ed25519
  // signature, matching the backend's expected format — unverified
  // against a real Freighter extension (none available in this dev
  // environment). If sign-in fails with a 401 from /auth/verify, this
  // encoding assumption is the first thing to check.
  const { token } = await verifySignature({ walletAddress: address, message, signature: signedBlob });
  return token;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      status: "idle",
      address: null,
      network: null,
      token: null,
      error: null,

      connect: async () => {
        set({ status: "connecting", error: null });
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) {
            set({ status: "not-installed" });
            return;
          }
          const address = await freighterApi.requestAccess();
          const details = await freighterApi.getNetworkDetails().catch(() => null);
          set({ status: "connected", address, network: details?.network ?? null, error: null });

          try {
            const token = await signInWithBackend(address);
            set({ token });
          } catch (err) {
            // Wallet is connected either way; just no backend session yet.
            set({ token: null, error: err instanceof Error ? err.message : "Backend sign-in failed" });
          }
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : "Failed to connect wallet" });
        }
      },

      disconnect: () => set({ status: "idle", address: null, network: null, token: null, error: null }),

      // Re-verify a persisted session on load rather than trusting stale state.
      checkConnection: async () => {
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) return;
          const allowed = await freighterApi.isAllowed();
          if (!allowed) {
            set({ status: "idle", address: null, network: null, token: null });
            return;
          }
          const address = await freighterApi.getPublicKey();
          const details = await freighterApi.getNetworkDetails().catch(() => null);
          set({ status: "connected", address, network: details?.network ?? null });

          // A persisted token might still be valid (sessions last 24h) —
          // check before making the user sign a fresh message on every
          // page load.
          const persistedToken = get().token;
          const stillValid = persistedToken
            ? await getMe(persistedToken)
                .then(() => true)
                .catch(() => false)
            : false;

          if (stillValid) return;

          try {
            const token = await signInWithBackend(address);
            set({ token });
          } catch {
            set({ token: null });
          }
        } catch {
          set({ status: "idle", address: null, network: null, token: null });
        }
      },
    }),
    {
      name: "zenith-wallet",
      partialize: (s) => ({ address: s.address, token: s.token }),
      skipHydration: true,
    }
  )
);
