# TikTok Integration — Design

**Date:** 2026-07-17
**Status:** Approved by Eduardo (sections reviewed in brainstorming session)
**Branch:** `claude/tiktok-mesaas-integration-002a8d`

## Goal

Connect TikTok to Mesaas with feature parity to the existing Instagram integration wherever the TikTok API allows: OAuth account connection per client, publishing (video + photo carousel), scheduling, importing existing posts, account analytics, and per-post metrics. Mirror the Instagram architecture (Approach A: parallel vertical), leaving the live Instagram pipeline untouched.

## Verified TikTok API facts that shape this design (July 2026)

- **OAuth (Login Kit v2):** authorize at `https://www.tiktok.com/v2/auth/authorize/`, token at `https://open.tiktokapis.com/v2/oauth/token/`. Access token lives **24 h**; refresh token lives **365 days and rotates** — the response may contain a new refresh token that must be persisted immediately. Web apps use `client_secret` (no PKCE). Redirect URIs: absolute https, exact match, no query params, max 10 per app.
- **Content Posting API:** direct post for video (`/v2/post/publish/video/init/`) and photos (`/v2/post/publish/content/init/`, up to 35 images, `PULL_FROM_URL` only). Video via `PULL_FROM_URL` (source domain must be **verified in the TikTok developer portal**) or chunked `FILE_UPLOAD`. Mandatory pre-post `creator_info/query` call, and the posting UI must render its results (privacy dropdown with **no default**, interaction toggles **unchecked by default**, music confirmation, commercial-content toggles). Status via `/v2/post/publish/status/fetch/` polling and webhooks.
- **No native scheduling.** We self-schedule via cron, same as Instagram.
- **Unaudited app restrictions:** until the Content Posting audit passes, all posts are forced `SELF_ONLY` (private), the account must be private at post time, and max 5 distinct users may post per 24 h. Our app exists but is **unaudited** — we build and live-test in this mode.
- **Display API:** `POST /v2/video/list/` returns **all public videos** (not only app-created), max 20/page, cursor pagination. `POST /v2/video/query/` refreshes up to 20 videos/call. Per-video metrics: `view_count`, `like_count`, `comment_count`, `share_count` only. `cover_image_url` expires in **6 h** → must re-host thumbnails (same fix as IG PR #200). Photo-post import via Display API is undocumented — treat as videos-only until proven otherwise.
- **Account stats** (`user.info.stats`): `follower_count`, `following_count`, `likes_count`, `video_count` — current values only, no history → we snapshot daily ourselves (same as IG).
- **Richer analytics** (saves/favorites, reach, watch time, retention, demographics, daily gained/lost followers with 60-day lookback) live in the **TikTok Business Accounts API** — separate OAuth, separate app application (mandatory access form since 2026-03-20). **Phased in as a later slice**; this design only reserves room for it.
- **Rate limits:** posting init 6/min per user token; status fetch 30/min; creator_info 20/min; Display API 600 req/min per endpoint per client.
- **Webhooks (Developers platform):** `post.publish.complete`, `post.publish.failed`, `post.publish.publicly_available` (carries the public post id), `post.publish.no_longer_publicly_available`, `authorization.removed`. At-least-once delivery with 72 h retries → handlers must be idempotent.
- **TikTok Stories are not in the API.** Out of scope permanently (until TikTok ships it).

## Decisions

1. **Analytics depth:** both API surfaces, phased. Slice(s) in this initiative use the Developers platform only (connect, post, schedule, import, views/likes/comments/shares, self-snapshotted follower history). Business Accounts API analytics is a later initiative; the data model anticipates it (columns added by future migration, no redesign).
2. **Post model:** `workflow_posts.platform` enum `instagram | tiktok | both`. One card, one approval flow, one `scheduled_at`; per-platform publish state and captions.
3. **Architecture:** Approach A — parallel mirror. New `tiktok_*` tables and `tiktok-*` edge functions cloned from the Instagram shape; shared helpers extracted only where free (token crypto parametrization, thumbnail cache, cron auth). Instagram pipeline untouched except: (a) the new default-valued `platform` column, (b) its publish-complete call site goes through the new `mark_platform_published` RPC (identical behavior for instagram-only posts).

## Data model

### New tables (all RLS conta-scoped via `clientes.conta_id`, mirroring `20260310_instagram_rls.sql`)

**`tiktok_accounts`**
- `id uuid PK default gen_random_uuid()`
- `client_id bigint NOT NULL UNIQUE REFERENCES clientes(id) ON DELETE CASCADE` (1:1, same as IG)
- `tiktok_open_id text NOT NULL` — Login Kit `open_id`
- `username text`, `display_name text`, `avatar_url text` (re-hosted to `avatars` bucket like IG), `profile_deep_link text`
- `follower_count int`, `following_count int`, `likes_count bigint`, `video_count int`
- `encrypted_access_token text`, `encrypted_refresh_token text` — AES-256-GCM, HKDF-derived keys with `info='tiktok-access-token'` / `'tiktok-refresh-token'` from `TOKEN_ENCRYPTION_KEY` (no legacy fallback scheme — new integration, single scheme)
- `access_token_expires_at timestamptz`, `refresh_token_expires_at timestamptz`
- `scopes text[]` — granted scopes from the token response
- `authorization_status text NOT NULL DEFAULT 'active' CHECK (IN ('active','revoked','disconnected','expired'))`
- `auto_sync_enabled boolean NOT NULL DEFAULT true`
- `last_synced_at timestamptz`, `created_at timestamptz DEFAULT now()`

**`tiktok_posts`** (imported/synced videos)
- `id uuid PK`, `tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE`
- `tiktok_video_id text NOT NULL UNIQUE`
- `title text`, `video_description text`, `duration int`, `height int`, `width int`
- `share_url text`, `embed_link text`
- `cover_image_url text` — re-hosted into public Supabase Storage bucket **`tiktok-posts`** at `{accountId}/{videoId}.jpg` (TikTok CDN TTL is 6 h)
- `posted_at timestamptz` (from `create_time`)
- `views bigint`, `likes int`, `comments int`, `shares int`
- `synced_at timestamptz`, `created_at timestamptz DEFAULT now()`
- Business-API metrics (favorites/saves, reach, watch time, retention) are **added by a future migration** in the analytics slice — not created now.

**`tiktok_follower_history`**
- `tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE`
- `date date NOT NULL` — proper `date` type (deliberate fix of the IG table's TEXT-date gotcha)
- `follower_count int NOT NULL`
- `source text NOT NULL DEFAULT 'api' CHECK (IN ('api','manual'))` — manual rows protected from API overwrite, same as IG
- `UNIQUE (tiktok_account_id, date)`

**`tiktok_account_metrics_daily`**
- `tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE`
- `snapshot_date date NOT NULL`
- `follower_count int`, `following_count int`, `likes_count bigint`, `video_count int`
- `UNIQUE (tiktok_account_id, snapshot_date)`

### Changed tables

**`oauth_states`** — add `provider text NOT NULL DEFAULT 'instagram' CHECK (IN ('instagram','tiktok'))`. Nonce consume query gains `AND provider = 'tiktok'` on the TikTok path.

**`workflow_posts`** — add:
- `platform text NOT NULL DEFAULT 'instagram' CHECK (platform IN ('instagram','tiktok','both'))`
- `tiktok_publish_id text` — publish handle returned by init
- `tiktok_post_id text` — public post id (arrives via `post.publish.publicly_available` webhook or status fetch)
- `tiktok_post_url text` — `https://www.tiktok.com/@{username}/video/{post_id}` (or photo equivalent), set when the public id arrives
- `tiktok_publish_status text CHECK (IN ('initiated','processing','published','failed'))` — **NULL means "targeted but not started"** (no arming step needed)
- `tiktok_publish_error text` (≤500 chars), `tiktok_publish_retry_count smallint NOT NULL DEFAULT 0`
- `tiktok_publish_processing_at timestamptz` — TikTok cron lock, independent from `publish_processing_at` (IG's), stale-reclaim after 10 min
- `tiktok_caption text` — TikTok caption override; when NULL the publisher falls back to `ig_caption`. TikTok limit 2200 UTF-16 runes (video title) / 4000 (photo description) enforced at validation
- `tiktok_settings jsonb` — `{ privacy_level, disable_comment, disable_duet, disable_stitch, brand_organic_toggle, brand_content_toggle, auto_add_music, photo_cover_index }`. Required before scheduling any TikTok-targeted post; populated by the creator-info UI panel.

### New/changed RPCs

**`claim_posts_for_tiktok_publishing(p_phase, p_limit)`** — clone of the IG claim RPC: `FOR UPDATE SKIP LOCKED` on due posts where `status='agendado'`, `platform IN ('tiktok','both')`, joined to `tiktok_accounts` with `authorization_status='active'`, phase-filtered on `tiktok_publish_status` (`NULL` → init phase; `initiated|processing` → status phase; `failed` with `tiktok_publish_retry_count < 3` → retry phase). Sets `tiktok_publish_processing_at`. Returns decrypted-token inputs (`encrypted_access_token`, `encrypted_refresh_token`, expiries, `tiktok_open_id`).

**`mark_platform_published(p_post_id, p_platform)`** — atomic: records the platform completion (for TikTok sets `tiktok_publish_status='published'`; for Instagram this is called where the IG cron/publish-now currently flips status) and transitions the card to `postado` via the existing `record_post_status_change` **only when all targeted platforms are complete** (IG complete = `instagram_media_id IS NOT NULL`; TikTok complete = `tiktok_publish_status='published'`; `platform` decides which are required). For `platform='instagram'` posts the behavior is exactly today's.

### Status semantics (`both` posts)

- Approval flow unchanged (`rascunho → … → aprovado_cliente`). Scheduling flips to `agendado` once, with one `scheduled_at` for both platforms.
- Each platform's cron drives its own columns independently. Publishing on one platform never blocks the other.
- `postado` only when all targeted platforms complete (via `mark_platform_published`).
- Permanent failure (retries exhausted) on any targeted platform → `falha_publicacao`, keeping the other platform's success state intact. Retry action re-runs **only** the failed platform(s): if IG failed, `instagram-publish/retry`; if TikTok failed, `tiktok-publish/retry`. UI shows per-platform chips (e.g. "IG ✓ · TikTok ✗").
- `publicando` remains presentational (derived in `postLabels.ts`), extended to consider TikTok state.
- Hub auto-publish-on-approval (`hub-approve`) needs **no change**: it transitions to `agendado`, and NULL `tiktok_publish_status` + targeted platform means the TikTok cron picks it up.

### Post-type mapping & validation

`tipo` is unchanged. Platform-aware validation in `_shared/tiktok-publish-utils.ts::validateForTikTokScheduling`:

| tipo | TikTok mapping | Constraints (TikTok) | Constraints (`both`) |
| --- | --- | --- | --- |
| `reels` | Video direct post | MP4/WebM/MOV, ≤4 GB, ≤ creator's `max_video_post_duration_sec`, 360–4096 px | intersection of IG reel + TikTok video rules |
| `feed` single image | Photo post (1 image) | JPEG/WebP, ≤20 MB, ≤1080p | intersection with IG feed rules |
| `carrossel` | Photo post | images only, ≤20 (app attachment limit; TikTok max is 35) | **images only, ≤10** (IG cap; no video items) |
| `stories` | — | platform selector disables TikTok | n/a |

Additional gates: `tiktok_settings.privacy_level` must be set (from creator_info options); caption length per mode; account `active` + tokens decryptable; Estúdio design readiness reused (`checkDesignReadiness`).

## Edge functions

All new functions follow existing conventions: `buildCorsHeaders(req)`, generic client-facing errors with internal logging, `insertAuditLog`, `reportCronFailure` for crons, `timingSafeEqual` cron auth.

`config.toml`: `tiktok-integration`, `tiktok-webhook`, `tiktok-publish-cron`, `tiktok-refresh-cron`, `tiktok-sync-cron` get `verify_jwt = false`. **`tiktok-publish` is deliberately NOT listed** (gateway JWT), mirroring `instagram-publish`.

### `tiktok-integration` (manual JWT except public callback)
Same route contract as `instagram-integration`:
- `GET /auth/:clientId` — ownership (`verifyClientOwnership` pattern) + `feature_tiktok` entitlement → signed state (HMAC, `oauth_states` nonce with `provider='tiktok'`) → authorize URL with scopes `user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish`.
- `GET /callback` — verify state + consume nonce → code exchange → fetch `user.info` (profile + stats) → encrypt & store both tokens → upsert `tiktok_accounts` (onConflict `client_id`) → audit `tiktok-link` → initial import (video.list, first pages) + thumbnail caching + follower snapshot → `302` to `${OAUTH_REDIRECT_BASE}/clientes/{clientId}` (`?tt_error=1` on failure).
- `POST /sync/:clientId` — rate-limited (5/300 s), token freshness via shared helper, then profile stats + video list + `video.query` metric refresh, bulk upsert, snapshot.
- `POST /refresh/:clientId` — manual token refresh.
- `POST|DELETE /disconnect/:clientId` — call `/v2/oauth/revoke/`, delete `tiktok_posts` rows, blank tokens, `authorization_status='disconnected'` (keep the row, IG pattern).
- `GET /summary/:clientId` — account + last-30 follower history.
- `GET /posts/:clientId?page=` — paginated 10/page.

### `_shared/tiktok.ts` (new shared helper)
- `getFreshTikTokToken(svc, accountId)` — **the only code path that touches TikTok tokens.** `SELECT … FOR UPDATE` on the account row → if access token expires <30 min, refresh → **persist rotated refresh token before returning** → return decrypted access token. Refresh failure with invalid refresh token → `authorization_status='expired'`, throw typed `TOKEN_EXPIRED`. Serializing per account prevents rotation races between crons/functions.
- `encryptTikTokToken` / `decryptTikTokToken` (HKDF, per-token-type info strings).
- TikTok API fetch wrapper mapping error codes (`access_token_invalid` → one refresh+retry; `scope_not_authorized` → `revoked`; rate-limit 429 → retryable).

### `tiktok-publish` (gateway JWT)
Routes `/{action}/{id}`:
- `GET /creator-info/:clientId` — proxies `POST /v2/post/publish/creator_info/query/`; the scheduling UI renders its result (privacy options, interaction toggles availability, max video duration, nickname/avatar). Called fresh each time the panel opens (audit requirement), never cached server-side.
- `POST /schedule/:postId` — for `platform IN ('tiktok','both')`. Validates TikTok rules and, for `both`, also runs the existing IG `validateForScheduling` (imported from `_shared/instagram-publish-utils.ts` — same runtime, no HTTP hop). Requires `tiktok_settings` present. Transitions to `agendado` via `record_post_status_change`. (Instagram-only posts keep using `instagram-publish/schedule`, unchanged.)
- `POST /publish-now/:postId` — synchronous: init → poll status fetch (bounded ~60 s) → `mark_platform_published`. For `both`, the frontend calls IG publish-now and TikTok publish-now; card flips when both report.
- `POST /cancel/:postId` — clears TikTok publish state; for `both` also clears the IG container (shared util) and reverts status (existing cancel semantics).
- `POST /retry/:postId` — resets `tiktok_publish_status='failed'→NULL`, clears error, cron re-picks. Only touches the TikTok side.

### `tiktok-publish-cron` (`x-cron-secret`, every minute, pg_cron + Vault)
Phases via `claim_posts_for_tiktok_publishing`:
1. **Init** (limit 25): build post payload from `tiktok_settings` + caption fallback + media as R2 presigned GET URLs (`signGetUrl`, 7200 s) with `source_info.source='PULL_FROM_URL'`. Video → video/init; feed/carrossel → content/init with `post_mode='DIRECT_POST'`, `media_type='PHOTO'`. Store `tiktok_publish_id`, set `tiktok_publish_status='initiated'`. Respect 6 init/min per user token (per-account batch ≤5/run).
2. **Status** (limit 25): `POST /v2/post/publish/status/fetch/` for `initiated|processing` posts → `PROCESSING_*` keeps `processing`; `PUBLISH_COMPLETE` → `mark_platform_published` (+ store public post id if present); `FAILED` → `markTikTokFailed` (below).
3. **Retry** (limit 10): failed with retry_count <3 → back to init.

`markTikTokFailed`: sets `tiktok_publish_status='failed'`, `tiktok_publish_error`, `retry_count++`; on `TOKEN_EXPIRED` flips account to `expired`; non-retryable reasons (`spam_risk_too_many_posts`, `unaudited_client_can_only_post_to_private_accounts`) skip retries and surface a clear message. Card → `falha_publicacao` per the status semantics.

### `tiktok-webhook` (public)
Registered in the TikTok developer portal. Handler: 200 immediately, then process. Events are **hints** — before mutating, re-confirm via status fetch (idempotent; at-least-once delivery). `post.publish.publicly_available` → store `tiktok_post_id` + `tiktok_post_url`. `post.publish.failed/complete` → same handlers as the cron status phase. `authorization.removed` → account `revoked` + audit log. Payload validation: match `client_key` against `TIKTOK_CLIENT_KEY` and resolve `user_openid` to a known account; unknown → 200 and drop (never error to the caller).

### `tiktok-refresh-cron` (`x-cron-secret`, every 6 h)
Selects `active` accounts with `access_token_expires_at <= now() + 12 h` and runs `getFreshTikTokToken` per account. Note: refreshing rotates the refresh-token **value** but does not extend its expiry — the 365-day clock runs from the initial OAuth grant. So the cron additionally checks `refresh_token_expires_at <= now() + 30 days` and, when true, no status change occurs but the connect UI and ScheduleButton surface a "reconecte a conta TikTok" warning (computed from `refresh_token_expires_at`); only a fresh OAuth re-connect renews it. Re-caches avatar.

### `tiktok-sync-cron` (`x-cron-secret`, daily 06:30, offset from IG's 06:00)
Clone of `instagram-sync-cron`: `active` + `auto_sync_enabled` + last sync >6 h + `feature_auto_sync_cron` workspace gate; concurrency pool (`SYNC_CONCURRENCY`); per account: fresh token → profile stats → `video.list` recent pages + `video.query` metric refresh for stored posts (20/batch) → thumbnail cache → upserts → daily snapshot row + follower history row.

### pg_cron schedules (new migration, Vault pattern)
- `tiktok-publish-cron` `* * * * *`
- `tiktok-refresh-cron` `15 */6 * * *`
- `tiktok-sync-cron` `30 6 * * *`

## Import

Same code path as sync (callback initial import + manual sync + daily cron). Display API returns all **public** videos; imports are upserted on `tiktok_video_id`. Cover images re-hosted to the `tiktok-posts` public bucket on first sight (immutable thereafter, IG pattern). Photo posts may not appear in `video.list` (undocumented) — accepted limitation, noted in UI copy if needed.

## Analytics (this initiative = phase 1)

- Per-post: views/likes/comments/shares in `tiktok_posts`, refreshed by sync.
- Account: current stats on `tiktok_accounts`; history built from `tiktok_follower_history` + `tiktok_account_metrics_daily` snapshots (charts get richer the longer the account is connected — same as IG's early days).
- Surfaces: `TikTokSection` on the client detail page (OverviewCard, FollowerChart, PostsTable, ConnectButton) mirroring `InstagramSection`. Frontend reads directly from Supabase (RLS) like `services/analytics.ts` does for IG.
- **Not in this initiative:** TikTok in `AnalyticsPage`/portfolio analytics, demographics, best-times, AI analysis, PDF reports, `hub-tiktok-feed`. These follow in the Business-API analytics initiative, which also adds the richer per-post metric columns.

## Frontend (CRM)

- **`services/tiktok.ts`** — mirror of `instagram.ts`: `getTikTokAuthUrl`, `disconnectTikTok`, `refreshTikTokToken`, `syncTikTokData`, `getTikTokSummary`, `getTikTokPosts`, `getTikTokCreatorInfo`, `scheduleTikTokPost`, `cancelTikTokSchedule`, `publishTikTokPostNow`, `retryTikTokPublish`. 5-min in-memory cache.
- **`components/tiktok/`** — `TikTokConnectButton`, `TikTokOverviewCard`, `TikTokFollowerChart`, `TikTokPostsTable` (follow the existing imperative widget pattern of `components/instagram/`).
- **Post editor / entregas:**
  - Platform selector (Instagram / TikTok / Ambas) on the post card; TikTok options disabled when `tipo='stories'` or the client has no `active` TikTok account; defaults to `instagram`.
  - `carrossel` + TikTok target: validation messages for video items / >10 images (`both`) / >20 (tiktok-only).
  - **TikTok settings panel** in the scheduling flow (rendered from `creator-info`): creator nickname+avatar, privacy dropdown (no preselection), comment/duet/stitch checkboxes (unchecked by default, disabled per creator settings), music-usage confirmation text, commercial-content toggles with the "Paid partnership" label behavior, `tiktok_caption` override field with live rune counter. Stored into `tiktok_settings`/`tiktok_caption` before schedule is allowed.
  - `ScheduleButton` becomes platform-aware: routes to the right function(s) per `platform`; shows per-platform status chips; retry targets only the failed platform; publish-now for `both` fires both endpoints.
- **Hub:** approval cards show a platform badge (IG/TikTok/both). Nothing else.

## Security

- Tokens AES-256-GCM with HKDF from `TOKEN_ENCRYPTION_KEY` (required, no fallback); refresh-token rotation persisted before use; all token access via `_shared/tiktok.ts` (no copy-paste crypto).
- OAuth state HMAC-signed + single-use nonce (existing `oauth_states` + `provider`).
- CORS via `buildCorsHeaders(req)`; generic client errors; internal logging only.
- Crons verify `x-cron-secret` (`timingSafeEqual`); webhook validates `client_key` + known `user_openid`, treats payloads as untrusted hints re-confirmed via API.
- Workspace ownership (`conta_id`) verified on every client-scoped route; RLS on all new tables.
- R2 presigned URLs (2 h TTL) as the only media transfer path; TikTok portal URL-prefix/domain verification for the R2 host is a rollout prerequisite.

## Entitlements & rollout

- New plan flag **`feature_tiktok`** in `_shared/entitlements.ts` (single source) + SQL `effective_plan_*` + admin panel row. **Ships dark:** `false` on all plans; DK TESTE workspace override for live testing (Estúdio playbook).
- Env vars (edge functions): `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` (registered in the portal, points at `…/functions/v1/tiktok-integration`). Documented in CLAUDE.md env section.
- **Unaudited mode is the live-test mode:** posts land as SELF_ONLY on a private test account; pipeline verifiable end-to-end. Public posting requires passing TikTok's Content Posting audit — no code change to flip.
- **Portal prerequisites (owner tasks, tracked in the plan):** register redirect URI; verify the R2/media host as a URL property (required for `PULL_FROM_URL`); ensure ToS + privacy-policy URLs on the app; enable Webhooks product + callback URL; record demo video and submit the Content Posting audit once the UI is live on DK TESTE.
- Deploys use `--use-api` (local Docker bundler broken) and `--no-verify-jwt` semantics per config.toml conventions.

## Error handling summary

| Failure | Behavior |
| --- | --- |
| Access token expired mid-call | one refresh via `getFreshTikTokToken` + retry; then fail |
| Refresh token invalid/expired | account `expired`, surfaced in connect UI + ScheduleButton warning (IG pattern) |
| `authorization.removed` webhook | account `revoked`, audit log |
| `video_pull_failed` | retryable (≤3), presign regenerated each attempt |
| `spam_risk_too_many_posts` / unaudited-privacy errors | non-retryable, clear PT-BR message in `tiktok_publish_error` |
| Webhook duplicate/out-of-order | idempotent handlers; status fetch is source of truth |
| Cron failure | `reportCronFailure` → Resend alert (existing triage) |
| `both` partial failure | card `falha_publicacao`, succeeded platform state preserved, retry per platform |

## Testing

- **Deno** (`supabase/functions/__tests__` layout): unit tests per function — OAuth state round-trip, token rotation persistence (mocked fetch), claim RPC contract, init payload building per tipo (video/photo/carousel), status-phase transitions, webhook idempotency, validation matrix (tipo × platform incl. `both` intersections), caption fallback.
- **Vitest**: `services/tiktok.ts`, platform selector logic, ScheduleButton platform routing, settings-panel gating (schedule disabled until `tiktok_settings` complete).
- **pgTAP**: `claim_posts_for_tiktok_publishing` phases + `mark_platform_published` aggregate semantics (both/partial cases), RLS on new tables.
- Contract-change sweep per CI gates memory: grep both suites for old shapes; run `npm run format` + lint + `npm run test` + deno tests before pushing.
- **Live verification** on prod DK TESTE: connect a real TikTok test account (private), import feed, schedule a video + a photo carousel + a `both` post, verify SELF_ONLY publishes end-to-end, verify webhook + polling paths, verify partial-failure retry.

## Out of scope (this initiative)

- TikTok Business Accounts API (deep analytics, demographics, follower gained/lost) — next initiative; data model anticipates it.
- TikTok in portfolio analytics, AI analysis, PDF reports, best-times.
- `hub-tiktok-feed` / Hub TikTok grid preview.
- TikTok Stories (no API).
- Draft-to-inbox posting mode (`video.upload`) — scope requested at OAuth for future use, but the UI only implements direct post.
- Comment management, TikTok DMs, Spark Ads.
