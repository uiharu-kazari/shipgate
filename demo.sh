#!/usr/bin/env bash
# ShipGate demo: the self-healing release gate arc.
#   Act 1  risky PR  -> agent experiments -> BLOCK
#   Act 2  agent proposes the patch itself
#   Act 3  agent re-runs its experiments against the patched app -> SHIP
# Prereqs: `npm install` done; agent env vars exported (or heuristic fallback runs).
set -euo pipefail
cd "$(dirname "$0")"

AGENT_PORT=${AGENT_PORT:-8080}
DEMO_PORT=${DEMO_PORT:-8081}
AGENT_URL="http://localhost:$AGENT_PORT"
DEMO_URL="http://localhost:$DEMO_PORT"

cleanup() { kill "${DEMO_PID:-}" "${AGENT_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT

wait_for() { for _ in $(seq 1 30); do curl -sf "$1/healthz" >/dev/null && return 0; sleep 0.5; done; echo "timeout waiting for $1"; exit 1; }

echo "▶ starting ShipGate agent"
PORT=$AGENT_PORT npx tsx agent/src/index.ts & AGENT_PID=$!
wait_for "$AGENT_URL"

echo
echo "═══ ACT 1 — risky PR arrives ═══"
SHIPGATE_TESTING=1 PORT=$DEMO_PORT npx tsx demo-app/src/index.ts & DEMO_PID=$!
wait_for "$DEMO_URL"

node -e '
const fs = require("fs");
const body = { repo: "demo/shop", prNumber: 42, sha: "risky01",
  diff: fs.readFileSync("fixtures/risky-pr.diff", "utf8"), targetUrl: process.argv[1] };
fetch(process.argv[2] + "/analyze", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(body) })
  .then(r => r.json()).then(d => {
    console.log("verdict:", d.verdict.decision.toUpperCase());
    d.results.forEach(r => console.log(`  [${r.status}] ${r.title}`));
    fs.writeFileSync("/tmp/shipgate-act1.json", JSON.stringify(d));
  });' "$DEMO_URL" "$AGENT_URL"
sleep 1

echo
echo "═══ ACT 2 — agent proposes the fix ═══"
node -e '
const fs = require("fs");
const act1 = JSON.parse(fs.readFileSync("/tmp/shipgate-act1.json", "utf8"));
const src = fs.readFileSync("demo-app/src/index.ts", "utf8");
fetch(process.argv[1] + "/propose-patch", { method: "POST", headers: {"content-type":"application/json"},
  body: JSON.stringify({ sourceFiles: [{ path: "demo-app/src/index.ts", content: src }], results: act1.results }) })
  .then(r => r.json()).then(p => {
    console.log("rationale:", p.rationale);
    for (const f of p.files) {
      fs.copyFileSync(f.path, f.path + ".bak");
      fs.writeFileSync(f.path, f.content);
      console.log("patched:", f.path);
    }
  });' "$AGENT_URL"
sleep 1

echo
echo "═══ ACT 3 — agent re-verifies the patched app ═══"
kill "$DEMO_PID"; sleep 1
SHIPGATE_TESTING=1 PORT=$DEMO_PORT npx tsx demo-app/src/index.ts & DEMO_PID=$!
wait_for "$DEMO_URL"

node -e '
const fs = require("fs");
const body = { repo: "demo/shop", prNumber: 42, sha: "patched1",
  diff: fs.readFileSync("fixtures/fixed-pr.diff", "utf8"), targetUrl: process.argv[1] };
fetch(process.argv[2] + "/analyze", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(body) })
  .then(r => r.json()).then(d => {
    console.log("verdict:", d.verdict.decision.toUpperCase());
    d.results.forEach(r => console.log(`  [${r.status}] ${r.title}`));
  });' "$DEMO_URL" "$AGENT_URL"

# restore the buggy variant so the demo is repeatable
for f in demo-app/src/*.bak; do [ -e "$f" ] && mv "$f" "${f%.bak}"; done

echo
echo "Dashboard: $AGENT_URL  (block → ship timeline, evidence in Elasticsearch)"
