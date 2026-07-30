-- Founder notification emails: enrich the thank-you candidate RPC with plan
-- info so the internal subscription notice can name the plan and its status.
-- Spec: docs/superpowers/specs/2026-07-30-founder-notification-emails-design.md
--
-- Return-type change requires DROP + CREATE (CREATE OR REPLACE cannot change
-- OUT columns). Grants are re-applied below; the drop is safe because only the
-- lifecycle-email-cron edge function (service role) calls this RPC.

drop function if exists get_thankyou_email_candidates();

-- Same candidate semantics as 20260730000001, plus plan_name / sub_status /
-- billing_interval passthrough. plan_name falls back to the raw plan_id when
-- the plans row is missing; all three are nullable and the handler tolerates
-- their absence (deploy-order safety).
create function get_thankyou_email_candidates()
returns table (
  workspace_id uuid,
  workspace_name text,
  owner_email text,
  owner_nome text,
  attempts int,
  plan_name text,
  sub_status text,
  billing_interval text
)
language sql
security definer
set search_path = public
as $$
  select ws.id, ws.name, u.email::text, p.nome, coalesce(le.attempts, 0),
         coalesce(pl.name, s.plan_id), s.status, s.billing_interval
  from workspace_subscriptions s
  join workspaces ws on ws.id = s.workspace_id
  left join plans pl on pl.id = s.plan_id
  cross join lateral (
    select wm.user_id
    from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) owner_pick
  join auth.users u on u.id = owner_pick.user_id
  left join profiles p on p.id = owner_pick.user_id
  left join lifecycle_emails le
    on le.email_type = 'subscription_thanks' and le.workspace_id = ws.id
  where s.status in ('trialing', 'active')
    and u.email is not null
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 30))
  order by s.created_at asc, ws.id asc
  limit 50
$$;

-- Lock to the service role. GRANT explicitly: REVOKE FROM PUBLIC alone also
-- strips service_role (repo gotcha - check proacl, not has_function_privilege).
revoke all on function get_thankyou_email_candidates() from public, anon, authenticated;
grant execute on function get_thankyou_email_candidates() to service_role;
