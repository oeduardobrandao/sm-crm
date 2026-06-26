# Image uploads for Ideas — Design

**Date:** 2026-06-26
**Status:** Approved (ready for implementation plan)

## Goal

Let both **clients** (Hub portal) and **internal users** (CRM) attach images to an idea
(`ideias`). Ideas today carry only `titulo`, `descricao`, and a `links text[]`. We add a
small image gallery per idea, reusing the existing R2 file infrastructure (quota,
thumbnails, reference-counting, cleanup cron) rather than inventing a parallel media path.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Who can upload | Both Hub clients **and** CRM internal users |
| Images per idea | Multiple (gallery), **max 10** |
| Per-image size cap | **25 MB** |
| Allowed types | Images only: `image/jpeg`, `image/png`, `image/webp`, `image/gif` |
| Storage architecture | Reuse the `files` infra (quota + thumbnails + cleanup) |
| Lock behavior | Image add/remove is **NOT** gated by the idea lock — clients may add/remove images even after the agency comments/reacts or the status leaves `nova`. Only the text PATCH (`titulo`/`descricao`/`links`) stays lock-gated. |

## Non-goals

- No video/document attachments on ideas (images only).
- No drag-to-reorder beyond a stored `sort_order` (insertion order is fine for v1).
- No "cover" concept (ideas don't need a cover like posts do).
- No changes to existing post media, file manager, or the lock rules for text edits.

---

## 1. Data model

New join table `ideia_files`, mirroring `post_file_links` but treating images as
**owned by the idea** (not shared, reusable file-manager assets).

```sql
-- supabase/migrations/20260626000001_ideia_files.sql
CREATE TABLE ideia_files (
  id          bigserial PRIMARY KEY,
  ideia_id    uuid   NOT NULL REFERENCES ideias(id)     ON DELETE CASCADE,
  file_id     bigint NOT NULL REFERENCES files(id)      ON DELETE CASCADE,
  conta_id    uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sort_order  int    NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ideia_files_unique ON ideia_files (ideia_id, file_id);
CREATE INDEX ideia_files_ideia_idx ON ideia_files (ideia_id);

ALTER TABLE ideia_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY ideia_files_tenant_all ON ideia_files
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY ideia_files_service_role_bypass ON ideia_files
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Notes:
- `file_id ... ON DELETE CASCADE` (vs `post_file_links`' `ON DELETE RESTRICT`) because
  idea images are owned by the idea; deleting the underlying file row should clean up the
  link too.
- Idea images are inserted with `folder_id = NULL`, so they never appear in the client's
  file-manager folder tree.

### Cleanup wiring (the reason we chose the `files` infra)

Two trigger pieces — one reused, one new:

1. **Reuse** the existing `file_update_reference_count()` trigger function — attach it to
   `ideia_files` for INSERT and DELETE so `files.reference_count` stays accurate:

   ```sql
   CREATE TRIGGER trg_ideia_file_ref_count_ins
     AFTER INSERT ON ideia_files
     FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();
   CREATE TRIGGER trg_ideia_file_ref_count_del
     AFTER DELETE ON ideia_files
     FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();
   ```

2. **New** orphan-cleanup trigger on `ideia_files` DELETE — if the file has no remaining
   references anywhere, delete the `files` row. Checks references directly (order-
   independent of the ref-count trigger):

   ```sql
   CREATE OR REPLACE FUNCTION ideia_file_cleanup_orphan() RETURNS trigger
   LANGUAGE plpgsql SECURITY DEFINER AS $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM ideia_files     WHERE file_id = OLD.file_id)
        AND NOT EXISTS (SELECT 1 FROM post_file_links WHERE file_id = OLD.file_id) THEN
       DELETE FROM files WHERE id = OLD.file_id;
     END IF;
     RETURN OLD;
   END;
   $$;

   CREATE TRIGGER trg_ideia_file_cleanup_orphan
     AFTER DELETE ON ideia_files
     FOR EACH ROW EXECUTE FUNCTION ideia_file_cleanup_orphan();
   ```

Deleting the `files` row reuses the **existing** lifecycle: `file_enqueue_delete` queues
the R2 object into `file_deletions` (drained by `post-media-cleanup-cron`), and
`file_update_used_bytes` decrements `workspaces.storage_used_bytes`.

This single mechanism covers **every** removal path with no R2/quota leaks:
- remove one image → `ideia_files` row deleted → file cleaned up;
- delete an idea → cascade deletes `ideia_files` → trigger fires per row → files cleaned up;
- delete a client → cascade `clientes → ideias → ideia_files` → trigger → files cleaned up.

The guard `NOT EXISTS post_file_links` protects the rare case where an image happens to
also be linked to a post (it won't be deleted out from under the post).

---

## 2. Upload flow

Same 3-step R2 pattern already used for post media:

```
1. request presigned PUT URL  (server: quota check + r2_key allocation)
2. PUT file (+ thumbnail) directly to R2
3. finalize: file_insert_with_quota + insert ideia_files link  →  returns signed GET URL
```

Constraints enforced server-side:
- MIME in `{image/jpeg, image/png, image/webp, image/gif}` → else 415.
- `0 < size_bytes <= 25 MB` → else 400.
- Workspace storage quota (`effectivePlanLimit(..., 'storage_quota_bytes')`) → else 413
  `quota_exceeded` (reuses `file_insert_with_quota` + the pre-check from `file-upload-url`).
- Per-idea count: reject the presign/finalize if the idea already has 10 images → 409.

Client-side (both apps): generate a WebP thumbnail + blur placeholder before upload, exactly
like `apps/crm/src/services/postMedia.ts` (`generateImageThumbnail`, `generateBlurDataUrl`,
`probeImage`).

### Auth split — shared core, two thin wrappers

The Hub is **token-authed** (no Supabase user); the CRM is **JWT-authed**. Core logic is
factored into a shared module so the two auth contexts don't duplicate it:

**`supabase/functions/_shared/ideia-media.ts`** (pure logic, given `{conta_id, cliente_id}`):
- `buildPresign({ db, conta_id, cliente_id, ideia_id, filename, mime_type, size_bytes, thumbnail })`
  — validates mime/size, enforces the 10-image cap, runs the quota pre-check, allocates the
  `contas/{conta_id}/files/{uuid}.{ext}` key(s), returns presigned PUT URL(s) + `file_id` + `r2_key`(s).
- `finalizeUpload({ db, conta_id, cliente_id, ideia_id, file_id, r2_key, ... })`
  — verifies the idea belongs to the client/workspace, `headObject` size/type check,
  `file_insert_with_quota` (folder_id NULL), inserts the `ideia_files` link, persists
  `blur_data_url`, returns the signed GET URL.
- `listIdeiaImages({ db, ideia_id, signUrl })` — returns `[{ id (link id), file_id, url,
  thumbnail_url, blur_data_url, width, height, sort_order }]`.
- `removeIdeiaImage({ db, conta_id, cliente_id, ideia_id, file_id })` — verifies ownership,
  deletes the `ideia_files` row (cleanup trigger handles the rest).

**Hub wrapper — extend `supabase/functions/hub-ideias/handler.ts`** (token-authed, resolves
`conta_id`/`cliente_id` from `resolveHubToken`):
- `POST   /hub-ideias/upload-url`            → `buildPresign`
- `POST   /hub-ideias/:id/files`             → `finalizeUpload`
- `DELETE /hub-ideias/:id/files/:fileId`     → `removeIdeiaImage`
- `GET    /hub-ideias` also returns each idea's images (see §3).
- These paths **skip `checkLock`** (images are not lock-gated).

**CRM wrapper — new `supabase/functions/ideia-media-manage/`** (JWT-authed, resolves
`conta_id` from `profiles`; mirrors `post-media-manage`):
- `GET    /ideia-media-manage?ideia_id=`     → `listIdeiaImages`
- `POST   /ideia-media-manage`               → `buildPresign`
- `POST   /ideia-media-manage/:id/files`     → `finalizeUpload` (or single finalize body)
- `DELETE /ideia-media-manage/:fileId?ideia_id=` → `removeIdeiaImage`

Both wrappers must verify workspace/client ownership before any read or mutation
(`conta_id` match, and `cliente_id` match for the Hub).

> Deploy note: `hub-ideias` and `ideia-media-manage` (hub/token + any custom auth) deploy
> with `--use-api`; `hub-ideias` keeps `--no-verify-jwt` as today.

---

## 3. Reads / display

### Backend reads
- `hub-ideias` GET: extend the select to join `ideia_files → files`, and sign each
  `r2_key`/`thumbnail_r2_key` with `signGetUrl(key, 3600)` (same as `hub-posts`). Returns an
  `images` array per idea.
- CRM `apps/crm/src/store/ideias.ts` `getIdeias`: rather than signing client-side (the CRM
  has no R2 creds), fetch signed URLs via `ideia-media-manage` GET per idea (or batch).
  Simplest v1: the `IdeiaDrawer` calls `listIdeiaImages` for the open idea via TanStack Query.

### Frontend types
- Hub `apps/hub/src/types.ts`: add `images: IdeiaImage[]` to `HubIdeia`.
- CRM `Ideia` type (in `@/store`): add an `images`/image-count field as needed.

```ts
interface IdeiaImage {
  id: number;            // ideia_files link id
  file_id: number;
  url: string;           // signed GET URL
  thumbnail_url: string | null;
  blur_data_url: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
}
```

### Hub UI — `apps/hub/src/pages/IdeiasPage.tsx`
- `IdeiaCard`: render a thumbnail gallery (small rounded thumbnails using `blur_data_url`
  as the placeholder); tapping a thumbnail opens the full image (lightbox or new tab).
  Because images are **not** lock-gated, the card shows an "add image" affordance and
  per-image remove buttons **even when `isMutable(ideia)` is false** — these are independent
  of the text edit/delete controls (which stay gated).
- `IdeiaModal`: in create/edit, an image picker that uploads on selection (or on save for a
  new idea — see open question O1), with thumbnail previews and remove.
- New Hub upload service `apps/hub/src/services/ideiaMedia.ts` mirroring the relevant parts
  of `postMedia.ts` (validate, probe, thumbnail, blur, presign → PUT → finalize), but
  token-authed against `hub-ideias` and image-only.

### CRM UI — `apps/crm/src/components/ideias/IdeiaDrawer.tsx`
- Add an "Imagens" section: gallery of current images + upload (file input, multi-select up
  to the remaining cap) + remove. Internal users can manage images regardless of status.
- Reuse `postMedia.ts` helpers where possible (thumbnail/blur/probe are generic); the
  presign/finalize calls target `ideia-media-manage`.

---

## 4. Security / rules recap

- CORS via `buildCorsHeaders(req)` (never `*`).
- Hub: every image op re-resolves the token and checks the idea's `cliente_id` +
  `conta_id` match the token. CRM: checks the idea's `conta_id` matches the profile.
- `r2_key` must start with `contas/{conta_id}/files/` (reuse the existing prefix check).
- No raw error details returned to clients; log internally, return generic messages.
- Image ops bypass the lock by design; the text PATCH lock is untouched.

---

## 5. Testing

**Deno (`supabase/functions/__tests__/`):**
- `_shared/ideia-media` helper: mime reject (415), size reject (>25 MB → 400), 10-image cap
  (409), quota_exceeded (413), ownership mismatch (wrong client/workspace → 404).
- `hub-ideias`: upload-url / finalize / delete happy paths under token auth; image ops
  succeed on a locked idea (status != `nova` or has agency comment) — proving
  lock-independence; GET returns signed `images`.
- `ideia-media-manage`: JWT happy paths + ownership 404s.
- Trigger behavior (DB-level or via handler test): removing the last `ideia_files` link
  deletes the `files` row and enqueues a `file_deletions` entry; an image also linked to a
  post is **not** deleted.

**Frontend (Vitest):**
- Hub `ideiaMedia` service: validation (mime/size), and the presign→PUT→finalize call
  sequence (mocked fetch/XHR).
- A render test that idea cards show images and the add/remove controls appear even when the
  idea is locked.

Run `npm run build` (tsc), `npm run test`, and `deno test supabase/functions/` before
pushing. CI also enforces eslint + prettier `format:check` + coverage + deno tests.

---

## Open questions (resolve during planning)

- **O1 — Upload timing for a *new* idea:** A new idea has no `id` until it's created, so its
  images can't be linked yet. Two options: (a) create the idea first, then upload (simplest:
  the modal saves the idea, then enables the image picker); (b) upload to a temp area and
  link on create. Recommend **(a)** for v1 — on "Nova ideia", save text first, then reveal
  the image picker; editing an existing idea uploads immediately.
- **O2 — CRM signed-URL read path:** confirm whether `getIdeias` should embed images for the
  list view or only the open drawer fetches them. Recommend **drawer-only** fetch for v1 to
  avoid signing URLs for every idea on every list load.
