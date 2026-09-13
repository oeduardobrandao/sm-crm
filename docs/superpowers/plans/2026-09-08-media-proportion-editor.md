# Media proportion editor implementation plan

**Goal:** Let users crop or fit uploaded images and videos for Instagram directly in the post gallery.

**Spec:** Approved UI and requirements in this task (2026-09-08): black primary buttons; feed presets 1:1, 4:5, 3:4, 1.91:1; Reel/Story preset 9:16; preserve originals. The user's successful 1080×1440 API test establishes the feed minimum of 3:4.

**Architecture:** Canvas renders images and the editor preview using shared crop geometry. A lazy, locally bundled single-thread ffmpeg.wasm worker renders MP4 video with audio, crop/fit, optional blurred background, and cancellation. Upload the result through existing file storage, then atomically replace the selected post link using an ownership-checked RPC with optimistic concurrency. Preserve the original file, cover flag, link ID, and carousel order.

**Tech stack:** React 19, Radix Dialog, Canvas 2D, ffmpeg.wasm, Supabase/Deno/PostgreSQL.

## Constraints

- Feed image ratio 3:4–1.91:1; JPEG/sRGB output ≤8 MB. Feed width 320–1440 is normalized by the platform.
- Reels ≤300 MB, 3–900 seconds, width ≤1920, ratio 0.01–10; Stories ≤100 MB, 3–60 seconds, ratio 0.1–10. 9:16 is a recommendation, not a mandatory ratio.
- Output video: MP4 faststart, H.264/yuv420p closed GOP, 30 FPS, AAC ≤48 kHz stereo, ≤128 kbps audio, ≤25 Mbps VBR video. Reject export if still over its size cap; never truncate duration.
- No external media processing service or CDN runtime. Load video processor only when needed. Abort on cancellation/unmount; bounded network and processing timeouts.
- Mutations are scoped by authenticated workspace. Preserve the original and references in other posts. Replacing published/scheduled/actively publishing media is forbidden; conflicting edits return 409.

## Tasks

- [x] 1. Update paired frontend/backend limits and regression suites. Test exact boundaries, 3:4 acceptance, landscape Reels, 900-second Reels, 100-MB Stories, and non-JPEG conversion requirements. Run both suites before and after changes.
- [x] 2. Implement crop geometry and export commands with tests: preset dimensions, extreme source ratios, panning bounds, no distortion, even output sizes, blur/solid fit, bitrate budgeting, cancellation and failed export.
- [x] 3. Add atomic link replacement RPC and PATCH action. Test tenant rejection, invalid IDs, stale source conflicts, generic server errors, original retention, cover/order/reference counts. Reuse existing upload service and verify new file before swapping.
- [x] 4. Add responsive dialog and gallery warning/actions. Match approved design; keyboard/pointer repositioning, zoom/reset, crop/fit, background choice, video playback, output size, progress/cancel/retry. Feed errors identify files; portrait suggestions stay nonblocking. Pass post type/eligibility from editor body.
- [x] 5. Verify UI in browser, real image/video exports, new service/dialog integration tests, all four typechecks, Vitest, Deno, lint, format check, production build, migration version uniqueness. Review the final diff for tenant isolation and failed-save behavior.

## Deployment and rollback

Deploy the migration first, then post-media-manage and tiktok-publish. Redeploy the functions bundling the shared Instagram validation (including instagram-publish and the publishing cron handlers), then deploy the CRM. Existing clients remain compatible. To roll back, revert the CRM/handler and drop only the new RPC. Keep the reference-count update trigger so any existing updated links continue to count correctly. Adjusted and original files remain intact.

## Verification completed — 2026-09-09

- All four CI TypeScript projects passed; CRM production build passed.
- Vitest: 535 files, 5,521 tests passed. Deno: typecheck and 2,870 tests passed, using `--node-modules-dir=none` to keep Deno dependency resolution separate from npm's locked frontend dependencies.
- ESLint: zero errors (84 existing warnings); Prettier passed; `git diff --check` and migration version uniqueness passed.
- The rollback-only database regression suite passed on local PostgreSQL, covering ownership, stale source conflicts, reference counts, cover/order preservation, and published/in-flight guards.
- Real browser checks: JPEG 1080×1440 export, MP4 1080×1920 export with audio, processing cancellation, and a 390-pixel mobile viewport without horizontal overflow.
- The actual bundled WASM encoder passed five smoke cases: crop with audio, extreme crop, blurred fit, extreme blurred fit, and solid fit without audio. Outputs retained duration and met codec, pixel format, frame rate, and MP4 container requirements. Reproduce with `node --import tsx scripts/verify-media-export.mjs`.
- Final scoped review found no outstanding substantive issues. Upload cancellation/timeouts, uncertain-save cache reconciliation, post-claim TikTok media validation, and crop-before-scale memory behavior were reviewed.

The feature was rebased onto current main before opening the PR. The migration is `20260916000001_post_file_link_replace.sql`; its former version was already used on main. Implementation has not been deployed. Video processing runs in the browser; long or high-resolution sources can take substantial time and may exceed device resources. The UI reports failures and permits retry without replacing the source.
