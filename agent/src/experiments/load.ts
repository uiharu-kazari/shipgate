import autocannon from "autocannon";
import type { ExperimentPlan, ExperimentResult } from "../types.js";

export async function runLoad(plan: NonNullable<ExperimentPlan["load"]>, targetUrl: string): Promise<ExperimentResult[]> {
  const results: ExperimentResult[] = [];
  const targetHost = new URL(targetUrl).host;
  for (const route of plan.routes) {
    // Guard: a model-planned absolute path (e.g. "https://evil/x") would otherwise
    // resolve to another host. Only probe paths that stay on the target host.
    let url: string;
    try {
      const resolved = new URL(route.path, targetUrl);
      if (resolved.host !== targetHost) throw new Error(`path escapes target host: ${route.path}`);
      url = resolved.toString();
    } catch (err) {
      results.push({ kind: "load", status: "error", title: `Load ${route.method} ${route.path}`, detail: `skipped: ${(err as Error).message}` });
      continue;
    }
    try {
      const r = await autocannon({
        url,
        method: route.method as any,
        duration: plan.durationSec,
        connections: plan.connections,
      });
      const p95 = r.latency.p97_5 ?? r.latency.p99; // autocannon exposes p97_5; closest to p95 budget
      const errorRate = r.requests.total ? (r.errors + r.non2xx) / r.requests.total : 1;
      const overBudget = r.latency.p99 > plan.p95BudgetMs * 2 || p95 > plan.p95BudgetMs;
      const status = errorRate > 0.05 ? "fail" : overBudget ? "fail" : r.latency.average > plan.p95BudgetMs / 2 ? "warn" : "pass";
      results.push({
        kind: "load",
        status,
        title: `Load ${route.method} ${route.path} (${plan.connections} conns, ${plan.durationSec}s)`,
        detail: `avg ${r.latency.average}ms, p97.5 ${p95}ms, p99 ${r.latency.p99}ms vs budget p95≤${plan.p95BudgetMs}ms; ${r.requests.total} reqs, ${(errorRate * 100).toFixed(1)}% errors`,
        metrics: {
          avgMs: r.latency.average,
          p975Ms: p95,
          p99Ms: r.latency.p99,
          rps: r.requests.average,
          totalRequests: r.requests.total,
          errorRatePct: +(errorRate * 100).toFixed(2),
          budgetP95Ms: plan.p95BudgetMs,
        },
      });
    } catch (err) {
      results.push({
        kind: "load",
        status: "error",
        title: `Load ${route.method} ${route.path}`,
        detail: `Could not run load test against ${url}: ${(err as Error).message}`,
      });
    }
  }
  return results;
}
