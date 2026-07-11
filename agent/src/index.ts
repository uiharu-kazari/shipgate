import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { analyze } from "./run.js";
import { recentEvidence } from "./es.js";
import type { AnalyzeRequest } from "./types.js";

const app = new Hono();

// Note: /healthz is intercepted by Google's frontend on *.run.app — /api/health is the
// alias that works everywhere.
app.get("/api/health", async (c) => {
  const { geminiConfigured } = await import("./llm.js");
  return c.json({
    ok: true,
    gemini: geminiConfigured(),
    geminiTransport: config.gcpProject ? `vertex:${config.gcpProject}` : config.geminiApiKey ? "api-key" : "heuristic-fallback",
    elasticsearch: !!config.esUrl,
  });
});

app.get("/healthz", async (c) => {
  const { geminiConfigured } = await import("./llm.js");
  return c.json({
    ok: true,
    gemini: geminiConfigured(),
    geminiTransport: config.gcpProject ? `vertex:${config.gcpProject}` : config.geminiApiKey ? "api-key" : "heuristic-fallback",
    elasticsearch: !!config.esUrl,
  });
});

// Auth gate for the endpoints that run experiments / call Gemini. Locally (no
// SHIPGATE_TOKEN set) they stay open; in the cloud the token is required so the
// public service can't be used as a load-test reflector or Vertex cost drain.
app.use("/analyze", async (c, next) => {
  if (config.authToken && c.req.header("x-shipgate-token") !== config.authToken) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});
app.use("/propose-patch", async (c, next) => {
  if (config.authToken && c.req.header("x-shipgate-token") !== config.authToken) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

// Main entrypoint — called from CI (GitHub Action) or manually with a diff.
app.post("/analyze", async (c) => {
  let body: Partial<AnalyzeRequest>;
  try {
    body = (await c.req.json()) as Partial<AnalyzeRequest>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.diff || !body.targetUrl || !body.repo) {
    return c.json({ error: "diff, targetUrl and repo are required" }, 400);
  }
  if (config.allowedTargetHosts.length) {
    let host = "";
    try {
      host = new URL(body.targetUrl).host;
    } catch {
      return c.json({ error: "invalid targetUrl" }, 400);
    }
    // Entries may be an exact host or a "*.suffix" / "*-suffix" glob, so per-PR
    // preview services (shipgate-demo-pr-<n>-<proj>.<region>.run.app) can be allowed
    // without listing every ephemeral host, while still scoping to our project.
    const allowed = config.allowedTargetHosts.some((entry) =>
      entry.startsWith("*") ? host.endsWith(entry.slice(1)) : host === entry
    );
    if (!allowed) {
      return c.json({ error: `targetUrl host not allowlisted: ${host}` }, 403);
    }
  }
  const doc = await analyze(body as AnalyzeRequest);
  return c.json(doc);
});

// Agent proposes a fix for failed experiments: send it the source files and the
// experiment results, get back rewritten files + rationale.
app.post("/propose-patch", async (c) => {
  let body: {
    sourceFiles?: { path: string; content: string }[];
    results?: import("./types.js").ExperimentResult[];
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.results) return c.json({ error: "results are required" }, 400);
  const { proposePatch } = await import("./patch.js");
  const proposal = await proposePatch(body.sourceFiles ?? [], body.results);
  return c.json(proposal);
});

// Evidence feed for the dashboard.
app.get("/api/evidence", async (c) => {
  const docs = await recentEvidence(25);
  return c.json({ docs });
});

// Dashboard (static single page).
const dashboardHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public/index.html"), "utf8");
app.get("/", (c) => c.html(dashboardHtml));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`ShipGate agent listening on :${info.port}`);
});
