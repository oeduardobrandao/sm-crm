# Express Post — Design Spec

## Goal

Let managers quickly publish an Instagram post (media + caption) without going through the full entregas workflow (content creation, internal review, client approval, scheduling). One page, one form, one click to publish.

## Architecture

Single-page form at `/post-express` inside the existing `AppLayout` (sidebar + protected route). Reuses the existing data model — auto-creates a lightweight `Workflow` + `WorkflowPost` on client selection so the publish pipeline, media upload, and post history all work unchanged. No new backend endpoints; the only new backend work is an orphan draft cleanup cron.

## Route & Navigation

- **Route:** `/post-express` inside the `<ProtectedRoute><AppLayout /></ProtectedRoute>` wrapper
- **Sidebar:** New nav item under the "Gestão" group, between Entregas and Arquivos
  - Label: `Post Express`
  - Icon: Phosphor `ph-paper-plane-tilt`
- **Access:** All roles (owner, admin, agent)

## Page Layout

Two-column layout (collapses to single column on mobile):

### Left Column
1. **Client picker** — shadcn `Combobox` (searchable). Only shows clients with a connected Instagram account. After selection, displays the Instagram username and account status (revoked/expired/missing permission warnings reusing `igAccountStatus` logic from `ScheduleButton`).
2. **Post type selector** — Tab group with four options: Feed, Reels, Stories, Carrossel. Default: Feed.
3. **Media upload** — Reuses `PostMediaGallery` component. Receives the `postId` of the auto-created draft post. For carrossel, allows multiple files with drag-reorder (existing behavior). For feed/reels/stories, a new `maxFiles` prop on `PostMediaGallery` limits upload to 1 file — if a file already exists, the upload button is hidden and the user must delete before replacing.

### Right Column
1. **Caption textarea** — `textarea` with DM Mono font, character counter (max 2,200). Hashtags and mentions visually highlighted.
2. **Instagram preview** — Mini phone-frame preview showing the selected media and caption as they would appear on Instagram. Shows the client's IG username and profile picture.
3. **Publish button** — "Publicar agora" button styled with Instagram pink (`#E1306C`). Opens the same confirmation `AlertDialog` with progress bar used in `ScheduleButton`.

### Page Header
- Title: "Post Express" (Playfair Display, same style as other page titles)
- Subtitle: "Publique rapidamente no Instagram"

## Data Flow

### Draft Creation (on client selection)

When the user selects a client:

1. Create a `Workflow` via `addWorkflow()`:
   - `cliente_id`: selected client
   - `titulo`: `"Post Express - {clientName} - {DD/MM/YYYY}"`
   - `status`: `'ativo'`
   - One auto-completed etapa
2. Create a `WorkflowPost` via `addWorkflowPost()`:
   - `workflow_id`: from step 1
   - `status`: `'rascunho'`
   - `tipo`: selected post type (default `'feed'`)
   - `titulo`: `"Post Express"`
   - `ordem`: 0

The `postId` is then passed to `PostMediaGallery` for media upload.

If the user changes the selected client, delete the current draft (workflow + post + media) and create a new one for the new client.

### Publishing (on button click)

1. Update the `WorkflowPost`: set `status` to `'aprovado_cliente'`, `ig_caption` to the textarea value
2. Call `publishInstagramPostNow(postId)` — same function used by the workflow drawer's "Publicar agora"
3. On success (`status: 'postado'`): show success toast with a link to view the post in entregas, reset the form
4. On deferred (`status: 'agendado'`): show info toast ("Post sendo processado pelo Instagram")
5. On error: show error toast, keep the form state so the user can retry

### Post-Publish State

After successful publish, the form resets:
- Client picker clears
- Post type resets to Feed
- Media gallery empties
- Caption clears
- Draft workflow/post now has `status: 'postado'` — visible in entregas history

A "Ver post" link appears in the success toast, pointing to the entregas page with the workflow open.

## Orphan Draft Cleanup

Drafts are created eagerly on client selection. If the user navigates away without publishing, orphan records remain.

### Client-side cleanup
When the user navigates away from the Express Post page (via `useEffect` cleanup or `beforeunload`), delete the draft if:
- No media has been uploaded AND no caption has been written

If media was uploaded or caption was written, keep the draft (the user may return).

### Backend cron cleanup
A daily cron job (or addition to an existing cron) that:
- Finds workflows where `titulo LIKE 'Post Express%'` AND `status = 'ativo'`
- All associated posts have `status = 'rascunho'`
- `created_at` is older than 24 hours
- Deletes the workflow, posts, and associated R2 media files (via existing cascade/cleanup logic)

## Component Breakdown

### New Components
- **`ExpressPostPage.tsx`** — Page component at `apps/crm/src/pages/post-express/ExpressPostPage.tsx`. Owns form state, orchestrates draft creation and publish flow.

### Reused Components
- **`PostMediaGallery`** — from `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`. Used as-is with the draft `postId`.
- **`AlertDialog`** — from shadcn/ui. Same confirmation + progress bar pattern as `ScheduleButton`.
- **`publishInstagramPostNow`** — from `apps/crm/src/services/instagram.ts`. Called directly.
- **`addWorkflow` / `addWorkflowPost` / `updateWorkflowPost`** — from `apps/crm/src/store.ts`.

### Reused Logic
- `igAccountStatus` computation (revoked/expired/canPublish) — same pattern as `WorkflowDrawer.tsx`
- Publish confirmation dialog with progress bar — same pattern as `ScheduleButton.tsx`

## Validation & Edge Cases

| Condition | Behavior |
|-----------|----------|
| No clients with Instagram | Empty state: "Nenhum cliente com Instagram conectado" + link to client settings |
| Account revoked/expired | Warning banner + publish button disabled (same as `ScheduleButton`) |
| Missing publish permission | Warning banner + publish button disabled |
| No caption | Publish button disabled |
| No media uploaded | Publish button disabled |
| Carrossel with < 2 files | Publish button disabled, hint: "Carrossel precisa de pelo menos 2 arquivos" |
| Type switch with media | Switching from carrossel to single-media type: keep first file, warn if multiple were uploaded |
| Publish failure | Error toast, form preserved for retry |
| Double-click | Button disabled during publish (loading state) |
| User navigates away (no content) | Draft auto-deleted client-side |
| User closes browser (with content) | Cron cleans up after 24h |

## Styling

Follows the existing design system:
- Page background: `var(--bg-color)`
- Cards: `var(--card-bg)` with `border: 1px solid var(--border-color)`, `border-radius: 16px`
- Typography: Playfair Display for page title, DM Sans for labels/body, DM Mono for textarea and data
- Colors: `#E1306C` (Instagram pink) for publish button, `#eab308` (primary) for active type tab, `var(--danger)` for warnings
- Responsive: Two columns on desktop, single column stacked on mobile (breakpoint at 900px)
- Animations: `animate-up` on page load
