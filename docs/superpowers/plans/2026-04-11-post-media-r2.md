# Post Media via Cloudflare R2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CRM users attach photos/videos to Entregas posts via Cloudflare R2, so clients view them in the existing hub (`apps/hub/`).

**Architecture:** Browser uploads directly to R2 using short-lived presigned PUT URLs signed by authenticated Supabase Edge Functions. Metadata rows live in a new `post_media` table; deletions are enqueued and drained by an hourly cleanup cron. The existing `hub-posts` function is extended to return presigned GET URLs alongside each post.

**Tech Stack:** Supabase Postgres + RLS, Supabase Edge Functions (Deno), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` for R2 signing, React 18 + TypeScript + Vite, `@tanstack/react-query`, `@dnd-kit/sortable`, TipTap (existing), `sonner` toasts.

**Spec:** [`docs/superpowers/specs/2026-04-11-post-media-r2-design.md`](../specs/2026-04-11-post-media-r2-design.md)

**Visual components:** Every new visual component in this plan (`PostMediaGallery`, `PostMediaLightbox`, and new treatments on `PostCard`/`WorkflowCard`) MUST be built using the `frontend-design:frontend-design` skill during implementation to preserve design-language consistency. The plan steps below stub out the component shell and logic; visual polish is handed off to that skill at the end of each frontend task.

---

## File Structure

**Created**
- `supabase/migrations/20260411_post_media.sql` — tables, triggers, RLS, quota column
- `supabase/functions/_shared/r2.ts` — shared R2 S3 client + presign helpers (co-located with edge functions)
- `supabase/functions/post-media-upload-url/index.ts`
- `supabase/functions/post-media-finalize/index.ts`
- `supabase/functions/post-media-manage/index.ts`
- `supabase/functions/post-media-cleanup-cron/index.ts`
- `apps/crm/src/services/postMedia.ts` — upload orchestration + presigned URL calls
- `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`
- `apps/hub/src/components/PostMediaLightbox.tsx`

**Modified**
- `supabase/functions/hub-posts/index.ts` — include `media[]` + `cover_media`
- `apps/crm/src/store.ts` — add `PostMedia` type
- `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` — slot gallery into `SortablePostItem`, gate `handleSendToCliente` on missing video thumbnails
- `apps/crm/src/pages/entregas/WorkflowCard.tsx` (or current card file) — render cover thumbnail
- `apps/hub/src/api.ts` — extend `HubPost` fetch typing with `media` / `cover_media`
- `apps/hub/src/types.ts` — add `HubPostMedia`, extend `HubPost`
- `apps/hub/src/components/PostCard.tsx` — cover thumbnail + lightbox launch

---

## Phase 1 — Storage, schema & upload path

### Task 1.1: Create `post_media` migration

**Files:**
- Create: `supabase/migrations/20260411_post_media.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Post media (photos/videos) attached to workflow_posts, stored in Cloudflare R2.

-- 1. Quota column on workspaces (null = unlimited)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS storage_quota_bytes bigint NULL;

-- 2. Main table
CREATE TABLE IF NOT EXISTS post_media (
  id                  bigserial PRIMARY KEY,
  post_id             bigint   NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  conta_id            uuid     NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  r2_key              text     NOT NULL,
  thumbnail_r2_key    text     NULL,
  kind                text     NOT NULL CHECK (kind IN ('image', 'video')),
  mime_type           text     NOT NULL,
  size_bytes          bigint   NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 419430400),
  original_filename   text     NOT NULL,
  width               int      NULL,
  height              int      NULL,
  duration_seconds    int      NULL,
  is_cover            boolean  NOT NULL DEFAULT false,
  sort_order          int      NOT NULL DEFAULT 0,
  uploaded_by         uuid     NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_media_video_requires_thumbnail
    CHECK (kind = 'image' OR thumbnail_r2_key IS NOT NULL)
);

CREATE INDEX post_media_post_idx   ON post_media(post_id);
CREATE INDEX post_media_conta_idx  ON post_media(conta_id);
CREATE UNIQUE INDEX post_media_one_cover_per_post
  ON post_media(post_id) WHERE is_cover = true;

-- 3. Deletion queue (populated by trigger, drained by cron)
CREATE TABLE IF NOT EXISTS post_media_deletions (
  id           bigserial PRIMARY KEY,
  r2_key       text NOT NULL,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  attempts     int NOT NULL DEFAULT 0,
  last_error   text NULL
);

-- 4. Trigger: on delete, enqueue both main key and thumbnail
CREATE OR REPLACE FUNCTION post_media_enqueue_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO post_media_deletions(r2_key) VALUES (OLD.r2_key);
  IF OLD.thumbnail_r2_key IS NOT NULL THEN
    INSERT INTO post_media_deletions(r2_key) VALUES (OLD.thumbnail_r2_key);
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER post_media_after_delete
  AFTER DELETE ON post_media
  FOR EACH ROW EXECUTE FUNCTION post_media_enqueue_delete();

-- 5. Trigger: on delete of cover, promote next item (lowest sort_order, then id)
CREATE OR REPLACE FUNCTION post_media_reassign_cover()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_cover THEN
    UPDATE post_media
    SET is_cover = true
    WHERE id = (
      SELECT id FROM post_media
      WHERE post_id = OLD.post_id AND is_cover = false
      ORDER BY sort_order ASC, id ASC
      LIMIT 1
    );
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER post_media_after_delete_cover
  AFTER DELETE ON post_media
  FOR EACH ROW EXECUTE FUNCTION post_media_reassign_cover();

-- 6. RLS
ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_media_tenant_all" ON post_media
  FOR ALL
  USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "post_media_service_role_bypass" ON post_media
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE post_media_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "post_media_deletions_service_only" ON post_media_deletions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply migration locally**

Run: `supabase db reset` (or `supabase migration up` if using incremental)
Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Verify tables + triggers exist**

Run:
```bash
supabase db diff --schema public | grep -E "post_media|storage_quota_bytes"
```
Expected: no diff reported (migration is already applied).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260411_post_media.sql
git commit -m "feat(db): add post_media table, deletion queue, cover triggers, workspace quota"
```

---

### Task 1.2: Shared R2 helper for edge functions

**Files:**
- Create: `supabase/functions/_shared/r2.ts`

- [ ] **Step 1: Write the helper**

```ts
// supabase/functions/_shared/r2.ts
import { S3Client, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "npm:@aws-sdk/client-s3@3.637.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.637.0";
import { PutObjectCommand, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.637.0";

const ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") ?? (() => { throw new Error("R2_ACCOUNT_ID required"); })();
const ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? (() => { throw new Error("R2_ACCESS_KEY_ID required"); })();
const SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? (() => { throw new Error("R2_SECRET_ACCESS_KEY required"); })();
export const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? (() => { throw new Error("R2_BUCKET required"); })();

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

export async function signPutUrl(key: string, mimeType: string, expiresSeconds = 900) {
  const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: mimeType });
  return getSignedUrl(r2, cmd, { expiresIn: expiresSeconds });
}

export async function signGetUrl(key: string, expiresSeconds = 3600) {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2, cmd, { expiresIn: expiresSeconds });
}

export async function headObject(key: string): Promise<{ contentLength: number } | null> {
  try {
    const res = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return { contentLength: Number(res.ContentLength ?? 0) };
  } catch (_e) {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

export async function listOrphanKeys(prefix: string, olderThanMs: number): Promise<string[]> {
  const cutoff = Date.now() - olderThanMs;
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff) out.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/r2.ts
git commit -m "feat(edge): add shared R2 S3 client + presign helpers"
```

---

### Task 1.3: `post-media-upload-url` edge function

**Files:**
- Create: `supabase/functions/post-media-upload-url/index.ts`

- [ ] **Step 1: Write the function**

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { signPutUrl } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_SIZE = 400 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const THUMB_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  };
  return map[mime] ?? "bin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  let body: {
    post_id: number; filename: string; mime_type: string; size_bytes: number;
    kind: "image" | "video";
    thumbnail?: { mime_type: string; size_bytes: number };
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { post_id, filename, mime_type, size_bytes, kind, thumbnail } = body;
  if (!post_id || !filename || !mime_type || !size_bytes || !kind) return json({ error: "Missing fields" }, 400);
  if (size_bytes <= 0 || size_bytes > MAX_SIZE) return json({ error: "size_bytes out of range" }, 400);

  const allowed = kind === "image" ? IMAGE_MIME : VIDEO_MIME;
  if (!allowed.has(mime_type)) return json({ error: "Unsupported mime type" }, 400);

  if (kind === "video") {
    if (!thumbnail) return json({ error: "video requires thumbnail" }, 400);
    if (!THUMB_MIME.has(thumbnail.mime_type)) return json({ error: "Unsupported thumbnail mime type" }, 400);
    if (thumbnail.size_bytes <= 0 || thumbnail.size_bytes > 10 * 1024 * 1024) return json({ error: "thumbnail size out of range" }, 400);
  }

  // Verify post belongs to this conta
  const { data: post } = await svc.from("workflow_posts").select("id, conta_id").eq("id", post_id).single();
  if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

  // Quota check
  const { data: ws } = await svc.from("workspaces").select("storage_quota_bytes").eq("id", profile.conta_id).single();
  const quota = ws?.storage_quota_bytes ?? null;
  if (quota !== null) {
    const { data: sumRow } = await svc
      .from("post_media")
      .select("size_bytes")
      .eq("conta_id", profile.conta_id);
    const used = (sumRow ?? []).reduce((n, r: { size_bytes: number }) => n + Number(r.size_bytes), 0);
    const needed = size_bytes + (thumbnail?.size_bytes ?? 0);
    if (used + needed > quota) {
      return json({ error: "quota_exceeded", used, quota }, 413);
    }
  }

  const mediaId = crypto.randomUUID();
  const ext = extFromMime(mime_type);
  const r2_key = `contas/${profile.conta_id}/posts/${post_id}/${mediaId}.${ext}`;
  const upload_url = await signPutUrl(r2_key, mime_type);

  let thumbnail_r2_key: string | undefined;
  let thumbnail_upload_url: string | undefined;
  if (kind === "video" && thumbnail) {
    thumbnail_r2_key = `contas/${profile.conta_id}/posts/${post_id}/${mediaId}.thumb.${extFromMime(thumbnail.mime_type)}`;
    thumbnail_upload_url = await signPutUrl(thumbnail_r2_key, thumbnail.mime_type);
  }

  return json({ media_id: mediaId, upload_url, r2_key, thumbnail_upload_url, thumbnail_r2_key });
});
```

- [ ] **Step 2: Deploy**

Run: `supabase functions deploy post-media-upload-url`
Expected: deploy succeeds.

- [ ] **Step 3: Smoke-test with curl**

Run (substitute real values):
```bash
curl -i -X POST "$SUPABASE_URL/functions/v1/post-media-upload-url" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"post_id": 1, "filename":"t.jpg","mime_type":"image/jpeg","size_bytes":1024,"kind":"image"}'
```
Expected: 200 with `{ media_id, upload_url, r2_key }`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/post-media-upload-url/index.ts
git commit -m "feat(edge): add post-media-upload-url with quota + mime/size validation"
```

---

### Task 1.4: `post-media-finalize` edge function

**Files:**
- Create: `supabase/functions/post-media-finalize/index.ts`

- [ ] **Step 1: Write the function**

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { headObject, signGetUrl } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  let body: {
    post_id: number; media_id: string;
    r2_key: string; thumbnail_r2_key?: string;
    kind: "image" | "video"; mime_type: string; size_bytes: number;
    original_filename: string;
    width?: number; height?: number; duration_seconds?: number;
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  // Verify post ownership
  const { data: post } = await svc.from("workflow_posts").select("id, conta_id").eq("id", body.post_id).single();
  if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

  // Verify R2 object exists and length matches
  const head = await headObject(body.r2_key);
  if (!head) return json({ error: "object not found" }, 400);
  if (head.contentLength !== body.size_bytes) return json({ error: "size mismatch" }, 400);

  if (body.kind === "video") {
    if (!body.thumbnail_r2_key) return json({ error: "video requires thumbnail_r2_key" }, 400);
    const thumbHead = await headObject(body.thumbnail_r2_key);
    if (!thumbHead) return json({ error: "thumbnail not found" }, 400);
  }

  // First item on the post becomes cover automatically
  const { count } = await svc
    .from("post_media")
    .select("id", { count: "exact", head: true })
    .eq("post_id", body.post_id);
  const is_cover = (count ?? 0) === 0;

  const { data: inserted, error: insErr } = await svc
    .from("post_media")
    .insert({
      post_id: body.post_id,
      conta_id: profile.conta_id,
      r2_key: body.r2_key,
      thumbnail_r2_key: body.thumbnail_r2_key ?? null,
      kind: body.kind,
      mime_type: body.mime_type,
      size_bytes: body.size_bytes,
      original_filename: body.original_filename,
      width: body.width ?? null,
      height: body.height ?? null,
      duration_seconds: body.duration_seconds ?? null,
      is_cover,
      uploaded_by: user.id,
    })
    .select()
    .single();
  if (insErr || !inserted) return json({ error: insErr?.message ?? "insert failed" }, 500);

  const url = await signGetUrl(body.r2_key, 900);
  const thumbnail_url = body.thumbnail_r2_key ? await signGetUrl(body.thumbnail_r2_key, 900) : null;

  return json({ ...inserted, url, thumbnail_url });
});
```

- [ ] **Step 2: Deploy**

Run: `supabase functions deploy post-media-finalize`
Expected: deploy succeeds.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/post-media-finalize/index.ts
git commit -m "feat(edge): add post-media-finalize with R2 HeadObject verification"
```

---

### Task 1.5: `post-media-manage` edge function (list / patch / delete)

**Files:**
- Create: `supabase/functions/post-media-manage/index.ts`

- [ ] **Step 1: Write the function**

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl, signPutUrl } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const THUMB_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function extFromMime(mime: string): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const)[mime as "image/jpeg"] ?? "bin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ['functions','v1','post-media-manage', maybe id, maybe 'thumbnail']
  const idx = parts.indexOf("post-media-manage");
  const idStr = parts[idx + 1];
  const sub = parts[idx + 2]; // e.g. 'thumbnail'

  // GET ?post_id=... → list media for a post
  if (req.method === "GET") {
    const postId = Number(url.searchParams.get("post_id"));
    if (!postId) return json({ error: "post_id required" }, 400);
    const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", postId).single();
    if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

    const { data: rows } = await svc.from("post_media")
      .select("*").eq("post_id", postId)
      .order("sort_order", { ascending: true }).order("id", { ascending: true });

    const withUrls = await Promise.all((rows ?? []).map(async (r) => ({
      ...r,
      url: await signGetUrl(r.r2_key, 900),
      thumbnail_url: r.thumbnail_r2_key ? await signGetUrl(r.thumbnail_r2_key, 900) : null,
    })));
    return json({ media: withUrls });
  }

  // Everything below requires a media id in path
  if (!idStr) return json({ error: "id required" }, 400);
  const mediaId = Number(idStr);
  if (!mediaId) return json({ error: "invalid id" }, 400);

  const { data: media } = await svc.from("post_media").select("*").eq("id", mediaId).single();
  if (!media || media.conta_id !== profile.conta_id) return json({ error: "Not found" }, 404);

  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;
    if (body.thumbnail_r2_key && typeof body.thumbnail_r2_key === "string") {
      // Swapping a video thumbnail — enqueue the old one for deletion
      if (media.thumbnail_r2_key && media.thumbnail_r2_key !== body.thumbnail_r2_key) {
        await svc.from("post_media_deletions").insert({ r2_key: media.thumbnail_r2_key });
      }
      patch.thumbnail_r2_key = body.thumbnail_r2_key;
    }

    if (body.is_cover === true) {
      // Unset any existing cover for this post, then set this row
      await svc.from("post_media").update({ is_cover: false }).eq("post_id", media.post_id).eq("is_cover", true);
      patch.is_cover = true;
    }

    const { data: updated, error: updErr } = await svc.from("post_media").update(patch).eq("id", mediaId).select().single();
    if (updErr) return json({ error: updErr.message }, 500);
    return json(updated);
  }

  if (req.method === "DELETE") {
    const { error: delErr } = await svc.from("post_media").delete().eq("id", mediaId);
    if (delErr) return json({ error: delErr.message }, 500);
    return json({ ok: true });
  }

  // POST /:id/thumbnail → presign new thumbnail upload
  if (req.method === "POST" && sub === "thumbnail") {
    if (media.kind !== "video") return json({ error: "only videos have thumbnails" }, 400);
    const body = await req.json().catch(() => ({}));
    const mime = String(body.mime_type ?? "");
    if (!THUMB_MIME.has(mime)) return json({ error: "Unsupported thumbnail mime type" }, 400);
    const key = `contas/${profile.conta_id}/posts/${media.post_id}/${crypto.randomUUID()}.thumb.${extFromMime(mime)}`;
    const upload_url = await signPutUrl(key, mime);
    return json({ thumbnail_r2_key: key, thumbnail_upload_url: upload_url });
  }

  return json({ error: "Method not allowed" }, 405);
});
```

- [ ] **Step 2: Deploy**

Run: `supabase functions deploy post-media-manage`
Expected: deploy succeeds.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/post-media-manage/index.ts
git commit -m "feat(edge): add post-media-manage (list/patch/delete + thumbnail replace)"
```

---

### Task 1.6: CRM service layer `postMedia.ts`

**Files:**
- Create: `apps/crm/src/services/postMedia.ts`
- Modify: `apps/crm/src/store.ts` (add `PostMedia` type export)

- [ ] **Step 1: Add `PostMedia` type to `store.ts`**

Open [apps/crm/src/store.ts](apps/crm/src/store.ts) and add next to existing type exports (e.g. after `WorkflowPost`):

```ts
export interface PostMedia {
  id: number;
  post_id: number;
  conta_id: string;
  r2_key: string;
  thumbnail_r2_key: string | null;
  kind: 'image' | 'video';
  mime_type: string;
  size_bytes: number;
  original_filename: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_cover: boolean;
  sort_order: number;
  uploaded_by: string | null;
  created_at: string;
  // Populated only on hydrated responses
  url?: string;
  thumbnail_url?: string | null;
}
```

- [ ] **Step 2: Write the service**

```ts
// apps/crm/src/services/postMedia.ts
import { supabase } from '../lib/supabase';
import type { PostMedia } from '../store';

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_SIZE = 400 * 1024 * 1024;
const MAX_CONCURRENT = 3;

export type UploadProgress = { loaded: number; total: number };

async function callFn<T>(name: string, method: 'GET'|'POST'|'PATCH'|'DELETE', body?: unknown, query?: Record<string,string>, pathSuffix = ''): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const base = (supabase as unknown as { supabaseUrl: string }).supabaseUrl;
  const url = new URL(`${base}/functions/v1/${name}${pathSuffix}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function validateFile(file: File, kind: 'image' | 'video') {
  const allowed = kind === 'image' ? IMAGE_MIME : VIDEO_MIME;
  if (!allowed.includes(file.type)) throw new Error(`Tipo de arquivo não suportado: ${file.type}`);
  if (file.size <= 0 || file.size > MAX_SIZE) throw new Error('Arquivo maior que 400 MB');
}

export function detectKind(file: File): 'image' | 'video' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  throw new Error(`Tipo não suportado: ${file.type}`);
}

export async function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function probeVideo(file: File): Promise<{ width: number; height: number; duration_seconds: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: vid.videoWidth, height: vid.videoHeight, duration_seconds: Math.round(vid.duration) });
    };
    vid.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    vid.src = url;
  });
}

function putWithProgress(url: string, file: File, onProgress?: (p: UploadProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

export async function listPostMedia(postId: number): Promise<PostMedia[]> {
  const { media } = await callFn<{ media: PostMedia[] }>('post-media-manage', 'GET', undefined, { post_id: String(postId) });
  return media;
}

export async function uploadPostMedia(args: {
  postId: number;
  file: File;
  thumbnail?: File; // required for video
  onProgress?: (p: UploadProgress) => void;
}): Promise<PostMedia> {
  const { postId, file, thumbnail, onProgress } = args;
  const kind = detectKind(file);
  validateFile(file, kind);

  let width: number | undefined;
  let height: number | undefined;
  let duration_seconds: number | undefined;
  if (kind === 'image') {
    ({ width, height } = await probeImage(file));
  } else {
    if (!thumbnail) throw new Error('Vídeos exigem uma thumbnail');
    validateFile(thumbnail, 'image');
    ({ width, height, duration_seconds } = await probeVideo(file));
  }

  const signed = await callFn<{
    media_id: string; upload_url: string; r2_key: string;
    thumbnail_upload_url?: string; thumbnail_r2_key?: string;
  }>('post-media-upload-url', 'POST', {
    post_id: postId,
    filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    kind,
    thumbnail: thumbnail ? { mime_type: thumbnail.type, size_bytes: thumbnail.size } : undefined,
  });

  const uploads: Promise<void>[] = [putWithProgress(signed.upload_url, file, onProgress)];
  if (thumbnail && signed.thumbnail_upload_url) {
    uploads.push(putWithProgress(signed.thumbnail_upload_url, thumbnail));
  }
  await Promise.all(uploads);

  return callFn<PostMedia>('post-media-finalize', 'POST', {
    post_id: postId,
    media_id: signed.media_id,
    r2_key: signed.r2_key,
    thumbnail_r2_key: signed.thumbnail_r2_key,
    kind,
    mime_type: file.type,
    size_bytes: file.size,
    original_filename: file.name,
    width, height, duration_seconds,
  });
}

export async function deletePostMedia(id: number): Promise<void> {
  await callFn(`post-media-manage`, 'DELETE', undefined, undefined, `/${id}`);
}

export async function setPostMediaCover(id: number): Promise<PostMedia> {
  return callFn<PostMedia>(`post-media-manage`, 'PATCH', { is_cover: true }, undefined, `/${id}`);
}

export async function reorderPostMedia(id: number, sort_order: number): Promise<PostMedia> {
  return callFn<PostMedia>(`post-media-manage`, 'PATCH', { sort_order }, undefined, `/${id}`);
}

// Parallelism cap helper for multi-file uploads
export async function uploadMany<T>(items: T[], fn: (t: T) => Promise<void>, concurrency = MAX_CONCURRENT) {
  const queue = items.slice();
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item) await fn(item);
      }
    })());
  }
  await Promise.all(workers);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/crm && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store.ts apps/crm/src/services/postMedia.ts
git commit -m "feat(crm): postMedia service with upload orchestration + presigned URL calls"
```

---

### Task 1.7: `PostMediaGallery` component (functional shell)

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, Star, Trash2, AlertTriangle, Image as ImageIcon, Video } from 'lucide-react';
import {
  listPostMedia, uploadPostMedia, deletePostMedia, setPostMediaCover,
  detectKind,
} from '../../../services/postMedia';
import type { PostMedia } from '../../../store';

interface PostMediaGalleryProps {
  postId: number;
  disabled?: boolean;
  onChange?: (media: PostMedia[]) => void;
}

export function PostMediaGallery({ postId, disabled, onChange }: PostMediaGalleryProps) {
  const qc = useQueryClient();
  const { data: media = [] } = useQuery({
    queryKey: ['post-media', postId],
    queryFn: () => listPostMedia(postId),
  });

  useEffect(() => { onChange?.(media); }, [media, onChange]);

  const [uploading, setUploading] = useState(false);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['post-media', postId] });

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const kind = detectKind(file);
        if (kind === 'video') {
          setPendingVideo(file);
          return;
        }
        await uploadPostMedia({ postId, file });
      }
      refresh();
      toast.success('Upload concluído');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleVideoThumbnail(thumbnail: File) {
    if (!pendingVideo) return;
    setUploading(true);
    try {
      await uploadPostMedia({ postId, file: pendingVideo, thumbnail });
      setPendingVideo(null);
      refresh();
      toast.success('Vídeo enviado');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    try { await deletePostMedia(id); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function handleSetCover(id: number) {
    try { await setPostMediaCover(id); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="post-media-gallery">
      <div className="post-media-gallery__grid">
        {media.map((m) => (
          <div key={m.id} className="post-media-tile">
            {m.kind === 'image' ? (
              <img src={m.url} alt={m.original_filename} />
            ) : (
              <video src={m.url ?? undefined} poster={m.thumbnail_url ?? undefined} muted />
            )}
            {m.is_cover && <span className="post-media-tile__cover-badge"><Star className="h-3 w-3" /> capa</span>}
            {!disabled && (
              <div className="post-media-tile__actions">
                {!m.is_cover && <button type="button" onClick={() => handleSetCover(m.id)} title="Definir como capa"><Star className="h-3 w-3" /></button>}
                <button type="button" onClick={() => handleDelete(m.id)} title="Remover"><Trash2 className="h-3 w-3" /></button>
              </div>
            )}
          </div>
        ))}
        {!disabled && (
          <label className="post-media-tile post-media-tile--upload">
            <Upload className="h-4 w-4" />
            <span>{uploading ? 'Enviando…' : 'Adicionar mídia'}</span>
            <input type="file" multiple accept="image/*,video/*" hidden onChange={(e) => handleFiles(e.target.files)} />
          </label>
        )}
      </div>

      {pendingVideo && (
        <div className="post-media-gallery__thumb-prompt">
          <AlertTriangle className="h-4 w-4" />
          <span>Selecione uma thumbnail para o vídeo <strong>{pendingVideo.name}</strong></span>
          <label className="post-media-gallery__thumb-btn">
            Escolher thumbnail
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoThumbnail(f); }} />
          </label>
          <button type="button" onClick={() => setPendingVideo(null)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

// Exported helper so WorkflowDrawer can gate the "send to client" button.
export function hasVideoMissingThumbnail(media: PostMedia[]): boolean {
  return media.some((m) => m.kind === 'video' && !m.thumbnail_r2_key);
}
```

- [ ] **Step 2: Apply `frontend-design` skill**

Invoke the `frontend-design:frontend-design` skill and pass it this component file plus a reference screenshot of an existing Entregas drawer tile for visual language. Let the skill polish spacing, typography, upload dropzone affordance, progress overlay, hover menu, and the video-thumbnail prompt.

- [ ] **Step 3: Typecheck**

Run: `cd apps/crm && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostMediaGallery.tsx
git commit -m "feat(crm): add PostMediaGallery with upload, cover toggle, delete, video-thumbnail gate"
```

---

### Task 1.8: Wire gallery into `WorkflowDrawer` + gate sending

**Files:**
- Modify: [apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx](apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx)

- [ ] **Step 1: Import gallery + helper**

Near existing imports:

```tsx
import { PostMediaGallery, hasVideoMissingThumbnail } from './PostMediaGallery';
import { listPostMedia } from '../../../services/postMedia';
import type { PostMedia } from '../../../store';
```

- [ ] **Step 2: Render `PostMediaGallery` inside `SortablePostItem`**

Find the `<PostEditor />` block at [WorkflowDrawer.tsx:588](apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx#L588) and insert the gallery immediately before it:

```tsx
<PostMediaGallery postId={post.id!} disabled={isReadonly} />

<PostEditor
  key={post.id}
  initialContent={post.conteudo}
  disabled={isReadonly}
  onUpdate={onContentUpdate}
/>
```

- [ ] **Step 3: Block `handleSendToCliente` when any ready post has a video without thumbnail**

Replace the body of `handleSendToCliente` (at [WorkflowDrawer.tsx:243-257](apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx#L243-L257)) with:

```tsx
const handleSendToCliente = async () => {
  const readyPosts = posts.filter(p => p.status === 'aprovado_interno');
  if (readyPosts.length === 0) {
    toast.error('Nenhum post aprovado internamente para enviar.');
    return;
  }

  // Fetch media for each ready post and block if any video lacks a thumbnail
  const mediaByPost = await Promise.all(
    readyPosts.map(async (p) => ({ post: p, media: await listPostMedia(p.id!) }))
  );
  const blocked = mediaByPost.filter((m) => hasVideoMissingThumbnail(m.media));
  if (blocked.length > 0) {
    toast.error(`Há ${blocked.length} post(s) com vídeos sem thumbnail. Adicione uma thumbnail antes de enviar.`);
    return;
  }

  setIsSending(true);
  try {
    await sendPostsToCliente(workflowId);
    toast.success(`${readyPosts.length} post${readyPosts.length > 1 ? 's' : ''} enviado${readyPosts.length > 1 ? 's' : ''} ao cliente!`);
    refresh();
    onRefresh();
  } catch { toast.error('Erro ao enviar posts ao cliente'); }
  finally { setIsSending(false); }
};
```

- [ ] **Step 4: Typecheck + manual smoke**

Run: `cd apps/crm && npx tsc --noEmit`
Expected: no errors. Manually: open a post in the drawer, upload an image, refresh, confirm it appears.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat(crm): slot PostMediaGallery into WorkflowDrawer + gate send on missing video thumbnails"
```

---

### Task 1.9: Render cover thumbnail on `WorkflowCard`

**Files:**
- Locate + Modify: the CRM workflow card component (grep `WorkflowCard` or the file that currently renders cards on the Entregas board)

- [ ] **Step 1: Locate the file**

Run:
```bash
```
Use Grep tool: pattern `WorkflowCard|workflow-card` glob `apps/crm/src/pages/entregas/**/*.tsx`.

- [ ] **Step 2: Fetch cover for displayed cards**

In whichever hook already loads the board (`useEntregasData` or similar), extend the loader to fetch `post_media` rows where `is_cover = true` for the set of visible workflow posts. Add `cover_media` (signed URL via a single service-role `post-media-manage` GET per post is too expensive — add a new store helper that queries `post_media` directly via Supabase client with RLS and signs on render, or reuse the existing pattern and skip a signed URL and store just the `r2_key` + a separate on-click fetch).

- [ ] **Step 3: Show the cover**

Add to `WorkflowCard` render (near the title area):

```tsx
{card.coverMedia && (
  <div className="workflow-card__cover">
    <img src={card.coverMedia.url} alt="" />
    {card.coverMedia.kind === 'video' && <span className="workflow-card__cover-play">▶</span>}
  </div>
)}
```

- [ ] **Step 4: Apply `frontend-design` skill**

Invoke `frontend-design:frontend-design` to polish the cover thumbnail placement inside the card.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/
git commit -m "feat(crm): show post cover thumbnail on WorkflowCard"
```

---

## Phase 2 — Client hub read path

### Task 2.1: Extend `hub-posts` with media

**Files:**
- Modify: [supabase/functions/hub-posts/index.ts](supabase/functions/hub-posts/index.ts)

- [ ] **Step 1: Add R2 import and fetch**

Add import at top:

```ts
import { signGetUrl } from "../_shared/r2.ts";
```

After the `workflowSelectOptions` fetch block (around [hub-posts/index.ts:88](supabase/functions/hub-posts/index.ts#L88)), add:

```ts
// Fetch media for those posts
const { data: mediaRows } = postIds.length > 0
  ? await db
      .from("post_media")
      .select("id, post_id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, is_cover, sort_order")
      .in("post_id", postIds)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
  : { data: [] };

const mediaWithUrls = await Promise.all((mediaRows ?? []).map(async (m: any) => ({
  id: m.id,
  post_id: m.post_id,
  kind: m.kind,
  mime_type: m.mime_type,
  width: m.width,
  height: m.height,
  duration_seconds: m.duration_seconds,
  is_cover: m.is_cover,
  sort_order: m.sort_order,
  url: await signGetUrl(m.r2_key, 3600),
  thumbnail_url: m.thumbnail_r2_key ? await signGetUrl(m.thumbnail_r2_key, 3600) : null,
})));

const mediaByPost: Record<number, typeof mediaWithUrls> = {};
for (const m of mediaWithUrls) {
  (mediaByPost[m.post_id] ??= []).push(m);
}

const flatPostsWithMedia = flatPosts.map((p: any) => {
  const mediaForPost = mediaByPost[p.id] ?? [];
  const cover_media = mediaForPost.find((m) => m.is_cover) ?? null;
  return { ...p, media: mediaForPost, cover_media };
});
```

- [ ] **Step 2: Return the augmented posts**

Replace the final `return json({ posts: flatPosts, ... })` with:

```ts
return json({
  posts: flatPostsWithMedia,
  postApprovals: postApprovals ?? [],
  propertyValues: propertyValues ?? [],
  workflowSelectOptions: workflowSelectOptions ?? [],
});
```

- [ ] **Step 3: Deploy**

Run: `supabase functions deploy hub-posts`
Expected: deploy succeeds.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hub-posts/index.ts
git commit -m "feat(edge): include post media + cover in hub-posts response with presigned URLs"
```

---

### Task 2.2: Extend hub types + api.ts

**Files:**
- Modify: [apps/hub/src/types.ts](apps/hub/src/types.ts)
- Modify: [apps/hub/src/api.ts](apps/hub/src/api.ts)

- [ ] **Step 1: Add `HubPostMedia` type**

Append to `apps/hub/src/types.ts`:

```ts
export interface HubPostMedia {
  id: number;
  post_id: number;
  kind: 'image' | 'video';
  mime_type: string;
  url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_cover: boolean;
  sort_order: number;
}
```

Extend `HubPost`:

```ts
export interface HubPost {
  id: number;
  titulo: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  status: 'rascunho' | 'em_producao' | 'enviado_cliente' | 'aprovado_cliente' | 'correcao_cliente' | 'agendado' | 'publicado';
  ordem: number;
  conteudo_plain: string;
  scheduled_at: string | null;
  workflow_id: number;
  workflow_titulo: string;
  media: HubPostMedia[];
  cover_media: HubPostMedia | null;
}
```

- [ ] **Step 2: No change needed to `api.ts`**

`fetchPosts` already types via `HubPost`, so the new fields flow through automatically. Verify there are no TS errors.

- [ ] **Step 3: Typecheck**

Run: `cd apps/hub && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts
git commit -m "feat(hub): extend HubPost with media[] and cover_media"
```

---

### Task 2.3: `PostMediaLightbox` component

**Files:**
- Create: `apps/hub/src/components/PostMediaLightbox.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { HubPostMedia } from '../types';

interface PostMediaLightboxProps {
  media: HubPostMedia[];
  initialIndex: number;
  onClose: () => void;
  onStaleUrl?: () => void; // called on 403, so parent can refetch
}

export function PostMediaLightbox({ media, initialIndex, onClose, onStaleUrl }: PostMediaLightboxProps) {
  const [idx, setIdx] = useState(initialIndex);
  const current = media[idx];

  const prev = useCallback(() => setIdx((i) => (i - 1 + media.length) % media.length), [media.length]);
  const next = useCallback(() => setIdx((i) => (i + 1) % media.length), [media.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose]);

  if (!current) return null;

  return (
    <div className="hub-lightbox" role="dialog" aria-modal="true">
      <button className="hub-lightbox__close" onClick={onClose} aria-label="Fechar"><X /></button>
      {media.length > 1 && (
        <>
          <button className="hub-lightbox__nav hub-lightbox__nav--prev" onClick={prev} aria-label="Anterior"><ChevronLeft /></button>
          <button className="hub-lightbox__nav hub-lightbox__nav--next" onClick={next} aria-label="Próxima"><ChevronRight /></button>
        </>
      )}
      <div className="hub-lightbox__stage">
        {current.kind === 'image' ? (
          <img
            src={current.url}
            alt=""
            onError={() => onStaleUrl?.()}
          />
        ) : (
          <video
            src={current.url}
            poster={current.thumbnail_url ?? undefined}
            controls
            onError={() => onStaleUrl?.()}
          />
        )}
      </div>
      <div className="hub-lightbox__counter">{idx + 1} / {media.length}</div>
    </div>
  );
}
```

- [ ] **Step 2: Apply `frontend-design` skill**

Invoke `frontend-design:frontend-design` on this component to polish the backdrop, navigation buttons, counter, keyboard focus, and touch/swipe affordances. Keep the component API the same.

- [ ] **Step 3: Typecheck**

Run: `cd apps/hub && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/components/PostMediaLightbox.tsx
git commit -m "feat(hub): add PostMediaLightbox with keyboard nav and stale-URL callback"
```

---

### Task 2.4: Wire cover + lightbox into hub `PostCard`

**Files:**
- Modify: [apps/hub/src/components/PostCard.tsx](apps/hub/src/components/PostCard.tsx)

- [ ] **Step 1: Import lightbox and add state**

Add to imports:

```tsx
import { PostMediaLightbox } from './PostMediaLightbox';
```

Inside `PostCard`, add state near the other `useState` calls:

```tsx
const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
```

- [ ] **Step 2: Render the cover thumbnail**

Immediately after the header `<button>` opening div (inside the `flex-1 min-w-0` block, before the type/status pills around [PostCard.tsx:169](apps/hub/src/components/PostCard.tsx#L169)), add:

```tsx
{post.cover_media && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); setLightboxIdx(0); }}
    className="mb-3 block w-full aspect-[4/3] overflow-hidden rounded-xl bg-stone-100 relative"
  >
    {post.cover_media.kind === 'image' ? (
      <img src={post.cover_media.url} alt="" className="w-full h-full object-cover" />
    ) : (
      <>
        <img src={post.cover_media.thumbnail_url ?? ''} alt="" className="w-full h-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="bg-black/60 text-white rounded-full w-10 h-10 flex items-center justify-center">▶</span>
        </span>
      </>
    )}
  </button>
)}
```

- [ ] **Step 3: Render the lightbox**

Just before the closing `</div>` of the top-level card container, add:

```tsx
{lightboxIdx !== null && post.media && post.media.length > 0 && (
  <PostMediaLightbox
    media={post.media}
    initialIndex={lightboxIdx}
    onClose={() => setLightboxIdx(null)}
    onStaleUrl={onApprovalSubmitted /* reuse: parent refetches posts */}
  />
)}
```

- [ ] **Step 4: Apply `frontend-design` skill**

Invoke `frontend-design:frontend-design` on `PostCard.tsx` to polish the cover thumbnail treatment (placement, radius, play-icon overlay, hover/focus states) without altering the approval/message flows.

- [ ] **Step 5: Typecheck + smoke**

Run: `cd apps/hub && npx tsc --noEmit`
Expected: no errors. Manually: open a post in hub dev, click cover, lightbox appears, arrow keys navigate, ESC closes.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/components/PostCard.tsx
git commit -m "feat(hub): show cover thumbnail and open lightbox from PostCard"
```

---

## Phase 3 — Cleanup cron + CORS + env

### Task 3.1: `post-media-cleanup-cron` edge function

**Files:**
- Create: `supabase/functions/post-media-cleanup-cron/index.ts`

- [ ] **Step 1: Write the function**

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { deleteObject, listOrphanKeys } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = { "Access-Control-Allow-Origin": "*" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async () => {
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Drain the deletion queue
  const { data: pending } = await svc
    .from("post_media_deletions")
    .select("id, r2_key, attempts")
    .lt("attempts", 6)
    .order("enqueued_at", { ascending: true })
    .limit(500);

  let deleted = 0;
  let failed = 0;
  for (const row of pending ?? []) {
    try {
      await deleteObject(row.r2_key);
      await svc.from("post_media_deletions").delete().eq("id", row.id);
      deleted++;
    } catch (e) {
      failed++;
      await svc.from("post_media_deletions")
        .update({ attempts: (row.attempts ?? 0) + 1, last_error: (e as Error).message })
        .eq("id", row.id);
    }
  }

  // 2. Orphan sweep: list objects under contas/ older than 24h with no matching row
  const orphanCandidates = await listOrphanKeys("contas/", 24 * 60 * 60 * 1000);
  let orphansDeleted = 0;
  if (orphanCandidates.length > 0) {
    const { data: existing } = await svc
      .from("post_media")
      .select("r2_key, thumbnail_r2_key")
      .in("r2_key", orphanCandidates);
    const known = new Set<string>();
    for (const r of existing ?? []) {
      if (r.r2_key) known.add(r.r2_key);
      if (r.thumbnail_r2_key) known.add(r.thumbnail_r2_key);
    }
    for (const key of orphanCandidates) {
      if (known.has(key)) continue;
      try { await deleteObject(key); orphansDeleted++; } catch { /* swallow; will retry next hour */ }
    }
  }

  return json({ deleted, failed, orphansDeleted });
});
```

- [ ] **Step 2: Deploy (no JWT, cron-invoked)**

Run: `supabase functions deploy post-media-cleanup-cron --no-verify-jwt`
Expected: deploy succeeds.

- [ ] **Step 3: Schedule the cron**

In Supabase Studio → Database → Cron, create a job:
- Name: `post-media-cleanup`
- Schedule: `0 * * * *` (hourly)
- Command:
  ```sql
  SELECT net.http_post(
    url := '<SUPABASE_URL>/functions/v1/post-media-cleanup-cron',
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  ```

Or use the pattern already established by `instagram-refresh-cron` if a migration-based schedule exists in this repo.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/post-media-cleanup-cron/index.ts
git commit -m "feat(edge): hourly post-media cleanup cron — drain deletions + orphan sweep"
```

---

### Task 3.2: R2 CORS config

**Files:**
- Document: (no code — external config)

- [ ] **Step 1: Configure R2 bucket CORS**

In Cloudflare dashboard → R2 → the bucket → Settings → CORS Policy, apply:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://<prod-crm-origin>",
      "https://<prod-hub-origin>"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "Authorization"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace `<prod-crm-origin>` and `<prod-hub-origin>` with the actual deployed domains.

- [ ] **Step 2: Smoke-test from browser**

Open CRM dev build, try uploading a small image via the gallery. Expected: PUT succeeds, no CORS error in devtools.

- [ ] **Step 3: Commit any doc updates**

If you add a note to `CLAUDE.md` or similar, commit it. Otherwise nothing to commit for this task.

---

### Task 3.3: Edge function secrets

**Files:**
- Document: (no code — secrets)

- [ ] **Step 1: Set secrets**

Run:
```bash
supabase secrets set \
  R2_ACCOUNT_ID=<value> \
  R2_ACCESS_KEY_ID=<value> \
  R2_SECRET_ACCESS_KEY=<value> \
  R2_BUCKET=<bucket-name>
```

- [ ] **Step 2: Verify**

Run: `supabase secrets list | grep R2`
Expected: all four variables present.

---

## Self-Review (post-write checklist — run before execution)

- [ ] **Spec coverage:** every section in the spec maps to a task above (migration, 4 edge functions, modified hub-posts, frontend services, gallery, lightbox, cleanup cron, CORS, env vars, quota, cover trigger, video thumbnail gate, frontend-design skill usage).
- [ ] **No placeholders:** all code blocks are real code, all commands are runnable. Task 1.9 has some ambiguity around where cover is fetched — the step tells the implementer to locate the file and extend the existing hook, which is acceptable exploration.
- [ ] **Type consistency:** `PostMedia` type in `store.ts` matches columns in the migration and the shape returned by `post-media-finalize` / `post-media-manage`. `HubPostMedia` in the hub mirrors the subset returned by `hub-posts`.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-11-post-media-r2.md`. Two options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, reviewed between tasks. Uses `superpowers:subagent-driven-development`.
2. **Inline Execution** — batch execution with checkpoints. Uses `superpowers:executing-plans`.

Which approach do you want?
