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
| `pdf_storage_path` | text | um objeto por documento, sobrescrito a cada export |
| `pdf_generated_at` | timestamptz | comparado com `updated_at` para o cache do PDF |
| `created_by` | uuid | |
| `created_at` / `updated_at` | timestamptz | `updated_at` mantido por trigger em todo UPDATE |

**RLS e privilégios** (a parte que define a superfície de escrita):

- Políticas por operação no padrão real de `analytics_reports` (`20260315_rls_security_audit.sql:374-390`): `conta_id IN (SELECT public.get_my_conta_id())` — o modelo de isolamento é o workspace ativo, não `profiles.conta_id`.
- **Só SELECT e UPDATE para `authenticated`**, e o UPDATE com **grant por coluna restrito a `(layout, title)`**. Criação, deleção, `status`, `data_snapshot`, `pdf_*` e campos de erro são exclusivos da edge function (service role): sem grant de INSERT/DELETE para `authenticated`, ninguém cria documento por fora do caminho de entitlement nem apaga sem limpar o PDF. Atenção ao gotcha conhecido: `REVOKE FROM PUBLIC` também derruba `service_role` — re-grant explícito.
- Trigger `BEFORE INSERT OR UPDATE` valida a forma grosseira do `layout` (objeto com `version` inteiro, `blocks` array com limite de itens, `size` no enum) para que escrita direta via PostgREST não persista lixo.

### `report_templates`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `conta_id` | uuid NOT NULL | |
| `name` | text NOT NULL | |
| `layout` | jsonb NOT NULL | mesmo schema do documento, sem dados |
| `is_default` | boolean NOT NULL DEFAULT false | template padrão do workspace |
| `created_at` / `updated_at` | timestamptz | |

RLS igual (CRUD completo para `authenticated` — templates são conteúdo do usuário), com duas exceções:

- Índice único parcial `(conta_id) WHERE is_default` + RPC atômica `set_default_report_template(id)` que zera o default anterior e marca o novo numa transação. Sem isso, CRUD direto permite dois defaults e a seleção fica não determinística.
- O mesmo trigger de validação grosseira do `layout`.

**Sem coluna nova em `clientes`** — evita o allowlist de colunas (GRANT + views + `*_SAFE_COLUMNS`). Default por cliente fica para depois, se fizer falta.

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
- **Validação em três camadas**: (1) validador compartilhado (zod) em `packages/report-blocks` — tipos de bloco conhecidos, compatibilidade type↔config, limites por config (ex: `count` do grid de posts entre 1 e 12) — usado pelo editor antes de salvar; (2) trigger do banco com a checagem grosseira de forma (§3), já que o UPDATE é direto via PostgREST; (3) renderers defensivos — bloco de tipo desconhecido é ignorado no viewer/print e mostrado como "widget não suportado" no editor; `version` maior que a suportada bloqueia a edição com aviso, nunca sobrescreve.

## 5. Geração — síncrona, sem fila

Edge function nova **`report-docs`** (auth: service-role client + `getUser(token)`; CORS via `buildCorsHeaders(req)`).

**Ownership — regra geral da função**: como ela roda com service role (bypassa RLS), **todo ID que entra num request é resolvido contra o workspace ativo do usuário autenticado**: `clientId` → `clientes.conta_id`, `templateId` → `report_templates.conta_id`, documento `:id` → `report_documents.conta_id`, e a conta de Instagram derivada do cliente. IDs de FK sozinhos não garantem que cliente, conta IG e workspace pertencem uns aos outros; a checagem é explícita em cada rota, e falha = 404 genérico.

- `POST /generate { clientId, month, templateId? }`
  1. Valida ownership (acima), entitlement `feature_analytics_reports` (`effectivePlanFeature`, `_shared/entitlements-rpc.ts`) e rate limit (padrão do gerador atual).
  2. Roda as ~9 queries paralelas que o gerador v2 já faz (§2 de `instagram-report-generator-v2/index.ts` + `mappers.ts`) e monta o `data_snapshot` — **incluindo o branding congelado** (nome do workspace, handle, URL do logo, URL do splash, accent via `resolveAccent`). Branding congelado dá estabilidade histórica ao documento e identidade estável ao PDF; `refresh-data` re-congela.
  3. Monta o `layout`: do `templateId` informado, senão do template `is_default` do workspace, senão o layout padrão do sistema (§7).
  4. Se `clientes.include_ai_analysis`: roda o Gemini (módulo `_shared/report-template/ai.ts` reutilizado) e preenche os blocos de IA como texto editável. Falha de IA nunca derruba a geração (fallback em bullets, como hoje).
  5. Grava `ready` e devolve o documento. Sem Gotenberg, sem worker, sem lock.
- `POST /:id/pdf` — dispara Gotenberg `convert/url` na rota `/print` do Hub (contrato de prontidão no §9), salva o PDF em `pdf_storage_path` (um objeto por documento, upsert) e retorna signed URL. **Cache**: serve o PDF existente apenas se `pdf_generated_at >= updated_at` E a versão do renderer não mudou; qualquer edição, `refresh-data` (que também toca `updated_at`) ou bump de renderer regenera. Hash só de layout seria errado: `refresh-data` troca o snapshot mantendo o layout.
- `POST /:id/refresh-data` — re-snapshot (dados + branding) mantendo o layout; atualiza `updated_at`.
- `DELETE /:id` — remove o objeto PDF do bucket e a linha. Deleção só por aqui (sem grant de DELETE via PostgREST), para não deixar PDF órfão. Órfãos residuais (crash entre os dois passos) ficam para uma varredura na iniciativa de deprecate.

**Edição** = `UPDATE report_documents (layout, title)` direto via PostgREST com RLS + grant por coluna (§3), autosave com debounce. Templates: CRUD direto via PostgREST; default só pela RPC (§3).

**Thumbnails:** a geração roda `cachePostThumbnail` (`_shared/instagram-thumbnail-cache.ts`) para os top posts, mas **só congela URL que passe em `!isEphemeralInstagramUrl()`** — o fallback da função devolve a URL efêmera do CDN em caso de falha, e essa URL nunca entra no snapshot. Cache falhou = `thumbnail_url: null` no snapshot e o widget renderiza placeholder. Sem base64.

## 6. Pacote compartilhado `packages/report-blocks`

Componentes React por widget + renderer do grid + CSS print. Consumido por: editor do CRM, viewer do Hub e página `/print`. **Implementação única por widget.**

- Accent da marca via `resolveAccent` (`supabase/functions/_shared/report-template/theme.ts` — o CRM já importa esse módulo em `ReportPreview.tsx`).
- Gráfico de linha portado de `_shared/report-template/charts.ts` para React/SVG.
- Componentes recebem `{ block, snapshot, accent }` e são puros — testáveis com fixtures.

## 7. Catálogo de widgets v1

| Categoria | Widgets |
|---|---|
| **Números** | 8 cards individuais: novos seguidores, seguidores totais, alcance, taxa de engajamento, salvamentos, publicações, visitas ao perfil, cliques no link. Delta vs. mês anterior **quando existe valor anterior na mesma base** (tabela abaixo) |
| **Gráficos** | evolução de seguidores (linha), desempenho por formato (Reels/Carrossel/Imagem), melhores horários (heatmap) |
| **Audiência** | gênero (donut), faixa etária (barras), cidades, países |
| **Conteúdo** | grid de top posts (config: quantidade), lista compacta de posts, performance por tópico (tags) |
| **Texto & IA** | texto rico (TipTap), resumo executivo (IA, editável), recomendações (IA, editável), metas (IA, editável) |
| **Estrutura** | capa (marca + mês + splash do branding atual), cabeçalho de seção, divisor / quebra de página no PDF |

**Fonte e base de cada KPI.** O gerador v2 impõe uma invariante que o novo componente herda integralmente: valor, chip de delta e nota do mês anterior de um card são sempre a MESMA medida; sem valor anterior na mesma base, o card mostra só o valor (comentários em `instagram-report-generator-v2/index.ts:618-700` documentam cada guarda). O `ReportData` atual não tem KPI de seguidores totais, e engajamento/publicações não têm delta hoje — o snapshot novo define:

| KPI | Valor | Anterior (delta) |
|---|---|---|
| Novos seguidores | ganho líquido close-to-close (`instagram_account_metrics_daily`) | ganho do mês anterior (precisa do 3º snapshot); retido se qualquer ganho for negativo ou faltar snapshot |
| Seguidores totais | **novo**: close do mês (`followers_count` do snapshot); fallback = último ponto do `follower_history` dentro do mês, aí sem delta | close do mês anterior, só entre dois closes |
| Alcance | soma dos posts do mês | soma dos posts do mês anterior (>0) |
| Salvamentos | soma dos posts do mês | idem |
| Taxa de engajamento | interações/alcance dos posts do mês | **novo**: mesma razão sobre os posts do mês anterior (mesma base month-sum; o v2 não fazia, mas `prevMonthPosts` já viabiliza), com alcance anterior >0 |
| Publicações | contagem de posts do mês | **novo**: contagem do mês anterior, retido se o mês anterior não tiver posts (zero = sem dado, não colapso) |
| Visitas ao perfil | snapshot 28d do próprio mês | snapshot 28d do mês anterior, só snapshot-a-snapshot |
| Cliques no link | idem | idem |

Widget sem dados no snapshot (ex: demografia indisponível, KPI sem snapshot) renderiza um estado vazio claro no editor e é omitido no viewer/print.

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

- Função nova **`hub-report-docs`** (auth por token do Hub, padrão de `hub-reports/index.ts`; deploy com `--no-verify-jwt`). A `hub-reports` atual fica intocada. Em toda rota, a função valida a cadeia inteira: token → cliente do token → `report_documents.client_id` do documento pedido → `conta_id` coerente. Documento de outro cliente do mesmo workspace = 404.
- **Contrato de lista**: os relatórios antigos são chaveados por mês (`HubReport.month`, rota `/relatorios/:month`) e os novos são UUIDs, com possivelmente vários por mês. A lista do Hub devolve uma união discriminada (`kind: 'legacy' | 'doc'`, com `month` + `id`/`title` conforme o tipo), e documento novo abre em rota própria sem colisão: `/relatorios/doc/:id`. A rota `:month` legada continua servindo só os antigos.
- Variante `/relatorios/doc/:id/print` da mesma página (sem chrome, CSS print) é a fonte do PDF via Gotenberg `convert/url` (criar variante URL ao lado de `_shared/report-template/pdf.ts`, que hoje usa `convert/html`).
- **Contrato de prontidão do print**: o Hub é uma SPA com fetch assíncrono; a página `/print` seta `window.__REPORT_READY = true` só depois de dados carregados, imagens resolvidas (`document.fonts.ready` + decode das imgs) e blocos renderizados. A `report-docs/:id/pdf` chama o Gotenberg com `waitForExpression: "window.__REPORT_READY === true"` (+ timeout), nunca com delay cego.
- **Auth do print é própria, independente do portal do cliente.** Relatórios são um entitlement separado (`feature_analytics_reports`): um workspace pode tê-lo sem `feature_hub_portal`, e um cliente pode não ter token de Hub ativo. Por isso o PDF NUNCA depende do token do portal: `report-docs/:id/pdf` assina um print token HMAC de curta duração (payload `{docId, exp}`, chave `INTERNAL_FUNCTION_SECRET`, sem estado no banco) e passa ao Gotenberg a URL `/relatorios/print/:docId?pt=<token>`; a rota de dados correspondente em `hub-report-docs` valida o HMAC + expiração e serve o documento sem exigir token de portal nem `feature_hub_portal`. Já a visualização pelo cliente final no Hub continua sob o token do portal e o gate `feature_hub_portal` (é o portal); o botão "Ver como cliente" no editor fica oculto quando o cliente não tem Hub ativo.

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

- **Vitest:** utils do schema de layout (layout padrão, aplicar template, versionamento, validador zod com rejeições), widgets renderizando de fixtures de snapshot (incluindo estados vazios e thumbnail null), dialog de criação.
- **Deno:** rotas de `report-docs` (generate, pdf com regra de cache, refresh-data, delete) e `hub-report-docs` — incluindo os casos negativos de ownership (clientId/templateId/documento de outro workspace = 404) e a cadeia token→cliente→documento do Hub.
- **SQL:** na suíte `supabase/tests/entitlements/`: políticas RLS das tabelas novas, grant de UPDATE restrito a `(layout, title)` (update de `status`/`data_snapshot` por `authenticated` falha), ausência de INSERT/DELETE para `authenticated`, índice único parcial do `is_default` e a RPC de default.
- **Pré-push:** `npm run lint`, `npm run format:check`, os 4 `tsc`, `npm run test`, `npm run test:functions` (e `git checkout -- deno.lock` depois do deno).
- **Browser:** fluxo completo — gerar → editar (arrastar, redimensionar, remover, adicionar, texto) → salvar template → aplicar em outro cliente → ver no Hub → exportar PDF.
