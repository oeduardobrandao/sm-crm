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

-- Prerequisite UNIQUE constraints so the composite FKs below can reference them.
-- (Postgres FKs require a UNIQUE/PK constraint, not merely a unique index.)
-- `id` is already each table's PK, so these composite uniques are cheap and always hold.
ALTER TABLE ideias ADD CONSTRAINT ideias_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE files  ADD CONSTRAINT files_id_conta_uq       UNIQUE (id, conta_id);

CREATE TABLE ideia_files (
  id          bigserial PRIMARY KEY,
  ideia_id    uuid   NOT NULL,
  file_id     bigint NOT NULL,
  conta_id    uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sort_order  int    NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Composite FKs pin the idea AND the file to the link's own workspace, making
  -- cross-tenant links structurally impossible (defense-in-depth beyond RLS).
  CONSTRAINT ideia_files_ideia_fk
    FOREIGN KEY (ideia_id, conta_id) REFERENCES ideias(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT ideia_files_file_fk
    FOREIGN KEY (file_id, conta_id)  REFERENCES files(id, conta_id)      ON DELETE CASCADE
);

CREATE UNIQUE INDEX ideia_files_unique ON ideia_files (ideia_id, file_id);
CREATE INDEX ideia_files_ideia_idx ON ideia_files (ideia_id);

ALTER TABLE ideia_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY ideia_files_tenant_all ON ideia_files
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY ideia_files_service_role_bypass ON ideia_files
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Notes:
- **Cross-tenant guard (Finding 3):** RLS's `conta_id IN get_my_conta_id()` only validates
  the caller's *own* `conta_id` — it would still permit a row whose `ideia_id`/`file_id`
  belong to another workspace. The composite FKs `(ideia_id, conta_id) → ideias(id,
  workspace_id)` and `(file_id, conta_id) → files(id, conta_id)` make that impossible at the
  database level, independent of RLS or the service-role edge-function path. The
  `WITH CHECK` clause is added for completeness on the tenant policy.
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
1. request presigned PUT URL   (server: best-effort quota pre-check + key allocation)
2. PUT file (+ thumbnail) directly to R2
3. finalize: ONE transactional RPC  →  returns signed GET URL
```

> **Atomicity is the core hardening over the post-media flow.** The existing post path
> (`file_insert_with_quota` then a *separate* `post_file_links` insert) is non-atomic, which
> makes the cap raceable (Finding 1) and leaks committed `files` rows + quota if the link
> insert fails (Finding 2). For ideas we do **not** reuse that two-step pattern. We are not
> refactoring the post flow here — only doing better for the new code.

### Finalize is a single transactional RPC

`ideia_file_insert_with_quota(p jsonb)` (SECURITY DEFINER) does everything in one
transaction so there is no committed-but-unlinked intermediate state:

```text
1. SELECT ... FROM ideias  WHERE id = ideia_id AND workspace_id = conta_id  FOR UPDATE
     → verifies ownership AND serializes concurrent finalizes for the same idea (Finding 1)
     → not found ⇒ RAISE 'ideia_not_found'
2. SELECT count(*) FROM ideia_files WHERE ideia_id = ideia_id
     → >= 10 ⇒ RAISE 'image_limit'                         (cap is now race-safe, Finding 1)
3. v_used := storage_used_bytes (workspaces row, FOR UPDATE) ; v_quota := effective_plan_limit(conta_id, 'storage_quota_bytes')
     → plan-driven quota (NULL = unlimited), matching the live file_insert_with_quota; charges size_bytes only (symmetric with the size-only refund — see Finding 5) ; over ⇒ RAISE 'quota_exceeded' (errcode P0001)
4. INSERT INTO files (... folder_id NULL ...) RETURNING id   → the real bigint files.id
5. INSERT INTO ideia_files (ideia_id, file_id = new files.id, conta_id, sort_order)
6. UPDATE workspaces SET storage_used_bytes += file_size   (size_bytes only; symmetric with the delete-time refund)
RETURNING the files row.
```

Lock order is fixed (idea row, then workspace row) to avoid deadlocks. Because the file
insert and the link insert share one transaction, a failure rolls back both — no orphaned
`files` row, no double-charged quota (Finding 2). The `ideia_files` INSERT also fires the
reused `file_update_reference_count` trigger, so `reference_count` starts at 1.

Constraints enforced server-side:
- MIME in `{image/jpeg, image/png, image/webp, image/gif}` → else 415.
- `0 < size_bytes <= 25 MB` → else 400.
- **Thumbnail (Finding 5):** required for every idea image, `mime_type = image/webp`
  (the client generates WebP), `0 < size_bytes <= 512 KB` → else 400. In `finalize`,
  `headObject` the thumbnail key and verify it exists and matches the declared size/type
  (the existing finalizer only HEAD-checks thumbnails for *videos*; we check images too).
  Thumbnail bytes are **not** counted in the authoritative quota charge: the RPC charges
  `size_bytes` only, matching the live `file_insert_with_quota` so the charge is symmetric
  with the size-only refund in `file_update_used_bytes` (counting the thumbnail would leak
  its bytes into the quota counter on delete). The presign pre-check may still add the
  thumbnail size as a conservative early gate, mirroring the live `file-upload-url` pre-check.
- Workspace storage quota via the RPC above (authoritative) plus a best-effort pre-check in
  `buildPresign` (`effectivePlanLimit(..., 'storage_quota_bytes')`) for an early, friendly
  413 before the client uploads bytes.
- Per-idea count enforced authoritatively in the RPC (race-safe); `buildPresign` also does a
  best-effort early 409 to avoid a wasted upload.

Client-side (both apps): generate a WebP thumbnail + blur placeholder before upload, exactly
like `apps/crm/src/services/postMedia.ts` (`generateImageThumbnail`, `generateBlurDataUrl`,
`probeImage`). All client-supplied dimensions/sizes are **untrusted**; the server re-derives
truth from the R2 `headObject` and the declared values it can verify.

### Auth split — shared core, two thin wrappers

The Hub is **token-authed** (no Supabase user); the CRM is **JWT-authed**. Core logic is
factored into a shared module so the two auth contexts don't duplicate it:

> **Naming (Finding 4):** the value `buildPresign` returns is the **UUID key component**,
> not a `files.id`. It is named `upload_id` everywhere (request → PUT → finalize). The real
> `files.id` is a bigint minted by the RPC at finalize and is the *only* thing called
> `file_id`. `IdeiaImage.file_id` is therefore always the bigint from the inserted row.

**`supabase/functions/_shared/ideia-media.ts`** (pure logic, given `{conta_id, cliente_id}`):
- `buildPresign({ db, conta_id, cliente_id, ideia_id, filename, mime_type, size_bytes, thumbnail })`
  — validates mime/size + thumbnail mime/size, runs the best-effort quota + cap pre-checks,
  allocates `contas/{conta_id}/files/{upload_id}.{ext}` and the matching `.thumb.webp` key,
  returns `{ upload_id, upload_url, r2_key, thumbnail_upload_url, thumbnail_r2_key }`.
- `finalizeUpload({ db, conta_id, cliente_id, ideia_id, r2_key, thumbnail_r2_key, mime_type,
  size_bytes, thumbnail_size_bytes, name, width, height, blur_data_url, sort_order })`
  — `headObject` checks both the main key and the thumbnail key, then calls the single
  `ideia_file_insert_with_quota` RPC (which mints `files.id`, links it, charges quota — all
  atomic), persists `blur_data_url`, and returns the signed GET URL. The link's `file_id`
  comes solely from the RPC's returned row.
- `listIdeiaImages({ db, ideia_id, signUrl })` — returns `IdeiaImage[]`
  (`{ id: link id, file_id: bigint, url, thumbnail_url, blur_data_url, width, height, sort_order }`).
- `removeIdeiaImage({ db, conta_id, cliente_id, ideia_id, file_id })` — verifies ownership,
  deletes the `ideia_files` row (cleanup trigger handles file row + R2 + quota).

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
- CRM `apps/crm/src/store/ideias.ts` `getIdeias`: per **O2 (drawer-only)**, do **not** sign
  URLs for the list. Add a cheap `image_count` (e.g. `ideia_files(count)` in the select). The
  open `IdeiaDrawer` fetches signed URLs via `ideia-media-manage` GET (`listIdeiaImages`)
  through TanStack Query keyed by `ideia_id`.

### Frontend types
- Hub `apps/hub/src/types.ts`: add `images: IdeiaImage[]` to `HubIdeia`.
- CRM `Ideia` type (in `@/store`): add `image_count: number` (for the list badge); the
  drawer holds the full `IdeiaImage[]` from its own query.

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
- `IdeiaModal`: **two-phase per O1** — a brand-new idea saves its text first; on success the
  modal switches to edit mode for the real `ideia_id` and reveals the image picker. Editing
  an existing idea shows the picker immediately. Uploads happen on selection, with thumbnail
  previews and remove.
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
- Both `r2_key` and `thumbnail_r2_key` must start with `contas/{conta_id}/files/`
  (reuse the existing prefix check).
- Cross-tenant links are structurally impossible via the composite FKs (§1), independent of
  the auth path — belt-and-suspenders with the token/profile ownership checks above.
- No raw error details returned to clients; log internally, return generic messages. The
  RPC's `RAISE` codes (`ideia_not_found`, `image_limit`, `quota_exceeded`) map to
  404/409/413 generic messages.
- Image ops bypass the lock by design; the text PATCH lock is untouched.

---

## 5. Testing

**Deno (`supabase/functions/__tests__/`):**
- `_shared/ideia-media` helper: mime reject (415), main-file size reject (>25 MB → 400),
  thumbnail reject (wrong mime / >512 KB → 400), 10-image cap (409), quota_exceeded (413),
  ownership mismatch (wrong client/workspace → 404).
- `hub-ideias`: upload-url / finalize / delete happy paths under token auth; image ops
  succeed on a locked idea (status != `nova` or has agency comment) — proving
  lock-independence; GET returns signed `images`.
- `ideia-media-manage`: JWT happy paths + ownership 404s.
- Trigger behavior (DB-level or via handler test): removing the last `ideia_files` link
  deletes the `files` row and enqueues a `file_deletions` entry; an image also linked to a
  post is **not** deleted.

**DB / RPC hardening (verify the review findings, ideally at the SQL layer):**
- **Cap race (Finding 1):** two finalizes against a 9-image idea — the idea-row `FOR UPDATE`
  serializes them; exactly one succeeds, the other gets `image_limit`. Ends at 10, not 11.
- **Atomic finalize (Finding 2):** force the link insert to fail inside
  `ideia_file_insert_with_quota` → assert no `files` row persists and `storage_used_bytes`
  is unchanged (full rollback; no leak).
- **Cross-tenant guard (Finding 3):** inserting an `ideia_files` row whose `ideia_id` or
  `file_id` belongs to a different workspace than `conta_id` is rejected by the composite FK.
- **Thumbnail accounting (Finding 5):** quota charge equals `size_bytes` only (symmetric
  with the size-only delete refund — no counter drift); finalize still fails if the
  thumbnail object is missing from R2.

**Frontend (Vitest):**
- Hub `ideiaMedia` service: validation (mime/size), and the presign→PUT→finalize call
  sequence (mocked fetch/XHR).
- A render test that idea cards show images and the add/remove controls appear even when the
  idea is locked.

Run `npm run build` (tsc), `npm run test`, and `deno test supabase/functions/` before
pushing. CI also enforces eslint + prettier `format:check` + coverage + deno tests.

---

## Resolved decisions (were open questions)

- **O1 — Upload timing for a *new* idea → "create-then-upload".** A new idea has no `id`
  until created, so images can't be linked yet. The Hub `IdeiaModal` is **two-phase**: for a
  brand-new idea, the primary button first saves the text (`createIdeia`), and on success the
  modal stays open, switches into "edit" mode for the now-real idea, and reveals the image
  picker. Editing an existing idea shows the picker immediately and uploads on selection.
  This avoids a temp-staging area and keeps every upload tied to a real `ideia_id`.
  - UX detail: button label goes `Enviar ideia` → (after save) `Concluir`; a hint explains
    "Adicione imagens abaixo" once the idea exists. Closing after the text save is fine —
    the idea persists with zero images.
- **O2 — CRM signed-URL read path → "drawer-only".** `getIdeias` does **not** embed signed
  image URLs for the list view (would sign N×images URLs on every load). Instead the list
  shows a lightweight image **count** (cheap `ideia_files` count, joinable in `getIdeias`),
  and the open `IdeiaDrawer` fetches full signed URLs via `ideia-media-manage` GET
  (`listIdeiaImages`) through TanStack Query keyed by `ideia_id`.
