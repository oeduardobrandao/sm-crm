# Agenda in the workspace MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents read and manage Agenda events through the workspace MCP with every CRM permission rule intact.

**Architecture:** One migration moves the four Agenda RPC bodies into `_core(p_conta, p_user, p_privados, …)` functions; the CRM RPCs become thin wrappers and new `*_as` wrappers (service_role) serve the MCP. The two client-scope triggers and two `auth.uid()` helpers read the actor through `_agenda_actor()` (auth.uid(), else a transaction-local setting the `_as` wrappers set). The MCP gets `agenda:read`/`agenda:write` and five tools in `agenda.ts` (adapter) + `agenda-tools.ts` (registration).

**Tech Stack:** Postgres/plpgsql (Supabase), Deno edge function (`supabase/functions/mcp`), zod 3, React CRM scope mirror, psql entitlement suites, Deno tests, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-27-mcp-agenda-design.md`

## Global Constraints

- Migration file: `supabase/migrations/20261212000001_agenda_mcp_as.sql`. Re-check `ls supabase/migrations | tail -1` before opening the PR and renumber above main's tail if needed.
- Core bodies = current definition (`20261117000006` for listar/editar/excluir, `20261008000002` for criar) with **only** identity lines changed; mark each change with `-- [mcp]`.
- Cores: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`. `_as`: `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`. CRM RPCs keep their current ACL (re-state it after `CREATE OR REPLACE`).
- Setting name: `mesaas.agenda_actor`, always `set_config(…, true)` (transaction-local).
- API-key error copy: `agenda: evento privado indisponível nesta conexão`.
- Flag-off copy: `A Agenda não está ativa neste workspace.`
- Scope labels: pt `Agenda (leitura)` / `Agenda (escrita)`; en `Agenda (read)` / `Agenda (write)`.
- Masked title: `Ocupado`. Default timezone: `America/Sao_Paulo`.
- No em-dashes in user-facing copy. Tool descriptions in pt-BR like the rest.
- `auditArgs`: ids, `scope`, `client_id`, changed field names, counts. Never title, description, location, meeting link.
- Edge functions: never return raw DB errors; pass through only `agenda: …` messages (prefix stripped).

## Review Focus

1. **Multi-workspace user**: actor's `active_workspace_id` is another workspace; MCP must act in the connection's `conta_id`. Test in Task 1/2 SQL suite (`mcp_as_uses_p_conta_not_active_workspace`).
2. **Agent sends UTC instants** (`2026-12-03T13:00:00Z`) for an event in São Paulo; expect wall clock `10:00` stored. Test in Task 4 (`toWallClock converts Z to event tz`).
3. **All-day inclusive end**: `start_date=end_date=2026-12-03` is a one-day event, not an error. Test in Task 4.
4. **API key and the creator's own private event**: masked, can't edit/delete. Test in Task 2 SQL + Task 5 Deno.
5. **Restricted member editing own event of an unassigned client** succeeds via MCP, moving it to another client fails. Test in Task 3 SQL.

---

### Task 1: Actor plumbing (helper, triggers, auth.uid() helpers)

**Files:**
- Create: `supabase/migrations/20261212000001_agenda_mcp_as.sql` (section 1)
- Create: `supabase/tests/entitlements/99_agenda_mcp_as.sql` (section 1; reuse `pg_temp.errm_as`/`n_as` helpers copied from `99_acesso_por_cliente_definer.sql`, plus `pg_temp.svc(p_sql)` that runs as `service_role` with no jwt claims)

**Interfaces:**
- Produces: `public._agenda_actor() RETURNS uuid` (SQL, STABLE, `coalesce(auth.uid(), nullif(current_setting('mesaas.agenda_actor', true), '')::uuid)`; `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role`. Harmless for `authenticated`: their `auth.uid()` always wins).
- Produces: `public.agenda_pode_ver_evento(p_evento_id bigint, p_privado boolean, p_organizador uuid, p_user uuid) RETURNS boolean` (the 3-arg version delegates with `auth.uid()`; ACL as 3-arg).
- Changes: `guard_agenda_evento_scope`, `guard_agenda_participante_scope` (`v_uid := public._agenda_actor()`), `agenda_cliente_substituir_pedidos` (`resolvido_por = public._agenda_actor()`), `agenda_definir_convidados` (`v_user uuid := public._agenda_actor()`). Bodies otherwise copied verbatim from their latest migration.

- [ ] **Step 1: Write failing tests** in the suite:
  - `actor_setting_ignored_when_authenticated`: as authenticated user A with `mesaas.agenda_actor` = B, `_agenda_actor()` = A.
  - `actor_from_setting_for_service_role`: service role, setting = B → B; no setting → NULL.
  - `trigger_guards_service_role_with_actor`: service role + setting = restricted user, direct `INSERT` into `agenda_eventos` for an unassigned client raises `client_scope_restricted`; same insert without the setting succeeds (today's behavior).
  - `pode_ver_evento_4arg`: private event of A: `(…, A)` true, `(…, B)` false, `(…, participant)` true.
- [ ] **Step 2: Run** `bash scripts/test-entitlements.sh` (needs local Supabase on colima; see memory `reference_local_supabase_colima`) — expect the new asserts to FAIL.
- [ ] **Step 3: Implement section 1 of the migration.**
- [ ] **Step 4: Run** the full entitlement script — new asserts PASS, all existing `99_agenda_*` and `99_acesso_por_cliente_*` PASS.
- [ ] **Step 5: Commit** `feat(agenda): ator do MCP para os gatilhos de escopo`.

### Task 2: List core + wrappers

**Files:**
- Modify: migration (section 2), test suite (section 2)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `public._agenda_listar_core(p_conta uuid, p_user uuid, p_privados boolean, p_de timestamptz, p_ate timestamptz, p_ocorrencia_id bigint)` returning the same 32-column `TABLE(...)` as `agenda_listar` today.
- Produces: `public.agenda_listar_as(p_conta uuid, p_user uuid, p_privados boolean, p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL, p_ocorrencia_id bigint DEFAULT NULL)`, same return. Raises `agenda: sessão sem workspace ativo` when `p_user` is not a member of `p_conta`.
- `agenda_listar(p_de, p_ate, p_ocorrencia_id)` = `RETURN QUERY SELECT * FROM _agenda_listar_core(get_my_conta_id(), auth.uid(), true, …)`; keeps the NULL-session raise.

Core changes vs current body: `has_permission(…)` → `has_permission_for(p_user, p_conta, …)`; `my_client_scope_all()` → `EXISTS(workspace_members … role='owner' OR client_scope='todos')`; `can_access_cliente(cli)` → 3-arg; `can_see_cliente_context(cli)` → `can_see_cliente_context_for(p_user, p_conta, cli)`; mask lateral becomes `e.privado AND (NOT p_privados OR (e.organizador_id IS DISTINCT FROM p_user AND eu.user_id IS NULL))`.

- [ ] **Step 1: Failing tests:**
  - `listar_as_denied_to_authenticated` (EXECUTE → `42501`).
  - `listar_as_non_member_refused`.
  - `listar_as_without_calendario_ver` raises `agenda: você não pode ver a agenda`.
  - `listar_as_flag_off_returns_zero`.
  - `mcp_as_uses_p_conta_not_active_workspace`: user in workspaces W1 (active) and W2; `agenda_listar_as(W2, user, true, …)` returns W2's event and not W1's.
  - `listar_as_restricted_scope`: restricted user sees assigned-client events + own events only (same counts as the existing c4 suite cases).
  - `listar_as_privados_false_masks_own`: actor's own private event → `mascarado = true`, `titulo = 'Ocupado'`.
  - `listar_parity`: for owner, `todos`, restricted, `(SELECT … FROM agenda_listar(…))` as the user equals `agenda_listar_as(conta, user, true, …)` (compare `to_jsonb` of rows ordered by `ocorrencia_id`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement section 2.**
- [ ] **Step 4: Run full suite, expect PASS.**
- [ ] **Step 5: Commit** `feat(agenda): agenda_listar com núcleo e variante _as`.

### Task 3: Write cores + wrappers (criar, editar, excluir)

**Files:**
- Modify: migration (section 3), test suite (section 3)

**Interfaces:**
- Produces:
  - `_agenda_evento_criar_core(p_conta uuid, p_user uuid, p_privados boolean, p_evento jsonb, p_participantes uuid[]) RETURNS TABLE (evento_id bigint, ocorrencia_id bigint, dtstart timestamp)`
  - `_agenda_evento_editar_core(p_conta uuid, p_user uuid, p_privados boolean, p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[]) RETURNS bigint`
  - `_agenda_evento_excluir_core(p_conta uuid, p_user uuid, p_privados boolean, p_ocorrencia_id bigint, p_escopo text) RETURNS void`
  - `agenda_evento_criar_as(p_conta, p_user, p_privados, p_evento, p_participantes)`, `agenda_evento_editar_as(p_conta, p_user, p_privados, p_ocorrencia_id, p_escopo, p_evento, p_participantes DEFAULT NULL)`, `agenda_evento_excluir_as(p_conta, p_user, p_privados, p_ocorrencia_id, p_escopo)`, same returns.
- Each `_as`: membership check (raise `agenda: sessão sem workspace ativo`), `set_config('mesaas.agenda_actor', p_user::text, true)`, call core, `set_config('mesaas.agenda_actor', '', true)`, return.
- CRM RPCs: `SELECT * FROM core(get_my_conta_id(), auth.uid(), true, …)` with the existing NULL-session raise.
- Core changes: identity lines as in Task 2; `agenda_pode_ver_evento(id, true, org)` → 4-arg with `p_user`. With `NOT p_privados`: criar raises the API-key error when `p_evento->>'privado' = 'true'`; editar/excluir raise it when the target event is private or `p_evento->>'privado' = 'true'`.

- [ ] **Step 1: Failing tests** (replay the c4 suite's create/edit/delete cases through `_as`, called as service role):
  - `criar_as_restricted_unassigned_client_denied` → `client_scope_restricted`; `criar_as_restricted_no_client_denied`; `criar_as_restricted_assigned_ok`; organizer of the created row = `p_user`.
  - `editar_as_own_unassigned_event_content_ok` (`{"titulo":"meu"}` on `e_borg`).
  - `editar_as_move_to_other_client_denied`.
  - `editar_as_seguintes_split_inherits_source` (restricted organizer of a series of an unassigned client edits `seguintes`: ok).
  - `editar_as_without_calendario_editar_denied`; `editar_as_non_organizer_agent_denied` (agent, not organizer).
  - `excluir_as_hidden_event_denied`, `excluir_as_own_ok`.
  - `privados_false`: create `privado:true` refused, edit own private refused, delete own private refused, edit setting `privado:true` refused (exact copy from Global Constraints).
  - `substituir_records_actor`: pending `agenda_remarcacoes` replaced by `editar_as` has `resolvido_por = p_user`.
  - `actor_setting_cleared_after_as`: after `editar_as` returns, `current_setting('mesaas.agenda_actor', true)` is `''`.
  - `crm_write_rpcs_unchanged`: existing `99_agenda_edicao.sql`, `99_agenda_convidados.sql`, `99_agenda_hub.sql`, `99_acesso_por_cliente_agenda.sql` stay green (no edits to them).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement section 3.**
- [ ] **Step 4: Run full suite, expect PASS.** Also run `99_acesso_por_cliente_drift.sql` and add a commented exemption if it flags the new functions.
- [ ] **Step 5: Commit** `feat(agenda): criar/editar/excluir com núcleo e variante _as`.

### Task 4: Scopes (edge + CRM mirror)

**Files:**
- Modify: `supabase/functions/_shared/mcp-token.ts` (`MCP_ALLOWED_SCOPES`, `MCP_SCOPE_PERMISSION`, `MCP_AGENT_PRESET`)
- Modify: `apps/crm/src/lib/mcp-scopes.ts` (`SCOPE_OPTIONS`, `AGENT_PRESET`)
- Modify: `packages/i18n/locales/{pt,en}/mcp.json` (`scopes.agenda_read`, `scopes.agenda_write`; `presetSubtitle` gains "agenda" / "agenda")
- Test: `supabase/functions/__tests__/mcp-token_test.ts`, `apps/crm/src/lib/__tests__/mcp-scopes.test.ts`

**Interfaces:**
- Produces: scopes `"agenda:read"` → `{ module: "calendario", action: "ver" }`, `"agenda:write"` → `{ module: "calendario", action: "editar" }`; `agenda:read` in both presets; neither owner-only.

- [ ] **Step 1: Failing tests:** `MCP_SCOPE_PERMISSION["agenda:write"]` deep-equals `{module:"calendario",action:"editar"}`; `validateScopes(["agenda:read"])` true; CRM `SCOPE_OPTIONS` values equal `MCP_ALLOWED_SCOPES` order-insensitively (extend the existing mirror test if present); `AGENT_PRESET` contains `agenda:read`.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/mcp-token_test.ts` and `npx vitest run apps/crm/src/lib/__tests__/mcp-scopes.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both → PASS.**
- [ ] **Step 5: Commit** `feat(mcp): escopos agenda:read e agenda:write`.

### Task 5: Adapter (`agenda.ts`)

**Files:**
- Create: `supabase/functions/mcp/agenda.ts`
- Test: `supabase/functions/__tests__/mcp-agenda_test.ts` (fake db from `mcp-financeiro-helpers.ts`)

**Interfaces:**
- Consumes: `Deps` from `./queries.ts`; RPCs from Tasks 2–3.
- Produces:
  - `toWallClock(input: string, tz: string): string` — `YYYY-MM-DDTHH:MM`; accepts that format unchanged, or an ISO instant with `Z`/offset converted via `Intl.DateTimeFormat(tz)`; throws `McpInputError("Use data e hora no formato YYYY-MM-DDTHH:MM")` otherwise.
  - `buildEventoPayload(args: AgendaWriteArgs, opts: { tz: string; isUpdate: boolean }): { evento: Record<string, unknown>; participantesMemberIds?: number[] }` — maps `title→titulo`, `description→descricao`, `location→local`, `meeting_link→link_reuniao`, `type→tipo`, `color→cor`, `client_id→cliente_id`, `share_with_client→compartilhado_cliente`, `private→privado`, `reminders→lembretes`, `all_day→dia_inteiro`, `timezone→tz` (create only), `recurrence→regra` (`freq`, `interval→intervalo`, `weekdays→dias_semana`, `monthly_mode→mensal_modo`, `until→ate`, `count→contagem`; read the exact `regra` sub-keys `agenda_validar_payload` accepts), timed `start/end→inicio_local/fim_local` via `toWallClock`, all-day `start_date→inicio_local`, `end_date + 1 day→fim_local`. Only keys present in args are emitted (patch). Pair rule: exactly one of a start/end pair → `McpInputError`.
  - `resolveParticipants(d: Deps, memberIds: number[]): Promise<string[]>` — `membros` by `conta_id` + ids → `crm_user_id`; unknown id or null login → `McpInputError` naming the member.
  - `formatOcorrencia(row, people: Map<string, {member_id: number|null; name: string|null}>): AgendaOccurrence` — spec's output fields; all-day `end_date = data_fim_local - 1 day`; masked rows reduced to the spec's masked field list; `guest_count = convidados.length`; never emits guest emails.
  - `listAgendaEvents(d, a: { from: string; to: string; client_id?: number })`, `getAgendaEvent(d, a: { occurrence_id: number })`, `createAgendaEvent(d, a)`, `updateAgendaEvent(d, a)` (reads the occurrence via `agenda_listar_as` first for the event `tz` and to fail fast when `can_edit` is false), `deleteAgendaEvent(d, a: { occurrence_id: number; scope: AgendaScope })`.
  - `agendaPrivados(ctx): boolean` = `ctx.key_id.startsWith("oauth:")`.
  - Error mapping `agendaFail(error)`: message `feature_disabled:feature_agenda` → flag-off copy; message starting `agenda: ` → `McpInputError(rest)`; `client_scope_restricted` → `McpInputError("Você não tem acesso a esse cliente.")`; else rethrow generic.
  - Scope map: `this→esta`, `this_and_following→seguintes`, `all→todas`.

- [ ] **Step 1: Failing tests:**
  - `toWallClock`: `("2026-12-03T10:00","America/Sao_Paulo")` → same; `("2026-12-03T13:00:00Z","America/Sao_Paulo")` → `"2026-12-03T10:00"`; `("2026-12-03T10:00:00-03:00", …)` → `"2026-12-03T10:00"`; `("amanhã", …)` throws.
  - `buildEventoPayload` all-day `start_date=end_date=2026-12-03` → `inicio_local "2026-12-03"`, `fim_local "2026-12-04"`; update with only `title` → `{titulo}` only; update with `start` and no `end` throws; update ignores/refuses `timezone` (zod shape omits it).
  - `formatOcorrencia` masked row → keys exactly the masked list; all-day `data_fim_local 2026-12-04` → `end_date "2026-12-03"`; row with `convidados` of 2 → `guest_count 2` and no `email` anywhere in `JSON.stringify(out)`.
  - `listAgendaEvents` calls `agenda_listar_as` with `{p_conta, p_user: ctx.created_by, p_privados: false}` for a `mesaas_sk_` key and `true` for `oauth:x`; `client_id` filter applied.
  - `resolveParticipants` member without `crm_user_id` → error naming them.
  - `agendaFail` mappings above.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/mcp-agenda_test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(mcp): adaptador da Agenda`.

### Task 6: Tool registration

**Files:**
- Create: `supabase/functions/mcp/agenda-tools.ts` (`registerAgendaTools(server, deps)`, called from `tools.ts` next to `registerFinanceiroTools`)
- Modify: `supabase/functions/mcp/tool-meta.ts` (5 entries: `list_agenda_events` "Listar eventos da agenda" readOnly; `get_agenda_event` "Ver evento da agenda" readOnly; `create_agenda_event` "Criar evento na agenda"; `update_agenda_event` "Editar evento da agenda"; `delete_agenda_event` "Excluir evento da agenda" destructive)
- Modify: `supabase/functions/__tests__/mcp-apps-switch_test.ts` (`BASELINE` + comment count 49 → 54)
- Test: `supabase/functions/__tests__/mcp-agenda_test.ts` (tool-level), `mcp-annotations_test.ts` if it enumerates

**Interfaces:**
- Consumes: Task 5 functions; `register` from `./register.ts`.
- zod shapes: dates `from`/`to` `z.string()`; `occurrence_id: z.number().int().positive()`; `scope: z.enum(["this","this_and_following","all"])`; `client_id`, `participant_member_ids: z.array(z.number().int().positive()).max(50)`; `title: z.string().min(1).max(200)`; `reminders: z.array(z.number().int().min(0)).max(5)`; `type`/`color` enums copied from `agenda_validar_payload` (`reuniao, gravacao, captacao, apresentacao, interno, outro`; `azul, verde, amarelo, laranja, rosa, roxo, teal, cinza`; confirm against the SQL).
- `auditArgs`: list → `{from, to, client_id, count}`; get → `{occurrence_id}`; create → `{client_id, fields: Object.keys(args).filter(not free text), participants: n, occurrence_id: r.occurrence_id}`; update → `{occurrence_id, scope, fields}`; delete → `{occurrence_id, scope}`. Add `occurrence_id` to `audit()`'s `resource_id` chain in `register.ts`.

- [ ] **Step 1: Failing tests:** each tool denies a ctx without its scope; registry lists the 5 names with the right scopes; `delete_agenda_event` annotation `destructiveHint: true`; create's audit metadata has no `title`/`description`/`location`/`meeting_link` keys or values (`JSON.stringify` check with sample text); BASELINE test passes with the 5 names.
- [ ] **Step 2: Run** `npm run test:functions` (or the two files) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check:functions && npm run test:functions` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): ferramentas da Agenda`.

### Task 7: Docs, full verification, PR

**Files:**
- Modify: `CLAUDE.md` (MCP bullet: Agenda tools, `_as` wrappers, `mesaas.agenda_actor`, API keys never see private events, deploy order)

- [ ] **Step 1:** Add the CLAUDE.md entry (deploy order: migration → `mcp`, `mcp-keys`, `mcp-oauth-consent` → merge; rollback: frontend, functions, migration can stay; existing connections need a new key / reauthorization to get `agenda:*`).
- [ ] **Step 2: Run** each, all green: `npm run lint`; `npm run format:check`; `npx tsc -p apps/crm/tsconfig.json --noEmit`; `npx tsc -p apps/hub/tsconfig.json --noEmit`; `npx tsc -p apps/admin/tsconfig.json --noEmit`; `npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit`; `npx tsc -p tsconfig.scripts.json`; `npm run test`; `npm run check:functions`; `npm run test:functions`; `bash scripts/test-entitlements.sh`. Check `ls node_modules/.deno` afterwards (Deno pollution gotcha).
- [ ] **Step 3:** Renumber the migration if main's tail moved; push branch; open the PR in Portuguese with the deploy order and the support note.
- [ ] **Step 4: Commit** `docs: Agenda no MCP no CLAUDE.md` (before push).
