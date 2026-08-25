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

Out of scope: exporting Admins, Plans, Banners, KB Articles, or a single
workspace's detail page. Only the two data sets above.

## Architecture

### Workspaces export — frontend-only

`listWorkspaces({ search, plan_id, offset, limit })` (in
`apps/admin/src/lib/api.ts`) already forwards straight through to the
`admin_list_workspaces` Postgres RPC, which has no server-side cap on
`p_limit`. So the export button re-issues that same call with the page's
current `search`/`plan_id` filter, `offset: 0`, and a high `limit` (100000)
to pull every matching row in one request — no backend change needed. The
response's `owner: { name, email, telefone }` already carries contact info.

### MRR / Trials export — backend enrichment + frontend button

`get-mrr` and `get-trials` (handled in
`supabase/functions/platform-admin/index.ts`) return workspace name and
billing info today, but never fetch owner contact. Add:

- `supabase/functions/platform-admin/owner-contact.ts` — exports
  `fetchOwnerContacts(svc, workspaceIds: string[]): Promise<Map<string, { name: string; email: string; telefone: string | null }>>`.
  Implementation: look up the `owner`-role row per workspace in
  `workspace_members`, batch-fetch `profiles` (name, telefone) for those
  user IDs, then resolve email via `svc.auth.admin.getUserById` per user ID
  run concurrently with `Promise.all` (mirrors the existing per-member
  enrichment pattern in `handleGetWorkspace`, just batched and owner-only).
- `handleGetMrr` and `handleGetTrials` each call `fetchOwnerContacts` once
  for all workspace IDs in their result and attach `owner_name`,
  `owner_email`, `owner_telefone` to every row before returning.
- `PayingWorkspace` and `TrialWorkspace` in `apps/admin/src/lib/api.ts` gain
  those three optional/nullable fields.

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
- `downloadCSV(filename: string, csvText: string): void` — `Blob` +
  temporary `<a download>` + `URL.createObjectURL`/delayed
  `revokeObjectURL`, matching the existing download pattern in
  `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`.

### Page wiring

- **`WorkspacesPage.tsx`** — "Export CSV" button next to the search/plan
  filter row. Columns: workspace name, owner name, owner email, owner
  telefone, plan name, subscription status, billing interval, monthly
  amount, discount label, client count, member count, has overrides
  (yes/no), created date, last activity date. Filename
  `workspaces-YYYY-MM-DD.csv`.
- **`DashboardPage.tsx`** — an "Export CSV" link in each of the "Paying
  Workspaces" and "Trials" card headers, built from the array already held
  in React Query state (`mrrData.workspaces` / `trialsData.trials`) — no
  extra network call at click time.
  - Paying Workspaces columns: workspace name, owner name/email/telefone,
    plan name, status, interval, monthly amount, discount label, amount
    source. Filename `paying-workspaces-YYYY-MM-DD.csv`.
  - Trials columns: workspace name, owner name/email/telefone, plan name,
    interval, trial-ends date, expected monthly amount. Filename
    `trials-YYYY-MM-DD.csv`.

All monetary columns above are decimal reais (e.g. `150.00`, converted
from the API's `_cents` integers by dividing by 100), not raw cents — a
spreadsheet user should be able to sum the column directly without a unit
conversion. All date columns (created, last activity, trial-ends) are
plain ISO 8601 dates (`YYYY-MM-DD`), not the locale-formatted strings the
UI shows, so the column sorts and filters correctly in a spreadsheet.

## Error handling

- Workspaces export: wrapped in try/catch; a fetch failure shows a
  `sonner` `toast.error`. A 0-row result (filters matched nothing) skips
  the download and toasts "Nothing to export" instead of producing an
  empty-but-valid file.
- MRR/Trials export: data is already in memory from the page's
  `useQuery`, so the export itself is synchronous — same empty-array guard,
  no network error path to handle.
- `fetchOwnerContacts`: tolerant of partial failure, like the existing
  member-enrichment code in `handleGetWorkspace` — a missing `profiles` row
  or a failed `getUserById` call yields `null`/`"—"` for that one
  workspace's contact fields rather than failing the whole `get-mrr` /
  `get-trials` request.

## Testing

- `apps/admin/src/lib/__tests__/csv-export.test.ts` (Vitest) — comma/quote/
  newline escaping, BOM presence, header row, empty-input behavior.
  Mirrors the style of `apps/crm/src/lib/__tests__/csv.test.ts`.
- `supabase/functions/__tests__/platform-admin-owner-contact_test.ts`
  (Deno) — new file alongside the existing `platform-admin-list-workspaces_test.ts`,
  covering the batch owner lookup and its per-row fallback behavior.
- No new component/integration tests for the two page buttons — they are
  thin JSX wiring over already-unit-tested pieces (the API layer, the CSV
  utility). Verified by hand in the browser instead, consistent with how
  the rest of `WorkspacesPage`/`DashboardPage` is tested today.
