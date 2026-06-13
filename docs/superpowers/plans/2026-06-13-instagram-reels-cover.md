# Instagram Reels Cover from Video Thumbnail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chosen video thumbnail (auto-frame or custom upload) the actual cover of the published Instagram Reel, with a retry-without-cover safety net on the publish path.

**Architecture:** `createVideoContainer` gains an optional `coverUrl` that adds `cover_url` to the REELS Graph call. Both publish paths (direct `instagram-publish/handler.ts` and `instagram-publish-cron`) select `thumbnail_r2_key`, sign it like the video URL, and pass it as the cover — single-video Reels only. A cover Instagram can't process surfaces as an opaque container ERROR, so publish-now retries once without the cover and the cron drops the cover on retries. Custom uploads are re-encoded to JPEG client-side so the cover is always Graph-API-compatible.

**Tech Stack:** Deno edge functions (Instagram Graph API `graph.instagram.com/v22.0`), Cloudflare R2 presigned URLs, React 19 + Vitest, Deno test, react-i18next (`posts` namespace).

**Spec:** `docs/superpowers/specs/2026-06-13-instagram-reels-cover-design.md` — read it first; it explains the blast radius (the DB CHECK constraint makes the cover effectively mandatory) and why retry-without-cover is in v1.

**Branch:** `feat/video-thumbnail-auto-edit` (continues the thumbnail work; this builds on it).

**Conventions you must know:**
- **Deno test pollutes the workspace.** `npm run test:functions` runs `deno test --node-modules-dir=auto … supabase/functions/`, which rewrites `deno.lock` and pollutes `node_modules`, breaking `npm run build`. After ANY `test:functions` run, restore with: `git checkout deno.lock && npm ci`. (Project memory: `project_deno_npm_node_modules_gotcha`.)
- CI enforces eslint, prettier `format:check`, the Vitest coverage ratchet, AND the Deno edge tests. Run `npx prettier --write` on touched files, `npm run lint`, `npm run test`, and `npm run test:functions` before pushing.
- Frontend typecheck: `npm run build` (tsc + vite). Deno code is typechecked at deploy (the `test:functions` run uses `--no-check`).
- Deno imports use `npm:`/relative `.ts`. The Instagram utils call the global `fetch`.
- Supabase project refs (memory `reference_supabase_project_refs`): staging `wlyzhyfondykzpsiqsce`, prod `skjzpekeqefvlojenfsw`.

---

### Task 1: `createVideoContainer` — optional `cover_url`

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (`createVideoContainer`, ~lines 248-264)
- Test: `supabase/functions/__tests__/instagram-publish-cover_test.ts` (new)

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/__tests__/instagram-publish-cover_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { createVideoContainer } from "../_shared/instagram-publish-utils.ts";

// deno-lint-ignore no-explicit-any
function stubFetch(response: () => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return response();
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function ok() {
  return Promise.resolve(
    new Response(JSON.stringify({ id: "container-123" }), { status: 200 }),
  );
}

Deno.test("createVideoContainer includes cover_url when a cover is provided", async () => {
  const f = stubFetch(ok);
  try {
    const res = await createVideoContainer(
      "ig-1", "tok", "https://v/video.mp4", "cap", "https://v/cover.jpg",
    );
    assertEquals(res.id, "container-123");
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].body.video_url, "https://v/video.mp4");
    assertEquals(f.calls[0].body.media_type, "REELS");
    assertEquals(f.calls[0].body.cover_url, "https://v/cover.jpg");
  } finally {
    f.restore();
  }
});

Deno.test("createVideoContainer omits cover_url when no cover is provided", async () => {
  const f = stubFetch(ok);
  try {
    await createVideoContainer("ig-1", "tok", "https://v/video.mp4", "cap");
    assert(!("cover_url" in f.calls[0].body), "cover_url must be absent");
  } finally {
    f.restore();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:functions -- --filter "createVideoContainer"`
Expected: FAIL — the second test passes incidentally, but the first fails because `createVideoContainer` currently ignores a 5th argument, so `cover_url` is absent from the body.

Then restore the workspace: `git checkout deno.lock && npm ci`

- [ ] **Step 3: Implement the optional cover**

In `supabase/functions/_shared/instagram-publish-utils.ts`, replace `createVideoContainer` (currently lines 248-264):

```ts
export async function createVideoContainer(
  igUserId: string,
  token: string,
  videoUrl: string,
  caption: string,
  coverUrl?: string,
): Promise<{ id: string }> {
  const body: Record<string, string> = {
    video_url: videoUrl,
    caption,
    media_type: "REELS",
    access_token: token,
  };
  if (coverUrl) body.cover_url = coverUrl;
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throwGraphError(data);
  return { id: data.id };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:functions -- --filter "createVideoContainer"`
Expected: PASS (2 tests).

Then restore the workspace: `git checkout deno.lock && npm ci`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-cover_test.ts
git commit -m "feat(ig): createVideoContainer accepts an optional cover_url"
```

---

### Task 2: publish-now path — select thumbnail, pass cover, retry without cover

**Files:**
- Modify: `supabase/functions/instagram-publish/handler.ts` (media select ~164-168, media map ~170-175, single-video branch ~192-210)

No new unit test: the publish flow's IG utils and `signGetUrl` are imported (not injected), so the existing handler test harness can't reach this branch without a refactor that's out of scope. This wiring is verified by Task 1's unit test (`cover_url` shape), the staging deploy bundle/typecheck, and the staging go/no-go gate (Task 7).

- [ ] **Step 1: Add `thumbnail_r2_key` to the media select**

Replace the select (currently lines 164-168):

```ts
        const { data: links } = await svcDb
          .from("post_file_links")
          .select("sort_order, files!inner(id, kind, r2_key, thumbnail_r2_key)")
          .eq("post_id", postId)
          .order("sort_order", { ascending: true });
```

- [ ] **Step 2: Carry `thumbnail_r2_key` into the mapped media**

Replace the map (currently lines 170-175):

```ts
        const media = (links ?? []).map((l: any) => ({
          id: l.files.id,
          kind: l.files.kind,
          r2_key: l.files.r2_key,
          thumbnail_r2_key: l.files.thumbnail_r2_key,
          sort_order: l.sort_order,
        }));
```

- [ ] **Step 3: Pass the cover and enable a coverless retry**

Replace the `else if (isSingleVideo)` branch and the post-poll ERROR handling. The current code (lines 192-210) is:

```ts
        } else if (isSingleVideo) {
          const url = await signGetUrl(media[0].r2_key, 7200);
          const container = await createVideoContainer(igUserId, token, url, post.ig_caption);
          containerId = container.id;
        } else {
          const url = await signGetUrl(media[0].r2_key, 7200);
          const container = await createSingleImageContainer(igUserId, token, url, post.ig_caption);
          containerId = container.id;
        }

        await svcDb.from("workflow_posts").update({
          instagram_container_id: containerId,
        }).eq("id", postId);

        const containerStatus = await pollContainerReady(containerId, token, 12, 3000);

        if (containerStatus === "ERROR") {
          throw new Error("Container falhou no processamento do Instagram");
        }
```

Replace it with (note `containerStatus` becomes `let`, and a `coverVideoUrl` retry handle is introduced):

```ts
        } else if (isSingleVideo) {
          const url = await signGetUrl(media[0].r2_key, 7200);
          const coverUrl = media[0].thumbnail_r2_key
            ? await signGetUrl(media[0].thumbnail_r2_key, 7200)
            : undefined;
          const container = await createVideoContainer(igUserId, token, url, post.ig_caption, coverUrl);
          containerId = container.id;
          // Remember the video URL so we can rebuild without the cover on ERROR.
          if (coverUrl) coverVideoUrl = url;
        } else {
          const url = await signGetUrl(media[0].r2_key, 7200);
          const container = await createSingleImageContainer(igUserId, token, url, post.ig_caption);
          containerId = container.id;
        }

        await svcDb.from("workflow_posts").update({
          instagram_container_id: containerId,
        }).eq("id", postId);

        let containerStatus = await pollContainerReady(containerId, token, 12, 3000);

        // A cover Instagram can't process surfaces as ERROR during async
        // processing (the Graph cover detail is not exposed). Retry once without
        // the cover so the Reel still publishes with Instagram's auto-cover.
        if (containerStatus === "ERROR" && coverVideoUrl) {
          const retry = await createVideoContainer(igUserId, token, coverVideoUrl, post.ig_caption);
          containerId = retry.id;
          await svcDb.from("workflow_posts").update({
            instagram_container_id: containerId,
          }).eq("id", postId);
          containerStatus = await pollContainerReady(containerId, token, 12, 3000);
        }

        if (containerStatus === "ERROR") {
          throw new Error("Container falhou no processamento do Instagram");
        }
```

- [ ] **Step 4: Declare the `coverVideoUrl` retry handle next to `containerId`**

Find the `let containerId: string;` declaration just above the `if (isCarousel)` block (currently ~line 181) and add a sibling declaration immediately after it:

```ts
        let containerId: string;
        let coverVideoUrl: string | undefined; // set only when a cover was used (enables coverless retry)
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-publish/handler.ts
git commit -m "feat(ig): publish-now sets Reel cover from thumbnail, retries without cover on error"
```

---

### Task 3: cron path — select thumbnail, pass cover, drop cover on retries

**Files:**
- Modify: `supabase/functions/instagram-publish-cron/index.ts` (`fetchMediaForPost` ~56-72, `processContainerCreation` single-video branch ~128-133)

Same verification note as Task 2 (validated at deploy + staging gate).

- [ ] **Step 1: Select and return `thumbnail_r2_key` in `fetchMediaForPost`**

Replace `fetchMediaForPost` (currently lines 55-72):

```ts
// deno-lint-ignore no-explicit-any
async function fetchMediaForPost(
  db: any,
  postId: number,
): Promise<Array<{ id: number; kind: string; r2_key: string; thumbnail_r2_key: string | null; sort_order: number }>> {
  const { data } = await db
    .from("post_file_links")
    .select("sort_order, files!inner(id, kind, r2_key, thumbnail_r2_key)")
    .eq("post_id", postId)
    .order("sort_order", { ascending: true });

  return (data ?? []).map((l: any) => ({
    id: l.files.id,
    kind: l.files.kind,
    r2_key: l.files.r2_key,
    thumbnail_r2_key: l.files.thumbnail_r2_key,
    sort_order: l.sort_order,
  }));
}
```

- [ ] **Step 2: Pass the cover in the single-video branch, dropping it on retries**

In `processContainerCreation`, replace the `else if (isSingleVideo)` branch (currently lines 128-133):

```ts
  } else if (isSingleVideo) {
    const url = await signGetUrl(media[0].r2_key, 7200);
    // First attempt carries the cover; any retry drops it so a cover Instagram
    // can't process can't make a scheduled post fail permanently.
    const thumbKey = post.publish_retry_count === 0 ? media[0].thumbnail_r2_key : null;
    const coverUrl = thumbKey ? await signGetUrl(thumbKey, 7200) : undefined;
    const container = await createVideoContainer(
      post.instagram_user_id, token, url, post.ig_caption, coverUrl,
    );
    containerId = container.id;
  } else {
```

(Phase 3 retries reuse `processContainerCreation` via `processRetry`, so there is no third site to patch — the `publish_retry_count` check above handles them.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/instagram-publish-cron/index.ts
git commit -m "feat(ig): cron sets Reel cover from thumbnail, drops cover on retries"
```

---

### Task 4: `encodeImageAsJpeg` client util

**Files:**
- Create: `apps/crm/src/utils/imageJpeg.ts`
- Test: `apps/crm/src/utils/__tests__/imageJpeg.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/utils/__tests__/imageJpeg.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeImageAsJpeg } from '../imageJpeg';

class MockImage {
  naturalWidth = 4000;
  naturalHeight = 2000;
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const canvases: { width: number; height: number; type?: string; quality?: number }[] = [];

beforeEach(() => {
  canvases.length = 0;
  vi.stubGlobal('Image', MockImage);

  const RealURL = globalThis.URL;
  class MockURL extends RealURL {
    static createObjectURL() {
      return 'blob:mock';
    }
    static revokeObjectURL() {
      return undefined;
    }
  }
  vi.stubGlobal('URL', MockURL);

  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      const c = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => {
          canvases.push({ width: c.width, height: c.height, type, quality });
          queueMicrotask(() => cb(new Blob([new Uint8Array(32)], { type: 'image/jpeg' })));
        },
      };
      return c as unknown as HTMLCanvasElement;
    }
    return realCreate(tag);
  });
});

function file(type: string) {
  return new File([new Uint8Array(16)], 'x', { type });
}

describe('encodeImageAsJpeg', () => {
  it('outputs a JPEG File named cover.jpg', async () => {
    const out = await encodeImageAsJpeg(file('image/png'));
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('cover.jpg');
  });

  it('caps the longest edge (4000x2000 -> 1920x960)', async () => {
    await encodeImageAsJpeg(file('image/png'));
    expect(canvases[0]).toMatchObject({ width: 1920, height: 960 });
  });

  it('runs even for JPEG input (no short-circuit — still caps a 4000px JPEG)', async () => {
    await encodeImageAsJpeg(file('image/jpeg'));
    expect(canvases[0]).toMatchObject({ width: 1920, height: 960 });
  });

  it('honors a custom maxEdge and quality', async () => {
    await encodeImageAsJpeg(file('image/png'), 1000, 0.6);
    expect(canvases[0]).toMatchObject({
      width: 1000,
      height: 500,
      type: 'image/jpeg',
      quality: 0.6,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- apps/crm/src/utils/__tests__/imageJpeg.test.ts`
Expected: FAIL — `Cannot find module '../imageJpeg'`.

- [ ] **Step 3: Implement the util**

Create `apps/crm/src/utils/imageJpeg.ts`:

```ts
// apps/crm/src/utils/imageJpeg.ts
// Re-encodes an image File to JPEG, capping the longest edge. Used to normalize
// custom thumbnail uploads so they are valid Instagram Reel covers (cover_url
// reliably accepts JPEG only). Always run — even on JPEG input — so the size cap
// always applies. Re-encoding drops alpha; covers are opaque, so that's fine.
const DEFAULT_MAX_EDGE = 1920;
const DEFAULT_QUALITY = 0.85;

export function encodeImageAsJpeg(
  file: File,
  maxEdge = DEFAULT_MAX_EDGE,
  quality = DEFAULT_QUALITY,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // Browsers honor EXIF orientation by default (image-orientation: from-image),
    // so a rotated phone photo draws upright and naturalWidth/Height are oriented.
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return reject(new Error('Imagem inválida'));
      const scale = Math.min(maxEdge / Math.max(w, h), 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas indisponível'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Falha ao processar a imagem'));
          resolve(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e instanceof Error ? e : new Error('Falha ao carregar a imagem'));
    };
    img.src = url;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- apps/crm/src/utils/__tests__/imageJpeg.test.ts`
Expected: PASS (4 tests).

Note: jsdom can't decode real images, so EXIF orientation can't be unit-tested here — it's covered by the manual staging check (upload a rotated phone photo) in Task 7.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/utils/imageJpeg.ts apps/crm/src/utils/__tests__/imageJpeg.test.ts
git commit -m "feat(crm): encodeImageAsJpeg — normalize custom thumbnails to capped JPEG"
```

---

### Task 5: i18n — disclaimer copy + image-error key (pt + en)

**Files:**
- Modify: `packages/i18n/locales/pt/posts.json` (`thumbnailEditor`)
- Modify: `packages/i18n/locales/en/posts.json` (`thumbnailEditor`)

- [ ] **Step 1: Update `packages/i18n/locales/pt/posts.json`**

In the `thumbnailEditor` object, replace the `disclaimer` value and add an `imageError` key:

```json
    "disclaimer": "Esta miniatura será a capa do Reel no Instagram e aparece nas pré-visualizações do CRM e do portal do cliente. (Em carrosséis, o Instagram usa o primeiro item como capa.)",
    "imageError": "Não foi possível processar a imagem",
```

(The current `disclaimer` value to replace is: "A miniatura aparece na pré-visualização do CRM e do portal do cliente. Ela não altera a capa do Reel publicado no Instagram.")

- [ ] **Step 2: Update `packages/i18n/locales/en/posts.json`**

```json
    "disclaimer": "This thumbnail becomes the Reel's cover on Instagram and appears in the CRM and client portal previews. (For carousels, Instagram uses the first item as the cover.)",
    "imageError": "Could not process the image",
```

(The current `disclaimer` value to replace is: "The thumbnail is used in the CRM and client portal previews. It does not change the cover of the Reel published on Instagram.")

- [ ] **Step 3: Validate JSON and commit**

Run: `node -e "['pt','en'].forEach(l => { const d = JSON.parse(require('fs').readFileSync('packages/i18n/locales/'+l+'/posts.json','utf8')); if (!d.thumbnailEditor.imageError) throw new Error(l+' missing imageError'); console.log(l, 'ok'); })"`
Expected: `pt ok` / `en ok`.

```bash
git add packages/i18n/locales/pt/posts.json packages/i18n/locales/en/posts.json
git commit -m "feat(i18n): thumbnail-as-Reel-cover disclaimer + image-error string"
```

---

### Task 6: dialog — normalize custom uploads to JPEG

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx` (import + upload `onChange`)

- [ ] **Step 1: Import the util**

Add to the imports (next to `captureFrameFromElement`):

```tsx
import { captureFrameFromElement } from '../../../utils/videoFrame';
import { encodeImageAsJpeg } from '../../../utils/imageJpeg';
```

- [ ] **Step 2: Re-encode the uploaded image before using it**

Find the custom-upload file input's `onChange` (the `<input type="file" accept="image/jpeg,image/png,image/webp" ...>` inside the "Enviar imagem" label). It currently reads:

```tsx
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) choosePending(f);
                  e.target.value = '';
                }}
```

Replace it with (grab the file, reset the input synchronously, then await the JPEG re-encode):

```tsx
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    choosePending(await encodeImageAsJpeg(f));
                  } catch {
                    toast.error(t('thumbnailEditor.imageError'));
                  }
                }}
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run build`
Expected: tsc + vite pass.

Run: `npm run test -- apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`
Expected: PASS (the gallery test mocks `ThumbnailPickerDialog`, so it's unaffected; this confirms no import/typing breakage).

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx
git commit -m "feat(crm): normalize custom thumbnail uploads to JPEG for IG cover compatibility"
```

---

### Task 7: Full verification + staged deploy (go/no-go gate)

**Files:** none (verification + deploy)

- [ ] **Step 1: Frontend gates**

```bash
npx prettier --write apps/crm/src/utils/imageJpeg.ts apps/crm/src/utils/__tests__/imageJpeg.test.ts apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx packages/i18n/locales/pt/posts.json packages/i18n/locales/en/posts.json
npm run lint
npm run format:check
npm run test
npm run build
```
Expected: lint 0 errors, format clean, all Vitest pass, build OK. Commit any prettier diffs:
```bash
git add -A && git diff --cached --quiet || git commit -m "style: prettier"
```

- [ ] **Step 2: Backend (Deno) gate, then restore the workspace**

```bash
npm run test:functions
git checkout deno.lock && npm ci
```
Expected: all Deno tests pass (incl. the two `createVideoContainer` cover tests). The `git checkout deno.lock && npm ci` is mandatory — it undoes the lockfile/node_modules pollution that would otherwise break `npm run build`.

- [ ] **Step 3: Deploy to STAGING**

```bash
npx supabase functions deploy instagram-publish --project-ref wlyzhyfondykzpsiqsce
npx supabase functions deploy instagram-publish-cron --no-verify-jwt --project-ref wlyzhyfondykzpsiqsce
```
The deploy bundles + typechecks the Deno code — a type error in Task 2/3 fails here. (`instagram-publish-cron` keeps `--no-verify-jwt`; it authenticates via `x-cron-secret`.)

- [ ] **Step 4: Staging go/no-go gate (manual — STOP if it fails)**

On staging, publish a **single-video** Reel whose thumbnail you set in the editor, then on the published Reel confirm:
1. The chosen thumbnail is the actual Reel cover (not an Instagram-picked frame).
2. A **custom (PNG) upload** set in the dialog also becomes the cover (validates JPEG normalization end-to-end).
3. A **rotated phone photo** upload is not sideways as the cover (validates EXIF handling).

`GRAPH_BASE` is `graph.instagram.com/v22.0` (the Instagram-Login API). `cover_url` is documented as supported there, but **if the cover does not actually take effect, STOP — do not deploy to prod.** Report the finding.

- [ ] **Step 5: Deploy to PROD (gated on explicit approval)**

Only after Step 4 passes AND the user explicitly approves the prod deploy:

```bash
npx supabase functions deploy instagram-publish --project-ref skjzpekeqefvlojenfsw
npx supabase functions deploy instagram-publish-cron --no-verify-jwt --project-ref skjzpekeqefvlojenfsw
```

- [ ] **Step 6: Done**

Feature complete. The thumbnail (auto-frame or custom JPEG-normalized upload) is the Reel cover for single-video posts, with coverless retry protecting the publish path. Update PR #114 description to note the added backend cover change + edge-function deploy.
