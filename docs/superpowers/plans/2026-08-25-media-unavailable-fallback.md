# Placeholder "Mídia indisponível" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser's broken-image icon with a clean "Mídia indisponível" placeholder everywhere a post's attached image/video was permanently lost in the August 2026 R2 incident (`files.media_lost_at` set), across the Hub (client) and CRM (internal).

**Architecture:** Three edge functions (`hub-posts`, `post-media-manage`, `file-manage`) stop signing dead URLs for flagged files and return `media_lost_at` instead; the frontend checks that field before ever rendering an `<img>`/`<video>`, swapping in a small new `MediaUnavailable` component where no existing null-safe fallback already covers it.

**Tech Stack:** Deno edge functions + Supabase Postgres (backend), React 19 + TypeScript + Vitest (Hub & CRM frontends), `lucide-react` icons.

**Spec:** [docs/superpowers/specs/2026-08-25-media-unavailable-fallback-design.md](../specs/2026-08-25-media-unavailable-fallback-design.md)

## Global Constraints

- No new migration — `files.media_lost_at timestamptz` already exists (migration `20260814000003`).
- Copy is the same everywhere: the literal string `Mídia indisponível`. No audience-specific variants.
- `media_lost_at` is always present in a post-deploy response: `null` = file ok, ISO timestamp = permanently lost. Frontend code must check the *value* (`Boolean(media.media_lost_at)`), never key presence.
- Icon: `ImageOff` from `lucide-react` (matches the existing sibling empty-state in `PostMediaGallery.tsx`).
- Out of scope, do not touch: `supabase/functions/mcp/queries.ts`, `_shared/instagram-publish-utils.ts`, `_shared/tiktok-publish-utils.ts`, `supabase/functions/sign-r2-urls/handler.ts`, `hub-posts`'s `contentUrlMap` inline-image logic, `file-manage`'s `GET /files/:id/url`.
- Before the final commit of each task: run that task's own test command. Before the branch is done (Task 7): run the full CLAUDE.md pre-push checklist (lint, format:check, four `tsc` commands, `npm run test`, `npm run test:functions`).
- Deno test command for a single file: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys <path>`.
- Vitest command for a single file: `npx vitest run <path>`.

---

## File-structure map (what this plan touches)

**Backend (Deno edge functions):**
- `supabase/functions/hub-posts/handler.ts` — select + skip-sign for attached post media (Hub read path)
- `supabase/functions/post-media-manage/handler.ts` — same, for CRM's post-media API (4 call sites + `toLegacy()`)
- `supabase/functions/file-manage/handler.ts` — same, for the Arquivos API (`GET /folders` + `GET /links`)

**Frontend — new components:**
- `apps/hub/src/components/MediaUnavailable.tsx` (new)
- `apps/crm/src/components/MediaUnavailable.tsx` (new)

**Frontend — types:**
- `apps/hub/src/types.ts` (`HubPostMedia` — breaking: `url` goes from `string` to `string | null`)
- `apps/crm/src/store/posts.ts` (`PostMedia` — additive only, `url`/`thumbnail_url` already optional)
- `apps/crm/src/pages/arquivos/types.ts` (`FileRecord` — additive only)

**Frontend — render sites that need an explicit guard** (confirmed while reading the actual code — every other candidate site already degrades gracefully once the backend returns `null`, see "Free-pass sites" below):
- Hub: `InstagramPostCard.tsx`, `StoryPostCard.tsx`, `PostCard.tsx` (two spots), `PostMediaLightbox.tsx`
- CRM: `PostMediaGallery.tsx` (`SortableMediaTile` + the `onEditThumbnail` entry point), `PostMediaLightbox.tsx`, `WorkflowCard.tsx`, `ThumbnailPickerDialog.tsx`

**Free-pass sites (no source change — confirmed by reading each one; only regression-tested):**
- Hub `InstagramGridPreview.tsx` / CRM `WorkflowGridView.tsx` — both feed the shared `packages/ui/InstagramGrid`, which already renders a neutral placeholder div when `thumbnailUrl`/`videoUrl` are both falsy.
- CRM `CalendarPostDetailPanel.tsx` — already falls back to its own empty-state icon when `thumbUrl` is falsy.
- CRM `FileGrid.tsx` / `FilePickerModal.tsx` — already fall back to `<FileIcon>` when `thumbnail_url ?? url` is falsy.
- CRM `PostChip.tsx` / `MobileArquivosView.tsx` (two spots) — same pattern; verified by reading the code, covered only by Task 7's manual check (see that task for why).

---

## Task 1: Backend — `hub-posts`

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts:198-226`
- Test: `supabase/functions/__tests__/hub-functions_test.ts`

**Interfaces:**
- Produces: `hub-posts`'s `GET /hub-posts` response now includes `media_lost_at: string | null` on every item in `posts[].media[]` and `posts[].cover_media`; `url`/`thumbnail_url` are `null` instead of a signed URL when `media_lost_at` is set. Later tasks (Hub frontend) consume exactly this shape.

- [ ] **Step 1: Write the failing test**

Add this test to `supabase/functions/__tests__/hub-functions_test.ts`, right after the existing `"hub-posts returns flattened post data with signed media URLs"` test (around line 164):

```ts
Deno.test("hub-posts omits signed URLs and returns media_lost_at for a permanently lost file", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [{ id: 7 }], error: null });
  db.queue("workflow_posts", "select", {
    data: [
      {
        id: 99,
        titulo: "Post com mídia perdida",
        tipo: "feed",
        status: "enviado_cliente",
        ordem: 0,
        conteudo_plain: "Legenda",
        scheduled_at: "2026-04-20T10:00:00.000Z",
        platform: "instagram",
        workflow_id: 7,
        workflows: { titulo: "Calendário Abril" },
      },
    ],
    error: null,
  });
  db.queue("post_approvals", "select", { data: [], error: null });
  db.queue("post_property_values", "select", { data: [], error: null });
  db.queue("workflow_select_options", "select", { data: [], error: null });
  db.queue("post_file_links", "select", {
    data: [
      {
        id: 1,
        post_id: 99,
        is_cover: true,
        sort_order: 0,
        files: {
          id: 10,
          kind: "image",
          mime_type: "image/png",
          r2_key: "contas/1/lost.png",
          thumbnail_r2_key: "contas/1/lost.thumb.webp",
          width: 1080,
          height: 1350,
          duration_seconds: null,
          blur_data_url: null,
          media_lost_at: "2026-08-14T03:00:00.000Z",
        },
      },
    ],
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: { username: "studio_marca", profile_picture_url: "https://cdn.ig/pic.jpg" },
    error: null,
  });

  let signCalls = 0;
  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => {
      signCalls++;
      return `https://signed.mesaas.com/${key}`;
    },
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.posts[0].cover_media.url, null);
  assertEquals(body.posts[0].cover_media.thumbnail_url, null);
  assertEquals(body.posts[0].cover_media.media_lost_at, "2026-08-14T03:00:00.000Z");
  assertEquals(signCalls, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-functions_test.ts --filter "hub-posts omits signed URLs"`
Expected: FAIL — `body.posts[0].cover_media.url` is a signed URL, not `null`; `signCalls` is `1`, not `0`.

- [ ] **Step 3: Implement**

In `supabase/functions/hub-posts/handler.ts`, replace the `mediaLinks` select and `mediaWithUrls` mapping (current lines 198-226):

```ts
    const { data: mediaLinks } = postIds.length > 0
      ? await db
          .from("post_file_links")
          .select("id, post_id, is_cover, sort_order, files(id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, blur_data_url, stream_uid, stream_status)")
          .in("post_id", postIds)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
      : { data: [] };

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
        playback: f.stream_uid && f.stream_status === "ready" && deps.signPlayback
          ? await deps.signPlayback(f.stream_uid)
          : null,
      };
    }));
```

with:

```ts
    const { data: mediaLinks } = postIds.length > 0
      ? await db
          .from("post_file_links")
          .select("id, post_id, is_cover, sort_order, files(id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, blur_data_url, stream_uid, stream_status, media_lost_at)")
          .in("post_id", postIds)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
      : { data: [] };

    const mediaWithUrls = await Promise.all((mediaLinks ?? []).map(async (link: any) => {
      const f = link.files;
      const lost = !!f.media_lost_at;
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
        url: lost ? null : await deps.signGetUrl(f.r2_key, 3600),
        thumbnail_url: lost || !f.thumbnail_r2_key ? null : await deps.signGetUrl(f.thumbnail_r2_key, 3600),
        media_lost_at: f.media_lost_at ?? null,
        playback: f.stream_uid && f.stream_status === "ready" && deps.signPlayback
          ? await deps.signPlayback(f.stream_uid)
          : null,
      };
    }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-functions_test.ts`
Expected: PASS — all tests in the file, including the new one and the pre-existing `"hub-posts returns flattened post data with signed media URLs"` (proves the healthy-file path is untouched).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-posts/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub-posts): omit signed URL and return media_lost_at for permanently lost files"
```

---

## Task 2: Backend — `post-media-manage`

**Files:**
- Modify: `supabase/functions/post-media-manage/handler.ts:24-56,126-135,163-172,181-194,228-233`
- Test: `supabase/functions/__tests__/post-media-manage_test.ts`

**Interfaces:**
- Produces: every response shape this function returns (`{covers}`, `{covers: [{post_id, media}]}`, `{media}`, and the PATCH response) now includes `media_lost_at: string | null` on each media object, with `url`/`thumbnail_url` `null` when lost. Later tasks (CRM Entregas frontend) consume this shape via `PostMedia`.

- [ ] **Step 1: Write the failing test**

Add this test to `supabase/functions/__tests__/post-media-manage_test.ts`, right after the existing `"post-media-manage: GET with post_id returns media in legacy format"` test (around line 150+):

```ts
Deno.test("post-media-manage: GET with post_id omits signed URL and returns media_lost_at for a permanently lost file", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "select", {
    data: [{ ...sampleLink, files: { ...sampleFile, media_lost_at: "2026-08-14T03:00:00.000Z" } }],
    error: null,
  });
  let signCalls = 0;
  const handler = makeHandler(db, {
    signUrl: async (key) => {
      signCalls++;
      return `https://signed.example.com/${key}`;
    },
  });
  const res = await handler(req("GET", "?post_id=50"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.media[0].url, null);
  assertEquals(body.media[0].thumbnail_url, null);
  assertEquals(body.media[0].media_lost_at, "2026-08-14T03:00:00.000Z");
  assertEquals(signCalls, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/post-media-manage_test.ts --filter "omits signed URL and returns media_lost_at"`
Expected: FAIL — `body.media[0].url` is a signed URL; `body.media[0].media_lost_at` is `undefined`; `signCalls` is `1`.

- [ ] **Step 3: Implement**

In `supabase/functions/post-media-manage/handler.ts`:

**3a.** Replace `toLegacy()` (current lines 24-56):

```ts
function toLegacy(
  link: any,
  file: any,
  url: string,
  thumbnailUrl: string | null,
  playback: { hls: string; expires_at: string } | null,
) {
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
    // 'manual' | 'design' (T4.1) — lets the CRM distinguish Estúdio-rendered tiles from user
    // uploads (design §5.2 read paths; the column existed but was invisible to clients).
    origin: link.origin ?? "manual",
    uploaded_by: file.uploaded_by,
    created_at: file.created_at,
    blur_data_url: file.blur_data_url ?? null,
    url,
    thumbnail_url: thumbnailUrl,
    playback,
  };
}
```

with:

```ts
function toLegacy(
  link: any,
  file: any,
  url: string | null,
  thumbnailUrl: string | null,
  playback: { hls: string; expires_at: string } | null,
) {
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
    // 'manual' | 'design' (T4.1) — lets the CRM distinguish Estúdio-rendered tiles from user
    // uploads (design §5.2 read paths; the column existed but was invisible to clients).
    origin: link.origin ?? "manual",
    uploaded_by: file.uploaded_by,
    created_at: file.created_at,
    blur_data_url: file.blur_data_url ?? null,
    media_lost_at: file.media_lost_at ?? null,
    url,
    thumbnail_url: thumbnailUrl,
    playback,
  };
}
```

**3b.** Add a helper right after `resolvePlayback` (current lines 58-65):

```ts
async function signIfPresent(
  file: any,
  deps: Pick<PostMediaManageDeps, "signUrl">,
): Promise<{ url: string | null; thumbnailUrl: string | null }> {
  if (file.media_lost_at) return { url: null, thumbnailUrl: null };
  const url = await deps.signUrl(file.r2_key);
  const thumbnailUrl = file.thumbnail_r2_key ? await deps.signUrl(file.thumbnail_r2_key) : null;
  return { url, thumbnailUrl };
}
```

**3c.** Replace each of the 4 call sites. Workflow covers (current lines 128-134):

```ts
          media: await Promise.all(links.map(async (l: any) => {
            const f = l.files;
            const u = await deps.signUrl(f.r2_key);
            const tu = f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null;
            const playback = await resolvePlayback(f, deps);
            return toLegacy(l, f, u, tu, playback);
          })),
```

becomes:

```ts
          media: await Promise.all(links.map(async (l: any) => {
            const f = l.files;
            const { url: u, thumbnailUrl: tu } = await signIfPresent(f, deps);
            const playback = await resolvePlayback(f, deps);
            return toLegacy(l, f, u, tu, playback);
          })),
```

Post covers (current lines 165-171):

```ts
        const covers = await Promise.all(Array.from(coverByPost.values()).map(async (l: any) => {
          const f = l.files;
          const u = await deps.signUrl(f.r2_key);
          const tu = f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null;
          const playback = await resolvePlayback(f, deps);
          return { post_id: l.post_id, media: toLegacy(l, f, u, tu, playback) };
        }));
```

becomes:

```ts
        const covers = await Promise.all(Array.from(coverByPost.values()).map(async (l: any) => {
          const f = l.files;
          const { url: u, thumbnailUrl: tu } = await signIfPresent(f, deps);
          const playback = await resolvePlayback(f, deps);
          return { post_id: l.post_id, media: toLegacy(l, f, u, tu, playback) };
        }));
```

Media by post_id (current lines 187-193):

```ts
      const media = await Promise.all((links ?? []).map(async (l: any) => {
        const f = l.files;
        const u = await deps.signUrl(f.r2_key);
        const tu = f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null;
        const playback = await resolvePlayback(f, deps);
        return toLegacy(l, f, u, tu, playback);
      }));
```

becomes:

```ts
      const media = await Promise.all((links ?? []).map(async (l: any) => {
        const f = l.files;
        const { url: u, thumbnailUrl: tu } = await signIfPresent(f, deps);
        const playback = await resolvePlayback(f, deps);
        return toLegacy(l, f, u, tu, playback);
      }));
```

PATCH response (current lines 229-233):

```ts
      const uf = (updatedLink as any).files;
      const u = await deps.signUrl(uf.r2_key);
      const tu = uf.thumbnail_r2_key ? await deps.signUrl(uf.thumbnail_r2_key) : null;
      const playback = await resolvePlayback(uf, deps);
      return json(toLegacy(updatedLink, uf, u, tu, playback));
```

becomes:

```ts
      const uf = (updatedLink as any).files;
      const { url: u, thumbnailUrl: tu } = await signIfPresent(uf, deps);
      const playback = await resolvePlayback(uf, deps);
      return json(toLegacy(updatedLink, uf, u, tu, playback));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/post-media-manage_test.ts`
Expected: PASS — all tests, including the pre-existing GET/PATCH tests (proves `signIfPresent` didn't change the healthy-file path).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/post-media-manage/handler.ts supabase/functions/__tests__/post-media-manage_test.ts
git commit -m "feat(post-media-manage): omit signed URL and return media_lost_at for permanently lost files"
```

---

## Task 3: Backend — `file-manage`

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts:155-165,568-579`
- Test: `supabase/functions/__tests__/file-manage_test.ts`

**Interfaces:**
- Produces: `GET /folders`'s `files[]` and `GET /links`'s `links[].files` both carry `media_lost_at` (already present via the `...pub` spread of `select("*")`/`files(*)` — no explicit field addition needed here, only the signing guard) with `url`/`thumbnail_url` `null` when lost.

- [ ] **Step 1: Write the failing tests**

Add both tests to `supabase/functions/__tests__/file-manage_test.ts`, after the existing `"file-manage: GET /folders lists root folders and files"` test:

```ts
Deno.test("file-manage: GET /folders omits signed URL for a permanently lost file", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", {
    data: [{
      id: 10,
      name: "lost.png",
      kind: "image",
      r2_key: "contas/conta-1/files/lost.png",
      thumbnail_r2_key: "contas/conta-1/files/lost.thumb.webp",
      media_lost_at: "2026-08-14T03:00:00.000Z",
    }],
    error: null,
  });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 5000 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  let signCalls = 0;
  const handler = makeHandler(db, {
    signUrl: async (key) => {
      signCalls++;
      return `https://signed.example.com/${key}`;
    },
  });
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.files[0].url, null);
  assertEquals(body.files[0].thumbnail_url, null);
  assertEquals(body.files[0].media_lost_at, "2026-08-14T03:00:00.000Z");
  assertEquals(signCalls, 0);
});

Deno.test("file-manage: GET /links omits signed URL for a permanently lost file", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", {
    data: [{
      id: 1,
      post_id: 50,
      conta_id: "conta-1",
      is_cover: true,
      sort_order: 0,
      files: {
        id: 10,
        name: "lost.png",
        kind: "image",
        r2_key: "contas/conta-1/files/lost.png",
        thumbnail_r2_key: null,
        media_lost_at: "2026-08-14T03:00:00.000Z",
      },
    }],
    error: null,
  });
  let signCalls = 0;
  const handler = makeHandler(db, {
    signUrl: async (key) => {
      signCalls++;
      return `https://signed.example.com/${key}`;
    },
  });
  const res = await handler(req("GET", "/links?post_id=50"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.links[0].files.url, null);
  assertEquals(body.links[0].files.media_lost_at, "2026-08-14T03:00:00.000Z");
  assertEquals(signCalls, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/file-manage_test.ts --filter "omits signed URL"`
Expected: FAIL for both — `url` is a signed URL, `signCalls` is `1`.

- [ ] **Step 3: Implement**

In `supabase/functions/file-manage/handler.ts`, replace the `GET /folders` signing block (current lines 155-165):

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

with:

```ts
        const signedFiles = await Promise.all((files ?? []).map(async (f: any) => {
          const { stream_uid, stream_status, ...pub } = f;
          const lost = !!f.media_lost_at;
          return {
            ...pub,
            url: lost || f.kind === "document" ? null : await deps.signUrl(f.r2_key),
            thumbnail_url: lost || !f.thumbnail_r2_key ? null : await deps.signUrl(f.thumbnail_r2_key),
            playback: stream_uid && stream_status === "ready" && deps.signPlayback
              ? await deps.signPlayback(stream_uid)
              : null,
          };
        }));
```

Replace the `GET /links` signing block (current lines 568-579):

```ts
        const withUrls = await Promise.all((links ?? []).map(async (l: any) => {
          const f = l.files;
          const { stream_uid, stream_status, ...pub } = f;
          return {
            ...l,
            files: {
              ...pub,
              url: f.kind !== "document" ? await deps.signUrl(f.r2_key) : null,
              thumbnail_url: f.thumbnail_r2_key ? await deps.signUrl(f.thumbnail_r2_key) : null,
            },
          };
        }));
```

with:

```ts
        const withUrls = await Promise.all((links ?? []).map(async (l: any) => {
          const f = l.files;
          const { stream_uid, stream_status, ...pub } = f;
          const lost = !!f.media_lost_at;
          return {
            ...l,
            files: {
              ...pub,
              url: lost || f.kind === "document" ? null : await deps.signUrl(f.r2_key),
              thumbnail_url: lost || !f.thumbnail_r2_key ? null : await deps.signUrl(f.thumbnail_r2_key),
            },
          };
        }));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/file-manage_test.ts`
Expected: PASS — all tests, including the pre-existing `GET /folders` test.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/file-manage/handler.ts supabase/functions/__tests__/file-manage_test.ts
git commit -m "feat(file-manage): omit signed URL for permanently lost files on GET /folders and GET /links"
```

---

## Task 4: Hub frontend — `MediaUnavailable` + type + 5 render sites

**Files:**
- Create: `apps/hub/src/components/MediaUnavailable.tsx`
- Test: `apps/hub/src/components/__tests__/MediaUnavailable.test.tsx`
- Modify: `apps/hub/src/types.ts` (`HubPostMedia`)
- Modify: `apps/hub/src/components/InstagramPostCard.tsx:358-389`
- Modify: `apps/hub/src/components/StoryPostCard.tsx:114-154`
- Modify: `apps/hub/src/components/PostCard.tsx:276-305,411-443`
- Modify: `apps/hub/src/components/PostMediaLightbox.tsx:135-154`
- Test: `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx`, `StoryPostCard.test.tsx`, `PostCard.test.tsx`, `PostMediaLightbox.test.tsx`

**Interfaces:**
- Consumes: Task 1's `hub-posts` response shape (`HubPostMedia.media_lost_at`, `url: string | null`).
- Produces: `MediaUnavailable({size?: 'compact' | 'full', className?: string})` — a default export-free named component, reused by Task 5/6 as the pattern (not the same component — CRM gets its own copy per the "no cross-app shared component" decision in the spec).

- [ ] **Step 1: Write the failing test for `MediaUnavailable`**

Create `apps/hub/src/components/__tests__/MediaUnavailable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MediaUnavailable } from '../MediaUnavailable';

describe('MediaUnavailable', () => {
  it('shows the label in full size', () => {
    render(<MediaUnavailable />);
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });

  it('hides the label in compact size', () => {
    render(<MediaUnavailable size="compact" />);
    expect(screen.queryByText('Mídia indisponível')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/hub/src/components/__tests__/MediaUnavailable.test.tsx`
Expected: FAIL — cannot find module `../MediaUnavailable`.

- [ ] **Step 3: Create `MediaUnavailable`**

Create `apps/hub/src/components/MediaUnavailable.tsx`:

```tsx
import { ImageOff } from 'lucide-react';

export interface MediaUnavailableProps {
  /** 'compact' shows only the icon (tight spaces); 'full' adds the label. */
  size?: 'compact' | 'full';
  className?: string;
}

export function MediaUnavailable({ size = 'full', className = '' }: MediaUnavailableProps) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1.5 hub-bg-soft hub-tx3 ${className}`}
    >
      <ImageOff
        className={size === 'compact' ? 'h-4 w-4 opacity-60' : 'h-6 w-6 opacity-60'}
        aria-hidden="true"
      />
      {size === 'full' && <span className="text-xs font-medium">Mídia indisponível</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/hub/src/components/__tests__/MediaUnavailable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Flip the `HubPostMedia` type**

In `apps/hub/src/types.ts`, replace (current lines 32-46):

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
  blur_data_url?: string | null;
  playback?: { hls: string; expires_at: string } | null;
}
```

with:

```ts
export interface HubPostMedia {
  id: number;
  post_id: number;
  kind: 'image' | 'video';
  mime_type: string;
  url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_cover: boolean;
  sort_order: number;
  blur_data_url?: string | null;
  playback?: { hls: string; expires_at: string } | null;
  /** ISO timestamp when this file was permanently lost (Aug 2026 R2 incident and any
   * future reconciliation); null when the file is fine. Optional only because a
   * response cached before this field shipped omits the key — check the value,
   * never key presence. */
  media_lost_at?: string | null;
}
```

- [ ] **Step 6: Run the Hub typecheck to find every consumer that breaks**

Run: `npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: FAIL — errors in `InstagramPostCard.tsx`, `StoryPostCard.tsx`, `PostCard.tsx`, `PostMediaLightbox.tsx` (the 5 sites below). If `tsc` reports errors in any file NOT listed in this task, stop and re-scope — it means a consumer this plan didn't account for.

- [ ] **Step 7: Fix `InstagramPostCard.tsx`**

Add the import (near the existing `OptimizedImage` import):

```tsx
import { MediaUnavailable } from './MediaUnavailable';
```

Replace (current lines 358-389, the media + video-overlay block):

```tsx
              {m.kind === 'image' ? (
                <OptimizedImage
                  src={m.url}
                  alt=""
                  width={m.width ?? undefined}
                  height={m.height ?? undefined}
                  blurDataURL={m.blur_data_url ?? undefined}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  priority={priority && i === 0}
                  className="w-full h-full object-cover pointer-events-none"
                />
              ) : (
                <img
                  src={m.thumbnail_url ?? ''}
                  alt=""
                  width={4}
                  height={5}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="w-full h-full object-cover pointer-events-none"
                />
              )}
            </button>
          ))}
        </div>
```

with:

```tsx
              {m.media_lost_at ? (
                <MediaUnavailable size="compact" />
              ) : m.kind === 'image' ? (
                <OptimizedImage
                  src={m.url ?? ''}
                  alt=""
                  width={m.width ?? undefined}
                  height={m.height ?? undefined}
                  blurDataURL={m.blur_data_url ?? undefined}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  priority={priority && i === 0}
                  className="w-full h-full object-cover pointer-events-none"
                />
              ) : (
                <img
                  src={m.thumbnail_url ?? ''}
                  alt=""
                  width={4}
                  height={5}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="w-full h-full object-cover pointer-events-none"
                />
              )}
            </button>
          ))}
        </div>
```

Then find the video play-icon overlay right below it (`{m.kind === 'video' && (`) and add the same guard so a lost video doesn't show a play button over the placeholder:

```tsx
              {m.kind === 'video' && (
```

becomes:

```tsx
              {m.kind === 'video' && !m.media_lost_at && (
```

- [ ] **Step 8: Fix `StoryPostCard.tsx`**

Add the import next to the existing `OptimizedImage` import:

```tsx
import { MediaUnavailable } from './MediaUnavailable';
```

Then replace the media block (current lines 114-141, inside the `{currentMedia && (<button>...)` wrapper):

```tsx
            {currentMedia.kind === 'image' ? (
              <OptimizedImage
                src={currentMedia.url}
                alt=""
                width={currentMedia.width ?? undefined}
                height={currentMedia.height ?? undefined}
                blurDataURL={currentMedia.blur_data_url ?? undefined}
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="w-full h-full object-cover"
              />
            ) : (
              <img
                src={currentMedia.thumbnail_url ?? ''}
                alt=""
                width={9}
                height={16}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            )}
          </button>
        )}

        {currentMedia?.kind === 'video' && (
```

with:

```tsx
            {currentMedia.media_lost_at ? (
              <MediaUnavailable size="full" />
            ) : currentMedia.kind === 'image' ? (
              <OptimizedImage
                src={currentMedia.url ?? ''}
                alt=""
                width={currentMedia.width ?? undefined}
                height={currentMedia.height ?? undefined}
                blurDataURL={currentMedia.blur_data_url ?? undefined}
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="w-full h-full object-cover"
              />
            ) : (
              <img
                src={currentMedia.thumbnail_url ?? ''}
                alt=""
                width={9}
                height={16}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            )}
          </button>
        )}

        {currentMedia?.kind === 'video' && !currentMedia.media_lost_at && (
```

- [ ] **Step 9: Fix `PostCard.tsx` — cover**

Add the import next to the existing `OptimizedImage` import:

```tsx
import { MediaUnavailable } from './MediaUnavailable';
```

Then replace the cover block (current lines 276-305):

```tsx
          {displayCover.kind === 'image' ? (
            <OptimizedImage
              src={displayCover.url}
              alt=""
              width={displayCover.width ?? undefined}
              height={displayCover.height ?? undefined}
              blurDataURL={displayCover.blur_data_url ?? undefined}
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="w-full h-full object-cover"
            />
          ) : (
            <>
              <img
                src={displayCover.thumbnail_url ?? ''}
                alt=""
                width={4}
                height={3}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            </>
          )}
```

with:

```tsx
          {displayCover.media_lost_at ? (
            <MediaUnavailable size="full" />
          ) : displayCover.kind === 'image' ? (
            <OptimizedImage
              src={displayCover.url ?? ''}
              alt=""
              width={displayCover.width ?? undefined}
              height={displayCover.height ?? undefined}
              blurDataURL={displayCover.blur_data_url ?? undefined}
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="w-full h-full object-cover"
            />
          ) : (
            <>
              <img
                src={displayCover.thumbnail_url ?? ''}
                alt=""
                width={4}
                height={3}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            </>
          )}
```

- [ ] **Step 10: Fix `PostCard.tsx` — carousel thumbnails**

Replace (current lines 420-439):

```tsx
                  {m.kind === 'image' ? (
                    <OptimizedImage
                      src={m.thumbnail_url ?? m.url}
                      alt=""
                      width={80}
                      height={80}
                      blurDataURL={m.blur_data_url ?? undefined}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={m.thumbnail_url ?? ''}
                      alt=""
                      width={80}
                      height={80}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  )}
```

with:

```tsx
                  {m.media_lost_at ? (
                    <MediaUnavailable size="compact" />
                  ) : m.kind === 'image' ? (
                    <OptimizedImage
                      src={m.thumbnail_url ?? m.url ?? ''}
                      alt=""
                      width={80}
                      height={80}
                      blurDataURL={m.blur_data_url ?? undefined}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={m.thumbnail_url ?? ''}
                      alt=""
                      width={80}
                      height={80}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  )}
```

- [ ] **Step 11: Fix `PostMediaLightbox.tsx`**

Add the import next to the existing `VideoPlayer` import:

```tsx
import { MediaUnavailable } from './MediaUnavailable';
```

Then replace the media block (current lines 135-154):

```tsx
        {current.kind === 'image' ? (
          <img
            src={current.url}
            alt=""
            draggable={false}
            onError={() => onStaleUrl?.()}
            className="max-h-[85vh] max-w-[90vw] object-contain select-none"
          />
        ) : (
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
        )}
```

with:

```tsx
        {current.media_lost_at ? (
          <MediaUnavailable size="full" className="max-h-[85vh] max-w-[90vw] aspect-square" />
        ) : current.kind === 'image' ? (
          <img
            src={current.url ?? ''}
            alt=""
            draggable={false}
            onError={() => onStaleUrl?.()}
            className="max-h-[85vh] max-w-[90vw] object-contain select-none"
          />
        ) : (
          <VideoPlayer
            key={current.id}
            hlsSrc={current.playback?.hls}
            src={current.url ?? undefined}
            poster={current.thumbnail_url ?? undefined}
            controls
            preload="auto"
            onFatalError={() => onStaleUrl?.()}
            className="max-h-[85vh] max-w-[90vw] object-contain"
          />
        )}
```

Also update the adjacent preload effect (current lines 40-50) so it doesn't try to preload a lost image:

```tsx
      if (m?.kind === 'image' && m.url) {
```

stays exactly as-is — `m.url` being `null` for a lost item already makes this condition false, no change needed here.

- [ ] **Step 12: Re-run the Hub typecheck**

Run: `npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS, zero errors. If any file outside the 5 listed above still errors, fix it the same way (guard on `media_lost_at`, coerce `?? ''`/`?? undefined` for the narrowed branch) before continuing.

- [ ] **Step 13: Add a test case per fixed component**

In `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx`, add after the existing tests inside `describe('InstagramPostCard', ...)`:

```tsx
  it('shows the unavailable placeholder instead of a broken image for a permanently lost slide', () => {
    render(
      <InstagramPostCard
        post={makePost({
          media: [
            makeMedia({ id: 1, media_lost_at: '2026-08-14T03:00:00.000Z', url: null }),
          ],
        })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });
```

In `apps/hub/src/components/__tests__/StoryPostCard.test.tsx`, add inside `describe('StoryPostCard', ...)`:

```tsx
  it('shows the unavailable placeholder instead of a broken image for a permanently lost story', () => {
    render(
      <StoryPostCard
        post={makePost({
          media: [
            makeMedia({ id: 1, media_lost_at: '2026-08-14T03:00:00.000Z', url: null }),
          ],
        })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });
```

In `apps/hub/src/components/__tests__/PostCard.test.tsx`, add inside `describe('PostCard', ...)`:

```tsx
  it('shows the unavailable placeholder instead of a broken image for a permanently lost cover', () => {
    render(
      <PostCard
        post={makePost({
          media: [makeMedia({ id: 1, media_lost_at: '2026-08-14T03:00:00.000Z', url: null })],
        })}
        token="token-publico"
        approvals={[]}
        propertyValues={[]}
        workflowSelectOptions={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });
```

In `apps/hub/src/components/__tests__/PostMediaLightbox.test.tsx`, add inside `describe('PostMediaLightbox', ...)`:

```tsx
  it('shows the unavailable placeholder instead of a broken image for a permanently lost item', () => {
    const media = [makeMedia({ id: 1, media_lost_at: '2026-08-14T03:00:00.000Z', url: null })];
    render(<PostMediaLightbox media={media} initialIndex={0} onClose={vi.fn()} />);
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
    expect(document.body.querySelector('img')).not.toBeInTheDocument();
  });
```

- [ ] **Step 14: Run all four test files and confirm they pass**

Run: `npx vitest run apps/hub/src/components/__tests__/InstagramPostCard.test.tsx apps/hub/src/components/__tests__/StoryPostCard.test.tsx apps/hub/src/components/__tests__/PostCard.test.tsx apps/hub/src/components/__tests__/PostMediaLightbox.test.tsx apps/hub/src/components/__tests__/MediaUnavailable.test.tsx`
Expected: PASS, all tests in all five files (new + pre-existing).

- [ ] **Step 15: Commit**

```bash
git add apps/hub/src/components/MediaUnavailable.tsx apps/hub/src/components/__tests__/MediaUnavailable.test.tsx apps/hub/src/types.ts apps/hub/src/components/InstagramPostCard.tsx apps/hub/src/components/StoryPostCard.tsx apps/hub/src/components/PostCard.tsx apps/hub/src/components/PostMediaLightbox.tsx apps/hub/src/components/__tests__/InstagramPostCard.test.tsx apps/hub/src/components/__tests__/StoryPostCard.test.tsx apps/hub/src/components/__tests__/PostCard.test.tsx apps/hub/src/components/__tests__/PostMediaLightbox.test.tsx
git commit -m "feat(hub): show a Mídia indisponível placeholder for permanently lost post media"
```

---

## Task 5: CRM Entregas frontend — `MediaUnavailable` + type + 4 render sites + shared-grid regression

**Files:**
- Create: `apps/crm/src/components/MediaUnavailable.tsx`
- Test: `apps/crm/src/components/__tests__/MediaUnavailable.test.tsx`
- Modify: `apps/crm/src/store/posts.ts` (`PostMedia` — additive, non-breaking)
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx:502,688-709`
- Modify: `apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx:82-102`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCard.tsx:594-620`
- Modify: `apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx:94-105`
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`, `PostMediaLightbox.test.tsx`, `CalendarPostDetailPanel.test.tsx`; new `WorkflowCard.postCovers.test.tsx`, new `ThumbnailPickerDialog.test.tsx`
- Create: `packages/ui/InstagramGrid/__tests__/index.test.tsx` (regression lock for the shared free-pass component — proves both Hub's `InstagramGridPreview` and CRM's `WorkflowGridView` degrade gracefully; neither file itself changes)

**Interfaces:**
- Consumes: Task 2's `post-media-manage` response shape (`PostMedia.media_lost_at`).
- Produces: CRM's own `MediaUnavailable` component (same props shape as Hub's, but not shared code — matches the existing per-app `OptimizedImage` duplication).

- [ ] **Step 1: Write the failing test for `MediaUnavailable`**

Create `apps/crm/src/components/__tests__/MediaUnavailable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MediaUnavailable } from '../MediaUnavailable';

describe('MediaUnavailable', () => {
  it('shows the label in full size', () => {
    render(<MediaUnavailable />);
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });

  it('hides the label in compact size', () => {
    render(<MediaUnavailable size="compact" />);
    expect(screen.queryByText('Mídia indisponível')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/crm/src/components/__tests__/MediaUnavailable.test.tsx`
Expected: FAIL — cannot find module `../MediaUnavailable`.

- [ ] **Step 3: Create `MediaUnavailable`**

Create `apps/crm/src/components/MediaUnavailable.tsx`:

```tsx
import { ImageOff } from 'lucide-react';

export interface MediaUnavailableProps {
  /** 'compact' shows only the icon (tight spaces); 'full' adds the label. */
  size?: 'compact' | 'full';
  className?: string;
}

export function MediaUnavailable({ size = 'full', className = '' }: MediaUnavailableProps) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1.5 bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500 ${className}`}
    >
      <ImageOff
        className={size === 'compact' ? 'h-4 w-4 opacity-60' : 'h-6 w-6 opacity-60'}
        aria-hidden="true"
      />
      {size === 'full' && <span className="text-xs font-medium">Mídia indisponível</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/crm/src/components/__tests__/MediaUnavailable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add `media_lost_at` to `PostMedia`**

In `apps/crm/src/store/posts.ts`, replace (current lines 265-292):

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
  /** 'design' = an Estúdio-rendered link (T4.1/T4.5 — the design owns it, not user-editable);
   * optional because responses cached before the post-media-manage redeploy omit it. */
  origin?: 'manual' | 'design';
  uploaded_by: string | null;
  created_at: string;
  blur_data_url?: string | null;
  // Populated only on hydrated responses
  url?: string;
  thumbnail_url?: string | null;
  /** Cloudflare Stream HLS manifest, when the video has one. Optional — cached
   * pre-deploy responses omit it, same convention as `origin`. */
  playback?: { hls: string; expires_at: string } | null;
}
```

with:

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
  /** 'design' = an Estúdio-rendered link (T4.1/T4.5 — the design owns it, not user-editable);
   * optional because responses cached before the post-media-manage redeploy omit it. */
  origin?: 'manual' | 'design';
  uploaded_by: string | null;
  created_at: string;
  blur_data_url?: string | null;
  // Populated only on hydrated responses
  url?: string;
  thumbnail_url?: string | null;
  /** ISO timestamp when this file was permanently lost (Aug 2026 R2 incident and any
   * future reconciliation); null when the file is fine. Optional only because a
   * response cached before this field shipped omits the key — check the value,
   * never key presence. */
  media_lost_at?: string | null;
  /** Cloudflare Stream HLS manifest, when the video has one. Optional — cached
   * pre-deploy responses omit it, same convention as `origin`. */
  playback?: { hls: string; expires_at: string } | null;
}
```

This is additive only (`url`/`thumbnail_url` were already optional) — `npx tsc -p apps/crm/tsconfig.json --noEmit` should stay green with no other file changes. No audit step needed here (unlike Hub's Step 6).

- [ ] **Step 6: Fix `PostMediaGallery.tsx`**

Add the import near the top, matching this file's existing relative-path convention for `OptimizedImage` (`import { OptimizedImage } from '../../../components/OptimizedImage';`):

```tsx
import { MediaUnavailable } from '../../../components/MediaUnavailable';
```

Guard the thumbnail-edit entry point — replace (current line 502):

```tsx
                onEditThumbnail={m.kind === 'video' ? () => setEditingMedia(m) : undefined}
```

with:

```tsx
                onEditThumbnail={m.kind === 'video' && !m.media_lost_at ? () => setEditingMedia(m) : undefined}
```

Replace the tile media block in `SortableMediaTile` (current lines 688-709):

```tsx
      {m.kind === 'image' ? (
        <OptimizedImage
          src={m.url ?? ''}
          alt={m.original_filename}
          width={m.width ?? undefined}
          height={m.height ?? undefined}
          blurDataURL={m.blur_data_url ?? undefined}
          // Every other reader of this same url is cors-mode (preloader, lightbox,
          // zip download). Requesting it no-cors here would fetch each image twice
          // and keep two browser-cache entries for one object.
          crossOrigin="anonymous"
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : (
        <video
          src={m.url ?? undefined}
          poster={m.thumbnail_url ?? undefined}
          crossOrigin="anonymous"
          muted
          className="w-full h-full object-cover pointer-events-none"
        />
      )}
```

with:

```tsx
      {m.media_lost_at ? (
        <MediaUnavailable size="full" />
      ) : m.kind === 'image' ? (
        <OptimizedImage
          src={m.url ?? ''}
          alt={m.original_filename}
          width={m.width ?? undefined}
          height={m.height ?? undefined}
          blurDataURL={m.blur_data_url ?? undefined}
          // Every other reader of this same url is cors-mode (preloader, lightbox,
          // zip download). Requesting it no-cors here would fetch each image twice
          // and keep two browser-cache entries for one object.
          crossOrigin="anonymous"
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : (
        <video
          src={m.url ?? undefined}
          poster={m.thumbnail_url ?? undefined}
          crossOrigin="anonymous"
          muted
          className="w-full h-full object-cover pointer-events-none"
        />
      )}
```

Note `size="full"`, not `"compact"`, even though this tile is small on screen: the spec's own size policy explicitly lists "tile de galeria" (this exact gallery grid) as a `full` context, alongside the lightbox and Arquivos grid cells — `compact` is reserved for genuinely tiny contexts like the kanban cover circle (Step 8, 32px) and carousel thumbnail strips, not this grid.

- [ ] **Step 7: Fix CRM `PostMediaLightbox.tsx`**

Add the import next to the existing `VideoPlayer` import:

```tsx
import { MediaUnavailable } from '@/components/MediaUnavailable';
```

Then replace the media block (current lines 82-102):

```tsx
            {current.kind === 'image' ? (
              <img
                src={current.url}
                alt={current.original_filename}
                crossOrigin="anonymous"
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                className="max-h-[85vh] max-w-[90vw] object-contain select-none"
                draggable={false}
              />
            ) : (
              <VideoPlayer
                key={current.id}
                hlsSrc={current.playback?.hls}
                src={current.url ?? ''}
                poster={current.thumbnail_url ?? undefined}
                crossOrigin="anonymous"
                controls
                className="max-h-[85vh] max-w-[90vw] object-contain"
              />
            )}
```

with:

```tsx
            {current.media_lost_at ? (
              <MediaUnavailable size="full" className="max-h-[85vh] max-w-[90vw] aspect-square" />
            ) : current.kind === 'image' ? (
              <img
                src={current.url}
                alt={current.original_filename}
                crossOrigin="anonymous"
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                className="max-h-[85vh] max-w-[90vw] object-contain select-none"
                draggable={false}
              />
            ) : (
              <VideoPlayer
                key={current.id}
                hlsSrc={current.playback?.hls}
                src={current.url ?? ''}
                poster={current.thumbnail_url ?? undefined}
                crossOrigin="anonymous"
                controls
                className="max-h-[85vh] max-w-[90vw] object-contain"
              />
            )}
```

- [ ] **Step 8: Fix `WorkflowCard.tsx`**

Add the import next to the existing `@/components/ui/dropdown-menu` import:

```tsx
import { MediaUnavailable } from '@/components/MediaUnavailable';
```

Then replace the cover-circle image (current lines 612-618):

```tsx
              <img
                src={media.thumbnail_url ?? media.url}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
```

with:

```tsx
              {media.media_lost_at ? (
                <MediaUnavailable size="compact" />
              ) : (
                <img
                  src={media.thumbnail_url ?? media.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              )}
```

- [ ] **Step 9: Fix `ThumbnailPickerDialog.tsx`**

Add the import next to the existing `@/components/ui/dialog` import:

```tsx
import { MediaUnavailable } from '@/components/MediaUnavailable';
```

Then replace the video element (current lines 94-105, the `<video>` that lets the user scrub/capture a frame):

```tsx
            <video
              ref={videoRef}
              src={media.url ?? undefined}
              poster={media.thumbnail_url ?? undefined}
              crossOrigin="anonymous"
              controls
              muted
              playsInline
              className="w-full max-h-64 rounded-xl bg-black"
            />
```

with:

```tsx
            {media.media_lost_at ? (
              <MediaUnavailable size="full" className="w-full aspect-video rounded-xl" />
            ) : (
              <video
                ref={videoRef}
                src={media.url ?? undefined}
                poster={media.thumbnail_url ?? undefined}
                crossOrigin="anonymous"
                controls
                muted
                playsInline
                className="w-full max-h-64 rounded-xl bg-black"
              />
            )}
```

This is defense-in-depth — Step 6 already prevents the dialog from being *opened* for a lost video via the `onEditThumbnail` guard (its only real entry point), so this branch shouldn't be reachable in normal use. `handleCapture()`'s existing `if (!video) return;` guard means the "usar este frame" button stays a harmless no-op if it somehow is reached; leaving it visible rather than also conditionally hiding it keeps this diff minimal for a path that shouldn't occur.

- [ ] **Step 10: Run the CRM typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS, zero errors (this change was additive to the type, so this is a sanity check, not an audit).

- [ ] **Step 11: Add test cases for the 4 fixed components**

In `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`, add a new top-level `describe` block, using the file's existing `renderGallery()` helper, `listPostMedia` mock, and `makeMedia()` fixture:

```tsx
describe('PostMediaGallery permanently lost media', () => {
  it('shows the unavailable placeholder instead of a broken image for a permanently lost tile', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce([
      {
        ...makeMedia(1)[0],
        url: undefined,
        thumbnail_url: null,
        media_lost_at: '2026-08-14T03:00:00.000Z',
      },
    ]);
    renderGallery();
    expect(await screen.findByText('Mídia indisponível')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
```

In `apps/crm/src/pages/entregas/components/__tests__/PostMediaLightbox.test.tsx`, add inside `describe('PostMediaLightbox', ...)`:

```tsx
  it('shows the unavailable placeholder instead of a broken image for a permanently lost item', () => {
    const media = [
      { ...makeMedia(1)[0], media_lost_at: '2026-08-14T03:00:00.000Z', url: undefined },
    ];
    render(<PostMediaLightbox media={media} initialIndex={0} open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });
```

Create `apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.postCovers.test.tsx`, following the same mocking pattern as `WorkflowCard.badge.test.tsx` (mock `sonner`, `../../../store`, `@/components/ui/dropdown-menu`; build a `BoardCard` fixture with `as unknown as BoardCard`):

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../store', () => ({
  updateWorkflowEtapa: vi.fn(),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { WorkflowCard } from '../WorkflowCard';
import type { BoardCard } from '../hooks/useEntregasData';

const etapa = {
  id: 1,
  workflow_id: 1,
  ordem: 0,
  nome: 'Design',
  status: 'ativo' as const,
  tipo: 'padrao' as const,
  prazo_dias: 5,
  tipo_prazo: 'corridos' as const,
};

function makeCard(): BoardCard {
  return {
    workflow: {
      id: 1,
      cliente_id: 1,
      titulo: 'Campanha',
      status: 'ativo',
      etapa_atual: 0,
      recorrente: false,
    },
    etapa,
    allEtapas: [etapa],
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 5, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 1,
    etapaIdx: 0,
    postCovers: [
      {
        id: 1,
        post_id: 1,
        conta_id: 'c',
        r2_key: 'img/1.png',
        thumbnail_r2_key: null,
        kind: 'image',
        mime_type: 'image/png',
        size_bytes: 1000,
        original_filename: 'lost.png',
        width: 1080,
        height: 1080,
        duration_seconds: null,
        is_cover: true,
        sort_order: 0,
        uploaded_by: null,
        created_at: '2026-01-01T00:00:00Z',
        url: null,
        thumbnail_url: null,
        media_lost_at: '2026-08-14T03:00:00.000Z',
      },
    ],
  } as unknown as BoardCard;
}

describe('WorkflowCard post covers', () => {
  it('shows the unavailable placeholder instead of a broken image for a permanently lost cover', () => {
    const { container } = render(
      <MemoryRouter>
        <WorkflowCard card={makeCard()} />
      </MemoryRouter>,
    );
    // The kanban cover circle is a genuinely tight 32px space, so it renders
    // MediaUnavailable in "compact" mode — icon only, no visible text label
    // (unlike the gallery tile and lightbox, which use "full"). lucide-react
    // renders each icon with a `lucide-<name>` class, which is what this
    // asserts instead of the (absent-by-design) text.
    expect(container.querySelector('.lucide-image-off')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });
});
```

Create `apps/crm/src/pages/entregas/components/__tests__/ThumbnailPickerDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThumbnailPickerDialog } from '../ThumbnailPickerDialog';
import type { PostMedia } from '../../../../store';

function makeVideoMedia(overrides: Partial<PostMedia> = {}): PostMedia {
  return {
    id: 1,
    post_id: 1,
    conta_id: 'c',
    r2_key: 'video/1.mp4',
    thumbnail_r2_key: null,
    kind: 'video',
    mime_type: 'video/mp4',
    size_bytes: 10_000,
    original_filename: 'video.mp4',
    width: 1080,
    height: 1920,
    duration_seconds: 12,
    is_cover: false,
    sort_order: 0,
    uploaded_by: null,
    created_at: '2026-01-01T00:00:00Z',
    url: 'https://media.test/video/1.mp4',
    thumbnail_url: 'https://media.test/video/1-thumb.jpg',
    ...overrides,
  };
}

describe('ThumbnailPickerDialog', () => {
  it('shows the unavailable placeholder instead of the video element for a permanently lost video', () => {
    render(
      <ThumbnailPickerDialog
        media={makeVideoMedia({ url: null, media_lost_at: '2026-08-14T03:00:00.000Z' })}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
    expect(document.querySelector('video')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 12: Add the free-pass regression test for `CalendarPostDetailPanel`**

In `apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx`, add inside `describe('CalendarPostDetailPanel', ...)` (using the file's existing `renderPanel` helper and `mockMedia`):

```tsx
  it('falls back to the empty-thumbnail icon instead of a broken image when the cover is permanently lost (no source change — the component already treats a null thumbnail_url/url as no cover)', async () => {
    mockMedia.mockResolvedValue([
      {
        id: 1,
        post_id: 1,
        conta_id: 'c',
        r2_key: 'img/1.jpg',
        thumbnail_r2_key: null,
        kind: 'image',
        mime_type: 'image/jpeg',
        size_bytes: 1000,
        original_filename: 'img.jpg',
        width: 1080,
        height: 1080,
        duration_seconds: null,
        is_cover: true,
        sort_order: 0,
        uploaded_by: null,
        created_at: '2026-01-01T00:00:00Z',
        url: null,
        thumbnail_url: null,
        media_lost_at: '2026-08-14T03:00:00.000Z',
      } as never,
    ]);
    renderPanel();
    await waitFor(() => {
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 13: Add the shared `InstagramGrid` regression test**

Create `packages/ui/InstagramGrid/__tests__/index.test.tsx` — this is the single test proving the free-pass behavior both Hub's `InstagramGridPreview` and CRM's `WorkflowGridView` rely on:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InstagramGrid } from '../index';
import type { GridItem } from '../types';

function makeItem(overrides: Partial<GridItem> = {}): GridItem {
  return {
    source: 'hub',
    mobility: 'movable',
    id: 'hub-1',
    postId: 1,
    status: 'agendado',
    thumbnailUrl: 'https://cdn.example.com/cover.jpg',
    videoUrl: null,
    mediaType: 'IMAGE',
    isCarousel: false,
    scheduledAt: '2026-08-20T10:00:00.000Z',
    sortTs: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('InstagramGrid', () => {
  it('renders the neutral placeholder tile instead of a broken image when a tile has no thumbnail or video URL', () => {
    const { container } = render(
      <InstagramGrid
        items={[makeItem({ thumbnailUrl: null, videoUrl: null })]}
        onReorder={async () => {}}
      />,
    );
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('[data-grid-placeholder]')).toBeInTheDocument();
  });
});
```

This locks in the mechanism that `InstagramGridPreview.tsx` (Hub, Task 4) and `WorkflowGridView.tsx` (CRM) both rely on for a lost cover — since Task 1/2's backend change makes a lost item's `url`/`thumbnail_url` genuinely `null` (not a dead signed URL), both wrapper components' existing `firstMedia?.url ?? firstMedia?.thumbnail_url ?? null` chains already resolve to `thumbnailUrl: null`, and this test proves `InstagramGrid` itself already handles that gracefully. Neither `InstagramGridPreview.tsx` nor `WorkflowGridView.tsx` needs a source change.

- [ ] **Step 14: Run every test file touched in this task**

Run: `npx vitest run apps/crm/src/components/__tests__/MediaUnavailable.test.tsx apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx apps/crm/src/pages/entregas/components/__tests__/PostMediaLightbox.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.postCovers.test.tsx apps/crm/src/pages/entregas/components/__tests__/ThumbnailPickerDialog.test.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx packages/ui/InstagramGrid/__tests__/index.test.tsx`
Expected: PASS, all tests in all seven files.

- [ ] **Step 15: Commit**

```bash
git add apps/crm/src/components/MediaUnavailable.tsx apps/crm/src/components/__tests__/MediaUnavailable.test.tsx apps/crm/src/store/posts.ts apps/crm/src/pages/entregas/components/PostMediaGallery.tsx apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx apps/crm/src/pages/entregas/components/WorkflowCard.tsx apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx apps/crm/src/pages/entregas/components/__tests__/PostMediaLightbox.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.postCovers.test.tsx apps/crm/src/pages/entregas/components/__tests__/ThumbnailPickerDialog.test.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx packages/ui/InstagramGrid/__tests__/index.test.tsx
git commit -m "feat(crm): show a Mídia indisponível placeholder for permanently lost post media in Entregas"
```

---

## Task 6: CRM Arquivos frontend — type + lightbox fix + regression tests

**Correction found auditing the original 16-site enumeration (before this task was dispatched):** `FileGrid.tsx`, `FilePickerModal.tsx`, `MobileArquivosView.tsx`, and `PostChip.tsx` all already fall back to a neutral `<FileIcon>` (or, for `PostChip`, simply render nothing in that slot) whenever `thumbnail_url ?? url` is falsy — those genuinely need no source change, only regression tests (Steps 4-9 below). But `apps/crm/src/pages/arquivos/ArquivosPage.tsx` reuses the SAME `entregas/components/PostMediaLightbox` that Task 5 already fixed with a `media_lost_at` guard, via its own `lightboxMedia: PostMedia[]` mapping (current lines 165-186) — and that mapping does NOT forward `media_lost_at`, so a file opened from Arquivos never trips the guard Task 5 added, even after this task types the field. This is a real 17th render site the original spec's 16-site count missed (a data-adapter gap, not a rendering gap) — Steps 1-3 below fix it.

**Files:**
- Modify: `apps/crm/src/pages/arquivos/types.ts` (`FileRecord` — additive, non-breaking)
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx:165-186` (`lightboxMedia` mapping)
- Test: `apps/crm/src/pages/arquivos/__tests__/ArquivosPage.test.tsx`, `FileGrid.test.tsx`, `FilePickerModal.test.tsx`

**Interfaces:**
- Consumes: Task 3's `file-manage` response shape (`FileRecord.media_lost_at`, already on the wire, now typed) and Task 5's `PostMediaLightbox` guard (already checks `current.media_lost_at` — this task's job is only to make sure that field actually reaches it via this one adapter).

- [ ] **Step 1: Add `media_lost_at` to `FileRecord`**

In `apps/crm/src/pages/arquivos/types.ts`, replace (current lines 22-47):

```ts
export interface FileRecord {
  id: number;
  conta_id: string;
  folder_id: number | null;
  r2_key: string;
  thumbnail_r2_key: string | null;
  name: string;
  kind: 'image' | 'video' | 'document';
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  blur_data_url: string | null;
  uploaded_by: string | null;
  reference_count: number;
  created_at: string;
  url?: string;
  thumbnail_url?: string | null;
  /** Cloudflare Stream HLS manifest, when the video has one. Optional — cached
   * pre-deploy responses omit it, same convention as in store/posts.ts's PostMedia. */
  playback?: { hls: string; expires_at: string } | null;
  _uploading?: boolean;
  _progress?: number;
  _localPreviewUrl?: string;
}
```

with:

```ts
export interface FileRecord {
  id: number;
  conta_id: string;
  folder_id: number | null;
  r2_key: string;
  thumbnail_r2_key: string | null;
  name: string;
  kind: 'image' | 'video' | 'document';
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  blur_data_url: string | null;
  uploaded_by: string | null;
  reference_count: number;
  created_at: string;
  url?: string;
  thumbnail_url?: string | null;
  /** ISO timestamp when this file was permanently lost (Aug 2026 R2 incident and any
   * future reconciliation); null when the file is fine. Optional only because a
   * response cached before this field shipped omits the key — check the value,
   * never key presence. */
  media_lost_at?: string | null;
  /** Cloudflare Stream HLS manifest, when the video has one. Optional — cached
   * pre-deploy responses omit it, same convention as in store/posts.ts's PostMedia. */
  playback?: { hls: string; expires_at: string } | null;
  _uploading?: boolean;
  _progress?: number;
  _localPreviewUrl?: string;
}
```

- [ ] **Step 2: Run the CRM typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS, zero errors — additive field, no consumer needs a change.

- [ ] **Step 3: Fix the `ArquivosPage.tsx` lightbox mapping and add a covering test (TDD)**

First, write the failing test. In `apps/crm/src/pages/arquivos/__tests__/ArquivosPage.test.tsx`, add a new `describe` block after the existing `describe('lightbox playback mapping', ...)` block, following that block's exact pattern (`mockedGetFolderContents.mockResolvedValue(makeFolderContents({ files: [...] }))`, render, wait for the filename, click it, wait for the lightbox content):

```tsx
  describe('lightbox media_lost_at mapping', () => {
    it('carries the media_lost_at field from FileRecord into the lightbox, showing the unavailable placeholder', async () => {
      mockedGetFolderContents.mockResolvedValue(
        makeFolderContents({
          files: [
            makeFile({
              id: 200,
              name: 'perdido.png',
              kind: 'image',
              url: undefined,
              thumbnail_url: null,
              media_lost_at: '2026-08-14T03:00:00.000Z',
            }),
          ],
        }),
      );

      render(<ArquivosPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('perdido.png')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('perdido.png'));

      await waitFor(() => {
        expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
      });
    });
  });
```

Run: `npx vitest run apps/crm/src/pages/arquivos/__tests__/ArquivosPage.test.tsx --testNamePattern "media_lost_at mapping"`
Expected: FAIL — the lightbox tries to render `<img src={null}>` (or nothing) instead of the placeholder, because `lightboxMedia` never set `media_lost_at` on the mapped object, so `PostMediaLightbox`'s `current.media_lost_at` guard sees `undefined` and takes the wrong branch.

Now fix it. In `apps/crm/src/pages/arquivos/ArquivosPage.tsx`, replace (current lines 165-186):

```tsx
  const lightboxMedia: PostMedia[] = mediaFiles.map((f) => ({
    id: f.id,
    post_id: 0,
    conta_id: f.conta_id,
    r2_key: f.r2_key,
    thumbnail_r2_key: f.thumbnail_r2_key,
    kind: f.kind as 'image' | 'video',
    mime_type: f.mime_type,
    size_bytes: f.size_bytes,
    original_filename: f.name,
    width: f.width,
    height: f.height,
    duration_seconds: f.duration_seconds,
    is_cover: false,
    sort_order: 0,
    uploaded_by: f.uploaded_by,
    created_at: f.created_at,
    blur_data_url: f.blur_data_url,
    url: f.url,
    thumbnail_url: f.thumbnail_url,
    playback: f.playback ?? null,
  }));
```

with:

```tsx
  const lightboxMedia: PostMedia[] = mediaFiles.map((f) => ({
    id: f.id,
    post_id: 0,
    conta_id: f.conta_id,
    r2_key: f.r2_key,
    thumbnail_r2_key: f.thumbnail_r2_key,
    kind: f.kind as 'image' | 'video',
    mime_type: f.mime_type,
    size_bytes: f.size_bytes,
    original_filename: f.name,
    width: f.width,
    height: f.height,
    duration_seconds: f.duration_seconds,
    is_cover: false,
    sort_order: 0,
    uploaded_by: f.uploaded_by,
    created_at: f.created_at,
    blur_data_url: f.blur_data_url,
    url: f.url,
    thumbnail_url: f.thumbnail_url,
    media_lost_at: f.media_lost_at ?? null,
    playback: f.playback ?? null,
  }));
```

Run: `npx vitest run apps/crm/src/pages/arquivos/__tests__/ArquivosPage.test.tsx`
Expected: PASS — every test in the file, including the new one and the pre-existing `"lightbox playback mapping"` test (proves the `playback` field's mapping is untouched).

- [ ] **Step 4: Write the `FileGrid` regression test**

In `apps/crm/src/pages/arquivos/__tests__/FileGrid.test.tsx`, add inside `describe('grid mode', ...)`, after the existing `"renders file cards with size info"` test:

```tsx
    it('shows the file-type icon instead of a broken image when a file is permanently lost', () => {
      render(
        <FileGrid
          files={[
            makeFile({
              id: 200,
              name: 'perdido.png',
              url: undefined,
              thumbnail_url: null,
              media_lost_at: '2026-08-14T03:00:00.000Z',
            }),
          ]}
          subfolders={[]}
          {...defaultProps}
        />,
      );
      expect(screen.getByText('perdido.png')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
```

- [ ] **Step 5: Run it and confirm it already passes**

Run: `npx vitest run apps/crm/src/pages/arquivos/__tests__/FileGrid.test.tsx`
Expected: PASS immediately — no production code needed for this one (unlike Step 3), this is a characterization test proving existing behavior, not new-feature TDD. If it fails, `FileGrid.tsx`'s existing `(file.kind === 'image' || file.kind === 'video') && (file.thumbnail_url ?? file.url)` fallback (around line 602) has changed since this plan was written — stop and re-investigate before continuing.

- [ ] **Step 6: Write the `FilePickerModal` regression test**

In `apps/crm/src/pages/arquivos/__tests__/FilePickerModal.test.tsx`, add inside the top-level `describe(...)`, after the existing `"shows folders and files"` test:

```tsx
  it('shows the file-type icon instead of a broken image for a permanently lost file', async () => {
    mockedGetFolderContents.mockResolvedValue(
      makeFolderContents({
        files: [
          makeFile({
            id: 200,
            name: 'perdido.png',
            url: undefined,
            thumbnail_url: null,
            media_lost_at: '2026-08-14T03:00:00.000Z',
          }),
        ],
      }),
    );
    render(<FilePickerModal open={true} onClose={vi.fn()} onSelect={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    // Wait for the specific file to render, not just "some button exists" —
    // the modal's breadcrumb and footer buttons render unconditionally
    // before the folder-contents promise resolves, so a generic button-count
    // check would pass vacuously without ever mounting the file row.
    await waitFor(() => {
      expect(screen.getByText('perdido.png')).toBeInTheDocument();
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Run it and confirm it already passes**

Run: `npx vitest run apps/crm/src/pages/arquivos/__tests__/FilePickerModal.test.tsx`
Expected: PASS immediately, same reasoning as Step 5.

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/arquivos/types.ts apps/crm/src/pages/arquivos/ArquivosPage.tsx apps/crm/src/pages/arquivos/__tests__/ArquivosPage.test.tsx apps/crm/src/pages/arquivos/__tests__/FileGrid.test.tsx apps/crm/src/pages/arquivos/__tests__/FilePickerModal.test.tsx
git commit -m "fix(crm): forward media_lost_at through the Arquivos lightbox mapping, lock Arquivos file-icon fallback"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full pre-push checklist**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
```

Expected: all green. `test:functions` will dirty `deno.lock` at the repo root (known repo gotcha) — run `git checkout -- deno.lock` afterward if so, and confirm `git status` is otherwise clean before continuing.

- [ ] **Step 2: Manually verify the two originally-reported posts in the Hub**

This requires the worktree's Supabase link — if unlinked, run `npx supabase link --project-ref skjzpekeqefvlojenfsw` first (prod; this is a read-only browser check, no `db push`).

Deploy is required to actually observe this live (edge functions don't hot-reload from a local dev server against prod data the same way) — if deploying as part of this task isn't appropriate yet, do this step against a local `supabase functions serve` + local frontend dev server pointed at a workspace with a known lost file instead, and treat the prod URLs as the final post-deploy confirmation.

Using the Browser tool:
1. Navigate to `https://www.mesaas.com.br/araripe-mkt-5e2dbc8b/hub/25e9c991-3d81-40a3-b0ef-b6625ba4685d/postagens/1220`
2. Confirm the page shows the "Mídia indisponível" placeholder (icon + label) instead of a broken-image icon, for all 4 media items on this post (file ids 3853-3856).
3. Repeat for `postagens/1562` (file id 4737).
4. Check the browser's network tab / console: there should be no `media-proxy.mesaas.workers.dev` requests for these lost keys at all (the frontend never issues them, per the guard clauses), and no console errors.

- [ ] **Step 3: Manually spot-check two CRM sites**

Using the Browser tool against a CRM session with access to the Araripe MKT workspace:
1. Open the Entregas board, find a workflow containing post 1220 or 1562, confirm the kanban card's cover circle shows the compact placeholder instead of a broken image.
2. Open the Arquivos page, navigate to the folder containing one of the lost files (file id 3853-3856 or 4737), confirm the grid tile shows the generic file icon instead of a broken image.

- [ ] **Step 4: Final commit (if any cleanup was needed)**

If Step 1's `deno.lock` cleanup or any other stray file needs committing:

```bash
git status
git add -A
git commit -m "chore: clean up deno.lock after test:functions run"
```

If nothing changed, skip this step — Task 7 is verification-only.
