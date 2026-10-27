# Linha editorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-client monthly "linha editorial" table in Entregas that goes to the Hub for whole-linha approval and converts, in bulk, into a new fluxo or individual posts pre-filled from each row.

**Architecture:**

- **SQL:** four RLS tables (`linhas_editoriais`, `linha_editorial_colunas`, `linha_editorial_itens`, `linha_editorial_respostas`). Writes are flag-gated in policy, and state moves only through SECURITY DEFINER RPCs.
- **Edge:** `hub-linha-editorial` (token auth) for the client's read, comments and decision.
- **CRM:** a new Entregas view `view=linha` under `pages/entregas/linha/`, with conversion through `NewWorkflowWizard` (new `seed` prop) or a bulk avulso dialog.
- **Hub:** a "Linha editorial" tab in Aprovações.

**Tech Stack:** Postgres/plpgsql (Supabase), Deno edge functions, React 19 + TanStack Query + shadcn (CRM), React 19 + hub CSS classes (Hub), Vitest, Deno test, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-10-26-linha-editorial-design.md`. Read it in full; §4 to §9 are binding. Mockups: https://claude.ai/artifact/LYRyx2HdmXXmAmuP45xnU6 (boards "Opção B", "1 · Montar", "3 · Aprovada", "4a", "4b", "5", "2 · Hub", "2 · Hub no celular").

## Global Constraints

**Repo and git**

- Worktree `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/linha-editorial-creation-c560c5`, branch `claude/linha-editorial-creation-c560c5`. Run every command from there.
- Commit with explicit pathspecs only (`git commit -- <files>`). Never commit any `.env*`.
- `supabase/config.toml`: never commit the temporary port overrides. Task 5 does commit one hunk, `[functions.hub-linha-editorial] verify_jwt = false`, following the other `hub-*` blocks at `config.toml:43-76`.
- Formatters only on your own files (`npx prettier --write <paths>`), never repo-wide.

**Migrations**

- Files are `20261031000001_linha_editorial_schema.sql`, `20261031000002_linha_editorial_rpcs.sql` and `20261031000003_linha_editorial_hub_notifications.sql`.
- No other new prefixes. `20261030*` belongs to the open "conta demo" PR #746. Renumber above main's tail before `gh pr create`.

**Local DB**

- Docker is colima (`colima start --cpu 4 --memory 8`). Other worktrees may hold the default ports: use temporary port overrides in `supabase/config.toml` and restore it afterwards (memory `reference_local_supabase_colima`).
- Run suites with `SUPABASE_DB_URL=<your db url> bash scripts/test-entitlements.sh`, or one file with `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <file>`.
- New suites call `select et_grant_hosted_parity(array['linhas_editoriais','linha_editorial_colunas','linha_editorial_itens','linha_editorial_respostas'])` inside their `begin`. The argument is an **exclude** list: the helper grants ALL on every other table, the way hosted does. Without the exclusion it would undo the column-level grants these suites test.
- Turn the flag on in suites with an override:

  ```sql
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
  values (<ws>, '{"feature_linha_editorial": true}')
  ```

  (pattern `99_crm_vidro_flag.sql:21-22`). Flag-off cases delete that row.
- `npm run test:db` and every `99_linha_editorial_*` suite need colima running and a free port set.

**Deno**

- Tests: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/<file>`.
- Type gate: `npm run check:functions`.
- After any Deno run, `git status` must not show `deno.lock` or `node_modules/.deno` changes. Revert with `git checkout -- deno.lock`; run `npm ci` if `node_modules` got polluted.

**Copy and UI**

- User-facing copy is pt-BR, sentence case, with **no em dashes** (use a period or colon).
- Error copy names what to do.

**Identifiers and constraints**

- IDs: `clientes.id`, `workflows.id`, `workflow_posts.id` and `template_property_definitions.id` are **bigint**. New tables use uuid PKs.
- `ContentFormat` = `'feed' | 'carrossel' | 'reels' | 'stories'`.
- Statuses: linha `rascunho | enviada | ajustes | aprovada`; resposta `acao` `comentario | aprovado | ajustes`.
- The flag key is `feature_linha_editorial` everywhere. CRM reads `features?.feature_linha_editorial === true`. The Hub reads `bootstrap.feature_linha_editorial === true`.
- RPCs refuse a disabled flag with the message `feature_disabled:feature_linha_editorial`, so `mapEntitlementError` (`entitlement-errors.ts:65`) can name it; precedent `20261005000001_agenda_eventos.sql:968`.
- Converted post content is typed `Record<string, unknown>`, like `WorkflowPost.conteudo` (`store/posts.ts:67`), not `JSONContent`.
- `scheduled_at` is derived in SQL only:

  ```sql
  (item.data + time '10:00') AT TIME ZONE 'America/Sao_Paulo'
  ```

**Platform rules**

- The converter never writes `workflow_posts.platform`; triggers seed the targets.
- Silent updates: every in-flight cell save is wrapped in `trackUnsavedWork` (`packages/app-lifecycle`). Never `useBlocker`.
- Hub rate limits: GET debits `hub-read:${conta}:${cliente}`. POST debits **only** `hub-write:hub-linha-editorial:${conta}:${cliente}` at 60/3600. Invalid tokens debit `hub-badtoken:${ip}` at 30/600.
- Edge functions: `buildCorsHeaders(req)`, generic error bodies, details only in logs.

## Review Focus

1. **A Hub token of client A posting a decision with client B's `linha_id` (same conta):** 404, no write. Covered by the Task 3 suite `decision_other_cliente_refused` and the Task 5 test `POST another client's linha returns 404`.
2. **The flag turned off for a workspace that already has linhas:** reads still work, every write fails (PostgREST and RPCs), and the tab is hidden with `view=linha` links falling back to Kanban. Covered by the Task 1 suite `writes_blocked_flag_off` and the Task 7 test `view=linha falls back to kanban when flag off`.
3. **Deleting a post created from a row:** the row comes back as convertible with its last values, and the freeze trigger lets the FK cascade through. Covered by the Task 2 suite `post_delete_releases_item`.
4. **Converting with the fluxo or avulso plan limit reached mid-batch:** nothing is created, the toast names the limit, and the wizard's empty workflow is removed. Covered by the Task 2 suite `converter_limit_rolls_back` and the Task 11 test `converter failure removes workflow and keeps wizard open`.
5. **"Nova linha" when the last dated row is on the month's last day:** the new row has `data = null` and the insert succeeds. Covered by the Task 6 test `defaultNovaData returns null past month end`.

---

### Task 1: Schema, flag and RLS

**Files:**
- Create: `supabase/migrations/20261031000001_linha_editorial_schema.sql`
- Create: `supabase/tests/entitlements/99_linha_editorial_schema.sql`

**Interfaces:**
- Produces:
  - tables per spec §4.1 to §4.4;
  - `plans.feature_linha_editorial boolean NOT NULL DEFAULT false`;
  - `public.linha_nome_norm(text) returns text`, IMMUTABLE, as
    `lower(extensions.unaccent('extensions.unaccent', trim($1)))`;
  - a unique index `(conta_id, public.linha_nome_norm(nome))` on colunas;
  - `UNIQUE (id, conta_id)` on linhas and itens, and `UNIQUE (id, linha_id)` on itens, so
    later composite FKs can reference them.

- [ ] **Step 1: Write the suite.** It covers:
  - `rls_isolation`: another conta sees 0 rows in all four tables.
  - `writes_blocked_flag_off`: with `effective_plan_feature` false, INSERT, UPDATE and DELETE fail or affect 0 rows on all four tables, while SELECT still returns the rows.
  - `date_in_month`: an item dated `2026-12-01` on a `2026-11-01` linha raises.
  - `cap_100`: the 101st item raises.
  - `freeze_after_conversion`: with `post_id` set (as service_role), updating `titulo` raises and updating `ordem` succeeds.
  - `linha_id_immutable`.
  - `status_not_writable`: `update linhas_editoriais set status='aprovada'` as authenticated raises `42501`. A direct `insert into linhas_editoriais` and `insert into linha_editorial_itens (…, post_id)` raise `42501`. A team resposta with `acao='aprovado'` is refused.
  - `nome_norm_unique`: "Pilar" then "pílar " raises `23505`.
  - `resposta_item_of_other_linha_refused`: the composite FK raises.
  - `periodo_first_day`: `2026-11-02` raises.
  - `item_delete_nulls_resposta_item_id`: deleting an item with replies succeeds and leaves the replies with `item_id` null.
  - `resposta_rodada_stamped`: a team reply inserted with `rodada = 99` is stored with the linha's `rodada`.
  - `insert_into_other_conta_linha_refused`: a conta-B user inserting an item into conta-A's linha fails. The guard trigger treats "parent not visible" as an error, not only RLS WITH CHECK.

  Use the helpers from `99_transacoes_recorrentes.sql` (`pg_temp.erro`, `pg_temp.vistos`, `pg_temp.afetadas`).
- [ ] **Step 2: Run the suite and see it fail** (the tables don't exist yet).
- [ ] **Step 3: Write the migration.** It holds:
  - the plan column;
  - the four tables with composite same-tenant FKs to `clientes(id, conta_id)` (`clientes_id_conta_uq`) and `workflow_posts(id, conta_id)` (`workflow_posts_id_conta_uq`);
    - `(post_id, conta_id) → workflow_posts ON DELETE SET NULL (post_id)`, with the column list (PG15+; precedent `20260918000002:55-58`). A bare `SET NULL` would also null the NOT NULL `conta_id` and fail;
    - respostas `(item_id, linha_id) → itens(id, linha_id) ON DELETE SET NULL (item_id)`, so a deleted row's comments survive as linha-level comments **(my call)**;
  - triggers:
    - `linha_item_guard`: date in month, conta match, cap 100, `linha_id` immutable, and the freeze only when `OLD.post_id IS NOT NULL AND NEW.post_id IS NOT DISTINCT FROM OLD.post_id`. A parent not found is an error;
    - `linha_resposta_guard`: conta match, and it stamps `NEW.rodada` from the linha;
  - a migration header note that `linha_nome_norm` wraps `unaccent` as IMMUTABLE, so a change to the unaccent dictionary needs the index rebuilt;
  - the `updated_at` touch;
  - RLS: SELECT `conta_id IN (SELECT get_my_conta_id())`, and INSERT, UPDATE and DELETE add `effective_plan_feature(conta_id,'feature_linha_editorial')`. The respostas INSERT policy also requires `is_workspace_user AND author_user_id = auth.uid()`;
  - the grants: **`REVOKE ALL ON TABLE <the four tables> FROM PUBLIC, anon, authenticated`**, then `GRANT ALL … TO service_role`. Hosted Supabase's default ACL grants ALL to `authenticated` on new tables, and column grants only bite once that table grant is gone (`20261027000002_financeiro_v2_schema.sql:207-213`, `20260728000002:68-76`). The local suite cannot see this, so the migration text is the only defense. Then, for authenticated:
    - SELECT on all four tables.
    - **No INSERT on `linhas_editoriais`.** Linhas are created only through `linha_editorial_criar`, so nobody can insert one already `aprovada`.
    - Column-level INSERT on itens: `(id, linha_id, conta_id, data, tipo, titulo, direcao, valores, ordem)`. `id` is included so "Nova linha" can insert optimistically with a client uuid. `post_id` and `convertido_*` are never insertable.
    - Column-level INSERT on colunas: everything but `id` and `created_at`.
    - Column-level INSERT on respostas: `(conta_id, linha_id, item_id, acao, comentario, is_workspace_user, author_user_id)`. `rodada` is stamped by the trigger, and the policy also requires `acao = 'comentario'`.
    - DELETE on itens and colunas.
    - Column-level UPDATE per spec §4.
- [ ] **Step 4: Run** `$SB db reset` and the suite. Expected: all pass.
- [ ] **Step 5: Commit** `feat(linha): schema, flag column and RLS`.

### Task 2: CRM RPCs and conversion

**Files:**
- Create: `supabase/migrations/20261031000002_linha_editorial_rpcs.sql`
- Create: `supabase/tests/entitlements/99_linha_editorial_rpcs.sql`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces. Every RPC is SECURITY DEFINER, `set search_path = public`, granted to authenticated, and raises errcode P0001 with the messages `feature_disabled:feature_linha_editorial`, `nao_encontrada` or `status_invalido`:
  - `linha_editorial_criar(p_cliente_id bigint, p_periodo date) returns uuid`: idempotent. It seeds Pilar, CTA and Referência (spec §4.2) when the conta has no columns.
  - `linha_editorial_enviar(p_linha_id uuid) returns void`: from rascunho, ajustes or aprovada. It runs `rodada+1`, sets `enviada_at = now()` and `enviada_por = auth.uid()`, and raises `linha_vazia` when there are no items.
  - `linha_editorial_recolher(p_linha_id uuid) returns void`: enviada → rascunho.
  - `linha_editorial_coluna_excluir(p_coluna_id uuid) returns void`: strips the key from unconverted items only.
  - `linha_editorial_converter(p_linha_id uuid, p_workflow_id bigint, p_posts jsonb) returns jsonb`:
    - Input element: `{item_id uuid, conteudo jsonb, conteudo_plain text, property_values: [{property_definition_id bigint, value jsonb}]}`.
    - Returns `[{item_id, post_id}]`.
    - Errors: `payload_invalido` (duplicate or foreign item ids), `ja_convertido`, `workflow_invalido` (another conta or another `cliente_id`), `propriedade_invalida` (a definition not on the workflow's `template_id`).
  - The `workflow_posts_created_via_check` is recreated with `('human','agent','linha_editorial')`.

- [ ] **Step 1: Write the suite.** It covers:
  - `criar_idempotent_and_seeds_3_columns`.
  - `enviar_empty_raises`.
  - `enviar_increments_rodada`.
  - `recolher_only_from_enviada`.
  - `coluna_excluir_keeps_converted_values`.
  - `converter_avulso_creates_rascunho_posts`: `workflow_id` null, `created_via='linha_editorial'`, `scheduled_at` equals `'2026-11-03 13:00:00+00'` for `data='2026-11-03'`, and `platform` is not null (the trigger seeded it).
  - `converter_fluxo_sets_ordem_by_date`.
  - `converter_duplicate_item_raises`.
  - `converter_other_linha_item_raises`.
  - `converter_other_cliente_workflow_raises`.
  - `converter_twice_raises_ja_convertido`.
  - `converter_foreign_definition_raises`.
  - `converter_limit_rolls_back`: set the plan's `max_posts_per_workflow` to 1, convert 2 items, and check that zero posts exist and no item has `post_id`.
  - `post_delete_releases_item`.
  - `other_conta_cannot_call_any_rpc`.
  - `rpc_refused_when_flag_off`: criar, enviar, recolher, coluna_excluir and converter raise `feature_disabled:feature_linha_editorial`.
- [ ] **Step 2: Run the suite and see it fail.**
- [ ] **Step 3: Write the migration.** In the converter:
  - Lock items `FOR UPDATE` after checking the payload ids are distinct, all in the linha and the counts are equal.
  - Insert posts, taking `titulo` and `tipo` from the item.
  - Fluxo posts get `ordem` = row_number by (`data` nulls last, `ordem`) offset after the workflow's max `ordem`; avulso posts get `ordem = 0`.
  - Insert `post_property_values`, then set `post_id`, `convertido_at` and `convertido_por`.
- [ ] **Step 4: Run** the reset and both suites. Expected: all pass.
- [ ] **Step 5: Commit** `feat(linha): CRM RPCs and atomic conversion`.

### Task 3: Hub RPCs and notification types

**Files:**
- Create: `supabase/migrations/20261031000003_linha_editorial_hub_notifications.sql`
- Create: `supabase/tests/entitlements/99_linha_editorial_hub.sql`

**Interfaces:**
- Produces. All three are service_role only:
  - `record_linha_decision(p_linha_id uuid, p_conta_id uuid, p_cliente_id bigint, p_token text, p_acao text, p_comentario text) returns jsonb` → `{status, comentarios}`.
    - It raises `nao_encontrada` when the scoped lookup misses, `status_invalido` when not enviada, and `comentario_obrigatorio` for an `ajustes` with no client comment in the rodada (`is_workspace_user = false`).
    - Both Hub RPCs first check the flag and raise `feature_disabled:feature_linha_editorial`.
  - `record_linha_comment(p_linha_id uuid, p_item_id uuid, p_conta_id uuid, p_cliente_id bigint, p_token text, p_comentario text) returns uuid`.
  - `create_linha_notification(p_linha_id uuid, p_acao text) returns void`: types `linha_editorial_aprovada` and `linha_editorial_ajustes`; metadata `{linha_id, cliente_id, cliente_nome, periodo, comentarios}`; link `/entregas?view=linha&clientes=<id>&mes=YYYY-MM`.
  - The new types are appended to `notifications_type_check`, `notification_inapp_prefs_type_check`, `notification_email_prefs_type_check` and the type array in `claim_notification_emails`. Copy each latest definition verbatim from spec §6.5's sources, then add the two types.

- [ ] **Step 1: Write the suite.** It covers:
  - `decision_other_cliente_refused`.
  - `decision_requires_enviada`.
  - `ajustes_requires_comment_unless_rodada_has_comments`.
  - `aprovado_sets_status_and_decidida_at`.
  - `comment_item_must_belong_to_linha`.
  - `comment_null_item_allowed`.
  - `comment_requires_enviada`.
  - `hub_rpcs_refused_when_flag_off`.
  - `notification_targets_owner_admin_and_sender_deduped`: the sender who is also owner gets one row.
  - `sender_removed_from_workspace_not_notified`.
  - `authenticated_cannot_execute_hub_rpcs`.
  - `claim_notification_emails_includes_new_types`.
- [ ] **Step 2: Run the suite and see it fail.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** the reset and all `99_linha_editorial_*` suites, plus `99_notifications*` if present. Expected: all pass.
- [ ] **Step 5: Commit** `feat(linha): hub decision RPCs and notification types`.

### Task 4: Flag plumbing (entitlements, CRM, Admin, Hub bootstrap)

**Files:**
- Modify:
  - `supabase/functions/_shared/entitlements.ts` (`FEATURE_COLUMNS`);
  - `supabase/functions/hub-bootstrap/handler.ts` (`feature()` list and response);
  - `apps/hub/src/types.ts` (`HubBootstrap.feature_linha_editorial?: boolean`);
  - `apps/crm/src/hooks/useWorkspaceLimits.ts` (`FeatureFlags.feature_linha_editorial?: boolean`);
  - `apps/crm/src/lib/entitlement-errors.ts` (label "Linha editorial");
  - `apps/admin/src/lib/api.ts` (type, list and label).
- Test: `apps/admin/src/**/featureFlags.test.ts`, `supabase/functions/__tests__/hub-bootstrap_test.ts`.
- Create: `supabase/functions/__tests__/entitlements_feature_linha_editorial_test.ts`, copying `entitlements_feature_financeiro_v2_test.ts`.

- [ ] **Step 1: Extend the tests.**
  - The admin `featureFlags.test.ts` expects `feature_linha_editorial` in the list with the label "Linha editorial".
  - `hub-bootstrap_test.ts` gets `returns feature_linha_editorial from effectivePlanFeature, false on error`.
  - The new entitlements test pins `feature_linha_editorial` in `FEATURE_COLUMNS`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the changes listed above.
- [ ] **Step 4: Run** the vitest file, the deno test and `npm run check:functions`. Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): feature_linha_editorial flag plumbing`.

### Task 5: Edge function `hub-linha-editorial`

**Files:**
- Create: `supabase/functions/hub-linha-editorial/handler.ts`, `supabase/functions/hub-linha-editorial/index.ts`
- Create: `supabase/functions/__tests__/hub-linha-editorial_test.ts`
- Modify: `supabase/config.toml` (add only `[functions.hub-linha-editorial] verify_jwt = false`)

**Interfaces:**
- Consumes: the Task 3 RPCs, `resolveHubToken`, `effectivePlanFeature`, `insertAuditLog`.
- Produces: `createHubLinhaEditorialHandler(deps: { buildCorsHeaders, createDb, now, rateLimit, auditLog })`. Copy the deps shape from `hub-post-references/handler.ts:24` plus `auditLog` as in `hub-agenda/handler.ts:37-38`.
- **GET** `?token=` → `{ linhas: HubLinha[] }`, where:

  ```ts
  type HubLinha = {
    id; periodo; status; enviada_at; decidida_at; rodada;
    itens: { id; data; tipo; titulo; direcao; valores }[];
    colunas: { id; nome; tipo; config; ordem }[];
    respostas: { id; item_id; acao; comentario; is_workspace_user; created_at }[];
  }
  ```

  - Linhas: status in enviada, ajustes or aprovada, with `periodo` between the first of (current month − 3) and the first of (current month + 3).
    - The current month comes from `deps.now()` through `Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo'})`, never `Date#getMonth()`, because the edge runtime is UTC.
  - Items: ordered by `data` nulls last, then `ordem`.
  - Columns: only `visivel_cliente`. `oculta` only hides a column from the CRM table, per spec §4.2. `valores` keys outside the visible columns are stripped.
  - GET is `hub-read` at 300/300, the same as `hub-posts/handler.ts:101-103`.
  - Respostas: current `rodada` only.
- **POST** `{token, linha_id, acao, item_id?, comentario?}` → `{ ok: true, status? }`.
  - `linha_id` and `item_id` are validated as uuids, and `acao` against its enum, before any RPC call. Either failure is a 400.
  - Errors map to 404 (`nao_encontrada`), 409 (`status_invalido`) and 422 (`comentario_obrigatorio`, empty comment).
  - Generic bodies `{error: 'Não foi possível concluir. Tente novamente.'}`.
- Uses explicit `select('col, col')` lists only.

- [ ] **Step 1: Write the tests.** Use `createSupabaseQueryMock` as in `hub-media-notes_test.ts`:
  - `bad token debits hub-badtoken only`.
  - `GET debits hub-read`.
  - `POST debits only hub-write:hub-linha-editorial at 60/3600`.
  - `flag off returns 403 feature_disabled`.
  - `GET strips hidden columns and never returns post_id, enviada_por, convertido_por, created_by, author_user_id, token`.
  - `GET excludes rascunho`: assert on the recorded `.in('status', …)` modifier, because the mock records calls but doesn't filter.
  - `GET scopes by the token's conta and cliente`: the recorded `.eq` calls carry the token's ids.
  - `invalid uuid or acao returns 400 without calling the RPC`.
  - `POST another client's linha returns 404`, with the RPC called with the token's conta and cliente and never the body's.
  - `decision calls create_linha_notification after the RPC, and a notification failure still returns 200`.
  - `decision writes audit log`.
  - `comentario over 2000 chars returns 422`.
  - `OPTIONS returns CORS`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** `handler.ts` and `index.ts`. `index.ts` wires the real deps the way `hub-post-references/index.ts` does.
- [ ] **Step 4: Run** the deno test and `npm run check:functions`. Expected: pass, and `deno.lock` is clean.
- [ ] **Step 5: Commit** `feat(linha): hub-linha-editorial edge function`.

### Task 6: CRM store and pure helpers

**Files:**
- Create: `apps/crm/src/store/linhaEditorial.ts`, and export it from `apps/crm/src/store/index.ts`
- Create: `apps/crm/src/pages/entregas/linha/linhaLogic.ts`
- Create: `apps/crm/src/pages/entregas/linha/buildPostsFromItens.ts`
- Test: `apps/crm/src/pages/entregas/linha/__tests__/linhaLogic.test.ts`, `…/__tests__/buildPostsFromItens.test.ts`, `apps/crm/src/store/__tests__/linhaEditorial.test.ts`

**Interfaces:**
- Types in `store/linhaEditorial.ts`:
  - `LinhaStatus`
  - `LinhaColunaTipo = 'text'|'number'|'select'|'multiselect'|'date'|'person'|'checkbox'|'url'`
  - `LinhaEditorial {id, conta_id, cliente_id:number, periodo:string, status, enviada_at, enviada_por, decidida_at, rodada}`
  - `LinhaColuna {id, nome, tipo, config:{options?:SelectOption[]}, visivel_cliente, oculta, ordem}`
  - `LinhaItem {id, linha_id, data:string|null, tipo:ContentFormat, titulo, direcao, valores:Record<string,unknown>, ordem, post_id:number|null}`
  - `LinhaResposta {id, linha_id, item_id, acao, comentario, rodada, is_workspace_user, author_user_id, created_at}`
- Store functions, all plain async throwing the Supabase error:
  - `listLinhasDoMes(periodo): Promise<LinhaEditorial[]>`
  - `listItens(linhaId): Promise<LinhaItem[]>`
  - `listColunas(): Promise<LinhaColuna[]>`
  - `listRespostas(linhaId): Promise<LinhaResposta[]>`
  - `criarLinha(clienteId, periodo): Promise<string>`
  - `addItem(linhaId, patch): Promise<LinhaItem>`
  - `updateItem(id, patch): Promise<void>`
  - `deleteItem(id): Promise<void>`
  - `reorderItens(ids: string[]): Promise<void>`
  - `addColuna(input): Promise<LinhaColuna>`
  - `updateColuna(id, patch): Promise<void>`
  - `excluirColuna(id): Promise<void>`
  - `enviarLinha(id)`, `recolherLinha(id)`
  - `responderComentario(linhaId, itemId|null, texto)`
  - `converterItens(linhaId, workflowId|null, posts: ConverterPostPayload[]): Promise<{item_id:string; post_id:number}[]>`
  - `getOrigemDoPost(postId): Promise<{linha: LinhaEditorial; item: LinhaItem} | null>`
  - `listPostsDaLinha(postIds: number[]): Promise<LinhaPost[]>`, where `LinhaPost = {id, status, custom_status_id, titulo, workflow_id, workflow_titulo}`. It selects `id, status, custom_status_id, titulo, workflow_id, workflows(titulo)` under query key `['linha-posts', linhaId]`.
  - `listLinhasDoMes` embeds `linha_editorial_itens(count)` and a converted count, for the rail's "N posts" and "N de M em produção".
- In `store/posts.ts:110`, widen `WorkflowPost.created_via` to `'human' | 'agent' | 'linha_editorial'`. Grep for exhaustive switches over it.
- `linhaLogic.ts`:
  - `normalizeNome(s): string` (lowercase, NFD with accents stripped, trimmed)
  - `defaultNovaData(itens, periodo): string|null`
  - `formatBreakdown(itens): {tipo, n}[]`, in `TIPO_ORDER` order
  - `nomeFluxoPadrao(itens, periodo): string`
  - `mesLabel(periodo): string` ("novembro")
  - `periodoFromMes(mes 'YYYY-MM'): string`
- `buildPostsFromItens(itens, colunas, defs: TemplatePropertyDefinition[] | null): ConverterPostPayload[]`, with
  `ConverterPostPayload = {item_id; conteudo: JSONContent; conteudo_plain: string; property_values: {property_definition_id: number; value: unknown}[]}`.

- [ ] **Step 1: Write the tests.**
  - `defaultNovaData`:
    - returns `'2026-11-19'` after `'2026-11-18'`;
    - `defaultNovaData returns null past month end` (last row `'2026-11-30'` gives null);
    - with no dated rows it returns `'2026-11-01'`.
  - `nomeFluxoPadrao`: six reels give `'Reels de novembro'`, and mixed formats give `'Linha de novembro'`.
  - `buildPostsFromItens`:
    - direction lines become paragraphs under a bold "Direção do conteúdo";
    - an unmapped Pilar becomes the bullet `Pilar: Educação`;
    - Pilar maps to definition "pilar" (accent and case insensitive) with option id by label;
    - a missing select label falls back to the bullet;
    - a URL bullet carries a link mark;
    - empty values are skipped;
    - `defs=null` puts every column in bullets;
    - orphan `valores` keys are ignored;
    - `conteudo_plain` equals the text of the doc joined by `\n`.
  - Store: `converterItens calls rpc linha_editorial_converter with p_linha_id, p_workflow_id, p_posts` (mock supabase as in existing store tests).
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** `npx vitest run apps/crm/src/pages/entregas/linha apps/crm/src/store/__tests__/linhaEditorial.test.ts`. Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): store and conversion payload builder`.

### Task 7: View plumbing in Entregas

**Files:**
- Modify:
  - `apps/crm/src/pages/entregas/viewQuery.ts`
  - `apps/crm/src/pages/entregas/EntregasPage.tsx` (VIEW_TABS filter, Vidro dropdown, skeleton map, render branch, hidden toggles, flag fallback)
  - `apps/crm/src/pages/entregas/components/VistasTabs.tsx` (`VIEW_ICONS.linha = <Table2/>`)
  - `apps/crm/src/pages/entregas/phone/EntregasPhoneHeader.tsx` (`PHONE_VIEWS`)
- Create: `apps/crm/src/pages/entregas/linha/LinhaEditorialView.tsx`, a placeholder export filled in by Task 8.
- Test: `apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts`, `apps/crm/src/pages/entregas/__tests__/entregasLinhaTab.test.tsx`

**Interfaces:**
- Produces:
  - `ActiveView` includes `'linha'`;
  - `EntregasViewState.mes?: string` (`viewQuery.ts:34`; `YYYY-MM`, only kept when `view=linha`);
  - `<LinhaEditorialView contaId clientes filterClientes mes onChange(q: {clientes?: number[]; mes?: string}) />`.

- [ ] **Step 1: Write the tests.**
  - `viewQuery`:
    - round-trips `view=linha&clientes=14&mes=2026-11`;
    - `mes` is dropped for `view=list`;
    - an invalid `mes=2026-13` is dropped.
  - `entregasLinhaTab`:
    - `tab hidden when flag off`;
    - `view=linha falls back to kanban when flag off` (only after features resolve, so no fallback while `features` is null);
    - `tab shown and renders LinhaEditorialView when flag on`;
    - `mode and entidade toggles hidden in linha view`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the changes listed above.
- [ ] **Step 4: Run** both test files plus the existing `apps/crm/src/pages/entregas/__tests__` suite. Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): Entregas view tab behind flag`.

### Task 8: Client rail, header and status actions

**Files:**
- Modify: `apps/crm/src/pages/entregas/linha/LinhaEditorialView.tsx`
- Create:
  - `apps/crm/src/pages/entregas/linha/LinhaClientRail.tsx`
  - `apps/crm/src/pages/entregas/linha/LinhaHeader.tsx`
  - `apps/crm/src/pages/entregas/linha/useLinhaQueries.ts`
- Create: `apps/crm/src/pages/entregas/linha/linha.css`. Every class starts with `linha-`, and it is imported from `LinhaEditorialView`, like `pages/ideias/ideiasPhone.css`. Do not add these rules to `app.css`.
- Test: `apps/crm/src/pages/entregas/linha/__tests__/LinhaEditorialView.test.tsx`

**Interfaces:**
- Consumes: the Task 6 store, `Cliente[]` from the page.
- Produces: `useLinhaQueries(periodo, linhaId)` → `{linhas, itens, colunas, respostas}` with query keys `['linha', periodo]`, `['linha-itens', linhaId]`, `['linha-colunas']` and `['linha-respostas', linhaId]`.
- Rail and status copy (spec §6.2):
  - status badges "Rascunho", "Enviada ao cliente", "Ajustes pedidos", "Aprovada";
  - "Sem linha neste mês" with "Criar";
  - month switcher labels "Mês anterior" and "Próximo mês".
- Header actions: rascunho or ajustes → "Colunas", "Enviar ao cliente"; enviada → "Colunas", "Link do Hub", "Recolher"; aprovada → "Colunas", and "Enviar de novo" in the overflow menu.
- "Link do Hub" copies `${window.location.origin}/${workspaceSlug}/hub/${compactHubToken(token)}/aprovacoes?aba=linha`. That is built inline, like `pages/entregas/hooks/useEntregasData.ts:283-286`. `compactHubToken` comes from `lib/hubLinks.ts`, and the token from `getHubToken(clienteId)` (`store/hub.ts:91`). With no token, the button is disabled with the tooltip "Gere o link do Hub na página do cliente."
- The enviada banner reads "O cliente vê as alterações ao abrir o Hub."

- [ ] **Step 1: Write the tests.**
  - `rail sorts clients with linha first then alphabetical`.
  - `Criar calls criarLinha with periodo 2026-11-01 and selects the client`.
  - `Enviar ao cliente disabled with zero rows`.
  - `enviada shows Recolher and the banner`.
  - `month switch writes mes`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the view, rail, header and queries.
- [ ] **Step 4: Run the tests.** Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): client rail and header`.

### Task 9: Editable table, Colunas popover and comments panel

**Files:**
- Create:
  - `apps/crm/src/pages/entregas/linha/LinhaTable.tsx`
  - `apps/crm/src/pages/entregas/linha/LinhaCell.tsx`
  - `apps/crm/src/pages/entregas/linha/ColunasPopover.tsx`
  - `apps/crm/src/pages/entregas/linha/LinhaComentariosPanel.tsx`
  - `apps/crm/src/pages/entregas/linha/FormatoPill.tsx`, built from `TIPO_LABELS` and the colors in `postLabels.ts`
- Modify: `apps/crm/src/pages/entregas/linha/LinhaEditorialView.tsx` (mount the table and the comments panel)
- Test: `apps/crm/src/pages/entregas/linha/__tests__/LinhaTable.test.tsx`, `…/ColunasPopover.test.tsx`
- Converted rows render `PostStatusChip({post, registry})` (`components/PostStatusChip.tsx:24`) from `listPostsDaLinha` plus `useStatusRegistry`.
- The "Direção do conteúdo" hide preference is stored in `entregasPrefs.ts` (per conta, per browser) **(my call; spec §4.2 said per-workspace, and a server preference isn't worth a table here)**.

**Interfaces:**
- Consumes: the Task 6 store and logic, `PropertyValue` editors where the types match.
- Produces: `<LinhaTable linha itens colunas respostas selectedIds onSelect(ids) />`.
  - Cell saves go through `updateItem`, optimistic and wrapped in `trackUnsavedWork`.
  - Text inputs debounce at 400 ms.
- Copy:
  - "Nova linha", "Ordenar por data";
  - "Colunas da linha editorial", "Nova coluna", "Visível para o cliente", "Valem para todas as linhas da agência.";
  - a converted row's menu offers "Abrir post";
  - delete confirm on a converted row: "Excluir esta linha? O post criado a partir dela continua existindo."

- [ ] **Step 1: Write the tests.**
  - `Tab moves to next cell, Enter to the cell below`.
  - `titulo edit saves once after debounce`.
  - `Nova linha uses defaultNovaData`.
  - `converted row cells are read-only and show the post status chip`.
  - `converted rows have no selection checkbox`.
  - `comment count opens panel with item thread and rodada separator`.
  - `team reply calls responderComentario`.
  - `Nova coluna Seleção creates column with options`.
  - `name collision shows "Já existe uma coluna com esse nome."`, mapping 23505.
  - `Excluir coluna asks confirm then calls excluirColuna`.
  - `Direção do conteúdo toggle hides the column only`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the table, cells, popover, panel and format pill.
- [ ] **Step 4: Run the tests, then `npx vitest run apps/crm/src/__tests__/cssSplitBoundary.test.ts`.** Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): editable table, columns and comments`.

### Task 10: Selection bar and "Criar posts individuais"

**Files:**
- Create: `apps/crm/src/pages/entregas/linha/LinhaSelectionBar.tsx`, `apps/crm/src/pages/entregas/linha/CriarPostsDialog.tsx`
- Modify: `apps/crm/src/pages/entregas/linha/LinhaEditorialView.tsx` (mount the bar and the dialog)
- Test: `apps/crm/src/pages/entregas/linha/__tests__/CriarPostsDialog.test.tsx`

**Interfaces:**
- Consumes:
  - `buildPostsFromItens(…, null)` and `converterItens(linhaId, null, …)`;
  - `applyPostProcess` (`store/postProcesses.ts:319`) with `buildApplyPlan` and `buildTemplateFingerprint`, as `NewAvulsoDialog.tsx:124-160` does;
  - `mapEntitlementError`.
- Produces: `<LinhaSelectionBar itens selected linhaStatus onCriarFluxo onCriarPosts onLimpar />`.
  - It confirms first when `linhaStatus !== 'aprovada'`: "Esta linha ainda não foi aprovada pelo cliente. Criar mesmo assim?"
  - The dialog title is "Criar N posts individuais".
  - Options "Sem processo" and "Um processo por formato" show only when `feature_post_processes` is on. Template selects list only `modo_prazo === 'padrao'`.
  - Toasts: "N posts criados" with the action "Ver posts" (navigates `view=list&entidade=posts&clientes=<id>`); and "N posts criados. M sem processo: aplique pelo post."

- [ ] **Step 1: Write the tests.**
  - `bar shows breakdown "6 reels"`.
  - `not-approved linha asks confirm`.
  - `process options hidden when feature_post_processes off`.
  - `only padrao templates listed`.
  - `applies process per format sequentially and continues after template_changed`.
  - `plan limit error toast uses mapEntitlementError`.
  - `success invalidates linha-itens`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the bar and the dialog.
- [ ] **Step 4: Run the tests.** Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): selection bar and bulk avulso posts`.

### Task 11: "Criar fluxo" through NewWorkflowWizard

**Files:**
- Modify: `apps/crm/src/pages/entregas/wizard/NewWorkflowWizard.tsx`, `apps/crm/src/pages/entregas/wizard/steps/StepBasics.tsx`, `apps/crm/src/pages/entregas/wizard/steps/StepReview.tsx`
- Modify: `apps/crm/src/pages/entregas/linha/LinhaEditorialView.tsx` (mount the wizard)
- Test: `apps/crm/src/pages/entregas/wizard/__tests__/wizardSeed.test.tsx`

**Interfaces:**
- Produces a new optional prop:

  ```ts
  seed?: {
    clienteId: number;
    nome: string;
    origemLabel: string; // "linha editorial de novembro"
    itens: LinhaItem[];
    afterCreate: (workflow: Workflow) => Promise<void>;
  }
  ```

  - With a seed: the client is preset and locked in O básico, the name is preset, and a banner reads "N posts vêm da {origemLabel}".
  - StepReview lists the items: date, `FormatoPill`, title, first line of direction. There are no per-post deadlines.
  - The create button reads "Criar fluxo com N posts".
  - `handleCreate` awaits `seed.afterCreate(result.workflow)` between `createWorkflowFromWizard` and `onCreated()`. On a throw it calls `removeWorkflow(result.workflow.id)` and rethrows into the existing catch, so the dialog stays open. A saved template is kept.
  - With a seed, the success toast (`NewWorkflowWizard.tsx:206`) moves after `afterCreate` and reads "Fluxo criado com N posts". Without a seed it is unchanged.
- The view's `afterCreate`: `getPropertyDefinitions(workflow.template_id)` when non-null, then `buildPostsFromItens`, then `converterItens(linha.id, workflow.id, …)`.

- [ ] **Step 1: Write the tests.**
  - `seed locks client and presets name`.
  - `review lists seeded posts without deadlines`.
  - `afterCreate called with created workflow before onCreated`.
  - `converter failure removes workflow and keeps wizard open`.
  - `success toast fires after afterCreate`.
  - `no seed keeps current behavior` (the existing wizard tests still pass).
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the seed prop and the view's `afterCreate`.
- [ ] **Step 4: Run** the tests and `apps/crm/src/pages/entregas/wizard/__tests__`. Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): create fluxo from linha via wizard seed`.

### Task 12: Post shows its origin

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (desktop drawer area near the Título and Status fields, and the phone grouped list)
- Create: `apps/crm/src/pages/entregas/linha/PostOrigemLinha.tsx`
- Test: `apps/crm/src/pages/entregas/linha/__tests__/PostOrigemLinha.test.tsx`

**Interfaces:**
- Consumes: `getOrigemDoPost(postId)` and `listRespostas`.
- Produces: `<PostOrigemLinha postId />`, which renders nothing when the flag is off or there is no origin. Otherwise it shows:
  - the chip "Da linha editorial de {mês}", linking to `/entregas?view=linha&clientes=<id>&mes=YYYY-MM`;
  - the section "Comentários do cliente na linha editorial" with that item's client respostas.
- Query key `['linha-origem', postId]`, with `staleTime` 60 s.

- [ ] **Step 1: Write the tests.**
  - `renders nothing without origin`.
  - `renders chip and client comments`.
  - `hidden when flag off`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the component and mount it in both editor layouts.
- [ ] **Step 4: Run** the tests and the existing `PostEditorBody` tests. Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): show linha origin in the post editor`.

### Task 13: CRM notification types

**Files:**
- Modify:
  - `apps/crm/src/store/notifications.ts:3`
  - `apps/crm/src/lib/notification-catalog.ts` (category `aprovacoes_hub`, `emailEligible: true`)
  - `apps/crm/src/lib/notification-config.ts:142`
  - `supabase/functions/_shared/notification-email.ts` (lines ~21 and ~79)
- Test: create `apps/crm/src/lib/__tests__/notification-config.linha-editorial.test.ts`, and extend `supabase/functions/__tests__/notification-email_test.ts`.

- [ ] **Step 1: Write the tests.**
  - The display for `linha_editorial_aprovada` with metadata `{cliente_nome:'Dr. Rafael Lima', periodo:'2026-11-01', comentarios:2}` has title "Dr. Rafael Lima aprovou a linha editorial de novembro" and body "2 comentários".
  - `linha_editorial_ajustes` has title "Dr. Rafael Lima pediu ajustes na linha editorial de novembro".
  - Both are in `EMAIL_ELIGIBLE_TYPES`.
  - The e-mail labels are "Linha aprovada" (success) and "Ajustes na linha" (warning).
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the entries in all four files.
- [ ] **Step 4: Run** vitest on those tests, the deno test and `check:functions`. Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): notification types in CRM and email digest`.

### Task 14: Hub "Linha editorial" tab

**Files:**
- Modify:
  - `apps/hub/src/api.ts` (`fetchLinhas(token)`, `submitLinhaAcao(token, body)`, using the existing `get`/`post` helpers)
  - `apps/hub/src/queries.ts` (`hubLinhasQuery(token)`, key `['hub-linhas', token]`)
  - `apps/hub/src/types.ts` (`HubLinha`, mirroring Task 5)
  - `apps/hub/src/hooks/usePendingApprovalsCount.ts`: it gains a `featureLinha: boolean` parameter and adds enviada linhas when true. Update both callers, `apps/hub/src/shell/HubSidebar.tsx:28` and `apps/hub/src/shell/HubMobileNav.tsx:29` (pass `bootstrap.feature_linha_editorial === true`), and `apps/hub/src/hooks/__tests__/usePendingApprovalsCount.test.tsx`, which needs a `fetchLinhas` mock.
  - `apps/hub/src/pages/AprovacoesPage.tsx` (tabs by `?aba=linha`, only when the flag is on)
  - `apps/hub/src/main.tsx` (register the `hubLinha` namespace)
- Create:
  - `apps/hub/src/pages/aprovacoes/LinhaEditorialTab.tsx`
  - `apps/hub/src/pages/aprovacoes/LinhaCard.tsx`
  - `apps/hub/src/pages/aprovacoes/linhaWeeks.ts`
  - `packages/i18n/locales/pt/hubLinha.json`, `packages/i18n/locales/en/hubLinha.json`
- Test: `apps/hub/src/pages/__tests__/linhaEditorialTab.test.tsx`, `apps/hub/src/pages/aprovacoes/__tests__/linhaWeeks.test.ts`, plus `apps/hub/src/hooks/__tests__` for the badge.

**Interfaces:**
- `groupByWeek(itens, periodo): {label: string; itens: HubLinhaItem[]}[]`. Weeks run Sunday to Saturday, labelled "Semana de 2 a 8 de novembro", with undated items last under "Sem data".
- Copy (pt keys in `hubLinha.json`):
  - tabs "Posts · {n}" and "Linha editorial · {n}";
  - "Este é o plano do mês: temas, formatos e datas. Os posts prontos chegam depois, para você aprovar um a um.";
  - "Comentar", "Seu comentário", "Salvar comentário", "{n} comentários na linha", "Pedir ajustes", "Aprovar linha editorial";
  - "Aprovada em {data}", "Ajustes pedidos em {data}", "Anteriores";
  - the empty state "Nenhuma linha editorial para aprovar.";
  - the required-comment prompt for ajustes, "Conte o que precisa mudar.".
- Styling uses the hub classes `.hub-card`, `.hub-pill`, `.hub-btn-primary/secondary`, and the `useHubLook()` pauta branch. No Tailwind variants on `hub-*`.

- [ ] **Step 1: Write the tests.**
  - `groupByWeek`: Nov 2026 items on 3, 4, 6, 9 and 30, plus a null date, give 4 groups plus "Sem data", and the first label is "Semana de 1 a 7 de novembro".
  - Tab:
    - `tabs hidden when flag off`;
    - `aba=linha selects tab`;
    - `Comentar posts acao comentario with item_id`;
    - `Pedir ajustes without comments requires text`;
    - `Aprovar posts acao aprovado and shows Aprovada em`;
    - `decided linha is read-only`;
    - `pauta look renders`.
  - Badge: `badge adds enviada linhas when flag on`, and `ignores linhas when flag off`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the API helpers, query, tab, card, week grouping and i18n.
- [ ] **Step 4: Run** `npx vitest run apps/hub` and the i18n `locales.test.ts`. Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): hub approval tab`.

### Task 15: CRM phone read view

**Files:**
- Create: `apps/crm/src/pages/entregas/linha/LinhaPhoneView.tsx`, rendered by `LinhaEditorialView` under `useIsPhoneEditor()`-style width detection (follow how other Entregas views branch on phone)
- Test: `apps/crm/src/pages/entregas/linha/__tests__/LinhaPhoneView.test.tsx`

**Interfaces:** client list, then item cards (date, `FormatoPill`, title, direction, comment count), status, and "Enviar ao cliente". Edit and convert affordances are replaced by the note "Edite a linha no computador."

- [ ] **Step 1: Write the tests.** `phone shows cards and no edit controls` and `Enviar ao cliente works on phone`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the phone view.
- [ ] **Step 4: Run the tests.** Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): phone read view`.

### Task 16: Client e-mail digest includes sent linhas

**Files:**
- No migration. `claim_client_event_emails` (`20260904000001_client_event_emails.sql:130-157`) returns eligible *clientes*, and the handler loads content per client, so the claim stays as it is.
- Modify: `supabase/functions/client-event-email-cron/handler.ts`, `supabase/functions/_shared/client-event-email.ts`
- Test: `supabase/functions/__tests__/client-event-email-cron_test.ts`, `supabase/functions/__tests__/client-event-email_test.ts` (extend)

**Interfaces:**
- In the handler's per-client loop (`handler.ts:385-417`), after the existing content queries:
  - When `effectivePlanFeature(db, row.conta_id, 'feature_linha_editorial')` is true, query with the service role:

    ```
    linhas_editoriais(id, periodo, enviada_at) where cliente_id = row.id and status = 'enviada'
      and enviada_at > <the same lower bound the approvals query uses> and enviada_at <= row.event_claim_through
    ```

  - Add `linha:<id>:<enviada_at>` to `buildClientEventIdempotencyKey` (`:579-583`).
  - Count linhas in the `skippedNoContent` check (`:536-540`).
  - Pass `linhas` to `buildClientEventEmail`.
- The item copy is "Linha editorial de {mês} aguardando sua aprovação", linking to the Hub `/aprovacoes?aba=linha`.

- [ ] **Step 1: Write the tests.**
  - `digest includes linha sent in window`.
  - `linha outside window ignored`.
  - `flag off skips linha query`.
  - `client with only a linha is not skipped as no content`.
  - `idempotency key changes when a linha is re-sent`.
  - `email renders linha item with hub link`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the handler and the shared e-mail builder.
- [ ] **Step 4: Run** the suites and `check:functions`. Expected: pass.
- [ ] **Step 5: Commit** `feat(linha): client digest lists linhas awaiting approval`.

### Task 17: Full verification

- [ ] **Step 1:** Run `npm run lint`, `npm run format:check`, and the four `tsc` calls: `npx tsc -p apps/crm/tsconfig.json --noEmit`, the same for hub and admin, and `npx tsc -p tsconfig.scripts.json`. Then `npm run test`, `npm run coverage:check` (the floor is functions 54, branches 72), `npm run check:functions`, `npm run test:functions` and `npm run test:db` (colima). Expected: all green, and `git status` clean apart from intended files.
- [ ] **Step 2: Browser check** against the local stack with the flag overridden on for the seed workspace (memory `reference_seed_login_browser_verification`, `reference_local_browser_verify_stub_edge_functions`):
  1. Create a linha, add 6 reels and 6 carrosséis, add a column, send.
  2. Open the Hub, comment and approve.
  3. Check the CRM notification.
  4. Convert the reels via "Criar fluxo" and the carrosséis via "Criar posts individuais".
  5. Open a post and check the origin chip and comments.
  6. Delete one post and check its row frees.

  Take screenshots of the table, the Hub tab and post origin.
- [ ] **Step 3:** Write the rollout notes in the PR body, in spec §9 order:
  1. migrations to staging, then prod;
  2. `hub-linha-editorial` with `--no-verify-jwt`;
  3. `hub-bootstrap`;
  4. the eight `FEATURE_COLUMNS` importers, only after the column exists;
  5. `notification-email-cron` and `client-event-email-cron`;
  6. merge.

  Then turn on a workspace override for the pilot.
