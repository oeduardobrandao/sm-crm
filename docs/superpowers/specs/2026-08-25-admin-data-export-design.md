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

### Owner determinism (shared fix)

`workspace_members` only constrains `UNIQUE(user_id, workspace_id)` —
nothing stops two different users from both holding `role = 'owner'` on
the same workspace, and `manage-workspace-user` explicitly allows an
existing owner to promote another member to `'owner'`
(`supabase/functions/manage-workspace-user/index.ts`, the `update-role`
branch only blocks a *non-owner* from assigning the role — an owner
assigning it to someone else is allowed, so a workspace can end up with
more than one). The existing `admin_list_workspaces` RPC already has to
pick one "the owner" for its `own` LATERAL subquery, and does so with an
**unordered `LIMIT 1`** — Postgres gives no guarantee which row that
returns when more than one matches.

This export work introduces a second, independent "pick the owner" query
(`fetchOwnerContacts`, below) for the MRR/Trials path. Without a shared
rule, the two paths could report a *different* owner for the same
workspace — actively confusing once both are visible side-by-side in
spreadsheets. So this spec defines ownership resolution once and applies
it to both:

> **The workspace owner, for admin purposes, is the `owner`-role member
> with the earliest `joined_at` (ties broken by `user_id`).** A workspace
> with zero `owner`-role rows has no owner: contact fields are blank, not
> an error. This does not change who *is* an owner in the product (all
> owner-role members keep full owner permissions) — it only defines which
> one single-owner UI/exports display when more than one exists.

Applying this requires a small migration
(`supabase/migrations/20260825000001_admin_list_workspaces_deterministic_owner.sql`,
exact version number reverified against `main`'s migration tail at PR
time to avoid a collision) that adds `ORDER BY m.joined_at ASC, m.user_id
ASC` to the `own` LATERAL subquery's `LIMIT 1` in `admin_list_workspaces`
— a `CREATE OR REPLACE FUNCTION`, following the same pattern as the
existing `20260810000001`/`20260810000002`/`20260811000005` follow-ups to
this same function. `fetchOwnerContacts` (below) uses the identical
tie-break in its own query, so both paths now agree.

### MRR / Trials export — backend enrichment + frontend button

`get-mrr` and `get-trials` (handled inline in
`supabase/functions/platform-admin/index.ts` today) return workspace name
and billing info, but never fetch owner contact. This is also the
opportunity to extract them the way `list-workspaces.ts` and
`event-history.ts` already were: `handleGetMrr` and `handleGetTrials` move
to a new `supabase/functions/platform-admin/mrr.ts` (exported, `index.ts`
just calls them), because their new owner-enrichment behavior needs to be
unit-testable the same way `handleListWorkspaces` already is — inline,
un-exported handlers in `index.ts` aren't reachable from the test suite
without going through the full `Deno.serve` request cycle, and none of
the existing tests do that for these two.

Add:

- `supabase/functions/platform-admin/owner-contact.ts` — exports
  `fetchOwnerContacts(svc, workspaceIds: string[]): Promise<Map<string, { name: string; email: string; telefone: string | null; marketing_opt_in: boolean }>>`.
  Implementation:
  1. One query: `workspace_members` rows with `role = 'owner'` and
     `workspace_id IN (...)`, applying the shared tie-break defined above
     (`ORDER BY joined_at ASC, user_id ASC`, first row per `workspace_id`
     kept). A workspace with no owner-role row simply gets no entry in the
     returned map; callers must treat a missing map entry the same as
     `WorkspaceSummary.owner === null` elsewhere: blank contact columns,
     not an error.
  2. One batch query: `profiles` (`nome`, `telefone`, `marketing_opt_in`)
     for the resolved owner user IDs.
  3. Email resolution via `svc.auth.admin.getUserById`, one call per user
     ID — this can't be batched (the Admin API has no bulk-by-ids lookup).
     Run in bounded concurrent batches of 8
     (`for (i = 0; i < ids.length; i += 8) await Promise.all(batch.map(fetchOne))`),
     exactly mirroring the loop shape in
     `supabase/functions/platform-admin/pricing.ts`'s `priceSubscriptionRows`.
     Critically, mirror the *whole* mechanism, not just the batching: each
     `fetchOne` wraps its `getUserById` + `withTimeout` call in its own
     internal `try/catch` (exactly like `pricing.ts`'s `liveFetch`) so that
     a rejected or timed-out call is swallowed **inside** the task and
     resolves to a fallback (`email: null`) — it does not reject the
     `Promise.all` for that batch. A bare `Promise.all` over tasks that can
     themselves reject would fail the *entire batch* (including sibling
     lookups that already succeeded) on one bad network call, which
     directly contradicts the row-level fallback promised below; the fix
     is the internal try/catch, not switching to `Promise.allSettled`
     (keeping the same idiom the codebase already uses for this exact
     problem).
  - Failure handling has two tiers: the two batch queries (steps 1 and 2)
    are structural — either fails the whole `fetchOwnerContacts` call
    (propagates as the existing generic 500 from `get-mrr`/`get-trials`,
    same as any other `if (error) throw error` in this file). A single
    `getUserById` call failing or timing out is row-level, per the
    try/catch above — that one workspace's contact resolves to `null`
    email (falling back to whatever `profiles` had for name/telefone)
    rather than aborting the batch.
- `handleGetMrr` and `handleGetTrials` (now in `mrr.ts`) each call
  `fetchOwnerContacts` once for all workspace IDs in their result and
  attach `owner_name`, `owner_email`, `owner_telefone`,
  `owner_marketing_opt_in` to every row before returning.
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
    input, not a safe optimization. This is not a new pattern for this
    repo: `apps/crm/src/pages/importar/components/StepCommit.tsx` already
    has a `csvCell()` doing the identical `/^[=+\-@]/` → leading-`'`
    mitigation for the CRM's failed-rows-download CSV. `sanitizeCell()`
    mirrors that existing convention (admin's version additionally treats
    a leading tab/CR as risky, per the broader OWASP CSV-injection
    character set) rather than inventing a new one.
- `downloadCSV(filename: string, csvText: string): void` — `Blob` +
  temporary `<a download>` + `URL.createObjectURL`/delayed
  `revokeObjectURL`, matching the existing download pattern in
  `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`.

### Page wiring

- **`WorkspacesPage.tsx`** — "Export CSV" button next to the search/plan
  filter row. Columns: workspace name, owner name, owner email, owner
  telefone, owner marketing opt-in, plan name, subscription status,
  billing interval, subscription amount, **monthly amount** (normalized,
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
blur that distinction.** `WorkspaceSummary.subscription.amount_cents` is
the *raw* amount for whatever `billing_interval` that workspace is on —
confirmed against its column comment in
`supabase/migrations/20260730000007_subscription_amount_mirror.sql`:
"Net amount the customer pays per billing interval." An annual
subscription's `amount_cents` is the annual lump sum (e.g. `180000` for a
R$1,800/year plan), exactly as the on-screen table shows it paired with an
`intervalSuffix` (e.g. "/ano"). Exporting that number under a column
called "Monthly Amount" — or dividing it by 100 without checking the
interval — would silently overstate every annual workspace's monthly
figure by roughly 12x.

So the Workspaces export carries all three pieces rather than collapsing
them: **Billing Interval**, **Subscription Amount** (the raw per-interval
charge, decimal reais), and **Monthly Amount** (normalized). All three
read from `subscription.interval` / `subscription.amount_cents` — the
`SubscriptionSummary` type (`apps/admin/src/lib/subscription.ts`) exposes
both `billing_interval` (the workspace's nominal billing cycle) and
`interval` (`amount_interval ?? billing_interval` — the interval that
`amount_cents` is actually denominated in, per the "may differ from
billing_interval" column comment on `amount_interval`). The on-screen
table already pairs `amount_cents` with `interval`, not `billing_interval`
(`intervalSuffix(ws.subscription.interval)` in `WorkspacesPage.tsx`), so
the export's Billing Interval column and its normalization both key off
`interval` too — using `billing_interval` instead would silently mismatch
the amount on the rare row where the two diverge. The normalization uses
the exact same rule as
`toMonthlyCents` in `supabase/functions/_shared/billing-logic.ts`
(`interval === "year" ? Math.round(amountCents / 12) : amountCents`,
applied before the cents→reais conversion, so the rounding happens on
integer cents rather than on floating-point reais). That module is a Deno
edge-function file and can't be imported into the Vite-built admin
frontend directly, so this is a deliberate small duplication of a
one-line pure function, not a missed reuse opportunity — the spec calls
it out explicitly so the two copies are kept in sync if the rounding rule
ever changes. `PayingWorkspace.monthly_cents` and
`TrialWorkspace.monthly_cents` don't need this treatment: they already
come out of `aggregateMrr`/`toMonthlyCents` normalized server-side (per
their existing doc comments in `api.ts`), so those two exports' "Monthly
Amount (R$)" column is a direct pass-through, no client-side math needed.

All monetary values, in every column above, are decimal reais (e.g.
`150.00`, converted from the API's `_cents` integers by dividing by 100),
not raw cents.

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

- `apps/admin/src/lib/__tests__/csv-export.test.ts` (Vitest):
  - Generic serializer: comma/quote/newline escaping, BOM presence, header
    row, empty-input behavior.
  - `sanitizeCell()`: neutralizes values starting with `=`/`+`/`-`/`@`/
    tab/CR; leaves a value that merely *contains* (but doesn't start with)
    one of those characters alone; matches the existing `csvCell()`
    fixture cases from `apps/crm/src/pages/importar/components/StepCommit.tsx`
    for the shared character set, so the two don't quietly drift apart.
  - The row-mapping functions that build each export's columns (not just
    the generic serializer): a fixture annual `WorkspaceSummary`
    (`billing_interval: "year"`, e.g. `amount_cents: 180001` — an odd
    value specifically to pin the `Math.round` behavior) asserts
    "Subscription Amount" = `1800.01` and "Monthly Amount" = `150.00`
    (`round(180001/12) = 15000` cents), not `1800.01` copied into both
    columns. A monthly-interval fixture asserts both columns come out
    equal. A `owner: null` fixture asserts blank contact/consent cells,
    not a thrown error or the literal string `"null"`.
- `supabase/functions/__tests__/platform-admin-owner-contact_test.ts`
  (Deno) — unit tests for `fetchOwnerContacts` in isolation: the owner
  tie-break (earliest `joined_at`, then `user_id`) when a workspace has
  two `owner`-role rows, a workspace with none (no map entry, not a
  thrown error), bounded-batch concurrency never exceeding the configured
  limit, a single `getUserById` rejection/timeout only blanking that one
  row's email while sibling lookups in the same batch still resolve
  (proving the internal try/catch, not just the batching, is in place),
  and a `workspace_members`/`profiles` query failure propagating instead
  of being swallowed.
- `supabase/functions/__tests__/platform-admin-mrr_test.ts` (Deno) — new
  file for the extracted `handleGetMrr`/`handleGetTrials`, covering the
  behavior the unit tests above can't: that the handler actually calls
  `fetchOwnerContacts` and merges `owner_name`/`owner_email`/
  `owner_telefone`/`owner_marketing_opt_in` onto each returned row (a
  mocked `fetchOwnerContacts` plus a fixture `svc` is enough — this test
  is about the wiring, not re-testing the lookup logic itself).
- A new pgTAP case under `supabase/tests/entitlements/` (the existing
  `platform-admin-list-workspaces_test.ts` mocks `svc.rpc(...)` entirely
  and never touches real SQL, so it cannot exercise the RPC's `ORDER BY`
  change) — seeds a workspace with two `owner`-role `workspace_members`
  rows at different `joined_at` times and asserts `admin_list_workspaces`'s
  `owner` JSON reflects the earlier one, pinning the same tie-break the
  `owner-contact` unit test above pins for the other code path.
- No new component/integration tests for the two page buttons — they are
  thin JSX wiring over already-unit-tested pieces (the API layer, the CSV
  utility, and the row-mapping functions above). Verified by hand in the
  browser instead, consistent with how the rest of
  `WorkspacesPage`/`DashboardPage` is tested today.
