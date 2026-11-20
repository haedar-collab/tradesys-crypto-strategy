# Stage 3X — Persistent Dataset Storage

## Implementation
A Node.js filesystem storage adapter writes validated OHLC datasets as immutable JSON snapshots. Dataset content is SHA-256 hashed; the hash is included in the filename and storage receipt. A per-dataset manifest index is written atomically using a temporary file and rename. Reads verify the checksum before parsing/returning the dataset.

## Safety controls
- Reject unsafe symbol, interval, and dataset identifiers.
- Resolve and constrain paths beneath the configured storage root.
- Re-run OHLC quality validation before persistence.
- Use exclusive file creation for immutable snapshots; existing identical content is idempotent.
- Verify SHA-256 on every read.
- Keep storage root configurable; no hard-coded user directory or credentials.

## Integration
Pass `createFileDatasetStore({rootDir}).writeDataset` as the pipeline's `writeDataset` callback. This adapter is local filesystem storage, not cloud replication or a database. Back up the storage root and manifests separately.

## Limitations
The manifest index is a per-dataset latest pointer and is not a transactional multi-file database. A crash after snapshot write but before manifest update can leave an unindexed immutable snapshot; reconciliation tooling is a future task. No encryption-at-rest, retention policy, or automatic backup is included.