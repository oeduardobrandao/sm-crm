# Workflow Template Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir migrar um fluxo (workflow) existente de um template para outro sem perder posts, aprovações e comentários, via RPC Postgres atômica + diálogo no CRM.

**Architecture:** Uma RPC `SECURITY DEFINER` (`migrate_workflow_template`) faz a troca atômica: remapeia valores de propriedades por nome+tipo, descarta órfãos, substitui a escada de `workflow_etapas` (statuses derivados server-side do índice ativo), atualiza o workflow e grava `audit_log`. O frontend monta a escada nova (reusando o cálculo de prazos existente), mostra a prévia de propriedades que migram/se perdem e chama a RPC. Spec: `docs/superpowers/specs/2026-08-19-workflow-template-migration-design.md`.

**Tech Stack:** Postgres (plpgsql, migration Supabase), supabase-js RPC, React 19 + shadcn/ui + TanStack Query, Vitest, suíte psql (`scripts/test-entitlements.sh`).

## Global Constraints

- Worktree: TODO caminho é absoluto sob `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c/` (nunca o repo principal). Antes de afirmar qualquer coisa: `git -C <worktree> status`.
- Branch: `claude/workflow-template-migration-54002c` (já criado a partir de main).
- Copy de UI em pt-BR, **sem em-dash** (usar ponto, dois-pontos ou "·").
- Migration: prefixo de versão único; **re-verificar contra `git ls-tree origin/main:supabase/migrations | tail` na hora do PR** e renumerar acima do tail se main avançou. Hoje o tail é `20260816000001`; usamos `20260819000001`.
- Antes de qualquer PR: `npm run lint`, `npm run format:check`, os 4 tsc (`npx tsc -p apps/crm/tsconfig.json --noEmit`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`, `npm run test:functions`.
- `npm run test:functions` e deploys sujam `deno.lock` e `node_modules`: `git checkout -- deno.lock` depois; se rodar deno, conferir `ls node_modules/.deno` e rodar `npm ci` no worktree antes de confiar em prettier/tsc locais.
- Toasts: `toast()` de `sonner`. Ícones: `lucide-react`. Sem moment.js.
- DB local: Docker é colima (`colima start --cpu 4 --memory 8`); worktrees paralelos podem segurar as portas default do Supabase local.

---

### Task 1: RPC `migrate_workflow_template` (migration + suíte psql)

**Files:**
- Create: `supabase/tests/migrate_workflow_template.sql`
- Create: `supabase/migrations/20260819000001_workflow_template_migration.sql`

**Interfaces:**
- Produces: RPC `public.migrate_workflow_template(p_workflow_id bigint, p_template_id bigint, p_new_etapas jsonb, p_active_ordem integer, p_modo_prazo text, p_expected_template_id bigint) returns void`, executável por `authenticated`. Erros via `raise exception` com mensagens-código: `workspace_not_found`, `workflow_not_found`, `workflow_changed`, `workflow_not_active`, `same_template`, `template_not_found`, `invalid_modo_prazo`, `empty_etapas`, `invalid_active_ordem`, `invalid_etapa`, `invalid_responsavel`.
- `p_expected_template_id`: guarda otimista de concorrência; é o `template_id` que o cliente estava vendo (null para adoção). Divergência = `workflow_changed`.
- `p_new_etapas`: array jsonb de `{nome, prazo_dias, tipo_prazo, responsavel_id, tipo, data_limite}`. Statuses e `iniciado_em` são derivados server-side de `p_active_ordem` (anteriores `concluido` com datas nulas; ativa `ativo` com `iniciado_em = now()`; seguintes `pendente`). A etapa ativa é inserida `pendente` e ativada por UPDATE, para o trigger `notify_step_activated` (AFTER UPDATE) disparar.
- Regras de remapeamento de propriedades: nome (lower/trim) + tipo iguais, MAS os tipos `select`, `multiselect` e `status` nunca casam (valores guardam ids de opção por template). Estratégia INSERT + ON CONFLICT DO NOTHING + DELETE (um UPDATE simples colide consigo mesmo quando duas definições de origem casam com a mesma de destino). Valores perdidos e `portal_approvals` legadas vão para o metadata do audit_log.

- [ ] **Step 1: Escrever a suíte psql (falhando)**

Criar `supabase/tests/migrate_workflow_template.sql`. O runner `scripts/test-entitlements.sh` pega qualquer `supabase/tests/*.sql` automaticamente; o padrão da casa é `\set ON_ERROR_STOP on`, `\i _helpers.sql`, um `do $$ ... $$` entre `begin;`/`rollback;`, asserts com `assert`, e `raise notice 'PASS ...'` no fim. Impersonação de usuário é via `set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true)` (o trigger `handle_new_user_workspace` já cria um profile por `auth.users` inserido; fazer UPDATE do profile, nunca INSERT).

```sql
-- Valida supabase/migrations/20260819000001_workflow_template_migration.sql.
-- Casos:
--   (a) migração feliz: escada substituída, statuses derivados, workflow atualizado, audit_log gravado
--   (b) remap de propriedade por nome+tipo (case-insensitive, trim), valor órfão apagado
--   (c) conflito UNIQUE(post_id, definition): valor já existente no destino vence
--   (c2) duas definições de origem casando com a MESMA de destino: menor display_order vence,
--        sem unique_violation (o INSERT+ON CONFLICT resolve; um UPDATE simples estouraria)
--   (c3) tipos de opção (select/multiselect/status) NUNCA remapeiam, mesmo com nome igual
--   (d) workflow_select_options do template origem são apagadas
--   (e) isolamento: usuário de outra conta não migra
--   (e2) guarda de concorrência: p_expected_template_id divergente = workflow_changed
--   (e3) migrar para o próprio template = same_template (no-op destrutivo barrado)
--   (e4) data_limite não-ISO = invalid_etapa (contrato de erro, não cast cru)
--   (e6) p_active_ordem/p_modo_prazo NULL = erro estável, nunca bypass trivalente
--   (f) validação falha = rollback total (escada antiga intacta)
--   (g) adoção: workflow com template_id null migra sem tocar em propriedades
--   (h) portal_approvals legadas arquivadas no metadata antes da cascata
--   (i) etapa ativa nova dispara notify_step_activated (via UPDATE) para outro membro
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_cli bigint;
  v_wf bigint; v_wf_adopt bigint;
  v_etapa_old bigint;
  v_tpl_a bigint; v_tpl_b bigint;
  v_def_a_tema bigint; v_def_a_tema_dup bigint; v_def_a_briefing bigint; v_def_a_formato bigint;
  v_def_b_tema bigint; v_def_b_formato bigint;
  v_post1 bigint; v_post2 bigint;
  v_new_etapas jsonb := jsonb_build_array(
    jsonb_build_object('nome','Roteiro','prazo_dias',2,'tipo_prazo','uteis','responsavel_id',null,'tipo','padrao','data_limite',null),
    jsonb_build_object('nome','Design','prazo_dias',3,'tipo_prazo','corridos','responsavel_id',null,'tipo','padrao','data_limite',null),
    jsonb_build_object('nome','Aprovação','prazo_dias',2,'tipo_prazo','corridos','responsavel_id',null,'tipo','aprovacao_cliente','data_limite','2026-09-10')
  );
  v_blocked boolean;
  v_cnt int;
  v_meta jsonb;
  r record;
begin
  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_admin), (v_other);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_admin, v_ws, 'admin'), (v_other, v_ws2, 'owner');
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws  where id = v_owner;
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws  where id = v_admin;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_other;

  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_owner, 'Cliente A', 'CA', '#000') returning id into v_cli;

  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template A', '[{"nome":"Antiga 1","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl_a;
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template B', '[{"nome":"Roteiro","prazo_dias":2,"tipo_prazo":"uteis"}]', 'padrao')
    returning id into v_tpl_b;

  -- propriedades:
  --   'Tema' (text, do=0) e 'Tema' duplicada (text, do=2) em A casam ambas com ' tema ' (text) em B  -> (c2)
  --   'Briefing' (text) não existe em B                                                              -> (b) órfã
  --   'Formato' (select) existe com o MESMO nome em A e B, mas select nunca casa                      -> (c3)
  insert into template_property_definitions (template_id, conta_id, name, type, display_order)
    values (v_tpl_a, v_ws, 'Tema', 'text', 0) returning id into v_def_a_tema;
  insert into template_property_definitions (template_id, conta_id, name, type, display_order)
    values (v_tpl_a, v_ws, 'Tema', 'text', 2) returning id into v_def_a_tema_dup;
  insert into template_property_definitions (template_id, conta_id, name, type, display_order)
    values (v_tpl_a, v_ws, 'Briefing', 'text', 1) returning id into v_def_a_briefing;
  insert into template_property_definitions (template_id, conta_id, name, type, config, display_order)
    values (v_tpl_a, v_ws, 'Formato', 'select', '{"options":[{"id":"11111111-1111-1111-1111-111111111111","label":"Feed","color":"#000"}]}', 3)
    returning id into v_def_a_formato;
  insert into template_property_definitions (template_id, conta_id, name, type, display_order)
    values (v_tpl_b, v_ws, ' tema ', 'text', 0) returning id into v_def_b_tema;
  insert into template_property_definitions (template_id, conta_id, name, type, config, display_order)
    values (v_tpl_b, v_ws, 'Formato', 'select', '{"options":[{"id":"22222222-2222-2222-2222-222222222222","label":"Feed","color":"#000"}]}', 1)
    returning id into v_def_b_formato;

  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'Fluxo A', v_tpl_a, 'ativo', 0, false, 'padrao')
    returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf, 0, 'Antiga 1', 1, 'corridos', 'ativo', now()) returning id into v_etapa_old;

  -- (h) linha legada de portal_approvals pendurada na etapa antiga
  insert into portal_approvals (workflow_etapa_id, token, action, comentario)
    values (v_etapa_old, 'tok-legado', 'aprovado', 'ok do cliente');

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'Post 1', 'feed', 'rascunho') returning id into v_post1;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'Post 2', 'feed', 'aprovado_cliente') returning id into v_post2;

  -- (b) Tema deve migrar; Briefing deve ser descartado
  -- (c2) post1 tem valor nas DUAS 'Tema' de A; a de menor display_order ('"saude"') vence
  -- (c3) valor de select aponta para option id do template A; nunca migra
  insert into post_property_values (post_id, property_definition_id, value)
    values (v_post1, v_def_a_tema, '"saude"'),
           (v_post1, v_def_a_tema_dup, '"dup-perdedor"'),
           (v_post1, v_def_a_briefing, '"texto"'),
           (v_post1, v_def_a_formato, '"11111111-1111-1111-1111-111111111111"');
  -- (c) post2 já tem valor na definição destino: o do destino vence
  insert into post_property_values (post_id, property_definition_id, value)
    values (v_post2, v_def_a_tema, '"origem"'), (v_post2, v_def_b_tema, '"destino"');
  -- (d) select option on-the-fly pendurada em definição do template origem
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (v_wf, v_def_a_formato, v_ws, 'Opcao X');

  -- (e) outra conta não pode migrar
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, 1, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%workflow_not_found%', format('esperava workflow_not_found, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'outra conta deve ser bloqueada';

  -- (e2) guarda de concorrência: expected divergente
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, 1, 'padrao', null);
  exception when others then
    assert sqlerrm like '%workflow_changed%', format('esperava workflow_changed, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'expected_template_id divergente deve falhar';

  -- (e3) migrar para o próprio template é barrado
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_a, v_new_etapas, 0, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%same_template%', format('esperava same_template, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'migrar para o próprio template deve falhar';

  -- (e4) data_limite não-ISO vira invalid_etapa, não erro cru de cast
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b,
      jsonb_build_array(jsonb_build_object('nome','X','prazo_dias',1,'tipo_prazo','corridos','responsavel_id',null,'tipo','padrao','data_limite','data-invalida')),
      0, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%invalid_etapa%', format('esperava invalid_etapa, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'data_limite invalida deve falhar com codigo estavel';

  -- (e6) NULLs não atravessam a validação por lógica trivalente
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, null, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%invalid_active_ordem%', format('esperava invalid_active_ordem, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'p_active_ordem NULL deve falhar';
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, 1, null, v_tpl_a);
  exception when others then
    assert sqlerrm like '%invalid_modo_prazo%', format('esperava invalid_modo_prazo, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'p_modo_prazo NULL deve falhar';

  -- (f) validação falha = rollback total
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, 99, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%invalid_active_ordem%', format('esperava invalid_active_ordem, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'active_ordem fora do range deve falhar';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf;
  assert v_cnt = 1, 'escada antiga deve continuar intacta após falha';
  select count(*) into v_cnt from post_property_values where post_id = v_post1;
  assert v_cnt = 4, 'valores intactos após falha';

  -- (a) migração feliz
  perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, 1, 'padrao', v_tpl_a);

  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf;
  assert v_cnt = 3, format('escada nova deve ter 3 etapas, tem %s', v_cnt);
  select * into r from workflow_etapas where workflow_id = v_wf and ordem = 0;
  assert r.status = 'concluido' and r.iniciado_em is null and r.concluido_em is null,
    'etapa anterior: concluida com datas nulas';
  select * into r from workflow_etapas where workflow_id = v_wf and ordem = 1;
  assert r.status = 'ativo' and r.iniciado_em is not null, 'etapa ativa com iniciado_em';
  select * into r from workflow_etapas where workflow_id = v_wf and ordem = 2;
  assert r.status = 'pendente' and r.data_limite = date '2026-09-10', 'pendente com data_limite do payload';

  select * into r from workflows where id = v_wf;
  assert r.template_id = v_tpl_b and r.etapa_atual = 1 and r.modo_prazo = 'padrao', 'workflow atualizado';

  -- (b)/(c2) valores: Tema migrou com o valor da definição de menor display_order
  select count(*) into v_cnt from post_property_values
    where post_id = v_post1 and property_definition_id = v_def_b_tema and value = '"saude"';
  assert v_cnt = 1, 'Tema de post1 deve migrar com o valor da def de menor display_order';
  select count(*) into v_cnt from post_property_values where property_definition_id = v_def_a_briefing;
  assert v_cnt = 0, 'Briefing (sem par) deve ser apagado';

  -- (c) conflito: valor do destino vence, o de origem some
  select count(*) into v_cnt from post_property_values
    where post_id = v_post2 and property_definition_id = v_def_b_tema and value = '"destino"';
  assert v_cnt = 1, 'valor pré-existente no destino vence';
  select count(*) into v_cnt from post_property_values pv
    join template_property_definitions d on d.id = pv.property_definition_id
    where d.template_id = v_tpl_a;
  assert v_cnt = 0, 'nenhum valor pode continuar apontando para definições de A';

  -- (c3) select nunca remapeia, mesmo com nome igual
  select count(*) into v_cnt from post_property_values
    where post_id = v_post1 and property_definition_id = v_def_b_formato;
  assert v_cnt = 0, 'valor de select não pode migrar (option ids são por template)';

  -- (d) select options do template origem apagadas
  select count(*) into v_cnt from workflow_select_options where workflow_id = v_wf;
  assert v_cnt = 0, 'select options do template origem devem ser apagadas';

  -- (h) + audit log: metadata com perdas e portal_approvals legadas
  select metadata into v_meta from audit_log
    where action = 'workflow.template_migrated' and resource_id = v_wf::text and conta_id = v_ws;
  assert v_meta is not null, 'audit_log deve registrar a migração';
  assert v_meta->'dropped_property_names' ? 'Briefing', 'metadata: nomes descartados';
  assert v_meta->'dropped_property_names' ? 'Formato', 'metadata: select descartada';
  select count(*) into v_cnt from jsonb_array_elements(v_meta->'dropped_property_values') e
    where e->'value' = '"dup-perdedor"'::jsonb;
  assert v_cnt >= 1, 'metadata: valor perdedor do conflito (c2) preservado';
  select count(*) into v_cnt from jsonb_array_elements(v_meta->'legacy_portal_approvals') e
    where e->>'comentario' = 'ok do cliente';
  assert v_cnt = 1, 'metadata: portal_approvals legada arquivada';
  select count(*) into v_cnt from portal_approvals where workflow_etapa_id = v_etapa_old;
  assert v_cnt = 0, 'cascata apagou a linha legada (por isso o arquivo no metadata)';

  -- (i) notificação step_activated para o admin (ator v_owner é excluído)
  select count(*) into v_cnt from notifications
    where workspace_id = v_ws and user_id = v_admin and type = 'step_activated';
  assert v_cnt >= 1, 'etapa ativa nova deve notificar (ativação via UPDATE)';

  -- (g) adoção: fluxo sem template
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'Fluxo do zero', null, 'ativo', 0, false, 'padrao')
    returning id into v_wf_adopt;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf_adopt, 0, 'Solta', 1, 'corridos', 'ativo', now());
  perform migrate_workflow_template(v_wf_adopt, v_tpl_b, v_new_etapas, 0, 'padrao', null);
  select * into r from workflows where id = v_wf_adopt;
  assert r.template_id = v_tpl_b, 'adoção deve setar template_id';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf_adopt;
  assert v_cnt = 3, 'adoção substitui a escada';

  -- workflow concluído não migra
  update workflows set status = 'concluido' where id = v_wf_adopt;
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf_adopt, v_tpl_b, v_new_etapas, 0, 'padrao', v_tpl_b);
  exception when others then
    assert sqlerrm like '%workflow_not_active%', format('esperava workflow_not_active, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'fluxo concluído não deve migrar';

  raise notice 'PASS migrate_workflow_template';
end $$;
rollback;
```

- [ ] **Step 2: Subir o Supabase local e rodar a suíte (deve falhar)**

```bash
colima status || colima start --cpu 4 --memory 8
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c
npx supabase start
npx supabase db reset
bash scripts/test-entitlements.sh
```

Expected: FAIL em `migrate_workflow_template.sql` com `function migrate_workflow_template(...) does not exist`. Se as portas default estiverem ocupadas por outro worktree, sobrepor portas no `supabase/config.toml` temporariamente (NÃO commitar essa mudança). Se o Docker/colima não puder rodar de jeito nenhum, marcar este step como bloqueado, seguir com o Step 3 e deixar a validação para o job `entitlement-tests` do CI, dizendo isso explicitamente no relato.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260819000001_workflow_template_migration.sql`:

```sql
-- ============================================================
-- migrate_workflow_template — troca atômica do template de um fluxo.
-- Spec: docs/superpowers/specs/2026-08-19-workflow-template-migration-design.md
--   1. copia post_property_values para as definições do destino por nome+tipo
--      (case-insensitive, trim; select/multiselect/status NUNCA casam, pois seus
--      valores guardam ids de opção gerados por template). INSERT + ON CONFLICT
--      DO NOTHING em vez de UPDATE: duas definições de origem casando com a
--      mesma de destino fariam um UPDATE colidir consigo mesmo no UNIQUE
--      (post_id, property_definition_id). Desempate determinístico por menor
--      display_order e depois menor id da definição de ORIGEM.
--   2. snapshota o que se perde (órfãos + perdedores de conflito) para o audit_log
--   3. apaga todos os valores restantes sob definições do template origem
--   4. apaga as workflow_select_options do template origem (tipos de opção nunca casam)
--   5. arquiva portal_approvals legadas (tabela sem writer atual; a cascata do
--      delete da escada as apagaria em silêncio) no metadata
--   6. substitui a escada; a etapa ativa é inserida 'pendente' e ativada por
--      UPDATE para o trigger notify_step_activated (AFTER UPDATE) disparar
--   7. atualiza workflows (template_id, etapa_atual, modo_prazo)
--   8. grava audit_log (SECURITY DEFINER cobre o insert; RLS ali é service_role-only)
-- Guarda de concorrência: p_expected_template_id é o template_id que o cliente
-- viu; divergência = workflow_changed (duas migrações não se sobrescrevem caladas).
-- Erros: mensagens-código estáveis consumidas pelo frontend (mapMigrationError).
-- ============================================================

CREATE OR REPLACE FUNCTION public.migrate_workflow_template(
  p_workflow_id          bigint,
  p_template_id          bigint,
  p_new_etapas           jsonb,
  p_active_ordem         integer,
  p_modo_prazo           text,
  p_expected_template_id bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_wf record;
  v_old_template_id bigint;
  v_n integer;
  v_i integer := 0;
  v_etapa jsonb;
  v_nome text;
  v_prazo integer;
  v_resp bigint;
  v_data_limite date;
  v_etapa_id bigint;
  v_active_id bigint;
  v_old_etapas jsonb;
  v_dropped_names text[] := '{}';
  v_dropped_values jsonb := '[]'::jsonb;
  v_legacy_approvals jsonb := '[]'::jsonb;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  SELECT id, template_id, status INTO v_wf
    FROM workflows
    WHERE id = p_workflow_id AND conta_id = v_conta
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_not_found'; END IF;
  IF v_wf.template_id IS DISTINCT FROM p_expected_template_id THEN
    RAISE EXCEPTION 'workflow_changed';
  END IF;
  IF v_wf.status <> 'ativo' THEN RAISE EXCEPTION 'workflow_not_active'; END IF;
  v_old_template_id := v_wf.template_id;

  -- migrar para o próprio template seria um no-op destrutivo (apagaria os
  -- timestamps da escada sem mudar nada); a UI nem oferece, a RPC também barra
  IF v_old_template_id IS NOT NULL AND p_template_id = v_old_template_id THEN
    RAISE EXCEPTION 'same_template';
  END IF;

  PERFORM 1 FROM workflow_templates WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;

  -- NULL explícito nos IFs: em plpgsql um IF com expressão NULL é pulado
  -- (lógica trivalente), então sem estas guardas um p_modo_prazo/p_active_ordem
  -- nulo atravessaria as validações e deixaria o fluxo sem etapa ativa
  IF p_modo_prazo IS NULL OR p_modo_prazo NOT IN ('padrao', 'data_fixa', 'data_entrega') THEN
    RAISE EXCEPTION 'invalid_modo_prazo';
  END IF;

  IF p_new_etapas IS NULL OR jsonb_typeof(p_new_etapas) <> 'array' THEN
    RAISE EXCEPTION 'empty_etapas';
  END IF;
  v_n := jsonb_array_length(p_new_etapas);
  IF v_n = 0 THEN RAISE EXCEPTION 'empty_etapas'; END IF;
  IF p_active_ordem IS NULL OR p_active_ordem < 0 OR p_active_ordem >= v_n THEN
    RAISE EXCEPTION 'invalid_active_ordem';
  END IF;

  IF v_old_template_id IS NOT NULL AND v_old_template_id <> p_template_id THEN
    -- ---- 1. copia valores para as definições casadas do destino ----
    WITH m AS (
      SELECT DISTINCT ON (o.id)
             o.id AS old_id, o.display_order AS old_display_order, n.id AS new_id
      FROM template_property_definitions o
      JOIN template_property_definitions n
        ON n.template_id = p_template_id
       AND n.type = o.type
       AND lower(btrim(n.name)) = lower(btrim(o.name))
      WHERE o.template_id = v_old_template_id
        AND o.type NOT IN ('select', 'multiselect', 'status')
      ORDER BY o.id, n.display_order, n.id
    )
    INSERT INTO post_property_values (post_id, property_definition_id, value)
    SELECT DISTINCT ON (pv.post_id, m.new_id) pv.post_id, m.new_id, pv.value
    FROM post_property_values pv
    JOIN m ON m.old_id = pv.property_definition_id
    WHERE pv.post_id IN (SELECT id FROM workflow_posts WHERE workflow_id = p_workflow_id)
    ORDER BY pv.post_id, m.new_id, m.old_display_order, m.old_id
    ON CONFLICT (post_id, property_definition_id) DO NOTHING;

    -- ---- 2. snapshot do que se perde (órfãos + perdedores de conflito) ----
    WITH m AS (
      SELECT DISTINCT ON (o.id) o.id AS old_id, n.id AS new_id
      FROM template_property_definitions o
      JOIN template_property_definitions n
        ON n.template_id = p_template_id
       AND n.type = o.type
       AND lower(btrim(n.name)) = lower(btrim(o.name))
      WHERE o.template_id = v_old_template_id
        AND o.type NOT IN ('select', 'multiselect', 'status')
      ORDER BY o.id, n.display_order, n.id
    ),
    perdas AS (
      SELECT pv.post_id, d.name, pv.value
      FROM post_property_values pv
      JOIN template_property_definitions d ON d.id = pv.property_definition_id
      LEFT JOIN m ON m.old_id = pv.property_definition_id
      WHERE d.template_id = v_old_template_id
        AND pv.post_id IN (SELECT id FROM workflow_posts WHERE workflow_id = p_workflow_id)
        AND (m.new_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM post_property_values x
          WHERE x.post_id = pv.post_id
            AND x.property_definition_id = m.new_id
            AND x.value = pv.value))
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'post_id', post_id, 'name', name, 'value', value)), '[]'::jsonb),
           coalesce(array_agg(DISTINCT name), '{}')
      INTO v_dropped_values, v_dropped_names
    FROM perdas;

    -- ---- 3. apaga todos os valores sob definições do template origem ----
    DELETE FROM post_property_values pv
    USING template_property_definitions d
    WHERE d.id = pv.property_definition_id
      AND d.template_id = v_old_template_id
      AND pv.post_id IN (SELECT id FROM workflow_posts WHERE workflow_id = p_workflow_id);

    -- ---- 4. select options do template origem (tipos de opção nunca casam) ----
    DELETE FROM workflow_select_options wso
    USING template_property_definitions d
    WHERE d.id = wso.property_definition_id
      AND d.template_id = v_old_template_id
      AND wso.workflow_id = p_workflow_id;
  END IF;

  -- ---- 5. arquiva portal_approvals legadas antes da cascata ----
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'portal_approval_id', pa.id,
           'workflow_etapa_id', pa.workflow_etapa_id,
           'etapa_nome', we.nome,
           'action', pa.action,
           'comentario', pa.comentario,
           'created_at', pa.created_at)), '[]'::jsonb)
    INTO v_legacy_approvals
  FROM portal_approvals pa
  JOIN workflow_etapas we ON we.id = pa.workflow_etapa_id
  WHERE we.workflow_id = p_workflow_id;

  -- ---- 6. escada ----
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.ordem), '[]'::jsonb) INTO v_old_etapas
  FROM workflow_etapas e WHERE e.workflow_id = p_workflow_id;

  DELETE FROM workflow_etapas WHERE workflow_id = p_workflow_id;

  FOR v_etapa IN SELECT * FROM jsonb_array_elements(p_new_etapas) LOOP
    v_nome := btrim(coalesce(v_etapa->>'nome', ''));
    IF v_nome = '' THEN RAISE EXCEPTION 'invalid_etapa'; END IF;

    BEGIN
      v_prazo := (v_etapa->>'prazo_dias')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_etapa';
    END;
    IF v_prazo IS NULL OR v_prazo < 0 THEN RAISE EXCEPTION 'invalid_etapa'; END IF;

    IF coalesce(v_etapa->>'tipo_prazo', '') NOT IN ('uteis', 'corridos') THEN
      RAISE EXCEPTION 'invalid_etapa';
    END IF;
    IF coalesce(v_etapa->>'tipo', 'padrao') NOT IN ('padrao', 'aprovacao_cliente') THEN
      RAISE EXCEPTION 'invalid_etapa';
    END IF;

    v_resp := NULLIF(v_etapa->>'responsavel_id', '')::bigint;
    IF v_resp IS NOT NULL THEN
      PERFORM 1 FROM membros WHERE id = v_resp AND conta_id = v_conta;
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_responsavel'; END IF;
    END IF;

    -- data_limite segue o mesmo contrato de erro dos demais campos (invalid_etapa,
    -- nunca o erro cru de cast do Postgres)
    BEGIN
      v_data_limite := NULLIF(v_etapa->>'data_limite', '')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_etapa';
    END;

    -- a etapa ativa entra como 'pendente' e é ativada por UPDATE no fim do loop,
    -- para o trigger notify_step_activated (AFTER UPDATE) disparar
    INSERT INTO workflow_etapas
      (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
       status, iniciado_em, concluido_em, data_limite)
    VALUES
      (p_workflow_id, v_i, v_nome, v_prazo, v_etapa->>'tipo_prazo', v_resp,
       coalesce(v_etapa->>'tipo', 'padrao'),
       CASE WHEN v_i < p_active_ordem THEN 'concluido' ELSE 'pendente' END,
       NULL, NULL,
       v_data_limite)
    RETURNING id INTO v_etapa_id;
    IF v_i = p_active_ordem THEN v_active_id := v_etapa_id; END IF;
    v_i := v_i + 1;
  END LOOP;

  UPDATE workflow_etapas
  SET status = 'ativo', iniciado_em = now()
  WHERE id = v_active_id;

  -- ---- 7. workflow ----
  UPDATE workflows
  SET template_id = p_template_id, etapa_atual = p_active_ordem, modo_prazo = p_modo_prazo
  WHERE id = p_workflow_id;

  -- ---- 8. auditoria ----
  INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (v_conta, auth.uid(), 'workflow.template_migrated', 'workflow', p_workflow_id::text,
    jsonb_build_object(
      'from_template_id', v_old_template_id,
      'to_template_id', p_template_id,
      'modo_prazo', p_modo_prazo,
      'active_ordem', p_active_ordem,
      'old_etapas', v_old_etapas,
      'dropped_property_names', to_jsonb(v_dropped_names),
      'dropped_property_values', v_dropped_values,
      'legacy_portal_approvals', v_legacy_approvals));
END;
$$;

REVOKE ALL ON FUNCTION public.migrate_workflow_template(bigint, bigint, jsonb, integer, text, bigint)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.migrate_workflow_template(bigint, bigint, jsonb, integer, text, bigint)
  TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar e rodar a suíte (deve passar)**

```bash
npx supabase db reset
bash scripts/test-entitlements.sh
```

Expected: `PASS migrate_workflow_template` (e todas as suítes existentes continuam PASS).

- [ ] **Step 5: Commit**

(A spec já reflete a RPC final, incluindo os pontos do review externo: guarda de concorrência, INSERT+ON CONFLICT, exclusão de tipos de opção, arquivamento de portal_approvals e ativação via UPDATE. Nada a editar nela nesta task.)

```bash
git -C /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c add supabase/migrations/20260819000001_workflow_template_migration.sql supabase/tests/migrate_workflow_template.sql
git -C /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c commit -m "feat(workflows): RPC atômica migrate_workflow_template + suíte psql"
```

---

### Task 2: Módulo de store `workflowMigration.ts` (helpers puros + chamada RPC)

**Files:**
- Create: `apps/crm/src/store/workflowMigration.ts`
- Modify: `apps/crm/src/store/workflows.ts` (exportar `_computeDeliveryDeadlines`)
- Modify: `apps/crm/src/store/index.ts` (adicionar `export * from './workflowMigration';`)
- Test: `apps/crm/src/store/__tests__/workflowMigration.test.ts`

**Interfaces:**
- Consumes: RPC `migrate_workflow_template` (Task 1); `_computeDeliveryDeadlines(etapas: WorkflowEtapa[], deliveryDate: Date): Map<number, string>` de `workflows.ts`; tipos `WorkflowTemplate`, `TemplatePropertyDefinition`, `WorkflowEtapa` do store.
- Produces (Task 3/4 dependem destas assinaturas exatas):
  - `interface MigrationEtapaInput { nome: string; prazo_dias: number; tipo_prazo: 'uteis' | 'corridos'; responsavel_id: number | null; tipo: 'padrao' | 'aprovacao_cliente'; data_limite: string | null }`
  - `interface PropertyMatch { origem: TemplatePropertyDefinition; destino: TemplatePropertyDefinition | null }` (tipos `select`/`multiselect`/`status` sempre resultam em `destino: null` — a regra espelha a RPC)
  - `function matchPropertyDefinitions(origem: TemplatePropertyDefinition[], destino: TemplatePropertyDefinition[]): PropertyMatch[]`
  - `function buildMigrationEtapas(template: WorkflowTemplate, deliveryDate: Date | null): MigrationEtapaInput[]`
  - `async function migrateWorkflowTemplate(args: { workflowId: number; templateId: number; etapas: MigrationEtapaInput[]; activeOrdem: number; modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega'; expectedTemplateId: number | null }): Promise<void>`
  - `function mapMigrationError(message: string): string` (código → mensagem pt-BR)

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `apps/crm/src/store/__tests__/workflowMigration.test.ts`. Mockar apenas `./core` (o client supabase) — os helpers são puros:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../core', () => ({
  supabase: { rpc: vi.fn() },
  getUserId: vi.fn(),
  getContaId: vi.fn(),
}));

import {
  matchPropertyDefinitions,
  buildMigrationEtapas,
  mapMigrationError,
} from '../workflowMigration';
import type { TemplatePropertyDefinition } from '../posts';
import type { WorkflowTemplate } from '../workflows';

const def = (over: Partial<TemplatePropertyDefinition>): TemplatePropertyDefinition => ({
  id: 1,
  template_id: 1,
  name: 'Tema',
  type: 'text',
  config: {},
  portal_visible: false,
  display_order: 0,
  ...over,
});

describe('matchPropertyDefinitions', () => {
  it('casa por nome (case-insensitive, trim) e tipo', () => {
    const origem = [def({ id: 1, name: 'Tema', type: 'text' })];
    const destino = [def({ id: 10, name: '  tema ', type: 'text' })];
    const [m] = matchPropertyDefinitions(origem, destino);
    expect(m.destino?.id).toBe(10);
  });

  it('nome igual mas tipo diferente não casa', () => {
    const origem = [def({ id: 1, name: 'Tema', type: 'text' })];
    const destino = [def({ id: 10, name: 'Tema', type: 'select' })];
    const [m] = matchPropertyDefinitions(origem, destino);
    expect(m.destino).toBeNull();
  });

  it('empate resolve por menor display_order, depois menor id', () => {
    const origem = [def({ id: 1 })];
    const destino = [
      def({ id: 11, display_order: 2 }),
      def({ id: 10, display_order: 1 }),
      def({ id: 9, display_order: 1 }),
    ];
    const [m] = matchPropertyDefinitions(origem, destino);
    expect(m.destino?.id).toBe(9);
  });

  it('sem par vira destino null (será descartada)', () => {
    const origem = [def({ id: 1, name: 'Briefing' })];
    const [m] = matchPropertyDefinitions(origem, [def({ id: 10, name: 'Tema' })]);
    expect(m.destino).toBeNull();
  });

  it('select/multiselect/status nunca casam, mesmo com nome e tipo iguais', () => {
    for (const type of ['select', 'multiselect', 'status'] as const) {
      const origem = [def({ id: 1, name: 'Formato', type })];
      const destino = [def({ id: 10, name: 'Formato', type })];
      const [m] = matchPropertyDefinitions(origem, destino);
      expect(m.destino).toBeNull();
    }
  });
});

describe('buildMigrationEtapas', () => {
  const template: WorkflowTemplate = {
    id: 5,
    nome: 'B',
    modo_prazo: 'padrao',
    etapas: [
      { nome: 'Roteiro', prazo_dias: 2, tipo_prazo: 'uteis', responsavel_id: 7, tipo: 'padrao' },
      { nome: 'Aprovação', prazo_dias: 3, tipo_prazo: 'corridos', tipo: 'aprovacao_cliente' },
    ],
  };

  it('padrao: mapeia campos e data_limite null', () => {
    const etapas = buildMigrationEtapas(template, null);
    expect(etapas).toEqual([
      { nome: 'Roteiro', prazo_dias: 2, tipo_prazo: 'uteis', responsavel_id: 7, tipo: 'padrao', data_limite: null },
      { nome: 'Aprovação', prazo_dias: 3, tipo_prazo: 'corridos', responsavel_id: null, tipo: 'aprovacao_cliente', data_limite: null },
    ]);
  });

  it('data_entrega com deliveryDate: âncora recebe a data, anteriores recuam', () => {
    const t = { ...template, modo_prazo: 'data_entrega' as const };
    const etapas = buildMigrationEtapas(t, new Date(2026, 8, 10)); // 10/09/2026, quinta
    expect(etapas[1].data_limite).toBe('2026-09-10');
    // Roteiro: 3 dias corridos antes da âncora (prazo da etapa seguinte) = 07/09
    expect(etapas[0].data_limite).toBe('2026-09-07');
  });

  it('data_entrega sem deliveryDate: sem datas (mesmo comportamento do wizard)', () => {
    const t = { ...template, modo_prazo: 'data_entrega' as const };
    expect(buildMigrationEtapas(t, null).every((e) => e.data_limite === null)).toBe(true);
  });
});

describe('mapMigrationError', () => {
  it('mapeia códigos conhecidos para pt-BR', () => {
    expect(mapMigrationError('workflow_not_active')).toBe('Só é possível migrar fluxos ativos.');
    expect(mapMigrationError('template_not_found')).toBe('Template não encontrado neste workspace.');
    expect(mapMigrationError('workflow_changed')).toBe(
      'Este fluxo foi alterado por outra pessoa. Recarregue a página e tente novamente.',
    );
  });
  it('erro desconhecido vira mensagem genérica', () => {
    expect(mapMigrationError('deadlock detected')).toBe('Não foi possível migrar o template. Tente novamente.');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c
npx vitest run apps/crm/src/store/__tests__/workflowMigration.test.ts
```

Expected: FAIL (módulo `../workflowMigration` não existe).

- [ ] **Step 3: Implementar**

Em `apps/crm/src/store/workflows.ts`, tornar o helper privado exportável (a função e o corpo NÃO mudam, só ganha `export`):

```ts
export function _computeDeliveryDeadlines(
```

Criar `apps/crm/src/store/workflowMigration.ts`:

```ts
import { supabase } from './core';
import { _computeDeliveryDeadlines, type WorkflowEtapa, type WorkflowTemplate } from './workflows';
import type { TemplatePropertyDefinition } from './posts';

export interface MigrationEtapaInput {
  nome: string;
  prazo_dias: number;
  tipo_prazo: 'uteis' | 'corridos';
  responsavel_id: number | null;
  tipo: 'padrao' | 'aprovacao_cliente';
  data_limite: string | null;
}

export interface PropertyMatch {
  origem: TemplatePropertyDefinition;
  destino: TemplatePropertyDefinition | null;
}

const normalize = (name: string) => name.trim().toLowerCase();

/** Tipos cujos valores guardam ids de opção gerados por template (config.options[].id):
 *  um remap apontaria para uma opção inexistente no destino, então nunca casam. */
const OPTION_TYPES = new Set(['select', 'multiselect', 'status']);

/**
 * Espelha a regra de remapeamento da RPC migrate_workflow_template: mesmo nome
 * (case-insensitive, trim) e mesmo tipo; select/multiselect/status nunca casam;
 * empate resolvido por menor display_order, depois menor id. Usada só na PRÉVIA
 * do diálogo — a escrita real acontece na RPC.
 */
export function matchPropertyDefinitions(
  origem: TemplatePropertyDefinition[],
  destino: TemplatePropertyDefinition[],
): PropertyMatch[] {
  return origem.map((o) => {
    if (OPTION_TYPES.has(o.type)) return { origem: o, destino: null };
    const candidates = destino
      .filter((d) => d.type === o.type && normalize(d.name) === normalize(o.name))
      .sort((a, b) => a.display_order - b.display_order || (a.id ?? 0) - (b.id ?? 0));
    return { origem: o, destino: candidates[0] ?? null };
  });
}

/**
 * Monta o payload p_new_etapas a partir do template destino. deliveryDate só
 * importa para modo_prazo 'data_entrega' (âncora aprovacao_cliente recebe a
 * data; demais recuam/avançam pelos prazos) — null deixa tudo sem data, o
 * mesmo comportamento do wizard quando o cliente não tem dia_entrega.
 */
export function buildMigrationEtapas(
  template: WorkflowTemplate,
  deliveryDate: Date | null,
): MigrationEtapaInput[] {
  const base: MigrationEtapaInput[] = template.etapas.map((e) => ({
    nome: e.nome,
    prazo_dias: e.prazo_dias,
    tipo_prazo: e.tipo_prazo,
    responsavel_id: e.responsavel_id ?? null,
    tipo: e.tipo ?? 'padrao',
    data_limite: null,
  }));

  if ((template.modo_prazo ?? 'padrao') === 'data_entrega' && deliveryDate) {
    const mock: WorkflowEtapa[] = base.map((e, i) => ({
      id: i,
      workflow_id: 0,
      ordem: i,
      nome: e.nome,
      prazo_dias: e.prazo_dias,
      tipo_prazo: e.tipo_prazo,
      responsavel_id: e.responsavel_id,
      tipo: e.tipo,
      status: 'pendente',
      iniciado_em: null,
      concluido_em: null,
    }));
    const deadlines = _computeDeliveryDeadlines(mock, deliveryDate);
    return base.map((e, i) => ({ ...e, data_limite: deadlines.get(i) ?? null }));
  }

  return base;
}

const MIGRATION_ERRORS: Record<string, string> = {
  workspace_not_found: 'Workspace não encontrado. Recarregue a página.',
  workflow_not_found: 'Fluxo não encontrado neste workspace.',
  workflow_changed: 'Este fluxo foi alterado por outra pessoa. Recarregue a página e tente novamente.',
  workflow_not_active: 'Só é possível migrar fluxos ativos.',
  same_template: 'O fluxo já usa este template.',
  template_not_found: 'Template não encontrado neste workspace.',
  invalid_modo_prazo: 'Dados de migração inválidos.',
  empty_etapas: 'O template de destino não tem etapas.',
  invalid_active_ordem: 'Etapa atual inválida para o template de destino.',
  invalid_etapa: 'Dados de migração inválidos.',
  invalid_responsavel: 'Responsável inválido para este workspace.',
};

export function mapMigrationError(message: string): string {
  for (const [code, friendly] of Object.entries(MIGRATION_ERRORS)) {
    if (message.includes(code)) return friendly;
  }
  return 'Não foi possível migrar o template. Tente novamente.';
}

export async function migrateWorkflowTemplate(args: {
  workflowId: number;
  templateId: number;
  etapas: MigrationEtapaInput[];
  activeOrdem: number;
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega';
  /** template_id que o cliente estava vendo (null para adoção); guarda de concorrência da RPC. */
  expectedTemplateId: number | null;
}): Promise<void> {
  const { error } = await supabase.rpc('migrate_workflow_template', {
    p_workflow_id: args.workflowId,
    p_template_id: args.templateId,
    p_new_etapas: args.etapas,
    p_active_ordem: args.activeOrdem,
    p_modo_prazo: args.modoPrazo,
    p_expected_template_id: args.expectedTemplateId,
  });
  if (error) throw new Error(mapMigrationError(error.message));
}
```

Em `apps/crm/src/store/index.ts`, junto dos outros re-exports, adicionar:

```ts
export * from './workflowMigration';
```

Atualizar os dois call sites internos de `_computeDeliveryDeadlines` em `workflows.ts`: nenhum muda (a função mantém o nome). Nada mais a fazer ali.

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run apps/crm/src/store/__tests__/workflowMigration.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS e tsc limpo. Se o teste de `data_entrega` falhar por 1 dia, conferir o esperado contra o comportamento real de `_computeDeliveryDeadlines` (o recuo usa o prazo da etapa SEGUINTE) e corrigir o valor esperado do teste, não a função.

- [ ] **Step 5: Commit**

```bash
git -C /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c add apps/crm/src/store/workflowMigration.ts apps/crm/src/store/workflows.ts apps/crm/src/store/index.ts apps/crm/src/store/__tests__/workflowMigration.test.ts
git -C /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c commit -m "feat(workflows): helpers de migração de template + chamada RPC no store"
```

---

### Task 3: Componente `MigrateTemplateDialog`

**Files:**
- Create: `apps/crm/src/pages/entregas/components/MigrateTemplateDialog.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/MigrateTemplateDialog.test.tsx`

**Interfaces:**
- Consumes (Task 2): `matchPropertyDefinitions`, `buildMigrationEtapas`, `migrateWorkflowTemplate`, `MigrationEtapaInput`; do store existente: `getPropertyDefinitions(templateId): Promise<TemplatePropertyDefinition[]>`, `getWorkflowPostsWithProperties(workflowId)` (de `posts.ts`, retorna posts com `property_values[]`), tipos `Workflow`, `Cliente`, `WorkflowTemplate`; de `../hooks/useEntregasData`: `getNextDeliveryDate(diaEntrega: number): Date`.
- Produces (Task 4 depende): componente com props exatas:

```ts
export function MigrateTemplateDialog(props: {
  workflow: Workflow;
  cliente: Cliente | undefined;
  templates: WorkflowTemplate[];
  onClose: () => void;
  onMigrated: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Escrever o teste do componente (falhando)**

Criar `apps/crm/src/pages/entregas/components/__tests__/MigrateTemplateDialog.test.tsx`. Seguir o padrão dos testes de componente existentes na pasta (`ClientApprovalChoiceDialog.test.tsx`): Testing Library + jsdom, mock do store. Cobrir: (1) templates listados excluem o atual; (2) selecionar destino mostra as etapas e a prévia de propriedades com perdas; (3) confirmar chama `migrateWorkflowTemplate` com o payload certo.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockMigrate = vi.fn().mockResolvedValue(undefined);
const mockGetDefs = vi.fn();
const mockGetPosts = vi.fn();

vi.mock('../../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../../store')>('../../../../store');
  return {
    ...actual,
    migrateWorkflowTemplate: (...a: unknown[]) => mockMigrate(...a),
    getPropertyDefinitions: (...a: unknown[]) => mockGetDefs(...a),
    getWorkflowPostsWithProperties: (...a: unknown[]) => mockGetPosts(...a),
  };
});

import { MigrateTemplateDialog } from '../MigrateTemplateDialog';
import type { Workflow, WorkflowTemplate, TemplatePropertyDefinition } from '../../../../store';

const workflow: Workflow = {
  id: 42,
  cliente_id: 1,
  titulo: 'Fluxo A',
  template_id: 1,
  status: 'ativo',
  etapa_atual: 0,
  recorrente: false,
  modo_prazo: 'padrao',
};

const templates: WorkflowTemplate[] = [
  { id: 1, nome: 'Template A', modo_prazo: 'padrao', etapas: [{ nome: 'Antiga', prazo_dias: 1, tipo_prazo: 'corridos' }] },
  {
    id: 2,
    nome: 'Template B',
    modo_prazo: 'padrao',
    etapas: [
      { nome: 'Roteiro', prazo_dias: 2, tipo_prazo: 'uteis' },
      { nome: 'Aprovação', prazo_dias: 3, tipo_prazo: 'corridos', tipo: 'aprovacao_cliente' },
    ],
  },
];

const defA: TemplatePropertyDefinition[] = [
  { id: 100, template_id: 1, name: 'Tema', type: 'text', config: {}, portal_visible: false, display_order: 0 },
  { id: 101, template_id: 1, name: 'Briefing', type: 'text', config: {}, portal_visible: false, display_order: 1 },
];
const defB: TemplatePropertyDefinition[] = [
  { id: 200, template_id: 2, name: 'tema', type: 'text', config: {}, portal_visible: false, display_order: 0 },
];

function setup() {
  mockGetDefs.mockImplementation((tid: number) => Promise.resolve(tid === 1 ? defA : defB));
  mockGetPosts.mockResolvedValue([
    { id: 7, property_values: [{ property_definition_id: 101, value: 'x' }] },
    { id: 8, property_values: [] },
  ]);
  const onMigrated = vi.fn();
  render(
    <MigrateTemplateDialog
      workflow={workflow}
      cliente={undefined}
      templates={templates}
      onClose={vi.fn()}
      onMigrated={onMigrated}
    />,
  );
  return { onMigrated };
}

beforeEach(() => vi.clearAllMocks());

describe('MigrateTemplateDialog', () => {
  it('não oferece o template atual como destino', async () => {
    setup();
    await userEvent.click(screen.getByRole('combobox', { name: /template de destino/i }));
    expect(screen.queryByRole('option', { name: 'Template A' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Template B' })).toBeTruthy();
  });

  it('mostra prévia: propriedade que migra e a que será perdida com contagem de posts', async () => {
    setup();
    await userEvent.click(screen.getByRole('combobox', { name: /template de destino/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Template B' }));
    await waitFor(() => {
      expect(screen.getByText(/Tema/)).toBeTruthy();
      expect(screen.getByText(/Briefing/)).toBeTruthy();
      expect(screen.getByText(/1 post/)).toBeTruthy(); // só o post 7 tem valor em Briefing
    });
  });

  it('duas definições de origem homônimas casando na mesma de destino viram aviso de conflito', async () => {
    mockGetDefs.mockImplementation((tid: number) =>
      Promise.resolve(
        tid === 1
          ? [
              ...defA,
              { id: 102, template_id: 1, name: 'tema', type: 'text', config: {}, portal_visible: false, display_order: 2 },
            ]
          : defB,
      ),
    );
    mockGetPosts.mockResolvedValue([]);
    render(
      <MigrateTemplateDialog
        workflow={workflow}
        cliente={undefined}
        templates={templates}
        onClose={vi.fn()}
        onMigrated={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: /template de destino/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Template B' }));
    await waitFor(() => {
      expect(screen.getAllByText(/um valor por post será mantido/i).length).toBeGreaterThan(0);
    });
  });

  it('confirmar dispara a RPC com o payload certo e chama onMigrated', async () => {
    const { onMigrated } = setup();
    await userEvent.click(screen.getByRole('combobox', { name: /template de destino/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Template B' }));
    // etapa atual default = primeira (índice 0); confirmar
    await userEvent.click(screen.getByRole('button', { name: /migrar/i }));
    await userEvent.click(await screen.findByRole('button', { name: /confirmar/i }));
    await waitFor(() => {
      expect(mockMigrate).toHaveBeenCalledWith({
        workflowId: 42,
        templateId: 2,
        etapas: [
          { nome: 'Roteiro', prazo_dias: 2, tipo_prazo: 'uteis', responsavel_id: null, tipo: 'padrao', data_limite: null },
          { nome: 'Aprovação', prazo_dias: 3, tipo_prazo: 'corridos', responsavel_id: null, tipo: 'aprovacao_cliente', data_limite: null },
        ],
        activeOrdem: 0,
        modoPrazo: 'padrao',
        expectedTemplateId: 1,
      });
      expect(onMigrated).toHaveBeenCalled();
    });
  });
});
```

Nota ao implementar o teste: se o Select do shadcn/Radix não expuser `role="option"` no jsdom do jeito esperado, seguir o que `ClientApprovalChoiceDialog.test.tsx` ou outros testes da pasta fazem para interagir com Selects (por exemplo `getByText` dentro do content). Ajustar os seletores do teste, não o componente.

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/MigrateTemplateDialog.test.tsx
```

Expected: FAIL (componente não existe).

- [ ] **Step 3: Implementar o componente**

Criar `apps/crm/src/pages/entregas/components/MigrateTemplateDialog.tsx`. Estrutura (padrão visual dos outros modais da pasta: `Dialog` + `Label`/`Select` + rodapé com botões; confirmação final via `AlertDialog`):

```tsx
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  buildMigrationEtapas,
  matchPropertyDefinitions,
  migrateWorkflowTemplate,
  getPropertyDefinitions,
  getWorkflowPostsWithProperties,
  type Cliente,
  type PropertyMatch,
  type Workflow,
  type WorkflowTemplate,
} from '../../../store';
import { getNextDeliveryDate } from '../hooks/useEntregasData';

export function MigrateTemplateDialog({
  workflow,
  cliente,
  templates,
  onClose,
  onMigrated,
}: {
  workflow: Workflow;
  cliente: Cliente | undefined;
  templates: WorkflowTemplate[];
  onClose: () => void;
  onMigrated: () => void;
}) {
  const [destinoId, setDestinoId] = useState<string>('');
  const [activeOrdem, setActiveOrdem] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const candidatos = templates.filter((t) => t.id !== workflow.template_id);
  const destino = candidatos.find((t) => String(t.id) === destinoId);

  const { data: defsOrigem = [] } = useQuery({
    queryKey: ['property-definitions', workflow.template_id],
    queryFn: () => getPropertyDefinitions(workflow.template_id!),
    enabled: workflow.template_id != null,
  });
  const { data: defsDestino = [] } = useQuery({
    queryKey: ['property-definitions', destino?.id],
    queryFn: () => getPropertyDefinitions(destino!.id!),
    enabled: destino?.id != null,
  });
  const { data: posts = [] } = useQuery({
    queryKey: ['workflow-posts-props', workflow.id],
    queryFn: () => getWorkflowPostsWithProperties(workflow.id!),
  });

  const matches = useMemo(
    () => (destino ? matchPropertyDefinitions(defsOrigem, defsDestino) : []),
    [destino, defsOrigem, defsDestino],
  );
  const perdidas = matches.filter((m) => m.destino === null);
  const migram = matches.filter((m) => m.destino !== null);
  // Duas definições de origem homônimas casando com a MESMA de destino: a RPC
  // mantém só um valor por post (menor display_order vence). A prévia precisa
  // dizer isso em vez de mostrar as duas como "preservadas".
  const destinoConflitos = useMemo(() => {
    const counts = new Map<number, number>();
    for (const m of migram) {
      const id = m.destino!.id!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [migram]);
  const temConflito = (m: PropertyMatch) => (destinoConflitos.get(m.destino?.id ?? -1) ?? 0) > 1;
  const postsAfetados = (defId: number) =>
    posts.filter((p) => p.property_values.some((pv) => pv.property_definition_id === defId)).length;

  const etapasNovas = useMemo(() => {
    if (!destino) return [];
    const deliveryDate =
      (destino.modo_prazo ?? 'padrao') === 'data_entrega' && cliente?.dia_entrega
        ? getNextDeliveryDate(cliente.dia_entrega)
        : null;
    return buildMigrationEtapas(destino, deliveryDate);
  }, [destino, cliente]);

  const handleConfirm = async () => {
    if (!destino) return;
    setSaving(true);
    try {
      await migrateWorkflowTemplate({
        workflowId: workflow.id!,
        templateId: destino.id!,
        etapas: etapasNovas,
        activeOrdem,
        modoPrazo: (destino.modo_prazo ?? 'padrao') as 'padrao' | 'data_fixa' | 'data_entrega',
        expectedTemplateId: workflow.template_id ?? null,
      });
      toast.success('Fluxo migrado para o novo template.');
      onMigrated();
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  // render: Dialog com
  //  1. Select "Template de destino" (candidatos; vazio => aviso "Nenhum outro template disponível.")
  //  2. quando destino escolhido: Select "Em qual etapa este fluxo está agora?"
  //     (etapasNovas.map((e, i) => <SelectItem value={String(i)}>{i + 1}. {e.nome}</SelectItem>))
  //  3. prévia: lista das etapas novas (nome + prazo + data_limite quando houver,
  //     formatada pt-BR); bloco "Propriedades" com migram (verde: "Tema · valores
  //     preservados"; quando temConflito(m), âmbar em vez de verde:
  //     "Tema · campos de origem com o mesmo nome: um valor por post será mantido,
  //     os demais serão descartados") e perdidas (vermelho: "Briefing · valores de
  //     N post(s) serão perdidos"); para perdidas dos tipos
  //     select/multiselect/status, sufixo explicando: "opções de seleção não
  //     migram entre templates"; só renderiza o bloco se defsOrigem.length > 0
  //  4. aviso fixo: "Os posts, aprovações e comentários deste fluxo não serão alterados.
  //     A troca de etapas não pode ser desfeita automaticamente."
  //  5. rodapé: Cancelar / botão "Migrar" (disabled sem destino) => abre AlertDialog
  //  AlertDialog: título `Migrar "${workflow.titulo}" para ${destino?.nome}?`,
  //  descrição repete quantas propriedades serão perdidas (se houver),
  //  AlertDialogAction "Confirmar migração" chama handleConfirm (com Spinner quando saving).
}
```

O bloco de comentários acima descreve o JSX a escrever por extenso: implementar exatamente esses 5 blocos usando os componentes shadcn importados, com `Label` ligado ao Select via `aria-label="Template de destino"` no `SelectTrigger` (é o que o teste procura com `getByRole('combobox', { name: /template de destino/i })`). Copy sem em-dash. Ao trocar o destino, resetar `activeOrdem` para 0.

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/MigrateTemplateDialog.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS e tsc limpo.

- [ ] **Step 5: Commit**

```bash
git -C /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c add apps/crm/src/pages/entregas/components/MigrateTemplateDialog.tsx apps/crm/src/pages/entregas/components/__tests__/MigrateTemplateDialog.test.tsx
git -C /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c commit -m "feat(entregas): diálogo de migração de template com prévia de propriedades"
```

---

### Task 4: Wiring no `EditWorkflowModal` e `EntregasPage`

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` (EditWorkflowModal: prop `templates`, botão, estado do diálogo)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (~linha 620: passar `templates`)

**Interfaces:**
- Consumes (Task 3): `MigrateTemplateDialog` com as props documentadas na Task 3.
- Produces: `EditWorkflowModal` ganha a prop obrigatória `templates: WorkflowTemplate[]`.

- [ ] **Step 1: Adicionar prop, botão e diálogo no EditWorkflowModal**

Em `WorkflowModals.tsx`:

1. Imports: adicionar `ArrowRightLeft` ao import de `lucide-react` e `import { MigrateTemplateDialog } from './MigrateTemplateDialog';` junto dos outros imports de componentes locais.
2. Na assinatura de `EditWorkflowModal`, adicionar `templates` (mesmo padrão do `TemplatesModal`):

```ts
export function EditWorkflowModal({
  card,
  membros,
  clientes,
  templates,
  onClose,
  onSaved,
  onDeleted,
  onOpenPosts,
}: {
  card: BoardCard;
  membros: Membro[];
  clientes: Cliente[];
  templates: WorkflowTemplate[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onOpenPosts?: () => void;
}) {
```

3. Estado novo junto dos outros `useState`: `const [migrateOpen, setMigrateOpen] = useState(false);`
4. No `edit-modal-footer-secondary` (ao lado dos botões Excluir/Posts):

```tsx
<Button variant="outline" onClick={() => setMigrateOpen(true)}>
  <ArrowRightLeft className="h-4 w-4" /> Migrar template
</Button>
```

5. Antes do `</>` final do componente (irmão do AlertDialog de exclusão):

```tsx
{migrateOpen && (
  <MigrateTemplateDialog
    workflow={w}
    cliente={card.cliente}
    templates={templates}
    onClose={() => setMigrateOpen(false)}
    onMigrated={() => {
      onSaved();
      onClose();
    }}
  />
)}
```

- [ ] **Step 2: Passar `templates` no EntregasPage**

Em `EntregasPage.tsx` (~linha 620), no uso de `<EditWorkflowModal`, adicionar `templates={templates}` (a variável `templates` já existe no escopo, vem de `useEntregasData`; é a mesma passada ao `TemplatesModal` logo abaixo).

- [ ] **Step 3: Typecheck + suíte inteira do CRM**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run test
```

Expected: tsc limpo; todos os testes Vitest PASS (inclusive `EntregasPage.test.tsx`, que pode quebrar se o EditWorkflowModal for renderizado lá sem a prop nova; se quebrar, adicionar `templates={[]}` ou o mock equivalente NO TESTE existente, seguindo o formato que ele já usa).

- [ ] **Step 4: Commit**

```bash
git -C /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c add apps/crm/src/pages/entregas/components/WorkflowModals.tsx apps/crm/src/pages/entregas/EntregasPage.tsx
git -C /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c commit -m "feat(entregas): botão Migrar template no modal de edição de fluxo"
```

---

### Task 5: Verificação completa + browser + PR

**Files:**
- Modify: nenhum previsto (correções pontuais se a verificação achar problema)

- [ ] **Step 1: Gates completos do CI, na ordem**

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git checkout -- deno.lock
```

Expected: tudo verde. `format:check` falhando: rodar `npm run format` e re-commitar. Depois do `test:functions`, conferir `git status` (deno.lock deve ter sido revertido) e `ls node_modules/.deno` — se existir, rodar `npm ci` dentro do worktree e repetir prettier/tsc antes de confiar neles.

- [ ] **Step 2: Verificação no browser (staging)**

O worktree não tem `.env.staging` por padrão: `cp /Users/eduardosouza/Projects/sm-crm/.env.staging .env.staging` primeiro. A migration precisa existir no banco de staging para o fluxo funcionar de ponta a ponta: `cat supabase/.temp/project-ref` para conferir o link (STAGING = `wlyzhyfondykzpsiqsce`; relinkar se necessário) e `npx supabase db push --linked` **apenas se linkado em staging**, nunca em prod nesta fase. Então subir `npm run dev:staging` via preview e verificar:

1. Abrir /entregas, editar um fluxo que tenha template e posts com propriedades preenchidas (criar fixture se necessário).
2. "Migrar template": destino listado sem o atual; prévia mostra etapas, propriedades que migram e perdidas com contagem.
3. Confirmar; toast de sucesso; board re-renderiza com a escada nova; posts intactos (status/comentários); propriedades casadas visíveis nos posts, órfãs sumiram.
4. Migrar um fluxo sem template (adoção).
5. Capturar screenshot como evidência.

- [ ] **Step 3: Push + PR**

Invocar a skill `superpowers:finishing-a-development-branch`. No PR: descrever a feature, apontar a spec, avisar que a migration `20260819000001` precisa de `db push` em prod ANTES do deploy do frontend (o diálogo chama uma RPC que não existe sem ela). Antes do `gh pr create`, re-rodar `git ls-tree origin/main:supabase/migrations | tail` e renumerar a migration se main ganhou prefixo >= `20260819000001` (regra que já mordeu duas vezes). Lembrar: review externo do Codex dispara sozinho no `gh pr create`; verificar os findings antes de aceitar.
