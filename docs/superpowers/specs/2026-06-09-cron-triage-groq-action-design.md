# Cron-Failure Triage — Groq + GitHub Action (Flavor B)

> **Status:** Design 2026-06-09. **Supersedes the engine choice** in
> `2026-06-08-cron-failure-triage-design.md` (Anthropic Routine). Everything on
> the Supabase capture side (the `cron_failures` table, `reportCronFailure`,
> enriched email, atomic cooldown claim) is **unchanged and already shipped in
> PR #102**; this only replaces the triage *trigger + agent* half.
> Next: `superpowers:writing-plans`.

## Why the change

The Routine approach (PR #102) was validated end-to-end **except** it can't file
issues: the Claude GitHub App available to the account is read-only on issues
(`403 Resource not accessible by integration`), and a GitHub App's scope can't be
escalated by the user. Metered Console-API (the other fallback) was declined on
cost. **Flavor B** keeps it free and fully automated: a **free model (Groq, the
same one the changelog uses)** drafts a fix-spec from the failure report **plus
deterministically-gathered source**, and a GitHub Action files it as an issue
using the built-in `GITHUB_TOKEN` (which natively has `issues: write`). The
filed issue is a *starting spec* the user hands to a local agent to implement.

## Architecture / Data flow

```
cron fails → reportCronFailure(...)           [_shared/triage.ts, unchanged steps 1-2]
   step 1: INSERT cron_failures row (best-effort)
   step 2: sendCronFailureEmail (always)
   step 3 (CHANGED): atomic claim_cron_triage(hash, ...) → if won:
       POST https://api.github.com/repos/<owner>/<repo>/dispatches
         Authorization: Bearer <GITHUB_DISPATCH_TOKEN>   # fine-grained PAT
         body: { event_type: "cron-failure",
                 client_payload: { cron_name, signature, signature_hash,
                                   error_message, errors, stack, occurred_at } }
   ▼
GitHub Action  .github/workflows/cron-triage.yml   (on: repository_dispatch [cron-failure])
   permissions: { contents: read, issues: write }
   1. checkout + setup-node
   2. gather.mjs   — deterministically read the failing cron's source
                     (supabase/functions/<cron>/*.ts + the ../_shared/*.ts it imports,
                     1 level, capped ~40KB) → context.json. NO token in this step.
   3. write-spec.mjs — ONE Groq call (llama-3.3-70b-versatile): failure payload +
                     gathered code → a markdown fix-spec. NO repo token in this step
                     (only GROQ_API_KEY, the free/low-value key). Output size-capped.
   4. file-issue (deterministic) — dedup: `gh issue list --label cron-triage:<hash> --state open`
                     → if found, `gh issue comment` (recurrence); else ensure the
                     `cron-triage:<hash>` label exists and `gh issue create` with
                     labels `cron-triage` + `cron-triage:<hash>`. Uses GITHUB_TOKEN.
```

The dispatch carries the whole failure payload, so the Action needs **no Supabase
access**. Same "stateless toward the backend" property as before.

## Trust split (mirrors the changelog workflow)

The failure `error` strings + the gathered source flow into the Groq prompt →
**prompt-injection surface**. Mitigations, identical in spirit to
`changelog-weekly.yml`:
- The Groq step has **no repo write token** — only `GROQ_API_KEY` (free,
  low-value). Its output is treated as untrusted text.
- Issue creation is a **separate deterministic step**; the LLM output only
  becomes issue *body text* (never executed, never interpolated into a shell
  command — passed via `--body-file`). Blast radius = a malformed issue. Low.
- `GITHUB_TOKEN` is scoped by `permissions:` to `issues: write` + `contents:
  read` only.

## Components

### 1. `_shared/triage.ts` — change step 3 only
Replace the routine `/fire` POST with a GitHub `repository_dispatch` POST.
- New env (read lazily): `GITHUB_DISPATCH_TOKEN`, `GITHUB_TRIAGE_REPO`
  (`owner/repo`). Remove `TRIAGE_ROUTINE_URL` / `TRIAGE_ROUTINE_TOKEN` /
  `TRIAGE_ROUTINE_BETA` reads.
- Keep: signature/hash, the atomic `claim_cron_triage` gate (still dedups
  before dispatching so we don't spam Actions), and the never-throws contract.
- `client_payload` = `{ cron_name, signature, signature_hash, error_message,
  errors, stack, occurred_at }`. (≤ the GitHub 64KB payload limit — `errors`/
  `stack` capped if large.)
- `renderFailureReport` is no longer needed for the dispatch (the Action builds
  the prompt) — keep it only if still used elsewhere; otherwise remove with its
  test. (Decide during planning; leaning remove to avoid dead code.)

### 2. `scripts/cron-triage/gather.mjs` (new)
Input: cron name (from the dispatch payload, passed as an arg/env). Reads
`supabase/functions/<cron>/` `*.ts` files, resolves their `../_shared/*.ts`
imports one level deep, concatenates with file headers, caps total at ~40KB
(logs what was truncated — no silent drops). Writes `context.json`
(`{ cronName, files: [{path, content}] }`). Pure FS + static import-regex; no
network, no token.

### 3. `scripts/cron-triage/write-spec.mjs` (new)
Mirrors `scripts/changelog/write-entries.mjs`: one Groq HTTP call
(`llama-3.3-70b-versatile`), `GROQ_API_KEY` from env, **no tools, no repo
token**. Prompt = failure payload + `context.json`, instruction to produce a
markdown spec (root-cause hypothesis with `file:line` where evident, a concrete
fix plan a developer/agent can implement, and a confidence level), treating the
failure text as untrusted data. Output written to a file; size-capped; on Groq
error it writes a minimal fallback spec (the raw failure report) so the issue
still gets filed.

### 4. `.github/workflows/cron-triage.yml` (new)
`on: repository_dispatch (types: [cron-failure])` + `workflow_dispatch`
(manual test inputs mirroring the payload). `permissions: { contents: read,
issues: write }`. `concurrency` keyed on the signature hash. Steps = checkout →
node → `gather.mjs` → `write-spec.mjs` (Groq) → dedup + `gh issue
create/comment`. Title `[cron-triage] <cron>: <one-line cause>`.

### 5. Secrets
- **Supabase (new):** `GITHUB_DISPATCH_TOKEN` — fine-grained PAT, this repo
  only, minimum perm to send `repository_dispatch` (verify exact fine-grained
  permission at impl — likely Contents: write; or reuse the existing
  `CHANGELOG_PAT` if scoped appropriately). `GITHUB_TRIAGE_REPO` =
  `oeduardobrandao/sm-crm`.
- **Supabase (remove):** `TRIAGE_ROUTINE_URL`, `TRIAGE_ROUTINE_TOKEN`.
- **GitHub Actions:** `GROQ_API_KEY` — **already exists** (changelog uses it).
  `GITHUB_TOKEN` is automatic. No new GH secret.
- A PAT-authored `repository_dispatch` correctly triggers the workflow (a
  `GITHUB_TOKEN`-authored event would not) — same reason the changelog uses a
  PAT.

## Dedup (unchanged in spirit, two layers)
1. Edge-function atomic `claim_cron_triage` cooldown (24h) gates the dispatch.
2. The Action checks for an open `cron-triage:<hash>` issue → comment vs create.

## Testing
- `triage.ts` (Deno, extend `triage_test.ts`): with mocked `fetch` + supabase
  mock — fires a `repository_dispatch` POST (correct URL/headers/`event_type`/
  `client_payload`) when the claim is won; skips on cooldown; still emails when
  insert fails; never throws. (Replaces the `/fire` assertions.)
- `gather.mjs` (node/vitest or a deno test): given a cron name, returns the
  cron's files + its resolved `_shared` imports; respects the size cap.
- `write-spec.mjs`: Groq call mocked → returns the spec; on Groq error →
  fallback spec. (Light; mirrors changelog test depth.)
- Manual: `workflow_dispatch` run with a sample payload → confirm an issue is
  filed with both labels and a sensible spec; re-fire same hash → comment, not
  duplicate.

## Rollout
- Same branch `feat/cron-failure-triage`; update PR #102 (retitle to reflect
  Groq+Action). Delete the Anthropic Routine in claude.ai (retires the exposed
  token). Remove the routine secrets from Supabase; add `GITHUB_DISPATCH_TOKEN`
  + `GITHUB_TRIAGE_REPO`. Redeploy the 4 crons. Test via `workflow_dispatch`.

## Open items to verify at implementation
- Exact fine-grained PAT permission required for `POST /repos/{}/dispatches`
  (Contents: write is the usual answer) — or reuse `CHANGELOG_PAT`.
- Groq context budget for `llama-3.3-70b-versatile` vs the gathered code size
  (cron files are small; 40KB cap is safe, but confirm TPM tier).
- Whether to delete `renderFailureReport` (+ its test) if nothing else uses it.
