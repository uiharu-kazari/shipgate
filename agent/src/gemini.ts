import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import type { ExperimentPlan, ExperimentResult, Verdict } from "./types.js";

const ai = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

// True when the last call fell back to heuristics (no/blocked API key).
export let lastCallMocked = false;

const PLAN_PROMPT = `You are ShipGate, a release-gate agent for TypeScript web apps.
Given a unified diff, predict what could go wrong IN PRODUCTION (not unit-test bugs) and design targeted experiments.

Return STRICT JSON matching this TypeScript type (no markdown fences):
{
  "summary": string,            // one paragraph: what this change does operationally
  "risks": string[],            // concrete production risks caused by THIS diff
  "load": {                     // include ONLY if the diff touches request handling / queries / caching
    "reason": string,
    "routes": [{"method": "GET", "path": "/api/..."}],   // routes affected by the diff
    "durationSec": 10, "connections": 25, "p95BudgetMs": 300
  },
  "timewarp": {                 // include ONLY if the diff has time-dependent behavior (TTL, expiry, retry backoff, cron)
    "reason": string,
    "probes": [{"name": string, "path": "/api/...", "offsetsSec": [0, 61, 3601], "expectation": string}]
  },
  "observability": { "reason": string }   // include if new failure paths / external calls appear
}
Only include experiment sections that the diff actually justifies. Paths must come from the diff.`;

const VERDICT_PROMPT = `You are ShipGate, a release-gate agent. Given the experiment plan and the measured results, decide the release verdict.
Return STRICT JSON (no markdown fences):
{
  "decision": "ship" | "ship-with-warnings" | "block",
  "confidence": number,          // 0..1
  "reasons": string[],           // cite concrete numbers from the results
  "advice": string[]             // specific fixes, each actionable in <1 day
}
Rules: fail(load p95 over budget, stale-after-expiry, unobservable new failure path) => at least ship-with-warnings; multiple fails or a correctness fail => block.`;

async function callJson<T>(system: string, user: string): Promise<T | null> {
  if (!ai) return null;
  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: user,
      config: { systemInstruction: system, responseMimeType: "application/json", temperature: 0.2 },
    });
    const text = res.text ?? "";
    return JSON.parse(text) as T;
  } catch (err) {
    console.error("[gemini] call failed, falling back to heuristics:", (err as Error).message);
    return null;
  }
}

export async function planExperiments(diff: string): Promise<ExperimentPlan> {
  const fromModel = await callJson<ExperimentPlan>(PLAN_PROMPT, `DIFF:\n${diff.slice(0, 60_000)}`);
  if (fromModel) {
    lastCallMocked = false;
    return fromModel;
  }
  lastCallMocked = true;
  return heuristicPlan(diff);
}

export async function issueVerdict(plan: ExperimentPlan, results: ExperimentResult[]): Promise<Verdict> {
  const fromModel = await callJson<Verdict>(
    VERDICT_PROMPT,
    `PLAN:\n${JSON.stringify(plan)}\n\nRESULTS:\n${JSON.stringify(results)}`
  );
  if (fromModel) return fromModel;
  lastCallMocked = true;
  return heuristicVerdict(results);
}

// ---------- Heuristic fallbacks (used when GEMINI_API_KEY is missing/blocked) ----------

function extractRoutes(diff: string): { method: string; path: string }[] {
  const routes = new Map<string, { method: string; path: string }>();
  const routeRe = /\.(get|post|put|delete|patch)\(\s*["'`](\/[^"'`]*)["'`]/gi;
  for (const m of diff.matchAll(routeRe)) {
    const method = m[1].toUpperCase();
    routes.set(`${method} ${m[2]}`, { method, path: m[2] });
  }
  return [...routes.values()];
}

export function heuristicPlan(diff: string): ExperimentPlan {
  const routes = extractRoutes(diff);
  const timey = /(ttl|expire|expiry|setTimeout|setInterval|backoff|Date\.now|cron)/i.test(diff);
  const failurePath = /(throw|catch|reject|status\(5|fetch\(|axios)/i.test(diff);
  const plan: ExperimentPlan = {
    summary:
      "Heuristic plan (Gemini unavailable): the diff touches " +
      (routes.length ? routes.map((r) => `${r.method} ${r.path}`).join(", ") : "no detected routes") +
      (timey ? "; time-dependent logic detected" : "") +
      (failurePath ? "; new failure paths detected" : "") + ".",
    risks: [
      ...(routes.length ? ["Changed request handlers may regress latency under load"] : []),
      ...(timey ? ["Time-dependent behavior (TTL/expiry/backoff) may misbehave after expiry boundaries"] : []),
      ...(failurePath ? ["New failure paths may be invisible to on-call (no metrics/logs)"] : []),
    ],
  };
  if (routes.length) {
    plan.load = { reason: "Diff changes request handling", routes, durationSec: 10, connections: 25, p95BudgetMs: 300 };
  }
  if (timey && routes.length) {
    plan.timewarp = {
      reason: "Diff contains TTL/expiry logic",
      probes: routes.slice(0, 2).map((r) => ({
        name: `expiry-behavior ${r.path}`,
        path: r.path,
        offsetsSec: [0, 5, 61, 3601],
        expectation: "Responses after the expiry boundary must not serve stale data",
      })),
    };
  }
  if (failurePath) plan.observability = { reason: "New failure paths detected in diff" };
  return plan;
}

export function heuristicVerdict(results: ExperimentResult[]): Verdict {
  const fails = results.filter((r) => r.status === "fail");
  const warns = results.filter((r) => r.status === "warn");
  const decision = fails.length >= 2 ? "block" : fails.length === 1 ? "ship-with-warnings" : warns.length ? "ship-with-warnings" : "ship";
  return {
    decision,
    confidence: 0.5,
    reasons: results.map((r) => `[${r.status}] ${r.title}: ${r.detail}`),
    advice: fails.concat(warns).map((r) => `Address: ${r.title}`),
  };
}
