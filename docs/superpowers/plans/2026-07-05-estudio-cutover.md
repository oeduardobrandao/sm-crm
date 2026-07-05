# Estúdio cutover (slice D) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the v1/satori legacy, take the forked editor LIVE on a public origin
(CORS + CSP + Vercel protection off), and merge the entire Estúdio initiative into `main`
— which makes the deployed CRM (app.mesaas.com) serve the Estúdio routes for the first
time (still dark behind `feature_estudio`). Ends the repo/deploy drift that has existed
since v1 (edge fns/migrations were always deployed straight from the branch).

**Architecture:** No new features. Three moves: (1) delete the now-orphaned satori module
web (`_shared/design-doc*` + `design-render-{core,tree,status}` + `_shared/fonts/` — they
only import each other; slice B already decoupled `mcp/`); (2) editor go-live plumbing
(fork `vercel.json` CSP, deployment protection off, final origin → `ALLOWED_ORIGINS` +
`VITE_ESTUDIO_EDITOR_ORIGIN`); (3) merge `main` into the branch, gates, PR, Eduardo merges.

**Current state (verified 2026-07-05):** `feat/estudio-openpencil` @ 9dc2a92 (A1+A2+B all
merged + live-verified); fork `mesaas` @ 5a4ae95 (readOnly shipped, dark editor deployed);
prod edge fns/DB already match the branch. Branch vs main: 94 commits, 325 files, +30k/−2.7k.
Coverage ratchet PASSES on the branch with margin (49.45/74.28/56.69/49.45 vs floors
45/72/54/45).

## Coordination (READ FIRST)

- Slices A and B are DONE — no parallel session owns anything anymore. Single session,
  sequential.
- **Eduardo-gated steps** (stop and ask at each): editor domain decision, Vercel
  deployment-protection toggle, `ALLOWED_ORIGINS` update (secret value is UNREADABLE — he
  must supply the current list; never overwrite-guess), `VITE_ESTUDIO_EDITOR_ORIGIN` on the
  CRM Vercel project, PR review + merge to main, and the final E2E login on app.mesaas.com.
- **Branch:** `feat/estudio-cutover` off `feat/estudio-openpencil` in a worktree (copy
  `.env` in). Merge back into `feat/estudio-openpencil`, then PR that branch → `main`.
  This is the ONE slice that finally touches main.

## Global constraints (house rules + reconfirmed gotchas)

- `npm run test:functions` pollutes `node_modules` (deno) → run BEFORE `npm ci` →
  vitest/builds. Revert dirty root `deno.lock`.
- CI gates on the PR: eslint (0 errors), `format:check`, `coverage:check` (ratchet floor),
  deno suite. Local-run ALL of them before pushing.
- NEVER pass secrets as CLI literals; `supabase secrets set --env-file` needs a RELATIVE
  path. Repo CLI link points at STAGING — always `--project-ref skjzpekeqefvlojenfsw` for
  prod. Edge deploys (if any) use `--use-api`.
- Fork conventions: `// MESAAS:` markers, `UPSTREAM.md` diff-surface list, `bun test
  tests/engine/` (66 pre-existing failures = LFS fixtures; compare against a stashed
  baseline, not zero), build `bun --bun run build`, deploy `npx vercel deploy --prod --yes`.
- Feature stays DARK: `feature_estudio` off on all plans (DK TESTE override only). Slice D
  does NOT flip any plan flags.

---

### Task 1: Legacy deletion + docs sweep

**Files:**
- Delete: `supabase/functions/_shared/design-doc.ts`, `design-doc-fixtures.ts`,
  `design-render-core.ts`, `design-render-tree.ts`, `design-render-status.ts`,
  `supabase/functions/_shared/fonts/` (entire dir — only the legacy web + its own test use
  it), tests `design-render-tree_test.ts`, `design-render-status_test.ts`,
  `design-doc-schema_test.ts`, `design-render-core_test.ts`, `fonts-lookup_test.ts`
- Delete: `spike/` (move `spike/openpencil/NOTES.md` → `docs/estudio-spike-notes.md`
  first — it is the initiative's findings journal, referenced by memory)
- Modify: `.claude/launch.json` (drop the `spike-stub` config), stale comments in
  `_shared/r2.ts` (~line 95) and `sign-r2-urls/handler.ts` (~line 58) that still mention
  satori/design-render-core, `docs/estudio-design.md` + `docs/estudio-plan.md` (add a
  SUPERSEDED banner at the top pointing to `docs/estudio-v2-editor-contract.md` +
  `docs/superpowers/specs/2026-07-04-estudio-design-first-model.md`)

- [ ] **Step 1:** Worktree/branch `feat/estudio-cutover`; copy `.env` in.
- [ ] **Step 2:** Deletions + NOTES move + launch.json + comment rewording + doc banners.
  `scripts/estudio/` STAYS (starter-template generator is live tooling).
- [ ] **Step 3:** Sweep gate:
  `grep -rn "satori\|design-doc\|design-render-core\|design-render-tree\|design-render-status\|_shared/fonts" apps/ supabase/functions/ packages/ scripts/ --include="*.ts*" --include="*.mjs"`
  → ZERO hits (migrations/docs/plan history may mention them; code must not).
- [ ] **Step 4:** Full local gates (deno suite SHRINKS — that is expected; note the new
  count), `npm ci`, vitest, `npm run build` + `build:hub`, lint, prettier. Commit
  (`chore(estudio): delete satori legacy — v2 pipeline is the only pipeline`).

### Task 2: Editor go-live — CSP, protection, origins (Eduardo-gated)

**Files (fork `~/Projects/open-pencil-spike`, branch `mesaas`):** `vercel.json`,
`UPSTREAM.md`. **Files (this repo):** none (env/secrets only).

- [ ] **Step 1:** ASK EDUARDO to decide the editor's final origin:
  (a) custom domain `estudio.mesaas.com` (recommended — stable, brandable; needs a DNS
  CNAME + domain add on the `mesaas-estudio` Vercel project), or (b) the project's stable
  `*.vercel.app` production alias. Everything downstream uses this ONE origin string.
- [ ] **Step 2:** Fork `vercel.json`: add a headers block —
  `Content-Security-Policy: frame-ancestors https://app.mesaas.com` (the editor must ONLY
  be embeddable by the CRM; standalone/dev is unaffected — CSP frame-ancestors only gates
  framing) + `X-Content-Type-Options: nosniff`. Update `UPSTREAM.md` diff surface. Fork
  gates (lint + engine baseline) → commit → `npx vercel deploy --prod --yes`.
- [ ] **Step 3:** EDUARDO: turn OFF Deployment Protection on the `mesaas-estudio` Vercel
  project (an SSO interstitial cannot render inside the CRM iframe). Verify: anonymous
  `curl -sI <editor origin>` → 200 (not 302 sso), CSP header present.
- [ ] **Step 4:** EDUARDO: append the editor origin to prod `ALLOWED_ORIGINS` (he supplies
  the current value; write the merged list to a scratch env file and
  `npx supabase secrets set --env-file <RELATIVE path> --project-ref skjzpekeqefvlojenfsw`).
  This is what lets the editor's direct `functions/v1/design-manage/blob` and
  `sign-r2-urls` calls pass CORS in prod. Verify from outside: `curl -s -X OPTIONS
  <SUPABASE_URL>/functions/v1/design-manage/blob -H "Origin: <editor origin>" -H
  "Access-Control-Request-Method: PUT" -i` → ACAO echoes the editor origin and allows
  `x-expected-rev`.
- [ ] **Step 5:** EDUARDO: set `VITE_ESTUDIO_EDITOR_ORIGIN=<editor origin>` (Production)
  on the CRM Vercel project. Inert until the main merge deploys — no redeploy needed now.
- [ ] **Step 6:** Standalone smoke of the deployed editor URL (loads, pencil splash, no
  console errors). R2 note: canvas images go through the `sign-r2-urls` byte-proxy, so the
  R2 bucket CORS does NOT need the editor origin — confirm during Task 5's E2E that images
  render (if they don't, that is the first place to look).

### Task 3: Merge `main` into the branch + full gates

- [ ] **Step 1:** Merge `feat/estudio-cutover` back into `feat/estudio-openpencil`
  (fast-forward from the main checkout if clean; else merge here first). Then, on the
  worktree branch: `git merge main` (94 commits apart — expect conflicts in shared spots:
  `package.json`/lockfile, `apps/crm/src/App.tsx`, `WorkflowDrawer.tsx`, i18n files,
  `ci.yml`). Resolve favoring: initiative code for Estúdio files, main for everything it
  touched that we didn't.
- [ ] **Step 2:** Full gates on the merged tree IN ORDER: `npm run test:functions` →
  revert `deno.lock` → `npm ci` → `npm run test` → `npm run build` + `build:hub` →
  `npm run lint` (0 errors) → `npm run format:check` → `npm run coverage:check` (floors
  45/72/54/45 — the branch passes at ~49/74/56/49; if the merge drags it below, add
  targeted tests, do NOT lower the floor). Commit the merge; ff `feat/estudio-openpencil`.

### Task 4: PR to main (Eduardo merges)

- [ ] **Step 1:** Push `feat/estudio-openpencil`; `gh pr create` → base `main`. Body: the
  initiative in one page — what ships (Estúdio v2 end-to-end, dark), what got deleted
  (v1 editor UI in an earlier commit, satori pipeline here), the prod-drift note being
  RESOLVED (prod edge fns/DB already run this code — the merge changes the DEPLOYED CRM
  only), and the test-residue note (DK TESTE designs/posts). End with the standard
  attribution footer.
- [ ] **Step 2:** CI green (lint / format / coverage ratchet / deno / vitest). Fix
  anything red; re-request.
- [ ] **Step 3:** EDUARDO reviews + merges. Vercel auto-deploys CRM+Hub from main. After
  merge: NO edge-function deploys needed (prod already matches); verify the Vercel
  production deployment succeeded (both builds).

### Task 5: Live E2E on the DEPLOYED app + docs/memory

- [ ] **Step 1:** E2E on `https://app.mesaas.com` with the DK TESTE login (test@mesaas.com
  — Eduardo logs the harness browser in, or clicks through himself): (a) `/estudio`
  gallery renders with thumbnails; (b) drawer → editor boots from the PROD editor origin
  (iframe src = editor domain; doc loads via `functions/v1` directly — the dev Vite proxy
  is not in play); (c) an edit autosaves (x-rev bumps) and the render lands as post media;
  (d) read-only: locked-post design opens with banner + Duplicar, zero PUTs; (e) feature
  gate: a non-DK-TESTE workspace sees no Estúdio (nav + routes blocked); (f) Hub quick
  regression (client portal loads a post normally).
- [ ] **Step 2:** Update `docs/estudio-v2-editor-contract.md` (deployed editor URL → the
  final origin; drop the stale dark-deployment URL). Append findings to
  `docs/estudio-spike-notes.md`. Update memory `project_estudio_openpencil_pivot.md`:
  SLICE D COMPLETE — initiative ON MAIN, drift resolved, editor origin recorded; flip the
  "How to apply" drift warning to resolved.
- [ ] **Step 3:** Flag (do NOT execute) the two known leftovers for Eduardo: (1) STAGING
  has none of the Estúdio migrations (db push blocked by the dup-timestamp; `dev:staging`
  Estúdio stays broken until he applies the chain via SQL editor); (2) DK TESTE test
  residue (designs 1/2/3/5, posts 1114/1115) — delete via UI whenever convenient. Offer
  the slice C plan (image → editable) as the next step.
