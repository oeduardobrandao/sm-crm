# Template propagation preserves per-fluxo values

Date: 2026-09-25
Status: design approved, pending spec review

## Problem

Saving a workflow template overwrites values that were set by hand on active fluxos.

The template modal (`apps/crm/src/pages/entregas/components/WorkflowModals.tsx`,
`handleSave`) saves the template with a plain `workflow_templates` UPDATE, then calls
`propagate_template_to_workflows(p_template_id)`
(`supabase/migrations/20260828000010_propagate_template_backfill_new_steps.sql`). The RPC
reads the template *after* the save, so it cannot tell what the edit changed. It writes
`nome`, `prazo_dias`, `tipo_prazo`, `responsavel_id` (and `tipo` on `pendente`) from the
template into every `pendente`/`ativo` etapa of every active fluxo using that template,
unconditionally. It also sets `app.suppress_workflow_events`, so the overwritten values
are not recorded anywhere.

Incident, 2026-09-24 17:22 UTC, DK Marketing Médico, template 1 "Posts (Estáticos e
Carrosséis)": the only intended change was the responsável of each etapa. The save
reached 40 fluxos. Ten "Outubro de 2026" fluxos (created 2026-09-19 with custom Copy
prazos) had their active Copy etapa reset to the template's `prazo_dias = 1`, making them
overdue. The original values existed only at etapa creation (no INSERT event) and could
not be recovered from the live database.

## Rule

A template edit only changes a fluxo value that still matches what the template said
before the edit. Per field, per etapa (matched by position, as today):

| Old template | New template | Fluxo's value | Result |
|---|---|---|---|
| X | X (unchanged) | anything | keep |
| X | Y | X (inherited) | set to Y |
| X | Y | Z (customized) | keep Z |

- **Fields:** `nome`, prazo, `responsavel_id`, `tipo`.
- **Prazo is one field:** `(prazo_dias, tipo_prazo)` is compared and written as a pair.
  Changing only `tipo_prazo` in the template does not reach a fluxo with a custom
  `prazo_dias`, and vice versa. Together they define the deadline; mixing a custom number
  with the template's new unit produces a deadline nobody set.
- **Status gates, unchanged:** only `pendente` and `ativo` etapas are considered;
  `concluido` is never touched; `tipo` is never written on `ativo`.
- **Backfill, unchanged:** a template position with no `workflow_etapas` row in the fluxo
  (any status) is inserted as `pendente` with the *new* template's values and
  `data_limite = NULL`.
- **No old value at that position** (the fluxo has more etapas than the old template):
  there is nothing to have inherited from, so every field counts as customized and is
  kept.
- **New fluxos** keep copying the template at creation. Nothing changes there.
- **Known limitation, unchanged:** matching is positional, and the template modal
  (`SortableEtapaList`) lets users reorder, insert and delete steps. Reordering over
  inherited `pendente` etapas still resolves correctly (old[i] = fluxo[i], so fluxo[i]
  follows new[i]). The case documented in
  `20260828000010_propagate_template_backfill_new_steps.sql` stays broken: a step
  inserted before a `concluido` etapa is never created and a duplicate later step is
  appended. Fixing that needs stable per-step ids in the template, which is a separate
  schema/product change. This spec doesn't make it worse.
- **Deadline mode is template-only, unchanged:** `workflow_templates.modo_prazo` is saved,
  but `workflows.modo_prazo` and every etapa's `data_limite` are never touched, as today.
  A new mode reaches fluxos created afterwards. On a fluxo whose effective deadline is
  `data_limite` (`data_fixa`/`data_entrega`), a propagated prazo change is stored but
  doesn't move that deadline, which is also today's behavior.
- **Indistinguishable case, accepted:** a fluxo value that was set by hand to exactly the
  old template's value counts as inherited. It already equals the template, so following
  the template is the least surprising result.

### Normalization

Both sides of every comparison go through the same normalization the RPC already uses
for writes, so a JSON quirk never reads as a customization:

- `responsavel_id`: `NULLIF(x->>'responsavel_id', '')::bigint`, compared with
  `IS NOT DISTINCT FROM` (NULL = NULL is "same").
- `tipo_prazo`: `coalesce(x->>'tipo_prazo', 'corridos')`.
- `tipo`: `coalesce(x->>'tipo', 'padrao')`.
- `prazo_dias`: `(x->>'prazo_dias')::integer`.
- `nome`: `x->>'nome'`, exact match.

The old template array was saved before any server validation existed, so non-object
entries in it are skipped (the value at that position counts as absent, so the fluxo's
values are kept). The new array is validated (see step 3 below), and a non-object entry
rejects the whole save.

## Design

### 1. New RPC `update_workflow_template`

```sql
update_workflow_template(
  p_template_id bigint,
  p_nome        text,
  p_etapas      jsonb,
  p_modo_prazo  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
```

One transaction:

1. `v_conta := get_my_conta_id()`; NULL raises `workspace_not_found`.
2. `SELECT etapas INTO v_old FROM workflow_templates WHERE id = p_template_id AND
   conta_id = v_conta FOR UPDATE`; not found raises `template_not_found`. The row lock
   serializes two concurrent saves of the same template, so each one merges against the
   version the other committed.
3. Validate the input before any write. Every check handles SQL NULL explicitly
   (`x IS NULL OR x NOT IN (...)`, `coalesce(btrim(x), '') = ''`), because a bare
   `NOT IN` or `= ''` on NULL evaluates to NULL and skips the branch. This is the same
   trap `migrate_workflow_template` already guards against. Raise `template_invalid`
   unless:
   - `p_nome` is non-null and non-empty after trim;
   - `p_modo_prazo` is non-null and in `('padrao','data_fixa','data_entrega')`;
   - `p_etapas` is a non-null, non-empty JSON array, and **every** entry is an object;
   - each entry's `nome` is a non-empty string;
   - each entry's `prazo_dias` parses as an integer in `0..999` (the parse is inside a
     sub-block so a bad cast raises `template_invalid`, not a raw cast error; the
     ceiling matches the modal's `MAX_PRAZO_DIAS` and `apply_post_process`);
   - each entry's `tipo_prazo` is `'uteis'`/`'corridos'` or absent (absent normalizes to
     `'corridos'`);
   - each entry's `tipo` is `'padrao'`/`'aprovacao_cliente'` or absent (absent normalizes
     to `'padrao'`).

   Each non-null `responsavel_id` must parse as a bigint and exist in `membros` with
   `conta_id = v_conta`, otherwise raise `invalid_responsavel`. This mirrors
   `migrate_workflow_template`: `workflow_etapas.responsavel_id` only has a global FK,
   and this function is `SECURITY DEFINER`, so without the check a caller could assign a
   member from another workspace.
4. `UPDATE workflow_templates SET nome, etapas, modo_prazo`.
5. Propagate with the merge rule, using `v_old` and `p_etapas`. The loop structure is the
   current RPC's: per-fluxo `FOR UPDATE` re-check of `template_id`/`status`/`conta_id`,
   `conta_id` tenant filter on the fluxo cursor, event suppression GUC, backfill as a
   single `INSERT ... SELECT ... WHERE NOT EXISTS`.

   **Etapa rows are locked before comparison.** The per-fluxo etapa cursor is
   `SELECT ... FROM workflow_etapas WHERE workflow_id = ... AND status IN
   ('pendente','ativo') ORDER BY ordem FOR UPDATE`, and it reads the field values it
   compares. Locking the `workflows` row is not enough: `updateWorkflowEtapa` in the CRM
   writes `workflow_etapas` directly without touching the fluxo row. Without the etapa
   lock, a manual edit committed between the comparison and the UPDATE would be
   overwritten with the template value. With it, a concurrent manual edit either commits
   first (and the cursor reads its value under READ COMMITTED once the lock is granted)
   or waits for this transaction to finish. The UPDATE keeps `AND status = <value read>`
   as a belt-and-braces guard.
6. Record one `template_propagado` event per touched fluxo (see section 3), **in the
   same transaction and without an exception handler**. If the event insert fails, the
   whole save rolls back. The current RPC deliberately swallows event failures with a
   warning, but here the event is the undo record, so a save that can't be undone must
   not commit.

Grants: `REVOKE ALL ... FROM public, anon`; `GRANT EXECUTE ... TO authenticated,
service_role`. Authorization matches today: any member of the workspace can edit its
templates (the `workflow_templates_update` RLS policy is `conta_id`-only).

Per etapa, the UPDATE sets each field to either the new value or itself, computed in one
statement. "Touched" means at least one field actually changed or a row was backfilled.
An etapa whose fields all resolve to "keep" is not written.

### 2. Old RPC becomes backfill-only

`propagate_template_to_workflows(bigint)` is redefined to run only the backfill step (and
its event, which stays best-effort as today: it only ever inserts rows, so there is
nothing to undo). It no longer writes any field on existing etapas.

This covers the deploy window. Migrations are pushed before merging, and the merge
deploys the frontend right away, so the old modal keeps calling this RPC for a while.
During that window a template save still reaches new fluxos and adds new steps, but
never overwrites a value. That is the safe direction.

A follow-up migration drops the old RPC once the new frontend has been live for a deploy
cycle. Out of scope here.

### 3. Event metadata

`template_propagado` metadata keeps `template_id`, `template_nome`,
`etapas_atualizadas`, `etapas_criadas`, and adds:

- `alteracoes`: array of `{etapa_id, ordem, campo, de, para}` for each value written.
  `campo` is one of `nome`, `prazo`, `responsavel_id`, `tipo`. For `prazo`, `de`/`para`
  are `{prazo_dias, tipo_prazo}` objects.
- `valores_preservados`: count of fields where the template changed but the fluxo's value
  was kept because it was customized.

`etapas_atualizadas` now counts etapas with at least one field written (it counted
matched rows before). A fluxo where the template changed a field but every value was
preserved is not "touched" and gets no event, so `valores_preservados` only shows up on
fluxos that got an event for another reason. That's acceptable: the record exists to
undo writes.

The CRM timeline (`workflowTimeline.ts`) only reads `template_nome`, so the new keys are
additive. No UI change.

This is the record that was missing on 2026-09-24: a bad save can be undone from
`workflow_events` without a backup.

### 4. Frontend

- `apps/crm/src/store/workflows.ts`: add `saveWorkflowTemplate(id, {nome, etapas,
  modo_prazo})` calling the RPC. Remove `propagateTemplateToWorkflows` and
  `updateWorkflowTemplate`; the modal is the only caller of either, and keeping the plain
  UPDATE would leave a path that saves a template without the merge.
- `WorkflowModals.tsx` `handleSave`: the edit branch calls `saveWorkflowTemplate` once
  instead of update + propagate. Map `template_invalid` to the existing prazo toast; other
  errors keep the generic error toast.
- `ComoFuncionaPanel.tsx` and the `boardRows.ts` comment describe the propagation. Update
  the copy/comments to say customized values are kept.

### 5. Migration

One file, `supabase/migrations/<version above main's tail>_template_propagation_preserve_overrides.sql`:
create `update_workflow_template`, redefine `propagate_template_to_workflows` as
backfill-only, restate grants on both. The header comment carries the rule table and the
incident. The version number is picked right before `gh pr create`, above main's tail at
that moment.

## Testing

### psql (`supabase/tests/`, run by `entitlement-tests` in CI)

New suite `update_workflow_template.sql`, covering:

- the three rows of the rule table for each field, including the 2026-09-24 case: a fluxo
  with a custom `prazo_dias` and the template's `responsavel_id` gets only the
  responsável change;
- the prazo pair: template changes only `tipo_prazo`, fluxo has custom `prazo_dias` →
  kept; fluxo inherited both → `tipo_prazo` written;
- normalization: `responsavel_id` `null` vs `""` vs missing, `tipo`/`tipo_prazo` missing →
  treated as equal;
- `ativo` never gets `tipo`; `concluido` untouched; a fluxo with more etapas than the old
  template keeps its extra etapa's values;
- backfill of an appended step with the new values;
- event: one per touched fluxo, exact `alteracoes` contents, `valores_preservados`, no
  event for a fluxo where everything was preserved;
- template from another workspace → `template_not_found`; a poisoned cross-tenant fluxo
  with a matching `template_id` is untouched (same shape as the existing suite's
  `v_wf_poison_prop`);
- `template_invalid` for: NULL / blank `p_nome`; NULL / bad `p_modo_prazo`; NULL / empty
  / non-array `p_etapas`; an array mixing one valid object with a scalar; missing or
  blank `nome`; `prazo_dias` missing, non-numeric, negative, or 1000; bad `tipo_prazo`;
  bad `tipo`. Nothing is written in any case (template row unchanged, no etapa changed);
- `invalid_responsavel` for a `responsavel_id` from another workspace, and for a
  non-numeric one;
- deadline mode: changing the template's `modo_prazo` leaves `workflows.modo_prazo` and
  `data_limite` untouched;
- event atomicity: with `record_workflow_event` forced to fail (e.g. a temporary CHECK on
  `workflow_events` inside the test transaction), the call raises and the template row
  and etapas are unchanged.

Row locking isn't covered by psql (it would need two sessions). The spec states it, and
the plan's code review checks the `FOR UPDATE` on the etapa cursor.

Existing suite `supabase/tests/workflow_events.sql`, sections (m) and (n), calls
`propagate_template_to_workflows` and asserts overwrites. Move those overwrite assertions
to the new RPC (adapting fixtures so fluxo values match the old template where an
overwrite is expected), and add an assertion that the old RPC now only backfills.

### Vitest

- `apps/crm/src/__tests__/store.workflows.test.ts`: replace the two
  `propagate_template_to_workflows` cases with the new RPC's args and error propagation.
- `WorkflowModals.test.tsx`: the edit save calls `saveWorkflowTemplate` once with the
  mapped etapas.

### Manual

Staging: create a template and two fluxos from it, customize one etapa's prazo in one
fluxo, change the template's responsável and prazo, and confirm the customized prazo
survives while the responsável reaches both fluxos.
