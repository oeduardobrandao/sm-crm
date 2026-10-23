SET LOCAL lock_timeout = '5s';

-- Financeiro v2: private bucket for the signed contract of a team agreement
-- (spec docs/superpowers/specs/2026-10-23-financeiro-rentabilidade-design.md).
-- First private bucket in the repo: reads go through createSignedUrl, never a
-- public URL.
--
-- Object path: <conta_id>/<membro_id>/<uuid>.<ext>
--   * first segment must equal the caller's workspace, compared as TEXT so a
--     non-uuid prefix fails closed (a ::uuid cast would raise 22P02 instead);
--   * second segment must be a membros.id of that same workspace, so the bucket
--     cannot be written at arbitrary paths.
-- SELECT needs can_see_financials(); INSERT needs has_permission('financeiro',
-- 'editar'). Both sit behind feature_financial + feature_financeiro_v2, like the
-- v2 tables. There is NO UPDATE or DELETE policy on purpose: replacing a
-- contract uploads a new object, and an older acordo version keeps pointing at
-- its own arquivo_path. Object cleanup, if ever needed, runs as service_role.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'financeiro-acordos', 'financeiro-acordos', false, 10485760,
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg'];

DROP POLICY IF EXISTS "financeiro_acordos_select" ON storage.objects;
CREATE POLICY "financeiro_acordos_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'financeiro-acordos'
    AND (storage.foldername(name))[1] = (SELECT public.get_my_conta_id())::text
    AND EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id::text = (storage.foldername(name))[2]
        AND m.conta_id = (SELECT public.get_my_conta_id())
    )
    AND (SELECT public.effective_plan_feature((SELECT public.get_my_conta_id()), 'feature_financial'))
    AND (SELECT public.effective_plan_feature((SELECT public.get_my_conta_id()), 'feature_financeiro_v2'))
    AND (SELECT public.can_see_financials())
  );

DROP POLICY IF EXISTS "financeiro_acordos_insert" ON storage.objects;
CREATE POLICY "financeiro_acordos_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'financeiro-acordos'
    AND (storage.foldername(name))[1] = (SELECT public.get_my_conta_id())::text
    AND EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id::text = (storage.foldername(name))[2]
        AND m.conta_id = (SELECT public.get_my_conta_id())
    )
    AND (SELECT public.effective_plan_feature((SELECT public.get_my_conta_id()), 'feature_financial'))
    AND (SELECT public.effective_plan_feature((SELECT public.get_my_conta_id()), 'feature_financeiro_v2'))
    AND (SELECT public.has_permission('financeiro', 'editar'))
  );
