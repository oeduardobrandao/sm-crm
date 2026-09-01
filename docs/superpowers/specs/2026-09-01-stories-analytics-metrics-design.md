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
recem-expirados (~48h). O cron horario existente captura cada story pelo menos 1x antes
da expiracao.

## Decisoes

| Decisao | Escolha | Razao |
|---|---|---|
| Tabela de stories | Separada (`instagram_story_insights`) | Metricas fundamentalmente diferentes de posts (taps/exits vs likes/comments) |
| Coleta | Cron horario existente | Sem infra nova; janela de 24h com cron horario = pelo menos 1 captura |
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

RLS: mesma politica das demais tabelas de analytics — join com `instagram_accounts` ->
`clientes` -> `conta_id` = `get_my_conta_id()`.

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

## 2. Data Collection Pipeline

### 2.1 Novo passo no instagram-sync-cron

Apos o fetch de `me/media` e antes do daily-ingest, adicionar:

1. **Fetch stories ativos**: `GET /me/stories?fields=id,media_type,media_url,thumbnail_url,timestamp`
   - Retorna stories das ultimas 24h (a API so retorna stories vivos ou recem-expirados)
   - Nao ha paginacao: o endpoint retorna todos os stories ativos

2. **Fetch insights por story**: `GET /{storyId}/insights?metric=reach,impressions,replies,taps_forward,taps_back,exits,shares`
   - Uma chamada por story
   - Concorrencia limitada a 3 por vez dentro do pool existente
   - Fallback: se `shares` nao for suportado (stories muito antigos), retry sem `shares`

3. **Upsert em `instagram_story_insights`**: ON CONFLICT do `instagram_media_id` atualiza
   metricas (um story ainda vivo pode ter metricas atualizadas entre execucoes do cron).
   `expired_at` e calculado como `posted_at + interval '24 hours'`.

4. **Agregar em daily**: apos inserir os stories individuais, agregar por
   `date_trunc('day', posted_at)` e incluir no payload do `upsert_metrics_daily`.
   Fonte: rows da propria `instagram_story_insights` (GROUP BY), nao da Graph API.

### 2.2 Novo modulo: `story-ingest.ts`

Isolar a logica de stories num modulo separado dentro de `instagram-sync-cron/`:

```typescript
export async function ingestStories(
  fetch: BoundedFetch,
  accountId: string,
  accessToken: string,
  db: SupabaseClient
): Promise<StoryDailyAgg[]>
```

Retorna os agregados diarios pra inclusao no payload de `upsert_metrics_daily`.

### 2.3 Monthly close de stories

No `monthly-close.ts`, adicionar passo que agrega `instagram_story_insights` do mes
anterior e escreve as colunas `stories_*_month` em `instagram_account_metrics_monthly`.

Fonte: `SELECT ... FROM instagram_story_insights WHERE posted_at >= month_start AND posted_at < month_end GROUP BY instagram_account_id`. Nao usa a Graph API (os dados ja
expiraram). Idempotente: so executa se as colunas de stories estao NULL no row mensal.

O backfill historico (`backfill.ts`) NAO coleta stories retroativamente — a API nao
retorna stories expirados. Meses anteriores a esta feature terao colunas de stories NULL,
o que e o comportamento correto (dados inexistentes, nao zero).

## 3. Analytics API

### 3.1 Novo endpoint: `GET /stories/:clientId`

Adicionado ao router de `instagram-analytics/index.ts`.

**Query params:**
- `days=N` (default 30) — periodo em dias a partir de hoje
- `start=YYYY-MM-DD&end=YYYY-MM-DD` — range customizado (tem precedencia sobre `days`)

**Resolucao de dados:**

- Query direta em `instagram_story_insights` com filtro de `posted_at` no range
- KPIs: SUM/COUNT/AVG dos stories no range atual, mesma query com range anterior
  pra deltas
- Nao ha fallback chain live -> monthly -> daily. Todos os dados residem no banco
  (a API so retorna stories das ultimas 24h, entao nao ha fetch live pra periodos
  passados)

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
  retention_rate: number;  // 1 - (exits / impressions), 0 se impressions = 0
  skip_rate: number;       // taps_forward / impressions
  back_rate: number;       // taps_back / impressions
}

interface StoriesKpis {
  stories_count: number;
  total_reach: number;
  total_impressions: number;
  total_replies: number;
  avg_retention_rate: number;  // media ponderada por impressions
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

Nova funcao:

```typescript
export async function getStoriesAnalytics(
  clientId: number,
  days?: number,
  dateRange?: { start: string; end: string }
): Promise<StoriesAnalyticsResponse>
```

Chama o endpoint `/stories/:clientId` via `callEdgeFunction`.

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
   - Sem paginacao (volume baixo de stories por periodo)

**Query:** `useQuery` com chave `['stories-analytics', clientId, days, dateRange]`,
mesmos triggers de refetch que as demais queries da pagina (mudanca de periodo,
refresh manual).

### 4.3 Responsividade

- KPI grid: em mobile (`< 768px`), colapsa pra 2 colunas (padrao do kpi-grid existente)
- Tabela: `overflow-x: auto` no container pra scroll horizontal em telas estreitas
- Thumbnails: ocultados em `< 640px` pra economizar espaco

## 5. Integracao com relatorios PDF

### 5.1 Layout (`default-layout.ts`)

Nova secao "Stories" apos a secao "Publicacoes", condicional a `hasStories`:

| Bloco | Largura | Conteudo |
|---|---|---|
| `kpi_stories_count` | third | Stories publicados (value + prev) |
| `kpi_stories_reach` | third | Alcance de Stories |
| `kpi_stories_retention` | third | Taxa de retencao media |
| `top_stories` | full | Top 6 stories por alcance (thumbnail + metricas) |

### 5.2 KPIs (`kpis.ts`)

Tres novos KPI IDs: `stories_count`, `stories_reach`, `stories_retention`.
Shape: `{ value: number | null, unit: 'count' | 'pct', prev: number | null }`.

### 5.3 Snapshot source (`snapshot-source.ts`)

Novo campo `stories` no snapshot:
- KPIs: das colunas `stories_*_month` em `instagram_account_metrics_monthly`
- Top stories: query em `instagram_story_insights` WHERE `posted_at` no mes,
  ORDER BY `reach` DESC LIMIT 6, mapeados pra `SnapshotTopStory`:

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
  thumbnail_url: string | null;
}
```

### 5.4 AI narrative

O prompt do Gemini em `report-generator-v2` recebe contexto de stories (se disponivel)
pra incluir na analise. Exemplo: "A taxa de retencao nos stories foi de X%, com Y
respostas." O modelo decide se e relevante incluir na narrativa.

### 5.5 Condicional

Se `stories_count_month` e 0 ou NULL, a secao nao aparece no relatorio. Relatorios de
meses anteriores a esta feature nao terao dados de stories.

## 6. Testes

### 6.1 Edge function tests (Deno)

- `instagram-sync-cron`: test de `story-ingest.ts` com mock da Graph API, verificando
  upsert em `instagram_story_insights` e agregacao em daily
- `instagram-analytics`: test do endpoint `/stories/:clientId` com dados mockados,
  verificando KPIs, rates computados, e range de datas
- Monthly close: test da agregacao mensal de stories

### 6.2 Frontend tests (Vitest)

- `getStoriesAnalytics`: test da chamada ao edge function
- Secao de Stories: render condicional (nao renderiza com 0 stories), KPI cards,
  tabela com dados mockados

## 7. Migracao e deploy

### Ordem de deploy

1. **Migration** — schema (tabela + colunas + RPC) via `supabase db push --linked`
2. **Edge functions** — `instagram-sync-cron` (coleta) + `instagram-analytics` (API)
   em sequencia
3. **Frontend** — PR com a secao de Stories; apos merge, deploy automatico via Vercel
4. **Report pipeline** — `report-docs` e `instagram-report-generator-v2` numa segunda
   fase (pode ser PR separado)

### Observacoes

- Os dados so comecam a acumular apos o deploy do cron. Nao ha backfill de stories
  historicos (a API nao oferece)
- A secao de Stories no frontend sera invisivel ate o primeiro story ser coletado
- Relatorios do mes de deploy podem ter dados parciais de stories (cobertura
  comeca no dia do deploy)
