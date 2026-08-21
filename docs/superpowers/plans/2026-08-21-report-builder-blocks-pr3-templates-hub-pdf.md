# Relatório de blocos PR 3 (Templates + Hub + PDF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o ciclo do relatório interativo de blocos: templates reutilizáveis (salvar/aplicar/default do workspace), viewer read-only no Hub, export PDF via Gotenberg convert/url com token HMAC, e os must-dos de resiliência registrados nos PRs 1-2.

**Architecture:** Terceiro PR empilhado (base: `claude/report-editor-pr2`). O backend ganha as rotas `/:id/pdf`, `/:id/refresh-data` e `DELETE /:id` na edge function `report-docs` existente, mais uma função nova `hub-report-docs` (token de portal + token HMAC de print). O frontend do Hub ganha a lista união (legado + docs), o viewer de documento e a página `/print` com contrato de prontidão. O CRM ganha o CRUD de templates (PostgREST direto, precedente `briefing_templates`) e as ações do editor. Uma migration nova endurece o trigger de layout com os invariantes ESTÁVEIS e adiciona `pdf_renderer_version`.

**Tech Stack:** Deno edge functions, Web Crypto (HMAC-SHA256), Gotenberg chromium convert/url, React 19 + TanStack Query, `packages/report-blocks` compartilhado, shadcn/ui.

## Global Constraints

- Copy de UI SEM travessões (em-dash). Ponto, dois-pontos ou "·".
- Branch de trabalho: `claude/report-pr3-templates-hub-pdf`, criada de `claude/report-editor-pr2` (HEAD atual `08939dbb`). NUNCA commitar na base.
- Migration nova usa prefixo `20260821000010`. **Na abertura do PR é OBRIGATÓRIO reconferir `git ls-tree origin/main:supabase/migrations | tail` e renumerar acima do tail** (hoje o tail de main é `20260820000003`; o branch-base já carrega `20260820000010`).
- NUNCA `REVOKE ... FROM PUBLIC` (derruba `service_role`). Revoke direcionado a `anon, authenticated`.
- Edge functions: CORS via `buildCorsHeaders(req)`; erro genérico pro cliente + detalhe no log; TODO id de request resolvido contra o workspace/token antes de servir dados (spec §5 e §9).
- `hub-report-docs` será deployada com `--no-verify-jwt` (auth própria por token). `report-docs` continua com verificação padrão.
- Spec de referência: `docs/superpowers/specs/2026-08-20-report-builder-blocks-design.md` (§3-§9). Em conflito plano×spec, PARE e pergunte ao controller.
- `packages/report-blocks`: imports RELATIVOS, nunca `@/` (pacote compartilhado CRM+Hub).
- Operações de layout do editor são IMUTÁVEIS e devolvem a MESMA referência quando nada muda (contrato do autosave, `layoutOps.ts`).
- Testes: Deno (`npm run test:functions`) para edge; Vitest (`npm run test`) para apps; SQL na suíte `supabase/tests/entitlements/`. Rodar o Vitest ANTES do deno (deno polui `node_modules/.deno`; se poluir, `npm ci`). Depois do deno: `git checkout -- deno.lock`.
- Typecheck de CI = 4 projetos: `npx tsc -p apps/crm/tsconfig.json --noEmit`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`.
- Ícones: `lucide-react`. Toasts: `toast()` de `sonner`.

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `supabase/migrations/20260821000010_report_docs_pdf_hardening.sql` (novo) | Trigger de layout endurecido (invariantes estáveis), bump condicional de `updated_at`, coluna `pdf_renderer_version` |
| `supabase/functions/report-docs/errors.ts` (novo) | `GenerateError` movida + `DocActionError` |
| `supabase/functions/report-docs/client-id.ts` | `parseGenerateBody` ganha `templateId` opcional |
| `supabase/functions/report-docs/generate.ts` | Lookup de template (explícito → default → sistema); snapshot extraído p/ `snapshot-source.ts` |
| `supabase/functions/report-docs/snapshot-source.ts` (novo) | `loadClientSnapshot()` compartilhado por generate e refresh |
| `supabase/functions/report-docs/refresh.ts` (novo) | `refreshReportDocument()` |
| `supabase/functions/report-docs/delete-doc.ts` (novo) | `deleteReportDocument()` (objeto PDF + linha) |
| `supabase/functions/report-docs/pdf.ts` (novo) | `exportReportPdf()` com regra de cache + Gotenberg + upload + signed URL |
| `supabase/functions/report-docs/index.ts` | Rotas novas `/:id/pdf`, `/:id/refresh-data`, `DELETE /:id` |
| `supabase/functions/_shared/report-docs/print-token.ts` (novo) | HMAC sign/verify do print token |
| `supabase/functions/_shared/report-template/pdf-url.ts` (novo) | Gotenberg `convert/url` com `waitForExpression` |
| `supabase/functions/hub-report-docs/index.ts` + `handlers.ts` (novos) | Lista união, doc por token de portal, print-doc por HMAC |
| `supabase/tests/entitlements/66_report_docs.sql` | Casos novos do trigger endurecido + bump condicional |
| `apps/crm/src/services/reportTemplates.ts` (novo) | CRUD de templates via PostgREST + RPC default |
| `apps/crm/src/services/reportDocs.ts` | `generateReportDoc(templateId?)`, `exportReportPdf`, `refreshReportDoc`, `deleteReportDoc` |
| `apps/crm/src/pages/relatorio-editor/templateOps.ts` (novo) | `stripAiTextForTemplate`, `applyTemplateLayout` (puros) |
| `apps/crm/src/pages/relatorio-editor/SaveTemplateDialog.tsx` + `ApplyTemplateDialog.tsx` (novos) | UI de templates |
| `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx` | Barra: Exportar PDF, menu Ações (template/refresh/ver como cliente) |
| `apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts` | beforeunload + retry com backoff/cap/toast dedup |
| `apps/crm/src/pages/relatorio-editor/layoutOps.ts` + `EditorCanvas.tsx` | `restoreBlock` + hook de remoção p/ undo |
| `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` + `components/NewReportDialog.tsx` | Excluir doc na lista; seletor de template na geração |
| `apps/hub/src/api.ts` | `fetchReportList` (união), `fetchReportDoc`, `fetchPrintReportDoc` |
| `apps/hub/src/pages/Relatorios.tsx` | Lista união |
| `apps/hub/src/pages/RelatorioDocPage.tsx` (novo) | Viewer read-only (BlockRenderer mode view) |
| `apps/hub/src/pages/RelatorioPrintPage.tsx` (novo) | Página `/print` com `window.__REPORT_READY` |
| `apps/hub/src/router.tsx` | Rotas `relatorios/doc/:docId` (shell) e `/relatorios/print/:docId` (top-level) |
| `vercel.json` + `apps/crm/src/content/__tests__/vercel-routing.test.ts` | Rewrite do print ANTES do app-shell + noindex |
| `CLAUDE.md` | Env vars novas do export de PDF |

## Decisões fechadas (não reabrir sem falar com o controller)

1. **Cache do PDF sem coluna de hash:** `pdf_generated_at >= updated_at AND pdf_renderer_version = PDF_RENDERER_VERSION` (spec §5). Para isso funcionar, o trigger `set_report_documents_updated_at` passa a bumpar `updated_at` SÓ quando conteúdo muda (`layout, title, data_snapshot, ai_content, status`); gravar `pdf_*` não bumpa. Sem essa mudança, salvar `pdf_generated_at` invalidaria o próprio cache no mesmo UPDATE. Janela residual conhecida e aceita: edição que acontece DURANTE a conversão do Gotenberg pode ficar fora do PDF servido até a próxima edição (comentário no código).
2. **Semântica de template:** template = layout sem dados. Ao SALVAR: `text` removido dos blocos `ai_*` (regenerados por relatório, spec §4), mantido nos blocos `text` (conteúdo do autor); `accent` viaja junto. Ao GERAR com template: `fillAiBlocks` preenche os `ai_*` (summary sempre; recommendations/goals removidos se a IA não produziu). Ao APLICAR num relatório existente: substituição completa do layout; blocos `ai_*` do template herdam o texto do primeiro bloco do MESMO tipo com texto no layout atual, senão são removidos. Ids dos blocos do template são mantidos (substituição completa, sem risco de colisão).
3. **Template inválido:** `templateId` explícito com layout que falha `validateLayout` responde `400 invalid_template`. Template `is_default` inválido no fallback só loga warn e cai no layout padrão do sistema (o usuário não pediu esse template pelo nome).
4. **Print token:** HMAC-SHA256 com `INTERNAL_FUNCTION_SECRET`, payload `{docId, exp}` (epoch segundos), TTL 10 minutos, formato `base64url(payload).base64url(sig)`. Sem estado no banco. A rota `print-doc` NÃO exige token de portal nem `feature_hub_portal` (spec §9).
5. **Storage do PDF:** bucket EXISTENTE `analytics-reports` (privado), path `docs/{conta_id}/{doc_id}.pdf`, upsert (um objeto por documento). Signed URL de 3600s.
6. **Env vars do export (checadas NA ROTA, não no boot):** `GOTENBERG_URL`, `INTERNAL_FUNCTION_SECRET`, `REPORT_PRINT_BASE` (origem pública que serve a página de print, ex. `https://mesaas.com.br`). Faltando qualquer uma, `/:id/pdf` responde `503 pdf_not_configured`. As demais rotas funcionam sem elas.
7. **Rota do print no Vercel:** `/relatorios/print/:docId` reescreve para `/hub/index.html` e a entrada tem que vir ANTES da rewrite do app-shell do CRM (que captura `relatorios(/.*)?`). Ordem no array é semântica no Vercel.
8. **Undo de exclusão:** para TODO bloco (não só texto), via `toast` com action "Desfazer" restaurando o bloco na posição original.
9. **Retry do autosave:** backoff `[5s, 15s, 30s]`, depois PARA de re-tentar sozinho (payload retido; próxima edição reinicia o ciclo). Toast de erro com `id` fixo para dedup.
10. **Rate limit:** `/generate` e `/:id/refresh-data` dividem o bucket existente `report-docs:{contaId}` (20/h). `/:id/pdf` tem bucket próprio `report-docs-pdf:{contaId}` (30/h). `DELETE` sem limite.

---

### Task 1: Migration de hardening + bump condicional + `pdf_renderer_version` (+ testes SQL)

**Files:**
- Create: `supabase/migrations/20260821000010_report_docs_pdf_hardening.sql`
- Modify: `supabase/tests/entitlements/66_report_docs.sql`

**Interfaces:**
- Consumes: migration `20260820000010_report_docs.sql` (funções `validate_report_layout`, `set_report_documents_updated_at` já existem; este arquivo dá `CREATE OR REPLACE` nelas).
- Produces: coluna `report_documents.pdf_renderer_version int`; trigger de layout que rejeita id duplicado, `accent` malformado e `text` fora dos tipos textuais; `updated_at` que NÃO bumpa em escrita de `pdf_*`.

Contexto: o `validateLayout` TS (`supabase/functions/_shared/report-docs/layout.ts:64-114`) já valida esses três invariantes. O trigger espelha SÓ o subset estável (ruling registrado nos PRs 1-2: o catálogo de tipos NÃO entra no plpgsql; ele deriva e vive só no validador TS).

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260821000010_report_docs_pdf_hardening.sql
-- PR 3 do relatório de blocos: hardening do trigger de layout (invariantes
-- ESTÁVEIS espelhados de validateLayout TS; o catálogo de tipos fica só no
-- validador, decisão registrada nos reviews dos PRs 1-2), bump condicional de
-- updated_at (grava pdf_* sem invalidar o cache do PDF) e a coluna de versão
-- do renderer usada pela regra de cache do export.

ALTER TABLE report_documents ADD COLUMN pdf_renderer_version int;

-- updated_at só muda quando CONTEÚDO muda. Sem isso, gravar pdf_generated_at
-- bumparia updated_at no MESMO update e o cache (pdf_generated_at >=
-- updated_at) nasceria sempre inválido.
CREATE OR REPLACE FUNCTION set_report_documents_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.layout, NEW.title, NEW.data_snapshot, NEW.ai_content, NEW.status)
     IS DISTINCT FROM
     (OLD.layout, OLD.title, OLD.data_snapshot, OLD.ai_content, OLD.status) THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END $$;

-- Hardening: os três invariantes estáveis que a escrita direta via PostgREST
-- não pode furar. Tudo o mais (catálogo de tipos, bounds de config) continua
-- no validateLayout TS compartilhado.
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
  -- accent, quando presente, é string #rrggbb exata.
  IF NEW.layout ? 'accent' AND (
       jsonb_typeof(NEW.layout -> 'accent') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'accent' !~ '^#[0-9a-fA-F]{6}$'
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
       -- text só nos tipos textuais (subset estável; espelha TEXT_BLOCK_TYPES)
       OR (b ? 'text' AND b ->> 'type' NOT IN
           ('text', 'ai_summary', 'ai_recommendations', 'ai_goals'))
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- id duplicado
  IF (SELECT count(*) <> count(DISTINCT b ->> 'id')
        FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  RETURN NEW;
END $$;
```

- [ ] **Step 2: Estender a suíte SQL**

Em `supabase/tests/entitlements/66_report_docs.sql`, dentro do bloco `do $$` existente (mesmo idioma dos casos atuais: sub-bloco `begin ... exception when others`, conferindo `sqlerrm like '%INVALID_LAYOUT%'`), acrescentar após os casos existentes de trigger:

```sql
  -- Hardening PR3: id duplicado é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31',
        '{"version":1,"blocks":[{"id":"x","type":"text","size":"full"},{"id":"x","type":"divider","size":"full"}]}'::jsonb);
    raise exception 'validate_report_layout aceitou id duplicado';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Hardening PR3: accent com alpha (#rrggbbaa) é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31',
        '{"version":1,"accent":"#11223344","blocks":[]}'::jsonb);
    raise exception 'validate_report_layout aceitou accent com alpha';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Hardening PR3: text em bloco não-textual é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31',
        '{"version":1,"blocks":[{"id":"k1","type":"kpi_reach","size":"third","text":{}}]}'::jsonb);
    raise exception 'validate_report_layout aceitou text em kpi';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Hardening PR3: layout válido COM accent e text em bloco ai_ passa.
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_a, v_cli_a, '2026-02-01', '2026-02-28',
      '{"version":1,"accent":"#9f1239","blocks":[{"id":"a1","type":"ai_summary","size":"full","text":{"type":"doc"}}]}'::jsonb);

  -- Bump condicional: update de layout bumpa updated_at; update de pdf_* NÃO.
  declare
    v_t0 timestamptz; v_t1 timestamptz; v_t2 timestamptz;
  begin
    select updated_at into v_t0 from report_documents where id = v_doc_a;
    perform pg_sleep(0.01);
    update report_documents
       set layout = '{"version":1,"blocks":[{"id":"b2","type":"divider","size":"full"}]}'::jsonb
     where id = v_doc_a;
    select updated_at into v_t1 from report_documents where id = v_doc_a;
    if v_t1 <= v_t0 then
      raise exception 'update de layout não bumpou updated_at';
    end if;
    update report_documents
       set pdf_storage_path = 'docs/x/y.pdf', pdf_generated_at = now(), pdf_renderer_version = 1
     where id = v_doc_a;
    select updated_at into v_t2 from report_documents where id = v_doc_a;
    if v_t2 <> v_t1 then
      raise exception 'update de pdf_* bumpou updated_at (cache do PDF nasce inválido)';
    end if;
  end;
```

Atenção ao idioma: o `do $$` externo já declara variáveis; o sub-bloco `declare ... begin ... end;` acima é um bloco aninhado válido em plpgsql. Se a suíte atual usa outro estilo para asserções temporais, siga o estilo dela.

- [ ] **Step 3: Rodar a suíte SQL localmente SE houver Docker/colima disponível** (`colima start` + `supabase start` + `bash scripts/test-entitlements.sh`). Se indisponível, declare no report que o gate fica para o CI (`entitlement-tests` roda a suíte) e siga.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260821000010_report_docs_pdf_hardening.sql supabase/tests/entitlements/66_report_docs.sql
git commit -m "feat(relatorios): hardening do trigger de layout, bump condicional e pdf_renderer_version"
```

---

### Task 2: Template na geração (edge): parse + lookup explícito/default/sistema

**Files:**
- Create: `supabase/functions/report-docs/errors.ts`
- Modify: `supabase/functions/report-docs/client-id.ts`, `supabase/functions/report-docs/generate.ts`, `supabase/functions/report-docs/index.ts`
- Test: `supabase/functions/report-docs/client-id.test.ts`, `supabase/functions/report-docs/generate.test.ts`

**Interfaces:**
- Consumes: `validateLayout` de `../_shared/report-docs/layout.ts`; `fillAiBlocks(layout, {summary, recommendations, goals})` de `../_shared/report-docs/tiptap-doc.ts` (já preenche `ai_*` e REMOVE os sem conteúdo).
- Produces: `parseGenerateBody(raw): { clientId: number; month: string; templateId: string | null } | null`; `generateReportDocument(db, deps, contaId, clientId, month, templateId)`; `GenerateError` agora com code adicional `"invalid_template"`, exportada de `errors.ts` E re-exportada de `generate.ts` (compat com imports existentes).

- [ ] **Step 1: Criar `errors.ts` e mover `GenerateError`**

```ts
// supabase/functions/report-docs/errors.ts
// Erros tipados das rotas. Separados de generate.ts para evitar import
// circular quando snapshot-source.ts (Task 4) também precisar deles.
export class GenerateError extends Error {
  constructor(
    public code: "not_found" | "bad_month" | "feature_disabled" | "invalid_template",
    msg?: string,
  ) {
    super(msg ?? code);
  }
}

export class DocActionError extends Error {
  constructor(
    public code: "not_found" | "pdf_not_configured" | "pdf_failed",
    msg?: string,
  ) {
    super(msg ?? code);
  }
}

// Bucket dos PDFs exportados (reuso do bucket privado do pipeline legado, com
// prefixo docs/ separando). Mora aqui por ser consumido por pdf.ts E
// delete-doc.ts sem criar dependência entre eles.
export const PDF_BUCKET = "analytics-reports";
```

Em `generate.ts`: remover a classe local e adicionar no topo:

```ts
import { GenerateError } from "./errors.ts";
export { GenerateError } from "./errors.ts";
```

- [ ] **Step 2: Testes RED do parse**

Acrescentar em `client-id.test.ts` (seguir o estilo dos testes existentes do arquivo):

```ts
Deno.test("parseGenerateBody: templateId ausente vira null", () => {
  const r = parseGenerateBody({ clientId: 1, month: "2026-07" });
  assertEquals(r, { clientId: 1, month: "2026-07", templateId: null });
});

Deno.test("parseGenerateBody: templateId uuid válido passa", () => {
  const r = parseGenerateBody({
    clientId: 1, month: "2026-07",
    templateId: "b3b2a6a0-1111-4222-8333-444455556666",
  });
  assertEquals(r?.templateId, "b3b2a6a0-1111-4222-8333-444455556666");
});

Deno.test("parseGenerateBody: templateId não-uuid rejeita o corpo", () => {
  assertEquals(
    parseGenerateBody({ clientId: 1, month: "2026-07", templateId: "abc" }),
    null,
  );
  assertEquals(
    parseGenerateBody({ clientId: 1, month: "2026-07", templateId: 42 }),
    null,
  );
});
```

- [ ] **Step 3: Rodar e ver falhar** — `npm run test:functions -- --filter "parseGenerateBody"` (o `--filter` casa com NOME de teste, não arquivo). Esperado: FAIL (shape sem `templateId`).

- [ ] **Step 4: Implementar o parse**

Em `client-id.ts`, substituir `parseGenerateBody`:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseGenerateBody(
  raw: unknown,
): { clientId: number; month: string; templateId: string | null } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { clientId, month, templateId } = raw as {
    clientId?: unknown; month?: unknown; templateId?: unknown;
  };
  const parsedClientId = parseClientId(clientId);
  if (parsedClientId === null) return null;
  let parsedTemplate: string | null = null;
  if (templateId !== undefined && templateId !== null) {
    if (typeof templateId !== "string" || !UUID_RE.test(templateId)) return null;
    parsedTemplate = templateId;
  }
  return { clientId: parsedClientId, month: String(month ?? ""), templateId: parsedTemplate };
}
```

- [ ] **Step 5: Testes RED do lookup no generate**

Acrescentar em `generate.test.ts` (usar o helper `makeDb` existente; ele responde a MESMA linha para a tabela independente dos filtros, então os cenários controlam por presença/forma da linha):

```ts
Deno.test("templateId de outro workspace: not_found", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    report_templates: { id: "t1", conta_id: "OUTRA", layout: { version: 1, blocks: [] } },
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
  });
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "c", 1, "2026-07", "b3b2a6a0-1111-4222-8333-444455556666");
  } catch (e) { err = e; }
  assert(err instanceof GenerateError && err.code === "not_found");
});

Deno.test("templateId com layout inválido: invalid_template", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    report_templates: { id: "t1", conta_id: "c", layout: { version: 99, blocks: [] } },
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
  });
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "c", 1, "2026-07", "b3b2a6a0-1111-4222-8333-444455556666");
  } catch (e) { err = e; }
  assert(err instanceof GenerateError && err.code === "invalid_template");
});

Deno.test("templateId válido: layout do documento nasce do template com IA preenchida", async () => {
  const tplLayout = {
    version: 1,
    accent: "#9f1239",
    blocks: [
      { id: "c1", type: "cover", size: "full" },
      { id: "s1", type: "ai_summary", size: "full" },
      { id: "r1", type: "ai_recommendations", size: "full" },
    ],
  };
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    report_templates: { id: "t1", conta_id: "c", layout: tplLayout },
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
    instagram_posts: [],
    instagram_follower_history: [],
  });
  await generateReportDocument(db, deps, "c", 1, "2026-07", "b3b2a6a0-1111-4222-8333-444455556666");
  const inserted = db.inserts[0] as { layout: { accent?: string; blocks: Array<{ id: string; type: string; text?: unknown }> } };
  assertEquals(inserted.layout.accent, "#9f1239");
  const ids = inserted.layout.blocks.map((b) => b.id);
  // sem IA (geminiKey vazio): ai_summary vira fallback COM texto; ai_recommendations é removido
  assert(ids.includes("c1") && ids.includes("s1"));
  assert(!ids.includes("r1"));
  const summary = inserted.layout.blocks.find((b) => b.id === "s1");
  assert(summary?.text !== undefined);
});

Deno.test("sem templateId e sem default: layout padrão do sistema", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    report_templates: null,
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
    instagram_posts: [],
    instagram_follower_history: [],
  });
  await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  const inserted = db.inserts[0] as { layout: { blocks: Array<{ type: string }> } };
  assert(inserted.layout.blocks.some((b) => b.type === "cover"));
});
```

Atualizar TODAS as chamadas existentes de `generateReportDocument` nos testes para o novo parâmetro (`, null` no fim). Isso é mudança de contrato: grep o arquivo inteiro.

- [ ] **Step 6: Rodar e ver falhar** — `npm run test:functions -- --filter "templateId"`. Esperado: FAIL (assinatura sem templateId).

- [ ] **Step 7: Implementar o lookup**

Em `generate.ts`:

```ts
import { validateLayout, type ReportLayout } from "../_shared/report-docs/layout.ts";
```

Assinatura: `generateReportDocument(db, deps, contaId, clientId, month, templateId: string | null)`.

Logo APÓS o check de entitlement (linha do `effectivePlanFeature`), inserir:

```ts
  // Layout base: template explícito > default do workspace > padrão do sistema
  // (spec §5 passo 3). Template explícito inválido é erro do request; default
  // inválido só degrada com warn (o usuário não pediu esse template pelo nome).
  let templateLayout: ReportLayout | null = null;
  if (templateId) {
    const { data: tpl } = await db.from("report_templates")
      .select("id, conta_id, layout").eq("id", templateId).maybeSingle();
    if (!tpl || tpl.conta_id !== contaId) throw new GenerateError("not_found");
    const check = validateLayout(tpl.layout);
    if (!check.ok) throw new GenerateError("invalid_template");
    templateLayout = check.layout;
  } else {
    const { data: tpl } = await db.from("report_templates")
      .select("id, conta_id, layout").eq("conta_id", contaId)
      .eq("is_default", true).maybeSingle();
    if (tpl) {
      const check = validateLayout(tpl.layout);
      if (check.ok) templateLayout = check.layout;
      else console.warn("[report-docs] template default com layout inválido; usando o padrão do sistema");
    }
  }
```

E na montagem final, trocar o `buildDefaultLayout(...)` direto por:

```ts
  const baseLayout = templateLayout ?? buildDefaultLayout({
    hasAi: recsDoc !== null,
    hasAudience: snapshot.audience !== null,
    hasBestTimes: snapshot.best_times.length > 0,
    hasTags: snapshot.tags_performance.length > 0,
  });
  const layout = fillAiBlocks(baseLayout, {
    summary: summaryDoc, recommendations: recsDoc, goals: goalsDoc,
  });
```

Em `index.ts`, passar o parâmetro: `parsed.templateId` como sexto argumento, e mapear o erro novo no catch:

```ts
      if (err.code === "invalid_template") return json({ error: "invalid_template" }, 400);
```

(na cadeia existente de `GenerateError`, antes do fallback `not_found`).

- [ ] **Step 8: Rodar os testes** — `npm run test:functions -- --filter "template"` e depois o arquivo inteiro de generate. Esperado: PASS. Depois `git checkout -- deno.lock`.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/report-docs/
git commit -m "feat(relatorios): geração aceita template explícito com fallback no default do workspace"
```

---

### Task 3: Módulo compartilhado do print token (HMAC)

**Files:**
- Create: `supabase/functions/_shared/report-docs/print-token.ts`
- Test: `supabase/functions/_shared/report-docs/print-token.test.ts`

**Interfaces:**
- Produces: `signPrintToken(docId: string, expEpochS: number, secret: string): Promise<string>` e `verifyPrintToken(token: string, docId: string, nowEpochS: number, secret: string): Promise<boolean>`. Consumidos pela Task 5 (assinar) e Task 6 (verificar).

- [ ] **Step 1: Testes RED**

```ts
// supabase/functions/_shared/report-docs/print-token.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { signPrintToken, verifyPrintToken } from "./print-token.ts";

const SECRET = "test-secret";

Deno.test("round-trip: token assinado verifica para o mesmo docId dentro do prazo", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  assert(await verifyPrintToken(t, "doc-1", 999_999, SECRET));
});

Deno.test("expirado: exp <= now falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  assertEquals(await verifyPrintToken(t, "doc-1", 1_000_000, SECRET), false);
});

Deno.test("docId diferente falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  assertEquals(await verifyPrintToken(t, "doc-2", 1, SECRET), false);
});

Deno.test("assinatura adulterada falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  const [payload] = t.split(".");
  assertEquals(await verifyPrintToken(`${payload}.AAAA`, "doc-1", 1, SECRET), false);
});

Deno.test("payload adulterado falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  const sig = t.split(".")[1];
  const forged = btoa(JSON.stringify({ docId: "doc-1", exp: 9_999_999_999 }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(await verifyPrintToken(`${forged}.${sig}`, "doc-1", 1, SECRET), false);
});

Deno.test("segredo diferente falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  assertEquals(await verifyPrintToken(t, "doc-1", 1, "outro"), false);
});

Deno.test("malformado (sem ponto, base64 inválido) devolve false sem lançar", async () => {
  assertEquals(await verifyPrintToken("garbage", "doc-1", 1, SECRET), false);
  assertEquals(await verifyPrintToken("a.b", "doc-1", 1, SECRET), false);
  assertEquals(await verifyPrintToken(".", "doc-1", 1, SECRET), false);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:functions -- --filter "print"`. Esperado: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/report-docs/print-token.ts
// Print token HMAC do export de PDF (spec §9): payload {docId, exp} assinado
// com INTERNAL_FUNCTION_SECRET, sem estado no banco. Independente do token de
// portal do Hub: relatórios são entitlement próprio (feature_analytics_reports).
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const padded = norm.padEnd(norm.length + ((4 - (norm.length % 4)) % 4), "=");
    const bin = atob(padded);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages,
  );
}

export async function signPrintToken(
  docId: string, expEpochS: number, secret: string,
): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ docId, exp: expEpochS })));
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyPrintToken(
  token: string, docId: string, nowEpochS: number, secret: string,
): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const payloadB64 = token.slice(0, dot);
  const sigBytes = b64urlDecode(token.slice(dot + 1));
  if (!sigBytes || sigBytes.length === 0) return false;
  const key = await hmacKey(secret, ["verify"]);
  // crypto.subtle.verify é comparação em tempo constante.
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payloadB64));
  if (!ok) return false;
  const payloadBytes = b64urlDecode(payloadB64);
  if (!payloadBytes) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      docId?: unknown; exp?: unknown;
    };
    return parsed.docId === docId && typeof parsed.exp === "number" && parsed.exp > nowEpochS;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Rodar os testes** — PASS. `git checkout -- deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-docs/print-token.ts supabase/functions/_shared/report-docs/print-token.test.ts
git commit -m "feat(relatorios): print token HMAC para o export de PDF"
```

---

### Task 4: Refactor snapshot-source + rotas refresh-data e DELETE

**Files:**
- Create: `supabase/functions/report-docs/snapshot-source.ts`, `supabase/functions/report-docs/refresh.ts`, `supabase/functions/report-docs/delete-doc.ts`
- Modify: `supabase/functions/report-docs/generate.ts`, `supabase/functions/report-docs/index.ts`
- Test: `supabase/functions/report-docs/refresh.test.ts`, `supabase/functions/report-docs/delete-doc.test.ts` (e generate.test.ts continua verde sem mudança de asserção)

**Interfaces:**
- Consumes: `GenerateError`/`DocActionError` de `./errors.ts`; `assembleSnapshot`, `cachePostThumbnail` etc. hoje inline em `generate.ts`.
- Produces:
  - `loadClientSnapshot(db, deps: { fetch: typeof fetch; storage: ThumbnailStorage }, contaId: string, cliente: { id: number; especialidade: string | null }, month: string): Promise<{ snapshot: ReportDocSnapshot; igAccountId: string }>` — lança `GenerateError("not_found")` sem conta IG.
  - `refreshReportDocument(db, deps, contaId: string, docId: string): Promise<void>` — lança `DocActionError("not_found")`.
  - `deleteReportDocument(db, contaId: string, docId: string): Promise<void>` — idem.

- [ ] **Step 1: Extrair `snapshot-source.ts`**

Mover de `generate.ts` para o arquivo novo TODO o trecho entre o lookup de `instagram_accounts` (inclusive) e o `assembleSnapshot(...)` (inclusive) — ou seja: lookup da conta IG, as 10 queries paralelas, os guards de fonte obrigatória/opcional (`warnQueryError`), o cache de thumbnails e a montagem. A função:

```ts
// supabase/functions/report-docs/snapshot-source.ts
// Snapshot de dados de um cliente/mês: extraído de generate.ts para ser
// compartilhado com POST /:id/refresh-data (spec §5). Puro quanto a decisões:
// quem chama já validou ownership do cliente e entitlement.
import { GenerateError } from "./errors.ts";
// ... imports movidos de generate.ts (mappers, thumbnail-cache, month-window,
// snapshot, types) ...

export async function loadClientSnapshot(
  db: Db,
  deps: { fetch: typeof fetch; storage: ThumbnailStorage },
  contaId: string,
  cliente: { id: number; especialidade: string | null },
  month: string,
): Promise<{ snapshot: ReportDocSnapshot; igAccountId: string }> {
  // corpo movido de generate.ts, byte a byte onde possível;
  // `clientId` vira `cliente.id`; retorna { snapshot, igAccountId }.
}
```

`generate.ts` passa a chamar `const { snapshot, igAccountId } = await loadClientSnapshot(db, deps, contaId, { id: cliente.id, especialidade: cliente.especialidade }, month);` no lugar do bloco movido. NENHUMA asserção de `generate.test.ts` deve mudar neste step (refactor puro; rodar o arquivo e confirmar verde é o teste do step).

- [ ] **Step 2: Testes RED do refresh**

```ts
// supabase/functions/report-docs/refresh.test.ts
import { assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { refreshReportDocument } from "./refresh.ts";
import { DocActionError } from "./errors.ts";
// Reaproveitar o idioma makeDb de generate.test.ts, acrescentando ao fake:
// - tabela report_documents com um `update` gravado em db.updates
// - a linha do doc devolvida no maybeSingle

Deno.test("doc de outro workspace: not_found", async () => {
  const db = makeDb({
    report_documents: { id: "d1", conta_id: "OUTRA", client_id: 1, period_start: "2026-07-01" },
  });
  let err: unknown;
  try { await refreshReportDocument(db, deps, "c", "d1"); } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "not_found");
});

Deno.test("refresh re-snapshota e grava data_snapshot sem tocar layout", async () => {
  const db = makeDb({
    report_documents: { id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01" },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    instagram_posts: [],
    instagram_follower_history: [],
    workspaces: { name: "W", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await refreshReportDocument(db, deps, "c", "d1");
  assert(db.updates.length === 1);
  const patch = db.updates[0] as { data_snapshot?: unknown; layout?: unknown };
  assert(patch.data_snapshot !== undefined);
  assert(patch.layout === undefined);
});
```

O fake precisa de `updates`: no `makeDb` local do arquivo, `from("report_documents")` devolve `{ select: ... maybeSingle -> a linha, update: (patch) => { updates.push(patch); return chain({ id: "d1" }); } }`. Escreva um `makeDb` próprio do arquivo (não importe o de generate.test.ts: ele não é exportado; duplicação de helper de teste entre arquivos é o padrão da suíte).

- [ ] **Step 3: Rodar e ver falhar**, depois implementar:

```ts
// supabase/functions/report-docs/refresh.ts
// POST /:id/refresh-data (spec §5): re-snapshot de dados + branding mantendo o
// layout. ai_content e blocos de texto NÃO são tocados; o updated_at bumpa via
// trigger (data_snapshot muda), o que corretamente invalida o cache do PDF.
import { DocActionError, GenerateError } from "./errors.ts";
import { loadClientSnapshot } from "./snapshot-source.ts";
// deno-lint-ignore no-explicit-any
type Db = any;

export async function refreshReportDocument(
  db: Db,
  deps: Parameters<typeof loadClientSnapshot>[1],
  contaId: string,
  docId: string,
): Promise<void> {
  const { data: doc } = await db.from("report_documents")
    .select("id, conta_id, client_id, period_start")
    .eq("id", docId).maybeSingle();
  if (!doc || doc.conta_id !== contaId) throw new DocActionError("not_found");

  const { data: cliente } = await db.from("clientes")
    .select("id, conta_id, especialidade")
    .eq("id", doc.client_id).maybeSingle();
  if (!cliente || cliente.conta_id !== contaId) throw new DocActionError("not_found");

  const month = String(doc.period_start).slice(0, 7);
  let snapshot;
  try {
    ({ snapshot } = await loadClientSnapshot(
      db, deps, contaId, { id: cliente.id, especialidade: cliente.especialidade }, month,
    ));
  } catch (err) {
    if (err instanceof GenerateError) throw new DocActionError("not_found", err.message);
    throw err;
  }

  const { error } = await db.from("report_documents")
    .update({ data_snapshot: snapshot }).eq("id", docId);
  if (error) throw new Error(`refresh update failed: ${error.message}`);
}
```

- [ ] **Step 4: Testes RED do delete + implementar**

```ts
// supabase/functions/report-docs/delete-doc.test.ts — casos:
// 1. doc de outro workspace: not_found, storage.remove NÃO chamado.
// 2. doc com pdf_storage_path: storage.remove chamado com [path] no bucket
//    "analytics-reports" e depois delete da linha.
// 3. doc sem pdf_storage_path: nenhum remove; delete da linha.
// 4. storage.remove rejeita: warn e a linha AINDA é deletada (órfão aceito,
//    spec §5 DELETE).
// Fake: db.from("report_documents") com maybeSingle + delete gravado;
// storage fake { from: (bucket) => ({ remove: (paths) => ... }) } gravando chamadas.
```

```ts
// supabase/functions/report-docs/delete-doc.ts
// DELETE /:id (spec §5): remove o objeto PDF e a linha. Deleção SÓ por aqui
// (authenticated não tem grant de DELETE), para não deixar PDF órfão; órfão
// residual de crash entre os dois passos é aceito até a varredura do deprecate.
import { DocActionError, PDF_BUCKET } from "./errors.ts";
// deno-lint-ignore no-explicit-any
type Db = any;

export async function deleteReportDocument(
  db: Db,
  storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<{ error: { message: string } | null }> } },
  contaId: string,
  docId: string,
): Promise<void> {
  const { data: doc } = await db.from("report_documents")
    .select("id, conta_id, pdf_storage_path")
    .eq("id", docId).maybeSingle();
  if (!doc || doc.conta_id !== contaId) throw new DocActionError("not_found");

  if (doc.pdf_storage_path) {
    const { error } = await storage.from(PDF_BUCKET).remove([doc.pdf_storage_path]);
    if (error) console.warn(`[report-docs] remoção do PDF falhou (segue o delete): ${error.message}`);
  }
  const { error: delError } = await db.from("report_documents").delete().eq("id", docId);
  if (delError) throw new Error(`delete failed: ${delError.message}`);
}
```

- [ ] **Step 5: Rotear em `index.ts`**

Depois do bloco de `/generate`, antes do 404:

```ts
    const docMatch = path.match(/^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/(pdf|refresh-data))?$/i);
    if (docMatch) {
      const docId = docMatch[1];
      const action = docMatch[3];
      if (req.method === "POST" && action === "refresh-data") {
        const allowed = await checkRateLimit(serviceClient, `report-docs:${contaId}`, 20, 3600);
        if (!allowed) return json({ error: "Rate limit exceeded" }, 429);
        await refreshReportDocument(
          serviceClient,
          { fetch, storage: serviceClient.storage },
          contaId,
          docId,
        );
        return json({ ok: true });
      }
      if (req.method === "DELETE" && !action) {
        await deleteReportDocument(serviceClient, serviceClient.storage, contaId, docId);
        return json({ ok: true });
      }
      // POST /:id/pdf chega na Task 5.
    }
```

E no catch, mapear `DocActionError`:

```ts
    if (err instanceof DocActionError) {
      if (err.code === "pdf_not_configured") return json({ error: "pdf_not_configured" }, 503);
      if (err.code === "pdf_failed") return json({ error: "pdf_failed" }, 502);
      return json({ error: "not_found" }, 404);
    }
```

- [ ] **Step 6: Rodar todos os testes de report-docs** — `npm run test:functions` (arquivo inteiro verde, incluindo generate). `git checkout -- deno.lock`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/report-docs/
git commit -m "feat(relatorios): rotas refresh-data e DELETE com snapshot compartilhado"
```

---

### Task 5: Export de PDF: módulo Gotenberg convert/url + rota `POST /:id/pdf`

**Files:**
- Create: `supabase/functions/_shared/report-template/pdf-url.ts`, `supabase/functions/report-docs/pdf.ts`
- Modify: `supabase/functions/report-docs/index.ts`, `CLAUDE.md` (seção de env vars das edge functions)
- Test: `supabase/functions/_shared/report-template/pdf-url.test.ts`, `supabase/functions/report-docs/pdf.test.ts`

**Interfaces:**
- Consumes: `signPrintToken` (Task 3), `DocActionError` (Task 2), trigger condicional (Task 1).
- Produces:
  - `buildGotenbergUrlRequest(pageUrl: string, gotenbergUrl: string): { url: string; formData: FormData }`
  - `convertUrlToPdf(pageUrl: string, gotenbergUrl: string, fetchImpl?: typeof fetch): Promise<Uint8Array>`
  - `exportReportPdf(db, deps: PdfDeps, contaId: string, docId: string): Promise<{ url: string }>` com `PDF_RENDERER_VERSION = 1`
  - Rota `POST /report-docs/:id/pdf` respondendo `{ url }`, `503 pdf_not_configured`, `502 pdf_failed`, `404`.
- A URL de print gerada é `${REPORT_PRINT_BASE}/relatorios/print/${docId}?pt=${token}` (contrato com Tasks 6 e 11).

- [ ] **Step 1: Testes RED do módulo Gotenberg**

```ts
// supabase/functions/_shared/report-template/pdf-url.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildGotenbergUrlRequest } from "./pdf-url.ts";

Deno.test("convert/url: endpoint, url alvo e waitForExpression de prontidão", () => {
  const { url, formData } = buildGotenbergUrlRequest("https://x.test/relatorios/print/d1?pt=t", "https://g.test");
  assertEquals(url, "https://g.test/forms/chromium/convert/url");
  assertEquals(formData.get("url"), "https://x.test/relatorios/print/d1?pt=t");
  assertEquals(formData.get("waitForExpression"), "window.__REPORT_READY === true");
  assertEquals(formData.get("printBackground"), "true");
  // A4 explícito: o default do chromium é Letter.
  assertEquals(formData.get("paperWidth"), "8.27");
  assertEquals(formData.get("paperHeight"), "11.7");
  assert(formData.get("marginTop") !== null);
});
```

- [ ] **Step 2: Implementar `pdf-url.ts`**

```ts
// supabase/functions/_shared/report-template/pdf-url.ts
// Variante convert/url do Gotenberg para o relatório de blocos (spec §9):
// imprime a página /print do Hub esperando o contrato window.__REPORT_READY,
// nunca delay cego. O pdf.ts (convert/html do template A4 legado) fica intocado.
export function buildGotenbergUrlRequest(
  pageUrl: string,
  gotenbergUrl: string,
): { url: string; formData: FormData } {
  const url = `${gotenbergUrl}/forms/chromium/convert/url`;
  const formData = new FormData();
  formData.append("url", pageUrl);
  formData.append("waitForExpression", "window.__REPORT_READY === true");
  formData.append("printBackground", "true");
  // Documento contínuo em A4 com margens: sem o pin de bleed do template
  // legado (ver _shared/report-template/pdf.ts para aquela história).
  formData.append("paperWidth", "8.27");
  formData.append("paperHeight", "11.7");
  formData.append("marginTop", "0.4");
  formData.append("marginBottom", "0.4");
  formData.append("marginLeft", "0.35");
  formData.append("marginRight", "0.35");
  return { url, formData };
}

const GOTENBERG_TIMEOUT_MS = 60_000;

export async function convertUrlToPdf(
  pageUrl: string,
  gotenbergUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const { url, formData } = buildGotenbergUrlRequest(pageUrl, gotenbergUrl);
  const res = await fetchImpl(url, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(GOTENBERG_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "unknown error");
    throw new Error(`Gotenberg URL conversion failed (${res.status}): ${body}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
```

- [ ] **Step 3: Testes RED da rota**

```ts
// supabase/functions/report-docs/pdf.test.ts — casos (fake db com updates +
// storage fake com upload/createSignedUrl gravados; deps.convert injetável):
// 1. doc de outro workspace: not_found.
// 2. doc status != ready: not_found.
// 3. env incompleta (gotenbergUrl vazio): pdf_not_configured, SEM chamada de convert.
// 4. cache válido (pdf_storage_path setado, pdf_generated_at > updated_at,
//    pdf_renderer_version === PDF_RENDERER_VERSION): retorna signed URL SEM convert.
// 5. cache inválido por updated_at mais novo: convert chamado; upload com
//    upsert no path docs/{conta}/{doc}.pdf; update grava pdf_storage_path,
//    pdf_generated_at e pdf_renderer_version; retorna signed URL.
// 6. cache inválido por pdf_renderer_version diferente: convert chamado.
// 7. convert lança: DocActionError pdf_failed; NENHUM update gravado.
// A URL passada ao convert deve casar com
//   `${printBase}/relatorios/print/${docId}?pt=` e o sufixo deve verificar com
//   verifyPrintToken(token, docId, nowEpochS, secret) === true.
```

Escrever os 7 casos de verdade no arquivo, no idioma makeDb local (mesmo padrão da Task 4).

- [ ] **Step 4: Implementar `pdf.ts`**

```ts
// supabase/functions/report-docs/pdf.ts
// POST /:id/pdf (spec §5/§9). Cache: serve o PDF existente só se
// pdf_generated_at >= updated_at E pdf_renderer_version bate — updated_at NÃO
// bumpa em escrita de pdf_* (trigger condicional da migration 20260821000010).
// Janela aceita: edição DURANTE a conversão pode ficar fora do PDF até a
// próxima edição (o updated_at dela é anterior ao pdf_generated_at gravado).
import { DocActionError, PDF_BUCKET } from "./errors.ts";
import { signPrintToken } from "../_shared/report-docs/print-token.ts";
import { convertUrlToPdf } from "../_shared/report-template/pdf-url.ts";

export const PDF_RENDERER_VERSION = 1;
const PRINT_TOKEN_TTL_S = 600;
const SIGNED_URL_TTL_S = 3600;

export interface PdfDeps {
  convert: typeof convertUrlToPdf;
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean }) =>
        Promise<{ error: { message: string } | null }>;
      createSignedUrl: (path: string, ttl: number) =>
        Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
  now: () => Date;
  env: { gotenbergUrl: string; printBase: string; internalSecret: string };
}

// deno-lint-ignore no-explicit-any
type Db = any;

export async function exportReportPdf(
  db: Db,
  deps: PdfDeps,
  contaId: string,
  docId: string,
): Promise<{ url: string }> {
  const { data: doc } = await db.from("report_documents")
    .select("id, conta_id, status, updated_at, pdf_storage_path, pdf_generated_at, pdf_renderer_version")
    .eq("id", docId).maybeSingle();
  if (!doc || doc.conta_id !== contaId || doc.status !== "ready") {
    throw new DocActionError("not_found");
  }

  const bucket = deps.storage.from(PDF_BUCKET);
  const cacheFresh = doc.pdf_storage_path &&
    doc.pdf_generated_at &&
    new Date(doc.pdf_generated_at).getTime() >= new Date(doc.updated_at).getTime() &&
    doc.pdf_renderer_version === PDF_RENDERER_VERSION;
  if (cacheFresh) {
    const { data: signed, error } = await bucket.createSignedUrl(doc.pdf_storage_path, SIGNED_URL_TTL_S);
    if (!error && signed?.signedUrl) return { url: signed.signedUrl };
    // objeto sumiu do bucket: cai no caminho de regeneração
  }

  const { gotenbergUrl, printBase, internalSecret } = deps.env;
  if (!gotenbergUrl || !printBase || !internalSecret) {
    throw new DocActionError("pdf_not_configured");
  }

  const nowMs = deps.now().getTime();
  const token = await signPrintToken(docId, Math.floor(nowMs / 1000) + PRINT_TOKEN_TTL_S, internalSecret);
  const pageUrl = `${printBase.replace(/\/$/, "")}/relatorios/print/${docId}?pt=${encodeURIComponent(token)}`;

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await deps.convert(pageUrl, gotenbergUrl);
  } catch (err) {
    console.error("[report-docs] conversão de PDF falhou:", err);
    throw new DocActionError("pdf_failed");
  }

  const path = `docs/${doc.conta_id}/${doc.id}.pdf`;
  const { error: upError } = await bucket.upload(path, pdfBytes, {
    contentType: "application/pdf", upsert: true,
  });
  if (upError) {
    console.error("[report-docs] upload do PDF falhou:", upError.message);
    throw new DocActionError("pdf_failed");
  }

  const { error: updError } = await db.from("report_documents").update({
    pdf_storage_path: path,
    pdf_generated_at: new Date(nowMs).toISOString(),
    pdf_renderer_version: PDF_RENDERER_VERSION,
  }).eq("id", docId);
  if (updError) throw new Error(`pdf metadata update failed: ${updError.message}`);

  const { data: signed, error: signError } = await bucket.createSignedUrl(path, SIGNED_URL_TTL_S);
  if (signError || !signed?.signedUrl) throw new DocActionError("pdf_failed");
  return { url: signed.signedUrl };
}
```

- [ ] **Step 5: Rotear em `index.ts`**

No `docMatch` da Task 4, antes do comentário placeholder:

```ts
      if (req.method === "POST" && action === "pdf") {
        const allowed = await checkRateLimit(serviceClient, `report-docs-pdf:${contaId}`, 30, 3600);
        if (!allowed) return json({ error: "Rate limit exceeded" }, 429);
        const result = await exportReportPdf(serviceClient, {
          convert: convertUrlToPdf,
          storage: serviceClient.storage,
          now: () => new Date(),
          env: {
            gotenbergUrl: Deno.env.get("GOTENBERG_URL") ?? "",
            printBase: Deno.env.get("REPORT_PRINT_BASE") ?? "",
            internalSecret: Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
          },
        }, contaId, docId);
        return json(result);
      }
```

- [ ] **Step 6: Documentar env em `CLAUDE.md`** — na lista de env vars das edge functions, acrescentar:

```
- `REPORT_PRINT_BASE` -- origem pública que serve a página de print do relatório
  de blocos (ex.: https://mesaas.com.br). Usada por report-docs POST /:id/pdf
  para montar a URL que o Gotenberg imprime. Opcional: sem ela (ou sem
  GOTENBERG_URL / INTERNAL_FUNCTION_SECRET) o export responde 503
  pdf_not_configured; as demais rotas seguem normais
```

- [ ] **Step 7: Rodar todos os testes de functions** — verde; `git checkout -- deno.lock`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/ CLAUDE.md
git commit -m "feat(relatorios): export de PDF via Gotenberg convert/url com cache e print token"
```

---

### Task 6: Edge function `hub-report-docs` (lista união, doc, print-doc)

**Files:**
- Create: `supabase/functions/hub-report-docs/index.ts`, `supabase/functions/hub-report-docs/handlers.ts`
- Test: `supabase/functions/hub-report-docs/handlers.test.ts`

**Interfaces:**
- Consumes: `resolveHubToken` de `../_shared/hub-token.ts` (impõe `feature_hub_portal`); `verifyPrintToken` (Task 3); `buildCorsHeaders`.
- Produces (contrato com Tasks 10-11):
  - `GET /hub-report-docs/list?token=` → `{ items: HubReportListItem[] }` com `HubReportListItem = { kind: "legacy", month, status, generated_at, has_pdf, has_html } | { kind: "doc", id, title, month, generated_at }` ordenado por `month` desc.
  - `GET /hub-report-docs/doc/:id?token=` → `{ doc: { id, title, layout, data_snapshot, period_start } }` (404 se o doc não é DO CLIENTE do token, mesmo sendo do mesmo workspace).
  - `GET /hub-report-docs/print-doc/:id?pt=` → mesmo payload, auth SÓ pelo HMAC (sem token de portal, sem `feature_hub_portal`).

- [ ] **Step 1: Testes RED dos handlers**

```ts
// supabase/functions/hub-report-docs/handlers.test.ts — casos:
// listHandler:
// 1. União: 1 legado ready + 2 docs ready => 3 itens, kinds corretos, ordenado
//    por month desc; month do doc = period_start.slice(0,7); generated_at do
//    doc = created_at.
// 2. Docs não-ready ficam de fora.
// docHandler (hubToken = { cliente_id: 7, conta_id: "ws" }):
// 3. Doc do cliente do token: retorna payload com layout e data_snapshot.
// 4. Doc de OUTRO cliente do MESMO workspace: null (spec §9 — cadeia inteira).
// 5. Doc de outro workspace: null.
// printDocHandler:
// 6. Token HMAC válido para o docId: payload.
// 7. Token expirado ou de outro docId: null (sem query? query permitida, mas
//    payload nunca sai; asserte null).
// 8. Doc não-ready: null mesmo com token válido.
// Fake db: from(tabela) devolvendo listas/linhas por tabela (idioma makeDb).
```

Escrever os 8 casos com asserções concretas.

- [ ] **Step 2: Implementar `handlers.ts`**

```ts
// supabase/functions/hub-report-docs/handlers.ts
// Handlers puros da função (injetam db) para teste sem Deno.serve.
import { verifyPrintToken } from "../_shared/report-docs/print-token.ts";
import type { HubToken } from "../_shared/hub-token.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type HubReportListItem =
  | { kind: "legacy"; month: string; status: string; generated_at: string | null; has_pdf: boolean; has_html: boolean }
  | { kind: "doc"; id: string; title: string; month: string; generated_at: string };

export async function listHandler(db: Db, hubToken: HubToken): Promise<HubReportListItem[]> {
  const [{ data: legacy }, { data: docs }] = await Promise.all([
    db.from("analytics_reports")
      .select("report_month, status, generated_at, storage_path, html_storage_path")
      .eq("client_id", hubToken.cliente_id).eq("conta_id", hubToken.conta_id)
      .eq("status", "ready"),
    db.from("report_documents")
      .select("id, title, period_start, created_at")
      .eq("client_id", hubToken.cliente_id).eq("conta_id", hubToken.conta_id)
      .eq("status", "ready"),
  ]);
  const items: HubReportListItem[] = [
    ...((docs ?? []).map((d: { id: string; title: string; period_start: string; created_at: string }) => ({
      kind: "doc" as const,
      id: d.id,
      title: d.title,
      month: String(d.period_start).slice(0, 7),
      generated_at: d.created_at,
    }))),
    ...((legacy ?? []).map((r: { report_month: string; status: string; generated_at: string | null; storage_path: string | null; html_storage_path: string | null }) => ({
      kind: "legacy" as const,
      month: r.report_month,
      status: r.status,
      generated_at: r.generated_at,
      has_pdf: !!r.storage_path,
      has_html: !!r.html_storage_path,
    }))),
  ];
  return items.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
}

export interface HubReportDocPayload {
  id: string; title: string; layout: unknown; data_snapshot: unknown; period_start: string;
}

async function loadReadyDoc(db: Db, docId: string): Promise<
  (HubReportDocPayload & { client_id: number; conta_id: string }) | null
> {
  const { data } = await db.from("report_documents")
    .select("id, title, layout, data_snapshot, period_start, client_id, conta_id, status")
    .eq("id", docId).maybeSingle();
  if (!data || data.status !== "ready") return null;
  return data;
}

export async function docHandler(
  db: Db, hubToken: HubToken, docId: string,
): Promise<HubReportDocPayload | null> {
  const doc = await loadReadyDoc(db, docId);
  // Cadeia inteira (spec §9): documento de outro cliente do MESMO workspace = 404.
  if (!doc || doc.client_id !== hubToken.cliente_id || doc.conta_id !== hubToken.conta_id) {
    return null;
  }
  const { client_id: _c, conta_id: _w, ...payload } = doc;
  return payload;
}

export async function printDocHandler(
  db: Db, secret: string, docId: string, pt: string, nowEpochS: number,
): Promise<HubReportDocPayload | null> {
  if (!secret || !(await verifyPrintToken(pt, docId, nowEpochS, secret))) return null;
  const doc = await loadReadyDoc(db, docId);
  if (!doc) return null;
  const { client_id: _c, conta_id: _w, ...payload } = doc;
  return payload;
}
```

- [ ] **Step 3: Implementar `index.ts`** (padrão de `hub-reports/index.ts`):

```ts
// supabase/functions/hub-report-docs/index.ts
// Hub do relatório de blocos (spec §9). Deploy OBRIGATÓRIO com --no-verify-jwt:
// /list e /doc autenticam por token de portal (resolveHubToken, que impõe
// feature_hub_portal); /print-doc autentica SÓ pelo print token HMAC — export
// de PDF é entitlement de relatórios, independente do portal.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { docHandler, listHandler, printDocHandler } from "./handlers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_FUNCTION_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/hub-report-docs", "");
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (path.startsWith("/print-doc/")) {
      const docId = path.slice("/print-doc/".length);
      const pt = url.searchParams.get("pt") ?? "";
      if (!UUID_RE.test(docId) || !pt) return json({ error: "Not found" }, 404);
      const doc = await printDocHandler(
        db, INTERNAL_FUNCTION_SECRET, docId, pt, Math.floor(Date.now() / 1000),
      );
      return doc ? json({ doc }) : json({ error: "Not found" }, 404);
    }

    const token = url.searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);
    const hubToken = await resolveHubToken(db, token, new Date().toISOString());
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    if (path === "/list" || path === "/list/") {
      return json({ items: await listHandler(db, hubToken) });
    }
    if (path.startsWith("/doc/")) {
      const docId = path.slice("/doc/".length);
      if (!UUID_RE.test(docId)) return json({ error: "Not found" }, 404);
      const doc = await docHandler(db, hubToken, docId);
      return doc ? json({ doc }) : json({ error: "Not found" }, 404);
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("[hub-report-docs] unexpected error", err);
    return json({ error: "Internal server error" }, 500);
  }
});
```

- [ ] **Step 4: Rodar os testes** — verde; `git checkout -- deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-report-docs/
git commit -m "feat(relatorios): hub-report-docs com lista uniao, doc por token e print-doc por HMAC"
```

---

### Task 7: CRM: serviço de templates + operações puras de template

**Files:**
- Create: `apps/crm/src/services/reportTemplates.ts`, `apps/crm/src/pages/relatorio-editor/templateOps.ts`
- Test: `apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts`, `apps/crm/src/services/__tests__/reportTemplates.test.ts` (se `services/__tests__` não existir, criar; siga o padrão de mocking de supabase dos testes de serviço existentes — grep `vi.mock` em `apps/crm/src/services`)

**Interfaces:**
- Consumes: `supabase` de `../lib/supabase`; tipos de `@mesaas/report-blocks/types`; RPC `set_default_report_template` (migration do PR 1). Precedente direto: `briefing_templates` em `apps/crm/src/store/hub.ts:357-396`.
- Produces:
  - `ReportTemplateRow { id: string; name: string; layout: ReportLayout; is_default: boolean; created_at: string }`
  - `listReportTemplates(): Promise<ReportTemplateRow[]>`, `createReportTemplate(name: string, layout: ReportLayout): Promise<ReportTemplateRow>`, `deleteReportTemplate(id: string): Promise<void>`, `setDefaultReportTemplate(id: string): Promise<void>`
  - `stripAiTextForTemplate(layout: ReportLayout): ReportLayout` e `applyTemplateLayout(template: ReportLayout, current: ReportLayout): ReportLayout` (puras, imutáveis)

- [ ] **Step 1: Testes RED de `templateOps`**

```ts
// apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts
import { describe, expect, it } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import { applyTemplateLayout, stripAiTextForTemplate } from '../templateOps';

const doc = (label: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }] });

describe('stripAiTextForTemplate', () => {
  it('remove text dos blocos ai_ e preserva blocos text, config e accent', () => {
    const layout: ReportLayout = {
      version: 1,
      accent: '#9f1239',
      blocks: [
        { id: 't1', type: 'text', size: 'full', text: doc('autor') },
        { id: 's1', type: 'ai_summary', size: 'full', text: doc('ia') },
        { id: 'p1', type: 'top_posts', size: 'full', config: { count: 6 } },
      ],
    };
    const out = stripAiTextForTemplate(layout);
    expect(out.accent).toBe('#9f1239');
    expect(out.blocks[0].text).toEqual(doc('autor'));
    expect(out.blocks[1].text).toBeUndefined();
    expect(out.blocks[1].id).toBe('s1');
    expect(out.blocks[2].config).toEqual({ count: 6 });
    // imutável: entrada intacta
    expect(layout.blocks[1].text).toEqual(doc('ia'));
  });
});

describe('applyTemplateLayout', () => {
  const current: ReportLayout = {
    version: 1,
    blocks: [
      { id: 'cs', type: 'ai_summary', size: 'full', text: doc('resumo atual') },
      { id: 'cg', type: 'ai_goals', size: 'full', text: doc('metas atuais') },
    ],
  };

  it('substitui o layout inteiro e herda texto de IA do mesmo tipo', () => {
    const template: ReportLayout = {
      version: 1,
      accent: '#123456',
      blocks: [
        { id: 'tc', type: 'cover', size: 'full' },
        { id: 'ts', type: 'ai_summary', size: 'half' },
      ],
    };
    const out = applyTemplateLayout(template, current);
    expect(out.accent).toBe('#123456');
    expect(out.blocks.map((b) => b.id)).toEqual(['tc', 'ts']);
    expect(out.blocks[1].text).toEqual(doc('resumo atual'));
    expect(out.blocks[1].size).toBe('half');
  });

  it('bloco de IA sem correspondente com texto no atual é removido', () => {
    const template: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'tr', type: 'ai_recommendations', size: 'full' },
        { id: 'tg', type: 'ai_goals', size: 'full' },
      ],
    };
    const out = applyTemplateLayout(template, current);
    expect(out.blocks.map((b) => b.id)).toEqual(['tg']);
    expect(out.blocks[0].text).toEqual(doc('metas atuais'));
  });

  it('template sem accent remove o accent atual (substituição completa)', () => {
    const template: ReportLayout = { version: 1, blocks: [{ id: 'x', type: 'divider', size: 'full' }] };
    const out = applyTemplateLayout(template, { ...current, accent: '#ff0000' });
    expect(out.accent).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts`.

- [ ] **Step 3: Implementar `templateOps.ts`**

```ts
// apps/crm/src/pages/relatorio-editor/templateOps.ts
// Semântica de template (spec §4): layout sem dados. Blocos text guardam o
// conteúdo do autor; blocos ai_* são regenerados por relatório, então o texto
// deles NUNCA viaja no template. Puras e imutáveis, como layoutOps.
import type { BlockType, ReportBlock, ReportLayout } from '@mesaas/report-blocks/types';

const AI_TYPES: ReadonlySet<BlockType> = new Set(['ai_summary', 'ai_recommendations', 'ai_goals']);

export function stripAiTextForTemplate(layout: ReportLayout): ReportLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((b) => {
      if (!AI_TYPES.has(b.type) || b.text === undefined) return b;
      const { text: _drop, ...rest } = b;
      return rest as ReportBlock;
    }),
  };
}

/** Aplica um template a um relatório existente: substituição completa do
 * layout. Blocos ai_* do template herdam o texto do PRIMEIRO bloco do mesmo
 * tipo com texto no layout atual; sem correspondente, o bloco sai (não há
 * conteúdo para mostrar e a IA não roda de novo aqui). */
export function applyTemplateLayout(template: ReportLayout, current: ReportLayout): ReportLayout {
  const blocks: ReportBlock[] = [];
  for (const b of template.blocks) {
    if (!AI_TYPES.has(b.type)) {
      blocks.push(b);
      continue;
    }
    const source = current.blocks.find((c) => c.type === b.type && c.text !== undefined);
    if (!source) continue;
    blocks.push({ ...b, text: source.text });
  }
  return { ...template, blocks };
}
```

- [ ] **Step 4: Rodar** — PASS.

- [ ] **Step 5: Implementar o serviço + teste**

```ts
// apps/crm/src/services/reportTemplates.ts
// CRUD de templates do relatório de blocos: PostgREST direto com RLS
// (precedente briefing_templates em store/hub.ts). Default SÓ pela RPC
// atômica set_default_report_template (índice único parcial no banco).
import { supabase } from '../lib/supabase';
import { getContaId } from '../store/core';
import type { ReportLayout } from '@mesaas/report-blocks/types';

export interface ReportTemplateRow {
  id: string;
  name: string;
  layout: ReportLayout;
  is_default: boolean;
  created_at: string;
}

export async function listReportTemplates(): Promise<ReportTemplateRow[]> {
  const { data, error } = await supabase
    .from('report_templates')
    .select('id, name, layout, is_default, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ReportTemplateRow[]) ?? [];
}

export async function createReportTemplate(
  name: string,
  layout: ReportLayout,
): Promise<ReportTemplateRow> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('report_templates')
    .insert({ conta_id, name, layout })
    .select('id, name, layout, is_default, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data as ReportTemplateRow;
}

export async function deleteReportTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('report_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setDefaultReportTemplate(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_report_template', { p_template_id: id });
  if (error) throw new Error(error.message);
}
```

Teste do serviço: mockar `supabase` (padrão dos testes de serviço existentes) e cobrir: lista ordenada devolvida; create envia `conta_id` + name + layout; setDefault chama a RPC com `p_template_id`; erro do PostgREST vira throw. Se não houver precedente de teste de serviço com mock do client, um teste de contrato mínimo basta (os fluxos completos são cobertos nos dialogs da Task 8).

- [ ] **Step 6: Rodar tudo do diretório + tsc do CRM. Commit**

```bash
git add apps/crm/src/services/reportTemplates.ts apps/crm/src/pages/relatorio-editor/templateOps.ts apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts apps/crm/src/services/__tests__/
git commit -m "feat(relatorios): servico de templates e operacoes puras de salvar/aplicar"
```

---

### Task 8: CRM: dialogs de template + integração na barra do editor

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/SaveTemplateDialog.tsx`, `apps/crm/src/pages/relatorio-editor/ApplyTemplateDialog.tsx`
- Modify: `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx`
- Test: `apps/crm/src/pages/relatorio-editor/__tests__/SaveTemplateDialog.test.tsx`, `apps/crm/src/pages/relatorio-editor/__tests__/ApplyTemplateDialog.test.tsx`

**Interfaces:**
- Consumes: Task 7 inteira; `applyLayout`/`layoutRef` do `EditorBody`; componentes `Dialog`, `Button`, `Input`, `Checkbox` (ver `apps/crm/src/components/ui/`), `DropdownMenu` de `@/components/ui/dropdown-menu`.
- Produces: `SaveTemplateDialog({ open, onOpenChange, getLayout: () => ReportLayout })`; `ApplyTemplateDialog({ open, onOpenChange, onApply: (template: ReportTemplateRow) => void })`. A barra do editor ganha um `DropdownMenu` "Ações" com itens "Salvar como template" e "Aplicar template" (as demais ações entram na Task 9 no MESMO menu).

- [ ] **Step 1: Testes RED do SaveTemplateDialog** — casos: (a) salvar com nome preenchido chama `createReportTemplate(nome, stripAiTextForTemplate(layout))` e fecha com toast de sucesso; (b) checkbox "Definir como padrão do workspace" marcado chama `setDefaultReportTemplate` com o id criado; (c) nome vazio desabilita o botão salvar; (d) erro do serviço mostra toast de erro e NÃO fecha. Mockar `../../services/reportTemplates` com `vi.mock` (padrão dos testes de dialog existentes do diretório, ex. `AddWidgetDrawer.test.tsx`).

- [ ] **Step 2: Implementar `SaveTemplateDialog.tsx`**

Estrutura: `Dialog` com `Input` de nome (label "Nome do template"), `Checkbox` "Definir como padrão do workspace", botões Cancelar/Salvar com estado `saving`. No submit:

```tsx
const stripped = stripAiTextForTemplate(getLayout());
const created = await createReportTemplate(name.trim(), stripped);
if (makeDefault) await setDefaultReportTemplate(created.id);
toast.success('Template salvo.');
onOpenChange(false);
```

Copy sem travessões. Invalidar `['report-templates']` no `queryClient` após salvar.

- [ ] **Step 3: Testes RED do ApplyTemplateDialog** — casos: (a) lista renderiza os templates do `useQuery(['report-templates'], listReportTemplates)` com badge "Padrão" no `is_default`; (b) clicar "Aplicar" chama `onApply(template)` e fecha; (c) botão de excluir pede confirmação (`window.confirm` mockado) e chama `deleteReportTemplate` + invalida a lista; (d) botão de tornar padrão chama `setDefaultReportTemplate` + invalida; (e) estado vazio mostra texto claro ("Nenhum template salvo ainda. Use Salvar como template no editor.").

- [ ] **Step 4: Implementar `ApplyTemplateDialog.tsx`** — `Dialog` com a lista (nome + data + badge), por linha: `Button` "Aplicar", ícone `Star`/`StarOff` para default, ícone `Trash2` para excluir. Loading com `Spinner`.

- [ ] **Step 5: Integrar no `RelatorioEditorPage.tsx`**

No `EditorBody`, estados `saveTplOpen`/`applyTplOpen`; na barra, após o botão "Adicionar widget":

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm" aria-label="Ações do relatório">
      <MoreHorizontal className="h-3.5 w-3.5" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onSelect={() => setSaveTplOpen(true)}>Salvar como template</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setApplyTplOpen(true)}>Aplicar template</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

E os dialogs:

```tsx
<SaveTemplateDialog open={saveTplOpen} onOpenChange={setSaveTplOpen} getLayout={() => layoutRef.current} />
<ApplyTemplateDialog
  open={applyTplOpen}
  onOpenChange={setApplyTplOpen}
  onApply={(tpl) => {
    applyLayout(applyTemplateLayout(tpl.layout, layoutRef.current));
    toast.success('Template aplicado.');
  }}
/>
```

- [ ] **Step 6: Rodar os testes do diretório + tsc CRM. Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/
git commit -m "feat(relatorios): salvar e aplicar template no editor"
```

---

### Task 9: CRM: ações de documento (PDF, refresh, ver como cliente, excluir) + seletor de template na geração

**Files:**
- Modify: `apps/crm/src/services/reportDocs.ts`, `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx`, `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`, `apps/crm/src/pages/analytics-conta/components/NewReportDialog.tsx`
- Test: `apps/crm/src/services/__tests__/reportDocs.test.ts` (estender), `apps/crm/src/pages/analytics-conta/components/__tests__/NewReportDialog.test.tsx` (estender; ver testes existentes do diretório)

**Interfaces:**
- Consumes: rotas das Tasks 4-5; `getHubToken(clienteId)` e `getWorkspaceSlug()` de `../store/hub.ts` (precedente de URL: `HubTab.tsx:179` usa `${window.location.origin}/${slug}/hub/${token}`); `listReportTemplates` (Task 7).
- Produces no serviço:
  - `generateReportDoc(clientId: number, month: string, templateId?: string)` — body ganha `templateId` quando presente; erro `invalid_template` vira mensagem "Template inválido. Tente outro ou o layout padrão."
  - `exportReportPdf(id: string): Promise<{ url: string }>` — `POST ${EDGE_URL}/${id}/pdf`; `pdf_not_configured` vira "Export de PDF não configurado neste ambiente."; `pdf_failed` vira "Não foi possível gerar o PDF. Tente novamente."
  - `refreshReportDoc(id: string): Promise<void>` — `POST ${EDGE_URL}/${id}/refresh-data`
  - `deleteReportDoc(id: string): Promise<void>` — `DELETE ${EDGE_URL}/${id}`

- [ ] **Step 1: Testes RED do serviço** — estender o teste existente de `reportDocs` (mock de `fetch` global, padrão do arquivo): (a) `generateReportDoc` com `templateId` inclui no body; sem, o body NÃO tem a chave; (b) `exportReportPdf` faz POST na URL certa e devolve `{url}`; mapeia `pdf_not_configured` para a mensagem; (c) `deleteReportDoc` usa method DELETE; (d) `refreshReportDoc` POST e resolve em `ok`.

- [ ] **Step 2: Implementar o serviço** (mesmo estilo das funções existentes; reusar `getAuthHeaders()`).

- [ ] **Step 3: Editor: ações no menu + botão Exportar PDF**

Em `EditorBody`:
- Botão primário "Exportar PDF" na barra (antes do menu Ações), com estado `exporting`; onClick: `const { url } = await exportReportPdf(doc.id); window.open(url, '_blank', 'noopener');` com toast de erro no catch.
- No `DropdownMenu` "Ações" (Task 8), acrescentar:
  - "Atualizar dados": `await refreshReportDoc(doc.id); await qc.invalidateQueries({ queryKey: ['report-doc', doc.id] }); toast.success('Dados atualizados.');` (o layout em edição NÃO é tocado; só o snapshot muda). Estado de loading no item.
  - "Ver como cliente": renderizado SÓ quando o link existe. Buscar com `useQuery({ queryKey: ['hub-view-link', doc.client_id], queryFn: async () => { const [tok, slug] = await Promise.all([getHubToken(doc.client_id), getWorkspaceSlug()]); return tok && slug && tok.is_active && tok.expires_at > new Date().toISOString() ? { url: \`${window.location.origin}/${slug}/hub/${tok.token}/relatorios/doc/${doc.id}\` } : null; } })`. Item faz `window.open(link.url, '_blank', 'noopener')`.

- [ ] **Step 4: Excluir na lista do `AnalyticsContaPage`** — na seção "Relatórios Interativos" (procure `listReportDocs` no arquivo, a query `['report-docs', clientId]`), acrescentar por linha um botão ícone `Trash2` com `aria-label="Excluir relatório"`; onClick: `if (!window.confirm('Excluir este relatório? O PDF exportado também é removido.')) return; await deleteReportDoc(doc.id); qc.invalidateQueries({ queryKey: ['report-docs', clientId] }); toast.success('Relatório excluído.');`

- [ ] **Step 5: Seletor de template no `NewReportDialog`**

`useQuery({ queryKey: ['report-templates'], queryFn: listReportTemplates, enabled: open })`. Abaixo do `MonthPicker`, um `Select` (shadcn, `@/components/ui/select`) "Modelo" com item fixo "Padrão do sistema" (value `"__system"`) e um item por template (nome + sufixo " · padrão" quando `is_default`). Default selecionado: o template `is_default` se existir, senão "Padrão do sistema". `handleGenerate` passa `templateId` quando não for `"__system"`. Teste RED antes: dialog lista os templates mockados e passa o `templateId` escolhido ao `generateReportDoc`.

- [ ] **Step 6: Rodar testes do CRM + tsc. Commit**

```bash
git add apps/crm/src/
git commit -m "feat(relatorios): exportar PDF, atualizar dados, ver como cliente, excluir e template na geracao"
```

---

### Task 10: Hub: lista união + viewer de documento

**Files:**
- Create: `apps/hub/src/pages/RelatorioDocPage.tsx`
- Modify: `apps/hub/src/api.ts`, `apps/hub/src/pages/Relatorios.tsx`, `apps/hub/src/router.tsx`
- Test: `apps/hub/src/pages/__tests__/RelatorioDocPage.test.tsx`, `apps/hub/src/pages/__tests__/Relatorios.test.tsx` (estender/criar seguindo o padrão dos testes existentes de `apps/hub/src/pages/__tests__/`)

**Interfaces:**
- Consumes: contrato da Task 6; `BlockRenderer` + `styles.css` de `@mesaas/report-blocks` (alias já configurado no vite/tsconfig do Hub); `useHub()` para token; `PageHeader`.
- Produces em `api.ts`:

```ts
export type HubReportListItem =
  | { kind: 'legacy'; month: string; status: string; generated_at: string | null; has_pdf: boolean; has_html: boolean }
  | { kind: 'doc'; id: string; title: string; month: string; generated_at: string };

export function fetchReportList(token: string) {
  return get<{ items: HubReportListItem[] }>('hub-report-docs/list', { token });
}

export interface HubReportDoc {
  id: string; title: string; layout: unknown; data_snapshot: unknown; period_start: string;
}

export function fetchReportDoc(token: string, docId: string) {
  return get<{ doc: HubReportDoc }>(`hub-report-docs/doc/${docId}`, { token });
}
```

- Rota nova filha do shell: `relatorios/doc/:docId` (sem colisão com `relatorios/:month`: contagem de segmentos diferente).

- [ ] **Step 1: api.ts** — adicionar os fetchers acima (o tipo `HubReport` legado e `fetchReports` FICAM; `hub-reports` continua servindo html/pdf legados).

- [ ] **Step 2: Testes RED da lista** — `Relatorios.tsx` mockando `fetchReportList`: (a) item `kind: 'doc'` renderiza card com `title`, mês formatado e botão "Abrir" que navega para `.../relatorios/doc/{id}`; (b) item `kind: 'legacy'` mantém o card atual (Ver online/Baixar PDF); (c) lista vazia mantém o texto atual.

- [ ] **Step 3: Adaptar `Relatorios.tsx`** — trocar a query para `['hub-report-list', token] → fetchReportList(token)`; separar `DocCard` (novo, ícone `FileText`, título, mês via `formatMonth`, botão "Abrir") do `ReportCard` legado (intocado por dentro; recebe o item legado). `key`: `doc-${id}` / `legacy-${month}`.

- [ ] **Step 4: Testes RED do viewer** — `RelatorioDocPage` mockando `fetchReportDoc`: (a) loading spinner; (b) sucesso renderiza o título e um elemento `.rb-grid.rb-mode-view` (o BlockRenderer real com um fixture mínimo de layout/snapshot: use `packages/report-blocks/fixtures.ts` se exportar fixture pronto; senão um snapshot mínimo literal); (c) erro mostra "Erro ao carregar o relatório."; (d) botão voltar navega para `.../relatorios`.

- [ ] **Step 5: Implementar `RelatorioDocPage.tsx`**

```tsx
// apps/hub/src/pages/RelatorioDocPage.tsx
// Viewer read-only do relatório de blocos (spec §9): mesmo BlockRenderer do
// print/editor, accent do layout/snapshot congelado, sob o token do portal.
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BlockRenderer } from '@mesaas/report-blocks/BlockRenderer';
import type { ReportDocSnapshot, ReportLayout } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import { useHub } from '../HubContext';
import { fetchReportDoc } from '../api';

export function RelatorioDocPage() {
  const { token } = useHub();
  const { workspace, docId } = useParams<{ workspace: string; token: string; docId: string }>();
  const navigate = useNavigate();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-report-doc', token, docId],
    queryFn: () => fetchReportDoc(token, docId ?? ''),
    enabled: !!docId,
  });

  const doc = data?.doc;
  return (
    <div className="hub-fade-up">
      <div className="max-w-5xl mx-auto w-full mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(`${base}/relatorios`)}
          className="hub-back-link flex items-center gap-1.5 text-[13px] font-medium hub-tx3 transition-colors"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          Relatórios
        </button>
        {doc && <span className="text-[13px] font-medium hub-txt">{doc.title}</span>}
      </div>
      {isLoading && (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      )}
      {isError && (
        <div className="max-w-5xl mx-auto py-20 text-center text-sm hub-tx2">
          Erro ao carregar o relatório.
        </div>
      )}
      {doc && doc.data_snapshot != null && (
        <div className="max-w-5xl mx-auto">
          <BlockRenderer
            layout={doc.layout as ReportLayout}
            snapshot={doc.data_snapshot as ReportDocSnapshot}
            mode="view"
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rota** — em `router.tsx`, ANTES da rota `relatorios/:month`:

```tsx
      {
        path: 'relatorios/doc/:docId',
        lazy: async () => ({
          Component: (await import('./pages/RelatorioDocPage')).RelatorioDocPage,
        }),
      },
```

- [ ] **Step 7: Rodar testes do Hub + `npx tsc -p apps/hub/tsconfig.json --noEmit`. Commit**

```bash
git add apps/hub/src/
git commit -m "feat(hub): lista uniao de relatorios e viewer do documento de blocos"
```

---

### Task 11: Hub: página de print + roteamento Vercel

**Files:**
- Create: `apps/hub/src/pages/RelatorioPrintPage.tsx`
- Modify: `apps/hub/src/api.ts`, `apps/hub/src/router.tsx`, `vercel.json`, `apps/crm/src/content/__tests__/vercel-routing.test.ts`
- Test: `apps/hub/src/pages/__tests__/RelatorioPrintPage.test.tsx`

**Interfaces:**
- Consumes: rota `print-doc` da Task 6; contrato de URL da Task 5 (`/relatorios/print/:docId?pt=`).
- Produces: página que seta `window.__REPORT_READY = true` SÓ depois de dados + fontes + imagens (contrato de prontidão, spec §9); rewrite do Vercel para `/hub/index.html` ANTES do app-shell do CRM.

- [ ] **Step 1: api.ts** — `export function fetchPrintReportDoc(docId: string, pt: string) { return get<{ doc: HubReportDoc }>(\`hub-report-docs/print-doc/${docId}\`, { pt }); }`

- [ ] **Step 2: Testes RED do print** — casos: (a) com fetch mockado resolvendo um doc, a página renderiza `.rb-grid.rb-mode-print` e, após o efeito de prontidão, `window.__REPORT_READY === true` (usar `waitFor`); (b) com fetch rejeitando, `window.__REPORT_READY` NUNCA vira true e a página mostra "Não foi possível carregar o relatório."; (c) limpar `window.__REPORT_READY` no `beforeEach`. jsdom não tem `document.fonts` nem `img.decode` — o código de produção usa optional chaining para os dois, então o teste passa sem polyfill.

- [ ] **Step 3: Implementar `RelatorioPrintPage.tsx`**

```tsx
// apps/hub/src/pages/RelatorioPrintPage.tsx
// Fonte do PDF (spec §9): mesma render do viewer, sem chrome do portal, com o
// contrato de prontidão que o Gotenberg espera via waitForExpression. Auth
// própria por print token HMAC (?pt=); NUNCA token de portal.
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BlockRenderer } from '@mesaas/report-blocks/BlockRenderer';
import type { ReportDocSnapshot, ReportLayout } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import { fetchPrintReportDoc } from '../api';

declare global {
  interface Window {
    __REPORT_READY?: boolean;
  }
}

export function RelatorioPrintPage() {
  const { docId } = useParams<{ docId: string }>();
  const [params] = useSearchParams();
  const pt = params.get('pt') ?? '';

  const { data, isError } = useQuery({
    queryKey: ['print-report-doc', docId],
    queryFn: () => fetchPrintReportDoc(docId ?? '', pt),
    enabled: !!docId && !!pt,
    retry: 1,
  });

  const doc = data?.doc;
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      // Fontes e imagens resolvidas ANTES de declarar prontidão: sem isso o
      // chromium imprime placeholders. Optional chaining: jsdom não tem
      // document.fonts nem img.decode.
      await document.fonts?.ready;
      const imgs = Array.from(document.images);
      await Promise.allSettled(imgs.map((img) => img.decode?.() ?? Promise.resolve()));
      if (!cancelled) window.__REPORT_READY = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  if (isError) {
    return <p style={{ fontFamily: 'sans-serif', padding: '2rem' }}>Não foi possível carregar o relatório.</p>;
  }
  if (!doc || doc.data_snapshot == null) return null;
  return (
    <div style={{ background: '#ffffff', padding: '0' }}>
      <BlockRenderer
        layout={doc.layout as ReportLayout}
        snapshot={doc.data_snapshot as ReportDocSnapshot}
        mode="print"
      />
    </div>
  );
}
```

- [ ] **Step 4: Rota top-level** — em `router.tsx`, entre o objeto do shell e o catch-all `*`:

```tsx
  {
    path: '/relatorios/print/:docId',
    lazy: async () => ({
      Component: (await import('./pages/RelatorioPrintPage')).RelatorioPrintPage,
    }),
  },
```

- [ ] **Step 5: vercel.json** — ordem é semântica (primeiro match ganha):

No array `rewrites`, inserir IMEDIATAMENTE após as duas entradas do hub (`/:workspace/hub/:token...`):

```json
    { "source": "/relatorios/print/:docId", "destination": "/hub/index.html" },
```

No array `headers`, junto das entradas noindex do hub:

```json
    {
      "source": "/relatorios/print/:docId",
      "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
    },
```

- [ ] **Step 6: Testes de contrato do vercel.json** — em `vercel-routing.test.ts`, dois testes novos:

```ts
  test('print do relatorio reescreve para o hub ANTES do app-shell (que captura relatorios/*)', () => {
    const printIdx = rewrites.findIndex((r) => r.source === '/relatorios/print/:docId');
    const appShellIdx = rewrites.findIndex((r) => r.destination === '/app.html');
    expect(printIdx).toBeGreaterThanOrEqual(0);
    expect(rewrites[printIdx].destination).toBe('/hub/index.html');
    expect(printIdx).toBeLessThan(appShellIdx);
  });

  test('print do relatorio carrega noindex', () => {
    const noindexSources = headers
      .filter((h) => h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)))
      .map((h) => h.source);
    expect(noindexSources).toContain('/relatorios/print/:docId');
  });
```

- [ ] **Step 7: Rodar testes do Hub e do CRM (vercel-routing) + os 2 tsc. Commit**

```bash
git add apps/hub/src/ vercel.json apps/crm/src/content/__tests__/vercel-routing.test.ts
git commit -m "feat(hub): pagina de print com contrato de prontidao e rewrite do vercel"
```

---

### Task 12: Editor: beforeunload + undo de exclusão + retry com backoff

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts`, `apps/crm/src/pages/relatorio-editor/layoutOps.ts`, `apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx`, `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx`
- Test: `apps/crm/src/pages/relatorio-editor/__tests__/useLayoutAutosave.test.ts`, `__tests__/layoutOps.test.ts`, `__tests__/RelatorioEditorPage.test.tsx` (estender)

**Interfaces:**
- Consumes: contrato atual do hook (cadeia por documento no escopo do módulo, retenção-e-retry) — leia o arquivo INTEIRO antes de mexer; os invariantes dos testes existentes (serialização, retenção, write-back de cache) NÃO podem regredir.
- Produces:
  - `restoreBlock(layout, block: ReportBlock, index: number): ReportLayout` em layoutOps (clampa index; id já presente devolve a MESMA referência).
  - `EditorCanvasProps` ganha `onRemoveBlock?: (id: string) => void` (ausente = comportamento atual).
  - Autosave: retry com `RETRY_DELAYS_MS = [5000, 15000, 30000]` e parada após esgotar (edição nova zera o contador); toasts de erro com `{ id: 'report-autosave-error' }`; guard `beforeunload` enquanto houver pendência ou request em voo.

- [ ] **Step 1: Testes RED de `restoreBlock`** (em layoutOps.test.ts): (a) restaura na posição original; (b) index maior que o array clampa pro fim; (c) id já presente devolve a MESMA referência (`toBe`).

- [ ] **Step 2: Implementar**

```ts
/** Desfaz uma exclusão: reinsere o bloco na posição de origem (clampada).
 * Id já presente = no-op com a MESMA referência (contrato do autosave). */
export function restoreBlock(layout: ReportLayout, block: ReportBlock, index: number): ReportLayout {
  if (layout.blocks.some((b) => b.id === block.id)) return layout;
  const blocks = [...layout.blocks];
  blocks.splice(Math.min(Math.max(index, 0), blocks.length), 0, block);
  return { ...layout, blocks };
}
```

- [ ] **Step 3: `EditorCanvas`** — prop `onRemoveBlock`; na `SortableCell`, `onRemove={() => (onRemoveBlock ?? ((id: string) => onChange(removeBlock(layout, id))))(block.id)}` (ajuste o shape real: o handler interno hoje é `() => onChange(removeBlock(layout, block.id))`; preserve-o como default).

- [ ] **Step 4: `EditorBody`: undo com toast**

```tsx
function handleRemoveBlock(id: string) {
  const idx = layoutRef.current.blocks.findIndex((b) => b.id === id);
  const block = layoutRef.current.blocks[idx];
  if (!block) return;
  applyLayout(removeBlock(layoutRef.current, id));
  toast('Bloco excluído.', {
    action: {
      label: 'Desfazer',
      onClick: () => applyLayout(restoreBlock(layoutRef.current, block, idx)),
    },
  });
}
```

Passar `onRemoveBlock={handleRemoveBlock}` ao canvas. Teste RED antes (RelatorioEditorPage.test.tsx): excluir um bloco mostra o toast com action; acionar a action restaura o bloco na mesma posição (asserte via ordem dos `data-block-id`). Mock de sonner já existe nos testes do diretório; capture o `action.onClick` do mock.

- [ ] **Step 5: Autosave: backoff + cap + dedup (testes RED primeiro)**

Testes novos no useLayoutAutosave.test.ts:
- (a) três falhas seguidas agendam retries em 5s, 15s e 30s (avance os timers e conte chamadas: 1+1+1+1 = 4 requests no total com `mockRejectedValue`); depois da quarta falha NENHUM novo timer dispara (avançar 60s não gera 5ª chamada) e `saving` continua `true` (payload retido).
- (b) edição nova após o esgotamento reinicia o ciclo (request volta a disparar no debounce normal).
- (c) toasts de erro carregam `{ id: 'report-autosave-error' }` (asserte o 2º argumento do mock).
- (d) sucesso zera o contador (falha, sucesso no retry, nova falha volta a esperar 5s, não 15s).

Implementação: substituir `RETRY_DEBOUNCE_MS` por `const RETRY_DELAYS_MS = [5000, 15000, 30000];` e um `retryCount = useRef(0)`. No catch do flush de layout: `const delay = RETRY_DELAYS_MS[retryCount.current]; if (delay !== undefined && pendingLayout.current === null) { retryCount.current += 1; pendingLayout.current = toSave; scheduleLayoutFlush(delay); } else if (pendingLayout.current === null) { pendingLayout.current = toSave; }` (retido SEM agendar quando esgotou). No sucesso: `retryCount.current = 0`. `applyLayout` também zera (`retryCount.current = 0`). Título: mesmo tratamento com `titleRetryCount`. Todos os `toast.error(SAVE_ERROR_MSG)` ganham `, { id: 'report-autosave-error' }`.

- [ ] **Step 6: beforeunload (teste RED primeiro)**

Testes: (a) com edição pendente (debounce não disparou), `window.dispatchEvent(new Event('beforeunload', { cancelable: true }))` tem `defaultPrevented === true`; (b) sem pendência e sem request em voo, `defaultPrevented === false`; (c) o listener sai no unmount (dispatch pós-unmount não é prevenido).

Implementação no hook: um `savingRef = useRef(false)` espelhando `saving` (atualize junto dos `setSaving`), e:

```ts
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingLayout.current !== null || titleDirty.current || savingRef.current) {
        e.preventDefault();
        // Exigido por Chrome legado para mostrar o prompt nativo.
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
```

- [ ] **Step 7: Rodar a suíte inteira do diretório (TODOS os testes antigos verdes) + tsc CRM. Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/
git commit -m "feat(relatorios): beforeunload, undo de exclusao e retry com backoff no editor"
```

---

### Task 13: Integração final: gates, staging e verificação de browser

**Files:** nenhum novo (correções pontuais se os gates apontarem).

- [ ] **Step 1: Gates completos, nesta ordem**

```bash
npm run lint
npm run format:check   # npm run format para auto-fix
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions   # POR ÚLTIMO: polui node_modules/.deno
git checkout -- deno.lock
ls node_modules/.deno 2>/dev/null && npm ci   # se poluiu, restaure antes de re-rodar checks npm
```

- [ ] **Step 2: Reconferir prefixo da migration** — `git ls-tree origin/main:supabase/migrations | tail`; se main avançou além de `20260821000010`, renumerar arquivo e referências.

- [ ] **Step 3: Staging** — conferir o link antes de qualquer push (`cat supabase/.temp/project-ref`; staging = `wlyzhyfondykzpsiqsce`). Depois:

```bash
npx supabase db push --linked
npx supabase functions deploy report-docs --use-api
npx supabase functions deploy hub-report-docs --use-api --no-verify-jwt
```

Worktree pode não ter `.env.staging` (gotcha conhecido): copie do repo principal antes de rodar `npm run dev:staging`.

- [ ] **Step 4: Browser E2E em staging (dev server :staging)** — fluxo completo:
  1. Gerar relatório novo pelo dialog escolhendo um template (criar um antes via "Salvar como template" num relatório existente, com "Definir como padrão").
  2. No editor: aplicar template noutro relatório e confirmar herança do texto de IA; excluir bloco e Desfazer; "Atualizar dados"; reload real confirmando persistência.
  3. Hub (dev server do hub na porta permitida pelo ALLOWED_ORIGINS): lista mostra legado + docs; abrir o doc; visual ok.
  4. Print: abrir `http://localhost:5175/relatorios/print/<docId>?pt=<token>` com um token gerado ad hoc (ex.: endpoint de pdf com env incompleta responde 503, então gere o token via script Deno local com INTERNAL_FUNCTION_SECRET de staging OU valide a página com o fetch mockado no teste e cheque manualmente só o render). Confirmar `window.__REPORT_READY === true` no console.
  5. Export de PDF fim-a-fim SÓ é verificável onde `REPORT_PRINT_BASE` é público para o Gotenberg (produção). Em staging, validar até a chamada do Gotenberg (503/502 esperado conforme env) e REGISTRAR no PR que o E2E do PDF fica para o deploy de produção. NÃO simule sucesso.

- [ ] **Step 5: Commit final de ajustes (se houver) e push da branch.**

## Verificação (resumo do que o PR precisa provar)

- Vitest e Deno verdes, 4 tsc, lint, prettier.
- Suíte SQL nova passa no CI (`entitlement-tests`).
- Browser staging: template (salvar/aplicar/default/seletor), undo, refresh, Hub lista+viewer, print page com `__REPORT_READY`.
- PR empilhado: base `claude/report-editor-pr2`, com nota de merge-order e do E2E de PDF pendente de produção.
