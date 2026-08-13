import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AlertDirection = "above" | "below";

export interface PriceAlert {
  id: number;
  sym: string;
  targetPrice: number;
  direction: AlertDirection;
  createdAt: number;
  triggeredAt: number | null;
}

interface AlertsState {
  alerts: PriceAlert[];
  nextId: number;
  addAlert: (sym: string, targetPrice: number, direction: AlertDirection) => void;
  removeAlert: (id: number) => void;
  markTriggered: (id: number) => void;
}

export const useAlertsStore = create<AlertsState>()(
  persist(
    (set, get) => ({
      alerts: [],
      nextId: 1,
      addAlert: (sym, targetPrice, direction) => {
        const id = get().nextId;
        set((state) => ({
          alerts: [...state.alerts, { id, sym, targetPrice, direction, createdAt: Date.now(), triggeredAt: null }],
          nextId: state.nextId + 1,
        }));
      },
      removeAlert: (id) => set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),
      markTriggered: (id) =>
        set((state) => ({
          alerts: state.alerts.map((a) => (a.id === id ? { ...a, triggeredAt: Date.now() } : a)),
        })),
    }),
    { name: "zenith-alerts", skipHydration: true }
  )
);
