import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PositionType = "long" | "short";

export interface Position {
  id: number;
  sym: string;
  side: "call" | "put";
  positionType: PositionType;
  strike: number;
  expiryLabel: string;
  contracts: number;
  entrySpot: number;
  /** Premium paid (long) or received (short) at entry — always positive, sign implied by positionType. */
  premium: number;
  /** Collateral locked against the account balance. Zero for long positions. */
  collateral: number;
  // Option Greeks at entry, buyer's-side convention (bs() output) regardless of
  // positionType — aggregateGreeks() applies the short-side sign flip.
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openedAt: number;
  expiresAt: number;
  /** Shared across every leg opened together as one multi-leg strategy. Undefined for a plain single-leg trade. */
  strategyId?: string;
}

type NewPosition = Omit<Position, "id" | "openedAt" | "expiresAt"> & { expiryDays: number };

interface PositionsState {
  positions: Position[];
  nextId: number;
  addPosition: (pos: NewPosition) => number;
  closePosition: (id: number) => void;
}

// Being short an option is the mirror of being long it — flip the sign of the
// stored (buyer-convention) Greeks before weighting by contracts.
export function aggregateGreeks(positions: Position[]) {
  return positions.reduce(
    (acc, p) => {
      const sign = p.positionType === "short" ? -1 : 1;
      return {
        delta: acc.delta + sign * p.delta * p.contracts,
        gamma: acc.gamma + sign * p.gamma * p.contracts,
        theta: acc.theta + sign * p.theta * p.contracts,
        vega: acc.vega + sign * p.vega * p.contracts,
      };
    },
    { delta: 0, gamma: 0, theta: 0, vega: 0 }
  );
}

export const usePositionsStore = create<PositionsState>()(
  persist(
    (set, get) => ({
      positions: [],
      nextId: 1,
      addPosition: ({ expiryDays, ...pos }) => {
        const id = get().nextId;
        const openedAt = Date.now();
        set((state) => ({
          positions: [
            ...state.positions,
            { ...pos, id, openedAt, expiresAt: openedAt + expiryDays * 86_400_000 },
          ],
          nextId: state.nextId + 1,
        }));
        return id;
      },
      closePosition: (id) =>
        set((state) => ({ positions: state.positions.filter((p) => p.id !== id) })),
    }),
    { name: "zenith-positions", skipHydration: true }
  )
);
