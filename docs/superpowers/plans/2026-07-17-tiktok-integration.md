# TikTok Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect TikTok to Mesaas mirroring the Instagram integration — OAuth connect per client, publish (video + photo carousel), self-scheduled posting, import of existing videos, basic metrics — per the approved spec `docs/superpowers/specs/2026-07-17-tiktok-integration-design.md`.

**Architecture:** Parallel mirror of the Instagram vertical (Approach A). New `tiktok_*` tables + six `tiktok-*` Deno edge functions cloned from the Instagram skeletons; `workflow_posts.platform` enum `instagram|tiktok|both` with per-platform publish state; the only Instagram-code change is routing its three publish-complete call sites through a new `mark_platform_published` RPC and adding claim guards.

**Tech Stack:** Deno edge functions (Supabase), Postgres + pg_cron + Vault, React 19 + TanStack Query (CRM), R2 presigned URLs, TikTok Login Kit v2 + Content Posting API + Display API.

## Global Constraints

- Spec is authoritative: `docs/superpowers/specs/2026-07-17-tiktok-integration-design.md`. Read it before starting any task.
- Phases A→D are each **one PR**, branched off `main` (Phase B branches off Phase A's merge, etc.). Work happens on this branch lineage: `claude/tiktok-mesaas-integration-002a8d` for Phase A.
- Edge functions are **Deno** — `npm:` specifiers or relative `.ts` imports. Never Node.
- CORS: always `buildCorsHeaders(req)` from `_shared/cors.ts`. Never `*`.
- Client-facing errors are generic PT-BR; log details internally only.
- `TOKEN_ENCRYPTION_KEY` required, no fallback — throw if missing.
- Crons verify `x-cron-secret` via `timingSafeEqual` from `_shared/crypto.ts` before anything else.
- Workspace ownership (`conta_id`) verified on every client-scoped route.
- **TikTok wire constants use TikTok's exact strings, including misspellings** — `publicaly_available_post_id` (sic), `post.publish.no_longer_publicaly_available` (sic). Never "fix" the spelling.
- New migrations named `202607DDNNNNNN_<slug>.sql` continuing the repo convention; verify which project is linked (`cat supabase/.temp/project-ref`; PROD=`skjzpekeqefvlojenfsw`, STAGING=`wlyzhyfondykzpsiqsce`) before any `--linked` command.
- `deno test` / `npm run test:functions` dirties root `deno.lock` — run `git checkout -- deno.lock` afterwards. Never commit root `deno.lock` changes. `supabase/functions/deno.lock` IS committed when deps are intentionally added.
- Before every push: `npm run format && npm run lint && npm run test && npm run build`, plus `cd supabase/functions && deno test` for edge-function tasks (CI gates all four).
- Edge deploys use `npx supabase functions deploy <name> --use-api` (local Docker bundler broken) and `--no-verify-jwt` for functions listed in `config.toml` with `verify_jwt = false`.
- Secrets are never passed as literal CLI args — use `npx supabase secrets set --env-file <file>` with a scratch file, then delete it.
- All UI copy is PT-BR.

---

## Phase A — Foundation: connect, import, basic metrics (PR 1)

Deliverable: a client's TikTok account can be connected via OAuth, existing videos import with cached thumbnails, profile stats + follower history accumulate, all visible in a TikTok section on the client detail page. Feature-gated by `feature_tiktok` (dark).

### Task A1: Core tables migration

**Files:**
- Create: `supabase/migrations/20260718000001_tiktok_core.sql`
- Reference (read first): `supabase/migrations/20260301_baseline_schema.sql:172-219` (instagram_accounts/posts shape), `supabase/migrations/20260310_instagram_rls.sql` (RLS pattern), `supabase/migrations/20260513000001_*oauth_states*.sql` (oauth_states shape)

**Interfaces:**
- Produces: tables `tiktok_accounts`, `tiktok_posts`, `tiktok_follower_history`, `tiktok_account_metrics_daily`, `tiktok_webhook_events`; `oauth_states.provider` column; storage bucket `tiktok-posts`.

- [ ] **Step 1: Find how the `instagram-posts` bucket was created** — `grep -rn "instagram-posts" supabase/migrations/` and mirror that statement style for `tiktok-posts`.

- [ ] **Step 2: Write the migration**

```sql
-- 20260718000001_tiktok_core.sql
-- TikTok integration core tables (spec: docs/superpowers/specs/2026-07-17-tiktok-integration-design.md)

CREATE TABLE tiktok_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id bigint NOT NULL UNIQUE REFERENCES clientes(id) ON DELETE CASCADE,
  tiktok_open_id text NOT NULL,
  username text,
  display_name text,
  avatar_url text,
  profile_deep_link text,
  follower_count int,
  following_count int,
  likes_count bigint,
  video_count int,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  refresh_lock_at timestamptz,
  scopes text[],
  authorization_status text NOT NULL DEFAULT 'active'
    CHECK (authorization_status IN ('active','revoked','disconnected','expired')),
  auto_sync_enabled boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tiktok_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  tiktok_video_id text NOT NULL UNIQUE,
  title text,
  video_description text,
  duration int,
  height int,
  width int,
  share_url text,
  embed_link text,
  cover_image_url text,
  posted_at timestamptz,
  views bigint,
  likes int,
  comments int,
  shares int,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tiktok_posts_account ON tiktok_posts(tiktok_account_id, posted_at DESC);

CREATE TABLE tiktok_follower_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  date date NOT NULL,                      -- deliberate fix: real date type (IG's is text)
  follower_count int NOT NULL,
  source text NOT NULL DEFAULT 'api' CHECK (source IN ('api','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tiktok_account_id, date)
);

CREATE TABLE tiktok_account_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  follower_count int,
  following_count int,
  likes_count bigint,
  video_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tiktok_account_id, snapshot_date)
);

-- Webhook durability (service-role only; no client RLS exposure)
CREATE TABLE tiktok_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  user_openid text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX idx_tiktok_webhook_events_unprocessed
  ON tiktok_webhook_events(received_at) WHERE processed_at IS NULL;

ALTER TABLE oauth_states
  ADD COLUMN provider text NOT NULL DEFAULT 'instagram'
  CHECK (provider IN ('instagram','tiktok'));

-- RLS: mirror supabase/migrations/20260310_instagram_rls.sql policy-for-policy,
-- swapping instagram_accounts -> tiktok_accounts (client_id join to clientes.conta_id)
-- and instagram_posts -> tiktok_posts (join via tiktok_accounts). Copy the exact
-- USING/WITH CHECK expressions from that file; do not invent new ones.
ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_follower_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_account_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_webhook_events ENABLE ROW LEVEL SECURITY;  -- no policies: service-role only
```

Then append the adapted policies: open `20260310_instagram_rls.sql`, copy each `CREATE POLICY` for `instagram_accounts` → rewrite for `tiktok_accounts` (same `clientes.conta_id` USING expression, only the table name changes), and each `instagram_posts` policy → `tiktok_posts` (join path `tiktok_posts.tiktok_account_id → tiktok_accounts.client_id → clientes`). `tiktok_follower_history` and `tiktok_account_metrics_daily` get the same account-join policies as `tiktok_posts`. Keep policy names in the same naming style with `tiktok_` prefixes.

Also add the `tiktok-posts` public bucket statement found in Step 1 (mirroring `instagram-posts`).

- [ ] **Step 3: Apply to staging** — verify link (`cat supabase/.temp/project-ref` → must translate to STAGING `wlyzhyfondykzpsiqsce`; note staging `db push` aborts on the orphaned 130000 backfill — if so, apply this single migration via the SQL editor and record the version, per the established workaround). Verify tables exist: `select * from tiktok_accounts limit 0;` in SQL editor.

- [ ] **Step 4: Commit** — `git add supabase/migrations/20260718000001_tiktok_core.sql && git commit -m "feat(tiktok): core tables, oauth provider column, tiktok-posts bucket"`

### Task A2: `feature_tiktok` entitlement — every touchpoint

**Files:**
- Modify: `supabase/functions/_shared/entitlements.ts` (single source of plan columns)
- Create: `supabase/migrations/20260718000002_feature_tiktok.sql`
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts:25-47` (`FeatureFlags` interface)
- Modify: `apps/crm/src/lib/entitlement-errors.ts:20-37` (`FEATURE_LABELS`)
- Reference: how `feature_estudio` was added (grep `feature_estudio` across `supabase/` and `apps/` — mirror every hit *except* pricing selects in `apps/crm/src/services/billing.ts`, which stay untouched while dark)

**Interfaces:**
- Produces: plan flag `feature_tiktok` resolvable via `effectivePlanFeature(svc, contaId, 'feature_tiktok')` (existing helper in `_shared/entitlements-rpc.ts`) and via `useWorkspaceLimits().features.feature_tiktok` in the CRM.

- [ ] **Step 1:** `grep -rn "feature_estudio" supabase/ apps/ | grep -v test | grep -v billing.ts` — this is the authoritative touchpoint list. Add `feature_tiktok` beside `feature_estudio` at every hit (entitlements.ts arrays/types, admin panel plan editor arrays, workspace-limits function if it enumerates flags).
- [ ] **Step 2:** Migration: `ALTER TABLE plans ADD COLUMN feature_tiktok boolean NOT NULL DEFAULT false;` plus whatever `effective_plan_*` SQL the feature_estudio grep shows needs a matching column reference. Do NOT add `max_tiktok_accounts` (YAGNI per spec).
- [ ] **Step 3:** CRM: add `feature_tiktok: boolean;` to `FeatureFlags`; add `feature_tiktok: 'TikTok'` to `FEATURE_LABELS`.
- [ ] **Step 4:** Existing entitlements tests live in `supabase/functions/__tests__/entitlements/` — run `cd supabase/functions && deno test __tests__/entitlements/`; fix any snapshot/shape assertions that enumerate flags. Run `npm run test`.
- [ ] **Step 5:** Apply migration to staging; commit: `feat(tiktok): feature_tiktok plan flag across entitlement touchpoints`.

### Task A3: `_shared/tiktok.ts` — wire constants, crypto, API wrapper

**Files:**
- Create: `supabase/functions/_shared/tiktok.ts`
- Test: `supabase/functions/__tests__/tiktok-shared_test.ts`
- Reference: `supabase/functions/instagram-integration/index.ts:18-70` (AES-GCM + HKDF pattern)

**Interfaces:**
- Produces (consumed by every later TikTok task):

```ts
export const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
export const TIKTOK_SCOPES = "user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish";
// sic — TikTok's official misspellings; never correct these strings:
export const FIELD_PUBLIC_POST_ID = "publicaly_available_post_id";
export const EVENT_PUBLISH_COMPLETE = "post.publish.complete";
export const EVENT_PUBLISH_FAILED = "post.publish.failed";
export const EVENT_PUBLICLY_AVAILABLE = "post.publish.publicly_available";
export const EVENT_NO_LONGER_PUBLICALY_AVAILABLE = "post.publish.no_longer_publicaly_available"; // sic
export const EVENT_AUTH_REMOVED = "authorization.removed";
export const RETRYABLE_FAIL_REASONS = ["video_pull_failed", "photo_pull_failed", "internal"];

export async function encryptTikTokToken(raw: string, kind: "access" | "refresh"): Promise<string>;
export async function decryptTikTokToken(enc: string, kind: "access" | "refresh"): Promise<string>;
export class TikTokApiError extends Error { code: string; retryable: boolean; }
export async function tiktokFetch(path: string, init: RequestInit & { accessToken: string }): Promise<unknown>; // throws TikTokApiError; maps error.code access_token_invalid -> code "TOKEN_INVALID", scope errors -> "REVOKED", 429 -> retryable "RATE_LIMITED"
```

- [ ] **Step 1: Failing tests** — in `tiktok-shared_test.ts`: (a) `encryptTikTokToken` → `decryptTikTokToken` round-trips for both kinds with `TOKEN_ENCRYPTION_KEY` set via `Deno.env.set`; (b) decrypting an `access` token as `refresh` kind throws (different HKDF info); (c) missing `TOKEN_ENCRYPTION_KEY` throws; (d) `tiktokFetch` against a mocked `fetch` returning `{"error":{"code":"access_token_invalid"}}` throws `TikTokApiError` with `code==="TOKEN_INVALID"`; (e) constants spell-check: `assertEquals(EVENT_NO_LONGER_PUBLICALY_AVAILABLE, "post.publish.no_longer_publicaly_available")`.
- [ ] **Step 2:** `cd supabase/functions && deno test __tests__/tiktok-shared_test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement. Crypto: copy the HKDF/AES-GCM code from `instagram-integration/index.ts:18-53` verbatim, parametrize `info` as `` `tiktok-${kind}-token` ``, **omit** the legacy padEnd fallback branch. `tiktokFetch`: `fetch(TIKTOK_API_BASE + path, ...)` with `Authorization: Bearer`, parse `error.code` from TikTok's envelope (`{data, error:{code, message, log_id}}` — `code === "ok"` means success).
- [ ] **Step 4:** Tests pass. `git checkout -- ../../deno.lock` if dirtied.
- [ ] **Step 5:** Commit: `feat(tiktok): shared wire constants, token crypto, API wrapper`.

### Task A4: Rotation-safe token freshness — `getFreshTikTokToken`

**Files:**
- Modify: `supabase/functions/_shared/tiktok.ts`
- Test: `supabase/functions/__tests__/tiktok-token-refresh_test.ts`

**Interfaces:**
- Produces: `export async function getFreshTikTokToken(svc: SupabaseClient, accountId: string): Promise<{ accessToken: string; openId: string }>` — the ONLY code path that reads/refreshes TikTok tokens anywhere.

- [ ] **Step 1: Failing tests** (mock `svc` + `fetch`):
  - access token valid >30 min → returns decrypted token, **no** refresh call;
  - expiring token → refresh POST to `/oauth/token/` with `grant_type=refresh_token`, **persists new encrypted access+refresh tokens and expiries BEFORE returning** (assert update called with new refresh token, then return);
  - refresh response with a rotated `refresh_token` different from input → the rotated one is what gets persisted;
  - refresh fails `invalid_grant` → account updated to `authorization_status='expired'` and typed error `TOKEN_EXPIRED` thrown;
  - lock contention: claim UPDATE returns 0 rows → helper polls the row (3 × 2 s) and returns the token another process refreshed.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with an atomic claim (no cross-request `FOR UPDATE` from supabase-js):

```ts
// claim: only one process refreshes at a time
const { data: claimed } = await svc.from("tiktok_accounts")
  .update({ refresh_lock_at: new Date().toISOString() })
  .eq("id", accountId)
  .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${new Date(Date.now() - 60_000).toISOString()}`)
  .select("id, encrypted_refresh_token, tiktok_open_id")
  .maybeSingle();
```

Refresh body (form-encoded): `client_key`, `client_secret`, `grant_type=refresh_token`, `refresh_token`. Persist `encrypted_access_token`, `encrypted_refresh_token` (rotated!), `access_token_expires_at = now + expires_in`, `refresh_token_expires_at = now + refresh_expires_in`, `refresh_lock_at = null` in ONE update. Release the lock in a `finally` on error paths too.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit: `feat(tiktok): rotation-safe getFreshTikTokToken with per-account claim lock`.

### Task A5: `tiktok-integration` edge function

**Files:**
- Create: `supabase/functions/tiktok-integration/index.ts`, `supabase/functions/tiktok-integration/oauth-state.ts`, `supabase/functions/_shared/tiktok-thumbnail-cache.ts`
- Modify: `supabase/config.toml` (add `[functions.tiktok-integration] verify_jwt = false`)
- Test: `supabase/functions/__tests__/tiktok-integration_test.ts`
- Clone sources: `supabase/functions/instagram-integration/index.ts` (routing, ownership, callback structure), `instagram-integration/oauth-state.ts` (HMAC state — add `provider:'tiktok'` to the payload and nonce insert), `_shared/instagram-thumbnail-cache.ts` (bucket cache — parametrize bucket name to `tiktok-posts`)

**Interfaces:**
- Produces HTTP contract (mirrors Instagram's, consumed by Task A7's service):
  - `GET /auth/:clientId` → `{ url }` (TikTok authorize URL) — gates: ownership + `feature_tiktok`
  - `GET /callback?code&state` → 302 to `${OAUTH_REDIRECT_BASE}/clientes/{clientId}` (`?tt_error=1` on failure)
  - `POST /sync/:clientId` → `{ ok, synced_posts }` (rate-limit 5/300 s via `_shared/rate-limit.ts`)
  - `POST /refresh/:clientId` → `{ ok }`
  - `POST|DELETE /disconnect/:clientId` → `{ ok }` (calls `/v2/oauth/revoke/`, deletes `tiktok_posts`, blanks tokens, status `disconnected`)
  - `GET /summary/:clientId` → `{ account, follower_history }` (last 30)
  - `GET /posts/:clientId?page=` → `{ posts, total }` (10/page)
- Env consumed: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `OAUTH_REDIRECT_BASE`, `TOKEN_ENCRYPTION_KEY`.

Key call shapes (exact):
- Authorize URL: `TIKTOK_AUTH_URL?client_key=…&scope=${TIKTOK_SCOPES}&response_type=code&redirect_uri=${TIKTOK_REDIRECT_URI}&state=${signedState}`
- Token exchange: `POST ${TIKTOK_API_BASE}/oauth/token/` form-encoded `client_key, client_secret, code, grant_type=authorization_code, redirect_uri` → `{ open_id, access_token, expires_in, refresh_token, refresh_expires_in, scope }`
- Profile: `GET ${TIKTOK_API_BASE}/user/info/?fields=open_id,union_id,avatar_url,display_name,username,profile_deep_link,follower_count,following_count,likes_count,video_count`
- Video list: `POST ${TIKTOK_API_BASE}/video/list/?fields=id,create_time,cover_image_url,share_url,video_description,duration,height,width,title,embed_link,like_count,comment_count,share_count,view_count` body `{ max_count: 20, cursor? }` — paginate until `has_more=false` or 100 videos on initial import.

- [ ] **Step 1: Failing tests** — handler-level with injected deps (mirror how `__tests__` mocks other functions): (a) `/auth` without JWT → 401; (b) `/auth` for a client in another conta → 404/403 (match IG behavior); (c) `/auth` with `feature_tiktok=false` → 403 `feature_disabled`; (d) callback with bad state signature → redirect with `tt_error=1`; (e) callback happy path (mocked TikTok fetches) → upserts `tiktok_accounts` with BOTH encrypted tokens + inserts follower_history row + imports videos; (f) `/disconnect` keeps the row with `authorization_status='disconnected'`; (g) `/posts` pagination math `Math.max(1, parseInt(pageStr) || 1)`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement by cloning `instagram-integration/index.ts` route-for-route, replacing Graph calls with the shapes above, all token handling through Task A3/A4 helpers, thumbnails through `tiktok-thumbnail-cache.ts` (`cachePostThumbnail(svc, accountId, videoId, coverUrl)` → downloads and stores to `tiktok-posts/{accountId}/{videoId}.jpg`, returns public URL; already-cached URLs returned untouched). Cache the profile `avatar_url` to the existing `avatars` bucket exactly the way `instagram-integration` does (find its avatar-cache call and reuse the same helper). Audit action string: `tiktok-link`.
- [ ] **Step 4:** Tests pass. Add config.toml entry.
- [ ] **Step 5:** Commit: `feat(tiktok): tiktok-integration edge function (oauth, sync, import, summary)`.

### Task A6: `tiktok-refresh-cron` + schedule

**Files:**
- Create: `supabase/functions/tiktok-refresh-cron/index.ts`, `supabase/migrations/20260718000003_tiktok_cron_refresh.sql`
- Modify: `supabase/config.toml`
- Test: `supabase/functions/__tests__/tiktok-refresh-cron_test.ts`
- Clone sources: `supabase/functions/instagram-refresh-cron/index.ts` (structure + `reportCronFailure`), `supabase/migrations/20260617120000_*.sql` (pg_cron + Vault pattern)

**Interfaces:**
- Produces: cron selecting `active` accounts where `access_token_expires_at <= now()+ interval '12 hours'` → `getFreshTikTokToken` each; separately flags nothing but logs accounts with `refresh_token_expires_at <= now()+interval '30 days'` (UI reads that column directly — no status change).

- [ ] **Step 1: Failing tests** — (a) missing/wrong `x-cron-secret` → 401 before any DB access; (b) expiring account triggers refresh via the shared helper (assert mocked helper called); (c) helper `TOKEN_EXPIRED` marks nothing extra (helper already set `expired`) and the cron continues to the next account; (d) cron reports failures via `reportCronFailure` mock.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Migration: clone the Vault/`net.http_post` block from `20260617120000`, schedule `tiktok-refresh-cron` at `15 */6 * * *`. Commit: `feat(tiktok): refresh cron (6h) with rotation-safe helper`.

### Task A7: Frontend service `services/tiktok.ts`

**Files:**
- Create: `apps/crm/src/services/tiktok.ts`
- Test: `apps/crm/src/services/__tests__/tiktok.test.ts` (mirror the existing instagram service test file location — `ls apps/crm/src/services/__tests__/` first and match)
- Clone source: `apps/crm/src/services/instagram.ts` (5-min in-memory cache pattern, edge-function fetch with session token)

**Interfaces:**
- Produces: `getTikTokAuthUrl(clientId)`, `syncTikTokData(clientId)`, `refreshTikTokToken(clientId)`, `disconnectTikTok(clientId)`, `getTikTokSummary(clientId)`, `getTikTokPosts(clientId, page)` — all hitting `tiktok-integration`. (Publishing functions arrive in Phase B.)
- Types: `TikTokAccount`, `TikTokPost`, `TikTokSummary` interfaces matching Task A5's response JSON exactly (fields as in the A5 contract).

- [ ] **Step 1:** Failing tests: URL construction per endpoint, cache hit within 5 min, cache bust after `syncTikTokData`. **Step 2:** FAIL. **Step 3:** Clone + rename from instagram.ts. **Step 4:** PASS (`npm run test`). **Step 5:** Commit: `feat(tiktok): CRM tiktok service`.

### Task A8: Client-detail TikTok section (widgets)

**Files:**
- Create: `apps/crm/src/components/tiktok/TikTokConnectButton.ts`, `TikTokOverviewCard.ts`, `TikTokFollowerChart.ts`, `TikTokPostsTable.ts`
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` (add `TikTokSection` next to `InstagramSection`, ~line 2430; also register it in the floating section nav added in PR #207)
- Clone sources: `apps/crm/src/components/instagram/*.ts` (same imperative widget pattern)

**Interfaces:**
- Consumes: Task A7's service functions and types.
- Produces: `TikTokSection` rendered only when `useWorkspaceLimits().features.feature_tiktok` is true; connect button opens `getTikTokAuthUrl` result; connected state shows overview (followers/likes/videos), follower chart, posts table with cached thumbnails, sync + disconnect actions; `authorization_status !== 'active'` renders the reconnect warning state; `refresh_token_expires_at < 30 days` renders "Reconecte a conta TikTok em breve" banner.

- [ ] **Step 1:** Clone each instagram widget file, rename Instagram→TikTok, swap service imports, adjust metric labels (PT-BR: "Seguidores", "Curtidas", "Vídeos", "Visualizações"). Handle the `?tt_error=1` query param with a toast (mirror `ig_error` handling).
- [ ] **Step 2:** Wire `TikTokSection` into `ClienteDetalhePage.tsx`, gated on `feature_tiktok`.
- [ ] **Step 3:** Component tests: mirror whatever exists for instagram widgets in `apps/crm/src/**/__tests__` (if none exist for the imperative widgets, add a smoke test that `TikTokSection` renders nothing when the flag is off — the flag gate is the testable seam).
- [ ] **Step 4:** `npm run test && npm run build` → PASS.
- [ ] **Step 5:** Commit: `feat(tiktok): client-detail TikTok section (connect, overview, chart, posts)`. Open PR 1 (`feat(tiktok): foundation — connect, import, basic metrics`).

---

## Phase B — Publishing backbone (PR 2)

Deliverable: TikTok-targeted and `both` posts schedule, publish via cron, report status via webhook+polling, with the Instagram pipeline race-proofed.

### Task B1: Publish-state migration + RPCs

**Files:**
- Create: `supabase/migrations/20260719000001_tiktok_publishing.sql`
- Reference: `supabase/migrations/20260625000001_instagram_story_segments.sql:50-136` (claim RPC to clone), `supabase/migrations/20260606000001_post_status_events.sql:73-116` (`record_post_status_change` — signature `(p_post_id bigint, p_new_status text, p_source text, p_actor uuid, p_approval_id bigint, p_fields jsonb)`)

**Interfaces:**
- Produces: `workflow_posts` columns `platform`, `tiktok_publish_id`, `tiktok_post_id`, `tiktok_post_url`, `tiktok_publish_status`, `tiktok_publish_error`, `tiktok_publish_retry_count`, `tiktok_publish_processing_at`, `tiktok_caption`, `tiktok_title`, `tiktok_settings`; RPCs `claim_posts_for_tiktok_publishing(p_phase, p_limit)` and `mark_platform_published(p_post_id, p_platform, p_source, p_actor, p_fields)`; guarded `claim_posts_for_publishing`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260719000001_tiktok_publishing.sql

ALTER TABLE workflow_posts
  ADD COLUMN platform text NOT NULL DEFAULT 'instagram'
    CHECK (platform IN ('instagram','tiktok','both')),
  ADD COLUMN tiktok_publish_id text,
  ADD COLUMN tiktok_post_id text,
  ADD COLUMN tiktok_post_url text,
  ADD COLUMN tiktok_publish_status text
    CHECK (tiktok_publish_status IN ('initiated','processing','published','failed')),
  ADD COLUMN tiktok_publish_error text,
  ADD COLUMN tiktok_publish_retry_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN tiktok_publish_processing_at timestamptz,
  ADD COLUMN tiktok_caption text,
  ADD COLUMN tiktok_title text,
  ADD COLUMN tiktok_settings jsonb;

-- ── TikTok claim (mirror of claim_posts_for_publishing, single init step: no container phase)
CREATE OR REPLACE FUNCTION claim_posts_for_tiktok_publishing(
  p_phase text,          -- 'init' | 'status' | 'retry'
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  tipo text,
  scheduled_at timestamptz,
  caption text,                 -- tiktok_caption fallback ig_caption resolved here
  tiktok_title text,
  tiktok_settings jsonb,
  tiktok_publish_id text,
  tiktok_publish_retry_count smallint,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  tiktok_account_id uuid,
  tiktok_open_id text,
  tiktok_username text,
  client_id bigint
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE wp.platform IN ('tiktok','both')
      AND CASE p_phase
        WHEN 'init' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now()
          AND wp.tiktok_publish_status IS NULL
        WHEN 'status' THEN
          wp.status = 'agendado'
          AND wp.tiktok_publish_status IN ('initiated','processing')
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.tiktok_publish_status = 'failed'
          AND wp.tiktok_publish_retry_count < 3
      END
      AND (wp.tiktok_publish_processing_at IS NULL
           OR wp.tiktok_publish_processing_at < now() - interval '10 minutes')
    FOR UPDATE OF wp SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE workflow_posts
    SET tiktok_publish_processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id, u.workflow_id, u.tipo, u.scheduled_at,
    COALESCE(u.tiktok_caption, u.ig_caption, '') AS caption,
    u.tiktok_title, u.tiktok_settings, u.tiktok_publish_id,
    u.tiktok_publish_retry_count,
    ta.encrypted_access_token, ta.encrypted_refresh_token, ta.access_token_expires_at,
    ta.id, ta.tiktok_open_id, ta.username, c.id
  FROM updated u
  JOIN workflows w  ON w.id = u.workflow_id
  JOIN clientes c   ON c.id = w.cliente_id
  JOIN tiktok_accounts ta ON ta.client_id = c.id AND ta.authorization_status = 'active';
$$;
REVOKE ALL ON FUNCTION claim_posts_for_tiktok_publishing(text, int) FROM public;
GRANT EXECUTE ON FUNCTION claim_posts_for_tiktok_publishing(text, int) TO service_role;

-- ── Aggregate completion (the ONE Instagram-code change; see spec "mark_platform_published")
CREATE OR REPLACE FUNCTION mark_platform_published(
  p_post_id  bigint,
  p_platform text,               -- 'instagram' | 'tiktok'
  p_source   text  DEFAULT 'system',
  p_actor    uuid  DEFAULT NULL,
  p_fields   jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_platform text;
  v_ig_media text;
  v_tt_status text;
  ig_done boolean;
  tt_done boolean;
BEGIN
  IF p_platform NOT IN ('instagram','tiktok') THEN
    RAISE EXCEPTION 'mark_platform_published: invalid platform %', p_platform;
  END IF;

  -- serialize concurrent IG/TikTok completions on the same card
  SELECT platform, instagram_media_id, tiktok_publish_status
    INTO v_platform, v_ig_media, v_tt_status
  FROM workflow_posts WHERE id = p_post_id FOR UPDATE;

  IF p_platform = 'instagram' THEN
    UPDATE workflow_posts SET
      instagram_media_id    = COALESCE(p_fields->>'instagram_media_id', instagram_media_id),
      instagram_permalink   = COALESCE(p_fields->>'instagram_permalink', instagram_permalink),
      published_at          = COALESCE((p_fields->>'published_at')::timestamptz, published_at),
      publish_processing_at = NULL,
      publish_error         = NULL,
      publish_retry_count   = 0
    WHERE id = p_post_id;
    v_ig_media := COALESCE(p_fields->>'instagram_media_id', v_ig_media);
  ELSE
    UPDATE workflow_posts SET
      tiktok_publish_status = 'published',
      tiktok_post_id        = COALESCE(p_fields->>'tiktok_post_id', tiktok_post_id),
      tiktok_post_url       = COALESCE(p_fields->>'tiktok_post_url', tiktok_post_url),
      published_at          = COALESCE(published_at, (p_fields->>'published_at')::timestamptz),
      tiktok_publish_processing_at = NULL,
      tiktok_publish_error  = NULL
    WHERE id = p_post_id;
    v_tt_status := 'published';
  END IF;

  ig_done := (v_platform = 'tiktok')    OR v_ig_media IS NOT NULL;
  tt_done := (v_platform = 'instagram') OR v_tt_status = 'published';

  IF ig_done AND tt_done THEN
    PERFORM record_post_status_change(p_post_id, 'postado', p_source, p_actor, NULL, '{}'::jsonb);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION mark_platform_published(bigint, text, text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION mark_platform_published(bigint, text, text, uuid, jsonb) TO service_role;

-- ── Guard the IG claim against double-publish on `both` retries:
-- re-create claim_posts_for_publishing (same body as 20260625000001) with THREE edits:
--   1. top-level WHERE gains: AND wp.platform IN ('instagram','both')
--   2. 'container' and 'publish' phases gain: AND wp.instagram_media_id IS NULL
--   3. 'retry' phase gains: AND wp.instagram_media_id IS NULL
-- Copy the full function text from that migration and apply exactly those edits.
```

- [ ] **Step 2:** pgTAP tests (mirror the layout in `supabase/tests/` — see `post_media_set_from_uploads.sql` and its `et_make_workspace` fixtures): (a) `mark_platform_published('instagram')` on a `platform='instagram'` post → status `postado` (parity with today); (b) on a `platform='both'` post with TikTok pending → status stays `agendado`, `instagram_media_id` set; (c) then `mark_platform_published('tiktok')` → status `postado`; (d) TikTok claim `init` ignores `platform='instagram'` posts and accounts not `active`; (e) IG claim skips a `both` post whose `instagram_media_id` is already set even in status `agendado`; (f) TikTok claim `retry` requires `falha_publicacao` + `failed` + retry<3.
- [ ] **Step 3:** Run pgTAP per repo convention (check how CI runs `supabase/tests/` — mirror it locally). Apply migration to staging.
- [ ] **Step 4:** Commit: `feat(tiktok): platform column, publish-state, claim + mark_platform_published RPCs, IG claim guards`.

### Task B2: Move the three IG completion call sites

**Files:**
- Modify: `supabase/functions/instagram-publish/handler.ts:234-251` (stories publish-now), `handler.ts:300-323` (feed/reel publish-now), `supabase/functions/instagram-publish-cron/index.ts` (phase-2 `markPublished` — grep `record_post_status_change` with `postado` in that file)
- Test: update existing suites — `grep -rn "postado" supabase/functions/__tests__/ | grep -il publish` to find assertions on the old RPC call.

**Interfaces:**
- Consumes: `mark_platform_published` (Task B1).
- Produces: all IG success paths call `svcDb.rpc("mark_platform_published", { p_post_id, p_platform: "instagram", p_source, p_actor, p_fields: { instagram_media_id, instagram_permalink?, published_at } })` instead of `record_post_status_change(..., 'postado', ...)`. Failure paths (`falha_publicacao`) are **unchanged**.

- [ ] **Step 1:** Update the existing tests first to expect `mark_platform_published` (they should FAIL against current code).
- [ ] **Step 2:** Swap the three call sites. Permalink fetch after publish stays; pass it in `p_fields` where available, else keep the follow-up `.update({instagram_permalink})` as-is.
- [ ] **Step 3:** `deno test` the instagram publish suites → PASS. Run the FULL function suite (`cd supabase/functions && deno test`) — contract changes break neighbors; fix any other assertion on the old shape.
- [ ] **Step 4:** Commit: `refactor(instagram): route publish completion through mark_platform_published`.

### Task B3: `_shared/tiktok-publish-utils.ts` — validation matrix + payload builders

**Files:**
- Create: `supabase/functions/_shared/tiktok-publish-utils.ts`
- Test: `supabase/functions/__tests__/tiktok-publish-utils_test.ts`
- Reference: `_shared/instagram-publish-utils.ts:184-290` (`validateForScheduling` structure, design-readiness gate `checkDesignReadiness:167-182`), `_shared/r2.ts:46` (`signGetUrl`)

**Interfaces:**
- Produces:

```ts
export interface TikTokValidationResult { ok: boolean; errors: string[]; account?: {...}; }
export async function validateForTikTokScheduling(svc, postId: number, opts?: { skipDateCheck?: boolean }): Promise<TikTokValidationResult>;
export function buildVideoInitPayload(post: ClaimedTikTokPost, videoUrl: string): object;   // /post/publish/video/init/ body
export function buildPhotoInitPayload(post: ClaimedTikTokPost, imageUrls: string[]): object; // /post/publish/content/init/ body
export function mapStatusFetch(json: any): { state: "processing"|"published"|"failed"; publicPostId?: string; failReason?: string };
```

Validation rules (each is a test case):
- tipo `stories` + TikTok target → error "Stories não são suportados no TikTok".
- caption limits per tipo: video (`tiktok_caption ?? ig_caption`) ≤2200 UTF-16 code units; photo description ≤4000; `tiktok_title` ≤90 (photo only; error if set on video tipo).
- `carrossel`: every linked file must be image MIME; count ≤20 for `platform='tiktok'`, ≤10 for `'both'`; any video item + TikTok target → error.
- `tiktok_settings.privacy_level` required and ∈ {PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR, SELF_ONLY}.
- **Unaudited gate:** `Deno.env.get("TIKTOK_APP_AUDITED") !== "true"` → privacy_level must be `SELF_ONLY`, else error "App TikTok em modo de teste: apenas publicação privada (SELF_ONLY) é permitida até a auditoria do TikTok".
- account exists, `authorization_status='active'`, tokens decryptable.
- Estúdio gate: reuse `checkDesignReadiness` from instagram-publish-utils (import it — it is platform-agnostic).
- media presence: ≥1 file; video tipo exactly 1 video file.

Payload shapes (exact):

```ts
// video: POST /v2/post/publish/video/init/
{ post_info: { title, privacy_level, disable_comment, disable_duet, disable_stitch,
               brand_organic_toggle, brand_content_toggle, is_aigc, video_cover_timestamp_ms },
  source_info: { source: "PULL_FROM_URL", video_url } }
// photo: POST /v2/post/publish/content/init/
{ post_info: { title: tiktok_title ?? undefined, description: caption, privacy_level,
               disable_comment, auto_add_music, brand_organic_toggle, brand_content_toggle },
  source_info: { source: "PULL_FROM_URL", photo_images: imageUrls,
                 photo_cover_index: settings.photo_cover_index ?? 0 },
  post_mode: "DIRECT_POST", media_type: "PHOTO" }
```

Omit `undefined` keys entirely (TikTok rejects nulls). Video-only fields never appear in photo payloads and vice-versa.

- [ ] **Step 1:** Write the full failing test matrix above (one test per rule + payload snapshot tests + `mapStatusFetch` for `PROCESSING_DOWNLOAD`/`PUBLISH_COMPLETE` with `publicaly_available_post_id`/`FAILED` with reason).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit: `feat(tiktok): scheduling validation matrix and post payload builders`.

### Task B4: `tiktok-publish` edge function

**Files:**
- Create: `supabase/functions/tiktok-publish/index.ts`, `supabase/functions/tiktok-publish/handler.ts`
- Test: `supabase/functions/__tests__/tiktok-publish_test.ts`
- Clone source: `supabase/functions/instagram-publish/{index,handler}.ts` (deps-injection shape incl. `waitUntil`, JWT actor resolution, route parsing)
- NOTE: do **not** add to `config.toml` — gateway JWT stays on, mirroring `instagram-publish`.

**Interfaces:**
- Consumes: B3 validators/builders, A4 token helper, B1 RPCs.
- Produces HTTP contract (consumed by Phase C UI):
  - `GET /creator-info/:clientId` → proxied `POST /v2/post/publish/creator_info/query/` result `{ creator_nickname, creator_avatar_url, privacy_level_options, comment_disabled, duet_disabled, stitch_disabled, max_video_post_duration_sec }` — fetched fresh every call, never cached.
  - `POST /schedule/:postId` body `{ scheduled_at }` — for `platform IN ('tiktok','both')`; runs `validateForTikTokScheduling`; for `both` ALSO runs IG `validateForScheduling` (direct import); on ok → `record_post_status_change(postId,'agendado', 'workspace_user', actor, NULL, { scheduled_at })`. 422 with `details` array on validation failure.
  - `POST /publish-now/:postId` — validate (skipDateCheck) → status `agendado` with `tiktok_publish_processing_at=now()` → init → poll status fetch (12 × 3 s) → on `published`: `mark_platform_published('tiktok', …)`; on still-processing: leave `initiated` for the cron, return `{ ok, status: 'agendado', message: 'TikTok ainda processando…' }`; on fail → `record_post_status_change('falha_publicacao', …)` + tiktok fields.
  - `POST /cancel/:postId` — for tiktok/both: clear `tiktok_publish_*` fields; for `both` also clear `instagram_container_id`; revert status exactly as `instagram-publish` cancel does (read its cancel branch and mirror the target status logic).
  - `POST /retry/:postId` — requires status `falha_publicacao` + `tiktok_publish_status='failed'`: reset `tiktok_publish_status=NULL`, `tiktok_publish_error=NULL`, status back to `agendado` via `record_post_status_change`. Touches nothing IG.
  - All routes: gate `feature_post_scheduling` AND `feature_tiktok` via `effectivePlanFeature`.
- [ ] **Step 1:** Failing tests: schedule happy path (tiktok-only), `both` runs BOTH validators (assert IG validator called), schedule 422 on validation errors, unaudited gate error propagates, retry resets only TikTok fields, cancel on `both` clears both platforms' handles, creator-info requires ownership, publish-now marks platform + card `postado` when platform='tiktok'.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + full deno suite. **Step 5:** Commit: `feat(tiktok): tiktok-publish function (creator-info, schedule, publish-now, cancel, retry)`.

### Task B5: `tiktok-publish-cron`

**Files:**
- Create: `supabase/functions/tiktok-publish-cron/index.ts`, `supabase/migrations/20260719000002_tiktok_publish_cron_schedule.sql`
- Modify: `supabase/config.toml`
- Test: `supabase/functions/__tests__/tiktok-publish-cron_test.ts`
- Clone source: `supabase/functions/instagram-publish-cron/index.ts` (phase loop, `markFailed`, limits, lock reclaim)

**Interfaces:**
- Consumes: `claim_posts_for_tiktok_publishing` (phases `init` 25 / `status` 25 / `retry` 10), B3 builders + `mapStatusFetch`, A4 token helper, B1 `mark_platform_published`.
- Produces per phase:
  - **init:** group claimed posts by account, cap 5 inits/account/run (6/min TikTok limit); media → `signGetUrl(r2_key, 7200)`; call init endpoint; store `tiktok_publish_id`, set `tiktok_publish_status='initiated'`, clear processing lock. `checkDesignReadiness` re-checked before init.
  - **status:** status-fetch each; `published` → `mark_platform_published('tiktok', { tiktok_post_id?, tiktok_post_url? , published_at })` (build `tiktok_post_url` as `https://www.tiktok.com/@{username}/video/{postId}` when public id present); still processing → set `'processing'`, release lock; `FAILED` → `markTikTokFailed`.
  - **retry:** reset to init path (`tiktok_publish_status=NULL`, status `agendado` via `record_post_status_change`), increment handled by markTikTokFailed at failure time.
  - `markTikTokFailed(svc, postId, reason)`: `tiktok_publish_status='failed'`, error ≤500 chars, `tiktok_publish_retry_count++`, release lock, `record_post_status_change('falha_publicacao', 'system', …)`; `TOKEN_EXPIRED` → account `expired`; reason ∉ `RETRYABLE_FAIL_REASONS` → set `tiktok_publish_retry_count=3` (skip retries).
- [ ] **Step 1:** Failing tests: cron-secret gate; init phase respects per-account cap; init on photo carrossel builds photo payload; status `PUBLISH_COMPLETE` triggers mark RPC; non-retryable `spam_risk_too_many_posts` jumps retry count to 3; `video_pull_failed` stays retryable.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Migration: pg_cron `* * * * *` (clone Vault block). config.toml `verify_jwt=false`. Commit: `feat(tiktok): publish cron (init/status/retry phases)`.

### Task B6: `tiktok-webhook`

**Files:**
- Create: `supabase/functions/tiktok-webhook/index.ts`, `supabase/functions/tiktok-webhook/handler.ts`
- Modify: `supabase/config.toml` (`verify_jwt = false`)
- Test: `supabase/functions/__tests__/tiktok-webhook_test.ts`

**Interfaces:**
- Consumes: A3 event constants, B1 tables, B5's status-processing logic (extract the shared "confirm via status fetch then apply" into `_shared/tiktok-publish-utils.ts` as `confirmAndApplyPublishStatus(svc, postId)` so cron and webhook share one implementation).
- Produces: handler with injected `waitUntil` (index.ts wires `EdgeRuntime.waitUntil` exactly like `instagram-publish/index.ts:22`). Flow: parse → validate `client_key === TIKTOK_CLIENT_KEY` and `user_openid` resolves to a `tiktok_accounts` row (unknown → 200 drop) → **INSERT into `tiktok_webhook_events` synchronously; insert failure → 500** (TikTok retries 72 h) → respond 200 → `waitUntil(process(eventRowId))`. Processing: find post by `tiktok_publish_id` from payload `content`; re-confirm via status fetch before mutating; `EVENT_PUBLICLY_AVAILABLE` → store `tiktok_post_id` + `tiktok_post_url`; `EVENT_AUTH_REMOVED` → account `revoked` + audit log; stamp `processed_at`. Duplicate events are no-ops (idempotent by construction: state transitions re-derive from status fetch).
- [ ] **Step 1:** Failing tests: bad client_key → 200 drop, no insert; insert failure → 500; happy path inserts BEFORE the 200 (assert with a deps-injected insert spy); duplicate delivery processes without state corruption; `authorization.removed` revokes.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + full deno suite + `git checkout -- deno.lock`.
- [ ] **Step 5:** Commit: `feat(tiktok): durable webhook receiver`. Open PR 2 (`feat(tiktok): publishing backbone`).

---

## Phase C — Publishing UI, sync cron, Hub badge (PR 3)

Deliverable: users can target TikTok/both from the post editor, fill the compliant TikTok panel, schedule/cancel/retry per platform; daily sync keeps metrics fresh; Hub shows platform badges.

### Task C1: Frontend publishing service + platform selector

**Files:**
- Modify: `apps/crm/src/services/tiktok.ts` (add `getTikTokCreatorInfo(clientId)`, `scheduleTikTokPost(postId, scheduledAt)`, `cancelTikTokSchedule(postId)`, `publishTikTokPostNow(postId)`, `retryTikTokPublish(postId)` → `tiktok-publish` routes)
- Modify: the post editor component that renders `tipo` selection in `apps/crm/src/pages/entregas/` (locate via `grep -rn "carrossel" apps/crm/src/pages/entregas/ --include=*.tsx -l`) — add the platform selector (segmented control: Instagram | TikTok | Ambas)
- Test: extend `apps/crm/src/services/__tests__/tiktok.test.ts` + a component test for selector gating

**Interfaces:**
- Produces: `platform` persisted on the post row (add to the update payload where `tipo` is saved — find the store.ts/service function that PATCHes workflow_posts). Selector rules: TikTok options disabled (with tooltip) when `tipo==='stories'` or client has no `active` tiktok account or `feature_tiktok` off; default `'instagram'`.
- [ ] Steps: failing service tests → implement service → selector UI → component test (stories disables TikTok; no account disables TikTok) → `npm run test && npm run build` → commit `feat(tiktok): platform selector + publishing service`.

### Task C2: TikTok settings panel (creator_info compliance UI)

**Files:**
- Create: `apps/crm/src/pages/entregas/components/TikTokSettingsPanel.tsx`
- Modify: `apps/crm/src/pages/entregas/components/ScheduleButton.tsx` (render panel when platform targets TikTok, before allowing schedule)
- Test: `apps/crm/src/pages/entregas/components/__tests__/TikTokSettingsPanel.test.tsx`

**Interfaces:**
- Consumes: `getTikTokCreatorInfo`; persists via the same post-update path as C1 into `tiktok_settings`/`tiktok_caption`/`tiktok_title`.
- Produces (all audit-mandated, spec "TikTok settings panel"): creator nickname+avatar header; privacy `Select` built from `privacy_level_options` with **no default selected** (placeholder "Selecione a privacidade"); when `import.meta`-exposed audited flag is absent the UI locks to SELF_ONLY — implement as: if `creator-info` succeeds but schedule validation later 422s on the unaudited rule, the panel shows the test-mode banner; simpler and server-authoritative — banner text "App em modo de teste: publicações TikTok saem como privadas"; comment/duet/stitch checkboxes **unchecked by default**, disabled when creator_info reports them disabled, duet/stitch hidden for `feed`/`carrossel`; music confirmation text with link; `brand_organic_toggle`/`brand_content_toggle` switches (+ "Parceria paga" label preview when brand_content on); `is_aigc` checkbox ("Conteúdo gerado por IA") for video tipos; caption override textarea with UTF-16 rune counter (2200 video / 4000 photo); title input (≤90) for photo tipos only. Schedule button disabled until `privacy_level` chosen.
- [ ] Steps: failing component tests (no-default privacy; unchecked toggles; per-tipo field visibility; rune counter caps) → implement → PASS → commit `feat(tiktok): compliant TikTok settings panel`.

### Task C3: ScheduleButton platform-awareness

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/ScheduleButton.tsx`
- Modify: `apps/crm/src/pages/entregas/postLabels.ts:42-47` (extend `publicando` derivation: for platform tiktok/both, also treat `tiktok_publish_status IN ('initiated','processing')` as publicando)
- Test: extend ScheduleButton tests (find existing: `grep -rn "ScheduleButton" apps/crm/src --include=*.test.tsx -l`)

**Interfaces:**
- Routing rules (spec "Frontend"): platform `instagram` → existing instagram service (unchanged); `tiktok` → tiktok service; `both` → schedule/cancel via **tiktok** service (server validates both), publish-now fires `publishInstagramPostNow` then `publishTikTokPostNow` sequentially, retry calls only the failed side(s) — IG failed = status `falha_publicacao` && `publish_error` set && `instagram_media_id` null; TikTok failed = `tiktok_publish_status==='failed'`.
- Per-platform chips on the card when platform is targeted: ✓ published / ⏳ pending / ✗ failed per platform, from `instagram_media_id` / `tiktok_publish_status`.
- [ ] Steps: failing tests for routing matrix + chips → implement → `npm run test && npm run build` → commit `feat(tiktok): platform-aware ScheduleButton with per-platform status`.

### Task C4: `tiktok-sync-cron`

**Files:**
- Create: `supabase/functions/tiktok-sync-cron/index.ts`, `supabase/migrations/20260720000001_tiktok_sync_cron_schedule.sql`
- Modify: `supabase/config.toml`
- Test: `supabase/functions/__tests__/tiktok-sync-cron_test.ts`
- Clone source: `supabase/functions/instagram-sync-cron/index.ts` (+ its `snapshot.ts` pattern)

**Interfaces:**
- Produces: daily (cron `30 6 * * *`): accounts `active` + `auto_sync_enabled` + `last_synced_at` >6 h + workspace `feature_auto_sync_cron`; per account (pool `SYNC_CONCURRENCY` default 5): fresh token → profile stats update → `video.list` first 2 pages + `video.query` (20/batch) for stored posts' metric refresh → thumbnail cache misses → upserts → `tiktok_account_metrics_daily` snapshot + `tiktok_follower_history` row (skip if a `manual` row exists for today) → purge `tiktok_webhook_events` older than 30 days.
- [ ] Steps: failing tests (snapshot written once per day; manual follower row not overwritten; purge deletes only processed rows >30 d) → implement → PASS → migration + config.toml → commit `feat(tiktok): daily sync cron with snapshots and webhook purge`.

### Task C5: Hub platform badge

**Files:**
- Modify: the Hub approval card component (`apps/hub/src/components/` — locate via `grep -rln "aprova" apps/hub/src/components/` and pick the post approval card), plus `apps/hub/src/types.ts` (add `platform?: 'instagram'|'tiktok'|'both'` to the Hub post type) and the edge function that serves Hub posts (grep `hub-` functions for the workflow_posts select list; add `platform`).
- Test: Hub RTL tests beside the modified component.

**Interfaces:**
- Produces: a small badge on approval cards — Instagram icon, TikTok label chip, or both. Purely visual; no behavior change.
- [ ] Steps: failing RTL test (badge per platform value; absent for undefined) → wire `platform` through the hub function select + types + component → PASS (`npm run test`) → commit `feat(tiktok): hub platform badge`. Open PR 3.

---

## Phase D — Deploy, secrets, rollout (no product code)

### Task D1: Secrets + deploy + crons live

- [ ] Write scratch env file (never literal CLI args): `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI=https://skjzpekeqefvlojenfsw.supabase.co/functions/v1/tiktok-integration` (prod), `TIKTOK_APP_AUDITED` **unset**. `npx supabase secrets set --env-file <file>` (verify linked ref first!), then delete the file.
- [ ] Deploy all six functions with `--use-api` (+ `--no-verify-jwt` per config.toml). `tiktok-publish` deploys WITHOUT `--no-verify-jwt`.
- [ ] Push Phase A–C migrations to prod (SQL-editor single-migration workaround on staging if db push still aborts there).
- [ ] Verify pg_cron rows exist (`select jobname, schedule from cron.job where jobname like 'tiktok%'`) and that the first `tiktok-refresh-cron` run logs cleanly (no Resend alert).

### Task D2: TikTok developer portal (owner tasks — Eduardo)

- [ ] Register `TIKTOK_REDIRECT_URI` in the app's Login Kit config (https, exact match).
- [ ] Add Content Posting API + Webhooks products; set webhook callback to `https://skjzpekeqefvlojenfsw.supabase.co/functions/v1/tiktok-webhook`.
- [ ] Verify the R2 public/custom domain as a URL property (DNS or prefix verification) — required for `PULL_FROM_URL`. Confirm which host `signGetUrl` URLs actually use before verifying.
- [ ] Confirm ToS + privacy-policy URLs on the app.

### Task D3: Dark-launch + live verification (DK TESTE)

- [ ] Enable `feature_tiktok` for DK TESTE via the same workspace-override mechanism used for `feature_estudio` (grep how that override row was inserted; mirror it).
- [ ] Connect a private TikTok test account on a DK TESTE client. Verify: import populates posts+thumbnails; summary/chart render; sync updates metrics.
- [ ] Schedule a `tiktok` video post (SELF_ONLY) → lands via cron; webhook events row appears + processed; `tiktok_post_url` set when public id arrives (private posts may not fire publicly_available — polling still completes the card).
- [ ] Schedule a `both` post (images ≤10) → IG publishes, TikTok publishes, card flips `postado` only after both; force a TikTok failure (e.g. bad media) → card `falha_publicacao`, IG state intact, TikTok-only retry works.
- [ ] Publish-now on `both` → no premature `postado` (the B1 race test, live).
- [ ] Record the audit demo video of the compliant flow; submit Content Posting audit. After approval: set `TIKTOK_APP_AUDITED=true` (secrets) — no deploy needed… **actually a redeploy IS needed** for env changes to take effect on already-deployed functions: redeploy `tiktok-publish` + `tiktok-publish-cron` after flipping.
- [ ] Update CLAUDE.md env-var section with the four `TIKTOK_*` vars; update memory file.

---

## Self-review notes (already applied)

- Spec coverage checked section-by-section: data model→A1/B1; entitlements→A2; `_shared/tiktok.ts`→A3/A4; integration fn→A5; refresh cron→A6; publish fn→B4; publish cron→B5; webhook→B6; IG call sites + claim guards→B1/B2; validation matrix incl. unaudited gate→B3; settings panel→C2; ScheduleButton/both routing→C3; sync cron + snapshots + purge→C4; Hub badge→C5; rollout/audit/portal→D. Stories exclusion enforced in B3 + C1. Wire constants→A3 (with spell-lock test).
- The `publicando` label extension (spec "Status semantics") is in C3.
- Type consistency: `tiktok_publish_status` values (`initiated|processing|published|failed`, NULL=untargeted/pending) used identically in B1 SQL, B3 `mapStatusFetch`, B5 cron, C3 chips.
- Deliberate non-goals restated: no Business API, no Hub feed, no reports/demographics/best-times, no `max_tiktok_accounts`, no draft-to-inbox UI.
