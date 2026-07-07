import type { ExperimentPlan, ExperimentResult } from "../types.js";

/**
 * Time-warp probing: instead of waiting for TTLs/expiries in real time, the agent
 * replays the same request at virtual clock offsets using the `x-shipgate-clock-offset`
 * header (seconds). Apps under test honor it in non-production mode (see demo-app).
 * The agent compares response bodies and freshness markers across offsets.
 */
export async function runTimewarp(plan: NonNullable<ExperimentPlan["timewarp"]>, targetUrl: string): Promise<ExperimentResult[]> {
  const results: ExperimentResult[] = [];
  const targetHost = new URL(targetUrl).host;
  for (const probe of plan.probes) {
    // Same-host guard as the load runner: never let a planned absolute path escape.
    let url: string;
    try {
      const resolved = new URL(probe.path, targetUrl);
      if (resolved.host !== targetHost) throw new Error(`path escapes target host: ${probe.path}`);
      url = resolved.toString();
    } catch (err) {
      results.push({ kind: "timewarp", status: "error", title: `Time-warp ${probe.name}`, detail: `skipped: ${(err as Error).message}` });
      continue;
    }
    // Sort + de-dup offsets, cap at 8, and ensure offset 0 (the freshness baseline) is present.
    const offsets = [...new Set([0, ...probe.offsetsSec])].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b).slice(0, 8);
    try {
      const samples: { offset: number; status: number; body: string; generatedAt?: string; cacheState?: string }[] = [];
      for (const offset of offsets) {
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
        samples.push({ offset, status: res.status, body: text.slice(0, 500), generatedAt, cacheState });
      }

      // A non-2xx at any offset is a probe failure, not a freshness signal.
      const errored = samples.filter((s) => s.status < 200 || s.status >= 300);
      if (errored.length) {
        results.push({
          kind: "timewarp",
          status: "fail",
          title: `Time-warp ${probe.name}`,
          detail: `Non-2xx response at offsets ${errored.map((s) => `${s.offset}s→${s.status}`).join(", ")} (expectation: ${probe.expectation})`,
          metrics: Object.fromEntries(samples.map((s) => [`offset_${s.offset}s`, `HTTP ${s.status} ${s.cacheState ?? "?"} @ ${s.generatedAt ?? "?"}`])),
        });
        continue;
      }

      // Staleness check: any sample past the fresh window that still returns the
      // t=0 generation timestamp is serving stale data. Offsets inside the window
      // (a legitimate cache hit) are not stale. Falls back to raw-body comparison
      // when the app exposes no generatedAt marker.
      const base = samples[0];
      const freshWindow = probe.freshWindowSec ?? 0;
      const stale = samples.filter((s) => {
        if (s.offset <= freshWindow || s.cacheState === "miss") return false;
        if (s.generatedAt !== undefined) return s.generatedAt === base.generatedAt;
        return s.body === base.body; // no marker: identical body past the window is stale
      });
      const lastOffset = offsets[offsets.length - 1];
      const staleAtEnd = stale.some((s) => s.offset === lastOffset);

      results.push({
        kind: "timewarp",
        status: staleAtEnd ? "fail" : stale.length ? "warn" : "pass",
        title: `Time-warp ${probe.name}`,
        detail: staleAtEnd
          ? `Stale data still served ${lastOffset}s after generation (expectation: ${probe.expectation}). Offsets serving stale: ${stale.map((s) => s.offset + "s").join(", ")}`
          : stale.length
            ? `Same payload observed at offsets ${stale.map((s) => s.offset + "s").join(", ")} — verify TTL intent (${probe.expectation})`
            : `Freshness behaves as expected across offsets ${offsets.join("s, ")}s`,
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
