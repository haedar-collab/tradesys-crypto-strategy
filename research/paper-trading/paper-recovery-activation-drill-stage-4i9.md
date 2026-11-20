# Recovery Activation Drill — Stage 4I.9

## Objective

Verify the boundary between recovery and session activation when the ledger contains a write-ahead order intent without a durable fill.

## Drill scenarios

- Recovery detects the interrupted intent and records one durable rejection for manual review.
- The audit returns REVIEW and session activation is denied.
- The session releases its exclusive ledger lock when activation fails.
- A repeated recovery attempt does not append a duplicate rejection or create a fill.
- The unresolved incident remains visible in the audit findings; recording a rejection is not equivalent to proving that no external execution occurred.

## Expected operator interpretation

A REVIEW result is a hard activation block. The operator must inspect any external execution evidence before deciding how to resolve the incident. The local paper broker cannot establish whether a real exchange order was executed, because this application is paper-only and has no exchange execution integration.

## Safety properties tested

- No automatic order replay.
- No synthetic fill.
- No automatic stale-lock deletion.
- No activation while unresolved order evidence remains.
- Failed activation releases the process lock.
- Repeated recovery is idempotent with respect to the terminal rejection event.

## Limitations

These are deterministic Node.js integration tests, not a proof against arbitrary process termination at every instruction boundary, storage-controller failure, or multi-host filesystem behavior. The lock design remains limited to supported local filesystem exclusive-create semantics.

## Status

See the linked GitHub Actions workflow for the automated test result. No production-readiness claim is made by this drill.
