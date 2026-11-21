const DEFAULT_BASE_URL = "wss://stream.binance.com:9443/ws";
const SYMBOL_PATTERN = /^[A-Z0-9]{5,20}$/;

function assertOptions({ symbol, WebSocketCtor, now, reconnectBaseMs, reconnectMaxMs, staleAfterMs }) {
  if (typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol)) throw new TypeError("symbol must be an uppercase Binance Spot symbol");
  if (typeof WebSocketCtor !== "function") throw new TypeError("WebSocketCtor is required");
  if (typeof now !== "function") throw new TypeError("now must be a function");
  for (const [name, value] of Object.entries({ reconnectBaseMs, reconnectMaxMs, staleAfterMs })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(name + " must be a positive integer");
  }
  if (reconnectMaxMs < reconnectBaseMs) throw new RangeError("reconnectMaxMs must be >= reconnectBaseMs");
}

function attach(socket, event, handler) {
  if (typeof socket.addEventListener === "function") socket.addEventListener(event, handler);
  else if (typeof socket.on === "function") socket.on(event, handler);
  else socket["on" + event] = handler;
}

function messageData(event) {
  if (event && typeof event === "object" && "data" in event) return event.data;
  return event;
}

/**
 * Single-symbol Binance Spot bookTicker feed.
 * The adapter owns provenance metadata; consumers must not construct it themselves.
 * bookTicker stream messages do not provide an event timestamp, so eventTime is
 * explicitly set to local receive time (receivedAt), not represented as exchange time.
 */
export function createBinanceSpotBookTickerFeed({
  symbol,
  WebSocketCtor = globalThis.WebSocket,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  reconnectBaseMs = 500,
  reconnectMaxMs = 30_000,
  staleAfterMs = 5_000,
  baseUrl = DEFAULT_BASE_URL,
  onQuote = () => {},
  onState = () => {},
  onError = () => {}
} = {}) {
  assertOptions({ symbol, WebSocketCtor, now, reconnectBaseMs, reconnectMaxMs, staleAfterMs });
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") throw new TypeError("timer functions are required");
  if (![onQuote, onState, onError].every(fn => typeof fn === "function")) throw new TypeError("callbacks must be functions");
  if (typeof baseUrl !== "string" || !/^wss:\/\//.test(baseUrl)) throw new TypeError("baseUrl must be a secure WebSocket URL");

  const stream = symbol.toLowerCase() + "@bookTicker";
  const url = baseUrl.replace(/\/$/, "") + "/" + stream;
  let state = "STOPPED";
  let socket = null;
  let reconnectTimer = null;
  let staleTimer = null;
  let generation = 0;
  let attempts = 0;
  let stopped = true;
  let lastQuote = null;

  function publish(next, details = {}) {
    state = next;
    onState({ state, symbol, stream, ...details });
  }
  function clearTimers() {
    if (reconnectTimer !== null) clearTimeoutFn(reconnectTimer);
    if (staleTimer !== null) clearTimeoutFn(staleTimer);
    reconnectTimer = null;
    staleTimer = null;
  }
  function scheduleStaleCheck(token) {
    if (staleTimer !== null) clearTimeoutFn(staleTimer);
    staleTimer = setTimeoutFn(() => {
      staleTimer = null;
      if (stopped || token !== generation || !socket) return;
      const age = lastQuote ? now() - lastQuote.receivedAt : Infinity;
      if (age >= staleAfterMs) {
        publish("STALE", { ageMs: age });
        try { socket.close(4000, "bookTicker feed stale"); } catch (error) { onError(error); }
      } else {
        scheduleStaleCheck(token);
      }
    }, staleAfterMs);
  }
  function scheduleReconnect() {
    if (stopped || reconnectTimer !== null) return;
    const delay = Math.min(reconnectBaseMs * (2 ** Math.min(attempts, 30)), reconnectMaxMs);
    attempts += 1;
    publish("RECONNECT_WAIT", { delayMs: delay, attempt: attempts });
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }
  function connect() {
    if (stopped) return;
    clearTimers();
    const token = ++generation;
    publish("CONNECTING", { attempt: attempts + 1 });
    let ws;
    try {
      ws = new WebSocketCtor(url);
      socket = ws;
    } catch (error) {
      socket = null;
      onError(error);
      scheduleReconnect();
      return;
    }
    attach(ws, "open", () => {
      if (stopped || token !== generation || socket !== ws) return;
      attempts = 0;
      publish("CONNECTED");
      scheduleStaleCheck(token);
    });
    attach(ws, "message", event => {
      if (stopped || token !== generation || socket !== ws) return;
      try {
        const raw = messageData(event);
        const text = typeof raw === "string" ? raw : raw?.toString?.();
        const parsed = JSON.parse(text);
        if (!parsed || parsed.s !== symbol || !Number.isSafeInteger(parsed.u) ||
            !Number.isFinite(Number(parsed.b)) || !Number.isFinite(Number(parsed.a)) ||
            Number(parsed.b) <= 0 || Number(parsed.a) < Number(parsed.b)) {
          throw new TypeError("invalid or mismatched Binance bookTicker payload");
        }
        const receivedAt = now();
        if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) throw new TypeError("receive clock must return a non-negative integer");
        const eventTime = Number.isSafeInteger(parsed.E) && parsed.E >= 0 ? parsed.E : receivedAt;
        const quote = {
          exchange: "BINANCE",
          source: "BINANCE_SPOT_WS_BOOK_TICKER",
          transport: "WSS",
          feedStatus: "CONNECTED",
          symbol,
          stream,
          eventTime,
          receivedAt,
          bid: Number(parsed.b),
          ask: Number(parsed.a),
          updateId: parsed.u,
          eventTimeBasis: Number.isSafeInteger(parsed.E) ? "EXCHANGE_EVENT_TIME" : "LOCAL_RECEIVE_TIME"
        };
        lastQuote = quote;
        onQuote(quote);
        scheduleStaleCheck(token);
      } catch (error) {
        onError(error);
      }
    });
    attach(ws, "error", event => {
      if (!stopped && token === generation && socket === ws) onError(event instanceof Error ? event : new Error("Binance WebSocket error"));
    });
    attach(ws, "close", event => {
      if (stopped || token !== generation || socket !== ws) return;
      socket = null;
      if (staleTimer !== null) clearTimeoutFn(staleTimer);
      staleTimer = null;
      publish("DISCONNECTED", { code: event?.code, reason: event?.reason });
      scheduleReconnect();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      connect();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      generation += 1;
      clearTimers();
      const current = socket;
      socket = null;
      publish("STOPPED");
      if (current) {
        try { current.close(1000, "feed stopped"); } catch (error) { onError(error); }
      }
    },
    checkHealth() {
      if (stopped) return { state, healthy: false, reason: "STOPPED" };
      if (state !== "CONNECTED") return { state, healthy: false, reason: "FEED_NOT_CONNECTED" };
      const ageMs = lastQuote ? now() - lastQuote.receivedAt : null;
      const healthy = ageMs !== null && ageMs < staleAfterMs;
      return { state, healthy, ageMs, reason: healthy ? null : "NO_RECENT_QUOTE" };
    },
    getState() { return state; },
    getLastQuote() { return lastQuote ? { ...lastQuote } : null; },
    getUrl() { return url; }
  };
}
