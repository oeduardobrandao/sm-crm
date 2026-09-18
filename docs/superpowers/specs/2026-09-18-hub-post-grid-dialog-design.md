# Hub post grid + detail dialog

**Date:** 2026-09-18
**Status:** approved design, not yet planned
**Prerequisite:** the correction-flow rework (`2026-09-17-hub-correction-flow-rework-design.md`, branch `claude/post-approval-history-5938fa`, PR #541) merged. The dialog's correction panel depends on `useEditSuggestion.dirty` and the relaxed `hub-approve` (optional motivo). Build this as a stacked branch on top of it.

## Goal

On the Hub's Aprovações and Postagens pages, replace the three inline post cards (`InstagramPostCard`, `StoryPostCard`, `TextPostCard`) with a media-first grid of tiles. Clicking a tile opens one large dialog where the client reads the post, approves it, edits the text or asks for a correction, and steps to the next post without going back to the grid. The grid must make posts with media (carousels, reels, single images) look good, give text-only posts an efficient tile, and make moving between posts easy.

Decisions made in the brainstorm, all fixed:

| Question | Decision |
|---|---|
| Scope | Both Aprovações and Postagens share the grid and the dialog |
| Grid | Unified chronological 4:5 grid; text posts as typographic tiles in the same grid; stories in a rail above |
| Dialog | Split pane on desktop (media left, panel right), full-screen sheet on phones; thumbnail strip on every post |
| Navigation | Prev/next arrows + `←`/`→` + strip; URL updates to `:postId` |
| Feed preview selection | Explicit select mode toggled by a header button |
| Postagens grouping | Fluxo groups flattened; fluxo filter chips |
| After Aprovar / Enviar correção | Auto-advance to the next pending post |

## Approach

New components, with the reusable pieces of the three cards extracted first so the dialog does not become a fourth copy of the staged-edit pattern. The three cards and `PostagemFocoPage` are deleted once both pages use the grid.

## Components

All under `apps/hub/src/components/posts/` unless noted.

### `PostTile`

```ts
{ post: HubPost; mode: 'browse' | 'select'; selected: boolean; selectable: boolean;
  onOpen(postId: number): void; onToggle(postId: number): void; priority?: boolean }
```

- 4:5 aspect, `rounded-xl overflow-hidden`, whole tile is one `<button>` (browse) or a checkbox (`role="checkbox"`, select).
- Image source: `post.cover_media ?? post.media[0]`; for `kind === 'video'` use `thumbnail_url`. `object-fit: cover`; reels (9:16) and landscape images are cropped, accepted. `blur_data_url` as the placeholder; `priority` sets eager loading for the first row.
- Overlays only: status pill top-left (`getPostStatusLabel`, colours from the existing `STATUS_COLORS`), type glyph top-right (carousel / reel / story, lucide), title in one line on a bottom gradient. No date, no actions.
- Variants:
  - `media_lost_at` on the cover → `MediaUnavailable` treatment inside the tile.
  - `media_autocleaned_at` set and `media.length === 0` → "Mídia removida" tile: neutral surface, `ImageOff` icon, title, and the permalink link (`instagram_permalink` or `tiktok_post_url`), not a text tile.
  - `media.length === 0` otherwise → text tile: `hub-card` surface, serif title (`font-display`), `conteudo_plain` excerpt clamped to 4 lines, footer "Feed · 28 abr" (`formatDate`).
- Select mode: media tiles show a 44px checkbox top-right and toggle on click; text tiles, autocleaned tiles and the stories rail render at 50% opacity and ignore clicks. `selectable = media.length > 0 && tipo !== 'stories'`, unchanged from today.

### `StoriesRail`

```ts
{ posts: HubPost[]; onOpen(postId: number): void }
```

Horizontal scroll row of 64px ring avatars (first media frame, gradient ring, status dot). Rendered above the grid only when there is at least one `tipo === 'stories'` post in the visible set. Hidden in select mode (dimmed, inert).

### `PostGrid`

```ts
{ posts: HubPost[]; mode: 'browse' | 'select'; selectedIds: Set<number>;
  onOpen(postId: number): void; onToggle(postId: number): void }
```

`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3`. Splits `posts` into stories (rail) and everything else (tiles) using `pickPostCardKind` from `lib/postView.ts`; the inline duplicate predicates in both pages are removed. Order is the order received.

### `PostMediaPane`

```ts
{ post: HubPost; onOpenLightbox(index: number): void }
```

Extracted from `InstagramPostCard` (carousel: `lib/carouselGesture` swipe, dots, on-media arrows, HLS video via the existing player) and `StoryPostCard` (story frames with tap-to-advance and progress bars). Dark surface (`#111`), media letterboxed to fit. Handles `media_lost_at` via `MediaUnavailable`. Does not bind keyboard arrows (see Keys).

### `CorrectionPanel`

```ts
{ post: HubPost; token: string; onApprovalSubmitted(): void; onClose(): void;
  onDirtyChange(dirty: boolean): void }
```

The staged-edit + correction flow from the three cards, once. Owns `useEditSuggestion`, the staged content (`stagedConteudo`/`stagedConteudoPlain` for text posts via the existing TipTap `RichTextContent`; `stagedIgCaption` textarea for every post that has a caption), `contentDirty`, `comentario`, `motivo`, and the buttons **Salvar edição**, **Enviar correção**. Behaviour is exactly the rework spec: motivo and comentário optional; `hasPendingSuggestion` collapses both sections to "Sugestão enviada para revisão"; failed-save message when `dirty && saveState === 'idle' && !contentDirty`. Reports `dirty || contentDirty || comentario.trim() !== '' || motivo !== null` through `onDirtyChange` so the dialog can guard Esc, prev/next and strip clicks with `discardCorrectionConfirm`. The `Mídia` motivo chip is hidden when `media.length === 0`. Caption baseline is the displayed caption (LEGENDA fallback from `conteudo_plain`), as in the cards today.

### `PostDetailDialog`

```ts
{ posts: HubPost[]; currentId: number | null; token: string; approvals: PostApproval[];
  instagramProfile: HubInstagramProfile | null; autoPublishOnApproval: boolean;
  onNavigate(postId: number | null): void; onApprovalSubmitted(): void }
```

- Radix `Dialog` (`@radix-ui/react-dialog`, already a root dependency; the Hub has no Dialog primitive yet, so this adds `components/ui/HubDialog.tsx` wrapping Radix with the Hub's classes). Portals to `document.body`; theme variables live on `:root` (`HubShell.tsx:164`) so the whitelabel accent survives the portal. `z-[9000]`; `PostMediaLightbox` keeps `z-[9005]` and opens above it. `.hub-fade-up`'s transform is irrelevant once portaled.
- Desktop (`md:`): `grid-cols-[1.15fr_1fr]`, `max-w-[1040px] max-h-[92vh]`. Text-only and autocleaned posts: single column, `max-w-[560px]`.
- Phone: full-screen sheet; media pane capped at `55vh`, panel scrolls below, footer sticky.
- Right pane, top to bottom:
  1. Header: title (serif), chips: status, type + slide count ("Carrossel · 8 slides", "Reel", "Story · 3", "Feed · sem mídia"), platform (`PlatformBadge`), scheduled date, fluxo title; `SharePostButton` and close button.
  2. Tabs: **Legenda** (or **Texto** for text-only posts) | **Histórico e comentários** (`PostHistoryPanel`, unchanged).
  3. Body (scrolls): reading mode shows the caption, or for text posts the rich body in the serif plus the Instagram caption as a secondary block; the auto-publish note (`autoPublishScheduled`/`autoPublishUnscheduled`) when `autoPublishOnApproval`. Corrigir replaces the body with `CorrectionPanel`.
  4. Thumbnail strip: every post in `posts`, 30×38 tiles (media thumbnail; pale `hub-card` tile for text posts), current one outlined, click navigates, auto-scrolls to keep current visible.
  5. Footer, sticky: when `post.status === 'enviado_cliente'`: **Corrigir** / **Aprovar**; in correction mode **Fechar** / **Aprovar**. Otherwise the footer shows the status only. This applies on Postagens too (today its cards are `readOnly` but `PostagemFocoPage` is not; the dialog follows the focus page).
- Aprovar gate: `submitting || approvalBlocked || dirty || contentDirty`, as in the rework spec. Fechar disabled while `dirty` (save in flight); Fechar with anything else dirty asks `discardCorrectionConfirm`.
- Prev/next: arrows outside the panel on desktop, in the header on phones; disabled at the ends. Counter "3 de 12" over the media.
- Keys: `←`/`→` always mean previous/next **post**. Slides use dots, swipe and the on-media arrows only. `Esc` closes. Both guarded by the dirty confirm.
- After `submitApproval` resolves: `toast.success`, compute `nextPending` = first post after the current one (wrapping) with `status === 'enviado_cliente'` from the `posts` array **as it was before the action**, call `onNavigate(nextPending?.id ?? null)`, then `onApprovalSubmitted()` (query invalidation). Order matters: invalidation on Aprovações removes the post from the list and shifts indices.

### `usePostNavigation(posts, currentId)`

Returns `{ index, prev, next, nextPending, goTo }`. Pure, tested on its own.

## Pages

### Shared page state

Both pages compute `visiblePosts: HubPost[]` (after filters, sorted by `scheduled_at`) and pass it to `PostGrid` and `PostDetailDialog`. `selectedIds` stays page state; `selectedPosts` keeps the memoized identity from `PostagensPage` (L125) so `InstagramGridPreview` does not re-render on refetch. The `FeedPreviewButton` and the new **Selecionar / Concluir** toggle live in `PageHeader action`; the toggle exists only when `instagramProfile` is set (same condition as the button today).

### Postagens

- Flatten: no per-fluxo sections, no `collapsed` set. New `FluxoFilterChips` beside `StatusFilterChips` (chips "Todos" + one per distinct `workflow_titulo`, "Avulsas" for `workflow_id == null`). Both filters combine.
- The per-card header row (`StatusTag`, `OpenPostLink`, `SharePostButton`) is removed: status is on the tile, share is in the dialog, `OpenPostLink` is redundant once the URL carries the post id. `OpenPostLink` itself stays (used by `buildHubPostLink` consumers elsewhere).

### Aprovações

Pending only, sorted by `scheduled_at`, as today; same grid and dialog. Section headings "Stories" / "Posts sem mídia" go away (the rail and text tiles replace them); the i18n keys are removed.

## Routing

| URL | Renders |
|---|---|
| `postagens` | `PostagensPage`, dialog closed |
| `postagens/:postId` | `PostagensPage` with the dialog open on `postId` |
| `aprovacoes` | `AprovacoesPage`, dialog closed |
| `aprovacoes/:postId` (new) | `AprovacoesPage` with the dialog open |

- Opening a tile: `navigate(':postId')` (push). Prev/next/strip: `navigate(..., { replace: true })` so Back closes the dialog instead of walking through posts. Close: `navigate('..')`.
- `postagens/:postId` stays the deep-link shape `buildHubPostLink` emits (client notification emails). On load the page waits for `['hub-posts', token]`; if the post is missing or fails `isClientVisible`, the dialog opens in a **notAvailable** state (copy from `postagemFoco.notAvailable`, retry from `postagemFoco.retry`) over the grid; Fechar navigates to `postagens`.
- If the deep-linked post is hidden by the active status/fluxo filter, both filters reset to "Todos" before opening so the strip and prev/next match what the client sees.
- `PostagemFocoPage.tsx` and its route entry are deleted; `router.tsx` gets the two `:postId` children pointing at the list pages.

## Data and backend

No schema, RPC or edge-function changes. Uses `fetchPosts`, `submitApproval`, `fetchPostHistory`, `fetchInstagramFeed` and `useEditSuggestion` as they exist after PR #541.

## Removals

- `InstagramPostCard.tsx`, `StoryPostCard.tsx`, `TextPostCard.tsx` and their `__tests__`; their assertions move to `CorrectionPanel.test.tsx` and `PostDetailDialog.test.tsx`.
- `PostagemFocoPage.tsx`.
- `PostCard.tsx` stays: `formatDate`, `PlatformBadge`, `getPostStatusLabel` are still used.
- i18n: remove `aprovacoes.storiesHeader`, `aprovacoes.noMediaHeader`, `postagens.clickToExpand`, `instagramCard.editCaptionHint`, `instagramCard.likeAriaLabel`, `storyCard.replyPlaceholder`; add `posts.select`, `posts.done`, `posts.previous`, `posts.next`, `posts.counter` ("{{current}} de {{total}}"), `posts.tabCaption`, `posts.tabText`, `posts.editCaption`, `posts.editText`, `posts.requestCorrection`, `posts.mediaRemoved`, `postagens.filter.fluxo`, `postagens.filter.avulsas`. `hubPostsLocale.test.ts` updated. No em-dashes in any string.

## Error handling

| Case | Behaviour |
|---|---|
| Tile/pane media fails to load | `MediaUnavailable`; dialog stays usable |
| `submitApproval` rejects | `toast.error`, stay on the post, buttons re-enable |
| Deep link to unknown/hidden post | notAvailable state in the dialog |
| Navigation while the correction panel is dirty | `discardCorrectionConfirm`; cancel keeps the post |
| Save in flight (`dirty`) | Fechar, prev/next and Esc disabled until it settles |

## Testing

Vitest (`apps/hub/src/components/posts/__tests__/`):

- `PostTile`: cover = `cover_media ?? media[0]`; video uses `thumbnail_url`; autocleaned and lost variants; text tile excerpt; select mode disables non-selectable tiles.
- `PostGrid`: stories go to the rail, everything else to tiles; order preserved.
- `usePostNavigation`: prev/next at the ends; `nextPending` wraps and skips non-pending.
- `CorrectionPanel`: ported from the three card tests (motivo optional, comentário sent, Fechar discards staged edit and re-enables Aprovar via `onDirtyChange`, pending freeze, `Mídia` chip hidden without media).
- `PostDetailDialog`: renders split vs single column by post kind; `←`/`→` navigate posts, not slides; Esc with dirty panel calls confirm; Aprovar shown for pending posts on Postagens; auto-advance uses the pre-action snapshot (list shrinks after invalidation, dialog still lands on the right post); strip click navigates.
- Pages: `postagens/:postId` opens the dialog after data loads; hidden-by-filter deep link resets filters; unknown id shows notAvailable; `aprovacoes/:postId` route works.
- `hubPostsLocale.test.ts` key list.

Browser check on the local Hub before merge: phone sheet, dark mode, whitelabel accent inside the portaled dialog, lightbox above the dialog.

## Out of scope

Reordering in the feed preview, bulk approve, per-slide comments, CRM changes, changes to `hub-approve`.
