# Report Image Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Imagem" block to the block-based report: upload or pick from the client's Arquivos, choose orientation/ratio/fit/focal point, render in the CRM editor, the Hub and the PDF.

**Architecture:** The layout stores only `file_id` + dimensions + display settings in the block `config`, never a key or URL. A `report_document_files` link table (composite FKs by `conta_id`, maintained by a trigger on `report_documents.layout`) bumps `files.reference_count`, so Arquivos refuses to delete an image in use. URLs are signed at read time: `hub-report-docs` signs from the link table for the Hub/print page; the CRM editor resolves blob URLs through the existing `useFileUrl`.

**Tech Stack:** React 19 + TanStack Query (CRM, Hub), shared `packages/report-blocks`, Supabase Postgres (plpgsql triggers, RLS), Deno edge functions, Vitest, `deno test`, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-10-02-report-image-block-design.md` (read it before starting; this plan implements it task by task).
**Mockups:** https://claude.ai/artifact/6nuyyYwqYQiCtwHtb9gN18

## Global Constraints

- All user-facing copy is pt-BR, sentence case, **no em dashes** (use a period or colon).
- Icons: `lucide-react` only. Toasts: `toast()` from `sonner`.
- `packages/report-blocks` is shared CRM+Hub: **never import `@/`** inside it.
- Ratios: `original`, `16:9`, `3:2`, `4:3`, `1:1`, `4:5`, `3:4`, `2:3`, `9:16`. Fits: `cover`, `contain`. Focal steps: `0`, `0.5`, `1`.
- Caption ≤ 200 chars; alt ≤ 300 chars. `width`/`height` positive integers ≤ 999999. `file_id` positive integer.
- `config.src` and `config.r2_key` are **never persisted** (rejected by TS and DB validation).
- Accepted image mimes: `image/jpeg`, `image/png`, `image/webp` (no GIF). Client upload limit 10 MB; downscale to ≤ 2400 px on the longest side.
- Vertical cap: rendered image height ≤ 560 px (frame width = `min(100%, 560px * ratio)`).
- Migration filenames: unique timestamp prefix **above main's tail at PR time** (this plan uses `20261003000001` and `20261003000002`; renumber before `gh pr create` if main moved).
- `useBlocker` is forbidden in the apps; uploads go through `uploadFile` (already wrapped in `trackUnsavedWork`).
- Edge functions: never return raw error details; CORS via `buildCorsHeaders(req)`.
- Run commands from the worktree root: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/avulsos-history-button-6242bd`.

## Deviation from the spec (recorded)

The spec says the autoclean migration replaces **both** `storage_autoclean_candidates` and `storage_autoclean_run`. Only the candidates predicate changes here. The hard guarantee is the FK: `report_document_files.file_id` references `files`, so the run's final `DELETE` can never remove a linked file; at worst a link created mid-run makes that DELETE fail and the run abort (READ COMMITTED re-checks locked rows, but the `NOT EXISTS` subquery keeps the statement snapshot). The candidates guard is what keeps normal runs from selecting linked files and failing. Task 2 updates the spec line to match.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/report-docs/layout.ts` (modify) | `image` type, image constants, `validateLayout` image rules, `sanitizeLayoutForTemplate` |
| `supabase/functions/_shared/report-docs/layout.test.ts` (modify) | Deno tests for the above |
| `packages/report-blocks/types.ts` (modify) | re-export new symbols |
| `packages/report-blocks/image.ts` (create) | `readImageConfig`, `imageAspect`, `isRenderableSrc` (pure, shared by renderer + editor) |
| `packages/report-blocks/blocks/ImageBlock.tsx` (create) | view/print renderer |
| `packages/report-blocks/{BlockRenderer.tsx,catalog.ts,data-presence.ts,styles.css}` (modify) | register block, catalog entry, has-data, CSS |
| `supabase/migrations/20261003000001_report_image_block.sql` (create) | layout validation, link table, sync trigger, autoclean guard |
| `supabase/migrations/20261003000002_client_reports_folder.sql` (create) | `client_reports` source type + `get_or_create_client_reports_folder` RPC |
| `supabase/tests/entitlements/99_report_image_files.sql` (create) | SQL suite for both migrations |
| `supabase/tests/entitlements/63_storage_autoclean.sql` (modify) | autoclean report-link case |
| `supabase/functions/hub-report-docs/sign-images.ts` (create) | `signImageBlocks` |
| `supabase/functions/hub-report-docs/{handlers.ts,index.ts,handlers.test.ts}` (modify) | wire signing |
| `supabase/functions/report-docs/generate.ts` (modify) | sanitize template layout server-side |
| `supabase/functions/sign-r2-urls/handler.ts` + `__tests__/sign-r2-urls_test.ts` (modify) | accept own `<conta>/` copy keys |
| `supabase/functions/file-manage/handler.ts` + `__tests__/file-manage_test.ts` (modify) | 409 scoped by conta + `linked_reports` |
| `apps/crm/src/services/fileService.ts` (modify) | re-export `FileApiError`, `getClientReportsFolderId`, `getClientFolderId` |
| `apps/crm/src/services/fileApiError.ts` (create) | `FileApiError` (own module so tests mocking `fileService` keep the real class) |
| `apps/crm/src/pages/arquivos/components/FileGrid.tsx` (modify) | generic "Em uso" column/badge copy |
| `apps/crm/src/pages/arquivos/fileInUse.ts` (create) | `fileInUseMessage` |
| `apps/crm/src/pages/arquivos/components/{FileContextMenu,FolderInfoModal,FilePickerModal}.tsx` (modify) | server-driven in-use message, picker single mode |
| `apps/crm/src/pages/arquivos/types.ts` (modify) | `Folder.source_type` gains `'client_reports'` |
| `apps/crm/src/hooks/useFileUrl.ts` (modify) | skip lost / non-image files |
| `apps/crm/src/pages/relatorio-editor/reportImageUpload.ts` (create) | validate + downscale for report images |
| `apps/crm/src/pages/relatorio-editor/ImageBlockEditor.tsx` (create) | editor states, upload, picker, popover host |
| `apps/crm/src/pages/relatorio-editor/ImageSettingsPanel.tsx` (create) | popover body (orientation, ratio, fit, focal, caption, alt) |
| `apps/crm/src/pages/relatorio-editor/{EditorCanvas,RelatorioEditorPage,ModeloEditorPage,layoutOps,templateOps,widgetIcons,SaveTemplateDialog,templateAutosave,ApplyTemplateDialog}.tsx/ts` (modify) | wiring |
| `apps/crm/src/services/reportTemplates.ts` (modify) | use `sanitizeLayoutForTemplate` |
| `apps/crm/style.css` (modify) | editor CSS for the image block |

---

### Task 1: Shared schema: `image` block type, validation, template sanitizer

**Files:**
- Modify: `supabase/functions/_shared/report-docs/layout.ts`
- Modify: `supabase/functions/_shared/report-docs/layout.test.ts`
- Modify: `packages/report-blocks/types.ts`

**Interfaces:**
- Produces (exported from `layout.ts`, re-exported from `@mesaas/report-blocks/types`):
  - `IMAGE_RATIOS: readonly ["original","16:9","3:2","4:3","1:1","4:5","3:4","2:3","9:16"]`, `type ImageRatio`
  - `IMAGE_FITS: readonly ["cover","contain"]`, `type ImageFit`
  - `IMAGE_FOCAL_STEPS: readonly [0, 0.5, 1]`
  - `IMAGE_CAPTION_MAX = 200`, `IMAGE_ALT_MAX = 300`
  - `IMAGE_TEMPLATE_STRIP_KEYS: readonly ["file_id","width","height","caption","alt"]`
  - `sanitizeLayoutForTemplate(layout: ReportLayout): ReportLayout`
  - `BLOCK_TYPES` includes `"image"` (27 types).

- [ ] **Step 1: Write the failing tests** (append to `layout.test.ts`; also change the count test)

Replace the existing count test:

```ts
Deno.test("catálogo tem os 27 tipos (26 + image de 2026-10)", () => {
  assertEquals(BLOCK_TYPES.length, 27);
  assert((BLOCK_TYPES as readonly string[]).includes("image"));
});
```

Add the import of `sanitizeLayoutForTemplate` to the existing import list from `./layout.ts`, then append:

```ts
const img = (config?: Record<string, unknown>) =>
  block({ id: "i1", type: "image", size: "full", ...(config ? { config } : {}) });

Deno.test("validateLayout: bloco image vazio e preenchido válidos", () => {
  assert(validateLayout(layout([img()])).ok);
  assert(validateLayout(layout([img({
    file_id: 42, width: 1600, height: 900, ratio: "16:9", fit: "cover",
    focal: { x: 0.5, y: 0 }, caption: "Legenda", alt: "Descrição",
  })])).ok);
});

Deno.test("validateLayout: image rejeita src, r2_key e enums inválidos", () => {
  assert(!validateLayout(layout([img({ src: "https://x" })])).ok);
  assert(!validateLayout(layout([img({ r2_key: "contas/x/files/a.png" })])).ok);
  assert(!validateLayout(layout([img({ ratio: "5:4" })])).ok);
  assert(!validateLayout(layout([img({ fit: "stretch" })])).ok);
  assert(!validateLayout(layout([img({ focal: { x: 0.3, y: 0 } })])).ok);
  assert(!validateLayout(layout([img({ focal: "center" })])).ok);
});

Deno.test("validateLayout: image exige file_id inteiro positivo com width/height", () => {
  assert(!validateLayout(layout([img({ file_id: 0, width: 1, height: 1 })])).ok);
  assert(!validateLayout(layout([img({ file_id: 1.5, width: 1, height: 1 })])).ok);
  assert(!validateLayout(layout([img({ file_id: 3 })])).ok);
  assert(!validateLayout(layout([img({ file_id: 3, width: 0, height: 10 })])).ok);
  assert(!validateLayout(layout([img({ file_id: 3, width: 1_000_000, height: 10 })])).ok);
});

Deno.test("validateLayout: image limita caption e alt", () => {
  assert(validateLayout(layout([img({ caption: "a".repeat(200), alt: "b".repeat(300) })])).ok);
  assert(!validateLayout(layout([img({ caption: "a".repeat(201) })])).ok);
  assert(!validateLayout(layout([img({ alt: "b".repeat(301) })])).ok);
  assert(!validateLayout(layout([img({ caption: 5 })])).ok);
});

Deno.test("sanitizeLayoutForTemplate: tira texto de IA e o conteúdo da imagem", () => {
  const input: ReportLayout = {
    version: LAYOUT_VERSION,
    blocks: [
      { id: "a", type: "ai_summary", size: "full", text: { type: "doc" } },
      { id: "t", type: "text", size: "full", text: { type: "doc" } },
      {
        id: "i", type: "image", size: "half",
        config: { file_id: 9, width: 10, height: 20, ratio: "4:5", fit: "contain",
          focal: { x: 0, y: 1 }, caption: "c", alt: "a" },
      },
    ],
  };
  const out = sanitizeLayoutForTemplate(input);
  assertEquals(out.blocks[0], { id: "a", type: "ai_summary", size: "full" });
  assertEquals(out.blocks[1], input.blocks[1]);
  assertEquals(out.blocks[2], {
    id: "i", type: "image", size: "half",
    config: { ratio: "4:5", fit: "contain", focal: { x: 0, y: 1 } },
  });
  assert(validateLayout(out).ok);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --no-check supabase/functions/_shared/report-docs/layout.test.ts`
Expected: FAIL (count is 26, `sanitizeLayoutForTemplate` not exported).

- [ ] **Step 3: Implement in `layout.ts`**

Add `"image"` to `BLOCK_TYPES` right after `"tags_table"` under a new comment `// Mídia`. Below `TOP_POSTS_MAX` add:

```ts
export const IMAGE_RATIOS = [
  "original", "16:9", "3:2", "4:3", "1:1", "4:5", "3:4", "2:3", "9:16",
] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];
export const IMAGE_FITS = ["cover", "contain"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];
export const IMAGE_FOCAL_STEPS = [0, 0.5, 1] as const;
export const IMAGE_CAPTION_MAX = 200;
export const IMAGE_ALT_MAX = 300;
const IMAGE_DIM_MAX = 999_999;
/** Campos que identificam o CONTEÚDO de uma imagem: nunca viajam num modelo
 * (decisão 1 do spec 2026-10-02). Espelhado em report_image_config_ok() no SQL. */
export const IMAGE_TEMPLATE_STRIP_KEYS = ["file_id", "width", "height", "caption", "alt"] as const;
const AI_TEXT_TYPES: readonly BlockType[] = ["ai_summary", "ai_recommendations", "ai_goals"];

function isPosInt(v: unknown, max: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max;
}

/** Espelho TS de report_image_config_ok() (migration 20261003000001). */
function imageConfigError(cfg: Record<string, unknown> | undefined): string | null {
  if (!cfg) return null;
  if ("src" in cfg || "r2_key" in cfg) return "image config must not carry src or r2_key";
  if (cfg.ratio !== undefined && !(IMAGE_RATIOS as readonly unknown[]).includes(cfg.ratio)) {
    return "invalid image ratio";
  }
  if (cfg.fit !== undefined && !(IMAGE_FITS as readonly unknown[]).includes(cfg.fit)) {
    return "invalid image fit";
  }
  if (cfg.focal !== undefined) {
    const f = cfg.focal;
    if (
      !isRecord(f) ||
      !(IMAGE_FOCAL_STEPS as readonly unknown[]).includes(f.x) ||
      !(IMAGE_FOCAL_STEPS as readonly unknown[]).includes(f.y)
    ) return "invalid image focal";
  }
  if (cfg.file_id !== undefined && !isPosInt(cfg.file_id, Number.MAX_SAFE_INTEGER)) {
    return "invalid image file_id";
  }
  for (const k of ["width", "height"] as const) {
    if (cfg[k] !== undefined && !isPosInt(cfg[k], IMAGE_DIM_MAX)) return `invalid image ${k}`;
  }
  if (cfg.file_id !== undefined && (cfg.width === undefined || cfg.height === undefined)) {
    return "image with file_id needs width and height";
  }
  if (
    cfg.caption !== undefined &&
    (typeof cfg.caption !== "string" || cfg.caption.length > IMAGE_CAPTION_MAX)
  ) return "invalid image caption";
  if (cfg.alt !== undefined && (typeof cfg.alt !== "string" || cfg.alt.length > IMAGE_ALT_MAX)) {
    return "invalid image alt";
  }
  return null;
}
```

Note: `isRecord` is declared later in the file as a function declaration (hoisted), so it is usable here.

Inside the `validateLayout` block loop, after the `cover` branch, add:

```ts
    if (b.type === "image") {
      const err = imageConfigError(b.config as Record<string, unknown> | undefined);
      if (err) return { ok: false, error: err };
    }
```

At the end of the file add:

```ts
/** Layout de relatório -> layout de modelo (spec 2026-10-02, "Modelos"): tira o
 * texto dos blocos ai_* (regenerados por relatório) e o conteúdo dos blocos
 * image (o modelo guarda só o espaço). Pura; usada pelo CRM e por generate.ts. */
export function sanitizeLayoutForTemplate(layout: ReportLayout): ReportLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((b) => {
      if (AI_TEXT_TYPES.includes(b.type) && b.text !== undefined) {
        const { text: _drop, ...rest } = b;
        return rest as ReportBlock;
      }
      if (b.type === "image" && b.config) {
        const config = { ...b.config };
        for (const k of IMAGE_TEMPLATE_STRIP_KEYS) delete config[k];
        return { ...b, config };
      }
      return b;
    }),
  };
}
```

- [ ] **Step 4: Re-export from the package.** In `packages/report-blocks/types.ts`, extend the two existing re-export lists:

```ts
export type {
  // ...existing names...
  ImageRatio,
  ImageFit,
} from '../../supabase/functions/_shared/report-docs/layout';
export {
  // ...existing names...
  IMAGE_RATIOS,
  IMAGE_FITS,
  IMAGE_FOCAL_STEPS,
  IMAGE_CAPTION_MAX,
  IMAGE_ALT_MAX,
  sanitizeLayoutForTemplate,
} from '../../supabase/functions/_shared/report-docs/layout';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test --no-check supabase/functions/_shared/report-docs/layout.test.ts`
Expected: PASS.
Run: `npm run check:functions`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/report-docs/layout.ts supabase/functions/_shared/report-docs/layout.test.ts packages/report-blocks/types.ts
git commit -m "feat(relatorio): tipo de bloco image, validação e sanitizador de modelo"
```

(Every commit in this plan ends with the blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.)

---

### Task 2: Migration: image validation in the DB, link table, sync trigger, autoclean guard

**Files:**
- Create: `supabase/migrations/20261003000001_report_image_block.sql`
- Create: `supabase/tests/entitlements/99_report_image_files.sql`
- Modify: `supabase/tests/entitlements/63_storage_autoclean.sql`
- Modify: `docs/superpowers/specs/2026-10-02-report-image-block-design.md` (autoclean sentence, see "Deviation")

**Interfaces:**
- Produces: table `report_document_files(report_id uuid, file_id bigint, conta_id uuid)`; SQL function `report_image_config_ok(jsonb, boolean)`; trigger `trg_report_document_files_sync`.

- [ ] **Step 1: Write the SQL suite first** (`supabase/tests/entitlements/99_report_image_files.sql`)

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Bloco de imagem do relatório (migration 20261003000001, spec 2026-10-02).
-- (a) grants da tabela de vínculo; (b) validate_report_layout com imagem;
-- (c) sincronização de vínculos + reference_count; (d) isolamento por tenant;
-- (e) exclusão de arquivo em uso bloqueada; (f) exclusão de relatório libera;
-- (g) exclusão de workspace em cascata não trava.
begin;
select et_grant_hosted_parity(array['report_document_files']);
revoke all on public.report_documents from anon, authenticated;
grant select on public.report_documents to authenticated;
grant update (layout, title) on public.report_documents to authenticated;
do $$
declare
  v_user uuid := gen_random_uuid();
  v_ws_a uuid; v_ws_b uuid;
  v_cli_a bigint; v_cli_b bigint;
  v_doc uuid;
  f_png bigint; f_gif bigint; f_vid bigint; f_b bigint;
  v_n int; v_rc int; v_raised boolean;
  v_lay jsonb;
begin
  -- ---- (a) grants ----
  assert not has_table_privilege('anon', 'public.report_document_files', 'SELECT'),
    'anon nao pode ler report_document_files';
  assert has_table_privilege('authenticated', 'public.report_document_files', 'SELECT'),
    'authenticated precisa ler report_document_files';
  assert not has_table_privilege('authenticated', 'public.report_document_files', 'INSERT'),
    'authenticated nao pode inserir em report_document_files';
  assert not has_table_privilege('authenticated', 'public.report_document_files', 'DELETE'),
    'authenticated nao pode apagar de report_document_files';

  -- ---- fixtures ----
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_a, 'Cliente A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_b, 'Cliente B', 'B', '#000') returning id into v_cli_b;

  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes, width, height)
    values (v_ws_a, 'contas/'||v_ws_a||'/files/a.png', 'a.png', 'image', 'image/png', 100, 10, 10)
    returning id into f_png;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws_a, 'contas/'||v_ws_a||'/files/a.gif', 'a.gif', 'image', 'image/gif', 100)
    returning id into f_gif;
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes)
    values (v_ws_a, 'contas/'||v_ws_a||'/files/v.mp4', 'contas/'||v_ws_a||'/files/v.jpg',
            'v.mp4', 'video', 'video/mp4', 100)
    returning id into f_vid;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws_b, 'contas/'||v_ws_b||'/files/b.png', 'b.png', 'image', 'image/png', 100)
    returning id into f_b;

  -- ---- (b) validate_report_layout ----
  v_raised := false;
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_a, v_cli_a, '2026-09-01', '2026-09-30',
      '{"version":1,"blocks":[{"id":"i","type":"image","size":"full","config":{"src":"https://x"}}]}');
  exception when others then
    if sqlerrm like '%INVALID_LAYOUT%' then v_raised := true; else raise; end if;
  end;
  assert v_raised, 'src no config deveria ser rejeitado';

  v_raised := false;
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_a, v_cli_a, '2026-09-01', '2026-09-30',
      '{"version":1,"blocks":[{"id":"i","type":"image","size":"full","config":{"ratio":"5:4"}}]}');
  exception when others then
    if sqlerrm like '%INVALID_LAYOUT%' then v_raised := true; else raise; end if;
  end;
  assert v_raised, 'ratio fora do enum deveria ser rejeitado';

  v_raised := false;
  begin
    insert into report_templates (conta_id, name, layout)
    values (v_ws_a, 'T', jsonb_build_object('version', 1, 'blocks', jsonb_build_array(
      jsonb_build_object('id','i','type','image','size','full','config',
        jsonb_build_object('file_id', f_png, 'width', 10, 'height', 10)))));
  exception when others then
    if sqlerrm like '%INVALID_LAYOUT%' then v_raised := true; else raise; end if;
  end;
  assert v_raised, 'modelo com imagem preenchida deveria ser rejeitado';

  insert into report_templates (conta_id, name, layout)
  values (v_ws_a, 'T ok',
    '{"version":1,"blocks":[{"id":"i","type":"image","size":"half","config":{"ratio":"4:5","fit":"cover","focal":{"x":0.5,"y":0}}}]}');

  -- ---- (c) sync + reference_count ----
  v_lay := jsonb_build_object('version', 1, 'blocks', jsonb_build_array(
    jsonb_build_object('id','i1','type','image','size','full','config',
      jsonb_build_object('file_id', f_png, 'width', 10, 'height', 10)),
    jsonb_build_object('id','i2','type','image','size','half','config',
      jsonb_build_object('file_id', f_gif, 'width', 10, 'height', 10)),
    jsonb_build_object('id','i3','type','image','size','half','config',
      jsonb_build_object('file_id', f_vid, 'width', 10, 'height', 10)),
    jsonb_build_object('id','i4','type','image','size','half','config',
      jsonb_build_object('file_id', f_b, 'width', 10, 'height', 10))));
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_a, v_cli_a, '2026-09-01', '2026-09-30', v_lay) returning id into v_doc;

  select count(*) into v_n from report_document_files where report_id = v_doc;
  assert v_n = 1, format('so o PNG do proprio workspace vincula (gif, video e outro tenant fora), got %s', v_n);
  select reference_count into v_rc from files where id = f_png;
  assert v_rc = 1, format('reference_count do PNG deveria ser 1, got %s', v_rc);
  select reference_count into v_rc from files where id = f_b;
  assert v_rc = 0, 'arquivo de outro workspace nao pode ganhar referencia';

  -- mesma imagem em dois blocos = um vínculo
  update report_documents set layout = jsonb_set(v_lay, '{blocks,1,config,file_id}', to_jsonb(f_png))
   where id = v_doc;
  select count(*) into v_n from report_document_files where report_id = v_doc;
  assert v_n = 1, 'imagem repetida conta uma vez';

  -- tirar a imagem do layout desvincula
  update report_documents set layout = '{"version":1,"blocks":[]}' where id = v_doc;
  select reference_count into v_rc from files where id = f_png;
  assert v_rc = 0, format('remover do layout deveria zerar a referencia, got %s', v_rc);

  -- caminho de produção: authenticated grava layout via PostgREST ->
  -- trigger SECURITY DEFINER -> file_update_reference_count() -> UPDATE files
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  update report_documents set layout = v_lay where id = v_doc;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select reference_count into v_rc from files where id = f_png;
  assert v_rc = 1, format('update como authenticated deveria vincular, got %s', v_rc);

  -- ---- (d) FK composta barra vínculo cross-tenant manual ----
  v_raised := false;
  begin
    insert into report_document_files (report_id, file_id, conta_id) values (v_doc, f_b, v_ws_a);
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'vinculo com arquivo de outro workspace deveria falhar na FK composta';

  -- ---- (e) exclusão de arquivo em uso bloqueada ----
  v_raised := false;
  begin
    delete from files where id = f_png;
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'excluir arquivo em uso por relatorio deveria falhar';

  -- ---- (f) excluir relatório libera ----
  delete from report_documents where id = v_doc;
  select reference_count into v_rc from files where id = f_png;
  assert v_rc = 0, 'excluir o relatorio deveria liberar a referencia';
  delete from files where id = f_png;

  raise notice 'PASS 99_report_image_files (a-f)';
end $$;
rollback;

-- ---- (g) exclusão de workspace em cascata não trava ----
begin;
do $$
declare
  v_user uuid := gen_random_uuid();
  v_ws uuid; v_cli bigint; f bigint;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/a.png', 'a.png', 'image', 'image/png', 100)
    returning id into f;
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws, v_cli, '2026-09-01', '2026-09-30', jsonb_build_object('version', 1, 'blocks',
      jsonb_build_array(jsonb_build_object('id','i','type','image','size','full','config',
        jsonb_build_object('file_id', f, 'width', 10, 'height', 10)))));
  delete from workspaces where id = v_ws;
  raise notice 'PASS 99_report_image_files (g) workspace cascade';
end $$;
rollback;
```

If `et_make_workspace` workspaces cannot be deleted for unrelated FK reasons in the local DB, keep the `(g)` block but note the reason in the PR; the cascade path under test is `workspaces -> files` vs `workspaces -> report_documents -> report_document_files`.

- [ ] **Step 2: Add the autoclean case** to `63_storage_autoclean.sql` (read the whole file first: `v_cli`, `v_ws` and `p_pub_old` already exist there; reuse its names). In its fixture, after the existing files are created, add a file `f11` linked to `p_pub_old` (40-day-old published post) **and** referenced by a report document of tenant A. Follow the file's existing pattern for `post_file_links` inserts (they appear right after the files block; copy one and change the file id), then:

```sql
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes, width, height)
    values (v_ws, 'contas/'||v_ws||'/files/f11.png', 'f11', 'image', 'image/png', 500, 10, 10)
    returning id into f11;   -- old published post + used in a report => OUT
  -- (insert the post_file_links row for (p_pub_old, f11) exactly like f1's)
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws, v_cli, '2026-09-01', '2026-09-30', jsonb_build_object('version', 1, 'blocks',
      jsonb_build_array(jsonb_build_object('id','i','type','image','size','full','config',
        jsonb_build_object('file_id', f11, 'width', 10, 'height', 10)))));
```

Declare `f11 bigint;` with the others. Existing assertions list exact candidate sets (e.g. `{f1,f3,f8}`): f11 must NOT appear, so those assertions stay unchanged and now also prove the guard. After the run section's assertions, add:

```sql
  assert exists (select 1 from files where id = f11),
    'arquivo de post antigo usado em relatório não pode ser apagado pelo autoclean';
```

- [ ] **Step 3: Run the suites to verify they fail**

Run: `npx supabase start` (if not running; see memory "Local Supabase runs on colima") then `bash scripts/test-entitlements.sh`
Expected: `99_report_image_files` FAIL (relation `report_document_files` does not exist).

- [ ] **Step 4: Write the migration** `supabase/migrations/20261003000001_report_image_block.sql`

```sql
-- supabase/migrations/20261003000001_report_image_block.sql
-- Bloco "Imagem" no relatório de blocos (spec 2026-10-02).
-- 1. validate_report_layout: regras do config de image (+ invariante de modelo).
-- 2. report_document_files: vínculo relatório->arquivo com FKs compostas por
--    conta_id, mantido por trigger; sobe/desce files.reference_count.
-- 3. storage_autoclean_candidates: não seleciona arquivo usado em relatório.

-- ---------- 1. validação ----------
CREATE OR REPLACE FUNCTION report_image_config_ok(p_cfg jsonb, p_is_template boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_cfg IS NULL THEN true
    WHEN jsonb_typeof(p_cfg) <> 'object' THEN false
    ELSE
      NOT (p_cfg ? 'src') AND NOT (p_cfg ? 'r2_key')
      AND (NOT (p_cfg ? 'ratio') OR p_cfg ->> 'ratio' IN
           ('original','16:9','3:2','4:3','1:1','4:5','3:4','2:3','9:16'))
      AND (NOT (p_cfg ? 'fit') OR p_cfg ->> 'fit' IN ('cover','contain'))
      AND (NOT (p_cfg ? 'focal') OR (
            jsonb_typeof(p_cfg -> 'focal') = 'object'
            AND (p_cfg -> 'focal' -> 'x') IN ('0'::jsonb, '0.5'::jsonb, '1'::jsonb)
            AND (p_cfg -> 'focal' -> 'y') IN ('0'::jsonb, '0.5'::jsonb, '1'::jsonb)))
      AND (NOT (p_cfg ? 'file_id') OR (jsonb_typeof(p_cfg -> 'file_id') = 'number'
            AND (p_cfg ->> 'file_id') ~ '^[1-9][0-9]{0,17}$'))
      AND (NOT (p_cfg ? 'width') OR (jsonb_typeof(p_cfg -> 'width') = 'number'
            AND (p_cfg ->> 'width') ~ '^[1-9][0-9]{0,5}$'))
      AND (NOT (p_cfg ? 'height') OR (jsonb_typeof(p_cfg -> 'height') = 'number'
            AND (p_cfg ->> 'height') ~ '^[1-9][0-9]{0,5}$'))
      AND (NOT (p_cfg ? 'file_id') OR ((p_cfg ? 'width') AND (p_cfg ? 'height')))
      AND (NOT (p_cfg ? 'caption') OR (jsonb_typeof(p_cfg -> 'caption') = 'string'
            AND char_length(p_cfg ->> 'caption') <= 200))
      AND (NOT (p_cfg ? 'alt') OR (jsonb_typeof(p_cfg -> 'alt') = 'string'
            AND char_length(p_cfg ->> 'alt') <= 300))
      AND (NOT p_is_template OR NOT (p_cfg ?| ARRAY['file_id','width','height','caption','alt']))
  END
$$;

-- Recria a função inteira preservando o corpo da 20260825000001 e acrescentando
-- a condição de image ao EXISTS que valida cada bloco.
-- (Implementer: run `grep -ln "FUNCTION validate_report_layout" supabase/migrations/*.sql | tail -1`.
-- If it is not 20260825000001, copy THAT file's body verbatim, comments included,
-- and add only the image clause. The body below equals 20260825000001 minus comments.)
CREATE OR REPLACE FUNCTION validate_report_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layout IS NULL
     OR jsonb_typeof(NEW.layout) <> 'object'
     OR (NEW.layout -> 'version') IS DISTINCT FROM to_jsonb(1)
     OR jsonb_typeof(NEW.layout -> 'blocks') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.layout -> 'blocks') > 200 THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'accent' AND (
       jsonb_typeof(NEW.layout -> 'accent') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'accent' !~ '^#[0-9a-fA-F]{6}$'
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'theme' AND (
       jsonb_typeof(NEW.layout -> 'theme') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'theme' NOT IN ('clean', 'editorial', 'bold', 'hub')
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'fonts' AND (
       jsonb_typeof(NEW.layout -> 'fonts') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'fonts' NOT IN ('system', 'fraunces', 'grotesk', 'playfair')
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
    WHERE jsonb_typeof(b) <> 'object'
       OR jsonb_typeof(b -> 'id') IS DISTINCT FROM 'string'
       OR b ->> 'id' = ''
       OR jsonb_typeof(b -> 'type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(b -> 'size') IS DISTINCT FROM 'string'
       OR b ->> 'size' NOT IN ('third', 'half', 'full')
       OR (b ? 'text' AND b ->> 'type' NOT IN
           ('text', 'ai_summary', 'ai_recommendations', 'ai_goals'))
       OR (b ->> 'type' = 'cover' AND b ->> 'size' <> 'full')
       -- imagem (spec 2026-10-02): config válido; em modelo, sem conteúdo.
       OR (b ->> 'type' = 'image'
           AND NOT report_image_config_ok(b -> 'config', TG_TABLE_NAME = 'report_templates'))
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT b ->> 'id')
        FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  RETURN NEW;
END $$;

-- ---------- 2. vínculo ----------
ALTER TABLE report_documents
  ADD CONSTRAINT report_documents_id_conta_uq UNIQUE (id, conta_id);

CREATE TABLE report_document_files (
  report_id  uuid   NOT NULL,
  file_id    bigint NOT NULL,
  conta_id   uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, file_id),
  CONSTRAINT report_document_files_report_fk FOREIGN KEY (report_id, conta_id)
    REFERENCES report_documents (id, conta_id) ON DELETE CASCADE,
  -- Arquivo em uso não sai (como post_file_links.file_id). NO ACTION e não
  -- RESTRICT: na exclusão do workspace, workspaces->files e
  -- workspaces->report_documents->report_document_files cascateiam no mesmo
  -- statement; RESTRICT checa por linha (e falharia se files cascateasse
  -- antes), NO ACTION checa no fim do statement, depois de todas as cascatas.
  CONSTRAINT report_document_files_file_fk FOREIGN KEY (file_id, conta_id)
    REFERENCES files (id, conta_id) ON DELETE NO ACTION
);
CREATE INDEX report_document_files_file_idx ON report_document_files (file_id);

ALTER TABLE report_document_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_document_files_tenant_select ON report_document_files
  FOR SELECT TO authenticated USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_document_files_service_role_bypass ON report_document_files
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Privilégios explícitos por role: REVOKE FROM PUBLIC não tira anon/authenticated.
REVOKE ALL ON report_document_files FROM PUBLIC;
REVOKE ALL ON report_document_files FROM anon;
REVOKE ALL ON report_document_files FROM authenticated;
GRANT SELECT ON report_document_files TO authenticated;
GRANT ALL ON report_document_files TO service_role;

CREATE TRIGGER trg_report_document_files_ref_count_ins
  AFTER INSERT ON report_document_files
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();
CREATE TRIGGER trg_report_document_files_ref_count_del
  AFTER DELETE ON report_document_files
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();

-- Diff do layout -> vínculos. Só arquivos do MESMO workspace, imagem, e em
-- JPEG/PNG/WebP (o backend aceita GIF como kind='image'). Roda depois do
-- validate_report_layout (BEFORE), então file_id já é inteiro positivo.
CREATE OR REPLACE FUNCTION report_document_files_sync() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT f.id), '{}')
    INTO v_ids
    FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
    JOIN files f
      ON f.id = (b -> 'config' ->> 'file_id')::bigint
   WHERE b ->> 'type' = 'image'
     AND jsonb_typeof(b -> 'config' -> 'file_id') = 'number'
     AND f.conta_id = NEW.conta_id
     AND f.kind = 'image'
     AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp');

  DELETE FROM report_document_files
   WHERE report_id = NEW.id
     AND NOT (file_id = ANY (v_ids));

  INSERT INTO report_document_files (report_id, file_id, conta_id)
  SELECT NEW.id, x, NEW.conta_id FROM unnest(v_ids) AS x
  ON CONFLICT DO NOTHING;

  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION report_document_files_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION report_document_files_sync() FROM anon;
REVOKE ALL ON FUNCTION report_document_files_sync() FROM authenticated;

CREATE TRIGGER trg_report_document_files_sync
  AFTER INSERT OR UPDATE OF layout ON report_documents
  FOR EACH ROW EXECUTE FUNCTION report_document_files_sync();

-- ---------- 3. autoclean ----------
-- Só o predicado compartilhado muda: storage_autoclean_run reavalia este
-- predicado sob FOR UPDATE nos candidatos, e inserir em report_document_files
-- toma FOR KEY SHARE na linha de files (checagem da FK), então nenhum vínculo
-- de relatório aparece entre a reavaliação e o DELETE final. CREATE OR REPLACE
-- preserva os GRANTs de 20260811000002.
CREATE OR REPLACE FUNCTION storage_autoclean_candidates(p_workspace uuid, p_cutoff timestamptz)
RETURNS TABLE(file_id bigint, size_bytes bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT f.id, f.size_bytes
    FROM files f
   WHERE f.conta_id = p_workspace
     AND EXISTS (
       SELECT 1 FROM post_file_links pfl WHERE pfl.file_id = f.id)
     AND NOT EXISTS (
       SELECT 1
         FROM post_file_links pfl
         JOIN workflow_posts wp ON wp.id = pfl.post_id
        WHERE pfl.file_id = f.id
          AND (pfl.conta_id <> p_workspace
               OR wp.conta_id <> p_workspace
               OR wp.status <> 'postado'
               OR wp.published_at IS NULL
               OR wp.published_at > p_cutoff))
     AND NOT EXISTS (
       SELECT 1 FROM ideia_files idf WHERE idf.file_id = f.id)
     AND NOT EXISTS (
       SELECT 1 FROM hub_brand hb WHERE hb.logo_file_id = f.id)
     AND NOT EXISTS (
       SELECT 1 FROM report_document_files rdf WHERE rdf.file_id = f.id)
$$;
```

Before writing, confirm `storage_autoclean_candidates` was not redefined after `20260811000002` (`grep -ln "FUNCTION storage_autoclean_candidates" supabase/migrations/*.sql`). If a later migration redefined it, copy THAT body and add only the last `NOT EXISTS`.

- [ ] **Step 5: Apply locally and run the suites**

Run: `npx supabase db reset` then `bash scripts/test-entitlements.sh`
Expected: all PASS, including `99_report_image_files` (a-f) and (g), `63_storage_autoclean`, `66_report_docs`. (e) still raises inside its `begin ... exception` block: NO ACTION checks when the DELETE statement completes.

- [ ] **Step 6: Update the spec's autoclean bullet** in `docs/superpowers/specs/2026-10-02-report-image-block-design.md`: replace "A migration faz `CREATE OR REPLACE` das duas funções com ... na seleção e no DELETE final." with "A migration faz `CREATE OR REPLACE` de `storage_autoclean_candidates` com `AND NOT EXISTS (SELECT 1 FROM report_document_files rdf WHERE rdf.file_id = f.id)`. `storage_autoclean_run` não muda: ele reavalia esse predicado sob `FOR UPDATE` e o insert de vínculo toma `FOR KEY SHARE` no arquivo, então nenhum vínculo novo aparece antes do DELETE."

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261003000001_report_image_block.sql supabase/tests/entitlements/99_report_image_files.sql supabase/tests/entitlements/63_storage_autoclean.sql docs/superpowers/specs/2026-10-02-report-image-block-design.md
git commit -m "feat(relatorio): vínculo relatório-arquivo, validação de imagem no banco e autoclean"
```

---

### Task 3: Migration: "Relatórios" folder RPC

**Files:**
- Create: `supabase/migrations/20261003000002_client_reports_folder.sql`
- Modify: `supabase/tests/entitlements/99_report_image_files.sql` (append a block)

**Interfaces:**
- Produces: RPC `get_or_create_client_reports_folder(p_cliente_id bigint) RETURNS bigint` (authenticated only).

- [ ] **Step 1: Append the failing SQL block** to `99_report_image_files.sql`:

```sql
-- ---- (h) pasta "Relatórios" ----
begin;
select et_grant_hosted_parity();
do $$
declare
  v_user uuid := gen_random_uuid();
  v_ws uuid; v_ws_b uuid; v_cli bigint; v_cli_b bigint;
  v_f1 bigint; v_f2 bigint; v_parent bigint; v_client_folder bigint;
  v_raised boolean := false; v_n int;
begin
  assert not has_function_privilege('anon',
    'public.get_or_create_client_reports_folder(bigint)', 'EXECUTE'),
    'anon nao pode executar get_or_create_client_reports_folder';
  assert has_function_privilege('authenticated',
    'public.get_or_create_client_reports_folder(bigint)', 'EXECUTE'),
    'authenticated precisa executar get_or_create_client_reports_folder';

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'Cliente', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_b, 'Outro', 'O', '#000') returning id into v_cli_b;
  -- simula cliente anterior ao trigger de pastas: sem pasta de cliente
  delete from folders where conta_id = v_ws and source_type = 'client' and source_id = v_cli;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_f1 := get_or_create_client_reports_folder(v_cli);
  v_f2 := get_or_create_client_reports_folder(v_cli);
  begin
    perform get_or_create_client_reports_folder(v_cli_b);
  exception when others then v_raised := true;
  end;
  reset role;

  assert v_f1 = v_f2, 'RPC deveria ser idempotente';
  assert v_raised, 'cliente de outro workspace deveria ser recusado';
  select parent_id into v_parent from folders where id = v_f1;
  select id into v_client_folder from folders
   where conta_id = v_ws and source_type = 'client' and source_id = v_cli;
  assert v_client_folder is not null, 'RPC deveria recriar a pasta do cliente';
  assert v_parent = v_client_folder, 'Relatórios deveria ser filha da pasta do cliente';
  select count(*) into v_n from folders
   where conta_id = v_ws and source_type = 'client_reports' and source_id = v_cli;
  assert v_n = 1, 'uma única pasta Relatórios';
  assert exists (select 1 from folders where conta_id = v_ws and source_type = 'root_clients'),
    'pastas root_clients continuam válidas após recriar a constraint';
  raise notice 'PASS 99_report_image_files (h) pasta Relatórios';
end $$;
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/test-entitlements.sh`
Expected: FAIL (function does not exist).

- [ ] **Step 3: Write the migration** `supabase/migrations/20261003000002_client_reports_folder.sql`. The `ON CONFLICT ... WHERE` predicate must match `folders_source_unique` (20260425000001): `WHERE source_type IS NOT NULL AND source_id IS NOT NULL`.

```sql
-- supabase/migrations/20261003000002_client_reports_folder.sql
-- Pasta "Relatórios" do cliente nos Arquivos (spec 2026-10-02, "Pasta Relatórios"):
-- destino dos envios do bloco de imagem. (conta, 'client_reports', cliente)
-- é único via folders_source_unique (índice parcial), o que torna o
-- get-or-create atômico.

-- Recria o check com TODOS os valores atuais + o novo (já existem linhas
-- root_clients; omitir quebraria o ADD CONSTRAINT).
ALTER TABLE folders DROP CONSTRAINT folders_source_type_check;
ALTER TABLE folders ADD CONSTRAINT folders_source_type_check
  CHECK (source_type = ANY (ARRAY['client', 'workflow', 'post', 'root_clients', 'client_reports']));

CREATE OR REPLACE FUNCTION public.get_or_create_client_reports_folder(p_cliente_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws            uuid := public.get_my_conta_id();
  v_nome          text;
  v_root          bigint;
  v_client_folder bigint;
  v_id            bigint;
BEGIN
  IF v_ws IS NULL OR NOT EXISTS (
    SELECT 1 FROM workspace_members WHERE workspace_id = v_ws AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT nome INTO v_nome FROM clientes WHERE id = p_cliente_id AND conta_id = v_ws;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT id INTO v_client_folder FROM folders
   WHERE conta_id = v_ws AND source_type = 'client' AND source_id = p_cliente_id;

  IF v_client_folder IS NULL THEN
    -- Cliente anterior ao trigger de pastas: cria a pasta no formato de
    -- folder_sync_cliente (20260425000005).
    SELECT id INTO v_root FROM folders WHERE conta_id = v_ws AND source_type = 'root_clients';
    IF v_root IS NULL THEN
      INSERT INTO folders (conta_id, name, source, source_type, source_id)
      VALUES (v_ws, 'Clientes', 'system', 'root_clients', 0)
      ON CONFLICT (conta_id, source_type, source_id)
        WHERE source_type IS NOT NULL AND source_id IS NOT NULL
      DO UPDATE SET name = folders.name
      RETURNING id INTO v_root;
    END IF;
    INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
    VALUES (v_ws, v_root, v_nome, 'system', 'client', p_cliente_id)
    ON CONFLICT (conta_id, source_type, source_id)
      WHERE source_type IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET name = folders.name
    RETURNING id INTO v_client_folder;
  END IF;

  -- DO UPDATE no-op (não DO NOTHING) para o RETURNING sempre devolver a linha.
  INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
  VALUES (v_ws, v_client_folder, 'Relatórios', 'system', 'client_reports', p_cliente_id)
  ON CONFLICT (conta_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET name = folders.name
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.get_or_create_client_reports_folder(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_client_reports_folder(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_client_reports_folder(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_client_reports_folder(bigint) TO service_role;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx supabase db reset && bash scripts/test-entitlements.sh`
Expected: all PASS including (h).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261003000002_client_reports_folder.sql supabase/tests/entitlements/99_report_image_files.sql
git commit -m "feat(arquivos): pasta Relatórios do cliente por RPC atômica"
```

---

### Task 4: Hub/print signing in `hub-report-docs`

**Files:**
- Create: `supabase/functions/hub-report-docs/sign-images.ts`
- Modify: `supabase/functions/hub-report-docs/handlers.ts`
- Modify: `supabase/functions/hub-report-docs/index.ts`
- Modify: `supabase/functions/hub-report-docs/handlers.test.ts`

**Interfaces:**
- Produces: `export type SignFn = (r2Key: string) => Promise<string | null>`; `export async function signImageBlocks(db: Db, docId: string, layout: unknown, sign: SignFn | undefined): Promise<unknown>`.
- `docHandler(db, hubToken, docId, sign?: SignFn)` and `printDocHandler(db, secret, docId, pt, nowEpochS, sign?: SignFn)` (new optional last param; existing call sites/tests stay valid).

- [ ] **Step 1: Write the failing tests** (append to `handlers.test.ts`)

```ts
import { signImageBlocks } from "./sign-images.ts";

function makeLinksDb(links: Array<{ file_id: number; files: { r2_key: string; media_lost_at: string | null } }>) {
  const calls: string[] = [];
  return {
    calls,
    db: {
      from: (table: string) => {
        calls.push(table);
        return { select: () => ({ eq: () => Promise.resolve({ data: links, error: null }) }) };
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

const imgLayout = (blocks: unknown[]) => ({ version: 1, blocks });
const imgBlock = (id: string, config: Record<string, unknown>) =>
  ({ id, type: "image", size: "full", config });

Deno.test("signImageBlocks: assina só arquivos vinculados e não perdidos, chave vem de files", async () => {
  const { db } = makeLinksDb([
    { file_id: 1, files: { r2_key: "contas/ws/files/a.png", media_lost_at: null } },
    { file_id: 2, files: { r2_key: "contas/ws/files/b.png", media_lost_at: "2026-08-01T00:00:00Z" } },
  ]);
  const out = await signImageBlocks(db, "doc-1", imgLayout([
    imgBlock("i1", { file_id: 1, width: 10, height: 10 }),
    imgBlock("i2", { file_id: 2, width: 10, height: 10 }),
    imgBlock("i3", { file_id: 3, width: 10, height: 10 }),
    { id: "t", type: "text", size: "full" },
  ]), async (k) => `https://signed/${k}`) as { blocks: Array<{ config?: Record<string, unknown> }> };
  assertEquals(out.blocks[0].config?.src, "https://signed/contas/ws/files/a.png");
  assertEquals(out.blocks[1].config?.src, undefined);
  assertEquals(out.blocks[2].config?.src, undefined);
});

Deno.test("signImageBlocks: remove src salvo mesmo sem signer", async () => {
  const { db, calls } = makeLinksDb([]);
  const out = await signImageBlocks(db, "doc-1", imgLayout([
    imgBlock("i1", { src: "https://evil", file_id: 1, width: 1, height: 1 }),
  ]), undefined) as { blocks: Array<{ config?: Record<string, unknown> }> };
  assertEquals(out.blocks[0].config?.src, undefined);
  assertEquals(calls.length, 0);
});

Deno.test("signImageBlocks: layout sem imagem não consulta o banco", async () => {
  const { db, calls } = makeLinksDb([]);
  const lay = imgLayout([{ id: "t", type: "text", size: "full" }]);
  assertEquals(await signImageBlocks(db, "doc-1", lay, async () => "x"), lay);
  assertEquals(calls.length, 0);
});

Deno.test("signImageBlocks: falha do signer deixa o bloco sem src", async () => {
  const { db } = makeLinksDb([
    { file_id: 1, files: { r2_key: "contas/ws/files/a.png", media_lost_at: null } },
  ]);
  const out = await signImageBlocks(db, "doc-1", imgLayout([
    imgBlock("i1", { file_id: 1, width: 10, height: 10 }),
  ]), async () => null) as { blocks: Array<{ config?: Record<string, unknown> }> };
  assertEquals(out.blocks[0].config?.src, undefined);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --no-check supabase/functions/hub-report-docs/handlers.test.ts`
Expected: FAIL (module `./sign-images.ts` not found).

- [ ] **Step 3: Implement `sign-images.ts`**

```ts
// Assinatura das imagens do relatório na leitura (spec 2026-10-02, "Hub e
// print"). O layout guarda só file_id; a chave vem de report_document_files
// JOIN files, então o conjunto assinado == o vinculado pelo trigger (mesmo
// conta_id, kind image, mime aceito) == o que bloqueia exclusão.

// deno-lint-ignore no-explicit-any
type Db = any;
export type SignFn = (r2Key: string) => Promise<string | null>;

interface Block {
  type?: unknown;
  config?: Record<string, unknown>;
  [k: string]: unknown;
}

function isImage(b: unknown): b is Block {
  return typeof b === "object" && b !== null && (b as Block).type === "image";
}

export async function signImageBlocks(
  db: Db,
  docId: string,
  layout: unknown,
  sign: SignFn | undefined,
): Promise<unknown> {
  const blocks = (layout as { blocks?: unknown })?.blocks;
  if (!Array.isArray(blocks) || !blocks.some(isImage)) return layout;

  const keys = new Map<number, string>();
  if (sign) {
    const { data } = await db
      .from("report_document_files")
      .select("file_id, files(r2_key, media_lost_at)")
      .eq("report_id", docId);
    for (const row of (data ?? []) as Array<{
      file_id: number;
      files: { r2_key: string; media_lost_at: string | null } | null;
    }>) {
      if (row.files && !row.files.media_lost_at) keys.set(row.file_id, row.files.r2_key);
    }
  }

  const signed = await Promise.all(blocks.map(async (b) => {
    if (!isImage(b)) return b;
    const { src: _drop, ...config } = b.config ?? {};
    const key = typeof config.file_id === "number" ? keys.get(config.file_id) : undefined;
    const url = key && sign ? await sign(key).catch(() => null) : null;
    return { ...b, config: url ? { ...config, src: url } : config };
  }));
  return { ...(layout as Record<string, unknown>), blocks: signed };
}
```

- [ ] **Step 4: Wire into handlers.** In `handlers.ts`:

```ts
import { signImageBlocks, type SignFn } from "./sign-images.ts";
```

Change both handlers to accept `sign?: SignFn` as the last parameter and sign the layout before returning:

```ts
export async function docHandler(
  db: Db,
  hubToken: HubToken,
  docId: string,
  sign?: SignFn,
): Promise<HubReportDocPayload | null> {
  const doc = await loadReadyDoc(db, docId);
  if (!doc || doc.client_id !== hubToken.cliente_id || doc.conta_id !== hubToken.conta_id) {
    return null;
  }
  const payload = stripInternalFields(doc);
  return { ...payload, layout: await signImageBlocks(db, docId, payload.layout, sign) };
}

export async function printDocHandler(
  db: Db,
  secret: string,
  docId: string,
  pt: string,
  nowEpochS: number,
  sign?: SignFn,
): Promise<HubReportDocPayload | null> {
  if (!secret || !(await verifyPrintToken(pt, docId, nowEpochS, secret))) return null;
  const doc = await loadReadyDoc(db, docId);
  if (!doc) return null;
  const payload = stripInternalFields(doc);
  return { ...payload, layout: await signImageBlocks(db, docId, payload.layout, sign) };
}
```

(Keep the existing comment above the `docHandler` ownership check.)

In `index.ts`:

```ts
import { signGetUrl } from "../_shared/r2.ts";
import { isMediaProxyEnabled, signMediaUrl } from "../_shared/media-url.ts";
import type { SignFn } from "./sign-images.ts";

// Mesmo padrão de hub-posts/index.ts: media proxy (7 dias) ou presign R2 de 1h.
const signImage: SignFn = isMediaProxyEnabled()
  ? (key) => signMediaUrl(key)
  : (key) => signGetUrl(key, 3600);
```

Pass `signImage` as the last argument to `printDocHandler(...)` and `docHandler(db, hubToken, docId, signImage)`.

- [ ] **Step 5: Run tests**

Run: `deno test --no-check supabase/functions/hub-report-docs/` and `npm run check:functions`
Expected: PASS (old tests unchanged, new tests green), no type errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/hub-report-docs/
git commit -m "feat(hub-report-docs): assina imagens do relatório na leitura"
```

---

### Task 5: `report-docs` template sanitize + `sign-r2-urls` accepts own copy keys

**Files:**
- Modify: `supabase/functions/report-docs/generate.ts`
- Modify: `supabase/functions/sign-r2-urls/handler.ts`
- Modify: `supabase/functions/__tests__/sign-r2-urls_test.ts`
- Test (if exists): `supabase/functions/report-docs/*generate*test.ts` (search with `ls supabase/functions/report-docs supabase/functions/__tests__ | grep -i generate`)

**Interfaces:**
- Consumes: `sanitizeLayoutForTemplate` from `../_shared/report-docs/layout.ts` (Task 1).

- [ ] **Step 1: Failing tests for sign-r2-urls** (append to `sign-r2-urls_test.ts`; read `makeDeps` (line 4) and `makeReq` (line 44) first and match the signed-URL format `makeDeps` produces in the assertion)

```ts
Deno.test("POST: assina chave de cópia do próprio workspace (<conta>/...)", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeReq("POST", {
    keys: ["conta-abc/uuid-foto.png", "other-workspace/uuid-foto.png"],
  }));
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.urls["conta-abc/uuid-foto.png"], "https://r2.example.com/conta-abc/uuid-foto.png?signed=1");
  assertEquals(data.urls["other-workspace/uuid-foto.png"], undefined);
});

Deno.test("GET: serve bytes de chave de cópia própria e 404 para outro workspace", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const own = await handler(new Request(
    "http://localhost/sign-r2-urls?key=" + encodeURIComponent("conta-abc/uuid-foto.png"),
    { method: "GET", headers: { Authorization: "Bearer test-token" } },
  ));
  assertEquals(own.status, 200);
  await own.body?.cancel();
  const other = await handler(new Request(
    "http://localhost/sign-r2-urls?key=" + encodeURIComponent("other-workspace/uuid-foto.png"),
    { method: "GET", headers: { Authorization: "Bearer test-token" } },
  ));
  assertEquals(other.status, 404);
  await other.body?.cancel();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --no-check supabase/functions/__tests__/sign-r2-urls_test.ts`
Expected: the two new tests FAIL.

- [ ] **Step 3: Implement.** In `sign-r2-urls/handler.ts`, add near the top:

```ts
// Chaves do próprio workspace: uploads (`contas/<conta>/...`) e cópias feitas
// pelo file-manage (`<conta>/<uuid>-nome`, handler.ts:323,414). Ambas são
// escopadas ao tenant; nada de outro workspace passa.
function isOwnKey(key: string, contaId: string): boolean {
  return key.startsWith(`contas/${contaId}/`) || key.startsWith(`${contaId}/`);
}
```

GET branch: replace `if (!key.startsWith(\`contas/${resolved.contaId}/\`))` with `if (!isOwnKey(key, resolved.contaId))`.
POST branch: replace the `prefix` / `ownKeys` / `otherKeys` lines with:

```ts
    const ownKeys = body.keys.filter((k) => typeof k === "string" && isOwnKey(k, resolved.contaId));
    const otherKeys = body.keys.filter((k) => typeof k === "string" && !isOwnKey(k, resolved.contaId));
```

- [ ] **Step 4: `generate.ts`.** Import `sanitizeLayoutForTemplate` alongside `validateLayout` from `../_shared/report-docs/layout.ts`, and in both template branches replace `templateLayout = check.layout;` with:

```ts
    // Defesa no servidor (spec 2026-10-02): modelo nunca carrega imagem; a
    // invariante já vale no banco, isto cobre layout legado/escrito por fora.
    templateLayout = sanitizeLayoutForTemplate(check.layout);
```

If a generate test exists, add a case: a template layout containing an image block with `config: { ratio: "4:5" }` passes through with `ratio` intact. If none exists, skip (covered by Task 1's sanitizer tests).

- [ ] **Step 5: Run tests**

Run: `deno test --no-check supabase/functions/__tests__/sign-r2-urls_test.ts supabase/functions/report-docs/` and `npm run check:functions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/report-docs/generate.ts supabase/functions/sign-r2-urls/handler.ts supabase/functions/__tests__/sign-r2-urls_test.ts
git commit -m "feat(relatorio): generate sanitiza modelo; sign-r2-urls aceita chaves de cópia próprias"
```

---

### Task 6: `file-manage` 409 scoped by conta + `linked_reports`

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts` (DELETE `/files/:id`, ~line 490)
- Modify: `supabase/functions/__tests__/file-manage_test.ts`

**Interfaces:**
- Produces: 409 body `{ error: "file_in_use", reference_count, linked_posts: [{post_id, post_titulo, workflow_titulo}], linked_reports: [{report_id, title}] }`.

- [ ] **Step 1: Failing tests** (update the existing 409 test; read `test/shared/supabaseMock.ts` first for the exact `db.calls` record shape: `table`, `operation`, `modifiers: {method,args}[]`)

In the existing test `"DELETE /files/:id with references returns 409 with linked posts"`, after the `post_file_links` queue add:

```ts
  db.queue("report_document_files", "select", {
    data: [{ report_id: "doc-1", report_documents: { title: "Relatório de setembro" } }],
    error: null,
  });
```

and after the existing assertions add:

```ts
  assertEquals(body.linked_reports, [{ report_id: "doc-1", title: "Relatório de setembro" }]);
  const postCall = db.calls.find((c) => c.table === "post_file_links" && c.operation === "select");
  assert(postCall!.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"));
  const repCall = db.calls.find((c) => c.table === "report_document_files");
  assert(repCall!.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"));
```

(Add `assert` to the std assert import if missing.)

- [ ] **Step 2: Run to verify failure**

Run: `deno test --no-check supabase/functions/__tests__/file-manage_test.ts`
Expected: FAIL (`linked_reports` undefined; no `conta_id` filter).

- [ ] **Step 3: Implement.** Replace the `if (file.reference_count > 0) { ... }` block with:

```ts
        if (file.reference_count > 0) {
          // Escopo explícito por conta_id nas DUAS listas: post_file_links não
          // tem FK composta e este cliente é service role (spec 2026-10-02).
          const [{ data: links }, { data: reportLinks }] = await Promise.all([
            svc.from("post_file_links")
              .select("post_id, workflow_posts(titulo, workflow_id, workflows(titulo))")
              .eq("file_id", fileId)
              .eq("conta_id", contaId),
            svc.from("report_document_files")
              .select("report_id, report_documents(title)")
              .eq("file_id", fileId)
              .eq("conta_id", contaId),
          ]);
          return json({
            error: "file_in_use",
            reference_count: file.reference_count,
            linked_posts: (links ?? []).map((l: any) => ({
              post_id: l.post_id,
              post_titulo: l.workflow_posts?.titulo,
              workflow_titulo: l.workflow_posts?.workflows?.titulo,
            })),
            linked_reports: (reportLinks ?? []).map((l: any) => ({
              report_id: l.report_id,
              title: l.report_documents?.title ?? "",
            })),
          }, 409);
        }
```

- [ ] **Step 4: Run tests**

Run: `deno test --no-check supabase/functions/__tests__/file-manage_test.ts supabase/functions/__tests__/file-manage-bulk_test.ts` and `npm run check:functions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/file-manage/handler.ts supabase/functions/__tests__/file-manage_test.ts
git commit -m "fix(file-manage): 409 de arquivo em uso escopado por conta e com relatórios"
```

---

### Task 7: Renderer: `ImageBlock`, catalog, has-data, CSS

**Files:**
- Create: `packages/report-blocks/image.ts`
- Create: `packages/report-blocks/blocks/ImageBlock.tsx`
- Create: `packages/report-blocks/__tests__/ImageBlock.test.tsx`
- Modify: `packages/report-blocks/BlockRenderer.tsx`, `catalog.ts`, `data-presence.ts`, `styles.css`
- Modify: `packages/report-blocks/__tests__/catalog.test.ts`
- Modify: `apps/crm/src/pages/relatorio-editor/widgetIcons.ts` (TS forces the icon entry once `image` is a `BlockType`)

**Interfaces:**
- Produces (`packages/report-blocks/image.ts`):
  - `export const IMAGE_MAX_HEIGHT_PX = 560`
  - `export interface ImageConfig { fileId: number | null; width: number | null; height: number | null; ratio: ImageRatio; fit: ImageFit; focal: { x: number; y: number }; caption: string; alt: string; src: string | null }`
  - `export function readImageConfig(config: Record<string, unknown> | undefined): ImageConfig`
  - `export function imageAspect(cfg: ImageConfig): number` (width/height; `original` without dims → 1.5)
  - `export function isRenderableSrc(src: unknown): src is string` (`https:` or `blob:`)
  - `export function frameWidth(aspect: number): string` (`min(100%, <560*aspect>px)`)
  - `export function orientationOf(cfg: ImageConfig): 'horizontal' | 'vertical'`
- Produces: `ImageBlock` component (`BlockProps`), `.rb-image` CSS.

- [ ] **Step 1: Write the failing tests** (`packages/report-blocks/__tests__/ImageBlock.test.tsx`)

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageBlock } from '../blocks/ImageBlock';
import { blockHasData } from '../data-presence';
import { frameWidth, imageAspect, readImageConfig } from '../image';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportBlock } from '../types';

const img = (config?: Record<string, unknown>): ReportBlock => ({
  id: 'i', type: 'image', size: 'full', ...(config ? { config } : {}),
});

describe('readImageConfig / imageAspect', () => {
  it('defaults: original, cover, centro', () => {
    const c = readImageConfig(undefined);
    expect(c).toMatchObject({ ratio: 'original', fit: 'cover', focal: { x: 0.5, y: 0.5 }, src: null });
  });
  it('original usa width/height; sem dimensões cai em 3:2', () => {
    expect(imageAspect(readImageConfig({ width: 800, height: 1000 }))).toBeCloseTo(0.8);
    expect(imageAspect(readImageConfig({}))).toBeCloseTo(1.5);
    expect(imageAspect(readImageConfig({ ratio: '9:16' }))).toBeCloseTo(9 / 16);
  });
  it('frameWidth limita a altura a 560px', () => {
    expect(frameWidth(16 / 9)).toBe(`min(100%, ${Math.round(560 * (16 / 9))}px)`);
    expect(frameWidth(9 / 16)).toBe('min(100%, 315px)');
  });
  it('valores inválidos voltam ao padrão', () => {
    const c = readImageConfig({ ratio: 'x', fit: 'y', focal: { x: 7, y: 'a' }, caption: 3 });
    expect(c).toMatchObject({ ratio: 'original', fit: 'cover', focal: { x: 0.5, y: 0.5 }, caption: '' });
  });
});

describe('ImageBlock', () => {
  it('sem src renderiza nada', () => {
    const { container } = render(<ImageBlock block={img({ file_id: 1, width: 10, height: 10 })} snapshot={makeSnapshotFixture()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('src javascript: é ignorado', () => {
    const { container } = render(<ImageBlock block={img({ src: 'javascript:alert(1)' })} snapshot={makeSnapshotFixture()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('aplica proporção, ajuste, enquadramento e legenda; sem lazy loading', () => {
    render(
      <ImageBlock
        block={img({ src: 'https://cdn/x.png', file_id: 1, width: 1000, height: 1000, ratio: '16:9',
          fit: 'contain', focal: { x: 0, y: 1 }, caption: 'Legenda', alt: 'Equipe' })}
        snapshot={makeSnapshotFixture()}
      />,
    );
    const el = screen.getByRole('img', { name: 'Equipe' }) as HTMLImageElement;
    expect(el.getAttribute('loading')).toBeNull();
    // jsdom's cssstyle may drop aspect-ratio/min(); assert the pure helpers
    // (see frameWidth/imageAspect tests) and only the props jsdom keeps.
    expect(el.style.objectFit).toBe('contain');
    expect(el.style.objectPosition).toBe('0% 100%');
    expect(screen.getByText('Legenda').tagName).toBe('FIGCAPTION');
    expect(el.closest('figure')!.className).toContain('rb-image');
  });

  it('alt vazio vira imagem decorativa (alt="")', () => {
    const { container } = render(<ImageBlock block={img({ src: 'blob:abc' })} snapshot={makeSnapshotFixture()} />);
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('');
  });
});

describe('blockHasData(image)', () => {
  it('vazio = sem dados; com file_id = com dados', () => {
    expect(blockHasData(img(), makeSnapshotFixture())).toBe(false);
    expect(blockHasData(img({ file_id: 1, width: 1, height: 1 }), makeSnapshotFixture())).toBe(true);
  });
});
```

Update `catalog.test.ts`: rename the first test to `'cobre todos os tipos de bloco, sem duplicatas'` (body unchanged).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/report-blocks`
Expected: FAIL (modules missing; catalog test fails since `image` lacks an entry).

- [ ] **Step 3: Implement `image.ts`**

```ts
// Leitura tolerante do config do bloco image (spec 2026-10-02). O validador
// estrito mora em _shared/report-docs/layout.ts; aqui qualquer valor fora do
// contrato cai no padrão, como os outros widgets fazem na leitura.
import { IMAGE_FITS, IMAGE_FOCAL_STEPS, IMAGE_RATIOS } from './types';
import type { ImageFit, ImageRatio } from './types';

export const IMAGE_MAX_HEIGHT_PX = 560;
const FALLBACK_ASPECT = 1.5;

const RATIO_VALUE: Record<Exclude<ImageRatio, 'original'>, number> = {
  '16:9': 16 / 9,
  '3:2': 3 / 2,
  '4:3': 4 / 3,
  '1:1': 1,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
  '9:16': 9 / 16,
};

export interface ImageConfig {
  fileId: number | null;
  width: number | null;
  height: number | null;
  ratio: ImageRatio;
  fit: ImageFit;
  focal: { x: number; y: number };
  caption: string;
  alt: string;
  src: string | null;
}

const posInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
const step = (v: unknown): number =>
  (IMAGE_FOCAL_STEPS as readonly unknown[]).includes(v) ? (v as number) : 0.5;

export function isRenderableSrc(src: unknown): src is string {
  return typeof src === 'string' && (src.startsWith('https:') || src.startsWith('blob:'));
}

export function readImageConfig(config: Record<string, unknown> | undefined): ImageConfig {
  const c = config ?? {};
  const focal = typeof c.focal === 'object' && c.focal !== null ? (c.focal as Record<string, unknown>) : {};
  return {
    fileId: posInt(c.file_id),
    width: posInt(c.width),
    height: posInt(c.height),
    ratio: (IMAGE_RATIOS as readonly unknown[]).includes(c.ratio) ? (c.ratio as ImageRatio) : 'original',
    fit: (IMAGE_FITS as readonly unknown[]).includes(c.fit) ? (c.fit as ImageFit) : 'cover',
    focal: { x: step(focal.x), y: step(focal.y) },
    caption: typeof c.caption === 'string' ? c.caption : '',
    alt: typeof c.alt === 'string' ? c.alt : '',
    src: isRenderableSrc(c.src) ? c.src : null,
  };
}

export function ratioValue(ratio: Exclude<ImageRatio, 'original'>): number {
  return RATIO_VALUE[ratio];
}

export function imageAspect(cfg: ImageConfig): number {
  if (cfg.ratio !== 'original') return RATIO_VALUE[cfg.ratio];
  return cfg.width && cfg.height ? cfg.width / cfg.height : FALLBACK_ASPECT;
}

/** Largura do quadro que mantém a altura <= 560px (vertical não vira um poste). */
export function frameWidth(aspect: number): string {
  return `min(100%, ${Math.round(IMAGE_MAX_HEIGHT_PX * aspect)}px)`;
}

export function orientationOf(cfg: ImageConfig): 'horizontal' | 'vertical' {
  return imageAspect(cfg) < 1 ? 'vertical' : 'horizontal';
}
```

- [ ] **Step 4: Implement `blocks/ImageBlock.tsx`**

```tsx
import type { BlockProps } from '../BlockRenderer';
import { frameWidth, imageAspect, readImageConfig } from '../image';

// Sem loading="lazy": a página de print espera img.decode() de todas as
// imagens antes de liberar o Gotenberg (RelatorioPrintPage.tsx).
export function ImageBlock({ block }: BlockProps) {
  const cfg = readImageConfig(block.config);
  if (!cfg.src) return null;
  const aspect = imageAspect(cfg);
  return (
    <figure
      className="rb-image"
      style={{ width: frameWidth(aspect) }}
    >
      <img
        src={cfg.src}
        alt={cfg.alt}
        decoding="async"
        className={cfg.fit === 'contain' ? 'rb-image-contain' : undefined}
        style={{
          aspectRatio: String(aspect),
          objectFit: cfg.fit,
          objectPosition: `${cfg.focal.x * 100}% ${cfg.focal.y * 100}%`,
        }}
      />
      {cfg.caption ? <figcaption>{cfg.caption}</figcaption> : null}
    </figure>
  );
}
```

- [ ] **Step 5: Register and catalog.**
  - `BlockRenderer.tsx`: `import { ImageBlock } from './blocks/ImageBlock';` and add `image: ImageBlock,` to `BLOCK_COMPONENTS`.
  - `catalog.ts`: add `'Mídia'` to the `WidgetCategory` union and to `WIDGET_CATEGORIES` between `'Texto'` and `'Estrutura'`; add `{ type: 'image', label: 'Imagem', category: 'Mídia' },` before the `cover` entry.
  - `data-presence.ts`: add before `default:`

    ```ts
        case 'image':
          // Sem arquivo = bloco vazio. O editor mostra a área de soltar
          // (ImageBlockEditor), nunca o placeholder genérico.
          return typeof block.config?.file_id === 'number';
    ```

  - `styles.css`: append

    ```css
    /* Bloco Imagem (spec 2026-10-02): quadro centralizado com teto de 560px de
       altura (largura = min(100%, 560px * proporção), inline no componente). */
    .rb-image {
      margin: 0 auto;
      break-inside: avoid;
    }
    .rb-image img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--rb-radius, 12px);
    }
    .rb-image img.rb-image-contain {
      background: var(--rb-soft, rgba(0, 0, 0, 0.04));
    }
    .rb-image figcaption {
      margin-top: 0.5rem;
      font-size: 0.8rem;
      line-height: 1.45;
      color: var(--rb-ink-soft, inherit);
      opacity: 0.85;
    }
    ```

  - `apps/crm/src/pages/relatorio-editor/widgetIcons.ts`: import `FileImage` and add `image: FileImage,` (cover keeps `Image`).

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run packages/report-blocks apps/crm/src/pages/relatorio-editor` then `npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/report-blocks apps/crm/src/pages/relatorio-editor/widgetIcons.ts
git commit -m "feat(report-blocks): bloco Imagem no renderer, catálogo Mídia e CSS de impressão"
```

---

### Task 8: CRM layout/template ops: `setBlockSize`, `sanitizeLayoutForTemplate`, apply warning

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/layoutOps.ts`
- Modify: `apps/crm/src/pages/relatorio-editor/templateOps.ts`
- Modify: `apps/crm/src/pages/relatorio-editor/SaveTemplateDialog.tsx`, `templateAutosave.ts`, `apps/crm/src/services/reportTemplates.ts`
- Modify: `apps/crm/src/pages/relatorio-editor/ApplyTemplateDialog.tsx`, `RelatorioEditorPage.tsx`
- Test: `apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts`, `templateOps.test.ts`, `ApplyTemplateDialog.test.tsx`

**Interfaces:**
- Produces: `setBlockSize(layout: ReportLayout, id: string, size: BlockSize): ReportLayout` (same reference if unchanged or cover); `layoutHasFilledImage(layout: ReportLayout): boolean` in `templateOps.ts`; `ApplyTemplateDialogProps.warnImagesRemoved?: boolean`.
- `templateOps.ts` keeps exporting `stripAiTextForTemplate` **as an alias** of `sanitizeLayoutForTemplate` only if other code imports it after this task; otherwise remove it (grep first).

- [ ] **Step 1: Failing tests**

`layoutOps.test.ts`:

```ts
import { setBlockSize } from '../layoutOps';

describe('setBlockSize', () => {
  const base = (): ReportLayout => ({ version: 1, blocks: [
    { id: 'i', type: 'image', size: 'full' },
    { id: 'c', type: 'cover', size: 'full' },
  ] });
  it('muda o size do bloco', () => {
    expect(setBlockSize(base(), 'i', 'half').blocks[0].size).toBe('half');
  });
  it('mesmo size, id inexistente ou capa: MESMA referência', () => {
    const l = base();
    expect(setBlockSize(l, 'i', 'full')).toBe(l);
    expect(setBlockSize(l, 'x', 'half')).toBe(l);
    expect(setBlockSize(l, 'c', 'half')).toBe(l);
  });
});
```

`templateOps.test.ts` (rename its `stripAiTextForTemplate` import/usages to `sanitizeLayoutForTemplate`; its existing `toBeUndefined()` expectations stay valid):

```ts
import { layoutHasFilledImage } from '../templateOps';

describe('layoutHasFilledImage', () => {
  it('só conta imagem com file_id', () => {
    expect(layoutHasFilledImage({ version: 1, blocks: [{ id: 'i', type: 'image', size: 'full' }] })).toBe(false);
    expect(layoutHasFilledImage({ version: 1, blocks: [
      { id: 'i', type: 'image', size: 'full', config: { file_id: 1, width: 1, height: 1 } },
    ] })).toBe(true);
  });
});
```

`ApplyTemplateDialog.test.tsx` (follow the file's existing render helper and template mock):

```tsx
it('avisa que as imagens saem quando warnImagesRemoved', async () => {
  // render like the existing tests, adding warnImagesRemoved
  renderDialog({ warnImagesRemoved: true });
  expect(
    await screen.findByText('As imagens deste relatório serão removidas. Elas continuam nos Arquivos do cliente.'),
  ).toBeInTheDocument();
});
```

(If the file has no `renderDialog` helper, inline the same `render(<QueryClientProvider ...><ApplyTemplateDialog open onOpenChange={vi.fn()} onApply={vi.fn()} warnImagesRemoved /></QueryClientProvider>)` its other tests use.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts apps/crm/src/pages/relatorio-editor/__tests__/ApplyTemplateDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`layoutOps.ts` (after `resizeBlock`):

```ts
/** Largura direta (o "Usar meia largura" do bloco de imagem). Capa é sempre
 * full; mesmo valor, id inexistente ou capa = MESMA referência. */
export function setBlockSize(layout: ReportLayout, id: string, size: BlockSize): ReportLayout {
  const idx = layout.blocks.findIndex((b) => b.id === id);
  if (idx < 0) return layout;
  const b = layout.blocks[idx];
  if (b.type === 'cover' || b.size === size) return layout;
  const blocks = [...layout.blocks];
  blocks[idx] = { ...b, size };
  return { ...layout, blocks };
}
```

`templateOps.ts`: delete the local `stripAiTextForTemplate` body and re-export the shared one; keep `applyTemplateLayout` and its `AI_TYPES`:

```ts
export { sanitizeLayoutForTemplate } from '@mesaas/report-blocks/types';

/** Relatório com ao menos uma imagem preenchida: aplicar um modelo (que só tem
 * espaços vazios) remove essas imagens do relatório. */
export function layoutHasFilledImage(layout: ReportLayout): boolean {
  return layout.blocks.some((b) => b.type === 'image' && typeof b.config?.file_id === 'number');
}
```

Replace `stripAiTextForTemplate` with `sanitizeLayoutForTemplate` in `SaveTemplateDialog.tsx`, `templateAutosave.ts` and `services/reportTemplates.ts` (import from `'../pages/relatorio-editor/templateOps'` stays valid via the re-export). Update `templateOps.test.ts` imports the same way. Run `grep -rn stripAiTextForTemplate apps/` and confirm zero hits.

`ApplyTemplateDialog.tsx`: add `warnImagesRemoved?: boolean` to the props and destructure it; right under `<DialogHeader>...</DialogHeader>` render:

```tsx
        {warnImagesRemoved && (
          <p className="text-sm text-muted-foreground">
            As imagens deste relatório serão removidas. Elas continuam nos Arquivos do cliente.
          </p>
        )}
```

`RelatorioEditorPage.tsx`: import `layoutHasFilledImage` from `./templateOps` and pass `warnImagesRemoved={layoutHasFilledImage(layout)}` to `<ApplyTemplateDialog>`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor apps/crm/src/services` and `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor apps/crm/src/services/reportTemplates.ts
git commit -m "feat(relatorio): setBlockSize, sanitizador compartilhado e aviso ao aplicar modelo"
```

---

### Task 9: CRM file services: `FileApiError`, folder helpers, in-use message, `useFileUrl`

**Files:**
- Modify: `apps/crm/src/services/fileService.ts`
- Create: `apps/crm/src/pages/arquivos/fileInUse.ts`
- Create: `apps/crm/src/services/fileApiError.ts`
- Modify: `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx`, `FolderInfoModal.tsx`, `FileGrid.tsx`
- Modify: `apps/crm/src/pages/arquivos/types.ts`
- Modify: `apps/crm/src/hooks/useFileUrl.ts`
- Test: `apps/crm/src/services/__tests__/fileService.test.ts`, `apps/crm/src/pages/arquivos/__tests__/FileContextMenu.test.tsx`, create `apps/crm/src/pages/arquivos/__tests__/fileInUse.test.ts`, create `apps/crm/src/hooks/__tests__/useFileUrl.test.ts` if absent (else extend)

**Interfaces:**
- Produces:
  - `export class FileApiError extends Error { readonly status: number; readonly body: Record<string, unknown> }`
  - `export async function getClientReportsFolderId(clienteId: number): Promise<number>` (RPC)
  - `export async function getClientFolderId(clienteId: number): Promise<number | null>`
  - `export function fileInUseMessage(body: Record<string, unknown>): string`
  - `resolveImageUrls` skips files with `media_lost_at` or `kind !== 'image'` (they resolve to "not in map" → `useFileUrl` returns `null`).

- [ ] **Step 1: Failing tests**

`fileInUse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fileInUseMessage } from '../fileInUse';

describe('fileInUseMessage', () => {
  it('posts e um relatório', () => {
    expect(fileInUseMessage({
      linked_posts: [{ post_id: 1 }, { post_id: 2 }],
      linked_reports: [{ report_id: 'a', title: 'Relatório de setembro' }],
    })).toBe('Este arquivo está em uso em 2 posts e no relatório Relatório de setembro. Remova de lá primeiro.');
  });
  it('um post', () => {
    expect(fileInUseMessage({ linked_posts: [{ post_id: 1 }], linked_reports: [] }))
      .toBe('Este arquivo está em uso em 1 post. Remova de lá primeiro.');
  });
  it('dois relatórios', () => {
    expect(fileInUseMessage({ linked_reports: [{ title: 'A' }, { title: 'B' }] }))
      .toBe('Este arquivo está em uso nos relatórios A e B. Remova de lá primeiro.');
  });
  it('sem detalhes', () => {
    expect(fileInUseMessage({})).toBe('Este arquivo está em uso e não pode ser excluído.');
  });
});
```

`fileService.test.ts` (follow its existing fetch mocking):

```ts
it('callFn lança FileApiError com status e corpo', async () => {
  // mock fetch to return 409 { error: 'file_in_use', linked_reports: [{ report_id: 'a', title: 'R' }] }
  await expect(deleteFile(10)).rejects.toMatchObject({
    name: 'FileApiError',
    message: 'file_in_use',
    status: 409,
    body: { error: 'file_in_use', linked_reports: [{ report_id: 'a', title: 'R' }] },
  });
});
```

`FileContextMenu.test.tsx`: replace the test `'blocks delete for files linked to posts and shows error toast'` with:

```tsx
  it('arquivo em uso: abre a confirmação e mostra a mensagem do servidor', async () => {
    mockedDeleteFile.mockRejectedValueOnce(
      new FileApiError('file_in_use', 409, {
        error: 'file_in_use',
        linked_posts: [{ post_id: 1 }, { post_id: 2 }],
        linked_reports: [{ report_id: 'a', title: 'Relatório de setembro' }],
      }),
    );
    const file = makeFile({ id: 100, reference_count: 3 });
    render(
      <FileContextMenu item={file} type="file" onActionComplete={onActionComplete} canEdit={true}>
        <div>Linked file</div>
      </FileContextMenu>,
    );
    rightClick(screen.getByText('Linked file'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }));
    // confirm in the dialog the same way the file's "deletes a file" test does
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith(
        'Este arquivo está em uso em 2 posts e no relatório Relatório de setembro. Remova de lá primeiro.',
      ),
    );
  });
```

Make the test file's `vi.mock('@/services/fileService', ...)` keep the real `FileApiError` (`...(await vi.importActual('@/services/fileService'))` pattern, or move `FileApiError` to its own module `apps/crm/src/services/fileApiError.ts` re-exported from `fileService.ts`; prefer the separate module so mocks of `fileService` don't need `importActual`).

`useFileUrl` test: mock `supabase.from('files').select(...).in(...)` returning `[{ id: 1, r2_key: 'contas/x/files/a.png', kind: 'image', media_lost_at: '2026-08-01' }, { id: 2, r2_key: 'contas/x/files/v.mp4', kind: 'video', media_lost_at: null }]` and assert `resolveImageUrls([1, 2])` resolves to an empty map **and** `fetch` was never called for `sign-r2-urls`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/services apps/crm/src/pages/arquivos apps/crm/src/hooks`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/crm/src/services/fileApiError.ts`:

```ts
/** Erro de edge function de arquivos com o corpo JSON preservado (o 409
 * file_in_use carrega linked_posts/linked_reports). message = body.error, então
 * quem testa `message.includes('file_in_use')` continua funcionando. */
export class FileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FileApiError';
  }
}
```

`fileService.ts`: `import { FileApiError } from './fileApiError'; export { FileApiError };` and in `callFn` replace the `!res.ok` block with:

```ts
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const msg = typeof err.error === 'string' ? err.error : `HTTP ${res.status}`;
    throw new FileApiError(msg, res.status, err);
  }
```

Add:

```ts
/** Pasta "Relatórios" do cliente (cria na primeira vez; RPC atômica). */
export async function getClientReportsFolderId(clienteId: number): Promise<number> {
  const { data, error } = await supabase.rpc('get_or_create_client_reports_folder', {
    p_cliente_id: clienteId,
  });
  if (error || typeof data !== 'number') throw new Error('Não foi possível preparar a pasta do cliente.');
  return data;
}

/** Pasta raiz do cliente nos Arquivos (onde o seletor abre). */
export async function getClientFolderId(clienteId: number): Promise<number | null> {
  const { data } = await supabase
    .from('folders')
    .select('id')
    .eq('source_type', 'client')
    .eq('source_id', clienteId)
    .maybeSingle();
  return (data as { id: number } | null)?.id ?? null;
}
```

`apps/crm/src/pages/arquivos/fileInUse.ts`:

```ts
function joinPt(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/** Mensagem do 409 file_in_use do file-manage (posts e relatórios). */
export function fileInUseMessage(body: Record<string, unknown>): string {
  const posts = Array.isArray(body.linked_posts) ? body.linked_posts.length : 0;
  const reports = Array.isArray(body.linked_reports)
    ? (body.linked_reports as Array<{ title?: unknown }>)
        .map((r) => (typeof r.title === 'string' && r.title ? r.title : 'sem título'))
    : [];
  const parts: string[] = [];
  if (posts > 0) parts.push(`em ${posts} ${posts === 1 ? 'post' : 'posts'}`);
  if (reports.length === 1) parts.push(`no relatório ${reports[0]}`);
  if (reports.length > 1) parts.push(`nos relatórios ${joinPt(reports)}`);
  if (parts.length === 0) return 'Este arquivo está em uso e não pode ser excluído.';
  return `Este arquivo está em uso ${parts.join(' e ')}. Remova de lá primeiro.`;
}
```

`FileContextMenu.tsx`:
- `openDelete`: remove the `if (!isFolder && file && file.reference_count > 0) { ... }` early return entirely.
- `handleDelete` catch block:

```ts
    } catch (err: unknown) {
      if (err instanceof FileApiError && err.body.error === 'file_in_use') {
        toast.error(fileInUseMessage(err.body));
      } else {
        toast.error('Erro ao excluir');
      }
    }
```

(imports: `FileApiError` from `@/services/fileService`, `fileInUseMessage` from `../fileInUse`.)

`FolderInfoModal.tsx`: label `"Links em posts"` → `"Em uso"`.

`FileGrid.tsx`: column header `Links` (line ~263) → `Em uso`; on both `reference_count` badges (list ~444, grid ~647) add `title="Em uso em posts ou relatórios"` to the `<span>`. Count and `LinkIcon` stay. Update any FileGrid test asserting the `Links` header.

`types.ts`: `source_type: 'client' | 'workflow' | 'post' | 'root_clients' | 'client_reports' | null;`

`useFileUrl.ts` in `resolveImageUrls`: change the select and filter:

```ts
  const { data: rows, error } = await supabase
    .from('files')
    .select('id, r2_key, kind, media_lost_at')
    .in('id', pending);
  if (error) throw error;
  // Perdido ou não-imagem não assina (sign-r2-urls não olha files): o id fica
  // fora do mapa e useFileUrl devolve null, o estado "indisponível" do editor.
  const files = (rows ?? []).filter(
    (f: { kind: string; media_lost_at: string | null }) => f.kind === 'image' && !f.media_lost_at,
  );
  if (files.length === 0) return map;
```

(Remove the old `if (!files || files.length === 0) return map;`.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run apps/crm/src/services apps/crm/src/pages/arquivos apps/crm/src/hooks apps/crm/src/pages/entregas` and `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS (PostMediaGallery and other `fileService` consumers unaffected).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services apps/crm/src/pages/arquivos apps/crm/src/hooks
git commit -m "feat(arquivos): erro tipado, mensagem de arquivo em uso com relatórios e pasta do cliente"
```

---

### Task 10: `FilePickerModal` single-select mode

**Files:**
- Modify: `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx`
- Modify: `apps/crm/src/pages/arquivos/__tests__/FilePickerModal.test.tsx`

**Interfaces:**
- Produces props: `selectionMode?: 'multiple' | 'single'`, `initialFolderId?: number | null`, `onSelectRecords?: (files: FileRecord[]) => void`, `allowedMimes?: string[]`. `onSelect` becomes optional (`onSelect?: (fileIds: number[]) => void`); existing callers keep passing it.

- [ ] **Step 1: Failing tests** (reuse the file's `makeFile`, `makeFolder`, render helper)

```tsx
describe('modo single', () => {
  it('abre em initialFolderId, filtra mime e lost, seleciona um só e devolve o registro', async () => {
    mockedGetFolderContents.mockResolvedValue({
      folder: null,
      breadcrumbs: [],
      subfolders: [],
      files: [
        makeFile({ id: 1, name: 'a.jpg', mime_type: 'image/jpeg', url: 'https://u/a' }),
        makeFile({ id: 2, name: 'b.png', mime_type: 'image/png', url: 'https://u/b' }),
        makeFile({ id: 3, name: 'c.gif', mime_type: 'image/gif' }),
        makeFile({ id: 4, name: 'd.jpg', mime_type: 'image/jpeg', media_lost_at: '2026-08-01T00:00:00Z' }),
      ],
    } as unknown as FolderContents);
    const onSelectRecords = vi.fn();
    renderPicker({
      selectionMode: 'single',
      initialFolderId: 77,
      filterKind: ['image'],
      allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
      onSelectRecords,
    });
    await waitFor(() => expect(mockedGetFolderContents).toHaveBeenCalledWith(77));
    expect(screen.getByText('Escolher imagem')).toBeInTheDocument();
    expect(screen.queryByText('c.gif')).not.toBeInTheDocument();
    expect(screen.queryByText('d.jpg')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('a.jpg'));
    fireEvent.click(screen.getByText('b.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Usar imagem' }));
    expect(onSelectRecords).toHaveBeenCalledWith([expect.objectContaining({ id: 2 })]);
  });
});
```

The file has no `renderPicker`: add one at the top of the new `describe` using the same `render(<FilePickerModal open={true} onClose={vi.fn()} ... />, { <same options as line 81> })` call the existing tests use. Build the mocked contents with the file's `makeFolderContents()` helper (line 79) overriding `files`, instead of the literal object above if their shapes differ.


- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/arquivos/__tests__/FilePickerModal.test.tsx`
Expected: new test FAILS; old tests PASS.

- [ ] **Step 3: Implement**

Props:

```ts
interface FilePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect?: (fileIds: number[]) => void;
  /** Registros completos (já com `url` assinada pelo file-manage). */
  onSelectRecords?: (files: FileRecord[]) => void;
  filterKind?: ('image' | 'video')[];
  /** Filtro extra por mime (ex.: bloco de imagem do relatório não aceita GIF). */
  allowedMimes?: string[];
  selectionMode?: 'multiple' | 'single';
  /** Pasta inicial; aplicada no reset de abertura (que antes zerava para a raiz). */
  initialFolderId?: number | null;
}
```

Destructure the new props with defaults `selectionMode = 'multiple'`, `initialFolderId = null`. In the open-reset effect: `setCurrentFolderId(initialFolderId);` and add `initialFolderId` to its deps.

After `kindFilteredFiles`, add:

```ts
  const mimeFilteredFiles = kindFilteredFiles.filter(
    (f) => (!allowedMimes || allowedMimes.includes(f.mime_type)) &&
      (selectionMode === 'multiple' || !f.media_lost_at),
  );
```

and use `mimeFilteredFiles` where `kindFilteredFiles` fed the search filter.

`toggleFile` in single mode replaces the selection:

```ts
  function toggleFile(id: number) {
    setSelectedFileIds((prev) => {
      if (selectionMode === 'single') return prev.has(id) ? new Set() : new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
```

`handleVincular`:

```ts
  function handleVincular() {
    const ids = [...selectedFileIds];
    onSelect?.(ids);
    onSelectRecords?.(allFiles.filter((f) => selectedFileIds.has(f.id)));
    onClose();
  }
```

Copy: title `selectionMode === 'single' ? 'Escolher imagem' : 'Selecionar arquivos'`; description `selectionMode === 'single' ? 'Escolha uma imagem.' : 'Escolha um ou mais arquivos para vincular.'`; confirm button label `selectionMode === 'single' ? 'Usar imagem' : 'Vincular'`; footer counter in single mode: `selectedCount === 0 ? 'Nenhuma imagem selecionada' : '1 imagem selecionada'`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/pages/arquivos apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos
git commit -m "feat(arquivos): seletor de arquivos em modo de imagem única"
```

---

### Task 11: Report image upload helper

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/reportImageUpload.ts`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/reportImageUpload.test.ts`

**Interfaces:**
- Produces:
  - `export const REPORT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const`
  - `export const REPORT_IMAGE_MAX_BYTES = 10 * 1024 * 1024`
  - `export function validateReportImage(file: File): string | null` (pt-BR error or null)
  - `export function scaledSize(w: number, h: number, max?: number): { width: number; height: number }`
  - `export async function prepareReportImage(file: File): Promise<{ file: File; width: number; height: number }>`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { scaledSize, validateReportImage } from '../reportImageUpload';

const f = (type: string, bytes: number) => new File([new Uint8Array(bytes)], 'x', { type });

describe('validateReportImage', () => {
  it('aceita jpg/png/webp até 10 MB', () => {
    expect(validateReportImage(f('image/png', 10))).toBeNull();
    expect(validateReportImage(f('image/webp', 10 * 1024 * 1024))).toBeNull();
  });
  it('formato não suportado', () => {
    expect(validateReportImage(f('image/gif', 10))).toBe('Formato não suportado. Use JPG, PNG ou WebP.');
  });
  it('acima do limite mostra o tamanho', () => {
    expect(validateReportImage(f('image/jpeg', 18 * 1024 * 1024))).toBe('Esta imagem tem 18 MB. O limite é 10 MB.');
  });
});

describe('scaledSize', () => {
  it('nunca amplia e limita o maior lado a 2400', () => {
    expect(scaledSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(scaledSize(4800, 2400)).toEqual({ width: 2400, height: 1200 });
    expect(scaledSize(1000, 5000)).toEqual({ width: 480, height: 2400 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/reportImageUpload.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// Validação e redução no navegador das imagens do bloco de relatório (spec
// 2026-10-02, "Envio"). Diferente de reportSplash.downscaleImage, que sempre
// achata em JPEG sobre fundo fixo: aqui PNG mantém transparência.
export const REPORT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const REPORT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 2400;
const JPEG_QUALITY = 0.85;

export function validateReportImage(file: File): string | null {
  if (!(REPORT_IMAGE_MIMES as readonly string[]).includes(file.type)) {
    return 'Formato não suportado. Use JPG, PNG ou WebP.';
  }
  if (file.size > REPORT_IMAGE_MAX_BYTES) {
    const mb = Math.round(file.size / (1024 * 1024));
    return `Esta imagem tem ${mb} MB. O limite é 10 MB.`;
  }
  return null;
}

export function scaledSize(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export async function prepareReportImage(
  file: File,
): Promise<{ file: File; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    if (width === bitmap.width && height === bitmap.height) return { file, width, height };
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Falha ao processar a imagem');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const isPng = file.type === 'image/png';
    const type = isPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))),
        type,
        isPng ? undefined : JPEG_QUALITY,
      ),
    );
    const name = isPng ? file.name : file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
    return { file: new File([blob], name, { type }), width, height };
  } finally {
    bitmap.close?.();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/reportImageUpload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/reportImageUpload.ts apps/crm/src/pages/relatorio-editor/__tests__/reportImageUpload.test.ts
git commit -m "feat(relatorio): validação e redução das imagens do bloco"
```

---

### Task 12: `ImageSettingsPanel` (popover body)

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/ImageSettingsPanel.tsx`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/ImageSettingsPanel.test.tsx`
- Modify: `apps/crm/style.css` (append the `.rb-img-*` editor rules below)

**Interfaces:**
- Consumes: `readImageConfig`, `orientationOf` (Task 7); `IMAGE_CAPTION_MAX`, `IMAGE_ALT_MAX` (Task 1).
- Produces:

```ts
export interface ImageSettingsPanelProps {
  block: ReportBlock;
  mode: 'report' | 'template';
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
  onSizeChange: (size: BlockSize) => void;
  onReplace?: () => void; // "Trocar imagem"; ausente no modo template
}
export function ImageSettingsPanel(props: ImageSettingsPanelProps): JSX.Element
```

- [ ] **Step 1: Failing tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageSettingsPanel } from '../ImageSettingsPanel';
import type { ReportBlock } from '@mesaas/report-blocks/types';

const block = (config: Record<string, unknown> = {}, size: ReportBlock['size'] = 'full'): ReportBlock =>
  ({ id: 'i', type: 'image', size, config: { file_id: 1, width: 1500, height: 1000, ...config } });

function setup(b: ReportBlock, mode: 'report' | 'template' = 'report') {
  const onConfigChange = vi.fn();
  const onSizeChange = vi.fn();
  const onReplace = vi.fn();
  render(<ImageSettingsPanel block={b} mode={mode} onConfigChange={onConfigChange}
    onSizeChange={onSizeChange} onReplace={mode === 'report' ? onReplace : undefined} />);
  return { onConfigChange, onSizeChange, onReplace };
}

describe('ImageSettingsPanel', () => {
  it('trocar para Vertical aplica 4:5', () => {
    const { onConfigChange } = setup(block({ ratio: '16:9' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Vertical' }));
    expect(onConfigChange).toHaveBeenCalledWith('i', { ratio: '4:5' });
  });

  it('Original esconde ajuste e enquadramento', () => {
    setup(block({ ratio: 'original' }));
    expect(screen.queryByRole('radiogroup', { name: 'Quando não couber' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Enquadramento' })).toBeNull();
  });

  it('Mostrar inteira esconde enquadramento; Preencher mostra', () => {
    setup(block({ ratio: '1:1', fit: 'contain' }));
    expect(screen.queryByRole('radiogroup', { name: 'Enquadramento' })).toBeNull();
  });

  it('enquadramento grava focal', () => {
    const { onConfigChange } = setup(block({ ratio: '1:1', fit: 'cover' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Topo' }));
    expect(onConfigChange).toHaveBeenCalledWith('i', { focal: { x: 0.5, y: 0 } });
  });

  it('vertical em largura total mostra a dica e Usar meia largura', () => {
    const { onSizeChange } = setup(block({ ratio: '9:16' }, 'full'));
    fireEvent.click(screen.getByRole('button', { name: 'Usar meia largura' }));
    expect(onSizeChange).toHaveBeenCalledWith('half');
  });

  it('legenda e descrição gravam o texto (vazio remove a chave)', () => {
    const { onConfigChange } = setup(block({ alt: 'x' }));
    fireEvent.change(screen.getByLabelText('Legenda (opcional)'), { target: { value: 'Oi' } });
    expect(onConfigChange).toHaveBeenCalledWith('i', { caption: 'Oi' });
    fireEvent.change(screen.getByLabelText('Descrição da imagem'), { target: { value: '' } });
    expect(onConfigChange).toHaveBeenCalledWith('i', { alt: undefined });
  });

  it('modo template: sem legenda, descrição nem Trocar imagem', () => {
    setup({ id: 'i', type: 'image', size: 'full' }, 'template');
    expect(screen.queryByLabelText('Legenda (opcional)')).toBeNull();
    expect(screen.queryByLabelText('Descrição da imagem')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Trocar imagem' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Original' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/ImageSettingsPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ImageSettingsPanel.tsx`**

```tsx
// Corpo do popover "Ajustes da imagem" (spec 2026-10-02; mockup artboard 3).
// Tudo vai por onConfigChange (desfazer/refazer); a largura vai por
// onSizeChange (block.size não é config).
import type { ReactNode } from 'react';
import { RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IMAGE_ALT_MAX, IMAGE_CAPTION_MAX } from '@mesaas/report-blocks/types';
import type { BlockSize, ImageRatio, ReportBlock } from '@mesaas/report-blocks/types';
import { orientationOf, readImageConfig } from '@mesaas/report-blocks/image';

const H_RATIOS: ImageRatio[] = ['original', '16:9', '3:2', '4:3', '1:1'];
const V_RATIOS: ImageRatio[] = ['original', '4:5', '3:4', '2:3', '9:16'];
const FOCAL_LABELS = [
  'Topo à esquerda', 'Topo', 'Topo à direita',
  'Esquerda', 'Centro', 'Direita',
  'Base à esquerda', 'Base', 'Base à direita',
];

export interface ImageSettingsPanelProps {
  block: ReportBlock;
  mode: 'report' | 'template';
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
  onSizeChange: (size: BlockSize) => void;
  onReplace?: () => void;
}

function Seg<T extends string>({
  label, value, options, onPick,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onPick: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="rb-img-seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`rb-img-seg-btn${value === o.value ? ' is-on' : ''}`}
          onClick={() => value !== o.value && onPick(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ImageSettingsPanel({
  block, mode, onConfigChange, onSizeChange, onReplace,
}: ImageSettingsPanelProps) {
  const cfg = readImageConfig(block.config);
  const orientation = orientationOf(cfg);
  const ratios = orientation === 'vertical' ? V_RATIOS : H_RATIOS;
  const patch = (p: Record<string, unknown>) => onConfigChange(block.id, p);
  const isOriginal = cfg.ratio === 'original';

  return (
    <div className="rb-img-panel">
      <p className="rb-img-label">Orientação</p>
      <Seg
        label="Orientação"
        value={orientation}
        options={[
          { value: 'horizontal', label: 'Horizontal', icon: <RectangleHorizontal className="h-4 w-4" aria-hidden /> },
          { value: 'vertical', label: 'Vertical', icon: <RectangleVertical className="h-4 w-4" aria-hidden /> },
        ]}
        onPick={(o) => patch({ ratio: o === 'vertical' ? '4:5' : '16:9' })}
      />

      <p className="rb-img-label">Proporção</p>
      <div role="radiogroup" aria-label="Proporção" className="rb-img-chips">
        {ratios.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={cfg.ratio === r}
            className={`rb-img-chip${cfg.ratio === r ? ' is-on' : ''}`}
            onClick={() => cfg.ratio !== r && patch({ ratio: r })}
          >
            {r === 'original' ? 'Original' : r}
          </button>
        ))}
      </div>
      {isOriginal && (
        <p className="rb-img-help">
          {mode === 'template'
            ? 'Usa o formato da imagem que for enviada em cada relatório.'
            : 'Mostra a imagem inteira, no formato em que foi enviada.'}
        </p>
      )}

      {!isOriginal && (
        <>
          <p className="rb-img-label">Quando não couber</p>
          <Seg
            label="Quando não couber"
            value={cfg.fit}
            options={[
              { value: 'cover', label: 'Preencher' },
              { value: 'contain', label: 'Mostrar inteira' },
            ]}
            onPick={(fit) => patch({ fit })}
          />
          <p className="rb-img-help">
            {cfg.fit === 'cover'
              ? 'Corta as bordas para preencher o formato.'
              : 'Mostra tudo, com faixas nas sobras.'}
          </p>
        </>
      )}

      {!isOriginal && cfg.fit === 'cover' && (
        <>
          <p className="rb-img-label">Enquadramento</p>
          <div role="radiogroup" aria-label="Enquadramento" className="rb-img-focal">
            {FOCAL_LABELS.map((label, i) => {
              const x = (i % 3) / 2;
              const y = Math.floor(i / 3) / 2;
              const on = cfg.focal.x === x && cfg.focal.y === y;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={label}
                  className={`rb-img-focal-dot${on ? ' is-on' : ''}`}
                  onClick={() => !on && patch({ focal: { x, y } })}
                />
              );
            })}
          </div>
          <p className="rb-img-help">Escolhe qual parte da imagem fica visível quando ela é cortada.</p>
        </>
      )}

      {orientation === 'vertical' && block.size === 'full' && (
        <div className="rb-img-hint">
          Em largura total, imagens verticais ficam com até 560 px de altura, centralizadas.{' '}
          <button type="button" className="rb-img-link" onClick={() => onSizeChange('half')}>
            Usar meia largura
          </button>
        </div>
      )}

      {mode === 'report' && (
        <>
          <Label htmlFor={`img-caption-${block.id}`} className="rb-img-label">
            Legenda (opcional)
          </Label>
          <Input
            id={`img-caption-${block.id}`}
            value={cfg.caption}
            maxLength={IMAGE_CAPTION_MAX}
            placeholder="Escreva uma legenda"
            onChange={(e) => patch({ caption: e.target.value || undefined })}
          />
          <Label htmlFor={`img-alt-${block.id}`} className="rb-img-label">
            Descrição da imagem
          </Label>
          <Input
            id={`img-alt-${block.id}`}
            value={cfg.alt}
            maxLength={IMAGE_ALT_MAX}
            onChange={(e) => patch({ alt: e.target.value || undefined })}
          />
          <p className="rb-img-help">Lida por leitores de tela. Não aparece no relatório.</p>
        </>
      )}

      {onReplace && (
        <div className="rb-img-footer">
          <Button size="sm" variant="outline" onClick={onReplace}>
            Trocar imagem
          </Button>
        </div>
      )}
    </div>
  );
}
```

Note: `orientationOf` for `original` uses the file's own dimensions, so a portrait upload shows "Vertical" selected with the vertical ratio list, matching the spec ("orientação deriva da proporção"). In template mode `original` has no dims and `imageAspect` falls back to 3:2 (horizontal).

`apps/crm/style.css` (append near the `.rb-text-editor` rules):

```css
/* ===== Bloco Imagem no editor (spec 2026-10-02) ===== */
.rb-img-panel { width: 300px; padding: 0.25rem 0.25rem 0.5rem; font-size: 0.8125rem; }
.rb-img-label { display: block; margin: 0.9rem 0 0.45rem; font-size: 0.78rem; font-weight: 600; color: var(--text-main); }
.rb-img-help { margin: 0.35rem 0 0; font-size: 0.75rem; line-height: 1.45; color: var(--text-light); }
.rb-img-seg { display: flex; gap: 3px; padding: 3px; border-radius: 8px; background: var(--surface-2); }
.rb-img-seg-btn { flex: 1 1 0; height: 32px; display: flex; align-items: center; justify-content: center; gap: 6px; border: none; border-radius: 6px; background: transparent; color: var(--text-light); font: inherit; cursor: pointer; }
.rb-img-seg-btn.is-on { background: var(--card-bg); color: var(--text-main); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
.rb-img-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.rb-img-chip { height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-main); font: inherit; cursor: pointer; }
.rb-img-chip.is-on { background: var(--text-main); border-color: var(--text-main); color: var(--card-bg); }
.rb-img-focal { display: grid; grid-template-columns: repeat(3, 28px); gap: 2px; padding: 3px; width: max-content; border-radius: 8px; background: var(--surface-2); }
.rb-img-focal-dot { width: 28px; height: 28px; border: none; background: transparent; cursor: pointer; position: relative; }
.rb-img-focal-dot::after { content: ''; position: absolute; inset: 0; margin: auto; width: 6px; height: 6px; border-radius: 999px; background: var(--text-light); }
.rb-img-focal-dot.is-on::after { width: 12px; height: 12px; background: var(--text-main); }
.rb-img-hint { margin-top: 0.9rem; padding: 0.6rem 0.75rem; border-radius: 10px; border: 1px solid var(--border-color); background: var(--surface-1); font-size: 0.78rem; line-height: 1.45; color: var(--text-muted); }
.rb-img-link { border: none; background: none; padding: 0; font: inherit; font-weight: 600; color: var(--text-main); text-decoration: underline; cursor: pointer; }
.rb-img-footer { margin-top: 1rem; padding-top: 0.85rem; border-top: 1px solid var(--border-color); }
.rb-img-drop { box-sizing: border-box; min-height: 240px; border: 1.5px dashed var(--border-color); border-radius: 12px; background: var(--surface-1); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6rem; text-align: center; padding: 1.5rem; color: var(--text-light); }
.rb-img-drop.is-over { border-color: var(--text-main); background: var(--surface-hover); }
.rb-img-drop.is-error { border-color: var(--danger); }
.rb-img-drop-title { font-weight: 600; color: var(--text-main); }
.rb-img-drop-error { font-weight: 600; color: var(--danger-text); }
.rb-img-drop-hint { font-size: 0.75rem; line-height: 1.5; max-width: 280px; }
.rb-img-progress { position: relative; }
.rb-img-progress img { opacity: 0.45; }
.rb-img-progress-bar { position: absolute; left: 1rem; right: 1rem; bottom: 1rem; padding: 0.6rem 0.75rem; border-radius: 10px; background: var(--card-bg); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12); font-size: 0.8rem; }
.rb-img-progress-track { margin-top: 0.4rem; height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.rb-img-progress-fill { height: 100%; background: var(--text-main); }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/ImageSettingsPanel.test.tsx` and `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS. (If `@/components/ui/label` does not exist, use a plain `<label className="rb-img-label" htmlFor=...>`.)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/ImageSettingsPanel.tsx apps/crm/src/pages/relatorio-editor/__tests__/ImageSettingsPanel.test.tsx apps/crm/style.css
git commit -m "feat(relatorio): painel de ajustes da imagem"
```

---

### Task 13: `ImageBlockEditor` + canvas wiring

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/ImageBlockEditor.tsx`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/ImageBlockEditor.test.tsx`
- Modify: `apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx`
- Modify: `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx`, `ModeloEditorPage.tsx`
- Modify: `apps/crm/src/pages/relatorio-editor/__tests__/EditorCanvas.test.tsx`

**Interfaces:**
- Consumes: `uploadFile`, `getClientReportsFolderId`, `getClientFolderId` (Task 9); `useFileUrl`, `seedImageUrl` (existing + Task 9); `FilePickerModal` (Task 10); `validateReportImage`, `prepareReportImage`, `REPORT_IMAGE_MIMES` (Task 11); `ImageSettingsPanel` (Task 12); `ImageBlock`, `readImageConfig` (Task 7); `setBlockSize` (Task 8).
- Produces:

```ts
export type ImageEditorContext = { mode: 'report'; clientId: number } | { mode: 'template' };
export interface ImageBlockEditorProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
  context: ImageEditorContext;
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
  onSizeChange: (size: BlockSize) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}
```

- `EditorCanvasProps` gains `imageContext?: ImageEditorContext`.

- [ ] **Step 1: Failing tests** (`ImageBlockEditor.test.tsx`)

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/fileService', async () => ({
  ...(await vi.importActual<object>('@/services/fileApiError')),
  uploadFile: vi.fn(),
  getClientReportsFolderId: vi.fn(),
  getClientFolderId: vi.fn(),
}));
vi.mock('@/hooks/useFileUrl', () => ({ useFileUrl: vi.fn(), seedImageUrl: vi.fn() }));
vi.mock('../reportImageUpload', async (orig) => ({
  ...(await orig<object>()),
  prepareReportImage: vi.fn(async (file: File) => ({ file, width: 1600, height: 900 })),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { getClientReportsFolderId, uploadFile } from '@/services/fileService';
import { useFileUrl } from '@/hooks/useFileUrl';
import { ImageBlockEditor } from '../ImageBlockEditor';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportBlock } from '@mesaas/report-blocks/types';

const empty: ReportBlock = { id: 'i', type: 'image', size: 'full' };
const filled: ReportBlock = { id: 'i', type: 'image', size: 'full',
  config: { file_id: 5, width: 1600, height: 900, alt: 'Equipe' } };

function setup(block: ReportBlock, context = { mode: 'report' as const, clientId: 7 }) {
  const onConfigChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImageBlockEditor block={block} snapshot={makeSnapshotFixture()} context={context}
        onConfigChange={onConfigChange} onSizeChange={vi.fn()}
        settingsOpen={false} onSettingsOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  return { onConfigChange };
}

beforeEach(() => {
  vi.mocked(useFileUrl).mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() } as never);
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:local');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('ImageBlockEditor', () => {
  it('vazio: área de soltar com envio e seletor', () => {
    setup(empty);
    expect(screen.getByText('Arraste uma imagem para cá')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar imagem' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escolher dos arquivos' })).toBeInTheDocument();
  });

  it('formato inválido mostra erro e não envia', async () => {
    setup(empty);
    const input = screen.getByLabelText('Arquivo de imagem') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    expect(await screen.findByText('Formato não suportado. Use JPG, PNG ou WebP.')).toBeInTheDocument();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('envio grava file_id, dimensões e ratio original num passo', async () => {
    vi.mocked(getClientReportsFolderId).mockResolvedValue(99);
    vi.mocked(uploadFile).mockResolvedValue({ id: 5, url: 'https://signed/x' } as never);
    const { onConfigChange } = setup(empty);
    const input = screen.getByLabelText('Arquivo de imagem') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    await waitFor(() => expect(onConfigChange).toHaveBeenCalledTimes(1));
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ folderId: 99 }));
    expect(onConfigChange).toHaveBeenCalledWith('i', { file_id: 5, width: 1600, height: 900, ratio: 'original' });
  });

  it('preenchido com URL: renderiza a imagem', () => {
    vi.mocked(useFileUrl).mockReturnValue({ data: 'blob:img', isLoading: false, isError: false, refetch: vi.fn() } as never);
    setup(filled);
    expect(screen.getByRole('img', { name: 'Equipe' })).toHaveAttribute('src', 'blob:img');
  });

  it('preenchido sem URL (perdido): Imagem indisponível + Trocar imagem', () => {
    vi.mocked(useFileUrl).mockReturnValue({ data: null, isLoading: false, isError: false, refetch: vi.fn() } as never);
    setup(filled);
    expect(screen.getByText('Imagem indisponível')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trocar imagem' })).toBeInTheDocument();
  });

  it('modo template: espaço para imagem, sem envio', () => {
    setup(empty, { mode: 'template' } as never);
    expect(screen.getByText('Espaço para imagem')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar imagem' })).toBeNull();
  });
});
```

Add to `EditorCanvas.test.tsx`:

```tsx
  it('bloco image: botão Ajustes da imagem na toolbar e área de soltar no corpo', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EditorCanvas
          layout={{ version: 1, blocks: [{ id: 'i', type: 'image', size: 'full' }] }}
          snapshot={makeSnapshotFixture()}
          onChange={() => {}}
          onConfigChange={() => {}}
          imageContext={{ mode: 'template' }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('Ajustes da imagem')).toBeInTheDocument();
    expect(screen.getByText('Espaço para imagem')).toBeInTheDocument();
  });
```

(import `QueryClient`, `QueryClientProvider` from `@tanstack/react-query` in that test file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/ImageBlockEditor.test.tsx apps/crm/src/pages/relatorio-editor/__tests__/EditorCanvas.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ImageBlockEditor.tsx`**

```tsx
// Bloco Imagem no canvas do editor (spec 2026-10-02): área de soltar, envio,
// seletor dos Arquivos, imagem assinada (blob via useFileUrl) e o popover de
// ajustes ancorado na célula. O layout só recebe file_id + dimensões; a URL
// fica no cache do useFileUrl e nunca vai para o config persistido.
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useFileUrl, seedImageUrl } from '@/hooks/useFileUrl';
import {
  FileApiError,
  getClientFolderId,
  getClientReportsFolderId,
  uploadFile,
} from '@/services/fileService';
import { FilePickerModal } from '../arquivos/components/FilePickerModal';
import type { FileRecord } from '../arquivos/types';
import { ImageBlock } from '@mesaas/report-blocks/blocks/ImageBlock';
import { frameWidth, imageAspect, readImageConfig } from '@mesaas/report-blocks/image';
import type { BlockSize, ReportBlock, ReportDocSnapshot } from '@mesaas/report-blocks/types';
import { ImageSettingsPanel } from './ImageSettingsPanel';
import { REPORT_IMAGE_MIMES, prepareReportImage, validateReportImage } from './reportImageUpload';

export type ImageEditorContext = { mode: 'report'; clientId: number } | { mode: 'template' };

export interface ImageBlockEditorProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
  context: ImageEditorContext;
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
  onSizeChange: (size: BlockSize) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}

function uploadErrorMessage(err: unknown): string {
  if (err instanceof FileApiError && err.status === 413) return 'Sem espaço de armazenamento no plano.';
  return 'Não foi possível enviar a imagem.';
}

function loadDims(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('load'));
    img.src = url;
  });
}

export function ImageBlockEditor({
  block, snapshot, context, onConfigChange, onSizeChange, settingsOpen, onSettingsOpenChange,
}: ImageBlockEditorProps) {
  const cfg = readImageConfig(block.config);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ preview: string; pct: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFolder, setPickerFolder] = useState<number | null>(null);
  const lastFile = useRef<File | null>(null);
  const isTemplate = context.mode === 'template';

  const url = useFileUrl(isTemplate ? null : cfg.fileId);

  useEffect(() => () => {
    if (uploading) URL.revokeObjectURL(uploading.preview);
  }, [uploading]);

  async function handleFile(file: File) {
    if (context.mode !== 'report') return;
    const invalid = validateReportImage(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    lastFile.current = file;
    const preview = URL.createObjectURL(file);
    setUploading({ preview, pct: 0 });
    try {
      const prepared = await prepareReportImage(file);
      const folderId = await getClientReportsFolderId(context.clientId);
      const record = await uploadFile({
        file: prepared.file,
        folderId,
        onProgress: (p) => setUploading((u) => (u ? { ...u, pct: Math.round((p.loaded / p.total) * 100) } : u)),
      });
      if (record.url) seedImageUrl(record.id, record.url);
      onConfigChange(block.id, {
        file_id: record.id,
        width: prepared.width,
        height: prepared.height,
        ratio: 'original',
      });
    } catch (err) {
      setError(uploadErrorMessage(err));
    } finally {
      setUploading(null);
    }
  }

  async function openPicker() {
    if (context.mode !== 'report') return;
    setPickerFolder(await getClientFolderId(context.clientId).catch(() => null));
    setPickerOpen(true);
  }

  async function handlePicked(files: FileRecord[]) {
    const f = files[0];
    if (!f) return;
    let width = f.width;
    let height = f.height;
    if ((!width || !height) && f.url) {
      try {
        ({ width, height } = await loadDims(f.url));
      } catch {
        width = null;
        height = null;
      }
    }
    if (!width || !height) {
      toast.error('Não foi possível abrir esta imagem.');
      return;
    }
    if (f.url) seedImageUrl(f.id, f.url);
    onConfigChange(block.id, { file_id: f.id, width, height, ratio: 'original' });
  }

  const settings = (
    <Popover open={settingsOpen} onOpenChange={onSettingsOpenChange}>
      <PopoverAnchor asChild>
        <span className="rb-img-anchor" aria-hidden />
      </PopoverAnchor>
      <PopoverContent align="end" side="right" className="w-auto">
        <ImageSettingsPanel
          block={block}
          mode={context.mode}
          onConfigChange={onConfigChange}
          onSizeChange={onSizeChange}
          onReplace={isTemplate ? undefined : () => inputRef.current?.click()}
        />
      </PopoverContent>
    </Popover>
  );

  const fileInput = !isTemplate && (
    <input
      ref={inputRef}
      type="file"
      hidden
      aria-label="Arquivo de imagem"
      accept={REPORT_IMAGE_MIMES.join(',')}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void handleFile(file);
      }}
    />
  );

  if (isTemplate) {
    const aspect = imageAspect(cfg);
    return (
      <div className="rb-img-wrap">
        {settings}
        <div
          className="rb-img-drop"
          style={{ aspectRatio: String(aspect), width: frameWidth(aspect), margin: '0 auto' }}
        >
          <ImagePlus className="h-5 w-5" aria-hidden />
          <p className="rb-img-drop-title">Espaço para imagem</p>
          <p className="rb-img-drop-hint">
            Cada relatório criado com este modelo começa com este espaço vazio, já no formato escolhido.
          </p>
        </div>
      </div>
    );
  }

  if (uploading) {
    return (
      <div className="rb-img-wrap rb-img-progress">
        <img src={uploading.preview} alt="" style={{ width: '100%', borderRadius: 12 }} />
        <div className="rb-img-progress-bar" role="status">
          <span>Enviando imagem</span> <span>{uploading.pct}%</span>
          <div className="rb-img-progress-track">
            <div className="rb-img-progress-fill" style={{ width: `${uploading.pct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  const pickerModal = (
    <FilePickerModal
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      selectionMode="single"
      initialFolderId={pickerFolder}
      filterKind={['image']}
      allowedMimes={[...REPORT_IMAGE_MIMES]}
      onSelectRecords={(files) => void handlePicked(files)}
    />
  );

  if (cfg.fileId === null || error) {
    return (
      <div className="rb-img-wrap">
        {settings}
        {fileInput}
        {pickerModal}
        <div
          className={`rb-img-drop${dragOver ? ' is-over' : ''}${error ? ' is-error' : ''}`}
          tabIndex={0}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          onPaste={(e) => {
            const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
            if (file) void handleFile(file);
          }}
        >
          {error ? (
            <>
              <TriangleAlert className="h-5 w-5" aria-hidden />
              <p className="rb-img-drop-error" role="alert">{error}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {lastFile.current && error === 'Não foi possível enviar a imagem.' && (
                  <Button size="sm" variant="outline" onClick={() => void handleFile(lastFile.current!)}>
                    Tentar novamente
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => { setError(null); inputRef.current?.click(); }}>
                  Escolher outra
                </Button>
              </div>
            </>
          ) : (
            <>
              <ImagePlus className="h-5 w-5" aria-hidden />
              <p className="rb-img-drop-title">Arraste uma imagem para cá</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                  Enviar imagem
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void openPicker()}>
                  Escolher dos arquivos
                </Button>
              </div>
              <p className="rb-img-drop-hint">
                JPG, PNG ou WebP até 10 MB. Também dá para colar uma imagem copiada. Imagens enviadas
                ficam nos Arquivos do cliente.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (url.isError || url.data === null) {
    return (
      <div className="rb-img-wrap">
        {settings}
        {fileInput}
        {pickerModal}
        <div className="rb-img-drop is-error">
          <TriangleAlert className="h-5 w-5" aria-hidden />
          <p className="rb-img-drop-title">Imagem indisponível</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {url.isError && (
              <Button size="sm" variant="outline" onClick={() => void url.refetch()}>
                Tentar novamente
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              Trocar imagem
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const src = url.data ?? null;
  return (
    <div className="rb-img-wrap">
      {settings}
      {fileInput}
      {pickerModal}
      {src ? (
        <ImageBlock block={{ ...block, config: { ...block.config, src } }} snapshot={snapshot} />
      ) : (
        <div className="rb-img-drop" aria-busy="true" />
      )}
    </div>
  );
}
```

Notes for the implementer:
- `ImageBlock` accepts `blob:` sources (Task 7), which is what `useFileUrl` returns.
- `useFileUrl(null)` is disabled (`enabled: typeof fileId === 'number'`), so the template and empty states make no requests.
- The upload is wrapped by `uploadFile` in `trackUnsavedWork`; no `useBlocker`.
- If the editor unmounts mid-upload, `onConfigChange` may fire on a stale layout ref; this is accepted by the spec (file stays in "Relatórios").

- [ ] **Step 4: Wire `EditorCanvas.tsx`**
  - Imports: `SlidersHorizontal` from lucide; `ImageBlockEditor, type ImageEditorContext` from `./ImageBlockEditor`; `setBlockSize` from `./layoutOps`.
  - `SortableCellProps` gains `imageContext?: ImageEditorContext; onSizeChange: (size: BlockSize) => void;` (import `BlockSize` type).
  - In `SortableCell`: `const [imgSettingsOpen, setImgSettingsOpen] = useState(false);` and `const isImageEditable = block.type === 'image' && onConfigChange && imageContext;`
  - Body chain: add, before the `section_header` branch,

    ```tsx
    ) : isImageEditable ? (
      <ImageBlockEditor
        block={block}
        snapshot={snapshot}
        context={imageContext!}
        onConfigChange={onConfigChange!}
        onSizeChange={onSizeChange}
        settingsOpen={imgSettingsOpen}
        onSettingsOpenChange={setImgSettingsOpen}
      />
    ```

  - Toolbar: after the "Aumentar largura" button (still inside the non-cover fragment), add

    ```tsx
            {isImageEditable && (
              <button
                type="button"
                className="rb-edit-btn"
                aria-label="Ajustes da imagem"
                aria-pressed={imgSettingsOpen}
                onClick={() => setImgSettingsOpen((v) => !v)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            )}
    ```

  - `EditorCanvasProps` gains `imageContext?: ImageEditorContext;` (doc comment: "Habilita o editor do bloco Imagem; ausente = bloco renderiza como na view."). Pass `imageContext` and

    ```tsx
              onSizeChange={(size) => {
                const next = setBlockSize(layout, block.id, size);
                if (next !== layout) onChange(next);
              }}
    ```

    to each `SortableCell`.
  - The DragOverlay keeps using `BLOCK_COMPONENTS` (an empty image block renders nothing while dragging; acceptable).

- [ ] **Step 5: Pass context from the pages**
  - `RelatorioEditorPage.tsx`: `<EditorCanvas ... imageContext={{ mode: 'report', clientId: doc.client_id }} />`
  - `ModeloEditorPage.tsx`: `<EditorCanvas ... imageContext={{ mode: 'template' }} />`

- [ ] **Step 6: Run tests + all four typechecks**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor packages/report-blocks`
Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor
git commit -m "feat(relatorio): editor do bloco Imagem com envio, seletor e ajustes"
```

---

### Task 14: Full gates and browser verification

**Files:** none new (fixes only, if a gate fails).

- [ ] **Step 1: Run every CI gate locally**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
bash scripts/test-entitlements.sh
```

Expected: all green. If `npm run format:check` fails, run `npm run format` and commit. After `test:functions`, check `git status` for a dirtied `deno.lock` / polluted `node_modules` (see memory: run `npm ci` if `node_modules/.deno` appears; revert `deno.lock` noise).

- [ ] **Step 2: Browser check (CRM editor) against local Supabase or staging**

Start the CRM via the preview tools (`preview_start` with the CRM dev server from `.claude/launch.json`; this worktree has no `.env`, so use the `dev:env` script config). Log in with the seed flow (memory: "Seed login p/ verificação no Browser pane"). Open a report, then:
1. Adicionar widget → Mídia → Imagem: empty drop area appears.
2. Enviar imagem (PNG with transparency): progress, then the image; config shows `ratio: original`.
3. Ajustes da imagem: switch Vertical (4:5), Preencher, each focal position; switch to Mostrar inteira; at full width a 9:16 shows the hint and "Usar meia largura" halves the block.
4. Undo/redo steps through those changes.
5. Escolher dos arquivos: picker opens in the client folder, single select, GIFs hidden; choosing applies the image.
6. Arquivos: try deleting that image → toast names the report.
7. Salvar como modelo → open the model: the block is "Espaço para imagem" with the same ratio.
8. Aplicar modelo on a report with an image: warning text visible.
9. Exportar PDF: image intact on one page, not split.
10. Ver como cliente (Hub): image renders; at mobile width the half blocks stack.

Take screenshots of steps 3, 5, 9 and 10 for the PR.

- [ ] **Step 3: Commit any fixes, then push and open the PR**

Before `gh pr create`: confirm migration prefixes are above main's tail (`git fetch origin main && git ls-tree origin/main supabase/migrations | tail -3`) and renumber `20261003000001/2` if needed. PR description lists the deploy order from the spec (migration → `hub-report-docs` (`--no-verify-jwt`), `report-docs`, `file-manage`, `sign-r2-urls` → merge).
