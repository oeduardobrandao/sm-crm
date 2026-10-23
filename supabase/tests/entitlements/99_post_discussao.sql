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

-- =====================================================================
-- Shared seed for 99.4 to 99.7 (session-temporary; each section rolls back its data)
--   ws A: a (owner), b2 (agent), resp (agent, responsável of p1 via membros m_resp)
--   ws B: bu (owner), post pb
--   A: workflow wf with posts p1 (responsável m_resp), p2, p3; membro m_b2 (crm b2)
-- =====================================================================
create or replace function pg_temp.pd_seed() returns jsonb language plpgsql as $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_a uuid := gen_random_uuid(); v_b2 uuid := gen_random_uuid();
  v_resp uuid := gen_random_uuid(); v_bu uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint; v_wf bigint; v_m_b2 bigint; v_m_resp bigint;
  v_p1 bigint; v_p2 bigint; v_p3 bigint; v_pb bigint;
begin
  v_ws_a := et_make_workspace('max');  -- 99.7 adds a 4th member
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_a), (v_b2), (v_resp), (v_bu);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_a, v_ws_a, 'owner'), (v_b2, v_ws_a, 'agent'), (v_resp, v_ws_a, 'agent'), (v_bu, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id in (v_a, v_b2, v_resp);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_bu;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_a, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_bu, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_a, v_ws_a, v_cli_a, 'Fluxo', 'ativo') returning id into v_wf;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_a, v_ws_a, 'Bia', v_b2) returning id into v_m_b2;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_a, v_ws_a, 'Rui', v_resp) returning id into v_m_resp;
  insert into workflow_posts (conta_id, cliente_id, workflow_id, responsavel_id, status)
    values (v_ws_a, v_cli_a, v_wf, v_m_resp, 'rascunho') returning id into v_p1;
  insert into workflow_posts (conta_id, cliente_id, workflow_id, status)
    values (v_ws_a, v_cli_a, v_wf, 'rascunho') returning id into v_p2;
  insert into workflow_posts (conta_id, cliente_id, workflow_id, status)
    values (v_ws_a, v_cli_a, v_wf, 'rascunho') returning id into v_p3;
  insert into workflow_posts (conta_id, cliente_id, status)
    values (v_ws_b, v_cli_b, 'rascunho') returning id into v_pb;
  return jsonb_build_object(
    'ws_a', v_ws_a, 'ws_b', v_ws_b, 'a', v_a, 'b2', v_b2, 'resp', v_resp, 'bu', v_bu,
    'wf', v_wf, 'm_b2', v_m_b2, 'm_resp', v_m_resp,
    'p1', v_p1, 'p2', v_p2, 'p3', v_p3, 'pb', v_pb);
end $$;

create or replace function pg_temp.pd_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
end $$;

-- =====================================================================
-- 99.4 post_discussao_enviar
-- =====================================================================
begin;
select et_grant_hosted_parity(array['post_discussao_participantes']);
do $$
declare
  s jsonb := pg_temp.pd_seed();
  v_ws_a uuid := s->>'ws_a'; v_ws_b uuid := s->>'ws_b';
  v_a uuid := s->>'a'; v_bu uuid := s->>'bu';
  v_p1 bigint := s->>'p1'; v_p2 bigint := s->>'p2'; v_pb bigint := s->>'pb';
  v_m_b2 bigint := s->>'m_b2';
  v_t_cont bigint; v_t_res bigint; v_t_other bigint; v_t_mis bigint;
  v_row post_comments; v_row2 post_comments; v_n int; v_geral bigint; v_q text; v_by uuid;
  v_state text; v_bad text;
begin
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p1, v_ws_a, 'abc', v_a) returning id into v_t_cont;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, status)
    values (v_p1, v_ws_a, 'def', v_a, 'resolved') returning id into v_t_res;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p2, v_ws_a, 'ghi', v_a) returning id into v_t_other;
  -- malformed: thread on A's post carrying conta B
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p1, v_ws_b, 'jkl', v_a) returning id into v_t_mis;

  perform pg_temp.pd_as(v_a);

  -- (a) first send creates the general thread; content is trimmed
  select * into v_row from post_discussao_enviar(v_p1, '  oi  ');
  assert v_row.author_id = v_a, 'enviar must write author_id = caller';
  assert v_row.content = 'oi', format('enviar must store trimmed content, got %L', v_row.content);
  v_geral := v_row.thread_id;

  -- (b) second send reuses it
  select * into v_row2 from post_discussao_enviar(v_p1, 'de novo');
  assert v_row2.thread_id = v_geral, 'second send must reuse the general thread';

  -- (c) reply in an active anchored thread of the same post
  select * into v_row from post_discussao_enviar(v_p1, 'resposta', v_t_cont);
  assert v_row.thread_id = v_t_cont, 'p_thread_id must insert in that thread';

  -- (d) invalid thread / post / content raise
  foreach v_bad in array array['other_post', 'resolved', 'mismatch', 'post_b', 'empty', 'blank', 'long'] loop
    v_state := null;
    begin
      case v_bad
        when 'other_post' then perform post_discussao_enviar(v_p1, 'x', v_t_other);
        when 'resolved'   then perform post_discussao_enviar(v_p1, 'x', v_t_res);
        when 'mismatch'   then perform post_discussao_enviar(v_p1, 'x', v_t_mis);
        when 'post_b'     then perform post_discussao_enviar(v_pb, 'x');
        when 'empty'      then perform post_discussao_enviar(v_p1, '');
        when 'blank'      then perform post_discussao_enviar(v_p1, '   ');
        when 'long'       then perform post_discussao_enviar(v_p1, repeat('x', 4001));
      end case;
    exception when others then v_state := sqlerrm;
    end;
    -- assert the RPC's own error: sync_mentions would also reject a mismatched thread
    -- ('host not found'), which must not be what makes this pass
    assert v_state = case v_bad
        when 'other_post' then 'thread_not_found'
        when 'resolved'   then 'thread_resolved'
        when 'mismatch'   then 'thread_not_found'
        when 'post_b'     then 'post_not_found'
        when 'long'       then 'content_too_long'
        else 'content_empty' end,
      format('enviar case %s raised %L', v_bad, v_state);
  end loop;

  -- 4000 characters is the inclusive limit
  perform post_discussao_enviar(v_p1, repeat('y', 4000));

  -- (e) a mention token creates the mencoes row in the same call; bad tokens are ignored
  select * into v_row from post_discussao_enviar(v_p1,
    'oi @[Bia](membro:' || v_m_b2 || ') @[X](membro:999999999) @[Y](membro:99999999999999999999999)');

  -- (f) the transaction-scoped flag is cleared right after the INSERT
  assert coalesce(current_setting('app.discussao_via_rpc', true), '') = '',
    'app.discussao_via_rpc must be cleared after enviar';

  -- a member of B cannot send to A's post
  perform pg_temp.pd_as(v_bu);
  v_state := null;
  begin
    perform post_discussao_enviar(v_p1, 'intruso');
  exception when others then v_state := sqlstate;
  end;
  assert v_state = 'P0002', format('member of B sending to A must raise P0002, got %s', v_state);

  reset role;

  select count(*) into v_n from post_comment_threads where post_id = v_p1 and field = 'geral';
  assert v_n = 1, format('exactly one general thread expected, got %s', v_n);
  select quoted_text, created_by into v_q, v_by from post_comment_threads where id = v_geral;
  assert v_q = '' and v_by = v_a, 'general thread must have empty quote and created_by = caller';
  select count(*) into v_n from mencoes
   where host_type = 'post_comment' and host_id = v_row.id and mentioned_membro_id = v_m_b2;
  assert v_n = 1, 'mention token must create one mencoes row in the same call';
  select count(*) into v_n from mencoes where host_type = 'post_comment' and host_id = v_row.id;
  assert v_n = 1, format('invalid mention tokens must be ignored, got %s rows', v_n);
  select count(*) into v_n from post_comments where content = 'intruso' or content = 'x';
  assert v_n = 0, 'rejected sends must write nothing';

  raise notice 'PASS 99.4 post_discussao_enviar';
end $$;
rollback;

-- =====================================================================
-- 99.5 post_discussao_marcar_lido
-- =====================================================================
begin;
select et_grant_hosted_parity(array['post_discussao_participantes']);
do $$
declare
  s jsonb := pg_temp.pd_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_b2 uuid := s->>'b2';
  v_p1 bigint := s->>'p1'; v_p2 bigint := s->>'p2'; v_pb bigint := s->>'pb';
  v_t1 bigint; v_t2 bigint; v_c1 bigint; v_c2 bigint; v_c_other bigint;
  v_last bigint; v_seg boolean; v_conta uuid; v_state text;
begin
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p1, v_ws_a, 'abc', v_a) returning id into v_t1;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p2, v_ws_a, 'abc', v_a) returning id into v_t2;
  insert into post_comments (thread_id, author_id, content) values (v_t1, v_a, '1') returning id into v_c1;
  insert into post_comments (thread_id, author_id, content) values (v_t1, v_a, '2') returning id into v_c2;
  insert into post_comments (thread_id, author_id, content) values (v_t2, v_a, '3') returning id into v_c_other;

  perform pg_temp.pd_as(v_b2);
  perform post_discussao_marcar_lido(v_p1, v_c2);
  perform post_discussao_marcar_lido(v_p1, v_c1);  -- never moves back

  v_state := null;
  begin perform post_discussao_marcar_lido(v_p1, v_c_other);
  exception when others then v_state := sqlerrm; end;
  assert v_state = 'comment_not_found', format('comment of another post must raise comment_not_found, got %s', v_state);

  v_state := null;
  begin perform post_discussao_marcar_lido(v_pb, v_c1);
  exception when others then v_state := sqlstate; end;
  assert v_state = 'P0002', format('post of B must raise P0002, got %s', v_state);

  reset role;
  select last_seen_comment_id, seguindo, conta_id into v_last, v_seg, v_conta
    from post_discussao_participantes where post_id = v_p1 and user_id = v_b2;
  assert v_last = v_c2, format('marker must stay at the highest id %s, got %s', v_c2, v_last);
  assert v_seg, 'marcar_lido must create the row with seguindo = true';
  assert v_conta = v_ws_a, 'participant row must copy the post conta_id';

  raise notice 'PASS 99.5 post_discussao_marcar_lido';
end $$;
rollback;

-- =====================================================================
-- 99.6 post_discussao_seguir and get_post_discussao_participacao
-- =====================================================================
begin;
select et_grant_hosted_parity(array['post_discussao_participantes']);
do $$
declare
  s jsonb := pg_temp.pd_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_b2 uuid := s->>'b2'; v_resp uuid := s->>'resp';
  v_p1 bigint := s->>'p1'; v_pb bigint := s->>'pb';
  v_t bigint; v_c1 bigint;
  v_seg boolean; v_last bigint; v_imp boolean; v_state text; v_n int;
begin
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p1, v_ws_a, 'abc', v_a) returning id into v_t;
  insert into post_comments (thread_id, author_id, content) values (v_t, v_a, '1') returning id into v_c1;

  -- responsável without a row: implicit participant
  perform pg_temp.pd_as(v_resp);
  select * into v_seg, v_last, v_imp from get_post_discussao_participacao(v_p1);
  assert v_seg and v_last = 0 and v_imp, format('responsável without row must be (true,0,true), got (%s,%s,%s)', v_seg, v_last, v_imp);

  -- non-participant
  perform pg_temp.pd_as(v_b2);
  select * into v_seg, v_last, v_imp from get_post_discussao_participacao(v_p1);
  assert not v_seg and v_last = 0 and not v_imp, format('non-participant must be (false,0,false), got (%s,%s,%s)', v_seg, v_last, v_imp);

  -- seguir toggles the row
  perform post_discussao_seguir(v_p1, true);
  select * into v_seg, v_last, v_imp from get_post_discussao_participacao(v_p1);
  assert v_seg and v_last = 0 and not v_imp, 'after seguir(true) must be (true,0,false)';
  perform post_discussao_marcar_lido(v_p1, v_c1);
  perform post_discussao_seguir(v_p1, false);
  select * into v_seg, v_last, v_imp from get_post_discussao_participacao(v_p1);
  assert not v_seg and v_last = v_c1 and not v_imp, format('unfollowed must be (false,%s,false), got (%s,%s,%s)', v_c1, v_seg, v_last, v_imp);
  perform post_discussao_seguir(v_p1, true);
  select * into v_seg, v_last, v_imp from get_post_discussao_participacao(v_p1);
  assert v_seg and v_last = v_c1, 'seguir(true) again must keep the marker';

  -- responsável with a row: the row wins, implicito = false
  perform pg_temp.pd_as(v_resp);
  perform post_discussao_seguir(v_p1, false);
  select * into v_seg, v_last, v_imp from get_post_discussao_participacao(v_p1);
  assert not v_seg and v_last = 0 and not v_imp, format('responsável with row must be (false,0,false), got (%s,%s,%s)', v_seg, v_last, v_imp);

  -- RLS: a user reads only their own rows, and cannot write the table
  perform pg_temp.pd_as(v_b2);
  select count(*) into v_n from post_discussao_participantes;
  assert v_n = 1, format('b2 must see only its own row, saw %s', v_n);
  v_state := null;
  begin
    insert into post_discussao_participantes (post_id, conta_id, user_id) values (v_p1, v_ws_a, v_a);
  exception when insufficient_privilege then v_state := sqlstate; end;
  assert v_state = '42501', 'authenticated must not insert participant rows';
  v_state := null;
  begin
    update post_discussao_participantes set seguindo = true where user_id = v_b2;
  exception when insufficient_privilege then v_state := sqlstate; end;
  assert v_state = '42501', 'authenticated must not update participant rows';

  -- post of B raises
  v_state := null;
  begin perform post_discussao_seguir(v_pb, true);
  exception when others then v_state := sqlstate; end;
  assert v_state = 'P0002', format('seguir on post of B must raise P0002, got %s', v_state);
  v_state := null;
  begin perform * from get_post_discussao_participacao(v_pb);
  exception when others then v_state := sqlstate; end;
  assert v_state = 'P0002', format('participacao on post of B must raise P0002, got %s', v_state);

  reset role;
  raise notice 'PASS 99.6 post_discussao_seguir and get_post_discussao_participacao';
end $$;
rollback;

-- =====================================================================
-- 99.7 get_post_discussao_nao_lidas
-- =====================================================================
begin;
select et_grant_hosted_parity(array['post_discussao_participantes']);
do $$
declare
  s jsonb := pg_temp.pd_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_b2 uuid := s->>'b2';
  v_resp uuid := s->>'resp'; v_bu uuid := s->>'bu';
  v_x uuid := gen_random_uuid(); v_rm uuid := gen_random_uuid();
  v_wf bigint := s->>'wf';
  v_p1 bigint := s->>'p1'; v_p2 bigint := s->>'p2'; v_p3 bigint := s->>'p3';
  v_geral bigint; v_cont bigint; v_t2 bigint; v_c2 bigint; v_mis bigint;
  v_total int; v_nl int; v_n int;
begin
  -- x: member of A who unfollowed p1; rm: member of A with a row, removed further down
  insert into auth.users (id) values (v_x), (v_rm);
  insert into workspace_members (user_id, workspace_id, role) values (v_x, v_ws_a, 'agent'), (v_rm, v_ws_a, 'agent');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id in (v_x, v_rm);

  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (v_p1, v_ws_a, '', v_a, 'geral') returning id into v_geral;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p1, v_ws_a, 'abc', v_a) returning id into v_cont;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p2, v_ws_a, 'abc', v_a) returning id into v_t2;
  insert into post_comments (thread_id, author_id, content) values (v_geral, v_a, 'c1');
  insert into post_comments (thread_id, author_id, content) values (v_geral, v_b2, 'c2') returning id into v_c2;
  insert into post_comments (thread_id, author_id, content) values (v_cont, v_b2, 'c3');  -- reply in a conteudo thread
  insert into post_comments (thread_id, author_id, content) values (v_geral, v_resp, 'c4');
  insert into post_comments (thread_id, author_id, content) values (v_t2, v_a, 'p2');
  -- malformed thread on p1 carrying conta B: never counted
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p1, (s->>'ws_b')::uuid, 'zzz', v_a) returning id into v_mis;
  insert into post_comments (thread_id, author_id, content) values (v_mis, v_b2, 'fora');

  insert into post_discussao_participantes (post_id, conta_id, user_id, seguindo, last_seen_comment_id) values
    (v_p1, v_ws_a, v_a, true, 0),
    (v_p1, v_ws_a, v_x, false, 0),
    (v_p1, v_ws_a, v_rm, true, 0);

  -- participant following with marker 0: everyone else's messages, across threads
  perform pg_temp.pd_as(v_a);
  select total, nao_lidas into v_total, v_nl from get_post_discussao_nao_lidas(array[v_p1]);
  assert v_total = 4 and v_nl = 3, format('a: expected (4,3), got (%s,%s)', v_total, v_nl);

  -- p_workflow_ids returns the fluxo's posts with comments (p3 has none)
  select count(*) into v_n from get_post_discussao_nao_lidas(null, array[v_wf]);
  assert v_n = 2, format('p_workflow_ids must return p1 and p2, got %s rows', v_n);
  select count(*) into v_n from get_post_discussao_nao_lidas(null, array[v_wf]) r
   where r.workflow_id = v_wf and r.post_id in (v_p1, v_p2);
  assert v_n = 2, 'rows must carry post_id and workflow_id';
  select count(*) into v_n from get_post_discussao_nao_lidas(array[v_p3]);
  assert v_n = 0, 'a post without comments must not return a row';
  select total, nao_lidas into v_total, v_nl from get_post_discussao_nao_lidas(null, array[v_wf]) r where r.post_id = v_p2;
  assert v_total = 1 and v_nl = 0, format('a on p2 (non-participant, own message): expected (1,0), got (%s,%s)', v_total, v_nl);

  -- the marker moves the count
  perform post_discussao_marcar_lido(v_p1, v_c2);
  select total, nao_lidas into v_total, v_nl from get_post_discussao_nao_lidas(array[v_p1]);
  assert v_total = 4 and v_nl = 2, format('a after marker: expected (4,2), got (%s,%s)', v_total, v_nl);

  -- non-participant: total only
  perform pg_temp.pd_as(v_b2);
  select total, nao_lidas into v_total, v_nl from get_post_discussao_nao_lidas(array[v_p1]);
  assert v_total = 4 and v_nl = 0, format('b2: expected (4,0), got (%s,%s)', v_total, v_nl);

  -- unfollowed
  perform pg_temp.pd_as(v_x);
  select total, nao_lidas into v_total, v_nl from get_post_discussao_nao_lidas(array[v_p1]);
  assert v_total = 4 and v_nl = 0, format('x: expected (4,0), got (%s,%s)', v_total, v_nl);

  -- responsável without a row: implicit, marker 0
  perform pg_temp.pd_as(v_resp);
  select total, nao_lidas into v_total, v_nl from get_post_discussao_nao_lidas(array[v_p1]);
  assert v_total = 4 and v_nl = 3, format('resp: expected (4,3), got (%s,%s)', v_total, v_nl);

  -- member of B: nothing about A
  perform pg_temp.pd_as(v_bu);
  select count(*) into v_n from get_post_discussao_nao_lidas(array[v_p1, v_p2], array[v_wf]);
  assert v_n = 0, format('member of B must get no rows, got %s', v_n);

  -- removed member (participant row kept): nothing
  reset role;
  delete from workspace_members where user_id = v_rm and workspace_id = v_ws_a;
  assert exists (select 1 from post_discussao_participantes where post_id = v_p1 and user_id = v_rm),
    'the removed member''s participant row must survive for this case to mean anything';
  perform pg_temp.pd_as(v_rm);
  select count(*) into v_n from get_post_discussao_nao_lidas(array[v_p1], array[v_wf]);
  assert v_n = 0, format('removed member must get no rows, got %s', v_n);

  reset role;
  raise notice 'PASS 99.7 get_post_discussao_nao_lidas';
end $$;
rollback;

-- =====================================================================
-- 99.8 notification types and grants
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid(); v_fn text;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');

  insert into notifications (workspace_id, user_id, type, metadata)
    values (v_ws, v_user, 'team_message', jsonb_build_object('conversa_id', 1));
  insert into notifications (workspace_id, user_id, type, metadata)
    values (v_ws, v_user, 'post_discussion', jsonb_build_object('post_id', 1));
  insert into notification_inapp_prefs (user_id, type, enabled) values (v_user, 'team_message', false);
  insert into notification_inapp_prefs (user_id, type, enabled) values (v_user, 'post_discussion', false);

  foreach v_fn in array array[
    'public.post_discussao_enviar(bigint,text,bigint)',
    'public.post_discussao_marcar_lido(bigint,bigint)',
    'public.post_discussao_seguir(bigint,boolean)',
    'public.get_post_discussao_nao_lidas(bigint[],bigint[])',
    'public.get_post_discussao_participacao(bigint)'
  ] loop
    assert not has_function_privilege('anon', v_fn, 'execute'), format('anon must not execute %s', v_fn);
    assert has_function_privilege('authenticated', v_fn, 'execute'), format('authenticated must execute %s', v_fn);
  end loop;
  assert not has_function_privilege('authenticated', 'public.post_discussao_membro_ids(text,uuid)', 'execute'),
    'authenticated must not execute the post_discussao_membro_ids helper';
  assert not has_function_privilege('anon', 'public.post_discussao_membro_ids(text,uuid)', 'execute'),
    'anon must not execute the post_discussao_membro_ids helper';

  -- the participant table is read-only for authenticated (migration grants, no parity helper here)
  assert has_table_privilege('authenticated', 'public.post_discussao_participantes', 'select'),
    'authenticated must select post_discussao_participantes';
  assert not has_table_privilege('authenticated', 'public.post_discussao_participantes', 'insert,update,delete'),
    'authenticated must not write post_discussao_participantes';
  assert not has_table_privilege('anon', 'public.post_discussao_participantes', 'select'),
    'anon must not read post_discussao_participantes';

  -- realtime
  assert exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'post_comment_threads'),
    'post_comment_threads must be in supabase_realtime';
  assert exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'post_comments'),
    'post_comments must be in supabase_realtime';

  raise notice 'PASS 99.8 notification types, grants and realtime';
end $$;
rollback;

-- Extra members for 99.9 to 99.11: F (follower), N (unfollowed), X (ex-member with a row).
create or replace function pg_temp.pd_extra(s jsonb) returns jsonb language plpgsql as $$
declare
  v_ws_a uuid := s->>'ws_a';
  v_f uuid := gen_random_uuid(); v_n uuid := gen_random_uuid(); v_x uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_f), (v_n), (v_x);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_f, v_ws_a, 'agent'), (v_n, v_ws_a, 'agent'), (v_x, v_ws_a, 'agent');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id in (v_f, v_n, v_x);
  return s || jsonb_build_object('f', v_f, 'n', v_n, 'x', v_x);
end $$;

-- =====================================================================
-- 99.9 post_discussion recipients and the mention deep link
-- =====================================================================
begin;
select et_grant_hosted_parity(array['post_discussao_participantes']);
do $$
declare
  s jsonb := pg_temp.pd_extra(pg_temp.pd_seed());
  v_ws_a uuid := s->>'ws_a'; v_wf bigint := s->>'wf';
  v_u uuid := s->>'a'; v_m uuid := s->>'b2'; v_r uuid := s->>'resp';
  v_f uuid := s->>'f'; v_n uuid := s->>'n'; v_x uuid := s->>'x';
  v_p1 bigint := s->>'p1'; v_p2 bigint := s->>'p2';
  v_m_b2 bigint := s->>'m_b2'; v_m_resp bigint := s->>'m_resp';
  v_users uuid[]; v_link text; v_meta jsonb; v_n_rows int;
begin
  insert into post_discussao_participantes (post_id, conta_id, user_id, seguindo) values
    (v_p1, v_ws_a, v_f, true), (v_p1, v_ws_a, v_n, false), (v_p1, v_ws_a, v_x, true);
  delete from workspace_members where user_id = v_x and workspace_id = v_ws_a;

  perform pg_temp.pd_as(v_u);
  perform post_discussao_enviar(v_p1, 'olha isso @[Bia](membro:' || v_m_b2 || ')');
  reset role;

  select array_agg(user_id order by user_id) into v_users
    from notifications where type = 'post_discussion' and metadata->>'post_id' = v_p1::text;
  assert v_users = (select array_agg(u order by u) from unnest(array[v_f, v_r]) u),
    format('post_discussion must reach F and R only, got %s', v_users);

  select link, metadata into v_link, v_meta
    from notifications where type = 'post_discussion' and user_id = v_f;
  assert v_link = '/entregas?drawer=' || v_wf || '&post=' || v_p1 || '&discussao=1',
    format('post_discussion link, got %s', v_link);
  assert v_meta->>'post_id' = v_p1::text and v_meta->>'thread_field' = 'geral'
     and (v_meta->>'count')::int = 1 and jsonb_array_length(v_meta->'authors') = 1
     and v_meta->>'preview' = 'olha isso @Bia' and v_meta ? 'post_titulo' and v_meta ? 'author_name',
    format('post_discussion metadata, got %s', v_meta);

  select link into v_link from notifications where type = 'mention' and user_id = v_m;
  assert v_link = '/entregas?drawer=' || v_wf || '&post=' || v_p1 || '&discussao=1',
    format('mention link must open the discussion, got %s', v_link);

  -- author and mentioned became participants (following)
  select count(*) into v_n_rows from post_discussao_participantes
   where post_id = v_p1 and user_id in (v_u, v_m) and seguindo;
  assert v_n_rows = 2, format('author and mentioned must become followers, got %s', v_n_rows);

  -- a responsável who also has a following row is notified exactly once
  update workflow_posts set responsavel_id = v_m_resp where id = v_p2;
  insert into post_discussao_participantes (post_id, conta_id, user_id, seguindo) values (v_p2, v_ws_a, v_r, true);
  perform pg_temp.pd_as(v_u);
  perform post_discussao_enviar(v_p2, 'oi');
  reset role;
  select count(*) into v_n_rows from notifications
   where type = 'post_discussion' and user_id = v_r and metadata->>'post_id' = v_p2::text;
  assert v_n_rows = 1, format('responsável with a row must get exactly one notification, got %s', v_n_rows);

  raise notice 'PASS 99.9 post_discussion recipients and mention deep link';
end $$;
rollback;

-- =====================================================================
-- 99.10 coalescing
-- =====================================================================
begin;
select et_grant_hosted_parity(array['post_discussao_participantes']);
do $$
declare
  s jsonb := pg_temp.pd_extra(pg_temp.pd_seed());
  v_ws_a uuid := s->>'ws_a';
  v_u uuid := s->>'a'; v_o uuid := s->>'b2'; v_f uuid := s->>'f';
  v_p1 bigint := s->>'p1'; v_m_resp bigint := s->>'m_resp';
  v_meta jsonb; v_n int;
begin
  insert into post_discussao_participantes (post_id, conta_id, user_id, seguindo) values (v_p1, v_ws_a, v_f, true);

  perform pg_temp.pd_as(v_u);
  perform post_discussao_enviar(v_p1, 'primeira');
  perform pg_temp.pd_as(v_o);
  perform post_discussao_enviar(v_p1, 'segunda');
  perform post_discussao_enviar(v_p1, 'terceira com @[Rui](membro:' || v_m_resp || ')');
  reset role;

  select count(*) into v_n from notifications
   where type = 'post_discussion' and user_id = v_f and read_at is null and dismissed_at is null;
  assert v_n = 1, format('F must have exactly one unread post_discussion, got %s', v_n);
  select metadata into v_meta from notifications where type = 'post_discussion' and user_id = v_f;
  assert v_meta->>'count' = '3', format('count must be 3, got %s', v_meta->>'count');
  assert jsonb_array_length(v_meta->'authors') = 2, format('authors must be deduplicated (2), got %s', v_meta->'authors');
  assert jsonb_array_length(v_meta->'authors') <= 3, 'authors must hold at most 3 names';
  assert v_meta->>'author_name' = 'Bia', format('author_name must be the last author, got %s', v_meta->>'author_name');
  assert position('@[' in v_meta->>'preview') = 0, format('preview must not carry raw tokens: %s', v_meta->>'preview');
  assert v_meta->>'preview' = 'terceira com @Rui', format('preview must be the last message, got %s', v_meta->>'preview');

  -- once read, the next message opens a new card
  update notifications set read_at = now() where type = 'post_discussion' and user_id = v_f;
  perform pg_temp.pd_as(v_u);
  perform post_discussao_enviar(v_p1, 'quarta');
  reset role;
  select count(*) into v_n from notifications where type = 'post_discussion' and user_id = v_f;
  assert v_n = 2, format('a read card must not absorb new messages, got %s rows', v_n);
  select metadata into v_meta from notifications
   where type = 'post_discussion' and user_id = v_f and read_at is null;
  assert v_meta->>'count' = '1', format('the new card starts at count 1, got %s', v_meta->>'count');

  raise notice 'PASS 99.10 post_discussion coalescing';
end $$;
rollback;

-- =====================================================================
-- 99.11 edge cases
-- =====================================================================
begin;
select et_grant_hosted_parity(array['post_discussao_participantes']);
do $$
declare
  s jsonb := pg_temp.pd_extra(pg_temp.pd_seed());
  v_ws_a uuid := s->>'ws_a'; v_cli bigint;
  v_u uuid := s->>'a'; v_m uuid := s->>'b2'; v_r uuid := s->>'resp'; v_f uuid := s->>'f';
  v_p1 bigint := s->>'p1'; v_p2 bigint := s->>'p2'; v_p3 bigint := s->>'p3'; v_pa bigint;
  v_m_b2 bigint := s->>'m_b2'; v_m_resp bigint := s->>'m_resp';
  v_geral bigint; v_t bigint; v_c post_comments; v_n int; v_link text;
begin
  select cliente_id into v_cli from workflow_posts where id = v_p1;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws_a, v_cli, 'rascunho') returning id into v_pa;
  insert into post_discussao_participantes (post_id, conta_id, user_id, seguindo) values
    (v_p1, v_ws_a, v_f, true), (v_p2, v_ws_a, v_f, true), (v_pa, v_ws_a, v_f, true);

  -- (a) insert with no JWT (service role / data-import): no notification, no rows
  perform set_config('request.jwt.claims', '', true);
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (v_p1, v_ws_a, '', v_u, 'geral') returning id into v_geral;
  insert into post_comments (thread_id, author_id, content) values (v_geral, v_u, 'importado');
  select count(*) into v_n from notifications where type = 'post_discussion';
  assert v_n = 0, format('insert without auth.uid() must not notify, got %s', v_n);
  select count(*) into v_n from post_discussao_participantes where user_id = v_u;
  assert v_n = 0, 'insert without auth.uid() must not create participant rows';

  -- (b) no responsável and no participants: enviar succeeds, nobody is notified
  perform pg_temp.pd_as(v_u);
  perform post_discussao_enviar(v_p3, 'sozinho');
  reset role;
  select count(*) into v_n from notifications where type = 'post_discussion' and metadata->>'post_id' = v_p3::text;
  assert v_n = 0, format('lonely post must notify nobody, got %s', v_n);

  -- (c) legacy path: first message of a new anchored thread by direct inserts, with @M
  perform pg_temp.pd_as(v_u);
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p2, v_ws_a, 'trecho', v_u) returning id into v_t;
  insert into post_comments (thread_id, author_id, content)
    values (v_t, v_u, 'veja @[Bia](membro:' || v_m_b2 || ')');
  reset role;
  select count(*) into v_n from notifications
   where type = 'post_discussion' and metadata->>'post_id' = v_p2::text and user_id in (v_f, v_m);
  assert v_n = 2, format('legacy path must notify F and not exclude M, got %s', v_n);
  select count(*) into v_n from notifications
   where type = 'post_discussion' and metadata->>'post_id' = v_p2::text
     and metadata->>'thread_field' = 'conteudo' and metadata->>'quoted_text' = 'trecho';
  assert v_n = 2, 'anchored-thread notice must carry thread_field and quoted_text';

  -- (d) an edit that adds @Y creates Y's participant row and no post_discussion
  select * into v_c from post_comments pc
   where pc.thread_id = (select id from post_comment_threads where post_id = v_p3 and field = 'geral');
  select count(*) into v_n from notifications where type = 'post_discussion';
  perform pg_temp.pd_as(v_u);
  update post_comments set content = v_c.content || ' @[Rui](membro:' || v_m_resp || ')' where id = v_c.id;
  reset role;
  assert exists (select 1 from post_discussao_participantes where post_id = v_p3 and user_id = v_r and seguindo),
    'an edit adding a mention must create the participant row';
  assert (select count(*) from notifications where type = 'post_discussion') = v_n,
    'an edit must not create post_discussion notifications';

  -- (e) avulso post: links without drawer
  perform pg_temp.pd_as(v_u);
  perform post_discussao_enviar(v_pa, 'avulso @[Bia](membro:' || v_m_b2 || ')');
  reset role;
  select link into v_link from notifications
   where type = 'post_discussion' and user_id = v_f and metadata->>'post_id' = v_pa::text;
  assert v_link = '/entregas?post=' || v_pa || '&discussao=1', format('avulso post_discussion link, got %s', v_link);
  select link into v_link from notifications
   where type = 'mention' and user_id = v_m and link like '%post=' || v_pa || '&%';
  assert v_link = '/entregas?post=' || v_pa || '&discussao=1', format('avulso mention link, got %s', v_link);

  raise notice 'PASS 99.11 post_discussion edge cases';
end $$;
rollback;

-- =====================================================================
-- 99.12 backfill of participants from existing threads
-- =====================================================================
begin;
do $$
declare
  s jsonb := pg_temp.pd_seed();
  v_ws_a uuid := s->>'ws_a';
  v_a uuid := s->>'a'; v_b2 uuid := s->>'b2'; v_resp uuid := s->>'resp';
  v_p1 bigint := s->>'p1';
  v_ghost uuid := gen_random_uuid(); v_cli_g bigint; v_pg bigint; v_tg bigint;
  v_act bigint; v_res bigint; v_max bigint; v_n int; v_ret int;
begin
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_p1, v_ws_a, 'ativo', v_a) returning id into v_act;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, status)
    values (v_p1, v_ws_a, 'resolvido', v_a, 'resolved') returning id into v_res;
  insert into post_comments (thread_id, author_id, content) values (v_act, v_a, '1'), (v_act, v_b2, '2');
  insert into post_comments (thread_id, author_id, content) values (v_res, v_resp, '3');
  select max(pc.id) into v_max from post_comments pc
    join post_comment_threads t on t.id = pc.thread_id where t.post_id = v_p1;

  -- orphan post: conta_id with no workspaces row (triggers off only for this seed)
  set local session_replication_role = replica;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_a, v_ghost, 'G', 'G', '#000') returning id into v_cli_g;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ghost, v_cli_g, 'rascunho') returning id into v_pg;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_pg, v_ghost, 'fantasma', v_a) returning id into v_tg;
  insert into post_comments (thread_id, author_id, content) values (v_tg, v_a, 'g');
  set local session_replication_role = origin;

  delete from post_discussao_participantes;
  v_ret := post_discussao_backfill_participantes();

  select count(*) into v_n from post_discussao_participantes where post_id = v_p1;
  assert v_n = 2, format('only the active thread authors get rows, got %s', v_n);
  assert v_ret = 2, format('backfill must return the rows written, got %s', v_ret);
  assert not exists (select 1 from post_discussao_participantes where user_id = v_resp),
    'resolved-thread authors must not get rows';
  assert (select bool_and(seguindo and last_seen_comment_id = v_max and conta_id = v_ws_a)
            from post_discussao_participantes where post_id = v_p1),
    'backfilled rows follow, carry the post conta and start at the post max comment id';
  assert not exists (select 1 from post_discussao_participantes where post_id = v_pg),
    'orphan post must be skipped';

  raise notice 'PASS 99.12 participant backfill';
end $$;
rollback;
