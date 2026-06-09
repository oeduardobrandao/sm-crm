# Cron-Triage (Groq + GitHub Action)

On a Supabase edge-function cron failure, the `reportCronFailure()` edge function fires a
GitHub `repository_dispatch` event. A GitHub Action automatically drafts a fix-spec with one
free Groq call (or a fallback raw report if Groq is unavailable) and files it as a deduped
GitHub issue. No agent. No Anthropic dependency.

## How it works

### Step 1: Edge function failure dispatch

When a cron fails, `reportCronFailure()` in `supabase/functions/_shared/triage.ts`:

1. Inserts a `cron_failures` row (best-effort; failure here must not block further steps).
2. Always sends an email alert via `sendCronFailureEmail()` (independent of step 1).
3. Atomically claims a dedup slot via the `claim_cron_triage` RPC (prevents redundant
   dispatches during cooldown window, default 24h). If the claim succeeds:
   - POSTs to `https://api.github.com/repos/{GITHUB_TRIAGE_REPO}/dispatches`
   - `event_type`: `cron-failure`
   - `client_payload` carries:
     - `cron_name` — the failing cron's name
     - `signature` — normalized error signature (UUIDs/timestamps/hex values redacted)
     - `signature_hash` — short FNV-1a hash (base36), used for dedup labels
     - `error_message` — first error message (trimmed to 1000 chars)
     - `errors` — array of per-account error details (up to 50 entries)
     - `stack` — optional stack trace (up to 4000 chars)
     - `occurred_at` — ISO 8601 timestamp

### Step 2: GitHub Action (trigger & gather)

`.github/workflows/cron-triage.yml` triggers on `repository_dispatch` type `cron-failure`
(or manual `workflow_dispatch` with `cron_name` input). Steps:

1. **Assemble payload** — extract `cron_name` and `signature_hash` from the dispatch or
   workflow inputs; write to `$RUNNER_TEMP/payload.json`.
2. **Gather source** — `node scripts/cron-triage/gather.mjs <cron_name>` — deterministic
   FS collection of the cron's source code and shared helpers (no repo token needed).
3. **Draft spec (Groq)** — `node scripts/cron-triage/write-spec.mjs` — one free Groq API
   call (`llama-3.3-70b-versatile` by default) to analyze the error + source and produce
   a JSON spec with `title` and `body` fields. If Groq errors or `GROQ_API_KEY` is unset,
   falls back to a deterministic raw report (no agent involved).
4. **File or update issue** — `gh` CLI files a new GitHub issue or comments on an existing
   one (dedup by label `cron-triage:<signature_hash>`). Issue always gets labels `cron-triage`
   and `cron-triage:<hash>`. A concurrency group ensures only one triage action runs per
   unique signature hash (manual `workflow_dispatch` runs key on `cron_name` instead).

### Dedup & labels

Every issue receives:
- `cron-triage` — base label (created once, reused).
- `cron-triage:<hash>` — per-signature label (created on demand, derived from FNV-1a of
  normalized error signature).

On re-fire of the same signature hash (after cooldown expires), the action detects the
open issue by label and comments instead of creating a duplicate.

### Trust split

- **Groq step** — has no `GITHUB_TOKEN`; untrusted input (edge function's client_payload)
  goes only to Groq, not the repo.
- **Issue step** — the deterministically produced `title` and `body` go to `gh`,
  which uses `GITHUB_TOKEN` to file/comment.

## Secrets & configuration

### Supabase secrets (edge function env)

| Secret | Value | Notes |
|--------|-------|-------|
| `GITHUB_DISPATCH_TOKEN` | Fine-grained PAT scoped to `oeduardobrandao/sm-crm` | Must have `Contents: read, write` permission (GitHub docs: "Contents read/write covers `repository_dispatch` endpoint"). Alternative: reuse existing `CHANGELOG_PAT` if it has the same scope. |
| `GITHUB_TRIAGE_REPO` | `oeduardobrandao/sm-crm` | Owner and repo name for dispatch target. |
| `TRIAGE_COOLDOWN_HOURS` | `24` (optional, default 24) | Dedup cooldown in hours. |

### GitHub Actions secrets (workflow env)

| Secret | Provider | Notes |
|--------|----------|-------|
| `GROQ_API_KEY` | GitHub Actions | Already set (shared with `changelog-weekly.yml`). For rotation, update in GitHub repo secrets. |
| `GITHUB_TOKEN` | GitHub Actions | Auto-provided. Workflow requires `permissions: issues: write` (already set in `.github/workflows/cron-triage.yml`). |

### Manual run inputs (`workflow_dispatch`)

| Input | Required | Notes |
|-------|----------|-------|
| `cron_name` | yes | Cron function name to triage (e.g. `instagram-refresh-cron`). |
| `payload_json` | no | Optional JSON `client_payload` to simulate a real dispatch (defaults to `{}`). |

### Optional model override

`write-spec.mjs` reads the Groq model from the `GROQ_MODEL` env var (default
`llama-3.3-70b-versatile`). It is **not** a workflow input — to override it, add a `GROQ_MODEL`
GitHub Actions secret/variable and inject it via `env:` on the "Draft spec (Groq)" step.

### Pre-setup

Remove any obsolete Supabase secrets (if they exist) from the prior routine design:
- `TRIAGE_ROUTINE_URL`
- `TRIAGE_ROUTINE_TOKEN`
- `TRIAGE_ROUTINE_BETA`

(The `cron-triage` and `cron-triage:<hash>` labels are created automatically by the workflow
via `gh label create --force`; no manual label setup is needed.)

## Testing

Manual trigger:

```bash
gh workflow run cron-triage.yml -f cron_name=instagram-refresh-cron
```

Expected: an issue is filed with title and body from Groq (or fallback).
Re-run with the same cron name → expect a new comment on the existing issue, not a
duplicate.

Or wait for a real cron failure to fire the workflow.

## Decommissioning

The retired Anthropic Routine (formerly in claude.ai) is obsolete. If it was previously
deployed:

1. Delete the routine in claude.ai (retire the `/fire` webhook).
2. Remove any associated bearer token / API key from Supabase or local config.

This design replaces it entirely — no manual agent intervention is needed.
