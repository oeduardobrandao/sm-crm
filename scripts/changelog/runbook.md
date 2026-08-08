# Weekly Changelog Runbook

You are generating the public changelog for Mesaas. Work on a fresh branch off `main`.

1. Fetch candidate PRs (deterministic select is already applied):
   ```bash
   npx tsx scripts/changelog/fetch.ts > /tmp/changelog-fetch.json
   ```
   Read `/tmp/changelog-fetch.json`: `selected` is the PRs to write up; `batchMaxMergedAt`
   is the new watermark.

2. If `selected` is empty, STOP — do nothing, open no PR.

3. Group the selected PRs by the ISO week they merged in (that's what
   `scripts/changelog/write-entries.ts` does automatically). Each week becomes one release
   block dated by its last merge. For each PR, write one entry aimed at customers (NOT raw
   commit text):
   - `type`: `feature` (new capability), `improvement` (better/faster existing thing —
     `perf`/`refactor`-with-user-impact usually map here), or `fix` (bug fix users noticed).
   - `area`: product area in Portuguese (Entregas, Analytics, Clientes, Hub, …).
   - `title` + `description`: friendly Brazilian Portuguese, benefit-oriented, no filenames,
     no internal jargon, no security-sensitive details. Never use em/en dashes (— –) in the
     copy — a test on `changelog.json` enforces this; use colon, comma, or a period.
   - `link` (optional): `{ "href": "<route>", "label": "<label>" }` pointing the reader at
     the feature. Both MUST come from `LINK_CATALOG` in
     `apps/crm/src/content/changelog.logic.ts` — never invent routes or labels.
   - The changelog is for customers using the CRM and the Hub. NEVER write up internal
     admin-portal / platform-admin work (the `apps/admin` app): per-workspace Stripe
     subscription visibility, plan/price ID editing, comp/un-comp controls, etc. Watch for
     mixed PRs whose title is scoped to something else (e.g. `feat(billing): … + admin …`) —
     keep only the customer-facing half and drop the admin half entirely.
   - Drop fixes a customer would not notice. If you drop ALL of them, still proceed to step 5
     with `releases` omitted so the watermark advances.
   - The reader is an EXISTING customer. Drop acquisition/signup-funnel work (free trial,
     signup flow, SEO, blog, landing pages) and features not yet enabled for customers
     (behind a feature flag or shown as "em breve") — announcing something readers cannot
     see or use only erodes trust in the page.

4. Self-review every entry: accurate to the PR? plain language? not a duplicate of an entry
   already in `apps/crm/src/content/changelog.json`?

5. Write `/tmp/changelog-entries.json`:
   ```json
   {
     "batchMaxMergedAt": "<copy from fetch output>",
     "releases": [
       { "date": "<last merge date of that week, YYYY-MM-DD>", "summary": "<1 line, optional>", "items": [ ... ] }
     ]
   }
   ```
   Omit `releases` entirely if every PR was dropped. (The legacy single-object `release`
   key is still accepted.)

6. Apply, then verify locally:
   ```bash
   npx tsx scripts/changelog/apply.ts /tmp/changelog-entries.json
   npx vitest run apps/crm/src/content/__tests__/changelog.test.ts
   ```
   `apply.ts` also attaches screenshots automatically: if `public/novidades/pr-<n>.png`
   (or `.jpg`/`.jpeg`/`.webp`) exists for an entry's PR number, the entry gets
   `image: "/novidades/pr-<n>.<ext>"`. To ship a screenshot with a feature, commit the
   file under that name in the feature PR itself (lowercase filename; the schema enforces
   the `/novidades/` prefix).

7. Open the PR and gate the merge on CI. Do NOT use `gh pr merge --auto`: GitHub
   auto-merge requires branch protection rules on `main`, which this repo does not have,
   so the call fails with "Protected branch rules not configured for this branch".
   Watch the checks and merge only when they pass:
   ```bash
   git switch -c chore/changelog-$(date +%F)
   git add apps/crm/src/content/changelog.json
   git commit -m "chore(changelog): weekly update"
   gh pr create --base main --title "chore(changelog): weekly update" --body "Automated weekly changelog."
   gh pr checks --watch --fail-fast && gh pr merge --squash --delete-branch
   ```
