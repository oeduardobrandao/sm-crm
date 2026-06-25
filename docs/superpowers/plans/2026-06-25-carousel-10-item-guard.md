# Carousel 10-Item Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop posts with more than 10 media items from being scheduled/published to Instagram (the Graph API carousel cap), with a clear message, while leaving uploads unrestricted.

**Architecture:** Two enforcement layers plus a composer hint. (1) A hard backstop in `createContainerForPost` — the one function every publish path (schedule front-load, publish-now, cron, retry-requeue) hits — throws before any Graph call. (2) An early UX block in `validateForScheduling` so the user gets an immediate friendly 422 at Agendar/Publicar. (3) A non-blocking warning banner in the shared `PostMediaGallery` composer component.

**Tech Stack:** Deno edge functions (TypeScript), React 19 + TanStack Query + react-i18next (Vite), Vitest (frontend), Deno test (edge).

## Global Constraints

- **Limit value:** `CAROUSEL_MAX_ITEMS = 10` — exact. Defined once on the server (`supabase/functions/_shared/instagram-publish-utils.ts`, exported) and once on the frontend (`PostMediaGallery.tsx`, local, with a cross-reference comment — the Vite app cannot import Deno `_shared` code).
- **Server message (verbatim, used in both server spots):** `Carrossel do Instagram aceita no máximo 10 itens (este post tem ${n}). Reduza para 10 ou menos. O app do Instagram permite 20, mas a publicação via API é limitada a 10.` (`${n}` = actual count.)
- **Uploads stay unrestricted:** do NOT touch `maxFiles`/`atLimit`. The banner is informational only.
- **No linter/formatter.** Typecheck the frontend with `npm run build` (`tsc` + `vite build`).
- **node_modules / deno.lock gotcha:** `npm run test:functions` (Deno, `--node-modules-dir=auto`) mutates `node_modules` and `deno.lock` and will break a later `npm run build`. Therefore: do the frontend task (Task 1: `npm run test` + `npm run build`) **first** while the JS env is clean; run Deno tests (Tasks 2–3) after; and in Task 4 restore with `git checkout deno.lock && npm ci` **before** the final `npm run build`. Never `git add deno.lock` in a commit.
- **Worktree:** `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/feat+carousel-10-item-guard` (branch `worktree-feat+carousel-10-item-guard`, off `main`). Run all commands there.
- **Commit trailers:** end every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GqUAFpMCz63pVaV7KMk1Y4
  ```

---

### Task 1: Composer warning banner (frontend, shared component)

Runs first, in a clean JS env (before any Deno test pollutes node_modules).

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`
- Modify: `packages/i18n/locales/pt/posts.json:67`
- Modify: `packages/i18n/locales/en/posts.json:67`
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`

**Interfaces:**
- Consumes: `listPostMedia(postId)` (already mocked in the test), `PostMedia` type from `apps/crm/src/store`.
- Produces: a banner that renders when the gallery's `media.length > 10`, keyed on i18n `mediaGallery.carouselLimit` / `mediaGallery.carouselLimitDesc`. No exported symbols.

- [ ] **Step 1: Write the failing test**

Append to `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`. Add the import for `listPostMedia` and `PostMedia` near the existing imports (the module mock already replaces `listPostMedia` with a `vi.fn`):

```tsx
import { listPostMedia } from '../../../../services/postMedia';
import type { PostMedia } from '../../../../store';

function makeMedia(n: number): PostMedia[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    post_id: 1,
    conta_id: 'c',
    r2_key: `img/${i}.jpg`,
    thumbnail_r2_key: null,
    kind: 'image' as const,
    mime_type: 'image/jpeg',
    size_bytes: 1000,
    original_filename: `img${i}.jpg`,
    width: 1080,
    height: 1080,
    duration_seconds: null,
    is_cover: i === 0,
    sort_order: i,
    uploaded_by: null,
    created_at: '2026-01-01T00:00:00Z',
    url: `https://example.test/img/${i}.jpg`,
  }));
}

describe('carousel 10-item warning', () => {
  it('shows the warning when there are 11 media items', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(makeMedia(11));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={1} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Carrossel acima do limite/i)).toBeInTheDocument();
  });

  it('does not show the warning at exactly 10 media items', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(makeMedia(10));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={1} />
      </QueryClientProvider>,
    );
    await screen.findByText('Adicionar'); // wait for the query to resolve
    expect(screen.queryByText(/Carrossel acima do limite/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- --run PostMediaGallery`
Expected: the two new tests FAIL (no element matching `/Carrossel acima do limite/i`); existing tests still pass.

- [ ] **Step 3: Add the i18n keys**

In `packages/i18n/locales/pt/posts.json`, change line 67 from:

```json
    "remainingVideos": "{{count}} vídeo(s) aguardando miniatura"
```

to:

```json
    "remainingVideos": "{{count}} vídeo(s) aguardando miniatura",
    "carouselLimit": "Carrossel acima do limite do Instagram",
    "carouselLimitDesc": "Carrosséis publicados via Instagram aceitam no máximo {{max}} itens (este post tem {{count}}). O app permite 20, mas a publicação automática é limitada a {{max}}."
```

In `packages/i18n/locales/en/posts.json`, change line 67 from:

```json
    "remainingVideos": "{{count}} video(s) awaiting a thumbnail"
```

to:

```json
    "remainingVideos": "{{count}} video(s) awaiting a thumbnail",
    "carouselLimit": "Carousel exceeds Instagram's limit",
    "carouselLimitDesc": "Carousels published via Instagram allow at most {{max}} items (this post has {{count}}). The app allows 20, but automatic publishing is limited to {{max}}."
```

- [ ] **Step 4: Add the constant and the banner to the component**

In `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`, add the constant just above the `export function PostMediaGallery` line (it currently follows the `PostMediaGalleryProps` interface, around line 51):

```tsx
// Mirror of CAROUSEL_MAX_ITEMS in
// supabase/functions/_shared/instagram-publish-utils.ts — keep in sync.
// Instagram's Content Publishing API caps carousels at 10 (the native app allows 20).
const CAROUSEL_MAX_ITEMS = 10;
```

Then add the banner as the first child of the outermost returned container. Change (around line 407–408):

```tsx
  return (
    <div className="space-y-3">
```

to:

```tsx
  return (
    <div className="space-y-3">
      {media.length > CAROUSEL_MAX_ITEMS && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200/60 px-3 py-2.5 text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[12.5px] font-semibold">{t('mediaGallery.carouselLimit')}</span>
            <span className="text-[12px] text-stone-600">
              {t('mediaGallery.carouselLimitDesc', { max: CAROUSEL_MAX_ITEMS, count: media.length })}
            </span>
          </div>
        </div>
      )}
```

(`AlertTriangle` and `t` are already imported/declared in this file — no new imports.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- --run PostMediaGallery`
Expected: all `PostMediaGallery` tests PASS, including the two new ones.

- [ ] **Step 6: Typecheck (clean JS env, before any Deno run)**

Run: `npm run build`
Expected: `tsc` + `vite build` succeed with no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostMediaGallery.tsx \
        apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx \
        packages/i18n/locales/pt/posts.json \
        packages/i18n/locales/en/posts.json
git commit -m "$(cat <<'EOF'
feat(ig-publish): warn in composer when carousel exceeds 10 items

Non-blocking banner in the shared PostMediaGallery (used by the workflow
drawer and Post Express). Uploads stay unrestricted.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GqUAFpMCz63pVaV7KMk1Y4
EOF
)"
```

---

### Task 2: Backstop guard in `createContainerForPost` (server, the real enforcement)

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (constants block ~line 77; `createContainerForPost` ~line 371)
- Test: `supabase/functions/__tests__/instagram-publish-container_test.ts`

**Interfaces:**
- Consumes: existing `createContainerForPost(db, { igUserId, token, postId, caption, useCover })`.
- Produces: exported `CAROUSEL_MAX_ITEMS` constant; `createContainerForPost` now throws (before any `fetch`) when the post has more than `CAROUSEL_MAX_ITEMS` media.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/__tests__/instagram-publish-container_test.ts` (the file already defines `stubFetch`, `dbWithMedia`, and `base`):

```ts
Deno.test("createContainerForPost: >10 media → throws before any Graph call", async () => {
  const f = stubFetch();
  try {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      kind: "image",
      r2_key: `img/${i}.jpg`,
    }));
    const db = dbWithMedia(eleven);
    let threw = false;
    try {
      await createContainerForPost(db, { ...base, useCover: false });
    } catch (e) {
      threw = true;
      assert(
        String((e as Error).message).includes("máximo 10"),
        "error should mention the 10-item carousel cap",
      );
    }
    assert(threw, "must throw when the post has more than 10 media");
    assertEquals(f.calls.length, 0); // no child/parent container call was made
  } finally {
    f.restore();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/instagram-publish-container_test.ts`
Expected: the new test FAILS — currently 11 media produces 12 fetch calls (11 children + 1 parent), so `threw` is false / `f.calls.length` is 12. Existing tests in the file still pass.

- [ ] **Step 3: Add the constant**

In `supabase/functions/_shared/instagram-publish-utils.ts`, after the existing limit constants (the block ending at `const VIDEO_MAX_DURATION = 90;`, ~line 77), add:

```ts
/** Instagram Content Publishing API caps carousels at 10 items.
 *  (The native app allows 20, but the Graph API does not.) */
export const CAROUSEL_MAX_ITEMS = 10;
```

- [ ] **Step 4: Add the backstop guard**

In `createContainerForPost`, immediately after the existing no-media guard:

```ts
  const media = await fetchPostMedia(db, postId);
  if (media.length === 0) throw new Error("No media files found");
```

insert:

```ts
  if (media.length > CAROUSEL_MAX_ITEMS) {
    throw new Error(
      `Carrossel do Instagram aceita no máximo ${CAROUSEL_MAX_ITEMS} itens ` +
        `(este post tem ${media.length}). Reduza para ${CAROUSEL_MAX_ITEMS} ou menos. ` +
        `O app do Instagram permite 20, mas a publicação via API é limitada a ${CAROUSEL_MAX_ITEMS}.`,
    );
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/instagram-publish-container_test.ts`
Expected: all tests in the file PASS, including the new one (throws, `f.calls.length === 0`).

- [ ] **Step 6: Commit** (do NOT add `deno.lock`)

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts \
        supabase/functions/__tests__/instagram-publish-container_test.ts
git commit -m "$(cat <<'EOF'
feat(ig-publish): backstop carousel >10 in createContainerForPost

Throws before any Graph call, so retry-requeued and pre-deploy
agendado rows (which bypass validateForScheduling) cannot reach Meta.
Surfaces as publish_error -> falha_publicacao.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GqUAFpMCz63pVaV7KMk1Y4
EOF
)"
```

---

### Task 3: Early UX block in `validateForScheduling` (server, immediate 422)

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (`validateForScheduling`, the media-count branch ~line 168)
- Test: `supabase/functions/__tests__/instagram-publish-validate_test.ts` (new file)

**Interfaces:**
- Consumes: exported `validateForScheduling(db, postId, opts?)` and the `createSupabaseQueryMock` helper (`db.queue(table, "select", { data, error })`, one queued response per table).
- Produces: `validateForScheduling` returns `ok: false` with the carousel message in `errors` when media count > `CAROUSEL_MAX_ITEMS`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/instagram-publish-validate_test.ts`:

```ts
import { assert } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { validateForScheduling } from "../_shared/instagram-publish-utils.ts";

// One valid JPEG post_file_link row (passes per-file validateMedia).
function link(i: number) {
  return {
    sort_order: i,
    files: {
      id: i + 1,
      kind: "image",
      mime_type: "image/jpeg",
      size_bytes: 1_000_000,
      width: 1080,
      height: 1080,
      duration_seconds: null,
      r2_key: `img/${i}.jpg`,
    },
  };
}

// Queue the four selects validateForScheduling makes, in any order (keyed by table).
// account has no encrypted token + active status, so no decrypt/network happens.
function seed(db: ReturnType<typeof createSupabaseQueryMock>, count: number) {
  db.queue("workflow_posts", "select", {
    data: { id: 1, scheduled_at: null, ig_caption: "cap", workflow_id: 9 },
    error: null,
  });
  db.queue("post_file_links", "select", {
    data: Array.from({ length: count }, (_, i) => link(i)),
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 5 }, error: null });
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: null,
      instagram_user_id: "ig",
      token_expires_at: null,
      authorization_status: "active",
    },
    error: null,
  });
}

Deno.test("validateForScheduling: 11 media → not ok, carousel message", async () => {
  const db = createSupabaseQueryMock();
  seed(db, 11);
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.ok, "11 items must fail validation");
  assert(
    res.errors.some((e) => e.includes("máximo 10")),
    "errors must include the 10-item carousel message",
  );
});

Deno.test("validateForScheduling: exactly 10 media → no carousel error", async () => {
  const db = createSupabaseQueryMock();
  seed(db, 10);
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    !res.errors.some((e) => e.includes("máximo 10")),
    "10 items must not produce the carousel error",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/instagram-publish-validate_test.ts`
Expected: the first test FAILS (no error contains `máximo 10`); the second passes vacuously.

- [ ] **Step 3: Add the count check**

In `validateForScheduling`, change the existing media-count branch (~line 168):

```ts
  if (mediaFiles.length === 0) {
    errors.push("Post precisa de pelo menos uma mídia.");
  } else {
    const mediaErrors = validateMedia(mediaFiles);
    for (const e of mediaErrors) errors.push(e.message);
  }
```

to:

```ts
  if (mediaFiles.length === 0) {
    errors.push("Post precisa de pelo menos uma mídia.");
  } else {
    if (mediaFiles.length > CAROUSEL_MAX_ITEMS) {
      errors.push(
        `Carrossel do Instagram aceita no máximo ${CAROUSEL_MAX_ITEMS} itens ` +
          `(este post tem ${mediaFiles.length}). Reduza para ${CAROUSEL_MAX_ITEMS} ou menos. ` +
          `O app do Instagram permite 20, mas a publicação via API é limitada a ${CAROUSEL_MAX_ITEMS}.`,
      );
    }
    const mediaErrors = validateMedia(mediaFiles);
    for (const e of mediaErrors) errors.push(e.message);
  }
```

(`CAROUSEL_MAX_ITEMS` is already defined in this file from Task 2.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/instagram-publish-validate_test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Commit** (do NOT add `deno.lock`)

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts \
        supabase/functions/__tests__/instagram-publish-validate_test.ts
git commit -m "$(cat <<'EOF'
feat(ig-publish): block >10-item carousel at schedule/publish time

Early UX block in validateForScheduling (schedule, publish-now,
hub-approve) so the user gets an immediate clear message via toast.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GqUAFpMCz63pVaV7KMk1Y4
EOF
)"
```

---

### Task 4: Full verification + node_modules/deno.lock restore

**Files:** none modified — this task verifies the whole change set and repairs the toolchain.

**Interfaces:** none.

- [ ] **Step 1: Run the full Deno edge-function suite**

Run: `npm run test:functions`
Expected: the full suite passes, including `instagram-publish-container_test.ts`, `instagram-publish-validate_test.ts`, and the unchanged `instagram-publish-gate_test.ts` (the retry test still asserts `200 / agendado` — retry is intentionally not blocked at the handler; the backstop catches it downstream).

- [ ] **Step 2: Restore the toolchain (the Deno runs mutated node_modules + deno.lock)**

```bash
git checkout deno.lock
npm ci
```
Expected: `deno.lock` reverts to its committed state; `npm ci` reinstalls a clean `node_modules`.

- [ ] **Step 3: Confirm the frontend still typechecks and tests green**

Run: `npm run build && npm run test -- --run`
Expected: `tsc` + `vite build` succeed; all Vitest tests pass (919 baseline + the 2 new gallery tests).

- [ ] **Step 4: Confirm a clean tree (deno.lock not left dirty, nothing uncommitted)**

Run: `git status --porcelain`
Expected: empty output (all intended changes committed; `deno.lock`/`node_modules` clean).

---

## Self-Review

**Spec coverage:**
- Layer 1 backstop (`createContainerForPost`) → Task 2. ✓
- Layer 2 early block (`validateForScheduling`) → Task 3. ✓
- Composer warning in shared `PostMediaGallery` → Task 1. ✓
- Hub silent-skip (decided, no code change) → no task needed; existing behavior unchanged. ✓
- Tests: backstop-throws-no-Graph-call (Task 2 Step 1), validate 11-fails/10-passes (Task 3 Step 1), banner 11-shows/10-hidden (Task 1 Step 1), retry regression (Task 4 Step 1). ✓
- Uploads unrestricted → enforced by Global Constraints + banner-only change; no `maxFiles`/`atLimit` touched. ✓

**Placeholder scan:** none — every code/JSON block is concrete; every command has expected output.

**Type/name consistency:** `CAROUSEL_MAX_ITEMS` is the same name server (exported, Task 2) and frontend (local, Task 1). The server message wording is identical in Task 2 and Task 3 and matches Global Constraints. The i18n keys `mediaGallery.carouselLimit` / `mediaGallery.carouselLimitDesc` are referenced in Task 1 Step 4 and defined in Task 1 Step 3 (both pt and en). `validateForScheduling` / `createContainerForPost` signatures match their existing definitions.
