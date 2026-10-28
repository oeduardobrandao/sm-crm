-- Tarefas: histórico de alterações (2/2).
-- Spec: docs/superpowers/specs/2026-10-28-tarefas-kpis-comentarios-historico-design.md (section 3).
--
-- tarefa_eventos is written ONLY by the SECURITY DEFINER AFTER triggers below (on tarefas,
-- subtarefas and tarefa_tag_links) and by the one-off backfill. Every member who can see the
-- task can read its history (which is why audit_log, owner/admin only, is not used).
--
-- Two rules every trigger here follows:
--   * Its body swallows its own errors (BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING):
--     a history bug must never fail a task write, a series RPC or the recurrence cron.
--   * Every snapshot lookup is tenant-scoped (AND conta_id = <the task's conta>).
--     tarefas.responsavel_id / cliente_id are single-column FKs and service-role or legacy
--     writes bypass the RLS WITH CHECK that pins them to the task's workspace, so a lookup by
--     id alone could copy another workspace's name into this one's history. A miss stores
--     {id, nome: null}.
--
-- Value shapes (de / para):
--   criada                 para {serie: bool}
--   status, titulo, prazo  JSON strings (or null)
--   responsavel, cliente   {id, nome} (or null)
--   recorrencia            series id (or null)
--   descricao              both null ("editou a descrição")
--   subtarefa_*            para {titulo}
--   tag_*                  para {id, nome, cor}
-- txid lets the reader net out the tag delete + reinsert pairs that the series RPC
-- (20260925000030) writes in one transaction.
--
-- Actor: auth.uid(), and the name of that user's membro in the task's workspace (else their
-- profile name). NULL actor = system (the recurrence pg_cron, the MCP edge function's
-- service-role client); the UI renders it as "Automação". criada falls back to tarefas.user_id so MCP-created tasks
-- credit their creator.

-- ---------------------------------------------------------------------
-- 1. tarefa_eventos
-- ---------------------------------------------------------------------
CREATE TABLE public.tarefa_eventos (
  id            bigserial PRIMARY KEY,
  conta_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tarefa_id     bigint NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN (
                  'criada', 'status', 'responsavel', 'prazo', 'titulo', 'descricao',
                  'cliente', 'recorrencia',
                  'subtarefa_adicionada', 'subtarefa_concluida', 'subtarefa_reaberta',
                  'subtarefa_removida',
                  'tag_adicionada', 'tag_removida'
                )),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Snapshot of the actor's membro name in this workspace at write time.
  actor_nome    text,
  de            jsonb,
  para          jsonb,
  txid          bigint NOT NULL DEFAULT txid_current(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- The history goes with the task.
  CONSTRAINT tarefa_eventos_tarefa_fk
    FOREIGN KEY (tarefa_id, conta_id) REFERENCES public.tarefas(id, conta_id) ON DELETE CASCADE
);

CREATE INDEX tarefa_eventos_tarefa_created_idx
  ON public.tarefa_eventos (tarefa_id, created_at);

ALTER TABLE public.tarefa_eventos ENABLE ROW LEVEL SECURITY;

-- Same predicate as tarefas: visible to the workspace. No write policy.
CREATE POLICY tarefa_eventos_select ON public.tarefa_eventos
  FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY tarefa_eventos_service_role_bypass ON public.tarefa_eventos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.tarefa_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tarefa_eventos TO authenticated;
GRANT ALL ON TABLE public.tarefa_eventos TO service_role;
REVOKE ALL ON SEQUENCE public.tarefa_eventos_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.tarefa_eventos_id_seq TO service_role;

-- ---------------------------------------------------------------------
-- 2. Private helper: one event row
-- ---------------------------------------------------------------------
-- Actor = COALESCE(p_actor, auth.uid()); actor_nome from that user's membro in p_conta, else
-- their profiles.nome while they are a workspace_members row of p_conta (NULL otherwise; the UI
-- then says "Usuário removido").
-- p_actor exists only for criada's creator fallback; every other caller omits it.
CREATE OR REPLACE FUNCTION public._tarefa_evento_registrar(
  p_conta  uuid,
  p_tarefa bigint,
  p_tipo   text,
  p_de     jsonb,
  p_para   jsonb,
  p_actor  uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_nome  text;
BEGIN
  IF v_actor IS NOT NULL THEN
    -- A user with no membro row in this workspace (an owner who never added themselves to
    -- the team) falls back to their profile name, like tarefa_comentario_enviar, but only
    -- while they belong to this workspace: p_actor can be tarefas.user_id, which the client
    -- supplies and RLS does not check, so an outsider's id must not leak their name here.
    v_nome := COALESCE(
      (SELECT m.nome
         FROM membros m
        WHERE m.crm_user_id = v_actor
          AND m.conta_id = p_conta
        ORDER BY m.id
        LIMIT 1),
      (SELECT p.nome
         FROM profiles p
        WHERE p.id = v_actor
          AND EXISTS (SELECT 1 FROM workspace_members wm
                       WHERE wm.user_id = p.id AND wm.workspace_id = p_conta))
    );
  END IF;

  INSERT INTO tarefa_eventos (conta_id, tarefa_id, tipo, actor_user_id, actor_nome, de, para)
  VALUES (p_conta, p_tarefa, p_tipo, v_actor, v_nome, p_de, p_para);
END;
$$;

REVOKE ALL ON FUNCTION public._tarefa_evento_registrar(uuid, bigint, text, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- {id, nome} snapshots, tenant-scoped; NULL id -> NULL.
CREATE OR REPLACE FUNCTION public._tarefa_evento_membro(p_conta uuid, p_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN p_id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p_id,
    'nome', (SELECT m.nome FROM membros m WHERE m.id = p_id AND m.conta_id = p_conta)
  ) END;
$$;

CREATE OR REPLACE FUNCTION public._tarefa_evento_cliente(p_conta uuid, p_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN p_id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p_id,
    'nome', (SELECT c.nome FROM clientes c WHERE c.id = p_id AND c.conta_id = p_conta)
  ) END;
$$;

REVOKE ALL ON FUNCTION public._tarefa_evento_membro(uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._tarefa_evento_cliente(uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. tarefas: criada + one event per changed field
-- ---------------------------------------------------------------------
-- tarefas.user_id has no FK (deleted-user drift is real on prod, 20261001000001): the
-- creator fallback is used only when that user still exists, because actor_user_id has one.
CREATE OR REPLACE FUNCTION public.tarefas_evento_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM _tarefa_evento_registrar(
      NEW.conta_id, NEW.id, 'criada', NULL,
      jsonb_build_object('serie', NEW.serie_id IS NOT NULL),
      COALESCE(
        auth.uid(),
        CASE WHEN EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id) THEN NEW.user_id END
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tarefas_evento_insert failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tarefas_evento_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM _tarefa_evento_registrar(NEW.conta_id, NEW.id, 'status',
        to_jsonb(OLD.status), to_jsonb(NEW.status));
    END IF;

    IF NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id THEN
      PERFORM _tarefa_evento_registrar(NEW.conta_id, NEW.id, 'responsavel',
        _tarefa_evento_membro(NEW.conta_id, OLD.responsavel_id),
        _tarefa_evento_membro(NEW.conta_id, NEW.responsavel_id));
    END IF;

    IF NEW.data_limite IS DISTINCT FROM OLD.data_limite THEN
      PERFORM _tarefa_evento_registrar(NEW.conta_id, NEW.id, 'prazo',
        to_jsonb(OLD.data_limite), to_jsonb(NEW.data_limite));
    END IF;

    IF NEW.titulo IS DISTINCT FROM OLD.titulo THEN
      PERFORM _tarefa_evento_registrar(NEW.conta_id, NEW.id, 'titulo',
        to_jsonb(OLD.titulo), to_jsonb(NEW.titulo));
    END IF;

    IF NEW.descricao IS DISTINCT FROM OLD.descricao
       OR NEW.descricao_rich IS DISTINCT FROM OLD.descricao_rich THEN
      PERFORM _tarefa_evento_registrar(NEW.conta_id, NEW.id, 'descricao', NULL, NULL);
    END IF;

    IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id THEN
      PERFORM _tarefa_evento_registrar(NEW.conta_id, NEW.id, 'cliente',
        _tarefa_evento_cliente(NEW.conta_id, OLD.cliente_id),
        _tarefa_evento_cliente(NEW.conta_id, NEW.cliente_id));
    END IF;

    IF NEW.serie_id IS DISTINCT FROM OLD.serie_id THEN
      PERFORM _tarefa_evento_registrar(NEW.conta_id, NEW.id, 'recorrencia',
        to_jsonb(OLD.serie_id), to_jsonb(NEW.serie_id));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tarefas_evento_update failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tarefas_evento_insert
  AFTER INSERT ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.tarefas_evento_insert_fn();

-- UPDATE OF: an updated_at-only write never enters the function.
CREATE TRIGGER tarefas_evento_update
  AFTER UPDATE OF status, responsavel_id, data_limite, titulo, descricao, descricao_rich,
                  cliente_id, serie_id
  ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.tarefas_evento_update_fn();

-- ---------------------------------------------------------------------
-- 4. subtarefas and tarefa_tag_links
-- ---------------------------------------------------------------------
-- Deleting a task cascades to its subtasks and tag links; their AFTER DELETE triggers run
-- once the task row is gone. They return early then (the history goes with the task), so
-- no event insert can hit the composite FK on that path. Same for a workspace deletion.
CREATE OR REPLACE FUNCTION public.subtarefas_evento_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta  uuid;
  v_tarefa bigint;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_conta := OLD.conta_id; v_tarefa := OLD.tarefa_id;
    ELSE
      v_conta := NEW.conta_id; v_tarefa := NEW.tarefa_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM tarefas WHERE id = v_tarefa AND conta_id = v_conta) THEN
      RETURN NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
      PERFORM _tarefa_evento_registrar(v_conta, v_tarefa, 'subtarefa_adicionada', NULL,
        jsonb_build_object('titulo', NEW.titulo));
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.concluida IS DISTINCT FROM OLD.concluida THEN
        PERFORM _tarefa_evento_registrar(v_conta, v_tarefa,
          CASE WHEN NEW.concluida THEN 'subtarefa_concluida' ELSE 'subtarefa_reaberta' END,
          NULL, jsonb_build_object('titulo', NEW.titulo));
      END IF;
    ELSE
      PERFORM _tarefa_evento_registrar(v_conta, v_tarefa, 'subtarefa_removida', NULL,
        jsonb_build_object('titulo', OLD.titulo));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'subtarefas_evento failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

CREATE TRIGGER subtarefas_evento
  AFTER INSERT OR DELETE OR UPDATE OF concluida ON public.subtarefas
  FOR EACH ROW EXECUTE FUNCTION public.subtarefas_evento_fn();

-- A tag deleted from the workspace cascades to its links after the tag row is gone, so
-- those tag_removida events carry {id, nome: null, cor: null}, like any snapshot miss.
CREATE OR REPLACE FUNCTION public.tarefa_tag_links_evento_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta  uuid;
  v_tarefa bigint;
  v_tag    bigint;
  v_para   jsonb;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_conta := OLD.conta_id; v_tarefa := OLD.tarefa_id; v_tag := OLD.tag_id;
    ELSE
      v_conta := NEW.conta_id; v_tarefa := NEW.tarefa_id; v_tag := NEW.tag_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM tarefas WHERE id = v_tarefa AND conta_id = v_conta) THEN
      RETURN NULL;
    END IF;

    SELECT jsonb_build_object('id', v_tag, 'nome', tg.nome, 'cor', tg.cor) INTO v_para
      FROM (SELECT 1) one
      LEFT JOIN tarefa_tags tg ON tg.id = v_tag AND tg.conta_id = v_conta;

    PERFORM _tarefa_evento_registrar(v_conta, v_tarefa,
      CASE WHEN TG_OP = 'INSERT' THEN 'tag_adicionada' ELSE 'tag_removida' END,
      NULL, v_para);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tarefa_tag_links_evento failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tarefa_tag_links_evento
  AFTER INSERT OR DELETE ON public.tarefa_tag_links
  FOR EACH ROW EXECUTE FUNCTION public.tarefa_tag_links_evento_fn();

-- Trigger functions fire without EXECUTE; no API role calls them (tarefas_serie_ao_*_fn shape).
REVOKE ALL ON FUNCTION public.tarefas_evento_insert_fn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefas_evento_insert_fn() TO service_role;
REVOKE ALL ON FUNCTION public.tarefas_evento_update_fn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefas_evento_update_fn() TO service_role;
REVOKE ALL ON FUNCTION public.subtarefas_evento_fn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subtarefas_evento_fn() TO service_role;
REVOKE ALL ON FUNCTION public.tarefa_tag_links_evento_fn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefa_tag_links_evento_fn() TO service_role;

-- ---------------------------------------------------------------------
-- 5. Backfill
-- ---------------------------------------------------------------------
-- Nothing before this migration is inferable except: one criada per task at created_at
-- (actor = the creator while they still exist in auth.users; actor_nome from their membro
-- in the task's workspace, else their profile name if they belong to it, either way), and
-- for concluded tasks one status event (de null, para "concluida") at concluida_em with no
-- actor. The timeline marks the start with "Histórico registrado a partir de 28/10/2026".
-- Idempotent: a task that already has the event is skipped. A function (not inline SQL) so
-- the psql suite can exercise it.
CREATE OR REPLACE FUNCTION public._tarefa_eventos_backfill()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tarefa_eventos (conta_id, tarefa_id, tipo, actor_user_id, actor_nome, de, para, created_at)
  SELECT t.conta_id, t.id, 'criada', u.id,
         COALESCE(
           (SELECT m.nome FROM membros m
             WHERE m.crm_user_id = t.user_id AND m.conta_id = t.conta_id
             ORDER BY m.id LIMIT 1),
           -- tenant-scoped like _tarefa_evento_registrar: tarefas.user_id is client-supplied
           (SELECT p.nome FROM profiles p
             WHERE p.id = t.user_id
               AND EXISTS (SELECT 1 FROM workspace_members wm
                            WHERE wm.user_id = p.id AND wm.workspace_id = t.conta_id))
         ),
         NULL,
         jsonb_build_object('serie', t.serie_id IS NOT NULL),
         t.created_at
    FROM tarefas t
    LEFT JOIN auth.users u ON u.id = t.user_id
   WHERE NOT EXISTS (
     SELECT 1 FROM tarefa_eventos e WHERE e.tarefa_id = t.id AND e.tipo = 'criada'
   );

  INSERT INTO tarefa_eventos (conta_id, tarefa_id, tipo, actor_user_id, actor_nome, de, para, created_at)
  SELECT t.conta_id, t.id, 'status', NULL, NULL, NULL, to_jsonb('concluida'::text), t.concluida_em
    FROM tarefas t
   WHERE t.status = 'concluida'
     AND t.concluida_em IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM tarefa_eventos e WHERE e.tarefa_id = t.id AND e.tipo = 'status'
     );
END;
$$;

REVOKE ALL ON FUNCTION public._tarefa_eventos_backfill()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public._tarefa_eventos_backfill();
