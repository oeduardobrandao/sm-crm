# Inline Image Paste in TipTap Editor

## Overview

Add inline image pasting and drag-and-drop to the TipTap post editor. Images are uploaded to Cloudflare R2 via the existing presigned URL pipeline and stored as R2 key references in the TipTap JSON content. The Hub's read-only editor renders these images for client approval.

## Requirements

- Users can paste (Ctrl+V / Cmd+V) or drag-and-drop images into the post editor
- Images upload to R2 via the existing `file-upload-url` / `file-upload-finalize` pipeline
- Max 10 MB per inline image; must be `image/*` mime type
- Images count against workspace storage quota
- Hub displays inline images in `RichTextContent` for posts (including text-only posts pending approval)
- No new database tables — reuses `files` + `post_file_links`

## Architecture

### Custom TipTap Node: `inlineImage`

A custom TipTap node extension registered in both the CRM editor and Hub read-only editor.

**Attributes:**
- `r2Key` (string, required) — stable R2 object key, persisted in `conteudo` JSON
- `src` (string) — transient signed URL for display, resolved at load time (not persisted)
- `alt` (string, optional) — alt text
- `width` (number, optional) — original width for layout stability
- `height` (number, optional) — original height for layout stability
- `loading` (boolean) — true while upload is in progress (placeholder state)

**Stored JSON shape:**
```json
{
  "type": "inlineImage",
  "attrs": {
    "r2Key": "contas/{conta_id}/files/{uuid}.webp",
    "alt": "",
    "width": 800,
    "height": 600
  }
}
```

The `src` attribute is never persisted — it's resolved from `r2Key` at render time.

### Upload Flow

1. User pastes or drops an image file
2. Client validates: `image/*` mime type, <= 10 MB
3. Client generates blur data URL (`generateBlurDataUrl` from `postMedia.ts`)
4. Insert placeholder node with blur data URL as `src` and `loading: true`
5. Call `file-upload-url` edge function: `{ filename, mime_type, size_bytes }` — returns presigned PUT URL + `r2_key` + `file_id`
6. PUT image directly to R2 via presigned URL
7. Call `file-upload-finalize`: `{ file_id, r2_key, kind: 'image', post_id, mime_type, size_bytes, name, width, height }` — verifies upload, records in `files` table, links to post via `post_file_links`
8. Replace placeholder: set `r2Key`, resolve `src` to signed GET URL, remove `loading` flag
9. `onUpdate` fires — parent saves updated `conteudo` JSON

### Error Handling

- Upload failure: remove placeholder node, show `toast.error('Falha ao enviar imagem')`
- Quota exceeded: remove placeholder, show quota-specific error toast
- Network timeout: remove placeholder, show retry suggestion

### R2 Key Resolution

Both the CRM and Hub need to resolve `r2Key` attributes to signed GET URLs before rendering.

**Hub (`hub-posts` edge function):** After fetching posts, scan each post's `conteudo` JSON tree for `inlineImage` nodes, collect `r2Key` values, batch-generate signed GET URLs via `signGetUrl()`, and inject them as `src` attributes in the returned JSON.

**CRM (client-side resolution):** The CRM fetches posts directly from Supabase (not via edge function), so R2 keys are resolved client-side. When loading a post's `conteudo` into the editor, extract all `inlineImage` `r2Key` values, call the existing `file-manage` edge function (or a batch endpoint) to get signed GET URLs, and inject them as `src` before passing to TipTap. Alternatively, the `postMedia.ts` service can call `signGetUrl` via the same `callFn` pattern used for uploads.

### Hub Display

- `RichTextContent` component gets the `inlineImage` extension (read-only)
- Images render inline within the text flow, styled `max-width: 100%; border-radius: 8px`
- `TextPostCard` needs no special changes — it already renders `RichTextContent` with the post's `conteudo`
- No thumbnail extraction — inline images appear in the natural text flow

### Orphan Cleanup

- Inline image files are linked to posts via `post_file_links` (from `file-upload-finalize`)
- Deleting an inline image node from the editor removes the R2 key from `conteudo` but the file record persists
- Existing orphan cleanup logic (`listOrphanKeys` in `r2.ts`) handles eventual cleanup
- No immediate deletion on node removal

## Files to Create/Modify

### New Files
- `apps/crm/src/pages/entregas/components/InlineImageExtension.tsx` — custom TipTap node + paste/drop handlers
- `apps/hub/src/components/InlineImageReadonly.tsx` — read-only version for Hub rendering

### Modified Files
- `apps/crm/src/pages/entregas/components/PostEditor.tsx` — register `InlineImageExtension`, pass upload dependencies
- `apps/crm/src/services/postMedia.ts` — add `uploadInlineImage()` function reusing existing pipeline
- `apps/hub/src/components/RichTextContent.tsx` — register `InlineImageReadonly` extension
- `supabase/functions/hub-posts/handler.ts` — add R2 key resolution for `conteudo` inline images
- `apps/crm/src/store/posts.ts` or post-loading hook — add client-side R2 key resolution for `conteudo` inline images

### No Changes Needed
- No new database migrations
- No new edge functions
- No changes to `_shared/r2.ts`
- No changes to `file-upload-url` or `file-upload-finalize`

## Constraints

- Inline images are distinct from post gallery media (`PostMediaGallery`) — they live in the text content, not the media carousel
- R2 path follows existing pattern: `contas/{conta_id}/files/{uuid}.{ext}`
- Signed GET URLs expire after 1 hour (existing default) — acceptable for editing/viewing sessions
