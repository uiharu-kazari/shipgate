import type { ExperimentPlan, ExperimentResult } from "../types.js";

/**
 * Time-warp probing: instead of waiting for TTLs/expiries in real time, the agent
 * replays the same request at virtual clock offsets using the `x-shipgate-clock-offset`
 * header (seconds). Apps under test honor it in non-production mode (see demo-app).
 * The agent compares response bodies and freshness markers across offsets.
 */
export async function runTimewarp(plan: NonNullable<ExperimentPlan["timewarp"]>, targetUrl: string): Promise<ExperimentResult[]> {
  const results: ExperimentResult[] = [];
  for (const probe of plan.probes) {
    const url = new URL(probe.path, targetUrl).toString();
    try {
      const samples: { offset: number; body: string; generatedAt?: string; cacheState?: string }[] = [];
      for (const offset of probe.offsetsSec) {
        const res = await fetch(url, {
          headers: { "x-shipgate-clock-offset": String(offset) },
          signal: AbortSignal.timeout(5000),
        });
        const text = await res.text();
        let generatedAt: string | undefined;
        let cacheState: string | undefined;
        try {
          const json = JSON.parse(text);
          generatedAt = json.generatedAt ?? json.generated_at;
          cacheState = json.cache ?? json.cacheState;
        } catch { /* non-JSON body, compare raw */ }
        samples.push({ offset, body: text.slice(0, 500), generatedAt, cacheState });
      }

      // Staleness check: any sample past the fresh window that still returns the
      // t=0 generation timestamp is serving stale data. Offsets inside the window
      // (a legitimate cache hit) are not stale.
      const base = samples[0];
      const freshWindow = probe.freshWindowSec ?? 0;
      const stale = samples.filter(
        (s) =>
          s.offset > freshWindow && s.generatedAt !== undefined && s.generatedAt === base.generatedAt && s.cacheState !== "miss"
      );
      const lastOffset = probe.offsetsSec[probe.offsetsSec.length - 1];
      const staleAtEnd = stale.some((s) => s.offset === lastOffset);

      results.push({
        kind: "timewarp",
        status: staleAtEnd ? "fail" : stale.length ? "warn" : "pass",
        title: `Time-warp ${probe.name}`,
        detail: staleAtEnd
          ? `Stale data still served ${lastOffset}s after generation (expectation: ${probe.expectation}). Offsets serving stale: ${stale.map((s) => s.offset + "s").join(", ")}`
          : stale.length
            ? `Same payload observed at offsets ${stale.map((s) => s.offset + "s").join(", ")} — verify TTL intent (${probe.expectation})`
            : `Freshness behaves as expected across offsets ${probe.offsetsSec.join("s, ")}s`,
        metrics: Object.fromEntries(samples.map((s) => [`offset_${s.offset}s`, `${s.cacheState ?? "?"} @ ${s.generatedAt ?? "?"}`])),
      });
    } catch (err) {
      results.push({
        kind: "timewarp",
        status: "error",
        title: `Time-warp ${probe.name}`,
        detail: `Probe against ${url} failed: ${(err as Error).message}`,
      });
    }
  }
  return results;
}
