# Next.js 15 + React 19 Migration Plan

> **Status: not yet started.**
> This document describes the planned upgrade from the current stack. The repo
> is on the versions in the "Current" column below.

## Current stack (as of this writing)

| Package | Current | Target |
|---|---|---|
| `next` | 14.2.3 | 15.x |
| `react` | ^18 | 19.x |
| `react-dom` | ^18 | 19.x |
| `@types/react` | ^18 | ^19 |
| `@types/react-dom` | ^18 | ^19 |
| `eslint` | ^8 | ^9 |
| `eslint-config-next` | 14.2.3 | 15.x |
| `zustand` | ^4.5.2 | ^5.x |

The versions above are authoritative — check `package.json` if this table
looks stale.

## Breaking changes to address

### 1. Fetch caching defaults

In Next.js 15, `fetch()` defaults to `no-store` instead of `force-cache`.

**Expected impact on this app:** None. All data fetching uses the client-side
`src/lib/api/client.ts` wrapper that runs in the browser. No server components
fetch data. Verify by auditing any new server components added before the
upgrade.

### 2. `params` and `searchParams` are async in server components

In Next.js 15, `params` and `searchParams` props on server page components
are Promises that must be `await`-ed.

**Expected impact on this app:** None. All pages are `"use client"` components
and use `useSearchParams()` from `next/navigation` rather than the
`searchParams` prop. Verify by grepping for `searchParams` props on server
components before the upgrade.

### 3. `<Link>` no longer passes `legacyBehavior` by default

**Expected impact:** None — the app uses `<Link href="...">` directly, without
the legacy `<a>` nesting pattern.

### 4. Turbopack stable

`next dev --turbopack` is the recommended dev server in Next.js 15. Update
the `dev` script in `package.json` once the upgrade is done and validate that
the existing webpack customisations in `next.config.js` and `next.config.ts`
are either no longer needed or have Turbopack equivalents.

### 5. ESLint 9 flat config

ESLint 9 uses `eslint.config.mjs` (flat config) instead of `.eslintrc.json`.
The existing `.eslintrc.json` will need to be replaced. Use `eslint`'s
migration guide or `npx @eslint/migrate-config .eslintrc.json` to generate a
starting point.

## React 19 changes to address

### 1. `ref` as a prop (no `forwardRef`)

React 19 allows passing `ref` directly as a prop without `forwardRef`. No
`forwardRef` is used in this codebase, so no change is needed.

### 2. `use client` / `use server` directives

No changes needed — all interactive components already carry `"use client"`.

### 3. `StoreHydrator` and `useHydrated` under React 19 StrictMode

React 19 StrictMode double-invokes effects in development, meaning
`useWalletStore.persist.rehydrate()` in `StoreHydrator` will fire twice in
dev. This is safe — `rehydrate()` is idempotent.

`useHydrated` sets state in `useEffect`, which fires once per mount even under
StrictMode, so the `hydrated` flag will still flip correctly.

### 4. zustand v5 compatibility

zustand v5 is compatible with React 19. The `create` + `persist` middleware
API is unchanged, and `useWalletStore.persist.rehydrate()` remains valid —
zustand v5 keeps the same `persist` sub-object shape.

## Dependency compatibility

- `@stellar/freighter-api ^2.0.0`: React 19 compatible (no React peer dep)
- `zustand ^5.x`: React 19 compatible (peer dep accepts React 18/19)

## QA checklist

Use this for the post-upgrade manual QA pass.

### All routes

- [ ] No hydration warnings in the browser console on first load
- [ ] No React StrictMode double-render warnings
- [ ] `useHydrated()` still prevents wallet-gated data from showing before
      the store rehydrates (check: reload with a persisted wallet token —
      positions should not flash before hydration)

### `/` (home)

- [ ] Landing page renders without errors
- [ ] Preview options chain loads and ticks live
- [ ] Watchlist section renders (may be empty without a wallet)
- [ ] `Trade Options` link navigates to `/options`

### `/options`

- [ ] Market tabs (XLM/BTC/ETH/SOL) switch correctly
- [ ] Chain table loads from the backend (or falls back to local BS)
- [ ] Clicking ask/bid opens the right-hand trade panel
- [ ] Strategies tab renders StrategyPicker and payoff diagram
- [ ] Surface tab renders the vol heatmap
- [ ] Positions tab shows live positions (requires wallet + backend)
- [ ] Trade confirm dialog opens and submits without errors

### `/portfolio`

- [ ] Positions table renders and marks to market
- [ ] Roll panel opens, previews correctly, and submits
- [ ] Close button works
- [ ] CSV export works

### `/history`

- [ ] Trade history table renders
- [ ] Stats bar shows correct totals
- [ ] CSV export works

### Wallet flow

- [ ] Wallet connect button works (or shows "not installed" gracefully)
- [ ] Reconnect on reload restores session without a sign prompt (if token
      still valid)
- [ ] Disconnect clears token and hides position data

## Out of scope

New React 19 features (Actions, `useOptimistic`, Server Actions) are
intentionally out of scope — only the changes required to stay compatible are
included.
