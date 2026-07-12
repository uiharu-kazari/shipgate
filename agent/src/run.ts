import { planExperiments, sanitizePlan, issueVerdict, lastCallMocked } from "./gemini.js";
import { runLoad } from "./experiments/load.js";
import { runTimewarp } from "./experiments/timewarp.js";
import { runO11yLint } from "./experiments/o11y.js";
import { indexEvidence } from "./es.js";
import { config } from "./config.js";
import type { AnalyzeRequest, EvidenceDoc, ExperimentResult } from "./types.js";

export async function analyze(req: AnalyzeRequest): Promise<EvidenceDoc> {
  const t0 = Date.now();

  // 1. Agent plans experiments from the diff, then a deterministic floor+clamp
  // guarantees the risky-diff experiments run and thresholds stay honest.
  const plan = sanitizePlan(await planExperiments(req.diff), req.diff);
  const planMs = Date.now() - t0;
  const mocked = lastCallMocked;

  // 2. Agent executes its own plan.
  // A plan that schedules NOTHING means the diff is operationally inert (docs/config)
  // — that legitimately ships. But a plan that DID schedule experiments and yet
  // produced no results is missing evidence, and must NOT be laundered into an
  // "inert" skip (which would ship). Track the two cases apart.
  const scheduled = Boolean(plan.observability || plan.load?.routes?.length || plan.timewarp?.probes?.length);
  const results: ExperimentResult[] = [];
  if (plan.observability) results.push(runO11yLint(req.diff));
  if (plan.load?.routes?.length) results.push(...(await runLoad(plan.load, req.targetUrl)));
  if (plan.timewarp?.probes?.length) results.push(...(await runTimewarp(plan.timewarp, req.targetUrl)));

  if (!results.length) {
    results.push(
      scheduled
        ? {
            // Experiments were planned but none produced a result → no evidence.
            // decideVerdict turns this into "inconclusive", which fails the gate.
            kind: "observability",
            status: "error",
            title: "Experiments produced no evidence",
            detail: "The agent scheduled experiments for this diff but none executed, so there is no evidence to judge.",
          }
        : {
            kind: "observability",
            status: "skipped",
            title: "No experiments warranted",
            detail: "The agent judged this diff operationally inert (docs/tests/config only).",
          }
    );
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
