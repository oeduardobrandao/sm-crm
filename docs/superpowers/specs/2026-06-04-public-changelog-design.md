# Public Auto-Generated Changelog ("Novidades")

> **Status:** Design approved 2026-06-04. Revised 2026-06-04 after a spec review
> (7 findings resolved — see "Review Resolutions" at the end).
> Next step: implementation plan via `superpowers:writing-plans`.

## Overview

A **public, auto-generated changelog** at `/novidades` that doubles as a feature
showcase. A scheduled agent runs **weekly**, reads the PRs merged since the last
entry, writes benefit-oriented Portuguese release notes, and publishes them
**hands-off** (no human approval gate). The page is reachable by logged-out
visitors, is **prerendered for search engines**, and is linked from both the
landing page and the logged-in app.

## Goals

- Customers (and prospects on the landing page) can see what shipped, in plain
  Portuguese, without anyone manually writing release notes.
- Fully automatic: new entries appear weekly with no human in the loop.
- **Public and crawlable** — works for non-authenticated visitors, is indexable
  by search engines, and doubles as a "what does this app do" feature list.
- Safe despite being unreviewed: CI still gates, content is git-revertable and
  schema-validated, and the owner is notified of every publish.

## Non-Goals (YAGNI for v1)

The changelog JSON is the single data source, so each of these is easy to layer
on later:

- In-app editing / admin UI for entries.
- A separate Hub-facing (end-client) changelog.
- Email blasts to customers announcing releases.
- A "what's new" unread-indicator bell inside the app.
- Localization beyond Portuguese.

## Audience & Surface

- **Primary audience:** Mesaas CRM customers (social media managers) — and
  prospects, since the page is public, crawlable, and linked from the landing
  page.
- **Surfaces:**
  - Public route `/novidades` (no auth), prerendered for direct requests/crawlers.
  - Link on the landing page (`LandingPage.tsx`).
  - Link inside the logged-in app (sidebar nav, in the `Suporte` group).

## Content Model & Storage

Single version-controlled file, bundled at build time (static, version-controlled,
no DB / no RLS): `apps/crm/src/content/changelog.json`.

Releases are stored newest-first. A top-level `lastMergedAt` tracks the most
recent PR merge already processed (drives the cutoff + dedup — see Generation):

```jsonc
{
  "lastMergedAt": "2026-06-03T13:42:12Z",  // watermark: max mergedAt evaluated this run (incl. LLM-dropped)
  "releases": [
    {
      "date": "2026-06-08",                // ISO date of the weekly digest
      "summary": "Datas de publicação na lista de posts e relatórios renovados.",
      "items": [
        {
          "type": "feature",              // feature | improvement | fix
          "area": "Entregas",             // product area label
          "title": "Veja a data de publicação direto na lista de posts",
          "description": "A lista de posts agora mostra quando cada post foi publicado, sem precisar abrir o card.",
          "pr": 93                          // source PR number — also the dedup key
        }
      ]
    }
  ]
}
```

- `type` renders as a badge: **Novo** (feature) / **Melhoria** (improvement) /
  **Correção** (fix).
- `pr` is both traceability and the **deterministic dedup key**.
- A **zod schema** (`changelog.schema.ts`) defines the shape. It is used in three
  places so malformed content cannot ship or crash the page:
  1. The generator validates generated content before writing.
  2. A CI test validates the committed `changelog.json` against it (guaranteed to
     run — see Testing — so the auto-merge gate blocks malformed content).
  3. The page parses the imported JSON via `schema.safeParse` and renders a
     graceful empty/error state on failure (defense in depth against a bad manual
     edit or merge).

## Public Page, Routing & SEO

- Add route `/novidades` to the **public** block in `apps/crm/src/App.tsx`
  (alongside `/`, `/login`, `/politica-de-privacidade`, etc.) — explicitly
  **outside** `ProtectedRoute`. Note: the existing `/ajuda` route is login-only;
  this one must not be.
- New page: `apps/crm/src/pages/novidades/NovidadesPage.tsx`.
  - Reverse-chronological list grouped by release date.
  - Each item: type badge + area tag + title + description.
  - Uses the existing design system (Ant Design tokens + CSS variables).
  - Reads `changelog.json` through `schema.safeParse` (see Content Model).

### SEO (real, not just "fast")

The CRM is a Vite SPA; a normal route renders client-side and is **not** crawlable
on its own. To make `/novidades` genuinely indexable:

- **Build-time prerender** of `/novidades` into static HTML containing the actual
  changelog content (so crawlers and link-unfurlers see it without executing JS).
  Tooling to be chosen in the plan (e.g. a small post-build prerender script that
  reuses the React render, or a Vite prerender plugin). Output served for direct
  `GET /novidades`.
- **Vercel rewrite exception:** `vercel.json` currently rewrites CRM URLs to
  `/index.html` (SPA fallback). Add an exception so a direct request to
  `/novidades` serves the prerendered HTML instead of the SPA shell, while
  client-side navigation to `/novidades` still works via React Router.
  (Verify the existing catch-all does not shadow this.)
- **Per-page metadata:** `<title>`, meta description, canonical URL
  (`https://<prod>/novidades`), and Open Graph / Twitter tags for link previews.
- **Sitemap:** add `/novidades` to a `sitemap.xml` (create one if absent) and
  reference it from `robots.txt`.

### Links into the page

- Landing page (`LandingPage.tsx`) — nav and/or footer link to `/novidades`.
- Logged-in app — nav is config-driven via
  `apps/crm/src/components/layout/nav-data.ts`. Add a `Novidades` item (icon e.g.
  `ph-sparkle`) to the existing `Suporte` group (next to `Ajuda`). `Sidebar.tsx`
  renders it automatically; navigation is **in-app** via the existing
  `handleNavClick('/novidades')` (client-side route, same app — no full reload),
  even though the route is also publicly reachable.

## Generation Agent

Runs in the repository with `git` + `gh` available (both confirmed working;
remote: `github.com/oeduardobrandao/sm-crm`). Flow:

1. **Cutoff** — from `changelog.json.lastMergedAt`. Fetch lower bound =
   `date(lastMergedAt)` (GitHub search is date-granular). If the file is empty,
   fall back to a caller-supplied "7 days ago".
2. **Fetch** — `gh pr list --state merged --search "merged:>=<cutoffDate>"` with
   `--json number,title,body,labels,mergedAt`.
3. **Deterministic select** (pure code, before any LLM step):
   - **Dedup:** drop any PR whose `number` already appears in `changelog.json`,
     and any PR with `mergedAt <= lastMergedAt`. (Idempotent: re-running the same
     day cannot duplicate entries.)
   - **Prefilter:** keep PRs whose conventional-commit title prefix is in
     `{feat, fix, perf}`, **plus** any PR carrying an opt-in label `changelog`;
     always exclude any PR carrying `no-changelog`. Everything else is dropped.
     (Broadened from feat/fix-only so user-visible `perf`/labelled improvements
     are not lost.)
4. **Write** (LLM) — for each selected PR: choose `type` (feature/improvement/fix,
   independent of the title prefix — e.g. a `perf` PR is usually an *improvement*)
   and `area`, drop fixes a customer would not notice, and write a friendly
   Portuguese `title` + `description` aimed at users.
5. **Self-review** (LLM) against a rubric: accurate to the PR; no internal jargon
   / filenames; no security-sensitive details; no duplicates of existing entries.
6. **Advance the watermark + prepend.** Set `lastMergedAt` to the max `mergedAt`
   of the **entire evaluated batch** — every PR that passed the deterministic
   select and was shown to the LLM, *not* just the ones the LLM kept — so
   LLM-dropped PRs are never re-evaluated. Then `prependRelease` dedupes items by
   `pr`, prepends the new block, and writes the new `lastMergedAt`; validated
   against the zod schema before writing. **Edge case:** if candidates were fetched
   but the LLM kept none, still commit a *watermark-only* `lastMergedAt` update (no
   release block) so they are not reprocessed next run.

### Pure / testable split (kept inside CI coverage)

The pure data-transform functions live under **`apps/crm/src/content/`** so they
are covered by the existing Vitest `include` (`apps/**`) and typechecked by
`apps/crm/tsconfig.json` with **no CI config change**. They are imported only by
the generator script and tests, so Vite tree-shakes them out of the app bundle.

- `cutoffDate(changelog, fallback) -> 'YYYY-MM-DD'`
- `selectPRs(prs, { lastMergedAt, existingPrNumbers }) -> prs` (dedup + prefilter + labels)
- `prependRelease(changelog, release, newLastMergedAt) -> changelog` (dedupe items by `pr`, prepend, set `lastMergedAt`)

The **orchestration glue** (the `gh` calls, file IO, LLM invocation) lives in
`scripts/changelog/generate.ts`. It is not unit-tested (it is IO/agent harness),
but it **is typechecked in CI** via a new `tsconfig.scripts.json` + a typecheck
step added to `ci.yml`.

## Publishing — "Auto-Publish" Without Losing CI

Hands-off, but CI still guards quality:

1. Agent creates a branch (e.g. `chore/changelog-YYYY-MM-DD`), commits the
   `changelog.json` change, and opens a PR.
2. Agent enables **auto-merge (squash)** on the PR.
3. The existing backpressure-gate CI runs — including schema validation of
   `changelog.json` and the prerender build. Once green, the PR merges **itself**
   (no human review).
4. Vercel deploys on merge → the new entries are live on `/novidades`.

If the deterministic select returns nothing, the agent does nothing (no PR). If it
returned candidates but the LLM kept none, the agent commits only the advanced
`lastMergedAt` (a small bookkeeping PR) so those PRs are not re-evaluated next week.

> This is the one refinement to the raw "auto-publish" choice: it routes through
> an auto-merging PR so CI still runs, rather than committing straight to `main`.
> Confirmed acceptable by the owner.

## Notification & Safeguards

Unreviewed copy lands on a public page, so the following guards add **zero**
blocking human steps:

1. **Post-publish notification — its own GitHub Action.** A small workflow
   (`.github/workflows/changelog-notify.yml`) triggers on `push` to `main` filtered
   to `apps/crm/src/content/changelog.json`, computes the newly added release block
   from the diff, and sends a summary email via the existing Resend pattern
   (`alertas@mesaas.com.br`) with a link to `/novidades`. This reliably observes
   the *actual merge*, independent of the agent's lifecycle. (The agent enables
   auto-merge and exits; nothing it does could observe the later merge itself.)
   **Secrets:** the Action runs in GitHub, not Supabase, so the existing values in
   `_shared/notify.ts` (`RESEND_API_KEY`, `ALERT_EMAIL`) are not visible to it —
   both must be added as **GitHub repo secrets** and read via `secrets.*`.
2. **Full git revertability** — every publish is a squash commit on `main`.
3. **Deterministic select + self-review rubric** — junk never reaches the model;
   the model double-checks its own output before writing.
4. **Schema gate** — CI rejects malformed `changelog.json`, and the page
   `safeParse`s as a last line of defense.

## Scheduling

A **weekly scheduled remote agent (routine)** runs the generation flow (steps 1–6
above) — native to the existing Claude Code workflow. **The generation routine
needs no CI wiring;** the only CI piece in this design is the small notification
workflow above. The generation instructions are captured as a repeatable
runbook/command the routine executes.

Alternative considered: a GitHub Actions cron running Claude Code headless. Start
with the routine; the GH Action remains an option if cloud routines prove
limiting.

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/crm/src/content/changelog.json` | The changelog data (source of truth) |
| Create | `apps/crm/src/content/changelog.schema.ts` | Zod schema + types |
| Create | `apps/crm/src/content/changelog.logic.ts` | Pure: `cutoffDate`, `selectPRs`, `prependRelease` |
| Create | `apps/crm/src/content/__tests__/changelog.test.ts` | Unit tests for logic + `changelog.json` schema validation |
| Create | `apps/crm/src/pages/novidades/NovidadesPage.tsx` | Public changelog page (safeParse) |
| Create | `apps/crm/src/pages/novidades/__tests__/NovidadesPage.test.tsx` | Render test (badges, grouping, empty/error state) |
| Modify | `apps/crm/src/App.tsx` | Add public `/novidades` route |
| Modify | `apps/crm/src/pages/landing/LandingPage.tsx` | Link to `/novidades` |
| Modify | `apps/crm/src/components/layout/nav-data.ts` | Add `Novidades` item to `Suporte` group |
| Create | prerender config/script + `sitemap.xml` / `robots.txt` | SEO: static HTML + canonical/OG + sitemap |
| Modify | `vercel.json` | Rewrite exception so `/novidades` serves prerendered HTML |
| Create | `scripts/changelog/generate.ts` | Orchestration glue (gh, IO, LLM) |
| Create | `scripts/changelog/runbook.md` | Agent generation instructions |
| Create | `tsconfig.scripts.json` | Typecheck config for `scripts/` |
| Modify | `.github/workflows/ci.yml` | Add typecheck step for `scripts/` |
| Create | `.github/workflows/changelog-notify.yml` | Resend email on merge (push to main); needs `RESEND_API_KEY` + `ALERT_EMAIL` as GitHub repo secrets |

## Testing

- Unit tests (Vitest, under `apps/crm/src/content/__tests__/`, so they run in CI):
  - `cutoffDate` from `lastMergedAt` (and the empty-file fallback).
  - `selectPRs`: dedup by existing `pr` number and by `mergedAt <= lastMergedAt`;
    prefilter allowlist (`feat/fix/perf`); label overrides (`changelog` include,
    `no-changelog` exclude).
  - `prependRelease`: idempotency (overlapping PRs do not duplicate) and correct
    `lastMergedAt` recomputation.
- Schema validation test: parse the committed `changelog.json` with the zod schema
  (fails CI on malformed content — gates the auto-merge).
- `NovidadesPage` render test: badges, date grouping, empty state, and a
  `safeParse`-failure fallback state.
- Prerender smoke check: the build emits static HTML for `/novidades` containing
  entry text (so SEO does not silently regress).

## Review Resolutions (2026-06-04)

1. **scripts/ tests/typecheck not in CI** → pure logic + tests moved to
   `apps/crm/src/content/` (covered by existing Vitest/typecheck); glue stays in
   `scripts/` with a new `tsconfig.scripts.json` + CI typecheck step.
2. **Notification had no execution mechanism** → dedicated
   `changelog-notify.yml` GitHub Action on push-to-main observes the merge and
   sends the Resend email.
3. **Cutoff could duplicate/miss PRs** → top-level `lastMergedAt` drives the
   cutoff; deterministic dedup by `pr` number and `mergedAt` before any LLM step;
   `prependRelease` dedupes by `pr`.
4. **SEO overstated for a SPA** → owner chose real SEO: build-time prerender +
   Vercel rewrite exception + canonical/OG + sitemap.
5. **Prefilter dropped "improvement"-class PRs** → allowlist broadened to
   `{feat, fix, perf}` + opt-in/opt-out labels; LLM maps prefix→`type`
   independently.
6. **Schema validation only at generation** → also a guaranteed CI validation
   test and page-side `safeParse` with a fallback.
7. **Logged-in nav target underspecified** → named `nav-data.ts` (`Suporte`
   group) + `Sidebar.tsx`; in-app navigation via `handleNavClick`.

### Round 2 (2026-06-04)

8. **`lastMergedAt` could reprocess LLM-dropped PRs** → redefined as a watermark
   over *every evaluated PR* (including ones the LLM dropped); a run that fetches
   candidates but keeps none commits a watermark-only update so they are not
   re-evaluated.
9. **Notification needs GitHub secrets** → `changelog-notify.yml` requires
   `RESEND_API_KEY` + `ALERT_EMAIL` as GitHub repo secrets (the Supabase env
   values are not visible to Actions).
10. **Stray closing code fence** → removed.

## Open Questions

None — all resolved during brainstorming and the review pass.
