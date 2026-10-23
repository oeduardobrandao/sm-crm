-- supabase/migrations/20261025000001_post_media_notes.sql
-- Feedback em mídia: notas presas a slide, momento e ponto da mídia do post
-- (spec docs/superpowers/specs/2026-10-22-feedback-em-midia-design.md).
--
-- 1. post_media_notes (uma linha por nota) + checks de âncora e da matriz
--    autor/visibilidade, FKs compostas presas ao conta_id da linha
-- 2. post_media_note_replies (respostas; herdam a visibilidade da nota)
-- 3. post_approval_media_notes (snapshot das notas abertas e visíveis ao
--    cliente no momento de um correcao/aprovado; preenchido pelas RPCs)
-- 4. post_media_notes_v: a nota é "atual" quando um post_file_links do mesmo
--    post aponta para o file_id dela; o slide sai da ordem atual do vínculo,
--    nunca é gravado. Sem vínculo (arquivo trocado, apagado, relinkado em
--    outro post) = versão anterior, rotulada pelo slide_index_at_creation.
-- 5. triggers: updated_at, resolved_by/resolved_at na troca de status,
--    resposta do cliente reabre a nota
-- 6. RLS e grants: o CRM lê as três tabelas, cria nota interna e resposta da
--    equipe (INSERT por coluna, sem status/resolved_*/datas/hub_token), e só
--    troca status. Nota e resposta de cliente entram pelo service
--    role (edge function do Hub). Ninguém além do service role apaga.
--
-- A nota não segura o arquivo: sem reference_count, e o FK do arquivo é
-- ON DELETE SET NULL (file_id) (lista de colunas obrigatória: um SET NULL
-- simples na FK composta tentaria anular conta_id, NOT NULL, e travaria todo
-- DELETE FROM files do app).
--
-- Rollback:
--   drop view post_media_notes_v;
--   drop table post_approval_media_notes, post_media_note_replies, post_media_notes;
--   drop function post_media_notes_before_update(), post_media_note_reply_reopen();

-- =====================================================================
-- 1. post_media_notes
-- =====================================================================
CREATE TABLE post_media_notes (
  id                      bigserial PRIMARY KEY,
  conta_id                uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_id                 bigint NOT NULL,
  file_id                 bigint,
  slide_index_at_creation int    NOT NULL CHECK (slide_index_at_creation >= 0),
  media_kind              text   NOT NULL CHECK (media_kind IN ('image', 'video')),
  t_seconds               numeric(8,2) CHECK (t_seconds >= 0),
  x                       real CHECK (x BETWEEN 0 AND 1),
  y                       real CHECK (y BETWEEN 0 AND 1),
  visibility              text   NOT NULL CHECK (visibility IN ('client', 'internal')),
  author_kind             text   NOT NULL CHECK (author_kind IN ('client', 'team')),
  author_user_id          uuid,
  hub_token               text,
  body                    text   NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  status                  text   NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by             uuid,
  resolved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_media_notes_point_pair CHECK ((x IS NULL) = (y IS NULL)),
  CONSTRAINT post_media_notes_time_on_video CHECK (media_kind = 'video' OR t_seconds IS NULL),
  -- Nota de cliente é sempre visível ao cliente; nota da equipe é sempre
  -- interna (a equipe responde às do cliente, não abre nota visível).
  CONSTRAINT post_media_notes_author_visibility CHECK ((author_kind = 'client') = (visibility = 'client')),
  CONSTRAINT post_media_notes_client_author CHECK (
    author_kind <> 'client' OR (author_user_id IS NULL AND hub_token IS NOT NULL)),
  CONSTRAINT post_media_notes_team_author CHECK (
    author_kind <> 'team' OR (hub_token IS NULL AND author_user_id IS NOT NULL)),
  CONSTRAINT post_media_notes_resolved_shape CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  -- Alvo da FK composta das respostas.
  CONSTRAINT post_media_notes_id_conta_uq UNIQUE (id, conta_id),
  -- Post e arquivo presos ao workspace da própria linha
  -- (workflow_posts_id_conta_uq 20260820000002, files_id_conta_uq 20260626000001).
  CONSTRAINT post_media_notes_post_fk
    FOREIGN KEY (post_id, conta_id) REFERENCES workflow_posts(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_media_notes_file_fk
    FOREIGN KEY (file_id, conta_id) REFERENCES files(id, conta_id) ON DELETE SET NULL (file_id)
);

CREATE INDEX post_media_notes_post_idx ON post_media_notes (post_id);
CREATE INDEX post_media_notes_conta_created_idx ON post_media_notes (conta_id, created_at);
-- Lado referenciador do FK de arquivo: sem ele cada DELETE FROM files varre a tabela.
CREATE INDEX post_media_notes_file_idx ON post_media_notes (file_id) WHERE file_id IS NOT NULL;

COMMENT ON TABLE post_media_notes IS
  'Feedback em mídia: nota presa a um arquivo do post (slide), opcionalmente a um momento (t_seconds) e a um ponto (x, y em 0..1). Slide atual e versão anterior: ver post_media_notes_v.';
COMMENT ON COLUMN post_media_notes.file_id IS
  'Arquivo que o autor via. NULL quando o arquivo foi apagado (a nota vira versão anterior, mídia removida). Não incrementa reference_count.';
COMMENT ON COLUMN post_media_notes.slide_index_at_creation IS
  'Snapshot 0-based do slide na criação; só rotula notas de versão anterior.';

-- =====================================================================
-- 2. post_media_note_replies
-- =====================================================================
CREATE TABLE post_media_note_replies (
  id             bigserial PRIMARY KEY,
  note_id        bigint NOT NULL,
  conta_id       uuid   NOT NULL,
  author_kind    text   NOT NULL CHECK (author_kind IN ('client', 'team')),
  author_user_id uuid,
  hub_token      text,
  body           text   NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_media_note_replies_client_author CHECK (
    author_kind <> 'client' OR (author_user_id IS NULL AND hub_token IS NOT NULL)),
  CONSTRAINT post_media_note_replies_team_author CHECK (
    author_kind <> 'team' OR (hub_token IS NULL AND author_user_id IS NOT NULL)),
  CONSTRAINT post_media_note_replies_note_fk
    FOREIGN KEY (note_id, conta_id) REFERENCES post_media_notes(id, conta_id) ON DELETE CASCADE
);

CREATE INDEX post_media_note_replies_note_idx ON post_media_note_replies (note_id);

-- =====================================================================
-- 3. post_approval_media_notes
-- =====================================================================
CREATE TABLE post_approval_media_notes (
  post_approval_id bigint NOT NULL REFERENCES post_approvals(id) ON DELETE CASCADE,
  note_id          bigint NOT NULL REFERENCES post_media_notes(id) ON DELETE CASCADE,
  PRIMARY KEY (post_approval_id, note_id)
);

-- Cascata a partir da nota e o EXISTS da policy de SELECT.
CREATE INDEX post_approval_media_notes_note_idx ON post_approval_media_notes (note_id);

-- =====================================================================
-- 4. post_media_notes_v
-- =====================================================================
-- security_invoker: quem lê continua sob o RLS de post_media_notes e de
-- post_file_links. post_file_links é único em (post_id, file_id), então o
-- casamento é inequívoco. Slide = posição 0-based por (sort_order, id) entre
-- os vínculos do post.
CREATE VIEW post_media_notes_v WITH (security_invoker = true) AS
SELECT
  n.*,
  l.id                AS current_link_id,
  l.slide_index       AS current_slide_index,
  (l.id IS NULL)      AS is_previous_version
FROM post_media_notes n
LEFT JOIN LATERAL (
  SELECT r.id, r.slide_index
    FROM (
      SELECT pfl.id, pfl.file_id,
             (row_number() OVER (ORDER BY pfl.sort_order, pfl.id) - 1)::int AS slide_index
        FROM post_file_links pfl
       WHERE pfl.post_id = n.post_id
    ) r
   WHERE r.file_id = n.file_id
) l ON true;

-- =====================================================================
-- 5. triggers
-- =====================================================================
-- updated_at sempre; resolved_by/resolved_at só quando o status muda (um
-- update de outra coluna em nota resolvida preserva os dois). Sob service
-- role auth.uid() é NULL: resolver por lá grava resolved_by NULL.
CREATE OR REPLACE FUNCTION post_media_notes_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'resolved' THEN
      NEW.resolved_by := auth.uid();
      NEW.resolved_at := now();
    ELSE
      NEW.resolved_by := NULL;
      NEW.resolved_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION post_media_notes_before_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER post_media_notes_before_update
  BEFORE UPDATE ON post_media_notes
  FOR EACH ROW EXECUTE FUNCTION post_media_notes_before_update();

-- Resposta do cliente reabre a nota (o BEFORE UPDATE acima limpa resolved_*).
-- Respostas de cliente só entram pelo service role, que escreve em
-- post_media_notes sem restrição de coluna.
CREATE OR REPLACE FUNCTION post_media_note_reply_reopen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE post_media_notes SET status = 'open'
   WHERE id = NEW.note_id AND status <> 'open';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION post_media_note_reply_reopen() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER post_media_note_replies_client_reopen
  AFTER INSERT ON post_media_note_replies
  FOR EACH ROW WHEN (NEW.author_kind = 'client')
  EXECUTE FUNCTION post_media_note_reply_reopen();

-- =====================================================================
-- 6. RLS e grants
-- =====================================================================
ALTER TABLE post_media_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_media_note_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_approval_media_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_media_notes_service_role_bypass ON post_media_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY post_media_note_replies_service_role_bypass ON post_media_note_replies
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY post_approval_media_notes_service_role_bypass ON post_approval_media_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY post_media_notes_tenant_select ON post_media_notes
  FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY post_media_note_replies_tenant_select ON post_media_note_replies
  FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));
-- Sem conta_id própria: o CRM lê pelo embed de post_approvals.
CREATE POLICY post_approval_media_notes_tenant_select ON post_approval_media_notes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM post_media_notes n
     WHERE n.id = note_id
       AND n.conta_id IN (SELECT public.get_my_conta_id())));

-- A equipe só cria nota interna em nome próprio.
CREATE POLICY post_media_notes_team_insert ON post_media_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND author_kind = 'team'
    AND visibility = 'internal'
    AND author_user_id = auth.uid());
CREATE POLICY post_media_note_replies_team_insert ON post_media_note_replies
  FOR INSERT TO authenticated
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND author_kind = 'team'
    AND author_user_id = auth.uid());

-- Resolver/reabrir; o grant de coluna limita o UPDATE a status.
CREATE POLICY post_media_notes_tenant_update ON post_media_notes
  FOR UPDATE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

-- Hosted default ACLs dão ALL em tabela/view/sequência nova para
-- anon/authenticated: revoga tudo e devolve só o necessário.
REVOKE ALL ON post_media_notes, post_media_note_replies, post_approval_media_notes, post_media_notes_v
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE post_media_notes_id_seq, post_media_note_replies_id_seq
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON post_media_notes, post_media_note_replies TO authenticated;
-- INSERT por coluna: a policy não restringe status, resolved_*, created_at,
-- updated_at nem hub_token, então a equipe não pode nomeá-los (nota já
-- resolvida, datas forjadas). id vem da sequência.
GRANT INSERT (conta_id, post_id, file_id, slide_index_at_creation, media_kind, t_seconds,
              x, y, visibility, author_kind, author_user_id, body)
  ON post_media_notes TO authenticated;
GRANT INSERT (note_id, conta_id, author_kind, author_user_id, body)
  ON post_media_note_replies TO authenticated;
GRANT UPDATE (status) ON post_media_notes TO authenticated;
GRANT SELECT ON post_approval_media_notes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE post_media_notes_id_seq, post_media_note_replies_id_seq TO authenticated;
GRANT SELECT ON post_media_notes_v TO authenticated, service_role;

GRANT ALL ON post_media_notes, post_media_note_replies, post_approval_media_notes TO service_role;
GRANT ALL ON SEQUENCE post_media_notes_id_seq, post_media_note_replies_id_seq TO service_role;
