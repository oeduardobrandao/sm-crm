\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for "Discussão da equipe dentro do post"
-- (20261025000001_post_discussao_geral.sql):
--   99.1 The 'geral' field value: anchor CHECK branch and one general thread per post.
--   99.2 Guards on post_comment_threads: no direct INSERT of a 'geral' thread by
--        authenticated, no UPDATE of its field/status/post_id/conta_id, no DELETE while
--        the post exists, and the post-delete cascade still removes it.
--   99.3 Guards on post_comments: author_id must be the caller on INSERT (any thread);
--        in a 'geral' thread only the author updates or deletes a message.

-- =====================================================================
-- 99.1 CHECK constraints and the unique general thread
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

  -- valid general thread: empty quote, no anchors, not orphaned, active
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (v_post, v_ws, '', v_user, 'geral');

  -- general thread with a quote must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
      values (v_post, v_ws, 'x', v_user, 'geral');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'geral thread with quoted_text must violate the CHECK';

  -- general thread with anchors must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
      values (v_post, v_ws, '', v_user, 'geral', 0, 3);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'geral thread with anchors must violate the CHECK';

  -- general thread with only one anchor must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start)
      values (v_post, v_ws, '', v_user, 'geral', 0);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'geral thread with anchor_start must violate the CHECK';

  -- orphaned general thread must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, orphaned)
      values (v_post, v_ws, '', v_user, 'geral', true);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'orphaned geral thread must violate the CHECK';

  -- resolved general thread must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, status)
      values (v_post, v_ws, '', v_user, 'geral', 'resolved');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'resolved geral thread must violate the CHECK';

  -- a second general thread on the same post must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
      values (v_post, v_ws, '', v_user, 'geral');
  exception when unique_violation then v_rejected := true; end;
  assert v_rejected, 'second geral thread on the same post must violate the unique index';

  -- unknown field values are still rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
      values (v_post, v_ws, '', v_user, 'outro');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'unknown field value must violate the field CHECK';

  -- legacy threads still insert (several per post)
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_post, v_ws, 'abc', v_user);
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_post, v_ws, 'def', v_user);
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post, v_ws, 'abc', v_user, 'ig_caption', 0, 3);
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, orphaned)
    values (v_post, v_ws, 'abc', v_user, 'ig_caption', true);

  raise notice 'PASS 99.1 geral CHECK branch and unique general thread';
end $$;
rollback;

-- =====================================================================
-- 99.2 Thread guards (authenticated member of A)
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a uuid; v_ws_b uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint; v_post2 bigint; v_post3 bigint;
  v_geral bigint; v_geral3 bigint; v_conteudo bigint; v_comment bigint;
  v_cli_b bigint; v_post_b bigint; v_geral_b bigint;
  v_rejected boolean; v_msg text; v_n int; v_status text;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws_a, v_cli, 'rascunho') returning id into v_post;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws_a, v_cli, 'rascunho') returning id into v_post2;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws_a, v_cli, 'rascunho') returning id into v_post3;

  -- seeded as postgres: authenticated cannot create a general thread directly
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (v_post, v_ws_a, '', v_user, 'geral') returning id into v_geral;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (v_post3, v_ws_a, '', v_user, 'geral') returning id into v_geral3;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_post, v_ws_a, 'abc', v_user) returning id into v_conteudo;
  insert into post_comments (thread_id, author_id, content)
    values (v_geral, v_user, 'oi') returning id into v_comment;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws_b, v_cli_b, 'rascunho') returning id into v_post_b;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (v_post_b, v_ws_a, '', v_user, 'geral') returning id into v_geral_b;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- (a) direct INSERT of a general thread is refused by RLS
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
      values (v_post2, v_ws_a, '', v_user, 'geral');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'authenticated must not insert a geral thread directly';

  -- legacy threads still insert as authenticated
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_post2, v_ws_a, 'abc', v_user);

  -- (b) UPDATE of a general thread's guarded columns raises the trigger error
  v_msg := null;
  begin
    update post_comment_threads set field = 'conteudo' where id = v_geral;
  exception when insufficient_privilege then v_msg := sqlerrm; end;
  assert v_msg = 'geral_thread_immutable', format('field change on geral must raise geral_thread_immutable, got %s', v_msg);

  v_msg := null;
  begin
    update post_comment_threads set status = 'resolved', resolved_by = v_user, resolved_at = now() where id = v_geral;
  exception when insufficient_privilege then v_msg := sqlerrm; end;
  assert v_msg = 'geral_thread_immutable', format('status change on geral must raise geral_thread_immutable, got %s', v_msg);

  v_msg := null;
  begin
    update post_comment_threads set post_id = v_post2 where id = v_geral;
  exception when insufficient_privilege then v_msg := sqlerrm; end;
  assert v_msg = 'geral_thread_immutable', format('post_id change on geral must raise geral_thread_immutable, got %s', v_msg);

  -- BEFORE ROW triggers fire before the RLS WITH CHECK, so the trigger message wins
  v_msg := null;
  begin
    update post_comment_threads set conta_id = v_ws_b where id = v_geral;
  exception when insufficient_privilege then v_msg := sqlerrm; end;
  assert v_msg = 'geral_thread_immutable', format('conta_id change on geral must raise geral_thread_immutable, got %s', v_msg);

  -- a legacy thread cannot become a general one
  v_msg := null;
  begin
    update post_comment_threads set field = 'geral', quoted_text = '' where id = v_conteudo;
  exception when insufficient_privilege then v_msg := sqlerrm; end;
  assert v_msg = 'geral_thread_immutable', format('field change to geral must raise geral_thread_immutable, got %s', v_msg);

  -- (c) legacy threads still resolve
  update post_comment_threads set status = 'resolved', resolved_by = v_user, resolved_at = now() where id = v_conteudo;
  get diagnostics v_n = row_count;
  assert v_n = 1, format('resolving a conteudo thread must update 1 row, got %s', v_n);

  -- (d) DELETE of a general thread raises while the post exists
  v_msg := null;
  begin
    delete from post_comment_threads where id = v_geral;
  exception when insufficient_privilege then v_msg := sqlerrm; end;
  assert v_msg = 'geral_thread_undeletable', format('deleting geral must raise geral_thread_undeletable, got %s', v_msg);

  -- the delete guard sees posts the caller's RLS hides (SECURITY DEFINER): a geral row
  -- carrying conta A on a post of workspace B is still undeletable by a member of A
  v_msg := null;
  begin
    delete from post_comment_threads where id = v_geral_b;
  exception when insufficient_privilege then v_msg := sqlerrm; end;
  assert v_msg = 'geral_thread_undeletable', format('deleting geral on a hidden post must raise, got %s', v_msg);

  -- (e) a member deleting the post cascades the general thread away
  delete from workflow_posts where id = v_post3;
  get diagnostics v_n = row_count;
  assert v_n = 1, format('member must delete post3, got %s rows', v_n);

  reset role;

  -- the guard is not role-specific: postgres hits it too
  v_msg := null;
  begin
    update post_comment_threads set conta_id = v_ws_b where id = v_geral;
  exception when insufficient_privilege then v_msg := sqlerrm; end;
  assert v_msg = 'geral_thread_immutable', format('conta_id change as postgres must raise, got %s', v_msg);

  select status into v_status from post_comment_threads where id = v_geral;
  assert v_status = 'active', 'geral thread must still be active';
  select status into v_status from post_comment_threads where id = v_conteudo;
  assert v_status = 'resolved', 'conteudo thread must be resolved';

  select count(*) into v_n from post_comment_threads where id = v_geral3;
  assert v_n = 0, 'member post delete must cascade the geral thread';

  -- (f) deleting the post as postgres cascades the general thread and its comments
  delete from workflow_posts where id = v_post;
  select count(*) into v_n from post_comment_threads where post_id = v_post;
  assert v_n = 0, format('post delete must cascade every thread, %s left', v_n);
  select count(*) into v_n from post_comments where id = v_comment;
  assert v_n = 0, 'post delete must cascade the geral thread comments';

  raise notice 'PASS 99.2 geral thread guards and cascade';
end $$;
rollback;

-- =====================================================================
-- 99.3 Comment guards (authenticated)
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_me uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
  v_cli bigint; v_post bigint; v_geral bigint; v_conteudo bigint;
  v_other_geral bigint; v_other_conteudo bigint; v_mine_geral bigint;
  v_rejected boolean; v_n int; v_content text;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_me), (v_other);
  insert into workspace_members (user_id, workspace_id, role) values (v_me, v_ws, 'owner'), (v_other, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_me, v_other);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_me, v_ws, 'A', 'A', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_post;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (v_post, v_ws, '', v_other, 'geral') returning id into v_geral;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_post, v_ws, 'abc', v_other) returning id into v_conteudo;
  insert into post_comments (thread_id, author_id, content)
    values (v_geral, v_other, 'do outro') returning id into v_other_geral;
  insert into post_comments (thread_id, author_id, content)
    values (v_conteudo, v_other, 'do outro') returning id into v_other_conteudo;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);

  -- (a) INSERT with someone else's author_id fails, in any thread
  v_rejected := false;
  begin
    insert into post_comments (thread_id, author_id, content) values (v_geral, v_other, 'forjado');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'forged author_id in a geral thread must be refused';

  v_rejected := false;
  begin
    insert into post_comments (thread_id, author_id, content) values (v_conteudo, v_other, 'forjado');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'forged author_id in a conteudo thread must be refused';

  -- (b) INSERT with own author_id succeeds
  insert into post_comments (thread_id, author_id, content) values (v_geral, v_me, 'meu')
    returning id into v_mine_geral;
  insert into post_comments (thread_id, author_id, content) values (v_conteudo, v_me, 'meu');

  -- (c) another user's message in a geral thread: UPDATE and DELETE affect 0 rows
  update post_comments set content = 'editado' where id = v_other_geral;
  get diagnostics v_n = row_count;
  assert v_n = 0, format('updating another user''s geral message must affect 0 rows, got %s', v_n);

  delete from post_comments where id = v_other_geral;
  get diagnostics v_n = row_count;
  assert v_n = 0, format('deleting another user''s geral message must affect 0 rows, got %s', v_n);

  -- own geral message: UPDATE works
  update post_comments set content = 'meu editado', updated_at = now() where id = v_mine_geral;
  get diagnostics v_n = row_count;
  assert v_n = 1, format('updating own geral message must affect 1 row, got %s', v_n);

  -- moving another user's legacy message into the geral thread is refused
  v_rejected := false;
  begin
    update post_comments set thread_id = v_geral where id = v_other_conteudo;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'moving another user''s message into a geral thread must be refused';

  -- (d) legacy: another user's message in a conteudo thread still updates (non-goal)
  update post_comments set content = 'editado' where id = v_other_conteudo;
  get diagnostics v_n = row_count;
  assert v_n = 1, format('updating another user''s conteudo message must still affect 1 row, got %s', v_n);

  reset role;

  select content into v_content from post_comments where id = v_other_geral;
  assert v_content = 'do outro', format('another user''s geral message must be unchanged, got %s', v_content);
  select content into v_content from post_comments where id = v_other_conteudo;
  assert v_content = 'editado', 'conteudo message must carry the legacy edit';
  select content into v_content from post_comments where id = v_mine_geral;
  assert v_content = 'meu editado', 'own geral message must carry the edit';

  -- own geral message: DELETE works
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_me)::text, true);
  delete from post_comments where id = v_mine_geral;
  get diagnostics v_n = row_count;
  assert v_n = 1, format('deleting own geral message must affect 1 row, got %s', v_n);
  reset role;

  raise notice 'PASS 99.3 comment author guards';
end $$;
rollback;
