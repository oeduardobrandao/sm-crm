# YouTube + Google Meu Negócio, Phase 1 (connect + privacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agency can connect a client's YouTube channel and pick the client's Google Meu Negócio units from the client's "Redes sociais" tab, behind two dark plan flags, with the privacy policy updated, so Google's verification can be recorded once later phases land.

**Architecture:** One Google OAuth client; tokens live in `google_connections` (one row per workspace + Google `sub`), never on product rows. A new `google-integration` edge function owns auth, callback, location listing/linking, summary and unlink; SECURITY DEFINER RPCs own the token merge and the advisory-locked unlink/revoke decision. The CRM reads everything through the function (all new tables are service-role only).

**Tech Stack:** Postgres migrations + psql entitlement suites, Deno edge functions (`deno test`, DI handler factories, `createSupabaseQueryMock`), React 19 + TanStack Query + react-i18next + shadcn/ui + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md` (this plan implements §4.1-§4.5, §9 and §10 item 1; Phases 2-4 get their own plans).

## Global Constraints

- All user-facing copy pt-BR (plus `en` keys), sentence case, **no em dashes**; new CRM strings go through i18n (`clients` namespace).
- CORS only via `buildCorsHeaders(req)`; never return raw error details to clients (generic message, log internally).
- `TOKEN_ENCRYPTION_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` required: throw if missing. `GOOGLE_REDIRECT_URI` optional; fallback `${SUPABASE_URL}/functions/v1/google-integration/callback`, the same string in the auth request and the code exchange.
- Tenant = `profiles.active_workspace_id` + `workspace_members` row (the `report-docs/index.ts:46-58` pattern), never `profiles.conta_id`. Every route loads any `clientId`/`connectionId`/location id with `conta_id = <tenant>` before other work; mismatch → 404.
- Every outbound `fetch` (Google, Storage) passes `signal: AbortSignal.timeout(ms)` (10 000 ms default, 20 000 ms for the token exchange).
- New tables: `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT ALL … TO service_role`. Plan columns `feature_youtube`, `feature_google_business` `boolean NOT NULL DEFAULT false`.
- Migration filenames: unique version prefix above `main`'s tail (today `20261104000002`); re-check and renumber right before opening the PR.
- Icons `lucide-react`; toasts `sonner`; no `useBlocker`.
- Scopes (full URLs): YouTube = `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube.readonly`, `https://www.googleapis.com/auth/yt-analytics.readonly`; GMN = `https://www.googleapis.com/auth/business.manage`; both add `openid email profile` (Google echoes these back as `…/auth/userinfo.email` / `userinfo.profile`, so scope checks look at product scopes only).
- CRM redirect base: `OAUTH_REDIRECT_BASE`, fallback `http://localhost:5173` (not TikTok's `:3000`).
- Paths implementers need: `effectivePlanFeature` lives in `supabase/functions/_shared/entitlements-rpc.ts`; `createSupabaseQueryMock` in `test/shared/supabaseMock.ts` (import `../../../test/shared/supabaseMock.ts` from `supabase/functions/__tests__/`); `insertAuditLog` (`_shared/audit.ts`) takes `metadata` and requires `resource_type` (use `'google_connection'`, `'youtube_channel'`, `'gbp_location'`).
- Run one SQL suite file with `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/<file>.sql` from the repo root (`scripts/test-entitlements.sh` takes no filter and runs everything).
- Deliberate Phase 1 calls: the channel avatar is hotlinked from `snippet.thumbnails.default.url` (YouTube avatar URLs are stable; spec §4.3's storage cache is deferred to Phase 2 sync if they prove otherwise). `nav-data.ts` (spec §4.5 nav feature map) is untouched: Phase 1 adds no page. The terms page lists no integrations, so spec §9's conditional terms update is not needed.

## Review Focus

1. Reconnecting an identity Google already granted returns **no `refresh_token`**: the stored token must survive; with none stored the flow retries once with `prompt=consent`, never loops. Pinned in Task 3 (SQL) and Task 6 (handler).
2. The user unticks a permission on Google's consent screen: the callback must refuse with `missing_scope` and write nothing. Pinned in Task 6.
3. A state from another workspace, an expired state, or a replayed nonce must not write anything. Pinned in Tasks 5 and 6.
4. A `connectionId` (from `?gbp_pick=` or the picker) that belongs to another workspace must return 404 before any Google call. Pinned in Task 7.
5. The same Google account linked in two workspaces: unlinking in one must not revoke; the last unlink anywhere must revoke exactly once. Pinned in Task 3 (SQL) and Task 7 (revoke after commit).

---

### Task 1: Plan flags end to end

**Files:**
- Create: `supabase/migrations/20261107000004_google_feature_flags.sql`
- Modify: `supabase/functions/_shared/entitlements.ts:13-24` (append `"feature_youtube", "feature_google_business"` to `FEATURE_COLUMNS`)
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts:44` (two optional `?: boolean` fields, read as `=== true`, per the file's convention), `apps/crm/src/lib/entitlement-errors.ts:36` (`feature_youtube: 'YouTube'`, `feature_google_business: 'Google Meu Negócio'`)
- Modify: `apps/admin/src/lib/api.ts:119,272,306` (type, list, label, same values)
- Test: `supabase/tests/entitlements/99_google_feature_flags.sql`; `apps/admin/src/lib/__tests__/featureFlags.test.ts` (already asserts every key has a label: it must pass)

**Interfaces:**
- Produces: plan columns `feature_youtube`, `feature_google_business`; `features.feature_youtube` / `features.feature_google_business` on `useWorkspaceLimits()`; `effectivePlanFeature(svc, contaId, 'feature_youtube' | 'feature_google_business')` works server-side.

- [ ] **Step 1: Write the failing SQL test** `99_google_feature_flags.sql` (`\i _helpers.sql`, `begin; … rollback;`): assert both columns exist, default `false` on every plan; `et_make_workspace('pro')`, then a separate `insert into workspace_plan_overrides (workspace_id, feature_overrides) values (ws, '{"feature_youtube": true}')` (the `10_effective_plan_feature.sql:16` pattern; `et_make_workspace`'s second arg writes `resource_overrides`, not features) → `effective_plan_feature(ws, 'feature_youtube')` is true and `'feature_google_business'` false.
- [ ] **Step 2: Run** the file with `psql` (Global Constraints). Expected: FAIL (column does not exist).
- [ ] **Step 3: Write the migration** (header comment pointing at spec §4.5; `ALTER TABLE plans ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT false` ×2), then the TS edits listed above.
- [ ] **Step 4: Run** the SQL test, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npm run check:functions`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(google): plan flags feature_youtube and feature_google_business`.

### Task 2: Connection and link tables

**Files:**
- Create: `supabase/migrations/20261107000005_google_connections.sql`
- Test: `supabase/tests/entitlements/99_google_connections.sql`

**Interfaces:**
- Produces tables (all service-role only, RLS enabled, no policies):
  - `google_connections(id uuid pk default gen_random_uuid(), conta_id uuid not null references workspaces(id) on delete cascade, google_sub text not null, email text not null, display_name text, encrypted_access_token text not null, encrypted_refresh_token text, access_token_expires_at timestamptz not null, scopes text[] not null default '{}', status text not null default 'active' check (status in ('active','revoked')), refresh_lock_at timestamptz, created_at, updated_at, unique (conta_id, google_sub))` + index on `google_sub`.
  - `google_revocations(id uuid pk, google_sub text not null, encrypted_token text not null, token_kind text not null check (token_kind in ('refresh','access')), attempts int not null default 0, last_error text, created_at)`.
  - `youtube_channels(id uuid pk, conta_id uuid not null references workspaces(id) on delete cascade, client_id bigint not null unique references clientes(id) on delete cascade, connection_id uuid not null references google_connections(id) on delete no action,` (NO ACTION, not RESTRICT: deleting a workspace cascades to both `google_connections` and `clientes → youtube_channels`, and RESTRICT would fail mid-cascade) channel_id text not null, title text, handle text, avatar_url text, uploads_playlist_id text, subscriber_count bigint, view_count bigint, video_count bigint, shorts_count int, long_count int, authorization_status text not null default 'active' check (in ('active','revoked')), revoked_at timestamptz, last_synced_at, data_through date, content_type_through date, traffic_through date, videos_through date, created_at, updated_at, unique (conta_id, channel_id))`.
  - `gbp_locations(id uuid pk, conta_id uuid not null references workspaces(id) on delete cascade, client_id bigint not null references clientes(id) on delete cascade, connection_id uuid references google_connections(id) on delete set null, account_name text not null, location_name text not null, title text, address_line text, website text, has_voice_of_merchant boolean not null default false, average_rating numeric(2,1), total_review_count int, status text not null default 'active' check (in ('active','disconnected','revoked')), disconnected_at timestamptz, last_synced_at, data_through date, created_at, updated_at, unique (conta_id, location_name))`.
  - `oauth_states` provider CHECK widened to `('instagram','tiktok','google')`: find the inline CHECK by body (the `20261010100002:42-57` DO-block pattern), drop it, add `oauth_states_provider_check`.
  - CHECKs on `gbp_locations`: `(status = 'active') = (disconnected_at IS NULL)` and `(status = 'disconnected') OR connection_id IS NOT NULL` (a disconnected unit keeps its row, and later its history, after the connection is gone).
- Note: the spec's "RLS: client's workspace" for `gbp_locations` is tightened to service-role only, since the CRM reads through `google-integration` (Task 7).

- [ ] **Step 1: Write the failing SQL test**: `et_grant_hosted_parity(array['google_connections','google_revocations','youtube_channels','gbp_locations'])`; assert `has_table_privilege` is false for `authenticated` and `anon` on SELECT/INSERT for all four; service-role inserts a connection, a channel and a location; a second channel row with the same `(conta_id, channel_id)` raises `unique_violation`; the same `channel_id` in another workspace succeeds; a second client with the same `location_name` in the same workspace raises `unique_violation`; deleting the client cascades its channel and locations; deleting a workspace that holds a connection, a channel and a location succeeds; `insert into oauth_states(… provider) values (… 'google')` succeeds and `'youtube'` fails.
- [ ] **Step 2: Run** it. Expected: FAIL (relations missing).
- [ ] **Step 3: Write the migration** per Interfaces (`SET LOCAL lock_timeout = '5s'`; `updated_at` via one trigger function per table, the repo convention: `set_google_connections_updated_at()`, `set_youtube_channels_updated_at()`, `set_gbp_locations_updated_at()`; there is no shared one).
- [ ] **Step 4: Run** the SQL test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(google): connection, channel and location tables`.

### Task 3: Token merge and unlink/revoke RPCs

**Files:**
- Create: `supabase/migrations/20261107000006_google_connection_rpcs.sql`
- Test: `supabase/tests/entitlements/99_google_connection_rpcs.sql`

**Interfaces:**
- Consumes: Task 2 tables.
- Produces (SECURITY DEFINER, `SET search_path = public, pg_temp`, `REVOKE … FROM public, anon, authenticated`, `GRANT EXECUTE … TO service_role`):
  - `google_connection_upsert(p_conta_id uuid, p_sub text, p_email text, p_display_name text, p_access_enc text, p_refresh_enc text, p_expires_at timestamptz, p_scopes text[]) RETURNS uuid`: insert or update on `(conta_id, google_sub)`; on update `scopes` = sorted distinct union, `encrypted_refresh_token = COALESCE(p_refresh_enc, existing)`, `status = 'active'`, access token/expiry replaced; reactivates that connection's `gbp_locations` with `status = 'revoked'` (→ `active`, `disconnected_at = NULL`) and its `youtube_channels` with `authorization_status = 'revoked'` (→ `active`, `revoked_at = NULL`).
  - `google_connection_refresh_covers(p_conta_id uuid, p_sub text, p_scopes text[]) RETURNS boolean`: true only when a refresh token is stored AND the stored `scopes @> p_scopes` (a YouTube-only refresh token must not be trusted for the GMN flow; if spike S6 fails this sends the user through the consent retry instead of storing a token that lacks `business.manage`).
  - `google_unlink_youtube(p_conta_id uuid, p_client_id bigint) RETURNS TABLE(should_revoke boolean, revocation_id uuid)` and `google_unlink_gbp_location(p_conta_id uuid, p_location_id uuid) RETURNS TABLE(should_revoke boolean, revocation_id uuid)`. Both: find the row (scoped by `p_conta_id`; not found → `RAISE … ERRCODE 'P0002'`), take `pg_advisory_xact_lock(hashtext('google-sub:' || sub))`, unlink (YouTube: DELETE the channel row; GMN: `status='disconnected'`, `disconnected_at=now()`), then call internal `_google_revoke_if_unused(p_sub text)`: "in use" = any `youtube_channels` row, or any `gbp_locations` row with `status in ('active','revoked')`, referencing a `google_connections` row with that `sub` in any workspace. Not in use → insert one `google_revocations` row with a refresh token from one of those connections (`token_kind = 'refresh'`), falling back to the newest access token (`token_kind = 'access'`, revoking it also kills the grant); delete every `google_connections` row with that `sub` **in every workspace** (deliberately wider than spec §4.2's "the workspace's": the grant is dead for all of them, and a stale row elsewhere would make `refresh_covers` lie; do not narrow it); disconnected units get `connection_id = NULL` via `ON DELETE SET NULL`; return `(true, revocation_id)`. In use → `(false, NULL)`.
  - `google_mark_revoked(p_connection_id uuid) RETURNS void` (for `invalid_grant`): connection `revoked`; its channels `authorization_status='revoked'`, `revoked_at=now()`; its active locations `status='revoked'`, `disconnected_at=now()`.

- [ ] **Step 1: Write the failing SQL test** with these cases:
  - `upsert_keeps_refresh`: upsert with refresh `'R1'`, then again with `NULL` → stored refresh is `'R1'`, scopes are the union.
  - `refresh_covers_scopes`: refresh stored with YouTube scopes only → `refresh_covers(…, array['…/business.manage'])` false, with YouTube scopes true; no refresh stored → false.
  - `upsert_reactivates`: `google_mark_revoked` then upsert → connection, channel and revoked location are active again; a `disconnected` location stays disconnected.
  - `unlink_shared_sub_no_revoke`: same `sub` linked in workspaces A (channel) and B (location); `google_unlink_youtube(A, client)` returns `should_revoke = false`, A's connection row still exists with its token, no `google_revocations` row.
  - `unlink_last_revokes_once`: then `google_unlink_gbp_location(B, loc)` returns `should_revoke = true`; exactly one `google_revocations` row (`token_kind = 'refresh'`); no `google_connections` row with that `sub` remains in A or B; B's location row survives as `disconnected` with `connection_id` NULL.
  - `revoke_falls_back_to_access`: connection with no refresh token, last unlink → one revocation row with `token_kind = 'access'`.
  - `unlink_other_workspace_404`: `google_unlink_youtube(B, A's client)` raises `P0002`.
  - `grants`: `has_function_privilege('authenticated', …, 'EXECUTE')` false for every RPC.
- [ ] **Step 2: Run** it. Expected: FAIL (functions missing).
- [ ] **Step 3: Write the migration** per Interfaces.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(google): token merge and advisory-locked unlink RPCs`.

### Task 4: `_shared/google.ts`

**Files:**
- Create: `supabase/functions/_shared/google.ts`
- Test: `supabase/functions/__tests__/google-shared_test.ts`

**Interfaces:**
- Consumes: `encryptText`/`decryptText` (`_shared/crypto.ts`), Task 3 RPC names.
- Produces:
  - `type GoogleProduct = 'youtube' | 'gbp'`; `GOOGLE_PRODUCT_SCOPES: Record<GoogleProduct, string[]>` (Global Constraints values); `GOOGLE_BASE_SCOPES = ['openid','email','profile']`.
  - `requireGoogleClientCredentials(): { clientId: string; clientSecret: string }` (throws when missing).
  - `googleRedirectUri(): string` (Global Constraints rule).
  - `buildGoogleAuthUrl(opts: { product: GoogleProduct; state: string; consent: boolean }): string` → `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri`, `response_type=code`, `scope` (product + base, space-joined), `access_type=offline`, `include_granted_scopes=true`, `prompt` = `consent` when `consent` else `select_account`, `state`.
  - `exchangeGoogleCode(code: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string[] }>` (POST `https://oauth2.googleapis.com/token`, 20 s timeout).
  - `fetchGoogleUserInfo(accessToken: string): Promise<{ sub: string; email: string; name: string | null }>` (`https://openidconnect.googleapis.com/v1/userinfo`).
  - `hasRequiredScopes(product: GoogleProduct, granted: string[]): boolean`: checks `GOOGLE_PRODUCT_SCOPES[product]` only, never the base scopes.
  - `encryptGoogleToken(plain: string, kind: 'access' | 'refresh'): Promise<string>` / `decryptGoogleToken(enc: string, kind): Promise<string>` (purposes `google-access-token` / `google-refresh-token`, key `TOKEN_ENCRYPTION_KEY`).
  - `class GoogleApiError extends Error { code: 'TOKEN_INVALID' | 'REVOKED' | 'RATE_LIMITED' | 'NOT_APPROVED' | 'API_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND' | 'UPSTREAM'; status: number; retryable: boolean }`.
  - `googleFetch(url: string, accessToken: string, init?: RequestInit & { timeoutMs?: number }): Promise<unknown>`: maps 401 → `TOKEN_INVALID`; 403 **or 429** whose error details carry `quota_limit_value: "0"` → `NOT_APPROVED` (unapproved GBP projects often answer 429 `RESOURCE_EXHAUSTED`); other 429 → `RATE_LIMITED` (retryable); 403 with reason `SERVICE_DISABLED` or message "has not been used in project" / "API has not been enabled" → `API_DISABLED` (a config error on our side, logged distinctly, shown to users as `unknown`); other 403 → `FORBIDDEN`; 404 → `NOT_FOUND`; 5xx → `UPSTREAM` (retryable).
  - `getFreshGoogleToken(svc: DbClient, connectionId: string): Promise<string>`: same lock/poll algorithm as `getFreshTikTokToken` (`_shared/tiktok.ts:253`), refresh when < 5 min left via `grant_type=refresh_token`; refresh response without a new refresh token keeps the stored one; `invalid_grant` → `svc.rpc('google_mark_revoked', { p_connection_id })` then throw `GoogleApiError('REVOKED')`.
  - `revokeGoogleToken(token: string): Promise<boolean>` (POST `https://oauth2.googleapis.com/revoke`, `token` form field; 200 or 400 `invalid_token` → true).

- [ ] **Step 1: Write failing tests** (stub `globalThis.fetch` like `tiktok-shared_test.ts`):
  - `buildGoogleAuthUrl` contains `access_type=offline`, `include_granted_scopes=true`, `prompt=select_account` (and `consent` when asked), the exact redirect URI, and all YouTube scopes for `youtube`.
  - `hasRequiredScopes('youtube', [... without yt-analytics])` is false.
  - `encryptGoogleToken` round-trips; an access ciphertext does not decrypt as `refresh`.
  - `googleFetch` maps 401, 429-plain, 429-with-quota-0, 403-quota-0, 403-service-disabled, 403-other, 404, 503 to the codes above, and passes an `AbortSignal`.
  - `hasRequiredScopes('gbp', ['openid', '…/auth/userinfo.email', '…/auth/userinfo.profile', '…/auth/business.manage'])` is true.
  - `getFreshGoogleToken` returns the stored token when not near expiry (no fetch), refreshes and keeps the stored refresh token when the response has none, and calls `google_mark_revoked` on `invalid_grant`.
- [ ] **Step 2: Run** `deno test supabase/functions/__tests__/google-shared_test.ts --no-check`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the module per Interfaces.
- [ ] **Step 4: Run** the test and `npm run check:functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(google): shared OAuth, token and fetch helpers`.

### Task 5: Signed OAuth state for Google

**Files:**
- Create: `supabase/functions/google-integration/oauth-state.ts`
- Test: `supabase/functions/__tests__/google-oauth-state_test.ts`

**Interfaces:**
- Produces:
  - `createGoogleState(p: { clientId: string; userId: string; contaId: string; product: GoogleProduct; consentRetry: boolean }, svc): Promise<string>`: same scheme as `tiktok-integration/oauth-state.ts` (HMAC from `TOKEN_ENCRYPTION_KEY`, payload base64url + signature, 10-min TTL), `provider: 'google'` in payload and `oauth_states` row.
  - `verifyGoogleState(state: string, svc): Promise<{ clientId; userId; contaId; product; consentRetry; nonce }>`: verifies signature, TTL, `provider === 'google'`, `product ∈ {youtube,gbp}`, then consumes the nonce (`update oauth_states set consumed_at = now() where nonce = … and consumed_at is null and provider = 'google' and expires_at > now()` returning a row, as TikTok's does; none → throw `state_replayed`).

- [ ] **Step 1: Write failing tests**: round-trip returns the payload; tampered signature throws; a TikTok-minted state throws `Invalid state provider`; `iat` 11 min ago throws `State expired`; verifying the same state twice throws `state_replayed` on the second call (mock returns no row).
- [ ] **Step 2: Run** `deno test supabase/functions/__tests__/google-oauth-state_test.ts --no-check`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(google): signed OAuth state with nonce consumption`.

### Task 6: `google-integration` auth + callback

**Files:**
- Create: `supabase/functions/google-integration/handlers.ts`, `supabase/functions/google-integration/index.ts`, `supabase/functions/google-integration/tenant.ts`
- Modify: `supabase/config.toml` (`[functions.google-integration] verify_jwt = false`)
- Test: `supabase/functions/__tests__/google-integration-callback_test.ts`

**Interfaces:**
- Consumes: Tasks 3-5.
- Produces:
  - `createGoogleIntegrationHandler(deps: { buildCorsHeaders; createServiceDb: () => DbClient; now?: () => Date }): (req: Request) => Promise<Response>`; path prefix `/google-integration` stripped as in `tiktok-integration/handlers.ts:576`.
  - `tenant.ts`: `resolveTenant(req, svc, cors): Promise<{ userId: string; contaId: string } | Response>` (JWT via `svc.auth.getUser`, then `active_workspace_id` + `workspace_members`, 401 otherwise) and `loadClientInTenant(svc, clientId: number, contaId): Promise<{ id: number; nome: string } | null>`.
  - `GET /auth/:clientId?product=youtube|gbp` → `{ url }`. Missing or unknown `product` → 400 `{ error: 'invalid_product' }`. Checks client in tenant (404), flag `feature_youtube`/`feature_google_business` (403 `{ error: 'feature_disabled', feature }`), builds state with `consentRetry: false`, URL with `consent: false`.
  - `GET /callback?code&state` (no JWT). Redirect base `OAUTH_REDIRECT_BASE`; target `/clientes/{clientId}/redes-sociais`. Order: verify state (any failure, including a replayed nonce → plain 400 text "Link inválido ou expirado", no redirect, no Google call) → `loadClientInTenant(svc, clientId, contaId)` (client deleted or moved during the 10-min window → `{p}_error=unknown`) → `error` param from Google (`access_denied`) → `?{p}_error=denied` where `p` = `yt` | `gmn` → exchange code → userinfo → `hasRequiredScopes` else `revokeGoogleToken(refreshToken ?? accessToken)` (a just-minted partial grant counts toward Google's 100-token cap) and `{p}_error=missing_scope` → if `refreshToken` null and `!google_connection_refresh_covers(conta, sub, GOOGLE_PRODUCT_SCOPES[product])`: if `consentRetry` → `{p}_error=no_refresh_token`, else 302 to a fresh auth URL with `consent: true` and a new state with `consentRetry: true` → `google_connection_upsert` → product step → `insertAuditLog` (action `google-connect`, `resource_type: 'google_connection'`, `metadata: { product, client_id }`) → success redirect.
  - YouTube product step: `googleFetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true')`; no item → `yt_error=no_channel`; upsert `youtube_channels` on `client_id` (title, `snippet.customUrl` as handle, `snippet.thumbnails.default.url`, uploads playlist, counts; `subscriber_count` null when `hiddenSubscriberCount`); `unique_violation` on `(conta_id, channel_id)` → look up the other client's name → `yt_error=channel_in_use&yt_other=<encodeURIComponent(nome)>`; success → `yt_connected=1`.
  - GMN product step: no Google call; success → `gbp_pick=<connectionId>`.
  - Any unexpected error after the state verified → log internally, `{p}_error=unknown`.

- [ ] **Step 1: Write failing tests** (`createSupabaseQueryMock` + routed `globalThis.fetch` stub):
  - `auth_requires_flag`: flag off → 403 `feature_disabled`.
  - `auth_other_workspace_client`: client in another workspace → 404.
  - `auth_url_shape`: 200 `{url}` with `prompt=select_account` and YouTube scopes.
  - `auth_invalid_product`: `?product=tiktok` → 400.
  - `callback_missing_scope`: token response lacking `yt-analytics.readonly` → 302 to `…?yt_error=missing_scope`, `oauth2.googleapis.com/revoke` called once, no `google_connection_upsert` rpc call.
  - `callback_client_gone`: client no longer in the state's workspace → 302 `…?yt_error=unknown`, no token exchange.
  - `callback_gbp_with_youtube_only_refresh`: GMN flow, no refresh token, `refresh_covers` false (stored token is YouTube-only) → 302 to Google with `prompt=consent`.
  - `callback_no_refresh_retries_once`: no refresh token, `refresh_covers` false, `consentRetry` false → 302 to Google with `prompt=consent`; same with `consentRetry` true → `…?yt_error=no_refresh_token`.
  - `callback_no_refresh_but_stored`: no refresh token, `refresh_covers` true → upsert called with `p_refresh_enc: null`, continues.
  - `callback_youtube_success`: upsert + channel insert → 302 `…?yt_connected=1`.
  - `callback_channel_in_use`: insert returns `23505` → 302 with `yt_error=channel_in_use&yt_other=Cl%C3%ADnica%20X`.
  - `callback_gbp_redirects_to_picker`: → 302 `…?gbp_pick=<uuid>`.
  - `callback_replayed_state`: second use → 400, no token exchange fetch.
- [ ] **Step 2: Run** `deno test supabase/functions/__tests__/google-integration-callback_test.ts --no-check`. Expected: FAIL.
- [ ] **Step 3: Implement** handlers, `tenant.ts`, `index.ts` (env wiring only, `tiktok-integration/index.ts` shape), config entry.
- [ ] **Step 4: Run** the test, `npm run check:functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(google): google-integration auth and callback`.

### Task 7: `google-integration` summary, locations, unlink

**Files:**
- Modify: `supabase/functions/google-integration/handlers.ts`
- Create: `supabase/functions/google-integration/locations.ts`
- Test: `supabase/functions/__tests__/google-integration-routes_test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 6.
- Produces:
  - `listEligibleLocations(token: string): Promise<GbpLocationOption[]>` in `locations.ts`, where `GbpLocationOption = { locationName: string; accountName: string; title: string; addressLine: string | null; website: string | null; hasVoiceOfMerchant: boolean }`: `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts` (follow `nextPageToken`), then per account sequentially `GET https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations?readMask=name,title,storefrontAddress,websiteUri,metadata&pageSize=100` (follow pages), dedupe by `name` keeping the first account. `addressLine` = `storefrontAddress.addressLines[0]` + `, ` + `locality`.
  - `GET /summary/:clientId` → `{ youtube: { channelId, title, handle, avatarUrl, subscriberCount, viewCount, videoCount, authorizationStatus, connectionEmail, lastSyncedAt } | null, gmn: { locations: Array<{ id, title, addressLine, averageRating, totalReviewCount, status }>, connections: Array<{ id, email, status }> } | null }` (connections = workspace connections whose scopes include `business.manage`). Flags gate each half: flag off → that half is `null`.
  - `GET /locations/:clientId?connection=<uuid>` → `{ options: Array<GbpLocationOption & { linkedClientId: number | null; linkedClientName: string | null; eligible: boolean }> }`. Connection not in tenant → 404 before any fetch. Rate-limited per workspace with `checkRateLimit` from `_shared/rate-limit.ts` (key `google-locations:<conta_id>`, 20/min; over → 429 `{ error: 'rate_limited' }`), since each call walks every GBP account. `GoogleApiError('NOT_APPROVED')` → 409 `{ error: 'gmn_not_approved' }`. `REVOKED` → 409 `{ error: 'reconnect' }`.
  - `POST /locations/:clientId` body `{ connectionId: string; locationNames: string[] }` → re-lists from Google (never trusts client-sent titles), rejects any name not eligible or linked to another client (409 `{ error: 'location_unavailable', locationName }`), upserts selected rows for this client (reactivating `disconnected` rows of this client, setting `connection_id` to this connection), then calls `google_unlink_gbp_location` only for this client's active rows **with `connection_id = :connectionId`** and `location_name` not in the set (units linked through another Google account are never touched by this save), then revokes per returned decisions; → `{ linked: number }`. Upsert before unlink is load-bearing: in the reverse order the revoke branch can delete the connection the upsert is about to reference. Audit `gmn-link` (`resource_type: 'gbp_location'`).
  - `POST /disconnect/youtube/:clientId` → `google_unlink_youtube`; `{ ok: true }`. Audit `youtube-unlink`.
  - `POST /disconnect/youtube/:clientId` audit: `resource_type: 'youtube_channel'`.
  - After any unlink returning `should_revoke = true`: load the `google_revocations` row, `revokeGoogleToken(decryptGoogleToken(encrypted_token, token_kind))`, delete the row on success, else `attempts + 1` and `last_error` (Phase 2's `gbp-sync-cron` retries).

- [ ] **Step 1: Write failing tests**:
  - `summary_shapes`: both flags on → both halves populated from mocked rows; `feature_google_business` off → `gmn` is `null`.
  - `locations_other_workspace_connection_404`: connection with another `conta_id` → 404 and the fetch stub recorded zero calls.
  - `locations_eligibility`: three Google locations (one `hasVoiceOfMerchant: false`, one linked to another client) → `eligible` and `linkedClientName` set as expected; two accounts listing the same location → one option.
  - `locations_not_approved`: Business Information returns 403 with quota limit 0 → 409 `gmn_not_approved`.
  - `link_rejects_tampered_name`: posting a name Google did not return → 409 `location_unavailable`, no upsert.
  - `link_unlinks_removed`: client had locations A,B; post `[A, C]` → C upserted, `google_unlink_gbp_location` called for B.
  - `link_other_connection_untouched`: client has A,B on connection 1; post `{ connectionId: 2, locationNames: [C] }` → C upserted, `google_unlink_gbp_location` not called.
  - `locations_rate_limited`: `checkRateLimit` denies → 429, zero Google fetches.
  - `disconnect_revokes_after_commit`: RPC returns `should_revoke = true` → `oauth2.googleapis.com/revoke` called once and the revocation row deleted; revoke HTTP 500 → row kept with `attempts = 1`.
- [ ] **Step 2: Run** `deno test supabase/functions/__tests__/google-integration-routes_test.ts --no-check`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** the test and `npm run check:functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(google): summary, GMN unit listing/linking and unlink routes`.

### Task 8: CRM service

**Files:**
- Create: `apps/crm/src/services/google.ts`
- Test: `apps/crm/src/services/__tests__/google.test.ts`

**Interfaces:**
- Consumes: Task 6/7 routes.
- Produces (fetch helper copied from `services/tiktok.ts`'s `getAuthHeaders` pattern; base `VITE_SUPABASE_URL + '/functions/v1/google-integration'`):
  - types `GoogleSummary`, `GbpLocationOptionView` mirroring Task 7.
  - `getGoogleAuthUrl(clientId: number, product: 'youtube' | 'gbp'): Promise<string>`
  - `getGoogleSummary(clientId: number): Promise<GoogleSummary>`
  - `listGbpLocationOptions(clientId: number, connectionId: string): Promise<GbpLocationOptionView[]>`
  - `linkGbpLocations(clientId: number, connectionId: string, locationNames: string[]): Promise<number>`
  - `disconnectYouTube(clientId: number): Promise<void>`
  - `class GoogleServiceError extends Error { code: 'feature_disabled' | 'gmn_not_approved' | 'reconnect' | 'location_unavailable' | 'unknown' }` thrown on non-2xx, `code` from the body's `error`.

- [ ] **Step 1: Write failing tests** (mock `fetch` and `supabase.auth.getSession`): each function hits the right method + path; a 409 `{error:'gmn_not_approved'}` rejects with `GoogleServiceError` whose `code` is `gmn_not_approved`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/services/__tests__/google.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): google-integration service`.

### Task 9: YouTube card in Redes sociais

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/YouTubeSection.tsx`
- Modify: `packages/i18n/locales/pt/clients.json`, `packages/i18n/locales/en/clients.json` (new `youtube.*` keys)
- Test: `apps/crm/src/pages/cliente-detalhe/__tests__/YouTubeSection.test.tsx`

**Interfaces:**
- Consumes: Task 8 (`getGoogleSummary`, `getGoogleAuthUrl`, `disconnectYouTube`), `useWorkspaceLimits().features.feature_youtube`.
- Produces: `YouTubeSection({ clienteId }: { clienteId: number })`; React Query key `['googleSummary', clienteId]` (shared with Task 10).
- UI (mockup 1, card "YouTube"): flag off → renders nothing and fetches nothing (the `TikTokSection` rule). Not connected → title "Conectar YouTube", body and two bullets from the mockup, button "Conectar com o Google" (sets `window.location.href` to the auth URL). Connected → badge "Conectado", avatar, title, `youtube.com/@handle` link (`sanitizeUrl`), counts "Inscritos", "Visualizações totais", "Vídeos" (`Intl.NumberFormat('pt-BR', { notation: 'compact' })`), line "O YouTube libera os números com 2 a 3 dias de atraso.", icon buttons "Desconectar" (AlertDialog "Desconectar YouTube?" whose body says the channel's data is deleted from Mesaas within 7 days, confirm "Desconectar"). `authorizationStatus === 'revoked'` → warning banner "A autorização do Google expirou. Reconecte a conta para voltar a sincronizar." + "Reconectar". No "Ver analytics" button in Phase 1.

- [ ] **Step 1: Write failing tests**: `renders_nothing_without_flag` (no fetch); `connect_card_when_no_channel`; `connected_card_counts` (shows "12,4 mil" for 12430); `revoked_banner`; `disconnect_confirms_then_calls_service` (invalidates `['googleSummary', id]`).
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/YouTubeSection.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the component and i18n keys (pt + en).
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): YouTube connection card`.

### Task 10: Google Meu Negócio card and unit picker

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/GoogleBusinessSection.tsx`, `apps/crm/src/pages/cliente-detalhe/GbpUnitsDialog.tsx`
- Modify: `packages/i18n/locales/{pt,en}/clients.json` (`gmn.*` keys)
- Test: `apps/crm/src/pages/cliente-detalhe/__tests__/GoogleBusinessSection.test.tsx`, `apps/crm/src/pages/cliente-detalhe/__tests__/GbpUnitsDialog.test.tsx`

**Interfaces:**
- Consumes: Task 8; `features.feature_google_business`.
- Produces: `GoogleBusinessSection({ clienteId, pickConnectionId, onPickHandled }: { clienteId: number; pickConnectionId: string | null; onPickHandled: () => void })`; `GbpUnitsDialog({ clienteId, clienteNome, connections, initialConnectionId, open, onOpenChange })`.
- UI (mockups 1-2):
  - Section: flag off → nothing. No active locations → "Conectar Google Meu Negócio" card with the mockup copy and "Conectar com o Google". With locations → header badge "{{count}} unidades", "Conta Google: {{email}}", one row per unit (title, address, "★ 4,8", "312 avaliações"), buttons "Gerenciar unidades" (opens the dialog) and "Conectar com o Google" kept as a ghost link "Usar outra conta Google". A unit with `status === 'revoked'` shows the reconnect banner.
  - `pickConnectionId` set → open the dialog on that connection, then `onPickHandled()`.
  - Dialog title "Quais unidades são da {{cliente}}?"; intro "Encontramos {{count}} perfis na conta {{email}}. Marque os que pertencem a este cliente. Dá para mudar depois em Gerenciar unidades."; a connection `Select` when more than one connection; rows with checkbox, title, address; disabled rows: `linkedClientName` → "Já vinculada ao cliente {{nome}}. Uma unidade pertence a um cliente só." + badge "Em uso"; `!eligible` → "Perfil ainda não verificado pelo Google, que não libera métricas para ele." + badge "Não verificado"; note "Puxamos os últimos 18 meses de cada unidade marcada. Pode levar alguns minutos na primeira vez."; footer "Cancelar" / "Vincular {{count}} unidades" (singular "Vincular 1 unidade"); this client's active units start checked; unchecking one and saving unlinks it. Error `gmn_not_approved` → inline "O Google ainda não liberou o acesso ao Google Meu Negócio para o Mesaas." Error `reconnect` → reconnect banner. Dialog uses `confirmClose` when the selection changed (repo rule for modals with unsaved state).

- [ ] **Step 1: Write failing tests**: section `renders_nothing_without_flag`; `lists_units_with_rating`; `pick_param_opens_dialog`. Dialog: `disables_linked_and_unverified`; `submit_sends_checked_names` (`linkGbpLocations` called with `[A, C]`); `button_label_counts` ("Vincular 2 unidades"); `not_approved_message`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/GoogleBusinessSection.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/GbpUnitsDialog.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** both components and i18n keys.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): Google Meu Negócio card and unit picker`.

### Task 11: Wire the tab and the OAuth return params

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/RedesSociaisTab.tsx`
- Modify: `packages/i18n/locales/{pt,en}/clients.json` (toast/error keys)
- Test: `apps/crm/src/pages/cliente-detalhe/tabs/__tests__/RedesSociaisTab.google.test.tsx` (beside the existing `RedesSociaisTab.test.tsx`; mock `@/hooks/useWorkspaceLimits` the same way)

**Interfaces:**
- Consumes: Tasks 9-10.
- Behavior: render `<YouTubeSection>` then `<GoogleBusinessSection>` after `<TikTokSection>`. The tab's single comprehensive OAuth-param effect (see the file's header comment: one effect deletes ALL known params from its own snapshot) adds `yt_connected`, `yt_error`, `yt_other`, `gbp_pick`, `gmn_error` to the set it reads and deletes. Toasts: `yt_connected=1` → "YouTube conectado."; `yt_error` codes `denied` "Conexão cancelada no Google.", `missing_scope` "Marque todas as permissões pedidas pelo Google e tente de novo.", `no_refresh_token` "O Google não liberou o acesso contínuo. Tente conectar de novo.", `no_channel` "Esta conta Google não tem canal do YouTube.", `channel_in_use` "Este canal já está vinculado ao cliente {{nome}}.", `unknown` "Não foi possível conectar o YouTube."; `gmn_error` same codes (except the channel ones) with "Google Meu Negócio". `gbp_pick` → state passed as `pickConnectionId`.

- [ ] **Step 1: Write failing tests**: URL `?yt_error=channel_in_use&yt_other=Cl%C3%ADnica%20X` → error toast with "Clínica X" and every Google param removed from the URL; `?gbp_pick=<uuid>` → `GoogleBusinessSection` receives it and the param is removed; existing `ig_connected`/`tt_error` behavior unchanged (run the existing tab tests too).
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/cliente-detalhe/`. Expected: new tests FAIL, existing ones pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): YouTube and Google Meu Negócio in Redes sociais`.

### Task 12: Privacy policy, admin labels, docs

**Files:**
- Modify: `apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx` (section 3)
- Modify: `apps/admin/src/pages/workspace-events.ts` (labels `google-connect` "Google conectado", `gmn-link` "Unidades do Google Meu Negócio vinculadas", `youtube-unlink` "YouTube desconectado")
- Modify: `CLAUDE.md` (env vars `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`; `google-integration` in the `--no-verify-jwt` list; a gotcha line: one Google identity per workspace in `google_connections`, never delete a connection row outside the revoke RPC, two Cloud projects)
- Test: `apps/crm/src/pages/politica-privacidade/__tests__/PoliticaPage.test.tsx`

**Interfaces:**
- Section 3 retitled "Contas de redes sociais conectadas (Instagram, TikTok, YouTube e Google Meu Negócio)". Adds, in pt-BR plain prose: what is read from YouTube (channel profile, statistics, videos and their metrics) and published (Shorts the user scheduled); what is read from Google Meu Negócio (profile, performance metrics, search terms, reviews including the reviewer's display name); "O Mesaas usa os Serviços de API do YouTube" with links to `https://www.youtube.com/t/terms` and `https://policies.google.com/privacy`; revoking at `https://myaccount.google.com/permissions`; retention: YouTube data, including in reports already generated, deleted within 7 days of disconnecting; Google Meu Negócio history deleted 30 days after disconnecting, while numbers in reports already generated stay in those reports. Links use `sanitizeUrl` and `rel="noopener noreferrer"`.

- [ ] **Step 1: Write the failing test**: renders the new title, the three Google links with exact hrefs, and the 7-day sentence.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/politica-privacidade/__tests__/PoliticaPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page, admin labels and CLAUDE.md.
- [ ] **Step 4: Run** it plus `npx vitest run apps/crm/src/__tests__/cssSplitBoundary.test.ts` (the page is public). Expected: PASS.
- [ ] **Step 5: Commit** `docs(privacy): YouTube and Google Meu Negócio data use`.

### Task 13: Full gate, staging deploy, spikes

- [ ] **Step 1: Run the CI set**: `npm run lint`, `npm run format:check`, the four `tsc` commands (`apps/crm`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`, `npm run check:functions`, `npm run test:functions`, `npm run test:db`. Expected: all green. (Deno runs can pollute `node_modules`: if Vitest breaks afterwards, `ls node_modules/.deno` then `npm ci`.)
- [ ] **Step 2: Staging deploy** (only with the user's go-ahead): `npx supabase db push --linked` against staging (`wlyzhyfondykzpsiqsce`; a worktree has no `supabase/.temp/project-ref`, so pass `--project-ref` / link explicitly and confirm the ref before pushing), set staging secrets from a temp `--env-file` (never CLI args): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` of the **staging** Cloud project; `npx supabase functions deploy google-integration --no-verify-jwt`; redeploy the eight importers of `_shared/entitlements.ts`: `automation-media`, `data-import`, `equipe-chat-media`, `mcp-keys`, `mcp-oauth-consent`, `paywall-report`, `platform-admin`, `workspace-limits`.
- [ ] **Step 3: Spikes with the user** (record results in the spec §10.5):
  - S4: connect an account that owns two Brand Account channels; does the chooser pick the channel and does the card show it?
  - S6: same identity connects YouTube, then runs the GMN flow; does the callback get `business.manage` without `prompt=consent`, and does the stored token work for `accounts.list`?
  - S0 (user, prod Cloud Console → Quotas, YouTube Data API v3): how is `videos.insert` metered?
- [ ] **Step 4: Browser check on staging** (`npm run dev:staging` from a checkout with `.env.staging`): flag override on the user's workspace; connect YouTube, see the card; connect GMN, see the picker (or the "ainda não liberou" message until Google approves access); disconnect YouTube; screenshot each state.
- [ ] **Step 5: Open the PR** after renumbering migrations above `main`'s tail; deploy order in the PR body: migrations → `google-integration` + entitlement importers → merge.
