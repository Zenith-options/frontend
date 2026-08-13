import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Position {
  id: number;
  sym: string;
  side: "call" | "put";
  strike: number;
  expiryLabel: string;
  contracts: number;
  entrySpot: number;
  premium: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openedAt: number;
  expiresAt: number;
}

type NewPosition = Omit<Position, "id" | "openedAt" | "expiresAt"> & { expiryDays: number };

interface PositionsState {
  positions: Position[];
  nextId: number;
  addPosition: (pos: NewPosition) => void;
  closePosition: (id: number) => void;
}

export const usePositionsStore = create<PositionsState>()(
  persist(
    (set) => ({
      positions: [],
      nextId: 1,
      addPosition: ({ expiryDays, ...pos }) =>
        set((state) => {
          const openedAt = Date.now();
          return {
            positions: [
              ...state.positions,
              { ...pos, id: state.nextId, openedAt, expiresAt: openedAt + expiryDays * 86_400_000 },
            ],
            nextId: state.nextId + 1,
          };
        }),
      closePosition: (id) =>
        set((state) => ({ positions: state.positions.filter((p) => p.id !== id) })),
    }),
    { name: "zenith-positions" }
  )
);
