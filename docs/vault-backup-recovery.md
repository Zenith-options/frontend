# Vault Backup, Disaster Recovery & State-Restore Runbook

Scope: the stateful vault backend services: vault registry, epoch ledger, withdrawal
(redemption) queue, share accounting cache, and indexer checkpoints. Implementation of
the services, migrations, and drill automation lives in the backend repo
(`Zenith-options/backend`). This document is the contract and procedure; it is the
reference the on-call engineer uses during a data incident.

Out of scope: Soroban contract storage (chain-replicated, not restorable from us) and
platform-wide infrastructure backup.

**Status:** Targets and procedure below are proposed. No drill has been recorded yet.
The flag rollout is blocked until one full manual drill is recorded in
[Drill Log](#drill-log).

---

## 1. Principle: the chain is the source of truth

- Soroban holds balances and shares. The database is a **rebuildable projection** of the
  on-chain event log, plus a few off-chain fields (registry metadata, operator notes).
- Recovery therefore has two paths:
  1. **Restore** a database snapshot + PITR, then replay the gap to the chain head.
  2. **Replay** from a trusted ledger into an empty projection (no backup needed).
- Replay is idempotent: events are keyed `(contract_id, ledger_sequence, transaction_hash,
  event_index)`, and upserts update in place. A restore followed by replay converges; it
  does not double shares, fees, or redemptions. See [LEDGER.md](./LEDGER.md) and
  [vault-indexer.md](./vault-indexer.md).
- Restoring is faster only when the snapshot is recent. Otherwise, replay is the default.

## 2. What is backed up

| Store | Kind | Backup method | Notes |
| --- | --- | --- | --- |
| Vault registry | Mixed: chain-derived + off-chain metadata | Snapshot + PITR | Off-chain metadata is **not** recoverable from chain; this is why RPO matters. |
| Epoch ledger | Chain-derived | Snapshot + PITR; replay as fallback | Must be contiguous (see invariants). |
| Withdrawal queue | Chain-derived, positions are user-facing | Snapshot + PITR | Queue positions are what depositors rely on. |
| Share accounting cache | Derived | Snapshot (optional); prefer rebuild | Rebuilt from events; never the authority. |
| Indexer checkpoints | Derived, committed in the same transaction as the events they cover | Included in every snapshot; recorded in the backup manifest | Source of the resume ledger. |
| Signing / API keys, KMS material | Secrets | **Not** in data backups | See section 6. |

Assumption: the vault database is PostgreSQL with WAL archiving. If it is not, the
PITR column below must be re-derived from the platform's actual mechanism.

## 3. Schedule, retention, and encryption

| Item | Setting (proposed) |
| --- | --- |
| Base snapshot | Daily, 02:00 UTC |
| Continuous WAL / PITR | Always on; archived continuously |
| Snapshot retention | 30 days |
| PITR window | 14 days |
| Pre-migration snapshot | Taken before every schema migration, labelled with the migration version; kept 90 days |
| Encryption at rest | Required. Keys in KMS, separate from the data store |
| Access | Named restore role only; every restore is logged |
| Retention alignment | Must match the depositor data retention and privacy policy. Confirm with the privacy owner before enabling. |

Each backup writes a **manifest** next to the artifact:

```json
{
  "artifact": "vault-db-2026-11-21T02:00Z.dump.enc",
  "sha256": "<hex>",
  "schema_version": "<migration id>",
  "indexer_checkpoints": { "<contract_id>": { "ledger_sequence": 0, "ledger_hash": "<hex>" } },
  "created_at": "<ISO-8601 UTC>"
}
```

The checkpoint in the manifest is the ledger the restore resumes from. A backup without
a manifest, or whose checkpoint hash does not match the chain, is rejected.

## 4. RPO / RTO targets

RPO = maximum acceptable data loss. RTO = maximum time to serve correct data again.

| Service | RPO | RTO | Recovery path |
| --- | --- | --- | --- |
| Vault registry | 24 h (snapshot) / 15 min with PITR | 4 h | Restore; then reconcile metadata against chain |
| Epoch ledger | 0 (chain-derivable) | 2 h | Restore if snapshot is recent; otherwise replay |
| Withdrawal queue | 15 min | 2 h | Restore + PITR; replay to head |
| Share accounting cache | n/a (derived) | 1 h | Rebuild from event log |
| Indexer checkpoints | 0 (same transaction as events) | 1 h | Restore with snapshot; resume from manifest checkpoint |

These are proposals. The on-call owner and the product owner must sign off before the
flag rollout. A drill that misses a target is a failed drill, not a reason to change the
target silently.

## 5. Decision: restore vs. replay

Use **restore** when all are true:

- A snapshot exists whose manifest passes checksum and checkpoint verification.
- Its `schema_version` matches the deployed migration.
- Restore plus replay of the gap to head fits inside the RTO.

Use **replay** (fail over) when any is true:

- No snapshot, or the only snapshot fails verification (corrupt, truncated, or checkpoint
  hash mismatch).
- Snapshot schema is older than the deployed code and the migration cannot be applied
  safely to it.
- The snapshot is older than the replay cost (replay is estimated from ledgers behind
  head ÷ indexer throughput, measured in the last drill).
- Invariant checks fail after restore and the cause is not obviously a single bad row.

When in doubt, replay. Replay is slower but needs no trust in stored state.

## 6. Restoration ordering

Keys and data are restored separately, in this order:

1. **Secrets and signing keys** from the secrets manager / KMS. Never from a data backup.
   Confirm the key identity matches the registry's configured operator and signer.
2. **Freeze writes**: pause the affected vault(s) via the operator console or contract
   pause. Do not restore while an epoch is in flight without an explicit operator decision
   (see section 7).
3. **Database**: restore the snapshot to a new instance, apply PITR to the target time.
4. **Indexer**: start at the manifest checkpoint (or the registry `deploymentLedger` for
   replay). Do not start the indexer against a database whose checkpoint is unknown.
5. **Verify** invariants (section 8).
6. **Replay to head**, then re-verify.
7. **Unpause** only after invariants pass and the nightly reconciliation job has run once
   against the restored state with no drift above threshold (see
   [vault-alerts.md](./vault-alerts.md)).
8. **API last**: the public API reads the projection; serve it only after step 7.

## 7. Restoring mid-epoch

- The epoch ledger may be partially written. Do not guess the epoch state.
- Restore the epoch row only from the snapshot whose checkpoint ledger is at or before the
  epoch's last committed event. Anything after that is re-derived by replay.
- If the epoch was in `settlement` at the time of failure, keep the vault paused until an
  operator confirms the on-chain epoch state matches the restored projection.
- Do not manually re-enter redemption queue positions. Re-derive them from events.

## 8. Invariants (run after every restore and every replay)

| # | Invariant | How checked | Failure means |
| --- | --- | --- | --- |
| I1 | Total shares in the projection equal on-chain total supply at the checkpoint ledger | Compare share cache to contract `total_supply` read at the checkpoint ledger | Projection is wrong or behind |
| I2 | Every queue entry reconciles: sum of queued redemption amounts equals on-chain pending redemptions; no entry without an on-chain request event | Reconcile queue against event log and chain | Queue lost or duplicated entries |
| I3 | Epoch ledger is contiguous: epoch ids form an unbroken sequence with no gaps or duplicates, and each epoch's open event precedes its close event | SQL check on epoch table | Missing epoch history |
| I4 | Stored `ledger_hash` at each checkpoint matches the chain hash for that sequence | Fetch ledger hash from RPC/archive | Reorg or bad write; refuse to advance |
| I5 | Replay is a no-op on re-ingest: replaying an already-restored range changes zero rows | Re-run replay on a copy; compare row counts and aggregates | Upsert keys wrong; double-counting risk |

A restore is **not** accepted because the schema checks pass. Schema-valid but semantically
behind data is the main failure this table exists to catch. I1 and I3 are mandatory.

## 9. Corrupt or truncated backups

- Verify the manifest `sha256` before restore. Mismatch → reject the artifact, alert, and
  use the next older snapshot or replay.
- Verify the dump is readable (list its contents) before restoring into the live instance.
- A backup that restores but fails I1–I4 is treated as corrupt, even if it loads.

## 10. Releases and rollback

- A frontend rollback ([RELEASING.md](../RELEASING.md)) does **not** restore data. Data
  restore is a separate decision and follows this runbook.
- Before a backend migration ships, take and verify a labelled pre-migration snapshot.
- If a migration is rolled back, restore the pre-migration snapshot only if replay is
  not faster; otherwise run the rolled-back code and replay.

## 11. Drill procedure

Run the drill locally with `docker-compose.yml` (vault DB + indexer services) and against
staging. The drill is the proof that this document works.

1. **Prepare:** start the stack; note the head ledger and the vault contract id.
2. **Seed:** let the indexer run to a known ledger `N`. Record the share total and queue
   depth from the API.
3. **Snapshot:** take a snapshot and write its manifest. Expected: manifest checkpoint =
   `N`, checksum verifies.
4. **Corrupt-backup check:** truncate a copy of the artifact. Expected: restore is rejected
   at checksum or dump-list. Record the rejection message.
5. **Destroy:** drop the vault database volume.
6. **Restore:** restore the valid snapshot into a fresh instance. Expected: state matches
   step 2 at ledger `N`.
7. **Replay:** replay from `N` to head. Expected: indexer reports lag ≤ 5 ledgers.
8. **Verify:** run I1–I5. Expected: all pass. Record each result.
9. **Idempotence:** replay `[N, head]` a second time. Expected: zero rows changed.
10. **Time it:** record elapsed time for steps 5–8 against the RTO table.

Record the outcome in the drill log below. Attach the command output for steps 3, 4, 8, and 9.

## Drill Log

| Date | Environment | Operator | Snapshot ledger | Restore time | Replay time | I1–I5 | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _not yet run_ | | | | | | | |

## Open risks

- **Restore is not yet proven end to end.** Until the drill is logged, treat recovery as
  unverified. Early warning: any step above fails or exceeds RTO.
- **Off-chain registry metadata is not replayable.** Its RPO is the only real data-loss
  exposure. Mitigation: frequent PITR; export the registry metadata to the manifest.
- **Replay speed depends on RPC retention.** Soroban RPC keeps a limited event window; older
  history must come from an archive (see [vault-indexer.md](./vault-indexer.md)). Check
  archive availability before relying on replay for old ledgers.

## Related

- [vault-indexer.md](./vault-indexer.md): cursor, backfill, rebuild
- [LEDGER.md](./LEDGER.md): checkpoint and replay runbook
- [vault-alerts.md](./vault-alerts.md): reconciliation and lag alerts
- [vault-operator-runbook.md](./vault-operator-runbook.md): pause and operator actions
- [RELEASING.md](../RELEASING.md): release and rollback
