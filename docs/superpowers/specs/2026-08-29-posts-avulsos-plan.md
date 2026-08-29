# Posts avulsos — Plano de execução

Spec: `docs/superpowers/specs/2026-08-28-posts-avulsos-design.md`.
Plano-fonte aprovado: `~/.claude/plans/muitos-usu-rios-ainda-tem-cuddly-sedgewick.md`.

## Global Constraints

- **Worktree literal**: todo trabalho acontece em
  `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/independent-posts-outside-flows-7bf38b`
  (branch `claude/independent-posts-outside-flows-7bf38b`). Antes de escrever qualquer
  arquivo, confirme `pwd` e `git branch --show-current`. Nunca use caminhos do repo
  principal (`/Users/eduardosouza/Projects/sm-crm/...` sem o sufixo do worktree).
- **Sem em-dash (—) em qualquer copy de produto** (strings PT-BR visíveis ao usuário).
  Use "·", ":" ou reestruture a frase.
- **Migrations**: prefixo de versão `202608300000NN` (o main já tomou `20260829000001`;
  re-verificar o tail do main a cada nova migration e no PR). Reescritas de função SQL são copy-forward: a migration nova
  contém a definição COMPLETA da função, e reemite os REVOKE/GRANT da canônica anterior
  (inclusive `GRANT ... TO service_role`).
- **Edge functions**: Deno, `buildCorsHeaders(req)` (nunca `*`), erros genéricos ao cliente
  com log interno, checagem de posse por `conta_id`.
- **Compatibilidade pré-deploy**: cada função reescrita deve se comportar de forma idêntica
  para posts COM fluxo (cliente_id ≡ cliente do fluxo, garantido por backfill + trigger).
  Nada pode depender de já existirem avulsos.
- **Testes acompanham o contrato**: mudanças de contrato atualizam os testes existentes na
  MESMA task (procurar a forma antiga em `apps/**/__tests__` e
  `supabase/functions/__tests__`).
- Commits com mensagem convencional em PT (padrão do repo) e footer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Testes Deno: rodar `npm run test:functions` (dirtia `deno.lock`; ao final
  `git checkout -- deno.lock` se só houver ruído). Vitest: `npm run test`.

## Task 1: Migration A1 — cliente_id, triggers e limites

Criar `supabase/migrations/20260830000001_workflow_posts_cliente_id.sql`:

1. `ALTER TABLE workflow_posts ADD COLUMN cliente_id bigint;`
2. Backfill: `UPDATE workflow_posts wp SET cliente_id = w.cliente_id FROM workflows w
   WHERE w.id = wp.workflow_id;`
3. FK composta tenant-safe (precedente em 20260815000002, `clientes_id_conta_uq`):
   `ADD CONSTRAINT workflow_posts_cliente_same_tenant FOREIGN KEY (cliente_id, conta_id)
   REFERENCES clientes (id, conta_id) ON DELETE CASCADE;`
4. `ALTER COLUMN cliente_id SET NOT NULL;` e `ALTER COLUMN workflow_id DROP NOT NULL;`
5. `CREATE INDEX idx_workflow_posts_cliente ON workflow_posts (cliente_id);`
6. Trigger BEFORE `post_a0_sync_cliente` (INSERT OR UPDATE OF workflow_id, cliente_id),
   SECURITY DEFINER, `SET search_path = public`:
   - Se `NEW.workflow_id IS NOT NULL`: buscar `cliente_id, conta_id` do workflow; raise se
     não existe; raise se `conta_id` difere de `NEW.conta_id`; `NEW.cliente_id := v_cli`.
   - Senão, se `NEW.cliente_id IS NULL`: raise `independent post requires cliente_id`.
   - **Guarda contra PATCH direto**: quando `TG_OP = 'UPDATE'` e
     (`NEW.workflow_id IS DISTINCT FROM OLD.workflow_id` OR
     `NEW.cliente_id IS DISTINCT FROM OLD.cliente_id`), raise
     `post_move_requires_rpc` a menos que
     `current_setting('app.allow_post_move', true) = 'on'`.
     Racional: a policy RLS é FOR ALL por conta_id; sem a guarda, um PATCH via PostgREST
     anexaria o post a fluxo de outro cliente do mesmo workspace.
   - **O nome do trigger importa**: BEFORE triggers disparam em ordem alfabética;
     `post_a0_sync_cliente` ('p') precisa ordenar antes de `trg_limit_posts` ('t') e dos
     `workflow_posts_z1/z2` ('w'). NOT NULL é checado após BEFORE triggers, então writers
     atuais que inserem só com workflow_id continuam funcionando.
7. Trigger `workflows_sync_posts_cliente` AFTER UPDATE OF cliente_id ON workflows
   (`WHEN (OLD.cliente_id IS DISTINCT FROM NEW.cliente_id)`): seta
   `set_config('app.allow_post_move','on', true)` e
   `UPDATE workflow_posts SET cliente_id = NEW.cliente_id WHERE workflow_id = NEW.id;`
   (mover fluxo de cliente é caminho real, documentado em 20260820000003).
8. Limites de plano (o limitador genérico é `enforce_plan_count_limit` de 20260611130002;
   TG_ARGV[4] é um predicado extra opcional):
   - `DROP TRIGGER IF EXISTS trg_limit_posts ON workflow_posts;` e recriar BEFORE INSERT
     `WHEN (NEW.workflow_id IS NOT NULL)` com args
     `('max_posts_per_workflow','direct','conta_id','workflow_id')`.
   - Criar `trg_limit_posts_avulsos` BEFORE INSERT `WHEN (NEW.workflow_id IS NULL)` com
     args `('max_posts_per_workflow','direct','conta_id','cliente_id','workflow_id is null')`
     (sem o predicado, o bucket contaria também os posts em fluxos).

Verificação da task: `npx supabase db lint` se disponível localmente é opcional; o
essencial é revisar o SQL contra as canônicas citadas (ler 20260402_workflow_posts.sql,
20260611130002/3, 20260815000002). Não aplicar a migration em lugar nenhum.

## Task 2: Migration A2 — claim, reorder e família ICA

Criar `supabase/migrations/20260830000002_avulso_claim_reorder_ica.sql` (copy-forward,
definição completa + REVOKE/GRANT de cada função):

1. `claim_posts_for_publishing` (canônica em `20260807000002_claim_skip_nonretryable.sql`):
   manter CTEs `claimed`/`updated` intactas; no SELECT final, remover
   `JOIN workflows w` e `JOIN clientes c` e usar
   `JOIN instagram_accounts ia ON ia.client_id = u.cliente_id`, devolvendo
   `u.cliente_id AS client_id`. RETURNS TABLE mantém `workflow_id` (agora pode ser NULL).
   Racional: a CTE carimba `publish_processing_at` e o join descartaria avulsos
   (post preso em agendado para sempre).
2. `claim_posts_for_tiktok_publishing` (canônica em `20260720000005_tiktok_publishing.sql`):
   mesma reforma via `JOIN tiktok_accounts ta ON ta.client_id = u.cliente_id AND
   ta.authorization_status = 'active'` (conferir o predicado exato na canônica).
3. `reorder_post_schedules` (canônica em `20260813000003`): nos DOIS blocos de posse
   (lock e count), trocar o join por
   `WHERE wp.id = ANY(v_ids) AND wp.cliente_id = p_cliente_id AND wp.conta_id = p_conta_id`.
   `hub_reorder_post_schedules` (wrapper) não muda.
4. Família ICA (canônica em `20260820000003_ica_workflow_post_triggers.sql`):
   - `resolve_ica_workflow_post_target`: ler
     `wp.tipo, wp.platform, wp.cliente_id, wp.instagram_media_id, wp.instagram_permalink`
     direto de workflow_posts (sem join), preservando o comentário deliberado de no-lock.
   - `link_pending_instagram_automations`: trocar o `EXISTS (SELECT 1 FROM workflows ...)`
     por `AND NEW.cliente_id = a.client_id`.
   - `sweep_pending_instagram_automation_links`: remover `JOIN workflows w`, usar
     `AND wp.cliente_id = a.client_id`.
   - `tombstone_pending_instagram_automations`: copy-forward sem mudança lógica.

No-ops verificados (NÃO tocar): `record_post_status_change`, `mark_platform_published`,
`record_client_approval`, triggers z1/z2 de custom status, policies RLS.

## Task 3: Migration A3 — notificações, pastas, health e mensagens

Criar `supabase/migrations/20260830000003_avulso_notifications_folders_views.sql`
(copy-forward). Contrato de deep link: avulso = `/entregas?post=<id>`; com fluxo =
`/entregas?drawer=<wf>` (mantendo `&post=<id>` onde a canônica já o inclui). Expressão
padrão:
`CASE WHEN v_workflow_id IS NULL THEN '/entregas?post=' || <post_id> ELSE '/entregas?drawer=' || v_workflow_id END`.

1. `create_post_approval_notification` + `trg_notify_post_approval` (canônica
   `20260505100001`): hoje fazem `JOIN workflows` para conta_id e retornam em silêncio no
   miss; passar a ler `wp.conta_id`, `wp.cliente_id`, `wp.workflow_id` direto; nome do
   cliente via `clientes WHERE id = wp.cliente_id`; link null-safe.
2. `create_edit_suggestion_notification` (canônica `20260521000001`): mesma reforma.
3. `trg_notify_post_assigned` (canônica `20260504000001`): usar `NEW.conta_id` direto e
   cliente via `NEW.cliente_id`; link null-safe.
4. `trg_notify_post_publish_failed` (canônica `20260807000003`): nome do cliente via
   `NEW.cliente_id` (hoje join em workflows nas linhas ~70-74); link null-safe (hoje
   `'/entregas?drawer=' || NEW.workflow_id || '&post=' || NEW.id` viraria NULL).
5. `trg_notify_mention` (canônica `20260803000006`): o branch `workflow_post` faz
   `IF v_workflow_id IS NULL THEN RETURN NEW` (menção em avulso não notificaria) e o
   branch `post_comment` também monta link por workflow. Ambos passam a usar o CASE
   null-safe e NÃO retornam mais cedo por workflow nulo.
5b. `run_post_status_automations` (canônica `20260805000002_post_status_automations.sql`):
   no action `notify`, o nome do cliente passa a vir de
   `clientes WHERE id = new.cliente_id` (hoje `FROM workflows w LEFT JOIN clientes ...
   WHERE w.id = new.workflow_id`, que fica NULL para avulso) e o link
   `'/entregas?drawer=' || new.workflow_id` ganha o CASE null-safe padrão
   (`'/entregas?post=' || new.id` quando avulso). Copy-forward completo.
6. `folder_sync_post` (canônica `20260425000002`): INSERT → pai = pasta do fluxo
   (`source_type='workflow'`) quando `NEW.workflow_id IS NOT NULL`, senão pasta do cliente
   (**`source_type='client'`**, valor exato do CHECK em 20260425000001:12). Branch UPDATE:
   quando `NEW.workflow_id IS DISTINCT FROM OLD.workflow_id`, recomputar o pai e
   `UPDATE folders SET parent_id = ..., updated_at = now() WHERE source_type='post' AND
   source_id = NEW.id AND conta_id = NEW.conta_id` (detach/attach movem a pasta).
7. `get_client_health_aggregates` (canônica `20260625130000`, SECURITY INVOKER): o CTE
   de pipeline vira `FROM workflow_posts wp LEFT JOIN workflows w ON w.id = wp.workflow_id
   WHERE wp.cliente_id IN (...) AND (wp.workflow_id IS NULL OR w.status = 'ativo')
   GROUP BY wp.cliente_id` (avulsos contam para a saúde).
8. Mensagens: `get_mensagens_feed` + `get_mensagens_unread` (canônica `20260731000003`) e
   `get_mensagens_conversas` (canônica `20260731000007`, NÃO a 000005): nos branches de
   `post_approvals`/`post_edit_suggestions`, trocar o `JOIN workflows` por
   `wp.cliente_id`/`wp.conta_id`.

## Task 4: Migration A4 — RPCs detach/attach

Criar `supabase/migrations/20260830000004_post_detach_attach_rpcs.sql`. Modelo:
`migrate_workflow_template` em `20260826000002` (SECURITY DEFINER,
`v_conta := public.get_my_conta_id()`, `SET search_path = public, pg_temp`,
`REVOKE ... FROM public, anon; GRANT EXECUTE ... TO authenticated, service_role`).

**`detach_posts_from_flow(p_post_ids bigint[], p_archive_empty_flow boolean DEFAULT false)
RETURNS jsonb`**
- Dedupe; raise em array vazio.
- Lock das linhas próprias em ordem estável (`ORDER BY wp.id FOR UPDATE`); contar próprias
  vs pedidas → raise `post_not_found` em mismatch (all-or-nothing).
- Coletar `DISTINCT workflow_id` dos que têm fluxo;
  `PERFORM set_config('app.allow_post_move','on', true);`
  `UPDATE workflow_posts SET workflow_id = NULL WHERE id = ANY(...) AND conta_id = v_conta
  AND workflow_id IS NOT NULL;`
- **Sem validação de limite no detach** (política block-new: nada novo é criado; criação
  continua sendo o ponto de enforcement). Comportamento pinado por teste na Task 5.
- **Os RPCs não tocam `post_property_values`**: valores de propriedades são preservados
  como dados inativos (só renderizam quando o post estiver num fluxo cujo template tenha
  as definitions). Nada é apagado no detach nem no attach.
- Se `p_archive_empty_flow`: para cada workflow de origem agora sem posts
  (`NOT EXISTS`), `UPDATE workflows SET status = 'arquivado'`.
- Retornar `jsonb {ok, detached, archived_workflow_ids}`.

**`attach_posts_to_flow(p_post_ids bigint[], p_workflow_id bigint) RETURNS jsonb`**
- Lock do fluxo alvo `WHERE id = p_workflow_id AND conta_id = v_conta FOR UPDATE`;
  raise `workflow_not_found`; se `status <> 'ativo'` raise `workflow_not_active`.
- Lock + posse dos posts; todos devem ser avulsos (`workflow_id IS NULL`) senão raise
  `post_already_in_flow`; qualquer `cliente_id <> workflow.cliente_id` → raise
  `post_belongs_to_another_client`.
- Guarda de limite sob o MESMO advisory lock do limitador genérico:
  `PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));`
  depois `v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');` se não nulo
  e `count atual no fluxo + array_length > v_limit` → raise
  `plan_limit_exceeded:max_posts_per_workflow` (errcode P0001, igual ao genérico).
- `PERFORM set_config('app.allow_post_move','on', true);` e um único
  `UPDATE ... SET workflow_id = p_workflow_id, ordem = <max(ordem)+row_number>`.
- Retornar `jsonb {ok, attached}`.

## Task 5: Suíte psql de entitlements para avulsos

Criar `supabase/tests/entitlements/70_workflow_posts_avulsos.sql` no padrão dos arquivos
vizinhos (ler `05_more_count_limits.sql` para o harness/helpers) e estender o §3 de
`05_more_count_limits.sql` apenas se necessário para conviver com os novos triggers.
Cobrir:
1. Backfill/derivação: insert só com workflow_id → cliente_id preenchido; avulso sem
   cliente_id → raise; FK cross-tenant → raise.
2. PATCH direto (role authenticated via `SET LOCAL ROLE` como os vizinhos fazem) de
   `workflow_id` ou `cliente_id` → raise `post_move_requires_rpc`. E o caso de spoof
   silencioso: `UPDATE ... SET cliente_id = <outro cliente> WHERE workflow_id IS NOT
   NULL` completa sem erro e deixa `cliente_id` inalterado (o trigger re-deriva do fluxo
   antes da guarda avaliar) — pinar esse comportamento.
3. Bucket de limite avulso por cliente: com limite 5, 5 avulsos passam e o 6º falha;
   posts em fluxo NÃO contam no bucket; segundo cliente independente; posts com fluxo
   continuam limitados por fluxo.
4. Detach acima do limite é PERMITIDO (pinar comportamento).
5. `detach_posts_from_flow`: posse (mismatch → raise), preservação de status,
   custom_status_id e `post_property_values` (linhas intactas), `p_archive_empty_flow`
   arquiva só fluxos esvaziados, pasta do post (`folders.parent_id`) move para a pasta
   do cliente.
6. `attach_posts_to_flow`: mesmo cliente obrigatório; só avulso; fluxo inativo → raise
   `workflow_not_active`; ordem sequencial após o max; limite respeitado; pasta volta
   para a pasta do fluxo.
7. Regressão: `claim_posts_for_publishing` retorna um avulso `agendado` (setup mínimo com
   instagram_account do cliente) e não o deixa preso.
8. `reorder_post_schedules` aceita ids de avulsos do cliente.
9. Notificações: update que dispara `trg_notify_post_publish_failed` em avulso gera
   notification com link `/entregas?post=<id>` e client_name preenchido; menção
   (`mencoes`) em post avulso gera notificação com link `?post=`.
10. ACL: `has_function_privilege` para `anon` e `authenticated` em
    `claim_posts_for_publishing` e `claim_posts_for_tiktok_publishing` deve ser false
    (pina o fix do REVOKE forte; regressão do buraco pré-existente de default
    privileges em ambiente hospedado).

Rodar localmente se o Docker/colima estiver disponível (`colima status`; a suíte roda via
`bash scripts/test-entitlements.sh` com Supabase local; worktrees disputam portas, então se
`supabase start` falhar por porta, reportar como concern e confiar no CI, que roda a suíte).
Se rodar, colar o output no report.

## Task 6: Edge functions do Hub

Arquivos: `supabase/functions/hub-posts/handler.ts`, `hub-approve/handler.ts`,
`hub-edit-suggestion/handler.ts` + testes em `supabase/functions/__tests__/`
(`hub-functions_test.ts` referencia esses handlers; a ordem das queries mockadas muda).

1. `hub-posts`: remover o prefetch de workflows e o early-exit
   `workflowIds.length === 0`; a query de posts vira uma só:
   `.from("workflow_posts").select("<mesmas colunas>, workflow_id, workflows(titulo, created_at)")
   .eq("conta_id", hubToken.conta_id).eq("cliente_id", hubToken.cliente_id)`.
   No flatten, avulso → `workflow_titulo: null, workflow_created_at: null` (null, não "").
   `workflow_select_options`: derivar os ids de
   `[...new Set(posts.map(p => p.workflow_id).filter(Boolean))]`.
   Caminhos downstream (mídia, sugestões, aprovações) são por post_id e não mudam;
   `instagramProfile`/`autoPublishOnApproval` agora rodam sempre.
2. `hub-approve`: o select do post ganha `cliente_id, conta_id`; substituir o fetch de
   workflow + authz por
   `if (post.cliente_id !== hubToken.cliente_id || post.conta_id !== hubToken.conta_id) → 403`;
   o fetch do cliente para auto-publish usa `post.cliente_id`. NÃO tentar integrar
   `isFinalApprovalCycle` (PR #400, branch separada); apenas não criar conflito gratuito.
3. `hub-edit-suggestion`: mesma troca de authz (select já tem conta_id; adicionar
   cliente_id).
4. Testes: atualizar os mocks de `hub-functions_test.ts` para a nova ordem/forma; novos
   casos: hub-posts devolve avulso com `workflow_titulo: null` e funciona para cliente sem
   nenhum workflow; hub-approve aprova avulso (authz + auto-publish com
   `auto_publish_on_approval`).
5. `npm run test:functions` verde.

## Task 7: Publish utils e handlers de publicação

Arquivos: `supabase/functions/_shared/instagram-publish-utils.ts`,
`_shared/tiktok-publish-utils.ts`, `instagram-publish/handler.ts`,
`instagram-publish-cron/index.ts`, `tiktok-publish-cron/core.ts` + testes.

1. `validateForScheduling` (IG): o select do post ganha `cliente_id`; remover o fetch de
   workflow e o erro "Workflow não encontrado."; a busca de `instagram_accounts` usa
   `post.cliente_id`.
2. `validateForTikTokScheduling`: mesma reforma (o teste
   `tiktok-publish-utils_test.ts` asserta a mensagem antiga; atualizar).
3. `instagram-publish/handler.ts`: select do post ganha `cliente_id`; o caminho
   TOKEN_EXPIRED marca a conta expirada via `post.cliente_id` direto.
4. Crons: tipos `workflow_id: number | null` onde declarado
   (`instagram-publish-cron/index.ts` ~35, `tiktok-publish-cron/core.ts` ~65).
5. Testes de `instagram-publish-validate`/gate/container que mockam o fetch de workflow:
   atualizar mocks. `npm run test:functions` verde.

## Task 8: MCP server

Arquivos: `supabase/functions/mcp/queries.ts`, `mcp/tools.ts` + testes
(`mcp-writes_test.ts`, `mcp-content_test.ts`, `mcp-feedback_test.ts`,
`mcp-metrics_test.ts`).

1. `createPost`: args `{workflow_id?, cliente_id?}` com validação exactly-one-of
   (`McpInputError` senão). Branch avulso: `verifyClient` (já existe, usado por
   `createWorkflow`); `ordem` = max entre os avulsos do cliente + 1; insert
   `{workflow_id: null, cliente_id, ...}`. Branch fluxo: comportamento atual.
2. `tools.ts create_post`: schema com `workflow_id` opcional + `cliente_id` opcional,
   description atualizada (PT, sem em-dash); audit inclui cliente_id.
3. `listPosts`: trocar `clientWorkflowIds()` + early-return por
   `.eq("cliente_id", args.client_id)`.
4. `getPost`: `POST_COLS` ganha `cliente_id`; usar `p.cliente_id`; remover o fetch de
   workflows (hoje `.eq("id", null)` erraria com avulso).
5. `listPostFeedback`: embed ganha `cliente_id`; remover a resolução workflow→cliente
   (que hoje descarta linhas com warning); filtro de cliente via
   `.eq("workflow_posts.cliente_id", args.client_id)`.
6. `setPostProperty`: `workflows!inner(...)` vira left embed `workflows(template_id,
   conta_id)` mantendo o filtro de conta; antes da checagem de template:
   `if (p.workflow_id === null) throw new McpInputError("Post avulso não pertence a um
   fluxo; propriedades personalizadas pertencem ao modelo do fluxo.")`.
7. Testes: novos casos para exactly-one-of, create avulso, list por cliente_id, get de
   avulso, feedback de avulso, erro claro do setPostProperty. `npm run test:functions`.

## Task 9: express-post-cleanup-cron

Arquivo: `supabase/functions/express-post-cleanup-cron/index.ts` (+ handler/testes do
diretório e `supabase/functions/__tests__/` correspondente).

1. Passo 1 (conclusão de workflows express publicados): adicionar
   `.not("workflow_id", "is", null)` na coleta de candidatos (hoje `.select("workflow_id")`
   sem filtro; o primeiro express avulso publicado injetaria null no
   `.in("id", candidateIds)` e poderia derrubar o run).
2. Novo passo 3: GC de rascunhos avulsos express:
   `workflow_posts` where `is_express = true AND workflow_id IS NULL AND
   status = 'rascunho' AND created_at < cutoff` (mesmo cutoff de 24h). Coletar
   `post_file_links.file_id` dos posts, deletar os posts, deletar arquivos órfãos
   (`reference_count <= 0`), espelhando o loop de órfãos existente no próprio arquivo.
3. Passos 1 e 2 legados permanecem (transição; removê-los é follow-up).
4. Testes: um run com express avulso publicado + rascunho avulso órfão a limpar no mesmo
   run (passo 1 não quebra, passo 3 limpa); regressão do comportamento legado.
   `npm run test:functions` verde.

## Task 10: Extração do PostEditorBody (refactor puro)

Arquivos: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (1614 linhas),
novos `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` e
`apps/crm/src/hooks/useClienteSocialAccounts.ts`.

1. Extrair o corpo expandido do `SortablePostItem` (~linhas 1271-1578) para
   `PostEditorBody.tsx`: meta row (título/tipo/PlatformSelector/status select com
   `groupOptionsByOwner`/responsável/DateTimePicker com dayMarkers), hint de automação,
   `PublishErrorBlock`, aviso de visibilidade externa, `PropertyPanel` (gated em
   `templateId != null`), `PostMediaGallery`, bloco de sugestão, `PostEditor`,
   `InstagramCaptionField`, `TikTokSettingsPanel`, `ScheduleButton`,
   `PostAutomationSection`, `PostCommentSummary`, thread de aprovações. Props = as do
   `SortablePostItem` menos as de sortable/accordion; o estado local de título debounced e
   estados por post de mídia/tiktok movem junto. `SortablePostItem` vira wrapper
   (useSortable + trigger row) + `<PostEditorBody/>`.
2. Extrair as queries de contas sociais do cliente (WorkflowDrawer ~272-320) para
   `useClienteSocialAccounts(clienteId)` retornando
   `{hasInstagramAccount, igAccountStatus, hasActiveTikTokAccount, ttAccountStatus}`.
3. **Nenhuma mudança de comportamento.**
   `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx` (396 linhas)
   deve passar SEM alterações. `npx tsc -p apps/crm/tsconfig.json --noEmit` verde.

## Task 11: DnD no kanban de Publicações

Arquivos: `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`,
`pages/entregas/postLabels.ts`, `pages/entregas/statusRegistry.ts`,
`components/CalendarGrid.tsx`, `components/WorkflowDrawer.tsx`, novo hook
`pages/entregas/hooks/useUpdatePostStatus.ts` + testes.

1. Mover `LOCKED_STATUSES` + tooltips de `CalendarGrid.tsx:12-17` para `postLabels.ts`;
   `CalendarGrid` reexporta/importa de lá.
2. Extrair a guarda de aprovado de `WorkflowDrawer.handleFieldChange` (~406-421) para
   `statusRegistry.statusChangeNeedsConfirm(post, key, registry)`; refatorar o drawer para
   usá-la (mesmo copy do confirm).
3. DnD com @dnd-kit (mesmo stack de `views/KanbanView.tsx`): sensores
   `PointerSensor {distance: 5}` + `TouchSensor {delay: 250}`; `useDraggable` por card
   (`disabled` quando o canonical resolvido está em LOCKED_STATUSES, com tooltip e ícone
   `Lock` de lucide); `useDroppable` por coluna; colunas cujo canonical é de sistema são
   alvos inválidos (classe dimmed durante drag; drop → toast com o tooltip, sem write);
   `DragOverlay` com clone do card.
4. Drop: resolver StatusKey da coluna; no-op se igual; se
   `statusChangeNeedsConfirm` → `AlertDialog` com o copy exato do drawer; senão mutar.
5. `useUpdatePostStatus`: `useMutation` com
   `mutationFn: updateWorkflowPost(id, statusKeyToPatch(key))`; `onMutate` cancela e
   snapshot de `['active-posts']`, patch otimista `{status: canonical, custom_status_id}`;
   `onError` restaura + `toast.error('Erro ao atualizar status')`; `onSettled` invalida
   `['active-posts']`, `['workflow-posts-with-props', wfId]` quando houver fluxo, e os
   contadores `['workflow-posts-counts']`, `['workflow-approved-posts-counts']`,
   `['workflow-cleared-cliente-counts']`, `['workflow-revisao-interna-counts']`,
   `['workflow-awaiting-cliente-counts']`.
6. Vale para TODOS os posts. Clique continua abrindo o drawer (distance 5 preserva).
7. Testes (`views/__tests__/PostsKanbanView.test.tsx` + novos): card de status de sistema
   não arrasta; coluna de sistema recusa com toast; aprovado → confirm e só escreve ao
   confirmar; drop em custom escreve só `{custom_status_id}` (via statusKeyToPatch);
   optimistic + rollback em erro. `npm run test` e tsc do crm verdes.

## Task 12: Store/types sweep

Arquivo central: `apps/crm/src/store/posts.ts` (+ `store/mensagens.ts`,
`apps/hub/src/types.ts` NÃO nesta task). Objetivo: tipos anuláveis + queries com merge de
duas listas + funções novas, mantendo os QUATRO tsc verdes com tolerância mínima a null
nos consumidores (a UX refinada vem nas Tasks 13-16).

1. Tipos: `WorkflowPost.workflow_id: number | null` + `cliente_id: number`;
   `ClientePost`/`ScheduledPost`/`ActivePost`/`AssignedPendingPost`:
   `workflow_id: number | null`, `workflow_titulo: string | null`;
   `MentionPostResult.workflow_id: number | null`.
2. Queries (padrão: **merge de duas queries**; PostgREST left-join com `.eq` em coluna do
   embed filtra o embed, não as linhas pai):
   - `getActivePosts`: `Promise.all([query atual com workflows!inner ativo, query avulsa
     .select(POST_CONTEXT_COLUMNS + ', clientes(nome)').is('workflow_id', null)])`,
     merge e re-sort por `scheduled_at` asc nulls-last (extrair comparator).
   - Mesmo tratamento: `getScheduledPosts`, `getClientePosts` (braço avulso:
     `.eq('cliente_id', clienteId).is('workflow_id', null)`), `getAssignedPendingPosts`,
     `getAwaitingClientePosts`, e o select de `store/mensagens.ts:111` (sem filtro de
     status lá: pode virar left embed simples com mapeamento null-safe).
   - `POST_CONTEXT_COLUMNS` ganha `cliente_id`; `mapPostContextRow` com fallbacks:
     `cliente_id: row.workflows?.cliente_id ?? row.cliente_id`, `cliente_nome:
     row.workflows?.clientes?.nome ?? row.clientes?.nome ?? ''`, `workflow_titulo:
     row.workflows?.titulo ?? null`.
   - "Ativo" para avulso = todos os avulsos, qualquer status.
3. Funções novas:
   - `createAvulsoPost({cliente_id, titulo, tipo, is_express = false})`: insert com
     `workflow_id: null, status: 'rascunho', ordem: 0, conteudo: null,
     conteudo_plain: ''` + conta_id (padrão do arquivo).
   - `detachPostsFromWorkflow(postIds, archiveEmptyFlow = false)`:
     `rpc('detach_posts_from_flow', {p_post_ids, p_archive_empty_flow})`.
   - `attachPostToWorkflow(postId, workflowId)`: `rpc('attach_posts_to_flow', ...)`.
   - `getStandalonePost(postId)`: `select('*, clientes(nome)') .eq('id', postId)
     .maybeSingle()` mapeado com `cliente_nome`.
   - `updateWorkflowPost`: Omit ganha `cliente_id` (além de workflow_id).
4. Varredura: `npx tsc -p apps/crm/tsconfig.json --noEmit`,
   `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json
   --noEmit`, `npx tsc -p tsconfig.scripts.json` todos verdes; consumidores que quebrarem
   recebem null-tolerância mínima (guards), sem UX nova. NÃO alterar
   `apps/hub/src/types.ts` nesta task (o Hub compila contra o próprio types).
5. Testes: atualizar `apps/crm/src/__tests__/store.posts.test.ts` (asserta strings de
   select literais) e adicionar cobertura das funções novas (payloads, nomes de RPC,
   filtros do braço avulso). `npm run test` verde.

## Task 13: EntregasPage — entrada, modo, deep link, filtros, clique

Arquivos: `apps/crm/src/pages/entregas/EntregasPage.tsx`, novos
`pages/entregas/entregasPrefs.ts` e `pages/entregas/components/NewAvulsoDialog.tsx`,
produtores de link (`components/layout/GlobalSearchTrigger.tsx`,
`pages/mensagens/components/PostChip.tsx`,
`pages/dashboard/components/AgentPendingSection.tsx`, `pages/dashboard/todayAgenda.ts`,
`components/mentions/mentionHref.ts`) + testes.

1. Botão "Novo Fluxo" vira `DropdownMenu` (shadcn `components/ui/dropdown-menu.tsx`)
   com trigger "Novo" (manter `data-tour="novo-fluxo-btn"` no trigger; conferir que o
   passo do tour continua fazendo sentido) e itens "Novo fluxo" e "Post avulso".
2. `NewAvulsoDialog.tsx`: react-hook-form + zod; campos cliente (obrigatório), título
   (obrigatório), tipo (labels de `TIPO_LABELS`). Submit → `createAvulsoPost` → toast
   "Post avulso criado" → invalidar `['active-posts']` → EntregasPage: se view não é
   kanban/list, `setActiveView('kanban')`; modo da view = 'publicacoes'; abrir
   `StandalonePostDrawer` (estado `standalonePostId`) — na ausência da Task 14, deixar um
   TODO estruturado: setar o estado e renderizar null-safe (o drawer chega na Task 14;
   manter compilando).
3. `entregasPrefs.ts` (padrão de `savedViews.ts`): `loadLastMode(contaId)` /
   `persistLastMode(contaId, mode)`, chave `entregas_last_mode_${contaId}`, try/catch.
   Na montagem: `hadModeParam = searchParams.has('mode')` ANTES do parse ref; seeds dos
   três modos usam `hadModeParam ? modeFor(view) : loadLastMode(contaId)`. Persistir num
   effect quando o modo ativo muda (views kanban/list/calendar).
4. Deep link `?post=<id>` sem `drawer=`: no effect de parse, quando só `post` presente,
   `pendingDeepLink = {workflowId: null, postId}`; resolver assíncrono via
   `getStandalonePost`: `workflow_id === null` → `setStandalonePostId` (fechando o
   WorkflowDrawer aberto, se houver); `workflow_id != null` → cair no lookup de card
   existente com esse workflow; não encontrado → toast "Post não encontrado".
5. Produtores: helper local nos que têm vários pontos
   (`postHref(p) => p.workflow_id != null ? '/entregas?drawer=' + p.workflow_id +
   '&post=' + p.id : '/entregas?post=' + p.id`); atualizar os 5 arquivos; em
   `mentionHref.ts`, migrar o href de post para a forma `?post=` universal.
   `GlobalSearchTrigger` rotula "Avulso" quando não há workflow.
   **Mensagens**: `PostChip.tsx` passa a aceitar `workflowId: number | null` e monta o
   link com o mesmo padrão (`?post=` quando null); `ConversationThread.tsx` troca o
   gating `m.post_id != null && m.workflow_id != null` por só `m.post_id != null`
   (linha ~182) e qualquer affordance de resposta condicionada a `workflow_id` passa a
   depender de `post_id` (grep por `workflow_id` no diretório de mensagens): respostas em
   posts avulsos continuam suportadas.
6. Filtros (`filteredPosts`): membros com fallback
   `p.workflow_id != null ? card?.etapa.responsavel_id : p.responsavel_id`;
   etapa/prazo mantêm exclusão de avulsos quando ativos (comentário explicando;
   `matchesEtapaPrazo` já tem a semântica certa).
7. Contrato de clique: `onPostClick(post: ActivePost)` em
   `PostsKanbanView`/`PostsListView`/`CalendarView`/`PublicacoesPanel`; EntregasPage:
   avulso → `setStandalonePostId(post.id)`; senão lookup atual. Avulsos são sempre
   "openable".
8. Testes: `EntregasPage.test.tsx` (deep link `?post=`, seed de modo persistido, URL
   vence), novo `entregasPrefs.test.ts`, `NewAvulsoDialog.test.tsx`, testes de
   `todayAgenda` (href helper). `npm run test` + tsc verdes.

## Task 14: StandalonePostDrawer + AttachToFluxoDialog

Arquivos: novos `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` e
`AttachToFluxoDialog.tsx`; integração em `EntregasPage.tsx` + testes.

1. `StandalonePostDrawer({postId, membros, onClose, onRefresh, onAttached})`, keyed por
   `postId` no call site. Data: `useQuery(['standalone-post', postId], getStandalonePost)`;
   variantes single-post das queries do drawer (`getPostApprovals([postId])`,
   `getPostStatusEvents`, `getPostCommentThreads`, `getPostEditSuggestions`,
   `getWorkspaceUsers`); `['clientePosts', clienteId]` para day markers;
   `useClienteSocialAccounts(clienteId)`.
2. Shell: mesmas classes `drawer-overlay`/`drawer-panel` + fullscreen (mesma key
   localStorage `workflow-drawer-fullscreen`). Header: título; subtítulo
   `{cliente_nome} · chip "Avulso"`; ações: "Vincular a um fluxo", `CopyPostLinkButton`
   (hubUrl via slug do workspace + token do cliente, espelhando `useEntregasData` ~291-302;
   renderizar só quando resolvível), excluir (AlertDialog → `removeWorkflowPost`), fechar.
   SEM abas de fluxo. Corpo: `<PostEditorBody/>` com `templateId: undefined`
   (PropertyPanel oculto), `handleFieldChange` local usando `statusChangeNeedsConfirm` +
   confirm igual ao drawer, autosave de conteúdo com debounce (clonar
   `scheduleContentSave`).
3. Refresh invalida: `['standalone-post', postId]`, `['active-posts']`,
   `['post-approvals']`, `['post-status-events']`, `['post-comment-threads']`,
   `['post-edit-suggestions']`, `['clientePosts', clienteId]`.
4. `AttachToFluxoDialog`: fluxos com `status === 'ativo' && cliente_id ===
   post.cliente_id` (de `getWorkflows()` cacheado); radio list por título; empty state
   "Nenhum fluxo ativo para este cliente". Confirmar → `attachPostToWorkflow` → toast
   `Post vinculado a "{titulo}"` → invalidações (`['active-posts']`,
   `['workflow-posts-with-props', wfId]`, `['workflow-posts-counts']`,
   `['clientePosts', clienteId]`) → `onAttached(wfId, postId)` (EntregasPage abre o
   WorkflowDrawer no post).
5. Testes: sem PropertyPanel; chip Avulso presente; attach lista só fluxos ativos do
   cliente; invalidações; excluir. `npm run test` + tsc verdes.

## Task 15: Desmembrar no WorkflowDrawer

Arquivo: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` + teste.

1. Estado `selectedPostIds: Set<number>`; checkbox no trigger row de cada
   `SortablePostItem` (à esquerda do drag handle, `stopPropagation`), props
   `isSelected`/`onSelectChange`.
2. Barra de seleção acima da lista quando não vazia:
   `"N selecionados" · link "Selecionar todos" · botão "Desmembrar do fluxo" ·
   botão "Limpar"`.
3. Kebab (`MoreVertical` de lucide) por post no trigger-right, com item
   "Desmembrar do fluxo" (caminho de 1 post cai no mesmo confirm).
4. Confirm `AlertDialog`: título "Desmembrar do fluxo?", corpo "Os posts selecionados
   viram publicações avulsas de {cliente}. Eles continuam no quadro de Publicações e no
   portal do cliente, mas saem deste fluxo." Ação →
   `detachPostsFromWorkflow(ids)` → toast "N post(s) desmembrado(s)" → limpar seleção →
   `refresh()` + `onRefresh()` (garantir `['active-posts']` na invalidação do refresh).
5. Se `ids.length === posts.length`: segundo AlertDialog "Fluxo sem posts" / "Todos os
   posts foram desmembrados. Deseja arquivar o fluxo \"{titulo}\"?" → confirmar chama de
   novo o RPC? NÃO: chamar `detachPostsFromWorkflow(ids, true)` já com
   `p_archive_empty_flow = true` exige decidir ANTES; implementar como: o confirm
   principal, quando a seleção é total, mostra um checkbox "Arquivar o fluxo depois de
   desmembrar" (default desmarcado) e passa o booleano ao RPC. Ao arquivar:
   `onRefresh()` + `onClose()`.
6. Testes em `WorkflowDrawer.test.tsx`: seleção múltipla, selecionar todos, confirm com
   checkbox de arquivar aparece só na seleção total, chamada do RPC com os args certos,
   kebab de 1 post. `npm run test` + tsc verdes.

## Task 16: Superfícies de lista e calendários

Arquivos: `views/PostsListView.tsx`, `views/PostsKanbanView.tsx`,
`components/PublicacoesPanel.tsx`, `views/CalendarView.tsx`,
`components/WorkflowCalendarView.tsx`, `components/CalendarGrid.tsx`,
`pages/entregas/calendarDrop.ts`, `apps/crm/style.css` + testes.

1. `PostsListView`: célula Fluxo para avulso →
   `<span className="post-fluxo-tag post-fluxo-tag--avulso">Avulso</span>` (nova classe
   em `style.css`, tint discreto); células Etapa atual/Prazo da etapa em branco para
   avulsos; comparators de sort null-safe (avulsos agrupam juntos).
2. `PostsKanbanView`: onde `{card && <div className="board-post-etapa">...}` (linha ~125),
   else-branch para `p.workflow_id === null` com chip "Avulso".
3. `PublicacoesPanel`: avulso sempre openable; rótulo do link "Abrir publicação →" quando
   avulso (hoje "Abrir no fluxo →"); clique roteia pelo novo contrato.
4. `WorkflowCalendarView`/`CalendarGrid`: tooltip do pill usa
   `post.workflow_titulo ?? 'Avulso'`; sufixo "(outro workflow)" vira "(avulso)" quando
   `workflow_id === null`; desagendar avulso: manter o reject de `calendarDrop.ts` com
   copy própria no branch de reject ("Post avulso: desagende pela publicação").
   `CalendarPostDetailPanel`: o botão "Abrir post completo" é `isCurrentWorkflow`-only;
   para avulso (`workflow_id === null`), mostrar botão "Abrir publicação" que navega para
   `/entregas?post=<id>` (o resolver da Task 13 abre o drawer avulso e fecha o atual).
   Reagendar avulso por drag continua permitido.
5. Testes: fixtures atualizadas em `PostsListView.test.tsx`, `PostsKanbanView.test.tsx`,
   `PublicacoesPanel.test.tsx`, `CalendarGrid.test.tsx`, `WorkflowCalendarView.test.tsx`;
   caso novo `workflow_id: null` em `calendarDrop.test.ts`. `npm run test` + tsc verdes.

## Task 17: Post Express sem fluxo descartável

Arquivo: `apps/crm/src/pages/post-express/ExpressPostPage.tsx` + testes.

1. `DraftState` → `{postId: number}` (sem workflowId).
2. `createDraft`: substituir `addWorkflow` + `addWorkflowEtapa` + `addWorkflowPost` por
   `createAvulsoPost({cliente_id: clientId, titulo: 'Post Express - ' + clientName +
   ' - ' + dateStr, tipo: 'feed', is_express: true})`.
3. Abandono/unmount: `removeWorkflowPost(postId)` (era removeWorkflow).
4. `handlePublishNow`: remover o `updateWorkflow(draft.workflowId, {status:
   'concluido'})`.
5. `handleSendForApproval`: só troca para `draft.postId`.
6. Testes: `ExpressPostPage.test.tsx` (asserta que `addWorkflow` NÃO é chamado; fluxo de
   publicar agora e de enviar para aprovação). `npm run test` + tsc verdes.

## Task 18: Hub — grupo de avulsos

Arquivos: `apps/hub/src/types.ts`, `apps/hub/src/pages/PostagensPage.tsx`,
`apps/hub/src/components/PostCard.tsx` + testes do Hub.

1. `types.ts` (~82-84): `workflow_id: number | null; workflow_titulo: string | null;
   workflow_created_at: string | null;`.
2. `PostagensPage` (agrupamento ~138-171): chave
   `post.workflow_id != null ? 'wf-' + post.workflow_id : 'avulso'` num
   `Record<string, {key, titulo, posts}>`; grupo avulso `titulo: 'Publicações avulsas'`,
   fixado PRIMEIRO na ordenação (fluxos seguem por `workflow_created_at` desc,
   null-safe); manter "só o primeiro grupo expandido" (o avulso, quando existe).
   **Corrigir de passagem**: collapse keyed por `group.key` em vez de `group.titulo`
   (bug latente: dois fluxos com mesmo título compartilham collapse) em TODAS as
   ocorrências (~159, 226, 232, 249, 256, 260, 288, 314).
3. `PostCard.tsx`: `PropertyRow` prop `workflowId: number | null` (linha ~92); o filtro
   em ~87 já trata null; call site ~458 passa `post.workflow_id` direto.
4. Testes: fixtures de `pages/__tests__/contentPages.test.tsx` /
   `aprovacoesPostagensFeatures.test.tsx`; novos: grupo avulso fixado no topo e expandido;
   regressão do collapse por chave (dois fluxos de mesmo título independentes).
   `npm run test` + `npx tsc -p apps/hub/tsconfig.json --noEmit` verdes.

## Task 19: Copy, onboarding e gate final local

Arquivos: `apps/crm/src/pages/entregas/components/ComoFuncionaPanel.tsx`,
`pages/entregas/wizard/presets.ts`, empty states de `PostsKanbanView`/`PostsListView`,
mais o gate.

1. `ComoFuncionaPanel`: um aside no card "dois trilhos": "Um post também pode existir sem
   fluxo (publicação avulsa): ele anda só pelo trilho de status, no quadro de
   Publicações." (sem em-dash).
2. `wizard/presets.ts`: remover o preset `post-avulso` de `STANDARD_PRESETS` (grep por
   `'post-avulso'` antes, para referências ao id).
3. Empty state do quadro/lista de Publicações (sem filtros e vazio): botão
   "Criar post avulso" que abre o `NewAvulsoDialog` (prop `onCreateAvulso`).
4. Gate final local (tudo verde, colar output no report): `npm run lint`,
   `npm run format:check` (rodar `npm run format` antes se precisar), os quatro tsc
   (crm, hub, admin, scripts), `npm run test`, `npm run test:functions`,
   `git checkout -- deno.lock` se dirtied, `ls node_modules/.deno` (se existir, avisar).

## Deploy (runbook)

1. Migrations A1→A4 primeiro (staging → prod), depois edge functions
   (`--use-api`, `--no-verify-jwt` onde aplicável), depois frontend (merge/Vercel).
   Conferir `supabase/.temp/project-ref` antes de cada `db push` (o link flipa).
2. **Pré-apply em cada ambiente** (staging e prod), antes do `db push`:
   `SELECT count(*) FROM workflows w JOIN clientes c ON c.id = w.cliente_id
   WHERE c.conta_id <> w.conta_id;` deve retornar 0. Um mismatch legado faria o backfill
   de A1 violar a FK composta na hora do apply.
3. `bash scripts/test-entitlements.sh` no staging após o push.
