# Video Streaming via Cloudflare Stream — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix mobile video stutter by serving post videos as adaptive HLS through Cloudflare Stream, with the R2 original untouched and an automatic MP4 fallback everywhere.

**Architecture:** Upload finalize writes durable intent, then triggers a Stream *copy* from a presigned R2 URL; a webhook (plus a cron sweep) settles `files.stream_status`; read endpoints add a `playback` object (self-signed RS256 JWT HLS URL) next to the existing signed `url`; a shared `VideoPlayer` plays HLS (native on Safari, hls.js elsewhere) and falls back to the current progressive URL. Deletion rides the existing `file_deletions` outbox. Everything is env-gated: no `STREAM_*` secrets = exactly today's behavior.

**Tech Stack:** Deno edge functions (Supabase), Postgres migration, Cloudflare Stream API, WebCrypto (RS256 JWT + HMAC webhook verify), React 19 + hls.js, Vitest + `deno test` + psql SQL suite.

**Spec:** `docs/superpowers/specs/2026-08-13-video-streaming-design.md` — read it first.

## Global Constraints

- Migration version prefix MUST sort after origin/main's tail (currently `20260814000001`). Re-verify with `git ls-tree --name-only origin/main:supabase/migrations | tail -3` immediately before `gh pr create`; renumber if main moved.
- Edge functions are **Deno**: `npm:` specifiers or relative `.ts` imports only. CORS via `buildCorsHeaders(req)`; never wildcard. Never return raw error details to clients — generic message out, detail logged.
- Absent `STREAM_*` secrets mean "capability off", never an error (dark-ship pattern).
- Playback token expiry: **12 h** (`43_200` s). Stream caps tokens at 24 h.
- `meta` values sent to Stream must be strings (`String(id)`).
- User-facing copy is Portuguese and must not contain em-dashes.
- After any `deno test` / `npm run test:functions` run: `git checkout -- deno.lock`. If `ls node_modules/.deno` shows pollution, run `npm ci` before trusting prettier/tsc.
- Before pushing: `npm run lint`, `npm run format:check`, all four tsc projects (`apps/crm`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`, `npm run test:functions`.
- Commit after every green task. Work happens in this worktree (`.claude/worktrees/post-express-client-approval-55d6bb`), branch `claude/mobile-video-r2-streaming-008e2d` — verify with `git status` before claiming anything.

---

### Task 1: Migration — stream columns + outbox + trigger

**Files:**
- Create: `supabase/migrations/20260814000002_stream_video_playback.sql`
- Create: `supabase/tests/entitlements/65_stream_video_columns.sql`

**Interfaces:**
- Produces: `files.stream_uid text`, `files.stream_status text` (`pending|ready|error`), `file_deletions.stream_uid text`, and `file_enqueue_delete()` copying `OLD.stream_uid` into the queue. Every later task relies on these exact column names.

- [ ] **Step 1: Write the migration**

```sql
-- Cloudflare Stream playback (spec 2026-08-13). stream_uid/stream_status live
-- only on files: post_media holds zero videos (all post video is files +
-- post_file_links).
ALTER TABLE files
  ADD COLUMN stream_uid text,
  ADD COLUMN stream_status text CHECK (stream_status IN ('pending', 'ready', 'error'));

CREATE INDEX files_stream_uid_idx ON files (stream_uid) WHERE stream_uid IS NOT NULL;
-- Ingest catch-up sweep scans "video rows not yet in Stream" by age.
CREATE INDEX files_stream_ingest_idx ON files (created_at)
  WHERE kind = 'video' AND stream_uid IS NULL;

ALTER TABLE file_deletions ADD COLUMN stream_uid text;

-- Same function, one more copied column. Stays SECURITY DEFINER: tenant-RLS'd
-- deletes must be able to write the no-RLS queue table.
CREATE OR REPLACE FUNCTION file_enqueue_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO file_deletions (r2_key, thumbnail_r2_key, stream_uid)
  VALUES (OLD.r2_key, OLD.thumbnail_r2_key, OLD.stream_uid);
  RETURN OLD;
END;
$$;
```

- [ ] **Step 2: Write the SQL test**

`supabase/tests/entitlements/65_stream_video_columns.sql`, following the house pattern (`\set ON_ERROR_STOP on`, `\i _helpers.sql`, `do $$` asserts, `rollback` at the end — copy the prologue shape from `63_storage_autoclean.sql`):

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Stream playback columns (spec 2026-08-13): deleting a files row must carry
-- stream_uid into file_deletions via the SECURITY DEFINER trigger.

begin;
do $$
declare
  v_ws uuid;
  v_file bigint;
  v_queued_uid text;
  v_secdef boolean;
begin
  -- file_enqueue_delete must remain SECURITY DEFINER.
  select prosecdef into v_secdef from pg_proc where proname = 'file_enqueue_delete';
  if v_secdef is distinct from true then
    raise exception 'file_enqueue_delete lost SECURITY DEFINER';
  end if;

  insert into workspaces (nome) values ('stream-test') returning id into v_ws;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes, stream_uid, stream_status)
  values (v_ws, 'contas/' || v_ws || '/files/v.mov', 'v.mov', 'video', 'video/quicktime', 1000, 'uid-abc', 'ready')
  returning id into v_file;

  delete from files where id = v_file;

  select stream_uid into v_queued_uid
  from file_deletions where r2_key = 'contas/' || v_ws || '/files/v.mov';
  if v_queued_uid is distinct from 'uid-abc' then
    raise exception 'file_deletions row missing stream_uid (got %)', v_queued_uid;
  end if;
end $$;
rollback;
```

If the `workspaces` insert needs more required columns, mirror how `63_storage_autoclean.sql` creates its workspace fixture rather than inventing values.

- [ ] **Step 3: Run the SQL test locally if Docker is available; otherwise rely on CI**

```bash
colima start && npx supabase start && bash scripts/test-entitlements.sh
```

If colima/Docker is unavailable locally, state that plainly — the `entitlement-tests` CI job gates this suite regardless.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260814000002_stream_video_playback.sql supabase/tests/entitlements/65_stream_video_columns.sql
git commit -m "feat(stream): migration for stream playback columns + delete-queue carry"
```

---

### Task 2: `_shared/stream.ts` — API client, gating, JWT, webhook verify

**Files:**
- Create: `supabase/functions/_shared/stream.ts`
- Test: `supabase/functions/__tests__/stream-shared_test.ts`

**Interfaces (produced — later tasks import these exact names):**

```ts
export function isStreamCleanupEnabled(): boolean;           // STREAM_ACCOUNT_ID + STREAM_API_TOKEN
export function isStreamEnabled(): boolean;                  // cleanup vars + CUSTOMER_CODE + SIGNING_KEY_ID + SIGNING_KEY_JWK + WEBHOOK_SECRET
export async function copyToStream(sourceUrl: string, meta: Record<string, string>, fetchFn?: typeof fetch): Promise<string>; // returns uid, throws on failure
export async function signPlaybackUrl(uid: string, expSeconds?: number): Promise<{ hls: string; expires_at: string }>; // default 43_200
export async function verifyStreamWebhookSignature(body: string, sigHeader: string | null, nowSeconds?: number): Promise<boolean>;
export async function deleteStreamVideo(uid: string, fetchFn?: typeof fetch): Promise<void>;  // 404 = success
export async function getStreamVideoStatus(uid: string, fetchFn?: typeof fetch): Promise<"ready" | "error" | "inprogress">;
export async function listStreamVideos(fetchFn?: typeof fetch): Promise<Array<{ uid: string; created: string }>>;
```

Implementation notes (all env reads happen inside functions, never at module load, so absence disables rather than throws and tests can `Deno.env.set` freely):

- API base: `https://api.cloudflare.com/client/v4/accounts/${STREAM_ACCOUNT_ID}/stream`; auth header `Authorization: Bearer ${STREAM_API_TOKEN}`.
- `copyToStream`: `POST {base}/copy` with `{ url: sourceUrl, meta, requireSignedURLs: true }` → `json.result.uid`. Non-2xx or `success:false` → throw `new Error("stream copy failed: " + res.status)` (message stays internal; callers log, never forward).
- `signPlaybackUrl`: `STREAM_SIGNING_KEY_JWK` is the **base64-encoded JWK** exactly as returned by Cloudflare's `POST /stream/keys`. Import with:

```ts
const jwk = JSON.parse(atob(Deno.env.get("STREAM_SIGNING_KEY_JWK")!));
const key = await crypto.subtle.importKey(
  "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
);
```

  JWT: header `{ alg: "RS256", kid: STREAM_SIGNING_KEY_ID }`, payload `{ sub: uid, kid: STREAM_SIGNING_KEY_ID, exp }` where `exp = floor(Date.now()/1000) + expSeconds`. base64url-encode header/payload/signature (`btoa` → `+/=` → `-_` strip). Return:

```ts
{
  hls: `https://customer-${code}.cloudflarestream.com/${token}/manifest/video.m3u8`,
  expires_at: new Date(exp * 1000).toISOString(),
}
```

- `verifyStreamWebhookSignature`: header format `time=1230811200,sig1=<hex>` where `sig1 = HMAC-SHA256(STREAM_WEBHOOK_SECRET, `${time}.${body}`)`. Reject when header missing/malformed, `|now - time| > 300`, or hex mismatch. Compare **timing-safe** (XOR accumulator over chars, same as `workers/media-proxy/src/index.ts:23-33`).
- `deleteStreamVideo`: `DELETE {base}/{uid}`; treat 200/404 as success, otherwise throw.
- `getStreamVideoStatus`: `GET {base}/{uid}` → `result.status.state`; map anything that is not `"ready"`/`"error"` to `"inprogress"`.
- `listStreamVideos`: `GET {base}?asc=true` returns up to 1000 items in `result`; paginate with `?asc=true&after=<created of last item>` until a page returns fewer than 1000. Return `[{ uid, created }]`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/__tests__/stream-shared_test.ts` — use the house helpers (`assertEquals` from `./assert.ts`). Env fixture:

```ts
function setStreamEnv() {
  Deno.env.set("STREAM_ACCOUNT_ID", "acct1");
  Deno.env.set("STREAM_API_TOKEN", "tok1");
  Deno.env.set("STREAM_CUSTOMER_CODE", "custcode");
  Deno.env.set("STREAM_SIGNING_KEY_ID", "key1");
  Deno.env.set("STREAM_WEBHOOK_SECRET", "whsec");
  // STREAM_SIGNING_KEY_JWK set per-test (needs a generated key)
}
function clearStreamEnv() {
  for (const k of ["STREAM_ACCOUNT_ID","STREAM_API_TOKEN","STREAM_CUSTOMER_CODE","STREAM_SIGNING_KEY_ID","STREAM_SIGNING_KEY_JWK","STREAM_WEBHOOK_SECRET"]) Deno.env.delete(k);
}
```

Cover at minimum:
1. Gating: all unset → both false; only ACCOUNT_ID+API_TOKEN → cleanup true, full false; all set (incl. a dummy JWK) → both true.
2. `copyToStream` posts to `.../accounts/acct1/stream/copy` with `requireSignedURLs: true` and returns `result.uid` (stub `fetchFn`, capture the Request); throws on `success:false`.
3. `signPlaybackUrl`: generate a real key in the test —

```ts
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
  true, ["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
Deno.env.set("STREAM_SIGNING_KEY_JWK", btoa(JSON.stringify(jwk)));
```

   then assert: URL shape `customer-custcode.cloudflarestream.com/<token>/manifest/video.m3u8`; decoded payload has `sub === uid`, `kid === "key1"`, `exp` ≈ now+43200; and `crypto.subtle.verify` passes with `pair.publicKey` over `header.payload`.
4. `verifyStreamWebhookSignature`: valid header (computed with the same HMAC in the test) → true; tampered body → false; `time` 10 min old → false; missing/garbage header → false.
5. `deleteStreamVideo`: 404 resolves; 500 throws.
6. `listStreamVideos`: stub two pages (1000 then 3 items) → 1003 uids, second request carries `after=`.

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:functions -- --filter "stream"
```
Expected: FAIL (module not found). Note: `--filter` matches TEST NAMES — name every test with a `stream-shared:` prefix.

- [ ] **Step 3: Implement `_shared/stream.ts`** per the interface notes above.

- [ ] **Step 4: Run to verify pass**

```bash
npm run test:functions -- --filter "stream"
git checkout -- deno.lock
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stream.ts supabase/functions/__tests__/stream-shared_test.ts
git commit -m "feat(stream): shared Stream client (gating, copy, JWT playback, webhook verify)"
```

---

### Task 3: `stream-webhook` edge function

**Files:**
- Create: `supabase/functions/stream-webhook/index.ts`
- Create: `supabase/functions/stream-webhook/handler.ts`
- Modify: `supabase/config.toml` (add `[functions.stream-webhook]` / `verify_jwt = false`)
- Modify: `supabase/functions/__tests__/config-audit_test.ts` (add `"stream-webhook"` to `REQUIRED_FUNCTIONS`, "Token/internal auth" group)
- Test: `supabase/functions/__tests__/stream-webhook_test.ts`

**Interfaces:**
- Consumes: `verifyStreamWebhookSignature` (Task 2), `files.stream_uid/stream_status` (Task 1).
- Produces: `createStreamWebhookHandler(deps)` with `deps = { createDb: () => DbClient; verifySignature: (body: string, header: string | null) => Promise<boolean> }`.

Handler behavior (`handler.ts`, DI factory like `file-upload-finalize/handler.ts`):
1. `POST` only (405 otherwise; no CORS needed — server-to-server, but return plain responses).
2. Read raw body text FIRST (signature covers the exact bytes), then `deps.verifySignature(body, req.headers.get("Webhook-Signature"))`; false → 401 `{"error":"invalid signature"}`.
3. Parse JSON → `{ uid, status }` where `status.state` is `"ready" | "error" | ...`. Missing uid → 200 (ack, nothing to do).
4. Map `state === "ready"` → `"ready"`, `state === "error"` → `"error"`, anything else → 200 no-op.
5. **Monotonic settle**: `svc.from("files").update({ stream_status: mapped }).eq("stream_uid", uid).eq("stream_status", "pending")` — a late/duplicate `error` can never downgrade `ready`. Unknown uid or already settled → still 200.
6. Any internal failure → 500 with generic body, detail via `console.error`.

`index.ts` wiring:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyStreamWebhookSignature } from "../_shared/stream.ts";
import { createStreamWebhookHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createStreamWebhookHandler({
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }),
  verifySignature: (body, header) => verifyStreamWebhookSignature(body, header),
}));
```

- [ ] **Step 1: Write the failing tests** (`createSupabaseQueryMock` from `../../../test/shared/supabaseMock.ts`): valid signature + `state:"ready"` updates files with the monotonic `.eq("stream_status","pending")` chain and returns 200; `state:"error"` maps to error; bad signature → 401 and NO db call; unknown state → 200 no db update; GET → 405.
- [ ] **Step 2: Run — expect FAIL** (`npm run test:functions -- --filter "stream-webhook"`).
- [ ] **Step 3: Implement handler + index + config.toml entry + config-audit addition.**
- [ ] **Step 4: Run — expect PASS**, including `npm run test:functions -- --filter "config-audit"`. Then `git checkout -- deno.lock`.
- [ ] **Step 5: Commit** — `feat(stream): stream-webhook settles stream_status (monotonic, signature-verified)`.

---

### Task 4: Ingest on upload — `file-upload-finalize`

**Files:**
- Modify: `supabase/functions/file-upload-finalize/handler.ts`
- Modify: `supabase/functions/file-upload-finalize/index.ts`
- Test: `supabase/functions/__tests__/file-upload-finalize_test.ts` (extend)

**Interfaces:**
- Consumes: `copyToStream`, `isStreamEnabled` (Task 2); `signGetUrl` from `_shared/r2.ts`.
- Produces: optional dep `streamCopy?: (r2Key: string, meta: { file_id: string; conta_id: string }) => Promise<string>` on `FileUploadFinalizeDeps`.

Handler change — insert AFTER the `post_file_links` block (after line 152), BEFORE the signed-URL response, so a Stream hiccup can never break the upload:

```ts
if (body.kind === "video" && deps.streamCopy) {
  const fileId = (inserted as any).id;
  try {
    // Durable intent BEFORE the external call: a pending row with a null uid
    // is exactly what the cron sweep repairs (spec §5.3).
    await svc.from("files").update({ stream_status: "pending" }).eq("id", fileId);
    const uid = await deps.streamCopy(body.r2_key, {
      file_id: String(fileId),
      conta_id: profile.conta_id,
    });
    await svc.from("files").update({ stream_uid: uid }).eq("id", fileId);
  } catch (e) {
    console.error("file-upload-finalize:stream-copy", e);
  }
}
```

`index.ts` wiring:

```ts
import { copyToStream, isStreamEnabled } from "../_shared/stream.ts";
// inside the deps object:
streamCopy: isStreamEnabled()
  ? async (r2Key, meta) => copyToStream(await signGetUrl(r2Key, 600), meta)
  : undefined,
```

Deliberate spec deviation, record in the PR body: the finalize RESPONSE does not
gain a `playback` field — at finalize time the video is never transcoded yet, so
it would always be `null`, and both frontend types keep `playback` optional.

- [ ] **Step 1: Extend the test file** (reuse `makeHandler`/`setupAuth`/`baseBody` fixtures; add `streamCopy` to `makeHandler` opts): video upload with `streamCopy` set → called with the r2_key and `{file_id, conta_id}`, files updated `pending` then with the uid, response still 200; `streamCopy` rejects → response still 200 and no uid update; image upload → `streamCopy` NOT called; `streamCopy` undefined (gating off) → untouched behavior.
- [ ] **Step 2: Run — expect FAIL.** `npm run test:functions -- --filter "file-upload-finalize"`
- [ ] **Step 3: Implement** handler + wiring.
- [ ] **Step 4: Run — expect PASS** (whole file: existing cases must stay green). `git checkout -- deno.lock`
- [ ] **Step 5: Commit** — `feat(stream): ingest videos to Stream on upload finalize (intent-first, non-fatal)`.

---

### Task 5: `playback` in `hub-posts`

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts` (media select + mapping, `handler.ts:200-220`)
- Modify: `supabase/functions/hub-posts/index.ts`
- Test: `supabase/functions/__tests__/hub-functions_test.ts` or the hub-posts-specific suite (grep for existing hub-posts media assertions and extend where they live)

**Interfaces:**
- Consumes: `signPlaybackUrl`, `isStreamEnabled` (Task 2).
- Produces: media objects gain `playback: { hls: string; expires_at: string } | null`. Dep: `signPlayback?: (uid: string) => Promise<{ hls: string; expires_at: string }>`.

Changes:
1. Select adds the two columns: `files(id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, blur_data_url, stream_uid, stream_status)`.
2. Mapping (inside the existing `mediaWithUrls` map) adds:

```ts
playback: f.stream_uid && f.stream_status === "ready" && deps.signPlayback
  ? await deps.signPlayback(f.stream_uid)
  : null,
```

   `stream_uid`/`stream_status` themselves are NOT added to the returned object (clients only see `playback`).
3. `index.ts`: `signPlayback: isStreamEnabled() ? (uid) => signPlaybackUrl(uid) : undefined` added to the `createHubPostsHandler` deps.

- [ ] **Step 1: Write failing tests**: ready video + `signPlayback` present → media item has `playback.hls`; `stream_status` pending or `signPlayback` absent → `playback: null`; response contains no `stream_uid` key. Grep existing hub-posts media deep-equality assertions (`grep -rn "thumbnail_url" supabase/functions/__tests__/hub-*` ) and add `playback: null` where object equality would now fail.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run full hub filter — expect PASS.** `git checkout -- deno.lock`
- [ ] **Step 5: Commit** — `feat(stream): hub-posts returns playback (signed HLS) for ready videos`.

---

### Task 6: `playback` in `post-media-manage` (CRM post galleries)

**Files:**
- Modify: `supabase/functions/post-media-manage/handler.ts` (`toLegacy` at `handler.ts:23-48` + its call sites + the `files(...)` embeds)
- Modify: `supabase/functions/post-media-manage/index.ts`
- Test: `supabase/functions/__tests__/post-media-manage_test.ts` (or wherever `toLegacy`-shaped assertions live — `grep -rln "post-media-manage" supabase/functions/__tests__/`)

**Interfaces:**
- Consumes: `signPlaybackUrl`, `isStreamEnabled` (Task 2).
- Produces: the legacy media object gains `playback: { hls; expires_at } | null`. Same dep name as Task 5: `signPlayback?`.

Changes:
1. `toLegacy(link, file, url, thumbnailUrl, playback: { hls: string; expires_at: string } | null)` — add the parameter and `playback` to the returned object. `toLegacy` maps fields explicitly, so `stream_uid`/`stream_status` never leak even though the embeds use `files(*)`.
2. At every `toLegacy` call site compute:

```ts
const playback = f.stream_uid && f.stream_status === "ready" && deps.signPlayback
  ? await deps.signPlayback(f.stream_uid)
  : null;
```

3. `index.ts`: same `signPlayback` wiring as Task 5.

- [ ] **Step 1: Write failing tests** mirroring Task 5's cases against the GET media listing.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — expect PASS.** `git checkout -- deno.lock`
- [ ] **Step 5: Commit** — `feat(stream): post-media-manage returns playback for ready videos`.

---

### Task 7: `file-manage` — strip `stream_*`, add `playback` on list

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts` (list mapping `handler.ts:150-154`; also the copy-file response at `:414-431` and any other place a raw `files` row is spread into a response — `grep -n '\.\.\.f\b\|\.\.\.source\b\|\.\.\.newFile' supabase/functions/file-manage/handler.ts`)
- Modify: `supabase/functions/file-manage/index.ts`
- Test: `supabase/functions/__tests__/file-manage_test.ts` (extend)

**Interfaces:**
- Consumes: `signPlaybackUrl`, `isStreamEnabled` (Task 2). Same `signPlayback?` dep.
- Produces: list items gain `playback`; NO response anywhere contains `stream_uid`/`stream_status`.

List mapping becomes:

```ts
const signedFiles = await Promise.all((files ?? []).map(async (f: any) => {
  const { stream_uid, stream_status, ...pub } = f;
  return {
    ...pub,
    url: f.kind !== "document" ? await deps.signUrl(f.r2_key) : null,
    thumbnail_url: f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null,
    playback: stream_uid && stream_status === "ready" && deps.signPlayback
      ? await deps.signPlayback(stream_uid)
      : null,
  };
}));
```

Apply the same `const { stream_uid, stream_status, ...pub } = row` strip to every other spread of a `files` row found by the grep (copy-file response included). Copied videos intentionally get NO inline ingest — the Task 8 sweep picks them up (spec §5.3).

- [ ] **Step 1: Write failing tests**: list with a ready streamed video → item has `playback` and no `stream_uid` key; pending → `playback: null`; copy-file response also has no `stream_uid` key.
- [ ] **Step 2: Run — expect FAIL.** (`--filter "file-manage"`)
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — expect PASS** including `file-manage-bulk` suite. `git checkout -- deno.lock`
- [ ] **Step 5: Commit** — `feat(stream): file-manage playback + strip stream_* from responses`.

---

### Task 8: Cron — Stream delete in the drain + three sweeps

**Files:**
- Create: `supabase/functions/post-media-cleanup-cron/stream-steps.ts`
- Modify: `supabase/functions/post-media-cleanup-cron/index.ts`
- Test: `supabase/functions/__tests__/stream-steps_test.ts`

**Interfaces:**
- Consumes: Task 2 client fns; `signGetUrl` from `_shared/r2.ts`; `file_deletions.stream_uid` (Task 1).
- Produces:

```ts
export interface StreamStepsDeps {
  db: any; // service-role supabase client (or createSupabaseQueryMock in tests)
  // Optional trio: present only when isStreamEnabled(); ingest + settle steps
  // skip when absent (kill-switch mode keeps only the reap running).
  copyToStream?(sourceUrl: string, meta: Record<string, string>): Promise<string>;
  signSourceUrl?(r2Key: string): Promise<string>;            // presigned R2 GET, 600 s
  getStreamVideoStatus?(uid: string): Promise<"ready" | "error" | "inprogress">;
  deleteStreamVideo(uid: string): Promise<void>;
  listStreamVideos(): Promise<Array<{ uid: string; created: string }>>;
  nowMs?: () => number;
}
export async function runStreamSweeps(deps: StreamStepsDeps): Promise<{ ingested: number; settled: number; reaped: number; errors: number }>;
```

`runStreamSweeps` implements, in order (each step wrapped so one failure doesn't stop the next; count into `errors`):

1. **Ingest catch-up** (covers enqueue failures AND `file-manage` copies): select up to 20 of `files` where `kind = 'video'`, `stream_uid is null`, `stream_status is null or stream_status = 'pending'`, `created_at < now() - 10 min`, ordered `created_at asc`. For each: update `stream_status='pending'`, `copyToStream(await signSourceUrl(r2_key), { file_id: String(id), conta_id })`, save uid.
2. **Settle pending**: select up to 50 of `files` where `stream_status = 'pending'`, `stream_uid is not null`, `created_at < now() - 1 h`. For each, `getStreamVideoStatus(uid)` → `ready`/`error` update (skip `inprogress`).
3. **Orphan reap**: `listStreamVideos()`; build the DB uid set (`select stream_uid from files where stream_uid is not null` — plus the pending `file_deletions.stream_uid` rows, which are queued for delete but not orphans to double-delete here); delete any Stream uid absent from both sets with `created` older than 1 h.

`index.ts` changes:
1. The `file_deletions` drain select adds `stream_uid`; inside its try block, after the R2 deletes: `if (row.stream_uid && cleanupEnabled) await deleteStreamVideo(row.stream_uid);` — reusing the existing catch (attempts+1, exponential backoff). The row is only removed when R2 AND Stream deletes both succeeded (R2 deletes are idempotent on retry).
2. After the orphan-key section: `if (isStreamCleanupEnabled()) { const sweep = await runStreamSweeps({...}); }` with the full-gated pieces (`copyToStream`, `signSourceUrl`) passed only when `isStreamEnabled()` — when only cleanup vars exist, pass a `copyToStream` that throws immediately so ingest counts as errors=0/skipped: simpler, make ingest/settle steps run only when `isStreamEnabled()`, orphan reap when `isStreamCleanupEnabled()`. Encode that INSIDE `runStreamSweeps` via optional deps: `copyToStream?`, `signSourceUrl?`, `getStreamVideoStatus?` — steps 1-2 skip when absent.
3. Include sweep counters in the cron's JSON result.

- [ ] **Step 1: Write failing tests** for `runStreamSweeps` with `createSupabaseQueryMock` + stub deps: catch-up ingests a 15-min-old copied video and saves the uid; skips rows younger than 10 min; settle flips pending→ready and leaves inprogress; reap deletes an unknown 2-h-old uid but spares known uids, queued `file_deletions` uids, and a 5-min-old unknown; steps 1-2 skip when `copyToStream` absent.
- [ ] **Step 2: Run — expect FAIL.** (`--filter "stream-steps"`)
- [ ] **Step 3: Implement `stream-steps.ts` + wire `index.ts`.**
- [ ] **Step 4: Run — expect PASS.** `git checkout -- deno.lock`
- [ ] **Step 5: Commit** — `feat(stream): cleanup cron drains Stream deletes + ingest/settle/reap sweeps`.

---

### Task 9: `VideoPlayer` shared component + hls.js

**Files:**
- Create: `packages/ui/VideoPlayer/index.tsx`
- Modify: root `package.json` (hls.js, exact pin)
- Test: `packages/ui/VideoPlayer/__tests__/index.test.tsx` (vitest glob `packages/**/__tests__/**` already picks this up)

**Interfaces:**
- Produces (imported as `@mesaas/ui/VideoPlayer` — the standalone-file pattern; NEVER import via the `packages/ui/index.ts` barrel and never use `@/` inside the package):

```tsx
export interface VideoPlayerProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> {
  hlsSrc?: string | null;   // tokenized HLS manifest URL; absent = plain video
  src: string;              // progressive fallback (current media-proxy URL)
  poster?: string;
  onFatalError?: () => void; // fires only when the FALLBACK source also errors
}
export function VideoPlayer(props: VideoPlayerProps): JSX.Element;
```

Implementation:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { VideoHTMLAttributes } from 'react';

type Mode = 'native-hls' | 'hlsjs' | 'fallback';

export function VideoPlayer({ hlsSrc, src, poster, onFatalError, ...rest }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>(() => {
    if (!hlsSrc) return 'fallback';
    const probe = document.createElement('video');
    return probe.canPlayType('application/vnd.apple.mpegurl') ? 'native-hls' : 'hlsjs';
  });

  useEffect(() => {
    if (mode !== 'hlsjs' || !hlsSrc) return;
    const el = videoRef.current;
    if (!el) return;
    let hls: { destroy(): void } | null = null;
    let cancelled = false;
    import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) { setMode('fallback'); return; }
      const instance = new Hls();
      hls = instance;
      instance.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) { instance.destroy(); hls = null; setMode('fallback'); }
      });
      instance.loadSource(hlsSrc);
      instance.attachMedia(el);
    }).catch(() => { if (!cancelled) setMode('fallback'); });
    return () => { cancelled = true; hls?.destroy(); };
  }, [mode, hlsSrc]);

  return (
    <video
      key={mode}
      ref={videoRef}
      src={mode === 'hlsjs' ? undefined : mode === 'native-hls' ? (hlsSrc ?? src) : src}
      poster={poster}
      onError={() => {
        if (mode === 'fallback') onFatalError?.();
        else setMode('fallback');
      }}
      {...rest}
    />
  );
}
```

- [ ] **Step 1: Pin hls.js** — `npm view hls.js version`, then add that exact version (no caret) to root `package.json` dependencies and `npm install`.
- [ ] **Step 2: Write failing tests** (jsdom; mock `hls.js` with `vi.mock`): no `hlsSrc` → renders `<video src={src}>`; `hlsSrc` + `canPlayType` stubbed truthy → `src={hlsSrc}`; `hlsSrc` + `canPlayType` falsy → hls.js mock's `loadSource`/`attachMedia` called; firing the mock's registered ERROR handler with `{fatal:true}` → element switches to `src={src}`; `onError` in fallback mode → `onFatalError` called; `onError` in native mode → switches to fallback, `onFatalError` NOT called.
- [ ] **Step 3: Run — expect FAIL.** `npm run test -- VideoPlayer`
- [ ] **Step 4: Implement, run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(stream): shared VideoPlayer (HLS + progressive fallback)`.

---

### Task 10: Hub integration

**Files:**
- Modify: `apps/hub/src/types.ts` (`HubPostMedia`, line 32)
- Modify: `apps/hub/src/components/PostMediaLightbox.tsx` (video branch, lines 143-152)
- Test: `apps/hub/src/components/__tests__/PostMediaLightbox.test.tsx` (extend)

**Interfaces:**
- Consumes: `playback` field (Task 5 response shape), `VideoPlayer` (Task 9).

Changes:
1. `HubPostMedia` gains `playback?: { hls: string; expires_at: string } | null;`.
2. Lightbox video branch becomes:

```tsx
<VideoPlayer
  key={current.id}
  hlsSrc={current.playback?.hls}
  src={current.url}
  poster={current.thumbnail_url ?? undefined}
  controls
  preload="auto"
  onFatalError={() => onStaleUrl?.()}
  className="max-h-[85vh] max-w-[90vw] object-contain"
/>
```

   with `import { VideoPlayer } from '@mesaas/ui/VideoPlayer';`. The existing `onStaleUrl` prop is the refetch-on-error path the spec requires — fatal fallback errors now route there instead of every error.
3. `VideoPrewarm` stays untouched (it warms the fallback URL; HLS startup does not need it).

- [ ] **Step 1: Extend the lightbox test**: media item WITH `playback` renders through VideoPlayer (assert the probe/canPlayType path or the rendered `src`); item without `playback` renders `src={url}` exactly as before; simulate fallback-mode error → `onStaleUrl` called.
- [ ] **Step 2: Run — expect FAIL**, implement, run — expect PASS. `npm run test -- PostMediaLightbox`
- [ ] **Step 3: Typecheck the hub** — `npx tsc -p apps/hub/tsconfig.json --noEmit`.
- [ ] **Step 4: Commit** — `feat(stream): hub lightbox plays HLS via VideoPlayer`.

---

### Task 11: CRM integration

**Files:**
- Modify: `apps/crm/src/store/posts.ts` (`PostMedia`, line 265)
- Modify: `apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx` (video branch, lines 92-100)
- Test: colocated `__tests__` if one exists for the CRM lightbox (`ls apps/crm/src/pages/entregas/components/__tests__/`); otherwise add `PostMediaLightbox.stream.test.tsx` there with the Task 10 cases adapted

**Interfaces:**
- Consumes: `playback` (Task 6 response shape), `VideoPlayer` (Task 9).

Changes:
1. `PostMedia` gains `playback?: { hls: string; expires_at: string } | null;` (optional — cached pre-deploy responses omit it, same convention as `origin`).
2. CRM entregas lightbox video branch → `VideoPlayer` with `hlsSrc={current.playback?.hls} src={current.url ?? ''} crossOrigin="anonymous" controls`, preserving the existing className/key.
3. **Deliberately unchanged** (record in the PR body): the muted preview tiles in `PostMediaGallery.tsx:702`, `ExpressPostPage.tsx:852` and `packages/ui/InstagramGrid` never play (no controls, no autoplay — they paint a poster frame), so they keep plain `<video>`; `ThumbnailPickerDialog` + `utils/videoFrame.ts` need the original file for canvas capture; downloads and IG/TikTok publishing keep the R2 original.

- [ ] **Step 1: Write/extend tests, run — expect FAIL.**
- [ ] **Step 2: Implement, run — expect PASS.** `npm run test -- PostMediaLightbox`
- [ ] **Step 3: Typecheck the CRM** — `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 4: Commit** — `feat(stream): CRM entregas lightbox plays HLS via VideoPlayer`.

---

### Task 12: Backfill + purge scripts, docs, full verification

**Files:**
- Create: `scripts/stream/backfill-stream-videos.ts`
- Create: `scripts/stream/purge-stream.ts`
- Modify: `tsconfig.scripts.json` (add `"scripts/stream/**/*.ts"` to `include`)
- Modify: `CLAUDE.md` (edge-function env var list: add the six `STREAM_*` vars with the split-gating one-liner)
- Modify: `README.md` (edge function count 54 → 55)

**Interfaces:**
- Consumes: Stream API + media-proxy HMAC URL format (`workers/media-proxy`), `files` columns (Task 1).

Both scripts are Node (18+, global fetch), run as `npx tsx scripts/stream/backfill-stream-videos.ts`, and read env from the process (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STREAM_ACCOUNT_ID`, `STREAM_API_TOKEN`, `MEDIA_WORKER_URL`, `MEDIA_SIGNING_KEY`). NEVER pass secrets as CLI args; source them via file redirection (`set -a; source <(cat .env.stream.local); set +a`).

`backfill-stream-videos.ts` logic:
1. `createClient(SUPABASE_URL, SERVICE_ROLE_KEY)`; page through `files` where `mime_type like 'video%'` and `stream_uid is null`, 50 per page, ordered by `id`.
2. Per row: `update files set stream_status='pending' where id=...`; build the copy source as a signed media-proxy URL (same HMAC as `_shared/media-url.ts`: `sig = hex(hmacSHA256(MEDIA_SIGNING_KEY, `${r2_key}:${exp}`))`, `exp = now + 900`, URL `${MEDIA_WORKER_URL}/${encodeURIComponent(r2_key)}?exp=${exp}&sig=${sig}`); POST the Stream copy with `meta { file_id, conta_id }` + `requireSignedURLs: true`; save the uid.
3. Throttle: `await new Promise(r => setTimeout(r, 1000))` between copies; log a per-row line and a final summary; a failed row logs and continues (idempotent: rerun skips rows that got a uid).

`purge-stream.ts` (full-teardown, spec §5.2): list all Stream videos (paginate `?asc=true&after=`), DELETE each, then `update files set stream_uid=null, stream_status=null where stream_uid is not null`. Prompt `continuar? (yes/NO)` on stdin before deleting anything.

- [ ] **Step 1: Write both scripts + tsconfig include.**
- [ ] **Step 2: Typecheck** — `npx tsc -p tsconfig.scripts.json`. (No unit tests: the scripts are one-shot operational tools; correctness is exercised on staging in the rollout.)
- [ ] **Step 3: Update CLAUDE.md + README.**
- [ ] **Step 4: Full verification gate** (fix anything red before continuing):

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git checkout -- deno.lock
git status
```

- [ ] **Step 5: Re-verify migration prefix against origin/main tail** (`git fetch origin main && git ls-tree --name-only origin/main:supabase/migrations | tail -3`) — renumber above the tail if main moved.
- [ ] **Step 6: Commit** — `feat(stream): backfill/purge scripts + env docs`, then invoke `superpowers:finishing-a-development-branch` (PR to main; Codex review auto-fires on `gh pr create` — verify its findings, don't rubber-stamp).

---

## Ops runbook (post-merge; owner actions marked 👤)

1. 👤 Enable Cloudflare Stream on the SAME account as R2 (dashboard; accepts $5/1,000-min storage billing).
2. 👤 Create the signing key once: `POST /accounts/{id}/stream/keys` → store `id` and the base64 `jwk`.
3. 👤 Configure the webhook in the Stream dashboard/API pointing at `https://<project>.supabase.co/functions/v1/stream-webhook`; store the returned secret.
4. Check the linked project before any deploy: `cat supabase/.temp/project-ref` (prod `skjzpekeqefvlojenfsw`, staging `wlyzhyfondykzpsiqsce`).
5. `npx supabase db push --linked` (staging first, then prod). Verify DDL applied AND history recorded separately.
6. Deploy functions with `--use-api`: `stream-webhook` (**`--no-verify-jwt`**), `file-upload-finalize`, `hub-posts` (`--no-verify-jwt`, hub), `post-media-manage`, `file-manage`, `post-media-cleanup-cron` (`--no-verify-jwt`, cron).
7. 👤 `npx supabase secrets set` the six `STREAM_*` vars (values via file, never CLI args) on staging; upload a real iPhone `.mov`, confirm `pending → ready`, play it on an actual phone; then set on prod.
8. Run the backfill script against staging, verify, then prod (275 videos ≈ 5 min at 1/s).
9. Monitor: Stream dashboard spend; cron-failure triage alerts already cover `post-media-cleanup-cron`. Kill switch: unset the four non-cleanup secrets (playback/ingest stop; queued deletions keep draining). Full teardown: `purge-stream.ts`, then unset everything.
