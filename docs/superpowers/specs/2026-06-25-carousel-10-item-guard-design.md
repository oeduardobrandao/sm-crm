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
| Schedule ("Agendar") | Blocked > 10, clear message |
| Publish now ("Publicar") | Blocked > 10, clear message |
| Client approval auto-schedule (Hub) | Blocked > 10, clear message |

## Design

### 1. Server guard — single chokepoint (the real enforcement)

All three server-side publish entry points funnel through one function,
`validateForScheduling()` in `supabase/functions/_shared/instagram-publish-utils.ts`:

- `instagram-publish` `schedule` action (handler.ts:80)
- `instagram-publish` `publish-now` action (handler.ts:172, `skipDateCheck`)
- `hub-approve` client-approval auto-schedule (hub-approve/handler.ts:83)

Because a post can only reach `agendado` status by passing this function, nothing
over the limit ever reaches the cron / container-creation path. Meta's own rejection
remains the final backstop.

**Changes:**

1. Add an exported constant next to the existing IG-limit constants
   (`IMAGE_MAX_BYTES`, etc.):
   ```ts
   /** Instagram Content Publishing API caps carousels at 10 items.
    *  (The native app allows 20, but the Graph API does not.) */
   export const CAROUSEL_MAX_ITEMS = 10;
   ```

2. In `validateForScheduling`, extend the existing media-count branch
   (currently only checks `length === 0`):
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
   The count error is pushed **alongside** (not instead of) the per-file checks, so
   the user sees every problem at once.

**No frontend wiring needed for the block:** `scheduleInstagramPost` and
`publishInstagramPostNow` already surface `data.details.join('; ')` (the validation
errors) via a `sonner` toast. The clear message appears automatically.

### 2. Composer inline warning (early, non-blocking UX)

So the user learns about the limit while editing rather than at schedule time, show a
non-blocking warning in the post composer's media area when the count exceeds 10.

- Component: the media gallery rendered inside the post composer
  (`apps/crm/src/pages/entregas/components/PostMediaGallery.tsx` /
  `WorkflowDrawer.tsx` — confirm exact host during implementation).
- A small warning banner (lucide `AlertTriangle`, warning color) reading e.g.
  *"Carrossel com mais de 10 itens não pode ser publicado no Instagram (limite da API). O app permite 20, mas a publicação automática aceita no máximo 10."*
- **Uploads stay enabled.** The banner is informational only; it does not disable the
  add-media control or remove any media.
- Add a frontend constant `CAROUSEL_MAX_ITEMS = 10` (a one-line, deliberate duplicate
  of the server value — Vite app cannot import Deno `_shared` code; cross-reference both
  with a comment).

## Files touched

| File | Change |
|------|--------|
| `supabase/functions/_shared/instagram-publish-utils.ts` | Add `CAROUSEL_MAX_ITEMS`; count check in `validateForScheduling` |
| `supabase/functions/__tests__/instagram-publish-*` (validation test) | Assert 11 fails, 10 passes |
| `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx` (or composer host) | Non-blocking > 10 warning banner |
| frontend constants (new or existing shared file) | `CAROUSEL_MAX_ITEMS = 10` |
| `apps/crm/.../__tests__/PostMediaGallery.test.tsx` | Banner shows at 11, hidden at 10 |

## Testing

- **Deno:** extend the `validateForScheduling` test coverage — 11 items → `ok: false`
  with the carousel message; exactly 10 items → no carousel error; 1 item (single post)
  → no carousel error.
- **Vitest (RTL):** the composer banner renders at 11 items and is absent at 10; the
  add-media control remains enabled at 11.

## Out of scope

- Blocking or capping **uploads** (uploads stay unrestricted by design).
- Auto-splitting a >10 carousel into multiple posts.
- Raising the limit to 20 (that is Meta's API limit, not ours).
- Reels / single-image / single-video paths (a single item is never a carousel; only
  the > 10 collection rule is added).

## Isolation

All work in the `feat/carousel-10-item-guard` worktree off `main`, separate from the
active `feat/ig-aligned-ranking-mcp` branch and other parallel sessions.
