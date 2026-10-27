# Reduce oversized videos for Instagram on upload — design

Status: reviewed (Codex + Fable) · 2026-10-26 · Frontend only (CRM). No migrations, no edge
functions, nothing under `supabase/` changes.

## Problem

Instagram's Content Publishing API rejects videos wider than 1920 px. Our preflight
(`apps/crm/src/pages/entregas/instagramLimits.ts`, mirrored server-side in
`supabase/functions/_shared/instagram-limits.ts`) enforces it with
`VIDEO_MAX_WIDTH = 1920` and blocks scheduling/publishing.

Modern phones record 4K by default. Pass Digital (prod, 2026-10-13 → 10-26): 20 of 26
uploaded videos are 4K (19 × 2160×3840, 1 × 3840×2160), every one with a correct ratio.
All 20 are blocked by the width rule and 9 also exceed 300 MB. The error sits in the amber
"precisa de ajuste" box next to an **"Ajustar proporção"** button, so users read it as a
proportion problem, and the button doesn't fit the fix (it forces a framing choice).

## Goals

1. When a user adds a video that Instagram would reject only for **width** (> 1920 px)
   and/or **file size** (> 300 MB feed/Reels, > 100 MB Stories), offer at file selection to
   convert it to a compliant size, keeping the aspect ratio, before the upload.
2. For such a video already on a post, offer the same one-click conversion from the warning
   box (replaces the post's media via the existing replace flow).
3. Fast and cheap: hardware-accelerated in the browser (WebCodecs), no server cost.
4. Copy that names the real problem (resolution / size), not proportion.

## Non-goals

- Server-side transcoding.
- Arquivos library uploader (`FileUploader.tsx`), Hub uploads, report editor. A library
  file attached to a post is handled by goal 2.
- TikTok-only posts (`targetsInstagram === false`): no offer.
- Images (Instagram normalises image width; not a blocking rule).
- Duration, format (MIME) or aspect-ratio violations: still the existing flows.
- Changing `validateMedia` or its messages (parity test with `_shared`).
- Orphan cleanup for a failed replace (same behaviour as the proportion editor today).

## Target size and budget (pure, `media-editor/downscalePlan.ts`)

`planDownscale({ width, height, sizeBytes, durationSeconds }, { maxBytes })`:

- Resize when `width > 1920` (display dimensions, as `probeVideo` stores; `videoWidth/Height`
  already honour rotation).
- Target: scale so the **short side is 1080**, clamp so `width ≤ 1920`, never upscale, round
  each side to an even number.
  - 2160×3840 → 1080×1920 · 3840×2160 → 1920×1080 · 2400×2400 → 1080×1080
  - ≤ 1920 wide but over `maxBytes`: keep dimensions, re-encode only.
- Bitrate target: `min(8 Mbps, maxBytes × 8 × 0.88 / duration − 128 kbps)`; if under
  100 kbps → not convertible ("Vídeo longo demais para caber no limite"). This is a target,
  not a guarantee: the output size is checked after encoding.
- `maxBytes` = 300 MB, 100 MB for Stories.

Also pure and unit-tested: `buildMediabunnyOptions(plan)` and `scaleVideoArguments(plan)`.
The browser-only engine shell stays thin (excluded from coverage if needed, see
`vitest.coverage.config.ts` floor).

## Eligibility (pure, `media-editor/oversize.ts`)

`oversizeOnly(media, opts)` → `{ eligible: boolean; reasons: ('width' | 'size')[] }`, built on
`validateMedia` + the limit constants. Eligible when the item has at least one width/size
violation and **no other** violation under the post's options. Used by both A and B.

## Engine (`media-editor/downscaleVideo.ts`, lazy-imported)

```ts
downscaleVideo(file: File, plan: DownscalePlan, opts: {
  signal: AbortSignal; onProgress: (pct: number) => void;
}): Promise<{ file: File; engine: 'webcodecs' | 'ffmpeg'; hdr: boolean }>
```

1. **WebCodecs via Mediabunny** — `mediabunny` pinned exact at `1.61.4` (MPL-2.0; ≥ 14 days
   old). Lazy `import()` inside the function, so the SSR prerender never loads it.
   - `Input({ source: new BlobSource(file), formats: ALL_FORMATS })` (chunked reads),
     `Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })` (BufferTarget
     already defaults to fast-start).
   - `video: { codec: 'avc', width, fit: 'fill', quality: { bitrate, bitrateMode: 'variable' },
     allowTransformationMetadata: false }`. Only `width` is passed and height derives (or both
     with `fit: 'fill'`), so no 1-px letterbox. `allowTransformationMetadata: false` bakes
     rotation into the pixels (the default keeps a rotation flag that some players ignore).
     Mediabunny's width/height are in display space, consistent with our probe.
     `bitrate` on the video options is deprecated; never combine it with `quality`.
   - `audio: { codec: 'aac' }` with **no** bitrate/quality, so AAC is copied and only non-AAC
     audio is transcoded.
   - Preconditions: `canEncodeVideo('avc', { width, height, bitrate })` is true,
     `conversion.isValid`, and **`discardedTracks.length === 0`** (a discarded audio track
     leaves the conversion valid but silent; Firefox and iOS < 17.4 have no AAC encoder).
     Any failure → fall through to ffmpeg.
   - Cancel: `signal` abort → `conversion.cancel()`; `ConversionCanceledError` maps to the
     abort path. `conversion.onProgress = (p) => onProgress(round(p × 100))` before `execute()`.
   - `hdr` from `InputVideoTrack.hasHighDynamicRange()` (analytics + dialog note).
2. **Fallback: ffmpeg.wasm** — a sibling `runFfmpegScale(file, args, …)` next to
   `exportVideo` (its 8-arg signature and `exportVideo.test.ts` stay untouched), with
   `scaleVideoArguments(plan)`: `scale=W:H:force_divisible_by=2`, `-pix_fmt yuv420p`, no
   crop/pad/blur, **no `-r`** (source frame rate kept; the editor's `videoArguments` keeps its
   `-r 30`), same bitrate flags, `-c:a aac`, `-movflags +faststart`. ffmpeg autorotates.
   - Memory: input (`arrayBuffer` + wasm FS ≈ 2× input) plus output are in memory, so the
     fallback is only offered up to `FFMPEG_FALLBACK_MAX_INPUT_BYTES` — start at 500 MB on
     desktop and 200 MB on iOS/iPadOS; the plan verifies `@ffmpeg/core` 0.12.10's memory cap
     and adjusts before shipping.

Post-check (both engines, the real guarantee): `output.size ≤ maxBytes`, then `probeVideo` +
`validateMedia` on the output. Any violation → error, original untouched.

Output: `video/mp4`, H.264 + AAC, `<base> (1080p).mp4` (or `<base> (otimizado).mp4` when the
dimensions were kept).

Unsaved work: download + convert + upload/replace are wrapped in `trackUnsavedWork` (CLAUDE.md
"Deploys trocam de versão em silêncio"); this also closes the gap where the proportion editor
only wraps `uploadFile`.

## UX

Copy for the width reason everywhere: **"Largura acima de 1920 px (ex.: 4K). O Instagram não
aceita."** Size reason: **"Acima de 300 MB (100 MB nos Stories)."**

### A. At file selection (`PostMediaGallery.handleFiles`, grid and phone variants)

- Only when `targetsInstagram`. Probe each selected video with `probeVideo` raced against a
  timeout (10 s). Reject/timeout → treat as "not oversized" (today's path). This keeps
  existing jsdom tests from hanging and covers browsers that can't decode the codec (an HEVC
  file Chrome can't read is not offered; it uploads as today).
- Eligibility uses the options the post will have after this batch (`forStories`,
  `isCarousel = !forStories && existing + selected > 1`). Only `oversizeOnly(...).eligible`
  files are held back; everything else uploads immediately as today. A 9:16 video going into
  a carousel (including a Reel + cover picked together) is not offered here; after upload the
  warning box handles it ("Ajustar proporção" outputs 1080-wide presets, fixing width too).
- One dialog for the held-back files (`Dialog`, `confirmClose` while converting):
  - Title: "Vídeo acima do limite do Instagram" / "N vídeos acima do limite do Instagram".
  - Per file: name, "2160×3840 · 752 MB → 1080×1920", the reason line(s), and an HDR note when
    detected ("Vídeo em HDR: as cores podem mudar um pouco").
  - Primary **"Reduzir e enviar"**. Secondary **"Enviar original"**.
  - Engine availability is checked when the dialog opens. No WebCodecs: "Neste navegador a
    conversão é mais lenta." Over the ffmpeg ceiling too: that file shows "Este navegador não
    consegue reduzir um vídeo desse tamanho. Exporte em 1080p no celular ou use o Chrome." and
    is not converted.
  - A file over the 2 GB client cap (`validateFile`): "Enviar original" is not available for it
    ("Arquivo acima de 2 GB"); only reducing (when possible) or skipping.
  - Closing the dialog skips the held-back files (not uploaded).
- On "Reduzir e enviar": queue rows show **"Convertendo… N%"**, then upload progress. One
  conversion at a time; uploads keep today's concurrency. `sort_order` = `base + i` from the
  original selection index. The `uploadDone` toast and the `uploading` flag account for the
  held-back subset like the existing `deferredCount` pattern.
- Thumbnail: extracted from the converted file; on failure, the converted file enters the
  existing `pendingVideos` manual-thumbnail queue.
- Conversion error for a file: toast "`<nome>`: não foi possível reduzir o vídeo. Enviamos o
  original." and upload the original (unless it is over 2 GB: then the error only).

### B. Existing oversized video (warning box)

- For an item where `oversizeOnly(...).eligible`, the button is **"Reduzir resolução"**
  (icon `Minimize2`) and the reason uses the copy above instead of the raw message. Other items
  keep "Ajustar proporção". Same action in the phone strip's long-press menu.
- Click → small progress dialog: download (fetch with progress, as `MediaAdjustmentDialog`),
  convert, upload + `replacePostMedia`.
- Thumbnail: keep the current cover. Fetch `media.thumbnail_url` → `encodeImageAsJpeg` (as
  `handleUseAsReelCover` does) and pass it to `replacePostMedia`; only if that fails, extract a
  frame from the converted file.
- Cancellation and orphans follow `MediaAdjustmentDialog`: Cancel works during download and
  conversion; from the upload on the stage is "Salvando…" and cannot be cancelled. If the
  replace is rejected, the uploaded copy stays as an unlinked file in Arquivos (raiz), as with
  a failed proportion adjustment today, and the error says so.
- Disabled where `canAdjust` is false.

## Analytics

`captureEvent('video_downscaled', { engine, source: 'upload' | 'warning', input_w, input_h,
output_w, output_h, input_mb, output_mb, duration_s, hdr, ms, outcome: 'ok' | 'error' |
'cancelled' | 'unsupported' })`. Add `'video_downscaled'` to the `AnalyticsEvent` union in
`apps/crm/src/lib/analytics.ts`.

## Testing

- Unit (Vitest): `planDownscale` table (incl. odd sizes, no upscale, size-only, budget under
  100 kbps); `buildMediabunnyOptions` (no `bitrate`, `allowTransformationMetadata: false`,
  audio without bitrate); `scaleVideoArguments` (no `-r`, `yuv420p`, `force_divisible_by`);
  `oversizeOnly` (width, size, both, + carousel ratio → ineligible, stories limits).
- Gallery (converter and `probeVideo` mocked; add `probeVideo: vi.fn()` to the partial
  `services/postMedia` mock in `PostMediaGallery.test.tsx`): dialog only for eligible files;
  passing files upload without waiting; "Enviar original" unchanged; conversion error uploads
  the original; closing skips only held-back files; TikTok-only skips; probe timeout → today's
  path; sort order; warning-box button choice; phone menu entry.
- Browser (real Chrome, Browser pane): generated 2160×3840 30 fps H.264+AAC clip, a 25 fps
  one, a rotated one (rotation flag) and an HEVC one → 1080×1920, plays, audio present, frame
  rate and duration kept, no rotation flag in output, timing logged. Safari/iOS by hand
  before announcing (no Capacitor code to check here).
- Gates: four `tsc`, lint, format, vitest (+ coverage floor), `check:functions`,
  `test:functions`.

## Risks

- **HDR (iPhone Dolby Vision / HLG 10-bit HEVC)**: neither engine tone-maps; colours may shift.
  Browser-test with a real iPhone HDR clip; the dialog warns.
- **HEVC decode** on Chrome/Windows without hardware support: the probe fails → not offered.
- **iOS Safari audio**: AAC encode only from 17.4; non-AAC audio on older iOS → ffmpeg fallback.
- **Encoder overshoot**: handled by the post-check.
- Bundle: Mediabunny lazy-loaded only when a conversion runs.

## Rollout

Frontend-only, ships with the Vercel deploy. No flag: the dialog only appears for files that
are blocked today, and "Enviar original" keeps the current behaviour.
