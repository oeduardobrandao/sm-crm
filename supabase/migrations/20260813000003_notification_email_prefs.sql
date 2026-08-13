-- 20260813000003_notification_email_prefs.sql
-- Per-user, per-type opt-out for agency notification emails. Stores only
-- overrides: NO row = default ON. A row enabled=false = opted out of that type.
-- type='__all__' with enabled=false = master "pause all email" switch.
create table if not exists notification_email_prefs (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  type       text    not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, type),
  constraint notification_email_prefs_type_check check (type in (
    'post_publish_failed','post_correction','post_message','client_message',
    'deadline_approaching','task_assigned','post_assigned','mention','__all__'
  ))
);

alter table notification_email_prefs enable row level security;

drop policy if exists nep_select on notification_email_prefs;
create policy nep_select on notification_email_prefs
  for select using (user_id = auth.uid());
drop policy if exists nep_insert on notification_email_prefs;
create policy nep_insert on notification_email_prefs
  for insert with check (user_id = auth.uid());
drop policy if exists nep_update on notification_email_prefs;
create policy nep_update on notification_email_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists nep_delete on notification_email_prefs;
create policy nep_delete on notification_email_prefs
  for delete using (user_id = auth.uid());

-- RLS is the gate; there is no privilege-escalation column here (unlike membros),
-- so a plain full-table grant to authenticated is correct.
grant select, insert, update, delete on notification_email_prefs to authenticated;
