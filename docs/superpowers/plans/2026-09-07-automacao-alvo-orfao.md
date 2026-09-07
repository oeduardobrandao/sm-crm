# Alvo órfão de automação de comentário: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer uma automação de comentário mirada em "post em produção" parar de ficar
muda e invisível quando o post é marcado como "postado" sem passar pela publicação via
API, marcando o estado, notificando o dono e oferecendo re-mirar em um post publicado.

**Architecture:** Uma coluna `target_unlinked_at` em `instagram_comment_automations` é
mantida por uma RPC de reconciliação idempotente chamada a cada tick do
`instagram-automation-cron` (5 min), que carimba e limpa a marca; a mesma fase notifica
depois de 15 minutos de carência. A UI passa a distinguir "aguardando publicação" de
"alvo não vinculado" e oferece um seletor de mídias publicadas que consulta a Graph API
ao vivo, por uma rota nova no `instagram-integration`.

**Tech Stack:** Postgres (plpgsql, RLS), Deno edge functions, React 19 + TanStack Query,
Vitest, `deno test`, psql (suíte de entitlements).

**Spec:** `docs/superpowers/specs/2026-09-07-automacao-alvo-orfao-design.md`

## Global Constraints

- **Copy em português, sem travessão.** Use ponto, dois-pontos ou "·". Travessão foi
  rejeitado pelo usuário como "cara de AI slop".
- **Migration:** o tail de `origin/main` hoje é `20260912000002`. Use
  `20260913000001_ica_target_unlinked.sql`. **Reconfira o tail com
  `git ls-tree --name-only origin/main supabase/migrations/ | tail -5` antes de abrir o
  PR** e renumere se algo tiver entrado acima. Prefixo duplicado faz o Supabase pular a
  segunda migration em silêncio.
- **RPC nova é service_role-only** e o `REVOKE` precisa citar `anon` e `authenticated`
  explicitamente: `REVOKE ... FROM PUBLIC` não tira o grant direto que os defaults de
  prod dão a funções novas.
- **Edge functions:** nunca devolver detalhe de erro ao cliente. Mensagem genérica para
  fora, detalhe no `console.error`. CORS sempre via `buildCorsHeaders(req)`.
- **Toda I/O de handler tem prazo.** Chamada externa usa `makeBoundedFetch` de
  `_shared/bounded-fetch.ts`.
- **Antes de rodar checks locais**, se qualquer `deno test` tiver rodado no worktree,
  rode `npm ci`: runs de Deno poluem `node_modules/.deno` e fazem `tsc` e `prettier`
  acusarem erros fantasmas.
- **Checks que o CI roda:** `npm run lint`, `npm run format:check`, os quatro `tsc`
  (`apps/crm`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`,
  `npm run test:functions`. `npm run build` NÃO é o typecheck: ele só cobre o CRM.

---

## Estrutura de arquivos

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260913000001_ica_target_unlinked.sql` | coluna, RPC de reconciliação, edição do resolver, grants |
| `supabase/tests/entitlements/81_ica_target_unlinked.sql` | suíte psql da RPC e do resolver |
| `supabase/functions/instagram-integration/published-media.ts` | handler isolado da rota nova, testável sem subir a função inteira |
| `supabase/functions/__tests__/instagram-integration-published-media_test.ts` | testes da rota |
| `apps/crm/src/services/publishedMedia.ts` | cliente da rota nova, no padrão de `services/instagram.ts` |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `supabase/functions/_shared/automation-notify.ts` | novo `reason` + metadata extra opcional |
| `supabase/functions/instagram-automation-cron/handler.ts` | fase nova (reconciliação + notificação), renumeração do cabeçalho |
| `supabase/functions/instagram-integration/index.ts` | despacho da rota nova |
| `apps/crm/src/store/instagramAutomations.ts` | `target_unlinked_at` no tipo |
| `apps/crm/src/lib/notification-config.ts` | copy ramificada por `reason` |
| `apps/crm/src/pages/automacoes/AutomacoesPage.tsx` | estado "alvo não vinculado" na célula |
| `apps/crm/src/pages/automacoes/AutomationFormDialog.tsx` | prop `initialTab` + `selectPublishedForUnlinkedTarget` + modo ao vivo |
| `apps/crm/src/pages/entregas/components/PostAutomationSection.tsx` | mesmo estado no drawer |
| `packages/i18n/locales/{pt,en}/automations.json` | chaves novas |

O handler da rota nova mora em arquivo próprio porque `instagram-integration/index.ts`
já tem 1091 linhas; enfiar mais lógica de provedor lá dentro piora um arquivo que já
está grande demais, e um handler separado dá para testar direto.

---

### Task 1: Migration (coluna, reconciliação, resolver)

**Files:**
- Create: `supabase/migrations/20260913000001_ica_target_unlinked.sql`
- Test: `supabase/tests/entitlements/81_ica_target_unlinked.sql`

**Interfaces:**
- Consumes: nada.
- Produces: coluna `instagram_comment_automations.target_unlinked_at timestamptz`;
  função `public.reconcile_unlinked_automation_targets() RETURNS TABLE(marked int, cleared int)`,
  `SECURITY DEFINER`, service_role-only.

- [ ] **Step 1: Escrever a suíte psql que falha**

Crie `supabase/tests/entitlements/81_ica_target_unlinked.sql`. Siga o estilo das
suítes vizinhas (veja `supabase/tests/entitlements/80_popup_triggers.sql` para o
formato de asserção e o uso de `_helpers.sql`).

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;

-- Fixtures: workspace, cliente, workflow post postado SEM media, automacao pendente.
select plan_setup('81_ica_target_unlinked');

-- 1. carimba o orfao
select assert_equals(
  (select marked from reconcile_unlinked_automation_targets()),
  1,
  'reconcile carimba a automacao pendente cujo post esta postado sem media'
);

select assert_true(
  (select target_unlinked_at is not null from instagram_comment_automations where id = :'auto_orfao'),
  'target_unlinked_at gravado'
);

-- 2. idempotente: segunda rodada nao remarca nem muda o timestamp
select assert_equals(
  (select marked from reconcile_unlinked_automation_targets()),
  0,
  'segunda rodada nao remarca'
);

-- 3. caminho da API: media chega ANTES do status, nao carimba
update workflow_posts set instagram_media_id = '17999999999999999' where id = :'post_api';
update workflow_posts set status = 'postado' where id = :'post_api';
select assert_true(
  (select target_unlinked_at is null from instagram_comment_automations where id = :'auto_api'),
  'automacao do caminho da API nao e carimbada'
);

-- 4. limpa quando a media chega depois
update workflow_posts set instagram_media_id = '17888888888888888' where id = :'post_orfao';
select assert_equals(
  (select cleared from reconcile_unlinked_automation_targets()),
  1,
  'reconcile limpa a marca quando a media chega'
);

-- 5. guardas de deriva: cliente diferente, stories e tiktok nao carimbam
select assert_equals(
  (select marked from reconcile_unlinked_automation_targets()),
  0,
  'stories, tiktok e cliente divergente nao sao carimbados'
);

-- 6. carimba independente de ativo
select assert_true(
  (select target_unlinked_at is not null from instagram_comment_automations where id = :'auto_inativa'),
  'automacao inativa tambem e carimbada'
);

-- 7. resolver limpa na hora quando o usuario re-mira mantendo workflow_post_id
update instagram_comment_automations
   set ig_media_id = '17777777777777777'
 where id = :'auto_orfao2';
select assert_true(
  (select target_unlinked_at is null from instagram_comment_automations where id = :'auto_orfao2'),
  'resolver limpa a marca quando ig_media_id muda com workflow_post_id igual'
);

-- 8. resolver limpa ao trocar para "Todos os posts" (ambos nulos)
update instagram_comment_automations
   set ig_media_id = null, workflow_post_id = null
 where id = :'auto_orfao3';
select assert_true(
  (select target_unlinked_at is null from instagram_comment_automations where id = :'auto_orfao3'),
  'resolver limpa a marca ao virar global'
);

-- 9. a marca nao mexe em ativo nem colide com o CHECK do tombstone
select assert_true(
  (select ativo from instagram_comment_automations where id = :'auto_orfao_ativa'),
  'carimbar nao desliga a automacao'
);

-- 10. RPC e service_role-only
select assert_false(
  has_function_privilege('anon', 'reconcile_unlinked_automation_targets()', 'execute'),
  'anon nao executa a RPC'
);
select assert_false(
  has_function_privilege('authenticated', 'reconcile_unlinked_automation_targets()', 'execute'),
  'authenticated nao executa a RPC'
);
select assert_true(
  has_function_privilege('service_role', 'reconcile_unlinked_automation_targets()', 'execute'),
  'service_role executa a RPC'
);

rollback;
```

**Leia `supabase/tests/entitlements/_helpers.sql` inteiro antes de escrever o setup**:
ele define `plan_setup`, `assert_equals`, `assert_true`, `assert_false` e os
construtores de workspace/cliente que as outras suítes usam. Os fixtures
(`:auto_orfao`, `:post_api`, etc.) são criados no bloco de setup no topo com esses
construtores, nunca com INSERT cru. Crie: um workspace, um cliente, e para
cada asserção um par (workflow_post, automação) no estado que ela testa. Para a guarda
de deriva crie três pares: um com `wp.cliente_id` diferente de `a.client_id`, um com
`wp.tipo = 'stories'` e um com `wp.platform = 'tiktok'`.

- [ ] **Step 2: Rodar a suíte para ver falhar**

Run: `supabase start && bash scripts/test-entitlements.sh`
Expected: FAIL com `function reconcile_unlinked_automation_targets() does not exist`

Precisa de Docker. Sem Docker local, o CI cobre pelo job `entitlement-tests`, mas você
não deve seguir sem ver o vermelho: peça ajuda em vez de pular esta etapa.

- [ ] **Step 3: Escrever a migration**

Crie `supabase/migrations/20260913000001_ica_target_unlinked.sql`:

```sql
-- Alvo orfao: automacao mirada em post em producao que foi marcado como
-- "postado" sem passar pela publicacao via API. O z3 so vincula quando
-- instagram_media_id passa a nao-nulo, e o caminho manual nunca preenche esse
-- campo, entao a automacao fica pendente para sempre, muda e sem sinal.

ALTER TABLE instagram_comment_automations
  ADD COLUMN IF NOT EXISTS target_unlinked_at timestamptz;

COMMENT ON COLUMN instagram_comment_automations.target_unlinked_at IS
  'Quando o post alvo virou "postado" sem instagram_media_id. Mantido pela '
  'reconciliacao do cron; limpo pelo resolver quando o usuario re-mira.';

-- ---------------------------------------------------------------------------
-- Reconciliacao idempotente. Roda a cada tick do instagram-automation-cron.
-- Duas metades: carimba orfaos novos, limpa marcas que nao valem mais.
--
-- POR QUE NAO E UM TRIGGER em workflow_posts: um AFTER UPDATE OF status so
-- pegaria transicoes futuras. Ficariam de fora (a) os orfaos que ja existem,
-- (b) post inserido ja como 'postado' pelo importador (20260729000004), que
-- nunca passa por UPDATE OF status, e (c) automacao criada depois do post ja
-- estar 'postado'. A reconciliacao cobre os tres, e o primeiro tick depois do
-- deploy e o backfill.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_unlinked_automation_targets()
RETURNS TABLE(marked int, cleared int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_marked int; v_cleared int;
BEGIN
  -- Carimba. As guardas de deriva sao as MESMAS do z3 e do sweep: o sistema
  -- nunca aborta e a deriva nunca marca.
  UPDATE instagram_comment_automations a
     SET target_unlinked_at = COALESCE(wp.published_at, wp.updated_at, now())
    FROM workflow_posts wp
   WHERE wp.id = a.workflow_post_id
     AND a.ig_media_id IS NULL
     AND a.target_unlinked_at IS NULL
     AND wp.status = 'postado'
     AND wp.instagram_media_id IS NULL
     AND wp.cliente_id = a.client_id
     AND wp.tipo <> 'stories'
     AND COALESCE(wp.platform, 'instagram') <> 'tiktok';
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  -- Limpa o que nao vale mais: media chegou, alvo mudou, ou o post saiu de
  -- 'postado'. Cobre tambem a automacao que virou global (workflow_post_id
  -- nulo), onde o LEFT JOIN nao acha post nenhum.
  UPDATE instagram_comment_automations a
     SET target_unlinked_at = NULL
    FROM (SELECT 1) AS _
   WHERE a.target_unlinked_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM workflow_posts wp
        WHERE wp.id = a.workflow_post_id
          AND a.ig_media_id IS NULL
          AND wp.status = 'postado'
          AND wp.instagram_media_id IS NULL
          AND wp.cliente_id = a.client_id
          AND wp.tipo <> 'stories'
          AND COALESCE(wp.platform, 'instagram') <> 'tiktok'
     );
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  marked := v_marked; cleared := v_cleared;
  RETURN NEXT;
END $$;

-- REVOKE FROM PUBLIC NAO tira o grant direto que os defaults de prod dao a
-- funcoes novas: anon e authenticated precisam de REVOKE explicito.
REVOKE ALL ON FUNCTION public.reconcile_unlinked_automation_targets() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_unlinked_automation_targets() FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_unlinked_automation_targets() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_unlinked_automation_targets() TO service_role;
```

Agora a edição do resolver. Copie a definição atual de
`resolve_ica_workflow_post_target` da migration `20260830000002_avulso_claim_reorder_ica.sql`
**inteira e verbatim** para o fim deste arquivo, e acrescente um bloco novo logo
depois do bloco do tombstone (que termina na linha 407 daquela migration) e **antes**
do `IF NEW.workflow_post_id IS NULL THEN RETURN NEW; END IF;`:

```sql
  -- Alvo orfao: limpa em QUALQUER mudanca de alvo dirigida pelo usuario.
  -- Condicao deliberadamente MAIS LARGA que a do tombstone acima: sem a guarda
  -- (NEW.ig_media_id IS NOT NULL OR NEW.workflow_post_id IS NOT NULL), porque
  -- trocar um orfao para "Todos os posts" zera os dois campos e tambem precisa
  -- limpar a marca, senao a automacao vira global carregando um aviso morto.
  IF TG_OP = 'UPDATE'
     AND (NEW.ig_media_id IS DISTINCT FROM OLD.ig_media_id
          OR NEW.workflow_post_id IS DISTINCT FROM OLD.workflow_post_id) THEN
    NEW.target_unlinked_at := NULL;
  END IF;
```

Não recrie o trigger: `CREATE OR REPLACE FUNCTION` preserva o oid e o trigger
existente passa a apontar para a definição nova sozinho. E não acrescente
`target_unlinked_at` ao `UPDATE OF` do trigger: os dois campos que a condição lê
(`workflow_post_id`, `ig_media_id`) já estão na lista, e deixar a coluna nova **fora**
é o que impede o UPDATE da reconciliação de reentrar no resolver a cada 5 minutos.

- [ ] **Step 4: Rodar a suíte e ver passar**

Run: `bash scripts/test-entitlements.sh`
Expected: PASS, todas as asserções de `81_ica_target_unlinked`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260913000001_ica_target_unlinked.sql supabase/tests/entitlements/81_ica_target_unlinked.sql
git commit -m "feat(automacoes): marca de alvo orfao e reconciliacao idempotente

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Notificação com motivo novo

**Files:**
- Modify: `supabase/functions/_shared/automation-notify.ts`
- Test: `supabase/functions/__tests__/automation-notify_test.ts` (crie se não existir)

**Interfaces:**
- Consumes: nada da Task 1 em tempo de compilação.
- Produces: `AutomationFailureReason` passa a aceitar `"target_never_published"`;
  `notifyAutomationFailure(svc, { contaId, clientId, reason, extraMetadata? })` onde
  `extraMetadata?: Record<string, unknown>`.

- [ ] **Step 1: Escrever o teste que falha**

Em `supabase/functions/__tests__/automation-notify_test.ts`, siga o estilo dos vizinhos
(stub de `svc` com `from`/`rpc` que registram as chamadas):

```ts
Deno.test("notifyAutomationFailure inclui extraMetadata no insert", async () => {
  const calls: Record<string, unknown>[] = [];
  const svc = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ gt: () => ({ limit: () => ({ data: [], error: null }) }) }) }) }) }),
    }),
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "resolve_notification_targets") return { data: ["u1"], error: null };
      return { data: null, error: null };
    },
  };

  await notifyAutomationFailure(svc as never, {
    contaId: "w1",
    clientId: 42,
    reason: "target_never_published",
    extraMetadata: { automation_id: "a1", automation_name: "Calendario Setembro" },
  });

  const insert = calls.find((c) => c.name === "insert_notification_batch")!;
  const meta = (insert.params as Record<string, Record<string, unknown>>).p_metadata;
  assertEquals(meta.reason, "target_never_published");
  assertEquals(meta.client_id, 42);
  assertEquals(meta.automation_id, "a1");
  assertEquals(meta.automation_name, "Calendario Setembro");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "notifyAutomationFailure inclui extraMetadata"`
Expected: FAIL. `--filter` casa **nome de teste**, não nome de arquivo.

- [ ] **Step 3: Implementar**

Em `supabase/functions/_shared/automation-notify.ts`, acrescente o motivo ao union:

```ts
export type AutomationFailureReason =
  | "token_expired"
  | "subscription_lost"
  | "duplicate_account_conflict"
  | "target_never_published";
```

E o campo opcional na assinatura, mantendo os três chamadores atuais intactos:

```ts
export async function notifyAutomationFailure(
  svc: DbClient,
  args: {
    contaId: string;
    clientId: number;
    reason: AutomationFailureReason;
    extraMetadata?: Record<string, unknown>;
  },
): Promise<void> {
```

E no `insert_notification_batch`:

```ts
      p_metadata: { client_id: args.clientId, reason: args.reason, ...args.extraMetadata },
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:functions -- --filter "notifyAutomationFailure inclui extraMetadata"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/automation-notify.ts supabase/functions/__tests__/automation-notify_test.ts
git commit -m "feat(automacoes): motivo target_never_published e metadata extra

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Fase de reconciliação e notificação no cron

**Files:**
- Modify: `supabase/functions/instagram-automation-cron/handler.ts` (cabeçalho nas
  linhas 5-30, fase nova logo depois do bloco da fase 3 que termina na linha 135)
- Test: `supabase/functions/__tests__/instagram-automation-cron_test.ts`

**Interfaces:**
- Consumes: `reconcile_unlinked_automation_targets()` da Task 1;
  `notifyAutomationFailure` com `extraMetadata` da Task 2.
- Produces: nada consumido por tarefas seguintes.

**Constante:** `const UNLINKED_GRACE_MS = 15 * 60 * 1000;`

- [ ] **Step 1: Escrever os testes que falham**

Em `supabase/functions/__tests__/instagram-automation-cron_test.ts`, no estilo dos
testes já existentes ali:

```ts
Deno.test("cron notifica alvo orfao so depois da carencia de 15 min", async () => {
  const notified: Record<string, unknown>[] = [];
  const agora = new Date("2026-09-07T12:00:00Z");
  const rows = [
    // 20 min: passou da carencia, ativa -> notifica
    { id: "a1", conta_id: "w1", client_id: 1, name: "Velha", ativo: true,
      target_unlinked_at: "2026-09-07T11:40:00Z" },
    // 5 min: dentro da carencia -> nao notifica
    { id: "a2", conta_id: "w1", client_id: 2, name: "Nova", ativo: true,
      target_unlinked_at: "2026-09-07T11:55:00Z" },
    // 20 min mas desligada -> nao notifica
    { id: "a3", conta_id: "w1", client_id: 3, name: "Desligada", ativo: false,
      target_unlinked_at: "2026-09-07T11:40:00Z" },
  ];

  await runUnlinkedPhase(makeSvc(rows, notified), agora);

  assertEquals(notified.length, 1);
  assertEquals(notified[0].clientId, 1);
  assertEquals(notified[0].reason, "target_never_published");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "cron notifica alvo orfao"`
Expected: FAIL com `runUnlinkedPhase is not defined`

- [ ] **Step 3: Implementar a fase**

No `handler.ts`, exporte a fase como função própria para o teste poder chamá-la
isolada, e insira a chamada logo depois do bloco `try/catch` da fase 3 (o que termina
na linha 135, com `errors.push({ error: \`sweep_pending_instagram_automation_links...\` })`):

```ts
const UNLINKED_GRACE_MS = 15 * 60 * 1000;

/** Fase 4: reconcilia a marca de alvo orfao e notifica o que passou da carencia. */
export async function runUnlinkedPhase(svc: DbClient, now: Date): Promise<void> {
  const { data: counts, error: rpcErr } = await svc
    .rpc("reconcile_unlinked_automation_targets")
    .single();
  if (rpcErr) throw new Error(errMessage(rpcErr));
  console.log(
    `[${CRON_NAME}] reconcile_unlinked_automation_targets: ${counts?.marked ?? 0} marcada(s), ${counts?.cleared ?? 0} limpa(s)`,
  );

  const cutoff = new Date(now.getTime() - UNLINKED_GRACE_MS).toISOString();
  const { data: orfas, error: selErr } = await svc
    .from("instagram_comment_automations")
    .select("id, conta_id, client_id, name")
    .eq("ativo", true)
    .is("ig_media_id", null)
    .not("target_unlinked_at", "is", null)
    .lt("target_unlinked_at", cutoff);
  if (selErr) throw new Error(errMessage(selErr));

  for (const a of orfas ?? []) {
    await notifyAutomationFailure(svc, {
      contaId: a.conta_id,
      clientId: a.client_id,
      reason: "target_never_published",
      extraMetadata: { automation_id: a.id, automation_name: a.name },
    });
  }
}
```

E a chamada, no mesmo formato de try/catch das outras fases:

```ts
    // 4. Alvo orfao: reconcilia a marca e notifica depois da carencia.
    try {
      await runUnlinkedPhase(svc, new Date());
    } catch (err) {
      console.error(`[${CRON_NAME}] fase de alvo orfao falhou:`, errMessage(err));
      failed++;
      errors.push({ error: `unlinked_phase: ${errMessage(err)}` });
    }
```

Renumere os comentários das fases seguintes (a antiga 4 vira 5, e assim por diante até
a 7 virar 8) **no bloco do cabeçalho nas linhas 5-30 e nos comentários inline**. O
cabeçalho diz "Sete fases"; troque para "Oito fases". Acrescente ao cabeçalho, na
posição 4:

```
//   4. Alvo orfao: `reconcile_unlinked_automation_targets()` carimba automacao
//      cujo post alvo virou 'postado' sem media (publicado na mao) e limpa a
//      marca quando ela nao vale mais; depois notifica as ATIVAS cuja marca
//      passou de 15 min. A carencia existe para que uma media que chegue tarde
//      limpe a marca antes de virar aviso.
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:functions -- --filter "cron notifica alvo orfao"`
Expected: PASS

Depois rode a suíte inteira, porque renumerar fases costuma quebrar asserção de log:
Run: `npm run test:functions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-automation-cron/handler.ts supabase/functions/__tests__/instagram-automation-cron_test.ts
git commit -m "feat(automacoes): fase de reconciliacao e notificacao de alvo orfao no cron

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Rota `published-media` no instagram-integration

**Files:**
- Create: `supabase/functions/instagram-integration/published-media.ts`
- Modify: `supabase/functions/instagram-integration/index.ts` (despacho, junto das
  outras rotas, antes do 404 final na linha ~998)
- Test: `supabase/functions/__tests__/instagram-integration-published-media_test.ts`

**Interfaces:**
- Consumes: `hasPermissionFor(svc, userId, workspaceId, module, action)` de
  `_shared/permissions.ts`; `decryptToken(encryptedBase64)` de
  `_shared/instagram-publish-utils.ts`; `makeBoundedFetch(timeoutMs)` de
  `_shared/bounded-fetch.ts`; `verifyClientOwnership(svc, clientId, contaId)` do
  próprio `index.ts` (exporte-a se ainda for local).
- Produces:
  `handlePublishedMedia(req, deps): Promise<Response>` com
  `deps: { svc, userId, corsHeaders, fetchImpl? }`; resposta
  `{ posts: PublishedMediaItem[], next_cursor: string | null }` onde
  `PublishedMediaItem = { id: string; caption: string | null; media_type: string; thumbnail_url: string | null; permalink: string; timestamp: string }`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
Deno.test("published-media: 403 sem automacoes:editar", async () => {
  const res = await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/42", { method: "POST", body: "{}" }),
    makeDeps({ permission: false }),
  );
  assertEquals(res.status, 403);
});

Deno.test("published-media: 200 para agent, que tem automacoes:editar", async () => {
  const res = await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/42", { method: "POST", body: "{}" }),
    makeDeps({ permission: true, role: "agent" }),
  );
  assertEquals(res.status, 200);
});

Deno.test("published-media: 403 para client_id de outra workspace", async () => {
  const res = await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/999", { method: "POST", body: "{}" }),
    makeDeps({ permission: true, ownsClient: false }),
  );
  assertEquals(res.status, 403);
});

Deno.test("published-media: 409 quando a conta nao esta ativa, sem descriptografar", async () => {
  let decrypted = false;
  const res = await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/42", { method: "POST", body: "{}" }),
    makeDeps({ permission: true, authorizationStatus: "revoked", onDecrypt: () => { decrypted = true; } }),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "instagram_not_authorized");
  assertEquals(decrypted, false);
});

Deno.test("published-media: mapeia a lista e repassa next_cursor", async () => {
  const graph = {
    data: [{ id: "1813", caption: "oi", media_type: "VIDEO", thumbnail_url: "t", permalink: "p", timestamp: "2026-09-07T12:00:10+0000" }],
    paging: { cursors: { after: "CURSOR_2" } },
  };
  const res = await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/42", { method: "POST", body: "{}" }),
    makeDeps({ permission: true, graph }),
  );
  const body = await res.json();
  assertEquals(body.posts[0].id, "1813");
  assertEquals(body.next_cursor, "CURSOR_2");
});

Deno.test("published-media: segunda pagina manda o after certo", async () => {
  let urlUsada = "";
  const res = await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/42", {
      method: "POST", body: JSON.stringify({ cursor: "CURSOR_2" }),
    }),
    makeDeps({ permission: true, onFetch: (u: string) => { urlUsada = u; } }),
  );
  assertEquals(res.status, 200);
  assertStringIncludes(urlUsada, "after=CURSOR_2");
});

Deno.test("published-media: token rejeitado carimba authorization_status", async () => {
  const updates: Record<string, unknown>[] = [];
  await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/42", { method: "POST", body: "{}" }),
    makeDeps({ permission: true, graphError: { code: 190 }, onUpdate: (u) => updates.push(u) }),
  );
  assertEquals(updates[0].authorization_status, "expired");
});

Deno.test("published-media: nao descriptografa token de cliente de outra workspace", async () => {
  let decrypted = false;
  const res = await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/999", { method: "POST", body: "{}" }),
    makeDeps({ permission: true, ownsClient: false, onDecrypt: () => { decrypted = true; } }),
  );
  assertEquals(res.status, 403);
  assertEquals(decrypted, false);
});

Deno.test("published-media: Graph API pendurada devolve erro dentro do prazo", async () => {
  const res = await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/42", { method: "POST", body: "{}" }),
    // fetchImpl que rejeita como AbortSignal.timeout faria
    makeDeps({ permission: true, onFetch: () => { throw new DOMException("timeout", "TimeoutError"); } }),
  );
  assertEquals(res.status, 502);
});

Deno.test("published-media: erro da Graph API nao vaza detalhe", async () => {
  const res = await handlePublishedMedia(
    new Request("https://x/instagram-integration/published-media/42", { method: "POST", body: "{}" }),
    makeDeps({ permission: true, graphError: { message: "OAuthException: token xyz leaked" } }),
  );
  const body = await res.json();
  assertEquals(body.message.includes("xyz"), false);
});
```

`makeDeps` é um helper local do arquivo de teste; monte-o com stubs de `svc.from`,
`svc.rpc`, um `fetchImpl` fake e um `decryptToken` injetável.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:functions -- --filter "published-media"`
Expected: FAIL, módulo não existe

- [ ] **Step 3: Implementar o handler**

Crie `supabase/functions/instagram-integration/published-media.ts`. Ordem obrigatória,
e a validação de tenant vem **antes** de qualquer descriptografia:

```ts
const GRAPH_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

export async function handlePublishedMedia(req: Request, deps: Deps): Promise<Response> {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...deps.corsHeaders, "Content-Type": "application/json" } });

  // 1. clientId no path, mesmo formato de /posts/:clientId
  const path = new URL(req.url).pathname.replace("/instagram-integration", "");
  const clientId = path.split("/")[2];
  if (!clientId || !/^\d+$/.test(clientId)) return json({ error: true, message: "Invalid client ID" }, 400);

  // 2. Tenant pelo padrao NOVO: active_workspace_id + workspace_members.
  //    NAO copie o profiles.conta_id das rotas antigas desta funcao: com
  //    conta_id um usuario multi-workspace opera na workspace errada e um
  //    membro removido mantem acesso.
  const { data: profile } = await deps.svc.from("profiles").select("active_workspace_id").eq("id", deps.userId).single();
  const contaId = profile?.active_workspace_id as string | undefined;
  if (!contaId) return json({ error: true, message: "Forbidden" }, 403);
  const { data: member } = await deps.svc.from("workspace_members")
    .select("user_id").eq("workspace_id", contaId).eq("user_id", deps.userId).maybeSingle();
  if (!member) return json({ error: true, message: "Forbidden" }, 403);

  // 3. Permissao: automacoes:'editar', a MESMA que a RLS ica_update exige.
  //    NAO e owner/admin: o preset de agent tem esse nivel desde 20260904000002
  //    (Migracao B), que preservou a escrita livre que 20260829000002 ja dava.
  if (!await hasPermissionFor(deps.svc, deps.userId, contaId, "automacoes", "editar")) {
    return json({ error: true, message: "Forbidden" }, 403);
  }

  // 4. Propriedade do cliente, ANTES de tocar em token.
  if (!await verifyClientOwnership(deps.svc, clientId, contaId)) {
    return json({ error: true, message: "Forbidden" }, 403);
  }

  // 5. Conta e status.
  const { data: account } = await deps.svc.from("instagram_accounts")
    .select("id, encrypted_access_token, authorization_status").eq("client_id", clientId).single();
  if (!account) return json({ error: true, message: "Not found" }, 404);
  if (account.authorization_status !== "active") {
    return json({ error: true, code: "instagram_not_authorized", message: "Conta do Instagram nao autorizada" }, 409);
  }

  // 6. Descriptografia com o helper COMPARTILHADO, nao a copia local do index.ts.
  const token = await deps.decryptToken(account.encrypted_access_token);

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
  const params = new URLSearchParams({
    fields: "id,caption,media_type,thumbnail_url,permalink,timestamp",
    limit: String(limit),
    access_token: token,
  });
  if (typeof body.cursor === "string" && body.cursor) params.set("after", body.cursor);

  // 7. Prazo explicito: sem AbortSignal o handler pendura ate o runtime matar.
  const doFetch = deps.fetchImpl ?? makeBoundedFetch(GRAPH_TIMEOUT_MS);
  try {
    const res = await doFetch(`https://graph.instagram.com/me/media?${params}`);
    const payload = await res.json();
    if (!res.ok || payload.error) {
      // 8. Token rejeitado: carimba o status como as rotas existentes ja fazem.
      const code = payload?.error?.code;
      if (code === 190) {
        await deps.svc.from("instagram_accounts").update({ authorization_status: "expired" }).eq("id", account.id);
      }
      console.error("[published-media] graph error:", payload?.error?.message ?? "unknown");
      return json({ error: true, message: "Nao foi possivel listar as midias" }, 502);
    }
    return json({
      posts: (payload.data ?? []).map((m: Record<string, string>) => ({
        id: m.id, caption: m.caption ?? null, media_type: m.media_type,
        thumbnail_url: m.thumbnail_url ?? null, permalink: m.permalink, timestamp: m.timestamp,
      })),
      next_cursor: payload.paging?.cursors?.after ?? null,
    });
  } catch (err) {
    console.error("[published-media] fetch falhou:", err instanceof Error ? err.message : String(err));
    return json({ error: true, message: "Nao foi possivel listar as midias" }, 502);
  }
}
```

No `index.ts`, despache antes do 404 final:

```ts
    if (req.method === 'POST' && path.startsWith('/published-media/')) {
        const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        return await handlePublishedMedia(req, {
          svc: serviceClient, userId: user!.id, corsHeaders, decryptToken,
        });
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:functions -- --filter "published-media"`
Expected: PASS, os 10 testes

- [ ] **Step 5: Rodar o typecheck do Deno**

Run: `npm run check:functions`
Expected: PASS. Se acusar `never` em linhas de `.from(...)`, é o padrão conhecido de
`ReturnType<typeof createClient>`: tipe o `svc` das deps estruturalmente
(`{ from: (t: string) => any; rpc: ... }`), não pelo retorno do `createClient`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/instagram-integration/ supabase/functions/__tests__/instagram-integration-published-media_test.ts
git commit -m "feat(automacoes): rota published-media com busca ao vivo na Graph API

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Tipo, service e copy da notificação no CRM

**Files:**
- Modify: `apps/crm/src/store/instagramAutomations.ts` (interface na linha 31)
- Create: `apps/crm/src/services/publishedMedia.ts`
- Modify: `apps/crm/src/lib/notification-config.ts` (case na linha 212)
- Test: `apps/crm/src/__tests__/notification-config.test.ts`

**Interfaces:**
- Consumes: a rota da Task 4.
- Produces:
  `InstagramCommentAutomation.target_unlinked_at: string | null`;
  `getPublishedMedia(clientId: number, cursor?: string): Promise<{ posts: PublishedMediaItem[]; next_cursor: string | null }>`
  exportado de `services/publishedMedia.ts`, com
  `PublishedMediaItem = { id: string; caption: string | null; media_type: string; thumbnail_url: string | null; permalink: string; timestamp: string }`.

- [ ] **Step 1: Escrever o teste de copy que falha**

Em `apps/crm/src/__tests__/notification-config.test.ts`, ao lado do teste da linha 92:

```ts
it('renders instagram_automation_failed with target_never_published reason', () => {
  const display = getNotificationDisplay('instagram_automation_failed', {
    reason: 'target_never_published',
    automation_name: 'Calendário Setembro',
  });
  expect(display.title).toBe('Automação do Instagram com problema');
  expect(display.body).toContain('Calendário Setembro');
  expect(display.body).toContain('Escolha o post publicado');
  expect(display.body).not.toContain('Reconecte');
});

it('keeps the reconnect copy for the other reasons', () => {
  const display = getNotificationDisplay('instagram_automation_failed', { reason: 'token_expired' });
  expect(display.body).toContain('Reconecte');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- notification-config`
Expected: FAIL, o corpo atual é fixo e não menciona o nome

- [ ] **Step 3: Implementar as três mudanças**

Em `store/instagramAutomations.ts`, na interface `InstagramCommentAutomation` (a partir
da linha 31), ao lado de `workflow_post_id`:

```ts
  target_unlinked_at: string | null;
```

Em `lib/notification-config.ts`, troque o `case 'instagram_automation_failed'` da linha
212 por:

```ts
    case 'instagram_automation_failed': {
      const nome = typeof m.automation_name === 'string' ? m.automation_name : null;
      if (m.reason === 'target_never_published') {
        return {
          icon: Instagram,
          tone: 'danger',
          title: 'Automação do Instagram com problema',
          body: `${nome ? `${nome} · ` : ''}o post alvo foi marcado como postado sem passar pelo app, então não existe mídia para monitorar. Escolha o post publicado.`,
        };
      }
      return {
        icon: Instagram,
        tone: 'danger',
        title: 'Automação do Instagram com problema',
        body: 'Uma automação de comentários parou de enviar. Reconecte o Instagram do cliente para reativar.',
      };
    }
```

Crie `apps/crm/src/services/publishedMedia.ts`, no padrão de `services/instagram.ts`
(que monta `EDGE_FUNCTION_URL` a partir de `import.meta.env.VITE_SUPABASE_URL` e usa
`getAuthHeaders()`):

```ts
import { getAuthHeaders } from './instagram';

const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/instagram-integration';

export interface PublishedMediaItem {
  id: string;
  caption: string | null;
  media_type: string;
  thumbnail_url: string | null;
  permalink: string;
  timestamp: string;
}

export interface PublishedMediaPage {
  posts: PublishedMediaItem[];
  next_cursor: string | null;
}

/** Lista mídias publicadas direto da Graph API, sem passar pelo espelho
 *  `instagram_posts`: o sync pode estar atrasado e deixar de fora justamente o
 *  post que o usuário precisa escolher. */
export async function getPublishedMedia(
  clientId: number,
  cursor?: string,
): Promise<PublishedMediaPage> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/published-media/${clientId}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(cursor ? { cursor } : {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.message ?? 'Falha ao listar mídias publicadas');
    (err as Error & { code?: string }).code = data.code;
    throw err;
  }
  return res.json();
}
```

Se `getAuthHeaders` não estiver exportado de `services/instagram.ts`, exporte-o.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- notification-config`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/instagramAutomations.ts apps/crm/src/services/publishedMedia.ts apps/crm/src/lib/notification-config.ts apps/crm/src/__tests__/notification-config.test.ts
git commit -m "feat(automacoes): tipo, service de midias ao vivo e copy por motivo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Re-mirar no diálogo, com seletor ao vivo

**Files:**
- Modify: `apps/crm/src/pages/automacoes/AutomationFormDialog.tsx` (props; seed de aba
  na linha 174; `selectPost` na linha 837; aba Publicados nas linhas ~1190-1210)
- Test: `apps/crm/src/pages/automacoes/__tests__/AutomationFormDialog.test.tsx`

**Interfaces:**
- Consumes: `getPublishedMedia` e `target_unlinked_at` da Task 5.
- Produces: prop `initialTab?: 'production' | 'published'` no `AutomationFormDialog`;
  handler `selectPublishedForUnlinkedTarget(post: PublishedMediaItem)`. A Task 7 passa
  essa prop ao abrir o diálogo pela ação do aviso.

- [ ] **Step 1: Escrever os testes que falham**

```tsx
it('abre na aba Publicados quando initialTab é published', async () => {
  renderDialog({ editing: unlinkedAutomation, initialTab: 'published' });
  expect(await screen.findByRole('tab', { name: /publicados/i })).toHaveAttribute('aria-selected', 'true');
});

it('preserva workflow_post_id ao escolher pelo seletor ao vivo', async () => {
  const onSave = vi.fn();
  renderDialog({ editing: unlinkedAutomation, initialTab: 'published', onSave });
  await userEvent.click(await screen.findByText('Reels de 07/09'));
  await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    ig_media_id: '18130175596674741',
    workflow_post_id: 4038,
  }));
});

it('selectPost normal continua zerando workflow_post_id', async () => {
  const onSave = vi.fn();
  renderDialog({ editing: publishedAutomation, onSave });
  await userEvent.click(await screen.findByText('Outro post'));
  await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ workflow_post_id: null }));
});

it('carregar mais concatena a página seguinte pelo next_cursor', async () => {
  mockGetPublishedMedia
    .mockResolvedValueOnce({ posts: [item('a')], next_cursor: 'C2' })
    .mockResolvedValueOnce({ posts: [item('b')], next_cursor: null });
  renderDialog({ editing: unlinkedAutomation, initialTab: 'published' });
  await userEvent.click(await screen.findByRole('button', { name: /carregar mais/i }));
  expect(mockGetPublishedMedia).toHaveBeenLastCalledWith(expect.any(Number), 'C2');
  expect(await screen.findByText('b')).toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- AutomationFormDialog`
Expected: FAIL, `initialTab` não existe

- [ ] **Step 3: Implementar**

Acrescente a prop e use-a no seed da aba (a lógica de precedência da linha 150-181
continua valendo; `initialTab` só sobrepõe qual aba abre, nunca qual alvo está
selecionado):

```tsx
  initialTab?: 'production' | 'published';
```

Handler novo, ao lado de `selectPost` (linha 837). **Não** altere `selectPost`:

```tsx
  /** Re-mira um alvo órfão: o post interno É conhecido (é o próprio
   *  workflow_post_id da automação), então diferente de `selectPost` este
   *  handler PRESERVA o ponteiro, produzindo o estado "ligado" do modelo de 5
   *  estados em vez de um "específico" solto. */
  const selectPublishedForUnlinkedTarget = (post: PublishedMediaItem) =>
    setForm((f) => ({
      ...f,
      selectedPost: {
        kind: 'published',
        ig_media_id: post.id,
        media_permalink: post.permalink,
        media_caption: post.caption ? truncate(post.caption, 300) : null,
        workflow_post_id:
          f.selectedPost?.kind === 'published' || f.selectedPost?.kind === 'production'
            ? (f.selectedPost.workflow_post_id ?? null)
            : null,
      },
    }));
```

Na aba Publicados, quando `initialTab === 'published'` e a automação em edição tem
`target_unlinked_at`, a fonte é `getPublishedMedia` em vez de `getInstagramPosts`, e a
paginação numerada dá lugar a "carregar mais" acumulando `next_cursor`:

```tsx
`retargetMode` é o que distingue este fluxo do seletor normal. Defina-o explicitamente,
a partir da prop e do estado da automação em edição:

```tsx
  const retargetMode = initialTab === 'published' && editing?.target_unlinked_at != null;
```

```tsx
  const liveMediaQuery = useInfiniteQuery({
    queryKey: ['published-media', form.clientId],
    queryFn: ({ pageParam }) => getPublishedMedia(form.clientId as number, pageParam),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: retargetMode && form.clientId != null,
  });
```

Trate o erro com `code === 'instagram_not_authorized'` com uma mensagem própria
mandando reconectar o Instagram do cliente, em vez do erro genérico.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- AutomationFormDialog`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/automacoes/
git commit -m "feat(automacoes): re-mirar alvo orfao pelo seletor ao vivo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Estado "alvo não vinculado" na listagem

**Files:**
- Modify: `packages/i18n/locales/pt/automations.json` (junto das chaves das linhas 24-26)
- Modify: `packages/i18n/locales/en/automations.json`
- Modify: `apps/crm/src/pages/automacoes/AutomacoesPage.tsx` (célula de alvo, linhas 434-468)
- Test: `apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`

**Interfaces:**
- Consumes: `target_unlinked_at` da Task 5; `can` do `AuthContext`
  (`(module, action?) => boolean | 'unknown'`), com `makeCan`/`fakeMembership` de
  `apps/crm/src/test/makeCan.ts` nos testes.
- Produces: nada consumido depois.

- [ ] **Step 1: Escrever os testes que falham**

```tsx
it('mostra "Alvo não vinculado" quando o post alvo publicou sem media id', () => {
  renderPage({
    automations: [automation({ workflow_post_id: 4038, ig_media_id: null, target_unlinked_at: '2026-08-31T23:55:44Z' })],
    can: makeCan(fakeMembership({ role: 'admin' })),
  });
  expect(screen.getByText('Alvo não vinculado')).toBeInTheDocument();
  expect(screen.queryByText('Aguardando publicação')).not.toBeInTheDocument();
});

it('mantém "Aguardando publicação" enquanto o post não publicou', () => {
  renderPage({
    automations: [automation({ workflow_post_id: 4038, ig_media_id: null, target_unlinked_at: null })],
    can: makeCan(fakeMembership({ role: 'admin' })),
  });
  expect(screen.getByText('Aguardando publicação')).toBeInTheDocument();
});

it('não mostra a ação de re-mirar sem automacoes:editar', () => {
  renderPage({
    automations: [automation({ workflow_post_id: 4038, ig_media_id: null, target_unlinked_at: '2026-08-31T23:55:44Z' })],
    can: makeCan(fakeMembership({ role_id: 'r1', permissions: { automacoes: 'ver' } })),
  });
  expect(screen.getByText('Alvo não vinculado')).toBeInTheDocument();
  expect(screen.queryByText('Escolher post publicado')).not.toBeInTheDocument();
});

it('tombstone vence a marca de alvo não vinculado', () => {
  renderPage({
    automations: [automation({ workflow_post_id: 4038, ig_media_id: null,
      target_unlinked_at: '2026-08-31T23:55:44Z', pending_post_deleted_at: '2026-09-01T00:00:00Z' })],
    can: makeCan(fakeMembership({ role: 'admin' })),
  });
  expect(screen.getByText('Alvo indisponível')).toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- AutomacoesPage`
Expected: FAIL, "Alvo não vinculado" não existe

- [ ] **Step 3: Implementar**

Em `packages/i18n/locales/pt/automations.json`, junto das linhas 24-26:

```json
  "unlinkedTargetBadge": "Alvo não vinculado",
  "unlinkedTargetAction": "Escolher post publicado",
  "unlinkedTargetHint": "O post foi marcado como postado sem passar pelo app, então não existe mídia para monitorar.",
```

E o equivalente em `en/automations.json`:

```json
  "unlinkedTargetBadge": "Target not linked",
  "unlinkedTargetAction": "Pick a published post",
  "unlinkedTargetHint": "The post was marked as posted without going through the app, so there is no media to watch.",
```

Em `AutomacoesPage.tsx`, o ramo `a.workflow_post_id` (linha 457) vira:

```tsx
                        ) : a.workflow_post_id ? (
                          a.target_unlinked_at ? (
                            <span className="flex flex-wrap items-center gap-1.5">
                              {truncate(a.media_caption ?? '', 40)}
                              <Badge variant="warning" size="sm" title={t('unlinkedTargetHint')}>
                                {t('unlinkedTargetBadge')}
                              </Badge>
                              {can('automacoes', 'editar') === true && (
                                <button
                                  type="button"
                                  className="text-xs underline"
                                  style={{ color: 'var(--primary-color)' }}
                                  onClick={() => openRetarget(a)}
                                >
                                  {t('unlinkedTargetAction')}
                                </button>
                              )}
                            </span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-1.5">
                              {truncate(a.media_caption ?? '', 40)}
                              <Badge variant="info" size="sm">
                                {t('pendingBadge')}
                              </Badge>
                            </span>
                          )
                        ) : (
```

`can('automacoes', 'editar') === true` e não truthy: `can` devolve
`boolean | 'unknown'`, e `'unknown'` é truthy. Durante a hidratação da membership a
ação não deve piscar na tela.

`openRetarget(a)` reusa o handler de editar que a página já tem e acrescenta a aba
alvo, usando a prop que a Task 6 criou:

```tsx
  const [retargetTab, setRetargetTab] = useState<'production' | 'published' | undefined>();

  const openRetarget = (a: InstagramCommentAutomation) => {
    setRetargetTab('published');
    setEditing(a); // o MESMO setter que o botão de editar da linha já usa
  };
```

E no JSX do diálogo, passe `initialTab={retargetTab}` e limpe o estado no `onClose`
(`setRetargetTab(undefined)`), senão a próxima edição normal abriria na aba errada.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- AutomacoesPage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/locales apps/crm/src/pages/automacoes/AutomacoesPage.tsx apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx
git commit -m "feat(automacoes): estado de alvo nao vinculado na listagem

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Mesmo estado no WorkflowDrawer, e fechamento

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostAutomationSection.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostAutomationSection.test.tsx`

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: nada.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
it('mostra o alvo não vinculado e a ação de re-mirar no drawer', () => {
  renderSection({
    automations: [automation({ workflow_post_id: 4038, ig_media_id: null, target_unlinked_at: '2026-08-31T23:55:44Z' })],
    can: makeCan(fakeMembership({ role: 'admin' })),
  });
  expect(screen.getByText('Alvo não vinculado')).toBeInTheDocument();
  expect(screen.getByText('Escolher post publicado')).toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- PostAutomationSection`
Expected: FAIL

- [ ] **Step 3: Implementar**

Extraia o bloco da célula de alvo da Task 7 para
`apps/crm/src/pages/automacoes/AutomationTargetCell.tsx` e use nos DOIS lugares. Não
duplique: o estado tem cinco ramos com precedência e três chaves de copy, e duas cópias
divergem na primeira mudança.

```tsx
export function AutomationTargetCell({
  automation,
  canEdit,
  onRetarget,
}: {
  automation: InstagramCommentAutomation;
  canEdit: boolean;
  onRetarget: (a: InstagramCommentAutomation) => void;
}) { /* os cinco ramos, movidos verbatim da AutomacoesPage */ }
```

Passe `canEdit={can('automacoes', 'editar') === true}` nos dois call sites, e ajuste os
testes da Task 7 se algum deles dependia da árvore antiga.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- PostAutomationSection`
Expected: PASS

- [ ] **Step 5: Rodar tudo que o CI roda**

```bash
npm ci
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json   --noEmit
npx tsc -p apps/hub/tsconfig.json   --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
npm run check:functions
```

Expected: tudo verde. `npm ci` primeiro porque os runs de `deno test` das tasks 2 a 4
poluem `node_modules/.deno` e produzem erros fantasmas de TipTap no `tsc` e 13
arquivos falsos no `prettier`.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/
git commit -m "feat(automacoes): alvo nao vinculado tambem no WorkflowDrawer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Rollout

Ordem obrigatória, e o inverso é indesejado mas não quebra: a listagem usa
`select('*')`, então uma coluna ainda inexistente só volta `undefined` e a célula cai
no estado pendente de hoje.

1. **Migration**, com o tail de `origin/main` reconferido e renumerado se preciso.
2. **`instagram-automation-cron` e `instagram-integration`**, juntos:
   ```bash
   npx supabase functions deploy instagram-automation-cron --use-api --no-verify-jwt --project-ref <ref>
   npx supabase functions deploy instagram-integration     --use-api --no-verify-jwt --project-ref <ref>
   ```
3. **Frontend**, por último, via merge.

O acoplamento duro é um só: o frontend não pode expor "Escolher post publicado" antes
da rota existir, senão o clique bate em 404.

**Verificação pós-deploy.** No primeiro tick depois do passo 2, a automação
`3dd0a373` "Calendário Setembro" deve aparecer carimbada. Ela está desligada, então
não deve gerar notificação:

```sql
select id, name, ativo, target_unlinked_at
from instagram_comment_automations
where target_unlinked_at is not null;
```

O alvo publicado dela é `18133930105628236` (CAROUSEL_ALBUM, 31/08 23:52:49), para
conferir a re-mirada pela UI.
