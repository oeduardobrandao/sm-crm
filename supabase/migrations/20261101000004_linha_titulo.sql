-- Linha editorial: editable title (spec §14,
-- docs/superpowers/specs/2026-10-26-linha-editorial-design.md).
--
-- titulo is optional: null means the derived "Linha editorial de {mês}". The CRM renames a
-- linha with a plain PostgREST UPDATE under the existing linhas_editoriais_update policy
-- (conta + feature flag), so authenticated gets UPDATE on this one column only. One line, no
-- control characters: the title reaches e-mail subjects (team digest).
-- create_linha_notification (copied from 20261031000005) adds titulo to the metadata.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.linhas_editoriais
  ADD COLUMN titulo text NULL
  CONSTRAINT linhas_editoriais_titulo_check
    CHECK (titulo IS NULL OR (titulo = btrim(titulo) AND length(titulo) BETWEEN 1 AND 120
                              AND titulo !~ '[[:cntrl:]]'));

GRANT UPDATE (titulo) ON public.linhas_editoriais TO authenticated;

-- ============ create_linha_notification ============
-- Copied from 20261031000005 (5). Changed: metadata gains titulo.
CREATE OR REPLACE FUNCTION public.create_linha_notification(p_linha_id uuid, p_acao text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type    text;
  v_l       public.linhas_editoriais;
  v_nome    text;
  v_targets uuid[];
  v_total   integer;
  v_ajustes integer;
BEGIN
  v_type := CASE p_acao
    WHEN 'aprovado' THEN 'linha_editorial_aprovada'
    WHEN 'ajustes'  THEN 'linha_editorial_ajustes'
    ELSE NULL
  END;
  IF v_type IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_l FROM public.linhas_editoriais WHERE id = p_linha_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT c.nome INTO v_nome FROM public.clientes c WHERE c.id = v_l.cliente_id;

  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_targets
    FROM (
      SELECT unnest(public.resolve_notification_targets(v_l.conta_id, NULL, ARRAY['owner', 'admin'])) AS u
      UNION
      SELECT wm.user_id FROM public.workspace_members wm
       WHERE wm.workspace_id = v_l.conta_id AND wm.user_id = v_l.enviada_por
    ) t
   WHERE u IS NOT NULL;

  SELECT count(*) INTO v_total FROM public.linha_editorial_respostas r
   WHERE r.linha_id = p_linha_id AND r.rodada = v_l.rodada
     AND NOT r.is_workspace_user AND nullif(btrim(r.comentario), '') IS NOT NULL;

  -- (new)
  SELECT count(*) INTO v_ajustes FROM public.linha_editorial_itens i
   WHERE i.linha_id = p_linha_id AND i.aprovacao = 'ajustes';

  PERFORM public.insert_notification_batch(
    v_l.conta_id,
    v_targets,
    v_type,
    '/entregas?view=linha&clientes=' || v_l.cliente_id || '&mes=' || to_char(v_l.periodo, 'YYYY-MM'),
    jsonb_build_object(
      'linha_id',      v_l.id,
      'cliente_id',    v_l.cliente_id,
      'cliente_nome',  v_nome,
      'periodo',       to_char(v_l.periodo, 'YYYY-MM-DD'),
      'comentarios',   v_total,
      'itens_ajustes', v_ajustes,
      'titulo',        v_l.titulo
    ),
    NULL
  );
END;
$$;

-- The column grant must not widen anything else: authenticated still has no table-level
-- UPDATE and no write on the state-machine columns (see the DO block in 20261031000001).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name = 'linhas_editoriais'
                AND grantee IN ('authenticated', 'anon', 'PUBLIC') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE'))
     OR EXISTS (SELECT 1 FROM information_schema.role_column_grants
                 WHERE table_schema = 'public' AND table_name = 'linhas_editoriais'
                   AND grantee IN ('anon', 'PUBLIC') AND privilege_type IN ('INSERT', 'UPDATE'))
     OR EXISTS (SELECT 1 FROM information_schema.role_column_grants
                 WHERE table_schema = 'public' AND table_name = 'linhas_editoriais' AND grantee = 'authenticated'
                   AND privilege_type = 'UPDATE' AND column_name NOT IN ('titulo', 'updated_at')) THEN
    RAISE EXCEPTION 'linhas_editoriais: unexpected write grant';
  END IF;
END
$$;
