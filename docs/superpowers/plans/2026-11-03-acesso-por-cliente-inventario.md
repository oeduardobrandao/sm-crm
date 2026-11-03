# Acesso por cliente: inventário do catálogo (Task 2)

Mapa de onde o escopo de cliente tem de entrar. Tasks 3, 4a-4e, 5, 6, 12, 13 e 14 trabalham a
partir daqui. Gerado em 2026-11-03 só com consultas de catálogo, num banco local com todas as
migrations aplicadas (até `20261115000001`, Task 1). A guarda de deriva
`supabase/tests/entitlements/pending_acesso_por_cliente_drift.sql` recalcula o conjunto de
tabelas no catálogo a cada execução, então este documento é o retrato de hoje e o teste é a regra.

Spec: `docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md`. Plano:
`docs/superpowers/plans/2026-11-03-acesso-por-cliente.md`.

## Como foi levantado

- Raízes: `information_schema.columns` com `cliente_id`/`client_id` inteiro, mais `clientes`.
  `client_id text` em `mcp_oauth_grants` e `admin_mcp_oauth_grants` é id de cliente OAuth, não
  de cliente do CRM: fora.
- Filhas: fecho recursivo das FKs (`pg_constraint`, `contype = 'f'`) para as raízes.
- Ligações sem FK: colunas polimórficas (`source_type/source_id`, `host_type/host_id`) e as
  tabelas de histórico do Google, sem FK de propósito. Listadas à mão (seção própria).
- Policies: `pg_policies`. Views: `pg_rewrite`/`pg_depend` + `pg_class.reloptions`.
- SECURITY DEFINER: `pg_proc WHERE prosecdef AND prosrc` cita uma tabela do inventário; mais
  todos os `financeiro_*` por nome (vários não citam tabela de cliente no corpo). Chamadores por
  grep de `rpc('nome'` em `apps/`, de `'nome'` em `supabase/functions/`, chamadas em outros
  corpos (`pg_proc.prosrc`), `pg_trigger` e `cron.job`. O PR #539 (lockdown de grants) não está
  em main, então nenhuma lista foi emprestada dele.
- Edge functions: grep de `from('<tabela>')`, `rpc(` e do tipo de auth em cada
  `supabase/functions/*/`.

## Contagens

| | |
|---|---|
| Tabelas inventariadas | 104 (95 que a guarda calcula + 9 de histórico do Google sem FK) |
| `scoped` | 75 |
| `exempt` | 29 (24 sem policy para authenticated, 3 do Task 6, a de atribuições, `oauth_states`) |
| Views sobre tabela de cliente | 3 (`clientes_v` barrier, sem predicado; `post_media_notes_v` e `instagram_account_last_post` invoker) |
| SECURITY DEFINER que tocam tabela de cliente | 271 por `prosrc` (55 executáveis por authenticated fora do financeiro; 144 só service_role/dono; 63 triggers; 9 `financeiro`), mais 48 `financeiro_*` por nome |
| Edge functions que leem dados de cliente | 65 com `from()` em tabela de cliente, mais 4 que chegam por RPC ou `_shared` (`youtube-analytics`, `briefing-audio`, `ideia-media-manage`, `agenda-feed`): 24 para Task 13 (mais `instagram-report-generator-v2`, filtrado no chamador), 1 (`mcp`) para Task 12, 2 crons para Task 14 (mais `agenda-lembretes-email` a conferir), o resto isento |

## Decisões de interpretação (para o controller confirmar)

1. **"É dele" x raiz de contexto.** A tabela abaixo tem duas colunas. "É dele" é o que a policy
   da própria tabela pode usar. "Context root" é o que `can_see_cliente_context` tem de cobrir:
   um item que vive num cliente oculto e precisa do nome/marca do cliente. Filhas (comentários,
   mídia, versões, eventos) herdam pelo pai e não são raiz de contexto. A guarda
   `context_fn_covers_own_tables` confere uma lista fixa (`workflow_posts`, `workflow_etapas`,
   `tarefas` da Task 1, mais `ideias`, que a spec nomeia via `ideias.autor_membro_id` e a função
   ainda não cobre) **e**, automaticamente, toda tabela de cliente cuja policy passe a usar
   `my_membro_ids()`. Propostas de raiz ainda fora da lista: `agenda_eventos` (organizador +
   participantes), `tarefa_series`, `post_process_steps`. Ver "Propostas".
2. **Toda policy, não "ao menos uma".** Policies PERMISSIVE se somam por OR, então uma policy
   aberta ao lado de uma escopada vaza. A guarda exige o predicado em **toda** policy
   PERMISSIVE não service_role que expõe linhas (SELECT/UPDATE/DELETE/ALL), ou uma RESTRICTIVE
   com o predicado (forma válida de "só acrescentar o escopo"). Policy `USING/WITH CHECK (false)`
   não concede nada e passa; RESTRICTIVE nunca conta como falha. Policies só de service_role, ou
   com `USING (auth.role() = 'service_role')` (quatro tabelas de métricas), não contam.
3. **WITH CHECK explícito na raiz.** A maioria das tabelas tem uma única policy `FOR ALL` com
   `USING` e sem `WITH CHECK` (`files`, `folders`, `post_media`, `workflow_posts`, `tarefas`...).
   Sem `WITH CHECK` o Postgres aplica o `USING`, que vai carregar o "é dele", e um restrito
   moveria o próprio post para um cliente oculto (Review Focus #4). Na raiz, a guarda exige
   `WITH CHECK` explícito com `can_access_cliente` ou `my_client_scope_all`. A coluna "write
   policy" marca `AUSENTE, usa USING` onde isso falta hoje.
4. **Filha herda pelo pai.** Subconsulta dentro de policy roda com a RLS de quem consulta, então
   `post_id IN (SELECT id FROM workflow_posts ...)` passa a respeitar o escopo quando
   `workflow_posts` for escopada. A guarda aceita isso para filha sem chave própria quando o qual
   consulta (`FROM`/`JOIN`) o pai pela FK e o pai já passa. Com as raízes escopadas, 14 filhas
   passam sem mudança: `agenda_ocorrencias`, `agenda_participantes`, `agenda_respostas`,
   `ideia_reactions`, `instagram_analytics_cache`, `instagram_follower_history`,
   `instagram_post_tag_assignments`, `instagram_posts`, `portal_approvals`, `post_approvals`,
   `post_property_values`, `tiktok_follower_history`, `tiktok_posts`, `workflow_etapas`
   (`workflow_etapas` ainda precisa do "é dele" explícito). As outras 31 filhas consultam só
   `conta_id` e precisam de reescrita. Heurística textual: um `NOT IN (SELECT ... FROM pai)`
   também casaria; quem revisar 4a-4e confere a forma.
5. **`hub_brand`/`hub_brand_files`/`instagram_accounts`/`tiktok_accounts` já filtram por
   `cliente_id IN (SELECT id FROM clientes ...)`**, então herdariam o escopo de `clientes` sem o
   "é dele". Como têm chave própria, a guarda exige o predicado explícito (4b quer
   `can_see_cliente_context` na marca).

## Propostas de dono (não decididas no plano)

O plano não nomeia estas tabelas em nenhuma das 4a-4e. Proposta, marcada "(proposta)" na tabela:

- Task 3: `cliente_datas`, `cliente_enderecos`, `cliente_links` (sub-tabelas da ficha do cliente).
- 4a: `post_processes`, `post_process_steps`, `post_process_events`, `post_targets`,
  `post_property_values`, `post_status_events`, `post_approval_media_notes`, `workflow_events`,
  `workflow_select_options`, `portal_tokens`, `portal_approvals`.
- 4b: `hub_pages`, `mencoes`, `subtarefas`, `tarefa_eventos`, `tarefa_tag_links`, `ideia_files`,
  `ideia_reactions`.
- 4d: `mensagens`, `mensagens_last_seen`, `instagram_automation_contacts`,
  `instagram_automation_contact_automations`, `instagram_automation_sends`,
  `instagram_comment_analyses`, e os filhos da agenda sem policy.
- Raízes de contexto a decidir: `agenda_eventos` (4d), `tarefa_series` (4b),
  `post_process_steps` (4a). `workflows.user_id` é o criador (`store/workflows.ts`), mas a
  proposta é não torná-lo "é dele".

## Ligações sem FK

| tabela | ligação | consequência |
|---|---|---|
| `folders` | `source_type`/`source_id`: `client`, `workflow`, `post`, `client_reports` (cliente), `root_clients` (sem cliente) | 4c precisa de um resolvedor pasta -> cliente (subindo `parent_id` até uma pasta de origem) |
| `files` | `folder_id -> folders` (`ON DELETE SET NULL`) | arquivo sem pasta não tem cliente: só aparece por "é dele" ou fica oculto ao restrito |
| `mencoes` | `host_type`/`host_id`: `post_comment`, `tarefa`, `workflow_post`, `tarefa_comentario` | cliente via o host; policy hoje só por `conta_id` |
| `notifications` | `cliente_id` sem FK (Task 1) | 4e |
| `gbp_metrics_daily`, `gbp_rating_daily`, `gbp_reviews`, `gbp_search_keywords_monthly` | `location_name` + conta, sem FK de propósito (CLAUDE.md) | sem policy: Task 13 (`gbp-analytics`) |
| `youtube_channel_daily`, `youtube_demographics`, `youtube_traffic_daily`, `youtube_video_daily`, `youtube_videos` | `channel_id`, sem FK de propósito | sem policy: Task 13 (`youtube-analytics`) |
| `audit_log`, `import_job_items` | `resource_type/resource_id`, `table_name/row_id` | não são dados de cliente para o membro; fora do inventário |

## Tabelas

Legenda das policies: `conta` = `conta_id IN (SELECT get_my_conta_id())`; `custom` = outro
qual (texto completo no Apêndice); `R` = RESTRICTIVE. Policies só de `service_role` omitidas.
`SEM conta_id`: a tabela não tem coluna de workspace; o tenant vem pelo pai ou pelo cliente.

Colunas "é dele": tirei do catálogo toda coluna uuid que aponta para usuário (`auth.users` ou sem FK
com nome de usuário) e toda bigint para `membros`. Ficaram fora, por serem ator ou auditoria e não
autoria nem atribuição: `actor_user_id` (`post_content_versions`, `post_process_events`,
`post_status_events`, `tarefa_eventos`, `workflow_events`), `resolved_by` (`post_comment_threads`,
`post_media_notes`), `resolvido_por` (`agenda_remarcacoes`), `reviewed_by`
(`post_edit_suggestions`), `analyzed_by` listado mas sem uso como "é dele". Também sem uso:
`linha_editorial_respostas.author_user_id` (resposta do cliente no Hub), `workspace_member_clientes.created_by`
e `instagram_connect_links.created_by` (listado). Colunas uuid que são FK para outra entidade
(`instagram_account_id`, `ideia_id`, `automation_id`...) não são de usuário.

| table | task | status | client key (own column or parent path) | "é dele" uuid | "é dele" membros bigint | context root? | read policy (qual) | write policy (check) | sem conta_id? |
|---|---|---|---|---|---|---|---|---|---|
| `cliente_datas` | 3 (proposta) | scoped | próprio `cliente_id:bigint NOT NULL` | - | - | - | `workspace_read_datas` (SELECT: custom) | `workspace_delete_datas` (DELETE: custom)<br>`workspace_insert_datas` (INSERT: check custom)<br>`workspace_update_datas` (UPDATE: check custom) |  |
| `cliente_enderecos` | 3 (proposta) | scoped | próprio `cliente_id:bigint NOT NULL` | - | - | - | `workspace_read_enderecos` (SELECT: custom) | `workspace_delete_enderecos` (DELETE: custom)<br>`workspace_insert_enderecos` (INSERT: check custom)<br>`workspace_update_enderecos` (UPDATE: check custom) |  |
| `cliente_links` | 3 (proposta) | scoped | próprio `cliente_id:bigint NOT NULL` | - | - | - | `workspace_select_links` (SELECT: custom) | `workspace_delete_links` (DELETE: custom)<br>`workspace_insert_links` (INSERT: check custom)<br>`workspace_update_links` (UPDATE: check custom) |  |
| `clientes` | 3 | scoped | `id` (a própria) | user_id (criador; spec: nunca "é dele") | - | - | `clientes_select` (SELECT: conta) | `clientes_delete` (DELETE: conta)<br>`clientes_insert` (INSERT: check conta)<br>`clientes_update` (UPDATE: check conta) |  |
| `portal_approvals` | 4a (proposta) | scoped (herda do pai quando o pai passar) | pai: workflow_etapa_id->workflow_etapas | - | - | - | `portal_approvals_select` (SELECT: custom) | `portal_approvals_delete` (DELETE: custom)<br>`portal_approvals_insert` (INSERT: check custom)<br>`portal_approvals_update` (UPDATE: check custom) | SEM conta_id |
| `portal_tokens` | 4a (proposta) | scoped | pai: workflow_id->workflows | - | - | - | `portal_tokens_workspace_all` (ALL: conta) | `portal_tokens_workspace_all` (ALL: check conta) |  |
| `post_approval_media_notes` | 4a (proposta) | scoped | pai: note_id->post_media_notes, post_approval_id->post_approvals | - | - | - | `post_approval_media_notes_tenant_select` (SELECT: custom) | (nenhuma) | SEM conta_id |
| `post_approvals` | 4a | scoped (herda do pai quando o pai passar) | pai: post_id->workflow_posts | author_user_id | - | filha | `workspace_post_approvals_all` (ALL: custom) | `post_approvals_authenticated_insert_author` R (INSERT: check custom)<br>`post_approvals_authenticated_no_delete` R (DELETE: false)<br>`post_approvals_authenticated_no_update` R (UPDATE: check AUSENTE, usa USING)<br>`workspace_post_approvals_all` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `post_comment_threads` | 4a | scoped | pai: post_id->workflow_posts | created_by | - | filha | `post_comment_threads_select` (SELECT: conta) | `post_comment_threads_delete` (DELETE: conta)<br>`post_comment_threads_insert` (INSERT: check conta)<br>`post_comment_threads_no_geral_insert` R (INSERT: check custom)<br>`post_comment_threads_update` (UPDATE: check conta) |  |
| `post_comments` | 4a | scoped | pai: thread_id->post_comment_threads | author_id | - | filha | `post_comments_select` (SELECT: custom) | `post_comments_author_is_self` R (INSERT: check custom)<br>`post_comments_delete` (DELETE: custom)<br>`post_comments_geral_author_delete` R (DELETE: custom)<br>`post_comments_geral_author_update` R (UPDATE: check AUSENTE, usa USING)<br>`post_comments_insert` (INSERT: check custom)<br>`post_comments_update` (UPDATE: check custom) | SEM conta_id |
| `post_content_versions` | 4a | scoped | pai: post_id->workflow_posts, suggestion_id->post_edit_suggestions | - | - | - | `post_content_versions_select` (SELECT: conta) | (nenhuma) |  |
| `post_discussao_participantes` | 4a | scoped | pai: post_id->workflow_posts | user_id | - | filha | `post_discussao_participantes_own_select` (SELECT: custom) | (nenhuma) |  |
| `post_edit_suggestions` | 4a | scoped | pai: post_id->workflow_posts | - | - | - | `workspace_edit_suggestions_all` (ALL: conta) | `workspace_edit_suggestions_all` (ALL: check conta) |  |
| `post_media` | 4a | scoped | pai: post_id->workflow_posts | uploaded_by | - | filha | `post_media_tenant_all` (ALL: conta) | `post_media_tenant_all` (ALL: check conta) |  |
| `post_media_note_replies` | 4a | scoped | pai: note_id->post_media_notes | author_user_id | - | filha | `post_media_note_replies_tenant_select` (SELECT: conta) | `post_media_note_replies_team_insert` (INSERT: check custom) |  |
| `post_media_notes` | 4a | scoped | pai: file_id->files, post_id->workflow_posts | author_user_id | - | filha | `post_media_notes_tenant_select` (SELECT: conta) | `post_media_notes_team_insert` (INSERT: check custom)<br>`post_media_notes_tenant_update` (UPDATE: check conta) |  |
| `post_process_events` | 4a (proposta) | scoped | pai: post_id->workflow_posts, process_id->post_processes | - | - | - | `ppe_select_member` (SELECT: conta) | `ppe_no_client_delete` (DELETE: false)<br>`ppe_no_client_insert` (INSERT: check false)<br>`ppe_no_client_update` (UPDATE: check AUSENTE, usa USING) |  |
| `post_process_steps` | 4a (proposta) | scoped | pai: process_id->post_processes | - | responsavel_id | proposta: root (etapa atribuída de um post) | `pps_select_member` (SELECT: conta) | `pps_no_client_delete` (DELETE: false)<br>`pps_no_client_insert` (INSERT: check false)<br>`pps_no_client_update` (UPDATE: check AUSENTE, usa USING) |  |
| `post_processes` | 4a (proposta) | scoped | pai: origem_workflow_id->workflows, post_id->workflow_posts | created_by | - | - | `pp_select_member` (SELECT: conta) | `pp_no_client_delete` (DELETE: false)<br>`pp_no_client_insert` (INSERT: check false)<br>`pp_no_client_update` (UPDATE: check AUSENTE, usa USING) |  |
| `post_property_values` | 4a (proposta) | scoped (herda do pai quando o pai passar) | pai: post_id->workflow_posts | - | - | - | `workspace_ppv_all` (ALL: custom) | `workspace_ppv_all` (ALL: check custom) | SEM conta_id |
| `post_references` | 4a | scoped | pai: file_id->files, post_approval_id->post_approvals, post_id->workflow_posts | - | - | - | `post_references_tenant_select` (SELECT: conta) | (nenhuma) |  |
| `post_status_events` | 4a (proposta) | scoped | pai: post_approval_id->post_approvals, post_id->workflow_posts | - | - | - | `post_status_events_select` (SELECT: conta) | (nenhuma) |  |
| `post_targets` | 4a (proposta) | scoped | pai: post_id->workflow_posts | - | - | - | `post_targets_workspace_all` (ALL: conta) | `post_targets_workspace_all` (ALL: check conta) |  |
| `workflow_etapas` | 4a | scoped (herda do pai quando o pai passar) | pai: workflow_id->workflows | - | responsavel_id | ROOT (Task 1) | `workflow_etapas_select` (SELECT: custom) | `workflow_etapas_delete` (DELETE: custom)<br>`workflow_etapas_insert` (INSERT: check custom)<br>`workflow_etapas_update` (UPDATE: check custom) | SEM conta_id |
| `workflow_events` | 4a (proposta) | scoped | pai: workflow_id->workflows | - | - | - | `workflow_events_select` (SELECT: conta) | (nenhuma) |  |
| `workflow_posts` | 4a | scoped | próprio `cliente_id:bigint NOT NULL` | - | responsavel_id | ROOT (Task 1) | `workspace_posts_all` (ALL: conta) | `workspace_posts_all` (ALL: check AUSENTE, usa USING) |  |
| `workflow_select_options` | 4a (proposta) | scoped | pai: workflow_id->workflows | - | - | - | `workspace_wso_all` (ALL: conta) | `workspace_wso_all` (ALL: check conta) |  |
| `workflows` | 4a | scoped | próprio `cliente_id:bigint NOT NULL` | user_id (criador: store/workflows.ts getUserId) | - | proposta: não root | `workflows_select` (SELECT: conta) | `workflows_delete` (DELETE: conta)<br>`workflows_insert` (INSERT: check conta)<br>`workflows_update` (UPDATE: check conta) |  |
| `briefings` | 4b | scoped | próprio `cliente_id:bigint NOT NULL` | - | - | - | `briefings_select` (SELECT: conta) | `briefings_delete` (DELETE: conta)<br>`briefings_insert` (INSERT: check conta)<br>`briefings_update` (UPDATE: check conta) |  |
| `hub_brand` | 4b | scoped | próprio `cliente_id:bigint NOT NULL` | - | - | - | `hub_brand_workspace_all` (ALL: custom) | `hub_brand_workspace_all` (ALL: check custom) | SEM conta_id |
| `hub_brand_files` | 4b | scoped | próprio `cliente_id:bigint NOT NULL` | - | - | - | `hub_brand_files_workspace_all` (ALL: custom) | `hub_brand_files_workspace_all` (ALL: check custom) | SEM conta_id |
| `hub_briefing_questions` | 4b | scoped | próprio `cliente_id:bigint NOT NULL` | - | - | - | `hub_briefing_questions_select` (SELECT: conta) | `hub_briefing_questions_delete` (DELETE: conta)<br>`hub_briefing_questions_insert` (INSERT: check conta)<br>`hub_briefing_questions_update` (UPDATE: check conta) |  |
| `hub_pages` | 4b (proposta) | scoped | próprio `cliente_id:bigint NOT NULL` | - | - | - | `hub_pages_workspace_all` (ALL: conta) | `hub_pages_workspace_all` (ALL: check conta) |  |
| `ideia_files` | 4b (proposta) | scoped | pai: file_id->files, ideia_id->ideias | - | - | - | `ideia_files_tenant_all` (ALL: conta) | `ideia_files_tenant_all` (ALL: check conta) |  |
| `ideia_reactions` | 4b (proposta) | scoped (herda do pai quando o pai passar) | pai: ideia_id->ideias | - | membro_id | - | `reactions_select` (SELECT: custom) | `reactions_delete` (DELETE: custom)<br>`reactions_insert` (INSERT: check custom)<br>`reactions_update` (UPDATE: check AUSENTE, usa USING) | SEM conta_id |
| `ideias` | 4b | scoped | próprio `cliente_id:integer NOT NULL` | - | autor_membro_id (comentario_autor_id é o comentário da agência, não autoria) | ROOT (spec; falta na função) | `ideias_select` (SELECT: custom) | `ideias_delete` (DELETE: custom)<br>`ideias_insert` (INSERT: check custom)<br>`ideias_update` (UPDATE: check custom) |  |
| `linha_editorial_itens` | 4b | scoped | pai: linha_id->linhas_editoriais, post_id->workflow_posts | convertido_por | - | - | `linha_editorial_itens_select` (SELECT: conta) | `linha_editorial_itens_delete` (DELETE: custom)<br>`linha_editorial_itens_insert` (INSERT: check custom)<br>`linha_editorial_itens_update` (UPDATE: check custom) |  |
| `linha_editorial_respostas` | 4b | scoped | pai: item_id->linha_editorial_itens, linha_id->linhas_editoriais | - | - | - | `linha_editorial_respostas_select` (SELECT: conta) | `linha_editorial_respostas_delete` (DELETE: custom)<br>`linha_editorial_respostas_insert` (INSERT: check custom)<br>`linha_editorial_respostas_update` (UPDATE: check custom) |  |
| `linhas_editoriais` | 4b | scoped | próprio `cliente_id:bigint NOT NULL` | created_by, enviada_por | - | proposta: não root | `linhas_editoriais_select` (SELECT: conta) | `linhas_editoriais_delete` (DELETE: custom)<br>`linhas_editoriais_insert` (INSERT: check custom)<br>`linhas_editoriais_update` (UPDATE: check custom) |  |
| `mencoes` | 4b (proposta) | scoped | sem FK: host_type/host_id (post_comment, tarefa, workflow_post, tarefa_comentario). Sem FK | author_id | mentioned_membro_id | proposta: não root (a notificação cobre) | `mencoes_tenant_all` (ALL: conta) | `mencoes_tenant_all` (ALL: check custom) |  |
| `subtarefas` | 4b (proposta) | scoped | pai: tarefa_id->tarefas | - | - | - | `subtarefas_tenant_all` (ALL: conta) | `subtarefas_tenant_all` (ALL: check conta) |  |
| `tarefa_comentarios` | 4b | scoped | pai: tarefa_id->tarefas | author_id | - | filha | `tarefa_comentarios_select` (SELECT: conta) | `tarefa_comentarios_delete_own` (DELETE: custom)<br>`tarefa_comentarios_update_own` (UPDATE: check custom) |  |
| `tarefa_eventos` | 4b (proposta) | scoped | pai: tarefa_id->tarefas | - | - | - | `tarefa_eventos_select` (SELECT: conta) | (nenhuma) |  |
| `tarefa_series` | 4b | scoped | próprio `cliente_id:bigint` | user_id (autor) | responsavel_id | proposta: root junto com tarefas | `tarefa_series_tenant_select` (SELECT: conta) | (nenhuma) |  |
| `tarefa_tag_links` | 4b (proposta) | scoped | pai: tarefa_id->tarefas | - | - | - | `tarefa_tag_links_tenant_all` (ALL: conta) | `tarefa_tag_links_tenant_all` (ALL: check conta) |  |
| `tarefas` | 4b | scoped | próprio `cliente_id:bigint` | user_id (autor, confirmado) | responsavel_id | ROOT (Task 1) | `tarefas_tenant_all` (ALL: conta) | `tarefas_tenant_all` (ALL: check custom) |  |
| `files` | 4c | scoped | sem FK: folder_id -> folders (polimórfica); folder_id NULL = sem cliente | uploaded_by | - | proposta: sem "é dele" (arquivo de post dele vem pelo post) | `files_tenant_all` (ALL: conta) | `files_tenant_all` (ALL: check AUSENTE, usa USING) |  |
| `folders` | 4c | scoped | sem FK: source_type/source_id (client, workflow, post, client_reports; root_clients sem cliente). Sem FK | - | - | - | `folders_tenant_all` (ALL: conta) | `folders_tenant_all` (ALL: check AUSENTE, usa USING) |  |
| `post_file_links` | 4c | scoped | pai: file_id->files, post_id->workflow_posts | - | - | - | `post_file_links_tenant_all` (ALL: conta) | `post_file_links_tenant_all` (ALL: check AUSENTE, usa USING) |  |
| `agenda_convidados` | 4d (proposta) | exempt: sem policy p/ authenticated (só service role) | pai: evento_id->agenda_eventos | adicionado_por | - | - | (nenhuma) | (nenhuma) |  |
| `agenda_emails_cliente` | 4d (proposta) | exempt: sem policy p/ authenticated (só service role) | próprio `cliente_id:bigint` | - | - | - | (nenhuma) | (nenhuma) |  |
| `agenda_eventos` | 4d | scoped | próprio `cliente_id:bigint` | organizador_id; participante via agenda_participantes.user_id | - | proposta: root | `agenda_eventos_select` (SELECT: custom) | (nenhuma) |  |
| `agenda_lembretes` | 4d (proposta) | exempt: sem policy p/ authenticated (só service role) | pai: ocorrencia_id->agenda_ocorrencias | user_id | - | - | (nenhuma) | (nenhuma) |  |
| `agenda_ocorrencias` | 4d | scoped (herda do pai quando o pai passar) | pai: evento_id->agenda_eventos | - | - | - | `agenda_ocorrencias_select` (SELECT: custom) | (nenhuma) |  |
| `agenda_participantes` | 4d | scoped (herda do pai quando o pai passar) | pai: evento_id->agenda_eventos | user_id | - | define o "é dele" de agenda_eventos | `agenda_participantes_select` (SELECT: custom) | (nenhuma) |  |
| `agenda_remarcacoes` | 4d (proposta) | exempt: sem policy p/ authenticated (só service role) | próprio `cliente_id:bigint NOT NULL` | - | - | - | (nenhuma) | (nenhuma) |  |
| `agenda_respostas` | 4d | scoped (herda do pai quando o pai passar) | pai: ocorrencia_id->agenda_ocorrencias | user_id | - | - | `agenda_respostas_select` (SELECT: custom) | (nenhuma) |  |
| `agenda_respostas_cliente` | 4d (proposta) | exempt: sem policy p/ authenticated (só service role) | próprio `cliente_id:bigint NOT NULL` | - | - | - | (nenhuma) | (nenhuma) |  |
| `agenda_respostas_convidado` | 4d (proposta) | exempt: sem policy p/ authenticated (só service role) | pai: convidado_id->agenda_convidados, ocorrencia_id->agenda_ocorrencias | - | - | - | (nenhuma) | (nenhuma) |  |
| `analytics_reports` | 4d | scoped | próprio `client_id:bigint` | - | - | - | `reports_conta_select` (SELECT: conta) | `reports_conta_delete` (DELETE: conta)<br>`reports_conta_insert` (INSERT: check conta)<br>`reports_conta_update` (UPDATE: check conta) |  |
| `client_hub_tokens` | 4d | scoped | próprio `cliente_id:bigint NOT NULL` | - | - | - | `client_hub_tokens_workspace_all` (ALL: conta) | `client_hub_tokens_workspace_all` (ALL: check conta) |  |
| `gbp_locations` | 4d | exempt: sem policy p/ authenticated (só service role) | próprio `client_id:bigint NOT NULL` | - | - | - | (nenhuma) | (nenhuma) |  |
| `gbp_metrics_daily` | 4d | exempt: sem policy p/ authenticated (só service role) | sem FK: sem FK de propósito; liga por location_name + conta a gbp_locations | - | - | - | (nenhuma) | (nenhuma) |  |
| `gbp_rating_daily` | 4d | exempt: sem policy p/ authenticated (só service role) | sem FK: sem FK de propósito; liga por location_name + conta a gbp_locations | - | - | - | (nenhuma) | (nenhuma) |  |
| `gbp_reviews` | 4d | exempt: sem policy p/ authenticated (só service role) | sem FK: sem FK de propósito; liga por location_name + conta a gbp_locations | - | - | - | (nenhuma) | (nenhuma) |  |
| `gbp_search_keywords_monthly` | 4d | exempt: sem policy p/ authenticated (só service role) | sem FK: sem FK de propósito; liga por location_name + conta a gbp_locations | - | - | - | (nenhuma) | (nenhuma) |  |
| `instagram_account_metrics_daily` | 4d | exempt: sem policy p/ authenticated (só service role) | pai: instagram_account_id->instagram_accounts | - | - | - | `Service role full access` (ALL: auth.role()=service_role) | `Service role full access` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `instagram_account_metrics_monthly` | 4d | exempt: sem policy p/ authenticated (só service role) | pai: instagram_account_id->instagram_accounts | - | - | - | `Service role full access` (ALL: auth.role()=service_role) | `Service role full access` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `instagram_accounts` | 4d | scoped | próprio `client_id:bigint NOT NULL` | - | - | - | `accounts_conta` (ALL: custom) | `accounts_conta` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `instagram_analytics_cache` | 4d | scoped (herda do pai quando o pai passar) | pai: instagram_account_id->instagram_accounts | - | - | - | `cache_via_account` (ALL: custom) | `cache_via_account` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `instagram_automation_contact_automations` | 4d (proposta) | scoped | pai: contact_id->instagram_automation_contacts | - | - | - | `iaca_select` (SELECT: custom) | (nenhuma) |  |
| `instagram_automation_contacts` | 4d (proposta) | scoped | próprio `client_id:bigint NOT NULL` | - | - | - | `iac_select` (SELECT: custom) | (nenhuma) |  |
| `instagram_automation_sends` | 4d (proposta) | scoped | pai: automation_id->instagram_comment_automations | - | - | - | `ias_select` (SELECT: conta) | (nenhuma) |  |
| `instagram_comment_analyses` | 4d (proposta) | scoped | pai: instagram_account_id->instagram_accounts | analyzed_by | - | - | `instagram_comment_analyses_select` (SELECT: conta) | (nenhuma) |  |
| `instagram_comment_automations` | 4d | scoped | próprio `client_id:bigint NOT NULL` | - | - | - | `ica_select` (SELECT: custom) | `ica_delete` (DELETE: custom)<br>`ica_insert` (INSERT: check custom)<br>`ica_update` (UPDATE: check custom) |  |
| `instagram_connect_links` | 4d | scoped | próprio `cliente_id:bigint NOT NULL` | created_by | - | - | `instagram_connect_links_workspace_all` (ALL: custom) | `instagram_connect_links_workspace_all` (ALL: check custom) |  |
| `instagram_follower_history` | 4d | scoped (herda do pai quando o pai passar) | pai: instagram_account_id->instagram_accounts | - | - | - | `follower_history_via_account` (ALL: custom) | `follower_history_via_account` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `instagram_post_tag_assignments` | 4d | scoped (herda do pai quando o pai passar) | pai: post_id->instagram_posts | - | - | - | `tag_assignments_via_tags` (ALL: custom) | `tag_assignments_via_tags` (ALL: check custom) | SEM conta_id |
| `instagram_posts` | 4d | scoped (herda do pai quando o pai passar) | pai: instagram_account_id->instagram_accounts | - | - | - | `posts_via_account` (ALL: custom) | `posts_via_account` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `instagram_story_insights` | 4d | exempt: sem policy p/ authenticated (só service role) | pai: instagram_account_id->instagram_accounts | - | - | - | `Service role full access` (ALL: auth.role()=service_role) | `Service role full access` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `mensagens` | 4d (proposta) | scoped | próprio `cliente_id:bigint NOT NULL` | author_user_id | - | proposta: sem "é dele" | `mensagens_tenant_select` (SELECT: conta) | `mensagens_tenant_insert` (INSERT: check custom) |  |
| `mensagens_last_seen` | 4d (proposta) | exempt: sem policy p/ authenticated (só service role) | próprio `cliente_id:bigint` | user_id | - | - | (nenhuma) | (nenhuma) |  |
| `report_document_files` | 4d | scoped | pai: file_id->files, report_id->report_documents | - | - | - | `report_document_files_tenant_select` (SELECT: conta) | (nenhuma) |  |
| `report_documents` | 4d | scoped | próprio `client_id:bigint NOT NULL` | created_by | - | proposta: não root | `report_documents_select` (SELECT: conta) | `report_documents_update` (UPDATE: check conta) |  |
| `tiktok_account_metrics_daily` | 4d | exempt: sem policy p/ authenticated (só service role) | pai: tiktok_account_id->tiktok_accounts | - | - | - | `Service role full access` (ALL: auth.role()=service_role) | `Service role full access` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `tiktok_accounts` | 4d | scoped | próprio `client_id:bigint NOT NULL` | - | - | - | `tiktok_accounts_conta` (ALL: custom) | `tiktok_accounts_conta` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `tiktok_follower_history` | 4d | scoped (herda do pai quando o pai passar) | pai: tiktok_account_id->tiktok_accounts | - | - | - | `tiktok_follower_history_via_account` (ALL: custom) | `tiktok_follower_history_via_account` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `tiktok_post_metrics_daily` | 4d | exempt: sem policy p/ authenticated (só service role) | pai: tiktok_account_id->tiktok_accounts | - | - | - | (nenhuma) | (nenhuma) | SEM conta_id |
| `tiktok_posts` | 4d | scoped (herda do pai quando o pai passar) | pai: tiktok_account_id->tiktok_accounts | - | - | - | `tiktok_posts_via_account` (ALL: custom) | `tiktok_posts_via_account` (ALL: check AUSENTE, usa USING) | SEM conta_id |
| `youtube_channel_daily` | 4d | exempt: sem policy p/ authenticated (só service role) | sem FK: sem FK de propósito; liga por channel_id a youtube_channels | - | - | - | (nenhuma) | (nenhuma) |  |
| `youtube_channels` | 4d | exempt: sem policy p/ authenticated (só service role) | próprio `client_id:bigint NOT NULL` | - | - | - | (nenhuma) | (nenhuma) |  |
| `youtube_demographics` | 4d | exempt: sem policy p/ authenticated (só service role) | sem FK: sem FK de propósito; liga por channel_id a youtube_channels | - | - | - | (nenhuma) | (nenhuma) |  |
| `youtube_pdf_purges` | 4d | exempt: sem policy p/ authenticated (só service role) | próprio `client_id:bigint NOT NULL` | - | - | - | (nenhuma) | (nenhuma) |  |
| `youtube_traffic_daily` | 4d | exempt: sem policy p/ authenticated (só service role) | sem FK: sem FK de propósito; liga por channel_id a youtube_channels | - | - | - | (nenhuma) | (nenhuma) |  |
| `youtube_video_daily` | 4d | exempt: sem policy p/ authenticated (só service role) | sem FK: sem FK de propósito; liga por channel_id a youtube_channels | - | - | - | (nenhuma) | (nenhuma) |  |
| `youtube_videos` | 4d | exempt: sem policy p/ authenticated (só service role) | sem FK: sem FK de propósito; liga por channel_id a youtube_channels | - | - | - | (nenhuma) | (nenhuma) |  |
| `notifications` | 4e | scoped | próprio `cliente_id:bigint`; cliente_id sem FK (Task 1), backfill do metadata | user_id (destinatário) | - | 4e usa can_see_cliente_context | `notifications_select` (SELECT: custom) | `notifications_update` (UPDATE: check custom) |  |
| `contratos` | 6 | scoped | próprio `cliente_id:bigint` | user_id (criador) | - | Task 6: sem "é dele" | `contratos_select` (SELECT: custom) | `contratos_delete` (DELETE: custom)<br>`contratos_insert` (INSERT: check custom)<br>`contratos_update` (UPDATE: check custom) |  |
| `financeiro_atribuicoes` | 6 | exempt: Task 6 (escrita só por RPC; filtro na leitura). Policy de SELECT direta continua aberta: Task 6 decide | próprio `cliente_id:bigint NOT NULL` | - | membro_id (custo, não "é dele") | - | `financeiro_atribuicoes_select` (SELECT: custom) | (nenhuma) |  |
| `financeiro_cliente_versoes` | 6 | exempt: idem | próprio `cliente_id:bigint NOT NULL` | created_by | - | - | `financeiro_cliente_versoes_select` (SELECT: custom) | (nenhuma) |  |
| `financeiro_entregas_manuais` | 6 | exempt: idem | próprio `cliente_id:bigint NOT NULL` | - | membro_id (custo, não "é dele") | - | `financeiro_entregas_manuais_select` (SELECT: custom) | (nenhuma) |  |
| `transacoes` | 6 | scoped | próprio `cliente_id:bigint` | user_id (criador) | - | Task 6: sem "é dele" | `transacoes_select` (SELECT: custom) | `transacoes_delete` (DELETE: custom)<br>`transacoes_insert` (INSERT: check custom)<br>`transacoes_update` (UPDATE: check custom) |  |
| `workspace_member_clientes` | 1 | exempt: a tabela de atribuições (Task 1) | próprio `cliente_id:bigint NOT NULL` | - | - | - | `wmc_select_own_or_owner` (SELECT: custom) | (nenhuma) |  |
| `oauth_states` | - | exempt: RLS DESLIGADA; estado de OAuth usado só por service role (ver Surpresas) | próprio `client_id:bigint NOT NULL` | initiated_by | - | - | (nenhuma) | (nenhuma) |  |

## Views

| view | security_invoker? | filter | dono |
|---|---|---|---|
| `clientes_v` | não (`security_barrier=true`, roda como dono) | `WHERE conta_id = get_my_conta_id()`, sem predicado | Task 3 (vermelho na guarda) |
| `post_media_notes_v` | sim | herda a RLS de `post_media_notes` e `post_file_links` | 4a (nada a fazer na view) |
| `instagram_account_last_post` | sim | herda a RLS de `instagram_posts` | 4d (nada a fazer na view) |
| `membros_v` | não (barrier) | `conta_id = get_my_conta_id()` | não está sobre tabela de cliente; 4e (membros) só se mudar |
| `popup_interaction_counts` | não | sem filtro | não é de cliente |

Nenhuma view não-invoker além de `clientes_v` sobre tabela de cliente.

## SECURITY DEFINER

### Task 5: executáveis por authenticated (fora do financeiro)

Leem ou escrevem tabela de cliente em nome do usuário, sem RLS. Readers filtram pelo predicado;
writers e duplicadores recusam origem ou destino oculto (`client_scope_restricted`). Os
service_role `_clone_post_row` e `_realign_pending_etapas_to_template` só são chamados por
`duplicate_post`/`duplicate_workflow`/`move_posts_to_new_flow`, então o filtro entra no chamador.

| definer function | EXECUTE | reads which tables | called by |
|---|---|---|---|
| `accept_edit_suggestion(bigint,timestamp with time zone,text[],text[])` | authenticated,service_role | post_edit_suggestions, post_targets, workflow_posts | CRM |
| `advance_workflow_from_approval(bigint,bigint,text,jsonb)` | authenticated,service_role | workflow_etapas, workflow_posts, workflows | CRM |
| `agenda_evento_criar(jsonb,uuid[])` | authenticated,service_role | agenda_eventos, agenda_ocorrencias, agenda_participantes | CRM |
| `agenda_evento_editar(bigint,text,jsonb,uuid[])` | authenticated,service_role | agenda_convidados, agenda_eventos, agenda_ocorrencias, agenda_participantes, agenda_respostas_cliente, agenda_respostas_convidado, notifications | CRM; sql: agenda_remarcacao_resolver |
| `agenda_evento_excluir(bigint,text)` | authenticated,service_role | agenda_convidados, agenda_eventos, agenda_ocorrencias, agenda_participantes | CRM |
| `agenda_listar(timestamp with time zone,timestamp with time zone,bigint)` | authenticated,service_role | agenda_convidados, agenda_eventos, agenda_ocorrencias, agenda_participantes, agenda_remarcacoes, agenda_respostas, agenda_respostas_cliente, agenda_respostas_convidado, clientes | CRM; edge: agenda-feed |
| `agenda_pode_ver_evento(bigint,boolean,uuid)` | authenticated,service_role | agenda_participantes | (nenhum achado) |
| `agenda_remarcacao_resolver(bigint,boolean,text)` | authenticated,service_role | agenda_emails_cliente, agenda_eventos, agenda_ocorrencias, agenda_remarcacoes, agenda_respostas_cliente | CRM |
| `agenda_responder(bigint,text,text)` | authenticated,service_role | agenda_eventos, agenda_ocorrencias, agenda_participantes, agenda_respostas | CRM |
| `apply_post_process(bigint,bigint,text,integer,jsonb)` | authenticated,service_role | clientes, post_process_steps, post_processes, workflow_posts | CRM; sql: update_workflow_template |
| `attach_post_closing_process(bigint,bigint,integer)` | authenticated,service_role | post_process_steps, post_processes, workflow_posts, workflows | CRM |
| `attach_posts_to_flow(bigint[],bigint)` | authenticated,service_role | workflow_posts, workflows | CRM |
| `can_see_cliente_context(bigint)` | authenticated,service_role | tarefas, workflow_etapas, workflow_posts, workflows | (nenhum achado) |
| `detach_posts_from_flow(bigint[],boolean)` | authenticated,service_role | workflow_posts, workflows | CRM; sql: detach_posts_keeping_process |
| `detach_posts_keeping_process(bigint[],bigint,text,timestamp with time zone,uuid,jsonb,boolean)` | authenticated,service_role | post_process_steps, post_processes, workflow_etapas, workflow_posts, workflows | CRM |
| `duplicate_post(bigint,boolean)` | authenticated,service_role | workflow_posts | CRM |
| `duplicate_workflow(bigint,boolean)` | authenticated,service_role | post_processes, workflow_etapas, workflow_posts, workflow_select_options, workflows | CRM |
| `get_mensagens_conversas()` | anon,authenticated,service_role | clientes, instagram_accounts, mensagens, mensagens_last_seen, post_approvals, post_edit_suggestions, post_media_note_replies, post_media_notes, workflow_posts | CRM |
| `get_mensagens_feed(uuid,bigint,timestamp with time zone,integer,text,bigint)` | anon,authenticated,service_role | clientes, mensagens, post_approvals, post_edit_suggestions, post_media_note_replies, post_media_notes, workflow_posts | CRM; edge: hub-mensagens |
| `get_mensagens_unread(uuid,bigint)` | anon,authenticated,service_role | mensagens, mensagens_last_seen, post_approvals, post_edit_suggestions, post_media_note_replies, post_media_notes, workflow_posts | CRM; edge: hub-mensagens |
| `get_or_create_client_reports_folder(bigint)` | authenticated,service_role | clientes, folders | CRM |
| `get_post_discussao_nao_lidas(bigint[],bigint[])` | authenticated | post_comment_threads, post_comments, post_discussao_participantes, workflow_posts | CRM |
| `get_post_discussao_participacao(bigint)` | authenticated | post_discussao_participantes, workflow_posts | CRM |
| `hub_token_extend(uuid)` | authenticated,service_role | client_hub_tokens | CRM |
| `hub_token_rotate(uuid)` | authenticated,service_role | client_hub_tokens | CRM |
| `linha_editorial_coluna_excluir(uuid)` | authenticated,service_role | linha_editorial_itens | CRM |
| `linha_editorial_converter(uuid,bigint,jsonb)` | authenticated,service_role | linha_editorial_itens, linhas_editoriais, post_property_values, workflow_posts, workflows | CRM |
| `linha_editorial_criar(bigint,date)` | authenticated,service_role | clientes, linhas_editoriais | CRM |
| `linha_editorial_enviar(uuid)` | authenticated,service_role | linha_editorial_itens, linhas_editoriais | CRM |
| `linha_editorial_recolher(uuid)` | authenticated,service_role | linhas_editoriais | CRM |
| `mark_equipe_conversa_seen(bigint,bigint)` | authenticated | mensagens | CRM |
| `mark_mensagens_seen(uuid,bigint)` | anon,authenticated,service_role | mensagens_last_seen | CRM; edge: hub-mensagens |
| `migrate_workflow_template(bigint,bigint,jsonb,integer,text,bigint,integer)` | authenticated,service_role | portal_approvals, post_property_values, workflow_etapas, workflow_events, workflow_posts, workflow_select_options, workflows | CRM |
| `move_posts_to_existing_flow(bigint[],bigint,bigint,boolean)` | authenticated,service_role | workflow_posts, workflows | CRM |
| `move_posts_to_new_flow(bigint[],bigint,text,integer,boolean)` | authenticated,service_role | workflow_etapas, workflow_events, workflow_posts, workflows | CRM |
| `post_discussao_enviar(bigint,text,bigint)` | authenticated | post_comment_threads, post_comments, workflow_posts | CRM |
| `post_discussao_marcar_lido(bigint,bigint)` | authenticated | post_comment_threads, post_comments, post_discussao_participantes, workflow_posts | CRM |
| `post_discussao_seguir(bigint,boolean)` | authenticated | post_discussao_participantes, workflow_posts | CRM |
| `propagate_template_to_workflows(bigint)` | authenticated,service_role | workflow_etapas, workflows | (nenhum achado) |
| `reject_edit_suggestion(bigint)` | authenticated,service_role | post_edit_suggestions | CRM |
| `remove_post_process(bigint,integer)` | authenticated,service_role | post_process_steps, post_processes, workflow_posts | CRM |
| `reorder_board_posts(bigint[],double precision[])` | authenticated,service_role | workflow_posts | CRM |
| `reorder_fluxos_board(bigint[],integer[],bigint[],integer[])` | authenticated,service_role | post_processes, workflows | CRM |
| `reorder_workflow_positions(bigint[],integer[])` | authenticated,service_role | workflows | CRM |
| `resolve_post_process_rascunho_banner(bigint,timestamp with time zone,boolean)` | authenticated,service_role | post_process_steps, post_processes, workflow_posts | CRM |
| `resolve_workflow_rascunho_banner(bigint,timestamp with time zone,boolean)` | authenticated,service_role | workflow_etapas, workflow_posts, workflows | CRM |
| `tarefa_comentario_enviar(bigint,text)` | authenticated | mencoes, notifications, tarefa_comentarios, tarefas | CRM |
| `tarefa_serie_aplicar_edicao(bigint,jsonb,bigint[],jsonb,boolean)` | authenticated,service_role | subtarefas, tarefa_series, tarefa_tag_links, tarefas | CRM |
| `tarefa_serie_criar(jsonb,jsonb,bigint[],text[],bigint)` | authenticated,service_role | subtarefas, tarefa_series, tarefa_tag_links, tarefas | CRM |
| `tarefa_serie_definir_estado(bigint,text)` | authenticated,service_role | tarefa_series | CRM |
| `tarefa_serie_excluir(bigint)` | authenticated,service_role | tarefa_series, tarefas | CRM |
| `transition_post_process(bigint,integer,text,text,text,timestamp with time zone)` | authenticated,service_role | post_process_steps, post_processes, workflow_posts | CRM |
| `update_post_process_step(bigint,integer,integer,bigint,timestamp with time zone,integer,text)` | authenticated,service_role | post_process_steps, post_processes, workflow_posts | CRM; sql: apply_post_process |
| `update_workflow_template(bigint,text,jsonb,text)` | authenticated,service_role | portal_approvals, workflow_etapas, workflow_events, workflows | CRM |
| `workspace_usage()` | authenticated,service_role | client_hub_tokens, clientes, instagram_accounts | CRM |

INVOKER que leem tabela de cliente (herdam a RLS, nada a fazer além de conferir no teste):
`get_client_health_aggregates(integer)` (Task 3), `get_workflow_analytics(...)`,
`get_workflow_post_stats(bigint[])`, `workflow_fingerprint(bigint)`, `save_ig_caption(...)`,
`create_team_media_note(...)`, `_media_note_anchor(...)`, `convert_solicitacao_em_tarefa(...)`
(cria tarefa com o `cliente_id` da ideia: o WITH CHECK de `tarefas` da 4b barra),
`sync_mentions(...)`, `agenda_normalizar_dtstart(agenda_eventos)`.

Caminhos que criam cliente (gate da Task 3 em `my_client_scope_all()`): INSERT direto em
`clientes` pelo CRM (`store/clients.ts addCliente`, também usado na conversão de lead em
`LeadsPage.tsx`: não há RPC de conversão), `import_commit_row` (service_role, edge `data-import`),
`demo_workspace_seed` (service_role, `platform-admin`, isento), MCP `create_client` (Task 12).

### Task 6: financeiro

Executáveis por authenticated: `financeiro_acordo_salvar`, `financeiro_atribuicoes_salvar`,
`financeiro_cliente_salvar`, `financeiro_config_salvar`, `financeiro_entregas_salvar`,
`financeiro_funcao_excluir`, `financeiro_funcao_salvar`, `financeiro_periodo_fechar`,
`financeiro_periodo_reabrir`, `financeiro_periodos_editaveis`, `financeiro_periodos_listar`,
`financeiro_rentabilidade`, `financeiro_seed`. Só service_role: os `_core`, `_financeiro_calcular`
(intocado, plano), `_financeiro_sincronizar_legado`, `_financeiro_v2_legado_trigger`,
`financeiro_rolar_periodos` (pg_cron) e as variantes `_as` (MCP, Task 12 via `p_actor`):
`financeiro_acordo_salvar_as`, `financeiro_agendamento_confirmar_as`,
`financeiro_atribuicoes_salvar_as`, `financeiro_cliente_salvar_as`, `financeiro_config_salvar_as`,
`financeiro_entregas_salvar_as`, `financeiro_funcao_excluir_as`, `financeiro_funcao_salvar_as`,
`financeiro_periodo_fechar_as`, `financeiro_periodo_reabrir_as`, `financeiro_periodos_editaveis_as`,
`financeiro_periodos_listar_as`, `financeiro_recorrente_criar_as`, `financeiro_rentabilidade_as`,
`financeiro_seed_as`. As tabelas `financeiro_atribuicoes`, `financeiro_cliente_versoes` e
`financeiro_entregas_manuais` têm policy de SELECT direta para authenticated: a Task 6 precisa
decidir se a leitura direta também é filtrada, ou o restrito lê os valores de cliente oculto pelo
PostgREST. `contratos` e `transacoes` (legado) ficam com a Task 6, com as regras da Task 4.

### Só service_role (ou só o dono), por chamador

A tarefa de cada um é a do chamador: edge function do CRM -> Task 13; `mcp` -> Task 12; crons
de notificação -> Task 14; `hub-*`, webhooks, crons de sync/publicação e `platform-admin` ->
isentos. `sql:` = chamado por outra função (o filtro vai no chamador).

| definer function | reads which tables | called by |
|---|---|---|
| `_clone_post_row(uuid,bigint,bigint,boolean,jsonb,boolean)` | post_file_links, post_process_steps, post_processes, post_property_values, post_targets, workflow_posts | sql: duplicate_post, duplicate_workflow |
| `_realign_pending_etapas_to_template(bigint)` | portal_approvals, workflow_etapas, workflows | sql: duplicate_workflow, move_posts_to_new_flow |
| `_record_post_geral_caption_version(bigint,text,text)` | post_content_versions, post_status_events, workflow_posts | sql: accept_edit_suggestion, post_targets_geral_caption_version |
| `_tarefa_evento_cliente(uuid,bigint)` | clientes | sql: tarefas_evento_update_fn |
| `_tarefa_evento_registrar(uuid,bigint,text,jsonb,jsonb,uuid)` | tarefa_eventos, tarefas | sql: subtarefas_evento_fn, tarefa_tag_links_evento_fn, tarefas_evento_insert_fn, tarefas_evento_update_fn |
| `_tarefa_eventos_backfill()` | tarefa_eventos, tarefas | (nenhum achado) |
| `admin_list_workspaces(text,text,integer,integer,timestamp with time zone,text,boolean,text,timestamp with time zone,text,text)` | clientes, instagram_accounts | edge: platform-admin |
| `admin_workspace_last_activity(uuid[])` | briefings, clientes, contratos, instagram_accounts, workflow_posts | edge: platform-admin, retention-radar-cron; sql: admin_list_workspaces |
| `agenda_claim_emails_lembrete(integer)` | agenda_eventos, agenda_lembretes, agenda_ocorrencias, agenda_participantes, agenda_respostas | edge: agenda-lembretes-email |
| `agenda_cliente_claim_emails(integer)` | agenda_convidados, agenda_emails_cliente, agenda_eventos, clientes | edge: agenda-cliente-email |
| `agenda_cliente_enfileirar(uuid,bigint,bigint,text,jsonb,jsonb,bigint)` | agenda_convidados, agenda_emails_cliente, agenda_remarcacoes | sql: agenda_envios_enfileirar, agenda_remarcacao_resolver |
| `agenda_cliente_lembretes_marcar(uuid,bigint,jsonb)` | agenda_eventos, agenda_ocorrencias, agenda_respostas_cliente | edge: client-event-email-cron |
| `agenda_cliente_lembretes_pendentes(uuid,bigint,timestamp with time zone)` | agenda_eventos, agenda_ocorrencias, agenda_respostas_cliente | edge: client-event-email-cron |
| `agenda_cliente_liberar_emails(bigint[])` | agenda_emails_cliente | edge: agenda-cliente-email |
| `agenda_cliente_marcar_email(bigint,integer,boolean,text)` | agenda_emails_cliente | edge: agenda-cliente-email |
| `agenda_cliente_ocorrencias_snapshot(bigint,text,bigint,date)` | agenda_eventos, agenda_ocorrencias | sql: agenda_cliente_diff, agenda_evento_criar, agenda_evento_editar, agenda_evento_excluir, agenda_remarcacao_resolver |
| `agenda_cliente_substituir_pedidos(bigint,bigint,date)` | agenda_ocorrencias, agenda_remarcacoes | sql: agenda_evento_editar, agenda_evento_excluir |
| `agenda_cliente_tick()` | agenda_emails_cliente | pg_cron: agenda-cliente-email |
| `agenda_convidados_perda(bigint,bigint[])` | agenda_emails_cliente | sql: agenda_evento_editar, agenda_evento_excluir |
| `agenda_convidados_snapshot(bigint,text,bigint,date)` | agenda_eventos, agenda_ocorrencias | sql: agenda_evento_criar, agenda_evento_editar, agenda_evento_excluir |
| `agenda_convite_descadastrar(bigint)` | agenda_convidados, agenda_emails_cliente | edge: client-email-unsub |
| `agenda_convite_item(bigint,bigint)` | agenda_convidados, agenda_eventos, agenda_ocorrencias, agenda_respostas_convidado | sql: agenda_convite_ler, agenda_convite_ocorrencia, agenda_convite_responder |
| `agenda_convite_ler(text)` | agenda_convidados, agenda_eventos, agenda_ocorrencias | edge: agenda-convite |
| `agenda_convite_ocorrencia(text,bigint)` | agenda_convidados, agenda_ocorrencias | edge: agenda-convite |
| `agenda_convite_resolver(text)` | agenda_convidados | edge: agenda-convite |
| `agenda_convite_responder(text,bigint,text,timestamp with time zone)` | agenda_convidados, agenda_eventos, agenda_ocorrencias, agenda_respostas_convidado | edge: agenda-convite |
| `agenda_definir_convidados(bigint,jsonb)` | agenda_convidados, agenda_eventos | sql: agenda_evento_criar, agenda_evento_editar |
| `agenda_definir_participantes(bigint,uuid,uuid,uuid[])` | agenda_ocorrencias, agenda_participantes, agenda_respostas | sql: agenda_evento_editar |
| `agenda_envios_enfileirar(uuid,bigint,jsonb)` | agenda_ocorrencias | sql: agenda_evento_criar, agenda_evento_editar, agenda_evento_excluir |
| `agenda_feed_eventos(text)` | agenda_eventos, agenda_ocorrencias, agenda_participantes, agenda_respostas | edge: agenda-feed |
| `agenda_gerar_horizonte()` | agenda_eventos, agenda_lembretes | pg_cron: agenda-horizonte |
| `agenda_hub_cancelar_remarcacao(uuid,bigint,bigint)` | agenda_eventos, agenda_ocorrencias, agenda_remarcacoes | edge: hub-agenda |
| `agenda_hub_cliente(uuid,bigint)` | clientes | sql: agenda_hub_cancelar_remarcacao, agenda_hub_ocorrencia, agenda_hub_remarcar, agenda_hub_responder |
| `agenda_hub_item(uuid,bigint,bigint)` | agenda_eventos, agenda_ocorrencias, agenda_remarcacoes, agenda_respostas_cliente | sql: agenda_hub_listar, agenda_hub_ocorrencia, agenda_hub_periodo, agenda_hub_remarcar, agenda_hub_responder |
| `agenda_hub_listar(uuid,bigint,timestamp with time zone,bigint,integer)` | agenda_eventos, agenda_ocorrencias, clientes | edge: hub-agenda |
| `agenda_hub_periodo(uuid,bigint,timestamp with time zone,timestamp with time zone)` | agenda_eventos, agenda_ocorrencias, clientes | edge: hub-agenda |
| `agenda_hub_remarcar(uuid,bigint,bigint,date,time without time zone,text)` | agenda_eventos, agenda_ocorrencias, agenda_remarcacoes | edge: hub-agenda |
| `agenda_hub_responder(uuid,bigint,bigint,text,timestamp with time zone)` | agenda_eventos, agenda_ocorrencias, agenda_respostas_cliente | edge: hub-agenda |
| `agenda_marcar_email_lembrete(bigint,uuid,integer,timestamp with time zone,boolean)` | agenda_lembretes | edge: agenda-lembretes-email |
| `agenda_materializar(bigint,date)` | agenda_eventos, agenda_ocorrencias | sql: agenda_evento_criar, agenda_evento_editar, agenda_gerar_horizonte, demo_workspace_seed |
| `agenda_notificar(uuid,bigint,bigint,text,uuid[],uuid,jsonb)` | agenda_eventos, agenda_ocorrencias | sql: agenda_convite_responder, agenda_evento_criar, agenda_evento_editar, agenda_evento_excluir, agenda_hub_remarcar, agenda_hub_responder, agenda_responder |
| `agenda_ocorrencias_bump_sequencia(bigint[])` | agenda_ocorrencias | sql: agenda_envios_enfileirar |
| `agenda_regenerar(bigint,boolean)` | agenda_eventos, agenda_ocorrencias | sql: agenda_evento_editar |
| `agenda_tick_lembretes(timestamp with time zone,boolean)` | agenda_eventos, agenda_lembretes, agenda_ocorrencias, agenda_participantes, agenda_respostas, notifications | pg_cron: agenda-lembretes |
| `agenda_validar_payload(uuid,jsonb,agenda_eventos)` | agenda_eventos, clientes | sql: agenda_evento_criar, agenda_evento_editar |
| `automation_media_release(uuid,text)` | instagram_comment_automations | edge: automation-media |
| `begin_target_publish(bigint,text,text,uuid)` | post_targets, workflow_posts | edge: tiktok-publish |
| `briefing_audio_apply_transcript(uuid,bigint,uuid,text,text,integer)` | hub_briefing_questions | edge: _shared |
| `briefing_audio_finalize(uuid,bigint,uuid,text,bigint,text,integer)` | hub_briefing_questions | edge: _shared |
| `briefing_audio_release(uuid,bigint,uuid)` | hub_briefing_questions | edge: _shared |
| `bulk_move_items(uuid,bigint[],bigint[],bigint)` | files, folders | edge: file-manage |
| `can_access_cliente(uuid,uuid,bigint)` | workspace_member_clientes | sql: can_see_cliente_context |
| `cancel_target_publish(bigint,text,text,uuid)` | post_targets, workflow_posts | edge: tiktok-publish |
| `claim_automation_send(text,uuid,uuid,text,text,text,text,timestamp with time zone,integer)` | instagram_automation_sends | edge: instagram-webhook; sql: et_iac_send |
| `claim_client_event_emails(timestamp with time zone,integer)` | clientes | edge: client-event-email-cron |
| `claim_marketing_email(text,uuid,uuid,integer)` | clientes | edge: loops-sync-cron |
| `claim_notification_emails(timestamp with time zone,timestamp with time zone,integer)` | notifications | edge: notification-email-cron |
| `claim_posts_for_publishing(text,integer)` | instagram_accounts, workflow_posts | edge: instagram-publish-cron |
| `claim_retryable_automation_sends(integer)` | instagram_accounts, instagram_automation_sends, instagram_comment_automations | edge: instagram-automation-cron |
| `claim_tiktok_targets_for_publishing(text,integer)` | post_targets, tiktok_accounts, workflow_posts | edge: tiktok-publish-cron |
| `create_edit_suggestion_notification(bigint)` | clientes, post_edit_suggestions, workflow_posts | edge: hub-edit-suggestion |
| `create_instagram_connect_link(bigint,uuid,uuid,integer)` | clientes, instagram_connect_links | edge: instagram-connect-link |
| `create_linha_notification(uuid,text)` | clientes, linha_editorial_itens, linha_editorial_respostas, linhas_editoriais | edge: hub-linha-editorial |
| `create_post_approval_notification(bigint,text,text)` | clientes, workflow_posts | edge: hub-approve, hub-media-notes; sql: trg_notify_post_approval |
| `create_post_reference_notification(bigint)` | clientes, notifications, workflow_posts | edge: hub-post-references |
| `demo_workspace_discard(uuid)` | agenda_eventos, agenda_ocorrencias, clientes, ideias, workflow_etapas, workflow_posts, workflows | edge: platform-admin |
| `demo_workspace_seed(uuid,uuid)` | agenda_eventos, clientes, ideias, workflow_etapas, workflow_posts, workflows | edge: platform-admin |
| `derive_post_platform(bigint)` | post_targets | sql: _clone_post_row, post_targets_sync_platform, workflow_posts_board_move_seed_targets, workflow_posts_platform_to_targets |
| `express_cleanup_delete_avulso_drafts(bigint[])` | post_processes, workflow_posts | edge: express-post-cleanup-cron |
| `fail_ineligible_automation_sends()` | instagram_accounts, instagram_automation_sends, instagram_comment_automations | edge: instagram-automation-cron |
| `file_insert_with_quota(jsonb)` | files | edge: file-upload-finalize, mcp-admin; sql: mcp_attach_post_file, post_media_set_from_uploads |
| `folder_breadcrumbs(bigint)` | folders | edge: file-manage |
| `folder_sizes_batch(bigint[])` | files, folders | edge: file-manage |
| `folder_total_size(bigint)` | files, folders | edge: file-manage |
| `generate_recurring_tarefas()` | tarefa_series | sql: tarefa_series_guard; pg_cron: tarefas-recorrentes-generate |
| `get_crisp_sync_candidates()` | clientes | edge: crisp-sync-cron |
| `get_dormant_signup_candidates()` | clientes | edge: loops-sync-cron |
| `get_loops_trait_candidates()` | files | edge: loops-sync-cron |
| `get_paywall_hit_candidates()` | clientes | edge: loops-sync-cron |
| `google_connection_upsert(uuid,text,text,text,text,text,timestamp with time zone,text[])` | gbp_locations, youtube_channels | edge: google-integration |
| `google_expire_units()` | gbp_locations, report_documents, youtube_channels | edge: gbp-sync-cron |
| `google_mark_revoked(uuid)` | gbp_locations, youtube_channels | edge: _shared |
| `google_orphan_subs(integer)` | gbp_locations, youtube_channels | edge: gbp-sync-cron |
| `google_unlink_gbp_location(uuid,uuid)` | gbp_locations | edge: google-integration |
| `google_unlink_youtube(uuid,bigint)` | youtube_channels | edge: google-integration |
| `has_permission_for(uuid,uuid,text,text)` | clientes, contratos, ideias, instagram_comment_automations, tarefas | edge: _shared; sql: agenda_feed_eventos, agenda_pode_editar, duplicate_post, duplicate_workflow, has_permission, post_process_require_editor, set_member_photo |
| `hub_add_media_note_reply(uuid,bigint,text,bigint,text)` | post_media_note_replies, post_media_notes, workflow_posts | edge: hub-media-notes |
| `hub_create_media_note(uuid,bigint,text,bigint,bigint,numeric,real,real,text)` | post_media_notes, workflow_posts | edge: hub-media-notes |
| `hub_token_touch(uuid)` | client_hub_tokens | edge: hub-bootstrap |
| `ideia_audio_apply_transcript(uuid,uuid,text,text,integer)` | ideias | edge: _shared |
| `ideia_audio_finalize(uuid,uuid,text,text,bigint,text,integer)` | ideias | edge: _shared |
| `ideia_audio_release(uuid,uuid,text)` | ideias | edge: _shared |
| `ideia_file_insert_with_quota(jsonb)` | files, ideia_files, ideias | edge: _shared |
| `import_commit_row(uuid,bigint,text,text,jsonb)` | clientes, ideias, workflow_etapas, workflow_posts, workflows | edge: data-import |
| `import_resolve_cliente(uuid,bigint,jsonb)` | clientes | sql: import_commit_row |
| `insert_notification_batch(uuid,uuid[],text,text,jsonb,uuid)` | notifications | edge: _shared, notification-deadline-cron; sql: agenda_notificar, create_edit_suggestion_notification, create_linha_notification, create_post_approval_notification, create_post_reference_notification, run_post_status_automations, storage_autoclean_run, trg_notify_briefing_answered, trg_notify_client_message, trg_notify_idea_submitted, trg_notify_invite_accepted, trg_notify_member_removed, trg_notify_mention, trg_notify_post_approval, trg_notify_post_assigned, trg_notify_post_publish_failed, trg_notify_role_changed, trg_notify_step_activated, trg_notify_step_completed, trg_notify_task_assigned, trg_notify_workflow_completed |
| `instagram_automation_contact_source(uuid,uuid)` | instagram_automation_sends, instagram_comment_automations | sql: rebuild_instagram_automation_contacts |
| `mark_automation_dm_sent(uuid,text)` | instagram_automation_sends, instagram_comment_automations | edge: instagram-webhook |
| `mark_platform_published(bigint,text,text,uuid,jsonb)` | workflow_posts | edge: instagram-publish, instagram-publish-cron |
| `mark_target_failed(bigint,text,text,text,boolean,text,uuid)` | post_targets, workflow_posts | edge: _shared |
| `mark_target_published(bigint,text,jsonb,text,uuid)` | post_targets, workflow_posts | edge: _shared, tiktok-publish; sql: mark_platform_published |
| `mcp_attach_post_file_v2(uuid,bigint,uuid,jsonb,integer,boolean,integer,bigint,boolean)` | post_file_links, workflow_posts | edge: mcp |
| `mcp_attach_post_file(uuid,bigint,uuid,jsonb,integer,boolean)` | files, post_file_links, workflow_posts | edge: mcp; sql: mcp_attach_post_file_v2 |
| `mcp_send_post_to_client(uuid,bigint,text,uuid)` | workflow_posts | edge: mcp |
| `notification_deadline_candidates()` | clientes, workflow_etapas, workflows | edge: notification-deadline-cron |
| `post_board_platforms(bigint,bigint)` | clientes, workflows | sql: post_seed_targets, post_targets_seed, workflow_posts_board_move_seed_targets, workflow_posts_platform_to_targets |
| `post_discussao_backfill_participantes()` | post_comment_threads, post_comments, post_discussao_participantes, workflow_posts | (nenhum achado) |
| `post_discussao_post_do_chamador(bigint)` | workflow_posts | sql: get_post_discussao_participacao, post_discussao_enviar, post_discussao_marcar_lido, post_discussao_seguir |
| `post_file_link_replace(uuid,uuid,bigint,bigint,text)` | files, post_file_links, post_targets, workflow_posts | edge: post-media-manage |
| `post_file_link_set_cover(bigint)` | post_file_links | edge: file-manage, post-media-manage |
| `post_media_insert_with_quota(jsonb)` | post_media | edge: post-media-finalize |
| `post_media_set_cover(bigint)` | post_media | (nenhum achado) |
| `post_media_set_from_uploads(uuid,bigint,uuid,jsonb)` | files, post_file_links, workflow_posts | edge: mcp |
| `post_reference_can_remove(bigint)` | post_approvals, post_references, post_status_events, workflow_posts | sql: post_reference_client_delete, post_reference_client_update, post_reference_list |
| `post_reference_client_delete(bigint,uuid,bigint)` | files, post_references, workflow_posts | edge: hub-post-references |
| `post_reference_client_update(bigint,uuid,bigint,text)` | post_references, workflow_posts | edge: hub-post-references |
| `post_reference_file_insert(jsonb)` | files, post_references, workflow_posts | edge: _shared |
| `post_reference_link_insert(jsonb)` | post_references, workflow_posts | edge: _shared |
| `post_reference_list(bigint,uuid)` | files, post_references | edge: _shared |
| `rebuild_instagram_automation_contacts(uuid,uuid)` | instagram_automation_contact_automations, instagram_automation_contacts | sql: snapshot_instagram_automation_contacts |
| `recompute_post_publish_status(bigint,text,uuid)` | post_targets, workflow_posts | sql: mark_platform_published, mark_target_failed, mark_target_published, requeue_target |
| `reconcile_unlinked_automation_targets()` | instagram_comment_automations, workflow_posts | edge: instagram-automation-cron |
| `record_client_approval_with_notes(bigint,uuid,bigint,text,text,text,text,text)` | post_approval_media_notes, post_media_notes, workflow_posts | edge: hub-approve |
| `record_client_approval(bigint,text,text,text,boolean,text,text)` | post_approvals, post_edit_suggestions, workflow_posts | sql: record_client_approval_with_notes |
| `record_linha_comment(uuid,uuid,uuid,bigint,text,text)` | linha_editorial_itens, linha_editorial_respostas, linhas_editoriais | edge: hub-linha-editorial |
| `record_linha_decision(uuid,uuid,bigint,text,text,text)` | linha_editorial_itens, linha_editorial_respostas, linhas_editoriais | edge: hub-linha-editorial |
| `record_linha_item_decision(uuid,uuid,uuid,bigint,text,text,text)` | linha_editorial_itens, linha_editorial_respostas, linhas_editoriais | edge: hub-linha-editorial |
| `record_post_status_change(bigint,text,text,uuid,bigint,jsonb)` | workflow_posts | edge: _shared, hub-approve, instagram-publish, tiktok-publish; sql: begin_target_publish, cancel_target_publish, recompute_post_publish_status |
| `record_workflow_event(bigint,uuid,text,bigint,text,jsonb,uuid)` | workflow_events | sql: migrate_workflow_template, propagate_template_to_workflows, record_workflow_created_event, record_workflow_etapa_updated_event, record_workflow_updated_event, update_workflow_template |
| `reorder_post_schedules(bigint,uuid,jsonb,text[])` | post_targets, workflow_posts | edge: crm-reorder-post-schedules; sql: hub_reorder_post_schedules |
| `requeue_target(bigint,text,text,uuid)` | post_targets, workflow_posts | edge: tiktok-publish, tiktok-publish-cron |
| `revoke_instagram_connect_link(bigint,uuid)` | clientes, instagram_connect_links | edge: instagram-connect-link |
| `set_carousel_child_field(bigint,integer,text,jsonb)` | workflow_posts | edge: _shared |
| `set_member_client_scope(uuid,uuid,uuid,text,bigint[])` | clientes, workspace_member_clientes | (nenhum achado) |
| `set_story_segment_field(bigint,integer,text,text)` | workflow_posts | edge: _shared |
| `storage_autoclean_run(uuid,integer)` | files, ideia_files, post_file_links, workflow_posts | edge: storage-autoclean-cron |
| `sweep_pending_instagram_automation_links()` | instagram_comment_automations, workflow_posts | edge: instagram-automation-cron |
| `tarefa_serie_garantir_aberta(bigint,date)` | tarefa_series, tarefas | sql: tarefa_serie_aplicar_edicao, tarefa_series_apos_retomar_fn, tarefas_serie_ao_concluir_fn, tarefas_serie_ao_excluir_fn |
| `tarefa_serie_materializar(bigint,date)` | subtarefas, tarefa_series, tarefa_tag_links, tarefas | sql: generate_recurring_tarefas, tarefa_serie_garantir_aberta |
| `tarefa_serie_validar_refs(uuid,bigint,bigint)` | clientes | sql: tarefa_serie_aplicar_edicao, tarefa_serie_criar |
| `tiktok_backfill_targets(uuid)` | post_targets, workflow_posts | (nenhum achado) |
| `upsert_edit_suggestion(bigint,uuid,text,jsonb,text,text,text[],jsonb,jsonb)` | post_edit_suggestions, post_targets, workflow_posts | edge: hub-edit-suggestion |
| `upsert_metrics_daily(jsonb)` | instagram_account_metrics_daily | edge: instagram-sync-cron |
| `youtube_purge_channel(uuid,text,bigint)` | report_documents, youtube_pdf_purges | sql: google_expire_units, google_mark_revoked, google_unlink_youtube |

### Triggers

Rodam no contexto de quem escreve; o filtro de escopo é das policies da tabela-alvo. Os que
geram notificação (via `insert_notification_batch`/`resolve_notification_targets`) são da
Task 14: `trg_notify_post_assigned`, `trg_notify_post_publish_failed`, `run_post_status_automations`
(em `workflow_posts`), `trg_notify_step_activated`, `trg_notify_step_completed`
(`workflow_etapas`), `trg_notify_workflow_completed` (`workflows`), `trg_notify_task_assigned`
(`tarefas`), `trg_notify_idea_submitted` (`ideias`), `trg_notify_post_approval`
(`post_approvals`), `trg_notify_briefing_answered` (`hub_briefing_questions`),
`trg_notify_client_message` (`mensagens`), `trg_notify_mention` (`mencoes`),
`trg_post_comments_discussao_insert` (`post_comments`). Também emitem notificação, fora de
trigger: `agenda_notificar`, `agenda_tick_lembretes`, `create_edit_suggestion_notification`,
`create_linha_notification`, `create_post_approval_notification`,
`create_post_reference_notification`, `tarefa_comentario_enviar`, `storage_autoclean_run`.
Membership e chat (`trg_notify_invite_accepted`, `_member_removed`, `_role_changed`,
`trg_notify_team_message`) não têm cliente.

<details><summary>Lista completa (63)</summary>

| trigger function | reads which tables | on |
|---|---|---|
| `_financeiro_v2_legado_trigger()` | clientes, financeiro_cliente_versoes | trigger em clientes, membros |
| `close_suggestion_on_publish()` | post_edit_suggestions, workflow_posts | trigger em workflow_posts |
| `detach_posts_from_status_definition()` | workflow_posts | trigger em post_status_definitions |
| `enforce_plan_count_limit()` | clientes | trigger em client_hub_tokens, clientes, instagram_accounts, leads, mcp_api_keys, template_property_definitions, workflow_posts, workflow_templates, workflows, workspace_members |
| `enforce_plan_feature()` | clientes | trigger em client_hub_tokens, contratos, equipe_conversas, equipe_mensagens, hub_brand, hub_brand_files, ideias, instagram_comment_automations, leads, mensagens, post_processes, post_status_automations, post_status_definitions, template_property_definitions, transacoes, transacoes_recorrentes |
| `file_update_reference_count()` | files | trigger em ideia_files, post_file_links, post_references, report_document_files |
| `folder_sync_cliente()` | clientes, folders | sql: get_or_create_client_reports_folder; trigger em clientes |
| `folder_sync_post()` | folders | trigger em workflow_posts |
| `folder_sync_workflow()` | folders | trigger em workflows |
| `google_workspace_release_identities()` | gbp_locations, youtube_channels | trigger em workspaces |
| `guard_feature_multiplatform()` | clientes | trigger em clientes, workflow_templates, workflows |
| `ideia_file_cleanup_orphan()` | files, ideia_files, post_file_links, report_document_files | trigger em ideia_files |
| `link_pending_instagram_automations()` | instagram_comment_automations | trigger em workflow_posts |
| `post_a1_process_guard()` | post_processes | trigger em workflow_posts |
| `post_file_link_auto_cover()` | post_file_links | trigger em post_file_links |
| `post_file_link_reassign_cover()` | post_file_links | trigger em post_file_links |
| `post_processes_requires_avulso()` | workflow_posts | trigger em post_processes |
| `post_reference_cleanup_orphan()` | files, ideia_files, post_file_links, post_references, report_document_files | trigger em post_references |
| `post_targets_guard_delete()` | workflow_posts | trigger em post_targets |
| `post_targets_seed()` | post_targets | trigger em workflow_posts |
| `post_targets_sync_platform()` | workflow_posts | trigger em post_targets |
| `propagate_workflow_cliente_to_posts()` | workflow_posts | trigger em workflows |
| `reconcile_posts_on_status_definition_update()` | workflow_posts | trigger em post_status_definitions |
| `record_post_content_version()` | post_content_versions, post_status_events, post_targets | trigger em workflow_posts |
| `record_post_status_event()` | post_status_events | trigger em workflow_posts |
| `record_workflow_created_event()` | clientes, workflows | trigger em workflows |
| `record_workflow_etapa_updated_event()` | workflow_etapas, workflows | trigger em workflow_etapas |
| `record_workflow_updated_event()` | clientes, workflow_etapas | trigger em workflows |
| `reference_file_not_linkable()` | files | trigger em hub_brand, ideia_files, post_file_links, report_document_files |
| `report_document_files_sync()` | files, report_document_files | trigger em report_documents |
| `resolve_ica_workflow_post_target()` | workflow_posts | trigger em instagram_comment_automations |
| `run_post_status_automations()` | clientes | trigger em workflow_posts |
| `snapshot_instagram_automation_contacts()` | clientes | trigger em instagram_comment_automations |
| `subtarefas_evento_fn()` | tarefas | trigger em subtarefas |
| `sync_instagram_automation_contact_names()` | instagram_automation_contact_automations, instagram_automation_contacts | trigger em instagram_comment_automations |
| `sync_instagram_automation_contact()` | instagram_automation_contact_automations, instagram_automation_contacts, instagram_comment_automations | trigger em instagram_automation_sends |
| `sync_workflow_post_cliente()` | workflow_posts, workflows | trigger em workflow_posts |
| `tarefa_tag_links_evento_fn()` | tarefas | trigger em tarefa_tag_links |
| `tarefas_serie_ao_concluir_fn()` | tarefa_series | trigger em tarefas |
| `tarefas_serie_ao_excluir_fn()` | tarefa_series | trigger em tarefas |
| `tombstone_pending_instagram_automations()` | instagram_comment_automations | trigger em workflow_posts |
| `trg_cleanup_mencoes()` | mencoes | trigger em post_comments, tarefa_comentarios, tarefas, workflow_posts |
| `trg_notify_briefing_answered()` | clientes | trigger em hub_briefing_questions |
| `trg_notify_client_message()` | clientes, mensagens | trigger em mensagens |
| `trg_notify_idea_submitted()` | clientes, ideias | trigger em ideias |
| `trg_notify_mention()` | post_comment_threads, post_comments, tarefa_comentarios, tarefas, workflow_posts | trigger em mencoes |
| `trg_notify_post_approval()` | clientes, workflow_posts | trigger em post_approvals |
| `trg_notify_post_assigned()` | clientes | trigger em workflow_posts |
| `trg_notify_post_publish_failed()` | clientes | trigger em workflow_posts |
| `trg_notify_step_activated()` | clientes, workflows | trigger em workflow_etapas |
| `trg_notify_step_completed()` | clientes, workflows | trigger em workflow_etapas |
| `trg_notify_task_assigned()` | clientes, tarefas | trigger em tarefas |
| `trg_notify_team_message()` | mensagens, notifications | sql: trg_post_comments_discussao_insert; trigger em equipe_mensagens |
| `trg_notify_workflow_completed()` | clientes | trigger em workflows |
| `trg_post_comment_threads_geral_guard_delete()` | workflow_posts | trigger em post_comment_threads |
| `trg_post_comments_discussao_insert()` | notifications, post_comment_threads, post_discussao_participantes, workflow_posts | sql: tarefa_comentario_enviar; trigger em post_comments |
| `trg_post_comments_discussao_update()` | post_comment_threads, post_discussao_participantes, workflow_posts | trigger em post_comments |
| `trg_sync_ideia_from_tarefa()` | ideias | trigger em tarefas |
| `trg_workspace_members_owner_clears_scope_fn()` | workspace_member_clientes | trigger em workspace_members |
| `workflow_posts_board_move_seed_targets()` | post_targets, workflow_posts | trigger em workflow_posts |
| `workflow_posts_platform_to_targets()` | post_targets | trigger em workflow_posts |
| `workflow_posts_reset_tiktok_target()` | post_targets | trigger em workflow_posts |
| `workflow_posts_stories_drop_tiktok()` | post_targets | trigger em workflow_posts |

</details>

## Edge functions

### Task 13: servem um usuário do CRM e leem com service role

Todas abaixo validam o JWT do usuário e depois leem com o cliente service role, então a RLS não
as protege. O plano esperava nove; o levantamento acha 24 (mais `instagram-report-generator-v2`, que é interno). As marcadas "novo" são o delta.

| function | o que lê/escreve de cliente | nota |
|---|---|---|
| `instagram-analytics` | `instagram_*`, `analytics_reports`, `clientes` | plano |
| `instagram-integration` | `instagram_accounts`, posts, histórico, `notifications` | plano |
| `tiktok-analytics` | `clientes`, `tiktok_*` | plano |
| `youtube-analytics` | `youtube_*` (sem policy) | plano; o grep de auth não casou o helper, CLAUDE.md confirma JWT |
| `gbp-analytics` | `gbp_*` (sem policy) | plano; idem |
| `report-docs` | `report_documents`, `instagram_*`, `clientes` | plano |
| `instagram-report-generator-v2` | `analytics_reports`, `instagram_*` | plano lista, mas a auth é `x-cron-secret`/`INTERNAL_FUNCTION_SECRET`: chamado por `report-docs`/`report-worker`, o filtro fica no chamador |
| `file-manage` | `files`, `folders`, `post_file_links`, `workflow_posts`; emite o token do `file-zip` | plano; o escopo do zip tem de ser conferido aqui, na emissão |
| `post-references` | `post_references`, `workflow_posts` | plano |
| `google-integration` | `clientes`, `gbp_locations`, `youtube_channels` | novo (vincular/desvincular unidade de cliente) |
| `tiktok-integration` | `clientes`, `tiktok_accounts`, `tiktok_posts` | novo |
| `instagram-connect-link` | `clientes`, `instagram_accounts`, `instagram_connect_links` | novo |
| `instagram-publish`, `tiktok-publish` | `workflow_posts`, contas, `post_targets` | novo (publicar agora) |
| `crm-reorder-post-schedules` | `clientes`, `reorder_post_schedules` | novo |
| `data-import` | `clientes`, `workflows`, `workflow_posts`, `import_commit_row` | novo; também o gate de criação de cliente da Task 3 |
| `file-upload-url`, `file-upload-finalize` | `folders`, `files`, `post_file_links` | novo |
| `post-media-upload-url`, `post-media-finalize`, `post-media-manage` | `workflow_posts`, `post_media`, `post_file_links` | novo |
| `ideia-media-manage` | `ideias`, `ideia_files` | novo |
| `briefing-audio` | `briefings` (via `_shared`) | novo |
| `automation-media` | `instagram_comment_automations` | novo |
| `agenda-feed` | `agenda_feed_eventos` (iCal por token do membro) | novo; o filtro pode ir na RPC (Task 5) |

### Task 12: `mcp`

Lê `clientes`, `workflows`, `workflow_posts`, `workflow_etapas`, `tarefas`, `ideias`,
`briefings`, `hub_brand`, `hub_pages`, `instagram_*`, `post_approvals`, `post_file_links`,
`post_media_notes`, `transacoes`; RPCs `mcp_send_post_to_client`, `mcp_attach_post_file(_v2)`,
`post_media_set_from_uploads`, `financeiro_*_as`. `tarefas.user_id` gravado como o criador da
chave (`queries.ts`).

### Task 14: crons que escolhem destinatário membro

`notification-email-cron` (`claim_notification_emails`), `notification-deadline-cron`
(`notification_deadline_candidates`, `insert_notification_batch`). Também
`agenda-lembretes-email` (`agenda_claim_emails_lembrete`), que manda lembrete a participante
(participante é "é dele" do evento, então provavelmente nada muda; conferir).
**Delta:** o plano lista `client-event-email-cron`, mas ele manda o resumo "pendências do Hub"
para o e-mail **do cliente**, não de membro. Proposta: isento.

### Isentas

- Hub (token do cliente): `hub-agenda`, `hub-approve`, `hub-bootstrap`, `hub-brand`,
  `hub-briefing`, `hub-dashboard`, `hub-edit-suggestion`, `hub-ideias`, `hub-instagram-feed`,
  `hub-linha-editorial`, `hub-media-notes`, `hub-mensagens`, `hub-pages`, `hub-post-history`,
  `hub-post-references`, `hub-posts`, `hub-report-docs`, `hub-reports`.
- Convidado externo / descadastro: `agenda-convite`, `client-email-unsub`, `agenda-cliente-email`
  (e-mail ao cliente).
- Token assinado: `file-zip` (a checagem é na emissão, `file-manage`).
- Webhooks: `instagram-webhook`, `tiktok-webhook`, `stream-webhook`, `pagarme-webhook`.
- Crons sem destinatário membro: `analytics-report-cron`, `report-worker`,
  `instagram-report-generator` (e-mail ao cliente), `instagram-sync-cron`,
  `instagram-refresh-cron`, `instagram-publish-cron`, `instagram-automation-cron`,
  `tiktok-sync-cron`, `tiktok-refresh-cron`, `tiktok-publish-cron`, `youtube-sync-cron`,
  `gbp-sync-cron`, `express-post-cleanup-cron`, `post-media-cleanup-cron`,
  `post-media-backfill-thumbnails`, `notification-cleanup-cron`, `storage-autoclean-cron`.
- Admin da plataforma (não é membro de workspace): `platform-admin`, `mcp-admin`.
- Sem dado de cliente: `manage-workspace-user` (é o caminho da Task 7), `equipe-chat-media`
  (chat sem mudança, spec), `geo-autocomplete`, `invite-user`, `mcp-oauth-consent`.

## Apêndice: policies atuais (texto de `pg_policies`)

Base para as reescritas de 3 e 4a-4e: cada qual ganha só a cláusula de escopo.

**`agenda_convidados`**

- `agenda_convidados_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`agenda_emails_cliente`**

- `agenda_emails_cliente_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`agenda_eventos`**

- `agenda_eventos_select` PERMISSIVE TO authenticated SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('calendario'::text, 'ver'::text) AS has_permission) AND agenda_pode_ver_evento(id, privado, organizador_id))`
- `agenda_eventos_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`agenda_lembretes`**

- `agenda_lembretes_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`agenda_ocorrencias`**

- `agenda_ocorrencias_select` PERMISSIVE TO authenticated SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM agenda_eventos e WHERE (e.id = agenda_ocorrencias.evento_id))))`
- `agenda_ocorrencias_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`agenda_participantes`**

- `agenda_participantes_select` PERMISSIVE TO authenticated SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM agenda_eventos e WHERE (e.id = agenda_participantes.evento_id))))`
- `agenda_participantes_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`agenda_remarcacoes`**

- `agenda_remarcacoes_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`agenda_respostas`**

- `agenda_respostas_select` PERMISSIVE TO authenticated SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM agenda_ocorrencias o WHERE (o.id = agenda_respostas.ocorrencia_id))))`
- `agenda_respostas_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`agenda_respostas_cliente`**

- `agenda_respostas_cliente_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`agenda_respostas_convidado`**

- `agenda_respostas_convidado_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`analytics_reports`**

- `reports_conta_delete` PERMISSIVE TO public DELETE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `reports_conta_insert` PERMISSIVE TO public INSERT WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `reports_conta_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `reports_conta_update` PERMISSIVE TO public UPDATE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`briefings`**

- `briefings_delete` PERMISSIVE TO public DELETE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `briefings_insert` PERMISSIVE TO public INSERT WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `briefings_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `briefings_update` PERMISSIVE TO public UPDATE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`client_hub_tokens`**

- `client_hub_tokens_service_role` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `client_hub_tokens_workspace_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`cliente_datas`**

- `workspace_delete_datas` PERMISSIVE TO public DELETE USING `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))`
- `workspace_insert_datas` PERMISSIVE TO public INSERT WITH CHECK `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = cliente_datas.cliente_id) AND (c.conta_id = cliente_datas.conta_id)))))`
- `workspace_read_datas` PERMISSIVE TO public SELECT USING `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))`
- `workspace_update_datas` PERMISSIVE TO public UPDATE USING `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))` WITH CHECK `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = cliente_datas.cliente_id) AND (c.conta_id = cliente_datas.conta_id)))))`

**`cliente_enderecos`**

- `workspace_delete_enderecos` PERMISSIVE TO public DELETE USING `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))`
- `workspace_insert_enderecos` PERMISSIVE TO public INSERT WITH CHECK `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = cliente_enderecos.cliente_id) AND (c.conta_id = cliente_enderecos.conta_id)))))`
- `workspace_read_enderecos` PERMISSIVE TO public SELECT USING `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))`
- `workspace_update_enderecos` PERMISSIVE TO public UPDATE USING `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))` WITH CHECK `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = cliente_enderecos.cliente_id) AND (c.conta_id = cliente_enderecos.conta_id)))))`

**`cliente_links`**

- `workspace_delete_links` PERMISSIVE TO authenticated DELETE USING `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))`
- `workspace_insert_links` PERMISSIVE TO authenticated INSERT WITH CHECK `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = cliente_links.cliente_id) AND (c.conta_id = cliente_links.conta_id)))))`
- `workspace_select_links` PERMISSIVE TO authenticated SELECT USING `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))`
- `workspace_update_links` PERMISSIVE TO authenticated UPDATE USING `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))` WITH CHECK `((conta_id IN ( SELECT workspace_members.workspace_id FROM workspace_members WHERE (workspace_members.user_id = auth.uid()))) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = cliente_links.cliente_id) AND (c.conta_id = cliente_links.conta_id)))))`

**`clientes`**

- `clientes_delete` PERMISSIVE TO public DELETE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `clientes_insert` PERMISSIVE TO public INSERT WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `clientes_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `clientes_update` PERMISSIVE TO public UPDATE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`contratos`**

- `contratos_delete` PERMISSIVE TO public DELETE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('contratos'::text, 'editar'::text) AS has_permission))`
- `contratos_insert` PERMISSIVE TO public INSERT WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('contratos'::text, 'editar'::text) AS has_permission))`
- `contratos_select` PERMISSIVE TO public SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('contratos'::text, 'ver'::text) AS has_permission))`
- `contratos_update` PERMISSIVE TO public UPDATE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('contratos'::text, 'editar'::text) AS has_permission))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('contratos'::text, 'editar'::text) AS has_permission))`

**`files`**

- `files_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `files_tenant_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`financeiro_atribuicoes`**

- `financeiro_atribuicoes_select` PERMISSIVE TO authenticated SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT effective_plan_feature(financeiro_atribuicoes.conta_id, 'feature_financial'::text) AS effective_plan_feature) AND ( SELECT effective_plan_feature(financeiro_atribuicoes.conta_id, 'feature_financeiro_v2'::text) AS effective_plan_feature) AND ( SELECT can_see_financials() AS can_see_financials))`

**`financeiro_cliente_versoes`**

- `financeiro_cliente_versoes_select` PERMISSIVE TO authenticated SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT effective_plan_feature(financeiro_cliente_versoes.conta_id, 'feature_financial'::text) AS effective_plan_feature) AND ( SELECT effective_plan_feature(financeiro_cliente_versoes.conta_id, 'feature_financeiro_v2'::text) AS effective_plan_feature) AND ( SELECT can_see_financials() AS can_see_financials))`

**`financeiro_entregas_manuais`**

- `financeiro_entregas_manuais_select` PERMISSIVE TO authenticated SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT effective_plan_feature(financeiro_entregas_manuais.conta_id, 'feature_financial'::text) AS effective_plan_feature) AND ( SELECT effective_plan_feature(financeiro_entregas_manuais.conta_id, 'feature_financeiro_v2'::text) AS effective_plan_feature) AND ( SELECT can_see_financials() AS can_see_financials))`

**`folders`**

- `folders_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `folders_tenant_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`hub_brand`**

- `hub_brand_service_role` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `hub_brand_workspace_all` PERMISSIVE TO public ALL USING `(cliente_id IN ( SELECT clientes.id FROM clientes WHERE (clientes.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))` WITH CHECK `(cliente_id IN ( SELECT clientes.id FROM clientes WHERE (clientes.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`

**`hub_brand_files`**

- `hub_brand_files_service_role` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `hub_brand_files_workspace_all` PERMISSIVE TO public ALL USING `(cliente_id IN ( SELECT clientes.id FROM clientes WHERE (clientes.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))` WITH CHECK `(cliente_id IN ( SELECT clientes.id FROM clientes WHERE (clientes.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`

**`hub_briefing_questions`**

- `hub_briefing_questions_delete` PERMISSIVE TO public DELETE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `hub_briefing_questions_insert` PERMISSIVE TO public INSERT WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `hub_briefing_questions_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `hub_briefing_questions_update` PERMISSIVE TO public UPDATE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`hub_pages`**

- `hub_pages_service_role` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `hub_pages_workspace_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`ideia_files`**

- `ideia_files_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `ideia_files_tenant_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`ideia_reactions`**

- `reactions_delete` PERMISSIVE TO public DELETE USING `(ideia_id IN ( SELECT ideias.id FROM ideias WHERE (ideias.workspace_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `reactions_insert` PERMISSIVE TO public INSERT WITH CHECK `(ideia_id IN ( SELECT ideias.id FROM ideias WHERE (ideias.workspace_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `reactions_select` PERMISSIVE TO public SELECT USING `(ideia_id IN ( SELECT ideias.id FROM ideias WHERE (ideias.workspace_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `reactions_update` PERMISSIVE TO public UPDATE USING `(ideia_id IN ( SELECT ideias.id FROM ideias WHERE (ideias.workspace_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`

**`ideias`**

- `ideias_delete` PERMISSIVE TO public DELETE USING `(workspace_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `ideias_insert` PERMISSIVE TO public INSERT WITH CHECK `(workspace_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `ideias_select` PERMISSIVE TO public SELECT USING `(workspace_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `ideias_update` PERMISSIVE TO public UPDATE USING `(workspace_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(workspace_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`instagram_account_metrics_daily`**

- `Service role full access` PERMISSIVE TO public ALL USING `(auth.role() = 'service_role'::text)`

**`instagram_account_metrics_monthly`**

- `Service role full access` PERMISSIVE TO public ALL USING `(auth.role() = 'service_role'::text)`

**`instagram_accounts`**

- `accounts_conta` PERMISSIVE TO public ALL USING `(client_id IN ( SELECT c.id FROM clientes c WHERE (c.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid())))))`

**`instagram_analytics_cache`**

- `cache_via_account` PERMISSIVE TO public ALL USING `(instagram_account_id IN ( SELECT ia.id FROM (instagram_accounts ia JOIN clientes c ON ((c.id = ia.client_id))) WHERE (c.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid())))))`

**`instagram_automation_contact_automations`**

- `iaca_select` PERMISSIVE TO public SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('automacoes'::text, 'ver'::text) AS has_permission))`
- `service_role_bypass_iaca` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`instagram_automation_contacts`**

- `iac_select` PERMISSIVE TO public SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('automacoes'::text, 'ver'::text) AS has_permission))`
- `service_role_bypass_iac` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`instagram_automation_sends`**

- `ias_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `service_role_bypass_ias` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`instagram_comment_analyses`**

- `instagram_comment_analyses_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`instagram_comment_automations`**

- `ica_delete` PERMISSIVE TO public DELETE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('automacoes'::text, 'editar'::text) AS has_permission))`
- `ica_insert` PERMISSIVE TO public INSERT WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('automacoes'::text, 'editar'::text) AS has_permission))`
- `ica_select` PERMISSIVE TO public SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('automacoes'::text, 'ver'::text) AS has_permission))`
- `ica_update` PERMISSIVE TO public UPDATE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('automacoes'::text, 'editar'::text) AS has_permission))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT has_permission('automacoes'::text, 'editar'::text) AS has_permission))`
- `service_role_bypass_ica` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`instagram_connect_links`**

- `instagram_connect_links_service_role` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `instagram_connect_links_workspace_all` PERMISSIVE TO public ALL USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = instagram_connect_links.cliente_id) AND (c.conta_id = instagram_connect_links.conta_id)))))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = instagram_connect_links.cliente_id) AND (c.conta_id = instagram_connect_links.conta_id)))))`

**`instagram_follower_history`**

- `follower_history_via_account` PERMISSIVE TO public ALL USING `(instagram_account_id IN ( SELECT ia.id FROM (instagram_accounts ia JOIN clientes c ON ((c.id = ia.client_id))) WHERE (c.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid())))))`

**`instagram_post_tag_assignments`**

- `tag_assignments_via_tags` PERMISSIVE TO public ALL USING `((tag_id IN ( SELECT instagram_post_tags.id FROM instagram_post_tags WHERE (instagram_post_tags.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid()))))) AND (post_id IN ( SELECT ip.id FROM ((instagram_posts ip JOIN instagram_accounts ia ON ((ip.instagram_account_id = ia.id))) JOIN clientes c ON ((ia.client_id = c.id))) WHERE (c.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid()))))))` WITH CHECK `((tag_id IN ( SELECT instagram_post_tags.id FROM instagram_post_tags WHERE (instagram_post_tags.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid()))))) AND (post_id IN ( SELECT ip.id FROM ((instagram_posts ip JOIN instagram_accounts ia ON ((ip.instagram_account_id = ia.id))) JOIN clientes c ON ((ia.client_id = c.id))) WHERE (c.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid()))))))`

**`instagram_posts`**

- `posts_via_account` PERMISSIVE TO public ALL USING `(instagram_account_id IN ( SELECT ia.id FROM (instagram_accounts ia JOIN clientes c ON ((c.id = ia.client_id))) WHERE (c.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid())))))`

**`instagram_story_insights`**

- `Service role full access` PERMISSIVE TO public ALL USING `(auth.role() = 'service_role'::text)`

**`linha_editorial_itens`**

- `linha_editorial_itens_delete` PERMISSIVE TO authenticated DELETE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))`
- `linha_editorial_itens_insert` PERMISSIVE TO authenticated INSERT WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))`
- `linha_editorial_itens_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `linha_editorial_itens_update` PERMISSIVE TO authenticated UPDATE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))`

**`linha_editorial_respostas`**

- `linha_editorial_respostas_delete` PERMISSIVE TO authenticated DELETE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))`
- `linha_editorial_respostas_insert` PERMISSIVE TO authenticated INSERT WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text) AND is_workspace_user AND (author_user_id = ( SELECT auth.uid() AS uid)) AND (acao = 'comentario'::text))`
- `linha_editorial_respostas_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `linha_editorial_respostas_update` PERMISSIVE TO authenticated UPDATE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))`

**`linhas_editoriais`**

- `linhas_editoriais_delete` PERMISSIVE TO authenticated DELETE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))`
- `linhas_editoriais_insert` PERMISSIVE TO authenticated INSERT WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))`
- `linhas_editoriais_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `linhas_editoriais_update` PERMISSIVE TO authenticated UPDATE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND effective_plan_feature(conta_id, 'feature_linha_editorial'::text))`

**`mencoes`**

- `mencoes_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `mencoes_tenant_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (author_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM membros m WHERE ((m.id = mencoes.mentioned_membro_id) AND (m.conta_id = mencoes.conta_id)))) AND CASE host_type WHEN 'tarefa'::text THEN (EXISTS ( SELECT 1 FROM tarefas t WHERE ((t.id = mencoes.host_id) AND (t.conta_id = mencoes.conta_id)))) WHEN 'workflow_post'::text THEN (EXISTS ( SELECT 1 FROM workflow_posts wp WHERE ((wp.id = mencoes.host_id) AND (wp.conta_id = mencoes.conta_id)))) WHEN 'post_comment'::text THEN (EXISTS ( SELECT 1 FROM ((post_comments pc JOIN post_comment_threads pct ON ((pct.id = pc.thread_id))) JOIN workflow_posts wp ON (((wp.id = pct.post_id) AND (wp.conta_id = pct.conta_id)))) WHERE ((pc.id = mencoes.host_id) AND (pct.conta_id = mencoes.conta_id)))) WHEN 'tarefa_comentario'::text THEN (EXISTS ( SELECT 1 FROM tarefa_comentarios tc WHERE ((tc.id = mencoes.host_id) AND (tc.conta_id = mencoes.conta_id) AND (tc.author_id = auth.uid())))) ELSE false END)`

**`mensagens`**

- `mensagens_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `mensagens_tenant_insert` PERMISSIVE TO public INSERT WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (is_workspace_user = true) AND (author_user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = mensagens.cliente_id) AND (c.conta_id = mensagens.conta_id)))))`
- `mensagens_tenant_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`mensagens_last_seen`**

- `mensagens_last_seen_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`notifications`**

- `notifications_select` PERMISSIVE TO public SELECT USING `((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM workspace_members wm WHERE ((wm.workspace_id = notifications.workspace_id) AND (wm.user_id = auth.uid())))))`
- `notifications_update` PERMISSIVE TO public UPDATE USING `((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM workspace_members wm WHERE ((wm.workspace_id = notifications.workspace_id) AND (wm.user_id = auth.uid())))))` WITH CHECK `((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM workspace_members wm WHERE ((wm.workspace_id = notifications.workspace_id) AND (wm.user_id = auth.uid())))))`

**`portal_approvals`**

- `portal_approvals_delete` PERMISSIVE TO public DELETE USING `(workflow_etapa_id IN ( SELECT we.id FROM (workflow_etapas we JOIN workflows w ON ((w.id = we.workflow_id))) WHERE (w.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `portal_approvals_insert` PERMISSIVE TO public INSERT WITH CHECK `(workflow_etapa_id IN ( SELECT we.id FROM (workflow_etapas we JOIN workflows w ON ((w.id = we.workflow_id))) WHERE (w.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `portal_approvals_select` PERMISSIVE TO public SELECT USING `(workflow_etapa_id IN ( SELECT we.id FROM (workflow_etapas we JOIN workflows w ON ((w.id = we.workflow_id))) WHERE (w.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `portal_approvals_update` PERMISSIVE TO public UPDATE USING `(workflow_etapa_id IN ( SELECT we.id FROM (workflow_etapas we JOIN workflows w ON ((w.id = we.workflow_id))) WHERE (w.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))` WITH CHECK `(workflow_etapa_id IN ( SELECT we.id FROM (workflow_etapas we JOIN workflows w ON ((w.id = we.workflow_id))) WHERE (w.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`

**`portal_tokens`**

- `portal_tokens_service_role` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `portal_tokens_workspace_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`post_approval_media_notes`**

- `post_approval_media_notes_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `post_approval_media_notes_tenant_select` PERMISSIVE TO authenticated SELECT USING `(EXISTS ( SELECT 1 FROM post_media_notes n WHERE ((n.id = post_approval_media_notes.note_id) AND (n.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))))`

**`post_approvals`**

- `post_approvals_authenticated_insert_author` RESTRICTIVE TO authenticated INSERT WITH CHECK `((is_workspace_user = true) AND ((author_user_id IS NULL) OR (author_user_id = auth.uid())))`
- `post_approvals_authenticated_no_delete` RESTRICTIVE TO authenticated DELETE USING `false`
- `post_approvals_authenticated_no_update` RESTRICTIVE TO authenticated UPDATE USING `false`
- `service_role_bypass_post_approvals` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `workspace_post_approvals_all` PERMISSIVE TO public ALL USING `(post_id IN ( SELECT wp.id FROM workflow_posts wp WHERE (wp.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`

**`post_comment_threads`**

- `post_comment_threads_delete` PERMISSIVE TO public DELETE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `post_comment_threads_insert` PERMISSIVE TO public INSERT WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `post_comment_threads_no_geral_insert` RESTRICTIVE TO authenticated INSERT WITH CHECK `(field <> 'geral'::text)`
- `post_comment_threads_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `post_comment_threads_update` PERMISSIVE TO public UPDATE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`post_comments`**

- `post_comments_author_is_self` RESTRICTIVE TO authenticated INSERT WITH CHECK `(author_id = auth.uid())`
- `post_comments_delete` PERMISSIVE TO public DELETE USING `(thread_id IN ( SELECT post_comment_threads.id FROM post_comment_threads WHERE (post_comment_threads.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `post_comments_geral_author_delete` RESTRICTIVE TO authenticated DELETE USING `((author_id = auth.uid()) OR (NOT (thread_id IN ( SELECT post_comment_threads.id FROM post_comment_threads WHERE (post_comment_threads.field = 'geral'::text)))))`
- `post_comments_geral_author_update` RESTRICTIVE TO authenticated UPDATE USING `((author_id = auth.uid()) OR (NOT (thread_id IN ( SELECT post_comment_threads.id FROM post_comment_threads WHERE (post_comment_threads.field = 'geral'::text)))))`
- `post_comments_insert` PERMISSIVE TO public INSERT WITH CHECK `(thread_id IN ( SELECT post_comment_threads.id FROM post_comment_threads WHERE (post_comment_threads.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `post_comments_select` PERMISSIVE TO public SELECT USING `(thread_id IN ( SELECT post_comment_threads.id FROM post_comment_threads WHERE (post_comment_threads.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `post_comments_update` PERMISSIVE TO public UPDATE USING `(thread_id IN ( SELECT post_comment_threads.id FROM post_comment_threads WHERE (post_comment_threads.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))` WITH CHECK `(thread_id IN ( SELECT post_comment_threads.id FROM post_comment_threads WHERE (post_comment_threads.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`

**`post_content_versions`**

- `post_content_versions_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `service_role_bypass_post_content_versions` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`post_discussao_participantes`**

- `post_discussao_participantes_own_select` PERMISSIVE TO authenticated SELECT USING `((user_id = auth.uid()) AND (conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))`

**`post_edit_suggestions`**

- `service_role_edit_suggestions_all` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `workspace_edit_suggestions_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`post_file_links`**

- `post_file_links_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `post_file_links_tenant_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`post_media`**

- `post_media_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `post_media_tenant_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`post_media_note_replies`**

- `post_media_note_replies_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `post_media_note_replies_team_insert` PERMISSIVE TO authenticated INSERT WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (author_kind = 'team'::text) AND (author_user_id = auth.uid()))`
- `post_media_note_replies_tenant_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`post_media_notes`**

- `post_media_notes_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `post_media_notes_team_insert` PERMISSIVE TO authenticated INSERT WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (author_kind = 'team'::text) AND (visibility = 'internal'::text) AND (author_user_id = auth.uid()))`
- `post_media_notes_tenant_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `post_media_notes_tenant_update` PERMISSIVE TO authenticated UPDATE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`post_process_events`**

- `ppe_no_client_delete` PERMISSIVE TO public DELETE USING `false`
- `ppe_no_client_insert` PERMISSIVE TO public INSERT WITH CHECK `false`
- `ppe_no_client_update` PERMISSIVE TO public UPDATE USING `false`
- `ppe_select_member` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `service_role_bypass_post_process_events` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`post_process_steps`**

- `pps_no_client_delete` PERMISSIVE TO public DELETE USING `false`
- `pps_no_client_insert` PERMISSIVE TO public INSERT WITH CHECK `false`
- `pps_no_client_update` PERMISSIVE TO public UPDATE USING `false`
- `pps_select_member` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `service_role_bypass_post_process_steps` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`post_processes`**

- `pp_no_client_delete` PERMISSIVE TO public DELETE USING `false`
- `pp_no_client_insert` PERMISSIVE TO public INSERT WITH CHECK `false`
- `pp_no_client_update` PERMISSIVE TO public UPDATE USING `false`
- `pp_select_member` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `service_role_bypass_post_processes` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`post_property_values`**

- `service_role_bypass_ppv` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `workspace_ppv_all` PERMISSIVE TO public ALL USING `(post_id IN ( SELECT wp.id FROM workflow_posts wp WHERE (wp.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))` WITH CHECK `(post_id IN ( SELECT wp.id FROM workflow_posts wp WHERE (wp.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`

**`post_references`**

- `post_references_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `post_references_tenant_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`post_status_events`**

- `post_status_events_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `service_role_bypass_post_status_events` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`post_targets`**

- `post_targets_service_role` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `post_targets_workspace_all` PERMISSIVE TO authenticated ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`report_document_files`**

- `report_document_files_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `report_document_files_tenant_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`report_documents`**

- `report_documents_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `report_documents_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `report_documents_update` PERMISSIVE TO public UPDATE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`subtarefas`**

- `subtarefas_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `subtarefas_tenant_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`tarefa_comentarios`**

- `tarefa_comentarios_delete_own` PERMISSIVE TO authenticated DELETE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (author_id = auth.uid()))`
- `tarefa_comentarios_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `tarefa_comentarios_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `tarefa_comentarios_update_own` PERMISSIVE TO authenticated UPDATE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (author_id = auth.uid()))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND (author_id = auth.uid()))`

**`tarefa_eventos`**

- `tarefa_eventos_select` PERMISSIVE TO authenticated SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `tarefa_eventos_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`

**`tarefa_series`**

- `tarefa_series_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `tarefa_series_tenant_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`tarefa_tag_links`**

- `tarefa_tag_links_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `tarefa_tag_links_tenant_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`tarefas`**

- `tarefas_service_role_bypass` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `tarefas_tenant_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ((responsavel_id IS NULL) OR (EXISTS ( SELECT 1 FROM membros m WHERE ((m.id = tarefas.responsavel_id) AND (m.conta_id = tarefas.conta_id))))) AND ((cliente_id IS NULL) OR (EXISTS ( SELECT 1 FROM clientes c WHERE ((c.id = tarefas.cliente_id) AND (c.conta_id = tarefas.conta_id))))) AND ((serie_id IS NULL) OR (EXISTS ( SELECT 1 FROM tarefa_series s WHERE ((s.id = tarefas.serie_id) AND (s.conta_id = tarefas.conta_id))))))`

**`tiktok_account_metrics_daily`**

- `Service role full access` PERMISSIVE TO public ALL USING `(auth.role() = 'service_role'::text)`

**`tiktok_accounts`**

- `tiktok_accounts_conta` PERMISSIVE TO public ALL USING `(client_id IN ( SELECT c.id FROM clientes c WHERE (c.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid())))))`

**`tiktok_follower_history`**

- `tiktok_follower_history_via_account` PERMISSIVE TO public ALL USING `(tiktok_account_id IN ( SELECT ta.id FROM (tiktok_accounts ta JOIN clientes c ON ((c.id = ta.client_id))) WHERE (c.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid())))))`

**`tiktok_posts`**

- `tiktok_posts_via_account` PERMISSIVE TO public ALL USING `(tiktok_account_id IN ( SELECT ta.id FROM (tiktok_accounts ta JOIN clientes c ON ((c.id = ta.client_id))) WHERE (c.conta_id IN ( SELECT profiles.conta_id FROM profiles WHERE (profiles.id = auth.uid())))))`

**`transacoes`**

- `transacoes_delete` PERMISSIVE TO public DELETE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT can_see_financials() AS can_see_financials) AND ( SELECT has_permission('financeiro'::text, 'editar'::text) AS has_permission))`
- `transacoes_insert` PERMISSIVE TO public INSERT WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT can_see_financials() AS can_see_financials) AND ( SELECT has_permission('financeiro'::text, 'editar'::text) AS has_permission))`
- `transacoes_select` PERMISSIVE TO public SELECT USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT can_see_financials() AS can_see_financials))`
- `transacoes_update` PERMISSIVE TO public UPDATE USING `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT can_see_financials() AS can_see_financials) AND ( SELECT has_permission('financeiro'::text, 'editar'::text) AS has_permission))` WITH CHECK `((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)) AND ( SELECT can_see_financials() AS can_see_financials) AND ( SELECT has_permission('financeiro'::text, 'editar'::text) AS has_permission))`

**`workflow_etapas`**

- `workflow_etapas_delete` PERMISSIVE TO public DELETE USING `(workflow_id IN ( SELECT workflows.id FROM workflows WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `workflow_etapas_insert` PERMISSIVE TO public INSERT WITH CHECK `(workflow_id IN ( SELECT workflows.id FROM workflows WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `workflow_etapas_select` PERMISSIVE TO public SELECT USING `(workflow_id IN ( SELECT workflows.id FROM workflows WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`
- `workflow_etapas_update` PERMISSIVE TO public UPDATE USING `(workflow_id IN ( SELECT workflows.id FROM workflows WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))` WITH CHECK `(workflow_id IN ( SELECT workflows.id FROM workflows WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))))`

**`workflow_events`**

- `service_role_bypass_workflow_events` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `workflow_events_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`workflow_posts`**

- `service_role_bypass_posts` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `workspace_posts_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`workflow_select_options`**

- `service_role_bypass_wso` PERMISSIVE TO service_role ALL USING `true` WITH CHECK `true`
- `workspace_wso_all` PERMISSIVE TO public ALL USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`workflows`**

- `workflows_delete` PERMISSIVE TO public DELETE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `workflows_insert` PERMISSIVE TO public INSERT WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `workflows_select` PERMISSIVE TO public SELECT USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`
- `workflows_update` PERMISSIVE TO public UPDATE USING `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))` WITH CHECK `(conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id))`

**`workspace_member_clientes`**

- `wmc_select_own_or_owner` PERMISSIVE TO authenticated SELECT USING `((user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM workspace_members wm WHERE ((wm.workspace_id = workspace_member_clientes.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.role = 'owner'::text)))))`
