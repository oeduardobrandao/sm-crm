-- 20260903000001_notification_center_phase1.sql
-- Central de Notificações, Fase 1 (spec 2026-09-02).
-- (a) notification_inapp_prefs: preferências in-app por tipo. Tabela SEPARADA da
--     notification_email_prefs de propósito: o bundle antigo do CRM upserta aquela
--     com onConflict user_id,type (PK atual) e faz SELECT sem filtro de canal —
--     qualquer mudança de chave ou mistura de linhas quebra chunks stale.
-- (b) post_approved vira o 9º tipo elegível do digest de e-mail.
-- (c) P0: policies de notifications passavam com user_id = auth.uid() apenas;
--     ex-membro removido continuava lendo notificações antigas do workspace.

-- ---------- (a) notification_inapp_prefs --------------------------------
create table if not exists notification_inapp_prefs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, type),
  constraint notification_inapp_prefs_type_check check (type in (
    'post_approved','post_correction','post_message','post_edit_suggestion',
    'idea_submitted','briefing_answered','step_activated','step_completed',
    'post_assigned','task_assigned','workflow_completed','deadline_approaching',
    'invite_accepted','member_role_changed','member_removed','client_message',
    'mention','post_status_automation','instagram_connected_by_client',
    'post_publish_failed','storage_autoclean_report','instagram_automation_failed',
    '__all__'
  ))
);

alter table notification_inapp_prefs enable row level security;

drop policy if exists nip_select on notification_inapp_prefs;
create policy nip_select on notification_inapp_prefs
  for select using (user_id = auth.uid());
drop policy if exists nip_insert on notification_inapp_prefs;
create policy nip_insert on notification_inapp_prefs
  for insert with check (user_id = auth.uid());
drop policy if exists nip_update on notification_inapp_prefs;
create policy nip_update on notification_inapp_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists nip_delete on notification_inapp_prefs;
create policy nip_delete on notification_inapp_prefs
  for delete using (user_id = auth.uid());

-- Mesmo racional da irmã (20260813000004): RLS é o gate, sem coluna de
-- escalação de privilégio, então grant pleno a authenticated é correto.
grant select, insert, update, delete on notification_inapp_prefs to authenticated;

-- ---------- (b) post_approved elegível a e-mail -------------------------
alter table notification_email_prefs
  drop constraint notification_email_prefs_type_check;
alter table notification_email_prefs
  add constraint notification_email_prefs_type_check check (type in (
    'post_approved','post_publish_failed','post_correction','post_message',
    'client_message','deadline_approaching','task_assigned','post_assigned',
    'mention','__all__'
  ));

-- Recria o claim com post_approved na lista (única mudança vs 20260813000005).
create or replace function claim_notification_emails(
  p_settle_before timestamptz,
  p_after         timestamptz,
  p_limit         int
)
returns table (id uuid, user_id uuid, type text, metadata jsonb, link text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update notifications n
     set emailed_at = now()
   where n.id in (
     select n2.id from notifications n2
     where n2.type = any (array[
       'post_approved','post_publish_failed','post_correction','post_message',
       'client_message','deadline_approaching','task_assigned','post_assigned',
       'mention'
     ])
       and n2.read_at is null and n2.dismissed_at is null and n2.emailed_at is null
       and n2.created_at <= p_settle_before and n2.created_at >= p_after
       and exists (
         select 1 from workspace_members wm
         where wm.workspace_id = n2.workspace_id and wm.user_id = n2.user_id
       )
       and not exists (
         select 1 from notification_email_prefs p
         where p.user_id = n2.user_id and p.enabled = false
           and (p.type = n2.type or p.type = '__all__')
       )
     order by n2.created_at asc
     limit p_limit
     for update skip locked
   )
  returning n.id, n.user_id, n.type, n.metadata, n.link, n.created_at;
$$;

-- REVOKE FROM PUBLIC também derruba service_role nesta instância — re-grant.
revoke all on function claim_notification_emails(timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function claim_notification_emails(timestamptz, timestamptz, int)
  to service_role;

-- ---------- (c) P0: vínculo vigente nas policies de notifications -------
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from workspace_members wm
      where wm.workspace_id = notifications.workspace_id
        and wm.user_id = auth.uid()
    )
  );

drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications
  for update using (
    user_id = auth.uid()
    and exists (
      select 1 from workspace_members wm
      where wm.workspace_id = notifications.workspace_id
        and wm.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from workspace_members wm
      where wm.workspace_id = notifications.workspace_id
        and wm.user_id = auth.uid()
    )
  );
