import { planExperiments, issueVerdict, lastCallMocked } from "./gemini.js";
import { runLoad } from "./experiments/load.js";
import { runTimewarp } from "./experiments/timewarp.js";
import { runO11yLint } from "./experiments/o11y.js";
import { indexEvidence } from "./es.js";
import { config } from "./config.js";
import type { AnalyzeRequest, EvidenceDoc, ExperimentResult } from "./types.js";

export async function analyze(req: AnalyzeRequest): Promise<EvidenceDoc> {
  const t0 = Date.now();

  // 1. Agent plans experiments from the diff
  const plan = await planExperiments(req.diff);
  const planMs = Date.now() - t0;
  const mocked = lastCallMocked;

  // 2. Agent executes its own plan
  const results: ExperimentResult[] = [];
  if (plan.observability) results.push(runO11yLint(req.diff));
  if (plan.load) results.push(...(await runLoad(plan.load, req.targetUrl)));
  if (plan.timewarp) results.push(...(await runTimewarp(plan.timewarp, req.targetUrl)));
  if (!results.length) {
    results.push({
      kind: "observability",
      status: "skipped",
      title: "No experiments warranted",
      detail: "The agent judged this diff operationally inert (docs/tests/config only).",
    });
  }

  // 3. Agent issues the release verdict
  const verdict = await issueVerdict(plan, results);

  const doc: EvidenceDoc = {
    "@timestamp": new Date().toISOString(),
    repo: req.repo,
    prNumber: req.prNumber,
    sha: req.sha,
    plan,
    results,
    verdict,
    agent: { model: config.geminiModel, planMs, totalMs: Date.now() - t0, mocked },
  };

  // 4. Evidence goes to Elasticsearch (dashboard + history)
  try {
    await indexEvidence(doc);
  } catch (err) {
    console.error("[es] indexing failed:", (err as Error).message);
  }

  return doc;
}
