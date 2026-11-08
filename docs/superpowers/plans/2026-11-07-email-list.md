# Lista completa de e-mails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A page in the Admin at `/admin/emails/lista` that lists every row of `email_sends`, with filters and cursor paging. It is opened by a "Ver lista completa" button on the E-mails page.

**Architecture:**
- A new RPC `email_sends_list` (service_role only) does keyset paging on a new index.
- The `platform-admin` action `email-list` validates the input and calls the RPC.
- The new Admin page keeps its filters in the URL and uses `useInfiniteQuery`.
- The E-mails page only gets a `Link` to the new page.

**Tech Stack:** Postgres/plpgsql, Deno edge function, React 19 + TanStack Query + React Router (Admin), Vitest, Deno test, psql suites.

**Spec:** `docs/superpowers/specs/2026-11-07-email-list-design.md`

## Global Constraints

- RPC `SECURITY DEFINER`, `set search_path = public`, `revoke execute ... from public, anon, authenticated`, `grant execute ... to service_role`.
- Migration file `supabase/migrations/20261125000001_email_sends_list.sql`. Before opening the PR, renumber it above main's tail if needed.
- `email_sends_sent_at_idx` is never dropped. The migration only creates `email_sends_sent_at_id_idx on email_sends (sent_at desc, email_id desc)`.
- Errors to the client are generic. Never log raw rpc errors, only the step name (pattern of `email-metrics.ts`).
- Admin copy is in Portuguese with no em-dashes. Use theme tokens only. Icons come from `lucide-react`.
- The E-mails page must not call `email-list`, including no prefetch.
- Dates are São Paulo days, at most 365 days apart. Page size defaults to 50, max 100.
- PII: `bounce_message`, `recipient_masked` and `subject` are null when `sent_at < now() - interval '90 days'`. Mask the recipient as `left(recipient,1) || '***@' || split_part(recipient,'@',2)`. `bounce_type` is always returned.

## Review Focus

1. Paging across rows with identical `sent_at` (microsecond ties): no row repeated or skipped (Task 1 test).
2. A cursor taken from page 1 is reused after the filters change. The client must reset paging whenever the filters change (Task 3 test: changing a filter refetches from page 1).
3. A type from the classifier fallback (`desconhecido`, `alerta_interno`, `notificacao`) is accepted by the edge and appears in the type filter (Task 2 test and Task 3 test).
4. Hand-edited URL params (`preset=xyz`, a bad `start`, an unknown `status`) fall back to defaults and never crash or send an invalid request (Task 3 test).
5. A row older than 90 days with a bounce shows the bounce type but no reason, recipient or subject (Task 1 test).

---

### Task 1: RPC `email_sends_list` + index + psql suite

**Files:**
- Create: `supabase/migrations/20261125000001_email_sends_list.sql`
- Create: `supabase/tests/email_sends_list.sql` (picked up by the `supabase/tests/*.sql` loop in `scripts/test-entitlements.sh`)

**Interfaces:**
- Produces: `email_sends_list(p_start date, p_end date, p_categories text[], p_types text[], p_events text[], p_cursor_sent_at timestamptz, p_cursor_id text, p_limit int) returns jsonb`.
  - It returns `{ items: Item[], next_cursor: {sent_at: text, email_id: text} | null, types: {category, type}[] | null }`.
  - `Item` has `{email_id, sent_at, category, type, last_event, source, bounce_type, bounce_message, recipient_masked, subject}`.
  - `next_cursor.sent_at` is `to_jsonb(sent_at)` of the last returned row, so it keeps microsecond precision.

- [ ] **Step 1: Write the psql suite** (same style as `supabase/tests/email_sends_rpcs.sql`: `\set ON_ERROR_STOP on`, `begin`, `do $$ ... assert ... $$`, `rollback`). Insert rows directly into `email_sends`, then assert:
  - `range_guard`: `p_end < p_start` raises, and `p_end - p_start = 366` raises.
  - `filters`: categories, types and events each narrow the result. Null or empty arrays don't filter.
  - `tie_paging`: 5 rows with the same `sent_at` (sub-ms, e.g. `'2026-11-01 12:00:00.123456+00'`) and `p_limit 2`. Walking `next_cursor` returns all 5 exactly once, in `email_id desc` order, and the last page has `next_cursor` null.
  - `limit_clamp`: `p_limit` 0 → 1 row, 500 → at most 100 rows, null → 50.
  - `pii_90d`: a `bounced` row with `sent_at = now() - 100 days` returns `bounce_type` non-null and `bounce_message`, `recipient_masked` and `subject` null. The same row at `now() - 10 days` returns `recipient_masked = 'a***@b.com'` for `ana@b.com`.
  - `types_first_page`: `types` is non-null when the cursor is null and ignores `p_types` and `p_events`; it is null when a cursor is passed.
  - `grants`: `not has_function_privilege('authenticated', 'public.email_sends_list(date,date,text[],text[],text[],timestamptz,text,int)', 'execute')`.

- [ ] **Step 2: Run it to see it fail** (function missing). Use the local stack per `scripts/test-entitlements.sh`, or `psql` on a bare postgres:15 with the migrations applied.

- [ ] **Step 3: Write the migration.**
  - Date window: `sent_at >= (p_start::timestamp at time zone 'America/Sao_Paulo') and sent_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo')`, the same expressions `email_metrics` uses.
  - Raise `invalid_range` / `range_too_long` exactly like `email_metrics`.
  - Cursor predicate: `(p_cursor_sent_at is null or (sent_at, email_id) < (p_cursor_sent_at, p_cursor_id))`.
  - Fetch `limit+1` rows to decide `next_cursor`.

- [ ] **Step 4: Run the suite to see it pass.** Also re-run `supabase/tests/email_sends_rpcs.sql` (unchanged, must still pass).

- [ ] **Step 5: Commit** both files.

### Task 2: `platform-admin` action `email-list`

**Files:**
- Create: `supabase/functions/platform-admin/email-list.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (add `case "email-list"` next to `email-metrics`, ~line 153)
- Test: `supabase/functions/__tests__/platform-admin-email-list_test.ts`

**Interfaces:**
- Consumes: Task 1's RPC, and `parseEmailMetricsRange` from `./email-metrics.ts`.
- Produces:
  - `parseEmailListInput(body: unknown): EmailListInput | { error: string }`;
  - `handleEmailList(svc: SupabaseClient, body: unknown, headers: Record<string,string>): Promise<Response>`.
  - Request body: `{ start, end, categories?: string[], types?: string[], events?: string[], cursor?: { sent_at: string, email_id: string } | null, limit?: number }`.
  - The response is the RPC jsonb passed through.

- [ ] **Step 1: Write failing tests** for `parseEmailListInput`:
  - valid minimal body → `{start, end, categories: [], types: [], events: [], cursor: null, limit: 50}`;
  - category not in `['notificacoes','ciclo_de_vida','convites','cobranca','relatorios','afiliados','interno','externo','outros']` → `{error:'invalid_filter'}`;
  - `types: ['desconhecido','nurture_a3_b1']` accepted;
  - `types: ['Bad Type']` → `invalid_filter`;
  - an event not in the eight `last_event` values → `invalid_filter`;
  - an array with more than 50 items → `invalid_filter`;
  - a cursor with only one field → `invalid_cursor`;
  - `cursor.sent_at: '2026-11-01T12:00:00.123456+00:00'` is passed through byte-identical (not normalized);
  - `cursor.sent_at: 'garbage'` → `invalid_cursor`;
  - `limit: 0` and `limit: 101` → `invalid_limit`;
  - a bad range → the `parseEmailMetricsRange` error.

  Write `handleEmailList` tests with a stub `svc.rpc`:
  - 400 on invalid input with no rpc call;
  - rpc called with `p_categories: null` when empty (null, not `[]`, for every empty array);
  - an rpc error → 500 `{error:'Internal server error'}`, with the console output not containing the stub's error message.

- [ ] **Step 2: Run** `deno test --no-check -A supabase/functions/__tests__/platform-admin-email-list_test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** Type regex `^[a-z0-9_]{1,64}$`. Cursor `sent_at` regex `^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$`. Cursor `email_id`: a string of 1-128 chars.

- [ ] **Step 4: Run the tests to see them pass,** plus `npm run check:functions`. Afterwards run `git checkout -- deno.lock`, and `npm ci` if `node_modules/.deno` exists.

- [ ] **Step 5: Commit.**

### Task 3: Admin page `/admin/emails/lista` + button

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (types + `getEmailList`)
- Create: `apps/admin/src/pages/emails/email-list-view.ts`
- Create: `apps/admin/src/pages/emails/useEmailList.ts`
- Create: `apps/admin/src/pages/EmailsListPage.tsx`
- Create: `apps/admin/src/pages/emails/EmailsListTable.tsx` and `apps/admin/src/pages/emails/EmailsListPhone.tsx`
- Modify: `apps/admin/src/router.tsx` (child route `emails/lista`, lazy like the other pages)
- Modify: `apps/admin/src/pages/EmailsPage.tsx` (header button)
- Test: `apps/admin/src/pages/emails/__tests__/email-list-view.test.ts`, `apps/admin/src/pages/__tests__/EmailsListPage.test.tsx`, and an extra case in `apps/admin/src/pages/__tests__/EmailsPage.test.tsx`

**Interfaces:**
- Consumes: Task 2's body and response, plus `EMAIL_CATEGORY_LABELS`, `typeLabel`, `categoryLabel`, `presetRange`, `validateCustomRange` and `saoPauloDate` from `email-metrics-view.ts`.
- Produces:
  - in `api.ts`: `getEmailList(params: EmailListParams): Promise<EmailListResponse>`, `EmailListItem`, `EmailListResponse`, and `EmailListCursor = { sent_at: string; email_id: string }`. The cursor is an opaque string, never parsed;
  - in `email-list-view.ts`:
    - `STATUS_GROUPS: { key: StatusGroup; label: string; events: string[]; badge: 'success'|'warning'|'neutral'|'danger' }[]`, in the spec's order and mapping;
    - `statusGroupOf(event): StatusGroup`;
    - `parseListSearch(sp: URLSearchParams, today: Date): ListFilters`, which falls back to `preset 7d` on any invalid preset or date and drops unknown categories or status keys;
    - `listFiltersToSearch(f): URLSearchParams`;
    - `resendEmailUrl(id): string` = `'https://resend.com/emails/' + encodeURIComponent(id)`;
    - `formatSpDateTime(iso): string` → `DD/MM/AAAA HH:mm` in São Paulo, returning `''` on an unparseable input and never throwing.
  - in `useEmailList.ts`: `EMAIL_LIST_KEY = ['admin','email-list']`; `useEmailList(filters)` uses `useInfiniteQuery` with the key `[...EMAIL_LIST_KEY, filters]`, `getNextPageParam` = `next_cursor ?? undefined`, and `types` from page 1.

- [ ] **Step 1: Write failing unit tests** in `email-list-view.test.ts`:
  - `statusGroupOf('suppressed') === 'nao_enviado'`;
  - `statusGroupOf('sent') === 'pendente'`;
  - `parseListSearch` with `preset=xyz` → 7d;
  - `parseListSearch` with `preset=custom&start=2026-02-30&end=2026-03-01` → 7d;
  - `cat=interno,foo` → `['interno']`;
  - `status=bounce,zzz` → `['bounce']`;
  - a round trip through `listFiltersToSearch`;
  - `resendEmailUrl('a/b')` ends with `a%2Fb`;
  - `formatSpDateTime('2026-11-01T12:00:00.123456+00:00') === '01/11/2026 09:00'`;
  - `formatSpDateTime('garbage') === ''`.

- [ ] **Step 2: Write failing page tests** (mock `getEmailList`, MemoryRouter at `/admin/emails/lista?...`; same pattern as `EmailsPage.test.tsx`):
  - it renders rows with the status badge label and a "Ver no Resend" link with `target="_blank"` and `rel` containing `noopener`;
  - "Carregar mais" calls `getEmailList` with the `cursor` of page 1, and it is hidden when `next_cursor` is null;
  - changing the status filter calls `getEmailList` again with no cursor and with the expanded `events`, and updates the URL;
  - the type filter options come from page 1's `types`, including `desconhecido`, labeled through `typeLabel`;
  - with zero items it shows "Nenhum e-mail com esses filtros" and "Limpar filtros";
  - an API error shows `ErrorState` and retries;
  - a Detalhe cell shows `recipient_masked` and `subject` when present and nothing when null.

  In `EmailsPage.test.tsx`:
  - "Ver lista completa" is a link to `/admin/emails/lista?preset=7d`;
  - `getEmailList` is never called on the E-mails page;
  - with an invalid custom range, the link is disabled (`aria-disabled`).

- [ ] **Step 3: Run** `npx vitest run apps/admin/src/pages`. Expected: FAIL.

- [ ] **Step 4: Implement.**
  - The filters bar reuses the `SegmentedControl` and date inputs from `EmailsPage`.
  - Multi-selects are a `DropdownMenu` with `DropdownMenuCheckboxItem` (existing Admin primitive).
  - Badges use `Badge` from `components/ui/badge.tsx` with the default tone.
  - The phone layout follows `EmailsPhoneList`, and the phone check uses the same `useIsPhone` as `EmailsPage`.
  - Loading state uses `Skeleton`; errors use `ErrorState`. Show "N e-mails carregados" beside "Carregar mais".
  - The header uses `PageHeader` with the title "Todos os e-mails" and a back link to `/admin/emails`.

- [ ] **Step 5: Run** the tests, `npx tsc -p apps/admin/tsconfig.json --noEmit`, and eslint plus prettier on the touched files. Expected: pass.

- [ ] **Step 6: Commit.**
