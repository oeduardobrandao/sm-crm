# Relatório interativo de blocos (estilo Reportei)

**Data:** 2026-08-20
**Status:** Aprovado em brainstorming
**Escopo:** Componente novo e paralelo. O relatório mensal atual (pipeline `analytics_reports` → `report-worker` → `instagram-report-generator-v2`, cron, e-mail, iframe do Hub) fica intocado; o deprecate é uma iniciativa futura.

## 1. Contexto e problema

O relatório mensal atual é um HTML fixo de 6 páginas A4 gerado no backend e convertido em PDF via Gotenberg. O único controle do usuário é o checkbox "Incluir IA". Não há seleção de mês, preview no CRM, nem qualquer configuração de conteúdo.

Queremos o modelo do Reportei: o gestor tem controle fino, métrica a métrica, sobre o que aparece no relatório — adiciona/remove widgets individuais, arrasta blocos, redimensiona, escreve análises em texto livre, e salva o resultado como template reutilizável entre clientes.

## 2. Decisões de produto (confirmadas com o usuário)

1. **Granularidade:** métrica a métrica (add/remove widget, drag, resize) — não apenas seções ligáveis/desligáveis.
2. **Paradigma:** documento web contínuo de blocos; o PDF é uma impressão dele. O layout A4 editorial atual não é migrado para o novo componente.
3. **Modelo de edição:** os dois desde a v1 — edita-se o relatório já gerado (com dados reais) E salva-se o layout como template reutilizável entre clientes. O template nasce do editor, não de uma tela separada.
4. **Blocos livres:** sim, texto rico (TipTap) em qualquer posição. A narrativa de IA preenche blocos de texto como rascunho editável.
5. **Rollout:** componente novo e separado, convivendo com o relatório atual até o deprecate.
6. **Arquitetura de render:** documento JSON (layout + snapshot de dados) renderizado no cliente por um pacote React compartilhado; PDF via Gotenberg em modo conversão por URL apontando para uma página de impressão.

## 3. Modelo de dados

Migration nova (prefixo de versão único — conferir o tail de `origin/main:supabase/migrations` antes de abrir o PR).

### `report_documents`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `conta_id` | uuid NOT NULL | workspace |
| `client_id` | bigint FK `clientes` | |
| `instagram_account_id` | uuid FK `instagram_accounts` | |
| `title` | text | |
| `period_start` / `period_end` | date | v1 gera por mês; o schema já aceita período arbitrário no futuro |
| `layout` | jsonb NOT NULL | ver §4 |
| `data_snapshot` | jsonb | todas as fontes congeladas na geração (ver §5) |
| `ai_content` | jsonb | saída bruta do Gemini |
| `status` | text CHECK | `pending\|generating\|ready\|failed` |
| `generation_error` | text | |
| `created_by` | uuid | |
| `created_at` / `updated_at` | timestamptz | |

RLS espelhando as políticas por operação de `analytics_reports` (`20260315_rls_security_audit.sql:371-390`): `conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())`.

### `report_templates`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `conta_id` | uuid NOT NULL | |
| `name` | text NOT NULL | |
| `layout` | jsonb NOT NULL | mesmo schema do documento, sem dados |
| `is_default` | boolean | template padrão do workspace |
| `created_at` / `updated_at` | timestamptz | |

RLS igual. **Sem coluna nova em `clientes`** — evita o allowlist de colunas (GRANT + views + `*_SAFE_COLUMNS`). Default por cliente fica para depois, se fizer falta.

## 4. Schema do layout

```jsonc
{
  "version": 1,
  "blocks": [
    {
      "id": "uuid",
      "type": "kpi_new_followers", // ver catálogo §7
      "size": "third" | "half" | "full",
      "config": { /* por widget, ex: { count: 6 } no grid de posts */ },
      "text": { /* JSON TipTap, só em blocos de texto */ }
    }
  ]
}
```

- `version` permite migrações do schema de layout no cliente (funções puras, testadas).
- Ordem do array = ordem no documento. O grid CSS acomoda `third`/`half`/`full` com quebra natural.
- Template = mesmo objeto sem `text` preenchido de dados de relatório específico (blocos de texto no template guardam o texto do autor, exceto os blocos de IA, que são regenerados por relatório).

## 5. Geração — síncrona, sem fila

Edge function nova **`report-docs`** (JWT; ownership por `conta_id`; auth: service-role client + `getUser(token)`; CORS via `buildCorsHeaders(req)`):

- `POST /generate { clientId, month, templateId? }`
  1. Valida entitlement `feature_analytics_reports` (`effectivePlanFeature`, `_shared/entitlements-rpc.ts`) e rate limit (padrão do gerador atual).
  2. Roda as ~9 queries paralelas que o gerador v2 já faz (§2 de `instagram-report-generator-v2/index.ts` + `mappers.ts`) e monta o `data_snapshot`.
  3. Monta o `layout`: do `templateId` informado, senão do template `is_default` do workspace, senão o layout padrão do sistema (§7).
  4. Se `clientes.include_ai_analysis`: roda o Gemini (módulo `_shared/report-template/ai.ts` reutilizado) e preenche os blocos de IA como texto editável. Falha de IA nunca derruba a geração (fallback em bullets, como hoje).
  5. Grava `ready` e devolve o documento. Sem Gotenberg, sem worker, sem lock.
- `POST /:id/pdf` — dispara Gotenberg `convert/url` na rota `/print` do Hub, salva o PDF em bucket privado, retorna signed URL. Cache por hash do layout; editar o relatório invalida e o próximo export regenera.
- `POST /:id/refresh-data` — re-snapshot mantendo o layout.

**Edição** = `UPDATE report_documents.layout` direto via PostgREST com RLS (autosave com debounce). Templates: CRUD direto via PostgREST.

**Thumbnails:** o snapshot guarda URLs estáveis do cache público de thumbnails já existente (PR #200); a geração garante o cache dos top posts. Sem base64.

## 6. Pacote compartilhado `packages/report-blocks`

Componentes React por widget + renderer do grid + CSS print. Consumido por: editor do CRM, viewer do Hub e página `/print`. **Implementação única por widget.**

- Accent da marca via `resolveAccent` (`supabase/functions/_shared/report-template/theme.ts` — o CRM já importa esse módulo em `ReportPreview.tsx`).
- Gráfico de linha portado de `_shared/report-template/charts.ts` para React/SVG.
- Componentes recebem `{ block, snapshot, accent }` e são puros — testáveis com fixtures.

## 7. Catálogo de widgets v1

| Categoria | Widgets |
|---|---|
| **Números** | 8 cards individuais, cada um com delta vs. mês anterior: novos seguidores, seguidores totais, alcance, taxa de engajamento, salvamentos, publicações, visitas ao perfil, cliques no link |
| **Gráficos** | evolução de seguidores (linha), desempenho por formato (Reels/Carrossel/Imagem), melhores horários (heatmap) |
| **Audiência** | gênero (donut), faixa etária (barras), cidades, países |
| **Conteúdo** | grid de top posts (config: quantidade), lista compacta de posts, performance por tópico (tags) |
| **Texto & IA** | texto rico (TipTap), resumo executivo (IA, editável), recomendações (IA, editável), metas (IA, editável) |
| **Estrutura** | capa (marca + mês + splash do branding atual), cabeçalho de seção, divisor / quebra de página no PDF |

Widget sem dados no snapshot (ex: demografia indisponível) renderiza um estado vazio claro no editor e é omitido no viewer/print.

**Layout padrão do sistema** reproduz a ordem do relatório atual: capa → resumo → KPIs → crescimento → formatos → posts → audiência → recomendações. Quem não editar nada recebe um relatório equivalente ao de hoje.

## 8. Editor (CRM)

- Rota nova `/relatorios/:id`. **Obrigatório** adicionar ao padrão nomeado do `vercel.json` E ao `APP_ROUTE_PREFIXES`, senão a rota dá 404 em produção.
- **Canvas central:** o documento real em grid de blocos. Toolbar por bloco no hover: alça de arraste (dnd-kit, padrões existentes em `apps/crm/src/pages/cliente-detalhe/BriefingReorder.tsx` e `apps/crm/src/pages/entregas/components/SortableEtapaList.tsx`), botões −/+ de largura, lixeira.
- **Drawer "Adicionar widget":** catálogo por categoria com miniatura; o widget entra preenchido do snapshot.
- **Barra superior:** título, mês, "Salvar como template", "Aplicar template", "Exportar PDF", "Ver como cliente" (abre a visão do Hub).
- **Autosave** com debounce + indicador "Salvo".
- **Entrada:** em `AnalyticsContaPage`, botão "Novo relatório" abre dialog com `MonthPicker` (`apps/crm/src/components/ui/month-picker.tsx`) + seletor de template; cria e navega para o editor. A lista de relatórios do cliente mostra os documentos novos ao lado dos antigos.
- Copy sem travessões (regra da casa).

## 9. Hub + PDF

- Função nova **`hub-report-docs`** (auth por token do Hub, padrão de `hub-reports/index.ts`; deploy com `--no-verify-jwt`). A `hub-reports` atual fica intocada.
- A lista de relatórios do Hub passa a mostrar também os novos documentos; documento novo abre em rota de visualização read-only renderizando os blocos (mesmo pacote), com o accent da marca.
- Variante `/print` da mesma página (sem chrome, CSS print) é a fonte do PDF via Gotenberg `convert/url` (criar variante URL ao lado de `_shared/report-template/pdf.ts`, que hoje usa `convert/html`).

## 10. Fora da v1 (explícito)

- Envio por e-mail (o sistema antigo cobre em paralelo)
- Geração automática mensal (cron antigo intocado; consertá-lo é parte do deprecate futuro)
- Período arbitrário (v1 é mensal)
- Blocos de imagem/vídeo livres
- Deprecate do relatório antigo (iniciativa própria: migrar cron, e-mail, lista do Hub, remover gerador v2)

## 11. Fases sugeridas

1. **PR 1 — Fundação:** migration + `report-docs/generate` + snapshot + `packages/report-blocks` com renderer e widgets principais + rota do editor em modo somente-leitura + entrada no CRM + `vercel.json`/`APP_ROUTE_PREFIXES`.
2. **PR 2 — Editor:** drag/resize/delete/add drawer, blocos de texto TipTap, autosave, IA nos blocos.
3. **PR 3 — Templates + Hub + PDF:** salvar/aplicar/gerenciar templates, `hub-report-docs`, viewer + print no Hub, export PDF.

## 12. Verificação

- **Vitest:** utils do schema de layout (layout padrão, aplicar template, versionamento), widgets renderizando de fixtures de snapshot, dialog de criação.
- **Deno:** rotas de `report-docs` (generate, pdf, refresh-data) e `hub-report-docs`.
- **SQL:** políticas RLS das tabelas novas na suíte `supabase/tests/entitlements/`.
- **Pré-push:** `npm run lint`, `npm run format:check`, os 4 `tsc`, `npm run test`, `npm run test:functions` (e `git checkout -- deno.lock` depois do deno).
- **Browser:** fluxo completo — gerar → editar (arrastar, redimensionar, remover, adicionar, texto) → salvar template → aplicar em outro cliente → ver no Hub → exportar PDF.
