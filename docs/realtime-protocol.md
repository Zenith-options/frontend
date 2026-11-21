# Realtime Protocol

This document describes the shared WebSocket connection used by the app for live
market and vault data. The connection is owned by a single context
(`src/lib/context/SpotFeedContext.tsx`); components never touch the raw socket
and instead consume typed hooks/selectors.

## Connection

The socket URL comes from the `NEXT_PUBLIC_SPOT_FEED_WS_URL` build-time env var.
If it is unset, no connection is opened. The client opens a single connection
and multiplexes all topics over it. Subscriptions are lazy (created on first
consumer, released on unmount).

Client implementation: `src/lib/context/SpotFeedContext.tsx`
(`SpotFeedProvider`, `useSpotFeed`, `useVaultTicks`). Note that
`src/lib/realtime/` is a separate per-channel client that does not use this
envelope and has no current consumers; do not build against it.

## Message envelope

Every frame, in both directions, is JSON with a `v` field. The client only
accepts server frames where `v === 1` and silently drops anything else.

### Client → server

The client sends two frame shapes:

```jsonc
{ "v": 1, "op": "subscribe",   "topic": "vault:0xabc" }
{ "v": 1, "op": "unsubscribe", "topic": "vault:0xabc" }
```

| Field   | Type   | Description                                                        |
|---------|--------|--------------------------------------------------------------------|
| `v`     | number | Schema version. Always `1`.                                        |
| `op`    | string | `"subscribe"` or `"unsubscribe"`.                                  |
| `topic` | string | Topic key, e.g. `vault:<vaultId>`.                                 |

`subscribe` is sent when the first consumer of a topic mounts, and again for
every active topic after each (re)connect. `unsubscribe` is sent when the last
consumer of a topic unmounts. The client sends no other frames (no heartbeat,
no ack).

### Server → client

```jsonc
{
  "v": 1,                  // schema version, aligned with vault event schema
  "topic": "vault:0xabc",  // subscription topic key
  "type": "vault.tick",    // message type
  "ts": 1717171717000,     // server timestamp (ms since epoch, authoritative)
  "data": { /* type-specific payload */ }
}
```

| Field   | Type   | Description                                                           |
|---------|--------|-----------------------------------------------------------------------|
| `v`     | number | Must be `1`. Other values are dropped.                                |
| `topic` | string | Topic key. Vault topics are `vault:<vaultId>`.                        |
| `type`  | string | Message type. The client dispatches on `vault.tick`; others are passed to topic handlers. |
| `ts`    | number | Server time in ms since epoch. Used for clock-skew correction.        |
| `data`  | object | Type-specific payload (see below).                                    |

Frames that fail to parse as JSON are ignored.

### `vault.tick` payload

Sent on topic `vault:<vaultId>`. The wire payload is typed as:

```jsonc
{
  "navPerShare": "1.0421",    // string, NAV per share (decimal)
  "epoch": 42,                // number, current epoch number
  "epochCloseAt": 1717175317000, // number, epoch close time (ms since epoch, server clock)
  "queueDepth": 125000        // number, redemption queue depth
}
```

The vault id is not in the payload; it is the `vault:<vaultId>` suffix of
`topic`. The client adds two local fields, neither of which is on the wire:

- `updatedAt`: the envelope `ts`.
- `clockSkewMs`: `ts - Date.now()` at receipt.

The epoch countdown is computed locally as
`max(0, floor((epochCloseAt - (Date.now() + clockSkewMs)) / 1000))`, so it
does not depend on per-second server pushes and is anchored to the server clock.

The payload is cast to its type without runtime validation.

## Subscription lifecycle

- Topics are subscribed lazily on first consumer and released on unmount.
- On socket drop the client marks data stale/offline and reconnects with
exponential backoff; on resume it re-subscribes to active topics.
- First paint uses server data (SSR/hydration safe), then hydrates to live
values without layout shift.

## Out of scope

Push notifications/alerts for epoch and redemption events, and the backend
indexer that produces the underlying data, are handled separately.
