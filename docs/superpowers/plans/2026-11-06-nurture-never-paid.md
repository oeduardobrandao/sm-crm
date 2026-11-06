# Nurture de contas que nunca assinaram: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 4-email Resend sequence (A: no clients, B: has clients) from Eduardo to workspace owners who never subscribed, pushing them to the existing 30-day trial, with one-click unsubscribe.

**Architecture:** All eligibility, step choice, send window, daily quota and the 72h cap live in one SQL RPC (`get_nurture_candidates(p_now)`); a second RPC claims a step after re-checking the owner. `lifecycle-email-cron` gets a fourth sweep, gated by `NURTURE_EMAILS`, that claims, builds (pure builders in `_shared/nurture-emails.ts`) and sends through `sendViaResend` with List-Unsubscribe headers. A new public function `nurture-unsub` stamps `profiles.nurture_opt_out_at`; the CRM gets a matching switch.

**Tech Stack:** Postgres (Supabase) + psql entitlement suites, Deno edge functions, Resend, React 19 + TanStack Query + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-nurture-never-paid-design.md`

**Deviation from the spec (my call, flagged):** the "Dicas por e-mail" switch goes in Configurações > Notificações > **E-mails automáticos** (desktop section and phone screen, both fed by `useEmailsAutomaticos`), not in Perfil. That section already lists every automatic email and holds the marketing opt-in, so the nurture toggle belongs next to it. The spec marked the Perfil placement as my call.

## Global Constraints

- Copy in Portuguese, **no em-dash** anywhere user-facing (emails, unsub pages, CRM strings).
- No plan number that the Admin can change, except "2 clientes no Free" (B1, only when `client_count >= 2`).
- From `Eduardo do Mesaas <eduardo@mesaas.com.br>` (`LIFECYCLE_FROM`), reply-to the same address, layout `mesaasEmail`.
- Every CTA link carries `?utm_source=email&utm_medium=nurture&utm_campaign=nurture_<step>` (e.g. `nurture_b1`).
- Send window: Monday to Friday, 09:00 to 11:59 `America/Sao_Paulo`. Max **15 new entries per day** (SP calendar day). Cap: no Mesaas email delivered to the person in the last **72h**. Workspace age max **180 days**. Cadence days **0 / 4 / 9 / 16** from the delivery of the current sequence's first step. Claim stale after **1h**, max **30** attempts.
- Account age min **72h** (`auth.users.created_at`); no welcome row required.
- Unsubscribe URL, used for both footer and header: `${SUPABASE_URL}/functions/v1/nurture-unsub/<token>`. Headers `List-Unsubscribe: <url>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Footer copy: "Você recebeu este e-mail porque criou uma conta no Mesaas. Não quer mais receber dicas? Descadastrar." ("Descadastrar" is the link).
- SECURITY DEFINER functions: `revoke all ... from public, anon, authenticated; grant execute ... to service_role`. Never `REVOKE FROM PUBLIC` alone.
- Edge functions: CORS via `buildCorsHeaders(req)`, generic error messages to clients, secrets read with a throwing IIFE (no fallback).
- Migration filename prefix must be above the largest prefix on `origin/main` when the PR opens (today `20261118000001`). The plan uses `20261119000001`; re-check at `gh pr create`.
- Kill switch `NURTURE_EMAILS`: anything other than exactly `on` means off.

## Review Focus

1. **Run outside the send window** (CI runs SQL tests at any hour): the RPC must take `p_now` and return zero rows on a Saturday or at 12:00 SP. Test in Task 1.
2. **Owner changed between candidate read and claim**: the claim must refuse and the handler must not send (an ex-member never gets the workspace or client name). Tests in Task 1 (SQL) and Task 4 (handler).
3. **A4 delivered, then the first client is created**: no B1, ever. Test in Task 1.
4. **Unsubscribed mid-sequence, or started a trial mid-sequence**: the next step is never offered. Test in Task 1.
5. **One-Click POST replayed, or token signed with another secret**: replay returns 200 and writes the same value; a bad token returns 404 and writes nothing; GET never writes. Tests in Task 3.

Names reaching HTML are escaped by `_shared/email/blocks.ts` already (`paragraph`, `heading`, `strong`, `link` all call `escapeHtml`); subjects carrying user data go through `sanitizeSubjectValue`. Task 2 pins both with a test.

---

### Task 1: Migration, candidate and claim RPCs, entitlement suite

**Files:**
- Create: `supabase/migrations/20261119000001_nurture_emails.sql`
- Create: `supabase/tests/entitlements/99_nurture_candidates.sql`

**Interfaces:**
- Produces (SQL, all `service_role` only):
  - column `profiles.nurture_opt_out_at timestamptz null`, `GRANT UPDATE (nurture_opt_out_at) ON public.profiles TO authenticated`.
  - table `nurture_emails(id bigserial pk, workspace_id uuid not null references workspaces(id) on delete cascade, step text not null check (step in ('a1','a2','a3','a4','b1','b2','b3','b4')), recipient_user_id uuid not null, sent_at timestamptz not null, delivered_at timestamptz null, attempts int not null default 1, unique (workspace_id, step))`, RLS enabled, no policies, `revoke all from public, anon, authenticated`, `grant select, insert, update on nurture_emails to service_role` (+ sequence usage). Index on `(recipient_user_id, delivered_at)`.
  - `_nurture_current_owner(p_workspace_id uuid) returns uuid` (stable, same pick as `get_trial_reminder_candidates`: `order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc limit 1` over `role = 'owner'`).
  - `get_nurture_candidates(p_now timestamptz default now()) returns table (user_id uuid, workspace_id uuid, email text, nome text, workspace_name text, workspace_created_at timestamptz, email_type text, step text, attempts int, client_count int, first_client_name text, has_instagram boolean)`. `email_type` is `'nurture_' || step`; `attempts` is the current row's attempts (0 when no row).
  - `claim_nurture_email(p_workspace_id uuid, p_step text, p_recipient_user_id uuid, p_now timestamptz default now()) returns int`: attempts after the claim, or `null` when refused.

- [ ] **Step 1: Write the failing entitlement suite `99_nurture_candidates.sql`**

Follow `58_loops_candidates.sql` for structure (`\set ON_ERROR_STOP on`, `\i _helpers.sql`, `begin; select et_grant_hosted_parity(); ... rollback;` per case, `raise exception` on failure, `raise notice 'PASS 99_nurture_candidates'` at the end).

Fixture `et_nurture_fixture(p_clients int default 0) returns table (user_id uuid, workspace_id uuid)`, dropped with `drop function if exists` before creation (same rerun reason as file 58). It must neutralise the signup trigger trap documented in `58_loops_candidates.sql:24-60`: the `auth.users` insert creates a throwaway workspace with the same `created_at` and points `profiles.conta_id` at it. So the fixture:
- inserts `auth.users` (email `<uuid>@et.test`, `last_sign_in_at = now()`);
- `v_ws := et_make_workspace('free')`; sets `created_by = v_uid`, **`created_at = now() + interval '1 minute'`** (forward-dated, so it is the newest of the person's workspaces), inserts `workspace_members(v_uid, v_ws, 'owner')`;
- **deletes the trigger's throwaway workspace** (the other workspace with `created_by = v_uid`), so "owns no ever-subscribed workspace" and "one sequence per person" only see `v_ws`;
- `update profiles set conta_id = v_ws, nurture_opt_out_at = null where id = v_uid`;
- sets `auth.users.created_at = T - 4 days` (T below);
- inserts `p_clients` rows in `clientes (conta_id = v_ws, nome = 'Cliente ' || i)` with increasing `created_at`.

Pinned clock: `T := '2026-11-10 13:00:00+00'` (Tuesday 10:00 in São Paulo). Every call passes `p_now` explicitly (`T`, or `T + interval 'N days'` moved onto a weekday 10:00 SP). Cases, each asserting on `get_nurture_candidates(...)` filtered by the fixture's `workspace_id`:

1. `a1_for_new_zero_clients`: fixture(0) → one row, `step = 'a1'`, `attempts = 0`, `client_count = 0`.
2. `b1_with_first_client_and_instagram`: fixture(2) + `instagram_accounts(client_id = first client, authorization_status = 'active')` → `step = 'b1'`, `client_count = 2`, `first_client_name = 'Cliente 1'`, `has_instagram = true`.
3. `outside_window_empty`: fixture(0), `p_now = '2026-11-14 13:00+00'` (Saturday) → 0 rows; `p_now = '2026-11-10 15:00+00'` (12:00 SP) → 0 rows; `p_now = '2026-11-10 11:59+00'` (08:59 SP) → 0 rows.
4. `excluded_states`, one fixture each, all → 0 rows: `workspace_subscriptions` row with `status = 'trialing'`; row with `status = 'canceled'` and `stripe_subscription_id` set; `ever_subscribed_at` set; `workspaces.demo_created_at` set; `plan_source = 'manual'`; `profiles.nurture_opt_out_at = T - 1 day`; `profiles.conta_id` pointing to another workspace; workspace `created_at = T - 181 days`; `auth.users.created_at = T - 71 hours`; a `welcome` row delivered at `T - 71 hours` (cap). And the inverse: no welcome row at all → still 1 row (pre-welcome signups stay eligible).
5. `owns_other_paid_workspace`: fixture(0) plus a second workspace owned by the same user with `stripe_subscription_id` set → 0 rows.
6. `cadence_a`: insert delivered `a1` at `T - 3 days` → 0 rows at `T`; at `T + 1 day` (day 4) → `a2`. Delivered `a1` at D, `a2` at D+4 → `a3` only from D+9.
7. `cap_72h_counts_other_emails`: delivered `a1` at `T - 5 days` (a2 due) plus `trial_reminder` delivered for `v_ws` at `T - 2 days` → 0 rows. Same with a fresh undelivered nurture claim (`sent_at = T - 30 minutes`) instead → 0 rows.
8. `migration_a_to_b`: delivered `a1`, `a2` (a3 due), then insert one client → `step = 'b1'`. With `a4` delivered instead, insert one client → 0 rows (Review Focus 3).
9. `b_continues_after_client_deleted`: delivered `b1` at `T - 5 days`, zero clients → `step = 'b2'`.
10. `stale_claim_retry`: undelivered `a1` with `sent_at = T - 2 hours`, `attempts = 3` → `step = 'a1'`, `attempts = 3`; with `attempts = 30` → 0 rows.
11. `daily_quota_15`: 16 fixtures with `last_sign_in_at` spread; 15 entries already claimed today (insert 15 `a1` rows for 15 *other* fixtures with `sent_at = T - 1 hour`, delivered) → only rows that are not new entries come back; with 14 claimed today, exactly one new entry, the one with the most recent `last_sign_in_at`.
12. `end_after_4`: `a1..a4` delivered → 0 rows forever (also at `T + 30 days`).
13. `claim_refuses_changed_owner` (Review Focus 2): fixture(0), add a second owner and set `workspaces.created_by` to them → `claim_nurture_email(ws, 'a1', v_uid, T)` is `null` and no row exists; with the original owner it returns `1` and a row with `recipient_user_id = v_uid`; a second immediate claim returns `null` (fresh claim); after `update nurture_emails set sent_at = T - 2 hours` it returns `2`.
14. `acl`: `select proacl` of both public RPCs contains `service_role` and no `anon`/`authenticated`/`=X/` entry; `has_table_privilege('authenticated','nurture_emails','select')` is false; the `profiles` UPDATE column set for `authenticated` equals `{empresa, marketing_opt_in, nome, nurture_opt_out_at, onboarding_complete, telefone, whatsapp}`.
15. `unsub_stops_sequence` (Review Focus 4): delivered `a1` at `T - 5 days`, then `nurture_opt_out_at = T - 1 hour` → 0 rows; separately, a `workspace_subscriptions` row turning `trialing` → 0 rows.

- [ ] **Step 2: Run it to see it fail**

Run (local Supabase on colima, see memory note): `supabase db reset && psql "$DB_URL" -f supabase/tests/entitlements/99_nurture_candidates.sql`
Expected: FAIL, `function et_make_workspace ... ` passes but `relation "nurture_emails" does not exist` / `function get_nurture_candidates(timestamp with time zone) does not exist`.

- [ ] **Step 3: Write the migration**

Order inside the file: column + grant + post-condition DO block (exact 7-column set for `authenticated` UPDATE, same query as `20260729000002`; do **not** edit that file), table, `_nurture_current_owner`, `get_nurture_candidates`, `claim_nurture_email`, grants. Header comment states: additive, safe before any code; rollback = drop the two RPCs and the helper, keep `nurture_emails` rows (they are the "never send twice" ledger), keep the column.

`get_nurture_candidates` logic (language sql or plpgsql, `security definer`, `set search_path = public`):
- `local := p_now at time zone 'America/Sao_Paulo'`. If `extract(isodow from local)` not in 1..5 or `extract(hour from local)` not in 9..11, return nothing.
- **Eligible pairs** `(u, ws)`: `u = _nurture_current_owner(ws.id)`; `ws.demo_created_at is null`; `ws.plan_source <> 'manual'`; `ws.created_at > p_now - 180 days`; no `workspace_subscriptions` row for `ws` with `ever_subscribed_at`, `stripe_subscription_id` or `pagarme_subscription_id` not null or `status in ('active','trialing','past_due')`; no other workspace where `u` is `_nurture_current_owner` that fails the same predicate; `profiles.conta_id = ws.id`; `profiles.nurture_opt_out_at is null`; `auth.users.email is not null`; `auth.users.created_at <= p_now - 72h` (no welcome row required: 5 of today's 59 predate the welcome email).
- **72h cap** on `u`: no `nurture_emails` row with `recipient_user_id = u` and (`delivered_at > p_now - 72h` or (`delivered_at is null` and `sent_at > p_now - 1h`)); no `welcome` for `u` delivered after `p_now - 72h`; no `subscription_thanks` / `trial_reminder` delivered after `p_now - 72h` for any workspace where `u` is the current owner.
- **One sequence per person**: skip `ws` if `u` is the recipient of any `nurture_emails` row on another workspace.
- **Step choice** for `ws` (rows `R` = its `nurture_emails`):
  - any undelivered row in `R`: fresh (`sent_at > p_now - 1h`) → skip; stale and `attempts < 30` → that step with its attempts; else skip;
  - `a4` or `b4` delivered → skip;
  - `seq = 'b'` if `R` has any `b*` row or `client_count >= 1`, else `'a'`;
  - `seq = 'b'` with no `b*` rows: `a4` in `R` → skip, else `b1` (a new entry only when `R` is empty);
  - `seq = 'a'` with no rows → `a1` (new entry);
  - otherwise the next step after the highest delivered step of `seq`, due when `p_now >= first_step.delivered_at + interval '<4|9|16> days'` for step 2/3/4.
- **Quota**: `used` = count of `nurture_emails` rows that are entries (`step = 'a1'`, or `step = 'b1'` with no `a1` row on the same workspace) whose `(sent_at at time zone 'America/Sao_Paulo')::date` equals `local::date`. New entries are ordered by `auth.users.last_sign_in_at desc nulls last, ws.id` and limited to `greatest(0, 15 - used)`; non-entry steps are unlimited.
- Output extras: `client_count` (count of `clientes.conta_id = ws.id`), `first_client_name` (`order by created_at, id limit 1`), `has_instagram` (exists `instagram_accounts ia join clientes c on c.id = ia.client_id where c.conta_id = ws.id and ia.authorization_status = 'active'`). `limit 50` overall.

`claim_nurture_email`: refuse (`return null`) unless `p_step` is valid and `_nurture_current_owner(p_workspace_id) = p_recipient_user_id`. Then `insert ... (workspace_id, step, recipient_user_id, sent_at, attempts) values (..., p_now, 1) on conflict (workspace_id, step) do update set sent_at = p_now, attempts = nurture_emails.attempts + 1 where nurture_emails.delivered_at is null and nurture_emails.sent_at <= p_now - interval '1 hour' and nurture_emails.attempts < 30 and nurture_emails.recipient_user_id = p_recipient_user_id returning attempts`. No row returned → `null`.

- [ ] **Step 4: Run the suite and the neighbours**

Run: `supabase db reset && bash scripts/test-entitlements.sh`
Expected: `PASS 99_nurture_candidates`, every other suite still PASS (the `profiles` grant change must not break `57_finding1_repro_closed.sql`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261119000001_nurture_emails.sql supabase/tests/entitlements/99_nurture_candidates.sql
git commit -m "feat(nurture): ledger, candidate and claim RPCs for never-paid owners"
```

---

### Task 2: Footer HTML slot and the 8 email builders

**Files:**
- Modify: `supabase/functions/_shared/email/shell.ts` (`MesaasEmailInput`, `mesaasEmail`)
- Create: `supabase/functions/_shared/nurture-emails.ts`
- Test: `supabase/functions/__tests__/email-shell_test.ts`, `supabase/functions/__tests__/nurture-emails_test.ts`

**Interfaces:**
- Produces:
  - `MesaasEmailInput.footerHtml?: string[]`: trusted HTML rows rendered after the escaped `footerLines`, before the tagline.
  - `type NurtureStep = "a1"|"a2"|"a3"|"a4"|"b1"|"b2"|"b3"|"b4"`
  - `interface NurtureEmailInput { step: NurtureStep; firstName: string | null; workspaceName: string; workspaceCreatedAt: string; clientCount: number; firstClientName: string | null; hasInstagram: boolean; appBaseUrl: string; unsubUrl: string; whatsappUrl: string | null }`
  - `buildNurtureEmail(p: NurtureEmailInput): { subject: string; html: string }`
  - `nurtureUtm(appBaseUrl: string, path: string, step: NurtureStep): string`
  - `TRIAL_FIRST_LAUNCH = "2026-10-27"`
  - `NURTURE_SAMPLE: Omit<NurtureEmailInput, "step" | "appBaseUrl" | "unsubUrl" | "whatsappUrl">` (preview data: Ana, Agência Aurora, 2 clients, Studio Bela, created 2026-09-01, no Instagram)

- [ ] **Step 1: Write failing tests**

`email-shell_test.ts`, new case `footerHtml rows render unescaped after footerLines`: `mesaasEmail({..., footerLines: ["L <x>"], footerHtml: ['<a href="https://u">Descadastrar</a>']})` includes `L &lt;x&gt;`, includes the raw anchor, and the anchor's index is between the line and `MESAAS_TAGLINE`. Existing cases stay unchanged.

`nurture-emails_test.ts`:
- `every step has subject, utm links and the unsub footer`: for each of the 8 steps, `html` includes `href="<unsubUrl>"` text `Descadastrar`, the footer sentence, and every `appBaseUrl` link includes `utm_campaign=nurture_<step>`; neither `subject` nor visible copy contains `—`.
- `a3 trial line only before trial-first`: `workspaceCreatedAt = "2026-10-01"` → html includes `ainda não tinha teste grátis`; `"2026-10-28"` → not.
- `b1 free-limit line only from 2 clients`: `clientCount = 2` → html includes `limite do plano Free`; `clientCount = 1` → not; subject uses singular/plural (`1 cliente` / `2 clientes`).
- `b2 names first client or falls back`: `firstClientName = "Studio Bela"` → includes `Studio Bela`; `null` → no `null` in output and a generic sentence.
- `b3 instagram variant`: `hasInstagram` true vs false yields different paragraphs (assert a distinctive phrase for each).
- `a4/b4 whatsapp button only with url`: `whatsappUrl = null` → no `wa.me`.
- `user data is escaped` (CLAUDE.md escape rule): `firstName = '<img src=x onerror=alert(1)>'`, `workspaceName = "Aurora\r\nBcc: x"`, `firstClientName = '"><script>'` → html has no `<img src=x`, no `<script>`; subjects contain no `\r` or `\n`.
- `ctas`: a1 links `/clientes` and `/importar`; a2 `/clientes`; a3, b1, b2, b3 `/comecar`.

- [ ] **Step 2: Run to see them fail**

Run: `deno test --no-check supabase/functions/__tests__/email-shell_test.ts supabase/functions/__tests__/nurture-emails_test.ts`
Expected: FAIL (`footerHtml` ignored; module `nurture-emails.ts` not found).

- [ ] **Step 3: Implement**

`shell.ts`: append `...(p.footerHtml ?? [])` (unescaped) to the footer rows before the tagline.

`nurture-emails.ts`: copy the 8 emails from the approved mockup source (Appendix A below, the script that rendered the mockups artifact) using the same blocks (`heading`, `paragraph`, `paragraphHtml`, `strong`, `callout`, `featureGrid`, `steps`, `button`, `spacer`, `signature`), swapping the hard-coded values for the input fields and adding the conditional lines above. Rules:
- every user value goes through a text block (`paragraph`, `heading`, `strong`), never raw into `paragraphHtml`;
- subjects with user data go through `sanitizeSubjectValue` from `lifecycle-emails.ts`;
- `firstName` null → greeting `Oi,`;
- footer: `footerLines: []`, `footerHtml: [escapeHtml(sentence) + " " + link(unsubUrl, "Descadastrar", EMAIL.muted)]`;
- B1 subject: `Você já tem ${n} ${n === 1 ? "cliente" : "clientes"} no Mesaas. Teste o resto por 30 dias`.

- [ ] **Step 4: Run tests to pass**

Run: same command as Step 2. Expected: PASS. Then `deno check supabase/functions/_shared/nurture-emails.ts`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/email/shell.ts supabase/functions/_shared/nurture-emails.ts supabase/functions/__tests__/email-shell_test.ts supabase/functions/__tests__/nurture-emails_test.ts
git commit -m "feat(nurture): email builders and HTML footer slot"
```

---

### Task 3: Unsubscribe token and the `nurture-unsub` function

**Files:**
- Create: `supabase/functions/_shared/nurture-unsub-token.ts`
- Create: `supabase/functions/nurture-unsub/handler.ts`, `supabase/functions/nurture-unsub/index.ts`
- Modify: `supabase/config.toml` (add `[functions.nurture-unsub]` / `verify_jwt = false`, next to `client-email-unsub`)
- Modify: `CLAUDE.md` (add `nurture-unsub` to the `--no-verify-jwt` list in Gotchas; add `NURTURE_UNSUB_SECRET` to Environment variables: required by `nurture-unsub` and `lifecycle-email-cron`, no default, throws at module load, rotating it invalidates every link already sent)
- Test: `supabase/functions/__tests__/nurture-unsub_test.ts`

**Interfaces:**
- Produces:
  - `signNurtureUnsubToken(userId: string, secret: string): Promise<string>` → `<b64url(JSON {u})>.<b64url(HMAC-SHA256)>`
  - `verifyNurtureUnsubToken(token: string, secret: string): Promise<string | null>` (user id, or null on bad signature/shape/non-uuid)
  - `nurtureUnsubUrl(supabaseUrl: string, token: string): string`
  - `interface NurtureUnsubDb { from(table: "profiles"): { update(patch: { nurture_opt_out_at: string }): { eq(col: "id", v: string): { is(col: "nurture_opt_out_at", v: null): PromiseLike<{ error: { message: string } | null }> } } } }`
  - `createNurtureUnsubHandler(deps: { db: NurtureUnsubDb; tokenSecret: string; now: () => Date; buildCorsHeaders: (req: Request) => Record<string, string> }): (req: Request) => Promise<Response>`

- [ ] **Step 1: Write failing tests** (model the fakes on `client-email-unsub_test.ts`)

- `token round-trips and rejects tampering`: sign → verify returns the uuid; flipped last char → null; signed with `"other"` → null; payload `{u: "not-a-uuid"}` correctly signed → null; `""`, `"a."`, `".b"` → null.
- `GET valid token renders confirmation and never writes`: 200, `text/html`, body includes a `<form method="post">`, zero update calls.
- `POST valid token stamps opt-out`: 200, one update with `nurture_opt_out_at = NOW.toISOString()`, `.eq("id", uid)`, `.is("nurture_opt_out_at", null)`.
- `POST replay is idempotent` (Review Focus 5): two POSTs → both 200, no error (the `.is(null)` filter keeps the first timestamp).
- `bad token is 404 and never writes` (Review Focus 5): GET and POST with a token signed by another secret → 404, zero updates.
- `db error is a generic 500`: fake returns `{ error: { message: "boom" } }` → 500 and body without `boom`.
- `OPTIONS returns cors`, other methods → 405.
- Page bodies contain no `—`.

- [ ] **Step 2: Run to see them fail**

Run: `deno test --no-check supabase/functions/__tests__/nurture-unsub_test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Token module: same HMAC/b64url approach as `_shared/client-event-email.ts:255-320`, separate module and key (the existing verifier only accepts integer ids). Handler: copy `client-email-unsub/handler.ts` routing (token = last path segment; GET renders, POST writes, no CSRF for the RFC 8058 reasons in that file's header). Copy for pages: confirm "Parar de receber as dicas do Mesaas?" / "Você vai parar de receber os e-mails de dicas. E-mails da sua conta (convites, cobrança, avisos do teste) continuam chegando." / button "Parar de receber"; done "Pronto. Você não vai mais receber as dicas por e-mail. Dá pra religar em Configurações > Notificações."; invalid "Link inválido". `index.ts`: service-role client with the bounded-fetch wrapper from `client-email-unsub/index.ts`, `NURTURE_UNSUB_SECRET` read with a throwing IIFE.

- [ ] **Step 4: Run tests and type check**

Run: `deno test --no-check supabase/functions/__tests__/nurture-unsub_test.ts && deno check supabase/functions/nurture-unsub/index.ts`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/nurture-unsub-token.ts supabase/functions/nurture-unsub supabase/functions/__tests__/nurture-unsub_test.ts supabase/config.toml CLAUDE.md
git commit -m "feat(nurture): one-click unsubscribe function"
```

---

### Task 4: Nurture sweep and preview in `lifecycle-email-cron`, runbook

**Files:**
- Modify: `supabase/functions/lifecycle-email-cron/handler.ts`
- Modify: `supabase/functions/lifecycle-email-cron/index.ts`
- Create: `docs/nurture-emails.md`
- Modify: `CLAUDE.md` (Environment variables: `NURTURE_EMAILS`, `off` default, any value other than `on` is off, read per run, no deploy to flip; link to the runbook)
- Test: `supabase/functions/__tests__/lifecycle-email-cron_test.ts`

**Interfaces:**
- Consumes: `get_nurture_candidates(p_now)`, `claim_nurture_email(...)` (Task 1); `buildNurtureEmail`, `NURTURE_SAMPLE`, `NurtureStep` (Task 2); `signNurtureUnsubToken`, `nurtureUnsubUrl` (Task 3).
- Produces:
  - `LifecycleDb.rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult<unknown>>` (widened; existing calls unchanged).
  - `LifecycleDb.from("nurture_emails").update({ delivered_at }).eq("workspace_id", id).eq("step", step)`.
  - new deps: `nurtureEnabled: boolean`, `nurtureUnsubUrl: (userId: string) => Promise<string>`, `whatsappUrl: string | null`, `sendNurture: (p: { to: string; subject: string; html: string; idempotencyKey: string; headers: Record<string, string> }) => Promise<void>`.
  - `runLifecycleEmailCron` result gains `nurtureSent: number`.
  - `runNurturePreview(deps: LifecycleCronDeps, to: string): Promise<{ previewSent: number }>`.

- [ ] **Step 1: Write failing handler tests**

Extend `makeFakeDb` with `nurtureCandidates`, a recorded `rpcCalls: Array<{ name; args }>`, a `claim_nurture_email` result map (default: returns `attempts + 1`), and `nurture_emails` update recording. Cases:
- `nurture off never calls the rpc`: `nurtureEnabled: false` → no `get_nurture_candidates` in `rpcCalls`, `nurtureSent = 0`.
- `nurture on sends claimed steps`: one `b1` candidate → `claim_nurture_email` called with `{ p_workspace_id, p_step: "b1", p_recipient_user_id, p_now }` (the deps clock), then `sendNurture` once with `idempotencyKey = "nurture_b1/<ws>"`, `headers["List-Unsubscribe"] = "<url>"`, `headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"`, html containing the same url; then `delivered_at` update with `eq("step","b1")`; `nurtureSent = 1`.
- `claim refused skips send` (Review Focus 2): claim returns `null` → `sendNurture` not called, no update, no error reported.
- `send failure is reported, not delivered`: `sendNurture` throws → `report` called with the workspace id, no `delivered_at` update.
- `candidate rpc error is reported`: rpc error → `errors` gets `nurture candidates: ...`, other sweeps still run.
- `preview sends 8 without touching ledgers`: `runNurturePreview(deps, "e@x")` → 8 `sendNurture` calls to `e@x`, steps a1..b4 in subject order, keys `nurture_preview/<step>/<YYYY-MM-DD of deps.now()>`, zero `rpc` and zero `from` calls.

- [ ] **Step 2: Run to see them fail**

Run: `deno test --no-check supabase/functions/__tests__/lifecycle-email-cron_test.ts`
Expected: FAIL on the new cases; existing cases still pass.

- [ ] **Step 3: Implement**

Handler: fourth sweep after the trial reminder, entered only when `deps.nurtureEnabled`. Per candidate: `rpc("claim_nurture_email", ...)`; `null` → continue; build with `buildNurtureEmail` (`firstNameFrom(c.nome)`); send; mark delivered (log, don't throw, like `markDelivered`). Errors per candidate go to `errors` with `accountId: workspace_id`. `runNurturePreview` loops the 8 steps over `NURTURE_SAMPLE` with `nurtureUnsubUrl` of a fixed preview id (`00000000-0000-0000-0000-000000000000`).

`index.ts`: `NURTURE_UNSUB_SECRET` throwing IIFE; `nurtureEnabled: Deno.env.get("NURTURE_EMAILS") === "on"`; `whatsappUrl` from `whatsAppSupportUrl({ firstName: null })` in `_shared/whatsapp.ts` (null when `WHATSAPP_SUPPORT_NUMBER` is unset); `sendNurture` = `sendViaResend(to, subject, html, key, LIFECYCLE_FROM, "eduardo@mesaas.com.br", headers)`. After the secret check, read the body defensively (`await req.text()`, empty or invalid JSON → `{}`); a string `nurture_preview_to` matching a basic email regex runs `runNurturePreview` and returns `{ success: true, previewSent }` instead of the sweep. pg_cron sends no body, so the scheduled path is unchanged.

`docs/nurture-emails.md`: what it is (link the spec), env vars, deploy order (spec §Ordem de deploy, steps 1 to 6), how to preview (`curl -X POST ... -H "x-cron-secret: $CRON_SECRET" --data '{"nurture_preview_to":"..."}'`, secret from an env var, never pasted), rollback (`NURTURE_EMAILS=off`), how to unsubscribe someone by hand (`update profiles set nurture_opt_out_at = now()`), and the conversion query: per step, owners whose workspace got a `workspace_subscriptions` row with `status in ('trialing','active')` created within 14 days after their last delivered `nurture_emails` row.

- [ ] **Step 4: Run tests and type check**

Run: `deno test --no-check supabase/functions/__tests__/lifecycle-email-cron_test.ts && deno check supabase/functions/lifecycle-email-cron/index.ts`
Expected: all PASS, no type errors (the structural `rpc` must return `PromiseLike`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lifecycle-email-cron supabase/functions/__tests__/lifecycle-email-cron_test.ts docs/nurture-emails.md CLAUDE.md
git commit -m "feat(nurture): sweep and manual preview in lifecycle-email-cron"
```

---

### Task 5: "Dicas por e-mail" switch in the CRM

**Files:**
- Modify: `apps/crm/src/pages/configuracao/tabs/notificacoes/useEmailsAutomaticos.ts`
- Modify: `apps/crm/src/pages/configuracao/tabs/notificacoes/EmailsAutomaticosSection.tsx`
- Modify: `apps/crm/src/pages/configuracao/tabs/phone/NotificacoesPhone.tsx`
- Modify: `packages/i18n/locales/pt/settings.json`, `packages/i18n/locales/en/settings.json`
- Test: `apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx`

**Interfaces:**
- Produces: `useEmailsAutomaticos()` also returns `tipsEnabled: boolean` (`profile.nurture_opt_out_at == null`) and `saveTips: (enabled: boolean) => void`, which writes `{ nurture_opt_out_at: enabled ? null : new Date().toISOString() }` to `profiles` (`.eq('id', user.id)`), refetches the profile, and uses the same optimistic flip and rollback toast as `saveMarketing`. `profile` comes from `select('*')`, so the column needs no loader change.

- [ ] **Step 1: Write failing tests** in `NotificacoesTab.test.tsx`
- `tips switch reflects nurture_opt_out_at`: profile `{ nurture_opt_out_at: null }` → switch named `Dicas por e-mail` is checked; `'2026-11-01T00:00:00Z'` → unchecked.
- `toggling tips off stamps the opt-out`: click → `mockSupabaseUpdate` called with `{ nurture_opt_out_at: expect.any(String) }`; toggling back on → `{ nurture_opt_out_at: null }`; profile refetched.
- The existing marketing switch test still finds its switch by its own name.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run apps/crm/src/pages/configuracao/__tests__/NotificacoesTab.test.tsx`
Expected: FAIL, no switch named `Dicas por e-mail`.

- [ ] **Step 3: Implement**

New row under the marketing row in both the desktop section and the phone screen. i18n keys under `notifications`: `tipsLabel` "Dicas por e-mail" / "Tips by email"; `tipsWhen` "algumas dicas de uso enquanto você não assina" / "a few usage tips while you are not subscribed"; `tipsRecipients` "você" / "you". Update `notifications.emails.description` to "E-mails que a sua conta envia sozinha, para transparência. Os 3 primeiros são sempre enviados; os 2 últimos dependem de você." (and the English equivalent).

- [ ] **Step 4: Run tests, lint, types**

Run: `npx vitest run apps/crm/src/pages/configuracao && npx tsc -p apps/crm/tsconfig.json --noEmit && npx eslint apps/crm/src/pages/configuracao && npx prettier --check apps/crm/src/pages/configuracao packages/i18n/locales`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/configuracao packages/i18n/locales
git commit -m "feat(nurture): tips-by-email switch in Notificações"
```

---

### Task 6: Full verification before the PR

- [ ] **Step 1: Run every CI gate locally**

Run, in order: `npm run lint`, `npm run format:check`, the five `tsc` commands from `CLAUDE.md`, `npm run test`, `npm run check:functions`, `npm run test:functions`, `bash scripts/test-entitlements.sh` (needs local Supabase on colima).
Expected: all green. `apps/mcp-widgets` is untouched, so no `cards.ts` rebuild.

- [ ] **Step 2: Check the migration prefix against main**

Run: `git fetch origin main && git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -1`
Expected: a prefix below `20261119000001`; otherwise rename the migration above it, re-run Task 1 Step 4, and commit.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "chore(nurture): CI fixes"
```
(Skip if nothing changed.)

---

## Appendix A: approved mockup copy

The script that rendered https://claude.ai/artifact/91DZvrZnCBvQtfC5j9KH2f. Hard-coded values (Ana, Agência Aurora, Studio Bela, 2 clientes, the `wa.me` number) become `NurtureEmailInput` fields; the footer becomes `footerHtml` with the unsub link. Text is final unless Eduardo edits it in review.

```ts
const ROOT = "/Users/eduardosouza/projects/sm-crm/.claude/worktrees/mesaas-multipage-popup-f99266/supabase/functions/_shared";
const { mesaasEmail } = await import(`${ROOT}/email/shell.ts`);
const B = await import(`${ROOT}/email/blocks.ts`);
const { button, callout, featureGrid, heading, link, paragraph, paragraphHtml, sectionTitle, signature, spacer, steps } = B;

const base = "https://www.mesaas.com.br";
const u = (path: string, step: string) => `${base}${path}?utm_source=email&utm_medium=nurture&utm_campaign=nurture_${step}`;
const wa = "https://wa.me/5500000000000";
const footer = ["Você recebeu este e-mail porque criou uma conta no Mesaas. Não quer mais receber dicas? Descadastrar."];
const name = "Ana";
const ws = "Agência Aurora";

type Email = { id: string; seq: string; day: number; subject: string; html: string };
const out: Email[] = [];
const add = (id: string, seq: string, day: number, subject: string, preheader: string, eyebrow: string, sections: string[]) =>
  out.push({ id, seq, day, subject, html: mesaasEmail({ preheader, eyebrow, sections, footerLines: footer }) });

const trialGrid = featureGrid([
  { title: "Hub do cliente", text: "Aprovação de posts por link, sem login, com a sua marca." },
  { title: "Equipe", text: "Convide seu time e divida as entregas." },
  { title: "Instagram", text: "Agendamento, métricas e relatórios em PDF." },
  { title: "Clientes sem limite", text: "No Free são 2. No teste, quantos você precisar." },
]);
const trialFine = paragraph("O teste pede um cartão, mas você só é cobrado no fim dos 30 dias se continuar. Eu te aviso por e-mail antes da cobrança, e dá pra cancelar em dois cliques.", "small", "14px 0 0");

// A1
add("A1", "A", 0, "Seu primeiro cliente no Mesaas leva 3 minutos", "Cadastre um cliente e o resto do Mesaas começa a fazer sentido.", "Primeiros passos", [
  paragraph(`Oi, ${name},`) +
    paragraph("Vi que você criou sua conta no Mesaas mas ainda não cadastrou nenhum cliente. É normal: a parte chata é começar.") +
    paragraph("Com um cliente cadastrado você já consegue montar o calendário editorial dele, organizar as entregas no kanban e guardar briefing e contrato num lugar só."),
  sectionTitle("Dois jeitos de começar") +
    steps([
      `<strong>Na mão</strong>: nome, Instagram e pronto. Leva uns 3 minutos.${spacer(12)}${button(u("/clientes", "a1"), "Cadastrar meu primeiro cliente")}`,
      `<strong>Importando</strong>: se seus clientes estão no Notion, Trello, ClickUp ou numa planilha, a gente traz tudo.${spacer(12)}${button(u("/importar", "a1"), "Importar meus clientes", "outline")}`,
    ]),
  paragraphHtml("Travou em alguma coisa? É só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente.", "body", "0 0 18px") + signature(),
]);
// A2
add("A2", "A", 4, "Como as agências aprovam posts sem WhatsApp", "Um link, o cliente aprova pelo celular, sem login.", "Dica", [
  paragraph(`Oi, ${name},`) +
    paragraph("A parte que mais toma tempo de quem faz social media para cliente não é criar o post. É conseguir a aprovação: print no WhatsApp, áudio de 4 minutos, \"pode trocar a cor?\" três dias depois.") +
    paragraph("No Mesaas cada cliente ganha um Hub: um link com a sua marca onde ele vê os posts da semana, aprova ou pede ajuste em cada um, direto do celular e sem criar conta."),
  callout("Cada aprovação ou pedido de ajuste já atualiza o status do post no seu kanban. Você para de caçar resposta no WhatsApp."),
  paragraph("Para usar, o primeiro passo é ter um cliente cadastrado.", "body", "0 0 18px") + button(u("/clientes", "a2"), "Cadastrar um cliente") + spacer(24) + signature(),
]);
// A3
add("A3", "A", 9, "Teste tudo do Mesaas por 30 dias", "Hub, equipe, Instagram e relatórios liberados por 30 dias.", "Teste grátis", [
  heading(`${name}, você pode testar tudo por 30 dias.`) +
    paragraph("Quando você criou sua conta, o Mesaas ainda não tinha teste grátis. Agora tem: 30 dias com todos os recursos dos planos pagos liberados.") +
    trialGrid + spacer(8) + button(u("/comecar", "a3"), "Começar meu teste grátis") + trialFine,
  paragraphHtml("Se ainda não sabe se o Mesaas serve para a sua agência, <strong>me responde contando como você trabalha hoje</strong> que eu digo com sinceridade.", "body", "0 0 18px") + signature(),
]);
// A4
add("A4", "A", 16, "Posso parar de te escrever?", "Uma pergunta rápida, e prometo que é a última.", "Uma pergunta", [
  paragraph(`Oi, ${name},`) +
    paragraph("Te mandei algumas dicas sobre o Mesaas nas últimas semanas e não quero lotar sua caixa de entrada.") +
    paragraph("Se puder, me responde com uma linha só: o que faltou para o Mesaas servir para você? Pode ser \"não é o momento\", \"faltou tal coisa\" ou \"achei caro\". Eu leio todas e isso muda o que a gente constrói.") +
    paragraph("Este é o último e-mail desta série. Sua conta continua lá, do jeito que você deixou.", "body", "0 0 18px") +
    button(wa, "Prefiro falar no WhatsApp", "outline") + spacer(24) + signature(),
]);
// B1
add("B1", "B", 0, "Você já tem 2 clientes no Mesaas. Teste o resto por 30 dias", "Seu Free parou em 2 clientes. O teste libera tudo.", "Teste grátis", [
  heading(`${name}, a ${ws} já está no Mesaas.`) +
    paragraph("Você já cadastrou 2 clientes, e esse é o limite do plano Free. Para seguir crescendo, e para usar o que o Mesaas tem de melhor, dá pra testar tudo por 30 dias.") +
    trialGrid + spacer(8) + button(u("/comecar", "b1"), "Começar meu teste grátis") + trialFine,
  paragraphHtml("Ficou alguma dúvida sobre o plano? É só <strong>responder este e-mail</strong>.", "body", "0 0 18px") + signature(),
]);
// B2
add("B2", "B", 4, "Seu cliente aprova o post pelo celular", "O Studio Bela pode aprovar a semana inteira num link.", "Dica", [
  paragraph(`Oi, ${name},`) +
    paragraph("Imagina mandar para o Studio Bela um link só, com os posts da semana. Ele abre no celular, aprova os que estão bons e comenta nos que precisam de ajuste. Sem login, sem print, sem áudio.") +
    paragraph("Esse é o Hub do cliente. Ele vem com a sua marca, e cada aprovação já atualiza o status do post no seu kanban."),
  callout("O Hub, a equipe e o Instagram fazem parte do teste grátis de 30 dias."),
  button(u("/comecar", "b2"), "Testar o Hub com o Studio Bela") + spacer(24) + signature(),
]);
// B3
add("B3", "B", 9, "Relatório de Instagram pronto para mandar ao cliente", "Métricas do mês num PDF com a sua marca, sem montar no Canva.", "Dica", [
  paragraph(`Oi, ${name},`) +
    paragraph("Todo fim de mês alguém da agência para um dia para montar o relatório de cada cliente. No Mesaas ele sai pronto: alcance, engajamento, melhores posts e crescimento, num PDF com a sua marca.") +
    paragraph("Você conecta o Instagram do cliente uma vez e as métricas passam a ser atualizadas sozinhas, com os melhores horários para postar."),
  button(u("/comecar", "b3"), "Começar meu teste grátis") + trialFine + spacer(18) + signature(),
]);
// B4
add("B4", "B", 16, "Posso parar de te escrever?", "Uma pergunta rápida, e prometo que é a última.", "Uma pergunta", [
  paragraph(`Oi, ${name},`) +
    paragraph("Vi que a Agência Aurora já usa o Mesaas com seus clientes, mas ainda não testou os planos pagos. Não quero insistir.") +
    paragraph("Se puder, me responde com uma linha só: o que faltou para testar? Preço, um recurso, o momento? Eu leio todas e isso muda o que a gente constrói.") +
    paragraph("Este é o último e-mail desta série. Seu plano Free continua funcionando normalmente.", "body", "0 0 18px") +
    button(wa, "Prefiro falar no WhatsApp", "outline") + spacer(24) + signature(),
]);

console.log(JSON.stringify(out));
```
