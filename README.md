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
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL, defaults to http://localhost:8081
npm run dev
# http://localhost:3000
```

Run the [backend](https://github.com/Zenith-options/backend) alongside it
(`cargo run`, default port 8081) for account/positions/history/watchlist/
alerts/live spot to actually load — without it, only the home page's local
preview chain and the options chain's client-side BS fallback will render.

```bash
npm run build   # production build
npm run lint     # next lint
npm test        # Vitest + React Testing Library (npm run test:watch to watch)
```

## Pages

| Route | What's there |
|---|---|
| `/` | Marketing/landing page, live preview chain, watchlist |
| `/options` | The terminal: chain, positions, strategy builder, vol surface |
| `/portfolio` | Open positions marked-to-market, roll, close, CSV export, portfolio-wide risk panel |
| `/history` | Full trade ledger (opens + closes) with realized P&L stats |
| `/notifications` | Full notification history with filters, and per-category browser notification preferences |

Every page's header also has a **watchlist** menu and a **notification
bell** (see below).

The `/options` page is tabbed:

- **Chain** — live options chain for XLM/BTC/ETH/SOL. Click an ask to buy, a
  bid to write (sell) and collect premium.
- **Positions** — quick view of open positions for the selected symbol;
  "Manage →" links to `/portfolio` for the actual close/roll actions.
- **Strategies** — 15 templated multi-leg structures (straddle, strangles,
  verticals, butterflies, iron condor/butterfly, collar, ratio spreads,
  call calendar/diagonal, jade lizard), each tagged with outlook, vol view
  and defined/undefined risk. Picking one resolves it onto the chain's
  listed strikes in an editable builder (flip legs, step strikes, per-leg
  expiry, add/remove legs) with a combined payoff diagram; legs execute
  atomically. Undefined-risk positions show a warning and need an explicit
  acknowledgement to execute. Calendars/diagonals chart P&L at the nearest
  expiry with the longer-dated leg marked to model.
- **Finder** — state an outlook, a target price (drag the marker on the
  chart) and date, a max loss and a budget; it ranks candidate strategies
  from the library across listed strikes/expiries by probability of
  profit, P&L at target and return on risk, in a Web Worker. "Load →"
  opens a candidate in the builder.
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
│   ├── history/          # Trade ledger
│   └── notifications/    # Notification history + preferences
├── features/
│   └── finder/           # Strategy finder: engine.ts (generate/prune/score),
│                         # finder.worker.ts, useStrategyFinder, UI
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
    ├── store/             # zustand + persist — now just wallet.ts (connect,
    │                      # sign-in-with-backend, bearer token)
    ├── pricing.ts        # Black-Scholes, vol smile — fallback/preview layer, see above
    ├── collateral.ts     # Collateral requirements (100% calls, 110% puts)
    ├── payoff.ts          # Multi-leg combined payoff math (local; backend equivalent unused)
    ├── risk.ts             # Whole-portfolio risk: groups all open positions per
    │                       # underlying into one payoff curve, stress-tests the
    │                       # account across a spot-shock grid
    ├── volSurface.ts      # Term-structure-aware IV surface grid
    ├── strategies.ts      # Strategy templates + metadata, dev-time validation,
    │                      # strike resolution onto listed strikes
    ├── notifications/     # Event bus, per-wallet IndexedDB store, producers,
    │                      # browser-notification prefs, server WS contract
    ├── watchlists/        # Multi-list watchlists: provider (server or local
    │                      # mode, optimistic updates) and pure list ops
    ├── csv.ts / notify.ts # CSV export, browser Notification wrapper
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

### Notifications

Producers publish to an event bus (`src/lib/notifications/bus.ts`) and
`NotificationsProvider` persists each event in IndexedDB per wallet (last
500), deduplicated by `dedupeKey` so several tabs observing the same alert
record it once; other tabs are synced over `BroadcastChannel`. Producers:
fills/closes/rolls (from `BackendDataContext`), triggered alerts, expiry
reminders (24h and 1h), session expiry/sign-out, and spot-feed outages.
Server-pushed notifications aren't implemented; the intended
`/api/v1/ws/notifications` frame format is in `serverContract.ts`.

### Watchlists

Favorites (the backend's existing single-set `/api/v1/watchlist`) still
drive `StarButton` and market-tab ordering, and appear as the first list.
Additional named lists use a multi-list API documented in
`src/lib/api/watchlists.ts`, which the backend doesn't serve yet. Until it
does (`GET /api/v1/watchlists` 404s), lists are saved in `localStorage`
per wallet and are uploaded automatically the first time the server
answers with no lists. Each row shows live spot, change since the session
started (there's no server-side 24h change), ATM IV and a sparkline from
the WebSocket feed's session buffer.

## Testing

Vitest with jsdom, React Testing Library, MSW for network tests and
`fake-indexeddb`. Tests live next to the code as `*.test.ts(x)`. Strategy
payoffs and finder rankings are snapshot-tested; `vitest run -u` updates
snapshots after an intentional change.

## Known gaps

- No CI workflow runs the tests yet.
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
