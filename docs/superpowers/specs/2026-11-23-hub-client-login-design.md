# Hub client login (people per client, email code)

**Date:** 2026-11-23
**Status:** design approved in conversation, pending written-spec approval. Revised after a
builder check and an external review (both verified against the code).
**Mockups (approved 2026-11-23):** https://claude.ai/artifact/Q5r3XPHgABEqMB4RdTkjAw

## Intent and why

Agencies keep asking for a Client Hub app. `apps/mobile/DECISIONS.md` D1 rejected one for two
reasons: the Hub is an open link with no identity (so there is nobody to send push to), and a
per-agency app is the App Store template-app pattern. Giving clients a real login removes the
first reason and makes a single generic app possible.

This spec is **phase 1: client login on the web Hub**. It is useful on its own (a secure option
for agencies, approvals that say who approved) and it is the foundation the app needs. The app
(Capacitor shell, required login, push) is **phase 2 and gets its own spec**.

## What the user decided

- Clients can have a login. It is **optional on the web Hub** and will be **required in the app**.
- Each client has a **list of people, managed by the agency**. Each person logs in with their own
  email.
- Client login is available on **every plan that has the Hub** (no new entitlement flag).
- The mockups above are approved.

## Goals

1. The agency manages, per client, a list of people (name + email) who may log in to that
   client's Hub.
2. A per-client switch, "Exigir login", makes the existing Hub link open a login screen first.
   Off (the default), the link works exactly as today.
3. A person logs in with their email and a 6-digit code sent by email. No password.
4. Approvals, corrections and messages made by a logged-in person record who made them, and the
   CRM shows the name.
5. Removing a person ends their access on the next request.

## Non-goals

- The iOS/Android app, push to clients, universal links (phase 2).
- Login with Google or Apple. Later, as shortcuts on top of the email code. Reasons recorded
  below under Approaches.
- Per-person permissions (view-only people). Everyone on the list has the same access.
- Sending client emails per person. Client emails keep going to `clientes.email`.
- A hub picker for an email that belongs to several clients (needed by the app, not the web: on
  the web the link already says which hub).
- Changing `resolveHubToken` semantics for links with "Exigir login" off, link expiry, rotation,
  or `max_hub_tokens`.

## Anti-goals

- A client must never become a CRM user. No row in `auth.users` for a client.
- Nothing may reveal whether an email is on a client's list to someone who only has the link.
- Turning the feature on must not break any existing link, and deploying it must not change the
  behaviour of any hub with the switch off.

## Constraints found in the code

- **Supabase Auth is not usable for clients.** The `on_auth_user_created_workspace` trigger
  creates a workspace for every new `auth.users` row that is not an invite, and
  `on_auth_user_created_zz_affiliate_referral` runs after it.
- **Precedent to copy:** `supabase/functions/affiliate-public/` (handler + `logic.ts`) and
  `affiliate_access_tokens` (migration `20261013000001`). 32 random bytes base64url, only the
  SHA-256 hash stored, service-role-only table, exchange done in one RPC, identical responses
  whether or not the email exists.
- **One chokepoint.** Every hub endpoint resolves access with `resolveHubToken`
  (`supabase/functions/_shared/hub-token.ts`); 18 handlers call it today
  (`grep -rl resolveHubToken supabase/functions`). None of them passes the `Request`. Two of
  them live in `index.ts`, not `handler.ts` (`hub-reports`, `hub-report-docs`). The only other
  hub auth path is `hub-report-docs` `/print-doc/` (its own `pt` print token, used by
  Gotenberg), which must stay ungated.
- **A client can have several link rows.** `client_hub_tokens` has only `UNIQUE(token)`; the
  CRM reads the newest row (`store/hub.ts` `getHubToken`) and inserts and updates the table
  directly under the `client_hub_tokens_workspace_all` FOR ALL policy, with no column grants.
  So a per-token setting could be bypassed by an older link or by a direct PostgREST write.
- **CORS.** `buildCorsHeaders` allows only `authorization, x-client-info, apikey, content-type`.
  A new request header must be added there.
- **Hub client.** Most calls go through `request()` in `apps/hub/src/api.ts` (`get`, `post`,
  `patch`, `del`, each building its own headers), but three use a raw `fetch` and throw a plain
  `Error` without `code` (`reorderPostSchedules` ~177, `deleteIdeiaImage` ~377,
  `fetchReportHtml` ~437), `services/postReferences.ts` has its own `fetch` and
  `XMLHttpRequest` and collapses unknown errors to `internal`, and `agendaIcsUrl` (~571) is a
  plain link with no headers. `agenda-convite` (the guest invite, not a hub endpoint) also goes
  through `get`/`post`.
- **Startup prefetch.** `prefetchHubShell` (`queries.ts`) requests bootstrap and posts together
  before anything renders. `request()` keeps only `error`, `status` and `code` from an error
  body.
- **Approval writes.** `aprovado` and `correcao` insert through the RPC
  `record_client_approval_with_notes` -> `record_client_approval`; only `mensagem` is a direct
  insert in `hub-approve`. Client messages live in `mensagens` (`is_workspace_user = false`),
  read through `get_mensagens_feed` (RETURNS TABLE, `author_name` from workspace members only).
- **Bootstrap error path.** `HubShell` renders `hub.invalidLink` for any bootstrap error.
  `HubApiError` already carries `status` and `code`.
- **Acesso por cliente.** A new `public` table with `cliente_id` fails
  `supabase/tests/entitlements/99_acesso_por_cliente_drift.sql` until it has the scope predicate
  or a commented exemption, and any new SECURITY DEFINER function that reads or writes client
  data needs the same filter (CLAUDE.md, "Acesso por cliente").
- **CRM gate.** The Acesso page already hides the link from anyone without
  `configuracoes:editar` (`HubRoleGate`, `useHubPortalDataEnabled`). The people list uses the
  same gate.
- **Email.** Every new send needs a Resend `type` tag and an entry in `EMAIL_TYPES`
  (`_shared/email-classify.ts`); `sendViaResend` takes `tags` as its 9th argument. Staging has
  no `RESEND_API_KEY`.
- **Copy.** pt-BR, no em dashes, through `packages/i18n` like the rest of the Acesso page and
  the Hub.

## Approaches

1. **Own sessions, email code (chosen).** New tables and a `hub-auth` function following the
   affiliate pattern. The session belongs to a verified email and is checked against the
   client's people list on every request. Costs: we own code issuance, rate limiting and
   session storage. Gains: no `auth.users` rows, instant removal without hunting sessions, and
   one login can open several hubs later (the app's hub picker) with no rework.
2. **Supabase Auth users for clients.** Reuses OTP, sessions and OAuth providers. Rejected: the
   signup triggers would create a workspace per client, every RLS policy written for
   "authenticated = agency staff" would have to be re-audited, and a client email that is also
   a CRM user becomes ambiguous.
3. **Google / Apple sign-in first.** Rejected for phase 1: the App Store requires Sign in with
   Apple wherever Google is offered, Google blocks OAuth inside embedded web views (the app
   would need native code for it), and the consent screen shows "Mesaas" to clients of agencies
   that hide the brand. The email code works identically on web and in the app. Approach 1
   leaves room to add both later: they would only be another way to verify an email.

The user picked the direction (list of people, optional on web, required in app, all Hub
plans); approach 1 and the items marked "my call" below are the designer's.

## Design

### Data model (one migration)

- **`hub_client_people`**: `id uuid pk`, `conta_id uuid not null`, `cliente_id bigint not null
  references clientes(id) on delete cascade`, `nome text not null` (trimmed, 1..80),
  `email text not null` (stored normalized: trimmed, lower case), `created_at`,
  `created_by uuid`, `last_login_at timestamptz null`. `unique (cliente_id, email)`. Cap of 20
  people per client, enforced in the write path (my call).
- **`hub_client_settings`**: `cliente_id bigint pk references clientes(id) on delete cascade`,
  `conta_id uuid not null`, `require_login boolean not null default false`, `updated_at`,
  `updated_by`. The switch is **per client, not per link row**, so it covers every link the
  client has, and it is not a column on `client_hub_tokens` (that table is directly writable by
  any workspace member) nor on `clientes` (column-grant allowlist). No row means false.
- **`hub_login_codes`**: `id`, `cliente_id` (the client whose link requested it), `email`, `code_hash` (SHA-256 of the code plus a per-row salt),
  `expires_at` (10 minutes), `attempts int default 0`, `used_at`. Service role only.
- **`hub_sessions`**: `token_hash text pk` (SHA-256, same check constraint as
  `affiliate_access_tokens`), `email text not null`, `created_at`, `last_used_at`,
  `expires_at`. Service role only. A session belongs to an **email**, not to a person row.
- **Authorship columns:** `post_approvals.hub_person_id uuid null references
  hub_client_people(id) on delete set null` and `post_approvals.hub_person_nome text null`
  (a snapshot, so the name survives removal). The same pair on `mensagens`.
- **RPCs recreated in the same migration:** `record_client_approval` and
  `record_client_approval_with_notes` gain trailing `p_hub_person_id uuid DEFAULT NULL,
  p_hub_person_nome text DEFAULT NULL` (drop the old signatures, keep their REVOKE/GRANT; the
  defaults keep the currently deployed `hub-approve` call resolving). `get_mensagens_feed` is
  dropped and recreated with one more returned column, `client_person_name`; `author_name`
  keeps meaning the team member. Hub and CRM show `client_person_name` on client rows when set.
- **Migration version:** pick a prefix above main's tail at PR time (the tail is
  `20261127000001` today; `20261123000001` is taken).

Access rules:

- `hub_login_codes` and `hub_sessions`: RLS on, `service_role` policy only, `REVOKE ALL` from
  `PUBLIC, anon, authenticated` (name the roles; `REVOKE FROM PUBLIC` alone is not enough here).
- `hub_client_people` and `hub_client_settings` are read and written by the CRM **only through
  SECURITY DEFINER RPCs** (my call; it keeps the invariants below in one place and gives an
  audit trail). Both tables get RLS with a `service_role` policy only and no grants for
  `authenticated`, so there is no direct PostgREST path around the RPCs:
  `hub_people_list(p_cliente_id)` (also returns `require_login`),
  `hub_people_add(p_cliente_id, p_nome, p_email)`, `hub_people_remove(p_person_id)`,
  `hub_set_require_login(p_cliente_id, p_value)`. Note the existing `hub_token_rotate` /
  extend RPCs check only `get_my_conta_id()`; do not copy their checks. Each checks workspace membership,
  `configuracoes:editar` (`has_permission_for`), and the acesso-por-cliente scope
  (`scope_check_*` helpers), and writes `audit_log`. The table gets no grants for
  `authenticated`, plus the drift-test exemption comment.
- Invariants enforced inside the RPCs, under a per-client advisory lock:
  `require_login` cannot be set to true with zero people (`no_people`); the last person cannot
  be removed while `require_login` is true (`last_person`); duplicate email (`duplicate`);
  cap reached (`limit`). The CRM maps these codes to toasts; raw Postgres text never reaches
  the user (same rule as `mapTokenError`).
- **Seeding (my call):** nothing is inserted by the migration. The CRM pre-fills the add-person
  row with the client's `nome` and `email` when the list is empty, so the agency confirms the
  first person with one click. A silent backfill would grant access the agency never reviewed.

### Server: resolving access

Add `resolveHubAccess(db, req, token, now, expectedContaId?)` to `_shared/hub-token.ts`. It
returns one of:

- `{ ok: true, token: HubToken, person: { id, nome, email } | null }`
- `{ ok: false, reason: 'invalid' }` (what `resolveHubToken` returning null means today)
- `{ ok: false, reason: 'login_required' }`

Logic: resolve the token as today, then read `hub_client_settings.require_login` for the
token's `cliente_id`. Every read here must check its `error` and fail closed with a 500, never
fall through as "not required" or "invalid link". Read the session from
the `x-hub-session` request header; if present and valid (hash match, not expired), look up
`hub_client_people` by `(cliente_id, session.email)`. A match yields `person`. If
`require_login` is true and there is no `person`, the result is `login_required`. If
`require_login` is false, a missing or non-matching session is fine: `person` is null and the
request proceeds as today.

All 18 handlers switch from `resolveHubToken` to `resolveHubAccess` and answer
`login_required` with **HTTP 401 `{ error, code: 'login_required' }`**. `resolveHubToken` stays
for callers that are not client requests (the builder checks `_shared/hub-url.ts` and any cron
that resolves tokens). A structural test asserts no file under `supabase/functions/hub-*/`
(`handler.ts` and `index.ts`) still calls `resolveHubToken` directly, so a future endpoint
cannot skip the login check. `hub-report-docs` `/print-doc/` is the one allowlisted path.

`buildCorsHeaders` adds `x-hub-session` to `Access-Control-Allow-Headers`.

`hub-bootstrap`:

- On `login_required` it returns 401 with a **login payload**: workspace `name`, `logo_url`
  and the same `hub_theme` object it already computes (entitlement-gated), and nothing about
  the client (no name, no photo). This is what lets the login screen carry the agency's brand.
- On success it adds `person: { nome, email } | null` and `require_login` to the bootstrap.
- The sliding-window `touchToken` runs only on success.

Session upkeep: `last_used_at` and a sliding `expires_at` (90 days) are refreshed at most once
a day per session, inside bootstrap only (same reasoning as the link's renewal chokepoint in
the 2026-07-16 link-expiry spec). `hub_client_people.last_login_at` is set on code
verification.

### Server: `hub-auth` (new function, deploy with `--no-verify-jwt`)

`POST { action, ... }`, handler/deps split like `affiliate-public` so it is unit-testable.

- `request_code { workspace, token, email }`: resolves the link (invalid link: same 404 as
  bootstrap). If the normalized email is on that client's list, creates a code and emails it.
  **The response is identical either way** (`{ ok: true }`), and takes the email send off the
  response path so timing does not differ.
- `verify_code { workspace, token, email, code }`: one RPC (`hub_login_verify`) that, in a
  single transaction, finds the newest unused, unexpired code for the email, increments
  `attempts`, compares the hash, marks it used, and inserts the session. It returns the session
  token only if the email is on this client's list. Wrong, expired, used, or over 5 attempts:
  one generic error ("Código inválido ou expirado."). Codes are bound to the client: creation,
  invalidation of earlier codes and verification all filter by `(cliente_id, email)`, so a
  request made through client B's link can neither consume nor invalidate a code issued for
  client A. The session it creates is still per email.
- `logout`: deletes the session named by the `x-hub-session` header.

Rate limits (existing `checkRateLimit`; note `rate_limit_log` is pruned hourly, so windows are
at most one hour): `request_code` 5 per email per hour and 20 per IP per hour; `verify_code`
10 per IP per 10 minutes, plus the 5-attempt cap per code. A new `request_code` invalidates
earlier unused codes for that email.

The code is 6 digits from a CSPRNG. The email: subject "Seu código de acesso: 123456", body
names the agency (workspace name), states the 10-minute validity, and is laid out like the
existing client emails (`client-event-email-cron/handler.ts` builds them from the workspace
name, colour and logo). Those emails do not read `hub_hide_branding` today; this one follows
them as they are. Tag `type: hub_login_code`, added to
`EMAIL_TYPES`. Codes never go to `audit_log` or logs.

### Hub (apps/hub)

- **Session storage:** `localStorage`, one key for the whole origin (the session is per email,
  not per hub), read through a small module that tolerates storage being unavailable.
- **Sending it:** every request to a `hub-*` function adds `x-hub-session` when a session
  exists: `get`, `post`, `patch`, `del`, the three raw `fetch` calls (moved onto `request()` so
  they also surface `code`), and the `fetch` and `XMLHttpRequest` in
  `services/postReferences.ts` (which must map `login_required` instead of collapsing it to
  `internal`). The header is **not** sent to `agenda-convite` or any non-hub function: their
  CORS does not allow it and the preflight would fail.
- **The `.ics` link:** `agendaIcsUrl` is a plain link, so it cannot carry the header. When
  `bootstrap.require_login` is true the Hub fetches the file with the header and saves it from
  a blob; otherwise it keeps today's direct link (my call; a signed short-lived URL is the
  alternative if the app needs it in phase 2). The builder greps for any other hub URL opened
  as a plain link or `window.open` and treats it the same way.
- **Error payload:** `HubApiError` gains an optional `body` holding the parsed error JSON, and
  `HubShell` reads the 401's login payload from it.
- **Prefetch:** `prefetchHubShell` keeps firing bootstrap and posts together; the posts request
  simply fails with `login_required` on a gated hub. A `login_required` with no stored session
  must not trigger the clear-and-invalidate path below (it would loop). After a successful
  login the Hub invalidates **all** hub queries, not only bootstrap.
- **Login gate:** `HubShell` distinguishes a bootstrap error with `code === 'login_required'`
  from an invalid link and renders the login flow with the theme from the 401 payload, instead
  of `hub.invalidLink`. Two steps, as in the mockups: email, then code (`inputmode="numeric"`,
  `autocomplete="one-time-code"`, 16px inputs), with "Reenviar código" after a 60-second
  countdown and "Usar outro e-mail". On success: store the session and refetch bootstrap.
- **Mid-session 401:** any hub call that fails with `login_required` (person removed, session
  expired, switch turned on while the tab was open) clears the stored session and invalidates
  the bootstrap query, which lands on the login screen. Unsaved text in an open composer is
  lost in that case; accepted for v1.
- **Account:** when `bootstrap.person` is set, the shell shows the person's initials; the menu
  has name, email and "Sair" (calls `logout`, clears the session, returns to the login screen
  if required, otherwise stays in the hub anonymously). Placement in `HubSidebar` and
  `HubMobileNav`, and in the `pauta` look, is left to the builder, following the mockup.
- `HubContext` gains `person`. The login flow must be safe under `installSilentUpdate` (a
  half-typed code is a focused field, which the DOM heuristic already holds).

### CRM (apps/crm)

- **Acesso page** (`pages/cliente-detalhe/hub/AcessoPage.tsx`, desktop and the phone variant):
  a "Quem pode entrar" section under the link card, shown only when a link exists, behind the
  same `HubRoleGate`. It has the "Exigir login" switch with its helper line, the people list
  (avatar, name, email, last access or "Nunca entrou", remove with a confirm dialog), and the
  add row (name, email, "Adicionar pessoa"), pre-filled from the client record when the list
  is empty. Store functions in `apps/crm/src/store/hub.ts`, wrapped in TanStack Query.
- **Who approved:** wherever the CRM renders a client entry from `post_approvals`
  (`is_workspace_user = false`) and client messages, show `hub_person_nome` when present;
  otherwise keep today's label. The builder finds the render sites (post approval history,
  Mensagens, the tarefas/post history added in #768) from the queries that select
  `post_approvals`.
- The MCP tool `list_post_feedback` may expose the name too; optional, builder's call.

### Server: recording who acted

`hub-approve` passes the person to `record_client_approval_with_notes` (new trailing
parameters) for `aprovado` and `correcao` and writes the columns directly on the `mensagem`
insert; `hub-mensagens` writes them on its `mensagens` insert. All from
`resolveHubAccess().person`, when present. The Hub's own thread (`hub-posts`,
`hub-post-history`, Mensagens) also returns and shows the name, so people on the same client
see who approved (my call). Other client writes (ideias,
briefing, edit suggestions, media notes, references, linha editorial, agenda) are not
attributed in v1 (my call: approvals and messages are where "who" matters; the rest can follow
without schema risk).

## Security notes

- Sessions and codes are stored hashed. The session token is a bearer credential in
  `localStorage` on the shared `www.mesaas.com.br` origin, the same exposure the affiliate
  panel already accepts.
- The link token stops being sufficient when "Exigir login" is on, which is the point: a
  forwarded WhatsApp link no longer opens the portal.
- Enumeration: `request_code` and the login screen never confirm that an email is listed. The
  only signal is that a listed person receives an email.
- Rotating the link does not end sessions (they belong to the email); removing the person does.
- `hub-auth` verifies the workspace slug and token binding the same way `hub-bootstrap` does.

## Testing

- Deno: `hub-auth` handler (identical responses, attempts cap, expiry, single use, rate
  limits), `resolveHubAccess` (all four combinations of switch and session, removed person,
  expired session, session for another client's email), `hub-bootstrap` 401 payload contains no
  client data, the structural "no direct `resolveHubToken` in hub handlers" test.
- psql entitlement suite: the four RPCs (permission, scope, invariants), table ACLs, and the
  drift test passing with the new tables.
- Vitest: Hub login flow and the 401 handling in `api.ts`; Acesso page people list (both
  shells) and the error-code toasts; "who approved" rendering with and without a name.
- Browser: the Hub flow end to end against local Supabase (staging cannot send the code email;
  the builder reads the code from the database there).

## Deploy order

1. Migration, strictly first: new tables, new nullable columns, and the three recreated RPCs
   (old callers keep working through the DEFAULT parameters; the feed gains a column the old
   bundles ignore). New functions on the old schema would fail every hub request.
2. Edge functions: `hub-auth` (`--no-verify-jwt`) and the 18 hub functions (all already
   `--no-verify-jwt`), which pick up `resolveHubAccess` and the new CORS header. With no client
   set to require login, the new code behaves exactly like the old.
3. Merge (Vercel deploys CRM and Hub). The switch only becomes reachable here, after the
   functions that enforce it are live.

Rollback: turn "Exigir login" off for everyone first (`update hub_client_settings set
require_login = false`), then frontend, then functions. Old functions ignore the setting, so a
function rollback with a switch still on would silently reopen that link, which is why the
switch goes first. The migration can stay.

## Left to the builder

- Whether `data-import`'s client-children registry (`data-import/handler.ts` ~505-580) needs
  `hub_client_people`.
- Whether `hub_people_list` returns `last_login_at` joined or the CRM reads it separately.
- Placement and styling of the account menu in both Hub looks and both nav shells.
- The phone-shell layout of "Quem pode entrar" on the Acesso page (GroupedList cells, a
  `PhoneConfirmSheet` for remove).
- Cleanup of expired codes and sessions (a statement in an existing hourly cleanup job is
  enough).
- i18n keys and the English and Spanish strings if the Hub ships them for neighbouring screens.

## What phase 2 will build on

The app needs: required login regardless of the switch, a `hub-auth` action that lists the hubs
an email can open (every `hub_client_people` row for the session's email, with workspace slug
and token), push devices keyed to a session, and Google/Apple as extra ways to verify an email.
None of that needs a schema change to what this spec adds.
