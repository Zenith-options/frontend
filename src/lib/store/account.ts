import { create } from "zustand";
import { persist } from "zustand/middleware";

const STARTING_BALANCE = 50_000;

interface AccountState {
  balance: number;
  collateralLocked: number;
  /** Locks collateral out of the available balance. Returns false if balance is insufficient. */
  reserveCollateral: (amount: number) => boolean;
  releaseCollateral: (amount: number) => void;
  credit: (amount: number) => void;
  debit: (amount: number) => void;
  reset: () => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      balance: STARTING_BALANCE,
      collateralLocked: 0,

      reserveCollateral: (amount) => {
        if (get().balance < amount) return false;
        set((s) => ({ balance: s.balance - amount, collateralLocked: s.collateralLocked + amount }));
        return true;
      },
      releaseCollateral: (amount) =>
        set((s) => ({ balance: s.balance + amount, collateralLocked: Math.max(0, s.collateralLocked - amount) })),
      credit: (amount) => set((s) => ({ balance: s.balance + amount })),
      debit: (amount) => set((s) => ({ balance: s.balance - amount })),
      reset: () => set({ balance: STARTING_BALANCE, collateralLocked: 0 }),
    }),
    { name: "zenith-account" }
  )
);
