export interface AnalyzeRequest {
  repo: string; // owner/name
  prNumber?: number;
  sha?: string;
  diff: string; // unified diff of the change
  targetUrl: string; // base URL of the deployed preview / demo app under test
}

export interface ExperimentPlan {
  summary: string; // agent's read of what the diff changes operationally
  risks: string[]; // predicted production risks
  load?: {
    reason: string;
    routes: { method: string; path: string }[];
    durationSec: number;
    connections: number;
    p95BudgetMs: number;
  };
  timewarp?: {
    reason: string;
    probes: {
      name: string;
      path: string;
      offsetsSec: number[]; // virtual clock offsets to probe at
      freshWindowSec?: number; // offsets within this window may legitimately serve cached data
      expectation: string;
    }[];
  };
  observability?: {
    reason: string;
  };
}

export interface ExperimentResult {
  kind: "load" | "timewarp" | "observability";
  status: "pass" | "warn" | "fail" | "skipped" | "error";
  title: string;
  detail: string;
  metrics?: Record<string, number | string>;
  findings?: O11yFinding[];
}

export interface O11yFinding {
  file: string;
  issue: string;
  severity: "info" | "warn" | "high";
  suggestion: string;
}

export interface Verdict {
  // "inconclusive" = the experiments could not produce evidence (probe errored /
  // target unreachable). It is NOT a pass: the gate fails closed, because the whole
  // premise is that you may not ship without evidence.
  decision: "ship" | "ship-with-warnings" | "block" | "inconclusive";
  confidence: number; // 0-1
  reasons: string[];
  advice: string[];
}

export interface EvidenceDoc {
  "@timestamp": string;
  repo: string;
  prNumber?: number;
  sha?: string;
  plan: ExperimentPlan;
  results: ExperimentResult[];
  verdict: Verdict;
  agent: { model: string; planMs: number; totalMs: number; mocked: boolean };
}
