# Platform-agnostic posts — P1: board platforms + `post_targets` foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Boards, templates and clients declare which platforms they produce for.
- Every post gets one `post_targets` row per destination.
- `workflow_posts.platform` becomes a derived value that can now be `other`, meaning no Instagram and no TikTok destination.
- Nothing that publishes or automates Instagram ever picks up a post with `platform = 'other'`.

**Architecture:**
- **Three migrations:**
  1. `plataformas` columns
  2. `post_targets` with backfill, seed/derive/legacy-mapping triggers and a wider `platform` CHECK
  3. Copy-forward of four ICA functions with Instagram-based predicates
- **Write paths:**
  - The existing `PlatformSelector` keeps writing `workflow_posts.platform`. A guarded trigger turns those writes into destination rows.
  - Board and template platform lists come from a new `PlatformChips` component.
- **Server-side guard:** `validateForScheduling` refuses `other` posts, which covers the CRM schedule endpoint and hub-approve auto-schedule. The CRM also hides the schedule button for them.

**Tech Stack:** Postgres (plpgsql triggers, RLS), psql entitlement suites, Deno edge functions, React 19 + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md`. **Depends on P0** (the `@mesaas/platforms` registry must already be merged).

## Deliberate deviations from the spec (for reviewers)

1. **`mark_target_*` RPCs, `recompute_post_publish_status` and `post_targets_resolved` move to P2/P4.** Those are the phases that first call or read them. P1 has no caller, so shipping them here would be dead code with a grant surface.
2. **Destinations are not validated against the board, except Instagram on the legacy write path.**
   - `PlatformSelector` (legacy path) lets TikTok-plan users pick TikTok on any board today, and a DB rejection would break that until every board lists TikTok. So TikTok is not checked.
   - Instagram *is* checked in the legacy mapping trigger (`a2`): the Stories self-heal writes `platform = 'instagram'`, and without the check it would add an Instagram destination to a TikTok-only board.
   - The UI restricts everything else (P2 editor). Removing a platform from a board never touches existing destinations.
3. **`workflow_templates.plataformas` is saved with a direct `UPDATE`** after `update_workflow_template`, not by copying that 250-line RPC forward. Templates are workspace-editable under RLS, and a failure there only loses the platform list, which the next save rewrites.
4. **Every existing client gets `clientes.plataformas_padrao = '{instagram}'`**, not a value derived from connected accounts. Clients without connected accounts produce Instagram content today, and flipping them to Geral would change their posts avulsos silently.
5. **TikTok captions are not copied into `post_targets.caption` in P1.** `tiktok_caption` stays the source until P4 moves the TikTok publisher. Destination status stays `pendente` for Instagram/TikTok rows until P4/P5; the per-platform publish state is still read from the legacy columns.
6. **The `validateForScheduling` guard for `other` is pulled forward from P3.** P1 already creates `other` posts, and without the guard an approved one could be moved to `agendado` with nothing ever claiming it.
7. **No board backfill.** Every existing board starts at the column default `{instagram}`, including boards that already hold TikTok or `both` posts (user decision in the final P1 review). Those legacy posts keep their TikTok destination through the `post_targets` backfill in migration B, which does not read the board; TikTok is not checked against the board (deviation 2), so the `PlatformSelector` keeps working on them.
8. **Post Express is always Instagram.** An Express post is an avulso, but it never reads `clientes.plataformas_padrao`: the seed (`post_seed_targets(..., p_is_express)` in `z4b` and the same rule in `z6`) is exactly `{instagram}`, because "Publicar agora" publishes to Instagram. Without this a `{geral}` client made Express posts `other` and a `{tiktok}` client made them TikTok.
9. **P1 has no dead end into `other`** (the Destinos editor arrives in P2 and `PlatformSelector` hides for `other`):
   - `a2`: a legacy write of `instagram`, `tiktok` or `both` that would leave the post with neither Instagram nor TikTok (Instagram on a TikTok-only board, TikTok on a stories post) is a no-op: targets stay and `platform` is re-derived from them. An explicit `other` write still removes both (no UI writes it).
   - `z8` (`AFTER UPDATE OF workflow_id`): a post with no Instagram/TikTok target that changes board (moved, attached, detached) gets the new board's Instagram/TikTok entries (TikTok never on stories) and `platform` is re-derived. A move never removes destinations.
   - `post_targets_sync_platform` also fires on `UPDATE OF post_id` and re-derives both the old and the new post.
10. **Review fixes outside the original task list.** Migration `20261010100004_move_new_flow_platforms.sql` copies `move_posts_to_new_flow` forward so the new board inherits the source's `plataformas` (it defaulted to `{instagram}`, and `z8` then gave Geral posts an Instagram destination). `a2` also ignores legacy `platform` writes on Express posts, and `PlatformSelector` hides for them (sections 10 and 11 of `99_post_targets.sql`).
11. **Feature flag `feature_multiplatform` (added 2026-10-08 on request).** P1 ships dark, the same way `feature_agenda` did.
   - Migration `20261010100007_feature_multiplatform.sql` adds `plans.feature_multiplatform boolean NOT NULL DEFAULT false` and an `a0` BEFORE INSERT/UPDATE trigger on `workflows.plataformas`, `workflow_templates.plataformas` and `clientes.plataformas_padrao`. Without the flag (`effective_plan_feature`) any value other than `{instagram}` raises `feature_disabled:feature_multiplatform`. An UPDATE is checked only when the column's value changes. A copy (`duplicate_workflow`, `move_posts_to_new_flow`) of a non-`{instagram}` board in a workspace that lost the flag raises too; accepted for the pilot.
   - Flag off: every board is `{instagram}`, so the `post_targets` triggers behave as before P1 and the per-post `PlatformSelector` (TikTok) keeps working through `a2`.
   - CRM: `usePlatformChipsVisible(value)` gates the field in the wizard, Editar fluxo, Templates and Editar cliente. Hidden without the flag unless the value is already not `{instagram}` (so a workspace that lost the flag can go back). The wizard ignores a template's `plataformas` and creates `{instagram}` without the flag.
   - Registered in `FEATURE_COLUMNS`, the Admin `api.ts` mirror (type, keys, label "Plataformas por fluxo"), `useWorkspaceLimits` and `entitlement-errors.ts`. Section 14 of `99_post_targets.sql` covers the flag off; sections 1-13 turn it on inside their own transaction.
   - Enable per workspace: Admin override `{"feature_multiplatform": true}`. Launch = turn the plan columns on.
   - Not flagged: the Express pin (deviation 8) and P0's neutral format labels (#605).

## Global Constraints

- **Branch:** a new branch off fresh `origin/main` after P0 is merged: `claude/platform-agnostic-p1`. Run `git fetch origin main && git checkout -b claude/platform-agnostic-p1 origin/main`.
- **Migration versions:**
  - Use `20261010100001`, `20261010100002`, `20261010100003` and `20261010100004` (the last one added in review, deviation 10).
  - Renumbered on 2026-10-05 from `20260929100001..4` to sit above main's tail (`20261004000001`). `20261010100005` (`duplicate_workflow` keeps `plataformas`) and `20261010100006` (`_clone_post_row` keeps the source post's destinations) were added in the same rebase sync.
  - Renumbered again on 2026-10-08 from `20261005100001..6` to `20261010100001..6` (`20261010100007`, the flag, was added the same day), above main's tail at the time (`20261009000002`). None of main's migrations from `20261003000001` to `20261009000002` touch the objects P1 copies forward.
  - Before `gh pr create`, run `ls supabase/migrations | tail -5`. If main has anything at or above these numbers, renumber above main's tail. Every version prefix must be unique.
- **Allowed values:**
  - Platform ids stored in SQL: exactly `'instagram'`, `'tiktok'`, `'geral'` (the registry's `PLATFORM_IDS`).
  - Derived `workflow_posts.platform`: `'instagram' | 'tiktok' | 'both' | 'other'`.
  - `post_targets.status` values: `'pendente','agendado','processando','publicado','falha','disponivel'`.
- **Every new SECURITY DEFINER function:**
  - declares `SET search_path = public, pg_temp`;
  - is followed by `REVOKE ALL ON FUNCTION … FROM public, anon, authenticated;`. Trigger functions get no GRANT: triggers fire without EXECUTE.
- **Recursion guard:** GUC `app.post_targets_sync`. Set it with `set_config('app.post_targets_sync','on', true)`, restore the previous value afterwards, and test it with `current_setting('app.post_targets_sync', true) = 'on'`.
- **New `clientes` column:** it must be added to three places or the CRM cannot see it:
  - the column-level `GRANT SELECT (…)` (re-declared in full);
  - `clientes_v`, appended **last**;
  - `CLIENTE_SAFE_COLUMNS` in `apps/crm/src/store/clients.ts`.
- **Migrations A and B start with `SET LOCAL lock_timeout = '5s';`** (they take ACCESS EXCLUSIVE on `workflows`, `clientes` and `workflow_posts`). The Supabase CLI runs each migration file in its own transaction, so it lasts until the end of the file (checked empirically on `db reset`).
- No em dashes in new user-facing copy.
- **Gates before pushing:**
  - `npm run lint`, `npm run format:check`
  - the four `tsc` commands
  - `npm run test`, `npm run check:functions`, `npm run test:functions`
  - `bash scripts/test-entitlements.sh` against a local Supabase (colima). Never commit per-worktree port overrides in `supabase/config.toml`.
- **Deploy order (merge deploys the frontend instantly):**
  1. `npx supabase db push --linked` on staging.
  2. Deploy `instagram-publish`, `hub-approve` and `tiktok-publish` (they bundle `_shared/instagram-publish-utils.ts`), each with `--use-api --no-verify-jwt` where it already uses that flag.
  3. Smoke on staging.
  4. Repeat steps 1-3 on prod.
  5. Merge.

---

### Task 1: Migration A: `plataformas` on workflows, templates and clientes

**Files:**
- Create: `supabase/migrations/20261010100001_board_platforms.sql`
- Test: `supabase/tests/entitlements/99_post_targets.sql` (created here, extended in Tasks 2-3)

**Interfaces:**
- Produces these columns:
  - `workflows.plataformas text[] NOT NULL DEFAULT '{instagram}'`
  - `workflow_templates.plataformas text[] NOT NULL DEFAULT '{instagram}'`
  - `clientes.plataformas_padrao text[] NOT NULL DEFAULT '{instagram}'`, readable by `authenticated` and exposed as the last column of `clientes_v`
- Each column's CHECK: `cardinality(x) >= 1 AND x <@ ARRAY['instagram','tiktok','geral']`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/entitlements/99_post_targets.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Plataformas por quadro + post_targets (migrations 20261010100001..3).
-- Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md

-- 1. Colunas plataformas: default, CHECK e allowlist de clientes
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
  v_arr text[]; v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W', 'ativo') returning id into v_wf;

  select plataformas into v_arr from workflows where id = v_wf;
  assert v_arr = array['instagram'], format('workflows.plataformas default: %s', v_arr);
  select plataformas_padrao into v_arr from clientes where id = v_cli;
  assert v_arr = array['instagram'], format('clientes.plataformas_padrao default: %s', v_arr);

  v_rejected := false;
  begin update workflows set plataformas = '{}' where id = v_wf;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflows.plataformas vazio foi aceito';

  v_rejected := false;
  begin update workflows set plataformas = array['youtube'] where id = v_wf;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflows.plataformas com youtube foi aceito';

  v_rejected := false;
  begin insert into workflow_templates (user_id, conta_id, nome, etapas, plataformas)
    values (v_uid, v_ws, 'T', '[]'::jsonb, array['instagram','x']);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflow_templates.plataformas invalido foi aceito';

  update workflows set plataformas = array['instagram','geral'] where id = v_wf;

  -- authenticated le a coluna nova direto e pela view
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select plataformas_padrao into v_arr from clientes where id = v_cli;
  assert v_arr = array['instagram'], 'authenticated nao le clientes.plataformas_padrao';
  select plataformas_padrao into v_arr from clientes_v where id = v_cli;
  assert v_arr = array['instagram'], 'clientes_v nao expoe plataformas_padrao';
end $$;
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/entitlements/99_post_targets.sql`. Start the stack first with `npx supabase start`, using colima.
Expected: FAIL with `column "plataformas" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261010100001_board_platforms.sql`:

```sql
-- ============================================================
-- Plataformas por quadro, template e cliente (P1)
-- Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
-- Ids válidos = PLATFORM_IDS de supabase/functions/_shared/platform-registry.ts.
-- Plataforma nova = ampliar os três CHECKs abaixo e o de post_targets.platform.
-- ============================================================

-- ACCESS EXCLUSIVE em tabelas quentes (workflows, clientes): desiste em 5s em
-- vez de enfileirar todo o tráfego atrás do ALTER. Cada arquivo roda numa
-- transação no supabase CLI, então SET LOCAL vale até o fim deste arquivo.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS plataformas text[] NOT NULL DEFAULT '{instagram}';
ALTER TABLE public.workflows
  ADD CONSTRAINT workflows_plataformas_valid
  CHECK (cardinality(plataformas) >= 1
         AND plataformas <@ ARRAY['instagram','tiktok','geral']::text[]);

ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS plataformas text[] NOT NULL DEFAULT '{instagram}';
ALTER TABLE public.workflow_templates
  ADD CONSTRAINT workflow_templates_plataformas_valid
  CHECK (cardinality(plataformas) >= 1
         AND plataformas <@ ARRAY['instagram','tiktok','geral']::text[]);

-- Plataformas dos posts avulsos do cliente. Todos começam em Instagram: cliente
-- sem conta conectada produz conteúdo de Instagram hoje (spec, desvio 4 do plano).
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS plataformas_padrao text[] NOT NULL DEFAULT '{instagram}';
ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_plataformas_padrao_valid
  CHECK (cardinality(plataformas_padrao) >= 1
         AND plataformas_padrao <@ ARRAY['instagram','tiktok','geral']::text[]);

-- Sem backfill de quadros: todo quadro começa no default {instagram} (desvio 7
-- do plano). Post legado de TikTok mantém o destino TikTok pelo backfill de
-- post_targets (20261010100002), que não depende do quadro.

-- ---------- allowlist de SELECT de clientes (trio da armadilha 20260728000002)
-- Lista INTEIRA copiada de 20260904000001:23-28 (a mais recente) + plataformas_padrao.
REVOKE SELECT ON public.clientes FROM authenticated;
GRANT SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis,
  foto_url, send_event_email, event_email_unsub_at, plataformas_padrao
) ON public.clientes TO authenticated;

-- clientes_v: SELECT vigente copiado de 20260904000001:35-45, coluna nova
-- APENDADA POR ÚLTIMO (inserir no meio renomeia colunas por ordinal).
CREATE OR REPLACE VIEW public.clientes_v WITH (security_barrier = true) AS
  SELECT c.id, c.user_id, c.conta_id, c.nome, c.sigla, c.cor, c.plano,
         c.email, c.telefone, c.status, c.created_at, c.notion_page_url,
         c.data_pagamento, c.especialidade, c.data_aniversario, c.dia_entrega,
         c.auto_publish_on_approval, c.send_report_email, c.include_ai_analysis,
         CASE WHEN public.can_see_financials()
              THEN c.valor_mensal ELSE NULL END AS valor_mensal,
         c.foto_url,
         c.send_event_email, c.event_email_unsub_at,
         c.plataformas_padrao
  FROM public.clientes c
  WHERE c.conta_id = public.get_my_conta_id();
```

Before running it, confirm that no migration after `20260904000001` redefines the clientes grant or `clientes_v`:

```bash
grep -ln "clientes_v\|GRANT SELECT (" supabase/migrations/*.sql | sort | tail -3
```

If a newer file shows up, copy the lists from that file instead.

- [ ] **Step 4: Apply and run the test**

Run: `npx supabase db reset` (local only), then `psql … -f supabase/tests/entitlements/99_post_targets.sql`.
Expected: `ROLLBACK`, with no assertion errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261010100001_board_platforms.sql supabase/tests/entitlements/99_post_targets.sql
git commit -m "feat(db): plataformas em fluxos, templates e clientes"
```

---

### Task 2: Migration B: `post_targets`, backfill, triggers, `other`

> The SQL blocks below predate deviations 8 and 9 (Express, `a2` no-op, `z8`, sync on `post_id`, `lock_timeout`). `supabase/migrations/20261010100002_post_targets.sql` and sections 6-9 of `99_post_targets.sql` are the source of truth.

**Files:**
- Create: `supabase/migrations/20261010100002_post_targets.sql`
- Modify: `supabase/tests/entitlements/99_post_targets.sql` (append sections 2-4)

**Interfaces:**
- Consumes: the `plataformas` columns from Task 1.
- Produces:
  - Table `public.post_targets`, unique on `(post_id, platform)` and FK `(post_id, conta_id) → workflow_posts(id, conta_id) ON DELETE CASCADE`.
  - Helpers `post_board_platforms(workflow_id, cliente_id)`, `platform_from_targets(text[])`, `derive_post_platform(post_id)` and `post_seed_targets(workflow_id, cliente_id, platform, tipo, is_express)`.
  - Triggers `workflow_posts_z4b_platform_on_insert` (BEFORE INSERT), `workflow_posts_z6_seed_targets` (AFTER INSERT), `workflow_posts_a2_platform_to_targets` (BEFORE UPDATE OF platform), `workflow_posts_z7_stories_drop_tiktok` (AFTER UPDATE OF tipo), `workflow_posts_z8_board_move_seed_targets` (AFTER UPDATE OF workflow_id, deviation 9) and `post_targets_sync_platform` (on `post_targets`, INSERT/DELETE/UPDATE OF platform, post_id).
  - `workflow_posts.platform` CHECK widened to include `'other'`.
- Behaviour contract that later tasks and phases rely on:
  - **Insert.** A post gets one target per board platform. The board is `workflows.plataformas`, or `clientes.plataformas_padrao` when `workflow_id IS NULL`.
    - When the insert sets `platform` to `tiktok`, `both` or `other`, that value decides the Instagram/TikTok part.
    - A platform that doesn't support the post's `tipo` is dropped (`tiktok` for `stories`).
    - The derived `platform` is set BEFORE the row is written, so `.insert().select()` in the CRM (`store/posts.ts` `addWorkflowPost`) returns the right value.
  - **Tipo becomes `stories`.** The TikTok destination is removed and `platform` is re-derived.
  - **Derived platform.** After any target insert or delete, `platform` = `both` if Instagram and TikTok, else `instagram`, else `tiktok`, else `other`.
  - **Direct writes.** An `UPDATE workflow_posts SET platform = X` from outside the triggers adds or removes the Instagram/TikTok targets to match X and leaves other targets alone, with two exceptions:
    - Instagram is only added when the board lists Instagram (or the post already has it).
    - TikTok is never added to a `stories` post.
    - The stored `platform` is whatever the resulting targets derive to.
    - A requested `instagram`/`tiktok`/`both` that would leave neither Instagram nor TikTok is a no-op (deviation 9).
    - An out-of-domain value is left for the CHECK to reject.
  - **Express.** `is_express` posts are seeded with exactly `{instagram}` (deviation 8).
  - **Board change.** A post with no Instagram/TikTok target that changes `workflow_id` gains the new board's Instagram/TikTok entries (deviation 9).

- [ ] **Step 1: Append failing tests (sections 2-4)**

Append to `99_post_targets.sql`:

```sql
-- 2. Seed a partir do quadro, filtro de formato e platform derivado
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_cli_geral bigint;
  v_wf_ig bigint; v_wf_geral bigint; v_wf_mix bigint;
  v_p bigint; v_arr text[]; v_plat text;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor, plataformas_padrao)
    values (v_uid, v_ws, 'G', 'G', '#000', array['geral']) returning id into v_cli_geral;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'IG', 'ativo') returning id into v_wf_ig;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli_geral, 'Geral', 'ativo', array['geral']) returning id into v_wf_geral;
  -- terceiro cliente só para o quadro misto (não é limite de plano: 'start' permite 5 fluxos ativos por cliente)
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'M', 'M', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'Mix', 'ativo', array['instagram','tiktok','geral'])
    returning id into v_wf_mix;

  -- quadro só Instagram: igual a hoje
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_ig, v_ws, 'a', 'feed') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['instagram'] and v_plat = 'instagram',
    format('quadro IG: %s / %s', v_arr, v_plat);

  -- quadro só Geral: platform vira other
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_geral, v_ws, 'b', 'reels') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral'] and v_plat = 'other',
    format('quadro Geral: %s / %s', v_arr, v_plat);

  -- quadro misto, reels: três destinos, platform both
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_mix, v_ws, 'c', 'reels') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram','tiktok'] and v_plat = 'both',
    format('quadro misto reels: %s / %s', v_arr, v_plat);

  -- quadro misto, stories: TikTok não tem stories
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_mix, v_ws, 'd', 'stories') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('quadro misto stories: %s / %s', v_arr, v_plat);

  -- platform explícito manda na parte social (legado: testes e MCP que gravam platform)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf_ig, v_ws, 'e', 'reels', 'tiktok') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  assert v_arr = array['tiktok'], format('platform explicito: %s', v_arr);

  -- avulso usa clientes.plataformas_padrao
  insert into workflow_posts (workflow_id, cliente_id, conta_id, titulo, tipo)
    values (null, v_cli_geral, v_ws, 'f', 'feed') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral'] and v_plat = 'other', format('avulso geral: %s / %s', v_arr, v_plat);

  -- RETURNING do insert já traz o platform derivado (z4b é BEFORE INSERT)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_geral, v_ws, 'g', 'feed') returning platform into v_plat;
  assert v_plat = 'other', format('RETURNING platform: %s', v_plat);

  -- reels misto vira stories: TikTok sai, platform vira instagram
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_mix, v_ws, 'h', 'reels') returning id into v_p;
  update workflow_posts set tipo = 'stories' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('reels->stories misto: %s / %s', v_arr, v_plat);
end $$;
rollback;

-- 3. Escrita legada em workflow_posts.platform e escrita direta em post_targets
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint; v_wf_tt bigint;
  v_p bigint; v_p2 bigint; v_arr text[]; v_plat text; v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'W', 'ativo', array['instagram','geral']) returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf, v_ws, 'a', 'reels') returning id into v_p;

  -- PlatformSelector grava tiktok: IG sai, TikTok entra, Geral fica
  update workflow_posts set platform = 'tiktok' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','tiktok'] and v_plat = 'tiktok', format('-> tiktok: %s / %s', v_arr, v_plat);

  update workflow_posts set platform = 'both' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  assert v_arr = array['geral','instagram','tiktok'], format('-> both: %s', v_arr);

  update workflow_posts set platform = 'other' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral'] and v_plat = 'other', format('-> other: %s / %s', v_arr, v_plat);

  -- escrita direta em post_targets deriva platform
  insert into post_targets (conta_id, post_id, platform) values (v_ws, v_p, 'instagram');
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_plat = 'instagram', format('insert target ig: %s', v_plat);
  delete from post_targets where post_id = v_p and platform = 'instagram';
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_plat = 'other', format('delete target ig: %s', v_plat);

  -- 'both' legado num post de stories: TikTok não entra
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf, v_ws, 's', 'stories') returning id into v_p2;
  update workflow_posts set platform = 'both' where id = v_p2;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p2;
  select platform into v_plat from workflow_posts where id = v_p2;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('both em stories: %s / %s', v_arr, v_plat);

  -- quadro só TikTok: reels vira stories -> other; o auto-reparo do
  -- PlatformSelector grava 'instagram' e NÃO pode criar destino Instagram
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'T', 'T', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'TT', 'ativo', array['tiktok']) returning id into v_wf_tt;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_tt, v_ws, 't', 'reels') returning id into v_p2;
  select platform into v_plat from workflow_posts where id = v_p2;
  assert v_plat = 'tiktok', format('quadro TikTok: %s', v_plat);
  update workflow_posts set tipo = 'stories' where id = v_p2;
  select platform into v_plat from workflow_posts where id = v_p2;
  assert v_plat = 'other', format('TikTok->stories: %s', v_plat);
  update workflow_posts set platform = 'instagram' where id = v_p2;
  select platform into v_plat from workflow_posts where id = v_p2;
  assert v_plat = 'other', format('auto-reparo criou Instagram em quadro TikTok: %s', v_plat);
  assert not exists (select 1 from post_targets where post_id = v_p2), 'destino criado em quadro TikTok + stories';

  -- CHECKs
  v_rejected := false;
  begin insert into post_targets (conta_id, post_id, platform) values (v_ws, v_p, 'youtube');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'post_targets.platform youtube foi aceito';

  v_rejected := false;
  begin update post_targets set status = 'x' where post_id = v_p;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'post_targets.status invalido foi aceito';

  -- a2 deixa valor fora do domínio intacto; a CHECK recusa e o statement volta inteiro
  v_rejected := false;
  begin update workflow_posts set platform = 'geral' where id = v_p;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflow_posts.platform geral foi aceito (so other e valido)';

  -- post apagado leva os destinos
  delete from workflow_posts where id = v_p;
  assert not exists (select 1 from post_targets where post_id = v_p), 'destinos sobreviveram ao post';
end $$;
rollback;

-- 4. RLS e ACL de post_targets
begin;
-- post_targets fora da parity: o helper daria ALL (TRUNCATE incluso) e desfaria o REVOKE sob teste.
select et_grant_hosted_parity(array['post_targets']);
do $$
declare
  v_ws_a uuid; v_ws_b uuid; v_uid uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint; v_wf_a bigint; v_wf_b bigint; v_p_a bigint; v_p_b bigint;
  v_n int; v_rows int; v_rejected boolean;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws_a, 'owner'), (v_uid, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_uid, v_ws_a, v_cli_a, 'A', 'ativo') returning id into v_wf_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_uid, v_ws_b, v_cli_b, 'B', 'ativo') returning id into v_wf_b;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_a, v_ws_a, 'a') returning id into v_p_a;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_b, v_ws_b, 'b') returning id into v_p_b;

  assert not has_table_privilege('authenticated', 'public.post_targets', 'TRUNCATE'),
    'authenticated tem TRUNCATE em post_targets';
  assert not has_table_privilege('anon', 'public.post_targets', 'SELECT'),
    'anon le post_targets';
  assert not has_function_privilege('authenticated', 'public.post_targets_seed()', 'EXECUTE'),
    'authenticated executa post_targets_seed';
  assert not has_function_privilege('anon', 'public.workflow_posts_platform_to_targets()', 'EXECUTE'),
    'anon executa workflow_posts_platform_to_targets';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_n from post_targets;
  assert v_n = 1, format('esperava 1 destino visivel, veio %s', v_n);

  update post_targets set caption = 'x' where conta_id = v_ws_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'atualizou destino de outro workspace';

  v_rejected := false;
  begin insert into post_targets (conta_id, post_id, platform) values (v_ws_b, v_p_b, 'geral');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'inseriu destino com conta_id de outro workspace';

  -- post de B com conta_id de A: FK composta barra
  v_rejected := false;
  begin insert into post_targets (conta_id, post_id, platform) values (v_ws_a, v_p_b, 'geral');
  exception when foreign_key_violation then v_rejected := true; end;
  assert v_rejected, 'destino apontando post de outro workspace foi aceito';

  -- escrita no proprio workspace funciona (e deriva platform como authenticated)
  insert into post_targets (conta_id, post_id, platform) values (v_ws_a, v_p_a, 'geral');
end $$;
rollback;
```

Run the file. Expected: FAIL in section 2 with `relation "post_targets" does not exist`.

- [ ] **Step 2: Write the migration**

`supabase/migrations/20261010100002_post_targets.sql`:

```sql
-- ============================================================
-- post_targets: destinos de cada post (P1)
-- Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
--
-- P1: esta tabela é a fonte de QUAIS destinos um post tem (e da legenda dos
-- destinos que não são Instagram/TikTok). O estado de publicação de Instagram
-- e TikTok continua nas colunas legadas de workflow_posts até P4 (TikTok) e
-- P5 (Instagram); status aqui fica 'pendente' para essas linhas até lá.
--
-- workflow_posts.platform vira DERIVADO dos destinos:
--   instagram+tiktok -> both | instagram -> instagram | tiktok -> tiktok | resto -> other
-- 'other' é o que impede um post só Geral de casar com o claim do Instagram
-- (20260925000013:34) e com as automações de comentário (migration 3).
--
-- Triggers (GUC de recursão app.post_targets_sync):
--   z4b  BEFORE INSERT em workflow_posts: calcula platform ANTES de gravar, para
--        o RETURNING do insert do CRM já vir certo (e antes do z5 do trial).
--   z6   AFTER INSERT em workflow_posts: cria os destinos (GUC ligado).
--   a2   BEFORE UPDATE OF platform: o PlatformSelector atual grava platform;
--        traduz para destinos e devolve o platform derivado.
--   z7   AFTER UPDATE OF tipo: virou stories -> destino TikTok sai.
--   sync AFTER INSERT/DELETE/UPDATE OF platform em post_targets: recalcula platform.
-- Regras de destino (espelham supportsFormat do registro):
--   TikTok não tem stories; Instagram só entra se o quadro lista Instagram ou o
--   post já tem o destino (TikTok não é checado contra o quadro: legado, ver
--   desvio 2 do plano P1).
-- ============================================================

-- ---------- CHECK de platform ganha 'other' --------------------------------
-- A CHECK inline de 20260720000005:25-26 tem nome gerado; acha pelo corpo.
-- '(platform = ANY' não casa com '(tiktok_publish_status = ANY'.
DO $$
DECLARE r record; v_dropped int := 0;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.workflow_posts'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%(platform = ANY%'
  LOOP
    EXECUTE format('ALTER TABLE public.workflow_posts DROP CONSTRAINT %I', r.conname);
    v_dropped := v_dropped + 1;
  END LOOP;
  IF v_dropped <> 1 THEN
    RAISE EXCEPTION 'esperava 1 CHECK de platform em workflow_posts, achei %', v_dropped;
  END IF;
END $$;
ALTER TABLE public.workflow_posts
  ADD CONSTRAINT workflow_posts_platform_check
  CHECK (platform IN ('instagram','tiktok','both','other'));

-- ---------- tabela ----------------------------------------------------------
CREATE TABLE public.post_targets (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id      uuid   NOT NULL,
  post_id       bigint NOT NULL,
  platform      text   NOT NULL
                CHECK (platform IN ('instagram','tiktok','geral')),
  format        text,
  caption       text,
  title         text,
  settings      jsonb  NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at  timestamptz,
  status        text   NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente','agendado','processando','publicado','falha','disponivel')),
  external_id   text,
  permalink     text,
  error         text,
  error_code    text,
  retry_count   int    NOT NULL DEFAULT 0,
  processing_at timestamptz,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_targets_post_platform_uq UNIQUE (post_id, platform),
  -- FK composta tenant-safe (par workflow_posts_id_conta_uq, 20260820000002:18):
  -- o conta_id da linha é sempre o do post, então a RLS pode confiar nele.
  CONSTRAINT post_targets_post_same_tenant
    FOREIGN KEY (post_id, conta_id) REFERENCES public.workflow_posts (id, conta_id)
    ON DELETE CASCADE
);
CREATE INDEX post_targets_conta_idx ON public.post_targets (conta_id);

ALTER TABLE public.post_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY post_targets_workspace_all ON public.post_targets
  FOR ALL TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY post_targets_service_role ON public.post_targets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- O default ACL hospedado dá ALL em tabela nova; TRUNCATE ignora RLS. Revoga
-- tudo e re-concede só o necessário (mesmo formato de 20260925000030:405-413).
REVOKE ALL ON TABLE public.post_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.post_targets TO authenticated;
GRANT ALL ON TABLE public.post_targets TO service_role;

-- ---------- backfill (antes dos triggers: não pode reescrever platform) ----
INSERT INTO public.post_targets (conta_id, post_id, platform)
SELECT wp.conta_id, wp.id, p.platform
  FROM public.workflow_posts wp
 CROSS JOIN LATERAL unnest(
   CASE wp.platform WHEN 'both' THEN ARRAY['instagram','tiktok']
                    ELSE ARRAY[wp.platform] END) AS p(platform);

-- ---------- helpers ----------------------------------------------------------
-- Plataformas do "quadro" de um post: fluxo, ou o padrão do cliente se avulso.
CREATE OR REPLACE FUNCTION public.post_board_platforms(p_workflow_id bigint, p_cliente_id bigint)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    CASE WHEN p_workflow_id IS NOT NULL
         THEN (SELECT plataformas FROM public.workflows WHERE id = p_workflow_id)
         ELSE (SELECT plataformas_padrao FROM public.clientes WHERE id = p_cliente_id)
    END,
    ARRAY['instagram']);
$$;
REVOKE ALL ON FUNCTION public.post_board_platforms(bigint, bigint) FROM public, anon, authenticated;

-- Lista de destinos -> valor de workflow_posts.platform.
CREATE OR REPLACE FUNCTION public.platform_from_targets(p_targets text[])
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN 'instagram' = ANY(p_targets) AND 'tiktok' = ANY(p_targets) THEN 'both'
           WHEN 'instagram' = ANY(p_targets) THEN 'instagram'
           WHEN 'tiktok'    = ANY(p_targets) THEN 'tiktok'
           ELSE 'other'
         END;
$$;
REVOKE ALL ON FUNCTION public.platform_from_targets(text[]) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.derive_post_platform(p_post_id bigint)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.platform_from_targets(
    COALESCE(array_agg(platform), ARRAY[]::text[]))
    FROM public.post_targets WHERE post_id = p_post_id;
$$;
REVOKE ALL ON FUNCTION public.derive_post_platform(bigint) FROM public, anon, authenticated;

-- Destinos de um post NOVO. p_platform é o valor do INSERT: 'instagram' é o
-- default da coluna, então nesse caso o quadro decide a parte social; qualquer
-- outro valor foi escrito de propósito (testes, MCP legado) e manda.
CREATE OR REPLACE FUNCTION public.post_seed_targets(
  p_workflow_id bigint, p_cliente_id bigint, p_platform text, p_tipo text)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_board  text[] := public.post_board_platforms(p_workflow_id, p_cliente_id);
  v_social text[];
  v_all    text[];
BEGIN
  v_social := CASE p_platform
    WHEN 'both'   THEN ARRAY['instagram','tiktok']
    WHEN 'tiktok' THEN ARRAY['tiktok']
    WHEN 'other'  THEN ARRAY[]::text[]
    ELSE ARRAY(SELECT x FROM unnest(v_board) x WHERE x IN ('instagram','tiktok'))
  END;
  v_all := v_social || ARRAY(SELECT x FROM unnest(v_board) x WHERE x NOT IN ('instagram','tiktok'));
  IF p_tipo = 'stories' THEN
    v_all := array_remove(v_all, 'tiktok');
  END IF;
  RETURN v_all;
END $$;
REVOKE ALL ON FUNCTION public.post_seed_targets(bigint, bigint, text, text) FROM public, anon, authenticated;

-- ---------- z4b: platform certo já no INSERT -----------------------------
-- Nome escolhido para rodar DEPOIS de post_a0_sync_cliente (preenche cliente_id)
-- e ANTES de workflow_posts_z5_clear_ig_trial (BEFORE INSERT OR UPDATE, que
-- limpa o trial reel quando platform não é Instagram).
CREATE OR REPLACE FUNCTION public.workflow_posts_platform_on_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.platform := public.platform_from_targets(
    public.post_seed_targets(NEW.workflow_id, NEW.cliente_id, NEW.platform, NEW.tipo));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_platform_on_insert() FROM public, anon, authenticated;

CREATE TRIGGER workflow_posts_z4b_platform_on_insert
  BEFORE INSERT ON public.workflow_posts
  FOR EACH ROW EXECUTE FUNCTION public.workflow_posts_platform_on_insert();

-- ---------- z6: cria os destinos do post novo ----------------------------
CREATE OR REPLACE FUNCTION public.post_targets_seed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev text := current_setting('app.post_targets_sync', true);
  v_social text[];
  v_all text[];
BEGIN
  -- NEW.platform já é o derivado (z4b): 'instagram' aqui é Instagram mesmo.
  v_social := CASE NEW.platform
    WHEN 'both'      THEN ARRAY['instagram','tiktok']
    WHEN 'instagram' THEN ARRAY['instagram']
    WHEN 'tiktok'    THEN ARRAY['tiktok']
    ELSE ARRAY[]::text[]
  END;
  v_all := v_social || ARRAY(
    SELECT x FROM unnest(public.post_board_platforms(NEW.workflow_id, NEW.cliente_id)) x
     WHERE x NOT IN ('instagram','tiktok'));

  -- platform já está certo: o sync não precisa reescrever a linha.
  PERFORM set_config('app.post_targets_sync', 'on', true);
  INSERT INTO public.post_targets (conta_id, post_id, platform)
  SELECT NEW.conta_id, NEW.id, x FROM unnest(v_all) x
  ON CONFLICT (post_id, platform) DO NOTHING;
  PERFORM set_config('app.post_targets_sync', COALESCE(v_prev, ''), true);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.post_targets_seed() FROM public, anon, authenticated;

CREATE TRIGGER workflow_posts_z6_seed_targets
  AFTER INSERT ON public.workflow_posts
  FOR EACH ROW EXECUTE FUNCTION public.post_targets_seed();

-- ---------- sync: destino mudou -> recalcula platform -------------------
CREATE OR REPLACE FUNCTION public.post_targets_sync_platform()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post bigint;
  v_prev text := current_setting('app.post_targets_sync', true);
  v_derived text;
BEGIN
  IF v_prev = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN v_post := OLD.post_id; ELSE v_post := NEW.post_id; END IF;
  -- DELETE em cascata do post: a linha pai já sumiu, nada a recalcular.
  IF NOT EXISTS (SELECT 1 FROM public.workflow_posts WHERE id = v_post) THEN
    RETURN NULL;
  END IF;
  v_derived := public.derive_post_platform(v_post);
  PERFORM set_config('app.post_targets_sync', 'on', true);
  UPDATE public.workflow_posts SET platform = v_derived
   WHERE id = v_post AND platform IS DISTINCT FROM v_derived;
  PERFORM set_config('app.post_targets_sync', COALESCE(v_prev, ''), true);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.post_targets_sync_platform() FROM public, anon, authenticated;

CREATE TRIGGER post_targets_sync_platform
  AFTER INSERT OR DELETE OR UPDATE OF platform ON public.post_targets
  FOR EACH ROW EXECUTE FUNCTION public.post_targets_sync_platform();

-- ---------- a2: PlatformSelector grava platform -> destinos --------------
CREATE OR REPLACE FUNCTION public.workflow_posts_platform_to_targets()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev text := current_setting('app.post_targets_sync', true);
  v_want_ig boolean;
  v_want_tt boolean;
BEGIN
  IF v_prev = 'on' OR NEW.platform IS NOT DISTINCT FROM OLD.platform THEN
    RETURN NEW;
  END IF;
  -- Valor fora do domínio: deixa a CHECK recusar (não tocar em destinos).
  IF NEW.platform IS NULL OR NEW.platform NOT IN ('instagram','tiktok','both','other') THEN
    RETURN NEW;
  END IF;

  -- Instagram só entra se o quadro lista Instagram (ou o post já tem o destino):
  -- o auto-reparo de stories do PlatformSelector grava 'instagram' e não pode
  -- criar destino Instagram num quadro só TikTok. TikTok nunca em stories.
  v_want_ig := NEW.platform IN ('instagram','both')
    AND ('instagram' = ANY(public.post_board_platforms(NEW.workflow_id, NEW.cliente_id))
         OR EXISTS (SELECT 1 FROM public.post_targets
                     WHERE post_id = NEW.id AND platform = 'instagram'));
  v_want_tt := NEW.platform IN ('tiktok','both') AND NEW.tipo <> 'stories';

  -- GUC ligado: os INSERT/DELETE abaixo não podem reescrever esta mesma linha
  -- (UPDATE dentro de BEFORE UPDATE da própria linha = erro 27000).
  PERFORM set_config('app.post_targets_sync', 'on', true);
  IF v_want_ig THEN
    INSERT INTO public.post_targets (conta_id, post_id, platform)
    VALUES (NEW.conta_id, NEW.id, 'instagram') ON CONFLICT (post_id, platform) DO NOTHING;
  ELSE
    DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'instagram';
  END IF;
  IF v_want_tt THEN
    INSERT INTO public.post_targets (conta_id, post_id, platform)
    VALUES (NEW.conta_id, NEW.id, 'tiktok') ON CONFLICT (post_id, platform) DO NOTHING;
  ELSE
    DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'tiktok';
  END IF;
  PERFORM set_config('app.post_targets_sync', COALESCE(v_prev, ''), true);

  -- O pedido pode não ter sido atendido por inteiro (quadro sem Instagram,
  -- stories sem TikTok): grava o que os destinos dizem.
  NEW.platform := public.derive_post_platform(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_platform_to_targets() FROM public, anon, authenticated;

CREATE TRIGGER workflow_posts_a2_platform_to_targets
  BEFORE UPDATE OF platform ON public.workflow_posts
  FOR EACH ROW EXECUTE FUNCTION public.workflow_posts_platform_to_targets();

-- ---------- z7: virou stories -> destino TikTok sai -----------------------
-- AFTER (não BEFORE): o DELETE dispara o sync, que faz UPDATE na mesma linha;
-- em AFTER isso é permitido, em BEFORE seria erro 27000.
CREATE OR REPLACE FUNCTION public.workflow_posts_stories_drop_tiktok()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'tiktok';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_stories_drop_tiktok() FROM public, anon, authenticated;

CREATE TRIGGER workflow_posts_z7_stories_drop_tiktok
  AFTER UPDATE OF tipo ON public.workflow_posts
  FOR EACH ROW
  WHEN (NEW.tipo = 'stories' AND OLD.tipo IS DISTINCT FROM 'stories')
  EXECUTE FUNCTION public.workflow_posts_stories_drop_tiktok();
```

Before running it, check the trigger names are free:

```bash
grep -rn "workflow_posts_z4b\|workflow_posts_z6\|workflow_posts_z7\|workflow_posts_a2" supabase/migrations
```

Expected: no hits except the new file. If one is taken, pick another free name, but keep the alphabetical position: BEFORE triggers fire in name order, and `z4b` must sort after `post_a0_sync_cliente` and before `workflow_posts_z5_clear_ig_trial`, and `a2` before `z5`.

- [ ] **Step 3: Run the tests**

Run: `npx supabase db reset`, then `psql … -f supabase/tests/entitlements/99_post_targets.sql`.
Expected: `ROLLBACK` ×4 with no assertion failure.

Then run the whole suite, because existing suites insert posts and change `platform`: `bash scripts/test-entitlements.sh`. Expected: all PASS.

If `30_ig_trial_strategy.sql` or `tiktok_publishing_rpcs.sql` now fail, read the failure first. They insert with an explicit `platform`, which the seed trigger respects by design, so any failure there is a real regression to fix in the migration, not in the test.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261010100002_post_targets.sql supabase/tests/entitlements/99_post_targets.sql
git commit -m "feat(db): post_targets com seed pelo quadro e platform derivado (other)"
```

---

### Task 3: Migration C: Instagram automations only accept Instagram posts

**Files:**
- Create: `supabase/migrations/20261010100003_ica_platform_predicates.sql`
- Modify: `supabase/tests/entitlements/99_post_targets.sql` (append section 5)

**Interfaces:**
- Consumes: `platform = 'other'` from Task 2.
- Produces: four ICA functions that treat only `platform IN ('instagram','both')` as an Instagram target. Signatures, grants and triggers are unchanged: `CREATE OR REPLACE` keeps the OID.

- [ ] **Step 1: Append the failing test (section 5)**

Start from the **"2-4. Resolver" block of `supabase/tests/entitlements/66_instagram_automation_post_targets.sql`** (the `begin; do $$ … $$; rollback;` starting at line 107). It holds the "post so-TikTok" rejection at lines 160-167. Copy that block's setup (workspace with the `feature_instagram_automation` override, client, workflow) plus the TikTok-only rejection, and append it as section 5 of `99_post_targets.sql` with these changes:

- The target post is created on a board inserted with `plataformas = array['geral']`, so its `platform` is `other`.
- The expected exception text is the one Step 2 introduces: `'instagram automation target must be an instagram post'`.
- Add a second assertion, run as table owner:
  - update that `other` post to `status = 'postado'`, and create a pending automation pointing at it with the Step 2 guards disabled. The simplest way is `alter table instagram_comment_automations disable trigger ica_a1_resolve_workflow_post_target`, the same trick suite 66 section 1 uses.
  - Then run `select * from reconcile_unlinked_automation_targets()` and assert that `target_unlinked_at` stays `NULL` for it (an `other` post is not an Instagram post that "lost" its media).

Run the file. Expected: FAIL on section 5, because the resolver accepts the `other` post (`<> 'tiktok'` is true for `other`).

- [ ] **Step 2: Write the copy-forward migration**

`supabase/migrations/20261010100003_ica_platform_predicates.sql`. It has a header comment and four `CREATE OR REPLACE FUNCTION` blocks, each copied **verbatim** from its latest definition with only the predicate lines changed:

| Function | Copy from | Change |
|---|---|---|
| `public.reconcile_unlinked_automation_targets()` | `20260914000001_ica_target_unlinked.sql:24-65` | both `AND COALESCE(wp.platform, 'instagram') <> 'tiktok'` lines become `AND COALESCE(wp.platform, 'instagram') IN ('instagram','both')` |
| `resolve_ica_workflow_post_target()` | `20260914000001_ica_target_unlinked.sql:83-183` | the `IF COALESCE(v_platform, 'instagram') = 'tiktok' THEN RAISE EXCEPTION 'instagram automation target cannot be a tiktok-only post';` block becomes `IF COALESCE(v_platform, 'instagram') NOT IN ('instagram','both') THEN RAISE EXCEPTION 'instagram automation target must be an instagram post';`. The fill guard `AND COALESCE(v_platform, 'instagram') <> 'tiktok'` becomes `AND COALESCE(v_platform, 'instagram') IN ('instagram','both')` |
| `link_pending_instagram_automations()` | `20260830000002_avulso_claim_reorder_ica.sql:474-500` | `IF NEW.tipo = 'stories' OR COALESCE(NEW.platform, 'instagram') = 'tiktok' THEN` becomes `IF NEW.tipo = 'stories' OR COALESCE(NEW.platform, 'instagram') NOT IN ('instagram','both') THEN` |
| `sweep_pending_instagram_automation_links()` | `20260830000002_avulso_claim_reorder_ica.sql:520-538` | `AND COALESCE(wp.platform, 'instagram') <> 'tiktok';` becomes `AND COALESCE(wp.platform, 'instagram') IN ('instagram','both');` |

Header comment to put at the top of the file:

```sql
-- ============================================================
-- Automações de comentário: só post de Instagram é alvo (P1)
-- Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
-- Com workflow_posts.platform = 'other' (post sem Instagram nem TikTok), os
-- testes "<> 'tiktok'" passaram a aceitar post só Geral. Os predicados viram
-- "IN ('instagram','both')" (inclusão) e "NOT IN ('instagram','both')"
-- (exclusão). Copy-forward VERBATIM das definições vigentes; só essas linhas
-- mudam. CREATE OR REPLACE preserva oid, grants e triggers.
-- ============================================================
```

Before copying, confirm these are still the latest definitions:

```bash
for f in reconcile_unlinked_automation_targets resolve_ica_workflow_post_target link_pending_instagram_automations sweep_pending_instagram_automation_links; do echo "$f: $(grep -l "FUNCTION[[:space:]]*\(public\.\)\?$f\b" supabase/migrations/*.sql | sort | tail -1)"; done
```

Expected: 0914 for the first two and 0830 for the last two. If a newer file appears, copy from it.

Check where the old RAISE text is asserted:

```bash
grep -rn "tiktok-only post" supabase/tests supabase/functions apps
```

This finds at least `66_instagram_automation_post_targets.sql:165` (`assert sqlerrm like '%tiktok-only post%'`). Change it to `'%must be an instagram post%'`, and update any other hit the same way.

- [ ] **Step 3: Run the tests**

Run: `npx supabase db reset && bash scripts/test-entitlements.sh`
Expected: all PASS, including suites 65, 66 and 99. Suite 66 section 3 (the TikTok-only post) must still be rejected, now with the new message: update its expected `sqlerrm` if it matches on the text.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261010100003_ica_platform_predicates.sql supabase/tests/entitlements/
git commit -m "fix(db): automações de comentário só aceitam post de Instagram (platform other)"
```

---

### Task 4: `validateForScheduling` refuses posts with no auto-publishing destination

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts:91-96`
- Test: `supabase/functions/__tests__/instagram-publish-validate_test.ts`

**Interfaces:**
- Produces: `validateForScheduling` returns `{ ok: false, errors: ["Este post não tem destino com publicação automática."] }` when `post.platform === "other"`, before any media or account lookup. The CRM `instagram-publish` schedule route and hub-approve auto-schedule both inherit this.

- [ ] **Step 1: Write the failing test**

Append to `instagram-publish-validate_test.ts`:

```ts
Deno.test("validateForScheduling: platform other → refused before media/account lookups", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", {
    data: { id: 1, scheduled_at: null, ig_caption: "cap", workflow_id: 9, cliente_id: 5, tipo: "feed", platform: "other" },
    error: null,
  });
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.ok, "other must not validate");
  assert(
    res.errors.length === 1 && res.errors[0] === "Este post não tem destino com publicação automática.",
    `unexpected errors: ${JSON.stringify(res.errors)}`,
  );
});
```

Run:

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/instagram-publish-validate_test.ts
```

Expected: FAIL. The unqueued `post_file_links` select returns nothing, so the errors are "Post precisa de pelo menos uma mídia." and others.

- [ ] **Step 2: Implement**

In `supabase/functions/_shared/instagram-publish-utils.ts`, add `platform` to the select and return early:

```ts
  const { data: post } = await db
    .from("workflow_posts")
    .select("id, scheduled_at, ig_caption, workflow_id, cliente_id, tipo, ig_trial_strategy, platform")
    .eq("id", postId)
    .single();
  if (!post) return { ok: false, errors: ["Post não encontrado."] };
  // Post sem Instagram nem TikTok (só Geral): nada o publicaria; agendar o
  // deixaria preso em 'agendado'. Spec 2026-09-29, fase P1.
  if (post.platform === "other") {
    return { ok: false, errors: ["Este post não tem destino com publicação automática."] };
  }
```

- [ ] **Step 3: Run the tests**

Run: `npm run check:functions`, then `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/` (the whole suite: `hub-functions_test.ts` and the publish tests exercise this path).
Expected: PASS. Afterwards run `ls node_modules/.deno 2>/dev/null && npm ci`, and `git checkout deno.lock` if it changed.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-validate_test.ts
git commit -m "fix(publish): agendamento recusa post sem destino com publicação automática"
```

---

### Task 5: CRM and Hub understand `platform = 'other'`

**Files:**
- Modify (CRM):
  - `apps/crm/src/store/posts.ts:86-89` (type + comment)
  - `apps/crm/src/pages/entregas/postLabels.ts:35-39`
  - `apps/crm/src/pages/entregas/components/AutoSchedulePromptDialog.tsx:24`
  - `apps/crm/src/pages/entregas/components/PlatformSelector.tsx:38-66`
  - `apps/crm/src/pages/entregas/components/ScheduleButton.tsx:199-206`
- Modify (auto-schedule entry points that bypass `ScheduleButton`):
  - `apps/crm/src/pages/entregas/scheduleApprovedPost.ts:28-33`
  - `apps/crm/src/pages/entregas/autoScheduleNudge.ts:84-92` (`shouldOfferAutoSchedule`)
  - `apps/crm/src/pages/entregas/components/AutoScheduleBatchDialog.tsx:98-102`
- Modify (Instagram predicates, CRM):
  - `apps/crm/src/pages/automacoes/AutomationFormDialog.tsx:129`
  - `apps/crm/src/pages/entregas/components/PostAutomationSection.tsx:72`
  - `apps/crm/src/pages/entregas/components/TrialReelPanel.tsx:20`
  - `apps/crm/src/pages/entregas/components/WorkflowGridView.tsx:72`
  - `apps/crm/src/pages/entregas/components/publishErrorBlockVisibility.ts:23`
  - `apps/crm/src/pages/entregas/components/PostEditorBody.tsx:501`
- Modify (Hub):
  - `apps/hub/src/types.ts` (the `platform` field)
  - `apps/hub/src/components/PostCard.tsx:33-40`
  - `packages/i18n/locales/{pt,en}/hubPostCard.json` (`platform.other`)
- Create: `apps/crm/src/pages/entregas/platformTargets.ts`
- Test:
  - `apps/crm/src/pages/entregas/__tests__/platformTargets.test.ts`
  - `apps/crm/src/pages/entregas/components/__tests__/PlatformSelector.test.tsx` (existing; extend it)
  - `apps/crm/src/pages/entregas/__tests__/autoScheduleNudge.test.ts` and `scheduleApprovedPost.test.ts` (existing; extend them)

**Interfaces:**
- Produces: `type PostPlatform = 'instagram' | 'tiktok' | 'both' | 'other'` (exported from `store/posts.ts`), and in `platformTargets.ts`:
  - `targetsInstagram(p: PostPlatform | null | undefined): boolean`, true for `instagram`/`both`/nullish (DB default)
  - `hasAutoPublishTarget(p): boolean`, false only for `other`
- Every component predicate below calls these helpers instead of comparing against `'tiktok'`.

- [ ] **Step 1: Write the failing test**

`apps/crm/src/pages/entregas/__tests__/platformTargets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { targetsInstagram, hasAutoPublishTarget } from '../platformTargets';

describe('platform predicates', () => {
  it('only instagram, both and the legacy default target Instagram', () => {
    expect(targetsInstagram('instagram')).toBe(true);
    expect(targetsInstagram('both')).toBe(true);
    expect(targetsInstagram(undefined)).toBe(true);
    expect(targetsInstagram(null)).toBe(true);
    expect(targetsInstagram('tiktok')).toBe(false);
    expect(targetsInstagram('other')).toBe(false);
  });

  it('other is the only value with nothing to publish', () => {
    expect(hasAutoPublishTarget('other')).toBe(false);
    for (const p of ['instagram', 'tiktok', 'both', undefined] as const) {
      expect(hasAutoPublishTarget(p)).toBe(true);
    }
  });
});
```

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/platformTargets.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement the helpers and widen the type**

`apps/crm/src/pages/entregas/platformTargets.ts`:

```ts
import type { PostPlatform } from '@/store/posts';

/** Post publica no Instagram? `platform` nulo = linha antiga = default do banco (instagram). */
export function targetsInstagram(p: PostPlatform | null | undefined): boolean {
  return p == null || p === 'instagram' || p === 'both';
}

/** 'other' = nenhum destino com publicação automática (só Geral). Nada o agenda. */
export function hasAutoPublishTarget(p: PostPlatform | null | undefined): boolean {
  return p !== 'other';
}
```

`apps/crm/src/store/posts.ts`, around lines 86-89:

```ts
/** Derivado de post_targets pelo banco (migration 20261010100002):
 *  instagram+tiktok -> both; 'other' = nenhum destino Instagram/TikTok (ex.: só Geral).
 *  'stories' nunca tem destino TikTok. */
export type PostPlatform = 'instagram' | 'tiktok' | 'both' | 'other';
```

Then set the field to `platform?: PostPlatform;`.

`postLabels.ts` `PLATFORM_LABELS`: add `other: 'Geral',`.

`AutoSchedulePromptDialog.tsx:24`: `platform?: PostPlatform;` (import the type).

- [ ] **Step 3: Switch the Instagram predicates to the helper**

Replace each TikTok-exclusion check with `targetsInstagram(…)` (import from `../platformTargets`, adjusting the relative path):

- `AutomationFormDialog.tsx:129`: `(post.platform ?? 'instagram') !== 'tiktok'` → `targetsInstagram(post.platform)`
- `PostAutomationSection.tsx:72`: the same replacement.
- `TrialReelPanel.tsx:20`: `(post.platform ?? 'instagram') === 'tiktok'` → `!targetsInstagram(post.platform)`
- `WorkflowGridView.tsx:72`: `p.platform !== 'tiktok'` → `targetsInstagram(p.platform)`
- `publishErrorBlockVisibility.ts:23`: `post.platform !== 'tiktok'` → `targetsInstagram(post.platform)`
- `PostEditorBody.tsx:501`: `targetsInstagram={post.platform !== 'tiktok'}` → `targetsInstagram={targetsInstagram(post.platform)}`. Import the helper under an alias if the prop name shadows it, e.g. `import { targetsInstagram as isInstagramPost } from '../platformTargets'`.

- [ ] **Step 4: `PlatformSelector` and `ScheduleButton` ignore `other` posts**

`PlatformSelector.tsx`: the stories self-heal (`isStories && value !== 'instagram'`) would rewrite `other` to `instagram`. Guard it, and hide the control for `other` posts. Their destinations come from the board and P2 adds the destination toggles.

```ts
  const isOther = value === 'other';
  ...
    if (isStories && !isOther && value !== 'instagram' && !disabled) {
  ...
  if (!tiktokFeatureEnabled || isOther) return null;
```

Also widen `export type Platform = NonNullable<WorkflowPost['platform']>;`. It follows the store type automatically; check that `ToggleGroup` values are unaffected.

`ScheduleButton.tsx`, just before the existing `if (targetsInstagram && !hasInstagramAccount) return null;` (around line 206):

```ts
  // Post só Geral: nada o publica (validateForScheduling também recusa no servidor).
  if (!hasAutoPublishTarget(post.platform)) return null;
```

Extend `components/__tests__/PlatformSelector.test.tsx`:

```tsx
  it('renders nothing and never self-heals for an other (Geral-only) post', () => {
    const onChange = vi.fn();
    const { container } = render(
      <PlatformSelector value="other" tipo="stories" tiktokFeatureEnabled hasActiveTikTokAccount onChange={onChange} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(onChange).not.toHaveBeenCalled();
  });
```

Match the existing file's imports (`render`, `vi`) and its wrapper, if it has one.

- [ ] **Step 4b: Auto-schedule never offers or attempts an `other` post**

`ScheduleButton` is not the only way in: the CRM approval flow reaches `scheduleApprovedPost` through `AutoSchedulePromptDialog.tsx:66` and `AutoScheduleBatchDialog.tsx:100-102`.

Add inside `describe('shouldOfferAutoSchedule', …)` in `__tests__/autoScheduleNudge.test.ts`. Its all-gates-open fixture is `allTrue` (line 56):

```ts
  it('never offers auto-schedule for a Geral-only post', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, platform: 'other' })).toBe(false);
  });
```

Add inside `describe('scheduleApprovedPost', …)` in `__tests__/scheduleApprovedPost.test.ts`. The file's hoisted mocks are bound to `scheduleInstagramPost`/`scheduleTikTokPost`, and `FUTURE` is defined at line 16:

```ts
  it('refuses an other post without calling any schedule endpoint', async () => {
    await expect(
      scheduleApprovedPost({ id: 1, platform: 'other', scheduled_at: FUTURE }),
    ).rejects.toThrow('Este post não tem destino com publicação automática.');
    expect(scheduleInstagramPost).not.toHaveBeenCalled();
    expect(scheduleTikTokPost).not.toHaveBeenCalled();
  });
```

Implement:
- `autoScheduleNudge.ts` `shouldOfferAutoSchedule`: add `input.platform !== 'other' &&` as the first operand of the `return` expression, with the comment `// post só Geral: nada publica (validateForScheduling também recusa)`.
- `scheduleApprovedPost.ts`, first line of `scheduleApprovedPost`:

```ts
  if (post.platform === 'other') {
    throw new Error('Este post não tem destino com publicação automática.');
  }
```

- `AutoScheduleBatchDialog.tsx`: filter `other` posts out before partitioning, next to `blockedByTikTok`:

```ts
  const approved = (posts ?? []).filter(
    (p) => p.status === 'aprovado_cliente' && p.platform !== 'other',
  );
```

Posts that are only Geral are then simply not part of the batch. They have nothing to schedule, so they show under neither "sem data" nor "TikTok".

- [ ] **Step 5: Hub**

- `apps/hub/src/types.ts`: widen `platform?:` to `'instagram' | 'tiktok' | 'both' | 'other'`.
- `apps/hub/src/components/PostCard.tsx` `getPlatformLabel`: widen the parameter and `Record` key type to include `'other'`, and add `other: t('hubPostCard:platform.other', 'Geral'),`.
- Locales: pt `hubPostCard.json` → `"platform"` gets `"other": "Geral"`; en gets `"other": "General"`.

- [ ] **Step 6: Run the tests**

Run:
- `npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/automacoes apps/hub`
- `npx tsc -p apps/crm/tsconfig.json --noEmit`
- `npx tsc -p apps/hub/tsconfig.json --noEmit`

Expected: PASS and exit 0. The type widening surfaces every exhaustive `Record<Platform, …>` or switch that lacks `'other'`. Add `other` to each: label "Geral"; for scheduling copy, fall back to the Instagram branch, which is unreachable because `ScheduleButton` returns early.

- [ ] **Step 7: Commit**

```bash
git add -A apps/crm/src apps/hub/src packages/i18n
git commit -m "feat(crm,hub): platform 'other' (só Geral) e predicados de Instagram por helper"
```

---

### Task 6: Store: platform lists on workflows, templates and clients

**Files:**
- Modify:
  - `apps/crm/src/store/workflows.ts`: types at `:17-25` and `:96-113`, `saveWorkflowTemplate` at `:77-91`, recurring renewal at `:547-555`
  - `apps/crm/src/store/clients.ts`: `Cliente` type (`:4-37`) and `CLIENTE_SAFE_COLUMNS` (`:94-95`)
  - `apps/crm/src/pages/entregas/wizard/createWorkflow.ts:12-24,73-110`
- Test:
  - `apps/crm/src/__tests__/store.workflows.test.ts` (existing: `ls apps/crm/src/__tests__ | grep -i workflow`; add to it)
  - `apps/crm/src/pages/entregas/wizard/__tests__/createWorkflow.test.ts` (existing if present; otherwise create)

**Interfaces:**
- Consumes: `PlatformId` from `@mesaas/platforms`.
- Produces:
  - `WorkflowTemplate.plataformas?: PlatformId[]`, `Workflow.plataformas?: PlatformId[]`, `Cliente.plataformas_padrao?: PlatformId[]`
  - `saveWorkflowTemplate(id, { nome, etapas, modo_prazo, plataformas })`, which runs the RPC and then `UPDATE workflow_templates SET plataformas`
  - `WizardCreateInput.plataformas: PlatformId[]`

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/__tests__/store.workflows.test.ts`, add inside `describe('store workflow functions', …)`. The file mocks `../lib/supabase` and exposes `mockedSupabase.__queueSupabaseRpc`, `__queueSupabaseResult` and the local helper `getCalls(table, operation)` (lines 3-33):

```ts
  it('saveWorkflowTemplate persists plataformas after the RPC', async () => {
    mockedSupabase.__queueSupabaseRpc('update_workflow_template', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('workflow_templates', 'update', { data: null, error: null });

    await store.saveWorkflowTemplate(7, {
      nome: 'T',
      etapas: [],
      modo_prazo: 'padrao',
      plataformas: ['instagram', 'geral'],
    });

    const [update] = getCalls('workflow_templates', 'update');
    expect(update.payload).toEqual({ plataformas: ['instagram', 'geral'] });
    expect(update.modifiers).toContainEqual({ method: 'eq', args: ['id', 7] });
  });
```

In `apps/crm/src/pages/entregas/wizard/__tests__/createWorkflow.test.ts`, where `baseInput(over)` is a **function** and the store mocks live on the hoisted `store` object (lines 3-31), add:

```ts
  it('passes plataformas to the workflow and to the saved template', async () => {
    store.addWorkflowTemplate.mockResolvedValue({ id: 9, nome: 'T', etapas: [] });
    store.addWorkflow.mockResolvedValue({ id: 5 });
    store.addWorkflowEtapa.mockResolvedValue({});

    await createWorkflowFromWizard(
      baseInput({ plataformas: ['geral'], saveAsTemplate: true, templateName: 'T' }),
    );

    expect(store.addWorkflowTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ plataformas: ['geral'] }),
    );
    expect(store.addWorkflow).toHaveBeenCalledWith(expect.objectContaining({ plataformas: ['geral'] }));
  });
```

If the file's `beforeEach` already sets these resolved values, drop the three `mockResolvedValue` lines. Also add `plataformas: ['instagram'],` to the object returned by `baseInput`, so the existing tests keep compiling once `WizardCreateInput.plataformas` is required.

Run both. Expected: FAIL (TypeScript error: `plataformas` does not exist in the type).

- [ ] **Step 2: Implement**

- `store/workflows.ts`:
  - Add `plataformas?: PlatformId[];` to both `WorkflowTemplate` and `Workflow`.
  - In `saveWorkflowTemplate`, extend the parameter type with `plataformas: PlatformId[]`. After the RPC succeeds:

```ts
  // Separado do RPC de propósito (plano P1, desvio 3): update_workflow_template
  // não conhece a coluna, e perder só a lista de plataformas é recuperável no
  // próximo save.
  const { error: platErr } = await supabase
    .from('workflow_templates')
    .update({ plataformas: t.plataformas })
    .eq('id', id);
  if (platErr) throw new Error('Template salvo, mas as plataformas não foram gravadas.');
```

  - Recurring renewal (`addWorkflow({...})` around line 547): add `plataformas: workflow.plataformas,` so the next cycle keeps the board's platforms.

- `store/clients.ts`: add `plataformas_padrao?: PlatformId[];` to `Cliente`, and append `, plataformas_padrao` to the end of the `CLIENTE_SAFE_COLUMNS` string.

- `wizard/createWorkflow.ts`:
  - Add `plataformas: PlatformId[];` to `WizardCreateInput`.
  - Pass `plataformas: input.plataformas` in both the `addWorkflowTemplate({...})` and the `addWorkflow({...})` calls.

- [ ] **Step 3: Run the tests and typecheck**

Run: `npx vitest run apps/crm/src/__tests__ apps/crm/src/pages/entregas/wizard` and `npx tsc -p apps/crm/tsconfig.json --noEmit`.
Expected: PASS. tsc flags the callers of `saveWorkflowTemplate` and `createWorkflowFromWizard` that don't pass `plataformas` yet; Task 7 fixes them. Temporarily pass `['instagram']` there so the gate is green, and Task 7 replaces it.

- [ ] **Step 4: Commit**

```bash
git add -A apps/crm/src
git commit -m "feat(crm): store lê e grava plataformas de fluxo, template e cliente"
```

---

### Task 7: `PlatformChips`, and using it in the wizard, the workflow edit modal, templates and the client dialog

**Files:**
- Create:
  - `apps/crm/src/components/PlatformChips.tsx`
  - `apps/crm/src/components/__tests__/PlatformChips.test.tsx`
- Modify:
  - `apps/crm/src/pages/entregas/wizard/NewWorkflowWizard.tsx:44-75,123-142,185-197`
  - `apps/crm/src/pages/entregas/wizard/steps/StepBasics.tsx`
  - `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` (EditWorkflowModal `:87-122` + render near `:210-217`; TemplatesModal `:407-408,461-472,486-489,606-619`)
  - `apps/crm/src/pages/cliente-detalhe/ClienteEditDialog.tsx:39-64,110-130`

**Interfaces:**
- Consumes: `PLATFORM_IDS`, `PLATFORM_DEFS`, `COMING_SOON_PLATFORMS`, `PlatformId` from `@mesaas/platforms`; `useWorkspaceLimits()` → `features?.feature_tiktok`.
- Produces: `<PlatformChips value={PlatformId[]} onChange={(next: PlatformId[]) => void} id?: string />`.
  - It never emits an empty array: toggling off the last chip is a no-op with a hint.
  - It hides TikTok unless `feature_tiktok` is on or `value` already includes it.
  - YouTube renders as a disabled chip with "em breve".

- [ ] **Step 1: Write the failing component test**

`apps/crm/src/components/__tests__/PlatformChips.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlatformChips } from '../PlatformChips';

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_tiktok: false } }),
}));

describe('PlatformChips', () => {
  it('toggles platforms and keeps order from the registry', () => {
    const onChange = vi.fn();
    render(<PlatformChips value={['instagram']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Geral/ }));
    expect(onChange).toHaveBeenCalledWith(['instagram', 'geral']);
  });

  it('never emits an empty list', () => {
    const onChange = vi.fn();
    render(<PlatformChips value={['geral']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Geral/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Escolha pelo menos uma plataforma.')).toBeInTheDocument();
  });

  it('hides TikTok without the plan flag, shows YouTube as coming soon', () => {
    render(<PlatformChips value={['instagram']} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /TikTok/ })).toBeNull();
    const yt = screen.getByRole('button', { name: /YouTube/ });
    expect(yt).toBeDisabled();
    expect(yt).toHaveTextContent('em breve');
  });

  it('keeps TikTok visible when the value already has it', () => {
    render(<PlatformChips value={['tiktok']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /TikTok/ })).toBeInTheDocument();
  });
});
```

Check the real hook path (`grep -rn "export function useWorkspaceLimits" apps/crm/src/hooks`) and fix the `vi.mock` path if it differs.

Run: `npx vitest run apps/crm/src/components/__tests__/PlatformChips.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement `PlatformChips`**

`apps/crm/src/components/PlatformChips.tsx`:

```tsx
import { useState } from 'react';
import { Check, FileDown, Instagram, Music2, Youtube } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  COMING_SOON_PLATFORMS,
  PLATFORM_DEFS,
  PLATFORM_IDS,
  type PlatformId,
} from '@mesaas/platforms';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';

const ICONS: Record<PlatformId, LucideIcon> = {
  instagram: Instagram,
  tiktok: Music2,
  geral: FileDown,
};

/**
 * Plataformas de um quadro, template ou cliente (spec 2026-09-29). A ordem de
 * saída segue PLATFORM_IDS. Nunca emite lista vazia: o banco exige >= 1.
 */
export function PlatformChips({
  value,
  onChange,
  id,
}: {
  value: PlatformId[];
  onChange: (next: PlatformId[]) => void;
  id?: string;
}) {
  const { features } = useWorkspaceLimits();
  const [emptyHint, setEmptyHint] = useState(false);

  const visible = PLATFORM_IDS.filter((p) => {
    const flag = PLATFORM_DEFS[p].planFeature;
    return !flag || features?.[flag] === true || value.includes(p);
  });

  const toggle = (p: PlatformId) => {
    const on = value.includes(p);
    if (on && value.length === 1) {
      setEmptyHint(true);
      return;
    }
    setEmptyHint(false);
    const set = new Set(on ? value.filter((x) => x !== p) : [...value, p]);
    onChange(PLATFORM_IDS.filter((x) => set.has(x)));
  };

  return (
    <div id={id}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {visible.map((p) => {
          const Icon = ICONS[p];
          const on = value.includes(p);
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p)}
              className={`platform-chip${on ? ' platform-chip--on' : ''}`}
            >
              <Icon size={14} aria-hidden="true" />
              {PLATFORM_DEFS[p].label}
              {on && <Check size={14} aria-hidden="true" />}
            </button>
          );
        })}
        {COMING_SOON_PLATFORMS.map((p) => (
          <button key={p.id} type="button" disabled className="platform-chip platform-chip--soon">
            <Youtube size={14} aria-hidden="true" />
            {p.label} <span className="platform-chip__soon">em breve</span>
          </button>
        ))}
      </div>
      {emptyHint && (
        <p style={{ fontSize: '0.72rem', color: 'var(--danger-text)', margin: '0.35rem 0 0' }}>
          Escolha pelo menos uma plataforma.
        </p>
      )}
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
        Geral é conteúdo para baixar, sem publicação automática.
      </p>
    </div>
  );
}
```

`COMING_SOON_PLATFORMS` holds only YouTube today, which is why every entry uses the `Youtube` icon. When a second coming-soon platform is added, add an icon map for it.

Append these styles to `apps/crm/style.css`, directly above the first `.post-status--rascunho` rule (around line 7722; `grep -n "^\.post-status--rascunho" apps/crm/style.css`):

```css
.platform-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-size: 0.8rem; padding: 0.35rem 0.65rem; border-radius: 8px;
  border: 1px solid var(--border-color); background: var(--card-bg);
  color: var(--text-main); cursor: pointer;
}
.platform-chip--on { border-color: var(--primary-color); background: rgba(255, 191, 48, 0.12); }
.platform-chip--soon { cursor: not-allowed; color: var(--text-muted); }
.platform-chip__soon { font-size: 0.68rem; }
```

- [ ] **Step 3: Run the component test**

Run: `npx vitest run apps/crm/src/components/__tests__/PlatformChips.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 4: Wire it into the four forms**

**Wizard**
- `NewWorkflowWizard.tsx`:
  - Add `plataformas: PlatformId[];` to `WizardState`, and `plataformas: ['instagram'],` to `INITIAL`.
  - In `selectSource`'s `patch({...})`, add `plataformas: tpl?.plataformas ?? s.plataformas,`.
  - In `createWorkflowFromWizard({...})`, add `plataformas: s.plataformas,`.
  - Remove the temporary `['instagram']` from Task 6.
- `StepBasics.tsx`:
  - Change the name placeholder to `"Ex: Conteúdo Março 2026"`.
  - After the "Nome do fluxo" block, add:

```tsx
      <div className="space-y-1">
        <Label htmlFor="wizard-plataformas">Plataformas deste fluxo</Label>
        <PlatformChips
          id="wizard-plataformas"
          value={state.plataformas}
          onChange={(plataformas) => patch({ plataformas })}
        />
      </div>
```

**EditWorkflowModal (`WorkflowModals.tsx`)**
- Add `const [fPlataformas, setFPlataformas] = useState<PlatformId[]>(w.plataformas ?? ['instagram']);`.
- Add `plataformas: fPlataformas,` to the `updateWorkflow(w.id!, {...})` payload.
- Render the chips after the "Fluxo recorrente" row, before the etapa section. Its `onChange` sets state and calls `markDirty()`:

```tsx
            <div className="space-y-1">
              <Label>Plataformas</Label>
              <PlatformChips value={fPlataformas} onChange={(v) => { setFPlataformas(v); markDirty(); }} />
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                Vale para os próximos posts. Posts já criados mantêm os destinos.
              </p>
            </div>
```

**TemplatesModal (`WorkflowModals.tsx`)**
- Add `const [fPlataformas, setFPlataformas] = useState<PlatformId[]>(['instagram']);`.
- `handleEdit`: `setFPlataformas(tpl.plataformas ?? ['instagram']);`.
- Add `plataformas: fPlataformas` to both `saveWorkflowTemplate(...)` and `addWorkflowTemplate({...})`.
- Reset it to `['instagram']` where the form resets (next to `setFModoPrazo('padrao')`).
- Render the chips block (label "Plataformas") right after the "Modo de Prazo" select.

**ClienteEditDialog.tsx**
- Add `const [fPlataformas, setFPlataformas] = useState<PlatformId[]>(['instagram']);`.
- In the effect that loads the cliente (around line 64): `setFPlataformas(cliente.plataformas_padrao ?? ['instagram']);`.
- Add `plataformas_padrao: fPlataformas,` to `payload`.
- Render the chips with the label "Plataformas dos posts avulsos" after the "dia de entrega" field.

- [ ] **Step 5: Typecheck and run tests**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit` and `npx vitest run apps/crm/src`
Expected: exit 0 and PASS. The wizard, modal and client-dialog tests that snapshot the payload of `updateWorkflow`/`updateCliente`/`addWorkflow` need the new key: update each expectation to include `plataformas: ['instagram']` / `plataformas_padrao: ['instagram']`.

- [ ] **Step 6: Commit**

```bash
git add -A apps/crm
git commit -m "feat(crm): escolha de plataformas no fluxo, template e cliente (PlatformChips)"
```

---

### Task 8: End-to-end check, deploy and PR

- [ ] **Step 1: Run every CI gate** from Global Constraints, including `bash scripts/test-entitlements.sh` against a freshly reset local DB.

- [ ] **Step 2: Local browser check.** Run `preview_start` against the local Supabase (`npm run dev:env` with `.env` pointing at local, or `npm run dev:staging` after staging has the migrations). Check that:
  1. Novo fluxo: the step "O básico" shows "Plataformas deste fluxo" with Instagram on, Geral off, YouTube "em breve", and TikTok only on a TikTok plan.
  2. A board created with only Geral has posts with no "Agendar" button, and the platform selector is hidden.
  3. A board with Instagram behaves exactly as before, including scheduling.
  4. Editing a board's platforms, then creating a new post, gives that post the new set. Check with `select platform from post_targets where post_id = …` via `npx supabase db query` locally.
  5. A template saved with Geral preselects Geral when the wizard starts from it.
  6. The Hub card of a Geral-only post shows the "Geral" badge.

  Take screenshots of 1 and 2.

- [ ] **Step 3: Deploy to staging (before merge)**

```bash
npx supabase db push --linked   # staging; check supabase/.temp/project-ref = wlyzhyfondykzpsiqsce first
npx supabase functions deploy instagram-publish --use-api --project-ref wlyzhyfondykzpsiqsce
npx supabase functions deploy hub-approve --use-api --no-verify-jwt --project-ref wlyzhyfondykzpsiqsce
npx supabase functions deploy tiktok-publish --use-api --project-ref wlyzhyfondykzpsiqsce
```

Match each function's existing `--no-verify-jwt` usage: check the deploy memory or the function's own README/comment before adding or dropping the flag.

Smoke on staging:
- `select platform, count(*) from workflow_posts group by 1` must show no `other` yet.
- `select count(*) from post_targets` must equal the sum of posts counting `both` twice.

- [ ] **Step 4: Open the PR** (renumber migrations first if main moved)

```bash
git push -u origin claude/platform-agnostic-p1
gh pr create --title "feat(platforms): P1 plataformas por quadro + post_targets" --body "$(cat <<'EOF'
Fase P1 da spec docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md (plano em docs/superpowers/plans/2026-09-29-platform-agnostic-p1-destinations.md, com os desvios da spec listados no topo).

- Fluxos, templates e clientes declaram plataformas (Instagram, TikTok com plano, Geral; YouTube em breve).
- `post_targets`: um destino por plataforma por post, criado a partir do quadro; `workflow_posts.platform` passa a ser derivado e ganha `other` (sem Instagram nem TikTok).
- Automações de comentário, agendamento (validateForScheduling) e o CRM ignoram posts `other`.

Deploy: migrations + instagram-publish, hub-approve, tiktok-publish ANTES do merge (staging e prod).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Prod deploy before merge.** Repeat Step 3 with the prod ref `skjzpekeqefvlojenfsw`, then merge.
