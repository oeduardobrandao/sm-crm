# Reduce oversized videos for Instagram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer a one-click, in-browser resize for videos Instagram rejects only for width (> 1920 px) or size, both when they are picked and when they already sit on a post.

**Architecture:** Pure planning/eligibility modules (`downscalePlan.ts`, `oversize.ts`) feed a lazy-loaded engine (`downscaleVideo.ts`: Mediabunny/WebCodecs first, scale-only ffmpeg.wasm fallback). Two UI surfaces consume it: an offer dialog in `PostMediaGallery.handleFiles` and a "Reduzir resolução" progress dialog from the warning box.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, `mediabunny@1.61.4` (new), `@ffmpeg/ffmpeg` 0.12.15 / `@ffmpeg/core` 0.12.10 (existing), react-i18next, sonner, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-26-video-4k-downscale-design.md`

## Global Constraints

- Frontend only. Nothing under `supabase/` changes. `validateMedia` and its messages do not change (parity test with `_shared`).
- `mediabunny` pinned **exact** `1.61.4` in the root `package.json` `dependencies`; imported only via `await import('mediabunny')` inside functions (SSR prerender runs every module top level).
- No module-level `window`/`document`/`navigator`/`localStorage` access in any new file.
- Target: scale = min(1080/shortSide, 1920/width, 1); each side = floor to even of side×scale. Bitrate `min(8_000_000, maxBytes*8*0.88/duration − 128_000)`, floor 100_000. `maxBytes` 300 MB (`VIDEO_MAX_BYTES`), 100 MB Stories (`STORY_VIDEO_MAX_BYTES`).
- ffmpeg fallback input ceiling: 500 MB desktop, 200 MB iOS/iPadOS. Client cap stays 2 GB (`validateFile`).
- Copy (pt): width reason "Largura acima de 1920 px (ex.: 4K). O Instagram não aceita."; size reason "Acima de 300 MB (100 MB nos Stories)."; no em-dashes in user copy. All new strings via i18n keys in `packages/i18n/locales/{pt,en}/posts.json` under `mediaGallery.downscale.*` (Task 1 adds every key).
- Icons `lucide-react` only. Toasts via `sonner`.
- Long-running work wrapped in `trackUnsavedWork` (`@mesaas/app-lifecycle`). Never `useBlocker`.
- Run prettier/eslint `--fix` only on your own paths; commit with a pathspec. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A probe that never resolves (jsdom, undecodable HEVC) must not stall the upload: 10 s timeout → today's path. Test in Task 5.
2. A 9:16 4K video added to a post that already has media (carousel) must NOT be offered the resize (ratio is also invalid). Test in Task 1 (`oversizeOnly`) and Task 5.
3. Mixed batch (image + passing video + 4K video): the passing files upload immediately in selection `sort_order`, the 4K one keeps its own index. Test in Task 5.
4. A conversion that silently drops audio must not be accepted: any discarded track → fallback. Test in Task 2 (`assertUsableConversion`).
5. Output overshooting `maxBytes` or still failing `validateMedia` → error, original untouched, upload falls back to the original. Test in Task 2 (post-check) and Task 5.

---

## Waves

- **Wave 1:** Task 1 (foundation; everyone consumes it).
- **Wave 2 (parallel lanes):** Task 2 (engine), Task 3 (offer dialog), Task 4 (warning-box progress dialog). Disjoint files.
- **Wave 3:** Task 5 (gallery integration; owns `PostMediaGallery.tsx` and its tests).
- **Wave 4 (controller):** Task 6 browser verification + full gates.

### Task 1: Planning, eligibility, copy, analytics event

**Files:**
- Create: `apps/crm/src/pages/entregas/media-editor/downscalePlan.ts`
- Create: `apps/crm/src/pages/entregas/media-editor/oversize.ts`
- Modify: `apps/crm/src/pages/entregas/media-editor/geometry.ts` (add `scaleVideoArguments`, leave `videoArguments` as is)
- Modify: `apps/crm/src/lib/analytics.ts` (add `'video_downscaled'` to `AnalyticsEvent`)
- Modify: `packages/i18n/locales/pt/posts.json`, `packages/i18n/locales/en/posts.json`
- Test: `apps/crm/src/pages/entregas/media-editor/__tests__/downscalePlan.test.ts`, `.../__tests__/oversize.test.ts`, `.../__tests__/scaleVideoArguments.test.ts`

**Interfaces (Produces):**
```ts
// downscalePlan.ts
export const DOWNSCALE_SHORT_SIDE = 1080;
export const FFMPEG_FALLBACK_MAX_INPUT_BYTES = 500 * 1024 * 1024;
export const FFMPEG_FALLBACK_MAX_INPUT_BYTES_IOS = 200 * 1024 * 1024;
export interface DownscaleSource { width: number; height: number; sizeBytes: number; durationSeconds: number }
export interface DownscalePlan {
  width: number; height: number;      // even, display space
  resized: boolean;                   // false = size-only re-encode
  bitrate: number;                    // bps
  maxBytes: number; durationSeconds: number;
}
export function planDownscale(src: DownscaleSource, opts: { maxBytes: number }): DownscalePlan | null; // null = budget < 100 kbps
export function downscaledFilename(name: string, plan: DownscalePlan): string; // "<base> (1080p).mp4" | "<base> (otimizado).mp4"
export function ffmpegFallbackMaxBytes(userAgent: string): number; // iPhone|iPad|iPod or Macintosh+touch → IOS value
// oversize.ts
export type OversizeReason = 'width' | 'size';
export function videoMaxBytes(forStories: boolean): number;
export function oversizeOnly(m: PostMediaLike, opts: { forStories?: boolean; isCarousel?: boolean }):
  { eligible: boolean; reasons: OversizeReason[] };
// geometry.ts
export function scaleVideoArguments(plan: DownscalePlan): string[];
```
i18n keys (pt values exact; en equivalents): `mediaGallery.downscale.reasonWidth` "Largura acima de 1920 px (ex.: 4K). O Instagram não aceita.", `reasonSize` "Acima de 300 MB (100 MB nos Stories).", `offerTitle_one` "Vídeo acima do limite do Instagram", `offerTitle_other` "{{count}} vídeos acima do limite do Instagram", `offerReduce` "Reduzir e enviar", `offerOriginal` "Enviar original", `slowEngine` "Neste navegador a conversão é mais lenta.", `unsupported` "Este navegador não consegue reduzir um vídeo desse tamanho. Exporte em 1080p no celular ou use o Chrome.", `overClientCap` "Arquivo acima de 2 GB: só pode ser enviado reduzido.", `hdr` "Vídeo em HDR: as cores podem mudar um pouco.", `converting` "Convertendo… {{pct}}%", `convertFailed` "{{name}}: não foi possível reduzir o vídeo. Enviamos o original.", `convertFailedNoFallback` "{{name}}: não foi possível reduzir o vídeo.", `action` "Reduzir resolução", `dialogTitle` "Reduzindo resolução", `stageDownload` "Baixando…", `stageConvert` "Convertendo…", `stageSave` "Salvando…", `done` "Vídeo reduzido para {{w}}×{{h}}.", `replaceOrphan` "Não foi possível substituir a mídia. A versão reduzida ficou em Arquivos.", `cancel` "Cancelar".

- [ ] **Step 1: Write failing tests**

`downscalePlan.test.ts`:
```ts
it.each([
  [2160, 3840, 1080, 1920, true], [3840, 2160, 1920, 1080, true],
  [2400, 2400, 1080, 1080, true], [2560, 1440, 1920, 1080, true],
  [1921, 1081, 1918, 1080, true], [4000, 1000, 1920, 480, true], [1080, 1920, 1080, 1920, false],
])('plans %ix%i → %ix%i', (w, h, ow, oh, resized) => {
  const p = planDownscale({ width: w, height: h, sizeBytes: 1, durationSeconds: 30 }, { maxBytes: 300 * 2 ** 20 })!;
  expect([p.width, p.height, p.resized]).toEqual([ow, oh, resized]);
  expect(p.width % 2 + p.height % 2).toBe(0);
});
it('caps bitrate at 8 Mbps and budgets long videos', () => {
  expect(planDownscale({ width: 2160, height: 3840, sizeBytes: 1, durationSeconds: 30 }, { maxBytes: 300 * 2 ** 20 })!.bitrate).toBe(8_000_000);
  expect(planDownscale({ width: 2160, height: 3840, sizeBytes: 1, durationSeconds: 600 }, { maxBytes: 300 * 2 ** 20 })!.bitrate)
    .toBe(Math.floor((300 * 2 ** 20 * 8 * 0.88) / 600 - 128_000));
});
it('returns null when the budget is under 100 kbps', () => {
  expect(planDownscale({ width: 2160, height: 3840, sizeBytes: 1, durationSeconds: 900 }, { maxBytes: 10 * 2 ** 20 })).toBeNull();
});
it('names outputs', () => { /* "Clip.MOV" + resized → "Clip (1080p).mp4"; size-only → "Clip (otimizado).mp4" */ });
it('picks the iOS ceiling for iPhone/iPad UAs', () => { /* iPhone UA → 200 MB; Mac Chrome UA → 500 MB */ });
```
`oversize.test.ts` (fixtures as `PostMediaLike`, mp4, 30 s):
- 2160×3840 50 MB, single → `{ eligible: true, reasons: ['width'] }`
- 2160×3840 400 MB → `reasons: ['width','size']`, eligible
- 1080×1920 400 MB → `['size']`, eligible; same with `forStories` and 150 MB → eligible (100 MB limit)
- 2160×3840 50 MB with `isCarousel: true` → `eligible: false` (ratio also invalid)
- 2160×3840 with duration 2 s → `eligible: false`
- 1080×1920 50 MB → `{ eligible: false, reasons: [] }`; an image → `eligible: false`

`scaleVideoArguments.test.ts`: for the 2160×3840/30 s plan, args include `scale=1080:1920:force_divisible_by=2`, `-pix_fmt yuv420p`, `-b:v 8000000`, `-c:a aac`, `-movflags +faststart`, output `output.mp4`; args do **not** include `-r`, `crop`, `pad`, `boxblur`.

- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/media-editor` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules. `oversizeOnly` classifies `validateMedia([m], opts)` errors: the width message (`'Vídeo excede a largura máxima de 1920 pixels'`) and the size message (starts with `'Vídeo excede '` and ends with `'MB (limite do Instagram)'`) are oversize reasons; any other error → ineligible. `scaleVideoArguments` mirrors `videoArguments`' bitrate/maxrate/bufsize/`-preset ultrafast`/`-c:v libx264`/`-map 0:a:0?` flags, with a `-vf` scale instead of `-filter_complex`. Add the analytics union member and the i18n keys (both locales).
- [ ] **Step 4: Run** the same vitest command plus `npx vitest run apps/crm/src/pages/entregas/__tests__/instagramLimits.test.ts` and `npx tsc -p apps/crm/tsconfig.json --noEmit` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(media): plan and eligibility for oversized-video downscale`.

### Task 2: Engine (Mediabunny + scale-only ffmpeg fallback)

**Files:**
- Modify: `package.json`, `package-lock.json` (`"mediabunny": "1.61.4"`)
- Create: `apps/crm/src/pages/entregas/media-editor/mediabunnyOptions.ts` (pure)
- Create: `apps/crm/src/pages/entregas/media-editor/downscaleVideo.ts` (browser shell)
- Modify: `apps/crm/src/pages/entregas/media-editor/exportVideo.ts` (add sibling `runFfmpegScale`; `exportVideo` signature unchanged)
- Test: `.../media-editor/__tests__/mediabunnyOptions.test.ts`, `.../__tests__/downscaleVideo.test.ts`
- If needed for the coverage floor: add `downscaleVideo.ts` to the exclude list in `vitest.coverage.config.ts` with a comment ("browser-only WebCodecs shell, verified in the browser").

**Interfaces:**
- Consumes: `DownscalePlan`, `downscaledFilename`, `ffmpegFallbackMaxBytes`, `scaleVideoArguments` (Task 1); `probeVideo` (`@/services/postMedia`); `validateMedia` (`../instagramLimits`).
- Produces:
```ts
// mediabunnyOptions.ts
export function buildConversionOptions(plan: DownscalePlan): { video: object; audio: object };
export function assertUsableConversion(c: { isValid: boolean; discardedTracks: readonly unknown[] }): void; // throws EngineUnavailable
export class EngineUnavailable extends Error {}
// downscaleVideo.ts
export type DownscaleEngine = 'webcodecs' | 'ffmpeg';
export type DownscaleSupport = { engine: DownscaleEngine | 'none'; hdr: boolean };
export function inspectForDownscale(file: File, plan: DownscalePlan): Promise<DownscaleSupport>;
export function downscaleVideo(file: File, plan: DownscalePlan, opts: {
  forStories: boolean; signal: AbortSignal; onProgress: (pct: number) => void;
}): Promise<{ file: File; engine: DownscaleEngine; hdr: boolean; width: number; height: number }>;
// exportVideo.ts
export function runFfmpegScale(file: File, args: string[], maxBytes: number, signal: AbortSignal,
  onProgress: (pct: number) => void, outputName: string): Promise<File>;
```

- [ ] **Step 1: Install** `npm install --save-exact mediabunny@1.61.4`; confirm `node_modules/mediabunny/package.json` version and read its `.d.ts` for `ConversionVideoOptions` (`quality`, `fit`, `allowTransformationMetadata`), `ConversionAudioOptions`, `canEncodeVideo`, `Conversion.init/isValid/discardedTracks/onProgress/cancel`, `ConversionCanceledError`, `InputVideoTrack.hasHighDynamicRange`. Use the real type names in `buildConversionOptions`' return type.
- [ ] **Step 2: Write failing tests**
  - `mediabunnyOptions.test.ts`: for the 2160×3840 plan, `video` has `codec: 'avc'`, `width: 1080`, `fit: 'fill'`, `allowTransformationMetadata: false`, a `quality` carrying `bitrate: 8_000_000`, and **no** `bitrate` key; `audio` equals `{ codec: 'aac' }` (no bitrate/quality). `assertUsableConversion({ isValid: true, discardedTracks: [{}] })` throws `EngineUnavailable`; `{ isValid: false, discardedTracks: [] }` throws; `{ true, [] }` doesn't.
  - `downscaleVideo.test.ts` (mock `mediabunny`, `./exportVideo`, `@/services/postMedia`): (a) webcodecs happy path returns `engine: 'webcodecs'`, named `"<base> (1080p).mp4"`, `type: 'video/mp4'`; (b) discarded audio track → calls `runFfmpegScale` with `scaleVideoArguments(plan)` and returns `engine: 'ffmpeg'`; (c) no WebCodecs and `file.size` above `ffmpegFallbackMaxBytes` → rejects with `EngineUnavailable`; (d) output larger than `plan.maxBytes` → rejects (post-check); (e) probed output still violating `validateMedia` → rejects; (f) abort → `conversion.cancel()` called and the promise rejects with the abort reason; (h) `hasHighDynamicRange` rejecting → `hdr: false`, conversion still succeeds; (g) `inspectForDownscale` returns `{ engine: 'webcodecs', hdr }` when `canEncodeVideo` resolves true, `'ffmpeg'` when false and size ≤ ceiling, `'none'` otherwise.
- [ ] **Step 3: Run** `npx vitest run apps/crm/src/pages/entregas/media-editor` — Expected: new tests FAIL.
- [ ] **Step 4: Implement.** `runFfmpegScale` reuses `exportVideo`'s load/write/exec/read/timeout/terminate structure (extract a private helper both call; `exportVideo`'s behaviour and `exportVideo.test.ts` stay green). `downscaleVideo`: WebCodecs when `typeof VideoEncoder !== 'undefined'` and `canEncodeVideo('avc', { width, height, bitrate })`; build `Input(BlobSource, ALL_FORMATS)` + `Output(Mp4OutputFormat, BufferTarget)`, `Conversion.init({ input, output, ...buildConversionOptions(plan) })`, `assertUsableConversion`, wire `onProgress` and abort → `cancel()`, `execute()`. Decide ffmpeg eligibility (`file.size ≤ ffmpegFallbackMaxBytes(navigator.userAgent)`) up front against the original. On `EngineUnavailable` or a non-abort engine error: release the attempt (`cancel()` if running, drop `Input`/`Output`/`BufferTarget` refs), then fall back to ffmpeg if eligible, else rethrow `EngineUnavailable`. `hdr` = `await track.hasHighDynamicRange()` with rejection → `false`, never failing the run. Then post-check (`size ≤ maxBytes`, `probeVideo` + `validateMedia([…], { forStories })`). Verify `@ffmpeg/core` 0.12.10's wasm max memory (the core references 2 GiB/4 GiB) and keep or lower the Task 1 ceilings; note the finding in the commit body.
- [ ] **Step 5: Run** vitest (media-editor + `exportVideo.test.ts`), `npx tsc -p apps/crm/tsconfig.json --noEmit` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(media): WebCodecs downscale engine with scale-only ffmpeg fallback`.

### Task 3: Offer dialog (upload time)

**Files:**
- Create: `apps/crm/src/pages/entregas/components/DownscaleOfferDialog.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/DownscaleOfferDialog.test.tsx`

**Interfaces:**
- Consumes: Task 1 types and i18n keys; `DownscaleSupport` type (import type only from `../media-editor/downscaleVideo`).
- Produces:
```ts
export interface DownscaleOfferItem {
  key: string; name: string; width: number; height: number; sizeBytes: number;
  plan: DownscalePlan | null; reasons: OversizeReason[];
  support: DownscaleSupport | null;  // null while inspecting
  overClientCap: boolean;            // > 2 GB
}
export function DownscaleOfferDialog(props: {
  open: boolean; items: DownscaleOfferItem[];
  onReduce: () => void; onSendOriginal: () => void; onDismiss: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Write failing tests:** title uses `offerTitle_one` / `offerTitle_other` by count; each row shows name, `"2160×3840 · 752 MB → 1080×1920"` (MB = `Math.round(bytes / 2**20)`), and the reason line(s); `slowEngine` line when any item's support engine is `'ffmpeg'`; `unsupported` line on an item with `'none'` or `plan === null`; `hdr` line when `support.hdr`; `overClientCap` line on such item; "Enviar original" disabled when **every** item is `overClientCap`; "Reduzir e enviar" disabled while any `support` is `null` or when no item is convertible; buttons call the right callbacks; Esc/X calls `onDismiss`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/components/__tests__/DownscaleOfferDialog.test.tsx` — FAIL.
- [ ] **Step 3: Implement** with `Dialog`/`DialogContent`/`DialogHeader`/`DialogFooter` from `@/components/ui/dialog` and `Button`; layout matches the mockups artifact (amber reason text uses `--danger-text`-free amber classes already used by the gallery warning box).
- [ ] **Step 4: Run** the test + `tsc` — PASS.
- [ ] **Step 5: Commit** `feat(media): offer dialog for oversized videos at upload`.

### Task 4: "Reduzir resolução" progress dialog (existing media)

**Files:**
- Create: `apps/crm/src/pages/entregas/components/DownscaleMediaDialog.tsx`
- Create: `apps/crm/src/pages/entregas/media-editor/fetchMediaFile.ts`
- Test: `apps/crm/src/pages/entregas/components/__tests__/DownscaleMediaDialog.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`planDownscale`, `videoMaxBytes`), Task 2 (`downscaleVideo` via `await import('../media-editor/downscaleVideo')`; mock in tests), `replacePostMedia` (`@/services/mediaAdjustment`), `encodeImageAsJpeg` (`@/utils/imageJpeg`), `extractVideoFrame` (`@mesaas/ui/video/frame`), `trackUnsavedWork`, `captureEvent`.
- Produces:
```ts
export function fetchMediaFile(url: string, name: string, mime: string, signal: AbortSignal,
  onProgress: (pct: number) => void): Promise<File>; // tee'd stream progress, as MediaAdjustmentDialog
export function DownscaleMediaDialog(props: {
  media: PostMedia | null; forStories: boolean;
  onOpenChange: (open: boolean) => void; onDone: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Write failing tests:** opening with a 2160×3840 media runs download → convert → `replacePostMedia(media, output, thumbnail, …, signal)` and shows `stageDownload`/`stageConvert`/`stageSave` in order, then toasts `done` with `1080×1920` and calls `onDone`; the thumbnail passed is `encodeImageAsJpeg(fetched thumbnail_url)`; when that fetch fails it is `extractVideoFrame(output)`; Cancel during convert aborts the signal and never calls `replacePostMedia`; Cancel is hidden during `stageSave` and `DialogContent` gets `confirmClose`; a `replacePostMedia` rejection shows the `replaceOrphan` error; the whole run is passed to `trackUnsavedWork`; `captureEvent('video_downscaled', expect.objectContaining({ source: 'warning', outcome: 'ok' }))`.
- [ ] **Step 2: Run** the test — FAIL.
- [ ] **Step 3: Implement.** Plan from `media.width/height/size_bytes/duration_seconds` with `videoMaxBytes(forStories)`.
- [ ] **Step 4: Run** test + `tsc` — PASS.
- [ ] **Step 5: Commit** `feat(media): reduce resolution of an existing oversized video`.

### Task 5: Gallery integration

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx` (`handleFiles` ~L364-455, warning box ~L725-755, phone menu `actionsFor` ~L815-835, upload-queue status type L218)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`, `.../PostMediaGallery.phone.test.tsx`

**Interfaces:** Consumes Tasks 1-4 exactly as declared. Upload queue status gains `'converting'` (row text `t('mediaGallery.downscale.converting', { pct })`).

- [ ] **Step 1: Update mocks:** add `probeVideo: vi.fn()` to the partial `services/postMedia` mock; mock `../../media-editor/downscaleVideo` (`inspectForDownscale`, `downscaleVideo`) and `../DownscaleMediaDialog` only where a test needs it.
- [ ] **Step 2: Write failing tests (grid):**
  - picking a 2160×3840 MP4 on an empty Reel post shows the offer dialog and does not call `uploadPostMedia` yet; "Reduzir e enviar" calls `downscaleVideo`, then `uploadPostMedia` with the converted file and `sortOrder: 0`;
  - mixed batch [image, 1080×1920 video, 2160×3840 video]: the first two upload immediately with `sortOrder` 0 and 1; the 4K one uploads after the decision with `sortOrder` 2;
  - "Enviar original" uploads the original file; dismissing uploads nothing for the held-back file;
  - `downscaleVideo` rejecting → `toast.error(convertFailed)` and the original is uploaded;
  - `probeVideo` never resolving → after the 10 s timeout (fake timers) the file uploads as today, no dialog;
  - 2160×3840 added to a post that already has one image (carousel) → no dialog;
  - `targetsInstagram={false}` → no dialog;
  - over-2 GB item with `support.engine === 'none'` → neither uploaded nor converted, error toast;
  - converted-file thumbnail extraction failing → the converted file lands in the manual-thumbnail flow (existing pending-video UI shows its name);
  - the `uploadDone` toast fires once after the held-back file finishes, not before;
  - warning box: an existing 2160×3840 media shows `reasonWidth` and a "Reduzir resolução" button (not "Ajustar proporção"); a 9:16 4K media in a carousel still shows "Ajustar proporção"; clicking "Reduzir resolução" opens `DownscaleMediaDialog` with that media.
- [ ] **Step 3: Phone test:** long-press menu on an oversized video has "Reduzir resolução"; the existing image-fixture assertions stay unchanged.
- [ ] **Step 4: Run** `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery` — FAIL.
- [ ] **Step 5: Implement.** In `handleFiles`: probe videos with `Promise.race([probeVideo(f), timeout(10_000)])` only when `targetsInstagram`; compute `isCarousel` from `media.length + files.length`; split eligible (`oversizeOnly(...).eligible`) from the rest; upload the rest via the existing path (keeping `base + i`); for the held-back set, build `DownscaleOfferItem`s, open the dialog, fill `support` via `inspectForDownscale` per item; on the decision process items one at a time inside `trackUnsavedWork` (convert → thumbnail → `uploadPostMedia`), per the rules: reduce → convertible converted, non-convertible ≤ 2 GB sent original, > 2 GB skipped with `convertFailedNoFallback`; original → ≤ 2 GB sent, > 2 GB skipped. Capture `video_downscaled` with `source: 'upload'`. Warning box/phone menu: `oversizeOnly(m, validationOpts).eligible` → "Reduzir resolução" (`Minimize2`) + reason copy; render `<DownscaleMediaDialog>`, `onDone` → `refreshWithCovers()`.
- [ ] **Step 6: Run** the gallery tests, `npx vitest run apps/crm/src/pages/entregas`, `npx tsc -p apps/crm/tsconfig.json --noEmit` — PASS.
- [ ] **Step 7: Commit** `feat(media): offer downscale for oversized videos in the post gallery`.

### Task 6: Browser verification and gates (controller)

- [ ] **Step 1: Fixtures** (Homebrew ffmpeg, into the scratchpad): `testsrc2` 2160×3840 30 fps 20 s H.264 + `sine` AAC; same at 25 fps; a 3840×2160 one tagged `-metadata:s:v:0 rotate=90`; an HEVC 2160×3840 (`libx265`, `-tag:v hvc1`).
- [ ] **Step 2:** Run the CRM dev server (`preview_start`), open a Reel post's media tab, upload each fixture: dialog appears with the right numbers; "Reduzir e enviar" finishes; `ffprobe` on the downloaded result shows 1080×1920 (1920×1080→ portrait for the rotated one per display), source fps, AAC audio, duration ±0.1 s, no rotation side-data. Log conversion time per fixture. Repeat "Reduzir resolução" on an already-uploaded 4K file.
- [ ] **Step 3: Gates:** `npm run lint`, `npm run format:check`, the four `tsc` (`apps/crm`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`, `npm run coverage:check`, `npm run check:functions`, `npm run test:functions`; then `git status` shows no `supabase/` or `deno.lock` change.
- [ ] **Step 4:** Note in the PR body what needs a manual Safari/iOS + real iPhone HDR clip check.
