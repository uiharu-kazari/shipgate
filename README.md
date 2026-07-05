# 🚦 ShipGate — diff-aware release experiment agent

**CI tells you your code is correct. Nobody tells you it's *operable*.**
ShipGate is an AI release gate for TypeScript web apps: given a PR diff, a Gemini-powered
agent *decides for itself* which operational experiments the change deserves, generates and
runs them, stores the evidence in Elasticsearch, and issues a release verdict
(`ship` / `ship-with-warnings` / `block`) on the PR.

Built for the [DevOps × AI Agent Hackathon 2026](https://findy.notion.site/devops-ai-agent-hackathon-2026).

## Why an agent?

A fixed pipeline runs the same checks on every PR. ShipGate runs *different* experiments per
diff, because the agent reads the change and predicts what could go wrong in production:

| The diff adds… | The agent generates… |
|---|---|
| a changed request handler / query | a targeted **load experiment** with a latency budget |
| a cache TTL, token expiry, retry backoff | a **time-warp probe** — replays requests at virtual clock offsets (0s, 61s, 3601s) instead of waiting |
| a new failure path / external call | an **observability-readiness audit** — "if this fails at 3am, can on-call see it?" |

## Architecture

```
                          ┌──────────────────────────────────────────────┐
 GitHub PR ──diff──▶ CI ──▶  ShipGate agent (Cloud Run, TypeScript/Hono) │
                          │  1. Gemini plans experiments from the diff   │
                          │  2. agent executes: load / time-warp / o11y  │
                          │  3. evidence → Elasticsearch                 │
                          │  4. Gemini issues release verdict            │
                          └──────┬──────────────────────┬────────────────┘
                                 ▼                      ▼
                        PR comment + gate       dashboard (/) reading ES
```

- **Google Cloud AI (required)**: Gemini API — experiment planning + verdict reasoning
- **Google Cloud runtime (required)**: Cloud Run — agent and demo app containers
- **Elasticsearch (sponsor)**: evidence store + verdict history + dashboard backend
- **DevOps loop**: GitHub Actions workflow gates PRs on the agent's verdict

## Quick start

```bash
npm install
cp .env.example .env   # fill in GEMINI_API_KEY, ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY

# terminal 1 — app under test (virtual clock enabled)
SHIPGATE_TESTING=1 npx tsx demo-app/src/index.ts

# terminal 2 — the agent
set -a; source .env; set +a
npx tsx agent/src/index.ts

# terminal 3 — ask for a verdict on the bundled risky PR
curl -s localhost:8080/analyze -H 'content-type: application/json' -d "$(
  node -e 'console.log(JSON.stringify({repo:"demo/shop",prNumber:42,sha:"abc1234",
    diff:require("fs").readFileSync("fixtures/risky-pr.diff","utf8"),
    targetUrl:"http://localhost:8081"}))')" | jq .verdict

open http://localhost:8080   # dashboard
```

The bundled `fixtures/risky-pr.diff` adds a search cache with a broken TTL check, a heavy
scoring loop, and an unlogged external call — ShipGate catches all three and blocks.

## Time-warp probing (the trick)

Waiting 60 minutes to test a 60-minute TTL doesn't fit CI. Apps under test honor an
`x-shipgate-clock-offset: <seconds>` header when `SHIPGATE_TESTING=1`, shifting their virtual
clock. The agent replays the same request at the offsets it chose and compares freshness
markers — catching "cache serves stale data after expiry" in seconds, not hours.

## Deploy to Cloud Run

```bash
gcloud run deploy shipgate-agent --source . --region asia-northeast1 \
  --set-env-vars GEMINI_API_KEY=…,ELASTICSEARCH_URL=…,ELASTICSEARCH_API_KEY=…
gcloud run deploy shipgate-demo --source demo-app --region asia-northeast1 \
  --set-env-vars SHIPGATE_TESTING=1
```

Then set repo variables `SHIPGATE_AGENT_URL` and `SHIPGATE_TARGET_URL` and the
`.github/workflows/shipgate.yml` gate is live.

## Graceful degradation

No Gemini key (or a blocked one)? The agent falls back to a heuristic planner/verdict so the
whole loop still runs — the dashboard labels those runs `heuristic fallback`.
