-- Posts avulsos (fora de fluxo): RPCs detach/attach. Task 4 do plano
-- .superpowers/sdd/2026-08-29-posts-avulsos-plan. Depende da 20260830000001
-- (workflow_posts.cliente_id sempre presente; workflow_id nullable; trigger
-- post_a0_sync_cliente bloqueia qualquer UPDATE que mude workflow_id/cliente_id
-- fora destas RPCs, a menos que a GUC transacional app.allow_post_move='on'
-- esteja setada) e da 20260830000003 (folder_sync_post reparenta a pasta do
-- post sozinho quando workflow_id muda -- nenhuma logica de pasta aqui).
--
-- Estas RPCs sao o UNICO caminho sancionado para mover posts entre fluxo e
-- avulso. Modeladas em migrate_workflow_template (20260826000002): SECURITY
-- DEFINER, v_conta := public.get_my_conta_id(), SET search_path = public,
-- pg_temp, REVOKE ALL ... FROM public, anon; GRANT EXECUTE ... TO
-- authenticated, service_role (chamadas pelo usuario autenticado do CRM --
-- authenticated MANTEM EXECUTE, ao contrario das RPCs service_role-only da
-- 20260830000002).
--
-- Estilo de erro (decisao de estilo adiada da Task 1, resolvida aqui):
-- mensagens-codigo (post_not_found, workflow_not_active, ...) com
-- USING ERRCODE = 'P0001' -- mesmo SQLSTATE que RAISE EXCEPTION usa por
-- padrao quando nao especificado (migrate_workflow_template, por exemplo,
-- nao especifica), mas explicito aqui em toda RAISE EXCEPTION deste arquivo
-- para fixar o padrao do arquivo de forma inequivoca.
--
-- Nem detach nem attach tocam post_property_values: valores de propriedades
-- sao preservados como dados inativos (so renderizam quando o post estiver
-- num fluxo cujo template tenha as definitions correspondentes). Nada e
-- apagado em nenhuma das duas RPCs.
--
-- Padrao de lock "PERFORM ... FOR UPDATE" seguido de um SELECT count(*)/
-- array_agg separado (sem FOR UPDATE): copiado de reorder_post_schedules
-- (20260830000002) -- Postgres proibe combinar FOR UPDATE com funcoes de
-- agregacao/GROUP BY na mesma consulta, entao o lock e a leitura agregada
-- precisam ser duas instrucoes distintas mesmo dentro da mesma transacao (o
-- lock ja adquirido pela primeira instrucao cobre a segunda).
--
-- Lock ordering: attach trava o workflow ALVO primeiro (FOR UPDATE), depois
-- os posts (ORDER BY id FOR UPDATE) -- mesma ordem que a familia de triggers
-- ja usa (propagate_workflow_cliente_to_posts roda com o workflow ja travado
-- e entao da UPDATE em workflow_posts; sync_workflow_post_cliente trava o
-- workflow FOR SHARE antes do INSERT do post). Detach trava SO os posts;
-- mais tarde, so no bloco de arquivamento (apos a UPDATE que zera
-- workflow_id), trava os workflows de origem que ficaram vazios -- ordem
-- post-entao-workflow ali, oposta a do attach, mas os dois lados nunca
-- competem pelas MESMAS linhas de post e workflow ao mesmo tempo em uso
-- normal (attach exige avulso; detach so mexe em quem ja estava anexado), e
-- e a ordem explicitamente pedida pela spec desta task.

-- ============================================================
-- detach_posts_from_flow: desanexa posts de seus fluxos (workflow_id -> NULL).
-- Sem validacao de limite (politica block-new: o bucket de avulso so e
-- fiscalizado na criacao, nunca ao entrar por aqui) -- comportamento fixado
-- por teste na Task 5.
-- ============================================================
CREATE OR REPLACE FUNCTION public.detach_posts_from_flow(
  p_post_ids            bigint[],
  p_archive_empty_flow  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta                 uuid := public.get_my_conta_id();
  v_ids                   bigint[];
  v_requested             int;
  v_owned                 int;
  v_source_workflow_ids   bigint[];
  v_detached              int;
  v_archived              bigint[] := '{}';
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Dedupe + descarta NULLs; array vazio (ou so NULLs) e erro -- nao ha
  -- "nada para desanexar" silencioso.
  SELECT coalesce(array_agg(DISTINCT x), '{}')
    INTO v_ids
    FROM unnest(p_post_ids) x
   WHERE x IS NOT NULL;

  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  -- Lock das linhas proprias em ordem estavel (previne deadlock com outra
  -- chamada concorrente que travar os mesmos posts em ordem diferente).
  PERFORM 1
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;

  -- All-or-nothing: todo id pedido tem que resolver para uma linha travada
  -- acima (mesma conta). Um id inexistente ou de outra conta nao trava nada
  -- e derruba a contagem abaixo do pedido -- nada foi alterado ainda.
  SELECT count(*) INTO v_owned
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta;

  IF v_owned <> v_requested THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Fontes com fluxo, capturadas ANTES do UPDATE abaixo zerar workflow_id --
  -- depois da UPDATE nao haveria mais como saber de qual fluxo cada post veio.
  SELECT coalesce(array_agg(DISTINCT wp.workflow_id), '{}')
    INTO v_source_workflow_ids
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta AND wp.workflow_id IS NOT NULL;

  -- Transacional (terceiro argumento true): reseta sozinha no COMMIT/ROLLBACK,
  -- nunca vaza para outra transacao/conexao. Sem isso o guard BEFORE UPDATE
  -- post_a0_sync_cliente (20260830000001) rejeitaria esta UPDATE com
  -- post_move_requires_rpc.
  PERFORM set_config('app.allow_post_move', 'on', true);

  -- Posts ja avulsos entre os pedidos (workflow_id ja NULL) sao no-op aqui --
  -- o predicado "workflow_id IS NOT NULL" so atualiza quem de fato tinha
  -- fluxo, e "detached" abaixo reflete exatamente essas linhas.
  UPDATE workflow_posts
     SET workflow_id = NULL
   WHERE id = ANY(v_ids) AND conta_id = v_conta AND workflow_id IS NOT NULL;
  GET DIAGNOSTICS v_detached = ROW_COUNT;

  IF p_archive_empty_flow AND array_length(v_source_workflow_ids, 1) IS NOT NULL THEN
    -- Trava (ordem estavel) so os workflows de ORIGEM do lote desanexado --
    -- nunca um workflow vazio qualquer que nao tenha nada a ver com esta
    -- chamada.
    PERFORM 1
      FROM workflows w
     WHERE w.id = ANY(v_source_workflow_ids) AND w.conta_id = v_conta
     ORDER BY w.id
       FOR UPDATE;

    SELECT coalesce(array_agg(w.id ORDER BY w.id), '{}')
      INTO v_archived
      FROM workflows w
     WHERE w.id = ANY(v_source_workflow_ids)
       AND w.conta_id = v_conta
       AND NOT EXISTS (SELECT 1 FROM workflow_posts wp WHERE wp.workflow_id = w.id);

    IF array_length(v_archived, 1) IS NOT NULL THEN
      -- workflows_updated_event (20260826000001, Trigger B) dispara
      -- normalmente aqui e grava 'fluxo_arquivado' -- nao suprimimos: e o
      -- mesmo caminho de UPDATE direto que qualquer arquivamento manual ja
      -- usa, sem tratamento especial.
      UPDATE workflows SET status = 'arquivado' WHERE id = ANY(v_archived);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'detached', v_detached,
    'archived_workflow_ids', to_jsonb(v_archived)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.detach_posts_from_flow(bigint[], boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.detach_posts_from_flow(bigint[], boolean) TO authenticated, service_role;

-- ============================================================
-- attach_posts_to_flow: anexa posts avulsos a um fluxo ativo
-- (workflow_id -> p_workflow_id). Unica das duas RPCs que valida o limite de
-- plano -- o bucket "posts por fluxo" (trg_limit_posts, 20260830000001) so
-- roda em INSERT e nunca dispara nesta UPDATE, entao a guarda abaixo e o
-- unico enforcement possivel neste caminho.
-- ============================================================
CREATE OR REPLACE FUNCTION public.attach_posts_to_flow(
  p_post_ids     bigint[],
  p_workflow_id  bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta           uuid := public.get_my_conta_id();
  v_ids             bigint[];
  v_requested       int;
  v_owned           int;
  v_wf_cliente_id   bigint;
  v_wf_status       text;
  v_not_avulso      int;
  v_wrong_client    int;
  v_limit           bigint;
  v_current         bigint;
  v_max_ordem       integer;
  v_attached        int;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Dedupe + descarta NULLs; array vazio (ou so NULLs) e erro.
  SELECT coalesce(array_agg(DISTINCT x), '{}')
    INTO v_ids
    FROM unnest(p_post_ids) x
   WHERE x IS NOT NULL;

  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  -- 1) Trava o fluxo ALVO primeiro (lock ordering: workflow antes de posts).
  SELECT cliente_id, status INTO v_wf_cliente_id, v_wf_status
    FROM workflows
   WHERE id = p_workflow_id AND conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_wf_status <> 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- 2) Trava os posts em ordem estavel (mesmo padrao de
  -- detach_posts_from_flow / reorder_post_schedules).
  PERFORM 1
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;

  -- All-or-nothing de posse: mesma logica do detach.
  SELECT count(*) INTO v_owned
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta;
  IF v_owned <> v_requested THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Todos precisam estar avulsos (all-or-nothing -- nenhum reanexo parcial).
  SELECT count(*) INTO v_not_avulso
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta AND wp.workflow_id IS NOT NULL;
  IF v_not_avulso > 0 THEN
    RAISE EXCEPTION 'post_already_in_flow' USING ERRCODE = 'P0001';
  END IF;

  -- Todos precisam ser do MESMO cliente do fluxo alvo (all-or-nothing).
  SELECT count(*) INTO v_wrong_client
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta AND wp.cliente_id <> v_wf_cliente_id;
  IF v_wrong_client > 0 THEN
    RAISE EXCEPTION 'post_belongs_to_another_client' USING ERRCODE = 'P0001';
  END IF;

  -- 3) Guarda de limite, sob o MESMO advisory lock (mesma chave: conta +
  -- limit_key) do limitador generico enforce_plan_count_limit
  -- (20260611130002) -- serializa esta checagem contra INSERTs concorrentes
  -- de posts novos no fluxo (trg_limit_posts) e contra outra chamada
  -- concorrente de attach_posts_to_flow na MESMA conta. Adquirido antes de
  -- contar, exatamente como o limitador generico faz.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));

  v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_current
      FROM workflow_posts
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta;

    -- Fronteira exata: current + incoming = limit PASSA (nao estoura);
    -- current + incoming = limit + 1 estoura. Mesma semantica de
    -- enforce_plan_count_limit aplicada a um lote (cada post do lote, se
    -- inserido um a um, precisaria satisfazer count_no_momento < limit).
    IF v_current + v_requested > v_limit THEN
      RAISE EXCEPTION 'plan_limit_exceeded:max_posts_per_workflow' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4) ordem = max(ordem) atual do fluxo alvo + row_number() deterministico
  -- por id (nao pela ordem de p_post_ids, que nao e garantida estavel pelo
  -- chamador).
  SELECT coalesce(max(ordem), -1) INTO v_max_ordem
    FROM workflow_posts
   WHERE workflow_id = p_workflow_id AND conta_id = v_conta;

  PERFORM set_config('app.allow_post_move', 'on', true);

  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY id) AS rn
      FROM workflow_posts
     WHERE id = ANY(v_ids) AND conta_id = v_conta
  )
  UPDATE workflow_posts wp
     SET workflow_id = p_workflow_id,
         ordem = (v_max_ordem + ranked.rn)::integer
    FROM ranked
   WHERE wp.id = ranked.id;
  GET DIAGNOSTICS v_attached = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'attached', v_attached);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_posts_to_flow(bigint[], bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.attach_posts_to_flow(bigint[], bigint) TO authenticated, service_role;
