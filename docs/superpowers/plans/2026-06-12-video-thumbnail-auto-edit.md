# Auto Video Thumbnails + Thumbnail Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Videos upload immediately with an auto-extracted frame as the default thumbnail, and users can change any video's thumbnail afterwards (scrub to a frame or upload an image) — CRM frontend only, zero backend changes.

**Architecture:** A new `videoFrame.ts` utility captures frames via hidden `<video>` + canvas (JPEG, longest edge ≤1920px). `PostMediaGallery` extracts a frame per video before calling the unchanged `uploadPostMedia`; extraction failures queue into a manual-thumbnail fallback panel (today's behavior). A new `ThumbnailPickerDialog` edits thumbnails post-upload through the **existing** `post-media-manage` endpoints (`POST /:id/thumbnail` → PUT to R2 → `PATCH /:id`).

**Tech Stack:** React 19, TanStack Query, shadcn Dialog, sonner, Vitest + Testing Library, react-i18next (`posts` namespace in `packages/i18n`).

**Spec:** `docs/superpowers/specs/2026-06-12-video-thumbnail-auto-edit-design.md` — read it first; it pins copy requirements ("Miniatura do vídeo" naming, Instagram disclaimer) and cache-invalidation requirements.

**Branch:** `feat/video-thumbnail-auto-edit` (already created).

**Conventions you must know:**
- No linter config locally, but CI enforces `npm run format:check`, `npm run lint`, coverage ratchet. Run `npx prettier --write` on touched files and `npm run lint` before pushing.
- Typecheck via `npm run build` (tsc + vite). Run after code changes.
- Do NOT run `deno test`/`deno check` — it pollutes the shared `node_modules` + `deno.lock` and breaks `npm run build` (recover with `git checkout deno.lock && npm ci`). This plan touches no edge functions, so Deno is not needed.
- Tests live in `__tests__` folders next to the code. Vitest config: `vitest.config.ts` at repo root, jsdom, setup file `test/vitest.setup.ts` already initializes i18n with the real `posts` locale files (so component tests render real Portuguese strings; default language is `pt`).
- Toasts: `toast()` from `sonner`; the `action: { label, onClick }` option is already used in `ExpressPostPage.tsx:293`.

---

### Task 1: Frame extraction utility (`videoFrame.ts`)

**Files:**
- Create: `apps/crm/src/utils/videoFrame.ts`
- Test: `apps/crm/src/utils/__tests__/videoFrame.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/utils/__tests__/videoFrame.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureFrameFromElement, extractVideoFrame } from '../videoFrame';

type FrameCb = () => void;

class MockVideo {
  static instances: MockVideo[] = [];

  preload = '';
  muted = false;
  playsInline = false;
  crossOrigin: string | null = null;
  videoWidth = 3840;
  videoHeight = 2160;
  duration = 13.2;
  readyState = 2; // HAVE_CURRENT_DATA
  currentTimeValue = 0;
  onloadedmetadata: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  frameCallbacks: FrameCb[] = [];
  srcValue = '';
  failOnLoad = false;

  constructor() {
    MockVideo.instances.push(this);
  }

  set src(value: string) {
    this.srcValue = value;
    queueMicrotask(() => {
      if (this.failOnLoad) this.onerror?.(new Event('error'));
      else this.onloadedmetadata?.();
    });
  }

  get src() {
    return this.srcValue;
  }

  set currentTime(value: number) {
    this.currentTimeValue = value;
    queueMicrotask(() => this.onseeked?.());
  }

  get currentTime() {
    return this.currentTimeValue;
  }

  requestVideoFrameCallback(cb: FrameCb) {
    queueMicrotask(cb);
    return 1;
  }

  removeAttribute() {}
  load() {}
}

const canvases: { width: number; height: number }[] = [];

beforeEach(() => {
  MockVideo.instances.length = 0;
  canvases.length = 0;

  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName === 'video') return new MockVideo() as unknown as HTMLVideoElement;
    if (tagName === 'canvas') {
      const fakeBlob = new Blob([new Uint8Array(64)], { type: 'image/jpeg' });
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb: (blob: Blob | null) => void) => queueMicrotask(() => cb(fakeBlob)),
      };
      canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    }
    return realCreateElement(tagName);
  });

  const RealURL = globalThis.URL;
  class MockURL extends RealURL {
    static createObjectURL() {
      return 'blob:mocked';
    }

    static revokeObjectURL() {
      return undefined;
    }
  }
  vi.stubGlobal('URL', MockURL);
});

function createVideoFile() {
  return new File([new Uint8Array(256)], 'reel.mp4', { type: 'video/mp4' });
}

describe('captureFrameFromElement', () => {
  it('captures a JPEG scaled so the longest edge is 1920', async () => {
    const video = new MockVideo();
    const file = await captureFrameFromElement(video as unknown as HTMLVideoElement);

    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('thumb.jpg');
    expect(canvases[0]).toMatchObject({ width: 1920, height: 1080 });
  });

  it('does not upscale small videos', async () => {
    const video = new MockVideo();
    video.videoWidth = 720;
    video.videoHeight = 1280;
    await captureFrameFromElement(video as unknown as HTMLVideoElement);

    expect(canvases[0]).toMatchObject({ width: 720, height: 1280 });
  });

  it('rejects when no frame data is available yet', async () => {
    const video = new MockVideo();
    video.readyState = 1; // HAVE_METADATA

    await expect(captureFrameFromElement(video as unknown as HTMLVideoElement)).rejects.toThrow();
  });
});

describe('extractVideoFrame', () => {
  it('seeks to min(0.5, duration/2) and resolves with a frame', async () => {
    const file = await extractVideoFrame(createVideoFile());

    expect(file.type).toBe('image/jpeg');
    expect(MockVideo.instances[0].currentTimeValue).toBe(0.5);
    expect(MockVideo.instances[0].muted).toBe(true);
  });

  it('halves the seek target for very short videos', async () => {
    const promise = extractVideoFrame(createVideoFile());
    MockVideo.instances[0].duration = 0.6;
    await promise;

    expect(MockVideo.instances[0].currentTimeValue).toBeCloseTo(0.3);
  });

  it('falls back to t=0 when duration is not finite', async () => {
    const promise = extractVideoFrame(createVideoFile());
    MockVideo.instances[0].duration = NaN;
    await promise;

    expect(MockVideo.instances[0].currentTimeValue).toBe(0);
  });

  it('honors an explicit timeSeconds', async () => {
    await extractVideoFrame(createVideoFile(), 7.25);

    expect(MockVideo.instances[0].currentTimeValue).toBe(7.25);
  });

  it('sets crossOrigin only for remote URLs', async () => {
    await extractVideoFrame('https://r2.example.com/video.mp4?signed=1');
    expect(MockVideo.instances[0].crossOrigin).toBe('anonymous');

    await extractVideoFrame(createVideoFile());
    expect(MockVideo.instances[1].crossOrigin).toBeNull();
  });

  it('rejects when the video cannot be decoded', async () => {
    const promise = extractVideoFrame(createVideoFile());
    MockVideo.instances[0].failOnLoad = true;

    await expect(promise).rejects.toThrow('Não foi possível decodificar o vídeo');
  });
});
```

Note the trick used by `'halves the seek target'` / `'falls back to t=0'` / `'rejects when…'`: `extractVideoFrame` is called first (synchronously creating the mock video), then the test mutates the instance **before** the microtask fires `onloadedmetadata`/`onerror`. The `duration`/`failOnLoad` mutations land in time because `set src` defers via `queueMicrotask`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- apps/crm/src/utils/__tests__/videoFrame.test.ts`
Expected: FAIL — `Cannot find module '../videoFrame'` (or equivalent resolve error).

- [ ] **Step 3: Implement `videoFrame.ts`**

Create `apps/crm/src/utils/videoFrame.ts`:

```ts
// apps/crm/src/utils/videoFrame.ts
// Captures video frames as JPEG thumbnails. Display-only artifacts (CRM/Hub
// posters) — Instagram publishing never reads them — so resolution is capped.
const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.85;
const LOAD_TIMEOUT_MS = 15_000;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

export function captureFrameFromElement(video: HTMLVideoElement): Promise<File> {
  return new Promise((resolve, reject) => {
    // 2 = HAVE_CURRENT_DATA: anything less and drawImage paints black.
    if (video.readyState < 2) {
      return reject(new Error('O vídeo ainda não carregou um frame'));
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return reject(new Error('Dimensões do vídeo indisponíveis'));
    const scale = Math.min(MAX_EDGE / Math.max(w, h), 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas indisponível'));
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      return reject(e instanceof Error ? e : new Error('Falha ao capturar o frame'));
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Falha ao gerar a miniatura'));
        resolve(new File([blob], 'thumb.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

export function extractVideoFrame(source: File | string, timeSeconds?: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const isFile = source instanceof File;
    const url = isFile ? URL.createObjectURL(source) : source;
    const video = document.createElement('video') as VideoWithFrameCallback;
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    if (!isFile) video.crossOrigin = 'anonymous';

    let settled = false;
    const cleanup = () => {
      if (isFile) URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(err instanceof Error ? err : new Error('Não foi possível ler o vídeo'));
    };
    const succeed = (file: File) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(file);
    };
    const timer = setTimeout(
      () => fail(new Error('Tempo esgotado ao ler o vídeo')),
      LOAD_TIMEOUT_MS,
    );

    video.onerror = () => fail(new Error('Não foi possível decodificar o vídeo'));

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = timeSeconds ?? Math.min(0.5, duration / 2);
      // seeked alone is not enough: some browsers still paint the previous
      // frame. requestVideoFrameCallback waits for actual frame presentation.
      video.onseeked = () => {
        const capture = () => captureFrameFromElement(video).then(succeed, fail);
        if (typeof video.requestVideoFrameCallback === 'function') {
          video.requestVideoFrameCallback(capture);
        } else {
          requestAnimationFrame(capture);
        }
      };
      video.currentTime = target;
    };

    video.src = url;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- apps/crm/src/utils/__tests__/videoFrame.test.ts`
Expected: PASS (9 tests).

If the `requestAnimationFrame` fallback path complains in jsdom, it is not exercised by these tests (the mock always has `requestVideoFrameCallback`) — failures here mean implementation bugs, not environment issues.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/utils/videoFrame.ts apps/crm/src/utils/__tests__/videoFrame.test.ts
git commit -m "feat(crm): video frame extraction utility for auto thumbnails"
```

---

### Task 2: `updateVideoThumbnail` service function

**Files:**
- Modify: `apps/crm/src/services/postMedia.ts` (append after `reorderPostMedia`, ~line 262)
- Test: `apps/crm/src/services/__tests__/postMedia.test.ts` (append inside the existing `describe`)

- [ ] **Step 1: Write the failing tests**

Append to the `describe('post media service', ...)` block in `apps/crm/src/services/__tests__/postMedia.test.ts` (the existing `fetchHarness` / `MockXHR` setup covers these — no new mocks needed). Add `updateVideoThumbnail` to the existing import list from `'../postMedia'`.

```ts
  it('updates a video thumbnail via presign, PUT, then PATCH', async () => {
    const thumbnail = createFile('nova-capa.jpg', 'image/jpeg', 64);

    fetchHarness.queueResponse({
      json: {
        thumbnail_r2_key: 'contas/1/files/novo.thumb.jpg',
        thumbnail_upload_url: 'https://upload.r2.dev/thumb-new',
      },
    });
    fetchHarness.queueResponse({
      json: {
        id: 7,
        kind: 'video',
        thumbnail_r2_key: 'contas/1/files/novo.thumb.jpg',
      },
    });

    const media = await updateVideoThumbnail(7, thumbnail);

    expect(media).toMatchObject({ id: 7, thumbnail_r2_key: 'contas/1/files/novo.thumb.jpg' });

    expect(fetchHarness.calls).toHaveLength(2);
    expect(String(fetchHarness.calls[0].input)).toContain('post-media-manage/7/thumbnail');
    expect(fetchHarness.calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toMatchObject({
      mime_type: 'image/jpeg',
    });

    expect(String(fetchHarness.calls[1].input)).toContain('post-media-manage/7');
    expect(fetchHarness.calls[1].init?.method).toBe('PATCH');
    expect(JSON.parse(String(fetchHarness.calls[1].init?.body))).toMatchObject({
      thumbnail_r2_key: 'contas/1/files/novo.thumb.jpg',
    });

    expect(MockXHR.instances).toHaveLength(1);
    expect(MockXHR.instances[0].method).toBe('PUT');
    expect(MockXHR.instances[0].url).toBe('https://upload.r2.dev/thumb-new');
    expect(MockXHR.instances[0].body).toBe(thumbnail);
  });

  it('rejects unsupported thumbnail mime types before any network call', async () => {
    await expect(
      updateVideoThumbnail(7, createFile('anim.gif', 'image/gif', 64)),
    ).rejects.toThrow('Tipo de arquivo não suportado: image/gif');
    expect(fetchHarness.calls).toHaveLength(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- apps/crm/src/services/__tests__/postMedia.test.ts`
Expected: FAIL — `updateVideoThumbnail` is not exported.

- [ ] **Step 3: Implement the service function**

In `apps/crm/src/services/postMedia.ts`, add after `reorderPostMedia` (before the `uploadMany` helper):

```ts
// Mirrors THUMB_MIME in post-media-manage (gif is valid media but not a poster).
const VIDEO_THUMB_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export async function updateVideoThumbnail(linkId: number, thumbnail: File): Promise<PostMedia> {
  if (!VIDEO_THUMB_MIME.includes(thumbnail.type)) {
    throw new Error(`Tipo de arquivo não suportado: ${thumbnail.type}`);
  }
  const signed = await callFn<{ thumbnail_r2_key: string; thumbnail_upload_url: string }>(
    'post-media-manage',
    'POST',
    { mime_type: thumbnail.type, size_bytes: thumbnail.size },
    undefined,
    `/${linkId}/thumbnail`,
  );
  await putWithProgress(signed.thumbnail_upload_url, thumbnail);
  return callFn<PostMedia>(
    'post-media-manage',
    'PATCH',
    { thumbnail_r2_key: signed.thumbnail_r2_key },
    undefined,
    `/${linkId}`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- apps/crm/src/services/__tests__/postMedia.test.ts`
Expected: PASS (all existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services/postMedia.ts apps/crm/src/services/__tests__/postMedia.test.ts
git commit -m "feat(crm): updateVideoThumbnail service against existing post-media-manage endpoints"
```

---

### Task 3: i18n strings (pt + en)

**Files:**
- Modify: `packages/i18n/locales/pt/posts.json`
- Modify: `packages/i18n/locales/en/posts.json`

Naming rule from the spec: the thumbnail feature says **"miniatura"** everywhere; plain **"capa"** stays reserved for the `is_cover` concept already on the tile ("Definir como capa").

- [ ] **Step 1: Add keys to `packages/i18n/locales/pt/posts.json`**

Inside the existing `"mediaGallery"` object, add:

```json
    "adjustThumbnail": "Ajustar miniatura",
    "videoThumbnail": "Miniatura do vídeo",
    "thumbnailHint": "Vídeos ganham uma miniatura automática (um frame do vídeo). Você pode ajustá-la depois pelo ícone de imagem no vídeo.",
    "thumbnailFallback": "Não foi possível gerar a miniatura automaticamente. Selecione uma imagem de capa para",
    "remainingVideos": "{{count}} vídeo(s) aguardando miniatura"
```

Add a sibling top-level `"thumbnailEditor"` object (same nesting level as `"mediaGallery"`):

```json
  "thumbnailEditor": {
    "title": "Miniatura do vídeo",
    "disclaimer": "A miniatura aparece na pré-visualização do CRM e do portal do cliente. Ela não altera a capa do Reel publicado no Instagram.",
    "useFrame": "Usar este frame",
    "uploadImage": "Enviar imagem",
    "current": "Miniatura atual",
    "preview": "Nova miniatura",
    "save": "Salvar miniatura",
    "saving": "Salvando…",
    "captureError": "Não foi possível capturar o frame",
    "updated": "Miniatura atualizada"
  }
```

- [ ] **Step 2: Add the mirrored keys to `packages/i18n/locales/en/posts.json`**

In `"mediaGallery"`:

```json
    "adjustThumbnail": "Adjust thumbnail",
    "videoThumbnail": "Video thumbnail",
    "thumbnailHint": "Videos get an automatic thumbnail (a frame from the video). You can adjust it later via the image icon on the video.",
    "thumbnailFallback": "Could not generate a thumbnail automatically. Select a cover image for",
    "remainingVideos": "{{count}} video(s) awaiting a thumbnail"
```

Top-level `"thumbnailEditor"`:

```json
  "thumbnailEditor": {
    "title": "Video thumbnail",
    "disclaimer": "The thumbnail is used in the CRM and client portal previews. It does not change the cover of the Reel published on Instagram.",
    "useFrame": "Use this frame",
    "uploadImage": "Upload image",
    "current": "Current thumbnail",
    "preview": "New thumbnail",
    "save": "Save thumbnail",
    "saving": "Saving…",
    "captureError": "Could not capture the frame",
    "updated": "Thumbnail updated"
  }
```

- [ ] **Step 3: Validate JSON and commit**

Run: `node -e "['pt','en'].forEach(l => JSON.parse(require('fs').readFileSync('packages/i18n/locales/'+l+'/posts.json','utf8')) && console.log(l, 'ok'))"`
Expected: `pt ok` / `en ok`.

```bash
git add packages/i18n/locales/pt/posts.json packages/i18n/locales/en/posts.json
git commit -m "feat(i18n): strings for video thumbnail auto-generation and editor"
```

---

### Task 4: `ThumbnailPickerDialog` component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx`

No isolated component test here — this dialog is exercised end-to-end by the gallery tests in Task 6 and the manual verification in Task 7. (jsdom cannot decode video, so a standalone test would mock away everything the component does.)

- [ ] **Step 1: Create the component**

The video element uses **native `controls`** as the scrubber (play/pause/timeline) — no custom slider. Capture pauses first: on a playing element the frame advances between click and draw.

```tsx
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { captureFrameFromElement } from '../../../utils/videoFrame';
import { updateVideoThumbnail } from '../../../services/postMedia';
import type { PostMedia } from '../../../store';

interface ThumbnailPickerDialogProps {
  /** Video link to edit, or null when closed. Pass the freshest object you
   * have (signed URLs expire in ~15min) — the gallery derives it from the
   * live query cache at open time. */
  media: PostMedia | null;
  onClose: () => void;
  /** Called after a successful save, before closing. The gallery uses this to
   * invalidate ['post-media', postId] and ['workflow-covers']. */
  onUpdated: () => void;
}

export function ThumbnailPickerDialog({ media, onClose, onUpdated }: ThumbnailPickerDialogProps) {
  const { t } = useTranslation('posts');
  const { t: tc } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    };
  }, [pendingUrl]);

  // Reset choice when the dialog opens for a different video.
  useEffect(() => {
    setPending(null);
    setPendingUrl(null);
    setSaving(false);
  }, [media?.id]);

  function choosePending(file: File) {
    setPending(file);
    setPendingUrl(URL.createObjectURL(file));
  }

  async function handleCapture() {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.pause();
      choosePending(await captureFrameFromElement(video));
    } catch {
      toast.error(t('thumbnailEditor.captureError'));
    }
  }

  async function handleSave() {
    if (!media || !pending) return;
    setSaving(true);
    try {
      await updateVideoThumbnail(media.id, pending);
      toast.success(t('thumbnailEditor.updated'));
      onUpdated();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={media !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('thumbnailEditor.title')}</DialogTitle>
          <DialogDescription>{t('thumbnailEditor.disclaimer')}</DialogDescription>
        </DialogHeader>
        {media && (
          <div className="space-y-3">
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCapture}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-900 text-white text-[11px] font-semibold hover:bg-stone-700"
              >
                {t('thumbnailEditor.useFrame')}
              </button>
              <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-100 text-stone-700 text-[11px] font-semibold cursor-pointer hover:bg-stone-200">
                {t('thumbnailEditor.uploadImage')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) choosePending(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <div className="flex gap-3">
              {media.thumbnail_url && (
                <figure className="flex-1 min-w-0">
                  <img
                    src={media.thumbnail_url}
                    alt={t('thumbnailEditor.current')}
                    className="w-full aspect-video object-cover rounded-lg ring-1 ring-stone-200/80"
                  />
                  <figcaption className="mt-1 text-[11px] text-stone-500">
                    {t('thumbnailEditor.current')}
                  </figcaption>
                </figure>
              )}
              {pendingUrl && (
                <figure className="flex-1 min-w-0">
                  <img
                    src={pendingUrl}
                    alt={t('thumbnailEditor.preview')}
                    className="w-full aspect-video object-cover rounded-lg ring-2 ring-[#eab308]"
                  />
                  <figcaption className="mt-1 text-[11px] font-semibold text-stone-700">
                    {t('thumbnailEditor.preview')}
                  </figcaption>
                </figure>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-stone-600 hover:bg-stone-100"
          >
            {tc('actions.cancel')}
          </button>
          <button
            type="button"
            disabled={!pending || saving}
            onClick={handleSave}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {saving ? t('thumbnailEditor.saving') : t('thumbnailEditor.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: tsc passes (vite build completes). If `actions.cancel` typing complains, note the gallery already uses `tc('actions.cancel')` from the default namespace — copy its exact usage.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx
git commit -m "feat(crm): thumbnail picker dialog (frame capture + custom upload)"
```

---

### Task 5: Rework `PostMediaGallery` upload flow + editor entry points

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`

Spec requirements implemented here: auto-extract per video before `uploadPostMedia` (service contract unchanged); concurrency capped via `uploadMany` (3); `pendingVideos` queue replaces single-slot `pendingVideo`; `['workflow-covers']` invalidated after uploads and edits; post-upload toast action "Ajustar miniatura"; tile hover action inside the stop-propagation wrapper; editor reads the freshest media from the query-backed `media` state.

- [ ] **Step 1: Update imports and state**

Imports — add `Image as ImageIcon` to the lucide import, `uploadMany` and `updateVideoThumbnail` are NOT needed here (`updateVideoThumbnail` lives in the dialog), but `uploadMany` and `extractVideoFrame` and the dialog are:

```tsx
import { Upload, Star, Trash2, AlertTriangle, Download, FolderOpen, Image as ImageIcon } from 'lucide-react';
```

```tsx
import {
  listPostMedia,
  uploadPostMedia,
  deletePostMedia,
  setPostMediaCover,
  reorderPostMedia,
  detectKind,
  uploadMany,
} from '../../../services/postMedia';
import { extractVideoFrame } from '../../../utils/videoFrame';
import { ThumbnailPickerDialog } from './ThumbnailPickerDialog';
```

Replace the `pendingVideo` state (line 92) and add editor state:

```tsx
  const [pendingVideos, setPendingVideos] = useState<File[]>([]);
  const [editingMedia, setEditingMedia] = useState<PostMedia | null>(null);
```

Below the `refresh` definition (line 112), add a combined invalidator — the kanban board (`useEntregasData.ts:229`) and client detail page (`ClienteDetalhePage.tsx:339`) read `thumbnail_url` from the separate `['workflow-covers', ...]` query:

```tsx
  const refresh = () => qc.invalidateQueries({ queryKey: ['post-media', postId] });
  const refreshWithCovers = () => {
    refresh();
    qc.invalidateQueries({ queryKey: ['workflow-covers'] });
  };
```

- [ ] **Step 2: Rewrite `handleFiles`**

Replace the whole function (lines 115-176). Videos no longer divert to a blocking prompt; everything in the selection uploads through `uploadMany` (cap 3 — bounds simultaneous hidden-`<video>` decodes too). Extraction failure queues the file for the manual fallback panel:

```tsx
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);

    setUploading(true);
    const stamp = Date.now();
    const items = fileArr.map((file, i) => ({ file, uid: `upload-${stamp}-${i}` }));
    setUploadQueue((prev) => {
      const next = new Map(prev);
      items.forEach(({ file, uid }) => next.set(uid, { name: file.name, pct: 0, status: 'uploading' }));
      return next;
    });

    let hasError = false;
    await uploadMany(items, async ({ file, uid }) => {
      try {
        let thumbnail: File | undefined;
        if (detectKind(file) === 'video') {
          try {
            thumbnail = await extractVideoFrame(file);
          } catch {
            // Browser can't decode this video — fall back to asking for a
            // manual thumbnail (finalize rejects videos without one).
            setPendingVideos((prev) => [...prev, file]);
            setUploadQueue((prev) => {
              const next = new Map(prev);
              next.delete(uid);
              return next;
            });
            return;
          }
        }
        const uploaded = await uploadPostMedia({
          postId,
          file,
          thumbnail,
          onProgress: (p) =>
            setUploadQueue((prev) => {
              const next = new Map(prev);
              next.set(uid, {
                name: file.name,
                pct: Math.round((p.loaded / p.total) * 100),
                status: 'uploading',
              });
              return next;
            }),
        });
        setUploadQueue((prev) => {
          const next = new Map(prev);
          next.set(uid, { name: file.name, pct: 100, status: 'done' });
          return next;
        });
        if (uploaded.kind === 'video') {
          toast.success(t('mediaGallery.videoUploaded'), {
            action: {
              label: t('mediaGallery.adjustThumbnail'),
              onClick: () => setEditingMedia(uploaded),
            },
          });
        }
      } catch (e) {
        hasError = true;
        toast.error(`${file.name}: ${(e as Error).message}`);
        setUploadQueue((prev) => {
          const next = new Map(prev);
          next.set(uid, { name: file.name, pct: 0, status: 'error' });
          return next;
        });
      }
    });

    refreshWithCovers();
    if (!hasError) toast.success(t('mediaGallery.uploadDone'));
    setUploading(false);
    setTimeout(() => setUploadQueue(new Map()), 2000);
  }
```

- [ ] **Step 3: Rewrite `handleVideoThumbnail` for the queue**

Replace the function (lines 178-222). It now consumes `pendingVideos[0]`:

```tsx
  async function handleVideoThumbnail(thumbnail: File) {
    const video = pendingVideos[0];
    if (!video) return;
    setPendingVideos((prev) => prev.slice(1));
    setUploading(true);
    const uid = `upload-video-${Date.now()}`;
    setUploadQueue((prev) => {
      const next = new Map(prev);
      next.set(uid, { name: video.name, pct: 0, status: 'uploading' });
      return next;
    });
    try {
      await uploadPostMedia({
        postId,
        file: video,
        thumbnail,
        onProgress: (p) =>
          setUploadQueue((prev) => {
            const next = new Map(prev);
            next.set(uid, {
              name: video.name,
              pct: Math.round((p.loaded / p.total) * 100),
              status: 'uploading',
            });
            return next;
          }),
      });
      setUploadQueue((prev) => {
        const next = new Map(prev);
        next.set(uid, { name: video.name, pct: 100, status: 'done' });
        return next;
      });
      refreshWithCovers();
      toast.success(t('mediaGallery.videoUploaded'));
    } catch (e) {
      toast.error((e as Error).message);
      setUploadQueue((prev) => {
        const next = new Map(prev);
        next.set(uid, { name: video.name, pct: 0, status: 'error' });
        return next;
      });
    } finally {
      setUploading(false);
      setTimeout(() => setUploadQueue(new Map()), 2000);
    }
  }
```

- [ ] **Step 4: Update the fallback panel JSX**

Replace the `{pendingVideo && (...)}` block (lines 435-466) with a queue-aware version. The heading copy changes — extraction failed, so explain that — and a counter shows when more videos wait:

```tsx
      {pendingVideos.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200/60 px-3 py-2.5 text-amber-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="text-[12.5px] font-semibold">{t('mediaGallery.videoThumbnail')}</span>
          </div>
          <span className="text-[12px] text-stone-600">
            {t('mediaGallery.thumbnailFallback')} <strong>{pendingVideos[0].name}</strong>
          </span>
          {pendingVideos.length > 1 && (
            <span className="text-[11px] text-stone-500">
              {t('mediaGallery.remainingVideos', { count: pendingVideos.length - 1 })}
            </span>
          )}
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-900 text-white text-[11px] font-semibold cursor-pointer hover:bg-stone-700">
              {t('mediaGallery.chooseThumbnail')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleVideoThumbnail(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setPendingVideos((prev) => prev.slice(1))}
              className="text-[11px] text-stone-500 hover:text-stone-700"
            >
              {tc('actions.cancel')}
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Update the `UploadHint` copy**

Replace the hint (lines 403-408):

```tsx
      {!disabled && !atLimit && <UploadHint icon="🎬" text={t('mediaGallery.thumbnailHint')} />}
```

(If `UploadHint`'s `text` prop is typed as `string`, this is fine — `t()` returns string.)

- [ ] **Step 6: Wire the editor dialog and tile action**

Add the dialog next to `PostMediaLightbox` (after line 476). `editingMedia` may have been captured from an upload result or stale tile — re-derive from the live `media` state so the signed URL is the freshest available:

```tsx
      <ThumbnailPickerDialog
        media={editingMedia ? (media.find((m) => m.id === editingMedia.id) ?? editingMedia) : null}
        onClose={() => setEditingMedia(null)}
        onUpdated={refreshWithCovers}
      />
```

Pass the new callback where tiles render (lines 340-349):

```tsx
              <SortableMediaTile
                key={m.id}
                media={m}
                disabled={disabled}
                onOpen={() => setLightboxIndex(i)}
                onSetCover={() => handleSetCover(m.id)}
                onDelete={() => handleDelete(m.id)}
                onEditThumbnail={m.kind === 'video' ? () => setEditingMedia(m) : undefined}
              />
```

In `SortableMediaTileProps` add:

```tsx
  onEditThumbnail?: () => void;
```

…and in `SortableMediaTile`, destructure `onEditThumbnail` and render the new button **inside the existing wrapper** that has `onPointerDown={(e) => e.stopPropagation()}` (line 544-548) — the tile container handles click (lightbox) and drag, so the button must live there like the star/trash buttons do. Insert before the delete button. Title uses the "miniatura" wording (the tile's existing labels are hardcoded pt, so match that):

```tsx
          {onEditThumbnail && (
            <button
              type="button"
              onClick={onEditThumbnail}
              title="Miniatura do vídeo"
              className="flex items-center justify-center w-6 h-6 rounded-full bg-stone-900/85 text-white hover:bg-stone-900"
            >
              <ImageIcon className="h-3 w-3" />
            </button>
          )}
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npm run build`
Expected: tsc + vite pass.

Run: `npm run test -- run`
Expected: PASS (no regressions — `hasVideoMissingThumbnail` at the bottom of the file is untouched and still exported).

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostMediaGallery.tsx
git commit -m "feat(crm): auto video thumbnails on upload + thumbnail editor entry points"
```

---

### Task 6: Gallery orchestration tests

**Files:**
- Create: `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`

These verify the spec's orchestration requirements at the component boundary: extraction per video, fallback queue on extraction failure (incl. two failures → both queued, no silent overwrite), mixed selections all uploading, and `['workflow-covers']` invalidation. Services and the extractor are mocked; i18n is real (setup file loads `posts` pt strings).

- [ ] **Step 1: Write the tests**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../services/postMedia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/postMedia')>();
  return {
    ...actual,
    listPostMedia: vi.fn(async () => []),
    uploadPostMedia: vi.fn(),
    deletePostMedia: vi.fn(),
    setPostMediaCover: vi.fn(),
    reorderPostMedia: vi.fn(),
  };
});

vi.mock('../../../../utils/videoFrame', () => ({
  extractVideoFrame: vi.fn(),
  captureFrameFromElement: vi.fn(),
}));

vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: () => null,
}));

vi.mock('../../../arquivos/components/FilePickerModal', () => ({
  FilePickerModal: () => null,
}));

vi.mock('../../../../services/fileService', () => ({
  linkFileToPost: vi.fn(),
  unlinkFileFromPost: vi.fn(),
}));

import { uploadPostMedia } from '../../../../services/postMedia';
import { extractVideoFrame } from '../../../../utils/videoFrame';
import { PostMediaGallery } from '../PostMediaGallery';

const uploadPostMediaMock = vi.mocked(uploadPostMedia);
const extractVideoFrameMock = vi.mocked(extractVideoFrame);

function createFile(name: string, type: string) {
  return new File([new Uint8Array(64)], name, { type });
}

function renderGallery() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <PostMediaGallery postId={42} />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

async function pickFiles(files: File[]) {
  // The add tile is a label wrapping a hidden file input.
  const input = (await screen.findByText('Adicionar')).closest('label')!.querySelector('input')!;
  await userEvent.upload(input, files);
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadPostMediaMock.mockImplementation(async ({ file }) => ({
    id: Math.floor(Math.random() * 1000),
    post_id: 42,
    kind: file.type.startsWith('video/') ? 'video' : 'image',
  }) as Awaited<ReturnType<typeof uploadPostMedia>>);
  extractVideoFrameMock.mockResolvedValue(createFile('thumb.jpg', 'image/jpeg'));
});

describe('PostMediaGallery upload orchestration', () => {
  it('auto-extracts a frame and uploads videos without prompting', async () => {
    renderGallery();
    const video = createFile('reel.mp4', 'video/mp4');

    await pickFiles([video]);

    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(extractVideoFrameMock).toHaveBeenCalledWith(video);
    expect(uploadPostMediaMock.mock.calls[0][0]).toMatchObject({
      postId: 42,
      file: video,
      thumbnail: expect.any(File),
    });
    expect(screen.queryByText(/Não foi possível gerar a miniatura/)).not.toBeInTheDocument();
  });

  it('uploads every file in a mixed selection (no drop-the-rest)', async () => {
    renderGallery();
    const files = [
      createFile('a.jpg', 'image/jpeg'),
      createFile('b.mp4', 'video/mp4'),
      createFile('c.png', 'image/png'),
    ];

    await pickFiles(files);

    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(3));
    expect(extractVideoFrameMock).toHaveBeenCalledTimes(1);
  });

  it('queues undecodable videos for manual thumbnails instead of overwriting', async () => {
    renderGallery();
    extractVideoFrameMock.mockRejectedValue(new Error('decode failed'));
    const videos = [createFile('um.mov', 'video/quicktime'), createFile('dois.mov', 'video/quicktime')];

    await pickFiles(videos);

    await waitFor(() => expect(screen.getByText('um.mov')).toBeInTheDocument());
    expect(uploadPostMediaMock).not.toHaveBeenCalled();
    // Second failed video is queued behind the first, not lost.
    expect(screen.getByText(/1 vídeo\(s\) aguardando miniatura/)).toBeInTheDocument();
  });

  it('uploads the queued video once a manual thumbnail is chosen', async () => {
    renderGallery();
    extractVideoFrameMock.mockRejectedValue(new Error('decode failed'));
    const video = createFile('um.mov', 'video/quicktime');
    await pickFiles([video]);
    await screen.findByText('um.mov');

    const manualThumb = createFile('capa.jpg', 'image/jpeg');
    const label = screen.getByText('Escolher thumbnail');
    const input = label.closest('label')!.querySelector('input')!;
    await userEvent.upload(input, manualThumb);

    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(uploadPostMediaMock.mock.calls[0][0]).toMatchObject({
      file: video,
      thumbnail: manualThumb,
    });
    await waitFor(() => expect(screen.queryByText('um.mov')).not.toBeInTheDocument());
  });

  it('invalidates workflow-covers after uploads', async () => {
    const { invalidateSpy } = renderGallery();

    await pickFiles([createFile('reel.mp4', 'video/mp4')]);

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-covers'] }),
    );
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -- apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`
Expected: PASS (5 tests).

Troubleshooting notes for the implementer:
- If `userEvent.upload` does not fire on the hidden input, fall back to `fireEvent.change(input, { target: { files } })` from `@testing-library/react` — the input is `hidden`, which `userEvent` v14 tolerates via `applyAccept: false`, but older versions may need `fireEvent`.
- If `sonner`'s `toast` errors in jsdom, add `vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))` to the mock block — none of these tests assert on toast UI.
- The `'Adicionar'` / `'Escolher thumbnail'` strings come from the real pt locale loaded by `test/vitest.setup.ts`; if lookups fail, check the default language is `pt` (it is, via `getSavedLanguage()` fallback).

- [ ] **Step 3: Run the full suite and typecheck**

Run: `npm run test && npm run build`
Expected: PASS / build OK.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx
git commit -m "test(crm): gallery orchestration coverage for auto thumbnails and fallback queue"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Format and lint (CI gates)**

```bash
npx prettier --write apps/crm/src/utils/videoFrame.ts apps/crm/src/utils/__tests__/videoFrame.test.ts apps/crm/src/services/postMedia.ts apps/crm/src/services/__tests__/postMedia.test.ts apps/crm/src/pages/entregas/components/ThumbnailPickerDialog.tsx apps/crm/src/pages/entregas/components/PostMediaGallery.tsx apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx packages/i18n/locales/pt/posts.json packages/i18n/locales/en/posts.json
npm run lint
npm run format:check
```

Expected: lint and format:check pass. Commit any prettier diffs:

```bash
git add -A && git diff --cached --quiet || git commit -m "style: prettier"
```

- [ ] **Step 2: Full test suite + build**

```bash
npm run test && npm run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 3: Manual verification in the running app (staging)**

```bash
npm run dev:staging
```

Checklist (use a workflow post's media gallery on :5173):
1. Upload an `.mp4` → uploads immediately, tile shows an auto-generated poster (not black), no thumbnail prompt.
2. Upload a mixed selection (2 images + 1 video) → all three appear.
3. Hover the video tile → image icon ("Miniatura do vídeo") opens the dialog; scrub with native controls, "Usar este frame" shows the preview; save → tile poster updates; kanban board card cover updates without a page reload.
4. In the dialog, "Enviar imagem" with a JPEG → preview + save works.
5. Dialog shows the Instagram disclaimer text.
6. If available, a video the browser can't decode (e.g., HEVC `.mov`) → amber fallback panel asks for a manual thumbnail; choosing one uploads the video.

- [ ] **Step 4: Done**

Implementation complete on `feat/video-thumbnail-auto-edit`. Hand back for review / PR (superpowers:finishing-a-development-branch).
