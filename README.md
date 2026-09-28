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
npm run build      # production build
npm run lint       # next lint
npm run typecheck  # tsc --noEmit
npm test           # vitest (jsdom + React Testing Library)
```

## Pages

| Route | What's there |
|---|---|
| `/` | Marketing/landing page, live preview chain, watchlist |
| `/options` | The terminal: chain, positions, strategy builder, vol surface |
| `/portfolio` | Open positions marked-to-market, roll, close, CSV export, portfolio-wide risk panel |
| `/history` | Full trade ledger (opens + closes) with realized P&L stats |
| `/compete` | Competition listing, grouped by phase (live / upcoming / past) |
| `/compete/[id]` | Opt-in, live leaderboard, personal rank card, and final results |
| `/compete/[id]/rules` | The config-rendered rules page for one competition |

The `/options` page is tabbed:

- **Chain** — live options chain for XLM/BTC/ETH/SOL. Click an ask to buy, a
  bid to write (sell) and collect premium.
- **Positions** — quick view of open positions for the selected symbol;
  "Manage →" links to `/portfolio` for the actual close/roll actions.
- **Strategies** — templated multi-leg trades (straddle, bull call spread,
  bear put spread, iron condor) with a combined payoff diagram, executed
  atomically.
- **Surface** — an IV heatmap across strikes and expiries, with a simple
  term-structure model (skew dampens for longer-dated options).

## Trading competitions

`/compete` lists every competition, `/compete/[id]` is the running event
(opt-in, live leaderboard, personal rank, final results), and
`/compete/[id]/rules` is the shareable rules page. The module is
**config-driven**: a competition is data, and everything the UI shows — dates,
eligible underlyings, scoring method, minimum trades/volume, prize tiers, extra
rules — comes from that payload rather than a source file, so the community
team can schedule the next event without a frontend change.

- **Config schema & validation** — `src/lib/competitions.ts`. Payloads are
  validated before render (`validateCompetitionConfig`), so a malformed
  competition degrades to a readable error instead of `undefined` / `Invalid
  Date` in the rules page.
- **Phase is derived, never stored** — `phaseOf()` compares absolute instants,
  so a competition crosses Upcoming → Live → Ended on its own and scheduling is
  DST-safe. Boundaries are half-open: `starts_at` is already live, `ends_at` is
  already ended. `registration_closes_at` may be omitted (closes at the start,
  the conservative default) or `null` (stays open to the end).
- **Opt-in is a signed message** — `useCompetitionRegistration` requests a
  backend challenge, signs it with Freighter, and posts the signature. A bearer
  token alone must not be able to enter an address the signer does not control.
- **Live leaderboard** — server-side pagination and search (searching only the
  loaded page would be a lie), a selectable refresh cadence that pauses while
  the tab is hidden, shared ranks for ties (`=3`), and disqualification shown on
  the row rather than hidden.
- **Privacy** — a display name is opt-in and reversible; without one, a
  truncated address is shown (`displayNameFor`). It is never inferred.
- **Anti-gaming is displayed** — the minimum trades/volume and any daily cap are
  rendered on the rules page and in the entrant's own rank card, so an entry
  that cannot qualify learns that before trading, not at payout.

### Competitions API contract

The scoring service and prize-distribution contracts are out of scope for the
frontend issue, so `src/lib/api/competitions.ts` is the contract the UI is
written against:

| Method | Path |
|---|---|
| `GET` | `/api/v1/competitions` |
| `GET` | `/api/v1/competitions/:id` |
| `GET` | `/api/v1/competitions/:id/leaderboard?page&page_size&search` |
| `GET` | `/api/v1/competitions/:id/me` |
| `POST` | `/api/v1/competitions/:id/registration-message` |
| `POST` | `/api/v1/competitions/:id/register` |
| `POST` | `/api/v1/competitions/:id/display-name` |
| `GET` | `/api/v1/competitions/:id/results` |

Until the backend implements them, the pages show their honest empty/error
states — no seeded or mock data is rendered as if it were real.

## Architecture

```
src/
├── app/                  # Next.js App Router pages
│   ├── layout.tsx        # Mounts SpotFeedProvider + BackendDataProvider at the root
│   ├── page.tsx          # Home
│   ├── options/          # Chain / Positions / Strategies / Surface
│   ├── portfolio/        # Open positions, roll, close
│   ├── compete/          # Competition listing, detail ([id]), rules ([id]/rules)
│   └── history/          # Trade ledger
├── components/           # UI components (charts, dialogs, header, etc.)
│   └── compete/          # Competition cards, rules, opt-in, leaderboard, rank, results
└── lib/
    ├── api/              # Typed backend client: one file per domain
    │   ├── client.ts     # fetchJson + wsUrl(), NEXT_PUBLIC_API_URL, bearer auth header
    │   ├── market.ts, positions.ts, watchlist.ts, alerts.ts, history.ts,
    │   │   strategies.ts, auth.ts, ws.ts, payoff.ts (client exists, unused),
    │   │   competitions.ts (contract; backend not implemented yet)
    │   └── types.ts      # Response shapes mirroring the backend's
    ├── hooks/             # useBackend{Account,Positions,Watchlist,Alerts,History},
    │                      # useCompetitions/useLeaderboard/useMyRank,
    │                      # useCompetitionRegistration, useTiming (now + debounce),
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
    ├── competitions.ts     # Competition config schema/validation, phases,
    │                       # scoring + prize formatting, tie + anti-gaming rules
    ├── volSurface.ts      # Term-structure-aware IV surface grid
    ├── strategies.ts      # Multi-leg strategy templates
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

## Known gaps

- Tests cover the competition module only (`npm test`) — the rest of the app
  still has no suite. There is no CI workflow in this repository.
- The competitions API is a frontend-side contract: `src/lib/api/competitions.ts`
  defines the endpoints the UI calls, but the backend does not implement them
  yet, so `/compete` renders its empty/error states against a real backend. The
  scoring service and prize distribution are out of scope for the frontend
  issue.
- The leaderboard renders a plain table rather than the reusable DataGrid being
  added in #148, which is not on `main` yet. Rows are shaped so the swap is a
  presentation change (`LeaderboardEntry` in, one row out) when it lands.
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
