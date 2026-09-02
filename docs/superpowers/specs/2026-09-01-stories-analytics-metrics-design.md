# Stories Analytics Metrics

Integrar metricas de Instagram Stories no sistema de analytics do CRM: coleta automatica
via cron horario, armazenamento per-story e agregado diario/mensal, endpoint dedicado,
secao na pagina de analytics do cliente, e inclusao nos relatorios PDF.

## Contexto

O CRM ja suporta publicacao de Stories (segmentos, container creation, recovery em
`instagram-publish`), mas nao coleta nenhuma metrica. O sync cron busca apenas `me/media`
(feed), o webhook ignora `story_insights`, e nao existe tabela de metricas de stories.

Os scopes OAuth atuais (`instagram_business_manage_insights`) ja cobrem leitura de
insights de Stories. Nao e necessario scope adicional.

Stories sao efemeros (24h) e a Graph API so retorna metricas de stories vivos ou
recem-expirados (~48h). O cron horario coleta stories de cada conta selecionada para
sync. Contas podem ser deferidas alem de 24h se o lote estiver cheio (o seletor em
`select.ts` ordena por `last_sync_attempt_at` stalest-first, com lote limitado). Isso
significa que stories de contas deferidas podem expirar sem coleta. Esse e um trade-off
aceito: o mesmo risco ja existe pra metricas de posts (revisoes D-1..D-3 atrasam), e
aumentar a frequencia do cron so pra stories nao justifica a complexidade. Se o volume
de contas crescer a ponto de deferral ser frequente, o lote deve ser aumentado — nao e
responsabilidade desta feature.

## Decisoes

| Decisao | Escolha | Razao |
|---|---|---|
| Tabela de stories | Separada (`instagram_story_insights`) | Metricas fundamentalmente diferentes de posts (taps/exits vs likes/comments) |
| Coleta | Cron horario existente | Sem infra nova; janela de 24h com cron horario = captura na maioria dos casos |
| Metricas coletadas | reach, impressions, replies, taps_forward, taps_back, exits, shares | Navegacao completa: permite calcular retencao e skip rate |
| Agregados | Colunas em daily/monthly | Segue o padrao existente; funciona com a fallback chain |
| UI | Secao separada na pagina de analytics | Entre BaselineCard e "Desempenho por Tipo" |
| Relatorios | Secao condicional | Nao aparece em meses sem dados |

## 1. Database Schema

### 1.1 Nova tabela: `instagram_story_insights`

```sql
CREATE TABLE instagram_story_insights (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_account_id uuid NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  instagram_media_id   text NOT NULL,
  media_type      text NOT NULL DEFAULT 'STORY',
  thumbnail_url   text,
  posted_at       timestamptz NOT NULL,
  expired_at      timestamptz NOT NULL,  -- posted_at + interval '24 hours'
  reach           integer,
  impressions     integer,
  replies         integer,
  taps_forward    integer,
  taps_back       integer,
  exits           integer,
  shares          integer,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, instagram_media_id)
);

CREATE INDEX idx_story_insights_account_posted
  ON instagram_story_insights (instagram_account_id, posted_at DESC);
```

**RLS:** service_role-only, mesmo padrao de `instagram_account_metrics_daily` e
`instagram_account_metrics_monthly`. A tabela nao e acessada diretamente pelo frontend;
o endpoint de analytics roda como service_role e faz ownership check por conta propria.

```sql
ALTER TABLE instagram_story_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON instagram_story_insights
  USING (auth.role() = 'service_role');
```

### 1.2 Colunas novas em `instagram_account_metrics_daily`

```sql
ALTER TABLE instagram_account_metrics_daily
  ADD COLUMN stories_count_day       integer,
  ADD COLUMN stories_reach_day       integer,
  ADD COLUMN stories_impressions_day integer,
  ADD COLUMN stories_replies_day     integer,
  ADD COLUMN stories_taps_forward_day integer,
  ADD COLUMN stories_taps_back_day   integer,
  ADD COLUMN stories_exits_day       integer;
```

### 1.3 Colunas novas em `instagram_account_metrics_monthly`

```sql
ALTER TABLE instagram_account_metrics_monthly
  ADD COLUMN stories_count_month       integer,
  ADD COLUMN stories_reach_month       integer,
  ADD COLUMN stories_impressions_month integer,
  ADD COLUMN stories_replies_month     integer,
  ADD COLUMN stories_taps_forward_month integer,
  ADD COLUMN stories_taps_back_month   integer,
  ADD COLUMN stories_exits_month       integer;
```

### 1.4 RPC `upsert_metrics_daily` atualizada

Adicionar as 7 colunas de stories com o mesmo padrao COALESCE:

```sql
stories_count_day       = COALESCE(EXCLUDED.stories_count_day,       t.stories_count_day),
stories_reach_day       = COALESCE(EXCLUDED.stories_reach_day,       t.stories_reach_day),
stories_impressions_day = COALESCE(EXCLUDED.stories_impressions_day, t.stories_impressions_day),
stories_replies_day     = COALESCE(EXCLUDED.stories_replies_day,     t.stories_replies_day),
stories_taps_forward_day = COALESCE(EXCLUDED.stories_taps_forward_day, t.stories_taps_forward_day),
stories_taps_back_day   = COALESCE(EXCLUDED.stories_taps_back_day,   t.stories_taps_back_day),
stories_exits_day       = COALESCE(EXCLUDED.stories_exits_day,       t.stories_exits_day)
```

### 1.5 Migration

Prefixo de versao: `20260902000010` (o namespace `20260901*` ja tem 7 migrations;
usar `20260902` evita colisao). Verificar contra `origin/main` antes de abrir o PR
com `git ls-tree origin/main:supabase/migrations | tail`.

Uma unica migration contendo: CREATE TABLE, ALTER TABLEs, RLS policy, e
CREATE OR REPLACE da RPC `upsert_metrics_daily` com as novas colunas.

## 2. Data Collection Pipeline

### 2.1 Novo passo no instagram-sync-cron

Apos o fetch de `me/media` e antes do daily-ingest, adicionar:

1. **Fetch stories ativos**: `GET /me/stories?fields=id,media_type,media_url,thumbnail_url,timestamp`
   - Retorna stories das ultimas 24h (a API so retorna stories vivos ou recem-expirados)
   - Nao ha paginacao: o endpoint retorna todos os stories ativos

2. **Fetch insights por story**: `GET /{storyId}/insights?metric=reach,impressions,replies,taps_forward,taps_back,exits,shares`
   - Uma chamada por story, com `AbortSignal.timeout(10_000)` por chamada.
     Nota: `fetchPostInsights` (em `_shared/instagram-metrics.ts`) NAO usa
     AbortSignal. O timeout aqui segue o padrao das chamadas account-level em
     `index.ts:147` (`AbortSignal.timeout(15_000)`), adaptado pra 10s por ser
     uma chamada mais leve (um story vs um dia inteiro de metricas)
   - **Concorrencia:** maximo 5 chamadas simultaneas via `runPool` (ou equivalente).
     Se a conta tiver mais de 50 stories ativos, processar apenas os 50 mais
     recentes (cap defensivo; improvavel na pratica)
   - Fallback: se `shares` nao for suportado, retry sem `shares`
   - **Timeout individual:** se um story timeout, logar e prosseguir pros demais
     (graceful degradation por story, nao por lote)

3. **Upsert em `instagram_story_insights`**: ON CONFLICT de
   `(instagram_account_id, instagram_media_id)` (target composto, alinhado com a
   constraint UNIQUE). Atualiza metricas com **semantica de preservacao**: cada
   coluna usa COALESCE para nao sobrescrever valores validos com NULL de erros
   transientes. Atualiza `synced_at` no conflito. `expired_at` e calculado como
   `posted_at + interval '24 hours'`.

   ```sql
   ON CONFLICT (instagram_account_id, instagram_media_id) DO UPDATE SET
     reach       = COALESCE(EXCLUDED.reach, instagram_story_insights.reach),
     impressions = COALESCE(EXCLUDED.impressions, instagram_story_insights.impressions),
     replies     = COALESCE(EXCLUDED.replies, instagram_story_insights.replies),
     taps_forward = COALESCE(EXCLUDED.taps_forward, instagram_story_insights.taps_forward),
     taps_back   = COALESCE(EXCLUDED.taps_back, instagram_story_insights.taps_back),
     exits       = COALESCE(EXCLUDED.exits, instagram_story_insights.exits),
     shares      = COALESCE(EXCLUDED.shares, instagram_story_insights.shares),
     synced_at   = now()
   ```

4. **Cache de thumbnails durante ingest**: stories tem URLs CDN que expiram junto
   com o story (~24-48h). O cache DEVE ocorrer durante o ingest (enquanto a URL
   e valida), nao durante a geracao do relatorio. Usar
   `isEphemeralInstagramUrl(url)` + `cachePostThumbnail()` pra converter URLs
   efemeras em URLs estaveis no storage. O `thumbnail_url` gravado na tabela deve
   ser a URL estavel pos-cache (ou a original se nao for efemera).

5. **Agregar em daily**: apos inserir os stories individuais, agregar por
   `(posted_at AT TIME ZONE 'UTC')::date` (UTC explicito, nao depende do timezone
   da sessao) e incluir no payload do `upsert_metrics_daily`.
   Fonte: rows da propria `instagram_story_insights` (GROUP BY), nao da Graph API.

### 2.2 Novo modulo: `story-ingest.ts`

Isolar a logica de stories num modulo separado dentro de `instagram-sync-cron/`:

```typescript
export async function ingestStories(
  fetch: typeof globalThis.fetch,
  accountId: string,
  igAccountId: string,
  accessToken: string,
  db: SupabaseClient
): Promise<StoryDailyAgg[]>
```

Cada chamada Graph usa `AbortSignal.timeout(10_000)` pra evitar que um story preso
consuma a execucao inteira (padrao das chamadas account-level de `index.ts`, nao de
`fetchPostInsights` que nao usa timeout). Se o fetch de `me/stories` falhar, o erro e
logado e a funcao retorna `[]` (graceful degradation — a coleta de stories nao deve
bloquear a coleta de feed). Story insights sao coletados com concorrencia 5 via pool,
cap de 50 stories por conta.

Retorna os agregados diarios pra inclusao no payload de `upsert_metrics_daily`.

### 2.3 Monthly close de stories

A logica existente em `closePreviousMonthIfMissing` retorna cedo se o row mensal ja
existe (guard de idempotencia em `monthly-close.ts:63`). Isso significa que colunas
`stories_*_month` NULL em rows ja criados nunca seriam preenchidas.

Solucao: apos o `closePreviousMonthIfMissing` existente, adicionar um passo
`closeStoriesForMonth` que faz UPDATE parcial:

```sql
UPDATE instagram_account_metrics_monthly
SET stories_count_month = $1, stories_reach_month = $2, ...
WHERE instagram_account_id = $3 AND month = $4
  AND stories_count_month IS NULL
```

O `WHERE stories_count_month IS NULL` garante idempotencia: so roda uma vez.

**Sinal de cobertura:** o update so seta as colunas de stories se a conta tem pelo
menos um row em `instagram_account_metrics_daily` do mes com `stories_count_day IS
NOT NULL` (prova de que o sync com stories rodou ao menos uma vez no mes). Se nenhum
daily row tiver dados de stories, as colunas ficam NULL — nao 0. Isso distingue:
- **NULL** = feature nao existia OU conta nao foi sincronizada com stories no mes
- **0** = conta foi sincronizada e genuinamente nao teve stories

A fonte e agregacao de `instagram_story_insights` do mes combinada com a verificacao
do sinal de cobertura nos daily rows.

O backfill historico (`backfill.ts`) NAO coleta stories retroativamente — a API nao
retorna stories expirados. Meses anteriores a esta feature terao colunas de stories NULL,
o que e o comportamento correto (dados inexistentes, nao zero).

## 3. Analytics API

### 3.1 Novo endpoint: `GET /stories/:clientId`

Adicionado ao router de `instagram-analytics/index.ts`.

**Query params:**
- `days=N` (default 30) — periodo em dias a partir de hoje
- `start=YYYY-MM-DD&end=YYYY-MM-DD` — range customizado (tem precedencia sobre `days`)

**Semantica de periodo (alinhada com `account-metrics.ts`):**
- Todas as datas sao interpretadas em UTC
- `end` e inclusivo (o dia inteiro e incluido: `posted_at < end + 1 day`)
- `effectiveEnd` e clamped a hoje (datas futuras sao truncadas)
- Range maximo: 365 dias (retorna 400 se exceder)
- Periodo anterior: mesma duracao, terminando no dia antes de `start`
- Se `start > end` ou datas invalidas: retorna 400

**Resolucao de dados:**

- Query direta em `instagram_story_insights` com filtro de `posted_at` no range.
  **Todas as queries de data usam UTC explicito:**
  `WHERE posted_at >= start::timestamptz AND posted_at < (end + interval '1 day')::timestamptz`
  (service_role client, mesmo padrao dos demais endpoints)
- KPIs: agregados do range atual + range anterior pra deltas
- Nao ha fallback chain live -> monthly -> daily. Todos os dados residem no banco
- **Limite de resposta:** maximo 200 stories por request, ordenados por `reach DESC`.
  Para o caso de uso tipico (30 dias), o volume e baixo (~300 stories max). O cap
  de 200 e defensivo pra ranges longos (365d)

**Formulas de agregacao (KPIs):**

```
stories_count       = COUNT(*)
total_reach         = SUM(reach)
total_impressions   = SUM(impressions)
total_replies       = SUM(replies)
total_exits         = SUM(exits)

-- Taxas: razao dos totais (nao media de taxas por story), pra evitar
-- distorcao por stories com poucos impressions
avg_retention_rate  = 1 - (SUM(exits) / NULLIF(SUM(impressions), 0))
avg_skip_rate       = SUM(taps_forward) / NULLIF(SUM(impressions), 0)
```

Quando `SUM(impressions)` e 0 ou NULL, as taxas retornam 0.

**Formulas per-story (computed no endpoint):**

```
retention_rate = 1 - (exits / NULLIF(impressions, 0))   -- 0 se impressions = 0
skip_rate      = taps_forward / NULLIF(impressions, 0)   -- 0 se impressions = 0
back_rate      = taps_back / NULLIF(impressions, 0)      -- 0 se impressions = 0
```

**Shape de resposta:**

```typescript
interface StoriesAnalyticsResponse {
  stories: StoryInsight[];
  kpis: {
    current: StoriesKpis;
    previous: StoriesKpis | null;
  };
}

interface StoryInsight {
  instagram_media_id: string;
  media_type: string;
  thumbnail_url: string | null;
  posted_at: string;
  reach: number;
  impressions: number;
  replies: number;
  taps_forward: number;
  taps_back: number;
  exits: number;
  shares: number;
  retention_rate: number;
  skip_rate: number;
  back_rate: number;
}

interface StoriesKpis {
  stories_count: number;
  total_reach: number;
  total_impressions: number;
  total_replies: number;
  avg_retention_rate: number;
  avg_skip_rate: number;
  total_exits: number;
}
```

**Auth e ownership:** mesmo padrao dos endpoints existentes — verifica JWT, resolve
`conta_id`, confirma ownership do client.

### 3.2 Endpoints existentes: sem mudanca

- `GET /account-metrics/:clientId` — nao inclui stories; KPIs de stories ficam no
  endpoint dedicado
- `GET /posts-analytics/:clientId` — stories nao aparecem na tabela de posts

## 4. Frontend

### 4.1 Service layer (`analytics.ts`)

Nova funcao usando o padrao `fetchEdge<T>` existente (wrapper de `fetch` com
`getAuthHeaders()`, definido em `analytics.ts:34`):

```typescript
export async function getStoriesAnalytics(
  clientId: number,
  days?: number,
  dateRange?: { start: string; end: string }
): Promise<StoriesAnalyticsResponse | null>
```

Constroi a URL a partir de `EDGE_URL` + `/stories/${clientId}` com query params.
Retorna `null` em caso de erro (mesmo padrao de `getAudienceDemographics`).

**Estado de erro no UI:** `useQuery` com `enabled: !!clientId`. Loading state exibe
skeleton nos KPI cards. Error/null state nao renderiza a secao (graceful absence,
igual ao comportamento de demographics quando falha).

### 4.2 Secao na pagina de analytics (`AnalyticsContaPage.tsx`)

**Posicao:** entre `BaselineCard` e o bloco `widgets-grid` de "Desempenho por Tipo".

**Condicional:** so renderiza se `storiesQuery.data?.stories.length > 0` ou
`kpis.current.stories_count > 0`. Sem empty state.

**Componentes:**

1. **Header**: icone + titulo "Stories"

2. **StatCardGrid (maxCols={4})** com 4 KpiCards:

   | Card | Icone | Tone | Metrica |
   |---|---|---|---|
   | Stories publicados | Film | blue | stories_count |
   | Alcance de Stories | Eye | violet | total_reach |
   | Taxa de retencao | ChevronRight | green | avg_retention_rate (%) |
   | Respostas | MessageCircle | pink | total_replies |

   Cada card com delta vs periodo anterior, footnote com period chip e valor anterior.

3. **Tabela de stories** dentro de `.card.animate-up`:
   - Colunas: thumbnail, data, alcance, impressoes, retencao (badge colorido),
     avancaram, voltaram, saidas, respostas, compartilhamentos
   - Retencao badge: verde >70%, amarelo 50-70%, vermelho <50%
   - Thumbnail com borda gradiente estilo Instagram Stories
   - Ordenavel pelas colunas numericas, default por data decrescente
   - Sem paginacao no frontend (API retorna max 200 stories por reach DESC)

**Query:** `useQuery` com chave `['stories-analytics', clientId, days, dateRange]`,
mesmos triggers de refetch que as demais queries da pagina (mudanca de periodo,
refresh manual).

### 4.3 Responsividade

- KPI grid: em mobile (`< 768px`), colapsa pra 2 colunas (padrao do kpi-grid existente)
- Tabela: `overflow-x: auto` no container pra scroll horizontal em telas estreitas
- Thumbnails: ocultados em `< 640px` pra economizar espaco

## 5. Integracao com relatorios PDF

### 5.1 Block types e registros do editor

Quatro novos tipos: `kpi_stories_count`, `kpi_stories_reach`,
`kpi_stories_retention`, `top_stories`. Registros necessarios em **cinco** pontos:

1. **`_shared/report-docs/layout.ts`** — adicionar ao array `BLOCK_TYPES`
2. **`packages/report-blocks/BlockRenderer.tsx`** — adicionar ao `BLOCK_COMPONENTS`
   (KPI cards usam `KpiCardBlock`; `top_stories` precisa de componente novo
   `TopStoriesBlock`)
3. **`packages/report-blocks/catalog.ts`** — adicionar ao `WIDGET_CATALOG` na
   categoria 'Numeros' (KPIs) e 'Conteudo' (`top_stories`)
4. **`apps/crm/src/pages/relatorio-editor/widgetIcons.ts`** — adicionar ao
   `WIDGET_ICONS` (e.g., Film, Eye, ChevronRight/Percent, Trophy)
5. **`packages/report-blocks/data-presence.ts`** — adicionar cases no
   `blockHasData`: KPIs checam `snapshot.kpis[id]`, `top_stories` checa
   `snapshot.stories?.top_stories.length > 0`

Sem esses cinco registros, os blocos validam e renderizam via JSON manual mas NAO
aparecem no drawer "Adicionar widget" do editor.

### 5.2 Layout (`default-layout.ts`)

Nova secao "Stories" apos a secao "Publicacoes", condicional a `hasStories`:

| Bloco | Largura | Conteudo |
|---|---|---|
| `kpi_stories_count` | third | Stories publicados (value + prev) |
| `kpi_stories_reach` | third | Alcance de Stories |
| `kpi_stories_retention` | third | Taxa de retencao media |
| `top_stories` | full | Top 6 stories por alcance (thumbnail + metricas) |

**Escopo:** esta secao so aparece em novos documentos criados com o layout padrao.
Layouts ja customizados/congelados nao recebem stories automaticamente — o usuario
pode adiciona-los manualmente via editor de layout. Nao ha migracao de templates
existentes.

### 5.3 KPIs (`kpis.ts`)

Tres novos KPI IDs: `stories_count`, `stories_reach`, `stories_retention`.
Shape: `{ value: number | null, unit: 'count' | 'pct', prev: number | null }`.

### 5.4 Snapshot source (`snapshot-source.ts`)

Novo campo `stories` no snapshot:
- KPIs: das colunas `stories_*_month` em `instagram_account_metrics_monthly`
- Top stories: query em `instagram_story_insights` WHERE `posted_at` no mes,
  ORDER BY `reach` DESC LIMIT 6

**Thumbnail caching:** as URLs de thumbnails de stories ja foram cacheadas durante
o ingest (§2.1 passo 4) — o `thumbnail_url` na tabela e a URL estavel pos-cache.
O snapshot source le direto da tabela sem necessidade de re-cache. Como fallback
defensivo, se `isEphemeralInstagramUrl(url)` retornar true (edge case: story
inserido antes do deploy do caching de ingest), tenta `cachePostThumbnail()` —
mas a URL provavelmente ja expirou, entao o thumbnail sera `null`.

Mapeados pra `SnapshotTopStory`:

```typescript
interface SnapshotTopStory {
  type: 'story';
  reach: number;
  impressions: number;
  replies: number;
  taps_forward: number;
  exits: number;
  retention_rate: number;
  date: string | null;
  thumbnail_url: string | null;  // URL estavel pos-cache
}
```

### 5.5 AI narrative

O contexto de stories e adicionado em **`snapshotToReportData()`**
(`_shared/report-docs/ai-input.ts`), que alimenta o pipeline de IA dos relatorios de
blocos (a pipeline vigente). O `report-generator-v2` e o pipeline legado e NAO e
alterado. O `ReportData` recebe um campo `stories_summary` opcional com
`{ count, avg_retention_rate, total_replies }`. Exemplo: "A taxa de retencao nos
stories foi de X%, com Y respostas." O modelo decide se e relevante incluir na
narrativa.

### 5.6 Condicional

Se `stories_count_month` e 0 ou NULL, a secao nao aparece no relatorio. Relatorios de
meses anteriores a esta feature nao terao dados de stories.

## 6. Testes

### 6.1 Edge function tests (Deno)

- `instagram-sync-cron`: test de `story-ingest.ts` com mock da Graph API, verificando
  upsert em `instagram_story_insights` (target composto) e agregacao em daily
- `instagram-analytics`: test do endpoint `/stories/:clientId` com dados mockados,
  verificando KPIs, rates computados, range de datas, e edge cases (impressions=0,
  range invalido, range >365d)
- Monthly close: test da agregacao mensal de stories, incluindo o caso de row mensal
  pre-existente com stories columns NULL

### 6.2 Frontend tests (Vitest)

- `getStoriesAnalytics`: test da chamada ao edge function via fetchEdge
- Secao de Stories: render condicional (nao renderiza com 0 stories), KPI cards,
  tabela com dados mockados

## 7. Migracao e deploy

### Ordem de deploy

1. **Migration** — schema (tabela + colunas + RPC) via `supabase db push --linked`.
   Prefixo `20260902000010` (verificar contra main antes do push)
2. **Edge functions** — `instagram-sync-cron` (coleta) + `instagram-analytics` (API)
   em sequencia
3. **Frontend** — PR com a secao de Stories; apos merge, deploy automatico via Vercel
4. **Report pipeline** — `report-docs`, `report-blocks`, e `instagram-report-generator-v2`
   numa segunda fase (pode ser PR separado). Inclui: BLOCK_TYPES, BLOCK_COMPONENTS,
   snapshot source, thumbnail caching, KPIs, default layout, AI prompt

### Observacoes

- Os dados so comecam a acumular apos o deploy do cron. Nao ha backfill de stories
  historicos (a API nao oferece)
- A secao de Stories no frontend sera invisivel ate o primeiro story ser coletado
- Relatorios do mes de deploy podem ter dados parciais de stories (cobertura
  comeca no dia do deploy)
- Contas deferidas pelo seletor do cron podem perder stories (trade-off aceito)
