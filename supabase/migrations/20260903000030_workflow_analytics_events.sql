-- =====================================================================
-- 20260903000030_workflow_analytics_events.sql
-- Fase 3 — Métricas de eventos em get_workflow_analytics.
--
-- Estende o RPC de 20260903000020 como SUPERSET ESTRITO: mesma assinatura,
-- e todo campo já existente mantém nome e semântica. As chaves novas são
-- `horizonte`, `aprovacao_cliente` e `origem` no topo; `retrabalho_pct` /
-- `retrabalho_prev` / `etapas_avaliadas_prev` em `kpis`; `retrabalho_pct`
-- em cada item de `etapas`; `retrabalho` e `atividade` em cada item de
-- `equipe`.
--
-- ---------------------------------------------------------------------
-- Step 0 — evidências verificadas antes de escrever este SQL
-- ---------------------------------------------------------------------
-- (1) Allowlist de colunas de `membros` (20260728000002:78-81):
--       id, user_id, conta_id, nome, cargo, tipo, avatar_url,
--       data_pagamento, created_at, crm_user_id
--     `id` E `crm_user_id` estão na allowlist, então o caminho de
--     mapeamento de atividade via membros(id, crm_user_id) É visível ao
--     papel `authenticated`. Não foi preciso cair para o fallback de
--     chavear a atividade por actor_user_id.
--
-- (2) Qual coluna de `membros` guarda o uuid de auth: `crm_user_id`.
--     20260430000001_notifications.sql:78 declara
--       ADD COLUMN crm_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
--     e é populada com o uuid do usuário em link_membro_user
--     (`UPDATE membros SET crm_user_id = p_crm_user_id`, :118) e no aceite
--     de convite (20260731000002:112, `SET crm_user_id = p_user_id`).
--     Já `membros.user_id` é o ponteiro de tenant do DONO do workspace
--     (as policies antigas usam `auth.uid() = user_id`), NÃO o id de auth
--     do próprio membro. Portanto o join de atividade usa
--     `m.crm_user_id = ev.actor_user_id`, que é o que equivale a auth.uid()
--     e ao `workflow_events.actor_user_id`.
--
-- (3) Índice de suporte ao LATERAL de fechamento de ciclo: JÁ EXISTE.
--     20260606000001_post_status_events.sql:24-25 cria
--       idx_post_status_events_post_created_at ON post_status_events (post_id, created_at)
--     (e 20260903000010:81 cria idx_post_status_events_conta_created).
--     Nada a adicionar aqui.
--
-- (4) Próxima suíte livre em supabase/tests/entitlements/: 74
--     (a maior hoje é 73_workflow_analytics.sql).
--
-- ---------------------------------------------------------------------
-- Notas de semântica
-- ---------------------------------------------------------------------
-- Completude: workflow_events e post_status_events vêm de triggers
-- best-effort (engolem falha com RAISE WARNING, por design da
-- 20260826000001) e nasceram em datas diferentes. Por isso `horizonte`
-- devolve o min(created_at) POR FONTE, sem janela e sem filtros, para a
-- UI poder rotular "registrado desde {data}" em vez de censo completo.
--
-- p_membro_id continua restringindo apenas as métricas derivadas de
-- etapas (pontualidade, etapas, equipe), como na 20260903000020. Os
-- blocos novos `aprovacao_cliente`, `origem` e `horizonte` o ignoram de
-- propósito: medem o cliente, a origem do fluxo e a cobertura do log,
-- não a carga de um responsável.
--
-- EXCEÇÃO EXPLÍCITA, tudo que vem de retrabalho é SEMPRE do workspace
-- inteiro e ignora p_membro_id:
--   * kpis.retrabalho_pct / kpis.retrabalho_prev
--   * etapas[].retrabalho_pct
-- Esses três saem de ev_win/ev_prev (workflow_events), que filtram por
-- conta, janela e fluxo, mas NUNCA por membro. Logo, com p_membro_id
-- setado, um item de `etapas` mistura escopos de propósito: `media_dias`,
-- `amostras` e `atraso_pct` são daquele membro, enquanto `retrabalho_pct`
-- é do workspace inteiro para aquela etapa.
--
-- É decisão de contrato, não descuido. Uma reversão registra QUEM
-- reverteu e de qual etapa VOLTOU, não "de quem é a culpa": atribuir a
-- devolução ao responsável atual da etapa de destino seria inventar uma
-- semântica que o log não tem. Some-se que p_membro_id não tem UI hoje:
-- getWorkflowAnalytics (apps/crm/src/services/workflowAnalytics.ts) aceita
-- membroId, mas o único caller de página
-- (pages/analytics-fluxos/AnalyticsFluxosPage.tsx:70) passa apenas
-- from/to/clienteId/templateId, então na prática chega sempre NULL e a
-- mistura não é observável. Se algum dia ganhar UI, o rótulo do número
-- precisa dizer "retrabalho da etapa no workspace", nunca "do membro".
--
-- Pareamento de ciclos de aprovação (post_status_events):
--   ABRE  em to_status='enviado_cliente' com from_status DISTINCT FROM
--         to_status. O guard from<>to já implementa sozinho o "reenvio não
--         abre ciclo novo" e descarta eventos custom-only/arquivamento que
--         gravam from=to.
--   FECHA no primeiro evento posterior do MESMO post com
--         from_status='enviado_cliente' (qualquer source), buscado SEM
--         limite de p_to — senão um ciclo aberto no fim da janela contaria
--         como pendente para sempre.
--   CLASSIFICA fechado-pelo-cliente como source='client' OR
--         post_approval_id IS NOT NULL (o FK só é escrito por
--         record_client_approval). Só esses entram na mediana e no
--         histograma; workspace_user/system viram "resolvido
--         internamente"; sem fechamento vira "pendente".
-- =====================================================================

-- Assinatura idêntica à 20260903000020: CREATE OR REPLACE substitui o corpo
-- sem derrubar grants nem dependências.
CREATE OR REPLACE FUNCTION get_workflow_analytics(
  p_from timestamptz,
  p_to timestamptz,
  p_tz text DEFAULT 'America/Sao_Paulo',
  p_cliente_id bigint DEFAULT NULL,
  p_template_id bigint DEFAULT NULL,
  p_membro_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH guard AS (
  SELECT c.conta_id
  FROM (SELECT get_my_conta_id() AS conta_id) c
  WHERE c.conta_id IS NOT NULL
    AND effective_plan_feature(c.conta_id, 'feature_analytics_reports')
),
wf AS (
  SELECT w.*
  FROM workflows w
  JOIN guard g ON w.conta_id = g.conta_id
  WHERE (w.status <> 'arquivado' OR w.concluido_em IS NOT NULL)
    AND (p_cliente_id IS NULL OR w.cliente_id = p_cliente_id)
    AND (p_template_id IS NULL OR w.template_id = p_template_id)
),
concluidos AS (
  SELECT * FROM wf
  WHERE (status = 'concluido' OR (status = 'arquivado' AND concluido_em IS NOT NULL))
    AND concluido_em >= p_from AND concluido_em < p_to
),
concluidos_prev AS (
  SELECT * FROM wf
  WHERE (status = 'concluido' OR (status = 'arquivado' AND concluido_em IS NOT NULL))
    AND concluido_em >= p_from - (p_to - p_from) AND concluido_em < p_from
),
inicio AS (
  SELECT e.workflow_id, min(e.iniciado_em) AS iniciado_em
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  GROUP BY e.workflow_id
),
-- GREATEST(0, ...) nos quatro pontos de duração: fast-follow da Fase 2.
-- Relógio para trás / edição manual de datas produzia duração negativa,
-- que puxava a média para baixo em silêncio.
dur AS (
  SELECT GREATEST(0, extract(epoch FROM c.concluido_em - COALESCE(i.iniciado_em, c.created_at))) / 86400.0 AS dias
  FROM concluidos c LEFT JOIN inicio i ON i.workflow_id = c.id
),
dur_prev AS (
  SELECT GREATEST(0, extract(epoch FROM c.concluido_em - COALESCE(i.iniciado_em, c.created_at))) / 86400.0 AS dias
  FROM concluidos_prev c LEFT JOIN inicio i ON i.workflow_id = c.id
),
et_done AS (
  SELECT e.*,
         etapa_deadline(e.data_limite::date, e.iniciado_em, e.prazo_dias, e.tipo_prazo, p_tz) AS deadline
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  WHERE e.status = 'concluido'
    AND e.concluido_em >= p_from AND e.concluido_em < p_to
    AND (p_membro_id IS NULL OR e.responsavel_id = p_membro_id)
),
et_done_prev AS (
  SELECT e.*,
         etapa_deadline(e.data_limite::date, e.iniciado_em, e.prazo_dias, e.tipo_prazo, p_tz) AS deadline
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  WHERE e.status = 'concluido'
    AND e.concluido_em >= p_from - (p_to - p_from) AND e.concluido_em < p_from
    AND (p_membro_id IS NULL OR e.responsavel_id = p_membro_id)
),
etapas_agg AS (
  SELECT nome,
         avg(GREATEST(0, extract(epoch FROM concluido_em - iniciado_em)) / 86400.0)
           FILTER (WHERE iniciado_em IS NOT NULL) AS media_dias,
         count(*) AS amostras,
         round(100.0 * count(*) FILTER (WHERE deadline IS NOT NULL AND concluido_em > deadline)
               / NULLIF(count(*) FILTER (WHERE deadline IS NOT NULL), 0)) AS atraso_pct
  FROM et_done
  GROUP BY nome
),
semanas AS (
  SELECT to_char(date_trunc('week', concluido_em AT TIME ZONE p_tz), 'YYYY-MM-DD') AS semana,
         count(*) AS concluidos
  FROM concluidos GROUP BY 1
),
semanas_criados AS (
  SELECT to_char(date_trunc('week', created_at AT TIME ZONE p_tz), 'YYYY-MM-DD') AS semana,
         count(*) AS criados
  FROM wf
  WHERE created_at >= p_from AND created_at < p_to
  GROUP BY 1
),
equipe AS (
  SELECT responsavel_id AS membro_id,
         count(*) AS concluidas,
         avg(GREATEST(0, extract(epoch FROM concluido_em - iniciado_em)) / 86400.0)
           FILTER (WHERE iniciado_em IS NOT NULL) AS media_dias,
         count(*) FILTER (WHERE deadline IS NOT NULL AND concluido_em <= deadline) AS no_prazo,
         count(*) FILTER (WHERE deadline IS NOT NULL AND concluido_em > deadline) AS atrasadas,
         count(*) FILTER (WHERE deadline IS NOT NULL) AS avaliadas
  FROM et_done
  WHERE responsavel_id IS NOT NULL
  GROUP BY responsavel_id
),
-- ---------- Fase 3: eventos de status de post ------------------------
pse AS (  -- eventos com transição real, no escopo do tenant e dos filtros
  SELECT e.id, e.post_id, e.conta_id, e.created_at, e.from_status, e.to_status,
         e.source, e.post_approval_id, p.cliente_id, p.workflow_id
  FROM post_status_events e
  JOIN guard g ON e.conta_id = g.conta_id
  JOIN workflow_posts p ON p.id = e.post_id
  WHERE e.from_status IS DISTINCT FROM e.to_status
    AND (p_cliente_id IS NULL OR p.cliente_id = p_cliente_id)
    -- Posts avulsos (workflow_id NULL) entram no escopo por cliente; o
    -- filtro de template os exclui, porque não pertencem a template algum.
    AND (p_template_id IS NULL OR (p.workflow_id IS NOT NULL AND p.workflow_id IN (SELECT id FROM wf)))
),
ciclos AS (  -- um ciclo por envio ao cliente aberto na janela; fechamento SEM limite de p_to
  -- Desempate por id, não só por created_at: eventos da MESMA transação
  -- compartilham now(), então um abre+fecha atômico tem timestamps iguais e
  -- um `>` puro nunca acharia o fechamento -- o ciclo ficaria pendente para
  -- sempre. É a mesma classe de empate documentada em 20260826000001:43,
  -- que por isso indexa (workflow_id, created_at, id) e não só os dois
  -- primeiros. A comparação de tupla (created_at, id) resolve ambos os casos.
  SELECT env.post_id, env.cliente_id, env.created_at AS enviado_em,
         fech.created_at AS fechado_em,
         (fech.source = 'client' OR fech.post_approval_id IS NOT NULL) AS pelo_cliente
  FROM pse env
  LEFT JOIN LATERAL (
    SELECT f.created_at, f.source, f.post_approval_id
    FROM post_status_events f
    WHERE f.conta_id = env.conta_id
      AND f.post_id = env.post_id
      AND (f.created_at, f.id) > (env.created_at, env.id)
      AND f.from_status = 'enviado_cliente'
      AND f.from_status IS DISTINCT FROM f.to_status
    ORDER BY f.created_at, f.id
    LIMIT 1
  ) fech ON true
  WHERE env.to_status = 'enviado_cliente'
    AND env.created_at >= p_from AND env.created_at < p_to
),
latencias AS (  -- só ciclos fechados PELO CLIENTE entram na distribuição
  SELECT cliente_id,
         GREATEST(0, extract(epoch FROM fechado_em - enviado_em)) / 3600.0 AS horas
  FROM ciclos WHERE fechado_em IS NOT NULL AND pelo_cliente
),
aprov_etapas AS (  -- complemento: fluxos SEM nenhum post
  SELECT GREATEST(0, extract(epoch FROM e.concluido_em - e.iniciado_em)) / 3600.0 AS horas
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  WHERE e.tipo = 'aprovacao_cliente' AND e.status = 'concluido'
    AND e.iniciado_em IS NOT NULL
    AND e.concluido_em >= p_from AND e.concluido_em < p_to
    AND NOT EXISTS (SELECT 1 FROM workflow_posts p WHERE p.workflow_id = e.workflow_id)
),
-- ---------- Fase 3: eventos de fluxo ---------------------------------
ev_win AS (
  SELECT ev.* FROM workflow_events ev
  JOIN guard g ON ev.conta_id = g.conta_id
  WHERE ev.created_at >= p_from AND ev.created_at < p_to
    AND ev.workflow_id IN (SELECT id FROM wf)
),
ev_prev AS (
  SELECT ev.* FROM workflow_events ev
  JOIN guard g ON ev.conta_id = g.conta_id
  WHERE ev.created_at >= p_from - (p_to - p_from) AND ev.created_at < p_from
    AND ev.workflow_id IN (SELECT id FROM wf)
),
retrab_etapa AS (  -- atribuído à etapa que DEVOLVEU (voltou_de), fallback etapa do evento
  SELECT COALESCE(r.metadata->>'voltou_de', r.etapa_nome) AS nome,
         count(*) AS reverts
  FROM ev_win r WHERE r.event_type = 'etapa_revertida'
  GROUP BY 1
),
conclu_etapa AS (
  SELECT etapa_nome AS nome, count(*) AS conclusoes
  FROM ev_win WHERE event_type = 'etapa_concluida'
  GROUP BY 1
),
retrab_membro AS (
  -- O cast do id é TOTAL em vez de `metadata ? key` com cast cru: o planner
  -- pode avaliar uma expressão do ON antes do filtro do WHERE, e um valor
  -- não inteiro aí derrubaria o RPC inteiro.
  -- jsonb_typeof = 'number' NÃO basta: 1.5 também é 'number' em jsonb e
  -- ::bigint estoura nele. Daí o regex, que exige inteiro sem parte
  -- fracionária nem notação científica, com no máximo 18 dígitos (bigint
  -- vai até 19, então 18 nunca transborda).
  -- O join a `wf` mantém a invariante da 20260903000020: workflow_etapas
  -- não tem conta_id e só pode ser alcançada através de wf.
  SELECT et.responsavel_id AS membro_id, count(*) AS retrabalho
  FROM (
    SELECT CASE WHEN jsonb_typeof(r.metadata->'voltou_de_etapa_id') = 'number'
                 AND (r.metadata->>'voltou_de_etapa_id') ~ '^-?[0-9]{1,18}$'
                THEN (r.metadata->>'voltou_de_etapa_id')::bigint END AS etapa_id
    FROM ev_win r
    WHERE r.event_type = 'etapa_revertida'
  ) src
  JOIN workflow_etapas et ON et.id = src.etapa_id
  JOIN wf w ON w.id = et.workflow_id
  WHERE et.responsavel_id IS NOT NULL
  GROUP BY et.responsavel_id
),
atividade AS (
  -- Step 0 (1)+(2): membros(id, crm_user_id) está na allowlist e
  -- crm_user_id é o uuid de auth.users, igual a workflow_events.actor_user_id.
  -- O escopo por conta_id evita casar a linha de membro do MESMO usuário em
  -- outro workspace (crm_user_id não é único entre contas).
  SELECT m.id AS membro_id, count(*) AS atividade
  FROM ev_win e
  JOIN membros m ON m.crm_user_id = e.actor_user_id AND m.conta_id = e.conta_id
  WHERE e.event_type IN ('etapa_iniciada', 'etapa_concluida') AND e.actor_user_id IS NOT NULL
  GROUP BY m.id
),
origem_agg AS (
  SELECT c.created_via AS origem, count(*) AS concluidos,
         round(avg(GREATEST(0, extract(epoch FROM c.concluido_em - COALESCE(i.iniciado_em, c.created_at))) / 86400.0)::numeric, 2) AS tempo_medio_dias
  FROM concluidos c LEFT JOIN inicio i ON i.workflow_id = c.id
  GROUP BY c.created_via
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM guard) THEN NULL ELSE jsonb_build_object(
  'kpis', jsonb_build_object(
    'concluidos',        (SELECT count(*) FROM concluidos),
    'concluidos_prev',   (SELECT count(*) FROM concluidos_prev),
    'ativos',            (SELECT count(*) FROM wf WHERE status = 'ativo'),
    'tempo_medio_dias',  (SELECT round(avg(dias)::numeric, 2) FROM dur),
    'tempo_medio_prev',  (SELECT round(avg(dias)::numeric, 2) FROM dur_prev),
    'pontualidade_pct',  (SELECT round(100.0 * count(*) FILTER (WHERE concluido_em <= deadline)
                                 / NULLIF(count(*) FILTER (WHERE deadline IS NOT NULL), 0))
                            FROM et_done),
    'pontualidade_prev', (SELECT round(100.0 * count(*) FILTER (WHERE concluido_em <= deadline)
                                 / NULLIF(count(*) FILTER (WHERE deadline IS NOT NULL), 0))
                            FROM et_done_prev),
    'etapas_avaliadas',  (SELECT count(*) FILTER (WHERE deadline IS NOT NULL) FROM et_done),
    -- Fase 3: base de comparação para o delta de pontualidade em p.p.
    'etapas_avaliadas_prev', (SELECT count(*) FILTER (WHERE deadline IS NOT NULL) FROM et_done_prev),
    -- % de fluxos com atividade na janela que sofreram >= 1 reversão.
    -- Denominador = fluxos com QUALQUER evento na janela.
    -- Sempre do workspace inteiro: ev_win/ev_prev ignoram p_membro_id
    -- (ver a nota de p_membro_id no cabeçalho).
    'retrabalho_pct',    (SELECT round(100.0 * count(DISTINCT workflow_id) FILTER (WHERE event_type = 'etapa_revertida')
                                 / NULLIF(count(DISTINCT workflow_id), 0))
                            FROM ev_win),
    'retrabalho_prev',   (SELECT round(100.0 * count(DISTINCT workflow_id) FILTER (WHERE event_type = 'etapa_revertida')
                                 / NULLIF(count(DISTINCT workflow_id), 0))
                            FROM ev_prev)
  ),
  'etapas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'nome', ea.nome,
                'media_dias', round(ea.media_dias::numeric, 2),
                'amostras', ea.amostras,
                'atraso_pct', ea.atraso_pct,
                -- null quando não houve conclusão registrada da etapa na
                -- janela (log best-effort ou etapa anterior ao log); 0
                -- quando houve conclusão e nenhuma devolução.
                --
                -- ESCOPO DIFERENTE DOS IRMÃOS: vem de ev_win, que NÃO
                -- filtra por p_membro_id, enquanto media_dias/amostras/
                -- atraso_pct vêm de etapas_agg, que filtra. Com
                -- p_membro_id setado este número é do workspace inteiro
                -- para a etapa, não do membro. Ver a nota de p_membro_id
                -- no cabeçalho: é contrato, não descuido.
                'retrabalho_pct', round(100.0 * COALESCE(re.reverts, 0) / NULLIF(ce.conclusoes, 0)))
              -- Desempate por nome: sem ele, etapas com a mesma media_dias
              -- saem em ordem arbitrária e a tabela se reembaralha entre
              -- requisições idênticas. Tasks 3-4 dependem desta ordem.
              ORDER BY ea.media_dias DESC NULLS LAST, ea.nome)
              FROM etapas_agg ea
              LEFT JOIN retrab_etapa re ON re.nome = ea.nome
              LEFT JOIN conclu_etapa ce ON ce.nome = ea.nome), '[]'::jsonb),
  'semanas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'semana', s.semana,
                'concluidos', s.concluidos,
                'criados', COALESCE(sc.criados, 0))
              ORDER BY s.semana)
              FROM semanas s LEFT JOIN semanas_criados sc ON sc.semana = s.semana), '[]'::jsonb),
  'semanas_criados_sem_conclusao', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'semana', sc.semana, 'criados', sc.criados) ORDER BY sc.semana)
              FROM semanas_criados sc
              WHERE NOT EXISTS (SELECT 1 FROM semanas s WHERE s.semana = sc.semana)), '[]'::jsonb),
  'equipe', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'membro_id', eq.membro_id,
                'concluidas', eq.concluidas,
                'media_dias', round(eq.media_dias::numeric, 2),
                'no_prazo', eq.no_prazo,
                'atrasadas', eq.atrasadas,
                'avaliadas', eq.avaliadas,
                'retrabalho', COALESCE(rm.retrabalho, 0),
                'atividade', COALESCE(at.atividade, 0))
              -- Desempate por membro_id: idem etapas acima. Empate em
              -- concluidas é comum (dois membros com 1 etapa cada).
              ORDER BY eq.concluidas DESC, eq.membro_id)
              FROM equipe eq
              LEFT JOIN retrab_membro rm ON rm.membro_id = eq.membro_id
              LEFT JOIN atividade at ON at.membro_id = eq.membro_id), '[]'::jsonb),
  -- Cobertura do log, por fonte, sem janela e sem filtros: a UI rotula
  -- "registrado desde {data}" em cada card derivado de eventos.
  --
  -- conta_id = (SELECT ...) em vez de JOIN guard de propósito: o join
  -- materializa a CTE e mata o atalho de MIN por índice, virando um heap
  -- scan que cresce para sempre -- justo na única métrica NÃO janelada, a
  -- que mais varre. Com o subselect escalar o planner volta a
  -- `Limit -> Index Only Scan` em idx_workflow_events_conta_created /
  -- idx_post_status_events_conta_created. Sem guard o subselect é NULL,
  -- o predicado não casa nada e o CASE externo já devolve NULL antes disso.
  'horizonte', jsonb_build_object(
    'workflow_events_since', (SELECT min(ev.created_at) FROM workflow_events ev
                               WHERE ev.conta_id = (SELECT conta_id FROM guard)),
    'post_events_since',     (SELECT min(pe.created_at) FROM post_status_events pe
                               WHERE pe.conta_id = (SELECT conta_id FROM guard))
  ),
  'aprovacao_cliente', jsonb_build_object(
    'mediana_horas', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY horas)::numeric, 1) FROM latencias),
    'amostras', (SELECT count(*) FROM latencias),
    'pendentes', (SELECT count(*) FROM ciclos WHERE fechado_em IS NULL),
    'resolvidos_internamente', (SELECT count(*) FROM ciclos WHERE fechado_em IS NOT NULL AND NOT pelo_cliente),
    -- As 5 faixas saem SEMPRE, na mesma ordem, mesmo zeradas: o gráfico
    -- não pode mudar de eixo conforme os dados.
    'buckets', (SELECT jsonb_agg(jsonb_build_object('faixa', b.faixa, 'quantidade',
                  (SELECT count(*) FROM latencias l WHERE l.horas >= b.lo AND (b.hi IS NULL OR l.horas < b.hi))) ORDER BY b.ord)
                FROM (VALUES ('<4h', 0.0, 4.0, 1), ('4-24h', 4.0, 24.0, 2), ('1-3d', 24.0, 72.0, 3),
                             ('3-7d', 72.0, 168.0, 4), ('7d+', 168.0, NULL::float8, 5)) AS b(faixa, lo, hi, ord)),
    -- Uma passada só sobre `ciclos`: mediana e amostras com FILTER de
    -- fechado-pelo-cliente, pendentes com FILTER de sem fechamento. Sem
    -- join a `latencias`, que perderia os clientes só com pendentes.
    'por_cliente', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                      'cliente_id', s.cliente_id,
                      'mediana_horas', s.mediana_horas,
                      'amostras', s.amostras,
                      'pendentes', s.pendentes)
                    ORDER BY s.mediana_horas DESC NULLS LAST)
                    FROM (SELECT c.cliente_id,
                                 round((percentile_cont(0.5) WITHIN GROUP (
                                   ORDER BY GREATEST(0, extract(epoch FROM c.fechado_em - c.enviado_em)) / 3600.0)
                                   FILTER (WHERE c.fechado_em IS NOT NULL AND c.pelo_cliente))::numeric, 1) AS mediana_horas,
                                 count(*) FILTER (WHERE c.fechado_em IS NOT NULL AND c.pelo_cliente) AS amostras,
                                 count(*) FILTER (WHERE c.fechado_em IS NULL) AS pendentes
                          FROM ciclos c
                          GROUP BY c.cliente_id) s), '[]'::jsonb),
    'etapas', jsonb_build_object(
      'amostras', (SELECT count(*) FROM aprov_etapas),
      'mediana_horas', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY horas)::numeric, 1) FROM aprov_etapas))
  ),
  'origem', COALESCE((SELECT jsonb_agg(jsonb_build_object('origem', origem, 'concluidos', concluidos,
                'tempo_medio_dias', tempo_medio_dias) ORDER BY concluidos DESC) FROM origem_agg), '[]'::jsonb)
) END;
$$;

-- Mesmo gotcha de ACL default da 20260903000020: o CREATE OR REPLACE
-- reaplica a ACL default do Supabase (EXECUTE direto para anon/authenticated),
-- então a tripla precisa ser re-executada aqui.
REVOKE ALL ON FUNCTION get_workflow_analytics(timestamptz, timestamptz, text, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_workflow_analytics(timestamptz, timestamptz, text, bigint, bigint, bigint) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION get_workflow_analytics(timestamptz, timestamptz, text, bigint, bigint, bigint) FROM anon;
