# Revamp: Entregas "Visão geral" + Analytics de Fluxos — Design Spec

Aprovado pelo usuário em 2026-09-02 (mockups no Visual Companion, ver `assets/`).

## Contexto e tese

PostHog (30d): `/entregas` é a página de trabalho nº 1 do produto (779 pageviews, ~50 visitantes, mais que o dashboard); `/analytics-fluxos` tem uso praticamente zero. Decisão: manter duas superfícies com papéis distintos.

- **Entregas > aba "Visão geral"** (renomeada de "Gráfico", id interno `'chart'` mantido): cockpit operacional. Responde "o que precisa de atenção AGORA e de quem". Cada elemento é uma porta clicável que aplica o `FilterState` existente e leva ao board filtrado, ou abre o drawer do fluxo. Substitui o donut de 3 fatias.
- **Analytics de Fluxos**: review gerencial semanal. Responde "onde perdemos tempo, quem está sobrecarregado, estamos melhorando". KPIs com delta vs período anterior, período filtrando por data de CONCLUSÃO, e métricas de eventos (aprovação do cliente, retrabalho).

Mockups aprovados (referência visual vinculante para hierarquia e conteúdo, não pixel-perfect):
- `assets/2026-09-02-mockup-visao-geral.html`
- `assets/2026-09-02-mockup-analytics-fluxos.html` (a série "Criados" do Ritmo de entrega vira LINHA no Chart.js real)

## Problemas do estado atual (verificados no código)

### Entregas > Gráfico (`apps/crm/src/pages/entregas/views/ChartView.tsx`)
- 75 linhas: donut Em dia/Urgente/Atrasado + 3 cards, usando só `card.deadline.estourado/urgente` da etapa ativa. `useEntregasData` já carrega cliente, responsável, etapas completas, contagens de posts, covers, avatars e hubUrl por card, tudo descartado.
- Cores divergentes para "urgente": `#eab308` (ChartView, etapaPrazo), `#ea580c` (filtros), `--warning: #f5a342` (token). Sem drill-down, sem teste, sem dark/light awareness.
- Header stats usam cards sem filtro enquanto a view usa filtrados.
- N+1: um `getWorkflowEtapas(id)` por workflow ativo (até ~132 requests por carga).

### Analytics de Fluxos (`apps/crm/src/pages/analytics-fluxos/AnalyticsFluxosPage.tsx`)
1. Período filtra por `created_at`, não por conclusão.
2. Pontualidade ignora `data_limite` (errada para fluxos `data_fixa`/`data_entrega`).
3. Bucket semanal sem ano.
4. Equipe default 100% sem amostras.
5. `computeMetrics` sem memo (3 charts recriados por render).
6. `getAllEtapasWithWorkflow` = select * sem paginação → cap de 1000 linhas do PostgREST (já em risco com 132 fluxos).
7. Cores hardcoded dark-only; fonte morta 'DM Sans'.
8. Erros de query viram falso empty state; filtro sem match mostra zeros.
9. Sem URL state, sem doc title, sem delta (StatCard.delta existe e não é usado), tabela Gargalos duplica o bar chart.

## Dados não aproveitados (já em prod)

- **`workflow_events`** (desde 2026-08-26, triggers, RLS de equipe): etapa_concluida/revertida, fluxo_concluido/reaberto, actor, source (workspace_user|client|system). Fonte durável de conclusão (etapa `concluido_em` é anulado por revert/reopen).
- **`post_status_events`**: transições por post com actor/source — latência de aprovação do cliente, loops de revisão.
- `workflow_posts` (status, scheduled_at, published_at, publish_error_code), RPC `get_client_health_aggregates` (precedente de arquitetura), `workflows.created_via`, `etapa.tipo='aprovacao_cliente'`.
- Faltando: `workflows.concluido_em` (Fase 2 adiciona), RPC agregado de analytics (Fase 2 cria).

## Decisões do usuário

1. Escopo completo em 3 fases, um PR por fase.
2. Branch novo em worktree a partir de main.
3. Aba renomeada para "Visão geral" (id `'chart'` mantido).

## Fase 1 — Visão geral (frontend-only)

Ver plano: `docs/superpowers/plans/2026-09-02-fase1-visao-geral.md`. Resumo do layout (mockup aprovado):
1. Faixa de 5 KPIs clicáveis com toggle: Atrasadas, Urgentes (24h), Em dia, Vencem hoje, Aguardando cliente.
2. "Próximos vencimentos": tabs Hoje | Esta semana | Atrasadas, chips que abrem o drawer, "+N ver na lista".
3. "Situação por cliente" + "Carga por responsável": barras horizontais empilhadas, clique filtra.
4. "Fluxos por etapa" + "Idade dos atrasos" (buckets 1d / 2-3 / 4-7 / 8-14 / 15+), clique filtra; empty state celebratório quando não há atrasos.

Infra da fase: `lib/chartTheme.ts` (cores de chart theme-aware, único lugar com resolução de tokens), `pages/entregas/deadlineStatus.ts` (classificação canônica estourado/urgente), StatCard com `onClick`/`active`/`invertDelta`, fim do N+1 via `getAllActiveEtapas` paginado (`fetchAllPaged`).

Correção necessária descoberta em review: hoje `filterPrazo`/`filterPrazoFrom`/`filterPrazoTo` têm UI, serialização de URL e chips, mas NÃO são aplicados aos cards de fluxo (só a posts, via `matchesEtapaPrazo` em `filteredPosts`). A Fase 1 passa a aplicar `matchesEtapaPrazo(card, ...)` também ao pipeline de `filteredCards` no modo entregas e expõe o filtro de prazo na UI desse modo; sem isso, os cliques "Vencem hoje" e "Idade dos atrasos" seriam no-ops. Predicados exatos dos KPIs: Atrasadas/Urgentes/Em dia = `classifyDeadline`; Vencem hoje = `filterPrazo:['hoje']`; buckets de idade = `filterStatus:['atrasado']` + `filterPrazoFrom/To` na faixa de datas do bucket; Aguardando cliente = etapa ATIVA com `tipo='aprovacao_cliente'`, drill-down via `filterEtapas` com os nomes dessas etapas (aproximação por nome, aceita).

## Fase 2 — Backend + rebuild do Analytics

- Migration A: `workflows.concluido_em` + trigger BEFORE UPDATE + backfill (precedência `workflow_events.fluxo_concluido` > `max(etapa.concluido_em)`, com `SET LOCAL app.suppress_workflow_events='1'`) + índices `workflows (conta_id, status, concluido_em)`, `workflow_events (conta_id, created_at, id)`, `post_status_events (conta_id, created_at)`. O trigger cobre os DOIS sentidos: `status → 'concluido'` seta `concluido_em = now()`; `'concluido' → 'ativo'` (reopen, ver `reopenWorkflow` em `store/workflows.ts:431`) ANULA `concluido_em`. Defesa em profundidade: toda métrica de conclusão exige `status = 'concluido' AND concluido_em ∈ [from, to)`, nunca só o timestamp.
- Migration B: helpers `add_business_days` + `etapa_deadline(data_limite, iniciado_em, prazo_dias, tipo_prazo, tz)` (mesma precedência do frontend: `data_limite` fim do dia local vence) + RPC `get_workflow_analytics(p_from, p_to, p_tz, p_cliente_id, p_template_id, p_membro_id) RETURNS jsonb`, `LANGUAGE sql STABLE SECURITY INVOKER`, `GRANT EXECUTE TO authenticated`, guarda `effective_plan_feature(..., 'feature_analytics_reports')` fail-closed. Nunca `SELECT *` de `membros`/`clientes` (allowlist da migration 20260728000002); devolver ids.
- **Contrato de multi-tenancy do RPC:** a primeira CTE resolve UM workspace não nulo via `get_my_conta_id()` (`RAISE` se nulo) e esse mesmo id é usado (a) na guarda de entitlement e (b) como filtro explícito de TODA relação-fonte com `conta_id` (`workflows`, `workflow_events`, `post_status_events`). `workflow_etapas` não tem `conta_id` e só entra via JOIN em `workflows` já filtrado. Não confiar apenas em RLS dentro do corpo.
- **Timezone:** canônico e fixo `America/Sao_Paulo` (constante no service module do frontend; `p_tz DEFAULT 'America/Sao_Paulo'` no RPC). Sem configuração por workspace nesta fase. Divergência conhecida: o frontend das Entregas usa dia local do navegador; documentar e testar os instantes de virada de dia no teste SQL de paridade.
- Semântica: Concluídos = `concluido_em ∈ [from, to)` com `status='concluido'` OU `status='arquivado' AND concluido_em IS NOT NULL` (regra refinada em review 2026-09-02: **arquivar um fluxo concluído não encolhe números passados**; o trigger garante que concluido_em sobrevive a concluido→arquivado, é anulado no reopen, e nunca existe em fluxo jamais concluído — então arquivados abandonados continuam fora de tudo). Ativos = snapshot atual `status='ativo'` (caption "retrato atual"); Pontualidade = `concluido_em <= etapa_deadline(...)` sobre etapas concluídas na janela; semanas = chave `YYYY-MM-DD` da segunda-feira local (ano incluso); equipe sem amostras = null → "Poucos dados". `p_membro_id` do RPC restringe APENAS métricas derivadas de etapas (contrato documentado; sem UI na Fase 2).
- Frontend: `services/workflowAnalytics.ts`; página em submódulos; KPIs com delta (`invertDelta` no Tempo médio); "Ritmo de entrega" (combo); "Gargalos por etapa" (tabela única com barra inline); "Desempenho da equipe" v2; filtros na URL; react-chartjs-2 + useMemo; `QueryErrorCard`; CSV (BOM UTF-8, com neutralização de fórmulas: campo de texto começando com `=`, `+`, `-` ou `@` ganha apóstrofo de prefixo) + `window.print()`; aposentar `getAllEtapasWithWorkflow`.
- Testes: paridade SQL `etapa_deadline` vs fixtures do `etapaPrazo.test.ts` na suite de entitlements; teste de entitlement do RPC.
- Deploy: migrations → staging push → merge do frontend. Re-verificar tail de migrations de origin/main ao abrir PR.

## Fase 3 — Métricas de eventos

Nota de completude: `workflow_events` e `post_status_events` são capturados por triggers best-effort que engolem falhas com `RAISE WARNING` (design deliberado da 20260826000001) e existem desde datas diferentes. Tratamento: `events_since` é POR FONTE (`workflow_events_since`, `post_events_since`), cada card derivado de eventos mostra o horizonte da sua fonte, e as métricas de eventos são apresentadas como "registrado desde {data}", nunca como censo completo.

- "Aprovação do cliente": histograma de latência (<4h, 4-24h, 1-3d, 3-7d, 7d+) + ranking "Clientes mais lentos" (mediana `percentile_cont`). **Algoritmo de pareamento (post_status_events), REFINADO no recon de 2026-09-02** (nomes verificados: `enviado_cliente`/`aprovado_cliente`/`correcao_cliente`; o trigger normaliza customs para o `behaves_as` canônico em `to_status`, então ler `to_status` já cobre custom statuses):
  - Ciclo ABRE em cada evento `to_status='enviado_cliente' AND from_status IS DISTINCT FROM to_status` (o guard from≠to implementa sozinho o "envio repetido não abre novo ciclo" E filtra eventos custom-only/archive que têm from=to).
  - Ciclo FECHA no primeiro evento posterior do mesmo post com `from_status='enviado_cliente' AND from_status IS DISTINCT FROM to_status` (qualquer source; busca sem limite de p_to).
  - CLASSIFICAÇÃO: fechado-pelo-cliente = `source='client' OR post_approval_id IS NOT NULL` (o FK só é escrito por record_client_approval) → entra na mediana/histograma; fechado por workspace_user/system = "resolvido internamente" → fora da mediana, contado à parte; nunca fechado = `pendente`.
  - Ruído aceito e documentado: re-mapeamento de behaves_as por admin gera burst sintético de eventos (raro).
  - Complemento para fluxos SEM posts: pares `iniciado_em`→`concluido_em` das próprias rows de `workflow_etapas` com `tipo='aprovacao_cliente'` concluídas na janela (NÃO filtrar workflow_events por `source='client'`: esse valor NUNCA é escrito hoje, o hub não toca workflows/etapas). Link do ranking para `/clientes/:id/entregas`. Posts avulsos entram (escopo por cliente); filtro de template os exclui.
- Retrabalho: KPI (% de fluxos com atividade na janela que tiveram ≥1 `etapa_revertida`; denominador = fluxos com QUALQUER evento na janela) + por etapa na tabela de Gargalos (atribuído a `COALESCE(metadata->>'voltou_de', etapa_nome)`, a etapa que DEVOLVEU; `voltou_de` é NOME, ausente quando não há etapa posterior) + colunas na equipe (retrabalho por responsável via `voltou_de_etapa_id`→`workflow_etapas.responsavel_id`; atividade = contagem de `etapa_iniciada`+`etapa_concluida` por `actor_user_id`→`membros.crm_user_id`, mapeamento a verificar contra a allowlist antes de usar no SQL).
- Agente vs humano (`created_via`): concluídos + tempo médio por origem.
- Fast-follows da Fase 2 absorvidos aqui: `GREATEST(0, ...)` nos quatro pontos de duração do RPC; `etapas_avaliadas_prev` no payload (delta de pontualidade em pontos percentuais); echo de período/filtros na impressão.
- Drill-down "atividade recente" por keyset pagination: ADIADO (fora da Fase 3; entra se houver demanda).
- Sequenciamento: um PR só, contratos separados por chave do jsonb.

## Fora de escopo (deliberado)

Nova lib de charts; dashboard configurável; analytics de custo/margem; realtime; leaderboard de membros; narrativas de AI; date-picker custom; PDF export; projeções de forecast.
