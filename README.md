# Zenith Frontend

Next.js 14 (App Router) options trading terminal for Zenith, a decentralized
options protocol on Stellar Soroban. Options chain, portfolio, trade history,
multi-leg strategy builder, and a vol surface — all in a dense,
Bloomberg-style dark UI.

## Status: wired up to the real backend

Account, positions, trade history, watchlist, and alerts all come from the
real backend API now (`src/lib/api/*.ts`), not `localStorage` — the local
zustand stores for those were removed once the backend versions replaced
them; `src/lib/store/` now holds only `wallet.ts`. A shared WebSocket
connection (`src/lib/context/SpotFeedContext.tsx`) feeds live spot/vol
ticks into the options chain and portfolio pages. Wallet sign-in is a real
end-to-end flow: connect via Freighter → request a nonce → sign it with
`freighterApi.signBlob` → verify with the backend → store the returned
bearer token and send it as `Authorization: Bearer <token>` on every authed
request (`src/lib/store/wallet.ts`). That said, the signature encoding
hasn't been manually confirmed against a live Freighter extension (no
extension available in this environment) — the flow is logically complete,
not hardware-tested.

Client-side Black-Scholes pricing (`src/lib/pricing.ts`) hasn't gone away —
it's now a fallback and preview layer rather than the primary source: the
options chain falls back to it if the backend fetch fails, per-row live
Greeks in the positions table are computed locally rather than
round-tripped, and multi-leg strategy *preview* pricing (before execution)
is local-only. The backend's `/api/v1/portfolio/payoff` endpoint has a
typed client (`src/lib/api/payoff.ts`) but nothing in the app calls it yet —
the payoff diagram still uses local math (`src/lib/payoff.ts`).

## Getting started

```bash
npm install
cp .env.local.example .env.local   # see "Environment" below
npm run dev
# http://localhost:3000
```

Run the [backend](https://github.com/Zenith-options/backend) alongside it
(`cargo run`, default port 8081) for account/positions/history/watchlist/
alerts/live spot to actually load — without it, only the home page's local
preview chain and the options chain's client-side BS fallback will render.

```bash
npm run build      # production build
npm run lint       # next lint
npm run typecheck  # tsc --noEmit
npm test           # vitest (unit + Testing Library component tests)
```

### Environment

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | client + server | Backend base URL (default `http://localhost:8081`) |
| `NEXT_PUBLIC_SITE_URL` | client + server | Public origin of this frontend, for absolute share-link and OG image URLs (default `http://localhost:3000`) |
| `SHARE_SIGNING_SECRET` | **server only** | ≥ 32-char HMAC key that signs share-card links. Never give it a `NEXT_PUBLIC_` prefix. Generate with `openssl rand -base64 48`. Without it, sharing returns 503 and everything else works. Rotating it invalidates every existing share link. |

## Pages

| Route | What's there |
|---|---|
| `/` | Marketing/landing page, live preview chain, watchlist |
| `/options` | The terminal: chain, positions, strategy builder, vol surface |
| `/portfolio` | Open positions marked-to-market, roll, close, CSV export, collateral & margin dashboard, portfolio-wide risk panel with probability analytics |
| `/history` | Full trade ledger (opens + closes) with realized P&L stats, period statements (CSV/PDF), per-trade share cards |
| `/share/[id]` | Public page for a signed share card, with Open Graph / Twitter previews |

The `/options` page is tabbed:

- **Chain** — live options chain for XLM/BTC/ETH/SOL. Click an ask to buy, a
  bid to write (sell) and collect premium.
- **Positions** — quick view of open positions for the selected symbol;
  "Manage →" links to `/portfolio` for the actual close/roll actions.
- **Strategies** — templated multi-leg trades (straddle, bull call spread,
  bear put spread, iron condor) with a combined payoff diagram, executed
  atomically. Previews can be shared as a card.
- **Surface** — an IV heatmap across strikes and expiries, with a simple
  term-structure model (skew dampens for longer-dated options).

## Architecture

```
src/
├── app/                  # Next.js App Router pages
│   ├── layout.tsx        # Mounts SpotFeedProvider + BackendDataProvider at the root
│   ├── page.tsx          # Home
│   ├── options/          # Chain / Positions / Strategies / Surface
│   ├── portfolio/        # Open positions, roll, close
│   ├── history/          # Trade ledger + statements
│   ├── share/[id]/       # Public share-card page (OG/Twitter meta)
│   └── api/
│       ├── share/        # POST: build + sign a share card from trusted data
│       └── og/trade/     # GET: edge-rendered card PNG (next/og) + bundled fonts
├── components/           # UI components (charts, dialogs, header, etc.)
└── lib/
    ├── api/              # Typed backend client: one file per domain
    │   ├── client.ts     # fetchJson + wsUrl(), NEXT_PUBLIC_API_URL, bearer auth header
    │   ├── market.ts, positions.ts, watchlist.ts, alerts.ts, history.ts,
    │   │   strategies.ts, auth.ts, ws.ts, payoff.ts (client exists, unused)
    │   └── types.ts      # Response shapes mirroring the backend's
    ├── hooks/             # useBackend{Account,Positions,Watchlist,Alerts,History},
    │                      # useSpotFeed (WS reconnect w/ backoff)
    ├── context/
    │   ├── BackendDataContext.tsx  # one shared account/positions/watchlist/alerts instance
    │   └── SpotFeedContext.tsx     # one shared WebSocket connection app-wide
    ├── store/             # zustand + persist — wallet.ts (connect, sign-in,
    │                      # bearer token) and collateralSettings.ts (warning thresholds)
    ├── pricing.ts        # Black-Scholes, vol smile — fallback/preview layer, see above
    ├── collateral.ts     # Collateral requirements (100% calls, 110% puts) +
    │                     # dashboard selectors: utilization, reconciliation, what-if
    ├── probability.ts    # Lognormal PoP / P(ITM) / EV / expected move
    ├── statements.ts     # Period ledger, summaries, statement CSV + PDF
    ├── share/            # Signed share-card payloads, card builder, card artwork
    ├── payoff.ts          # Multi-leg combined payoff math (local; backend equivalent unused)
    ├── risk.ts             # Whole-portfolio risk: groups all open positions per
    │                       # underlying into one payoff curve, stress-tests the
    │                       # account across a spot-shock grid
    ├── volSurface.ts      # Term-structure-aware IV surface grid
    ├── strategies.ts      # Multi-leg strategy templates
    ├── csv.ts / notify.ts # CSV export (injection-safe), browser Notification wrapper
    ├── useHydrated.ts     # SSR-hydration-safety hook (see below) — still relevant for wallet.ts
    └── usePriceHistory.ts # In-memory spot sparkline buffer
```

### A note on hydration safety

`wallet.ts` is the one remaining persisted store, using `skipHydration: true`
plus `StoreHydrator` (mounted once in the root layout) to pull the real
`localStorage` token in after mount instead of at module-eval time. That
alone isn't sufficient for anything that reads the wallet's bearer token to
fetch backend data: passing a token before this component's own mount
effect has fired risks fetching (and rendering) data the server-rendered
HTML didn't have. `BackendDataProvider` (`src/lib/context/BackendDataContext.tsx`)
gates on `useHydrated()` and only passes the real token down to
`useBackendAccount`/`useBackendPositions`/etc. once hydrated — everything
else in `src/app/options/page.tsx` and `src/app/history/page.tsx` that
reads wallet-gated state follows the same pattern. If you add a new
component that reads the wallet token to fetch or render backend data, it
needs the same guard.

## Probability analytics

`src/lib/probability.ts` puts odds on the payoff curves: probability of
profit, probability ITM (single legs), expected value, and ±1σ/±2σ
expected-move ranges. They're shown in the order ticket, the strategy
preview and the portfolio risk panel, and every payoff diagram has a
**Prob.** toggle that overlays the density and the σ bands.

Assumptions (also in the in-app ⓘ tooltip):

- Risk-neutral lognormal spot at expiry, drift r = 5% (the rate the chain
  is priced with): market-implied odds, not a forecast.
- Flat IV by default. **Smile** mode uses the strike-specific smile vol for
  the P(ITM)/PoP edges; EV, the density and the σ bands always use flat IV.
- PoP sums the probability mass of every interval between breakevens
  where the payoff is positive, so condors and straddles work. The
  breakevens come from `riskProfile`.
- EV is E[payoff] − premium, undiscounted, integrated with Simpson's rule
  in log-space and truncated at ±6σ, so unbounded payoffs stay finite.
- In the portfolio panel, positions with different expiries are measured
  at the nearest one. Account-wide EV is summed across underlyings,
  because EV is additive. PoP isn't, so it's shown per underlying only.

## Collateral & margin

The **Collateral & Margin** panel on `/portfolio` shows balance, locked
collateral, free capital and utilization as a threshold-colored gauge. It
also has a sortable per-position table (collateral, share of total,
premium yield, return on collateral, days held, buying power freed on
close), a what-if for a new write or a close, and a reconciliation check.

- **Account semantics** (from the backend): `balance` is total cash and
  *includes* locked collateral. Free capital is `balance −
  collateral_locked` (the backend's buying-power check), and utilization is
  `collateral_locked / balance`.
- **Per-position collateral** is the amount the backend locked **at entry**
  (calls: contracts × entry spot; puts: 110% × strike). It isn't re-marked
  as spot moves. Hovering the amount shows what the same write would lock
  at today's spot.
- **Reconciliation** compares Σ per-position collateral (compensated
  summation) with the account's `collateral_locked`, within a half-cent
  tolerance. `/positions` is now paged through fully, since the default
  50-row page would otherwise truncate larger books.
- **Warnings**: warning and critical thresholds (default 80% / 95%) are set
  per browser. At or above a threshold, a badge appears in the header.
  Escalating to a higher level fires one browser notification, and it
  re-arms once utilization drops back.

## Statements

On `/history`, **Statements** exports a period ledger for accounting:
month, quarter, year or a custom range, optionally for one underlying, as
CSV or a client-side PDF (summary page plus paginated detail). `pdf-lib`
loads lazily, only on the first PDF export.

- **Scope**: realized lots only (`closed` and `rolled` rows), assigned to
  the period their **close** falls in. Periods are UTC midnights, with an
  exclusive end.
- **Rolls are two ledger events.** The rolled lot closes with its own
  realized P&L (`Event = roll`). The replacement is a separate lot whose
  holding period starts at the roll, not at the original open. The two are
  cross-referenced in **Linked Position**, matched by same contract terms
  and strategy, opened within 5 s of the roll.
- **Determinism**: the same inputs produce byte-identical CSV and PDF,
  independent of the machine's time zone.
- **CSV injection**: text cells starting with `=` `+` `-` `@`, tab or CR
  are prefixed with `'` (OWASP). Plain numbers are left alone.
- Not tax advice. There are no jurisdiction-specific rules, and the
  disclaimer is on the panel and in every PDF. See
  [docs/samples/statement-2026Q1.pdf](docs/samples/statement-2026Q1.pdf).

Statement CSV columns:

| Column | Meaning |
|---|---|
| Position ID | Backend position id (one lot) |
| Event | `close`, or `roll` for a lot closed by a roll |
| Opened (UTC) / Closed (UTC) | ISO-8601, second precision, `Z` |
| Underlying, Type, Side | e.g. `BTC`, `short`, `put` |
| Strike, Contracts | As traded |
| Premium Paid | Long: entry premium × contracts. Short: buy-back cost at close |
| Premium Received | Long: close premium × contracts. Short: premium collected at open |
| Fees | Always `0.00`; the backend charges none today |
| Cost Basis | Premium Paid + Fees |
| Proceeds | Premium Received |
| Realized P&L | Proceeds − Cost Basis (matches the backend's `realized_pnl`) |
| Holding Days | Whole days elapsed, open → close |
| Term | `long-term` if closed more than one calendar year after opening, else `short-term` |
| Linked Position | The other lot of a roll, if any |

Amounts use up to 8 decimals with trailing zeros trimmed (minimum 2).

## Share cards

History rows and strategy previews have a **Share** button. It creates a
link to `/share/[id]` with rich Open Graph/Twitter previews, plus a
downloadable 1200×630 card image. Samples:
[trade](docs/samples/share-card-trade.png),
[strategy](docs/samples/share-card-strategy.png).

- **Stateless and signed**: `id = base64url(payload).base64url(HMAC-SHA256)`,
  verified in constant time on every render. A tampered id returns 400 or
  404.
- **Card contents come from trusted data only.** `POST /api/share` looks
  the trade up in the sharer's own ledger via the backend, using their
  bearer token, or reprices a strategy template at the backend's spot.
  Numbers sent by the client are never signed.
- **Privacy**: dollar P&L and contract size are hidden by default. The
  wallet is off by default and only ever appears truncated (`GABC…WXYZ`).
  A full address is rejected at parse time. Hidden fields are omitted from
  the signed payload itself, and the sparkline is pre-normalized, so no
  premiums or sizes travel in the URL.
- The OG image renders on the edge runtime with local OFL fonts
  (`src/app/api/og/trade/fonts`). It is cached for a day in browsers and a
  week at the CDN, so rotating the secret retires old cards in bounded time.

## Known gaps

- No rate limiting on `POST /api/share`. Trade shares require a valid
  backend session; strategy shares don't.
- No on-chain/Soroban integration — the backend is a paper-trading API, not
  a wallet transaction signer against the contracts.
- Wallet sign-in (`signBlob` → verify → bearer token) hasn't been manually
  confirmed against a live Freighter extension — no extension available in
  this environment. The flow is logically complete, not hardware-tested.
- The backend's `/api/v1/portfolio/payoff` endpoint has a typed client
  (`src/lib/api/payoff.ts`) but nothing calls it — the payoff diagram still
  computes locally (`src/lib/payoff.ts`). Multi-leg strategy *preview*
  pricing (before execution) is also local-only, not backend-priced.
- The home page's preview chain still runs its own local random-walk spot
  simulation rather than the shared WebSocket feed — only its watchlist is
  backend-real.
- `src/app/options/page.tsx` has grown large (chain + positions + strategies
  + surface + both trade panels + confirm dialogs) — a good candidate to
  split into sub-components before adding much more to it.
- Accessibility is minimal — several controls (star toggle, alert form,
  contracts stepper) have no `aria-label`.

## License

MIT © Zenith Protocol Contributors
