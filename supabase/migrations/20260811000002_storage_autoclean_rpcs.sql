-- =====================================================================
-- 20260811000002_storage_autoclean_rpcs.sql
-- Auto-limpeza de armazenamento: predicado compartilhado + preview + executor.
-- Spec: docs/superpowers/specs/2026-08-10-storage-autoclean-design.md
-- =====================================================================

-- ---------- Predicado compartilhado ---------------------------------------
-- Usado pela preview E pelo executor: o conjunto que a UI estima é exatamente
-- o conjunto que o cron apaga.
--
-- Um arquivo qualifica sse:
--   * pertence ao workspace;
--   * tem >= 1 post_file_links (arquivos só do Arquivos e documentos ficam
--     estruturalmente de fora);
--   * NENHUM link desqualifica: link ou post de outro tenant (post_file_links
--     não tem FK composta de tenant, então um link malformado cross-workspace
--     é possível e torna o arquivo INELEGÍVEL -- fail-safe), status <>
--     'postado', ou published_at NULL ou depois do cutoff. Arquivo ligado a
--     vários posts só sai quando TODOS qualificam. Conta linhas de link reais,
--     nunca reference_count (inflado em linhas antigas pelo DROP CASCADE do
--     Estúdio, 20260722000002);
--   * não é referenciado por ideia_files;
--   * não é logo de marca (hub_brand.logo_file_id é ON DELETE SET NULL: o
--     DELETE não falharia, o logo do Hub sumiria em silêncio).
--
-- published_at, sem fallback para scheduled_at: 'postado' garante
-- published_at não-nulo por todos os caminhos de escrita -- trigger
-- 20260601000001 (INSERT e UPDATE) e o clamp do data-import (20260729000004:
-- "published_at is non-null only when v_status = 'postado'"; postado sem data
-- degrada para rascunho, com data futura degrada para aprovado_cliente). O
-- IS NULL aqui é só cinto-e-suspensórios para linhas legadas corrompidas:
-- nunca qualificam.
--
-- story_segments (jsonb) não é varrido de propósito: segmentos derivam dos
-- post_file_links do próprio post (20260625000001), então todo arquivo
-- referenciado por segmento tem linha de link nesse mesmo post; depois da
-- publicação nada re-dereferencia os file_id dos segmentos.
--
-- 'postado' é status de máquina (custom statuses nunca o assumem,
-- 20260805000001) e posts em agendado/processamento falham o filtro de status,
-- então a validação pré-publicação ("post precisa de >= 1 mídia") nunca é
-- minada por esta limpeza.
CREATE OR REPLACE FUNCTION storage_autoclean_candidates(p_workspace uuid, p_cutoff timestamptz)
RETURNS TABLE(file_id bigint, size_bytes bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT f.id, f.size_bytes
    FROM files f
   WHERE f.conta_id = p_workspace
     AND EXISTS (
       SELECT 1 FROM post_file_links pfl WHERE pfl.file_id = f.id)
     AND NOT EXISTS (
       SELECT 1
         FROM post_file_links pfl
         JOIN workflow_posts wp ON wp.id = pfl.post_id
        WHERE pfl.file_id = f.id
          AND (pfl.conta_id <> p_workspace
               OR wp.conta_id <> p_workspace
               OR wp.status <> 'postado'
               OR wp.published_at IS NULL
               OR wp.published_at > p_cutoff))
     AND NOT EXISTS (
       SELECT 1 FROM ideia_files idf WHERE idf.file_id = f.id)
     AND NOT EXISTS (
       SELECT 1 FROM hub_brand hb WHERE hb.logo_file_id = f.id)
$$;

-- SECURITY: default privileges hand EXECUTE on new public functions to
-- anon/authenticated/service_role -- lock all three functions down explicitly
-- (same rationale as workspace_usage, 20260808000001). NOTE: revoking PUBLIC
-- also strips service_role; the GRANTs below restore it.
REVOKE ALL ON FUNCTION storage_autoclean_candidates(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION storage_autoclean_candidates(uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION storage_autoclean_candidates(uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION storage_autoclean_candidates(uuid, timestamptz) TO service_role;

-- ---------- Preview (UI de configurações) ---------------------------------
-- Mesmo shape de segurança do workspace_usage (20260808000001): definer +
-- get_my_conta_id() + recheck de membership contra ponteiro stale.
-- p_delay_days permite o "e se" ao vivo enquanto o owner troca o prazo no
-- formulário, antes de salvar.
CREATE OR REPLACE FUNCTION public.storage_autoclean_preview(p_delay_days int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws    uuid := public.get_my_conta_id();
  v_delay int;
  v_count bigint;
  v_bytes bigint;
BEGIN
  IF v_ws IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM workspace_members
     WHERE workspace_id = v_ws AND user_id = auth.uid()
  ) THEN
    RETURN '{}'::jsonb;
  END IF;

  IF p_delay_days IS NOT NULL AND (p_delay_days < 0 OR p_delay_days > 365) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT COALESCE(p_delay_days, w.storage_autoclean_delay_days, 30)
    INTO v_delay
    FROM workspaces w WHERE w.id = v_ws;

  SELECT count(*), COALESCE(sum(c.size_bytes), 0)
    INTO v_count, v_bytes
    FROM storage_autoclean_candidates(v_ws, now() - make_interval(days => v_delay)) c;

  RETURN jsonb_build_object('files_count', v_count, 'bytes_total', v_bytes);
END;
$$;

REVOKE ALL ON FUNCTION public.storage_autoclean_preview(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_autoclean_preview(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.storage_autoclean_preview(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_autoclean_preview(int) TO service_role;

-- ---------- Executor (chamado pelo storage-autoclean-cron) ----------------
-- Uma transação por workspace: lock, checagem de política/limiar, batch
-- determinístico, carimbo dos posts, DELETE links -> DELETE files (FK
-- RESTRICT), contabilidade + trilha. Os triggers de files cuidam do resto:
-- trg_file_enqueue_delete (fila R2) e trg_file_used_bytes_del (decremento de
-- storage_used_bytes). NUNCA criar/chamar um RPC "decrement_storage" por cima
-- (o file-manage chama um inexistente com .catch(()=>{}); criar a função
-- causaria decremento duplo).
CREATE OR REPLACE FUNCTION public.storage_autoclean_run(p_workspace uuid, p_max_files int DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled   boolean;
  v_delay     int;
  v_threshold int;
  v_used      bigint;
  v_quota     bigint;
  v_file_ids  bigint[];
  v_files     int    := 0;
  v_bytes     bigint := 0;
  v_posts     int    := 0;
BEGIN
  -- FOR UPDATE serializa execuções concorrentes no mesmo workspace.
  SELECT w.storage_autoclean_enabled, w.storage_autoclean_delay_days,
         w.storage_autoclean_threshold_pct, COALESCE(w.storage_used_bytes, 0)
    INTO v_enabled, v_delay, v_threshold, v_used
    FROM workspaces w
   WHERE w.id = p_workspace
     FOR UPDATE;

  IF NOT FOUND OR NOT v_enabled THEN
    RETURN jsonb_build_object('skipped', 'disabled');
  END IF;

  IF v_threshold IS NOT NULL THEN
    v_quota := effective_plan_limit(p_workspace, 'storage_quota_bytes');
    IF v_quota IS NULL THEN
      -- Cota ilimitada: percentual indefinido. Fail-safe: nunca apagar.
      RETURN jsonb_build_object('skipped', 'no_quota');
    -- Não-estrito de propósito: a UI promete "somente quando o uso PASSAR DE
    -- X%", então uso exatamente igual ao limiar ainda pula.
    ELSIF v_quota > 0 AND v_used * 100 <= v_threshold::bigint * v_quota THEN
      RETURN jsonb_build_object('skipped', 'below_threshold');
    END IF;
    -- v_quota = 0 (bloqueado): qualquer uso excede o limiar; segue.
  END IF;

  -- Batch determinístico: sobras ficam para a próxima noite (limita o tempo
  -- da transação; a fila de R2 processa 500/dia de qualquer forma).
  SELECT array_agg(t.file_id)
    INTO v_file_ids
    FROM (SELECT c.file_id
            FROM storage_autoclean_candidates(
                   p_workspace, now() - make_interval(days => v_delay)) c
           ORDER BY c.file_id
           LIMIT p_max_files) t;

  IF v_file_ids IS NOT NULL THEN
    -- Anti-corrida em DUAS camadas. Um vínculo criado entre a seleção acima e
    -- os DELETEs abaixo (usuário anexando um arquivo antigo a um rascunho
    -- durante a janela do cron) NÃO pode ser varrido junto.
    --
    -- 1) Lock dos candidatos. Todo INSERT em post_file_links/ideia_files toma
    --    FOR KEY SHARE na linha de files referenciada (RI da FK), que conflita
    --    com FOR UPDATE: com os locks abaixo, qualquer novo vínculo BLOQUEIA
    --    até esta transação terminar (e então falha na FK, pois o arquivo já
    --    saiu -- erro visível para o usuário, nunca perda silenciosa).
    --    ORDER BY id: mesma ordem em execuções concorrentes, minimiza deadlock.
    PERFORM 1 FROM (
      SELECT f.id
        FROM files f
       WHERE f.id = ANY (v_file_ids)
         AND f.conta_id = p_workspace
       ORDER BY f.id
         FOR UPDATE
    ) locked;

    -- 2) Reavaliação SOB os locks, com o mesmo predicado compartilhado: um
    --    vínculo que commitou enquanto esperávamos o lock aparece agora e tira
    --    o arquivo do lote. Sem isso, o DELETE de links (snapshot novo em READ
    --    COMMITTED) apagaria também o vínculo recém-criado e o arquivo sairia
    --    "legitimamente" -- a perda silenciosa exata que se quer impedir.
    SELECT array_agg(t.file_id), COALESCE(sum(t.size_bytes), 0)
      INTO v_file_ids, v_bytes
      FROM (SELECT c.file_id, c.size_bytes
              FROM storage_autoclean_candidates(
                     p_workspace, now() - make_interval(days => v_delay)) c
             WHERE c.file_id = ANY (v_file_ids)) t;
  END IF;

  IF v_file_ids IS NOT NULL THEN
    -- Carimbo ANTES de apagar os links (depois deles não dá mais para saber
    -- quais posts perderam mídia).
    UPDATE workflow_posts wp
       SET media_autocleaned_at = now()
     WHERE wp.conta_id = p_workspace
       AND EXISTS (
         SELECT 1 FROM post_file_links pfl
          WHERE pfl.post_id = wp.id AND pfl.file_id = ANY (v_file_ids));
    GET DIAGNOSTICS v_posts = ROW_COUNT;

    -- Ordem obrigatória: a FK post_file_links.file_id é ON DELETE RESTRICT.
    -- Escopo de tenant é cinto-e-suspensórios (o predicado já desqualifica
    -- links malformados). O trigger de reatribuição de capa dispara por link
    -- apagado; inofensivo quando todos saem.
    DELETE FROM post_file_links
     WHERE file_id = ANY (v_file_ids)
       AND conta_id = p_workspace;

    -- Com os locks da etapa 1, nenhum vínculo novo pode ter aparecido; o
    -- NOT EXISTS é a última rede de segurança (pular o arquivo em vez de
    -- estourar a FK e abortar a noite inteira). Contabiliza só o apagado.
    WITH deleted AS (
      DELETE FROM files f
       WHERE f.id = ANY (v_file_ids)
         AND f.conta_id = p_workspace
         AND NOT EXISTS (
           SELECT 1 FROM post_file_links pfl WHERE pfl.file_id = f.id)
       RETURNING f.size_bytes
    )
    SELECT count(*), COALESCE(sum(d.size_bytes), 0)
      INTO v_files, v_bytes
      FROM deleted d;
  END IF;

  UPDATE workspaces
     SET storage_autoclean_last_run_at = now(),
         storage_autoclean_last_files  = v_files,
         storage_autoclean_last_bytes  = v_bytes
   WHERE id = p_workspace;

  IF v_files > 0 THEN
    INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, metadata)
    VALUES (p_workspace, NULL, 'storage_autoclean', 'files',
            jsonb_build_object(
              'files_count',   v_files,
              'bytes_freed',   v_bytes,
              'posts_stamped', v_posts,
              'delay_days',    v_delay));

    PERFORM insert_notification_batch(
      p_workspace,
      resolve_notification_targets(p_workspace, NULL, ARRAY['owner','admin']),
      'storage_autoclean_report',
      '/configuracao/armazenamento',
      jsonb_build_object('files_count', v_files, 'bytes_freed', v_bytes),
      NULL);
  END IF;

  RETURN jsonb_build_object(
    'files_deleted', v_files,
    'bytes_freed',   v_bytes,
    'posts_stamped', v_posts);
END;
$$;

REVOKE ALL ON FUNCTION public.storage_autoclean_run(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_autoclean_run(uuid, int) FROM anon;
REVOKE ALL ON FUNCTION public.storage_autoclean_run(uuid, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.storage_autoclean_run(uuid, int) TO service_role;
