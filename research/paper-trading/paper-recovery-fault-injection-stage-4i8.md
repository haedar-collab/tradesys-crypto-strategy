# Paper Recovery Fault Injection — Stage 4I.8

## Scope

This stage exercises failure boundaries in the paper-ledger recovery and audit-artifact paths. It does not enable live orders, repair ledgers, replay ambiguous orders, or remove stale locks.

## Changes

- Recovery report export now writes and fsyncs a unique temporary file, then publishes it with a same-filesystem hard link. Publication is atomic and refuses to overwrite an existing report.
- Temporary export files are removed on ordinary error paths.
- Migration failure tests verify that validation errors release the migration's own lock, preserve source bytes, and do not create a destination.
- Interrupted-migration simulation leaves a stale source lock and orphan temporary file. Preflight and migration must fail closed while preserving both pieces of evidence.
- Report export tests verify complete publication, collision handling, preservation of existing bytes, and temporary-file cleanup.

## Verification boundaries

The interrupted migration scenario is a deterministic filesystem-state simulation, not a forced power-loss or kernel crash test. It validates the recovery policy when stale lock/orphan-temp evidence is present. It does not prove behavior under every filesystem, storage-controller, network-filesystem, or power-loss condition.

The atomic publication guarantee depends on same-filesystem hard-link semantics. If the destination filesystem does not support hard links, export fails rather than falling back to a potentially non-atomic write.

## Operator policy

1. Do not delete a stale lock until the operator has established that no process still owns the ledger.
2. Preserve orphan temporary files as evidence until the incident is reviewed.
3. Never overwrite an existing audit report or migration destination.
4. Verify the source ledger and destination copy independently after any migration.
5. Treat any interrupted order intent as unresolved until external execution evidence is reviewed.

## Status

Implementation and automated CI status are tracked by the GitHub Actions run attached to the stage commits. This stage improves failure handling but does not certify production readiness or exchange execution truth.
