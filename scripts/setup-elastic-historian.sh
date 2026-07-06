#!/usr/bin/env bash
# Creates the "ShipGate Historian" — an Elastic Agent Builder agent that answers
# natural-language questions about release-gate history, grounded in the
# shipgate-evidence index via ES|QL tools.
#
# Required env: KIBANA_URL (https://<project>.kb.<region>.gcp.elastic.cloud),
#               ELASTICSEARCH_API_KEY
# Note: ES|QL tool params only accept types: string | integer | float | boolean | date | array.
set -euo pipefail

: "${KIBANA_URL:?set KIBANA_URL}" "${ELASTICSEARCH_API_KEY:?set ELASTICSEARCH_API_KEY}"
H=(-H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" -H 'Content-Type: application/json' -H 'kbn-xsrf: true')

curl -sf -X POST "$KIBANA_URL/api/agent_builder/tools" "${H[@]}" -d '{
  "id": "shipgate_recent_verdicts",
  "type": "esql",
  "description": "Returns the most recent ShipGate release verdicts (release-gate decisions with experiment evidence). Each row: timestamp, repo, PR number, commit sha, decision (ship / ship-with-warnings / block), and the agent plan summary.",
  "tags": ["shipgate"],
  "configuration": {
    "query": "FROM shipgate-evidence | SORT @timestamp DESC | KEEP @timestamp, repo, prNumber, sha, verdict.decision, plan.summary | LIMIT ?limit",
    "params": { "limit": { "type": "integer", "description": "max rows to return, e.g. 20" } }
  }
}' >/dev/null && echo "tool: shipgate_recent_verdicts"

curl -sf -X POST "$KIBANA_URL/api/agent_builder/tools" "${H[@]}" -d '{
  "id": "shipgate_blocked_releases",
  "type": "esql",
  "description": "Finds ShipGate release verdicts filtered by decision (block, ship-with-warnings, or ship), newest first, including the verdict reasons and advice the agent gave.",
  "tags": ["shipgate"],
  "configuration": {
    "query": "FROM shipgate-evidence | WHERE verdict.decision == ?decision | SORT @timestamp DESC | KEEP @timestamp, repo, prNumber, sha, verdict.reasons, verdict.advice, plan.risks | LIMIT 20",
    "params": { "decision": { "type": "string", "description": "one of: ship, ship-with-warnings, block" } }
  }
}' >/dev/null && echo "tool: shipgate_blocked_releases"

curl -sf -X POST "$KIBANA_URL/api/agent_builder/agents" "${H[@]}" -d '{
  "id": "shipgate_historian",
  "name": "ShipGate Historian",
  "description": "Answers questions about release-gate history: what was blocked and why, which experiments failed, what operational risks recur. Grounded in the shipgate-evidence Elasticsearch index.",
  "labels": ["shipgate"],
  "avatar_symbol": "SG",
  "avatar_color": "#3fb950",
  "configuration": {
    "instructions": "You are the ShipGate Historian. ShipGate is a diff-aware release-gate agent: for each pull request it plans experiments (load tests, time-warp TTL probes, observability audits), runs them, and issues a verdict (ship / ship-with-warnings / block) stored in the shipgate-evidence index. Answer questions about this release history using your tools. Always cite concrete evidence: repo, PR number, timestamp, failed experiment titles, and measured numbers when available. When asked why something was blocked, quote the verdict reasons. Answer in the language of the question (Japanese or English).",
    "tools": [
      { "tool_ids": ["shipgate_recent_verdicts", "shipgate_blocked_releases", "platform.core.search"] }
    ]
  }
}' >/dev/null && echo "agent: shipgate_historian"

echo "Ask it something:"
echo "  curl -X POST \"\$KIBANA_URL/api/agent_builder/converse\" -H \"Authorization: ApiKey ...\" -H 'Content-Type: application/json' -H 'kbn-xsrf: true' \\"
echo "    -d '{\"agent_id\":\"shipgate_historian\",\"input\":\"なぜ PR 42 はブロックされた？\"}'"
