# Template propagation preserves per-fluxo values — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saving a workflow template stops overwriting values that were customized on active fluxos. It only changes a field that still matches the old template.

**Architecture:** A new `SECURITY DEFINER` RPC, `update_workflow_template`, locks the template, validates the new payload, saves it, and propagates to active fluxos. The propagation is a per-field three-way merge (old template / new template / fluxo value), and each touched fluxo gets a transactional `template_propagado` event listing every value written. The old `propagate_template_to_workflows` is reduced to backfill-only for the deploy window. The CRM template modal switches to one call to the new RPC.

**Tech Stack:** Postgres/plpgsql (Supabase migrations), psql test suites (`supabase/tests/*.sql`, run by `scripts/test-entitlements.sh`), React 19 + TanStack Query + Vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-template-propagation-preserve-overrides-design.md`. Read it before starting any task.

## Global Constraints

- Worktree: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/revert-etapa-deadlines-1efa77` (lowercase `projects`; the harness rejects the `Projects` spelling). Branch: `claude/template-propagation-preserve-overrides`. Run `pwd && git branch --show-current` before the first edit of every task.
- Migration version: `20260925130001`. Re-check it against `origin/main`'s tail right before `gh pr create` and renumber if main moved past it (`git fetch origin main && git ls-tree --name-only origin/main supabase/migrations/ | tail -1`).
- Never run anything against prod or staging in this plan. DB tests run only on the local Supabase stack.
- Error codes, verbatim: `workspace_not_found`, `template_not_found`, `template_invalid`, `invalid_responsavel`.
- Event metadata keys, verbatim: `template_id`, `template_nome`, `etapas_atualizadas`, `etapas_criadas`, `alteracoes` (array of `{etapa_id, ordem, campo, de, para}`); `campo` ∈ `nome | prazo | responsavel_id | tipo`. No `valores_preservados`.
- `prazo_dias` bound: integer `0..999` (`MAX_PRAZO_DIAS = 999` in `SortableEtapaList.tsx`).
- User-facing copy is Portuguese, and has no em-dashes (use a period or colon instead).
- Toasts use `toast` from `sonner`.
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, and the psql suites (`npm run test:db`, needs the local stack).

### Running the psql suites locally

Docker here is **colima**, not Docker.app: run `colima start --cpu 4 --memory 8` if `docker info` fails. If another worktree's Supabase stack already holds ports 54321-54324, don't stop it. Back up `supabase/config.toml`, append port overrides (`[api] port = 54421`, `[db] port = 54422`, `[studio] port = 54423`, `[inbucket] port = 54424`), run, then restore the file from the backup. **Never commit config.toml changes.**

```bash
npx supabase start
npx supabase db reset            # applies all migrations, including the new one
export DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres   # 54422 with the overrides
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/update_workflow_template.sql
```

(Use port 54422 if you applied the overrides.) A passing suite prints `NOTICE:  PASS update_workflow_template`.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/20260925130001_template_propagation_preserve_overrides.sql` | create | new RPC + old RPC reduced to backfill-only |
| `supabase/tests/update_workflow_template.sql` | create | psql suite for the new RPC and the reduced old RPC |
| `supabase/tests/workflow_events.sql` | modify (m), (n) | move overwrite assertions to the new RPC; pin old RPC as backfill-only |
| `apps/crm/src/store/workflows.ts` | modify | `saveWorkflowTemplate`, `mapTemplateSaveError`; remove `updateWorkflowTemplate`, `propagateTemplateToWorkflows` |
| `apps/crm/src/__tests__/store.workflows.test.ts` | modify | store tests for the new function and error mapping |
| `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` | modify | edit-save calls `saveWorkflowTemplate`; edit button gets an aria-label |
| `apps/crm/src/pages/entregas/components/SortableEtapaList.tsx` | modify | integer-only prazo input |
| `apps/crm/src/pages/entregas/components/ComoFuncionaPanel.tsx` | modify | copy + doc comment |
| `apps/crm/src/pages/entregas/boardRows.ts` | modify | comment |
| `apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx` | modify | new template-save test |
| `apps/crm/src/pages/entregas/components/__tests__/ComoFuncionaPanel.test.tsx` | modify only if it asserts the old copy | |
| ~12 view tests mocking the removed exports | modify | drop dead mock keys |

---

### Task 1: Migration and psql suite for `update_workflow_template`

**Files:**
- Create: `supabase/tests/update_workflow_template.sql`
- Create: `supabase/migrations/20260925130001_template_propagation_preserve_overrides.sql`

**Interfaces:**
- Produces: `public.update_workflow_template(p_template_id bigint, p_nome text, p_etapas jsonb, p_modo_prazo text) RETURNS void`, EXECUTE granted to `authenticated, service_role`. Raises exactly `workspace_not_found | template_not_found | template_invalid | invalid_responsavel`.
- Produces: `public.propagate_template_to_workflows(p_template_id bigint) RETURNS void`, same signature, now backfill-only.

- [ ] **Step 1: Write the failing psql suite**

Create `supabase/tests/update_workflow_template.sql` with exactly this content:

```sql
-- Valida supabase/migrations/20260925130001_template_propagation_preserve_overrides.sql
-- (update_workflow_template novo; propagate_template_to_workflows reduzido a backfill).
--
-- Regra (por campo, por etapa, casamento posicional):
--   template antigo X, novo X            -> mantem
--   template antigo X, novo Y, fluxo X   -> Y
--   template antigo X, novo Y, fluxo Z   -> mantem Z
--   sem etapa no template novo           -> etapa intocada
--   prazo = par (prazo_dias, tipo_prazo)
--
-- Casos:
--   (a) incidente 2026-09-24: so o responsavel muda; prazo customizado sobrevive
--   (b) nome herdado segue, nome customizado fica
--   (c) par de prazo: so tipo_prazo muda; herdado segue, prazo_dias customizado fica
--   (d) tipo: pendente herdado segue; ativo nunca recebe tipo
--   (e) normalizacao: tipo_prazo NULL no fluxo / ausente no template; responsavel "" = null
--   (f) parse defensivo do template antigo (2.5, "abc", etapas nao-array) nao levanta
--   (g) concluida intocada; fluxo maior que o template antigo mantem a etapa extra
--   (h) template encolhe: etapa alem do fim fica intocada
--   (i) reordenacao: valor customizado fica na posicao, herdados seguem o template
--   (j) backfill de etapa anexada com os valores novos
--   (k) eventos: 1 por fluxo tocado, alteracoes exatas, nenhum para fluxo 100% preservado,
--       nenhum ruido de trigger de linha
--   (l) tenancy: template de outro workspace = template_not_found; fluxo envenenado intocado
--   (m) validacao: template_invalid / invalid_responsavel
--   (n) modo_prazo so no template; workflows.modo_prazo e data_limite intocados
--   (o) evento transacional: falha ao gravar o evento faz a chamada levantar
--   (p) propagate_template_to_workflows antigo: so backfill, nunca sobrescreve
--
-- A RPC faz set_config('app.suppress_workflow_events','1', true), que persiste pelo
-- resto da transacao de teste: toda chamada bem-sucedida e seguida de reset para '0'.
-- Chamadas que devem falhar passam por pg_temp.uwt_err, cujo bloco EXCEPTION reverte a
-- subtransacao (e a GUC) sozinho; por isso o teste confere o CODIGO do erro, nao
-- "nada foi gravado" (isso a semantica do EXCEPTION ja garante).
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;

create function pg_temp.uwt_err(p_tpl bigint, p_nome text, p_etapas jsonb, p_modo text)
returns text language plpgsql as $$
begin
  perform public.update_workflow_template(p_tpl, p_nome, p_etapas, p_modo);
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_cli bigint; v_cli2 bigint;
  v_ma bigint; v_mb bigint; v_mx bigint;
  v_tpl bigint;
  v_wf bigint; v_wf2 bigint; v_wf3 bigint;
  v_e0 bigint; v_e1 bigint; v_e2 bigint; v_e3 bigint; v_e4 bigint;
  v_err text;
  v_cnt int;
  v_meta jsonb;
  v_snap jsonb;
  r record;
begin
  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_other);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_other, v_ws2, 'owner');
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws,  nome = 'Dona'  where id = v_owner;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2, nome = 'Outra' where id = v_other;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws,  v_owner, 'Cli',  'CL',  '#000') returning id into v_cli;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws2, v_other, 'Cli2', 'CL2', '#000') returning id into v_cli2;
  insert into membros (conta_id, user_id, nome) values (v_ws,  v_owner, 'Membro A') returning id into v_ma;
  insert into membros (conta_id, user_id, nome) values (v_ws,  v_owner, 'Membro B') returning id into v_mb;
  insert into membros (conta_id, user_id, nome) values (v_ws2, v_other, 'Membro X') returning id into v_mx;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------------
  -- (a) incidente: template so troca o responsavel A -> B
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Posts', jsonb_build_array(
      jsonb_build_object('nome','Copy','prazo_dias',1,'tipo_prazo','corridos','responsavel_id',v_ma,'tipo','padrao'),
      jsonb_build_object('nome','Design','prazo_dias',3,'tipo_prazo','corridos','responsavel_id',v_ma,'tipo','padrao')
    ), 'padrao') returning id into v_tpl;

  -- fluxo herdado
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'A herdado', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status, iniciado_em)
    values (v_wf, 0, 'Copy', 1, 'corridos', v_ma, 'padrao', 'ativo', now()) returning id into v_e0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf, 1, 'Design', 3, 'corridos', v_ma, 'padrao', 'pendente') returning id into v_e1;

  -- fluxo customizado: Copy com prazo 14; Design ja com responsavel B
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'A custom', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status, iniciado_em)
    values (v_wf2, 0, 'Copy', 14, 'corridos', v_ma, 'padrao', 'ativo', now()) returning id into v_e2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf2, 1, 'Design', 3, 'corridos', v_mb, 'padrao', 'pendente') returning id into v_e3;

  perform update_workflow_template(v_tpl, 'Posts', jsonb_build_array(
    jsonb_build_object('nome','Copy','prazo_dias',1,'tipo_prazo','corridos','responsavel_id',v_mb,'tipo','padrao'),
    jsonb_build_object('nome','Design','prazo_dias',3,'tipo_prazo','corridos','responsavel_id',v_mb,'tipo','padrao')
  ), 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.responsavel_id = v_mb and r.prazo_dias = 1, '(a) herdado: responsavel segue o template';
  select * into r from workflow_etapas where id = v_e1;
  assert r.responsavel_id = v_mb, '(a) herdado pendente: responsavel segue o template';
  select * into r from workflow_etapas where id = v_e2;
  assert r.prazo_dias = 14 and r.tipo_prazo = 'corridos',
    format('(a) prazo customizado deve sobreviver, veio %s %s', r.prazo_dias, r.tipo_prazo);
  assert r.responsavel_id = v_mb, '(a) custom: responsavel herdado segue o template';
  select * into r from workflow_etapas where id = v_e3;
  assert r.responsavel_id = v_mb, '(a) Design ja tinha B: continua B';

  select etapas into v_snap from workflow_templates where id = v_tpl;
  assert (v_snap->0->>'responsavel_id')::bigint = v_mb, '(a) template salvo com o novo responsavel';

  -- (k) alteracoes exatas do fluxo customizado: so o responsavel da Copy
  select metadata into v_meta from workflow_events
    where workflow_id = v_wf2 and event_type = 'template_propagado';
  assert v_meta is not null, '(k) fluxo customizado foi tocado: deve ter evento';
  assert (v_meta->>'etapas_atualizadas')::int = 1 and (v_meta->>'etapas_criadas')::int = 0,
    format('(k) contagens erradas: %s', v_meta);
  assert v_meta->'alteracoes' = jsonb_build_array(jsonb_build_object(
      'etapa_id', v_e2, 'ordem', 0, 'campo', 'responsavel_id', 'de', v_ma, 'para', v_mb)),
    format('(k) alteracoes inesperadas: %s', v_meta->'alteracoes');
  assert v_meta->>'template_nome' = 'Posts' and (v_meta->>'template_id')::bigint = v_tpl,
    '(k) template_id/template_nome no metadata';
  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf and event_type = 'template_propagado';
  assert v_cnt = 1, '(k) exatamente 1 evento por fluxo tocado';
  select count(*) into v_cnt from workflow_events
    where workflow_id in (v_wf, v_wf2)
      and event_type in ('etapa_editada','etapa_iniciada','etapa_concluida','etapa_revertida','fluxo_editado');
  assert v_cnt = 0, '(k) nenhum ruido de trigger de linha durante a propagacao';

  -- ---------------------------------------------------------------------
  -- (b) nome
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TB', '[{"nome":"N","prazo_dias":2,"tipo_prazo":"uteis","tipo":"padrao"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'B1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'N', 2, 'uteis', 'padrao', 'pendente') returning id into v_e0;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'B2', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf2, 0, 'Custom', 2, 'uteis', 'padrao', 'pendente') returning id into v_e1;

  perform update_workflow_template(v_tpl, 'TB', '[{"nome":"N2","prazo_dias":2,"tipo_prazo":"uteis","tipo":"padrao"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select nome into v_err from workflow_etapas where id = v_e0;
  assert v_err = 'N2', format('(b) nome herdado deve seguir, veio %s', v_err);
  select nome into v_err from workflow_etapas where id = v_e1;
  assert v_err = 'Custom', format('(b) nome customizado deve ficar, veio %s', v_err);
  -- (k) fluxo 100% preservado nao recebe evento
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf2 and event_type = 'template_propagado';
  assert v_cnt = 0, '(k) fluxo com tudo preservado nao deve ter evento';

  -- ---------------------------------------------------------------------
  -- (c) par de prazo: so tipo_prazo muda (5 corridos -> 5 uteis)
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TC', '[{"nome":"P","prazo_dias":5,"tipo_prazo":"corridos","tipo":"padrao"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'C1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'P', 5, 'corridos', 'padrao', 'pendente') returning id into v_e0;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'C2', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf2, 0, 'P', 10, 'corridos', 'padrao', 'pendente') returning id into v_e1;

  perform update_workflow_template(v_tpl, 'TC', '[{"nome":"P","prazo_dias":5,"tipo_prazo":"uteis","tipo":"padrao"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.prazo_dias = 5 and r.tipo_prazo = 'uteis', format('(c) herdado: par segue, veio %s %s', r.prazo_dias, r.tipo_prazo);
  select * into r from workflow_etapas where id = v_e1;
  assert r.prazo_dias = 10 and r.tipo_prazo = 'corridos',
    format('(c) prazo_dias customizado: par inteiro fica, veio %s %s', r.prazo_dias, r.tipo_prazo);
  select metadata into v_meta from workflow_events where workflow_id = v_wf and event_type = 'template_propagado';
  assert v_meta->'alteracoes' = jsonb_build_array(jsonb_build_object(
      'etapa_id', v_e0, 'ordem', 0, 'campo', 'prazo',
      'de',   jsonb_build_object('prazo_dias', 5, 'tipo_prazo', 'corridos'),
      'para', jsonb_build_object('prazo_dias', 5, 'tipo_prazo', 'uteis'))),
    format('(k) alteracao de prazo deve registrar o par, veio %s', v_meta->'alteracoes');

  -- ---------------------------------------------------------------------
  -- (d) tipo: padrao -> aprovacao_cliente
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TD', '[{"nome":"T","prazo_dias":1,"tipo_prazo":"corridos","tipo":"padrao"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'D1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'T', 1, 'corridos', 'padrao', 'pendente') returning id into v_e0;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'D2', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (v_wf2, 0, 'T', 1, 'corridos', 'padrao', 'ativo', now()) returning id into v_e1;

  perform update_workflow_template(v_tpl, 'TD', '[{"nome":"T","prazo_dias":1,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select tipo into v_err from workflow_etapas where id = v_e0;
  assert v_err = 'aprovacao_cliente', format('(d) pendente herdado recebe tipo, veio %s', v_err);
  select tipo into v_err from workflow_etapas where id = v_e1;
  assert v_err = 'padrao', format('(d) ativo nunca recebe tipo, veio %s', v_err);
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf2 and event_type = 'template_propagado';
  assert v_cnt = 0, '(d) ativo sem nada escrito: sem evento';

  -- ---------------------------------------------------------------------
  -- (e) normalizacao: template antigo sem tipo_prazo e responsavel_id ""
  --     fluxo com tipo_prazo NULL e responsavel NULL: tudo conta como herdado
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TE', '[{"nome":"Z","prazo_dias":2,"responsavel_id":""}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'E1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf, 0, 'Z', 2, null, null, 'padrao', 'pendente') returning id into v_e0;

  perform update_workflow_template(v_tpl, 'TE', jsonb_build_array(
    jsonb_build_object('nome','Z','prazo_dias',3,'tipo_prazo','corridos','responsavel_id',v_ma)), 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.prazo_dias = 3 and r.tipo_prazo = 'corridos',
    format('(e) tipo_prazo NULL/ausente conta como herdado, veio %s %s', r.prazo_dias, r.tipo_prazo);
  assert r.responsavel_id = v_ma, '(e) responsavel "" no template = NULL no fluxo = herdado';

  -- ---------------------------------------------------------------------
  -- (f) parse defensivo do template antigo
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TF', '[{"nome":"D","prazo_dias":2.5,"tipo_prazo":"corridos","responsavel_id":"abc"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'F1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf, 0, 'D', 7, 'corridos', null, 'padrao', 'pendente') returning id into v_e0;

  v_err := pg_temp.uwt_err(v_tpl, 'TF', jsonb_build_array(
    jsonb_build_object('nome','D','prazo_dias',4,'tipo_prazo','corridos','responsavel_id',v_ma)), 'padrao');
  assert v_err is null, format('(f) template antigo malformado nao pode travar o save, levantou %s', v_err);
  -- uwt_err nao reseta a GUC em caso de sucesso
  perform set_config('app.suppress_workflow_events', '0', true);
  select * into r from workflow_etapas where id = v_e0;
  assert r.prazo_dias = 7, format('(f) prazo antigo ilegivel = sem valor antigo = mantem, veio %s', r.prazo_dias);
  assert r.responsavel_id is null, '(f) responsavel antigo ilegivel = mantem';
  select etapas into v_snap from workflow_templates where id = v_tpl;
  assert (v_snap->0->>'prazo_dias')::int = 4, '(f) o template corrigido foi salvo';

  -- etapas antigas nao-array
  update workflow_templates set etapas = '{"bogus":true}' where id = v_tpl;
  v_err := pg_temp.uwt_err(v_tpl, 'TF', '[{"nome":"D","prazo_dias":9,"tipo_prazo":"corridos"}]', 'padrao');
  assert v_err is null, format('(f) etapas antigas nao-array nao pode travar o save, levantou %s', v_err);
  perform set_config('app.suppress_workflow_events', '0', true);
  select prazo_dias into v_cnt from workflow_etapas where id = v_e0;
  assert v_cnt = 7, '(f) sem template antigo: fluxo mantem tudo';

  -- ---------------------------------------------------------------------
  -- (g) concluida intocada; fluxo maior que o template antigo
  -- (h) template encolhe
  -- (j) backfill
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TG', '[{"nome":"A","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"B","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  -- G1: [A concluido herdado, B pendente herdado, Extra pendente] (fluxo maior que o template antigo)
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'G1', v_tpl, 'ativo', 1, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, concluido_em)
    values (v_wf, 0, 'A', 1, 'corridos', 'padrao', 'concluido', '2026-01-01 10:00+00', '2026-01-02 10:00+00') returning id into v_e0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 1, 'B', 1, 'corridos', 'padrao', 'pendente') returning id into v_e1;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 2, 'Extra', 8, 'uteis', 'padrao', 'pendente') returning id into v_e2;
  -- G2: [A ativo] (recebe backfill de B2 e C2)
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'G2', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (v_wf2, 0, 'A', 1, 'corridos', 'padrao', 'ativo', now()) returning id into v_e3;

  perform update_workflow_template(v_tpl, 'TG',
    '[{"nome":"A2","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"B2","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"C2","prazo_dias":6,"tipo_prazo":"uteis"}]',
    'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.nome = 'A' and r.status = 'concluido', '(g) concluida intocada';
  select nome into v_err from workflow_etapas where id = v_e1;
  assert v_err = 'B2', '(g) pendente herdada segue';
  select * into r from workflow_etapas where id = v_e2;
  assert r.nome = 'Extra' and r.prazo_dias = 8, '(g) sem valor antigo na posicao 2: Extra fica';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf;
  assert v_cnt = 3, '(g) G1 ja tinha a ordem 2: sem backfill';
  select nome into v_err from workflow_etapas where id = v_e3;
  assert v_err = 'A2', '(j) ativa herdada segue';
  select * into r from workflow_etapas where workflow_id = v_wf2 and ordem = 2;
  assert found and r.nome = 'C2' and r.prazo_dias = 6 and r.tipo_prazo = 'uteis'
     and r.status = 'pendente' and r.data_limite is null and r.iniciado_em is null,
    '(j) backfill com os valores novos, pendente, sem data_limite';
  select metadata into v_meta from workflow_events where workflow_id = v_wf2 and event_type = 'template_propagado';
  assert (v_meta->>'etapas_atualizadas')::int = 1 and (v_meta->>'etapas_criadas')::int = 2,
    format('(j) contagens G2: %s', v_meta);

  -- (h) encolhe para [A2]: B2 e Extra de G1 ficam intocados
  perform update_workflow_template(v_tpl, 'TG', '[{"nome":"A2","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);
  select nome into v_err from workflow_etapas where id = v_e1;
  assert v_err = 'B2', '(h) etapa alem do fim do template novo fica intocada';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf;
  assert v_cnt = 3, '(h) nada e apagado';

  -- ---------------------------------------------------------------------
  -- (i) reordenacao: [A 1, B 2] -> [B 2, A 1]; fluxo [A prazo 10 (custom), B 2]
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TI', '[{"nome":"A","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"B","prazo_dias":2,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'I1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'A', 10, 'corridos', 'padrao', 'pendente') returning id into v_e0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 1, 'B', 2, 'corridos', 'padrao', 'pendente') returning id into v_e1;

  perform update_workflow_template(v_tpl, 'TI',
    '[{"nome":"B","prazo_dias":2,"tipo_prazo":"corridos"},{"nome":"A","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.nome = 'B' and r.prazo_dias = 10, format('(i) posicao 0: nome segue, prazo custom fica, veio %s %s', r.nome, r.prazo_dias);
  select * into r from workflow_etapas where id = v_e1;
  assert r.nome = 'A' and r.prazo_dias = 1, format('(i) posicao 1: tudo herdado segue, veio %s %s', r.nome, r.prazo_dias);

  -- ---------------------------------------------------------------------
  -- (l) tenancy
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TL', '[{"nome":"L","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  -- fluxo de OUTRO tenant apontando para o template de v_ws (FK envenenada)
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws2, v_other, v_cli2, 'Poison', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf3;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf3, 0, 'L', 1, 'corridos', 'padrao', 'pendente') returning id into v_e4;

  perform update_workflow_template(v_tpl, 'TL', '[{"nome":"L2","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"M","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);
  select nome into v_err from workflow_etapas where id = v_e4;
  assert v_err = 'L', '(l) fluxo de outro tenant nao pode ser tocado';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf3;
  assert v_cnt = 1, '(l) sem backfill cross-tenant';

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  v_err := pg_temp.uwt_err(v_tpl, 'TL', '[{"nome":"X","prazo_dias":1}]', 'padrao');
  assert v_err = 'template_not_found', format('(l) template de outro workspace, veio %s', v_err);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------------
  -- (m) validacao
  -- ---------------------------------------------------------------------
  v_err := pg_temp.uwt_err(v_tpl, null, '[{"nome":"X","prazo_dias":1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) nome NULL, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, '   ', '[{"nome":"X","prazo_dias":1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) nome em branco, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1}]', null);
  assert v_err = 'template_invalid', format('(m) modo NULL, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1}]', 'semanal');
  assert v_err = 'template_invalid', format('(m) modo invalido, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', null, 'padrao');
  assert v_err = 'template_invalid', format('(m) etapas NULL, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[]', 'padrao');
  assert v_err = 'template_invalid', format('(m) etapas vazio, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '{"nome":"X"}', 'padrao');
  assert v_err = 'template_invalid', format('(m) etapas nao-array, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1}, 5]', 'padrao');
  assert v_err = 'template_invalid', format('(m) array misturando objeto e escalar, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"prazo_dias":1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) sem nome, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":" ","prazo_dias":1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) nome da etapa em branco, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X"}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) sem prazo_dias, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":"3"}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) prazo_dias string, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":2.5}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) prazo_dias decimal, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":-1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) prazo_dias negativo, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1000}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) prazo_dias 1000, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1,"tipo_prazo":"semanas"}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) tipo_prazo invalido, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1,"tipo":"outro"}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) tipo invalido, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', jsonb_build_array(jsonb_build_object('nome','X','prazo_dias',1,'responsavel_id',v_mx)), 'padrao');
  assert v_err = 'invalid_responsavel', format('(m) responsavel de outro workspace, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1,"responsavel_id":"abc"}]', 'padrao');
  assert v_err = 'invalid_responsavel', format('(m) responsavel nao numerico, veio %s', v_err);
  -- limites validos passam
  v_err := pg_temp.uwt_err(v_tpl, 'TL', '[{"nome":"L2","prazo_dias":0,"tipo_prazo":null,"tipo":null,"responsavel_id":null},{"nome":"M","prazo_dias":999}]', 'padrao');
  assert v_err is null, format('(m) prazo 0 e 999, chaves null, devem passar, levantou %s', v_err);
  perform set_config('app.suppress_workflow_events', '0', true);

  -- ---------------------------------------------------------------------
  -- (n) modo_prazo so no template
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TN', '[{"nome":"Q","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'N1', v_tpl, 'ativo', 0, false, 'data_fixa') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, data_limite)
    values (v_wf, 0, 'Q', 1, 'corridos', 'padrao', 'pendente', '2026-10-10') returning id into v_e0;

  perform update_workflow_template(v_tpl, 'TN', '[{"nome":"Q","prazo_dias":4,"tipo_prazo":"corridos"}]', 'data_entrega');
  perform set_config('app.suppress_workflow_events', '0', true);
  select modo_prazo into v_err from workflow_templates where id = v_tpl;
  assert v_err = 'data_entrega', '(n) template recebe o modo novo';
  select modo_prazo into v_err from workflows where id = v_wf;
  assert v_err = 'data_fixa', '(n) workflows.modo_prazo intocado';
  select * into r from workflow_etapas where id = v_e0;
  assert r.data_limite = '2026-10-10'::date and r.prazo_dias = 4, '(n) data_limite intocado; prazo herdado segue';

  -- ---------------------------------------------------------------------
  -- (o) evento transacional: a falha ao gravar o evento faz a chamada levantar
  --     (o RPC antigo engolia essa falha com um WARNING)
  -- ---------------------------------------------------------------------
  alter table workflow_events add constraint uwt_force_fail
    check (event_type <> 'template_propagado') not valid;
  v_err := pg_temp.uwt_err(v_tpl, 'TN', '[{"nome":"Q","prazo_dias":5,"tipo_prazo":"corridos"}]', 'data_entrega');
  assert v_err is not null and v_err like '%uwt_force_fail%',
    format('(o) falha do evento deve levantar, veio %s', coalesce(v_err, 'NULL (engolida)'));
  alter table workflow_events drop constraint uwt_force_fail;
  select prazo_dias into v_cnt from workflow_etapas where id = v_e0;
  assert v_cnt = 4, '(o) nada da chamada que falhou ficou gravado';

  -- ---------------------------------------------------------------------
  -- (p) RPC antigo: so backfill
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TP', '[{"nome":"Novo0","prazo_dias":9,"tipo_prazo":"uteis"},{"nome":"Novo1","prazo_dias":2,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'P1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'Velho0', 1, 'corridos', 'padrao', 'pendente') returning id into v_e0;

  perform propagate_template_to_workflows(v_tpl);
  perform set_config('app.suppress_workflow_events', '0', true);
  select * into r from workflow_etapas where id = v_e0;
  assert r.nome = 'Velho0' and r.prazo_dias = 1 and r.tipo_prazo = 'corridos',
    format('(p) RPC antigo nao pode sobrescrever, veio %s %s %s', r.nome, r.prazo_dias, r.tipo_prazo);
  select * into r from workflow_etapas where workflow_id = v_wf and ordem = 1;
  assert found and r.nome = 'Novo1' and r.status = 'pendente', '(p) RPC antigo ainda faz backfill';
  select metadata into v_meta from workflow_events where workflow_id = v_wf and event_type = 'template_propagado';
  assert (v_meta->>'etapas_atualizadas')::int = 0 and (v_meta->>'etapas_criadas')::int = 1,
    format('(p) metadata do RPC antigo: %s', v_meta);

  raise notice 'PASS update_workflow_template';
end $$;
rollback;
```

- [ ] **Step 2: Run it and confirm it fails**

Start the local stack and reset it (see "Running the psql suites locally"), then:

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/update_workflow_template.sql
```

Expected: FAIL with `function update_workflow_template(bigint, unknown, jsonb, unknown) does not exist` (or a similar `does not exist` on the first call).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925130001_template_propagation_preserve_overrides.sql`:

```sql
-- ============================================================
-- update_workflow_template + propagate_template_to_workflows reduzido a backfill
-- ============================================================
-- Spec: docs/superpowers/specs/2026-09-25-template-propagation-preserve-overrides-design.md
--
-- Incidente 2026-09-24 17:22 UTC (DK Marketing Medico, template "Posts (Estaticos e
-- Carrosseis)"): a unica mudanca pretendida era o responsavel de cada etapa, mas
-- propagate_template_to_workflows le o template DEPOIS do save e copia nome,
-- prazo_dias, tipo_prazo, responsavel_id (e tipo em pendente) para toda etapa
-- pendente/ativa de todo fluxo ativo. Dez fluxos tinham prazo de Copy customizado
-- na criacao; voltaram para prazo_dias = 1 e estouraram. Como a propagacao liga
-- app.suppress_workflow_events, os valores antigos nao ficaram registrados em lugar
-- nenhum.
--
-- Regra nova (por campo, por etapa, casamento posicional como antes):
--   template antigo X, novo X            -> mantem
--   template antigo X, novo Y, fluxo X   -> Y        (valor herdado segue o template)
--   template antigo X, novo Y, fluxo Z   -> mantem Z (valor customizado no fluxo)
--   sem etapa no template novo           -> etapa intocada
-- prazo e o PAR (prazo_dias, tipo_prazo). Concluida nunca e tocada; ativa nunca
-- recebe tipo; posicao sem linha no fluxo recebe backfill 'pendente' com os
-- valores novos (data_limite NULL), como em 20260828000010.
--
-- O template antigo foi salvo sem validacao no servidor: prazo_dias 2.5 ou
-- responsavel_id "abc" existem. Ele e lido com guardas de regex (mesmas de
-- apply_post_process); campo ilegivel = sem valor antigo = fluxo mantem o seu.
-- Um cast cru ali levantaria 22P02 e travaria o proprio save que corrige o template.
--
-- Evento template_propagado por fluxo tocado ganha 'alteracoes'
-- ([{etapa_id, ordem, campo, de, para}], de/para do prazo como objeto do par) e e
-- gravado SEM bloco EXCEPTION: se o evento falhar, o save inteiro volta. Ele e o
-- registro para desfazer um save ruim sem backup.
--
-- Janela de deploy: a migration sobe antes do merge e o merge publica o frontend na
-- hora, entao o modal antigo continua chamando propagate_template_to_workflows por
-- alguns minutos. Esse RPC vira so-backfill: nesse intervalo um save alcanca fluxos
-- novos e adiciona etapas novas, mas nunca sobrescreve. Sera removido numa migration
-- de follow-up.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_workflow_template(
  p_template_id bigint,
  p_nome        text,
  p_etapas      jsonb,
  p_modo_prazo  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_old jsonb;
  v_nome text := btrim(p_nome);
  v_e jsonb;
  v_resp_raw text;
  v_wf record;
  v_etapa record;
  v_old_e jsonb;
  v_new_e jsonb;
  -- template antigo, normalizado
  o_nome text; o_prazo integer; o_prazo_ok boolean; o_tp text;
  o_resp bigint; o_resp_ok boolean; o_tipo text;
  -- template novo, normalizado (ja validado)
  n_nome text; n_prazo integer; n_tp text; n_resp bigint; n_tipo text;
  -- valores a gravar na etapa
  w_nome text; w_prazo integer; w_tp text; w_resp bigint; w_tipo text;
  v_changes jsonb;
  v_wf_changes jsonb;
  v_updated integer;
  v_inserted integer;
  v_rows integer;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  -- Trava a linha do template: dois saves do mesmo template serializam, e cada um
  -- faz o merge contra a versao que o outro gravou.
  SELECT etapas INTO v_old
  FROM workflow_templates
  WHERE id = p_template_id AND conta_id = v_conta
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;

  -- ---------- validacao (toda checagem trata NULL explicitamente) ----------
  IF coalesce(v_nome, '') = '' THEN
    RAISE EXCEPTION 'template_invalid';
  END IF;
  IF p_modo_prazo IS NULL OR p_modo_prazo NOT IN ('padrao', 'data_fixa', 'data_entrega') THEN
    RAISE EXCEPTION 'template_invalid';
  END IF;
  IF p_etapas IS NULL OR jsonb_typeof(p_etapas) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_etapas) = 0 THEN
    RAISE EXCEPTION 'template_invalid';
  END IF;

  FOR v_e IN SELECT value FROM jsonb_array_elements(p_etapas) LOOP
    IF jsonb_typeof(v_e) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    IF jsonb_typeof(v_e -> 'nome') IS DISTINCT FROM 'string'
       OR btrim(v_e ->> 'nome') = '' THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    -- inteiro 0..999 como numero JSON (mesma regra de apply_post_process)
    IF jsonb_typeof(v_e -> 'prazo_dias') IS DISTINCT FROM 'number'
       OR (v_e -> 'prazo_dias') #>> '{}' !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    IF (v_e ->> 'tipo_prazo') IS NOT NULL
       AND (v_e ->> 'tipo_prazo') NOT IN ('uteis', 'corridos') THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    IF (v_e ->> 'tipo') IS NOT NULL
       AND (v_e ->> 'tipo') NOT IN ('padrao', 'aprovacao_cliente') THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    -- responsavel precisa ser membro DESTE workspace: workflow_etapas.responsavel_id
    -- so tem FK global, e esta funcao e SECURITY DEFINER.
    v_resp_raw := NULLIF(v_e ->> 'responsavel_id', '');
    IF v_resp_raw IS NOT NULL THEN
      IF v_resp_raw !~ '^[0-9]{1,18}$' THEN
        RAISE EXCEPTION 'invalid_responsavel';
      END IF;
      PERFORM 1 FROM membros WHERE id = v_resp_raw::bigint AND conta_id = v_conta;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_responsavel';
      END IF;
    END IF;
  END LOOP;

  -- ---------- salva o template ----------
  UPDATE workflow_templates
  SET nome = v_nome, etapas = p_etapas, modo_prazo = p_modo_prazo
  WHERE id = p_template_id;

  -- Suprime Triggers A/B/C nas escritas de etapa abaixo (transaction-local).
  PERFORM set_config('app.suppress_workflow_events', '1', true);

  -- ---------- propagacao ----------
  -- conta_id no cursor e a fronteira de tenant obrigatoria (template_id e FK global).
  FOR v_wf IN
    SELECT id FROM workflows
    WHERE template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
    ORDER BY id
  LOOP
    -- Re-checa sob lock (serializa contra migrate_workflow_template).
    PERFORM 1 FROM workflows
      WHERE id = v_wf.id AND template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
      FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_updated := 0;
    v_inserted := 0;
    v_wf_changes := '[]'::jsonb;

    -- FOR UPDATE nas etapas ANTES de comparar: updateWorkflowEtapa no CRM escreve
    -- workflow_etapas direto, sem tocar a linha do fluxo. Com o lock, uma edicao
    -- manual concorrente ou commita antes (e este cursor le o valor novo) ou espera.
    FOR v_etapa IN
      SELECT id, ordem, status, nome, prazo_dias, tipo_prazo, responsavel_id, tipo
      FROM workflow_etapas
      WHERE workflow_id = v_wf.id AND status IN ('pendente', 'ativo')
      ORDER BY ordem, id
      FOR UPDATE
    LOOP
      v_new_e := p_etapas -> v_etapa.ordem;
      IF v_new_e IS NULL THEN
        CONTINUE;  -- template encolheu: etapa alem do fim fica intocada
      END IF;

      v_old_e := CASE WHEN jsonb_typeof(v_old) = 'array' THEN v_old -> v_etapa.ordem END;
      IF v_old_e IS NULL OR jsonb_typeof(v_old_e) <> 'object' THEN
        CONTINUE;  -- sem valor antigo na posicao: tudo conta como customizado
      END IF;

      -- antigo, com guardas (nunca cast cru no lado armazenado)
      o_nome := v_old_e ->> 'nome';
      o_prazo_ok := (v_old_e ->> 'prazo_dias') ~ '^[0-9]{1,9}$';
      o_prazo := CASE WHEN o_prazo_ok THEN (v_old_e ->> 'prazo_dias')::integer END;
      o_prazo_ok := coalesce(o_prazo_ok, false);
      o_tp := coalesce(v_old_e ->> 'tipo_prazo', 'corridos');
      v_resp_raw := NULLIF(v_old_e ->> 'responsavel_id', '');
      o_resp_ok := v_resp_raw IS NULL OR v_resp_raw ~ '^[0-9]{1,18}$';
      o_resp := CASE WHEN v_resp_raw ~ '^[0-9]{1,18}$' THEN v_resp_raw::bigint END;
      o_tipo := coalesce(v_old_e ->> 'tipo', 'padrao');

      -- novo (validado acima)
      n_nome := v_new_e ->> 'nome';
      n_prazo := (v_new_e ->> 'prazo_dias')::integer;
      n_tp := coalesce(v_new_e ->> 'tipo_prazo', 'corridos');
      n_resp := NULLIF(v_new_e ->> 'responsavel_id', '')::bigint;
      n_tipo := coalesce(v_new_e ->> 'tipo', 'padrao');

      w_nome := v_etapa.nome;
      w_prazo := v_etapa.prazo_dias;
      w_tp := v_etapa.tipo_prazo;
      w_resp := v_etapa.responsavel_id;
      w_tipo := v_etapa.tipo;
      v_changes := '[]'::jsonb;

      IF n_nome IS DISTINCT FROM o_nome AND v_etapa.nome IS NOT DISTINCT FROM o_nome THEN
        w_nome := n_nome;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'nome',
          'de', to_jsonb(v_etapa.nome), 'para', to_jsonb(n_nome)));
      END IF;

      IF o_prazo_ok
         AND (n_prazo, n_tp) IS DISTINCT FROM (o_prazo, o_tp)
         AND (v_etapa.prazo_dias, coalesce(v_etapa.tipo_prazo, 'corridos'))
             IS NOT DISTINCT FROM (o_prazo, o_tp) THEN
        w_prazo := n_prazo;
        w_tp := n_tp;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'prazo',
          'de', jsonb_build_object('prazo_dias', v_etapa.prazo_dias, 'tipo_prazo', v_etapa.tipo_prazo),
          'para', jsonb_build_object('prazo_dias', n_prazo, 'tipo_prazo', n_tp)));
      END IF;

      IF o_resp_ok
         AND n_resp IS DISTINCT FROM o_resp
         AND v_etapa.responsavel_id IS NOT DISTINCT FROM o_resp THEN
        w_resp := n_resp;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'responsavel_id',
          'de', to_jsonb(v_etapa.responsavel_id), 'para', to_jsonb(n_resp)));
      END IF;

      -- 'ativo': nunca toca tipo (gate de aprovacao em andamento).
      IF v_etapa.status = 'pendente'
         AND n_tipo IS DISTINCT FROM o_tipo
         AND coalesce(v_etapa.tipo, 'padrao') = o_tipo THEN
        w_tipo := n_tipo;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'tipo',
          'de', to_jsonb(v_etapa.tipo), 'para', to_jsonb(n_tipo)));
      END IF;

      IF jsonb_array_length(v_changes) > 0 THEN
        UPDATE workflow_etapas
        SET nome = w_nome, prazo_dias = w_prazo, tipo_prazo = w_tp,
            responsavel_id = w_resp, tipo = w_tipo
        WHERE id = v_etapa.id AND status = v_etapa.status;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows > 0 THEN
          v_updated := v_updated + 1;
          v_wf_changes := v_wf_changes || v_changes;
        END IF;
      END IF;
    END LOOP;

    -- backfill: posicoes do template novo sem linha no fluxo (qualquer status)
    INSERT INTO workflow_etapas
      (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id,
       tipo, status, iniciado_em, concluido_em, data_limite)
    SELECT v_wf.id,
           (t.idx - 1)::integer,
           t.etapa ->> 'nome',
           (t.etapa ->> 'prazo_dias')::integer,
           coalesce(t.etapa ->> 'tipo_prazo', 'corridos'),
           NULLIF(t.etapa ->> 'responsavel_id', '')::bigint,
           coalesce(t.etapa ->> 'tipo', 'padrao'),
           'pendente', NULL, NULL, NULL
    FROM jsonb_array_elements(p_etapas) WITH ORDINALITY AS t(etapa, idx)
    WHERE NOT EXISTS (
      SELECT 1 FROM workflow_etapas we
      WHERE we.workflow_id = v_wf.id AND we.ordem = (t.idx - 1)::integer
    );
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- Transacional de proposito (sem EXCEPTION): este evento e o registro de undo.
    IF v_updated + v_inserted > 0 THEN
      PERFORM record_workflow_event(
        v_wf.id, v_conta, 'template_propagado', NULL, NULL,
        jsonb_build_object(
          'template_id', p_template_id,
          'template_nome', v_nome,
          'etapas_atualizadas', v_updated,
          'etapas_criadas', v_inserted,
          'alteracoes', v_wf_changes
        )
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.update_workflow_template(bigint, text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_workflow_template(bigint, text, jsonb, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- propagate_template_to_workflows: so backfill (janela de deploy)
-- ------------------------------------------------------------
-- Mesmo corpo de 20260828000010 sem o loop de UPDATE: nunca escreve campo de etapa
-- existente. O evento continua best-effort como antes (so insere linhas; nao ha o
-- que desfazer). etapas_atualizadas fica 0 para o formato do metadata nao mudar.
CREATE OR REPLACE FUNCTION public.propagate_template_to_workflows(
  p_template_id bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_etapas jsonb;
  v_template_nome text;
  v_wf record;
  v_inserted_count integer;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  SELECT etapas, nome INTO v_etapas, v_template_nome
  FROM workflow_templates
  WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;

  IF jsonb_typeof(v_etapas) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;

  PERFORM set_config('app.suppress_workflow_events', '1', true);

  FOR v_wf IN
    SELECT id FROM workflows
    WHERE template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
  LOOP
    PERFORM 1 FROM workflows
      WHERE id = v_wf.id AND template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
      FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO workflow_etapas
      (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id,
       tipo, status, iniciado_em, concluido_em, data_limite)
    SELECT v_wf.id,
           (t.idx - 1)::integer,
           t.etapa ->> 'nome',
           (t.etapa ->> 'prazo_dias')::integer,
           coalesce(t.etapa ->> 'tipo_prazo', 'corridos'),
           NULLIF(t.etapa ->> 'responsavel_id', '')::bigint,
           coalesce(t.etapa ->> 'tipo', 'padrao'),
           'pendente', NULL, NULL, NULL
    FROM jsonb_array_elements(v_etapas) WITH ORDINALITY AS t(etapa, idx)
    WHERE jsonb_typeof(t.etapa) = 'object'
      AND NOT EXISTS (
        SELECT 1 FROM workflow_etapas we
        WHERE we.workflow_id = v_wf.id AND we.ordem = (t.idx - 1)::integer
      );
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count > 0 THEN
      BEGIN
        PERFORM record_workflow_event(
          v_wf.id, v_conta, 'template_propagado', NULL, NULL,
          jsonb_build_object(
            'template_id', p_template_id,
            'template_nome', v_template_nome,
            'etapas_atualizadas', 0,
            'etapas_criadas', v_inserted_count
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'propagate_template_to_workflows: failed to record template_propagado event for workflow %: %', v_wf.id, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.propagate_template_to_workflows(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.propagate_template_to_workflows(bigint) TO authenticated, service_role;
```

Notes for the implementer:
- `(a, b) IS DISTINCT FROM (c, d)` is a row comparison and is NULL-safe per column.
- `o_prazo_ok := (x ~ regex)` is NULL when `x` is NULL. The `coalesce(o_prazo_ok, false)` after computing `o_prazo` turns that into "unreadable".
- Don't wrap the `record_workflow_event` call in `update_workflow_template` in an EXCEPTION block. Test (o) fails if you do.

- [ ] **Step 4: Apply and run the suite**

```bash
npx supabase db reset
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/update_workflow_template.sql
```

Expected: `NOTICE:  PASS update_workflow_template`. If an assert fails, the message names the case letter. Fix the migration, not the test, unless the test contradicts the spec.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925130001_template_propagation_preserve_overrides.sql supabase/tests/update_workflow_template.sql
git commit -m "feat(workflows): update_workflow_template preserves per-fluxo values on template save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Adapt `supabase/tests/workflow_events.sql` (m) and (n)

**Files:**
- Modify: `supabase/tests/workflow_events.sql` (header lines 25-35; section (m) around lines 509-575; section (n) around lines 670-730)

**Interfaces:**
- Consumes: `update_workflow_template(bigint, text, jsonb, text)` and the backfill-only `propagate_template_to_workflows(bigint)` from Task 1.

Section (m) currently seeds the template with the T0/T1/T2 ladder and calls `propagate_template_to_workflows`, expecting overwrites. Under the new RPC, a value is overwritten only if it matches the OLD template. So (m) seeds the old template with the fluxos' current values and saves T0/T1/T2 through `update_workflow_template`. Every existing (m) assertion then holds unchanged.

- [ ] **Step 1: Run the current suite against the Task 1 migration and confirm it fails**

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_events.sql
```

Expected: FAIL at `etapa pendente deve sincronizar nome/prazo_dias/tipo_prazo`, because the old RPC no longer overwrites.

- [ ] **Step 2: Rewrite the (m) template setup**

Replace this block:

```sql
  -- "edita" o template depois de criado, como o brief pede
  update workflow_templates set etapas = jsonb_build_array(
    jsonb_build_object('nome', 'T0', 'prazo_dias', 3, 'tipo_prazo', 'corridos', 'responsavel_id', null, 'tipo', 'aprovacao_cliente'),
    jsonb_build_object('nome', 'T1', 'prazo_dias', 4, 'tipo_prazo', 'uteis', 'responsavel_id', null, 'tipo', 'padrao'),
    jsonb_build_object('nome', 'T2', 'prazo_dias', 5, 'tipo_prazo', 'uteis', 'responsavel_id', null, 'tipo', 'padrao')
  ) where id = v_tpl_m;
```

with:

```sql
  -- template "antigo" = os valores que os fluxos ja tem (herdados); o save via
  -- update_workflow_template abaixo troca para T0/T1/T2, e so valor herdado segue.
  update workflow_templates set etapas = jsonb_build_array(
    jsonb_build_object('nome', 'Old0', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'responsavel_id', null, 'tipo', 'padrao'),
    jsonb_build_object('nome', 'Old1', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'responsavel_id', null, 'tipo', 'padrao'),
    jsonb_build_object('nome', 'Old2', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'responsavel_id', null, 'tipo', 'padrao')
  ) where id = v_tpl_m;
```

- [ ] **Step 3: Make the ativo fixture inherited**

In the `Fluxo M Ativo` insert, change the etapa name `'Old0b'` to `'Old0'`, so the nome counts as inherited and still syncs to `T0`.

- [ ] **Step 4: Swap the (m) RPC call**

Replace:

```sql
  perform propagate_template_to_workflows(v_tpl_m);
  perform set_config('app.suppress_workflow_events', '0', true);

  -- (m-3) tipo sincroniza em 'pendente'
```

with:

```sql
  perform update_workflow_template(v_tpl_m, 'Template M', jsonb_build_array(
    jsonb_build_object('nome', 'T0', 'prazo_dias', 3, 'tipo_prazo', 'corridos', 'responsavel_id', null, 'tipo', 'aprovacao_cliente'),
    jsonb_build_object('nome', 'T1', 'prazo_dias', 4, 'tipo_prazo', 'uteis', 'responsavel_id', null, 'tipo', 'padrao'),
    jsonb_build_object('nome', 'T2', 'prazo_dias', 5, 'tipo_prazo', 'uteis', 'responsavel_id', null, 'tipo', 'padrao')
  ), 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  -- (m-3) tipo sincroniza em 'pendente'
```

- [ ] **Step 5: Pin the old RPC as backfill-only in (n)**

Section (n)'s single fluxo only has a `concluido` etapa, so it never exercised overwrites and passes as is. Add a customized pendente fluxo. Declare `v_wf_n2 bigint; v_etapa_n2 bigint;` in the `declare` block (next to `v_tpl_n`). Immediately before the first `perform propagate_template_to_workflows(v_tpl_n);` in (n), insert:

```sql
  -- fluxo com pendente customizada: o RPC antigo (so-backfill) nao pode sobrescrever
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo N2 Custom', v_tpl_n, 'ativo', 0, false, 'padrao')
    returning id into v_wf_n2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf_n2, 0, 'Custom', 9, 'corridos', 'padrao', 'pendente')
    returning id into v_etapa_n2;
```

and right after the `perform set_config('app.suppress_workflow_events', '0', true);` that follows that first call, insert:

```sql
  select * into r from workflow_etapas where id = v_etapa_n2;
  assert r.nome = 'Custom' and r.prazo_dias = 9 and r.tipo_prazo = 'corridos',
    format('(n) RPC antigo e so-backfill: nao pode sobrescrever, veio %s/%s/%s', r.nome, r.prazo_dias, r.tipo_prazo);
```

- [ ] **Step 6: Update the header comment**

In the header, replace the `(m)` bullet's first line `integracao com propagate_template_to_workflows:` with `integracao com update_workflow_template (save + propagacao com merge por campo):`. Append to the `(n)` bullet: `; o RPC antigo propagate_template_to_workflows agora e so-backfill e nunca sobrescreve etapa existente`. In the "Estrutural" paragraph, change `tanto migrate_workflow_template quanto propagate_template_to_workflows` to `migrate_workflow_template, update_workflow_template e propagate_template_to_workflows`.

- [ ] **Step 7: Run and confirm it passes**

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_events.sql
```

Expected: `NOTICE:  PASS workflow_events`.

- [ ] **Step 8: Commit**

```bash
git add supabase/tests/workflow_events.sql
git commit -m "test(workflow-events): propagation assertions go through update_workflow_template

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store function `saveWorkflowTemplate` + `mapTemplateSaveError`

**Files:**
- Modify: `apps/crm/src/store/workflows.ts:50-83`
- Test: `apps/crm/src/__tests__/store.workflows.test.ts:104-123`

**Interfaces:**
- Consumes: RPC `update_workflow_template` with params `{ p_template_id, p_nome, p_etapas, p_modo_prazo }`.
- Produces:
  ```ts
  export function mapTemplateSaveError(message: string): string;
  export async function saveWorkflowTemplate(
    id: number,
    t: { nome: string; etapas: WorkflowTemplateEtapa[]; modo_prazo: 'padrao' | 'data_fixa' | 'data_entrega' },
  ): Promise<void>;
  ```
  Removes `updateWorkflowTemplate` and `propagateTemplateToWorkflows` (both exported from `store/workflows.ts`, re-exported by `store/index.ts` via `export *`).

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/__tests__/store.workflows.test.ts`, replace the two `propagate_template_to_workflows` tests (lines 104-123) with:

```ts
  it('saves a template via the update_workflow_template RPC', async () => {
    mockedSupabase.__queueSupabaseRpc('update_workflow_template', { data: null, error: null });

    const etapas = [
      { nome: 'Copy', prazo_dias: 1, tipo_prazo: 'corridos' as const, responsavel_id: 7, tipo: 'padrao' as const },
    ];
    await store.saveWorkflowTemplate(5, { nome: 'Posts', etapas, modo_prazo: 'padrao' });

    const rpcCall = getCalls('rpc:update_workflow_template').at(-1);
    expect(rpcCall?.payload).toEqual({
      p_template_id: 5,
      p_nome: 'Posts',
      p_etapas: etapas,
      p_modo_prazo: 'padrao',
    });
  });

  it('throws the mapped message when update_workflow_template fails', async () => {
    mockedSupabase.__queueSupabaseRpc('update_workflow_template', {
      data: null,
      error: { message: 'invalid_responsavel' },
    });

    await expect(
      store.saveWorkflowTemplate(5, { nome: 'Posts', etapas: [], modo_prazo: 'padrao' }),
    ).rejects.toThrow('Um dos responsáveis não faz mais parte da equipe.');
  });

  it.each([
    ['template_invalid', 'Revise as etapas do template: cada etapa precisa de nome e prazo inteiro entre 0 e 999.'],
    ['invalid_responsavel', 'Um dos responsáveis não faz mais parte da equipe.'],
    ['template_not_found', 'Template não encontrado.'],
    ['workspace_not_found', 'Erro ao salvar template.'],
    ['boom', 'Erro ao salvar template.'],
  ])('mapTemplateSaveError(%s)', (code, expected) => {
    expect(store.mapTemplateSaveError(code)).toBe(expected);
  });
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run apps/crm/src/__tests__/store.workflows.test.ts`
Expected: FAIL, `store.saveWorkflowTemplate is not a function` / `store.mapTemplateSaveError is not a function`.

- [ ] **Step 3: Implement**

In `apps/crm/src/store/workflows.ts`, delete `updateWorkflowTemplate` (lines 50-62) and `propagateTemplateToWorkflows` with its doc comment (lines 69-83), and add in their place:

```ts
const TEMPLATE_SAVE_ERRORS: Record<string, string> = {
  template_invalid:
    'Revise as etapas do template: cada etapa precisa de nome e prazo inteiro entre 0 e 999.',
  invalid_responsavel: 'Um dos responsáveis não faz mais parte da equipe.',
  template_not_found: 'Template não encontrado.',
};

export function mapTemplateSaveError(message: string): string {
  for (const [code, friendly] of Object.entries(TEMPLATE_SAVE_ERRORS)) {
    if (message.includes(code)) return friendly;
  }
  return 'Erro ao salvar template.';
}

/**
 * Saves a template and propagates it to active fluxos in one transaction via the
 * `update_workflow_template` RPC (supabase/migrations/20260925130001_template_propagation_preserve_overrides.sql).
 * Per field, a fluxo etapa only follows the template when its value still matches the
 * template's previous value; values customized on the fluxo are kept. Steps the fluxo
 * doesn't have yet are appended as `pendente`.
 */
export async function saveWorkflowTemplate(
  id: number,
  t: {
    nome: string;
    etapas: WorkflowTemplateEtapa[];
    modo_prazo: 'padrao' | 'data_fixa' | 'data_entrega';
  },
): Promise<void> {
  const { error } = await supabase.rpc('update_workflow_template', {
    p_template_id: id,
    p_nome: t.nome,
    p_etapas: t.etapas,
    p_modo_prazo: t.modo_prazo,
  });
  if (error) throw new Error(mapTemplateSaveError(error.message));
}
```

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run apps/crm/src/__tests__/store.workflows.test.ts`
Expected: PASS. `tsc` for the CRM will fail until Task 4 updates the modal. That's expected here.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/workflows.ts apps/crm/src/__tests__/store.workflows.test.ts
git commit -m "feat(crm): saveWorkflowTemplate store call with mapped errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Modal, prazo input, copy, and test sweep

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowModals.tsx:34-48` (imports), `:437-484` (`handleSave`), `:663` (edit button)
- Modify: `apps/crm/src/pages/entregas/components/SortableEtapaList.tsx:208-216`
- Modify: `apps/crm/src/pages/entregas/components/ComoFuncionaPanel.tsx:22-24, 87-90`
- Modify: `apps/crm/src/pages/entregas/boardRows.ts:41-44`
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx`
- Sweep: every file from `grep -rln "propagateTemplateToWorkflows\|updateWorkflowTemplate" apps/crm/src`

**Interfaces:**
- Consumes: `saveWorkflowTemplate(id, { nome, etapas, modo_prazo })` from Task 3; it throws `Error` with an already-mapped Portuguese message.

- [ ] **Step 1: Write the failing modal test**

In `WorkflowModals.test.tsx`:

1. In the `vi.mock('../../../../store', ...)` factory, replace `updateWorkflowTemplate: vi.fn(),` and `propagateTemplateToWorkflows: vi.fn(),` with `saveWorkflowTemplate: vi.fn(),`.
2. Stub the sortable list (dnd-kit adds nothing to this test) while keeping its real helpers. Add after the other `vi.mock` calls:

```tsx
vi.mock('../SortableEtapaList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../SortableEtapaList')>();
  return { ...actual, SortableEtapaList: () => <div>SortableEtapaList</div> };
});

vi.mock('../MigrateTemplateDialog', () => ({
  MigrateTemplateDialog: () => null,
}));
```

3. Add imports at the top: `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';` and, after the existing `import { ... } from '../WorkflowModals';`, `import { TemplatesModal } from '../WorkflowModals';` (or add `TemplatesModal` to the existing import list). Also `import { saveWorkflowTemplate } from '../../../../store';`.
4. Add inside the `describe('WorkflowModals', ...)` block:

```tsx
  describe('TemplatesModal edit save', () => {
    const template = {
      id: 5,
      nome: 'Posts',
      modo_prazo: 'padrao' as const,
      etapas: [
        { nome: 'Copy', prazo_dias: 1, tipo_prazo: 'corridos' as const, responsavel_id: 7, tipo: 'padrao' as const },
      ],
    };

    function renderModal(onRefresh = vi.fn()) {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <TemplatesModal open onClose={vi.fn()} templates={[template]} membros={[]} onRefresh={onRefresh} />
        </QueryClientProvider>,
      );
      return onRefresh;
    }

    beforeEach(() => {
      vi.mocked(saveWorkflowTemplate).mockReset();
    });

    it('saves an edited template with one saveWorkflowTemplate call', async () => {
      vi.mocked(saveWorkflowTemplate).mockResolvedValue(undefined);
      const onRefresh = renderModal();

      fireEvent.click(screen.getByRole('button', { name: 'Editar template Posts' }));
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      await vi.waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Template atualizado!'));
      expect(saveWorkflowTemplate).toHaveBeenCalledTimes(1);
      expect(saveWorkflowTemplate).toHaveBeenCalledWith(5, {
        nome: 'Posts',
        etapas: [
          { nome: 'Copy', prazo_dias: 1, tipo_prazo: 'corridos', responsavel_id: 7, tipo: 'padrao' },
        ],
        modo_prazo: 'padrao',
      });
      expect(onRefresh).toHaveBeenCalled();
    });

    it('shows the mapped error message when the save fails', async () => {
      vi.mocked(saveWorkflowTemplate).mockRejectedValue(
        new Error('Um dos responsáveis não faz mais parte da equipe.'),
      );
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: 'Editar template Posts' }));
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      await vi.waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith('Um dos responsáveis não faz mais parte da equipe.'),
      );
    });
  });
```

If rendering `TemplatesModal` pulls in another heavy child that breaks in jsdom, stub it the same way as `SortableEtapaList` and note it in the commit message. Don't change the component to suit the test.

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx`
Expected: FAIL, `Unable to find an accessible element with the role "button" and name "Editar template Posts"`.

- [ ] **Step 3: Update the modal**

In `WorkflowModals.tsx`:

1. In the store import list, replace `updateWorkflowTemplate,` and `propagateTemplateToWorkflows,` with `saveWorkflowTemplate,`.
2. In `handleSave`, replace:

```tsx
        await updateWorkflowTemplate(editingTemplate.id, {
          nome,
          etapas: etapaData,
          modo_prazo: fModoPrazo,
        });
        await propagateTemplateToWorkflows(editingTemplate.id);
        toast.success('Template atualizado!');
```

with:

```tsx
        await saveWorkflowTemplate(editingTemplate.id, {
          nome,
          etapas: etapaData,
          modo_prazo: fModoPrazo,
        });
        toast.success('Template atualizado!');
```

The existing `catch` (`toast.error((err as Error).message || 'Erro')`) now receives the mapped message. Leave it as is.

3. On the edit button in the template list, add an accessible name:

```tsx
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Editar template ${t.nome}`}
                          onClick={() => handleEdit(t)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
```

- [ ] **Step 4: Integer-only prazo input**

In `SortableEtapaList.tsx` (prazo `<Input type="number">` around line 208), add `step={1}` and change the `onChange` to:

```tsx
              onChange={(e) =>
                onChange('prazo', Math.min(MAX_PRAZO_DIAS, Math.trunc(Number(e.target.value)) || 0))
              }
```

- [ ] **Step 5: Copy and comments**

`ComoFuncionaPanel.tsx`, the `ex-aside` paragraph (lines 87-90). The current copy says editing rewrites only not-yet-started etapas, which was already wrong (active etapas were rewritten too). Replace the inner text with:

```tsx
          <p className="ex-aside">
            <span className="ex-term">Modelo</span> é o esqueleto reutilizável de um fluxo. Editá-lo
            atualiza as etapas <strong>em aberto</strong> dos fluxos que o usam, mas mantém o que
            foi ajustado no próprio fluxo, como um prazo ou responsável diferente.
          </p>
```

The same file's doc comment (lines 22-24): replace `` template propagation is `propagateTemplateToWorkflows`, which rewrites `pendente` and `ativo` etapas (never `concluido`, and never `status`/`iniciado_em`/`concluido_em`). `` with `` template propagation is `saveWorkflowTemplate` (`update_workflow_template`), which updates `pendente` and `ativo` etapas field by field, only where the fluxo still holds the template's previous value (never `concluido`, and never `status`/`iniciado_em`/`concluido_em`). ``

`boardRows.ts` comment (lines 41-44): replace `` `propagate_template_to_workflows` só atualiza etapas `pendente`/`ativo`, `` with `` `update_workflow_template` só atualiza etapas `pendente`/`ativo` (e só campos que o fluxo herdou do template), ``.

Then check `ComoFuncionaPanel.test.tsx` for the old string (`grep -n "iniciadas" apps/crm/src/pages/entregas/components/__tests__/ComoFuncionaPanel.test.tsx`). If it asserts it, update the assertion to the new copy.

- [ ] **Step 6: Sweep the dead mocks**

```bash
grep -rln "propagateTemplateToWorkflows\|updateWorkflowTemplate" apps/crm/src
```

In each hit (view tests' `vi.mock` factories), delete the `propagateTemplateToWorkflows: vi.fn(),` / `updateWorkflowTemplate: vi.fn(),` keys. If a test asserts on those mocks being called, it must switch to `saveWorkflowTemplate`. Expected after the sweep: the grep returns nothing.

- [ ] **Step 7: Run tests and typecheck**

```bash
npx vitest run apps/crm/src/pages/entregas apps/crm/src/__tests__/store.workflows.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: all PASS, tsc exits 0.

- [ ] **Step 8: Verify in the browser (read-only against prod)**

`npm run dev:env` in this worktree uses the PROD database. **Do not save a template.** Only open Entregas → "Como funciona" and confirm the new copy renders. Open Gerenciar Templates, click the edit (pencil) button on a template, confirm the form loads, then close with "Fechar" without saving. Type `2.5` in a prazo field and confirm it becomes `2`. Take a screenshot.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src
git commit -m "feat(crm): template modal saves via saveWorkflowTemplate; integer prazo input

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none (verification only; fix and commit anything it surfaces)

- [ ] **Step 1: Frontend gates**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: all exit 0. On `format:check` failure, run `npm run format` and commit.

- [ ] **Step 2: Full psql suite**

```bash
npx supabase db reset
SUPABASE_DB_URL="$DB_URL" npm run test:db   # the runner reads SUPABASE_DB_URL, not DB_URL
```

Expected: `failures=0`, including `PASS supabase/tests/update_workflow_template.sql` and `PASS supabase/tests/workflow_events.sql`.

- [ ] **Step 3: Migration version guard**

```bash
git fetch origin main
git ls-tree --name-only origin/main supabase/migrations/ | tail -1
ls supabase/migrations | cut -d_ -f1 | sort | uniq -d
```

Expected: main's tail is below `20260925130001` (renumber the file with `git mv` if not), and the duplicate check prints nothing.

- [ ] **Step 4: Restore local-only files**

If you edited `supabase/config.toml` for ports, restore it from the backup. `git status` must show no `config.toml` change. If any Deno/test run touched `node_modules` or `deno.lock`, run `git checkout deno.lock` and `npm ci`.

- [ ] **Step 5: Commit any fixes**

```bash
git status
git add -A && git commit -m "chore: verification fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"   # only if something changed
```

---

## Rollout (after review, with the user's go-ahead; not part of the tasks)

1. `npx supabase db push --linked` against **staging** first, then run the spec's manual staging check (two fluxos, customize one prazo, change the template's responsável and prazo).
2. Push the migration to **prod** before merging (merging deploys the frontend immediately).
3. Open the PR, then merge.
4. Follow-up PR: drop `propagate_template_to_workflows` once the new frontend has been live for a deploy cycle.
