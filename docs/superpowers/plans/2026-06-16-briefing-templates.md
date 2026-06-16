# Briefing Templates & Multiple Briefings per Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agency users group a client's briefing questions into multiple titled "briefings", and create reusable question templates that can be applied manually or auto-seeded onto new clients (then edited inline per-client).

**Architecture:** A new `briefings` table is the titled container (one client → many briefings); `hub_briefing_questions` gains a nullable `briefing_id`. A new `briefing_templates` table (name + JSONB question array, one default per workspace) mirrors the existing `workflow_templates` pattern. Applying a template copies its questions into a fresh briefing (independent copies, no propagation). The CRM `BriefingEditor` becomes briefing-aware; the Hub `BriefingPage` renders briefing tabs. Auto-seed is hooked app-side in `addCliente()`.

**Tech Stack:** React 19 + TanStack Query (CRM & Hub), Supabase (Postgres + RLS + Deno edge functions), Vitest (store unit tests), Deno test (edge functions). Path alias `@/` → `apps/<app>/src/`.

**Spec:** `docs/superpowers/specs/2026-06-16-briefing-templates-design.md`

---

## Conventions for every task

- **Branch:** all work happens on `feat/briefing-templates` (already checked out).
- **TDD where unit-testable** (store layer, edge function). UI tasks are verified by `npm run build` / `npm run build:hub` (tsc typecheck) plus a manual smoke checklist — this repo has no React component-test setup, so we follow that established pattern rather than introducing one.
- **Deno gotcha:** `npm run test:functions` runs Deno with `--node-modules-dir=auto`, which can rewrite `deno.lock` and pollute `node_modules`, breaking the next `npm run build`. After running Deno tests, if `git status` shows `deno.lock` changed, run `git checkout deno.lock && npm ci` before any JS build/commit.
- **Commit** at the end of each task with the message shown.

---

## File Structure

| File | Responsibility | Created/Modified |
|------|----------------|------------------|
| `supabase/migrations/20260616120000_briefings_table.sql` | `briefings` table + RLS | Create |
| `supabase/migrations/20260616120100_briefing_questions_briefing_id.sql` | nullable `briefing_id` + backfill | Create |
| `supabase/migrations/20260616120200_briefing_templates.sql` | `briefing_templates` table + RLS + one-default index + `set_default_briefing_template` RPC | Create |
| `apps/crm/src/store/hub.ts` | Briefing/template types + CRUD + `applyTemplateToClient`; `briefing_id`-aware question fns | Modify |
| `apps/crm/src/store/clients.ts` | `addCliente` auto-seeds default template | Modify |
| `apps/crm/src/__tests__/store.hub.test.ts` | Store unit tests | Modify |
| `supabase/functions/hub-briefing/handler.ts` | GET returns briefings (parent query) | Modify |
| `supabase/functions/__tests__/hub-briefing_test.ts` | Edge GET tests | Create |
| `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` | `BriefingEditor` becomes briefing-aware | Modify |
| `apps/crm/src/pages/cliente-detalhe/BriefingTemplatesModal.tsx` | Manage-templates modal | Create |
| `apps/hub/src/types.ts` | `Briefing` type | Modify |
| `apps/hub/src/api.ts` | `fetchBriefing` returns `{ briefings }` | Modify |
| `apps/hub/src/pages/BriefingPage.tsx` | Briefing tabs + sections | Modify |

---

# Phase A — Database migrations

> SQL-only; these commits don't affect tsc. They are applied to staging/prod later (see Deployment). No automated test here — correctness is exercised by the store tests (Phase B+) against the new shapes and a manual `db push` dry-run during Deployment.

### Task A1: `briefings` table

**Files:**
- Create: `supabase/migrations/20260616120000_briefings_table.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX briefings_cliente_id_idx ON briefings (cliente_id);

ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefings_select" ON briefings;
CREATE POLICY "briefings_select" ON briefings
  FOR SELECT USING ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefings_insert" ON briefings;
CREATE POLICY "briefings_insert" ON briefings
  FOR INSERT WITH CHECK ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefings_update" ON briefings;
CREATE POLICY "briefings_update" ON briefings
  FOR UPDATE USING ( conta_id IN (SELECT public.get_my_conta_id()) )
  WITH CHECK ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefings_delete" ON briefings;
CREATE POLICY "briefings_delete" ON briefings
  FOR DELETE USING ( conta_id IN (SELECT public.get_my_conta_id()) );
```

- [ ] **Step 2: Sanity-check the SQL is well-formed**

Run: `grep -c "CREATE POLICY" supabase/migrations/20260616120000_briefings_table.sql`
Expected: `4`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260616120000_briefings_table.sql
git commit -m "feat(db): add briefings table (titled container per client)"
```

---

### Task A2: `briefing_id` column + backfill (nullable)

**Files:**
- Create: `supabase/migrations/20260616120100_briefing_questions_briefing_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Nullable on purpose: an old/cached CRM bundle still inserts without briefing_id.
-- A NOT NULL constraint would break those inserts immediately after this runs.
-- Tightening to NOT NULL is a deferred follow-up migration (see spec rollout notes).
ALTER TABLE hub_briefing_questions
  ADD COLUMN IF NOT EXISTS briefing_id uuid REFERENCES briefings(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS hub_briefing_questions_briefing_id_idx
  ON hub_briefing_questions (briefing_id);

-- Backfill: one untitled briefing per client that already has questions
-- (empty title so the agency can name it later), then point that client's questions at it.
DO $$
DECLARE
  rec RECORD;
  new_briefing_id uuid;
BEGIN
  FOR rec IN
    SELECT cliente_id, conta_id
    FROM hub_briefing_questions
    WHERE briefing_id IS NULL
    GROUP BY cliente_id, conta_id
  LOOP
    INSERT INTO briefings (cliente_id, conta_id, title, display_order)
    VALUES (rec.cliente_id, rec.conta_id, '', 0)
    RETURNING id INTO new_briefing_id;

    UPDATE hub_briefing_questions
    SET briefing_id = new_briefing_id
    WHERE cliente_id = rec.cliente_id AND briefing_id IS NULL;
  END LOOP;
END $$;
```

- [ ] **Step 2: Confirm the column is NOT declared NOT NULL**

Run: `grep -i "not null" supabase/migrations/20260616120100_briefing_questions_briefing_id.sql`
Expected: no match (exit code 1 / empty output)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260616120100_briefing_questions_briefing_id.sql
git commit -m "feat(db): add nullable briefing_id to hub_briefing_questions + backfill"
```

---

### Task A3: `briefing_templates` table + one-default index + RPC

**Files:**
- Create: `supabase/migrations/20260616120200_briefing_templates.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE briefing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ question: string, section: string|null }]
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one default template per workspace.
CREATE UNIQUE INDEX briefing_templates_one_default
  ON briefing_templates (conta_id) WHERE is_default;

ALTER TABLE briefing_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefing_templates_select" ON briefing_templates;
CREATE POLICY "briefing_templates_select" ON briefing_templates
  FOR SELECT USING ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefing_templates_insert" ON briefing_templates;
CREATE POLICY "briefing_templates_insert" ON briefing_templates
  FOR INSERT WITH CHECK ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefing_templates_update" ON briefing_templates;
CREATE POLICY "briefing_templates_update" ON briefing_templates
  FOR UPDATE USING ( conta_id IN (SELECT public.get_my_conta_id()) )
  WITH CHECK ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefing_templates_delete" ON briefing_templates;
CREATE POLICY "briefing_templates_delete" ON briefing_templates
  FOR DELETE USING ( conta_id IN (SELECT public.get_my_conta_id()) );

-- Transactional set-default: clears the workspace's other defaults, sets this one.
-- SECURITY INVOKER so RLS still applies (a user only sees/touches their own workspace rows;
-- passing a foreign template id makes the SELECT return NULL -> raises).
CREATE OR REPLACE FUNCTION set_default_briefing_template(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_conta_id uuid;
BEGIN
  SELECT conta_id INTO v_conta_id FROM briefing_templates WHERE id = p_template_id;
  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;
  UPDATE briefing_templates SET is_default = false
    WHERE conta_id = v_conta_id AND is_default AND id <> p_template_id;
  UPDATE briefing_templates SET is_default = true WHERE id = p_template_id;
END;
$$;
```

- [ ] **Step 2: Confirm the partial unique index and RPC exist**

Run: `grep -E "one_default|set_default_briefing_template" supabase/migrations/20260616120200_briefing_templates.sql | wc -l`
Expected: `3` (index def + SELECT line + UPDATE/CREATE references — any count ≥ 2 confirms both present)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260616120200_briefing_templates.sql
git commit -m "feat(db): add briefing_templates table + one-default index + set-default RPC"
```

---

# Phase B — Store layer (additive, TDD with Vitest)

> These are purely additive: they don't change existing signatures, so `npm run build` and the existing test suite stay green. Run tests with:
> `npx vitest run apps/crm/src/__tests__/store.hub.test.ts`

### Task B1: Briefing types + briefings CRUD

**Files:**
- Modify: `apps/crm/src/store/hub.ts`
- Test: `apps/crm/src/__tests__/store.hub.test.ts`

- [ ] **Step 1: Write the failing test** — append this `it(...)` block inside the `describe('store hub and ideias helpers', ...)` block in `store.hub.test.ts` (after the existing briefing test, before the closing `});`):

```ts
  it('manages briefings (list, add with order, rename, delete)', async () => {
    mockedSupabase.__queueSupabaseResult(
      'briefings',
      'select',
      // getBriefings -> list
      { data: [{ id: 'b1', cliente_id: 14, title: 'Onboarding', display_order: 0 }], error: null },
      // addBriefing -> max display_order lookup
      { data: { display_order: 2 }, error: null },
    );
    mockedSupabase.__queueSupabaseResult('briefings', 'insert', {
      data: { id: 'b2', cliente_id: 14, conta_id: 'conta-1', title: 'Campanha', display_order: 3 },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('briefings', 'update', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('briefings', 'delete', { data: null, error: null });

    await expect(store.getBriefings(14)).resolves.toEqual([
      { id: 'b1', cliente_id: 14, title: 'Onboarding', display_order: 0 },
    ]);
    await expect(store.addBriefing(14, 'conta-1', 'Campanha')).resolves.toEqual({
      id: 'b2',
      cliente_id: 14,
      conta_id: 'conta-1',
      title: 'Campanha',
      display_order: 3,
    });
    await store.updateBriefingTitle('b1', 'Briefing Inicial');
    await store.deleteBriefing('b1');

    expect(getCalls('briefings', 'insert').at(-1)?.payload).toEqual({
      cliente_id: 14,
      conta_id: 'conta-1',
      title: 'Campanha',
      display_order: 3,
    });
    expect(getCalls('briefings', 'update').at(-1)?.payload).toEqual({ title: 'Briefing Inicial' });
    expect(getCalls('briefings', 'delete').at(-1)?.modifiers).toContainEqual({
      method: 'eq',
      args: ['id', 'b1'],
    });
  });
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "manages briefings"`
Expected: FAIL — `store.getBriefings is not a function`

- [ ] **Step 3: Add types** — in `apps/crm/src/store/hub.ts`, change the existing `HubBriefingQuestionRow` interface to add `briefing_id`, and add the new interfaces right after it:

```ts
export interface HubBriefingQuestionRow {
  id: string;
  cliente_id: number;
  conta_id: string;
  briefing_id: string | null;
  question: string;
  answer: string | null;
  section: string | null;
  display_order: number;
  created_at: string;
}

export interface BriefingRow {
  id: string;
  cliente_id: number;
  conta_id: string;
  title: string;
  display_order: number;
  created_at: string;
}

export interface BriefingTemplateQuestion {
  question: string;
  section: string | null;
}

export interface BriefingTemplateRow {
  id: string;
  conta_id: string;
  user_id: string;
  title: string;
  questions: BriefingTemplateQuestion[];
  is_default: boolean;
  created_at: string;
}
```

- [ ] **Step 4: Update the import line** at the top of `hub.ts` to include `getUserId` (needed by Task B2):

```ts
import { supabase, getContaId, getUserId } from './core';
```

- [ ] **Step 5: Add the briefings CRUD functions** — append to `hub.ts` (after the existing briefing-question functions):

```ts
// ──────────────────────────────────────────────
// Briefings (titled containers, one client → many)
// ──────────────────────────────────────────────

export async function getBriefings(clienteId: number): Promise<BriefingRow[]> {
  const { data, error } = await supabase
    .from('briefings')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('display_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function addBriefing(
  clienteId: number,
  contaId: string,
  title: string,
): Promise<BriefingRow> {
  const { data: existing } = await supabase
    .from('briefings')
    .select('display_order')
    .eq('cliente_id', clienteId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (existing?.display_order ?? -1) + 1;
  const { data, error } = await supabase
    .from('briefings')
    .insert({ cliente_id: clienteId, conta_id: contaId, title, display_order: nextOrder })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBriefingTitle(id: string, title: string): Promise<void> {
  const { error } = await supabase.from('briefings').update({ title }).eq('id', id);
  if (error) throw error;
}

export async function deleteBriefing(id: string): Promise<void> {
  // hub_briefing_questions rows cascade-delete via FK.
  const { error } = await supabase.from('briefings').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "manages briefings"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/store/hub.ts apps/crm/src/__tests__/store.hub.test.ts
git commit -m "feat(store): briefing types + briefings CRUD"
```

---

### Task B2: Briefing templates CRUD + set-default RPC

**Files:**
- Modify: `apps/crm/src/store/hub.ts`
- Test: `apps/crm/src/__tests__/store.hub.test.ts`

- [ ] **Step 1: Extend the test mock type** — in `store.hub.test.ts`, add `__queueSupabaseRpc` to the `MockedSupabaseModule` type (it already exists in the mock module; the type just needs to expose it). Update the type definition near the top of the file:

```ts
type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __queueSupabaseRpc: (
    name: string,
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};
```

- [ ] **Step 2: Write the failing test** — append inside the `describe` block:

```ts
  it('manages briefing templates and sets a default via RPC', async () => {
    mockedSupabase.__queueSupabaseResult('briefing_templates', 'select', {
      data: [{ id: 't1', title: 'Discovery', questions: [], is_default: false }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('briefing_templates', 'insert', {
      data: {
        id: 't2',
        conta_id: 'conta-1',
        user_id: 'user-1',
        title: 'Marca',
        questions: [{ question: 'Voz da marca?', section: null }],
        is_default: false,
      },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('briefing_templates', 'update', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('briefing_templates', 'delete', { data: null, error: null });
    mockedSupabase.__queueSupabaseRpc('set_default_briefing_template', { data: null, error: null });

    await expect(store.getBriefingTemplates()).resolves.toEqual([
      { id: 't1', title: 'Discovery', questions: [], is_default: false },
    ]);
    await store.addBriefingTemplate({
      title: 'Marca',
      questions: [{ question: 'Voz da marca?', section: null }],
    });
    await store.updateBriefingTemplate('t1', { title: 'Discovery v2' });
    await store.removeBriefingTemplate('t1');
    await store.setDefaultBriefingTemplate('t2');

    expect(getCalls('briefing_templates', 'insert').at(-1)?.payload).toEqual({
      title: 'Marca',
      questions: [{ question: 'Voz da marca?', section: null }],
      user_id: 'user-1',
      conta_id: 'conta-1',
    });
    expect(getCalls('briefing_templates', 'update').at(-1)?.payload).toEqual({ title: 'Discovery v2' });
    const rpcCall = getCalls('rpc:set_default_briefing_template').at(-1);
    expect(rpcCall?.payload).toEqual({ p_template_id: 't2' });
  });
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "manages briefing templates"`
Expected: FAIL — `store.getBriefingTemplates is not a function`

- [ ] **Step 4: Add the template functions** — append to `hub.ts`:

```ts
// ──────────────────────────────────────────────
// Briefing templates (reusable question sets, one default per workspace)
// ──────────────────────────────────────────────

export async function getBriefingTemplates(): Promise<BriefingTemplateRow[]> {
  const { data, error } = await supabase
    .from('briefing_templates')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addBriefingTemplate(
  t: Pick<BriefingTemplateRow, 'title' | 'questions'>,
): Promise<BriefingTemplateRow> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('briefing_templates')
    .insert({ title: t.title, questions: t.questions, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBriefingTemplate(
  id: string,
  t: Partial<Pick<BriefingTemplateRow, 'title' | 'questions'>>,
): Promise<void> {
  const { error } = await supabase.from('briefing_templates').update(t).eq('id', id);
  if (error) throw error;
}

export async function removeBriefingTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('briefing_templates').delete().eq('id', id);
  if (error) throw error;
}

export async function setDefaultBriefingTemplate(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_briefing_template', { p_template_id: id });
  if (error) throw error;
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "manages briefing templates"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/store/hub.ts apps/crm/src/__tests__/store.hub.test.ts
git commit -m "feat(store): briefing templates CRUD + set-default RPC"
```

---

### Task B3: `applyTemplateToClient` with compensating cleanup

**Files:**
- Modify: `apps/crm/src/store/hub.ts`
- Test: `apps/crm/src/__tests__/store.hub.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe` block:

```ts
  it('applies a template into a new briefing as independent copies', async () => {
    // fetch template by id
    mockedSupabase.__queueSupabaseResult('briefing_templates', 'select', {
      data: {
        id: 't1',
        title: 'Discovery',
        questions: [
          { question: 'Metas?', section: 'Estratégia' },
          { question: 'Concorrentes?', section: 'Estratégia' },
        ],
      },
      error: null,
    });
    // addBriefing: max-order lookup, then insert
    mockedSupabase.__queueSupabaseResult('briefings', 'select', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('briefings', 'insert', {
      data: { id: 'b9', cliente_id: 14, conta_id: 'conta-1', title: 'Discovery', display_order: 0 },
      error: null,
    });
    // bulk question insert
    mockedSupabase.__queueSupabaseResult('hub_briefing_questions', 'insert', { data: null, error: null });

    await expect(store.applyTemplateToClient(14, 'conta-1', 't1')).resolves.toEqual({
      id: 'b9',
      cliente_id: 14,
      conta_id: 'conta-1',
      title: 'Discovery',
      display_order: 0,
    });

    expect(getCalls('hub_briefing_questions', 'insert').at(-1)?.payload).toEqual([
      {
        cliente_id: 14,
        conta_id: 'conta-1',
        briefing_id: 'b9',
        question: 'Metas?',
        section: 'Estratégia',
        answer: null,
        display_order: 0,
      },
      {
        cliente_id: 14,
        conta_id: 'conta-1',
        briefing_id: 'b9',
        question: 'Concorrentes?',
        section: 'Estratégia',
        answer: null,
        display_order: 1,
      },
    ]);
  });

  it('deletes the new briefing if the question insert fails (compensating cleanup)', async () => {
    mockedSupabase.__queueSupabaseResult('briefing_templates', 'select', {
      data: { id: 't1', title: 'Discovery', questions: [{ question: 'Metas?', section: null }] },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('briefings', 'select', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('briefings', 'insert', {
      data: { id: 'b9', cliente_id: 14, conta_id: 'conta-1', title: 'Discovery', display_order: 0 },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('hub_briefing_questions', 'insert', {
      data: null,
      error: { message: 'insert failed' },
    });
    mockedSupabase.__queueSupabaseResult('briefings', 'delete', { data: null, error: null });

    await expect(store.applyTemplateToClient(14, 'conta-1', 't1')).rejects.toBeTruthy();
    expect(getCalls('briefings', 'delete').at(-1)?.modifiers).toContainEqual({
      method: 'eq',
      args: ['id', 'b9'],
    });
  });
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "applies a template"`
Expected: FAIL — `store.applyTemplateToClient is not a function`

- [ ] **Step 3: Implement `applyTemplateToClient`** — append to `hub.ts`:

```ts
/**
 * Creates a new briefing for the client and copies the template's questions into it
 * (independent copies — no propagation). If the question insert fails, the just-created
 * briefing is deleted so we never leave an empty briefing behind.
 */
export async function applyTemplateToClient(
  clienteId: number,
  contaId: string,
  templateId: string,
  titleOverride?: string,
): Promise<BriefingRow> {
  const { data: template, error: tErr } = await supabase
    .from('briefing_templates')
    .select('*')
    .eq('id', templateId)
    .single();
  if (tErr || !template) throw tErr ?? new Error('Template não encontrado.');

  const title = (titleOverride ?? '').trim() || template.title;
  const briefing = await addBriefing(clienteId, contaId, title);

  const tplQuestions: BriefingTemplateQuestion[] = template.questions ?? [];
  const rows = tplQuestions.map((q, i) => ({
    cliente_id: clienteId,
    conta_id: contaId,
    briefing_id: briefing.id,
    question: q.question,
    section: q.section ?? null,
    answer: null,
    display_order: i,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from('hub_briefing_questions').insert(rows);
    if (error) {
      await supabase.from('briefings').delete().eq('id', briefing.id);
      throw error;
    }
  }
  return briefing;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "applies a template" && npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "compensating cleanup"`
Expected: PASS (both)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/hub.ts apps/crm/src/__tests__/store.hub.test.ts
git commit -m "feat(store): applyTemplateToClient with compensating cleanup"
```

---

### Task B4: Auto-seed default template in `addCliente`

**Files:**
- Modify: `apps/crm/src/store/clients.ts`
- Test: `apps/crm/src/__tests__/store.hub.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe` block:

```ts
  it('auto-seeds a briefing from the default template on addCliente', async () => {
    mockedSupabase.__queueSupabaseResult('clientes', 'insert', {
      data: { id: 77, nome: 'Acme', conta_id: 'conta-1' },
      error: null,
    });
    // default-template lookup
    mockedSupabase.__queueSupabaseResult('briefing_templates', 'select', {
      data: { id: 't1' },
      error: null,
    });
    // applyTemplateToClient internals
    mockedSupabase.__queueSupabaseResult('briefing_templates', 'select', {
      data: { id: 't1', title: 'Discovery', questions: [{ question: 'Metas?', section: null }] },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('briefings', 'select', { data: null, error: null });
    mockedSupabase.__queueSupabaseResult('briefings', 'insert', {
      data: { id: 'b1', cliente_id: 77, conta_id: 'conta-1', title: 'Discovery', display_order: 0 },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('hub_briefing_questions', 'insert', { data: null, error: null });

    await store.addCliente({
      nome: 'Acme',
      sigla: 'AC',
      cor: '#fff',
      plano: 'pro',
      email: '',
      telefone: '',
      status: 'ativo',
      valor_mensal: 0,
    });

    expect(getCalls('hub_briefing_questions', 'insert').at(-1)?.payload).toEqual([
      {
        cliente_id: 77,
        conta_id: 'conta-1',
        briefing_id: 'b1',
        question: 'Metas?',
        section: null,
        answer: null,
        display_order: 0,
      },
    ]);
  });

  it('addCliente is a no-op for briefings when there is no default template', async () => {
    mockedSupabase.__queueSupabaseResult('clientes', 'insert', {
      data: { id: 78, nome: 'NoTpl', conta_id: 'conta-1' },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('briefing_templates', 'select', { data: null, error: null });

    await store.addCliente({
      nome: 'NoTpl',
      sigla: 'NT',
      cor: '#fff',
      plano: 'pro',
      email: '',
      telefone: '',
      status: 'ativo',
      valor_mensal: 0,
    });

    expect(getCalls('briefings', 'insert').length).toBe(0);
  });
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "auto-seeds a briefing"`
Expected: FAIL — extra/unmatched calls, because `addCliente` does not yet query `briefing_templates`.

- [ ] **Step 3: Update `addCliente`** in `apps/crm/src/store/clients.ts`. Change the import line and the function:

```ts
import { supabase, getUserId, getContaId } from './core';
import { applyTemplateToClient } from './hub';
```

```ts
export async function addCliente(
  c: Omit<Cliente, 'id' | 'user_id' | 'conta_id'>,
): Promise<Cliente> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('clientes')
    .insert({ ...c, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;

  // Auto-seed a briefing from the workspace's default template, if one is set.
  // Best-effort: a failure here must never block client creation.
  try {
    const { data: tpl } = await supabase
      .from('briefing_templates')
      .select('id')
      .eq('conta_id', conta_id)
      .eq('is_default', true)
      .maybeSingle();
    if (tpl?.id && data?.id) {
      await applyTemplateToClient(data.id, conta_id, tpl.id);
    }
  } catch (e) {
    // Browser code — no server-side observability for this.
    console.warn('[addCliente] auto-seed briefing template failed:', e);
  }

  return data;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "auto-seeds a briefing" && npx vitest run apps/crm/src/__tests__/store.hub.test.ts -t "no default template"`
Expected: PASS (both)

- [ ] **Step 5: Run the full store suite to confirm no regressions**

Run: `npm run test`
Expected: PASS (all files)

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/store/clients.ts apps/crm/src/__tests__/store.hub.test.ts
git commit -m "feat(store): addCliente auto-seeds default briefing template"
```

---

# Phase C — Edge function (TDD with Deno)

### Task C1: `hub-briefing` GET returns briefings (parent query)

**Files:**
- Modify: `supabase/functions/hub-briefing/handler.ts`
- Create: `supabase/functions/__tests__/hub-briefing_test.ts`

- [ ] **Step 1: Write the failing test** — create `supabase/functions/__tests__/hub-briefing_test.ts`:

```ts
import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubBriefingHandler } from "../hub-briefing/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-06-16T12:00:00.000Z",
  });
}

function setupToken(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
}

function getReq() {
  return new Request("https://example.test/hub-briefing?token=t", { method: "GET" });
}

Deno.test("hub-briefing GET groups questions under their briefings", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: [
      { id: "b1", title: "Onboarding", display_order: 0 },
      { id: "b2", title: "Campanha", display_order: 1 },
    ],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Marca?", answer: null, section: null, display_order: 0, briefing_id: "b1" },
      { id: "q2", question: "Verba?", answer: "1000", section: "Mídia", display_order: 0, briefing_id: "b2" },
    ],
    error: null,
  });

  const res = await makeHandler(db)(getReq());
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body, {
    briefings: [
      {
        id: "b1",
        title: "Onboarding",
        display_order: 0,
        questions: [{ id: "q1", question: "Marca?", answer: null, section: null, display_order: 0 }],
      },
      {
        id: "b2",
        title: "Campanha",
        display_order: 1,
        questions: [{ id: "q2", question: "Verba?", answer: "1000", section: "Mídia", display_order: 0 }],
      },
    ],
  });
});

Deno.test("hub-briefing GET keeps a briefing with no questions (parent query)", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: [
      { id: "b1", title: "Onboarding", display_order: 0 },
      { id: "b2", title: "Vazio", display_order: 1 },
    ],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Marca?", answer: null, section: null, display_order: 0, briefing_id: "b1" },
    ],
    error: null,
  });

  const body = await readJson(await makeHandler(db)(getReq()));
  assertEquals(body.briefings.length, 2);
  assertEquals(body.briefings[1].questions, []);
});

Deno.test("hub-briefing GET coalesces null briefing_id into the first briefing", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: [{ id: "b1", title: "Briefing", display_order: 0 }],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Legacy?", answer: null, section: null, display_order: 0, briefing_id: null },
    ],
    error: null,
  });

  const body = await readJson(await makeHandler(db)(getReq()));
  assertEquals(body.briefings[0].questions.length, 1);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-briefing_test.ts`
Expected: FAIL — current handler returns `{ questions }`, not `{ briefings }`.

- [ ] **Step 3: Rewrite the GET branch** in `supabase/functions/hub-briefing/handler.ts`. Replace the entire `if (req.method === "GET") { ... }` block (lines 24-39) with:

```ts
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("token");
      if (!token) return json({ error: "token required" }, 400);

      const hubToken = await resolveHubToken(db as any, token, deps.now());
      if (!hubToken) return json({ error: "Link inválido." }, 404);

      // Parent query: briefings drive the response so empty briefings still render.
      const { data: briefings, error: bErr } = await db
        .from("briefings")
        .select("id, title, display_order")
        .eq("cliente_id", hubToken.cliente_id)
        .order("display_order");
      if (bErr) return json({ error: bErr.message }, 500);

      const { data: questions, error: qErr } = await db
        .from("hub_briefing_questions")
        .select("id, question, answer, section, display_order, briefing_id")
        .eq("cliente_id", hubToken.cliente_id)
        .order("display_order");
      if (qErr) return json({ error: qErr.message }, 500);

      const list = (briefings ?? []) as Array<{ id: string; title: string; display_order: number }>;
      const qs = (questions ?? []) as Array<
        {
          id: string;
          question: string;
          answer: string | null;
          section: string | null;
          display_order: number;
          briefing_id: string | null;
        }
      >;
      // Legacy rows with a null briefing_id coalesce into the first briefing.
      const firstId = list[0]?.id ?? null;
      const grouped = list.map((b) => ({
        id: b.id,
        title: b.title,
        display_order: b.display_order,
        questions: qs
          .filter((q) => (q.briefing_id ?? firstId) === b.id)
          .map(({ briefing_id: _briefing_id, ...rest }) => rest),
      }));

      return json({ briefings: grouped });
    }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/hub-briefing_test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Restore deno.lock if Deno mutated it**

Run: `git status --porcelain deno.lock`
If it shows `deno.lock` as modified, run: `git checkout deno.lock && npm ci`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/hub-briefing/handler.ts supabase/functions/__tests__/hub-briefing_test.ts
git commit -m "feat(hub-briefing): GET returns briefings grouped with their questions"
```

---

# Phase D — CRM UI

> Verified by `npm run build` (tsc + vite) plus a manual smoke checklist. No component-test infra exists in this repo; follow that pattern.

### Task D1: `BriefingEditor` becomes briefing-aware

This task also changes the `addHubBriefingQuestion` store signature (adds a required `briefingId`) and updates its callers + unit test in the same commit, so the build stays green.

**Files:**
- Modify: `apps/crm/src/store/hub.ts` (signature + ordering)
- Modify: `apps/crm/src/__tests__/store.hub.test.ts` (existing briefing test)
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` (rewrite `BriefingEditor`, update imports)

- [ ] **Step 1: Change `addHubBriefingQuestion` + `getHubBriefingQuestions`** in `hub.ts`. Replace both functions with:

```ts
export async function getHubBriefingQuestions(
  clienteId: number,
): Promise<HubBriefingQuestionRow[]> {
  const { data, error } = await supabase
    .from('hub_briefing_questions')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('briefing_id')
    .order('display_order');
  if (error) throw error;
  return data ?? [];
}

export async function addHubBriefingQuestion(
  clienteId: number,
  contaId: string,
  briefingId: string,
  question: string,
  section?: string | null,
  answer?: string | null,
): Promise<void> {
  // display_order is scoped within the briefing, not the whole client.
  const { data: existing } = await supabase
    .from('hub_briefing_questions')
    .select('display_order')
    .eq('briefing_id', briefingId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (existing?.display_order ?? -1) + 1;
  const { error } = await supabase.from('hub_briefing_questions').insert({
    cliente_id: clienteId,
    conta_id: contaId,
    briefing_id: briefingId,
    question,
    display_order: nextOrder,
    section: section ?? null,
    answer: answer ?? null,
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Update the existing store test** — in `store.hub.test.ts`, the test `'handles hub briefing CRUD with display-order sequencing'` calls the old signature. Update the `addHubBriefingQuestion` call and its payload assertion:

Change the call:
```ts
    await store.addHubBriefingQuestion(14, 'conta-1', 'b1', 'Qual é a persona principal?', 'Estratégia');
```
Change the insert-payload assertion:
```ts
    expect(getCalls('hub_briefing_questions', 'insert').at(-1)?.payload).toEqual({
      cliente_id: 14,
      conta_id: 'conta-1',
      briefing_id: 'b1',
      question: 'Qual é a persona principal?',
      display_order: 4,
      section: 'Estratégia',
      answer: null,
    });
```

- [ ] **Step 3: Run the store suite, verify it passes**

Run: `npx vitest run apps/crm/src/__tests__/store.hub.test.ts`
Expected: PASS (all briefing/template tests, including the updated one)

- [ ] **Step 4: Rewrite `BriefingEditor`** in `HubTab.tsx`. First update the store import block (lines 30-50) to add the new functions/types:

```ts
import {
  getHubToken,
  createHubToken,
  setHubTokenActive,
  getHubBrand,
  upsertHubBrand,
  getHubPages,
  upsertHubPage,
  removeHubPage,
  getHubBriefingQuestions,
  addHubBriefingQuestion,
  updateHubBriefingQuestion,
  deleteHubBriefingQuestion,
  getBriefings,
  addBriefing,
  updateBriefingTitle,
  deleteBriefing,
  getIdeias,
  type Ideia,
  type HubBrandRow,
  type HubBrandFileRow,
  type HubPageRow,
  type HubBriefingQuestionRow,
} from '@/store';
```

> Note: `updateHubBriefingQuestionSection` is no longer used by the new editor (section is set when the question is created). Remove it from the import. The `useEffect` hook is already imported on line 1 (`useState, useEffect`).

- [ ] **Step 5: Replace the entire `BriefingEditor` function** (the current lines 514-806) with this implementation:

```tsx
function BriefingEditor({
  clienteId,
  contaId,
  onSaved,
}: {
  clienteId: number;
  contaId: string;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const { data: briefings = [] } = useQuery({
    queryKey: ['briefings', clienteId],
    queryFn: () => getBriefings(clienteId),
  });
  const { data: questions = [], isLoading } = useQuery({
    queryKey: ['hub-briefing-questions', clienteId],
    queryFn: () => getHubBriefingQuestions(clienteId),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [newSectionName, setNewSectionName] = useState('');
  const [addingSectionInput, setAddingSectionInput] = useState(false);
  const [newQuestions, setNewQuestions] = useState<Record<string, string>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');

  // Default selection: first briefing once loaded (or when the selected one is deleted).
  useEffect(() => {
    if (briefings.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !briefings.find((b) => b.id === selectedId)) {
      setSelectedId(briefings[0].id);
    }
  }, [briefings, selectedId]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ['briefings', clienteId] });
    qc.invalidateQueries({ queryKey: ['hub-briefing-questions', clienteId] });
    onSaved();
  }

  // Coalesce legacy null-briefing_id questions into the first briefing.
  const firstId = briefings[0]?.id ?? null;
  const briefingQuestions = questions.filter((q) => (q.briefing_id ?? firstId) === selectedId);

  async function handleCreateBriefing() {
    try {
      const b = await addBriefing(clienteId, contaId, 'Novo briefing');
      setSelectedId(b.id);
      setRenaming(true);
      setRenameText(b.title);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao criar briefing.');
    }
  }

  async function handleRenameBriefing() {
    if (!selectedId || !renameText.trim()) return;
    try {
      await updateBriefingTitle(selectedId, renameText.trim());
      setRenaming(false);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao renomear briefing.');
    }
  }

  async function handleDeleteBriefing() {
    if (!selectedId) return;
    try {
      await deleteBriefing(selectedId);
      setSelectedId(null);
      refresh();
      toast.success('Briefing removido.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover briefing.');
    }
  }

  function handleCSVImport() {
    if (!selectedId) {
      toast.error('Crie ou selecione um briefing primeiro.');
      return;
    }
    const briefingId = selectedId;
    openCSVSelector(
      async (rows) => {
        let count = 0;
        for (const row of rows) {
          if (!row.pergunta) continue;
          try {
            await addHubBriefingQuestion(
              clienteId,
              contaId,
              briefingId,
              row.pergunta.trim(),
              row.secao?.trim() || null,
              row.resposta?.trim() || null,
            );
            count++;
          } catch {
            /* skip row */
          }
        }
        if (count > 0) {
          toast.success(
            `${count} pergunta${count !== 1 ? 's' : ''} importada${count !== 1 ? 's' : ''} com sucesso!`,
          );
          refresh();
        } else {
          toast.error('Nenhuma pergunta válida encontrada. Verifique a coluna "pergunta".');
        }
      },
      (err) => toast.error(err.message),
    );
  }

  // Build ordered list of sections within the selected briefing.
  const sections: { name: string; questions: HubBriefingQuestionRow[] }[] = [];
  for (const q of briefingQuestions) {
    const name = q.section ?? '';
    const existing = sections.find((s) => s.name === name);
    if (existing) existing.questions.push(q);
    else sections.push({ name, questions: [q] });
  }
  const unsectioned = sections.find((s) => s.name === '');
  const namedSections = sections.filter((s) => s.name !== '');

  async function handleAddQuestion(section: string | null) {
    if (!selectedId) return;
    const key = section ?? '';
    const text = (newQuestions[key] ?? '').trim();
    if (!text) return;
    setAddingFor(key);
    try {
      await addHubBriefingQuestion(clienteId, contaId, selectedId, text, section);
      setNewQuestions((prev) => ({ ...prev, [key]: '' }));
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao adicionar pergunta.');
    } finally {
      setAddingFor(null);
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editText.trim()) return;
    try {
      await updateHubBriefingQuestion(id, editText.trim());
      setEditingId(null);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar pergunta.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteHubBriefingQuestion(id);
      refresh();
      toast.success('Pergunta removida.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover pergunta.');
    }
  }

  function handleAddSection() {
    const name = newSectionName.trim();
    if (!name) return;
    setNewSectionName('');
    setAddingSectionInput(false);
    setNewQuestions((prev) => ({ ...prev, [name]: '' }));
  }

  if (isLoading)
    return (
      <div className="py-8 flex justify-center">
        <div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );

  const pendingSections = Object.keys(newQuestions).filter(
    (k) => k !== '' && !namedSections.find((s) => s.name === k),
  );

  function renderQuestions(sectionQuestions: HubBriefingQuestionRow[], sectionKey: string | null) {
    return (
      <div className="space-y-2 mb-3">
        {sectionQuestions.map((q) => (
          <div key={q.id} className="border rounded-lg p-3">
            {editingId === q.id ? (
              <div className="space-y-2">
                <Input
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit(q.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleSaveEdit(q.id)}>
                    <Save size={14} className="mr-1.5" /> Salvar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{q.question}</p>
                  {q.answer ? (
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                      {q.answer}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1 italic">Sem resposta ainda</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(q.id);
                      setEditText(q.question);
                    }}
                  >
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(q.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            value={newQuestions[sectionKey ?? ''] ?? ''}
            onChange={(e) =>
              setNewQuestions((prev) => ({ ...prev, [sectionKey ?? '']: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddQuestion(sectionKey);
            }}
            placeholder="Nova pergunta..."
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={() => handleAddQuestion(sectionKey)}
            disabled={
              addingFor === (sectionKey ?? '') || !(newQuestions[sectionKey ?? ''] ?? '').trim()
            }
          >
            <Plus size={14} className="mr-1.5" /> Adicionar
          </Button>
        </div>
      </div>
    );
  }

  const selectedBriefing = briefings.find((b) => b.id === selectedId) ?? null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-semibold">Briefings</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            data-tooltip="Colunas: pergunta*, secao, resposta"
            data-tooltip-dir="bottom"
            style={{ display: 'flex' }}
          >
            <HelpCircle className="h-4 w-4 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
          <Button size="sm" variant="outline" onClick={handleCreateBriefing}>
            <Plus size={14} className="mr-1.5" /> Novo briefing
          </Button>
          <Button size="sm" variant="outline" onClick={handleCSVImport} disabled={!selectedId}>
            <Upload size={14} className="mr-1.5" /> Importar CSV
          </Button>
        </div>
      </div>

      {/* Briefing tabs */}
      {briefings.length > 0 && (
        <div className="flex gap-1 mb-4 border-b overflow-x-auto">
          {briefings.map((b) => (
            <button
              key={b.id}
              onClick={() => {
                setSelectedId(b.id);
                setRenaming(false);
              }}
              className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                selectedId === b.id
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {b.title}
            </button>
          ))}
        </div>
      )}

      {!selectedBriefing ? (
        <p className="text-sm text-muted-foreground py-6">
          Nenhum briefing ainda. Crie um com “Novo briefing”.
        </p>
      ) : (
        <>
          {/* Selected briefing header: rename / delete */}
          <div className="flex items-center justify-between gap-2 mb-3">
            {renaming ? (
              <div className="flex gap-2 flex-1">
                <Input
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameBriefing();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  autoFocus
                  className="flex-1"
                />
                <Button size="sm" onClick={handleRenameBriefing}>
                  <Save size={14} className="mr-1.5" /> Salvar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRenaming(false)}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold">{selectedBriefing.title}</p>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRenaming(true);
                      setRenameText(selectedBriefing.title);
                    }}
                  >
                    <Pencil size={14} className="mr-1.5" /> Renomear
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleDeleteBriefing}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Unsectioned questions */}
          {(unsectioned || namedSections.length === 0) && (
            <div className="mb-6">{renderQuestions(unsectioned?.questions ?? [], null)}</div>
          )}

          {/* Named sections */}
          {namedSections.map((s) => (
            <div key={s.name} className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {s.name}
              </p>
              {renderQuestions(s.questions, s.name)}
            </div>
          ))}

          {/* Pending (not yet saved) sections */}
          {pendingSections.map((name) => (
            <div key={name} className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {name}
              </p>
              {renderQuestions([], name)}
            </div>
          ))}

          {/* Add section */}
          {addingSectionInput ? (
            <div className="flex gap-2 mt-2">
              <Input
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSection();
                  if (e.key === 'Escape') {
                    setAddingSectionInput(false);
                    setNewSectionName('');
                  }
                }}
                placeholder="Nome da seção..."
                className="flex-1"
                autoFocus
              />
              <Button size="sm" onClick={handleAddSection} disabled={!newSectionName.trim()}>
                Criar seção
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAddingSectionInput(false);
                  setNewSectionName('');
                }}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAddingSectionInput(true)}>
              <Plus size={14} className="mr-1.5" /> Nova seção
            </Button>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Typecheck + build**

Run: `npm run build`
Expected: PASS (no TS errors). If tsc complains that `updateHubBriefingQuestionSection` is unused/missing, confirm it was removed from the import in Step 4.

- [ ] **Step 7: Manual smoke check**

Run: `npm run dev` (CRM), open a client detail page → Hub tab → Briefing. Verify:
- Existing clients show their questions under an untitled ("Sem título") tab they can rename (migrated default).
- "Novo briefing" creates a tab and drops you into rename mode.
- Adding/editing/deleting questions and sections works within the selected briefing.
- "Importar CSV" is disabled until a briefing is selected and imports into the selected one.

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/store/hub.ts apps/crm/src/__tests__/store.hub.test.ts apps/crm/src/pages/cliente-detalhe/HubTab.tsx
git commit -m "feat(crm): briefing-aware BriefingEditor + per-briefing question ordering"
```

---

### Task D2: Templates modal + "Usar template" picker

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/BriefingTemplatesModal.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` (wire the modal + picker into `BriefingEditor`)

- [ ] **Step 1: Create `BriefingTemplatesModal.tsx`** with this content:

```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Star, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getBriefingTemplates,
  addBriefingTemplate,
  updateBriefingTemplate,
  removeBriefingTemplate,
  setDefaultBriefingTemplate,
  type BriefingTemplateRow,
  type BriefingTemplateQuestion,
} from '@/store';

interface DraftQuestion extends BriefingTemplateQuestion {}

export function BriefingTemplatesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ['briefing-templates'],
    queryFn: getBriefingTemplates,
  });

  // null = list view; 'new' = creating; otherwise editing an existing id.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [saving, setSaving] = useState(false);

  function refresh() {
    qc.invalidateQueries({ queryKey: ['briefing-templates'] });
  }

  function startNew() {
    setEditing('new');
    setTitle('');
    setQuestions([]);
  }

  function startEdit(t: BriefingTemplateRow) {
    setEditing(t.id);
    setTitle(t.title);
    setQuestions((t.questions ?? []).map((q) => ({ question: q.question, section: q.section ?? null })));
  }

  function addRow() {
    setQuestions((prev) => [...prev, { question: '', section: null }]);
  }

  function updateRow(i: number, patch: Partial<DraftQuestion>) {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  function removeRow(i: number) {
    setQuestions((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      toast.error('Dê um título ao template.');
      return;
    }
    const cleanQuestions = questions
      .map((q) => ({ question: q.question.trim(), section: q.section?.trim() || null }))
      .filter((q) => q.question.length > 0);
    setSaving(true);
    try {
      if (editing === 'new') {
        await addBriefingTemplate({ title: cleanTitle, questions: cleanQuestions });
        toast.success('Template criado!');
      } else if (editing) {
        await updateBriefingTemplate(editing, { title: cleanTitle, questions: cleanQuestions });
        toast.success('Template atualizado!');
      }
      setEditing(null);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar template.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await removeBriefingTemplate(id);
      refresh();
      toast.success('Template removido.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover template.');
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await setDefaultBriefingTemplate(id);
      refresh();
      toast.success('Template padrão definido. Novos clientes começarão com ele.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao definir template padrão.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Templates de Briefing</DialogTitle>
        </DialogHeader>

        {editing === null ? (
          <div className="space-y-3">
            <Button size="sm" onClick={startNew}>
              <Plus size={14} className="mr-1.5" /> Novo template
            </Button>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhum template ainda.</p>
            ) : (
              <div className="space-y-2">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center justify-between border rounded-lg p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {t.title}
                        {t.is_default && (
                          <span className="ml-2 text-xs text-primary font-semibold">(padrão)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(t.questions ?? []).length} pergunta
                        {(t.questions ?? []).length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSetDefault(t.id)}
                        title="Definir como padrão"
                      >
                        <Star
                          size={14}
                          className={t.is_default ? 'fill-primary text-primary' : ''}
                        />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => startEdit(t)}>
                        <Pencil size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(t.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título do template (ex: Onboarding)"
            />
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={q.question}
                    onChange={(e) => updateRow(i, { question: e.target.value })}
                    placeholder="Pergunta..."
                    className="flex-1"
                  />
                  <Input
                    value={q.section ?? ''}
                    onChange={(e) => updateRow(i, { section: e.target.value })}
                    placeholder="Seção (opcional)"
                    className="w-40"
                  />
                  <Button size="sm" variant="ghost" onClick={() => removeRow(i)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus size={14} className="mr-1.5" /> Adicionar pergunta
              </Button>
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save size={14} className="mr-1.5" /> Salvar template
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire the modal + picker into `BriefingEditor`** in `HubTab.tsx`.

Add these imports to the `@/store` import block (alongside `getBriefings` etc.):
```ts
  getBriefingTemplates,
  applyTemplateToClient,
```

Add the component import near the top of `HubTab.tsx` (after the other component imports, e.g. after the `IdeiaStatusBadge` import):
```ts
import { BriefingTemplatesModal } from './BriefingTemplatesModal';
```

Inside `BriefingEditor`, add a templates query and modal state (next to the other `useState`s):
```ts
  const { data: templates = [] } = useQuery({
    queryKey: ['briefing-templates'],
    queryFn: getBriefingTemplates,
  });
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [applying, setApplying] = useState(false);
```

Add the apply handler (next to the other handlers):
```ts
  async function handleApplyTemplate(templateId: string) {
    setApplying(true);
    try {
      const b = await applyTemplateToClient(clienteId, contaId, templateId);
      setSelectedId(b.id);
      refresh();
      toast.success('Template aplicado! Ajuste as perguntas como quiser.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao aplicar template.');
    } finally {
      setApplying(false);
    }
  }
```

In the header actions `<div className="flex items-center gap-2 flex-wrap">`, add a native template picker and a "Templates" button (between the "Novo briefing" and "Importar CSV" buttons):
```tsx
          <select
            className="form-input text-xs h-8"
            value=""
            disabled={applying || templates.length === 0}
            onChange={(e) => {
              if (e.target.value) handleApplyTemplate(e.target.value);
              e.currentTarget.value = '';
            }}
          >
            <option value="">Usar template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({(t.questions ?? []).length})
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)}>
            Templates
          </Button>
```

Render the modal at the end of the `BriefingEditor` return, just before the closing `</section>`:
```tsx
      <BriefingTemplatesModal open={templatesOpen} onOpenChange={setTemplatesOpen} />
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: PASS (no TS errors).

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`, open a client → Hub → Briefing. Verify:
- "Templates" opens the modal; create a template with a couple of questions (one with a section); mark one as default (star fills, label shows "(padrão)").
- Back in the editor, "Usar template…" lists templates; selecting one creates a new briefing tab populated with the template's questions; edit one to confirm the template is unchanged (independent copy).
- Create a new client (Clientes page) and confirm it arrives with a briefing seeded from the default template.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/BriefingTemplatesModal.tsx apps/crm/src/pages/cliente-detalhe/HubTab.tsx
git commit -m "feat(crm): briefing templates modal + apply-template picker"
```

---

# Phase E — Hub (client-facing)

### Task E1: Hub types, API, and `BriefingPage` briefing tabs

**Files:**
- Modify: `apps/hub/src/types.ts`
- Modify: `apps/hub/src/api.ts`
- Modify: `apps/hub/src/pages/BriefingPage.tsx`

- [ ] **Step 1: Add the `Briefing` type** in `apps/hub/src/types.ts`, right after the existing `BriefingQuestion` interface:

```ts
export interface Briefing {
  id: string;
  title: string;
  display_order: number;
  questions: BriefingQuestion[];
}
```

- [ ] **Step 2: Update `fetchBriefing`** in `apps/hub/src/api.ts`. Add `Briefing` to the type import from `./types`, then change the function:

```ts
export function fetchBriefing(token: string) {
  return get<{ briefings: Briefing[] }>('hub-briefing', { token });
}
```

(Leave `submitBriefingAnswer` unchanged.)

- [ ] **Step 3: Rewrite `BriefingPage.tsx`** — replace the whole file with:

```tsx
import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchBriefing, submitBriefingAnswer } from '../api';
import type { BriefingQuestion } from '../types';

export function BriefingPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-briefing', token],
    queryFn: () => fetchBriefing(token),
  });

  const [briefingTab, setBriefingTab] = useState(0);
  const [sectionTab, setSectionTab] = useState(0);

  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
      </div>
    );

  const briefings = data?.briefings ?? [];

  if (briefings.length === 0)
    return <div className="py-8 text-stone-500 text-sm">Nenhum briefing disponível ainda.</div>;

  const hasBriefingTabs = briefings.length > 1;
  const activeBriefing = briefings[Math.min(briefingTab, briefings.length - 1)];
  const questions = activeBriefing?.questions ?? [];

  // Group the active briefing's questions by section.
  const sections: { name: string; questions: BriefingQuestion[] }[] = [];
  for (const q of questions) {
    const name = q.section ?? 'Geral';
    const existing = sections.find((s) => s.name === name);
    if (existing) existing.questions.push(q);
    else sections.push({ name, questions: [q] });
  }

  const hasSectionTabs = sections.length > 1;
  const visibleQuestions = hasSectionTabs
    ? (sections[Math.min(sectionTab, sections.length - 1)]?.questions ?? [])
    : questions;

  function handleSave(questionId: string) {
    return async (answer: string) => {
      await submitBriefingAnswer(token, questionId, answer);
      qc.invalidateQueries({ queryKey: ['hub-briefing', token] });
    };
  }

  return (
    <div className="max-w-3xl mx-auto hub-fade-up">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          <span className="accent-bar" />
          Seu projeto
        </p>
        <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900">
          Briefing
        </h2>
      </header>

      {hasBriefingTabs && (
        <div className="relative mb-6 border-b border-stone-200/80">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {briefings.map((b, i) => (
              <button
                key={b.id}
                onClick={() => {
                  setBriefingTab(i);
                  setSectionTab(0);
                }}
                className={`relative px-4 py-3 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                  briefingTab === i ? 'text-stone-900' : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {b.title}
                {briefingTab === i && (
                  <span className="absolute left-3 right-3 -bottom-[1px] h-[2px] rounded-full bg-[#FFBF30]" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasSectionTabs && (
        <div className="relative mb-8 border-b border-stone-200/80">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {sections.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setSectionTab(i)}
                className={`relative px-4 py-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
                  sectionTab === i ? 'text-stone-900' : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {s.name}
                {sectionTab === i && (
                  <span className="absolute left-3 right-3 -bottom-[1px] h-[2px] rounded-full bg-stone-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {visibleQuestions.length === 0 ? (
        <div className="py-8 text-stone-500 text-sm">Nenhuma pergunta neste briefing ainda.</div>
      ) : (
        <div className="space-y-4">
          {visibleQuestions.map((q) => (
            <QuestionItem
              key={q.id}
              question={q.question}
              initialAnswer={q.answer}
              onSave={handleSave(q.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionItem({
  question,
  initialAnswer,
  onSave,
}: {
  question: string;
  initialAnswer: string | null;
  onSave: (answer: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState(initialAnswer ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (value: string) => {
      setAnswer(value);
      setStatus('saving');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          await onSave(value);
          setStatus('saved');
          setTimeout(() => setStatus('idle'), 2000);
        } catch {
          setStatus('idle');
        }
      }, 800);
    },
    [onSave],
  );

  return (
    <div className="hub-card p-5 sm:p-6 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-semibold text-stone-900 leading-snug">{question}</p>
        <span className="shrink-0 text-[11px] font-medium min-w-[56px] text-right">
          {status === 'saving' && <span className="text-stone-400">Salvando…</span>}
          {status === 'saved' && <span className="text-emerald-600">✓ Salvo</span>}
        </span>
      </div>
      <textarea
        className="w-full border border-stone-200/80 rounded-lg px-3.5 py-3 text-[14px] resize-none min-h-[112px] bg-stone-50/40 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-[#FFBF30]/15 transition-all"
        value={answer}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Digite sua resposta…"
      />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + build the Hub app**

Run: `npm run build:hub`
Expected: PASS (no TS errors).

- [ ] **Step 5: Manual smoke check**

With the edge function running locally (`npx supabase functions serve hub-briefing`) and `npm run dev:hub`, open a client's hub link → Briefing. Verify:
- Multiple briefings show as top tabs; switching tabs swaps the questions and resets the section sub-tabs.
- Within a briefing, multiple sections show as sub-tabs; a single-section briefing shows no sub-tab bar.
- Answering a question debounce-saves ("Salvando…" → "✓ Salvo").

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts apps/hub/src/pages/BriefingPage.tsx
git commit -m "feat(hub): briefing tabs on the client-facing Briefing page"
```

---

# Phase F — Full verification

### Task F1: Run all gates (matches CI)

> CI enforces eslint, prettier `format:check`, the Vitest suite (with coverage ratchet), and the Deno edge tests. Run them locally before pushing.

- [ ] **Step 1: Format**

Run: `npm run format`
Then re-stage any files Prettier touched.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Unit tests**

Run: `npm run test`
Expected: PASS (all files).

- [ ] **Step 4: Edge tests**

Run: `npm run test:functions`
Expected: PASS, including `hub-briefing_test.ts`.

- [ ] **Step 5: Restore deno.lock if Deno mutated it**

Run: `git status --porcelain deno.lock`
If modified: `git checkout deno.lock && npm ci`

- [ ] **Step 6: Builds**

Run: `npm run build && npm run build:hub`
Expected: both PASS.

- [ ] **Step 7: Commit any formatting changes**

```bash
git add -A
git commit -m "chore: format + lint pass for briefing templates" || echo "nothing to commit"
```

---

## Deployment (manual, after merge — not part of TDD loop)

Follow the spec's rollout order exactly (backward-compatibility is the constraint):

1. **Migrations first** (`briefing_id` stays nullable): `npx supabase db push --linked` — **dry-run against staging first**, verify, then prod. This is safe against old cached CRM bundles (their inserts omit `briefing_id` → NULL, coalesced on read).
2. **Deploy together:** the CRM build (Vercel), the Hub build (Vercel), and the edge function: `npx supabase functions deploy hub-briefing`. The GET contract changes from `{ questions }` to `{ briefings }`, so the function and Hub must go out in the same release.
3. **Deferred hardening (later release):** once no old CRM bundles remain, add a follow-up migration to backfill any straggler `NULL` `briefing_id` rows and apply `NOT NULL`.

---

## Spec coverage check

- `briefings` table → A1 ✓
- nullable `briefing_id` + backfill → A2 ✓
- `briefing_templates` + one-default index + `set_default_briefing_template` RPC → A3 ✓
- store types + briefings CRUD → B1 ✓
- templates CRUD + set-default via RPC → B2 ✓
- `applyTemplateToClient` (bulk insert + compensating delete, independent copies) → B3 ✓
- `addCliente` auto-seed default (console.warn, best-effort) → B4 ✓
- `addHubBriefingQuestion` requires `briefingId`, order within briefing; `getHubBriefingQuestions` ordering → D1 ✓
- edge GET parent query from `briefings`, coalesce NULL, keep empty briefings → C1 ✓
- CRM `BriefingEditor` briefing-aware (tabs, novo briefing, rename/delete, CSV into selected, `getBriefings` drives tab state) → D1 ✓
- "Usar template" picker + manage-templates modal + default ⭐ → D2 ✓
- Hub `Briefing` type, `fetchBriefing` returns `{ briefings }`, briefing tabs + sections → E1 ✓
- Tests (store + deno) → B/C/D ✓
- Rollout/deploy ordering → Deployment section ✓
