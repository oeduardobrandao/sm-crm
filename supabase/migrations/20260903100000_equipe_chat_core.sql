-- supabase/migrations/20260903100000_equipe_chat_core.sql
-- Chat de equipe (grupos + DMs): schema core, RLS por participante, gating
-- feature_team_chat, realtime e notificacao team_message coalescida.
-- Spec: docs/superpowers/specs/2026-09-02-team-group-chats-design.md

-- ============ PLAN FLAG (ships dark) ============
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS feature_team_chat boolean NOT NULL DEFAULT false;

-- ============ TABELAS ============
CREATE TABLE equipe_conversas (
  id         bigserial PRIMARY KEY,
  conta_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('grupo', 'dm')),
  nome       text,
  dm_key     text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- grupo tem nome (1-120) e nunca dm_key; dm tem dm_key e nunca nome.
  CHECK (
    (tipo = 'grupo' AND nome IS NOT NULL
      AND char_length(nome) BETWEEN 1 AND 120 AND dm_key IS NULL)
    OR (tipo = 'dm' AND nome IS NULL AND dm_key IS NOT NULL)
  )
);

-- Uma unica DM por par de usuarios por workspace (dm_key = uuids ordenados).
CREATE UNIQUE INDEX equipe_conversas_dm_uq
  ON equipe_conversas (conta_id, dm_key) WHERE tipo = 'dm';

CREATE TABLE equipe_conversa_participantes (
  id                   bigserial PRIMARY KEY,
  conversa_id          bigint NOT NULL REFERENCES equipe_conversas(id) ON DELETE CASCADE,
  conta_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- High-water mark de leitura: maior equipe_mensagens.id RENDERIZADO pelo
  -- cliente (nao um timestamp: transacao que comita depois do mark ficaria
  -- invisivel para o unread). 0 = nunca leu.
  last_seen_message_id bigint NOT NULL DEFAULT 0,
  joined_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversa_id, user_id)
);

CREATE INDEX equipe_conversa_participantes_user_idx
  ON equipe_conversa_participantes (user_id, conta_id);

CREATE TABLE equipe_mensagens (
  id             bigserial PRIMARY KEY,
  conversa_id    bigint NOT NULL REFERENCES equipe_conversas(id) ON DELETE CASCADE,
  conta_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- '' permitido: mensagem so-anexo (apenas via send_equipe_mensagem; o
  -- INSERT direto exige content nao vazio na policy).
  content        text NOT NULL CHECK (char_length(content) <= 4000),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX equipe_mensagens_conversa_idx
  ON equipe_mensagens (conversa_id, created_at DESC, id DESC);

CREATE TABLE equipe_mensagem_anexos (
  id          bigserial PRIMARY KEY,
  conta_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversa_id bigint NOT NULL REFERENCES equipe_conversas(id) ON DELETE CASCADE,
  -- NULL = staged: upload finalizado, mensagem ainda nao enviada.
  mensagem_id bigint REFERENCES equipe_mensagens(id) ON DELETE CASCADE,
  r2_key      text NOT NULL UNIQUE,
  file_name   text NOT NULL,
  mime_type   text NOT NULL,
  size_bytes  bigint NOT NULL CHECK (size_bytes > 0),
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX equipe_mensagem_anexos_mensagem_idx
  ON equipe_mensagem_anexos (mensagem_id);
-- Para o reaper de staged do cron.
CREATE INDEX equipe_mensagem_anexos_staged_idx
  ON equipe_mensagem_anexos (created_at) WHERE mensagem_id IS NULL;

-- ============ HELPER DE PARTICIPACAO (RLS sem recursao) ============
-- SECURITY DEFINER quebra a recursao participantes<->conversas (padrao
-- user_workspace_ids, 20260612120000). Tres condicoes, todas obrigatorias:
-- participa; conversa e do workspace ativo; caller AINDA e membro do
-- workspace (defense-in-depth do workspace_usage 20260808000001 - linhas de
-- participante sobrevivem a remocao do workspace, o acesso nao pode).
CREATE OR REPLACE FUNCTION public.is_equipe_conversa_member(p_conversa_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM equipe_conversa_participantes pt
      JOIN equipe_conversas ec ON ec.id = pt.conversa_id
     WHERE pt.conversa_id = p_conversa_id
       AND pt.user_id = auth.uid()
       AND ec.conta_id IN (SELECT public.get_my_conta_id())
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = ec.conta_id
            AND wm.user_id = auth.uid()
       )
  );
$$;

REVOKE ALL ON FUNCTION public.is_equipe_conversa_member(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_equipe_conversa_member(bigint)
  TO authenticated, service_role;

-- ============ RLS ============
ALTER TABLE equipe_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipe_conversa_participantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipe_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipe_mensagem_anexos ENABLE ROW LEVEL SECURITY;

-- Leitura: so participantes. Escrita de conversas/participantes: NENHUMA
-- policy authenticated - toda criacao/gestao passa pelas RPCs SECURITY
-- DEFINER da migration B (validam papel owner/admin e membership).
CREATE POLICY equipe_conversas_member_select ON equipe_conversas
  FOR SELECT USING (public.is_equipe_conversa_member(id));

CREATE POLICY equipe_participantes_member_select ON equipe_conversa_participantes
  FOR SELECT USING (public.is_equipe_conversa_member(equipe_conversa_participantes.conversa_id));

CREATE POLICY equipe_mensagens_member_select ON equipe_mensagens
  FOR SELECT USING (public.is_equipe_conversa_member(equipe_mensagens.conversa_id));

-- INSERT direto (PostgREST): so participante, como ele mesmo, no workspace
-- ativo, e NUNCA vazio - mensagem so-anexo e exclusiva da RPC
-- send_equipe_mensagem, que valida os anexos.
CREATE POLICY equipe_mensagens_member_insert ON equipe_mensagens
  FOR INSERT WITH CHECK (
    public.is_equipe_conversa_member(equipe_mensagens.conversa_id)
    AND author_user_id = auth.uid()
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND char_length(btrim(content)) >= 1
    AND EXISTS (
      SELECT 1 FROM public.equipe_conversas ec
      WHERE ec.id = equipe_mensagens.conversa_id
        AND ec.conta_id = equipe_mensagens.conta_id
    )
  );

-- Staged (mensagem_id NULL) = rascunho ainda nao enviado: so o autor le a
-- propria linha. Uma vez enviado (mensagem_id preenchido), qualquer
-- participante da conversa le.
CREATE POLICY equipe_anexos_member_select ON equipe_mensagem_anexos
  FOR SELECT USING (
    public.is_equipe_conversa_member(equipe_mensagem_anexos.conversa_id)
    AND (equipe_mensagem_anexos.mensagem_id IS NOT NULL
         OR equipe_mensagem_anexos.created_by = auth.uid())
  );

-- Bypass service_role em todas (padrao do repo).
CREATE POLICY equipe_conversas_service_role_bypass ON equipe_conversas
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY equipe_participantes_service_role_bypass ON equipe_conversa_participantes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY equipe_mensagens_service_role_bypass ON equipe_mensagens
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY equipe_anexos_service_role_bypass ON equipe_mensagem_anexos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ GATING DE PLANO ============
CREATE TRIGGER equipe_conversas_feature_gate
  BEFORE INSERT ON equipe_conversas
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_feature('feature_team_chat', 'direct', 'conta_id');

CREATE TRIGGER equipe_mensagens_feature_gate
  BEFORE INSERT ON equipe_mensagens
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_feature('feature_team_chat', 'direct', 'conta_id');

-- ============ NOTIFICACOES ============
-- ATENCAO: lista copiada da definicao MAIS RECENTE no momento de escrever
-- (hoje 20260815000004_instagram_automation_rpcs.sql, 22 valores) e apenas
-- ACRESCENTA 'team_message'. Este arquivo passa a ser a definicao mais
-- recente: a proxima migration copia DAQUI.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'instagram_connected_by_client',
    'post_publish_failed', 'storage_autoclean_report',
    'instagram_automation_failed',
    'team_message'
  )
);

-- Coalescing atomico: no maximo UMA team_message nao lida (nem dispensada)
-- por (user, conversa). Duas mensagens concorrentes nao duplicam: a segunda
-- cai no ON CONFLICT DO NOTHING do trigger abaixo.
CREATE UNIQUE INDEX notifications_team_message_unread_uq
  ON notifications (user_id, ((metadata->>'conversa_id')))
  WHERE type = 'team_message' AND read_at IS NULL AND dismissed_at IS NULL;

-- Insert direto (nao insert_notification_batch: o helper nao tem ON
-- CONFLICT). EXCEPTION-wrap: falha de notificacao nunca derruba o envio.
CREATE OR REPLACE FUNCTION trg_notify_team_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversa_nome text;
  v_author_name   text;
BEGIN
  BEGIN
    SELECT ec.nome INTO v_conversa_nome
      FROM equipe_conversas ec WHERE ec.id = NEW.conversa_id;

    SELECT COALESCE(mb.nome, p.nome, 'Equipe') INTO v_author_name
      FROM auth.users u
      LEFT JOIN membros mb ON mb.crm_user_id = NEW.author_user_id
                          AND mb.conta_id = NEW.conta_id
      LEFT JOIN profiles p ON p.id = NEW.author_user_id
     WHERE u.id = NEW.author_user_id;

    INSERT INTO notifications (workspace_id, user_id, type, metadata, link)
    SELECT NEW.conta_id,
           pt.user_id,
           'team_message',
           jsonb_build_object(
             'conversa_id',   NEW.conversa_id::text,
             'conversa_nome', v_conversa_nome,
             'author_name',   v_author_name,
             'preview',       left(NEW.content, 280)
           ),
           '/mensagens/equipe/' || NEW.conversa_id
      FROM equipe_conversa_participantes pt
     WHERE pt.conversa_id = NEW.conversa_id
       AND pt.user_id <> NEW.author_user_id
    ON CONFLICT (user_id, ((metadata->>'conversa_id')))
      WHERE type = 'team_message' AND read_at IS NULL AND dismissed_at IS NULL
      DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_team_message failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_team_message ON equipe_mensagens;
CREATE TRIGGER notify_team_message
  AFTER INSERT ON equipe_mensagens
  FOR EACH ROW
  EXECUTE FUNCTION trg_notify_team_message();

-- ============ REALTIME ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'equipe_mensagens'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.equipe_mensagens;
    RAISE NOTICE 'added equipe_mensagens to supabase_realtime';
  ELSE
    RAISE NOTICE 'equipe_mensagens already in supabase_realtime';
  END IF;
END $$;

-- Pos-condicao: sem a tabela na publication o realtime silenciosamente nunca
-- dispara (padrao 20260728000001).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'equipe_mensagens'
  ) THEN
    RAISE EXCEPTION 'equipe_mensagens not in supabase_realtime publication';
  END IF;
END $$;
