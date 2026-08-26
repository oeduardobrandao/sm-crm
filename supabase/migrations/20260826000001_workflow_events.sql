-- =====================================================================
-- 20260826000001_workflow_events.sql
-- Workflow-level history ("Historico do fluxo"): event table + RLS +
-- internal record_workflow_event() helper + capture triggers on
-- workflows (INSERT + UPDATE) and workflow_etapas (UPDATE).
--
-- Styled directly on 20260606000001_post_status_events.sql: best-effort
-- capture (RAISE WARNING on failure, never rolls back the underlying
-- write), actor/source resolution via app.actor_id / app.event_source
-- GUCs falling back to auth.uid(), service_role bypass RLS policy.
--
-- Suppression: every trigger function here checks
-- app.suppress_workflow_events = '1' and returns immediately when set.
-- A later migration's RPCs (migrate_workflow_template,
-- propagate_template_to_workflows) will set that GUC before their own
-- writes and call record_workflow_event() directly so a single logical
-- operation emits one deliberate event instead of noise from the raw
-- row-level triggers.
-- =====================================================================

-- ---------- Table -----------------------------------------------------
create table if not exists workflow_events (
  id            bigserial primary key,
  workflow_id   bigint not null references workflows(id) on delete cascade,
  conta_id      uuid   not null,
  event_type    text   not null check (event_type in (
    'criado','etapa_iniciada','etapa_concluida','etapa_revertida','etapa_editada',
    'fluxo_editado','fluxo_concluido','fluxo_reaberto','fluxo_arquivado',
    'template_migrado','template_propagado')),
  etapa_id      bigint,              -- SNAPSHOT of the etapa id, deliberately NO FK:
                                     -- migrate_workflow_template DELETEs+reinserts all etapas,
                                     -- and SET NULL would orphan every prior event, breaking
                                     -- inicio/conclusao pairing. Identity must survive deletion.
  etapa_nome    text,                -- snapshot, survives etapa deletion
  source        text not null check (source in ('workspace_user','client','system')),
  actor_user_id uuid,
  actor_name    text,                -- snapshot from profiles.nome
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Same-transaction events share now(), so ordering ties are broken by id --
-- this index must be (workflow_id, created_at, id), not just (workflow_id, created_at).
create index if not exists idx_workflow_events_wf_created
  on workflow_events (workflow_id, created_at, id);

-- ---------- Internal helper: record_workflow_event --------------------
-- SECURITY DEFINER. Resolves actor/source/actor_name exactly like
-- record_post_status_event() and inserts one row. Does NOT check the
-- suppression GUC (only the trigger functions below do) -- this lets a
-- later migration's RPCs call it directly while suppression is active
-- for the row-level triggers, so one logical operation emits exactly
-- one event instead of one-per-row-touched.
create or replace function record_workflow_event(
  p_workflow_id    bigint,
  p_conta_id       uuid,
  p_event_type     text,
  p_etapa_id       bigint,
  p_etapa_nome     text,
  p_metadata       jsonb,
  p_actor_fallback uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid;
  v_source     text;
  v_actor_name text;
begin
  v_actor := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid(), p_actor_fallback);
  v_source := coalesce(
    nullif(current_setting('app.event_source', true), ''),
    case when v_actor is not null then 'workspace_user' else 'system' end
  );

  if v_actor is not null then
    select nome into v_actor_name from profiles where id = v_actor;
  end if;

  insert into workflow_events
    (workflow_id, conta_id, event_type, etapa_id, etapa_nome, source,
     actor_user_id, actor_name, metadata)
  values
    (p_workflow_id, p_conta_id, p_event_type, p_etapa_id, p_etapa_nome, v_source,
     v_actor, v_actor_name, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- Security hardening (P1 finding in review): this function is
-- SECURITY DEFINER and runs with the definer's (postgres) privileges
-- regardless of caller. Without revoking PUBLIC/anon/authenticated,
-- any authenticated user could call it directly over PostgREST's
-- /rpc/record_workflow_event and forge history events into any
-- workspace's workflow_events. Only the owner -- via the SECURITY
-- DEFINER triggers below and future RPCs in a later migration -- may
-- call it; no role is granted EXECUTE.
revoke all on function record_workflow_event(bigint, uuid, text, bigint, text, jsonb, uuid) from public, anon, authenticated;

-- ---------- Trigger A: workflows AFTER INSERT -> 'criado' -------------
create or replace function record_workflow_created_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_nome text;
  v_cliente_nome  text;
  v_metadata      jsonb;
begin
  if coalesce(current_setting('app.suppress_workflow_events', true), '') = '1' then
    return new;
  end if;

  begin
    -- Tenant-scoped label resolution (P1 finding): template_id / cliente_id
    -- are global-scope FKs with no RLS check that the referenced row belongs
    -- to the same tenant as NEW.conta_id. Scope every lookup to
    -- conta_id = NEW.conta_id and omit the label entirely when not found in
    -- that scope, so a corrupted/cross-tenant FK never snapshots another
    -- workspace's name into a row readable by this workspace.
    v_template_nome := null;
    if new.template_id is not null then
      select nome into v_template_nome
      from workflow_templates
      where id = new.template_id and conta_id = new.conta_id;
    end if;

    v_cliente_nome := null;
    if new.cliente_id is not null then
      select nome into v_cliente_nome
      from clientes
      where id = new.cliente_id and conta_id = new.conta_id;
    end if;

    v_metadata := jsonb_build_object(
      'titulo', new.titulo,
      'recorrente', new.recorrente,
      'created_via', new.created_via,
      'template_id', new.template_id
    );
    if v_template_nome is not null then
      v_metadata := v_metadata || jsonb_build_object('template_nome', v_template_nome);
    end if;
    if v_cliente_nome is not null then
      v_metadata := v_metadata || jsonb_build_object('cliente_nome', v_cliente_nome);
    end if;

    -- Actor fallback: MCP-created and data-import-created workflows set
    -- user_id to the creating actor even though they run as service_role
    -- with no auth.uid(). The fallback attributes the event to that user
    -- without special-casing those paths.
    perform record_workflow_event(
      new.id, new.conta_id, 'criado', null, null, v_metadata, new.user_id
    );
  exception when others then
    raise warning 'record_workflow_created_event failed for workflow %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists workflows_created_event on workflows;
create trigger workflows_created_event
  after insert on workflows
  for each row
  execute function record_workflow_created_event();

-- ---------- Trigger B: workflows AFTER UPDATE --------------------------
-- Single trigger function, two independent branches -- both may fire from
-- the same row UPDATE. Branch 1 (status transition) is gated on an
-- internal `is distinct from` check rather than the trigger's WHEN clause,
-- because branch 2 (column diff) must still run when status is unchanged.
create or replace function record_workflow_updated_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta       uuid := new.conta_id;
  v_etapa_id    bigint;
  v_etapa_nome  text;
  v_changes     jsonb := '[]'::jsonb;
  v_from_label  text;
  v_to_label    text;
  v_entry       jsonb;
begin
  if coalesce(current_setting('app.suppress_workflow_events', true), '') = '1' then
    return new;
  end if;

  begin
    -- Branch 1: status transition -----------------------------------
    if old.status is distinct from new.status then
      if new.status = 'concluido' then
        perform record_workflow_event(new.id, v_conta, 'fluxo_concluido', null, null, '{}'::jsonb);
      elsif old.status = 'concluido' and new.status = 'ativo' then
        -- "Start anchor" for duration calculations on the client: the
        -- etapa-level reactivation write that happens as part of a reopen
        -- is itself suppressed (see Trigger C's inference table -- the
        -- concluido->ativo transition while the parent is still concluido
        -- at trigger time emits nothing at the etapa level), so this event
        -- carries the current etapa snapshot instead.
        select id, nome into v_etapa_id, v_etapa_nome
        from workflow_etapas
        where workflow_id = new.id and ordem = new.etapa_atual;

        perform record_workflow_event(new.id, v_conta, 'fluxo_reaberto', v_etapa_id, v_etapa_nome, '{}'::jsonb);
      end if;

      if new.status = 'arquivado' then
        perform record_workflow_event(new.id, v_conta, 'fluxo_arquivado', null, null, '{}'::jsonb);
      end if;
    end if;

    -- Branch 2: column diff (runs unconditionally, independent of
    -- branch 1 -- a single UPDATE can touch both a status column and a
    -- watched column). Watched: titulo, cliente_id, recorrente,
    -- link_notion, link_drive. Explicitly NOT watched: position (kanban
    -- drag-reorder would spam events), etapa_atual (redundant with
    -- etapa-level events), status (branch 1), template_id/modo_prazo
    -- (only ever changed by migrate_workflow_template, which suppresses
    -- this trigger and emits its own event), user_id, created_via.
    if old.titulo is distinct from new.titulo then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'titulo', 'from', to_jsonb(old.titulo), 'to', to_jsonb(new.titulo)));
    end if;

    if old.cliente_id is distinct from new.cliente_id then
      v_from_label := null;
      v_to_label := null;
      if old.cliente_id is not null then
        select nome into v_from_label from clientes where id = old.cliente_id and conta_id = v_conta;
      end if;
      if new.cliente_id is not null then
        select nome into v_to_label from clientes where id = new.cliente_id and conta_id = v_conta;
      end if;

      v_entry := jsonb_build_object('field', 'cliente_id', 'from', to_jsonb(old.cliente_id), 'to', to_jsonb(new.cliente_id));
      if v_from_label is not null then
        v_entry := v_entry || jsonb_build_object('from_label', v_from_label);
      end if;
      if v_to_label is not null then
        v_entry := v_entry || jsonb_build_object('to_label', v_to_label);
      end if;
      v_changes := v_changes || jsonb_build_array(v_entry);
    end if;

    if old.recorrente is distinct from new.recorrente then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'recorrente', 'from', to_jsonb(old.recorrente), 'to', to_jsonb(new.recorrente)));
    end if;

    if old.link_notion is distinct from new.link_notion then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'link_notion', 'from', to_jsonb(old.link_notion), 'to', to_jsonb(new.link_notion)));
    end if;

    if old.link_drive is distinct from new.link_drive then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'link_drive', 'from', to_jsonb(old.link_drive), 'to', to_jsonb(new.link_drive)));
    end if;

    if jsonb_array_length(v_changes) > 0 then
      perform record_workflow_event(
        new.id, v_conta, 'fluxo_editado', null, null, jsonb_build_object('changes', v_changes)
      );
    end if;
  exception when others then
    raise warning 'record_workflow_updated_event failed for workflow %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists workflows_updated_event on workflows;
create trigger workflows_updated_event
  after update on workflows
  for each row
  execute function record_workflow_updated_event();

-- ---------- Trigger C: workflow_etapas AFTER UPDATE --------------------
-- workflow_etapas has no conta_id column -- fetch the parent workflow's
-- conta_id and status once at the top of the function body.
create or replace function record_workflow_etapa_updated_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta          uuid;
  v_wf_status      text;
  v_voltou_de      text;
  v_voltou_de_id   bigint;
  v_changes        jsonb := '[]'::jsonb;
  v_from_label     text;
  v_to_label       text;
  v_entry          jsonb;
  v_status_event   text;
  v_status_meta    jsonb := '{}'::jsonb;
begin
  if coalesce(current_setting('app.suppress_workflow_events', true), '') = '1' then
    return new;
  end if;

  begin
    select conta_id, status into v_conta, v_wf_status
    from workflows where id = new.workflow_id;

    -- Status-transition inference table (implemented exactly, no more/less):
    --   pendente -> ativo                                  => etapa_iniciada
    --   ativo -> concluido                                 => etapa_concluida
    --   concluido -> ativo, parent still ativo              => etapa_revertida
    --   concluido -> ativo, parent still concluido           => nothing (reopen path, Trigger B branch 1 handles it)
    --   ativo -> pendente                                   => nothing (revert's first write)
    --   pendente -> concluido                                => etapa_concluida (defensive, no current caller)
    --   concluido -> pendente                                => nothing (defensive, no current caller)
    --   status unchanged                                     => nothing from this branch
    v_status_event := null;

    if old.status is distinct from new.status then
      if old.status = 'pendente' and new.status = 'ativo' then
        v_status_event := 'etapa_iniciada';
      elsif old.status = 'ativo' and new.status = 'concluido' then
        v_status_event := 'etapa_concluida';
      elsif old.status = 'concluido' and new.status = 'ativo' and v_wf_status = 'ativo' then
        v_status_event := 'etapa_revertida';

        -- Resolve "what step we're backing out of": the etapa with the
        -- smallest ordem greater than new.ordem. At the instant this
        -- trigger fires, that row has already been written to pendente by
        -- the frontend's first revertEtapa write, but its nome is untouched.
        select id, nome into v_voltou_de_id, v_voltou_de
        from workflow_etapas
        where workflow_id = new.workflow_id and ordem > new.ordem
        order by ordem asc
        limit 1;

        if v_voltou_de is not null then
          v_status_meta := jsonb_build_object('voltou_de', v_voltou_de, 'voltou_de_etapa_id', v_voltou_de_id);
        end if;
      elsif old.status = 'pendente' and new.status = 'concluido' then
        v_status_event := 'etapa_concluida';
      end if;
      -- old.status = 'concluido' and new.status = 'ativo' with a still-concluido
      -- parent (the reopen path), old.status = 'ativo' and new.status = 'pendente'
      -- (revert's first write), and 'concluido' -> 'pendente' all emit nothing here.
    end if;

    if v_status_event is not null then
      perform record_workflow_event(
        new.workflow_id, v_conta, v_status_event, new.id, new.nome, v_status_meta
      );
    end if;

    -- Diff branch: runs regardless of whether the status branch fired above
    -- (a single UPDATE could in principle touch both a status column and a
    -- watched column, and both must be reflected). A single UPDATE that
    -- changes both a status column and a watched non-status column will
    -- therefore emit two events (a status event and an etapa_editada) --
    -- this is intentional, not a bug to fix.
    -- Watched: nome, prazo_dias, tipo_prazo, responsavel_id, data_limite,
    -- tipo. NOT watched: status, iniciado_em, concluido_em, ordem, workflow_id.
    if old.nome is distinct from new.nome then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'nome', 'from', to_jsonb(old.nome), 'to', to_jsonb(new.nome)));
    end if;

    if old.prazo_dias is distinct from new.prazo_dias then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'prazo_dias', 'from', to_jsonb(old.prazo_dias), 'to', to_jsonb(new.prazo_dias)));
    end if;

    if old.tipo_prazo is distinct from new.tipo_prazo then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'tipo_prazo', 'from', to_jsonb(old.tipo_prazo), 'to', to_jsonb(new.tipo_prazo)));
    end if;

    if old.responsavel_id is distinct from new.responsavel_id then
      v_from_label := null;
      v_to_label := null;
      if old.responsavel_id is not null then
        select nome into v_from_label from membros where id = old.responsavel_id and conta_id = v_conta;
      end if;
      if new.responsavel_id is not null then
        select nome into v_to_label from membros where id = new.responsavel_id and conta_id = v_conta;
      end if;

      v_entry := jsonb_build_object('field', 'responsavel_id', 'from', to_jsonb(old.responsavel_id), 'to', to_jsonb(new.responsavel_id));
      if v_from_label is not null then
        v_entry := v_entry || jsonb_build_object('from_label', v_from_label);
      end if;
      if v_to_label is not null then
        v_entry := v_entry || jsonb_build_object('to_label', v_to_label);
      end if;
      v_changes := v_changes || jsonb_build_array(v_entry);
    end if;

    if old.data_limite is distinct from new.data_limite then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'data_limite', 'from', to_jsonb(old.data_limite), 'to', to_jsonb(new.data_limite)));
    end if;

    if old.tipo is distinct from new.tipo then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'tipo', 'from', to_jsonb(old.tipo), 'to', to_jsonb(new.tipo)));
    end if;

    if jsonb_array_length(v_changes) > 0 then
      perform record_workflow_event(
        new.workflow_id, v_conta, 'etapa_editada', new.id, new.nome, jsonb_build_object('changes', v_changes)
      );
    end if;
  exception when others then
    raise warning 'record_workflow_etapa_updated_event failed for workflow %: %', new.workflow_id, sqlerrm;
  end;

  return new;
end;
$$;

-- Do not create INSERT or DELETE triggers on workflow_etapas in this
-- migration: etapa creation is covered by the workflows INSERT trigger's
-- 'criado' event, and this is a documented, intentional gap (a mid-flight
-- addWorkflowEtapa call produces no event).
drop trigger if exists workflow_etapas_updated_event on workflow_etapas;
create trigger workflow_etapas_updated_event
  after update on workflow_etapas
  for each row
  execute function record_workflow_etapa_updated_event();

-- ---------- RLS -------------------------------------------------------
alter table workflow_events enable row level security;

-- Any workspace member may read (unlike audit_log's owner/admin-only
-- policy -- do not copy that one; history is a whole-team feature).
drop policy if exists workflow_events_select on workflow_events;
create policy workflow_events_select on workflow_events
  for select using (conta_id in (select public.get_my_conta_id()));

-- No INSERT/UPDATE/DELETE policy for authenticated/anon: the only writers
-- are the SECURITY DEFINER triggers/functions above (owned by postgres)
-- and the service role.
drop policy if exists service_role_bypass_workflow_events on workflow_events;
create policy service_role_bypass_workflow_events on workflow_events
  for all to service_role using (true) with check (true);
