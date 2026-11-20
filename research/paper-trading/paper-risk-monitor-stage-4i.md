# Stage 4I — Paper Risk Monitoring and Kill Switch

## Scope
Adds a deterministic, local risk monitor for paper trading. It evaluates daily loss, peak-to-equity drawdown, and gross marked exposure. A breach latches the kill switch; recovery alone does not re-enable entries. An explicit reset is required after all hard limits are clear.

## Initial configurable defaults
- Daily loss limit: 3% of UTC day-start equity.
- Maximum peak-to-current drawdown: 10%.
- Maximum gross marked exposure: 80% of current equity.

These are conservative starting parameters for simulation, not universal trading advice. Calibrate them using strategy risk reports and paper-session evidence.

## Safety behavior
- Missing or invalid portfolio data fails closed.
- A breach emits a KILL_SWITCH_ACTIVATED audit event.
- Manual activation is supported.
- Reset requires a valid current snapshot and all configured hard limits to be clear.
- UTC date boundary resets the daily equity baseline.
- This module does not cancel exchange orders, close positions, or connect to Binance. It only controls permission for new paper entries.

## Integration boundary
The monitor is currently a standalone module. A later integration stage must persist risk events to the session ledger and make the broker reject new entries when allowNewEntries is false. Existing positions remain managed separately; this kill switch does not liquidate them.

## Tests
Covers normal allowance, daily loss, max drawdown, exposure, fail-closed inputs, latched stop, explicit reset, UTC day rollover, audit events and invalid configuration.
