# Ideia Image Uploads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Hub clients and CRM internal users attach up to 10 images per idea, reusing the existing R2 `files` infrastructure (quota, thumbnails, reference-counting, cleanup cron).

**Architecture:** A new `ideia_files` join table owns the idea↔file links, guarded by composite FKs (cross-tenant-proof) and an orphan-cleanup trigger. A single transactional RPC (`ideia_file_insert_with_quota`) does cap + quota + file insert + link insert atomically. Shared edge logic lives in `_shared/ideia-media.ts`, wrapped by the token-authed `hub-ideias` function (clients) and a new JWT-authed `ideia-media-manage` function (CRM). Frontends generate WebP thumbnails + blur placeholders, upload via the presign→PUT→finalize flow, and render galleries.

**Tech Stack:** Postgres (Supabase migration), Deno edge functions, React 19 + TanStack Query (Hub: token-auth; CRM: Supabase JWT), Vitest (frontend), `deno test` (edge).

**Spec:** `docs/superpowers/specs/2026-06-26-ideia-image-uploads-design.md`

## Global Constraints

- **Images only:** MIME ∈ `{image/jpeg, image/jpg, image/png, image/gif, image/webp}` → else HTTP 415.
- **Main image size:** `0 < size_bytes <= 25 MB` (`26214400`) → else 400.
- **Thumbnail:** required, `mime_type = image/webp`, `0 < size_bytes <= 512 KB` (`524288`) → else 400.
- **Per-idea cap:** max **10** images, enforced authoritatively inside the RPC (race-safe) → over ⇒ 409.
- **Quota:** charge `size_bytes + thumbnail_bytes` against `workspaces.storage_used_bytes`; over plan limit ⇒ 413 `quota_exceeded`.
- **Lock independence:** image add/remove must NOT call `checkLock` — works on any idea status. Only the existing text PATCH stays lock-gated.
- **CORS:** always `buildCorsHeaders(req)`, never `*`.
- **No raw errors to clients:** map RPC `RAISE` codes (`ideia_not_found`→404, `image_limit`→409, `quota_exceeded`→413) to generic messages; log internally.
- **R2 key prefix:** both `r2_key` and `thumbnail_r2_key` must start with `contas/{conta_id}/files/`.
- **Tooling:** ES modules, path alias `@/`→`src/`, icons from `lucide-react`, toasts via `sonner` `toast()`. No new deps. Typecheck with `npm run build`; tests `npm run test` + `deno test supabase/functions/`. CI also enforces eslint + prettier `format:check`.
- **Deploy:** `hub-ideias` and `ideia-media-manage` deploy with `--use-api`; `hub-ideias` keeps `--no-verify-jwt`; `ideia-media-manage` handles its own JWT (no `--no-verify-jwt`).

---

## File Structure

**Backend (DB):**
- Create `supabase/migrations/20260626000001_ideia_files.sql` — table, composite-FK prereqs, RLS, triggers, RPC.
- Create `scripts/verify-ideia-files.sql` — SQL smoke assertions for the migration.

**Backend (edge):**
- Create `supabase/functions/_shared/ideia-media.ts` — pure logic: validation, presign, finalize, list, remove. Returns `{ status, body }`.
- Modify `supabase/functions/hub-ideias/handler.ts` — routing + image endpoints + GET images. (`index.ts` gains R2 deps.)
- Modify `supabase/functions/hub-ideias/index.ts` — inject `signPutUrl`/`signGetUrl`/`headObject`.
- Create `supabase/functions/ideia-media-manage/index.ts` + `handler.ts` — JWT-authed CRM wrapper.
- Create tests: `supabase/functions/__tests__/ideia-media_test.ts`, `hub-ideias_test.ts`, `ideia-media-manage_test.ts`.
- Modify `supabase/config.toml` — register `ideia-media-manage`.

**Frontend (Hub `apps/hub/src/`):**
- Modify `types.ts` — `IdeiaImage`, `HubIdeia.images`.
- Modify `api.ts` — `presignIdeiaImage`, `finalizeIdeiaImage`, `deleteIdeiaImage`.
- Create `services/ideiaMedia.ts` — upload orchestration (probe/thumbnail/blur + presign→PUT→finalize).
- Modify `pages/IdeiasPage.tsx` — gallery on `IdeiaCard`, two-phase `IdeiaModal`, image picker.
- Create `services/__tests__/ideiaMedia.test.ts`.

**Frontend (CRM `apps/crm/src/`):**
- Modify `services/postMedia.ts` — export `generateImageThumbnail`, `generateBlurDataUrl`.
- Create `services/ideiaMedia.ts` — CRM upload orchestration + list/remove (JWT via `ideia-media-manage`).
- Modify `store/ideias.ts` — add `image_count` to `Ideia` + `getIdeias`.
- Modify `components/ideias/IdeiaDrawer.tsx` — "Imagens" section.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260626000001_ideia_files.sql`
- Create: `scripts/verify-ideia-files.sql`

**Interfaces:**
- Produces: table `ideia_files(id bigserial, ideia_id uuid, file_id bigint, conta_id uuid, sort_order int, created_at)`; RPC `ideia_file_insert_with_quota(p jsonb) RETURNS files`; triggers reusing `file_update_reference_count()` + new `ideia_file_cleanup_orphan()`.
- RPC `p` keys: `conta_id` (uuid), `cliente_id` (int, nullable), `ideia_id` (uuid), `r2_key`, `thumbnail_r2_key`, `name`, `mime_type`, `size_bytes`, `thumbnail_bytes`, `width` (nullable), `height` (nullable), `blur_data_url` (nullable), `uploaded_by` (uuid, nullable), `sort_order`. RPC RAISEs `ideia_not_found` / `image_limit` / `quota_exceeded`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260626000001_ideia_files.sql`:

```sql
-- supabase/migrations/20260626000001_ideia_files.sql
-- Image attachments for ideas. Images are OWNED by the idea (not shared
-- file-manager assets), reusing the files infra for quota/thumbnails/cleanup.

-- Prerequisite UNIQUE constraints so the composite FKs can reference them.
-- (Postgres FKs require a UNIQUE/PK constraint, not merely a unique index.)
ALTER TABLE ideias ADD CONSTRAINT ideias_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE files  ADD CONSTRAINT files_id_conta_uq       UNIQUE (id, conta_id);

CREATE TABLE ideia_files (
  id          bigserial PRIMARY KEY,
  ideia_id    uuid   NOT NULL,
  file_id     bigint NOT NULL,
  conta_id    uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sort_order  int    NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Composite FKs pin the idea AND the file to the link's own workspace,
  -- making cross-tenant links structurally impossible (defense-in-depth).
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

-- Keep files.reference_count accurate (reuse the existing trigger function).
CREATE TRIGGER trg_ideia_file_ref_count_ins
  AFTER INSERT ON ideia_files
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();
CREATE TRIGGER trg_ideia_file_ref_count_del
  AFTER DELETE ON ideia_files
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();

-- When the last reference to a file disappears, delete the file row. That
-- cascade fires the existing file_enqueue_delete (R2 cleanup) and
-- file_update_used_bytes (frees quota). Checks references directly so it is
-- independent of trigger firing order.
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

-- Atomic finalize: ownership lock + cap + quota + file insert + link insert.
-- Returns the inserted files row.
CREATE OR REPLACE FUNCTION ideia_file_insert_with_quota(p jsonb) RETURNS files
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conta_id    uuid   := (p->>'conta_id')::uuid;
  v_cliente_id  int    := NULLIF(p->>'cliente_id', '')::int;
  v_ideia_id    uuid   := (p->>'ideia_id')::uuid;
  v_size        bigint := (p->>'size_bytes')::bigint;
  v_thumb       bigint := COALESCE(NULLIF(p->>'thumbnail_bytes','')::bigint, 0);
  v_idea_owner  int;
  v_count       int;
  v_quota       bigint;
  v_used        bigint;
  v_row         files;
BEGIN
  -- 1. Lock the idea row: verifies workspace ownership AND serializes
  --    concurrent finalizes for the same idea (race-safe cap).
  SELECT cliente_id INTO v_idea_owner
    FROM ideias
   WHERE id = v_ideia_id AND workspace_id = v_conta_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ideia_not_found'; END IF;
  IF v_cliente_id IS NOT NULL AND v_idea_owner <> v_cliente_id THEN
    RAISE EXCEPTION 'ideia_not_found';
  END IF;

  -- 2. Cap (now serialized by the lock above).
  SELECT count(*) INTO v_count FROM ideia_files WHERE ideia_id = v_ideia_id;
  IF v_count >= 10 THEN RAISE EXCEPTION 'image_limit'; END IF;

  -- 3. Quota (file + thumbnail).
  SELECT storage_quota_bytes, storage_used_bytes INTO v_quota, v_used
    FROM workspaces WHERE id = v_conta_id FOR UPDATE;
  IF v_quota IS NOT NULL AND v_used + v_size + v_thumb > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded';
  END IF;

  -- 4. Insert the file (folder_id NULL: idea images are not file-manager assets).
  INSERT INTO files (
    conta_id, folder_id, r2_key, thumbnail_r2_key, name, kind, mime_type,
    size_bytes, width, height, blur_data_url, uploaded_by
  ) VALUES (
    v_conta_id, NULL, p->>'r2_key', NULLIF(p->>'thumbnail_r2_key',''),
    p->>'name', 'image', p->>'mime_type', v_size,
    NULLIF(p->>'width','')::int, NULLIF(p->>'height','')::int,
    NULLIF(p->>'blur_data_url',''), NULLIF(p->>'uploaded_by','')::uuid
  ) RETURNING * INTO v_row;

  -- 5. Link it (fires reference_count trigger).
  INSERT INTO ideia_files (ideia_id, file_id, conta_id, sort_order)
  VALUES (v_ideia_id, v_row.id, v_conta_id,
          COALESCE(NULLIF(p->>'sort_order','')::int, 0));

  -- 6. Charge quota (file + thumbnail).
  UPDATE workspaces SET storage_used_bytes = storage_used_bytes + v_size + v_thumb
   WHERE id = v_conta_id;

  RETURN v_row;
END;
$$;
```

- [ ] **Step 2: Write the SQL smoke-test script**

Create `scripts/verify-ideia-files.sql` (asserts the migration's structure & behavior; run against a DB that already has at least one workspace + cliente + idea, or seed inline — here we assert structure that holds with no data):

```sql
-- scripts/verify-ideia-files.sql — run after applying the migration.
-- Each block RAISEs on failure so a clean run = all assertions passed.

-- A1: table + composite FKs exist
DO $$
BEGIN
  IF to_regclass('public.ideia_files') IS NULL THEN
    RAISE EXCEPTION 'A1 FAIL: ideia_files table missing';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'ideia_files'::regclass AND contype = 'f') <> 3 THEN
    RAISE EXCEPTION 'A1 FAIL: expected 3 FKs (ideia, file, conta)';
  END IF;
END $$;

-- A2: RPC + triggers exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ideia_file_insert_with_quota') THEN
    RAISE EXCEPTION 'A2 FAIL: RPC missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ideia_file_cleanup_orphan') THEN
    RAISE EXCEPTION 'A2 FAIL: cleanup trigger missing';
  END IF;
END $$;

-- A3: cross-tenant link rejected by composite FK.
-- Picks a real file/idea if any exist; otherwise skips with a notice.
DO $$
DECLARE v_file bigint; v_idea uuid; v_other uuid;
BEGIN
  SELECT id INTO v_file FROM files LIMIT 1;
  SELECT id INTO v_idea FROM ideias LIMIT 1;
  SELECT id INTO v_other FROM workspaces
    WHERE id <> (SELECT conta_id FROM files WHERE id = v_file) LIMIT 1;
  IF v_file IS NULL OR v_idea IS NULL OR v_other IS NULL THEN
    RAISE NOTICE 'A3 SKIP: needs >=1 file, >=1 idea, >=2 workspaces';
    RETURN;
  END IF;
  BEGIN
    INSERT INTO ideia_files (ideia_id, file_id, conta_id) VALUES (v_idea, v_file, v_other);
    RAISE EXCEPTION 'A3 FAIL: cross-tenant insert was allowed';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'A3 PASS: cross-tenant link rejected';
  END;
  ROLLBACK;
END $$;
```

- [ ] **Step 3: Apply the migration locally and verify it applies cleanly**

Run (local Supabase — applies ALL migrations to the local Postgres):
```bash
npx supabase db reset
```
Expected: completes without error; output lists `20260626000001_ideia_files.sql` applied. If `tsc`/Docker for local Supabase is unavailable in your environment, apply this single migration file via the staging **SQL editor** instead (the project's documented workaround — do NOT `db push`, which applies all pending and aborts on the orphaned backfill).

- [ ] **Step 4: Run the SQL smoke assertions**

Run against the same DB you applied to (local):
```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f scripts/verify-ideia-files.sql
```
Expected: no `EXCEPTION`; you see `A3 PASS` (or `A3 SKIP` on an empty DB). Any `... FAIL` means fix the migration. (On staging, paste the script into the SQL editor and run; expect the same notices.)

> **What this smoke covers vs. what it can't:** the repo has no pgTAP/concurrency harness, so the smoke verifies structure (A1/A2) and the cross-tenant FK (A3, Finding 3). The remaining hardening is guaranteed by construction, not by an automated DB test: the **cap race** (Finding 1) and **atomic rollback** (Finding 2) hold because the entire RPC body is one transaction with `SELECT ... FOR UPDATE` on the idea row, and the **orphan-cleanup trigger** behavior is exercised by the manual staging E2E in Task 12 Step 6 (remove an image → file row gone + `file_deletions` row enqueued; an image also linked to a post is not deleted). Do not claim these are unit-tested.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260626000001_ideia_files.sql scripts/verify-ideia-files.sql
git commit -m "feat(ideias): ideia_files table, cross-tenant FKs, atomic insert RPC + cleanup trigger"
```

---

## Task 2: Shared module — validation + presign

**Files:**
- Create: `supabase/functions/_shared/ideia-media.ts`
- Test: `supabase/functions/__tests__/ideia-media_test.ts`

**Interfaces:**
- Consumes: nothing (pure helpers + injected R2/db deps).
- Produces:
  - constants `IDEIA_IMAGE_MIME: string[]`, `MAX_IMAGE_BYTES = 26214400`, `MAX_THUMB_BYTES = 524288`, `MAX_IMAGES_PER_IDEIA = 10`.
  - `type IdeiaMediaResult = { status: number; body: Record<string, unknown> }`
  - `presignIdeiaImage(args): Promise<IdeiaMediaResult>` where `args = { db, conta_id, cliente_id?: number|null, ideia_id, filename, mime_type, size_bytes, thumbnail: { mime_type; size_bytes }, signPutUrl, randomUUID? }`. On success `body = { upload_id, upload_url, r2_key, thumbnail_upload_url, thumbnail_r2_key }`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/ideia-media_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { presignIdeiaImage } from "../_shared/ideia-media.ts";

const signPutUrl = async (key: string) => `https://put.example.com/${key}`;
const randomUUID = () => "uuid-1";

function baseArgs(db: ReturnType<typeof createSupabaseQueryMock>) {
  return {
    db: db as never,
    conta_id: "conta-1",
    cliente_id: 14 as number | null,
    ideia_id: "11111111-1111-1111-1111-111111111111",
    filename: "ref.png",
    mime_type: "image/png",
    size_bytes: 5000,
    thumbnail: { mime_type: "image/webp", size_bytes: 2000 },
    signPutUrl,
    randomUUID,
  };
}

Deno.test("presign: rejects non-image mime with 415", async () => {
  const db = createSupabaseQueryMock();
  const res = await presignIdeiaImage({ ...baseArgs(db), mime_type: "application/pdf" });
  assertEquals(res.status, 415);
});

Deno.test("presign: rejects oversize main file with 400", async () => {
  const db = createSupabaseQueryMock();
  const res = await presignIdeiaImage({ ...baseArgs(db), size_bytes: 26214401 });
  assertEquals(res.status, 400);
});

Deno.test("presign: rejects non-webp thumbnail with 400", async () => {
  const db = createSupabaseQueryMock();
  const res = await presignIdeiaImage({
    ...baseArgs(db),
    thumbnail: { mime_type: "image/png", size_bytes: 2000 },
  });
  assertEquals(res.status, 400);
});

Deno.test("presign: rejects oversize thumbnail with 400", async () => {
  const db = createSupabaseQueryMock();
  const res = await presignIdeiaImage({
    ...baseArgs(db),
    thumbnail: { mime_type: "image/webp", size_bytes: 524289 },
  });
  assertEquals(res.status, 400);
});

Deno.test("presign: 409 when idea already has 10 images", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideia_files", "select", { data: null, error: null, count: 10 });
  const res = await presignIdeiaImage(baseArgs(db));
  assertEquals(res.status, 409);
});

Deno.test("presign: happy path returns upload_id + keys under conta prefix", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideia_files", "select", { data: null, error: null, count: 3 });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null }); // unlimited
  const res = await presignIdeiaImage(baseArgs(db));
  assertEquals(res.status, 200);
  assertEquals(res.body.upload_id, "uuid-1");
  assertEquals(res.body.r2_key, "contas/conta-1/files/uuid-1.png");
  assertEquals(res.body.thumbnail_r2_key, "contas/conta-1/files/uuid-1.thumb.webp");
  assertEquals(res.body.upload_url, "https://put.example.com/contas/conta-1/files/uuid-1.png");
});

Deno.test("presign: 413 when projected usage exceeds quota", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideia_files", "select", { data: null, error: null, count: 0 });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 999 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null }); // 1000 byte quota
  const res = await presignIdeiaImage(baseArgs(db)); // needs 5000 + 2000
  assertEquals(res.status, 413);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/__tests__/ideia-media_test.ts`
Expected: FAIL — `Module not found "../_shared/ideia-media.ts"`.

- [ ] **Step 3: Write the minimal implementation**

Create `supabase/functions/_shared/ideia-media.ts`:

```ts
import { effectivePlanLimit } from "./entitlements-rpc.ts";

export const IDEIA_IMAGE_MIME = [
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
];
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 26214400
export const MAX_THUMB_BYTES = 512 * 1024;       // 524288
export const MAX_IMAGES_PER_IDEIA = 10;

export type IdeiaMediaResult = { status: number; body: Record<string, unknown> };

export type IdeiaMediaDb = {
  from: (table: string) => any;
  rpc: (name: string, params: Record<string, unknown>) => any;
};

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
    "image/webp": "webp", "image/gif": "gif",
  };
  return map[mime] ?? "bin";
}

export interface PresignArgs {
  db: IdeiaMediaDb;
  conta_id: string;
  cliente_id?: number | null;
  ideia_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  thumbnail: { mime_type: string; size_bytes: number };
  signPutUrl: (key: string, mime: string) => Promise<string>;
  randomUUID?: () => string;
}

export async function presignIdeiaImage(a: PresignArgs): Promise<IdeiaMediaResult> {
  if (!IDEIA_IMAGE_MIME.includes(a.mime_type)) {
    return { status: 415, body: { error: "unsupported file type" } };
  }
  if (!a.size_bytes || a.size_bytes <= 0 || a.size_bytes > MAX_IMAGE_BYTES) {
    return { status: 400, body: { error: "size_bytes out of range" } };
  }
  if (a.thumbnail?.mime_type !== "image/webp") {
    return { status: 400, body: { error: "thumbnail must be image/webp" } };
  }
  if (!a.thumbnail.size_bytes || a.thumbnail.size_bytes <= 0 || a.thumbnail.size_bytes > MAX_THUMB_BYTES) {
    return { status: 400, body: { error: "thumbnail size out of range" } };
  }

  // Best-effort early cap check (authoritative check is in the RPC at finalize).
  const { count } = await a.db.from("ideia_files")
    .select("id", { count: "exact", head: true })
    .eq("ideia_id", a.ideia_id);
  if ((count ?? 0) >= MAX_IMAGES_PER_IDEIA) {
    return { status: 409, body: { error: "image_limit" } };
  }

  // Best-effort early quota check.
  const { data: ws } = await a.db.from("workspaces")
    .select("storage_used_bytes").eq("id", a.conta_id).single();
  const quota = await effectivePlanLimit(a.db as never, a.conta_id, "storage_quota_bytes");
  if (quota !== null) {
    const used = Number(ws?.storage_used_bytes ?? 0);
    if (used + a.size_bytes + a.thumbnail.size_bytes > quota) {
      return { status: 413, body: { error: "quota_exceeded", used, quota } };
    }
  }

  const upload_id = (a.randomUUID ?? crypto.randomUUID.bind(crypto))();
  const r2_key = `contas/${a.conta_id}/files/${upload_id}.${extFromMime(a.mime_type)}`;
  const thumbnail_r2_key = `contas/${a.conta_id}/files/${upload_id}.thumb.webp`;
  const upload_url = await a.signPutUrl(r2_key, a.mime_type);
  const thumbnail_upload_url = await a.signPutUrl(thumbnail_r2_key, "image/webp");

  return {
    status: 200,
    body: { upload_id, upload_url, r2_key, thumbnail_upload_url, thumbnail_r2_key },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/__tests__/ideia-media_test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ideia-media.ts supabase/functions/__tests__/ideia-media_test.ts
git commit -m "feat(ideias): shared presign logic for idea images"
```

---

## Task 3: Shared module — finalize

**Files:**
- Modify: `supabase/functions/_shared/ideia-media.ts`
- Test: `supabase/functions/__tests__/ideia-media_test.ts`

**Interfaces:**
- Produces: `finalizeIdeiaImage(args): Promise<IdeiaMediaResult>` where
  `args = { db, conta_id, cliente_id?, ideia_id, r2_key, thumbnail_r2_key, mime_type, size_bytes, thumbnail_bytes, name, width?, height?, blur_data_url?, sort_order?, uploaded_by?: string|null, headObject, signGetUrl }`.
  On success `body` is an `IdeiaImage`-shaped object: `{ id, file_id, url, thumbnail_url, blur_data_url, width, height, sort_order }`.
- `headObject: (key) => Promise<{ contentLength: number; contentType: string|null } | null>`; `signGetUrl: (key) => Promise<string>`.

- [ ] **Step 1: Write the failing test (append to `ideia-media_test.ts`)**

```ts
import { finalizeIdeiaImage } from "../_shared/ideia-media.ts";

const signGetUrl = async (key: string) => `https://get.example.com/${key}`;

function finalizeArgs(db: ReturnType<typeof createSupabaseQueryMock>) {
  return {
    db: db as never,
    conta_id: "conta-1",
    cliente_id: 14 as number | null,
    ideia_id: "11111111-1111-1111-1111-111111111111",
    r2_key: "contas/conta-1/files/uuid-1.png",
    thumbnail_r2_key: "contas/conta-1/files/uuid-1.thumb.webp",
    mime_type: "image/png",
    size_bytes: 5000,
    thumbnail_bytes: 2000,
    name: "ref.png",
    width: 800,
    height: 600,
    blur_data_url: "data:image/webp;base64,abc",
    sort_order: 0,
    uploaded_by: null as string | null,
    headObject: async (k: string) => ({ contentLength: k.includes('.thumb.') ? 2000 : 5000, contentType: null }),
    signGetUrl,
  };
}

Deno.test("finalize: rejects r2_key outside conta prefix with 400", async () => {
  const db = createSupabaseQueryMock();
  const res = await finalizeIdeiaImage({ ...finalizeArgs(db), r2_key: "contas/other/files/x.png" });
  assertEquals(res.status, 400);
});

Deno.test("finalize: 400 when main object missing in R2", async () => {
  const db = createSupabaseQueryMock();
  const res = await finalizeIdeiaImage({ ...finalizeArgs(db), headObject: async () => null });
  assertEquals(res.status, 400);
});

Deno.test("finalize: 400 when main size mismatches R2", async () => {
  const db = createSupabaseQueryMock();
  const res = await finalizeIdeiaImage({
    ...finalizeArgs(db),
    headObject: async () => ({ contentLength: 9999, contentType: null }),
  });
  assertEquals(res.status, 400);
});

Deno.test("finalize: 400 when thumbnail missing in R2", async () => {
  const db = createSupabaseQueryMock();
  let n = 0;
  const res = await finalizeIdeiaImage({
    ...finalizeArgs(db),
    headObject: async () => { n++; return n === 1 ? { contentLength: 5000, contentType: null } : null; },
  });
  assertEquals(res.status, 400);
});

Deno.test("finalize: RPC ideia_not_found -> 404", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_file_insert_with_quota", { data: null, error: { message: "ideia_not_found" } });
  const res = await finalizeIdeiaImage(finalizeArgs(db));
  assertEquals(res.status, 404);
});

Deno.test("finalize: RPC image_limit -> 409", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_file_insert_with_quota", { data: null, error: { message: "image_limit" } });
  const res = await finalizeIdeiaImage(finalizeArgs(db));
  assertEquals(res.status, 409);
});

Deno.test("finalize: RPC quota_exceeded -> 413", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_file_insert_with_quota", { data: null, error: { message: "quota_exceeded" } });
  const res = await finalizeIdeiaImage(finalizeArgs(db));
  assertEquals(res.status, 413);
});

Deno.test("finalize: happy path returns signed IdeiaImage from inserted row", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_file_insert_with_quota", {
    data: { id: 42, r2_key: "contas/conta-1/files/uuid-1.png",
            thumbnail_r2_key: "contas/conta-1/files/uuid-1.thumb.webp",
            width: 800, height: 600, blur_data_url: "data:image/webp;base64,abc" },
    error: null,
  });
  // Find the link id created for this file.
  db.queue("ideia_files", "select", { data: { id: 7, sort_order: 0 }, error: null });
  const res = await finalizeIdeiaImage(finalizeArgs(db));
  assertEquals(res.status, 200);
  assertEquals(res.body.file_id, 42);
  assertEquals(res.body.id, 7);
  assertEquals(res.body.url, "https://get.example.com/contas/conta-1/files/uuid-1.png");
  assertEquals(res.body.thumbnail_url, "https://get.example.com/contas/conta-1/files/uuid-1.thumb.webp");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test supabase/functions/__tests__/ideia-media_test.ts`
Expected: FAIL — `finalizeIdeiaImage` is not exported.

- [ ] **Step 3: Implement `finalizeIdeiaImage` (append to `ideia-media.ts`)**

```ts
export interface FinalizeArgs {
  db: IdeiaMediaDb;
  conta_id: string;
  cliente_id?: number | null;
  ideia_id: string;
  r2_key: string;
  thumbnail_r2_key: string;
  mime_type: string;
  size_bytes: number;
  thumbnail_bytes: number;
  name: string;
  width?: number;
  height?: number;
  blur_data_url?: string;
  sort_order?: number;
  uploaded_by?: string | null;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  signGetUrl: (key: string) => Promise<string>;
}

function rpcErrorStatus(msg: string): number {
  if (msg.includes("ideia_not_found")) return 404;
  if (msg.includes("image_limit")) return 409;
  if (msg.includes("quota_exceeded")) return 413;
  return 500;
}

export async function finalizeIdeiaImage(a: FinalizeArgs): Promise<IdeiaMediaResult> {
  const prefix = `contas/${a.conta_id}/files/`;
  if (!a.r2_key.startsWith(prefix) || !a.thumbnail_r2_key.startsWith(prefix)) {
    return { status: 400, body: { error: "invalid r2_key" } };
  }
  if (!IDEIA_IMAGE_MIME.includes(a.mime_type)) {
    return { status: 415, body: { error: "unsupported file type" } };
  }

  const head = await a.headObject(a.r2_key);
  if (!head) return { status: 400, body: { error: "object not found" } };
  if (head.contentLength !== a.size_bytes) return { status: 400, body: { error: "size mismatch" } };
  if (head.contentType && head.contentType !== a.mime_type) {
    return { status: 400, body: { error: "content-type mismatch" } };
  }

  const thumbHead = await a.headObject(a.thumbnail_r2_key);
  if (!thumbHead) return { status: 400, body: { error: "thumbnail not found" } };
  if (thumbHead.contentLength !== a.thumbnail_bytes) {
    return { status: 400, body: { error: "thumbnail size mismatch" } };
  }

  const { data: inserted, error } = await a.db.rpc("ideia_file_insert_with_quota", {
    p: {
      conta_id: a.conta_id,
      cliente_id: a.cliente_id ?? "",
      ideia_id: a.ideia_id,
      r2_key: a.r2_key,
      thumbnail_r2_key: a.thumbnail_r2_key,
      name: a.name,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      thumbnail_bytes: a.thumbnail_bytes,
      width: a.width ?? "",
      height: a.height ?? "",
      blur_data_url: a.blur_data_url ?? "",
      uploaded_by: a.uploaded_by ?? "",
      sort_order: a.sort_order ?? 0,
    },
  }).single();

  if (error || !inserted) {
    const msg = (error as { message?: string } | null)?.message ?? "insert failed";
    return { status: rpcErrorStatus(msg), body: { error: msg } };
  }

  const file = inserted as Record<string, unknown>;
  // Resolve the link id for this (ideia, file) pair.
  const { data: link } = await a.db.from("ideia_files")
    .select("id, sort_order").eq("ideia_id", a.ideia_id).eq("file_id", file.id).maybeSingle();

  return {
    status: 200,
    body: {
      id: (link as { id?: number } | null)?.id ?? null,
      file_id: file.id,
      url: await a.signGetUrl(a.r2_key),
      thumbnail_url: await a.signGetUrl(a.thumbnail_r2_key),
      blur_data_url: file.blur_data_url ?? null,
      width: file.width ?? null,
      height: file.height ?? null,
      sort_order: (link as { sort_order?: number } | null)?.sort_order ?? 0,
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test supabase/functions/__tests__/ideia-media_test.ts`
Expected: PASS (all presign + finalize tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ideia-media.ts supabase/functions/__tests__/ideia-media_test.ts
git commit -m "feat(ideias): shared finalize logic (atomic RPC + signed result)"
```

---

## Task 4: Shared module — list + remove

**Files:**
- Modify: `supabase/functions/_shared/ideia-media.ts`
- Test: `supabase/functions/__tests__/ideia-media_test.ts`

**Interfaces:**
- Produces:
  - `listIdeiaImages(args): Promise<IdeiaMediaResult>` — `args = { db, conta_id, cliente_id?, ideia_id, signGetUrl }`. `body = { images: IdeiaImage[] }`. Verifies idea ownership (404 if not owned).
  - `removeIdeiaImage(args): Promise<IdeiaMediaResult>` — `args = { db, conta_id, cliente_id?, ideia_id, file_id }`. Deletes the `ideia_files` row after ownership check; `body = { ok: true }` (404 if not found/owned).

- [ ] **Step 1: Write the failing test (append)**

```ts
import { listIdeiaImages, removeIdeiaImage } from "../_shared/ideia-media.ts";

Deno.test("list: 404 when idea not owned by this workspace/client", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: null, error: null }); // ownership lookup misses
  const res = await listIdeiaImages({
    db: db as never, conta_id: "conta-1", cliente_id: 14,
    ideia_id: "11111111-1111-1111-1111-111111111111", signGetUrl,
  });
  assertEquals(res.status, 404);
});

Deno.test("list: returns signed images ordered for an owned idea", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", {
    data: [
      { id: 7, file_id: 42, sort_order: 0,
        files: { r2_key: "contas/conta-1/files/a.png", thumbnail_r2_key: "contas/conta-1/files/a.thumb.webp",
                 blur_data_url: "data:...", width: 800, height: 600 } },
    ],
    error: null,
  });
  const res = await listIdeiaImages({
    db: db as never, conta_id: "conta-1", cliente_id: 14,
    ideia_id: "i1", signGetUrl,
  });
  assertEquals(res.status, 200);
  const images = res.body.images as Array<Record<string, unknown>>;
  assertEquals(images.length, 1);
  assertEquals(images[0].file_id, 42);
  assertEquals(images[0].url, "https://get.example.com/contas/conta-1/files/a.png");
});

Deno.test("remove: 404 when link not found for owned idea", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", { data: null, error: null }); // link lookup misses
  const res = await removeIdeiaImage({
    db: db as never, conta_id: "conta-1", cliente_id: 14, ideia_id: "i1", file_id: 42,
  });
  assertEquals(res.status, 404);
});

Deno.test("remove: deletes the link and returns ok", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", { data: { id: 7 }, error: null });
  db.queue("ideia_files", "delete", { data: null, error: null });
  const res = await removeIdeiaImage({
    db: db as never, conta_id: "conta-1", cliente_id: 14, ideia_id: "i1", file_id: 42,
  });
  assertEquals(res.status, 200);
  assertEquals(res.body.ok, true);
  const del = db.calls.filter((c) => c.table === "ideia_files" && c.operation === "delete");
  assertEquals(del.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test supabase/functions/__tests__/ideia-media_test.ts`
Expected: FAIL — `listIdeiaImages`/`removeIdeiaImage` not exported.

- [ ] **Step 3: Implement (append to `ideia-media.ts`)**

```ts
async function ownsIdeia(
  db: IdeiaMediaDb, conta_id: string, cliente_id: number | null | undefined, ideia_id: string,
): Promise<boolean> {
  let q = db.from("ideias").select("id, cliente_id, workspace_id")
    .eq("id", ideia_id).eq("workspace_id", conta_id);
  if (cliente_id !== undefined && cliente_id !== null) q = q.eq("cliente_id", cliente_id);
  const { data } = await q.maybeSingle();
  return !!data;
}

export interface ListArgs {
  db: IdeiaMediaDb;
  conta_id: string;
  cliente_id?: number | null;
  ideia_id: string;
  signGetUrl: (key: string) => Promise<string>;
}

export async function listIdeiaImages(a: ListArgs): Promise<IdeiaMediaResult> {
  if (!(await ownsIdeia(a.db, a.conta_id, a.cliente_id, a.ideia_id))) {
    return { status: 404, body: { error: "Ideia não encontrada." } };
  }
  const { data: rows } = await a.db.from("ideia_files")
    .select("id, file_id, sort_order, files(r2_key, thumbnail_r2_key, blur_data_url, width, height)")
    .eq("ideia_id", a.ideia_id)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  const images = [];
  for (const row of (rows ?? []) as Array<Record<string, any>>) {
    const f = row.files;
    if (!f) continue;
    images.push({
      id: row.id,
      file_id: row.file_id,
      url: await a.signGetUrl(f.r2_key),
      thumbnail_url: f.thumbnail_r2_key ? await a.signGetUrl(f.thumbnail_r2_key) : null,
      blur_data_url: f.blur_data_url ?? null,
      width: f.width ?? null,
      height: f.height ?? null,
      sort_order: row.sort_order ?? 0,
    });
  }
  return { status: 200, body: { images } };
}

export interface RemoveArgs {
  db: IdeiaMediaDb;
  conta_id: string;
  cliente_id?: number | null;
  ideia_id: string;
  file_id: number;
}

export async function removeIdeiaImage(a: RemoveArgs): Promise<IdeiaMediaResult> {
  if (!(await ownsIdeia(a.db, a.conta_id, a.cliente_id, a.ideia_id))) {
    return { status: 404, body: { error: "Ideia não encontrada." } };
  }
  const { data: link } = await a.db.from("ideia_files")
    .select("id").eq("ideia_id", a.ideia_id).eq("file_id", a.file_id).maybeSingle();
  if (!link) return { status: 404, body: { error: "Imagem não encontrada." } };

  const { error } = await a.db.from("ideia_files").delete()
    .eq("ideia_id", a.ideia_id).eq("file_id", a.file_id);
  if (error) return { status: 500, body: { error: "delete failed" } };
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test supabase/functions/__tests__/ideia-media_test.ts`
Expected: PASS (all shared-module tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ideia-media.ts supabase/functions/__tests__/ideia-media_test.ts
git commit -m "feat(ideias): shared list + remove logic with ownership checks"
```

---

## Task 5: Hub `hub-ideias` — routing + image endpoints + GET images

**Files:**
- Modify: `supabase/functions/hub-ideias/handler.ts`
- Modify: `supabase/functions/hub-ideias/index.ts`
- Test: `supabase/functions/__tests__/hub-ideias_test.ts` (create)

**Interfaces:**
- Consumes: `presignIdeiaImage`, `finalizeIdeiaImage`, `removeIdeiaImage` (Tasks 2-4); `signPutUrl`, `signGetUrl`, `headObject` from `_shared/r2.ts`.
- Produces (token-authed routes; token via `?token=` or body): `POST /hub-ideias/upload-url`, `POST /hub-ideias/:id/files`, `DELETE /hub-ideias/:id/files/:fileId`. GET now returns `images: IdeiaImage[]` per idea. These routes do NOT call `checkLock`.
- The handler `deps` gains `signPutUrl`, `signGetUrl`, `headObject`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/hub-ideias_test.ts`:

```ts
import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubIdeiasHandler } from "../hub-ideias/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-06-26T12:00:00.000Z",
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: async (k: string) => ({ contentLength: k.includes('.thumb.') ? 2000 : 5000, contentType: null }),
  });
}

function setupToken(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
}

Deno.test("hub-ideias: POST /upload-url returns presigned keys", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideia_files", "select", { data: null, error: null, count: 1 });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias/upload-url?token=t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "t", ideia_id: "11111111-1111-1111-1111-111111111111",
      filename: "a.png", mime_type: "image/png", size_bytes: 5000,
      thumbnail: { mime_type: "image/webp", size_bytes: 2000 },
    }),
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(typeof body.upload_url, "string");
});

Deno.test("hub-ideias: POST /:id/files works on a LOCKED idea (lock-independent)", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  // No checkLock query is consulted; finalize goes straight to the RPC.
  db.queueRpc("ideia_file_insert_with_quota", {
    data: { id: 42, blur_data_url: null, width: 800, height: 600 }, error: null,
  });
  db.queue("ideia_files", "select", { data: { id: 7, sort_order: 0 }, error: null });
  const res = await makeHandler(db)(new Request(
    "https://x.test/hub-ideias/11111111-1111-1111-1111-111111111111/files?token=t",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "t",
        r2_key: "contas/conta-1/files/uuid-1.png",
        thumbnail_r2_key: "contas/conta-1/files/uuid-1.thumb.webp",
        mime_type: "image/png", size_bytes: 5000, thumbnail_bytes: 2000, name: "a.png",
      }),
    },
  ));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.file_id, 42);
});

Deno.test("hub-ideias: DELETE /:id/files/:fileId removes an image", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", { data: { id: 7 }, error: null });
  db.queue("ideia_files", "delete", { data: null, error: null });
  const res = await makeHandler(db)(new Request(
    "https://x.test/hub-ideias/11111111-1111-1111-1111-111111111111/files/42?token=t",
    { method: "DELETE" },
  ));
  assertEquals(res.status, 200);
});

Deno.test("hub-ideias: invalid token returns 404", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias/upload-url?token=bad", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "bad" }),
  }));
  assertEquals(res.status, 404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test supabase/functions/__tests__/hub-ideias_test.ts`
Expected: FAIL — handler doesn't accept the new deps / routes return 404.

- [ ] **Step 3: Update `index.ts` to inject R2 deps**

Replace `supabase/functions/hub-ideias/index.ts` with:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signPutUrl, signGetUrl, headObject } from "../_shared/r2.ts";
import { createHubIdeiasHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubIdeiasHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  signPutUrl,
  signGetUrl,
  headObject,
}));
```

- [ ] **Step 4: Update `handler.ts` — deps, routing, image endpoints, GET images**

In `supabase/functions/hub-ideias/handler.ts`:

First, update the imports and the `HubIdeiasHandlerDeps` interface:

```ts
import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { presignIdeiaImage, finalizeIdeiaImage, removeIdeiaImage } from "../_shared/ideia-media.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface HubIdeiasHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
}
```

Then replace the path-parsing block (the `const url = new URL(...)` ... `const hasId = ...` lines) with segment-based routing:

```ts
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const idx = pathParts.indexOf("hub-ideias");
    const seg = idx >= 0 ? pathParts.slice(idx + 1) : [];
    const ideiaId = seg[0] && seg[0].length === 36 ? seg[0] : null;
    const hasId = !!ideiaId && seg.length === 1;
    const isPresign = seg.length === 1 && seg[0] === "upload-url";
    const isFinalize = !!ideiaId && seg[1] === "files" && seg.length === 2;
    const isRemove = !!ideiaId && seg[1] === "files" && seg.length === 3;
    const removeFileId = isRemove ? Number(seg[2]) : NaN;
```

(`ideiaId` keeps the old meaning for PATCH/DELETE; `hasId` is now "exactly one segment that is a UUID".)

Immediately after `const workspaceId = hubToken.conta_id;`, add the three image routes (BEFORE the existing GET/POST/PATCH/DELETE branches so they take precedence):

```ts
    // ── Image: presign ─────────────────────────────────────────────
    if (req.method === "POST" && isPresign) {
      const body = await req.json().catch(() => ({}));
      const result = await presignIdeiaImage({
        db: db as any,
        conta_id: workspaceId,
        cliente_id: clienteId,
        ideia_id: String(body.ideia_id ?? ""),
        filename: String(body.filename ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail: {
          mime_type: String(body.thumbnail?.mime_type ?? ""),
          size_bytes: Number(body.thumbnail?.size_bytes ?? 0),
        },
        signPutUrl: deps.signPutUrl,
      });
      return json(result.body, result.status);
    }

    // ── Image: finalize (NOT lock-gated) ───────────────────────────
    if (req.method === "POST" && isFinalize) {
      const body = await req.json().catch(() => ({}));
      const result = await finalizeIdeiaImage({
        db: db as any,
        conta_id: workspaceId,
        cliente_id: clienteId,
        ideia_id: ideiaId!,
        r2_key: String(body.r2_key ?? ""),
        thumbnail_r2_key: String(body.thumbnail_r2_key ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail_bytes: Number(body.thumbnail_bytes ?? 0),
        name: String(body.name ?? "image"),
        width: body.width != null ? Number(body.width) : undefined,
        height: body.height != null ? Number(body.height) : undefined,
        blur_data_url: typeof body.blur_data_url === "string" ? body.blur_data_url : undefined,
        sort_order: body.sort_order != null ? Number(body.sort_order) : undefined,
        uploaded_by: null,
        headObject: deps.headObject,
        signGetUrl: deps.signGetUrl,
      });
      return json(result.body, result.status);
    }

    // ── Image: remove (NOT lock-gated) ─────────────────────────────
    if (req.method === "DELETE" && isRemove) {
      if (Number.isNaN(removeFileId)) return json({ error: "invalid file id" }, 400);
      const result = await removeIdeiaImage({
        db: db as any,
        conta_id: workspaceId,
        cliente_id: clienteId,
        ideia_id: ideiaId!,
        file_id: removeFileId,
      });
      return json(result.body, result.status);
    }
```

Finally, extend the existing GET branch to embed signed images. Replace the GET branch body:

```ts
    if (req.method === "GET") {
      const { data: ideias } = await db
        .from("ideias")
        .select(`
        id, titulo, descricao, links, status,
        comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
        comentario_autor:membros!comentario_autor_id(nome),
        ideia_reactions(id, membro_id, emoji, membros(nome)),
        ideia_files(id, file_id, sort_order, files(r2_key, thumbnail_r2_key, blur_data_url, width, height))
      `)
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false });

      const withImages = [];
      for (const ideia of (ideias ?? []) as Array<Record<string, any>>) {
        const links = (ideia.ideia_files ?? [])
          .sort((x: any, y: any) => (x.sort_order - y.sort_order) || (x.id - y.id));
        const images = [];
        for (const row of links) {
          const f = row.files;
          if (!f) continue;
          images.push({
            id: row.id,
            file_id: row.file_id,
            url: await deps.signGetUrl(f.r2_key, 3600),
            thumbnail_url: f.thumbnail_r2_key ? await deps.signGetUrl(f.thumbnail_r2_key, 3600) : null,
            blur_data_url: f.blur_data_url ?? null,
            width: f.width ?? null,
            height: f.height ?? null,
            sort_order: row.sort_order ?? 0,
          });
        }
        delete ideia.ideia_files;
        withImages.push({ ...ideia, images });
      }

      return json({ ideias: withImages });
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `deno test supabase/functions/__tests__/hub-ideias_test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full edge suite (no regressions)**

Run: `deno test supabase/functions/`
Expected: PASS (existing hub/file tests still green).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/hub-ideias/ supabase/functions/__tests__/hub-ideias_test.ts
git commit -m "feat(ideias): hub-ideias image upload/remove endpoints + GET images (lock-independent)"
```

---

## Task 6: CRM `ideia-media-manage` edge function (JWT)

**Files:**
- Create: `supabase/functions/ideia-media-manage/index.ts`
- Create: `supabase/functions/ideia-media-manage/handler.ts`
- Test: `supabase/functions/__tests__/ideia-media-manage_test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `presignIdeiaImage`, `finalizeIdeiaImage`, `listIdeiaImages`, `removeIdeiaImage`; resolves `conta_id` from `profiles` and the user id from `auth.getUser(token)` (JWT). `cliente_id` is **not** bound (internal users manage any client in the workspace) → pass `null`.
- Produces routes: `GET /ideia-media-manage?ideia_id=` → list; `POST /ideia-media-manage/upload-url` → presign; `POST /ideia-media-manage/:id/files` → finalize; `DELETE /ideia-media-manage/:id/files/:fileId` → remove.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/ideia-media-manage_test.ts`:

```ts
import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createIdeiaMediaManageHandler } from "../ideia-media-manage/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createIdeiaMediaManageHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: async (k: string) => ({ contentLength: k.includes('.thumb.') ? 2000 : 5000, contentType: null }),
  });
}

function setupAuth(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "conta-1" }, error: null });
}

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x.test/${path}`, {
    method,
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

Deno.test("ideia-media-manage: missing auth -> 401", async () => {
  const db = createSupabaseQueryMock();
  const res = await makeHandler(db)(new Request("https://x.test/ideia-media-manage?ideia_id=i1"));
  assertEquals(res.status, 401);
});

Deno.test("ideia-media-manage: GET lists images (cliente unbound)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", { data: [], error: null });
  const res = await makeHandler(db)(req("GET", "ideia-media-manage?ideia_id=i1"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.images, []);
});

Deno.test("ideia-media-manage: GET without ideia_id -> 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("GET", "ideia-media-manage"));
  assertEquals(res.status, 400);
});

Deno.test("ideia-media-manage: POST /:id/files finalizes (uploaded_by = user)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("ideia_file_insert_with_quota", { data: { id: 42, blur_data_url: null }, error: null });
  db.queue("ideia_files", "select", { data: { id: 7, sort_order: 0 }, error: null });
  const res = await makeHandler(db)(req("POST", "ideia-media-manage/i1/files", {
    r2_key: "contas/conta-1/files/u.png",
    thumbnail_r2_key: "contas/conta-1/files/u.thumb.webp",
    mime_type: "image/png", size_bytes: 5000, thumbnail_bytes: 2000, name: "a.png",
  }));
  assertEquals(res.status, 200);
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_file_insert_with_quota");
  assertEquals((rpc?.payload as any).p.uploaded_by, "user-1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test supabase/functions/__tests__/ideia-media-manage_test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `supabase/functions/ideia-media-manage/handler.ts`:

```ts
import { createJsonResponder } from "../_shared/http.ts";
import {
  presignIdeiaImage, finalizeIdeiaImage, listIdeiaImages, removeIdeiaImage,
} from "../_shared/ideia-media.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
}

export function createIdeiaMediaManageHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = {
      ...deps.buildCorsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    };
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const db = deps.createDb();
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);
    const conta_id = profile.conta_id as string;

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("ideia-media-manage");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];
    const ideiaId = seg[0] && seg[0] !== "upload-url" ? seg[0] : null;

    // GET ?ideia_id= -> list
    if (req.method === "GET") {
      const qid = url.searchParams.get("ideia_id");
      if (!qid) return json({ error: "ideia_id required" }, 400);
      const r = await listIdeiaImages({
        db: db as any, conta_id, cliente_id: null, ideia_id: qid, signGetUrl: deps.signGetUrl,
      });
      return json(r.body, r.status);
    }

    // POST /upload-url -> presign
    if (req.method === "POST" && seg[0] === "upload-url") {
      const body = await req.json().catch(() => ({}));
      const r = await presignIdeiaImage({
        db: db as any, conta_id, cliente_id: null,
        ideia_id: String(body.ideia_id ?? ""),
        filename: String(body.filename ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail: {
          mime_type: String(body.thumbnail?.mime_type ?? ""),
          size_bytes: Number(body.thumbnail?.size_bytes ?? 0),
        },
        signPutUrl: deps.signPutUrl,
      });
      return json(r.body, r.status);
    }

    // POST /:id/files -> finalize
    if (req.method === "POST" && ideiaId && seg[1] === "files") {
      const body = await req.json().catch(() => ({}));
      const r = await finalizeIdeiaImage({
        db: db as any, conta_id, cliente_id: null, ideia_id: ideiaId,
        r2_key: String(body.r2_key ?? ""),
        thumbnail_r2_key: String(body.thumbnail_r2_key ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail_bytes: Number(body.thumbnail_bytes ?? 0),
        name: String(body.name ?? "image"),
        width: body.width != null ? Number(body.width) : undefined,
        height: body.height != null ? Number(body.height) : undefined,
        blur_data_url: typeof body.blur_data_url === "string" ? body.blur_data_url : undefined,
        sort_order: body.sort_order != null ? Number(body.sort_order) : undefined,
        uploaded_by: user.id,
        headObject: deps.headObject,
        signGetUrl: deps.signGetUrl,
      });
      return json(r.body, r.status);
    }

    // DELETE /:id/files/:fileId -> remove
    if (req.method === "DELETE" && ideiaId && seg[1] === "files" && seg[2]) {
      const fileId = Number(seg[2]);
      if (Number.isNaN(fileId)) return json({ error: "invalid file id" }, 400);
      const r = await removeIdeiaImage({
        db: db as any, conta_id, cliente_id: null, ideia_id: ideiaId, file_id: fileId,
      });
      return json(r.body, r.status);
    }

    return json({ error: "Not found" }, 404);
  };
}
```

- [ ] **Step 4: Write `index.ts`**

Create `supabase/functions/ideia-media-manage/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signPutUrl, signGetUrl, headObject } from "../_shared/r2.ts";
import { createIdeiaMediaManageHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createIdeiaMediaManageHandler({
  buildCorsHeaders,
  // Service-role client; auth.getUser(token) still validates the caller's JWT.
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  signPutUrl,
  signGetUrl,
  headObject,
}));
```

- [ ] **Step 5: Register the function in `supabase/config.toml`**

Append next to the other self-authenticating functions. **`verify_jwt = false`** — every function in this repo sets this; the handler validates the JWT itself via `auth.getUser(token)` (exactly like `post-media-manage` and `file-upload-finalize`). Do NOT set `true`.

```toml
[functions.ideia-media-manage]
verify_jwt = false
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `deno test supabase/functions/__tests__/ideia-media-manage_test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ideia-media-manage/ supabase/functions/__tests__/ideia-media-manage_test.ts supabase/config.toml
git commit -m "feat(ideias): ideia-media-manage edge function (JWT) for CRM image management"
```

---

## Task 7: Hub types + API client functions

**Files:**
- Modify: `apps/hub/src/types.ts`
- Modify: `apps/hub/src/api.ts`

**Interfaces:**
- Produces: `IdeiaImage` type; `HubIdeia.images: IdeiaImage[]`; API fns
  `presignIdeiaImage(token, payload)`, `finalizeIdeiaImage(token, ideiaId, payload)`, `deleteIdeiaImage(token, ideiaId, fileId)`.

- [ ] **Step 1: Add the `IdeiaImage` type and `images` field**

In `apps/hub/src/types.ts`, find the `HubIdeia` interface. Add this interface just above it, and add `images` to `HubIdeia`:

```ts
export interface IdeiaImage {
  id: number;
  file_id: number;
  url: string;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
}
```

Add to the `HubIdeia` interface body:
```ts
  images: IdeiaImage[];
```

- [ ] **Step 2: Add the API client functions**

In `apps/hub/src/api.ts`, add `IdeiaImage` to the type import block. Then add these functions near the existing `createIdeia`/`updateIdeia`. Note: the file already has a `del(fn, id, token)` helper, but it builds `${fn}/${id}` — it can't express the `/:id/files/:fileId` path, so `deleteIdeiaImage` uses a direct `fetch` (mirroring the `BASE`/`ANON` pattern the other helpers use):

```ts
export function presignIdeiaImage(
  token: string,
  payload: {
    ideia_id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    thumbnail: { mime_type: string; size_bytes: number };
  },
) {
  return post<{
    upload_id: string;
    upload_url: string;
    r2_key: string;
    thumbnail_upload_url: string;
    thumbnail_r2_key: string;
  }>('hub-ideias/upload-url', { token, ...payload });
}

export function finalizeIdeiaImage(
  token: string,
  ideiaId: string,
  payload: {
    r2_key: string;
    thumbnail_r2_key: string;
    mime_type: string;
    size_bytes: number;
    thumbnail_bytes: number;
    name: string;
    width?: number;
    height?: number;
    blur_data_url?: string;
    sort_order?: number;
  },
) {
  return post<IdeiaImage>(`hub-ideias/${ideiaId}/files`, { token, ...payload });
}

export async function deleteIdeiaImage(token: string, ideiaId: string, fileId: number) {
  const res = await fetch(
    `${BASE}/functions/v1/hub-ideias/${ideiaId}/files/${fileId}?token=${encodeURIComponent(token)}`,
    { method: 'DELETE', headers: { apikey: ANON } },
  );
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}
```

> Note: `post<T>(fn, body)` builds `${BASE}/functions/v1/${fn}` — passing `'hub-ideias/upload-url'` as `fn` yields the correct sub-path URL. Confirm by reading `api.ts:post`.

- [ ] **Step 3: Typecheck**

Run: `npm run build:hub`
Expected: tsc passes (no type errors). If `IdeiaImage` import is unused warning appears, ensure it's referenced by `HubIdeia.images`.

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts
git commit -m "feat(hub): IdeiaImage type + idea image API client functions"
```

---

## Task 8: Hub upload service

**Files:**
- Create: `apps/hub/src/services/ideiaMedia.ts`
- Test: `apps/hub/src/services/__tests__/ideiaMedia.test.ts`

**Interfaces:**
- Consumes: `presignIdeiaImage`, `finalizeIdeiaImage` (Task 7).
- Produces: `IMAGE_MIME: string[]`, `MAX_IMAGE_BYTES`, `validateIdeiaImage(file)`, `uploadIdeiaImage({ token, ideiaId, file, sortOrder? }): Promise<IdeiaImage>`.

- [ ] **Step 1: Write the failing test**

Create `apps/hub/src/services/__tests__/ideiaMedia.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateIdeiaImage, IMAGE_MIME, MAX_IMAGE_BYTES } from '../ideiaMedia';

function fakeFile(type: string, size: number): File {
  const f = new File([new Uint8Array(1)], 'x', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateIdeiaImage', () => {
  it('accepts a normal jpeg', () => {
    expect(() => validateIdeiaImage(fakeFile('image/jpeg', 1000))).not.toThrow();
  });
  it('rejects non-image types', () => {
    expect(() => validateIdeiaImage(fakeFile('application/pdf', 1000))).toThrow();
  });
  it('rejects files over the size cap', () => {
    expect(() => validateIdeiaImage(fakeFile('image/png', MAX_IMAGE_BYTES + 1))).toThrow();
  });
  it('exposes the allowed mime list', () => {
    expect(IMAGE_MIME).toContain('image/webp');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- ideiaMedia`
Expected: FAIL — cannot find module `../ideiaMedia`.

- [ ] **Step 3: Implement the service**

Create `apps/hub/src/services/ideiaMedia.ts`:

```ts
import { presignIdeiaImage, finalizeIdeiaImage } from '../api';
import type { IdeiaImage } from '../types';

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function validateIdeiaImage(file: File) {
  if (!IMAGE_MIME.includes(file.type)) {
    throw new Error(`Tipo de arquivo não suportado: ${file.type}`);
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error('Imagem maior que 25 MB');
  }
}

const THUMB_SIZE = 256;
const BLUR_SIZE = 16;

function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function generateThumbnail(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(THUMB_SIZE / img.naturalWidth, THUMB_SIZE / img.naturalHeight, 1);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => blob
          ? resolve(new File([blob], 'thumb.webp', { type: 'image/webp' }))
          : reject(new Error('thumbnail failed')),
        'image/webp', 0.7,
      );
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function generateBlur(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = img.naturalWidth / img.naturalHeight;
      const w = ratio >= 1 ? BLUR_SIZE : Math.round(BLUR_SIZE * ratio);
      const h = ratio >= 1 ? Math.round(BLUR_SIZE / ratio) : BLUR_SIZE;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/webp', 0.2));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function putToR2(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload falhou: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Erro de rede no upload'));
    xhr.send(file);
  });
}

export async function uploadIdeiaImage(args: {
  token: string;
  ideiaId: string;
  file: File;
  sortOrder?: number;
}): Promise<IdeiaImage> {
  const { token, ideiaId, file, sortOrder } = args;
  validateIdeiaImage(file);

  const [{ width, height }, thumb, blur] = await Promise.all([
    probeImage(file),
    generateThumbnail(file),
    generateBlur(file).catch(() => undefined),
  ]);

  const signed = await presignIdeiaImage(token, {
    ideia_id: ideiaId,
    filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    thumbnail: { mime_type: 'image/webp', size_bytes: thumb.size },
  });

  await Promise.all([
    putToR2(signed.upload_url, file),
    putToR2(signed.thumbnail_upload_url, thumb),
  ]);

  return finalizeIdeiaImage(token, ideiaId, {
    r2_key: signed.r2_key,
    thumbnail_r2_key: signed.thumbnail_r2_key,
    mime_type: file.type,
    size_bytes: file.size,
    thumbnail_bytes: thumb.size,
    name: file.name,
    width,
    height,
    blur_data_url: blur,
    sort_order: sortOrder,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- ideiaMedia`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/services/ideiaMedia.ts apps/hub/src/services/__tests__/ideiaMedia.test.ts
git commit -m "feat(hub): idea image upload service (probe + thumbnail + blur + R2 flow)"
```

---

## Task 9: Hub UI — gallery + two-phase modal + picker

**Files:**
- Modify: `apps/hub/src/pages/IdeiasPage.tsx`

**Interfaces:**
- Consumes: `uploadIdeiaImage` (Task 8); `deleteIdeiaImage` (Task 7); `HubIdeia.images` + `IdeiaImage` (Task 7). (Size validation is inside `uploadIdeiaImage`.)
- Produces: gallery + remove controls on `IdeiaCard` (visible regardless of lock); two-phase create flow + image picker in `IdeiaModal`.

- [ ] **Step 1: Add imports + an `IdeiaImages` sub-component**

At the top of `apps/hub/src/pages/IdeiasPage.tsx`, extend imports:

```ts
import { useState, useRef } from 'react';
import { Plus, Trash2, Pencil, ExternalLink, X, Loader2, ImagePlus } from 'lucide-react';
import { fetchIdeias, createIdeia, updateIdeia, deleteIdeia, deleteIdeiaImage } from '../api';
import { uploadIdeiaImage } from '../services/ideiaMedia';
import type { HubIdeia, IdeiaImage } from '../types';
```

Add this sub-component (above `IdeiaCard`). It renders the gallery and an add button, and is reused by both the card and the modal. Because images are not lock-gated, it is always interactive when `token` is present and the idea exists:

```tsx
const MAX_IMAGES = 10;

function IdeiaImages({
  token,
  ideiaId,
  images,
  onChanged,
}: {
  token: string;
  ideiaId: string;
  images: IdeiaImage[];
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const atCap = images.length >= MAX_IMAGES;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr(null);
    setBusy(true);
    const slots = MAX_IMAGES - images.length;
    const chosen = Array.from(files).slice(0, slots);
    try {
      for (let i = 0; i < chosen.length; i++) {
        await uploadIdeiaImage({ token, ideiaId, file: chosen[i], sortOrder: images.length + i });
      }
      onChanged();
    } catch (e) {
      setErr((e as Error).message ?? 'Erro ao enviar imagem.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(fileId: number) {
    setBusy(true);
    try {
      await deleteIdeiaImage(token, ideiaId, fileId);
      onChanged();
    } catch (e) {
      setErr((e as Error).message ?? 'Erro ao remover imagem.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img) => (
            <div key={img.file_id} className="relative group">
              <a href={img.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={img.thumbnail_url ?? img.url}
                  alt=""
                  className="h-16 w-16 rounded-lg object-cover border border-stone-200 bg-stone-100"
                  style={img.blur_data_url ? { backgroundImage: `url(${img.blur_data_url})`, backgroundSize: 'cover' } : undefined}
                />
              </a>
              <button
                onClick={() => remove(img.file_id)}
                disabled={busy}
                aria-label="Remover imagem"
                className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-stone-900 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {!atCap && (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
          Adicionar imagem
        </button>
      )}
      {err && <p className="text-xs text-red-500">{err}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Render the gallery in `IdeiaCard`**

`IdeiaCard` currently receives `ideia`, `onEdit`, `onDelete`. Add a `token` and `onChanged` prop, and render `IdeiaImages` after the Links block. Update the `IdeiaCard` signature and the map call.

In the `IdeiaCard` props type, add:
```ts
  token: string;
  onChanged: () => void;
```

Right after the Links block (`{ideia.links.length > 0 && (...)}`), add:
```tsx
      {/* Images (not lock-gated — always manageable) */}
      <IdeiaImages
        token={token}
        ideiaId={ideia.id}
        images={ideia.images}
        onChanged={onChanged}
      />
```

In the list `.map(...)` in `IdeiasPage`, pass the new props:
```tsx
            <IdeiaCard
              key={ideia.id}
              ideia={ideia}
              token={token}
              onChanged={() => qc.invalidateQueries({ queryKey: ['hub-ideias', token] })}
              onEdit={() => openEdit(ideia)}
              onDelete={() => {
                deleteIdeia(token, ideia.id)
                  .then(() => qc.invalidateQueries({ queryKey: ['hub-ideias', token] }))
                  .catch((err) => alert(err.message));
              }}
            />
```

- [ ] **Step 3: Two-phase create in `IdeiaModal`**

The modal must support uploading images. For a NEW idea there is no `id`, so the modal first saves the text, then switches to edit mode for the now-real idea and reveals the picker.

Replace `IdeiaModal`'s state + `handleSave` with a two-phase flow. Add a `savedId` state and an `onSavedKeepOpen` callback to refresh the list while keeping the modal open:

```tsx
function IdeiaModal({ token, editing, onClose, onSaved }: ModalProps) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState(editing?.titulo ?? '');
  const [descricao, setDescricao] = useState(editing?.descricao ?? '');
  const [links, setLinks] = useState<string[]>(editing?.links.length ? editing.links : ['']);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ titulo?: string; descricao?: string }>({});
  // The idea this modal is editing: the existing one, or the one we just created.
  const [current, setCurrent] = useState<HubIdeia | null>(editing);

  function validate() {
    const e: typeof errors = {};
    if (!titulo.trim()) e.titulo = 'Título obrigatório';
    if (!descricao.trim()) e.descricao = 'Descrição obrigatória';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSaveText() {
    if (!validate()) return;
    setSaving(true);
    const cleanLinks = links.map((l) => l.trim()).filter(Boolean);
    try {
      if (current) {
        const { ideia } = await updateIdeia(token, current.id, {
          titulo: titulo.trim(), descricao: descricao.trim(), links: cleanLinks,
        });
        setCurrent({ ...current, ...ideia });
      } else {
        const { ideia } = await createIdeia(token, {
          titulo: titulo.trim(), descricao: descricao.trim(), links: cleanLinks,
        });
        // New idea has no images yet; keep modal open in edit mode so the
        // user can add images against the real ideia_id.
        setCurrent({ ...ideia, images: [], ideia_reactions: [] } as HubIdeia);
      }
      qc.invalidateQueries({ queryKey: ['hub-ideias', token] });
    } catch (err: unknown) {
      alert((err as Error).message ?? 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  function refreshCurrent() {
    qc.invalidateQueries({ queryKey: ['hub-ideias', token] });
    if (current) {
      // Re-read this idea's images from the refreshed cache after invalidation.
      fetchIdeias(token).then((d) => {
        const fresh = d.ideias.find((x) => x.id === current.id);
        if (fresh) setCurrent(fresh);
      }).catch(() => {});
    }
  }
```

Then update the modal JSX:
- Keep the title/descrição/links inputs as-is, but bind the primary button to `handleSaveText`.
- After the links block, render the image picker **only when `current` exists**:

```tsx
          {current && (
            <div>
              <label className="text-[12px] font-semibold text-stone-600 uppercase tracking-wide mb-1 block">
                Imagens{' '}
                <span className="text-stone-400 normal-case tracking-normal font-normal">
                  (até 10)
                </span>
              </label>
              <IdeiaImages
                token={token}
                ideiaId={current.id}
                images={current.images}
                onChanged={refreshCurrent}
              />
            </div>
          )}
```

- Update the footer buttons:

```tsx
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSaveText}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {current ? 'Salvar alterações' : 'Salvar e adicionar imagens'}
          </button>
          <button
            onClick={() => { onSaved(); }}
            className="px-4 py-2.5 rounded-lg border border-stone-200 text-sm text-stone-600 hover:bg-stone-50 transition-colors"
          >
            {current ? 'Concluir' : 'Cancelar'}
          </button>
        </div>
```

> `onSaved` already invalidates the query and closes the modal in `IdeiasPage`. Keep using it for "Concluir"/"Cancelar".

- [ ] **Step 4: Typecheck + build**

Run: `npm run build:hub`
Expected: tsc + vite build pass. Fix any type mismatch (e.g. `updateIdeia`/`createIdeia` return shape — confirm they return `{ ideia: HubIdeia }`; adjust destructuring to match `api.ts`).

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run: `npm run dev:hub:staging` and open a hub link. Create an idea → confirm the picker appears after saving → add 2 images → reload → images persist → remove one → it disappears.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/pages/IdeiasPage.tsx
git commit -m "feat(hub): idea image gallery + two-phase create modal with picker"
```

---

## Task 10: CRM store `image_count` + CRM upload service

**Files:**
- Modify: `apps/crm/src/services/postMedia.ts` (export 2 helpers)
- Create: `apps/crm/src/services/ideiaMedia.ts`
- Modify: `apps/crm/src/store/ideias.ts`

**Interfaces:**
- Consumes: `generateImageThumbnail`, `generateBlurDataUrl`, `probeImage` from `postMedia.ts`.
- Produces: `Ideia.image_count: number`; `getIdeias` selects it; CRM service
  `listIdeiaImages(ideiaId)`, `uploadIdeiaImage(ideiaId, file, sortOrder?)`, `removeIdeiaImage(ideiaId, fileId)`, type `CrmIdeiaImage`.

- [ ] **Step 1: Export the two reusable helpers from `postMedia.ts`**

In `apps/crm/src/services/postMedia.ts`, add `export` to the two currently-private functions:
```ts
export function generateBlurDataUrl(file: File): Promise<string> {
```
```ts
export function generateImageThumbnail(file: File): Promise<File> {
```
(`probeImage` is already exported.)

- [ ] **Step 2: Add `image_count` to `Ideia` and `getIdeias`**

In `apps/crm/src/store/ideias.ts`, add to the `Ideia` interface:
```ts
  image_count: number;
```

In `getIdeias`, add `ideia_files(count)` to the select string and map it. Replace the select + return:

```ts
  let q = supabase
    .from('ideias')
    .select(
      `
      id, workspace_id, cliente_id, titulo, descricao, links, status,
      comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
      clientes(nome),
      comentario_autor:membros!comentario_autor_id(nome),
      ideia_reactions(id, ideia_id, membro_id, emoji, created_at, membros(nome)),
      ideia_files(count)
    `,
    )
    .order('created_at', { ascending: false });

  if (filters.cliente_id) q = q.eq('cliente_id', filters.cliente_id);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    ...row,
    image_count: row.ideia_files?.[0]?.count ?? 0,
  })) as unknown as Ideia[];
```

- [ ] **Step 3: Create the CRM upload service**

Create `apps/crm/src/services/ideiaMedia.ts`:

```ts
import { supabase } from '../lib/supabase';
import { generateImageThumbnail, generateBlurDataUrl, probeImage } from './postMedia';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface CrmIdeiaImage {
  id: number;
  file_id: number;
  url: string;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
}

async function callFn<T>(method: 'GET' | 'POST' | 'DELETE', pathSuffix = '', body?: unknown, query?: Record<string, string>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const url = new URL(`${SUPABASE_URL}/functions/v1/ideia-media-manage${pathSuffix}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function putToR2(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload falhou: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Erro de rede no upload'));
    xhr.send(file);
  });
}

export function validateIdeiaImage(file: File) {
  if (!IMAGE_MIME.includes(file.type)) throw new Error(`Tipo não suportado: ${file.type}`);
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Imagem maior que 25 MB');
}

export async function listIdeiaImages(ideiaId: string): Promise<CrmIdeiaImage[]> {
  const { images } = await callFn<{ images: CrmIdeiaImage[] }>('GET', '', undefined, { ideia_id: ideiaId });
  return images;
}

export async function uploadIdeiaImage(
  ideiaId: string, file: File, sortOrder?: number,
): Promise<CrmIdeiaImage> {
  validateIdeiaImage(file);
  const [{ width, height }, thumb, blur] = await Promise.all([
    probeImage(file),
    generateImageThumbnail(file),
    generateBlurDataUrl(file).catch(() => undefined),
  ]);

  const signed = await callFn<{
    upload_id: string; upload_url: string; r2_key: string;
    thumbnail_upload_url: string; thumbnail_r2_key: string;
  }>('POST', '/upload-url', {
    ideia_id: ideiaId, filename: file.name, mime_type: file.type, size_bytes: file.size,
    thumbnail: { mime_type: 'image/webp', size_bytes: thumb.size },
  });

  await Promise.all([putToR2(signed.upload_url, file), putToR2(signed.thumbnail_upload_url, thumb)]);

  return callFn<CrmIdeiaImage>('POST', `/${ideiaId}/files`, {
    r2_key: signed.r2_key,
    thumbnail_r2_key: signed.thumbnail_r2_key,
    mime_type: file.type,
    size_bytes: file.size,
    thumbnail_bytes: thumb.size,
    name: file.name,
    width, height, blur_data_url: blur, sort_order: sortOrder,
  });
}

export async function removeIdeiaImage(ideiaId: string, fileId: number): Promise<void> {
  await callFn('DELETE', `/${ideiaId}/files/${fileId}`);
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: tsc + vite build pass.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services/postMedia.ts apps/crm/src/services/ideiaMedia.ts apps/crm/src/store/ideias.ts
git commit -m "feat(crm): ideia image service + image_count on getIdeias"
```

---

## Task 11: CRM `IdeiaDrawer` — Imagens section

**Files:**
- Modify: `apps/crm/src/components/ideias/IdeiaDrawer.tsx`

**Interfaces:**
- Consumes: `listIdeiaImages`, `uploadIdeiaImage`, `removeIdeiaImage`, `CrmIdeiaImage` (Task 10).
- Produces: an "Imagens" section in the drawer with gallery + upload + remove; uses TanStack Query keyed by `['ideia-images', ideia.id]`.

- [ ] **Step 1: Add imports + image query/mutations**

In `apps/crm/src/components/ideias/IdeiaDrawer.tsx`, add to imports:
```ts
import { useRef, useState } from 'react';
import { ExternalLink, Save, Loader2, ImagePlus, X } from 'lucide-react';
import {
  listIdeiaImages, uploadIdeiaImage, removeIdeiaImage, type CrmIdeiaImage,
} from '@/services/ideiaMedia';
```
(Keep the existing `useState` import; merge `useRef`.)

Inside `IdeiaDrawer`, after the `membros` query, add:

```tsx
  const MAX_IMAGES = 10;
  const inputRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);

  const { data: images = [] } = useQuery({
    queryKey: ['ideia-images', ideia.id],
    queryFn: () => listIdeiaImages(ideia.id),
  });

  async function handleImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImgBusy(true);
    const slots = MAX_IMAGES - images.length;
    const chosen = Array.from(files).slice(0, slots);
    try {
      for (let i = 0; i < chosen.length; i++) {
        await uploadIdeiaImage(ideia.id, chosen[i], images.length + i);
      }
      qc.invalidateQueries({ queryKey: ['ideia-images', ideia.id] });
      qc.invalidateQueries({ queryKey });
      toast.success('Imagem adicionada.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao enviar imagem.');
    } finally {
      setImgBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemoveImage(fileId: number) {
    setImgBusy(true);
    try {
      await removeIdeiaImage(ideia.id, fileId);
      qc.invalidateQueries({ queryKey: ['ideia-images', ideia.id] });
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover imagem.');
    } finally {
      setImgBusy(false);
    }
  }
```

- [ ] **Step 2: Render the Imagens section**

In the scrollable body (the `<div className="flex-1 overflow-y-auto ...">`), add this block after the Links section (and before the Status section):

```tsx
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Imagens
            </p>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {images.map((img: CrmIdeiaImage) => (
                  <div key={img.file_id} className="relative group">
                    <a href={img.url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={img.thumbnail_url ?? img.url}
                        alt=""
                        className="h-16 w-16 rounded-md object-cover border border-border bg-muted"
                      />
                    </a>
                    <button
                      onClick={() => handleRemoveImage(img.file_id)}
                      disabled={imgBusy}
                      aria-label="Remover imagem"
                      className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-foreground text-background opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {images.length < MAX_IMAGES && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={imgBusy}
                onClick={() => inputRef.current?.click()}
              >
                {imgBusy ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <ImagePlus size={13} className="mr-1.5" />}
                Adicionar imagem
              </Button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => handleImageFiles(e.target.files)}
            />
          </div>
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: tsc + vite build pass.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/components/ideias/IdeiaDrawer.tsx
git commit -m "feat(crm): Imagens section in IdeiaDrawer (upload + gallery + remove)"
```

---

## Task 12: Full verification + format/lint gates

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm run test`
Expected: PASS (including the new `ideiaMedia` Hub test). Fix any failure before continuing.

- [ ] **Step 2: Run the full edge function suite**

Run: `deno test supabase/functions/`
Expected: PASS (new `ideia-media`, `hub-ideias`, `ideia-media-manage` tests + all existing).

- [ ] **Step 3: Typecheck both apps**

Run: `npm run build && npm run build:hub`
Expected: both succeed.

- [ ] **Step 4: Run the CI gates (lint + format)**

Run: `npm run lint && npm run format:check`
Expected: both pass. If `format:check` fails, run `npm run format` (or the project's prettier write command) and re-commit. If a `deno.lock`/`node_modules` mismatch breaks the build after running `deno test`, restore with `git checkout deno.lock && npm ci` (documented project gotcha).

- [ ] **Step 5: Deploy the edge functions to staging and re-run the SQL smoke**

Run (both self-authenticate, so both deploy with `--no-verify-jwt`; `--use-api` because the local Docker bundler is broken in this repo):
```bash
npx supabase functions deploy hub-ideias --use-api --no-verify-jwt
npx supabase functions deploy ideia-media-manage --use-api --no-verify-jwt
```
Then apply the migration on staging via the SQL editor (do NOT `db push`) and re-run `scripts/verify-ideia-files.sql` there. Expected: `A3 PASS`.

- [ ] **Step 6: Manual end-to-end smoke (Hub + CRM)**

- Hub: create an idea, add images after save, reload (persist), remove one. Then in the CRM, open the same idea's drawer and confirm the images appear, add one as an internal user, and confirm the Hub reflects it on reload.
- Confirm lock-independence: in the CRM, set the idea status to `aprovada` (locks text edits in the Hub), then in the Hub confirm the image add/remove controls still work while the pencil/edit is hidden.

- [ ] **Step 7: Final commit (if format/lint produced changes)**

```bash
git add -A
git commit -m "chore(ideias): format + lint pass for idea image uploads"
```

---

## Notes for the implementer

- **Lock independence is a requirement, not a detail.** The image routes in `hub-ideias` must be placed before, and must never call, `checkLock`. The `hub-ideias_test.ts` "works on a LOCKED idea" test guards this.
- **The RPC is the only authority** for the cap and quota. The presign pre-checks are best-effort UX (fail fast before uploading bytes) and may race; never rely on them for correctness.
- **`uploaded_by`** is `null` for Hub uploads (no Supabase user) and the user id for CRM uploads.
- **Cross-tenant safety** is enforced by the composite FKs at the DB layer in addition to the per-request ownership checks — do not remove either.
- CI gate commands (confirmed in `package.json`): `npm run lint` (`eslint apps/ packages/`), `npm run format:check` (`prettier --check`), and `npm run format` (`prettier --write`) to fix formatting. Run all of these before pushing.
