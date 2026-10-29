-- =====================================================================
-- 20261105000001_edit_suggestion_rpcs_workspace_check.sql
--
-- accept_edit_suggestion and reject_edit_suggestion are SECURITY DEFINER,
-- granted to authenticated, and found the suggestion by id alone: RLS is
-- bypassed inside them, so any signed-in user of any workspace could accept
-- or reject another workspace's suggestion (ids are a sequential bigserial),
-- and accepting writes that workspace's workflow_posts content.
--
-- Both now raise the same 'Suggestion not found' as a missing id unless the
-- caller is in the suggestion's workspace, using the predicate of the table's
-- own RLS policy (conta_id IN (SELECT get_my_conta_id()), 20260521000001).
-- A service_role JWT still passes, so the existing service_role grant keeps
-- meaning what it says (no edge function calls either RPC today).
--
-- Signatures, bodies and lock order are otherwise identical to
-- 20260928150001 (accept) and 20260525000001 (reject); grants are restated.
-- =====================================================================

create or replace function accept_edit_suggestion(
  p_suggestion_id       bigint,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id    bigint;
  v_conta_id   uuid;
  v_suggestion record;
begin
  select post_id, conta_id into v_post_id, v_conta_id
    from post_edit_suggestions
    where id = p_suggestion_id;

  if v_post_id is null
     or (coalesce(auth.role(), '') <> 'service_role'
         and v_conta_id is distinct from get_my_conta_id()) then
    raise exception 'Suggestion not found';
  end if;

  perform 1 from workflow_posts where id = v_post_id for update;

  select * into v_suggestion
    from post_edit_suggestions
    where id = p_suggestion_id
    for update;

  if v_suggestion is null then
    raise exception 'Suggestion not found';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion is not pending (status: %)', v_suggestion.status;
  end if;

  if p_expected_updated_at is not null
     and v_suggestion.updated_at is distinct from p_expected_updated_at then
    raise exception 'suggestion_changed' using errcode = 'P0001';
  end if;

  perform set_config('app.accepting_edit_suggestion', v_suggestion.id::text, true);

  -- source is forced to 'client' (the TEXT is client-authored), while
  -- actor_user_id still resolves to auth.uid() via the content-version
  -- trigger's fallback (see 20260923000001).
  perform set_config('app.event_source', 'client', true);
  perform set_config('app.post_edit_suggestion_id', v_suggestion.id::text, true);

  update workflow_posts set
    conteudo       = coalesce(v_suggestion.suggested_conteudo, conteudo),
    conteudo_plain = coalesce(v_suggestion.suggested_conteudo_plain, conteudo_plain),
    ig_caption     = v_suggestion.suggested_ig_caption
  where id = v_suggestion.post_id;

  update post_edit_suggestions set
    status      = 'accepted',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_suggestion_id;
end;
$$;

revoke all on function accept_edit_suggestion(bigint, timestamptz) from public, anon;
grant execute on function accept_edit_suggestion(bigint, timestamptz) to authenticated, service_role;

create or replace function reject_edit_suggestion(
  p_suggestion_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suggestion record;
begin
  select * into v_suggestion
    from post_edit_suggestions
    where id = p_suggestion_id
    for update;

  if v_suggestion is null
     or (coalesce(auth.role(), '') <> 'service_role'
         and v_suggestion.conta_id is distinct from get_my_conta_id()) then
    raise exception 'Suggestion not found';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion is not pending (status: %)', v_suggestion.status;
  end if;

  update post_edit_suggestions set
    status      = 'rejected',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_suggestion_id;
end;
$$;

revoke all on function reject_edit_suggestion(bigint) from public, anon;
grant execute on function reject_edit_suggestion(bigint) to authenticated, service_role;
