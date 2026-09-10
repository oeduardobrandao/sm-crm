# Posts individuais. Fase 2: RPCs de comando e concorrência. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar todo o caminho de escrita dos processos individuais como RPCs `SECURITY DEFINER`, com permissão por papel, gate de plano, controle otimista por `revisao`, idempotência de lote e ordem de locks da família de movimentação. Nada de UI: a fase 2 vai a produção com a flag `feature_post_processes` desligada e sem nenhum chamador no CRM, exatamente como a fase 1.

**Architecture:** Oito migrations aditivas sobre o schema da fase 1 (`20260918000001..4`). Duas funções de fingerprint (serialização canônica em texto, sem hash), uma migration de endurecimento que fecha os minors diferidos da fase 1 e publica os dois helpers internos (`post_process_require_editor`, `post_process_log_event`), e seis migrations de RPC, uma por comando. Nenhuma edge function muda: a spec §6.2 proíbe transição server-side no caminho de aprovação do Hub na v1, e o caminho de leitura (§6.1) já foi entregue na fase 1.

**Tech Stack:** Postgres 17 / plpgsql (Supabase), suítes psql em `supabase/tests/entitlements` (rodadas pelo job `entitlement-tests`), nenhuma mudança em Deno ou React.

**Spec:** `docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md` (rev 2.2), seções 5 (fluxos de interação), 6.2 (avançar etapa de aprovação), 7 (prazos e atribuição), 9 (RPCs, identidade, compatibilidade, concorrência, ordem de locks) e 12 (critérios de aceitação, blocos "Contratos e segurança"). Fase 1: `docs/superpowers/plans/2026-09-10-posts-individuais-fase1-backend.md`. Fase 3 = leitura no CRM (§4, §5.4, §8.3); fase 4 = comandos e diálogos no CRM (§5) e rollout da flag (§11).

## Global Constraints

- Branch `feat/post-processes-fase2`, criada de `origin/main` em `22873baf` (fase 1 já mergeada e em produção). Worktree desta sessão: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/instagram-dm-follow-automation-107fe8`. Rodar `pwd` e `git branch --show-current` antes de editar.
- Prefixos de migration `20260919000001` a `20260919000008`. O último de `origin/main` hoje é `20260918000004`. Reconferir com `git ls-tree --name-only origin/main:supabase/migrations | tail -3` imediatamente antes de abrir o PR e renumerar acima do tail se algo maior tiver entrado. `20260917000001_reorder_workflow_positions_rpc.sql` (PR #479, pré-requisito 2) **não está em `origin/main` nem nesta branch**: a fase 2 não depende dela, e `reorder_fluxos_board` (Task 8) reordena fluxos e processos por conta própria.
- Toda RPC de mutação: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM public, anon`, `GRANT EXECUTE ... TO authenticated, service_role`, no molde de `20260830000004_post_detach_attach_rpcs.sql`.
- Toda RPC de mutação começa por `v_conta := public.post_process_require_editor()`, que resolve `get_my_conta_id()` (nulo levanta `workspace_not_found`) e exige `has_permission_for(auth.uid(), v_conta, 'entregas', 'editar')` (falso levanta `permission_denied`). `conta_id` nunca vem do cliente.
- Erros: `RAISE EXCEPTION '<codigo>' USING ERRCODE = 'P0001'`, sempre identificador, nunca frase. Nenhum erro revela dado de outra conta: id de outra conta resolve para o `*_not_found` da entidade.
- Ordem de advisory locks (spec §9.5), obrigatória e antes de qualquer lock de linha: `:post_move` → `:max_active_workflows_per_client` → `:max_posts_per_workflow`, com `pg_advisory_xact_lock(hashtext(v_conta::text || ':<chave>'))`. Toda RPC que **insere ou reabre** em `post_processes` toma `:post_move` ANTES do INSERT/UPDATE: a FK composta em `origem_workflow_id` pega `FOR KEY SHARE` em `workflows` e fecha ciclo com o `FOR UPDATE` que o attach segura na linha do fluxo alvo.
- Ordem de locks de linha, idêntica em todas as RPCs desta fase: **fluxo → post → processo**. Nunca o inverso.
- Gate de plano (`effective_plan_feature(v_conta, 'feature_post_processes')`) só nas duas RPCs que criam execução (`detach_posts_keeping_process`, `apply_post_process`), para devolver `feature_disabled:feature_post_processes` antes do trigger `trg_feature_post_processes`. Os demais comandos operam com a flag desligada (critério 12.18: "flag desligada mantém execuções visíveis e operáveis").
- Comentários SQL em português **sem acentos** (padrão dos arquivos de migration). Sem travessão em lugar nenhum do plano, das migrations ou das suítes.
- Suítes psql seguem `83_post_processes_schema.sql` e `84_post_process_attach_guard.sql`: `\set ON_ERROR_STOP on`, `\i supabase/tests/entitlements/_helpers.sql`, fixture em `pg_temp`, blocos `begin; do $$ ... $$; rollback;`, `raise notice 'PASS NN.M ...'`. Sem Docker local a suíte não roda na mão; o job `entitlement-tests` do CI a roda de qualquer forma, e isso deve ser dito no relatório de cada task.
- Antes de `git push`: `npm run lint`, `npm run format:check`, os quatro typechecks (`apps/crm`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`, `npm run check:functions`, `npm run test:functions`. Se `ls node_modules/.deno` existir depois do gate Deno, rodar `npm ci` antes de confiar em tsc/vitest.
- Commits terminam com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Corpo do PR termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Interfaces

Assinaturas exatas, na ordem em que as tasks as criam. Toda RPC de mutação devolve `jsonb`; toda função devolve o mesmo valor para a mesma entrada dentro da transação.

### Funções de leitura (Task 1)

```
public.workflow_fingerprint(p_workflow_id bigint) RETURNS text          -- SECURITY INVOKER, STABLE
public.template_fingerprint(p_template_id bigint) RETURNS text          -- SECURITY INVOKER, STABLE
```

Formato do fingerprint de fluxo (spec §9.4), linhas unidas por `\n`:

```
etapa_atual=<n>
<ordem>|<nome>|<tipo>|<status>|<responsavel_id>|<prazo_dias>|<tipo_prazo>|<data_limite>|<iniciado_em>
```

Nulos viram string vazia; `tipo` nulo vira `padrao`; `data_limite` em `YYYY-MM-DD`; `iniciado_em` em `to_char(x at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`. Fluxo inexistente devolve `NULL`.

Formato do fingerprint de template: só as linhas, **sem** a linha `etapa_atual=`, com as colunas `<ordem>|<nome>|<tipo>|<prazo_dias>|<tipo_prazo>` sobre `workflow_templates.etapas`, onde `ordem` é o índice base zero no array. Template inexistente devolve `NULL`; `etapas` vazio devolve `''`. `prazo_dias` e `tipo_prazo` entram como **o texto bruto do JSON** (`->>`), sem normalização: um template que gravou `2.0` serializa `2.0`, e um que gravou string vazia serializa string vazia. O espelho TS da fase 3 tem de reproduzir isso byte a byte, sem `parseInt` nem `Number()`.

### Helpers internos (Task 2), sem EXECUTE para `authenticated`

```
public.post_process_require_editor() RETURNS uuid
public.post_process_log_event(p_conta uuid, p_post_id bigint, p_process_id bigint,
                              p_evento text, p_antes jsonb, p_depois jsonb,
                              p_origem text DEFAULT 'workspace_user') RETURNS void
public.post_process_assinatura(p_process_id bigint) RETURNS text
```

`post_process_assinatura` reconstrói a assinatura a partir de `post_process_steps` (`<ordem>|<nome>|<tipo>` por linha, unidas por `\n`). As RPCs gravam `post_processes.assinatura` a partir da fonte (fluxo ou template) e as suítes fixam a igualdade entre as duas.

### RPCs de comando

```
public.detach_posts_keeping_process(
  p_post_ids           bigint[],
  p_workflow_id        bigint,
  p_fingerprint        text,
  p_active_deadline    timestamptz,
  p_request_id         uuid,
  p_step_deadlines     jsonb   DEFAULT NULL,
  p_archive_empty_flow boolean DEFAULT false
) RETURNS jsonb

public.apply_post_process(
  p_post_id              bigint,
  p_template_id          bigint,
  p_template_fingerprint text,
  p_start_ordem          integer,
  p_step_overrides       jsonb DEFAULT NULL
) RETURNS jsonb

public.transition_post_process(
  p_process_id           bigint,
  p_expected_revisao     integer,
  p_command              text,
  p_approval_choice      text        DEFAULT NULL,
  p_expected_post_status text        DEFAULT NULL,
  p_next_deadline        timestamptz DEFAULT NULL
) RETURNS jsonb

public.update_post_process_step(
  p_process_id       bigint,
  p_expected_revisao integer,
  p_ordem            integer,
  p_responsavel_id   bigint      DEFAULT NULL,
  p_prazo_efetivo    timestamptz DEFAULT NULL
) RETURNS jsonb

public.remove_post_process(
  p_process_id       bigint,
  p_expected_revisao integer
) RETURNS jsonb

public.attach_post_closing_process(
  p_post_id          bigint,
  p_workflow_id      bigint,
  p_expected_revisao integer
) RETURNS jsonb

public.reorder_fluxos_board(
  p_workflow_ids       bigint[],
  p_workflow_positions integer[],
  p_process_ids        bigint[],
  p_process_positions  integer[]
) RETURNS void
```

`p_command` de `transition_post_process`: `avancar | voltar | concluir | reabrir`.
`p_approval_choice`: `aprovar_interno | sem_alterar` (só com `avancar` ou `concluir` sobre etapa `aprovacao_cliente`).
`p_expected_post_status`: obrigatório quando `avancar` ou `concluir` age sobre etapa `aprovacao_cliente` (spec §5.5 e §6.2); ignorado nos demais casos.

### Formatos de retorno

`detach_posts_keeping_process`:

```json
{
  "ok": true,
  "request_id": "<uuid>",
  "detached": 2,
  "archived_workflow_ids": [12],
  "processes": [
    {"process_id": 31, "post_id": 101, "etapa_atual": 1, "revisao": 1,
     "board_position": 0, "assinatura": "0|Copy|padrao\n1|Design|padrao",
     "origem_workflow_id": 12, "origem_descricao": "Conteudo de setembro, etapa Design"}
  ],
  "steps": [
    {"process_id": 31, "ordem": 0, "nome": "Copy", "tipo": "padrao", "estado": "herdado",
     "responsavel_id": null, "prazo_dias": 2, "tipo_prazo": "corridos",
     "prazo_efetivo": null, "iniciado_em": null}
  ]
}
```

`apply_post_process`: `{"ok": true, "process_id": <n>, "post_id": <n>, "estado": "ativo", "etapa_atual": <n>, "revisao": 1, "assinatura": "...", "template_id": <n>, "template_nome": "...", "steps": [ ...mesmo formato acima... ]}`.

`transition_post_process`: `{"ok": true, "process_id": <n>, "post_id": <n>, "command": "avancar", "estado": "ativo", "etapa_atual": <n>, "revisao": <n>, "post_status": "aprovado_cliente", "post_status_changed": true, "steps": [ ... ]}`.

`update_post_process_step`: `{"ok": true, "process_id": <n>, "ordem": <n>, "revisao": <n>, "step": {...}}`.

`remove_post_process`: `{"ok": true, "process_id": <n>, "post_id": <n>, "estado": "encerrado", "motivo_encerramento": "removido", "revisao": <n>}`.

`attach_post_closing_process`: `{"ok": true, "process_id": <n>, "post_id": <n>, "workflow_id": <n>, "estado": "encerrado", "motivo_encerramento": "vinculado", "revisao": <n>}`.

`reorder_fluxos_board`: `void`.

### Códigos de erro (todos `ERRCODE = 'P0001'`)

| Código | Onde |
| --- | --- |
| `workspace_not_found` | todas, workspace ativo nulo |
| `permission_denied` | todas, sem `entregas.editar` |
| `feature_disabled:feature_post_processes` | detach, apply |
| `invalid_arguments` | reorder (arrays inconsistentes) |
| `post_ids_required` | detach (lote vazio) |
| `post_not_found` | detach, apply, attach |
| `post_not_in_source_flow` | detach |
| `post_in_workflow` | apply (post já pertence a fluxo) |
| `post_already_in_flow` | attach |
| `post_has_active_process` | apply (execução vigente já existe) |
| `post_belongs_to_another_client` | attach |
| `post_changed` | transition (status esperado divergente) |
| `workflow_not_found` | detach, attach, reorder |
| `workflow_not_active` | detach, attach |
| `workflow_changed` | detach (fingerprint) |
| `workflow_etapas_inconsistent` | detach (zero ou duas etapas `ativo`) |
| `template_not_found` | apply |
| `template_empty` | apply |
| `template_changed` | apply (fingerprint) |
| `invalid_start_ordem` | apply |
| `invalid_step_overrides` | apply |
| `invalid_step_deadlines` | detach |
| `start_deadline_required` | apply |
| `data_entrega_requires_approval_step` | apply (modo `data_entrega` sem etapa `aprovacao_cliente` na sequência a partir da inicial) |
| `active_deadline_required` | detach |
| `next_deadline_required` | transition (`avancar`) |
| `expected_post_status_required` | transition (`avancar`/`concluir` sobre `aprovacao_cliente`) |
| `approval_choice_required` | transition (`avancar`/`concluir` sobre `aprovacao_cliente` com post nao liberado) |
| `invalid_approval_choice` | transition |
| `invalid_command` | transition |
| `membro_not_found` | apply, update_step |
| `process_not_found` | transition, update_step, remove, attach |
| `process_changed` | transition, update_step, remove, attach (revisão velha) |
| `process_not_active` | transition (`avancar`/`voltar`/`concluir`) |
| `process_not_concluded` | transition (`reabrir`) |
| `process_already_closed` | remove, attach (processo já `encerrado`) |
| `step_not_found` | update_step, transition (nenhuma etapa `ativo`, caminho defensivo) |
| `step_not_editable` | update_step |
| `no_next_step` | transition (`avancar`) |
| `no_previous_step` | transition (`voltar`) |
| `request_id_required` | detach |
| `request_not_found` | detach (`request_id` de outra conta) |
| `request_mismatch` | detach (mesmo `request_id` com entradas diferentes) |
| `plan_limit_exceeded:max_posts_per_workflow` | attach |

---

### Task 1: Fingerprints canônicos de fluxo e de template

**Files:**
- Create: `supabase/migrations/20260919000001_post_process_fingerprints.sql`
- Test: `supabase/tests/entitlements/85_post_process_fingerprints.sql`

**Interfaces:**
- Produces: `public.workflow_fingerprint(bigint) RETURNS text` e `public.template_fingerprint(bigint) RETURNS text`, no formato da seção Interfaces. Consumidas por `detach_posts_keeping_process` (Task 3) e `apply_post_process` (Task 4), e espelhadas em TS por `buildFingerprint` na fase 3.

- [ ] **Step 1: Escrever a suíte SQL que falha**

```sql
-- supabase/tests/entitlements/85_post_process_fingerprints.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Fingerprints canonicos (migration 20260919000001). Cobre:
-- 85.0 formato exato do fluxo, com nulos, tipo default e timestamp UTC
-- 85.1 qualquer edicao de etapa muda o fingerprint, mesmo sem mover etapa_atual
-- 85.2 fluxo inexistente devolve NULL
-- 85.3 formato exato do template, com ordem base zero
-- 85.4 template inexistente devolve NULL; etapas vazio devolve ''
-- 85.5 RLS: SECURITY INVOKER. Membro de outra conta nao produz fingerprint
--      nenhum; membro da propria conta le o fingerprint completo por PostgREST

create or replace function pg_temp.et_fp_env(out ws uuid, out usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, etapa_atual)
    values (usr, ws, cli, 'Conteudo de setembro', 'ativo', 1) returning id into wf;
end $$;

-- 85.0
begin;
do $$
declare e record; v_fp text; v_esperado text;
begin
  select * into e from pg_temp.et_fp_env();
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, data_limite)
    values (e.wf, 0, 'Copy', 2, 'corridos', 'padrao', 'concluido', timestamptz '2026-09-01 12:00:00+00', null);
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, data_limite)
    values (e.wf, 1, 'Design', 3, 'uteis', null, 'ativo', timestamptz '2026-09-03 09:30:00+00', date '2026-09-10');
  v_fp := workflow_fingerprint(e.wf);
  v_esperado := 'etapa_atual=1' || chr(10)
    || '0|Copy|padrao|concluido||2|corridos||2026-09-01T12:00:00.000Z' || chr(10)
    || '1|Design|padrao|ativo||3|uteis|2026-09-10|2026-09-03T09:30:00.000Z';
  assert v_fp = v_esperado, format('fingerprint inesperado:%s%s%sesperado:%s%s', chr(10), v_fp, chr(10), chr(10), v_esperado);
  raise notice 'PASS 85.0 formato do fingerprint de fluxo';
end $$;
rollback;

-- 85.1
begin;
do $$
declare e record; v_antes text; v_depois text;
begin
  select * into e from pg_temp.et_fp_env();
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status)
    values (e.wf, 0, 'Copy', 2, 'corridos', 'ativo');
  v_antes := workflow_fingerprint(e.wf);
  update workflow_etapas set nome = 'Copywriting' where workflow_id = e.wf and ordem = 0;
  v_depois := workflow_fingerprint(e.wf);
  assert v_antes is distinct from v_depois, 'renomear etapa deve mudar o fingerprint';
  update workflow_etapas set nome = 'Copy' where workflow_id = e.wf and ordem = 0;
  assert workflow_fingerprint(e.wf) = v_antes, 'desfazer a edicao deve restaurar o fingerprint';
  update workflow_etapas set prazo_dias = 9 where workflow_id = e.wf and ordem = 0;
  assert workflow_fingerprint(e.wf) is distinct from v_antes, 'mudar prazo_dias deve mudar o fingerprint sem mover etapa_atual';
  raise notice 'PASS 85.1 edicao de etapa muda o fingerprint';
end $$;
rollback;

-- 85.2
begin;
do $$
begin
  assert workflow_fingerprint(-1::bigint) is null, 'fluxo inexistente deve devolver NULL';
  raise notice 'PASS 85.2 fluxo inexistente devolve NULL';
end $$;
rollback;

-- 85.3
begin;
do $$
declare e record; v_tmpl bigint; v_fp text; v_esperado text;
begin
  select * into e from pg_temp.et_fp_env();
  insert into workflow_templates (user_id, conta_id, nome, etapas) values (e.usr, e.ws, 'Modelo', jsonb_build_array(
    jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
    jsonb_build_object('nome', 'Aprovacao', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'aprovacao_cliente')
  )) returning id into v_tmpl;
  v_fp := template_fingerprint(v_tmpl);
  v_esperado := '0|Copy|padrao|2|corridos' || chr(10) || '1|Aprovacao|aprovacao_cliente|1|uteis';
  assert v_fp = v_esperado, format('fingerprint de template inesperado: %s', v_fp);
  raise notice 'PASS 85.3 formato do fingerprint de template';
end $$;
rollback;

-- 85.4
begin;
do $$
declare e record; v_tmpl bigint;
begin
  select * into e from pg_temp.et_fp_env();
  assert template_fingerprint(-1::bigint) is null, 'template inexistente deve devolver NULL';
  insert into workflow_templates (user_id, conta_id, nome, etapas) values (e.usr, e.ws, 'Vazio', '[]'::jsonb) returning id into v_tmpl;
  assert template_fingerprint(v_tmpl) = '', 'template sem etapas deve devolver string vazia';
  raise notice 'PASS 85.4 template inexistente e template vazio';
end $$;
rollback;

-- 85.5
begin;
do $$
declare e record; f record; v_fp text; v_esperado text;
begin
  select * into e from pg_temp.et_fp_env();
  select * into f from pg_temp.et_fp_env();
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status)
    values (e.wf, 0, 'Copy', 2, 'corridos', 'ativo');
  -- Paridade de grants para que 'set local role authenticated' exerça a RLS de
  -- workflows/workflow_etapas e nao o ACL do banco local (ver _helpers.sql).
  perform et_grant_hosted_parity();

  -- membro de OUTRA conta: workflows_select nao devolve a linha, a funcao cai
  -- no IF NOT FOUND e devolve NULL. Nao devolve 'etapa_atual=1': o cabecalho
  -- so existe quando o proprio fluxo foi lido.
  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_fp := workflow_fingerprint(e.wf);
  execute 'reset role';
  assert v_fp is null,
    format('fluxo de outra conta nao pode produzir fingerprint, obtido: %s', v_fp);

  -- membro da PROPRIA conta: caminho publico da Decisao 11, o unico que prova
  -- que SECURITY INVOKER nao quebrou a chamada direta por PostgREST.
  v_esperado := 'etapa_atual=1' || chr(10) || '0|Copy|padrao|ativo||2|corridos||';
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_fp := workflow_fingerprint(e.wf);
  execute 'reset role';
  assert v_fp = v_esperado,
    format('membro da conta deve obter o fingerprint completo, obtido: %s', v_fp);
  raise notice 'PASS 85.5 SECURITY INVOKER respeita a RLS e serve o caminho publico';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash scripts/test-entitlements.sh` (com Supabase local; `colima start && npx supabase start` primeiro)
Expected: FAIL em `85_post_process_fingerprints.sql` com `function workflow_fingerprint(bigint) does not exist`. Sem Docker, seguir para o Step 3 e registrar no relatório que o job `entitlement-tests` do CI é quem confirma.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260919000001_post_process_fingerprints.sql
-- Fingerprints canonicos de fluxo e de template (spec
-- 2026-09-10-posts-individuais-fluxos-design.md, secao 9.4).
--
-- workflows e workflow_etapas nao tem updated_at nem coluna de versao. Para
-- detectar "a origem mudou entre abrir o dialogo e confirmar", a UI calcula
-- uma serializacao canonica com os dados que exibe e a RPC recalcula a mesma
-- serializacao sob lock. E TEXTO, sem hash, de proposito: md5(jsonb::text)
-- no servidor nunca casaria com um hash do browser, porque a serializacao de
-- jsonb e propria do Postgres. O valor tem poucas centenas de bytes.
--
-- SECURITY INVOKER, nao DEFINER. Duas consequencias desejadas:
--   (a) chamada direta por authenticated (PostgREST) le so o que a RLS de
--       workflows/workflow_etapas ja permite: fluxo de outra conta produz
--       so a linha etapa_atual=, sem etapas;
--   (b) chamada de dentro das RPCs SECURITY DEFINER da fase 2 roda como o
--       dono (postgres), que ignora RLS, que e o que a RPC precisa depois de
--       ja ter validado conta_id por conta propria.
--
-- Fluxo/template inexistente devolve NULL: assim um fingerprint enviado pelo
-- cliente nunca casa com uma origem apagada.

CREATE OR REPLACE FUNCTION public.workflow_fingerprint(p_workflow_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_etapa_atual integer;
  v_linhas      text;
BEGIN
  SELECT w.etapa_atual INTO v_etapa_atual FROM workflows w WHERE w.id = p_workflow_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(string_agg(
           chr(10)
             || e.ordem::text
             || '|' || coalesce(e.nome, '')
             || '|' || coalesce(nullif(e.tipo, ''), 'padrao')
             || '|' || coalesce(e.status, '')
             || '|' || coalesce(e.responsavel_id::text, '')
             || '|' || coalesce(e.prazo_dias::text, '')
             || '|' || coalesce(e.tipo_prazo, '')
             || '|' || coalesce(to_char(e.data_limite, 'YYYY-MM-DD'), '')
             || '|' || coalesce(to_char(e.iniciado_em AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
           '' ORDER BY e.ordem), '')
    INTO v_linhas
    FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id;

  RETURN 'etapa_atual=' || coalesce(v_etapa_atual, 0)::text || v_linhas;
END;
$$;

-- Mesmo formato, colunas ordem|nome|tipo|prazo_dias|tipo_prazo, sobre o jsonb
-- de workflow_templates.etapas. NAO tem a linha etapa_atual=: template nao tem
-- ponteiro de etapa, e uma linha fixa 'etapa_atual=0' so serviria para
-- confundir quem comparasse os dois formatos. A ordem e o indice base zero do
-- array (WITH ORDINALITY comeca em 1), a mesma convencao de
-- migrate_workflow_template.
CREATE OR REPLACE FUNCTION public.template_fingerprint(p_template_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_etapas jsonb;
  v_out    text;
BEGIN
  SELECT t.etapas INTO v_etapas FROM workflow_templates t WHERE t.id = p_template_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_etapas IS NULL OR jsonb_typeof(v_etapas) <> 'array' THEN
    RETURN '';
  END IF;

  SELECT coalesce(string_agg(
           (e.ord - 1)::text
             || '|' || coalesce(e.val ->> 'nome', '')
             || '|' || coalesce(nullif(e.val ->> 'tipo', ''), 'padrao')
             || '|' || coalesce(e.val ->> 'prazo_dias', '')
             || '|' || coalesce(e.val ->> 'tipo_prazo', ''),
           chr(10) ORDER BY e.ord), '')
    INTO v_out
    FROM jsonb_array_elements(v_etapas) WITH ORDINALITY AS e(val, ord);

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_fingerprint(bigint) FROM public, anon;
REVOKE ALL ON FUNCTION public.template_fingerprint(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.workflow_fingerprint(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.template_fingerprint(bigint) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '85_|ran='`
Expected: `PASS supabase/tests/entitlements/85_post_process_fingerprints.sql` e `failures=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260919000001_post_process_fingerprints.sql supabase/tests/entitlements/85_post_process_fingerprints.sql
git commit -m "feat(entregas): fingerprints canonicos de fluxo e template

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Endurecimento da fase 1 e helpers internos

**Files:**
- Create: `supabase/migrations/20260919000002_post_process_hardening.sql`
- Modify: `supabase/tests/entitlements/83_post_processes_schema.sql` (bloco 83.3 passa a excluir as quatro tabelas de `et_grant_hosted_parity` e a envolver o UPDATE num bloco com `EXCEPTION`; novos blocos 83.12 e 83.13)
- Modify: `supabase/tests/express_cleanup_delete_avulso_drafts.sql` (bloco E.2 reescrito: `concluido` passa a poupar, `encerrado` continua não poupando)
- Test: `supabase/tests/entitlements/86_post_process_helpers.sql`

**Interfaces:**
- Produces: `post_process_require_editor()`, `post_process_log_event(...)`, `post_process_assinatura(bigint)` (nenhuma com EXECUTE para `anon`, `authenticated` **nem** `service_role`, ver Decisão 26); índices `idx_post_processes_template` e `idx_post_processes_origem`; `set_post_process_concluido_em` limpa `concluido_em` em qualquer transição para `ativo`; `REVOKE` de USAGE nas três sequences para `anon`/`authenticated`; e `express_cleanup_delete_avulso_drafts(bigint[])` recriada para poupar também o processo `concluido` (Decisão 25).
- Consumes: nada da Task 1. Todas as tasks seguintes consomem os três helpers.

- [ ] **Step 1: Escrever as suítes que falham**

```sql
-- supabase/tests/entitlements/86_post_process_helpers.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Endurecimento e helpers (migration 20260919000002). Cobre:
-- 86.0 concluido -> encerrado -> ativo limpa concluido_em (minor M1 da fase 1)
-- 86.1 indices de template_id e origem_workflow_id existem
-- 86.2 ACL das sequences: anon/authenticated sem USAGE, service_role com
-- 86.3 post_process_require_editor: sem workspace, sem permissao, com permissao
-- 86.4 post_process_log_event grava actor_name de profiles e origem system
-- 86.5 helpers nao sao executaveis por anon nem por authenticated
-- 86.6 post_process_assinatura reconstroi a assinatura das etapas

create or replace function pg_temp.et_hd_env(out ws uuid, out usr uuid, out cli bigint, out post bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona da conta' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (ws, cli, 'avulso') returning id into post;
end $$;

-- 86.0
begin;
do $$
declare e record; v_proc bigint; v_ts timestamptz;
begin
  select * into e from pg_temp.et_hd_env();
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, '0|Copy|padrao') returning id into v_proc;
  update post_processes set estado = 'concluido' where id = v_proc;
  select concluido_em into v_ts from post_processes where id = v_proc;
  assert v_ts is not null, 'concluir deve carimbar concluido_em';
  update post_processes set estado = 'encerrado', motivo_encerramento = 'vinculado' where id = v_proc;
  update post_processes set estado = 'ativo', motivo_encerramento = null where id = v_proc;
  select concluido_em into v_ts from post_processes where id = v_proc;
  assert v_ts is null, 'qualquer transicao para ativo deve limpar concluido_em, inclusive vinda de encerrado';
  raise notice 'PASS 86.0 concluido_em limpo em toda transicao para ativo';
end $$;
rollback;

-- 86.1
begin;
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname in ('idx_post_processes_template', 'idx_post_processes_origem');
  assert v_n = 2, format('esperados 2 indices de FK SET NULL, encontrados %s', v_n);
  raise notice 'PASS 86.1 indices das FKs SET NULL';
end $$;
rollback;

-- 86.2
begin;
do $$
declare s text;
begin
  foreach s in array array['post_processes_id_seq', 'post_process_steps_id_seq', 'post_process_events_id_seq'] loop
    assert not has_sequence_privilege('anon', 'public.' || s, 'usage'),
      format('anon nao pode ter USAGE em %s', s);
    assert not has_sequence_privilege('authenticated', 'public.' || s, 'usage'),
      format('authenticated nao pode ter USAGE em %s', s);
    assert has_sequence_privilege('service_role', 'public.' || s, 'usage'),
      format('service_role precisa de USAGE em %s', s);
  end loop;
  raise notice 'PASS 86.2 ACL das sequences';
end $$;
rollback;

-- 86.3
begin;
do $$
declare
  e record; v_sem uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid();
  v_role uuid; v_conta uuid; v_raised boolean := false;
begin
  select * into e from pg_temp.et_hd_env();
  insert into auth.users (id) values (v_sem), (v_ver);
  insert into workspace_roles (conta_id, nome, permissions) values (e.ws, 'so ve entregas', '{"entregas":"ver"}'::jsonb)
    returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, e.ws, 'agent', v_role);
  update profiles set conta_id = e.ws, active_workspace_id = e.ws where id = v_ver;

  -- sem workspace ativo
  perform set_config('request.jwt.claims', json_build_object('sub', v_sem, 'role', 'authenticated')::text, true);
  begin
    perform post_process_require_editor();
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workspace_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'sem workspace ativo deve levantar workspace_not_found';

  -- membro com entregas=ver
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ver, 'role', 'authenticated')::text, true);
  begin
    perform post_process_require_editor();
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'permission_denied', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'entregas=ver deve levantar permission_denied';

  -- dono
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  v_conta := post_process_require_editor();
  assert v_conta = e.ws, 'dono deve receber a propria conta';
  raise notice 'PASS 86.3 post_process_require_editor';
end $$;
rollback;

-- 86.4
begin;
do $$
declare e record; v_proc bigint; v_ev record;
begin
  select * into e from pg_temp.et_hd_env();
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, '0|Copy|padrao') returning id into v_proc;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  perform post_process_log_event(e.ws, e.post, v_proc, 'aplicado', null, jsonb_build_object('etapa_atual', 0));
  select * into v_ev from post_process_events where process_id = v_proc;
  assert v_ev.actor_user_id = e.usr, 'evento deve guardar o autor';
  assert v_ev.actor_name = 'Dona da conta', format('actor_name deve vir de profiles.nome, obtido %s', v_ev.actor_name);
  assert v_ev.origem = 'workspace_user', 'com autor a origem e workspace_user';
  assert v_ev.depois ->> 'etapa_atual' = '0', 'depois deve ser preservado';

  perform set_config('request.jwt.claims', '', true);
  perform post_process_log_event(e.ws, e.post, v_proc, 'avancou', null, null);
  select * into v_ev from post_process_events where process_id = v_proc and evento = 'avancou';
  assert v_ev.origem = 'system' and v_ev.actor_user_id is null, 'sem autor a origem e system';
  raise notice 'PASS 86.4 post_process_log_event';
end $$;
rollback;

-- 86.5
begin;
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.post_process_require_editor()',
    'public.post_process_log_event(uuid, bigint, bigint, text, jsonb, jsonb, text)',
    'public.post_process_assinatura(bigint)'
  ] loop
    assert not has_function_privilege('anon', fn, 'execute'), format('anon nao pode executar %s', fn);
    assert not has_function_privilege('authenticated', fn, 'execute'), format('authenticated nao pode executar %s', fn);
    -- Decisao 26: nem service_role. As RPCs SECURITY DEFINER chamam os helpers
    -- como o dono, que executa por ser dono, entao nenhum grant e necessario.
    assert not has_function_privilege('service_role', fn, 'execute'), format('service_role nao precisa executar %s', fn);
  end loop;
  raise notice 'PASS 86.5 helpers internos sem EXECUTE para ninguem alem do dono';
end $$;
rollback;

-- 86.6
begin;
do $$
declare e record; v_proc bigint;
begin
  select * into e from pg_temp.et_hd_env();
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, 'placeholder') returning id into v_proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo) values
    (e.ws, v_proc, 1, 'Design', 'padrao'),
    (e.ws, v_proc, 0, 'Copy', 'padrao'),
    (e.ws, v_proc, 2, 'Aprovacao', 'aprovacao_cliente');
  assert post_process_assinatura(v_proc) = '0|Copy|padrao' || chr(10) || '1|Design|padrao' || chr(10) || '2|Aprovacao|aprovacao_cliente',
    format('assinatura inesperada: %s', post_process_assinatura(v_proc));
  raise notice 'PASS 86.6 post_process_assinatura';
end $$;
rollback;
```

E, em `supabase/tests/entitlements/83_post_processes_schema.sql`, trocar a linha do bloco 83.3

```sql
  perform et_grant_hosted_parity();
```

por

```sql
  -- As quatro tabelas ficam FORA da paridade: seus grants sao o que esta sob
  -- teste (83.12). Com elas excluidas, o SELECT abaixo prova o GRANT SELECT da
  -- migration, e o INSERT falha por falta de grant, nao so por RLS.
  perform et_grant_hosted_parity(array['post_processes', 'post_process_steps',
    'post_process_events', 'post_process_batch_requests']);
```

No mesmo bloco 83.3, o UPDATE de checagem de RLS precisa passar a tolerar
`42501`. Hoje ele passa **por grant**: `et_grant_hosted_parity()` reconcede
`ALL` a `authenticated` e a RLS (`pp_no_client_update USING (false)`) reduz o
UPDATE a zero linhas. Com as quatro tabelas fora da paridade, `authenticated`
fica só com o `GRANT SELECT` da migration e o UPDATE levanta
`permission denied for table post_processes`. O `BEGIN ... END` atual **não tem
cláusula `EXCEPTION`**, logo não é subtransação e não captura nada: a suíte 83
inteira falharia. Trocar

```sql
  begin;
    update post_processes set estado = 'concluido' where id = v_proc;
    get diagnostics v_seen = row_count;
  end;
  assert v_seen = 0, 'authenticated nao pode atualizar post_processes (0 linhas)';
```

por

```sql
  -- Zero linhas (RLS) ou 42501 (falta de grant) sao os dois jeitos legitimos de
  -- o UPDATE nao acontecer. Sem o EXCEPTION, o segundo derruba a suite inteira.
  begin;
    update post_processes set estado = 'concluido' where id = v_proc;
    get diagnostics v_seen = row_count;
  exception when insufficient_privilege then v_seen := 0;
  end;
  assert v_seen = 0, 'authenticated nao pode atualizar post_processes (0 linhas ou 42501)';
```

e acrescentar dois blocos ao fim do arquivo:

```sql
-- 83.12
begin;
do $$
declare t text; v_acl aclitem[]; v_priv text;
begin
  foreach t in array array['post_processes', 'post_process_steps', 'post_process_events'] loop
    select c.relacl into v_acl from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = t;
    select coalesce(string_agg(a.privilege_type, ',' order by a.privilege_type), '') into v_priv
      from aclexplode(v_acl) a where a.grantee = 'authenticated'::regrole;
    assert v_priv = 'SELECT', format('%s: authenticated deve ter EXATAMENTE SELECT, tem %s', t, v_priv);
    assert not exists (select 1 from aclexplode(v_acl) a where a.grantee = 'anon'::regrole),
      format('%s: anon nao pode ter privilegio', t);
    assert not exists (select 1 from aclexplode(v_acl) a where a.grantee = 0),
      format('%s: PUBLIC nao pode ter privilegio', t);
    assert exists (select 1 from aclexplode(v_acl) a where a.grantee = 'service_role'::regrole and a.privilege_type = 'INSERT'),
      format('%s: service_role precisa de INSERT', t);
  end loop;

  select c.relacl into v_acl from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'post_process_batch_requests';
  assert not exists (select 1 from aclexplode(v_acl) a where a.grantee in ('anon'::regrole, 'authenticated'::regrole)),
    'post_process_batch_requests nao pode ser visivel ao cliente';
  raise notice 'PASS 83.12 grants das quatro tabelas';
end $$;
rollback;

-- 83.13
begin;
do $$
declare f record; v_proc bigint; v_seen int;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc;
  insert into post_process_batch_requests (request_id, conta_id, resultado)
    values (gen_random_uuid(), f.ws, '{"ok":true}'::jsonb);
  perform et_grant_hosted_parity(array['post_processes', 'post_process_steps',
    'post_process_events', 'post_process_batch_requests']);
  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select count(*) into v_seen from post_process_batch_requests;
    v_seen := coalesce(v_seen, -1);
  exception when insufficient_privilege then v_seen := 0;
  end;
  assert v_seen = 0, format('recibo de lote nao pode ser lido pelo membro, viu %s', v_seen);
  begin
    delete from post_processes where id = v_proc;
    get diagnostics v_seen = row_count;
  exception when insufficient_privilege then v_seen := 0;
  end;
  assert v_seen = 0, 'authenticated nao pode apagar processo';
  execute 'reset role';
  raise notice 'PASS 83.13 recibo invisivel e DELETE negado';
end $$;
rollback;
```

Por fim, em `supabase/tests/express_cleanup_delete_avulso_drafts.sql` (suíte de RPC
no nível de `supabase/tests`, rodada pelo segundo laço de `scripts/test-entitlements.sh`,
portanto barrada pelo CI igual às demais), trocar a linha do cabeçalho

```sql
-- E.2 processo concluido/encerrado nao poupa -- rascunho e apagado
```

por

```sql
-- E.2 processo concluido poupa o rascunho; encerrado continua nao poupando
```

e substituir o bloco E.2 inteiro por:

```sql
-- E.2
begin;
do $$
declare
  f record; g record;
  v_proc bigint; v_proc2 bigint; v_deleted bigint[];
begin
  select * into f from pg_temp.et_pp_fixture();
  select * into g from pg_temp.et_pp_fixture();
  update workflow_posts set is_express = true, status = 'rascunho', created_at = now() - interval '10 days' where id = f.post;
  update workflow_posts set is_express = true, status = 'rascunho', created_at = now() - interval '10 days' where id = g.post;

  insert into post_processes (conta_id, post_id, assinatura, estado) values (f.ws, f.post, '0|Copy|padrao', 'concluido') returning id into v_proc;
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento) values (g.ws, g.post, '0|Copy|padrao', 'encerrado', 'removido') returning id into v_proc2;

  -- concluido POUPA: a fase 2 cria o unico caminho para chegar a concluido e
  -- nenhum comando de processo tira o post de 'rascunho' (spec 5.5 e 6.2),
  -- entao sem esta regra o cron apagaria o trabalho e o historico inteiros.
  select public.express_cleanup_delete_avulso_drafts(array[f.post]) into v_deleted;
  assert v_deleted = '{}'::bigint[], format('processo concluido deve poupar o rascunho, veio %s', v_deleted);
  assert exists (select 1 from workflow_posts where id = f.post), 'rascunho com processo concluido deve continuar existindo';
  assert exists (select 1 from post_processes where id = v_proc), 'o processo concluido continua no banco';

  -- encerrado NAO poupa: removido ou vinculado, o post voltou a Sem processo.
  select public.express_cleanup_delete_avulso_drafts(array[g.post]) into v_deleted;
  assert v_deleted = array[g.post], format('processo encerrado nao deve poupar, veio %s', v_deleted);
  assert not exists (select 1 from workflow_posts where id = g.post), 'rascunho com processo encerrado deve ser apagado';
  assert not exists (select 1 from post_processes where id = v_proc2), 'processo encerrado deve ir no cascade do post';
  raise notice 'PASS E.2 concluido poupa, encerrado nao';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '83_|86_|express_cleanup|ran='`
Expected: FAIL nos três arquivos. `express_cleanup_delete_avulso_drafts.sql` falha em E.2, porque a RPC ainda em vigor é a de `20260918000004`, que só poupa `estado = 'ativo'` e apaga o rascunho com processo `concluido`. Em `86` a primeira falha é `function post_process_require_editor() does not exist` (a suíte para no bloco 86.0, que assere `concluido_em` limpo depois de `encerrado`, comportamento que a fase 1 não tem). Em `83` a falha é no bloco 83.12 (`authenticated` com `ALL` porque a paridade ainda cobre as quatro tabelas até o Step 3 do arquivo de teste ser aplicado; se a edição de 83.3 já estiver feita, a falha é só 83.12/83.13 pelas sequences e pelo DELETE).

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260919000002_post_process_hardening.sql
-- Endurecimento do schema da fase 1 e helpers internos da fase 2.
--
-- Fecha os minors diferidos no ledger da fase 1 (M1, M2, M4) e publica os
-- tres helpers que TODAS as RPCs desta fase usam. Nada aqui muda
-- comportamento de producao: nao existe processo nenhum no banco.

-- ------------------------------------------------------------------
-- 1. M2: indices das FKs compostas com SET NULL. Sem eles, todo DELETE em
-- workflows (inclusive o passo 2 do cron de limpeza, um fluxo por vez) e todo
-- DELETE de template varrem post_processes inteira para aplicar a acao
-- referencial. De graca hoje (zero linhas), caro depois.
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_post_processes_template ON public.post_processes (template_id);
CREATE INDEX IF NOT EXISTS idx_post_processes_origem   ON public.post_processes (origem_workflow_id);

-- ------------------------------------------------------------------
-- 2. M1: concluido_em precisa ser limpo em QUALQUER transicao para ativo, nao
-- so vindo de concluido. Sem isso, concluido -> encerrado -> ativo (remover e
-- depois desmembrar de novo nao acontece, mas vincular e reabrir sim) deixa um
-- carimbo velho que a UI mostraria como data de conclusao de um processo em
-- andamento. Corpo identico ao de 20260918000002 fora do ELSIF.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_post_process_concluido_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF old.estado IS DISTINCT FROM new.estado THEN
    IF new.estado = 'concluido' THEN
      new.concluido_em := now();
    ELSIF new.estado = 'ativo' THEN
      new.concluido_em := NULL;
    END IF;
  END IF;
  RETURN new;
END;
$$;

-- ------------------------------------------------------------------
-- 3. M4: o default ACL hosted deixa USAGE nas sequences novas para
-- anon/authenticated. Inofensivo (INSERT ja e negado por grant e por RLS), mas
-- a migration passa a se descrever sozinha.
-- ------------------------------------------------------------------
REVOKE ALL ON SEQUENCE public.post_processes_id_seq, public.post_process_steps_id_seq,
  public.post_process_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.post_processes_id_seq, public.post_process_steps_id_seq,
  public.post_process_events_id_seq TO service_role;

-- ------------------------------------------------------------------
-- 4. Helper de identidade e permissao. SECURITY INVOKER de proposito: quando
-- chamado de dentro de uma RPC SECURITY DEFINER, o current_user ja e o dono
-- (postgres), que e o unico role com EXECUTE em has_permission_for
-- (20260903000002 revoga de authenticated). auth.uid() e get_my_conta_id()
-- leem o JWT da requisicao e nao mudam com SECURITY DEFINER.
--
-- permission_denied: nao havia precedente exato de RPC que negasse por
-- has_permission_for; a casa usa identificador + P0001 em toda a familia
-- detach/attach/move, e o vizinho mais proximo (financial_access_denied,
-- 20260904000002) tambem e identificador com P0001.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_process_require_editor()
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF public.has_permission_for(auth.uid(), v_conta, 'entregas', 'editar') IS NOT TRUE THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_conta;
END;
$$;

-- Decisao 26: revogado tambem de service_role. Nenhum grant e necessario: as
-- RPCs SECURITY DEFINER desta fase sao do mesmo dono e chamam o helper como
-- dono, que executa por ser dono. Deixar implicito faria a checagem da Task 9
-- depender do default ACL do projeto.
REVOKE ALL ON FUNCTION public.post_process_require_editor() FROM public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 5. Helper de historico. Mesma resolucao de actor/actor_name de
-- record_workflow_event (20260826000001): nome em snapshot vindo de
-- profiles.nome, que sobrevive a saida do membro. origem 'system' quando o
-- chamador pediu ou quando nao ha usuario (chamada por service_role).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_process_log_event(
  p_conta      uuid,
  p_post_id    bigint,
  p_process_id bigint,
  p_evento     text,
  p_antes      jsonb,
  p_depois     jsonb,
  p_origem     text DEFAULT 'workspace_user'
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_nome  text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT p.nome INTO v_nome FROM profiles p WHERE p.id = v_actor;
  END IF;
  INSERT INTO post_process_events
    (conta_id, post_id, process_id, evento, actor_user_id, actor_name, origem, antes, depois)
  VALUES
    (p_conta, p_post_id, p_process_id, p_evento, v_actor, v_nome,
     CASE WHEN v_actor IS NULL OR p_origem = 'system' THEN 'system' ELSE 'workspace_user' END,
     p_antes, p_depois);
END;
$$;

REVOKE ALL ON FUNCTION public.post_process_log_event(uuid, bigint, bigint, text, jsonb, jsonb, text)
  FROM public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 6. Assinatura reconstruida do snapshot. As RPCs gravam
-- post_processes.assinatura a partir da FONTE (etapas do fluxo ou jsonb do
-- template), porque a coluna e NOT NULL e o INSERT do processo precede o das
-- etapas. Esta funcao existe para o outro lado: leitura e verificacao. As
-- suites fixam a igualdade entre o que foi gravado e o que ela reconstroi.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_process_assinatura(p_process_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(string_agg(s.ordem::text || '|' || s.nome || '|' || s.tipo, chr(10) ORDER BY s.ordem), '')
    FROM post_process_steps s
   WHERE s.process_id = p_process_id;
$$;

REVOKE ALL ON FUNCTION public.post_process_assinatura(bigint) FROM public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 7. A limpeza de Express passa a poupar tambem o rascunho avulso cujo
-- processo esta 'concluido' (Decisao 25).
--
-- POR QUE AQUI. A fase 2 cria o unico caminho para um processo chegar a
-- 'concluido' (transition_post_process com o comando 'concluir'), e por
-- desenho da spec (secoes 5.1, 5.2, 6.2 e criterio 12.4) NENHUM comando de
-- processo altera o status do post: um Express avulso com o processo inteiro
-- concluido continua 'rascunho'. Passado o cutoff, o passo 3 do
-- express-post-cleanup-cron o entregaria a esta RPC, o NOT EXISTS antigo
-- (so 'ativo') nao o pouparia, e o DELETE levaria por CASCADE o processo, as
-- etapas e todo o post_process_events. O defeito nasce nesta fase, entao e
-- aqui que ele fecha.
--
-- 'encerrado' continua NAO poupando, de proposito: removido ou vinculado, o
-- post voltou a Sem processo e e um rascunho abandonado como qualquer outro.
-- O historico daquele processo encerrado vai junto no CASCADE, o que e
-- aceitavel na v1 e esta registrado na Decisao 25.
--
-- Corpo identico ao de 20260918000004 fora do NOT EXISTS. E a RPC, e nao o
-- pre-filtro do handler, que garante a regra (o comentario daquela migration e
-- a secao 10 da spec dizem isso). NENHUMA edge function muda: o pre-filtro
-- continua com .eq("estado", "ativo") e os ids poupados a mais ja entram em
-- avulso_skipped_with_process, que o handler soma DEPOIS da RPC comparando os
-- ids enviados com os devolvidos.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.express_cleanup_delete_avulso_drafts(p_ids bigint[])
RETURNS bigint[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted bigint[];
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN '{}'::bigint[];
  END IF;

  PERFORM 1 FROM workflow_posts wp
    WHERE wp.id = ANY (p_ids)
    ORDER BY wp.id
    FOR UPDATE;

  WITH del AS (
    DELETE FROM workflow_posts wp
     WHERE wp.id = ANY (p_ids)
       AND wp.is_express
       AND wp.workflow_id IS NULL
       AND wp.status = 'rascunho'
       AND NOT EXISTS (
         SELECT 1 FROM post_processes pp
          WHERE pp.post_id = wp.id AND pp.estado IN ('ativo', 'concluido')
       )
    RETURNING wp.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::bigint[]) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

-- CREATE OR REPLACE preserva o ACL, mas repetir mantem a migration
-- autodescritiva, no mesmo molde de 20260918000004.
REVOKE ALL ON FUNCTION public.express_cleanup_delete_avulso_drafts(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.express_cleanup_delete_avulso_drafts(bigint[]) TO service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '83_|84_|85_|86_|express_cleanup|ran='`
Expected: PASS nos cinco arquivos, `failures=0`. Duas regressões a vigiar: (a) 83.3, onde com as quatro tabelas fora da paridade o SELECT impersonado tem que continuar vendo as linhas (o `GRANT SELECT` da migration da fase 1 é o que o permite) e o UPDATE agora pode falhar com `42501` em vez de zero linhas; (b) `express_cleanup_delete_avulso_drafts.sql`, cujos blocos E.0, E.1, E.3 e E.4 não mudam de resultado, só o E.2.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260919000002_post_process_hardening.sql \
        supabase/tests/entitlements/86_post_process_helpers.sql \
        supabase/tests/entitlements/83_post_processes_schema.sql \
        supabase/tests/express_cleanup_delete_avulso_drafts.sql
git commit -m "feat(entregas): endurecimento do schema de processos e helpers internos

Poupa tambem o rascunho Express avulso com processo concluido na limpeza do
express-post-cleanup-cron, sem mudar nenhuma edge function.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `detach_posts_keeping_process`

**Files:**
- Create: `supabase/migrations/20260919000003_detach_posts_keeping_process.sql`
- Test: `supabase/tests/entitlements/87_detach_posts_keeping_process.sql`

**Interfaces:**
- Consumes: `workflow_fingerprint` (Task 1), `post_process_require_editor`, `post_process_log_event`, `post_process_assinatura` (Task 2).
- Produces: `public.detach_posts_keeping_process(bigint[], bigint, text, timestamptz, uuid, jsonb, boolean) RETURNS jsonb`, com o retorno e os códigos da seção Interfaces.

Regras fixadas (spec §5.1, §7, §9.4, §9.5):

- Advisory `:post_move` no topo, antes de qualquer lock de linha e antes do INSERT em `post_processes`.
- Idempotência por `p_request_id` consultada **depois** do advisory: duas chamadas simultâneas com o mesmo id serializam, a segunda encontra o recibo.
- O recibo guarda um digest canônico das entradas em `resultado -> 'input_hash'` (`md5` de fluxo, ids ordenados e fingerprint). O replay só devolve o resultado guardado quando o digest confere; entradas diferentes sob o mesmo `p_request_id` respondem `request_mismatch` (Decisão 28). A chave é removida da resposta, então o formato de retorno não muda.
- Lote atômico: um id inexistente, de outra conta ou fora do fluxo declarado derruba a transação inteira.
- A origem precisa estar `ativo` e ter exatamente uma etapa `ativo`.
- Etapas anteriores à ativa viram `herdado`; a ativa vira `ativo` com `iniciado_em = now()` e `prazo_efetivo = p_active_deadline`; as posteriores viram `pendente`, com `prazo_efetivo` só quando `p_step_deadlines` traz a data daquela ordem.
- Status, conteúdo, mídia, aprovações e agendamento do post não são tocados. A pasta é reparentada sozinha por `folder_sync_post`.
- `responsavel_id` copiado de `workflow_etapas` só entra no snapshot se ainda resolver para um membro da conta; senão entra nulo. `workflow_etapas.responsavel_id` é FK simples para `membros(id)`, sem checagem de tenant, e `post_process_steps.responsavel_id` tem FK composta com `conta_id`: sem essa resolução, um valor cross-tenant derrubaria o lote inteiro com `foreign_key_violation` cru, sem código. É a mesma regra da Decisão 17, agora aplicada aos dois lados.
- Nada é gravado no histórico do **fluxo de origem** (`record_workflow_event`). A §5.1 diz "o histórico do fluxo continua no fluxo", o que é ambíguo; a decisão explícita está na Decisão 27, que também registra a consequência (quem abrir o fluxo não vê que três posts saíram dele).

- [ ] **Step 1: Escrever a suíte que falha**

```sql
-- supabase/tests/entitlements/87_detach_posts_keeping_process.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- detach_posts_keeping_process (migration 20260919000003). Cobre:
-- 87.0 happy path: dois posts, etapas herdadas/ativa/pendente, eventos, status intocado
-- 87.1 idempotencia: o mesmo request_id devolve o mesmo resultado sem novos efeitos
-- 87.2 fingerprint divergente -> workflow_changed e nada muda
-- 87.3 lote parcial (post de outra conta) -> post_not_found e rollback total
-- 87.4 permissao e flag: entregas=ver -> permission_denied; flag off -> feature_disabled
-- 87.5 arquivamento do fluxo esvaziado e prazos de etapas futuras
-- 87.6 erros de argumento e de pre-condicao, agrupados num bloco so
-- 87.7 responsavel herdado que nao resolve para membro da conta vira nulo
-- 87.8 mesmo request_id com outro lote -> request_mismatch; entradas iguais -> replay
--
-- IMPORTANTE. workflow_fingerprint e SECURITY INVOKER (Decisao 11) e o
-- argumento e avaliado no contexto do CHAMADOR, nao dentro da RPC. Sob
-- 'set local role authenticated' e sem et_grant_hosted_parity, ler workflows
-- levanta 'permission denied' no banco local do CLI (ver _helpers.sql). Por
-- isso, todos os blocos calculam o fingerprint numa variavel ANTES de impersonar.

create or replace function pg_temp.et_dt_env(
  out ws uuid, out usr uuid, out cli bigint, out wf bigint,
  out p1 bigint, out p2 bigint, out p3 bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, etapa_atual, modo_prazo)
    values (usr, ws, cli, 'Conteudo de setembro', 'ativo', 1, 'padrao') returning id into wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (wf, 0, 'Copy', 2, 'corridos', 'padrao', 'concluido', timestamptz '2026-09-01 12:00:00+00');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (wf, 1, 'Design', 3, 'corridos', 'padrao', 'ativo', timestamptz '2026-09-03 09:00:00+00');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (wf, 2, 'Aprovacao', 1, 'uteis', 'aprovacao_cliente', 'pendente');
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo, status)
    values (wf, ws, cli, 'Post 1', 'aprovado_interno') returning id into p1;
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo, status)
    values (wf, ws, cli, 'Post 2', 'rascunho') returning id into p2;
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo, status)
    values (wf, ws, cli, 'Post 3', 'rascunho') returning id into p3;
end $$;

-- 87.0
begin;
do $$
declare
  e record; v_res jsonb; v_proc bigint; v_n int; v_status text; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := detach_posts_keeping_process(
    array[e.p1, e.p2], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  execute 'reset role';

  assert (v_res ->> 'ok')::boolean, 'retorno deve ser ok';
  assert (v_res ->> 'detached')::int = 2, format('detached esperado 2, obtido %s', v_res ->> 'detached');
  assert jsonb_array_length(v_res -> 'processes') = 2, 'dois processos criados';

  select count(*) into v_n from workflow_posts where id in (e.p1, e.p2) and workflow_id is null;
  assert v_n = 2, 'os dois posts ficam avulsos';
  select workflow_id into v_n from workflow_posts where id = e.p3;
  assert v_n = e.wf, 'o post nao pedido continua no fluxo';
  select status into v_status from workflow_posts where id = e.p1;
  assert v_status = 'aprovado_interno', 'desmembrar nao altera status do post';

  select id into v_proc from post_processes where post_id = e.p1;
  perform 1 from post_processes where id = v_proc and estado = 'ativo' and etapa_atual = 1
    and origem_workflow_id = e.wf and origem_descricao = 'Conteudo de setembro, etapa Design'
    and modo_prazo = 'padrao' and revisao = 1;
  assert found, 'processo criado na etapa ativa da origem com a descricao de origem';
  perform 1 from post_processes where id = v_proc and assinatura = post_process_assinatura(v_proc);
  assert found, 'assinatura gravada precisa bater com a reconstruida das etapas';

  select count(*) into v_n from post_process_steps where process_id = v_proc;
  assert v_n = 3, format('tres etapas em snapshot, obtidas %s', v_n);
  perform 1 from post_process_steps where process_id = v_proc and ordem = 0
    and estado = 'herdado' and iniciado_em is null and origem_etapa_nome = 'Copy';
  assert found, 'etapa anterior fica herdada, sem conclusao ficticia';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 1
    and estado = 'ativo' and prazo_efetivo = timestamptz '2026-09-06 02:59:59+00' and iniciado_em is not null;
  assert found, 'etapa ativa herda o prazo congelado e comeca agora';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 2
    and estado = 'pendente' and prazo_efetivo is null and tipo = 'aprovacao_cliente' and prazo_dias = 1;
  assert found, 'etapa futura fica pendente com prazo relativo preservado';

  select count(*) into v_n from post_process_events where process_id = v_proc and evento = 'desmembrado';
  assert v_n = 1, 'um evento desmembrado por post';
  perform 1 from post_process_events where process_id = v_proc and actor_user_id = e.usr and origem = 'workspace_user';
  assert found, 'evento carrega autor e origem';
  raise notice 'PASS 87.0 desmembrar mantendo etapas';
end $$;
rollback;

-- 87.1
begin;
do $$
declare e record; v_req uuid := gen_random_uuid(); v_a jsonb; v_b jsonb; v_n int; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_a := detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', v_req);
  v_b := detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', v_req);
  execute 'reset role';
  assert v_a = v_b, 'o mesmo request_id deve devolver o resultado guardado';
  select count(*) into v_n from post_processes where post_id = e.p1;
  assert v_n = 1, format('repetir o lote nao pode criar outro processo, encontrados %s', v_n);
  select count(*) into v_n from post_process_events where post_id = e.p1;
  assert v_n = 1, format('repetir o lote nao pode criar outro evento, encontrados %s', v_n);
  select count(*) into v_n from post_process_batch_requests where request_id = v_req and conta_id = e.ws;
  assert v_n = 1, 'um recibo por request_id';
  raise notice 'PASS 87.1 idempotencia do lote';
end $$;
rollback;

-- 87.2
begin;
do $$
declare e record; v_fp text; v_raised boolean := false; v_n int;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  update workflow_etapas set nome = 'Design final' where workflow_id = e.wf and ordem = 1;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'fingerprint velho deve levantar workflow_changed';
  select count(*) into v_n from post_processes where post_id = e.p1;
  assert v_n = 0, 'nada pode ter sido criado';
  raise notice 'PASS 87.2 fingerprint divergente';
end $$;
rollback;

-- 87.3
begin;
do $$
declare e record; g record; v_raised boolean := false; v_n int; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  select * into g from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1, g.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post de outra conta no lote deve levantar post_not_found';
  select count(*) into v_n from workflow_posts where id = e.p1 and workflow_id = e.wf;
  assert v_n = 1, 'o post da propria conta continua no fluxo (rollback total)';
  select count(*) into v_n from post_processes;
  assert v_n = 0, 'nenhum processo criado';
  raise notice 'PASS 87.3 lote parcial derruba tudo';
end $$;
rollback;

-- 87.4
begin;
do $$
declare
  e record; v_ver uuid := gen_random_uuid(); v_role uuid; v_raised boolean := false; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions) values (e.ws, 'ver', '{"entregas":"ver"}'::jsonb)
    returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, e.ws, 'agent', v_role);
  update profiles set conta_id = e.ws, active_workspace_id = e.ws where id = v_ver;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ver, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'permission_denied', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'entregas=ver deve levantar permission_denied';

  v_raised := false;
  update plans set feature_post_processes = false where id = (select plan_id from workspaces where id = e.ws);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'feature_disabled:feature_post_processes', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'flag desligada deve levantar feature_disabled antes do trigger';
  raise notice 'PASS 87.4 permissao e flag';
end $$;
rollback;

-- 87.5
begin;
do $$
declare e record; v_res jsonb; v_proc bigint; v_status text; v_prazo timestamptz; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := detach_posts_keeping_process(
    array[e.p1, e.p2, e.p3], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', gen_random_uuid(),
    jsonb_build_object('2', '2026-09-20T02:59:59.000Z'), true);
  execute 'reset role';

  select status into v_status from workflows where id = e.wf;
  assert v_status = 'arquivado', 'fluxo esvaziado deve ser arquivado quando pedido';
  assert v_res -> 'archived_workflow_ids' = to_jsonb(array[e.wf]), 'retorno lista o fluxo arquivado';
  select id into v_proc from post_processes where post_id = e.p1;
  select prazo_efetivo into v_prazo from post_process_steps where process_id = v_proc and ordem = 2;
  assert v_prazo = timestamptz '2026-09-20T02:59:59.000Z', 'etapa futura recebe o prazo enviado pelo CRM';
  raise notice 'PASS 87.5 arquivamento e prazos de etapas futuras';
end $$;
rollback;

-- 87.6
begin;
do $$
declare
  e record; g record; v_fp text; v_fp2 text; v_wf2 bigint;
  v_req uuid := gen_random_uuid(); v_raised boolean;
  v_prazo timestamptz := timestamptz '2026-09-06 02:59:59+00';
begin
  select * into e from pg_temp.et_dt_env();
  select * into g from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  -- recibo de lote de OUTRA conta, para o caminho request_not_found
  insert into post_process_batch_requests (request_id, conta_id, resultado)
    values (v_req, g.ws, '{"ok":true}'::jsonb);
  -- segundo fluxo da propria conta, para o caminho post_not_in_source_flow
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, etapa_atual, modo_prazo)
    values (e.usr, e.ws, e.cli, 'Outro fluxo', 'ativo', 0, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (v_wf2, 0, 'Copy', 2, 'corridos', 'padrao', 'ativo', timestamptz '2026-09-02 10:00:00+00');
  v_fp2 := workflow_fingerprint(v_wf2);

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'request_id_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'p_request_id nulo deve levantar request_id_required';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, null, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'active_deadline_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'p_active_deadline nulo deve levantar active_deadline_required';

  v_raised := false;
  begin
    perform detach_posts_keeping_process('{}'::bigint[], e.wf, v_fp, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_ids_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'lote vazio deve levantar post_ids_required';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, v_req);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'request_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'recibo de outra conta deve levantar request_not_found';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], g.wf, v_fp, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'fluxo de outra conta deve levantar workflow_not_found';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], v_wf2, v_fp2, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_in_source_flow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'post que nao esta no fluxo declarado deve levantar post_not_in_source_flow';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid(),
      jsonb_build_object('0', '2026-09-20T02:59:59.000Z'));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_deadlines', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'prazo para etapa anterior a ativa deve levantar invalid_step_deadlines';
  execute 'reset role';

  -- fluxo arquivado: a checagem vem antes do fingerprint, entao v_fp serve
  update workflows set status = 'arquivado' where id = e.wf;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_active', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'fluxo arquivado deve levantar workflow_not_active';

  -- duas etapas ativas: o fingerprint muda com o status, entao recalcula antes
  update workflows set status = 'ativo' where id = e.wf;
  update workflow_etapas set status = 'ativo' where workflow_id = e.wf and ordem = 0;
  v_fp := workflow_fingerprint(e.wf);
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_etapas_inconsistent', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'duas etapas ativas devem levantar workflow_etapas_inconsistent';

  assert not exists (select 1 from post_processes), 'nenhum argumento invalido pode ter criado processo';
  raise notice 'PASS 87.6 erros de argumento e de pre-condicao';
end $$;
rollback;

-- 87.7
begin;
do $$
declare e record; g record; v_membro bigint; v_alheio bigint; v_fp text; v_proc bigint;
begin
  select * into e from pg_temp.et_dt_env();
  select * into g from pg_temp.et_dt_env();
  insert into membros (user_id, conta_id, nome) values (e.usr, e.ws, 'Designer') returning id into v_membro;
  insert into membros (user_id, conta_id, nome) values (g.usr, g.ws, 'Alheio') returning id into v_alheio;
  -- workflow_etapas.responsavel_id e FK SIMPLES para membros(id), sem checagem
  -- de tenant: dado velho ou importado pode apontar para membro de outra conta.
  -- post_process_steps.responsavel_id tem FK COMPOSTA com conta_id, entao a
  -- copia direta derrubaria o lote com foreign_key_violation cru (Decisao 17).
  update workflow_etapas set responsavel_id = v_membro where workflow_id = e.wf and ordem = 0;
  update workflow_etapas set responsavel_id = v_alheio where workflow_id = e.wf and ordem = 1;
  v_fp := workflow_fingerprint(e.wf);

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  execute 'reset role';

  select id into v_proc from post_processes where post_id = e.p1;
  perform 1 from post_process_steps where process_id = v_proc and ordem = 0 and responsavel_id = v_membro;
  assert found, 'responsavel da propria conta e preservado no snapshot';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 1 and responsavel_id is null;
  assert found, 'responsavel de outra conta vira nulo em vez de derrubar o lote';
  raise notice 'PASS 87.7 responsavel herdado que nao resolve vira nulo';
end $$;
rollback;

-- 87.8
begin;
do $$
declare e record; v_req uuid := gen_random_uuid(); v_fp text;
        v_a jsonb; v_b jsonb; v_raised boolean := false; v_n int;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_a := detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', v_req);

  -- Mesmo recibo, outro lote: o digest nao confere e a RPC recusa em vez de
  -- devolver o resultado do primeiro lote como se o segundo tivesse rodado.
  begin
    perform detach_posts_keeping_process(array[e.p2], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', v_req);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'request_mismatch', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;

  -- Entradas iguais: replay puro, mesmo resultado e nenhum efeito novo.
  v_b := detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', v_req);
  execute 'reset role';

  assert v_raised, 'mesmo request_id com outro lote deve levantar request_mismatch';
  assert v_a = v_b, 'entradas iguais devolvem o resultado guardado';
  assert v_a ->> 'input_hash' is null, 'o digest fica no recibo, fora da resposta';
  select count(*) into v_n from post_processes where post_id in (e.p1, e.p2);
  assert v_n = 1, format('nenhum processo novo, encontrados %s', v_n);
  perform 1 from workflow_posts where id = e.p2 and workflow_id = e.wf;
  assert found, 'o post do lote divergente continua no fluxo';
  select count(*) into v_n from post_process_batch_requests where request_id = v_req and conta_id = e.ws;
  assert v_n = 1, 'um recibo por request_id';
  raise notice 'PASS 87.8 request_id reusado com entradas diferentes';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '87_|ran='`
Expected: FAIL com `function detach_posts_keeping_process(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260919000003_detach_posts_keeping_process.sql
-- Desmembrar do fluxo mantendo as etapas (spec
-- 2026-09-10-posts-individuais-fluxos-design.md, secoes 5.1, 7, 9.4, 9.5).
--
-- Estende a familia detach/attach/move (20260830000004, 20260901110000):
-- mesmo estilo de erro, mesmos REVOKE/GRANT, mesmo padrao
-- "PERFORM ... FOR UPDATE" seguido de agregacao numa instrucao separada.
--
-- ORDEM DE LOCKS. Advisory ':post_move' no TOPO, antes de qualquer lock de
-- linha. Isso e obrigatorio e nao so higiene: a FK composta
-- post_processes_origem_same_tenant pega FOR KEY SHARE em workflows quando o
-- processo e inserido com origem_workflow_id, e isso fecha ciclo com o FOR
-- UPDATE que attach_posts_to_flow segura na linha do fluxo alvo. Com o
-- advisory, as duas RPCs nunca interleiam na mesma conta. Locks de linha
-- depois, sempre fluxo -> post -> processo.
--
-- IDEMPOTENCIA. p_request_id e consultado DEPOIS do advisory: duas chamadas
-- simultaneas com o mesmo id serializam no advisory, a segunda encontra o
-- recibo e devolve o resultado guardado sem repetir efeito. O evento por post
-- nao carrega o id da requisicao (spec 8.1); o recibo e a unica trilha.
--
-- DIGEST DAS ENTRADAS. O recibo nao guarda so o resultado: guarda tambem
-- 'input_hash', o md5 de p_workflow_id, dos ids do lote ja deduplicados e
-- ORDENADOS, e de p_fingerprint. Sem ele, reusar um request_id com outro lote
-- devolveria o resultado do lote antigo com 'ok': true e o CRM daria por feito
-- um desmembrar que nunca aconteceu. Com ele, entrada divergente responde
-- request_mismatch. A chave e adicionada ao gravar e removida ao devolver, de
-- modo que o formato de retorno da secao Interfaces nao muda.
--
-- PRAZOS. Quem calcula prazo efetivo e o CRM (computeDeadlineDate), com o fuso
-- do navegador; a RPC so armazena. p_active_deadline e o prazo congelado da
-- etapa ativa da origem, obrigatorio. p_step_deadlines e o mapa
-- {"<ordem>": "<ISO>"} das etapas POSTERIORES a ativa que tinham data fixa na
-- origem: post_process_steps nao tem coluna data_limite, entao sem esse mapa a
-- data fixa de uma etapa futura se perderia no snapshot. Etapa futura sem
-- entrada no mapa fica com prazo_efetivo nulo e recebe prazo quando for
-- ativada por transition_post_process.

CREATE OR REPLACE FUNCTION public.detach_posts_keeping_process(
  p_post_ids            bigint[],
  p_workflow_id         bigint,
  p_fingerprint         text,
  p_active_deadline     timestamptz,
  p_request_id          uuid,
  p_step_deadlines      jsonb   DEFAULT NULL,
  p_archive_empty_flow  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta       uuid := public.post_process_require_editor();
  v_ids         bigint[];
  v_requested   int;
  v_hash        text;
  v_owned       int;
  v_fora        int;
  v_prev        jsonb;
  v_wf          record;
  v_ativa       record;
  v_n_ativas    int;
  v_assinatura  text;
  v_tmpl_nome   text;
  v_board       integer;
  v_key         text;
  v_val         text;
  v_post_id     bigint;
  v_proc        bigint;
  v_proc_ids    bigint[] := '{}';
  v_detached    int;
  v_archived    bigint[] := '{}';
  v_processes   jsonb;
  v_steps       jsonb;
  v_res         jsonb;
BEGIN
  IF NOT effective_plan_feature(v_conta, 'feature_post_processes') THEN
    RAISE EXCEPTION 'feature_disabled:feature_post_processes' USING ERRCODE = 'P0001';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_active_deadline IS NULL THEN
    RAISE EXCEPTION 'active_deadline_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_ids
    FROM unnest(p_post_ids) x WHERE x IS NOT NULL;
  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  -- Digest canonico das entradas que identificam o lote. v_ids ja esta
  -- deduplicado e ordenado, entao a mesma chamada em outra ordem de ids da o
  -- mesmo hash.
  v_hash := md5(coalesce(p_workflow_id::text, '') || '|' ||
                array_to_string(v_ids, ',') || '|' ||
                coalesce(p_fingerprint, ''));

  -- PASSO 0: advisory por conta, antes de tudo.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- PASSO 1: recibo de idempotencia.
  SELECT r.resultado INTO v_prev
    FROM post_process_batch_requests r
   WHERE r.request_id = p_request_id AND r.conta_id = v_conta;
  IF FOUND THEN
    IF v_prev ->> 'input_hash' IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'request_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_prev - 'input_hash';
  END IF;
  -- request_id e PK global: existir sem casar a conta e recibo alheio.
  IF EXISTS (SELECT 1 FROM post_process_batch_requests r WHERE r.request_id = p_request_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 2: fluxo de origem travado.
  SELECT w.id, w.titulo, w.status, w.template_id, w.modo_prazo
    INTO v_wf
    FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_wf.status <> 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 3: fingerprint recalculado sob lock.
  IF public.workflow_fingerprint(p_workflow_id) IS DISTINCT FROM p_fingerprint THEN
    RAISE EXCEPTION 'workflow_changed' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 4: exatamente uma etapa ativa.
  SELECT count(*) INTO v_n_ativas FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo';
  IF v_n_ativas <> 1 THEN
    RAISE EXCEPTION 'workflow_etapas_inconsistent' USING ERRCODE = 'P0001';
  END IF;
  SELECT e.ordem, e.nome INTO v_ativa FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo';

  -- PASSO 5: mapa de prazos de etapas futuras.
  IF p_step_deadlines IS NOT NULL THEN
    IF jsonb_typeof(p_step_deadlines) <> 'object' THEN
      RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(p_step_deadlines) LOOP
      IF v_key !~ '^[0-9]+$' OR v_key::integer <= v_ativa.ordem THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM workflow_etapas e
                      WHERE e.workflow_id = p_workflow_id AND e.ordem = v_key::integer) THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        PERFORM v_val::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END;
    END LOOP;
  END IF;

  -- PASSO 6: posts travados em ordem estavel, all-or-nothing.
  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;

  SELECT count(*) INTO v_owned FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta;
  IF v_owned <> v_requested THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_fora FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
     AND wp.workflow_id IS DISTINCT FROM p_workflow_id;
  IF v_fora > 0 THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 7: snapshot compartilhado (assinatura, nome do template, base do board).
  SELECT string_agg(e.ordem::text || '|' || e.nome || '|' || coalesce(nullif(e.tipo, ''), 'padrao'),
                    chr(10) ORDER BY e.ordem)
    INTO v_assinatura
    FROM workflow_etapas e WHERE e.workflow_id = p_workflow_id;

  SELECT t.nome INTO v_tmpl_nome FROM workflow_templates t
   WHERE t.id = v_wf.template_id AND t.conta_id = v_conta;

  -- Base do board: max entre os processos que APARECEM no quadro, ativos e
  -- concluidos. So os ativos deixaria um concluido reaberto colidindo com um
  -- processo novo na mesma posicao (Decisao 19). Encerrado nao aparece.
  SELECT coalesce(max(pp.board_position), -1) INTO v_board
    FROM post_processes pp WHERE pp.conta_id = v_conta AND pp.estado IN ('ativo', 'concluido');

  -- PASSO 8: desvincular. O GUC e transacional e volta a 'off' logo depois,
  -- para nao deixar post_a0_sync_cliente aberto no resto da transacao. O
  -- trigger post_a1_process_guard nao dispara aqui: o UPDATE zera workflow_id.
  PERFORM set_config('app.allow_post_move', 'on', true);
  UPDATE workflow_posts SET workflow_id = NULL
   WHERE id = ANY(v_ids) AND conta_id = v_conta;
  GET DIAGNOSTICS v_detached = ROW_COUNT;
  PERFORM set_config('app.allow_post_move', 'off', true);

  -- PASSO 9: um processo por post, com as etapas em snapshot e o evento.
  FOREACH v_post_id IN ARRAY v_ids LOOP
    v_board := v_board + 1;
    INSERT INTO post_processes
      (conta_id, post_id, template_id, template_nome, assinatura, origem_workflow_id,
       origem_descricao, estado, etapa_atual, modo_prazo, board_position, created_by)
    VALUES
      (v_conta, v_post_id, v_wf.template_id, v_tmpl_nome, v_assinatura, p_workflow_id,
       v_wf.titulo || ', etapa ' || v_ativa.nome, 'ativo', v_ativa.ordem,
       coalesce(v_wf.modo_prazo, 'padrao'), v_board, auth.uid())
    RETURNING id INTO v_proc;
    v_proc_ids := v_proc_ids || v_proc;

    INSERT INTO post_process_steps
      (conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias, tipo_prazo,
       prazo_efetivo, estado, iniciado_em, origem_etapa_ordem, origem_etapa_nome)
    SELECT
      v_conta, v_proc, e.ordem, e.nome, coalesce(nullif(e.tipo, ''), 'padrao'),
      -- Decisao 17 tambem aqui: workflow_etapas.responsavel_id e FK simples
      -- para membros(id), sem tenant. post_process_steps.responsavel_id tem FK
      -- composta com conta_id, entao um valor cross-tenant derrubaria o lote
      -- inteiro com foreign_key_violation cru, sem codigo. Nao resolve, vira
      -- nulo, e a UI mostra "Sem responsavel".
      (SELECT m.id FROM membros m WHERE m.id = e.responsavel_id AND m.conta_id = v_conta),
      e.prazo_dias, e.tipo_prazo,
      CASE WHEN e.ordem = v_ativa.ordem THEN p_active_deadline
           WHEN e.ordem > v_ativa.ordem
             THEN (p_step_deadlines ->> e.ordem::text)::timestamptz
           ELSE NULL END,
      CASE WHEN e.ordem < v_ativa.ordem THEN 'herdado'
           WHEN e.ordem = v_ativa.ordem THEN 'ativo'
           ELSE 'pendente' END,
      CASE WHEN e.ordem = v_ativa.ordem THEN now() ELSE NULL END,
      e.ordem, e.nome
      FROM workflow_etapas e
     WHERE e.workflow_id = p_workflow_id;

    PERFORM public.post_process_log_event(
      v_conta, v_post_id, v_proc, 'desmembrado',
      jsonb_build_object('workflow_id', p_workflow_id, 'workflow_titulo', v_wf.titulo,
                         'etapa_ordem', v_ativa.ordem, 'etapa_nome', v_ativa.nome),
      jsonb_build_object('process_id', v_proc, 'etapa_atual', v_ativa.ordem,
                         'prazo_efetivo', p_active_deadline));
  END LOOP;

  -- PASSO 10: arquivar a origem se este lote a esvaziou. A linha ja esta
  -- travada desde o passo 2; a ressalva contra INSERT concorrente e a mesma de
  -- detach_posts_from_flow (o FOR SHARE do trigger na linha do fluxo).
  IF p_archive_empty_flow
     AND NOT EXISTS (SELECT 1 FROM workflow_posts wp WHERE wp.workflow_id = p_workflow_id) THEN
    UPDATE workflows SET status = 'arquivado' WHERE id = p_workflow_id;
    v_archived := ARRAY[p_workflow_id];
  END IF;

  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.post_id) INTO v_processes FROM (
    SELECT pp.id AS process_id, pp.post_id, pp.etapa_atual, pp.revisao, pp.board_position,
           pp.assinatura, pp.origem_workflow_id, pp.origem_descricao
      FROM post_processes pp WHERE pp.id = ANY(v_proc_ids)) x;

  SELECT jsonb_agg(to_jsonb(y) ORDER BY y.process_id, y.ordem) INTO v_steps FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = ANY(v_proc_ids)) y;

  v_res := jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'detached', v_detached,
    'archived_workflow_ids', to_jsonb(v_archived),
    'processes', coalesce(v_processes, '[]'::jsonb),
    'steps', coalesce(v_steps, '[]'::jsonb));

  INSERT INTO post_process_batch_requests (request_id, conta_id, resultado)
  VALUES (p_request_id, v_conta, v_res || jsonb_build_object('input_hash', v_hash));

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.detach_posts_keeping_process(bigint[], bigint, text, timestamptz, uuid, jsonb, boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.detach_posts_keeping_process(bigint[], bigint, text, timestamptz, uuid, jsonb, boolean)
  TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '8[3-7]_|ran='`
Expected: PASS em 83, 84, 85, 86 e 87; `failures=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260919000003_detach_posts_keeping_process.sql \
        supabase/tests/entitlements/87_detach_posts_keeping_process.sql
git commit -m "feat(entregas): RPC detach_posts_keeping_process com idempotencia de lote

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `apply_post_process`

**Files:**
- Create: `supabase/migrations/20260919000004_apply_post_process.sql`
- Test: `supabase/tests/entitlements/88_apply_post_process.sql`

**Interfaces:**
- Consumes: `template_fingerprint` (Task 1) e os três helpers (Task 2).
- Produces: `public.apply_post_process(bigint, bigint, text, integer, jsonb) RETURNS jsonb`.

Regras fixadas (spec §5.2, §7, §12.13a):

- A sequência vem do template, reconstruída no servidor. Do cliente só entra `p_step_overrides`, mapa `{"<ordem>": {"responsavel_id": <n|null>, "prazo_efetivo": "<ISO|null>"}}`. Qualquer outra chave, ordem inexistente, ordem anterior à inicial ou responsável de outra conta é rejeitado.
- `p_step_overrides` da etapa inicial precisa trazer `prazo_efetivo` não nulo (`start_deadline_required`). Etapas posteriores podem trazer ou não.
- Template com `modo_prazo = 'data_entrega'`: a sequência a partir de `p_start_ordem` precisa conter ao menos uma etapa de tipo `aprovacao_cliente`, senão `data_entrega_requires_approval_step`. É a exigência estrutural da §7, e é checagem de **forma**, não de data: só olha `tipo` no jsonb do template, sem reimplementar dias úteis nem `clientes.dia_entrega` em SQL. Os demais modos ignoram a regra (Decisão 18).
- Etapas anteriores a `p_start_ordem` ficam `ignorado`. Status, conteúdo e agendamento do post não mudam.
- Um `responsavel_id` que veio do próprio template e não resolve mais para um membro da conta é gravado como nulo (a UI mostra "Sem responsável"); um `responsavel_id` vindo de override que não resolve é erro (`membro_not_found`).

- [ ] **Step 1: Escrever a suíte que falha**

```sql
-- supabase/tests/entitlements/88_apply_post_process.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- apply_post_process (migration 20260919000004). Cobre:
-- 88.0 happy path a partir do meio: anteriores ignoradas, inicial ativa, evento
-- 88.1 template editado depois do dialogo -> template_changed
-- 88.2 overrides invalidos: chave estranha, ordem anterior a inicial, responsavel alheio
-- 88.3 post ja em fluxo -> post_in_workflow; post com processo vigente -> post_has_active_process
-- 88.4 template de outra conta -> template_not_found; template vazio -> template_empty
-- 88.5 invalid_start_ordem: fora da sequencia, negativa e nula
-- 88.6 modo data_entrega sem etapa aprovacao_cliente na sequencia -> erro
--
-- IMPORTANTE. template_fingerprint e SECURITY INVOKER (Decisao 11) e o
-- argumento e avaliado no contexto do CHAMADOR. Sob 'set local role
-- authenticated' e sem et_grant_hosted_parity, ler workflow_templates levanta
-- 'permission denied' no banco local do CLI (ver _helpers.sql). Por isso todo
-- bloco calcula o fingerprint numa variavel ANTES de impersonar.

create or replace function pg_temp.et_ap_env(
  out ws uuid, out usr uuid, out cli bigint, out post bigint, out tmpl bigint, out membro bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into membros (user_id, conta_id, nome) values (usr, ws, 'Designer') returning id into membro;
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (ws, cli, 'Avulso aprovado', 'aprovado_cliente') returning id into post;
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo) values (usr, ws, 'Modelo', jsonb_build_array(
    jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
    jsonb_build_object('nome', 'Design', 'prazo_dias', 3, 'tipo_prazo', 'corridos'),
    jsonb_build_object('nome', 'Aprovacao', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'aprovacao_cliente')
  ), 'padrao') returning id into tmpl;
end $$;

-- 88.0
begin;
do $$
declare e record; v_res jsonb; v_proc bigint; v_n int; v_status text; v_fp text;
begin
  select * into e from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := apply_post_process(e.post, e.tmpl, v_fp, 1, jsonb_build_object(
    '1', jsonb_build_object('responsavel_id', e.membro, 'prazo_efetivo', '2026-09-15T02:59:59.000Z'),
    '2', jsonb_build_object('prazo_efetivo', '2026-09-18T02:59:59.000Z')));
  execute 'reset role';

  v_proc := (v_res ->> 'process_id')::bigint;
  assert (v_res ->> 'etapa_atual')::int = 1 and (v_res ->> 'revisao')::int = 1, 'ponteiro e revisao iniciais';
  perform 1 from post_processes where id = v_proc and estado = 'ativo' and template_id = e.tmpl
    and template_nome = 'Modelo' and modo_prazo = 'padrao' and origem_workflow_id is null;
  assert found, 'processo criado a partir do template';
  perform 1 from post_processes where id = v_proc and assinatura = post_process_assinatura(v_proc);
  assert found, 'assinatura gravada bate com a reconstruida';

  select count(*) into v_n from post_process_steps where process_id = v_proc;
  assert v_n = 3, format('tres etapas, obtidas %s', v_n);
  perform 1 from post_process_steps where process_id = v_proc and ordem = 0 and estado = 'ignorado' and iniciado_em is null;
  assert found, 'etapa anterior a inicial fica ignorada';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 1 and estado = 'ativo'
    and responsavel_id = e.membro and prazo_efetivo = timestamptz '2026-09-15T02:59:59.000Z' and iniciado_em is not null;
  assert found, 'etapa inicial ativa com responsavel e prazo do override';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 2 and estado = 'pendente'
    and tipo = 'aprovacao_cliente' and prazo_efetivo = timestamptz '2026-09-18T02:59:59.000Z';
  assert found, 'etapa futura pendente com o prazo enviado';

  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'aprovado_cliente', 'aplicar processo nao altera status do post';
  select count(*) into v_n from post_process_events where process_id = v_proc and evento = 'aplicado';
  assert v_n = 1, 'um evento aplicado';
  raise notice 'PASS 88.0 aplicar template no meio da sequencia';
end $$;
rollback;

-- 88.1
begin;
do $$
declare e record; v_fp text; v_raised boolean := false; v_n int;
begin
  select * into e from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  update workflow_templates set etapas = etapas || jsonb_build_array(
    jsonb_build_object('nome', 'Extra', 'prazo_dias', 1, 'tipo_prazo', 'corridos')) where id = e.tmpl;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'template_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'template editado deve levantar template_changed';
  select count(*) into v_n from post_processes;
  assert v_n = 0, 'nada criado';
  raise notice 'PASS 88.1 template_changed';
end $$;
rollback;

-- 88.2
begin;
do $$
declare e record; g record; v_raised boolean := false; v_fp text;
begin
  select * into e from pg_temp.et_ap_env();
  select * into g from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z', 'nome', 'Hack')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_overrides', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'chave nome no override deve ser rejeitada';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 1, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z'),
      '1', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_overrides', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'override de etapa anterior a inicial deve ser rejeitado';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z', 'responsavel_id', g.membro)));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'membro_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'responsavel de outra conta deve levantar membro_not_found';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'start_deadline_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'etapa inicial sem prazo_efetivo deve ser rejeitada';
  execute 'reset role';
  raise notice 'PASS 88.2 validacao de p_step_overrides';
end $$;
rollback;

-- 88.3
begin;
do $$
declare e record; v_wf bigint; v_raised boolean := false; v_fp text;
begin
  select * into e from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (e.usr, e.ws, e.cli, 'WF', 'ativo') returning id into v_wf;
  perform set_config('app.allow_post_move', 'on', true);
  update workflow_posts set workflow_id = v_wf where id = e.post;
  perform set_config('app.allow_post_move', 'off', true);

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_in_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post em fluxo deve levantar post_in_workflow';

  update workflow_posts set workflow_id = null where id = e.post;
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, '0|Copy|padrao');
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post com execucao vigente deve levantar post_has_active_process';
  raise notice 'PASS 88.3 pre-condicoes do post';
end $$;
rollback;

-- 88.4
begin;
do $$
declare e record; g record; v_vazio bigint; v_raised boolean := false;
begin
  select * into e from pg_temp.et_ap_env();
  select * into g from pg_temp.et_ap_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, g.tmpl, 'qualquer', 0, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'template_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'template de outra conta deve levantar template_not_found';
  execute 'reset role';

  insert into workflow_templates (user_id, conta_id, nome, etapas) values (e.usr, e.ws, 'Vazio', '[]'::jsonb)
    returning id into v_vazio;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, v_vazio, '', 0, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'template_empty', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'template sem etapas deve levantar template_empty';
  raise notice 'PASS 88.4 template invalido';
end $$;
rollback;

-- 88.5
begin;
do $$
declare e record; v_fp text; v_raised boolean;
begin
  select * into e from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- o template da fixture tem tres etapas, ordens 0, 1 e 2. A checagem de
  -- p_start_ordem vem ANTES da validacao de p_step_overrides, entao null nos
  -- overrides nao interfere.
  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 3, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_start_ordem', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'ordem inicial fora da sequencia deve levantar invalid_start_ordem';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, -1, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_start_ordem', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'ordem inicial negativa deve levantar invalid_start_ordem';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, null, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_start_ordem', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'ordem inicial nula deve levantar invalid_start_ordem';
  assert not exists (select 1 from post_processes), 'nada pode ter sido criado';
  raise notice 'PASS 88.5 invalid_start_ordem';
end $$;
rollback;

-- 88.6
begin;
do $$
declare e record; v_sem bigint; v_com bigint; v_fp text; v_raised boolean := false;
begin
  select * into e from pg_temp.et_ap_env();

  -- Template em modo data_entrega SEM nenhuma etapa aprovacao_cliente.
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
    values (e.usr, e.ws, 'Entrega sem aprovacao', jsonb_build_array(
      jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
      jsonb_build_object('nome', 'Design', 'prazo_dias', 3, 'tipo_prazo', 'corridos')
    ), 'data_entrega') returning id into v_sem;
  -- Mesmo modo, com a aprovacao NO MEIO: comecar depois dela deixa a sequencia
  -- restante sem nenhuma aprovacao.
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
    values (e.usr, e.ws, 'Entrega com aprovacao no meio', jsonb_build_array(
      jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
      jsonb_build_object('nome', 'Aprovacao', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'aprovacao_cliente'),
      jsonb_build_object('nome', 'Design', 'prazo_dias', 3, 'tipo_prazo', 'corridos')
    ), 'data_entrega') returning id into v_com;

  v_fp := template_fingerprint(v_sem);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, v_sem, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'data_entrega_requires_approval_step', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'data_entrega sem etapa de aprovacao deve ser rejeitado';
  assert not exists (select 1 from post_processes), 'nada pode ter sido criado';

  -- A regra e relativa a p_start_ordem, nao ao template inteiro: aqui o
  -- template TEM uma etapa aprovacao_cliente (ordem 1), mas comecar em 2 deixa
  -- a sequencia restante sem nenhuma.
  v_fp := template_fingerprint(v_com);
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, v_com, v_fp, 2, jsonb_build_object(
      '2', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'data_entrega_requires_approval_step', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'comecar depois da unica aprovacao tambem deve ser rejeitado';
  assert not exists (select 1 from post_processes), 'nada pode ter sido criado';

  -- Comecar NA propria etapa de aprovacao passa: a sequencia a partir dela a
  -- contem.
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform apply_post_process(e.post, v_com, v_fp, 1, jsonb_build_object(
    '1', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  execute 'reset role';
  assert exists (select 1 from post_processes where post_id = e.post), 'com aprovacao na sequencia, aplica';

  raise notice 'PASS 88.6a data_entrega_requires_approval_step';
end $$;
rollback;

begin;
do $$
declare e record; v_com bigint; v_fp text; v_res jsonb; v_n int;
begin
  select * into e from pg_temp.et_ap_env();
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
    values (e.usr, e.ws, 'Entrega com aprovacao no fim', jsonb_build_array(
      jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
      jsonb_build_object('nome', 'Aprovacao', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'aprovacao_cliente')
    ), 'data_entrega') returning id into v_com;
  v_fp := template_fingerprint(v_com);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := apply_post_process(e.post, v_com, v_fp, 0, jsonb_build_object(
    '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  execute 'reset role';
  assert (v_res ->> 'ok')::boolean, 'data_entrega com etapa de aprovacao aplica normalmente';
  select count(*) into v_n from post_process_steps where process_id = (v_res ->> 'process_id')::bigint;
  assert v_n = 2, format('duas etapas, obtidas %s', v_n);
  perform 1 from post_processes where id = (v_res ->> 'process_id')::bigint and modo_prazo = 'data_entrega';
  assert found, 'modo_prazo do template vai para o processo';
  raise notice 'PASS 88.6b data_entrega com etapa de aprovacao';
end $$;
rollback;

-- 88.6c: os demais modos ignoram a regra. O template da fixture e 'padrao' e
-- tem etapa de aprovacao; aqui um 'padrao' SEM nenhuma aprovacao_cliente
-- precisa aplicar sem erro, provando que a regra e so do data_entrega.
begin;
do $$
declare e record; v_tmpl bigint; v_fp text; v_res jsonb;
begin
  select * into e from pg_temp.et_ap_env();
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
    values (e.usr, e.ws, 'Padrao sem aprovacao', jsonb_build_array(
      jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
      jsonb_build_object('nome', 'Design', 'prazo_dias', 3, 'tipo_prazo', 'corridos')
    ), 'padrao') returning id into v_tmpl;
  v_fp := template_fingerprint(v_tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := apply_post_process(e.post, v_tmpl, v_fp, 0, jsonb_build_object(
    '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  execute 'reset role';
  assert (v_res ->> 'ok')::boolean, 'modo padrao sem aprovacao aplica normalmente';

  -- data_fixa tambem ignora a regra.
  update workflow_templates set modo_prazo = 'data_fixa' where id = v_tmpl;
  v_fp := template_fingerprint(v_tmpl);
  delete from post_processes where post_id = e.post;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := apply_post_process(e.post, v_tmpl, v_fp, 0, jsonb_build_object(
    '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  execute 'reset role';
  assert (v_res ->> 'ok')::boolean, 'modo data_fixa sem aprovacao aplica normalmente';
  raise notice 'PASS 88.6c outros modos ignoram a regra';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '88_|ran='`
Expected: FAIL com `function apply_post_process(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260919000004_apply_post_process.sql
-- Aplicar um template de processo a um post avulso (spec secoes 5.2, 7, 12.13a).
--
-- A SEQUENCIA VEM DO SERVIDOR. nome, tipo, ordem, prazo_dias e tipo_prazo sao
-- reconstruidos do jsonb do template sob FOR SHARE. Do cliente entra so
-- p_step_overrides, por ordem, com no maximo as chaves responsavel_id e
-- prazo_efetivo. Isso e o que impede o cliente de inventar uma sequencia que
-- nunca existiu num template.
--
-- ORDEM DE LOCKS: advisory ':post_move' antes de tudo (a RPC INSERE em
-- post_processes), depois post FOR UPDATE, depois template FOR SHARE. O
-- template nao participa de nenhum ciclo com attach/move, entao vem por
-- ultimo; o post vem antes por ser a linha que o attach concorrente disputa.
-- Essa ordem post -> template e DELIBERADA e nenhum caminho da casa toma
-- template antes de post: nenhuma RPC existente trava workflow_templates (so
-- workflows, em migrate_workflow_template e propagate_*). O UPDATE do editor
-- de templates do CRM pega FOR NO KEY UPDATE, que conflita com este FOR SHARE
-- e no maximo faz uma das duas esperar, sem ciclo.

CREATE OR REPLACE FUNCTION public.apply_post_process(
  p_post_id              bigint,
  p_template_id          bigint,
  p_template_fingerprint text,
  p_start_ordem          integer,
  p_step_overrides       jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta      uuid := public.post_process_require_editor();
  v_post       record;
  v_tmpl       record;
  v_n          int;
  v_key        text;
  v_val        jsonb;
  v_chave      text;
  v_resp       bigint;
  v_assinatura text;
  v_board      integer;
  v_proc       bigint;
  v_steps      jsonb;
BEGIN
  IF NOT effective_plan_feature(v_conta, 'feature_post_processes') THEN
    RAISE EXCEPTION 'feature_disabled:feature_post_processes' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT wp.id, wp.workflow_id INTO v_post
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_post.workflow_id IS NOT NULL THEN
    RAISE EXCEPTION 'post_in_workflow' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM post_processes pp
              WHERE pp.post_id = p_post_id AND pp.conta_id = v_conta
                AND pp.estado IN ('ativo', 'concluido')) THEN
    RAISE EXCEPTION 'post_has_active_process' USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.nome, t.etapas, t.modo_prazo INTO v_tmpl
    FROM workflow_templates t
   WHERE t.id = p_template_id AND t.conta_id = v_conta
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_tmpl.etapas IS NULL OR jsonb_typeof(v_tmpl.etapas) <> 'array'
     OR jsonb_array_length(v_tmpl.etapas) = 0 THEN
    RAISE EXCEPTION 'template_empty' USING ERRCODE = 'P0001';
  END IF;
  IF public.template_fingerprint(p_template_id) IS DISTINCT FROM p_template_fingerprint THEN
    RAISE EXCEPTION 'template_changed' USING ERRCODE = 'P0001';
  END IF;

  v_n := jsonb_array_length(v_tmpl.etapas);
  IF p_start_ordem IS NULL OR p_start_ordem < 0 OR p_start_ordem >= v_n THEN
    RAISE EXCEPTION 'invalid_start_ordem' USING ERRCODE = 'P0001';
  END IF;

  -- Exigencia estrutural do modo data_entrega (spec secao 7, Decisao 18): a
  -- sequencia a partir da inicial precisa ter ao menos uma etapa
  -- aprovacao_cliente. E checagem de FORMA, nao de data: le so 'tipo' do jsonb
  -- do template e nao reimplementa dias uteis nem clientes.dia_entrega em SQL,
  -- o que a secao 7 proibe. Vem depois de invalid_start_ordem, porque a regra e
  -- relativa a ordem inicial, e antes da validacao de p_step_overrides e de
  -- qualquer INSERT: template invalido nao cria linha nenhuma. Os demais modos
  -- ('padrao', 'data_fixa') ignoram a regra.
  IF coalesce(v_tmpl.modo_prazo, 'padrao') = 'data_entrega'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(v_tmpl.etapas) WITH ORDINALITY AS e(val, ord)
        WHERE (e.ord - 1) >= p_start_ordem
          AND coalesce(nullif(e.val ->> 'tipo', ''), 'padrao') = 'aprovacao_cliente') THEN
    RAISE EXCEPTION 'data_entrega_requires_approval_step' USING ERRCODE = 'P0001';
  END IF;

  -- Validacao de p_step_overrides: objeto de objetos, chaves numericas dentro
  -- da sequencia e nao anteriores a inicial, e no maximo responsavel_id e
  -- prazo_efetivo dentro de cada uma.
  IF p_step_overrides IS NOT NULL THEN
    IF jsonb_typeof(p_step_overrides) <> 'object' THEN
      RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_step_overrides) LOOP
      IF v_key !~ '^[0-9]+$' OR v_key::integer >= v_n OR v_key::integer < p_start_ordem THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END IF;
      IF jsonb_typeof(v_val) <> 'object' THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END IF;
      FOR v_chave IN SELECT jsonb_object_keys(v_val) LOOP
        IF v_chave NOT IN ('responsavel_id', 'prazo_efetivo') THEN
          RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
      IF (v_val ->> 'prazo_efetivo') IS NOT NULL THEN
        BEGIN
          PERFORM (v_val ->> 'prazo_efetivo')::timestamptz;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
        END;
      END IF;
      IF (v_val ->> 'responsavel_id') IS NOT NULL THEN
        BEGIN
          v_resp := (v_val ->> 'responsavel_id')::bigint;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
        END;
        IF NOT EXISTS (SELECT 1 FROM membros m WHERE m.id = v_resp AND m.conta_id = v_conta) THEN
          RAISE EXCEPTION 'membro_not_found' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- A etapa inicial e a unica que precisa de prazo agora: e ela que fica ativa.
  IF (p_step_overrides -> p_start_ordem::text ->> 'prazo_efetivo') IS NULL THEN
    RAISE EXCEPTION 'start_deadline_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg((e.ord - 1)::text || '|' || coalesce(e.val ->> 'nome', '')
                    || '|' || coalesce(nullif(e.val ->> 'tipo', ''), 'padrao'),
                    chr(10) ORDER BY e.ord)
    INTO v_assinatura
    FROM jsonb_array_elements(v_tmpl.etapas) WITH ORDINALITY AS e(val, ord);

  -- Ativos e concluidos: sao os dois estados que aparecem no quadro. So os
  -- ativos deixaria um concluido reaberto colidindo com um processo novo na
  -- mesma posicao (Decisao 19). Encerrado nao aparece e nao entra no max.
  SELECT coalesce(max(pp.board_position), -1) + 1 INTO v_board
    FROM post_processes pp WHERE pp.conta_id = v_conta AND pp.estado IN ('ativo', 'concluido');

  INSERT INTO post_processes
    (conta_id, post_id, template_id, template_nome, assinatura, estado, etapa_atual,
     modo_prazo, board_position, created_by)
  VALUES
    (v_conta, p_post_id, p_template_id, v_tmpl.nome, v_assinatura, 'ativo', p_start_ordem,
     coalesce(v_tmpl.modo_prazo, 'padrao'), v_board, auth.uid())
  RETURNING id INTO v_proc;

  -- responsavel_id: override vence; senao o do template, mas so se ainda
  -- resolver para um membro da conta (um template pode carregar id de membro
  -- ja removido, e a FK composta derrubaria a operacao inteira).
  INSERT INTO post_process_steps
    (conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias, tipo_prazo,
     prazo_efetivo, estado, iniciado_em)
  SELECT
    v_conta, v_proc, (e.ord - 1)::integer,
    coalesce(e.val ->> 'nome', ''),
    coalesce(nullif(e.val ->> 'tipo', ''), 'padrao'),
    coalesce(
      (p_step_overrides -> (e.ord - 1)::text ->> 'responsavel_id')::bigint,
      (SELECT m.id FROM membros m
        WHERE m.id = (e.val ->> 'responsavel_id')::bigint AND m.conta_id = v_conta)),
    (e.val ->> 'prazo_dias')::integer,
    nullif(e.val ->> 'tipo_prazo', ''),
    (p_step_overrides -> (e.ord - 1)::text ->> 'prazo_efetivo')::timestamptz,
    CASE WHEN (e.ord - 1) < p_start_ordem THEN 'ignorado'
         WHEN (e.ord - 1) = p_start_ordem THEN 'ativo'
         ELSE 'pendente' END,
    CASE WHEN (e.ord - 1) = p_start_ordem THEN now() ELSE NULL END
    FROM jsonb_array_elements(v_tmpl.etapas) WITH ORDINALITY AS e(val, ord);

  PERFORM public.post_process_log_event(
    v_conta, p_post_id, v_proc, 'aplicado', NULL,
    jsonb_build_object('template_id', p_template_id, 'template_nome', v_tmpl.nome,
                       'start_ordem', p_start_ordem, 'etapa_atual', p_start_ordem));

  SELECT jsonb_agg(to_jsonb(y) ORDER BY y.ordem) INTO v_steps FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = v_proc) y;

  RETURN jsonb_build_object(
    'ok', true,
    'process_id', v_proc,
    'post_id', p_post_id,
    'estado', 'ativo',
    'etapa_atual', p_start_ordem,
    'revisao', 1,
    'assinatura', v_assinatura,
    'template_id', p_template_id,
    'template_nome', v_tmpl.nome,
    'steps', coalesce(v_steps, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.apply_post_process(bigint, bigint, text, integer, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_post_process(bigint, bigint, text, integer, jsonb)
  TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '8[3-8]_|ran='`
Expected: PASS em 83 a 88; `failures=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260919000004_apply_post_process.sql \
        supabase/tests/entitlements/88_apply_post_process.sql
git commit -m "feat(entregas): RPC apply_post_process com sequencia reconstruida no servidor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `transition_post_process`

**Files:**
- Create: `supabase/migrations/20260919000005_transition_post_process.sql`
- Test: `supabase/tests/entitlements/89_transition_post_process.sql`

**Interfaces:**
- Consumes: os três helpers (Task 2).
- Produces: `public.transition_post_process(bigint, integer, text, text, text, timestamptz) RETURNS jsonb`.

Esta é a maior task do plano (uma função de ~215 linhas e uma suíte de ~300). Se o executor for um subagente com review, ela pode ser despachada em duas metades **na mesma migration**: 5a com a mecânica de ponteiro (`avancar`/`voltar`/`concluir`/`reabrir` sobre etapa `padrao`, blocos 89.0, 89.1, 89.4, 89.5 e 89.7) e 5b com o ramo `aprovacao_cliente`, o re-arm e o `concluir` sobre aprovação (blocos 89.2, 89.3 e 89.6). As demais tasks estão bem dimensionadas para um despacho só.

Regras fixadas (spec §5.5, §6.2, §7, §9.4):

- `avancar`: conclui a etapa ativa e ativa a próxima `pendente` de maior proximidade. Sem próxima `pendente`, erro `no_next_step` (concluir o processo é o comando `concluir`).
- Sobre etapa `aprovacao_cliente`, `p_expected_post_status` é obrigatório e divergência falha com `post_changed`. Se o post não está liberado (`aprovado_cliente, agendado, postado, falha_publicacao`), `p_approval_choice` é obrigatório: `aprovar_interno` grava `status = 'aprovado_cliente'` fora de `agendado`/`postado` (exatamente o que `approvePostsInternally` faz), `sem_alterar` não toca o post. Se está liberado e existe outra etapa `aprovacao_cliente` `pendente` adiante, o post volta de `aprovado_cliente` para `rascunho` (re-arm), na mesma transação.
- `voltar`: a etapa ativa volta a `pendente` com `iniciado_em` nulo; a etapa de maior `ordem` menor que a atual volta a `ativo` preservando `iniciado_em` e `prazo_efetivo`, com `concluido_em` nulo. Mesma semântica de `revertEtapa`, incluindo prazo vencido preservado.
- `concluir`: a etapa ativa vira `concluido` e o processo vira `concluido`, com `concluido_em` saindo do trigger. `etapa_atual` passa a apontar para a etapa que acabou de ser concluída (a que estava `ativo`) e não para o valor lido do processo, para que `reabrir` reative exatamente ela mesmo se os dois tiverem divergido. Quando essa etapa é `aprovacao_cliente`, `concluir` passa pela **mesma** árvore de aprovação de `avancar` (spec §5.5, primeiro bullet: "se a última etapa é `aprovacao_cliente` com pendência, abre o mesmo diálogo de escolha dos fluxos"): `p_expected_post_status` obrigatório, divergência falha com `post_changed`, post não liberado exige `p_approval_choice`. A única diferença é o re-arm, que não existe em `concluir`: não há próximo ciclo quando se conclui. Fora desse ramo, o post não é tocado.
- `reabrir`: só de `concluido`. Reativa a etapa de `etapa_atual` preservando `iniciado_em` e `prazo_efetivo` (divergência declarada em relação a `reopenWorkflow`, que reinicia). Toma `:post_move` antes do UPDATE.
- Toda transição incrementa `revisao`; `p_expected_revisao` divergente falha com `process_changed` antes de qualquer escrita.

- [ ] **Step 1: Escrever a suíte que falha**

```sql
-- supabase/tests/entitlements/89_transition_post_process.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- transition_post_process (migration 20260919000005). Cobre:
-- 89.0 avancar/voltar em etapa padrao: ponteiro, estados, prazo e revisao
-- 89.1 revisao velha -> process_changed sem efeito
-- 89.2 aprovacao com pendencia: aprovar_interno x sem_alterar, status esperado
-- 89.3 re-arm: post liberado com outra aprovacao adiante volta a rascunho
-- 89.4 concluir e reabrir preservam prazo vencido e nao tocam o post
-- 89.5 processo de outra conta -> process_not_found; reabrir de ativo -> process_not_concluded
-- 89.6 concluir sobre etapa aprovacao_cliente: mesmo dialogo do avancar, sem re-arm
-- 89.7 erros de argumento e de estado, agrupados num bloco so

create or replace function pg_temp.et_tr_env(
  out ws uuid, out usr uuid, out cli bigint, out post bigint, out proc bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (ws, cli, 'Avulso', 'rascunho') returning id into post;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual)
    values (ws, post, '0|Copy|padrao' || chr(10) || '1|Aprovacao|aprovacao_cliente' || chr(10) || '2|Aprovacao final|aprovacao_cliente',
            'ativo', 0) returning id into proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado, iniciado_em, prazo_efetivo)
    values (ws, proc, 0, 'Copy', 'padrao', 2, 'corridos', 'ativo',
            timestamptz '2026-09-01 12:00:00+00', timestamptz '2026-09-03 02:59:59+00');
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado)
    values (ws, proc, 1, 'Aprovacao', 'aprovacao_cliente', 1, 'uteis', 'pendente');
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado)
    values (ws, proc, 2, 'Aprovacao final', 'aprovacao_cliente', 1, 'uteis', 'pendente');
end $$;

-- 89.0
begin;
do $$
declare e record; v_res jsonb; v_ini timestamptz; v_status text;
begin
  select * into e from pg_temp.et_tr_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := transition_post_process(e.proc, 1, 'avancar', null, 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  execute 'reset role';

  assert (v_res ->> 'etapa_atual')::int = 1 and (v_res ->> 'revisao')::int = 2, 'ponteiro e revisao apos avancar';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 0 and estado = 'concluido' and concluido_em is not null;
  assert found, 'etapa anterior concluida';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 1 and estado = 'ativo'
    and prazo_efetivo = timestamptz '2026-09-08 02:59:59+00' and iniciado_em is not null;
  assert found, 'etapa nova ativa com o prazo enviado';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'rascunho', 'avancar sobre etapa padrao nao toca o status';
  perform 1 from post_process_events where process_id = e.proc and evento = 'avancou';
  assert found, 'evento avancou';

  select iniciado_em into v_ini from post_process_steps where process_id = e.proc and ordem = 0;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := transition_post_process(e.proc, 2, 'voltar');
  execute 'reset role';
  assert (v_res ->> 'etapa_atual')::int = 0 and (v_res ->> 'revisao')::int = 3, 'ponteiro e revisao apos voltar';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 0 and estado = 'ativo'
    and concluido_em is null and iniciado_em = v_ini and prazo_efetivo = timestamptz '2026-09-03 02:59:59+00';
  assert found, 'voltar preserva iniciado_em e o prazo vencido da etapa anterior';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 1 and estado = 'pendente' and iniciado_em is null;
  assert found, 'a etapa abandonada volta a pendente';
  perform 1 from post_process_events where process_id = e.proc and evento = 'voltou';
  assert found, 'evento voltou';
  raise notice 'PASS 89.0 avancar e voltar';
end $$;
rollback;

-- 89.1
begin;
do $$
declare e record; v_raised boolean := false; v_rev int;
begin
  select * into e from pg_temp.et_tr_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 99, 'avancar', null, 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'revisao velha deve levantar process_changed';
  select revisao into v_rev from post_processes where id = e.proc;
  assert v_rev = 1, 'revisao nao pode ter sido incrementada';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 0 and estado = 'ativo';
  assert found, 'nenhuma etapa se moveu';
  raise notice 'PASS 89.1 controle otimista por revisao';
end $$;
rollback;

-- 89.2
begin;
do $$
declare e record; v_raised boolean := false; v_status text;
begin
  select * into e from pg_temp.et_tr_env();
  -- posiciona na etapa de aprovacao
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem = 0;
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 1;
  update post_processes set etapa_atual = 1, revisao = 2 where id = e.proc;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 2, 'avancar', null, 'rascunho', timestamptz '2026-09-09 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'approval_choice_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'aprovacao com pendencia exige escolha';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 2, 'avancar', 'aprovar_interno', 'enviado_cliente', timestamptz '2026-09-09 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'status esperado divergente deve levantar post_changed';

  perform transition_post_process(e.proc, 2, 'avancar', 'aprovar_interno', 'rascunho', timestamptz '2026-09-09 02:59:59+00');
  execute 'reset role';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'aprovado_cliente', format('aprovar_interno deve gravar aprovado_cliente, obtido %s', v_status);
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'ativo';
  assert found, 'a proxima etapa ficou ativa';
  raise notice 'PASS 89.2 escolha na etapa de aprovacao';
end $$;
rollback;

-- 89.3
begin;
do $$
declare e record; v_status text;
begin
  select * into e from pg_temp.et_tr_env();
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem = 0;
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 1;
  update post_processes set etapa_atual = 1, revisao = 2 where id = e.proc;
  update workflow_posts set status = 'aprovado_cliente' where id = e.post;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform transition_post_process(e.proc, 2, 'avancar', null, 'aprovado_cliente', timestamptz '2026-09-09 02:59:59+00');
  execute 'reset role';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'rascunho', format('com outra aprovacao adiante o post volta a rascunho, obtido %s', v_status);

  -- agendado nunca e reiniciado
  update workflow_posts set status = 'agendado' where id = e.post;
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem = 1;
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 2;
  update post_processes set etapa_atual = 2, revisao = 3 where id = e.proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado)
    values (e.ws, e.proc, 3, 'Publicacao', 'padrao', 'pendente');
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform transition_post_process(e.proc, 3, 'avancar', null, 'agendado', timestamptz '2026-09-12 02:59:59+00');
  execute 'reset role';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'agendado', 'agendado nunca e reiniciado nem alterado';
  raise notice 'PASS 89.3 re-arm do proximo ciclo';
end $$;
rollback;

-- 89.4
begin;
do $$
declare e record; v_res jsonb; v_status text; v_ts timestamptz;
begin
  select * into e from pg_temp.et_tr_env();
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem in (0, 1);
  update post_process_steps set estado = 'ativo', iniciado_em = timestamptz '2026-09-05 08:00:00+00',
    prazo_efetivo = timestamptz '2026-09-06 02:59:59+00' where process_id = e.proc and ordem = 2;
  update post_processes set etapa_atual = 2 where id = e.proc;
  update workflow_posts set status = 'enviado_cliente' where id = e.post;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- a etapa ativa aqui e 'Aprovacao final' (aprovacao_cliente) e o post esta
  -- em enviado_cliente, que nao e liberado: concluir passa pelo mesmo dialogo
  -- do avancar, e 'sem_alterar' e a escolha que nao toca o post.
  v_res := transition_post_process(e.proc, 1, 'concluir', 'sem_alterar', 'enviado_cliente');
  execute 'reset role';
  assert v_res ->> 'estado' = 'concluido', 'processo concluido';
  assert (v_res ->> 'etapa_atual')::int = 2, 'o ponteiro fica na etapa que acabou de ser concluida';
  assert not (v_res ->> 'post_status_changed')::boolean, 'sem_alterar nao mexe no post';
  select concluido_em into v_ts from post_processes where id = e.proc;
  assert v_ts is not null, 'concluido_em carimbado pelo trigger';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'enviado_cliente', 'concluir nao aprova nem publica o post';

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := transition_post_process(e.proc, 2, 'reabrir');
  execute 'reset role';
  assert v_res ->> 'estado' = 'ativo' and (v_res ->> 'etapa_atual')::int = 2, 'reabrir volta a ultima etapa';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'ativo'
    and iniciado_em = timestamptz '2026-09-05 08:00:00+00' and prazo_efetivo = timestamptz '2026-09-06 02:59:59+00';
  assert found, 'reabrir preserva iniciado_em e o prazo vencido';
  select concluido_em into v_ts from post_processes where id = e.proc;
  assert v_ts is null, 'reabrir limpa concluido_em';
  raise notice 'PASS 89.4 concluir e reabrir';
end $$;
rollback;

-- 89.5
begin;
do $$
declare e record; g record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_tr_env();
  select * into g from pg_temp.et_tr_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(g.proc, 1, 'concluir');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'processo de outra conta deve levantar process_not_found';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'reabrir');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_concluded', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'reabrir processo ativo deve levantar process_not_concluded';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'teleportar');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_command', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'comando desconhecido deve levantar invalid_command';
  raise notice 'PASS 89.5 isolamento e comandos invalidos';
end $$;
rollback;

-- 89.6
begin;
do $$
declare e record; f record; v_res jsonb; v_status text; v_raised boolean;
begin
  select * into e from pg_temp.et_tr_env();
  -- posiciona na ultima etapa, que e aprovacao_cliente
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem in (0, 1);
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 2;
  update post_processes set etapa_atual = 2, revisao = 2 where id = e.proc;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 2, 'concluir');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'expected_post_status_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'concluir sobre etapa de aprovacao exige o status esperado do post';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 2, 'concluir', null, 'rascunho');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'approval_choice_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'post nao liberado exige a escolha do dialogo tambem no concluir';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 2, 'concluir', 'aprovar_interno', 'enviado_cliente');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'status esperado divergente derruba concluir tambem';

  v_res := transition_post_process(e.proc, 2, 'concluir', 'aprovar_interno', 'rascunho');
  execute 'reset role';
  assert v_res ->> 'estado' = 'concluido', 'processo concluido';
  assert (v_res ->> 'etapa_atual')::int = 2, 'ponteiro na etapa concluida';
  assert (v_res ->> 'post_status_changed')::boolean, 'aprovar_interno mexeu no post';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'aprovado_cliente', format('aprovar_interno deve gravar aprovado_cliente, obtido %s', v_status);
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'concluido';
  assert found, 'a etapa de aprovacao ficou concluida';

  -- concluir NAO re-arma: com o post liberado e outra aprovacao pendente
  -- adiante, avancar voltaria o post a rascunho; concluir nao mexe.
  select * into f from pg_temp.et_tr_env();
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = f.proc and ordem = 0;
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = f.proc and ordem = 1;
  update post_processes set etapa_atual = 1, revisao = 2 where id = f.proc;
  update workflow_posts set status = 'aprovado_cliente' where id = f.post;

  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform transition_post_process(f.proc, 2, 'concluir', null, 'aprovado_cliente');
  execute 'reset role';
  select status into v_status from workflow_posts where id = f.post;
  assert v_status = 'aprovado_cliente', format('concluir nao re-arma o proximo ciclo, obtido %s', v_status);
  perform 1 from post_process_steps where process_id = f.proc and ordem = 2 and estado = 'pendente';
  assert found, 'a aprovacao adiante continua pendente e o processo concluido';
  raise notice 'PASS 89.6 concluir sobre etapa de aprovacao';
end $$;
rollback;

-- 89.7
begin;
do $$
declare e record; v_raised boolean;
begin
  select * into e from pg_temp.et_tr_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'avancar', 'talvez', 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_approval_choice', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'escolha desconhecida deve levantar invalid_approval_choice';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'voltar');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'no_previous_step', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'na primeira etapa nao ha para onde voltar';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'avancar');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'next_deadline_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'proxima etapa com prazo relativo e sem prazo efetivo exige p_next_deadline';

  -- ultima etapa ativa: avancar nao tem para onde ir. A checagem de
  -- no_next_step vem ANTES da arvore de aprovacao, entao ela e que responde
  -- mesmo com a etapa ativa sendo aprovacao_cliente.
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem in (0, 1);
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 2;
  update post_processes set etapa_atual = 2 where id = e.proc;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 1, 'avancar', null, 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'no_next_step', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'sem proxima etapa pendente o comando e concluir, nao avancar';

  -- processo ja concluido: avancar, voltar e concluir sao recusados
  update post_processes set estado = 'concluido' where id = e.proc;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 1, 'avancar', null, 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_active', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'processo concluido nao avanca';
  raise notice 'PASS 89.7 erros de argumento e de estado';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '89_|ran='`
Expected: FAIL com `function transition_post_process(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260919000005_transition_post_process.sql
-- Avancar, voltar, concluir e reabrir um processo individual
-- (spec secoes 5.5, 6.2, 7, 9.4).
--
-- CONCORRENCIA. p_expected_revisao e a versao esperada do processo; divergiu,
-- process_changed, antes de qualquer escrita. Quando o comando tambem mexe no
-- post, p_expected_post_status e a versao esperada do post; divergiu,
-- post_changed. Nos fluxos, preparar o proximo ciclo e avancar sao dois PATCH
-- com rearmFailed; aqui e uma transacao so, e isso e uma melhoria aceita.
--
-- ORDEM DE LOCKS: advisory ':post_move' primeiro (reabrir volta o processo a
-- vigente e cai na mesma regra do INSERT), depois a linha do POST e so entao a
-- do PROCESSO, a mesma ordem de attach_post_closing_process.
--
-- APROVACAO (secoes 5.5 e 6.2). A arvore vale para 'avancar' E para
-- 'concluir': a 5.5 diz que concluir a ultima etapa, quando ela e
-- aprovacao_cliente com pendencia, "abre o mesmo dialogo de escolha dos
-- fluxos". Sem isso, aprovar internamente e concluir viraria dois passos nao
-- atomicos na UI, exatamente o que a 6.2 quer evitar no caminho individual. A
-- unica parte que nao vale para concluir e o re-arm: nao ha proximo ciclo.
-- As pre-checagens de 'avancar' (no_next_step, next_deadline_required) rodam
-- ANTES da arvore, para que "nao ha proxima etapa" continue sendo a primeira
-- resposta de um avancar na ultima etapa. Liberado = status em
-- (aprovado_cliente, agendado, postado, falha_publicacao). Nao liberado exige
-- p_approval_choice: 'aprovar_interno' grava aprovado_cliente fora de
-- agendado/postado (identico a approvePostsInternally, apesar do nome) ou
-- 'sem_alterar', que nunca toca status, custom status nem aprovacoes. Liberado
-- com outra etapa aprovacao_cliente PENDENTE adiante re-arma o ciclo: so
-- aprovado_cliente volta a rascunho (identico a resetApprovedPostsForNextCycle),
-- nunca agendado/postado/falha_publicacao. Etapas herdado, ignorado, concluido
-- e interrompido nao contam como aprovacao adiante. Toda escrita de status
-- passa pelo trigger z1 e pode zerar custom_status_id, como nos fluxos.

CREATE OR REPLACE FUNCTION public.transition_post_process(
  p_process_id           bigint,
  p_expected_revisao     integer,
  p_command              text,
  p_approval_choice      text        DEFAULT NULL,
  p_expected_post_status text        DEFAULT NULL,
  p_next_deadline        timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta        uuid := public.post_process_require_editor();
  v_post_id      bigint;
  v_proc         record;
  v_status       text;
  v_novo_status  text;
  v_mudou_post   boolean := false;
  v_atual        record;
  v_prox         record;
  v_ant          record;
  v_tem_adiante  boolean;
  v_liberado     boolean;
  v_estado       text;
  v_ponteiro     integer;
  v_revisao      integer;
  v_steps        jsonb;
BEGIN
  IF p_command IS NULL OR p_command NOT IN ('avancar', 'voltar', 'concluir', 'reabrir') THEN
    RAISE EXCEPTION 'invalid_command' USING ERRCODE = 'P0001';
  END IF;
  IF p_approval_choice IS NOT NULL AND p_approval_choice NOT IN ('aprovar_interno', 'sem_alterar') THEN
    RAISE EXCEPTION 'invalid_approval_choice' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Leitura sem lock so para descobrir o post e travar na ordem da familia.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT wp.status INTO v_status FROM workflow_posts wp
   WHERE wp.id = v_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT pp.id, pp.post_id, pp.estado, pp.etapa_atual, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;

  v_estado   := v_proc.estado;
  v_ponteiro := v_proc.etapa_atual;

  IF p_command = 'reabrir' THEN
    IF v_proc.estado <> 'concluido' THEN
      RAISE EXCEPTION 'process_not_concluded' USING ERRCODE = 'P0001';
    END IF;
    -- Preserva iniciado_em e prazo_efetivo, inclusive vencidos. Divergencia
    -- deliberada em relacao a reopenWorkflow, que reinicia a contagem.
    UPDATE post_process_steps
       SET estado = 'ativo', concluido_em = NULL, iniciado_em = coalesce(iniciado_em, now())
     WHERE process_id = p_process_id AND ordem = v_proc.etapa_atual;
    v_estado := 'ativo';
    PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'reaberto',
      jsonb_build_object('estado', 'concluido'),
      jsonb_build_object('estado', 'ativo', 'etapa_atual', v_ponteiro));
  ELSE
    IF v_proc.estado <> 'ativo' THEN
      RAISE EXCEPTION 'process_not_active' USING ERRCODE = 'P0001';
    END IF;

    SELECT s.ordem, s.nome, s.tipo INTO v_atual
      FROM post_process_steps s
     WHERE s.process_id = p_process_id AND s.estado = 'ativo';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'step_not_found' USING ERRCODE = 'P0001';
    END IF;

    -- PRE-CHECAGENS DE 'avancar', antes da arvore de aprovacao. Sem proxima
    -- etapa pendente o comando certo e 'concluir' (Decisao 12), e essa
    -- mensagem tem de chegar ao usuario antes de qualquer exigencia do
    -- dialogo de aprovacao.
    IF p_command = 'avancar' THEN
      SELECT s.ordem, s.nome, s.prazo_dias, s.prazo_efetivo INTO v_prox
        FROM post_process_steps s
       WHERE s.process_id = p_process_id AND s.ordem > v_atual.ordem AND s.estado = 'pendente'
       ORDER BY s.ordem LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no_next_step' USING ERRCODE = 'P0001';
      END IF;
      IF p_next_deadline IS NULL AND v_prox.prazo_efetivo IS NULL AND v_prox.prazo_dias IS NOT NULL THEN
        RAISE EXCEPTION 'next_deadline_required' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- ARVORE DE APROVACAO, compartilhada por 'avancar' e 'concluir'. Ver a
    -- nota do topo: a 5.5 manda concluir sobre etapa aprovacao_cliente abrir o
    -- mesmo dialogo do avancar. v_tem_adiante e falso em 'concluir', porque o
    -- re-arm so faz sentido quando ha um proximo ciclo.
    IF p_command IN ('avancar', 'concluir') AND v_atual.tipo = 'aprovacao_cliente' THEN
      IF p_expected_post_status IS NULL THEN
        RAISE EXCEPTION 'expected_post_status_required' USING ERRCODE = 'P0001';
      END IF;
      IF p_expected_post_status IS DISTINCT FROM v_status THEN
        RAISE EXCEPTION 'post_changed' USING ERRCODE = 'P0001';
      END IF;

      v_liberado := v_status IN ('aprovado_cliente', 'agendado', 'postado', 'falha_publicacao');
      IF p_command = 'avancar' THEN
        SELECT EXISTS (SELECT 1 FROM post_process_steps s
                        WHERE s.process_id = p_process_id AND s.ordem > v_atual.ordem
                          AND s.tipo = 'aprovacao_cliente' AND s.estado = 'pendente')
          INTO v_tem_adiante;
      ELSE
        v_tem_adiante := false;
      END IF;

      IF NOT v_liberado THEN
        IF p_approval_choice IS NULL THEN
          RAISE EXCEPTION 'approval_choice_required' USING ERRCODE = 'P0001';
        END IF;
        IF p_approval_choice = 'aprovar_interno' AND v_status NOT IN ('agendado', 'postado') THEN
          v_novo_status := 'aprovado_cliente';
        END IF;
      ELSIF v_tem_adiante AND v_status = 'aprovado_cliente' THEN
        v_novo_status := 'rascunho';
      END IF;

      IF v_novo_status IS NOT NULL THEN
        UPDATE workflow_posts SET status = v_novo_status
         WHERE id = v_post_id AND conta_id = v_conta;
        v_status := v_novo_status;
        v_mudou_post := true;
      END IF;
    END IF;

    IF p_command = 'concluir' THEN
      UPDATE post_process_steps SET estado = 'concluido', concluido_em = now()
       WHERE process_id = p_process_id AND ordem = v_atual.ordem;
      v_estado := 'concluido';
      -- Ponteiro na etapa que ACABOU de ser concluida, nao no valor lido do
      -- processo: se os dois divergirem, reabrir reativaria a etapa errada.
      v_ponteiro := v_atual.ordem;
      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'concluido',
        jsonb_build_object('estado', 'ativo', 'etapa_atual', v_proc.etapa_atual,
                           'post_status', p_expected_post_status),
        jsonb_build_object('estado', 'concluido', 'etapa_atual', v_atual.ordem,
                           'post_status', v_status, 'approval_choice', p_approval_choice));

    ELSIF p_command = 'voltar' THEN
      SELECT s.ordem, s.nome INTO v_ant
        FROM post_process_steps s
       WHERE s.process_id = p_process_id AND s.ordem < v_atual.ordem
       ORDER BY s.ordem DESC LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no_previous_step' USING ERRCODE = 'P0001';
      END IF;
      -- Uma etapa ativa por processo (indice parcial): a atual sai antes.
      UPDATE post_process_steps SET estado = 'pendente', iniciado_em = NULL
       WHERE process_id = p_process_id AND ordem = v_atual.ordem;
      UPDATE post_process_steps
         SET estado = 'ativo', concluido_em = NULL, iniciado_em = coalesce(iniciado_em, now())
       WHERE process_id = p_process_id AND ordem = v_ant.ordem;
      v_ponteiro := v_ant.ordem;
      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'voltou',
        jsonb_build_object('etapa_ordem', v_atual.ordem, 'etapa_nome', v_atual.nome),
        jsonb_build_object('etapa_ordem', v_ant.ordem, 'etapa_nome', v_ant.nome));

    ELSE  -- avancar. v_prox e a arvore de aprovacao ja rodaram acima.
      UPDATE post_process_steps SET estado = 'concluido', concluido_em = now()
       WHERE process_id = p_process_id AND ordem = v_atual.ordem;
      UPDATE post_process_steps
         SET estado = 'ativo', iniciado_em = now(),
             prazo_efetivo = coalesce(p_next_deadline, prazo_efetivo)
       WHERE process_id = p_process_id AND ordem = v_prox.ordem;
      v_ponteiro := v_prox.ordem;

      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'avancou',
        jsonb_build_object('etapa_ordem', v_atual.ordem, 'etapa_nome', v_atual.nome,
                           'post_status', p_expected_post_status),
        jsonb_build_object('etapa_ordem', v_prox.ordem, 'etapa_nome', v_prox.nome,
                           'post_status', v_status, 'approval_choice', p_approval_choice));
    END IF;
  END IF;

  -- Este UPDATE toca a coluna estado, entao passa pelo trigger
  -- post_processes_requires_avulso. Em 'reabrir' (concluido -> ativo) o guard
  -- faz early-return, porque a condicao dele e old.estado = 'encerrado': nao e
  -- obvio, mas e o que faz reabrir nao precisar reler o post. O trigger
  -- set_post_process_concluido_em, endurecido na Task 2, limpa concluido_em em
  -- qualquer transicao para 'ativo' e carimba em 'concluido'.
  UPDATE post_processes
     SET estado = v_estado, etapa_atual = v_ponteiro, revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  SELECT jsonb_agg(to_jsonb(y) ORDER BY y.ordem) INTO v_steps FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em, s.concluido_em
      FROM post_process_steps s WHERE s.process_id = p_process_id) y;

  RETURN jsonb_build_object(
    'ok', true,
    'process_id', p_process_id,
    'post_id', v_post_id,
    'command', p_command,
    'estado', v_estado,
    'etapa_atual', v_ponteiro,
    'revisao', v_revisao,
    'post_status', v_status,
    'post_status_changed', v_mudou_post,
    'steps', coalesce(v_steps, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.transition_post_process(bigint, integer, text, text, text, timestamptz)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.transition_post_process(bigint, integer, text, text, text, timestamptz)
  TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '8[3-9]_|ran='`
Expected: PASS em 83 a 89; `failures=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260919000005_transition_post_process.sql \
        supabase/tests/entitlements/89_transition_post_process.sql
git commit -m "feat(entregas): RPC transition_post_process com revisao e re-arm de aprovacao

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `update_post_process_step` e `remove_post_process`

**Files:**
- Create: `supabase/migrations/20260919000006_update_step_and_remove_process.sql`
- Test: `supabase/tests/entitlements/90_update_step_and_remove_process.sql`

**Interfaces:**
- Consumes: os três helpers (Task 2).
- Produces: `public.update_post_process_step(bigint, integer, integer, bigint, timestamptz) RETURNS jsonb` e `public.remove_post_process(bigint, integer) RETURNS jsonb`.

Regras fixadas (spec §5.4, §5.5, §7, §8.1):

- Só etapas `pendente` e `ativo` são editáveis (`step_not_editable`); `concluido`, `herdado`, `ignorado` e `interrompido` são informativas até serem reabertas por "Voltar etapa". Nome, tipo e ordem não são editáveis na v1.
- `p_responsavel_id` e `p_prazo_efetivo` são setters absolutos: `NULL` limpa o campo. A UI sempre envia os dois valores atuais do formulário.
- `remove_post_process` encerra com `motivo_encerramento = 'removido'`, marca a etapa ativa como `interrompido` com `interrompido_em`, deixa as futuras `pendente` e preserva histórico, status e conteúdo. O post volta a Sem processo e pode receber nova execução. Remover um processo já `encerrado` responde `process_already_closed`; um `concluido` pode ser removido.
- As duas tomam o advisory `:post_move` no topo e travam a linha do **post** antes da linha do **processo**, a mesma ordem de `transition_post_process`. Não é higiene: as duas gravam evento, e o INSERT em `post_process_events` pede `FOR KEY SHARE` na linha do post por causa da FK composta. Sem isso elas fecham ciclo de deadlock com `transition`, `apply` e os dois attach. Ver a Decisão 22, reescrita.

- [ ] **Step 1: Escrever a suíte que falha**

```sql
-- supabase/tests/entitlements/90_update_step_and_remove_process.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- update_post_process_step e remove_post_process (migration 20260919000006).
-- 90.0 editar responsavel e prazo de etapa ativa e pendente, com evento e revisao
-- 90.1 etapa concluida nao e editavel; responsavel de outra conta e rejeitado
-- 90.2 remover encerra, interrompe a etapa ativa e preserva status e historico
-- 90.3 remover libera nova aplicacao e reabrir um encerrado e rejeitado
-- 90.4 revisao velha e processo de outra conta
-- 90.5 advisory :post_move segurado ate o fim da transacao e remover duas vezes

create or replace function pg_temp.et_rm_env(
  out ws uuid, out usr uuid, out cli bigint, out post bigint, out proc bigint, out membro bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into membros (user_id, conta_id, nome) values (usr, ws, 'Designer') returning id into membro;
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (ws, cli, 'Avulso', 'enviado_cliente') returning id into post;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual)
    values (ws, post, '0|Copy|padrao' || chr(10) || '1|Design|padrao', 'ativo', 1) returning id into proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado, concluido_em)
    values (ws, proc, 0, 'Copy', 'padrao', 2, 'corridos', 'concluido', now());
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado, iniciado_em)
    values (ws, proc, 1, 'Design', 'padrao', 3, 'corridos', 'ativo', now());
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado)
    values (ws, proc, 2, 'Aprovacao', 'aprovacao_cliente', 1, 'uteis', 'pendente');
end $$;

-- 90.0
begin;
do $$
declare e record; v_res jsonb; v_ev record;
begin
  select * into e from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := update_post_process_step(e.proc, 1, 1, e.membro, timestamptz '2026-09-20 02:59:59+00');
  assert (v_res ->> 'revisao')::int = 2, 'editar incrementa a revisao';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 1
    and responsavel_id = e.membro and prazo_efetivo = timestamptz '2026-09-20 02:59:59+00';
  assert found, 'etapa ativa recebe responsavel e prazo';

  v_res := update_post_process_step(e.proc, 2, 2, null, null);
  execute 'reset role';
  assert (v_res ->> 'revisao')::int = 3, 'segunda edicao incrementa de novo';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2
    and responsavel_id is null and prazo_efetivo is null;
  assert found, 'null limpa os campos da etapa pendente';

  select * into v_ev from post_process_events where process_id = e.proc and evento = 'etapa_editada' order by id limit 1;
  assert v_ev.antes ->> 'responsavel_id' is null and (v_ev.depois ->> 'responsavel_id')::bigint = e.membro,
    'evento etapa_editada guarda antes e depois';
  raise notice 'PASS 90.0 editar etapa';
end $$;
rollback;

-- 90.1
begin;
do $$
declare e record; g record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rm_env();
  select * into g from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform update_post_process_step(e.proc, 1, 0, e.membro, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'step_not_editable', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'etapa concluida nao e editavel';

  v_raised := false;
  begin
    perform update_post_process_step(e.proc, 1, 1, g.membro, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'membro_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'responsavel de outra conta e rejeitado';

  v_raised := false;
  begin
    perform update_post_process_step(e.proc, 1, 9, null, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'step_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'ordem inexistente e step_not_found';
  raise notice 'PASS 90.1 validacao de edicao de etapa';
end $$;
rollback;

-- 90.2
begin;
do $$
declare e record; v_res jsonb; v_status text; v_n int;
begin
  select * into e from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := remove_post_process(e.proc, 1);
  execute 'reset role';
  assert v_res ->> 'estado' = 'encerrado' and v_res ->> 'motivo_encerramento' = 'removido', 'encerrado com motivo removido';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 1
    and estado = 'interrompido' and interrompido_em is not null;
  assert found, 'a etapa ativa vira interrompido com carimbo';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'pendente';
  assert found, 'as futuras continuam pendentes';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'enviado_cliente', 'remover nao altera status do post';
  select count(*) into v_n from post_process_events where process_id = e.proc;
  assert v_n = 1, 'o historico do processo continua acessivel';
  raise notice 'PASS 90.2 remover encerra e preserva';
end $$;
rollback;

-- 90.3
begin;
do $$
declare e record; v_novo bigint; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform remove_post_process(e.proc, 1);
  execute 'reset role';

  -- o indice parcial libera: o post pode receber nova execucao
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, '0|Copy|padrao')
    returning id into v_novo;
  assert v_novo is not null, 'post volta a Sem processo e aceita nova execucao';

  -- um encerrado nunca volta a ativo por transition (nao esta concluido)
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 2, 'reabrir');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_concluded', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'um processo encerrado nunca ressuscita, entao a etapa interrompida nunca volta a contar como aprovacao adiante';
  raise notice 'PASS 90.3 nova execucao e encerrado terminal';
end $$;
rollback;

-- 90.4
begin;
do $$
declare e record; g record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rm_env();
  select * into g from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform remove_post_process(e.proc, 99);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'revisao velha deve levantar process_changed';

  v_raised := false;
  begin
    perform update_post_process_step(g.proc, 1, 1, null, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'processo de outra conta deve levantar process_not_found';
  perform 1 from post_processes where id = e.proc and estado = 'ativo';
  assert found, 'nada foi encerrado';
  raise notice 'PASS 90.4 revisao e isolamento';
end $$;
rollback;

-- 90.5
begin;
do $$
declare e record; f record; v_base int; v_n int; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rm_env();
  -- Assercao RELATIVA de proposito: a fixture ja deixa advisory locks
  -- segurados, porque enforce_plan_count_limit toma um por chave de limite a
  -- cada INSERT contado (cliente, membro). O que se prova aqui e que a RPC
  -- acrescenta a chave ':post_move' da conta, e que ela fica segurada ate o
  -- fim da transacao. Se alguem tirar o advisory das duas RPCs, este bloco
  -- falha e a ordem de locks volta a ter o ciclo do cabecalho da migration.
  select count(*) into v_base from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform update_post_process_step(e.proc, 1, 1, null, null);
  execute 'reset role';
  select count(*) into v_n from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();
  assert v_n > v_base, 'update_post_process_step precisa tomar o advisory :post_move';

  -- Segunda conta, para que a chave ':post_move' dela tambem seja nova.
  select * into f from pg_temp.et_rm_env();
  select count(*) into v_base from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();
  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform remove_post_process(f.proc, 1);
  -- segunda remocao: o processo ja esta encerrado
  begin
    perform remove_post_process(f.proc, 2);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_already_closed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'remover um processo ja encerrado deve levantar process_already_closed';
  select count(*) into v_n from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();
  assert v_n > v_base, 'remove_post_process precisa tomar o advisory :post_move';
  raise notice 'PASS 90.5 advisory :post_move e process_already_closed';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '90_|ran='`
Expected: FAIL com `function update_post_process_step(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260919000006_update_step_and_remove_process.sql
-- Editar responsavel e prazo de uma etapa individual, e remover a execucao
-- (spec secoes 5.4, 5.5, 7, 8.1).
--
-- ORDEM DE LOCKS. As duas tomam ':post_move' no topo e travam a linha do
-- POST antes da linha do PROCESSO, exatamente como transition_post_process.
-- Nao e higiene: as duas chamam post_process_log_event, que insere em
-- post_process_events, e essa tabela tem a FK composta
-- post_process_events_post_same_tenant (post_id, conta_id) REFERENCES
-- workflow_posts (20260918000002). Todo INSERT ali pede FOR KEY SHARE na
-- linha do post. Sem o advisory e sem travar o post antes, uma destas duas
-- RPCs segura post_processes FOR UPDATE e vai pedir FOR KEY SHARE no post
-- enquanto transition_post_process (ou apply, ou attach) ja segura o post FOR
-- UPDATE e vai pedir o processo: espera circular, 40P01. Seria tambem o
-- inverso da ordem declarada na constraint global do plano, fluxo -> post ->
-- processo. A leitura sem lock do post_id antes de travar e o mesmo truque de
-- transition_post_process (Decisao 22).
--
-- p_responsavel_id e p_prazo_efetivo sao setters absolutos: NULL limpa. A UI
-- envia sempre os dois valores do formulario, entao nao existe "nao mexer".

CREATE OR REPLACE FUNCTION public.update_post_process_step(
  p_process_id       bigint,
  p_expected_revisao integer,
  p_ordem            integer,
  p_responsavel_id   bigint      DEFAULT NULL,
  p_prazo_efetivo    timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid := public.post_process_require_editor();
  v_post_id bigint;
  v_proc    record;
  v_step    record;
  v_revisao integer;
  v_novo    jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Leitura sem lock so para descobrir o post e travar na ordem da familia.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = v_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT pp.id, pp.post_id, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.ordem, s.nome, s.estado, s.responsavel_id, s.prazo_efetivo INTO v_step
    FROM post_process_steps s
   WHERE s.process_id = p_process_id AND s.ordem = p_ordem;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'step_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_step.estado NOT IN ('pendente', 'ativo') THEN
    RAISE EXCEPTION 'step_not_editable' USING ERRCODE = 'P0001';
  END IF;

  IF p_responsavel_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM membros m WHERE m.id = p_responsavel_id AND m.conta_id = v_conta) THEN
    RAISE EXCEPTION 'membro_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE post_process_steps
     SET responsavel_id = p_responsavel_id, prazo_efetivo = p_prazo_efetivo
   WHERE process_id = p_process_id AND ordem = p_ordem;

  UPDATE post_processes SET revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, v_proc.post_id, p_process_id, 'etapa_editada',
    jsonb_build_object('ordem', v_step.ordem, 'nome', v_step.nome,
                       'responsavel_id', v_step.responsavel_id, 'prazo_efetivo', v_step.prazo_efetivo),
    jsonb_build_object('ordem', v_step.ordem, 'nome', v_step.nome,
                       'responsavel_id', p_responsavel_id, 'prazo_efetivo', p_prazo_efetivo));

  SELECT to_jsonb(y) INTO v_novo FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = p_process_id AND s.ordem = p_ordem) y;

  RETURN jsonb_build_object('ok', true, 'process_id', p_process_id, 'ordem', p_ordem,
                            'revisao', v_revisao, 'step', v_novo);
END;
$$;

REVOKE ALL ON FUNCTION public.update_post_process_step(bigint, integer, integer, bigint, timestamptz)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_post_process_step(bigint, integer, integer, bigint, timestamptz)
  TO authenticated, service_role;

-- ============================================================
-- remove_post_process: encerra com motivo 'removido'. A etapa ativa vira
-- 'interrompido' (com carimbo) e as futuras ficam 'pendente', como manda a
-- invariante da secao 8.1. Encerrado e terminal: transition_post_process so
-- reabre a partir de 'concluido', entao uma etapa interrompida nunca volta a
-- contar como aprovacao adiante para hub-approve.
-- ============================================================
CREATE OR REPLACE FUNCTION public.remove_post_process(
  p_process_id       bigint,
  p_expected_revisao integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid := public.post_process_require_editor();
  v_post_id bigint;
  v_proc    record;
  v_revisao integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Mesma leitura sem lock e mesma ordem post -> processo do update de etapa.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = v_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT pp.id, pp.post_id, pp.estado, pp.etapa_atual, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.estado = 'encerrado' THEN
    RAISE EXCEPTION 'process_already_closed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE post_process_steps
     SET estado = 'interrompido', interrompido_em = now()
   WHERE process_id = p_process_id AND estado = 'ativo';

  UPDATE post_processes
     SET estado = 'encerrado', motivo_encerramento = 'removido', revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, v_proc.post_id, p_process_id, 'removido',
    jsonb_build_object('estado', v_proc.estado, 'etapa_atual', v_proc.etapa_atual),
    jsonb_build_object('estado', 'encerrado', 'motivo_encerramento', 'removido'));

  RETURN jsonb_build_object('ok', true, 'process_id', p_process_id, 'post_id', v_proc.post_id,
                            'estado', 'encerrado', 'motivo_encerramento', 'removido',
                            'revisao', v_revisao);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_post_process(bigint, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remove_post_process(bigint, integer) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '8[3-9]_|90_|ran='`
Expected: PASS em 83 a 90; `failures=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260919000006_update_step_and_remove_process.sql \
        supabase/tests/entitlements/90_update_step_and_remove_process.sql
git commit -m "feat(entregas): RPCs update_post_process_step e remove_post_process

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `attach_post_closing_process`

**Files:**
- Create: `supabase/migrations/20260919000007_attach_post_closing_process.sql`
- Test: `supabase/tests/entitlements/91_attach_post_closing_process.sql`

**Interfaces:**
- Consumes: os três helpers (Task 2).
- Produces: `public.attach_post_closing_process(bigint, bigint, integer) RETURNS jsonb`.

Regras fixadas (spec §5.5, §9.3, §9.5):

- É a única RPC que pode colocar em fluxo um post com execução vigente. Ela encerra com `motivo_encerramento = 'vinculado'` **antes** do UPDATE de `workflow_id`, na mesma transação, porque `post_a1_process_guard` não tem GUC de escape.
- Advisory na ordem `:post_move` → `:max_posts_per_workflow`, ambos antes do `FOR UPDATE` no fluxo.
- Mesmas validações do `attach_posts_to_flow`: fluxo `ativo` da conta, mesmo cliente, limite `max_posts_per_workflow` com a mesma fronteira (`atual + 1 > limite` estoura).
- Estado e prazos individuais não são transferidos. Status, mídia e aprovações do post não mudam.
- A busca do processo trava a execução **mais recente** do post (`order by id desc limit 1`), sem filtrar `estado`: post sem execução nenhuma responde `process_not_found`, post cuja última execução já está `encerrado` responde `process_already_closed`, o mesmo código que `remove_post_process` usa para o caso equivalente (Decisão 29). Execução `ativo` ou `concluido` segue o caminho normal.

- [ ] **Step 1: Escrever a suíte que falha**

```sql
-- supabase/tests/entitlements/91_attach_post_closing_process.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- attach_post_closing_process (migration 20260919000007). Cobre:
-- 91.0 happy path: encerra com motivo vinculado e anexa, sem tocar o post
-- 91.1 limite do fluxo respeitado -> plan_limit_exceeded e nada muda
-- 91.2 fluxo de outro cliente, fluxo arquivado e revisao velha
-- 91.3 attach_posts_to_flow continua barrado para o mesmo post (guard da fase 1)
-- 91.4 post ja em fluxo -> post_already_in_flow; processo encerrado ->
--      process_already_closed; post sem processo nenhum -> process_not_found

create or replace function pg_temp.et_at_env(
  out ws uuid, out usr uuid, out cli bigint, out cli2 bigint,
  out post bigint, out proc bigint, out wf bigint, out wf2 bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C1', 'C1', '#000') returning id into cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C2', 'C2', '#000') returning id into cli2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (usr, ws, cli, 'Destino', 'ativo') returning id into wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, status) values (wf, 0, 'Copy', 2, 'ativo');
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (usr, ws, cli2, 'Outro cliente', 'ativo') returning id into wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, status) values (wf2, 0, 'Copy', 2, 'ativo');
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (ws, cli, 'Avulso com processo', 'aprovado_cliente') returning id into post;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual)
    values (ws, post, '0|Copy|padrao', 'ativo', 0) returning id into proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado, iniciado_em)
    values (ws, proc, 0, 'Copy', 'padrao', 2, 'corridos', 'ativo', now());
end $$;

-- 91.0
begin;
do $$
declare e record; v_res jsonb; v_status text; v_wf bigint;
begin
  select * into e from pg_temp.et_at_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := attach_post_closing_process(e.post, e.wf, 1);
  execute 'reset role';
  assert v_res ->> 'estado' = 'encerrado' and v_res ->> 'motivo_encerramento' = 'vinculado', 'encerrado com motivo vinculado';
  select workflow_id into v_wf from workflow_posts where id = e.post;
  assert v_wf = e.wf, 'post anexado ao fluxo';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'aprovado_cliente', 'vincular nao altera status do post';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 0 and estado = 'interrompido';
  assert found, 'a etapa ativa e interrompida';
  perform 1 from post_process_events where process_id = e.proc and evento = 'vinculado';
  assert found, 'evento vinculado';
  raise notice 'PASS 91.0 vincular encerrando a execucao';
end $$;
rollback;

-- 91.1
begin;
do $$
declare e record; v_raised boolean := false; v_wf bigint;
begin
  select * into e from pg_temp.et_at_env();
  -- et_make_workspace sem p_overrides nao cria linha em workspace_plan_overrides
  insert into workspace_plan_overrides (workspace_id, plan_id, resource_overrides)
    values (e.ws, (select plan_id from workspaces where id = e.ws), '{"max_posts_per_workflow": 1}'::jsonb);
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo) values (e.wf, e.ws, e.cli, 'ja no fluxo');

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'plan_limit_exceeded:max_posts_per_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'limite do fluxo deve barrar o vinculo';
  select workflow_id into v_wf from workflow_posts where id = e.post;
  assert v_wf is null, 'post continua avulso';
  perform 1 from post_processes where id = e.proc and estado = 'ativo';
  assert found, 'a execucao nao foi encerrada';
  raise notice 'PASS 91.1 limite do fluxo';
end $$;
rollback;

-- 91.2
begin;
do $$
declare e record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_at_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, e.wf2, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_belongs_to_another_client', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'fluxo de outro cliente deve ser recusado';
  execute 'reset role';

  update workflows set status = 'arquivado' where id = e.wf;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_active', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'fluxo arquivado deve ser recusado';
  execute 'reset role';

  update workflows set status = 'ativo' where id = e.wf;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, e.wf, 99);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'revisao velha deve levantar process_changed';
  raise notice 'PASS 91.2 pre-condicoes do fluxo e revisao';
end $$;
rollback;

-- 91.3
begin;
do $$
declare e record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_at_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_posts_to_flow(array[e.post], e.wf);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'a RPC generica continua barrada pelo guard da fase 1';
  raise notice 'PASS 91.3 so attach_post_closing_process vincula';
end $$;
rollback;

-- 91.4
begin;
do $$
declare e record; v_post2 bigint; v_post3 bigint; v_proc2 bigint; v_raised boolean;
begin
  select * into e from pg_temp.et_at_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform attach_post_closing_process(e.post, e.wf, 1);
  v_raised := false;
  begin
    perform attach_post_closing_process(e.post, e.wf, 2);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_already_in_flow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post que ja esta em fluxo deve levantar post_already_in_flow';

  -- Processo ja encerrado: a RPC trava a execucao mais recente do post sem
  -- filtrar estado, entao a resposta e process_already_closed, o mesmo codigo
  -- que remove_post_process usa (Decisao 29), e nao process_not_found.
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (e.ws, e.cli, 'Avulso encerrado', 'rascunho') returning id into v_post2;
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento)
    values (e.ws, v_post2, '0|Copy|padrao', 'encerrado', 'removido') returning id into v_proc2;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(v_post2, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_already_closed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'processo encerrado resolve para process_already_closed';
  perform 1 from workflow_posts where id = v_post2 and workflow_id is null;
  assert found, 'o post do processo encerrado continua avulso';
  perform 1 from post_processes where id = v_proc2 and estado = 'encerrado'
    and motivo_encerramento = 'removido';
  assert found, 'o processo encerrado nao e reescrito';

  -- Post sem execucao nenhuma: ai sim process_not_found.
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (e.ws, e.cli, 'Avulso sem processo', 'rascunho') returning id into v_post3;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(v_post3, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post sem execucao resolve para process_not_found';
  raise notice 'PASS 91.4 post ja em fluxo, processo encerrado e post sem processo';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '91_|ran='`
Expected: FAIL com `function attach_post_closing_process(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260919000007_attach_post_closing_process.sql
-- Vincular a um fluxo um post que tem execucao individual vigente
-- (spec secoes 5.5, 9.3, 9.5).
--
-- POR QUE ENCERRAR ANTES DE ANEXAR. post_a1_process_guard (20260918000003) e
-- um BEFORE UPDATE OF workflow_id em workflow_posts SEM GUC de escape: ele
-- levanta post_has_active_process sempre que um post com execucao 'ativo' ou
-- 'concluido' ganha workflow_id. Esta RPC nao contorna o guard, ela satisfaz o
-- guard: primeiro grava estado='encerrado', motivo='vinculado', e so entao faz
-- o UPDATE, na mesma transacao. Se algo falhar depois, o rollback devolve a
-- execucao vigente.
--
-- ORDEM DE LOCKS: ':post_move' -> ':max_posts_per_workflow' (a mesma chave de
-- enforce_plan_count_limit, e a mesma ordem do attach, para nao formar ciclo
-- com um INSERT concorrente em workflow_posts), depois fluxo FOR UPDATE, post
-- FOR UPDATE, processo FOR UPDATE.
--
-- Estado e prazos individuais nao sao transferidos para as etapas do fluxo: o
-- post passa a seguir as etapas compartilhadas, e o historico individual fica
-- guardado em post_process_events.

CREATE OR REPLACE FUNCTION public.attach_post_closing_process(
  p_post_id          bigint,
  p_workflow_id      bigint,
  p_expected_revisao integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta      uuid := public.post_process_require_editor();
  v_wf         record;
  v_post       record;
  v_proc       record;
  v_limit      bigint;
  v_current    bigint;
  v_max_ordem  integer;
  v_revisao    integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));

  SELECT w.id, w.cliente_id, w.status INTO v_wf
    FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_wf.status <> 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  SELECT wp.id, wp.workflow_id, wp.cliente_id INTO v_post
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_post.workflow_id IS NOT NULL THEN
    RAISE EXCEPTION 'post_already_in_flow' USING ERRCODE = 'P0001';
  END IF;
  IF v_post.cliente_id IS DISTINCT FROM v_wf.cliente_id THEN
    RAISE EXCEPTION 'post_belongs_to_another_client' USING ERRCODE = 'P0001';
  END IF;

  -- A busca NAO filtra estado: trava a execucao mais recente do post e depois
  -- decide. Filtrar por IN ('ativo','concluido') faria um post cuja unica
  -- execucao ja esta 'encerrado' responder process_not_found, quando o
  -- contrato (e o que remove_post_process ja faz no caso equivalente) e
  -- process_already_closed. Sem execucao nenhuma, ai sim process_not_found.
  SELECT pp.id, pp.estado, pp.etapa_atual, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.post_id = p_post_id AND pp.conta_id = v_conta
   ORDER BY pp.id DESC
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.estado = 'encerrado' THEN
    RAISE EXCEPTION 'process_already_closed' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;

  -- Limite de posts por fluxo: trg_limit_posts so roda em INSERT e nunca
  -- dispara neste UPDATE, entao esta guarda e o unico enforcement possivel.
  -- Mesma fronteira do attach: atual + 1 = limite passa, limite + 1 estoura.
  v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_current FROM workflow_posts
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta;
    IF v_current + 1 > v_limit THEN
      RAISE EXCEPTION 'plan_limit_exceeded:max_posts_per_workflow' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 1) Encerrar ANTES do attach (ver nota no topo).
  UPDATE post_process_steps SET estado = 'interrompido', interrompido_em = now()
   WHERE process_id = v_proc.id AND estado = 'ativo';
  UPDATE post_processes
     SET estado = 'encerrado', motivo_encerramento = 'vinculado', revisao = revisao + 1
   WHERE id = v_proc.id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, p_post_id, v_proc.id, 'vinculado',
    jsonb_build_object('estado', v_proc.estado, 'etapa_atual', v_proc.etapa_atual),
    jsonb_build_object('estado', 'encerrado', 'motivo_encerramento', 'vinculado',
                       'workflow_id', p_workflow_id));

  -- 2) Attach, no mesmo desenho de attach_posts_to_flow.
  SELECT coalesce(max(ordem), -1) INTO v_max_ordem
    FROM workflow_posts WHERE workflow_id = p_workflow_id AND conta_id = v_conta;

  PERFORM set_config('app.allow_post_move', 'on', true);
  UPDATE workflow_posts
     SET workflow_id = p_workflow_id, ordem = (v_max_ordem + 1)::integer
   WHERE id = p_post_id AND conta_id = v_conta;
  PERFORM set_config('app.allow_post_move', 'off', true);

  RETURN jsonb_build_object('ok', true, 'process_id', v_proc.id, 'post_id', p_post_id,
                            'workflow_id', p_workflow_id, 'estado', 'encerrado',
                            'motivo_encerramento', 'vinculado', 'revisao', v_revisao);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_post_closing_process(bigint, bigint, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.attach_post_closing_process(bigint, bigint, integer)
  TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '8[3-9]_|9[01]_|ran='`
Expected: PASS em 83 a 91; `failures=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260919000007_attach_post_closing_process.sql \
        supabase/tests/entitlements/91_attach_post_closing_process.sql
git commit -m "feat(entregas): RPC attach_post_closing_process encerra antes de vincular

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `reorder_fluxos_board`

**Files:**
- Create: `supabase/migrations/20260919000008_reorder_fluxos_board.sql`
- Test: `supabase/tests/entitlements/92_reorder_fluxos_board.sql`

**Interfaces:**
- Consumes: `post_process_require_editor` (Task 2).
- Produces: `public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[]) RETURNS void`.

Regras fixadas (spec §4.2, §9.1):

- Uma chamada grava a coluna inteira: `workflows.position` para os cards de fluxo e `post_processes.board_position` para os cards individuais, no mesmo espaço de índices. O CRM envia a ordem completa da coluna, incluindo os cards ocultos pelo filtro na posição em que estavam.
- All-or-nothing na posse: um id de outra conta derruba tudo (`workflow_not_found` / `process_not_found`) e nada é gravado. A posse do processo é verificada só entre os estados que aparecem no quadro (`ativo` e `concluido`): um processo `encerrado` não é card nenhum, então mandar o id dele é erro de cliente e responde `process_not_found`.
- Os dois lados são opcionais, mas não os dois ao mesmo tempo (`invalid_arguments`), e cada par de arrays precisa ter o mesmo comprimento.
- Duplicata também é `invalid_arguments`, checada antes de qualquer UPDATE: id repetido dentro de `p_workflow_ids` ou dentro de `p_process_ids`, e posição repetida em `p_workflow_positions || p_process_positions`. Sem isso o `UPDATE ... FROM unnest(...)` junta uma linha a várias fontes e persiste uma ordem não determinística. Densidade continua não exigida (Decisão 19): a coluna pode ser esparsa, só não pode ter empate.
- Molde: `reorder_workflow_positions(bigint[], integer[])` do PR #479 (`20260917000001`), que não está em `main` nem nesta branch. Esta RPC é autossuficiente e não a chama. Se #479 mergear antes, as duas convivem: a de lá continua servindo o caminho só-fluxos e a fase 3 decide se consolida.
- Não incrementa `revisao`: ordenar o quadro não é mudança de estado do processo, e um drag de outra aba não deve invalidar um comando em edição. `board_position` também não está na lista de colunas de `post_processes_requires_avulso` (`UPDATE OF estado, post_id, conta_id`), então o trigger não dispara.

- [ ] **Step 1: Escrever a suíte que falha**

```sql
-- supabase/tests/entitlements/92_reorder_fluxos_board.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- reorder_fluxos_board (migration 20260919000008). Cobre:
-- 92.0 happy path misto: fluxos e processos renumerados numa chamada
-- 92.1 all-or-nothing entre contas
-- 92.2 argumentos invalidos (tamanhos diferentes, tudo vazio)
-- 92.3 ACL e permissao por papel; revisao do processo intocada
-- 92.4 duplicatas: id repetido e posicao repetida entre os dois arrays

create or replace function pg_temp.et_rb_env(
  out ws uuid, out usr uuid, out cli bigint, out wa bigint, out wb bigint,
  out pa bigint, out pb bigint, out proca bigint, out procb bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position) values (usr, ws, cli, 'A', 'ativo', 0) returning id into wa;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position) values (usr, ws, cli, 'B', 'ativo', 1) returning id into wb;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (ws, cli, 'P1') returning id into pa;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (ws, cli, 'P2') returning id into pb;
  insert into post_processes (conta_id, post_id, assinatura, board_position) values (ws, pa, '0|Copy|padrao', 2) returning id into proca;
  insert into post_processes (conta_id, post_id, assinatura, board_position) values (ws, pb, '0|Copy|padrao', 3) returning id into procb;
end $$;

-- 92.0
begin;
do $$
declare e record; v int;
begin
  select * into e from pg_temp.et_rb_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- nova ordem da coluna: procb, wa, proca, wb
  perform reorder_fluxos_board(array[e.wa, e.wb], array[1, 3]::integer[],
                               array[e.procb, e.proca], array[0, 2]::integer[]);
  execute 'reset role';
  select position into v from workflows where id = e.wa;      assert v = 1, format('wa=%s', v);
  select position into v from workflows where id = e.wb;      assert v = 3, format('wb=%s', v);
  select board_position into v from post_processes where id = e.proca; assert v = 2, format('proca=%s', v);
  select board_position into v from post_processes where id = e.procb; assert v = 0, format('procb=%s', v);
  raise notice 'PASS 92.0 renumeracao mista da coluna inteira';
end $$;
rollback;

-- 92.1
begin;
do $$
declare e record; g record; v_raised boolean := false; v int;
begin
  select * into e from pg_temp.et_rb_env();
  select * into g from pg_temp.et_rb_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_fluxos_board(array[e.wa, g.wa], array[0, 1]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'fluxo de outra conta no lote derruba tudo';
  select position into v from workflows where id = e.wa; assert v = 0, 'nada foi gravado';

  v_raised := false;
  begin
    perform reorder_fluxos_board('{}'::bigint[], '{}'::integer[], array[e.proca, g.proca], array[0, 1]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'processo de outra conta no lote derruba tudo';
  select board_position into v from post_processes where id = e.proca; assert v = 2, 'nada foi gravado';
  raise notice 'PASS 92.1 all-or-nothing entre contas';
end $$;
rollback;

-- 92.2
begin;
do $$
declare e record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rb_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_fluxos_board(array[e.wa, e.wb], array[0]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'arrays de tamanhos diferentes sao invalid_arguments';

  v_raised := false;
  begin
    perform reorder_fluxos_board('{}'::bigint[], '{}'::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'chamada sem nenhum id e invalid_arguments';
  raise notice 'PASS 92.2 argumentos invalidos';
end $$;
rollback;

-- 92.3
begin;
do $$
declare e record; v_ver uuid := gen_random_uuid(); v_role uuid; v_raised boolean := false; v int;
begin
  select * into e from pg_temp.et_rb_env();
  assert not has_function_privilege('anon', 'public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[])', 'execute'),
    'anon nao executa reorder_fluxos_board';
  assert has_function_privilege('authenticated', 'public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[])', 'execute'),
    'authenticated executa reorder_fluxos_board';

  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions) values (e.ws, 'ver', '{"entregas":"ver"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, e.ws, 'agent', v_role);
  update profiles set conta_id = e.ws, active_workspace_id = e.ws where id = v_ver;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ver, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_fluxos_board(array[e.wa], array[5]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'permission_denied', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'entregas=ver nao reordena';
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform reorder_fluxos_board('{}'::bigint[], '{}'::integer[], array[e.proca], array[9]::integer[]);
  execute 'reset role';
  select revisao into v from post_processes where id = e.proca;
  assert v = 1, format('reordenar nao incrementa revisao, obtido %s', v);
  raise notice 'PASS 92.3 ACL, permissao e revisao intocada';
end $$;
rollback;

-- 92.4
begin;
do $$
declare e record; v_raised boolean := false; v int;
begin
  select * into e from pg_temp.et_rb_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform reorder_fluxos_board(array[e.wa, e.wa], array[0, 1]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'id de fluxo repetido e invalid_arguments';

  v_raised := false;
  begin
    perform reorder_fluxos_board('{}'::bigint[], '{}'::integer[], array[e.proca, e.proca], array[0, 1]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'id de processo repetido e invalid_arguments';

  -- Posicao e um espaco de indices SO por coluna: o empate e checado sobre os
  -- dois arrays concatenados, nao dentro de cada um.
  v_raised := false;
  begin
    perform reorder_fluxos_board(array[e.wa], array[1]::integer[], array[e.proca], array[1]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'posicao repetida entre fluxo e processo e invalid_arguments';

  v_raised := false;
  begin
    perform reorder_fluxos_board(array[e.wa, e.wb], array[2, 2]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'posicao repetida dentro do mesmo array e invalid_arguments';

  -- Nulo em qualquer um dos quatro arrays cai no mesmo codigo, como no molde.
  v_raised := false;
  begin
    perform reorder_fluxos_board(array[e.wa, e.wb], array[0, null]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'posicao nula e invalid_arguments';
  execute 'reset role';

  select position into v from workflows where id = e.wa;      assert v = 0, 'nada foi gravado em wa';
  select position into v from workflows where id = e.wb;      assert v = 1, 'nada foi gravado em wb';
  select board_position into v from post_processes where id = e.proca; assert v = 2, 'nada foi gravado em proca';
  select board_position into v from post_processes where id = e.procb; assert v = 3, 'nada foi gravado em procb';

  -- Id de fluxo igual a id de processo NAO e duplicata: tabelas e sequences
  -- diferentes. Esparso tambem passa: densidade nao e exigida (Decisao 19).
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform reorder_fluxos_board(array[e.wa], array[0]::integer[], array[e.proca], array[7]::integer[]);
  execute 'reset role';
  select position into v from workflows where id = e.wa;      assert v = 0, 'coluna esparsa e aceita (fluxo)';
  select board_position into v from post_processes where id = e.proca; assert v = 7, 'coluna esparsa e aceita (processo)';
  raise notice 'PASS 92.4 duplicatas de id e de posicao';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '92_|ran='`
Expected: FAIL com `function reorder_fluxos_board(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260919000008_reorder_fluxos_board.sql
-- Ordem manual do quadro de Fluxos com os dois tipos de card
-- (spec secoes 4.2 e 9.1).
--
-- workflows.position e post_processes.board_position vivem no MESMO espaco de
-- indices por coluna. Um drag envia a coluna INTEIRA, ja incluindo os cards que
-- o filtro esconde, e esta RPC grava cada indice no campo do tipo certo, numa
-- transacao. Isso corrige, para os dois tipos, o defeito que o pre-requisito 2
-- corrige so para fluxos (N UPDATEs em paralelo, so sobre os cards visiveis).
--
-- Molde: reorder_workflow_positions (20260917000001, PR #479), que nao esta em
-- main. Esta funcao nao depende dela: reordena fluxos por conta propria. Se as
-- duas coexistirem, cada uma serve um quadro.
--
-- Nao toma advisory: nao insere nem reabre processo, e nao mexe em workflow_id.
-- Nenhum trigger le position/board_position, e board_position esta fora do
-- UPDATE OF de post_processes_requires_avulso. Nao incrementa revisao: ordenar
-- o quadro nao e mudanca de estado do processo.

CREATE OR REPLACE FUNCTION public.reorder_fluxos_board(
  p_workflow_ids       bigint[],
  p_workflow_positions integer[],
  p_process_ids        bigint[],
  p_process_positions  integer[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.post_process_require_editor();
  v_nw    int  := coalesce(array_length(p_workflow_ids, 1), 0);
  v_np    int  := coalesce(array_length(p_process_ids, 1), 0);
  v_count int;
BEGIN
  IF v_nw IS DISTINCT FROM coalesce(array_length(p_workflow_positions, 1), 0)
     OR v_np IS DISTINCT FROM coalesce(array_length(p_process_positions, 1), 0)
     OR (v_nw = 0 AND v_np = 0) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;

  -- Duplicatas derrubam a chamada ANTES de qualquer UPDATE. Com o mesmo id
  -- duas vezes num array, o UPDATE ... FROM unnest(...) junta a linha a duas
  -- fontes e o Postgres nao define qual vence: a ordem persistida sairia nao
  -- deterministica. Posicao repetida produz o mesmo sintoma na leitura, e como
  -- workflows.position e post_processes.board_position sao UM espaco de indices
  -- por coluna (secao 4.2), a checagem de posicao e sobre os dois arrays
  -- concatenados. count(DISTINCT) ignora NULL, entao um id ou uma posicao nula
  -- tambem cai aqui, o mesmo codigo que o molde reorder_workflow_positions usa
  -- para comprimento e nulos.
  --
  -- NAO se compara id de fluxo com id de processo: sao tabelas e sequences
  -- diferentes, e uma coluna legitima pode conter o fluxo 5 e o processo 5.
  -- Densidade tambem nao e exigida: a coluna pode ser esparsa (Decisao 19), so
  -- nao pode ter empate.
  IF v_nw > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_workflow_ids) x) IS DISTINCT FROM v_nw THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;
  IF v_np > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_process_ids) x) IS DISTINCT FROM v_np THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_workflow_positions || p_process_positions) x)
     IS DISTINCT FROM (v_nw + v_np) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;

  IF v_nw > 0 THEN
    PERFORM 1 FROM workflows w
     WHERE w.id = ANY(p_workflow_ids) AND w.conta_id = v_conta
     ORDER BY w.id
       FOR UPDATE;
    SELECT count(DISTINCT w.id) INTO v_count FROM workflows w
     WHERE w.id = ANY(p_workflow_ids) AND w.conta_id = v_conta;
    IF v_count IS DISTINCT FROM (SELECT count(DISTINCT x) FROM unnest(p_workflow_ids) x) THEN
      RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Estado restrito a 'ativo' e 'concluido': sao os unicos que viram card no
  -- quadro. Um id de processo 'encerrado' nao pode ter vindo de um drag, entao
  -- gravar board_position nele so poluiria o espaco de indices. Com o filtro,
  -- a RPC fica mais fechada e o erro (process_not_found) fica correto.
  IF v_np > 0 THEN
    PERFORM 1 FROM post_processes pp
     WHERE pp.id = ANY(p_process_ids) AND pp.conta_id = v_conta
       AND pp.estado IN ('ativo', 'concluido')
     ORDER BY pp.id
       FOR UPDATE;
    SELECT count(DISTINCT pp.id) INTO v_count FROM post_processes pp
     WHERE pp.id = ANY(p_process_ids) AND pp.conta_id = v_conta
       AND pp.estado IN ('ativo', 'concluido');
    IF v_count IS DISTINCT FROM (SELECT count(DISTINCT x) FROM unnest(p_process_ids) x) THEN
      RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_nw > 0 THEN
    UPDATE workflows w
       SET position = u.pos
      FROM unnest(p_workflow_ids, p_workflow_positions) AS u(id, pos)
     WHERE w.id = u.id AND w.conta_id = v_conta;
  END IF;

  IF v_np > 0 THEN
    UPDATE post_processes pp
       SET board_position = u.pos
      FROM unnest(p_process_ids, p_process_positions) AS u(id, pos)
     WHERE pp.id = u.id AND pp.conta_id = v_conta;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[])
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[])
  TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash scripts/test-entitlements.sh 2>&1 | grep -E '8[3-9]_|9[0-2]_|ran='`
Expected: PASS em 83 a 92; `failures=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260919000008_reorder_fluxos_board.sql \
        supabase/tests/entitlements/92_reorder_fluxos_board.sql
git commit -m "feat(entregas): RPC reorder_fluxos_board para a coluna mista

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Rollout em staging, gate completo e PR

**Files:** nenhum novo.

- [ ] **Step 1: Conferir prefixos e ACL de todas as funções novas**

```bash
git ls-tree --name-only origin/main:supabase/migrations | tail -3
ls supabase/migrations | grep 20260919 | sort
```

Os oito prefixos precisam ser maiores que o último de `main` e únicos entre si (é o que o job `migration-version-guard` checa). Depois, um bloco de conferência rodado uma vez contra o banco local, fora da suíte, para não deixar nenhuma função nova com EXECUTE aberto:

```sql
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as auth,
       has_function_privilege('service_role', p.oid, 'execute')  as svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('workflow_fingerprint','template_fingerprint','post_process_require_editor',
                     'post_process_log_event','post_process_assinatura','detach_posts_keeping_process',
                     'apply_post_process','transition_post_process','update_post_process_step',
                     'remove_post_process','attach_post_closing_process','reorder_fluxos_board')
 order by 1;
```

Esperado: `anon` falso em todas; `authenticated` verdadeiro só nas duas de fingerprint e nas sete RPCs de comando; `service_role` verdadeiro nessas mesmas nove; e **falso nos três helpers**, para os quais a migration da Task 2 revoga também `service_role` (Decisão 26). Essa última linha é o motivo de o `REVOKE` ser explícito: deixada implícita, ela dependeria do `pg_default_acl` do projeto, que não é o mesmo no banco local do CLI e no hosted, e a conferência daria resultados diferentes em cada ambiente.

- [ ] **Step 2: Migrations em staging**

`cat supabase/.temp/project-ref` deve ser `wlyzhyfondykzpsiqsce` (o worktree pode ter ficado apontado para prod; conferir antes de qualquer comando). `npx supabase db push --linked --dry-run`; se recusar por drift (migrations de terceiros pendentes, o caso conhecido de staging), aplicar as oito fora da banda, em ordem, com `npx supabase db query --linked --file <arquivo>` seguido do registro da versão em `supabase_migrations.schema_migrations`. Conferir:

```sql
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname like 'post_process%' or proname in
 ('workflow_fingerprint','template_fingerprint','detach_posts_keeping_process','apply_post_process',
  'transition_post_process','remove_post_process','attach_post_closing_process','reorder_fluxos_board')
 order by 1;
select indexname from pg_indexes where indexname in ('idx_post_processes_template','idx_post_processes_origem');
-- A limpeza de Express tem de ter sido recriada com a regra nova (Decisao 25).
select pg_get_functiondef('public.express_cleanup_delete_avulso_drafts(bigint[])'::regprocedure)
       like '%IN (''ativo'', ''concluido'')%' as poupa_concluido;
```

**Reversibilidade.** Sete das oito migrations são puramente aditivas (`CREATE OR REPLACE`
de funções que não existiam, mais dois índices `IF NOT EXISTS`): desfazê-las é `DROP
FUNCTION`. A exceção é a Task 2, que faz `CREATE OR REPLACE` de duas funções que **já
existem em produção**: `set_post_process_concluido_em` (`20260918000002`) e
`express_cleanup_delete_avulso_drafts` (`20260918000004`). Um rollback delas não é
`DROP`, é reaplicar o corpo antigo, que está nessas duas migrations. Nada aqui apaga
dado, então o rollback é sempre de definição de função, nunca de linha.

- [ ] **Step 3: Smoke em staging com a flag ligada num workspace de teste**

Nenhuma UI chama as RPCs ainda, então o smoke é por SQL, num workspace de validação de staging (não em conta de cliente):

```sql
update workspace_plan_overrides set feature_overrides =
  coalesce(feature_overrides, '{}'::jsonb) || '{"feature_post_processes": true}'::jsonb
 where workspace_id = '<ws de teste>';
-- desmembrar um post de um fluxo de teste, avancar, voltar, remover, e conferir
-- que o post continua com o mesmo status e o fluxo com os demais posts.
```

Ao fim, desligar de novo o override. Nada em produção precisa da flag ligada nesta fase.

A suíte `supabase/tests/express_cleanup_delete_avulso_drafts.sql` **também roda no CI**,
no segundo laço de `scripts/test-entitlements.sh` (o que varre `supabase/tests/*.sql`, não
só `supabase/tests/entitlements/`), dentro do mesmo job `entitlement-tests`. O bloco E.2
dela muda de expectativa nesta fase (Decisão 25), então ela entra na lista de suítes a
conferir junto com as oito novas.

- [ ] **Step 4: Gate completo**

Run: `npm run lint && npm run format:check && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json && npm run test && npm run check:functions && npm run test:functions`
Expected: verde. O gate Deno suja `node_modules/.deno` e `deno.lock`: rodá-lo por último, ou `npm ci` e `git checkout deno.lock` depois, antes de confiar em tsc/vitest.

- [ ] **Step 5: PR**

```bash
git push -u origin feat/post-processes-fase2
gh pr create --base main --title "feat(entregas): processos individuais, fase 2 (RPCs e concorrencia)" --body "$(cat <<'EOF'
## O que é
Fase 2 de `docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md`: todo o caminho de escrita dos processos individuais, como RPCs `SECURITY DEFINER`. Vai a produção sem mudança de comportamento: a flag `feature_post_processes` continua desligada em todos os planos, nenhuma UI chama nada e nenhuma edge function muda.

## Mudanças
- `workflow_fingerprint` / `template_fingerprint`: serialização canônica em texto, sem hash, `SECURITY INVOKER`, o mesmo formato que o CRM vai espelhar em `buildFingerprint` na fase 3.
- Endurecimento da fase 1: índices `idx_post_processes_template` / `idx_post_processes_origem`, `concluido_em` limpo em toda transição para `ativo`, `REVOKE` de USAGE nas três sequences, e os helpers internos `post_process_require_editor` (`workspace_not_found` / `permission_denied`), `post_process_log_event` e `post_process_assinatura`, nenhum com EXECUTE para `anon`, `authenticated` nem `service_role`.
- `express_cleanup_delete_avulso_drafts` recriada para poupar também o rascunho Express avulso cujo processo está `concluido`. É a fase 2 que cria o único caminho para chegar a `concluido`, e nenhum comando de processo tira o post de `rascunho`: sem isso o cron apagaria o post, o processo, as etapas e o histórico. Processo `encerrado` continua não poupando. Nenhuma edge function muda (o pré-filtro do handler segue `estado = 'ativo'` e os ids poupados a mais já entram em `avulso_skipped_with_process`).
- Sete RPCs: `detach_posts_keeping_process` (lote atômico e idempotente por `request_id`), `apply_post_process` (sequência reconstruída do template no servidor, com a exigência estrutural do modo `data_entrega`), `transition_post_process` (avançar, voltar, concluir, reabrir, com `revisao`, status esperado do post e re-arm do próximo ciclo numa transação), `update_post_process_step`, `remove_post_process`, `attach_post_closing_process` (encerra antes do UPDATE de `workflow_id`, satisfazendo `post_a1_process_guard`) e `reorder_fluxos_board` (que rejeita id ou posição repetida antes de gravar).
- Permissão por papel (`has_permission_for('entregas','editar')`) em toda mutação; gate de plano nas duas RPCs que criam execução; ordem de advisory locks `:post_move` → `:max_posts_per_workflow` e ordem de linhas fluxo → post → processo em toda a família.

## Rollout
Só migrations, `20260919000001` a `20260919000008`, em ordem. Nenhuma edge function muda e nenhum deploy de function é necessário. Aplicar em prod antes do merge (regra da casa), sem ligar a flag em conta nenhuma.

## Verificação
Suítes psql no job `entitlement-tests`: 85 (fingerprints, 6 blocos), 86 (endurecimento e helpers, 7 blocos), 87 (detach, 8), 88 (apply, 7), 89 (transition, 8), 90 (editar e remover, 6), 91 (vincular, 5), 92 (reordenar, 5), mais os blocos novos 83.12 e 83.13, a mudança de 83.3 (exclui as quatro tabelas de `et_grant_hosted_parity` e tolera `42501` no UPDATE) e o bloco E.2 de `supabase/tests/express_cleanup_delete_avulso_drafts.sql`, que passa a exigir que o processo `concluido` poupe o rascunho.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Aguardar o review externo e responder. Antes do merge: aplicar as oito migrations em prod (`--project-ref skjzpekeqefvlojenfsw`), em ordem.

---

## Fora deste plano

- Fase 3: `BoardEntity`, quadro misto, seção Sem processo, drawer individual, Concluídas, `getActivePostProcesses`, `buildFingerprint` em TS com o teste Vitest que compara o mesmo fixture dos dois lados, `etapaDeadlineDateOf` com `prazo_efetivo`. Depende desta fase e dos PRs #478 a #481.
- Fase 4: diálogos e comandos no CRM (`approvalAdvance.ts`, `AttachToFluxoDialog` com o passo de confirmação, mapeamento de erros por código em Sonner, `callRpcWithDeadlockRetry` reenviando o mesmo `request_id`), flag ligada em workspace de validação e a matriz de aceitação da §12.
- Transição server-side quando o cliente aprova no Hub: a spec §6.2 a coloca explicitamente fora da v1 e a §13 a registra como follow-up.
- Campos de leitura do processo no MCP (`get_post` / `list_posts`): §10 e §13, entrega posterior.
- O item que a fase 1 deixou no ledger (`progress.md`): `apps/crm/src/hooks/useWorkspaceLimits.ts` (`FeatureFlags`) e `apps/crm/src/lib/entitlement-errors.ts` (`FEATURE_LABELS`) ainda não conhecem `feature_post_processes`, e as RPCs desta fase passam a devolver `feature_disabled:feature_post_processes`. Nada quebra enquanto ninguém chama as RPCs, então isso vai junto da fase 3/4, com o mapeamento de erros por código em Sonner. Registrado aqui para não se perder de vez.
- Correções de spec que estas decisões implicavam: §10 e §12.18 (Decisão 25), **já escritas** na revisão 2.3 da spec. As demais deixaram de ser necessárias com as decisões do PO de 2026-09-10: a §7 fica como está porque a Decisão 18 traz a regra estrutural do modo `data_entrega` para dentro de `apply_post_process`, e a §5.5 e a §6.2 ficam como estão porque a Decisão 12 foi aprovada como escrita, com `concluir` herdando o diálogo de aprovação.

## Decisões tomadas ao planejar

Cada item abaixo é um ponto em que a spec estava ambígua, contradizia o schema entregue na fase 1, ou divergia do brief desta task. O revisor humano precisa aprovar ou corrigir cada um antes da execução.

### 1. Nenhuma RPC de avanço de etapa no caminho de aprovação do Hub

O brief pedia uma RPC `advance_post_process_approval(p_post_id)` chamada por `hub-approve`, com teste Deno. A spec proíbe: a rev 2.1 registra "a aprovação do cliente no Hub não avança a etapa individual (§6.2)", e a §6.2 diz textualmente "Não criar transição server-side no caminho de aprovação na v1", com o drawer mostrando a dica "Cliente aprovou. Avançar etapa?". A §13 registra isso como follow-up. **Decisão: não criar a RPC.** Consequência: nenhuma edge function muda na fase 2, e o rollout é só de migrations. O caminho de leitura da §6.1 (`isFinalApprovalCycle` olhando `post_processes`/`post_process_steps`) já foi entregue na fase 1 e não é tocado.

### 2. Assinaturas seguem a spec §9.1, não o brief

O brief lista assinaturas curtas (`detach_posts_keeping_process(p_workflow_id, p_post_ids, p_request_id)`, `transition_post_process(p_process_id, p_action, p_revisao)`, `update_post_process_step(p_step_id, ...)`, `reorder_fluxos_board(p_ids, p_positions)`) que perdem parâmetros que a própria spec exige (fingerprint, prazo congelado, status esperado do post, escolha de aprovação). **Decisão: a tabela da §9.1 é a fonte**, com os ajustes 3, 4, 5 e 6 abaixo. `update_post_process_step` endereça a etapa por `(p_process_id, p_ordem)` e não por `p_step_id`, como a §9.1 já fazia: `post_process_steps.id` não é estável para o cliente e `(process_id, ordem)` é a chave única real.

### 3. `p_request_id` é obrigatório e vem antes de `p_archive_empty_flow`

A §9.1 lista `p_archive_empty_flow` antes de `p_request_id`. Em Postgres, todo parâmetro depois de um com `DEFAULT` também precisa de `DEFAULT`, e um `request_id` opcional destruiria a idempotência que o critério 12.13 exige. **Decisão: ordem `(p_post_ids, p_workflow_id, p_fingerprint, p_active_deadline, p_request_id, p_step_deadlines, p_archive_empty_flow)`**, com os dois últimos opcionais. PostgREST chama por nome, então a ordem não afeta o cliente.

### 4. `p_step_deadlines` novo em `detach_posts_keeping_process`

A §7 diz "Etapas futuras com `data_limite` mantêm a data como `prazo_efetivo`", mas `post_process_steps` não tem coluna `data_limite` e a mesma seção proíbe calcular data no servidor ("Calcular a data no fuso local... a RPC recebe datas prontas e não repete o cálculo"). Converter `date` para `timestamptz` dentro do Postgres usaria o fuso do servidor, exatamente o bug que a spec manda evitar. **Decisão: um parâmetro opcional `p_step_deadlines jsonb`, mapa `{"<ordem>": "<ISO>"}` só para etapas posteriores à ativa**, validado contra as ordens reais do fluxo. Etapa futura sem entrada fica com `prazo_efetivo` nulo e recebe prazo ao ser ativada.

### 5. `p_active_deadline` é sempre obrigatório

A §7 diz que a RPC "valida só que o valor é um `timestamptz` não nulo quando a etapa tem prazo relativo". `workflow_etapas.prazo_dias` é `NOT NULL` desde o baseline, então "prazo relativo" é sempre verdade. **Decisão: exigir `p_active_deadline` não nulo em toda chamada** (`active_deadline_required`), o que também cobre o caso `data_limite`, onde a spec já manda o CRM enviar o fim do dia no fuso do navegador.

### 6. `reorder_fluxos_board` recebe quatro arrays, não `p_row_key` + dois jsonb

A §9.1 propõe `(p_row_key, p_ordem, p_workflow_positions jsonb, p_process_positions jsonb)`. `p_row_key` e `p_ordem` identificam a coluna no cliente e o servidor não tem como validá-los (a identidade de linha é derivada de template mais assinatura, no front). **Decisão: `(p_workflow_ids bigint[], p_workflow_positions integer[], p_process_ids bigint[], p_process_positions integer[])`**, tipado, no molde exato de `reorder_workflow_positions`. Retorna `void`, como o molde.

Achado externo dobrado nesta revisão (Codex P2, confirmado): as duplicatas são rejeitadas com `invalid_arguments`, o mesmo código que o molde usa para comprimento e nulos, antes de qualquer UPDATE. São duas checagens: id repetido dentro de `p_workflow_ids` ou dentro de `p_process_ids`, porque o `UPDATE ... FROM unnest(...)` juntaria uma linha a várias fontes e o Postgres não define qual vence, persistindo uma ordem não determinística; e posição repetida em `p_workflow_positions || p_process_positions`, porque as duas colunas são um espaço de índices só por coluna (§4.2). Id de fluxo igual a id de processo **não** é duplicata, e a checagem deliberadamente não os compara: são tabelas e sequences independentes, e uma coluna legítima pode ter o fluxo 5 e o processo 5 lado a lado. Densidade continua fora (Decisão 19): esparso passa, empate não. Coberto pelo bloco 92.4.

### 7. Código de permissão negada: `permission_denied`

Não existe precedente de RPC que negue por `has_permission_for`: `has_permission_for` só tem EXECUTE para `service_role` e hoje é consumida por triggers e edge functions. Os vizinhos são `financial_access_denied` (identificador, P0001 implícito) e `forbidden` com `42501` em funções de outra família. **Decisão: `permission_denied` com `ERRCODE = 'P0001'`**, identificador, consistente com toda a família detach/attach/move que o CRM já mapeia por identificador em `getAttachErrorToast`.

### 8. `process_changed`, não `stale_revision`

O brief usa `stale_revision`. A spec §9.4 e o critério 12.13 usam `process_changed`, e a §9.6 lista `workflow_changed`/`process_changed`/`post_changed` como o trio que dispara refetch na UI. **Decisão: `process_changed`.**

### 9. Gate de plano só nas duas RPCs que criam execução

A §11 diz "as RPCs de criação checam `effective_plan_feature` antes"; o critério 12.18 diz que a flag desligada "mantém execuções visíveis e operáveis". **Decisão: `detach_posts_keeping_process` e `apply_post_process` checam; `transition`, `update_step`, `remove`, `attach_closing` e `reorder` não.** Reabrir um processo `concluido` é UPDATE, não INSERT, e portanto não passa pelo trigger nem pelo gate: é "operável", como o critério exige.

### 10. Fingerprint de template sem a linha `etapa_atual=`

A §9.4 diz "o mesmo formato com as colunas `ordem|nome|tipo|prazo_dias|tipo_prazo`", sem dizer se a linha de cabeçalho fica. Template não tem ponteiro de etapa. **Decisão: só as linhas de etapa, sem cabeçalho.** O espelho TS da fase 3 precisa seguir isso.

### 11. Fingerprints são `SECURITY INVOKER`

A §9.1 diz "todas são SECURITY DEFINER", mas a frase se refere à tabela de RPCs de comando, onde as duas funções de fingerprint não aparecem. Como DEFINER com EXECUTE para `authenticated`, `workflow_fingerprint(<id alheio>)` vazaria nomes de etapa de outra conta. **Decisão: `SECURITY INVOKER`**, protegidas pela RLS de `workflows`/`workflow_etapas` quando chamadas direto, e rodando como o dono (sem RLS) quando chamadas de dentro das RPCs, que já validaram `conta_id`.

### 12. `avancar` nunca conclui o processo, e `concluir` herda o diálogo de aprovação

**Aprovado pelo PO em 2026-09-10.**

A spec descreve "Avançar sem alterar post: move **ou conclui**". Fundir os dois deixaria a UI sem como distinguir "avancei" de "terminei" e complicaria o evento. **Decisão: `avancar` sem próxima etapa `pendente` levanta `no_next_step`; concluir é o comando `concluir`**, que a §5.5 já descreve como ação própria do cabeçalho. `concluir` é aceito de qualquer etapa ativa, não só da última, e as etapas `pendente` restantes continuam `pendente`.

Separar os dois comandos, porém, não pode tirar de `concluir` o único caminho que a spec dá para "aprovar internamente e concluir": a §5.5, primeiro bullet, diz que "se a última etapa é `aprovacao_cliente` com pendência, abre o mesmo diálogo de escolha dos fluxos (§6.2)". **Decisão: quando a etapa ativa é `aprovacao_cliente`, `concluir` passa exatamente pela mesma árvore de `avancar`** (`p_expected_post_status` obrigatório, `post_changed` na divergência, `p_approval_choice` obrigatório com post não liberado, `aprovar_interno` gravando `aprovado_cliente` fora de `agendado`/`postado`), **menos o re-arm**, que não faz sentido sem próximo ciclo. Ordem de checagem: as pré-condições de `avancar` (`no_next_step`, `next_deadline_required`) continuam vindo antes da árvore, para que "não há próxima etapa" siga sendo a primeira resposta de um avançar na última etapa.

Alternativa registrada e descartada: manter `concluir` puro e resolver na UI em dois passos (`approvePostsInternally` por PATCH e depois `concluir`), o que deixaria a operação não atômica e exigiria corrigir a §5.5 e a §6.2 da spec, que hoje descrevem um diálogo só.

### 13. "Enviar ao cliente" não é uma escolha de `transition_post_process`

A §6.2 lista três opções no diálogo, mas descreve "Enviar ao cliente" como "Permanece na etapa", com a mesma regra de `sendPostsToCliente` (só de `aprovado_interno`). Não é uma transição. **Decisão: `p_approval_choice` aceita só `aprovar_interno` e `sem_alterar`**; enviar ao cliente continua sendo o UPDATE direto que o CRM já faz, fora desta RPC.

### 14. `p_expected_post_status` é obrigatório na etapa de aprovação

A §9.1 o lista como parâmetro sem dizer quando é exigido. Sem ele, o re-arm e o "aprovar internamente" agiriam sobre um status que a UI pode não ter visto. **Decisão: obrigatório quando `avancar` age sobre etapa `aprovacao_cliente` (`expected_post_status_required`); ignorado nos demais comandos.**

### 15. `voltar` reabre a etapa imediatamente anterior por `ordem`, qualquer que seja o estado dela

**Aprovado pelo PO em 2026-09-10.** Alternativa registrada e descartada: `voltar` pular as etapas `herdado` e `ignorado` e reabrir a última `concluido`, o que mudaria o que o usuário vê ao voltar num processo desmembrado no meio de um fluxo (as etapas anteriores nasceram `herdado`, então é uma delas que reabre).

A §5.4 diz que `concluido`, `herdado` e `ignorado` são informativas "até serem reabertas por Voltar etapa". **Decisão: a etapa anterior é a de maior `ordem` menor que a atual, independentemente do estado**, e ela volta a `ativo` preservando `iniciado_em` e `prazo_efetivo` (semântica de `revertEtapa`, incluindo prazo vencido). A etapa abandonada volta a `pendente` com `iniciado_em` nulo.

### 16. `p_responsavel_id` e `p_prazo_efetivo` são setters absolutos

A spec não distingue "limpar" de "não mexer". **Decisão: `NULL` limpa.** A UI envia sempre os dois valores do formulário. Se a fase 4 precisar de patch parcial, isso vira uma decisão de contrato nova, não uma leitura diferente desta.

### 17. `responsavel_id` herdado que não resolve mais vira nulo, no `apply` **e** no `detach`

O jsonb de um template pode carregar `responsavel_id` de um membro já removido, e a FK composta `post_process_steps_responsavel_same_tenant` derrubaria a aplicação inteira com `foreign_key_violation`. **Decisão: um `responsavel_id` vindo do template só é gravado se ainda resolver para um membro da conta; caso contrário fica nulo** (a UI mostra "Sem responsável", como a §7 já prevê para remoção de membro). Um `responsavel_id` vindo de `p_step_overrides` que não resolve continua sendo erro duro (`membro_not_found`).

A mesma regra vale no `detach_posts_keeping_process`, e por um motivo ainda mais concreto: `workflow_etapas.responsavel_id` é FK **simples** para `membros(id)` (`20260301_baseline_schema.sql`), sem checagem de tenant, enquanto `post_process_steps.responsavel_id` tem FK **composta** com `conta_id`. Um valor cross-tenant em `workflow_etapas` (dado velho, importação) derrubaria o lote inteiro com `foreign_key_violation` cru, sem código de erro nenhum para a UI mapear. **Decisão: o snapshot do desmembrar resolve `responsavel_id` pelo mesmo `(SELECT m.id FROM membros m WHERE m.id = e.responsavel_id AND m.conta_id = v_conta)`**, e a etapa nasce sem responsável quando não resolve. Coberto pelo bloco 87.7.

### 18. `prazo_efetivo` obrigatório só na etapa inicial, mais a regra estrutural do modo `data_entrega`

**Aprovado pelo PO em 2026-09-10**, na alternativa. Alternativa registrada e descartada: deixar a exigência estrutural do modo `data_entrega` fora da RPC, o que abandonaria em silêncio o que a §7 promete e exigiria corrigir a §7 da spec.

A §5.2 descreve exigências por modo de prazo (`data_fixa` exige data para cada etapa a partir da inicial), mas a §7 diz que a RPC "valida só que o valor é um `timestamptz` não nulo quando a etapa tem prazo relativo". As regras de **data** por modo são de diálogo: validá-las no servidor exigiria reimplementar dias úteis e `clientes.dia_entrega` em SQL, que a §7 proíbe. A regra de **forma** do modo `data_entrega` é outra coisa, e cabe no servidor.

**Decisão, em duas partes: (a) a RPC exige `prazo_efetivo` só para a etapa que vai ficar `ativo` (`start_deadline_required`), aceita para as posteriores e rejeita override de etapa anterior à inicial; (b) quando o `modo_prazo` do template é `data_entrega`, a RPC exige ao menos uma etapa de tipo `aprovacao_cliente` na sequência a partir de `p_start_ordem` e responde `data_entrega_requires_approval_step` (P0001) quando não há.**

A parte (b) é literalmente o que a §7 já descreve ("a RPC exige uma etapa `aprovacao_cliente` na sequência a partir da inicial"), então a §7 fica **como está** e nenhuma correção de spec é necessária deste lado. Ela só lê `tipo` do jsonb do template que a própria RPC acabou de travar com `FOR SHARE`, sem tocar em data. É relativa à ordem inicial, não ao template inteiro: um template com aprovação na ordem 1 aplicado a partir da ordem 2 é rejeitado. Vem depois de `invalid_start_ordem` e antes da validação de `p_step_overrides` e de qualquer INSERT, então um template inválido nunca cria linha. `padrao`, `data_fixa` e qualquer outro modo ignoram a regra. Coberto pelo bloco 88.6.

### 19. `board_position` inicial é o topo da faixa dos processos ativos da conta

A §4.2 diz que `board_position` divide o espaço de índices com `workflows.position`, mas não diz que valor um processo novo recebe. Calcular o máximo entre as duas colunas exigiria conhecer a coluna do quadro, que é do front. **Decisão: `max(board_position) + 1` entre os processos `ativo` e `concluido` da conta.** Só entre os `ativo` deixaria um processo `concluido` (que mantém o `board_position` e volta a aparecer se for reaberto) colidindo com um processo novo na mesma posição. Colisão é inofensiva, porque isso é só ordenação, mas o `max` sobre os dois estados que aparecem no quadro custa o mesmo e não colide. `encerrado` não é card e não entra. O primeiro drag manual da coluna chama `reorder_fluxos_board` e renumera tudo densamente.

### 20. `origem_descricao` só é preenchida no desmembrar

A §5.4 fala em "origem (template ou fluxo de origem)". No `apply_post_process` o template já está em `template_id` e `template_nome`. **Decisão: `origem_descricao` fica nula em `apply_post_process` e recebe `"<titulo do fluxo>, etapa <nome>"` em `detach_posts_keeping_process`**, que é o texto que a §5.1 pede no histórico.

### 21. `request_id` de outra conta responde `request_not_found`

`post_process_batch_requests.request_id` é PK global. Um id que existe mas pertence a outra conta não pode devolver o recibo alheio nem cair num `unique_violation` cru. **Decisão: `request_not_found`.** Como o uuid é gerado pelo CRM por tentativa, uma colisão entre contas é praticamente impossível; o código existe para não haver caminho não tratado.

### 22. Todas as sete RPCs tomam `:post_move` e travam post antes de processo

A leitura anterior era que a regra da §9.5 valesse só para quem insere ou reabre em `post_processes`, e que `remove_post_process` e `update_post_process_step` pudessem travar só a linha do processo. **Isso estava errado, por análise incompleta.** As duas chamam `post_process_log_event`, que insere em `post_process_events`, e essa tabela tem a FK composta `post_process_events_post_same_tenant (post_id, conta_id) REFERENCES workflow_posts` (`20260918000002`). Todo INSERT ali pede **`FOR KEY SHARE` na linha do post**. Ou seja: as duas travavam o processo primeiro e o post depois, implicitamente, que é literalmente o inverso da constraint global "fluxo → post → processo" deste plano.

O ciclo é concreto, na mesma conta e no mesmo post: `transition_post_process` toma `:post_move`, trava `workflow_posts` `FOR UPDATE` e vai pedir `post_processes` `FOR UPDATE`; em paralelo `remove_post_process`, sem advisory, já segura `post_processes` `FOR UPDATE` e chega ao `post_process_log_event`, que pede `FOR KEY SHARE` no post e fica bloqueado. Espera circular, `40P01`, resolvido pelo detector do Postgres mas entregue ao usuário como falha de comando (e sem `request_id` para reenviar, que só o detach tem). O mesmo vale contra `apply_post_process` e `attach_post_closing_process`, que também seguram o post `FOR UPDATE`.

**Decisão: as duas RPCs da Task 6 passam a (a) tomar `pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'))` no topo, o que sozinho já as serializa contra `transition`, `apply`, `detach` e os dois attach, e (b) travar a linha do post antes da linha do processo**, com a mesma leitura sem lock do `post_id` que `transition_post_process` já faz. Com isso as sete RPCs de comando têm exatamente a mesma ordem, e a constraint global do plano volta a ser verdade sem exceção. O bloco 90.5 assere que o advisory continua sendo tomado pelas duas. `transition_post_process` continua tomando o advisory em todos os comandos, e não só em `reabrir`, para não ter que raciocinar caso a caso.

### 23. `reorder_fluxos_board` não incrementa `revisao`

Ordenar o quadro não muda o estado de produção. Incrementar `revisao` faria um drag de outra aba invalidar um comando em edição sem motivo. **Decisão: não incrementa.** `board_position` está fora do `UPDATE OF` de `post_processes_requires_avulso`, então o trigger de guard também não dispara.

### 24. `avulso_skipped_with_process` fica com o nome atual

O minor M6 da fase 1 sugeria renomear o contador do `express-post-cleanup-cron`, que também conta ids poupados porque o post deixou de ser rascunho avulso entre a leitura e o delete. Renomear mexeria numa edge function que esta fase não toca e mudaria a forma da resposta do cron. **Decisão: não renomear; documentar o comportamento na declaração da interface do handler quando a fase 4 abrir aquele arquivo.** Registrado aqui para não se perder.

### 25. A limpeza de Express passa a poupar o rascunho avulso com processo `concluido`

**Aprovado pelo PO em 2026-09-10.** Alternativa registrada e descartada: manter a RPC poupando só `estado = 'ativo'`, aceitando a perda do post, do processo e do histórico. As duas linhas da spec que falavam em "execução ativa" foram corrigidas junto, na revisão 2.3: a §10 e o critério 12.18 agora dizem "execução vigente (`ativo` ou `concluido`)".

`20260918000004` poupa só `pp.estado = 'ativo'`. O caminho de falha é concreto e nasce **nesta fase**: um post Express avulso ganha processo por `apply_post_process`, a agência produz tudo e clica em "Concluir processo" (`transition_post_process(..., 'concluir')`); por desenho da spec (§5.1, §5.2, §6.2 e critério 12.4) **nenhum comando de processo altera o status do post**, então ele continua `rascunho`. Passado o cutoff, o passo 3 do `express-post-cleanup-cron` o entrega à RPC, o `NOT EXISTS (estado='ativo')` não o poupa, e o `DELETE FROM workflow_posts` leva por CASCADE o `post_processes`, os `post_process_steps` e todo o `post_process_events`. O trabalho e o histórico somem sem log. Antes da fase 2 não havia caminho para chegar a `concluido`, então o defeito nasce aqui e é aqui que fecha.

**Decisão: a Task 2 recria `express_cleanup_delete_avulso_drafts(bigint[])` com `NOT EXISTS (... estado IN ('ativo','concluido'))`.** É a RPC, e não o pré-filtro, que garante a regra, exatamente como dizem o comentário de `20260918000004` e a §10. **Nenhuma edge function muda:** o pré-filtro do handler continua com `.eq("estado","ativo")` e os ids poupados a mais já caem em `avulso_skipped_with_process`, que o handler soma **depois** da RPC comparando os ids enviados com os devolvidos. O contador fica um pouco mais impreciso do que já era (M6 da fase 1, Decisão 24), sem deploy de function.

Rejeitada a alternativa "tirar o post de `rascunho` quando um processo começa": contradiz frontalmente §5.1, §5.2, §6.2 ("desmembrar, aplicar, concluir, remover ou vincular nunca alteram status") e o critério 12.4.

Ponto aberto para o PO: um processo **`encerrado`** (removido ou vinculado) continua **não** poupando o post, o que está certo (o post voltou a "Sem processo" e é um rascunho abandonado como qualquer outro), mas o `DELETE` leva junto o histórico daquele processo encerrado. Aceitável na v1; registrado aqui para virar escolha explícita.

### 26. Os três helpers internos não têm EXECUTE nem para `service_role`

A fase 1 revogava os helpers de `public, anon, authenticated` e deixava `service_role` implícito. O que `service_role` acaba tendo depende do `pg_default_acl` do projeto, que não é o mesmo no banco local do CLI e no hosted (é o mesmo mecanismo que a memória do projeto registra em `reference_supabase_revoke_public_strips_service_role.md`), então a conferência de ACL da Task 9 daria resultados diferentes por ambiente. **Decisão: `REVOKE ALL ... FROM public, anon, authenticated, service_role` nos três helpers.** Nenhum grant é necessário: as RPCs `SECURITY DEFINER` são do mesmo dono e chamam os helpers como dono, que executa por ser dono, o mesmo raciocínio que já vale para `has_permission_for`. O bloco 86.5 assere as três ausências.

### 27. O desmembrar não escreve no histórico do fluxo de origem

A §5.1 diz "o histórico do fluxo continua no fluxo", o que é ambíguo: pode ser "não movemos o histórico antigo" ou "o fluxo registra a saída". `detach_posts_keeping_process` grava um evento `desmembrado` por post em `post_process_events`, com o título do fluxo e a etapa de origem no `antes`, mas **não** chama `record_workflow_event`. **Decisão: não chamar, na v1.** Consequência assumida: quem abrir o histórico do fluxo não vê que três posts saíram dele mantendo etapas; quem abrir o processo individual vê de onde ele veio. Se a fase 3 mostrar que a auditoria do fluxo fica capenga, acrescentar o `record_workflow_event` é aditivo e não muda contrato de RPC nenhum.

### 28. O recibo de idempotência guarda um digest das entradas

O replay do `p_request_id` devolvia o `resultado` guardado sem olhar as entradas da chamada. Um `request_id` reaproveitado com outro lote (retry do CRM depois de o usuário mudar a seleção, ou um bug de reuso do uuid) receberia de volta `{"ok": true, ...}` descrevendo o lote anterior, e a UI daria por desmembrado um post que continua no fluxo. **Decisão: `resultado` ganha a chave `input_hash`, `md5(p_workflow_id || '|' || ids deduplicados e ordenados || '|' || p_fingerprint)`, gravada no recibo; no replay, digest divergente levanta `request_mismatch` (`P0001`) e só digest igual devolve o resultado.** A chave é removida na volta (`v_prev - 'input_hash'`), então o formato de retorno da seção Interfaces continua o mesmo e a fase 4 não precisa conhecê-la.

Fora do digest ficam `p_active_deadline`, `p_step_deadlines` e `p_archive_empty_flow`, de propósito: são valores derivados que o CRM recalcula a cada tentativa (`computeDeadlineDate` com o fuso do navegador), e uma diferença de milissegundos entre o envio e o reenvio do **mesmo** comando não pode virar erro. O que identifica o lote é fluxo, posts e fingerprint da origem. Complementa a Decisão 21: `request_id` de outra conta responde `request_not_found`, `request_id` da própria conta com outra entrada responde `request_mismatch`. Coberto pelo bloco 87.8.

### 29. `attach_post_closing_process` responde `process_already_closed`, não `process_not_found`

A revisão anterior travava o processo com `estado IN ('ativo','concluido')`, então um post cuja única execução já estava `encerrado` caía no `NOT FOUND` e respondia `process_not_found`, o que contradiz o contrato e diverge de `remove_post_process`, que para o mesmo caso responde `process_already_closed`. Dois códigos diferentes para "essa execução já acabou" obrigariam a fase 4 a tratar o mesmo estado de duas formas. **Decisão: travar a execução mais recente do post (`ORDER BY pp.id DESC LIMIT 1 FOR UPDATE`), sem filtro de estado; sem linha nenhuma é `process_not_found`, linha `encerrado` é `process_already_closed`, e `ativo` ou `concluido` segue o caminho normal.** A tabela de códigos lista `attach` na linha de `process_already_closed` e o bloco 91.4 cobre os três desfechos.

## Auto-revisão

### Cobertura da spec

| Seção | Item | Onde |
| --- | --- | --- |
| §5.1 | desmembrar mantendo etapas, snapshot, etapa herdada, evento, arquivamento, idempotência | Task 3 |
| §5.1 | fluxo precisa estar `ativo` com uma só etapa `ativo` | Task 3, `workflow_not_active` / `workflow_etapas_inconsistent` |
| §5.2 | aplicar template, sequência do servidor, etapas anteriores `ignorado`, `template_changed`, `post_has_active_process` / `post_in_workflow` | Task 4 |
| §5.3 | criar post não muda | fora do escopo, nada a fazer |
| §5.4 | editar responsável e prazo de etapas `pendente`/`ativo` | Task 6, `update_post_process_step` |
| §5.5 | concluir, reabrir preservando prazo, remover, vincular | Tasks 5, 6 e 7; blocos 89.4 e 89.6 |
| §5.5 | concluir sobre etapa `aprovacao_cliente` abre o mesmo diálogo dos fluxos | Task 5; Decisão 12; bloco 89.6 |
| §6.2 | árvore de decisão da aprovação, re-arm, liberado, aprovação adiante só `pendente`, transação única | Task 5 |
| §6.2 | não criar transição server-side no Hub | Decisão 1 |
| §7 | prazo efetivo calculado pelo CRM, congelamento no desmembrar, preservação no voltar e no reabrir, responsável de etapa distinto do responsável do post | Tasks 3, 5, 6; Decisões 4, 5, 18 |
| §7 | responsável removido do workspace vira "Sem responsável" em vez de derrubar a operação | Decisão 17; Tasks 3 e 4; bloco 87.7 |
| §7 | modo `data_entrega` exige uma etapa `aprovacao_cliente` na sequência a partir da inicial | Task 4; Decisão 18; bloco 88.6 |
| §9.1 | as sete RPCs, `SECURITY DEFINER`, `search_path`, REVOKE/GRANT | Tasks 3 a 8; Decisões 2, 3, 6 |
| §9.2 | `get_my_conta_id`, `has_permission_for('entregas','editar')`, `conta_id` nunca do cliente, dado de outra conta responde `not_found` | Task 2 (`post_process_require_editor`), blocos 87.3, 88.4, 89.5, 90.4, 91.2, 92.1 |
| §9.3 | `attach_post_closing_process` encerra antes do UPDATE; as três RPCs genéricas seguem barradas | Task 7, blocos 91.0, 91.3 e 91.4 |
| §9.4 | fingerprint recalculado sob lock, `revisao`, `p_expected_post_status`, idempotência por `request_id` | Tasks 1, 3, 5 |
| §9.5 | ordem de advisory locks e de locks de linha, igual nas sete RPCs | Constraint global, cabeçalhos das Tasks 3, 4, 5, 6 e 7; Decisão 22; bloco 90.5 |
| §11 | gate de plano antes do trigger | Tasks 3 e 4; Decisão 9 |
| §12.13 | lote parcial derruba tudo, mesmo `request_id` sem efeitos novos, revisão velha | blocos 87.1, 87.3, 87.8, 89.1 |
| §12.13a | override com `nome`/`tipo`/`ordem` rejeitado, responsável de outra conta rejeitado, `template_changed` | bloco 88.2, 88.1 |
| §12.14 | editar etapa da origem entre abrir e confirmar falha com `workflow_changed` | bloco 87.2 |
| §12.15 | ids de outra conta rejeitados, escrita direta negada, workspace nulo falha, membro sem permissão | blocos 83.12, 83.13, 86.3, 86.5, 87.3, 87.4, 92.3 |
| §12.16 | `attach_posts_to_flow` barrado; `attach_post_closing_process` respeita o limite | blocos 91.3 e 91.1 |
| §12.17 | arquivar fluxo vazio não arquiva fluxo que recebeu outro post | bloco 87.5 (arquiva só quando o lote esvaziou; o predicado `NOT EXISTS` é reavaliado com a linha travada) |
| §12.18 | flag desligada mantém execuções operáveis | Decisão 9; nenhuma RPC além de detach/apply consulta a flag |
| §10, §12.18 | limpeza de Express não apaga um rascunho avulso com processo `concluido` | Task 2; Decisão 25; bloco E.2 de `supabase/tests/express_cleanup_delete_avulso_drafts.sql` |
| §12.19 | remover membro responsável continua funcionando | herdado da fase 1 (`ON DELETE SET NULL (responsavel_id)`), coberto por 83.8 |

Itens da §12 que **não** pertencem a esta fase: 1 a 12 na parte de produto (dependem do CRM, fases 3 e 4), 11 (Hub, entregue na fase 1), Vitest, E2E.

### Varredura de placeholders

Nenhum `TODO`, `FIXME`, `...`, `<preencher>` ou corpo de função elidido. As doze funções aparecem inteiras, com `REVOKE`/`GRANT` logo abaixo. As oito suítes aparecem inteiras, com `\set ON_ERROR_STOP on`, `\i _helpers.sql`, fixture, blocos `begin/rollback` e `raise notice 'PASS ...'`. Toda task tem passo de rodar-e-falhar, rodar-e-passar e comando de commit completo.

### Consistência de nomes e assinaturas entre as tasks

- As doze funções da seção Interfaces aparecem com a mesma assinatura na task que as cria, no `REVOKE`/`GRANT` da própria migration, na consulta de ACL da Task 9 e nas asserções `has_function_privilege` das suítes 86.5 e 92.3.
- Prefixos de migration: `20260919000001` a `20260919000008`, um por task, sem repetição, todos acima de `20260918000004`.
- Arquivos de suíte: 85 a 92, um por task, sem colisão com 83 e 84 da fase 1. A Task 2 também edita duas suítes existentes: `83_post_processes_schema.sql` (bloco 83.3, mais os novos 83.12 e 83.13) e `supabase/tests/express_cleanup_delete_avulso_drafts.sql` (bloco E.2), que roda no segundo laço de `scripts/test-entitlements.sh`, no mesmo job de CI.
- Blocos por suíte, depois desta revisão: 85 tem 6 (85.0 a 85.5), 86 tem 7 (86.0 a 86.6), 87 tem 9 (87.0 a 87.8), 88 tem 7 (88.0 a 88.6, com o 88.6 em três transações), 89 tem 8 (89.0 a 89.7), 90 tem 6 (90.0 a 90.5), 91 tem 5 (91.0 a 91.4) e 92 tem 5 (92.0 a 92.4).
- Toda chamada de `workflow_fingerprint` / `template_fingerprint` nas suítes 87 e 88 acontece **antes** de `set local role authenticated`, numa variável. As duas são `SECURITY INVOKER` (Decisão 11) e o argumento é avaliado no contexto do chamador: sob `authenticated` e sem `et_grant_hosted_parity`, ler `workflows` ou `workflow_templates` levanta `permission denied` no banco local do CLI, e as duas suítes inteiras abortariam no primeiro bloco. O caminho público (chamada direta por `authenticated` sobre o próprio fluxo, que é o que a fase 3 vai usar) é provado no bloco 85.5, que chama `et_grant_hosted_parity()` e exercita a RLS de verdade nos dois sentidos.
- Códigos de erro: a tabela da seção Interfaces tem **44 códigos**, com `request_mismatch` (Decisão 28) e `data_entrega_requires_approval_step` (Decisão 18) acrescentados nas duas últimas revisões. Com os blocos de erro de argumento (87.6, 88.5, 88.6, 89.6, 89.7, 90.5, 91.4 e 92.4) e o 87.8, **todos os 44 são levantados por pelo menos uma migration e checados por pelo menos um bloco de teste: zero códigos sem bloco.** `process_already_closed` agora tem bloco nos dois call sites, `remove` (90.5) e `attach` (91.4). O que continua parcial é a cobertura por *call site*, e a lista é exata, quatro linhas e nenhuma outra: `feature_disabled:feature_post_processes` tem bloco só em `detach` (87.4), não em `apply`; `post_not_found` tem bloco só em `detach` (87.6), não em `apply` nem em `attach`; `workflow_not_found` tem bloco em `detach` (87.6) e em `reorder` (92.1), não em `attach`; e `step_not_found` tem bloco só em `update_step` (90.1), porque o caminho homônimo de `transition` (nenhuma etapa `ativo`) é defensivo e o índice parcial `post_process_steps_one_active` o torna inalcançável com dado válido.
- Nomes de coluna usados nas migrations conferem com `20260918000002`: `post_processes(assinatura, estado, motivo_encerramento, etapa_atual, modo_prazo, board_position, revisao, created_by, concluido_em)`, `post_process_steps(ordem, nome, tipo, responsavel_id, prazo_dias, tipo_prazo, prazo_efetivo, estado, iniciado_em, concluido_em, interrompido_em, origem_etapa_ordem, origem_etapa_nome)`, `post_process_events(evento, actor_user_id, actor_name, origem, antes, depois)`, `post_process_batch_requests(request_id, conta_id, resultado)`.
- Colunas lidas de `workflow_etapas` (`ordem, nome, tipo, status, responsavel_id, prazo_dias, tipo_prazo, data_limite, iniciado_em, concluido_em`) e de `workflows` (`titulo, status, template_id, modo_prazo, etapa_atual, position`) conferem com o baseline mais `20260325` (`tipo`), `20260421000000` (`data_limite`, `modo_prazo`) e `20260326` (`position`).
- `profiles.nome` é a fonte de `actor_name`, o mesmo que `record_workflow_event` usa.
- Estados de etapa usados (`pendente, ativo, concluido, herdado, ignorado, interrompido`) e de processo (`ativo, concluido, encerrado`) são exatamente os do CHECK da fase 1; os eventos usados (`desmembrado, aplicado, avancou, voltou, concluido, reaberto, removido, vinculado, etapa_editada`) são exatamente os nove do CHECK.
