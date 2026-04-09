# Instagram Post Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to schedule Instagram posts (single image, carousel, reels) from the CRM, either from an existing approved workflow_post or by creating a new one.

**Architecture:** Frontend uploads media to a public Supabase Storage bucket (`post-media`), then calls a new `instagram-publish` edge function that creates containers on Meta's Content Publishing API with `scheduled_publish_time`. A cron function runs hourly to confirm published posts and clean up storage. The scheduling UI is a modal triggered from existing workflow post cards.

**Tech Stack:** Supabase (Storage, Edge Functions/Deno, PostgreSQL), Meta Instagram Graph API v21.0, React (frontend), TanStack Query

---

## File Structure

### New Files
- `supabase/migrations/20260409_instagram_scheduling.sql` — DB migration (new columns + `post_media` table + storage bucket)
- `supabase/functions/instagram-publish/index.ts` — Edge function for scheduling/publishing/canceling
- `supabase/functions/instagram-publish-cron/index.ts` — Hourly cron for confirming publishes + cleanup
- `src/services/instagram-publish.ts` — Frontend service for calling the publish edge function
- `src/pages/entregas/components/ScheduleModal.tsx` — Scheduling modal UI component
- `src/pages/entregas/components/MediaUploader.tsx` — Drag-and-drop media upload component

### Modified Files
- `supabase/functions/instagram-integration/index.ts:114` — Add `instagram_content_publish` to OAuth scope
- `src/store.ts:1075-1095` — Add new fields to `WorkflowPost` interface + new `PostMedia` interface + CRUD for `post_media`
- `src/pages/entregas/components/WorkflowDrawer.tsx` — Add "Schedule to Instagram" button on approved posts + cancel scheduling action

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260409_instagram_scheduling.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- Instagram Scheduling: new columns + post_media table + storage
-- ============================================================

-- Add scheduling columns to workflow_posts
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS instagram_container_id text,
  ADD COLUMN IF NOT EXISTS instagram_media_id text,
  ADD COLUMN IF NOT EXISTS music_note text,
  ADD COLUMN IF NOT EXISTS cover_url text;

CREATE INDEX IF NOT EXISTS idx_workflow_posts_scheduled
  ON workflow_posts(scheduled_at)
  WHERE status = 'agendado';

-- ============================================================
-- post_media — media files for scheduling
-- ============================================================
CREATE TABLE IF NOT EXISTS post_media (
  id          bigserial PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  public_url  text NOT NULL,
  media_type  text NOT NULL CHECK (media_type IN ('image', 'video')),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_media_post
  ON post_media(post_id);

-- RLS
ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_post_media_all" ON post_media;
CREATE POLICY "workspace_post_media_all" ON post_media
  FOR ALL USING (
    post_id IN (
      SELECT wp.id FROM workflow_posts wp
      WHERE wp.conta_id IN (SELECT public.get_my_conta_id())
    )
  );

DROP POLICY IF EXISTS "service_role_bypass_post_media" ON post_media;
CREATE POLICY "service_role_bypass_post_media" ON post_media
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Storage bucket: post-media (public)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-media', 'post-media', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: workspace members can manage files under their conta_id prefix
DROP POLICY IF EXISTS "post_media_upload" ON storage.objects;
CREATE POLICY "post_media_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'post-media'
    AND (storage.foldername(name))[1] IN (SELECT public.get_my_conta_id()::text)
  );

DROP POLICY IF EXISTS "post_media_read" ON storage.objects;
CREATE POLICY "post_media_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-media');

DROP POLICY IF EXISTS "post_media_delete" ON storage.objects;
CREATE POLICY "post_media_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'post-media'
    AND (storage.foldername(name))[1] IN (SELECT public.get_my_conta_id()::text)
  );

-- Service role bypass for storage cleanup from cron
DROP POLICY IF EXISTS "service_role_post_media_storage" ON storage.objects;
CREATE POLICY "service_role_post_media_storage" ON storage.objects
  FOR ALL TO service_role USING (bucket_id = 'post-media') WITH CHECK (bucket_id = 'post-media');
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db push` or `npx supabase migration up`
Expected: Migration applies without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260409_instagram_scheduling.sql
git commit -m "feat(db): add instagram scheduling columns, post_media table, and storage bucket"
```

---

## Task 2: Update OAuth Scope

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts:114`

- [ ] **Step 1: Add `instagram_content_publish` scope to OAuth URL**

In `supabase/functions/instagram-integration/index.ts`, line 114, change:

```typescript
const oauthUrl = `https://www.instagram.com/oauth/authorize?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(functionBaseUrl)}&response_type=code&scope=instagram_business_basic,instagram_business_manage_insights&state=${state}`;
```

to:

```typescript
const oauthUrl = `https://www.instagram.com/oauth/authorize?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(functionBaseUrl)}&response_type=code&scope=instagram_business_basic,instagram_business_manage_insights,instagram_content_publish&state=${state}`;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/instagram-integration/index.ts
git commit -m "feat(auth): add instagram_content_publish scope to OAuth flow"
```

---

## Task 3: Update TypeScript Types and Store Functions

**Files:**
- Modify: `src/store.ts:1075-1095` — extend `WorkflowPost` interface, add `PostMedia` interface, add CRUD

- [ ] **Step 1: Extend the WorkflowPost interface**

In `src/store.ts`, after the existing `updated_at` field in the `WorkflowPost` interface (around line 1095), add:

```typescript
  scheduled_at?: string | null;
  instagram_container_id?: string | null;
  instagram_media_id?: string | null;
  music_note?: string | null;
  cover_url?: string | null;
```

- [ ] **Step 2: Add PostMedia interface and CRUD functions**

After the `WorkflowPost` interface in `src/store.ts`, add:

```typescript
export interface PostMedia {
  id?: number;
  post_id: number;
  storage_path: string;
  public_url: string;
  media_type: 'image' | 'video';
  position: number;
  created_at?: string;
}

export async function getPostMedia(postId: number): Promise<PostMedia[]> {
  const { data, error } = await supabase
    .from('post_media')
    .select('*')
    .eq('post_id', postId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addPostMedia(media: Omit<PostMedia, 'id' | 'created_at'>): Promise<PostMedia> {
  const { data, error } = await supabase
    .from('post_media')
    .insert(media)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removePostMedia(id: number): Promise<void> {
  const { error } = await supabase.from('post_media').delete().eq('id', id);
  if (error) throw error;
}

export async function uploadPostMediaFile(
  contaId: string,
  postId: number,
  file: File
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = file.name.split('.').pop() || 'jpg';
  const storagePath = `${contaId}/${postId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('post-media')
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('post-media').getPublicUrl(storagePath);
  return { storagePath, publicUrl: data.publicUrl };
}

export async function deletePostMediaFile(storagePath: string): Promise<void> {
  const { error } = await supabase.storage
    .from('post-media')
    .remove([storagePath]);
  if (error) throw error;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/store.ts
git commit -m "feat(store): add PostMedia type and CRUD, extend WorkflowPost with scheduling fields"
```

---

## Task 4: Instagram Publish Edge Function

**Files:**
- Create: `supabase/functions/instagram-publish/index.ts`

- [ ] **Step 1: Create the edge function**

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();

const GRAPH_API = "https://graph.instagram.com/v21.0";

// --- Token Decryption ---
async function decryptToken(encryptedBase64: string): Promise<string> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decryptedBuf);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// --- Helpers: Meta Container Creation ---

async function createImageContainer(
  igUserId: string,
  token: string,
  imageUrl: string,
  caption?: string,
  scheduledTime?: number
): Promise<string> {
  const params: Record<string, string> = { image_url: imageUrl, access_token: token };
  if (caption) params.caption = caption;
  if (scheduledTime) params.published = 'false';
  if (scheduledTime) params.scheduled_publish_time = String(scheduledTime);

  const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create image container');
  return data.id;
}

async function createVideoContainer(
  igUserId: string,
  token: string,
  videoUrl: string,
  caption?: string,
  coverUrl?: string,
  scheduledTime?: number
): Promise<string> {
  const params: Record<string, string> = {
    media_type: 'REELS',
    video_url: videoUrl,
    access_token: token,
  };
  if (caption) params.caption = caption;
  if (coverUrl) params.cover_url = coverUrl;
  if (scheduledTime) {
    params.published = 'false';
    params.scheduled_publish_time = String(scheduledTime);
  }

  const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create video container');
  return data.id;
}

async function createCarouselChildContainer(
  igUserId: string,
  token: string,
  mediaUrl: string,
  mediaType: 'image' | 'video'
): Promise<string> {
  const params: Record<string, string> = {
    is_carousel_item: 'true',
    access_token: token,
  };
  if (mediaType === 'image') {
    params.image_url = mediaUrl;
  } else {
    params.media_type = 'VIDEO';
    params.video_url = mediaUrl;
  }

  const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create carousel child');
  return data.id;
}

async function createCarouselContainer(
  igUserId: string,
  token: string,
  childIds: string[],
  caption?: string,
  scheduledTime?: number
): Promise<string> {
  const params: Record<string, unknown> = {
    media_type: 'CAROUSEL',
    children: childIds,
    access_token: token,
  };
  if (caption) params.caption = caption;
  if (scheduledTime) {
    params.published = 'false';
    params.scheduled_publish_time = String(scheduledTime);
  }

  const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to create carousel container');
  return data.id;
}

async function publishContainer(igUserId: string, token: string, containerId: string): Promise<string> {
  const res = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to publish');
  return data.id;
}

async function checkContainerStatus(token: string, containerId: string): Promise<{ status: string; error?: string }> {
  const res = await fetch(`${GRAPH_API}/${containerId}?fields=status_code,status&access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Failed to check status');
  return { status: data.status_code, error: data.status };
}

async function deleteContainer(token: string, containerId: string): Promise<void> {
  const res = await fetch(`${GRAPH_API}/${containerId}?access_token=${token}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) console.error('Failed to delete container:', data.error);
}

// Wait for video container to finish processing (polls every 5s, max 5 min)
async function waitForContainerReady(token: string, containerId: string): Promise<void> {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    const { status } = await checkContainerStatus(token, containerId);
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error('Video processing failed on Instagram');
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Video processing timed out (5 min)');
}

// --- Main Handler ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace('/instagram-publish', '').replace(/\/$/, '');

  // Auth
  const authHeader = req.headers.get('Authorization');
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader || '' } },
  });
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const userRes = await supabaseClient.auth.getUser();
  const user = userRes.data?.user;
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    // POST /schedule/:postId
    const scheduleMatch = path.match(/^\/schedule\/(\d+)$/);
    if (req.method === 'POST' && scheduleMatch) {
      const postId = parseInt(scheduleMatch[1], 10);
      const body = await req.json();
      const scheduledAt: string | undefined = body.scheduled_at; // ISO string
      const caption: string = body.caption ?? '';
      const coverUrl: string | undefined = body.cover_url;
      const musicNote: string | undefined = body.music_note;

      // Fetch the post (via user's RLS)
      const { data: post, error: postErr } = await supabaseClient
        .from('workflow_posts')
        .select('*, workflows!inner(cliente_id)')
        .eq('id', postId)
        .single();
      if (postErr || !post) return jsonResponse({ error: 'Post not found' }, 404);

      const clienteId = (post as any).workflows.cliente_id;

      // Get the client's Instagram account
      const { data: igAccount, error: igErr } = await supabaseAdmin
        .from('instagram_accounts')
        .select('instagram_user_id, encrypted_access_token')
        .eq('client_id', clienteId)
        .single();
      if (igErr || !igAccount) return jsonResponse({ error: 'Instagram account not connected for this client' }, 400);

      const accessToken = await decryptToken(igAccount.encrypted_access_token);
      const igUserId = igAccount.instagram_user_id;

      // Get media
      const { data: mediaItems } = await supabaseAdmin
        .from('post_media')
        .select('*')
        .eq('post_id', postId)
        .order('position', { ascending: true });

      if (!mediaItems || mediaItems.length === 0) {
        return jsonResponse({ error: 'No media uploaded for this post' }, 400);
      }

      const scheduledTimestamp = scheduledAt
        ? Math.floor(new Date(scheduledAt).getTime() / 1000)
        : undefined;

      let containerId: string;

      if (post.tipo === 'reels') {
        // Reels: single video
        const video = mediaItems.find((m: any) => m.media_type === 'video');
        if (!video) return jsonResponse({ error: 'Reels require a video file' }, 400);
        containerId = await createVideoContainer(igUserId, accessToken, video.public_url, caption, coverUrl, scheduledTimestamp);
        // Wait for video to process before scheduling/publishing
        await waitForContainerReady(accessToken, containerId);
      } else if (post.tipo === 'carrossel') {
        // Carousel: multiple children
        if (mediaItems.length < 2) return jsonResponse({ error: 'Carousel requires at least 2 media items' }, 400);
        if (mediaItems.length > 10) return jsonResponse({ error: 'Carousel supports max 10 media items' }, 400);

        const childIds: string[] = [];
        for (const item of mediaItems) {
          const childId = await createCarouselChildContainer(igUserId, accessToken, item.public_url, item.media_type);
          // If child is video, wait for processing
          if (item.media_type === 'video') {
            await waitForContainerReady(accessToken, childId);
          }
          childIds.push(childId);
        }
        containerId = await createCarouselContainer(igUserId, accessToken, childIds, caption, scheduledTimestamp);
      } else {
        // Feed: single image
        const image = mediaItems[0];
        containerId = await createImageContainer(igUserId, accessToken, image.public_url, caption, scheduledTimestamp);
      }

      let instagramMediaId: string | undefined;
      let newStatus: string;

      if (scheduledTimestamp) {
        // Scheduled: Meta handles the publish at the specified time
        newStatus = 'agendado';
      } else {
        // Publish now
        instagramMediaId = await publishContainer(igUserId, accessToken, containerId);
        newStatus = 'postado';
      }

      // Update the post
      await supabaseAdmin
        .from('workflow_posts')
        .update({
          status: newStatus,
          scheduled_at: scheduledAt || null,
          instagram_container_id: containerId,
          instagram_media_id: instagramMediaId || null,
          music_note: musicNote || null,
          cover_url: coverUrl || null,
          conteudo_plain: caption,
        })
        .eq('id', postId);

      // If published now, clean up storage
      if (newStatus === 'postado') {
        for (const item of mediaItems) {
          await supabaseAdmin.storage.from('post-media').remove([item.storage_path]);
        }
        await supabaseAdmin.from('post_media').delete().eq('post_id', postId);
      }

      return jsonResponse({ success: true, status: newStatus, container_id: containerId, media_id: instagramMediaId });
    }

    // POST /publish-now/:postId — alias that calls schedule without scheduled_at
    const publishNowMatch = path.match(/^\/publish-now\/(\d+)$/);
    if (req.method === 'POST' && publishNowMatch) {
      // Rewrite as schedule without scheduled_at (handled above if no scheduledTimestamp)
      // For simplicity, this is handled by the schedule endpoint when scheduled_at is omitted
      return jsonResponse({ error: 'Use POST /schedule/:postId without scheduled_at to publish immediately' }, 400);
    }

    // DELETE /cancel/:postId
    const cancelMatch = path.match(/^\/cancel\/(\d+)$/);
    if (req.method === 'DELETE' && cancelMatch) {
      const postId = parseInt(cancelMatch[1], 10);

      const { data: post, error: postErr } = await supabaseClient
        .from('workflow_posts')
        .select('instagram_container_id, status')
        .eq('id', postId)
        .single();
      if (postErr || !post) return jsonResponse({ error: 'Post not found' }, 404);
      if (post.status !== 'agendado') return jsonResponse({ error: 'Post is not scheduled' }, 400);

      // Get token to delete container
      const { data: postFull } = await supabaseClient
        .from('workflow_posts')
        .select('*, workflows!inner(cliente_id)')
        .eq('id', postId)
        .single();
      const clienteId = (postFull as any).workflows.cliente_id;

      const { data: igAccount } = await supabaseAdmin
        .from('instagram_accounts')
        .select('encrypted_access_token')
        .eq('client_id', clienteId)
        .single();

      if (igAccount && post.instagram_container_id) {
        const token = await decryptToken(igAccount.encrypted_access_token);
        await deleteContainer(token, post.instagram_container_id);
      }

      await supabaseAdmin
        .from('workflow_posts')
        .update({
          status: 'aprovado_cliente',
          scheduled_at: null,
          instagram_container_id: null,
          instagram_media_id: null,
        })
        .eq('id', postId);

      return jsonResponse({ success: true });
    }

    // GET /status/:postId
    const statusMatch = path.match(/^\/status\/(\d+)$/);
    if (req.method === 'GET' && statusMatch) {
      const postId = parseInt(statusMatch[1], 10);

      const { data: post } = await supabaseClient
        .from('workflow_posts')
        .select('instagram_container_id, workflows!inner(cliente_id)')
        .eq('id', postId)
        .single();
      if (!post || !post.instagram_container_id) return jsonResponse({ error: 'No container found' }, 404);

      const clienteId = (post as any).workflows.cliente_id;
      const { data: igAccount } = await supabaseAdmin
        .from('instagram_accounts')
        .select('encrypted_access_token')
        .eq('client_id', clienteId)
        .single();
      if (!igAccount) return jsonResponse({ error: 'Instagram account not found' }, 404);

      const token = await decryptToken(igAccount.encrypted_access_token);
      const result = await checkContainerStatus(token, post.instagram_container_id);
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Not found' }, 404);

  } catch (err: any) {
    console.error('[instagram-publish] Error:', err);
    return jsonResponse({ error: err.message || 'Internal error' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/instagram-publish/index.ts
git commit -m "feat(edge): add instagram-publish edge function for scheduling and publishing"
```

---

## Task 5: Instagram Publish Cron Edge Function

**Files:**
- Create: `supabase/functions/instagram-publish-cron/index.ts`

- [ ] **Step 1: Create the cron function**

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();

const GRAPH_API = "https://graph.instagram.com/v21.0";

async function decryptToken(encryptedBase64: string): Promise<string> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decryptedBuf);
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find posts that are scheduled and whose scheduled_at has passed
    const { data: posts, error } = await supabase
      .from('workflow_posts')
      .select('id, instagram_container_id, scheduled_at, workflows!inner(cliente_id)')
      .eq('status', 'agendado')
      .lte('scheduled_at', new Date().toISOString());

    if (error) throw error;
    if (!posts || posts.length === 0) {
      return new Response("No posts to check", { status: 200 });
    }

    console.log(`[IG-PUBLISH-CRON] Checking ${posts.length} scheduled post(s)`);

    let confirmedCount = 0;
    let failedCount = 0;

    for (const post of posts) {
      try {
        const clienteId = (post as any).workflows.cliente_id;

        const { data: igAccount } = await supabase
          .from('instagram_accounts')
          .select('encrypted_access_token')
          .eq('client_id', clienteId)
          .single();

        if (!igAccount || !post.instagram_container_id) {
          failedCount++;
          continue;
        }

        const token = await decryptToken(igAccount.encrypted_access_token);

        // Check if the container has been published by Meta
        const res = await fetch(
          `${GRAPH_API}/${post.instagram_container_id}?fields=status_code,id&access_token=${token}`
        );
        const data = await res.json();

        // If the scheduled time has passed, Meta should have published it
        // The container status_code becomes PUBLISHED or we get the media_id
        const isPublished = data.status_code === 'PUBLISHED' || data.status_code === 'FINISHED';

        if (isPublished || data.error) {
          // Update status to postado
          await supabase
            .from('workflow_posts')
            .update({
              status: 'postado',
              instagram_media_id: data.id || post.instagram_container_id,
            })
            .eq('id', post.id);

          // Clean up media from storage
          const { data: mediaItems } = await supabase
            .from('post_media')
            .select('storage_path')
            .eq('post_id', post.id);

          if (mediaItems && mediaItems.length > 0) {
            const paths = mediaItems.map((m: any) => m.storage_path);
            await supabase.storage.from('post-media').remove(paths);
            await supabase.from('post_media').delete().eq('post_id', post.id);
          }

          confirmedCount++;
          console.log(`[IG-PUBLISH-CRON] Confirmed post ${post.id}`);
        }
      } catch (err: any) {
        console.error(`[IG-PUBLISH-CRON] Error checking post ${post.id}:`, err);
        failedCount++;
      }
    }

    console.log(`[IG-PUBLISH-CRON] Done. Confirmed: ${confirmedCount}, Failed: ${failedCount}`);

    return new Response(JSON.stringify({
      success: true,
      confirmed: confirmedCount,
      failed: failedCount,
      total: posts.length,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error("[IG-PUBLISH-CRON] Cron Job Failed", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/instagram-publish-cron/index.ts
git commit -m "feat(cron): add instagram-publish-cron for hourly publish confirmation and cleanup"
```

---

## Task 6: Frontend Publish Service

**Files:**
- Create: `src/services/instagram-publish.ts`

- [ ] **Step 1: Create the frontend service**

```typescript
import { supabase } from '../lib/supabase';

const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/instagram-publish';

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };
}

export async function scheduleInstagramPost(
  postId: number,
  opts: {
    caption: string;
    scheduled_at: string; // ISO string
    cover_url?: string;
    music_note?: string;
  }
): Promise<{ success: boolean; container_id: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/schedule/${postId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Error scheduling post');
  }
  return res.json();
}

export async function publishInstagramPostNow(
  postId: number,
  opts: {
    caption: string;
    cover_url?: string;
    music_note?: string;
  }
): Promise<{ success: boolean; media_id: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/schedule/${postId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts), // no scheduled_at = publish now
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Error publishing post');
  }
  return res.json();
}

export async function cancelInstagramSchedule(postId: number): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/cancel/${postId}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Error canceling schedule');
  }
}

export async function getInstagramPublishStatus(postId: number): Promise<{ status: string; error?: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/status/${postId}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Error checking status');
  }
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/instagram-publish.ts
git commit -m "feat(service): add instagram-publish frontend service"
```

---

## Task 7: Media Uploader Component

**Files:**
- Create: `src/pages/entregas/components/MediaUploader.tsx`

- [ ] **Step 1: Create the MediaUploader component**

```tsx
import { useState, useCallback, useRef } from 'react';
import { Upload, X, GripVertical, Film, Image as ImageIcon } from 'lucide-react';
import { uploadPostMediaFile, addPostMedia, removePostMedia, deletePostMediaFile, type PostMedia } from '../../../store';

interface MediaUploaderProps {
  postId: number;
  contaId: string;
  tipo: 'feed' | 'reels' | 'carrossel';
  mediaItems: PostMedia[];
  onMediaChange: (items: PostMedia[]) => void;
}

const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const ACCEPTED_VIDEO_TYPES = ['video/mp4'];

export function MediaUploader({ postId, contaId, tipo, mediaItems, onMediaChange }: MediaUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isReels = tipo === 'reels';
  const isCarousel = tipo === 'carrossel';
  const maxItems = isCarousel ? 10 : 1;
  const mainMediaItems = isReels
    ? mediaItems.filter(m => m.media_type === 'video')
    : mediaItems.filter(m => m.media_type === 'image' || (isCarousel && m.media_type === 'video'));

  const acceptedTypes = isReels ? ACCEPTED_VIDEO_TYPES : [...ACCEPTED_IMAGE_TYPES, ...(isCarousel ? ACCEPTED_VIDEO_TYPES : [])];

  const validateFile = (file: File): string | null => {
    if (isReels && !ACCEPTED_VIDEO_TYPES.includes(file.type)) return 'Reels requer um arquivo MP4';
    if (!isReels && !acceptedTypes.includes(file.type)) return 'Formato não suportado. Use JPEG, PNG ou MP4';
    const isVideo = ACCEPTED_VIDEO_TYPES.includes(file.type);
    if (isVideo && file.size > MAX_VIDEO_SIZE) return 'Vídeo excede 100 MB';
    if (!isVideo && file.size > MAX_IMAGE_SIZE) return 'Imagem excede 8 MB';
    return null;
  };

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const remaining = maxItems - mainMediaItems.length;
    if (remaining <= 0) return;
    const toUpload = fileArray.slice(0, remaining);

    setUploading(true);
    try {
      const newItems: PostMedia[] = [];
      for (let i = 0; i < toUpload.length; i++) {
        const file = toUpload[i];
        const err = validateFile(file);
        if (err) { alert(err); continue; }

        const mediaType = ACCEPTED_VIDEO_TYPES.includes(file.type) ? 'video' as const : 'image' as const;
        const { storagePath, publicUrl } = await uploadPostMediaFile(contaId, postId, file);
        const saved = await addPostMedia({
          post_id: postId,
          storage_path: storagePath,
          public_url: publicUrl,
          media_type: mediaType,
          position: mainMediaItems.length + i,
        });
        newItems.push(saved);
      }
      onMediaChange([...mediaItems, ...newItems]);
    } finally {
      setUploading(false);
    }
  }, [postId, contaId, mediaItems, mainMediaItems.length, maxItems, onMediaChange]);

  const handleRemove = useCallback(async (item: PostMedia) => {
    await deletePostMediaFile(item.storage_path);
    await removePostMedia(item.id!);
    onMediaChange(mediaItems.filter(m => m.id !== item.id));
  }, [mediaItems, onMediaChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleReorder = useCallback((fromIdx: number, toIdx: number) => {
    const reordered = [...mediaItems];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const updated = reordered.map((m, i) => ({ ...m, position: i }));
    onMediaChange(updated);
  }, [mediaItems, onMediaChange]);

  return (
    <div className="media-uploader">
      {/* Existing media thumbnails */}
      {mediaItems.length > 0 && (
        <div className="media-uploader__grid">
          {mediaItems.map((item, idx) => (
            <div
              key={item.id}
              className={`media-uploader__thumb${dragIdx === idx ? ' media-uploader__thumb--dragging' : ''}`}
              draggable={isCarousel}
              onDragStart={() => setDragIdx(idx)}
              onDragOver={e => { e.preventDefault(); }}
              onDrop={e => {
                e.preventDefault();
                if (dragIdx !== null && dragIdx !== idx) handleReorder(dragIdx, idx);
                setDragIdx(null);
              }}
              onDragEnd={() => setDragIdx(null)}
            >
              {isCarousel && <GripVertical className="h-3 w-3 media-uploader__grip" />}
              {item.media_type === 'video' ? (
                <div className="media-uploader__video-icon"><Film className="h-6 w-6" /></div>
              ) : (
                <img src={item.public_url} alt="" className="media-uploader__img" />
              )}
              <button
                type="button"
                className="media-uploader__remove"
                onClick={() => handleRemove(item)}
                title="Remover"
              >
                <X className="h-3 w-3" />
              </button>
              {idx === 0 && <span className="media-uploader__badge">Principal</span>}
            </div>
          ))}
        </div>
      )}

      {/* Upload area */}
      {mainMediaItems.length < maxItems && (
        <div
          className={`media-uploader__dropzone${dragOver ? ' media-uploader__dropzone--active' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            accept={acceptedTypes.join(',')}
            multiple={isCarousel}
            onChange={e => e.target.files && handleFiles(e.target.files)}
          />
          {uploading ? (
            <p className="text-sm text-muted-foreground">Enviando...</p>
          ) : (
            <>
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-1">
                {isReels ? 'Arraste um vídeo MP4 ou clique' :
                 isCarousel ? `Arraste imagens ou vídeos (${mainMediaItems.length}/${maxItems})` :
                 'Arraste uma imagem ou clique'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isReels ? 'MP4, até 100 MB' : 'JPEG/PNG até 8 MB' + (isCarousel ? ', MP4 até 100 MB' : '')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/entregas/components/MediaUploader.tsx
git commit -m "feat(ui): add MediaUploader component with drag-and-drop and reordering"
```

---

## Task 8: Schedule Modal Component

**Files:**
- Create: `src/pages/entregas/components/ScheduleModal.tsx`

- [ ] **Step 1: Create the ScheduleModal component**

```tsx
import { useState, useEffect } from 'react';
import { X, Calendar, Instagram, AlertTriangle, Music } from 'lucide-react';
import { toast } from 'sonner';
import { getPostMedia, type WorkflowPost, type PostMedia } from '../../../store';
import { scheduleInstagramPost, publishInstagramPostNow } from '../../../services/instagram-publish';
import { MediaUploader } from './MediaUploader';

interface ScheduleModalProps {
  post: WorkflowPost;
  contaId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function getDefaultScheduleTime(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm for datetime-local input
}

function getMinScheduleTime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 10);
  return d.toISOString().slice(0, 16);
}

function getMaxScheduleTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 75);
  return d.toISOString().slice(0, 16);
}

export function ScheduleModal({ post, contaId, onClose, onSuccess }: ScheduleModalProps) {
  const [caption, setCaption] = useState(post.conteudo_plain || '');
  const [musicNote, setMusicNote] = useState('');
  const [scheduledAt, setScheduledAt] = useState(getDefaultScheduleTime());
  const [coverUrl, setCoverUrl] = useState('');
  const [mediaItems, setMediaItems] = useState<PostMedia[]>([]);
  const [coverMedia, setCoverMedia] = useState<PostMedia[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPostMedia(post.id!).then(items => {
      setMediaItems(items.filter(m => m.media_type !== 'image' || post.tipo !== 'reels'));
      // For reels, separate cover images if any already uploaded
      setLoading(false);
    });
  }, [post.id, post.tipo]);

  const handleSubmit = async (publishNow: boolean) => {
    if (mediaItems.length === 0) {
      toast.error('Adicione pelo menos uma mídia');
      return;
    }
    if (caption.length > 2200) {
      toast.error('Legenda excede 2.200 caracteres');
      return;
    }
    if (post.tipo === 'carrossel' && mediaItems.length < 2) {
      toast.error('Carrossel requer pelo menos 2 mídias');
      return;
    }

    setSubmitting(true);
    try {
      if (publishNow) {
        await publishInstagramPostNow(post.id!, {
          caption,
          cover_url: coverUrl || undefined,
          music_note: musicNote || undefined,
        });
        toast.success('Post publicado no Instagram!');
      } else {
        await scheduleInstagramPost(post.id!, {
          caption,
          scheduled_at: new Date(scheduledAt).toISOString(),
          cover_url: coverUrl || undefined,
          music_note: musicNote || undefined,
        });
        toast.success('Post agendado no Instagram!');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao agendar post');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="schedule-modal-overlay" onClick={onClose}>
        <div className="schedule-modal" onClick={e => e.stopPropagation()}>
          <p className="text-sm text-muted-foreground p-6">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="schedule-modal-overlay" onClick={onClose}>
      <div className="schedule-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="schedule-modal__header">
          <div className="flex items-center gap-2">
            <Instagram className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Agendar no Instagram</h2>
          </div>
          <button type="button" onClick={onClose} className="schedule-modal__close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="schedule-modal__body">
          {/* Media */}
          <div className="schedule-modal__section">
            <label className="text-sm font-medium">
              {post.tipo === 'reels' ? 'Vídeo' : post.tipo === 'carrossel' ? 'Mídias (2-10)' : 'Imagem'}
            </label>
            <MediaUploader
              postId={post.id!}
              contaId={contaId}
              tipo={post.tipo}
              mediaItems={mediaItems}
              onMediaChange={setMediaItems}
            />
          </div>

          {/* Cover for Reels */}
          {post.tipo === 'reels' && (
            <div className="schedule-modal__section">
              <label className="text-sm font-medium">Capa do Reel (opcional)</label>
              <MediaUploader
                postId={post.id!}
                contaId={contaId}
                tipo="feed"
                mediaItems={coverMedia}
                onMediaChange={items => {
                  setCoverMedia(items);
                  setCoverUrl(items[0]?.public_url || '');
                }}
              />
            </div>
          )}

          {/* Caption */}
          <div className="schedule-modal__section">
            <label className="text-sm font-medium">
              Legenda <span className="text-muted-foreground">({caption.length}/2.200)</span>
            </label>
            <textarea
              className="schedule-modal__textarea"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              maxLength={2200}
              rows={4}
              placeholder="Escreva a legenda do post..."
            />
          </div>

          {/* Music Note */}
          <div className="schedule-modal__section">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Music className="h-3.5 w-3.5" />
              Lembrete de música
              <span className="text-xs text-muted-foreground">(adicionar manualmente no app)</span>
            </label>
            <input
              type="text"
              className="schedule-modal__input"
              value={musicNote}
              onChange={e => setMusicNote(e.target.value)}
              placeholder="Ex: Trending audio #123..."
            />
            {musicNote && (
              <div className="schedule-modal__warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="text-xs">Música não pode ser adicionada via API. Lembre-se de adicionar manualmente no app do Instagram.</span>
              </div>
            )}
          </div>

          {/* Schedule Date/Time */}
          <div className="schedule-modal__section">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Data e hora de publicação
            </label>
            <input
              type="datetime-local"
              className="schedule-modal__input"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              min={getMinScheduleTime()}
              max={getMaxScheduleTime()}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="schedule-modal__footer">
          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleSubmit(true)}
            disabled={submitting}
          >
            {submitting ? 'Publicando...' : 'Publicar agora'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit(false)}
            disabled={submitting}
          >
            {submitting ? 'Agendando...' : 'Agendar'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/entregas/components/ScheduleModal.tsx
git commit -m "feat(ui): add ScheduleModal component for Instagram post scheduling"
```

---

## Task 9: Integrate Schedule Button into WorkflowDrawer

**Files:**
- Modify: `src/pages/entregas/components/WorkflowDrawer.tsx`

- [ ] **Step 1: Add imports and state for the schedule modal**

At the top of `WorkflowDrawer.tsx`, add these imports:

```typescript
import { Instagram, Clock } from 'lucide-react';
import { ScheduleModal } from './ScheduleModal';
import { cancelInstagramSchedule } from '../../../services/instagram-publish';
```

Inside the `WorkflowDrawer` component function, add state:

```typescript
const [schedulePostId, setSchedulePostId] = useState<number | null>(null);
const [cancelingId, setCancelingId] = useState<number | null>(null);
```

- [ ] **Step 2: Add the cancel handler**

Inside the `WorkflowDrawer` component, add:

```typescript
const handleCancelSchedule = async (postId: number) => {
  setCancelingId(postId);
  try {
    await cancelInstagramSchedule(postId);
    toast.success('Agendamento cancelado');
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
    onRefresh();
  } catch (err: any) {
    toast.error(err.message || 'Erro ao cancelar agendamento');
  } finally {
    setCancelingId(null);
  }
};
```

- [ ] **Step 3: Add the "Schedule to Instagram" button to post cards with status `aprovado_cliente`**

Find where the post action buttons are rendered in the post card area. Add these buttons based on status:

For posts with `status === 'aprovado_cliente'`:
```tsx
<button
  type="button"
  className="btn btn-sm btn-outline flex items-center gap-1"
  onClick={() => setSchedulePostId(post.id!)}
  title="Agendar no Instagram"
>
  <Instagram className="h-3.5 w-3.5" />
  Agendar
</button>
```

For posts with `status === 'agendado'`:
```tsx
<div className="flex items-center gap-2">
  <span className="text-xs text-muted-foreground flex items-center gap-1">
    <Clock className="h-3 w-3" />
    {new Date(post.scheduled_at!).toLocaleString('pt-BR')}
  </span>
  <button
    type="button"
    className="btn btn-sm btn-outline-destructive"
    onClick={() => handleCancelSchedule(post.id!)}
    disabled={cancelingId === post.id}
  >
    {cancelingId === post.id ? 'Cancelando...' : 'Cancelar agendamento'}
  </button>
</div>
```

- [ ] **Step 4: Render the ScheduleModal**

At the end of the component's JSX (before the closing fragment), add:

```tsx
{schedulePostId && (
  <ScheduleModal
    post={posts.find(p => p.id === schedulePostId)!}
    contaId={card.workflow.conta_id}
    onClose={() => setSchedulePostId(null)}
    onSuccess={() => {
      qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
      onRefresh();
    }}
  />
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat(ui): integrate Instagram scheduling into WorkflowDrawer"
```

---

## Task 10: CSS Styles for Schedule Modal and Media Uploader

**Files:**
- Modify: the main CSS file where post-related styles live

- [ ] **Step 1: Add styles to `style.css` (the project's main CSS file, uses Tailwind)**

```css
/* Schedule Modal */
.schedule-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.schedule-modal {
  background: hsl(var(--card));
  border-radius: 12px;
  width: 90%;
  max-width: 540px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.schedule-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid hsl(var(--border));
}

.schedule-modal__close {
  padding: 4px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground));
  transition: background 0.15s;
}
.schedule-modal__close:hover { background: hsl(var(--muted)); }

.schedule-modal__body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.schedule-modal__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.schedule-modal__textarea,
.schedule-modal__input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  font-size: 14px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  resize: vertical;
}
.schedule-modal__textarea:focus,
.schedule-modal__input:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
}

.schedule-modal__warning {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(234, 179, 8, 0.1);
  border: 1px solid rgba(234, 179, 8, 0.3);
  border-radius: 6px;
  color: #a16207;
}

.schedule-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid hsl(var(--border));
}

/* Media Uploader */
.media-uploader__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.media-uploader__thumb {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  cursor: grab;
}
.media-uploader__thumb--dragging { opacity: 0.4; }

.media-uploader__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-uploader__video-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--muted));
}

.media-uploader__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: white;
}

.media-uploader__badge {
  position: absolute;
  bottom: 4px;
  left: 4px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
}

.media-uploader__grip {
  position: absolute;
  top: 4px;
  left: 4px;
  color: white;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

.media-uploader__dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border: 2px dashed hsl(var(--border));
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.media-uploader__dropzone:hover,
.media-uploader__dropzone--active {
  border-color: hsl(var(--primary));
  background: rgba(99, 102, 241, 0.04);
}
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "feat(css): add styles for ScheduleModal and MediaUploader"
```

---

## Task 11: Manual Testing Checklist

- [ ] **Step 1: Verify the migration applied correctly**

Run: `npx supabase db push`
Check: `post_media` table exists, `workflow_posts` has new columns, `post-media` bucket exists.

- [ ] **Step 2: Re-connect an Instagram account** (to get the new `instagram_content_publish` scope)

The user must disconnect and reconnect their Instagram account since the OAuth scope has changed. Verify that the OAuth URL now includes `instagram_content_publish`.

- [ ] **Step 3: Test the scheduling flow end-to-end**

1. Open a workflow drawer with a post that has status `aprovado_cliente`
2. Click "Agendar" button — schedule modal should open
3. Upload an image — should appear as thumbnail
4. Write a caption, set a future date/time
5. Click "Agendar" — should call the edge function, post status should change to `agendado`
6. Verify the `agendado` badge with date and "Cancelar agendamento" button appear
7. Test cancel — should reset status to `aprovado_cliente`

- [ ] **Step 4: Test carousel flow**

1. Create/select a carrossel-type post
2. Upload 2-10 images
3. Verify drag-to-reorder works
4. Schedule — verify all children are created on Meta

- [ ] **Step 5: Test reels flow**

1. Create/select a reels-type post
2. Upload a video
3. Optionally upload a cover image
4. Schedule — verify video container is created on Meta

- [ ] **Step 6: Test "Publicar agora" flow**

1. Click "Publicar agora" instead of "Agendar"
2. Verify the post is published immediately
3. Verify status changes to `postado`
4. Verify media is cleaned up from storage
