# Vault LP incentive distributor

Per-epoch LP incentives for options vaults, paid through a cumulative Merkle
distributor. Reward math runs off-chain and is reproducible from published
snapshots. Depositors verify their own allocation against the on-chain root
instead of trusting an API response.

Contract: `contracts/rewards-distributor` (crate `zenith-rewards-distributor`).
Client: `src/lib/api/rewards.ts`. Reward generation job: backend repo
(`Zenith-options/backend`), not in this repository.

## Leaf encoding

```
leaf = sha256(0x00 || utf8(account) || 0x00 || u128_be(cumulative))
node = sha256(0x01 || min(a, b) || max(a, b))      // sorted pair
```

- `account` is the Stellar strkey (56 characters, G... or C...).
- `cumulative` is the total reward owed to the account across all epochs, in
  base units of the reward token, encoded as 16-byte big-endian unsigned.
- Pairs are sorted byte-wise, so a proof is a plain list of sibling hashes with
  no direction bits.
- A level with no sibling promotes its node unchanged. The proof omits it.
- An empty tree has no root. An allocation must not be claimed against one.

Fixed test vectors belong with the generator in the backend repo. The
contract and `rewards.ts` implement this encoding and must agree with those
vectors.

## Reward formula

For vault `v`, epoch `e`, with reward budget `R[v,e]` (base units) and
time-weighted share balance `W[i,e] = ∫ shares_i(t) dt` over the epoch:

```
reward[i,e]     = floor( R[v,e] * W[i,e] / Σ_j W[j,e] )
cumulative[i]   = Σ_{e' <= e} reward[i,e']
```

- Balances are snapshotted at epoch boundaries. Mid-epoch deposits and
  withdrawals are pro-rated by the time they were held. Balance changes are
  applied at their ledger timestamp.
- Rounding is floor per depositor. Rounding dust stays in the contract as
  surplus and is recoverable with `recover_surplus`.
- Zero-allocation wallets get no leaf. The API returns `cumulative: "0"` with an
  empty proof, which the client reports as `no_allocation`.
- Share balances that move between snapshot and claim do not change the
  committed amount. Claims pay out of `cumulative`, not of current balance.

## Publication and sharding

- Each publication commits one root over at most **4096 leaves**, the same
  bound the vault commitment spec uses for Soroban resource budgets.
- Larger populations are sharded: one root per shard, each with its own
  `fund` and `set_root` call. The client looks up the account's shard before
  verifying.
- Generation runs are append-only. `set_root` requires a strictly higher epoch,
  so a run cannot overwrite a published or funded epoch. A failed run is retried
  under a new epoch.
- `total_allocated` in each root must be at least the previous root's total and
  at most total funding.

## Contract surface

| Function | Caller | Effect |
| --- | --- | --- |
| `initialize(admin, operator, token, expiry)` | admin (once) | Sets roles, reward token and sweep time |
| `fund(from, amount)` | operator | Transfers reward tokens in; emits `fund` |
| `set_root(caller, epoch, root, total_allocated)` | operator | Publishes the latest root; emits `root` |
| `claim(account, cumulative, proof)` | account | Verifies proof against the latest root; pays `cumulative - claimed` |
| `recover_surplus(caller, to, amount)` | admin | Moves funds not owed under the latest root |
| `sweep_unclaimed(caller, to)` | admin, after `expiry` | Moves the full balance and closes claims |

Claims are cumulative. A newer root supersedes older ones because each
`cumulative` already includes earlier epochs. Only the latest root is claimable,
so a rolled root is not a second source of payouts. Total payouts can never
exceed the latest root's `total_allocated`.

## Funding runbook

1. Confirm the epoch's reward budget `R[v,e]` and the reward token (SEP-41).
2. Run the generator from published snapshots. Check that the root matches the
   fixed test vectors and that the recomputed leaves sum to `total_allocated`.
3. Publish the leaf set and root as an immutable artifact keyed by vault and
   epoch.
4. Operator calls `fund(operator, amount)` until total funding is at least the
   new `total_allocated`. Record the transaction hash alongside the artifact.
5. Operator calls `set_root(epoch, root, total_allocated)`.
6. Check `get_root`, `get_funded` and the emitted `fund` / `root` events.
   Recompute one proof from the published leaves.

## Recovery policy

- **Surplus** (funding above what the latest root owes, including rounding dust)
  is recoverable by the admin at any time through `recover_surplus`.
- **Owed but unclaimed** amounts stay claimable indefinitely. Nothing sweeps
  them early.
- After `expiry`, the admin may call `sweep_unclaimed`. This moves the full
  balance and closes claims permanently. Set `expiry` at initialization and
  publish it with the program terms.

## Known gaps (follow-up work)

- The reward generator, the `GET /api/v1/vaults/{id}/rewards/{account}` endpoint
  and the sharding index are backend work.
- The `/vaults` and LP position claim UI is not wired. The client returns
  `no_allocation` in mock mode. There is no claim transaction builder yet.
- Admin and operator keys can't be rotated without an upgrade. Add an
  `admin_transfer` before mainnet.
- The contract has no unit tests yet. The Merkle vectors and the cumulative-claim
  cases from the issue still need to be added.
