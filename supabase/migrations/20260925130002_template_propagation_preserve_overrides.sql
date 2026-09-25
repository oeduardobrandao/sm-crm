-- ============================================================
-- update_workflow_template + propagate_template_to_workflows reduzido a backfill
-- ============================================================
-- Spec: docs/superpowers/specs/2026-09-25-template-propagation-preserve-overrides-design.md
--
-- Incidente 2026-09-24 17:22 UTC (DK Marketing Medico, template "Posts (Estaticos e
-- Carrosseis)"): a unica mudanca pretendida era o responsavel de cada etapa, mas
-- propagate_template_to_workflows le o template DEPOIS do save e copia nome,
-- prazo_dias, tipo_prazo, responsavel_id (e tipo em pendente) para toda etapa
-- pendente/ativa de todo fluxo ativo. Dez fluxos tinham prazo de Copy customizado
-- na criacao; voltaram para prazo_dias = 1 e estouraram. Como a propagacao liga
-- app.suppress_workflow_events, os valores antigos nao ficaram registrados em lugar
-- nenhum.
--
-- Regra nova (por campo, por etapa, casamento posicional como antes):
--   template antigo X, novo X            -> mantem
--   template antigo X, novo Y, fluxo X   -> Y        (valor herdado segue o template)
--   template antigo X, novo Y, fluxo Z   -> mantem Z (valor customizado no fluxo)
--   sem etapa no template novo           -> etapa intocada
-- prazo e o PAR (prazo_dias, tipo_prazo). Concluida nunca e tocada; ativa nunca
-- recebe tipo; posicao sem linha no fluxo recebe backfill 'pendente' com os
-- valores novos (data_limite NULL), como em 20260828000010.
--
-- O template antigo foi salvo sem validacao no servidor: prazo_dias 2.5 ou
-- responsavel_id "abc" existem. Ele e lido com guardas de regex (mesmas de
-- apply_post_process); campo ilegivel = sem valor antigo = fluxo mantem o seu.
-- Um cast cru ali levantaria 22P02 e travaria o proprio save que corrige o template.
--
-- Evento template_propagado por fluxo tocado ganha 'alteracoes'
-- ([{etapa_id, ordem, campo, de, para}], de/para do prazo como objeto do par) e e
-- gravado SEM bloco EXCEPTION: se o evento falhar, o save inteiro volta. Ele e o
-- registro para desfazer um save ruim sem backup.
--
-- Janela de deploy: a migration sobe antes do merge e o merge publica o frontend na
-- hora, entao o modal antigo continua chamando propagate_template_to_workflows por
-- alguns minutos. Esse RPC vira so-backfill: nesse intervalo um save alcanca fluxos
-- novos e adiciona etapas novas, mas nunca sobrescreve. Sera removido numa migration
-- de follow-up.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_workflow_template(
  p_template_id bigint,
  p_nome        text,
  p_etapas      jsonb,
  p_modo_prazo  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_old jsonb;
  v_nome text := btrim(p_nome);
  v_e jsonb;
  v_resp_raw text;
  v_wf record;
  v_etapa record;
  v_old_e jsonb;
  v_new_e jsonb;
  -- template antigo, normalizado
  o_nome text; o_prazo integer; o_prazo_ok boolean; o_tp text;
  o_resp bigint; o_resp_ok boolean; o_tipo text;
  -- template novo, normalizado (ja validado)
  n_nome text; n_prazo integer; n_tp text; n_resp bigint; n_tipo text;
  -- valores a gravar na etapa
  w_nome text; w_prazo integer; w_tp text; w_resp bigint; w_tipo text;
  v_changes jsonb;
  v_wf_changes jsonb;
  v_updated integer;
  v_inserted integer;
  v_rows integer;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  -- Trava a linha do template: dois saves do mesmo template serializam, e cada um
  -- faz o merge contra a versao que o outro gravou.
  SELECT etapas INTO v_old
  FROM workflow_templates
  WHERE id = p_template_id AND conta_id = v_conta
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;

  -- ---------- validacao (toda checagem trata NULL explicitamente) ----------
  IF coalesce(v_nome, '') = '' THEN
    RAISE EXCEPTION 'template_invalid';
  END IF;
  IF p_modo_prazo IS NULL OR p_modo_prazo NOT IN ('padrao', 'data_fixa', 'data_entrega') THEN
    RAISE EXCEPTION 'template_invalid';
  END IF;
  IF p_etapas IS NULL OR jsonb_typeof(p_etapas) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_etapas) = 0 THEN
    RAISE EXCEPTION 'template_invalid';
  END IF;

  FOR v_e IN SELECT value FROM jsonb_array_elements(p_etapas) LOOP
    IF jsonb_typeof(v_e) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    IF jsonb_typeof(v_e -> 'nome') IS DISTINCT FROM 'string'
       OR btrim(v_e ->> 'nome') = '' THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    -- inteiro 0..999 como numero JSON (mesma regra de apply_post_process)
    IF jsonb_typeof(v_e -> 'prazo_dias') IS DISTINCT FROM 'number'
       OR (v_e -> 'prazo_dias') #>> '{}' !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    IF (v_e ->> 'tipo_prazo') IS NOT NULL
       AND (v_e ->> 'tipo_prazo') NOT IN ('uteis', 'corridos') THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    IF (v_e ->> 'tipo') IS NOT NULL
       AND (v_e ->> 'tipo') NOT IN ('padrao', 'aprovacao_cliente') THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    -- responsavel precisa ser membro DESTE workspace: workflow_etapas.responsavel_id
    -- so tem FK global, e esta funcao e SECURITY DEFINER.
    v_resp_raw := NULLIF(v_e ->> 'responsavel_id', '');
    IF v_resp_raw IS NOT NULL THEN
      IF v_resp_raw !~ '^[0-9]{1,18}$' THEN
        RAISE EXCEPTION 'invalid_responsavel';
      END IF;
      PERFORM 1 FROM membros WHERE id = v_resp_raw::bigint AND conta_id = v_conta;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_responsavel';
      END IF;
    END IF;
  END LOOP;

  -- ---------- salva o template ----------
  UPDATE workflow_templates
  SET nome = v_nome, etapas = p_etapas, modo_prazo = p_modo_prazo
  WHERE id = p_template_id;

  -- Suprime Triggers A/B/C nas escritas de etapa abaixo (transaction-local).
  PERFORM set_config('app.suppress_workflow_events', '1', true);

  -- ---------- propagacao ----------
  -- conta_id no cursor e a fronteira de tenant obrigatoria (template_id e FK global).
  FOR v_wf IN
    SELECT id FROM workflows
    WHERE template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
    ORDER BY id
  LOOP
    -- Re-checa sob lock (serializa contra migrate_workflow_template).
    PERFORM 1 FROM workflows
      WHERE id = v_wf.id AND template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
      FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_updated := 0;
    v_inserted := 0;
    v_wf_changes := '[]'::jsonb;

    -- FOR UPDATE nas etapas ANTES de comparar: updateWorkflowEtapa no CRM escreve
    -- workflow_etapas direto, sem tocar a linha do fluxo. Com o lock, uma edicao
    -- manual concorrente ou commita antes (e este cursor le o valor novo) ou espera.
    FOR v_etapa IN
      SELECT id, ordem, status, nome, prazo_dias, tipo_prazo, responsavel_id, tipo
      FROM workflow_etapas
      WHERE workflow_id = v_wf.id AND status IN ('pendente', 'ativo')
      ORDER BY ordem, id
      FOR UPDATE
    LOOP
      v_new_e := p_etapas -> v_etapa.ordem;
      IF v_new_e IS NULL THEN
        CONTINUE;  -- template encolheu: etapa alem do fim fica intocada
      END IF;

      v_old_e := CASE WHEN jsonb_typeof(v_old) = 'array' THEN v_old -> v_etapa.ordem END;
      IF v_old_e IS NULL OR jsonb_typeof(v_old_e) <> 'object' THEN
        CONTINUE;  -- sem valor antigo na posicao: tudo conta como customizado
      END IF;

      -- antigo, com guardas (nunca cast cru no lado armazenado)
      o_nome := v_old_e ->> 'nome';
      o_prazo_ok := (v_old_e ->> 'prazo_dias') ~ '^[0-9]{1,9}$';
      o_prazo := CASE WHEN o_prazo_ok THEN (v_old_e ->> 'prazo_dias')::integer END;
      o_prazo_ok := coalesce(o_prazo_ok, false);
      o_tp := coalesce(v_old_e ->> 'tipo_prazo', 'corridos');
      v_resp_raw := NULLIF(v_old_e ->> 'responsavel_id', '');
      o_resp_ok := v_resp_raw IS NULL OR v_resp_raw ~ '^[0-9]{1,18}$';
      o_resp := CASE WHEN v_resp_raw ~ '^[0-9]{1,18}$' THEN v_resp_raw::bigint END;
      o_tipo := coalesce(v_old_e ->> 'tipo', 'padrao');

      -- novo (validado acima)
      n_nome := v_new_e ->> 'nome';
      n_prazo := (v_new_e ->> 'prazo_dias')::integer;
      n_tp := coalesce(v_new_e ->> 'tipo_prazo', 'corridos');
      n_resp := NULLIF(v_new_e ->> 'responsavel_id', '')::bigint;
      n_tipo := coalesce(v_new_e ->> 'tipo', 'padrao');

      w_nome := v_etapa.nome;
      w_prazo := v_etapa.prazo_dias;
      w_tp := v_etapa.tipo_prazo;
      w_resp := v_etapa.responsavel_id;
      w_tipo := v_etapa.tipo;
      v_changes := '[]'::jsonb;

      IF n_nome IS DISTINCT FROM o_nome AND v_etapa.nome IS NOT DISTINCT FROM o_nome THEN
        w_nome := n_nome;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'nome',
          'de', to_jsonb(v_etapa.nome), 'para', to_jsonb(n_nome)));
      END IF;

      IF o_prazo_ok
         AND (n_prazo, n_tp) IS DISTINCT FROM (o_prazo, o_tp)
         AND (v_etapa.prazo_dias, coalesce(v_etapa.tipo_prazo, 'corridos'))
             IS NOT DISTINCT FROM (o_prazo, o_tp) THEN
        w_prazo := n_prazo;
        w_tp := n_tp;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'prazo',
          'de', jsonb_build_object('prazo_dias', v_etapa.prazo_dias, 'tipo_prazo', v_etapa.tipo_prazo),
          'para', jsonb_build_object('prazo_dias', n_prazo, 'tipo_prazo', n_tp)));
      END IF;

      IF o_resp_ok
         AND n_resp IS DISTINCT FROM o_resp
         AND v_etapa.responsavel_id IS NOT DISTINCT FROM o_resp THEN
        w_resp := n_resp;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'responsavel_id',
          'de', to_jsonb(v_etapa.responsavel_id), 'para', to_jsonb(n_resp)));
      END IF;

      -- 'ativo': nunca toca tipo (gate de aprovacao em andamento).
      IF v_etapa.status = 'pendente'
         AND n_tipo IS DISTINCT FROM o_tipo
         AND coalesce(v_etapa.tipo, 'padrao') = o_tipo THEN
        w_tipo := n_tipo;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'tipo',
          'de', to_jsonb(v_etapa.tipo), 'para', to_jsonb(n_tipo)));
      END IF;

      IF jsonb_array_length(v_changes) > 0 THEN
        UPDATE workflow_etapas
        SET nome = w_nome, prazo_dias = w_prazo, tipo_prazo = w_tp,
            responsavel_id = w_resp, tipo = w_tipo
        WHERE id = v_etapa.id AND status = v_etapa.status;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows > 0 THEN
          v_updated := v_updated + 1;
          v_wf_changes := v_wf_changes || v_changes;
        END IF;
      END IF;
    END LOOP;

    -- backfill: posicoes do template novo sem linha no fluxo (qualquer status)
    INSERT INTO workflow_etapas
      (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id,
       tipo, status, iniciado_em, concluido_em, data_limite)
    SELECT v_wf.id,
           (t.idx - 1)::integer,
           t.etapa ->> 'nome',
           (t.etapa ->> 'prazo_dias')::integer,
           coalesce(t.etapa ->> 'tipo_prazo', 'corridos'),
           NULLIF(t.etapa ->> 'responsavel_id', '')::bigint,
           coalesce(t.etapa ->> 'tipo', 'padrao'),
           'pendente', NULL, NULL, NULL
    FROM jsonb_array_elements(p_etapas) WITH ORDINALITY AS t(etapa, idx)
    WHERE NOT EXISTS (
      SELECT 1 FROM workflow_etapas we
      WHERE we.workflow_id = v_wf.id AND we.ordem = (t.idx - 1)::integer
    );
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- Transacional de proposito (sem EXCEPTION): este evento e o registro de undo.
    IF v_updated + v_inserted > 0 THEN
      PERFORM record_workflow_event(
        v_wf.id, v_conta, 'template_propagado', NULL, NULL,
        jsonb_build_object(
          'template_id', p_template_id,
          'template_nome', v_nome,
          'etapas_atualizadas', v_updated,
          'etapas_criadas', v_inserted,
          'alteracoes', v_wf_changes
        )
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.update_workflow_template(bigint, text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_workflow_template(bigint, text, jsonb, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- propagate_template_to_workflows: so backfill (janela de deploy)
-- ------------------------------------------------------------
-- Mesmo corpo de 20260828000010 sem o loop de UPDATE: nunca escreve campo de etapa
-- existente. O evento continua best-effort como antes (so insere linhas; nao ha o
-- que desfazer). etapas_atualizadas fica 0 para o formato do metadata nao mudar.
CREATE OR REPLACE FUNCTION public.propagate_template_to_workflows(
  p_template_id bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_etapas jsonb;
  v_template_nome text;
  v_wf record;
  v_inserted_count integer;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  SELECT etapas, nome INTO v_etapas, v_template_nome
  FROM workflow_templates
  WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;

  IF jsonb_typeof(v_etapas) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;

  PERFORM set_config('app.suppress_workflow_events', '1', true);

  FOR v_wf IN
    SELECT id FROM workflows
    WHERE template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
  LOOP
    PERFORM 1 FROM workflows
      WHERE id = v_wf.id AND template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
      FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO workflow_etapas
      (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id,
       tipo, status, iniciado_em, concluido_em, data_limite)
    SELECT v_wf.id,
           (t.idx - 1)::integer,
           t.etapa ->> 'nome',
           (t.etapa ->> 'prazo_dias')::integer,
           coalesce(t.etapa ->> 'tipo_prazo', 'corridos'),
           NULLIF(t.etapa ->> 'responsavel_id', '')::bigint,
           coalesce(t.etapa ->> 'tipo', 'padrao'),
           'pendente', NULL, NULL, NULL
    FROM jsonb_array_elements(v_etapas) WITH ORDINALITY AS t(etapa, idx)
    WHERE jsonb_typeof(t.etapa) = 'object'
      AND NOT EXISTS (
        SELECT 1 FROM workflow_etapas we
        WHERE we.workflow_id = v_wf.id AND we.ordem = (t.idx - 1)::integer
      );
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count > 0 THEN
      BEGIN
        PERFORM record_workflow_event(
          v_wf.id, v_conta, 'template_propagado', NULL, NULL,
          jsonb_build_object(
            'template_id', p_template_id,
            'template_nome', v_template_nome,
            'etapas_atualizadas', 0,
            'etapas_criadas', v_inserted_count
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'propagate_template_to_workflows: failed to record template_propagado event for workflow %: %', v_wf.id, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.propagate_template_to_workflows(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.propagate_template_to_workflows(bigint) TO authenticated, service_role;
