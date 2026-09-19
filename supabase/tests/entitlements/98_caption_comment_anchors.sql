\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for 20260925000016_post_comment_threads_caption_anchors.sql:
--   1. The anchor CHECK constraint (NULL anchor_end must be rejected).
--   2. save_ig_caption updates the caption and the listed threads' anchors in one call.
--   3. Tenant isolation: a member of conta A can neither save a caption on, nor
--      re-anchor threads of, conta B.
--   4. Grants: anon has no EXECUTE.
--   5. Anchor range guard (UTF-16 length, atomic rollback), NULL p_anchors.

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

  -- orphaned thread carrying offsets must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end, orphaned)
      values (v_post, v_ws, 'abc', v_user, 'ig_caption', 0, 3, true);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'orphaned caption thread with offsets must violate the CHECK';

  -- negative anchor_start must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
      values (v_post, v_ws, 'abc', v_user, 'ig_caption', -1, 3);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'caption thread with negative anchor_start must violate the CHECK';

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
  v_post_a2 bigint; v_t_a2 bigint;
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

  -- a SECOND post in the same conta with its own caption thread (same-tenant, other post)
  insert into workflow_posts (conta_id, cliente_id, status, ig_caption) values (v_ws_a, v_cli_a, 'rascunho', 'second post') returning id into v_post_a2;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post_a2, v_ws_a, 'sec', v_user, 'ig_caption', 0, 3) returning id into v_t_a2;

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
  exception when no_data_found then v_rejected := true; end;
  reset role;
  assert v_rejected, 'save_ig_caption on another workspace''s post must raise';
  select ig_caption into v_caption from workflow_posts where id = v_post_b;
  assert v_caption = 'other', 'conta B caption must be untouched';

  -- a thread of ANOTHER POST IN THE SAME CONTA listed in p_anchors is ignored
  -- (only the post_id guard protects this; RLS would allow the update)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform save_ig_caption(v_post_a, 'oh hi!', jsonb_build_array(
    jsonb_build_object('id', v_t_a2, 'anchor_start', 1, 'anchor_end', 2, 'orphaned', false, 'quoted_text', 'x')));
  reset role;
  select anchor_start, anchor_end, quoted_text into v_s, v_e, v_q from post_comment_threads where id = v_t_a2;
  assert v_s = 0 and v_e = 3 and v_q = 'sec', 'thread of another post in the same conta must not be re-anchored';

  -- a thread of another CONTA listed in p_anchors is ignored (tenant isolation)
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
-- 5. Anchor range guard (UTF-16 length) and NULL p_anchors
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint; v_t1 bigint; v_t2 bigint;
  v_caption text; v_s int; v_e int; v_rejected boolean; v_state text;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'A', 'A', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status, ig_caption) values (v_ws, v_cli, 'rascunho', 'original') returning id into v_post;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post, v_ws, 'orig', v_user, 'ig_caption', 0, 4) returning id into v_t1;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post, v_ws, 'inal', v_user, 'ig_caption', 4, 8) returning id into v_t2;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- (a) anchor_end beyond the caption length raises, and the whole call rolls back:
  -- t1 is valid and listed first, t2 is out of range; neither t1 nor the caption may change.
  v_rejected := false;
  begin
    perform save_ig_caption(v_post, 'short', jsonb_build_array(
      jsonb_build_object('id', v_t1, 'anchor_start', 1, 'anchor_end', 3, 'orphaned', false),
      jsonb_build_object('id', v_t2, 'anchor_start', 2, 'anchor_end', 6, 'orphaned', false)));
  exception when sqlstate '22023' then v_rejected := true; end;
  reset role;
  assert v_rejected, 'anchor_end beyond the caption length must raise 22023';
  select ig_caption into v_caption from workflow_posts where id = v_post;
  assert v_caption = 'original', format('caption must be unchanged after a rejected call, got %s', v_caption);
  select anchor_start, anchor_end into v_s, v_e from post_comment_threads where id = v_t1;
  assert v_s = 0 and v_e = 4, 'other anchors of a rejected call must be unchanged';

  -- (b) UTF-16 length: 'a' || emoji || 'b' has char_length 3 but UTF-16 length 4
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform save_ig_caption(v_post, 'a' || chr(128512) || 'b', jsonb_build_array(
    jsonb_build_object('id', v_t1, 'anchor_start', 1, 'anchor_end', 3, 'orphaned', false),
    jsonb_build_object('id', v_t2, 'anchor_start', 0, 'anchor_end', 4, 'orphaned', false)));
  reset role;
  select anchor_start, anchor_end into v_s, v_e from post_comment_threads where id = v_t1;
  assert v_s = 1 and v_e = 3, 'anchor covering the emoji ([1,3)) must be accepted';
  select anchor_start, anchor_end into v_s, v_e from post_comment_threads where id = v_t2;
  assert v_s = 0 and v_e = 4, 'anchor ending exactly at the UTF-16 length ([0,4)) must be accepted';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  v_rejected := false;
  begin
    perform save_ig_caption(v_post, 'a' || chr(128512) || 'b', jsonb_build_array(
      jsonb_build_object('id', v_t1, 'anchor_start', 0, 'anchor_end', 5, 'orphaned', false)));
  exception when sqlstate '22023' then v_rejected := true; end;
  reset role;
  assert v_rejected, 'anchor_end 5 on a UTF-16 length 4 caption must raise';

  -- orphaned anchors are exempt from the range check
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform save_ig_caption(v_post, 'x', jsonb_build_array(
    jsonb_build_object('id', v_t1, 'anchor_start', null, 'anchor_end', null, 'orphaned', true)));
  reset role;
  select orphaned::text into v_state from post_comment_threads where id = v_t1;
  assert v_state = 'true', 'orphaned anchor must be accepted regardless of caption length';

  -- p_anchors => NULL saves the caption without error
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform save_ig_caption(v_post, 'null anchors', null);
  reset role;
  select ig_caption into v_caption from workflow_posts where id = v_post;
  assert v_caption = 'null anchors', 'NULL p_anchors must still save the caption';

  raise notice 'PASS 98.5 anchor range guard and NULL p_anchors';
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
