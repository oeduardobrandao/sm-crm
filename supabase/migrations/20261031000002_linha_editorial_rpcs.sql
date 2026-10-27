-- Linha editorial: CRM RPCs (spec docs/superpowers/specs/2026-10-26-linha-editorial-design.md,
-- sections 5.1 and 7). SECURITY DEFINER, search_path = public, EXECUTE for authenticated.
--
-- Every RPC resolves the caller's conta with get_my_conta_id() and checks
-- feature_linha_editorial FIRST (feature_disabled:feature_linha_editorial, which
-- mapEntitlementError names), then scopes every lookup by that conta: a row of another conta
-- is nao_encontrada, never "forbidden". Errors are P0001 with these bare messages:
-- feature_disabled:feature_linha_editorial, nao_encontrada, status_invalido, linha_vazia,
-- periodo_invalido, payload_invalido, ja_convertido, workflow_invalido, propriedade_invalida.
-- Plan limits on the converted posts surface unchanged as plan_limit_exceeded:* from
-- trg_limit_posts / trg_limit_posts_avulsos, and roll the whole batch back.

SET LOCAL lock_timeout = '5s';

-- ============ (0) created_via ============
-- Posts made by the converter are tagged 'linha_editorial'. The inline CHECK of
-- 20260624000001 is auto-named workflow_posts_created_via_check. NOT VALID + VALIDATE keeps
-- the ACCESS EXCLUSIVE lock short (validation runs under SHARE UPDATE EXCLUSIVE).
ALTER TABLE public.workflow_posts DROP CONSTRAINT workflow_posts_created_via_check;
ALTER TABLE public.workflow_posts ADD CONSTRAINT workflow_posts_created_via_check
  CHECK (created_via IN ('human', 'agent', 'linha_editorial')) NOT VALID;
ALTER TABLE public.workflow_posts VALIDATE CONSTRAINT workflow_posts_created_via_check;

-- ============ (1) linha_editorial_criar ============
-- Idempotent per (conta, cliente, month): returns the existing linha when there is one. Seeds
-- Pilar, CTA and Referência the first time the conta has no columns at all.
CREATE OR REPLACE FUNCTION public.linha_editorial_criar(p_cliente_id bigint, p_periodo date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta   uuid := public.get_my_conta_id();
  v_periodo date;
  v_id      uuid;
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;
  IF p_periodo IS NULL THEN
    RAISE EXCEPTION 'periodo_invalido' USING ERRCODE = 'P0001';
  END IF;
  v_periodo := date_trunc('month', p_periodo)::date;

  IF NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = p_cliente_id AND c.conta_id = v_conta) THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.linhas_editoriais (conta_id, cliente_id, periodo, created_by)
  VALUES (v_conta, p_cliente_id, v_periodo, auth.uid())
  ON CONFLICT (conta_id, cliente_id, periodo) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT l.id INTO v_id FROM public.linhas_editoriais l
     WHERE l.conta_id = v_conta AND l.cliente_id = p_cliente_id AND l.periodo = v_periodo;
  END IF;

  -- ON CONFLICT on the normalized-name index makes two concurrent first calls seed once.
  IF NOT EXISTS (SELECT 1 FROM public.linha_editorial_colunas WHERE conta_id = v_conta) THEN
    INSERT INTO public.linha_editorial_colunas (conta_id, nome, tipo, config, ordem)
    VALUES
      (v_conta, 'Pilar', 'select', jsonb_build_object('options', jsonb_build_array(
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Educação',   'color', '#3b82f6'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Autoridade', 'color', '#8b5cf6'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Bastidores', 'color', '#f59e0b'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Conexão',    'color', '#ec4899'))), 0),
      (v_conta, 'CTA', 'select', jsonb_build_object('options', jsonb_build_array(
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Salvar',       'color', '#22c55e'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Comentar',     'color', '#06b6d4'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Compartilhar', 'color', '#f97316'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Seguir',       'color', '#94a3b8'))), 1),
      (v_conta, 'Referência', 'url', '{}'::jsonb, 2)
    ON CONFLICT (conta_id, public.linha_nome_norm(nome)) DO NOTHING;
  END IF;

  RETURN v_id;
END;
$$;

-- ============ (2) linha_editorial_enviar ============
-- rascunho | ajustes | aprovada -> enviada, rodada + 1. "Enviar de novo" from aprovada is how
-- the agency asks for a fresh approval.
CREATE OR REPLACE FUNCTION public.linha_editorial_enviar(p_linha_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_status text;
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.status INTO v_status FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = v_conta
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status NOT IN ('rascunho', 'ajustes', 'aprovada') THEN
    RAISE EXCEPTION 'status_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linha_editorial_itens i WHERE i.linha_id = p_linha_id) THEN
    RAISE EXCEPTION 'linha_vazia' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.linhas_editoriais
     SET status = 'enviada', enviada_at = now(), enviada_por = auth.uid(), rodada = rodada + 1
   WHERE id = p_linha_id;
END;
$$;

-- ============ (3) linha_editorial_recolher ============
-- enviada -> rascunho: the team pulls the linha back before the client decides.
CREATE OR REPLACE FUNCTION public.linha_editorial_recolher(p_linha_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_status text;
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.status INTO v_status FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = v_conta
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'enviada' THEN
    RAISE EXCEPTION 'status_invalido' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.linhas_editoriais SET status = 'rascunho' WHERE id = p_linha_id;
END;
$$;

-- ============ (4) linha_editorial_coluna_excluir ============
-- Deletes the column and strips its key from the valores of UNCONVERTED items of the conta.
-- Converted items are frozen (linha_item_guard) and keep the orphan key; readers ignore keys
-- with no matching column.
CREATE OR REPLACE FUNCTION public.linha_editorial_coluna_excluir(p_coluna_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.linha_editorial_colunas c WHERE c.id = p_coluna_id AND c.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.linha_editorial_itens i
     SET valores = i.valores - p_coluna_id::text
   WHERE i.conta_id = v_conta
     AND i.post_id IS NULL
     AND i.valores ? p_coluna_id::text;
END;
$$;

-- ============ (5) linha_editorial_converter ============
-- p_posts: [{item_id uuid, conteudo jsonb, conteudo_plain text,
--            property_values: [{property_definition_id bigint, value jsonb}]}]
-- built client-side by buildPostsFromItens. Everything else comes from the locked item:
-- titulo, tipo and scheduled_at = (data + 10:00) AT TIME ZONE 'America/Sao_Paulo'. platform
-- is never written, so the insert triggers seed the targets from the board. One post per
-- item, all or nothing: a plan limit tripping mid-batch rolls every post back.
-- Returns [{item_id, post_id}] in creation order.
CREATE OR REPLACE FUNCTION public.linha_editorial_converter(p_linha_id uuid, p_workflow_id bigint, p_posts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta    uuid := public.get_my_conta_id();
  v_user     uuid := auth.uid();
  v_cliente  bigint;
  v_wf_cli   bigint;
  v_wf_conta uuid;
  v_template bigint;
  v_base     integer := 0;
  v_ids      uuid[];
  v_n        integer;
  v_locked   integer;
  v_post     bigint;
  v_out      jsonb := '[]'::jsonb;
  r          record;
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.cliente_id INTO v_cliente FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = v_conta
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;

  -- Payload shape: a non-empty array of objects, each with a distinct uuid item_id, an object
  -- or null conteudo and an array or null property_values.
  IF p_posts IS NULL OR jsonb_typeof(p_posts) <> 'array' OR jsonb_array_length(p_posts) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_posts) e
                 WHERE jsonb_typeof(e) <> 'object'
                    OR coalesce(e->>'item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    OR coalesce(jsonb_typeof(e->'conteudo'), 'null') NOT IN ('object', 'null')
                    OR coalesce(jsonb_typeof(e->'property_values'), 'null') NOT IN ('array', 'null')) THEN
    RAISE EXCEPTION 'payload_invalido' USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(DISTINCT (e->>'item_id')::uuid), count(*) INTO v_ids, v_n
    FROM jsonb_array_elements(p_posts) e;
  IF cardinality(v_ids) <> v_n
     OR (SELECT count(*) FROM public.linha_editorial_itens i
          WHERE i.linha_id = p_linha_id AND i.id = ANY (v_ids)) <> v_n THEN
    RAISE EXCEPTION 'payload_invalido' USING ERRCODE = 'P0001';
  END IF;

  -- Same conta and same client as the linha: for a fluxo, post_a0_sync_cliente takes the
  -- post's cliente_id from the workflow, so this check is what keeps the client right.
  IF p_workflow_id IS NOT NULL THEN
    SELECT w.cliente_id, w.conta_id, w.template_id INTO v_wf_cli, v_wf_conta, v_template
      FROM public.workflows w WHERE w.id = p_workflow_id
      FOR SHARE;
    IF NOT FOUND OR v_wf_conta IS DISTINCT FROM v_conta OR v_wf_cli IS DISTINCT FROM v_cliente THEN
      RAISE EXCEPTION 'workflow_invalido' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Every definition must belong to the workflow's template (avulso posts have none), and a
  -- post names each definition once.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_posts) e,
           jsonb_array_elements(coalesce(nullif(e->'property_values', 'null'::jsonb), '[]'::jsonb)) pv
     WHERE jsonb_typeof(pv) <> 'object'
        OR coalesce(pv->>'property_definition_id', '') !~ '^[0-9]{1,18}$'
        OR v_template IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.template_property_definitions d
                        WHERE d.id = (pv->>'property_definition_id')::bigint
                          AND d.template_id = v_template AND d.conta_id = v_conta))
     OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_posts) e,
           jsonb_array_elements(coalesce(nullif(e->'property_values', 'null'::jsonb), '[]'::jsonb)) pv
     GROUP BY e->>'item_id', pv->>'property_definition_id'
    HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'propriedade_invalida' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the items, then refuse any already converted. A row released by a post delete
  -- (post_id back to null) converts again. The membership count above ran before the lock,
  -- so count again under it: a row deleted in between must fail the whole batch.
  PERFORM 1 FROM public.linha_editorial_itens i
   WHERE i.linha_id = p_linha_id AND i.id = ANY (v_ids) ORDER BY i.id FOR UPDATE;
  GET DIAGNOSTICS v_locked = ROW_COUNT;
  IF v_locked <> v_n THEN
    RAISE EXCEPTION 'payload_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.linha_editorial_itens i WHERE i.id = ANY (v_ids) AND i.post_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ja_convertido' USING ERRCODE = 'P0001';
  END IF;

  IF p_workflow_id IS NOT NULL THEN
    -- After the last post of the fluxo; an empty fluxo starts at 0.
    SELECT coalesce(max(p.ordem), -1) INTO v_base FROM public.workflow_posts p WHERE p.workflow_id = p_workflow_id;
  END IF;

  FOR r IN
    SELECT i.id, i.titulo, i.tipo, i.data, e.elem,
           row_number() OVER (ORDER BY i.data NULLS LAST, i.ordem, i.created_at, i.id) AS rn
      FROM public.linha_editorial_itens i
      JOIN jsonb_array_elements(p_posts) AS e(elem) ON (e.elem->>'item_id')::uuid = i.id
     ORDER BY rn
  LOOP
    INSERT INTO public.workflow_posts
      (conta_id, workflow_id, cliente_id, titulo, tipo, status, ordem, scheduled_at,
       conteudo, conteudo_plain, created_via)
    VALUES
      (v_conta, p_workflow_id, v_cliente, r.titulo, r.tipo, 'rascunho',
       CASE WHEN p_workflow_id IS NULL THEN 0 ELSE v_base + r.rn::integer END,
       CASE WHEN r.data IS NULL THEN NULL ELSE (r.data + time '10:00') AT TIME ZONE 'America/Sao_Paulo' END,
       nullif(r.elem->'conteudo', 'null'::jsonb), coalesce(r.elem->>'conteudo_plain', ''), 'linha_editorial')
    RETURNING id INTO v_post;

    INSERT INTO public.post_property_values (post_id, property_definition_id, value)
    SELECT v_post, (pv->>'property_definition_id')::bigint, pv->'value'
      FROM jsonb_array_elements(coalesce(nullif(r.elem->'property_values', 'null'::jsonb), '[]'::jsonb)) pv;

    UPDATE public.linha_editorial_itens
       SET post_id = v_post, convertido_at = now(), convertido_por = v_user
     WHERE id = r.id;

    v_out := v_out || jsonb_build_array(jsonb_build_object('item_id', r.id, 'post_id', v_post));
  END LOOP;

  RETURN v_out;
END;
$$;

-- ============ (6) GRANTS ============
-- Hosted grants EXECUTE to anon on new functions; name every role (REVOKE FROM PUBLIC alone
-- leaves anon/authenticated/service_role grants in place).
REVOKE ALL ON FUNCTION public.linha_editorial_criar(bigint, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.linha_editorial_enviar(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.linha_editorial_recolher(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.linha_editorial_coluna_excluir(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.linha_editorial_converter(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linha_editorial_criar(bigint, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linha_editorial_enviar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linha_editorial_recolher(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linha_editorial_coluna_excluir(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linha_editorial_converter(uuid, bigint, jsonb) TO authenticated, service_role;
