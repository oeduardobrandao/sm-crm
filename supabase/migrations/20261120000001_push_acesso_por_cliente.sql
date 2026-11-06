-- Push (iOS app) respects Acesso por cliente.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
--
-- 20261015000001 (push) predates the per-client scope, so its claim and badge
-- count read every notification of the user. This applies the e-mail claim's
-- rule (20261117000012) to both:
--   * claim_notification_pushes: a row with cliente_id of a client the
--     recipient doesn't see is pushed only if its item is his
--     (notification_item_visible_for). A row that fails is still stamped
--     pushed_at, so it never comes back. Also adds the linha editorial types,
--     which the shared renderer already knows.
--   * push_badge_counts: the icon badge counts only what that rule lets through.
-- Owner and 'todos' members never reach the helper (CASE short-circuits).
-- Signatures and grants are unchanged; the cron needs no redeploy.

create or replace function public.claim_notification_pushes(
  p_after timestamptz,
  p_limit int
)
returns table (id uuid, user_id uuid, workspace_id uuid, type text, metadata jsonb, link text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update notifications n
       set pushed_at = now()
     where n.id in (
       select n2.id from notifications n2
       where n2.type = any (array[
         'post_approved','post_publish_failed','post_correction','post_message',
         'client_message','deadline_approaching','task_assigned','post_assigned',
         'mention','post_edit_suggestion','post_client_reference',
         'idea_submitted','briefing_answered',
         'event_invited','event_updated','event_cancelled','event_reminder',
         'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
         'linha_editorial_aprovada','linha_editorial_ajustes'
       ])
         and n2.read_at is null and n2.dismissed_at is null and n2.pushed_at is null
         and n2.created_at >= p_after
         and exists (
           select 1 from workspace_members wm
           where wm.workspace_id = n2.workspace_id and wm.user_id = n2.user_id
         )
         and not exists (
           select 1 from notification_push_prefs p
           where p.user_id = n2.user_id and p.enabled = false
             and (p.type = n2.type or p.type = '__all__')
         )
         and exists (
           select 1 from push_devices d
           where d.user_id = n2.user_id and d.disabled_at is null
         )
       order by n2.created_at asc
       limit p_limit
       for update skip locked
     )
    returning n.id, n.user_id, n.workspace_id, n.type, n.metadata, n.link, n.created_at, n.cliente_id
  )
  -- E-mail claim's rule, in the notification's own workspace: scope, or the
  -- item is his. A row that fails was stamped above: not sent, never requeued.
  select c.id, c.user_id, c.workspace_id, c.type, c.metadata, c.link, c.created_at
    from claimed c
   where c.cliente_id is null
      or exists (
        select 1 from workspace_members wm
         where wm.workspace_id = c.workspace_id and wm.user_id = c.user_id
           and case
                 when wm.role = 'owner' or wm.client_scope = 'todos' then true
                 when exists (select 1 from workspace_member_clientes wmc
                               where wmc.workspace_id = c.workspace_id
                                 and wmc.user_id = c.user_id
                                 and wmc.cliente_id = c.cliente_id) then true
                 else public.notification_item_visible_for(c.user_id, c.workspace_id, c.cliente_id, c.metadata)
               end);
$$;

revoke all on function public.claim_notification_pushes(timestamptz, int) from public, anon, authenticated;
grant execute on function public.claim_notification_pushes(timestamptz, int) to service_role;

create or replace function public.push_badge_counts(p_user_ids uuid[])
returns table (user_id uuid, unread int)
language sql
stable
security definer
set search_path = public
as $$
  select n.user_id, count(*)::int
    from notifications n
    join workspace_members wm
      on wm.workspace_id = n.workspace_id and wm.user_id = n.user_id
   where n.user_id = any (p_user_ids)
     and n.read_at is null and n.dismissed_at is null
     and not exists (
       select 1 from notification_inapp_prefs p
       where p.user_id = n.user_id and p.enabled = false and p.type = n.type
     )
     and (
       n.cliente_id is null
       or case
            when wm.role = 'owner' or wm.client_scope = 'todos' then true
            when exists (select 1 from workspace_member_clientes wmc
                          where wmc.workspace_id = n.workspace_id
                            and wmc.user_id = n.user_id
                            and wmc.cliente_id = n.cliente_id) then true
            else public.notification_item_visible_for(n.user_id, n.workspace_id, n.cliente_id, n.metadata)
          end
     )
   group by n.user_id;
$$;

revoke all on function public.push_badge_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.push_badge_counts(uuid[]) to service_role;
