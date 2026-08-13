import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WatchlistState {
  favorites: string[];
  toggleFavorite: (sym: string) => void;
  isFavorite: (sym: string) => boolean;
}

export const useWatchlistStore = create<WatchlistState>()(
  persist(
    (set, get) => ({
      favorites: [],
      toggleFavorite: (sym) =>
        set((state) => ({
          favorites: state.favorites.includes(sym)
            ? state.favorites.filter((s) => s !== sym)
            : [...state.favorites, sym],
        })),
      isFavorite: (sym) => get().favorites.includes(sym),
    }),
    { name: "zenith-watchlist", skipHydration: true }
  )
);
