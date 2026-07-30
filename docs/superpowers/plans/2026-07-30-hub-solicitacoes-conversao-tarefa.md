# Hub Solicitações + Conversão em Tarefa + MCP Task Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients toggle Hub submissions between "ideia" and "solicitação"; managers convert solicitações into tarefas atomically (with status sync back to the Hub); MCP agents get list_tasks/create_task/update_task under new tarefas scopes.

**Architecture:** One migration (ideias.tipo + composite-FK tarefa_id + derived statuses + conversion RPC + sync trigger + notification-trigger recreate), tipo support in the hub-ideias edge function, UI in both apps reusing shared components (IdeiaStatusBadge, IdeiaDrawer, TarefaFormDialog), and three MCP tools following the existing register()/queries pattern.

**Tech Stack:** React 19 + TS + Vite, Supabase (Postgres 17 + Deno edge functions), zod, TanStack Query, Vitest + deno test.

**Spec:** `docs/superpowers/specs/2026-07-30-hub-solicitacoes-conversao-tarefa-design.md` (read it first; it records two external review rounds whose decisions are binding).

## Global Constraints

- New user-facing copy: pt-BR, NEVER em-dashes ("—"); use "·", colon, or period. Existing em-dashes in old code stay.
- Migration version prefix MUST be unique repo-wide (CI `migration-version-guard`); duplicates are silently skipped on remote.
- Typecheck = 4 configs: `npx tsc -p apps/crm/tsconfig.json --noEmit`, same for `apps/hub`, `apps/admin`, `npx tsc -p tsconfig.scripts.json`.
- `npm run lint` + `npm run format:check` gate CI; run `npm run format` before committing.
- Edge functions: Deno, `npm:` imports, never leak raw errors to clients.
- `deno test` dirties the root `deno.lock`: run `git checkout -- deno.lock` after (NOT supabase/functions/deno.lock unless you added deps).
- Commits: conventional, end body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Derived statuses `convertida`/`concluida` are NEVER written by UI selectors; only the RPC and the sync trigger write them.

---

### Task 1: Branch setup + docs commit

**Files:**
- Create: worktree + branch `ebs/hub-solicitacoes` off fresh `origin/main`
- Copy in: `docs/superpowers/specs/2026-07-30-hub-solicitacoes-conversao-tarefa-design.md`, `docs/superpowers/plans/2026-07-30-hub-solicitacoes-conversao-tarefa.md` (both exist in the OLD worktree `.claude/worktrees/team-task-tracker-bda9cb/docs/superpowers/...`)

**Interfaces:**
- Produces: a clean branch where all later tasks run. PR #270 (tarefas) is already merged to main; `supabase/migrations/20260730000005_tarefas.sql` and `apps/crm/src/pages/tarefas/` MUST exist on it.

- [ ] **Step 1: Create the worktree/branch** (use superpowers:using-git-worktrees)

```bash
cd /Users/eduardosouza/Projects/sm-crm
git fetch origin
git worktree add .claude/worktrees/hub-solicitacoes -b ebs/hub-solicitacoes origin/main
cd .claude/worktrees/hub-solicitacoes
git log --oneline -3   # confirm the tarefas squash-merge is present
ls apps/crm/src/pages/tarefas/  # must exist
npm ci
```

- [ ] **Step 2: Copy spec + plan from the old worktree, copy env files (never commit them)**

```bash
cp ../team-task-tracker-bda9cb/docs/superpowers/specs/2026-07-30-hub-solicitacoes-conversao-tarefa-design.md docs/superpowers/specs/
cp ../team-task-tracker-bda9cb/docs/superpowers/plans/2026-07-30-hub-solicitacoes-conversao-tarefa.md docs/superpowers/plans/
cp ../../../.env .env 2>/dev/null; cp ../../../.env.staging .env.staging 2>/dev/null
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/superpowers/specs/2026-07-30-hub-solicitacoes-conversao-tarefa-design.md docs/superpowers/plans/2026-07-30-hub-solicitacoes-conversao-tarefa.md
git commit -m "docs: spec + plano de solicitacoes do hub e conversao em tarefa"
```

---

### Task 2: Migration — tipo, tarefa_id, derived statuses, RPC, sync trigger, notification trigger

**Files:**
- Create: `supabase/migrations/20260730000007_ideias_solicitacoes.sql`

**Interfaces:**
- Produces: `ideias.tipo` ('ideia'|'solicitacao'), `ideias.tarefa_id bigint`, status values `convertida`/`concluida`, RPC `convert_solicitacao_em_tarefa(p_ideia_id uuid, p_titulo text, p_descricao text, p_responsavel_id bigint, p_data_limite date) RETURNS bigint`, trigger `sync_ideia_from_tarefa` on `tarefas`, recreated `trg_notify_idea_submitted` with `tipo` in metadata.

- [ ] **Step 1: Verify the version prefix is free** (main may have moved)

```bash
ls supabase/migrations | tail -5
```
Expected: highest existing prefix is `20260730000006` (or another value LOWER than `20260730000007`). If `20260730000007` is taken, bump this file's prefix to the next free value everywhere it appears in this plan.

- [ ] **Step 2: Write the migration**

```sql
-- Spec: docs/superpowers/specs/2026-07-30-hub-solicitacoes-conversao-tarefa-design.md
-- Solicitacoes no Hub: ideias.tipo, conversao atomica em tarefa e sync de status.

-- 1) Colunas + constraints
ALTER TABLE ideias ADD COLUMN tipo text NOT NULL DEFAULT 'ideia';
ALTER TABLE ideias ADD CONSTRAINT ideias_tipo_check CHECK (tipo IN ('ideia','solicitacao'));

-- FK composta: ponteiro cross-tenant impossivel no banco para TODOS os escritores.
-- Column-list no SET NULL (PG 15+; prod = 17.6) anula so tarefa_id, preserva workspace_id.
-- MATCH SIMPLE ignora a constraint quando tarefa_id e NULL.
ALTER TABLE ideias ADD COLUMN tarefa_id bigint;
ALTER TABLE ideias ADD CONSTRAINT ideias_tarefa_fk
  FOREIGN KEY (tarefa_id, workspace_id) REFERENCES tarefas (id, conta_id)
  ON DELETE SET NULL (tarefa_id);
CREATE INDEX ideias_tarefa_idx ON ideias (tarefa_id);

-- Estados derivados: convertida/concluida so via RPC + trigger de sync, nunca via UI.
ALTER TABLE ideias DROP CONSTRAINT ideias_status_check;
ALTER TABLE ideias ADD CONSTRAINT ideias_status_check
  CHECK (status IN ('nova','em_analise','aprovada','descartada','convertida','concluida'));

-- 2) RPC de conversao: atomica, claim com FOR UPDATE, cliente fixado ao da solicitacao.
CREATE OR REPLACE FUNCTION convert_solicitacao_em_tarefa(
  p_ideia_id uuid,
  p_titulo text,
  p_descricao text DEFAULT NULL,
  p_responsavel_id bigint DEFAULT NULL,
  p_data_limite date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ideia record;
  v_tarefa_id bigint;
BEGIN
  -- RLS do invocador: ideia de outro workspace nao aparece (NOT FOUND).
  SELECT id, workspace_id, cliente_id, tipo, status, tarefa_id
    INTO v_ideia
    FROM ideias
   WHERE id = p_ideia_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitacao nao encontrada.';
  END IF;
  IF v_ideia.tipo <> 'solicitacao' THEN
    RAISE EXCEPTION 'Apenas solicitacoes podem virar tarefa.';
  END IF;
  IF v_ideia.tarefa_id IS NOT NULL OR v_ideia.status NOT IN ('nova','em_analise','aprovada') THEN
    RAISE EXCEPTION 'Solicitacao ja convertida ou com status nao elegivel.';
  END IF;
  IF p_titulo IS NULL OR btrim(p_titulo) = '' THEN
    RAISE EXCEPTION 'Titulo obrigatorio.';
  END IF;

  -- cliente_id vem da propria solicitacao, NUNCA de parametro.
  -- WITH CHECK de tarefas valida responsavel_id no workspace; task_assigned dispara
  -- com ator = auth.uid() (excluido do batch).
  INSERT INTO tarefas (conta_id, user_id, titulo, descricao, status,
                       responsavel_id, cliente_id, data_limite)
  VALUES (v_ideia.workspace_id, auth.uid(), btrim(p_titulo),
          NULLIF(btrim(coalesce(p_descricao, '')), ''), 'pendente',
          p_responsavel_id, v_ideia.cliente_id, p_data_limite)
  RETURNING id INTO v_tarefa_id;

  UPDATE ideias SET status = 'convertida', tarefa_id = v_tarefa_id
   WHERE id = p_ideia_id;

  RETURN v_tarefa_id;
END;
$$;

-- Default do PG e EXECUTE para PUBLIC; REVOKE sem re-grant derrubaria service_role.
REVOKE ALL ON FUNCTION convert_solicitacao_em_tarefa(uuid, text, text, bigint, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convert_solicitacao_em_tarefa(uuid, text, text, bigint, date) TO authenticated;
GRANT EXECUTE ON FUNCTION convert_solicitacao_em_tarefa(uuid, text, text, bigint, date) TO service_role;

-- 3) Sync tarefa -> solicitacao. Invariante de dados: SEM bloco EXCEPTION.
-- Falha propaga e desfaz a transicao da tarefa (divergencia silenciosa seria pior).
CREATE OR REPLACE FUNCTION trg_sync_ideia_from_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'concluida' AND OLD.status IS DISTINCT FROM 'concluida' THEN
    UPDATE ideias SET status = 'concluida'
     WHERE tarefa_id = NEW.id AND workspace_id = NEW.conta_id AND status = 'convertida';
  ELSIF NEW.status <> 'concluida' AND OLD.status = 'concluida' THEN
    UPDATE ideias SET status = 'convertida'
     WHERE tarefa_id = NEW.id AND workspace_id = NEW.conta_id AND status = 'concluida';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_ideia_from_tarefa ON tarefas;
CREATE TRIGGER sync_ideia_from_tarefa
  AFTER UPDATE OF status ON tarefas
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION trg_sync_ideia_from_tarefa();

-- 4) Notificacao: recria a versao MAIS RECENTE (20260430000003) adicionando tipo ao metadata.
CREATE OR REPLACE FUNCTION trg_notify_idea_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    IF NEW.status IS DISTINCT FROM 'nova' THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.workspace_id,
      v_targets,
      'idea_submitted',
      '/ideias',
      jsonb_build_object(
        'client_name', v_client_name,
        'idea_title',  NEW.titulo,
        'idea_id',     NEW.id,
        'tipo',        NEW.tipo
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_idea_submitted failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260730000007_ideias_solicitacoes.sql
git commit -m "feat(db): ideias.tipo, conversao de solicitacao em tarefa e sync de status"
```

(Applies to staging in Task 11; do NOT push it now.)

---

### Task 3: hub-ideias edge function — tipo (TDD)

**Files:**
- Modify: `supabase/functions/hub-ideias/handler.ts` (POST create ~line 165, PATCH ~line 184, GET select ~line 129)
- Test: `supabase/functions/__tests__/hub-ideias_test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: POST accepts optional `tipo` ('ideia'|'solicitacao', default 'ideia', 400 on other values); PATCH accepts `tipo` under the existing lock; GET returns `tipo` and `tarefa_id` per ideia.

- [ ] **Step 1: Write the failing tests** (append to `hub-ideias_test.ts`; reuse the file's existing `makeHandler`/`setupToken` helpers and `createSupabaseQueryMock`)

```ts
Deno.test("hub-ideias: POST create with tipo=solicitacao inserts tipo", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "insert", { data: { id: "i1", titulo: "T", tipo: "solicitacao" }, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", titulo: "T", descricao: "D", tipo: "solicitacao" }),
  }));
  assertEquals(res.status, 201);
  const insert = db.calls.find((c) => c.table === "ideias" && c.method === "insert");
  assertEquals((insert?.args[0] as Record<string, unknown>).tipo, "solicitacao");
});

Deno.test("hub-ideias: POST create defaults tipo to ideia", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "insert", { data: { id: "i1", titulo: "T", tipo: "ideia" }, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", titulo: "T", descricao: "D" }),
  }));
  assertEquals(res.status, 201);
  const insert = db.calls.find((c) => c.table === "ideias" && c.method === "insert");
  assertEquals((insert?.args[0] as Record<string, unknown>).tipo, "ideia");
});

Deno.test("hub-ideias: POST create rejects invalid tipo with 400", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", titulo: "T", descricao: "D", tipo: "pedido" }),
  }));
  assertEquals(res.status, 400);
});
```

NOTE: if the mock's call-recording API differs (check how existing tests in this file assert insert payloads), mirror the file's own idiom instead of `db.calls`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:functions -- --filter "hub-ideias"
git checkout -- deno.lock
```
Expected: the 3 new tests FAIL (tipo not inserted / no 400).

- [ ] **Step 3: Implement.** In `handler.ts`:

In the POST create branch (after the `descricao` guard, before the insert):

```ts
const HUB_IDEIA_TIPOS = ["ideia", "solicitacao"];
const tipo = body.tipo === undefined ? "ideia" : String(body.tipo);
if (!HUB_IDEIA_TIPOS.includes(tipo)) return json({ error: "tipo inválido" }, 400);
```
and add `tipo` to the insert object (`{ workspace_id: ..., cliente_id: ..., titulo, descricao, links, tipo, status: "nova" }`). Hoist `HUB_IDEIA_TIPOS` to module scope (it is also used by PATCH).

In the PATCH branch (next to the other `body.X !== undefined` lines):

```ts
if (body.tipo !== undefined) {
  if (!HUB_IDEIA_TIPOS.includes(String(body.tipo))) return json({ error: "tipo inválido" }, 400);
  patch.tipo = String(body.tipo);
}
```

In the GET select string, add `tipo, tarefa_id` after `links, status,`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:functions -- --filter "hub-ideias"
git checkout -- deno.lock
```
Expected: ALL hub-ideias tests PASS (old + 3 new).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-ideias/handler.ts supabase/functions/__tests__/hub-ideias_test.ts
git commit -m "feat(hub-ideias): aceitar e devolver tipo (ideia|solicitacao)"
```

---

### Task 4: Hub UI — toggle, badges, labels

**Files:**
- Modify: `apps/hub/src/types.ts` (HubIdeia, ~line 174), `apps/hub/src/api.ts` (createIdeia ~163, updateIdeia ~170), `apps/hub/src/pages/IdeiasPage.tsx`
- Test: `apps/hub/src/pages/__tests__/ideiasPage.test.tsx` (update fixtures + add assertions)

**Interfaces:**
- Consumes: Task 3's API contract (`tipo` in POST/PATCH/GET).
- Produces: client-facing type toggle and the two new client-facing status labels.

- [ ] **Step 1: Types + api.** In `types.ts`:

```ts
export interface HubIdeia {
  id: string;
  titulo: string;
  descricao: string;
  links: string[];
  tipo: 'ideia' | 'solicitacao';
  status: 'nova' | 'em_analise' | 'aprovada' | 'descartada' | 'convertida' | 'concluida';
  // ...restante inalterado (tarefa_id nao e usado no Hub; nao adicionar)
}
```

In `api.ts`, extend both payload types:

```ts
export function createIdeia(
  token: string,
  payload: { titulo: string; descricao: string; links: string[]; tipo: 'ideia' | 'solicitacao' },
) { ... }

export function updateIdeia(
  token: string,
  id: string,
  payload: { titulo?: string; descricao?: string; links?: string[]; tipo?: 'ideia' | 'solicitacao' },
) { ... }
```

- [ ] **Step 2: IdeiasPage.** Extend the label/color records (TS will force this once the union grows):

```ts
const STATUS_LABEL: Record<HubIdeia['status'], string> = {
  nova: 'Nova',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  descartada: 'Descartada',
  convertida: 'Em andamento',
  concluida: 'Concluída',
};

const STATUS_COLOR: Record<HubIdeia['status'], string> = {
  nova: 'hub-bg-soft hub-tx2',
  em_analise: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400',
  aprovada: 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  descartada: 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  convertida: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  concluida: 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400',
};
```

`isMutable` stays as-is (anything past `nova` is already locked).

In `IdeiaCard`, next to the status badge span, add a type badge for solicitações:

```tsx
{ideia.tipo === 'solicitacao' && (
  <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mb-2 ml-1.5 border hub-border hub-tx2">
    Solicitação
  </span>
)}
```

In `IdeiaModal`: add tipo state + a segmented toggle above the Título field, and send it on both create and update:

```tsx
const [tipo, setTipo] = useState<'ideia' | 'solicitacao'>(editing?.tipo ?? 'ideia');
```

```tsx
<div>
  <label className="text-[12.5px] font-semibold hub-tx2 mb-1 block">Tipo</label>
  <div className="flex gap-1 p-1 rounded-lg hub-bg-soft w-fit">
    {(['ideia', 'solicitacao'] as const).map((t) => (
      <button
        key={t}
        type="button"
        onClick={() => setTipo(t)}
        className={`px-3 py-1.5 rounded-md text-[12.5px] font-semibold transition-colors ${
          tipo === t ? 'hub-btn-primary' : 'hub-tx3'
        }`}
      >
        {t === 'ideia' ? 'Ideia' : 'Solicitação'}
      </button>
    ))}
  </div>
  <p className="text-[11.5px] hub-tx3 mt-1">
    Ideia: sugestão de conteúdo. Solicitação: pedido para a agência executar.
  </p>
</div>
```

In `handleSaveText`, add `tipo` to both the `updateIdeia` and `createIdeia` payloads. Header copy: description becomes `"Envie ideias e solicitações e a agência responderá em breve."`; empty-state paragraph becomes `"Clique em \"Nova ideia\" para enviar sua primeira sugestão ou solicitação."`.

- [ ] **Step 3: Update the Hub RTL test.** In `ideiasPage.test.tsx`: add `tipo: 'ideia'` to every HubIdeia fixture (TS forces it). Add one test: render with a fixture `{ tipo: 'solicitacao', status: 'convertida', ... }` and assert `screen.getByText('Em andamento')` and `screen.getByText('Solicitação')` are in the document.

- [ ] **Step 4: Verify**

```bash
npx tsc -p apps/hub/tsconfig.json --noEmit
npm run test -- ideiasPage
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src
git commit -m "feat(hub): toggle ideia|solicitacao e novos status no portal"
```

---

### Task 5: CRM store + badges + IdeiasPage filter + HubTab

**Files:**
- Modify: `apps/crm/src/store/ideias.ts`, `apps/crm/src/components/ideias/IdeiaStatusBadge.tsx`, `apps/crm/src/pages/ideias/IdeiasPage.tsx`, `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` (IdeiasTab select ~line 1650)
- Create: `apps/crm/src/components/ideias/IdeiaTipoBadge.tsx`

**Interfaces:**
- Consumes: DB columns from Task 2.
- Produces: `Ideia` type with `tipo: 'ideia' | 'solicitacao'`, `tarefa_id: number | null`, status union `'nova' | 'em_analise' | 'aprovada' | 'descartada' | 'convertida' | 'concluida'`; `convertSolicitacaoEmTarefa(args): Promise<number>`; `<IdeiaTipoBadge tipo={...} />`.

- [ ] **Step 1: store/ideias.ts.** Extend the interface:

```ts
export interface Ideia {
  // ...campos existentes...
  tipo: 'ideia' | 'solicitacao';
  tarefa_id: number | null;
  status: 'nova' | 'em_analise' | 'aprovada' | 'descartada' | 'convertida' | 'concluida';
  // ...
}
```

Add `tipo, tarefa_id` to the `getIdeias` select string (after `links, status,`). Append the RPC wrapper:

```ts
export async function convertSolicitacaoEmTarefa(args: {
  ideiaId: string;
  titulo: string;
  descricao: string | null;
  responsavelId: number | null;
  dataLimite: string | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc('convert_solicitacao_em_tarefa', {
    p_ideia_id: args.ideiaId,
    p_titulo: args.titulo,
    p_descricao: args.descricao,
    p_responsavel_id: args.responsavelId,
    p_data_limite: args.dataLimite,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
```

- [ ] **Step 2: Badges.** `IdeiaStatusBadge.tsx` — extend both records (TS forces it):

```ts
const LABELS: Record<Ideia['status'], string> = {
  nova: 'Nova',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  descartada: 'Descartada',
  convertida: 'Virou tarefa',
  concluida: 'Concluída',
};

const CLASSES: Record<Ideia['status'], string> = {
  nova: 'bg-stone-100 text-stone-600',
  em_analise: 'bg-yellow-100 text-yellow-700',
  aprovada: 'bg-green-100 text-green-700',
  descartada: 'bg-red-100 text-red-600',
  convertida: 'bg-blue-100 text-blue-700',
  concluida: 'bg-emerald-100 text-emerald-700',
};
```

Create `IdeiaTipoBadge.tsx`:

```tsx
import type { Ideia } from '@/store';

const LABELS: Record<Ideia['tipo'], string> = {
  ideia: 'Ideia',
  solicitacao: 'Solicitação',
};

const CLASSES: Record<Ideia['tipo'], string> = {
  ideia: 'bg-stone-100 text-stone-500',
  solicitacao: 'bg-primary/15 text-yellow-700',
};

export function IdeiaTipoBadge({ tipo }: { tipo: Ideia['tipo'] }) {
  return (
    <span
      className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${CLASSES[tipo]}`}
    >
      {LABELS[tipo]}
    </span>
  );
}
```

- [ ] **Step 3: IdeiasPage.** Update the constants:

```ts
const ALL_STATUSES = ['nova', 'em_analise', 'aprovada', 'descartada', 'convertida', 'concluida'] as const;
const STATUS_LABELS: Record<string, string> = {
  nova: 'Nova',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  descartada: 'Descartada',
  convertida: 'Virou tarefa',
  concluida: 'Concluída',
};
```

Add tipo filter state + predicate:

```ts
const [tipoFilter, setTipoFilter] = useState<string>('all');
// no filtered:
if (tipoFilter !== 'all' && i.tipo !== tipoFilter) return false;
```

Add the filter control right after the cliente `Select` (same shadcn pattern):

```tsx
<Select value={tipoFilter} onValueChange={setTipoFilter}>
  <SelectTrigger className="!rounded-full !text-xs h-9 px-4 w-auto min-w-[130px] mb-0">
    <SelectValue placeholder="Tipo" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="all">Todos os tipos</SelectItem>
    <SelectItem value="ideia">Ideia</SelectItem>
    <SelectItem value="solicitacao">Solicitação</SelectItem>
  </SelectContent>
</Select>
```

Add a `Tipo` column: `<TableHead>Tipo</TableHead>` after `Cliente`, and in the body `<TableCell><IdeiaTipoBadge tipo={ideia.tipo} /></TableCell>` (import it).

- [ ] **Step 4: HubTab.** In the `IdeiasTab` `<select>`, append:

```tsx
<option value="convertida">Virou tarefa</option>
<option value="concluida">Concluída</option>
```

- [ ] **Step 5: Verify + commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run test
```
Expected: PASS (the union growth may surface fixture errors in existing tests; add `tipo: 'ideia', tarefa_id: null` to any Ideia fixtures that break).

```bash
git add apps/crm/src/store/ideias.ts apps/crm/src/components/ideias/ apps/crm/src/pages/ideias/IdeiasPage.tsx apps/crm/src/pages/cliente-detalhe/HubTab.tsx
git commit -m "feat(crm): tipo e novos status de ideias na tabela, drawer e cliente-detalhe"
```

---

### Task 6: TarefaFormDialog — initialValues, lockCliente, onCreate (TDD)

**Files:**
- Modify: `apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx`
- Test: Create `apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`

**Interfaces:**
- Consumes: existing `addTarefa`, `updateTarefa`, `setTarefaTags` from store.
- Produces (used by Task 7):

```ts
export type TarefaFormPayload = {
  titulo: string;
  descricao: string | null;
  status: 'pendente' | 'em_andamento' | 'concluida';
  responsavel_id: number | null;
  cliente_id: number | null;
  data_limite: string | null;
};
// New optional props on TarefaFormDialogProps:
//   initialValues?: { titulo?: string; descricao?: string; cliente_id?: number | null };
//   lockCliente?: boolean;
//   onCreate?: (payload: TarefaFormPayload, tagIds: number[]) => Promise<void>;
```

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { addTarefaMock } = vi.hoisted(() => ({ addTarefaMock: vi.fn() }));

vi.mock('../../../store', () => ({
  addTarefa: addTarefaMock,
  updateTarefa: vi.fn(),
  setTarefaTags: vi.fn(),
  addTarefaTag: vi.fn(),
}));

import { TarefaFormDialog } from '../components/TarefaFormDialog';

const CLIENTES = [
  { id: 7, nome: 'Cliente Sete', status: 'ativo' },
  { id: 9, nome: 'Cliente Pausado', status: 'pausado' },
] as never[];

describe('TarefaFormDialog convert mode', () => {
  it('prefills initialValues, locks cliente, and submits through onCreate instead of addTarefa', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
        initialValues={{ titulo: 'Trocar arte do feed', descricao: 'Pedido do cliente', cliente_id: 9 }}
        lockCliente
        onCreate={onCreate}
      />,
    );

    expect(screen.getByDisplayValue('Trocar arte do feed')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pedido do cliente')).toBeInTheDocument();
    // Cliente pausado ainda aparece (esta travado no da solicitacao)
    expect(screen.getByText('Cliente Pausado')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /criar tarefa/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      titulo: 'Trocar arte do feed',
      cliente_id: 9,
    });
    expect(addTarefaMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- TarefaFormDialog
```
Expected: FAIL (unknown props / no prefill).

- [ ] **Step 3: Implement.** In `TarefaFormDialog.tsx`:

Export the payload type and extend props:

```ts
export type TarefaFormPayload = {
  titulo: string;
  descricao: string | null;
  status: 'pendente' | 'em_andamento' | 'concluida';
  responsavel_id: number | null;
  cliente_id: number | null;
  data_limite: string | null;
};

interface TarefaFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Null = create mode; a task = edit mode. */
  editing: TarefaWithRelations | null;
  membros: Membro[];
  clientes: Cliente[];
  tags: TarefaTag[];
  onSaved: () => void;
  onTagCreated: () => void;
  /** Create-mode prefill (conversao de solicitacao). */
  initialValues?: { titulo?: string; descricao?: string; cliente_id?: number | null };
  /** Trava o campo cliente (a RPC de conversao fixa o cliente de qualquer forma). */
  lockCliente?: boolean;
  /** Substitui o addTarefa interno no submit de criacao. Quem fornece e dono dos toasts de sucesso. */
  onCreate?: (payload: TarefaFormPayload, tagIds: number[]) => Promise<void>;
}
```

In the reset effect's create branch, replace `form.reset(BLANK)` with:

```ts
form.reset({
  ...BLANK,
  titulo: initialValues?.titulo ?? '',
  descricao: initialValues?.descricao ?? '',
  cliente_id: initialValues?.cliente_id != null ? String(initialValues.cliente_id) : 'none',
});
```

(add `initialValues` to the effect deps). Keep the paused-client visible:

```ts
const activeClientes = clientes
  .filter(
    (c) => c.status === 'ativo' || c.id === editing?.cliente_id || c.id === initialValues?.cliente_id,
  )
  .sort((a, b) => a.nome.localeCompare(b.nome));
```

In `onSubmit`, replace the create branch and widen the catch:

```ts
try {
  if (editing) {
    await updateTarefa(editing.id!, payload);
    await setTarefaTags(editing.id!, tagIds);
    toast.success('Tarefa atualizada!');
  } else if (onCreate) {
    await onCreate(payload, tagIds);
  } else {
    await addTarefa(payload, tagIds);
    toast.success('Tarefa criada!');
  }
  onSaved();
  onClose();
} catch (e) {
  const fallback = editing ? 'Erro ao atualizar tarefa' : 'Erro ao criar tarefa';
  toast.error(e instanceof Error && e.message ? e.message : fallback);
} finally {
  setSaving(false);
}
```

Cliente `Select`: `<Select value={field.value} onValueChange={field.onChange} disabled={lockCliente}>`. Dialog title: `{editing ? 'Editar tarefa' : onCreate ? 'Converter em tarefa' : 'Nova tarefa'}`.

- [ ] **Step 4: Run tests**

```bash
npm run test -- TarefaFormDialog
npm run test -- TarefasPage
```
Expected: PASS (TarefasPage smoke must still pass; all new props are optional).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/tarefas
git commit -m "feat(tarefas): TarefaFormDialog com initialValues, lockCliente e onCreate"
```

---

### Task 7: IdeiaDrawer — conversion flow + derived-status UI (TDD)

**Files:**
- Modify: `apps/crm/src/components/ideias/IdeiaDrawer.tsx`
- Test: Create `apps/crm/src/components/ideias/__tests__/IdeiaDrawer.test.tsx`

**Interfaces:**
- Consumes: `convertSolicitacaoEmTarefa` (Task 5), `TarefaFormDialog` + `TarefaFormPayload` (Task 6), `getClientes`, `getTarefaTags`, `setTarefaTags` from store.
- Produces: conversion UX on every surface that renders the drawer (global Ideias page + HubTab).

- [ ] **Step 1: Write the failing tests**

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ideiaMedia', () => ({
  listIdeiaImages: vi.fn().mockResolvedValue([]),
  uploadIdeiaImage: vi.fn(),
  removeIdeiaImage: vi.fn(),
}));
vi.mock('@/store', () => ({
  updateIdeiaStatus: vi.fn(),
  upsertIdeiaComentario: vi.fn(),
  toggleIdeiaReaction: vi.fn(),
  getMembros: vi.fn().mockResolvedValue([]),
  getClientes: vi.fn().mockResolvedValue([]),
  getTarefaTags: vi.fn().mockResolvedValue([]),
  setTarefaTags: vi.fn(),
  convertSolicitacaoEmTarefa: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IdeiaDrawer } from '../IdeiaDrawer';

function renderDrawer(ideia: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IdeiaDrawer ideia={ideia as never} queryKey={['x']} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BASE = {
  id: 'i1',
  workspace_id: 'w1',
  cliente_id: 7,
  titulo: 'Trocar arte',
  descricao: 'desc',
  links: [],
  comentario_agencia: null,
  comentario_autor_id: null,
  comentario_at: null,
  created_at: '2026-07-30T12:00:00Z',
  updated_at: '2026-07-30T12:00:00Z',
  clientes: { nome: 'Cliente Sete' },
  comentario_autor: null,
  ideia_reactions: [],
  image_count: 0,
};

describe('IdeiaDrawer conversion UI', () => {
  it('shows the convert button for an eligible solicitacao', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'nova', tarefa_id: null });
    expect(screen.getByRole('button', { name: /converter em tarefa/i })).toBeInTheDocument();
  });

  it('hides the convert button for tipo=ideia', () => {
    renderDrawer({ ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null });
    expect(screen.queryByRole('button', { name: /converter em tarefa/i })).not.toBeInTheDocument();
  });

  it('locks manual status and links to the task once converted', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'convertida', tarefa_id: 42 });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /ver tarefa/i });
    expect(link).toHaveAttribute('href', '/tarefas?tarefa=42');
  });

  it('reopens manual status for an orphaned converted solicitacao', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'convertida', tarefa_id: null });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test -- IdeiaDrawer
```
Expected: FAIL.

- [ ] **Step 3: Implement.** In `IdeiaDrawer.tsx`:

New imports:

```ts
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import {
  updateIdeiaStatus, upsertIdeiaComentario, toggleIdeiaReaction, getMembros,
  getClientes, getTarefaTags, setTarefaTags, convertSolicitacaoEmTarefa,
  type Ideia,
} from '@/store';
import { TarefaFormDialog, type TarefaFormPayload } from '@/pages/tarefas/components/TarefaFormDialog';
import { IdeiaTipoBadge } from './IdeiaTipoBadge';
```

Derived-state helpers (module scope):

```ts
const CONVERSIBLE_STATUSES: Ideia['status'][] = ['nova', 'em_analise', 'aprovada'];
```

Inside the component:

```ts
const [convertOpen, setConvertOpen] = useState(false);
const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
const { data: tarefaTags = [] } = useQuery({ queryKey: ['tarefa-tags'], queryFn: getTarefaTags });

const isConverted = ideia.status === 'convertida' || ideia.status === 'concluida';
const statusLocked = isConverted && ideia.tarefa_id != null;
const canConvert = ideia.tipo === 'solicitacao' && CONVERSIBLE_STATUSES.includes(ideia.status);

async function handleConvertCreate(payload: TarefaFormPayload, tagIds: number[]) {
  // A RPC e o commit da conversao; tags sao best-effort depois dela.
  const tarefaId = await convertSolicitacaoEmTarefa({
    ideiaId: ideia.id,
    titulo: payload.titulo,
    descricao: payload.descricao,
    responsavelId: payload.responsavel_id,
    dataLimite: payload.data_limite,
  });
  let tagsOk = true;
  if (tagIds.length > 0) {
    try {
      await setTarefaTags(tarefaId, tagIds);
    } catch {
      tagsOk = false;
    }
  }
  qc.invalidateQueries({ queryKey });
  qc.invalidateQueries({ queryKey: ['tarefas'] });
  if (tagsOk) toast.success('Solicitação convertida em tarefa!');
  else toast.warning('Tarefa criada, mas as tags não foram aplicadas. Edite a tarefa para adicioná-las.');
}
```

Header: add `<IdeiaTipoBadge tipo={ideia.tipo} />` beside the existing `IdeiaStatusBadge` (wrap both in a `flex gap-1.5` div).

Replace the Status section body with the derived-state matrix:

```tsx
{statusLocked ? (
  <div className="flex items-center gap-3">
    <IdeiaStatusBadge status={ideia.status} />
    <Link
      to={`/tarefas?tarefa=${ideia.tarefa_id}`}
      className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2 text-muted-foreground hover:text-foreground transition-colors"
    >
      <ListChecks size={14} />
      Ver tarefa
    </Link>
  </div>
) : (
  <Select
    value={CONVERSIBLE_STATUSES.includes(ideia.status) || ideia.status === 'descartada' ? ideia.status : 'nova'}
    onValueChange={(v) => handleStatusChange(v as Ideia['status'])}
    disabled={statusSaving}
  >
    {/* trigger/content inalterados; STATUS_OPTIONS segue com os 4 status manuais */}
  </Select>
)}
```

NOTE on the orphan case: when `isConverted && tarefa_id == null` the Select renders with value coerced to `'nova'` only if the current status is not one of the four options (Radix Select needs a valid value); picking any option calls the normal `handleStatusChange`, returning the ideia to manual statuses.

Below the Status section (or beside it), the convert action:

```tsx
{canConvert && (
  <Button size="sm" onClick={() => setConvertOpen(true)}>
    <ListChecks size={13} className="mr-1.5" />
    Converter em tarefa
  </Button>
)}
```

Before the closing `</Sheet>`:

```tsx
<TarefaFormDialog
  open={convertOpen}
  onClose={() => setConvertOpen(false)}
  editing={null}
  membros={membros}
  clientes={clientes}
  tags={tarefaTags}
  onSaved={() => {}}
  onTagCreated={() => qc.invalidateQueries({ queryKey: ['tarefa-tags'] })}
  initialValues={{ titulo: ideia.titulo, descricao: ideia.descricao, cliente_id: ideia.cliente_id }}
  lockCliente
  onCreate={handleConvertCreate}
/>
```

GOTCHA: the drawer receives `ideia` as a prop snapshot; after conversion the parent's query refetches but the open drawer still shows the stale object. Have the parent pass the fresh object: in `IdeiasPage.tsx` and `HubTab.tsx`, when rendering the drawer, resolve `selectedIdeia` against the fresh list first (`const current = ideias.find((i) => i.id === selectedIdeia.id) ?? selectedIdeia;` and pass `current`). Include this small change in this task.

- [ ] **Step 4: Run tests**

```bash
npm run test -- IdeiaDrawer
npx tsc -p apps/crm/tsconfig.json --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/ideias apps/crm/src/pages/ideias/IdeiasPage.tsx apps/crm/src/pages/cliente-detalhe/HubTab.tsx
git commit -m "feat(crm): converter solicitacao em tarefa pelo IdeiaDrawer"
```

---

### Task 8: Notification title for solicitações

**Files:**
- Modify: `apps/crm/src/lib/notification-config.ts` (idea_submitted case, ~line 87)

**Interfaces:**
- Consumes: `metadata.tipo` stamped by the recreated trigger (Task 2).

- [ ] **Step 1: Implement.** Replace the `idea_submitted` case:

```ts
case 'idea_submitted':
  return {
    icon: Lightbulb,
    tone: 'primary',
    title: m.tipo === 'solicitacao' ? 'Nova solicitação do cliente' : 'Nova ideia do cliente',
    body: `${client} — ${idea}`,
  };
```

(`m` is the existing metadata local. The body template with its legacy em-dash is shared pre-existing code; leave it.)

- [ ] **Step 2: Sweep for fixture breakage + run tests**

```bash
grep -rn "idea_submitted" apps --include="*.test.*"
npm run test
```
Expected: PASS; update any fixture that asserts the old title unconditionally.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/lib/notification-config.ts
git commit -m "feat(crm): titulo de notificacao distinto para solicitacoes"
```

---

### Task 9: MCP scopes (both mirrored allowlists, TDD)

**Files:**
- Modify: `supabase/functions/_shared/mcp-token.ts` (MCP_ALLOWED_SCOPES, MCP_AGENT_PRESET), `apps/crm/src/lib/mcp-scopes.ts` (SCOPE_OPTIONS, AGENT_PRESET)
- Test: `apps/crm/src/lib/__tests__/mcp-scopes.test.ts` (append)

**Interfaces:**
- Produces: scopes `tarefas:read` / `tarefas:write` valid on key creation, OAuth consent, and `requireScope` gating. Read preset gains `tarefas:read` only.

- [ ] **Step 1: Write the failing test** (append to `mcp-scopes.test.ts`)

```ts
describe('tarefas scopes', () => {
  it('offers tarefas:read and tarefas:write as selectable scopes', () => {
    expect(SCOPE_OPTIONS.some((s) => s.value === 'tarefas:read')).toBe(true);
    expect(SCOPE_OPTIONS.some((s) => s.value === 'tarefas:write')).toBe(true);
  });
  it('adds tarefas:read to the preset but keeps tarefas:write out', () => {
    expect(AGENT_PRESET).toContain('tarefas:read');
    expect(AGENT_PRESET).not.toContain('tarefas:write');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- mcp-scopes
```
Expected: FAIL.

- [ ] **Step 3: Implement both mirrors.** `_shared/mcp-token.ts`:

```ts
export const MCP_ALLOWED_SCOPES = [
  "clientes:read", "posts:read", "workflows:read", "ideias:read", "tarefas:read",
  "posts:write", "templates:write", "tarefas:write",
] as const;

export const MCP_AGENT_PRESET: McpScope[] = [
  "clientes:read", "posts:read", "workflows:read", "ideias:read", "tarefas:read",
];
```

`apps/crm/src/lib/mcp-scopes.ts`:

```ts
export const SCOPE_OPTIONS = [
  { value: 'clientes:read', label: 'Clientes (leitura)' },
  { value: 'posts:read', label: 'Posts (leitura)' },
  { value: 'workflows:read', label: 'Fluxos (leitura)' },
  { value: 'ideias:read', label: 'Ideias/Pautas (leitura)' },
  { value: 'tarefas:read', label: 'Tarefas (leitura)' },
  { value: 'posts:write', label: 'Posts (escrita)' },
  { value: 'templates:write', label: 'Modelos (escrita)' },
  { value: 'tarefas:write', label: 'Tarefas (escrita)' },
] as const;

export const AGENT_PRESET: string[] = [
  'clientes:read', 'posts:read', 'workflows:read', 'ideias:read', 'tarefas:read',
];
```

- [ ] **Step 4: Run tests + sweep the deno mirror tests**

```bash
npm run test -- mcp-scopes
grep -n "MCP_ALLOWED_SCOPES\|AGENT_PRESET" supabase/functions/__tests__/mcp-token_test.ts supabase/functions/__tests__/mcp-keys_test.ts supabase/functions/__tests__/mcp-oauth_test.ts
npm run test:functions -- --filter "mcp-token"
git checkout -- deno.lock
```
Expected: vitest PASS; if any deno test fixates the scope list or preset length, extend it with the two new scopes and re-run.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mcp-token.ts apps/crm/src/lib/mcp-scopes.ts apps/crm/src/lib/__tests__/mcp-scopes.test.ts supabase/functions/__tests__
git commit -m "feat(mcp): scopes tarefas:read e tarefas:write nos dois allowlists"
```

---

### Task 10: MCP tools — list_tasks / create_task / update_task + list_ideas extension (TDD)

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (new tarefas section + listIdeas ~line 591), `supabase/functions/mcp/tools.ts` (imports + 3 register calls + list_ideas shape)
- Test: Create `supabase/functions/__tests__/mcp-tarefas_test.ts`

**Interfaces:**
- Consumes: `Deps`, `McpInputError`, `register()` pattern, scopes from Task 9.
- Produces: exported `listTasks(d, args)`, `createTask(d, args)`, `updateTask(d, args)` in queries.ts; tools `list_tasks`, `create_task`, `update_task` registered with scopes `tarefas:read`/`tarefas:write`.

- [ ] **Step 1: Write the failing tests.** New file `mcp-tarefas_test.ts`. Copy the `makeFakeDb`/`Call`/`insertPayload`/`updatePayload`/`has` harness verbatim from the top of `mcp-writes_test.ts` (it is file-local, not exported), then:

```ts
import { assert, assertEquals } from "./assert.ts";
import { createTask, listTasks, updateTask } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import { McpInputError, type McpKeyContext } from "../_shared/mcp-token.ts";

// [harness copied from mcp-writes_test.ts here]

const CTX: McpKeyContext = {
  conta_id: "workspace-A", scopes: ["tarefas:read", "tarefas:write"], key_id: "k1", created_by: "user-1",
};

Deno.test("createTask: stamps conta_id + user_id from ctx and validates membro ownership", async () => {
  const { db, calls } = makeFakeDb({
    membros: [{ data: { id: 3 }, error: null }],
    tarefas: [{ data: { id: 10, titulo: "X", status: "pendente" }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createTask(deps, { titulo: "X", responsavel_id: 3 });
  assert(has(calls, "membros", "eq", ["conta_id", "workspace-A"]), "membro ownership scoped");
  const row = insertPayload(calls, "tarefas")!;
  assertEquals(row.conta_id, "workspace-A");
  assertEquals(row.user_id, "user-1");
  assertEquals(row.status, "pendente");
  assertEquals(out.id, 10);
});

Deno.test("createTask: membro from another workspace -> McpInputError, no insert", async () => {
  const { db, calls } = makeFakeDb({ membros: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let threw = false;
  try {
    await createTask(deps, { titulo: "X", responsavel_id: 999 });
  } catch (e) {
    threw = e instanceof McpInputError;
  }
  assert(threw, "throws McpInputError");
  assert(!calls.some((c) => c.table === "tarefas" && c.method === "insert"), "no insert happened");
});

Deno.test("updateTask: empty patch -> McpInputError", async () => {
  const { db } = makeFakeDb({});
  const deps = { db, ctx: CTX } as unknown as Deps;
  let threw = false;
  try {
    await updateTask(deps, { task_id: 1 });
  } catch (e) {
    threw = e instanceof McpInputError;
  }
  assert(threw, "throws on empty patch");
});

Deno.test("updateTask: explicit nulls clear responsavel/data_limite (omitted fields untouched)", async () => {
  const { db, calls } = makeFakeDb({
    tarefas: [
      { data: { id: 1 }, error: null },                       // prefetch existence
      { data: { id: 1, titulo: "X", status: "pendente" }, error: null }, // update result
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updateTask(deps, { task_id: 1, responsavel_id: null, data_limite: null });
  const patch = updatePayload(calls, "tarefas")!;
  assertEquals(patch.responsavel_id, null);
  assertEquals(patch.data_limite, null);
  assert(!Object.hasOwn(patch, "titulo"), "omitted titulo not in patch");
  assert(!Object.hasOwn(patch, "descricao"), "omitted descricao not in patch");
});

Deno.test("updateTask: task from another workspace -> McpInputError", async () => {
  const { db } = makeFakeDb({ tarefas: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let threw = false;
  try {
    await updateTask(deps, { task_id: 404, status: "concluida" });
  } catch (e) {
    threw = e instanceof McpInputError;
  }
  assert(threw, "throws not-found");
});

Deno.test("listTasks: scopes by conta_id, clamps limit, flattens tags/subtarefas", async () => {
  const { db, calls } = makeFakeDb({
    tarefas: [{
      data: [{
        id: 1, titulo: "X", descricao: null, status: "pendente", responsavel_id: null,
        cliente_id: 7, data_limite: "2026-08-01", concluida_em: null,
        created_at: "t", updated_at: "t",
        clientes: { nome: "Cliente" },
        tarefa_tag_links: [{ tarefa_tags: { id: 2, nome: "urgente", cor: "#f00" } }],
        subtarefas: [{ id: 1, concluida: true }, { id: 2, concluida: false }],
      }],
      error: null,
    }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listTasks(deps, { limit: 9999 });
  assert(has(calls, "tarefas", "eq", ["conta_id", "workspace-A"]), "tenant scoped");
  assert(has(calls, "tarefas", "limit", [200]), "limit clamped to 200");
  assertEquals(out[0].cliente_nome, "Cliente");
  assertEquals(out[0].tags.length, 1);
  assertEquals(out[0].subtarefas_total, 2);
  assertEquals(out[0].subtarefas_concluidas, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:functions -- --filter "mcp-tarefas"
git checkout -- deno.lock
```
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement queries.** Append a tarefas section to `queries.ts`:

```ts
// ---- tarefas -----------------------------------------------------------------

export const TASK_STATUSES: string[] = ["pendente", "em_andamento", "concluida"];

// deno-lint-ignore no-explicit-any
function flattenTaskRow(row: any) {
  const { clientes, tarefa_tag_links, subtarefas, ...t } = row;
  const subs = subtarefas ?? [];
  return {
    ...t,
    cliente_nome: clientes?.nome ?? null,
    // deno-lint-ignore no-explicit-any
    tags: (tarefa_tag_links ?? []).map((l: any) => l.tarefa_tags).filter(Boolean),
    subtarefas_total: subs.length,
    // deno-lint-ignore no-explicit-any
    subtarefas_concluidas: subs.filter((s: any) => s.concluida).length,
  };
}

const TASK_SELECT =
  "id, titulo, descricao, status, responsavel_id, cliente_id, data_limite, concluida_em, created_at, updated_at";

async function assertMembroInWorkspace(d: Deps, membroId: number): Promise<void> {
  const { data } = await d.db
    .from("membros").select("id")
    .eq("conta_id", d.ctx.conta_id).eq("id", membroId).maybeSingle();
  if (!data) throw new McpInputError("Responsável não encontrado neste workspace.");
}

async function assertClienteInWorkspace(d: Deps, clienteId: number): Promise<void> {
  const { data } = await d.db
    .from("clientes").select("id")
    .eq("conta_id", d.ctx.conta_id).eq("id", clienteId).maybeSingle();
  if (!data) throw new McpInputError("Cliente não encontrado neste workspace.");
}

export async function listTasks(
  d: Deps,
  args: { status?: string; responsavel_id?: number; cliente_id?: number; limit?: number },
): Promise<any[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 50), 200);
  let q = d.db
    .from("tarefas")
    .select(`${TASK_SELECT}, clientes(nome), tarefa_tag_links(tarefa_tags(id, nome, cor)), subtarefas(id, concluida)`)
    .eq("conta_id", d.ctx.conta_id);
  if (args.status) q = q.eq("status", args.status);
  if (args.responsavel_id !== undefined) q = q.eq("responsavel_id", args.responsavel_id);
  if (args.cliente_id !== undefined) q = q.eq("cliente_id", args.cliente_id);
  const { data, error } = await q
    .order("data_limite", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as any[]).map(flattenTaskRow);
}

export async function createTask(
  d: Deps,
  args: { titulo: string; descricao?: string; responsavel_id?: number; cliente_id?: number; data_limite?: string },
): Promise<any> {
  // WITH CHECK da RLS nao protege writes service-role: validacao explicita aqui.
  if (args.responsavel_id != null) await assertMembroInWorkspace(d, args.responsavel_id);
  if (args.cliente_id != null) await assertClienteInWorkspace(d, args.cliente_id);
  const { data, error } = await d.db
    .from("tarefas")
    .insert({
      conta_id: d.ctx.conta_id,
      user_id: d.ctx.created_by, // uuid do criador da key; NUNCA ctx.key_id (pode nao ser uuid em OAuth)
      titulo: args.titulo,
      descricao: args.descricao ?? null,
      status: "pendente",
      responsavel_id: args.responsavel_id ?? null,
      cliente_id: args.cliente_id ?? null,
      data_limite: args.data_limite ?? null,
    })
    .select(TASK_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(
  d: Deps,
  args: {
    task_id: number;
    titulo?: string;
    descricao?: string | null;
    status?: string;
    responsavel_id?: number | null;
    data_limite?: string | null;
  },
): Promise<any> {
  const FIELDS = ["titulo", "descricao", "status", "responsavel_id", "data_limite"];
  if (!FIELDS.some((f) => Object.hasOwn(args, f))) {
    throw new McpInputError("Informe ao menos um campo para atualizar.");
  }
  if (Object.hasOwn(args, "status") && !TASK_STATUSES.includes(args.status as string)) {
    throw new McpInputError("Status inválido.");
  }

  const { data: existing } = await d.db
    .from("tarefas").select("id")
    .eq("conta_id", d.ctx.conta_id).eq("id", args.task_id).maybeSingle();
  if (!existing) throw new McpInputError("Tarefa não encontrada neste workspace.");

  if (Object.hasOwn(args, "responsavel_id") && args.responsavel_id != null) {
    await assertMembroInWorkspace(d, args.responsavel_id);
  }

  // null limpa, omitido preserva (Object.hasOwn distingue os dois).
  const payload: Record<string, unknown> = {};
  if (Object.hasOwn(args, "titulo")) payload.titulo = args.titulo;
  if (Object.hasOwn(args, "descricao")) payload.descricao = args.descricao;
  if (Object.hasOwn(args, "status")) payload.status = args.status; // concluida_em: trigger do banco
  if (Object.hasOwn(args, "responsavel_id")) payload.responsavel_id = args.responsavel_id;
  if (Object.hasOwn(args, "data_limite")) payload.data_limite = args.data_limite;

  const { data, error } = await d.db
    .from("tarefas")
    .update(payload)
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.task_id)
    .select(TASK_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new McpInputError("Tarefa não encontrada neste workspace.");
  return data;
}
```

Extend `listIdeas` in the same file:

```ts
export async function listIdeas(
  d: Deps,
  args: { client_id?: number; status?: string; tipo?: string },
): Promise<any[]> {
  let q = d.db
    .from("ideias")
    .select("id, cliente_id, titulo, descricao, status, tipo, tarefa_id, links, created_at")
    .eq("workspace_id", d.ctx.conta_id);
  if (args.client_id !== undefined) q = q.eq("cliente_id", args.client_id);
  if (args.status) q = q.eq("status", args.status);
  if (args.tipo) q = q.eq("tipo", args.tipo);
  const { data } = await q.order("created_at", { ascending: false });
  return data ?? [];
}
```

- [ ] **Step 4: Register the tools.** In `tools.ts`, add `listTasks, createTask, updateTask` to the queries import, and:

```ts
const TASK_STATUS = z.enum(["pendente", "em_andamento", "concluida"]);
const DATE_ONLY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato YYYY-MM-DD");
```

Update the list_ideas registration shape:

```ts
register(server, deps, "list_ideas", "ideias:read",
  "Lista o backlog de ideias e solicitações dos clientes. Solicitações convertidas apontam a tarefa via tarefa_id.",
  {
    client_id: z.number().int().optional(),
    status: z.enum(["nova", "em_analise", "aprovada", "descartada", "convertida", "concluida"]).optional(),
    tipo: z.enum(["ideia", "solicitacao"]).optional(),
  },
  (a) => listIdeas(deps, a));
```

Add the three tarefas tools (audit args = ids/flags only, never payloads):

```ts
register(server, deps, "list_tasks", "tarefas:read",
  "Lista as tarefas da equipe (rastreador interno): status, responsável, cliente, prazo, tags e progresso de subtarefas. Ordena por prazo.",
  {
    status: TASK_STATUS.optional(),
    responsavel_id: z.number().int().optional(),
    cliente_id: z.number().int().optional(),
    limit: z.number().int().optional(),
  },
  (a) => listTasks(deps, a));

register(server, deps, "create_task", "tarefas:write",
  "Cria uma tarefa da equipe (status inicial: pendente). Atribuir responsável notifica o membro.",
  {
    titulo: z.string().trim().min(1).max(200),
    descricao: z.string().max(10000).optional(),
    responsavel_id: z.number().int().positive().optional(),
    cliente_id: z.number().int().positive().optional(),
    data_limite: DATE_ONLY.optional(),
  },
  (a) => createTask(deps, a),
  (a, r) => ({
    task_id: (r as { id?: number })?.id,
    cliente_id: a.cliente_id,
    responsavel_id: a.responsavel_id,
    has_descricao: !!a.descricao,
    has_data_limite: !!a.data_limite,
  }));

register(server, deps, "update_task", "tarefas:write",
  "Edita uma tarefa: título, descrição, status, responsável, prazo. Passe null em descricao/responsavel_id/data_limite para limpar o campo; campos omitidos não mudam.",
  {
    task_id: z.number().int().positive(),
    titulo: z.string().trim().min(1).max(200).optional(),
    descricao: z.string().max(10000).nullable().optional(),
    status: TASK_STATUS.optional(),
    responsavel_id: z.number().int().positive().nullable().optional(),
    data_limite: DATE_ONLY.nullable().optional(),
  },
  (a) => updateTask(deps, a),
  (a) => ({
    task_id: a.task_id,
    status: a.status,
    responsavel_id: a.responsavel_id,
    has_titulo: Object.hasOwn(a, "titulo"),
    has_descricao: Object.hasOwn(a, "descricao"),
    has_data_limite: Object.hasOwn(a, "data_limite"),
  }));
```

- [ ] **Step 5: Run all deno tests**

```bash
npm run test:functions
git checkout -- deno.lock
```
Expected: ALL PASS (including the new mcp-tarefas file and any pre-existing list_ideas assertion updates).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp supabase/functions/__tests__/mcp-tarefas_test.ts
git commit -m "feat(mcp): tools list_tasks, create_task e update_task; list_ideas com tipo"
```

---

### Task 11: Full verification + staging deploy + E2E

**Files:** none new (verification only).

- [ ] **Step 1: The full CI-equivalent suite**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git checkout -- deno.lock
npm run lint
npm run format && npm run format:check
```
Expected: everything green. Commit any format fixes (`style: prettier`).

- [ ] **Step 2: Point the link at STAGING and verify** (link state flips; never assume)

```bash
cat supabase/.temp/project-ref
```
Expected: `wlyzhyfondykzpsiqsce` (staging). If it shows `skjzpekeqefvlojenfsw` (PROD), run `npx supabase link --project-ref wlyzhyfondykzpsiqsce` first. Also confirm staging PG >= 15 (needed by the column-list SET NULL):

```bash
npx supabase db query "select version()" --linked
```

- [ ] **Step 3: Push migration + deploy functions to staging**

```bash
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase functions deploy hub-ideias --no-verify-jwt --use-api
npx supabase functions deploy mcp --no-verify-jwt --use-api
```

- [ ] **Step 4: SQL checks on staging** (run each via `npx supabase db query "..." --linked`)

1. Create an eligible solicitação directly: `INSERT INTO ideias (workspace_id, cliente_id, titulo, descricao, tipo) SELECT w.id, c.id, 'Teste conversao', 'desc', 'solicitacao' FROM workspaces w JOIN clientes c ON c.conta_id = w.id LIMIT 1 RETURNING id, workspace_id;`
2. RPC as service role converts it (service_role grant path): `SELECT convert_solicitacao_em_tarefa('<id>', 'Tarefa do teste', NULL, NULL, NULL);` — returns a tarefa id. NOTE: under service role `auth.uid()` is NULL and `tarefas.user_id` is NOT NULL, so THIS check is expected to FAIL with a not-null violation; that is correct behavior (the RPC is for authenticated members; the browser E2E exercises the real path). Instead verify the guard rails: run the same call twice via the browser E2E below, and here verify only:
3. `SELECT status, tarefa_id FROM ideias WHERE id = '<id>';` after the browser conversion → `convertida`, non-null tarefa_id.
4. Flip the tarefa: `UPDATE tarefas SET status='concluida' WHERE id=<tid>;` then check the ideia became `concluida`; `UPDATE tarefas SET status='pendente' ...` → back to `convertida`.
5. Orphan: `DELETE FROM tarefas WHERE id=<tid>;` → ideia keeps status with `tarefa_id IS NULL` (SET NULL hit only the pointer).
6. Cross-tenant FK: try `UPDATE ideias SET tarefa_id = <tarefa de outro workspace> WHERE id='<id>'` → must fail with FK violation.
7. Clean up the test row.

- [ ] **Step 5: Browser E2E on staging** (`npm run dev:staging` + `npm run dev:hub:staging`, use the Browser pane)

1. Hub: create a solicitação with the toggle; card shows "Solicitação" badge.
2. CRM /ideias: row shows Tipo badge; tipo filter works; open drawer → "Converter em tarefa" → dialog pre-filled, cliente locked → convert with a responsável + tag.
3. Drawer now read-only status "Virou tarefa" + "Ver tarefa" link → follows to /tarefas with the sheet open.
4. Try converting the same solicitação again from a second tab (stale UI) → clean error toast, no duplicate task.
5. Complete the tarefa in /tarefas → Hub shows "Concluída"; drag it back → Hub shows "Em andamento".
6. Notification bell shows "Nova solicitação do cliente" for the submission.

- [ ] **Step 6: Commit any fixes found, re-running the affected tests.**

---

### Task 12: PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin ebs/hub-solicitacoes
gh pr create --title "feat: solicitacoes no Hub com conversao em tarefa + MCP task tools" --body "$(cat <<'EOF'
## Resumo
- Hub: cliente escolhe entre **ideia** e **solicitação** ao enviar; novos status client-facing "Em andamento"/"Concluída".
- CRM: filtro e badge de tipo em /ideias; solicitações ganham **Converter em tarefa** (RPC transacional, cliente fixado, claim idempotente); status derivados convertida/concluida fora do seletor manual; sync bidirecional tarefa⇄solicitação por trigger atômico.
- MCP: tools `list_tasks`/`create_task`/`update_task` sob scopes novos `tarefas:read`/`tarefas:write`; `list_ideas` passa a expor tipo/tarefa_id.

## Spec
docs/superpowers/specs/2026-07-30-hub-solicitacoes-conversao-tarefa-design.md (2 rodadas de revisão externa incorporadas)

## Migração
`20260730000007_ideias_solicitacoes.sql` aplicada no staging; **prod pendente pós-merge** (db push contra prod segue quebrado pelo 20260730000004 sem arquivo: aplicar via db query + registro manual de versão).

## Deploy pós-merge
- prod: migração manual + `functions deploy hub-ideias mcp --no-verify-jwt --use-api`
- reconectar o connector MCP (redeploy invalida a conexão) e reemitir keys que precisarem de `tarefas:*`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Address the auto-triggered Codex review** (verify each point against the code before accepting; reply on the PR).

---

## Self-review notes (already applied)

- Spec item "seed.ts ganha uma linha de instruções": dropped — `mcp/seed.ts` is the property-seeder, and the MCP server has no instructions string; tool descriptions carry the documentation. Deviation recorded here intentionally.
- The RPC-under-service-role SQL check (Task 11 step 4.2) would violate `tarefas.user_id NOT NULL` since `auth.uid()` is NULL; the plan verifies the RPC through the browser E2E instead and keeps the SQL checks to trigger/FK behavior.
- Spec coverage check: tipo (Tasks 3-5), conversion + derived states (Tasks 2, 6, 7), notification (Tasks 2, 8), MCP (Tasks 9, 10), list_ideas contract (Task 10), tests/staging (Tasks 3-11), delivery sequence (Tasks 1, 11, 12). No gaps found.
