-- Acesso por cliente (k): fecha a listagem dos buckets públicos.
--
-- avatars, post-media e tiktok-posts são buckets públicos: o arquivo é servido pela URL
-- pública (/storage/v1/object/public/...), que não passa pela RLS. As policies de SELECT
-- com `bucket_id = '<bucket>'` para o papel `public` não serviam a essa leitura; só
-- deixavam qualquer um (anon incluso) listar os nomes de todos os workspaces pela API
-- (storage.list / POST /object/list) e baixar pela rota autenticada.
--
-- Depois desta migration:
--   * tiktok-posts: sem SELECT para ninguém além do service_role (só o cache de capas do
--     tiktok-integration grava ali, com service role; a leitura é sempre pela URL pública).
--   * post-media: bucket legado (a mídia de post vive no R2). SELECT só do próprio
--     workspace, para quem está logado, no mesmo recorte das policies de upload e delete.
--   * avatars: SELECT só para quem está logado e só nos caminhos que ele pode gravar
--     (o upsert do logo e do splash do relatório precisa de SELECT no próprio objeto).
--     O caminho de cliente passa pela RLS de `clientes`, então um membro restrito só vê
--     as fotos dos clientes atribuídos.
-- URLs públicas já salvas (logo, foto de cliente, foto de pessoa, capa do TikTok) seguem
-- funcionando: nada aqui muda `storage.buckets.public`.

BEGIN;

DROP POLICY IF EXISTS tiktok_posts_public_read ON storage.objects;

DROP POLICY IF EXISTS post_media_read ON storage.objects;
CREATE POLICY post_media_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'post-media'
    AND (storage.foldername(name))[1] = (SELECT get_my_conta_id())::text
  );

DROP POLICY IF EXISTS avatars_public_read ON storage.objects;
CREATE POLICY avatars_member_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND CASE (storage.foldername(name))[1]
      WHEN 'workspaces' THEN
        (storage.foldername(name))[2] IN (
          SELECT wm.workspace_id::text FROM workspace_members wm WHERE wm.user_id = auth.uid()
        )
      WHEN 'clientes' THEN
        (storage.foldername(name))[2] ~ '^[0-9]{1,18}$'
        AND ((storage.foldername(name))[2])::bigint IN (SELECT c.id FROM clientes c)
      WHEN 'membros' THEN
        (storage.foldername(name))[2] ~ '^[0-9]{1,18}$'
        AND ((storage.foldername(name))[2])::bigint IN (
          SELECT m.id FROM membros m WHERE m.conta_id = (SELECT get_my_conta_id())
        )
      WHEN 'profiles' THEN
        (storage.foldername(name))[2] = (SELECT auth.uid())::text
      ELSE false
    END
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('SELECT', 'ALL')
      AND (roles @> ARRAY['public']::name[] OR roles @> ARRAY['anon']::name[])
      AND qual ~ 'bucket_id = ''(avatars|post-media|tiktok-posts)''::text'
  ) THEN
    RAISE EXCEPTION 'storage: ainda há SELECT público em avatars, post-media ou tiktok-posts';
  END IF;
END $$;

COMMIT;
