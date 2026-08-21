# Relatório interativo de blocos — PR 1 (Fundação) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fundação do relatório interativo de blocos: migration + geração síncrona (`report-docs/generate`) + pacote `@mesaas/report-blocks` com todos os widgets v1 em render read-only + rota `/relatorios/:id` no CRM + entrada na página de Analytics.

**Architecture:** Componente novo e paralelo (spec: `docs/superpowers/specs/2026-08-20-report-builder-blocks-design.md`). Documento = `layout jsonb` (blocos ordenados) + `data_snapshot jsonb` (todas as fontes congeladas, branding incluído). Lógica pura compartilhada (schema do layout, KPIs, snapshot, layout padrão) vive em `supabase/functions/_shared/report-docs/` (TS puro, sem APIs Deno) e é importada tanto pela edge function quanto pelo pacote React — precedente: `ReportPreview.tsx:1` importa `_shared/report-template/theme`. PR 2 = editor; PR 3 = templates + Hub + PDF.

**Tech Stack:** Deno edge functions, Postgres/RLS, React 19 + TanStack Query, Tailwind, Vitest, deno test.

## Global Constraints

- Copy de usuário em pt-BR, **sem travessão (em-dash)** — use ponto, dois-pontos ou "·".
- A área de analytics do CRM é hardcoded pt-BR (sem i18n) — o código novo desta área segue igual.
- `packages/report-blocks` NUNCA importa `@/...` (alias aponta pro src de cada app — bug documentado em `packages/ui/index.ts:1-11`). Só imports relativos, React e `@mesaas/*`.
- Testes de packages SÓ são coletados em `packages/**/__tests__/*.test.{ts,tsx}` (`vitest.config.ts:31`).
- Arquivos em `_shared/report-docs/` são TS puro: sem `Deno.*`, sem `npm:` imports, imports internos com extensão `.ts` (exigência do Deno).
- Edge function: CORS via `buildCorsHeaders(req)`; erro pro cliente sempre genérico; `Deno.serve`; auth = client anon com header Authorization + `getUser()` + `profiles.conta_id` via service client (padrão `instagram-analytics/index.ts:193-237`).
- Todo ID recebido pela edge function é validado contra o `conta_id` do usuário (service role bypassa RLS). Falha = erro "Unauthorized" → 401/404 genérico.
- Migration: prefixo de versão ÚNICO. Tail de `origin/main` hoje: `20260820000003`. Usar `20260820000010`. Re-verificar com `git ls-tree --name-only origin/main:supabase/migrations | tail` antes do `gh pr create`.
- `REVOKE ... FROM public` derruba service_role junto — revogar só de `anon, authenticated` e dar `GRANT ALL ... TO service_role` explícito.
- Depois de qualquer `deno test`/deploy: `git checkout -- deno.lock` (o root deno.lock é sujado sempre).
- Antes do push: `npm run lint`, `npm run format:check`, os 4 `tsc` (crm, hub, admin, scripts), `npm run test`, `npm run test:functions`.
- Worktree: prefixe caminhos com o worktree completo; `git -C <worktree> status` antes de afirmar qualquer coisa. `npm ci` DENTRO do worktree se `node_modules/.deno` existir ou o node_modules for emprestado.
- Commits pequenos por task, mensagem `feat(relatorios): ...` ou `chore/test/docs`, rodapé `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**Worktree/branch:** `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/report-restructure-41a80e`, branch `claude/report-restructure-41a80e`. Todos os caminhos abaixo são relativos a essa raiz.

---

### Task 1: Migration `report_documents` + `report_templates` + teste RLS

**Files:**
- Create: `supabase/migrations/20260820000010_report_docs.sql`
- Create: `supabase/tests/entitlements/50_report_docs.sql` (antes de criar, rode `ls supabase/tests/entitlements/` — se `50_` já existir, use o próximo NN livre e ajuste o `raise notice` interno)

**Interfaces:**
- Produces: tabelas `report_documents` e `report_templates` (colunas exatamente como abaixo), função `validate_report_layout()`, RPC `set_default_report_template(uuid)`. Task 5 insere em `report_documents` via service role; Task 9 lê via PostgREST com RLS.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260820000010_report_docs.sql
-- Relatório interativo de blocos (fundação): report_documents + report_templates.
-- Spec: docs/superpowers/specs/2026-08-20-report-builder-blocks-design.md

-- ============ REPORT_DOCUMENTS ============
CREATE TABLE report_documents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id            bigint NOT NULL,
  instagram_account_id uuid REFERENCES instagram_accounts(id) ON DELETE SET NULL,
  title                text NOT NULL DEFAULT '',
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  layout               jsonb NOT NULL,
  data_snapshot        jsonb,
  ai_content           jsonb,
  status               text NOT NULL DEFAULT 'ready'
                         CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  generation_error     text,
  pdf_storage_path     text,
  pdf_generated_at     timestamptz,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Amarra client_id ao conta_id estruturalmente (par único criado em
  -- 20260815000002: clientes_id_conta_uq). Documento morre com o cliente.
  CONSTRAINT report_documents_client_same_tenant FOREIGN KEY (client_id, conta_id)
    REFERENCES clientes (id, conta_id) ON DELETE CASCADE
);

CREATE INDEX report_documents_conta_idx  ON report_documents (conta_id);
CREATE INDEX report_documents_client_idx ON report_documents (client_id, period_start DESC);

CREATE OR REPLACE FUNCTION set_report_documents_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER report_documents_updated_at
  BEFORE UPDATE ON report_documents
  FOR EACH ROW EXECUTE FUNCTION set_report_documents_updated_at();

-- Validação grosseira do layout: escrita direta via PostgREST não pode
-- persistir lixo. A validação fina (tipos de bloco, bounds de config) é o
-- validador TS compartilhado; aqui só a forma.
CREATE OR REPLACE FUNCTION validate_report_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layout IS NULL
     OR jsonb_typeof(NEW.layout) <> 'object'
     OR jsonb_typeof(NEW.layout -> 'version') <> 'number'
     OR jsonb_typeof(NEW.layout -> 'blocks') <> 'array'
     OR jsonb_array_length(NEW.layout -> 'blocks') > 200 THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
    WHERE jsonb_typeof(b) <> 'object'
       OR jsonb_typeof(b -> 'id') <> 'string'
       OR jsonb_typeof(b -> 'type') <> 'string'
       OR COALESCE(b ->> 'size', 'full') NOT IN ('third', 'half', 'full')
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER report_documents_validate_layout
  BEFORE INSERT OR UPDATE OF layout ON report_documents
  FOR EACH ROW EXECUTE FUNCTION validate_report_layout();

ALTER TABLE report_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_documents_select ON report_documents
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY report_documents_update ON report_documents
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY report_documents_service_role_bypass ON report_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Superfície de escrita: authenticated só lê e edita (layout, title).
-- Criação, deleção, status, snapshot e campos de PDF são exclusivos da edge
-- function. REVOKE direcionado (não FROM public: isso derrubaria service_role).
REVOKE ALL ON public.report_documents FROM anon, authenticated;
GRANT SELECT ON public.report_documents TO authenticated;
GRANT UPDATE (layout, title) ON public.report_documents TO authenticated;
GRANT ALL ON public.report_documents TO service_role;

-- ============ REPORT_TEMPLATES ============
CREATE TABLE report_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name       text NOT NULL,
  layout     jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_templates_conta_idx ON report_templates (conta_id);
-- No máximo UM default por workspace; troca atômica só pela RPC abaixo.
CREATE UNIQUE INDEX report_templates_one_default ON report_templates (conta_id)
  WHERE is_default;

CREATE OR REPLACE FUNCTION set_report_templates_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER report_templates_updated_at
  BEFORE UPDATE ON report_templates
  FOR EACH ROW EXECUTE FUNCTION set_report_templates_updated_at();

CREATE TRIGGER report_templates_validate_layout
  BEFORE INSERT OR UPDATE OF layout ON report_templates
  FOR EACH ROW EXECUTE FUNCTION validate_report_layout();

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_templates_select ON report_templates
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_templates_insert ON report_templates
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_templates_update ON report_templates
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_templates_delete ON report_templates
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_templates_service_role_bypass ON report_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_default_report_template(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE report_templates SET is_default = false
   WHERE conta_id = v_conta AND is_default;
  UPDATE report_templates SET is_default = true
   WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_default_report_template(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_default_report_template(uuid) TO authenticated, service_role;
```

- [ ] **Step 2: Escrever o teste RLS/grants**

Padrão do arquivo: `supabase/tests/entitlements/40_cliente_tables_tenant_isolation.sql` (impersonação REAL de `authenticated` — claims-only não testa RLS; ver aviso nas linhas 24-29 daquele arquivo).

```sql
-- supabase/tests/entitlements/50_report_docs.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
select et_grant_hosted_parity();
do $$
declare
  v_user uuid := gen_random_uuid();
  v_ws_a uuid; v_ws_b uuid;
  v_cli_a bigint; v_cli_b bigint;
  v_doc_a uuid; v_doc_b uuid;
  v_tpl_1 uuid; v_tpl_2 uuid;
  v_seen int; v_rows int;
  v_layout jsonb := '{"version":1,"blocks":[{"id":"b1","type":"text","size":"full"}]}'::jsonb;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_user, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id = v_user;

  insert into clientes (conta_id, nome) values (v_ws_a, 'Cliente A') returning id into v_cli_a;
  insert into clientes (conta_id, nome) values (v_ws_b, 'Cliente B') returning id into v_cli_b;

  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_a, v_cli_a, '2026-07-01', '2026-07-31', v_layout) returning id into v_doc_a;
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_b, v_cli_b, '2026-07-01', '2026-07-31', v_layout) returning id into v_doc_b;

  -- Trigger de validação: layout sem "version" numérica é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-06-01', '2026-06-30', '{"blocks":[]}'::jsonb);
    raise exception 'validate_report_layout aceitou layout sem version';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  insert into report_templates (conta_id, name, layout, is_default)
    values (v_ws_a, 'T1', v_layout, true) returning id into v_tpl_1;
  insert into report_templates (conta_id, name, layout)
    values (v_ws_a, 'T2', v_layout) returning id into v_tpl_2;

  -- Índice parcial: segundo default direto no mesmo workspace falha.
  begin
    update report_templates set is_default = true where id = v_tpl_2;
    raise exception 'dois defaults no mesmo workspace foram aceitos';
  exception when unique_violation then null;
  end;

  -- ---- agir como o usuário (workspace ativo = A) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- SELECT: só o workspace ativo.
  select count(*) into v_seen from report_documents;
  assert v_seen = 1, format('report_documents: esperava 1 visivel, veio %s', v_seen);

  -- UPDATE de layout/title no próprio doc funciona.
  update report_documents set title = 'Editado', layout = v_layout where id = v_doc_a;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'update de layout/title no proprio doc falhou';

  -- UPDATE no doc do outro workspace: RLS filtra (0 linhas).
  update report_documents set title = 'HACK' where id = v_doc_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'RLS deixou editar doc de outro workspace';

  -- Grant por coluna: status/data_snapshot são invioláveis pelo authenticated.
  begin
    update report_documents set status = 'failed' where id = v_doc_a;
    raise exception 'authenticated conseguiu escrever status';
  exception when insufficient_privilege then null;
  end;
  begin
    update report_documents set data_snapshot = '{}'::jsonb where id = v_doc_a;
    raise exception 'authenticated conseguiu escrever data_snapshot';
  exception when insufficient_privilege then null;
  end;

  -- Sem INSERT nem DELETE para authenticated.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-05-01', '2026-05-31', v_layout);
    raise exception 'authenticated conseguiu inserir report_document';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from report_documents where id = v_doc_a;
    raise exception 'authenticated conseguiu deletar report_document';
  exception when insufficient_privilege then null;
  end;

  -- RPC de default: troca atômica T1 -> T2.
  perform set_default_report_template(v_tpl_2);
  assert (select is_default from report_templates where id = v_tpl_2) = true,
    'RPC nao marcou o novo default';
  assert (select is_default from report_templates where id = v_tpl_1) = false,
    'RPC nao desmarcou o default anterior';

  raise notice 'PASS 50_report_docs';
end $$;
rollback;
```

ATENÇÃO ao Step 2: `et_grant_hosted_parity()` dá `grant all` em TODAS as tabelas — isso desfaria o grant por coluna. Por isso o teste deve, logo APÓS o `select et_grant_hosted_parity();`, reaplicar a superfície restrita:

```sql
-- Reimpõe a superfície restrita que a migration define e a parity desfez.
revoke all on public.report_documents from anon, authenticated;
grant select on public.report_documents to authenticated;
grant update (layout, title) on public.report_documents to authenticated;
```

Insira essas 4 linhas entre `select et_grant_hosted_parity();` e o `do $$`.

- [ ] **Step 3: Rodar localmente se houver Docker (senão o CI cobre)**

```bash
colima status >/dev/null 2>&1 && npx supabase start && npm run test:db
```

Esperado: `PASS supabase/tests/entitlements/50_report_docs.sql`. Sem Docker/colima: siga em frente, o job `entitlement-tests` do CI é o gate real.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260820000010_report_docs.sql supabase/tests/entitlements/50_report_docs.sql
git commit -m "feat(relatorios): schema report_documents + report_templates com RLS e grants por coluna"
```

---

### Task 2: Schema do layout + janela de mês (lógica pura compartilhada)

**Files:**
- Create: `supabase/functions/_shared/report-docs/layout.ts`
- Create: `supabase/functions/_shared/report-docs/layout.test.ts`
- Create: `supabase/functions/_shared/report-docs/month-window.ts`
- Create: `supabase/functions/_shared/report-docs/month-window.test.ts`

**Interfaces:**
- Produces (consumido por Tasks 4, 5, 6, 9):
  - `LAYOUT_VERSION = 1`, `BLOCK_SIZES: readonly ['third','half','full']`, `type BlockSize`
  - `BLOCK_TYPES` (25 tipos, lista abaixo), `type BlockType`, `TEXT_BLOCK_TYPES: readonly BlockType[]`
  - `interface ReportBlock { id: string; type: BlockType; size: BlockSize; config?: Record<string, unknown>; text?: unknown }`
  - `interface ReportLayout { version: number; blocks: ReportBlock[] }`
  - `validateLayout(raw: unknown): { ok: true; layout: ReportLayout } | { ok: false; error: string }`
  - `monthWindow(month: string): MonthWindow` com `{ month, start, endExclusive, startDate, endDateExclusive, label }`; `prevMonthOf(month: string): string`

- [ ] **Step 1: Escrever os testes (Deno, colocados junto — o glob `*.test.ts` é coletado)**

```ts
// supabase/functions/_shared/report-docs/layout.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { BLOCK_TYPES, LAYOUT_VERSION, validateLayout } from "./layout.ts";

const block = (over: Record<string, unknown> = {}) => ({
  id: "b1", type: "text", size: "full", ...over,
});
const layout = (blocks: unknown[]) => ({ version: LAYOUT_VERSION, blocks });

Deno.test("validateLayout aceita layout mínimo válido", () => {
  const r = validateLayout(layout([block()]));
  assert(r.ok);
  assertEquals(r.layout.blocks.length, 1);
});

Deno.test("validateLayout rejeita não-objeto, version errada e blocks ausente", () => {
  assert(!validateLayout(null).ok);
  assert(!validateLayout([]).ok);
  assert(!validateLayout({ version: 99, blocks: [] }).ok);
  assert(!validateLayout({ version: LAYOUT_VERSION }).ok);
});

Deno.test("validateLayout rejeita bloco com tipo desconhecido, size inválido e id vazio", () => {
  assert(!validateLayout(layout([block({ type: "nope" })])).ok);
  assert(!validateLayout(layout([block({ size: "xl" })])).ok);
  assert(!validateLayout(layout([block({ id: "" })])).ok);
});

Deno.test("validateLayout: text só em blocos textuais; count do top_posts entre 1 e 12", () => {
  assert(validateLayout(layout([block({ type: "ai_summary", text: { type: "doc" } })])).ok);
  assert(!validateLayout(layout([block({ type: "kpi_reach", size: "third", text: {} })])).ok);
  assert(validateLayout(layout([block({ type: "top_posts", config: { count: 6 } })])).ok);
  assert(!validateLayout(layout([block({ type: "top_posts", config: { count: 0 } })])).ok);
  assert(!validateLayout(layout([block({ type: "top_posts", config: { count: 13 } })])).ok);
});

Deno.test("validateLayout rejeita mais de 200 blocos e ids duplicados", () => {
  const many = Array.from({ length: 201 }, (_, i) => block({ id: `b${i}` }));
  assert(!validateLayout(layout(many)).ok);
  assert(!validateLayout(layout([block({ id: "x" }), block({ id: "x" })])).ok);
});

Deno.test("catálogo tem os 25 tipos da spec", () => {
  assertEquals(BLOCK_TYPES.length, 25);
});
```

```ts
// supabase/functions/_shared/report-docs/month-window.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { monthWindow, prevMonthOf } from "./month-window.ts";

Deno.test("monthWindow calcula bordas e label pt-BR", () => {
  const w = monthWindow("2026-07");
  assertEquals(w.startDate, "2026-07-01");
  assertEquals(w.endDateExclusive, "2026-08-01");
  assertEquals(w.start, "2026-07-01T00:00:00.000Z");
  assertEquals(w.endExclusive, "2026-08-01T00:00:00.000Z");
  assertEquals(w.label, "Julho de 2026");
});

Deno.test("monthWindow vira o ano em dezembro", () => {
  assertEquals(monthWindow("2025-12").endDateExclusive, "2026-01-01");
});

Deno.test("prevMonthOf", () => {
  assertEquals(prevMonthOf("2026-01"), "2025-12");
  assertEquals(prevMonthOf("2026-07"), "2026-06");
});

Deno.test("monthWindow rejeita formato inválido", () => {
  let threw = false;
  try { monthWindow("2026-7"); } catch { threw = true; }
  assert(threw);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run test:functions -- --filter "validateLayout"
```

Esperado: FAIL (módulo `./layout.ts` não existe). Nota: `--filter` casa com NOMES de teste, não arquivos.

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/report-docs/layout.ts
// Schema do layout do relatório de blocos. TS PURO: importado pela edge
// function (Deno) E pelo pacote React (Vite/tsc) — nada de Deno.*, nada de deps.
// Spec: docs/superpowers/specs/2026-08-20-report-builder-blocks-design.md §4

export const LAYOUT_VERSION = 1;

export const BLOCK_SIZES = ["third", "half", "full"] as const;
export type BlockSize = (typeof BLOCK_SIZES)[number];

export const BLOCK_TYPES = [
  // Estrutura
  "cover", "section_header", "divider",
  // Texto & IA (todos renderizam `text` TipTap JSON)
  "text", "ai_summary", "ai_recommendations", "ai_goals",
  // Números
  "kpi_followers_gained", "kpi_followers_total", "kpi_reach",
  "kpi_engagement_rate", "kpi_saves", "kpi_posts_count",
  "kpi_profile_views", "kpi_website_clicks",
  // Gráficos
  "chart_followers", "chart_formats", "chart_best_times",
  // Audiência
  "audience_gender", "audience_age", "audience_cities", "audience_countries",
  // Conteúdo
  "top_posts", "post_list", "tags_table",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const TEXT_BLOCK_TYPES: readonly BlockType[] = [
  "text", "ai_summary", "ai_recommendations", "ai_goals",
];

export const MAX_BLOCKS = 200;
export const TOP_POSTS_MIN = 1;
export const TOP_POSTS_MAX = 12;

export interface ReportBlock {
  id: string;
  type: BlockType;
  size: BlockSize;
  config?: Record<string, unknown>;
  /** JSON TipTap; permitido só em TEXT_BLOCK_TYPES. */
  text?: unknown;
}

export interface ReportLayout {
  version: number;
  blocks: ReportBlock[];
}

export type ValidateLayoutResult =
  | { ok: true; layout: ReportLayout }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validação estrita para ESCRITA (editor e edge function). Renderers são
 * tolerantes por conta própria (bloco desconhecido é ignorado na leitura). */
export function validateLayout(raw: unknown): ValidateLayoutResult {
  if (!isRecord(raw)) return { ok: false, error: "layout must be an object" };
  if (raw.version !== LAYOUT_VERSION) {
    return { ok: false, error: `unsupported layout version` };
  }
  if (!Array.isArray(raw.blocks)) return { ok: false, error: "blocks must be an array" };
  if (raw.blocks.length > MAX_BLOCKS) return { ok: false, error: "too many blocks" };

  const seen = new Set<string>();
  for (const b of raw.blocks) {
    if (!isRecord(b)) return { ok: false, error: "block must be an object" };
    if (typeof b.id !== "string" || b.id.length === 0) {
      return { ok: false, error: "block id must be a non-empty string" };
    }
    if (seen.has(b.id)) return { ok: false, error: "duplicate block id" };
    seen.add(b.id);
    if (!(BLOCK_TYPES as readonly string[]).includes(b.type as string)) {
      return { ok: false, error: `unknown block type` };
    }
    if (!(BLOCK_SIZES as readonly string[]).includes(b.size as string)) {
      return { ok: false, error: "invalid block size" };
    }
    if (b.config !== undefined && !isRecord(b.config)) {
      return { ok: false, error: "config must be an object" };
    }
    if (
      b.text !== undefined &&
      !TEXT_BLOCK_TYPES.includes(b.type as BlockType)
    ) {
      return { ok: false, error: "text is only allowed on text blocks" };
    }
    if (b.type === "top_posts" || b.type === "post_list") {
      const count = (b.config as Record<string, unknown> | undefined)?.count;
      if (count !== undefined) {
        if (
          typeof count !== "number" || !Number.isInteger(count) ||
          count < TOP_POSTS_MIN || count > TOP_POSTS_MAX
        ) {
          return { ok: false, error: "count out of bounds" };
        }
      }
    }
  }
  return { ok: true, layout: raw as unknown as ReportLayout };
}
```

```ts
// supabase/functions/_shared/report-docs/month-window.ts
// Janela de mês própria do report-docs (não depende do monthWindow interno do
// gerador v2). Labels pt-BR fixos: determinismo independente de ICU.

export interface MonthWindow {
  month: string;            // "YYYY-MM"
  start: string;            // ISO timestamp inclusivo
  endExclusive: string;     // ISO timestamp exclusivo
  startDate: string;        // "YYYY-MM-01"
  endDateExclusive: string; // primeiro dia do mês seguinte
  label: string;            // "Julho de 2026"
}

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function parseMonth(month: string): { y: number; m: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`invalid month: ${month}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) throw new Error(`invalid month: ${month}`);
  return { y, m };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function monthWindow(month: string): MonthWindow {
  const { y, m } = parseMonth(month);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const startDate = `${y}-${pad(m)}-01`;
  const endDateExclusive = `${nextY}-${pad(nextM)}-01`;
  return {
    month,
    start: `${startDate}T00:00:00.000Z`,
    endExclusive: `${endDateExclusive}T00:00:00.000Z`,
    startDate,
    endDateExclusive,
    label: `${MONTHS_PT[m - 1]} de ${y}`,
  };
}

export function prevMonthOf(month: string): string {
  const { y, m } = parseMonth(month);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npm run test:functions -- --filter "validateLayout"
npm run test:functions -- --filter "monthWindow"
git checkout -- deno.lock
```

Esperado: PASS em todos.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-docs/
git commit -m "feat(relatorios): schema de layout compartilhado + janela de mês"
```

---

### Task 3: Motor de KPIs (`computeKpis`) com a invariante uma-base-por-card

**Files:**
- Create: `supabase/functions/_shared/report-docs/kpis.ts`
- Create: `supabase/functions/_shared/report-docs/kpis.test.ts`

**Interfaces:**
- Consumes: nada (puro).
- Produces (consumido por Tasks 4, 5 e pelos widgets da Task 7):
  - `KPI_IDS: readonly ReportKpiId[]` (8 ids)
  - `type ReportKpiId = 'followers_gained'|'followers_total'|'reach'|'engagement_rate'|'saves'|'posts_count'|'profile_views'|'website_clicks'`
  - `interface KpiEntry { value: number | null; unit: 'count' | 'pct'; prev: number | null }`
  - `interface KpiSources` (shape abaixo)
  - `computeKpis(s: KpiSources): Record<ReportKpiId, KpiEntry>`

Regra herdada do gerador v2 (comentários em `instagram-report-generator-v2/index.ts:618-706`): **valor e `prev` de um card são sempre a MESMA medida; sem prev na mesma base, `prev = null` e o widget mostra só o valor.** Novidades da spec §7: `followers_total` (close do mês), e `prev` de `engagement_rate`/`posts_count` derivados de `prevMonthPosts` (mesma base month-sum, que o v2 já busca mas não usa para esses cards).

- [ ] **Step 1: Escrever o teste**

```ts
// supabase/functions/_shared/report-docs/kpis.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { computeKpis, type KpiSources } from "./kpis.ts";

const post = (over: Partial<KpiSources["allPosts"][number]> = {}) => ({
  reach: 100, likes: 10, comments: 2, saved: 3, shares: 1, ...over,
});

const base = (): KpiSources => ({
  allPosts: [post(), post({ reach: 300, likes: 30 })],
  prevMonthPosts: [post({ reach: 200 })],
  currSnapshot: {
    followers_count: 1200, profile_views_28d: 500, website_clicks_28d: 40,
  },
  prevSnapshot: {
    followers_count: 1100, profile_views_28d: 450, website_clicks_28d: 50,
  },
  prevPrevSnapshot: { followers_count: 1050 },
  followerHistory: [{ follower_count: 1150 }],
  liveFollowerCount: 1234,
});

Deno.test("caso completo: 8 KPIs com prev na mesma base", () => {
  const k = computeKpis(base());
  assertEquals(k.followers_gained.value, 100);          // 1200 - 1100
  assertEquals(k.followers_gained.prev, 50);            // 1100 - 1050
  assertEquals(k.followers_total.value, 1200);
  assertEquals(k.followers_total.prev, 1100);
  assertEquals(k.reach.value, 400);
  assertEquals(k.reach.prev, 200);
  assertEquals(k.saves.value, 6);
  assertEquals(k.saves.prev, 3);
  assertEquals(k.posts_count.value, 2);
  assertEquals(k.posts_count.prev, 1);
  assertEquals(k.profile_views.value, 500);
  assertEquals(k.profile_views.prev, 450);
  assertEquals(k.website_clicks.value, 40);
  assertEquals(k.website_clicks.prev, 50);
  // engagement: (10+2+3+1 + 30+2+3+1) / 400 * 100 = 13.0 ; prev: 16/200*100 = 8.0
  assertEquals(k.engagement_rate.value, 13);
  assertEquals(k.engagement_rate.prev, 8);
  assertEquals(k.engagement_rate.unit, "pct");
});

Deno.test("sem snapshots: followers_gained cai pro history (sem prev); followers_total idem", () => {
  const s = base();
  s.currSnapshot = null;
  s.prevSnapshot = null;
  s.prevPrevSnapshot = null;
  const k = computeKpis(s);
  assertEquals(k.followers_gained.value, 84);  // live 1234 - primeiro history 1150
  assertEquals(k.followers_gained.prev, null);
  assertEquals(k.followers_total.value, 1150); // último ponto do history do mês
  assertEquals(k.followers_total.prev, null);
  assertEquals(k.profile_views.value, null);   // 28d sem snapshot do mês: some
  assertEquals(k.website_clicks.value, null);
});

Deno.test("ganho negativo em qualquer mês retém o prev de followers_gained", () => {
  const s = base();
  s.currSnapshot = { ...s.currSnapshot!, followers_count: 1000 }; // ganho -100
  const k = computeKpis(s);
  assertEquals(k.followers_gained.value, -100);
  assertEquals(k.followers_gained.prev, null);
});

Deno.test("mês anterior sem posts: reach/saves/engagement/posts_count sem prev", () => {
  const s = base();
  s.prevMonthPosts = [];
  const k = computeKpis(s);
  assertEquals(k.reach.prev, null);
  assertEquals(k.saves.prev, null);
  assertEquals(k.engagement_rate.prev, null);
  assertEquals(k.posts_count.prev, null);
});

Deno.test("prevMonthPosts null (query falhou) nunca vira zero", () => {
  const s = base();
  s.prevMonthPosts = null;
  const k = computeKpis(s);
  assertEquals(k.posts_count.prev, null);
});

Deno.test("soma anterior zero = desconhecido, não colapso: prev retido", () => {
  const s = base();
  s.prevMonthPosts = [post({ reach: 0, saved: 0, likes: 0, comments: 0, shares: 0 })];
  const k = computeKpis(s);
  assertEquals(k.reach.prev, null);
  assertEquals(k.saves.prev, null);
  assertEquals(k.engagement_rate.prev, null); // alcance anterior 0: razão indefinida
  assertEquals(k.posts_count.prev, 1);        // contagem é contagem: 1 post existiu
});

Deno.test("mês sem posts: engagement value 0, reach 0", () => {
  const s = base();
  s.allPosts = [];
  const k = computeKpis(s);
  assertEquals(k.reach.value, 0);
  assertEquals(k.engagement_rate.value, 0);
  assertEquals(k.posts_count.value, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run test:functions -- --filter "caso completo"
```

Esperado: FAIL (`./kpis.ts` não existe).

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/report-docs/kpis.ts
// KPIs do snapshot com a invariante do gerador v2: valor e prev de um card são
// SEMPRE a mesma medida (uma base por card). Sem prev comparável, prev = null
// e o widget mostra só o valor. Fonte da regra: comentários extensos em
// instagram-report-generator-v2/index.ts §5-6.

export const KPI_IDS = [
  "followers_gained", "followers_total", "reach", "engagement_rate",
  "saves", "posts_count", "profile_views", "website_clicks",
] as const;
export type ReportKpiId = (typeof KPI_IDS)[number];

export interface KpiEntry {
  /** null = sem dado nessa base (o widget se omite no viewer/print). */
  value: number | null;
  unit: "count" | "pct";
  prev: number | null;
}

interface PostMetrics {
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
}

interface MonthSnapshot {
  followers_count?: number | null;
  profile_views_28d?: number | null;
  website_clicks_28d?: number | null;
}

export interface KpiSources {
  allPosts: PostMetrics[];
  /** null = a query do mês anterior FALHOU (nunca confundir com []). */
  prevMonthPosts: PostMetrics[] | null;
  currSnapshot: MonthSnapshot | null;
  prevSnapshot: MonthSnapshot | null;
  prevPrevSnapshot: MonthSnapshot | null;
  /** Pontos do mês do relatório, ordem cronológica. */
  followerHistory: { follower_count: number }[];
  liveFollowerCount: number | null;
}

const sum = (posts: PostMetrics[], key: keyof PostMetrics) =>
  posts.reduce((s, p) => s + (p[key] ?? 0), 0);

const interactions = (posts: PostMetrics[]) =>
  sum(posts, "likes") + sum(posts, "comments") + sum(posts, "saved") + sum(posts, "shares");

export function computeKpis(s: KpiSources): Record<ReportKpiId, KpiEntry> {
  const totalReach = sum(s.allPosts, "reach");
  const totalSaved = sum(s.allPosts, "saved");
  const totalInteractions = interactions(s.allPosts);
  const engagement = totalReach > 0 ? (totalInteractions / totalReach) * 100 : 0;

  const currClose = typeof s.currSnapshot?.followers_count === "number"
    ? s.currSnapshot.followers_count : null;
  const prevClose = typeof s.prevSnapshot?.followers_count === "number"
    ? s.prevSnapshot.followers_count : null;
  const prevPrevClose = typeof s.prevPrevSnapshot?.followers_count === "number"
    ? s.prevPrevSnapshot.followers_count : null;

  // followers_gained: preferência close-to-close; fallback history (sem prev).
  let gained: number | null = null;
  let gainedPrev: number | null = null;
  if (currClose !== null && prevClose !== null) {
    gained = currClose - prevClose;
    if (prevPrevClose !== null) {
      const prevGain = prevClose - prevPrevClose;
      // Percentual só entre dois ganhos POSITIVOS (ganho é grandeza com sinal;
      // -100 -> -50 daria "+50%" num mês de perda).
      if (gained > 0 && prevGain > 0) gainedPrev = prevGain;
    }
  } else if (s.followerHistory.length > 0 && s.liveFollowerCount !== null) {
    gained = s.liveFollowerCount - s.followerHistory[0].follower_count;
  } else {
    gained = 0;
  }

  // followers_total: close do mês; fallback = último ponto do history DO MÊS,
  // sempre sem prev (bases distintas). Nunca o live para mês passado.
  let total: number | null = currClose;
  let totalPrev: number | null = null;
  if (total !== null && prevClose !== null) totalPrev = prevClose;
  if (total === null && s.followerHistory.length > 0) {
    total = s.followerHistory[s.followerHistory.length - 1].follower_count;
  }

  // reach/saves/engagement/posts_count prev: base month-sum do mês anterior.
  let reachPrev: number | null = null;
  let savesPrev: number | null = null;
  let engagementPrev: number | null = null;
  let postsPrev: number | null = null;
  if (s.prevMonthPosts && s.prevMonthPosts.length > 0) {
    const pReach = sum(s.prevMonthPosts, "reach");
    const pSaved = sum(s.prevMonthPosts, "saved");
    if (pReach > 0) {
      reachPrev = pReach;
      engagementPrev = (interactions(s.prevMonthPosts) / pReach) * 100;
    }
    if (pSaved > 0) savesPrev = pSaved;
    postsPrev = s.prevMonthPosts.length;
  }

  // 28d: snapshot-a-snapshot ou nada (sem fallback pro live: outra base).
  const pv = typeof s.currSnapshot?.profile_views_28d === "number"
    ? s.currSnapshot.profile_views_28d : null;
  const pvPrev = pv !== null && typeof s.prevSnapshot?.profile_views_28d === "number"
    ? s.prevSnapshot.profile_views_28d : null;
  const wc = typeof s.currSnapshot?.website_clicks_28d === "number"
    ? s.currSnapshot.website_clicks_28d : null;
  const wcPrev = wc !== null && typeof s.prevSnapshot?.website_clicks_28d === "number"
    ? s.prevSnapshot.website_clicks_28d : null;

  return {
    followers_gained: { value: gained, unit: "count", prev: gainedPrev },
    followers_total: { value: total, unit: "count", prev: totalPrev },
    reach: { value: totalReach, unit: "count", prev: reachPrev },
    engagement_rate: { value: engagement, unit: "pct", prev: engagementPrev },
    saves: { value: totalSaved, unit: "count", prev: savesPrev },
    posts_count: { value: s.allPosts.length, unit: "count", prev: postsPrev },
    profile_views: { value: pv, unit: "count", prev: pvPrev },
    website_clicks: { value: wc, unit: "count", prev: wcPrev },
  };
}
```

- [ ] **Step 4: Rodar e ver passar; commit**

```bash
npm run test:functions -- --filter "prev"
git checkout -- deno.lock
git add supabase/functions/_shared/report-docs/kpis.ts supabase/functions/_shared/report-docs/kpis.test.ts
git commit -m "feat(relatorios): computeKpis com invariante uma-base-por-card"
```

---

### Task 4: Snapshot (tipos + montagem pura), layout padrão e documentos TipTap

**Files:**
- Create: `supabase/functions/_shared/report-docs/snapshot.ts`
- Create: `supabase/functions/_shared/report-docs/snapshot.test.ts`
- Create: `supabase/functions/_shared/report-docs/default-layout.ts`
- Create: `supabase/functions/_shared/report-docs/default-layout.test.ts`
- Create: `supabase/functions/_shared/report-docs/tiptap-doc.ts`
- Create: `supabase/functions/_shared/report-docs/tiptap-doc.test.ts`

**Interfaces:**
- Consumes: `computeKpis`/`KpiSources`/`KpiEntry`/`ReportKpiId` (Task 3), `monthWindow` (Task 2), tipos `AudienceData`, `BestTimeSlot`, `TagPerformance`, `ContentBreakdown`, `FollowerTrendPoint`, `AIOutput` de `../report-template/types.ts` (existente).
- Produces (consumido por Tasks 5, 6-8, 9):
  - `interface ReportDocSnapshot { version: 1; period: { month: string; label: string; start: string; endExclusive: string }; account: { handle: string; specialty: string }; branding: SnapshotBranding; kpis: Record<ReportKpiId, KpiEntry>; follower_trend: FollowerTrendPoint[]; content_breakdown: ContentBreakdown; top_posts: SnapshotTopPost[]; audience: AudienceData | null; best_times: BestTimeSlot[]; tags_performance: TagPerformance[] }`
  - `interface SnapshotBranding { workspace_name: string; logo_url: string | null; splash_url: string | null; accent_color: string }`
  - `interface SnapshotTopPost { type: 'reel' | 'carousel' | 'image'; reach: number; likes: number; comments: number; saves: number; caption_preview: string; date: string | null; permalink: string | null; thumbnail_url: string | null }`
  - `assembleSnapshot(input: SnapshotInput): ReportDocSnapshot` (puro)
  - `buildDefaultLayout(opts: { hasAi: boolean; hasAudience: boolean; hasBestTimes: boolean; hasTags: boolean; makeId?: () => string }): ReportLayout`
  - `textDoc(paragraphs: string[]): unknown` · `aiSummaryDoc(ai: AIOutput): unknown` · `aiRecommendationsDoc(ai: AIOutput): unknown` · `aiGoalsDoc(ai: AIOutput): unknown` · `fallbackSummaryParagraphs(kpis: Record<ReportKpiId, KpiEntry>, monthLabel: string): string[]`
  - `fillAiBlocks(layout: ReportLayout, docs: { summary: unknown; recommendations: unknown | null; goals: unknown | null }): ReportLayout` — preenche `text` dos blocos `ai_*`; quando `recommendations`/`goals` é null, REMOVE esses blocos do layout.

- [ ] **Step 1: Escrever os testes**

```ts
// supabase/functions/_shared/report-docs/default-layout.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildDefaultLayout } from "./default-layout.ts";
import { validateLayout } from "./layout.ts";

const seqId = () => { let n = 0; return () => `b${++n}`; };

Deno.test("layout padrão completo passa no validador e começa com capa", () => {
  const l = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, makeId: seqId() });
  assert(validateLayout(l).ok);
  assertEquals(l.blocks[0].type, "cover");
  assertEquals(l.blocks[1].type, "ai_summary");
  const types = l.blocks.map((b) => b.type);
  assert(types.includes("top_posts"));
  assert(types.includes("audience_gender"));
  assert(types.includes("ai_recommendations"));
});

Deno.test("sem audiência/horários/tags/IA os blocos correspondentes somem", () => {
  const l = buildDefaultLayout({ hasAi: false, hasAudience: false, hasBestTimes: false, hasTags: false, makeId: seqId() });
  const types = l.blocks.map((b) => b.type);
  assert(!types.includes("audience_gender"));
  assert(!types.includes("chart_best_times"));
  assert(!types.includes("tags_table"));
  assert(!types.includes("ai_recommendations"));
  assert(!types.includes("ai_goals"));
  assert(types.includes("ai_summary")); // sempre presente: recebe fallback
  assert(validateLayout(l).ok);
});

Deno.test("ids são únicos", () => {
  const l = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, makeId: seqId() });
  assertEquals(new Set(l.blocks.map((b) => b.id)).size, l.blocks.length);
});
```

```ts
// supabase/functions/_shared/report-docs/tiptap-doc.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { aiRecommendationsDoc, fallbackSummaryParagraphs, fillAiBlocks, textDoc } from "./tiptap-doc.ts";
import { buildDefaultLayout } from "./default-layout.ts";
import type { AIOutput } from "../report-template/types.ts";

const ai: AIOutput = {
  executive_summary: "Resumo do mês.",
  detailed_analysis: "x".repeat(200),
  recommendations: [
    { title: "Postar mais reels", description: "Reels lideram alcance.", priority: "high" },
  ],
  suggested_goals: [{ metric: "alcance", target: "+10%", rationale: "tendência" }],
};

Deno.test("textDoc gera doc TipTap com um paragraph por string", () => {
  const doc = textDoc(["a", "b"]) as { type: string; content: unknown[] };
  assertEquals(doc.type, "doc");
  assertEquals(doc.content.length, 2);
});

Deno.test("aiRecommendationsDoc: heading + paragraph por recomendação", () => {
  const doc = aiRecommendationsDoc(ai) as { content: { type: string }[] };
  assertEquals(doc.content[0].type, "heading");
  assertEquals(doc.content[1].type, "paragraph");
});

Deno.test("fallbackSummaryParagraphs cita o mês e não inventa base ausente", () => {
  const paras = fallbackSummaryParagraphs({
    followers_gained: { value: 10, unit: "count", prev: null },
    followers_total: { value: null, unit: "count", prev: null },
    reach: { value: 1000, unit: "count", prev: null },
    engagement_rate: { value: 3.2, unit: "pct", prev: null },
    saves: { value: 5, unit: "count", prev: null },
    posts_count: { value: 8, unit: "count", prev: null },
    profile_views: { value: null, unit: "count", prev: null },
    website_clicks: { value: null, unit: "count", prev: null },
  }, "Julho de 2026");
  assert(paras.length >= 1);
  assert(paras[0].includes("Julho de 2026"));
  assert(!paras.join(" ").includes("null"));
});

Deno.test("fillAiBlocks preenche text e remove blocos de IA sem conteúdo", () => {
  let n = 0;
  const layout = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, makeId: () => `b${++n}` });
  const filled = fillAiBlocks(layout, { summary: textDoc(["s"]), recommendations: null, goals: null });
  const types = filled.blocks.map((b) => b.type);
  assert(!types.includes("ai_recommendations"));
  assert(!types.includes("ai_goals"));
  const summary = filled.blocks.find((b) => b.type === "ai_summary");
  assert(summary?.text !== undefined);
});
```

```ts
// supabase/functions/_shared/report-docs/snapshot.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { assembleSnapshot } from "./snapshot.ts";

Deno.test("assembleSnapshot monta o documento congelado", () => {
  const snap = assembleSnapshot({
    month: "2026-07",
    account: { handle: "dra.exemplo", specialty: "Dermatologia · São Paulo" },
    branding: { workspace_name: "DK", logo_url: null, splash_url: null, accent_color: "#123456" },
    kpiSources: {
      allPosts: [{ reach: 100, likes: 10, comments: 1, saved: 2, shares: 0 }],
      prevMonthPosts: [],
      currSnapshot: null, prevSnapshot: null, prevPrevSnapshot: null,
      followerHistory: [{ follower_count: 900 }],
      liveFollowerCount: 950,
    },
    followerTrend: [{ date: "2026-07-01", count: 900 }],
    posts: [{
      media_type: "REEL", reach: 100, likes: 10, comments: 1, saved: 2,
      caption: "Legenda grande demais".repeat(20), posted_at: "2026-07-10T12:00:00Z",
      permalink: "https://instagram.com/p/x", thumbnail_url: "https://cdninstagram.com/x.jpg",
    }],
    stableThumbnails: new Map(),
    audience: null,
    bestTimes: [],
    tagsPerformance: [],
  });
  assertEquals(snap.version, 1);
  assertEquals(snap.period.month, "2026-07");
  assertEquals(snap.period.label, "Julho de 2026");
  assertEquals(snap.kpis.reach.value, 100);
  assertEquals(snap.top_posts.length, 1);
  assertEquals(snap.top_posts[0].type, "reel");
  // URL efêmera do CDN NUNCA entra no snapshot (spec §5).
  assertEquals(snap.top_posts[0].thumbnail_url, null);
  assert(snap.top_posts[0].caption_preview.length <= 140);
  assertEquals(snap.content_breakdown.reels?.count, 1);
});

Deno.test("thumbnail estável (mapa) entra; carousel e image mapeiam certo", () => {
  const snap = assembleSnapshot({
    month: "2026-07",
    account: { handle: "h", specialty: "" },
    branding: { workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000" },
    kpiSources: {
      allPosts: [], prevMonthPosts: null, currSnapshot: null, prevSnapshot: null,
      prevPrevSnapshot: null, followerHistory: [], liveFollowerCount: null,
    },
    followerTrend: [],
    posts: [
      { media_type: "CAROUSEL_ALBUM", reach: 5, likes: 0, comments: 0, saved: 0, caption: "a", posted_at: null, permalink: null, thumbnail_url: "https://cdninstagram.com/a.jpg" },
      { media_type: "IMAGE", reach: 3, likes: 0, comments: 0, saved: 0, caption: "b", posted_at: null, permalink: null, thumbnail_url: "https://supabase.co/storage/v1/object/public/instagram-posts/1/b.jpg" },
    ],
    stableThumbnails: new Map([["https://cdninstagram.com/a.jpg", "https://supabase.co/storage/cached-a.jpg"]]),
    audience: null, bestTimes: [], tagsPerformance: [],
  });
  assertEquals(snap.top_posts[0].type, "carousel");
  assertEquals(snap.top_posts[0].thumbnail_url, "https://supabase.co/storage/cached-a.jpg");
  assertEquals(snap.top_posts[1].type, "image");
  // Já estável (não é host do IG): passa direto.
  assert(snap.top_posts[1].thumbnail_url!.includes("instagram-posts/1/b.jpg"));
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run test:functions -- --filter "assembleSnapshot"
```

Esperado: FAIL (módulos não existem).

- [ ] **Step 3: Implementar `snapshot.ts`**

```ts
// supabase/functions/_shared/report-docs/snapshot.ts
// Montagem PURA do data_snapshot: recebe resultados de query já buscados,
// devolve o documento congelado. Toda entrada suja (rows any do PostgREST) é
// normalizada aqui. Ordenação dos top posts: reach desc.
import type {
  AudienceData, BestTimeSlot, ContentBreakdown, FollowerTrendPoint, TagPerformance,
} from "../report-template/types.ts";
import { isEphemeralInstagramUrl } from "../instagram-thumbnail-cache.ts";
import { computeKpis, type KpiEntry, type KpiSources, type ReportKpiId } from "./kpis.ts";
import { monthWindow } from "./month-window.ts";

export interface SnapshotBranding {
  workspace_name: string;
  logo_url: string | null;
  splash_url: string | null;
  accent_color: string;
}

export interface SnapshotTopPost {
  type: "reel" | "carousel" | "image";
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  caption_preview: string;
  date: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
}

export interface ReportDocSnapshot {
  version: 1;
  period: { month: string; label: string; start: string; endExclusive: string };
  account: { handle: string; specialty: string };
  branding: SnapshotBranding;
  kpis: Record<ReportKpiId, KpiEntry>;
  follower_trend: FollowerTrendPoint[];
  content_breakdown: ContentBreakdown;
  top_posts: SnapshotTopPost[];
  audience: AudienceData | null;
  best_times: BestTimeSlot[];
  tags_performance: TagPerformance[];
}

export interface SnapshotPostRow {
  media_type: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  caption: string | null;
  posted_at: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
}

export interface SnapshotInput {
  month: string;
  account: { handle: string; specialty: string };
  branding: SnapshotBranding;
  kpiSources: KpiSources;
  followerTrend: FollowerTrendPoint[];
  /** Todos os posts do mês, qualquer ordem. */
  posts: SnapshotPostRow[];
  /** URL original -> URL estável cacheada (resultado de cachePostThumbnail). */
  stableThumbnails: Map<string, string>;
  audience: AudienceData | null;
  bestTimes: BestTimeSlot[];
  tagsPerformance: TagPerformance[];
}

export const MAX_SNAPSHOT_POSTS = 12;
const CAPTION_PREVIEW_MAX = 140;

// Mesmo mapeamento do gerador v2 (index.ts §7 typeMapping): REEL/VIDEO viram
// reels, CAROUSEL_ALBUM carousels, resto images. Confirme contra
// instagram-report-generator-v2/index.ts:828-861 antes de alterar.
function postType(mediaType: string | null): SnapshotTopPost["type"] {
  if (mediaType === "REEL" || mediaType === "VIDEO") return "reel";
  if (mediaType === "CAROUSEL_ALBUM") return "carousel";
  return "image";
}

function stableThumb(
  url: string | null,
  stable: Map<string, string>,
): string | null {
  if (!url) return null;
  const cached = stable.get(url);
  if (cached && !isEphemeralInstagramUrl(cached)) return cached;
  // A regra da spec §5: URL efêmera do CDN nunca congela no snapshot.
  return isEphemeralInstagramUrl(url) ? null : url;
}

export function assembleSnapshot(input: SnapshotInput): ReportDocSnapshot {
  const w = monthWindow(input.month);

  const breakdown: ContentBreakdown = {};
  for (const p of input.posts) {
    const key = postType(p.media_type) === "reel"
      ? "reels"
      : postType(p.media_type) === "carousel"
      ? "carousels"
      : "images";
    const bucket = breakdown[key] ?? { count: 0, avg_reach: 0, avg_engagement: 0 };
    // avg_* acumulam somas aqui e viram médias no fim.
    bucket.count += 1;
    bucket.avg_reach += p.reach ?? 0;
    bucket.avg_engagement += (p.likes ?? 0) + (p.comments ?? 0) + (p.saved ?? 0);
    breakdown[key] = bucket;
  }
  for (const key of ["reels", "carousels", "images"] as const) {
    const b = breakdown[key];
    if (b && b.count > 0) {
      b.avg_reach = Math.round(b.avg_reach / b.count);
      b.avg_engagement = Math.round(b.avg_engagement / b.count);
    }
  }

  const topPosts = [...input.posts]
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))
    .slice(0, MAX_SNAPSHOT_POSTS)
    .map((p): SnapshotTopPost => ({
      type: postType(p.media_type),
      reach: p.reach ?? 0,
      likes: p.likes ?? 0,
      comments: p.comments ?? 0,
      saves: p.saved ?? 0,
      caption_preview: (p.caption ?? "").slice(0, CAPTION_PREVIEW_MAX),
      date: p.posted_at,
      permalink: p.permalink,
      thumbnail_url: stableThumb(p.thumbnail_url, input.stableThumbnails),
    }));

  return {
    version: 1,
    period: { month: w.month, label: w.label, start: w.start, endExclusive: w.endExclusive },
    account: input.account,
    branding: input.branding,
    kpis: computeKpis(input.kpiSources),
    follower_trend: input.followerTrend,
    content_breakdown: breakdown,
    top_posts: topPosts,
    audience: input.audience,
    best_times: input.bestTimes,
    tags_performance: input.tagsPerformance,
  };
}
```

- [ ] **Step 4: Implementar `default-layout.ts`**

```ts
// supabase/functions/_shared/report-docs/default-layout.ts
// Layout padrão do sistema: reproduz a ordem do relatório A4 atual (spec §7).
// Quem não editar nada recebe um relatório equivalente ao de hoje.
import type { BlockSize, BlockType, ReportBlock, ReportLayout } from "./layout.ts";
import { LAYOUT_VERSION } from "./layout.ts";

export interface DefaultLayoutOpts {
  hasAi: boolean;
  hasAudience: boolean;
  hasBestTimes: boolean;
  hasTags: boolean;
  makeId?: () => string;
}

export function buildDefaultLayout(opts: DefaultLayoutOpts): ReportLayout {
  const makeId = opts.makeId ?? (() => crypto.randomUUID());
  const blocks: ReportBlock[] = [];
  const add = (type: BlockType, size: BlockSize, config?: Record<string, unknown>) =>
    blocks.push(config ? { id: makeId(), type, size, config } : { id: makeId(), type, size });

  add("cover", "full");
  add("ai_summary", "full");

  add("section_header", "full", { title: "Métricas principais" });
  add("kpi_followers_gained", "third");
  add("kpi_followers_total", "third");
  add("kpi_engagement_rate", "third");
  add("kpi_reach", "third");
  add("kpi_saves", "third");
  add("kpi_posts_count", "third");

  add("section_header", "full", { title: "Crescimento e formatos" });
  add("chart_followers", "full");
  add("chart_formats", "full");
  add("kpi_profile_views", "half");
  add("kpi_website_clicks", "half");

  add("section_header", "full", { title: "Publicações" });
  add("top_posts", "full", { count: 6 });
  if (opts.hasTags) add("tags_table", "full");

  if (opts.hasAudience) {
    add("section_header", "full", { title: "Audiência" });
    add("audience_gender", "half");
    add("audience_age", "half");
    add("audience_cities", "half");
    add("audience_countries", "half");
  }
  if (opts.hasBestTimes) add("chart_best_times", "full");

  if (opts.hasAi) {
    add("section_header", "full", { title: "Próximos passos" });
    add("ai_recommendations", "full");
    add("ai_goals", "full");
  }

  return { version: LAYOUT_VERSION, blocks };
}
```

- [ ] **Step 5: Implementar `tiptap-doc.ts`**

```ts
// supabase/functions/_shared/report-docs/tiptap-doc.ts
// Construtores de JSON TipTap para os blocos de texto. Só nós (paragraph,
// heading, text com marks) que o renderer do pacote (tiptapToHtml) e o editor
// StarterKit do PR 2 entendem.
import type { AIOutput } from "../report-template/types.ts";
import type { ReportLayout } from "./layout.ts";
import type { KpiEntry, ReportKpiId } from "./kpis.ts";

const p = (text: string) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const h3 = (text: string) => ({
  type: "heading",
  attrs: { level: 3 },
  content: [{ type: "text", text }],
});

export function textDoc(paragraphs: string[]): unknown {
  return { type: "doc", content: paragraphs.map(p) };
}

export function aiSummaryDoc(ai: AIOutput): unknown {
  return textDoc([ai.executive_summary]);
}

export function aiRecommendationsDoc(ai: AIOutput): unknown {
  const content: unknown[] = [];
  for (const rec of ai.recommendations) {
    content.push(h3(rec.title));
    content.push(p(rec.description));
  }
  return { type: "doc", content };
}

export function aiGoalsDoc(ai: AIOutput): unknown {
  const content: unknown[] = [];
  for (const goal of ai.suggested_goals) {
    content.push(h3(`${goal.metric}: ${goal.target}`));
    content.push(p(goal.rationale));
  }
  return { type: "doc", content };
}

const fmt = new Intl.NumberFormat("pt-BR");

export function fallbackSummaryParagraphs(
  kpis: Record<ReportKpiId, KpiEntry>,
  monthLabel: string,
): string[] {
  const parts: string[] = [];
  if (kpis.posts_count.value !== null) {
    parts.push(`${fmt.format(kpis.posts_count.value)} publicações no período`);
  }
  if (kpis.reach.value !== null) {
    parts.push(`alcance total de ${fmt.format(kpis.reach.value)} contas`);
  }
  if (kpis.followers_gained.value !== null) {
    const g = kpis.followers_gained.value;
    parts.push(g >= 0 ? `${fmt.format(g)} novos seguidores` : `${fmt.format(g)} seguidores no saldo do mês`);
  }
  if (kpis.engagement_rate.value !== null) {
    parts.push(`taxa de engajamento de ${kpis.engagement_rate.value.toFixed(1).replace(".", ",")}%`);
  }
  const body = parts.length > 0 ? `: ${parts.join(", ")}.` : ".";
  return [`Resumo de ${monthLabel}${body}`];
}

export interface AiBlockDocs {
  summary: unknown;
  recommendations: unknown | null;
  goals: unknown | null;
}

/** Preenche o text dos blocos ai_*; blocos de IA sem conteúdo são removidos. */
export function fillAiBlocks(layout: ReportLayout, docs: AiBlockDocs): ReportLayout {
  const blocks = layout.blocks
    .filter((b) => {
      if (b.type === "ai_recommendations" && docs.recommendations === null) return false;
      if (b.type === "ai_goals" && docs.goals === null) return false;
      return true;
    })
    .map((b) => {
      if (b.type === "ai_summary") return { ...b, text: docs.summary };
      if (b.type === "ai_recommendations") return { ...b, text: docs.recommendations! };
      if (b.type === "ai_goals") return { ...b, text: docs.goals! };
      return b;
    });
  return { ...layout, blocks };
}
```

- [ ] **Step 6: Rodar e ver passar; commit**

```bash
npm run test:functions -- --filter "assembleSnapshot"
npm run test:functions -- --filter "layout padrão"
npm run test:functions -- --filter "fillAiBlocks"
git checkout -- deno.lock
git add supabase/functions/_shared/report-docs/
git commit -m "feat(relatorios): snapshot puro, layout padrão e documentos TipTap"
```

---

### Task 5: Edge function `report-docs` (auth + ownership + POST /generate)

**Files:**
- Create: `supabase/functions/report-docs/index.ts`
- Create: `supabase/functions/report-docs/generate.ts`
- Create: `supabase/functions/report-docs/generate.test.ts`
- Create: `supabase/functions/_shared/report-docs/ai-input.ts`
- Create: `supabase/functions/_shared/report-docs/ai-input.test.ts`

**Interfaces:**
- Consumes: Tasks 2-4 (`validateLayout`, `monthWindow`, `prevMonthOf`, `assembleSnapshot`, `buildDefaultLayout`, `fillAiBlocks`, `aiSummaryDoc`, `aiRecommendationsDoc`, `aiGoalsDoc`, `fallbackSummaryParagraphs`, `textDoc`); existentes: `buildCorsHeaders`, `createJsonResponder`/`internalServerError`, `checkRateLimit`, `effectivePlanFeature`, `generateAINarrative` (`_shared/report-template/ai.ts`), `mapAudience`/`mapBestTimes` (`instagram-report-generator-v2/mappers.ts`), `cachePostThumbnail`/`isEphemeralInstagramUrl` (`_shared/instagram-thumbnail-cache.ts`).
- Produces: rota `POST {SUPABASE_URL}/functions/v1/report-docs/generate` com body `{ clientId: number, month: "YYYY-MM" }`, resposta `{ id: string }` (201) — consumida pela Task 9. Erros: 401 sem token; 404 `{ error: "not_found" }` p/ cliente de outro workspace ou sem conta IG; 400 mês inválido/futuro; 403 `{ error: "feature_disabled" }`; 429 rate limit.

- [ ] **Step 1: Escrever `ai-input.ts` com teste (adapter snapshot -> ReportData)**

O prompt do Gemini espera o shape `ReportData` (`_shared/report-template/types.ts:61-74`); o adapter traduz o snapshot para ele.

```ts
// supabase/functions/_shared/report-docs/ai-input.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { snapshotToReportData } from "./ai-input.ts";
import type { ReportDocSnapshot } from "./snapshot.ts";

const snap: ReportDocSnapshot = {
  version: 1,
  period: { month: "2026-07", label: "Julho de 2026", start: "2026-07-01T00:00:00.000Z", endExclusive: "2026-08-01T00:00:00.000Z" },
  account: { handle: "dra.x", specialty: "Dermato" },
  branding: { workspace_name: "DK", logo_url: null, splash_url: null, accent_color: "#000" },
  kpis: {
    followers_gained: { value: 10, unit: "count", prev: 5 },
    followers_total: { value: 1000, unit: "count", prev: null },
    reach: { value: 500, unit: "count", prev: null },
    engagement_rate: { value: 4.2, unit: "pct", prev: null },
    saves: { value: 3, unit: "count", prev: null },
    posts_count: { value: 7, unit: "count", prev: null },
    profile_views: { value: null, unit: "count", prev: null },
    website_clicks: { value: null, unit: "count", prev: null },
  },
  follower_trend: [{ date: "2026-07-01", count: 990 }],
  content_breakdown: { reels: { count: 3, avg_reach: 100, avg_engagement: 10 } },
  top_posts: [{ type: "reel", reach: 100, likes: 5, comments: 1, saves: 2, caption_preview: "c", date: null, permalink: null, thumbnail_url: "https://x/y.jpg" }],
  audience: null,
  best_times: [],
  tags_performance: [],
};

Deno.test("snapshotToReportData traduz período, kpis e posts sem thumbnails", () => {
  const rd = snapshotToReportData(snap);
  assertEquals(rd.report_month, "2026-07");
  assertEquals(rd.handle, "dra.x");
  assertEquals(rd.kpis.followers_gained.value, 10);
  assertEquals(rd.kpis.followers_gained.prev, 5);
  // KPI sem valor (null) fica de fora do prompt em vez de virar 0 falso.
  assert(!("profile_views" in rd.kpis));
  assertEquals(rd.top_posts[0].engagement, 8); // likes+comments+saves
  assert(!("thumbnail_base64" in rd.top_posts[0]));
});
```

```ts
// supabase/functions/_shared/report-docs/ai-input.ts
// Adapter snapshot -> ReportData, o shape que buildAIPrompt já valida e usa.
// KPIs null ficam FORA (o prompt proíbe inventar números; 0 falso seria pior).
import type { KpiValue, ReportData } from "../report-template/types.ts";
import type { ReportDocSnapshot } from "./snapshot.ts";

export function snapshotToReportData(snap: ReportDocSnapshot): ReportData {
  const kpis: Record<string, KpiValue> = {};
  for (const [id, entry] of Object.entries(snap.kpis)) {
    if (entry.value === null) continue;
    kpis[id] = { id, value: entry.value, unit: entry.unit, prev: entry.prev };
  }
  return {
    handle: snap.account.handle,
    specialty: snap.account.specialty,
    period: snap.period.label,
    report_month: snap.period.month,
    kpis,
    kpi_deltas: {},
    top_posts: snap.top_posts.map((post) => ({
      type: post.type,
      reach: post.reach,
      engagement: post.likes + post.comments + post.saves,
      saves: post.saves,
      likes: post.likes,
      comments: post.comments,
      caption_preview: post.caption_preview,
      date: post.date ?? undefined,
      permalink: post.permalink ?? undefined,
    })),
    content_breakdown: snap.content_breakdown,
    audience: snap.audience,
    best_times: snap.best_times,
    tags_performance: snap.tags_performance,
    follower_trend: snap.follower_trend,
  };
}
```

Rode `npm run test:functions -- --filter "snapshotToReportData"` (FAIL antes, PASS depois).

- [ ] **Step 2: Escrever `generate.ts` (núcleo com DI, testável) e o teste**

Antes de escrever, ABRA e confirme dois pontos no código real (não confie neste plano):
1. `supabase/functions/instagram-analytics/index.ts:913-974` — como a rota `/generate-report/:clientId` resolve o `instagram_account_id` a partir do `clientId` (nome exato das colunas/filtros de `instagram_accounts`). Replique o mesmo lookup.
2. `supabase/functions/instagram-integration/index.ts:470-500` — os nomes de campo usados com `cachePostThumbnail` (id do post e URLs). As linhas de `instagram_posts` têm o mesmo shape.

```ts
// supabase/functions/report-docs/generate.ts
// Núcleo da geração: recebe db (service client) e deps injetáveis, devolve o id
// do documento criado. Síncrono, sem fila: spec §5.
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { generateAINarrative } from "../_shared/report-template/ai.ts";
import { mapAudience, mapBestTimes } from "../instagram-report-generator-v2/mappers.ts";
import {
  cachePostThumbnail, isEphemeralInstagramUrl, type ThumbnailStorage,
} from "../_shared/instagram-thumbnail-cache.ts";
import { monthWindow, prevMonthOf } from "../_shared/report-docs/month-window.ts";
import {
  assembleSnapshot, MAX_SNAPSHOT_POSTS, type SnapshotPostRow,
} from "../_shared/report-docs/snapshot.ts";
import { buildDefaultLayout } from "../_shared/report-docs/default-layout.ts";
import {
  aiGoalsDoc, aiRecommendationsDoc, aiSummaryDoc, fallbackSummaryParagraphs,
  fillAiBlocks, textDoc,
} from "../_shared/report-docs/tiptap-doc.ts";
import { snapshotToReportData } from "../_shared/report-docs/ai-input.ts";
import type { TagPerformance } from "../_shared/report-template/types.ts";

export interface GenerateDeps {
  fetch: typeof fetch;
  storage: ThumbnailStorage;
  geminiKey: string;
  userId: string;
}

export class GenerateError extends Error {
  constructor(public code: "not_found" | "bad_month" | "feature_disabled", msg?: string) {
    super(msg ?? code);
  }
}

// deno-lint-ignore no-explicit-any
type Db = any;

export async function generateReportDocument(
  db: Db,
  deps: GenerateDeps,
  contaId: string,
  clientId: number,
  month: string,
): Promise<{ id: string }> {
  // Mês válido e não futuro.
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  let w;
  try {
    w = monthWindow(month);
  } catch {
    throw new GenerateError("bad_month");
  }
  if (month > currentMonth) throw new GenerateError("bad_month");

  // Ownership explícito de TODO id: service role bypassa RLS (spec §5).
  const { data: cliente } = await db.from("clientes")
    .select("id, conta_id, nome, especialidade, include_ai_analysis")
    .eq("id", clientId).maybeSingle();
  if (!cliente || cliente.conta_id !== contaId) throw new GenerateError("not_found");

  if (!(await effectivePlanFeature(db, contaId, "feature_analytics_reports"))) {
    throw new GenerateError("feature_disabled");
  }

  // Conta IG do cliente, presa ao workspace. (Confirmado contra o lookup de
  // instagram-analytics /generate-report — ver Step 2 do plano.)
  const { data: account } = await db.from("instagram_accounts")
    .select("*")
    .eq("client_id", clientId).eq("conta_id", contaId).maybeSingle();
  if (!account) throw new GenerateError("not_found", "Conta Instagram não conectada");

  const igAccountId = account.id;
  const prevW = monthWindow(prevMonthOf(month));
  const prevPrevW = monthWindow(prevMonthOf(prevMonthOf(month)));

  const lastSnapshotOfMonth = (win: typeof w) =>
    db.from("instagram_account_metrics_daily").select("*")
      .eq("instagram_account_id", igAccountId)
      .gte("snapshot_date", win.startDate).lt("snapshot_date", win.endDateExclusive)
      .order("snapshot_date", { ascending: false }).limit(1);

  const [
    postsRes, followerHistoryRes, demographicsRes, bestTimesRes, tagPerformanceRes,
    workspaceRes, prevPrevSnapRes, prevSnapRes, currSnapRes, prevMonthPostsRes,
  ] = await Promise.all([
    db.from("instagram_posts").select("*")
      .eq("instagram_account_id", igAccountId)
      .gte("posted_at", w.start).lt("posted_at", w.endExclusive)
      .order("posted_at", { ascending: false }),
    db.from("instagram_follower_history").select("date, follower_count")
      .eq("instagram_account_id", igAccountId)
      .gte("date", w.startDate).lt("date", w.endDateExclusive)
      .order("date", { ascending: true }),
    db.from("instagram_analytics_cache").select("data")
      .eq("instagram_account_id", igAccountId).eq("cache_key", "demographics").maybeSingle(),
    db.from("instagram_analytics_cache").select("data")
      .eq("instagram_account_id", igAccountId).eq("cache_key", "best_times").maybeSingle(),
    Promise.resolve(db.rpc("get_tag_performance", {
      p_instagram_account_id: igAccountId,
      p_month_start: w.start,
      p_month_end: w.endExclusive,
    })).then((r: { data: TagPerformance[] | null }) => r).catch(() => ({ data: null })),
    db.from("workspaces").select("name, logo_url, brand_color, report_splash_url")
      .eq("id", contaId).single(),
    lastSnapshotOfMonth(prevPrevW),
    lastSnapshotOfMonth(prevW),
    lastSnapshotOfMonth(w),
    db.from("instagram_posts").select("reach, saved, likes, comments, shares")
      .eq("instagram_account_id", igAccountId)
      .gte("posted_at", prevW.start).lt("posted_at", prevW.endExclusive),
  ]);

  const posts: SnapshotPostRow[] = postsRes.data ?? [];
  const ws = workspaceRes.data;

  // Thumbnails: só dos candidatos a top post; URL efêmera cacheia ou vira null.
  const byReach = [...posts].sort(
    (a, b) => ((b as { reach: number | null }).reach ?? 0) - ((a as { reach: number | null }).reach ?? 0),
  ).slice(0, MAX_SNAPSHOT_POSTS);
  const stableThumbnails = new Map<string, string>();
  for (const post of byReach) {
    const url = post.thumbnail_url;
    if (!url || !isEphemeralInstagramUrl(url)) continue;
    const cached = await cachePostThumbnail(
      { fetch: deps.fetch, storage: deps.storage },
      igAccountId,
      // Campo do id do post confirmado contra instagram-integration (Step 2).
      (post as unknown as { post_id?: string; id?: string | number }).post_id ??
        String((post as unknown as { id: string | number }).id),
      url,
      null,
    );
    if (cached && !isEphemeralInstagramUrl(cached)) stableThumbnails.set(url, cached);
  }

  const snapshot = assembleSnapshot({
    month,
    account: {
      handle: account.username ?? account.handle ?? "",
      specialty: [cliente.especialidade].filter(Boolean).join(" · "),
    },
    branding: {
      workspace_name: ws?.name ?? "Mesaas",
      logo_url: ws?.logo_url ?? null,
      splash_url: ws?.report_splash_url ?? null,
      accent_color: ws?.brand_color ?? "#171717",
    },
    kpiSources: {
      allPosts: posts,
      prevMonthPosts: prevMonthPostsRes.error ? null : (prevMonthPostsRes.data ?? []),
      currSnapshot: currSnapRes.data?.[0] ?? null,
      prevSnapshot: prevSnapRes.data?.[0] ?? null,
      prevPrevSnapshot: prevPrevSnapRes.data?.[0] ?? null,
      followerHistory: followerHistoryRes.data ?? [],
      liveFollowerCount: account.follower_count ?? null,
    },
    followerTrend: (followerHistoryRes.data ?? []).map(
      (r: { date: string; follower_count: number }) => ({ date: r.date, count: r.follower_count }),
    ),
    posts,
    stableThumbnails,
    audience: mapAudience(demographicsRes.data?.data ?? null),
    bestTimes: mapBestTimes(bestTimesRes.data?.data ?? []),
    tagsPerformance: (tagPerformanceRes.data as TagPerformance[] | null) ?? [],
  });

  // IA: nunca derruba a geração (padrão do v2, index.ts:987-1017).
  let aiContent: unknown = null;
  let summaryDoc = textDoc(fallbackSummaryParagraphs(snapshot.kpis, snapshot.period.label));
  let recsDoc: unknown | null = null;
  let goalsDoc: unknown | null = null;
  const wantsAi = cliente.include_ai_analysis !== false;
  if (wantsAi && deps.geminiKey) {
    const ai = await generateAINarrative(snapshotToReportData(snapshot), deps.geminiKey);
    if (ai.status === "success" && ai.output) {
      aiContent = ai.output;
      summaryDoc = aiSummaryDoc(ai.output);
      recsDoc = aiRecommendationsDoc(ai.output);
      goalsDoc = aiGoalsDoc(ai.output);
    } else {
      console.warn(`[report-docs] AI falhou: ${"error" in ai ? ai.error : ai.status}`);
    }
  }

  const layout = fillAiBlocks(
    buildDefaultLayout({
      hasAi: wantsAi,
      hasAudience: snapshot.audience !== null,
      hasBestTimes: snapshot.best_times.length > 0,
      hasTags: snapshot.tags_performance.length > 0,
    }),
    { summary: summaryDoc, recommendations: recsDoc, goals: goalsDoc },
  );

  const { data: inserted, error: insertError } = await db.from("report_documents")
    .insert({
      conta_id: contaId,
      client_id: clientId,
      instagram_account_id: igAccountId,
      title: `Relatório de ${w.label}`,
      period_start: w.startDate,
      period_end: w.endDateExclusive,
      layout,
      data_snapshot: snapshot,
      ai_content: aiContent,
      status: "ready",
      created_by: deps.userId,
    })
    .select("id").single();
  if (insertError || !inserted) {
    throw new Error(`insert failed: ${insertError?.message ?? "no row"}`);
  }
  return { id: inserted.id };
}
```

Teste do núcleo (fake db por chain, padrão `instagram-connect-link-gate_test.ts`):

```ts
// supabase/functions/report-docs/generate.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { GenerateError, generateReportDocument } from "./generate.ts";

// Fake db: responde por tabela; grava inserts para asserção.
function makeDb(rows: Record<string, unknown>, opts: { feature?: boolean } = {}) {
  const inserts: Record<string, unknown>[] = [];
  // deno-lint-ignore no-explicit-any
  const chain = (result: any): any => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "order", "limit"]) {
      c[m] = () => chain(result);
    }
    c.maybeSingle = () => Promise.resolve({ data: result, error: null });
    c.single = () => Promise.resolve({ data: result, error: null });
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: result, error: null }).then(resolve);
    return c;
  };
  return {
    inserts,
    from: (table: string) => {
      if (table === "report_documents") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            return chain({ id: "doc-1" });
          },
        };
      }
      return chain(rows[table] ?? null);
    },
    rpc: (name: string) =>
      name === "effective_plan_feature"
        ? Promise.resolve({ data: opts.feature ?? true, error: null })
        : Promise.resolve({ data: [], error: null }),
    // deno-lint-ignore no-explicit-any
  } as any;
}

const deps = {
  fetch: globalThis.fetch,
  // deno-lint-ignore no-explicit-any
  storage: {} as any,
  geminiKey: "",
  userId: "user-1",
};

Deno.test("cliente de outro workspace: not_found", async () => {
  const db = makeDb({ clientes: { id: 1, conta_id: "OUTRA", include_ai_analysis: true } });
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "minha-conta", 1, "2026-07");
  } catch (e) { err = e; }
  assert(err instanceof GenerateError && err.code === "not_found");
});

Deno.test("mês futuro: bad_month", async () => {
  const db = makeDb({});
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "c", 1, "2999-01");
  } catch (e) { err = e; }
  assert(err instanceof GenerateError && err.code === "bad_month");
});

Deno.test("caminho feliz sem IA insere documento ready com layout válido", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  const { id } = await generateReportDocument(db, deps, "c", 1, "2026-07");
  assertEquals(id, "doc-1");
  assertEquals(db.inserts.length, 1);
  const row = db.inserts[0] as { status: string; layout: { blocks: { type: string }[] }; data_snapshot: { version: number } };
  assertEquals(row.status, "ready");
  assertEquals(row.data_snapshot.version, 1);
  const types = row.layout.blocks.map((b) => b.type);
  assert(types.includes("cover"));
  assert(!types.includes("ai_recommendations")); // IA desligada no cliente
});
```

ATENÇÃO no fake db: o `.select("*")` de posts retorna array; o chain acima devolve o MESMO `result` para tudo — se um teste precisar de resultados diferentes por tabela+ordem, estenda `makeDb` por tabela (como já faz). O `.limit(1)` dos snapshots devolve o array `instagram_account_metrics_daily` cru; o código lê `.data?.[0]`.

- [ ] **Step 3: Rodar e ver falhar, implementar `index.ts`, rodar e ver passar**

```bash
npm run test:functions -- --filter "caminho feliz"
```

```ts
// supabase/functions/report-docs/index.ts
// API do relatório interativo de blocos. PR 1: só POST /generate.
// PR 3 adiciona /:id/pdf, /:id/refresh-data e DELETE /:id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { GenerateError, generateReportDocument } from "./generate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = createJsonResponder(corsHeaders);
  const path = new URL(req.url).pathname.replace("/report-docs", "");

  try {
    const authHeader = req.headers.get("Authorization");
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ?? "" } },
    });
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token || token === "undefined" || token === "null") {
      return json({ error: "Unauthorized" }, 401);
    }
    const userRes = await anonClient.auth.getUser();
    const user = userRes.data?.user;
    if (userRes.error || !user) return json({ error: "Unauthorized" }, 401);

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await serviceClient
      .from("profiles").select("conta_id").eq("id", user.id).single();
    const contaId = profile?.conta_id;
    if (!contaId) return json({ error: "Unauthorized" }, 401);

    if (req.method === "POST" && path === "/generate") {
      const allowed = await checkRateLimit(serviceClient, `report-docs:${contaId}`, 20, 3600);
      if (!allowed) return json({ error: "Rate limit exceeded" }, 429);

      let body: { clientId?: unknown; month?: unknown };
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid_body" }, 400);
      }
      const clientId = Number(body.clientId);
      const month = String(body.month ?? "");
      if (!Number.isInteger(clientId) || clientId <= 0) return json({ error: "invalid_body" }, 400);

      const result = await generateReportDocument(
        serviceClient,
        { fetch, storage: serviceClient.storage, geminiKey: GEMINI_API_KEY, userId: user.id },
        contaId,
        clientId,
        month,
      );
      return json(result, 201);
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  } catch (err) {
    if (err instanceof GenerateError) {
      if (err.code === "bad_month") return json({ error: "invalid_month" }, 400);
      if (err.code === "feature_disabled") return json({ error: "feature_disabled" }, 403);
      return json({ error: "not_found" }, 404);
    }
    return internalServerError(json, "report-docs", err);
  }
});
```

```bash
npm run test:functions
git checkout -- deno.lock
```

Esperado: suíte inteira PASS (as novas + as existentes — nenhuma regressão).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/report-docs/ supabase/functions/_shared/report-docs/ai-input.ts supabase/functions/_shared/report-docs/ai-input.test.ts
git commit -m "feat(relatorios): edge function report-docs com geração síncrona"
```

---

### Task 6: Pacote `@mesaas/report-blocks` — scaffold, wiring e núcleo do renderer

**Files:**
- Create: `packages/report-blocks/package.json`
- Create: `packages/report-blocks/types.ts`
- Create: `packages/report-blocks/format.ts`
- Create: `packages/report-blocks/tiptap-render.ts`
- Create: `packages/report-blocks/BlockRenderer.tsx`
- Create: `packages/report-blocks/styles.css`
- Create: `packages/report-blocks/blocks/CoverBlock.tsx`
- Create: `packages/report-blocks/blocks/SectionHeaderBlock.tsx`
- Create: `packages/report-blocks/blocks/DividerBlock.tsx`
- Create: `packages/report-blocks/blocks/TextBlock.tsx`
- Create: `packages/report-blocks/fixtures.ts`
- Create: `packages/report-blocks/__tests__/tiptap-render.test.ts`
- Create: `packages/report-blocks/__tests__/BlockRenderer.test.tsx`
- Modify: `vitest.config.ts:8-15` (alias), `apps/crm/vite.config.ts:11-19` (alias), `apps/hub/vite.config.ts:9-16` (alias), `apps/crm/tsconfig.json:4-10` (paths + flag), `apps/hub/tsconfig.json` (paths + flag)

**Interfaces:**
- Consumes: `_shared/report-docs/{layout,snapshot,kpis}.ts` (tipos), `_shared/report-template/theme.ts` (`resolveAccent` — precedente de import web em `ReportPreview.tsx:1`).
- Produces (consumido por Tasks 7-9 e pelo Hub no PR 3):
  - `BlockRenderer({ layout, snapshot, mode }: { layout: ReportLayout; snapshot: ReportDocSnapshot; mode: 'view' | 'print' })`
  - `interface BlockProps { block: ReportBlock; snapshot: ReportDocSnapshot }`
  - `BLOCK_COMPONENTS: Partial<Record<BlockType, FC<BlockProps>>>` (registro; Tasks 7-8 adicionam entradas)
  - `tiptapToHtml(doc: unknown): string`
  - `format.ts`: `fmtCount(n: number): string` (pt-BR agrupado), `fmtPct(n: number): string` ("4,2%"), `deltaPct(value: number, prev: number): number | null`
  - `fixtures.ts`: `makeSnapshotFixture(over?: Partial<ReportDocSnapshot>): ReportDocSnapshot`
  - `styles.css`: grid `.rb-grid`, spans `.rb-third/.rb-half/.rb-full`, `.rb-page-break` com `break-after: page` no print

- [ ] **Step 1: Scaffold + wiring dos 5 configs**

`packages/report-blocks/package.json` (padrão `@mesaas/i18n`):

```json
{
  "name": "@mesaas/report-blocks",
  "private": true,
  "version": "0.0.0",
  "type": "module"
}
```

Alias de DIRETÓRIO (o pacote expõe subcaminhos, padrão `@mesaas/ui`):

- `vitest.config.ts` — dentro de `resolve.alias`, após a linha do `@mesaas/ui`:
  `'@mesaas/report-blocks': path.resolve(__dirname, 'packages/report-blocks'),`
- `apps/crm/vite.config.ts` — idem: `'@mesaas/report-blocks': path.resolve(__dirname, '../../packages/report-blocks'),`
- `apps/hub/vite.config.ts` — idem (mesma linha do CRM).
- `apps/crm/tsconfig.json` — em `paths`: `"@mesaas/report-blocks/*": ["../../packages/report-blocks/*"]` e em `compilerOptions`: `"allowImportingTsExtensions": true` (necessário: os módulos `_shared/report-docs/*.ts` importam uns aos outros com extensão `.ts`, exigência do Deno; `noEmit: true` já está setado, então a flag é válida).
- `apps/hub/tsconfig.json` — as mesmas duas adições.

- [ ] **Step 2: Testes do núcleo (falham primeiro)**

```ts
// packages/report-blocks/__tests__/tiptap-render.test.ts
import { describe, expect, it } from 'vitest';
import { tiptapToHtml } from '../tiptap-render';

const doc = (content: unknown[]) => ({ type: 'doc', content });
const text = (t: string, marks?: { type: string }[]) => ({ type: 'text', text: t, marks });

describe('tiptapToHtml', () => {
  it('renderiza paragraph, heading e marks básicas', () => {
    const html = tiptapToHtml(doc([
      { type: 'heading', attrs: { level: 3 }, content: [text('Título')] },
      { type: 'paragraph', content: [text('normal '), text('forte', [{ type: 'bold' }])] },
    ]));
    expect(html).toContain('<h3>Título</h3>');
    expect(html).toContain('<strong>forte</strong>');
  });

  it('renderiza listas, blockquote, hardBreak e horizontalRule', () => {
    const html = tiptapToHtml(doc([
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [text('a')] }] },
      ]},
      { type: 'blockquote', content: [{ type: 'paragraph', content: [text('q')] }] },
      { type: 'paragraph', content: [text('x'), { type: 'hardBreak' }, text('y')] },
      { type: 'horizontalRule' },
    ]));
    expect(html).toContain('<ul><li><p>a</p></li></ul>');
    expect(html).toContain('<blockquote><p>q</p></blockquote>');
    expect(html).toContain('x<br>y');
    expect(html).toContain('<hr>');
  });

  it('SEMPRE escapa texto: nenhum HTML do usuário passa cru', () => {
    const html = tiptapToHtml(doc([{ type: 'paragraph', content: [text('<script>alert(1)</script>')] }]));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('nó desconhecido rende só os filhos; entrada inválida rende vazio', () => {
    expect(tiptapToHtml(null)).toBe('');
    expect(tiptapToHtml(doc([{ type: 'weirdNode', content: [{ type: 'paragraph', content: [text('ok')] }] }])))
      .toContain('<p>ok</p>');
  });
});
```

```tsx
// packages/report-blocks/__tests__/BlockRenderer.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout } from '../types';

const layout: ReportLayout = {
  version: 1,
  blocks: [
    { id: 'b1', type: 'cover', size: 'full' },
    { id: 'b2', type: 'section_header', size: 'full', config: { title: 'Métricas principais' } },
    { id: 'b3', type: 'text', size: 'full', text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Análise do gestor' }] }] } },
    { id: 'b4', type: 'divider', size: 'full' },
    // Tipo fora do catálogo (futuro): ignorado em view/print, nunca quebra.
    { id: 'b5', type: 'unknown_widget' as never, size: 'full' },
  ],
};

describe('BlockRenderer', () => {
  it('renderiza capa, cabeçalho de seção e texto a partir do snapshot', () => {
    render(<BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('DK Marketing')).toBeInTheDocument();       // branding.workspace_name
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument();      // period.label
    expect(screen.getByText('Métricas principais')).toBeInTheDocument();
    expect(screen.getByText('Análise do gestor')).toBeInTheDocument();
  });

  it('bloco desconhecido não renderiza nada e não explode', () => {
    const { container } = render(
      <BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    expect(container.querySelectorAll('[data-block-id]').length).toBe(4); // b5 fora
  });

  it('aplica o accent resolvido como CSS var no root', () => {
    const { container } = render(
      <BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    const root = container.querySelector('.rb-grid') as HTMLElement;
    expect(root.style.getPropertyValue('--rb-accent')).not.toBe('');
  });
});
```

Rode `npx vitest run packages/report-blocks` — FAIL (módulos não existem).

- [ ] **Step 3: Implementar núcleo**

```ts
// packages/report-blocks/types.ts
// Reexporta os tipos da fonte da verdade (_shared, TS puro). Import relativo
// cru é o precedente da casa: ReportPreview.tsx:1.
export type {
  BlockSize, BlockType, ReportBlock, ReportLayout,
} from '../../supabase/functions/_shared/report-docs/layout';
export { BLOCK_TYPES, TEXT_BLOCK_TYPES } from '../../supabase/functions/_shared/report-docs/layout';
export type {
  ReportDocSnapshot, SnapshotBranding, SnapshotTopPost,
} from '../../supabase/functions/_shared/report-docs/snapshot';
export type { KpiEntry, ReportKpiId } from '../../supabase/functions/_shared/report-docs/kpis';
```

```ts
// packages/report-blocks/format.ts
const countFmt = new Intl.NumberFormat('pt-BR');

export function fmtCount(n: number): string {
  return countFmt.format(Math.round(n));
}

export function fmtPct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

/** Delta percentual value vs prev; null quando não computável (prev <= 0). */
export function deltaPct(value: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return ((value - prev) / prev) * 100;
}
```

```ts
// packages/report-blocks/tiptap-render.ts
// Renderer read-only de JSON TipTap (nós do StarterKit). Todo texto passa por
// escape — o HTML resultante é seguro para dangerouslySetInnerHTML porque só
// emitimos tags da allowlist abaixo e texto escapado.
interface Node {
  type?: string;
  text?: string;
  attrs?: { level?: number };
  marks?: { type: string }[];
  content?: Node[];
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderText(node: Node): string {
  let html = esc(node.text ?? '');
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') html = `<strong>${html}</strong>`;
    else if (mark.type === 'italic') html = `<em>${html}</em>`;
    else if (mark.type === 'strike') html = `<s>${html}</s>`;
    // Marks desconhecidas (link etc.): texto puro, sem a mark.
  }
  return html;
}

function children(node: Node): string {
  return (node.content ?? []).map(renderNode).join('');
}

function renderNode(node: Node): string {
  switch (node.type) {
    case 'text': return renderText(node);
    case 'paragraph': return `<p>${children(node)}</p>`;
    case 'heading': {
      const level = Math.min(Math.max(node.attrs?.level ?? 2, 1), 4);
      return `<h${level}>${children(node)}</h${level}>`;
    }
    case 'bulletList': return `<ul>${children(node)}</ul>`;
    case 'orderedList': return `<ol>${children(node)}</ol>`;
    case 'listItem': return `<li>${children(node)}</li>`;
    case 'blockquote': return `<blockquote>${children(node)}</blockquote>`;
    case 'hardBreak': return '<br>';
    case 'horizontalRule': return '<hr>';
    default: return children(node); // nó desconhecido: só os filhos
  }
}

export function tiptapToHtml(doc: unknown): string {
  if (typeof doc !== 'object' || doc === null) return '';
  const root = doc as Node;
  if (root.type !== 'doc') return '';
  return children(root);
}
```

```css
/* packages/report-blocks/styles.css */
/* Grid do documento de blocos. Importado pelo consumidor (CRM Task 9; Hub no PR 3). */
.rb-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 1rem;
  max-width: 880px;
  margin: 0 auto;
}
.rb-third { grid-column: span 2; }
.rb-half { grid-column: span 3; }
.rb-full { grid-column: span 6; }
@media (max-width: 720px) {
  .rb-third, .rb-half { grid-column: span 6; }
}
.rb-prose p { margin: 0 0 0.6em; line-height: 1.6; }
.rb-prose h1, .rb-prose h2, .rb-prose h3, .rb-prose h4 { margin: 0.8em 0 0.3em; }
.rb-prose ul, .rb-prose ol { padding-left: 1.2em; margin: 0 0 0.6em; }
@media print {
  .rb-page-break { break-after: page; }
  .rb-grid { max-width: none; }
}
```

```tsx
// packages/report-blocks/BlockRenderer.tsx
// Renderer do documento de blocos: layout + snapshot -> grid. Widget de tipo
// desconhecido ou sem dados rende null (spec §4/§7). Nada de '@/' aqui: este
// pacote é compartilhado CRM+Hub (bug documentado em packages/ui/index.ts).
import type { FC } from 'react';
import type { BlockType, ReportBlock, ReportDocSnapshot, ReportLayout } from './types';
import { resolveAccent } from '../../supabase/functions/_shared/report-template/theme';
import { CoverBlock } from './blocks/CoverBlock';
import { SectionHeaderBlock } from './blocks/SectionHeaderBlock';
import { DividerBlock } from './blocks/DividerBlock';
import { TextBlock } from './blocks/TextBlock';

export interface BlockProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
}

export const BLOCK_COMPONENTS: Partial<Record<BlockType, FC<BlockProps>>> = {
  cover: CoverBlock,
  section_header: SectionHeaderBlock,
  divider: DividerBlock,
  text: TextBlock,
  ai_summary: TextBlock,
  ai_recommendations: TextBlock,
  ai_goals: TextBlock,
  // Tasks 7-8 registram os demais widgets aqui.
};

const SIZE_CLASS = { third: 'rb-third', half: 'rb-half', full: 'rb-full' } as const;

export interface BlockRendererProps {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
  mode: 'view' | 'print';
}

export function BlockRenderer({ layout, snapshot, mode }: BlockRendererProps) {
  const { acc } = resolveAccent(snapshot.branding.accent_color);
  return (
    <div
      className={`rb-grid rb-mode-${mode}`}
      style={{ ['--rb-accent' as string]: acc }}
    >
      {layout.blocks.map((block) => {
        const Component = BLOCK_COMPONENTS[block.type];
        if (!Component) return null;
        const node = <Component block={block} snapshot={snapshot} />;
        if (node === null) return null;
        return (
          <div
            key={block.id}
            data-block-id={block.id}
            className={SIZE_CLASS[block.size] ?? 'rb-full'}
          >
            {node}
          </div>
        );
      })}
    </div>
  );
}
```

Nota: com componentes de função, `<Component />` nunca é `null` como elemento — o "rende null" acontece DENTRO do componente. O contrato dos widgets (Tasks 7-8): componente retorna `null` quando não há dado; o wrapper `data-block-id` existe mesmo assim, exceto para tipos fora do registro. O teste `b5 fora` cobre o caso do registro.

```tsx
// packages/report-blocks/blocks/CoverBlock.tsx
import type { BlockProps } from '../BlockRenderer';

export function CoverBlock({ snapshot }: BlockProps) {
  const b = snapshot.branding;
  return (
    <header
      className="rb-cover"
      style={{
        background: 'var(--rb-accent)',
        color: '#fff',
        borderRadius: 12,
        padding: '2.5rem 2rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {b.logo_url ? (
          <img src={b.logo_url} alt="" style={{ height: 36, borderRadius: 8, background: '#fff', padding: 4 }} />
        ) : null}
        <span style={{ fontWeight: 600 }}>{b.workspace_name}</span>
      </div>
      <p style={{ margin: '2rem 0 0', opacity: 0.85, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Relatório mensal · Instagram
      </p>
      <h1 style={{ margin: '0.25rem 0 0', fontSize: '2rem' }}>{snapshot.period.label}</h1>
      <p style={{ margin: '0.25rem 0 0', opacity: 0.9 }}>
        @{snapshot.account.handle}
        {snapshot.account.specialty ? ` · ${snapshot.account.specialty}` : ''}
      </p>
      {b.splash_url ? (
        <img
          src={b.splash_url}
          alt=""
          style={{ marginTop: '1.5rem', width: '100%', aspectRatio: '21 / 9', objectFit: 'cover', borderRadius: 8 }}
        />
      ) : null}
    </header>
  );
}
```

```tsx
// packages/report-blocks/blocks/SectionHeaderBlock.tsx
import type { BlockProps } from '../BlockRenderer';

export function SectionHeaderBlock({ block }: BlockProps) {
  const title = typeof block.config?.title === 'string' ? block.config.title : '';
  const subtitle = typeof block.config?.subtitle === 'string' ? block.config.subtitle : '';
  if (!title) return null;
  return (
    <div style={{ marginTop: '1rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{title}</h2>
      {subtitle ? <p style={{ margin: '0.15rem 0 0', opacity: 0.7, fontSize: '0.85rem' }}>{subtitle}</p> : null}
      <div style={{ width: 48, height: 3, background: 'var(--rb-accent)', borderRadius: 2, marginTop: '0.4rem' }} />
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/DividerBlock.tsx
import type { BlockProps } from '../BlockRenderer';

export function DividerBlock(_props: BlockProps) {
  return <hr className="rb-page-break" style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '0.5rem 0' }} />;
}
```

```tsx
// packages/report-blocks/blocks/TextBlock.tsx
import type { BlockProps } from '../BlockRenderer';
import { tiptapToHtml } from '../tiptap-render';

export function TextBlock({ block }: BlockProps) {
  const html = tiptapToHtml(block.text);
  if (!html) return null;
  // Seguro: tiptapToHtml só emite tags da allowlist com texto escapado.
  return <div className="rb-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
```

```ts
// packages/report-blocks/fixtures.ts
// Fixture de snapshot para testes e para o drawer do editor (PR 2).
import type { ReportDocSnapshot } from './types';

export function makeSnapshotFixture(over: Partial<ReportDocSnapshot> = {}): ReportDocSnapshot {
  return {
    version: 1,
    period: { month: '2026-07', label: 'Julho de 2026', start: '2026-07-01T00:00:00.000Z', endExclusive: '2026-08-01T00:00:00.000Z' },
    account: { handle: 'dra.exemplo', specialty: 'Dermatologia · São Paulo' },
    branding: { workspace_name: 'DK Marketing', logo_url: null, splash_url: null, accent_color: '#7c3aed' },
    kpis: {
      followers_gained: { value: 132, unit: 'count', prev: 98 },
      followers_total: { value: 12450, unit: 'count', prev: 12318 },
      reach: { value: 45200, unit: 'count', prev: 39800 },
      engagement_rate: { value: 4.7, unit: 'pct', prev: 4.1 },
      saves: { value: 310, unit: 'count', prev: 265 },
      posts_count: { value: 14, unit: 'count', prev: 12 },
      profile_views: { value: 2210, unit: 'count', prev: 1980 },
      website_clicks: { value: 87, unit: 'count', prev: 90 },
    },
    follower_trend: [
      { date: '2026-07-01', count: 12320 },
      { date: '2026-07-10', count: 12360 },
      { date: '2026-07-20', count: 12410 },
      { date: '2026-07-31', count: 12450 },
    ],
    content_breakdown: {
      reels: { count: 6, avg_reach: 5200, avg_engagement: 260 },
      carousels: { count: 5, avg_reach: 2900, avg_engagement: 180 },
      images: { count: 3, avg_reach: 1400, avg_engagement: 90 },
    },
    top_posts: [
      { type: 'reel', reach: 9800, likes: 540, comments: 44, saves: 88, caption_preview: 'Mitos sobre protetor solar', date: '2026-07-12T14:00:00Z', permalink: 'https://instagram.com/p/a', thumbnail_url: null },
      { type: 'carousel', reach: 6200, likes: 380, comments: 21, saves: 65, caption_preview: '5 sinais de alerta na pele', date: '2026-07-05T14:00:00Z', permalink: 'https://instagram.com/p/b', thumbnail_url: null },
    ],
    audience: {
      gender_split: { female: 78, male: 22 },
      top_cities: [{ name: 'São Paulo', pct: 42 }, { name: 'Campinas', pct: 11 }],
      top_age_ranges: [{ range: '25-34', pct: 38 }, { range: '35-44', pct: 31 }],
      top_countries: [{ name: 'Brasil', pct: 96 }],
    },
    best_times: [
      { day: 'Seg', hour: 12, avg_engagement: 210 },
      { day: 'Qua', hour: 19, avg_engagement: 260 },
    ],
    tags_performance: [
      { tag: 'Educativo', avg_engagement: 240, avg_reach: 5100, count: 6 },
    ],
    ...over,
  };
}
```

- [ ] **Step 4: Rodar e ver passar; typecheck; commit**

```bash
npx vitest run packages/report-blocks
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
git add packages/report-blocks/ vitest.config.ts apps/crm/vite.config.ts apps/hub/vite.config.ts apps/crm/tsconfig.json apps/hub/tsconfig.json
git commit -m "feat(relatorios): pacote report-blocks com renderer, texto e capa"
```

---

### Task 7: Widgets de números e gráficos (KPI card, evolução de seguidores, formatos)

**Files:**
- Create: `packages/report-blocks/blocks/KpiCardBlock.tsx`
- Create: `packages/report-blocks/blocks/FollowerChartBlock.tsx`
- Create: `packages/report-blocks/blocks/FormatCardsBlock.tsx`
- Create: `packages/report-blocks/__tests__/kpi-and-charts.test.tsx`
- Modify: `packages/report-blocks/BlockRenderer.tsx` (registrar no `BLOCK_COMPONENTS`)

**Interfaces:**
- Consumes: `BlockProps`, `fmtCount`/`fmtPct`/`deltaPct` (Task 6), `KpiEntry`/`ReportKpiId` (types).
- Produces: entradas no `BLOCK_COMPONENTS` para `kpi_*` (8), `chart_followers`, `chart_formats`. Export `KPI_LABELS: Record<ReportKpiId, string>` de `KpiCardBlock.tsx` (o drawer do PR 2 usa).

- [ ] **Step 1: Teste primeiro**

```tsx
// packages/report-blocks/__tests__/kpi-and-charts.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout } from '../types';

const l = (blocks: ReportLayout['blocks']): ReportLayout => ({ version: 1, blocks });

describe('KpiCardBlock', () => {
  it('mostra label, valor formatado pt-BR e chip de delta quando há prev', () => {
    render(<BlockRenderer layout={l([{ id: 'k1', type: 'kpi_reach', size: 'third' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Alcance')).toBeInTheDocument();
    expect(screen.getByText('45.200')).toBeInTheDocument();
    expect(screen.getByText('+13,6%')).toBeInTheDocument(); // (45200-39800)/39800
  });

  it('formata pct e delta negativo', () => {
    render(<BlockRenderer layout={l([
      { id: 'k1', type: 'kpi_engagement_rate', size: 'third' },
      { id: 'k2', type: 'kpi_website_clicks', size: 'third' },
    ])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('4,7%')).toBeInTheDocument();
    expect(screen.getByText('-3,3%')).toBeInTheDocument(); // (87-90)/90
  });

  it('valor null: o card some; prev null: sem chip', () => {
    const snap = makeSnapshotFixture();
    snap.kpis.profile_views = { value: null, unit: 'count', prev: null };
    snap.kpis.saves = { value: 310, unit: 'count', prev: null };
    const { container } = render(<BlockRenderer layout={l([
      { id: 'k1', type: 'kpi_profile_views', size: 'third' },
      { id: 'k2', type: 'kpi_saves', size: 'third' },
    ])} snapshot={snap} mode="view" />);
    expect(screen.queryByText('Visitas ao perfil')).not.toBeInTheDocument();
    expect(screen.getByText('Salvamentos')).toBeInTheDocument();
    expect(container.querySelector('.rb-kpi-delta')).toBeNull();
  });
});

describe('FollowerChartBlock', () => {
  it('desenha a polyline e os extremos da série', () => {
    const { container } = render(<BlockRenderer layout={l([{ id: 'c1', type: 'chart_followers', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(screen.getByText('12.320')).toBeInTheDocument();
    expect(screen.getByText('12.450')).toBeInTheDocument();
  });

  it('série vazia: bloco some', () => {
    const { container } = render(<BlockRenderer layout={l([{ id: 'c1', type: 'chart_followers', size: 'full' }])} snapshot={makeSnapshotFixture({ follower_trend: [] })} mode="view" />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});

describe('FormatCardsBlock', () => {
  it('mostra os 3 formatos com contagem e chip de líder', () => {
    render(<BlockRenderer layout={l([{ id: 'f1', type: 'chart_formats', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Reels')).toBeInTheDocument();
    expect(screen.getByText('Carrosséis')).toBeInTheDocument();
    expect(screen.getByText('Imagens')).toBeInTheDocument();
    expect(screen.getByText('Formato líder')).toBeInTheDocument();
  });
});
```

Rode `npx vitest run packages/report-blocks` — os novos FAIL.

- [ ] **Step 2: Implementar**

```tsx
// packages/report-blocks/blocks/KpiCardBlock.tsx
import type { BlockProps } from '../BlockRenderer';
import type { KpiEntry, ReportKpiId } from '../types';
import { deltaPct, fmtCount, fmtPct } from '../format';

export const KPI_LABELS: Record<ReportKpiId, string> = {
  followers_gained: 'Novos seguidores',
  followers_total: 'Seguidores totais',
  reach: 'Alcance',
  engagement_rate: 'Taxa de engajamento',
  saves: 'Salvamentos',
  posts_count: 'Publicações',
  profile_views: 'Visitas ao perfil',
  website_clicks: 'Cliques no link',
};

function kpiIdFromBlockType(type: string): ReportKpiId {
  return type.replace(/^kpi_/, '') as ReportKpiId;
}

function fmtValue(entry: KpiEntry): string {
  return entry.unit === 'pct' ? fmtPct(entry.value as number) : fmtCount(entry.value as number);
}

export function KpiCardBlock({ block, snapshot }: BlockProps) {
  const id = kpiIdFromBlockType(block.type);
  const entry = snapshot.kpis[id];
  if (!entry || entry.value === null) return null;

  const delta = entry.prev !== null ? deltaPct(entry.value, entry.prev) : null;
  return (
    <div className="rb-kpi" style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}>
      <p style={{ margin: 0, fontSize: '0.78rem', opacity: 0.7 }}>{KPI_LABELS[id]}</p>
      <p style={{ margin: '0.2rem 0 0', fontSize: '1.5rem', fontWeight: 700 }}>{fmtValue(entry)}</p>
      {delta !== null ? (
        <p
          className="rb-kpi-delta"
          style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', fontWeight: 600, color: delta >= 0 ? '#0a7d43' : '#b3261e' }}
        >
          {`${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(1).replace('.', ',')}%`}
        </p>
      ) : null}
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/FollowerChartBlock.tsx
// Linha SVG da evolução de seguidores (espírito de _shared/report-template/charts.ts,
// portado para React).
import type { BlockProps } from '../BlockRenderer';
import { fmtCount } from '../format';

const W = 640;
const H = 180;
const PAD = 12;

export function FollowerChartBlock({ snapshot }: BlockProps) {
  const points = snapshot.follower_trend;
  if (points.length === 0) return null;

  const counts = points.map((p) => p.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const span = Math.max(max - min, 1);
  const x = (i: number) => points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1);
  const y = (c: number) => H - PAD - ((c - min) / span) * (H - 2 * PAD);
  const coords = points.map((p, i) => `${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ');

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Evolução de seguidores</p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Evolução de seguidores">
        <polyline points={coords} fill="none" stroke="var(--rb-accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', opacity: 0.7 }}>
        <span>{fmtCount(points[0].count)}</span>
        <span>{fmtCount(points[points.length - 1].count)}</span>
      </div>
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/FormatCardsBlock.tsx
import type { BlockProps } from '../BlockRenderer';
import { fmtCount } from '../format';

const FORMAT_LABELS = { reels: 'Reels', carousels: 'Carrosséis', images: 'Imagens' } as const;
type FormatKey = keyof typeof FORMAT_LABELS;

export function FormatCardsBlock({ snapshot }: BlockProps) {
  const entries = (Object.keys(FORMAT_LABELS) as FormatKey[])
    .map((key) => ({ key, data: snapshot.content_breakdown[key] }))
    .filter((e): e is { key: FormatKey; data: NonNullable<typeof e.data> } => Boolean(e.data && e.data.count > 0));
  if (entries.length === 0) return null;

  const leader = entries.reduce((a, b) => (b.data.avg_reach > a.data.avg_reach ? b : a));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${entries.length}, 1fr)`, gap: '0.75rem' }}>
      {entries.map(({ key, data }) => (
        <div key={key} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>
            {FORMAT_LABELS[key]}
            {key === leader.key ? (
              <span style={{ marginLeft: 8, fontSize: '0.68rem', color: 'var(--rb-accent)', border: '1px solid var(--rb-accent)', borderRadius: 999, padding: '0.1rem 0.5rem' }}>
                Formato líder
              </span>
            ) : null}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', opacity: 0.75 }}>
            {fmtCount(data.count)} publicações · alcance médio {fmtCount(data.avg_reach)}
          </p>
        </div>
      ))}
    </div>
  );
}
```

Registrar em `BlockRenderer.tsx` (dentro de `BLOCK_COMPONENTS`):

```tsx
import { KpiCardBlock } from './blocks/KpiCardBlock';
import { FollowerChartBlock } from './blocks/FollowerChartBlock';
import { FormatCardsBlock } from './blocks/FormatCardsBlock';
// ...
  kpi_followers_gained: KpiCardBlock,
  kpi_followers_total: KpiCardBlock,
  kpi_reach: KpiCardBlock,
  kpi_engagement_rate: KpiCardBlock,
  kpi_saves: KpiCardBlock,
  kpi_posts_count: KpiCardBlock,
  kpi_profile_views: KpiCardBlock,
  kpi_website_clicks: KpiCardBlock,
  chart_followers: FollowerChartBlock,
  chart_formats: FormatCardsBlock,
```

- [ ] **Step 3: Rodar e ver passar; commit**

```bash
npx vitest run packages/report-blocks
git add packages/report-blocks/
git commit -m "feat(relatorios): widgets de KPI, evolução de seguidores e formatos"
```

---

### Task 8: Widgets de audiência e conteúdo (donut, faixas, cidades, países, horários, posts, tags)

**Files:**
- Create: `packages/report-blocks/blocks/AudienceGenderBlock.tsx`
- Create: `packages/report-blocks/blocks/AudienceAgeBlock.tsx`
- Create: `packages/report-blocks/blocks/AudienceCitiesBlock.tsx`
- Create: `packages/report-blocks/blocks/AudienceCountriesBlock.tsx`
- Create: `packages/report-blocks/blocks/BestTimesBlock.tsx`
- Create: `packages/report-blocks/blocks/TopPostsBlock.tsx`
- Create: `packages/report-blocks/blocks/PostListBlock.tsx`
- Create: `packages/report-blocks/blocks/TagsTableBlock.tsx`
- Create: `packages/report-blocks/__tests__/audience-and-content.test.tsx`
- Modify: `packages/report-blocks/BlockRenderer.tsx` (registrar os 8)

**Interfaces:**
- Consumes: `BlockProps`, `fmtCount` (Task 6), `SnapshotTopPost` (types).
- Produces: entradas no `BLOCK_COMPONENTS` para `audience_gender`, `audience_age`, `audience_cities`, `audience_countries`, `chart_best_times`, `top_posts`, `post_list`, `tags_table`. Contrato de config: `top_posts.config.count` (default 6, 1..12), `post_list.config.count` (default 12, 1..12).

- [ ] **Step 1: Teste primeiro**

```tsx
// packages/report-blocks/__tests__/audience-and-content.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout } from '../types';

const l = (blocks: ReportLayout['blocks']): ReportLayout => ({ version: 1, blocks });
const allAudience: ReportLayout['blocks'] = [
  { id: 'a1', type: 'audience_gender', size: 'half' },
  { id: 'a2', type: 'audience_age', size: 'half' },
  { id: 'a3', type: 'audience_cities', size: 'half' },
  { id: 'a4', type: 'audience_countries', size: 'half' },
];

describe('widgets de audiência', () => {
  it('renderizam gênero, faixas, cidades e países do fixture', () => {
    render(<BlockRenderer layout={l(allAudience)} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Feminino')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('25-34')).toBeInTheDocument();
    expect(screen.getByText('São Paulo')).toBeInTheDocument();
    expect(screen.getByText('Brasil')).toBeInTheDocument();
  });

  it('audience null: todos somem', () => {
    const { container } = render(<BlockRenderer layout={l(allAudience)} snapshot={makeSnapshotFixture({ audience: null })} mode="view" />);
    expect(container.querySelectorAll('.rb-panel').length).toBe(0);
  });
});

describe('BestTimesBlock', () => {
  it('mostra o heatmap com os top horários', () => {
    render(<BlockRenderer layout={l([{ id: 'h1', type: 'chart_best_times', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Melhores horários para publicar')).toBeInTheDocument();
    expect(screen.getByText(/Qua · 19h/)).toBeInTheDocument();
  });
});

describe('TopPostsBlock', () => {
  it('respeita config.count e mostra métricas', () => {
    render(<BlockRenderer layout={l([{ id: 'p1', type: 'top_posts', size: 'full', config: { count: 1 } }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Mitos sobre protetor solar')).toBeInTheDocument();
    expect(screen.queryByText('5 sinais de alerta na pele')).not.toBeInTheDocument();
  });

  it('sem thumbnail: placeholder, nunca img quebrada', () => {
    const { container } = render(<BlockRenderer layout={l([{ id: 'p1', type: 'top_posts', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.querySelectorAll('.rb-thumb-placeholder').length).toBeGreaterThan(0);
  });
});

describe('TagsTableBlock', () => {
  it('mostra a tabela de tópicos', () => {
    render(<BlockRenderer layout={l([{ id: 't1', type: 'tags_table', size: 'full' }])} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('Educativo')).toBeInTheDocument();
    expect(screen.getByText('5.100')).toBeInTheDocument();
  });

  it('sem tags: some', () => {
    const { container } = render(<BlockRenderer layout={l([{ id: 't1', type: 'tags_table', size: 'full' }])} snapshot={makeSnapshotFixture({ tags_performance: [] })} mode="view" />);
    expect(container.querySelector('table')).toBeNull();
  });
});
```

- [ ] **Step 2: Implementar os 8 componentes**

Todos seguem o mesmo contrato: `null` quando sem dado; painel com `className="rb-panel"` e o mesmo estilo de borda dos KPIs. Código completo:

```tsx
// packages/report-blocks/blocks/AudienceGenderBlock.tsx
import type { BlockProps } from '../BlockRenderer';

export function AudienceGenderBlock({ snapshot }: BlockProps) {
  const g = snapshot.audience?.gender_split;
  if (!g) return null;
  const female = Math.round(g.female);
  const male = Math.round(g.male);
  // Donut simples: dois arcos via stroke-dasharray sobre circunferência 100.
  const r = 15.9155;
  return (
    <div className="rb-panel" style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Gênero</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <svg viewBox="0 0 42 42" style={{ width: 96, height: 96 }} role="img" aria-label="Distribuição por gênero">
          <circle cx="21" cy="21" r={r} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="6" />
          <circle
            cx="21" cy="21" r={r} fill="none" stroke="var(--rb-accent)" strokeWidth="6"
            strokeDasharray={`${female} ${100 - female}`} strokeDashoffset="25"
          />
        </svg>
        <div style={{ fontSize: '0.85rem' }}>
          <p style={{ margin: 0 }}><strong>{female}%</strong> Feminino</p>
          <p style={{ margin: '0.25rem 0 0' }}><strong>{male}%</strong> Masculino</p>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/AudienceAgeBlock.tsx
import type { BlockProps } from '../BlockRenderer';

export function AudienceAgeBlock({ snapshot }: BlockProps) {
  const rows = snapshot.audience?.top_age_ranges ?? [];
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div className="rb-panel" style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Faixa etária</p>
      {rows.map((row) => (
        <div key={row.range} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.3rem 0' }}>
          <span style={{ width: 52, fontSize: '0.78rem' }}>{row.range}</span>
          <div style={{ flex: 1, height: 8, background: 'rgba(0,0,0,0.06)', borderRadius: 4 }}>
            <div style={{ width: `${(row.pct / max) * 100}%`, height: '100%', background: 'var(--rb-accent)', borderRadius: 4 }} />
          </div>
          <span style={{ width: 40, textAlign: 'right', fontSize: '0.78rem' }}>{row.pct.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/AudienceCitiesBlock.tsx
import type { BlockProps } from '../BlockRenderer';

export function AudienceCitiesBlock({ snapshot }: BlockProps) {
  const rows = snapshot.audience?.top_cities ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="rb-panel" style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Cidades</p>
      {rows.map((row) => (
        <div key={row.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', margin: '0.25rem 0' }}>
          <span>{row.name}</span>
          <span style={{ fontWeight: 600 }}>{row.pct.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/AudienceCountriesBlock.tsx
import type { BlockProps } from '../BlockRenderer';

export function AudienceCountriesBlock({ snapshot }: BlockProps) {
  const rows = snapshot.audience?.top_countries ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="rb-panel" style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Países</p>
      {rows.map((row) => (
        <div key={row.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', margin: '0.25rem 0' }}>
          <span>{row.name}</span>
          <span style={{ fontWeight: 600 }}>{row.pct.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/BestTimesBlock.tsx
import type { BlockProps } from '../BlockRenderer';

export function BestTimesBlock({ snapshot }: BlockProps) {
  const slots = snapshot.best_times;
  if (slots.length === 0) return null;
  const top = [...slots].sort((a, b) => b.avg_engagement - a.avg_engagement).slice(0, 3);
  return (
    <div className="rb-panel" style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Melhores horários para publicar</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {top.map((slot, i) => (
          <span
            key={`${slot.day}-${slot.hour}`}
            style={{
              fontSize: '0.8rem', borderRadius: 999, padding: '0.3rem 0.75rem',
              background: i === 0 ? 'var(--rb-accent)' : 'rgba(0,0,0,0.05)',
              color: i === 0 ? '#fff' : 'inherit', fontWeight: 600,
            }}
          >
            {`${i + 1}º ${slot.day} · ${slot.hour}h`}
          </span>
        ))}
      </div>
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/TopPostsBlock.tsx
import type { BlockProps } from '../BlockRenderer';
import type { SnapshotTopPost } from '../types';
import { fmtCount } from '../format';

const TYPE_LABELS: Record<SnapshotTopPost['type'], string> = {
  reel: 'Reel', carousel: 'Carrossel', image: 'Imagem',
};
const DEFAULT_COUNT = 6;

export function TopPostsBlock({ block, snapshot }: BlockProps) {
  const raw = block.config?.count;
  const count = typeof raw === 'number' && raw >= 1 && raw <= 12 ? raw : DEFAULT_COUNT;
  const posts = snapshot.top_posts.slice(0, count);
  if (posts.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
      {posts.map((post, i) => (
        <article key={i} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, overflow: 'hidden' }}>
          {post.thumbnail_url ? (
            <img src={post.thumbnail_url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
          ) : (
            <div className="rb-thumb-placeholder" style={{ width: '100%', aspectRatio: '1', background: 'rgba(0,0,0,0.06)', display: 'grid', placeItems: 'center', fontSize: '0.75rem', opacity: 0.6 }}>
              {TYPE_LABELS[post.type]}
            </div>
          )}
          <div style={{ padding: '0.6rem' }}>
            <p style={{ margin: 0, fontSize: '0.7rem', opacity: 0.6 }}>{`${i + 1}º · ${TYPE_LABELS[post.type]}`}</p>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {post.caption_preview}
            </p>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', opacity: 0.75 }}>
              {`Alc. ${fmtCount(post.reach)} · ♥ ${fmtCount(post.likes)} · Com. ${fmtCount(post.comments)} · Salv. ${fmtCount(post.saves)}`}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/PostListBlock.tsx
import type { BlockProps } from '../BlockRenderer';
import { fmtCount } from '../format';

export function PostListBlock({ block, snapshot }: BlockProps) {
  const raw = block.config?.count;
  const count = typeof raw === 'number' && raw >= 1 && raw <= 12 ? raw : 12;
  const posts = snapshot.top_posts.slice(0, count);
  if (posts.length === 0) return null;
  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '0.5rem 1rem' }}>
      {posts.map((post, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', padding: '0.45rem 0', borderBottom: i < posts.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
          <span style={{ fontSize: '0.75rem', opacity: 0.6, width: 24 }}>{i + 1}º</span>
          <span style={{ flex: 1, fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{post.caption_preview}</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.75 }}>{fmtCount(post.reach)}</span>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// packages/report-blocks/blocks/TagsTableBlock.tsx
import type { BlockProps } from '../BlockRenderer';
import { fmtCount } from '../format';

export function TagsTableBlock({ snapshot }: BlockProps) {
  const rows = snapshot.tags_performance;
  if (rows.length === 0) return null;
  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem', overflowX: 'auto' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Performance por tópico</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.6 }}>
            <th style={{ padding: '0.3rem 0' }}>Tópico</th>
            <th>Posts</th>
            <th>Alcance médio</th>
            <th>Engajamento médio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tag} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <td style={{ padding: '0.35rem 0', fontWeight: 600 }}>{row.tag}</td>
              <td>{fmtCount(row.count)}</td>
              <td>{fmtCount(row.avg_reach)}</td>
              <td>{fmtCount(row.avg_engagement)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Registrar em `BLOCK_COMPONENTS`:

```tsx
import { AudienceGenderBlock } from './blocks/AudienceGenderBlock';
import { AudienceAgeBlock } from './blocks/AudienceAgeBlock';
import { AudienceCitiesBlock } from './blocks/AudienceCitiesBlock';
import { AudienceCountriesBlock } from './blocks/AudienceCountriesBlock';
import { BestTimesBlock } from './blocks/BestTimesBlock';
import { TopPostsBlock } from './blocks/TopPostsBlock';
import { PostListBlock } from './blocks/PostListBlock';
import { TagsTableBlock } from './blocks/TagsTableBlock';
// ...
  audience_gender: AudienceGenderBlock,
  audience_age: AudienceAgeBlock,
  audience_cities: AudienceCitiesBlock,
  audience_countries: AudienceCountriesBlock,
  chart_best_times: BestTimesBlock,
  top_posts: TopPostsBlock,
  post_list: PostListBlock,
  tags_table: TagsTableBlock,
```

- [ ] **Step 3: Rodar e ver passar; commit**

```bash
npx vitest run packages/report-blocks
git add packages/report-blocks/
git commit -m "feat(relatorios): widgets de audiência, horários, posts e tópicos"
```

---

### Task 9: CRM — serviço, página `/relatorios/:id` (read-only) e roteamento

**Files:**
- Create: `apps/crm/src/services/reportDocs.ts`
- Create: `apps/crm/src/services/__tests__/reportDocs.test.ts`
- Create: `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/RelatorioEditorPage.test.tsx`
- Modify: `apps/crm/src/App.tsx` (lazy const perto de `:67-69` + `<Route>` no grupo protegido `:177-238`)
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx:10-19` (`FEATURE_GATED`)
- Modify: `apps/crm/src/content/site-meta.ts:13-44` (`APP_ROUTE_PREFIXES`)
- Modify: `vercel.json:38-41` e `:70-73` (as DUAS listas, byte-idênticas)

**Interfaces:**
- Consumes: rota `POST /report-docs/generate` (Task 5), `BlockRenderer` + `styles.css` (Tasks 6-8), tipos de `@mesaas/report-blocks/types`.
- Produces (consumido pela Task 10):
  - `generateReportDoc(clientId: number, month: string): Promise<{ id: string }>`
  - `getReportDoc(id: string): Promise<ReportDocumentRow | null>`
  - `listReportDocs(clientId: number): Promise<ReportDocListItem[]>`
  - `interface ReportDocumentRow { id: string; client_id: number; title: string; period_start: string; period_end: string; layout: ReportLayout; data_snapshot: ReportDocSnapshot | null; status: 'pending' | 'generating' | 'ready' | 'failed'; generation_error: string | null; created_at: string; updated_at: string }`
  - `interface ReportDocListItem { id: string; title: string; period_start: string; status: ReportDocumentRow['status']; created_at: string }`
  - Rota `/relatorios/:id` protegida por `feature_analytics_reports`.

- [ ] **Step 1: Serviço com teste**

```ts
// apps/crm/src/services/__tests__/reportDocs.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, fromMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
    from: fromMock,
  },
}));

import { generateReportDoc, listReportDocs } from '../reportDocs';

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fromMock.mockReset();
});

describe('generateReportDoc', () => {
  it('POSTa clientId e month e devolve o id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'doc-1' }), { status: 201 }));
    const res = await generateReportDoc(42, '2026-07');
    expect(res.id).toBe('doc-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/report-docs/generate');
    expect(JSON.parse(init.body)).toEqual({ clientId: 42, month: '2026-07' });
  });

  it('erro do servidor vira Error com mensagem amigável', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'feature_disabled' }), { status: 403 }));
    await expect(generateReportDoc(42, '2026-07')).rejects.toThrow();
  });
});

describe('listReportDocs', () => {
  it('consulta report_documents filtrado por cliente', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'd1' }], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    fromMock.mockReturnValue({ select });
    const rows = await listReportDocs(42);
    expect(fromMock).toHaveBeenCalledWith('report_documents');
    expect(rows).toEqual([{ id: 'd1' }]);
  });
});
```

```ts
// apps/crm/src/services/reportDocs.ts
// Serviço do relatório interativo de blocos. Geração via edge function;
// leitura direta via PostgREST com RLS (padrão getClientReports).
import { supabase } from '../lib/supabase';
import type { ReportLayout } from '../../../../supabase/functions/_shared/report-docs/layout';
import type { ReportDocSnapshot } from '../../../../supabase/functions/_shared/report-docs/snapshot';

const EDGE_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/report-docs';

export interface ReportDocumentRow {
  id: string;
  client_id: number;
  title: string;
  period_start: string;
  period_end: string;
  layout: ReportLayout;
  data_snapshot: ReportDocSnapshot | null;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  generation_error: string | null;
  created_at: string;
  updated_at: string;
}

export type ReportDocListItem = Pick<
  ReportDocumentRow,
  'id' | 'title' | 'period_start' | 'status' | 'created_at'
>;

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };
}

export async function generateReportDoc(
  clientId: number,
  month: string,
): Promise<{ id: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clientId, month }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id) {
    throw new Error(data?.error === 'feature_disabled'
      ? 'Seu plano não inclui relatórios.'
      : `Erro ao gerar relatório (${res.status})`);
  }
  return data;
}

export async function getReportDoc(id: string): Promise<ReportDocumentRow | null> {
  const { data, error } = await supabase
    .from('report_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ReportDocumentRow | null) ?? null;
}

export async function listReportDocs(clientId: number): Promise<ReportDocListItem[]> {
  const { data, error } = await supabase
    .from('report_documents')
    .select('id, title, period_start, status, created_at')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ReportDocListItem[]) ?? [];
}
```

Rode `npx vitest run apps/crm/src/services/__tests__/reportDocs.test.ts` (FAIL antes, PASS depois).

- [ ] **Step 2: Página com teste**

```tsx
// apps/crm/src/pages/relatorio-editor/__tests__/RelatorioEditorPage.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';

const { getReportDocMock } = vi.hoisted(() => ({ getReportDocMock: vi.fn() }));
vi.mock('../../../services/reportDocs', () => ({ getReportDoc: getReportDocMock }));

import RelatorioEditorPage from '../RelatorioEditorPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/relatorios/doc-1']}>
        <Routes>
          <Route path="/relatorios/:id" element={<RelatorioEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RelatorioEditorPage', () => {
  it('renderiza título, mês e os blocos do documento', async () => {
    getReportDocMock.mockResolvedValue({
      id: 'doc-1', client_id: 42, title: 'Relatório de Julho de 2026',
      period_start: '2026-07-01', period_end: '2026-08-01',
      layout: { version: 1, blocks: [{ id: 'b1', type: 'cover', size: 'full' }] },
      data_snapshot: makeSnapshotFixture(),
      status: 'ready', generation_error: null,
      created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Relatório de Julho de 2026' })).toBeInTheDocument();
    expect(screen.getByText('DK Marketing')).toBeInTheDocument(); // capa renderizada
  });

  it('documento inexistente mostra estado de não encontrado', async () => {
    getReportDocMock.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Relatório não encontrado.')).toBeInTheDocument();
  });
});
```

```tsx
// apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx
// PR 1: visualização read-only do documento de blocos. O PR 2 adiciona a
// edição (drag, resize, drawer, autosave) em cima desta página.
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/spinner';
import { BlockRenderer } from '@mesaas/report-blocks/BlockRenderer';
import '@mesaas/report-blocks/styles.css';
import { getReportDoc } from '../../services/reportDocs';

export default function RelatorioEditorPage() {
  const { id } = useParams<{ id: string }>();

  const { data: doc, isLoading } = useQuery({
    queryKey: ['report-doc', id],
    queryFn: () => getReportDoc(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
        <Spinner />
      </div>
    );
  }

  if (!doc || !doc.data_snapshot) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Relatório não encontrado.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <header style={{ maxWidth: 880, margin: '0 auto 1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.35rem' }}>{doc.title}</h1>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {doc.data_snapshot.period.label}
        </p>
      </header>
      <BlockRenderer layout={doc.layout} snapshot={doc.data_snapshot} mode="view" />
    </div>
  );
}
```

Nota sobre o import `@mesaas/report-blocks/fixtures` no teste: o alias de diretório resolve `fixtures` para `packages/report-blocks/fixtures.ts` — mesmo mecanismo do `@mesaas/ui/FlagIcon`.

- [ ] **Step 3: Roteamento (4 arquivos, nesta ordem)**

1. `apps/crm/src/App.tsx` — junto dos lazy de analytics (`:67-69`):
   `const RelatorioEditorPage = lazy(() => import('./pages/relatorio-editor/RelatorioEditorPage'));`
   e no grupo protegido, logo após a rota `/analytics/:id`:
   `<Route path="/relatorios/:id" element={<RelatorioEditorPage />} />`
2. `apps/crm/src/components/layout/ProtectedRoute.tsx` — em `FEATURE_GATED`, adicionar:
   `'/relatorios': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },`
3. `apps/crm/src/content/site-meta.ts` — adicionar `'relatorios',` ao `APP_ROUTE_PREFIXES` (sem colisão de radical com prefixos existentes; ordem alfabética não importa, radical compartilhado sim).
4. `vercel.json` — adicionar `|relatorios` DENTRO do grupo nas DUAS strings de `source` (linhas ~39 e ~71). As duas devem continuar byte-idênticas — o teste `vercel-routing.test.ts` cobra.

- [ ] **Step 4: Rodar testes de guarda + página; commit**

```bash
npx vitest run apps/crm/src/content apps/crm/src/pages/relatorio-editor apps/crm/src/services/__tests__/reportDocs.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
git add apps/crm/src/services/reportDocs.ts apps/crm/src/services/__tests__/reportDocs.test.ts apps/crm/src/pages/relatorio-editor/ apps/crm/src/App.tsx apps/crm/src/components/layout/ProtectedRoute.tsx apps/crm/src/content/site-meta.ts vercel.json
git commit -m "feat(relatorios): rota /relatorios/:id com visualização do documento"
```

---

### Task 10: Entrada na AnalyticsContaPage (dialog Novo relatório + lista)

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/components/NewReportDialog.tsx`
- Create: `apps/crm/src/pages/analytics-conta/components/__tests__/NewReportDialog.test.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (novo card acima do card "Relatórios Gerados", `:2212`)

**Interfaces:**
- Consumes: `generateReportDoc`, `listReportDocs`, `ReportDocListItem` (Task 9); `MonthPicker` (`@/components/ui/month-picker`, props `{ value, onChange, ... }`, formato `YYYY-MM`); `Dialog*` (`@/components/ui/dialog`).
- Produces: `NewReportDialog({ open, onOpenChange, clientId }: { open: boolean; onOpenChange: (open: boolean) => void; clientId: number })` — ao gerar, navega para `/relatorios/:id`.

Não tocar no botão "Gerar Relatório" do header nem no card existente: o teste `AnalyticsContaPage.test.tsx:692-750` depende do nome exato `'Gerar Relatório'` e do fluxo antigo, que continua vivo em paralelo (spec: componente novo e separado).

- [ ] **Step 1: Teste do dialog**

```tsx
// apps/crm/src/pages/analytics-conta/components/__tests__/NewReportDialog.test.tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { generateMock, navigateMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  navigateMock: vi.fn(),
}));
vi.mock('../../../../services/reportDocs', () => ({ generateReportDoc: generateMock }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NewReportDialog } from '../NewReportDialog';

describe('NewReportDialog', () => {
  it('gera com o mês selecionado e navega para o documento', async () => {
    generateMock.mockResolvedValue({ id: 'doc-9' });
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() => expect(generateMock).toHaveBeenCalled());
    const [clientId, month] = generateMock.mock.calls[0];
    expect(clientId).toBe(42);
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/doc-9');
  });

  it('erro mostra toast e mantém o dialog aberto', async () => {
    const { toast } = await import('sonner');
    generateMock.mockRejectedValue(new Error('Seu plano não inclui relatórios.'));
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Seu plano não inclui relatórios.'));
  });
});
```

- [ ] **Step 2: Implementar o dialog**

```tsx
// apps/crm/src/pages/analytics-conta/components/NewReportDialog.tsx
// Cria um relatório interativo: mês (default = mês anterior) e geração
// síncrona. Seletor de template chega no PR 3, junto com a UI de templates.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { MonthPicker } from '@/components/ui/month-picker';
import { generateReportDoc } from '../../../services/reportDocs';

function previousMonth(): string {
  const now = new Date();
  const y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}

export interface NewReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
}

export function NewReportDialog({ open, onOpenChange, clientId }: NewReportDialogProps) {
  const navigate = useNavigate();
  const [month, setMonth] = useState(previousMonth);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (generating || !month) return;
    setGenerating(true);
    try {
      const { id } = await generateReportDoc(clientId, month);
      toast.success('Relatório gerado.');
      onOpenChange(false);
      navigate(`/relatorios/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar relatório');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!generating) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo relatório interativo</DialogTitle>
        </DialogHeader>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Gera o relatório com os dados do mês escolhido. Depois você edita os blocos,
          remove métricas e salva o layout como modelo.
        </p>
        <div className="space-y-1">
          <Label>Mês do relatório</Label>
          <MonthPicker value={month} onChange={setMonth} clearable={false} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={generating} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={generating || !month} onClick={handleGenerate}>
            {generating ? <Spinner size="sm" /> : null} {generating ? 'Gerando…' : 'Gerar relatório'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Rode `npx vitest run apps/crm/src/pages/analytics-conta/components` (FAIL antes, PASS depois).

- [ ] **Step 3: Integrar na página**

Em `AnalyticsContaPage.tsx`:

1. Imports (junto dos demais):
```tsx
import { NewReportDialog } from './components/NewReportDialog';
import { listReportDocs } from '../../services/reportDocs';
```
2. Estado (junto de `generateIncludeAI`, `:1013`):
```tsx
const [newReportOpen, setNewReportOpen] = useState(false);
```
3. Query (junto das outras, após `:1067`):
```tsx
const { data: reportDocs = [] } = useQuery({
  queryKey: ['report-docs', clientId],
  queryFn: () => listReportDocs(clientId),
});
```
4. Novo card imediatamente ANTES do card `{/* Reports */}` (`:2212`), mesmo vocabulário visual do card vizinho:
```tsx
{/* Relatórios interativos (novo formato) */}
<div className="card animate-up">
  <div
    className="dashboard-hub-card-header"
    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
  >
    <h3>Relatórios Interativos</h3>
    <Button variant="outline" size="sm" onClick={() => setNewReportOpen(true)}>
      <Plus className="h-3.5 w-3.5" /> Novo relatório
    </Button>
  </div>
  <div style={{ marginTop: '1rem' }}>
    {reportDocs.length === 0 && (
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Nenhum relatório interativo ainda. Clique em "Novo relatório" para criar o primeiro.
      </p>
    )}
    {reportDocs.map((doc) => (
      <div
        key={doc.id}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.5rem 0', borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))',
        }}
      >
        <div>
          <strong>{doc.title}</strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
            {new Date(doc.created_at).toLocaleDateString('pt-BR')}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate(`/relatorios/${doc.id}`)}>
          Abrir
        </Button>
      </div>
    ))}
  </div>
</div>
```
5. O dialog, junto dos outros dialogs no fim do JSX (`:2386` em diante):
```tsx
<NewReportDialog open={newReportOpen} onOpenChange={setNewReportOpen} clientId={clientId} />
```

- [ ] **Step 4: Rodar a suíte da página (regressão) + typecheck; commit**

```bash
npx vitest run apps/crm/src/pages/analytics-conta
npx tsc -p apps/crm/tsconfig.json --noEmit
git add apps/crm/src/pages/analytics-conta/
git commit -m "feat(relatorios): entrada Novo relatório e lista na página de analytics"
```

Se o teste antigo da página quebrar por causa do novo card, o problema é o card, não o teste: o contrato do fluxo antigo ('Gerar Relatório', 'Relatórios Gerados') não pode mudar neste PR.

---

### Task 11: Verificação completa, deploy em staging e PR

**Files:** nenhum novo (só correções que a verificação apontar).

- [ ] **Step 1: Suítes completas e limpeza**

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/report-restructure-41a80e
ls node_modules/.deno 2>/dev/null && npm ci   # deno já poluiu? reinstala
npm run lint
npm run format          # auto-fix; depois confere
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git checkout -- deno.lock
git status              # working tree limpo além do esperado?
```

Todos verdes antes de seguir. `npm run test:db` só se colima/Docker disponível (CI cobre).

- [ ] **Step 2: Deploy em STAGING (banco + função) para a verificação de browser**

```bash
cat supabase/.temp/project-ref   # DEVE ser wlyzhyfondykzpsiqsce (staging); se não, npx supabase link
npx supabase db push --linked
npx supabase functions deploy report-docs --use-api
git checkout -- deno.lock
```

A função `report-docs` verifica o próprio JWT no handler, mas o gateway pode barrar antes — deploy SEM `--no-verify-jwt` (o cliente manda `Authorization: Bearer <jwt de usuário>` + `apikey`, igual ao `instagram-analytics`, que também é deployado com verificação padrão).

- [ ] **Step 3: Verificação no browser (staging)**

```bash
cp /Users/eduardosouza/Projects/sm-crm/.env.staging .env.staging   # worktrees não herdam o env
```

Suba com `preview_start` usando `.claude/launch.json` com um entry `crm-staging` (`npm run dev:staging`, porta 5173). Fluxo a provar, com screenshot final:
1. Login no CRM staging, abrir um cliente com Instagram conectado, ir em Analytics.
2. Card "Relatórios Interativos" → "Novo relatório" → escolher mês anterior → Gerar.
3. Redireciona para `/relatorios/:id`; documento renderiza capa, resumo, KPIs com deltas, gráfico, formatos, posts (thumbnails ou placeholder), audiência (se houver), recomendações (se IA ligada).
4. Voltar para Analytics: o documento aparece na lista, "Abrir" funciona.
5. Console do browser sem erros; `read_network_requests` sem 4xx/5xx da função.

- [ ] **Step 4: PR**

```bash
git ls-tree --name-only origin/main:supabase/migrations | tail -5   # prefixo 20260820000010 ainda único?
git push -u origin claude/report-restructure-41a80e
gh pr create --title "feat(relatorios): fundação do relatório interativo de blocos (PR 1/3)" --body "$(cat <<'EOF'
Fase 1 da spec docs/superpowers/specs/2026-08-20-report-builder-blocks-design.md.

- Tabelas report_documents + report_templates (RLS get_my_conta_id, grants por coluna, trigger de validação de layout, RPC de template default)
- Edge function report-docs: geração síncrona (snapshot completo + layout padrão + IA opcional preenchendo blocos editáveis)
- Pacote @mesaas/report-blocks: renderer de grid + 25 widgets v1 read-only
- Rota /relatorios/:id no CRM (gated por feature_analytics_reports) + entrada na página de Analytics
- Sistema antigo de relatórios intocado (componente paralelo; deprecate futuro)

PR 2 = editor (drag/resize/drawer/autosave). PR 3 = templates + Hub + PDF.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

O review externo do Codex dispara sozinho no `gh pr create` — verificar os achados antes de qualquer merge (não carimbar).

---

## Self-review do plano (executado na escrita)

- **Cobertura da spec (escopo PR 1):** §3 modelo de dados → Task 1; §4 layout/validação em 3 camadas → Tasks 1 (trigger), 2 (validador TS), 6 (renderer tolerante); §5 geração/ownership/thumbnails/IA → Tasks 3-5; §6 pacote → Tasks 6-8; §7 catálogo + bases de KPI → Tasks 3, 7-8; §8 editor (parte read-only + rota + vercel) → Task 9-10. Fora do PR 1 por fase: §5 pdf/refresh/delete, §8 edição, §9 Hub/print, §3 RPC usada por UI (RPC já criada na Task 1 para o schema nascer completo).
- **Divergência consciente da spec:** o dialog de criação do PR 1 não tem seletor de template (a UI de templates é PR 3; a tabela já existe). Registrado na Task 10.
- **Consistência de tipos:** `ReportLayout/ReportBlock/BlockType/BlockSize` definidos uma vez (Task 2) e reexportados (Task 6); `KpiEntry.value: number | null` respeitado em kpis/snapshot/widgets/ai-input; `SnapshotTopPost.saves` (não `saved`) em todo o pacote; `assembleSnapshot` recebe `SnapshotPostRow[]` com `saved` (nome da coluna do banco) e converte.
- **Pontos que o implementador DEVE verificar no código real (marcados nas tasks):** lookup de `instagram_accounts` por cliente (Task 5 Step 2), campos do `cachePostThumbnail` (Task 5 Step 2), mapeamento `media_type` (Task 4/snapshot), número livre do teste SQL (Task 1).
