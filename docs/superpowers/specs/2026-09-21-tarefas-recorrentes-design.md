# Tarefas recorrentes: task series generated in the database

Date: 2026-09-21
Status: approved (owner sign-off 2026-09-21, including the calendario catch-up decision; Codex rounds 1 to 3 folded in; implementation plan: `docs/superpowers/plans/2026-09-21-tarefas-recorrentes.md`)
Builds on: `2026-07-30-tarefas-team-task-tracker-design.md` (tarefas, subtarefas, tags, `task_assigned` notification)

## Problem

Routine work (weekly report, monthly close, "review the calendar every Monday") has to be recreated by hand every cycle. The task tracker shipped without recurrence as a deliberate YAGNI (2026-07-30 spec). This document adds **task series**: a repeat rule plus a template, from which the database materializes occurrences. Every occurrence is an ordinary `tarefas` row, so it flows through all views, filters, notifications and the MCP unchanged.

## Decisions confirmed with the user

1. **Generation mode is chosen per series**: `ao_concluir` (the next occurrence is created when the current one is completed) or `calendario` (a job creates the occurrence on each rule date when it runs, regardless of whether the previous one was completed; after downtime or a pause only the most recent missed date is created, see "Product decision" under `calendario` mode).
2. **v1 patterns**: daily, weekly (chosen weekdays), monthly (day of month), yearly; each with "every N".
3. **End**: never, or an optional end date (`fim`). No "N times".
4. **Each occurrence copies everything from the series template**: title, rich description, responsavel, cliente, tags and subtasks (all unchecked); status resets to `pendente`.
5. **Editing** an occurrence that belongs to a series asks "Somente esta / Esta e as próximas"; **deleting** asks "Somente esta / Toda a série".

Out of scope for v1 (own section at the end): RRULE-style patterns ("second Thursday"), "N times", MCP creation of series, advance reminders, plan gating (tarefas has none today).

## Data model

### `tarefa_series` (new)

One row per series. **Writes are RPC-only.** RLS: `tarefa_series_tenant_select` is a SELECT-only policy (`FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()))`); there is **no** INSERT/UPDATE/DELETE policy for `authenticated`, plus an explicit `REVOKE ALL ON tarefa_series FROM PUBLIC, anon, authenticated` followed by `GRANT SELECT ... TO authenticated` and `GRANT ALL ... TO service_role` (needed because the hosted default ACL grants ALL: revoking only INSERT/UPDATE/DELETE would leave TRUNCATE, REFERENCES and TRIGGER, and TRUNCATE ignores RLS; without the REVOKE a missing policy would deny by filtering, with it the client gets `permission denied`). A `DO` post-condition in the migration asserts that `authenticated` holds exactly SELECT and `anon` nothing (pattern of `20260728000002`). `tarefa_series_service_role_bypass` as everywhere else. Every write goes through one of four SECURITY DEFINER RPCs (`tarefa_serie_criar`, `tarefa_serie_aplicar_edicao`, `tarefa_serie_definir_estado`, `tarefa_serie_excluir`), each of which derives `conta_id` from `get_my_conta_id()` and `user_id` from `auth.uid()` (never from parameters), raises when either is NULL, and validates itself that `responsavel_id`/`cliente_id` belong to that `conta_id` before writing. That validation replaces the `WITH CHECK EXISTS` clauses a `FOR ALL` policy would have carried; the reason is unchanged from the parent table: `resolve_notification_targets` reads `membros` by id without a `conta_id` check, and the materialized occurrence inherits the template's `responsavel_id`.

| Column | Type | Rule |
|---|---|---|
| `id` | bigserial PK | |
| `conta_id` | uuid NOT NULL -> workspaces ON DELETE CASCADE | immutable after insert (trigger) |
| `user_id` | uuid NOT NULL | creator; copied into `tarefas.user_id` (NOT NULL) on every occurrence; immutable after insert (trigger) |
| `freq` | text NOT NULL | CHECK IN (`daily`,`weekly`,`monthly`,`yearly`) |
| `intervalo` | int NOT NULL DEFAULT 1 | CHECK BETWEEN 1 AND 99 |
| `dias_semana` | int[] | 0 = Sunday ... 6 = Saturday (matches both `extract(dow)` and JS `Date.getDay()`); CHECK: `weekly` requires 1..7 distinct values in 0..6; other freqs require NULL |
| `dia_mes` | int | landing day; CHECK: `monthly` and `yearly` require 1..31; other freqs require NULL |
| `mes` | int | landing month; CHECK: `yearly` requires 1..12; other freqs require NULL |
| `modo` | text NOT NULL | CHECK IN (`ao_concluir`,`calendario`) |
| `inicio` | date NOT NULL | interval/phase anchor only (which weeks, months, years are eligible); never decides the landing day. Equals the first occurrence's `data_limite` at creation |
| `fim` | date | inclusive; CHECK `fim IS NULL OR fim >= inicio` |
| `pausada` | boolean NOT NULL DEFAULT false | |
| `encerrada_em` | timestamptz | manual stop ("Encerrar série"); one-way: once non-null it can neither be cleared nor moved back (trigger, all callers) |
| `proxima_data` | date | `calendario` cursor; **owned by the DB**: clients cannot write the table at all, and the identity-free guard trigger derives or retains it for every other writer (see "proxima_data is DB-owned"); NULL = series exhausted (next date would pass `fim`) |
| `titulo` | text NOT NULL | template; CHECK `btrim(titulo) <> '' AND length(titulo) <= 200` |
| `descricao` | text | template (plain-text projection) |
| `descricao_rich` | jsonb | template (TipTap); CHECK `descricao_rich IS NULL OR jsonb_typeof(descricao_rich) = 'object'` |
| `responsavel_id` | bigint -> membros ON DELETE SET NULL | simple FK, same reason as the parent table |
| `cliente_id` | bigint -> clientes ON DELETE SET NULL | idem |
| `tag_ids` | bigint[] NOT NULL DEFAULT '{}' | no FK; see "deleted tags" below; CHECK `array_position(tag_ids, NULL) IS NULL AND cardinality(tag_ids) <= 50` |
| `subtarefas` | jsonb NOT NULL DEFAULT '[]' | array of strings (titles only, in order); CHECK `tarefa_serie_subtarefas_validas(subtarefas)` |
| `created_at` / `updated_at` | timestamptz | trigger `set_tarefa_series_updated_at` |
| | | `CONSTRAINT tarefa_series_id_conta_uq UNIQUE (id, conta_id)` (house pattern; available for future composite child FKs) |

Indexes: `(conta_id)`, plus a partial `(proxima_data) WHERE modo = 'calendario' AND NOT pausada AND encerrada_em IS NULL AND proxima_data IS NOT NULL` for the cron scan.

Template shape is enforced at the row, not at generation time: the cron is all-or-nothing per run, so one malformed template would make `generate_recurring_tarefas()` raise for every series. `tarefa_serie_subtarefas_validas(jsonb) RETURNS boolean` is `IMMUTABLE` (CHECK constraints cannot contain subqueries, so the validation lives in a function): true iff the value is a JSON array with at most 50 elements, each a string with `btrim(...) <> ''` and length <= 200. Inserting `{}`, `[1]` or `[""]` fails.

`encerrada_em`, `user_id` and `mes` were not in the brief. `user_id` is required because `tarefas.user_id` is NOT NULL and the cron has no `auth.uid()`. `encerrada_em` separates "manual stop, effective now" from "planned end date" (`fim`): ending a series by setting `fim = today` would still let the cron create today's occurrence. `mes` (and `dia_mes` for yearly) exist because the landing day must be stored explicitly: if it were derived from `inicio`, re-anchoring `inicio` on an edited occurrence that fell on a clamped date (Feb 28 of a "day 31" series, Feb 28 of a Feb 29 yearly series) would silently rewrite the rule.

### `tarefas` (changes)

- `serie_id bigint REFERENCES tarefa_series(id) ON DELETE SET NULL`. **Simple FK, not composite**: the brief asked for `(serie_id, conta_id)`, but `ON DELETE SET NULL` on a composite FK nulls both columns and `conta_id` is NOT NULL, exactly the trap the 2026-07-30 spec recorded for `responsavel_id`/`cliente_id`. `ON DELETE SET NULL (serie_id)` exists only on PG 15+ and `supabase/config.toml` does not pin `major_version`. In exchange, `tarefas_tenant_all`'s `WITH CHECK` gains one more `EXISTS` set tying `serie_id` to the row's own `conta_id` (same pattern as the other two), kept as a second barrier. The first barrier is trigger `tarefas_serie_id_guard` BEFORE INSERT OR UPDATE OF serie_id ON tarefas, **SECURITY INVOKER**: when `current_user IN ('authenticated', 'anon')` and `NEW.serie_id IS DISTINCT FROM OLD.serie_id` (or is non-null on INSERT), raise. This is exactly the shape of `guard_financial_write()` (`20260728000002_financial_visibility_b_enforcement.sql`, lines ~206-238): in a SECURITY INVOKER trigger function `current_user` is the real caller, while a write issued from inside one of the SECURITY DEFINER RPCs runs as the owner and passes. It must never be made SECURITY DEFINER (then `current_user` would be the owner for every caller and the guard would be a no-op) and must never use `session_user` (the psql suites impersonate with `SET LOCAL ROLE`, which leaves `session_user` as `postgres`; `20260817000001_cliente_foto_manual_upload.sql`, lines ~105-155, documents both traps empirically). A direct `UPDATE tarefas SET serie_id = ...` from the client is therefore denied; the RPCs link and unlink. The `service_role` bypass and the MCP (which never writes `serie_id`) are unaffected.
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

Timezone convention: "today" is always `tarefa_hoje_sp()` = `(now() AT TIME ZONE 'America/Sao_Paulo')::date` (STABLE). pg_cron runs in UTC; Brazil has had no DST since 2019, so UTC-3 is fixed. For tests the function honours a transaction-local override: when `current_setting('app.tarefa_hoje', true)` is a non-empty string it is returned as a date instead (same GUC technique `auth.uid()` relies on in the psql suites). The override is harmless in production (nothing sets it) and lets the suites pin "today" to absolute dates for the late-completion and catch-up cases.

### `tarefa_next_date(...)`: the single source of date math

```
tarefa_next_date(p_freq text, p_intervalo int, p_dias_semana int[], p_dia_mes int, p_mes int,
                 p_inicio date, p_after date) RETURNS date
LANGUAGE plpgsql IMMUTABLE
```

Returns the **smallest rule date strictly greater than `p_after`**. **Closed-form, never a search from `inicio`**: a forward walk anchored on `inicio` would need thousands of steps for a daily series a few years old, so the cron and the completion trigger would fail on exactly the long-running series that matter. Every branch computes the answer with integer arithmetic and examines at most two candidate periods; any residual loop is bounded by that small constant proven from the arithmetic, never by elapsed time, and overrunning it is a real bug that may raise. Phase rules, all anchored on `p_inicio`; the landing day comes from `p_dia_mes`/`p_mes`, never from `p_inicio`. Normalization first: `after := greatest(p_after, inicio - 1)`, which makes "candidates are always `>= inicio`" fall out of the arithmetic (if `p_after < inicio`, the answer is the first rule date `>= inicio`: for `daily` that is `inicio` itself; for the others, `inicio` counts only if it falls on the rule).

- `daily`: `k := floor((after - inicio) / intervalo) + 1`, result `inicio + k*intervalo`. **True floor division, never SQL integer division**: `after` can be `inicio - 1` after normalization, and Postgres `/` on integers truncates toward zero (`(-1)/3 = 0`, which would give `k = 1` and return `inicio + intervalo` instead of `inicio`). Write it as `floor(x::numeric / n)::int`; the same applies to every division of a possibly negative numerator in `tarefa_next_date`/`tarefa_prev_date` (the week index after normalization can also be negative). With floor, `after >= inicio - 1` gives `k >= 0`.
- `weekly`: Mon-Sun weeks (`date_trunc('week', d)`; Sunday closes the week started on the previous Monday, consistent with the app's "Esta semana" bucket). Week index `w(d) := (date_trunc('week', d)::date - date_trunc('week', inicio)::date) / 7`; eligible weeks satisfy `w % intervalo = 0`. Let `wa := w(after)` (>= 0 after normalization) and `w1 := ceil(wa / intervalo) * intervalo` (first eligible week at or after `after`'s week). Candidate 1: if `w1 = wa`, the smallest weekday in `dias_semana` (ordered Mon..Sun, i.e. by `isodow`, Sunday last) that is strictly after `after` inside that week; if `w1 > wa`, the first weekday of week `w1`. Candidate 2 (only when candidate 1 does not exist): the first weekday of week `w1 + intervalo`. Exactly two candidate weeks at most. `inicio` need not fall on a rule day (the typed due date is the first occurrence regardless).
- `monthly`: month index `m(d) := (year(d)*12 + month(d)) - (year(inicio)*12 + month(inicio))`; eligible months satisfy `m % intervalo = 0`. `ma := m(after)`, `m1 := ceil(ma / intervalo) * intervalo`; candidate 1 = `make_date(y1, mo1, least(dia_mes, days_in_month(y1, mo1)))` for month index `m1`; if candidate 1 `<= after`, candidate 2 is the same for `m1 + intervalo`. At most two candidates. The clamp does not "stick": March goes back to 31.
- `yearly`: year index `ya := year(after) - year(inicio)`, `y1 := year(inicio) + ceil(ya / intervalo) * intervalo`; candidate 1 = `make_date(y1, mes, least(dia_mes, days_in_month(y1, mes)))`; if `<= after`, candidate 2 = same for `y1 + intervalo`. Feb 29 becomes Feb 28 in a non-leap year and returns to Feb 29 in the next leap year.
- Invalid `p_freq` raises.

Sibling with the mirrored arithmetic (floor instead of ceil) and the same parameter list except the last one, `tarefa_prev_date(p_freq, p_intervalo, p_dias_semana, p_dia_mes, p_mes, p_inicio, p_on_or_before date) RETURNS date`, returns the **largest rule date `<= p_on_or_before`** (and `>= inicio`), or NULL when none. It exists for the calendario catch-up (below), which needs "the most recent due date" without stepping; both functions live in the same migration and share the week/month/year index helpers.

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
| 13 | yearly (2, 29) | 2024-02-29 | 2024-02-29 | 2025-02-28 | Feb 29 -> Feb 28 |
| 14 | yearly (2, 29) | 2024-02-29 | 2027-02-28 | 2028-02-29 | back to Feb 29 |
| 15 | yearly (3, 10)/2 | 2026-03-10 | 2026-03-10 | 2028-03-10 | yearly interval |
| 16 | daily/1 | 2026-01-10 | 2026-01-01 | 2026-01-10 | after before inicio |
| 17 | weekly {1} | 2026-01-07 (Wed) | 2026-01-01 | 2026-01-12 | after before inicio, inicio off-rule |
| 18 | freq 'hourly' | | | raises | validation |
| 19 | monthly 31 | 2026-02-28 (re-anchored) | 2026-02-28 | 2026-03-31 | re-anchoring on a clamped date keeps day 31 |
| 20 | yearly (2, 29) | 2027-02-28 (re-anchored) | 2027-02-28 | 2028-02-29 | re-anchoring on a clamped date keeps Feb 29 |
| 21 | daily/1 | 2015-01-01 | 2026-09-21 | 2026-09-22 | 11-year-old series, closed form (assert wall time well under 10 ms) |
| 22 | daily/3 | 2015-01-01 | 2026-09-21 | 2026-09-24 | phase over 4281 days: 4281 = 3*1427, so 09-21 is on-rule and the next is +3 |
| 23 | weekly {1}/2 | 2021-09-20 (Mon) | 2026-09-21 (Mon) | 2026-09-28 | 5-year-old biweekly: week index 261 is odd, next eligible week is 262 (Monday 09-28) |
| 24 | monthly 31 | 2018-01-31 | 2026-09-21 | 2026-09-30 | 8-year-old monthly, clamp on the first candidate |
| 25 | yearly (2, 29) | 2000-02-29 | 2026-09-21 | 2027-02-28 | 26-year-old yearly, non-leap landing |
| 26 | prev_date daily/3 | 2015-01-01 | on_or_before 2026-09-22 | 2026-09-21 | sibling: largest rule date `<=` |
| 27 | prev_date weekly {1,3} | 2026-01-05 | on_or_before 2026-01-06 | 2026-01-05 | sibling inside a week |
| 28 | prev_date monthly 31 | 2026-01-31 | on_or_before 2026-01-30 | NULL | sibling before inicio |
| 29 | daily/3 | 2026-01-10 | 2026-01-01 | 2026-01-10 | floor division: `(-1)/3` must be `-1`, not `0` |
| 30 | daily/3 | 2026-01-10 | 2026-01-09 | 2026-01-10 | same, `after = inicio - 1` without normalization |
| 31 | prev_date daily/3 | 2026-01-10 | on_or_before 2026-01-12 | 2026-01-10 | floor on the sibling |
| 32 | monthly 15 | 2026-01-20 | 2026-01-01 | 2026-02-15 | landing day before the anchor day: first month has no candidate, takes month +1 |
| 33 | yearly (3, 10) | 2026-06-20 | 2026-01-01 | 2027-03-10 | landing before the anchor in the first year: takes year +1 |

### Shared materialization

```
tarefa_serie_materializar(p_serie_id bigint, p_data date) RETURNS bigint
SECURITY DEFINER, SET search_path = public
```

Reads the series, inserts the `tarefas` row (`conta_id`, `user_id` = `serie.user_id`, titulo, descricao, descricao_rich, `status = 'pendente'`, responsavel_id, cliente_id, `data_limite = p_data`, `serie_id`) with `ON CONFLICT ON CONSTRAINT tarefas_serie_data_uq DO NOTHING RETURNING id`. If nothing was inserted (already existed) it returns NULL and does **not** touch children. If inserted: `subtarefas` from the jsonb (ordem = position, `concluida = false`) and `tarefa_tag_links` via the JOIN against same-workspace `tarefa_tags`. It is the only writer of **generated** occurrences (completion trigger, delete trigger, resume trigger, cron). The first occurrence is written by `tarefa_serie_criar` (below), which scopes every row to the caller's workspace explicitly; `tarefa_serie_materializar` itself stays revoked from `authenticated` because it takes a bare series id and would otherwise let any user materialize into any series, i.e. write into another workspace.

```
tarefa_serie_garantir_aberta(p_serie_id bigint, p_after date) RETURNS bigint
SECURITY DEFINER, SET search_path = public
```

The `ao_concluir` helper ("make sure the series has exactly one open occurrence"). Locks the series row (`FOR UPDATE`; serializes two concurrent completions of the same series), returns without action when `modo <> 'ao_concluir'`, `pausada`, `encerrada_em IS NOT NULL`, or when **any open occurrence** (`status <> 'concluida'`) of the series exists, regardless of its `data_limite`. In `ao_concluir` there is by design at most one open occurrence, so an open one is always "the next", even if it was dragged to a date earlier than the one just completed. Otherwise `next = tarefa_next_date(rule, greatest(p_after, tarefa_hoje_sp()))`; if `next IS NULL` or `next > fim`, return; else materialize at `next`.

### `ao_concluir` mode

Trigger `tarefas_serie_ao_concluir` AFTER UPDATE OF status ON tarefas, `WHEN (NEW.serie_id IS NOT NULL AND NEW.status = 'concluida' AND OLD.status IS DISTINCT FROM 'concluida')`, SECURITY DEFINER function. Before calling the helper (which takes the row lock) it reads `modo` without a lock and returns if `calendario`, so completing a calendario occurrence never waits on the cron's scan. It fires for every path that writes status: kanban, list checkbox, sheet buttons, form (through `tarefa_serie_aplicar_edicao`, which updates the series **before** the task so the trigger sees the new template or the closed series), dashboard `TodayCard`, MCP `update_task` (service_role; `d.db` writes `status` directly, verified in `mcp/queries.ts`). It coexists with `sync_ideia_from_tarefa` (AFTER UPDATE OF status, `20260730000009`) and `tarefas_concluida_em` (BEFORE).

Next-date rule: **strictly after `greatest(data_limite, today)`**. Completing a weekly task three weeks late yields the next future Monday, not three overdue occurrences nor one overdue occurrence. Completing early (Friday's task done on Wednesday) computes from Friday, keeping the phase. Moving an occurrence's due date (Board/Calendar drag) does not shift the series: phase comes from `inicio`; the moved date only sets the "after" point. The one exception is "Esta e as próximas", which re-anchors `inicio` on the occurrence's current `data_limite` on purpose.

Idempotency and reopen: reopen + re-complete recomputes the same date -> `ON CONFLICT DO NOTHING`. Reopen + re-complete days later would compute a later date (because "today" moved): the "any open occurrence exists" guard blocks the duplicate branch; if the generated occurrence was itself already completed, it already spawned the following one and the guard sees that one. Invariant the suite proves: an `ao_concluir` series never has more than one open occurrence as a result of DB generation, whatever the dates of the open one (including a next occurrence dragged earlier than its predecessor).

"Somente esta" delete of the only open occurrence: without handling, the series would go dormant forever and v1 has no series screen to find it again. Decision: trigger `tarefas_serie_ao_excluir` AFTER DELETE ON tarefas `WHEN (OLD.serie_id IS NOT NULL AND OLD.status <> 'concluida')` calls the same helper with `p_after = OLD.data_limite`. Deleting a completed, historical occurrence never materializes anything (the `WHEN` excludes it; the suite proves it). Effect: "Somente esta" on an open occurrence in `ao_concluir` means "skip this one"; the next is created immediately, and the dialog says so. Two mandatory early returns in the function: (a) `NOT EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.conta_id)`: on `DELETE FROM workspaces` the order of sibling cascades (`tarefas` vs `tarefa_series`) is unspecified and the workspace row is already gone when the cascade reaches `tarefas`; without the guard the helper would insert a task pointing at a workspace mid-deletion and abort the workspace delete; (b) the helper already ignores series with `encerrada_em`, which is why the "Toda a série" RPC ends the series before deleting (below).

### `calendario` mode

```
generate_recurring_tarefas() RETURNS TABLE (series_processadas int, ocorrencias_criadas int)
SECURITY DEFINER, SET search_path = public
```

`today = tarefa_hoje_sp()`. Iterates `SELECT ... FROM tarefa_series WHERE modo = 'calendario' AND NOT pausada AND encerrada_em IS NULL AND proxima_data IS NOT NULL AND proxima_data <= today FOR UPDATE SKIP LOCKED`. For each series, **one closed-form call, no stepping loop**: `d := tarefa_prev_date(rule, least(today, coalesce(fim, today)))` (the most recent rule date `<= today` **and `<= fim`**). Since `proxima_data` is itself a rule date, `proxima_data <= today`, and the cursor is NULL once it would pass `fim` (so `proxima_data <= fim`), `d >= proxima_data` holds for every row the guard produced. The generator is still defensive about a row it did not produce (a hand-edited `proxima_data`, or a row older than a future rule change): when `d IS NULL OR d < proxima_data` it sets `proxima_data = NULL` (exhausted, a defined state, not an error) and continues with the next series, so one bad row never aborts the run and never reaches materialization with a NULL date. Otherwise it materializes at `d` (ON CONFLICT covers re-runs), then `proxima_data = tarefa_next_date(rule, d)` (> today by construction), or NULL when that passes `fim`. Capping the lookup at `fim` matters when the cron recovers after the end date: a daily series ending 2026-01-31 whose first run after downtime is 2026-02-02 still materializes 01-31 (the last eligible date) instead of being exhausted without it. A series paused or stalled for years costs the same as one that is one day behind.

**Product decision (owner-confirmed 2026-09-21): catch-up creates only the most recent missed date, never every missed date.** Rationale: the job is hourly, so a gap only happens after real downtime or a pause; backfilling a stack of overdue copies of a routine task ("fazer o relatório semanal" x4, all late) is noise nobody works through, and the one open occurrence already signals the routine is behind; pause/resume is meant to skip the missed dates, and resume re-anchors the cursor to the next rule date >= today (table below). The alternative (option B: materialize every missed date in a loop with a cap, e.g. 31 occurrences per series per run, carrying the cursor across runs) was considered and rejected for v1; it is recorded here only so a future request can be scoped (a change inside this function plus a cap test), not as an open question.

Failures: **no per-series `EXCEPTION WHEN OTHERS`.** The only possible failures are bugs (FK/CHECK; RLS does not apply to the owner, UNIQUE is handled, deleted responsavel/cliente become NULL, deleted tags are filtered). Swallowing per series would hide the failure from cron-health; aborting marks the run `failed`, the monitor alerts within 70 min, and the next run retries. The notification trigger has its own exception block and never aborts the insert.

Schedule (own migration `20260925000031`, idempotent in the `20260831000001_schedule_rate_limit_cleanup.sql` pattern: a `DO` block that calls `cron.unschedule('tarefas-recorrentes-generate')` if a `cron.job` row with that name exists, then `SELECT cron.schedule('tarefas-recorrentes-generate', '7 * * * *', $$SELECT public.generate_recurring_tarefas()$$)`). **Hourly, not daily** (design choice, not code-forced): the function is idempotent and the scan is on a partial index, so the cost is negligible; hourly bounds the wait after a failed run or after the migration deploy to 1h, and "today's" occurrence appears on the first run after midnight in Sao Paulo (00:07). Daily works identically if the reviewer prefers; only the cron expression changes.

### `proxima_data` is DB-owned

**The primary barrier is privileges, not identity.** After the `REVOKE ALL ON tarefa_series FROM PUBLIC, anon, authenticated` plus `GRANT SELECT ... TO authenticated` (and no write policy), a direct PostgREST write to `proxima_data`, `encerrada_em`, `user_id`, `conta_id` or any rule/template column dies with `permission denied` before any trigger runs. Trigger `tarefa_series_guard` BEFORE INSERT OR UPDATE ON tarefa_series is **SECURITY INVOKER** (it needs no elevated access: it only reads NEW/OLD and calls `tarefa_next_date`, which is IMMUTABLE and executable by every role) and **never branches on `current_user`**: inside a SECURITY DEFINER function `current_user` is the owner for every caller, so an identity check there would be unconditionally true or false (`20260817000001`, lines ~105-155, proves this against a live trigger). Its rules are deterministic and identity-free, and it stays as defense in depth for `service_role`, owner and future-RPC paths. It does three things:

1. **Cursor**, literally:
   - On **INSERT**: `NEW.proxima_data := tarefa_next_date(NEW rule, NEW.inicio)` when `modo = 'calendario'`, else NULL. Always derived; whatever the client sent (including a forged value through PostgREST) is ignored.
   - On **UPDATE** where one of the recompute events in the table below happened: `NEW.proxima_data := tarefa_next_date(NEW rule, p_after)` (or NULL when `modo` becomes `ao_concluir`).
   - **Normalization after every derivation** (INSERT, recompute, resume): `IF NEW.fim IS NOT NULL AND NEW.proxima_data > NEW.fim THEN NEW.proxima_data := NULL`. A cursor past `fim` must never be stored: the generator would select the series when the date arrives, `tarefa_prev_date(rule, least(today, fim))` would return a date before the cursor (or NULL), and without this rule a NULL due date would reach materialization and abort the whole run. Example: first occurrence on a Wednesday, weekly-Monday rule, `fim` on Thursday: the derived next Monday passes `fim`, so the series is born exhausted (`proxima_data` NULL) and the cron never touches it.
   - On **any other UPDATE**: `NEW.proxima_data := OLD.proxima_data`, explicitly retained, **unless** the transaction-local flag `current_setting('app.tarefa_cursor_writer', true) = 'on'` is set. `generate_recurring_tarefas()` is the only function that sets it (`PERFORM set_config('app.tarefa_cursor_writer', 'on', true)` immediately before its cursor UPDATE); the four RPCs and the other helpers never do, so their writes cannot move the cursor by accident. The flag is **not** a security boundary (any session can set a GUC); the privilege REVOKE above is the real barrier, and the flag only exists to keep the cron path working through an identity-free guard. Chosen over the alternative (a dedicated owner-only cursor function with no exception in the guard) because it is one line in the generator and keeps a single trigger as the only place that ever assigns `proxima_data`.
2. **`encerrada_em` is one-way**: if `OLD.encerrada_em IS NOT NULL` and `NEW.encerrada_em IS NULL OR NEW.encerrada_em < OLD.encerrada_em`, raise (all callers, including `service_role`). `tarefa_serie_excluir` and `tarefa_serie_definir_estado` only set it, so they are unaffected.
3. **Immutable identity**: `conta_id` and `user_id` may not change after insert; raise (all callers).

| Event | `p_after` used | Why |
|---|---|---|
| INSERT | `inicio` | the first occurrence (= `inicio`) is created in the same transaction by `tarefa_serie_criar` |
| rule changed (`freq`, `intervalo`, `dias_semana`, `dia_mes`, `mes`, `inicio`, `modo`, `fim`) | `greatest(inicio, today)` | "Esta e as próximas" re-anchors `inicio` on the edited occurrence; nothing in the past is generated. `fim` counts as a rule column so extending it revives an exhausted cursor and shortening it below the cursor nulls it (normalization above) |
| `pausada` true -> false | `greatest(inicio, today - 1)` | "today" counts **for the `calendario` cursor only**: resuming on a rule day generates today's occurrence on the next run; missed dates during the pause are skipped by design. `ao_concluir` behaves differently (next paragraph) |

Any double generation this could produce (e.g. rule edited on the day of an occurrence that already exists) dies on `tarefas_serie_data_uq`.

Trigger `tarefa_series_apos_retomar` AFTER UPDATE OF pausada ON tarefa_series, `WHEN (OLD.pausada AND NOT NEW.pausada AND NEW.modo = 'ao_concluir')`: calls `tarefa_serie_garantir_aberta(NEW.id, today - 1)`. Covers a series whose last occurrence was completed while paused (otherwise it would stay dormant). Because the helper always computes strictly after `greatest(p_after, today)`, an `ao_concluir` resume creates the **following** rule date, never today's: a weekly-Monday series resumed on Monday 2026-02-09 with no open occurrence gets 2026-02-16 (suite case (f)). The "today counts" rule in the table above applies only to the `calendario` cursor.

### Series states (derived; no `status` column)

| State (UI) | Condition | Sheet actions |
|---|---|---|
| Encerrada | `encerrada_em IS NOT NULL` | none (open occurrences remain editable as tasks) |
| Concluída | `encerrada_em IS NULL AND (fim < today OR (modo = 'calendario' AND proxima_data IS NULL))` | none |
| Pausada | `encerrada_em IS NULL AND pausada AND NOT Concluída` | Retomar série, Encerrar série |
| Ativa | `encerrada_em IS NULL AND NOT pausada AND NOT Concluída` | Pausar série, Encerrar série |

The states are mutually exclusive by precedence, top to bottom: **Encerrada > Concluída > Pausada > Ativa**. A `calendario` series whose final occurrence was generated on its `fim` date is Concluída (no Pausar/Encerrar), and a paused-but-exhausted series is Concluída, not Pausada. The derivation lives in **one** pure frontend function, `serieEstado(serie, today)` in `apps/crm/src/pages/tarefas/recorrenciaLogic.ts`, tested with one case per precedence edge; the card and the sheet use only it.

Sheet label copy: "Repete: {resumo}" followed by " · cria a próxima ao concluir" or " · cria em toda data da regra", plus a state pill ("Pausada", "Encerrada", "Termina em 31/12/2026", "Concluída").

### Create: one atomic RPC

```
tarefa_serie_criar(p_serie jsonb, p_tarefa jsonb, p_tag_ids bigint[], p_subtarefas text[],
                   p_tarefa_id bigint DEFAULT NULL) RETURNS TABLE (serie_id bigint, tarefa_id bigint)
SECURITY DEFINER, SET search_path = public
```

Replaces any client-side two-request sequence (the orphan-series failure mode is gone). The existing `addTarefa` is itself non-atomic (insert, then tag links, then `syncMentions` as separate requests); a series must not inherit that tail, which is exactly why creation moved into one RPC. Common preamble of all four series RPCs: `v_conta := get_my_conta_id()`, `v_user := auth.uid()`, raise if either is NULL; `conta_id`/`user_id` are never taken from parameters; `responsavel_id`/`cliente_id` from the payload must exist in `membros`/`clientes` with `conta_id = v_conta` or the RPC raises; `p_tag_ids` are filtered to `tarefa_tags` of `v_conta`. Creation rules: `p_tarefa.data_limite` is required and becomes `inicio`; `inicio >= tarefa_hoje_sp()` is enforced here too (the form validates first; the RPC is the backstop); `fim IS NULL OR fim >= inicio`. In one transaction:

- **New task**: insert the series (template from `p_serie`, `tag_ids`, `subtarefas = p_subtarefas` with blank and NULL entries dropped, the same filter the promotion path applies, so they never reach the table CHECK as a raw `23514`), then the first occurrence (`conta_id = v_conta`, `user_id = v_user`, `data_limite = inicio`, `serie_id`, tags via the same-workspace JOIN, subtasks from `p_subtarefas`).
- **Promotion** (`p_tarefa_id` given: a standalone task being edited with a rule chosen): **first** `SELECT ... FROM tarefas WHERE id = p_tarefa_id AND conta_id = v_conta FOR UPDATE`; raise unless the row exists, `serie_id IS NULL` (linking an occurrence of another series is rejected) and `status <> 'concluida'` (no status transition would ever fire the completion trigger and there is no series UI to recover a series with no open occurrence). Only then insert the series, apply `p_tarefa` to the task (its resulting `data_limite` must equal `inicio`), set `serie_id`, replace its tags and snapshot its existing subtask titles into the template. The row lock serializes two concurrent promotions of the same task: the second one sees `serie_id` set and raises.

The BEFORE trigger sets `proxima_data` from `inicio` in the same statement, so in `calendario` the cursor starts strictly after the first occurrence. Grants (all four RPCs, the `20260915000001` pattern): `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ... TO authenticated, service_role`. The `inicio >= today` rule keeps calendario from generating today's occurrence next to a typed past one and keeps the first occurrence from being born overdue.

Mentions and analytics stay client-side and run **after** the RPC succeeds, best-effort: `syncMentions('tarefa', tarefa_id, ...)` and `captureEvent('task_created')` are called by the store function once the RPC returns; `syncMentions` already catches and logs its own failure (`store/mentions.ts`), so a mention failure is unobservable to the store: no toast, never a creation failure and never a rollback. Generated occurrences never sync mentions (see Notifications).

### Edit, pause, resume, end

- **"Esta e as próximas" means "this task and the occurrences generated from now on."** In `calendario` occurrences are created just-in-time on their date and in `ao_concluir` the next one is created on completion, so at any moment the series has at most one or two open siblings; the option therefore does not rewrite existing rows. Already-created sibling occurrences keep their old values; a rule change only re-anchors generation.
- **"Esta e as próximas" is one transactional RPC**, so the completion trigger (if the same save also sets status `concluida`) sees the new template or the closed series:

```
tarefa_serie_aplicar_edicao(p_tarefa_id bigint, p_tarefa jsonb, p_tag_ids bigint[],
                            p_regra jsonb, p_encerrar boolean DEFAULT false) RETURNS void
SECURITY DEFINER, SET search_path = public
```

  `p_tarefa` is the **full** occurrence payload from the form (titulo, descricao, descricao_rich, responsavel_id, cliente_id, data_limite, status), `p_tag_ids` the full tag set, `p_regra` the whole rule section (freq, intervalo, dias_semana, dia_mes, mes, modo, fim). **No dirty tracking for the template**: choosing "Esta e as próximas" copies the entire current occurrence state into the template (titulo, descricao + descricao_rich, responsavel_id, cliente_id, `tag_ids := p_tag_ids`, `subtarefas := titles of the occurrence's current subtasks, in order`) plus the rule. A previous "Somente esta" change to the title, tags or checklist is therefore promoted on purpose: the user is saying "from this state onward". (The form's rule-dirty check only decides whether "Somente esta" is enabled.)

  Order inside, after the common preamble (`v_conta`, `v_user`, responsavel/cliente/tag validation): (0) lock the occurrence (`FOR UPDATE`, `conta_id = v_conta`, raise if `serie_id IS NULL`) and the series row; define the effective due date up front: an **omitted** `data_limite` key keeps the stored value; a key **present with JSON null** is an explicit clear, honoured only with `p_encerrar` ("Não repete" with the Prazo cleared: the occurrence is detached in the same UPDATE, `serie_id = NULL` and `data_limite = NULL` land together, so `tarefas_serie_exige_prazo` holds); without `p_encerrar` a NULL effective date raises "Tarefas de uma série precisam de prazo."; validate `p_regra.fim IS NULL OR fim >= v_data`. (1) Update the series: template from `p_tarefa` + `p_tag_ids` + subtask snapshot, rule from `p_regra`, `inicio := v_data` (re-anchors the phase; `dia_mes`/`mes` come from `p_regra`, so a clamped occurrence date never rewrites them). When `p_encerrar` ("Não repete" chosen): `encerrada_em = now()` on the series instead. (2) Update the `tarefas` row with `p_tarefa` (status and `data_limite = v_data` included; `serie_id = NULL` when `p_encerrar`; the completion trigger fires here and sees the updated or closed series). (3) Replace the occurrence's tags; subtasks of the occurrence are untouched (the form does not edit them). Due date and status apply to this occurrence only. In `calendario`, already-generated future open occurrences **stay untouched**; only the cursor moves (table above).
- **"Somente esta"**: `updateTarefa` + `setTarefaTags` only, as today. Does not detach (`serie_id` stays); the next occurrence still comes from the template. If the rule section is dirty, "Somente esta" is disabled with the helper text "A regra de repetição vale para toda a série."
- **"Não repete" chosen in the form of an occurrence**: always "Esta e as próximas" by construction; `tarefa_serie_aplicar_edicao(..., p_encerrar => true)`. The occurrence becomes a standalone task (icon disappears); other open occurrences stay linked to the ended series.
- **Rule chosen while editing a standalone task**: `tarefa_serie_criar(..., p_tarefa_id => id)`. No scope dialog.
- **Pausar / Retomar / Encerrar**: RPC `tarefa_serie_definir_estado(p_serie_id bigint, p_estado text) RETURNS void` (SECURITY DEFINER, same preamble and grants), `p_estado IN ('pausar', 'retomar', 'encerrar')`; locks the series row of `v_conta` (raise if not found or already `encerrada_em IS NOT NULL`), then sets `pausada = true`, `pausada = false`, or `encerrada_em = now()`. The triggers above do the rest (cursor recompute on resume, `tarefa_series_apos_retomar` for `ao_concluir`).
- **Encerrar série** copy: AlertDialog "Encerrar série?" / "As ocorrências já criadas continuam como estão. Nenhuma nova será criada." / "Encerrar".

### Delete

- **"Somente esta"**: `deleteTarefa(id)` as today. In `ao_concluir` the delete trigger may create the next one; the dialog says so.
- **"Toda a série"**: RPC `tarefa_serie_excluir(p_serie_id bigint) RETURNS void`, SECURITY DEFINER, `SET search_path = public`, same preamble (the series must belong to `v_conta`, else raise). Mandatory, atomic order: **lock every occurrence first** (`SELECT id FROM tarefas WHERE serie_id = p AND conta_id = v_conta ORDER BY id FOR UPDATE`, completed ones included) and only then the series row, the same tarefas -> series order as `tarefa_serie_aplicar_edicao` and the completion/delete triggers (the final `DELETE` of the series fires `ON DELETE SET NULL`, an UPDATE on every occurrence including completed ones, so locking series-first can cycle with an edit of a completed occurrence and die with `40P01`; verified with two sessions). Accepted residual: an occurrence spawned after that SELECT and locked by a third session is resolved by Postgres' own deadlock detection. Then `UPDATE tarefa_series SET encerrada_em = now()` (disarms the delete trigger) -> `DELETE FROM tarefas WHERE serie_id = p AND conta_id = v_conta AND status <> 'concluida'` -> `DELETE FROM tarefa_series WHERE id = p` (FK SET NULL unlinks the completed ones). Completed occurrences survive as standalone tasks: they are history ("concluídas hoje", reports). Grants as `tarefa_serie_criar`.

### Notifications

Verified in `20260730000006`: `notify_task_assigned_insert` is AFTER INSERT `WHEN (NEW.responsavel_id IS NOT NULL)` and calls `insert_notification_batch(..., auth.uid())`, which excludes the actor. Therefore:

- Occurrence generated by the cron: `auth.uid()` is NULL under pg_cron -> the responsavel **is notified**. Night runs (00:07 SP) produce night notifications; the notification email has its own cadence (`notification-email-cron`) and does not change here. Noted only; not a v1 problem.
- Occurrence generated by completion (`ao_concluir`): `auth.uid()` = whoever completed. If the responsavel completed their own task, they are **not** notified about the next one (already the self-assignment rule). If someone else completed it, the responsavel is notified.
- Mentions: generated occurrences do not go through `syncMentions` (client-side). @mentions in the template description do not re-notify per occurrence. Known gap, accepted.
- `captureEvent('task_created')` does not fire for generated rows; for the first occurrence it fires client-side after `tarefa_serie_criar` returns. Accepted.

### Security and grants

- SECURITY DEFINER functions (`tarefa_serie_materializar`, `tarefa_serie_garantir_aberta`, `generate_recurring_tarefas`, the trigger functions on `tarefas` completion/delete and `tarefa_series_apos_retomar`; **not** the two guards, which are SECURITY INVOKER by design): `SET search_path = public`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role` (memory: REVOKE FROM PUBLIC does not strip `service_role`'s implicit grant; roles must be named). Triggers fire without an EXECUTE check at fire time (the check happens at `CREATE TRIGGER`); the suite proves this by completing as `authenticated`. Names go into the array in `96_lockdown_definer_function_grants.sql` (or a sibling suite).
- Client-facing SECURITY DEFINER RPCs (`tarefa_serie_criar`, `tarefa_serie_aplicar_edicao`, `tarefa_serie_definir_estado`, `tarefa_serie_excluir`): `SET search_path = public`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ... TO authenticated, service_role`. Because they bypass RLS, tenant scoping is explicit in each: `conta_id` from `get_my_conta_id()`, `user_id` from `auth.uid()`, every referenced `tarefas`/`tarefa_series`/`membros`/`clientes`/`tarefa_tags` row filtered by that `conta_id`, raise on NULL context. This is the same threat model the MCP already handles by hand (`assertMembroInWorkspace` in `mcp/queries.ts`) because service-role writes skip WITH CHECK.
- `tarefa_series` table privileges: SELECT-only policy for `authenticated`; `REVOKE ALL ON tarefa_series FROM PUBLIC, anon, authenticated` then `GRANT SELECT ... TO authenticated` and `GRANT ALL ... TO service_role`, so a direct write (or TRUNCATE) is `permission denied` rather than a silent 0-row filter, plus a `DO` post-condition that fails the migration if `authenticated` holds anything but SELECT or `anon` holds anything. `tarefas.serie_id` is protected by `tarefas_serie_id_guard` (trigger) plus the WITH CHECK `EXISTS`.
- `tarefa_next_date`, `tarefa_prev_date`, `tarefa_hoje_sp` (and the pure validators/helpers `tarefa_month_landing`, `tarefa_serie_subtarefas_validas`, `tarefa_serie_dias_semana_validos`, `tarefa_serie_jsonb_int_array`): no data access; they keep the default PUBLIC EXECUTE. Two reasons: the SECURITY INVOKER guard `tarefa_series_guard` calls `tarefa_next_date`/`tarefa_hoje_sp` as whatever role issued the write, so every writer role must be able to execute them; and the CHECK constraints call the validators in the same way. Revoking from `anon` would be a no-op anyway (the grant is on PUBLIC) and buys nothing: the functions are pure and read no table.
- Tables: `tarefas` has **no** column-level GRANT allowlist (verified: no `GRANT ... ON tarefas` in migrations; the CLAUDE.md gotcha is `membros`/`clientes` only). The new `tarefas` columns rely on the same implicit mechanism (hosted default ACL). `tarefa_series` resets its privileges explicitly (above). The psql suite needs `et_grant_hosted_parity(array['tarefa_series'])` so the helper does not hand the write privileges back (same exclusion trick as `98_cliente_links_rls.sql`), and it strips `ALL` before granting SELECT (suite 92 commits `ALL` on every public table for the rest of a harness run) and asserts the exact privilege set of `authenticated` (SELECT only; no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER). Known limitation: locally there is no default-ACL grant to revoke, so the suite proves the missing write policy plus the absence of a grant, not the REVOKE against the hosted default ACL itself; the migration's `DO` post-condition is what fails a hosted push on a leftover privilege. That REVOKE is exercised only in staging/production (an UPDATE from the CRM must fail with `permission denied`, part of the rollout checklist).
- Nothing is exposed to `anon` beyond what RLS already denies (no anon policy).

## Frontend (CRM)

### Store (`apps/crm/src/store/tarefas.ts`)

- `Tarefa` gains `serie_id?: number | null`. `TarefaWithRelations` gains `serie: TarefaSerieResumo | null` (nullable; **every** existing fixture needs `serie: null`: `BoardView.test`, `TarefaCard.test`, `TarefasPage.test`, dashboard tests).
- `getTarefas()` embeds `tarefa_series(id, freq, intervalo, dias_semana, dia_mes, mes, modo, inicio, fim, pausada, encerrada_em, proxima_data)` (simple FK; `subtarefas` already proves composite embeds work too) and flattens it into `serie`.
- New types `TarefaSerie` (full row) and `TarefaSerieRegra` (rule subset).
- New functions (plain async, house style; every write is an `rpc()` call, the store never inserts/updates `tarefa_series` directly): `criarTarefaSerie(serie, tarefa, tagIds, subtarefas, tarefaId?)` (rpc `tarefa_serie_criar`), `aplicarEdicaoSerie(tarefaId, tarefaFull, tagIds, regra, encerrar)` (rpc `tarefa_serie_aplicar_edicao`, full payload, no diffing), `definirEstadoSerie(id, 'pausar' | 'retomar' | 'encerrar')` (rpc `tarefa_serie_definir_estado`), `deleteTarefaSerieCompleta(id)` (rpc `tarefa_serie_excluir`). No `getTarefaSerie`: the `tarefa_series(...)` embed on `getTarefas()` already carries the whole rule (`TarefaSerieResumo`), which is all the edit form needs; the template columns are never edited from the form (the RPC snapshots them from the occurrence).
- Helper `isSerieDateConflict(e)`: `e.code === '23505'` and the message names `tarefas_serie_data_uq`. Used by the form, `BoardView` and `CalendarView` for the toast "Já existe uma ocorrência desta série nesse dia."
- Query keys: nothing new. Every series mutation invalidates `['tarefas']` (the embed lives there). `['subtarefas', id]` as today.
- A completion in `ao_concluir` creates a row server-side: **all six completion paths already invalidate `['tarefas']`** (`onRefresh()` in `StatusKanbanView`/`ListView`/sheet/`TarefaCard`, `onSettled` in `TodayCard`; verified). `useOptimisticTarefas` drops overrides when the fresh list arrives, so the new occurrence simply shows up on refetch. No hook change. The toast stays "Tarefa concluída!" (the client cannot know whether the DB created the next one: fim, pause).

### `TarefaFormDialog`: "Repetir" section

Below Prazo/Status, above Tags. **Hidden when the dialog runs in conversion mode (`!!onCreate`)**: `IdeiaDrawer` passes `onCreate={handleConvertCreate}`, which calls `convert_solicitacao_em_tarefa` (verified, `apps/crm/src/components/ideias/IdeiaDrawer.tsx`); that RPC has no recurrence inputs and stays out of `tarefa_serie_criar`. A converted task can be promoted to a series later through the edit form.

- `Select` "Repetir": Não repete / Diariamente / Semanalmente / Mensalmente / Anualmente.
- When != Não repete: a line "a cada [N] dia(s)/semana(s)/mês(es)/ano(s)" (numeric input 1..99); for Semanalmente, weekday chips (D S T Q Q S S; `dias_semana` 0..6); for Mensalmente the text "Todo dia {dia_mes}" and for Anualmente "Todo ano em {dia_mes}/{mes}"; `DatePicker` "Termina em" (placeholder "Nunca"); a mode toggle with two labels: "Criar a próxima ao concluir" / "Criar em toda data da regra", plus a help line: "Ao concluir: a próxima tarefa só aparece quando esta for concluída. Toda data: a tarefa aparece na data, mesmo com a anterior aberta."
- Landing day/month: in create mode and when promoting a standalone task, `dia_mes`/`mes` derive from Prazo at save time. In edit mode they load from the series row and **changing Prazo does not change them**; the "Todo dia {N}" text shows the series value, not the occurrence's day (a Feb 28 occurrence of a "day 31" series still reads "Todo dia 31").
- A plain-text summary below the section, built by `describeRecorrencia(regra)` in `apps/crm/src/pages/tarefas/recorrenciaLogic.ts` (pure, tested): "Todo dia", "A cada 3 dias", "Toda segunda e quarta", "A cada 2 semanas, na sexta", "Todo dia 15", "A cada 3 meses, no dia 31 (ou último dia)", "Todo ano em 10/03", with the suffix " até 31/12/2026" when there is an end. **No next-date computation on the client.**
- Validation (zod, `superRefine`): rule != never requires `data_limite` ("Defina um prazo: ele será a primeira ocorrência."); a **new** series (create or promotion) requires `data_limite >= today` ("Para repetir, o prazo precisa ser hoje ou depois."); Semanalmente requires >= 1 day ("Escolha ao menos um dia da semana."); `intervalo` integer 1..99 ("Use um número de 1 a 99."); `fim >= data_limite` ("A data final precisa ser igual ou depois do prazo.").
- Editing an occurrence: the section loads the series rule from `editing.serie` (the embed). The save button opens the scope dialog (below) instead of saving directly.
- Editing a standalone task whose status is `concluida`: the "Repetir" select is disabled with the hint "Reabra a tarefa para torná-la recorrente." (mirrors the RPC's raise; a series must start from an open occurrence).
- `useUnsavedWork`: the form is a `DialogContent` (covered by `installSilentUpdate`'s "open dialog" heuristic), and the inline image upload already wraps its promise in `trackUnsavedWork` (`services/inlineImage.ts`). The RPC runs with the dialog open and `saving = true`. Nothing to add; never `useBlocker`.

### Card and sheet

- `TarefaCard`: `Repeat` icon (lucide) next to the title when `serie` != null, `title` = rule summary. Dashboard (`TodayCard`, `AgentPendingSection`) gets no icon in v1.
- `TarefaDetailSheet`: new meta row "Repetição" with summary, mode and state pill; two inline buttons under the row per the states table: Pausar série or Retomar série, plus Encerrar série (with the confirmation dialog below); no menu. Under "Subtarefas", when `serie` != null: "As próximas ocorrências usam a lista da série. Para mudar, edite a tarefa e escolha Esta e as próximas." Nothing changes next to Responsável, but note: reassigning through the sheet/card/member board applies to this occurrence only, and in `ao_concluir` the next one reverts to the template's responsavel. Foreseeable complaint; answered by "Esta e as próximas".

### Scope dialogs (existing AlertDialog)

- **Edit** (on saving the form of an occurrence): title "Aplicar a quais tarefas?", description "As próximas tarefas criadas usarão estas alterações. Tarefas que já existem não mudam.", buttons "Somente esta" (disabled when the rule changed, with the helper text above), "Esta e as próximas", "Cancelar".
- **Delete** (sheet, when `serie` != null): title "Excluir tarefa recorrente?", options "Somente esta" (helper shown only when the occurrence is open and the series is `ao_concluir`: "A próxima ocorrência será criada normalmente."), "Toda a série" (destructive; helper: "Remove a série e as ocorrências abertas. As concluídas ficam."), "Cancelar". Standalone task: current dialog, unchanged.

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
| Editar form | scope dialog; "Esta e as próximas" = `tarefa_serie_aplicar_edicao` |
| Conversion from an ideia (`onCreate`) | Repetir hidden; `convert_solicitacao_em_tarefa` unchanged |
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

- `99_tarefa_next_date.sql`: the 33 cases from the table (next and prev), as the table owner (pure functions). Cases 21 to 25 exist to catch a regression to a stepping search: they must pass and stay fast; cases 29 to 33 pin floor division and the normalization for a landing day before the anchor.
- `99_tarefa_series_rls.sql` (`et_grant_hosted_parity(array['tarefa_series'])` first; `98_cliente_links_rls.sql` pattern): as `authenticated`, cross-tenant SELECT = 0 rows and `anon` reads 0 rows; direct INSERT, UPDATE and DELETE on `tarefa_series` raise `insufficient_privilege` (permission denied, not a 0-row filter), which also proves a forged `user_id`, a past `inicio` and a direct rule or `proxima_data` edit are impossible from the client; direct `UPDATE tarefas SET serie_id = ...` (link, relink and unlink) raises from `tarefas_serie_id_guard`; RPC grants: the four series RPCs authenticated = true, anon = false; the internal DEFINER functions anon/authenticated = false, service_role = true; RPC tenant scoping: `tarefa_serie_criar` with a foreign `responsavel_id`/`cliente_id` raises, `tarefa_serie_aplicar_edicao`/`definir_estado`/`excluir` on another workspace's rows raise (not found), a session with no workspace raises. Guard trigger as `service_role` (the only remaining direct writer besides the owner): `proxima_data` set together with an unrelated field is retained, a forged `proxima_data` on INSERT is overwritten with the derived value, clearing or moving back a non-null `encerrada_em` raises, changing `conta_id` or `user_id` raises; with `set_config('app.tarefa_cursor_writer', 'on', true)` in the transaction the cursor UPDATE is kept (the cron path); a write to `tarefas.serie_id` issued from inside a DEFINER RPC passes `tarefas_serie_id_guard` while the same statement as `authenticated` raises. Cursor normalization: a series inserted with `fim` before its first rule-generated date has `proxima_data` NULL; a rule edit or a resume whose next date passes `fim` yields NULL; shortening `fim` below the cursor nulls it and extending it back revives it. Template CHECKs: `subtarefas` of `{}`, `[1]`, `[""]` and 51 items fail, `tag_ids` with a NULL fails, blank `titulo` fails, `descricao_rich` of `[]` fails.
- `99_tarefa_series_geracao.sql` (as `authenticated` via `set_config('request.jwt.claims', ...)` + `set local role authenticated`, which also proves the DEFINER trigger fires without EXECUTE for the caller): (a) `tarefa_serie_criar` creates series + first occurrence with tags and subtasks in one call, with `p_tarefa_id` links an existing open standalone task and snapshots its subtasks, raises for a `concluida` task, raises when the task is already an occurrence of another series, and two concurrent promotions of the same task are serialized by the row lock (second raises); (b) completing an `ao_concluir` occurrence creates the next one with tags, unchecked subtasks, template responsavel and cliente; (c) reopen + re-complete does not duplicate; (d) reopen + re-complete with "today" advanced creates no branch (open-occurrence guard); (d2) drag the generated next occurrence to a date earlier than its predecessor, then complete the predecessor: still exactly one open occurrence; (e) late completion yields a future date (weekly Mon, occurrence 01-05 completed on 01-27 -> 02-02); (e2) very late completion: an `ao_concluir` daily series whose open occurrence is dated 1200+ days ago, completed today, creates the next occurrence (tomorrow) without error; (f) a paused series does not generate; resuming an `ao_concluir` series with no open occurrence generates the following rule date (weekly Mon resumed on Mon 02-09 -> 02-16); (g) `fim` cuts off; (h) a tag and a responsavel deleted before generation do not break it; (i) `calendario`: `proxima_data` computed on INSERT strictly after `inicio`; `generate_recurring_tarefas()` with the cursor 10 days back creates only the most recent due date and advances the cursor past today; with the cursor 3 years back (daily) it creates exactly one occurrence and finishes instantly; a second call creates 0; `fim` -> `proxima_data` NULL; recovery after `fim`: a daily series with `fim` 2026-01-31 and cursor 2026-01-25 run with today = 2026-02-02 creates exactly one occurrence dated 2026-01-31 and leaves `proxima_data` NULL, and a second run creates nothing; a weekly series with `fim` between two rule dates creates the last rule date `<= fim`; a series whose `fim` is before the run day but whose cursor equals `fim` still materializes it; a hand-forced (owner, cursor flag on) row with `proxima_data > fim` is exhausted by the run without raising while another due series in the same run is still processed; (j) "Somente esta" delete of the only open occurrence spawns the next; deleting a completed historical occurrence spawns nothing; `tarefa_serie_excluir` deletes open ones, keeps completed ones unlinked and spawns nothing; (k) `DELETE FROM workspaces` with a series + open occurrence does not fail; (l) toggling `pausada`/changing the rule recomputes `proxima_data` per the table; (m) CHECK `tarefas_serie_exige_prazo` and UNIQUE `tarefas_serie_data_uq`; (n) one `tarefa_serie_aplicar_edicao` call that sets status `concluida` and changes the template creates the next occurrence from the **new** template; one call that completes and passes `p_encerrar` creates nothing and leaves the occurrence with `serie_id` NULL; a call after a "Somente esta" tag/title change promotes that state into the template; a call whose `p_tarefa.data_limite` moves the due date uses the new date as `inicio` and rejects `fim` before it; (n2) `tarefa_serie_definir_estado`: pausar/retomar/encerrar per the states table, encerrar twice raises; (o) re-anchoring `inicio` on a clamped date via `aplicar_edicao` keeps `dia_mes`/`mes` (cases 19 and 20 end to end); (i2) a paused, an ended and a forced-cursor `ao_concluir` series are not generated and keep their cursor; (i3) a pre-existing occurrence on the due date makes the run create 0 and still advance the cursor (ON CONFLICT path); (q) `aplicar_edicao` with an explicit JSON null `data_limite`: with `p_encerrar` the occurrence ends up detached with a NULL prazo, an omitted key keeps the old prazo, and without `p_encerrar` it raises; (r) `criar` drops blank and NULL subtasks; `excluir` on a series with completed and open occurrences leaves the completed ones unlinked and removes the rest.

For "today" in tests: the suites set `select set_config('app.tarefa_hoje', '2026-01-27', true)` inside their transaction and `tarefa_hoje_sp()` returns that date (decided; see the timezone convention above).

### Vitest

- `recorrenciaLogic.test.ts`: `describeRecorrencia` for each freq, interval 1 and N, multiple days, end date.
- `TarefaFormDialog.test.tsx`: validations (rule without due date, past due date on a new series, weekly without a day, end before due date); creation calls `criarTarefaSerie` once; editing an occurrence opens the scope dialog; "Somente esta" disabled with a dirty rule; "Esta e as próximas" calls `aplicarEdicaoSerie` with the full occurrence payload, full tag set and the whole rule (no diffing); edit mode keeps `dia_mes` when Prazo changes; **Repetir is absent when `onCreate` is passed**; Repetir is disabled with the "Reabra a tarefa" hint when editing a `concluida` standalone task. This file's `'../../../store'` mock **does not use `importOriginal`**: every new store export must be added to the mock (`criarTarefaSerie`, `aplicarEdicaoSerie`, `definirEstadoSerie`, `deleteTarefaSerieCompleta`, `isSerieDateConflict`, `isSerieSemPrazo`).
- New `TarefaDetailSheet.test.tsx`: delete dialog with both options; "Toda a série" calls the rpc; Pausar/Retomar/Encerrar call `definirEstadoSerie` with the right verb per state.
- `BoardView.test.tsx`: dropping a series occurrence on "Sem data" does not call `updateTarefa` and shows the toast.
- Existing fixtures: `serie: null`.

### Cron-health

No registration: the job is monitored by the mere `cron.schedule`. Rollout checklist: after the migration, `SELECT jobname, active FROM cron.job WHERE jobname = 'tarefas-recorrentes-generate'`, and on the following run `SELECT * FROM cron.job_run_details WHERE jobid = ... ORDER BY start_time DESC LIMIT 1` = `succeeded`.

## Rollout

1. Migrations with a prefix **above `20260925000023`** (current tail of `main`, already past today's date): `20260925000030_tarefa_series.sql` (table, `tarefas` columns, functions, triggers, grants, RPCs) and `20260925000031_schedule_tarefas_recorrentes_cron.sql`. Re-check `main`'s tail when opening the PR (memory: version collision at PR-open time).
2. Staging first: `npx supabase db push --linked` (or out of band, see the staging ops memory), run `SELECT public.generate_recurring_tarefas()` by hand, create one series of each mode from the CRM pointed at staging.
3. Production: **migrations before merge** (merge deploys the frontend immediately; the new frontend embeds `tarefa_series` and calls the RPCs, and would break without them). No edge function to deploy. If `list_tasks` gains `serie_id`, redeploying `mcp` is optional and non-blocking.
4. Before pushing: lint, `format:check`, the four `tsc` runs, `npm run test`, `check:functions`, `test:functions` (even without function changes, if the MCP changes). `test:db` needs Docker locally; CI covers it.

### Rollback

Order matters because the job runs hourly: **unschedule first**, so the cron never calls a removed object and cron-health does not alert on the rollback itself.

1. `SELECT cron.unschedule('tarefas-recorrentes-generate');`
2. Drop the triggers (`tarefas_serie_ao_concluir`, `tarefas_serie_ao_excluir`, `tarefas_serie_id_guard` on `tarefas`; `tarefa_series_guard`, `tarefa_series_apos_retomar`, `set_tarefa_series_updated_at` on `tarefa_series`).
3. Drop the RPCs, generator, helpers and trigger functions (the four RPCs, `generate_recurring_tarefas`, `tarefa_serie_garantir_aberta`, `tarefa_serie_materializar`, `tarefa_serie_validar_refs`, `tarefa_serie_parse_dias_semana`, the trigger functions).
4. Recreate `tarefas_tenant_all` without the `serie_id` `EXISTS` (it depends on the column, so it goes before it), then drop the `tarefas` constraints and column (`tarefas_serie_data_uq`, `tarefas_serie_exige_prazo`, `serie_id`; the column drop also removes the FK and its index).
5. `DROP TABLE tarefa_series`, and only then the validators its CHECKs reference (`tarefa_serie_subtarefas_validas`, `tarefa_serie_dias_semana_validos`, `tarefa_serie_jsonb_int_array`) and the pure date functions (`tarefa_next_date`, `tarefa_prev_date`, `tarefa_month_landing`, `tarefa_hoje_sp`). Dropping a validator first fails with `2BP01`.
6. Frontend: revert the merge (the store calls RPCs that no longer exist).

## Files to touch (paths verified in the repo)

Database:
- `supabase/migrations/20260925000030_tarefa_series.sql` (new)
- `supabase/migrations/20260925000031_schedule_tarefas_recorrentes_cron.sql` (new)
- `supabase/tests/entitlements/99_tarefa_next_date.sql`, `99_tarefa_series_rls.sql`, `99_tarefa_series_geracao.sql` (new)
- `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql` (function array)

CRM:
- `apps/crm/src/store/tarefas.ts` (types, embed, series functions, `isSerieDateConflict`)
- `apps/crm/src/pages/tarefas/recorrenciaLogic.ts` (new, pure) + `__tests__/recorrenciaLogic.test.ts`
- `apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx` (Repetir section hidden under `onCreate`, scope dialog, series RPC calls)
- `apps/crm/src/pages/tarefas/components/TarefaDetailSheet.tsx` (Repetição row, series actions, delete dialog)
- `apps/crm/src/pages/tarefas/components/TarefaCard.tsx` (icon)
- `apps/crm/src/pages/tarefas/views/BoardView.tsx`, `views/CalendarView.tsx` (Sem data + `23505`)
- `apps/crm/src/pages/tarefas/TarefasPage.tsx` (passes `refresh` and the series to the form; nothing structural)
- `apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`, `BoardView.test.tsx`, `TarefaCard.test.tsx`, `TarefasPage.test.tsx`, new `TarefaDetailSheet.test.tsx`; dashboard fixtures that build `TarefaWithRelations` (`apps/crm/src/pages/dashboard/**/__tests__`)

MCP (optional):
- `supabase/functions/mcp/queries.ts` (`TASK_SELECT`, `23514`/`23505` mapping in `updateTask`)

Unchanged: `vercel.json` (no new route), `App.tsx`, `nav-data.ts`, cron edge functions, `apps/crm/src/components/ideias/IdeiaDrawer.tsx` (conversion path untouched).

## Verified in code vs. assumed

Verified:
- Schema and RLS of `tarefas`/`subtarefas`/`tarefa_tags`/`tarefa_tag_links` (`20260730000005`), including the cross-tenant leak comment and the qualified-subquery pattern.
- `trg_notify_task_assigned` fires on INSERT (`WHEN NEW.responsavel_id IS NOT NULL`) and on reassignment; excludes the actor via `auth.uid()`; swallows failures with WARNING (`20260730000006`).
- `tarefas_sync_concluida_em` (BEFORE) and `sync_ideia_from_tarefa` (AFTER UPDATE OF status) already exist on `tarefas`.
- `descricao_rich` jsonb and `convert_solicitacao_em_tarefa` INVOKER with explicit REVOKE/GRANT (`20260915000001`); `IdeiaDrawer` drives conversion through `TarefaFormDialog`'s `onCreate` prop.
- Six status write paths in the CRM + MCP, all invalidating `['tarefas']`; `BoardView` "Sem data" sets `data_limite = null`; `CalendarView`/`BoardView` drag changes `data_limite`; no bulk operations.
- `useOptimisticTarefas` drops overrides when a fresh list arrives.
- `TarefaFormDialog` does not pass `confirmClose`; `inlineImage.ts` wraps uploads in `trackUnsavedWork`; inline images are workspace `files` rows referenced by `r2Key`, with no per-task tracking (copying `descricao_rich` to N occurrences is safe).
- `cron-health-cron` scans every `failed` row of `cron.job_run_details` through `recent_cron_failures()`; there is no job registry. Existing pure-SQL jobs: `rate-limit-cleanup`, `cron-job-run-details-purge`.
- DEFINER lockdown pattern (`20260925000001`) and the `96_` suite; `et_grant_hosted_parity()` and why it exists.
- `tarefas` has no column-level GRANT; no `tarefas_v` view.
- MCP `createTask`/`updateTask` write directly with service_role, without `serie_id`.
- Migration tail on `main`: `20260925000023`.
- `supabase/config.toml` does not pin the Postgres `major_version`.
- `current_user` inside a SECURITY DEFINER function is the owner for **every** caller, so no DEFINER trigger can tell callers apart by it, and `session_user` is unusable because the psql suites impersonate with `SET LOCAL ROLE` (`20260817000001_cliente_foto_manual_upload.sql`, lines ~105-155, both confirmed empirically there). Hence: `tarefa_series` writes are blocked by privileges, `tarefa_series_guard` is identity-free with a GUC flag for the cron, and `tarefas_serie_id_guard` is SECURITY INVOKER in the `guard_financial_write()` shape.

Assumed (confirm during implementation):
- Production Postgres may be < 15; hence the simple FK. If it is >= 15, a composite FK with `SET NULL (serie_id)` would be acceptable, but simple + EXISTS is precedented and version-independent.
- Triggers fire without an EXECUTE check at fire time (Postgres docs; `99_tarefa_series_geracao.sql` as `authenticated` is the empirical proof).
- `auth.uid()` returns NULL (not an error) without claims, as the psql tests already assume.
- PostgREST embeds through the simple FK `tarefas.serie_id -> tarefa_series` without ambiguity (only one FK between the two tables).

## Deviations from the brief

Forced by the code:
1. Simple `serie_id` FK + `EXISTS` in WITH CHECK instead of a composite FK: composite `ON DELETE SET NULL` would null the NOT NULL `conta_id` (same trap already documented in the 2026-07-30 spec).
2. `user_id` on `tarefa_series`: `tarefas.user_id` is NOT NULL and the cron has no `auth.uid()`.
3. Column-level GRANT allowlist: the brief's gotcha applies to `membros`/`clientes` only; `tarefas` has none, so `tarefa_series` needs no explicit GRANT.
4. Cron-health "registration": there is no registry to register with; `cron.schedule` plus fail-loud is the whole integration.

Design calls (not code-forced; flip if the reviewer disagrees):
5. `encerrada_em` (manual stop independent of `fim`) and explicit `dia_mes`/`mes` landing columns (re-anchoring must not rewrite the rule).
6. Hourly cron instead of daily.
7. The "Somente esta / Esta e as próximas" dialog is limited to the form save; inline actions act on the occurrence without prompting (operational reading of decision 5 and of the "kanban completes without a dialog" rule).
8. "Somente esta" delete of the only open occurrence in `ao_concluir` spawns the next (delete trigger). All `tarefa_series` writes (create, "Esta e as próximas", pause/resume/end, "Toda a série") are SECURITY DEFINER RPCs with a SELECT-only table policy and explicit write REVOKE; `tarefas.serie_id` is trigger-guarded (atomicity, trigger ordering and a closed write surface, per Codex rounds 1 to 3). The brief's "RLS same pattern as tarefas" for the series table is therefore SELECT-only.
9. A new series requires its first due date to be today or later.
10. "Esta e as próximas" copies the whole occurrence state into the template rather than only the fields changed in that save.

## Open questions / risks

- **Cursor writer flag**: `app.tarefa_cursor_writer` is a convenience for the cron path, not a boundary; the invariant "nothing but the generator moves the cursor forward" is enforced for clients by the privilege REVOKE and for `service_role` only by convention. If a future server-side writer needs to move the cursor, route it through `generate_recurring_tarefas()` rather than setting the flag elsewhere.
- **Firing order with `sync_ideia_from_tarefa`**: both are AFTER UPDATE OF status; order is alphabetical by trigger name and neither depends on the other. Record the chosen name so no accidental dependency is created.
- **Volume**: a daily `calendario` series produces 365 tasks per year per workspace; `getTarefas()` fetches everything without pagination today. Not a regression of this feature, but series accelerate growth. Out of scope here; note it for the list revamp.
- **Weekly with `inicio` off-rule** (case 8): the first occurrence is the typed due date (Wednesday) and the second already follows the rule (Monday, week +2). Defined and tested, but may surprise; the form summary shows the rule only. Consider the copy "A primeira ocorrência é o prazo acima." in the Repetir section.

## Known behaviour and accepted limitations

- **Residual TOCTOU on the delete trigger**: `tarefas_serie_ao_excluir_fn` (and the completion trigger) read `modo` without a lock so that deleting or completing a `calendario` occurrence never waits on the generator's scan. A concurrent `calendario` -> `ao_concluir` switch that commits between that unlocked read and the delete can therefore leave an `ao_concluir` series without an open occurrence; the next edit, resume or completion of the series repairs it. Accepted: the window is one statement wide.
- **Editing an ended series**: `tarefa_serie_aplicar_edicao` on an occurrence of a series with `encerrada_em` set is accepted (the rule/template UPDATE goes through) but changes nothing for the future, because every generation path ignores ended series, while `tarefa_serie_definir_estado` raises "Esta série já foi encerrada." for the same series.
- **Rule edit near midnight or during cron downtime**: a `calendario` rule edit recomputes the cursor from `greatest(inicio, today)` with `today = tarefa_hoje_sp()`. If the edit lands between 00:00 and the first generator run (00:07 America/Sao_Paulo), or while the cron is down, today's not-yet-generated occurrence is skipped; the next one follows the new rule.
- **`updated_at` is not "last edited"**: the hourly generator UPDATEs `tarefa_series` (cursor advance), and `set_tarefa_series_updated_at` bumps `updated_at` each time. Do not surface it in the UI as "last edited".
- **Browser-local vs Sao Paulo date**: the form's Prazo validation and `serieEstado` use the browser-local date, while the RPCs use `tarefa_hoje_sp()`. Around midnight, or for a user outside `America/Sao_Paulo`, the client can accept or reject a date the RPC judges the other way; the RPC is authoritative and its message is shown.

## Out of scope for v1

RRULE ("second Thursday of the month", "last business day"), "N times", creating/editing series through the MCP, advance reminders, a series screen (list/reopen ended ones), reopening an ended series, recurrence icon on the dashboard, per-occurrence mention propagation, plan gating.
