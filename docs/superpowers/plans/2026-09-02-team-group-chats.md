# Chat de Equipe (grupos + DMs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conversas internas entre membros do workspace (grupos criados por owner/admin + DMs livres) dentro da página Mensagens do CRM, com realtime, @-menções display-only e anexos com quota — tudo dark atrás da flag `feature_team_chat`.

**Architecture:** Subsistema paralelo ao messaging de clientes: 4 tabelas novas com RLS por participante (helper SECURITY DEFINER), RPCs SECURITY DEFINER para todo fluxo de escrita, realtime via Postgres Changes (RLS filtra a entrega), edge function `equipe-chat-media` no padrão tmp→copy da `automation-media`, e UI nova na página Mensagens (aba Equipe) sem tocar no chat com clientes.

**Tech Stack:** Postgres/Supabase (migrations SQL, RLS, RPCs plpgsql), Deno edge functions, React 19 + TanStack Query + React Router v7 (`<Routes>` descendente), Vitest, deno test, psql (suite de entitlements).

**Spec:** `docs/superpowers/specs/2026-09-02-team-group-chats-design.md` (leia antes de qualquer task).

## Global Constraints

- Branch de trabalho: `claude/group-chats-team-c8f94a`, worktree `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/fervent-germain-92dc48`. Rode TUDO de dentro do worktree; confirme com `pwd` e `git branch --show-current` antes do primeiro commit.
- Prefixos de migration: únicos e ACIMA do tail de origin/main (`20260902000010`). Este plano usa `20260902120000`, `20260902121000`, `20260902122000`. Antes de abrir PR, re-verifique com `git ls-tree --name-only origin/main:supabase/migrations | tail -5` e renumere se main andou.
- Copy de UI em pt-BR. NUNCA use em-dash (—) em copy visível ao usuário; use ponto, dois-pontos ou "·".
- RLS: sempre `conta_id IN (SELECT public.get_my_conta_id())`, nunca `=`. Em subqueries de policy, qualifique a coluna da tabela externa (`equipe_mensagens.conversa_id`), nunca deixe o nome bare.
- Funções novas em `public`: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role;` seguido de `GRANT` explícito ao que precisa (revogar PUBLIC também tira service_role).
- Edge functions: `buildCorsHeaders(req)` sempre; nunca wildcard. Erros para o cliente são genéricos; detalhe só em `console.error`. Split `index.ts` (composition root) + `handler.ts` (factory pura testável).
- Notification triggers: corpo inteiro em `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING`; falha de notificação nunca derruba a escrita.
- Toasts novos via `toast()` de `sonner`.
- Ícones: `lucide-react`.
- Antes de cada commit: rode o(s) comando(s) de teste do task; nunca commite com teste falhando.

---

### Task 1: Migration A — schema core, RLS, gating, realtime, notificação

**Files:**
- Create: `supabase/migrations/20260902120000_equipe_chat_core.sql`
- Create: `supabase/tests/entitlements/72_equipe_chat_core.sql`

**Interfaces:**
- Consumes: `enforce_plan_feature(feature, 'direct', 'conta_id')` (20260611140002), `public.get_my_conta_id()` (retorna NULL para removidos do workspace), padrão DO-block de publication (20260728000001).
- Produces: tabelas `equipe_conversas`, `equipe_conversa_participantes`, `equipe_mensagens`, `equipe_mensagem_anexos`; função `public.is_equipe_conversa_member(bigint)`; coluna `plans.feature_team_chat`; tipo de notificação `team_message`; índice `notifications_team_message_unread_uq`. Tasks 2, 3, 6 e 7 dependem de tudo isso com estes nomes exatos.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260902120000_equipe_chat_core.sql
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

CREATE POLICY equipe_anexos_member_select ON equipe_mensagem_anexos
  FOR SELECT USING (public.is_equipe_conversa_member(equipe_mensagem_anexos.conversa_id));

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
```

- [ ] **Step 2: Escrever o teste de entitlements (falha sem a migration)**

Crie `supabase/tests/entitlements/72_equipe_chat_core.sql`. Estrutura obrigatória: `\set ON_ERROR_STOP on` + `\i supabase/tests/entitlements/_helpers.sql` no topo; um bloco `begin; ... rollback;` por cenário; `et_grant_hosted_parity()` no início de cada bloco que troca de role; impersonação = `set local role authenticated` + `set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true)`; negação de RLS em SELECT medida por contagem (`get diagnostics`/`assert v_rows = 0`) com o par positivo no mesmo bloco; INSERT bloqueado capturado com `exception when sqlstate 'P0001'`/`when others` + flag booleana. Lembre a ordem: `insert into workspace_members` ANTES do `update profiles set active_workspace_id` (trigger `trg_validate_active_workspace`).

Cenários (cada um: setup com `et_make_workspace('pro')`, dois+ usuários):

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- ============================================================
-- 1. feature_team_chat OFF: INSERT em equipe_conversas (service role
--    simulando RPC) e equipe_mensagens bloqueiam com feature_disabled.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'owner'
    where id = v_owner;

  v_blocked := false;
  begin
    insert into equipe_conversas (conta_id, tipo, nome, created_by)
      values (v_ws, 'grupo', 'Time', v_owner);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_team_chat%',
      format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'insert de conversa deve bloquear com a flag off';
  raise notice 'PASS 1: gate feature_team_chat bloqueia conversa';
end $$;
rollback;

-- ============================================================
-- 2. Flag ON via override: cria conversa+participantes+mensagem (como
--    postgres, simulando as RPCs SECURITY DEFINER); nao-participante do
--    MESMO workspace nao le nada (conversa, participantes, mensagens);
--    participante le tudo.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();  -- participante
  v_b uuid := gen_random_uuid();  -- colega de fora da conversa
  v_conv bigint;
  v_rows int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_b, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_b);

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_a) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a);
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'oi');

  -- v_b (mesmo workspace, fora da conversa): zero linhas nas tres tabelas.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform 1 from equipe_conversas where id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'nao-participante nao pode ler a conversa';
  perform 1 from equipe_conversa_participantes where conversa_id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'nao-participante nao pode ler participantes';
  perform 1 from equipe_mensagens where conversa_id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'nao-participante nao pode ler mensagens';

  -- v_a (participante): le as tres.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform 1 from equipe_conversas where id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'participante le a conversa';
  perform 1 from equipe_mensagens where conversa_id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'participante le a mensagem';
  execute 'reset role';
  raise notice 'PASS 2: RLS por participante';
end $$;
rollback;

-- ============================================================
-- 3. Removido do workspace nao le mais, mesmo com a linha de participante
--    viva e active_workspace_id ainda apontando para o workspace.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_gone uuid := gen_random_uuid();
  v_conv bigint;
  v_rows int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_gone);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_gone, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_gone);

  insert into equipe_conversas (conta_id, tipo, dm_key, created_by)
    values (v_ws, 'dm', least(v_a::text, v_gone::text) || ':' || greatest(v_a::text, v_gone::text), v_a)
    returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a), (v_conv, v_ws, v_gone);
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'segredo');

  -- Remove do workspace; linha de participante fica (historico dos demais).
  delete from workspace_members where user_id = v_gone and workspace_id = v_ws;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gone, 'role', 'authenticated')::text, true);
  perform 1 from equipe_mensagens where conversa_id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'removido do workspace nao le mensagens da DM';
  execute 'reset role';
  raise notice 'PASS 3: remocao do workspace corta acesso';
end $$;
rollback;

-- ============================================================
-- 4. INSERT direto de mensagem: participante manda como ele mesmo; forjar
--    author de colega e bloqueado; content vazio e bloqueado; nao-
--    participante e bloqueado.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_fora uuid := gen_random_uuid();
  v_conv bigint;
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b), (v_fora);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_b, v_ws, 'admin'), (v_fora, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
    where id in (v_a, v_b, v_fora);

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_a) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a), (v_conv, v_ws, v_b);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- Envio legitimo passa.
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'oi time');

  -- Forjar autoria do colega: RLS bloqueia (42501).
  v_blocked := false;
  begin
    insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
      values (v_conv, v_ws, v_b, 'falso');
  exception when others then
    v_blocked := true;
  end;
  assert v_blocked, 'autoria forjada deve ser bloqueada';

  -- Content vazio via INSERT direto: bloqueado.
  v_blocked := false;
  begin
    insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
      values (v_conv, v_ws, v_a, '   ');
  exception when others then
    v_blocked := true;
  end;
  assert v_blocked, 'content vazio via INSERT direto deve ser bloqueado';

  -- Nao-participante: bloqueado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_fora, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
      values (v_conv, v_ws, v_fora, 'intruso');
  exception when others then
    v_blocked := true;
  end;
  assert v_blocked, 'nao-participante nao insere mensagem';
  execute 'reset role';
  raise notice 'PASS 4: WITH CHECK do INSERT direto';
end $$;
rollback;

-- ============================================================
-- 5. Notificacao coalescida: 1a mensagem cria team_message para os demais
--    participantes (nunca para o autor); 2a mensagem NAO duplica; apos
--    marcar lida, a 3a cria de novo.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_conv bigint;
  v_n int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_b, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_b);

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_a) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a), (v_conv, v_ws, v_b);

  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'primeira');
  select count(*) into v_n from notifications
   where type = 'team_message' and user_id = v_b
     and metadata->>'conversa_id' = v_conv::text;
  assert v_n = 1, format('esperava 1 notificacao, achou %s', v_n);
  select count(*) into v_n from notifications
   where type = 'team_message' and user_id = v_a;
  assert v_n = 0, 'autor nunca recebe a propria notificacao';

  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'segunda');
  select count(*) into v_n from notifications
   where type = 'team_message' and user_id = v_b
     and metadata->>'conversa_id' = v_conv::text;
  assert v_n = 1, 'segunda mensagem nao duplica a nao lida';

  update notifications set read_at = now()
   where type = 'team_message' and user_id = v_b;
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'terceira');
  select count(*) into v_n from notifications
   where type = 'team_message' and user_id = v_b
     and metadata->>'conversa_id' = v_conv::text and read_at is null;
  assert v_n = 1, 'apos ler, nova mensagem notifica de novo';
  raise notice 'PASS 5: coalescing de team_message';
end $$;
rollback;

-- ============================================================
-- 6. dm_key unico por (conta, par): segunda DM identica viola o indice.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_key text;
  v_blocked boolean := false;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b);
  v_key := least(v_a::text, v_b::text) || ':' || greatest(v_a::text, v_b::text);
  insert into equipe_conversas (conta_id, tipo, dm_key, created_by)
    values (v_ws, 'dm', v_key, v_a);
  begin
    insert into equipe_conversas (conta_id, tipo, dm_key, created_by)
      values (v_ws, 'dm', v_key, v_b);
  exception when unique_violation then
    v_blocked := true;
  end;
  assert v_blocked, 'dm_key duplicada deve violar o indice unico';
  raise notice 'PASS 6: dm_key unica';
end $$;
rollback;
```

- [ ] **Step 3: Rodar o teste (condicional a stack local)**

Run: `npx supabase status 2>/dev/null | grep -q 'API URL' && (npx supabase db reset >/dev/null && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/72_equipe_chat_core.sql) || echo 'SKIP: sem Supabase local; o job entitlement-tests do CI roda isto'`
Expected: todos os `PASS n:` impressos, exit 0 — ou o SKIP explícito. Se qualquer assert falhar, corrija a migration antes de commitar. (Ambiente local usa colima; worktrees paralelos podem segurar as portas — o SKIP é aceitável, o CI é o gate.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260902120000_equipe_chat_core.sql supabase/tests/entitlements/72_equipe_chat_core.sql
git commit -m "feat(equipe-chat): schema core, RLS por participante, gating e notificacao coalescida"
```

---

### Task 2: Migration B — RPCs do chat

**Files:**
- Create: `supabase/migrations/20260902121000_equipe_chat_rpcs.sql`
- Create: `supabase/tests/entitlements/73_equipe_chat_rpcs.sql`

**Interfaces:**
- Consumes: tabelas e helper da Task 1 (nomes exatos), `public.get_my_conta_id()`, `membros.crm_user_id`/`membros.nome`/`membros.avatar_url`, `profiles.nome`/`profiles.avatar_url`.
- Produces (a Task 5 chama exatamente estas assinaturas via `supabase.rpc`):
  - `get_equipe_conversas()` → TABLE(conversa_id bigint, tipo text, nome text, display_nome text, avatar_url text, participantes_count int, last_author_name text, last_content text, last_has_anexo boolean, last_created_at timestamptz, last_message_id bigint, unread_count bigint)
  - `get_equipe_mensagens(p_conversa_id bigint, p_before timestamptz DEFAULT NULL, p_before_id bigint DEFAULT NULL, p_limit int DEFAULT 50)` → TABLE(id bigint, conversa_id bigint, author_user_id uuid, author_name text, author_avatar_url text, content text, created_at timestamptz, anexos jsonb)
  - `create_equipe_conversa(p_tipo text, p_nome text, p_user_ids uuid[])` → bigint (id da conversa)
  - `manage_equipe_conversa(p_conversa_id bigint, p_action text, p_nome text DEFAULT NULL, p_user_id uuid DEFAULT NULL)` → void (actions: rename, add, remove, leave)
  - `mark_equipe_conversa_seen(p_conversa_id bigint, p_last_message_id bigint)` → void
  - `get_equipe_chat_unread()` → bigint
  - `get_equipe_chat_members()` → TABLE(user_id uuid, nome text, avatar_url text, role text)
  - `send_equipe_mensagem(p_conversa_id bigint, p_content text, p_anexo_ids bigint[] DEFAULT NULL)` → bigint (id da mensagem)

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260902121000_equipe_chat_rpcs.sql
-- RPCs do chat de equipe. Todas SECURITY DEFINER + SET search_path = public;
-- tenant SEMPRE derivado de get_my_conta_id() (nunca de parametro); acesso a
-- conversa SEMPRE re-validado por participacao. Colunas de RETURNS TABLE
-- sombreiam nomes - todas as referencias internas sao table-qualified.

-- ============ LISTA DE CONVERSAS ============
CREATE OR REPLACE FUNCTION get_equipe_conversas()
RETURNS TABLE (
  conversa_id         bigint,
  tipo                text,
  nome                text,
  display_nome        text,
  avatar_url          text,
  participantes_count int,
  last_author_name    text,
  last_content        text,
  last_has_anexo      boolean,
  last_created_at     timestamptz,
  last_message_id     bigint,
  unread_count        bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH minhas AS (
    SELECT ec.id AS c_id, ec.tipo AS c_tipo, ec.nome AS c_nome,
           pt.last_seen_message_id AS c_seen
      FROM equipe_conversa_participantes pt
      JOIN equipe_conversas ec ON ec.id = pt.conversa_id
     WHERE pt.user_id = v_uid AND ec.conta_id = v_conta
  ),
  outro AS (
    -- Para DMs: identidade do OUTRO participante (nome e avatar da linha).
    -- Escopado a c_tipo = 'dm': sem isso, um grupo de 3+ tambem bate no
    -- WHERE pt.user_id <> v_uid e o LEFT JOIN final fanned-out em uma linha
    -- por OUTRO participante do grupo, violando o contrato de 1 linha por
    -- conversa.
    SELECT pt.conversa_id AS c_id,
           COALESCE(mb.nome, p.nome, 'Colega') AS o_nome,
           COALESCE(mb.avatar_url, p.avatar_url) AS o_avatar
      FROM equipe_conversa_participantes pt
      JOIN minhas m ON m.c_id = pt.conversa_id AND m.c_tipo = 'dm'
      LEFT JOIN membros mb ON mb.crm_user_id = pt.user_id AND mb.conta_id = v_conta
      LEFT JOIN profiles p ON p.id = pt.user_id
     WHERE pt.user_id <> v_uid
  ),
  ultima AS (
    SELECT DISTINCT ON (em.conversa_id)
           em.conversa_id AS c_id, em.id AS m_id, em.content AS m_content,
           em.created_at AS m_created_at, em.author_user_id AS m_author
      FROM equipe_mensagens em
     WHERE em.conversa_id IN (SELECT m.c_id FROM minhas m)
     ORDER BY em.conversa_id, em.created_at DESC, em.id DESC
  ),
  nao_lidas AS (
    SELECT em.conversa_id AS c_id, count(*)::bigint AS n
      FROM equipe_mensagens em
      JOIN minhas m ON m.c_id = em.conversa_id
     WHERE em.id > m.c_seen AND em.author_user_id <> v_uid
     GROUP BY em.conversa_id
  )
  SELECT m.c_id, m.c_tipo, m.c_nome,
         CASE WHEN m.c_tipo = 'dm' THEN COALESCE(o.o_nome, 'Colega') ELSE m.c_nome END,
         CASE WHEN m.c_tipo = 'dm' THEN o.o_avatar ELSE NULL END,
         (SELECT count(*)::int FROM equipe_conversa_participantes pt2
           WHERE pt2.conversa_id = m.c_id),
         COALESCE(mb2.nome, p2.nome, 'Equipe'),
         u.m_content,
         EXISTS (SELECT 1 FROM equipe_mensagem_anexos ax
                  WHERE ax.mensagem_id = u.m_id),
         u.m_created_at,
         u.m_id,
         COALESCE(nl.n, 0)
    FROM minhas m
    LEFT JOIN outro o ON o.c_id = m.c_id
    LEFT JOIN ultima u ON u.c_id = m.c_id
    LEFT JOIN membros mb2 ON mb2.crm_user_id = u.m_author AND mb2.conta_id = v_conta
    LEFT JOIN profiles p2 ON p2.id = u.m_author
    LEFT JOIN nao_lidas nl ON nl.c_id = m.c_id
   ORDER BY u.m_created_at DESC NULLS LAST, m.c_id DESC;
END;
$$;

-- ============ FEED DE UMA CONVERSA ============
CREATE OR REPLACE FUNCTION get_equipe_mensagens(
  p_conversa_id bigint,
  p_before      timestamptz DEFAULT NULL,
  p_before_id   bigint      DEFAULT NULL,
  p_limit       int         DEFAULT 50
)
RETURNS TABLE (
  id                bigint,
  conversa_id       bigint,
  author_user_id    uuid,
  author_name       text,
  author_avatar_url text,
  content           text,
  created_at        timestamptz,
  anexos            jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL OR NOT EXISTS (
    SELECT 1 FROM equipe_conversa_participantes pt
      JOIN equipe_conversas ec ON ec.id = pt.conversa_id
     WHERE pt.conversa_id = p_conversa_id
       AND pt.user_id = v_uid AND ec.conta_id = v_conta
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT em.id, em.conversa_id, em.author_user_id,
         COALESCE(mb.nome, p.nome, 'Equipe'),
         COALESCE(mb.avatar_url, p.avatar_url),
         em.content, em.created_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', ax.id, 'file_name', ax.file_name,
                    'mime_type', ax.mime_type, 'size_bytes', ax.size_bytes)
                  ORDER BY ax.id)
             FROM equipe_mensagem_anexos ax
            WHERE ax.mensagem_id = em.id
         ), '[]'::jsonb)
    FROM equipe_mensagens em
    LEFT JOIN membros mb ON mb.crm_user_id = em.author_user_id AND mb.conta_id = v_conta
    LEFT JOIN profiles p ON p.id = em.author_user_id
   WHERE em.conversa_id = p_conversa_id
     -- Cursor keyset composto (created_at, id): now() e estavel por
     -- transacao, entao irmaos de batch compartilham created_at.
     AND (
       p_before IS NULL
       OR em.created_at < p_before
       OR (p_before_id IS NOT NULL AND em.created_at = p_before AND em.id < p_before_id)
     )
   ORDER BY em.created_at DESC, em.id DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;

-- ============ CRIAR CONVERSA ============
CREATE OR REPLACE FUNCTION create_equipe_conversa(
  p_tipo     text,
  p_nome     text,
  p_user_ids uuid[]
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_role  text;
  v_id    bigint;
  v_key   text;
  v_todos uuid[];
  v_validos int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'No active workspace';
  END IF;
  SELECT wm.role INTO v_role FROM workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_tipo = 'dm' THEN
    IF array_length(p_user_ids, 1) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'dm exige exatamente 1 destinatario';
    END IF;
    IF p_user_ids[1] = v_uid THEN
      RAISE EXCEPTION 'dm consigo mesmo nao e permitida';
    END IF;
    -- Destinatario tem que ser membro do workspace.
    IF NOT EXISTS (
      SELECT 1 FROM workspace_members wm
       WHERE wm.workspace_id = v_conta AND wm.user_id = p_user_ids[1]
    ) THEN
      RAISE EXCEPTION 'destinatario fora do workspace';
    END IF;

    v_key := least(v_uid::text, p_user_ids[1]::text) || ':' ||
             greatest(v_uid::text, p_user_ids[1]::text);
    -- Corrida de criacao simultanea: ON CONFLICT DO NOTHING + SELECT devolve
    -- a MESMA linha para os dois callers, nunca unique_violation.
    INSERT INTO equipe_conversas (conta_id, tipo, dm_key, created_by)
    VALUES (v_conta, 'dm', v_key, v_uid)
    ON CONFLICT (conta_id, dm_key) WHERE tipo = 'dm' DO NOTHING;
    SELECT ec.id INTO v_id FROM equipe_conversas ec
     WHERE ec.conta_id = v_conta AND ec.tipo = 'dm' AND ec.dm_key = v_key;
    -- Participantes idempotentes (o perdedor da corrida re-insere sem erro).
    INSERT INTO equipe_conversa_participantes (conversa_id, conta_id, user_id)
    VALUES (v_id, v_conta, v_uid), (v_id, v_conta, p_user_ids[1])
    ON CONFLICT (conversa_id, user_id) DO NOTHING;
    RETURN v_id;
  END IF;

  IF p_tipo = 'grupo' THEN
    IF v_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'apenas owner/admin cria grupos';
    END IF;
    IF p_nome IS NULL OR char_length(btrim(p_nome)) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'nome invalido';
    END IF;
    -- Criador sempre participa; dedup + valida TODOS contra workspace_members.
    SELECT array_agg(DISTINCT u) INTO v_todos
      FROM unnest(p_user_ids || v_uid) AS u;
    SELECT count(*) INTO v_validos FROM workspace_members wm
     WHERE wm.workspace_id = v_conta AND wm.user_id = ANY (v_todos);
    IF v_validos IS DISTINCT FROM array_length(v_todos, 1) THEN
      RAISE EXCEPTION 'participante fora do workspace';
    END IF;

    INSERT INTO equipe_conversas (conta_id, tipo, nome, created_by)
    VALUES (v_conta, 'grupo', btrim(p_nome), v_uid)
    RETURNING equipe_conversas.id INTO v_id;
    INSERT INTO equipe_conversa_participantes (conversa_id, conta_id, user_id)
    SELECT v_id, v_conta, u FROM unnest(v_todos) AS u;
    RETURN v_id;
  END IF;

  RAISE EXCEPTION 'tipo invalido: %', p_tipo;
END;
$$;

-- ============ GERIR CONVERSA (so grupos) ============
CREATE OR REPLACE FUNCTION manage_equipe_conversa(
  p_conversa_id bigint,
  p_action      text,
  p_nome        text DEFAULT NULL,
  p_user_id     uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_role  text;
  v_tipo  text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  SELECT ec.tipo INTO v_tipo FROM equipe_conversas ec
   WHERE ec.id = p_conversa_id AND ec.conta_id = v_conta;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'conversa nao encontrada';
  END IF;
  IF v_tipo <> 'grupo' THEN
    RAISE EXCEPTION 'dm nao tem gestao';
  END IF;
  SELECT wm.role INTO v_role FROM workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_action = 'leave' THEN
    -- Qualquer participante sai de si mesmo.
    DELETE FROM equipe_conversa_participantes pt
     WHERE pt.conversa_id = p_conversa_id AND pt.user_id = v_uid;
    RETURN;
  END IF;

  -- rename/add/remove: so owner/admin.
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'apenas owner/admin gerencia grupos';
  END IF;

  IF p_action = 'rename' THEN
    IF p_nome IS NULL OR char_length(btrim(p_nome)) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'nome invalido';
    END IF;
    UPDATE equipe_conversas ec SET nome = btrim(p_nome)
     WHERE ec.id = p_conversa_id;
  ELSIF p_action = 'add' THEN
    IF p_user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM workspace_members wm
       WHERE wm.workspace_id = v_conta AND wm.user_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'participante fora do workspace';
    END IF;
    INSERT INTO equipe_conversa_participantes (conversa_id, conta_id, user_id)
    VALUES (p_conversa_id, v_conta, p_user_id)
    ON CONFLICT (conversa_id, user_id) DO NOTHING;
  ELSIF p_action = 'remove' THEN
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'p_user_id obrigatorio';
    END IF;
    DELETE FROM equipe_conversa_participantes pt
     WHERE pt.conversa_id = p_conversa_id AND pt.user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'acao invalida: %', p_action;
  END IF;
END;
$$;

-- ============ MARK SEEN (high-water mark) ============
CREATE OR REPLACE FUNCTION mark_equipe_conversa_seen(
  p_conversa_id     bigint,
  p_last_message_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  -- GREATEST: nunca regride (dois marks fora de ordem nao "des-leem").
  UPDATE equipe_conversa_participantes pt
     SET last_seen_message_id = GREATEST(pt.last_seen_message_id, COALESCE(p_last_message_id, 0))
   WHERE pt.conversa_id = p_conversa_id
     AND pt.user_id = v_uid
     AND pt.conta_id = v_conta;
END;
$$;

-- ============ UNREAD TOTAL (badge) ============
CREATE OR REPLACE FUNCTION get_equipe_chat_unread()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid := auth.uid();
  v_n     bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN RETURN 0; END IF;
  SELECT COALESCE(sum(sub.n), 0) INTO v_n FROM (
    SELECT count(*)::bigint AS n
      FROM equipe_conversa_participantes pt
      JOIN equipe_mensagens em ON em.conversa_id = pt.conversa_id
     WHERE pt.user_id = v_uid AND pt.conta_id = v_conta
       AND em.id > pt.last_seen_message_id
       AND em.author_user_id <> v_uid
     GROUP BY pt.conversa_id
  ) sub;
  RETURN v_n;
END;
$$;

-- ============ MEMBROS DO WORKSPACE (picker) ============
CREATE OR REPLACE FUNCTION get_equipe_chat_members()
RETURNS TABLE (
  user_id    uuid,
  nome       text,
  avatar_url text,
  role       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT wm.user_id,
         COALESCE(mb.nome, p.nome,
                  u.raw_user_meta_data->>'full_name', u.email::text),
         COALESCE(mb.avatar_url, p.avatar_url),
         wm.role
    FROM workspace_members wm
    LEFT JOIN membros mb ON mb.crm_user_id = wm.user_id AND mb.conta_id = v_conta
    LEFT JOIN profiles p ON p.id = wm.user_id
    LEFT JOIN auth.users u ON u.id = wm.user_id
   WHERE wm.workspace_id = v_conta
   ORDER BY 2;
END;
$$;

-- ============ ENVIAR MENSAGEM (caminho unico do composer) ============
CREATE OR REPLACE FUNCTION send_equipe_mensagem(
  p_conversa_id bigint,
  p_content     text,
  p_anexo_ids   bigint[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta   uuid;
  v_uid     uuid := auth.uid();
  v_content text;
  v_id      bigint;
  v_linked  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL OR NOT EXISTS (
    SELECT 1 FROM equipe_conversa_participantes pt
      JOIN equipe_conversas ec ON ec.id = pt.conversa_id
     WHERE pt.conversa_id = p_conversa_id
       AND pt.user_id = v_uid AND ec.conta_id = v_conta
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  v_content := COALESCE(btrim(p_content), '');
  IF char_length(v_content) > 4000 THEN
    RAISE EXCEPTION 'content muito longo';
  END IF;
  IF v_content = '' AND (p_anexo_ids IS NULL OR array_length(p_anexo_ids, 1) IS NULL) THEN
    RAISE EXCEPTION 'texto ou anexo obrigatorio';
  END IF;

  INSERT INTO equipe_mensagens (conversa_id, conta_id, author_user_id, content)
  VALUES (p_conversa_id, v_conta, v_uid, v_content)
  RETURNING equipe_mensagens.id INTO v_id;

  IF p_anexo_ids IS NOT NULL AND array_length(p_anexo_ids, 1) IS NOT NULL THEN
    -- So liga anexos staged DO caller NESTA conversa; o lock de linha
    -- serializa contra o release do cron. Contagem diferente = algum anexo
    -- ja foi varrido ou nao e do caller: aborta tudo (rollback da mensagem).
    UPDATE equipe_mensagem_anexos ax
       SET mensagem_id = v_id
     WHERE ax.id = ANY (p_anexo_ids)
       AND ax.mensagem_id IS NULL
       AND ax.created_by = v_uid
       AND ax.conversa_id = p_conversa_id;
    GET DIAGNOSTICS v_linked = ROW_COUNT;
    IF v_linked IS DISTINCT FROM array_length(p_anexo_ids, 1) THEN
      RAISE EXCEPTION 'anexo_not_found';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ============ GRANTS ============
REVOKE ALL ON FUNCTION get_equipe_conversas() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_equipe_conversas() TO authenticated;
REVOKE ALL ON FUNCTION get_equipe_mensagens(bigint, timestamptz, bigint, int) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_equipe_mensagens(bigint, timestamptz, bigint, int) TO authenticated;
REVOKE ALL ON FUNCTION create_equipe_conversa(text, text, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_equipe_conversa(text, text, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION manage_equipe_conversa(bigint, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION manage_equipe_conversa(bigint, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION mark_equipe_conversa_seen(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mark_equipe_conversa_seen(bigint, bigint) TO authenticated;
REVOKE ALL ON FUNCTION get_equipe_chat_unread() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_equipe_chat_unread() TO authenticated;
REVOKE ALL ON FUNCTION get_equipe_chat_members() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_equipe_chat_members() TO authenticated;
REVOKE ALL ON FUNCTION send_equipe_mensagem(bigint, text, bigint[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION send_equipe_mensagem(bigint, text, bigint[]) TO authenticated, service_role;
```

- [ ] **Step 2: Escrever o teste de entitlements**

Crie `supabase/tests/entitlements/73_equipe_chat_rpcs.sql` (mesma estrutura da 72: helpers, hosted parity, um bloco por cenário, sempre com flag ON via override). Para RPC basta o claims (`set_config('request.jwt.claims', ...)`) sem trocar de role, mas troque mesmo assim para manter o padrão. Cenários e asserts:

1. **DM idempotente**: `create_equipe_conversa('dm', null, array[v_b])` chamado por v_a duas vezes devolve o MESMO id; chamado por v_b com array[v_a] devolve o mesmo id de novo; `dm consigo mesmo` (array[v_a] por v_a) levanta exceção; destinatário de fora do workspace levanta `destinatario fora do workspace`.
2. **Grupo e papel**: agent chamando `create_equipe_conversa('grupo', 'Time', array[v_b])` levanta `apenas owner/admin cria grupos`; admin cria e a conversa tem criador + convidados como participantes (assert via count na tabela); `p_user_ids` com uuid de fora do workspace levanta `participante fora do workspace`.
3. **manage**: agent participante consegue `leave` (linha some); agent tentando `rename` levanta `apenas owner/admin gerencia grupos`; admin faz `rename`/`add`/`remove` com sucesso; `add` de uuid fora do workspace levanta exceção; `manage` numa DM levanta `dm nao tem gestao`.
4. **seen + unread**: v_a manda 3 mensagens; `get_equipe_chat_unread()` como v_b = 3; `mark_equipe_conversa_seen(conv, id_da_2a)` como v_b → unread = 1; mark com id menor (o da 1a) não regride (continua 1); mensagens do PRÓPRIO v_b nunca contam.
5. **get_equipe_mensagens**: não-participante levanta `Forbidden`; participante recebe as mensagens em ordem desc com `author_name` resolvido; cursor (p_before/p_before_id da mais antiga da página) devolve a página anterior sem repetir.
6. **send_equipe_mensagem**: participante envia e recebe id; content vazio sem anexos levanta `texto ou anexo obrigatorio`; não-participante levanta `Forbidden`; com `p_anexo_ids` de anexo inexistente levanta `anexo_not_found` e NENHUMA mensagem fica gravada (assert count).

- [ ] **Step 3: Rodar o teste (condicional a stack local)**

Run: `npx supabase status 2>/dev/null | grep -q 'API URL' && (npx supabase db reset >/dev/null && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/72_equipe_chat_core.sql -f supabase/tests/entitlements/73_equipe_chat_rpcs.sql) || echo 'SKIP: sem Supabase local; CI cobre'`
Expected: todos os PASS, exit 0 (ou SKIP).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260902121000_equipe_chat_rpcs.sql supabase/tests/entitlements/73_equipe_chat_rpcs.sql
git commit -m "feat(equipe-chat): RPCs de conversas, mensagens, gestao e unread"
```

---

### Task 3: Migration C — RPCs de anexos com quota

**Files:**
- Create: `supabase/migrations/20260902122000_equipe_chat_anexos_rpcs.sql`
- Create: `supabase/tests/entitlements/74_equipe_chat_anexos.sql`

**Interfaces:**
- Consumes: `equipe_mensagem_anexos` (Task 1), `effective_plan_limit(ws_id, 'storage_quota_bytes')`, `workspaces.storage_used_bytes`.
- Produces (a edge function da Task 6 e o cron da Task 7 chamam via service role):
  - `equipe_chat_anexo_finalize(p jsonb)` → TABLE(anexo_id bigint, r2_key text, file_name text, mime_type text, size_bytes bigint) — p carrega `{conta_id, conversa_id, created_by, r2_key, file_name, mime_type, size_bytes}`
  - `equipe_chat_anexo_release(p_anexo_id bigint)` → text (r2_key liberada, ou NULL se a linha já não estava staged)

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260902122000_equipe_chat_anexos_rpcs.sql
-- Finalize/release de anexos do chat de equipe. Padrao
-- ideia_file_insert_with_quota / automation_media_finalize: lock no
-- workspace, quota checada e cobrada NA MESMA transacao do insert; release
-- estorna simetricamente. Chamadas exclusivamente pelo service role (edge
-- function equipe-chat-media e post-media-cleanup-cron).

CREATE OR REPLACE FUNCTION equipe_chat_anexo_finalize(p jsonb)
RETURNS TABLE (
  anexo_id   bigint,
  r2_key     text,
  file_name  text,
  mime_type  text,
  size_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta    uuid   := (p->>'conta_id')::uuid;
  v_conversa bigint := (p->>'conversa_id')::bigint;
  v_by       uuid   := (p->>'created_by')::uuid;
  v_key      text   := p->>'r2_key';
  v_size     bigint := (p->>'size_bytes')::bigint;
  v_quota    bigint;
  v_used     bigint;
  v_row      equipe_mensagem_anexos;
BEGIN
  -- Prefixo da key validado server-side contra o tenant (nunca confiar no
  -- caller): impede finalize de key de outro workspace.
  IF v_key NOT LIKE 'equipe-chat/' || v_conta::text || '/%' THEN
    RAISE EXCEPTION 'invalid_key' USING errcode = 'P0001';
  END IF;
  IF v_size IS NULL OR v_size <= 0 THEN
    RAISE EXCEPTION 'invalid_size' USING errcode = 'P0001';
  END IF;
  -- Conversa do workspace + criador participante (a edge ja checou; aqui e o
  -- cinto de seguranca transacional).
  IF NOT EXISTS (
    SELECT 1 FROM equipe_conversas ec
     WHERE ec.id = v_conversa AND ec.conta_id = v_conta
  ) OR NOT EXISTS (
    SELECT 1 FROM equipe_conversa_participantes pt
     WHERE pt.conversa_id = v_conversa AND pt.user_id = v_by
  ) THEN
    RAISE EXCEPTION 'conversa_not_found' USING errcode = 'P0001';
  END IF;

  -- Retry idempotente (resposta perdida): a key ja finalizada devolve a
  -- linha existente sem cobrar quota de novo.
  SELECT ax.* INTO v_row FROM equipe_mensagem_anexos ax WHERE ax.r2_key = v_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.r2_key, v_row.file_name,
                        v_row.mime_type, v_row.size_bytes;
    RETURN;
  END IF;

  -- Lock serializa finalizes concorrentes do mesmo workspace (quota correta).
  SELECT w.storage_used_bytes INTO v_used FROM workspaces w
   WHERE w.id = v_conta FOR UPDATE;
  v_quota := effective_plan_limit(v_conta, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND COALESCE(v_used, 0) + v_size > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded' USING errcode = 'P0001';
  END IF;

  INSERT INTO equipe_mensagem_anexos
    (conta_id, conversa_id, mensagem_id, r2_key, file_name, mime_type, size_bytes, created_by)
  VALUES
    (v_conta, v_conversa, NULL, v_key, p->>'file_name', p->>'mime_type', v_size, v_by)
  RETURNING equipe_mensagem_anexos.* INTO v_row;

  UPDATE workspaces w SET storage_used_bytes = COALESCE(w.storage_used_bytes, 0) + v_size
   WHERE w.id = v_conta;

  RETURN QUERY SELECT v_row.id, v_row.r2_key, v_row.file_name,
                      v_row.mime_type, v_row.size_bytes;
END;
$$;

-- Release de staged (cron): apaga a linha SE ainda estiver staged e estorna
-- a quota na mesma transacao. Devolve a r2_key para o caller trashear no R2,
-- ou NULL se o envio ganhou a corrida (mensagem_id preenchido) ou a linha
-- ja sumiu.
CREATE OR REPLACE FUNCTION equipe_chat_anexo_release(p_anexo_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row equipe_mensagem_anexos;
BEGIN
  DELETE FROM equipe_mensagem_anexos ax
   WHERE ax.id = p_anexo_id AND ax.mensagem_id IS NULL
  RETURNING ax.* INTO v_row;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE workspaces w
     SET storage_used_bytes = GREATEST(COALESCE(w.storage_used_bytes, 0) - v_row.size_bytes, 0)
   WHERE w.id = v_row.conta_id;
  RETURN v_row.r2_key;
END;
$$;

REVOKE ALL ON FUNCTION equipe_chat_anexo_finalize(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION equipe_chat_anexo_finalize(jsonb) TO service_role;
REVOKE ALL ON FUNCTION equipe_chat_anexo_release(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION equipe_chat_anexo_release(bigint) TO service_role;
```

- [ ] **Step 2: Escrever o teste de entitlements**

Crie `supabase/tests/entitlements/74_equipe_chat_anexos.sql` (mesma estrutura; flag ON via override; os blocos rodam como postgres — as RPCs são service-only). Cenários:

1. **Finalize cobra quota**: workspace com `storage_used_bytes = 0`; finalize de um anexo de 1000 bytes cria a linha staged e `workspaces.storage_used_bytes = 1000`; segundo finalize da MESMA key devolve o mesmo `anexo_id` e NÃO cobra de novo (used continua 1000).
2. **Quota estoura**: com `resource_overrides` limitando `storage_quota_bytes` a 1500 (via `workspace_plan_overrides.resource_overrides`), finalize de 1000 passa e o segundo de 1000 levanta `quota_exceeded` (used fica 1000).
3. **Key inválida**: prefixo de outro conta_id levanta `invalid_key`; conversa de outro workspace levanta `conversa_not_found`; criador não-participante levanta `conversa_not_found`.
4. **Release estorna**: release de staged devolve a r2_key, apaga a linha e `storage_used_bytes` volta a 0; release do mesmo id de novo devolve NULL; anexo já ligado a mensagem (`send_equipe_mensagem` com `p_anexo_ids`) devolve NULL e a linha fica.
5. **Corrida send vs release**: anexo staged; `send_equipe_mensagem` liga; release em seguida devolve NULL (linha preservada). Inverso: release primeiro; send com aquele id levanta `anexo_not_found` e não grava mensagem.

- [ ] **Step 3: Rodar (condicional) e commitar**

Run: `npx supabase status 2>/dev/null | grep -q 'API URL' && (npx supabase db reset >/dev/null && for f in 72 73 74; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/${f}_*.sql; done) || echo 'SKIP: sem Supabase local; CI cobre'`
Expected: todos os PASS (ou SKIP).

```bash
git add supabase/migrations/20260902122000_equipe_chat_anexos_rpcs.sql supabase/tests/entitlements/74_equipe_chat_anexos.sql
git commit -m "feat(equipe-chat): finalize/release de anexos com quota transacional"
```

---

### Task 4: Plumbing da flag `feature_team_chat` (4 listas fechadas + gate de rota)

**Files:**
- Modify: `supabase/functions/_shared/entitlements.ts` (array `FEATURE_COLUMNS`)
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts` (interface `FeatureFlags`)
- Modify: `apps/admin/src/lib/api.ts` (`FEATURE_FLAG_KEYS` + `FEATURE_FLAG_LABELS`)
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx`
- Modify: `apps/crm/src/components/layout/nav-data.ts` (mapa de flags do item `mensagens`)
- Test: `apps/crm/src/components/layout/__tests__/ProtectedRoute.test.tsx` (casos novos)
- Test: grep nos testes existentes que enumeram flags (`supabase/functions/__tests__/entitlements-shared_test.ts`, `apps/**` — mudança de contrato atualiza AMBAS as suítes)

**Interfaces:**
- Consumes: resposta `{plan_name, limits, features}` do `workspace-limits`.
- Produces: `features.feature_team_chat: boolean` disponível em todo o CRM via `useWorkspaceLimits()`; `/mensagens` liberado quando `feature_mensagens OU feature_team_chat`; item de nav idem. Tasks 8-11 dependem de `features?.feature_team_chat === true`.

- [ ] **Step 1: Adicionar a coluna nas 4 listas**

Em `_shared/entitlements.ts`, acrescente `"feature_team_chat"` ao final do array `FEATURE_COLUMNS`. Em `useWorkspaceLimits.ts`, acrescente `feature_team_chat: boolean;` à interface `FeatureFlags`. Em `apps/admin/src/lib/api.ts`, acrescente `'feature_team_chat'` a `FEATURE_FLAG_KEYS` e `feature_team_chat: 'Chat da equipe'` a `FEATURE_FLAG_LABELS`.

- [ ] **Step 2: Gate de rota either-flag**

Em `ProtectedRoute.tsx`: remova a entrada `'/mensagens'` do objeto `FEATURE_GATED` e adicione, logo antes do loop de `FEATURE_GATED`, um caso especial:

```tsx
  // /mensagens abriga dois recursos gateados separadamente (chat com
  // clientes + chat de equipe): bloqueia so quando AMBAS as flags estao off.
  if (
    !isUnlimited &&
    features &&
    pathname.startsWith('/mensagens') &&
    features.feature_mensagens === false &&
    features.feature_team_chat === false
  ) {
    return <UpgradeLockedScreen featureLabel="Mensagens" feature="feature_mensagens" />;
  }
```

Em `nav-data.ts`: localize o mapa que associa `mensagens: 'feature_mensagens'` (linha ~227) e o código que o consome (grep pelo nome do mapa nos componentes de layout). Mude o tipo do valor para `string | string[]`, a entrada para `mensagens: ['feature_mensagens', 'feature_team_chat']`, e o consumo para tratar array com `.some((f) => features[f] !== false)` mantendo o comportamento atual para string. Rode o teste de Sidebar existente para confirmar que nada quebrou.

- [ ] **Step 3: Testes**

Atualize `ProtectedRoute.test.tsx` com dois casos novos seguindo o padrão dos existentes do arquivo: (a) `feature_mensagens=false, feature_team_chat=true` em `/mensagens` renderiza a página (não o UpgradeLockedScreen); (b) ambas false renderiza o UpgradeLockedScreen. Depois grep de contrato: `grep -rn "feature_mensagens" apps/ supabase/functions/__tests__/ | grep -i test` e atualize qualquer teste que enumere a lista de flags (ex.: paridade de colunas em `entitlements-shared_test.ts` — se ele deriva da constante, nada a fazer; se enumera, acrescente).

- [ ] **Step 4: Rodar e commitar**

Run: `npm run test -- ProtectedRoute` e `npm run test:functions -- --filter entitlements` (o `--filter` do deno casa por NOME de teste; se não casar nada, rode `npm run test:functions` inteiro). Depois `npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit`.
Expected: verde nos quatro.

```bash
git add supabase/functions/_shared/entitlements.ts apps/crm/src/hooks/useWorkspaceLimits.ts apps/admin/src/lib/api.ts apps/crm/src/components/layout/ProtectedRoute.tsx apps/crm/src/components/layout/nav-data.ts apps/crm/src/components/layout/__tests__/
git commit -m "feat(equipe-chat): flag feature_team_chat nas listas de entitlements e gate either-flag em /mensagens"
```

Nota de rollout (não é passo): a flag só chega ao cliente após **redeploy de `workspace-limits`** — está na task de verificação final e no spec.

---

### Task 5: Store `equipeChat.ts` (tipos + wrappers de RPC)

**Files:**
- Create: `apps/crm/src/store/equipeChat.ts`
- Modify: `apps/crm/src/store/index.ts` (acrescentar `export * from './equipeChat';`)
- Test: `apps/crm/src/__tests__/store.equipeChat.test.ts`

**Interfaces:**
- Consumes: RPCs da Task 2 (nomes/params exatos), `supabase` de `./core`.
- Produces (Tasks 8-11 importam de `@/store`):

```ts
export interface EquipeConversa {
  conversa_id: number;
  tipo: 'grupo' | 'dm';
  nome: string | null;
  display_nome: string;
  avatar_url: string | null;
  participantes_count: number;
  last_author_name: string | null;
  last_content: string | null;
  last_has_anexo: boolean;
  last_created_at: string | null;
  last_message_id: number | null;
  unread_count: number;
}
export interface EquipeMensagemAnexo {
  id: number; file_name: string; mime_type: string; size_bytes: number;
}
export interface EquipeMensagem {
  id: number; conversa_id: number; author_user_id: string;
  author_name: string; author_avatar_url: string | null;
  content: string; created_at: string; anexos: EquipeMensagemAnexo[];
}
export interface EquipeChatMember {
  user_id: string; nome: string; avatar_url: string | null; role: string;
}
export interface EquipeMensagensCursor { before: string; beforeId: number; }
```

- [ ] **Step 1: Escrever o teste (padrão `store.mentions.test.ts`: mock de `@/lib/supabase`, `__queueSupabaseRpc`, assert do payload da chamada)**

```ts
// apps/crm/src/__tests__/store.equipeChat.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/lib/supabase');
import * as mockedSupabase from '@/lib/supabase';
import {
  getEquipeConversas, getEquipeMensagens, createEquipeConversa,
  manageEquipeConversa, markEquipeConversaSeen, getEquipeChatUnread,
  getEquipeChatMembers, sendEquipeMensagem,
} from '@/store/equipeChat';

type Mocked = typeof mockedSupabase & {
  __resetSupabaseMock: () => void;
  __queueSupabaseRpc: (name: string, ...r: { data: unknown; error: unknown }[]) => void;
  __getSupabaseCalls: () => Array<{ table: string; operation: string; payload: unknown }>;
};
const m = mockedSupabase as unknown as Mocked;

function rpcCalls(name: string) {
  return m.__getSupabaseCalls().filter((c) => c.table === `rpc:${name}`);
}

beforeEach(() => m.__resetSupabaseMock());

describe('store/equipeChat', () => {
  it('getEquipeConversas devolve as linhas da RPC', async () => {
    const row = {
      conversa_id: 1, tipo: 'grupo', nome: 'Time', display_nome: 'Time',
      avatar_url: null, participantes_count: 3, last_author_name: 'Ana',
      last_content: 'oi', last_has_anexo: false,
      last_created_at: '2026-09-02T10:00:00Z', last_message_id: 9, unread_count: 2,
    };
    m.__queueSupabaseRpc('get_equipe_conversas', { data: [row], error: null });
    expect(await getEquipeConversas()).toEqual([row]);
  });

  it('getEquipeMensagens passa o cursor composto', async () => {
    m.__queueSupabaseRpc('get_equipe_mensagens', { data: [], error: null });
    await getEquipeMensagens({
      conversaId: 7,
      cursor: { before: '2026-09-01T00:00:00Z', beforeId: 5 },
    });
    expect(rpcCalls('get_equipe_mensagens').at(-1)!.payload).toEqual({
      p_conversa_id: 7,
      p_before: '2026-09-01T00:00:00Z',
      p_before_id: 5,
      p_limit: 50,
    });
  });

  it('getEquipeMensagens sem cursor omite os params de before', async () => {
    m.__queueSupabaseRpc('get_equipe_mensagens', { data: [], error: null });
    await getEquipeMensagens({ conversaId: 7 });
    expect(rpcCalls('get_equipe_mensagens').at(-1)!.payload).toEqual({
      p_conversa_id: 7,
      p_limit: 50,
    });
  });

  it('createEquipeConversa dm devolve o id', async () => {
    m.__queueSupabaseRpc('create_equipe_conversa', { data: 42, error: null });
    expect(await createEquipeConversa('dm', null, ['uid-b'])).toBe(42);
    expect(rpcCalls('create_equipe_conversa').at(-1)!.payload).toEqual({
      p_tipo: 'dm', p_nome: null, p_user_ids: ['uid-b'],
    });
  });

  it('manageEquipeConversa monta o payload da acao', async () => {
    m.__queueSupabaseRpc('manage_equipe_conversa', { data: null, error: null });
    await manageEquipeConversa(3, 'add', { userId: 'uid-c' });
    expect(rpcCalls('manage_equipe_conversa').at(-1)!.payload).toEqual({
      p_conversa_id: 3, p_action: 'add', p_nome: null, p_user_id: 'uid-c',
    });
  });

  it('markEquipeConversaSeen envia o high-water mark', async () => {
    m.__queueSupabaseRpc('mark_equipe_conversa_seen', { data: null, error: null });
    await markEquipeConversaSeen(3, 99);
    expect(rpcCalls('mark_equipe_conversa_seen').at(-1)!.payload).toEqual({
      p_conversa_id: 3, p_last_message_id: 99,
    });
  });

  it('getEquipeChatUnread devolve o total', async () => {
    m.__queueSupabaseRpc('get_equipe_chat_unread', { data: 5, error: null });
    expect(await getEquipeChatUnread()).toBe(5);
  });

  it('getEquipeChatMembers devolve a lista', async () => {
    const member = { user_id: 'u1', nome: 'Ana', avatar_url: null, role: 'admin' };
    m.__queueSupabaseRpc('get_equipe_chat_members', { data: [member], error: null });
    expect(await getEquipeChatMembers()).toEqual([member]);
  });

  it('sendEquipeMensagem envia anexos e devolve o id', async () => {
    m.__queueSupabaseRpc('send_equipe_mensagem', { data: 11, error: null });
    expect(await sendEquipeMensagem(3, 'oi', [8, 9])).toBe(11);
    expect(rpcCalls('send_equipe_mensagem').at(-1)!.payload).toEqual({
      p_conversa_id: 3, p_content: 'oi', p_anexo_ids: [8, 9],
    });
  });

  it('propaga erro da RPC', async () => {
    m.__queueSupabaseRpc('send_equipe_mensagem', {
      data: null, error: { message: 'Forbidden' },
    });
    await expect(sendEquipeMensagem(3, 'oi')).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- store.equipeChat`
Expected: FAIL (módulo `@/store/equipeChat` não existe).

- [ ] **Step 3: Implementar o store**

```ts
// apps/crm/src/store/equipeChat.ts
import { supabase } from './core';

export interface EquipeConversa {
  conversa_id: number;
  tipo: 'grupo' | 'dm';
  nome: string | null;
  /** Grupo: nome do grupo; DM: nome do colega. */
  display_nome: string;
  /** DM: avatar do colega; grupo: NULL. */
  avatar_url: string | null;
  participantes_count: number;
  last_author_name: string | null;
  last_content: string | null;
  last_has_anexo: boolean;
  /** NULL quando a conversa ainda nao tem mensagens. */
  last_created_at: string | null;
  last_message_id: number | null;
  unread_count: number;
}

export interface EquipeMensagemAnexo {
  id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface EquipeMensagem {
  id: number;
  conversa_id: number;
  author_user_id: string;
  author_name: string;
  author_avatar_url: string | null;
  content: string;
  created_at: string;
  anexos: EquipeMensagemAnexo[];
}

export interface EquipeChatMember {
  user_id: string;
  nome: string;
  avatar_url: string | null;
  role: string;
}

export interface EquipeMensagensCursor {
  before: string;
  beforeId: number;
}

const PAGE_SIZE = 50;

export async function getEquipeConversas(): Promise<EquipeConversa[]> {
  const { data, error } = await supabase.rpc('get_equipe_conversas', {});
  if (error) throw error;
  return (data ?? []) as EquipeConversa[];
}

export async function getEquipeMensagens(params: {
  conversaId: number;
  cursor?: EquipeMensagensCursor;
  limit?: number;
}): Promise<EquipeMensagem[]> {
  const rpcParams: Record<string, unknown> = {
    p_conversa_id: params.conversaId,
    p_limit: params.limit ?? PAGE_SIZE,
  };
  if (params.cursor) {
    rpcParams.p_before = params.cursor.before;
    rpcParams.p_before_id = params.cursor.beforeId;
  }
  const { data, error } = await supabase.rpc('get_equipe_mensagens', rpcParams);
  if (error) throw error;
  return (data ?? []) as EquipeMensagem[];
}

export async function createEquipeConversa(
  tipo: 'grupo' | 'dm',
  nome: string | null,
  userIds: string[],
): Promise<number> {
  const { data, error } = await supabase.rpc('create_equipe_conversa', {
    p_tipo: tipo,
    p_nome: nome,
    p_user_ids: userIds,
  });
  if (error) throw error;
  return data as number;
}

export type EquipeConversaAction = 'rename' | 'add' | 'remove' | 'leave';

export async function manageEquipeConversa(
  conversaId: number,
  action: EquipeConversaAction,
  opts: { nome?: string; userId?: string } = {},
): Promise<void> {
  const { error } = await supabase.rpc('manage_equipe_conversa', {
    p_conversa_id: conversaId,
    p_action: action,
    p_nome: opts.nome ?? null,
    p_user_id: opts.userId ?? null,
  });
  if (error) throw error;
}

export async function markEquipeConversaSeen(
  conversaId: number,
  lastMessageId: number,
): Promise<void> {
  const { error } = await supabase.rpc('mark_equipe_conversa_seen', {
    p_conversa_id: conversaId,
    p_last_message_id: lastMessageId,
  });
  if (error) throw error;
}

export async function getEquipeChatUnread(): Promise<number> {
  const { data, error } = await supabase.rpc('get_equipe_chat_unread', {});
  if (error) throw error;
  return (data ?? 0) as number;
}

export async function getEquipeChatMembers(): Promise<EquipeChatMember[]> {
  const { data, error } = await supabase.rpc('get_equipe_chat_members', {});
  if (error) throw error;
  return (data ?? []) as EquipeChatMember[];
}

export async function sendEquipeMensagem(
  conversaId: number,
  content: string,
  anexoIds?: number[],
): Promise<number> {
  const { data, error } = await supabase.rpc('send_equipe_mensagem', {
    p_conversa_id: conversaId,
    p_content: content,
    p_anexo_ids: anexoIds && anexoIds.length > 0 ? anexoIds : null,
  });
  if (error) throw error;
  return data as number;
}
```

Acrescente `export * from './equipeChat';` em `apps/crm/src/store/index.ts` (junto dos outros `export *`).

Atenção ao teste "sem cursor omite os params": o payload esperado NÃO tem `p_anexo_ids` nem `p_before` — se o mock registrar o payload com chaves ausentes vs `null`, alinhe o teste ao comportamento real do mock (o de `sendEquipeMensagem` sem anexos manda `p_anexo_ids: null`; ajuste o assert correspondente se você escrever um caso sem anexos).

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- store.equipeChat && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/equipeChat.ts apps/crm/src/store/index.ts apps/crm/src/__tests__/store.equipeChat.test.ts
git commit -m "feat(equipe-chat): store de conversas, mensagens e membros"
```

---

### Task 6: Edge function `equipe-chat-media` (presign tmp → finalize copy → GET assinado)

**Files:**
- Create: `supabase/functions/equipe-chat-media/handler.ts`
- Create: `supabase/functions/equipe-chat-media/index.ts`
- Modify: `supabase/config.toml` (entrada `[functions.equipe-chat-media]` com `verify_jwt = false`, junto das demais)
- Test: `supabase/functions/__tests__/equipe-chat-media_test.ts`

**Interfaces:**
- Consumes: `equipe_chat_anexo_finalize(p jsonb)` (Task 3), `_shared/r2.ts` (`signPutUrl`, `signGetUrl`, `headObjectSigned`, `copyObjectSigned`, `trashObject`), `_shared/cors.ts`, `_shared/http.ts` (`createJsonResponder`), `_shared/bounded-fetch.ts` (`makeBoundedFetch`), `_shared/entitlements.ts` (`resolveEntitlements`).
- Produces (a Task 8 chama por fetch):
  - `POST /equipe-chat-media/presign` body `{conversa_id, mime_type, size_bytes}` → `{upload_url, key}` (key tmp)
  - `POST /equipe-chat-media/finalize` body `{conversa_id, key, file_name, mime_type, size_bytes}` → `{anexo: {id, file_name, mime_type, size_bytes}}`
  - `POST /equipe-chat-media/anexo-url` body `{anexo_id}` → `{url}` (GET assinado ~10min)

- [ ] **Step 1: Escrever o teste Deno (padrão `automation-media_test.ts`: mock FIFO `createSupabaseQueryMock`, deps injetadas, `randomUUID` fixo)**

```ts
// supabase/functions/__tests__/equipe-chat-media_test.ts
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createEquipeChatMediaHandler } from "../equipe-chat-media/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

// deno-lint-ignore no-explicit-any
function makeHandler(db: any, opts?: {
  headObject?: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  copies?: Array<{ from: string; to: string }>;
  trashed?: string[];
}) {
  return createEquipeChatMediaHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: opts?.headObject ?? (async () => ({ contentLength: 5000, contentType: "image/jpeg" })),
    copyObject: async (from: string, to: string) => { opts?.copies?.push({ from, to }); },
    trashObject: async (key: string) => { opts?.trashed?.push(key); },
    randomUUID: () => "fixed-uuid",
  });
}

function req(route: string, body: unknown, token = "valid-jwt") {
  return new Request(`https://example.test/equipe-chat-media/${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// deno-lint-ignore no-explicit-any
function setupAuth(db: any, opts?: { participante?: boolean; featureEnabled?: boolean }) {
  const participante = opts?.participante ?? true;
  const featureEnabled = opts?.featureEnabled ?? true;
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1", role: "admin" }, error: null });
  // resolveEntitlements: workspaces -> overrides -> plans.
  db.queue("workspaces", "select", { data: { plan_id: "plan-1" }, error: null });
  db.queue("workspace_plan_overrides", "select", { data: null, error: null });
  db.queue("plans", "select", {
    data: { name: "Max", feature_team_chat: featureEnabled },
    error: null,
  });
  // Conversa do tenant + participacao do caller.
  db.queue("equipe_conversas", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("equipe_conversa_participantes", "select",
    { data: participante ? { id: 1 } : null, error: null });
}

Deno.test("presign: key no prefixo tmp do tenant", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.key, "equipe-chat-tmp/conta-1/fixed-uuid.jpg");
  assertEquals(body.upload_url, "https://put.example.com/equipe-chat-tmp/conta-1/fixed-uuid.jpg");
});

Deno.test("presign: mime fora da allowlist da 415", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "application/x-msdownload", size_bytes: 5000,
  }));
  assertEquals(res.status, 415);
});

Deno.test("presign: acima de 25MB da 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "image/png", size_bytes: 26 * 1024 * 1024,
  }));
  assertEquals(res.status, 400);
});

Deno.test("presign: nao-participante da 403", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, { participante: false });
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 403);
});

Deno.test("presign: feature off da 403", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, { featureEnabled: false });
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 403);
});

Deno.test("finalize: HEAD na tmp, copia p/ final, RPC, trash da tmp", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("equipe_chat_anexo_finalize", {
    data: { anexo_id: 8, r2_key: "equipe-chat/conta-1/fixed-uuid.jpg",
            file_name: "foto.jpg", mime_type: "image/jpeg", size_bytes: 5000 },
    error: null,
  });
  const copies: Array<{ from: string; to: string }> = [];
  const trashed: string[] = [];
  const res = await makeHandler(db, { copies, trashed })(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    file_name: "foto.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.anexo.id, 8);
  assertEquals(copies, [{
    from: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    to: "equipe-chat/conta-1/fixed-uuid.jpg",
  }]);
  assertEquals(trashed, ["equipe-chat-tmp/conta-1/fixed-uuid.jpg"]);
});

Deno.test("finalize: key fora do prefixo tmp do tenant da 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-OUTRA/x.jpg",
    file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 400);
});

Deno.test("finalize: objeto tmp ausente da 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db, { headObject: async () => null })(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 400);
});

Deno.test("finalize: size divergente da 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db, {
    headObject: async () => ({ contentLength: 999, contentType: "image/jpeg" }),
  })(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 400);
});

Deno.test("finalize: quota_exceeded da RPC vira 413", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("equipe_chat_anexo_finalize", {
    data: null, error: { message: "quota_exceeded" },
  });
  const res = await makeHandler(db, { copies: [], trashed: [] })(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 413);
});

Deno.test("anexo-url: participante recebe GET assinado", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1", role: "agent" }, error: null });
  db.queue("workspaces", "select", { data: { plan_id: "plan-1" }, error: null });
  db.queue("workspace_plan_overrides", "select", { data: null, error: null });
  db.queue("plans", "select", { data: { name: "Max", feature_team_chat: true }, error: null });
  // Anexo do tenant com a conversa; depois a participacao.
  db.queue("equipe_mensagem_anexos", "select", {
    data: { id: 8, conta_id: "conta-1", conversa_id: 7,
            r2_key: "equipe-chat/conta-1/fixed-uuid.jpg" },
    error: null,
  });
  db.queue("equipe_conversa_participantes", "select", { data: { id: 1 }, error: null });
  const res = await makeHandler(db)(req("anexo-url", { anexo_id: 8 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.url, "https://get.example.com/equipe-chat/conta-1/fixed-uuid.jpg");
});

Deno.test("sem Authorization da 401", async () => {
  const db = createSupabaseQueryMock();
  const r = new Request("https://example.test/equipe-chat-media/presign", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await makeHandler(db)(r);
  assertEquals(res.status, 401);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions`
Expected: FAIL (handler não existe). Nota: `test:functions` suja o `deno.lock` da raiz — `git checkout -- deno.lock` se aparecer no diff.

- [ ] **Step 3: Implementar handler + index**

```ts
// supabase/functions/equipe-chat-media/handler.ts
import { createJsonResponder } from "../_shared/http.ts";
import { resolveEntitlements } from "../_shared/entitlements.ts";

// Allowlist de chat: imagens comuns + documentos (subset da file-upload-url).
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/zip": "zip",
};
export const MAX_ANEXO_BYTES = 25 * 1024 * 1024;
const SIGNED_GET_TTL = 600; // 10 min

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  copyObject: (sourceKey: string, destKey: string) => Promise<void>;
  trashObject: (key: string) => Promise<void>;
  randomUUID?: () => string;
}

export function createEquipeChatMediaHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = {
      ...deps.buildCorsHeaders(req),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Not found" }, 404);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const svc = deps.createDb();
    const { data: { user } = { user: null }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Tenant = workspace ATIVA + membership confirmada (padrao report-docs;
    // conta_id legado NAO e fallback).
    const { data: profile } = await svc.from("profiles")
      .select("active_workspace_id").eq("id", user.id).single();
    const contaId = profile?.active_workspace_id as string | undefined;
    if (!contaId) return json({ error: "Profile not found" }, 403);
    const { data: member } = await svc.from("workspace_members")
      .select("user_id, role").eq("workspace_id", contaId).eq("user_id", user.id)
      .maybeSingle();
    if (!member) return json({ error: "Forbidden" }, 403);

    const ent = await resolveEntitlements(svc as never, contaId);
    if (ent && ent.features["feature_team_chat"] !== true) {
      return json({ error: "feature_disabled:feature_team_chat" }, 403);
    }

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("equipe-chat-media");
    const route = idx >= 0 ? parts[idx + 1] : undefined;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    const tmpPrefix = `equipe-chat-tmp/${contaId}/`;
    const finalPrefix = `equipe-chat/${contaId}/`;

    async function isParticipant(conversaId: number): Promise<boolean> {
      const { data: conversa } = await svc.from("equipe_conversas")
        .select("conta_id").eq("id", conversaId).maybeSingle();
      if (!conversa || conversa.conta_id !== contaId) return false;
      const { data: pt } = await svc.from("equipe_conversa_participantes")
        .select("id").eq("conversa_id", conversaId).eq("user_id", user!.id)
        .maybeSingle();
      return !!pt;
    }

    try {
      if (route === "presign") {
        const conversaId = Number(body.conversa_id);
        const mime = String(body.mime_type ?? "");
        const size = Number(body.size_bytes);
        if (!Number.isInteger(conversaId)) return json({ error: "conversa_id invalido" }, 400);
        if (!(mime in MIME_EXT)) return json({ error: "unsupported file type" }, 415);
        if (!size || size <= 0 || size > MAX_ANEXO_BYTES) {
          return json({ error: "size_bytes out of range" }, 400);
        }
        if (!(await isParticipant(conversaId))) return json({ error: "Forbidden" }, 403);
        const uuid = (deps.randomUUID ?? crypto.randomUUID.bind(crypto))();
        const key = `${tmpPrefix}${uuid}.${MIME_EXT[mime]}`;
        const upload_url = await deps.signPutUrl(key, mime);
        return json({ upload_url, key }, 200);
      }

      if (route === "finalize") {
        const conversaId = Number(body.conversa_id);
        const key = String(body.key ?? "");
        const mime = String(body.mime_type ?? "");
        const size = Number(body.size_bytes);
        const fileName = String(body.file_name ?? "").slice(0, 200);
        if (!Number.isInteger(conversaId)) return json({ error: "conversa_id invalido" }, 400);
        if (!key.startsWith(tmpPrefix)) return json({ error: "invalid key" }, 400);
        if (!(mime in MIME_EXT)) return json({ error: "unsupported file type" }, 415);
        if (!fileName) return json({ error: "file_name obrigatorio" }, 400);
        if (!(await isParticipant(conversaId))) return json({ error: "Forbidden" }, 403);

        const head = await deps.headObject(key);
        if (!head) return json({ error: "object not found" }, 400);
        if (head.contentLength !== size) return json({ error: "size mismatch" }, 400);
        if (head.contentType && head.contentType !== mime) {
          return json({ error: "content-type mismatch" }, 400);
        }

        // tmp -> final: a URL PUT ainda valida so alcanca a tmp, nunca o
        // objeto contabilizado.
        const finalKey = finalPrefix + key.slice(tmpPrefix.length);
        await deps.copyObject(key, finalKey);

        const { data: row, error: rpcErr } = await svc
          .rpc("equipe_chat_anexo_finalize", {
            p: {
              conta_id: contaId,
              conversa_id: conversaId,
              created_by: user.id,
              r2_key: finalKey,
              file_name: fileName,
              mime_type: mime,
              size_bytes: size,
            },
          })
          .single();
        if (rpcErr) {
          const msg = (rpcErr as { message?: string }).message ?? "";
          // Falhou depois da copia: tenta desfazer a final para nao vazar.
          await deps.trashObject(finalKey).catch(() => {});
          if (msg.includes("quota_exceeded")) return json({ error: "quota_exceeded" }, 413);
          if (msg.includes("conversa_not_found")) return json({ error: "Forbidden" }, 403);
          if (msg.includes("invalid_key") || msg.includes("invalid_size")) {
            return json({ error: "invalid request" }, 400);
          }
          console.error("equipe-chat-media finalize rpc:", msg);
          return json({ error: "internal error" }, 500);
        }
        await deps.trashObject(key).catch(() => {});
        return json({
          anexo: {
            id: row.anexo_id,
            file_name: row.file_name,
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
          },
        }, 200);
      }

      if (route === "anexo-url") {
        const anexoId = Number(body.anexo_id);
        if (!Number.isInteger(anexoId)) return json({ error: "anexo_id invalido" }, 400);
        const { data: anexo } = await svc.from("equipe_mensagem_anexos")
          .select("id, conta_id, conversa_id, r2_key").eq("id", anexoId).maybeSingle();
        if (!anexo || anexo.conta_id !== contaId) return json({ error: "Not found" }, 404);
        const { data: pt } = await svc.from("equipe_conversa_participantes")
          .select("id").eq("conversa_id", anexo.conversa_id).eq("user_id", user.id)
          .maybeSingle();
        if (!pt) return json({ error: "Forbidden" }, 403);
        const signed = await deps.signGetUrl(anexo.r2_key, SIGNED_GET_TTL);
        return json({ url: signed }, 200);
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error("equipe-chat-media:", (e as Error).message);
      return json({ error: "internal error" }, 500);
    }
  };
}
```

```ts
// supabase/functions/equipe-chat-media/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { makeBoundedFetch } from "../_shared/bounded-fetch.ts";
import {
  signPutUrl, signGetUrl, headObjectSigned, copyObjectSigned, trashObject,
} from "../_shared/r2.ts";
import { createEquipeChatMediaHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createEquipeChatMediaHandler({
  buildCorsHeaders,
  // Handler grava estado (copy/trash + RPC de quota): fetch com teto e
  // helpers R2 "signed" (o transport do aws-sdk trava no edge runtime).
  createDb: () =>
    createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: makeBoundedFetch() },
    }),
  signPutUrl,
  signGetUrl,
  headObject: headObjectSigned,
  copyObject: copyObjectSigned,
  trashObject,
}));
```

Em `supabase/config.toml`, adicione junto das outras entradas de function:

```toml
[functions.equipe-chat-media]
verify_jwt = false
```

Confira a assinatura real de `resolveEntitlements` e o shape de `ent.features` em `_shared/entitlements.ts` antes de rodar; se `ent` vier `null` (workspace sem plano), o handler acima deixa passar — mantenha assim (paridade com o gate do banco, que é o gate autoritativo).

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:functions`
Expected: PASS em todos os testes novos (e nenhum existente quebrado). Restaure `deno.lock` se sujou: `git checkout -- deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/equipe-chat-media/ supabase/functions/__tests__/equipe-chat-media_test.ts supabase/config.toml
git commit -m "feat(equipe-chat): edge function de anexos com presign tmp e finalize por copia"
```

---

### Task 7: Legs de limpeza no `post-media-cleanup-cron`

**Files:**
- Modify: `supabase/functions/post-media-cleanup-cron/index.ts` (dois legs novos, ANTES do `purgeTrash`)
- Test: `supabase/functions/__tests__/equipe-chat-cleanup_test.ts` (ou estenda o teste existente do cron, se houver um que injete `run` — verifique `supabase/functions/__tests__/` por um `post-media-cleanup` test e siga o padrão dele)

**Interfaces:**
- Consumes: `equipe_chat_anexo_release(p_anexo_id)` → r2_key|null (Task 3), `listOrphanKeys(prefix, olderThanMs)`, `trashObject(key)` de `_shared/r2.ts`.
- Produces: contadores `equipeChatTmpTrashed`, `equipeChatStagedReleased`, `equipeChatFailed` no JSON de resposta do cron e no array `alerts`.

- [ ] **Step 1: Escrever o teste**

Leia primeiro o leg `file_deletions` em `post-media-cleanup-cron/index.ts:60-89` e o teste existente do cron (se houver) para casar o estilo de injeção. O teste deve cobrir, com fakes locais (padrão `orphan-scan_test.ts`, `makeDb(respond)`):

1. Tmp sweep: `listOrphanKeys('equipe-chat-tmp/', 24h)` devolvendo 2 keys → ambas passam por `trashObject`; contador = 2.
2. Staged reap: query em `equipe_mensagem_anexos` (staged, >24h, `.limit(500)`) devolve 2 ids; RPC `equipe_chat_anexo_release` devolve r2_key para o 1º (→ `trashObject` chamado) e NULL para o 2º (send ganhou a corrida → NENHUM trash); contador released = 1.
3. Erro em um item não derruba o leg (try/catch por linha, `equipeChatFailed` incrementa).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions`
Expected: FAIL nos testes novos.

- [ ] **Step 3: Implementar os legs**

Em `post-media-cleanup-cron/index.ts`, depois do leg de orphan-scan (linha ~125) e ANTES do `purgeTrash(30)`, insira (adaptando nomes de variáveis locais ao arquivo):

```ts
    // ---- equipe-chat: tmp abandonada (upload sem finalize) ----
    // Varredura cega e segura: finalize copia logo apos o upload; um
    // finalize >24h depois falha no copy e o cliente re-envia.
    let equipeChatTmpTrashed = 0;
    let equipeChatStagedReleased = 0;
    let equipeChatFailed = 0;
    try {
      const tmpKeys = await listOrphanKeys("equipe-chat-tmp/", 24 * 60 * 60 * 1000);
      for (const key of tmpKeys) {
        try {
          await trashObject(key);
          equipeChatTmpTrashed++;
        } catch (e) {
          equipeChatFailed++;
          console.error("equipe-chat tmp sweep:", key, (e as Error).message);
        }
      }
    } catch (e) {
      equipeChatFailed++;
      console.error("equipe-chat tmp list:", (e as Error).message);
    }

    // ---- equipe-chat: staged >24h (upload finalizado, mensagem nunca
    // enviada). A RPC apaga a linha e estorna a quota na mesma transacao;
    // devolve NULL quando o envio ganhou a corrida - nesse caso NAO trashear.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staged } = await svc
      .from("equipe_mensagem_anexos")
      .select("id")
      .is("mensagem_id", null)
      .lt("created_at", cutoff)
      .limit(500);
    for (const row of staged ?? []) {
      try {
        const { data: releasedKey, error: relErr } = await svc
          .rpc("equipe_chat_anexo_release", { p_anexo_id: row.id });
        if (relErr) throw new Error(relErr.message);
        if (releasedKey) {
          await trashObject(releasedKey as string);
          equipeChatStagedReleased++;
        }
      } catch (e) {
        equipeChatFailed++;
        console.error("equipe-chat staged reap:", row.id, (e as Error).message);
      }
    }
```

No bloco de alerts (linha ~158), acrescente:

```ts
    if (equipeChatFailed > 0) {
      alerts.push({ error: `equipe-chat cleanup: ${equipeChatFailed} steps failed this run` });
    }
```

E no JSON de retorno final, acrescente `equipeChatTmpTrashed, equipeChatStagedReleased, equipeChatFailed`.

- [ ] **Step 4: Rodar e ver passar; commit**

Run: `npm run test:functions`
Expected: PASS (novos e existentes). `git checkout -- deno.lock` se sujou.

```bash
git add supabase/functions/post-media-cleanup-cron/ supabase/functions/__tests__/
git commit -m "feat(equipe-chat): legs de limpeza de tmp e staged no cleanup cron"
```

---

### Task 8: Serviço de upload + mock de canal + hooks (dados, unread, realtime)

**Files:**
- Create: `apps/crm/src/services/equipeChatMedia.ts`
- Create: `apps/crm/src/pages/mensagens/hooks/useEquipeChatData.ts`
- Create: `apps/crm/src/hooks/useEquipeChatUnread.ts`
- Create: `apps/crm/src/hooks/useEquipeChatRealtime.ts`
- Modify: `apps/crm/src/lib/__mocks__/supabase.ts` (mock de canal aceita múltiplos listeners e INSERT)
- Test: `apps/crm/src/__tests__/services.equipeChatMedia.test.ts`
- Test: `apps/crm/src/hooks/__tests__/useEquipeChatRealtime.test.tsx`

**Interfaces:**
- Consumes: store da Task 5, endpoints da Task 6, `probeImage`/`putWithProgress`/`UploadProgress` de `@/services/postMedia`, `useWorkspaceLimits`, `AuthContext` (user id + conta), `supabase.channel`.
- Produces (Tasks 9-11 consomem):
  - `validateEquipeChatFile(file: File): string | null` (mensagem de erro pt-BR ou null)
  - `uploadEquipeChatAnexo(conversaId: number, file: File, onProgress?: (p: UploadProgress) => void): Promise<EquipeMensagemAnexo>`
  - `signEquipeChatAnexoView(anexoId: number): Promise<string>`
  - `useEquipeChatData(conversaId: number | null)` → `{ conversas, mensagens, send, markSeen }` (`conversas`: useQuery de `EquipeConversa[]`, key `['equipe-conversas']`; `mensagens`: useInfiniteQuery key `['equipe-mensagens', conversaId]`, page size 50, cursor `{before, beforeId}` da mais antiga; `send`: useMutation `{content, anexoIds?}` → invalida ambos; `markSeen(lastMessageId)`: chama RPC e invalida `['equipe-conversas']` + `['equipe-chat-unread']`)
  - `useEquipeChatUnread(): number` (gateado por `feature_team_chat`, poll 60s, key `['equipe-chat-unread']`)
  - `useEquipeChatRealtime(activeConversaId: number | null): void`

- [ ] **Step 1: Ampliar o mock de canal**

Em `apps/crm/src/lib/__mocks__/supabase.ts`, o `makeChannelMock` atual só guarda UM listener UPDATE (o do AuthProvider). Mude a estrutura interna para uma LISTA de `{event, filter, callback}` registrada em `subscribe()` (mantendo o comportamento e os helpers atuais — `__emitWorkspaceMemberUpdate` continua achando o listener de UPDATE em `workspace_members`), e acrescente um helper `__emitEquipeMensagemInsert(row: unknown)` que localiza o listener de INSERT na tabela `equipe_mensagens` e o invoca com `{ new: row }`. Rode `npm run test` (suíte inteira) após a mudança: os testes do AuthContext que usam o mock não podem quebrar.

- [ ] **Step 2: Testes novos (falham antes da implementação)**

`services.equipeChatMedia.test.ts` (mock de `fetch` global + `@/lib/supabase` para o token; padrão dos testes de serviços existentes — veja como `automationMedia` é testado, se houver teste; senão mock direto de fetch):

1. `validateEquipeChatFile` rejeita mime fora da allowlist (`image/jpeg, image/jpg, image/png, image/gif, image/webp, application/pdf, application/zip`) e arquivo > 25MB, aceita um PNG de 1KB.
2. `uploadEquipeChatAnexo` faz POST `/presign` (body com conversa_id/mime/size), PUT na `upload_url`, POST `/finalize` (body com key/file_name/mime/size) e devolve `anexo` do finalize.
3. Erro no finalize propaga (reject).

`useEquipeChatRealtime.test.tsx` (renderHook com QueryClientProvider + mock `@/lib/supabase`):

1. Monta com feature on → `supabase.channel` chamado com nome `equipe-chat:user-1:conta-1` e `subscribe`.
2. `__emitEquipeMensagemInsert({ conversa_id: 7, conta_id: 'conta-1' })` com `activeConversaId = 7` → invalida `['equipe-mensagens', 7]` e `['equipe-conversas']` (espie `queryClient.invalidateQueries`).
3. Insert de outra conversa (`conversa_id: 9`) → invalida `['equipe-conversas']` e `['equipe-chat-unread']`, NÃO `['equipe-mensagens', 7]`.
4. Payload de outro workspace (`conta_id: 'conta-X'`) → ignorado (nenhuma invalidação).
5. Unmount → `removeChannel` chamado.

- [ ] **Step 3: Implementar**

```ts
// apps/crm/src/services/equipeChatMedia.ts
import { supabase } from '@/lib/supabase';
import { probeImage, putWithProgress, type UploadProgress } from './postMedia';
import type { EquipeMensagemAnexo } from '@/store';

export const EQUIPE_CHAT_ANEXO_MIME = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'application/zip',
];
export const MAX_EQUIPE_CHAT_ANEXO_BYTES = 25 * 1024 * 1024;

export function validateEquipeChatFile(file: File): string | null {
  if (!EQUIPE_CHAT_ANEXO_MIME.includes(file.type)) {
    return 'Tipo de arquivo não suportado. Use imagem, PDF ou ZIP.';
  }
  if (file.size <= 0 || file.size > MAX_EQUIPE_CHAT_ANEXO_BYTES) {
    return 'O arquivo precisa ter no máximo 25MB.';
  }
  return null;
}

async function callFn<T>(route: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/equipe-chat-media/${route}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify(body),
    },
  );
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `equipe-chat-media/${route} falhou`);
  return json;
}

export async function uploadEquipeChatAnexo(
  conversaId: number,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<EquipeMensagemAnexo> {
  // probeImage so para imagens; anexos de documento pulam o probe.
  if (file.type.startsWith('image/')) await probeImage(file).catch(() => null);
  const signed = await callFn<{ upload_url: string; key: string }>('presign', {
    conversa_id: conversaId,
    mime_type: file.type,
    size_bytes: file.size,
  });
  await putWithProgress(signed.upload_url, file, onProgress);
  const { anexo } = await callFn<{ anexo: EquipeMensagemAnexo }>('finalize', {
    conversa_id: conversaId,
    key: signed.key,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  });
  return anexo;
}

export async function signEquipeChatAnexoView(anexoId: number): Promise<string> {
  const { url } = await callFn<{ url: string }>('anexo-url', { anexo_id: anexoId });
  return url;
}
```

Confirme as assinaturas reais de `probeImage`/`putWithProgress` em `apps/crm/src/services/postMedia.ts` antes de finalizar (o `automationMedia.ts` importa exatamente esses nomes).

```ts
// apps/crm/src/pages/mensagens/hooks/useEquipeChatData.ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getEquipeConversas, getEquipeMensagens, markEquipeConversaSeen,
  sendEquipeMensagem, type EquipeMensagensCursor,
} from '@/store';

const PAGE_SIZE = 50;

export function useEquipeChatData(conversaId: number | null) {
  const qc = useQueryClient();

  const conversas = useQuery({
    queryKey: ['equipe-conversas'],
    queryFn: getEquipeConversas,
    refetchInterval: 60_000,
  });

  const conversaExists =
    conversaId != null &&
    (conversas.data?.some((c) => c.conversa_id === conversaId) ?? false);

  const mensagens = useInfiniteQuery({
    queryKey: ['equipe-mensagens', conversaId],
    queryFn: ({ pageParam }) =>
      getEquipeMensagens({ conversaId: conversaId!, cursor: pageParam }),
    initialPageParam: undefined as EquipeMensagensCursor | undefined,
    getNextPageParam: (last) => {
      if (last.length !== PAGE_SIZE) return undefined;
      const oldest = last[last.length - 1];
      return { before: oldest.created_at, beforeId: oldest.id };
    },
    enabled: conversaExists,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['equipe-mensagens'] });
    qc.invalidateQueries({ queryKey: ['equipe-conversas'] });
  };

  const send = useMutation({
    mutationFn: ({ content, anexoIds }: { content: string; anexoIds?: number[] }) =>
      sendEquipeMensagem(conversaId!, content, anexoIds),
    onSuccess: invalidate,
  });

  const markSeen = useMutation({
    mutationFn: (lastMessageId: number) =>
      markEquipeConversaSeen(conversaId!, lastMessageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipe-conversas'] });
      qc.invalidateQueries({ queryKey: ['equipe-chat-unread'] });
    },
  });

  return { conversas, mensagens, send, markSeen };
}
```

```ts
// apps/crm/src/hooks/useEquipeChatUnread.ts
import { useQuery } from '@tanstack/react-query';
import { getEquipeChatUnread } from '@/store';
import { useWorkspaceLimits } from './useWorkspaceLimits';

/** Total de mensagens de equipe nao lidas (badge). Poll de 60s; desligado
 * enquanto feature_team_chat esta off ou desconhecida. */
export function useEquipeChatUnread(): number {
  const { features } = useWorkspaceLimits();
  const enabled = features?.feature_team_chat === true;
  const { data } = useQuery({
    queryKey: ['equipe-chat-unread'],
    queryFn: getEquipeChatUnread,
    enabled,
    refetchInterval: 60_000,
  });
  return enabled && data ? data : 0;
}
```

```ts
// apps/crm/src/hooks/useEquipeChatRealtime.ts
import { useContext, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { AuthContext } from '@/context/AuthContext';
import { useWorkspaceLimits } from './useWorkspaceLimits';

/** Assinatura unica de INSERT em equipe_mensagens. RLS restringe a entrega
 * as conversas do usuario; o guard de conta_id abaixo e defesa extra contra
 * bleed multi-workspace (mesmo racional do canal wm: do AuthContext).
 * Polling de 60s nas queries segue como fallback: nao ha handler de
 * status/reconexao (padrao do repo). */
export function useEquipeChatRealtime(activeConversaId: number | null): void {
  const qc = useQueryClient();
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id ?? null;
  const workspaceId = auth?.profile?.conta_id ?? null;
  const { features } = useWorkspaceLimits();
  const enabled = features?.feature_team_chat === true;

  useEffect(() => {
    if (!enabled || !userId || !workspaceId) return;
    const channel = supabase
      .channel(`equipe-chat:${userId}:${workspaceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'equipe_mensagens' },
        (payload) => {
          const row = payload.new as { conversa_id?: number; conta_id?: string };
          if (row.conta_id !== workspaceId) return;
          if (activeConversaId != null && row.conversa_id === activeConversaId) {
            qc.invalidateQueries({ queryKey: ['equipe-mensagens', activeConversaId] });
            qc.invalidateQueries({ queryKey: ['equipe-conversas'] });
          } else {
            qc.invalidateQueries({ queryKey: ['equipe-conversas'] });
            qc.invalidateQueries({ queryKey: ['equipe-chat-unread'] });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId, workspaceId, activeConversaId, qc]);
}
```

Verifique como `AuthContext` expõe `user`/`profile` (o hook `useWorkspaceLimits` lê `auth?.profile?.conta_id` — copie o mesmo acesso) e se `AuthContext` é exportado nomeado; ajuste o import se for só via `useAuth()`.

- [ ] **Step 4: Rodar e ver passar; commit**

Run: `npm run test -- equipeChat && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS, incluindo a suíte pré-existente do AuthContext (mock de canal mudou!): rode também `npm run test -- AuthContext revocation`.

```bash
git add apps/crm/src/services/equipeChatMedia.ts apps/crm/src/pages/mensagens/hooks/useEquipeChatData.ts apps/crm/src/hooks/useEquipeChatUnread.ts apps/crm/src/hooks/useEquipeChatRealtime.ts apps/crm/src/lib/__mocks__/supabase.ts apps/crm/src/__tests__/services.equipeChatMedia.test.ts apps/crm/src/hooks/__tests__/useEquipeChatRealtime.test.tsx
git commit -m "feat(equipe-chat): servico de upload, hooks de dados/unread e realtime"
```

---

### Task 9: Rotas + abas na página Mensagens + lista de conversas de equipe

**Files:**
- Modify: `apps/crm/src/App.tsx` (rota nova)
- Modify: `apps/crm/src/pages/mensagens/MensagensPage.tsx` (abas + modo equipe)
- Create: `apps/crm/src/pages/mensagens/components/EquipeConversationList.tsx`
- Create: `apps/crm/src/pages/mensagens/equipeChatLogic.ts`
- Test: `apps/crm/src/pages/mensagens/__tests__/equipeChatLogic.test.ts`
- Test: `apps/crm/src/pages/mensagens/components/__tests__/EquipeConversationList.test.tsx`

**Interfaces:**
- Consumes: `EquipeConversa` (Task 5), `useEquipeChatData`/`useEquipeChatRealtime` (Task 8), `useWorkspaceLimits`, shell existente (`ThreadPlaceholder` etc.), `initialsOf` de `./Avatars`, `formatTime` de `../mensagensLogic`.
- Produces: rota `/mensagens/equipe/:conversaId`; `equipeConversaPreview(c: EquipeConversa): string`; `sortEquipeConversas(rows: EquipeConversa[], sort: 'recentes' | 'antigas'): EquipeConversa[]`; `<EquipeConversationList conversas isLoading isError selectedConversaId onSelect onNovaConversa className? />`. A Task 10 pluga o thread; a Task 11 pluga `onNovaConversa`.

- [ ] **Step 1: Lógica pura + teste primeiro**

```ts
// apps/crm/src/pages/mensagens/equipeChatLogic.ts
import type { EquipeConversa } from '@/store';

export type EquipeConversasSort = 'recentes' | 'antigas';

/** Conversas com atividade por recencia; vazias no fim, por nome. */
export function sortEquipeConversas(
  rows: EquipeConversa[],
  sort: EquipeConversasSort,
): EquipeConversa[] {
  const ativas = rows.filter((r) => r.last_created_at != null);
  const vazias = rows
    .filter((r) => r.last_created_at == null)
    .sort((a, b) => a.display_nome.localeCompare(b.display_nome, 'pt-BR'));
  const sorted = [...ativas].sort((a, b) =>
    a.last_created_at!.localeCompare(b.last_created_at!),
  );
  return [...(sort === 'antigas' ? sorted : sorted.reverse()), ...vazias];
}

/** Preview de uma linha: "Autor: texto", "Autor: Anexo" ou vazio. */
export function equipeConversaPreview(c: EquipeConversa): string {
  if (c.last_created_at == null) return 'Sem mensagens ainda. Comece a conversa!';
  const autor = c.last_author_name ?? 'Equipe';
  const texto = c.last_content?.trim() ?? '';
  if (texto) return `${autor}: ${texto}`;
  if (c.last_has_anexo) return `${autor}: Anexo`;
  return autor;
}
```

Teste `equipeChatLogic.test.ts` (padrão `mensagensLogic.test.ts`): ordena recentes/antigas com vazias no fim; preview com texto, só-anexo e conversa vazia. Rode `npm run test -- equipeChatLogic` (FAIL antes de criar os arquivos, PASS depois).

- [ ] **Step 2: `EquipeConversationList` (espelho estrutural do `ConversationList` — copie o layout de busca/sort/linha de lá, trocando os dados)**

```tsx
// apps/crm/src/pages/mensagens/components/EquipeConversationList.tsx
import { useMemo, useState } from 'react';
import { ArrowDownUp, Plus, Search, Users } from 'lucide-react';
import type { EquipeConversa } from '@/store';
import { initialsOf } from './Avatars';
import { formatTime } from '../mensagensLogic';
import {
  equipeConversaPreview, sortEquipeConversas, type EquipeConversasSort,
} from '../equipeChatLogic';

interface EquipeConversationListProps {
  conversas: EquipeConversa[];
  isLoading: boolean;
  isError: boolean;
  selectedConversaId: number | null;
  onSelect: (conversaId: number) => void;
  onNovaConversa: () => void;
  className?: string;
}

export function EquipeConversationList({
  conversas, isLoading, isError, selectedConversaId, onSelect, onNovaConversa,
  className = '',
}: EquipeConversationListProps) {
  const [sort, setSort] = useState<EquipeConversasSort>('recentes');
  const [busca, setBusca] = useState('');

  const visiveis = useMemo(() => {
    const ordenadas = sortEquipeConversas(conversas, sort);
    const q = busca.trim().toLowerCase();
    if (!q) return ordenadas;
    return ordenadas.filter((c) => c.display_nome.toLowerCase().includes(q));
  }, [conversas, sort, busca]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="border-b border-[var(--border-color)] px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="mt-0" style={{ position: 'relative', flex: 1 }}>
            <Search
              className="h-4 w-4"
              style={{
                position: 'absolute', left: '0.625rem', top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar conversa..."
              aria-label="Buscar conversa"
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] py-2 pr-3 text-sm outline-none"
              style={{ paddingLeft: '2rem' }}
            />
          </div>
          <button
            onClick={onNovaConversa}
            aria-label="Nova conversa"
            data-testid="nova-conversa-btn"
            className="flex items-center justify-center rounded-md border border-[var(--border-color)] p-2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
            style={{ background: 'var(--card-bg)', cursor: 'pointer' }}
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          onClick={() => setSort((s) => (s === 'recentes' ? 'antigas' : 'recentes'))}
          className="mt-2 flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
          style={{ background: 'var(--card-bg)', cursor: 'pointer' }}
        >
          <ArrowDownUp size={13} />
          {sort === 'recentes' ? 'Mais recentes' : 'Mais antigas'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mensagens-list-scroll">
        {isLoading && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
        )}
        {isError && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            Não foi possível carregar as conversas.
          </p>
        )}
        {!isLoading && !isError && visiveis.length === 0 && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            {busca.trim()
              ? 'Nenhuma conversa encontrada.'
              : 'Nenhuma conversa ainda. Crie uma para falar com a equipe.'}
          </p>
        )}
        {visiveis.map((c) => {
          const isActive = c.conversa_id === selectedConversaId;
          return (
            <button
              key={c.conversa_id}
              onClick={() => onSelect(c.conversa_id)}
              data-testid={`equipe-conversa-${c.conversa_id}`}
              className="flex w-full items-center gap-3 border-b border-[var(--border-color)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]"
              style={{
                border: 'none', cursor: 'pointer',
                ...(isActive
                  ? {
                      background: 'rgba(255,191,48,0.12)',
                      boxShadow: 'inset 3px 0 0 var(--primary-color)',
                    }
                  : { background: 'transparent' }),
              }}
            >
              {c.tipo === 'dm' && c.avatar_url ? (
                <img
                  src={c.avatar_url}
                  alt=""
                  className="avatar"
                  style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <span
                  className="avatar"
                  style={{
                    width: 40, height: 40, fontSize: '0.8rem', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {c.tipo === 'grupo' ? <Users size={18} /> : initialsOf(c.display_nome)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{c.display_nome}</span>
                  {c.last_created_at != null && (
                    <span className="shrink-0 text-xs text-[var(--text-light)]">
                      {formatTime(c.last_created_at)}
                    </span>
                  )}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-[var(--text-muted)]">
                    {equipeConversaPreview(c)}
                  </span>
                  {c.unread_count > 0 && (
                    <span className="nav-badge nav-badge--count shrink-0">
                      {c.unread_count > 99 ? '99+' : c.unread_count}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

Teste `EquipeConversationList.test.tsx` (padrão `ConversationList.test.tsx`, sem mocks): renderiza linhas com preview e badge; clique chama `onSelect`; busca filtra; botão nova conversa chama `onNovaConversa`; estado vazio.

- [ ] **Step 3: Rota + abas na página**

Em `App.tsx`, junto das rotas de mensagens (linha ~231):

```tsx
                <Route path="/mensagens" element={<MensagensPage />} />
                <Route path="/mensagens/equipe/:conversaId" element={<MensagensPage />} />
                <Route path="/mensagens/:clienteId" element={<MensagensPage />} />
```

(`<Routes>` ranqueia por especificidade; a ordem acima é só legibilidade.)

Em `MensagensPage.tsx`, o shell passa a ter dois modos. Detecte o modo equipe com `useLocation().pathname.startsWith('/mensagens/equipe')`; o param `:conversaId` chega pelo mesmo `useParams()` (chaves diferentes por rota — leia ambas). Estrutura:

```tsx
// Dentro de MensagensPage():
const { clienteId: clienteIdParam, conversaId: conversaIdParam } = useParams();
const location = useLocation();
const { features } = useWorkspaceLimits();
const clientesOn = features?.feature_mensagens === true;
const equipeOn = features?.feature_team_chat === true;

const equipeMode = location.pathname.startsWith('/mensagens/equipe');
// Aba ativa: URL de conversa manda; senao estado local, default = primeira
// aba habilitada.
const [tab, setTab] = useState<'clientes' | 'equipe'>(() =>
  clientesOn || !equipeOn ? 'clientes' : 'equipe',
);
const activeTab = equipeMode ? 'equipe' : clienteIdParam != null ? 'clientes' : tab;

const parsedConversaId = conversaIdParam != null ? parseInt(conversaIdParam, 10) : NaN;
const equipeConversaId =
  equipeMode && !isNaN(parsedConversaId) ? parsedConversaId : null;
const invalidEquipeId = equipeMode && conversaIdParam != null && isNaN(parsedConversaId);

const equipe = useEquipeChatData(equipeOn ? equipeConversaId : null);
useEquipeChatRealtime(equipeConversaId);
```

O seletor de abas só aparece quando AMBAS as flags estão on (uma flag só = sem abas, direto na única seção). Use o idioma de pills da própria página (`ConversationThread` linhas 112-129), acima da lista:

```tsx
{clientesOn && equipeOn && (
  <div className="flex gap-1 border-b border-[var(--border-color)] px-4 py-2">
    {(
      [
        { id: 'clientes', label: 'Clientes' },
        { id: 'equipe', label: 'Equipe' },
      ] as const
    ).map((t) => (
      <button
        key={t.id}
        onClick={() => {
          setTab(t.id);
          navigate('/mensagens');
        }}
        data-testid={`mensagens-tab-${t.id}`}
        className="rounded-full px-3 py-1.5 text-xs whitespace-nowrap"
        style={{
          border: 'none', cursor: 'pointer',
          background: activeTab === t.id ? 'var(--text-main)' : 'transparent',
          color: activeTab === t.id ? 'var(--card-bg)' : 'var(--text-muted)',
          fontWeight: activeTab === t.id ? 600 : 400,
        }}
      >
        {t.label}
      </button>
    ))}
  </div>
)}
```

Na coluna da lista: `activeTab === 'clientes'` renderiza o `ConversationList` atual (intocado); `activeTab === 'equipe'` renderiza `EquipeConversationList` com `onSelect={(id) => navigate(`/mensagens/equipe/${id}`)}` e `onNovaConversa` (Task 11; até lá, um `() => {}`). O slot do thread no modo equipe segue a MESMA precedência do modo clientes (invalid → NotFound; sem id → Placeholder; loading → Loading; erro duro → LoadError com retry; não achou na lista → NotFound com a mensagem padrão) — o `EquipeThread` em si chega na Task 10; até lá renderize `<ThreadPlaceholder />` no lugar dele para a página compilar. A coluna da lista e o wrapper `page-full-bleed flex min-h-0` não mudam. Mantenha `useMensagensData(clienteId)` chamado só com id de cliente (no modo equipe, `clienteId = null`).

- [ ] **Step 4: Rodar e commitar**

Run: `npm run test -- "equipeChatLogic|EquipeConversationList|mensagens" && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS, incluindo os testes pré-existentes da página.

```bash
git add apps/crm/src/App.tsx apps/crm/src/pages/mensagens/
git commit -m "feat(equipe-chat): aba Equipe, rota de conversa e lista de conversas"
```

---

### Task 10: `EquipeThread` (bolhas, composer com menções, anexos, mark-seen)

**Files:**
- Create: `apps/crm/src/pages/mensagens/components/EquipeThread.tsx`
- Modify: `apps/crm/src/pages/mensagens/MensagensPage.tsx` (plugar no slot do thread)
- Test: `apps/crm/src/pages/mensagens/components/__tests__/EquipeThread.test.tsx`

**Interfaces:**
- Consumes: `useEquipeChatData` (Task 8 — props `conversa`, `mensagens`, `send`, `markSeen`), `MentionTextarea`/`MentionText` (`@/components/mentions`), `validateEquipeChatFile`/`uploadEquipeChatAnexo`/`signEquipeChatAnexoView` (Task 8), `useAuth()` (id do usuário atual para alinhar bolhas), `initialsOf`, `formatTime`, `toast` de `sonner`.
- Produces: `<EquipeThread conversa={EquipeConversa} mensagens={...} send={...} markSeen={...} onBack? onOpenDetalhes? />`. `onOpenDetalhes` abre o sheet da Task 11 (até lá, opcional e sem uso).

- [ ] **Step 1: Teste primeiro (padrão `ConversationThread.test.tsx`: fixtures tipadas, `makeFeed`/`makeMutation`, render com BrowserRouter + QueryClientProvider, mock de `@/services/equipeChatMedia` e `@/context/AuthContext` se necessário)**

Casos:
1. Renderiza mensagens em ordem cronológica com nome do autor nas bolhas dos outros e alinhamento invertido nas do próprio usuário (mock do id atual).
2. Composer: digitar e Enter chama `send.mutateAsync({ content: 'Olá', anexoIds: undefined })` e limpa o draft (envolva o evento em `await act(...)` — mesmo racional comentado no teste do ConversationThread).
3. Shift+Enter NÃO envia.
4. Mensagem com anexo de imagem renderiza thumbnail (elemento com `data-testid="anexo-imagem"`); com PDF renderiza chip com nome do arquivo.
5. Botão "Carregar mensagens anteriores" aparece com `hasNextPage` e chama `fetchNextPage`.
6. Ao montar com mensagens carregadas, chama `markSeen.mutate(maiorIdRenderizado)`.
7. Falha no send mostra toast de erro (spy em `toast.error`).

- [ ] **Step 2: Rodar e ver falhar** — `npm run test -- EquipeThread` → FAIL.

- [ ] **Step 3: Implementar**

Estrutura do componente (siga o `ConversationThread` como gabarito de layout/scroll — MESMAS classes do wrapper, do scroll `data-testid="thread-scroll"`, do botão de carregar anteriores e do rodapé do composer; o que muda está abaixo):

```tsx
// apps/crm/src/pages/mensagens/components/EquipeThread.tsx
// Esqueleto dos pontos que DIFEREM do ConversationThread (o resto copia o
// gabarito de la, inclusive o auto-scroll com scrollPending):
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, Paperclip, Send, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { MentionTextarea } from '@/components/mentions/MentionTextarea';
import { MentionText } from '@/components/mentions/MentionText';
import { useAuth } from '@/context/AuthContext';
import {
  validateEquipeChatFile, uploadEquipeChatAnexo, signEquipeChatAnexoView,
} from '@/services/equipeChatMedia';
import type { EquipeConversa, EquipeMensagem, EquipeMensagemAnexo } from '@/store';
import { initialsOf } from './Avatars';
import { formatTime } from '../mensagensLogic';
import type { useEquipeChatData } from '../hooks/useEquipeChatData';

type EquipeData = ReturnType<typeof useEquipeChatData>;

interface EquipeThreadProps {
  conversa: EquipeConversa;
  mensagens: EquipeData['mensagens'];
  send: EquipeData['send'];
  markSeen: EquipeData['markSeen'];
  onBack?: () => void;
  onOpenDetalhes?: () => void;
}

export function EquipeThread({
  conversa, mensagens, send, markSeen, onBack, onOpenDetalhes,
}: EquipeThreadProps) {
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  const [draft, setDraft] = useState('');
  const [anexosPendentes, setAnexosPendentes] = useState<EquipeMensagemAnexo[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const itens = useMemo(() => {
    const all = (mensagens.data?.pages ?? []).flat();
    return [...all].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id,
    );
  }, [mensagens.data]);

  // High-water mark: marca lido o maior id RENDERIZADO. Re-marca a cada
  // mensagem nova (realtime invalida -> itens muda).
  const maiorId = itens.length > 0 ? itens[itens.length - 1].id : 0;
  useEffect(() => {
    if (maiorId > 0) markSeen.mutate(maiorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maiorId, conversa.conversa_id]);

  async function anexar(file: File) {
    const erro = validateEquipeChatFile(file);
    if (erro) {
      toast.error(erro);
      return;
    }
    setUploading(true);
    try {
      const anexo = await uploadEquipeChatAnexo(conversa.conversa_id, file);
      setAnexosPendentes((prev) => [...prev, anexo]);
    } catch {
      toast.error('Não foi possível enviar o arquivo.');
    } finally {
      setUploading(false);
    }
  }

  async function enviar() {
    const text = draft.trim();
    if ((!text && anexosPendentes.length === 0) || send.isPending || uploading) return;
    try {
      await send.mutateAsync({
        content: text,
        anexoIds: anexosPendentes.length > 0
          ? anexosPendentes.map((a) => a.id)
          : undefined,
      });
      setDraft('');
      setAnexosPendentes([]);
    } catch {
      toast.error('Não foi possível enviar a mensagem.');
    }
  }
  // ... resto do JSX seguindo o gabarito do ConversationThread:
  // header (onBack + avatar/nome da conversa + botao de detalhes quando
  // onOpenDetalhes existe, com <Users size={15}/> em grupos), scroll com
  // "Carregar mensagens anteriores", bolhas, composer.
}
```

Bolha (dentro do `itens.map((m) => ...)`) — alinhamento pelo autor:

```tsx
const minha = m.author_user_id === meuId;
// wrapper: className={`flex max-w-[78%] items-end gap-2 ${minha ? 'flex-row-reverse self-end' : 'self-start'}`}
// avatar: <img> com m.author_avatar_url ou <span className="avatar">{initialsOf(m.author_name)}</span>
// bolha: mesmas classes/estilo do ConversationThread (surface-hover p/ minha, card-bg p/ dos outros)
// nome do autor SEMPRE nas bolhas dos outros (grupos tem varios autores):
//   {!minha && <div className="mb-0.5 text-[11px] font-semibold text-[var(--text-muted)]">{m.author_name}</div>}
// corpo: {m.content && <p className="whitespace-pre-wrap"><MentionText text={m.content} /></p>}
// anexos:
{m.anexos.map((a) =>
  a.mime_type.startsWith('image/') ? (
    <AnexoImagem key={a.id} anexo={a} />
  ) : (
    <AnexoChip key={a.id} anexo={a} />
  ),
)}
```

`AnexoImagem`/`AnexoChip` são componentes locais do arquivo: `AnexoImagem` busca a URL assinada sob demanda com `useQuery({ queryKey: ['equipe-anexo-url', anexo.id], queryFn: () => signEquipeChatAnexoView(anexo.id), staleTime: 8 * 60_000 })` e renderiza `<img data-testid="anexo-imagem" className="mt-1 max-h-56 rounded-lg" src={url} />` clicável (abre a URL em nova aba com `window.open(url)`); `AnexoChip` renderiza `<button>` com `<FileText size={14} />` + nome + tamanho legível (`(size_bytes / 1024 / 1024).toFixed(1)}MB` quando ≥ 1MB, senão KB) que assina e abre no clique.

Composer (substitui o `<input>` do gabarito):

```tsx
<div className="flex flex-col gap-2 border-t border-[var(--border-color)] p-3.5">
  {anexosPendentes.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {anexosPendentes.map((a) => (
        <span key={a.id} className="flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1 text-xs">
          <Paperclip size={12} />
          <span className="max-w-[160px] truncate">{a.file_name}</span>
          <button
            onClick={() => setAnexosPendentes((prev) => prev.filter((x) => x.id !== a.id))}
            aria-label={`Remover ${a.file_name}`}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  )}
  <div className="flex items-end gap-2">
    <input
      ref={fileInputRef}
      type="file"
      accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,application/zip"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) void anexar(f);
      }}
    />
    <button
      onClick={() => fileInputRef.current?.click()}
      disabled={uploading}
      aria-label="Anexar arquivo"
      className="rounded-full border border-[var(--border-color)] p-2.5 text-[var(--text-muted)] disabled:opacity-50"
      style={{ background: 'var(--card-bg)', cursor: 'pointer' }}
    >
      <Paperclip size={15} />
    </button>
    <MentionTextarea
      rows={1}
      value={draft}
      onValueChange={setDraft}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void enviar();
        }
      }}
      placeholder="Mensagem para a equipe…"
      className="flex-1 resize-none rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 text-sm outline-none"
    />
    <button
      onClick={() => void enviar()}
      disabled={send.isPending || uploading || (!draft.trim() && anexosPendentes.length === 0)}
      aria-label="Enviar mensagem"
      className="rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50 bg-[var(--primary-color)]"
      style={{ border: 'none', cursor: 'pointer' }}
    >
      <Send size={15} />
    </button>
  </div>
</div>
```

Em `MensagensPage.tsx`, troque o `<ThreadPlaceholder />` provisório do slot equipe pelo `EquipeThread` com a mesma precedência de estados do modo clientes (`key={equipeConversaId}` para resetar estado ao trocar de conversa).

- [ ] **Step 4: Rodar e commitar**

Run: `npm run test -- EquipeThread && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

```bash
git add apps/crm/src/pages/mensagens/
git commit -m "feat(equipe-chat): thread de equipe com mencoes, anexos e mark-seen"
```

---

### Task 11: Nova conversa (DM/grupo), detalhes do grupo e badge somado

**Files:**
- Create: `apps/crm/src/pages/mensagens/components/NovaConversaDialog.tsx`
- Create: `apps/crm/src/pages/mensagens/components/EquipeDetalhesSheet.tsx`
- Modify: `apps/crm/src/pages/mensagens/MensagensPage.tsx` (estado dos dois overlays + `onNovaConversa`/`onOpenDetalhes`)
- Modify: `apps/crm/src/components/layout/Sidebar.tsx` e `apps/crm/src/components/layout/MobileNav.tsx` (badge = clientes + equipe)
- Test: `apps/crm/src/pages/mensagens/components/__tests__/NovaConversaDialog.test.tsx`
- Test: `apps/crm/src/pages/mensagens/components/__tests__/EquipeDetalhesSheet.test.tsx`
- Test: atualizar `apps/crm/src/components/layout/__tests__/Sidebar.test.tsx` (soma dos badges)

**Interfaces:**
- Consumes: `getEquipeChatMembers`/`createEquipeConversa`/`manageEquipeConversa` (Task 5), `useAuth()` (`role` para gate de criar grupo e `user.id` para excluir a si mesmo do picker), `Dialog`/`Sheet` de `@/components/ui`, `useEquipeChatUnread` (Task 8).
- Produces: `<NovaConversaDialog open onOpenChange onCreated={(conversaId) => void} />`; `<EquipeDetalhesSheet conversa={EquipeConversa} onClose onLeft={() => void} />`.

- [ ] **Step 1: Testes primeiro**

`NovaConversaDialog.test.tsx` (mock `@/store` com `vi.hoisted` + `@/context/AuthContext`):
1. Lista colegas de `getEquipeChatMembers` excluindo o próprio usuário.
2. Clique num colega chama `createEquipeConversa('dm', null, [user_id])` e `onCreated(id)`.
3. `role: 'agent'` NÃO vê o botão "Criar grupo"; `role: 'admin'` vê.
4. Fluxo grupo (admin): digita nome, seleciona 2 colegas, confirma → `createEquipeConversa('grupo', 'Nome', [ids])` → `onCreated`.
5. Erro da RPC → `toast.error` e dialog aberto.

`EquipeDetalhesSheet.test.tsx`:
1. Lista participantes (de `getEquipeChatMembers` filtrado — veja implementação) com papel.
2. Admin: renomear chama `manageEquipeConversa(id, 'rename', {nome})`; remover participante chama `('remove', {userId})`; adicionar chama `('add', {userId})`.
3. Agent: só o botão "Sair do grupo" (chama `('leave')` e depois `onLeft()`).
4. DM: sheet nem renderiza controles de gestão (só o colega).

Run: `npm run test -- "NovaConversaDialog|EquipeDetalhesSheet"` → FAIL.

- [ ] **Step 2: Implementar os dois componentes**

`NovaConversaDialog` — use `Dialog, DialogContent, DialogHeader, DialogTitle` de `@/components/ui/dialog` (padrão dos dialogs existentes da app). Estado interno `modo: 'lista' | 'grupo'`:

```tsx
// Esqueleto funcional (estilize com as classes utilitarias das listas acima):
export function NovaConversaDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (conversaId: number) => void;
}) {
  const { user, role } = useAuth();
  const podeCriarGrupo = role === 'owner' || role === 'admin';
  const [modo, setModo] = useState<'lista' | 'grupo'>('lista');
  const [nome, setNome] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const members = useQuery({
    queryKey: ['equipe-chat-members'],
    queryFn: getEquipeChatMembers,
    enabled: open,
  });
  const colegas = (members.data ?? []).filter((m) => m.user_id !== user?.id);

  async function abrirDm(userId: string) {
    try {
      const id = await createEquipeConversa('dm', null, [userId]);
      onCreated(id);
      onOpenChange(false);
    } catch {
      toast.error('Não foi possível abrir a conversa.');
    }
  }

  async function criarGrupo() {
    const n = nome.trim();
    if (!n || selecionados.length === 0) return;
    try {
      const id = await createEquipeConversa('grupo', n, selecionados);
      onCreated(id);
      onOpenChange(false);
    } catch {
      toast.error('Não foi possível criar o grupo.');
    }
  }
  // modo 'lista': busca + colegas (clique = abrirDm) + botao "Criar grupo"
  //   (podeCriarGrupo) que troca para modo 'grupo'.
  // modo 'grupo': input de nome + colegas com checkbox (toggle em
  //   selecionados) + "Criar" (disabled sem nome/selecionados) + "Voltar".
  // Ao fechar (onOpenChange(false)), resete modo/nome/selecionados/busca.
}
```

`EquipeDetalhesSheet` — `Sheet` no padrão `TarefaDetailSheet` (`open` fixo + `onOpenChange` → `onClose`, `w-full sm:max-w-[440px] overflow-y-auto`, `SheetDescription` `sr-only`). Participantes: `useQuery(['equipe-chat-members'])` + `useQuery(['equipe-participantes', conversaId])` — este último é um select direto (RLS cobre): `supabase.from('equipe_conversa_participantes').select('user_id').eq('conversa_id', conversaId)`; exponha-o como `getEquipeConversaParticipantes(conversaId): Promise<string[]>` no store (`equipeChat.ts`) com teste correspondente no arquivo da Task 5. Cruze com os members para nome/avatar/papel. Ações (todas com `useMutation` → invalidate `['equipe-conversas']` + `['equipe-participantes', conversaId]` + toast de erro): renomear (input inline + salvar), adicionar (select dos members fora do grupo), remover (ícone X por linha, só owner/admin), sair (botão no rodapé, qualquer participante; `onSuccess` → `onLeft()`).

Em `MensagensPage.tsx`: estados `novaConversaOpen` e `detalhesOpen`; `onNovaConversa={() => setNovaConversaOpen(true)}`; `onCreated={(id) => navigate(`/mensagens/equipe/${id}`)}`; `onOpenDetalhes={() => setDetalhesOpen(true)}` no `EquipeThread`; `onLeft={() => { setDetalhesOpen(false); navigate('/mensagens'); }}`.

- [ ] **Step 3: Badge somado**

Em `Sidebar.tsx` e `MobileNav.tsx` (mesma mudança nos dois):

```tsx
const mensagensUnread = useMensagensUnread();
const equipeUnread = useEquipeChatUnread();
const mensagensBadge = mensagensUnread + equipeUnread;
```

e troque `mensagensUnread` por `mensagensBadge` nos dois pontos de render do badge (`data-testid="mensagens-nav-badge"`). Atualize `Sidebar.test.tsx` com um caso somando os dois hooks (mock de ambos).

- [ ] **Step 4: Rodar e commitar**

Run: `npm run test -- "NovaConversaDialog|EquipeDetalhesSheet|Sidebar|MobileNav|store.equipeChat" && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

```bash
git add apps/crm/src/pages/mensagens/ apps/crm/src/components/layout/ apps/crm/src/store/equipeChat.ts apps/crm/src/__tests__/store.equipeChat.test.ts
git commit -m "feat(equipe-chat): nova conversa, detalhes do grupo e badge somado"
```

---

### Task 12: Verificação final integrada

**Files:**
- Nenhum novo; roda a bateria completa e fecha pendências.

- [ ] **Step 1: Bateria completa do CI local**

```bash
npm run lint
npm run format:check || npm run format
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
```

Expected: tudo verde. Se `npm run format` alterou arquivos, commite como `style: prettier`. Se `test:functions` sujou `deno.lock` ou `node_modules`, restaure (`git checkout -- deno.lock`; se `ls node_modules/.deno` existir, rode `npm ci`).

- [ ] **Step 2: Re-verificar colisão de versão de migration**

Run: `git fetch origin main && git ls-tree --name-only origin/main:supabase/migrations | tail -5`
Expected: nenhum prefixo `20260902120000/121000/122000` presente em main. Se main avançou além, renumere os três arquivos ACIMA do novo tail (e refaça o commit).

- [ ] **Step 3: Smoke no browser (staging)**

`npm run dev:staging` (worktrees começam sem `.env.staging` — copie do checkout principal ANTES: `cp /Users/eduardosouza/Projects/sm-crm/.env.staging .` — sem isso o `:staging` cai em PROD). Como as migrations ainda não estão aplicadas em staging neste ponto, o smoke se limita a: página `/mensagens` carrega sem regressão no modo clientes, `tsc` de dev sem erro no console do vite. O fluxo completo de equipe será validado no rollout (spec, seção Rollout).

- [ ] **Step 4: Commit final e resumo**

```bash
git add -A && git status --short
git commit -m "chore(equipe-chat): ajustes finais de verificacao" --allow-empty
```

Reporte: o que passou, o que ficou pendente de rollout (migrations staging/prod, deploy `equipe-chat-media` + redeploy `workspace-limits` e `post-media-cleanup-cron` com `--use-api --no-verify-jwt` conforme o caso, flag por plano no admin). NÃO abra PR sem instrução do usuário.

---

## Notas de execução

- Tasks 1→3 são sequenciais (schema → RPCs → anexos). Task 4 é independente após a 1. Task 5 depende da 2; Task 6 da 3; Task 7 da 3+6; Task 8 da 5+6; Tasks 9-11 da 8; Task 12 por último.
- Rollout (fora deste plano; runbook na seção Rollout do spec): `npx supabase db push --linked` primeiro em staging (conferir `cat supabase/.temp/project-ref` — o link FLIPA), deploy das functions com `--use-api`, flag dark até decisão de pricing.
