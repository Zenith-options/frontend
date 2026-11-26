# Error handling guide

- Classify with `classifyError(err)` (`src/lib/errors.ts`): kinds are `network`, `auth`, `validation`, `insufficient_funds`, `rate_limited`, `server`, `wallet_rejected`, `contract`, `unknown`. Each has a user-facing message and recommended action.
- Surface with `toast.fromError(err, { retry, context })` (`src/lib/toast.ts`). The queue is framework-agnostic, so stores and API code can call it. Identical toasts within 5s are merged (`×N`); errors persist until dismissed, success/info auto-dismiss.
- Never write an empty `catch`. Either surface the error or leave a comment explaining the deliberate fallback.
- Wrap independent page regions (chain, positions, charts) in `<RegionErrorBoundary region="...">`.

## BFF proxy error shape

Every error response from `src/app/api/bff/[...path]/route.ts` (and the
session endpoints in `src/lib/bff/handlers.ts`) has the same JSON body:

```json
{ "error": "<human-readable string>" }
```

The `Content-Type` is always `application/json`. There are no nested objects,
no `code` field, and no `details` array — just the single `error` string.

Status codes returned by the BFF layer itself (before the upstream is
reached):

| Status | Condition |
|--------|-----------|
| 400 | Malformed JSON body or missing required fields (session endpoints only) |
| 401 | Request requires authentication but no valid session cookie is present |
| 403 | CSRF check failed |
| 404 | Path not on the allowlist |
| 405 | Method not allowed for this path |
| 413 | Request body exceeds 1 MB |
| 502 | Upstream backend unreachable or returned an unexpected response |

When the upstream is reachable, its status code is forwarded verbatim and its
response body is streamed straight through — the BFF does not wrap upstream
errors in `{ "error": "..." }`. Clients must therefore handle both the BFF
error shape above and whatever error shape the upstream returns.
