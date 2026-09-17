-- Fecha um buraco de EXECUTE em RPCs SECURITY DEFINER que deveriam ser só de serviço.
--
-- No Supabase hospedado, privilégios default concedem EXECUTE diretamente às roles
-- anon/authenticated/service_role no momento em que a função é criada -- não apenas
-- via PUBLIC implícito (o mesmo mecanismo de pg_default_acl documentado para tabelas).
-- `REVOKE ALL ... FROM public` (ou FROM PUBLIC) só remove a entrada de grantee vazio
-- (`=X/postgres`); NÃO toca nos grants explícitos que anon/authenticated já têm.
-- Confirmado ao vivo: popup_trigger_matches já revoga nomeando `anon` explicitamente
-- e está corretamente fechada (anon=false); todas as funções abaixo só revogavam
-- `FROM public` e, na prática, continuavam com anon=true E authenticated=true.
--
-- set_story_segment_field e mark_platform_published fazem UPDATE em workflow_posts
-- por id sem checar conta_id -- qualquer usuário authenticated (e, pior, anon)
-- conseguia escrever story_segments ou marcar como publicado um post de QUALQUER
-- workspace. Auditando todo `REVOKE ALL ON FUNCTION ... FROM public` do repositório
-- (sem anon/authenticated) e cruzando com quem de fato chama cada função
-- (grep por `.rpc(` em apps/ e supabase/functions/), o mesmo padrão de exposição
-- aparece nas funções abaixo -- todas só são chamadas internamente (edge function
-- com service role, cron, ou outra função SECURITY DEFINER), nenhuma tem chamador
-- .rpc() no frontend.
--
-- Deliberadamente EXCLUÍDAS desta migration: helpers usados dentro de policies RLS
-- (get_my_conta_id, get_my_role, get_user_conta_id, has_permission,
-- can_see_financials, user_workspace_ids) -- uma policy RLS avalia sob o papel de
-- quem consulta a tabela, não do dono da função, então authenticated PRECISA de
-- EXECUTE direto nelas mesmo sendo SECURITY DEFINER. Também excluídas as ~30 RPCs
-- com chamador .rpc() confirmado em apps/ (accept/reject_edit_suggestion,
-- switch_workspace, get_mensagens_*, reorder_*, etc.) -- essas são legitimamente
-- chamadas por authenticated.
--
-- resolve_workspace_plan(ws_id) é chamada DENTRO das policies RLS de
-- global_banners/global_popups (`... to authenticated using (... and
-- resolve_workspace_plan(...) ...)`) -- uma policy roda sob o papel de quem
-- consulta a tabela, não do dono da função, então authenticated PRECISA manter
-- EXECUTE aqui (mesmo padrão documentado no comentário de
-- popup_trigger_matches em 20260911000001_popup_triggers.sql). Só o anon é
-- revogado; authenticated recebe grant explícito abaixo, como
-- popup_trigger_matches já faz.
--
-- check_resource_limit e rls_auto_enable não têm CREATE FUNCTION em nenhuma
-- migration deste repositório (nem set_carousel_child_field, que já está
-- corretamente fechada ao vivo) -- drift: objetos existem no banco hospedado
-- sem migration correspondente. NÃO incluídos aqui: um REVOKE ON FUNCTION para
-- uma função inexistente falha com "function does not exist" e aborta a
-- migration inteira num banco criado do zero (CI). Foram fechados
-- manualmente em prod fora desta migration; a falta de proveniência merece
-- investigação à parte.

-- ---------- Instagram publishing pipeline ----------
REVOKE ALL ON FUNCTION set_story_segment_field(bigint, int, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_story_segment_field(bigint, int, text, text) TO service_role;

REVOKE ALL ON FUNCTION mark_platform_published(bigint, text, text, uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_platform_published(bigint, text, text, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION record_post_status_change(bigint, text, text, uuid, bigint, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_post_status_change(bigint, text, text, uuid, bigint, jsonb) TO service_role;

REVOKE ALL ON FUNCTION record_client_approval(bigint, text, text, text, boolean, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_client_approval(bigint, text, text, text, boolean, text) TO service_role;

REVOKE ALL ON FUNCTION claim_cron_triage(text, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_cron_triage(text, text, int) TO service_role;

-- ---------- Instagram comment-to-DM automation ----------
REVOKE ALL ON FUNCTION claim_automation_send(text, uuid, uuid, text, text, text, text, timestamptz, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_automation_send(text, uuid, uuid, text, text, text, text, timestamptz, int) TO service_role;

REVOKE ALL ON FUNCTION claim_retryable_automation_sends(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_retryable_automation_sends(int) TO service_role;

REVOKE ALL ON FUNCTION fail_ineligible_automation_sends() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION fail_ineligible_automation_sends() TO service_role;

REVOKE ALL ON FUNCTION mark_automation_dm_sent(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_automation_dm_sent(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION automation_media_finalize(uuid, text, bigint, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION automation_media_finalize(uuid, text, bigint, text) TO service_role;

REVOKE ALL ON FUNCTION automation_media_release(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION automation_media_release(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION create_instagram_connect_link(bigint, uuid, uuid, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_instagram_connect_link(bigint, uuid, uuid, int) TO service_role;

REVOKE ALL ON FUNCTION revoke_instagram_connect_link(bigint, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION revoke_instagram_connect_link(bigint, uuid) TO service_role;

-- ---------- Briefing / ideias audio (Hub, sem login) e sugestões de edição ----------
REVOKE ALL ON FUNCTION briefing_audio_finalize(uuid, bigint, uuid, text, bigint, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION briefing_audio_finalize(uuid, bigint, uuid, text, bigint, text, int) TO service_role;

REVOKE ALL ON FUNCTION briefing_audio_release(uuid, bigint, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION briefing_audio_release(uuid, bigint, uuid) TO service_role;

REVOKE ALL ON FUNCTION briefing_audio_apply_transcript(uuid, bigint, uuid, text, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION briefing_audio_apply_transcript(uuid, bigint, uuid, text, text, int) TO service_role;

REVOKE ALL ON FUNCTION ideia_audio_finalize(uuid, uuid, text, text, bigint, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION ideia_audio_finalize(uuid, uuid, text, text, bigint, text, int) TO service_role;

REVOKE ALL ON FUNCTION ideia_audio_release(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION ideia_audio_release(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION ideia_audio_apply_transcript(uuid, uuid, text, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION ideia_audio_apply_transcript(uuid, uuid, text, text, int) TO service_role;

REVOKE ALL ON FUNCTION ideia_file_insert_with_quota(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION ideia_file_insert_with_quota(jsonb) TO service_role;

REVOKE ALL ON FUNCTION upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text) TO service_role;

REVOKE ALL ON FUNCTION create_edit_suggestion_notification(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_edit_suggestion_notification(bigint) TO service_role;

REVOKE ALL ON FUNCTION create_post_approval_notification(bigint, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_post_approval_notification(bigint, text, text) TO service_role;

REVOKE ALL ON FUNCTION insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid) TO service_role;

REVOKE ALL ON FUNCTION resolve_notification_targets(uuid, bigint, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_notification_targets(uuid, bigint, text[]) TO service_role;

REVOKE ALL ON FUNCTION notification_deadline_candidates() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION notification_deadline_candidates() TO service_role;

-- ---------- Arquivos / pastas / mídia (quota e capa) ----------
REVOKE ALL ON FUNCTION bulk_move_items(uuid, bigint[], bigint[], bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION bulk_move_items(uuid, bigint[], bigint[], bigint) TO service_role;

REVOKE ALL ON FUNCTION file_insert_with_quota(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION file_insert_with_quota(jsonb) TO service_role;

REVOKE ALL ON FUNCTION folder_breadcrumbs(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION folder_breadcrumbs(bigint) TO service_role;

REVOKE ALL ON FUNCTION folder_sizes_batch(bigint[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION folder_sizes_batch(bigint[]) TO service_role;

REVOKE ALL ON FUNCTION folder_total_size(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION folder_total_size(bigint) TO service_role;

REVOKE ALL ON FUNCTION post_file_link_set_cover(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_file_link_set_cover(bigint) TO service_role;

REVOKE ALL ON FUNCTION post_media_insert_with_quota(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_media_insert_with_quota(jsonb) TO service_role;

REVOKE ALL ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) TO service_role;

-- post_media_set_cover nunca teve REVOKE algum desde sua criação em
-- 20260412_post_media_quota_atomic.sql (nem `FROM public` incompleto) -- não é o
-- mesmo padrão das demais, é uma lacuna nunca fechada.
REVOKE ALL ON FUNCTION post_media_set_cover(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_media_set_cover(bigint) TO service_role;

-- ---------- Importação de dados ----------
REVOKE ALL ON FUNCTION import_commit_row(uuid, bigint, text, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION import_commit_row(uuid, bigint, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION import_resolve_cliente(uuid, bigint, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION import_resolve_cliente(uuid, bigint, jsonb) TO service_role;

-- ---------- Planos / entitlements ----------
REVOKE ALL ON FUNCTION effective_plan_feature(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION effective_plan_feature(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION effective_plan_limit(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION effective_plan_limit(uuid, text) TO service_role;

-- resolve_workspace_plan(ws_id) também nunca teve REVOKE -- sem isso, qualquer
-- anon conseguia consultar o plano de QUALQUER workspace por id via RPC direta.
-- authenticated MANTÉM EXECUTE (ver comentário acima): é usado dentro de
-- policies RLS, não só via .rpc().
REVOKE ALL ON FUNCTION resolve_workspace_plan(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION resolve_workspace_plan(uuid) TO authenticated, service_role;

-- ---------- Convites / auth ----------
REVOKE ALL ON FUNCTION expire_and_cleanup_invites() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_and_cleanup_invites() TO service_role;
