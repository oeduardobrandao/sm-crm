-- =====================================================================
-- 20260805000002_post_status_automations.sql
-- Status-entry automations: workspace-defined rules that fire when a post
-- ENTERS a status (canonical or custom). v1 actions:
--   assign_responsavel — set the post's responsavel (BEFORE-trigger NEW
--     mutation; the existing notify_post_assigned AFTER trigger then emits
--     the assignment notification, since its WHEN clause has no OF-list)
--   notify — in-app notification to a chosen member, the post's
--     responsavel, or the owner/admin roles
-- Loops are structurally impossible: no action writes status, so a rule
-- can never trigger another. Belt-and-braces pg_trigger_depth() guard for
-- future action types.
-- =====================================================================

-- ---------- Table ------------------------------------------------------
create table post_status_automations (
  id                       uuid primary key default gen_random_uuid(),
  conta_id                 uuid not null references workspaces(id) on delete cascade,
  -- Exactly one trigger target. Canonical allows all 9 (notify on
  -- falha_publicacao is a headline use case).
  trigger_status           text check (trigger_status in
    ('rascunho', 'revisao_interna', 'aprovado_interno', 'enviado_cliente',
     'aprovado_cliente', 'correcao_cliente', 'agendado', 'postado', 'falha_publicacao')),
  trigger_custom_status_id uuid,
  action_type              text not null check (action_type in ('notify', 'assign_responsavel')),
  -- notify:             {"target":"member","membro_id":123} |
  --                     {"target":"responsavel"} |
  --                     {"target":"roles","roles":["owner","admin"]}
  -- assign_responsavel: {"membro_id":123}
  -- membro_id is user data: the z2 trigger re-validates it against the
  -- post's conta before acting.
  config                   jsonb not null default '{}'::jsonb,
  ativo                    boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint psa_exactly_one_trigger
    check ((trigger_status is null) <> (trigger_custom_status_id is null)),
  -- Composite FK: a rule can never reference another tenant's definition
  -- (pairs with post_status_definitions_id_conta_uq from 20260805000001).
  constraint psa_custom_status_same_tenant
    foreign key (trigger_custom_status_id, conta_id)
    references post_status_definitions (id, conta_id)
    on delete cascade
);

create index idx_psa_conta_ativo on post_status_automations (conta_id) where ativo;

create or replace function set_post_status_automations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger post_status_automations_updated_at
  before update on post_status_automations
  for each row execute function set_post_status_automations_updated_at();

-- ---------- Plan gate (INSERT-only: existing rules keep running after a
-- downgrade, per the repo's keep-existing policy) ------------------------
create trigger trg_feature_post_status_automations
  before insert on post_status_automations
  for each row execute function enforce_plan_feature('feature_custom_properties', 'direct', 'conta_id');

-- ---------- RLS (staff-only surface: owner/admin for every verb) --------
alter table post_status_automations enable row level security;

create policy psa_select on post_status_automations
  for select using (
    conta_id in (select public.get_my_conta_id())
    and public.get_my_role() in ('owner', 'admin')
  );

create policy psa_insert on post_status_automations
  for insert with check (
    conta_id in (select public.get_my_conta_id())
    and public.get_my_role() in ('owner', 'admin')
  );

create policy psa_update on post_status_automations
  for update using (
    conta_id in (select public.get_my_conta_id())
    and public.get_my_role() in ('owner', 'admin')
  )
  with check (conta_id in (select public.get_my_conta_id()));

create policy psa_delete on post_status_automations
  for delete using (
    conta_id in (select public.get_my_conta_id())
    and public.get_my_role() in ('owner', 'admin')
  );

create policy service_role_bypass_psa on post_status_automations
  for all to service_role using (true) with check (true);

-- ---------- notifications: add 'post_status_automation' ----------------
-- Type list copied from the LATEST definition (20260803000006_mencoes.sql)
-- -- re-adding a stale list would break newer inserts. This file
-- (20260805000002) is now the latest definition; the next migration to
-- touch notifications_type_check must copy from here.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation'
  )
);

-- ---------- Execution trigger (z2; name-ordered after z1) ---------------
create or replace function run_post_status_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r                 record;
  v_targets         uuid[];
  v_membro_id       bigint;
  v_meta            jsonb;
  v_status_label    text;
  v_client_name     text;
  v_status_changed  boolean := (new.status is distinct from old.status);
  v_custom_changed  boolean := (new.custom_status_id is distinct from old.custom_status_id);
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if not (v_status_changed or v_custom_changed) then
    return new;
  end if;

  -- Phase 1: assign_responsavel — pure NEW mutation, cannot recurse. The
  -- membro must belong to the post's workspace: config is user data and a
  -- foreign id would leak a cross-tenant notification via
  -- notify_post_assigned.
  for r in
    select a.* from post_status_automations a
     where a.conta_id = new.conta_id
       and a.ativo
       and a.action_type = 'assign_responsavel'
       and ((v_status_changed and a.trigger_status = new.status)
         or (v_custom_changed and a.trigger_custom_status_id = new.custom_status_id))
     order by a.created_at -- deterministic: the newest matching rule wins
  loop
    v_membro_id := nullif(r.config->>'membro_id', '')::bigint;
    if v_membro_id is not null and exists (
      select 1 from membros m where m.id = v_membro_id and m.conta_id = new.conta_id
    ) then
      new.responsavel_id := v_membro_id;
    end if;
  end loop;

  -- Phase 2: notify — best-effort (a notification failure must never roll
  -- back the status change). Runs after phase 1 so target 'responsavel'
  -- sees a just-assigned responsavel.
  begin
    for r in
      select a.* from post_status_automations a
       where a.conta_id = new.conta_id
         and a.ativo
         and a.action_type = 'notify'
         and ((v_status_changed and a.trigger_status = new.status)
           or (v_custom_changed and a.trigger_custom_status_id = new.custom_status_id))
    loop
      v_targets := case r.config->>'target'
        when 'member' then
          coalesce((
            select case when m.crm_user_id is null then '{}'::uuid[]
                        else array[m.crm_user_id] end
              from membros m
             where m.id = nullif(r.config->>'membro_id', '')::bigint
               and m.conta_id = new.conta_id
          ), '{}'::uuid[])
        when 'responsavel' then
          resolve_notification_targets(new.conta_id, new.responsavel_id, null)
        when 'roles' then
          resolve_notification_targets(new.conta_id, null, (
            select coalesce(array_agg(x), '{}'::text[])
              from jsonb_array_elements_text(coalesce(r.config->'roles', '[]'::jsonb)) x
              where x in ('owner', 'admin')
          ))
        else '{}'::uuid[]
      end;

      if v_targets is null or array_length(v_targets, 1) is null then
        continue;
      end if;

      select coalesce(
               (select nome from post_status_definitions where id = new.custom_status_id),
               new.status)
        into v_status_label;
      select c.nome into v_client_name
        from workflows w left join clientes c on c.id = w.cliente_id
       where w.id = new.workflow_id;

      v_meta := jsonb_build_object(
        'post_title', new.titulo,
        'post_id', new.id,
        'workflow_id', new.workflow_id,
        'client_name', v_client_name,
        'status_key', coalesce('custom:' || new.custom_status_id::text, new.status),
        'status_label', v_status_label
      );

      perform insert_notification_batch(
        new.conta_id,
        v_targets,
        'post_status_automation',
        '/entregas?drawer=' || new.workflow_id,
        v_meta,
        auth.uid()
      );
    end loop;
  exception when others then
    raise warning 'run_post_status_automations notify failed for post %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create trigger workflow_posts_z2_status_automations
  before update of status, custom_status_id on workflow_posts
  for each row execute function run_post_status_automations();
