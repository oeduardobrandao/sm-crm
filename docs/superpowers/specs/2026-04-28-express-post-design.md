# Express Post — Design Spec

## Goal

Let managers quickly publish an Instagram post (media + caption) without going through the full entregas workflow (content creation, internal review, client approval, scheduling). One page, one form, one click to publish.

## Architecture

Single-page form at `/post-express` inside the existing `AppLayout` (sidebar + protected route). Reuses the existing data model — auto-creates a lightweight `Workflow` + `WorkflowEtapa` + `WorkflowPost` on client selection so the publish pipeline, media upload, and post history all work unchanged. No new backend endpoints for the publish flow; the only new backend work is an orphan draft cleanup cron edge function.

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
2. **Media upload** — Reuses `PostMediaGallery` with a new optional `maxFiles` prop. When `maxFiles={1}`, the upload button/drop zone and file picker button are hidden once one file exists — the user must delete the existing file before uploading a replacement. When `maxFiles` is omitted, behavior is unchanged (unlimited, for carrossel). The prop gates three entry points: the file input, the drag-drop handler, and the `FilePickerModal` trigger.
3. **Detected post type** — Read-only badge below the media area showing the auto-detected Instagram type based on uploaded media: "Feed" (1 image), "Reels" (1 video), "Carrossel" (2+ files), or nothing when no media is uploaded. This matches the backend's actual decision logic in `handler.ts`, which ignores `WorkflowPost.tipo` and classifies by media count and kind.

### Right Column
1. **Caption textarea** — Plain `textarea` with DM Mono font and a character counter (max 2,200). No inline hashtag/mention highlighting (native textarea cannot do this without a contenteditable overlay, which is out of scope).
2. **Instagram preview** — Mini phone-frame preview showing the first uploaded media thumbnail and caption text. Shows the client's IG username and profile picture.
3. **Publish button** — "Publicar agora" button styled with Instagram pink (`#E1306C`). Opens the same confirmation `AlertDialog` with progress bar used in `ScheduleButton`.

### Page Header
- Title: "Post Express" (Playfair Display, same style as other page titles)
- Subtitle: "Publique rapidamente no Instagram"

## Data Flow

### Draft Creation (on client selection)

When the user selects a client:

1. Create a `Workflow` via `addWorkflow()`:
   - `cliente_id`: selected client ID
   - `titulo`: `"Post Express - {clientName} - {DD/MM/YYYY}"`
   - `status`: `'ativo'`
   - `etapa_atual`: `0`
   - `recorrente`: `false`
   - `modo_prazo`: `'padrao'`

2. Create a `WorkflowEtapa` via `addWorkflowEtapa()`:
   - `workflow_id`: from step 1
   - `ordem`: `0`
   - `nome`: `'Publicação'`
   - `prazo_dias`: `0`
   - `tipo_prazo`: `'corridos'`
   - `tipo`: `'padrao'`
   - `status`: `'concluido'`
   - `iniciado_em`: current ISO timestamp
   - `responsavel_id`: `null`

3. Create a `WorkflowPost` via `addWorkflowPost()`:
   - `workflow_id`: from step 1
   - `status`: `'rascunho'`
   - `tipo`: `'feed'` (default; updated to match detected type before publish)
   - `titulo`: `'Post Express'`
   - `conteudo`: `null`
   - `conteudo_plain`: `''`
   - `ordem`: `0`

The `postId` from step 3 is passed to `PostMediaGallery` for media upload.

If the user changes the selected client, delete the current draft via `removeWorkflow(workflowId)` (cascades to etapas, posts, post_file_links, and folders via DB constraints/triggers). Then create a new draft for the new client. Note: cascading `post_file_links` deletion decrements `files.reference_count` but does not delete `files` rows or R2 objects — the orphan cron handles that (see Orphan Draft Cleanup below).

### Publishing (on button click)

1. Determine the detected type from uploaded media: 2+ files → `'carrossel'`, 1 video → `'reels'`, 1 image → `'feed'`
2. Update the `WorkflowPost` via `updateWorkflowPost(postId, { status: 'aprovado_cliente', ig_caption: captionText, tipo: detectedType })`
3. Call `publishInstagramPostNow(postId)` — same function used by the workflow drawer
4. Handle result:
   - **`status: 'postado'`**: Set `Workflow.status` to `'concluido'` via `updateWorkflow(workflowId, { status: 'concluido' })`. Show success toast: "Post publicado no Instagram!" with an action link "Ver post" pointing to `/entregas` (the workflow will appear in the Concluded view). Reset the form.
   - **`status: 'agendado'`** (deferred — media still processing on Meta's side): Set `Workflow.status` to `'concluido'`. Show info toast: "Post sendo processado pelo Instagram. Acompanhe na página de entregas." with an action link to `/entregas`. Reset the form. The post is now in the backend pipeline and will be published by the cron.
   - **Error**: Show error toast with the error message. Keep the form state (client, media, caption) intact so the user can retry.

### Post-Publish Form Reset

After success or deferred result, the form resets:
- Client picker clears
- Media gallery empties (the draft `postId` is gone)
- Caption clears
- Internal draft state (`workflowId`, `postId`) nulled

The published workflow has `status: 'concluido'` and is visible in the Entregas Concluded view, grouped under the client.

## Orphan Draft Cleanup

Drafts are created eagerly on client selection. If the user navigates away without publishing, orphan records remain.

### Client-side cleanup (SPA navigation only)

A `useEffect` cleanup function runs when the `ExpressPostPage` component unmounts (SPA navigation away). If the current draft has no uploaded media (check via `PostMediaGallery`'s `onChange` callback tracking media count) AND no caption text, call `removeWorkflow(workflowId)` to delete the draft. This is fire-and-forget — if the delete fails (e.g., network issue), the backend cron catches it later.

No `beforeunload` handler — async Supabase deletes cannot reliably complete during browser close/refresh. The backend cron is the reliable cleanup path.

### Backend cron cleanup

A new edge function `express-post-cleanup-cron` (or addition to an existing daily cron) that runs daily:

1. Query: workflows where `titulo LIKE 'Post Express -%'` AND `status = 'ativo'` AND all associated `workflow_posts` have `status = 'rascunho'` AND `workflows.created_at < NOW() - INTERVAL '24 hours'`
2. For each matching workflow:
   a. Query `post_file_links` joined to `files` for all posts in the workflow to get `file_id`s
   b. Delete the workflow via SQL `DELETE FROM workflows WHERE id = ?` (cascades to etapas, posts, post_file_links, folders)
   c. For each `file_id` from step (a): check if `files.reference_count` is now 0, and if so, delete the `files` row — which triggers `trg_file_enqueue_delete` to queue the R2 key for deletion by the existing `post-media-cleanup-cron`
3. Authenticate via `x-cron-secret` header (standard cron auth pattern)

This ensures R2 storage is not leaked by orphan drafts.

## Component Breakdown

### New Components
- **`ExpressPostPage.tsx`** — Page component at `apps/crm/src/pages/post-express/ExpressPostPage.tsx`. Owns form state (selected client, caption, detected type), orchestrates draft creation, publish flow, and cleanup.

### Modified Components
- **`PostMediaGallery`** — Add optional `maxFiles?: number` prop. When set and `media.length >= maxFiles`, hide the upload drop zone, file input trigger, and `FilePickerModal` button. No other behavior changes — existing callers are unaffected since the prop is optional.

### Reused Components (unchanged)
- **`AlertDialog`** — from shadcn/ui. Same confirmation + progress bar pattern as `ScheduleButton`.
- **`publishInstagramPostNow`** — from `apps/crm/src/services/instagram.ts`. Called directly.
- **`addWorkflow` / `addWorkflowEtapa` / `addWorkflowPost` / `updateWorkflowPost` / `removeWorkflow`** — from `apps/crm/src/store.ts`.

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
| Carrossel detected (2+ files) | No minimum enforcement beyond Instagram's own — user can upload 2+ files freely |
| Single file uploaded | Detected type shown as "Feed" (image) or "Reels" (video) |
| Publish failure | Error toast, form preserved for retry |
| Double-click | Button disabled during publish (loading state) |
| User navigates away (no content) | Draft deleted via useEffect cleanup (fire-and-forget) |
| User navigates away (has content) | Draft kept; backend cron deletes after 24h if still rascunho |
| User closes browser tab | No client-side cleanup; backend cron handles it |
| Client selection change | Previous draft deleted, new draft created |

## Styling

Follows the existing design system:
- Page background: `var(--bg-color)`
- Cards: `var(--card-bg)` with `border: 1px solid var(--border-color)`, `border-radius: 16px`
- Typography: Playfair Display for page title, DM Sans for labels/body, DM Mono for textarea
- Colors: `#E1306C` (Instagram pink) for publish button, `#eab308` (primary) for active states, `var(--danger)` for warnings
- Detected type badge: subtle background tint matching the type (e.g., feed = primary, reels = pink, carrossel = teal)
- Responsive: Two columns on desktop (`grid-template-columns: 1fr 1fr`), single column stacked on mobile (breakpoint at 900px)
- Animations: `animate-up` on page load
