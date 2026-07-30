-- supabase/migrations/20260730000005_tarefas.sql
-- Team task tracker: tarefas + subtarefas (checklist) + workspace-level tags.
-- Spec: docs/superpowers/specs/2026-07-30-tarefas-team-task-tracker-design.md

-- ============ TAREFAS ============
CREATE TABLE tarefas (
  id             bigserial PRIMARY KEY,
  conta_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  titulo         text NOT NULL,
  descricao      text,
  status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'em_andamento', 'concluida')),
  responsavel_id bigint REFERENCES membros(id)  ON DELETE SET NULL,
  cliente_id     bigint REFERENCES clientes(id) ON DELETE SET NULL,
  data_limite    date,
  concluida_em   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Enables composite child FKs (subtarefas, tag links) that pin children to
  -- the parent's own workspace (ideia_files pattern).
  CONSTRAINT tarefas_id_conta_uq UNIQUE (id, conta_id)
);

CREATE INDEX tarefas_conta_idx        ON tarefas (conta_id);
CREATE INDEX tarefas_conta_status_idx ON tarefas (conta_id, status);
CREATE INDEX tarefas_responsavel_idx  ON tarefas (responsavel_id);
CREATE INDEX tarefas_cliente_idx      ON tarefas (cliente_id);
CREATE INDEX tarefas_data_limite_idx  ON tarefas (conta_id, data_limite);

CREATE OR REPLACE FUNCTION set_tarefas_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tarefas_updated_at
  BEFORE UPDATE ON tarefas
  FOR EACH ROW EXECUTE FUNCTION set_tarefas_updated_at();

-- concluida_em is owned by the DB: set on the transition into 'concluida',
-- cleared on reopen. Keeps "concluidas hoje" stats correct no matter which
-- code path writes status (form, kanban drag, detail sheet).
CREATE OR REPLACE FUNCTION tarefas_sync_concluida_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'concluida'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'concluida') THEN
    NEW.concluida_em := now();
  ELSIF NEW.status <> 'concluida' THEN
    NEW.concluida_em := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tarefas_concluida_em
  BEFORE INSERT OR UPDATE ON tarefas
  FOR EACH ROW EXECUTE FUNCTION tarefas_sync_concluida_em();

ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;

-- WITH CHECK also ties responsavel_id/cliente_id to the row's own workspace
-- (20260728000004 pattern). Plain FKs alone would let a member of workspace A
-- point at workspace B's membro/cliente; resolve_notification_targets reads
-- membros by id WITHOUT a conta_id check, so a cross-tenant responsavel_id
-- would leak a notification (task title) to another workspace's user.
-- Subqueries qualify the outer row (tarefas.x) explicitly: membros/clientes
-- carry their own conta_id, and a bare `conta_id` would resolve to the
-- subquery's scope, collapsing the comparison to a tautology.
CREATE POLICY tarefas_tenant_all ON tarefas
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (
      responsavel_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.membros m
        WHERE m.id = tarefas.responsavel_id AND m.conta_id = tarefas.conta_id
      )
    )
    AND (
      cliente_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.clientes c
        WHERE c.id = tarefas.cliente_id AND c.conta_id = tarefas.conta_id
      )
    )
  );

CREATE POLICY tarefas_service_role_bypass ON tarefas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ SUBTAREFAS (checklist) ============
CREATE TABLE subtarefas (
  id         bigserial PRIMARY KEY,
  tarefa_id  bigint NOT NULL,
  conta_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  titulo     text NOT NULL,
  concluida  boolean NOT NULL DEFAULT false,
  ordem      int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subtarefas_tarefa_fk
    FOREIGN KEY (tarefa_id, conta_id) REFERENCES tarefas(id, conta_id) ON DELETE CASCADE
);

CREATE INDEX subtarefas_tarefa_idx ON subtarefas (tarefa_id);

ALTER TABLE subtarefas ENABLE ROW LEVEL SECURITY;

CREATE POLICY subtarefas_tenant_all ON subtarefas
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY subtarefas_service_role_bypass ON subtarefas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ TAGS (workspace-level) ============
CREATE TABLE tarefa_tags (
  id         bigserial PRIMARY KEY,
  conta_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  cor        text NOT NULL DEFAULT '#94a3b8',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tarefa_tags_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT tarefa_tags_nome_uq     UNIQUE (conta_id, nome)
);

CREATE INDEX tarefa_tags_conta_idx ON tarefa_tags (conta_id);

ALTER TABLE tarefa_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY tarefa_tags_tenant_all ON tarefa_tags
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY tarefa_tags_service_role_bypass ON tarefa_tags
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE tarefa_tag_links (
  id        bigserial PRIMARY KEY,
  tarefa_id bigint NOT NULL,
  tag_id    bigint NOT NULL,
  conta_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Composite FKs pin the task AND the tag to the link's own workspace,
  -- making cross-tenant links structurally impossible (defense-in-depth).
  CONSTRAINT tarefa_tag_links_tarefa_fk
    FOREIGN KEY (tarefa_id, conta_id) REFERENCES tarefas(id, conta_id)     ON DELETE CASCADE,
  CONSTRAINT tarefa_tag_links_tag_fk
    FOREIGN KEY (tag_id, conta_id)    REFERENCES tarefa_tags(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT tarefa_tag_links_uq UNIQUE (tarefa_id, tag_id)
);

CREATE INDEX tarefa_tag_links_tarefa_idx ON tarefa_tag_links (tarefa_id);
CREATE INDEX tarefa_tag_links_tag_idx    ON tarefa_tag_links (tag_id);

ALTER TABLE tarefa_tag_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY tarefa_tag_links_tenant_all ON tarefa_tag_links
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY tarefa_tag_links_service_role_bypass ON tarefa_tag_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);
