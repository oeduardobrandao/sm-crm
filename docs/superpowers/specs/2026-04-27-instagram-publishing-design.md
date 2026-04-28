# Instagram Post Publishing & Scheduling

Automated Instagram publishing for posts created and approved within the Mesaas CRM. Posts flow through creation → client approval → scheduling → publishing via Instagram's two-step container API.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cron architecture | Single edge function, two-phase | Matches existing `instagram-sync-cron` pattern; simple to maintain |
| Container timing | Create ~1h before publish, publish at scheduled time | Avoids 24h container expiry; gives retry window |
| Parallel processing | `Promise.allSettled` in batches of 5 | One failure doesn't block others; respects rate limits |
| Media URLs | Presigned R2 URLs at container creation time | No infrastructure changes; URL expires after Instagram downloads |
| Who schedules | CRM users; clients can auto-schedule via per-client opt-in | Agency keeps control; clients get convenience when trusted |
| Failure handling | Retry up to 3x silently; alert user only on final failure | Transient Meta errors are common; avoids noise |
| Carousel support | Included in v1 | Users already create carousel posts; excluding them would be a gap |
| Caption source | Dedicated `ig_caption` field | Users may want different text for Instagram vs. rich content shown to clients |
| API path style | Explicit `/{ig_user_id}/media` | Meta docs and Postman collection use explicit user ID for publishing |

## Database Changes

### New columns on `workflow_posts`

```sql
ALTER TABLE workflow_posts
  ADD COLUMN ig_caption text,
  ADD COLUMN instagram_permalink text,
  ADD COLUMN published_at timestamptz,
  ADD COLUMN publish_error text,
  ADD COLUMN publish_retry_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN publish_processing_at timestamptz;
```

- `ig_caption`: Plaintext caption for Instagram (max 2200 chars). Supports emojis, hashtags, line breaks.
- `instagram_permalink`: Full URL to the published Instagram post (stored after successful publish).
- `published_at`: Actual timestamp when the post was published (distinct from `scheduled_at`).
- `publish_error`: Last error message from a failed publish attempt.
- `publish_retry_count`: Incremented on each failure. Post moves to `falha_publicacao` immediately on any failure; cron retries up to 3 times from that status.
- `publish_processing_at`: Atomic lock claimed via conditional UPDATE. Prevents duplicate processing if cron runs overlap. Stale after 10 minutes.
- `instagram_container_id` and `instagram_media_id` already exist on this table.

### New status value

Add `falha_publicacao` to the status check constraint on `workflow_posts`. Full status flow:

```
rascunho → revisao_interna → aprovado_interno → enviado_cliente
  → aprovado_cliente → agendado → postado
                                ↓
                          falha_publicacao
                           (auto-retry up to 3×, then stays)
```

Every failure moves the post to `falha_publicacao` immediately. The cron retries posts in `falha_publicacao` with `publish_retry_count < 3`. After 3 failures the post stays in `falha_publicacao` for manual intervention.

### New column on `clientes`

```sql
ALTER TABLE clientes
  ADD COLUMN auto_publish_on_approval boolean NOT NULL DEFAULT false;
```

When true and a client approves a post that passes all schedule validations (see below), the post moves directly to `agendado` instead of `aprovado_cliente`.

## OAuth Scope Change

The Instagram connect flow must add `instagram_business_content_publish` to the requested scopes. In `instagram-integration/index.ts` line 186, the scope becomes:

```
scope=instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish
```

Existing connected accounts will need to **reauthorize** (disconnect + reconnect) to gain publishing permission. The schedule endpoint must verify the token has publishing permission before allowing `agendado` status.

## Edge Functions

### `instagram-publish-cron` (new)

Single cron edge function, invoked every 5 minutes via Supabase cron with `x-cron-secret` auth.

All phases use an **atomic claim lock** via a Supabase RPC (`claim_posts_for_publishing`) to prevent duplicate processing:

```sql
-- RPC: claim_posts_for_publishing(phase text)
-- Uses a CTE to atomically claim posts, then joins related data
WITH claimed AS (
  SELECT wp.id
  FROM workflow_posts wp
  WHERE <phase-specific conditions>
    AND (wp.publish_processing_at IS NULL
         OR wp.publish_processing_at < now() - interval '10 minutes')
  FOR UPDATE OF wp SKIP LOCKED
  LIMIT 25
),
updated AS (
  UPDATE workflow_posts
  SET publish_processing_at = now()
  WHERE id IN (SELECT id FROM claimed)
  RETURNING *
)
SELECT u.*, ia.encrypted_access_token, ia.instagram_user_id
FROM updated u
JOIN workflows w ON w.id = u.workflow_id
JOIN clientes c ON c.id = w.cliente_id
JOIN instagram_accounts ia ON ia.client_id = c.id;
```

The CTE claims only `workflow_posts` rows (`FOR UPDATE OF wp`), then joins account data in a non-locking read.

**Phase 1 — Container creation**:

Conditions:
```sql
wp.status = 'agendado'
AND wp.scheduled_at <= now() + interval '1 hour'
AND wp.instagram_container_id IS NULL
```

No lower bound on `scheduled_at` — catches both upcoming posts (T-60 min) and overdue posts missed while cron was down.

For each claimed post:
1. Generate presigned R2 URLs for all media (2h TTL).
2. **Single image**: `POST https://graph.instagram.com/{ig_user_id}/media` with `image_url` + `caption`.
3. **Single video/reel**: `POST https://graph.instagram.com/{ig_user_id}/media` with `video_url` + `caption` + `media_type=REELS`.
4. **Carousel**: Create child containers first (`POST /{ig_user_id}/media` with `is_carousel_item=true` for each media item), then create parent container (`POST /{ig_user_id}/media` with `media_type=CAROUSEL` + `children` array + `caption`).
5. Store `instagram_container_id` on the post. Clear `publish_processing_at`.

On failure: set status to `falha_publicacao`, increment `publish_retry_count`, set `publish_error`. Clear `publish_processing_at`.

**Phase 2 — Publishing**:

Conditions:
```sql
wp.status = 'agendado'
AND wp.instagram_container_id IS NOT NULL
AND wp.scheduled_at <= now()
```

For each claimed post:
1. Check container status: `GET https://graph.instagram.com/{container_id}?fields=status_code` — must be `FINISHED`. If `IN_PROGRESS`, release lock (clear `publish_processing_at`) and skip; will be retried next cron run. If `ERROR`, treat as failure.
2. `POST https://graph.instagram.com/{ig_user_id}/media_publish` with `creation_id={container_id}`.
3. **Immediately** store `instagram_media_id` and set status to `postado`, `published_at = now()`. This makes the publish idempotent — if the next steps fail, the post is already marked as published and won't be re-published.
4. Fetch permalink (best-effort): `GET https://graph.instagram.com/{media_id}?fields=permalink`. Store in `instagram_permalink` if successful. If this fails, leave `instagram_permalink` null — a background recovery or the next sync can fill it in.
5. Clear `publish_processing_at`, `publish_error`, `publish_retry_count`.

On failure (steps 1-2 only): set status to `falha_publicacao`, increment `publish_retry_count`, set `publish_error`. Clear `publish_processing_at`.

**Phase 3 — Retries**:

Conditions:
```sql
wp.status = 'falha_publicacao'
AND wp.publish_retry_count < 3
```

Determine which sub-phase to retry based on post state:
- **No `instagram_container_id`**: Re-attempt container creation (Phase 1 logic). On success, store container ID, move status back to `agendado`. Phase 2 will publish on the same or next cron run.
- **Has `instagram_container_id` but no `instagram_media_id`**: Re-attempt publishing (Phase 2 logic). On success, set `postado`, `instagram_media_id`, `published_at`, fetch permalink.

On failure: increment `publish_retry_count` again. Post stays in `falha_publicacao`.

**Parallel processing**: Each phase collects all claimed posts, then processes in batches of 5 using `Promise.allSettled`. Rate-limit delay of 1s between batches.

### `instagram-publish` (new)

REST endpoint for CRM user actions. Auth: JWT + workspace ownership verification.

**`POST /schedule/:postId`** — Schedule validation (shared logic, also used by auto-publish):
1. Post must have `scheduled_at` (date+time, stored as UTC).
2. Post must have `ig_caption` (non-empty).
3. Post must have at least one media file.
4. All media must pass compatibility checks (see Media Validation).
5. Client must have a connected Instagram account with an active, non-expired token.
6. Token must include `instagram_business_content_publish` permission.

If all pass: move status to `agendado`. If any fail: return 422 with descriptive error.

**`POST /retry/:postId`** — Reset `publish_retry_count` to 0, clear `publish_error` and `instagram_container_id` (expired containers), move status back to `agendado`.

**`POST /cancel/:postId`** — Move status back to `aprovado_cliente`. Clear `instagram_container_id` (container will expire on its own).

### `hub-approve` (modified)

After inserting the approval record and updating status to `aprovado_cliente`, run the **same schedule validation logic** used by `POST /schedule/:postId`:

```typescript
if (action === 'aprovado') {
  const { data: client } = await svc.from('clientes')
    .select('auto_publish_on_approval')
    .eq('id', clienteId)
    .single();

  if (client?.auto_publish_on_approval) {
    // Run full schedule validation: scheduled_at, ig_caption, media
    // compatibility, connected account, publish permission
    const validation = await validateForScheduling(svc, postId);
    if (validation.ok) {
      await svc.from('workflow_posts')
        .update({ status: 'agendado' })
        .eq('id', postId);
    }
    // If validation fails, post stays in aprovado_cliente silently.
    // Agency will see it needs manual scheduling.
  }
}
```

The `validateForScheduling` function is extracted and shared between `instagram-publish` and `hub-approve`.

### `hub-posts` (modified)

**PATCH handler**: Reject `scheduled_at` mutations when post status is `agendado`, `postado`, or `falha_publicacao`. Return 409 with message explaining the post must be cancelled first.

**GET handler**: Add the following fields to the response:
- `auto_publish_on_approval` from the client record (for auto-publish notice).
- On each post: `ig_caption`, `instagram_permalink`, `published_at`, `publish_error` (for status banners and "Ver no Instagram" link).
- Status values `postado` and `falha_publicacao` must be included in the response (currently filtered to a subset).

## Post Editing Lock

When a post reaches `agendado` status, the CRM must prevent edits that would invalidate the Instagram container:

- **Media changes** (add/remove/reorder): Blocked while `agendado`. User must cancel scheduling first.
- **`ig_caption` changes**: Blocked while `agendado`. Caption is baked into the container.
- **`scheduled_at` changes**: Blocked in both CRM and Hub while `agendado`.
- **Rich text content** (`conteudo`): Still editable (not sent to Instagram).
- **Post title** (`titulo`): Still editable (not sent to Instagram).

If a post has an `instagram_container_id` and is moved back to `aprovado_cliente` (via cancel), the container ID is cleared. A new container will be created when re-scheduled.

The WorkflowDrawer already has edit restrictions for `enviado_cliente` and `aprovado_cliente` statuses. Extend the same pattern to `agendado`: disable the media gallery upload/delete, disable the ig_caption textarea, disable the scheduled_at picker. Show a lock icon or tooltip: "Cancelar agendamento para editar."

## Media Validation

The schedule endpoint (`POST /schedule/:postId`) and auto-publish path validate media compatibility before allowing the post to become `agendado`.

### Format validation (by `mime_type` in `files` table)

| Mesaas accepts | Instagram accepts | Action at schedule time |
|---------------|-------------------|------------------------|
| JPEG | JPEG | Pass through |
| PNG | Not supported | Reject: "Imagens devem estar em formato JPEG" |
| WebP | Not supported | Reject: "Imagens devem estar em formato JPEG" |
| GIF | Not supported | Reject: "Imagens devem estar em formato JPEG" |
| MP4 | MP4 (H.264, AAC) | Pass through (assume compatible encoding) |
| MOV | MOV (H.264, AAC) | Pass through |
| WebM | Not supported | Reject: "Vídeos devem estar em formato MP4 ou MOV" |

### Dimension and size validation (from `files` table columns)

| Check | Constraint | Error message |
|-------|-----------|---------------|
| Image file size | Max 8 MB | "Imagem excede 8 MB (limite do Instagram)" |
| Image aspect ratio | Between 4:5 and 1.91:1 | "Proporção da imagem fora do permitido (4:5 a 1.91:1)" |
| Image min dimensions | 320×320 px | "Imagem muito pequena (mínimo 320×320)" |
| Video file size | Max 250 MB | "Vídeo excede 250 MB (limite do Instagram)" |
| Video duration | 3–90 seconds (Reels) | "Duração do vídeo fora do permitido (3–90 segundos)" |
| Video aspect ratio | Between 0.8:1 and 9:16 | "Proporção do vídeo fora do permitido" |

All checks use data already stored in the `files` table (`size_bytes`, `width`, `height`, `duration_seconds`). If any media item fails, the schedule request returns 422 with a list of all failing files and their specific errors.

Future improvement: server-side transcoding (out of scope for v1).

## CRM UI Changes

### Instagram Caption Field (WorkflowDrawer)

New textarea in each post's accordion section, positioned below the rich text editor. Visible only when the post's workflow belongs to a client with a connected Instagram account.

- Instagram icon + "Legenda do Instagram" label.
- Monospace font (`DM Mono`), matching form input styling.
- Character counter: `{count} / 2200`.
- Helper text: "Texto exato que será publicado no Instagram. Suporta emojis e hashtags."
- Auto-saved via debounce (same pattern as post title/content).
- Disabled with lock tooltip when status is `agendado`.

### Schedule Date+Time Input (WorkflowDrawer)

The existing `scheduled_at` date picker must be upgraded to a **date+time picker**. The input should:
- Show date and time (e.g., "28 abr 2026 · 10:00").
- Store as UTC `timestamptz` in the database.
- Display in the user's local timezone in the UI.
- Use shadcn `Popover` + `Calendar` + time select (the project uses shadcn/ui, not Ant Design).
- Disabled with lock tooltip when status is `agendado`.

### Schedule Button (WorkflowDrawer)

Positioned below the schedule date+time picker. Four states:

| State | Condition | Button |
|-------|-----------|--------|
| Ready | `aprovado_cliente` + has `scheduled_at` + `ig_caption` + compatible media | Primary yellow "Agendar publicação" |
| Missing | `aprovado_cliente` but missing requirements | Disabled + warning listing what's missing |
| Scheduled | `agendado` | Green "Agendado" badge + "Cancelar" outline button |
| Failed | `falha_publicacao` | Red "Tentar novamente" button + error message |

Calls `instagram-publish` edge function endpoints.

### Auto-publish Toggle (Client Detail Page)

In the Instagram section of the client detail page (where the connected account is shown):
- Toggle switch: "Publicar automaticamente após aprovação"
- Description: "Quando o cliente aprovar, o post será agendado automaticamente se tiver data e legenda definidas."
- Updates `clientes.auto_publish_on_approval`.

## Hub UI Changes

### Hub API and Type Changes

**HubPost type** additions:
```typescript
interface HubPost {
  // ... existing fields ...
  status: '...' | 'agendado' | 'postado' | 'falha_publicacao';
  ig_caption: string | null;
  instagram_permalink: string | null;
  published_at: string | null;
  publish_error: string | null;
}
```

**Hub API response** additions:
- Client-level: `auto_publish_on_approval: boolean`.
- Post-level: `ig_caption`, `instagram_permalink`, `published_at`, `publish_error`.

### Post Card Caption Display

When `ig_caption` is set, the InstagramPostCard should display `ig_caption` as the caption preview instead of `conteudo_plain`. This ensures the client sees the exact text that will be published to Instagram during the approval flow.

### Post Card Status Banners

**Agendado state**: Green status banner at bottom of post card.
- Green dot + "Agendado para publicação" + date/time (localized from `scheduled_at`).
- Background: `#3ecf8e08`.

**Postado state**: Gold status banner at bottom of post card.
- Checkmark + "Publicado" + `published_at` timestamp (localized).
- "Ver no Instagram" link using `instagram_permalink` (opens in new tab). Hidden if `instagram_permalink` is null.
- Background: `#eab30808`.

### Auto-publish Approval Notice

When a client clicks "Aprovar" on a post and `auto_publish_on_approval` is true for their account:
- Yellow notice box below approval buttons.
- Lightning icon + "Ao aprovar, este post será publicado automaticamente no Instagram em {date} · {time}."
- Only shown when the post has `scheduled_at` and `ig_caption` set.

### Hub `scheduled_at` Mutation Guard

The hub-posts PATCH endpoint rejects `scheduled_at` changes when status is `agendado`, `postado`, or `falha_publicacao`. The Hub UI hides or disables the drag/reschedule affordance for posts in these statuses.

### Postagens Page Status Groups

The editorial calendar (PostagensPage) already groups by status. New statuses appear with:
- `agendado`: Teal dot, shows next scheduled time.
- `postado`: Gold dot. Note: Hub types.ts currently uses `publicado` as display name but the DB constraint value is `postado` — keep using `postado` consistently.
- `falha_publicacao`: Red dot, shows error message from `publish_error`.

## Instagram API Details

All publishing endpoints use the explicit `{ig_user_id}` path (from `instagram_accounts.instagram_user_id`), matching Meta's documentation and Postman collection.

### Container Creation — Single Image

```
POST https://graph.instagram.com/{ig_user_id}/media
  image_url={presigned_r2_url}
  caption={ig_caption}
  access_token={decrypted_token}
```

### Container Creation — Single Video/Reel

```
POST https://graph.instagram.com/{ig_user_id}/media
  video_url={presigned_r2_url}
  caption={ig_caption}
  media_type=REELS
  access_token={decrypted_token}
```

After creation, poll `GET https://graph.instagram.com/{container_id}?fields=status_code` until `FINISHED` (video processing can take minutes). Max 25 polls at 5s intervals (~2 min). If still `IN_PROGRESS`, release lock and skip; will be retried next cron run.

### Container Creation — Carousel

Step 1: Create child containers (no caption):
```
POST https://graph.instagram.com/{ig_user_id}/media
  image_url={url}  (or video_url for video items)
  is_carousel_item=true
  access_token={token}
```

Step 2: Create parent container:
```
POST https://graph.instagram.com/{ig_user_id}/media
  media_type=CAROUSEL
  children={child_id_1},{child_id_2},...
  caption={ig_caption}
  access_token={token}
```

### Publishing

```
POST https://graph.instagram.com/{ig_user_id}/media_publish
  creation_id={container_id}
  access_token={token}
```

Returns `{ id: "instagram_media_id" }`.

**Idempotency**: `instagram_media_id` is stored immediately after a successful `media_publish` call, and status is set to `postado` in the same DB update. Permalink fetch is a separate best-effort step. This ensures a post is never re-published even if subsequent steps fail.

### Permalink Retrieval

```
GET https://graph.instagram.com/{instagram_media_id}?fields=permalink&access_token={token}
```

Returns `{ permalink: "https://www.instagram.com/p/..." }`. Stored in `instagram_permalink`. If this call fails, `instagram_permalink` remains null — the "Ver no Instagram" link is hidden in the UI, and the permalink can be backfilled by the sync cron or a manual retry.

### Required Permission

`instagram_business_content_publish` — must be added to the OAuth scope and approved via Meta App Review.

### Limits

- 50 published posts per 24-hour rolling window per account.
- Containers expire 24 hours after creation.
- Long-lived tokens last 60 days (refresh logic already exists in `instagram-refresh-cron`).
- Image: JPEG only, max 8 MB, aspect ratio 4:5 to 1.91:1, min 320×320 px.
- Video: MP4 or MOV, H.264 + AAC, max 250 MB, 3–90 seconds, aspect ratio 0.8:1 to 9:16.

## Out of Scope

- Stories publishing (product scope decision for v1; may revisit later).
- Editing a post after publishing (Instagram API limitation).
- Bulk scheduling UI (schedule one post at a time from WorkflowDrawer).
- Push notifications for publish success/failure (in-app status only for v1).
- Server-side media transcoding (PNG→JPEG, WebM→MP4). Users must upload compatible formats.
