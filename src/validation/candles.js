/**
 * Normalize Binance Spot klines and validate candle-series integrity.
 * Pure module: no network, browser, storage, or exchange SDK dependency.
 *
 * Binance kline row indexes:
 * 0 open time, 1 open, 2 high, 3 low, 4 close, 5 base volume,
 * 6 close time, 7 quote volume.
 */

const REQUIRED_FIELDS = ["openTime", "closeTime", "open", "high", "low", "close", "volume"];

function issue(code, message, severity = "error", index = null) {
  return { code, message, severity, index };
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(row, index) {
  if (Array.isArray(row)) {
    if (row.length < 8) return { error: issue("KLINE_ROW_SHORT", "Binance kline row must contain at least 8 fields.", "error", index) };
    const values = {
      openTime: finiteNumber(row[0]),
      open: finiteNumber(row[1]),
      high: finiteNumber(row[2]),
      low: finiteNumber(row[3]),
      close: finiteNumber(row[4]),
      volume: finiteNumber(row[5]),
      closeTime: finiteNumber(row[6]),
      quoteVolume: finiteNumber(row[7])
    };
    return { value: values };
  }

  if (!row || typeof row !== "object") {
    return { error: issue("KLINE_ROW_TYPE", "Candle must be a Binance kline array or candle object.", "error", index) };
  }

  const values = {};
  for (const field of REQUIRED_FIELDS) values[field] = finiteNumber(row[field]);
  values.quoteVolume = row.quoteVolume == null ? null : finiteNumber(row.quoteVolume);
  return { value: values };
}

export function normalizeCandles(rows, options = {}) {
  const {
    now = Date.now(),
    intervalMs = null,
    maxStalenessMs = null,
    requireContiguous = false,
    allowForming = false
  } = options;

  const errors = [];
  const warnings = [];
  if (!Array.isArray(rows)) {
    return { status: "FAIL", candles: [], errors: [issue("KLINE_INPUT_TYPE", "Input candles must be an array.")], warnings: [] };
  }
  if (!Number.isFinite(now)) {
    return { status: "FAIL", candles: [], errors: [issue("NOW_INVALID", "now must be a finite timestamp.")], warnings: [] };
  }
  if (intervalMs != null && (!Number.isFinite(intervalMs) || intervalMs <= 0)) {
    return { status: "FAIL", candles: [], errors: [issue("INTERVAL_INVALID", "intervalMs must be a positive finite number.")], warnings: [] };
  }

  const normalized = [];
  rows.forEach((row, index) => {
    const parsed = normalizeRow(row, index);
    if (parsed.error) {
      errors.push(parsed.error);
      return;
    }
    const c = parsed.value;
    const missing = REQUIRED_FIELDS.filter(k => c[k] == null);
    if (missing.length) {
      errors.push(issue("KLINE_NON_FINITE", `Missing or non-finite candle fields: ${missing.join(", ")}.`, "error", index));
      return;
    }
    if (c.openTime < 0 || c.closeTime < c.openTime) {
      errors.push(issue("KLINE_TIME_RANGE", "Candle timestamps are invalid.", "error", index));
      return;
    }
    if ([c.open, c.high, c.low, c.close].some(v => v <= 0)) {
      errors.push(issue("KLINE_PRICE_NON_POSITIVE", "OHLC prices must be positive.", "error", index));
      return;
    }
    if (c.volume < 0 || (c.quoteVolume != null && c.quoteVolume < 0)) {
      errors.push(issue("KLINE_VOLUME_NEGATIVE", "Volume cannot be negative.", "error", index));
      return;
    }
    if (c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close, c.high)) {
      errors.push(issue("KLINE_OHLC_INCONSISTENT", "Candle high/low do not contain open and close.", "error", index));
      return;
    }
    const closed = c.closeTime < now;
    if (!closed && !allowForming) {
      warnings.push(issue("KLINE_FORMING_EXCLUDED", "Forming candle was excluded from confirmed analysis.", "warning", index));
      return;
    }
    normalized.push({ ...c, closed });
  });

  normalized.sort((a, b) => a.openTime - b.openTime);
  const deduped = [];
  for (const candle of normalized) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.openTime === candle.openTime) {
      errors.push(issue("KLINE_DUPLICATE_TIME", "Duplicate candle openTime detected.", "error"));
      continue;
    }
    if (previous && candle.openTime < previous.openTime) {
      errors.push(issue("KLINE_ORDER", "Candle timestamps must be strictly increasing.", "error"));
      continue;
    }
    deduped.push(candle);
  }

  if (intervalMs != null) {
    for (let i = 1; i < deduped.length; i++) {
      const delta = deduped[i].openTime - deduped[i - 1].openTime;
      if (delta !== intervalMs) {
        const item = issue("KLINE_GAP", `Expected ${intervalMs}ms between candles; received ${delta}ms.`, requireContiguous ? "error" : "warning", i);
        (requireContiguous ? errors : warnings).push(item);
      }
    }
  }

  if (deduped.length && maxStalenessMs != null) {
    if (!Number.isFinite(maxStalenessMs) || maxStalenessMs < 0) {
      errors.push(issue("STALENESS_LIMIT_INVALID", "maxStalenessMs must be a non-negative finite number."));
    } else {
      const age = now - deduped[deduped.length - 1].closeTime;
      if (age > maxStalenessMs) errors.push(issue("KLINE_STALE", `Latest closed candle is stale by ${age}ms.`));
    }
  }

  const status = errors.length ? "FAIL" : warnings.length ? "WARN" : "PASS";
  return { status, candles: deduped, errors, warnings };
}

export function toSeries(candles) {
  if (!Array.isArray(candles)) throw new TypeError("candles must be an array");
  return {
    t: candles.map(c => c.openTime),
    ct: candles.map(c => c.closeTime),
    o: candles.map(c => c.open),
    h: candles.map(c => c.high),
    l: candles.map(c => c.low),
    c: candles.map(c => c.close),
    v: candles.map(c => c.volume)
  };
}
