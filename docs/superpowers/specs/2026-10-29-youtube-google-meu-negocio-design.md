# YouTube Shorts + Google Meu Negócio — design

Date: 2026-10-29 · Status: approved UI, spec revised after builder check, Fable and Codex reviews
Mockups (approved 2026-10-29): https://claude.ai/artifact/Tc2YpgUoMCKqEKvtBNvKde

## 1. Intent

Agencies already connect each client's Instagram and TikTok to Mesaas to see metrics, publish
and build reports. Two channels are missing and come up with every medical/local-business
client:

- **YouTube Shorts**: metrics *and* publishing, on par with TikTok.
- **Google Meu Negócio** (Google Business Profile, "GMN" below): metrics only. For a clinic, the
  Google profile is often the channel that actually brings patients (calls, directions), and
  agencies today screenshot it by hand for the monthly report.

Success: an agency connects a client's channel and Google profile from the client page, sees
the numbers in Analytics next to Instagram/TikTok, schedules Shorts from the same post editor,
and the monthly report carries YouTube and GMN sections with no manual work.

## 2. Decisions already made

By the user (2026-10-28/29):
1. **GMN: several locations per client.** Location picker after login; analytics and reports
   show each unit and the combined total.
2. **YouTube analytics cover the whole channel**, with a Shorts / long-video split.
3. **GMN reviews: rating + read-only list** of recent reviews ("Abrir no Google" to reply).
4. **YouTube publishing launches with the platform-wide daily upload cap** until Google's
   audit. Overflow queues to the next quota day and the UI says so.
5. The six mockup screens are approved as the UI, amended by §4.6 (YouTube data-policy limits).

Stated defaults the user did not object to:
6. **Two separate connect buttons** ("Conectar YouTube", "Conectar Google Meu Negócio"). A
   client's channel (often a Brand Account) and its Business Profile manager are usually
   different Google identities.
7. **Both platforms get report sections**, built the same way TikTok's were.
8. **The connect flow and the privacy policy ship first**; everything ships dark to prod and is
   switched on for the user's own workspace, which is where the verification video is recorded
   (§10).

## 3. Non-goals / anti-goals

Non-goals (v1): replying to reviews, posting to GMN (updates/offers/photos), GMN Q&A (API shut
down 2025-11), YouTube long-video publishing, captions/subtitles upload (needs the broader
`youtube.force-ssl` scope), custom thumbnails, playlists, YouTube comments, portfolio-level
pages like `/analytics/tiktok` for the two new platforms, Hub analytics tabs, MCP tools,
**AI analysis of YouTube data** and **computed YouTube metrics** until Google approves derived
metrics (§4.6).

Anti-goals (would be a failure even if it "works"):
- A connection that silently dies after 7 days or after the 100th client (§4.2).
- Numbers labelled as something they are not. YouTube data is 2-3 days late and GMN counts
  unique users per day per surface; every KPI says exactly what it is.
- A Short that is published as a regular video without warning.
- Anything that fails Google's YouTube audit (§4.6): computed YouTube metrics, YouTube data
  kept after a disconnect.
- One workspace reading, overwriting or deleting another workspace's data for the same
  channel or location (§6).

## 4. Google connection model and policy

### 4.1 Cloud projects, OAuth client, scopes

- **Two Google Cloud projects**: production (verified, audited, GMN access) and staging
  (stays in Testing, its own OAuth client, its own GMN access request only if staging needs
  real GMN data). Staging must never spend prod's upload quota or count toward prod's
  refresh-token cap. The production project's consent screen is published **In production**
  before any pilot (unverified until review passes: Google shows a warning screen and caps
  new users at 100, but refresh tokens do not expire after 7 days as they do in Testing).
- Scopes per flow:

| Flow | Scopes |
|---|---|
| Conectar YouTube | `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` (+ `openid email`) |
| Conectar Google Meu Negócio | `business.manage` (+ `openid email`) |

- Auth URL: `access_type=offline`, `include_granted_scopes=true`, `prompt=select_account`. The
  callback checks the granted `scope` string; a missing required scope fails with "Marque todas
  as permissões pedidas pelo Google". If the exchange returns **no refresh token** and the
  workspace has no stored refresh token for that Google `sub`, the callback restarts the flow
  once with `prompt=consent` (flag in the signed state so it cannot loop). This keeps Google
  from minting a new refresh token on every reconnect, which would eat the 100-per-account cap.
- Redirect URI, identical byte for byte in the auth request and the code exchange:
  `GOOGLE_REDIRECT_URI` if set, else `${SUPABASE_URL}/functions/v1/google-integration/callback`.
  That exact URI is registered on each project's OAuth client.
- Env (per Supabase project): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (required
  by every function that touches Google user tokens; throw if missing), `GOOGLE_REDIRECT_URI`
  (optional).

### 4.2 Connections are per Google identity per workspace

Google silently invalidates the oldest refresh token once one Google account holds more than
100 for the same OAuth client. Agencies manage every client's Business Profile from one agency
Google account, so a token-per-client design breaks at the 101st client. Therefore:

- `google_connections`: one row per (`conta_id`, Google `sub`). Email, display name, encrypted
  access + refresh tokens (AES-GCM via `_shared/crypto.ts` `encryptText`, purposes
  `google-access-token` / `google-refresh-token`), expiry, granted scopes, status
  (`active | revoked`), `refresh_lock_at`, timestamps. Service-role only; the CRM sees status
  through `google-integration`'s summary route.
- Reconnecting the same identity in the same workspace updates the row in one statement:
  scopes are the union, the access token is replaced, and the **stored refresh token is kept
  unless the exchange returned a new one**.
- `youtube_channels` and `gbp_locations` reference a connection; they never hold tokens.
- `getFreshGoogleToken(svc, connectionId)` is the only token read path (refresh when <5 min
  left, atomic `refresh_lock_at` claim, the `getFreshTikTokToken` pattern). Google refresh
  tokens do not rotate, so no refresh cron; the daily syncs exercise every token.
- `invalid_grant` on refresh → connection `revoked`, every linked product shows "Reconectar"
  (mockup 1), and the §4.6 deletion clock starts.
- Disconnecting a product unlinks it (§4.3/§4.4). The grant is revoked at Google
  (`oauth2.googleapis.com/revoke`) only when **no `google_connections` row in any workspace**
  has that `sub` and still has a linked product: revoking kills the whole grant between that
  Google account and the OAuth client, including other workspaces' connections. Otherwise the
  workspace's connection row is deleted locally.

Tenant resolution in all new functions: `profiles.active_workspace_id` + `workspace_members`
check (the `report-docs` pattern), not the legacy `profiles.conta_id`.

`oauth_states.provider` CHECK (`oauth_states_provider_check`) widens to
`('instagram','tiktok','google')`. Product (`youtube | gbp`), `clientId`, `userId`, `contaId`
and the consent-retry flag live only in the HMAC-signed state (10-min TTL, nonce consumed once,
as in `tiktok-integration/oauth-state.ts`); `oauth_states` gets no new column.

### 4.3 YouTube: one channel per client

`youtube_channels`: `id uuid`, `client_id UNIQUE` (FK `clientes` ON DELETE CASCADE),
`conta_id`, `connection_id`, `channel_id`, title, handle, avatar (cached to storage like
TikTok's), uploads playlist id, cached counts (subscribers as returned, i.e. rounded by
YouTube; views; videos; shorts; long), `authorization_status`, `last_synced_at`,
`data_through` (§6.1). One `channel_id` per client per workspace (reject with "Este canal já
está vinculado ao cliente X").

The channel is what `channels.list?mine=true` returns for the identity that logged in;
Google's account chooser lists Brand Accounts as separate identities. If `mine=true` returns no
channel: "Esta conta Google não tem canal do YouTube". **Spike S4 is a Phase-1 gate**: with an
account that owns two Brand Account channels, confirm the chooser selects the channel. If it
does not, v1 supports only the channel of the chosen identity and the connect card says so;
no channel picker is built.

Unlink = delete the `youtube_channels` row and enqueue the §4.6 purge (YouTube data is not
kept for a re-link; a re-link backfills from the API).

### 4.4 GMN: many locations per client

`gbp_locations`: `id uuid`, `conta_id`, `client_id` (FK, CASCADE), `connection_id`,
`account_name` (the account the location was listed under, used for the v4 reviews API),
`location_name` (`locations/{id}`), title, address line, website, `has_voice_of_merchant`,
cached `average_rating`, `total_review_count`, `status` (`active | disconnected | revoked`),
`disconnected_at`, `last_synced_at`, `data_through`. Unique (`conta_id`, `location_name`):
one location belongs to one client per workspace. RLS: client's workspace; no tokens.

Picker (mockup 2): callback → `/clientes/:id/redes-sociais?gbp_pick=<connectionId>` → the
dialog calls `google-integration` which lists accounts (Account Management API
`accounts.list`), then each account's locations (Business Information API
`accounts/{a}/locations`, `readMask=name,title,storefrontAddress,websiteUri,metadata`, 100 per
page, accounts walked in sequence, de-duplicated by location name keeping the first account
that lists it). **Eligible** = `metadata.hasVoiceOfMerchant = true` (Google's signal that the
profile is verified and manageable); otherwise the row is disabled as "Não verificado". Rows
already linked to another client of the workspace are disabled with that client's name.
"Gerenciar unidades" reopens the dialog and can switch to another of the workspace's Google
connections. Unlink sets `status = 'disconnected'`, `disconnected_at = now()`; re-linking the
same location within 30 days reactivates the row and its history; after 30 days the purge
removes both (§4.6).

GMN access is a separate Google approval per project (0 QPM until approved). Until then the
picker shows "O Google ainda não liberou o acesso ao Google Meu Negócio para o Mesaas" on a
403 with quota 0, not a generic error.

### 4.5 Plans and flags

Two new plan columns, `DEFAULT false`: `feature_youtube`, `feature_google_business`. Added to
`_shared/entitlements.ts` `FEATURE_COLUMNS` (redeploy every importer, CLAUDE.md), Admin plan
form + labels, CRM `useWorkspaceLimits` / `entitlement-errors` / nav feature map. Ship dark;
pilot by workspace override.

Gating, mirroring TikTok: connect and sync = product flag; analytics tabs and read functions =
product flag + `feature_analytics_reports`; YouTube publishing = `feature_youtube` +
`feature_post_scheduling`; daily sync crons = product flag + `feature_auto_sync_cron`; report
sections = flag on and platform connected.

### 4.6 YouTube API policy constraints (audit-critical)

From the YouTube API Services Developer Policies (checked 2026-10-29):
- **No derived metrics** (III.E.4.h): Mesaas must not compute new metrics from YouTube API Data
  or replace API data with its own calculations. Derived metrics need explicit approval,
  requested in the quota-extension/audit form (Additional policies for derived metrics, from
  2026-06-01). Until approved, v1 YouTube surfaces show **only values returned by the API**:
  - KPI totals for a window come from an Analytics API query for that exact window (and
    content type), not from summing stored days; average view duration and average % watched
    are the API's own range values.
  - Comparison shows the previous window's API value ("28 dias anteriores: 148,9 mil"), not a
    computed % change or arrow.
  - The "Shorts x vídeos longos" card shows each type's API value side by side (bars allowed),
    no computed percentage.
  - No AI analysis of YouTube data in the tab or in the report AI (the report AI ignores the
    YouTube section).
  - Mockups 3 and 6 are amended accordingly (§8, §9).
  - Once Google approves derived metrics, percentages, deltas and AI can be added in a later
    change.
- **Storage**: analytics/statistics may be stored beyond 30 days while authorization is
  re-verified at least every 30 days (the daily sync does it). Other API data (video titles,
  descriptions, thumbnails) must be refreshed or deleted within 30 days: the sync refreshes every
  stored video's metadata at least every 30 days in rotating batches (`videos.list`, 50 ids per
  unit) and deletes videos YouTube no longer returns.
- **Deletion**: in-app disconnect is a revocation through the API client → delete within 7
  calendar days; revocation detected via `invalid_grant` (user revoked at Google) → 30 days by
  the policy, Mesaas uses 7 for both. The purge job (daily, in `youtube-sync-cron`) deletes, for
  the disconnected `(conta_id, channel_id)`: every `youtube_*` history row, `youtube_uploads`,
  the `youtube` sub-object of every `report_documents.snapshot` of that client, and any stored
  rendering (PDF) of those reports (regenerated on demand without YouTube). It also deletes the
  connection row when nothing references it. Each purge writes an `insertAuditLog` entry
  (`youtube-data-purged`) for audit evidence.
- **Aggregation**: YouTube data is never combined across channels of different owners (no
  portfolio page in v1) and is shown only inside the client it belongs to.
- **Attribution**: YouTube UI blocks say the data comes from YouTube and link videos to
  YouTube; YouTube logos unaltered.

GMN data is not under these rules; it follows §4.4 (30-day soft-delete purge).

## 5. Data and sync

All history tables are service-role only (`REVOKE ALL … FROM PUBLIC, anon, authenticated`,
explicit `GRANT … TO service_role`), read through dedicated analytics functions. **Every
history table carries `conta_id` as the first column of its primary key**, and every read,
write and purge filters by it, so two workspaces linking the same channel or location never
share rows. No FK to the link tables (GMN history must outlive an unlink for 30 days).

### 5.1 YouTube

Tables (all keyed `(conta_id, channel_id, …)`):
- `youtube_channel_daily` (`day`, `content_type` ∈ `all|shorts|long|live`): views,
  engaged_views, estimated_minutes_watched, likes, comments, shares, subscribers_gained,
  subscribers_lost; for charts only. `all` from the channel report without the dimension; the
  split rows from the same report grouped by `creatorContentType` (spike S2); metrics Google
  does not split are null on split rows.
- `youtube_traffic_daily` (`day`, `source_type`): views; for charts.
- `youtube_demographics` (`window_end`, `age_group`, `gender`, `viewer_pct`): API 28-day
  snapshot refreshed daily; the "Público" card says "últimos 28 dias" whatever the period.
- `youtube_videos` (`video_id`): title, published_at, duration_s, `is_short`, thumbnail url,
  lifetime counts, `metadata_refreshed_at`.
- `youtube_video_daily` (`video_id`, `day`): views, likes, comments, shares,
  subscribers_gained, average_view_duration_s, average_view_percentage from the Analytics API
  (`dimensions=day`, `filters=video==…`; backfillable, so no lifetime snapshots are needed).
- `youtube_range_cache` (`content_type`, `start_day`, `end_day`, `fetched_at`, `payload jsonb`):
  window totals from the Analytics API for the KPI grid and the reports, cached 6 h.

Watermark: `data_through` = the **minimum** of the last day returned by the channel report,
the content-type report and the traffic report in the last sync. Windows end there; the tab
prints "Dados até {{data}}". Analytics API days are Pacific days, stored as returned.

Sync (`youtube-sync-cron`, daily, scheduled right after the quota reset at 00:00 Pacific so
sync runs before uploads draw on the shared Data API quota; manual `POST /sync/:clientId` on
`google-integration`, rate-limited 5 per 300 s per client):
1. `channels.list` → cached counts.
2. Uploads playlist pages (`playlistItems.list`, 50 per page) for new videos; `videos.list`
   (`snippet,contentDetails,statistics`, 50 ids per call) for the 200 most recent, every video
   from the last 90 days, and the rotating batch due for its 30-day refresh.
3. Analytics API: channel daily (all + by content type) and traffic for
   `[data_through - 7 days, yesterday]`; demographics (last 28 days); per-video daily for videos
   published in the last 90 days over the same window.
4. Purge step (§4.6).

Backfill on connect (async): 365 days of channel daily/content-type/traffic, 90 days of
per-video daily, the uploads playlist capped at 1,000 videos.

`is_short` = `creatorContentType = SHORTS` from a per-video report when available, else
`duration_s ≤ 180` (horizontal videos under 3 min are misclassified by the fallback; the "Tipo"
tooltip says so).

Data API quota: sync costs ~5-15 units per channel per day. How `videos.insert` is metered on
the project (own 100-call bucket at 1 unit, or ~100/1,600 units from the shared 10,000) is
**confirmed in Phase 1 from the Cloud Console Quotas page** (task S0) and sets
`YOUTUBE_DAILY_UPLOAD_BUDGET` (§6.4). Sync treats `quotaExceeded` as "skip the Data API steps
today", never as a failure that marks anything revoked.

### 5.2 Google Meu Negócio

Tables (all keyed `(conta_id, location_name, …)`):
- `gbp_metrics_daily` (`day`): `BUSINESS_IMPRESSIONS_DESKTOP_MAPS`, `_DESKTOP_SEARCH`,
  `_MOBILE_MAPS`, `_MOBILE_SEARCH`, `CALL_CLICKS`, `BUSINESS_DIRECTION_REQUESTS`,
  `WEBSITE_CLICKS`, `MESSAGING_CLICKS`, `BUSINESS_BOOKINGS`, `BUSINESS_FOOD_MENU_CLICKS` as
  columns. Not `BUSINESS_CONVERSATIONS` (removed) or `BUSINESS_FOOD_ORDERS` (deprecated).
- `gbp_search_keywords_monthly` (`month`, `keyword`): `value` or `threshold` as given ("menos
  de N" in the UI).
- `gbp_reviews` (`review_id`): reviewer display name, star rating, comment, create/update time,
  `has_reply`. Latest 200 per location; older pruned. Reviewer names are personal data, covered
  by the privacy policy update.
- `gbp_rating_daily` (`day`): average_rating, total_review_count (from the reviews response).

Watermark: `data_through` = the latest date present for any metric in the response minus 2
days (Google back-fills recent days). Days up to `data_through` that the API omits are stored as
0 (the API leaves zero days out); days after it are never written. Each sync rewrites
`[data_through - 7 days, yesterday]`.

Sync (`gbp-sync-cron`, daily; manual sync same rate limit):
1. Performance API `fetchMultiDailyMetricsTimeSeries`, all metrics, the rewrite window.
2. Search keywords for the last 2 closed months.
3. Reviews via `mybusiness.googleapis.com/v4/{account_name}/{location_name}/reviews`,
   newest first, until a known `review_id` with unchanged `updateTime`, or 200 rows.
4. Location refresh (title, `hasVoiceOfMerchant`).
5. Purge: rows of locations `disconnected`/`revoked` for more than 30 days.

Backfill on link (async): 18 months of daily metrics (spike S3 confirms the API's range) and of
keywords.

Quota: 300 QPM per API per project. Locations go through a worker pool (`runPool` from
`instagram-sync-cron/pool.ts`, moved to `_shared` if reused) sized to stay under ~200 QPM,
retrying 429 with backoff.

### 5.3 I/O discipline

Every Google, R2 and Storage call in these functions has an `AbortSignal.timeout` (the
repository's edge-kill lesson: a killed isolate skips `catch`), and every state change is
persisted before the next network call, so a killed invocation resumes cleanly on the next run.

## 6. YouTube publishing

### 6.1 Platform registry and targets

- `PLATFORM_IDS` gains `youtube`; `PLATFORM_DEFS.youtube` = `autoPublish: true`,
  `planFeature: 'feature_youtube'` (type widens), `titleMax: 100`,
  `nativeFormats: { reels: { label: 'Short', captionMax: 5000 } }` (YouTube counts bytes;
  validate bytes server-side). Remove YouTube from `COMING_SOON_PLATFORMS`.
- CHECK widening (Phase 3, not earlier, so no target exists without a publisher):
  `workflows_plataformas_valid`, `workflow_templates_plataformas_valid`,
  `clientes_plataformas_padrao_valid`, `post_targets_platform_check`.
  `workflow_posts.platform` stays derived from instagram/tiktok only (instagram+youtube →
  `instagram`, youtube-only → `other`).
- **Only `reels` posts get a YouTube target.** `post_targets_seed` skips youtube when
  `tipo <> 'reels'`, and a z7-style trigger deletes a non-published youtube target when the post's
  `tipo` changes away from `reels` (the seed currently inserts every board platform without a
  `tipo` check).
- **Persistence contract.** YouTube text lives only in `post_targets`: `title`, `caption`
  (description), `settings` jsonb `{ privacy, made_for_kids, synthetic_media, tags }`.
  `store/postTargets.ts` gains a `youtube` branch in seeding and `savePostCaption` (today any
  non-instagram/non-geral platform falls into the `tiktok_caption` path), target queries select
  `title` and `settings`, and `DestinationCaptionTabs` gets a YouTube tab whose description seeds
  from the Instagram caption until edited (mockup 5). `made_for_kids` has no default.

### 6.2 Validation

A YouTube target requires one video, duration ≤ 180 s and height ≥ width (from
`files.duration_seconds/width/height`; missing metadata is allowed with a warning), file ≤ the
server post-media limit (400 MiB), title 1-100 characters without `<` `>`, description ≤ 5,000
bytes, tags ≤ 500 characters, `made_for_kids` answered. Shared rules in
`_shared/youtube-publish-utils.ts` (`validateForYouTubeScheduling`), mirrored in
`apps/crm/src/pages/entregas/youtubeComposerRules.ts`. They run in the editor, in
`youtube-publish schedule`, and **again in the cron `init`** (failure → `mark_target_failed`
with the pt-BR reason), because a post can be scheduled through the Instagram side.

### 6.3 Publish-state writers

The writers in `20261014000002` (`begin_target_publish`, `mark_target_published`,
`mark_target_failed`, `requeue_target`, `cancel_target_publish`) raise `unsupported_platform`
for anything but tiktok, and `recompute_post_publish_status` only combines Instagram (legacy
columns) and TikTok. A Phase 3 migration recreates them platform-generic: they accept any
platform whose registry entry has `autoPublish` (instagram's legacy path untouched, `geral`
ignored), and the recompute combines Instagram + every autoPublish target with the existing
rule: the post is `postado` when all its targets are published, `falha_publicacao` if any failed
for good, otherwise it stays `agendado`/`publicando`. A YouTube-only post follows the same rule
as a TikTok-only post. An Instagram + YouTube post whose YouTube side waits in the daily queue
stays `agendado` until YouTube publishes; the per-destination panel shows Instagram published and
YouTube "Na fila" (my call: consistency with TikTok over a special case). The `z9` reset trigger
resets YouTube targets as it does TikTok's.

### 6.4 Upload engine

YouTube has no pull-from-URL, so Mesaas streams the file from R2. `youtube-publish-cron`
(every minute), phases via `claim_youtube_targets_for_publishing(phase, limit)` (same locking
rules as the TikTok claim: own autocommit transaction, `FOR UPDATE OF wp, t SKIP LOCKED`),
reading title/caption/settings from `post_targets` and filtering `wp.tipo = 'reels'`:

| Phase | Selects | Lease |
|---|---|---|
| `init` | due targets (`scheduled_at <= now()`, TikTok's status rules) | 10 min |
| `upload` | `processando`, `youtube_uploads` row present, `video_id` null | 2 min |
| `status` | `processando` with `publish_ref` (video id) | 10 min |
| `retry` | `falha`, `retry_count < 3`, post in `agendado/falha_publicacao` | 10 min |
| `orphan` | due targets whose client has no `active` YouTube channel | n/a |

Every exit path clears `processing_at`.

- **orphan**: `mark_target_failed` with `error_code = 'youtube_not_connected'` ("Conecte o
  YouTube deste cliente para publicar"). After reconnecting, "Tentar novamente" publishes to the
  client's current channel; the retry confirmation names that channel.
- **init**: re-run validation; reserve budget (§6.5); none left → keep `agendado`, set
  `error_code = 'youtube_daily_limit'` (UI "Na fila"), clear the lease. Else create the
  resumable session (`POST …/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`;
  snippet = title/description/tags/`categoryId 22`; status = privacy/`selfDeclaredMadeForKids`/
  `containsSyntheticMedia`), insert `youtube_uploads` (service-role only: `conta_id`,
  `target_id`, `session_uri`, `total_bytes`, `bytes_sent`, `budget_day`, `started_at`,
  `video_id`), clear `error_code`, set the target `processando` with a **direct update like
  `tiktok-publish-cron` does** (`begin_target_publish` stamps `scheduled_at = now()` and is only
  for publish-now).
- **upload**: probe the session (`PUT`, `Content-Range: bytes */total` → 308 + `Range`), then
  stream R2 ranges in 8 MiB chunks (multiple of 256 KiB) for up to ~60 s, persisting
  `bytes_sent` after each chunk. The final 200/201 gives the video id → `video_id`, `publish_ref`.
  Session 404 → new session without a new budget reservation (the row's `budget_day` already
  paid). The editor's progress bar reads `bytes_sent / total_bytes`.
- **status**: `videos.list(part=status,processingDetails)`; `processed` →
  `mark_target_published` (permalink `https://youtube.com/shorts/{id}`); `rejected/failed` →
  `mark_target_failed` with the mapped reason; otherwise clear the lease.
- **retry**: TikTok's rules; retryable = network, 5xx, quota, expired session.
- Tokens: `getFreshGoogleToken` once per connection per run.

**Spike S5 (Phase 3 gate)**: stream a 400 MiB file through a Supabase edge function in 8 MiB
chunks and measure CPU time and wall clock per tick. If edge limits do not hold, the `upload`
phase moves to a Cloudflare Worker (precedent: `workers/media-proxy`, `workers/transcribe`),
called by the cron with the same contract.

Timing: upload starts at `scheduled_at`, with the final privacy set directly (no `publishAt`:
uploading early would mean updating or deleting YouTube videos when posts change). The status
copy says "publica em {{data}}" without promising the exact minute.

### 6.5 Daily upload budget

`youtube_upload_budget` (`quota_day date` primary key = today in `America/Los_Angeles`; `used`,
`exhausted_at`), changed only by a SECURITY DEFINER `youtube_reserve_upload()` that increments
atomically and refuses past `YOUTUBE_DAILY_UPLOAD_BUDGET` (env, no deploy to change; default set
from task S0). The counter is a hint: a `quotaExceeded`/`uploadLimitExceeded` 403 marks the day
exhausted regardless. Queued targets go first on the next quota day in `scheduled_at` order. The
editor always shows mockup 5's banner; a queued row says "Na fila: o limite diário do YouTube
acabou. Envio previsto para {{hora}}" (next reset in São Paulo time).

### 6.6 Privacy before the audit

Google's docs disagree on whether uploads from unaudited projects are forced private (spike S1
settles it in Phase 3). Build the switch either way: `YOUTUBE_APP_AUDITED` unset → the editor
offers only "Privado" with "Até a aprovação do Google, os vídeos sobem como privados" and the
server enforces it; set it once S1 shows public works or the audit passes. Error copy in
`_shared/youtube-messages.ts` (duplicate, length, copyright, terms, invalid file, quota, token,
not connected).

### 6.7 Manual actions and other surfaces

`youtube-publish` function: `schedule`, `publish-now`, `cancel`, `retry`, gated per §4.5.
`cancel` before a `video_id` deletes the `youtube_uploads` row and returns the target to
`pendente`; after, it is refused ("Já enviado ao YouTube. Exclua pelo YouTube Studio"). The
composer (`ScheduleButton`, `PublicacoesPanel`, `DestinationToggles`, `PlatformSelector`,
`usePostDestinations`, `useClienteSocialAccounts`, `platformIcons`, `PlatformChips`) learns
`youtube`. Hub posts show "Ver no YouTube" from the target permalink (`hub-posts`,
`PostTile`/`PostCard`/`PostDetailDialog`).

## 7. Analytics UI

`AnalyticsClientShell`: `ANALYTICS_TABS = ['instagram','tiktok','youtube','google','relatorios']`
(routes `/analytics/:id/youtube`, `/analytics/:id/google`; `vercel.json` already covers
`/analytics(/.*)?`). Tabs hidden by flag; phone layout follows the TikTok tab's phone variant;
not-connected/expired states reuse its `StateCard`. New i18n namespaces `analyticsYoutube`,
`analyticsGoogle` (pt + en) in `boot/i18nResources.ts`; Redes sociais and editor strings in
`clients.json`/`postEditor`. No em dashes.

Read functions (tenant check, flags, 120/min per workspace), shared query modules in
`_shared/youtube-analytics/` and `_shared/gbp-analytics/` (reused by `report-docs`):
- `youtube-analytics`: `GET /overview/:clientId?days|from,to&type=all|shorts|long` (window
  totals + previous window, both from `youtube_range_cache`/the Analytics API), `/daily`,
  `/traffic`, `/demographics`, `/videos?sort=`, `/top-shorts`. No AI route.
- `gbp-analytics`: `GET /overview/:clientId?location=all|<uuid>&…`, `/daily`, `/surfaces`,
  `/keywords?month=`, `/reviews?filter=all|unanswered|low`, `/rating-distribution`, `/units`.

YouTube KPIs (mockup 3 amended per §4.6: no % deltas, previous-window value as the sub line,
"Shorts x vídeos longos" shows values, AI card removed):

| KPI | Source |
|---|---|
| Inscritos | `channels.list` current count (rounded by YouTube; "total atual"), no comparison |
| Novos inscritos | API window `subscribersGained − subscribersLost`, both shown |
| Visualizações, Visualizações engajadas, Tempo assistido, Curtidas, Compartilhamentos | API window totals for the content type |
| Duração média | API `averageViewDuration` for the window |

GMN KPIs (mockup 4 as approved; GMN is not under the derived-metrics rule):

| KPI | Source |
|---|---|
| Visualizações do perfil | Σ of the four impression metrics (a sum of daily unique users per surface; tooltip says so) |
| Ligações, Pedidos de rota, Cliques no site, Mensagens, Agendamentos | Σ of the metric |
| Nota média | latest `gbp_rating_daily`, review-count-weighted across units; delta vs window start |
| Novas avaliações | Δ total_review_count over the window |

Deltas compare with the previous window of the same length ending at `data_through`.
"Todas as unidades" sums units; per-unit selector and units table filter by location. The
rating distribution comes from stored reviews and says "Últimas 200 avaliações por unidade"
when the stored set is incomplete.

## 8. Reports

Structural changes (all currently hardcode instagram/tiktok):
- `_shared/report-docs/layout.ts`: `BLOCK_TYPES` (+ `youtube_*`, `gbp_*`), `blockPlatform()`
  (prefix checks before the unknown-is-Instagram fallback), `SECTION_PLATFORMS`,
  `sectionStructureError`.
- `_shared/report-docs/sections.ts`: `SectionKind` (+ `youtube`, `google`), `PLATFORM_ORDER`
  (instagram, tiktok, youtube, google), `sectionKindOf`, `toSections`, `fromSections`,
  `sectionizeLayout`, repair.
- `_shared/report-docs/platform-filter.ts`, `default-layout.ts` (`platformSectionBlocks`),
  `snapshot.ts` (`ReportDocSnapshot.youtube?`, `.google?`), `ai-input.ts` (Google only).
- **Migration recreating `validate_report_layout()`** (platform list and fallback are
  hardcoded, `20261103000003:125,165-168`) with new cases in
  `supabase/tests/fixtures/report_section_layouts.json`; the TS and SQL parity tests must pass.
- `report-docs`: `REPORT_PLATFORMS`, `parseGenerateBody`, `connectedPlatforms`,
  `loadClientSnapshot`, new `youtube-section.ts`/`google-section.ts` loaders, refresh keeping a
  lost platform's previous section (TikTok rule) **except YouTube after a purge**, flag re-checks
  in `generate.ts`, `PDF_RENDERER_VERSION` bump.
- `report_documents.youtube_channel_id uuid` FK ON DELETE SET NULL. GMN stores the location ids
  it used inside the snapshot.
- `packages/report-blocks`: catalog, platform view, data presence, fixtures, icons.
- CRM: `NewReportDialog`, `AddSectionMenu`, `AddWidgetDrawer`, `widgetIcons`, `LayersPanel`.
- `_shared/report-template/ai.ts`: GMN rules only.

Widgets (mockup 6, amended per §4.6): YouTube KPIs (no % deltas, no "% das visualizações
vieram de Shorts" tile), daily views Shorts × long, top Shorts, video list, traffic + audience;
GMN KPIs, where people saw the profile, daily actions, search terms, rating + distribution,
highlighted review (most recent 5★ with text, else 4★), units comparison. The report AI text
covers Instagram, TikTok and GMN; it never cites YouTube numbers.

## 9. Privacy policy (Phase 1)

`/politica-de-privacidade` gains a section: what Mesaas reads from YouTube and Google Business
Profile and what it publishes; retention (YouTube data deleted within 7 days of a disconnect;
GMN data 30 days); that Mesaas uses YouTube API Services, with links to the YouTube Terms of
Service and the Google Privacy Policy; how to revoke at `myaccount.google.com/permissions`;
reviewer names stored from Google reviews. Terms of use updated if they list integrations.

## 10. Rollout

Each phase is its own PR, merged in the usual order: migrations → functions → merge (the
frontend deploys on merge). Everything ships dark (flags off); the user's workspace gets an
override to pilot and to record Google's verification video against the **production** OAuth
client (the video must show that client's ID).

1. **Phase 1, connect + privacy**: S0 (read the `videos.insert` quota on the prod project), S4
   (Brand Account channel choice); migrations for `google_connections`, `youtube_channels`,
   `gbp_locations`, plan flags, `oauth_states` CHECK; `_shared/google.ts`; `google-integration`
   (auth, callback, accounts/locations list + link, summary, disconnect with the §4.2 revoke
   rule); Redes sociais cards + unit picker (mockups 1-2, identity and cached counts only);
   Admin flag labels; privacy policy (§9).
2. **Phase 2, sync + analytics**: S2, S3; history tables; `youtube-sync-cron` (with purge),
   `gbp-sync-cron`; `youtube-analytics`, `gbp-analytics`; tabs (mockups 3-4).
3. **Phase 3, publishing**: S1, S5; registry + CHECK widening; seed/tipo triggers; generic
   writers + recompute; claim, `youtube-publish-cron`, `youtube-publish`, budget; composer,
   Hub link (mockup 5).
4. **Phase 4, reports**: §8 (mockup 6), following the report-sections deploy order (migration →
   merge → `report-docs` after the Vercel deploy is live).

After Phase 3 is live for the user's workspace: record the demo video (each scope in use), submit
OAuth verification, and file the YouTube audit/quota extension **including the derived-metrics
request** (§4.6). GMN screens can be recorded only after Google approves GMN API access on the
prod project.

`--no-verify-jwt`: `google-integration` (OAuth callback), `youtube-sync-cron`,
`gbp-sync-cron`, `youtube-publish-cron` (cron secret). Read and action functions verify the
user JWT. The `FEATURE_COLUMNS` change redeploys every importer of `_shared/entitlements.ts`.

Spikes recap: S0 upload quota metering · S1 public uploads before audit · S2 `creatorContentType`
coverage · S3 GMN history range · S4 Brand Account channel choice · S5 edge streaming limits.

## 11. Left to the builder

Naming beyond what is fixed here, indexes, cron minutes (staggered per `20260925110001`;
YouTube sync after the Pacific reset), chart components (reuse the Instagram/TikTok tab
patterns, StatCard), copy beyond the mockups, tests (Deno DI handler factories, Vitest beside
components, SQL suites in `supabase/tests/entitlements/` for grants, RLS and the generic
writers).

## 12. Open questions

None blocking. Derived-metrics approval (§4.6) is requested with the audit; its outcome only
adds features later.
