# Google Drive Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agency team members pick images, videos, and PDFs from their Google Drive when creating/editing posts, storing Drive metadata as references (no R2 copy).

**Architecture:** Google Picker API handles auth + file browsing client-side. Drive files are stored in the existing `files` table with new nullable columns for Drive metadata. The `r2_key` column becomes nullable for Drive-sourced files. Both `post-media-manage` and `hub-posts` edge functions are updated to return Drive URLs instead of signed R2 URLs when the file is Drive-sourced.

**Tech Stack:** Google Picker API, Google Identity Services SDK, Supabase migrations, Deno edge functions, React + TanStack Query

---

### Task 1: Database Migration — Add Google Drive columns to `files` table

**Files:**
- Create: `supabase/migrations/20260506000001_files_google_drive_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260506000001_files_google_drive_columns.sql

-- Allow files from Google Drive (no R2 storage)
ALTER TABLE files ALTER COLUMN r2_key DROP NOT NULL;

-- Google Drive metadata columns
ALTER TABLE files ADD COLUMN IF NOT EXISTS google_drive_file_id text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS google_drive_thumbnail_url text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS google_drive_view_url text;

-- Ensure either r2_key or google_drive_file_id is set (one source required)
ALTER TABLE files ADD CONSTRAINT files_has_source
  CHECK (r2_key IS NOT NULL OR google_drive_file_id IS NOT NULL);

-- Update kind constraint to keep existing values valid (already supports 'document')
-- No change needed — kind CHECK already allows 'image', 'video', 'document'

-- Update video thumbnail constraint: only require R2 thumbnail for R2-sourced videos
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_video_requires_thumbnail;
ALTER TABLE files ADD CONSTRAINT files_video_requires_thumbnail
  CHECK (kind != 'video' OR thumbnail_r2_key IS NOT NULL OR google_drive_file_id IS NOT NULL);
```

- [ ] **Step 2: Verify migration syntax locally**

Run: `npx supabase db push --linked --dry-run` (if available) or review SQL manually for correctness.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260506000001_files_google_drive_columns.sql
git commit -m "feat(db): add google drive columns to files table"
```

---

### Task 2: Edge Function — Support Drive files in `post-media-manage`

**Files:**
- Modify: `supabase/functions/post-media-manage/handler.ts` (lines 23-45 `toLegacy`, lines 130-136 GET handler)

The `toLegacy` function currently calls `deps.signUrl(f.r2_key)` unconditionally. For Drive files, `r2_key` is null, so we must use Drive URLs instead.

- [ ] **Step 1: Write the test for Drive file handling in toLegacy**

Create `supabase/functions/__tests__/post-media-manage-drive_test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createPostMediaManageHandler } from "../post-media-manage/handler.ts";

function makeDeps(overrides: Partial<Parameters<typeof createPostMediaManageHandler>[0]> = {}) {
  return {
    buildCorsHeaders: () => ({
      "Access-Control-Allow-Origin": "http://localhost:5173",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    }),
    createDb: () => ({
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          is: () => chain,
          order: () => chain,
          single: () => Promise.resolve({ data: null, error: null }),
        };
        return chain;
      },
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
    signUrl: (key: string) => Promise.resolve(`https://r2.example.com/${key}?signed`),
    signPutUrl: (key: string, _mime: string) => Promise.resolve(`https://r2.example.com/${key}?put-signed`),
    ...overrides,
  } satisfies Parameters<typeof createPostMediaManageHandler>[0];
}

Deno.test("GET /post-media-manage returns Drive URLs for drive-sourced files", async () => {
  const driveFile = {
    id: 10,
    r2_key: null,
    thumbnail_r2_key: null,
    kind: "image",
    mime_type: "image/jpeg",
    size_bytes: 500000,
    name: "photo.jpg",
    width: 1920,
    height: 1080,
    duration_seconds: null,
    uploaded_by: "user-1",
    created_at: "2026-05-06T00:00:00Z",
    blur_data_url: null,
    google_drive_file_id: "abc123",
    google_drive_thumbnail_url: "https://lh3.googleusercontent.com/drive-storage/abc123",
    google_drive_view_url: "https://drive.google.com/file/d/abc123/view",
  };

  const driveLink = {
    id: 1,
    post_id: 100,
    conta_id: "conta-1",
    is_cover: true,
    sort_order: 0,
    files: driveFile,
  };

  const deps = makeDeps({
    createDb: () => ({
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: (_col: string, _val: unknown) => chain,
          in: () => chain,
          order: () => chain,
          single: () => {
            if (table === "profiles") return Promise.resolve({ data: { conta_id: "conta-1" }, error: null });
            if (table === "workflow_posts") return Promise.resolve({ data: { conta_id: "conta-1" }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
        };
        if (table === "post_file_links") {
          chain.order = () => ({ order: () => Promise.resolve({ data: [driveLink], error: null }) });
        }
        return chain;
      },
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
    signUrl: (_key: string) => {
      throw new Error("signUrl should not be called for Drive files");
    },
  });

  const handler = createPostMediaManageHandler(deps);
  const req = new Request("http://localhost/post-media-manage?post_id=100", {
    headers: { Authorization: "Bearer test-token" },
  });
  const res = await handler(req);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.media.length, 1);
  assertEquals(body.media[0].url, "https://lh3.googleusercontent.com/drive-storage/abc123");
  assertEquals(body.media[0].thumbnail_url, "https://lh3.googleusercontent.com/drive-storage/abc123");
  assertEquals(body.media[0].google_drive_file_id, "abc123");
  assertEquals(body.media[0].google_drive_view_url, "https://drive.google.com/file/d/abc123/view");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/__tests__/post-media-manage-drive_test.ts`
Expected: FAIL — `toLegacy` doesn't handle null `r2_key` and doesn't include `google_drive_*` fields.

- [ ] **Step 3: Update `toLegacy` to handle Drive files**

In `supabase/functions/post-media-manage/handler.ts`, replace the `toLegacy` function (lines 23-45):

```typescript
function toLegacy(link: any, file: any, url: string | null, thumbnailUrl: string | null) {
  return {
    id: link.id,
    post_id: link.post_id,
    conta_id: link.conta_id,
    r2_key: file.r2_key,
    thumbnail_r2_key: file.thumbnail_r2_key,
    kind: file.kind,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    original_filename: file.name,
    width: file.width,
    height: file.height,
    duration_seconds: file.duration_seconds,
    is_cover: link.is_cover,
    sort_order: link.sort_order,
    uploaded_by: file.uploaded_by,
    created_at: file.created_at,
    blur_data_url: file.blur_data_url ?? null,
    url,
    thumbnail_url: thumbnailUrl,
    google_drive_file_id: file.google_drive_file_id ?? null,
    google_drive_view_url: file.google_drive_view_url ?? null,
  };
}
```

- [ ] **Step 4: Update the GET handler to handle Drive vs R2 URL signing**

In the same file, update the media mapping in the GET handler (around line 130). Replace:

```typescript
const media = await Promise.all((links ?? []).map(async (l: any) => {
  const f = l.files;
  const u = await deps.signUrl(f.r2_key);
  const tu = f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null;
  return toLegacy(l, f, u, tu);
}));
```

With:

```typescript
const media = await Promise.all((links ?? []).map(async (l: any) => {
  const f = l.files;
  const isDrive = !!f.google_drive_file_id;
  const u = isDrive ? f.google_drive_thumbnail_url : await deps.signUrl(f.r2_key);
  const tu = isDrive ? f.google_drive_thumbnail_url : (f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null);
  return toLegacy(l, f, u, tu);
}));
```

Apply the same pattern to the workflow covers GET handler (around lines 106-114). Replace:

```typescript
media: await Promise.all(links.map(async (l: any) => {
  const f = l.files;
  const u = await deps.signUrl(f.r2_key);
  const tu = f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null;
  return toLegacy(l, f, u, tu);
})),
```

With:

```typescript
media: await Promise.all(links.map(async (l: any) => {
  const f = l.files;
  const isDrive = !!f.google_drive_file_id;
  const u = isDrive ? f.google_drive_thumbnail_url : await deps.signUrl(f.r2_key);
  const tu = isDrive ? f.google_drive_thumbnail_url : (f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null);
  return toLegacy(l, f, u, tu);
})),
```

- [ ] **Step 5: Update the PATCH handler to handle Drive files**

In the PATCH handler (around line 166-170), the `signUrl` call also needs the Drive check. Replace:

```typescript
const { data: updatedLink } = await svc.from("post_file_links").select("*, files(*)").eq("id", linkId).single();
const uf = (updatedLink as any).files;
const u = await deps.signUrl(uf.r2_key);
const tu = uf.thumbnail_r2_key ? await deps.signUrl(uf.thumbnail_r2_key) : null;
return json(toLegacy(updatedLink, uf, u, tu));
```

With:

```typescript
const { data: updatedLink } = await svc.from("post_file_links").select("*, files(*)").eq("id", linkId).single();
const uf = (updatedLink as any).files;
const isDrive = !!uf.google_drive_file_id;
const u = isDrive ? uf.google_drive_thumbnail_url : await deps.signUrl(uf.r2_key);
const tu = isDrive ? uf.google_drive_thumbnail_url : (uf.thumbnail_r2_key ? await deps.signUrl(uf.thumbnail_r2_key) : null);
return json(toLegacy(updatedLink, uf, u, tu));
```

- [ ] **Step 6: Run test to verify it passes**

Run: `deno test supabase/functions/__tests__/post-media-manage-drive_test.ts`
Expected: PASS

- [ ] **Step 7: Run full edge function test suite**

Run: `deno test supabase/functions/`
Expected: All existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/post-media-manage/handler.ts supabase/functions/__tests__/post-media-manage-drive_test.ts
git commit -m "feat(edge): support google drive files in post-media-manage"
```

---

### Task 3: Edge Function — Support Drive files in `hub-posts`

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts` (lines 162-187)

The Hub edge function also signs R2 URLs for media. It needs the same Drive-aware logic.

- [ ] **Step 1: Update the hub-posts media mapping**

In `supabase/functions/hub-posts/handler.ts`, update the `select` call (line 165) to include Drive columns:

Replace:
```typescript
.select("id, post_id, is_cover, sort_order, files(id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, blur_data_url)")
```

With:
```typescript
.select("id, post_id, is_cover, sort_order, files(id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, blur_data_url, google_drive_file_id, google_drive_thumbnail_url, google_drive_view_url)")
```

- [ ] **Step 2: Update the URL generation logic**

Replace the `mediaWithUrls` mapping (lines 171-187):

```typescript
const mediaWithUrls = await Promise.all((mediaLinks ?? []).map(async (link: any) => {
  const f = link.files;
  return {
    id: link.id,
    post_id: link.post_id,
    kind: f.kind,
    mime_type: f.mime_type,
    width: f.width,
    height: f.height,
    duration_seconds: f.duration_seconds,
    is_cover: link.is_cover,
    sort_order: link.sort_order,
    blur_data_url: f.blur_data_url ?? null,
    url: await deps.signGetUrl(f.r2_key, 3600),
    thumbnail_url: f.thumbnail_r2_key ? await deps.signGetUrl(f.thumbnail_r2_key, 3600) : null,
  };
}));
```

With:

```typescript
const mediaWithUrls = await Promise.all((mediaLinks ?? []).map(async (link: any) => {
  const f = link.files;
  const isDrive = !!f.google_drive_file_id;
  return {
    id: link.id,
    post_id: link.post_id,
    kind: f.kind,
    mime_type: f.mime_type,
    width: f.width,
    height: f.height,
    duration_seconds: f.duration_seconds,
    is_cover: link.is_cover,
    sort_order: link.sort_order,
    blur_data_url: f.blur_data_url ?? null,
    url: isDrive ? f.google_drive_thumbnail_url : await deps.signGetUrl(f.r2_key, 3600),
    thumbnail_url: isDrive ? f.google_drive_thumbnail_url : (f.thumbnail_r2_key ? await deps.signGetUrl(f.thumbnail_r2_key, 3600) : null),
    google_drive_file_id: f.google_drive_file_id ?? null,
    google_drive_view_url: f.google_drive_view_url ?? null,
  };
}));
```

- [ ] **Step 3: Run hub-posts tests**

Run: `deno test supabase/functions/__tests__/hub-posts*`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hub-posts/handler.ts
git commit -m "feat(edge): support google drive files in hub-posts"
```

---

### Task 4: Edge Function — Support Drive files in `file-manage`

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts`

The `file-manage` handler signs URLs when listing files and returning file URLs. It also needs a new POST route to create Drive file records.

- [ ] **Step 1: Update file listing to handle Drive files**

In `file-manage/handler.ts`, find the `signedFiles` mapping (around line 145) and update it to handle Drive files:

Replace:
```typescript
const signedFiles = await Promise.all((files ?? []).map(async (f: any) => ({
```

Find the full mapping block and update the `url` and `thumbnail_url` fields to check for Drive:

```typescript
const signedFiles = await Promise.all((files ?? []).map(async (f: any) => {
  const isDrive = !!f.google_drive_file_id;
  return {
    ...f,
    url: isDrive ? f.google_drive_thumbnail_url : (f.kind !== "document" ? await deps.signUrl(f.r2_key) : null),
    thumbnail_url: isDrive ? f.google_drive_thumbnail_url : (f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null),
  };
}));
```

- [ ] **Step 2: Update `GET /files/:id/url` to handle Drive files**

Find the route handler for `GET /files/:id/url` (around line 344-356). Update to return Drive URL when applicable:

Replace:
```typescript
const { data: file } = await svc.from("files").select("conta_id, r2_key").eq("id", fileId).single();
```

With:
```typescript
const { data: file } = await svc.from("files").select("conta_id, r2_key, google_drive_file_id, google_drive_view_url, google_drive_thumbnail_url").eq("id", fileId).single();
```

And update the URL return logic to check:

```typescript
if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);
if (file.google_drive_file_id) {
  return json({ url: file.google_drive_view_url ?? file.google_drive_thumbnail_url });
}
const url = await deps.signUrl(file.r2_key);
return json({ url });
```

- [ ] **Step 3: Add POST /files/drive route for creating Drive file records**

Add a new route before the existing `POST /files/:id/copy` block:

```typescript
// POST /files/drive → create a file record from Google Drive metadata
if (req.method === "POST" && idStr === "drive") {
  const body = await req.json().catch(() => ({}));
  const { name, kind, mime_type, size_bytes, width, height, google_drive_file_id,
    google_drive_thumbnail_url, google_drive_view_url, folder_id, post_id } = body as {
    name: string; kind: string; mime_type: string; size_bytes: number;
    width?: number; height?: number;
    google_drive_file_id: string; google_drive_thumbnail_url: string;
    google_drive_view_url: string; folder_id?: number; post_id?: number;
  };

  if (!name || !kind || !mime_type || !google_drive_file_id) {
    return json({ error: "name, kind, mime_type, and google_drive_file_id required" }, 400);
  }
  if (!["image", "video", "document"].includes(kind)) {
    return json({ error: "kind must be image, video, or document" }, 400);
  }

  const { data: created, error: insertErr } = await svc.from("files").insert({
    conta_id: contaId,
    folder_id: folder_id ?? null,
    name,
    kind,
    mime_type,
    size_bytes: size_bytes ?? 0,
    width: width ?? null,
    height: height ?? null,
    google_drive_file_id,
    google_drive_thumbnail_url,
    google_drive_view_url,
    uploaded_by: user.id,
  }).select().single();

  if (insertErr) return json({ error: insertErr.message }, 500);

  if (post_id) {
    const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", post_id).single();
    if (post && post.conta_id === contaId) {
      await svc.from("post_file_links").insert({
        post_id, file_id: created.id, conta_id: contaId,
      });
    }
  }

  return json(created, 201);
}
```

- [ ] **Step 4: Update link listing to handle Drive URLs**

In the GET `/links` handler (around line 516-526), update:

Replace:
```typescript
const withUrls = await Promise.all((links ?? []).map(async (l: any) => {
  const f = l.files;
  return {
    ...l,
    files: {
      ...f,
      url: f.kind !== "document" ? await deps.signUrl(f.r2_key) : null,
      thumbnail_url: f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null,
    },
  };
}));
```

With:

```typescript
const withUrls = await Promise.all((links ?? []).map(async (l: any) => {
  const f = l.files;
  const isDrive = !!f.google_drive_file_id;
  return {
    ...l,
    files: {
      ...f,
      url: isDrive ? f.google_drive_thumbnail_url : (f.kind !== "document" ? await deps.signUrl(f.r2_key) : null),
      thumbnail_url: isDrive ? f.google_drive_thumbnail_url : (f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null),
    },
  };
}));
```

- [ ] **Step 5: Run file-manage tests**

Run: `deno test supabase/functions/__tests__/file-manage*`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/file-manage/handler.ts
git commit -m "feat(edge): add drive file creation and drive-aware URL signing in file-manage"
```

---

### Task 5: TypeScript Types — Update `PostMedia` interface

**Files:**
- Modify: `apps/crm/src/store/posts.ts` (lines 39-60)

- [ ] **Step 1: Update the `PostMedia` interface**

In `apps/crm/src/store/posts.ts`, update the `PostMedia` interface:

```typescript
export interface PostMedia {
  id: number;
  post_id: number;
  conta_id: string;
  r2_key: string | null;
  thumbnail_r2_key: string | null;
  kind: 'image' | 'video' | 'document';
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
  blur_data_url?: string | null;
  // Populated only on hydrated responses
  url?: string;
  thumbnail_url?: string | null;
  // Google Drive fields (null for R2-sourced files)
  google_drive_file_id?: string | null;
  google_drive_view_url?: string | null;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`
Expected: No type errors (new fields are optional, `r2_key` is now nullable — check for any code that assumes it's non-null).

- [ ] **Step 3: Fix any type errors**

If `r2_key` being nullable causes errors (e.g., in `postMedia.ts` deletion enqueue), those paths should be guarded with `if (m.r2_key)` checks. The `post_media_enqueue_delete` DB trigger already handles null via `OLD.r2_key` — but the `post-media-manage` DELETE handler may need a guard.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/store/posts.ts
git commit -m "feat(types): add google drive fields to PostMedia interface"
```

---

### Task 6: Google Drive Picker Service

**Files:**
- Create: `apps/crm/src/services/googleDrive.ts`

- [ ] **Step 1: Create the Google Drive service**

```typescript
// apps/crm/src/services/googleDrive.ts

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

const ACCEPTED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf',
];

let gapiLoaded = false;
let gisLoaded = false;
let accessToken: string | null = null;
let tokenClient: google.accounts.oauth2.TokenClient | null = null;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailUrl: string | null;
  viewUrl: string;
  width: number | null;
  height: number | null;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function loadPickerSdk(): Promise<void> {
  if (!gapiLoaded) {
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise<void>((resolve) => gapi.load('picker', resolve));
    gapiLoaded = true;
  }
  if (!gisLoaded) {
    await loadScript('https://accounts.google.com/gsi/client');
    gisLoaded = true;
  }
}

function requestAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.error) { reject(new Error(response.error)); return; }
          accessToken = response.access_token;
          resolve(response.access_token);
        },
      });
    }
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

async function getAccessToken(): Promise<string> {
  if (accessToken) return accessToken;
  return requestAccessToken();
}

export async function openPicker(): Promise<DriveFile[]> {
  await loadPickerSdk();
  const token = await getAccessToken();

  return new Promise((resolve) => {
    const view = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes(ACCEPTED_MIME_TYPES.join(','));

    const picker = new google.picker.PickerBuilder()
      .setAppId(APP_ID)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .addView(view)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setCallback((data: google.picker.ResponseObject) => {
        if (data.action === google.picker.Action.PICKED) {
          const files: DriveFile[] = data.docs.map((doc) => ({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes ?? 0,
            thumbnailUrl: doc.thumbnails?.[0]?.url
              ?? `https://lh3.googleusercontent.com/d/${doc.id}=s400`,
            viewUrl: doc.url,
            width: doc.mediaMetadata?.width ?? null,
            height: doc.mediaMetadata?.height ?? null,
          }));
          resolve(files);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();

    picker.setVisible(true);
  });
}

export function revokeAccess(): void {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
  }
}
```

- [ ] **Step 2: Add Google Picker type declarations**

Create `apps/crm/src/types/google-picker.d.ts`:

```typescript
// apps/crm/src/types/google-picker.d.ts

declare namespace google.accounts.oauth2 {
  interface TokenClient {
    requestAccessToken(opts?: { prompt?: string }): void;
  }
  interface TokenResponse {
    access_token: string;
    error?: string;
  }
  function initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
  }): TokenClient;
  function revoke(token: string, callback: () => void): void;
}

declare namespace google.picker {
  enum Action { PICKED = 'picked', CANCEL = 'cancel' }
  enum Feature { MULTISELECT_ENABLED = 'multiselect' }

  interface ResponseObject {
    action: Action;
    docs: PickerDocument[];
  }

  interface PickerDocument {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes?: number;
    url: string;
    thumbnails?: { url: string }[];
    mediaMetadata?: { width?: number; height?: number };
  }

  class DocsView {
    constructor();
    setIncludeFolders(include: boolean): this;
    setSelectFolderEnabled(enabled: boolean): this;
    setMimeTypes(mimeTypes: string): this;
  }

  class PickerBuilder {
    setAppId(appId: string): this;
    setOAuthToken(token: string): this;
    setDeveloperKey(key: string): this;
    addView(view: DocsView): this;
    enableFeature(feature: Feature): this;
    setCallback(callback: (data: ResponseObject) => void): this;
    build(): Picker;
  }

  interface Picker {
    setVisible(visible: boolean): void;
    dispose(): void;
  }
}

declare namespace gapi {
  function load(api: string, callback: () => void): void;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run build`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/services/googleDrive.ts apps/crm/src/types/google-picker.d.ts
git commit -m "feat: add google drive picker service and type declarations"
```

---

### Task 7: Post Media Service — Add `addDriveMedia` function

**Files:**
- Modify: `apps/crm/src/services/postMedia.ts`

- [ ] **Step 1: Add the `addDriveMedia` function**

Add at the end of `apps/crm/src/services/postMedia.ts`:

```typescript
export async function addDriveMedia(postId: number, driveFiles: {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailUrl: string | null;
  viewUrl: string;
  width: number | null;
  height: number | null;
}[]): Promise<void> {
  await Promise.all(driveFiles.map((f) => {
    const kind = f.mimeType.startsWith('image/') ? 'image'
      : f.mimeType.startsWith('video/') ? 'video'
      : 'document';
    return callFn('file-manage', 'POST', {
      name: f.name,
      kind,
      mime_type: f.mimeType,
      size_bytes: f.sizeBytes,
      width: f.width,
      height: f.height,
      google_drive_file_id: f.id,
      google_drive_thumbnail_url: f.thumbnailUrl,
      google_drive_view_url: f.viewUrl,
      post_id: postId,
    }, undefined, '/files/drive');
  }));
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/services/postMedia.ts
git commit -m "feat: add addDriveMedia function to postMedia service"
```

---

### Task 8: UI — Add Google Drive button to PostMediaGallery

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`
- Modify: `packages/i18n/locales/pt/posts.json`
- Modify: `packages/i18n/locales/en/posts.json`

- [ ] **Step 1: Add i18n keys**

In `packages/i18n/locales/pt/posts.json`, add to the `mediaGallery` object:

```json
"googleDrive": "Google Drive",
"driveLinked": "Arquivo(s) do Drive vinculado(s)",
"openInDrive": "Abrir no Drive"
```

In `packages/i18n/locales/en/posts.json`, add to the `mediaGallery` object:

```json
"googleDrive": "Google Drive",
"driveLinked": "Drive file(s) linked",
"openInDrive": "Open in Drive"
```

- [ ] **Step 2: Add Drive button and handler to PostMediaGallery**

In `PostMediaGallery.tsx`, add the import at the top:

```typescript
import { openPicker, type DriveFile } from '../../../services/googleDrive';
import { addDriveMedia } from '../../../services/postMedia';
```

Note: `addDriveMedia` is already exported from `postMedia.ts` — just add it to the existing import. Also add `HardDrive` (or use a custom SVG) to the lucide-react import. Actually, lucide-react does not have a Google Drive icon. Instead we'll use a small inline SVG or just the `HardDrive` icon with "Drive" label. Let's keep it simple and import `CloudUpload` from lucide-react as the Drive button icon — or better, use a custom Google Drive SVG icon component.

Update the lucide-react import to include nothing new (we'll use an inline SVG for the Google Drive icon).

Add the Drive file handler function inside the `PostMediaGallery` component, after `handlePickFiles`:

```typescript
async function handleDriveFiles() {
  try {
    const files = await openPicker();
    if (files.length === 0) return;
    await addDriveMedia(postId, files);
    refresh();
    toast.success(t('mediaGallery.driveLinked'));
  } catch (e) {
    toast.error((e as Error).message);
  }
}
```

- [ ] **Step 3: Add the Drive button to the gallery grid**

In the JSX, after the existing `FolderOpen` button (around line 319-327), add:

```tsx
{!disabled && !atLimit && (
  <button
    type="button"
    onClick={handleDriveFiles}
    className="flex flex-col items-center justify-center gap-1 aspect-square rounded-xl border border-dashed border-stone-300 bg-stone-50 text-stone-500 hover:border-stone-400 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:bg-stone-700 cursor-pointer transition-colors"
  >
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.71 3.5L1.15 15l2.79 4.84L10.5 8.34zm1.74 0l6.56 11.34H2.84L9.45 3.5zm8.27 7.16L22.85 15l-2.79 4.84-5.13-8.84v-.34zm-.58 1l-2.79 4.84H7.42l2.79-4.84z"/>
    </svg>
    <span className="text-[11px]">{t('mediaGallery.googleDrive')}</span>
  </button>
)}
```

- [ ] **Step 4: Update SortableMediaTile to handle Drive files**

In `SortableMediaTile`, update the rendering to handle Drive-sourced media. The `url` field will already be populated with the Drive thumbnail URL by the backend, so the existing rendering works for images.

For the "Open in Drive" action, add a new button in the overlay. Update the `SortableMediaTile` component to accept and use `google_drive_view_url`:

In the hover overlay `div` (around line 443-460), add before the delete button:

```tsx
{m.google_drive_view_url && (
  <a
    href={m.google_drive_view_url}
    target="_blank"
    rel="noopener noreferrer"
    onClick={(e) => e.stopPropagation()}
    title={tc('mediaGallery.openInDrive', { ns: 'posts' })}
    className="flex items-center justify-center w-6 h-6 rounded-full bg-stone-900/85 text-white hover:bg-stone-900"
  >
    <ExternalLink className="h-3 w-3" />
  </a>
)}
```

Add `ExternalLink` to the lucide-react import at the top of the file.

- [ ] **Step 5: Handle thumbnail error fallback**

For Drive media where the thumbnail URL might have expired, add an `onError` handler on the image. In `SortableMediaTile`, wrap the image rendering:

Replace the image rendering section:
```tsx
{m.kind === 'image' ? (
  <OptimizedImage ... />
) : (
  <video ... />
)}
```

With:
```tsx
{m.kind === 'image' ? (
  m.google_drive_view_url ? (
    <img
      src={m.url ?? ''}
      alt={m.original_filename}
      className="w-full h-full object-cover pointer-events-none"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  ) : (
    <OptimizedImage
      src={m.url ?? ''}
      alt={m.original_filename}
      width={m.width ?? undefined}
      height={m.height ?? undefined}
      blurDataURL={m.blur_data_url ?? undefined}
      className="w-full h-full object-cover pointer-events-none"
    />
  )
) : m.kind === 'document' ? (
  <div className="w-full h-full flex flex-col items-center justify-center bg-stone-100 dark:bg-stone-800 text-stone-500">
    <svg className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
    <span className="text-[9px] truncate max-w-full px-1">{m.original_filename}</span>
  </div>
) : (
  <video src={m.url ?? undefined} poster={m.thumbnail_url ?? undefined} muted className="w-full h-full object-cover pointer-events-none" />
)}
```

- [ ] **Step 6: Run typecheck**

Run: `npm run build`
Expected: No type errors.

- [ ] **Step 7: Run tests**

Run: `npm run test`
Expected: All existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostMediaGallery.tsx packages/i18n/locales/pt/posts.json packages/i18n/locales/en/posts.json
git commit -m "feat(ui): add google drive picker button to post media gallery"
```

---

### Task 9: Manual Testing & Env Vars

**Files:**
- Modify: `.env.example` (add new env vars)

- [ ] **Step 1: Add env vars to `.env.example`**

Add to `.env.example`:

```
# Google Drive Picker (client-side)
VITE_GOOGLE_CLIENT_ID=
VITE_GOOGLE_APP_ID=
VITE_GOOGLE_API_KEY=
```

- [ ] **Step 2: Set up Google Cloud Console**

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable: **Google Picker API** and **Google Drive API**
4. Create OAuth 2.0 Client ID (Web application):
   - Authorized JavaScript origins: `http://localhost:5173`
   - (Add production domain later)
5. Create API Key:
   - Restrict to Google Picker API and Google Drive API
6. Copy Client ID, Project Number (App ID), and API Key to `.env.local`

- [ ] **Step 3: Test the full flow**

1. Run `npm run dev`
2. Navigate to a post editor
3. Click the Google Drive button in the media gallery
4. Authenticate with Google (popup)
5. Select one or more files
6. Verify files appear in the gallery with Drive thumbnails
7. Verify "Open in Drive" button appears on hover
8. Verify delete works (removes record, no R2 cleanup errors)
9. Verify cover selection works on Drive media

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs: add google drive env vars to .env.example"
```
