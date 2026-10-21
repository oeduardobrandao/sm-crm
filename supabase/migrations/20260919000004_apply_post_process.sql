-- supabase/migrations/20260919000004_apply_post_process.sql
-- Aplicar um template de processo a um post avulso (spec secoes 5.2, 7, 12.13a).
--
-- A SEQUENCIA VEM DO SERVIDOR. nome, tipo, ordem, prazo_dias e tipo_prazo sao
-- reconstruidos do jsonb do template sob FOR SHARE. Do cliente entra so
-- p_step_overrides, por ordem, com no maximo as chaves responsavel_id e
-- prazo_efetivo. Isso e o que impede o cliente de inventar uma sequencia que
-- nunca existiu num template.
--
-- ORDEM DE LOCKS: advisory ':post_move' antes de tudo (a RPC INSERE em
-- post_processes), depois post FOR UPDATE, depois template FOR SHARE. O
-- template nao participa de nenhum ciclo com attach/move, entao vem por
-- ultimo; o post vem antes por ser a linha que o attach concorrente disputa.
-- Essa ordem post -> template e DELIBERADA e nenhum caminho da casa toma
-- template antes de post: nenhuma RPC existente trava workflow_templates (so
-- workflows, em migrate_workflow_template e propagate_*). O UPDATE do editor
-- de templates do CRM pega FOR NO KEY UPDATE, que conflita com este FOR SHARE
-- e no maximo faz uma das duas esperar, sem ciclo.
--
-- FIX ROUND 1. workflow_templates.etapas e jsonb livre, sem CHECK na escrita
-- (a UI aceita 'prazo_dias: 2.5' num input sem step). Antes deste fix round
-- um template assim estourava erro cru no INSERT (22P02 no cast de
-- prazo_dias, 23514 no CHECK de tipo/tipo_prazo de post_process_steps).
-- Codigo novo: template_invalid, levantado por uma validacao de forma sobre
-- cada elemento de etapas (nome, tipo, tipo_prazo, prazo_dias,
-- responsavel_id), logo depois de template_empty e antes de qualquer INSERT.
-- Tambem deste fix round: a chave de p_step_overrides so aceita digitos sem
-- zero a esquerda (regex mais estrito) com o cast protegido por EXCEPTION,
-- no mesmo padrao de detach_posts_keeping_process.
--
-- FIX ROUND 2 (F3). A validacao de forma de prazo_dias e responsavel_id
-- passou a exigir tambem que o valor caiba no tipo de destino (integer e
-- bigint), nao so que seja um inteiro nao negativo: regex '^[0-9]{1,9}$' e
-- '^[0-9]{1,18}$' respectivamente, em vez do '+' sem limite de digitos.
-- Um prazo_dias de 10 digitos (por exemplo 2147483648) passava na forma e
-- estourava 22003 cru no cast do INSERT; agora e template_invalid, antes de
-- qualquer INSERT.
--
-- FIX ROUND 3. Codigo novo: step_deadline_required. Spec 5.2 exige data para
-- CADA etapa a partir da inicial no modo data_fixa, e a spec 7 diz que no
-- modo data_entrega os prazos resultantes sao materializados no snapshot;
-- antes deste fix so a etapa inicial era exigida (a checagem
-- start_deadline_required, abaixo, que continua sendo a unica regra do modo
-- padrao). Quando workflow_templates.modo_prazo esta em ('data_fixa',
-- 'data_entrega'), TODA etapa de ordem >= p_start_ordem precisa de
-- prazo_efetivo nao nulo em p_step_overrides; faltando, step_deadline_required
-- antes de qualquer INSERT. Roda logo apos start_deadline_required, que
-- continua cobrindo so a etapa inicial e vale para todos os modos.

CREATE OR REPLACE FUNCTION public.apply_post_process(
  p_post_id              bigint,
  p_template_id          bigint,
  p_template_fingerprint text,
  p_start_ordem          integer,
  p_step_overrides       jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta      uuid := public.post_process_require_editor();
  v_post       record;
  v_tmpl       record;
  v_n          int;
  v_etapa      jsonb;
  v_key        text;
  v_val        jsonb;
  v_chave      text;
  v_ordem      integer;
  v_resp       bigint;
  v_assinatura text;
  v_board      integer;
  v_proc       bigint;
  v_revisao    integer;
  v_estado     text;
  v_steps      jsonb;
BEGIN
  IF NOT effective_plan_feature(v_conta, 'feature_post_processes') THEN
    RAISE EXCEPTION 'feature_disabled:feature_post_processes' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT wp.id, wp.workflow_id INTO v_post
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_post.workflow_id IS NOT NULL THEN
    RAISE EXCEPTION 'post_in_workflow' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM post_processes pp
              WHERE pp.post_id = p_post_id AND pp.conta_id = v_conta
                AND pp.estado IN ('ativo', 'concluido')) THEN
    RAISE EXCEPTION 'post_has_active_process' USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.nome, t.etapas, t.modo_prazo INTO v_tmpl
    FROM workflow_templates t
   WHERE t.id = p_template_id AND t.conta_id = v_conta
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_tmpl.etapas IS NULL OR jsonb_typeof(v_tmpl.etapas) <> 'array'
     OR jsonb_array_length(v_tmpl.etapas) = 0 THEN
    RAISE EXCEPTION 'template_empty' USING ERRCODE = 'P0001';
  END IF;

  -- FIX ROUND 1 (F1): etapas e jsonb livre, sem CHECK na escrita. VALIDA em
  -- vez de coagir, para nao divergir de post_process_assinatura(), que le o
  -- mesmo jsonb sem normalizar prazo_dias nem responsavel_id. Roda antes de
  -- qualquer INSERT: template invalido nao cria linha nenhuma.
  FOR v_etapa IN SELECT e.val FROM jsonb_array_elements(v_tmpl.etapas) AS e(val) LOOP
    IF coalesce(v_etapa ->> 'nome', '') = '' THEN
      RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF nullif(v_etapa ->> 'tipo', '') IS NOT NULL
       AND nullif(v_etapa ->> 'tipo', '') NOT IN ('padrao', 'aprovacao_cliente') THEN
      RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF nullif(v_etapa ->> 'tipo_prazo', '') IS NOT NULL
       AND nullif(v_etapa ->> 'tipo_prazo', '') NOT IN ('uteis', 'corridos') THEN
      RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
    END IF;
    -- jsonb_typeof(NULL) e NULL quando a chave esta ausente (operador ->
    -- devolve SQL NULL); quando presente com valor JSON null, devolve 'null'.
    -- So os dois casos pulam a checagem; qualquer outro tipo que nao seja
    -- number, ou um number com casas decimais/sinal, e template_invalid.
    -- FIX ROUND 2 (F3): alem de inteiro nao negativo, o valor precisa caber no
    -- tipo da coluna de destino, senao o cast do INSERT (linhas abaixo)
    -- estoura 22003 cru. Regex com limite de digitos garante isso sem
    -- precisar de cast protegido: 9 digitos cabe com folga em integer, 18 em
    -- bigint.
    IF jsonb_typeof(v_etapa -> 'prazo_dias') IS NOT NULL
       AND jsonb_typeof(v_etapa -> 'prazo_dias') <> 'null' THEN
      IF jsonb_typeof(v_etapa -> 'prazo_dias') <> 'number'
         OR (v_etapa -> 'prazo_dias') #>> '{}' !~ '^[0-9]{1,9}$' THEN
        RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF jsonb_typeof(v_etapa -> 'responsavel_id') IS NOT NULL
       AND jsonb_typeof(v_etapa -> 'responsavel_id') <> 'null' THEN
      IF jsonb_typeof(v_etapa -> 'responsavel_id') <> 'number'
         OR (v_etapa -> 'responsavel_id') #>> '{}' !~ '^[0-9]{1,18}$' THEN
        RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  IF public.template_fingerprint(p_template_id) IS DISTINCT FROM p_template_fingerprint THEN
    RAISE EXCEPTION 'template_changed' USING ERRCODE = 'P0001';
  END IF;

  v_n := jsonb_array_length(v_tmpl.etapas);
  IF p_start_ordem IS NULL OR p_start_ordem < 0 OR p_start_ordem >= v_n THEN
    RAISE EXCEPTION 'invalid_start_ordem' USING ERRCODE = 'P0001';
  END IF;

  -- Exigencia estrutural do modo data_entrega (spec secao 7, Decisao 18): a
  -- sequencia a partir da inicial precisa ter ao menos uma etapa
  -- aprovacao_cliente. E checagem de FORMA, nao de data: le so 'tipo' do jsonb
  -- do template e nao reimplementa dias uteis nem clientes.dia_entrega em SQL,
  -- o que a secao 7 proibe. Vem depois de invalid_start_ordem, porque a regra e
  -- relativa a ordem inicial, e antes da validacao de p_step_overrides e de
  -- qualquer INSERT: template invalido nao cria linha nenhuma. Os demais modos
  -- ('padrao', 'data_fixa') ignoram a regra.
  IF coalesce(v_tmpl.modo_prazo, 'padrao') = 'data_entrega'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(v_tmpl.etapas) WITH ORDINALITY AS e(val, ord)
        WHERE (e.ord - 1) >= p_start_ordem
          AND coalesce(nullif(e.val ->> 'tipo', ''), 'padrao') = 'aprovacao_cliente') THEN
    RAISE EXCEPTION 'data_entrega_requires_approval_step' USING ERRCODE = 'P0001';
  END IF;

  -- Validacao de p_step_overrides: objeto de objetos, chaves numericas dentro
  -- da sequencia e nao anteriores a inicial, e no maximo responsavel_id e
  -- prazo_efetivo dentro de cada uma.
  IF p_step_overrides IS NOT NULL THEN
    IF jsonb_typeof(p_step_overrides) <> 'object' THEN
      RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_step_overrides) LOOP
      -- FIX ROUND 1 (F2): sem zero a esquerda e ate 9 digitos, o que cabe com
      -- folga em integer. Cast protegido como em detach_posts_keeping_process
      -- (20260919000003): mesmo com a regex apertada, uma chave sem
      -- correspondencia cai aqui em vez de estourar erro cru.
      IF v_key !~ '^(0|[1-9][0-9]{0,8})$' THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        v_ordem := v_key::integer;
      EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END;
      IF v_ordem >= v_n OR v_ordem < p_start_ordem THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END IF;
      IF jsonb_typeof(v_val) <> 'object' THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END IF;
      FOR v_chave IN SELECT jsonb_object_keys(v_val) LOOP
        IF v_chave NOT IN ('responsavel_id', 'prazo_efetivo') THEN
          RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
      IF (v_val ->> 'prazo_efetivo') IS NOT NULL THEN
        BEGIN
          PERFORM (v_val ->> 'prazo_efetivo')::timestamptz;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
        END;
      END IF;
      IF (v_val ->> 'responsavel_id') IS NOT NULL THEN
        BEGIN
          v_resp := (v_val ->> 'responsavel_id')::bigint;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
        END;
        IF NOT EXISTS (SELECT 1 FROM membros m WHERE m.id = v_resp AND m.conta_id = v_conta) THEN
          RAISE EXCEPTION 'membro_not_found' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- A etapa inicial e a unica que precisa de prazo agora: e ela que fica ativa.
  IF (p_step_overrides -> p_start_ordem::text ->> 'prazo_efetivo') IS NULL THEN
    RAISE EXCEPTION 'start_deadline_required' USING ERRCODE = 'P0001';
  END IF;

  -- FIX ROUND 3. Nos modos data_fixa e data_entrega (spec 5.2, 7), o prazo
  -- resultante de CADA etapa e materializado no snapshot: nao basta a etapa
  -- inicial ter prazo_efetivo, toda etapa a partir dela precisa. O modo
  -- padrao continua exigindo so a inicial (checagem acima).
  IF coalesce(v_tmpl.modo_prazo, 'padrao') IN ('data_fixa', 'data_entrega') THEN
    FOR v_ordem IN p_start_ordem .. (v_n - 1) LOOP
      IF (p_step_overrides -> v_ordem::text ->> 'prazo_efetivo') IS NULL THEN
        RAISE EXCEPTION 'step_deadline_required' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  SELECT string_agg((e.ord - 1)::text || '|' || coalesce(e.val ->> 'nome', '')
                    || '|' || coalesce(nullif(e.val ->> 'tipo', ''), 'padrao'),
                    chr(10) ORDER BY e.ord)
    INTO v_assinatura
    FROM jsonb_array_elements(v_tmpl.etapas) WITH ORDINALITY AS e(val, ord);

  -- Ativos e concluidos: sao os dois estados que aparecem no quadro. So os
  -- ativos deixaria um concluido reaberto colidindo com um processo novo na
  -- mesma posicao (Decisao 19). Encerrado nao aparece e nao entra no max.
  SELECT coalesce(max(pp.board_position), -1) + 1 INTO v_board
    FROM post_processes pp WHERE pp.conta_id = v_conta AND pp.estado IN ('ativo', 'concluido');

  INSERT INTO post_processes
    (conta_id, post_id, template_id, template_nome, assinatura, estado, etapa_atual,
     modo_prazo, board_position, created_by)
  VALUES
    (v_conta, p_post_id, p_template_id, v_tmpl.nome, v_assinatura, 'ativo', p_start_ordem,
     coalesce(v_tmpl.modo_prazo, 'padrao'), v_board, auth.uid())
  RETURNING id, revisao, estado INTO v_proc, v_revisao, v_estado;

  -- responsavel_id: override vence; senao o do template, mas so se ainda
  -- resolver para um membro da conta (um template pode carregar id de membro
  -- ja removido, e a FK composta derrubaria a operacao inteira).
  INSERT INTO post_process_steps
    (conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias, tipo_prazo,
     prazo_efetivo, estado, iniciado_em)
  SELECT
    v_conta, v_proc, (e.ord - 1)::integer,
    coalesce(e.val ->> 'nome', ''),
    coalesce(nullif(e.val ->> 'tipo', ''), 'padrao'),
    -- Override presente vence sempre, inclusive {"responsavel_id": null} para
    -- limpar o responsavel do template; so a AUSENCIA da chave herda do template.
    CASE WHEN (p_step_overrides -> (e.ord - 1)::text) ? 'responsavel_id'
         THEN (p_step_overrides -> (e.ord - 1)::text ->> 'responsavel_id')::bigint
         ELSE (SELECT m.id FROM membros m
                WHERE m.id = (e.val ->> 'responsavel_id')::bigint AND m.conta_id = v_conta)
    END,
    (e.val ->> 'prazo_dias')::integer,
    nullif(e.val ->> 'tipo_prazo', ''),
    (p_step_overrides -> (e.ord - 1)::text ->> 'prazo_efetivo')::timestamptz,
    CASE WHEN (e.ord - 1) < p_start_ordem THEN 'ignorado'
         WHEN (e.ord - 1) = p_start_ordem THEN 'ativo'
         ELSE 'pendente' END,
    CASE WHEN (e.ord - 1) = p_start_ordem THEN now() ELSE NULL END
    FROM jsonb_array_elements(v_tmpl.etapas) WITH ORDINALITY AS e(val, ord);

  PERFORM public.post_process_log_event(
    v_conta, p_post_id, v_proc, 'aplicado', NULL,
    jsonb_build_object('template_id', p_template_id, 'template_nome', v_tmpl.nome,
                       'start_ordem', p_start_ordem, 'etapa_atual', p_start_ordem));

  SELECT jsonb_agg(to_jsonb(y) ORDER BY y.ordem) INTO v_steps FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = v_proc) y;

  RETURN jsonb_build_object(
    'ok', true,
    'process_id', v_proc,
    'post_id', p_post_id,
    'estado', v_estado,
    'etapa_atual', p_start_ordem,
    'revisao', v_revisao,
    'assinatura', v_assinatura,
    'template_id', p_template_id,
    'template_nome', v_tmpl.nome,
    'steps', coalesce(v_steps, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.apply_post_process(bigint, bigint, text, integer, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_post_process(bigint, bigint, text, integer, jsonb)
  TO authenticated, service_role;
