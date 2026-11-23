# Hub Client Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agency keep a list of people per client who log in to the web Hub with an email code, with a per-client "Exigir login" switch, and record who approved or wrote.

**Architecture:** Own client sessions (never `auth.users`), following the `affiliate-public` pattern: hashed session tokens in a service-role table, sent by the Hub in an `x-hub-session` header. One shared resolver (`resolveHubAccess`) replaces `resolveHubToken` in all 18 hub functions and reads a single RPC (`hub_access_context`). The CRM reads and writes people and the switch only through SECURITY DEFINER RPCs.

**Tech Stack:** Postgres (Supabase migrations, plpgsql), Deno edge functions, React 19 + TanStack Query (Hub and CRM), Vitest, `deno test`, psql entitlement suites, `packages/i18n`.

**Spec:** `docs/superpowers/specs/2026-11-23-hub-client-login-design.md` (read it first; this plan argues from it). Mockups: https://claude.ai/artifact/Q5r3XPHgABEqMB4RdTkjAw

## Global Constraints

- A client never becomes a CRM user: no row in `auth.users`, no Supabase Auth call for clients.
- Nothing reveals whether an email is on a client's list: `request_code` always answers `{ ok: true }`; `verify_code` has one generic error, "Código inválido ou expirado."
- A hub with the switch off behaves exactly as before the deploy.
- Copy is pt-BR, **no em dashes**, through `packages/i18n` (`pt` and `en` files both; `packages/i18n/__tests__/locales.test.ts` checks parity).
- Edge functions: `buildCorsHeaders(req)` only, generic error bodies, details to `console.error`. Codes and session tokens never go to logs or `audit_log`.
- Values fixed by the spec: code = 6 digits, valid 10 minutes, 5 attempts; session = 32 random bytes base64url, SHA-256 hex stored, 90 days sliding, refreshed at most once a day; people cap = 20 per client; resend countdown = 60 s; rate limits `request_code` 5/email/hour and 20/IP/hour, `verify_code` 10/IP/10 min.
- Migration file prefix must be above main's tail when the PR opens (tail today: `20261127000001`). This plan uses `20261128000001`; re-check with `ls supabase/migrations | tail -3` after `git fetch origin main` and renumber if taken.
- Never `useBlocker` in the apps. Icons: `lucide-react` in the Hub and on CRM pages.
- Commit after each task. Run `npm run format` only on the paths the task touched.

## Deviations from the spec (decided during planning, tell the user)

1. **Scope check:** the spec names `scope_check_*`; those helpers take posts and workflows, not a client. The RPCs use the `hub_token_rotate` shape instead: `my_client_scope_all() OR can_access_cliente(cliente)`.
2. **Third failure reason:** `resolveHubAccess` returns `'error'` (HTTP 500) when its read fails, besides `'invalid'` and `'login_required'`.
3. **One RPC for access:** settings, session and person are read by `hub_access_context` in one round trip.
4. **401 login payload also carries `brand_color`** (the Hub accent comes from it; it is workspace data, not client data).
5. **Staging/browser check:** codes are stored salted and hashed, so they cannot be read back. The check seeds a known code with `select hub_login_issue(...)`.
6. **MCP `list_post_feedback`** is not changed (the spec left it optional).
7. **Authorship guard:** signed-in CRM users can insert into `post_approvals` and `mensagens` directly, so a trigger blanks `hub_person_id` / `hub_person_nome` on any write that is not the service role. Without it "who approved" could be forged.
8. **`verify_code` returns only the session token.** The person comes from the bootstrap refetch.

Where this plan and the spec differ, **the plan wins**.

## Review Focus

Each line has its test in the task named.

1. Five wrong codes, then the right one: must still fail (the attempts counter must survive each wrong try). Task 1.
2. A session for an email that is on client A's list opens client B's gated link: must be `login_required`. Tasks 1 and 2.
3. `hub_access_context` read fails (RPC error or non-object data): the request must be a 500, never "not required". Task 2.
4. A `login_required` answer when the browser has no stored session must not clear-and-invalidate in a loop. Task 6.
5. Email typed with capitals or spaces (" Marina@Clinica.com "): matches the stored lower-case email on add, on `request_code` and on `verify_code`. Tasks 1 and 4.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261128000001_hub_client_login.sql` (create) | Tables, authorship columns, all RPCs, recreated RPCs, cleanup job |
| `supabase/tests/entitlements/99_hub_client_login.sql` (create) | psql suite for RPCs and ACLs |
| `supabase/tests/entitlements/99_acesso_por_cliente_drift.sql` (modify) | Three exemptions |
| `supabase/functions/_shared/hub-token.ts` (modify) | `resolveHubAccess`, `hubAccessDenied`, `HUB_SESSION_HEADER` |
| `supabase/functions/_shared/cors.ts` (modify) | Allow `x-hub-session` |
| `supabase/functions/__tests__/hub-access-mock.ts` (create) | Shared `rpc` answer for hub test mocks |
| `supabase/functions/hub-auth/{index,handler,logic,email}.ts` (create) | Login function |
| `supabase/functions/hub-*/handler.ts` or `index.ts` (modify, 18) | Switch to `resolveHubAccess` |
| `supabase/functions/__tests__/hub-access_test.ts`, `hub-auth_test.ts`, `hub-access-structural_test.ts` (create) | Deno tests |
| `apps/hub/src/lib/hubSession.ts` (create) | Session storage |
| `apps/hub/src/api.ts`, `services/postReferences.ts`, `queries.ts`, `types.ts`, `HubContext.tsx` (modify) | Header, error body, auth calls |
| `apps/hub/src/shell/HubLogin.tsx`, `HubAccountMenu.tsx` (create); `HubShell.tsx`, `HubSidebar.tsx`, `HubMobileNav.tsx` (modify) | Login gate, account menu |
| `apps/crm/src/store/hubPeople.ts` (create) | CRM RPC wrappers |
| `apps/crm/src/pages/cliente-detalhe/hub/HubPeopleSection.tsx` (create); `AcessoPage.tsx` (modify) | "Quem pode entrar" |
| CRM and Hub render sites (modify, Task 9) | Person name on approvals and messages |
| `packages/i18n/locales/{pt,en}/common.json`, `clientHub.json` (modify) | Strings |

---

### Task 1: Migration, RPCs and psql suite

**Files:**
- Create: `supabase/migrations/20261128000001_hub_client_login.sql`
- Create: `supabase/tests/entitlements/99_hub_client_login.sql`
- Modify: `supabase/tests/entitlements/99_acesso_por_cliente_drift.sql` (`v_exempt_no_policy`, ~line 75)

**Interfaces:**
- Produces (tables, columns exactly as the spec's "Data model"): `hub_client_people`, `hub_client_settings`, `hub_login_codes` (add `salt text not null`), `hub_sessions`; `post_approvals.hub_person_id`, `post_approvals.hub_person_nome`, `mensagens.hub_person_id`, `mensagens.hub_person_nome`.
- Produces (CRM RPCs, `SECURITY DEFINER`, `search_path = public, pg_temp`, `GRANT EXECUTE TO authenticated`, `REVOKE` from `PUBLIC, anon`):
  - `hub_people_list(p_cliente_id bigint) returns jsonb` → `{ "require_login": boolean, "people": [{ "id": uuid, "nome": text, "email": text, "last_login_at": timestamptz|null, "created_at": timestamptz }] }`, people ordered by `created_at`.
  - `hub_people_add(p_cliente_id bigint, p_nome text, p_email text) returns uuid`
  - `hub_people_remove(p_person_id uuid) returns void`
  - `hub_set_require_login(p_cliente_id bigint, p_value boolean) returns void`
  - Errors, raised as plain text the CRM matches with `includes`: `forbidden`, `not_found`, `invalid`, `duplicate`, `limit`, `no_people`, `last_person`.
- Produces (service RPCs, `SECURITY DEFINER`, `GRANT EXECUTE TO service_role` only, `REVOKE` from `PUBLIC, anon, authenticated`):
  - `hub_access_context(p_cliente_id bigint, p_session_hash text) returns jsonb` → `{ "require_login": boolean, "person": { "id", "nome", "email" } | null }`. `person` is set only when a non-expired `hub_sessions` row matches the hash and `hub_client_people` has `(p_cliente_id, session.email)`. `p_session_hash` may be null.
  - `hub_login_issue(p_cliente_id bigint, p_email text, p_code text) returns boolean` → false and no write when the normalized email is not on the client's list; otherwise marks earlier unused codes for `(cliente_id, email)` used, inserts a new row (10 minutes), returns true.
  - `hub_login_verify(p_cliente_id bigint, p_email text, p_code text, p_session_hash text) returns jsonb` → `{ "ok": true }` or `{ "ok": false }`. **Never raises for a wrong code** (a raise would roll back the attempts increment).
  - `hub_session_touch(p_session_hash text) returns void` and `hub_session_delete(p_session_hash text) returns void`.
  - `hub_login_cleanup() returns void`, scheduled `cron.schedule('hub-login-cleanup', '17 * * * *', $$select public.hub_login_cleanup()$$)`.
- Produces (recreated, same grants as today):
  - `record_client_approval(bigint, text, text, text, boolean, text, text, uuid, text)`: trailing `p_hub_person_id uuid DEFAULT NULL, p_hub_person_nome text DEFAULT NULL`.
  - `record_client_approval_with_notes(bigint, uuid, bigint, text, text, text, text, text, uuid, text)`: same two trailing parameters.
  - `get_mensagens_feed(uuid, bigint, timestamptz, integer, text, bigint)`: same arguments, one more returned column at the end, `client_person_name text`.

- [ ] **Step 1: Write the failing psql suite** `99_hub_client_login.sql`

Follow `99_workspace_member_emails.sql` for the frame (`\set ON_ERROR_STOP on`, `\i .../_helpers.sql`, `begin; select et_grant_hosted_parity();`, `et_make_workspace('max')`, a `pg_temp` helper that sets `request.jwt.claims` and `set local role authenticated`, `rollback` at the end). One `do $$` block, each case `assert ... , '<case name>'`:

- `owner_adds_and_lists`: owner calls `hub_people_add(c, ' Marina Costa ', ' Marina@Clinica.com ')`; `hub_people_list(c)->'people'->0->>'email' = 'marina@clinica.com'` and `->>'nome' = 'Marina Costa'`.
- `duplicate`: adding `MARINA@clinica.com` again raises a message containing `duplicate`.
- `invalid`: empty name, 81-character name, and `not-an-email` each raise `invalid`.
- `limit`: the 21st person raises `limit`.
- `no_people`: `hub_set_require_login(c2, true)` on a client with zero people raises `no_people`.
- `last_person`: with one person and the switch on, `hub_people_remove` raises `last_person`; with the switch off it succeeds.
- `agent_forbidden`: a member without `configuracoes:editar` gets `forbidden` from all four RPCs.
- `other_workspace_not_found`: an owner of workspace B gets `not_found` for workspace A's client and person.
- `restricted_member_not_found`: a member with `client_scope = 'atribuidos'` and no row in `workspace_member_clientes` for the client, holding a role with `configuracoes:editar`, gets `not_found`.
- `audit_written`: after add, remove and switch, `audit_log` has `hub_people.add`, `hub_people.remove`, `hub_login.require` rows with the `conta_id`; no row's `metadata` contains a code.
- `acl_closed`: as `authenticated`, `select 1 from hub_client_people`, `hub_client_settings`, `hub_login_codes`, `hub_sessions` each raise `insufficient_privilege` (42501); `has_function_privilege('authenticated', 'hub_login_verify(bigint,text,text,text)', 'execute')` is false, same for `hub_access_context`, `hub_login_issue`, `hub_session_touch`, `hub_session_delete`.
- `issue_only_for_listed`: `hub_login_issue(c, 'nobody@x.com', '111111')` is false and `hub_login_codes` stays empty; for the listed email it is true.
- `verify_happy`: issue `'482913'`, `hub_login_verify(c, ' Marina@Clinica.com ', '482913', repeat('a', 64))->>'ok' = 'true'`; a `hub_sessions` row exists with that hash and email `marina@clinica.com`, `expires_at` within a minute of `now() + interval '90 days'`; `hub_client_people.last_login_at` is set; verifying the same code again is `false` (single use).
- `attempts_cap` (Review Focus 1): issue `'482913'`, verify with `'000000'` five times (each `false`), then with `'482913'`: `false`.
- `expired`: set the code's `expires_at` to the past, verify: `false`.
- `reissue_invalidates`: issue `'111111'` then `'222222'`; `'111111'` is `false`, `'222222'` is `true`.
- `code_bound_to_client` (Review Focus 2): the same email on clients A and B; issue through A, `hub_login_verify(B, email, code, ...)` is `false`, and issuing through B does not mark A's code used.
- `access_context`: no row in `hub_client_settings` → `require_login = false`; with a valid session whose email is on A's list, `hub_access_context(A, hash)->'person'->>'nome' = 'Marina Costa'` and `hub_access_context(B_without_that_email, hash)->'person'` is JSON null; expired session → null person; removed person → null person.
- `approval_person`: `record_client_approval_with_notes(...)` called with the 8 old named arguments still works (person columns null); called with `p_hub_person_id`, `p_hub_person_nome` the new `post_approvals` row has both; deleting the person sets `hub_person_id` null and keeps `hub_person_nome`.
- `authorship_not_forgeable`: as `authenticated`, a direct `insert into post_approvals (..., hub_person_nome) values (..., 'Fake')` and the same on `mensagens` succeed but store `hub_person_id` and `hub_person_nome` as null; the same insert as service role keeps them.
- `feed_person_name`: `get_mensagens_feed(p_conta_id => ws, p_cliente_id => c)` returns `client_person_name = 'Marina Costa'` for a `post_approvals` row and a `mensagens` row written with the name, and null for rows without it.
- `touch_once_a_day`: `hub_session_touch` on a session with `last_used_at = now() - interval '2 days'` moves `expires_at` to about `now() + 90 days`; called again right after, `expires_at` does not change.

- [ ] **Step 2: Run it to see it fail**

Run (from the repo root, local Supabase up on colima): `psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_hub_client_login.sql`
Expected: FAIL, `function hub_people_add(...) does not exist`.

- [ ] **Step 3: Write the migration**

Decisions the tests do not fix:

- Email normalization everywhere: `lower(btrim(p_email))`; valid when it matches `^[^@\s]+@[^@\s]+\.[^@\s]+$` and is at most 254 characters. Name: `btrim`, 1 to 80 characters.
- Code hash formula, the only place it exists: `encode(sha256(convert_to(salt || ':' || code, 'UTF8')), 'hex')`, with `salt = encode(gen_random_bytes(16), 'hex')` (schema-qualify as `extensions.gen_random_bytes` if the bare name does not resolve under the function's `search_path`). Use the built-in `sha256()`, not pgcrypto `digest`.
- `hub_login_verify` body, in order: lock the newest row for `(cliente_id, email)` with `used_at is null and expires_at > now()` (`for update`); none → `{ok:false}`; `attempts >= 5` → `{ok:false}`; `attempts := attempts + 1`; hash mismatch → `{ok:false}` (the increment stays because the function returns normally); email no longer on the client's list → `{ok:false}`; else set `used_at`, insert `hub_sessions` (`expires_at = now() + interval '90 days'`), set `last_login_at`, return `{ok:true}`.
- CRM RPC guard, in this order, copied in shape from `hub_token_rotate` in `20261117000006_acesso_por_cliente_c4_agenda_analytics.sql` (~line 1731): resolve the client's `conta_id` (missing → `not_found`); `conta_id is distinct from public.get_my_conta_id()` → `not_found`; `not (public.my_client_scope_all() or public.can_access_cliente(cliente))` → `not_found`; `not public.has_permission_for(auth.uid(), conta_id, 'configuracoes', 'editar')` → `forbidden`. Then `perform pg_advisory_xact_lock(hashtextextended('hub_people:' || cliente::text, 0))` before any check-then-write.
- `audit_log` rows follow the insert in `hub_token_extend` (same file, ~line 1720): `resource_type = 'hub_client_people'`, `metadata` with `cliente_id` and, for people, `email`.
- RLS: enable on all four tables; one policy each, `FOR ALL TO service_role USING (true) WITH CHECK (true)`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated` naming the three roles.
- `hub_sessions.token_hash`: `text primary key check (token_hash ~ '^[0-9a-f]{64}$')`. Index `hub_sessions (email)`, `hub_login_codes (cliente_id, email, created_at desc)`.
- Recreated RPCs: `DROP FUNCTION` the old signature, then `CREATE`, then re-issue the grants exactly. Copy each body from its current source and change only what is listed:
  - `record_client_approval`: body from `20260928150001_edit_suggestion_update_flow.sql:126`. Add the two columns to the `insert into post_approvals`. Grants: revoke from `public, anon, authenticated`, grant `service_role`.
  - `record_client_approval_with_notes`: body from `20261026000002_post_media_notes_rpcs.sql:207`. Keep `SET search_path = public, pg_temp`. Pass the two new values on to the inner `record_client_approval(...)` call (it is positional). Same grants.
  - `get_mensagens_feed`: body from `20261117000006_acesso_por_cliente_c4_agenda_analytics.sql` (the `[escopo]` version, **not** `20261026000003`). Add `f_person_name` to every `UNION ALL` leg: `pa.hub_person_nome` in the `post_feedback` leg, `m.hub_person_nome` in the `mensagem` leg, `NULL::text` in the other three; return it last. Grants: revoke from `PUBLIC, anon`, grant `authenticated, service_role`.
- Authorship guard: one function `hub_person_guard()` and a `BEFORE INSERT OR UPDATE` trigger on `post_approvals` and on `mensagens`: when `auth.uid() is not null`, set `new.hub_person_id := null; new.hub_person_nome := null` on insert, and keep the old values on update. Service role (no `auth.uid()`) passes through.
- `hub_login_cleanup`: delete `hub_login_codes` with `expires_at < now() - interval '1 day'` and `hub_sessions` with `expires_at < now()`.
- End the migration with a `DO` block that raises if `authenticated` or `anon` has any privilege on the four tables (same idea as the linha editorial ACL check).

- [ ] **Step 4: Add the drift-test exemptions**

In `99_acesso_por_cliente_drift.sql`, append to `v_exempt_no_policy`: `'hub_client_people', 'hub_client_settings', 'hub_login_codes'` with the comment `-- login do cliente no Hub: só service role; o CRM passa pelas RPCs hub_people_*, que aplicam o escopo`. (`hub_sessions` has no client column and needs no entry. A `TO service_role` policy is accepted by that list's sanity case.)

- [ ] **Step 5: Run both suites**

Run: reset the local database (colima; `npx supabase` is broken on darwin-arm64 here, use the scratch-installed CLI and this worktree's port overrides, see the memory notes `reference_local_supabase_colima` and `reference_supabase_cli_darwin_arm64_and_prod_classifier`), then `bash scripts/test-entitlements.sh`.
Expected: `99_hub_client_login` and `99_acesso_por_cliente_drift` pass, no other suite regresses.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261128000001_hub_client_login.sql supabase/tests/entitlements/99_hub_client_login.sql supabase/tests/entitlements/99_acesso_por_cliente_drift.sql
git commit -m "feat(db): pessoas, sessões e códigos de login do cliente no Hub"
```

---

### Task 2: `resolveHubAccess`, denial helper and CORS

**Files:**
- Modify: `supabase/functions/_shared/hub-token.ts`
- Modify: `supabase/functions/_shared/cors.ts:29`
- Create: `supabase/functions/__tests__/hub-access_test.ts`
- Create: `supabase/functions/__tests__/hub-access-mock.ts`

**Interfaces:**
- Consumes: `hub_access_context` (Task 1).
- Produces also `export async function sha256Hex(value: string): Promise<string>` in `_shared/hub-token.ts` (same output as the one in `affiliate-public/logic.ts`; a `_shared` module must not import from a function folder, since all 18 hub functions bundle it). `hub-auth` imports this one.
- Produces, all exported from `_shared/hub-token.ts`:

```ts
export const HUB_SESSION_HEADER = "x-hub-session";
export interface HubPerson { id: string; nome: string; email: string }
export type HubAccess =
  | { ok: true; token: HubToken; person: HubPerson | null; requireLogin: boolean }
  | { ok: false; reason: "invalid" | "login_required" | "error" };
export async function resolveHubAccess(
  db: SupabaseClient, req: Request, token: string, now: string, expectedContaId?: string,
): Promise<HubAccess>;
/** Response for a failed access. `invalid` keeps today's behaviour: the
 *  `hub-badtoken:<ip>` limit (30 per 600 s, 429 when exceeded) then 404 "Link inválido." */
export async function hubAccessDenied(
  reason: "invalid" | "login_required" | "error",
  ctx: {
    db: unknown; req: Request;
    json: (body: unknown, status?: number) => Response;
    rateLimit: (db: any, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  },
): Promise<Response>;
```
  - `login_required` → 401 `{ error: "Login necessário.", code: "login_required" }`; `error` → 500 `{ error: "Erro interno." }`.
- Produces, from `__tests__/hub-access-mock.ts`: `export function hubAccessRpc(fn: string, override?: unknown): { data: unknown; error: null } | null` → for `fn === "hub_access_context"` returns `{ data: override ?? { require_login: false, person: null }, error: null }`, otherwise null (the caller falls through to its own mock).

- [ ] **Step 1: Write the failing tests** in `hub-access_test.ts`

Mock `db` like `hub-token_test.ts` / `hub-bootstrap_test.ts` (a `from("client_hub_tokens")` chain returning a token row, an `rpc` that answers `get_effective_plan`-style feature lookups as those tests already do, plus `hub_access_context`). Tests:

- `switch off, no session → ok, person null, requireLogin false`; assert the RPC got `p_session_hash: null`.
- `switch off, valid session → ok with person`.
- `switch on, no session → login_required`.
- `switch on, valid session → ok with person`.
- `switch on, session for an email not on this client → login_required` (RPC answers `person: null`).
- `session header is hashed`: with header `x-hub-session: abc`, `p_session_hash` equals `await sha256Hex("abc")`; a header longer than 200 characters is treated as absent.
- `rpc error → reason "error"`; `rpc data true → reason "error"`; `rpc data { require_login: "yes" } → reason "error"` (Review Focus 3).
- `missing token row → reason "invalid"` and the RPC is not called.
- `hubAccessDenied`: `invalid` → 404 and one `rateLimit` call with key starting `hub-badtoken:`; when `rateLimit` answers false → 429; `login_required` → 401 with `code`; `error` → 500.
- `cors allows the header`: `buildCorsHeaders(new Request("http://x"))["Access-Control-Allow-Headers"]` includes `x-hub-session`.

- [ ] **Step 2: Run to see them fail**

Run: `deno test supabase/functions/__tests__/hub-access_test.ts --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys`
Expected: FAIL, `resolveHubAccess` is not exported.

- [ ] **Step 3: Implement** `resolveHubAccess`, `hubAccessDenied`, `HUB_SESSION_HEADER`; add `, x-hub-session` to the allow-headers string in `cors.ts`; write `hub-access-mock.ts`.

`resolveHubAccess` calls `resolveHubToken` unchanged, then the RPC once. `resolveHubToken` itself is not modified.

- [ ] **Step 4: Run the tests** (same command, plus `hub-token_test.ts`). Expected: PASS.

- [ ] **Step 5: Type gate**

Run: `npm run check:functions`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/hub-token.ts supabase/functions/_shared/cors.ts supabase/functions/__tests__/hub-access_test.ts supabase/functions/__tests__/hub-access-mock.ts
git commit -m "feat(hub): resolveHubAccess com sessão do cliente e cabeçalho x-hub-session"
```

---

### Task 3: `hub-bootstrap` login payload, person and session upkeep

**Files:**
- Modify: `supabase/functions/hub-bootstrap/handler.ts`
- Modify: `supabase/functions/hub-bootstrap/index.ts` (wire the new dep)
- Modify: `supabase/functions/__tests__/hub-bootstrap_test.ts`, and the three bootstrap cases in `hub-functions_test.ts`

**Interfaces:**
- Consumes: `resolveHubAccess`, `hubAccessDenied`, `HUB_SESSION_HEADER`, `hubAccessRpc` (Task 2); `hub_session_touch` (Task 1).
- Produces:
  - New dep `touchSession: (sessionHash: string) => Promise<void>` (must not throw; same contract as `touchToken`).
  - 401 body on `login_required`: `{ error: "Login necessário.", code: "login_required", login: { workspace: { name, logo_url, brand_color }, hub_theme } }`. `hub_theme` is the same object the success path builds (entitlement-gated), so move `NEUTRAL_HUB_THEME` and the theme builder above the access check.
  - Success body adds `person: { nome, email } | null` and `require_login: boolean`.

- [ ] **Step 1: Write the failing tests** (add to `hub-bootstrap_test.ts`)

- `gated link without session → 401`, body `code === "login_required"`, `login.workspace.name === "WS"`, `login.hub_theme` deep-equals the gated theme; `JSON.stringify(body)` contains neither `"Vanessa"` nor `cliente_` nor `foto`; `touchToken` and `touchSession` were not called; `from("clientes")` was never queried.
- `gated link, unentitled workspace → login.hub_theme equals NEUTRAL_HUB_THEME`.
- `valid session → 200 with person { nome, email }` (no `id` on the wire), `require_login` true; `touchSession` called once with the session hash.
- `open link → 200, person null, require_login false`; `touchSession` not called.
- `access read fails → 500`.
- Existing tests keep passing after their `rpc` mock answers `hub_access_context` through `hubAccessRpc`.

- [ ] **Step 2: Run to see the new ones fail**

Run: `deno test supabase/functions/__tests__/hub-bootstrap_test.ts supabase/functions/__tests__/hub-functions_test.ts --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys`

- [ ] **Step 3: Implement.** Replace the `resolveHubToken` call with `resolveHubAccess(db, req, token, deps.now(), conta.id)`. `invalid` and `error` go through `hubAccessDenied`; `login_required` builds the payload above. On success, run `touchSession` inside the existing `Promise.all`, only when `person` is set. In `index.ts`, `touchSession` calls `hub_session_touch` with the same timeout-and-catch wrapper `touchToken` uses.

- [ ] **Step 4: Run tests and `npm run check:functions`.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-bootstrap supabase/functions/__tests__/hub-bootstrap_test.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub-bootstrap): tela de login quando o cliente exige login"
```

---

### Task 4: `hub-auth` function

**Files:**
- Create: `supabase/functions/hub-auth/index.ts`, `handler.ts`, `logic.ts`, `email.ts`
- Create: `supabase/functions/__tests__/hub-auth_test.ts`
- Modify: `supabase/config.toml` (add `[functions.hub-auth]` with `verify_jwt = false`, next to `[functions.hub-bootstrap]`)
- Modify: `supabase/functions/_shared/email-classify.ts` (`EMAIL_TYPES`), and its test `email-classify_test.ts` if it enumerates types

**Interfaces:**
- Consumes: `resolveHubToken` (direct: this function is not under the `hub-*` gate because it runs before login; Task 5's structural test allowlists it), `hub_login_issue`, `hub_login_verify`, `hub_session_delete` (Task 1), `HUB_SESSION_HEADER`, `checkRateLimit`/`getClientIP`, `sendViaResend` (9th argument `tags`), `base64Url`/`sha256Hex`/`normalizeEmail` from `affiliate-public/logic.ts`.
- Produces (HTTP, `POST` JSON):
  - `{ action: "request_code", workspace, token, email }` → `200 { ok: true }` whether or not the email is listed.
  - `{ action: "verify_code", workspace, token, email, code }` → `200 { session_token: string }` or `400 { error: "Código inválido ou expirado.", code: "invalid_code" }`.
  - `{ action: "logout" }` with the `x-hub-session` header → `200 { ok: true }` always.
  - Invalid link (workspace slug or token) → the same 404 as bootstrap; rate limited → `429 { error: "Muitas tentativas. Aguarde alguns minutos." }`.
- Handler deps (all injected, so tests need no network):

```ts
interface HubAuthDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  generateCode: () => string;            // 6 digits, CSPRNG, rejection sampling (no modulo bias)
  generateSessionToken: () => string;    // base64Url of 32 random bytes
  sendCodeEmail: (input: { to: string; code: string; workspaceName: string;
    brandColor: string | null; logoUrl: string | null }) => Promise<void>;
  defer: (work: Promise<unknown>) => void; // EdgeRuntime.waitUntil in index.ts; awaits nothing
}
```
- `logic.ts` exports `generateLoginCode(randomValues: (n: number) => Uint8Array): string` and `CODE_RE = /^\d{6}$/`.
- `email.ts` exports `buildLoginCodeEmail(input) → { subject, html }`. Subject: `Seu código de acesso: 123456`. Body copy: "Use este código para entrar no portal da {workspaceName}.", the code, "O código vale por 10 minutos.", "Se você não pediu este código, ignore este e-mail." Layout and `from` follow `client-event-email-cron/handler.ts:667` (`${sanitizeFromName(workspaceName)} <notificacoes@mesaas.com.br>`) and the brand header in `_shared/client-event-email.ts`. Tag: `[{ name: "type", value: "hub_login_code" }]`; `EMAIL_TYPES` entry `hub_login_code` in the same category as the other client-facing transactional emails in that file.

- [ ] **Step 1: Write the failing tests** in `hub-auth_test.ts` (mock `db` with `from` for `workspaces` and `client_hub_tokens`, and an `rpc` recorder)

- `request_code, listed email → { ok: true }`, `hub_login_issue` called with the normalized email (input `" Marina@Clinica.com "` → `"marina@clinica.com"`, Review Focus 5) and the generated code; `sendCodeEmail` called once through `defer`.
- `request_code, unlisted email` (`hub_login_issue` → false) `→ the same status and the same body bytes`; `sendCodeEmail` not called.
- `request_code, sendCodeEmail rejects → still { ok: true }` (the missing `RESEND_API_KEY` case on staging).
- `request_code, malformed email → { ok: true }` and no RPC call.
- `request_code` rate limits: the handler asks for keys `hub-auth-req:email:<cliente_id>:<email>` (5, 3600) and `hub-auth-req:ip:<ip>` (20, 3600); either false → 429.
- `verify_code happy path → 200`, `session_token` equals `generateSessionToken()`'s value, and the RPC received `p_session_hash === await sha256Hex(token)` (never the raw token).
- `verify_code, RPC ok:false → 400 invalid_code`; `code` not matching `CODE_RE` → 400 without calling the RPC.
- `verify_code` rate limit key `hub-auth-verify:ip:<ip>` (10, 600); false → 429.
- `invalid token or slug mismatch → 404` for both actions, and the `hub-badtoken:<ip>` limit is debited.
- `logout → hub_session_delete called with the header's hash`; without the header → `{ ok: true }` and no RPC.
- `nothing sensitive is logged`: stub `console.error`/`console.log`, run a failing verify and a failing send, assert no logged argument contains the code or the session token.
- `OPTIONS → 200`; `GET → 405`; unknown action → 400.

- [ ] **Step 2: Run to see them fail**

Run: `deno test supabase/functions/__tests__/hub-auth_test.ts --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** the four files. The handler resolves the workspace by slug and the token with `resolveHubToken(db, token, now, conta.id)` exactly as `hub-bootstrap/handler.ts:37-58` does (including `hub_enabled`). `index.ts` follows `affiliate-public/index.ts` for client creation and wiring.

- [ ] **Step 4: Run tests and `npm run check:functions`.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-auth supabase/functions/__tests__/hub-auth_test.ts supabase/config.toml supabase/functions/_shared/email-classify.ts supabase/functions/__tests__/email-classify_test.ts
git commit -m "feat(hub-auth): login do cliente por código enviado por e-mail"
```

---

### Task 5: Switch the other 17 hub functions and record who acted

**Files:**
- Create: `supabase/functions/__tests__/hub-access-structural_test.ts`
- Modify (handler.ts): `hub-agenda`, `hub-approve`, `hub-brand`, `hub-briefing`, `hub-dashboard`, `hub-edit-suggestion`, `hub-ideias`, `hub-instagram-feed`, `hub-linha-editorial`, `hub-media-notes`, `hub-mensagens`, `hub-pages`, `hub-post-history`, `hub-post-references`, `hub-posts`
- Modify (index.ts): `hub-reports`, `hub-report-docs`
- Modify: every `supabase/functions/__tests__/hub-*_test.ts` whose mock `rpc` must answer `hub_access_context` (use `hubAccessRpc`)

**Interfaces:**
- Consumes: `resolveHubAccess`, `hubAccessDenied`, `hubAccessRpc` (Task 2); the recreated RPCs and columns (Task 1).
- Produces: every hub endpoint answers 401 `code: "login_required"` when gated; `post_approvals` and `mensagens` rows written by a logged-in person carry `hub_person_id` and `hub_person_nome`; `hub-posts` and `hub-post-history` approval DTOs gain `hub_person_nome: string | null`.

- [ ] **Step 1: Write the failing structural test**

`hub-access-structural_test.ts` reads every `handler.ts` and `index.ts` under `supabase/functions/hub-*/` and asserts none contains `resolveHubToken(`, except `hub-auth/handler.ts`. For `hub-report-docs/index.ts` it also asserts the `/print-doc/` branch is reached before any `resolveHubAccess(` call (compare `indexOf`), since that path authenticates with the `pt` print token and must stay ungated. Also assert each of those files contains `resolveHubAccess(`, except `hub-auth`.

- [ ] **Step 2: Run to see it fail**

Run: `deno test supabase/functions/__tests__/hub-access-structural_test.ts --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys`
Expected: FAIL listing 17 files.

- [ ] **Step 3: Mechanical switch in the 17 files**

Each call site looks like `hub-mensagens/handler.ts:45-50`. Replace the lookup and its bad-token block with:

```ts
const access = await resolveHubAccess(db as any, req, token, deps.now());
if (!access.ok) return hubAccessDenied(access.reason, { db, req, json, rateLimit: deps.rateLimit });
const hubToken = access.token;
```

`hub-reports/index.ts` and `hub-report-docs/index.ts` have no `deps`; pass their own `checkRateLimit` and JSON responder. Where a handler had no bad-token rate limit before, it gains one through the helper (accepted). Everything after the block stays as is.

- [ ] **Step 4: Add the attribution tests** (failing first)

- `hub-functions_test.ts` or a new block next to the existing `hub-approve` tests: with `hub_access_context` answering a person, an `aprovado` call passes `p_hub_person_id` and `p_hub_person_nome` to `record_client_approval_with_notes`; a `mensagem` call inserts `hub_person_id` and `hub_person_nome` into `post_approvals`; with no person, the RPC params contain neither key set to a value (both null) and the insert has both null.
- `hub-mensagens_test.ts`: the `mensagens` insert carries the two columns when a person is present.
- `hub-post-history_test.ts:121`: the pinned select becomes `"id, action, comentario, motivo, is_workspace_user, hub_person_nome, created_at"`, and the DTO test expects `hub_person_nome` on client rows.
- `hub-posts-*_test.ts`: the `post_approvals` select gains `hub_person_nome` (grep both test trees first: `grep -rn "is_workspace_user, created_at" supabase/functions/__tests__ apps/hub/src`).
- One gated case per write endpoint family is enough: `hub-approve` with `hubAccessRpc("hub_access_context", { require_login: true, person: null })` → 401 and no insert.

- [ ] **Step 5: Implement attribution**

`hub-approve/handler.ts`: pass `p_hub_person_id: access.person?.id ?? null`, `p_hub_person_nome: access.person?.nome ?? null` to the RPC (~line 233) and the same two columns on the `mensagem` insert (~line 222). `hub-mensagens/handler.ts`: same two columns on the insert (~line 126). `hub-post-history/handler.ts:191` and `hub-posts/handler.ts:387`: add `hub_person_nome` to the select and pass it through the DTO builders. Never return `hub_person_id` or the person's email to the Hub.

- [ ] **Step 6: Server-built links.** Run `grep -rn "hub-agenda/\|\.ics" supabase/functions/_shared/agenda-cliente-email.ts supabase/functions/agenda-cliente-email supabase/functions/agenda-feed`. `agenda-feed` and `agenda-convite` have their own tokens and stay as they are. If a client email links straight to a `hub-agenda/...ics?token=` URL, that link answers 401 for a gated client: keep it for clients with the switch off and, when `hub_client_settings.require_login` is true, link to the Hub agenda page instead (add a test for both).

- [ ] **Step 7: Fix every hub test mock**, then run the whole Deno suite

Run: `npm run check:functions && npm run test:functions`
Expected: PASS, including the structural test.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions
git commit -m "feat(hub): todas as functions do Hub exigem sessão quando o cliente pede login"
```

---

### Task 6: Hub client: session storage, header, error body, auth calls

**Files:**
- Create: `apps/hub/src/lib/hubSession.ts`, `apps/hub/src/lib/__tests__/hubSession.test.ts`
- Modify: `apps/hub/src/api.ts`, `apps/hub/src/services/postReferences.ts`, `apps/hub/src/queries.ts`, `apps/hub/src/types.ts`
- Modify: `apps/hub/src/pages/agenda/AgendaCard.tsx`, `AgendaCardView.tsx`
- Test: `apps/hub/src/__tests__/api.test.ts`, `queries.test.tsx`, the existing `postReferences` and `AgendaCard` tests

**Interfaces:**
- Produces, `lib/hubSession.ts`: `getHubSession(): string | null`, `setHubSession(token: string): void`, `clearHubSession(): void`, `HUB_SESSION_STORAGE_KEY = 'mesaas:hub-session'`. Every access is inside try/catch; unavailable storage reads as null. No module-level storage access.
- Produces, `api.ts`:
  - `HubApiError` constructor gains a 4th optional argument and a `readonly body?: Record<string, unknown>` (the parsed error JSON).
  - `hubHeaders(base?: Record<string, string>): Record<string, string>` exported: `{ apikey: ANON, ...base }` plus `x-hub-session` when a session exists. Used by `get`, `post`, `patch`, `del` and `postReferences.ts`.
  - `get`/`post` take the header only for functions whose name starts with `hub-`. `agenda-convite` calls must send exactly today's headers.
  - `reorderPostSchedules`, `deleteIdeiaImage`, `fetchReportHtml` go through `request()` (so they throw `HubApiError` with `code`). `fetchReportHtml` returns text: give `request` a small `parse: 'json' | 'text'` option rather than a second fetch path.
  - `requestLoginCode(workspace: string, token: string, email: string): Promise<{ ok: true }>`
  - `verifyLoginCode(workspace: string, token: string, email: string, code: string): Promise<{ session_token: string }>`
  - `logoutHub(): Promise<{ ok: true }>`
  - `downloadAgendaIcs(token: string, ocorrenciaId: number): Promise<void>`: fetches the `.ics` with `hubHeaders()`, saves it from a blob (`URL.createObjectURL`, a temporary `<a download>`, revoke after).
  - `isLoginRequired(error: unknown): boolean` → `error instanceof HubApiError && error.code === 'login_required'`.
- Produces, `types.ts`: `HubBootstrap` gains `person: { nome: string; email: string } | null` and `require_login: boolean` (both optional on the wire: an older function omits them); `HubLoginPayload = { workspace: { name: string; logo_url: string | null; brand_color: string }; hub_theme: HubBootstrap['hub_theme'] }`; `PostApproval` and the mensagens item type gain `hub_person_nome?: string | null` / `client_person_name?: string | null`.
- Produces, `queries.ts`: `createHubQueryClient` installs a `QueryCache` and `MutationCache` `onError` that, when `isLoginRequired(error)` **and `getHubSession()` is not null**, calls `clearHubSession()` and `queryClient.invalidateQueries({ queryKey: ['hub-bootstrap'] })`. With no stored session it does nothing.

- [ ] **Step 1: Write the failing tests**

- `hubSession.test.ts`: round trip; `localStorage.getItem` throwing → `getHubSession()` null and `setHubSession` does not throw.
- `api.test.ts`:
  - with a stored session, `fetchPosts` sends `x-hub-session`; without one, the header is absent.
  - `fetchConvite` (agenda-convite) never sends it, with or without a session.
  - a 401 `{ error, code: 'login_required', login: {...} }` rejects with `HubApiError` whose `body.login.workspace.name` is readable.
  - `reorderPostSchedules`, `deleteIdeiaImage`, `fetchReportHtml` reject with `HubApiError` and `code === 'login_required'` on a 401; `fetchReportHtml` still resolves the HTML string on 200.
  - `verifyLoginCode` posts `{ action: 'verify_code', workspace, token, email, code }` to `hub-auth`.
- `queries.test.tsx`:
  - a `login_required` failure with a stored session clears it and invalidates `['hub-bootstrap', ...]` once.
  - a `login_required` failure with **no** stored session leaves storage alone and invalidates nothing (Review Focus 4; assert the bootstrap `queryFn` call count stays at 1).
- `postReferences` test: with a stored session the `fetch` and the `XMLHttpRequest` both carry the header; a 401 `login_required` maps to a new `ReferenceErrorCode` `'login_required'`, not `'internal'`.
- `AgendaCard` test: `bootstrap.require_login` true → the calendar control is a button that calls `downloadAgendaIcs`; false → the plain `href` link as today.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run apps/hub/src/__tests__/api.test.ts apps/hub/src/__tests__/queries.test.tsx apps/hub/src/lib/__tests__/hubSession.test.ts`

- [ ] **Step 3: Implement.** In `postReferences.ts`, add `'login_required'` to `ReferenceErrorCode` and give it a message in the component that renders those errors (grep `PostReferenceError` in `apps/hub/src`); it must also reach the global handler, so rethrow a `HubApiError`-compatible signal or call the same clear-and-invalidate helper exported from `queries.ts`. Grep for other plain hub links: `grep -rn "functions/v1\|window.open" apps/hub/src --include='*.ts*'` and treat any `hub-*` URL opened without headers like the `.ics` one.

- [ ] **Step 4: Run the Hub suite and typecheck**

Run: `npx vitest run apps/hub && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src
git commit -m "feat(hub): sessão do cliente em todas as chamadas do Hub"
```

---

### Task 7: Hub login screens and account menu

**Files:**
- Create: `apps/hub/src/shell/HubLogin.tsx`, `apps/hub/src/shell/HubAccountMenu.tsx`
- Create: `apps/hub/src/shell/__tests__/HubLogin.test.tsx`, `HubAccountMenu.test.tsx`
- Modify: `apps/hub/src/shell/HubShell.tsx` (~line 142), `HubSidebar.tsx`, `HubMobileNav.tsx`, `apps/hub/src/HubContext.tsx`
- Modify: `packages/i18n/locales/pt/common.json`, `packages/i18n/locales/en/common.json` (under `hub`)
- Modify: `apps/hub/index.html` only if a `.hub-*` rule is missing for the code input

**Interfaces:**
- Consumes: `requestLoginCode`, `verifyLoginCode`, `logoutHub`, `isLoginRequired`, `HubApiError.body`, `HubLoginPayload`, `setHubSession`, `clearHubSession` (Task 6); `resolveHubTheme` from `apps/hub/src/theme.ts`.
- Produces:
  - `<HubLogin workspace token login={HubLoginPayload} onLoggedIn={() => void} />`
  - `<HubAccountMenu person={{ nome, email }} onSignOut={() => void} />`
  - `HubContextValue` gains `person: { nome: string; email: string } | null`.
- pt strings (exact; `en` gets the translation), keys under `hub.login` and `hub.account`:

| Key | pt |
|---|---|
| `login.emailTitle` | Entre no seu portal |
| `login.emailBody` | Digite o e-mail que a agência cadastrou. Vamos enviar um código de 6 dígitos. |
| `login.emailLabel` | E-mail |
| `login.sendCode` | Enviar código |
| `login.noAccess` | Não tem acesso? Fale com a {{agency}}. |
| `login.codeTitle` | Digite o código |
| `login.codeBody` | Se este e-mail tiver acesso, o código chega em instantes em {{email}}. |
| `login.codeLabel` | Código de 6 dígitos |
| `login.enter` | Entrar |
| `login.resendIn` | Reenviar código em {{time}} |
| `login.resend` | Reenviar código |
| `login.otherEmail` | Usar outro e-mail |
| `login.validity` | O código vale por 10 minutos. |
| `login.invalidCode` | Código inválido ou expirado. |
| `login.tooMany` | Muitas tentativas. Aguarde alguns minutos. |
| `login.genericError` | Não foi possível continuar. Tente de novo. |
| `account.menuLabel` | Conta de {{name}} |
| `account.signOut` | Sair |

- [ ] **Step 1: Write the failing tests**

`HubLogin.test.tsx`:
- email step renders the agency name from `login.workspace.name` and the `noAccess` line with it; "Enviar código" is disabled for an empty or malformed email.
- submit calls `requestLoginCode(workspace, token, email)` and moves to the code step, which shows the typed email.
- the code input has `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength={6}`, and a computed font size of 16px or more (class check); non-digits are stripped.
- a 6-digit code + "Entrar" calls `verifyLoginCode`; on success `setHubSession(session_token)` is called and then `onLoggedIn`.
- `HubApiError` 400 → `login.invalidCode` in an element with `role="alert"`, the input keeps focus; 429 → `login.tooMany`.
- with fake timers: "Reenviar código em 0:59" counts down, at 0 becomes a button that calls `requestLoginCode` again and restarts at 60.
- "Usar outro e-mail" returns to the email step with the field cleared.

`HubAccountMenu.test.tsx`: the trigger shows the initials ("Marina Costa" → "MC"), has `aria-label` "Conta de Marina Costa"; opening shows name, email and "Sair"; "Sair" calls `onSignOut`.

`HubShell.test.tsx` (extend):
- bootstrap rejects with `HubApiError(…, 401, 'login_required', { login })` → `HubLogin` renders and `hub.invalidLink` does not; the accent CSS variable comes from `login.workspace.brand_color`.
- a 404 still renders `hub.invalidLink`.
- after `onLoggedIn`, `queryClient.invalidateQueries()` is called with no filter (all hub queries).
- bootstrap with `person` → the account menu is rendered; `person: null` → it is not.
- mid-session 401: the bootstrap query holds earlier `data` and then a refetch fails with `login_required` → `HubLogin` renders, not the portal (check `error` before `data`; the login payload comes from the error's `body`).
- sign out: `logoutHub` then `clearHubSession`, then all queries invalidated (a gated hub lands on the login screen through the refetched bootstrap; an open hub stays in, anonymous).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run apps/hub/src/shell`

- [ ] **Step 3: Implement.** Layout follows the approved mockups (`Hub-Login-Email`, `Hub-Login-Codigo`, `Hub-Conta` in the artifact): centred logo or initial tile, Fraunces title, 48px email input, 56px code input, full-width primary button, footer line pinned to the bottom. Use the existing `hub-*` classes and theme variables; apply `resolveHubTheme(login.workspace.brand_color, isDark)` the same way `HubShell` does for a loaded bootstrap. Put the account trigger where the mockup shows it (top right of the page header on mobile; bottom of `HubSidebar` on desktop), in both `classic` and `pauta` looks. Add the strings to both locale files.

- [ ] **Step 4: Run Hub tests, i18n parity and typecheck**

Run: `npx vitest run apps/hub packages/i18n && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub packages/i18n
git commit -m "feat(hub): tela de login por código e menu da conta"
```

---

### Task 8: CRM "Quem pode entrar" on the Acesso page

**Files:**
- Create: `apps/crm/src/store/hubPeople.ts`, `apps/crm/src/store/__tests__/hubPeople.test.ts`
- Create: `apps/crm/src/pages/cliente-detalhe/hub/HubPeopleSection.tsx`, `__tests__/HubPeopleSection.test.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/hub/AcessoPage.tsx` (desktop branch and the phone branch at ~line 215), `__tests__/AcessoPage.test.tsx`
- Modify: `packages/i18n/locales/pt/clientHub.json`, `en/clientHub.json` (under `acesso.people`)
- Modify: `apps/crm/app.css` only if a rule is needed (signed-in shell only)

**Interfaces:**
- Consumes: the four CRM RPCs (Task 1).
- Produces, `store/hubPeople.ts`:

```ts
export interface HubPerson { id: string; nome: string; email: string; last_login_at: string | null; created_at: string }
export interface HubPeopleData { require_login: boolean; people: HubPerson[] }
export type HubPeopleErrorCode = 'forbidden' | 'not_found' | 'invalid' | 'duplicate' | 'limit' | 'no_people' | 'last_person' | 'generic';
export const HUB_PEOPLE_LIMIT = 20;
export function hubPeopleKey(clienteId: number): readonly ['hub-people', number];
export async function getHubPeople(clienteId: number): Promise<HubPeopleData>;
export async function addHubPerson(clienteId: number, nome: string, email: string): Promise<string>;
export async function removeHubPerson(personId: string): Promise<void>;
export async function setHubRequireLogin(clienteId: number, value: boolean): Promise<void>;
export function hubPeopleErrorCode(e: { message?: string }): HubPeopleErrorCode;
```
- Produces: `<HubPeopleSection clienteId={number} clienteNome={string} clienteEmail={string | null} variant="desktop" | "phone" />`, rendered by `AcessoPage` inside the existing `HubRoleGate`, only when a link exists (`tokenData` set).
- pt strings (exact), under `acesso.people`:

| Key | pt |
|---|---|
| `title` | Quem pode entrar |
| `requireLabel` | Exigir login |
| `requireHelp` | Com o login ligado, o link abre uma tela de entrada. Só as pessoas da lista entram, com um código enviado por e-mail. |
| `requireOffHelp` | Com o login desligado, qualquer pessoa com o link abre o portal. |
| `empty` | Ninguém na lista ainda. Adicione a primeira pessoa para poder exigir login. |
| `neverLoggedIn` | Nunca entrou |
| `lastLogin` | Último acesso em {{date}} |
| `nameLabel` | Nome |
| `emailLabel` | E-mail |
| `add` | Adicionar pessoa |
| `remove` | Remover {{name}} |
| `removeTitle` | Remover {{name}}? |
| `removeBody` | Essa pessoa perde o acesso ao portal na hora. |
| `removeConfirm` | Remover |
| `toast.added` | Pessoa adicionada. |
| `toast.removed` | Pessoa removida. |
| `toast.requireOn` | Login exigido para este cliente. |
| `toast.requireOff` | Login não é mais exigido. |
| `errors.duplicate` | Este e-mail já está na lista. |
| `errors.limit` | O limite é de 20 pessoas por cliente. |
| `errors.no_people` | Adicione ao menos uma pessoa antes de exigir login. |
| `errors.last_person` | Desligue "Exigir login" antes de remover a última pessoa. |
| `errors.invalid` | Confira o nome e o e-mail. |
| `errors.forbidden` | Você não tem permissão para alterar o acesso. |
| `errors.not_found` | Cliente não encontrado. |
| `errors.generic` | Não foi possível salvar. Tente de novo. |

- [ ] **Step 1: Write the failing tests**

`hubPeople.test.ts`: each function calls the right RPC with the right argument names (`p_cliente_id`, `p_nome`, `p_email`, `p_person_id`, `p_value`); `hubPeopleErrorCode({ message: 'last_person' })` → `'last_person'` for each of the seven codes, anything else → `'generic'`.

`HubPeopleSection.test.tsx` (mock the store module):
- empty list: the add row is pre-filled with `clienteNome` and `clienteEmail`; the switch is disabled and `empty` is shown.
- with people: each row shows name, email, and `neverLoggedIn` or the formatted last access; the add row is empty.
- adding calls `addHubPerson(clienteId, nome, email)`, shows `toast.added`, invalidates `hubPeopleKey(clienteId)`, clears the row.
- each error code shows its own message through `toast.error`, and the raw Postgres text never appears.
- at 20 people the add row is replaced by the `errors.limit` line.
- toggling the switch calls `setHubRequireLogin(clienteId, true)`; on error the switch returns to its previous position.
- remove opens a confirm (`AlertDialog` on desktop, `PhoneConfirmSheet` on phone) and only then calls `removeHubPerson`.
- the remove button's accessible name is "Remover Marina Costa".
- `variant="phone"` renders `GroupedList` cells, no table.

`AcessoPage.test.tsx`: the section appears with a link and for a user who passes `HubRoleGate`; it is absent with no link and absent for an agent (and `getHubPeople` is not called for the agent: gate the query with `useHubPortalDataEnabled()`).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub apps/crm/src/store/__tests__/hubPeople.test.ts`

- [ ] **Step 3: Implement.** Follow the approved `Main.dc.html` mockup for the desktop card (switch row with helper, list, add row) and the existing phone markup on the same page (`phone-cli-card`, `GroupedList`, `Cell`) for the phone variant. Use the shadcn `Switch`, `Input`, `Button`, `AlertDialog`; `toast` from `sonner`; `lucide-react` icons; dates with `date-fns` and the page's `dateLocale`. The add form is `react-hook-form` + `zod` (name 1 to 80, valid email). Keep `mapTokenError` untouched; the people errors use `hubPeopleErrorCode`.

- [ ] **Step 4: Run CRM tests for the touched paths, the CSS guards and typecheck**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe apps/crm/src/store/__tests__/hubPeople.test.ts apps/crm/src/__tests__/cssSplitBoundary.test.ts packages/i18n && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm packages/i18n
git commit -m "feat(crm): lista de pessoas e exigir login na página de Acesso do cliente"
```

---

### Task 9: Show who approved and who wrote

**Files:**
- Modify (CRM): `apps/crm/src/pages/entregas/components/HistoryDrawer.tsx` (~418), `PostEditorBody.tsx`, `postEditorPhone/PhoneComments.tsx`, `apps/crm/src/pages/mensagens/components/ConversationThread.tsx` (~173), `phone/ConversationThreadPhone.tsx`, `mensagensLogic.ts`, `apps/crm/src/store/mensagens.ts` (row type), `apps/crm/src/store/posts.ts` (approval type)
- Modify (Hub): `apps/hub/src/components/PostHistoryPanel.tsx` (~393, `actorLabel`), `PostCard.tsx`, `apps/hub/src/pages/MensagensPage.tsx` (~209), `apps/hub/src/lib/postHistory.ts`
- Tests: the existing test next to each file

**Interfaces:**
- Consumes: `post_approvals.hub_person_nome` (the CRM reads `post_approvals` with `*`, and the table has no column grants, so the column arrives with no store change beyond the type); `client_person_name` from `get_mensagens_feed`; `hub_person_nome` in the Hub DTOs (Task 5).
- Produces: one rule, applied at every site: for a client row (`is_workspace_user` false), the author label is the person's name when present, otherwise today's label. Team rows are unchanged.

- [ ] **Step 1: Confirm the column reaches the CRM**

Run: `grep -n "post_approvals" supabase/migrations/*.sql | grep -i "grant\|revoke"`
Expected: no column-level grant. If one exists, add `hub_person_nome` to it in the Task 1 migration before continuing.

- [ ] **Step 2: Write the failing tests**, one pair per site (name present / absent):

- `HistoryDrawer`: a client approval with `hub_person_nome: 'Marina Costa'` shows "Marina Costa" beside the "Aprovou" badge; without it, the current client label.
- CRM `ConversationThread` (desktop and phone): a client message with `client_person_name` shows the name; without it the current label; a team row still shows `author_name`.
- `mensagensLogic`: if `last_author_name` is derived from feed rows, it uses the person's name for client rows when present. If it comes from a separate RPC (check `store/mensagens.ts`), leave it unchanged and say so in the commit message.
- Hub `PostHistoryPanel` and `MensagensPage`: a client row written by someone else on the same client shows that person's name; the viewer's own rows keep their current treatment.

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/mensagens apps/hub/src/components apps/hub/src/pages`

- [ ] **Step 4: Implement** the rule at each site and extend the two row types. Names are user data: render as text (React escapes it); nothing here builds raw HTML.

- [ ] **Step 5: Run the same tests plus both typechecks.** Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm apps/hub
git commit -m "feat: aprovações e mensagens mostram o nome de quem entrou no Hub"
```

---

### Task 10: Docs, full gates and end-to-end check

**Files:**
- Modify: `CLAUDE.md` (Gotchas: add `hub-auth` to the `--no-verify-jwt` list and a "Login do cliente no Hub" entry with the deploy order and rollback from the spec)
- Modify: `README.md:28` (function count 89 → 90)
- Modify: `apps/mobile/DECISIONS.md` (one line under D1 pointing to the spec: identity now exists, the app is phase 2)
- Check: `supabase/functions/data-import/handler.ts:505-580`

- [ ] **Step 1: data-import registry.** Read the client-children registry. If it is a list that undo must know to delete imported clients, add `hub_client_people` and `hub_client_settings` only if a missing child blocks the delete; both cascade from `clientes`, so the expected outcome is no change. Note the decision in the commit message.

- [ ] **Step 2: Write the CLAUDE.md entry.** It must state: spec path; tables are service-role only and the CRM writes through `hub_people_*` / `hub_set_require_login`; every `hub-*` function must call `resolveHubAccess` (structural test); deploy order migration → `hub-auth` (`--no-verify-jwt`) + the 18 hub functions → merge; rollback: `update hub_client_settings set require_login = false` first, then frontend, then functions.

- [ ] **Step 3: Run every CI gate**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
bash scripts/test-entitlements.sh
```
Expected: all pass. Also run `TZ=UTC npx vitest run apps/hub apps/crm/src/pages/cliente-detalhe` (CI clock).

- [ ] **Step 4: Browser check against local Supabase** (Hub dev on :5175, CRM on :5173)

1. CRM, a client's Acesso page: add a person, turn "Exigir login" on. Screenshot.
2. Open the Hub link in the Browser pane: the login screen shows the agency's name and accent, not "Link inválido".
3. Seed a known code as service role: `select hub_login_issue(<cliente_id>, '<email>', '123456');` then type the email, then `123456`. The portal opens and the account menu shows the initials.
4. Approve a post in the Hub; in the CRM, the post history shows the person's name.
5. In the CRM remove the person (switch off first, or add a second person); reload the Hub: back to the login screen.
6. "Sair" on an open (switch off) hub leaves the user inside, anonymous.
7. Resize to 375px wide and repeat step 2 (16px inputs, no zoom, no horizontal scroll). Check dark appearance.

- [ ] **Step 5: Re-check the migration prefix**

Run: `git fetch origin main && git ls-tree --name-only origin/main supabase/migrations/ | tail -3`
Expected: nothing at or above `20261128000001`. Otherwise rename the file and update the references in this plan's commit and in `CLAUDE.md`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md apps/mobile/DECISIONS.md
git commit -m "docs: login do cliente no Hub (ordem de deploy e rollback)"
```

Not in this plan (the user does these, in the spec's deploy order): `db push` to staging and prod, deploying `hub-auth` and the 18 hub functions, opening the PR and the Codex review.
