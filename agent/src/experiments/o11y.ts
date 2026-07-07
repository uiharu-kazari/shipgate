import type { ExperimentResult, O11yFinding } from "../types.js";

/**
 * Observability-readiness lint over the diff: for every ADDED line that creates a
 * failure path or external call, check whether the surrounding added code carries
 * any observability signal (structured log, metric, span). Pure-diff heuristic v1;
 * Gemini refines findings in the verdict step.
 */
export function runO11yLint(diff: string): ExperimentResult {
  const findings: O11yFinding[] = [];
  const files = diff.split(/^diff --git /m).filter(Boolean);

  for (const fileChunk of files) {
    const fileMatch = fileChunk.match(/[ab]\/([^\s]+)/);
    const file = fileMatch?.[1] ?? "unknown";
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) continue;

    const added = fileChunk
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      // Comments must not count as observability signals ("adds no metric" in a
      // code comment would otherwise satisfy the metric regex). Match JS/TS comment
      // forms only (// line, /* block, and * JSDoc continuation) — not "#", which is
      // not a TS comment and would wrongly strip real code.
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l));
    const addedText = added.join("\n");
    const hasSignal = /(logger\.|console\.(error|warn)|metrics?\.|counter|histogram|span|trace|otel|prometheus)/i.test(addedText);

    const risky: { re: RegExp; issue: string; suggestion: string; severity: O11yFinding["severity"] }[] = [
      {
        re: /catch\s*(\(|\{)/,
        issue: "New catch block added",
        suggestion: "Log a structured error with an error code, or increment a failure counter inside the catch",
        severity: "high",
      },
      {
        re: /\b(fetch|axios|got)\s*(\.|\()/,
        issue: "New external call added",
        suggestion: "Wrap the call in a span (or record duration + failure metric) so on-call can see upstream latency/errors",
        severity: "warn",
      },
      {
        re: /status\((5\d\d)\)|throw new /,
        issue: "New failure response / throw added",
        suggestion: "Emit a structured log with request context before returning the failure",
        severity: "warn",
      },
      {
        re: /(ttl|expire|cache)/i,
        issue: "Cache/TTL behavior added",
        suggestion: "Expose a cache hit/miss/stale metric so cache regressions are visible in production",
        severity: "info",
      },
    ];

    for (const rule of risky) {
      if (rule.re.test(addedText) && !hasSignal) {
        findings.push({ file, issue: rule.issue, severity: rule.severity, suggestion: rule.suggestion });
      }
    }
  }

  const high = findings.filter((f) => f.severity === "high").length;
  return {
    kind: "observability",
    status: high ? "fail" : findings.length ? "warn" : "pass",
    title: "Observability readiness",
    detail: findings.length
      ? `${findings.length} unobservable code path(s) added — on-call cannot debug these if they fail in production`
      : "All new failure paths carry observability signals",
    findings,
  };
}
