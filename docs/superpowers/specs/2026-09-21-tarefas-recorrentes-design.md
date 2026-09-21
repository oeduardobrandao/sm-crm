# Tarefas recorrentes: task series generated in the database

Date: 2026-09-21
Status: approved (product decisions closed; technical details below verified against the code)
Builds on: `2026-07-30-tarefas-team-task-tracker-design.md` (tarefas, subtarefas, tags, `task_assigned` notification)

## Problem

Routine work (weekly report, monthly close, "review the calendar every Monday") has to be recreated by hand every cycle. The task tracker shipped without recurrence as a deliberate YAGNI (2026-07-30 spec). This document adds **task series**: a repeat rule plus a template, from which the database materializes occurrences. Every occurrence is an ordinary `tarefas` row, so it flows through all views, filters, notifications and the MCP unchanged.

## Decisions confirmed with the user

1. **Generation mode is chosen per series**: `ao_concluir` (the next occurrence is created when the current one is completed) or `calendario` (a job creates the occurrence on each rule date regardless of completion).
2. **v1 patterns**: daily, weekly (chosen weekdays), monthly (day of month), yearly; each with "every N".
3. **End**: never, or an optional end date (`fim`). No "N times".
4. **Each occurrence copies everything from the series template**: title, rich description, responsavel, cliente, tags and subtasks (all unchecked); status resets to `pendente`.
5. **Editing** an occurrence that belongs to a series asks "Somente esta / Esta e as próximas"; **deleting** asks "Somente esta / Toda a série".

Out of scope for v1 (own section at the end): RRULE-style patterns ("second Thursday"), "N times", MCP creation of series, advance reminders, plan gating (tarefas has none today).

## Data model

### `tarefa_series` (new)

One row per series. RLS follows the `tarefas` pattern (`20260730000005`): `tarefa_series_tenant_all` with `USING (conta_id IN (SELECT public.get_my_conta_id()))` and a `WITH CHECK` that, beyond `conta_id`, ties `responsavel_id` and `cliente_id` to the row's own `conta_id` through qualified `EXISTS` subqueries (`tarefa_series.responsavel_id`, never a bare `conta_id`). Same reason as the parent table: `resolve_notification_targets` reads `membros` by id without a `conta_id` check, and the materialized occurrence inherits the template's `responsavel_id`. `tarefa_series_service_role_bypass` as everywhere else.

| Column | Type | Rule |
|---|---|---|
| `id` | bigserial PK | |
| `conta_id` | uuid NOT NULL -> workspaces ON DELETE CASCADE | |
| `user_id` | uuid NOT NULL | creator; copied into `tarefas.user_id` (NOT NULL) on every occurrence |
| `freq` | text NOT NULL | CHECK IN (`daily`,`weekly`,`monthly`,`yearly`) |
| `intervalo` | int NOT NULL DEFAULT 1 | CHECK BETWEEN 1 AND 99 |
| `dias_semana` | int[] | 0 = Sunday ... 6 = Saturday (matches both `extract(dow)` and JS `Date.getDay()`); CHECK: `weekly` requires 1..7 distinct values in 0..6; other freqs require NULL |
| `dia_mes` | int | CHECK: `monthly` requires 1..31; other freqs require NULL |
| `modo` | text NOT NULL | CHECK IN (`ao_concluir`,`calendario`) |
| `inicio` | date NOT NULL | phase anchor for every rule; equals the first occurrence's `data_limite` |
| `fim` | date | inclusive; CHECK `fim IS NULL OR fim >= inicio` |
| `pausada` | boolean NOT NULL DEFAULT false | |
| `encerrada_em` | timestamptz | manual stop ("Encerrar série"); irreversible in v1 |
| `proxima_data` | date | `calendario` cursor; **owned by the DB** (trigger), the client never writes it; NULL = series exhausted (next date would pass `fim`) |
| `titulo` | text NOT NULL | template |
| `descricao` | text | template (plain-text projection) |
| `descricao_rich` | jsonb | template (TipTap) |
| `responsavel_id` | bigint -> membros ON DELETE SET NULL | simple FK, same reason as the parent table |
| `cliente_id` | bigint -> clientes ON DELETE SET NULL | idem |
| `tag_ids` | bigint[] NOT NULL DEFAULT '{}' | no FK; see "deleted tags" below |
| `subtarefas` | jsonb NOT NULL DEFAULT '[]' | array of strings (titles only, in order) |
| `created_at` / `updated_at` | timestamptz | trigger `set_tarefa_series_updated_at` |
| | | `CONSTRAINT tarefa_series_id_conta_uq UNIQUE (id, conta_id)` (house pattern; available for future composite child FKs) |

Indexes: `(conta_id)`, plus a partial `(proxima_data) WHERE modo = 'calendario' AND NOT pausada AND encerrada_em IS NULL AND proxima_data IS NOT NULL` for the cron scan.

`encerrada_em` and `user_id` were not in the brief. `user_id` is required because `tarefas.user_id` is NOT NULL and the cron has no `auth.uid()`. `encerrada_em` separates "manual stop, effective now" from "planned end date" (`fim`): ending a series by setting `fim = today` would still let the cron create today's occurrence.

### `tarefas` (changes)

- `serie_id bigint REFERENCES tarefa_series(id) ON DELETE SET NULL`. **Simple FK, not composite**: the brief asked for `(serie_id, conta_id)`, but `ON DELETE SET NULL` on a composite FK nulls both columns and `conta_id` is NOT NULL, exactly the trap the 2026-07-30 spec recorded for `responsavel_id`/`cliente_id`. `ON DELETE SET NULL (serie_id)` exists only on PG 15+ and `supabase/config.toml` does not pin `major_version`. In exchange, `tarefas_tenant_all`'s `WITH CHECK` gains one more `EXISTS` set tying `serie_id` to the row's own `conta_id` (same pattern as the other two). The `service_role` bypass and the MCP (which never writes `serie_id`) are unaffected.
- `CONSTRAINT tarefas_serie_data_uq UNIQUE (serie_id, data_limite)`: makes generation idempotent (`ON CONFLICT DO NOTHING`). A NULL `serie_id` never conflicts, so standalone tasks are unaffected.
- `CONSTRAINT tarefas_serie_exige_prazo CHECK (serie_id IS NULL OR data_limite IS NOT NULL)`: closes the UNIQUE-ignores-NULL hole. Every series is born with a date (the form's Prazo is `inicio`), so every occurrence has a `data_limite`. The client blocks the "Sem data" paths first (see views); the CHECK is the backstop.
- Index `(serie_id) WHERE serie_id IS NOT NULL`.

### Deleted tags, deleted responsavel/cliente, tags from another workspace

- `tag_ids` has no FK: materialization does `JOIN tarefa_tags t ON t.id = ANY(s.tag_ids) AND t.conta_id = s.conta_id`; deleted or foreign ids simply produce no link. The composite FK on `tarefa_tag_links` (`(tag_id, conta_id)`) is the second barrier. No `tag_ids` cleanup on tag deletion in v1 (optional: `array_remove` trigger AFTER DELETE on `tarefa_tags`).
- Template `responsavel_id`/`cliente_id` are `ON DELETE SET NULL`: the next occurrence is born unassigned / without client. Nothing else to do.

## Generation: entirely in the database

Decision: **SQL functions + pg_cron, no edge function.** Rationale, verified against the codebase:

- Pure-SQL pg_cron jobs already exist (`rate-limit-cleanup` in `20260831000001`, `cron-job-run-details-purge` in `20260925000023`).
- The `cron-health-cron` monitor (PR #563) has no job registry: `public.recent_cron_failures()` scans **every** `status = 'failed'` row of `cron.job_run_details`. A SQL job that raises shows up there and becomes email + triage automatically. "Registering with cron-health" means nothing beyond `cron.schedule` and **not swallowing exceptions** (below).
- Half of the logic (the `ao_concluir` trigger) has to live in the database anyway, because status is written by six distinct client paths plus the MCP. Keeping materialization in one SQL place avoids two implementations of the template copy.
- No function deploy (`--use-api`, `--no-verify-jwt`, vault `project_url`/`cron_secret`, `net.http_post`), no extra `SUPABASE_SERVICE_ROLE_KEY` in transit. The psql suite tests the behaviour directly; an edge function would not be covered by it.
- Accepted cost: date math in plpgsql. Mitigated by the mandatory edge-case table below.

Timezone convention: "today" is always `tarefa_hoje_sp()` = `(now() AT TIME ZONE 'America/Sao_Paulo')::date` (STABLE). pg_cron runs in UTC; Brazil has had no DST since 2019, so UTC-3 is fixed.

### `tarefa_next_date(...)`: the single source of date math

```
tarefa_next_date(p_freq text, p_intervalo int, p_dias_semana int[], p_dia_mes int,
                 p_inicio date, p_after date) RETURNS date
LANGUAGE plpgsql IMMUTABLE
```

Returns the **smallest rule date strictly greater than `p_after`**, or NULL when the rule produces none (impossible under the CHECKs, but the loop is capped at 1000 iterations and raises when exceeded so cron-health sees it). Phase rules, all anchored on `p_inicio`:

- `daily`: dates `inicio + k*intervalo` (k >= 0).
- `weekly`: Mon-Sun weeks (`date_trunc('week', d)`; Sunday closes the week started on the previous Monday, consistent with the app's "Esta semana" bucket). Week 0 = the week of `inicio`; eligible weeks satisfy `(week - week0) % intervalo = 0`; within them, the days in `dias_semana`. `inicio` need not fall on a rule day (the typed due date is the first occurrence regardless).
- `monthly`: eligible months satisfy `(year*12+month - (year0*12+month0)) % intervalo = 0`; day = `least(dia_mes, days_in_month)` (31 -> last day; the clamp does not "stick": March goes back to 31).
- `yearly`: years `year0 + k*intervalo`, same month/day as `inicio`; Feb 29 becomes Feb 28 in a non-leap year and returns to Feb 29 in the next leap year.
- Candidate dates are always `>= inicio`. If `p_after < inicio`, the answer is the first rule date `>= inicio` (for `daily`/`yearly` that is `inicio` itself; for `weekly`/`monthly`, `inicio` counts only if it falls on the rule).
- Invalid `p_freq` raises.

Cases the SQL suite **must** cover (rule; inicio; after -> expected):

| # | Rule | inicio | after | expected | Proves |
|---|---|---|---|---|---|
| 1 | daily/1 | 2026-01-01 | 2026-01-01 | 2026-01-02 | strictly greater |
| 2 | daily/3 | 2026-01-01 | 2026-01-02 | 2026-01-04 | phase from inicio (01, 04, 07) |
| 3 | daily/3 | 2026-01-01 | 2026-01-04 | 2026-01-07 | after on a rule date is not returned |
| 4 | weekly {1} | 2026-01-05 (Mon) | 2026-01-05 | 2026-01-12 | plain weekly |
| 5 | weekly {1,3} | 2026-01-05 | 2026-01-05 | 2026-01-07 | several days in the same week |
| 6 | weekly {1,3}/2 | 2026-01-05 | 2026-01-07 | 2026-01-19 | skips the whole week of 01-12 |
| 7 | weekly {0} | 2026-01-05 (Mon) | 2026-01-05 | 2026-01-11 | Sunday closes the Mon-Sun week |
| 8 | weekly {1}/2 | 2026-01-07 (Wed) | 2026-01-07 | 2026-01-19 | inicio off-rule anchors on the week of 01-05 |
| 9 | monthly 31 | 2026-01-31 | 2026-01-31 | 2026-02-28 | month-end clamp |
| 10 | monthly 31 | 2026-01-31 | 2026-02-28 | 2026-03-31 | clamp does not stick |
| 11 | monthly 15/3 | 2026-01-15 | 2026-02-01 | 2026-04-15 | monthly phase with interval |
| 12 | monthly 30 | 2028-01-30 | 2028-01-30 | 2028-02-29 | clamp in a leap year |
| 13 | yearly | 2024-02-29 | 2024-02-29 | 2025-02-28 | Feb 29 -> Feb 28 |
| 14 | yearly | 2024-02-29 | 2027-02-28 | 2028-02-29 | back to Feb 29 |
| 15 | yearly/2 | 2026-03-10 | 2026-03-10 | 2028-03-10 | yearly interval |
| 16 | daily/1 | 2026-01-10 | 2026-01-01 | 2026-01-10 | after before inicio |
| 17 | weekly {1} | 2026-01-07 (Wed) | 2026-01-01 | 2026-01-12 | after before inicio, inicio off-rule |
| 18 | freq 'hourly' | | | raises | validation |

### Shared materialization

```
tarefa_serie_materializar(p_serie_id bigint, p_data date) RETURNS bigint
SECURITY DEFINER, SET search_path = public
```

Reads the series, inserts the `tarefas` row (`conta_id`, `user_id` = `serie.user_id`, titulo, descricao, descricao_rich, `status = 'pendente'`, responsavel_id, cliente_id, `data_limite = p_data`, `serie_id`) with `ON CONFLICT ON CONSTRAINT tarefas_serie_data_uq DO NOTHING RETURNING id`. If nothing was inserted (already existed) it returns NULL and does **not** touch children. If inserted: `subtarefas` from the jsonb (ordem = position, `concluida = false`) and `tarefa_tag_links` via the JOIN against same-workspace `tarefa_tags`. It is the only function that writes occurrences; trigger, cron and resume all go through it.

```
tarefa_serie_garantir_aberta(p_serie_id bigint, p_after date) RETURNS bigint
SECURITY DEFINER, SET search_path = public
```

The `ao_concluir` helper ("make sure the series has an open occurrence after `p_after`"). Locks the series row (`FOR UPDATE`; serializes two concurrent completions of the same series), returns without action when `modo <> 'ao_concluir'`, `pausada`, `encerrada_em IS NOT NULL`, or when **an open occurrence already exists** (`status <> 'concluida'`) for the series with `data_limite > p_after`. Otherwise `next = tarefa_next_date(rule, greatest(p_after, tarefa_hoje_sp()))`; if `next IS NULL` or `next > fim`, return; else materialize at `next`.

### `ao_concluir` mode

Trigger `tarefas_serie_ao_concluir` AFTER UPDATE OF status ON tarefas, `WHEN (NEW.serie_id IS NOT NULL AND NEW.status = 'concluida' AND OLD.status IS DISTINCT FROM 'concluida')`, SECURITY DEFINER function. Before calling the helper (which takes the row lock) it reads `modo` without a lock and returns if `calendario`, so completing a calendario occurrence never waits on the cron's scan. It fires for every path that writes status: kanban, list checkbox, sheet buttons, form, dashboard `TodayCard`, MCP `update_task` (service_role; `d.db` writes `status` directly, verified in `mcp/queries.ts`). It coexists with `sync_ideia_from_tarefa` (AFTER UPDATE OF status, `20260730000009`) and `tarefas_concluida_em` (BEFORE).

Next-date rule: **strictly after `greatest(data_limite, today)`**. Completing a weekly task three weeks late yields the next future Monday, not three overdue occurrences nor one overdue occurrence. Completing early (Friday's task done on Wednesday) computes from Friday, keeping the phase. Moving an occurrence's due date (Board/Calendar drag) does not shift the series: phase comes from `inicio`; the moved date only sets the "after" point.

Idempotency and reopen: reopen + re-complete recomputes the same date -> `ON CONFLICT DO NOTHING`. Reopen + re-complete days later would compute a later date (because "today" moved): the "open occurrence with `data_limite > p_after` already exists" guard blocks the duplicate branch; if the generated occurrence was itself already completed, it already spawned the following one and the guard sees that. Invariant the suite proves: an `ao_concluir` series never has two DB-generated open occurrences from the same completion.

"Somente esta" delete of the only open occurrence: without handling, the series would go dormant forever and v1 has no series screen to find it again. Decision: trigger `tarefas_serie_ao_excluir` AFTER DELETE ON tarefas `WHEN (OLD.serie_id IS NOT NULL)` calls the same helper with `p_after = OLD.data_limite`. Effect: "Somente esta" in `ao_concluir` means "skip this one"; the next is created immediately, and the dialog says so. Two mandatory early returns in the function: (a) `NOT EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.conta_id)`: on `DELETE FROM workspaces` the order of sibling cascades (`tarefas` vs `tarefa_series`) is unspecified and the workspace row is already gone when the cascade reaches `tarefas`; without the guard the helper would insert a task pointing at a workspace mid-deletion and abort the workspace delete; (b) the helper already ignores series with `encerrada_em`, which is why the "Toda a série" RPC ends the series before deleting (below).

### `calendario` mode

```
generate_recurring_tarefas() RETURNS TABLE (series_processadas int, ocorrencias_criadas int)
SECURITY DEFINER, SET search_path = public
```

`today = tarefa_hoje_sp()`. Iterates `SELECT ... FROM tarefa_series WHERE modo = 'calendario' AND NOT pausada AND encerrada_em IS NULL AND proxima_data IS NOT NULL AND proxima_data <= today FOR UPDATE SKIP LOCKED`. For each series: `d = proxima_data`; advance `d` while `tarefa_next_date(rule, d) <= today` (catch-up: only the most recent due date, no flood after downtime); if `d > fim`, set `proxima_data = NULL` and continue; else materialize at `d` (ON CONFLICT covers re-runs) and `proxima_data = tarefa_next_date(rule, d)` (> today by construction), or NULL if it passes `fim`.

Failures: **no per-series `EXCEPTION WHEN OTHERS`.** The only possible failures are bugs (FK/CHECK; RLS does not apply to the owner, UNIQUE is handled, deleted responsavel/cliente become NULL, deleted tags are filtered). Swallowing per series would hide the failure from cron-health; aborting marks the run `failed`, the monitor alerts within 70 min, and the next run retries. The notification trigger has its own exception block and never aborts the insert.

Schedule (own migration, idempotent in the `20260831000001` pattern): `cron.schedule('tarefas-recorrentes-generate', '7 * * * *', $$SELECT public.generate_recurring_tarefas()$$)`. **Hourly, not daily** (deviation from the brief): the function is idempotent and the scan is on a partial index, so the cost is negligible; hourly bounds the wait after a failed run or after the migration deploy to 1h, and "today's" occurrence appears on the first run after midnight in Sao Paulo (00:07). Daily works identically if the reviewer prefers; only the cron expression changes.

### `proxima_data` is DB-owned

Trigger `tarefa_series_sync_proxima_data` BEFORE INSERT OR UPDATE ON tarefa_series, mirroring `tarefas_sync_concluida_em` ("the DB owns this invariant; the client never writes it"). Recomputes when `modo = 'calendario'` and:

| Event | `p_after` used | Why |
|---|---|---|
| INSERT | `inicio` | the first occurrence (= `inicio`) is created by the client alongside the series |
| rule changed (`freq`, `intervalo`, `dias_semana`, `dia_mes`, `inicio`, `modo`) | `greatest(inicio, today)` | "Esta e as próximas" re-anchors `inicio` on the edited occurrence; nothing in the past is generated |
| `pausada` true -> false | `greatest(inicio, today - 1)` | "today" counts: resuming on a rule day generates today's occurrence on the next run |

Any double generation this could produce (e.g. rule edited on the day of an occurrence that already exists) dies on `tarefas_serie_data_uq`. If `modo` changes to `ao_concluir`, `proxima_data := NULL`.

Trigger `tarefa_series_apos_retomar` AFTER UPDATE OF pausada ON tarefa_series, `WHEN (OLD.pausada AND NOT NEW.pausada AND NEW.modo = 'ao_concluir')`: calls `tarefa_serie_garantir_aberta(NEW.id, today - 1)`. Covers a series whose last occurrence was completed while paused (otherwise it would stay dormant).

### Series states (derived; no `status` column)

| State (UI) | Condition | Sheet actions |
|---|---|---|
| Ativa | `encerrada_em IS NULL AND NOT pausada AND (fim IS NULL OR fim >= today)` | Pausar série, Encerrar série |
| Pausada | `encerrada_em IS NULL AND pausada` | Retomar série, Encerrar série |
| Encerrada | `encerrada_em IS NOT NULL` | none (open occurrences remain editable as tasks) |
| Concluída | `encerrada_em IS NULL AND fim < today` (or `calendario` with `proxima_data IS NULL`) | none |

Sheet label copy: "Repete: {resumo}" followed by " · cria a próxima ao concluir" or " · cria em toda data da regra", plus a state pill ("Pausada", "Encerrada", "Termina em 31/12/2026", "Concluída").

### Edit, pause, resume, end

- **"Esta e as próximas"** (form): (1) `updateTarefa` on the occurrence with the full payload, as today; (2) `updateTarefaSerie` with: the template fields whose form value **differs from the occurrence's original value** (titulo, descricao + descricao_rich, responsavel_id, cliente_id, tags), the whole rule section (freq, intervalo, dias_semana, dia_mes, modo, fim) with `inicio := data_limite` of the occurrence (re-anchors the phase), and `subtarefas := titles of the occurrence's current subtasks, in order` (the form has no checklist editor; this is the only path to propagate checklist changes). Due date and status apply to this occurrence only. In `calendario`, already-generated future open occurrences **stay untouched**; only the cursor moves (table above).
- **"Somente esta"**: `updateTarefa` + `setTarefaTags` only, as today. Does not detach (`serie_id` stays); the next occurrence still comes from the template. If the rule section is dirty, "Somente esta" is disabled with the helper text "A regra de repetição vale para toda a série."
- **"Não repete" chosen in the form of an occurrence** (always "Esta e as próximas" by construction): `encerrada_em = now()` on the series and `serie_id = NULL` on this occurrence (it becomes a standalone task; the icon disappears). Other open occurrences stay linked to the ended series.
- **Rule chosen while editing a standalone task**: creates the series (template = form payload, `inicio = data_limite`, `subtarefas` = current checklist) and sets `serie_id` on the task. No scope dialog.
- **Pausar / Retomar**: `updateTarefaSerie(id, { pausada })`. The triggers above do the rest.
- **Encerrar série**: AlertDialog "Encerrar série?" / "As ocorrências já criadas continuam como estão. Nenhuma nova será criada." / "Encerrar". `updateTarefaSerie(id, { encerrada_em: now })`.

### Delete

- **"Somente esta"**: `deleteTarefa(id)` as today. In `ao_concluir` the delete trigger may create the next one; the dialog says so.
- **"Toda a série"**: RPC `tarefa_serie_excluir(p_serie_id bigint) RETURNS void`, SECURITY INVOKER, `SET search_path = public` (RLS decides what the caller sees; `convert_solicitacao_em_tarefa` pattern). Mandatory, atomic order: `UPDATE tarefa_series SET encerrada_em = now()` (disarms the delete trigger) -> `DELETE FROM tarefas WHERE serie_id = p AND status <> 'concluida'` -> `DELETE FROM tarefa_series WHERE id = p` (FK SET NULL unlinks the completed ones). Completed occurrences survive as standalone tasks: they are history ("concluídas hoje", reports). Grants: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ... TO authenticated, service_role` (`20260915000001` pattern).

### Notifications

Verified in `20260730000006`: `notify_task_assigned_insert` is AFTER INSERT `WHEN (NEW.responsavel_id IS NOT NULL)` and calls `insert_notification_batch(..., auth.uid())`, which excludes the actor. Therefore:

- Occurrence generated by the cron: `auth.uid()` is NULL under pg_cron -> the responsavel **is notified**. Night runs (00:07 SP) produce night notifications; the notification email has its own cadence (`notification-email-cron`) and does not change here. Noted only; not a v1 problem.
- Occurrence generated by completion (`ao_concluir`): `auth.uid()` = whoever completed. If the responsavel completed their own task, they are **not** notified about the next one (already the self-assignment rule). If someone else completed it, the responsavel is notified.
- Mentions: generated occurrences do not go through `syncMentions` (client-side). @mentions in the template description do not re-notify per occurrence. Known gap, accepted.
- `captureEvent('task_created')` does not fire for generated rows. Accepted.

### Security and grants

- SECURITY DEFINER functions (`tarefa_serie_materializar`, `tarefa_serie_garantir_aberta`, `generate_recurring_tarefas`, the three trigger functions): `SET search_path = public`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role` (memory: REVOKE FROM PUBLIC does not strip `service_role`'s implicit grant; roles must be named). Triggers fire without an EXECUTE check at fire time (the check happens at `CREATE TRIGGER`); the suite proves this by completing as `authenticated`. Names go into the array in `96_lockdown_definer_function_grants.sql` (or a sibling suite).
- `tarefa_next_date`, `tarefa_hoje_sp`: no data access; may keep EXECUTE for `authenticated` (handy for debugging via PostgREST); revoke from `anon`.
- `tarefa_serie_excluir`: INVOKER, see above.
- Tables: `tarefas` has **no** column-level GRANT allowlist (verified: no `GRANT ... ON tarefas` in migrations; the CLAUDE.md gotcha is `membros`/`clientes` only). `tarefa_series` and the new `tarefas` columns rely on the same implicit mechanism (hosted default ACL). No explicit GRANT; the psql suite needs `et_grant_hosted_parity()`.
- Nothing is exposed to `anon` beyond what RLS already denies (no anon policy).

## Frontend (CRM)

### Store (`apps/crm/src/store/tarefas.ts`)

- `Tarefa` gains `serie_id?: number | null`. `TarefaWithRelations` gains `serie: TarefaSerieResumo | null` (nullable; **every** existing fixture needs `serie: null`: `BoardView.test`, `TarefaCard.test`, `TarefasPage.test`, dashboard tests).
- `getTarefas()` embeds `tarefa_series(id, freq, intervalo, dias_semana, dia_mes, modo, inicio, fim, pausada, encerrada_em, proxima_data)` (simple FK; `subtarefas` already proves composite embeds work too) and flattens it into `serie`.
- New types `TarefaSerie` (full row) and `TarefaSerieRegra` (rule subset).
- New functions (plain async, house style): `addTarefaSerie(serie)`, `updateTarefaSerie(id, patch)`, `deleteTarefaSerieCompleta(id)` (rpc `tarefa_serie_excluir`), `getTarefaSerie(id)` (full template, for the form under "Esta e as próximas").
- Series creation (sequential, the style accepted in the 2026-07-30 spec's Codex review): `addTarefaSerie` -> `addTarefa({ ..., serie_id, data_limite: inicio }, tagIds)`. If the second step fails: best-effort `delete tarefa_series where id`, then rethrow. Benign failure mode: in `calendario` the cron creates the next rule date on its own; in `ao_concluir` the series stays dormant until cleaned up or recreated (listed under risks).
- Helper `isSerieDateConflict(e)`: `e.code === '23505'` and the message names `tarefas_serie_data_uq`. Used by the form, `BoardView` and `CalendarView` for the toast "Já existe uma ocorrência desta série nesse dia."
- Query keys: nothing new. Every series mutation invalidates `['tarefas']` (the embed lives there). `['subtarefas', id]` as today.
- A completion in `ao_concluir` creates a row server-side: **all six completion paths already invalidate `['tarefas']`** (`onRefresh()` in `StatusKanbanView`/`ListView`/sheet/`TarefaCard`, `onSettled` in `TodayCard`; verified). `useOptimisticTarefas` drops overrides when the fresh list arrives, so the new occurrence simply shows up on refetch. No hook change. The toast stays "Tarefa concluída!" (the client cannot know whether the DB created the next one: fim, pause).

### `TarefaFormDialog`: "Repetir" section

Below Prazo/Status, above Tags:

- `Select` "Repetir": Não repete / Diariamente / Semanalmente / Mensalmente / Anualmente.
- When != Não repete: a line "a cada [N] dia(s)/semana(s)/mês(es)/ano(s)" (numeric input 1..99); for Semanalmente, weekday chips (D S T Q Q S S; `dias_semana` 0..6); for Mensalmente, the text "Todo dia {day of Prazo}" (`dia_mes` derives from `data_limite`, no separate input in v1); `DatePicker` "Termina em" (placeholder "Nunca"); a mode toggle with two labels: "Criar a próxima ao concluir" / "Criar em toda data da regra", plus a help line: "Ao concluir: a próxima tarefa só aparece quando esta for concluída. Toda data: a tarefa aparece na data, mesmo com a anterior aberta."
- A plain-text summary below the section, built by `describeRecorrencia(regra)` in `apps/crm/src/pages/tarefas/recorrenciaLogic.ts` (pure, tested): "Todo dia", "A cada 3 dias", "Toda segunda e quarta", "A cada 2 semanas, na sexta", "Todo dia 15", "A cada 3 meses, no dia 31 (ou último dia)", "Todo ano em 10/03", with the suffix " até 31/12/2026" when there is an end. **No next-date computation on the client.**
- Validation (zod, `superRefine`): rule != never requires `data_limite` ("Defina um prazo: ele será a primeira ocorrência."); Semanalmente requires >= 1 day ("Escolha ao menos um dia da semana."); `intervalo` integer 1..99 ("Use um número de 1 a 99."); `fim >= data_limite` ("A data final precisa ser igual ou depois do prazo.").
- Editing an occurrence: the section loads the series rule (`getTarefaSerie`). The save button opens the scope dialog (below) instead of saving directly.
- `useUnsavedWork`: the form is a `DialogContent` (covered by `installSilentUpdate`'s "open dialog" heuristic), and the inline image upload already wraps its promise in `trackUnsavedWork` (`services/inlineImage.ts`). The series -> task sequence runs with the dialog open and `saving = true`. Nothing to add; never `useBlocker`.

### Card and sheet

- `TarefaCard`: `Repeat` icon (lucide) next to the title when `serie` != null, `title` = rule summary. Dashboard (`TodayCard`, `AgentPendingSection`) gets no icon in v1.
- `TarefaDetailSheet`: new meta row "Repetição" with summary, mode and state pill; a series actions menu (Pausar / Retomar / Encerrar série) per the states table. Under "Subtarefas", when `serie` != null: "As próximas ocorrências usam a lista da série. Para mudar, edite a tarefa e escolha Esta e as próximas." Nothing changes next to Responsável, but note: reassigning through the sheet/card/member board applies to this occurrence only, and in `ao_concluir` the next one reverts to the template's responsavel. Foreseeable complaint; answered by "Esta e as próximas".

### Scope dialogs (existing AlertDialog)

- **Edit** (on saving the form of an occurrence): title "Aplicar a quais tarefas?", description "Esta tarefa faz parte de uma série.", buttons "Somente esta" (disabled when the rule changed, with the helper text above), "Esta e as próximas", "Cancelar".
- **Delete** (sheet, when `serie` != null): title "Excluir tarefa recorrente?", options "Somente esta" (helper in `ao_concluir`: "A próxima ocorrência será criada normalmente."), "Toda a série" (destructive; helper: "Remove a série e as ocorrências abertas. As concluídas ficam."), "Cancelar". Standalone task: current dialog, unchanged.

### Flows per write path (what prompts and what does not)

The "Somente esta / Esta e as próximas" dialog is triggered **only by saving the Editar form**. Precise reading of decision 5: "editing" is the form; inline quick actions act on the occurrence alone and never prompt.

| Path | Behaviour |
|---|---|
| Kanban: drag to Concluída (`StatusKanbanView`) | completes this one; no dialog; `ao_concluir` spawns the next in the DB; refetch shows it |
| List: complete/reopen checkbox (`ListView`) | same |
| Sheet: status buttons, responsavel dropdown | this occurrence; no dialog |
| Card: responsavel dropdown; member board: drag | this occurrence; no dialog |
| Board/Calendar: drag to another date | this occurrence; no dialog; `23505` -> specific toast; `BoardView`'s "Sem data" column refuses a series occurrence with the toast "Tarefas de uma série precisam de prazo." (CHECK is the backstop) |
| Sheet: subtasks | this occurrence; no dialog (hint above) |
| Dashboard `TodayCard` complete / Desfazer | this occurrence; existing optimistic mutation; `onSettled` invalidates `['tarefas']` |
| Editar form | scope dialog |
| Sheet: Excluir | delete dialog |
| Bulk operations | none exist in the tarefas UI (verified: no multi-select). Nothing to specify |
| MCP `update_task` | this occurrence; no dialog (see MCP) |

## MCP (`supabase/functions/mcp`)

Creating series through the MCP is out of scope. Impact verified in `tools.ts` / `queries.ts`:

- `create_task` inserts without `serie_id` -> NULL -> standalone task. No change.
- `update_task` with `status: 'concluida'` on an `ao_concluir` occurrence fires the trigger (service_role; `auth.uid()` NULL -> responsavel notified). No code change; this is the expected behaviour.
- `update_task` with `data_limite: null` on a series occurrence violates `tarefas_serie_exige_prazo`. Today the error would surface generically; map `23514` on that constraint to `McpInputError("Tarefas de uma série precisam de prazo.")`. A `data_limite` equal to another occurrence's -> `23505` -> `McpInputError("Já existe uma ocorrência desta série nessa data.")`.
- `TASK_SELECT`/`list_tasks`: add `serie_id` to the projection (informational; no new tool). Optional.

## Testing

### SQL (`supabase/tests/entitlements/`, run by CI in `entitlement-tests`)

Three new suites, numbered after `98_` (numbering already repeats; the glob is `[0-9]*.sql` sorted):

- `99_tarefa_next_date.sql`: the 18 cases from the table, as the table owner (pure function).
- `99_tarefa_series_rls.sql` (`et_grant_hosted_parity()` first; `98_cliente_links_rls.sql` pattern): tenant isolation of `tarefa_series` (cross-tenant read, update, delete = 0 rows); WITH CHECK rejecting a foreign `responsavel_id`/`cliente_id` (`insufficient_privilege`); `tarefas` WITH CHECK rejecting a foreign `serie_id`; `anon` reads 0 rows; DEFINER function grants (anon/authenticated = false, service_role = true; `tarefa_serie_excluir` authenticated = true).
- `99_tarefa_series_geracao.sql` (as `authenticated` via `set_config('request.jwt.claims', ...)` + `set local role authenticated`, which also proves the DEFINER trigger fires without EXECUTE for the caller): (a) completing an `ao_concluir` occurrence creates the next one with tags, unchecked subtasks, template responsavel and cliente; (b) reopen + re-complete does not duplicate; (c) reopen + re-complete with "today" advanced creates no branch (open-occurrence guard); (d) late completion yields a future date (weekly Mon, occurrence 01-05 completed on 01-27 -> 02-02); (e) a paused series does not generate; resuming an `ao_concluir` series with no open occurrence generates; (f) `fim` cuts off; (g) a tag and a responsavel deleted before generation do not break it; (h) `calendario`: `proxima_data` computed on INSERT; `generate_recurring_tarefas()` with the cursor 10 days back creates only the most recent due date and advances the cursor past today; a second call creates 0; `fim` -> `proxima_data` NULL; (i) "Somente esta" delete of the only open occurrence spawns the next; `tarefa_serie_excluir` deletes open ones, keeps completed ones unlinked and spawns nothing; (j) `DELETE FROM workspaces` with a series + open occurrence does not fail; (k) toggling `pausada`/changing the rule recomputes `proxima_data` per the table; (l) CHECK `tarefas_serie_exige_prazo` and UNIQUE `tarefas_serie_data_uq`.

For "today" in tests: `tarefa_hoje_sp()` reads `now()`; the suite either pins dates relative to `current_date`, or the function honours a GUC override `app.tarefa_hoje` read with `current_setting(..., true)` (the pattern `auth.uid()` relies on in psql tests). Pick during implementation and document it.

### Vitest

- `recorrenciaLogic.test.ts`: `describeRecorrencia` for each freq, interval 1 and N, multiple days, end date.
- `TarefaFormDialog.test.tsx`: validations (rule without due date, weekly without a day, end before due date); creation calls `addTarefaSerie` then `addTarefa` with `serie_id`; editing an occurrence opens the scope dialog; "Somente esta" disabled with a dirty rule; "Esta e as próximas" calls `updateTarefa` + `updateTarefaSerie` with only the changed fields + rule + re-anchored `inicio`. This file's `'../../../store'` mock **does not use `importOriginal`**: every new store export must be added to the mock (`addTarefaSerie`, `updateTarefaSerie`, `getTarefaSerie`, `deleteTarefaSerieCompleta`).
- New `TarefaDetailSheet.test.tsx`: delete dialog with both options; "Toda a série" calls the rpc; Pausar/Retomar/Encerrar actions per state.
- `BoardView.test.tsx`: dropping a series occurrence on "Sem data" does not call `updateTarefa` and shows the toast.
- Existing fixtures: `serie: null`.

### Cron-health

No registration: the job is monitored by the mere `cron.schedule`. Rollout checklist: after the migration, `SELECT jobname, active FROM cron.job WHERE jobname = 'tarefas-recorrentes-generate'`, and on the following run `SELECT * FROM cron.job_run_details WHERE jobid = ... ORDER BY start_time DESC LIMIT 1` = `succeeded`.

## Rollout

1. Migrations with a prefix **above `20260925000023`** (current tail of `main`, already past today's date): `20260925000030_tarefa_series.sql` (table, `tarefas` columns, functions, triggers, grants, RPC) and `20260925000031_schedule_tarefas_recorrentes_cron.sql`. Re-check `main`'s tail when opening the PR (memory: version collision at PR-open time).
2. Staging first: `npx supabase db push --linked` (or out of band, see the staging ops memory), run `SELECT public.generate_recurring_tarefas()` by hand, create one series of each mode from the CRM pointed at staging.
3. Production: **migrations before merge** (merge deploys the frontend immediately; the new frontend embeds `tarefa_series` and would break without the table). No edge function to deploy. If `list_tasks` gains `serie_id`, redeploying `mcp` is optional and non-blocking.
4. Before pushing: lint, `format:check`, the four `tsc` runs, `npm run test`, `check:functions`, `test:functions` (even without function changes, if the MCP changes). `test:db` needs Docker locally; CI covers it.

## Files to touch (paths verified in the repo)

Database:
- `supabase/migrations/20260925000030_tarefa_series.sql` (new)
- `supabase/migrations/20260925000031_schedule_tarefas_recorrentes_cron.sql` (new)
- `supabase/tests/entitlements/99_tarefa_next_date.sql`, `99_tarefa_series_rls.sql`, `99_tarefa_series_geracao.sql` (new)
- `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql` (function array)

CRM:
- `apps/crm/src/store/tarefas.ts` (types, embed, series functions, `isSerieDateConflict`)
- `apps/crm/src/pages/tarefas/recorrenciaLogic.ts` (new, pure) + `__tests__/recorrenciaLogic.test.ts`
- `apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx` (Repetir section, scope dialog, series flow)
- `apps/crm/src/pages/tarefas/components/TarefaDetailSheet.tsx` (Repetição row, series actions, delete dialog)
- `apps/crm/src/pages/tarefas/components/TarefaCard.tsx` (icon)
- `apps/crm/src/pages/tarefas/views/BoardView.tsx`, `views/CalendarView.tsx` (Sem data + `23505`)
- `apps/crm/src/pages/tarefas/TarefasPage.tsx` (passes `refresh` and the series to the form; nothing structural)
- `apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`, `BoardView.test.tsx`, `TarefaCard.test.tsx`, `TarefasPage.test.tsx`, new `TarefaDetailSheet.test.tsx`; dashboard fixtures that build `TarefaWithRelations` (`apps/crm/src/pages/dashboard/**/__tests__`)

MCP (optional):
- `supabase/functions/mcp/queries.ts` (`TASK_SELECT`, `23514`/`23505` mapping in `updateTask`)

Unchanged: `vercel.json` (no new route), `App.tsx`, `nav-data.ts`, cron edge functions.

## Verified in code vs. assumed

Verified:
- Schema and RLS of `tarefas`/`subtarefas`/`tarefa_tags`/`tarefa_tag_links` (`20260730000005`), including the cross-tenant leak comment and the qualified-subquery pattern.
- `trg_notify_task_assigned` fires on INSERT (`WHEN NEW.responsavel_id IS NOT NULL`) and on reassignment; excludes the actor via `auth.uid()`; swallows failures with WARNING (`20260730000006`).
- `tarefas_sync_concluida_em` (BEFORE) and `sync_ideia_from_tarefa` (AFTER UPDATE OF status) already exist on `tarefas`.
- `descricao_rich` jsonb and `convert_solicitacao_em_tarefa` INVOKER with explicit REVOKE/GRANT (`20260915000001`).
- Six status write paths in the CRM + MCP, all invalidating `['tarefas']`; `BoardView` "Sem data" sets `data_limite = null`; `CalendarView`/`BoardView` drag changes `data_limite`; no bulk operations.
- `useOptimisticTarefas` drops overrides when a fresh list arrives.
- `TarefaFormDialog` does not pass `confirmClose`; `inlineImage.ts` wraps uploads in `trackUnsavedWork`; inline images are workspace `files` rows referenced by `r2Key`, with no per-task tracking (copying `descricao_rich` to N occurrences is safe).
- `cron-health-cron` scans every `failed` row of `cron.job_run_details` through `recent_cron_failures()`; there is no job registry. Existing pure-SQL jobs: `rate-limit-cleanup`, `cron-job-run-details-purge`.
- DEFINER lockdown pattern (`20260925000001`) and the `96_` suite; `et_grant_hosted_parity()` and why it exists.
- `tarefas` has no column-level GRANT; no `tarefas_v` view.
- MCP `createTask`/`updateTask` write directly with service_role, without `serie_id`.
- Migration tail on `main`: `20260925000023`.
- `supabase/config.toml` does not pin the Postgres `major_version`.

Assumed (confirm during implementation):
- Production Postgres may be < 15; hence the simple FK. If it is >= 15, a composite FK with `SET NULL (serie_id)` would be acceptable, but simple + EXISTS is precedented and version-independent.
- Triggers fire without an EXECUTE check at fire time (Postgres docs; `99_tarefa_series_geracao.sql` as `authenticated` is the empirical proof).
- `auth.uid()` returns NULL (not an error) without claims, as the psql tests already assume.
- PostgREST embeds through the simple FK `tarefas.serie_id -> tarefa_series` without ambiguity (only one FK between the two tables).

## Deviations from the brief (forced by the code or the analysis)

1. Simple `serie_id` FK + `EXISTS` in WITH CHECK instead of a composite FK: composite `ON DELETE SET NULL` would null the NOT NULL `conta_id` (same trap already documented in the 2026-07-30 spec).
2. Extra columns `encerrada_em` and `user_id` on `tarefa_series` (manual stop independent of `fim`; `tarefas.user_id` NOT NULL).
3. Hourly cron (`7 * * * *`) instead of daily: idempotent, indexed, recovers from a failed run within 1h. Swap the expression if the reviewer prefers daily.
4. The "Somente esta / Esta e as próximas" dialog is limited to the form save; inline actions (status, responsavel, date drag, subtasks) act on the occurrence without prompting. This is the operational reading of decision 5 and of the "kanban completes without a dialog" rule.
5. "Somente esta" delete of the only open occurrence in `ao_concluir` spawns the next (delete trigger) instead of leaving the series dormant with no UI to find it. "Toda a série" becomes an RPC so it can end the series before deleting.

## Open questions / risks

- **Orphan series at creation**: if `addTarefa` fails after `addTarefaSerie` and the best-effort delete also fails, an `ao_concluir` series is left without an occurrence and without UI. Cheap mitigation: `generate_recurring_tarefas()` could also scan `ao_concluir` series with no occurrence at all (open or completed) and materialize `inicio` when `inicio >= today - 1`. Decide in the plan; not blocking.
- **Firing order with `sync_ideia_from_tarefa`**: both are AFTER UPDATE OF status; order is alphabetical by trigger name and neither depends on the other. Record the chosen name so no accidental dependency is created.
- **`tarefa_hoje_sp()` in tests**: relying on `current_date` keeps catch-up and "today - 1" cases relative and readable, but the late-completion case needs absolute past dates. A GUC override is simpler; decide during implementation.
- **Volume**: a daily `calendario` series produces 365 tasks per year per workspace; `getTarefas()` fetches everything without pagination today. Not a regression of this feature, but series accelerate growth. Out of scope here; note it for the list revamp.
- **Weekly with `inicio` off-rule** (case 8): the first occurrence is the typed due date (Wednesday) and the second already follows the rule (Monday, week +2). Defined and tested, but may surprise; the form summary shows the rule only. Consider the copy "A primeira ocorrência é o prazo acima." in the Repetir section.

## Out of scope for v1

RRULE ("second Thursday of the month", "last business day"), "N times", creating/editing series through the MCP, advance reminders, a series screen (list/reopen ended ones), reopening an ended series, recurrence icon on the dashboard, per-occurrence mention propagation, plan gating.
