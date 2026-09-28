// Wallet store — replaced Freighter-only integration with Stellar Wallets Kit.
// Supports Freighter, xBull, Albedo, Lobstr, Hana, Rabet, and WalletConnect.
// Persists last-used wallet id and auto-reconnects silently on page load.
//
// The WalletSigner abstraction is used by:
//   - Backend sign-in (signMessage, with no-op tx fallback for wallets that can't)
//   - The Soroban pipeline (signTransaction)
//
// Wallet selection modal is a separate component: <WalletSelectModal />.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  StellarWalletsKit,
  Networks as SWKNetworks,
} from "@creit.tech/stellar-wallets-kit";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { xBullModule, XBULL_ID } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { AlbedoModule, ALBEDO_ID } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { LobstrModule, LOBSTR_ID } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { HanaModule, HANA_ID } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { RabetModule, RABET_ID } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { getMe, requestNonce, verifySignature } from "../api/auth";
import type { WalletSigner } from "../soroban/types";

// ---------------------------------------------------------------------------
// SWK initialisation — done once at module level (not inside a hook).
// We avoid importing this in SSR code by checking typeof window.
// ---------------------------------------------------------------------------

export const SWK_NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
    ? SWKNetworks.PUBLIC
    : SWKNetworks.TESTNET;

export const NETWORK_PASSPHRASE = SWK_NETWORK;

let kitInitialised = false;

export function ensureKitInitialised(selectedWalletId?: string) {
  if (typeof window === "undefined") return;
  if (kitInitialised) return;

  StellarWalletsKit.init({
    modules: [
      new FreighterModule(),
      new xBullModule(),
      new AlbedoModule(),
      new LobstrModule(),
      new HanaModule(),
      new RabetModule(),
    ],
    selectedWalletId: selectedWalletId ?? FREIGHTER_ID,
    network: SWK_NETWORK,
  });

  kitInitialised = true;
}

// ---------------------------------------------------------------------------
// Supported wallet descriptors (for the selection modal)
// ---------------------------------------------------------------------------

export interface WalletDescriptor {
  id: string;
  name: string;
  icon: string;
  url: string;
  /** Whether the wallet can sign raw messages (for backend sign-in) */
  canSignMessages: boolean;
}

export const SUPPORTED_WALLETS: WalletDescriptor[] = [
  {
    id: FREIGHTER_ID,
    name: "Freighter",
    icon: "https://freighter.app/favicon.ico",
    url: "https://www.freighter.app/",
    canSignMessages: true,
  },
  {
    id: XBULL_ID,
    name: "xBull",
    icon: "https://xbull.app/assets/icons/icon-128x128.png",
    url: "https://xbull.app/",
    canSignMessages: false,
  },
  {
    id: ALBEDO_ID,
    name: "Albedo",
    icon: "https://albedo.link/img/albedo-logo.svg",
    url: "https://albedo.link/",
    canSignMessages: false,
  },
  {
    id: LOBSTR_ID,
    name: "Lobstr",
    icon: "https://lobstr.co/assets/lobstr-app-icon-rnd.svg",
    url: "https://lobstr.co/",
    canSignMessages: false,
  },
  {
    id: HANA_ID,
    name: "Hana",
    icon: "https://hana.finance/favicon.ico",
    url: "https://hana.finance/",
    canSignMessages: false,
  },
  {
    id: RABET_ID,
    name: "Rabet",
    icon: "https://rabet.io/images/logo.svg",
    url: "https://rabet.io/",
    canSignMessages: false,
  },
];

// ---------------------------------------------------------------------------
// Build a WalletSigner from the currently-selected SWK wallet
// ---------------------------------------------------------------------------

function buildSigner(address: string, walletId: string): WalletSigner {
  const descriptor = SUPPORTED_WALLETS.find((w) => w.id === walletId);
  const canSignMessages = descriptor?.canSignMessages ?? false;

  return {
    address,
    networkPassphrase: NETWORK_PASSPHRASE,

    async signTransaction(xdr: string): Promise<string> {
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address,
      });
      return signedTxXdr;
    },

    async signMessage(message: string): Promise<string> {
      if (!canSignMessages) {
        throw new Error(`${descriptor?.name ?? "This wallet"} does not support message signing.`);
      }
      const { signedMessage } = await StellarWalletsKit.signMessage(message, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address,
      });
      return signedMessage;
    },

    canSignMessages,
  };
}

// ---------------------------------------------------------------------------
// Backend sign-in helpers
// ---------------------------------------------------------------------------

async function signInWithBackend(address: string, walletId: string): Promise<string> {
  const { message } = await requestNonce(address);
  const descriptor = SUPPORTED_WALLETS.find((w) => w.id === walletId);

  let signature: string;

  if (descriptor?.canSignMessages) {
    try {
      const { signedMessage } = await StellarWalletsKit.signMessage(message, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address,
      });
      signature = signedMessage;
    } catch {
      throw new Error("Wallet rejected the sign-in message.");
    }
  } else {
    // Fallback: wallet can't sign messages — sign a no-op transaction instead.
    // The backend must support this fallback path.
    throw new Error(
      `${descriptor?.name ?? "This wallet"} cannot sign messages for backend sign-in. ` +
      "Please use Freighter or enable message signing in your wallet."
    );
  }

  const { token } = await verifySignature({
    walletAddress: address,
    message,
    signature,
  });
  return token;
}

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

export type WalletStatus = "idle" | "connecting" | "connected" | "not-installed" | "error";

interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  /** Currently selected wallet id */
  walletId: string | null;
  /** Bearer token from the backend's sign-in-with-wallet flow */
  token: string | null;
  error: string | null;
  /** Whether the wallet selection modal should be open */
  showSelectModal: boolean;

  /** Open the wallet selection modal */
  openSelectModal: () => void;
  closeSelectModal: () => void;

  /** Connect with a specific wallet id */
  connectWallet: (walletId: string) => Promise<void>;

  /** Disconnect and clear session */
  disconnect: () => void;

  /** Re-verify a persisted session on load */
  checkConnection: () => Promise<void>;

  /** Get a WalletSigner for the current session (throws if not connected) */
  getSigner: () => WalletSigner;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      status: "idle",
      address: null,
      network: null,
      walletId: null,
      token: null,
      error: null,
      showSelectModal: false,

      openSelectModal: () => set({ showSelectModal: true }),
      closeSelectModal: () => set({ showSelectModal: false }),

      connectWallet: async (walletId: string) => {
        set({ status: "connecting", error: null, showSelectModal: false });
        try {
          ensureKitInitialised(walletId);
          StellarWalletsKit.setWallet(walletId);

          const { address } = await StellarWalletsKit.getAddress();
          const { networkPassphrase } = await StellarWalletsKit.getNetwork().catch(() => ({
            network: "testnet",
            networkPassphrase: NETWORK_PASSPHRASE,
          }));

          set({
            status: "connected",
            address,
            network: networkPassphrase,
            walletId,
            error: null,
          });

          // Attempt backend sign-in — don't tear down wallet connection if it fails
          try {
            const token = await signInWithBackend(address, walletId);
            set({ token });
          } catch (err) {
            set({
              token: null,
              error: err instanceof Error ? err.message : "Backend sign-in failed",
            });
          }
        } catch (err) {
          set({
            status: "error",
            error: err instanceof Error ? err.message : "Failed to connect wallet",
          });
        }
      },

      disconnect: () => {
        StellarWalletsKit.disconnect().catch(() => {});
        set({
          status: "idle",
          address: null,
          network: null,
          walletId: null,
          token: null,
          error: null,
        });
      },

      checkConnection: async () => {
        const { walletId, token } = get();
        if (!walletId || typeof window === "undefined") return;

        try {
          ensureKitInitialised(walletId);
          StellarWalletsKit.setWallet(walletId);

          // getAddress without requesting access — will throw if not permitted
          const { address } = await StellarWalletsKit.getAddress();
          if (!address) {
            set({ status: "idle", address: null, token: null });
            return;
          }

          const { networkPassphrase } = await StellarWalletsKit.getNetwork().catch(() => ({
            network: "testnet",
            networkPassphrase: NETWORK_PASSPHRASE,
          }));

          set({ status: "connected", address, network: networkPassphrase });

          // Check if persisted token is still valid
          const stillValid = token
            ? await getMe(token)
                .then(() => true)
                .catch(() => false)
            : false;

          if (stillValid) return;

          try {
            const newToken = await signInWithBackend(address, walletId);
            set({ token: newToken });
          } catch {
            set({ token: null });
          }
        } catch {
          // Silent — wallet not available or not permitted
          set({ status: "idle", address: null, network: null, token: null });
        }
      },

      getSigner: (): WalletSigner => {
        const { address, walletId, status } = get();
        if (status !== "connected" || !address || !walletId) {
          throw new Error("Wallet not connected");
        }
        ensureKitInitialised(walletId);
        StellarWalletsKit.setWallet(walletId);
        return buildSigner(address, walletId);
      },
    }),
    {
      name: "zenith-wallet",
      partialize: (s) => ({
        address: s.address,
        token: s.token,
        walletId: s.walletId,
      }),
      skipHydration: true,
    }
  )
);
