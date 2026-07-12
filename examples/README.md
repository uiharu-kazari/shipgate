# ShipGate workflow templates

These two files are **drop-in templates for the repo you want to gate** — the product
repo whose pull requests ShipGate should review (e.g. our `demo-shop` repo). They are
deliberately kept out of `.github/workflows/` in *this* repo: they trigger on
`pull_request` and deploy `--source .`, which requires a root `Dockerfile` for the app
under test. This repo has no root Dockerfile (the agent and demo app each have their
own), so wiring them up here would fail on every PR.

| File | Purpose |
| --- | --- |
| `shipgate-workflow.yml` | On each PR: deploy the PR's actual code to a temporary Cloud Run preview, ask the ShipGate agent for a verdict, comment it on the PR, and fail the check when the verdict is `block`. |
| `shipgate-cleanup-workflow.yml` | On PR close/merge: delete that PR's Cloud Run preview service. |

## Installing into a consumer repo

1. Copy both files into that repo's `.github/workflows/` directory:

   ```sh
   mkdir -p .github/workflows
   cp examples/shipgate-workflow.yml         /path/to/your-repo/.github/workflows/shipgate.yml
   cp examples/shipgate-cleanup-workflow.yml /path/to/your-repo/.github/workflows/shipgate-cleanup.yml
   ```

2. Make sure that repo has a **root `Dockerfile`** that builds the app under test.
   The gate deploys the PR's real build with `gcloud run deploy --source .`, so the
   verdict reflects the actual diff rather than a fixed staging environment.

3. Configure the repo's Actions settings:

   **Variables** (Settings → Secrets and variables → Actions → Variables)

   | Name | Value |
   | --- | --- |
   | `SHIPGATE_AGENT_URL` | Base URL of your deployed ShipGate agent (no trailing slash) |
   | `GCP_PROJECT` | Google Cloud project ID used for the PR previews |
   | `GCP_REGION` | Cloud Run region, e.g. `asia-northeast1` |

   **Secrets** (same page → Secrets)

   | Name | Value |
   | --- | --- |
   | `SHIPGATE_TOKEN` | Shared token the agent checks on the `x-shipgate-token` header |
   | `GCP_SA_KEY` | JSON key for a service account with Cloud Run deploy + delete permissions |

Open a pull request and ShipGate will post its verdict as a PR comment.
