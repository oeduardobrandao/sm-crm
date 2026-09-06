# Gatilhos de popup por situação de cobrança: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um popup do admin pode ter um gatilho (`payment_pending`, `trial_ending` com N dias, `plan_downgraded`) que o mostra só ao dono do workspace enquanto a assinatura estiver naquela situação, e uma frequência nova "Uma vez por dia".

**Architecture:** Duas colunas em `global_popups` (`trigger`, `trigger_days`) e uma função SQL `security definer` `popup_trigger_matches(trigger, days)` chamada como um AND a mais na policy de SELECT. O CRM não avalia condição: a RLS já devolve só o elegível. A frequência `daily` é decidida no cliente (`pickPopup`) pelo `seen` do dia-calendário local. Spec: `docs/superpowers/specs/2026-09-06-popup-triggers-design.md`.

**Tech Stack:** Postgres/RLS (Supabase), Deno edge functions, React 19 + Vitest (admin e CRM), `deno test`, suítes psql em `supabase/tests/entitlements/`.

## Global Constraints

- Branch `claude/admin-popup-triggers-e31b04`, worktree `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/client-selector-zindex-ce5343`, já sobre `origin/main` ac259de5 com os dois commits da spec. **Rode todo comando a partir desse caminho** e confira `git -C <worktree> branch --show-current` antes de commitar.
- Migration `supabase/migrations/20260911000001_popup_triggers.sql` (cauda de `origin/main` hoje: `20260910000001`). Reconferir com `git ls-tree --name-only origin/main:supabase/migrations | sort | tail -3` antes de abrir o PR e renumerar acima da cauda se a main avançou.
- Suíte psql nova: `supabase/tests/entitlements/80_popup_triggers.sql` (a última é a 79).
- Nomes fixos, usados em mais de uma tarefa: coluna `trigger` (palavra-chave não reservada, sem aspas), coluna `trigger_days`, valores `payment_pending | trial_ending | plan_downgraded`, frequência `daily`, função `popup_trigger_matches(p_trigger text, p_days int)`, função TS `normalizePopupTrigger(update, current?)`, `MAX_TRIGGER_DAYS = 60`.
- Copy pt-BR, sem travessão (use "·", ponto ou dois-pontos). Prettier singleQuote / trailingComma all / printWidth 100: `npm run format` antes de cada commit de `apps/`.
- `deno test` suja `deno.lock` e `node_modules/.deno`: depois de qualquer rodada Deno, `git checkout deno.lock` e `npm ci` antes de vitest/tsc. Nunca rode Deno e vitest em paralelo.
- Verificação final (Task 8): `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run test:functions`, `npm run check:functions`, e a suíte psql no stack local.
- Comandos Deno por arquivo (mesmas flags do `npm run test:functions`):
  `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys <arquivo>`.
- Rollout (ordem obrigatória, no PR): migration em prod → deploy `platform-admin` e `mcp-admin` → merge. Fora de ordem o popup nasce sem gatilho e visível para todos.

---

### Task 1: Migration + suíte psql 80

**Files:**
- Create: `supabase/migrations/20260911000001_popup_triggers.sql`
- Create: `supabase/tests/entitlements/80_popup_triggers.sql`

**Interfaces:**
- Produces: colunas `global_popups.trigger text null` e `global_popups.trigger_days int null`; CHECK `frequency in ('once','until_cta','daily')`; função `popup_trigger_matches(p_trigger text, p_days int) returns boolean` (execute só para `authenticated`); policy de SELECT de `global_popups` com `and popup_trigger_matches(trigger, trigger_days)`.

- [ ] **Step 1: Escrever a suíte psql (falha até a migration existir)**

Crie `supabase/tests/entitlements/80_popup_triggers.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Gatilhos de popup (migration 20260911000001_popup_triggers.sql, spec 2026-09-06):
--   (a) popup_trigger_matches + policy: so o DONO do workspace, e so enquanto a
--       assinatura estiver na situacao do gatilho; popup sem gatilho segue para todos.
--   (b) trial_ending respeita a janela de N dias e some com o teste vencido.
--   (c) popup_interactions: agente nao insere em popup com gatilho que nao ve.
--   (d) a funcao nao e executavel por anon.
--   (e) CHECKs: trigger invalido, trigger_days sem trial_ending (prova o coalesce),
--       trial_ending sem dias, faixa 1..60, frequency daily (com e sem require_ack).

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a     uuid;
  v_ws_b     uuid;
  v_owner_a  uuid := gen_random_uuid();
  v_agent_a  uuid := gen_random_uuid();
  v_owner_b  uuid := gen_random_uuid();
  v_p_plain  uuid;
  v_p_pay    uuid;
  v_p_trial3 uuid;
  v_p_trial1 uuid;
  v_p_down   uuid;
  v_ids      uuid[];
  v_rejected boolean;
  v_match    boolean;
  v_pages    jsonb := '[{"title":"T","body":"B"}]'::jsonb;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');
  insert into auth.users (id) values (v_owner_a), (v_agent_a), (v_owner_b);
  -- Membership ANTES do update de profiles: trg_validate_active_workspace recusa
  -- um active_workspace_id do qual o usuario ainda nao e membro.
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner_a, v_ws_a, 'owner'), (v_agent_a, v_ws_a, 'agent'), (v_owner_b, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
    where id in (v_owner_a, v_agent_a);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_owner_b;
  insert into workspace_subscriptions (workspace_id, stripe_customer_id, status) values
    (v_ws_a, 'cus_et80_a', 'past_due'), (v_ws_b, 'cus_et80_b', 'active');

  insert into global_popups (pages, target_mode, status)
    values (v_pages, 'all', 'active') returning id into v_p_plain;
  insert into global_popups (pages, target_mode, status, trigger)
    values (v_pages, 'all', 'active', 'payment_pending') returning id into v_p_pay;
  insert into global_popups (pages, target_mode, status, trigger, trigger_days)
    values (v_pages, 'all', 'active', 'trial_ending', 3) returning id into v_p_trial3;
  insert into global_popups (pages, target_mode, status, trigger, trigger_days)
    values (v_pages, 'all', 'active', 'trial_ending', 1) returning id into v_p_trial1;
  insert into global_popups (pages, target_mode, status, trigger)
    values (v_pages, 'all', 'active', 'plan_downgraded') returning id into v_p_down;

  -- ---- (a) dono A, assinatura past_due ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_plain = any(v_ids), 'dono A nao ve popup sem gatilho';
  assert v_p_pay = any(v_ids), 'dono A (past_due) nao ve payment_pending';
  assert not (v_p_trial3 = any(v_ids)), 'dono A (past_due) ve trial_ending';
  assert not (v_p_down = any(v_ids)), 'dono A (past_due) ve plan_downgraded';
  select popup_trigger_matches('payment_pending', null) into v_match;
  assert v_match, 'popup_trigger_matches direto devolve false para o dono em past_due';
  select popup_trigger_matches(null, null) into v_match;
  assert v_match, 'popup_trigger_matches(null) deveria ser true';
  execute 'reset role';

  -- ---- (a) agente A: mesmo workspace, nao e dono ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_plain = any(v_ids), 'agente A nao ve popup sem gatilho';
  assert not (v_p_pay = any(v_ids)), 'agente A ve payment_pending do dono';
  select popup_trigger_matches('payment_pending', null) into v_match;
  assert not v_match, 'popup_trigger_matches direto devolve true para agente';
  -- (c) insert de interacao herda a policy de SELECT
  v_rejected := false;
  begin
    insert into popup_interactions (popup_id, user_id, action) values (v_p_pay, v_agent_a, 'seen');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'agente A inseriu interacao em popup com gatilho que nao ve';
  execute 'reset role';

  -- ---- (a) dono B, assinatura active ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_plain = any(v_ids), 'dono B nao ve popup sem gatilho';
  assert not (v_p_pay = any(v_ids)), 'dono B (active) ve payment_pending';
  assert not (v_p_trial3 = any(v_ids)), 'dono B (active) ve trial_ending';
  assert not (v_p_down = any(v_ids)), 'dono B (active) ve plan_downgraded';
  execute 'reset role';

  -- ---- (b) dono A em teste terminando em 2 dias ----
  update workspace_subscriptions
    set status = 'trialing', current_period_end = now() + interval '2 days'
    where workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_trial3 = any(v_ids), 'dono A (teste em 2 dias) nao ve trial_ending 3';
  assert not (v_p_trial1 = any(v_ids)), 'dono A (teste em 2 dias) ve trial_ending 1';
  assert not (v_p_pay = any(v_ids)), 'dono A (trialing) ve payment_pending';
  execute 'reset role';

  -- (b) teste ja vencido: nenhum gatilho
  update workspace_subscriptions
    set current_period_end = now() - interval '1 hour' where workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert not (v_p_trial3 = any(v_ids)), 'dono A (teste vencido) ve trial_ending 3';
  assert v_p_plain = any(v_ids), 'dono A (teste vencido) perdeu o popup sem gatilho';
  execute 'reset role';

  -- (a) unpaid: so plan_downgraded
  update workspace_subscriptions set status = 'unpaid' where workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_down = any(v_ids), 'dono A (unpaid) nao ve plan_downgraded';
  assert not (v_p_pay = any(v_ids)), 'dono A (unpaid) ve payment_pending';
  execute 'reset role';

  -- ---- (d) anon nao executa a funcao ----
  execute 'set local role anon';
  v_rejected := false;
  begin
    perform popup_trigger_matches('payment_pending', null);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'anon conseguiu executar popup_trigger_matches';
  execute 'reset role';

  -- ---- (e) CHECKs, como postgres ----
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger) values (v_pages, 'all', 'bogus');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trigger invalido foi aceito';

  -- trigger NULL com dias: sem o coalesce no CHECK isto passaria
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger_days) values (v_pages, 'all', 3);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trigger_days sem gatilho foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger, trigger_days)
      values (v_pages, 'all', 'payment_pending', 3);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trigger_days com payment_pending foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger) values (v_pages, 'all', 'trial_ending');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trial_ending sem trigger_days foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger, trigger_days)
      values (v_pages, 'all', 'trial_ending', 0);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trial_ending com 0 dias foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger, trigger_days)
      values (v_pages, 'all', 'trial_ending', 61);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trial_ending com 61 dias foi aceito';

  -- daily aceito, com e sem confirmacao obrigatoria
  insert into global_popups (pages, target_mode, frequency) values (v_pages, 'all', 'daily');
  insert into global_popups (pages, target_mode, frequency, require_ack)
    values (v_pages, 'all', 'daily', true);

  -- require_ack + until_cta continua proibido
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, require_ack, frequency, cta_label, cta_url)
      values (v_pages, 'all', true, 'until_cta', 'Ver', '/x');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'require_ack + until_cta foi aceito';
end $$;
rollback;
```

- [ ] **Step 2: Subir o stack local e rodar a suíte para vê-la falhar**

Docker aqui é colima. Outros worktrees podem estar com as portas padrão, então use portas próprias (veja `supabase/config.toml`; faça backup antes):

```bash
cp supabase/config.toml supabase/config.toml.bak
cat >> supabase/config.toml <<'TOML'
[api]
port = 54421
[db]
port = 54422
[inbucket]
port = 54424
[studio]
port = 54425
TOML
colima start --cpu 4 --memory 8
npx supabase start
```

Rode só a suíte nova, a partir da raiz do worktree (o `\i` é relativo ao CWD):

```bash
psql postgresql://postgres:postgres@127.0.0.1:54422/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/80_popup_triggers.sql
```

Expected: FAIL com `column "trigger" of relation "global_popups" does not exist`.

Se o stack local não puder subir de jeito nenhum, registre isso no commit e siga: a suíte é gated no CI (`entitlement-tests`).

- [ ] **Step 3: Escrever a migration**

Crie `supabase/migrations/20260911000001_popup_triggers.sql`:

```sql
-- Gatilhos de popup por situacao de cobranca + frequencia diaria
-- (spec docs/superpowers/specs/2026-09-06-popup-triggers-design.md).
--
-- O gatilho e uma condicao lida na hora, na policy de SELECT, como o targeting por
-- plano: quando a assinatura sai da situacao, o popup some sozinho. Nada e criado
-- ou arquivado por evento (ver o comentario do DunningBanner no CRM).

alter table global_popups
  add column trigger text,
  add column trigger_days int;

alter table global_popups
  add constraint global_popups_trigger_check
    check (trigger is null or trigger in ('payment_pending', 'trial_ending', 'plan_downgraded')),
  -- coalesce obrigatorio: com trigger NULL, `trigger = 'trial_ending'` e NULL e
  -- `NULL = true` e NULL, que passa no CHECK. Sem ele, trigger NULL com
  -- trigger_days preenchido seria aceito.
  add constraint global_popups_trigger_days_check
    check (coalesce(trigger = 'trial_ending', false) = (trigger_days is not null)),
  add constraint global_popups_trigger_days_range_check
    check (trigger_days is null or trigger_days between 1 and 60);

alter table global_popups drop constraint global_popups_frequency_check;
alter table global_popups
  add constraint global_popups_frequency_check
    check (frequency in ('once', 'until_cta', 'daily'));
-- global_popups_ack_frequency_check (not (require_ack and frequency = 'until_cta'))
-- fica como esta: daily combina com confirmacao obrigatoria.

-- Sem parametro de usuario: le auth.uid() por dentro, entao via /rpc um usuario so
-- consegue perguntar sobre si mesmo. Dono resolvido por workspace_members, a mesma
-- regra da policy workspace_subscriptions_owner_read (20260804000001); o papel
-- global em profiles.role esta errado para isso.
create or replace function popup_trigger_matches(p_trigger text, p_days int)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when p_trigger is null then true
    else coalesce((
      select case p_trigger
        when 'payment_pending' then s.status = 'past_due'
        when 'trial_ending' then
          s.status = 'trialing'
          and s.current_period_end is not null
          and s.current_period_end > now()
          and s.current_period_end <= now() + make_interval(days => p_days)
        when 'plan_downgraded' then s.status = 'unpaid'
        else false
      end
      from profiles pr
      join workspace_members wm
        on wm.workspace_id = pr.conta_id
       and wm.user_id = pr.id
       and wm.role = 'owner'
      join workspace_subscriptions s on s.workspace_id = pr.conta_id
      where pr.id = auth.uid()
    ), false)
  end
$$;

-- Funcoes nascem executaveis por PUBLIC; security definer exige fechar isso.
revoke all on function popup_trigger_matches(text, int) from public;
grant execute on function popup_trigger_matches(text, int) to authenticated;

drop policy "Authenticated users can read active popups matching their workspace" on global_popups;
create policy "Authenticated users can read active popups matching their workspace"
  on global_popups for select to authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and popup_trigger_matches(trigger, trigger_days)
    and (
      target_mode = 'all'
      or (
        target_mode = 'plan'
        and resolve_workspace_plan(
          (select conta_id from profiles where id = auth.uid())
        ) = any(target_plan_ids)
      )
      or (
        target_mode = 'workspace'
        and (select conta_id from profiles where id = auth.uid()) = any(target_workspace_ids)
      )
    )
  );
```

- [ ] **Step 4: Aplicar a migration no stack local e rodar a suíte até passar**

```bash
npx supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54422/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/80_popup_triggers.sql
```

Expected: sem saída de erro (o script termina em `rollback`). Depois rode a suíte inteira para garantir que a 77 continua verde:

```bash
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres bash scripts/test-entitlements.sh 2>&1 | grep -E "^(PASS|FAIL)" | grep -E "77_|80_"
```

Expected: `PASS .../77_global_popups.sql` e `PASS .../80_popup_triggers.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260911000001_popup_triggers.sql supabase/tests/entitlements/80_popup_triggers.sql
git commit -m "feat(popups): colunas trigger/trigger_days, popup_trigger_matches e frequência daily

Gatilho avaliado na policy de SELECT via função security definer que só
responde pelo próprio usuário e exige owner em workspace_members. Suíte psql 80.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Deixe o stack local de pé para a Task 8; se precisar derrubar antes, `npx supabase stop --no-backup` e `mv supabase/config.toml.bak supabase/config.toml`.

---

### Task 2: Validação e normalização em `_shared/admin-popups.ts`

**Files:**
- Modify: `supabase/functions/_shared/admin-popups.ts`
- Test: `supabase/functions/__tests__/admin-popups_test.ts`

**Interfaces:**
- Produces: `POPUP_COLUMNS` com `"trigger"` e `"trigger_days"`; `export const POPUP_TRIGGERS = ["payment_pending", "trial_ending", "plan_downgraded"] as const`; `export type PopupTrigger`; `validatePopupFields(row)` aceitando `frequency = "daily"` e validando gatilho/dias; `export function normalizePopupTrigger(update: Record<string, unknown>, current?: Record<string, unknown>): Record<string, unknown>`.

- [ ] **Step 1: Escrever os testes (falham)**

Acrescente ao final de `supabase/functions/__tests__/admin-popups_test.ts`, e troque a linha de import por:

```ts
import { assert, assertEquals } from "./assert.ts";
import { newImageKeys, normalizePopupTrigger, validatePopupFields } from "../_shared/admin-popups.ts";
```

Testes novos:

```ts
const BASE = {
  cta_label: null, cta_url: null, secondary_label: null,
  frequency: "once", require_ack: false, target_mode: "all",
};

Deno.test("validatePopupFields: gatilho (enum ou nulo) e trigger_days só com trial_ending, 1..60 inteiro", () => {
  assertEquals(validatePopupFields({ ...BASE, trigger: null }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "payment_pending" }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "plan_downgraded" }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 3 }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 1 }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 60 }), null);
  assert(validatePopupFields({ ...BASE, trigger: "bogus" }) !== null, "trigger inválido");
  assert(validatePopupFields({ ...BASE, trigger: "" }) !== null, "trigger vazio sem normalizar");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending" }) !== null, "trial_ending sem dias");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: null }) !== null, "trial_ending com dias null");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 0 }) !== null, "0 dias");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 61 }) !== null, "61 dias");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 2.5 }) !== null, "dias fracionário");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: "3" }) !== null, "dias como string");
  assert(validatePopupFields({ ...BASE, trigger: "payment_pending", trigger_days: 3 }) !== null, "dias fora de trial_ending");
  assert(validatePopupFields({ ...BASE, trigger_days: 3 }) !== null, "dias sem gatilho");
});

Deno.test("validatePopupFields: frequency daily, com e sem require_ack; until_cta + require_ack segue proibido", () => {
  assertEquals(validatePopupFields({ ...BASE, frequency: "daily" }), null);
  assertEquals(validatePopupFields({ ...BASE, frequency: "daily", require_ack: true }), null);
  assert(
    validatePopupFields({ ...BASE, frequency: "until_cta", cta_label: "Ver", cta_url: "/x", require_ack: true }) !== null,
    "require_ack + until_cta",
  );
});

Deno.test("normalizePopupTrigger: decide sobre a linha mesclada e só emite o que muda", () => {
  // create (sem current)
  assertEquals(normalizePopupTrigger({ trigger: "payment_pending", trigger_days: 3 }), { trigger: "payment_pending", trigger_days: null });
  assertEquals(normalizePopupTrigger({ trigger: "trial_ending", trigger_days: 3 }), { trigger: "trial_ending", trigger_days: 3 });
  assertEquals(normalizePopupTrigger({ trigger: "" }), { trigger: null });
  assertEquals(normalizePopupTrigger({ cta_label: "x" }), { cta_label: "x" });
  assertEquals(normalizePopupTrigger({}), {});
  // update: patch que nao toca no gatilho sai intacto (senao a CHECK derruba a edicao)
  const current = { id: "p1", trigger: "trial_ending", trigger_days: 5 };
  assertEquals(normalizePopupTrigger({ cta_label: "novo" }, current), { cta_label: "novo" });
  assertEquals(normalizePopupTrigger({ status: "active" }, current), { status: "active" });
  // update: troca de gatilho sem mandar dias zera os dias persistidos
  assertEquals(normalizePopupTrigger({ trigger: "payment_pending" }, current), { trigger: "payment_pending", trigger_days: null });
  assertEquals(normalizePopupTrigger({ trigger: null }, current), { trigger: null, trigger_days: null });
  assertEquals(normalizePopupTrigger({ trigger: "" }, current), { trigger: null, trigger_days: null });
  // update: dias novos com trial_ending mantido passam
  assertEquals(normalizePopupTrigger({ trigger_days: 7 }, current), { trigger_days: 7 });
  // update em popup sem gatilho: nada a emitir
  assertEquals(normalizePopupTrigger({ cta_label: "x" }, { trigger: null, trigger_days: null }), { cta_label: "x" });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/admin-popups_test.ts
```

Expected: FAIL (`normalizePopupTrigger` não exportada; `frequency daily` devolve "invalid frequency").

- [ ] **Step 3: Implementar**

Em `supabase/functions/_shared/admin-popups.ts`:

`POPUP_COLUMNS` passa a:

```ts
export const POPUP_COLUMNS = [
  "pages", "cta_label", "cta_url", "cta_style", "secondary_label", "frequency",
  "require_ack", "target_mode", "target_plan_ids", "target_workspace_ids",
  "starts_at", "ends_at", "status", "trigger", "trigger_days",
] as const;

export const POPUP_TRIGGERS = ["payment_pending", "trial_ending", "plan_downgraded"] as const;
export type PopupTrigger = (typeof POPUP_TRIGGERS)[number];
export const MAX_TRIGGER_DAYS = 60;
```

Em `validatePopupFields`, troque a checagem de `frequency`:

```ts
  const frequency = row.frequency ?? "once";
  if (frequency !== "once" && frequency !== "until_cta" && frequency !== "daily") return "invalid frequency";
```

e acrescente, logo antes do bloco `// Targeting:` :

```ts
  // Gatilho (spec 2026-09-06): enum ou nulo; trigger_days so com trial_ending, inteiro 1..60.
  // Chega aqui ja normalizado por normalizePopupTrigger ("" -> null, dias zerados fora
  // de trial_ending); o que sobrar de errado e erro do chamador, 400.
  const trigger = row.trigger ?? null;
  if (trigger !== null && !(POPUP_TRIGGERS as readonly unknown[]).includes(trigger)) return "invalid trigger";
  const days = row.trigger_days ?? null;
  if (trigger === "trial_ending") {
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_TRIGGER_DAYS) {
      return `trial_ending needs trigger_days between 1 and ${MAX_TRIGGER_DAYS}`;
    }
  } else if (days !== null) {
    return "trigger_days only applies to trial_ending";
  }
```

Função nova, logo depois de `normalizePopupText`:

```ts
/** Decide sobre a linha MESCLADA (atual + patch) e devolve o patch com no maximo duas
 * mudancas: `trigger: ""` vira null; `trigger_days: null` e emitido SOMENTE quando a
 * linha mesclada tem gatilho diferente de trial_ending e dias preenchidos. Um patch que
 * nao toca no gatilho sai intacto: injetar trigger_days = null numa edicao de titulo de
 * um popup trial_ending cairia no CHECK global_popups_trigger_days_check como 500. */
export function normalizePopupTrigger(
  update: Record<string, unknown>,
  current?: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...update };
  if (out.trigger === "") out.trigger = null;
  const merged = { ...(current ?? {}), ...out };
  const trigger = merged.trigger ?? null;
  const days = merged.trigger_days ?? null;
  if (trigger !== "trial_ending" && days !== null) out.trigger_days = null;
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/admin-popups_test.ts
git checkout deno.lock
```

Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/admin-popups.ts supabase/functions/__tests__/admin-popups_test.ts
git commit -m "feat(popups): validação de trigger/trigger_days e frequency daily no módulo compartilhado

normalizePopupTrigger decide sobre a linha mesclada e só emite trigger_days
quando a troca de gatilho exige, para uma edição trivial de um popup
trial_ending não cair no CHECK.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: platform-admin, mcp-admin e schema da ferramenta MCP

**Files:**
- Modify: `supabase/functions/platform-admin/popups.ts` (import na linha 4-7; `handleCreatePopup` linha ~71; `handleUpdatePopup` linhas ~90-129)
- Modify: `supabase/functions/mcp-admin/queries.ts` (import linha ~7; `createPopup` linha ~142-150; `updatePopup` linha ~152-167)
- Modify: `supabase/functions/mcp-admin/tools.ts` (`POPUP_FIELDS`, linhas ~95-108)
- Test: `supabase/functions/__tests__/platform-admin-popups_test.ts`, `supabase/functions/__tests__/mcp-admin-popups_test.ts`, `supabase/functions/__tests__/mcp-admin-tools_test.ts`

**Interfaces:**
- Consumes: `normalizePopupTrigger(update, current?)` e `POPUP_COLUMNS` da Task 2.
- Produces: `create-popup`/`update-popup` (HTTP) e `create_popup`/`update_popup` (MCP) persistem `trigger` e `trigger_days`; schema zod aceita `trigger` (enum ou null), `trigger_days` (int 1..60 ou null) e `frequency: "daily"`.

- [ ] **Step 1: Testes do platform-admin (falham)**

Acrescente ao final de `supabase/functions/__tests__/platform-admin-popups_test.ts`:

```ts
Deno.test("create-popup: persiste trigger e zera trigger_days fora de trial_ending; trial_ending sem dias é 400", async () => {
  const { db, calls } = makeFakeDb({ global_popups: [{ data: ROW, error: null }] });
  const r = await handleCreatePopup(
    db,
    { action: "create-popup", pages: PAGES, target_mode: "all", trigger: "payment_pending", trigger_days: 3, frequency: "daily" },
    { adminId: "adm", userId: "u1" },
    H,
  );
  assertEquals(r.status, 201);
  const payload = lastPayload(calls, "global_popups", "insert")!;
  assertEquals(payload.trigger, "payment_pending");
  assertEquals(payload.trigger_days, null);
  assertEquals(payload.frequency, "daily");

  const bad = await handleCreatePopup(
    makeFakeDb({}).db,
    { action: "create-popup", pages: PAGES, target_mode: "all", trigger: "trial_ending" },
    { adminId: "adm", userId: "u1" },
    H,
  );
  assertEquals(bad.status, 400);
  assertEquals((await bad.json()).error, "Invalid popup");
});

Deno.test("update-popup: edição que não toca no gatilho não injeta trigger_days; troca de gatilho zera os dias", async () => {
  const current = { ...ROW, trigger: "trial_ending", trigger_days: 5 };
  const { db, calls } = makeFakeDb({
    global_popups: [{ data: current, error: null }, { data: { ...current, cta_label: "Ver", cta_url: "/x" }, error: null }],
  });
  let r = await handleUpdatePopup(
    db, { action: "update-popup", popup_id: "p1", cta_label: "Ver", cta_url: "/x" }, { userId: "u1" }, H,
  );
  assertEquals(r.status, 200);
  const edit = lastPayload(calls, "global_popups", "update")!;
  assertEquals("trigger_days" in edit, false);
  assertEquals("trigger" in edit, false);

  const { db: db2, calls: calls2 } = makeFakeDb({
    global_popups: [{ data: current, error: null }, { data: { ...current, trigger: "payment_pending", trigger_days: null }, error: null }],
  });
  r = await handleUpdatePopup(db2, { action: "update-popup", popup_id: "p1", trigger: "payment_pending" }, { userId: "u1" }, H);
  assertEquals(r.status, 200);
  const swap = lastPayload(calls2, "global_popups", "update")!;
  assertEquals(swap.trigger, "payment_pending");
  assertEquals(swap.trigger_days, null);

  // trial_ending sem dias sobre popup sem gatilho: 400, nao 500
  r = await handleUpdatePopup(
    makeFakeDb({ global_popups: [{ data: ROW, error: null }] }).db,
    { action: "update-popup", popup_id: "p1", trigger: "trial_ending" }, { userId: "u1" }, H,
  );
  assertEquals(r.status, 400);
});
```

- [ ] **Step 2: Testes do mcp-admin (falham)**

Acrescente ao final de `supabase/functions/__tests__/mcp-admin-popups_test.ts`:

```ts
Deno.test("createPopup/updatePopup: gatilho passa pela allowlist e pela normalização dos dias", async () => {
  const { db, calls } = makeFakeDb({ global_popups: [{ data: { id: "p9", status: "draft" }, error: null }] });
  await createPopup(makeDeps(db), {
    pages: [{ title: "T", body: "B" }], target_mode: "all", trigger: "trial_ending", trigger_days: 3, frequency: "daily",
  });
  const ins = insertPayload(calls, "global_popups")!;
  assertEquals(ins.trigger, "trial_ending");
  assertEquals(ins.trigger_days, 3);
  assertEquals(ins.frequency, "daily");
  await expectInputError(
    () => createPopup(makeDeps(db), { pages: [{ title: "T", body: "B" }], target_mode: "all", trigger: "trial_ending" }),
    "trigger_days",
  );

  const current = { ...ROW, trigger: "trial_ending", trigger_days: 5 };
  const { db: db2, calls: calls2 } = makeFakeDb({
    global_popups: [{ data: current, error: null }, { data: { id: "p1", status: "draft" }, error: null }],
  });
  await updatePopup(makeDeps(db2), { popup_id: "p1", trigger: "payment_pending" });
  assertEquals(updatePayload(calls2, "global_popups")!.trigger_days, null);

  const { db: db3, calls: calls3 } = makeFakeDb({
    global_popups: [{ data: current, error: null }, { data: { id: "p1", status: "draft" }, error: null }],
  });
  await updatePopup(makeDeps(db3), { popup_id: "p1", cta_label: "Ver", cta_url: "/x" });
  assertEquals("trigger_days" in updatePayload(calls3, "global_popups")!, false);
});
```

E ao final de `supabase/functions/__tests__/mcp-admin-tools_test.ts` (acrescente `import { z } from "npm:zod@3";` no topo):

```ts
/** Servidor fake que guarda o shape zod de cada tool (o captureTools acima descarta). */
function captureShapes(deps: ReturnType<typeof makeDeps>) {
  const shapes = new Map<string, z.ZodRawShape>();
  const server = { tool: (name: string, _desc: string, shape: z.ZodRawShape, _cb: unknown) => shapes.set(name, shape) };
  registerTools(server, deps);
  return shapes;
}

Deno.test("create_popup/update_popup: schema aceita trigger, trigger_days e frequency daily; rejeita fora do enum e da faixa", () => {
  const shapes = captureShapes(makeDeps(makeFakeDb({}).db));
  const create = z.object(shapes.get("create_popup")!);
  const pages = [{ title: "T", body: "B" }];
  assertEquals(create.safeParse({ pages, target_mode: "all", trigger: "trial_ending", trigger_days: 3, frequency: "daily" }).success, true);
  assertEquals(create.safeParse({ pages, target_mode: "all", trigger: null, trigger_days: null }).success, true);
  assertEquals(create.safeParse({ pages, target_mode: "all", trigger: "bogus" }).success, false);
  assertEquals(create.safeParse({ pages, target_mode: "all", trigger_days: 61 }).success, false);
  assertEquals(create.safeParse({ pages, target_mode: "all", trigger_days: 0 }).success, false);
  assertEquals(create.safeParse({ pages, target_mode: "all", trigger_days: 2.5 }).success, false);
  assertEquals(create.safeParse({ pages, target_mode: "all", frequency: "weekly" }).success, false);
  const update = z.object(shapes.get("update_popup")!);
  assertEquals(update.safeParse({ popup_id: "11111111-1111-1111-1111-111111111111", trigger: "payment_pending" }).success, true);
});
```

- [ ] **Step 3: Rodar os três arquivos e ver falhar**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-popups_test.ts supabase/functions/__tests__/mcp-admin-popups_test.ts supabase/functions/__tests__/mcp-admin-tools_test.ts
```

Expected: FAIL nos testes novos (`trigger_days` chega como 3 no insert; schema recusa `trigger`).

- [ ] **Step 4: Implementar no platform-admin**

`supabase/functions/platform-admin/popups.ts`, import:

```ts
import {
  adminContaId, normalizePopupText, normalizePopupTrigger, pagesHaveImages, persistedImageKeys,
  pickPopupColumns, validatePages, validatePopupFields,
} from "../_shared/admin-popups.ts";
```

Em `handleCreatePopup`, a linha do `insert`:

```ts
  const insert = normalizePopupTrigger(
    normalizePopupText({ ...pickPopupColumns(body), pages: pages.pages, created_by: actor.adminId }),
  );
```

Em `handleUpdatePopup`, depois do bloco `if (update.pages !== undefined) { ... }` e antes do `validatePopupFields`, substitua o trecho final por:

```ts
  // Regras cruzadas valem sobre a linha resultante, nao so sobre o patch. A normalizacao
  // do gatilho tambem: ela le a linha mesclada e so emite trigger_days quando muda.
  const patch = normalizePopupTrigger(update, current as Record<string, unknown>);
  const fieldError = validatePopupFields({ ...(current as Record<string, unknown>), ...patch });
  if (fieldError) {
    console.error("[popups] update rejected:", fieldError);
    return json({ error: "Invalid popup" }, 400, headers);
  }

  const { data, error } = await svc
    .from("global_popups").update(patch).eq("id", popupId).select().single();
  if (error) throw error;
  return json({ popup: data }, 200, headers);
```

- [ ] **Step 5: Implementar no mcp-admin**

`supabase/functions/mcp-admin/queries.ts`: acrescente `normalizePopupTrigger` ao import de `../_shared/admin-popups.ts`. Em `createPopup`:

```ts
  const insert = normalizePopupTrigger(
    normalizePopupText({ ...pickPopupColumns(args), pages, created_by: d.ctx.admin_id }),
  );
```

Em `updatePopup`, troque as três linhas finais (validação + update) por:

```ts
  const patch = normalizePopupTrigger(update, current as Record<string, unknown>);
  const err = validatePopupFields({ ...(current as Record<string, unknown>), ...patch });
  if (err) throw new McpInputError(err);
  const { data, error } = await d.db.from("global_popups").update(patch).eq("id", id).select("id, status").single();
  if (error) throw error;
  return { id: data.id as string, status: data.status as string };
```

`supabase/functions/mcp-admin/tools.ts`: acima de `POPUP_PAGE` acrescente

```ts
const POPUP_TRIGGER = z.enum(["payment_pending", "trial_ending", "plan_downgraded"]);
```

e em `POPUP_FIELDS` troque a linha `frequency` e acrescente as duas novas:

```ts
  frequency: z.enum(["once", "until_cta", "daily"]).optional()
    .describe("once = some após fechar; until_cta = volta toda sessão até o CTA; daily = no máximo uma vez por dia enquanto elegível"),
  trigger: POPUP_TRIGGER.nullable().optional()
    .describe("Gatilho por situação de cobrança: só o dono do workspace vê, e só enquanto a condição valer. payment_pending = assinatura em past_due; trial_ending = teste terminando em trigger_days dias; plan_downgraded = assinatura unpaid (plano voltou ao padrão). null remove"),
  trigger_days: z.number().int().min(1).max(60).nullable().optional()
    .describe("Dias antes do fim do teste. Obrigatório com trial_ending, nulo nos demais"),
```

- [ ] **Step 6: Rodar e ver passar, mais o typecheck Deno**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-popups_test.ts supabase/functions/__tests__/mcp-admin-popups_test.ts supabase/functions/__tests__/mcp-admin-tools_test.ts supabase/functions/__tests__/admin-popups_test.ts
npm run check:functions
git checkout deno.lock
```

Expected: PASS em todos; `check:functions` sem erro.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/platform-admin/popups.ts supabase/functions/mcp-admin/queries.ts supabase/functions/mcp-admin/tools.ts supabase/functions/__tests__/platform-admin-popups_test.ts supabase/functions/__tests__/mcp-admin-popups_test.ts supabase/functions/__tests__/mcp-admin-tools_test.ts
git commit -m "feat(popups): trigger e trigger_days no platform-admin e na MCP do admin

Normalização sobre a linha mesclada nos dois updates; schema zod com os
três gatilhos, dias 1..60 e frequency daily.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Admin: tipo e modelo do formulário

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (interface `GlobalPopup`, linhas ~582-601)
- Modify: `apps/admin/src/pages/popup-form.ts`
- Test: `apps/admin/src/pages/__tests__/popup-form.test.ts`

**Interfaces:**
- Produces (em `lib/api.ts`): `export type PopupTrigger = 'payment_pending' | 'trial_ending' | 'plan_downgraded'`, `export type PopupFrequency = 'once' | 'until_cta' | 'daily'`, `GlobalPopup.frequency: PopupFrequency`, `GlobalPopup.trigger: PopupTrigger | null`, `GlobalPopup.trigger_days: number | null`.
- Produces (em `popup-form.ts`): `PopupFormState.trigger: '' | PopupTrigger`, `PopupFormState.trigger_days: string`, `PopupFormErrors.trigger?: string`, `MAX_TRIGGER_DAYS = 60`, `DEFAULT_TRIGGER_DAYS = '3'`, `TRIGGER_LABEL: Record<PopupTrigger, string>`, `FREQUENCY_LABEL: Record<PopupFrequency, string>`, `triggerChipLabel(trigger: PopupTrigger | null, days: number | null): string | null`.

- [ ] **Step 1: Testes (falham)**

Em `apps/admin/src/pages/__tests__/popup-form.test.ts`, acrescente ao fixture `popup` as duas linhas `trigger: null,` e `trigger_days: null,` (depois de `require_ack: false,`), amplie o import:

```ts
import {
  DEFAULT_TRIGGER_DAYS,
  FREQUENCY_LABEL,
  MAX_PAGES,
  addPage,
  emptyForm,
  formToPayload,
  movePage,
  newPage,
  pageHasContent,
  popupToForm,
  removePage,
  triggerChipLabel,
  validateForm,
  withRequireAck,
} from '../popup-form';
```

e acrescente ao final do arquivo:

```ts
describe('gatilho e frequência diária', () => {
  it('payload: sem gatilho manda null/null; trial_ending manda os dias como número; outros zeram os dias', () => {
    const f = emptyForm();
    expect(formToPayload(f)).toMatchObject({ trigger: null, trigger_days: null });
    expect(formToPayload({ ...f, trigger: 'trial_ending', trigger_days: '7' })).toMatchObject({
      trigger: 'trial_ending',
      trigger_days: 7,
    });
    expect(formToPayload({ ...f, trigger: 'payment_pending', trigger_days: '7' })).toMatchObject({
      trigger: 'payment_pending',
      trigger_days: null,
    });
    expect(formToPayload({ ...f, frequency: 'daily' }).frequency).toBe('daily');
  });

  it('popupToForm carrega gatilho e dias; sem dias usa o padrão', () => {
    expect(popupToForm({ ...popup, trigger: 'trial_ending', trigger_days: 10 })).toMatchObject({
      trigger: 'trial_ending',
      trigger_days: '10',
    });
    expect(popupToForm(popup)).toMatchObject({ trigger: '', trigger_days: DEFAULT_TRIGGER_DAYS });
    expect(popupToForm({ ...popup, frequency: 'daily' }).frequency).toBe('daily');
  });

  it('validateForm exige 1..60 dias inteiros só com trial_ending', () => {
    const base = { ...emptyForm(), pages: [{ ...newPage(), title: 'T', body: 'B' }] };
    expect(validateForm({ ...base, trigger: 'trial_ending', trigger_days: '3' })).toBeNull();
    expect(validateForm({ ...base, trigger: 'trial_ending', trigger_days: '60' })).toBeNull();
    expect(validateForm({ ...base, trigger: 'trial_ending', trigger_days: '0' })?.trigger).toBe(
      'Informe de 1 a 60 dias',
    );
    expect(validateForm({ ...base, trigger: 'trial_ending', trigger_days: '61' })?.trigger).toBeDefined();
    expect(validateForm({ ...base, trigger: 'trial_ending', trigger_days: 'abc' })?.trigger).toBeDefined();
    expect(validateForm({ ...base, trigger: 'trial_ending', trigger_days: '2.5' })?.trigger).toBeDefined();
    expect(validateForm({ ...base, trigger: 'trial_ending', trigger_days: '' })?.trigger).toBeDefined();
    expect(validateForm({ ...base, trigger: 'payment_pending', trigger_days: 'abc' })).toBeNull();
    expect(validateForm({ ...base, trigger: '', trigger_days: 'abc' })).toBeNull();
  });

  it('withRequireAck converte until_cta em once e preserva daily', () => {
    const f = emptyForm();
    expect(withRequireAck({ ...f, frequency: 'until_cta' }, true).frequency).toBe('once');
    expect(withRequireAck({ ...f, frequency: 'daily' }, true).frequency).toBe('daily');
    expect(withRequireAck({ ...f, frequency: 'once' }, true).frequency).toBe('once');
    expect(withRequireAck({ ...f, frequency: 'daily' }, false).frequency).toBe('daily');
    expect(withRequireAck({ ...f, frequency: 'until_cta' }, false).frequency).toBe('until_cta');
  });

  it('rótulos da lista', () => {
    expect(triggerChipLabel(null, null)).toBeNull();
    expect(triggerChipLabel('payment_pending', null)).toBe('Pagamento pendente');
    expect(triggerChipLabel('trial_ending', 1)).toBe('Teste em 1 dia');
    expect(triggerChipLabel('trial_ending', 3)).toBe('Teste em 3 dias');
    expect(triggerChipLabel('plan_downgraded', null)).toBe('Plano rebaixado');
    expect(FREQUENCY_LABEL).toEqual({ once: 'Uma vez', until_cta: 'Até o CTA', daily: 'Uma vez por dia' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/admin/src/pages/__tests__/popup-form.test.ts
```

Expected: FAIL (exports ausentes, `trigger` indefinido no payload).

- [ ] **Step 3: Implementar o tipo**

`apps/admin/src/lib/api.ts`, acima de `export interface GlobalPopup`:

```ts
export type PopupTrigger = 'payment_pending' | 'trial_ending' | 'plan_downgraded';
export type PopupFrequency = 'once' | 'until_cta' | 'daily';
```

e dentro da interface troque `frequency: 'once' | 'until_cta';` por `frequency: PopupFrequency;` e acrescente, depois de `require_ack: boolean;`:

```ts
  /** Gatilho por situação de cobrança (spec 2026-09-06). Nulo = popup comum. */
  trigger: PopupTrigger | null;
  /** Só com trial_ending: dias antes do fim do teste (1 a 60). */
  trigger_days: number | null;
```

- [ ] **Step 4: Implementar o modelo do formulário**

`apps/admin/src/pages/popup-form.ts`: import vira `import type { GlobalPopup, PopupFrequency, PopupTrigger } from '../lib/api';`. Constantes novas, depois de `const CTA_URL_RE`:

```ts
export const MAX_TRIGGER_DAYS = 60;
export const DEFAULT_TRIGGER_DAYS = '3';
export const TRIGGER_LABEL: Record<PopupTrigger, string> = {
  payment_pending: 'Pagamento pendente',
  trial_ending: 'Teste terminando',
  plan_downgraded: 'Plano rebaixado por inadimplência',
};
export const FREQUENCY_LABEL: Record<PopupFrequency, string> = {
  once: 'Uma vez',
  until_cta: 'Até o CTA',
  daily: 'Uma vez por dia',
};

/** Chip da lista ao lado do público. Nulo sem gatilho. */
export function triggerChipLabel(trigger: PopupTrigger | null, days: number | null): string | null {
  if (!trigger) return null;
  if (trigger === 'trial_ending') return `Teste em ${days ?? '?'} ${days === 1 ? 'dia' : 'dias'}`;
  return trigger === 'payment_pending' ? 'Pagamento pendente' : 'Plano rebaixado';
}
```

`PopupFormState`: `frequency: PopupFrequency;` e, depois de `require_ack: boolean;`:

```ts
  /** '' = sem gatilho. */
  trigger: '' | PopupTrigger;
  /** Valor cru do input numérico; só vai ao payload com trial_ending. */
  trigger_days: string;
```

`PopupFormErrors`: acrescente `trigger?: string;` depois de `target?: string;`.

`emptyForm()`: acrescente `trigger: '',` e `trigger_days: DEFAULT_TRIGGER_DAYS,` depois de `require_ack: false,`.

`popupToForm(p)`: depois de `require_ack: p.require_ack,`:

```ts
    trigger: p.trigger ?? '',
    trigger_days: p.trigger_days != null ? String(p.trigger_days) : DEFAULT_TRIGGER_DAYS,
```

`formToPayload(f)`: depois de `require_ack: f.require_ack,`:

```ts
    trigger: f.trigger || null,
    trigger_days: f.trigger === 'trial_ending' ? parseInt(f.trigger_days, 10) : null,
```

`validateForm(f)`: antes do bloco `if (f.target_mode === 'plan' ...`:

```ts
  if (f.trigger === 'trial_ending') {
    const raw = f.trigger_days.trim();
    const days = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > MAX_TRIGGER_DAYS) {
      errors.trigger = `Informe de 1 a ${MAX_TRIGGER_DAYS} dias`;
      any = true;
    }
  }
```

`withRequireAck`: o corpo vira

```ts
  return {
    ...f,
    require_ack: on,
    // Só "Até o CTA" é incompatível com confirmação obrigatória; "Uma vez por dia" fica.
    frequency: on && f.frequency === 'until_cta' ? 'once' : f.frequency,
  };
```

- [ ] **Step 5: Rodar, formatar, typecheck**

```bash
npm run format
npx vitest run apps/admin/src/pages/__tests__/popup-form.test.ts
npx tsc -p apps/admin/tsconfig.json --noEmit
```

Expected: PASS; tsc sem erro (o `PopupsPage.test.tsx` usa fixture `as never`, então não quebra aqui).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/pages/popup-form.ts apps/admin/src/pages/__tests__/popup-form.test.ts
git commit -m "feat(admin): modelo do formulário de popup com gatilho, dias e frequência diária

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Admin: editor e lista

**Files:**
- Modify: `apps/admin/src/pages/PopupsPage.tsx` (imports linhas ~1-35; `frequencyLabel` linha ~149; coluna Público linha ~244; bloco Frequência linhas ~673-699; depois do `TargetPicker` linha ~711-723)
- Test: `apps/admin/src/pages/__tests__/PopupsPage.test.tsx`

**Interfaces:**
- Consumes: `FREQUENCY_LABEL`, `TRIGGER_LABEL`, `MAX_TRIGGER_DAYS`, `triggerChipLabel`, `PopupFormState` (Task 4); `PopupTrigger` de `lib/api`.

- [ ] **Step 1: Testes (falham)**

Em `apps/admin/src/pages/__tests__/PopupsPage.test.tsx`, acrescente `trigger: null,` e `trigger_days: null,` ao fixture `popup` (depois de `require_ack: true,`). No `describe('PopupsPage lista')` acrescente:

```tsx
  it('mostra "Uma vez por dia" e o chip do gatilho ao lado do público', async () => {
    vi.mocked(listPopups).mockResolvedValue({
      popups: [
        { ...popup, frequency: 'daily', require_ack: false, trigger: 'payment_pending', trigger_days: null },
        { ...popup, id: 'p2', frequency: 'once', require_ack: false, trigger: 'trial_ending', trigger_days: 3 },
      ],
    } as never);
    renderPage();
    expect(await screen.findByText('Uma vez por dia')).toBeInTheDocument();
    expect(screen.getByText('Pagamento pendente')).toBeInTheDocument();
    expect(screen.getByText('Teste em 3 dias')).toBeInTheDocument();
  });
```

No `describe('PopupsPage editor')` acrescente:

```tsx
  it('gatilho: select, campo de dias só com "Teste terminando", erro inline e payload', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /Novo popup/ }));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'P' } });
    fireEvent.change(screen.getByLabelText('Corpo (Markdown)'), { target: { value: 'c' } });

    expect(screen.getByLabelText('Gatilho')).toHaveValue('');
    expect(screen.queryByLabelText('Dias antes do fim do teste')).toBeNull();
    expect(
      screen.getByText('Com gatilho, só o dono do workspace vê o popup, e só enquanto a condição valer.'),
    ).toBeInTheDocument();

    // O campo de dias só existe com "Teste terminando"; trocar o gatilho o esconde.
    fireEvent.change(screen.getByLabelText('Gatilho'), { target: { value: 'trial_ending' } });
    expect(screen.getByLabelText('Dias antes do fim do teste')).toHaveValue(3);
    fireEvent.change(screen.getByLabelText('Gatilho'), { target: { value: 'payment_pending' } });
    expect(screen.queryByLabelText('Dias antes do fim do teste')).toBeNull();
    fireEvent.change(screen.getByLabelText('Gatilho'), { target: { value: 'trial_ending' } });

    const days = screen.getByLabelText('Dias antes do fim do teste');
    fireEvent.change(days, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    expect(await screen.findByText('Informe de 1 a 60 dias')).toBeInTheDocument();
    expect(createPopup).not.toHaveBeenCalled();

    // O editor fecha ao criar com sucesso: nada mais é lido do formulário depois daqui.
    fireEvent.change(days, { target: { value: '7' } });
    fireEvent.click(screen.getByLabelText('Uma vez por dia'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(createPopup).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createPopup).mock.calls[0][0];
    expect(payload.trigger).toBe('trial_ending');
    expect(payload.trigger_days).toBe(7);
    expect(payload.frequency).toBe('daily');
  });

  it('confirmação obrigatória mantém "Uma vez por dia" e só desabilita "Até o CTA"', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /Novo popup/ }));
    fireEvent.click(screen.getByLabelText('Uma vez por dia'));
    fireEvent.click(screen.getByLabelText(/Exigir confirmação/));
    expect(screen.getByLabelText('Toda sessão até clicar no CTA')).toBeDisabled();
    expect(screen.getByLabelText('Uma vez por dia')).toBeChecked();
    expect(screen.getByLabelText('Uma vez por dia')).not.toBeDisabled();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/admin/src/pages/__tests__/PopupsPage.test.tsx
```

Expected: FAIL nos três testes novos (sem select "Gatilho", sem radio "Uma vez por dia", lista sem chip).

- [ ] **Step 3: Implementar**

`apps/admin/src/pages/PopupsPage.tsx`:

1. Imports. No import de `'../lib/api'` acrescente `type PopupTrigger` (o arquivo já importa `type GlobalPopup` dali). No import de `'./popup-form'` acrescente `FREQUENCY_LABEL`, `MAX_TRIGGER_DAYS`, `TRIGGER_LABEL`, `triggerChipLabel` e `type PopupFormState` (se ainda não estiver importado).

2. `frequencyLabel` vira:

```tsx
  const frequencyLabel = (p: GlobalPopup) =>
    `${FREQUENCY_LABEL[p.frequency] ?? p.frequency}${p.require_ack ? ' · confirmação' : ''}`;
```

3. Coluna Público na linha da lista (o `<span className="md:text-sm md:truncate">{targetLabel(p)}</span>`) vira:

```tsx
                  <span className="md:text-sm md:truncate">
                    {targetLabel(p)}
                    {triggerChipLabel(p.trigger, p.trigger_days) && (
                      <span className="ml-1.5 text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-sm bg-warning/15 text-warning whitespace-nowrap">
                        {triggerChipLabel(p.trigger, p.trigger_days)}
                      </span>
                    )}
                  </span>
```

4. Bloco Frequência: acrescente o terceiro radio depois do de `until_cta`, e a legenda depois do `</div>` dos radios (antes do `errors?.frequency`):

```tsx
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="frequency"
                    checked={form.frequency === 'daily'}
                    onChange={() => setForm((f) => ({ ...f, frequency: 'daily' }))}
                  />
                  Uma vez por dia
                </label>
```

```tsx
              <p className="text-xs text-dim-foreground mt-1">
                Uma vez por dia: abre no máximo uma vez por dia enquanto o popup estiver elegível.
              </p>
```

5. Bloco Gatilho, logo depois do `<div>` que envolve o `TargetPicker` (e antes do grid de agendamento):

```tsx
            <div>
              <label htmlFor="popup-trigger" className={LABEL}>
                Gatilho
              </label>
              <select
                id="popup-trigger"
                className={INPUT}
                value={form.trigger}
                onChange={(e) => {
                  const trigger = e.target.value as PopupFormState['trigger'];
                  setForm((f) => ({ ...f, trigger }));
                  setErrors(null);
                }}
              >
                <option value="">Nenhum</option>
                {(Object.keys(TRIGGER_LABEL) as PopupTrigger[]).map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-dim-foreground mt-1">
                Com gatilho, só o dono do workspace vê o popup, e só enquanto a condição valer.
              </p>
              {form.trigger === 'trial_ending' && (
                <div className="mt-3">
                  <label htmlFor="popup-trigger-days" className={LABEL}>
                    Dias antes do fim do teste
                  </label>
                  <input
                    id="popup-trigger-days"
                    type="number"
                    min={1}
                    max={MAX_TRIGGER_DAYS}
                    className={INPUT}
                    value={form.trigger_days}
                    onChange={(e) => {
                      const trigger_days = e.target.value;
                      setForm((f) => ({ ...f, trigger_days }));
                      setErrors(null);
                    }}
                  />
                </div>
              )}
              {errors?.trigger && <p className="text-xs text-destructive mt-1">{errors.trigger}</p>}
            </div>
```

- [ ] **Step 4: Rodar, formatar, typecheck**

```bash
npm run format
npx vitest run apps/admin/src/pages/__tests__/PopupsPage.test.tsx apps/admin/src/pages/__tests__/popup-form.test.ts
npx tsc -p apps/admin/tsconfig.json --noEmit
npm run lint
```

Expected: PASS; tsc e lint limpos.

- [ ] **Step 5: Conferir no browser (admin no stack local)**

Opcional se o stack local da Task 1 estiver de pé: `npm run dev:admin` com um `.env.local` na raiz apontando para `http://127.0.0.1:54421` + anon key do `supabase start`, logar com um platform admin local (auth user + linha em `platform_admins(user_id, email)`), abrir `/admin/popups`, "Novo popup", trocar o select "Gatilho" e ver o campo de dias aparecer só em "Teste terminando". Tire um screenshot do editor e outro da lista com o chip.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/pages/PopupsPage.tsx apps/admin/src/pages/__tests__/PopupsPage.test.tsx
git commit -m "feat(admin): bloco Gatilho no editor de popup, radio Uma vez por dia e chip na lista

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: CRM: store e `pickPopup`

**Files:**
- Modify: `apps/crm/src/store/popups.ts`
- Modify: `apps/crm/src/hooks/pickPopup.ts`
- Test: `apps/crm/src/store/__tests__/popups.test.ts`, `apps/crm/src/hooks/__tests__/pickPopup.test.ts`

**Interfaces:**
- Produces (store): `export type PopupTrigger`, `GlobalPopup.frequency: 'once' | 'until_cta' | 'daily'`, `GlobalPopup.trigger: PopupTrigger | null`, `PopupInteraction.created_at: string`; `getActivePopups` seleciona `trigger`; `getMyPopupInteractions` seleciona `created_at`.
- Produces (pickPopup): `export function sameLocalDay(a: Date, b: Date): boolean`, `export function isHiddenToday(popup, interactions, now: Date): boolean`, `pickPopup(popups, interactions, session, now: Date = new Date())`.

- [ ] **Step 1: Testes (falham)**

`apps/crm/src/store/__tests__/popups.test.ts`: acrescente `trigger: null,` ao fixture `good` (depois de `require_ack: false,`) e estes dois testes dentro do `describe`:

```ts
  it('getActivePopups seleciona trigger', async () => {
    const chain = selectReturning([good]);
    fromMock.mockReturnValue(chain);
    await getActivePopups();
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('trigger'));
  });

  it('getMyPopupInteractions seleciona created_at', async () => {
    const chain = selectReturning([{ popup_id: 'p1', action: 'seen', created_at: '2026-09-06T12:00:00Z' }]);
    fromMock.mockReturnValue(chain);
    expect(await getMyPopupInteractions()).toEqual([
      { popup_id: 'p1', action: 'seen', created_at: '2026-09-06T12:00:00Z' },
    ]);
    expect(chain.select).toHaveBeenCalledWith('popup_id, action, created_at');
  });
```

`apps/crm/src/hooks/__tests__/pickPopup.test.ts`: substitua o helper `ix`, acrescente `trigger: null,` ao fixture `popup()` (depois de `require_ack: false,`), amplie o import e acrescente os `describe` novos:

```ts
import { isHiddenForever, isHiddenToday, pickPopup, sameLocalDay } from '../pickPopup';
```

```ts
const ix = (
  popup_id: string,
  action: PopupInteraction['action'],
  created_at = '2026-09-01T00:00:00Z',
): PopupInteraction => ({ popup_id, action, created_at });
/** ISO de um instante LOCAL: os testes não podem depender do fuso da máquina. */
const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h, 0, 0).toISOString();
```

```ts
describe('daily', () => {
  const p = popup({ id: 'd', frequency: 'daily' });

  it('nunca some para sempre, mesmo com closed, cta ou ack', () => {
    expect(isHiddenForever(p, [ix('d', 'closed'), ix('d', 'cta'), ix('d', 'ack')])).toBe(false);
  });

  it('sameLocalDay compara ano, mês e dia locais', () => {
    expect(sameLocalDay(new Date(2026, 8, 6, 0, 1), new Date(2026, 8, 6, 23, 59))).toBe(true);
    expect(sameLocalDay(new Date(2026, 8, 6, 23, 59), new Date(2026, 8, 7, 0, 1))).toBe(false);
    expect(sameLocalDay(new Date(2026, 8, 6), new Date(2025, 8, 6))).toBe(false);
  });

  it('isHiddenToday: seen no mesmo dia local esconde; dia seguinte libera; closed não conta; só para daily', () => {
    const seen18 = ix('d', 'seen', at(2026, 8, 6, 18));
    expect(isHiddenToday(p, [seen18], new Date(2026, 8, 6, 23, 59))).toBe(true);
    expect(isHiddenToday(p, [seen18], new Date(2026, 8, 7, 0, 1))).toBe(false);
    expect(isHiddenToday(p, [ix('d', 'closed', at(2026, 8, 6, 18))], new Date(2026, 8, 6, 20))).toBe(false);
    expect(isHiddenToday(p, [ix('x', 'seen', at(2026, 8, 6, 18))], new Date(2026, 8, 6, 20))).toBe(false);
    const once = popup({ id: 'o' });
    expect(isHiddenToday(once, [ix('o', 'seen', at(2026, 8, 6, 18))], new Date(2026, 8, 6, 20))).toBe(false);
  });

  it('pickPopup com now: daily visto hoje é pulado; visto ontem volta', () => {
    const now = new Date(2026, 8, 6, 20);
    expect(pickPopup([p], [ix('d', 'seen', at(2026, 8, 6, 18))], session(), now)).toBeNull();
    expect(pickPopup([p], [ix('d', 'seen', at(2026, 8, 5, 18))], session(), now)?.id).toBe('d');
    // shownId de um daily já visto hoje também não volta (recarregar não reabre)
    expect(
      pickPopup([p], [ix('d', 'seen', at(2026, 8, 6, 18))], { ...session(), shownId: 'd' }, now),
    ).toBeNull();
  });
});

describe('prioridade do gatilho', () => {
  it('popup com gatilho vence popup comum mais recente; entre gatilhos, o mais recente; escondido cede', () => {
    const plain = popup({ id: 'plain', created_at: '2026-09-05T00:00:00Z' });
    const trig = popup({ id: 'trig', created_at: '2026-08-01T00:00:00Z', trigger: 'payment_pending' });
    const trig2 = popup({ id: 'trig2', created_at: '2026-08-15T00:00:00Z', trigger: 'trial_ending' });
    expect(pickPopup([plain, trig], [], session())?.id).toBe('trig');
    expect(pickPopup([plain, trig, trig2], [], session())?.id).toBe('trig2');
    expect(pickPopup([plain, trig], [ix('trig', 'closed')], session())?.id).toBe('plain');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/crm/src/hooks/__tests__/pickPopup.test.ts apps/crm/src/store/__tests__/popups.test.ts
```

Expected: FAIL (`isHiddenToday`/`sameLocalDay` ausentes; select sem `created_at`).

- [ ] **Step 3: Implementar o store**

`apps/crm/src/store/popups.ts`:

```ts
export type PopupTrigger = 'payment_pending' | 'trial_ending' | 'plan_downgraded';

export interface GlobalPopup {
  id: string;
  pages: PopupPage[];
  cta_label: string | null;
  cta_url: string | null;
  cta_style: 'ink' | 'brand';
  secondary_label: string | null;
  frequency: 'once' | 'until_cta' | 'daily';
  require_ack: boolean;
  /** A RLS já aplicou a condição; aqui só serve para prioridade e analytics. */
  trigger: PopupTrigger | null;
  created_at: string;
}

export type PopupAction = 'seen' | 'closed' | 'cta' | 'ack';

export interface PopupInteraction {
  popup_id: string;
  action: PopupAction;
  /** ISO; a regra "uma vez por dia" lê o dia-calendário local daqui. */
  created_at: string;
}

const COLUMNS =
  'id, pages, cta_label, cta_url, cta_style, secondary_label, frequency, require_ack, trigger, created_at';
```

e em `getMyPopupInteractions`: `.select('popup_id, action, created_at')`.

- [ ] **Step 4: Implementar `pickPopup`**

`apps/crm/src/hooks/pickPopup.ts` inteiro:

```ts
import type { GlobalPopup, PopupInteraction } from '../store/popups';
import type { PopupSession } from './popupSession';

/** Dia-calendário LOCAL do browser: é como se lê "uma vez por dia". Quem viu às 18h
 * vê de novo às 9h do dia seguinte; uma janela de 24h esperaria até as 18h. */
export function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** Tabela "Semântica de já viu" da spec: once esconde com qualquer interação que não
 * seja seen; until_cta só com cta ou ack; daily nunca esconde para sempre. */
export function isHiddenForever(popup: GlobalPopup, interactions: PopupInteraction[]): boolean {
  if (popup.frequency === 'daily') return false;
  const terminal: ReadonlySet<string> =
    popup.frequency === 'until_cta' ? new Set(['cta', 'ack']) : new Set(['closed', 'cta', 'ack']);
  return interactions.some((i) => i.popup_id === popup.id && terminal.has(i.action));
}

/** daily: já abriu hoje. A chave é o seen (gravado na abertura), então um popup aberto
 * e abandonado sem interação também conta como visto hoje. */
export function isHiddenToday(
  popup: GlobalPopup,
  interactions: PopupInteraction[],
  now: Date,
): boolean {
  if (popup.frequency !== 'daily') return false;
  return interactions.some(
    (i) =>
      i.popup_id === popup.id && i.action === 'seen' && sameLocalDay(new Date(i.created_at), now),
  );
}

export function pickPopup(
  popups: GlobalPopup[],
  interactions: PopupInteraction[],
  session: PopupSession,
  now: Date = new Date(),
): GlobalPopup | null {
  if (session.skipped) return null;
  const eligible = popups
    .filter((p) => !isHiddenForever(p, interactions))
    .filter((p) => !isHiddenToday(p, interactions, now))
    .filter((p) => !session.closedIds.has(p.id));
  if (session.shownId) {
    return eligible.find((p) => p.id === session.shownId) ?? null;
  }
  if (eligible.length === 0) return null;
  // Popup com gatilho é contextual: vence o comum. Empate por mais recente, como antes.
  return [...eligible].sort(
    (a, b) =>
      Number(Boolean(b.trigger)) - Number(Boolean(a.trigger)) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}
```

- [ ] **Step 5: Rodar, formatar, typecheck**

```bash
npm run format
npx vitest run apps/crm/src/hooks/__tests__/pickPopup.test.ts apps/crm/src/store/__tests__/popups.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS nos dois arquivos. O `tsc` vai apontar `GlobalPopupHost.test.tsx`/`usePopups.ts` por `created_at` faltando na interação otimista: isso é a Task 7. Se o tsc só reclamar disso, siga; qualquer outro erro é desta tarefa.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/store/popups.ts apps/crm/src/hooks/pickPopup.ts apps/crm/src/store/__tests__/popups.test.ts apps/crm/src/hooks/__tests__/pickPopup.test.ts
git commit -m "feat(crm): frequência daily por dia-calendário local e prioridade do popup com gatilho

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: CRM: `GlobalPopupHost` e `usePopups`

**Files:**
- Modify: `apps/crm/src/hooks/usePopups.ts` (`onMutate`, linha ~34-38)
- Modify: `apps/crm/src/components/layout/GlobalPopupHost.tsx` (import linha ~13; bloco de abertura linhas ~117-124)
- Test: `apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx`

**Interfaces:**
- Consumes: `sameLocalDay` e `pickPopup(..., now)` da Task 6; `PopupInteraction.created_at`.

- [ ] **Step 1: Testes (falham)**

Em `apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx`: acrescente `trigger: null,` ao fixture `popup` (depois de `require_ack: false,`); no teste `'abre o popup elegível...'` troque a expectativa de `popup_shown` por

```tsx
    expect(captureEventMock).toHaveBeenCalledWith('popup_shown', {
      popup_id: 'p1',
      pages: 2,
      trigger: null,
    });
```

no teste `'não grava seen de novo quando já existe'` troque a interação por `{ popup_id: 'p1', action: 'seen', created_at: '2026-01-01T00:00:00Z' }` (o once não olha a data), e no teste `'until_cta com CTA só em página...'` acrescente `created_at` a qualquer interação que ele monte. Acrescente ao final do `describe`:

```tsx
  it('daily: seen de ontem não bloqueia, grava seen de novo e popup_shown leva o trigger', async () => {
    getActivePopupsMock.mockResolvedValue([
      { ...popup, id: 'd1', frequency: 'daily', trigger: 'payment_pending' },
    ]);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    getMyPopupInteractionsMock.mockResolvedValue([
      { popup_id: 'd1', action: 'seen', created_at: yesterday.toISOString() },
      { popup_id: 'd1', action: 'closed', created_at: yesterday.toISOString() },
    ]);
    renderHost();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(recordPopupInteractionMock).toHaveBeenCalledWith('d1', 'seen'));
    expect(captureEventMock).toHaveBeenCalledWith('popup_shown', {
      popup_id: 'd1',
      pages: 2,
      trigger: 'payment_pending',
    });
  });

  it('daily já visto hoje: não abre nem grava', async () => {
    getActivePopupsMock.mockResolvedValue([{ ...popup, id: 'd1', frequency: 'daily' }]);
    getMyPopupInteractionsMock.mockResolvedValue([
      { popup_id: 'd1', action: 'seen', created_at: new Date().toISOString() },
    ]);
    renderHost();
    await act(async () => {});
    await waitFor(() => expect(getMyPopupInteractionsMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(recordPopupInteractionMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('mesaas_popup_shown')).toBeNull();
  });

  it('popup com gatilho vence o comum mais recente na mesma sessão', async () => {
    getActivePopupsMock.mockResolvedValue([
      { ...popup, id: 'plain', created_at: '2026-09-05T00:00:00Z' },
      {
        ...popup,
        id: 'trig',
        created_at: '2026-08-01T00:00:00Z',
        trigger: 'trial_ending',
        pages: [{ title: 'Seu teste termina em breve', eyebrow: null, body: 'b', image_key: null }],
      },
    ]);
    renderHost();
    await screen.findByRole('dialog');
    expect(screen.getByRole('heading', { level: 2, name: 'Seu teste termina em breve' })).toBeInTheDocument();
    expect(sessionStorage.getItem('mesaas_popup_shown')).toBe('trig');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx
```

Expected: FAIL. `popup_shown` chega sem `trigger`; no teste "seen de ontem" o host não grava `seen` de novo (a regra atual é "seen uma vez para sempre"); e o `tsc` do CRM ainda reclama de `created_at` ausente no `onMutate` de `usePopups.ts`. O teste "daily já visto hoje" pode passar desde a Task 6, porque `pickPopup` já o filtra.

- [ ] **Step 3: Implementar**

`apps/crm/src/hooks/usePopups.ts`, no `onMutate`:

```ts
      queryClient.setQueryData<PopupInteraction[]>(POPUP_INTERACTIONS_KEY, (old) => [
        ...(old || []),
        { popup_id: popupId, action, created_at: new Date().toISOString() },
      ]);
```

`apps/crm/src/components/layout/GlobalPopupHost.tsx`: import vira `import { pickPopup, sameLocalDay } from '@/hooks/pickPopup';`. No bloco de abertura, troque

```ts
      const alreadySeen = interactions.some((i) => i.popup_id === chosen.id && i.action === 'seen');
      if (!alreadySeen) record(chosen.id, 'seen');
      captureEvent('popup_shown', { popup_id: chosen.id, pages: chosen.pages.length });
```

por

```ts
      // once/until_cta: um seen para sempre (métrica de usuários distintos). daily: um
      // seen por dia-calendário local, é ele que segura o popup até amanhã.
      const now = new Date();
      const seenAlready = interactions.some(
        (i) =>
          i.popup_id === chosen.id &&
          i.action === 'seen' &&
          (chosen.frequency !== 'daily' || sameLocalDay(new Date(i.created_at), now)),
      );
      if (!seenAlready) record(chosen.id, 'seen');
      captureEvent('popup_shown', {
        popup_id: chosen.id,
        pages: chosen.pages.length,
        trigger: chosen.trigger,
      });
```

- [ ] **Step 4: Rodar, formatar, typecheck do CRM**

```bash
npm run format
npx vitest run apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx apps/crm/src/hooks/__tests__/pickPopup.test.ts apps/crm/src/hooks/__tests__/popupSession.test.ts apps/crm/src/store/__tests__/popups.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
```

Expected: PASS; tsc e lint limpos.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/hooks/usePopups.ts apps/crm/src/components/layout/GlobalPopupHost.tsx apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx
git commit -m "feat(crm): seen diário no GlobalPopupHost e trigger no evento popup_shown

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Verificação completa, E2E local e PR

**Files:**
- Nenhum novo. Possíveis ajustes de formatação/lint apontados pelos comandos abaixo.

- [ ] **Step 1: Bateria completa (na ordem, nunca em paralelo)**

```bash
npm run test:functions
git checkout deno.lock
npm run check:functions
npm ci
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: tudo verde. Se `format:check` reclamar, `npm run format` e commite como `style: prettier`.

- [ ] **Step 2: Suíte psql inteira no stack local**

Com o stack da Task 1 de pé (ou subindo de novo com o mesmo `config.toml` alterado):

```bash
npx supabase db reset
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres bash scripts/test-entitlements.sh 2>&1 | tail -20
```

Expected: nenhuma linha `FAIL`.

- [ ] **Step 3: E2E manual no stack local (admin + CRM)**

Siga o roteiro que funcionou para os popups originais (memória `reference_local_supabase_colima`): `.env.local` na raiz com `VITE_SUPABASE_URL=http://127.0.0.1:54421` e a anon key local; `npx supabase functions serve --env-file supabase/functions/.env.local --no-verify-jwt` (com `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5177`); `npm run dev` e `npm run dev:admin`; um platform admin local e um dono com pelo menos 1 cliente (senão o guia auto-abre e o popup pula a sessão).

1. No Admin, criar popup "Pagamento pendente" com frequência "Uma vez por dia", status ativo, público Todos.
2. `psql ... -c "update workspace_subscriptions set status = 'past_due' where workspace_id = '<ws do dono>'"` (crie a linha com `insert ... (workspace_id, stripe_customer_id, status)` se não existir).
3. Abrir o CRM como dono: popup abre (e o DunningBanner também). Fechar. Recarregar: não reabre (visto hoje).
4. Abrir o CRM como agente do mesmo workspace: nada.
5. `update workspace_subscriptions set status = 'active' ...`, recarregar como dono: nada.
6. Screenshots do popup aberto e da lista do Admin com o chip. Teardown: `npx supabase stop --no-backup`, `mv supabase/config.toml.bak supabase/config.toml`, apagar `.env.local`.

Se o stack local não subir, registre no PR que o E2E ficou por conta do rollout em prod com um workspace de teste.

- [ ] **Step 4: Reconferir a versão da migration e abrir o PR**

```bash
git fetch origin
git ls-tree --name-only origin/main:supabase/migrations | sort | tail -3
```

Se apareceu algo `>= 20260911000001`, renomeie a migration para um prefixo acima da cauda (e a referência no cabeçalho da suíte 80), commite e só então:

```bash
git push -u origin claude/admin-popup-triggers-e31b04
gh pr create --title "feat(popups): gatilhos por situação de cobrança e frequência diária" --body "$(cat <<'BODY'
## O que muda

Popups do admin ganham um **gatilho** (pagamento pendente, teste terminando em N dias, plano rebaixado por inadimplência) avaliado na RLS por uma função `security definer` que só responde pelo próprio usuário e exige `owner` em `workspace_members`. O popup aparece só para o dono e só enquanto a assinatura estiver naquela situação; some sozinho ao regularizar. Frequência nova **Uma vez por dia** (dia-calendário local). Popup com gatilho tem prioridade sobre popup comum na mesma sessão.

Spec: `docs/superpowers/specs/2026-09-06-popup-triggers-design.md`. Plano: `docs/superpowers/plans/2026-09-06-popup-triggers.md`.

## Rollout (ordem obrigatória, o merge deploya o frontend na hora)

- [ ] 1. `npx supabase db push --project-ref skjzpekeqefvlojenfsw` da `20260911000001_popup_triggers.sql`
- [ ] 2. Deploy `platform-admin` e `mcp-admin` (`--use-api`, flags de JWT atuais) a partir de um HEAD com `origin/main` mergeada
- [ ] 3. Merge

Fora de ordem: com a migration aplicada e as functions antigas no ar, o `pickPopupColumns` antigo descarta `trigger` em silêncio e o popup nasce **sem gatilho, visível para todo mundo**.

## Verificação

- vitest, deno test, check:functions, 4x tsc, lint, prettier: verdes
- suíte psql 80 + suíte inteira no stack local: verde
- E2E manual admin + CRM no stack local (screenshots no PR)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 5: Revisão externa**

O `gh pr create` dispara a revisão externa automática. Leia o corpo do comentário, confira cada achado no código e responda no PR o que foi corrigido e o que não procede, antes de pedir merge.
