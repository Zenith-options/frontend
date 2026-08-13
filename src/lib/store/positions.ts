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

// bs() already returns a correctly-signed delta per side (negative for puts),
// so aggregation is a plain contract-weighted sum — no extra sign flip needed.
export function aggregateGreeks(positions: Position[]) {
  return positions.reduce(
    (acc, p) => ({
      delta: acc.delta + p.delta * p.contracts,
      gamma: acc.gamma + p.gamma * p.contracts,
      theta: acc.theta + p.theta * p.contracts,
      vega: acc.vega + p.vega * p.contracts,
    }),
    { delta: 0, gamma: 0, theta: 0, vega: 0 }
  );
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
