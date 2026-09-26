// Mirrors the JSON shapes returned by backend/src/lib.rs and its domain
// modules. Field names match the Rust structs' serde output exactly
// (snake_case) rather than being camelCased on the way in, so a diff
// against the backend types stays easy to eyeball.

export interface BSResult {
  premium: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  d1: number;
  d2: number;
  intrinsic: number;
  time_value: number;
  iv: number;
}

export interface SpotResponse {
  prices: Record<string, number>;
  vols: Record<string, number>;
}

export interface OptionChainEntry {
  strike: number;
  expiry_days: number;
  call: BSResult;
  put: BSResult;
  is_itm_call: boolean;
  is_itm_put: boolean;
  /**
   * Optional liquidity fields. When absent the chain UI shows "N/A"
   * (never mock values). Backend should populate these when available:
   *   call_volume / put_volume — contracts traded in the session
   *   call_open_interest / put_open_interest — outstanding contracts
   */
  call_volume?: number | null;
  put_volume?: number | null;
  call_open_interest?: number | null;
  put_open_interest?: number | null;
}

export interface ExpiryInfo {
  days_to_expiry: number;
  label: string;
  timestamp: number;
}

export interface ExpiryCalendar {
  underlying: string;
  spot: number;
  vol: number;
  expiries: ExpiryInfo[];
}

export interface IvResult {
  implied_vol: number;
}

export type OptionType = "call" | "put";
export type PositionType = "long" | "short";
export type PositionStatus = "open" | "closed" | "rolled";

export interface Account {
  wallet_address: string;
  balance: number;
  collateral_locked: number;
  created_at: string;
}

export interface Position {
  id: string;
  wallet_address: string;
  underlying: string;
  strike: number;
  expiry_days: number;
  option_type: OptionType;
  position_type: PositionType;
  contracts: number;
  entry_premium: number;
  entry_spot: number;
  collateral: number;
  status: PositionStatus;
  close_premium: number | null;
  close_spot: number | null;
  realized_pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  strategy_id: string | null;
}

export interface HistoryStats {
  trade_count: number;
  win_count: number;
  loss_count: number;
  total_realized_pnl: number;
}

export interface HistoryResponse {
  trades: Position[];
  stats: HistoryStats;
}

export interface AggregateGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface WatchlistItem {
  wallet_address: string;
  underlying: string;
  added_at: string;
}

export type AlertCondition = "above" | "below";

export interface Alert {
  id: string;
  wallet_address: string;
  underlying: string;
  condition: AlertCondition;
  target_price: number;
  triggered: boolean;
  created_at: string;
  triggered_at: string | null;
}

/** GET /api/v1/candles response. time = unix seconds (UTC). */
export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface CandleResponse {
  underlying: string;
  interval: string;
  candles: CandleBar[];
}
