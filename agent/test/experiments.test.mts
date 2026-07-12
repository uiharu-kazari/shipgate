import { test } from "node:test";
import assert from "node:assert/strict";

import { decideVerdict, heuristicPlan } from "../src/gemini.js";
import { runO11yLint } from "../src/experiments/o11y.js";
import type { ExperimentResult } from "../src/types.js";

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
