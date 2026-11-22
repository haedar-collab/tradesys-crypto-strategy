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

const IP_LIKE = /^[0-9A-Fa-f:.]{2,45}$/;
const single = value => Array.isArray(value) ? value[0] : value;

/**
 * Resolve the client address used for rate limiting, and where it came from.
 *
 * Without trustProxy the socket address is used. Behind a trusted edge, in
 * order of preference:
 *  1. CF-Connecting-IP: Render is fronted by Cloudflare, which sets this to the
 *     connecting client and overwrites any client-supplied value.
 *  2. True-Client-IP: same semantics on edges that use it.
 *  3. The LAST X-Forwarded-For entry: the address the nearest trusted proxy
 *     appended. On a multi-hop edge (Cloudflare -> Render) this may be an edge
 *     node that changes per request, which is why 1-2 take precedence.
 * Leftmost X-Forwarded-For entries are client-controlled and never trusted.
 */
export function resolveClientAddress(request, { trustProxy = false } = {}) {
  const socketAddress = request.socket?.remoteAddress ?? "unknown";
  if (!trustProxy) return { key: socketAddress, source: "socket" };
  const headers = request.headers ?? {};
  for (const name of ["cf-connecting-ip", "true-client-ip"]) {
    const value = single(headers[name])?.trim();
    if (value && IP_LIKE.test(value)) return { key: value, source: name };
  }
  const header = headers["x-forwarded-for"];
  const value = Array.isArray(header) ? header.join(",") : header;
  const last = typeof value === "string"
    ? value.split(",").map(part => part.trim()).filter(Boolean).at(-1) : undefined;
  if (last && IP_LIKE.test(last)) return { key: last, source: "x-forwarded-for-last" };
  return { key: socketAddress, source: "socket" };
}

/** Client key for rate limiting (see resolveClientAddress). */
export function clientKey(request, options = {}) {
  return resolveClientAddress(request, options).key;
}
