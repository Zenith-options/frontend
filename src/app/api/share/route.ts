import { ApiError } from "../../../lib/api/client";
import { getHistory } from "../../../lib/api/history";
import { getSpot } from "../../../lib/api/market";
import { MAX_PAGE_SIZE } from "../../../lib/api/positions";
import type { Position } from "../../../lib/api/types";
import { MARKETS } from "../../../lib/pricing";
import { STRATEGY_TEMPLATES } from "../../../lib/strategies";
import { cardFromPosition, cardFromStrategy, DEFAULT_PRIVACY, type SharePrivacy } from "../../../lib/share/card";
import { getSigningSecret, ShareConfigError, signCard } from "../../../lib/share/payload";

// Issues signed share ids. Card contents are always derived server-side
// from trusted data — never from numbers the client sends — so a signed
// card can't claim a P&L the trader didn't have:
//   trade:    the closed position is looked up in the sharer's own ledger
//             via the backend, using their bearer token
//   strategy: the template is repriced at the backend's current spot/vol

const MAX_HISTORY_PAGES = 25;

// Per-field caps derived from the OG card layout (src/app/api/og/trade/route.tsx
// → src/lib/share/cardImage.tsx, 1200×630): the underlying renders at 72px
// Fraunces on one line, structure and pnlLabel at 32px/22px on one line, and
// the wallet is always the truncated "GABC…WXYZ" shape. Anything longer can't
// be displayed, so it is rejected rather than silently truncated.
export const SHARE_FIELD_LIMITS = {
  positionId: 64,
  templateId: 64,
  underlying: 10,
  wallet: 9,
} as const;

/** Returns a 400 response naming the field and its limit, or null when within limits. */
function checkLength(field: keyof typeof SHARE_FIELD_LIMITS, value: unknown): Response | null {
  const max = SHARE_FIELD_LIMITS[field];
  if (typeof value === "string" && value.length > max) {
    return json({ error: `${field} must be at most ${max} characters` }, 400);
  }
  return null;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function parsePrivacy(raw: unknown): SharePrivacy {
  const p = (raw ?? {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    hideAbsolutePnl: bool(p.hideAbsolutePnl, DEFAULT_PRIVACY.hideAbsolutePnl),
    hideSize: bool(p.hideSize, DEFAULT_PRIVACY.hideSize),
    showWallet: bool(p.showWallet, DEFAULT_PRIVACY.showWallet),
  };
}

async function findClosedPosition(token: string, id: string): Promise<Position | null> {
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const res = await getHistory(token, { limit: MAX_PAGE_SIZE, offset: page * MAX_PAGE_SIZE });
    const hit = res.trades.find(t => t.id === id);
    if (hit) return hit;
    if (!(res.has_more ?? res.trades.length === MAX_PAGE_SIZE)) return null;
  }
  return null;
}

function siteOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(req.url).origin;
}

export async function POST(req: Request) {
  let secret: string;
  try {
    secret = getSigningSecret();
  } catch (err) {
    if (err instanceof ShareConfigError) return json({ error: "Sharing is not configured on this server" }, 503);
    throw err;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const privacy = parsePrivacy(body.privacy);
  const now = new Date();

  for (const field of ["positionId", "templateId", "underlying", "wallet"] as const) {
    const tooLong = checkLength(field, body[field]);
    if (tooLong) return tooLong;
  }

  let card;
  if (body.kind === "trade") {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in to share a trade" }, 401);
    if (typeof body.positionId !== "string" || body.positionId.length > SHARE_FIELD_LIMITS.positionId) return json({ error: "positionId is required" }, 400);
    try {
      const position = await findClosedPosition(token, body.positionId);
      card = position ? cardFromPosition(position, privacy, now) : null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return json({ error: "Session expired — sign in again" }, 401);
      return json({ error: "Couldn't reach the trading backend" }, 502);
    }
    if (!card) return json({ error: "No closed trade with that id in your history" }, 404);
  } else if (body.kind === "strategy") {
    const template = STRATEGY_TEMPLATES.find(t => t.id === body.templateId);
    const underlying = typeof body.underlying === "string" ? body.underlying : "";
    const expiryDays = Number(body.expiryDays);
    const contracts = Number(body.contracts ?? 1);
    if (!template) return json({ error: "Unknown strategy" }, 400);
    if (!(expiryDays >= 1 && expiryDays <= 730)) return json({ error: "expiryDays must be between 1 and 730" }, 400);
    if (!(contracts > 0 && contracts <= 1_000_000)) return json({ error: "contracts must be positive" }, 400);
    // Backend spot/vol when reachable; otherwise the same seed constants
    // the chain falls back to. Either way, server-side values.
    const seed = MARKETS.find(m => m.sym === underlying);
    const spot = await getSpot().catch(() => null);
    const price = spot?.prices[underlying] ?? seed?.price;
    const vol = spot?.vols[underlying] ?? seed?.vol;
    if (!price || !vol) return json({ error: "Unknown underlying" }, 400);
    card = cardFromStrategy(template, { underlying, spot: price, vol }, { expiryDays, contracts }, privacy, now);
  } else {
    return json({ error: "kind must be \"trade\" or \"strategy\"" }, 400);
  }

  const id = await signCard(card, secret);
  const origin = siteOrigin(req);
  return json({ id, url: `${origin}/share/${id}`, imageUrl: `${origin}/api/og/trade?id=${id}`, card });
}
