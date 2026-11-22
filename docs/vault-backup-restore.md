# Vault backend backup & restore (draft, #238)

The chain plus its event log is the source of truth. The vault DB is a projection we can rebuild.

| Service | RPO | RTO | Recovery path |
|---|---|---|---|
| Vault registry, epoch ledger, withdrawal queue | 5 min (PITR via WAL archiving) | 1 h | PITR restore, then replay from the recorded checkpoint |
| Share accounting cache | n/a (derived) | 30 min | Rebuild by replay |
| Indexer checkpoints | stored with every backup | — | Resume replay from `checkpoint_ledger` |

## Local backups
`docker compose --profile full up db-backup` writes a verified `pg_dump` every `BACKUP_INTERVAL_SECS` (default 1h) to the `zenith-db-backups` volume and keeps `BACKUP_RETENTION_DAYS` days of them (default 7). A dump that fails verification is kept as `*.failed` and is never restored.

Restore one with:
`docker compose --profile full run --rm db-backup 'pg_restore --clean --if-exists -d "$PGDATABASE" /backups/<file>.dump'`

## Restore order
1. Secrets and signing keys come from the secret manager. They are never inside data backups.
2. Restore the DB snapshot or PITR target. Read `checkpoint_ledger` from the backup manifest.
3. Replay events from `checkpoint_ledger` to the tip. Replay must be idempotent (upsert keyed on `(ledger, tx_hash, event_index)`).
4. Check invariants: total shares match the chain; queue entries reconcile with on-chain requests; the epoch ledger is contiguous.
5. Restore is done only when all invariants pass. Otherwise wipe the projection and replay from genesis or the earliest trusted checkpoint.

## Open work
Backup jobs, the drill script in `scripts/` and the drill test. The service code lives in the backend repo.
