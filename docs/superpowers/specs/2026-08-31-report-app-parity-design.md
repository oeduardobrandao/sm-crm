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

Antes de qualquer código de produção:

1. **Reach com deduplicação:** buscar `reach` (`metric_type=total_value`,
   `period=day`) de 01–31/08 da conta da Healing Hands e comparar com os 10.281 do
   print. `total_value` soma valores diários e reach pode não deduplicar visitantes
   entre dias. Se divergir materialmente do app, o card vira "Alcance acumulado"
   com tooltip honesto e a spec é emendada — não prometemos paridade que a API não
   entrega.
2. **Nomes exatos das métricas** na API com Instagram Login (graph.instagram.com):
   confirmar `follows_and_unfollows` (com breakdown `follower_type`),
   `profile_views` (ou o substituto correto; hoje só buscamos `profile_links_taps`?
   — verificar), `saves`, `accounts_engaged`, `website_clicks`. Anotar janelas de
   retenção específicas por métrica (ex.: `follower_count` diário só cobre 30 dias).
3. Registrar os resultados no topo do plano de implementação.

Caso de teste permanente: Healing Hands, agosto/2026, prints do app em mãos.

## 4. Arquitetura

### 4.1 Módulo compartilhado `supabase/functions/_shared/instagram-account-metrics.ts`

Generalização de `instagram-analytics/views.ts` (que já resolve clamp de retenção
de 90 dias, chunks de 30 dias e janela half-open `[since, until)`):

```ts
type AccountMetric =
  | "reach" | "views" | "saves" | "accounts_engaged"
  | "profile_views" | "website_clicks" | "follows_and_unfollows";

interface AccountMetricsResult {
  // null por métrica = fetch falhou/fora da retenção; NUNCA derruba o chamador.
  [metric: string]: number | null;
  // follows_and_unfollows expande em { follows, unfollows, net }.
}

fetchAccountMetrics(fetchFn, accessToken, metrics, sinceSec, untilSec)
```

Regras herdadas de views.ts: janela parcial fora da retenção → null (nunca um
número enganoso), timeout por request, erro 190 → TOKEN_EXPIRED tipado. Uma chamada
Graph por métrica, em paralelo. `views.ts` passa a reexportar/usar este módulo
(sem duplicar a matemática de janelas).

Consumidores: report-docs, instagram-analytics (endpoints novos de range),
instagram-report-generator-v2, sync cron.

### 4.2 Sync cron: snapshot diário correto e enriquecido

`instagram-sync-cron` hoje grava janelas 28d móveis com mapeamento errado
(`views`→`impressions_28d`, `accounts_engaged`→`profile_views_28d`). Mudanças:

1. **Colunas novas por-dia** em `instagram_account_metrics_daily` (migration):
   `reach_day`, `views_day`, `saves_day`, `accounts_engaged_day`,
   `profile_views_day`, `website_clicks_day`, `follows_day`, `unfollows_day`
   (todas `integer` nullable — null = métrica indisponível naquele dia).
   O cron busca o valor **do próprio dia** (since=00:00Z de hoje, until=agora) via
   o módulo 4.1 e faz upsert na linha do dia. Rodadas múltiplas no mesmo dia
   sobrescrevem com o valor mais recente (o do fim do dia vence).
2. **Correção do mapeamento 28d:** `accounts_engaged` ganha coluna própria
   (`accounts_engaged_28d`); `profile_views_28d` passa a receber a métrica correta
   de profile views (conforme spike). As colunas `*_28d` continuam existindo
   enquanto houver consumidor (CRM Analytics as lê hoje); somem numa migration
   posterior quando 4.4 concluir.
3. **Backfill na conexão:** ao conectar uma conta
   (`instagram-integration`, pós-OAuth), disparar busca dos últimos 90 dias de
   métricas diárias (`period=day` com série temporal, chunks de 30d) e popular
   `instagram_account_metrics_daily` + `instagram_follower_history`
   (`follower_count` diário: só 30 dias disponíveis — backfill parcial é esperado).
   Roda assíncrono e idempotente (upsert por `instagram_account_id, snapshot_date`);
   falha não bloqueia a conexão.

### 4.3 Relatório de blocos (report-docs)

`_shared/report-docs/kpis.ts` muda de contrato. Nova cadeia de fontes por KPI,
sempre respeitando a invariante existente (valor e prev SEMPRE da mesma base;
sem prev comparável → prev = null; sem valor → card se omite):

| KPI | Fonte primária (geração) | Fallback | Sem dado |
|---|---|---|---|
| `reach`, `views`, `saves`, `profile_views`, `website_clicks`, `accounts_engaged` | Graph ao vivo, janela do mês (módulo 4.1) | soma das colunas `*_day` do nosso snapshot quando o mês tem cobertura completa de dias | card omitido |
| `followers_gained` | `follows_and_unfollows` net do mês | fechamento-a-fechamento de snapshots **somente com cobertura completa** (snapshot do fim do mês anterior E do fim do mês existente); o fallback atual de history parcial MORRE | card omitido |
| `followers_total` | como hoje (close do mês; fallback último ponto do history do mês) | — | — |
| `engagement_rate` | `accounts_engaged ÷ reach` da conta no mês (×100) | mesma conta via colunas `*_day` | card omitido |
| `posts_count` | como hoje | — | — |

- **prev:** mesma métrica na janela do mês anterior pela mesma cadeia. Mês anterior
  fora da retenção e sem histórico próprio → prev null (o widget já mostra só o
  valor; comportamento herdado do accountViews atual).
- **Cobertura completa** (para fallback de soma diária): todos os dias do mês com
  linha não-null da métrica. Cobertura parcial = null; nunca extrapolar.
- Os cards estampam o período ("01–31 de agosto") no widget/print. A taxa de
  engajamento ganha tooltip com a fórmula ("contas engajadas ÷ alcance — análise
  Mesaas").
- `account-views.ts` é absorvido pelo caminho novo (views vira só mais uma métrica
  do batch); a seção de top posts/breakdown/tags não muda de fonte.
- **Narrativa da IA** (`ai-input.ts`): recebe os KPIs novos + a flag de outlier
  (abaixo), para parar de tratar quedas pós-viral como fracasso de conteúdo.
- **Sinalização de outlier:** quando um único post do mês anterior responde por
  >50% da soma de views ou reach por post daquele mês, o snapshot marca
  `prev_outlier: true` no breakdown; a IA e (fase de UI) o widget usam isso para
  contextualizar comparações. (Aritmética por post, já disponível; custo baixo.)

### 4.4 Analytics do CRM

`apps/crm/src/services/analytics.ts` + página: KPIs de conta (followers delta,
reach, impressions/views) passam a vir das colunas `*_day`/history corrigidas ou de
um endpoint de range novo em `instagram-analytics` (`GET /account-metrics?start&end`)
que usa o módulo 4.1. Somas por post saem dos KPIs de conta e ficam nas análises de
conteúdo. Colunas lidas (`reach_28d`, `impressions_28d`, `profile_views_28d`) migram
para as novas com rótulos corretos.

### 4.5 Hub

`instagram-report-generator-v2` (relatório mensal do Hub) migra os mesmos KPIs para
o módulo 4.1 com a mesma cadeia de fallback — de preferência passando a consumir
`_shared/report-docs/kpis.ts` para uma fonte única de verdade, se a divergência de
shape for pequena (avaliar no plano; se for grande, replicar a cadeia com testes de
paridade entre os dois).

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

1. Ordem de deploy: migration (colunas novas) → módulo compartilhado + functions
   (`instagram-sync-cron`, `instagram-integration` backfill, `instagram-analytics`,
   `report-docs`, `instagram-report-generator-v2`, com `--no-verify-jwt` onde
   aplicável) → frontend CRM/Hub.
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
