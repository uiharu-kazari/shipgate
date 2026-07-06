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

## The demo arc (self-healing release gate)

```bash
npm install && ./demo.sh
```

```
ACT 1  risky PR       → agent plans & runs experiments        → 🔴 BLOCK
                        (stale cache after TTL, 100% error storm, 3 unobservable paths)
ACT 2  agent fixes it → POST /propose-patch rewrites the file
                        (expiry check corrected, failure paths instrumented, graceful degradation)
ACT 3  agent re-runs  → same experiments, patched app          → 🟢 SHIP
```

The agent doesn't just find problems — it proves them with experiments, writes the fix,
and re-proves the fix with the same experiments. Every verdict lands in Elasticsearch, so
the dashboard shows the block→ship evidence timeline.

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

## Gemini auth: the two Google API systems (hard-won knowledge)

Google currently has **two separate API surfaces** for Gemini, and they authenticate differently:

| | Gemini Developer API | Vertex AI ("Gemini Enterprise Agent Platform") |
|---|---|---|
| Host | `generativelanguage.googleapis.com` | `aiplatform.googleapis.com` |
| Auth | **API key** (`x-goog-api-key`) | **OAuth only** — API keys are rejected with `CREDENTIALS_MISSING` (except rare "express mode" accounts) |
| Key source | https://aistudio.google.com/apikey | n/a — `gcloud auth`, service accounts, ADC |
| URL shape | `/v1beta/models/{model}:generateContent` | `/v1/projects/{project}/locations/{loc}/publishers/google/models/{model}:generateContent` |

Gotchas that cost us hours:

- **Since 2026-06-19 the Developer API rejects *unrestricted* keys** with `API_KEY_SERVICE_BLOCKED`. A key must have an API-restrictions allowlist that explicitly includes **"Gemini API"** (the console's new name for "Generative Language API"). Keys that worked before that date silently broke.
- **"Gemini for Google Cloud API" is a decoy** — that's the Cloud-Console-assistant product (`cloudaicompanion.googleapis.com`). Allowlisting it does NOT permit model calls.
- In the console's restriction picker, "Gemini API" is **greyed out until the API is enabled** in the project (APIs & Services → Library → Gemini API → Enable).
- `API_KEY_SERVICE_BLOCKED` = "this key has an allowlist and the called service isn't on it". `API_KEY_INVALID` = the key is revoked/deleted.

ShipGate supports both transports (`agent/src/llm.ts`):

```bash
# Vertex (recommended — what we use): no API key at all
export GOOGLE_CLOUD_PROJECT=your-project-id   # e.g. gen-lang-client-0140113557
# token chain: GOOGLE_ACCESS_TOKEN env → Cloud Run metadata server → local `gcloud auth print-access-token`

# or Developer API: needs a properly-restricted key
export GEMINI_API_KEY=AIza…
```

On Cloud Run the metadata server supplies the service-account token automatically — zero config.

## Graceful degradation

No Gemini key (or a blocked one)? The agent falls back to a heuristic planner/verdict so the
whole loop still runs — the dashboard labels those runs `heuristic fallback`.
