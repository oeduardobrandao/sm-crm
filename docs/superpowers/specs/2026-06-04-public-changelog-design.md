# Public Auto-Generated Changelog ("Novidades")

> **Status:** Design approved 2026-06-04. Next step: implementation plan via `superpowers:writing-plans`.

## Overview

A **public, auto-generated changelog** at `/novidades` that doubles as a feature
showcase. A scheduled agent runs **weekly**, reads the PRs merged since the last
entry, writes benefit-oriented Portuguese release notes, and publishes them
**hands-off** (no human approval gate). The page is reachable by logged-out
visitors and is linked from both the landing page and the logged-in app.

## Goals

- Customers (and prospects on the landing page) can see what shipped, in plain
  Portuguese, without anyone manually writing release notes.
- Fully automatic: new entries appear weekly with no human in the loop.
- Public and SEO-friendly — works for non-authenticated visitors and doubles as
  a "what does this app do" feature list.
- Safe despite being unreviewed: CI still gates, everything is git-revertable,
  and the owner is notified of every publish.

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
  prospects, since the page is public and linked from the landing page.
- **Surfaces:**
  - Public route `/novidades` (no auth).
  - Link on the landing page (`LandingPage.tsx`).
  - Link inside the logged-in app (user dropdown, near the help link).

## Content Model & Storage

Single version-controlled file, bundled at build time (static = fast,
SEO-friendly, no DB / no RLS): `apps/crm/src/content/changelog.json`.

Releases are stored newest-first. Shape:

```jsonc
{
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
          "pr": 93                          // source PR number, for traceability
        }
      ]
    }
  ]
}
```

- `type` renders as a badge: **Novo** (feature) / **Melhoria** (improvement) /
  **Correção** (fix).
- `pr` is kept for traceability; not necessarily shown in the UI.
- A **zod schema** validates the file shape; the generator validates generated
  content against it before writing.

## Public Page & Routing

- Add route `/novidades` to the **public** block in `apps/crm/src/App.tsx`
  (alongside `/`, `/login`, `/politica-de-privacidade`, etc.) — explicitly
  **outside** `ProtectedRoute`. Note: the existing `/ajuda` route is login-only;
  this one must not be.
- New page: `apps/crm/src/pages/novidades/NovidadesPage.tsx`.
  - Reverse-chronological list grouped by release date.
  - Each item: type badge + area tag + title + description.
  - Uses the existing design system (Ant Design tokens + CSS variables).
  - Reads `changelog.json` via direct import (static bundle).
- Links:
  - Landing page (`LandingPage.tsx`) — nav and/or footer link to `/novidades`.
  - Logged-in app — link in the user dropdown, near the help link.
  - (Exact placement is an implementation detail.)

## Generation Agent

Runs in the repository with `git` + `gh` available (both confirmed working;
remote: `github.com/oeduardobrandao/sm-crm`). Flow:

1. **Cutoff** — read `changelog.json`; the cutoff date is the `date` of the
   newest release block (or "last 7 days" if the file is empty). Self-contained;
   no external state to track.
2. **Fetch** — `gh pr list --state merged --search "merged:>=<cutoff>"` with
   `--json number,title,body,labels,mergedAt`.
3. **Deterministic prefilter** (pure code) — drop PRs whose conventional-commit
   title prefix is in `{ci, chore, style, test, docs, build, refactor}`; keep
   `feat` and `fix`. Guarantees noise never reaches the model.
4. **Write** (LLM) — for each kept PR: classify `type` and `area`, drop fixes a
   customer would not notice, and write a friendly Portuguese `title` +
   `description` aimed at users (benefit-oriented, not raw commit text).
5. **Self-review** (LLM) against a rubric: accurate to the PR; no internal
   jargon / filenames; no security-sensitive details; no duplicates of entries
   already in `changelog.json`.
6. **Prepend** the new dated release block to `changelog.json`, validated
   against the zod schema before writing.

### Pure / testable split

The mechanical parts live as **pure functions** in `scripts/changelog/`
(mirroring the `pool.ts` pure-module pattern used elsewhere in the repo), so
they can be unit-tested without invoking the agent or the network:

- `cutoffFromChangelog(changelog) -> isoDate`
- `selectPRs(prs) -> prs` (the deterministic prefilter)
- `prependRelease(changelog, release) -> changelog` (idempotent)

The agent orchestrates: run the fetch, call the LLM to write + self-review,
validate, write the file, open the PR.

## Publishing — "Auto-Publish" Without Losing CI

Hands-off, but CI still guards quality:

1. Agent creates a branch (e.g. `chore/changelog-YYYY-MM-DD`), commits the
   `changelog.json` change, and opens a PR.
2. Agent enables **auto-merge (squash)** on the PR.
3. The existing backpressure-gate CI runs. Once green, the PR merges **itself** —
   no human review.
4. Vercel deploys on merge → the new entries are live on `/novidades`.

If no PRs qualify that week, the agent does nothing (no empty PR).

> This is the one refinement to the raw "auto-publish" choice: it routes through
> an auto-merging PR so CI still runs, rather than committing straight to `main`.
> Confirmed acceptable by the owner.

## Non-Blocking Safeguards

Unreviewed copy lands on a public page, so three guards that add **zero** human
steps:

1. **Post-publish notification** via the existing Resend pattern
   (`alertas@mesaas.com.br`): after the PR merges, send a summary email listing
   the published entries and a link, so the owner always knows what went out and
   can revert. (Confirmed wanted.)
2. **Full git revertability** — every publish is a squash commit on `main`.
3. **Deterministic prefilter + self-review rubric** — junk never reaches the
   model; the model double-checks its own output before writing.

## Scheduling

A **weekly scheduled remote agent (routine)** runs the generation flow — native
to the existing Claude Code workflow, no CI wiring required. The generation
instructions are captured as a repeatable runbook/command the routine executes.

Alternative considered: a GitHub Actions cron running Claude Code headless.
Start with the routine; the GH Action remains an option if cloud routines prove
limiting.

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/crm/src/content/changelog.json` | The changelog data (source of truth) |
| Create | `apps/crm/src/content/changelog.schema.ts` | Zod schema + types for entries |
| Create | `apps/crm/src/pages/novidades/NovidadesPage.tsx` | Public changelog page |
| Modify | `apps/crm/src/App.tsx` | Add public `/novidades` route |
| Modify | `apps/crm/src/pages/landing/LandingPage.tsx` | Link to `/novidades` |
| Modify | logged-in nav (user dropdown) | Link to `/novidades` |
| Create | `scripts/changelog/select.ts` | Pure: cutoff + PR prefilter |
| Create | `scripts/changelog/prepend.ts` | Pure: idempotent release prepend |
| Create | `scripts/changelog/runbook.md` | Agent generation instructions |
| Create | `scripts/changelog/__tests__/...` | Unit tests for pure functions |

## Testing

- Unit tests for `cutoffFromChangelog`, `selectPRs` (prefilter rules), and
  `prependRelease` (idempotency: re-running with overlapping PRs does not
  duplicate entries).
- Zod schema validation tests (reject malformed entries).
- A render test for `NovidadesPage` with sample data (badges, grouping, empty
  state).

## Open Questions

None — all design decisions resolved during brainstorming:

- Audience: public, CRM-customer focused, linked from landing + in-app.
- Cadence: weekly digest.
- Storage: git-native `changelog.json` (no DB).
- Publishing: auto-merge PR after CI (no human gate).
- Notification: Resend email on publish (yes).
