-- ============================================================
-- Propagacao do template casa etapas pelo nome, nao pela posicao
-- ============================================================
-- Incidente 2026-10-22 (Equipe Azul): "Em gravacao" inserida no indice 2 de
-- [Copy, Aprovacao da Copy, Design Vitoria, ...]. update_workflow_template
-- comparava a etapa do fluxo na ordem k com o template antigo e o novo na mesma
-- posicao k. A ativa "Design Vitoria" (ordem 2) batia com o antigo[2], entao era
-- RENOMEADA para o novo[2] ("Em gravacao") e ganhava responsavel e prazo dela; cada
-- etapa seguinte era renomeada para a vizinha e a ultima ("Agendamento") era
-- criada de novo no fim. Para o usuario, os fluxos "pularam" de etapa. Corrigir a
-- etapa na mao depois mudava o vencimento (o avanco recalcula a data_limite).
--
-- Esta migration:
--   1. public._align_etapa_nomes(a text[], b text[]) -> int[]: para cada posicao
--      de b, a posicao (0-based) de a que e a mesma etapa, ou NULL. Nomes aparados
--      com trim_etapa_nome; NULL nunca casa.
--        a) maior subsequencia comum por nome (empate: a ocorrencia mais cedo);
--        b) movidas: nome que sobra exatamente uma vez em cada lado casa;
--        c) o que sobra entre dois casamentos de (a) casa por posicao, um a um
--           (rename no lugar continua rename); sobra em b = inserida, sobra em
--           a = removida.
--   2. update_workflow_template, por fluxo ativo:
--        * alinha o template antigo com o novo (uma vez) e as etapas do fluxo com o
--          template antigo (por fluxo, mesma funcao: fluxo com etapa propria a mais
--          nao desalinha o resto);
--        * etapa casada segue o merge por campo de sempre (so pendente/ativo; o
--          valor so segue o template quando ainda e o do template antigo) e vai
--          para a posicao nova. Concluida so muda de ordem;
--        * etapa de posicao removida do template sai se for herdada (mesmo nome do
--          antigo), nunca iniciada (pendente, ou concluida sem iniciado_em nem
--          concluido_em, a "pulada" do item abaixo) e sem historico
--          (portal_approvals, workflow_events). Senao fica como etapa propria;
--        * etapa propria (sem par no template antigo, ou removida que nao pode sair)
--          fica logo depois da etapa que vinha antes dela no fluxo;
--        * posicao nova sem etapa no fluxo e criada. Antes da etapa ativa entra
--          'concluido' sem datas (pulada, a mesma regra de migrate_workflow_template);
--          depois dela, 'pendente';
--        * reescreve ordem 0..n-1 sem buraco e workflows.etapa_atual = ordem da ativa.
--      O evento template_propagado (registro de undo) ganha campo 'ordem'
--      (de/para), 'criada' (etapa nova) e 'etapa_atual'.
--
-- Nenhuma escrita dispara notificacao: so muda status de etapa NOVA (INSERT, e
-- workflow_etapas so tem triggers AFTER UPDATE com WHEN de mudanca de status), e o
-- trigger de evento de linha (C) e os de workflows (A/B) seguem suprimidos por
-- app.suppress_workflow_events.
--
-- Limites conhecidos:
--   * reordenacao que cruza a etapa ativa: uma pendente que passa para antes da
--     ativa continua pendente (converte-la dispararia notify_step_completed), e uma
--     concluida que passa para depois volta a ser ativada quando o fluxo chegar
--     nela;
--   * rename E insercao no mesmo trecho, no mesmo save, sao indistinguiveis por
--     nome: casam por posicao dentro do trecho (o comportamento antigo).
-- Fluxos que ja tinham buraco ou ordem repetida saem densos no primeiro save.
-- ============================================================

CREATE OR REPLACE FUNCTION public._align_etapa_nomes(p_a text[], p_b text[])
RETURNS integer[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  n int := coalesce(array_length(p_a, 1), 0);
  m int := coalesce(array_length(p_b, 1), 0);
  a text[];
  b text[];
  w int;            -- largura da matriz: m + 1
  lcs int[];        -- lcs[(i-1)*w + j] = LCS de a[i..n] com b[j..m], 1 <= i <= n+1, 1 <= j <= m+1
  res int[];        -- res[j] = i (1-based) casado com b[j], ou NULL
  used boolean[];   -- used[i]: a[i] ja casou
  anc_i int[] := ARRAY[0];   -- casamentos da LCS, com sentinelas (0,0) e (n+1,m+1)
  anc_j int[] := ARRAY[0];
  ga int[];
  gb int[];
  i int; j int; k int; c int;
BEGIN
  IF m = 0 THEN
    RETURN '{}'::int[];
  END IF;
  a := ARRAY(SELECT public.trim_etapa_nome(x) FROM unnest(p_a) WITH ORDINALITY AS u(x, o) ORDER BY o);
  b := ARRAY(SELECT public.trim_etapa_nome(x) FROM unnest(p_b) WITH ORDINALITY AS u(x, o) ORDER BY o);
  res := array_fill(NULL::int, ARRAY[m]);
  used := array_fill(false, ARRAY[greatest(n, 1)]);
  w := m + 1;
  lcs := array_fill(0, ARRAY[(n + 1) * w]);

  -- (a) LCS por sufixo; o passeio para frente casa a ocorrencia mais cedo
  FOR i IN REVERSE n..1 LOOP
    FOR j IN REVERSE m..1 LOOP
      IF a[i] IS NOT NULL AND a[i] = b[j] THEN
        lcs[(i - 1) * w + j] := 1 + lcs[i * w + j + 1];
      ELSE
        lcs[(i - 1) * w + j] := greatest(lcs[i * w + j], lcs[(i - 1) * w + j + 1]);
      END IF;
    END LOOP;
  END LOOP;
  i := 1; j := 1;
  WHILE i <= n AND j <= m LOOP
    IF a[i] IS NOT NULL AND a[i] = b[j] THEN
      res[j] := i; used[i] := true;
      anc_i := anc_i || i; anc_j := anc_j || j;
      i := i + 1; j := j + 1;
    ELSIF lcs[i * w + j] >= lcs[(i - 1) * w + j + 1] THEN
      i := i + 1;
    ELSE
      j := j + 1;
    END IF;
  END LOOP;
  anc_i := anc_i || (n + 1); anc_j := anc_j || (m + 1);

  -- (b) movidas: nome que sobra uma unica vez em cada lado
  FOR j IN 1..m LOOP
    CONTINUE WHEN res[j] IS NOT NULL OR b[j] IS NULL;
    SELECT count(*) INTO c FROM generate_subscripts(b, 1) AS s(x)
      WHERE res[x] IS NULL AND b[x] = b[j];
    CONTINUE WHEN c <> 1;
    SELECT count(*), min(x) INTO c, k FROM generate_subscripts(a, 1) AS s(x)
      WHERE NOT used[x] AND a[x] = b[j];
    CONTINUE WHEN c <> 1;
    res[j] := k; used[k] := true;
  END LOOP;

  -- (c) sobras entre dois casamentos consecutivos da LCS casam por posicao
  FOR k IN 1..array_length(anc_i, 1) - 1 LOOP
    ga := ARRAY(SELECT x FROM generate_series(anc_i[k] + 1, anc_i[k + 1] - 1) AS x
                WHERE NOT used[x] ORDER BY x);
    gb := ARRAY(SELECT x FROM generate_series(anc_j[k] + 1, anc_j[k + 1] - 1) AS x
                WHERE res[x] IS NULL ORDER BY x);
    FOR c IN 1..least(coalesce(array_length(ga, 1), 0), coalesce(array_length(gb, 1), 0)) LOOP
      res[gb[c]] := ga[c]; used[ga[c]] := true;
    END LOOP;
  END LOOP;

  RETURN ARRAY(SELECT r - 1 FROM unnest(res) WITH ORDINALITY AS u(r, o) ORDER BY o);
END;
$fn$;

REVOKE ALL ON FUNCTION public._align_etapa_nomes(text[], text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._align_etapa_nomes(text[], text[]) TO service_role;

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
  v_updated bigint[];   -- ids das etapas reescritas (merge e/ou ordem)
  v_inserted integer;
  v_removed integer;
  v_rows integer;
  v_n_new integer;
  v_n_old integer;
  -- p_etapas com os nomes aparados: e o que se grava e o que se propaga
  v_etapas jsonb;
  -- alinhamento template antigo -> novo
  v_old_nomes text[];
  v_new_nomes text[];
  v_tmap int[];      -- v_tmap[j+1] = posicao antiga da posicao nova j, ou NULL
  v_inv int[];       -- v_inv[i+1]  = posicao nova da posicao antiga i, ou NULL
  -- etapas do fluxo (ordem, id)
  f_id bigint[];
  f_nome text[];
  f_fmap int[];      -- f_fmap[r] = posicao antiga casada com a linha r, ou NULL
  v_covered boolean[];  -- posicao nova ja tem linha do fluxo
  -- itens da escada final: linha existente (id) ou nova (posicao j do template)
  it_id bigint[];
  it_j int[];
  it_key bigint[];
  it_status text[];
  v_r int;
  v_oi int;
  v_tj int;
  v_pred_j int;
  v_deletable boolean;
  v_active_pos int;
  v_new_atual int;
  v_item record;
  v_new_id bigint;
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
       OR public.trim_etapa_nome(v_e ->> 'nome') = '' THEN
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

  -- validado acima: todo elemento e objeto com nome string nao vazio
  SELECT jsonb_agg(jsonb_set(e, '{nome}', to_jsonb(public.trim_etapa_nome(e ->> 'nome'))) ORDER BY o)
    INTO v_etapas
    FROM jsonb_array_elements(p_etapas) WITH ORDINALITY AS x(e, o);

  -- ---------- salva o template ----------
  UPDATE workflow_templates
  SET nome = v_nome, etapas = v_etapas, modo_prazo = p_modo_prazo
  WHERE id = p_template_id;

  v_n_new := jsonb_array_length(v_etapas);
  v_new_nomes := ARRAY(SELECT e ->> 'nome' FROM jsonb_array_elements(v_etapas) WITH ORDINALITY AS x(e, o) ORDER BY o);

  -- Template antigo ilegivel (nao-array): finge um antigo do tamanho do novo, sem
  -- nenhum nome. O alinhamento vira posicional e nenhuma posicao tem valor antigo,
  -- entao nada e mesclado nem removido; so as posicoes que faltam sao criadas.
  IF jsonb_typeof(v_old) = 'array' THEN
    v_n_old := jsonb_array_length(v_old);
    v_old_nomes := ARRAY(
      SELECT CASE WHEN jsonb_typeof(e) = 'object' THEN e ->> 'nome' END
      FROM jsonb_array_elements(v_old) WITH ORDINALITY AS x(e, o) ORDER BY o);
  ELSE
    v_n_old := v_n_new;
    v_old_nomes := array_fill(NULL::text, ARRAY[v_n_new]);
  END IF;

  v_tmap := public._align_etapa_nomes(v_old_nomes, v_new_nomes);
  v_inv := array_fill(NULL::int, ARRAY[greatest(v_n_old, 1)]);
  FOR v_tj IN 0..v_n_new - 1 LOOP
    IF v_tmap[v_tj + 1] IS NOT NULL THEN
      v_inv[v_tmap[v_tj + 1] + 1] := v_tj;
    END IF;
  END LOOP;

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

    v_updated := '{}';
    v_inserted := 0;
    v_removed := 0;
    v_wf_changes := '[]'::jsonb;

    -- FOR UPDATE em TODAS as etapas ANTES de comparar: updateWorkflowEtapa no CRM
    -- escreve workflow_etapas direto, sem tocar a linha do fluxo. Com o lock, uma
    -- edicao manual concorrente ou commita antes (e este cursor le o valor novo) ou
    -- espera. Todas, nao so pendente/ativo: a renumeracao mexe nas concluidas.
    PERFORM 1 FROM workflow_etapas WHERE workflow_id = v_wf.id FOR UPDATE;
    SELECT coalesce(array_agg(id ORDER BY ordem, id), '{}'),
           coalesce(array_agg(nome ORDER BY ordem, id), '{}')
      INTO f_id, f_nome
      FROM workflow_etapas WHERE workflow_id = v_wf.id;

    f_fmap := public._align_etapa_nomes(v_old_nomes, f_nome);
    v_covered := array_fill(false, ARRAY[v_n_new]);
    it_id := '{}'; it_j := '{}'; it_key := '{}'; it_status := '{}';
    v_pred_j := -1;

    FOR v_r IN 1..coalesce(array_length(f_id, 1), 0) LOOP
      SELECT id, ordem, status, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
             iniciado_em, concluido_em, data_limite
        INTO v_etapa FROM workflow_etapas WHERE id = f_id[v_r];
      v_oi := f_fmap[v_r];
      v_tj := CASE WHEN v_oi IS NOT NULL THEN v_inv[v_oi + 1] END;
      v_old_e := CASE WHEN jsonb_typeof(v_old) = 'array' AND v_oi IS NOT NULL THEN v_old -> v_oi END;

      -- ---- posicao antiga removida do template: sai se herdada e intocada ----
      IF v_oi IS NOT NULL AND v_tj IS NULL THEN
        v_deletable := jsonb_typeof(v_old_e) = 'object'
          AND public.trim_etapa_nome(v_etapa.nome)
              IS NOT DISTINCT FROM public.trim_etapa_nome(v_old_e ->> 'nome')
          AND v_etapa.status IN ('pendente', 'concluido')
          AND v_etapa.iniciado_em IS NULL
          AND v_etapa.concluido_em IS NULL
          AND NOT EXISTS (SELECT 1 FROM portal_approvals pa WHERE pa.workflow_etapa_id = v_etapa.id)
          AND NOT EXISTS (SELECT 1 FROM workflow_events ev
                          WHERE ev.workflow_id = v_wf.id AND ev.etapa_id = v_etapa.id);
        IF v_deletable THEN
          DELETE FROM workflow_etapas WHERE id = v_etapa.id AND status = v_etapa.status;
          GET DIAGNOSTICS v_rows = ROW_COUNT;
          IF v_rows > 0 THEN
            v_removed := v_removed + 1;
            -- 'de' e o snapshot inteiro: o evento e o registro para desfazer o save.
            v_wf_changes := v_wf_changes || jsonb_build_array(jsonb_build_object(
              'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'removida',
              'de', jsonb_build_object(
                'nome', v_etapa.nome, 'prazo_dias', v_etapa.prazo_dias,
                'tipo_prazo', v_etapa.tipo_prazo, 'responsavel_id', v_etapa.responsavel_id,
                'tipo', v_etapa.tipo, 'data_limite', v_etapa.data_limite),
              'para', NULL));
            CONTINUE;
          END IF;
        END IF;
      END IF;

      IF v_tj IS NULL THEN
        -- ---- etapa propria: logo depois da etapa que vinha antes dela ----
        it_id := it_id || v_etapa.id;
        it_j := it_j || NULL::int;
        it_key := it_key || ((v_pred_j + 1)::bigint * 1000000 + 100000 + v_r);
        it_status := it_status || v_etapa.status;
        CONTINUE;
      END IF;

      -- ---- etapa casada: vai para a posicao nova v_tj ----
      v_pred_j := v_tj;
      v_covered[v_tj + 1] := true;
      it_id := it_id || v_etapa.id;
      it_j := it_j || v_tj;
      it_key := it_key || ((v_tj + 1)::bigint * 1000000);
      it_status := it_status || v_etapa.status;

      CONTINUE WHEN v_etapa.status NOT IN ('pendente', 'ativo');
      CONTINUE WHEN v_old_e IS NULL OR jsonb_typeof(v_old_e) <> 'object';  -- sem valor antigo: tudo conta como customizado
      v_new_e := v_etapas -> v_tj;

      -- antigo, com guardas (nunca cast cru no lado armazenado)
      o_nome := public.trim_etapa_nome(v_old_e ->> 'nome');
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

      IF n_nome IS DISTINCT FROM o_nome
         AND public.trim_etapa_nome(v_etapa.nome) IS NOT DISTINCT FROM o_nome THEN
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
          v_updated := v_updated || v_etapa.id;
          v_wf_changes := v_wf_changes || v_changes;
        END IF;
      END IF;
    END LOOP;

    -- posicoes novas sem linha no fluxo
    FOR v_tj IN 0..v_n_new - 1 LOOP
      CONTINUE WHEN v_covered[v_tj + 1];
      it_id := it_id || NULL::bigint;
      it_j := it_j || v_tj;
      it_key := it_key || ((v_tj + 1)::bigint * 1000000);
      it_status := it_status || NULL::text;
    END LOOP;

    -- ---------- escada final: ordem 0..n-1 ----------
    SELECT min(pos) INTO v_active_pos
    FROM (SELECT s, row_number() OVER (ORDER BY k) - 1 AS pos
          FROM unnest(it_key, it_status) AS u(k, s)) q
    WHERE s = 'ativo';

    v_new_atual := NULL;
    FOR v_item IN
      SELECT u.id, u.j, (row_number() OVER (ORDER BY u.k) - 1)::int AS pos
      FROM unnest(it_id, it_j, it_key) AS u(id, j, k)
      ORDER BY u.k
    LOOP
      IF v_item.id IS NULL THEN
        v_new_e := v_etapas -> v_item.j;
        INSERT INTO workflow_etapas
          (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id,
           tipo, status, iniciado_em, concluido_em, data_limite)
        VALUES
          (v_wf.id, v_item.pos, v_new_e ->> 'nome', (v_new_e ->> 'prazo_dias')::integer,
           coalesce(v_new_e ->> 'tipo_prazo', 'corridos'),
           NULLIF(v_new_e ->> 'responsavel_id', '')::bigint,
           coalesce(v_new_e ->> 'tipo', 'padrao'),
           CASE WHEN v_item.pos < v_active_pos THEN 'concluido' ELSE 'pendente' END,
           NULL, NULL, NULL)
        RETURNING id INTO v_new_id;
        v_inserted := v_inserted + 1;
        v_wf_changes := v_wf_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_new_id, 'ordem', v_item.pos, 'campo', 'criada',
          'de', NULL,
          'para', jsonb_build_object(
            'nome', v_new_e ->> 'nome',
            'status', CASE WHEN v_item.pos < v_active_pos THEN 'concluido' ELSE 'pendente' END)));
      ELSE
        SELECT ordem INTO v_rows FROM workflow_etapas WHERE id = v_item.id;
        IF v_rows IS DISTINCT FROM v_item.pos THEN
          UPDATE workflow_etapas SET ordem = v_item.pos WHERE id = v_item.id;
          IF NOT v_item.id = ANY (v_updated) THEN
            v_updated := v_updated || v_item.id;
          END IF;
          v_wf_changes := v_wf_changes || jsonb_build_array(jsonb_build_object(
            'etapa_id', v_item.id, 'ordem', v_rows, 'campo', 'ordem',
            'de', v_rows, 'para', v_item.pos));
        END IF;
      END IF;
    END LOOP;

    -- etapa_atual acompanha a ativa (o board e o avanco leem por ela)
    IF v_active_pos IS NOT NULL THEN
      UPDATE workflows SET etapa_atual = v_active_pos
      WHERE id = v_wf.id AND etapa_atual IS DISTINCT FROM v_active_pos
      RETURNING etapa_atual INTO v_new_atual;
      IF v_new_atual IS NOT NULL THEN
        v_wf_changes := v_wf_changes || jsonb_build_array(jsonb_build_object(
          'campo', 'etapa_atual', 'para', v_new_atual));
      END IF;
    END IF;

    -- Transacional de proposito (sem EXCEPTION): este evento e o registro de undo.
    IF jsonb_array_length(v_wf_changes) > 0 THEN
      PERFORM record_workflow_event(
        v_wf.id, v_conta, 'template_propagado', NULL, NULL,
        jsonb_build_object(
          'template_id', p_template_id,
          'template_nome', v_nome,
          'etapas_atualizadas', coalesce(array_length(v_updated, 1), 0),
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
