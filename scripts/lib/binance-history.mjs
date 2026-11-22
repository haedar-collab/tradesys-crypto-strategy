/** Paginated public Binance Spot klines (data-api.binance.vision; no keys). */
export const BASE = "https://data-api.binance.vision";
export const STEP = { "1w": 604_800_000, "1d": 86_400_000, "4h": 14_400_000, "1h": 3_600_000 };

export async function fetchKlines(symbol, interval, startTime, endTime) {
  const rows = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const url = new URL(BASE + "/api/v3/klines");
    url.search = new URLSearchParams({ symbol, interval, startTime: String(cursor), endTime: String(endTime - 1), limit: "1000" });
    let response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (response.ok) break;
        if (attempt >= 4 || ![418, 429, 500, 502, 503, 504].includes(response.status)) throw new Error("HTTP " + response.status);
      } catch (error) { if (attempt >= 4) throw error; }
      await new Promise(r => setTimeout(r, 1_000 * 2 ** attempt));
    }
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      const candle = { openTime: +r[0], closeTime: +r[6], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] };
      if (candle.closeTime < endTime && (!rows.length || candle.openTime > rows.at(-1).openTime)) rows.push(candle);
    }
    const next = +batch.at(-1)[0] + STEP[interval];
    if (next <= cursor) throw new Error("pagination did not advance");
    cursor = next;
    if (batch.length < 1000) break;
  }
  return rows;
}
