# Paridade dos KPIs com o app do Instagram + histórico próprio de métricas diárias

**Data:** 2026-08-31
**Status:** aprovado pelo Eduardo (design), aguardando plano de implementação
**Origem:** relatório de agosto da Healing Hands By Marilia (client_id 411). A cliente
comparou o relatório de blocos com o app do Instagram e o agente dela apontou
discrepâncias graves. Auditoria confirmou cada número (sessão 2026-08-31).

## 1. Problema

Os KPIs do relatório misturam três bases diferentes sem sinalizar nenhuma:

| Card | Base atual | O que o app mostra | Resultado no caso real |
|---|---|---|---|
| Novos seguidores | delta de snapshots nossos (`instagram_account_metrics_daily` fechamento-a-fechamento; fallback primeiro/último ponto do `instagram_follower_history` dentro do mês) | breakdown follows − unfollows (+115/−66 = +49) | relatório disse **7**: conta conectada 26/08, o fallback mediu 5 dias e rotulou como o mês |
| Alcance | **soma do reach por post** dos posts publicados no mês | alcance de conta (viewers únicos, inclui stories/posts antigos) | relatório 6.631 vs app 10.281; −93,3% vs julho causado por 1 post viral (88.086 de 98.506) |
| Salvamentos | soma de `saved` por post | saves de conta (todo conteúdo) | 15 (−71,2%) — aritmética certa, base errada e comparada contra mês viral |
| Visitas ao perfil | 🐛 coluna `profile_views_28d` recebe **`accounts_engaged`** (bug de mapeamento no sync cron, `instagram-sync-cron/index.ts:162`) e é janela 28d móvel, não o mês | profile views do período | número sem correspondência com tela nenhuma |
| Cliques no link | métrica certa, janela 28d móvel do dia do snapshot | cliques do período selecionado | janela não é a do relatório |
| Visualizações | ✅ métrica `views` de conta, ao vivo, janela do mês (`report-docs/account-views.ts`) | views do período | **47.007 vs 46.129 — bateu** (diferença = mês-calendário vs 30d móveis) |
| Taxa de engajamento | interações ÷ alcance somados por post | (não existe no app) | crítica "conteúdo menos salvável" derivada de base distorcida |

O card de Visualizações prova a tese: o único KPI que busca a métrica de conta ao
vivo é o único que bate com o app.

**Fato-chave que viabiliza tudo:** os insights de conta da Graph API cobrem os
últimos ~90 dias **independente de quando a conta foi conectada ao Mesaas**. O
relatório da Healing Hands (conectada dia 26) obteve views do mês inteiro; teria
obtido alcance, saves e follows também.

## 2. Objetivo e não-objetivos

**Objetivo (nesta ordem de prioridade):**
1. Todo KPI que tem equivalente no app do Instagram vem da mesma métrica de conta
   da Graph API, na janela do mês-calendário do relatório — e bate com o app quando
   o usuário seleciona o mesmo período custom lá.
2. Snapshots diários viram ativo próprio: ingerimos os valores **por-dia** de cada
   métrica, construindo histórico ilimitado (a Meta só guarda 90 dias) e recursos
   futuros (tendências, comparações longas).

**Escopo:** relatório de blocos (report-docs), página de Analytics do CRM e
relatórios do Hub — tudo nesta iniciativa (decisão do Eduardo).

**Não-objetivos:**
- Reproduzir a janela "últimos 30 dias" móvel do app. O relatório é mês-calendário;
  os cards estampam o período para o usuário comparar com o range custom do app.
- Remover análises por post (top posts, formato líder, tags). Elas continuam como
  seção separada, rotulada como análise nossa — só deixam de se passar por métricas
  de conta.
- Stories no breakdown de formato (fica para iniciativa futura).

## 3. Spike de validação (bloqueia o resto)

Antes de qualquer código de produção. Entregável: **matriz de capacidades por
métrica**, registrada no topo do plano de implementação, com uma linha para cada
métrica de `AccountMetric` contendo: suporte a `metric_type=total_value`,
breakdown disponível (o SDK oficial da Meta documenta `follow_type` para
follows/unfollows — não `follower_type`), shape da resposta nas duas formas
(agregado e série diária), range máximo por request, retenção, disponibilidade
de série diária com timestamp, e **plano B quando a série diária não existir**
para aquela métrica. A arquitetura de §4.1/§4.2 só se materializa em colunas e
funções depois dessa matriz — `fetchAccountDaily` pressupõe `values[]` por dia
para toda métrica, e isso é hipótese até o spike provar.

Testes obrigatórios do spike:

1. **Reach com deduplicação, no caminho de produção:** executar EXATAMENTE o
   caminho que o código usará (chunking incluso) para 01–31/08 da Healing Hands
   e comparar com os 10.281 do print. Atenção dupla: (a) `total_value` pode
   somar diários sem deduplicar visitantes entre dias; (b) reach é contagem de
   ÚNICOS e não é aditivo — um mês de 31 dias fatiado nos chunks de 30+1 do
   helper atual (`views.ts:chunkRange`) conta duas vezes quem apareceu nos dois
   chunks, mesmo que cada chunk seja deduplicado. Testar também se um request
   único de 31 dias é aceito. Se a API não entregar o número do app, o card
   vira "Alcance acumulado" com tooltip honesto e a spec é emendada — não
   prometemos paridade que a API não entrega. Mesmo tratamento para
   `accounts_engaged` (também é contagem de únicos).
2. **Semântica de "vazio":** a Graph retorna conjunto vazio quando uma métrica
   está indisponível — isso DEVE normalizar para null, nunca 0.
3. **Latência de finalização:** medir se o valor de um dia fechado (D-1) ainda
   muda nos dias seguintes (insights revisados/atrasados), para calibrar a
   janela de reconsulta de §4.2.

Caso de teste permanente: Healing Hands, agosto/2026, prints do app em mãos.

## 4. Arquitetura

### 4.1 Módulo compartilhado `supabase/functions/_shared/instagram-account-metrics.ts`

Generalização de `instagram-analytics/views.ts` (que já resolve clamp de retenção
de 90 dias, chunks de 30 dias e janela half-open `[since, until)`):

```ts
type AccountMetric =
  | "reach" | "views" | "saves" | "accounts_engaged"
  | "profile_views" | "website_clicks" | "follows_and_unfollows";

interface AccountTotals {
  reach: number | null;            // null = fetch falhou/fora da retenção;
  views: number | null;            // NUNCA derruba o chamador.
  saves: number | null;
  accounts_engaged: number | null;
  profile_views: number | null;
  website_clicks: number | null;
  follows_and_unfollows: { follows: number; unfollows: number; net: number } | null;
}

// Agregado da janela (KPIs de relatório/endpoint): metric_type=total_value.
fetchAccountTotals(fetchFn, accessToken, metrics, sinceSec, untilSec): Partial<AccountTotals>

// Série por-dia (ingestão do cron + backfill): period=day SEM total_value,
// normalizada para um valor por dia UTC. Mesmos campos, um registro por data.
fetchAccountDaily(fetchFn, accessToken, metrics, sinceSec, untilSec): Map<date, Partial<AccountTotals>>
```

O contrato tem DUAS funções porque os consumidores têm semânticas diferentes
(agregado da janela vs série diária persistida) e a Graph responde com shapes
diferentes (`total_value.value` vs `values[]` por dia). A normalização de cada
shape — incluindo o breakdown de follows/unfollows (`follow_type`, conforme SDK
da Meta; confirmar no spike) — é responsabilidade deste módulo; nenhum
consumidor toca resposta crua da Graph. A forma diária de cada métrica é
CONDICIONAL à matriz do spike (§3): métrica sem série diária na API fica fora
de `fetchAccountDaily` e usa o plano B da matriz.

Regras semânticas do módulo:

- **Vazio ≠ zero:** resposta com conjunto de dados vazio normaliza para null,
  nunca 0 (é assim que a Graph sinaliza métrica indisponível).
- **Métricas de únicos não são aditivas:** `reach` e `accounts_engaged` contam
  usuários únicos no intervalo. `fetchAccountTotals` NUNCA soma chunks para
  elas: a janela é atendida em UM request quando couber no range máximo da API;
  não cabendo, o resultado é null (ou o rótulo "acumulado" do plano B do spike
  — decisão selada pelo spike, não pelo implementador). O `sumViewsRange`
  atual, que soma chunks, permanece válido só para métricas aditivas (views é
  contagem de eventos).
- Janela parcial fora da retenção → null; timeout por request; erro 190 →
  TOKEN_EXPIRED tipado (regras herdadas de views.ts). Uma chamada Graph por
  métrica, em paralelo. `views.ts` passa a reexportar/usar este módulo.

`follower_count` NÃO faz parte de `AccountMetric`: é uma métrica diária à parte
da Graph (retenção ~30 dias), atendida por um helper dedicado
`fetchFollowerCountDaily` que alimenta só `instagram_follower_history`.

Consumidores: report-docs, instagram-analytics (endpoint novo de range, §4.4),
sync cron. (O gerador legado v2 está fora — §4.5.)

### 4.2 Sync cron: snapshot diário correto e enriquecido

`instagram-sync-cron` hoje grava janelas 28d móveis com mapeamento errado
(`views`→`impressions_28d`, `accounts_engaged`→`profile_views_28d`). Mudanças:

1. **Colunas novas por-dia** em `instagram_account_metrics_daily` (migration):
   `reach_day`, `views_day`, `saves_day`, `accounts_engaged_day`,
   `profile_views_day`, `website_clicks_day`, `follows_day`, `unfollows_day`
   (todas `integer` nullable — null = métrica indisponível naquele dia).
   **Regra de finalização:** as colunas `*_day` só recebem DIAS COMPLETOS — o
   cron reconsulta uma **janela móvel de dias fechados (D-1 a D-3 UTC)** via
   `fetchAccountDaily`, nunca o dia corrente. A janela móvel existe porque
   "D-1 gravado" não prova valor finalizado pela Meta: insights podem chegar ou
   ser revisados depois, e parar de consultar o dia congelaria uma subestimativa
   permanente. O spike (§3.3) mede essa latência e calibra a largura da janela.
   As colunas já existentes (`followers_count`, `*_28d`) continuam sendo o
   snapshot point-in-time do dia corrente, como hoje.
   **Escrita via RPC SQL atômica** `upsert_metrics_daily(rows jsonb)` com
   `INSERT ... ON CONFLICT DO UPDATE SET col = COALESCE(EXCLUDED.col, t.col)`
   por coluna `*_day`: valor novo não-null SEMPRE vence (é a reconsulta da
   janela móvel corrigindo o dia), null NUNCA apaga valor válido (falha
   por-métrica numa rodada não destrói o que outra gravou). O `.upsert()` do
   supabase-js não expressa COALESCE, e read-before-write criaria corrida entre
   execuções do cron — por isso RPC, sem exceção.
2. **Correção do mapeamento 28d:** `accounts_engaged` ganha coluna própria
   (`accounts_engaged_28d`); `profile_views_28d` passa a receber a métrica correta
   de profile views (conforme spike). As colunas `*_28d` continuam existindo
   enquanto houver consumidor (CRM Analytics as lê hoje); somem numa migration
   posterior quando 4.4 concluir.
3. **Backfill de 90 dias — durável, com seletor e orçamento PRÓPRIOS** (não no
   handler OAuth: ele é request-scoped e um fire-and-forget morreria com a
   request, reportando sucesso da conexão e deixando buracos permanentes).
   O seletor de sync atual NÃO serve: ele filtra `auto_sync_enabled=true` +
   `feature_auto_sync_cron` + staleness de 6h (`select.ts`), então uma conta
   com relatórios habilitados mas auto-sync desligado nunca seria backfillada.
   Mecânica:
   - Migration adiciona em `instagram_accounts`:
     `metrics_backfilled_at timestamptz` (null = pendente) e
     `metrics_backfill_cursor date` (checkpoint: dia mais antigo já ingerido).
   - **Passo de backfill separado no cron**, com seletor próprio
     (`authorization_status='active'` + token presente +
     `metrics_backfilled_at is null`; independente de `auto_sync_enabled` e do
     feature de auto-sync — histórico serve a relatórios de qualquer plano) e
     **orçamento próprio por tick** (`BACKFILL_BATCH_LIMIT`, poucas contas
     e/ou poucos chunks por tick): 25 contas × 7 métricas × 3 chunks ≈ 525
     chamadas Graph não cabem no wall-clock de ~30s do batch atual.
   - **Checkpoint por chunk:** o backfill anda do presente para trás em chunks
     de 30d, atualizando `metrics_backfill_cursor` após cada chunk persistido.
     Execução morta retoma do cursor no próximo tick (upsert idempotente);
     `metrics_backfilled_at` é gravado quando o cursor alcança o horizonte de
     retenção. Status observável pelas duas colunas.
   - `instagram_follower_history` ganha o que `fetchFollowerCountDaily`
     oferecer (retenção ~30 dias — backfill parcial é esperado e aceito).
4. **Fechamento de mês:** na virada do mês (primeiro tick com o mês anterior
   completo), o cron busca e persiste o **agregado fechado do mês anterior** —
   um request de janela-do-mês por métrica via `fetchAccountTotals` — em tabela
   nova `instagram_account_metrics_monthly` (`instagram_account_id`, `month`,
   uma coluna por métrica, RLS service-role-only). Motivo: para métricas de
   únicos (reach, accounts_engaged) a série diária NÃO reconstrói o mês (soma
   de diários conta a mesma pessoa várias vezes) — o agregado fechado é a ÚNICA
   forma de histórico paritário além dos 90 dias da Meta. Para as aditivas a
   linha mensal é redundância barata que simplifica o fallback de §4.3.
   O "close" de seguidores de um mês é o `followers_count` da linha do ÚLTIMO
   DIA do mês. "Cobertura completa" de uma métrica num mês = todos os dias do
   mês com `*_day` não-null. São essas as definições que os fallbacks de §4.3
   usam — nunca "última linha disponível dentro do mês", que foi exatamente o
   que produziu o "7" da Healing Hands.

### 4.3 Relatório de blocos (report-docs)

`_shared/report-docs/kpis.ts` muda de contrato. Nova cadeia de fontes por KPI,
sempre respeitando a invariante existente (valor e prev SEMPRE da mesma base;
sem prev comparável → prev = null; sem valor → card se omite):

| KPI | Fonte primária (geração) | Fallback | Sem dado |
|---|---|---|---|
| `reach`, `views`, `saves`, `profile_views`, `website_clicks`, `accounts_engaged` | Graph ao vivo, janela do mês (módulo 4.1) | 1º: linha de `instagram_account_metrics_monthly` do mês; 2º (SÓ métricas aditivas — nunca reach/accounts_engaged, §4.1): soma das `*_day` com cobertura completa | card omitido |
| `followers_gained` | `follows_and_unfollows` net do mês | fechamento-a-fechamento **somente com os dois closes** (linha do último dia do mês anterior E do mês do relatório, definição §4.2.4); o fallback atual de history parcial MORRE | card omitido |
| `followers_total` | como hoje (close do mês; fallback último ponto do history do mês) | — | — |
| `engagement_rate` | `accounts_engaged ÷ reach` da conta no mês (×100) | mesma fórmula sobre a linha de `instagram_account_metrics_monthly` (ambas são métricas de únicos — soma diária é inválida) | card omitido |
| `posts_count` | como hoje | — | — |

- **prev:** mesma métrica na janela do mês anterior pela mesma cadeia. Mês anterior
  fora da retenção e sem histórico próprio → prev null (o widget já mostra só o
  valor; comportamento herdado do accountViews atual).
- **Cobertura completa** (para fallback de soma diária): definição §4.2.4 —
  todos os dias do mês com `*_day` não-null da métrica. Parcial = null; nunca
  extrapolar.
- **Período honesto, inclusive mês corrente:** `generate.ts` aceita gerar o mês
  em curso, e nesse caso a Graph trunca em "agora" — estampar "01–31" seria
  mentira no dia 15. O snapshot `period` ganha `effectiveEnd` (= min(fim do
  mês, dia da geração)) congelado na geração; os cards estampam o período REAL
  coberto ("01–15 de agosto · parcial" quando `effectiveEnd` < fim do mês,
  "01–31 de agosto" quando completo). Regenerar após a virada atualiza. A taxa
  de engajamento ganha tooltip com a fórmula ("contas engajadas ÷ alcance —
  análise Mesaas").
- `account-views.ts` é absorvido pelo caminho novo (views vira só mais uma métrica
  do batch); a seção de top posts/breakdown/tags não muda de fonte.
- **Narrativa da IA** (`ai-input.ts`): recebe os KPIs novos + a flag de outlier
  (abaixo), para parar de tratar quedas pós-viral como fracasso de conteúdo.
- **Sinalização de outlier:** quando um único post do mês anterior responde por
  >50% da soma de views ou reach por post daquele mês, o snapshot ganha o campo
  novo **`comparison: { prev_outlier: boolean; prev_top_share: number } | null`**
  no `ReportDocSnapshot`. Campo OPCIONAL lido com guard (mesmo precedente do
  campo `views` dos top posts: "snapshots antigos não têm o campo"), então a
  `version: 1` não muda. Requisitos de dado: a query `prevMonthPosts` de
  `snapshot-source.ts` passa a selecionar também `impressions` (hoje só traz
  reach/saved/likes/comments/shares — sem isso o teste por views não roda), e
  `ai-input.ts` ganha o campo no contrato para a narrativa contextualizar a
  comparação. Widget de UI usa na fase de UI.

### 4.4 Analytics do CRM

Caminho ÚNICO do CRM: endpoint novo em `instagram-analytics`, no padrão dos
endpoints existentes — `verifyClientOwnership(clientId, contaId)` primeiro,
feature gate, depois o módulo 4.1 com fallback (a function roda com service
role). O frontend NUNCA lê `instagram_account_metrics_daily`/`_monthly` direto:
RLS service-role-only (migration `20260526000000`) e continua assim — leitura
direta seria negada, e abrir a RLS criaria um segundo caminho de autorização.

**Contrato** (a página atual consome pares current/previous —
`analytics.ts:getAnalyticsOverview` — e o contrato preserva isso):

```
GET /account-metrics/:clientId?start=YYYY-MM-DD&end=YYYY-MM-DD
  (end INCLUSIVO, mesma convenção do endpoint de views existente)

200 → {
  period: { start, end, effectiveEnd },   // effectiveEnd trunca em "hoje"
  current:  { ...AccountTotals, followers: { start, end, delta } | null },
  previous: <mesmo shape> | null,          // janela de igual duração imediatamente
                                           // anterior; null quando não couber
                                           // INTEIRA na retenção (regra do
                                           // parseViewsRange atual) e sem linha
                                           // mensal/diária própria que a cubra
  source: { [metric]: "live" | "snapshot" | null }  // proveniência por métrica
}
```

- `followers.delta` vem de `instagram_follower_history`/closes (§4.2.4) — o
  endpoint entrega tudo que a página precisa numa chamada.
- **Cache:** resultado gravado em `instagram_analytics_cache`
  (`getCachedOrFetch`, chave `account_metrics_{start}_{end}`, TTL curto) —
  refetch do TanStack Query não vira chamada Graph nova.
- **Feature gate:** a rota entra EXPLICITAMENTE em `featureForPath`
  (`_shared/feature-guard.ts`) com o mesmo flag que gateia a página de
  Analytics hoje — sem depender do fallback genérico da função para rota
  desconhecida.

`apps/crm/src/services/analytics.ts` + página: KPIs de conta (followers delta,
reach, views) migram para esse endpoint. Somas por post saem dos KPIs de conta
e ficam nas análises de conteúdo. As leituras atuais de `reach_28d`,
`impressions_28d`, `profile_views_28d` somem junto.

### 4.5 Hub

O Hub serve DOIS produtos de relatório (`hub-report-docs/handlers.ts` lista a
união): os `report_documents` (blocos, §4.3) e os `analytics_reports` legados
gerados por `report-worker` → `instagram-report-generator-v2`. Decisão
explícita, não "avaliar no plano":

- **Relatórios novos do Hub = `report_documents`** e herdam a paridade do §4.3
  automaticamente.
- **O gerador legado NÃO é migrado nesta iniciativa.** O pipeline mensal legado
  está morto em prod (dois defeitos conhecidos, sem correção) e não produz
  relatórios novos; migrar seu contrato `KpiValue`/deltas seria retrabalho num
  caminho que não roda. Os `analytics_reports` prontos continuam servidos como
  hoje (arquivos congelados).
- Se o pipeline legado for revivido um dia, a revivificação DEVE consumir o
  módulo 4.1 — fica registrado aqui como pré-condição, com a paridade §4.3 como
  contrato.

## 5. Tratamento de erros

- Falha de Graph/token na geração: degrada por métrica para a cadeia de fallback e
  loga (`console.warn` interno, nunca detalhe pro cliente) — padrão já existente.
- Token expirado (code 190): marca `authorization_status='expired'` como hoje.
- Backfill/cron: falha por conta não derruba o batch (padrão atual do cron);
  colunas ficam null e a cadeia de fallback lida.
- Migrations: prefixo de versão único acima do tail de `origin/main`, re-verificado
  na abertura do PR (guard do CI + incidente 2026-07-30).

## 6. Testes

- **Unit (Deno):** módulo 4.1 (janelas, chunks, parcial→null, agregação
  follows/unfollows); `kpis.ts` novo contrato — atualizar `kpis.test.ts`,
  `snapshot.test.ts`, `ai-input.test.ts` e os testes do frontend que asserem o
  shape antigo (grep nas duas suítes: `apps/**/__tests__` e
  `supabase/functions/__tests__` — mudança de contrato quebra as duas).
- **Unit (Vitest):** analytics.ts do CRM com as fontes novas.
- **Paridade (manual, gate de deploy):** regenerar o relatório de agosto da
  Healing Hands e conferir contra os prints do app: alcance ≈10.281 (ou rótulo
  ajustado conforme spike), novos seguidores ≈+49, views ≈46–47k, saves de conta.
- **E2E existente:** suites do relatório continuam verdes.

## 7. Rollout e impacto

1. Ordem de deploy: migrations (colunas `*_day`, `metrics_backfilled_at` +
   `metrics_backfill_cursor`, tabela `instagram_account_metrics_monthly`, RPC
   `upsert_metrics_daily`) → módulo compartilhado + functions
   (`instagram-sync-cron` com backfill, `instagram-analytics`, `report-docs`,
   com `--no-verify-jwt` onde aplicável) → frontend CRM/Hub. O backfill das
   contas existentes se espalha por vários ticks dentro do
   `BACKFILL_BATCH_LIMIT` (§4.2.3) — observar progresso pelas colunas de
   cursor/timestamp até zerar a fila.
2. **Relatórios congelados não mudam** (data_snapshot é imutável por design).
   "Atualizar dados"/regenerar aplica as bases novas. Comunicar ao usuário que
   números regenerados mudam de base — é o objetivo.
3. Regeneração do relatório da Healing Hands após deploy = validação de paridade
   (seção 6) e resposta concreta para a cliente.
4. Meses anteriores ao início da ingestão diária e fora da retenção de 90d ficam
   com cards omitidos ao regenerar — comportamento correto (não inventar número).
5. As colunas `*_28d` só são removidas depois que CRM Analytics migrar (migration
   separada, iniciativa concluída).

## 8. Riscos e questões em aberto

- **Reach total_value pode não bater com o app** (dedup) — resolvido pelo spike;
  plano B já definido (rótulo "acumulado" + tooltip).
- **Nome/disponibilidade de `profile_views` e retenção de `follows_and_unfollows`**
  na API com Instagram Login — spike.
- **Rate limit da Graph:** geração passa de 1 chamada (views) para ~7 métricas × 2
  janelas (mês + prev), com chunks. Batch em paralelo, mas monitorar; o cron diário
  soma ~7 chamadas/conta/dia. Aceitável na escala atual; anotar no plano.
- **DK TESTE tem tokens falsos de IG** — nunca validar rotas live-Graph nessa conta;
  usar a Healing Hands ou conta real de staging.
