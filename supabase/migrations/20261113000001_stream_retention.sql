-- Retenção do Cloudflare Stream (spec docs/superpowers/specs/2026-10-31-stream-retention-design.md).
-- Vídeo de post só fica no Stream enquanto algum post dele estiver "vivo" (na frente do
-- cliente); fora disso toca do R2.
--
-- 1. stream_status ganha 'parked' (vídeo fora do Stream por retenção; volta quando ficar elegível).
-- 2. Trigger BEFORE INSERT: vídeo novo sem stream_status nasce 'parked' (upload de biblioteca
--    nunca entra no Stream sozinho; file-upload-finalize copia na hora quando já vem de post vivo).
-- 3. Backfill: vídeo sem stream_uid e com stream_status nulo vira 'parked'.
-- 4. Predicados stream_post_is_live (regra de post vivo, fonte única) e stream_file_is_eligible
--    (usado pelo release; o ingest aplica a mesma regra partindo dos posts vivos).
-- 5. RPCs do post-media-cleanup-cron: stream_ingest_candidates e stream_release_claim
--    (só service_role).
--
-- Fora do escopo: kb_videos (tabela própria, não é lida aqui) e stream_status = 'skipped'
-- (referências de post): nunca entram nem saem por estas funções.
--
-- Ordem de deploy: esta migration ANTES de post-media-cleanup-cron e file-upload-finalize.
-- As functions antigas convivem com ela: o ingest antigo só pega stream_status NULL/'pending'.
--
-- Rollback: voltar o cron para uma versão antiga é seguro, ela nunca reingere 'parked' (o
-- ingest antigo só pega NULL/'pending') e o reap continua respeitando files.stream_uid.
-- Forward-only: a CHECK expandida e o trigger podem ficar mesmo com functions antigas.
-- Efeito colateral: com o trigger ativo e o cron antigo, vídeo de post ligado por outro caminho
-- que não o file-upload-finalize (file-manage /links, duplicar post, MCP, biblioteca e depois
-- post) nasce 'parked' e fica tocando do R2 até o cron novo voltar e reingeri-lo.

-- 1. CHECK com 'parked'. Mesmo nome e padrão de 20261011000001_post_references.sql.
ALTER TABLE files DROP CONSTRAINT files_stream_status_check;
ALTER TABLE files ADD CONSTRAINT files_stream_status_check
  CHECK (stream_status IN ('pending', 'ready', 'error', 'skipped', 'parked'));

-- 2. Vídeo novo sem stream_status nasce 'parked'. Quem já manda um valor ('pending' do
-- finalize de post vivo, 'skipped' das referências) é respeitado.
CREATE OR REPLACE FUNCTION files_video_default_parked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'video' AND NEW.stream_status IS NULL THEN
    NEW.stream_status := 'parked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_files_video_default_parked ON files;
CREATE TRIGGER trg_files_video_default_parked
  BEFORE INSERT ON files
  FOR EACH ROW EXECUTE FUNCTION files_video_default_parked();

-- 3. Backfill: vídeo que ainda não foi para o Stream fica 'parked' até ficar elegível.
-- Não toca 'skipped', 'pending', 'error' nem quem já tem stream_uid.
UPDATE files SET stream_status = 'parked'
  WHERE kind = 'video' AND stream_uid IS NULL AND stream_status IS NULL;

-- 4a. Post "vivo":
--   agendado / falha_publicacao: sempre (esperando publicar ou precisando de ação);
--   postado: publicado há menos de p_grace_days dias (published_at nulo = dado corrompido,
--     conta como publicado há muito tempo: sai do Stream e toca do R2);
--   qualquer outro status: mudou de status nos últimos p_idle_days dias.
CREATE OR REPLACE FUNCTION stream_post_is_live(
  p_status text,
  p_published_at timestamptz,
  p_last_moved_at timestamptz,
  p_grace_days int,
  p_idle_days int
) RETURNS boolean
LANGUAGE sql
STABLE
-- Sem SET search_path de propósito: o corpo só usa funções do pg_catalog (now, make_interval),
-- é SECURITY INVOKER e só service_role executa; o SET impediria o planner de embutir (inline)
-- esta função escalar nas consultas de ingest e release, que a chamam por linha.
AS $$
  SELECT CASE
    WHEN p_status IN ('agendado', 'falha_publicacao') THEN true
    WHEN p_status = 'postado' THEN
      p_published_at IS NOT NULL
      AND p_published_at > now() - make_interval(days => p_grace_days)
    ELSE
      p_last_moved_at IS NOT NULL
      AND p_last_moved_at > now() - make_interval(days => p_idle_days)
  END
$$;

-- 4b. Vídeo elegível = ligado a pelo menos um post vivo do MESMO workspace
-- (files.conta_id = post_file_links.conta_id = workflow_posts.conta_id; link cruzado é
-- ignorado, nunca mantém nem traz de volta o vídeo de outro tenant). Referência
-- (attached_to não nulo) nunca é elegível. Movimento = último post_status_events do post
-- (índice post_id, created_at); sem evento, created_at do post. Nunca updated_at, que
-- todo UPDATE carimba, inclusive de crons.
CREATE OR REPLACE FUNCTION stream_file_is_eligible(
  p_file_id bigint,
  p_grace_days int,
  p_idle_days int
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM files f
    JOIN post_file_links l ON l.file_id = f.id AND l.conta_id = f.conta_id
    JOIN workflow_posts p ON p.id = l.post_id AND p.conta_id = f.conta_id
    WHERE f.id = p_file_id
      AND f.kind = 'video'
      AND f.attached_to IS NULL
      AND stream_post_is_live(
        p.status,
        p.published_at,
        coalesce(
          (SELECT max(e.created_at) FROM post_status_events e WHERE e.post_id = p.id),
          p.created_at
        ),
        p_grace_days,
        p_idle_days
      )
  )
$$;

-- 5a. Ingest catch-up: vídeos elegíveis sem stream_uid, com status que permite ingest
-- (NULL, 'pending' ou 'parked'; nunca 'skipped', 'error' ou 'ready'), com 10 minutos de
-- carência para o finalize terminar.
--
-- A consulta parte dos posts vivos, não da biblioteca: em regime quase todo vídeo sem
-- stream_uid é 'parked' e não elegível, e esse conjunto só cresce. Percorrer files em ordem de
-- created_at chamando stream_file_is_eligible por linha varreria a biblioteca inteira a cada
-- execução horária sempre que houvesse menos de p_limit elegíveis (o caso normal).
--
-- Mesma semântica de stream_file_is_eligible (a suíte supabase/tests/stream_retention.sql
-- confere): post vivo por stream_post_is_live, link e post do MESMO conta_id do arquivo,
-- referência (attached_to) nunca entra.
--   candidatos: pré-filtro barato, superconjunto dos posts vivos: agendado/falha_publicacao;
--     postado com published_at na carência;
--     outros status com created_at ou algum post_status_events dentro de p_idle_days (último
--     movimento > corte  <=>  existe evento > corte, ou não há evento e created_at > corte).
--     O max(post_status_events) do último movimento é calculado só para esses candidatos.
--   posts_vivos: regra exata (stream_post_is_live, embutida pelo planner: argumentos são colunas).
--   arquivos: links dos posts vivos com o mesmo conta_id do post.
CREATE OR REPLACE FUNCTION stream_ingest_candidates(
  p_limit int,
  p_grace_days int,
  p_idle_days int
) RETURNS TABLE (id bigint, r2_key text, conta_id uuid, created_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH candidatos AS MATERIALIZED (
    SELECT
      p.id,
      p.conta_id,
      p.status,
      p.published_at,
      coalesce(
        (SELECT max(e.created_at) FROM post_status_events e WHERE e.post_id = p.id),
        p.created_at
      ) AS last_moved_at
    FROM workflow_posts p
    WHERE p.status IN ('agendado', 'falha_publicacao')
       OR (p.status = 'postado'
           AND p.published_at > now() - make_interval(days => p_grace_days))
       OR (p.status IS DISTINCT FROM 'agendado'
           AND p.status IS DISTINCT FROM 'falha_publicacao'
           AND p.status IS DISTINCT FROM 'postado'
           AND (p.created_at > now() - make_interval(days => p_idle_days)
                OR EXISTS (
                  SELECT 1 FROM post_status_events e
                  WHERE e.post_id = p.id
                    AND e.created_at > now() - make_interval(days => p_idle_days)
                )))
  ),
  posts_vivos AS MATERIALIZED (
    SELECT c.id, c.conta_id
    FROM candidatos c
    WHERE stream_post_is_live(c.status, c.published_at, c.last_moved_at, p_grace_days, p_idle_days)
  ),
  arquivos AS MATERIALIZED (
    SELECT DISTINCT l.file_id, l.conta_id
    FROM posts_vivos pv
    JOIN post_file_links l ON l.post_id = pv.id AND l.conta_id = pv.conta_id
  )
  SELECT f.id, f.r2_key, f.conta_id, f.created_at
  FROM arquivos a
  JOIN files f ON f.id = a.file_id AND f.conta_id = a.conta_id
  WHERE f.kind = 'video'
    AND f.attached_to IS NULL
    AND f.stream_uid IS NULL
    AND (f.stream_status IS NULL OR f.stream_status IN ('pending', 'parked'))
    AND f.created_at < now() - interval '10 minutes'
  ORDER BY f.created_at, f.id
  LIMIT p_limit
$$;

-- 5b. Release: num único statement, trava (SKIP LOCKED) os vídeos com stream_uid que não
-- estão elegíveis agora, troca para 'parked', zera stream_uid e devolve os uids para o cron
-- apagar no Stream. Se o delete falhar, o uid já não está em nenhuma tabela e o orphan reap
-- o apaga. 'skipped' nunca é tocado.
-- Não é linearizável com mudanças de link/status: a elegibilidade é lida no snapshot do
-- statement, então um link novo ou uma mudança de status que comite entre o snapshot e o lock
-- pode liberar um vídeo que acabou de ficar vivo. O próximo ingest o traz de volta.
CREATE OR REPLACE FUNCTION stream_release_claim(
  p_limit int,
  p_grace_days int,
  p_idle_days int
) RETURNS TABLE (id bigint, stream_uid text)
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  WITH c AS (
    SELECT f.id, f.stream_uid
    FROM files f
    WHERE f.kind = 'video'
      AND f.stream_uid IS NOT NULL
      AND f.stream_status IS DISTINCT FROM 'skipped'
      AND NOT stream_file_is_eligible(f.id, p_grace_days, p_idle_days)
    ORDER BY f.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE files
  SET stream_status = 'parked', stream_uid = NULL
  FROM c
  WHERE files.id = c.id
  RETURNING files.id, c.stream_uid
$$;

REVOKE ALL ON FUNCTION stream_post_is_live(text, timestamptz, timestamptz, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stream_file_is_eligible(bigint, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stream_ingest_candidates(int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stream_release_claim(int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stream_post_is_live(text, timestamptz, timestamptz, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION stream_file_is_eligible(bigint, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION stream_ingest_candidates(int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION stream_release_claim(int, int, int) TO service_role;
