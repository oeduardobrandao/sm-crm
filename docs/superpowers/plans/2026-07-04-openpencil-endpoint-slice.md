# Estúdio v2 — Slice 2: Endpoint (blob storage + HTTP contract) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `post-design-manage` speaks the frozen HTTP document contract (`.fig` bytes in R2, `x-rev`/`x-expected-rev`, 409/413), the v1 JSON doc paths and the v1 CRM editor UI are removed, and the forked editor is live-verified saving a real DK TESTE post through prod.

**Architecture:** `post_designs.doc` (jsonb) is superseded by an R2 blob pointer (`doc_r2_key`, deterministic per post) + endpoint-computed `doc_hash`; rev/staleness/summary columns keep working unchanged (the CRM drawer reads them via direct RLS select — zero drawer changes). New simple v2 RPCs replace the jsonb RPC family for create/save; deep validation, tipo-sync, and render triggering are explicitly **deferred to the doc-service slice** (render_status stays `pending`, publish gate keeps blocking designed posts — feature is dark). Starter documents are pregenerated `.fig` templates (built once by a Node script with `@open-pencil/core`, committed as base64) — no OpenPencil dependency in the Deno function.

**Tech Stack:** Supabase edge (Deno), R2 presign+fetch (per `_shared/r2.ts` house pattern), Node script for templates, Deno tests (deps-injected handler), prod deploy `--use-api`.

## Global Constraints

- The HTTP contract in `docs/estudio-v2-editor-contract.md` is FROZEN — implement it exactly (401/403/404/409/413 semantics, `x-rev` on GET/PUT, CORS exposing `x-rev`, allowing `authorization, x-expected-rev, content-type`).
- Blob cap: **10 MB** → 413. Blob key: `designs/{conta_id}/{post_id}.fig` (deterministic, overwritten each save; deleted on DELETE).
- `doc_hash` = sha256 hex of the blob bytes, computed in the endpoint; `is_stale` remains `doc_hash IS DISTINCT FROM rendered_doc_hash`.
- No validation/tipo-sync/render-trigger in this slice (doc-service slice); `updated_via='human'` for all editor PUTs.
- v1 rows are test data — the migration wipes `post_designs`/`design_asset_refs`. The old jsonb `doc` column goes nullable and unused (dropped at cutover, NOT now — deployed v1 fns still reference it).
- Migrations to prod go through the SQL editor + recorded version (db push is blocked by the dup-timestamp issue). ALWAYS `cat supabase/.temp/project-ref` before anything `--linked`.
- Edge deploys use `--use-api --no-verify-jwt`.
- CI parity before pushing: `npm run format` + lint + `npm run test` + `deno test supabase/functions/` (contract change → grep both suites for the old shape).
- MCP design tools keep their v1 code this slice — they are dark and their writes become inert against the new storage; the MCP slice rewrites them. Note this in the wrap-up.

---

### Task 1: Migration — wipe, blob columns, v2 RPCs

**Files:**
- Create: `supabase/migrations/20260704000001_post_designs_blob.sql`

**Interfaces:**
- Produces: columns `doc_r2_key text`, `doc_bytes integer`, `editor_version text` on `post_designs`; RPCs `get_or_create_post_design_blob(uuid, bigint, text, text, int, uuid)` and `save_post_design_blob(uuid, bigint, int, text, text, int, text, uuid)` (service_role only). The old doc-state trigger no longer fires on jsonb.

- [ ] **Step 1: Write the migration**

```sql
-- Estúdio v2 (OpenPencil): post_designs stores a .fig blob pointer instead of a jsonb doc.
-- v1 rows are dark-feature test data — wiped by decision (spec 2026-07-04, inventory §D3).

DELETE FROM design_asset_refs;
DELETE FROM post_designs;

ALTER TABLE post_designs
  ALTER COLUMN doc DROP NOT NULL,          -- v1 column, unused from now on; dropped at cutover
  ADD COLUMN doc_r2_key text,
  ADD COLUMN doc_bytes integer,
  ADD COLUMN editor_version text;

-- v1 trigger computed doc_hash/rev from the jsonb doc; v2 sets them explicitly in the RPCs.
DROP TRIGGER IF EXISTS post_designs_doc_state ON post_designs;

-- Get-or-create for the blob world. The caller uploads the starter blob to p_r2_key BEFORE
-- calling (deterministic key, overwrite-safe), so the row is never created pointing at nothing.
CREATE OR REPLACE FUNCTION get_or_create_post_design_blob(
  p_conta_id uuid, p_post_id bigint, p_r2_key text, p_doc_hash text, p_doc_bytes int,
  p_updated_by uuid
) RETURNS TABLE (o_id bigint, o_rev int, o_doc_hash text, o_created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_post posts%ROWTYPE; v_row post_designs%ROWTYPE; v_created boolean := false;
BEGIN
  SELECT p.* INTO v_post FROM posts p
    JOIN workflows w ON w.id = p.workflow_id
    JOIN clientes c ON c.id = w.cliente_id
   WHERE p.id = p_post_id AND c.conta_id = p_conta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found'; END IF;

  INSERT INTO post_designs (post_id, rev, doc_hash, doc_r2_key, doc_bytes, updated_via, render_status)
  VALUES (p_post_id, 1, p_doc_hash, p_r2_key, p_doc_bytes, 'human', 'pending')
  ON CONFLICT (post_id) DO NOTHING
  RETURNING * INTO v_row;
  IF FOUND THEN v_created := true;
  ELSE SELECT * INTO v_row FROM post_designs WHERE post_id = p_post_id; END IF;

  RETURN QUERY SELECT v_row.id, v_row.rev, v_row.doc_hash, v_created;
END $$;
REVOKE ALL ON FUNCTION get_or_create_post_design_blob(uuid, bigint, text, text, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_post_design_blob(uuid, bigint, text, text, int, uuid) TO service_role;

-- Rev-guarded save. Status editability enforced here (same list as v1's check_and_sync,
-- minus doc parsing): rascunho | revisao_interna | correcao_cliente.
CREATE OR REPLACE FUNCTION save_post_design_blob(
  p_conta_id uuid, p_post_id bigint, p_expected_rev int, p_doc_hash text, p_r2_key text,
  p_doc_bytes int, p_editor_version text, p_updated_by uuid
) RETURNS TABLE (o_rev int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_new_rev int;
BEGIN
  SELECT p.status INTO v_status FROM posts p
    JOIN workflows w ON w.id = p.workflow_id
    JOIN clientes c ON c.id = w.cliente_id
   WHERE p.id = p_post_id AND c.conta_id = p_conta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found'; END IF;
  IF v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente') THEN
    RAISE EXCEPTION 'status_not_editable';
  END IF;

  UPDATE post_designs
     SET rev = rev + 1, doc_hash = p_doc_hash, doc_r2_key = p_r2_key, doc_bytes = p_doc_bytes,
         editor_version = p_editor_version, updated_via = 'human', updated_at = now()
   WHERE post_id = p_post_id AND rev = p_expected_rev
  RETURNING rev INTO v_new_rev;
  IF NOT FOUND THEN RAISE EXCEPTION 'rev_conflict'; END IF;

  RETURN QUERY SELECT v_new_rev;
END $$;
REVOKE ALL ON FUNCTION save_post_design_blob(uuid, bigint, int, text, text, int, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_post_design_blob(uuid, bigint, int, text, text, int, text, uuid) TO service_role;
```

Adjust the tenancy JOIN chain to whatever v1's `post_design_check_and_sync` actually uses (read migration `20260702000001` lines 138–183 first — copy its post-lookup pattern verbatim, including the `workflow_posts` table name if that's the real one).

- [ ] **Step 2: Verify the SQL applies cleanly on a scratch schema** — run it in the Supabase SQL editor on **staging** first (memory: staging migrations are applied manually anyway). Expected: no errors; `\d post_designs` shows the new columns.

- [ ] **Step 3: Apply to prod** via SQL editor + record the version in `supabase_migrations.schema_migrations` (house procedure). Verify `cat supabase/.temp/project-ref` before touching anything `--linked`.

- [ ] **Step 4: Commit** (`git add supabase/migrations/20260704000001_post_designs_blob.sql && git commit -m "feat(estudio-v2): post_designs blob storage migration + v2 RPCs"`)

---

### Task 2: Starter `.fig` templates (generator script + generated module)

**Files:**
- Create: `scripts/estudio/package.json`, `scripts/estudio/build-starter-figs.mjs`
- Generate: `supabase/functions/post-design-manage/starter-templates.gen.ts`

**Interfaces:**
- Produces: `STARTER_TEMPLATES: Record<'feed' | 'carrossel' | 'reel_cover', string>` (base64 `.fig` bytes) + `starterTemplateFor(tipo: string)` helper, importable from the Deno handler.

- [ ] **Step 1: Script**

```json
// scripts/estudio/package.json
{ "name": "estudio-scripts", "private": true, "type": "module",
  "dependencies": { "@open-pencil/core": "0.13.2", "canvaskit-wasm": "0.41.1" } }
```

```js
// scripts/estudio/build-starter-figs.mjs — run: cd scripts/estudio && npm i && node build-starter-figs.mjs
import { writeFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/core/scene-graph'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const SIZES = { feed: [1080, 1350], carrossel: [1080, 1350], reel_cover: [1080, 1920] }

const out = {}
for (const [kind, [w, h]] of Object.entries(SIZES)) {
  const graph = new SceneGraph()
  const page = graph.addPage('Canvas')
  graph.createNode('FRAME', page.id, {
    name: '1', x: 0, y: 0, width: w, height: h,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
  })
  computeAllLayouts(graph)
  const { data } = await io.writeDocument('fig', graph)
  out[kind] = Buffer.from(data).toString('base64')
  console.log(`${kind}: ${data.length} bytes`)
}

const ts = `// GENERATED by scripts/estudio/build-starter-figs.mjs — do not edit.
// Starter .fig documents (one preset frame each) minted on first GET of a design.
export const STARTER_TEMPLATES: Record<"feed" | "carrossel" | "reel_cover", string> = ${JSON.stringify(out, null, 2)};

export function starterTemplateFor(tipo: string): Uint8Array | null {
  const kind = tipo === "feed" ? "feed" : tipo === "carrossel" ? "carrossel" : tipo === "reels" ? "reel_cover" : null;
  if (!kind) return null;
  return Uint8Array.from(atob(STARTER_TEMPLATES[kind]), (c) => c.charCodeAt(0));
}
`
await writeFile('../../supabase/functions/post-design-manage/starter-templates.gen.ts', ts)
console.log('starter-templates.gen.ts written')
```

- [ ] **Step 2: Run it and sanity-check** — `cd scripts/estudio && npm i && node build-starter-figs.mjs`. Expected: three sizes logged (each roughly 1–30 KB), file generated. Load one back through the spike's `01-roundtrip.mjs` pattern (or a 5-line node -e) asserting `getPages()` finds "Canvas" with one frame.
- [ ] **Step 3: Commit** script + generated module. Add `scripts/estudio/node_modules` to `.gitignore` if not covered.

---

### Task 3: Endpoint rework — /blob routes + rewritten Deno tests

**Files:**
- Modify: `supabase/functions/post-design-manage/handler.ts` (remove JSON GET/PUT + starter-doc/validation plumbing; add `GET /blob`, `PUT /blob`; keep DELETE + `POST /brand-logo`)
- Modify: `supabase/functions/post-design-manage/index.ts` (new deps wiring: v2 RPCs, R2 blob get/put/delete, remove design-doc/validation imports)
- Rewrite: `supabase/functions/__tests__/post-design-manage_test.ts`

**Interfaces:**
- Consumes: `starterTemplateFor` (Task 2), v2 RPCs (Task 1), `signPutUrl`/`signGetUrl`/`deleteObject` from `_shared/r2.ts`.
- Produces (frozen contract): `GET /blob?post_id=` → bytes + `x-rev`; `PUT /blob?post_id=` + `x-expected-rev` → `x-rev` | 409 | 413. Deps shape for tests:

```ts
// new deps (replacing getCoverFileId/getExistingDesign/getOrCreateDesign/updateDesign/checkFileIds…)
getDesignMeta: (postId: number, contaId: string) =>
  Promise<{ id: number; rev: number; doc_r2_key: string | null } | null>;
getOrCreateDesignBlob: (contaId: string, postId: number, r2Key: string, docHash: string,
  docBytes: number, updatedBy: string) => Promise<{ rev: number; created: boolean }>;
saveDesignBlob: (contaId: string, postId: number, expectedRev: number, docHash: string,
  r2Key: string, docBytes: number, editorVersion: string | null, updatedBy: string,
) => Promise<{ rev: number }>;          // throws {code:'rev_conflict'} | {code:'status_not_editable'}
fetchBlob: (r2Key: string) => Promise<Uint8Array | null>;
putBlob: (r2Key: string, bytes: Uint8Array) => Promise<void>;
deleteBlob: (r2Key: string) => Promise<void>;
```

- [ ] **Step 1: Rewrite the test file first.** Cases (deps mocked; follow the existing test file's harness style):
  1. `GET /blob` without token → 401; bad token → 401. Feature gate off → 403. Unknown post → 404.
  2. `GET /blob` no design row → mints: `putBlob` called with the tipo's starter template under `designs/{conta}/{post}.fig`, `getOrCreateDesignBlob` called, response 200, body = template bytes, `x-rev: 1`.
  3. `GET /blob` existing design → `fetchBlob(doc_r2_key)`, 200, stored bytes, `x-rev` = row rev, and `putBlob`/create NOT called.
  4. `PUT /blob` happy: body bytes → `putBlob` with same deterministic key → `saveDesignBlob` with sha256 hex of the body and the parsed `x-expected-rev` → 200 + `x-rev` = new rev.
  5. `PUT /blob` rev conflict: `saveDesignBlob` throws `rev_conflict` → 409 (and response body is generic — no internals).
  6. `PUT /blob` status not editable → 409? NO — v1 used 409 for status guard; contract has no status code for it → use **403** (not-allowed-now), assert that.
  7. `PUT /blob` body > 10 MB → 413 and `putBlob` NOT called. Empty body → 422.
  8. `DELETE` → deletes row (RPC) + `deleteBlob` with the design's key.
  9. CORS preflight on /blob allows `authorization, x-expected-rev, content-type` and exposes `x-rev`.
  10. `POST /brand-logo` still works (existing cases keep passing — keep those tests).
- [ ] **Step 2: Run tests → fail** (`deno test supabase/functions/__tests__/post-design-manage_test.ts`).
- [ ] **Step 3: Implement handler + wiring.** Key snippets:

```ts
// handler.ts — route: GET /blob
const key = `designs/${contaId}/${postId}.fig`;
let meta = await deps.getDesignMeta(postId, contaId);
if (!meta || !meta.doc_r2_key) {
  const template = starterTemplateFor(post.tipo);
  if (!template) return json(422, { error: "tipo_sem_estudio" });
  await deps.putBlob(key, template);
  const created = await deps.getOrCreateDesignBlob(contaId, postId, key, await sha256Hex(template), template.length, user.id);
  return bytesResponse(template, created.rev);
}
const bytes = await deps.fetchBlob(meta.doc_r2_key);
if (!bytes) return json(404, { error: "design_blob_missing" }); // R2/DB drift — log internally
return bytesResponse(bytes, meta.rev);

// handler.ts — route: PUT /blob
const expected = Number(req.headers.get("x-expected-rev"));
if (!Number.isInteger(expected) || expected < 1) return json(422, { error: "expected_rev_invalido" });
const body = new Uint8Array(await req.arrayBuffer());
if (body.length === 0) return json(422, { error: "corpo_vazio" });
if (body.length > 10 * 1024 * 1024) return json(413, { error: "documento_grande_demais" });
const revKey = `designs/${contaId}/${postId}-r${expected + 1}.fig`; // rev-scoped: a lost save race can't clobber the winner's bytes
await deps.putBlob(revKey, body);
try {
  const { rev } = await deps.saveDesignBlob(contaId, postId, expected, await sha256Hex(body), revKey, body.length, req.headers.get("x-editor-version"), user.id);
  return new Response("ok", { status: 200, headers: { ...cors, "x-rev": String(rev) } });
} catch (e) {
  if (isCode(e, "rev_conflict")) return json(409, { error: "rev_desatualizada" });
  if (isCode(e, "status_not_editable")) return json(403, { error: "status_nao_editavel" });
  throw e;
}
```

`sha256Hex` via `crypto.subtle.digest("SHA-256", …)`. `bytesResponse` sets `content-type: application/octet-stream`, `x-rev`, `cache-control: no-store`, and the CORS headers. `index.ts` wires `fetchBlob`/`putBlob` via `signGetUrl`/`signPutUrl` + `fetch` with `AbortSignal.timeout(10_000)` (the r2.ts house pattern — never the SDK's PutObject). NOTE the PUT ordering: blob upload BEFORE the guarded RPC means a lost race leaves the winner's row pointing at the loser's bytes for the deterministic key — prevent that by writing to `designs/{conta}/{post}-r{expected+1}.fig` (rev-scoped key) instead, passing that key to the RPC, and best-effort deleting the previous key after success. Update tests' key expectations accordingly; GET then always reads `doc_r2_key` from the row.
- [ ] **Step 4: Tests green** (`deno test supabase/functions/__tests__/`), including `config-audit_test.ts` (fn stays `verify_jwt = false`) and untouched brand-logo cases. Fix any test elsewhere that referenced the removed JSON GET/PUT shape (grep `post-design-manage` across `supabase/functions/__tests__` and `apps/**/__tests__`).
- [ ] **Step 5: Commit** (`feat(estudio-v2): post-design-manage speaks the blob contract`)

---

### Task 4: Remove the v1 editor UI from the CRM

**Files:**
- Delete: `apps/crm/src/pages/estudio/` (entire tree incl. `__tests__`)
- Create: `apps/crm/src/pages/estudio/EstudioPage.tsx` (minimal stub — route + gate survive; iframe shell arrives in the CRM-shell slice)
- Modify: `apps/crm/src/main.tsx` (route entries — DATA router), `apps/crm/tsconfig.json` + `apps/crm/vite.config.ts` (drop `@mesaas/design-doc` / `@mesaas/design-render-tree` aliases if now unreferenced), `package.json` (drop `satori`, resvg/mozjpeg wasm deps if CRM-only), `test/vitest.setup.ts` / `vitest.config.ts` (satori shims)
- Keep untouched: `store/postDesigns.ts`, `WorkflowDrawer`, `PostMediaGallery` (all read summary columns that survived)

**Interfaces:**
- Produces: CRM builds and tests green with zero references to the v1 editor internals.

- [ ] **Step 1: Delete + stub.** Stub keeps the lazy route working:

```tsx
// apps/crm/src/pages/estudio/EstudioPage.tsx — placeholder until the CRM-shell slice
export default function EstudioPage() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '2rem' }}>
      <p>O novo Estúdio está em construção.</p>
    </div>
  )
}
```

- [ ] **Step 2: Chase the graph.** `npm run build` (tsc) and fix every dangling import (main.tsx routes, any WorkflowDrawer import of estudio types — replace with local types or the `postDesigns.ts` summary). Grep: `rg "pages/estudio|@mesaas/design-doc|design-render-tree|useSatoriRenderer|satori" apps/ test/ vitest.config.ts` until only the stub remains.
- [ ] **Step 3: Test suite green.** `npm run test` — delete/adjust suites that tested deleted code; keep drawer/gallery tests passing unchanged. If the coverage ratchet moves because tested LOC left the tree, adjust the ratchet file to the honest new number in this commit and say so in the commit message.
- [ ] **Step 4: CI parity.** `npm run format && npm run lint` (per CI-gates memory), then commit (`refactor(estudio-v2): remove v1 editor UI — 17k LOC; stub route pending CRM shell`).

---

### Task 5: Deploy + live E2E against prod

**Files:** none new (evidence goes in NOTES + the wrap-up)

- [ ] **Step 1: Deploy** — confirm `cat supabase/.temp/project-ref` is prod, then `npx supabase functions deploy post-design-manage --use-api --no-verify-jwt`.
- [ ] **Step 2: Contract smoke via curl** (prod, DK TESTE): obtain a session token (log into the CRM as the dev user in the preview browser; read `sb-*-auth-token` from localStorage). Then:
  - `GET /blob?post_id=<dk-teste dev post>` with the Bearer → 200, `x-rev: 1`, body starts with `fig-kiwi` magic → save to a file, open it in the local fork editor (standalone `bun --bun run dev`, File→open) to prove the minted template is valid.
  - `PUT` it back with `x-expected-rev: 1` → 200 `x-rev: 2`; replay with `x-expected-rev: 1` → 409.
  - No token → 401; nonexistent post → 404.
- [ ] **Step 3: Full editor loop against prod:** serve the local fork (`bun --bun run dev`), open the host page (`spike/openpencil/embed.html`) modified inline to point `docUrl` at the prod `/blob?post_id=…` and send the real Bearer via the `auth` message. Verify in the bridge log: `doc:loaded` → edit → `save:ok rev=N` → prod `post_designs` row shows the new rev/hash (`select rev, doc_bytes, is_stale from post_designs where post_id = …`) → reload → edit persisted. This is the slice's acceptance test.
- [ ] **Step 4: Record** timings + evidence in `spike/openpencil/NOTES.md` (slice 2 section).

---

### Task 6: Docs + wrap-up

- [ ] **Step 1:** Update `docs/estudio-v2-editor-contract.md`: fill in the real `docUrl` shape (`${SUPABASE_URL}/functions/v1/post-design-manage/blob?post_id=…`), the 403 status-guard mapping, the rev-scoped blob key note, and mark the HTTP contract IMPLEMENTED.
- [ ] **Step 2:** Note in the wrap-up report: MCP design tools (v1 code, dark) are now inert against blob storage — rewritten in the MCP slice; render pipeline intentionally not wired — doc-service slice.
- [ ] **Step 3:** Commit remaining docs, update memory (slice 2 state, gotchas discovered), report with evidence.
