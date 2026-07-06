import { readFileSync } from "node:fs";
import { generateJson, geminiConfigured } from "./llm.js";
import type { ExperimentResult } from "./types.js";

export interface PatchProposal {
  rationale: string;
  files: { path: string; content: string }[];
  mocked: boolean;
}

const PATCH_PROMPT = `You are ShipGate, a release-gate agent. Your experiments found problems in this change.
Rewrite the affected file(s) to fix ONLY the found problems — keep everything else byte-identical:
- fix incorrect time/TTL/expiry logic
- make new failure paths observable (structured log with an error code, or a counter metric)
- prefer graceful degradation (2xx + structured failure payload) over raw 5xx storms when the caller can retry

Return STRICT JSON (no markdown fences):
{ "rationale": string, "files": [{ "path": string, "content": string }] }
The content must be the COMPLETE new file, compilable TypeScript.`;

export async function proposePatch(
  sourceFiles: { path: string; content: string }[],
  results: ExperimentResult[]
): Promise<PatchProposal> {
  if (geminiConfigured()) {
    const parsed = await generateJson<{ rationale: string; files: { path: string; content: string }[] }>(
      PATCH_PROMPT,
      `FAILED EXPERIMENTS:\n${JSON.stringify(results.filter((r) => r.status !== "pass"))}\n\nSOURCE FILES:\n${JSON.stringify(sourceFiles)}`,
      0.1
    );
    if (parsed && Array.isArray(parsed.files) && parsed.files.length) {
      return { rationale: parsed.rationale, files: parsed.files, mocked: false };
    }
    console.error("[gemini] patch generation failed, using canned fallback");
  }
  // Canned fallback for the bundled demo: the pre-authored fixed variant of the demo app.
  const fixed = readFileSync(new URL("../../demo-app/src/index.fixed.ts", import.meta.url), "utf8");
  return {
    rationale:
      "Heuristic fallback patch: corrects the inverted cache-expiry comparison (expiresAtMs > t), adds a cache hit/miss counter log, and makes the price-sync failure path observable + gracefully degrading (structured error log with code SUPPLIER_UNREACHABLE, 200 + retryQueued instead of a 502 storm).",
    files: [{ path: "demo-app/src/index.ts", content: fixed }],
    mocked: true,
  };
}
