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

app.get("/healthz", (c) => c.json({ ok: true, gemini: !!config.geminiApiKey, elasticsearch: !!config.esUrl }));

// Main entrypoint — called from CI (GitHub Action) or manually with a diff.
app.post("/analyze", async (c) => {
  const body = (await c.req.json()) as Partial<AnalyzeRequest>;
  if (!body.diff || !body.targetUrl || !body.repo) {
    return c.json({ error: "diff, targetUrl and repo are required" }, 400);
  }
  const doc = await analyze(body as AnalyzeRequest);
  return c.json(doc);
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
