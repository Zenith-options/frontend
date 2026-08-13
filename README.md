# Zenith Frontend

Next.js 14 (App Router) options trading terminal for Zenith, a decentralized
options protocol on Stellar Soroban. Options chain, portfolio, trade history,
multi-leg strategy builder, and a vol surface — all in a dense,
Bloomberg-style dark UI.

## Status: fully client-side, no backend wired up yet

Every price, Greek, and "market" figure in this app is computed in the
browser (`src/lib/pricing.ts`) using Black-Scholes with a simulated crypto
vol smile. There are currently **no** calls to the backend's `/api/v1/*`
endpoints, no `.env` files, and no network requests at all beyond the
Freighter wallet extension. Positions, account balance, trade history,
alerts, and your watchlist persist to `localStorage` via `zustand/persist`,
not a server. Wiring this up to the real backend and on-chain contracts is
the next piece of work, not something already half-done.

## Getting started

```bash
npm install
npm run dev
# http://localhost:3000
```

```bash
npm run build   # production build
npm run lint     # next lint
```

No environment variables are required to run it today.

## Pages

| Route | What's there |
|---|---|
| `/` | Marketing/landing page, live preview chain, watchlist |
| `/options` | The terminal: chain, positions, strategy builder, vol surface |
| `/portfolio` | Open positions marked-to-market, roll, close, CSV export |
| `/history` | Full trade ledger (opens + closes) with realized P&L stats |

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

## Architecture

```
src/
├── app/                  # Next.js App Router pages
│   ├── page.tsx          # Home
│   ├── options/          # Chain / Positions / Strategies / Surface
│   ├── portfolio/        # Open positions, roll, close
│   └── history/          # Trade ledger
├── components/           # UI components (charts, dialogs, header, etc.)
└── lib/
    ├── pricing.ts        # Black-Scholes, vol smile, markets/expiries, formatters
    ├── collateral.ts     # Collateral requirements (100% calls, 110% puts)
    ├── payoff.ts          # Multi-leg combined payoff math
    ├── volSurface.ts      # Term-structure-aware IV surface grid
    ├── strategies.ts      # Multi-leg strategy templates
    ├── csv.ts / notify.ts # CSV export, browser Notification wrapper
    ├── useHydrated.ts     # SSR-hydration-safety hook (see below)
    ├── usePriceHistory.ts # In-memory spot sparkline buffer
    └── store/             # zustand + persist: positions, account, history,
                            # alerts, watchlist, wallet
```

### A note on hydration safety

Every persisted store uses `skipHydration: true` plus `StoreHydrator`
(mounted once in the root layout) to pull real `localStorage` data in after
mount instead of at module-eval time. That alone isn't sufficient wherever a
component sits inside the `/options` page's `<Suspense>` boundary (required
for `useSearchParams`) — a root-level effect can update a store before that
boundary's own deferred hydration pass runs, which mismatches against the
static server HTML. Components that render persisted data inside that
boundary (`StarButton`, `AlertsPanel`, `AppHeader`'s balance chip, the
favorites-sorted market tabs) additionally gate their rendered value behind
`useHydrated()`, which is only `true` after that specific component's own
mount effect has fired. If you add a new component that reads from a
persisted store and renders inside `/options`, it needs the same guard.

## Known gaps

- No test suite.
- No backend/on-chain integration (see above).
- `src/app/options/page.tsx` has grown large (chain + positions + strategies
  + surface + both trade panels + confirm dialogs) — a good candidate to
  split into sub-components before adding much more to it.
- Accessibility is minimal — several controls (star toggle, alert form,
  contracts stepper) have no `aria-label`.

## License

MIT © Zenith Protocol Contributors
