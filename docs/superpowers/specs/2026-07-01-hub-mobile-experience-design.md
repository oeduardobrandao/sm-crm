# Hub Mobile Experience — Design

**Date:** 2026-07-01  
**Branch:** ebs/hub-mobile-experience  
**Base:** main at dbc9637  
**Status:** Approved (2026-07-01) — decisions confirmed: read-first captions; unlock `agendado`/`aprovado_cliente` only for hub reschedule

## Problem

The Hub works on mobile, but several high-frequency interactions still feel compressed or abrupt:

- the bottom navigation has no room for new destinations;
- approval cards open directly in a small caption editor instead of prioritizing reading;
- the editorial Postagens page cannot use the existing Instagram feed preview;
- the dashboard's best-post cards become a dense two-column mobile grid; and
- carousel media jumps one item at a time instead of following the user's finger.

These are separate surfaces, but they share one product goal: make the Hub feel intentionally mobile without changing the desktop information architecture.

## Goals

1. Keep the most-used Hub destinations directly reachable while exposing every existing route on mobile.
2. Make approval captions comfortable to read before asking the client to edit them.
3. Let clients preview and reorder feed-compatible posts from Postagens, with safe schedule persistence.
4. Turn Melhores Posts into a native-feeling mobile carousel while preserving the desktop grid.
5. Make InstagramPostCard carousels track a horizontal gesture continuously and preserve tap-to-lightbox.

## Non-goals

- Changing the desktop navigation or desktop Melhores Posts grid.
- Adding new Hub routes or a new edge function.
- Letting the Hub change post status or manually enter arbitrary dates in the feed preview.
- Reordering Stories in the Instagram feed preview; Stories and media-less posts remain outside selection.
- Rebuilding PostMediaLightbox in this iteration. The gesture primitive should be reusable there later, but applying it is optional.

## Current constraints

- HubNav renders the same six-item list on desktop and mobile. Ideias and Relatórios have routes but are absent from that list.
- InstagramPostCard treats every editable pending post as an editor, so Aprovações renders the 11 px textarea immediately. Its read-only branch already has the desired 14 px expandable caption.
- AprovacoesPage owns selection and InstagramGridPreview. The preview currently models selected Hub posts as draggable pending items and Instagram API posts as fixed live items.
- hub-posts PATCH authorizes by token and workflow ownership, but uses a status denylist and updates rows sequentially. It locks agendado, postado, and falha_publicacao.
- TopPostsRow is a responsive grid at every breakpoint.
- InstagramPostCard stores only currentSlide and applies a hard index change after a 40 px touch delta.

## Design

### 1. Mobile navigation

Keep the existing desktop NAV_ITEMS and desktop header markup unchanged. Split only the mobile model into:

- Primary destinations: Home, Aprovações, Postagens, Marca, Páginas.
- Mais sheet: Briefing, Ideias, Relatórios.

Briefing moves into Mais so an existing route is not lost while the bar remains five direct destinations plus one overflow control. The six physical slots therefore remain stable, while future secondary destinations no longer require another tab.

The Mais control uses a menu/ellipsis icon and the same 44 px minimum target as the direct tabs. It is active when the current path starts with briefing, ideias, or relatorios, including a report detail route.

#### Bottom sheet behavior

- Render a mobile-only fixed backdrop and sheet above the bottom bar.
- Give the sheet role=dialog, aria-modal=true, an accessible title, and a close button.
- Open from Mais; close from the backdrop, close button, Escape, or selecting a destination.
- Focus the first sheet destination on open and restore focus to Mais on close.
- Lock body scrolling while open and include env(safe-area-inset-bottom) in the sheet padding.
- Use large list rows with icon, label, and chevron. Do not duplicate theme or language controls; those remain in the mobile top bar.

Add nav.mais and nav.relatorios translations in Portuguese and English. nav.ideias already exists. Desktop continues to render exactly its current six links.

### 2. Read-first approval captions

Separate edit capability from edit visibility:

- canEdit remains derived from post status and readOnly.
- captionMode starts as preview for every card, including pending cards in Aprovações.
- The preview always uses the current effective caption: pending suggestion first, then ig_caption, then the existing conteudo_plain fallback.
- Render the existing Instagram-style 14 px caption, two-line clamp, and mais/ver menos control.
- When canEdit is true, show a small Editar legenda action below or beside the caption.
- Editar legenda switches to a 14 px multiline textarea and changes the secondary action to Concluir.
- Concluir returns to preview without waiting for the debounced request. The locally controlled draft is immediately reflected in the preview.

The textarea remains wired to useEditSuggestion and keeps its existing debounced persistence. Add a local captionDraft so the preview does not briefly revert while the query invalidation/refetch is in flight. Synchronize the draft from a new server value only when the user is not actively editing.

Saving and saved feedback remains visible in both modes. Approval stays blocked while a suggestion is saving or pending, exactly as today. A card becoming read-only after approval resets captionMode to preview.

### 3. Visualizar no Feed on Postagens

#### Page integration

PostagensPage adopts the same high-level flow as AprovacoesPage:

- selectedIds as a Set of post IDs;
- showGrid modal state;
- the cached hub-instagram-feed query, enabled only while opening the preview and when an Instagram profile exists;
- FeedPreviewButton in the page header; and
- InstagramGridPreview with an invalidation callback for hub-posts.

Only feed-compatible posts with media use selection: feed, reels, and carrossel cards rendered through InstagramPostCard. Stories and TextPostCard entries do not receive selection props.

Selection is allowed for every client-visible feed post. The preview decides whether a selected item is movable or fixed from its status. Prune IDs that disappear from the fetched post set, and derive the displayed count from selectedPosts rather than the raw Set so stale IDs cannot keep the button visible.

#### Preview item model

Replace the pending/live binary with an explicit mobility model:

- movable Hub item: enviado_cliente, correcao_cliente, aprovado_cliente, or agendado;
- fixed Hub item: postado or falha_publicacao;
- fixed Instagram item: a row returned by hub-instagram-feed.

An agendado post whose scheduled time has arrived is rendered fixed as Publicando. The backend remains authoritative and may also reject a future-looking item that has already been claimed for publishing.

Each grid item carries its source, post ID when applicable, status, scheduled slot, display timestamp, media metadata, and mobility. Fixed Hub items show a lock/status badge and never receive draggable handlers. falha_publicacao uses an error treatment. postado is deduplicated against live Instagram results by instagram_permalink; when a matching live item exists, prefer the live result so the same publication is not shown twice.

Initial ordering merges selected Hub items with live Instagram items by effective timestamp, newest first:

- scheduled_at for unpublished Hub items;
- published_at, falling back to scheduled_at, for postado;
- postedAt for Instagram items.

#### Reorder semantics

The preview represents positions as date slots. A drag may start and end only on movable Hub items. Dropping on another movable item swaps the two Hub items between their slots; fixed Hub and Instagram indices do not move. The moved posts inherit the scheduled dates of their destination slots, which is the date swap persisted to the backend.

This makes “fixed anchor” literal: postado, falha_publicacao, and live Instagram cells remain in place while movable posts exchange dates around them. A drop on a fixed cell is a no-op with fixed/locked cursor feedback.

On save:

- send only movable Hub posts whose scheduled_at differs from the initial map;
- never include fixed item IDs;
- retain changes after a failed request and show the backend error with a retry action;
- after success, replace the initial map, clear dirty state, invalidate hub-posts, and keep the success acknowledgement already used by the modal.

Update the hint and legend to distinguish Reordenável, Fixo, and Publicado no Instagram instead of calling every Hub item “para aprovar.”

#### Backend authorization and publishing safety

Keep PATCH /hub-posts as the public API. Replace the current denylist with an explicit allowlist:

- reschedulable: enviado_cliente, correcao_cliente, aprovado_cliente, agendado;
- always rejected: rascunho, revisao_interna, aprovado_interno, postado, falha_publicacao.

The handler continues to resolve the Hub token and scope every post through both cliente_id and conta_id. It must reject the entire request if any ID is missing, duplicated, outside the token's workflows, or in a forbidden status; silently dropping unauthorized IDs is not acceptable for a date swap.

Date swaps must be atomic. Add a small service-role-only Postgres RPC, called by the handler after token resolution, which locks every target workflow_posts row and performs the batch update in one transaction. This prevents one side of a swap from succeeding while another fails and serializes safely with claim_posts_for_publishing.

For agendado rows, the RPC also enforces publishing safety:

- the destination date must be non-null, valid, and at least ten minutes in the future;
- if the cron already holds publish_processing_at, the row is locked and the batch returns 409;
- if a non-story container was prepared but publication has not started, clear instagram_container_id before changing the date so the cron creates a fresh container near the new time;
- for Stories, reject if any segment already has media_id; otherwise clear prepared segment container_id values; and
- postado and falha_publicacao remain immutable from this endpoint.

If the cron wins the row lock and publishes first, the RPC observes postado after waiting and rejects the batch. If the reorder wins, the cron later sees the new date and reset container state. No post status changes as part of reordering.

The API returns a structured 409 response with locked_post_ids for status/processing conflicts and 400 for malformed schedules. InstagramGridPreview surfaces the message instead of swallowing it.

### 4. Melhores Posts mobile carousel

TopPostsRow remains one component with breakpoint-specific layout:

- Below sm: horizontal flex track, overflow-x-auto, snap-x snap-mandatory, hidden scrollbar, and one card occupying about 84% of the viewport so the next card peeks in.
- sm and above: the current 3/5-column grid, current card widths, and no dots or horizontal scrolling.

Track the nearest mobile card from scrollLeft and child offsetLeft in a requestAnimationFrame-throttled scroll handler. Render one dot per post below the track on mobile. Dots are buttons: selecting one scrolls that card into view; the active dot has larger width/opacity. Reset the active index when the posts array changes after a dashboard period change.

Use CSS scroll snap and native momentum for touch. Programmatic dot navigation uses smooth scrolling unless prefers-reduced-motion is enabled. Existing outbound Instagram links, image fallback, metrics, and hover behavior remain unchanged.

### 5. Continuous media drag in InstagramPostCard

Render every media item in one horizontal flex track inside the existing 4:5 viewport instead of rendering only currentMedia. Each slide is flex-none and 100% of the viewport width. The track transform combines the committed index and live drag offset.

Use Pointer Events for mouse, touch, and pen with touch-action: pan-y on the viewport:

1. pointerdown records pointer ID, start coordinates/time, current width, and recent velocity sample.
2. pointermove waits for an 8 px intent threshold. A vertical gesture is released to page scrolling; a horizontal gesture captures the pointer and updates dragOffset in real time.
3. At the first/last slide, outward movement receives 0.3 resistance instead of exposing empty space.
4. pointerup resolves the target from both distance and velocity: advance when the drag exceeds 18% of card width or about 0.45 px/ms; otherwise return to the current slide.
5. pointercancel always snaps back safely.

During a drag, the track has no transition. On release or arrow navigation, use a roughly 260 ms ease-out transform transition. Respect prefers-reduced-motion by removing or shortening that transition.

Keep the desktop arrow buttons; both arrows and gestures call the same clamped goToSlide function. Compute a fractional slide position during drag and use it to interpolate dot scale/opacity, so the next dot responds before release.

#### Tap versus drag

Do not wrap the whole track in a button. Each slide exposes an accessible open-media button, but a gesture ref records whether movement crossed the 8 px drag threshold. Suppress the synthetic click after a drag; a stationary pointer still opens PostMediaLightbox at that slide.

Keep VideoPrewarm and thumbnail behavior. Priority loading applies only to the first initially visible image. A ResizeObserver (or equivalent width measurement) updates the snap geometry when the card width changes across responsive breakpoints.

Extract the target-resolution math into a pure helper so distance, velocity, edge resistance, and click suppression can be unit-tested without browser layout. The same helper can later power PostMediaLightbox, but the lightbox remains unchanged in the required scope.

## Accessibility and interaction details

- All new controls have at least a 44 by 44 px touch target where space permits.
- The bottom sheet has focus management, Escape support, and a labelled dialog boundary.
- Carousel dots expose “Ir para post N” or “Ir para mídia N” labels and current state.
- Fixed feed cells expose an accessible locked/status label rather than relying only on color.
- Horizontal carousels preserve vertical page scrolling and keyboard-accessible arrow/dot navigation.
- Motion honors prefers-reduced-motion.

## Files affected

### Hub frontend

- apps/hub/src/shell/HubNav.tsx — split desktop/mobile item models and add Mais sheet.
- apps/hub/src/shell/__tests__/HubNav.test.tsx — mobile overflow, active state, focus, and unchanged desktop links.
- packages/i18n/locales/pt/common.json and en/common.json — Mais and Relatórios labels.
- apps/hub/src/components/InstagramPostCard.tsx — read-first caption and continuous media track.
- apps/hub/src/components/__tests__/InstagramPostCard.test.tsx — caption modes, gestures, edge behavior, and tap suppression.
- apps/hub/src/lib/carouselGesture.ts plus tests — pure swipe target/resistance helpers.
- apps/hub/src/pages/PostagensPage.tsx — selection and preview query/modal integration.
- apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx — Postagens selection behavior.
- apps/hub/src/components/InstagramGridPreview.tsx — mobility model, fixed anchors, date-slot swaps, errors, and deduplication.
- apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx — movable/fixed behavior and save payload.
- apps/hub/src/components/dashboard/TopPostsRow.tsx — mobile scroll snap and dots.
- apps/hub/src/components/__tests__/TopPostsRow.test.tsx — dots, active index, and desktop grid classes.

### Backend

- supabase/functions/hub-posts/handler.ts — strict batch validation and RPC/error mapping.
- supabase/functions/__tests__/hub-functions_test.ts — ownership, status allowlist, locked conflict, and RPC contract.
- supabase/migrations/<timestamp>_hub_atomic_post_schedule_reorder.sql — transactional schedule swap and publishing-state guards.

No CRM files, route changes, or new edge-function configuration are required.

## Testing

### Navigation

- Mobile renders five direct destinations plus Mais; Briefing, Ideias, and Relatórios are reachable from the sheet.
- Mais is active on overflow routes and report detail routes.
- Backdrop, Escape, close button, and link selection close the sheet and restore focus.
- Desktop link set and active styling remain unchanged.

### Caption

- An enviado_cliente card starts with the 14 px preview and no textarea.
- Editar legenda opens a controlled editor; Concluir returns to the updated preview.
- Long captions expand/collapse in preview mode.
- Debounced suggestion save still blocks approval and displays saving/saved state.

### Postagens feed preview

- Only feed-compatible media cards have selection controls.
- Feed data is fetched lazily and the modal receives the selected posts.
- postado/falha_publicacao items are fixed and omitted from PATCH payloads.
- Movable-to-movable drag swaps date slots without shifting fixed cells.
- A matched postado/live permalink renders once.
- Failed saves keep dirty state and display the error.

### Backend

- Cross-client and cross-workspace IDs reject the whole batch.
- Internal, postado, and falha_publicacao statuses reject with no updates.
- aprovado_cliente and safe agendado rows update atomically.
- Claimed/publishing rows and partially published Stories return 409.
- Prepared but unpublished containers are reset during a successful agendado move.
- Malformed, duplicate, null-for-agendado, and too-soon dates reject with no partial swap.

### Mobile carousels

- TopPostsRow scroll updates the active dot and dot activation scrolls to the correct card.
- sm and larger retain the existing grid and hide dots.
- InstagramPostCard follows pointer movement, uses edge resistance, resolves distance/velocity thresholds, and snaps back below threshold.
- A tap opens the correct lightbox slide; a drag does not open it.
- Arrow navigation and dots stay synchronized with gesture navigation.

Run:

- npm run test
- npm run build:hub
- npm run test:functions
- npm run lint

## Rollout and failure behavior

This ships as one Hub release because all frontend changes are backward-compatible with the existing routes and responses. Deploy the database migration before or with the hub-posts handler; the handler must not call the RPC until it exists.

If feed loading fails, Postagens remains usable and the preview shows a retryable error. If a schedule conflict occurs because publishing started, retain the local preview, identify the locked posts, and ask the client to refresh rather than attempting a partial save.

## Resolved decisions

- Briefing moves into the mobile Mais sheet with Ideias and Relatórios; desktop navigation is unchanged.
- Reordering swaps existing date slots; it does not provide a date picker.
- Fixed means the grid index cannot shift, not merely “cannot be dragged.”
- Schedule persistence is atomic and uses an allowlist, closing the current ability for a Hub token to mutate internal draft schedules.
- PostMediaLightbox gesture parity is deferred unless implementation proves trivial after extracting the helper.
