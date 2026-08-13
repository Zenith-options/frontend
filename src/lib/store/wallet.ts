import { create } from "zustand";
import { persist } from "zustand/middleware";
import freighterApi from "@stellar/freighter-api";

export type WalletStatus = "idle" | "connecting" | "connected" | "not-installed" | "error";

interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      status: "idle",
      address: null,
      network: null,
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
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : "Failed to connect wallet" });
        }
      },

      disconnect: () => set({ status: "idle", address: null, network: null, error: null }),

      // Re-verify a persisted session on load rather than trusting stale state.
      checkConnection: async () => {
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) return;
          const allowed = await freighterApi.isAllowed();
          if (!allowed) {
            set({ status: "idle", address: null, network: null });
            return;
          }
          const address = await freighterApi.getPublicKey();
          const details = await freighterApi.getNetworkDetails().catch(() => null);
          set({ status: "connected", address, network: details?.network ?? null });
        } catch {
          set({ status: "idle", address: null, network: null });
        }
      },
    }),
    {
      name: "zenith-wallet",
      partialize: (s) => ({ address: s.address }),
      skipHydration: true,
    }
  )
);
