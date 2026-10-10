-- P4 reconcile (TikTok publish state em post_targets). Runbook da Task 9, passo 6 do plano:
-- rodar duas vezes (é idempotente): logo depois do db push verificado e de novo depois do
-- deploy das functions, em prod (e staging, por paridade):
--   npx supabase link --project-ref <ref> < /dev/null
--   npx supabase db query --linked --file <cópia editada deste arquivo>
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 9).
--
-- Reaplica o mapeamento do backfill SÓ onde as colunas congeladas ganharam estado que o
-- destino não tem, escrito por uma versão antiga de função entre a migration e o deploy:
--   * remapped: destino ainda pendente com tiktok_publish_status não nulo (publish-now antigo,
--     falha antiga do webhook, tiktok-publish/handler.ts:536-560 antes de P4);
--   * filled:   destino publicado sem external_id/permalink enquanto tiktok_post_id/url têm
--     valor (publicly_available do webhook antigo, tiktok-webhook/handler.ts:252-301).
-- Janela: só posts com workflow_posts.updated_at >= window_start (o instante anotado no
-- passo 2, antes de aplicar a migration). Sem ela, um 'failed' legado de um post re-agendado
-- depois voltaria como falha (bug 3), e um permalink limpo de propósito voltaria.
-- Idempotente: na segunda execução nada casa (remapped exige destino pendente; filled exige
-- campo nulo). Não move status de post: as versões antigas já moveram junto da escrita legada.
--
-- LIMITE CONHECIDO: só destino PENDENTE é remapeado. Um destino re-enfileirado (agendado)
-- que um publicar-agora ANTIGO derrubou dentro da janela (escreveu tiktok_publish_status =
-- 'failed' nas colunas congeladas) NÃO é remapeado: continua agendado e o cron novo o
-- publica de novo no próximo ciclo. É aceito porque o TikTok está escuro fora do DK TESTE e
-- o owner segura publicações entre os passos 2 e 5; se o relatório de antes mostrar uma
-- linha assim, decidir à mão.
--
-- CASO RESIDUAL: um 'processing'/'published' congelado (legado) de um post que o código NOVO
-- cancelou (cancel_target_publish -> pendente) e o usuário reagendou dentro da janela ainda
-- seria remapeado (processando/publicado). O guard de 'falha' abaixo só cobre o 'failed'.
-- REGRA OPERACIONAL: entre o `db push` e a execução deste script, NÃO publicar, cancelar,
-- mover nem reagendar posts TikTok. O owner segura isso nos passos 2 a 5 do runbook.
--
-- GUARDS DO REMAP:
--   * mapeado para 'falha' exige wp.status = 'falha_publicacao': o caminho legado de falha
--     (markTikTokPublishFailed e o cron) sempre move o post para falha_publicacao. Um post
--     reagendado (agendado) com 'failed' congelado NÃO volta como falha (bug 3: ficaria
--     agendado com destino em falha que o claim init nunca pega).
--   * destino com processing_at fresco (< 10 min) é pulado: begin_target_publish e o claim init
--     carimbam processing_at num destino ainda pendente, e o remap não pode apagar essa trava.
--
-- SEM FOR UPDATE em workflow_posts, de propósito: é UM statement; os writers novos travam o
-- post e depois o destino e só esperam no destino; o claim usa SKIP LOCKED; e o EvalPlanQual
-- do UPDATE reavalia t.status = 'pendente' e o predicado da trava na versão mais recente da
-- linha do destino antes de escrever.
--
-- EDITAR ANTES DE RODAR: troque o valor abaixo pelo instante anotado no passo 2 do runbook
-- (ISO 8601 com fuso). O valor de fábrica não é uma data e faz o script falhar de propósito.
SELECT set_config('p4.window_start', 'DEFINA-O-INSTANTE-DO-PASSO-2', false);

WITH params AS (
  SELECT current_setting('p4.window_start')::timestamptz AS window_start
),
src AS (
  SELECT wp.id, wp.tiktok_publish_status, wp.tiktok_publish_id, wp.tiktok_post_id,
         wp.tiktok_post_url, wp.tiktok_publish_error, wp.tiktok_publish_retry_count,
         wp.published_at, wp.status AS post_status,
         public.tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) AS st
    FROM public.workflow_posts wp, params p
   WHERE wp.updated_at >= p.window_start
),
remap AS (
  UPDATE public.post_targets t SET
    status        = s.st,
    publish_ref   = CASE WHEN s.st IN ('processando','publicado','falha') THEN s.tiktok_publish_id END,
    external_id   = COALESCE(t.external_id, s.tiktok_post_id),
    permalink     = COALESCE(t.permalink, s.tiktok_post_url),
    error         = CASE WHEN s.st = 'falha' THEN s.tiktok_publish_error END,
    error_code    = NULL,
    retry_count   = CASE WHEN s.st = 'falha' THEN COALESCE(s.tiktok_publish_retry_count, 0) ELSE t.retry_count END,
    processing_at = NULL,
    published_at  = CASE WHEN s.st = 'publicado' THEN COALESCE(t.published_at, s.published_at, now()) END,
    updated_at    = now()
  FROM src s
  WHERE t.post_id = s.id AND t.platform = 'tiktok'
    AND t.status = 'pendente'
    AND s.tiktok_publish_status IS NOT NULL
    AND s.st <> 'pendente'
    AND (s.st <> 'falha' OR s.post_status = 'falha_publicacao')
    AND (t.processing_at IS NULL OR t.processing_at < now() - interval '10 minutes')
  RETURNING t.post_id, t.status
),
fill AS (
  UPDATE public.post_targets t SET
    external_id = COALESCE(t.external_id, s.tiktok_post_id),
    permalink   = COALESCE(t.permalink, s.tiktok_post_url),
    updated_at  = now()
  FROM src s
  WHERE t.post_id = s.id AND t.platform = 'tiktok' AND t.status = 'publicado'
    AND ((t.external_id IS NULL AND s.tiktok_post_id IS NOT NULL)
         OR (t.permalink IS NULL AND s.tiktok_post_url IS NOT NULL))
  RETURNING t.post_id
)
SELECT jsonb_build_object(
  'remapped', (SELECT COALESCE(jsonb_agg(jsonb_build_object('post_id', post_id, 'status', status) ORDER BY post_id), '[]'::jsonb) FROM remap),
  'filled',   (SELECT COALESCE(jsonb_agg(post_id ORDER BY post_id), '[]'::jsonb) FROM fill)
) AS reconciled;
