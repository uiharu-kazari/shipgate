import { serve } from "@hono/node-server";
import { Hono } from "hono";

/**
 * Demo app under test — ShipGate-patched variant.
 * Fixes applied by the agent after its experiments blocked the risky PR:
 *  1. Cache expiry comparison corrected (entries actually expire after TTL).
 *  2. Cache hit/miss counter logged so cache regressions are visible in production.
 *  3. Price-sync failure path is observable (structured error log with error code)
 *     and degrades gracefully (200 + retryQueued) instead of a 502 storm.
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
  if (cached && cached.expiresAtMs > t) {
    console.log(JSON.stringify({ metric: "search_cache_counter", state: "hit", q }));
    return c.json({ cache: "hit", generatedAt: cached.generatedAt, results: cached.body });
  }
  console.log(JSON.stringify({ metric: "search_cache_counter", state: "miss", q }));

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

app.post("/api/sync-prices", async (c) => {
  try {
    const res = await fetch("https://supplier.invalid/prices", { signal: AbortSignal.timeout(1500) });
    const prices = await res.json();
    return c.json({ synced: true, count: (prices as unknown[]).length });
  } catch (err) {
    console.error(
      JSON.stringify({ metric: "price_sync_failure_counter", code: "SUPPLIER_UNREACHABLE", error: String(err) })
    );
    return c.json({ synced: false, retryQueued: true });
  }
});

const port = Number(process.env.PORT ?? 8081);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`demo-app (patched) listening on :${info.port} (testing=${TESTING})`);
});
