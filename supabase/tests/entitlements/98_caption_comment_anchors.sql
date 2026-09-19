\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for 20260925000016_post_comment_threads_caption_anchors.sql:
--   1. The anchor CHECK constraint (NULL anchor_end must be rejected).
--   2. save_ig_caption updates the caption and the listed threads' anchors in one call.
--   3. Tenant isolation: a member of conta A can neither save a caption on, nor
--      re-anchor threads of, conta B.
--   4. Grants: anon has no EXECUTE.

-- =====================================================================
-- 1. CHECK constraint
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint; v_rejected boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'A', 'A', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_post;

  -- valid caption thread
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post, v_ws, 'abc', v_user, 'ig_caption', 0, 3);
  -- valid orphaned caption thread with NULL offsets
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, orphaned)
    values (v_post, v_ws, 'abc', v_user, 'ig_caption', true);
  -- valid legacy content thread (defaults)
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_post, v_ws, 'abc', v_user);

  -- caption thread with NULL anchor_end must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
      values (v_post, v_ws, 'abc', v_user, 'ig_caption', 0, null);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'caption thread with NULL anchor_end must violate the CHECK';

  -- caption thread with empty / inverted range must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
      values (v_post, v_ws, 'abc', v_user, 'ig_caption', 4, 4);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'caption thread with anchor_end <= anchor_start must violate the CHECK';

  -- content thread carrying offsets must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
      values (v_post, v_ws, 'abc', v_user, 'conteudo', 0, 3);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'content thread with offsets must violate the CHECK';

  raise notice 'PASS 98.1 anchor CHECK constraint';
end $$;
rollback;

-- =====================================================================
-- 2 + 3. save_ig_caption: atomic update and tenant isolation
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a uuid; v_ws_b uuid; v_user uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint; v_post_a bigint; v_post_b bigint;
  v_t_a bigint; v_t_a_content bigint; v_t_b bigint;
  v_caption text; v_s int; v_e int; v_orph boolean; v_q text; v_rejected boolean;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;
  insert into workflow_posts (conta_id, cliente_id, status, ig_caption) values (v_ws_a, v_cli_a, 'rascunho', 'hello world') returning id into v_post_a;
  insert into workflow_posts (conta_id, cliente_id, status, ig_caption) values (v_ws_b, v_cli_b, 'rascunho', 'other') returning id into v_post_b;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post_a, v_ws_a, 'world', v_user, 'ig_caption', 6, 11) returning id into v_t_a;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_post_a, v_ws_a, 'content', v_user) returning id into v_t_a_content;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post_b, v_ws_b, 'other', v_user, 'ig_caption', 0, 5) returning id into v_t_b;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 2. atomic update: caption + anchors together, content threads untouched
  perform save_ig_caption(v_post_a, 'oh hello world!', jsonb_build_array(
    jsonb_build_object('id', v_t_a, 'anchor_start', 9, 'anchor_end', 14, 'orphaned', false, 'quoted_text', 'world'),
    jsonb_build_object('id', v_t_a_content, 'anchor_start', 1, 'anchor_end', 2, 'orphaned', false)));
  reset role;

  select ig_caption into v_caption from workflow_posts where id = v_post_a;
  assert v_caption = 'oh hello world!', format('caption not saved: %s', v_caption);
  select anchor_start, anchor_end, orphaned, quoted_text into v_s, v_e, v_orph, v_q
    from post_comment_threads where id = v_t_a;
  assert v_s = 9 and v_e = 14 and not v_orph and v_q = 'world', 'caption thread anchors not updated';
  select anchor_start into v_s from post_comment_threads where id = v_t_a_content;
  assert v_s is null, 'content thread must not be touched by save_ig_caption';

  -- orphaning nulls offsets and keeps quoted_text
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform save_ig_caption(v_post_a, 'oh hi!', jsonb_build_array(
    jsonb_build_object('id', v_t_a, 'anchor_start', null, 'anchor_end', null, 'orphaned', true)));
  reset role;
  select anchor_start, anchor_end, orphaned, quoted_text into v_s, v_e, v_orph, v_q
    from post_comment_threads where id = v_t_a;
  assert v_s is null and v_e is null and v_orph and v_q = 'world', 'orphaned thread must have NULL offsets and keep quoted_text';

  -- 3. tenant isolation: cannot save a caption on conta B's post
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  v_rejected := false;
  begin
    perform save_ig_caption(v_post_b, 'hijacked', '[]'::jsonb);
  exception when others then v_rejected := true; end;
  reset role;
  assert v_rejected, 'save_ig_caption on another workspace''s post must raise';
  select ig_caption into v_caption from workflow_posts where id = v_post_b;
  assert v_caption = 'other', 'conta B caption must be untouched';

  -- a thread of another post listed in p_anchors is ignored
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform save_ig_caption(v_post_a, 'oh hi!', jsonb_build_array(
    jsonb_build_object('id', v_t_b, 'anchor_start', 1, 'anchor_end', 2, 'orphaned', false, 'quoted_text', 'x')));
  reset role;
  select anchor_start into v_s from post_comment_threads where id = v_t_b;
  assert v_s = 0, 'thread of another post must not be re-anchored';

  raise notice 'PASS 98.2/98.3 save_ig_caption atomic update and isolation';
end $$;
rollback;

-- =====================================================================
-- 4. Grants
-- =====================================================================
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.save_ig_caption(bigint,text,jsonb)', 'execute'),
    'anon must not execute save_ig_caption';
  assert has_function_privilege('authenticated', 'public.save_ig_caption(bigint,text,jsonb)', 'execute'),
    'authenticated must execute save_ig_caption';
  raise notice 'PASS 98.4 grants';
end $$;
rollback;
