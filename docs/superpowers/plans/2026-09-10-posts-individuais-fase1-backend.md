# Posts individuais. Fase 1: schema, guards e Hub. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o modelo de dados dos processos individuais, os guards de compatibilidade e as adaptações do Hub e da limpeza, de forma que tudo possa ir a produção com zero processos existentes e sem mudança de comportamento, antes das RPCs de comando (fase 2) e do CRM (fases 3 e 4).

**Architecture:** Três migrations aditivas (flag de plano; quatro tabelas com RLS de escrita negada e triggers de invariante; guard de attach por trigger em `workflow_posts`), duas edge functions do Hub que passam a olhar `post_processes`/`post_process_steps` quando o post não tem fluxo, um guard no cron de limpeza de rascunhos Express, e o helper do Hub frontend que consome o novo array. Nada cria processos ainda: a flag `feature_post_processes` nasce `false` em todos os planos.

**Tech Stack:** Postgres/plpgsql (Supabase), psql (suíte `supabase/tests/entitlements`), Deno edge functions com o mock `test/shared/supabaseMock.ts`, React (Hub) com Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md` (rev 2.1), seções 6.1, 8.1, 8.2, 9.2, 9.3, 10 (Hub, Limpeza) e 11. Fases seguintes: fase 2 = as sete RPCs de comando (§9.1, §9.4, §9.5); fase 3 = leitura no CRM (§4, §5.4, §8.3); fase 4 = comandos e diálogos no CRM (§5) e rollout (§11).

## Global Constraints

- Branch `feat/post-processes-fase1` criada de `origin/main` atualizado. Não depende dos quatro PRs pré-requisito (#478 a #481); pode ser desenvolvida em paralelo, mas só mergear depois deles para não dividir a atenção do rollout.
- Worktree desta sessão: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/instagram-dm-follow-automation-107fe8`. Rodar `pwd` e `git branch --show-current` antes de editar.
- Prefixos de migration únicos e maiores que o último de `origin/main`. Este plano usa `20260918000001`, `20260918000002`, `20260918000003`. Conferir com `git ls-tree --name-only origin/main:supabase/migrations | tail -1` antes de abrir o PR; se `20260917000001` (PR #479) já estiver em main, os prefixos continuam válidos; se algo maior existir, renumerar.
- Códigos de erro: `RAISE EXCEPTION '<codigo>' USING ERRCODE = 'P0001'`, mensagens em identificador (`post_has_active_process`, `post_in_workflow`, `feature_disabled:feature_post_processes`).
- RLS das tabelas novas no padrão `workspace_roles` (`20260903000002`): SELECT para membros da conta via `get_my_conta_id()`; INSERT/UPDATE/DELETE com `WITH CHECK (false)` / `USING (false)` para `authenticated`; `service_role` com bypass explícito. Tabelas expõem `UNIQUE (id, conta_id)` para FKs compostas de tenant.
- FKs compostas só com `workflow_posts(id, conta_id)` e entre as tabelas novas. `template_id`, `origem_workflow_id` e `responsavel_id` são FKs simples com `ON DELETE SET NULL` e validação de conta nas RPCs (fase 2).
- Comentários SQL em português sem acentos (padrão dos arquivos de migration); TS/TSX em português com acentos; sem travessão em texto visível.
- Suítes SQL seguem `supabase/tests/entitlements/71_board_ordem.sql` e `75_permission_rls_rewire.sql`: `\set ON_ERROR_STOP on`, `\i supabase/tests/entitlements/_helpers.sql`, blocos `begin; do $$ ... $$; rollback;`, `et_make_workspace(...)`, impersonação com `set_config('request.jwt.claims', ...)` + `set local role authenticated` precedida de `et_grant_hosted_parity()`, `raise notice 'PASS NN.M ...'`. Se o Supabase local não subir (conflito de portas com outro worktree), a suíte roda no job `entitlement-tests` do CI; dizer isso no relatório.
- Deno: `npm run test:functions` (roda com `--no-check`) e `npm run check:functions`. Testes em `supabase/functions/__tests__/*_test.ts` com `./assert.ts` e `createSupabaseQueryMock` de `test/shared/supabaseMock.ts`. Respostas do mock são filas por `tabela:operacao`, consumidas na ORDEM em que o handler consulta.
- Antes de `git push`: `npm run lint`, `npm run format:check`, os quatro typechecks, `npm run test`, `npm run test:functions`, `npm run check:functions`. Se `ls node_modules/.deno` existir, `npm ci` antes de confiar em tsc/vitest.
- Commits terminam com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. PR body termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Deploy de edge functions: `--use-api --no-verify-jwt --project-ref <ref>` (staging `wlyzhyfondykzpsiqsce`, prod `skjzpekeqefvlojenfsw`). Nova coluna `feature_*` exige redeploy de `workspace-limits`.

---

### Task 1: Flag de plano `feature_post_processes`

**Files:**
- Create: `supabase/migrations/20260918000001_plans_feature_post_processes.sql`
- Modify: `supabase/functions/_shared/entitlements.ts:14-21` (array `FEATURE_COLUMNS`)
- Test: `supabase/functions/__tests__/entitlements_feature_post_processes_test.ts`

**Interfaces:**
- Produces: coluna `plans.feature_post_processes boolean not null default false`; a string `"feature_post_processes"` em `FEATURE_COLUMNS`, que `resolveEntitlements`/`assertPlanFeature` passam a conhecer.

- [ ] **Step 1: Escrever o teste Deno que falha**

```ts
// supabase/functions/__tests__/entitlements_feature_post_processes_test.ts
import { assert } from "./assert.ts";
import { FEATURE_COLUMNS } from "../_shared/entitlements.ts";

Deno.test("FEATURE_COLUMNS conhece feature_post_processes", () => {
  assert(
    (FEATURE_COLUMNS as readonly string[]).includes("feature_post_processes"),
    "feature_post_processes precisa estar em FEATURE_COLUMNS para o plano e o override resolverem a flag",
  );
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/entitlements_feature_post_processes_test.ts`
Expected: FAIL com a mensagem da asserção.

- [ ] **Step 3: Migration e constante**

```sql
-- supabase/migrations/20260918000001_plans_feature_post_processes.sql
-- Flag de rollout dos processos individuais de producao (spec
-- 2026-09-10-posts-individuais-fluxos-design.md, secao 11). Nasce false em
-- todos os planos e so e ligada por workspace via
-- workspace_plan_overrides.feature_overrides (Admin da plataforma), no mesmo
-- desenho de feature_instagram_automation (20260815000002). O gate de
-- criacao (BEFORE INSERT em post_processes) vem em 20260918000002; desligar
-- a flag bloqueia so execucoes novas.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS feature_post_processes boolean NOT NULL DEFAULT false;
```

Em `supabase/functions/_shared/entitlements.ts`, acrescentar `"feature_post_processes",` ao final do array `FEATURE_COLUMNS` (depois de `"feature_briefing_audio"`).

- [ ] **Step 4: Rodar o teste e o check**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/entitlements_feature_post_processes_test.ts && npm run check:functions`
Expected: PASS; check sem erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918000001_plans_feature_post_processes.sql supabase/functions/_shared/entitlements.ts supabase/functions/__tests__/entitlements_feature_post_processes_test.ts
git commit -m "feat(plans): flag feature_post_processes desligada em todos os planos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Tabelas de processo individual, invariantes e RLS

**Files:**
- Create: `supabase/migrations/20260918000002_post_processes_schema.sql`
- Test: `supabase/tests/entitlements/83_post_processes_schema.sql`

**Interfaces:**
- Produces: tabelas `post_processes`, `post_process_steps`, `post_process_events`, `post_process_batch_requests` com as colunas da spec §8.1; triggers `post_processes_set_updated_at`, `post_processes_set_concluido_em`, `post_processes_requires_avulso` (erro `post_in_workflow`), `trg_feature_post_processes` (gate de plano); índices `post_processes_one_vigente_per_post` (parcial), `post_process_steps_one_active` (parcial); RLS e grants. A fase 2 escreve nessas tabelas só por RPC `SECURITY DEFINER`.

- [ ] **Step 1: Escrever a suíte SQL que falha**

```sql
-- supabase/tests/entitlements/83_post_processes_schema.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Schema dos processos individuais (migration 20260918000002). Cobre:
-- 83.0 unicidade parcial: um so processo vigente por post
-- 83.1 processo exige post avulso (post_in_workflow)
-- 83.2 FK composta de tenant rejeita post de outra conta
-- 83.3 RLS: membro le a propria conta, nao ve outra, nao escreve
-- 83.4 gate de plano: flag false bloqueia INSERT, flag true libera
-- 83.5 unicidade de ordem por processo e uma so etapa ativa
-- 83.6 concluido_em pela trigger

-- fixture comum: conta com plano max (flag ligada dentro da transacao)
create or replace function pg_temp.et_pp_fixture(out ws uuid, out usr uuid, out cli bigint, out post bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (ws, cli, 'avulso') returning id into post;
end $$;

-- 83.0
begin;
do $$
declare f record; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into post_processes (conta_id, post_id, assinatura, estado) values (f.ws, f.post, '0|Copy|padrao', 'ativo');
  begin
    insert into post_processes (conta_id, post_id, assinatura, estado) values (f.ws, f.post, '0|Copy|padrao', 'concluido');
  exception when unique_violation then v_raised := true;
  end;
  assert v_raised, 'segundo processo vigente para o mesmo post deve violar post_processes_one_vigente_per_post';
  -- um encerrado convive com o vigente
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento) values (f.ws, f.post, '0|Copy|padrao', 'encerrado', 'removido');
  raise notice 'PASS 83.0 um processo vigente por post';
end $$;
rollback;

-- 83.1
begin;
do $$
declare f record; v_wf bigint; v_post_in_wf bigint; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (f.usr, f.ws, f.cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf, f.ws, 'no fluxo') returning id into v_post_in_wf;
  begin
    insert into post_processes (conta_id, post_id, assinatura) values (f.ws, v_post_in_wf, '0|Copy|padrao');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_in_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'processo para post em fluxo deve levantar post_in_workflow';
  raise notice 'PASS 83.1 processo exige post avulso';
end $$;
rollback;

-- 83.2
begin;
do $$
declare f record; g record; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  select * into g from pg_temp.et_pp_fixture();
  begin
    insert into post_processes (conta_id, post_id, assinatura) values (f.ws, g.post, '0|Copy|padrao');
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'post de outra conta deve violar a FK composta (post_id, conta_id)';
  raise notice 'PASS 83.2 FK composta de tenant';
end $$;
rollback;

-- 83.3
begin;
do $$
declare f record; g record; v_proc bigint; v_seen int; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  select * into g from pg_temp.et_pp_fixture();
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, estado) values (f.ws, v_proc, 0, 'Copy', 'ativo');
  insert into post_process_events (conta_id, post_id, process_id, evento) values (f.ws, f.post, v_proc, 'aplicado');
  perform et_grant_hosted_parity();

  -- membro da conta f le
  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_seen from post_processes;
  assert v_seen = 1, format('membro deve ver 1 processo, viu %s', v_seen);
  select count(*) into v_seen from post_process_steps;
  assert v_seen = 1, 'membro deve ver a etapa';
  select count(*) into v_seen from post_process_events;
  assert v_seen = 1, 'membro deve ver o evento';
  begin
    insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, 'x');
    v_raised := false;
  exception when others then v_raised := true; -- RLS (42501) ou grant: o que importa e falhar
  end;
  assert v_raised, 'authenticated nao pode inserir em post_processes';
  begin
    update post_processes set estado = 'concluido' where id = v_proc;
    get diagnostics v_seen = row_count;
  end;
  assert v_seen = 0, 'authenticated nao pode atualizar post_processes (0 linhas)';
  execute 'reset role';

  -- membro da conta g nao ve nada de f
  perform set_config('request.jwt.claims', json_build_object('sub', g.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_seen from post_processes;
  assert v_seen = 0, format('outra conta deve ver 0, viu %s', v_seen);
  execute 'reset role';
  raise notice 'PASS 83.3 RLS';
end $$;
rollback;

-- 83.4
begin;
do $$
declare f record; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  update plans set feature_post_processes = false where id = (select plan_id from workspaces where id = f.ws);
  begin
    insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_post_processes%', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'flag false deve bloquear INSERT em post_processes';
  update workspace_plan_overrides set feature_overrides = coalesce(feature_overrides, '{}'::jsonb) || '{"feature_post_processes": true}'::jsonb where workspace_id = f.ws;
  if not found then
    insert into workspace_plan_overrides (workspace_id, feature_overrides) values (f.ws, '{"feature_post_processes": true}'::jsonb);
  end if;
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao');
  raise notice 'PASS 83.4 gate de plano com override';
end $$;
rollback;

-- 83.5
begin;
do $$
declare f record; v_proc bigint; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, estado) values (f.ws, v_proc, 0, 'Copy', 'ativo');
  begin
    insert into post_process_steps (conta_id, process_id, ordem, nome) values (f.ws, v_proc, 0, 'Copy de novo');
  exception when unique_violation then v_raised := true;
  end;
  assert v_raised, 'ordem repetida no mesmo processo deve violar unique';
  v_raised := false;
  begin
    insert into post_process_steps (conta_id, process_id, ordem, nome, estado) values (f.ws, v_proc, 1, 'Design', 'ativo');
  exception when unique_violation then v_raised := true;
  end;
  assert v_raised, 'segunda etapa ativa no mesmo processo deve violar post_process_steps_one_active';
  raise notice 'PASS 83.5 unicidade de ordem e de etapa ativa';
end $$;
rollback;

-- 83.6
begin;
do $$
declare f record; v_proc bigint; v_ts timestamptz;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc;
  update post_processes set estado = 'concluido' where id = v_proc;
  select concluido_em into v_ts from post_processes where id = v_proc;
  assert v_ts is not null, 'concluido deve carimbar concluido_em';
  update post_processes set estado = 'ativo' where id = v_proc;
  select concluido_em into v_ts from post_processes where id = v_proc;
  assert v_ts is null, 'reabrir deve limpar concluido_em';
  raise notice 'PASS 83.6 concluido_em';
end $$;
rollback;
```

Nota para o implementador: o bloco 83.3 espera que o UPDATE por `authenticated` afete 0 linhas (RLS `USING (false)`), e que o INSERT falhe. Se o INSERT falhar por `insufficient_privilege` (grant) em vez de RLS, a asserção ainda passa; o que a migration garante é que ele falha.

- [ ] **Step 2: Rodar a suíte e confirmar que falha**

Com Supabase local: `npx supabase start` (se as portas estiverem livres) e `bash scripts/test-entitlements.sh`.
Expected: FAIL em 83.0 com `relation "post_processes" does not exist`. Sem Docker: seguir; o CI valida.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260918000002_post_processes_schema.sql
-- Processos individuais de producao (spec 2026-09-10-posts-individuais-
-- fluxos-design.md, secao 8). Evolucao aditiva: workflow_posts.workflow_id
-- continua significando so pertencimento a um fluxo; um post avulso pode ter
-- no maximo UMA execucao vigente (ativo ou concluido) aqui. Escrita de
-- cliente e negada por RLS; toda mutacao vem das RPCs SECURITY DEFINER da
-- fase 2. Nenhum backfill: nada cria processos para posts existentes.

-- ------------------------------------------------------------------
-- 1. post_processes: a execucao individual
-- ------------------------------------------------------------------
CREATE TABLE public.post_processes (
  id                  bigserial PRIMARY KEY,
  conta_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id             bigint NOT NULL,
  template_id         bigint REFERENCES public.workflow_templates(id) ON DELETE SET NULL,
  template_nome       text,
  assinatura          text NOT NULL,
  origem_workflow_id  bigint REFERENCES public.workflows(id) ON DELETE SET NULL,
  origem_descricao    text,
  estado              text NOT NULL DEFAULT 'ativo'
                        CHECK (estado IN ('ativo', 'concluido', 'encerrado')),
  motivo_encerramento text CHECK (motivo_encerramento IN ('removido', 'vinculado')),
  etapa_atual         integer NOT NULL DEFAULT 0,
  modo_prazo          text NOT NULL DEFAULT 'padrao'
                        CHECK (modo_prazo IN ('padrao', 'data_fixa', 'data_entrega')),
  board_position      integer NOT NULL DEFAULT 0,
  revisao             integer NOT NULL DEFAULT 1,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  concluido_em        timestamptz,
  -- Alvo de FK composta de tenant para steps e events.
  CONSTRAINT post_processes_id_conta_uq UNIQUE (id, conta_id),
  -- O post precisa ser da mesma conta (workflow_posts_id_conta_uq, 20260820000002).
  CONSTRAINT post_processes_post_same_tenant
    FOREIGN KEY (post_id, conta_id) REFERENCES public.workflow_posts (id, conta_id) ON DELETE CASCADE,
  -- encerrado <=> motivo presente
  CONSTRAINT post_processes_encerrado_motivo
    CHECK ((estado = 'encerrado') = (motivo_encerramento IS NOT NULL))
);

-- Um so processo vigente por post; encerrados podem se acumular.
CREATE UNIQUE INDEX post_processes_one_vigente_per_post
  ON public.post_processes (post_id) WHERE estado IN ('ativo', 'concluido');
CREATE INDEX idx_post_processes_conta_estado ON public.post_processes (conta_id, estado);
CREATE INDEX idx_post_processes_post ON public.post_processes (post_id);

-- ------------------------------------------------------------------
-- 2. post_process_steps: etapas instanciadas (snapshot)
-- ------------------------------------------------------------------
CREATE TABLE public.post_process_steps (
  id                  bigserial PRIMARY KEY,
  conta_id            uuid NOT NULL,
  process_id          bigint NOT NULL,
  ordem               integer NOT NULL,
  nome                text NOT NULL,
  tipo                text NOT NULL DEFAULT 'padrao' CHECK (tipo IN ('padrao', 'aprovacao_cliente')),
  responsavel_id      bigint REFERENCES public.membros(id) ON DELETE SET NULL,
  prazo_dias          integer,
  tipo_prazo          text CHECK (tipo_prazo IN ('uteis', 'corridos')),
  prazo_efetivo       timestamptz,
  estado              text NOT NULL DEFAULT 'pendente'
                        CHECK (estado IN ('pendente', 'ativo', 'concluido', 'herdado', 'ignorado', 'interrompido')),
  iniciado_em         timestamptz,
  concluido_em        timestamptz,
  interrompido_em     timestamptz,
  -- Proveniencia herdada por snapshot: ids de workflow_etapas nao sao
  -- estaveis (migrate_workflow_template apaga e reinsere).
  origem_etapa_ordem  integer,
  origem_etapa_nome   text,
  CONSTRAINT post_process_steps_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT post_process_steps_process_same_tenant
    FOREIGN KEY (process_id, conta_id) REFERENCES public.post_processes (id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_process_steps_ordem_uq UNIQUE (process_id, ordem)
);
CREATE UNIQUE INDEX post_process_steps_one_active
  ON public.post_process_steps (process_id) WHERE estado = 'ativo';

-- ------------------------------------------------------------------
-- 3. post_process_events: historico
-- ------------------------------------------------------------------
CREATE TABLE public.post_process_events (
  id             bigserial PRIMARY KEY,
  conta_id       uuid NOT NULL,
  post_id        bigint NOT NULL,
  process_id     bigint NOT NULL,
  evento         text NOT NULL CHECK (evento IN (
                   'desmembrado', 'aplicado', 'avancou', 'voltou', 'concluido',
                   'reaberto', 'removido', 'vinculado', 'etapa_editada')),
  actor_user_id  uuid,
  actor_name     text,
  origem         text NOT NULL DEFAULT 'workspace_user' CHECK (origem IN ('workspace_user', 'system')),
  antes          jsonb,
  depois         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_process_events_post_same_tenant
    FOREIGN KEY (post_id, conta_id) REFERENCES public.workflow_posts (id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_process_events_process_same_tenant
    FOREIGN KEY (process_id, conta_id) REFERENCES public.post_processes (id, conta_id) ON DELETE CASCADE
);
-- Empates de now() na mesma transacao desempatam por id.
CREATE INDEX idx_post_process_events_post ON public.post_process_events (post_id, created_at, id);

-- ------------------------------------------------------------------
-- 4. post_process_batch_requests: idempotencia do desmembrar em lote
-- ------------------------------------------------------------------
CREATE TABLE public.post_process_batch_requests (
  request_id  uuid PRIMARY KEY,
  conta_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  resultado   jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- 5. Triggers de invariante
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_processes_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at := now();
  RETURN new;
END;
$$;
CREATE TRIGGER post_processes_set_updated_at
  BEFORE UPDATE ON public.post_processes
  FOR EACH ROW EXECUTE FUNCTION public.post_processes_set_updated_at();

-- Mesmo desenho de set_workflow_concluido_em (20260903000010).
CREATE OR REPLACE FUNCTION public.set_post_process_concluido_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF old.estado IS DISTINCT FROM new.estado THEN
    IF new.estado = 'concluido' THEN
      new.concluido_em := now();
    ELSIF old.estado = 'concluido' AND new.estado = 'ativo' THEN
      new.concluido_em := NULL;
    END IF;
  END IF;
  RETURN new;
END;
$$;
CREATE TRIGGER post_processes_set_concluido_em
  BEFORE UPDATE ON public.post_processes
  FOR EACH ROW EXECUTE FUNCTION public.set_post_process_concluido_em();

-- Um processo so nasce para post avulso (uma unica fonte de contexto de
-- producao, spec secao 1).
CREATE OR REPLACE FUNCTION public.post_processes_requires_avulso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM workflow_posts wp
     WHERE wp.id = new.post_id AND wp.conta_id = new.conta_id AND wp.workflow_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'post_in_workflow' USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END;
$$;
CREATE TRIGGER post_processes_requires_avulso
  BEFORE INSERT ON public.post_processes
  FOR EACH ROW EXECUTE FUNCTION public.post_processes_requires_avulso();

-- Gate de plano, so em INSERT: desligar a flag bloqueia execucoes novas e
-- mantem as existentes (politica pos-downgrade da casa, 20260611140002).
CREATE TRIGGER trg_feature_post_processes
  BEFORE INSERT ON public.post_processes
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_feature('feature_post_processes', 'direct', 'conta_id');

-- ------------------------------------------------------------------
-- 6. RLS e grants (padrao workspace_roles, 20260903000002)
-- ------------------------------------------------------------------
ALTER TABLE public.post_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_process_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_process_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_process_batch_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY pp_select_member ON public.post_processes
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY pp_no_client_insert ON public.post_processes FOR INSERT WITH CHECK (false);
CREATE POLICY pp_no_client_update ON public.post_processes FOR UPDATE USING (false);
CREATE POLICY pp_no_client_delete ON public.post_processes FOR DELETE USING (false);
CREATE POLICY service_role_bypass_post_processes ON public.post_processes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY pps_select_member ON public.post_process_steps
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY pps_no_client_insert ON public.post_process_steps FOR INSERT WITH CHECK (false);
CREATE POLICY pps_no_client_update ON public.post_process_steps FOR UPDATE USING (false);
CREATE POLICY pps_no_client_delete ON public.post_process_steps FOR DELETE USING (false);
CREATE POLICY service_role_bypass_post_process_steps ON public.post_process_steps
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY ppe_select_member ON public.post_process_events
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY ppe_no_client_insert ON public.post_process_events FOR INSERT WITH CHECK (false);
CREATE POLICY ppe_no_client_update ON public.post_process_events FOR UPDATE USING (false);
CREATE POLICY ppe_no_client_delete ON public.post_process_events FOR DELETE USING (false);
CREATE POLICY service_role_bypass_post_process_events ON public.post_process_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Recibos de lote nao sao lidos pelo cliente: sem SELECT para membros.
CREATE POLICY service_role_bypass_post_process_batch_requests ON public.post_process_batch_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grants explicitos (o default ACL hosted daria ALL a authenticated; o
-- REVOKE abaixo tambem tira do service_role, por isso o re-GRANT).
REVOKE ALL ON TABLE public.post_processes, public.post_process_steps,
  public.post_process_events, public.post_process_batch_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.post_processes, public.post_process_steps, public.post_process_events TO authenticated;
GRANT ALL ON TABLE public.post_processes, public.post_process_steps,
  public.post_process_events, public.post_process_batch_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.post_processes_id_seq, public.post_process_steps_id_seq,
  public.post_process_events_id_seq TO service_role;
```

- [ ] **Step 4: Rodar a suíte e confirmar que passa**

Run: `bash scripts/test-entitlements.sh`
Expected: `PASS 83.0` a `PASS 83.6`. Se o bloco 83.4 falhar porque `workspace_plan_overrides` tem outra forma (conferir `20260501000002_platform_admin_tables.sql:18`), ajustar o UPSERT do teste, não a migration. Sem Docker, deixar o CI e dizer isso no relatório.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918000002_post_processes_schema.sql supabase/tests/entitlements/83_post_processes_schema.sql
git commit -m "feat(db): tabelas de processo individual com invariantes, gate de plano e RLS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Guard de attach por trigger em `workflow_posts`

**Files:**
- Create: `supabase/migrations/20260918000003_post_process_attach_guard.sql`
- Test: `supabase/tests/entitlements/84_post_process_attach_guard.sql`

**Interfaces:**
- Produces: trigger `post_a1_process_guard` (BEFORE UPDATE OF `workflow_id` em `workflow_posts`) que levanta `post_has_active_process` quando o post ganha um `workflow_id` não nulo tendo execução `ativo` ou `concluido`. Cobre `attach_posts_to_flow`, `move_posts_to_new_flow`, `move_posts_to_existing_flow` e qualquer caminho futuro, sem editar essas RPCs. A fase 2 fecha o processo ANTES do attach dentro de `attach_post_closing_process`, então o trigger passa naturalmente.

- [ ] **Step 1: Escrever a suíte SQL que falha**

```sql
-- supabase/tests/entitlements/84_post_process_attach_guard.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Guard de attach (migration 20260918000003): um post com execucao vigente
-- nao entra em fluxo por nenhum dos caminhos sancionados.
-- 84.0 attach_posts_to_flow -> post_has_active_process, nada muda
-- 84.1 processo encerrado nao bloqueia
-- 84.2 move_posts_to_existing_flow com post que ganhou processo entre a
--      leitura e o lock (simulado: processo criado antes) -> mesmo erro
-- 84.3 UPDATE direto com o GUC ligado tambem cai no guard (o guard vale
--      mesmo para quem contorna post_a0_sync_cliente)

create or replace function pg_temp.et_pp_ctx(out ws uuid, out usr uuid, out cli bigint, out post bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (ws, cli, 'avulso') returning id into post;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (usr, ws, cli, 'WF', 'ativo') returning id into wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias) values (wf, 0, 'Unica', 1);
end $$;

-- 84.0
begin;
do $$
declare c record; v_raised boolean := false; v_wf bigint;
begin
  select * into c from pg_temp.et_pp_ctx();
  insert into post_processes (conta_id, post_id, assinatura) values (c.ws, c.post, '0|Copy|padrao');
  perform set_config('request.jwt.claims', json_build_object('sub', c.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_posts_to_flow(array[c.post], c.wf);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'attach com processo vigente deve levantar post_has_active_process';
  select workflow_id into v_wf from workflow_posts where id = c.post;
  assert v_wf is null, 'post deve continuar avulso';
  raise notice 'PASS 84.0 attach bloqueado';
end $$;
rollback;

-- 84.1
begin;
do $$
declare c record; v_wf bigint;
begin
  select * into c from pg_temp.et_pp_ctx();
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento) values (c.ws, c.post, '0|Copy|padrao', 'encerrado', 'removido');
  perform set_config('request.jwt.claims', json_build_object('sub', c.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform attach_posts_to_flow(array[c.post], c.wf);
  execute 'reset role';
  select workflow_id into v_wf from workflow_posts where id = c.post;
  assert v_wf = c.wf, 'processo encerrado nao bloqueia o attach';
  raise notice 'PASS 84.1 encerrado nao bloqueia';
end $$;
rollback;

-- 84.2: o guard dispara em qualquer UPDATE que de workflow_id, inclusive o
-- caminho das RPCs de mover (move_posts_core liga o mesmo GUC)
begin;
do $$
declare c record; v_raised boolean := false; v_wf bigint;
begin
  select * into c from pg_temp.et_pp_ctx();
  insert into post_processes (conta_id, post_id, assinatura) values (c.ws, c.post, '0|Copy|padrao');
  perform set_config('app.allow_post_move', 'on', true);
  begin
    update workflow_posts set workflow_id = c.wf where id = c.post;
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'UPDATE direto de workflow_id com processo vigente deve cair no guard mesmo com o GUC ligado';
  select workflow_id into v_wf from workflow_posts where id = c.post;
  assert v_wf is null, 'post deve continuar avulso';
  raise notice 'PASS 84.2 guard independe do GUC';
end $$;
rollback;

-- 84.3: sem processo, o UPDATE com GUC continua passando (nao regredir detach/attach)
begin;
do $$
declare c record; v_wf bigint;
begin
  select * into c from pg_temp.et_pp_ctx();
  perform set_config('app.allow_post_move', 'on', true);
  update workflow_posts set workflow_id = c.wf where id = c.post;
  select workflow_id into v_wf from workflow_posts where id = c.post;
  assert v_wf = c.wf, 'sem processo o attach direto segue funcionando';
  raise notice 'PASS 84.3 sem processo nada muda';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `bash scripts/test-entitlements.sh`
Expected: 84.0 falha porque `attach_posts_to_flow` conclui o attach (nenhum erro). Sem Docker: seguir; o CI valida.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260918000003_post_process_attach_guard.sql
-- Um post com execucao vigente (ativo ou concluido) em post_processes nao
-- pode ganhar workflow_id: os quatro caminhos que colocam post em fluxo
-- (attach_posts_to_flow, move_posts_to_new_flow, move_posts_to_existing_flow
-- e qualquer UPDATE com app.allow_post_move) passam por este trigger, que
-- dispara DEPOIS de post_a0_sync_cliente (ordem alfabetica). A RPC da fase 2
-- que vincula encerra a execucao antes do attach, na mesma transacao, e por
-- isso passa. Nao usa GUC de escape: o guard vale para todo mundo.
CREATE OR REPLACE FUNCTION public.post_a1_process_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.workflow_id IS NOT NULL
     AND new.workflow_id IS DISTINCT FROM old.workflow_id
     AND EXISTS (
       SELECT 1 FROM post_processes pp
        WHERE pp.post_id = new.id
          AND pp.conta_id = new.conta_id
          AND pp.estado IN ('ativo', 'concluido')
     ) THEN
    RAISE EXCEPTION 'post_has_active_process' USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS post_a1_process_guard ON public.workflow_posts;
CREATE TRIGGER post_a1_process_guard
  BEFORE UPDATE OF workflow_id ON public.workflow_posts
  FOR EACH ROW EXECUTE FUNCTION public.post_a1_process_guard();
```

- [ ] **Step 4: Rodar a suíte e confirmar que passa**

Run: `bash scripts/test-entitlements.sh`
Expected: `PASS 84.0` a `PASS 84.3`, e as suítes 70 e 72 (detach/attach/move existentes) continuam verdes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918000003_post_process_attach_guard.sql supabase/tests/entitlements/84_post_process_attach_guard.sql
git commit -m "feat(db): guard post_has_active_process em toda mudanca de workflow_id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `hub-approve` respeita etapas de aprovação do processo individual

**Files:**
- Modify: `supabase/functions/hub-approve/handler.ts:11-38` (`isFinalApprovalCycle`) e a chamada em `:120`
- Test: `supabase/functions/__tests__/hub-functions_test.ts` (acrescentar três testes)

**Interfaces:**
- Consumes: tabelas `post_processes(id, post_id, estado)` e `post_process_steps(process_id, tipo, estado)` da Task 2.
- Produces: `isFinalApprovalCycle(db, post: { id: number; workflow_id: number | null })` (assinatura muda de `workflowId` para o post); regra: com fluxo, como hoje; sem fluxo, conta etapas `aprovacao_cliente` com estado `pendente` ou `ativo` da execução `ativo` e retorna `< 2`; sem execução, `true`; erro de consulta, `false`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `hub-functions_test.ts` (o mock consome respostas na ordem das consultas: `client_hub_tokens` → `workflow_posts` → `clientes` → `post_processes` → `post_process_steps` → `validateForScheduling`):

```ts
Deno.test("hub-approve não autoagenda avulso com processo individual que ainda tem outra aprovação adiante", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: null, status: "enviado_cliente", is_express: false, cliente_id: 14, conta_id: "conta-1" },
    error: null,
  });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  db.queue("post_processes", "select", { data: { id: 5 }, error: null });
  db.queue("post_process_steps", "select", {
    data: [
      { tipo: "padrao", estado: "concluido" },
      { tipo: "aprovacao_cliente", estado: "ativo" },
      { tipo: "padrao", estado: "pendente" },
      { tipo: "aprovacao_cliente", estado: "pendente" },
    ],
    error: null,
  });
  queueValidateForScheduling(db, {
    id: 99, scheduled_at: "2030-01-01T10:00:00.000Z", ig_caption: "legenda", workflow_id: null, cliente_id: 14, tipo: "feed",
  });
  const handler = createHubApproveHandler({ buildCorsHeaders, createDb: () => db as never, now, rateLimit: async () => true });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST", body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  assertEquals(response.status, 200);
  const body = await readJson(response);
  assertEquals(body.scheduled, false);
  assertEquals(db.calls.find((c: { table: string }) => c.table === "rpc:record_post_status_change"), undefined);
});

Deno.test("hub-approve autoagenda avulso com processo individual na última aprovação", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: null, status: "enviado_cliente", is_express: false, cliente_id: 14, conta_id: "conta-1" },
    error: null,
  });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  db.queue("post_processes", "select", { data: { id: 5 }, error: null });
  db.queue("post_process_steps", "select", {
    data: [
      { tipo: "aprovacao_cliente", estado: "herdado" },
      { tipo: "padrao", estado: "concluido" },
      { tipo: "aprovacao_cliente", estado: "ativo" },
    ],
    error: null,
  });
  queueValidateForScheduling(db, {
    id: 99, scheduled_at: "2030-01-01T10:00:00.000Z", ig_caption: "legenda", workflow_id: null, cliente_id: 14, tipo: "feed",
  });
  db.queueRpc("record_post_status_change", { data: true, error: null });
  const handler = createHubApproveHandler({ buildCorsHeaders, createDb: () => db as never, now, rateLimit: async () => true });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST", body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  const body = await readJson(response);
  assertEquals(body.scheduled, true);
});

Deno.test("hub-approve falha fechado quando a consulta do processo individual erra", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: null, status: "enviado_cliente", is_express: false, cliente_id: 14, conta_id: "conta-1" },
    error: null,
  });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  db.queue("post_processes", "select", { data: null, error: { message: "db offline" } });
  const handler = createHubApproveHandler({ buildCorsHeaders, createDb: () => db as never, now, rateLimit: async () => true });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST", body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  const body = await readJson(response);
  assertEquals(body.ok, true);
  assertEquals(body.scheduled, false);
});
```

Atenção: os testes existentes de avulso que hoje esperam `scheduled: true` (grep `workflow_id: null` no arquivo, perto de "avulso") passam a precisar de uma resposta enfileirada `db.queue("post_processes", "select", { data: null, error: null })` antes de `queueValidateForScheduling`. Conferir o que o mock devolve quando a fila está vazia (`test/shared/supabaseMock.ts`, `QueryBuilder.execute`) e ajustar esses testes conforme o caso, explicando no relatório.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:functions -- --filter "hub-approve"`
Expected: os dois primeiros novos falham (`scheduled` errado ou fila desalinhada); o terceiro falha porque hoje avulso é sempre final.

- [ ] **Step 3: Implementar**

Substituir `isFinalApprovalCycle` por:

```ts
// Fluxos: conta etapas aprovacao_cliente abertas do fluxo. Avulso: se houver
// execucao individual ativa (post_processes), conta as etapas de aprovacao
// dela que ainda nao passaram (pendente ou ativo); herdado, ignorado e
// concluido nao contam. Sem execucao, avulso e final como sempre foi. Toda
// falha de consulta fecha (nao autoagenda), como no ramo dos fluxos.
async function isFinalApprovalCycle(
  db: DbClient,
  post: { id: number; workflow_id: number | null },
): Promise<boolean> {
  if (post.workflow_id != null) {
    const { data: etapas, error } = await db
      .from("workflow_etapas")
      .select("tipo, status")
      .eq("workflow_id", post.workflow_id);
    if (error) {
      console.error("[hub-approve] etapa lookup failed:", error);
      return false;
    }
    const openApprovalEtapas = ((etapas ?? []) as { tipo?: string | null; status?: string | null }[])
      .filter((e) => e.tipo === "aprovacao_cliente" && e.status !== "concluido").length;
    return openApprovalEtapas < 2;
  }

  const { data: proc, error: procError } = await db
    .from("post_processes")
    .select("id")
    .eq("post_id", post.id)
    .eq("estado", "ativo")
    .maybeSingle();
  if (procError) {
    console.error("[hub-approve] post_processes lookup failed:", procError);
    return false;
  }
  if (!proc) return true;

  const { data: steps, error: stepsError } = await db
    .from("post_process_steps")
    .select("tipo, estado")
    .eq("process_id", (proc as { id: number }).id);
  if (stepsError) {
    console.error("[hub-approve] post_process_steps lookup failed:", stepsError);
    return false;
  }
  const openApprovalSteps = ((steps ?? []) as { tipo?: string | null; estado?: string | null }[])
    .filter((s) => s.tipo === "aprovacao_cliente" && (s.estado === "pendente" || s.estado === "ativo")).length;
  return openApprovalSteps < 2;
}
```

e a chamada: `(await isFinalApprovalCycle(db, post))` no lugar de `(await isFinalApprovalCycle(db, post.workflow_id))`.

- [ ] **Step 4: Rodar tudo**

Run: `npm run test:functions && npm run check:functions`
Expected: verde, inclusive os testes de avulso ajustados.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-approve/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub-approve): processo individual com outra aprovacao adiante suspende o autoagendamento

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `hub-posts` devolve `autoPublishSuspendedPostIds`

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts:323-364`
- Test: `supabase/functions/__tests__/hub-functions_test.ts` (dois testes)

**Interfaces:**
- Consumes: mesmas tabelas da Task 4.
- Produces: campo novo e aditivo `autoPublishSuspendedPostIds: number[]` na resposta JSON, com os ids de posts avulsos cuja execução ativa tem duas ou mais etapas `aprovacao_cliente` em `pendente`/`ativo`. `autoPublishSuspendedWorkflowIds` não muda. Erro de consulta suspende todos os avulsos com execução (fail closed), como faz o ramo dos fluxos.

- [ ] **Step 1: Escrever os testes que falham**

Ordem das consultas em `hub-posts` para um cliente com avulsos: `client_hub_tokens` → `workflow_posts` → `instagram_accounts` → `clientes` → (`workflow_etapas` só se houver workflowIds) → `post_processes` → `post_process_steps`. Copiar a estrutura de `"hub-posts flags workflows whose auto-publish is suspended by a later approval etapa"` (linhas ~965-1006).

```ts
Deno.test("hub-posts lista avulsos com processo individual suspenso por outra aprovação adiante", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: [
      { id: 1, workflow_id: null, workflows: null },
      { id: 2, workflow_id: null, workflows: null },
      { id: 3, workflow_id: null, workflows: null },
    ],
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: null, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  db.queue("post_processes", "select", { data: [{ id: 10, post_id: 1 }, { id: 11, post_id: 2 }], error: null });
  db.queue("post_process_steps", "select", {
    data: [
      { process_id: 10, estado: "ativo" },
      { process_id: 10, estado: "pendente" },
      { process_id: 11, estado: "ativo" },
      { process_id: 11, estado: "herdado" },
    ],
    error: null,
  });
  const handler = createHubPostsHandler({
    buildCorsHeaders, createDb: () => db as never, now,
    signGetUrl: async (key: string) => `https://cdn.test/${key}`, rateLimit: async () => true,
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);
  assertEquals(response.status, 200);
  assertEquals(body.autoPublishSuspendedWorkflowIds, []);
  assertEquals(body.autoPublishSuspendedPostIds, [1]);
});

Deno.test("hub-posts suspende todos os avulsos com processo quando a consulta das etapas erra", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: [{ id: 1, workflow_id: null, workflows: null }], error: null });
  db.queue("instagram_accounts", "select", { data: null, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  db.queue("post_processes", "select", { data: [{ id: 10, post_id: 1 }], error: null });
  db.queue("post_process_steps", "select", { data: null, error: { message: "db offline" } });
  const handler = createHubPostsHandler({
    buildCorsHeaders, createDb: () => db as never, now,
    signGetUrl: async (key: string) => `https://cdn.test/${key}`, rateLimit: async () => true,
  });
  const body = await readJson(await handler(new Request("https://example.test/hub-posts?token=hub-123")));
  assertEquals(body.autoPublishSuspendedPostIds, [1]);
});
```

Os testes existentes de `hub-posts` com avulsos e `auto_publish_on_approval: true` passam a consumir uma resposta de `post_processes`; enfileirar `{ data: [], error: null }` neles onde necessário (mesma verificação do mock que na Task 4).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:functions -- --filter "hub-posts"`
Expected: `autoPublishSuspendedPostIds` undefined nos dois novos.

- [ ] **Step 3: Implementar**

Logo depois do bloco de `autoPublishSuspendedWorkflowIds` (antes do `return json({...})`):

```ts
    // Avulsos com processo individual: a mesma promessa "aprovar = agendar"
    // nao vale enquanto a execucao tiver outra etapa de aprovacao adiante
    // (hub-approve.isFinalApprovalCycle, ramo sem fluxo). Chaveado por post,
    // aditivo ao array de fluxos.
    let autoPublishSuspendedPostIds: number[] = [];
    const avulsoIds = flatPosts
      .filter((post: { workflow_id: number | null }) => post.workflow_id == null)
      .map((post: { id: number }) => post.id);
    if (autoPublishOnApproval && avulsoIds.length > 0) {
      const { data: procs, error: procsError } = await db
        .from("post_processes")
        .select("id, post_id")
        .in("post_id", avulsoIds)
        .eq("estado", "ativo");
      if (procsError) {
        console.error("[hub-posts] post_processes lookup failed:", procsError);
        autoPublishSuspendedPostIds = avulsoIds;
      } else {
        const procRows = (procs ?? []) as { id: number; post_id: number }[];
        if (procRows.length > 0) {
          const { data: steps, error: stepsError } = await db
            .from("post_process_steps")
            .select("process_id, estado")
            .in("process_id", procRows.map((p) => p.id))
            .eq("tipo", "aprovacao_cliente");
          if (stepsError) {
            console.error("[hub-posts] post_process_steps lookup failed:", stepsError);
            autoPublishSuspendedPostIds = procRows.map((p) => p.post_id);
          } else {
            const openByProcess = new Map<number, number>();
            for (const s of (steps ?? []) as { process_id: number; estado?: string | null }[]) {
              if (s.estado !== "pendente" && s.estado !== "ativo") continue;
              openByProcess.set(s.process_id, (openByProcess.get(s.process_id) ?? 0) + 1);
            }
            autoPublishSuspendedPostIds = procRows
              .filter((p) => (openByProcess.get(p.id) ?? 0) >= 2)
              .map((p) => p.post_id);
          }
        }
      }
    }
```

e no `return json({...})` acrescentar `autoPublishSuspendedPostIds,` depois de `autoPublishSuspendedWorkflowIds`.

- [ ] **Step 4: Rodar tudo e commitar**

Run: `npm run test:functions && npm run check:functions`

```bash
git add supabase/functions/hub-posts/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub-posts): autoPublishSuspendedPostIds para avulsos com processo individual

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Hub frontend consome `autoPublishSuspendedPostIds`

**Files:**
- Modify: `apps/hub/src/types.ts:274-285` (`HubPostsResponse`), `apps/hub/src/lib/autoPublish.ts`, `apps/hub/src/pages/AprovacoesPage.tsx:123`, `apps/hub/src/pages/PostagensPage.tsx:293`, `apps/hub/src/pages/PostagemFocoPage.tsx:84`
- Test: `apps/hub/src/lib/__tests__/autoPublish.test.ts`

**Interfaces:**
- Produces: `isAutoPublishActive(data, workflowId: number | null, postId: number): boolean`. Com fluxo: como hoje. Sem fluxo: falso se `postId` estiver em `autoPublishSuspendedPostIds`. Backend antigo sem o campo: verdadeiro (compatível).

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `autoPublish.test.ts`:

```ts
  it('é falso para um avulso cujo processo individual está suspenso', () => {
    expect(
      isAutoPublishActive(
        { autoPublishOnApproval: true, autoPublishSuspendedPostIds: [42] },
        null,
        42,
      ),
    ).toBe(false);
  });

  it('é verdadeiro para um avulso fora da lista de suspensos', () => {
    expect(
      isAutoPublishActive(
        { autoPublishOnApproval: true, autoPublishSuspendedPostIds: [42] },
        null,
        7,
      ),
    ).toBe(true);
  });

  it('ignora a lista de posts quando o post tem fluxo', () => {
    expect(
      isAutoPublishActive(
        { autoPublishOnApproval: true, autoPublishSuspendedPostIds: [42], autoPublishSuspendedWorkflowIds: [] },
        9,
        42,
      ),
    ).toBe(true);
  });
```

e atualizar as chamadas existentes do arquivo para passar o terceiro argumento (por exemplo `isAutoPublishActive(undefined, 7, 1)`).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run apps/hub/src/lib/__tests__/autoPublish.test.ts`
Expected: FAIL por aridade/tipo (TS) e pelo primeiro caso.

- [ ] **Step 3: Implementar**

`types.ts`: acrescentar a `HubPostsResponse`:

```ts
  /** Posts avulsos com processo individual que ainda tem outra etapa de
   * aprovação adiante: aprovar agora NÃO autoagenda (espelha hub-approve). */
  autoPublishSuspendedPostIds?: number[];
```

`autoPublish.ts`:

```ts
export function isAutoPublishActive(
  data:
    | Pick<
        HubPostsResponse,
        'autoPublishOnApproval' | 'autoPublishSuspendedWorkflowIds' | 'autoPublishSuspendedPostIds'
      >
    | undefined,
  workflowId: number | null,
  postId: number,
): boolean {
  if (!data?.autoPublishOnApproval) return false;
  if (workflowId == null) return !(data.autoPublishSuspendedPostIds ?? []).includes(postId);
  return !(data.autoPublishSuspendedWorkflowIds ?? []).includes(workflowId);
}
```

Nas três páginas: `isAutoPublishActive(data, post.workflow_id, post.id)`.

- [ ] **Step 4: Rodar, typecheck e commitar**

Run: `npx vitest run apps/hub && npx tsc -p apps/hub/tsconfig.json --noEmit && npm run lint`

```bash
git add apps/hub/src/types.ts apps/hub/src/lib/autoPublish.ts apps/hub/src/lib/__tests__/autoPublish.test.ts apps/hub/src/pages/AprovacoesPage.tsx apps/hub/src/pages/PostagensPage.tsx apps/hub/src/pages/PostagemFocoPage.tsx
git commit -m "feat(hub): card de aprovação respeita suspensão por processo individual

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Limpeza de rascunhos Express poupa posts com processo ativo

**Files:**
- Modify: `supabase/functions/express-post-cleanup-cron/handler.ts:220-280` (passo 3) e `ExpressPostCleanupCronResult`
- Test: `supabase/functions/__tests__/express-post-cleanup-cron_test.ts`

**Interfaces:**
- Produces: passo 3 exclui do lote os ids com linha em `post_processes` com `estado = 'ativo'`; campo novo `avulso_skipped_with_process: number` no resultado. A tabela fake do teste ganha `post_processes`.

- [ ] **Step 1: Escrever o teste que falha**

No `makeFakeDb` do arquivo de teste, acrescentar `post_processes: seed.post_processes ?? []` ao mapa `tables` e o campo opcional correspondente ao tipo `Seed`. Depois, no molde dos testes existentes do passo 3 (grep `avulso_deleted` no arquivo):

```ts
Deno.test("pass 3 poupa rascunho express avulso com processo individual ativo", async () => {
  const old = "2020-01-01T00:00:00.000Z";
  const { db, tables } = makeFakeDb({
    workflow_posts: [
      { id: 1, is_express: true, workflow_id: null, status: "rascunho", created_at: old },
      { id: 2, is_express: true, workflow_id: null, status: "rascunho", created_at: old },
    ],
    post_processes: [{ id: 10, post_id: 2, estado: "ativo" }],
    post_file_links: [],
    files: [],
  });
  const result = await runExpressPostCleanupCron(db, { now: () => "2026-01-01T00:00:00.000Z" } as never);
  assertEquals(result.avulso_deleted, 1);
  assertEquals(result.avulso_skipped_with_process, 1);
  assertEquals(tables.workflow_posts.map((p) => p.id), [2]);
});
```

Ajustar a assinatura de `runExpressPostCleanupCron` e o valor de `now`/cutoff conforme o teste vizinho do arquivo (copiar exatamente como os outros testes chamam a função).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:functions -- --filter "pass 3 poupa"`
Expected: FAIL (`avulso_deleted` 2, campo novo undefined).

- [ ] **Step 3: Implementar**

Em `ExpressPostCleanupCronResult` acrescentar `avulso_skipped_with_process: number;`. No passo 3, depois de calcular `avulsoPostIds` e antes do `if (avulsoPostIds.length > 0)`:

```ts
  // Rascunho com processo individual ativo nao e abandono: alguem esta
  // produzindo nele. A RLS nao protege aqui (service_role), entao o filtro
  // e do handler (spec 2026-09-10-posts-individuais, secao 10, Limpeza).
  let avulsoSkippedWithProcess = 0;
  let deletableAvulsoIds = avulsoPostIds;
  if (avulsoPostIds.length > 0) {
    const { data: protectedRows, error: protectedErr } = await db
      .from("post_processes")
      .select("post_id")
      .in("post_id", avulsoPostIds)
      .eq("estado", "ativo");
    if (protectedErr) throw protectedErr;
    const protectedIds = new Set((protectedRows ?? []).map((r: { post_id: number }) => r.post_id));
    deletableAvulsoIds = avulsoPostIds.filter((id) => !protectedIds.has(id));
    avulsoSkippedWithProcess = avulsoPostIds.length - deletableAvulsoIds.length;
  }
```

e trocar as três ocorrências seguintes de `avulsoPostIds` no passo 3 por `deletableAvulsoIds` (o `if`, o `.in("post_id", ...)` dos links, o `.in("id", ...)` do delete e as contagens). No `return`, acrescentar `avulso_skipped_with_process: avulsoSkippedWithProcess`.

- [ ] **Step 4: Rodar tudo e commitar**

Run: `npm run test:functions && npm run check:functions`

```bash
git add supabase/functions/express-post-cleanup-cron/handler.ts supabase/functions/__tests__/express-post-cleanup-cron_test.ts
git commit -m "feat(cleanup): rascunho express com processo individual ativo nao e apagado

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Rollout em staging, gate completo e PR

**Files:** nenhum novo.

- [ ] **Step 1: Migrations em staging**

`cat supabase/.temp/project-ref` deve ser `wlyzhyfondykzpsiqsce`. `npx supabase db push --linked --dry-run`; se recusar por drift (`LegacyDbPushMissingLocalError`), aplicar as quatro migrations fora da banda, em ordem, com `npx supabase db query --linked --file <arquivo + insert into supabase_migrations.schema_migrations (version, name) values (...) on conflict do nothing>`. Confirmar:

```sql
select count(*) from pg_tables where tablename in ('post_processes','post_process_steps','post_process_events','post_process_batch_requests');
select tgname from pg_trigger where tgname in ('post_a1_process_guard','trg_feature_post_processes','post_processes_requires_avulso');
select column_name from information_schema.columns where table_name = 'plans' and column_name = 'feature_post_processes';
select proname from pg_proc where proname = 'express_cleanup_delete_avulso_drafts';
```

- [ ] **Step 2: Functions em staging**

```bash
BIN=$(ls ~/.npm/_npx/*/node_modules/@supabase/cli-darwin-arm64/bin/supabase | head -1)
for fn in hub-approve hub-posts express-post-cleanup-cron workspace-limits platform-admin; do
  $BIN functions deploy $fn --project-ref wlyzhyfondykzpsiqsce --no-verify-jwt --use-api
done
```

Smoke: abrir o Hub de um cliente do seed em staging (`npm run dev:hub:staging`) e confirmar que a lista carrega e a resposta de `hub-posts` traz `autoPublishSuspendedPostIds: []` (aba Network ou `read_page`). Nenhum processo existe, então o comportamento é idêntico. Fazer também uma aprovação de um post avulso Express no Hub de staging com `auto_publish_on_approval` ligado, esperando `scheduled: true` na resposta de `hub-approve`, não só a lista vazia de `hub-posts`.

- [ ] **Step 3: Gate completo**

Run: `npm run lint && npm run format:check && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json && npm run test && npm run test:functions && npm run check:functions`
Expected: verde. Reconferir prefixos de migration contra `origin/main`.

- [ ] **Step 4: PR**

```bash
git push -u origin feat/post-processes-fase1
gh pr create --base main --title "feat(entregas): processos individuais, fase 1 (schema, guards e Hub)" --body "$(cat <<'EOF'
## O que é
Fase 1 de `docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md`: o modelo de dados dos processos individuais e as adaptações de compatibilidade, sem nenhum comando que crie processos. Vai a produção sem mudança de comportamento (flag `feature_post_processes` desligada em todos os planos; zero linhas nas tabelas novas).

## Mudanças
- `plans.feature_post_processes` (default false) + `FEATURE_COLUMNS`.
- Tabelas `post_processes`, `post_process_steps`, `post_process_events`, `post_process_batch_requests` com unicidade parcial (um vigente por post), uma etapa ativa por processo, FKs compostas de tenant com `workflow_posts`/`workflows`/`workflow_templates`/`membros` (as três últimas ganham `UNIQUE (id, conta_id)`), FK tripla de `post_process_events` para `post_processes (id, conta_id, post_id)`, trigger de guard de criação/reabertura `post_processes_requires_avulso` (`FOR SHARE` na linha do post), gate de plano em INSERT, `concluido_em`/`updated_at` por trigger, RLS com escrita negada para `authenticated`.
- Trigger `post_a1_process_guard` em `workflow_posts` (`BEFORE UPDATE OF workflow_id`, sem GUC de escape): nenhum caminho dá `workflow_id` a um post com execução vigente (`post_has_active_process`).
- `hub-approve`: avulso com processo ativo e outra etapa de aprovação adiante não autoagenda. `hub-posts`: `autoPublishSuspendedPostIds` (aditivo). Hub frontend: `isAutoPublishActive(data, workflowId, postId)`.
- `express-post-cleanup-cron`: passo 3 pré-filtra por `post_processes` (`avulso_skipped_with_process`) e apaga via a RPC atômica `express_cleanup_delete_avulso_drafts` (`FOR UPDATE` + reconfere `post_processes` antes do DELETE).

## Rollout
Migrations aplicadas em staging; functions `hub-approve`, `hub-posts`, `express-post-cleanup-cron`, `workspace-limits`, `platform-admin` deployadas em staging. **Prod antes do merge, na ordem obrigatória**: as quatro migrations (`20260918000001` → `000004`), depois as mesmas cinco functions, só então o merge (Vercel deploya Hub/Admin). Sem a migração 2 no ar, `hub-approve` falha fechado e nenhum avulso autoagenda, `hub-posts` marca todos os avulsos como suspensos, e `express-post-cleanup-cron` responde 500.

## Verificação
- SQL: suítes 83 (schema, 12 blocos), 84 (guard, 4 blocos) e `supabase/tests/express_cleanup_delete_avulso_drafts.sql` (5 blocos) no job `entitlement-tests`.
- Deno: 3 + 1 testes em hub-approve, 2 em hub-posts, 4 no cron, 1 em entitlements.
- Vitest Hub: 3 testes em `autoPublish`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Aguardar o review externo e responder. Antes do merge: aplicar as quatro migrations, em ordem, e deployar as cinco functions (`hub-approve`, `hub-posts`, `express-post-cleanup-cron`, `workspace-limits`, `platform-admin`) em prod (`--project-ref skjzpekeqefvlojenfsw`).

---

## Fora deste plano

- Fase 2: `detach_posts_keeping_process`, `apply_post_process`, `transition_post_process`, `update_post_process_step`, `remove_post_process`, `attach_post_closing_process`, `reorder_fluxos_board`, `workflow_fingerprint`/`template_fingerprint`, idempotência via `post_process_batch_requests`, `has_permission_for('entregas','editar')` em toda RPC, ordem de advisory locks (§9.5). Depende desta fase.
- Fase 3: `BoardEntity`, quadro misto, Sem processo, drawer, Concluídas, links, tipos TS do store. Depende dos PRs #478 a #481 e da fase 2 para leitura real.
- Fase 4: diálogos e comandos no CRM, flag ligada em workspace de validação, matriz de aceitação (§12).

## Execução (2026-09-10)

O que foi implementado diverge do texto das tasks acima nos pontos abaixo, todos motivados pelo review interno e pelo review externo (Codex) sobre a rev 2 da spec, não por mudança de escopo:

- Task 1 ganhou um item 1b: `platform-admin` também bundla `_shared/entitlements.ts` e precisa entrar no rollout de functions, junto com `workspace-limits`.
- Task 2 foi além do texto original: `workflows`, `workflow_templates` e `membros` ganharam `UNIQUE (id, conta_id)` e as FKs de `template_id`/`origem_workflow_id`/`responsavel_id` são compostas com `SET NULL` por coluna, não FK simples com validação só na RPC. A FK de `post_process_events` para `post_processes` é tripla `(process_id, conta_id, post_id)`, não CASCADE simples. Ambas fecham brechas de tenant que o review externo apontou como P1.
- O guard de criação/reabertura (`post_processes_requires_avulso`) passou a agir também no UPDATE (reabrir um `encerrado`, ou mudar de post/conta), não só no INSERT, e toma `FOR SHARE` na linha do post para serializar com attach/move.
- O guard de attach (`post_a1_process_guard`) é uma trigger em `workflow_posts`, não uma edição em cada uma das quatro RPCs de attach: menos superfície para esquecer o guard numa RPC nova.
- A limpeza de Express (`express-post-cleanup-cron`) não faz mais o DELETE em lote direto: o passo 3 chama a RPC atômica `express_cleanup_delete_avulso_drafts`, com `FOR UPDATE` e reconferência de `post_processes` na mesma transação, para fechar a janela entre pré-filtro e delete.
- Ver as quatro migrations `supabase/migrations/20260918000001..4_*.sql` para o SQL exato de cada ponto acima.
