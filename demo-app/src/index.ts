import { serve } from "@hono/node-server";
import { Hono } from "hono";

/**
 * Demo app under test: a tiny product-search API.
 * This version contains the "risky PR" changes that ShipGate should catch:
 *  1. A search cache with a 60s TTL that KEEPS serving stale entries after expiry
 *     (expiry check bug: `<` vs `>`), i.e. a time-warp failure.
 *  2. A heavier scoring loop that regresses latency under load.
 *  3. A new external-call failure path with NO logging/metrics (o11y gap).
 *
 * Virtual clock: when SHIPGATE_TESTING=1, the `x-shipgate-clock-offset` header
 * (seconds) shifts `now()` so the agent can probe TTL behavior without waiting.
 */

const app = new Hono();
const TESTING = process.env.SHIPGATE_TESTING === "1";

const PRODUCTS = Array.from({ length: 5000 }, (_, i) => ({
  id: i,
  name: `Product ${i} ${["alpha", "beta", "gamma", "delta"][i % 4]}`,
  price: (i * 7) % 500,
  tags: [`tag${i % 10}`, `cat${i % 25}`],
}));

interface CacheEntry { generatedAt: string; expiresAtMs: number; body: unknown }
const searchCache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

function now(c: { req: { header: (n: string) => string | undefined } }): number {
  const offset = TESTING ? Number(c.req.header("x-shipgate-clock-offset") ?? 0) : 0;
  return Date.now() + offset * 1000;
}

app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/api/search", (c) => {
  const q = c.req.query("q") ?? "alpha";
  const t = now(c);

  const cached = searchCache.get(q);
  // BUG (intentional, for the demo PR): expiry comparison inverted — entries are
  // treated as fresh forever once cached. ShipGate's time-warp probe catches this.
  if (cached && cached.expiresAtMs > 0) {
    return c.json({ cache: "hit", generatedAt: cached.generatedAt, results: cached.body });
  }

  // Heavier "relevance scoring" added in the risky PR — regresses p95 under load.
  const scored = PRODUCTS.map((p) => {
    let score = 0;
    for (let i = 0; i < 200; i++) score += (p.name.includes(q) ? 2 : 0.1) * Math.sqrt(i + p.price);
    return { ...p, score };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const entry: CacheEntry = { generatedAt: new Date(t).toISOString(), expiresAtMs: t + TTL_MS, body: scored };
  searchCache.set(q, entry);
  return c.json({ cache: "miss", generatedAt: entry.generatedAt, results: scored });
});

// New in the risky PR: price sync from an external supplier — failure path has
// no logging, no metric, no span. ShipGate's o11y lint flags this.
app.post("/api/sync-prices", async (c) => {
  try {
    const res = await fetch("https://supplier.invalid/prices", { signal: AbortSignal.timeout(1500) });
    const prices = await res.json();
    return c.json({ synced: true, count: (prices as unknown[]).length });
  } catch {
    return c.json({ synced: false }, 502);
  }
});

const port = Number(process.env.PORT ?? 8081);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`demo-app listening on :${info.port} (testing=${TESTING})`);
});
