# Carousel 10-Item Guard — Design

**Date:** 2026-06-25
**Branch:** `feat/carousel-10-item-guard` (isolated worktree off `main`)

## Problem

A scheduled post with 11 images failed to publish with Instagram's error:

> "Unsupported post type. The post has too little or too many attachments to qualify as a carousel."

Root cause: the **Instagram Content Publishing (Graph) API caps carousels at 10 items**, even though the native Instagram app allows up to 20. Meta's message is passed through verbatim by `throwGraphError` and stored as `publish_error`. Our code imposes **no** upper bound — `createContainerForPost` builds a child container for every attached media item and only fails when Meta rejects the parent container, hours after scheduling.

## Goal

Block posts with more than 10 media items from being **scheduled or published** via the API, with a clear Portuguese message, while leaving **uploads unrestricted** (users may attach 11+, reorder, and swap media freely while editing — they just can't schedule until it is ≤ 10).

| Action | Behavior |
|--------|----------|
| Upload / attach media | Unrestricted (no change) |
| Schedule ("Agendar") | Blocked > 10, clear message (early 422) |
| Publish now ("Publicar") | Blocked > 10, clear message (early 422) |
| Retry a failed post ("Reenviar") | Backstop rejects > 10 at container creation → stays `falha_publicacao` with clear `publish_error` |
| Cron container creation (incl. rows already `agendado` pre-deploy) | Backstop rejects > 10 before any Graph call → `falha_publicacao` with clear `publish_error` |
| Client approval auto-schedule (Hub) | Auto-schedule skipped (post still approved); agent gets the clear message when scheduling from the CRM (see §4) |

## Design

The enforcement is **two layers**: a hard backstop at the only point every publish path
converges (container creation), plus an early friendly block at the user's action for UX.

### 1. Primary backstop — `createContainerForPost` (the true chokepoint)

`createContainerForPost()` (`supabase/functions/_shared/instagram-publish-utils.ts:365`)
is the **only** function that builds Instagram carousel-child containers, and every
publish path goes through it:

- schedule front-load when due within ~1h (`instagram-publish/handler.ts:107`)
- publish-now (`instagram-publish/handler.ts`, publish-now block)
- cron Phase 1 (`instagram-publish-cron/index.ts:95`)

This matters because **`validateForScheduling` is NOT the only path to `agendado`**:
`retry` (`handler.ts:146`) re-queues a `falha_publicacao` post to `agendado` with no
validation, and rows that were already `agendado` before this guard ships still flow to
cron. Guarding only `validateForScheduling` would leave both bypasses open.

**Change:** in `createContainerForPost`, immediately after the existing
`media.length === 0` check, before any Graph child-container call:

```ts
if (media.length > CAROUSEL_MAX_ITEMS) {
  throw new Error(
    `Carrossel do Instagram aceita no máximo ${CAROUSEL_MAX_ITEMS} itens ` +
    `(este post tem ${media.length}). Reduza para ${CAROUSEL_MAX_ITEMS} ou menos. ` +
    `O app do Instagram permite 20, mas a publicação via API é limitada a ${CAROUSEL_MAX_ITEMS}.`
  );
}
```

The throw happens before any `fetch` to Graph. In the cron and publish-now paths the
caller already catches container-creation errors and writes `publish_error`
(`handler.ts:270`, `cron/index.ts:71`, truncated to 500 chars) and moves the post to
`falha_publicacao`, so the agent sees a clear reason in the CRM.

Add the shared constant next to the other IG-limit constants (`IMAGE_MAX_BYTES`, etc.):

```ts
/** Instagram Content Publishing API caps carousels at 10 items.
 *  (The native app allows 20, but the Graph API does not.) */
export const CAROUSEL_MAX_ITEMS = 10;
```

### 2. Early UX block — `validateForScheduling`

So the user gets an **immediate** clear message at the moment they click Agendar /
Publicar (rather than letting the post go `agendado` and fail later at cron), also add
the count check to `validateForScheduling` (the gate used by `schedule`,
`publish-now`, and `hub-approve`). Extend the existing media-count branch:

```ts
if (mediaFiles.length === 0) {
  errors.push("Post precisa de pelo menos uma mídia.");
} else {
  if (mediaFiles.length > CAROUSEL_MAX_ITEMS) {
    errors.push(
      `Carrossel do Instagram aceita no máximo ${CAROUSEL_MAX_ITEMS} itens ` +
      `(este post tem ${mediaFiles.length}). Reduza para ${CAROUSEL_MAX_ITEMS} ou menos. ` +
      `O app do Instagram permite 20, mas a publicação via API é limitada a ${CAROUSEL_MAX_ITEMS}.`
    );
  }
  const mediaErrors = validateMedia(mediaFiles);
  for (const e of mediaErrors) errors.push(e.message);
}
```

The count error is pushed **alongside** (not instead of) the per-file checks, so the
user sees every problem at once. `scheduleInstagramPost` / `publishInstagramPostNow`
already surface `data.details.join('; ')` via a `sonner` toast — the message appears
with no extra frontend wiring. This layer is UX only; layer 1 is the real guarantee.

### 3. Composer inline warning — in `PostMediaGallery`

`PostMediaGallery` (`apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`) is
the shared media component used by **both** composers — the workflow drawer
(`WorkflowDrawer.tsx:1139`) and Post Express (`ExpressPostPage.tsx:460`). Adding the
warning here covers both with one change.

- When the gallery's media count exceeds `CAROUSEL_MAX_ITEMS`, render a non-blocking
  warning banner (lucide `AlertTriangle`, warning color):
  *"Carrossel com mais de 10 itens não pode ser publicado no Instagram (limite da API). O app permite 20, mas a publicação automática aceita no máximo 10."*
- **Uploads stay enabled.** The banner is informational only; it does not disable the
  add-media control or remove any media.
- Add a frontend constant `CAROUSEL_MAX_ITEMS = 10` (a deliberate one-line duplicate of
  the server value — the Vite app cannot import Deno `_shared` code; cross-reference both
  with a comment).

### 4. Hub auto-schedule — skipped silently (decided)

When a client approves a post with `auto_publish_on_approval` on, `hub-approve`
(`hub-approve/handler.ts:82`) only schedules if `validateForScheduling` passes; on
failure it leaves `scheduled: false` and the post stays approved-but-not-scheduled. The
Hub UI (`InstagramPostCard.tsx:100`) then shows "Post aprovado!" (not "agendado"), so
the client is never falsely told it was scheduled.

**Decision:** keep this silent-skip behavior. It is the **existing** behavior for every
validation failure (missing caption, expired token, …); the carousel rule simply joins
that set. The agent receives the explicit 10-item message when they schedule the post
from the CRM (layer 2), and the backstop (layer 1) prevents any bad publish regardless.
Surfacing Hub-side schedule errors is a separate, cross-cutting UX gap and is out of
scope for this guard.

## Files touched

| File | Change |
|------|--------|
| `supabase/functions/_shared/instagram-publish-utils.ts` | Add `CAROUSEL_MAX_ITEMS`; backstop throw in `createContainerForPost`; count check in `validateForScheduling` |
| `supabase/functions/__tests__/instagram-publish-container_test.ts` | Assert `createContainerForPost` throws on 11 media **before any Graph fetch**; 10 proceeds |
| `supabase/functions/__tests__/` (validation test) | `validateForScheduling`: 11 → fails with message; 10 / 1 → no carousel error |
| `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx` | Non-blocking > 10 warning banner |
| frontend constants (new or existing shared file) | `CAROUSEL_MAX_ITEMS = 10` |
| `apps/crm/.../__tests__/PostMediaGallery.test.tsx` | Banner shows at 11, hidden at 10; add-media control still enabled at 11 |

## Testing

- **Deno — backstop (primary):** `createContainerForPost` with 11 media throws and makes
  **no** Graph call (assert the fetch/child-container mock is never invoked); with 10 it
  proceeds to build children. This is the test that covers the retry/cron bypass.
- **Deno — early block:** `validateForScheduling` with 11 items → `ok: false` carrying the
  carousel message; exactly 10 → no carousel error; 1 item → no carousel error.
- **Deno — regression:** existing retry gate test (`instagram-publish-gate_test.ts:82`)
  still asserts `200 / agendado` — retry is intentionally not blocked at the handler;
  the backstop catches an over-limit retry downstream at container creation.
- **Vitest (RTL):** the `PostMediaGallery` banner renders at 11 items and is absent at 10;
  the add-media control remains enabled at 11.

## Out of scope

- Blocking or capping **uploads** (uploads stay unrestricted by design).
- Auto-splitting a >10 carousel into multiple posts.
- Raising the limit to 20 (that is Meta's API limit, not ours).
- Surfacing Hub-side auto-schedule failures to clients (pre-existing cross-cutting gap; see §4).
- Reels / single-image / single-video paths (a single item is never a carousel; only
  the > 10 collection rule is added).

## Isolation

All work in the `feat/carousel-10-item-guard` worktree off `main`, separate from the
active `feat/ig-aligned-ranking-mcp` branch and other parallel sessions.
