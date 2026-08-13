import { useEffect, useState } from "react";

export interface PricePoint {
  t: number;
  price: number;
}

const MAX_POINTS = 60;

// Rolling in-memory buffer of recent spot ticks for the given symbol. Resets
// whenever the symbol changes — this is a session-only sparkline, not a real
// price feed, so there's nothing worth persisting across reloads.
export function usePriceHistory(sym: string, spot: number): PricePoint[] {
  const [history, setHistory] = useState<PricePoint[]>([]);

  useEffect(() => {
    setHistory([]);
  }, [sym]);

  useEffect(() => {
    setHistory(prev => [...prev, { t: Date.now(), price: spot }].slice(-MAX_POINTS));
  }, [spot]);

  return history;
}
