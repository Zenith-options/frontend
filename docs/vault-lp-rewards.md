# Vault LP rewards: cumulative Merkle distributor (draft, #239)

## Reward formula (per vault, per epoch)
`reward(d) = epoch_budget * Σ_i shares(d, t_i)·Δt_i / Σ_i total_shares(t_i)·Δt_i`

`t_i` are the share-balance change points inside the epoch, taken from snapshots at the epoch boundaries plus on-chain deposit and withdraw events. Mid-epoch deposits and withdrawals are pro-rated through `Δt_i`. Amounts are rounded down to token stroops, and allocations that round to 0 produce no leaf.

## Leaf encoding
`leaf = sha256(0x00 || strkey_decode(depositor) (32 bytes) || cumulative_amount as i128 big-endian (16 bytes))`

Leaves are sorted by depositor bytes. Internal nodes are `sha256(0x01 || min(a,b) || max(a,b))`. The 0x00/0x01 domain prefixes stop a leaf being passed off as an internal node (second-preimage).

## Claim semantics
The contract stores `claimed[depositor]` (cumulative). A claim pays `cumulative_amount - claimed[depositor]` and rejects a proof whose cumulative amount is ≤ the claimed total, which prevents double claims. A new root supersedes the old one without invalidating unclaimed earlier epochs.

## Funding & recovery
The operator transfers each epoch's budget to the distributor before publishing its root. Root publication refuses to overwrite an epoch that is already funded. Funds unclaimed after N epochs are recoverable by the admin only to the treasury, and every recovery emits an event.

## Tree-size cap

Each epoch's leaf set is capped at 65 536 entries to bound the cost of Merkle tree generation. If the depositor count exceeds the cap, the generation job splits the allocation into shards keyed by `sha256(depositor)[0] % num_shards`; each shard gets its own root and an on-chain pointer in the distributor maps `(epoch, shard_id) -> root`. The claim UI resolves which shard to query from the depositor address before constructing the proof.

## Open work
Distributor contract under `contracts/`, generation job (backend repo), `src/lib/api/rewards.ts`, claim UI on `/vaults`, and tests.
