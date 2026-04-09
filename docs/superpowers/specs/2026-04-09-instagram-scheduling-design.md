# Instagram Post Scheduling — Design Spec

## Overview

Enable scheduling Instagram posts directly from the CRM. Users can either pick an existing approved `workflow_post` and schedule it to the client's connected Instagram account, or create a new post specifically for scheduling. Supports single image posts, carousels (up to 10 images/videos), and Reels.

## Constraints & API Limitations

- **Instagram Content Publishing API** (Graph API) supports: single image, carousel, Reels, captions, scheduled publishing, cover images for Reels, user/location/collaborator tagging.
- **Music is NOT supported** by the API. Users must add music manually in the Instagram app. The UI surfaces a "music note" reminder field; when filled, a warning is displayed.
- **Stories scheduling is NOT supported** via the API.
- Instagram account must be a **Business or Creator** account connected to a Facebook Page.
- Media must be hosted at a **publicly accessible URL**.
- `instagram_content_publish` permission required (Meta App Review).
- Rate limit: **25 published posts per 24 hours** per account.
- Scheduling window: **10 minutes to 75 days** in the future.
- Scheduled containers **cannot be edited** — only deleted and recreated.

## Database Changes

### Columns added to `workflow_posts`

| Column | Type | Notes |
|---|---|---|
| `scheduled_at` | timestamptz | When to publish to Instagram |
| `instagram_container_id` | text | Meta container ID after creation |
| `instagram_media_id` | text | Meta media ID after publishing |
| `music_note` | text | Optional reminder for manual music addition |
| `cover_url` | text | Cover image URL for Reels |

No changes to the status enum — `agendado` and `postado` already exist.

### New table: `post_media`

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | PK |
| `post_id` | bigint | FK → workflow_posts(id) ON DELETE CASCADE |
| `storage_path` | text | Path in Supabase Storage bucket |
| `public_url` | text | Full public URL |
| `media_type` | text | `image` or `video` |
| `position` | integer | Order for carousels |
| `created_at` | timestamptz | default now() |

RLS: workspace members can access rows where the parent post's `conta_id` matches their workspace. Service role bypass for edge functions.

## Storage

- New **public** Supabase Storage bucket: `post-media`
- Path structure: `{conta_id}/{post_id}/{filename}`
- Max file sizes (enforced on frontend): **8 MB for images**, **100 MB for videos**
- Accepted formats: JPEG/PNG for images, MP4 for videos
- RLS: workspace members can upload/delete within their `conta_id` prefix
- **Temporary staging**: media is deleted after successful publish to Instagram (Instagram hosts its own copy)

## Edge Functions

### New: `instagram-publish`

Handles the full publishing flow. All endpoints require authenticated workspace member with access to the post's workspace.

#### Endpoints

**`POST /schedule/{postId}`**
1. Validates the post exists and belongs to user's workspace
2. Reads media from `post_media` table
3. Creates container(s) on Meta API based on post `tipo`:
   - **feed (single image)**: one container with `image_url` + `caption` → schedule
   - **carrossel**: create child containers for each media item → create carousel parent container → schedule
   - **reels**: create video container with `video_url`, optional `cover_url` / `thumb_offset` + `caption` → schedule
4. Sets `scheduled_publish_time` on the container
5. Stores `instagram_container_id` on the post
6. Updates post status to `agendado`

**`POST /publish-now/{postId}`**
Same flow as schedule but publishes immediately. Updates status to `postado`. Triggers media cleanup.

**`DELETE /cancel/{postId}`**
Deletes the unpublished container on Meta API. Resets post status to `aprovado_cliente`. Clears `instagram_container_id` and `scheduled_at`.

**`GET /status/{postId}`**
Checks container status on Meta API. Useful for video processing which is async — returns status like `IN_PROGRESS`, `FINISHED`, `ERROR`.

### New: `instagram-publish-cron`

Runs every **1 hour**. Responsibilities:
1. Finds posts with status `agendado` where `scheduled_at` has passed
2. Confirms publish status with Meta API
3. Updates status to `postado` and stores `instagram_media_id`
4. **Cleans up**: deletes media from `post-media` storage bucket and removes `post_media` rows

## Frontend — Scheduling UI

### "Schedule to Instagram" button

Appears on posts with status `aprovado_cliente`. Opens a modal containing:

1. **Media section**
   - Drag-and-drop upload area
   - For `carrossel`: multi-file upload with drag-to-reorder, up to 10 items
   - For `reels`: video upload + optional cover image upload
   - Thumbnails with remove button
   - File size/format validation before upload

2. **Caption** — pre-filled from `conteudo_plain` if available, editable textarea with character count (2,200 max)

3. **Music note** — optional text field labeled "Lembrete de música (adicionar manualmente no app)". When filled, shows a warning that the post needs manual music addition in the Instagram app.

4. **Date/time picker** — minimum 10 minutes in the future, maximum 75 days. Defaults to next hour.

5. **Action buttons**:
   - "Agendar" — uploads media to storage, calls edge function to schedule, status → `agendado`
   - "Publicar agora" — same flow but publishes immediately, status → `postado`
   - "Cancelar"

### "Create new post for scheduling" path

Same modal but also includes:
- `tipo` selector (feed / reels / carrossel)
- Caption starts empty
- Must select an existing workflow to attach the post to (since `workflow_id` is NOT NULL)
- Creates a `workflow_post` with status `agendado` directly (skips approval flow)

### Scheduled post display

Posts with status `agendado` show:
- A badge with the scheduled date/time
- A "Cancelar agendamento" action that calls the cancel endpoint and resets status

## Security

- Meta API calls happen exclusively in edge functions (tokens never exposed to frontend)
- Token decryption uses the existing `TOKEN_ENCRYPTION_KEY` setup
- All endpoints validate that the authenticated user has workspace access to the post
- RLS on `post_media` and storage bucket scoped to workspace `conta_id`

## Flow Summary

```
User picks approved post (or creates new)
  → Opens scheduling modal
  → Uploads media to Supabase Storage (post-media bucket)
  → Sets caption, optional music note, schedule time
  → Clicks "Agendar"
    → Frontend calls POST /schedule/{postId}
    → Edge function creates Meta container(s) with scheduled_publish_time
    → Post status → agendado
  → Hourly cron checks completed schedules
    → Confirms Meta publish → status → postado
    → Deletes media from storage (cleanup)
```
