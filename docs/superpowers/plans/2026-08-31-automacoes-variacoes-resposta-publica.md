# Variações de resposta pública (Fatia 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pool de até 5 respostas públicas por automação de comentário, sorteada uma por envio, com o texto sorteado persistido no send antes de qualquer POST à Graph.

**Architecture:** Coluna `public_replies jsonb` (CHECK via função imutável, backfill da coluna legada `public_reply`, que FICA); coluna `public_reply_text` em `instagram_automation_sends` gravada no mesmo UPDATE do estado em voo `'unknown'`; a RPC `claim_retryable_automation_sends` passa a devolver a coluna nova (DROP + CREATE). No `executeSend`, o texto persistido é autoritativo até o fechamento. UI: a textarea única vira lista de 1..5 variações.

**Tech Stack:** Postgres/Supabase migrations, Deno edge functions, React 19 + TanStack Query, Vitest + `deno test`.

**Spec:** `docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md` (mesma pasta de specs deste repo). Leia a spec inteira antes da Task 1.

## Global Constraints

- Worktree: rode TUDO no worktree desta fatia; confirme com `pwd` e `git branch --show-current` antes do primeiro comando e em todo commit. NUNCA use paths do repo principal.
- Sem travessão (em-dash) em NENHUMA copy voltada a usuário (i18n, toasts, labels). Use ponto, dois-pontos ou "·".
- Migration: prefixo de versão reservado `20260901000001`. Antes do `gh pr create`, rode `git ls-tree origin/main:supabase/migrations | tail -5` e renumere ACIMA do tail se houver colisão (o guard do CI só compara dentro do PR).
- `npm run test:functions` suja o `deno.lock` da raiz; depois de rodá-lo, `git checkout -- deno.lock` antes de commitar (a menos que você tenha adicionado dependência Deno de propósito, o que este plano não faz).
- Se algum comando `deno` rodar, verifique `ls node_modules/.deno` depois; se existir, rode `npm ci` antes de confiar em qualquer checagem npm local.
- Verificação completa antes do PR (é o que o CI roda): `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run test:functions`, `npm run lint`, `npm run format:check` (use `npm run format` para auto-fix).
- Commits pequenos e frequentes; mensagens em pt no padrão do repo (`feat(automacoes): ...`), terminando com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Os testes SQL de entitlements (`supabase/tests/entitlements/*.sql`) precisam de Docker local para rodar na mão; se não houver Supabase local disponível, escreva-os mesmo assim (o CI os executa e barra o merge).

---

### Task 1: Migration + testes SQL

**Files:**
- Create: `supabase/migrations/20260901000001_ig_public_reply_variations.sql`
- Modify: `supabase/tests/entitlements/65_instagram_automations.sql` (adicionar seção 9 ao final, antes do fim do arquivo; atualizar o índice de seções no cabeçalho, linhas 4-27)

**Interfaces:**
- Consumes: schema atual (`instagram_comment_automations.public_reply text`, CHECK 1..500 sem btrim; `claim_retryable_automation_sends(int)` com 12 colunas, definida por último em `20260815000007_automation_requires_manage_messages.sql:10-57`).
- Produces: coluna `instagram_comment_automations.public_replies jsonb NOT NULL DEFAULT '[]'` validada por `validate_ig_public_replies(jsonb)`; coluna `instagram_automation_sends.public_reply_text text`; `claim_retryable_automation_sends(p_limit int DEFAULT 25)` com 13 colunas (a nova `public_reply_text` vem logo após `public_reply_status`).

- [ ] **Step 1: Escrever a migration**

Copie o corpo da RPC vigente de `supabase/migrations/20260815000007_automation_requires_manage_messages.sql:10-57` e acrescente a coluna nova. Conteúdo completo do arquivo novo:

```sql
-- Variações de resposta pública na automação comentário -> DM.
-- Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md
--
-- public_reply (coluna legada) FICA: entre esta migration e o redeploy das
-- functions, o código antigo ainda a lê. O CRM novo grava as duas
-- (public_reply = primeira variação). DROP fica para um ciclo futuro.

-- CASE (não AND) para o type-guard: mesmo racional do validate_ig_dm_buttons
-- (20260819000001) -- Postgres não garante ordem entre operandos de AND.
CREATE FUNCTION validate_ig_public_replies(r jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(r) <> 'array' THEN false
    WHEN jsonb_array_length(r) > 5 THEN false
    ELSE coalesce((
      SELECT bool_and(CASE
        WHEN jsonb_typeof(item) <> 'string' THEN false
        ELSE coalesce(char_length(btrim(item #>> '{}')) BETWEEN 1 AND 500, false)
      END)
      FROM jsonb_array_elements(r) AS item
    ), true)
  END
$$;

ALTER TABLE instagram_comment_automations
  ADD COLUMN public_replies jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill ANTES do CHECK. O CHECK legado de public_reply (1..500 sem btrim)
-- aceita string só de espaços; um valor desses viraria array inválido para o
-- validador novo -- filtra para '[]'.
UPDATE instagram_comment_automations
   SET public_replies = jsonb_build_array(public_reply)
 WHERE public_reply IS NOT NULL AND btrim(public_reply) <> '';

ALTER TABLE instagram_comment_automations
  ADD CONSTRAINT ica_public_replies_valid CHECK (validate_ig_public_replies(public_replies));

-- Snapshot do texto sorteado, gravado junto com o estado em voo 'unknown'.
-- Sem CHECK de conteúdo: é snapshot, não entrada de usuário.
ALTER TABLE instagram_automation_sends
  ADD COLUMN public_reply_text text;

-- A lista de colunas do RETURNS TABLE muda -> DROP + CREATE (OR REPLACE não
-- pode mudar o tipo de retorno). Precedente: 20260819000001. Entre a migration
-- e o redeploy, o cron antigo ignora a coluna extra sem quebrar.
DROP FUNCTION claim_retryable_automation_sends(int);

CREATE FUNCTION claim_retryable_automation_sends(p_limit int DEFAULT 25)
RETURNS TABLE (
  send_id uuid,
  comment_id text,
  automation_id uuid,
  conta_id uuid,
  media_id text,
  commenter_id text,
  comment_created_at timestamptz,
  dm_status text,
  public_reply_status text,
  public_reply_text text,
  attempts int,
  encrypted_access_token text,
  instagram_user_id text
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT s.id
      FROM instagram_automation_sends s
      JOIN instagram_comment_automations a ON a.id = s.automation_id
      JOIN instagram_accounts ia
        ON ia.client_id = a.client_id
       AND ia.authorization_status = 'active'
       AND ia.comments_subscribed_at IS NOT NULL
       AND 'instagram_business_manage_comments' = ANY (ia.permissions)
       AND 'instagram_business_manage_messages' = ANY (ia.permissions)
     WHERE ((s.status = 'retry' AND s.next_attempt_at <= now())
         OR (s.status = 'processing' AND s.processing_at < now() - interval '10 minutes'))
       AND s.comment_created_at > now() - interval '7 days'
       FOR UPDATE OF s SKIP LOCKED
     LIMIT p_limit
  ), updated AS (
    UPDATE instagram_automation_sends
       SET status = 'processing', processing_at = now()
     WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT u.id, u.comment_id, u.automation_id, u.conta_id, u.media_id,
         u.commenter_id, u.comment_created_at, u.dm_status,
         u.public_reply_status, u.public_reply_text, u.attempts,
         ia.encrypted_access_token, ia.instagram_user_id
    FROM updated u
    JOIN instagram_comment_automations a ON a.id = u.automation_id
    JOIN instagram_accounts ia ON ia.client_id = a.client_id
$$;

REVOKE ALL ON FUNCTION claim_retryable_automation_sends(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_retryable_automation_sends(int) TO service_role;
```

ATENÇÃO: antes de commitar, abra `supabase/migrations/20260815000007_automation_requires_manage_messages.sql` e confira que o corpo copiado acima bate LINHA A LINHA com o vigente (joins, WHERE, SKIP LOCKED). Se divergirem, o vigente vence; a única mudança intencional é a coluna `public_reply_text` no RETURNS TABLE e no SELECT final.

- [ ] **Step 2: Escrever a seção 9 dos testes SQL**

Em `supabase/tests/entitlements/65_instagram_automations.sql`, adicione ao FINAL do arquivo (seguindo o padrão das seções 7-8: `begin;` → `do $$ ... $$;` → `rollback;`, rodando como table owner nas partes de RPC — comentários nas linhas 143-144 e 509-510 explicam o stand-in de service_role):

```sql
-- ---------------------------------------------------------------------------
-- 9. public_replies: CHECK, backfill e claim_retryable devolve public_reply_text
-- ---------------------------------------------------------------------------
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_cli int;
  v_owner uuid;
  v_rejected boolean;
  v_auto uuid;
begin
  select workspace_id, client_id, owner_id into v_ws, v_cli, v_owner from et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- (a) válido: 5 variações de 500 chars como authenticated
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, public_replies)
    values (v_ws, v_cli, 'Cinco', array['x'], 'msg',
      to_jsonb(array_fill(repeat('a', 500), array[5])))
    returning id into v_auto;

  -- (b) 6 variações -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, public_replies)
      values (v_ws, v_cli, 'Seis', array['x'], 'msg',
        to_jsonb(array_fill('oi'::text, array[6])));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, '6 variações devem ser rejeitadas';

  -- (c) item vazio após btrim -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, public_replies)
      values (v_ws, v_cli, 'Vazia', array['x'], 'msg', '["ok", "   "]'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'variação só de espaços deve ser rejeitada';

  -- (d) item de 501 chars -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, public_replies)
      values (v_ws, v_cli, 'Longa', array['x'], 'msg',
        jsonb_build_array(repeat('a', 501)));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'variação de 501 chars deve ser rejeitada';

  -- (e) não-array -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, public_replies)
      values (v_ws, v_cli, 'NaoArray', array['x'], 'msg', '"oi"'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'public_replies não-array deve ser rejeitado';

  reset role;
  raise notice 'PASS 65 seção 9a: CHECKs de public_replies';
end $$;
rollback;

-- Backfill: simula a janela pré-migration inserindo com public_reply legado e
-- re-rodando o UPDATE de backfill (a migration real já rodou no schema do
-- teste; aqui provamos a EXPRESSÃO de backfill contra os dois casos).
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_cli int;
  v_owner uuid;
  v_normal uuid;
  v_blank uuid;
begin
  select workspace_id, client_id, owner_id into v_ws, v_cli, v_owner from et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, public_reply)
    values (v_ws, v_cli, 'Com reply', array['x'], 'msg', 'olha a DM')
    returning id into v_normal;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, public_reply)
    values (v_ws, v_cli, 'Só espaços', array['x'], 'msg', '   ')
    returning id into v_blank;

  update instagram_comment_automations
     set public_replies = jsonb_build_array(public_reply)
   where public_reply is not null and btrim(public_reply) <> ''
     and id in (v_normal, v_blank);

  assert (select public_replies from instagram_comment_automations where id = v_normal)
         = '["olha a DM"]'::jsonb, 'backfill deve virar array de 1';
  assert (select public_replies from instagram_comment_automations where id = v_blank)
         = '[]'::jsonb, 'public_reply só de espaços deve ficar []';

  raise notice 'PASS 65 seção 9b: backfill de public_replies';
end $$;
rollback;

-- claim_retryable_automation_sends devolve public_reply_text (como owner,
-- stand-in do service_role -- ver seções 4/6/8).
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_cli int;
  v_owner uuid;
  v_auto uuid;
  v_send uuid;
  v_row record;
begin
  select workspace_id, client_id, owner_id into v_ws, v_cli, v_owner from et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into instagram_accounts
    (conta_id, client_id, instagram_user_id, encrypted_access_token,
     authorization_status, permissions, comments_subscribed_at)
    values (v_ws, v_cli, 'ig-1', 'enc-tok', 'active',
      array['instagram_business_manage_comments','instagram_business_manage_messages'],
      now());
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, public_replies)
    values (v_ws, v_cli, 'Retry', array['x'], 'msg', '["variação A"]'::jsonb)
    returning id into v_auto;
  insert into instagram_automation_sends
    (comment_id, automation_id, conta_id, commenter_id, comment_text,
     comment_created_at, status, next_attempt_at, attempts, public_reply_text)
    values ('c-9', v_auto, v_ws, 'u-9', 'x', now(), 'retry', now() - interval '1 minute',
      1, 'variação A')
    returning id into v_send;

  select * into v_row from claim_retryable_automation_sends(10);
  assert v_row.send_id = v_send, 'claim deve devolver o send em retry';
  assert v_row.public_reply_text = 'variação A',
    'claim deve devolver public_reply_text';

  raise notice 'PASS 65 seção 9c: claim devolve public_reply_text';
end $$;
rollback;
```

ATENÇÃO: antes de escrever, abra as seções 5-6 do arquivo (linhas 197-329) e copie os NOMES DE COLUNA exatos usados nos inserts de `instagram_accounts` e `instagram_automation_sends` de lá; se divergirem dos acima (por exemplo colunas NOT NULL extras), o arquivo existente vence. Atualize também o índice de seções no cabeçalho (linhas 4-27) com a seção 9.

- [ ] **Step 3: Rodar os testes SQL se houver Supabase local; senão, validar a sintaxe**

Rode: `cat supabase/.temp/project-ref 2>/dev/null` (só para registro; NÃO faça db push). Se Docker/colima estiver disponível: `supabase start` + `bash scripts/test-entitlements.sh` e confirme `PASS 65 seção 9a/9b/9c`. Se não: siga em frente; o job `entitlement-tests` do CI executa e barra o merge.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260901000001_ig_public_reply_variations.sql supabase/tests/entitlements/65_instagram_automations.sql
git commit -m "feat(automacoes): schema de variações de resposta pública (public_replies + public_reply_text)"
```

---

### Task 2: Helper puro `instagram-public-replies.ts`

**Files:**
- Create: `supabase/functions/_shared/instagram-public-replies.ts`
- Create: `supabase/functions/__tests__/instagram-public-replies_test.ts`

**Interfaces:**
- Consumes: nada (módulo puro).
- Produces: `MAX_PUBLIC_REPLIES = 5`; `parsePublicReplies(raw: unknown, legacy: string | null | undefined): string[]`; `pickPublicReply(replies: string[], random: () => number): string | null`. A Task 3 importa os três.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// supabase/functions/__tests__/instagram-public-replies_test.ts
import { assertEquals } from "jsr:@std/assert";
import {
  MAX_PUBLIC_REPLIES,
  parsePublicReplies,
  pickPublicReply,
} from "../_shared/instagram-public-replies.ts";

Deno.test("parsePublicReplies: array válido passa direto", () => {
  assertEquals(parsePublicReplies(["a", "b"], null), ["a", "b"]);
});

Deno.test("parsePublicReplies: null/undefined caem no legado", () => {
  assertEquals(parsePublicReplies(null, "legado"), ["legado"]);
  assertEquals(parsePublicReplies(undefined, "legado"), ["legado"]);
});

Deno.test("parsePublicReplies: array vazio cai no legado; legado vazio/espac,os vira []", () => {
  assertEquals(parsePublicReplies([], "legado"), ["legado"]);
  assertEquals(parsePublicReplies([], "   "), []);
  assertEquals(parsePublicReplies([], null), []);
});

Deno.test("parsePublicReplies: fail-open descarta itens malformados sem lançar", () => {
  assertEquals(parsePublicReplies(["ok", 7, "  ", null], null), ["ok"]);
  assertEquals(parsePublicReplies("não-array", "legado"), ["legado"]);
});

Deno.test("parsePublicReplies: corta acima de MAX_PUBLIC_REPLIES", () => {
  const seven = ["1", "2", "3", "4", "5", "6", "7"];
  assertEquals(parsePublicReplies(seven, null).length, MAX_PUBLIC_REPLIES);
});

Deno.test("pickPublicReply: determinístico via random injetado; [] devolve null", () => {
  assertEquals(pickPublicReply(["a", "b", "c"], () => 0), "a");
  assertEquals(pickPublicReply(["a", "b", "c"], () => 0.99), "c");
  assertEquals(pickPublicReply([], () => 0), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/instagram-public-replies_test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementar o módulo**

```ts
// supabase/functions/_shared/instagram-public-replies.ts
// Pool de respostas públicas da automação comentário -> DM. Módulo puro.
// Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md
//
// Fail-open POR DESIGN, mesmo racional do parseDmButtons (instagram-dm-payload.ts):
// o enforcement da forma é o CHECK do banco; um throw aqui envenenaria envios.
// A janela migration -> redeploy chega com public_replies ausente (undefined),
// e automações antigas com '[]' -- nos dois casos o legado public_reply decide.

export const MAX_PUBLIC_REPLIES = 5;

export function parsePublicReplies(
  raw: unknown,
  legacy: string | null | undefined,
): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    let discarded = 0;
    for (const item of raw) {
      if (out.length >= MAX_PUBLIC_REPLIES) {
        discarded++;
        continue;
      }
      if (typeof item !== "string" || item.trim() === "") {
        discarded++;
        continue;
      }
      out.push(item);
    }
    if (discarded > 0) {
      console.warn(`[instagram-public-replies] ${discarded} item(ns) descartado(s)`);
    }
  } else if (raw !== undefined && raw !== null) {
    console.warn("[instagram-public-replies] public_replies não é array; ignorando:", typeof raw);
  }
  if (out.length > 0) return out;
  if (typeof legacy === "string" && legacy.trim() !== "") return [legacy];
  return [];
}

export function pickPublicReply(replies: string[], random: () => number): string | null {
  if (replies.length === 0) return null;
  const idx = Math.min(replies.length - 1, Math.floor(random() * replies.length));
  return replies[idx];
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/instagram-public-replies_test.ts`
Expected: PASS (7 testes). Confira o import de assert usado nos outros testes do diretório (`supabase/functions/__tests__/assert.ts` existe; se `jsr:@std/assert` não for o padrão do arquivo vizinho `instagram-dm-payload_test.ts`, use o MESMO import que ele usa).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-public-replies.ts supabase/functions/__tests__/instagram-public-replies_test.ts
git commit -m "feat(automacoes): helper puro de pool de respostas públicas"
```

---

### Task 3: `executeSend` — sorteio persistido e texto autoritativo

**Files:**
- Modify: `supabase/functions/instagram-webhook/process.ts`
- Modify: `supabase/functions/__tests__/instagram-webhook-process_test.ts`
- Modify: `supabase/functions/__tests__/instagram-automation-cron_test.ts` (fixture `claimedSendFixture`, linhas 80-96)

**Interfaces:**
- Consumes: `parsePublicReplies`/`pickPublicReply` da Task 2; colunas da Task 1.
- Produces: `ClaimedSend` ganha `public_reply_text: string | null` (process.ts:59-75); `SendContext` ganha `random?: () => number`; `RevalidatedAutomation` ganha `public_replies: unknown`. O cron (`instagram-automation-cron/handler.ts:164`) faz cast direto das linhas da RPC para `ClaimedSend[]` e NÃO precisa mudar: a coluna nova da RPC preenche o campo novo por nome.

- [ ] **Step 1: Escrever os testes que falham**

Em `supabase/functions/__tests__/instagram-webhook-process_test.ts`, siga os padrões existentes: `createSupabaseQueryMock()`, `routedFetch({...})`, `callsFor(db, tabela, op)`, fixtures `revalidatedAutomation(...)` / `baseClaimedSend(...)` / `baseSendCtx(db, {...})` (linhas 37-189). Ajustes de fixture primeiro:

1. `baseClaimedSend` (linha ~159): adicione `public_reply_text: null` ao objeto base.
2. `revalidatedAutomation` (linha ~138): adicione `public_replies: []` ao objeto base (o fallback legado mantém os testes atuais passando).
3. `baseSendCtx` (linha ~177): adicione `random: () => 0` ao contexto default.
4. No cron test, `claimedSendFixture` (linhas 80-96): adicione `public_reply_text: null`.

Casos novos (adicione no bloco `executeSend`, após os casos de public_reply existentes):

```ts
Deno.test("executeSend (pr-1): sorteia do pool, persiste texto+unknown ANTES do POST e posta o sorteado", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: revalidatedAutomation({ public_reply: null, public_replies: ["opção A", "opção B"] }),
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // em voo
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // sent
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn, calls } = routedFetch({
    privateReply: () => ({ body: {} }),
    publicReply: () => ({ body: { id: "reply-1" } }),
  });

  await executeSend(
    baseSendCtx(db, { fetchFn, random: () => 0.9 }),
    baseClaimedSend({}),
  );

  const updates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(updates[0].payload, {
    public_reply_status: "unknown",
    public_reply_text: "opção B",
  });
  const publicPost = calls.find((c) => c.method === "POST" && c.url.includes("/replies"));
  assertEquals(JSON.parse(publicPost?.body ?? "null"), { message: "opção B" });
  assertEquals(updates[1].payload, { public_reply_id: "reply-1", public_reply_status: "sent" });
});

Deno.test("executeSend (pr-2): reentrada com texto persistido não re-sorteia e reconcilia por ele", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: revalidatedAutomation({ public_reply: null, public_replies: ["outra coisa"] }),
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // reconciled
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn, calls } = routedFetch({
    fetchReplies: () => ({
      body: { data: [{ id: "r-77", text: "texto sorteado antes", from: { id: IG_USER_ID } }] },
    }),
  });

  await executeSend(
    baseSendCtx(db, { fetchFn }),
    baseClaimedSend({
      dm_status: "sent",
      public_reply_status: "unknown",
      public_reply_text: "texto sorteado antes",
    }),
  );

  assertEquals(calls.filter((c) => c.method === "POST").length, 0);
  const updates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(updates[0].payload, { public_reply_id: "r-77", public_reply_status: "sent" });
});

Deno.test("executeSend (pr-3): unknown com pool esvaziado ainda reconcilia pelo texto persistido e nunca fecha sent sem achar", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: revalidatedAutomation({ public_reply: null, public_replies: [] }),
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn, calls } = routedFetch({
    fetchReplies: () => ({ body: { data: [] } }),
  });

  await executeSend(
    baseSendCtx(db, { fetchFn }),
    baseClaimedSend({
      dm_status: "sent",
      public_reply_status: "unknown",
      public_reply_text: "texto sorteado antes",
    }),
  );

  // Reconciliação RODOU (GET replies) mesmo com pool vazio...
  assertEquals(calls.filter((c) => c.method === "GET" && c.url.includes("/replies?")).length, 1);
  // ...não achou, então fecha sent_partial (nunca 'sent').
  const updates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(updates[updates.length - 1].payload, { status: "sent_partial" });
});

Deno.test("executeSend (pr-4): send legado unknown sem texto persistido reconcilia contra o pool", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: revalidatedAutomation({ public_reply: "legado", public_replies: [] }),
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // reconciled
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn } = routedFetch({
    fetchReplies: () => ({
      body: { data: [{ id: "r-88", text: "legado", from: { id: IG_USER_ID } }] },
    }),
  });

  await executeSend(
    baseSendCtx(db, { fetchFn }),
    baseClaimedSend({ dm_status: "sent", public_reply_status: "unknown", public_reply_text: null }),
  );

  const updates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(updates[0].payload, { public_reply_id: "r-88", public_reply_status: "sent" });
});
```

ATENÇÃO: os shapes exatos de `routedFetch` handlers e dos payloads de update devem ser conferidos contra casos vizinhos do arquivo (ex.: o caso de reconciliação atual). Se o POST de reply pública usar outro shape de body (veja `replyToComment` em `_shared/instagram-messaging.ts:100-108` -- o body é `{ message: text }`), o teste segue esse shape.

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/instagram-webhook-process_test.ts --no-check 2>&1 | tail -20`
Expected: FAIL nos 4 casos novos (campos inexistentes / comportamento antigo). Os casos antigos podem falhar em compile por causa dos fixtures; ajuste os fixtures primeiro se necessário.

- [ ] **Step 3: Implementar em `process.ts`**

Mudanças pontuais:

1. Import: `import { parsePublicReplies, pickPublicReply } from "../_shared/instagram-public-replies.ts";`
2. `ClaimedSend`: adicionar `public_reply_text: string | null;` (documente: snapshot do sorteio; NULL = ainda não sorteado ou send legado).
3. `SendContext`: adicionar `random?: () => number;`
4. `RevalidatedAutomation`: adicionar `public_replies: unknown;` e incluir `public_replies` no `.select(...)` da revalidação (linha 413).
5. No `processRow`, o objeto `send: ClaimedSend` (linha ~350) ganha `public_reply_text: null`.
6. Substituir o bloco de resposta pública (linhas 576-700) por esta lógica (mantendo TODOS os comentários de invariante existentes, adaptados):

```ts
  // 4. Resposta pública (opcional; NÃO idempotente -> nunca reposta às cegas).
  // A variação PLANEJADA é autoritativa: uma vez sorteada e persistida em
  // public_reply_text (no mesmo UPDATE do estado em voo 'unknown'), edições na
  // automação -- inclusive esvaziar o pool -- não mudam o que este send faz.
  const random = ctx.random ?? Math.random;
  const pool = parsePublicReplies(automation.public_replies, automation.public_reply);
  let finalPublicReplyStatus = send.public_reply_status;

  // Reconciliador: com texto persistido, casa só contra ele; send legado em
  // voo (criado antes desta versão) casa contra qualquer item do pool atual.
  const matchesPlanned = (t: string | undefined): boolean =>
    send.public_reply_text !== null ? t === send.public_reply_text : t !== undefined && pool.includes(t);

  // "Havia resposta planejada" decide reconciliação e fechamento: texto
  // persistido, OU estado em voo/failed anterior, OU pool atual não-vazio.
  const hadPlanned = send.public_reply_text !== null ||
    send.public_reply_status === "unknown" ||
    send.public_reply_status === "failed" ||
    pool.length > 0;

  if (hadPlanned && send.public_reply_status !== "sent") {
    if (send.public_reply_status === "unknown") {
      // Reentrada: nunca reposta, só reconcilia via GET replies.
      let found: { id: string } | undefined;
      try {
        const replies = await fetchReplies(msgDeps, { commentId: send.comment_id, token });
        found = replies.find((r) => r.from?.id === send.instagram_user_id && matchesPlanned(r.text));
      } catch (reconcileErr) {
        console.error(
          `[instagram-webhook] fetchReplies falhou na reconciliação (reentrada) do send ${send.send_id}:`,
          errMessage(reconcileErr),
        );
      }
      if (found) {
        const { error } = await ctx.svc
          .from("instagram_automation_sends")
          .update({ public_reply_id: found.id, public_reply_status: "sent" })
          .eq("id", send.send_id);
        if (error) throw new Error(`instagram_automation_sends (public_reply reconciled): ${errMessage(error)}`);
        finalPublicReplyStatus = "sent";
      }
    } else {
      // Primeira tentativa (ou 'failed' confirmado sem post). Sorteia UMA vez
      // (ou reusa o snapshot de uma rodada 'failed' anterior) e persiste o
      // texto JUNTO com o estado em voo, antes de qualquer chamada externa.
      const planned = send.public_reply_text ?? pickPublicReply(pool, random);
      if (planned !== null) {
        const { error: markErr } = await ctx.svc
          .from("instagram_automation_sends")
          .update({ public_reply_status: "unknown", public_reply_text: planned })
          .eq("id", send.send_id);
        if (markErr) {
          throw new Error(`instagram_automation_sends (public_reply em voo): ${errMessage(markErr)}`);
        }
        finalPublicReplyStatus = "unknown";

        let replyId: string | undefined;
        try {
          const result = await replyToComment(msgDeps, {
            commentId: send.comment_id,
            token,
            text: planned,
          });
          replyId = result.replyId;
        } catch (err) {
          const kind = classifyIgError(err);
          if (kind === "timeout") {
            let found: { id: string } | undefined;
            try {
              const replies = await fetchReplies(msgDeps, { commentId: send.comment_id, token });
              found = replies.find((r) => r.from?.id === send.instagram_user_id && r.text === planned);
            } catch (reconcileErr) {
              console.error(
                `[instagram-webhook] fetchReplies falhou na reconciliação do send ${send.send_id}:`,
                errMessage(reconcileErr),
              );
            }
            if (found) {
              const { error } = await ctx.svc
                .from("instagram_automation_sends")
                .update({ public_reply_id: found.id, public_reply_status: "sent" })
                .eq("id", send.send_id);
              if (error) {
                throw new Error(`instagram_automation_sends (public_reply reconciled): ${errMessage(error)}`);
              }
              finalPublicReplyStatus = "sent";
            }
          } else {
            const { error } = await ctx.svc
              .from("instagram_automation_sends")
              .update({ public_reply_status: "failed" })
              .eq("id", send.send_id);
            if (error) throw new Error(`instagram_automation_sends (public_reply failed): ${errMessage(error)}`);
            finalPublicReplyStatus = "failed";
          }
        }

        if (replyId !== undefined) {
          const { error } = await ctx.svc
            .from("instagram_automation_sends")
            .update({ public_reply_id: replyId, public_reply_status: "sent" })
            .eq("id", send.send_id);
          if (error) throw new Error(`instagram_automation_sends (public_reply sent): ${errMessage(error)}`);
          finalPublicReplyStatus = "sent";
        }
      }
    }
  }

  // 5. Fechamento: 'sent' só quando não havia resposta planejada ou ela saiu.
  const closingStatus = !hadPlanned || finalPublicReplyStatus === "sent" ? "sent" : "sent_partial";
```

Preserve o restante do fechamento (UPDATE com `.eq("status", "processing")`) intacto. IMPORTANTE: o caso "primeira tentativa com pool vazio e sem snapshot" tem `hadPlanned === false` e cai direto no fechamento como `sent` -- comportamento idêntico ao atual quando `public_reply` é NULL.

- [ ] **Step 4: Rodar e ver passar (novos E antigos)**

Run: `deno test supabase/functions/__tests__/instagram-webhook-process_test.ts`
Expected: PASS em todos (50 antigos + 4 novos). Depois: `deno test supabase/functions/__tests__/instagram-automation-cron_test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-webhook/process.ts supabase/functions/__tests__/instagram-webhook-process_test.ts supabase/functions/__tests__/instagram-automation-cron_test.ts
git commit -m "feat(automacoes): sorteio de resposta pública persistido e autoritativo no executeSend"
```

---

### Task 4: Store do CRM — tipos e whitelists

**Files:**
- Modify: `apps/crm/src/store/instagramAutomations.ts`
- Test: procure o teste existente do store (`grep -rl "createInstagramAutomation" apps/crm/src --include="*.test.*"`); se houver whitelist testada, atualize; senão, os testes do form (Task 5) cobrem o payload.

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `InstagramCommentAutomation` ganha `public_replies: string[]`; `InstagramAutomationSend` ganha `public_reply_text: string | null`; as whitelists de `createInstagramAutomation` (L102-116) e `updateInstagramAutomation` (L133-151) ganham `'public_replies'` no `Pick`. A Task 5 monta payloads `{ public_replies, public_reply }`.

- [ ] **Step 1: Editar tipos e whitelists**

Em `InstagramCommentAutomation` (L19-45), adicione `public_replies: string[];` logo após `public_reply: string | null;`. Em `InstagramAutomationSend` (L47-65), adicione `public_reply_text: string | null;` após `public_reply_status`. Nas duas whitelists (`Pick` do create em L102-116 e do update em L133-151), acrescente `| 'public_replies'`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: erros APENAS onde o form ainda não envia `public_replies` (se o Pick do create for exigido integral pelo call site, o erro aparece no `AutomationFormDialog` — ele guia a Task 5). Se não houver erro, siga.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/store/instagramAutomations.ts
git commit -m "feat(automacoes): public_replies e public_reply_text nos tipos e whitelists do store"
```

---

### Task 5: Formulário — editor de variações + i18n

**Files:**
- Modify: `apps/crm/src/pages/automacoes/AutomationFormDialog.tsx`
- Modify: `packages/i18n/locales/pt/automations.json` e `packages/i18n/locales/en/automations.json`
- Test: `apps/crm/src/pages/automacoes/__tests__/AutomationFormDialog.test.tsx`

**Interfaces:**
- Consumes: whitelists da Task 4; padrão visual do editor de botões (AutomationFormDialog.tsx L1102-1167).
- Produces: estado `publicReplies: string[]` no form; payload `{ public_replies: string[], public_reply: string | null }`.

- [ ] **Step 1: Escrever os testes que falham**

No arquivo de teste, siga os helpers existentes (`renderDialog`, `fillRequiredFields`, mocks com `t` devolvendo a chave). Casos novos:

```tsx
it('salva variações preenchidas como public_replies e espelha a primeira em public_reply', async () => {
  renderDialog();
  await fillRequiredFields();

  fireEvent.change(screen.getByLabelText('form.replyVariationLabel:{"index":1}'), {
    target: { value: 'Te chamei na DM!' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'form.addReply' }));
  fireEvent.change(screen.getByLabelText('form.replyVariationLabel:{"index":2}'), {
    target: { value: 'Olha o direct!' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      public_replies: ['Te chamei na DM!', 'Olha o direct!'],
      public_reply: 'Te chamei na DM!',
    }),
  );
});

it('variações vazias são descartadas; tudo vazio vira public_replies [] e public_reply null', async () => {
  renderDialog();
  await fillRequiredFields();
  fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ public_replies: [], public_reply: null }),
  );
});

it('editar automação legada abre public_reply como lista de 1 variação', async () => {
  renderDialog(vi.fn(), { ...EDITING_BASE, public_reply: 'legada', public_replies: [] });
  expect(await screen.findByLabelText('form.replyVariationLabel:{"index":1}')).toHaveValue('legada');
});

it('botão de adicionar some com 5 variações', async () => {
  renderDialog(vi.fn(), {
    ...EDITING_BASE,
    public_replies: ['a', 'b', 'c', 'd', 'e'],
  });
  await screen.findByLabelText('form.replyVariationLabel:{"index":5}');
  expect(screen.queryByRole('button', { name: 'form.addReply' })).not.toBeInTheDocument();
});
```

ATENÇÃO: `EDITING_BASE` (L231-252 do teste) não tem `public_replies`; adicione `public_replies: []` ao fixture. O formato `label:{"vars"}` vem do mock de `t` do próprio arquivo (`vars ? \`${key}:${JSON.stringify(vars)}\` : key`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomationFormDialog.test.tsx 2>&1 | tail -20`
Expected: FAIL nos 4 casos novos.

- [ ] **Step 3: Implementar no form**

1. `emptyState()` (L107-120): troque `publicReply: ''` por `publicReplies: [] as string[]`.
2. Seed do editing (L406-434): troque a linha do publicReply por:
```ts
publicReplies:
  (editing.public_replies ?? []).length > 0
    ? [...editing.public_replies]
    : editing.public_reply
      ? [editing.public_reply]
      : [],
```
3. Helpers (junto de `updateButton`, L472-478):
```ts
const MAX_PUBLIC_REPLIES = 5;
const updateReply = (index: number, value: string) =>
  setForm((f) => ({ ...f, publicReplies: f.publicReplies.map((r, i) => (i === index ? value : r)) }));
const removeReply = (index: number) =>
  setForm((f) => ({ ...f, publicReplies: f.publicReplies.filter((_, i) => i !== index) }));
```
4. Substituir o bloco `data-tour="campo-resposta"` (L1169-1184) por uma lista no padrão visual do editor de botões (L1102-1167): label `t('form.repliesLabel')`, help `t('form.repliesHelp')`, uma linha por variação com `Textarea` (`maxLength={500}`, `rows={2}`, `aria-label={t('form.replyVariationLabel', { index: i + 1 })}`, contador `{r.length}/500`) + botão ghost com `X` (`aria-label={t('form.removeReply')}`), e no fim, quando `form.publicReplies.length < MAX_PUBLIC_REPLIES`, o botão outline `t('form.addReply')` que faz `setForm((f) => ({ ...f, publicReplies: [...f.publicReplies, ''] }))`. Renderize SEMPRE ao menos 1 linha: se `publicReplies.length === 0`, trate como `['']` na renderização E no estado inicial do seed (mais simples: `emptyState` já com `['']` e o seed acima com fallback `['']`; nesse caso ajuste o caso de teste 2, que continua valendo porque strings vazias são descartadas no submit).
5. Payload (L598-606): troque `public_reply: form.publicReply.trim() || null` por:
```ts
public_replies: cleanedReplies,
public_reply: cleanedReplies[0] ?? null,
```
com, antes do objeto: `const cleanedReplies = form.publicReplies.map((r) => r.trim()).filter((r) => r !== '');`
6. `confirmClose` (L713-718): inclua `form.publicReplies.some((r) => r.trim() !== '')` na detecção de rascunho.

- [ ] **Step 4: i18n**

Em `packages/i18n/locales/pt/automations.json`, dentro de `form`, remova NADA (as chaves `replyLabel`/`replyPlaceholder` podem ficar para histórico, mas prefira removê-las se nenhum código as referenciar após o passo 3 -- confirme com `grep -rn "replyLabel\|replyPlaceholder" apps/`) e adicione:

```json
"repliesLabel": "Respostas públicas (opcional)",
"repliesHelp": "Até 5 variações. Uma é sorteada a cada comentário, para as respostas não parecerem repetidas.",
"replyVariationLabel": "Variação {{index}}",
"addReply": "Adicionar variação",
"removeReply": "Remover variação",
"replyPlaceholderVariation": "Respondido no direct! ✉️"
```

Em `en`:

```json
"repliesLabel": "Public replies (optional)",
"repliesHelp": "Up to 5 variations. One is drawn for each comment so replies do not look repeated.",
"replyVariationLabel": "Variation {{index}}",
"addReply": "Add variation",
"removeReply": "Remove variation",
"replyPlaceholderVariation": "Replied in your DMs! ✉️"
```

Sem travessão em nenhum valor.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/ && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS em toda a pasta (form + DmPreview + dmButtons + página) e typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/automacoes/AutomationFormDialog.tsx packages/i18n/locales/pt/automations.json packages/i18n/locales/en/automations.json apps/crm/src/pages/automacoes/__tests__/AutomationFormDialog.test.tsx
git commit -m "feat(automacoes): editor de variações de resposta pública no formulário"
```

Nota de escopo: `AutomacoesPage.tsx` NÃO muda nesta fatia -- a página não exibe `public_reply` em lugar nenhum hoje (verificado), então não há nada a trocar por `public_reply_text`.

Nota de escopo (decisão da spec sobre o agente MCP, já resolvida): `instagram_comment_automations` não tem allowlist de colunas (o gotcha de GRANT por coluna vale só para membros/clientes) e a migration `20260829000002` só recria policies RLS por linha; `public_replies` fica automaticamente gravável pelo caminho do agente. Nada a fazer além do CHECK, que vale para qualquer gravador.

---

### Task 6: Verificação final e PR

**Files:** nenhum novo.

- [ ] **Step 1: Suíte completa**

Rode, na ordem, e cole a saída final de cada um:

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
npm run lint
npm run format:check
```

`npm run format` para auto-fix se o format:check reclamar; depois `git checkout -- deno.lock` se o test:functions o sujou. Tudo verde antes de seguir.

- [ ] **Step 2: Re-verificar versão da migration**

Run: `git ls-tree origin/main:supabase/migrations | tail -5` (após `git fetch origin main`). Se existir prefixo >= `20260901000001` em main, renumere a migration ACIMA do tail (e mantenha-a ABAIXO de `20260901000002`, reservado para a fatia 2; se precisar subir além, use `2026090100000X` baixo e avise no PR).

- [ ] **Step 3: Commit final e PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(automacoes): variações de resposta pública sorteadas por envio" --body "$(cat <<'EOF'
## Resumo
- Pool de até 5 respostas públicas por automação (public_replies jsonb + CHECK), sorteada uma por envio
- Texto sorteado persistido em instagram_automation_sends.public_reply_text no mesmo UPDATE do estado em voo, autoritativo até o fechamento (reconciliação pós-crash casa por ele)
- claim_retryable_automation_sends devolve a coluna nova (DROP + CREATE)
- Editor de variações no formulário (padrão do editor de botões); public_reply legado segue gravado como primeira variação

Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md

## Deploy
Migration ANTES do redeploy de instagram-webhook + instagram-automation-cron (--use-api --no-verify-jwt).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Reporte o link do PR e PARE: o review externo do Codex dispara automaticamente e será triado pelo orquestrador.
