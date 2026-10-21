# Default fluxo template on signup + always-on board tab strip with "+"

## Context

New accounts get confused by "fluxos" (workflows) and "templates" because a brand-new
workspace starts with zero workflow templates and no visible affordance explaining the
concept. This plan does two things:

1. **Seeds every workspace with a default workflow template** ("Padrão": Copy →
   Aprovação da Copy → Mídia → Aprovação da Mídia → Agendamento) — for new signups, and
   backfilled once for existing workspaces that currently have zero templates.
2. **Makes the Fluxos board's template tab strip always visible** (today it only
   appears with 2+ templates), with a trailing "+" tab so creating a second template is
   discoverable directly from the board, not just from the header's "Templates" button.

All research is against `origin/main` (tip `6caac8a1` at plan time). This branch was
created fresh from that tip.

A UI mockup of the tab-strip change (before/after, light+dark, "+" opening the existing
"Gerenciar Templates" modal) was reviewed and approved with the product owner during
planning, in chat — not committed to the repo.

## Global Constraints

These bind every task below; the task reviewer uses this list as its attention lens.

- Seed scope: new signups **and** a one-time backfill for existing empty workspaces.
- "+" tab always sits **last**, after every real template tab.
- Seeded template is a **fully normal** template — editable, renamable, deletable. No new
  "locked"/"is_default" column or flag anywhere.
- "+" **opens the existing "Gerenciar Templates" modal** (`TemplatesModal`) unchanged —
  no inline quick-create, no redesign of that modal's internals.
- The existing header "Templates" button stays too — two entry points is intentional.
- **Out of scope, do not touch:** `ExampleBoard.tsx` and `exampleGate.ts`'s
  `activeBoardCount === 0` gating. A genuinely brand-new workspace (zero real workflows)
  still sees the existing static demo board, not the new tab strip.
- **Free plan's `max_workflow_templates` stays at 1** (confirmed in `supabase/seed.sql:18`).
  The seeded template consumes that slot, so the "+" tab must be **pre-emptively
  disabled** (not click-then-fail) for workspaces at their template limit, using the
  app's existing disable-button-with-tooltip convention (see `ClientesPage.tsx`'s
  `clientsAtLimit` pattern) — not a new dialog, not a toast-on-click.
- **A signup must never fail because of the seed insert.** `handle_new_user_workspace()`
  runs `AFTER INSERT ON auth.users`; any unhandled exception inside it aborts the whole
  signup. `effective_plan_limit()` (called by the `max_workflow_templates` count trigger)
  fails closed to `0` in several reachable cases (no `is_default` plan, malformed
  workspace override, unknown workspace) — so the seed INSERT must be wrapped in its own
  `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING ... END;` block. This is not
  optional and must not be simplified away.
- Migration filenames must use the `202609200000N` prefix family below — later than and
  distinct from the current tip (`20260919000008`).

---

## Task 1: Seed the default template on signup (migration + entitlement tests)

### Etapas literal (also used by Task 2 — keep both copies byte-identical)

Mirrors the `'aprovacao-dupla'` preset's field conventions
(`apps/crm/src/pages/entregas/wizard/presets.ts:20-29,53-68`): content steps
`uteis`/`padrao`, approval steps `corridos`/`aprovacao_cliente`. Matches the
`WorkflowTemplateEtapa` TS type (`apps/crm/src/store/workflows.ts:9-14`).

```json
[
  {"nome":"Copy","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
  {"nome":"Aprovação da Copy","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
  {"nome":"Mídia","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
  {"nome":"Aprovação da Mídia","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
  {"nome":"Agendamento","prazo_dias":1,"tipo_prazo":"uteis","tipo":"padrao"}
]
```
Template `nome`: `"Padrão"`. `modo_prazo`: `'padrao'` (set explicitly, not relying on the
column default).

### What to build

Create `supabase/migrations/20260920000001_seed_default_workflow_template.sql`
containing `CREATE OR REPLACE FUNCTION public.handle_new_user_workspace()`.

1. Read the current definition in full: `supabase/migrations/20260719000002_signup_marketing_opt_in.sql`
   (the function body spans roughly lines 11-133 of that file — read the whole file to be
   sure you have the exact current boundaries).
2. Copy that function body **verbatim** into the new migration — every column, every
   branch, the invited-user branch's `FOR UPDATE` invite lock, everything. Do not
   paraphrase or "clean up" anything while copying.
3. Add exactly one new block, placed **after** the `INSERT INTO workspace_members (...)`
   statement, and **only inside the fresh-signup / owner branch** (the `ELSE` branch that
   runs when the signup is NOT an invited user joining an existing workspace — do not add
   anything to the invited-user branch, which joins a workspace that may already have
   templates):

```sql
    -- Seed the workspace's first workflow template ("Padrão"). Fully normal, editable,
    -- deletable — no locked flag. Wrapped because this runs inside an AFTER INSERT ON
    -- auth.users trigger: any unhandled exception here would abort the signup itself.
    -- trg_limit_templates can legitimately raise (effective_plan_limit fails closed to 0
    -- when there's no is_default plan, or a 0/malformed workspace override) — a signup
    -- must never fail because of this convenience seed.
    BEGIN
      INSERT INTO workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
      VALUES (
        NEW.id,
        ws_id,
        'Padrão',
        '[
          {"nome":"Copy","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
          {"nome":"Aprovação da Copy","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
          {"nome":"Mídia","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
          {"nome":"Aprovação da Mídia","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
          {"nome":"Agendamento","prazo_dias":1,"tipo_prazo":"uteis","tipo":"padrao"}
        ]'::jsonb,
        'padrao'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'default workflow template seed skipped for workspace %: %', ws_id, SQLERRM;
    END;
```

Use whatever the local variable name for the new workspace's id actually is in the
current function body (it was `ws_id` at research time — confirm and match exactly; do
not introduce a new variable).

4. **Do not** add `handle_new_user_workspace` to
   `supabase/migrations/20260720000004_reconcile_prod_missing_functions.sql`'s exclusion
   list — that migration already deliberately excludes it as "already current". Leave
   that file untouched.
5. Before committing, run `diff` between the function body in
   `20260719000002_signup_marketing_opt_in.sql` and the new migration's function body
   (minus your one added block) — they must be identical.

### Tests to write

New file `supabase/tests/entitlements/93_default_workflow_template_seed.sql`. Follow the
structure of `supabase/tests/entitlements/05_more_count_limits.sql` (the `\set
ON_ERROR_STOP on`, `\i _helpers.sql`, transactional `begin ... do $$ ... $$; rollback;`
pattern — read that file first as your template). Three cases in this task (a fourth,
for the backfill migration, is added in Task 2 to the same file if it doesn't exist yet,
or you may create the file now with a placeholder comment marking where Task 2's case
goes — coordinate via the file, whichever lands first creates it):

1. **Fresh signup seeds exactly one template.** Insert a row into `auth.users` with
   `raw_user_meta_data` shaped like a fresh (non-invited) signup (check
   `20260719000002_signup_marketing_opt_in.sql` for what fields it reads — likely an
   `empresa`/company-name field and no `conta_id`). Assert: exactly 1 row in
   `workflow_templates` for the new workspace's `conta_id`; `nome = 'Padrão'`;
   `jsonb_array_length(etapas) = 5`; `etapas->0->>'nome' = 'Copy'`;
   `etapas->4->>'nome' = 'Agendamento'`; `etapas->1->>'tipo' = 'aprovacao_cliente'`;
   `modo_prazo = 'padrao'`.
2. **Invited-user signup seeds nothing.** Set up a conta/workspace + owner profile + a
   pending `invites` row (check existing entitlement tests for how they construct an
   invite fixture — several suites already do this), then insert an `auth.users` row
   whose `raw_user_meta_data` carries that `conta_id` (the invited-user shape). Assert
   the workspace's `workflow_templates` count is unchanged by this insert.
3. **A workspace with no resolvable plan limit does not break signup.** Temporarily
   `update plans set is_default = false` inside the test's transaction so
   `effective_plan_limit()` returns 0 for the new (NULL `plan_id`) workspace. Insert a
   fresh (non-invited) `auth.users` row. Assert the insert **succeeds** (no exception
   propagates) and the new workspace ends up with 0 `workflow_templates` rows (the seed
   was attempted, failed closed, and was caught). This is the regression test for the
   signup-must-never-fail constraint — it is the most important test in this task.

Run this suite locally against a fresh `supabase db reset` (Docker required) before
reporting done; if Docker isn't available in your environment, say so clearly in your
report along with the exact command you were unable to run, rather than skipping
verification silently.

### Report

DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, the migration file path, the test
file path, and the command + output you used to verify (or a clear note if Docker was
unavailable).

---

## Task 2: Backfill existing workspaces with zero templates (migration + entitlement test)

Depends on Task 1 only for the shared etapas literal (already given below, no need to
read Task 1's diff) — this task can be implemented independently.

### What to build

Create `supabase/migrations/20260920000002_backfill_default_workflow_template.sql`:

```sql
-- Backfill "Padrão" into every workspace with no workflow_templates at all. Idempotent
-- (NOT EXISTS makes a re-run a no-op); a workspace with ANY existing template (even a
-- user-made one) is never touched. Iterates `workspaces` (not `contas`) because
-- effective_plan_limit() resolves the plan from `workspaces` and returns 0 for an id it
-- can't find there. Runs as `postgres`, which bypasses RLS but not triggers, so
-- trg_limit_templates still fires per row — the predicate below pre-filters out rows
-- that would be rejected rather than fighting the trigger.
insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
select
  coalesce(
    (select p.id from profiles p where p.conta_id = w.id and p.role = 'owner'::user_role
      order by p.created_at limit 1),
    w.created_by
  ),
  w.id,
  'Padrão',
  '[
    {"nome":"Copy","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
    {"nome":"Aprovação da Copy","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
    {"nome":"Mídia","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
    {"nome":"Aprovação da Mídia","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
    {"nome":"Agendamento","prazo_dias":1,"tipo_prazo":"uteis","tipo":"padrao"}
  ]'::jsonb,
  'padrao'
from workspaces w
where not exists (select 1 from workflow_templates t where t.conta_id = w.id)
  and coalesce(
        (select p.id from profiles p where p.conta_id = w.id and p.role = 'owner'::user_role
          order by p.created_at limit 1),
        w.created_by
      ) is not null  -- workflow_templates.user_id is NOT NULL; skip rows we can't resolve
  and (
        effective_plan_limit(w.id, 'max_workflow_templates') is null  -- unlimited
        or effective_plan_limit(w.id, 'max_workflow_templates') > 0
      );
```

Before writing the file, confirm the exact column names on `profiles` (`conta_id`,
`role`, `created_at`) and on `workspaces` (`created_by`) by reading the current schema —
`profiles.role` is an enum (`user_role`), confirm `'owner'` is a valid member. Do not
disable `trg_limit_templates` for this migration — the predicate above is designed to
make disabling it unnecessary.

### Test to write

Add a fourth case to `supabase/tests/entitlements/93_default_workflow_template_seed.sql`
(create the file per the `05_more_count_limits.sql` pattern if Task 1 hasn't landed it
yet — check first):

4. **Backfill is idempotent and selective.** Create a workspace + owner profile with zero
   `workflow_templates` rows, run the backfill INSERT statement, assert exactly 1 row
   ("Padrão", 5 etapas) now exists for it. Run the exact same INSERT statement again,
   assert still exactly 1 row (no duplicate). Separately, create a second workspace that
   already has one user-made template before running the backfill, assert the backfill
   leaves it with exactly that one template (unchanged, not a second "Padrão" added).

Run the suite locally against a fresh `supabase db reset` before reporting done, same
caveat as Task 1 if Docker is unavailable.

### Report

DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, the migration file path, confirmation
of which test case(s) you added, and verification command + output.

---

## Task 3: Always-on board tab strip with a trailing "+" tab (KanbanView.tsx + style.css)

### What to build

File: `apps/crm/src/pages/entregas/views/KanbanView.tsx`.

1. Find the `KanbanViewBaseProps` interface (starts around line 89) and add two new
   **optional** props next to the existing `onAddWorkflow?` prop:

```ts
  /** Opens the existing "Gerenciar Templates" modal from the board's trailing "+" tab. */
  onCreateTemplate?: () => void;
  /** True when the workspace is at its plan's max_workflow_templates limit — the "+"
   *  tab renders disabled with a tooltip instead of calling onCreateTemplate. */
  createTemplateDisabled?: boolean;
```

  Destructure both in the component's props (alongside where `onAddWorkflow` is
  destructured).

2. Find the `TABS_THRESHOLD` constant (around line 390) and its one usage building
   `useTabs` (around line 1328, currently `boardRows.length > TABS_THRESHOLD`). Delete
   the constant. Change the `useTabs` line to:

```ts
  // The tab strip is always on: with one template it's a single tab plus the trailing
  // "+", which is how a second template gets created.
  const useTabs = boardRows.length >= 1;
```

3. Find the conditional render block just below (`{useTabs && activeRow ? ( ... ) : (
   ... )}`, roughly lines 1345-1367). Because `useTabs` is now true whenever
   `boardRows.length >= 1`, and the empty-board case is already handled by an earlier
   early-return elsewhere in this file (search for
   `localCards.length === 0 && posts.length === 0` — it renders `ExampleBoard`, which you
   must NOT touch), the `else` branch that renders bare stacked rows
   (`boardRows.map((row) => <div key={row.key}>{renderRowBoard(row)}</div>)`) can never
   execute anymore. Delete that `else` branch entirely; keep the `activeRow &&` guard (or
   equivalent) around the remaining tabs-render path defensively, in case `boardRows` is
   ever empty at this point despite the earlier early return.

4. Inside the `.board-tabs` div, after the existing `boardRows.map(...)` that renders
   each real template tab, add the trailing "+" button — it must render after every real
   tab so it's always last:

```tsx
{onCreateTemplate && (
  <button
    type="button"
    className="board-tab board-tab-add"
    aria-label="Novo template"
    title={createTemplateDisabled ? 'Limite do plano atingido' : 'Novo template'}
    disabled={createTemplateDisabled}
    onClick={onCreateTemplate}
  >
    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
  </button>
)}
```

  `Plus` from `lucide-react` is already imported in this file (used elsewhere for a
  `.board-add-card` button) — do not add a new import; if you can't find an existing
  `Plus` import, search the file again before adding one, it's there.

  Important: this button must **not** have `role="tab"` or `aria-selected` — it's an
  action button living inside a `role="tablist"` container, not a selectable tab panel.
  It's deliberately not part of `boardRows`, so the existing `activeRowKey` state can
  never select it and the active-tab CSS ("Chrome flare" pseudo-elements) never applies
  to it.

File: `apps/crm/style.css`.

5. Find the `.board-tabs` rule (around line 5300-5313) and its preceding comment, which
   currently says the strip shows "instead of stacked rows when 3+ templates are active"
   (already stale before this change — the actual code path was 2+). Update the comment
   to say the strip is now always shown, with a trailing "+" tab for creating a new
   template.
6. Add a new rule after the existing `.board-tab-count` rule (around line 5380-5386),
   using this file's existing legacy hex-token system (`--primary-color`,
   `--primary-hover`, `--surface-hover`, `--text-muted` — NOT the shadcn HSL tokens,
   which this section of the file doesn't use):

```css
/* Trailing "+" tab: an action, not a tab. Icon only, never active, so it keeps the
 * strip's chrome shape without the count badge or uppercase text. */
.board-tab-add {
  padding: 0.55rem 0.8rem;
  color: var(--primary-color);
  text-transform: none;
  letter-spacing: 0;
  flex: 0 0 auto;
}

.board-tab-add:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--primary-hover);
}

.board-tab-add:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}
```

### Tests to write

New file `apps/crm/src/pages/entregas/views/__tests__/KanbanTabs.test.tsx`. Reuse the
`render()` wrapper (React Testing Library + `QueryClientProvider`) and the
`boardProps()`/fixture-building helper from
`apps/crm/src/pages/entregas/views/__tests__/KanbanSync.test.tsx` (read that file first,
copy its setup pattern rather than reinventing it). Cases:

1. With exactly one board row (one card using one template), the tab strip renders:
   `container.querySelectorAll('.board-tab:not(.board-tab-add)')` has length 1, and the
   board's columns still render underneath.
2. With `onCreateTemplate` provided, the "+" tab is present
   (`screen.getByLabelText('Novo template')`) and clicking it calls the spy exactly once.
3. With 2+ board rows (two cards using two different templates), the "+" tab is the last
   child of `.board-tabs` — assert on `[...container.querySelectorAll('.board-tabs >
   button')].at(-1)` having class `board-tab-add`, with the real template tabs before it.
4. With `onCreateTemplate` omitted, no `.board-tab-add` element renders at all (guards
   backward compatibility with every existing fixture that doesn't pass it).
5. The "+" button does not have `role="tab"`.
6. With `createTemplateDisabled` true, the "+" button is disabled
   (`expect(addBtn).toBeDisabled()`) and its `title` reads "Limite do plano atingido";
   clicking it does not call `onCreateTemplate`.

Also **run the full existing Kanban test suite**
(`apps/crm/src/pages/entregas/views/__tests__/Kanban*.test.tsx`) and confirm nothing
regresses. None of those files currently assert "no tab strip at 1 template" (you can
verify with `git grep -n "board-tab" apps/crm/src/pages/entregas/views/__tests__/`), so
they should be unaffected — but you must actually run them and confirm, not just assume.
If any existing test does break, read it, understand why, and report the specific
assertion and file in your report rather than silently changing that test's expectations.

### Report

DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, files changed, the new test file
path, and the full test command + output (both the new file and the full existing Kanban
suite).

---

## Task 4: Wire EntregasPage → KanbanView (entitlements gating + prop threading)

Depends on Task 3's new `KanbanView` props (`onCreateTemplate`, `createTemplateDisabled`)
already existing. If Task 3 hasn't landed yet in this branch when you start, say so in
your report and stop rather than guessing at the prop names/types.

### What to build

File: `apps/crm/src/pages/entregas/EntregasPage.tsx`.

1. Find the existing `useEntitlements()` usage pattern in this codebase — it's already
   used elsewhere (e.g. `apps/crm/src/pages/clientes/ClientesPage.tsx`, look for
   `isAtLimit('max_clients', ...)` there as your reference). Import and call it in
   `EntregasPage.tsx`:

```ts
const { isAtLimit } = useEntitlements(); // from apps/crm/src/hooks/useEntitlements.ts
const templatesAtLimit = isAtLimit('max_workflow_templates', templates.length);
```

  Place this near the existing `templates` variable (the same one already passed to
  `<KanbanView templates={templates} .../>`) — confirm `templates` is already in scope at
  this point in the component (it should be, since it's already passed as a prop today).

2. At the `<KanbanView ...>` call site (search for `<KanbanView` in this file — it's the
   one inside the `mode === 'entregas'` branch, alongside props like `onAddWorkflow`),
   add the two new props:

```tsx
onCreateTemplate={() => setTemplatesOpen(true)}
createTemplateDisabled={templatesAtLimit}
```

  `setTemplatesOpen` is the existing state setter already used by this page's header
  "Templates" button (search for `setTemplatesOpen(true)` to find that existing call and
  confirm you're using the identical handler, not a new one). Do not modify
  `TemplatesModal` or anything in `WorkflowModals.tsx` — this task is prop-threading only.

### Test (optional but recommended)

If `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx` mocks `KanbanView` (it
likely does — check near the top of the file for a `vi.mock(...)` of the KanbanView
module), extend that mock to accept `onCreateTemplate`/`createTemplateDisabled` and
render a simple button that calls `onCreateTemplate` when clicked, then add a test that
clicking it causes the (already-mocked) `TemplatesModal` to appear — proving the wiring
end to end. If the existing test file's mock structure makes this awkward, it's fine to
skip and note why in your report; this is explicitly optional, unlike everything else in
this task.

### Report

DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, files changed, whether you added the
optional test, and verification command + output
(`npx tsc -p apps/crm/tsconfig.json --noEmit` plus the relevant test file(s)).

---

## Known pre-existing gap (not part of any task above — informational only)

`TemplatesModal.handleSave`'s catch block (`apps/crm/src/pages/entregas/components/WorkflowModals.tsx`)
toasts the raw thrown error message rather than using `mapEntitlementError`/
`entitlementMessage` (as `apps/crm/src/pages/entregas/wizard/createWorkflow.ts` already
does for the same `addWorkflowTemplate` call), so a plan-limit rejection there shows an
unformatted string like `plan_limit_exceeded:max_workflow_templates`. The pre-emptive
disabling of the "+" tab (Tasks 3-4) avoids hitting this via the new entry point, but the
existing header "Templates" button's in-modal creation path can still hit it today. Not
in scope for this plan — do not fix it as part of any task above.

## Final verification (whole branch, after all tasks)

- `npx tsc -p apps/crm/tsconfig.json --noEmit`, plus the hub/admin/scripts tsc projects
  per CLAUDE.md, `npm run test`, `npm run lint`, `npm run format:check`.
- `npx supabase db reset` locally, then run `supabase/tests/entitlements/93_default_workflow_template_seed.sql` directly (or the full `bash scripts/test-entitlements.sh`).
- Manual browser check: fresh signup → create first fluxo from "Padrão" → tab strip
  appears with one tab + "+" → click "+" opens "Gerenciar Templates" → create a second
  template → appears as a second tab with "+" still last. Then a free-plan workspace
  already at its template limit → "+" renders disabled with the "Limite do plano
  atingido" tooltip instead of opening the modal.
