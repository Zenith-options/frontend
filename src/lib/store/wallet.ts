import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import freighterApi from '@stellar/freighter-api';
import { getMe, requestNonce, verifySignature } from '../api/auth';
import { parseAndValidateChallenge, type ParsedChallenge } from '../auth/challengeValidator';

export type WalletStatus = 'idle' | 'connecting' | 'connected' | 'not-installed' | 'error';

interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  /** Bearer token from the backend's sign-in-with-wallet flow. */
  token: string | null;
  error: string | null;
  /**
   * The last parsed challenge, set before the wallet signs.
   * Components can read this to show the user what they signed.
   */
  lastChallenge: ParsedChallenge | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
}

/**
 * Signs the backend's nonce message with Freighter and exchanges it for a
 * bearer token. Validates the challenge before signing to defend against
 * phishing attacks from a malicious or compromised backend.
 */
async function signInWithBackend(address: string): Promise<{ token: string; challenge: ParsedChallenge }> {
  const { message } = await requestNonce(address);

  // Validate the challenge before asking the wallet to sign.
  // Throws ChallengeValidationFailure with a precise error code on any violation.
  const challenge = parseAndValidateChallenge(message, address);

  // NOTE: Freighter's signBlob returns base64-encoded bytes.
  const signedBlob = await freighterApi.signBlob(message);
  const { token } = await verifySignature({ walletAddress: address, message, signature: signedBlob });
  return { token, challenge };
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      status: 'idle',
      address: null,
      network: null,
      token: null,
      error: null,
      lastChallenge: null,

      connect: async () => {
        set({ status: 'connecting', error: null });
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) {
            set({ status: 'not-installed' });
            return;
          }
          const address = await freighterApi.requestAccess();
          const details = await freighterApi.getNetworkDetails().catch(() => null);
          set({ status: 'connected', address, network: details?.network ?? null, error: null });

          try {
            const { token, challenge } = await signInWithBackend(address);
            set({ token, lastChallenge: challenge });
          } catch (err) {
            set({
              token: null,
              lastChallenge: null,
              error: err instanceof Error ? err.message : 'Backend sign-in failed',
            });
          }
        } catch (err) {
          set({ status: 'error', error: err instanceof Error ? err.message : 'Failed to connect wallet' });
        }
      },

      disconnect: () => set({
        status: 'idle', address: null, network: null,
        token: null, error: null, lastChallenge: null,
      }),

      checkConnection: async () => {
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) return;
          const allowed = await freighterApi.isAllowed();
          if (!allowed) {
            set({ status: 'idle', address: null, network: null, token: null, lastChallenge: null });
            return;
          }
          const address = await freighterApi.getPublicKey();
          const details = await freighterApi.getNetworkDetails().catch(() => null);
          set({ status: 'connected', address, network: details?.network ?? null });

          const persistedToken = get().token;
          const stillValid = persistedToken
            ? await getMe(persistedToken).then(() => true).catch(() => false)
            : false;

          if (stillValid) return;

          try {
            const { token, challenge } = await signInWithBackend(address);
            set({ token, lastChallenge: challenge });
          } catch {
            set({ token: null, lastChallenge: null });
          }
        } catch {
          set({ status: 'idle', address: null, network: null, token: null, lastChallenge: null });
        }
      },
    }),
    {
      name: 'zenith-wallet',
      partialize: (s) => ({ address: s.address, token: s.token }),
      skipHydration: true,
    }
  )
);
