# Video streaming via Cloudflare Stream — design

**Date:** 2026-08-13
**Status:** Approved approach (Cloudflare Stream); spec pending user review
**Owner surface:** Hub (client portal) + CRM (entregas / post express)

## 1. Problem

Clients report video playback that works on desktop but stutters and freezes on
mobile, especially in the client Hub. The pipeline serves the **original
uploaded file** byte-for-byte: R2 → `workers/media-proxy` (HMAC-signed URLs,
range requests, edge cache) → `<video src>` progressive download. There is no
transcoding and no adaptive bitrate anywhere.

Production evidence (queried 2026-08-13):

| Metric | Value |
|---|---|
| Videos in `files` (`post_media` has zero videos) | 275 total, 215 post-linked, 15.34 GB |
| `video/quicktime` (.mov, raw iPhone captures) | 175 files, avg **79.5 MB** |
| `video/mp4` (edited exports) | 100 files, avg 14.3 MB |
| Durations | total 197.6 min, avg 43.1 s, p95 92 s, max 129 s |
| Upload rate | ~100 videos, 4–7.5 GB per month, accelerating |
| Workspaces with videos | 6 |

An 80 MB / 45 s file is ~14 Mbps. Mobile connections that can't sustain that
bitrate starve the buffer: exactly the reported symptom. Existing mitigations
(`VideoPrewarm`, posters, `preload="metadata"`) fix startup latency only.

## 2. Goals / non-goals

**Goals**

- Smooth mobile playback for post videos in the Hub and the CRM (adaptive
  bitrate HLS).
- Keep the R2 original as source of truth: Instagram/TikTok publishing,
  downloads, and thumbnail frame-capture are untouched.
- Ship dark; degrade gracefully (any video without a ready stream plays through
  today's path).
- Predictable, small cost (~US$ 6/month at current volume).

**Non-goals (YAGNI)**

- Stream's iframe player (would break the existing lightbox UX).
- Live streaming, per-plan video-minute quotas, watermarking.
- Replacing the R2 upload path or the media-proxy worker.
- `post_media` ingest: that table holds zero videos today (all post video goes
  through `files` + `post_file_links`). If it ever carries video, it gets the
  same columns/trigger then.
- Client-side (WebCodecs) compression — unreliable and would degrade the
  original that IG publishing needs.

## 3. Options considered

| Option | Verdict |
|---|---|
| **A. Cloudflare Stream** (managed transcode + ABR HLS) | **Chosen.** Encoding/ingest free, $5/1k min stored + $1/1k min delivered, upload-via-link pulls straight from a presigned R2 URL, self-signed JWT playback tokens match our HMAC-signing patterns. |
| B. DIY transcode to ~4 Mbps faststart MP4 in R2 | Near-zero dollars but real engineering: ffmpeg pipeline (Containers + Queues or external API) to build and operate, and single-bitrate still stutters on weak links. |
| C. Cloudflare Media Transformations | Eliminated: 100 MB input / 1 min output caps exclude our p95 (140 MB, 92 s+). |

## 4. Cost simulation

Pricing ([docs](https://developers.cloudflare.com/stream/pricing/)): storage
**$5 per 1,000 min** (prepaid blocks; only original duration counts, all
renditions included), delivery **$1 per 1,000 min**. Encoding, ingest free; no
egress.

Real numbers: library today = 197.6 min; growth ≈ 72 min/month; assume ~10
plays per video (client + agency review cycles) ≈ 430 min delivered/month
today.

| Scenario | Stored | Delivered/mo | Monthly cost |
|---|---|---|---|
| Today (backfill + growth) | < 1,000 min for ~11 months | ~500–1,000 min | **$5–6** |
| 10× | ~2,000–3,000 min | ~10,000 min | ~$20–25 |
| 100× | ~28,000 min | ~100,000 min | ~$240 |

Delivery counts buffering, but idle cards fetch only the HLS manifest
(negligible). Kill switch: unset the signing/customer secrets — playback and
ingest stop instantly, everything falls back to the current player, and the
cleanup credentials stay so queued Stream deletions keep draining (§5.2).

## 5. Architecture

### 5.1 Data model (migration)

```sql
alter table files
  add column stream_uid text,
  add column stream_status text check (stream_status in ('pending','ready','error'));
create index on files (stream_uid) where stream_uid is not null;

-- Deletion rides the EXISTING outbox: file_deletions already has bounded
-- retries (attempts < 5, exponential backoff via next_retry_at, batch 500)
-- and an AFTER DELETE trigger on files (trg_file_enqueue_delete), drained by
-- post-media-cleanup-cron.
alter table file_deletions add column stream_uid text;
-- file_enqueue_delete() also copies OLD.stream_uid into the queued row. The
-- function stays SECURITY DEFINER (it already is — tenant-RLS'd deletes must
-- be able to write the no-RLS queue table).
```

`files` is not under the column-grant allowlist regime (`membros`/`clientes`
only), so no grant/view/SAFE_COLUMNS work is needed. Clients never receive
`stream_uid`/`stream_status`: `file-manage` uses `select("*")` and spreads
rows into responses, so its response mapping must strip both fields (a bare
uid is unplayable — `requireSignedURLs` — but it stays out of the contract).
Playback reaches clients only as the `playback` object.

### 5.2 Shared helper: `supabase/functions/_shared/stream.ts`

Mirrors `media-url.ts` conventions. Gating is split so the kill switch cannot
strand billed Stream copies:

- `isStreamCleanupEnabled()` — `STREAM_ACCOUNT_ID` + `STREAM_API_TOKEN` set.
  Required by the delete/reconciliation cron steps only.
- `isStreamEnabled()` — cleanup vars **plus** `STREAM_CUSTOMER_CODE`,
  `STREAM_SIGNING_KEY_ID`, `STREAM_SIGNING_KEY_JWK`, `STREAM_WEBHOOK_SECRET`.
  Required for ingest and playback.
- **Kill switch** = unset the signing/customer vars: ingest and playback stop,
  cleanup keeps draining. **Full teardown** = run a purge script (delete all
  Stream videos, null out `stream_uid`/`stream_status`), then unset everything.
- `copyToStream(r2Key, meta)` — POST `/accounts/{id}/stream/copy` with a
  short-lived (10 min) presigned R2 GET URL, `requireSignedURLs: true`,
  `meta: { file_id, conta_id }`. Returns `uid`.
- `signPlaybackToken(uid, expSeconds)` — self-signed RS256 JWT via WebCrypto
  (no API call, no rate limit), `kid` = `STREAM_SIGNING_KEY_ID`. Expiry ≤ 12 h
  (Stream caps at 24 h). Returns the tokenized HLS URL
  `https://customer-{code}.cloudflarestream.com/{token}/manifest/video.m3u8`.
- `deleteStreamVideo(uid)` — DELETE; 404 treated as success (idempotent).

All vars are edge-function secrets with no fallbacks; absence means the
corresponding capability is silently off (same dark-ship pattern as
`WHATSAPP_SUPPORT_NUMBER`).

### 5.3 Ingest flow

1. `file-upload-finalize`: after the existing quota-checked insert succeeds,
   if `mime_type` starts with `video/` and `isStreamEnabled()`: set
   `stream_status='pending'` (durable intent, written **before** the external
   call), call `copyToStream`, then save `stream_uid`. Any failure is
   non-fatal: log and return the normal response (upload UX never blocks on
   Stream). A row left `pending` with a null uid — copy call failed, or the
   uid save failed after Stream accepted — is repaired by the sweep below.
2. New `stream-webhook` edge function (deployed `--no-verify-jwt`): verifies
   the `Webhook-Signature` header (HMAC-SHA256, timing-safe, tolerance 5 min)
   against `STREAM_WEBHOOK_SECRET`, then settles `stream_status` by
   `stream_uid`. **Transitions are monotonic**: the update is guarded with
   `where stream_status = 'pending'` — `ready` is terminal and a late or
   duplicated `error` event can never downgrade it. Unknown uid or already
   settled → 200 (idempotent). Generic error responses, details logged
   internally.
3. Reconciliation sweep (webhook is best-effort; runs in
   `post-media-cleanup-cron`, self-healing for every path):
   - **Ingest catch-up**: video rows with `stream_uid is null` older than
     ~10 min get a `copyToStream` attempt. This covers enqueue failures AND
     rows created outside `file-upload-finalize` — notably `file-manage`
     copy-file / copy-folder, which insert `files` rows directly. The ~10 min
     is a lower bound, not a promised recovery time: today this sweep only
     runs inside `post-media-cleanup-cron`'s existing daily 03:00 schedule
     (≤20 rows/run), so a video that misses inline ingest can stay on the MP4
     fallback for up to ~24 h until the next run — a dedicated, more frequent
     schedule is a spawned follow-up.
   - **Settle pending**: rows `pending` with a uid older than 1 h are checked
     against the Stream API and settled to `ready`/`error`.
   - **Orphan reap**: list Stream videos via API (volume is small) and delete
     any whose uid matches no `files.stream_uid` and is older than a 1 h grace
     window — compensation for the copy-accepted-but-uid-save-failed case, so
     no billed copy can leak.

### 5.4 Playback flow

Every edge response that today returns a signed media URL for a video file
also returns, when `stream_status='ready'` and `isStreamEnabled()`:

```ts
playback: { hls: string /* tokenized manifest URL */, expires_at: string }
```

Touched functions: `hub-posts` (Hub Postagens/Aprovações media arrays),
`post-media-manage`/`file-manage` list-shaped responses, and the finalize
responses — the exact list is enumerated at plan time by grepping
`signMediaUrl`/`signGetUrl` call sites that serve video files. `playback` is
`null` otherwise — clients treat `null` as "use the
existing `url`".

Frontend: new `packages/ui/VideoPlayer` (precedent: `InstagramGrid`), props
`{ hlsSrc?, mp4Src, poster?, ... }`:

- Safari/iOS: native HLS (`canPlayType('application/vnd.apple.mpegurl')`) →
  `<video src={hlsSrc}>`.
- Other browsers: lazy `import('hls.js')` and attach. Frontend npm workspace
  dependency (Vitest/tsc only — the Deno min-dep-age gate does not apply);
  pin an exact version anyway for reproducibility.
- Any HLS error or missing `hlsSrc` → fall back to `mp4Src` (current behavior).

Swap-in sites: Hub `PostMediaLightbox`, CRM `PostMediaGallery`,
`PostMediaLightbox` (entregas), `ExpressPostPage` preview. Unchanged:
`ThumbnailPickerDialog` + `videoFrame.ts` (frame capture needs the original
file + CORS), `InstagramGrid` (posters only), IG/TikTok publishing, downloads,
`VideoPrewarm` (still warms the fallback; HLS startup doesn't need it).

### 5.5 Deletion

- The existing `trg_file_enqueue_delete` trigger fires no matter who deletes
  the `files` row (`file-manage`, `storage_autoclean_run` from PR #327, or any
  future path); with `file_enqueue_delete()` extended, the queued row now
  carries `stream_uid` alongside `r2_key`.
- `post-media-cleanup-cron`'s existing drain loop additionally calls
  `deleteStreamVideo(uid)` when the row has one (404 = success), reusing the
  same `attempts`/`next_retry_at` retry machinery. A row completes only when
  both the R2 objects and the Stream copy are gone.

### 5.6 Backfill

One-shot script `scripts/backfill-stream-videos.ts` (under
`tsconfig.scripts.json`): iterate `files` where video and `stream_uid is
null`, presign, `copyToStream`, throttle to ~1/s. 275 videos ≈ 5 min run.
Idempotent (skips rows with a uid). Run once per environment after secrets are
set.

## 6. Error handling summary

| Failure | Behavior |
|---|---|
| Stream copy enqueue fails | `stream_status='error'`, upload succeeds, playback falls back to MP4 |
| Webhook lost / delayed | cron reconciliation settles pending rows |
| Token expired in a long-lived tab (>12 h) | fallback MP4 URL still valid (signed for 7 days via media-proxy, vs ≤12 h HLS token); on fatal player error the component also triggers a query refetch so the next attempt gets fresh URLs and tokens |
| Stream outage | HLS error → automatic MP4 fallback in `VideoPlayer` |
| Secrets unset (staging today, or kill switch) | `playback: null` everywhere, exactly today's behavior |

## 7. Testing

- **Deno**: `_shared/stream.ts` (split enabled-gating, copy payload, JWT
  shape/exp, delete idempotency), `stream-webhook` handler (signature verify
  incl. timing-safe + tolerance, monotonic transitions — a late `error` never
  downgrades `ready` — unknown uid), finalize handler (video → intent then
  copy; image → not; copy failure non-fatal), cron drain + all three sweep
  steps (ingest catch-up incl. file-manage copies, settle pending, orphan
  reap), `file-manage` responses strip `stream_*`, `hub-posts` playback field
  (ready/pending/disabled).
- **Vitest**: `VideoPlayer` branches (native HLS, hls.js path mocked, fallback
  on error/missing hlsSrc); existing lightbox/gallery tests updated for the
  new component (grep both suites for the old `<video` usage — contract-change
  rule).
- **Manual/staging**: upload a real iPhone `.mov` on staging, confirm ready
  transition, play on an actual phone (jsdom can't verify playback), confirm
  IG publish still uses the original.

## 8. Rollout

1. PR with migration + edge functions + script + frontend (feature is
   env-gated; everything inert until secrets exist).
2. Deploy functions (`stream-webhook` with `--no-verify-jwt`), `db push`
   staging → prod (unique migration version prefix; re-verify against
   origin/main at PR-open time).
3. Create the Stream signing key once (`POST /stream/keys`), configure the
   webhook URL in the Cloudflare dashboard, set secrets on staging; upload +
   verify; then prod.
4. Run the backfill script (staging, then prod).
5. Monitor: Stream dashboard spend, plus the cron's own response counters
   (`deleted`/`failed`/etc. in `post-media-cleanup-cron`'s JSON response).
   `post-media-cleanup-cron` is NOT wired into `reportCronFailure()`
   cron-failure triage today — no other cron's failure alerts cover it, and
   wiring it in is a separate, spawned follow-up task.

No `vercel.json` changes (no new routes). No CSP changes (none configured).

## 9. Open items for the user

- Cloudflare account: Stream must be enabled on the same account as R2
  (dashboard, one click + billing acceptance) — owner action, like the Pagar.me
  webhook registration.
- Decide later (not blocking): whether Arquivos-section videos (non-post) also
  get ingested. This design ingests **all** video `files` rows for simplicity
  (uploads and file-manage copies alike, via the sweep); restricting to
  post-linked would save ~$0.30/month today. Not worth the conditional.
