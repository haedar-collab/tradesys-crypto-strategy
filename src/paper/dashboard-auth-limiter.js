/**
 * Brute-force limiter for dashboard Basic authentication.
 *
 * - Only requests that PRESENT wrong credentials count as failures; a first
 *   visit without an Authorization header is just a 401 challenge.
 * - Per client: after maxFailuresPerClient failures inside windowMs the client
 *   is locked out for lockoutMs; its credentials are not even evaluated.
 *   A successful login clears that client's failures.
 * - Global ceiling: at most maxFailuresGlobal failed attempts per windowMs
 *   across all clients. This bounds guessing even if an attacker rotates
 *   IP addresses. While the ceiling is hit, requests without a still-valid
 *   cached success are rejected for the rest of the window.
 * - Memory is bounded: at most maxTrackedClients entries (oldest evicted).
 */
export function createDashboardAuthLimiter({
  maxFailuresPerClient = 10,
  maxFailuresGlobal = 100,
  windowMs = 15 * 60_000,
  lockoutMs = 15 * 60_000,
  maxTrackedClients = 10_000,
  now = () => Date.now()
} = {}) {
  for (const [name, value] of Object.entries({ maxFailuresPerClient, maxFailuresGlobal, windowMs, lockoutMs, maxTrackedClients })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(name + " must be a positive integer");
  }
  if (typeof now !== "function") throw new TypeError("now must be a function");
  const clients = new Map(); // key -> { failures: number[], lockedUntil }
  let globalFailures = [];

  const prune = (list, t) => list.filter(at => t - at < windowMs);

  function check(key) {
    const t = now();
    const entry = clients.get(key);
    if (entry && entry.lockedUntil > t) {
      return { allowed: false, reason: "CLIENT_LOCKED_OUT", retryAfterMs: entry.lockedUntil - t };
    }
    globalFailures = prune(globalFailures, t);
    if (globalFailures.length >= maxFailuresGlobal) {
      return { allowed: false, reason: "GLOBAL_FAILURE_CEILING", retryAfterMs: windowMs - (t - globalFailures[0]) };
    }
    return { allowed: true };
  }

  function recordFailure(key) {
    const t = now();
    globalFailures = prune(globalFailures, t);
    globalFailures.push(t);
    const entry = clients.get(key) ?? { failures: [], lockedUntil: 0 };
    clients.delete(key); // re-insert to keep Map order = recency for eviction
    entry.failures = prune(entry.failures, t);
    entry.failures.push(t);
    if (entry.failures.length >= maxFailuresPerClient) {
      entry.lockedUntil = t + lockoutMs;
      entry.failures = [];
    }
    clients.set(key, entry);
    while (clients.size > maxTrackedClients) clients.delete(clients.keys().next().value);
  }

  function recordSuccess(key) { clients.delete(key); }

  function status() {
    const t = now();
    return {
      trackedClients: clients.size,
      lockedClients: [...clients.values()].filter(e => e.lockedUntil > t).length,
      globalFailuresInWindow: prune(globalFailures, t).length
    };
  }
  return Object.freeze({ check, recordFailure, recordSuccess, status });
}

/**
 * Client key for rate limiting. Behind a trusted reverse proxy (Render) the
 * socket address is the proxy, so use the LAST X-Forwarded-For entry: that is
 * the address the trusted proxy itself appended. Earlier entries are
 * client-controlled and must never be trusted.
 */
export function clientKey(request, { trustProxy = false } = {}) {
  const socketAddress = request.socket?.remoteAddress ?? "unknown";
  if (!trustProxy) return socketAddress;
  const header = request.headers?.["x-forwarded-for"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (typeof value !== "string" || !value.trim()) return socketAddress;
  const last = value.split(",").map(part => part.trim()).filter(Boolean).at(-1);
  return last && last.length <= 64 ? last : socketAddress;
}
