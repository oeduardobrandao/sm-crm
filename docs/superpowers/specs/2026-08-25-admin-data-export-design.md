# Admin portal data export

## Problem

The Admin app (`apps/admin`) has no way to get data out of it. An admin who
wants to work with workspace or revenue data in a spreadsheet (finance
review, outreach lists, churn/trial follow-up) has to copy it out of the UI
by hand.

## Scope

Two exports, both as CSV, both triggered by an "Export CSV" button/link
placed next to the relevant table:

1. **Workspaces list** (`WorkspacesPage`) — the full workspace roster,
   respecting whatever search/plan filter is currently applied.
2. **MRR / Trials breakdown** (`DashboardPage`) — the "Paying Workspaces"
   and "Trials" cards, exported independently.

Both exports must include workspace-owner contact info (name, email,
phone) so the output is usable for outreach, not just internal analysis.
Because this data is used for outreach, both exports also include the
owner's `marketing_opt_in` flag (already collected today, surfaced
unrestricted in `WorkspaceSummary.owner` and on `WorkspaceDetailPage`) as
its own column — this CSV is not itself a marketing list, and a recipient
whose flag is `false` must not be added to marketing sends. The flag
travels with the row specifically so that downstream use can respect it.

Out of scope: exporting Admins, Plans, Banners, KB Articles, or a single
workspace's detail page. Only the two data sets above.

## Architecture

### Workspaces export — frontend-only, batched

`listWorkspaces({ search, plan_id, offset, limit })` (in
`apps/admin/src/lib/api.ts`) forwards straight through to the
`admin_list_workspaces` Postgres RPC, which has no server-side cap on
`p_limit` — but it is not a cheap query to run unbounded. Per row it runs
two correlated-subquery counts (members, clients), an overrides `EXISTS`
check, an owner lookup, a subscription lookup, and a `LATERAL` call to
`admin_workspace_last_activity`, which is itself a 7-source `GREATEST(...)`
aggregation (`workflow_posts`, `designs`, `clientes`, `contratos`,
`briefings`, `audit_log`, `instagram_accounts`) per workspace. A single
call with `limit: 100000` would run all of that, for the platform's entire
matching workspace count, in one unpaginated request — a real timeout/DB-load
risk, not just an unlikely edge case.

Instead, the export fetches in pages of 200 (same shape as normal
browsing, just automated), looping `offset += 200` until the filtered
`total` is reached, and caps at **10 pages / 2,000 rows**. If the filtered
set is larger, it exports the first 2,000 (the table's own sort, newest
first) and shows `toast.error` with: `"Exported the first 2,000 of
<total> matching workspaces — narrow your search or plan filter to export
the rest."` This bounds worst-case backend load to at most 2,000 rows'
worth of per-row subqueries regardless of platform size. The response's
`owner: { name, email, telefone, marketing_opt_in }` already carries
contact info, so no backend change is needed for this export.

### MRR / Trials export — backend enrichment + frontend button

`get-mrr` and `get-trials` (handled in
`supabase/functions/platform-admin/index.ts`) return workspace name and
billing info today, but never fetch owner contact. Add:

- `supabase/functions/platform-admin/owner-contact.ts` — exports
  `fetchOwnerContacts(svc, workspaceIds: string[]): Promise<Map<string, { name: string; email: string; telefone: string | null; marketing_opt_in: boolean }>>`.
  Implementation:
  1. One query: `workspace_members` rows with `role = 'owner'` and
     `workspace_id IN (...)`, ordered by `joined_at ASC`, keeping only the
     first row per `workspace_id` client-side. This is the same
     "earliest owner wins" tie-break needed because — like the existing
     `admin_list_workspaces` RPC's unordered `LIMIT 1` — nothing in the
     schema guarantees exactly one `owner`-role member per workspace. A
     workspace with no owner-role row simply gets no entry in the returned
     map; callers must treat a missing map entry the same as
     `WorkspaceSummary.owner === null` elsewhere: blank contact columns,
     not an error.
  2. One batch query: `profiles` (`nome`, `telefone`, `marketing_opt_in`)
     for the resolved owner user IDs.
  3. Email resolution via `svc.auth.admin.getUserById`, one call per user
     ID — this can't be batched (the Admin API has no bulk-by-ids lookup)
     — run in **bounded concurrent batches of 8 with a per-call timeout**,
     mirroring the existing `STRIPE_CONCURRENCY` / `withTimeout` pattern in
     `supabase/functions/platform-admin/pricing.ts`, not an unbounded
     `Promise.all`. `get-mrr`/`get-trials` can return an unbounded number
     of matching subscriptions as the platform grows, so the same
     rate-limit/timeout risk that pattern already guards against for
     Stripe applies here to the Auth Admin API.
  - Failure handling has two tiers: the two batch queries (step 1 and 2)
    are structural — either fails the whole `fetchOwnerContacts` call
    (propagates as the existing generic 500 from `get-mrr`/`get-trials`,
    same as any other `if (error) throw error` in this file). A single
    `getUserById` call failing or timing out is row-level — that one
    workspace's contact resolves to `null` email (falling back to
    whatever `profiles` had) rather than aborting the batch.
- `handleGetMrr` and `handleGetTrials` each call `fetchOwnerContacts` once
  for all workspace IDs in their result and attach `owner_name`,
  `owner_email`, `owner_telefone`, `owner_marketing_opt_in` to every row
  before returning.
- `PayingWorkspace` and `TrialWorkspace` in `apps/admin/src/lib/api.ts` gain
  those four optional/nullable fields.

Owner contact is API-only enrichment — it is **not** added as a visible
column on the Dashboard's on-screen tables, only surfaced in the CSV
export, since the request was for an export capability, not a Dashboard
redesign.

### Shared CSV utility

New `apps/admin/src/lib/csv-export.ts`:

- `toCSV(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string` —
  RFC 4180 serialization: quotes any field containing a comma, quote, or
  newline; doubles embedded quotes; `\r\n` line endings; UTF-8 BOM prefix
  (Excel-friendly). Mirrors the parsing conventions already implemented in
  the CRM's `apps/crm/src/lib/csv.ts` (that file only parses; this adds the
  missing serialize direction, admin-side only — the two apps do not share
  a CSV module today).
  - **Formula-injection neutralization**: every exported string value goes
    through `sanitizeCell()` before quoting — if it starts with `=`, `+`,
    `-`, `@`, tab, or CR, prefix it with a leading `'`. Excel/Sheets treat
    a leading `'` as "force text", so a value like a workspace or owner
    name that happens to start with one of those characters can never be
    interpreted as a formula when the file is opened. This applies to
    every string column uniformly, not just the columns judged risky today
    — workspace name and owner name/email are user-supplied at signup, so
    excluding a column from sanitization is a bug waiting for the right
    input, not a safe optimization.
- `downloadCSV(filename: string, csvText: string): void` — `Blob` +
  temporary `<a download>` + `URL.createObjectURL`/delayed
  `revokeObjectURL`, matching the existing download pattern in
  `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`.

### Page wiring

- **`WorkspacesPage.tsx`** — "Export CSV" button next to the search/plan
  filter row. Columns: workspace name, owner name, owner email, owner
  telefone, owner marketing opt-in, plan name, subscription status,
  **subscription amount, billing interval** (kept as two separate columns,
  see note below), discount label, client count, member count, has
  overrides (yes/no), created date, last activity date. Filename
  `workspaces-YYYY-MM-DD.csv`.
- **`DashboardPage.tsx`** — an "Export CSV" link in each of the "Paying
  Workspaces" and "Trials" card headers, built from the array already held
  in React Query state (`mrrData.workspaces` / `trialsData.trials`) — no
  extra network call at click time.
  - Paying Workspaces columns: workspace name, owner name/email/telefone/
    marketing opt-in, plan name, status, interval, **monthly amount**,
    discount label, amount source. Filename
    `paying-workspaces-YYYY-MM-DD.csv`.
  - Trials columns: workspace name, owner name/email/telefone/marketing
    opt-in, plan name, interval, trial-ends date, **expected monthly
    amount**. Filename `trials-YYYY-MM-DD.csv`.

**Monetary columns are not all the same shape, and the export must not
blur that distinction.** `PayingWorkspace.monthly_cents` and
`TrialWorkspace.monthly_cents` are already normalized to a monthly
figure (annual subscriptions divided down), per their existing doc
comments in `api.ts` — those two exports get a column genuinely called
"Monthly Amount (R$)". `WorkspaceSummary.subscription.amount_cents`,
by contrast, is the raw amount for whatever `billing_interval` that
workspace is on — an annual subscription's `amount_cents` is the annual
lump sum, exactly as the on-screen table shows it paired with an
`intervalSuffix` (e.g. "/ano"). The Workspaces export mirrors that: a
"Subscription Amount (R$)" column plus a separate "Billing Interval"
column (`month`/`year`), never labeled "monthly" — relabeling it without
also converting annual amounts down would misstate every annual
workspace's row, and doing that conversion here would duplicate the MRR
endpoint's normalization logic for a page whose job is to mirror the
Workspaces table, not compute MRR. All monetary values, whichever column,
are decimal reais (e.g. `150.00`, converted from the API's `_cents`
integers by dividing by 100), not raw cents.

All date columns (created, last activity, trial-ends) are plain ISO 8601
dates (`YYYY-MM-DD`), not the locale-formatted strings the UI shows, so
the column sorts and filters correctly in a spreadsheet.

## Error handling

- Workspaces export: the paging loop is wrapped in try/catch; a fetch
  failure on any page shows a `sonner` `toast.error` and discards the
  partial result rather than downloading a silently-truncated file for a
  reason other than the documented 2,000-row cap. A 0-row result (filters
  matched nothing) skips the download and toasts "Nothing to export".
  Hitting the 2,000-row cap is not an error — see the toast text in the
  Architecture section above — the file still downloads.
- MRR/Trials export: data is already in memory from the page's
  `useQuery`, so the export itself is synchronous — same empty-array guard,
  no network error path to handle.
- `fetchOwnerContacts`: two failure tiers, per the Architecture section —
  the bulk `workspace_members`/`profiles` queries are structural (any
  error propagates and fails the whole `get-mrr`/`get-trials` request,
  same as every other query in this file), while a single `getUserById`
  call failing or timing out only blanks that one workspace's email,
  matching the existing tolerant style of `handleGetWorkspace`'s member
  enrichment.

## Testing

- `apps/admin/src/lib/__tests__/csv-export.test.ts` (Vitest) — comma/quote/
  newline escaping, BOM presence, header row, empty-input behavior, and
  `sanitizeCell()` neutralizing values starting with `=`/`+`/`-`/`@`/tab/CR
  (including that a value merely containing, but not starting with, one of
  those characters is left alone).
- `supabase/functions/__tests__/platform-admin-owner-contact_test.ts`
  (Deno) — new file alongside the existing `platform-admin-list-workspaces_test.ts`,
  covering: the owner tie-break when a workspace has more than one
  `owner`-role row, a workspace with none, bounded-batch concurrency not
  exceeding the configured limit, a single `getUserById` timeout/failure
  only blanking that row, and a `workspace_members`/`profiles` query
  failure propagating instead of being swallowed.
- No new component/integration tests for the two page buttons — they are
  thin JSX wiring over already-unit-tested pieces (the API layer, the CSV
  utility). Verified by hand in the browser instead, consistent with how
  the rest of `WorkspacesPage`/`DashboardPage` is tested today.
