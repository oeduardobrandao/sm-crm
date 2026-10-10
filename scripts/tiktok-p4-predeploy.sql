-- P4 pré-deploy (TikTok publish state em post_targets): relatório SOMENTE LEITURA.
-- Rodar em prod e em staging ANTES de aplicar 20261013000001..3:
--   npx supabase link --project-ref <ref> < /dev/null
--   npx supabase db query --linked --file scripts/tiktok-p4-predeploy.sql
-- (só a última statement volta: o relatório inteiro é um SELECT).
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 9).
--
-- O que bloqueia a migration (o DO de paridade aborta):
--   * tiktok_targets_on_stories não vazio -> remediação abaixo, com OK do owner;
--   * tiktok_both_without_one_target / tiktok_target_on_other_post não vazios -> drift de P1,
--     investigar antes (não há remediação automática).
-- O que precisa de ação antes do passo 2 do deploy:
--   * in_flight_posts não vazio -> terminar (aguardar o cron) ou limpar antes.
--   * instagram_post_without_target / instagram_target_on_other_post não vazios -> drift de
--     P1 no lado Instagram. Não derruba a migration (o recompute conta o Instagram pelo
--     platform legado OU pela linha de destino), mas investigar antes: o P5 vai ler só a linha.
-- Informativo: legacy_status_counts, duplicate_publish_ids (esperado vazio),
--   failed_outside_publication (viram pendente pela regra de reset do backfill).
--   failed_retry_blocked_by_schedule: falhas pré-P4 (tiktok_publish_status = 'failed') de posts em
--     agendado/falha_publicacao cujo scheduled_at é NULL ou futuro. Depois do P4 a fase retry do
--     cron reenfileira o destino (agendado), mas o claim de init exige scheduled_at <= now():
--     essas linhas só voltam a publicar quando o post for reagendado (ou reenviado à mão).
--     Decidir caso a caso antes do deploy.
SELECT jsonb_pretty(jsonb_build_object(
  'legacy_status_counts', (
    SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
      SELECT COALESCE(tiktok_publish_status, 'NULL') AS k, count(*) AS n
        FROM public.workflow_posts
       WHERE platform IN ('tiktok','both')
       GROUP BY 1) s),
  'in_flight_posts', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'post_id', id, 'status', status, 'tiktok_publish_status', tiktok_publish_status,
             'tiktok_publish_processing_at', tiktok_publish_processing_at) ORDER BY id), '[]'::jsonb)
      FROM public.workflow_posts
     WHERE tiktok_publish_status IN ('initiated','processing')),
  'duplicate_publish_ids', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('tiktok_publish_id', tiktok_publish_id, 'post_ids', ids)), '[]'::jsonb)
      FROM (SELECT tiktok_publish_id, array_agg(id ORDER BY id) AS ids
              FROM public.workflow_posts
             WHERE tiktok_publish_id IS NOT NULL
             GROUP BY 1 HAVING count(*) > 1) d),
  'tiktok_targets_on_stories', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'post_id', t.post_id, 'target_status', t.status, 'post_status', wp.status,
             'platform', wp.platform, 'tiktok_publish_status', wp.tiktok_publish_status) ORDER BY t.post_id), '[]'::jsonb)
      FROM public.post_targets t
      JOIN public.workflow_posts wp ON wp.id = t.post_id
     WHERE t.platform = 'tiktok' AND wp.tipo = 'stories'),
  'tiktok_both_without_one_target', (
    SELECT COALESCE(jsonb_agg(wp.id ORDER BY wp.id), '[]'::jsonb)
      FROM public.workflow_posts wp
     WHERE wp.platform IN ('tiktok','both')
       AND (SELECT count(*) FROM public.post_targets t
             WHERE t.post_id = wp.id AND t.platform = 'tiktok') <> 1),
  'tiktok_target_on_other_post', (
    SELECT COALESCE(jsonb_agg(t.post_id ORDER BY t.post_id), '[]'::jsonb)
      FROM public.post_targets t
      JOIN public.workflow_posts wp ON wp.id = t.post_id
     WHERE t.platform = 'tiktok' AND wp.platform NOT IN ('tiktok','both')),
  'instagram_post_without_target', (
    SELECT COALESCE(jsonb_agg(wp.id ORDER BY wp.id), '[]'::jsonb)
      FROM public.workflow_posts wp
     WHERE wp.platform IN ('instagram','both')
       AND NOT EXISTS (SELECT 1 FROM public.post_targets t
                        WHERE t.post_id = wp.id AND t.platform = 'instagram')),
  'instagram_target_on_other_post', (
    SELECT COALESCE(jsonb_agg(t.post_id ORDER BY t.post_id), '[]'::jsonb)
      FROM public.post_targets t
      JOIN public.workflow_posts wp ON wp.id = t.post_id
     WHERE t.platform = 'instagram' AND wp.platform NOT IN ('instagram','both')),
  'legacy_state_without_target', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'post_id', wp.id, 'platform', wp.platform, 'tiktok_publish_status', wp.tiktok_publish_status) ORDER BY wp.id), '[]'::jsonb)
      FROM public.workflow_posts wp
     WHERE wp.tiktok_publish_status IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.post_targets t
                        WHERE t.post_id = wp.id AND t.platform = 'tiktok')),
  'failed_outside_publication', (
    SELECT count(*)
      FROM public.workflow_posts
     WHERE platform IN ('tiktok','both')
       AND tiktok_publish_status = 'failed'
       AND status NOT IN ('agendado','falha_publicacao','postado')),
  'failed_retry_blocked_by_schedule', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'post_id', wp.id, 'post_status', wp.status, 'scheduled_at', wp.scheduled_at,
             'tiktok_publish_retry_count', wp.tiktok_publish_retry_count) ORDER BY wp.id), '[]'::jsonb)
      FROM public.workflow_posts wp
     WHERE wp.platform IN ('tiktok','both')
       AND wp.tiktok_publish_status = 'failed'
       AND wp.status IN ('agendado','falha_publicacao')
       AND (wp.scheduled_at IS NULL OR wp.scheduled_at > now())
       AND EXISTS (SELECT 1 FROM public.post_targets t
                    WHERE t.post_id = wp.id AND t.platform = 'tiktok'))
)) AS report;

-- REMEDIAÇÃO (só com OK explícito do owner, e só se tiktok_targets_on_stories vier não
-- vazio). Tira o destino TikTok PENDENTE de posts stories (P1 semeou sem filtrar tipo,
-- 20261010100002:110-115). post_targets_sync_platform recalcula o platform do post.
-- Um destino que não esteja pendente aparece no relatório e exige decisão caso a caso.
-- Rodar como arquivo separado, ANTES de aplicar as migrations:
--
-- DELETE FROM public.post_targets t
--  USING public.workflow_posts wp
--  WHERE wp.id = t.post_id AND t.platform = 'tiktok' AND wp.tipo = 'stories'
--    AND t.status = 'pendente'
-- RETURNING t.post_id;
