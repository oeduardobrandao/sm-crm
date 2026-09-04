# Editor de popups (admin) + host no CRM: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin cria popups (modal com 1 a 6 páginas, CTA opcional na última, dois modos de frequência, targeting e agenda iguais aos banners) e o CRM mostra no máximo um por sessão, registrando as interações por usuário.

**Architecture:** Espelha a pilha dos banners: tabela `global_popups` + `popup_interactions` com RLS, quatro actions no `platform-admin`, página `PopupsPage` no admin, host `GlobalPopupHost` no CRM. O card visual (`PopupCard`) vive em `packages/ui` e é usado pelo preview do admin e pelo CRM. Imagens seguem o caminho das capas de artigo (upload via `file-upload-url`, assinatura via `sign-r2-urls` sob a RLS do usuário).

**Tech Stack:** Postgres/RLS (Supabase), Deno edge functions, React 19 + TanStack Query v5, Radix Dialog, react-markdown + remark-gfm, @dnd-kit/sortable, Vitest + Testing Library, `deno test`, psql suites.

**Spec:** `docs/superpowers/specs/2026-09-04-global-popups-design.md` (leia antes de cada tarefa; cada tarefa cita a seção).

## Global Constraints

- Migration com prefixo **acima da cauda de `origin/main`**. Hoje: `20260907000010_global_popups.sql`. Reconferir com `git ls-tree --name-only origin/main:supabase/migrations | tail` antes de abrir o PR; renumerar se a cauda avançou.
- Edge functions em **Deno**: imports `npm:` ou relativos `.ts`. CORS sempre via `buildCorsHeaders(req)`. Nunca devolver detalhe de erro ao cliente (mensagem genérica, `console.error` interno).
- `sign-r2-urls` e `platform-admin` já existem; **não** mudar suas flags de JWT no deploy.
- Frontend: ES modules, `lucide-react` para ícones, `sonner` para toasts, `react-hook-form` NÃO é necessário aqui (as páginas do admin usam `useState`, seguir o padrão da `BannersPage`).
- Prettier: `singleQuote`, `trailingComma: all`, `printWidth: 100`. Rodar `npm run format` antes de cada commit de frontend.
- Sem em-dash em copy visível ao usuário (usar ponto, dois-pontos ou "·").
- Limites do conteúdo (spec Parte 1): `pages` 1 a 6; `title` 1 a 120; `eyebrow` até 60; `body` 1 a 2000; `cta_label` e `secondary_label` até 40; `cta_url` até 2048 começando com `/` ou `http://` ou `https://`; `image_key` casa `^contas/[0-9a-f-]{36}/files/[^/]+$`.
- Copy do CRM em pt-BR: "Voltar", "Próximo", "Fechar", "Agora não", "Entendi". Copy do admin em inglês, como a `BannersPage`.
- Verificação antes de qualquer PR: `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run test:functions`, `npm run check:functions`.
- `npm run test:functions` suja `deno.lock` na raiz: `git checkout deno.lock` depois. Se `ls node_modules/.deno` existir após rodar Deno, rode `npm ci` antes de confiar em `tsc`/vitest.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260907000010_global_popups.sql` | tabelas, CHECKs, trigger, view, RLS |
| `supabase/tests/entitlements/77_global_popups.sql` | prova da RLS e dos CHECKs (CI `entitlement-tests`) |
| `supabase/functions/platform-admin/popups.ts` | `validatePages`, `validatePopupFields`, 4 handlers |
| `supabase/functions/platform-admin/index.ts` | 4 `case` novos |
| `supabase/functions/__tests__/platform-admin-popups_test.ts` | testes dos handlers e validações |
| `supabase/functions/sign-r2-urls/handler.ts` + `index.ts` | dep `createUserDb`, allowlist de imagens de popup |
| `supabase/functions/__tests__/sign-r2-urls_test.ts` | casos novos |
| `packages/ui/PopupCard.tsx` + `packages/ui/__tests__/PopupCard.test.tsx` | card visual compartilhado + `defaultSecondaryLabel` |
| `apps/admin/vite.config.ts`, `apps/admin/tsconfig.json` | alias `@mesaas/ui` |
| `apps/admin/src/lib/api.ts` | tipos `PopupPage`, `GlobalPopup` e 4 funções |
| `apps/admin/src/components/TargetPicker.tsx` + test | seletor de target extraído da `BannersPage` |
| `apps/admin/src/pages/BannersPage.tsx` | passa a usar `TargetPicker` |
| `apps/admin/src/pages/popup-form.ts` + test | estado do formulário, validação, payload (puro) |
| `apps/admin/src/pages/PopupsPage.tsx` + test | lista + editor com abas e preview |
| `apps/admin/src/router.tsx`, `apps/admin/src/layouts/AdminLayout.tsx` | rota e nav |
| `apps/crm/src/lib/analytics.ts` | 5 eventos novos |
| `apps/crm/src/store/popups.ts`, `apps/crm/src/store/index.ts` | leitura e escrita via Supabase |
| `apps/crm/src/components/guide/guideGating.ts`, `GuideContext.tsx` + tests | `guideAutoOpenState` e campo `autoOpen` |
| `apps/crm/src/hooks/popupSession.ts`, `pickPopup.ts`, `usePopups.ts` + tests | sessão, escolha pura, hook |
| `apps/crm/src/components/layout/GlobalPopupHost.tsx` + test | decide, resolve imagens, abre o Dialog |
| `apps/crm/src/components/layout/AppLayout.tsx` + test | monta o host |

---

### Task 1: Migration + suíte SQL de RLS

**Spec:** Parte 1 (tabelas, CHECKs, view, RLS, migration).

**Files:**
- Create: `supabase/migrations/20260907000010_global_popups.sql`
- Create: `supabase/tests/entitlements/77_global_popups.sql`

**Interfaces:**
- Produces: tabela `global_popups` (colunas da spec), tabela `popup_interactions(popup_id, user_id, action, created_at)`, view `popup_interaction_counts(popup_id, action, users)`, política de SELECT em `global_popups` para `authenticated`, políticas SELECT/INSERT em `popup_interactions`.

- [ ] **Step 1: Escrever a suíte SQL (falha porque as tabelas não existem)**

Crie `supabase/tests/entitlements/77_global_popups.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Global popups (migration 20260907000010_global_popups.sql, spec 2026-09-04):
--   (a) RLS de global_popups: ativo + janela + targeting (all / plan / workspace),
--       mesmo predicado dos banners.
--   (b) popup_interactions: cada usuario le e insere so as proprias linhas.
--   (c) popup_interaction_counts: invisivel para authenticated.
--   (d) CHECKs: pages vazio, action invalida, require_ack + until_cta.

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a      uuid;
  v_ws_b      uuid;
  v_ua        uuid := gen_random_uuid();
  v_ub        uuid := gen_random_uuid();
  v_p_all     uuid;
  v_p_ws_a    uuid;
  v_p_plan    uuid;
  v_p_draft   uuid;
  v_p_future  uuid;
  v_p_expired uuid;
  v_ids       uuid[];
  v_rejected  boolean;
  v_n         int;
  v_pages     jsonb := '[{"title":"T","body":"B"}]'::jsonb;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('max');
  insert into auth.users (id) values (v_ua), (v_ub);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_ua, v_ws_a, 'owner'), (v_ub, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_ua;
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_ub;

  insert into global_popups (pages, target_mode, status)
    values (v_pages, 'all', 'active') returning id into v_p_all;
  insert into global_popups (pages, target_mode, target_workspace_ids, status)
    values (v_pages, 'workspace', array[v_ws_a], 'active') returning id into v_p_ws_a;
  insert into global_popups (pages, target_mode, target_plan_ids, status)
    values (v_pages, 'plan', array['max'], 'active') returning id into v_p_plan;
  insert into global_popups (pages, target_mode, status)
    values (v_pages, 'all', 'draft') returning id into v_p_draft;
  insert into global_popups (pages, target_mode, status, starts_at)
    values (v_pages, 'all', 'active', now() + interval '1 day') returning id into v_p_future;
  insert into global_popups (pages, target_mode, status, starts_at, ends_at)
    values (v_pages, 'all', 'active', now() - interval '2 day', now() - interval '1 day')
    returning id into v_p_expired;

  -- ---- (a) usuario A (workspace A, plano start) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_all = any(v_ids), 'A nao ve popup all';
  assert v_p_ws_a = any(v_ids), 'A nao ve popup direcionado ao proprio workspace';
  assert not (v_p_plan = any(v_ids)), 'A (start) ve popup do plano max';
  assert not (v_p_draft = any(v_ids)), 'A ve popup draft';
  assert not (v_p_future = any(v_ids)), 'A ve popup antes de starts_at';
  assert not (v_p_expired = any(v_ids)), 'A ve popup depois de ends_at';

  -- ---- (b) A insere a propria interacao, nao a de B ----
  insert into popup_interactions (popup_id, user_id, action) values (v_p_all, v_ua, 'seen');
  v_rejected := false;
  begin
    insert into popup_interactions (popup_id, user_id, action) values (v_p_all, v_ub, 'seen');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'A conseguiu inserir interacao com user_id de B';

  -- ---- (c) view invisivel para authenticated ----
  v_rejected := false;
  begin
    perform 1 from popup_interaction_counts;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated conseguiu ler popup_interaction_counts';
  execute 'reset role';

  -- ---- (a) usuario B (workspace B, plano max) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_all = any(v_ids), 'B nao ve popup all';
  assert v_p_plan = any(v_ids), 'B (max) nao ve popup do plano max';
  assert not (v_p_ws_a = any(v_ids)), 'B ve popup direcionado ao workspace A';
  select count(*) into v_n from popup_interactions;
  assert v_n = 0, 'B enxerga interacoes de A';
  execute 'reset role';

  -- ---- (d) CHECKs, como postgres ----
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode) values ('[]'::jsonb, 'all');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'pages vazio foi aceito';

  v_rejected := false;
  begin
    insert into popup_interactions (popup_id, user_id, action) values (v_p_all, v_ua, 'bogus');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'action invalida foi aceita';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, require_ack, frequency, cta_label, cta_url)
      values (v_pages, 'all', true, 'until_cta', 'Ver', '/x');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'require_ack + until_cta foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, cta_label) values (v_pages, 'all', 'Ver');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'cta_label sem cta_url foi aceito';

  -- array vazio (nao NULL): array_length devolve NULL e um CHECK ingenuo passaria
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, target_plan_ids)
      values (v_pages, 'plan', '{}'::text[]);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'target_mode plan com array vazio foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, target_workspace_ids)
      values (v_pages, 'workspace', '{}'::uuid[]);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'target_mode workspace com array vazio foi aceito';
end $$;
rollback;
```

- [ ] **Step 2: Rodar a suíte e ver falhar**

Precisa de Docker (colima) e Supabase local. Se não tiver, pule para o Step 4 e deixe o CI provar (job `entitlement-tests`). Com Docker:

```bash
npx supabase start && npx supabase db reset && bash scripts/test-entitlements.sh
```

Esperado: `77_global_popups.sql` falha com `relation "global_popups" does not exist`.

- [ ] **Step 3: Escrever a migration**

Crie `supabase/migrations/20260907000010_global_popups.sql`:

```sql
-- Global popups: anúncios em modal, no máximo um por sessão no CRM
-- (spec docs/superpowers/specs/2026-09-04-global-popups-design.md).
-- Espelha global_banners (20260502000001) com conteúdo em páginas.

create table global_popups (
  id uuid primary key default gen_random_uuid(),
  pages jsonb not null,
  cta_label text,
  cta_url text,
  cta_style text not null default 'ink',
  secondary_label text,
  frequency text not null default 'once',
  require_ack boolean not null default false,
  target_mode text not null,
  target_plan_ids text[],
  target_workspace_ids uuid[],
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft',
  created_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- O formato interno de cada página (title/body obrigatórios, tamanhos) é
  -- validado no platform-admin, único caminho de escrita. O banco garante só
  -- que é um array de 1 a 6 itens.
  constraint global_popups_pages_check
    check (jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) between 1 and 6),
  constraint global_popups_cta_style_check
    check (cta_style in ('ink', 'brand')),
  constraint global_popups_frequency_check
    check (frequency in ('once', 'until_cta')),
  constraint global_popups_cta_pair_check
    check ((cta_label is null) = (cta_url is null)),
  constraint global_popups_until_cta_needs_cta_check
    check (frequency <> 'until_cta' or cta_url is not null),
  -- Com confirmação obrigatória não existe "closed", então until_cta seria
  -- idêntico a once. Proibido para não virar um estado sem efeito no admin.
  constraint global_popups_ack_frequency_check
    check (not (require_ack and frequency = 'until_cta')),
  constraint global_popups_status_check
    check (status in ('draft', 'active', 'archived')),
  constraint global_popups_target_mode_check
    check (target_mode in ('all', 'plan', 'workspace')),
  -- array_length('{}', 1) é NULL, e CHECK com NULL passa: o coalesce fecha o
  -- buraco que a migration dos banners deixou (array vazio aceito).
  constraint global_popups_plan_targets_check
    check (target_mode <> 'plan' or coalesce(array_length(target_plan_ids, 1), 0) > 0),
  constraint global_popups_workspace_targets_check
    check (target_mode <> 'workspace' or coalesce(array_length(target_workspace_ids, 1), 0) > 0),
  constraint global_popups_schedule_check
    check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create or replace function update_global_popups_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger global_popups_updated_at
  before update on global_popups
  for each row execute function update_global_popups_updated_at();

-- Append-only: um usuário em until_cta acumula vários 'closed' antes do 'cta'.
create table popup_interactions (
  id uuid primary key default gen_random_uuid(),
  popup_id uuid not null references global_popups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  -- O INSERT é feito direto pelo cliente sob RLS, sem handler na frente.
  constraint popup_interactions_action_check
    check (action in ('seen', 'closed', 'cta', 'ack'))
);

create index popup_interactions_popup_user_idx on popup_interactions (popup_id, user_id);

-- Métricas da lista do admin em uma query. Só o service role lê.
create view popup_interaction_counts as
  select popup_id, action, count(distinct user_id)::int as users
  from popup_interactions
  group by popup_id, action;

revoke all on popup_interaction_counts from public, anon, authenticated;
-- REVOKE FROM PUBLIC derruba o service_role junto: re-conceder explicitamente.
grant select on popup_interaction_counts to service_role;

-- RLS: global_popups (cópia da política dos banners)
alter table global_popups enable row level security;

create policy "Authenticated users can read active popups matching their workspace"
  on global_popups for select to authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
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

-- RLS: popup_interactions
alter table popup_interactions enable row level security;

create policy "Users can read own popup interactions"
  on popup_interactions for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own popup interactions"
  on popup_interactions for insert to authenticated
  with check (user_id = auth.uid());
```

- [ ] **Step 4: Rodar a suíte e ver passar (ou o guard de versão, sem Docker)**

Com Docker:

```bash
npx supabase db reset && bash scripts/test-entitlements.sh
```

Esperado: todas as suítes `PASS`, incluindo `77_global_popups.sql`.

Sem Docker, ao menos confira que o prefixo é único e acima da cauda:

```bash
ls supabase/migrations | sed 's/_.*//' | sort | uniq -d; git ls-tree --name-only origin/main:supabase/migrations | tail -1
```

Esperado: nenhuma duplicata impressa; a cauda de `origin/main` é menor que `20260907000010`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260907000010_global_popups.sql supabase/tests/entitlements/77_global_popups.sql
git commit -m "feat(popups): tabelas global_popups e popup_interactions com RLS, view de contagens e suíte SQL"
```

---

### Task 2: `validatePages` e `validatePopupFields` (platform-admin)

**Spec:** Parte 1, seção `platform-admin` (validação de `pages` e dos campos do CTA).

**Files:**
- Create: `supabase/functions/platform-admin/popups.ts` (só as validações nesta tarefa; os handlers entram na Task 3)
- Create: `supabase/functions/__tests__/platform-admin-popups_test.ts`

**Interfaces:**
- Produces:
  - `type PopupPage = { title: string; eyebrow: string | null; body: string; image_key: string | null }`
  - `validatePages(input: unknown): { ok: true; pages: PopupPage[] } | { ok: false; error: string }`
  - `validatePopupFields(row: Record<string, unknown>): string | null` (null = válido; string = mensagem interna, nunca devolvida ao cliente)
  - `POPUP_COLUMNS` (readonly array com as 13 colunas editáveis)

- [ ] **Step 1: Escrever os testes que falham**

Crie `supabase/functions/__tests__/platform-admin-popups_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { validatePages, validatePopupFields } from "../platform-admin/popups.ts";

const IMG = "contas/11111111-1111-1111-1111-111111111111/files/abc.png";

Deno.test("validatePages: aceita 1 página mínima e normaliza opcionais para null", () => {
  const r = validatePages([{ title: " Olá ", body: "corpo" }]);
  assert(r.ok, "esperava ok");
  assertEquals(r.pages, [{ title: "Olá", eyebrow: null, body: "corpo", image_key: null }]);
});

Deno.test("validatePages: aceita eyebrow e image_key válidos", () => {
  const r = validatePages([{ title: "T", body: "B", eyebrow: "Novo", image_key: IMG }]);
  assert(r.ok);
  assertEquals(r.pages[0].eyebrow, "Novo");
  assertEquals(r.pages[0].image_key, IMG);
});

Deno.test("validatePages: rejeita não-array, vazio e mais de 6", () => {
  assertEquals(validatePages("x").ok, false);
  assertEquals(validatePages([]).ok, false);
  const seven = Array.from({ length: 7 }, () => ({ title: "T", body: "B" }));
  assertEquals(validatePages(seven).ok, false);
});

Deno.test("validatePages: rejeita title/body vazios ou longos e eyebrow longo", () => {
  assertEquals(validatePages([{ title: "", body: "B" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "   " }]).ok, false);
  assertEquals(validatePages([{ title: "x".repeat(121), body: "B" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "x".repeat(2001) }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", eyebrow: "x".repeat(61) }]).ok, false);
});

Deno.test("validatePages: rejeita image_key fora do formato R2 e chaves desconhecidas", () => {
  assertEquals(validatePages([{ title: "T", body: "B", image_key: "https://x/y.png" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", image_key: "contas/abc/files/x.png" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", extra: 1 }]).ok, false);
});

Deno.test("validatePopupFields: par de CTA, until_cta, require_ack, tamanhos e formato da URL", () => {
  const base = { cta_label: null, cta_url: null, secondary_label: null, frequency: "once", require_ack: false, target_mode: "all" };
  assertEquals(validatePopupFields(base), null);
  assertEquals(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "/ajuda" }), null);
  assertEquals(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "https://x.y/z" }), null);
  assert(validatePopupFields({ ...base, cta_label: "Ver" }) !== null, "label sem url");
  assert(validatePopupFields({ ...base, cta_url: "/x" }) !== null, "url sem label");
  assert(validatePopupFields({ ...base, frequency: "until_cta" }) !== null, "until_cta sem cta");
  assert(validatePopupFields({ ...base, frequency: "until_cta", cta_label: "Ver", cta_url: "/x", require_ack: true }) !== null, "require_ack + until_cta");
  assert(validatePopupFields({ ...base, cta_label: "x".repeat(41), cta_url: "/x" }) !== null, "label longo");
  assert(validatePopupFields({ ...base, secondary_label: "x".repeat(41) }) !== null, "secondary longo");
  assert(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "javascript:alert(1)" }) !== null, "url sem prefixo permitido");
  assert(validatePopupFields({ ...base, cta_label: "Ver", cta_url: "/" + "x".repeat(2048) }) !== null, "url longa");
  assert(validatePopupFields({ ...base, frequency: "weekly" }) !== null, "frequency inválida");
  assert(validatePopupFields({ ...base, cta_style: "neon" }) !== null, "cta_style inválido");
  // Targeting: o CHECK do banco só cobre NULL; array vazio precisa ser barrado aqui.
  assertEquals(validatePopupFields({ ...base, target_mode: "plan", target_plan_ids: ["pro"] }), null);
  assert(validatePopupFields({ ...base, target_mode: "plan", target_plan_ids: [] }) !== null, "plan sem ids");
  assert(validatePopupFields({ ...base, target_mode: "plan" }) !== null, "plan sem coluna");
  assert(validatePopupFields({ ...base, target_mode: "workspace", target_workspace_ids: [] }) !== null, "workspace sem ids");
  assert(validatePopupFields({ ...base, target_mode: "bogus" }) !== null, "target_mode inválido");
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run test:functions -- --filter "validatePages"
```

Esperado: erro de módulo (`popups.ts` não existe). `--filter` casa com nomes de teste, não de arquivo.

- [ ] **Step 3: Implementar as validações**

Crie `supabase/functions/platform-admin/popups.ts`:

```ts
// Popups globais (spec 2026-09-04): validação e handlers. Único caminho de
// escrita em global_popups, então os limites de formato vivem aqui, não no banco.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const POPUP_COLUMNS = [
  "pages", "cta_label", "cta_url", "cta_style", "secondary_label", "frequency",
  "require_ack", "target_mode", "target_plan_ids", "target_workspace_ids",
  "starts_at", "ends_at", "status",
] as const;

export interface PopupPage {
  title: string;
  eyebrow: string | null;
  body: string;
  image_key: string | null;
}

const MAX_PAGES = 6;
const PAGE_KEYS = new Set(["title", "eyebrow", "body", "image_key"]);
const IMAGE_KEY_RE = /^contas\/[0-9a-f-]{36}\/files\/[^/]+$/;
const CTA_URL_RE = /^(\/(?!\/)|https?:\/\/)/; // `//host` é protocol-relative, não caminho interno

function optionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const t = value.trim();
  if (t.length === 0) return { ok: true, value: null };
  if (t.length > max) return { ok: false };
  return { ok: true, value: t };
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

export function validatePages(
  input: unknown,
): { ok: true; pages: PopupPage[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "pages must be an array" };
  if (input.length < 1 || input.length > MAX_PAGES) {
    return { ok: false, error: `pages must have 1 to ${MAX_PAGES} items` };
  }
  const pages: PopupPage[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `page ${i} must be an object` };
    }
    for (const k of Object.keys(raw)) {
      if (!PAGE_KEYS.has(k)) return { ok: false, error: `page ${i}: unknown key ${k}` };
    }
    const r = raw as Record<string, unknown>;
    const title = requiredText(r.title, 120);
    if (!title) return { ok: false, error: `page ${i}: title required (max 120)` };
    const body = requiredText(r.body, 2000);
    if (!body) return { ok: false, error: `page ${i}: body required (max 2000)` };
    const eyebrow = optionalText(r.eyebrow, 60);
    if (!eyebrow.ok) return { ok: false, error: `page ${i}: eyebrow max 60` };
    const image = optionalText(r.image_key, 512);
    if (!image.ok) return { ok: false, error: `page ${i}: image_key invalid` };
    if (image.value !== null && !IMAGE_KEY_RE.test(image.value)) {
      return { ok: false, error: `page ${i}: image_key must be an R2 key` };
    }
    pages.push({ title, eyebrow: eyebrow.value, body, image_key: image.value });
  }
  return { ok: true, pages };
}

/** Regras cruzadas do popup inteiro. Recebe a linha já mesclada (create: body; update: atual + body). */
export function validatePopupFields(row: Record<string, unknown>): string | null {
  const ctaLabel = optionalText(row.cta_label, 40);
  if (!ctaLabel.ok) return "cta_label max 40";
  const ctaUrl = optionalText(row.cta_url, 2048);
  if (!ctaUrl.ok) return "cta_url max 2048";
  if ((ctaLabel.value === null) !== (ctaUrl.value === null)) return "cta_label and cta_url go together";
  if (ctaUrl.value !== null && !CTA_URL_RE.test(ctaUrl.value)) {
    return "cta_url must start with / or http(s)://";
  }
  const secondary = optionalText(row.secondary_label, 40);
  if (!secondary.ok) return "secondary_label max 40";

  const frequency = row.frequency ?? "once";
  if (frequency !== "once" && frequency !== "until_cta") return "invalid frequency";
  if (frequency === "until_cta" && ctaUrl.value === null) return "until_cta requires a CTA";
  const requireAck = row.require_ack === true;
  if (requireAck && frequency === "until_cta") return "require_ack implies once";

  const style = row.cta_style ?? "ink";
  if (style !== "ink" && style !== "brand") return "invalid cta_style";

  // Targeting: array_length('{}') é NULL no Postgres, então o CHECK do banco só
  // barra NULL. Array vazio precisa ser barrado aqui, senão o popup nasce
  // invisível para todo mundo.
  const mode = row.target_mode;
  if (mode !== "all" && mode !== "plan" && mode !== "workspace") return "invalid target_mode";
  if (mode === "plan" && !(Array.isArray(row.target_plan_ids) && row.target_plan_ids.length > 0)) {
    return "plan targeting needs at least one plan";
  }
  if (
    mode === "workspace" &&
    !(Array.isArray(row.target_workspace_ids) && row.target_workspace_ids.length > 0)
  ) {
    return "workspace targeting needs at least one workspace";
  }
  return null;
}

// Usado só para o tipo; os handlers entram na Task 3.
export type Svc = SupabaseClient;
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npm run test:functions -- --filter "validatePages"; npm run test:functions -- --filter "validatePopupFields"; git checkout deno.lock
```

Esperado: 6 testes `ok`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/popups.ts supabase/functions/__tests__/platform-admin-popups_test.ts
git commit -m "feat(popups): validação de pages e campos do popup no platform-admin"
```

---
### Task 3: Handlers `list/create/update/delete-popup` + wiring no `index.ts`

**Spec:** Parte 1, seção `platform-admin` (tabela de actions).

**Files:**
- Modify: `supabase/functions/platform-admin/popups.ts` (adicionar os handlers abaixo das validações)
- Modify: `supabase/functions/platform-admin/index.ts` (import + 4 `case` depois de `delete-banner`, linha ~134)
- Modify: `supabase/functions/__tests__/platform-admin-popups_test.ts` (acrescentar os testes)

**Interfaces:**
- Consumes: `validatePages`, `validatePopupFields`, `POPUP_COLUMNS` (Task 2).
- Produces:
  - `handleListPopups(svc, body: { status?: string }, headers) → 200 { popups: (row & { counts: { seen, closed, cta, ack } })[] }`
  - `handleCreatePopup(svc, body, adminId, headers) → 201 { popup }` ou 400 `{ error: "Invalid popup" }`
  - `handleUpdatePopup(svc, body: { popup_id, ...cols }, headers) → 200 { popup }`; 400 `{ error: "popup_id is required" }` / `"No fields to update"` / `"Invalid popup"`; 404 `{ error: "Popup not found" }`
  - `handleDeletePopup(svc, body: { popup_id }, headers) → 200 { message: "Popup deleted" }`; 400 `"Only draft popups can be deleted"`; 404 `"Popup not found"`
  - `validatePopupFields` (Task 2) também valida `target_mode` contra `target_plan_ids` / `target_workspace_ids` (array vazio é rejeitado).

- [ ] **Step 1: Acrescentar os testes dos handlers (falham: handlers não existem)**

Acrescente ao fim de `supabase/functions/__tests__/platform-admin-popups_test.ts`:

```ts
import {
  handleCreatePopup,
  handleDeletePopup,
  handleListPopups,
  handleUpdatePopup,
} from "../platform-admin/popups.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Fake gravador de chamadas (mesmo padrão de platform-admin-plan-mutations_test.ts).
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (const m of ["select", "eq", "in", "order", "insert", "update", "delete"]) {
      rec[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return rec; };
    }
    rec.single = () => { calls.push({ table, method: "single", args: [] }); return Promise.resolve(next()); };
    rec.maybeSingle = () => { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(next()); };
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }
  const db = { from: (t: string) => { calls.push({ table: t, method: "from", args: [t] }); return recorder(t); } };
  return { db: db as unknown as SupabaseClient, calls };
}

function lastPayload(calls: Call[], table: string, method: string): Record<string, unknown> | undefined {
  return calls.filter((x) => x.table === table && x.method === method).at(-1)?.args[0] as
    | Record<string, unknown>
    | undefined;
}

const H = { "Content-Type": "application/json" };
const PAGES = [{ title: "T", body: "B" }];
const ROW = {
  id: "p1", pages: [{ title: "T", eyebrow: null, body: "B", image_key: null }],
  cta_label: null, cta_url: null, cta_style: "ink", secondary_label: null,
  frequency: "once", require_ack: false, target_mode: "all", status: "draft",
};

Deno.test("list-popups: junta counts da view por popup, zerando ações ausentes", async () => {
  const { db, calls } = makeFakeDb({
    global_popups: [{ data: [{ ...ROW, id: "p1" }, { ...ROW, id: "p2" }], error: null }],
    popup_interaction_counts: [{
      data: [{ popup_id: "p1", action: "seen", users: 5 }, { popup_id: "p1", action: "cta", users: 2 }],
      error: null,
    }],
  });
  const res = await handleListPopups(db, { status: "active" }, H);
  assertEquals(res.status, 200);
  const { popups } = await res.json();
  assertEquals(popups[0].counts, { seen: 5, closed: 0, cta: 2, ack: 0 });
  assertEquals(popups[1].counts, { seen: 0, closed: 0, cta: 0, ack: 0 });
  assert(
    calls.some((c) => c.table === "global_popups" && c.method === "eq" && c.args[0] === "status"),
    "esperava filtro por status",
  );
});

Deno.test("create-popup: 400 sem pages/target_mode, 400 com pages inválido, 201 com allowlist e created_by", async () => {
  let r = await handleCreatePopup(makeFakeDb({}).db, { action: "create-popup", target_mode: "all" }, "adm", H);
  assertEquals(r.status, 400);
  r = await handleCreatePopup(makeFakeDb({}).db, { action: "create-popup", pages: [], target_mode: "all" }, "adm", H);
  assertEquals(r.status, 400);

  const { db, calls } = makeFakeDb({ global_popups: [{ data: ROW, error: null }] });
  r = await handleCreatePopup(
    db,
    { action: "create-popup", pages: PAGES, target_mode: "all", cta_label: "Ver", cta_url: "/x", bogus: 1 },
    "adm",
    H,
  );
  assertEquals(r.status, 201);
  const payload = lastPayload(calls, "global_popups", "insert")!;
  assertEquals(payload.created_by, "adm");
  assertEquals(payload.cta_label, "Ver");
  assertEquals((payload.pages as unknown[]).length, 1);
  assertEquals("bogus" in payload, false);
});

Deno.test("create-popup: 400 quando as regras cruzadas falham (until_cta sem CTA)", async () => {
  const r = await handleCreatePopup(
    makeFakeDb({}).db,
    { action: "create-popup", pages: PAGES, target_mode: "all", frequency: "until_cta" },
    "adm",
    H,
  );
  assertEquals(r.status, 400);
  assertEquals((await r.json()).error, "Invalid popup");
});

Deno.test("update-popup: valida sobre a linha mesclada e atualiza só a allowlist", async () => {
  const current = { ...ROW, cta_label: "Ver", cta_url: "/x" };
  const { db, calls } = makeFakeDb({
    global_popups: [{ data: current, error: null }, { data: { ...current, frequency: "until_cta" }, error: null }],
  });
  const r = await handleUpdatePopup(db, { action: "update-popup", popup_id: "p1", frequency: "until_cta", id: "hack" }, H);
  assertEquals(r.status, 200);
  const payload = lastPayload(calls, "global_popups", "update")!;
  assertEquals(payload.frequency, "until_cta");
  assertEquals("id" in payload, false);
});

Deno.test("update-popup: 400 quando a mescla viola regra (require_ack sobre until_cta), 404 sem linha", async () => {
  const current = { ...ROW, cta_label: "Ver", cta_url: "/x", frequency: "until_cta" };
  let r = await handleUpdatePopup(
    makeFakeDb({ global_popups: [{ data: current, error: null }] }).db,
    { action: "update-popup", popup_id: "p1", require_ack: true },
    H,
  );
  assertEquals(r.status, 400);
  r = await handleUpdatePopup(makeFakeDb({ global_popups: [{ data: null, error: null }] }).db,
    { action: "update-popup", popup_id: "nope", status: "active" }, H);
  assertEquals(r.status, 404);
  r = await handleUpdatePopup(makeFakeDb({}).db, { action: "update-popup", popup_id: "p1" }, H);
  assertEquals(r.status, 400);
});

Deno.test("delete-popup: só draft; 404 sem linha", async () => {
  let r = await handleDeletePopup(makeFakeDb({ global_popups: [{ data: { status: "active" }, error: null }] }).db, { popup_id: "p1" }, H);
  assertEquals(r.status, 400);
  r = await handleDeletePopup(makeFakeDb({ global_popups: [{ data: null, error: null }] }).db, { popup_id: "nope" }, H);
  assertEquals(r.status, 404);
  const { db, calls } = makeFakeDb({ global_popups: [{ data: { status: "draft" }, error: null }] });
  r = await handleDeletePopup(db, { popup_id: "p1" }, H);
  assertEquals(r.status, 200);
  assert(calls.some((c) => c.table === "global_popups" && c.method === "delete"));
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run test:functions -- --filter "popup"; git checkout deno.lock
```

Esperado: falha de import (`handleListPopups` não exportado).

- [ ] **Step 3: Implementar os handlers**

Substitua o rodapé `export type Svc = SupabaseClient;` de `popups.ts` por:

```ts
type Svc = SupabaseClient;
type Headers = Record<string, string>;

const ACTIONS = ["seen", "closed", "cta", "ack"] as const;
type Counts = Record<(typeof ACTIONS)[number], number>;

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function pickColumns(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of POPUP_COLUMNS) {
    if (body[col] !== undefined) out[col] = body[col];
  }
  return out;
}

export async function handleListPopups(svc: Svc, body: { status?: string }, headers: Headers) {
  let query = svc.from("global_popups").select("*").order("created_at", { ascending: false });
  if (body.status) query = query.eq("status", body.status);
  const { data: popups, error } = await query;
  if (error) throw error;

  const rows = (popups ?? []) as Array<Record<string, unknown> & { id: string }>;
  const counts = new Map<string, Counts>();
  for (const p of rows) counts.set(p.id, { seen: 0, closed: 0, cta: 0, ack: 0 });

  if (rows.length > 0) {
    const { data: agg, error: aggErr } = await svc
      .from("popup_interaction_counts")
      .select("popup_id, action, users")
      .in("popup_id", rows.map((p) => p.id));
    if (aggErr) throw aggErr;
    for (const r of (agg ?? []) as Array<{ popup_id: string; action: string; users: number }>) {
      const c = counts.get(r.popup_id);
      if (c && (ACTIONS as readonly string[]).includes(r.action)) c[r.action as keyof Counts] = r.users;
    }
  }

  return json({ popups: rows.map((p) => ({ ...p, counts: counts.get(p.id) })) }, 200, headers);
}

export async function handleCreatePopup(
  svc: Svc,
  body: Record<string, unknown>,
  adminId: string,
  headers: Headers,
) {
  if (body.pages === undefined || !body.target_mode) {
    return json({ error: "pages and target_mode are required" }, 400, headers);
  }
  const pages = validatePages(body.pages);
  if (!pages.ok) {
    console.error("[popups] create rejected:", pages.error);
    return json({ error: "Invalid popup" }, 400, headers);
  }
  const insert = { ...pickColumns(body), pages: pages.pages, created_by: adminId };
  const fieldError = validatePopupFields(insert);
  if (fieldError) {
    console.error("[popups] create rejected:", fieldError);
    return json({ error: "Invalid popup" }, 400, headers);
  }

  const { data, error } = await svc.from("global_popups").insert(insert).select().single();
  if (error) throw error;
  return json({ popup: data }, 201, headers);
}

export async function handleUpdatePopup(svc: Svc, body: Record<string, unknown>, headers: Headers) {
  const popupId = body.popup_id;
  if (typeof popupId !== "string" || !popupId) return json({ error: "popup_id is required" }, 400, headers);

  const update = pickColumns(body);
  if (Object.keys(update).length === 0) return json({ error: "No fields to update" }, 400, headers);

  if (update.pages !== undefined) {
    const pages = validatePages(update.pages);
    if (!pages.ok) {
      console.error("[popups] update rejected:", pages.error);
      return json({ error: "Invalid popup" }, 400, headers);
    }
    update.pages = pages.pages;
  }

  // Regras cruzadas valem sobre a linha resultante, não só sobre o patch.
  const { data: current, error: readErr } = await svc
    .from("global_popups").select("*").eq("id", popupId).maybeSingle();
  if (readErr) throw readErr;
  if (!current) return json({ error: "Popup not found" }, 404, headers);

  const fieldError = validatePopupFields({ ...(current as Record<string, unknown>), ...update });
  if (fieldError) {
    console.error("[popups] update rejected:", fieldError);
    return json({ error: "Invalid popup" }, 400, headers);
  }

  const { data, error } = await svc
    .from("global_popups").update(update).eq("id", popupId).select().single();
  if (error) throw error;
  return json({ popup: data }, 200, headers);
}

export async function handleDeletePopup(svc: Svc, body: { popup_id?: string }, headers: Headers) {
  const { popup_id } = body;
  if (!popup_id) return json({ error: "popup_id is required" }, 400, headers);

  // Falha fechada: sem linha é 404, erro de leitura sobe. Nunca cair no DELETE
  // com a guarda de draft pulada.
  const { data: popup, error: readErr } = await svc
    .from("global_popups").select("status").eq("id", popup_id).maybeSingle();
  if (readErr) throw readErr;
  if (!popup) return json({ error: "Popup not found" }, 404, headers);
  if (popup.status !== "draft") {
    return json({ error: "Only draft popups can be deleted" }, 400, headers);
  }

  const { error } = await svc.from("global_popups").delete().eq("id", popup_id);
  if (error) throw error;
  return json({ message: "Popup deleted" }, 200, headers);
}
```

- [ ] **Step 4: Ligar no `index.ts`**

Em `supabase/functions/platform-admin/index.ts`, junto aos imports do topo:

```ts
import { handleListPopups, handleCreatePopup, handleUpdatePopup, handleDeletePopup } from "./popups.ts";
```

E no `switch (action)`, logo após `case "delete-banner": ...`:

```ts
      case "list-popups":
        return await handleListPopups(svc, body, headers);
      case "create-popup":
        return await handleCreatePopup(svc, body, admin.id, headers);
      case "update-popup":
        return await handleUpdatePopup(svc, body, headers);
      case "delete-popup":
        return await handleDeletePopup(svc, body, headers);
```

- [ ] **Step 5: Rodar testes e typecheck do Deno**

```bash
npm run test:functions -- --filter "popup"; npm run check:functions; git checkout deno.lock
```

Esperado: todos `ok`; `deno check` sem erros. Se `check` reclamar de `never` em `.from(...)` (armadilha `ReturnType<typeof createClient>`), mantenha o parâmetro tipado como `SupabaseClient` importado de `npm:@supabase/supabase-js@2`, como `plan-mutations.ts` faz.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/platform-admin/popups.ts supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-popups_test.ts
git commit -m "feat(popups): actions list/create/update/delete-popup no platform-admin"
```

---

### Task 4: `sign-r2-urls` assina imagens de popups visíveis ao usuário

**Spec:** Parte 1, seção `sign-r2-urls` (client no contexto do usuário, timeout, isolamento).

**Files:**
- Modify: `supabase/functions/sign-r2-urls/handler.ts`
- Modify: `supabase/functions/sign-r2-urls/index.ts`
- Modify: `supabase/functions/__tests__/sign-r2-urls_test.ts`

**Interfaces:**
- Produces: nova dep obrigatória `createUserDb: (authHeader: string) => { from: (table: string) => any }` em `SignR2UrlsDeps`. O `index.ts` a implementa com `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })`.

- [ ] **Step 1: Acrescentar os testes (falham)**

Em `supabase/functions/__tests__/sign-r2-urls_test.ts`, dentro de `makeDeps`, acrescente a dep default logo antes de `signGetUrl`:

```ts
    createUserDb: (_authHeader: string) => ({
      from: (_table: string) => ({
        select: (_cols: string) => ({
          abortSignal: async (_s: AbortSignal) => ({ data: [], error: null }),
        }),
      }),
    }),
```

E ao fim do arquivo:

```ts
// ── Imagens de popups (global_popups.pages[].image_key) ───────────────────────

const POPUP_KEY = "contas/00000000-0000-0000-0000-000000000000/files/popup.png";

function userDbReturning(rows: unknown[]) {
  return (_authHeader: string) => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        abortSignal: async (_s: AbortSignal) => ({ data: rows, error: null }),
      }),
    }),
  });
}

Deno.test("assina image_key de página de popup que a RLS do usuário devolve", async () => {
  const handler = createSignR2UrlsHandler(makeDeps({
    createUserDb: userDbReturning([{ pages: [{ title: "T", body: "B", image_key: POPUP_KEY }] }]),
  }));
  const res = await handler(makeReq("POST", { keys: [POPUP_KEY, "contas/conta-abc/files/own.png"] }));
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.urls[POPUP_KEY], `https://r2.example.com/${POPUP_KEY}?signed=1`);
  assertEquals(data.urls["contas/conta-abc/files/own.png"], "https://r2.example.com/contas/conta-abc/files/own.png?signed=1");
});

Deno.test("não assina chave de popup que o client do usuário não devolve (draft ou não direcionado)", async () => {
  const handler = createSignR2UrlsHandler(makeDeps({ createUserDb: userDbReturning([]) }));
  const res = await handler(makeReq("POST", { keys: [POPUP_KEY] }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).urls, {});
});

Deno.test("falha na consulta de popups não derruba a assinatura das ownKeys", async () => {
  const handler = createSignR2UrlsHandler(makeDeps({
    createUserDb: () => { throw new Error("boom"); },
  }));
  const res = await handler(makeReq("POST", { keys: [POPUP_KEY, "contas/conta-abc/files/own.png"] }));
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.urls[POPUP_KEY], undefined);
  assertEquals(data.urls["contas/conta-abc/files/own.png"], "https://r2.example.com/contas/conta-abc/files/own.png?signed=1");
});

Deno.test("consulta de popups só roda quando há otherKeys", async () => {
  let called = 0;
  const handler = createSignR2UrlsHandler(makeDeps({
    createUserDb: (h) => { called++; return userDbReturning([])(h); },
  }));
  await handler(makeReq("POST", { keys: ["contas/conta-abc/files/own.png"] }));
  assertEquals(called, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run test:functions -- --filter "popup"; git checkout deno.lock
```

Esperado: os 4 novos falham (a chave de popup não é assinada; `createUserDb` nunca é chamado).

- [ ] **Step 3: Implementar no handler**

Em `supabase/functions/sign-r2-urls/handler.ts`:

1. Acrescente a dep à interface:

```ts
interface SignR2UrlsDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  /** Client no contexto do usuário (anon key + Authorization do request): a RLS decide o que ele vê. */
  createUserDb: (authHeader: string) => { from: (table: string) => any };
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
  getObjectBytes: (key: string) => Promise<Uint8Array | null>;
}
```

2. Acrescente a função auxiliar acima de `createSignR2UrlsHandler`:

```ts
const POPUP_LOOKUP_TIMEOUT_MS = 3_000;

/**
 * image_key das páginas de popups que a RLS de global_popups devolve para este usuário
 * (ativo, dentro da janela, alvo do workspace). Isolado: qualquer falha ou timeout
 * vira "nenhuma chave", nunca um 500, porque este endpoint também assina as ownKeys
 * do editor de post, drawers e capas de artigo. try/catch sozinho não segura um I/O
 * que trava; o AbortSignal é o que garante a resposta.
 */
async function visiblePopupImageKeys(deps: SignR2UrlsDeps, authHeader: string): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const userDb = deps.createUserDb(authHeader);
    const { data, error } = await userDb
      .from("global_popups")
      .select("pages")
      .abortSignal(AbortSignal.timeout(POPUP_LOOKUP_TIMEOUT_MS));
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ pages?: unknown }>) {
      if (!Array.isArray(row.pages)) continue;
      for (const page of row.pages as Array<{ image_key?: unknown }>) {
        if (typeof page?.image_key === "string" && page.image_key) keys.add(page.image_key);
      }
    }
  } catch (err) {
    console.error("[sign-r2-urls] popup image lookup failed:", err);
  }
  return keys;
}
```

3. No ramo POST, troque o bloco `const validKeys = [...ownKeys, ...kbKeys];` por:

```ts
    let popupKeys: string[] = [];
    if (otherKeys.length > 0) {
      const visible = await visiblePopupImageKeys(deps, req.headers.get("Authorization")!);
      popupKeys = otherKeys.filter((k) => visible.has(k) && !kbKeys.includes(k));
    }

    const validKeys = [...ownKeys, ...kbKeys, ...popupKeys];
```

(`Authorization` já foi validado não-nulo por `resolveContaId`.)

4. Em `supabase/functions/sign-r2-urls/index.ts`:

```ts
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(createSignR2UrlsHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
  createUserDb: (authHeader) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  }),
  signGetUrl,
  getObjectBytes,
}));
```

- [ ] **Step 4: Rodar a suíte inteira do sign-r2-urls e o check**

```bash
npm run test:functions -- --filter "sign"; npm run test:functions -- --filter "popup"; npm run check:functions; git checkout deno.lock
```

Esperado: todos `ok` (os antigos continuam passando com a dep default de `makeDeps`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sign-r2-urls/handler.ts supabase/functions/sign-r2-urls/index.ts supabase/functions/__tests__/sign-r2-urls_test.ts
git commit -m "feat(popups): sign-r2-urls assina imagens de popups visíveis pela RLS do usuário, com timeout"
```

---
### Task 5: `PopupCard` compartilhado em `packages/ui`

**Spec:** Parte 2, seção `packages/ui/PopupCard.tsx` (props, navegação por posição, estilo, defaults).

**Files:**
- Create: `packages/ui/PopupCard.tsx`
- Create: `packages/ui/__tests__/PopupCard.test.tsx`

**Interfaces:**
- Produces (import por caminho `@mesaas/ui/PopupCard`, como `FlagIcon`):

```ts
export interface PopupCardPage { title: string; eyebrow?: string | null; body: string; imageUrl?: string | null }
export interface PopupCardProps {
  pages: PopupCardPage[];
  page: number;
  onPageChange: (index: number) => void;
  ctaLabel?: string | null;
  ctaStyle: 'ink' | 'brand';
  secondaryLabel: string;
  requireAck: boolean;
  sanitizeHref: (href: string) => string;
  onCta?: () => void;
  onSecondary: () => void;
  onClose: () => void;
  titleId?: string;
  bodyId?: string;
}
export function defaultSecondaryLabel(requireAck: boolean, hasCta: boolean): string
export function PopupCard(props: PopupCardProps): JSX.Element
```

- [ ] **Step 1: Escrever os testes (falham)**

Crie `packages/ui/__tests__/PopupCard.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PopupCard, defaultSecondaryLabel, type PopupCardProps } from '../PopupCard';

const pages = [
  { title: 'Um', body: 'corpo **um**', eyebrow: 'Novo' },
  { title: 'Dois', body: 'corpo dois' },
  { title: 'Três', body: 'veja [o guia](https://x.y/guia)' },
];

function renderCard(over: Partial<PopupCardProps> = {}) {
  const props: PopupCardProps = {
    pages,
    page: 0,
    onPageChange: vi.fn(),
    ctaLabel: 'Ver',
    ctaStyle: 'ink',
    secondaryLabel: 'Agora não',
    requireAck: false,
    sanitizeHref: (h) => (h.startsWith('https://') ? h : '#'),
    onCta: vi.fn(),
    onSecondary: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { ...render(<PopupCard {...props} />), props };
}

describe('defaultSecondaryLabel', () => {
  it('Entendi com confirmação, Agora não com CTA, Fechar sem nada', () => {
    expect(defaultSecondaryLabel(true, true)).toBe('Entendi');
    expect(defaultSecondaryLabel(true, false)).toBe('Entendi');
    expect(defaultSecondaryLabel(false, true)).toBe('Agora não');
    expect(defaultSecondaryLabel(false, false)).toBe('Fechar');
  });
});

describe('PopupCard navegação por posição', () => {
  it('primeira página: só Próximo, sem Voltar, sem CTA; eyebrow com "1 de 3"', () => {
    renderCard();
    expect(screen.getByText('Novo · 1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agora não' })).toBeNull();
  });

  it('página do meio: Voltar e Próximo chamam onPageChange; sem eyebrow mostra só "2 de 3"', () => {
    const { props } = renderCard({ page: 1 });
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(props.onPageChange).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(props.onPageChange).toHaveBeenCalledWith(2);
  });

  it('última página: Voltar, CTA e secundário; sem Próximo', () => {
    const { props } = renderCard({ page: 2 });
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Próximo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(props.onCta).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(props.onSecondary).toHaveBeenCalled();
  });

  it('página única: sem pontinhos, sem contador, CTA + secundário', () => {
    renderCard({ pages: [pages[0]], page: 0 });
    expect(screen.queryByRole('button', { name: /Página 1 de/ })).toBeNull();
    expect(screen.getByText('Novo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver' })).toBeInTheDocument();
  });

  it('pontinhos trocam de página e marcam a atual', () => {
    const { props } = renderCard({ page: 0 });
    const dot3 = screen.getByRole('button', { name: 'Página 3 de 3' });
    fireEvent.click(dot3);
    expect(props.onPageChange).toHaveBeenCalledWith(2);
    expect(screen.getByRole('button', { name: 'Página 1 de 3' })).toHaveAttribute('aria-current', 'true');
  });
});

describe('PopupCard fechar, confirmação e conteúdo', () => {
  it('X chama onClose; some com requireAck', () => {
    const { props, unmount } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(props.onClose).toHaveBeenCalled();
    unmount();
    renderCard({ requireAck: true, page: 2, ctaLabel: null, secondaryLabel: 'Entendi' });
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Entendi' })).toBeInTheDocument();
  });

  it('renderiza markdown e sanitiza links', () => {
    renderCard({ page: 2 });
    const link = screen.getByRole('link', { name: 'o guia' });
    expect(link).toHaveAttribute('href', 'https://x.y/guia');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('imagem só quando imageUrl existe; titleId e bodyId aplicados', () => {
    // A imagem é decorativa (alt=""), então não tem role "img": consulte o DOM direto.
    const { container } = renderCard({
      pages: [{ ...pages[0], imageUrl: 'https://img/x.png' }],
      titleId: 't1',
      bodyId: 'b1',
    });
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://img/x.png');
    expect(document.getElementById('t1')?.textContent).toBe('Um');
    expect(document.getElementById('b1')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run packages/ui/__tests__/PopupCard.test.tsx
```

Esperado: falha ao resolver `../PopupCard`.

- [ ] **Step 3: Implementar o card**

Crie `packages/ui/PopupCard.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Card do popup global (spec 2026-09-04). Puramente visual e controlado: quem monta
 * decide a página, os labels e o que cada botão faz. Usado pelo preview do admin e
 * pelo GlobalPopupHost do CRM, por isso não importa nada de apps/*.
 *
 * Tokens legados do CRM com fallback claro: no CRM segue o tema (light/dark), no
 * admin renderiza claro. Layout com Tailwind (ambos os apps compilam packages/**).
 */
export interface PopupCardPage {
  title: string;
  eyebrow?: string | null;
  body: string;
  imageUrl?: string | null;
}

export interface PopupCardProps {
  pages: PopupCardPage[];
  page: number;
  onPageChange: (index: number) => void;
  ctaLabel?: string | null;
  ctaStyle: 'ink' | 'brand';
  secondaryLabel: string;
  requireAck: boolean;
  sanitizeHref: (href: string) => string;
  onCta?: () => void;
  onSecondary: () => void;
  onClose: () => void;
  titleId?: string;
  bodyId?: string;
}

export function defaultSecondaryLabel(requireAck: boolean, hasCta: boolean): string {
  if (requireAck) return 'Entendi';
  return hasCta ? 'Agora não' : 'Fechar';
}

const card: CSSProperties = {
  background: 'var(--card-bg, #ffffff)',
  color: 'var(--text-main, #12151a)',
  border: '1px solid var(--border-color, rgba(30,36,48,.1))',
  borderRadius: 12,
  boxShadow: '0 24px 60px rgba(0,0,0,.28)',
  overflow: 'hidden',
  fontFamily: 'var(--font-main, -apple-system, "SF Pro Text", system-ui, sans-serif)',
  width: '100%',
  maxWidth: 420,
};

const muted: CSSProperties = { color: 'var(--text-muted, #374151)' };

const btnBase: CSSProperties = {
  height: 40,
  padding: '0 16px',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid transparent',
  cursor: 'pointer',
};

const btnStyles: Record<'ink' | 'brand' | 'ghost' | 'link', CSSProperties> = {
  ink: { ...btnBase, background: '#12151a', color: '#ffffff' },
  brand: { ...btnBase, background: '#ffbf30', color: '#12151a' },
  ghost: {
    ...btnBase,
    background: 'transparent',
    color: 'var(--text-muted, #374151)',
    borderColor: 'var(--border-color, rgba(30,36,48,.16))',
  },
  link: { ...btnBase, background: 'transparent', color: 'var(--text-muted, #374151)', padding: '0 6px' },
};

function Btn({
  kind,
  onClick,
  children,
  className,
}: {
  kind: keyof typeof btnStyles;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} style={btnStyles[kind]} className={className}>
      {children}
    </button>
  );
}

export function PopupCard({
  pages,
  page,
  onPageChange,
  ctaLabel,
  ctaStyle,
  secondaryLabel,
  requireAck,
  sanitizeHref,
  onCta,
  onSecondary,
  onClose,
  titleId,
  bodyId,
}: PopupCardProps) {
  const total = pages.length;
  const index = Math.min(Math.max(page, 0), total - 1);
  const current = pages[index];
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const multi = total > 1;
  const hasCta = Boolean(ctaLabel && onCta);

  const counter = multi ? `${index + 1} de ${total}` : null;
  const eyebrow = current.eyebrow
    ? counter
      ? `${current.eyebrow} · ${counter}`
      : current.eyebrow
    : counter;

  const closeButton = !requireAck && (
    <button
      type="button"
      aria-label="Fechar"
      onClick={onClose}
      className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-base leading-none"
      style={
        current.imageUrl
          ? { background: 'rgba(18,21,26,.55)', color: '#fff' }
          : { background: 'transparent', color: 'var(--text-muted, #4b5563)' }
      }
    >
      ×
    </button>
  );

  const dots = multi && (
    <div className="flex items-center gap-1.5" role="group" aria-label="Páginas">
      {pages.map((_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Página ${i + 1} de ${total}`}
          aria-current={i === index ? 'true' : undefined}
          onClick={() => onPageChange(i)}
          className="block h-1.5 rounded-full transition-all"
          style={{
            width: i === index ? 16 : 6,
            background: i === index ? 'var(--text-main, #12151a)' : 'rgba(128,128,128,.35)',
            border: 0,
            padding: 0,
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );

  return (
    <div style={card} className="relative" data-popup-page={index}>
      {current.imageUrl ? (
        <div className="relative" style={{ aspectRatio: '16 / 9' }}>
          <img
            src={current.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{ display: 'block' }}
          />
          {closeButton}
        </div>
      ) : (
        closeButton
      )}

      <div className="relative px-[22px] pb-[22px] pt-5">
        {eyebrow && (
          <div
            className="mb-1.5 text-[11px] font-bold uppercase tracking-[.08em]"
            style={{ color: '#ca8a04' }}
          >
            {eyebrow}
          </div>
        )}
        <h2
          id={titleId}
          className="m-0 mb-2 text-[19px] font-bold leading-tight tracking-[-.01em]"
          style={{ fontFamily: 'var(--font-heading, inherit)' }}
        >
          {current.title}
        </h2>
        <div id={bodyId} className="text-sm leading-relaxed" style={muted}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="m-0 [&+p]:mt-2">{children}</p>,
              ul: ({ children }) => <ul className="mt-2 list-disc pl-[18px]">{children}</ul>,
              ol: ({ children }) => <ol className="mt-2 list-decimal pl-[18px]">{children}</ol>,
              a: ({ href, children }) => (
                <a
                  href={sanitizeHref(href ?? '')}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'underline' }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {current.body}
          </ReactMarkdown>
        </div>

        {multi && !isLast && (
          <div className="mt-[18px] flex items-center justify-between gap-2.5">
            {isFirst ? <span /> : <Btn kind="link" onClick={() => onPageChange(index - 1)}>Voltar</Btn>}
            {dots}
            <Btn kind={ctaStyle} onClick={() => onPageChange(index + 1)}>
              Próximo
            </Btn>
          </div>
        )}

        {isLast && (
          <div className="mt-[18px] flex flex-col gap-2">
            {multi && (
              <div className="flex items-center justify-between">
                <Btn kind="link" onClick={() => onPageChange(index - 1)}>
                  Voltar
                </Btn>
                {dots}
              </div>
            )}
            <div className="flex flex-col gap-2.5 sm:flex-row">
              {hasCta && (
                <Btn kind={ctaStyle} onClick={onCta} className="flex-1">
                  {ctaLabel}
                </Btn>
              )}
              <Btn kind="ghost" onClick={onSecondary} className="flex-1">
                {secondaryLabel}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar; typecheck**

```bash
npx vitest run packages/ui/__tests__/PopupCard.test.tsx && npx tsc -p apps/crm/tsconfig.json --noEmit
```

Esperado: 9 testes passam. (O CRM ainda não importa o card; o `tsc` aqui só confirma que nada quebrou. Se `react-markdown` reclamar de tipos de `components`, tipar os handlers com `ComponentProps<'a'>` como o `GlobalBannerContainer` faz.)

- [ ] **Step 5: Commit**

```bash
npm run format && git add packages/ui/PopupCard.tsx packages/ui/__tests__/PopupCard.test.tsx
git commit -m "feat(popups): PopupCard compartilhado em packages/ui com navegação por páginas"
```

---

### Task 6: Admin: alias `@mesaas/ui`, tipos e API de popups, `TargetPicker` extraído

**Spec:** Parte 2, seções "Rota, navegação e API" (alias e API) e "TargetPicker".

**Files:**
- Modify: `apps/admin/vite.config.ts` (alias)
- Modify: `apps/admin/tsconfig.json` (paths)
- Modify: `apps/admin/src/lib/api.ts` (tipos + 4 funções, após as de banner)
- Create: `apps/admin/src/components/TargetPicker.tsx`
- Create: `apps/admin/src/components/__tests__/TargetPicker.test.tsx`
- Modify: `apps/admin/src/pages/BannersPage.tsx` (usa `TargetPicker`)

**Interfaces:**
- Produces:

```ts
// lib/api.ts
export interface PopupPage { title: string; eyebrow: string | null; body: string; image_key: string | null }
export interface GlobalPopup {
  id: string; pages: PopupPage[];
  cta_label: string | null; cta_url: string | null; cta_style: 'ink' | 'brand';
  secondary_label: string | null; frequency: 'once' | 'until_cta'; require_ack: boolean;
  target_mode: 'all' | 'plan' | 'workspace'; target_plan_ids: string[] | null; target_workspace_ids: string[] | null;
  starts_at: string | null; ends_at: string | null; status: 'draft' | 'active' | 'archived';
  created_by: string | null; created_at: string; updated_at: string;
  counts: { seen: number; closed: number; cta: number; ack: number };
}
export function listPopups(params?: { status?: string }): Promise<{ popups: GlobalPopup[] }>
export function createPopup(params: Record<string, unknown>): Promise<{ popup: GlobalPopup }>
export function updatePopup(params: Record<string, unknown>): Promise<{ popup: GlobalPopup }>
export function deletePopup(popup_id: string): Promise<{ message: string }>

// components/TargetPicker.tsx
export type TargetMode = 'all' | 'plan' | 'workspace';
export interface TargetValue { target_mode: TargetMode; target_plan_ids: string[]; target_workspace_ids: string[] }
export function TargetPicker(props: {
  value: TargetValue;
  plans: { id: string; name: string }[] | undefined;
  workspaces: { id: string; name: string }[] | undefined;
  onChange: (next: TargetValue) => void;
}): JSX.Element
```

- [ ] **Step 1: Alias e API (sem teste próprio; o typecheck cobre)**

`apps/admin/vite.config.ts`, dentro de `resolve.alias`:

```ts
      '@mesaas/ui': path.resolve(__dirname, '../../packages/ui'),
```

`apps/admin/tsconfig.json`, dentro de `paths`:

```json
      "@mesaas/ui/*": ["../../packages/ui/*"]
```

`apps/admin/src/lib/api.ts`, logo após `deleteBanner`:

```ts
// ─── Popups ─────────────────────────────────────────────────

export interface PopupPage {
  title: string;
  eyebrow: string | null;
  body: string;
  image_key: string | null;
}

export interface GlobalPopup {
  id: string;
  pages: PopupPage[];
  cta_label: string | null;
  cta_url: string | null;
  cta_style: 'ink' | 'brand';
  secondary_label: string | null;
  frequency: 'once' | 'until_cta';
  require_ack: boolean;
  target_mode: 'all' | 'plan' | 'workspace';
  target_plan_ids: string[] | null;
  target_workspace_ids: string[] | null;
  starts_at: string | null;
  ends_at: string | null;
  status: 'draft' | 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  counts: { seen: number; closed: number; cta: number; ack: number };
}

export function listPopups(params?: { status?: string }) {
  return adminApi<{ popups: GlobalPopup[] }>('list-popups', params || {});
}

export function createPopup(params: Record<string, unknown>) {
  return adminApi<{ popup: GlobalPopup }>('create-popup', params);
}

export function updatePopup(params: Record<string, unknown>) {
  return adminApi<{ popup: GlobalPopup }>('update-popup', params);
}

export function deletePopup(popup_id: string) {
  return adminApi<{ message: string }>('delete-popup', { popup_id });
}
```

- [ ] **Step 2: Teste do `TargetPicker` (falha)**

Crie `apps/admin/src/components/__tests__/TargetPicker.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TargetPicker, type TargetValue } from '../TargetPicker';

const plans = [{ id: 'free', name: 'Free' }, { id: 'pro', name: 'Pro' }];
const workspaces = [{ id: 'w1', name: 'Agência A' }, { id: 'w2', name: 'Agência B' }];

function setup(value: TargetValue) {
  const onChange = vi.fn();
  render(<TargetPicker value={value} plans={plans} workspaces={workspaces} onChange={onChange} />);
  return onChange;
}

describe('TargetPicker', () => {
  it('trocar de modo limpa as seleções', () => {
    const onChange = setup({ target_mode: 'plan', target_plan_ids: ['pro'], target_workspace_ids: [] });
    fireEvent.click(screen.getByLabelText('By Workspace'));
    expect(onChange).toHaveBeenCalledWith({ target_mode: 'workspace', target_plan_ids: [], target_workspace_ids: [] });
  });

  it('modo plan mostra chips de plano e alterna a seleção', () => {
    const onChange = setup({ target_mode: 'plan', target_plan_ids: ['pro'], target_workspace_ids: [] });
    expect(screen.queryByText('Agência A')).toBeNull();
    fireEvent.click(screen.getByLabelText('Free'));
    expect(onChange).toHaveBeenCalledWith({ target_mode: 'plan', target_plan_ids: ['pro', 'free'], target_workspace_ids: [] });
    fireEvent.click(screen.getByLabelText('Pro'));
    expect(onChange).toHaveBeenCalledWith({ target_mode: 'plan', target_plan_ids: [], target_workspace_ids: [] });
  });

  it('modo workspace mostra chips de workspace', () => {
    const onChange = setup({ target_mode: 'workspace', target_plan_ids: [], target_workspace_ids: [] });
    fireEvent.click(screen.getByLabelText('Agência B'));
    expect(onChange).toHaveBeenCalledWith({ target_mode: 'workspace', target_plan_ids: [], target_workspace_ids: ['w2'] });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
npx vitest run apps/admin/src/components/__tests__/TargetPicker.test.tsx
```

- [ ] **Step 4: Implementar o `TargetPicker` (markup movido da `BannersPage`)**

Crie `apps/admin/src/components/TargetPicker.tsx`:

```tsx
export type TargetMode = 'all' | 'plan' | 'workspace';

export interface TargetValue {
  target_mode: TargetMode;
  target_plan_ids: string[];
  target_workspace_ids: string[];
}

const TARGET_MODES: TargetMode[] = ['all', 'plan', 'workspace'];
const MODE_LABEL: Record<TargetMode, string> = { all: 'All', plan: 'By Plan', workspace: 'By Workspace' };

interface Option {
  id: string;
  name: string;
}

interface TargetPickerProps {
  value: TargetValue;
  plans: Option[] | undefined;
  workspaces: Option[] | undefined;
  onChange: (next: TargetValue) => void;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Chips({
  options,
  selected,
  onToggle,
  scroll,
}: {
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
  scroll?: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${scroll ? 'max-h-40 overflow-y-auto' : ''}`}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <label
            key={o.id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
              on
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'bg-secondary text-muted-foreground border border-transparent'
            }`}
          >
            <input type="checkbox" className="hidden" checked={on} onChange={() => onToggle(o.id)} />
            {o.name}
          </label>
        );
      })}
    </div>
  );
}

/** Radios All / By Plan / By Workspace + chips. Compartilhado entre Banners e Popups. */
export function TargetPicker({ value, plans, workspaces, onChange }: TargetPickerProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Target
      </label>
      <div className="flex gap-3 mb-3">
        {TARGET_MODES.map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="radio"
              name="target_mode"
              value={m}
              checked={value.target_mode === m}
              onChange={() =>
                onChange({ target_mode: m, target_plan_ids: [], target_workspace_ids: [] })
              }
            />
            {MODE_LABEL[m]}
          </label>
        ))}
      </div>

      {value.target_mode === 'plan' && plans && (
        <Chips
          options={plans}
          selected={value.target_plan_ids}
          onToggle={(id) => onChange({ ...value, target_plan_ids: toggle(value.target_plan_ids, id) })}
        />
      )}

      {value.target_mode === 'workspace' && workspaces && (
        <Chips
          scroll
          options={workspaces}
          selected={value.target_workspace_ids}
          onToggle={(id) =>
            onChange({ ...value, target_workspace_ids: toggle(value.target_workspace_ids, id) })
          }
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Trocar o bloco inline da `BannersPage` pelo componente**

Em `apps/admin/src/pages/BannersPage.tsx`:

1. Importe: `import { TargetPicker } from '../components/TargetPicker';`
2. Remova a constante `TARGET_MODES` (fica sem uso).
3. Substitua todo o `<div>` que começa com `<label ...>Target</label>` e termina após o bloco `{form.target_mode === 'workspace' && workspacesData?.workspaces && (...)}` por:

```tsx
              <TargetPicker
                value={{
                  target_mode: form.target_mode,
                  target_plan_ids: form.target_plan_ids,
                  target_workspace_ids: form.target_workspace_ids,
                }}
                plans={plansData?.plans}
                workspaces={workspacesData?.workspaces}
                onChange={(next) => setForm((f) => ({ ...f, ...next }))}
              />
```

- [ ] **Step 6: Rodar testes, typecheck do admin e lint**

```bash
npx vitest run apps/admin && npx tsc -p apps/admin/tsconfig.json --noEmit && npm run lint
```

Esperado: `TargetPicker` 3 testes passam; suíte do admin verde; `tsc` limpo (se acusar `TARGET_MODES` sem uso, é o passo 5.2 faltando).

- [ ] **Step 7: Commit**

```bash
npm run format && git add apps/admin/vite.config.ts apps/admin/tsconfig.json apps/admin/src/lib/api.ts apps/admin/src/components/TargetPicker.tsx apps/admin/src/components/__tests__/TargetPicker.test.tsx apps/admin/src/pages/BannersPage.tsx
git commit -m "feat(popups): API de popups no admin, alias @mesaas/ui e TargetPicker extraído dos banners"
```

---
### Task 7: `popup-form.ts` (estado, validação e payload do editor, puro)

**Spec:** Parte 2, seções "Editor" e "Validação no formulário"; Parte 1 "Semântica de já viu" (`require_ack` força `once`).

**Files:**
- Create: `apps/admin/src/pages/popup-form.ts`
- Create: `apps/admin/src/pages/__tests__/popup-form.test.ts`

**Interfaces:**
- Consumes: `GlobalPopup`, `PopupPage` (Task 6).
- Produces:

```ts
export const MAX_PAGES = 6;
export interface PageForm { key: string; title: string; eyebrow: string; body: string; image_key: string }
export interface PopupFormState {
  pages: PageForm[]; cta_label: string; cta_url: string; secondary_label: string;
  cta_style: 'ink' | 'brand'; frequency: 'once' | 'until_cta'; require_ack: boolean;
  target_mode: 'all' | 'plan' | 'workspace'; target_plan_ids: string[]; target_workspace_ids: string[];
  starts_at: string; ends_at: string; status: 'draft' | 'active' | 'archived';
}
export interface PopupFormErrors { pages: Record<number, { title?: string; eyebrow?: string; body?: string }>; cta?: string; frequency?: string; target?: string }
export function newPage(): PageForm
export function emptyForm(): PopupFormState
export function popupToForm(p: GlobalPopup): PopupFormState
export function formToPayload(f: PopupFormState): Record<string, unknown>   // sem `key`
export function validateForm(f: PopupFormState): PopupFormErrors | null
export function withRequireAck(f: PopupFormState, on: boolean): PopupFormState
export function addPage(f): PopupFormState; removePage(f, index): PopupFormState; movePage(f, from, to): PopupFormState
export function pageHasContent(p: PageForm): boolean
```

- [ ] **Step 1: Escrever os testes (falham)**

Crie `apps/admin/src/pages/__tests__/popup-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GlobalPopup } from '../../lib/api';
import {
  MAX_PAGES,
  addPage,
  emptyForm,
  formToPayload,
  movePage,
  newPage,
  pageHasContent,
  popupToForm,
  removePage,
  validateForm,
  withRequireAck,
} from '../popup-form';

const popup: GlobalPopup = {
  id: 'p1',
  pages: [
    { title: 'Um', eyebrow: 'Novo', body: 'b1', image_key: 'contas/x/files/a.png' },
    { title: 'Dois', eyebrow: null, body: 'b2', image_key: null },
  ],
  cta_label: 'Ver',
  cta_url: '/ajuda',
  cta_style: 'brand',
  secondary_label: null,
  frequency: 'until_cta',
  require_ack: false,
  target_mode: 'plan',
  target_plan_ids: ['pro'],
  target_workspace_ids: null,
  starts_at: '2026-09-02T12:00:00.000Z',
  ends_at: null,
  status: 'active',
  created_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  counts: { seen: 0, closed: 0, cta: 0, ack: 0 },
};

describe('popupToForm / formToPayload', () => {
  it('vai e volta sem o key e com nulos no lugar de vazios', () => {
    const form = popupToForm(popup);
    expect(form.pages).toHaveLength(2);
    expect(form.pages[0].key).not.toBe(form.pages[1].key);
    expect(form.pages[1].eyebrow).toBe('');
    expect(form.starts_at).toBe(popup.starts_at!.slice(0, 16));

    const payload = formToPayload(form);
    expect(payload.pages).toEqual([
      { title: 'Um', eyebrow: 'Novo', body: 'b1', image_key: 'contas/x/files/a.png' },
      { title: 'Dois', eyebrow: null, body: 'b2', image_key: null },
    ]);
    expect(JSON.stringify(payload)).not.toContain('"key"');
    expect(payload.secondary_label).toBeNull();
    expect(payload.target_plan_ids).toEqual(['pro']);
    expect(payload.target_workspace_ids).toBeNull();
    expect(payload.ends_at).toBeNull();
    expect(typeof payload.starts_at).toBe('string');
  });

  it('formulário vazio tem uma página e defaults da spec', () => {
    const f = emptyForm();
    expect(f.pages).toHaveLength(1);
    expect(f.cta_style).toBe('ink');
    expect(f.frequency).toBe('once');
    expect(f.require_ack).toBe(false);
    expect(f.status).toBe('draft');
  });
});

describe('validateForm', () => {
  const valid = (): ReturnType<typeof emptyForm> => {
    const f = emptyForm();
    f.pages[0].title = 'T';
    f.pages[0].body = 'B';
    return f;
  };

  it('null quando válido', () => {
    expect(validateForm(valid())).toBeNull();
  });

  it('página sem título ou corpo, com o índice certo', () => {
    const f = addPage(valid());
    const e = validateForm(f)!;
    expect(e.pages[1]).toEqual({ title: 'Title is required', body: 'Body is required' });
    expect(e.pages[0]).toBeUndefined();
  });

  it('CTA pela metade, URL com prefixo errado, until_cta sem CTA', () => {
    let f = { ...valid(), cta_label: 'Ver' };
    expect(validateForm(f)!.cta).toBe('CTA needs both a label and a URL');
    f = { ...valid(), cta_label: 'Ver', cta_url: 'ajuda' };
    expect(validateForm(f)!.cta).toBe('CTA URL must start with / or http(s)://');
    f = { ...valid(), cta_label: 'Ver', cta_url: '//evil.com' };
    expect(validateForm(f)!.cta).toBe('CTA URL must start with / or http(s)://');
    f = { ...valid(), frequency: 'until_cta' };
    expect(validateForm(f)!.frequency).toBe('"Until CTA" needs a CTA');
  });

  it('target por plano ou workspace sem seleção', () => {
    const f = { ...valid(), target_mode: 'plan' as const };
    expect(validateForm(f)!.target).toBe('Select at least one plan');
    const g = { ...valid(), target_mode: 'workspace' as const };
    expect(validateForm(g)!.target).toBe('Select at least one workspace');
  });

  it('limites de tamanho', () => {
    const f = valid();
    f.pages[0].title = 'x'.repeat(121);
    expect(validateForm(f)!.pages[0].title).toBe('Max 120 characters');
    const g = { ...valid(), cta_label: 'x'.repeat(41), cta_url: '/x' };
    expect(validateForm(g)!.cta).toBe('CTA label max 40 characters');
    const h = valid();
    h.pages[0].eyebrow = 'x'.repeat(61);
    expect(validateForm(h)!.pages[0]).toEqual({ eyebrow: 'Max 60 characters' });
  });
});

describe('páginas', () => {
  it('addPage respeita MAX_PAGES; removePage nunca deixa zero; movePage reordena', () => {
    let f = emptyForm();
    for (let i = 0; i < 10; i++) f = addPage(f);
    expect(f.pages).toHaveLength(MAX_PAGES);
    f = removePage(f, 0);
    expect(f.pages).toHaveLength(MAX_PAGES - 1);
    let one = emptyForm();
    one = removePage(one, 0);
    expect(one.pages).toHaveLength(1);

    const a = newPage();
    const b = newPage();
    const c = newPage();
    const moved = movePage({ ...emptyForm(), pages: [a, b, c] }, 2, 0);
    expect(moved.pages.map((p) => p.key)).toEqual([c.key, a.key, b.key]);
  });

  it('pageHasContent', () => {
    expect(pageHasContent(newPage())).toBe(false);
    expect(pageHasContent({ ...newPage(), body: 'x' })).toBe(true);
    expect(pageHasContent({ ...newPage(), image_key: 'k' })).toBe(true);
  });

  it('withRequireAck força frequency = once; desligar mantém once', () => {
    const f = { ...emptyForm(), frequency: 'until_cta' as const };
    const on = withRequireAck(f, true);
    expect(on.require_ack).toBe(true);
    expect(on.frequency).toBe('once');
    const off = withRequireAck(on, false);
    expect(off.require_ack).toBe(false);
    expect(off.frequency).toBe('once');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/admin/src/pages/__tests__/popup-form.test.ts
```

- [ ] **Step 3: Implementar**

Crie `apps/admin/src/pages/popup-form.ts`:

```ts
import type { GlobalPopup } from '../lib/api';

export const MAX_PAGES = 6;
const MAX_TITLE = 120;
const MAX_EYEBROW = 60;
const MAX_BODY = 2000;
const MAX_LABEL = 40;
const MAX_URL = 2048;
const CTA_URL_RE = /^(\/(?!\/)|https?:\/\/)/; // `//host` é protocol-relative, não caminho interno

export interface PageForm {
  /** Identidade estável para o dnd-kit e o React. Nunca vai para o payload. */
  key: string;
  title: string;
  eyebrow: string;
  body: string;
  image_key: string;
}

export interface PopupFormState {
  pages: PageForm[];
  cta_label: string;
  cta_url: string;
  secondary_label: string;
  cta_style: 'ink' | 'brand';
  frequency: 'once' | 'until_cta';
  require_ack: boolean;
  target_mode: 'all' | 'plan' | 'workspace';
  target_plan_ids: string[];
  target_workspace_ids: string[];
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active' | 'archived';
}

export interface PopupFormErrors {
  pages: Record<number, { title?: string; eyebrow?: string; body?: string }>;
  cta?: string;
  frequency?: string;
  target?: string;
}

let pageKeyCounter = 0;

export function newPage(): PageForm {
  pageKeyCounter += 1;
  return { key: `page-${pageKeyCounter}`, title: '', eyebrow: '', body: '', image_key: '' };
}

export function emptyForm(): PopupFormState {
  return {
    pages: [newPage()],
    cta_label: '',
    cta_url: '',
    secondary_label: '',
    cta_style: 'ink',
    frequency: 'once',
    require_ack: false,
    target_mode: 'all',
    target_plan_ids: [],
    target_workspace_ids: [],
    starts_at: '',
    ends_at: '',
    status: 'draft',
  };
}

export function popupToForm(p: GlobalPopup): PopupFormState {
  return {
    pages: p.pages.map((pg) => ({
      ...newPage(),
      title: pg.title,
      eyebrow: pg.eyebrow ?? '',
      body: pg.body,
      image_key: pg.image_key ?? '',
    })),
    cta_label: p.cta_label ?? '',
    cta_url: p.cta_url ?? '',
    secondary_label: p.secondary_label ?? '',
    cta_style: p.cta_style,
    frequency: p.frequency,
    require_ack: p.require_ack,
    target_mode: p.target_mode,
    target_plan_ids: p.target_plan_ids ?? [],
    target_workspace_ids: p.target_workspace_ids ?? [],
    starts_at: p.starts_at ? p.starts_at.slice(0, 16) : '',
    ends_at: p.ends_at ? p.ends_at.slice(0, 16) : '',
    status: p.status,
  };
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

export function formToPayload(f: PopupFormState): Record<string, unknown> {
  return {
    pages: f.pages.map((pg) => ({
      title: pg.title.trim(),
      eyebrow: orNull(pg.eyebrow),
      body: pg.body.trim(),
      image_key: orNull(pg.image_key),
    })),
    cta_label: orNull(f.cta_label),
    cta_url: orNull(f.cta_url),
    secondary_label: orNull(f.secondary_label),
    cta_style: f.cta_style,
    frequency: f.frequency,
    require_ack: f.require_ack,
    target_mode: f.target_mode,
    target_plan_ids: f.target_mode === 'plan' ? f.target_plan_ids : null,
    target_workspace_ids: f.target_mode === 'workspace' ? f.target_workspace_ids : null,
    starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
    ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
    status: f.status,
  };
}

export function validateForm(f: PopupFormState): PopupFormErrors | null {
  const errors: PopupFormErrors = { pages: {} };
  let any = false;

  f.pages.forEach((pg, i) => {
    const e: { title?: string; eyebrow?: string; body?: string } = {};
    if (!pg.title.trim()) e.title = 'Title is required';
    else if (pg.title.trim().length > MAX_TITLE) e.title = `Max ${MAX_TITLE} characters`;
    if (!pg.body.trim()) e.body = 'Body is required';
    else if (pg.body.trim().length > MAX_BODY) e.body = `Max ${MAX_BODY} characters`;
    if (pg.eyebrow.trim().length > MAX_EYEBROW) e.eyebrow = `Max ${MAX_EYEBROW} characters`;
    if (e.title || e.body || e.eyebrow) {
      errors.pages[i] = e;
      any = true;
    }
  });

  const label = f.cta_label.trim();
  const url = f.cta_url.trim();
  if ((label === '') !== (url === '')) errors.cta = 'CTA needs both a label and a URL';
  else if (label.length > MAX_LABEL) errors.cta = `CTA label max ${MAX_LABEL} characters`;
  else if (url && !CTA_URL_RE.test(url)) errors.cta = 'CTA URL must start with / or http(s)://';
  else if (url.length > MAX_URL) errors.cta = `CTA URL max ${MAX_URL} characters`;
  else if (f.secondary_label.trim().length > MAX_LABEL) {
    errors.cta = `Secondary label max ${MAX_LABEL} characters`;
  }
  if (errors.cta) any = true;

  if (f.frequency === 'until_cta' && !url) {
    errors.frequency = '"Until CTA" needs a CTA';
    any = true;
  }

  if (f.target_mode === 'plan' && f.target_plan_ids.length === 0) {
    errors.target = 'Select at least one plan';
    any = true;
  } else if (f.target_mode === 'workspace' && f.target_workspace_ids.length === 0) {
    errors.target = 'Select at least one workspace';
    any = true;
  }

  return any ? errors : null;
}

/** Confirmação obrigatória implica frequência "once" (spec, Parte 1). */
export function withRequireAck(f: PopupFormState, on: boolean): PopupFormState {
  return { ...f, require_ack: on, frequency: on ? 'once' : f.frequency };
}

export function addPage(f: PopupFormState): PopupFormState {
  if (f.pages.length >= MAX_PAGES) return f;
  return { ...f, pages: [...f.pages, newPage()] };
}

export function removePage(f: PopupFormState, index: number): PopupFormState {
  if (f.pages.length <= 1) return f;
  return { ...f, pages: f.pages.filter((_, i) => i !== index) };
}

export function movePage(f: PopupFormState, from: number, to: number): PopupFormState {
  const pages = [...f.pages];
  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved);
  return { ...f, pages };
}

export function pageHasContent(p: PageForm): boolean {
  return Boolean(p.title.trim() || p.eyebrow.trim() || p.body.trim() || p.image_key);
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run apps/admin/src/pages/__tests__/popup-form.test.ts && npx tsc -p apps/admin/tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
npm run format && git add apps/admin/src/pages/popup-form.ts apps/admin/src/pages/__tests__/popup-form.test.ts
git commit -m "feat(popups): estado, validação e payload do formulário de popup (puro, testado)"
```

---

### Task 8: `PopupsPage` (lista + editor com abas e preview), rota e nav

**Spec:** Parte 2, seções "Rota, navegação e API", "PopupsPage", "Editor", "Imagem".

**Files:**
- Create: `apps/admin/src/pages/PopupsPage.tsx`
- Create: `apps/admin/src/pages/__tests__/PopupsPage.test.tsx`
- Modify: `apps/admin/src/router.tsx` (rota `popups` após `banners`)
- Modify: `apps/admin/src/layouts/AdminLayout.tsx` (import `AppWindow`, item de nav)

**Interfaces:**
- Consumes: `listPopups/createPopup/updatePopup/deletePopup/listPlans/listWorkspaces` (api), `TargetPicker` (Task 6), `popup-form.ts` (Task 7), `PopupCard`/`defaultSecondaryLabel` (Task 5), `uploadInlineImage`/`resolveInlineImageUrls` (`lib/inline-image.ts`, já existem).

- [ ] **Step 1: Escrever o teste da página (falha)**

Crie `apps/admin/src/pages/__tests__/PopupsPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listPopups: vi.fn(),
  createPopup: vi.fn(),
  updatePopup: vi.fn(),
  deletePopup: vi.fn(),
  listPlans: vi.fn(),
  listWorkspaces: vi.fn(),
}));
vi.mock('../../lib/inline-image', () => ({
  uploadInlineImage: vi.fn(),
  resolveInlineImageUrls: vi.fn(),
}));

import { createPopup, listPlans, listPopups, listWorkspaces } from '../../lib/api';
import { resolveInlineImageUrls } from '../../lib/inline-image';
import PopupsPage from '../PopupsPage';

const popup = {
  id: 'p1',
  pages: [
    { title: 'Analytics de Stories', eyebrow: 'Novo', body: 'b', image_key: null },
    { title: 'Segunda', eyebrow: null, body: 'b2', image_key: null },
  ],
  cta_label: 'Ver',
  cta_url: '/ajuda',
  cta_style: 'ink',
  secondary_label: null,
  frequency: 'once',
  require_ack: true,
  target_mode: 'all',
  target_plan_ids: null,
  target_workspace_ids: null,
  starts_at: null,
  ends_at: null,
  status: 'active',
  created_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  counts: { seen: 312, closed: 225, cta: 87, ack: 0 },
};

beforeEach(() => {
  vi.mocked(listPopups).mockResolvedValue({ popups: [popup] } as never);
  vi.mocked(listPlans).mockResolvedValue({ plans: [{ id: 'pro', name: 'Pro' }] } as never);
  vi.mocked(listWorkspaces).mockResolvedValue({ workspaces: [] } as never);
  vi.mocked(resolveInlineImageUrls).mockResolvedValue({});
  vi.mocked(createPopup).mockResolvedValue({ popup } as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PopupsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PopupsPage lista', () => {
  it('mostra título da primeira página, badge de páginas, frequência com ack e métricas', async () => {
    renderPage();
    expect(await screen.findByText('Analytics de Stories')).toBeInTheDocument();
    expect(screen.getByText('2 pages')).toBeInTheDocument();
    expect(screen.getByText('Once · ack')).toBeInTheDocument();
    expect(screen.getByText(/seen 312/)).toBeInTheDocument();
    expect(screen.getByText(/cta 87/)).toBeInTheDocument();
  });
});

describe('PopupsPage editor', () => {
  it('New Popup abre com uma aba; submit vazio mostra erros inline e não chama a API', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /New Popup/ }));
    expect(screen.getByRole('heading', { name: 'New Popup' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(createPopup).not.toHaveBeenCalled();
  });

  it('adiciona página, preenche, envia payload com pages e sem key; require ack desabilita frequência', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /New Popup/ }));

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Página 1' } });
    fireEvent.change(screen.getByLabelText('Body (Markdown)'), { target: { value: 'corpo 1' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Page' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Página 2' } });
    fireEvent.change(screen.getByLabelText('Body (Markdown)'), { target: { value: 'corpo 2' } });

    fireEvent.click(screen.getByLabelText(/Require acknowledgement/));
    expect(screen.getByLabelText('Every session until CTA')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createPopup).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createPopup).mock.calls[0][0];
    expect(payload.pages).toEqual([
      { title: 'Página 1', eyebrow: null, body: 'corpo 1', image_key: null },
      { title: 'Página 2', eyebrow: null, body: 'corpo 2', image_key: null },
    ]);
    expect(payload.require_ack).toBe(true);
    expect(payload.frequency).toBe('once');
    expect(JSON.stringify(payload)).not.toContain('"key"');
  });

  it('preview segue a aba selecionada', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Analytics de Stories'));
    expect(screen.getByRole('heading', { name: 'Edit Popup' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByRole('heading', { level: 2, name: 'Segunda' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/admin/src/pages/__tests__/PopupsPage.test.tsx
```

- [ ] **Step 3: Implementar a página**

Crie `apps/admin/src/pages/PopupsPage.tsx`:

```tsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Upload, Loader2, GripVertical, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PopupCard, defaultSecondaryLabel } from '@mesaas/ui/PopupCard';
import {
  listPopups,
  createPopup,
  updatePopup,
  deletePopup,
  listPlans,
  listWorkspaces,
  type GlobalPopup,
} from '../lib/api';
import { uploadInlineImage, resolveInlineImageUrls } from '../lib/inline-image';
import { TargetPicker } from '../components/TargetPicker';
import {
  MAX_PAGES,
  addPage,
  emptyForm,
  formToPayload,
  movePage,
  pageHasContent,
  popupToForm,
  removePage,
  validateForm,
  withRequireAck,
  type PageForm,
  type PopupFormErrors,
  type PopupFormState,
} from './popup-form';

const STATUSES = ['draft', 'active', 'archived'] as const;
const INPUT =
  'w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary';
const LABEL = 'block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5';

/** Só http(s) e caminhos relativos; o CRM usa sanitizeUrl, o preview segue a mesma regra. */
function previewHref(href: string): string {
  return /^(\/|https?:\/\/)/.test(href) ? href : '#';
}

const DARK_VARS = {
  '--card-bg': '#12151a',
  '--text-main': '#e8eaf0',
  '--text-muted': '#9ca3af',
  '--border-color': '#1e2430',
} as React.CSSProperties;

export default function PopupsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<GlobalPopup | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'popups', statusFilter],
    queryFn: () => listPopups(statusFilter ? { status: statusFilter } : undefined),
  });
  const { data: plansData } = useQuery({ queryKey: ['admin', 'plans'], queryFn: listPlans });
  const { data: workspacesData } = useQuery({
    queryKey: ['admin', 'workspaces-all'],
    queryFn: () => listWorkspaces({ limit: 500 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'popups'] });
  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const popups = (data?.popups || []).filter(
    (p) =>
      !search || p.pages.some((pg) => pg.title.toLowerCase().includes(search.toLowerCase())),
  );

  const isExpired = (p: GlobalPopup) =>
    p.status === 'active' && p.ends_at && new Date(p.ends_at) < new Date();

  const badge = (p: GlobalPopup) => {
    if (isExpired(p)) return { label: 'EXPIRED', cls: 'text-dim-foreground bg-secondary' };
    if (p.status === 'active') return { label: 'ACTIVE', cls: 'text-success bg-success/15' };
    if (p.status === 'draft') return { label: 'DRAFT', cls: 'text-muted-foreground bg-secondary' };
    return { label: 'ARCHIVED', cls: 'text-dim-foreground bg-secondary' };
  };

  const schedule = (p: GlobalPopup) => {
    const fmt = (s: string) =>
      new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    return `${p.starts_at ? fmt(p.starts_at) : 'Now'} → ${p.ends_at ? fmt(p.ends_at) : '∞'}`;
  };

  const targetLabel = (p: GlobalPopup) => {
    if (p.target_mode === 'all') return 'All workspaces';
    if (p.target_mode === 'plan') {
      return (p.target_plan_ids || [])
        .map((id) => plansData?.plans?.find((pl) => pl.id === id)?.name || id)
        .join(', ');
    }
    return `${(p.target_workspace_ids || []).length} workspaces`;
  };

  const frequencyLabel = (p: GlobalPopup) =>
    `${p.frequency === 'once' ? 'Once' : 'Until CTA'}${p.require_ack ? ' · ack' : ''}`;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="font-sf text-2xl font-bold mb-1">Popups</h1>
          <p className="text-sm text-muted-foreground">
            Modal announcements shown at most once per session inside the CRM
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors"
        >
          <Plus size={16} /> New Popup
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search popups..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground focus:outline-none focus:border-primary"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="hidden md:grid grid-cols-[2fr_0.8fr_1fr_1fr_0.7fr_0.4fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Title</span>
          <span>Frequency</span>
          <span>Target</span>
          <span>Schedule</span>
          <span>Status</span>
          <span></span>
        </div>

        {isLoading ? (
          <p className="text-sm text-dim-foreground py-4">Loading...</p>
        ) : popups.length === 0 ? (
          <p className="text-sm text-dim-foreground py-4">No popups found.</p>
        ) : (
          popups.map((p) => {
            const b = badge(p);
            const first = p.pages[0];
            const metrics = `seen ${p.counts.seen} · closed ${p.counts.closed} · cta ${p.counts.cta} · ack ${p.counts.ack}`;
            return (
              <div
                key={p.id}
                onClick={() => {
                  setEditing(p);
                  setShowForm(true);
                }}
                className={`cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 ${p.status === 'draft' ? 'opacity-50' : ''}`}
              >
                <div className="md:hidden flex flex-col gap-1.5">
                  <span className="text-sm font-medium truncate">{first?.title}</span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{frequencyLabel(p)}</span>
                    <span>{targetLabel(p)}</span>
                    <span className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm ${b.cls}`}>
                      {b.label}
                    </span>
                  </div>
                </div>
                <div className="hidden md:grid grid-cols-[2fr_0.8fr_1fr_1fr_0.7fr_0.4fr] gap-2 items-center">
                  <div className="min-w-0 flex items-center gap-3">
                    <PageThumb imageKey={first?.image_key ?? null} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        <span className="truncate">{first?.title}</span>
                        {p.pages.length > 1 && (
                          <span className="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-sm bg-secondary text-muted-foreground shrink-0">
                            {p.pages.length} pages
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{metrics}</div>
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">{frequencyLabel(p)}</span>
                  <span className="text-sm text-muted-foreground truncate">{targetLabel(p)}</span>
                  <span className="text-sm text-muted-foreground">{schedule(p)}</span>
                  <span className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm w-fit ${b.cls}`}>
                    {b.label}
                  </span>
                  <span className="text-muted-foreground hover:text-primary">
                    <Pencil size={14} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showForm && (
        <PopupEditor
          popup={editing}
          plans={plansData?.plans}
          workspaces={workspacesData?.workspaces}
          onClose={closeForm}
          onSaved={() => {
            invalidate();
            closeForm();
          }}
        />
      )}
    </div>
  );
}

function PageThumb({ imageKey }: { imageKey: string | null }) {
  const { data: url } = useQuery({
    queryKey: ['admin', 'popup-thumb', imageKey],
    queryFn: () => resolveInlineImageUrls([imageKey!]).then((m) => m[imageKey!] ?? ''),
    enabled: Boolean(imageKey),
    staleTime: 30 * 60 * 1000,
  });
  return (
    <div className="w-9 h-6 rounded bg-secondary shrink-0 overflow-hidden">
      {url && <img src={url} alt="" className="w-full h-full object-cover" />}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────

interface EditorProps {
  popup: GlobalPopup | null;
  plans: { id: string; name: string }[] | undefined;
  workspaces: { id: string; name: string }[] | undefined;
  onClose: () => void;
  onSaved: () => void;
}

function PopupEditor({ popup, plans, workspaces, onClose, onSaved }: EditorProps) {
  const [form, setForm] = useState<PopupFormState>(() => (popup ? popupToForm(popup) : emptyForm()));
  const [selected, setSelected] = useState(0);
  const [errors, setErrors] = useState<PopupFormErrors | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const page = form.pages[Math.min(selected, form.pages.length - 1)];
  const pageIndex = form.pages.indexOf(page);

  const imageKeys = useMemo(
    () => form.pages.map((p) => p.image_key).filter((k): k is string => Boolean(k)),
    [form.pages],
  );
  const { data: imageUrls } = useQuery({
    queryKey: ['admin', 'popup-images', imageKeys],
    queryFn: () => resolveInlineImageUrls(imageKeys),
    enabled: imageKeys.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const createMut = useMutation({
    mutationFn: () => createPopup(formToPayload(form)),
    onSuccess: () => {
      toast.success('Popup created');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const updateMut = useMutation({
    mutationFn: () => updatePopup({ popup_id: popup!.id, ...formToPayload(form) }),
    onSuccess: () => {
      toast.success('Popup updated');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const deleteMut = useMutation({
    mutationFn: () => deletePopup(popup!.id),
    onSuccess: () => {
      toast.success('Popup deleted');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updatePage = (patch: Partial<PageForm>) =>
    setForm((f) => ({
      ...f,
      pages: f.pages.map((p, i) => (i === pageIndex ? { ...p, ...patch } : p)),
    }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateForm(form);
    setErrors(errs);
    if (errs) {
      const firstPage = Object.keys(errs.pages).map(Number)[0];
      if (firstPage !== undefined) setSelected(firstPage);
      return;
    }
    if (popup) updateMut.mutate();
    else createMut.mutate();
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const r = await uploadInlineImage(file);
      updatePage({ image_key: r.r2Key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePage = (index: number) => {
    if (form.pages.length <= 1) return;
    if (pageHasContent(form.pages[index]) && !window.confirm('Remove this page and its content?')) return;
    setForm((f) => removePage(f, index));
    setSelected((s) => Math.max(0, Math.min(s, form.pages.length - 2)));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = form.pages.findIndex((p) => p.key === active.id);
    const to = form.pages.findIndex((p) => p.key === over.id);
    if (from < 0 || to < 0) return;
    setForm((f) => movePage(f, from, to));
    setSelected(to);
  };

  useEffect(() => {
    if (selected > form.pages.length - 1) setSelected(form.pages.length - 1);
  }, [form.pages.length, selected]);

  const hasCta = Boolean(form.cta_label.trim() && form.cta_url.trim());
  const secondaryLabel = form.secondary_label.trim() || defaultSecondaryLabel(form.require_ack, hasCta);
  const pending = createMut.isPending || updateMut.isPending;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[1.15fr_0.85fr]">
          {/* ── Coluna do formulário ── */}
          <div className="p-5 md:p-7 flex flex-col gap-5 md:border-r border-border">
            <h2 className="font-sf text-lg font-bold">{popup ? 'Edit Popup' : 'New Popup'}</h2>

            <div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={form.pages.map((p) => p.key)} strategy={horizontalListSortingStrategy}>
                  <div role="tablist" aria-label="Pages" className="flex flex-wrap items-center gap-1.5">
                    {form.pages.map((p, i) => (
                      <PageTab
                        key={p.key}
                        page={p}
                        index={i}
                        active={i === pageIndex}
                        hasError={Boolean(errors?.pages[i])}
                        canRemove={form.pages.length > 1}
                        onSelect={() => setSelected(i)}
                        onRemove={() => handleRemovePage(i)}
                      />
                    ))}
                    {form.pages.length < MAX_PAGES && (
                      <button
                        type="button"
                        onClick={() => {
                          setForm((f) => addPage(f));
                          setSelected(form.pages.length);
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary"
                      >
                        + Page
                      </button>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-title" className={LABEL}>Title</label>
                <input id="popup-title" className={INPUT} value={page.title} maxLength={120}
                  onChange={(e) => updatePage({ title: e.target.value })} />
                {errors?.pages[pageIndex]?.title && (
                  <p className="text-xs text-destructive mt-1">{errors.pages[pageIndex].title}</p>
                )}
              </div>
              <div>
                <label htmlFor="popup-eyebrow" className={LABEL}>Eyebrow (optional)</label>
                <input id="popup-eyebrow" className={INPUT} value={page.eyebrow} maxLength={60}
                  onChange={(e) => updatePage({ eyebrow: e.target.value })} />
                {errors?.pages[pageIndex]?.eyebrow && (
                  <p className="text-xs text-destructive mt-1">{errors.pages[pageIndex].eyebrow}</p>
                )}
              </div>
            </div>

            <div>
              <label className={LABEL}>Image (optional, 16:9 recommended, up to 10 MB)</label>
              <div className="flex items-center gap-3 border border-dashed border-border rounded-lg px-3 py-2">
                <div className="w-16 h-10 rounded bg-secondary overflow-hidden shrink-0">
                  {page.image_key && imageUrls?.[page.image_key] && (
                    <img src={imageUrls[page.image_key]} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.target.value = '';
                  }} />
                <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:border-primary disabled:opacity-50">
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploading ? 'Uploading...' : page.image_key ? 'Replace' : 'Upload'}
                </button>
                {page.image_key && (
                  <button type="button" onClick={() => updatePage({ image_key: '' })}
                    className="text-xs text-muted-foreground hover:text-destructive">
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="popup-body" className={LABEL}>Body (Markdown)</label>
              <textarea id="popup-body" rows={4} maxLength={2000} value={page.body}
                onChange={(e) => updatePage({ body: e.target.value })}
                className={`${INPUT} resize-none`} />
              {errors?.pages[pageIndex]?.body && (
                <p className="text-xs text-destructive mt-1">{errors.pages[pageIndex].body}</p>
              )}
            </div>

            <div className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border pt-4">
              Popup settings (apply to all pages)
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-cta-label" className={LABEL}>CTA label</label>
                <input id="popup-cta-label" className={INPUT} maxLength={40} value={form.cta_label}
                  onChange={(e) => setForm((f) => ({ ...f, cta_label: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="popup-cta-url" className={LABEL}>CTA URL</label>
                <input id="popup-cta-url" className={INPUT} placeholder="/ajuda/... or https://..." value={form.cta_url}
                  onChange={(e) => setForm((f) => ({ ...f, cta_url: e.target.value }))} />
              </div>
            </div>
            {errors?.cta && <p className="text-xs text-destructive -mt-3">{errors.cta}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-secondary" className={LABEL}>Secondary label</label>
                <input id="popup-secondary" className={INPUT} maxLength={40} value={form.secondary_label}
                  placeholder={defaultSecondaryLabel(form.require_ack, hasCta)}
                  onChange={(e) => setForm((f) => ({ ...f, secondary_label: e.target.value }))} />
              </div>
              <div>
                <label className={LABEL}>CTA style</label>
                <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                  {(['ink', 'brand'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setForm((f) => ({ ...f, cta_style: s }))}
                      className={`flex-1 px-3 py-2 ${form.cta_style === s ? 'bg-card font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {s === 'ink' ? 'Ink' : 'Brand yellow'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className={LABEL}>Frequency</label>
              <div className="flex gap-4 text-sm text-muted-foreground">
                <label className="flex items-center gap-2">
                  <input type="radio" name="frequency" checked={form.frequency === 'once'}
                    onChange={() => setForm((f) => ({ ...f, frequency: 'once' }))} />
                  Once per user
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="frequency" checked={form.frequency === 'until_cta'}
                    disabled={form.require_ack}
                    onChange={() => setForm((f) => ({ ...f, frequency: 'until_cta' }))} />
                  Every session until CTA
                </label>
              </div>
              {errors?.frequency && <p className="text-xs text-destructive mt-1">{errors.frequency}</p>}
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={form.require_ack}
                onChange={(e) => setForm((f) => withRequireAck(f, e.target.checked))} className="rounded" />
              Require acknowledgement (no X, no click-outside, no Esc)
            </label>

            <div>
              <TargetPicker
                value={{
                  target_mode: form.target_mode,
                  target_plan_ids: form.target_plan_ids,
                  target_workspace_ids: form.target_workspace_ids,
                }}
                plans={plans}
                workspaces={workspaces}
                onChange={(next) => setForm((f) => ({ ...f, ...next }))}
              />
              {errors?.target && <p className="text-xs text-destructive mt-1">{errors.target}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-starts" className={LABEL}>Starts at (optional)</label>
                <input id="popup-starts" type="datetime-local" className={INPUT} value={form.starts_at}
                  onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="popup-ends" className={LABEL}>Ends at (optional)</label>
                <input id="popup-ends" type="datetime-local" className={INPUT} value={form.ends_at}
                  onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))} />
              </div>
            </div>

            <div>
              <label htmlFor="popup-status" className={LABEL}>Status</label>
              <select id="popup-status" className={INPUT} value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PopupFormState['status'] }))}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Coluna do preview ── */}
          <div className="bg-secondary/40 p-5 md:p-7 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className={LABEL}>Live preview</span>
              <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                {(['light', 'dark'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTheme(t)}
                    className={`px-3 py-1 ${theme === t ? 'bg-card font-semibold text-foreground' : 'text-muted-foreground'}`}>
                    {t === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:sticky md:top-4 flex justify-center rounded-xl p-4"
              style={theme === 'dark' ? { ...DARK_VARS, background: '#0a0c0f' } : { background: '#eef0f3' }}>
              <PopupCard
                pages={form.pages.map((p) => ({
                  title: p.title || 'Title',
                  eyebrow: p.eyebrow || null,
                  body: p.body || 'Body preview...',
                  imageUrl: p.image_key ? (imageUrls?.[p.image_key] ?? null) : null,
                }))}
                page={pageIndex}
                onPageChange={setSelected}
                ctaLabel={hasCta ? form.cta_label : null}
                ctaStyle={form.cta_style}
                secondaryLabel={secondaryLabel}
                requireAck={form.require_ack}
                sanitizeHref={previewHref}
                onCta={hasCta ? () => {} : undefined}
                onSecondary={() => {}}
                onClose={() => {}}
                titleId={titleId}
                bodyId={bodyId}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Exact CRM component. Navigating here selects the page tab.
            </p>
          </div>

          <div className="md:col-span-2 flex gap-3 p-5 md:px-7 border-t border-border">
            <button type="submit" disabled={pending}
              className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors disabled:opacity-50">
              {popup ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:border-primary transition-colors">
              Cancel
            </button>
            {popup && popup.status === 'draft' && (
              <button type="button" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
                aria-label="Delete"
                className="px-4 py-2.5 rounded-lg border border-destructive/30 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function PageTab({
  page,
  index,
  active,
  hasError,
  canRemove,
  onSelect,
  onRemove,
}: {
  page: PageForm;
  index: number;
  active: boolean;
  hasError: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.key });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const label = page.title.trim() ? page.title.trim().slice(0, 18) : 'Untitled';
  return (
    <div ref={setNodeRef} style={style}
      className={`flex items-center gap-1.5 pl-1.5 pr-2 py-1.5 rounded-lg text-xs ${
        active ? 'bg-card text-foreground font-semibold ring-1 ring-border' : 'bg-secondary text-muted-foreground'
      } ${hasError ? 'ring-1 ring-destructive' : ''}`}>
      <span {...attributes} {...listeners} className="cursor-grab text-dim-foreground" aria-label={`Reorder page ${index + 1}`}>
        <GripVertical size={12} />
      </span>
      <button type="button" role="tab" aria-selected={active} onClick={onSelect}>
        {index + 1} · {label}
      </button>
      {canRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove page ${index + 1}`} className="text-dim-foreground hover:text-destructive">
          <X size={12} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rota e nav**

`apps/admin/src/router.tsx`, após o item `banners`:

```tsx
      {
        path: 'popups',
        lazy: async () => ({ Component: (await import('./pages/PopupsPage')).default }),
      },
```

`apps/admin/src/layouts/AdminLayout.tsx`: acrescente `AppWindow` ao import de `lucide-react` e, em `NAV_ITEMS`, após Banners:

```ts
  { to: '/admin/popups', icon: AppWindow, label: 'Popups' },
```

- [ ] **Step 5: Rodar testes, typecheck, lint**

```bash
npx vitest run apps/admin && npx tsc -p apps/admin/tsconfig.json --noEmit && npm run lint
```

Esperado: `PopupsPage` 4 testes passam. Se o `getByLabelText('Title')` bater em mais de um elemento, é porque o preview também tem um `h2`; ele não é `label`, então não colide. Se `role="tab"` não for encontrado, confira que o botão da aba (não o wrapper) carrega `role="tab"`.

- [ ] **Step 6: Verificar no browser (admin em staging)**

```bash
npm run dev:admin:staging
```

Abrir `http://localhost:5177/admin/popups` com o login de admin da plataforma (ver `reference_seed_login_browser_verification` na memória para o fluxo de login no Browser pane). Criar um popup de 2 páginas com imagem, salvar como draft, reabrir, reordenar as abas arrastando, alternar Light/Dark, apagar. Tirar screenshot da lista e do editor.

- [ ] **Step 7: Commit**

```bash
npm run format && git add apps/admin/src/pages/PopupsPage.tsx apps/admin/src/pages/__tests__/PopupsPage.test.tsx apps/admin/src/router.tsx apps/admin/src/layouts/AdminLayout.tsx
git commit -m "feat(popups): página de popups no admin com editor de páginas e preview ao vivo"
```

---
### Task 9: CRM: eventos de analytics + `store/popups.ts`

**Spec:** Parte 3, seções "Store" e "Ações" (nomes de evento).

**Files:**
- Modify: `apps/crm/src/lib/analytics.ts` (união `AnalyticsEvent`)
- Create: `apps/crm/src/store/popups.ts`
- Modify: `apps/crm/src/store/index.ts` (`export * from './popups';` após a linha de `banners`)
- Create: `apps/crm/src/store/__tests__/popups.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PopupPage { title: string; eyebrow: string | null; body: string; image_key: string | null }
export interface GlobalPopup {
  id: string; pages: PopupPage[]; cta_label: string | null; cta_url: string | null;
  cta_style: 'ink' | 'brand'; secondary_label: string | null; frequency: 'once' | 'until_cta';
  require_ack: boolean; created_at: string;
}
export type PopupAction = 'seen' | 'closed' | 'cta' | 'ack';
export interface PopupInteraction { popup_id: string; action: PopupAction }
export function getActivePopups(): Promise<GlobalPopup[]>          // descarta pages malformado
export function getMyPopupInteractions(): Promise<PopupInteraction[]>
export function recordPopupInteraction(popupId: string, action: PopupAction): Promise<void>
```

- [ ] **Step 1: Teste do store (falha)**

Crie `apps/crm/src/store/__tests__/popups.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, getCurrentUserMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
}));
vi.mock('../core', () => ({
  supabase: { from: fromMock },
  getCurrentUser: getCurrentUserMock,
}));

import { getActivePopups, getMyPopupInteractions, recordPopupInteraction } from '../popups';

function selectReturning(rows: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
    eq: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return chain;
}

const good = {
  id: 'p1', pages: [{ title: 'T', eyebrow: null, body: 'B', image_key: null }],
  cta_label: null, cta_url: null, cta_style: 'ink', secondary_label: null,
  frequency: 'once', require_ack: false, created_at: '2026-09-01T00:00:00Z',
};

describe('store/popups', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getCurrentUserMock.mockResolvedValue({ id: 'u1' });
  });

  it('getActivePopups descarta pages que não é array não vazio', async () => {
    fromMock.mockReturnValue(selectReturning([good, { ...good, id: 'p2', pages: [] }, { ...good, id: 'p3', pages: 'x' }]));
    const popups = await getActivePopups();
    expect(popups.map((p) => p.id)).toEqual(['p1']);
    expect(console.warn).toHaveBeenCalled();
  });

  it('getMyPopupInteractions devolve vazio sem usuário e filtra por user_id', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    expect(await getMyPopupInteractions()).toEqual([]);
    const chain = selectReturning([{ popup_id: 'p1', action: 'seen' }]);
    fromMock.mockReturnValue(chain);
    expect(await getMyPopupInteractions()).toEqual([{ popup_id: 'p1', action: 'seen' }]);
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('recordPopupInteraction insere com o user_id atual', async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    fromMock.mockReturnValue({ insert });
    await recordPopupInteraction('p1', 'cta');
    expect(fromMock).toHaveBeenCalledWith('popup_interactions');
    expect(insert).toHaveBeenCalledWith({ popup_id: 'p1', user_id: 'u1', action: 'cta' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/crm/src/store/__tests__/popups.test.ts
```

- [ ] **Step 3: Implementar**

`apps/crm/src/lib/analytics.ts`: na união `AnalyticsEvent`, após `'guide_completed'`:

```ts
  | 'popup_shown'
  | 'popup_page'
  | 'popup_closed'
  | 'popup_cta'
  | 'popup_ack'
```

Crie `apps/crm/src/store/popups.ts`:

```ts
import { supabase, getCurrentUser } from './core';

export interface PopupPage {
  title: string;
  eyebrow: string | null;
  body: string;
  image_key: string | null;
}

export interface GlobalPopup {
  id: string;
  pages: PopupPage[];
  cta_label: string | null;
  cta_url: string | null;
  cta_style: 'ink' | 'brand';
  secondary_label: string | null;
  frequency: 'once' | 'until_cta';
  require_ack: boolean;
  created_at: string;
}

export type PopupAction = 'seen' | 'closed' | 'cta' | 'ack';

export interface PopupInteraction {
  popup_id: string;
  action: PopupAction;
}

const COLUMNS =
  'id, pages, cta_label, cta_url, cta_style, secondary_label, frequency, require_ack, created_at';

/** A RLS já filtra ativo + janela + targeting. Só o platform-admin escreve `pages`,
 * mas um dado inesperado nunca pode derrubar o shell: linha malformada é descartada. */
export async function getActivePopups(): Promise<GlobalPopup[]> {
  const { data, error } = await supabase
    .from('global_popups')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data || []) as GlobalPopup[];
  return rows.filter((p) => {
    const ok = Array.isArray(p.pages) && p.pages.length > 0;
    if (!ok) console.warn('[popups] ignoring popup with malformed pages', p.id);
    return ok;
  });
}

export async function getMyPopupInteractions(): Promise<PopupInteraction[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('popup_interactions')
    .select('popup_id, action')
    .eq('user_id', user.id);
  if (error) throw error;
  return (data || []) as PopupInteraction[];
}

export async function recordPopupInteraction(popupId: string, action: PopupAction): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('popup_interactions')
    .insert({ popup_id: popupId, user_id: user.id, action });
  if (error) throw error;
}
```

`apps/crm/src/store/index.ts`: após `export * from './banners';` acrescente `export * from './popups';`.

- [ ] **Step 4: Rodar e ver passar; typecheck**

```bash
npx vitest run apps/crm/src/store/__tests__/popups.test.ts && npx tsc -p apps/crm/tsconfig.json --noEmit
```

Se o `tsc` acusar colisão de nome no barrel `store/index.ts` (por exemplo outro `PopupPage`), renomeie o export daqui para `GlobalPopupPage` e ajuste os consumidores das Tasks 11 e 12.

- [ ] **Step 5: Commit**

```bash
npm run format && git add apps/crm/src/lib/analytics.ts apps/crm/src/store/popups.ts apps/crm/src/store/index.ts apps/crm/src/store/__tests__/popups.test.ts
git commit -m "feat(popups): store de popups no CRM e eventos de analytics"
```

---

### Task 10: `guideAutoOpenState` e campo `autoOpen` na `GuideApi`

**Spec:** Parte 3, `GlobalPopupHost` passo 1 (estados `'unknown' | 'no' | 'yes'`, erro conta como `'no'`).

**Files:**
- Modify: `apps/crm/src/components/guide/guideGating.ts`
- Modify: `apps/crm/src/components/guide/GuideContext.tsx`
- Modify: `apps/crm/src/components/guide/__tests__/guideGating.test.ts`
- Modify: `apps/crm/src/components/guide/__tests__/GuideContext.test.tsx`

**Interfaces:**
- Produces:

```ts
export type GuideAutoOpenState = 'unknown' | 'no' | 'yes';
export function guideAutoOpenState(i: {
  authLoading: boolean; isOwner: boolean; opened: boolean; progress: GuideProgress;
  clientes: { status: string; count: number }; workflows: { status: string; count: number };
}): GuideAutoOpenState
// GuideApi ganha: autoOpen: GuideAutoOpenState
```

- [ ] **Step 1: Testes (falham)**

Acrescente ao fim de `apps/crm/src/components/guide/__tests__/guideGating.test.ts`:

```ts
import { guideAutoOpenState } from '../guideGating';

const BASE = {
  authLoading: false,
  isOwner: true,
  opened: false,
  progress: { ...EMPTY_PROGRESS },
  clientes: { status: 'success', count: 0 },
  workflows: { status: 'success', count: 0 },
};

describe('guideAutoOpenState', () => {
  it('yes quando já está aberto ou vai abrir (dono novo, sem clientes nem fluxos), independente da rota', () => {
    expect(guideAutoOpenState({ ...BASE, opened: true })).toBe('yes');
    expect(guideAutoOpenState(BASE)).toBe('yes');
  });

  it('unknown só enquanto auth ou sinais estão pending', () => {
    expect(guideAutoOpenState({ ...BASE, authLoading: true })).toBe('unknown');
    expect(guideAutoOpenState({ ...BASE, clientes: { status: 'pending', count: 0 } })).toBe('unknown');
    expect(guideAutoOpenState({ ...BASE, workflows: { status: 'pending', count: 0 } })).toBe('unknown');
  });

  it('no para não dono, progresso registrado, workspace com atividade ou sinal em error', () => {
    expect(guideAutoOpenState({ ...BASE, isOwner: false })).toBe('no');
    expect(guideAutoOpenState({ ...BASE, progress: { ...BASE.progress, autoOpenedAt: 'x' } })).toBe('no');
    expect(guideAutoOpenState({ ...BASE, progress: { ...BASE.progress, dismissedAt: 'x' } })).toBe('no');
    expect(guideAutoOpenState({ ...BASE, progress: { ...BASE.progress, concludedAt: 'x' } })).toBe('no');
    expect(guideAutoOpenState({ ...BASE, clientes: { status: 'success', count: 2 } })).toBe('no');
    expect(guideAutoOpenState({ ...BASE, clientes: { status: 'error', count: 0 } })).toBe('no');
    expect(guideAutoOpenState({ ...BASE, workflows: { status: 'error', count: 0 } })).toBe('no');
  });

  it('não dono nunca fica unknown mesmo com sinais pending (as queries nem rodam)', () => {
    expect(guideAutoOpenState({ ...BASE, isOwner: false, clientes: { status: 'pending', count: 0 } })).toBe('no');
  });
});
```

Em `GuideContext.test.tsx`: no `Probe`, acrescente `<span data-testid="auto">{g.autoOpen}</span>` e, no `describe('GuideProvider')`, os casos:

```tsx
  it('autoOpen: yes no dashboard vazio (abre), yes fora do dashboard (vai abrir), no com clientes, unknown pending', async () => {
    renderProvider('/dashboard');
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('true'));
    expect(screen.getByTestId('auto').textContent).toBe('yes');
  });

  it('autoOpen fora do dashboard com workspace vazio é yes sem abrir', () => {
    renderProvider('/entregas');
    expect(screen.getByTestId('open').textContent).toBe('false');
    expect(screen.getByTestId('auto').textContent).toBe('yes');
  });

  it('autoOpen é no com clientes e unknown enquanto pending', () => {
    useGuideSignalsMock.mockReturnValue({ ...EMPTY_SIGNALS, clientes: { status: 'success', count: 3 } });
    const { unmount } = renderProvider('/dashboard');
    expect(screen.getByTestId('auto').textContent).toBe('no');
    unmount();
    useGuideSignalsMock.mockReturnValue({ ...EMPTY_SIGNALS, clientes: { status: 'pending', count: 0 } });
    renderProvider('/dashboard');
    expect(screen.getByTestId('auto').textContent).toBe('unknown');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/crm/src/components/guide
```

- [ ] **Step 3: Implementar**

Acrescente ao fim de `apps/crm/src/components/guide/guideGating.ts`:

```ts
export type GuideAutoOpenState = 'unknown' | 'no' | 'yes';

/**
 * O que o GlobalPopupHost precisa saber do guia, sem o critério de rota de
 * shouldAutoOpenGuide: 'yes' = já está aberto ou vai abrir assim que o dono chegar
 * ao dashboard; 'no' = não vai abrir nesta sessão; 'unknown' = ainda não dá para
 * saber (auth ou sinais em pending). Erro de sinal é 'no': o guia nunca abre sobre
 * erro, então esperar seria bloquear o popup para sempre.
 */
export function guideAutoOpenState(i: {
  authLoading: boolean;
  isOwner: boolean;
  opened: boolean;
  progress: GuideProgress;
  clientes: { status: string; count: number };
  workflows: { status: string; count: number };
}): GuideAutoOpenState {
  if (i.opened) return 'yes';
  if (i.authLoading) return 'unknown';
  if (!i.isOwner) return 'no';
  if (i.progress.autoOpenedAt || i.progress.dismissedAt || i.progress.concludedAt) return 'no';
  if (i.clientes.status === 'error' || i.workflows.status === 'error') return 'no';
  if (i.clientes.status !== 'success' || i.workflows.status !== 'success') return 'unknown';
  return i.clientes.count === 0 && i.workflows.count === 0 ? 'yes' : 'no';
}
```

Em `GuideContext.tsx`:

1. Import: `import { shouldAutoOpenGuide, guideAutoOpenState, type GuideAutoOpenState } from './guideGating';`
2. Em `GuideApi`, após `isOpen: boolean;`:

```ts
  /** Decisão de auto-abertura para quem precisa esperar por ela (GlobalPopupHost). */
  autoOpen: GuideAutoOpenState;
```

3. Antes de `const api: GuideApi = {`:

```ts
  const autoOpen = guideAutoOpenState({
    authLoading: loading,
    isOwner,
    opened: isOpen,
    progress: view.progress,
    clientes: signals.clientes,
    workflows: signals.workflows,
  });
```

4. No objeto `api`, após `isOpen,`: `autoOpen,`.

- [ ] **Step 4: Rodar e ver passar; typecheck**

```bash
npx vitest run apps/crm/src/components/guide && npx tsc -p apps/crm/tsconfig.json --noEmit
```

Se algum teste antigo constrói um `GuideApi` literal (procure `showEntryPoint:` em `apps/crm/src/**/__tests__`), acrescente `autoOpen: 'no'` a ele.

- [ ] **Step 5: Commit**

```bash
npm run format && git add apps/crm/src/components/guide
git commit -m "feat(guide): expõe a decisão de auto-abertura (autoOpen) para o host de popups"
```

---

### Task 11: `popupSession`, `pickPopup` e hook `usePopups`

**Spec:** Parte 3, seção "Hook usePopups" e "Semântica de já viu" (Parte 1).

**Files:**
- Create: `apps/crm/src/hooks/popupSession.ts`
- Create: `apps/crm/src/hooks/pickPopup.ts`
- Create: `apps/crm/src/hooks/usePopups.ts`
- Create: `apps/crm/src/hooks/__tests__/pickPopup.test.ts`
- Create: `apps/crm/src/hooks/__tests__/popupSession.test.ts`

**Interfaces:**
- Consumes: `GlobalPopup`, `PopupInteraction`, `PopupAction`, `getActivePopups`, `getMyPopupInteractions`, `recordPopupInteraction` (Task 9).
- Produces:

```ts
// popupSession.ts (sessionStorage, try/catch em tudo)
export interface PopupSession { shownId: string | null; closedIds: Set<string>; skipped: boolean }
export function readPopupSession(): PopupSession
export function markPopupShown(id: string): void
export function markPopupClosed(id: string): void
export function markPopupsSkipped(): void

// pickPopup.ts
export function isHiddenForever(popup: GlobalPopup, interactions: PopupInteraction[]): boolean
export function pickPopup(popups: GlobalPopup[], interactions: PopupInteraction[], session: PopupSession): GlobalPopup | null

// usePopups.ts
export const POPUPS_KEY = ['popups'] as const;
export const POPUP_INTERACTIONS_KEY = ['popup-interactions'] as const;
export function usePopups(): {
  popupsQuery: UseQueryResult<GlobalPopup[]>;
  interactionsQuery: UseQueryResult<PopupInteraction[]>;
  record: (popupId: string, action: PopupAction) => void;   // otimista + silencioso em erro
}
```

- [ ] **Step 1: Testes (falham)**

Crie `apps/crm/src/hooks/__tests__/pickPopup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GlobalPopup, PopupInteraction } from '../../store/popups';
import { isHiddenForever, pickPopup } from '../pickPopup';

function popup(over: Partial<GlobalPopup>): GlobalPopup {
  return {
    id: 'p',
    pages: [{ title: 'T', eyebrow: null, body: 'B', image_key: null }],
    cta_label: null,
    cta_url: null,
    cta_style: 'ink',
    secondary_label: null,
    frequency: 'once',
    require_ack: false,
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}
const session = () => ({ shownId: null, closedIds: new Set<string>(), skipped: false });
const ix = (popup_id: string, action: PopupInteraction['action']): PopupInteraction => ({ popup_id, action });

describe('isHiddenForever', () => {
  it('once: closed, cta ou ack escondem; seen não', () => {
    const p = popup({ id: 'a' });
    expect(isHiddenForever(p, [ix('a', 'seen')])).toBe(false);
    expect(isHiddenForever(p, [ix('a', 'closed')])).toBe(true);
    expect(isHiddenForever(p, [ix('a', 'cta')])).toBe(true);
    expect(isHiddenForever(p, [ix('a', 'ack')])).toBe(true);
    expect(isHiddenForever(p, [ix('b', 'closed')])).toBe(false);
  });

  it('until_cta: só cta ou ack escondem', () => {
    const p = popup({ id: 'a', frequency: 'until_cta' });
    expect(isHiddenForever(p, [ix('a', 'closed'), ix('a', 'closed')])).toBe(false);
    expect(isHiddenForever(p, [ix('a', 'cta')])).toBe(true);
    expect(isHiddenForever(p, [ix('a', 'ack')])).toBe(true);
  });
});

describe('pickPopup', () => {
  const older = popup({ id: 'old', created_at: '2026-08-01T00:00:00Z' });
  const newer = popup({ id: 'new', created_at: '2026-09-01T00:00:00Z' });

  it('sessão pulada: null', () => {
    expect(pickPopup([newer], [], { ...session(), skipped: true })).toBeNull();
  });

  it('descarta escondidos para sempre e fechados na sessão; escolhe o mais recente', () => {
    expect(pickPopup([older, newer], [], session())?.id).toBe('new');
    expect(pickPopup([older, newer], [ix('new', 'closed')], session())?.id).toBe('old');
    const s = session();
    s.closedIds.add('new');
    expect(pickPopup([older, newer], [], s)?.id).toBe('old');
  });

  it('um por sessão: shownId ainda elegível volta (recarregou sem interagir); senão null', () => {
    expect(pickPopup([older, newer], [], { ...session(), shownId: 'old' })?.id).toBe('old');
    expect(pickPopup([older, newer], [ix('old', 'closed')], { ...session(), shownId: 'old' })).toBeNull();
  });

  it('nada elegível: null', () => {
    expect(pickPopup([], [], session())).toBeNull();
  });
});
```

Crie `apps/crm/src/hooks/__tests__/popupSession.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { markPopupClosed, markPopupShown, markPopupsSkipped, readPopupSession } from '../popupSession';

describe('popupSession', () => {
  beforeEach(() => sessionStorage.clear());

  it('vazio por padrão', () => {
    expect(readPopupSession()).toEqual({ shownId: null, closedIds: new Set(), skipped: false });
  });

  it('grava shown, closed e skipped', () => {
    markPopupShown('p1');
    markPopupClosed('p1');
    markPopupClosed('p2');
    markPopupsSkipped();
    const s = readPopupSession();
    expect(s.shownId).toBe('p1');
    expect([...s.closedIds].sort()).toEqual(['p1', 'p2']);
    expect(s.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/crm/src/hooks/__tests__/pickPopup.test.ts apps/crm/src/hooks/__tests__/popupSession.test.ts
```

- [ ] **Step 3: Implementar os três módulos**

`apps/crm/src/hooks/popupSession.ts`:

```ts
/**
 * Estado de sessão dos popups (spec 2026-09-04, Parte 3): sessionStorage, por aba.
 * Tudo em try/catch: modo privado ou storage bloqueado nunca pode quebrar o shell.
 */
export interface PopupSession {
  shownId: string | null;
  closedIds: Set<string>;
  skipped: boolean;
}

const SHOWN = 'mesaas_popup_shown';
const SKIPPED = 'mesaas_popup_skipped';
const CLOSED_PREFIX = 'mesaas_popup_closed:';

export function readPopupSession(): PopupSession {
  const s: PopupSession = { shownId: null, closedIds: new Set(), skipped: false };
  try {
    s.shownId = sessionStorage.getItem(SHOWN);
    s.skipped = sessionStorage.getItem(SKIPPED) === '1';
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(CLOSED_PREFIX)) keys.push(k);
    }
    for (const k of keys) s.closedIds.add(k.slice(CLOSED_PREFIX.length));
  } catch {
    /* storage indisponível: sessão vazia */
  }
  return s;
}

function set(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignora */
  }
}

export const markPopupShown = (id: string) => set(SHOWN, id);
export const markPopupClosed = (id: string) => set(CLOSED_PREFIX + id, '1');
export const markPopupsSkipped = () => set(SKIPPED, '1');
```

`apps/crm/src/hooks/pickPopup.ts`:

```ts
import type { GlobalPopup, PopupInteraction } from '../store/popups';
import type { PopupSession } from './popupSession';

/** Tabela "Semântica de já viu" da spec: once esconde com qualquer interação que não
 * seja seen; until_cta só com cta ou ack. */
export function isHiddenForever(popup: GlobalPopup, interactions: PopupInteraction[]): boolean {
  const terminal: ReadonlySet<string> =
    popup.frequency === 'until_cta' ? new Set(['cta', 'ack']) : new Set(['closed', 'cta', 'ack']);
  return interactions.some((i) => i.popup_id === popup.id && terminal.has(i.action));
}

export function pickPopup(
  popups: GlobalPopup[],
  interactions: PopupInteraction[],
  session: PopupSession,
): GlobalPopup | null {
  if (session.skipped) return null;
  const eligible = popups
    .filter((p) => !isHiddenForever(p, interactions))
    .filter((p) => !session.closedIds.has(p.id));
  if (session.shownId) {
    return eligible.find((p) => p.id === session.shownId) ?? null;
  }
  if (eligible.length === 0) return null;
  return [...eligible].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}
```

`apps/crm/src/hooks/usePopups.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getActivePopups,
  getMyPopupInteractions,
  recordPopupInteraction,
  type PopupAction,
  type PopupInteraction,
} from '../store/popups';

export const POPUPS_KEY = ['popups'] as const;
export const POPUP_INTERACTIONS_KEY = ['popup-interactions'] as const;

/** Duas queries + gravação otimista e silenciosa. A decisão de mostrar fica no
 * GlobalPopupHost; a escolha pura em pickPopup. */
export function usePopups() {
  const queryClient = useQueryClient();

  const popupsQuery = useQuery({
    queryKey: POPUPS_KEY,
    queryFn: getActivePopups,
    staleTime: 5 * 60_000,
  });

  const interactionsQuery = useQuery({
    queryKey: POPUP_INTERACTIONS_KEY,
    queryFn: getMyPopupInteractions,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: ({ popupId, action }: { popupId: string; action: PopupAction }) =>
      recordPopupInteraction(popupId, action),
    onMutate: async ({ popupId, action }) => {
      await queryClient.cancelQueries({ queryKey: POPUP_INTERACTIONS_KEY });
      queryClient.setQueryData<PopupInteraction[]>(POPUP_INTERACTIONS_KEY, (old) => [
        ...(old || []),
        { popup_id: popupId, action },
      ]);
    },
    onError: (err) => {
      // O popup já sumiu da sessão; no pior caso volta na próxima. Sem toast.
      console.warn('[popups] failed to record interaction', err);
    },
  });

  return {
    popupsQuery,
    interactionsQuery,
    record: (popupId: string, action: PopupAction) => mutation.mutate({ popupId, action }),
  };
}
```

- [ ] **Step 4: Rodar e ver passar; typecheck**

```bash
npx vitest run apps/crm/src/hooks && npx tsc -p apps/crm/tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
npm run format && git add apps/crm/src/hooks/popupSession.ts apps/crm/src/hooks/pickPopup.ts apps/crm/src/hooks/usePopups.ts apps/crm/src/hooks/__tests__/pickPopup.test.ts apps/crm/src/hooks/__tests__/popupSession.test.ts
git commit -m "feat(popups): sessão, escolha pura e hook usePopups no CRM"
```

---
### Task 12: `GlobalPopupHost` + montagem no `AppLayout`

**Spec:** Parte 3, seções "GlobalPopupHost", "Ações", "Ordem de exibição".

**Files:**
- Create: `apps/crm/src/components/layout/GlobalPopupHost.tsx`
- Create: `apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx`
- Modify: `apps/crm/src/components/layout/AppLayout.tsx` (lazy import + `<Suspense>` após o `GuideDialog`)
- Modify: `apps/crm/src/components/layout/__tests__/AppLayout.test.tsx` (mock do host)

**Interfaces:**
- Consumes: `usePopups`, `pickPopup`, `popupSession` (Task 11); `useGuide().autoOpen` (Task 10); `PopupCard`, `defaultSecondaryLabel` (Task 5); `resolveInlineImageUrls` de `@/services/inlineImage`; `sanitizeUrl`, `openExternalUrl` de `@/utils/security`; `captureEvent`; `Dialog`, `DialogPortal`, `DialogOverlay` de `@/components/ui/dialog`; `DialogPrimitive` de `@radix-ui/react-dialog`.
- Produces: `export default function GlobalPopupHost({ openDelayMs = 800 }: { openDelayMs?: number })`.

- [ ] **Step 1: Teste (falha)**

Crie `apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useAuthMock,
  useGuideMock,
  getActivePopupsMock,
  getMyPopupInteractionsMock,
  recordPopupInteractionMock,
  resolveInlineImageUrlsMock,
  captureEventMock,
  navigateMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGuideMock: vi.fn(),
  getActivePopupsMock: vi.fn(),
  getMyPopupInteractionsMock: vi.fn(),
  recordPopupInteractionMock: vi.fn(),
  resolveInlineImageUrlsMock: vi.fn(),
  captureEventMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../guide/GuideContext', () => ({ useGuide: useGuideMock }));
vi.mock('../../../store/popups', () => ({
  getActivePopups: getActivePopupsMock,
  getMyPopupInteractions: getMyPopupInteractionsMock,
  recordPopupInteraction: recordPopupInteractionMock,
}));
vi.mock('../../../services/inlineImage', () => ({ resolveInlineImageUrls: resolveInlineImageUrlsMock }));
vi.mock('../../../lib/analytics', () => ({ captureEvent: captureEventMock }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import GlobalPopupHost from '../GlobalPopupHost';

const popup = {
  id: 'p1',
  pages: [
    { title: 'Um', eyebrow: 'Novo', body: 'b1', image_key: 'contas/x/files/a.png' },
    { title: 'Dois', eyebrow: null, body: 'b2', image_key: null },
  ],
  cta_label: 'Ver',
  cta_url: '/ajuda/x',
  cta_style: 'ink',
  secondary_label: null,
  frequency: 'once',
  require_ack: false,
  created_at: '2026-09-01T00:00:00Z',
};

function renderHost() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GlobalPopupHost openDelayMs={0} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GlobalPopupHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useAuthMock.mockReturnValue({ loading: false });
    useGuideMock.mockReturnValue({ autoOpen: 'no', isOpen: false });
    getActivePopupsMock.mockResolvedValue([popup]);
    getMyPopupInteractionsMock.mockResolvedValue([]);
    recordPopupInteractionMock.mockResolvedValue(undefined);
    resolveInlineImageUrlsMock.mockResolvedValue({ 'contas/x/files/a.png': 'https://img/a.png' });
  });

  it('abre o popup elegível, resolve a imagem, grava seen e captura popup_shown', async () => {
    renderHost();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Imagem decorativa (alt=""), sem role "img": consulte o DOM direto.
    expect(document.querySelector('[role="dialog"] img')).toHaveAttribute('src', 'https://img/a.png');
    expect(resolveInlineImageUrlsMock).toHaveBeenCalledWith(['contas/x/files/a.png']);
    await waitFor(() => expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'seen'));
    expect(captureEventMock).toHaveBeenCalledWith('popup_shown', { popup_id: 'p1', pages: 2 });
    expect(sessionStorage.getItem('mesaas_popup_shown')).toBe('p1');
  });

  it('não grava seen de novo quando já existe', async () => {
    getMyPopupInteractionsMock.mockResolvedValue([{ popup_id: 'p1', action: 'seen' }]);
    renderHost();
    await screen.findByRole('dialog');
    await waitFor(() => expect(captureEventMock).toHaveBeenCalledWith('popup_shown', expect.anything()));
    expect(recordPopupInteractionMock).not.toHaveBeenCalledWith('p1', 'seen');
  });

  it('navega entre páginas capturando popup_page; X grava closed com a página e fecha', async () => {
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(captureEventMock).toHaveBeenCalledWith('popup_page', { popup_id: 'p1', page: 1 });
    expect(screen.getByRole('heading', { level: 2, name: 'Dois' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'closed');
    expect(captureEventMock).toHaveBeenCalledWith('popup_closed', { popup_id: 'p1', page: 1 });
    expect(sessionStorage.getItem('mesaas_popup_closed:p1')).toBe('1');
  });

  it('CTA relativo grava cta, captura popup_cta e navega no router', async () => {
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'cta');
    expect(captureEventMock).toHaveBeenCalledWith('popup_cta', { popup_id: 'p1' });
    expect(navigateMock).toHaveBeenCalledWith('/ajuda/x');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('CTA absoluto abre nova aba com noopener', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    getActivePopupsMock.mockResolvedValue([{ ...popup, pages: [popup.pages[1]], cta_url: 'https://x.y/z' }]);
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(open).toHaveBeenCalledWith('https://x.y/z', '_blank', 'noopener,noreferrer');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('CTA com URL rejeitada pelo sanitizeUrl vira no-op (grava cta, fecha, não abre nada)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    getActivePopupsMock.mockResolvedValue([
      { ...popup, pages: [popup.pages[1]], cta_url: 'https://user:pw@x.y/z' },
    ]);
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'cta');
    expect(open).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('require_ack: sem X, Esc não fecha, Entendi grava ack', async () => {
    getActivePopupsMock.mockResolvedValue([{ ...popup, pages: [popup.pages[1]], cta_label: null, cta_url: null, require_ack: true }]);
    renderHost();
    const dialog = await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'ack');
    expect(captureEventMock).toHaveBeenCalledWith('popup_ack', { popup_id: 'p1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('espera enquanto o guia é unknown e pula a sessão quando é yes', async () => {
    useGuideMock.mockReturnValue({ autoOpen: 'unknown', isOpen: false });
    const { rerender } = renderHost();
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sessionStorage.getItem('mesaas_popup_skipped')).toBeNull();

    useGuideMock.mockReturnValue({ autoOpen: 'yes', isOpen: false });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <GlobalPopupHost openDelayMs={0} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(sessionStorage.getItem('mesaas_popup_skipped')).toBe('1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('erro na query não renderiza nada e não quebra', async () => {
    getActivePopupsMock.mockRejectedValue(new Error('boom'));
    renderHost();
    await act(async () => {});
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('imagem que falha ao assinar abre sem imagem', async () => {
    resolveInlineImageUrlsMock.mockRejectedValue(new Error('sign failed'));
    renderHost();
    await screen.findByRole('dialog');
    expect(document.querySelector('[role="dialog"] img')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx
```

- [ ] **Step 3: Implementar o host**

Crie `apps/crm/src/components/layout/GlobalPopupHost.tsx`:

```tsx
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { PopupCard, defaultSecondaryLabel } from '@mesaas/ui/PopupCard';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';
import { useGuide } from '@/components/guide/GuideContext';
import { captureEvent } from '@/lib/analytics';
import { resolveInlineImageUrls } from '@/services/inlineImage';
import { openExternalUrl, sanitizeUrl } from '@/utils/security';
import type { GlobalPopup } from '@/store/popups';
import { usePopups } from '@/hooks/usePopups';
import { pickPopup } from '@/hooks/pickPopup';
import {
  markPopupClosed,
  markPopupShown,
  markPopupsSkipped,
  readPopupSession,
} from '@/hooks/popupSession';

interface Decision {
  popup: GlobalPopup;
  images: Record<string, string>;
}

/**
 * Popup global (spec 2026-09-04, Parte 3). Decide UMA vez por montagem, quando auth,
 * as duas queries e a decisão de auto-abertura do guia estão prontas. Não usa o
 * DialogContent do CRM: ele força padding e um X próprio que não desligam.
 */
export default function GlobalPopupHost({ openDelayMs = 800 }: { openDelayMs?: number }) {
  const { loading } = useAuth();
  const guide = useGuide();
  const navigate = useNavigate();
  const { popupsQuery, interactionsQuery, record } = usePopups();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const decided = useRef(false);
  const mounted = useRef(true);
  const titleId = useId();
  const bodyId = useId();

  const guideState = guide?.autoOpen ?? 'no';
  const ready =
    !loading &&
    popupsQuery.status !== 'pending' &&
    interactionsQuery.status !== 'pending' &&
    guideState !== 'unknown';

  // Snapshot dos valores no momento da decisão: o efeito depende só de `ready`,
  // para um refetch ou um re-render não cancelar o timer de abertura.
  const latest = useRef({
    guideState,
    guideOpen: guide?.isOpen ?? false,
    popups: popupsQuery.data,
    interactions: interactionsQuery.data,
    error: popupsQuery.status === 'error' || interactionsQuery.status === 'error',
  });
  latest.current = {
    guideState,
    guideOpen: guide?.isOpen ?? false,
    popups: popupsQuery.data,
    interactions: interactionsQuery.data,
    error: popupsQuery.status === 'error' || interactionsQuery.status === 'error',
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || decided.current) return;
    decided.current = true;
    const snap = latest.current;

    if (snap.guideState === 'yes' || snap.guideOpen) {
      markPopupsSkipped();
      return;
    }
    if (snap.error) {
      console.warn('[popups] queries failed; no popup this session');
      return;
    }

    const interactions = snap.interactions ?? [];
    const chosen = pickPopup(snap.popups ?? [], interactions, readPopupSession());
    if (!chosen) return;

    (async () => {
      const keys = chosen.pages.map((p) => p.image_key).filter((k): k is string => Boolean(k));
      let images: Record<string, string> = {};
      if (keys.length > 0) {
        try {
          images = await resolveInlineImageUrls(keys);
        } catch (err) {
          console.warn('[popups] image signing failed; opening without images', err);
        }
      }
      await new Promise((r) => setTimeout(r, openDelayMs));
      if (!mounted.current) return;

      setDecision({ popup: chosen, images });
      setPage(0);
      setOpen(true);
      markPopupShown(chosen.id);
      const alreadySeen = interactions.some((i) => i.popup_id === chosen.id && i.action === 'seen');
      if (!alreadySeen) record(chosen.id, 'seen');
      captureEvent('popup_shown', { popup_id: chosen.id, pages: chosen.pages.length });
    })();
  }, [ready, openDelayMs, record]);

  const popup = decision?.popup ?? null;

  const handleClose = useCallback(() => {
    if (!popup) return;
    record(popup.id, 'closed');
    markPopupClosed(popup.id);
    captureEvent('popup_closed', { popup_id: popup.id, page });
    setOpen(false);
  }, [popup, page, record]);

  const handleAck = useCallback(() => {
    if (!popup) return;
    record(popup.id, 'ack');
    captureEvent('popup_ack', { popup_id: popup.id });
    setOpen(false);
  }, [popup, record]);

  const handleCta = useCallback(() => {
    if (!popup || !popup.cta_url) return;
    record(popup.id, 'cta');
    captureEvent('popup_cta', { popup_id: popup.id });
    setOpen(false);
    const safe = sanitizeUrl(popup.cta_url);
    if (safe.startsWith('/')) navigate(safe);
    else openExternalUrl(popup.cta_url); // null (no-op) quando a URL é rejeitada
  }, [popup, record, navigate]);

  const handlePageChange = useCallback(
    (next: number) => {
      if (!popup) return;
      setPage(next);
      captureEvent('popup_page', { popup_id: popup.id, page: next });
    },
    [popup],
  );

  if (!popup) return null;

  const hasCta = Boolean(popup.cta_label && popup.cta_url);
  const requireAck = popup.require_ack;
  const secondaryLabel = popup.secondary_label ?? defaultSecondaryLabel(requireAck, hasCta);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Esc e clique fora chegam aqui quando não são bloqueados por require_ack.
        if (!next && !requireAck) handleClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[9011] w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onEscapeKeyDown={(e) => {
            if (requireAck) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (requireAck) e.preventDefault();
          }}
          aria-labelledby={titleId}
          aria-describedby={bodyId}
        >
          <DialogPrimitive.Title className="sr-only">{popup.pages[page]?.title}</DialogPrimitive.Title>
          <PopupCard
            pages={popup.pages.map((p) => ({
              title: p.title,
              eyebrow: p.eyebrow,
              body: p.body,
              imageUrl: p.image_key ? (decision?.images[p.image_key] ?? null) : null,
            }))}
            page={page}
            onPageChange={handlePageChange}
            ctaLabel={hasCta ? popup.cta_label : null}
            ctaStyle={popup.cta_style}
            secondaryLabel={secondaryLabel}
            requireAck={requireAck}
            sanitizeHref={sanitizeUrl}
            onCta={hasCta ? handleCta : undefined}
            onSecondary={requireAck ? handleAck : handleClose}
            onClose={handleClose}
            titleId={titleId}
            bodyId={bodyId}
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
```

- [ ] **Step 4: Montar no `AppLayout` e proteger o teste dele**

`apps/crm/src/components/layout/AppLayout.tsx`:

1. Após `const GuideDialog = lazy(...)`: `const GlobalPopupHost = lazy(() => import('./GlobalPopupHost'));`
2. Logo após o bloco `<Suspense fallback={null}><GuideDialog /></Suspense>` (ainda dentro do `GuideProvider`):

```tsx
        <Suspense fallback={null}>
          <GlobalPopupHost />
        </Suspense>
```

`apps/crm/src/components/layout/__tests__/AppLayout.test.tsx`: junto aos outros mocks de layout:

```tsx
vi.mock('../GlobalPopupHost', () => ({
  default: () => null,
}));
```

- [ ] **Step 5: Rodar testes, typecheck, lint**

```bash
npx vitest run apps/crm/src/components/layout && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint
```

Esperado: `GlobalPopupHost` 9 testes e `AppLayout` verdes. Armadilhas conhecidas:
- Radix avisa `DialogContent requires a DialogTitle` se o `Title` sumir; ele está lá, com `sr-only`.
- Se o teste do CTA absoluto encontrar dois dialogs (o primeiro `render` não foi desmontado), troque o segundo `renderHost()` por `unmount()` do primeiro antes.
- `useNavigate` fora de router: o teste envolve em `MemoryRouter`; no app o host está dentro do `RouterProvider`.

- [ ] **Step 6: Verificar no browser (CRM em staging)**

Pré-requisito: migration aplicada em staging e as duas functions deployadas (Task 13, passos 1 e 2). Depois:

```bash
npm run dev:staging
```

Com o popup de 2 páginas criado na Task 8 marcado como `active`: logar no CRM (login seed), ver o popup abrir depois do load, navegar, fechar pelo X, recarregar (não volta), abrir nova aba (volta se `until_cta`, não volta se `once`). Repetir com `require_ack` e com tema dark (`data-theme="dark"`). Screenshots de cada estado.

- [ ] **Step 7: Commit**

```bash
npm run format && git add apps/crm/src/components/layout/GlobalPopupHost.tsx apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx apps/crm/src/components/layout/AppLayout.tsx apps/crm/src/components/layout/__tests__/AppLayout.test.tsx
git commit -m "feat(popups): GlobalPopupHost no CRM com Dialog sem chrome, navegação e interações"
```

---

### Task 13: Verificação completa, rollout em staging, PR

**Spec:** seção "Rollout".

**Files:** nenhum novo. `deno.lock` NÃO entra no commit.

- [ ] **Step 1: Bateria local completa**

```bash
npm run lint && npm run format:check && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json && npm run test && npm run test:functions && npm run check:functions; git checkout deno.lock
```

Esperado: tudo verde. `ls node_modules/.deno` existindo depois do Deno significa `node_modules` poluído: `npm ci` e repita `npm run test`.

- [ ] **Step 2: Migration em staging**

Confira o link atual (`cat supabase/.temp/project-ref`; STAGING = `wlyzhyfondykzpsiqsce`). A partir de um worktree sem link, use `--project-ref` explícito:

```bash
npx supabase db push --project-ref wlyzhyfondykzpsiqsce
```

Esperado: `20260907000010_global_popups.sql` aplicada. Confirme:

```bash
npx supabase db query --project-ref wlyzhyfondykzpsiqsce "select count(*) from global_popups"
```

- [ ] **Step 3: Deploy das duas functions em staging**

```bash
npx supabase functions deploy platform-admin --project-ref wlyzhyfondykzpsiqsce --use-api
npx supabase functions deploy sign-r2-urls --project-ref wlyzhyfondykzpsiqsce --use-api
```

Mantenha as flags de JWT que cada uma usa hoje (confira o último deploy no histórico ou `supabase/config.toml`). `sign-r2-urls` precisa de `SUPABASE_ANON_KEY`, que o runtime injeta.

- [ ] **Step 4: Verificação ponta a ponta em staging**

Executar os Steps 6 das Tasks 8 e 12 nesta ordem: criar popup no admin (`npm run dev:admin:staging`), ver no CRM (`npm run dev:staging`). Guardar os screenshots para o PR.

- [ ] **Step 5: Reconferir a versão da migration contra `origin/main` e abrir o PR**

```bash
git fetch origin main && git ls-tree --name-only origin/main:supabase/migrations | tail -3
```

Se a cauda for maior que `20260907000010`, renomeie a migration (e a referência na spec) para um prefixo acima, commit, e só então:

```bash
gh pr create --title "feat(popups): editor de popups no admin e host no CRM" --body-file - <<'EOF'
## O que muda
- Admin: `/admin/popups` com editor de 1 a 6 páginas, preview ao vivo, targeting e agenda iguais aos banners.
- CRM: `GlobalPopupHost` mostra no máximo um popup por sessão, respeita o guia de primeiros passos, grava `seen/closed/cta/ack`.
- Backend: `global_popups`, `popup_interactions`, view de contagens, 4 actions no `platform-admin`, allowlist de imagens no `sign-r2-urls` sob a RLS do usuário.

Spec: `docs/superpowers/specs/2026-09-04-global-popups-design.md`.

## Rollout (ordem obrigatória, o merge deploya o frontend na hora)
1. `supabase db push` em produção.
2. Deploy `platform-admin` e `sign-r2-urls` (`--use-api`).
3. Merge.

## Verificação
- [ ] lint, format, 4x tsc, vitest, deno test, deno check
- [ ] staging: migration + functions + E2E admin → CRM (screenshots abaixo)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 6: Tratar o review externo automático**

O review chega como comentário no PR. Conferir cada ponto contra o código antes de mudar qualquer coisa; responder no PR o que foi aceito e o que foi rejeitado e por quê.
