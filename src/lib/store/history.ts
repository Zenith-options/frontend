import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TradeAction = "open" | "close";

export interface TradeRecord {
  id: number;
  timestamp: number;
  sym: string;
  side: "call" | "put";
  positionType: "long" | "short";
  action: TradeAction;
  strike: number;
  expiryLabel: string;
  contracts: number;
  /** Total premium involved in this fill (paid for a long open, received for a short open, etc). */
  premium: number;
  /** Only present on close records. */
  realizedPnl?: number;
}

interface HistoryState {
  records: TradeRecord[];
  nextId: number;
  addRecord: (rec: Omit<TradeRecord, "id" | "timestamp">) => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      records: [],
      nextId: 1,
      addRecord: (rec) => {
        const id = get().nextId;
        set((state) => ({
          records: [{ ...rec, id, timestamp: Date.now() }, ...state.records],
          nextId: state.nextId + 1,
        }));
      },
    }),
    { name: "zenith-history" }
  )
);
