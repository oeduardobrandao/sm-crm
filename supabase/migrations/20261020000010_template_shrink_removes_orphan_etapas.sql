-- ============================================================
-- update_workflow_template: template encolhido remove a cauda orfa dos fluxos
-- ============================================================
-- Incidente 2026-10-16 (workspace Maven, templates Equipe Azul/Laranja/Louise): uma
-- etapa "Em gravacao" foi inserida no meio de templates de 7 etapas e removida ~1h
-- depois. O casamento e posicional, entao o primeiro save renomeou as ordens seguintes
-- uma casa para baixo e o backfill criou a ordem 7 com o nome da ultima etapa
-- ("Agendamento"). O segundo save desfez os nomes, mas a regra de 20260925130002 era
-- "sem etapa no template novo -> etapa intocada": a ordem 7 ficou em ~70 fluxos, que
-- passaram a mostrar duas colunas "Agendamento" no quadro e a exigir passar pela
-- etapa duas vezes. duplicate_workflow e o split de posts em fluxo novo copiam as
-- etapas do fluxo de ORIGEM, entao fluxos criados depois herdaram a etapa extra.
-- Os fluxos ja afetados sao limpos a parte; esta migration so impede a recorrencia.
--
-- Regra nova, so quando o template encolhe, por fluxo ativo, depois do merge e do
-- backfill: da ultima ordem para tras, apaga a etapa enquanto
--   ordem >= tamanho do template novo
--   ordem <  tamanho do template antigo, com o MESMO nome do template antigo naquela
--            posicao (herdada; etapa propria do fluxo ou renomeada nele fica)
--   status pendente, iniciado_em e concluido_em NULL
--   sem portal_approvals e sem workflow_events apontando para ela (uma edicao manual
--            grava etapa_editada, entao isso tambem cobre "o usuario mexeu nela")
--   unica linha naquela ordem
-- e para na primeira que falha. So a cauda sai, entao a ordem nunca ganha buraco:
-- o CRM procura a proxima etapa por ordem + 1 (useWorkflowStageCommands).
--
-- O evento template_propagado ganha etapas_removidas e, em alteracoes, uma entrada
-- campo 'removida' com o snapshot inteiro da etapa em 'de' (o evento continua sendo o
-- registro para desfazer um save ruim). A timeline do CRM so le template_nome deste
-- evento, entao nada muda no frontend.
--
-- Limitacao que continua: inserir ou reordenar etapas no meio do template ainda casa
-- por posicao (renomeia as seguintes, e etapas ja concluidas nunca sao renomeadas de
-- volta). Resolver isso exige ids estaveis por etapa.
--
-- propagate_template_to_workflows (so backfill, janela de deploy de 20260925130002)
-- fica como esta.
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
  -- cauda orfa (template encolheu)
  v_removed integer;
  v_n_new integer;
  v_n_old integer;
  v_tail record;
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
    -- so tem FK global, e esta funcao e SECURITY DEFINER. Mesma forma estrita de
    -- apply_post_process (20260920000011): so JSON number (ou null/ausente)
    -- passam aqui; uma string como "5" ou "" e invalid_responsavel, mesmo sendo
    -- numerica. O lado OLD-template abaixo continua lenient (regex sobre ->>),
    -- porque le valores salvos sem essa validacao.
    IF jsonb_typeof(v_e -> 'responsavel_id') IS NOT NULL
       AND jsonb_typeof(v_e -> 'responsavel_id') <> 'null' THEN
      IF jsonb_typeof(v_e -> 'responsavel_id') <> 'number'
         OR (v_e -> 'responsavel_id') #>> '{}' !~ '^[0-9]{1,18}$' THEN
        RAISE EXCEPTION 'invalid_responsavel';
      END IF;
      v_resp_raw := (v_e -> 'responsavel_id') #>> '{}';
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

  v_n_new := jsonb_array_length(p_etapas);
  v_n_old := CASE WHEN jsonb_typeof(v_old) = 'array' THEN jsonb_array_length(v_old) ELSE 0 END;

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
        CONTINUE;  -- template encolheu: tratada na caminhada da cauda, abaixo
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

    -- cauda orfa: da ultima ordem para tras, apaga enquanto a etapa estiver alem do
    -- template novo E for uma posicao do template antigo com o mesmo nome, pendente,
    -- nunca iniciada e sem historico (portal_approvals, workflow_events). Para na
    -- primeira que falha: so a cauda sai, entao a ordem nunca ganha buraco (o CRM
    -- avanca por ordem + 1).
    v_removed := 0;
    FOR v_tail IN
      SELECT id, ordem, status, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
             iniciado_em, concluido_em, data_limite
      FROM workflow_etapas
      WHERE workflow_id = v_wf.id AND ordem >= v_n_new
      ORDER BY ordem DESC, id DESC
      FOR UPDATE
    LOOP
      EXIT WHEN v_tail.ordem >= v_n_old
        OR jsonb_typeof(v_old -> v_tail.ordem) IS DISTINCT FROM 'object'
        OR v_tail.nome IS DISTINCT FROM (v_old -> v_tail.ordem ->> 'nome')
        OR v_tail.status IS DISTINCT FROM 'pendente'
        OR v_tail.iniciado_em IS NOT NULL
        OR v_tail.concluido_em IS NOT NULL
        OR EXISTS (SELECT 1 FROM workflow_etapas d
                   WHERE d.workflow_id = v_wf.id AND d.ordem = v_tail.ordem AND d.id <> v_tail.id)
        OR EXISTS (SELECT 1 FROM portal_approvals pa WHERE pa.workflow_etapa_id = v_tail.id)
        OR EXISTS (SELECT 1 FROM workflow_events ev
                   WHERE ev.workflow_id = v_wf.id AND ev.etapa_id = v_tail.id);

      DELETE FROM workflow_etapas WHERE id = v_tail.id AND status = 'pendente';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      EXIT WHEN v_rows = 0;

      v_removed := v_removed + 1;
      -- 'de' e o snapshot inteiro: o evento e o registro para desfazer o save.
      v_wf_changes := v_wf_changes || jsonb_build_array(jsonb_build_object(
        'etapa_id', v_tail.id, 'ordem', v_tail.ordem, 'campo', 'removida',
        'de', jsonb_build_object(
          'nome', v_tail.nome, 'prazo_dias', v_tail.prazo_dias,
          'tipo_prazo', v_tail.tipo_prazo, 'responsavel_id', v_tail.responsavel_id,
          'tipo', v_tail.tipo, 'data_limite', v_tail.data_limite),
        'para', NULL));
    END LOOP;

    -- Transacional de proposito (sem EXCEPTION): este evento e o registro de undo.
    IF v_updated + v_inserted + v_removed > 0 THEN
      PERFORM record_workflow_event(
        v_wf.id, v_conta, 'template_propagado', NULL, NULL,
        jsonb_build_object(
          'template_id', p_template_id,
          'template_nome', v_nome,
          'etapas_atualizadas', v_updated,
          'etapas_criadas', v_inserted,
          'etapas_removidas', v_removed,
          'alteracoes', v_wf_changes
        )
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.update_workflow_template(bigint, text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_workflow_template(bigint, text, jsonb, text) TO authenticated, service_role;
