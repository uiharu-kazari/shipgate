import { test } from "node:test";
import assert from "node:assert/strict";

import { decideVerdict, heuristicPlan, sanitizePlan } from "../src/gemini.js";
import { runO11yLint } from "../src/experiments/o11y.js";
import type { ExperimentPlan, ExperimentResult } from "../src/types.js";

function result(overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    kind: "load",
    status: "pass",
    title: "fixture",
    detail: "fixture",
    ...overrides,
  };
}

test("decideVerdict computes the documented release-gate branches", () => {
  const cases: {
    name: string;
    results: ExperimentResult[];
    decision: ReturnType<typeof decideVerdict>["decision"];
  }[] = [
    {
      name: "clean ship",
      results: [result(), result({ kind: "observability" })],
      decision: "ship",
    },
    {
      name: "single warn",
      results: [result({ status: "warn" })],
      decision: "ship-with-warnings",
    },
    {
      name: "timewarp-fail block",
      results: [result({ kind: "timewarp", status: "fail" })],
      decision: "block",
    },
    {
      name: "error-storm block",
      results: [result({ kind: "load", status: "fail", metrics: { errorRatePct: 50 } })],
      decision: "block",
    },
    {
      name: "single perf fail without error storm",
      results: [result({ kind: "load", status: "fail", metrics: { errorRatePct: 49 } })],
      decision: "ship-with-warnings",
    },
    {
      name: "two-fail block",
      results: [result({ status: "fail" }), result({ kind: "observability", status: "fail" })],
      decision: "block",
    },
    {
      // Probes errored: we have NO evidence. Must fail closed, not pass as a warning.
      name: "all-error is inconclusive (fails closed)",
      results: [result({ status: "error" }), result({ kind: "timewarp", status: "error" })],
      decision: "inconclusive",
    },
    {
      // A single errored probe alongside passes still means incomplete evidence.
      name: "partial error is inconclusive",
      results: [result({ kind: "load", status: "pass" }), result({ kind: "timewarp", status: "error" })],
      decision: "inconclusive",
    },
    {
      // No experiment ran at all — cannot ship on zero evidence.
      name: "empty results is inconclusive",
      results: [],
      decision: "inconclusive",
    },
    {
      // Genuinely inert diff (docs/config): a single explicit "skipped" is safe to ship.
      name: "only skipped (inert diff)",
      results: [result({ status: "skipped" })],
      decision: "ship",
    },
  ];

  for (const { name, results, decision } of cases) {
    assert.deepEqual(decideVerdict(results), { decision, confidence: 1 }, name);
  }
});

test("runO11yLint fails when comment-only metric/span words hide uninstrumented catch/fetch", () => {
  const diff = `diff --git a/src/api.ts b/src/api.ts
index 1111111..2222222 100644
--- a/src/api.ts
+++ b/src/api.ts
@@ -0,0 +1,10 @@
+export async function handler() {
+  // metric span trace logger console.error are mentioned only in comments
+  try {
+    return await fetch("https://upstream.example.test/users");
+  } catch (error) {
+    // TODO: add metric and span later
+    return null;
+  }
+}
`;

  const lint = runO11yLint(diff);

  assert.equal(lint.status, "fail");
  assert.ok((lint.findings?.length ?? 0) > 0);
});

test("runO11yLint passes when added risky code has real console/logger instrumentation", () => {
  const diff = `diff --git a/src/api.ts b/src/api.ts
index 1111111..2222222 100644
--- a/src/api.ts
+++ b/src/api.ts
@@ -0,0 +1,11 @@
+export async function handler(logger: { error: (...args: unknown[]) => void }) {
+  try {
+    return await fetch("https://upstream.example.test/users");
+  } catch (error) {
+    console.error("upstream fetch failed", { error });
+    logger.error("upstream fetch failed", { error });
+    throw error;
+  }
+}
`;

  const lint = runO11yLint(diff);

  assert.equal(lint.status, "pass");
  assert.equal(lint.findings?.length ?? 0, 0);
});

test("heuristicPlan extracts .get routes and enables timewarp for TTL diffs", () => {
  const diff = `diff --git a/src/server.ts b/src/server.ts
index 1111111..2222222 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -1,3 +1,7 @@
+const CACHE_TTL_MS = 60_000;
+app.get("/api/widgets", async (_req, res) => {
+  res.json(await readWidgets());
+});
+router.get('/health', (_req, res) => res.status(200).send("ok"));
`;

  const plan = heuristicPlan(diff);

  assert.deepEqual(plan.load?.routes, [
    { method: "GET", path: "/api/widgets" },
    { method: "GET", path: "/health" },
  ]);
  assert.ok(plan.timewarp);
  assert.equal(plan.timewarp.probes[0]?.freshWindowSec, 60);
});

// --- Regression tests for the bypasses Codex Sol reproduced ---------------------

// A diff that declares a risky route + a TTL, so the heuristic floor finds work to do.
const RISKY_DIFF = `
+app.get("/danger", (c) => {
+  const TTL_MS = 100_000;
+  const cached = cache.get(k);
+  if (cached) return c.json(cached);
+  try { await fetch("https://x.invalid"); } catch { return c.json({ok:false}); }
+});
`;

test("sanitizePlan: a hostile method cannot empty the plan into an inert 'skip'", () => {
  // Codex's defeat: model returns an unusable method (OPTIONS). The method filter
  // dropped every route, the run produced zero results, run.ts marked it "inert"
  // and it SHIPPED. The floor must survive.
  const hostile = { summary: "x", risks: [], load: { reason: "x", routes: [{ method: "OPTIONS", path: "/danger" }], durationSec: 10, connections: 10, p95BudgetMs: 300 } } as unknown as ExperimentPlan;
  const out = sanitizePlan(hostile, RISKY_DIFF);
  assert.ok(out.load, "load experiment must survive a hostile method");
  assert.ok(out.load!.routes.length > 0, "routes must not be emptied by the method filter");
});

test("sanitizePlan: the model cannot invent endpoints that aren't in the diff", () => {
  const hostile = { summary: "x", risks: [], load: { reason: "x", routes: [{ method: "GET", path: "/not-in-the-diff" }], durationSec: 10, connections: 10, p95BudgetMs: 300 } } as unknown as ExperimentPlan;
  const out = sanitizePlan(hostile, RISKY_DIFF);
  assert.ok(!out.load!.routes.some((r) => r.path === "/not-in-the-diff"), "invented path must be rejected");
});

test("sanitizePlan: capping offsets never deletes the post-expiry probe", () => {
  // Codex's false-pass bug: offsets were sliced to MAX before the post-window sample
  // was appended, and the runner re-sliced it away — so stale-after-expiry became
  // unobservable. The largest offset must always survive.
  const hostile = {
    summary: "x", risks: [],
    timewarp: { reason: "x", probes: [{ name: "p", path: "/danger", offsetsSec: [1,2,3,4,5,6,7,8,9,10], freshWindowSec: 100, expectation: "no stale" }] },
  } as unknown as ExperimentPlan;
  const out = sanitizePlan(hostile, RISKY_DIFF);
  const offs = out.timewarp!.probes[0].offsetsSec;
  assert.ok(offs.length <= 8, "offsets are capped");
  assert.ok(offs.some((o) => o > 100), `must retain a post-expiry offset, got ${offs.join(",")}`);
});

test("sanitizePlan: the model cannot shrink the heuristic floor's routes", () => {
  const narrow = { summary: "x", risks: [], load: { reason: "x", routes: [], durationSec: 10, connections: 10, p95BudgetMs: 300 } } as unknown as ExperimentPlan;
  const out = sanitizePlan(narrow, RISKY_DIFF);
  assert.ok(out.load!.routes.some((r) => r.path === "/danger"), "floor route must be preserved");
});
