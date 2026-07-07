#!/usr/bin/env bash
#
# Installs the ShipGate evidence Elasticsearch composable index template.
#
# Important: this template must be applied BEFORE the shipgate-evidence index is
# first created for these mappings to take effect. Existing indices keep their
# current mappings.
#
# If shipgate-evidence already exists, create a new index such as
# shipgate-evidence-v2 after applying this template, reindex data from
# shipgate-evidence into shipgate-evidence-v2, then swap the shipgate-evidence
# alias to point at the new index.

set -euo pipefail

if [ -z "${ELASTICSEARCH_URL:-}" ]; then
  echo "Error: ELASTICSEARCH_URL is required." >&2
  exit 1
fi

if [ -z "${ELASTICSEARCH_API_KEY:-}" ]; then
  echo "Error: ELASTICSEARCH_API_KEY is required." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 1
fi

base_url="${ELASTICSEARCH_URL%/}"

curl -sS -X PUT "${base_url}/_index_template/shipgate-evidence" \
  -H "Authorization: ApiKey ${ELASTICSEARCH_API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary @- <<'JSON'
{
  "index_patterns": ["shipgate-evidence*"],
  "priority": 500,
  "template": {
    "mappings": {
      "dynamic": false,
      "properties": {
        "@timestamp": {
          "type": "date"
        },
        "repo": {
          "type": "keyword"
        },
        "prNumber": {
          "type": "integer"
        },
        "sha": {
          "type": "keyword"
        },
        "plan": {
          "dynamic": false,
          "properties": {
            "summary": {
              "type": "text"
            },
            "risks": {
              "type": "text"
            }
          }
        },
        "results": {
          "type": "nested",
          "dynamic": false,
          "properties": {
            "kind": {
              "type": "keyword"
            },
            "status": {
              "type": "keyword"
            },
            "title": {
              "type": "text",
              "fields": {
                "keyword": {
                  "type": "keyword",
                  "ignore_above": 256
                }
              }
            },
            "detail": {
              "type": "text"
            },
            "metrics": {
              "type": "flattened"
            },
            "findings": {
              "type": "flattened"
            }
          }
        },
        "verdict": {
          "dynamic": false,
          "properties": {
            "decision": {
              "type": "keyword"
            },
            "confidence": {
              "type": "float"
            },
            "reasons": {
              "type": "text"
            },
            "advice": {
              "type": "text"
            }
          }
        },
        "agent": {
          "dynamic": false,
          "properties": {
            "model": {
              "type": "keyword"
            },
            "planMs": {
              "type": "long"
            },
            "totalMs": {
              "type": "long"
            },
            "mocked": {
              "type": "boolean"
            }
          }
        }
      }
    }
  },
  "_meta": {
    "description": "ShipGate release-gate evidence mappings with nested results and flattened metrics to avoid mapping explosion."
  }
}
JSON
echo
