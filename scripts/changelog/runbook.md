# Weekly Changelog Runbook

You are generating the public changelog for Mesaas. Work on a fresh branch off `main`.

1. Fetch candidate PRs (deterministic select is already applied):
   ```bash
   npx tsx scripts/changelog/fetch.ts > /tmp/changelog-fetch.json
   ```
   Read `/tmp/changelog-fetch.json`: `selected` is the PRs to write up; `batchMaxMergedAt`
   is the new watermark.

2. If `selected` is empty, STOP — do nothing, open no PR.

3. For each PR in `selected`, write one entry aimed at customers (NOT raw commit text):
   - `type`: `feature` (new capability), `improvement` (better/faster existing thing —
     `perf`/`refactor`-with-user-impact usually map here), or `fix` (bug fix users noticed).
   - `area`: product area in Portuguese (Entregas, Analytics, Clientes, Hub, …).
   - `title` + `description`: friendly Brazilian Portuguese, benefit-oriented, no filenames,
     no internal jargon, no security-sensitive details.
   - The changelog is for customers using the CRM and the Hub. NEVER write up internal
     admin-portal / platform-admin work (the `apps/admin` app): per-workspace Stripe
     subscription visibility, plan/price ID editing, comp/un-comp controls, etc. Watch for
     mixed PRs whose title is scoped to something else (e.g. `feat(billing): … + admin …`) —
     keep only the customer-facing half and drop the admin half entirely.
   - Drop fixes a customer would not notice. If you drop ALL of them, still proceed to step 5
     with `release` omitted so the watermark advances.

4. Self-review every entry: accurate to the PR? plain language? not a duplicate of an entry
   already in `apps/crm/src/content/changelog.json`?

5. Write `/tmp/changelog-entries.json`:
   ```json
   {
     "batchMaxMergedAt": "<copy from fetch output>",
     "release": { "date": "<today YYYY-MM-DD>", "summary": "<1 line, optional>", "items": [ ... ] }
   }
   ```
   Omit `release` entirely if every PR was dropped.

6. Apply, then verify locally:
   ```bash
   npx tsx scripts/changelog/apply.ts /tmp/changelog-entries.json
   npx vitest run apps/crm/src/content/__tests__/changelog.test.ts
   ```

7. Open an auto-merging PR (CI gates it; no human review):
   ```bash
   git switch -c chore/changelog-$(date +%F)
   git add apps/crm/src/content/changelog.json
   git commit -m "chore(changelog): weekly update"
   gh pr create --base main --title "chore(changelog): weekly update" --body "Automated weekly changelog."
   gh pr merge --auto --squash
   ```
