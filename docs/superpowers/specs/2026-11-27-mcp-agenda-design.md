# Agenda in the workspace MCP

**Date:** 2026-11-27
**Status:** approach and product decisions approved in conversation; revised after a builder check against the code; written spec pending approval.

## Intent and why

A customer asked (via support) to use the Mesaas connector in Claude/ChatGPT with the Agenda
(`apps/crm/src/pages/calendario/agenda/`). Today the workspace MCP (`supabase/functions/mcp/`)
has no Agenda tool: `show_client_calendar` only shows posts. Agencies want to ask the agent
"what do I have this week?", "book a recording with client X on Thursday at 10" or "move
tomorrow's meeting to 3pm" without opening the CRM.

## What the user decided

- **Approach: shared core.** Each Agenda RPC body moves into a `_core(p_conta, p_user, …)`
  function. The existing CRM RPC becomes a thin wrapper (`get_my_conta_id()`, `auth.uid()`),
  and a new `_as(p_conta, p_user, …)` wrapper (service_role only) serves the MCP. One copy of
  the logic (the Financeiro `_core` pattern), at the cost of touching the live CRM path.
- **Private events: OAuth only.** An OAuth connection (a person's own login) sees and edits
  that person's private events exactly like the CRM. A workspace API key (`mesaas_sk_…`, which
  anyone holding it can use) never sees private event content, not even its creator's.
- **Side effects: same as the CRM.** An MCP write notifies members, and an event shared with
  the client shows in the Hub and emails the client, exactly like a CRM write.
- **Delete is in v1**, with the destructive annotation.

## Goals

1. Agents can list, read, create, update (one occurrence, this and following, or the whole
   series) and delete Agenda events of the workspace behind the connection.
2. Every permission rule of the CRM holds for the MCP actor: plan flag `feature_agenda`,
   `calendario:ver/editar`, client scope (acesso por cliente), private-event visibility,
   "only the organizer or an owner/admin edits".
3. The CRM keeps behaving exactly as today.

## Non-goals

- **External guests** (`agenda_convidados`, invite emails): not readable or editable by the
  MCP in v1. Guest emails are personal data of people outside the workspace. Existing guests
  are preserved untouched by MCP edits (and receive the same update/cancel emails a CRM edit
  would send them, per the side-effects decision).
- Answering invitations (`agenda_responder`), resolving Hub reschedule requests, the iCal feed.
- A visual card (MCP Apps) for the Agenda. Text tools only.

## Anti-goals

- Any path where the MCP judges permissions in a workspace other than the key's/grant's
  `conta_id`. (`get_my_conta_id()` returns the user's *active* CRM workspace, which is why
  "impersonate the user" was rejected.)
- Any path where the service role silently skips client scope or private-event masking
  (the helpers `my_client_scope_all()`, `can_access_cliente(bigint)`, `agenda_pode_ver_evento`
  and both `zz_client_scope_guard` triggers fail open or misbehave when `auth.uid()` is NULL).
- A behavior change in the CRM Agenda.

## Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| Impersonation (`set_config('request.jwt.claims')`, then call the CRM RPC) | No SQL duplication, but `get_my_conta_id()` resolves the user's active workspace, not the connection's; no precedent in the repo | Rejected |
| Duplicated `_as` twins (~800 lines with explicit conta/user) | CRM path untouched, but two copies drift at the next Agenda change | Rejected |
| **Shared `_core(p_conta, p_user)` + two thin wrappers** | One body; the CRM path is refactored, guarded by the existing `99_agenda_*` suites | **Chosen** |

## Design

### Database (one migration, numbered above main's tail at PR time)

Four cores, each the current definition (`pg_get_functiondef` of the latest version) with only
the identity lines changed:

| CRM RPC (signature unchanged) | Core | MCP wrapper |
|---|---|---|
| `agenda_listar(p_de, p_ate, p_ocorrencia_id)` | `_agenda_listar_core(p_conta, p_user, p_privados, …)` | `agenda_listar_as(p_conta, p_user, p_privados, …)` |
| `agenda_evento_criar(p_evento, p_participantes)` | `_agenda_evento_criar_core(…)` | `agenda_evento_criar_as(…)` |
| `agenda_evento_editar(p_ocorrencia_id, p_escopo, p_evento, p_participantes)` | `_agenda_evento_editar_core(…)` | `agenda_evento_editar_as(…)` |
| `agenda_evento_excluir(p_ocorrencia_id, p_escopo)` | `_agenda_evento_excluir_core(…)` | `agenda_evento_excluir_as(…)` |

Inside each core, every identity-dependent call becomes explicit:

- `get_my_conta_id()` / `auth.uid()` → `p_conta` / `p_user`.
- `has_permission('calendario', x)` → `has_permission_for(p_user, p_conta, 'calendario', x)`.
- `my_client_scope_all()` → computed from `workspace_members` of `p_user` in `p_conta`
  (owner or `client_scope = 'todos'`).
- `can_access_cliente(cli)` → `can_access_cliente(p_user, p_conta, cli)`.
- `agenda_pode_ver_evento(id, privado, org)` → a new 4-arg overload with `p_user`
  (the 3-arg one stays for the RLS policies and delegates with `auth.uid()`).
- `can_see_cliente_context(cli)` (client name on a row of a client the actor does not access)
  → the existing explicit helper `can_see_cliente_context_for(p_user, p_conta, cli)`
  (migration `20261117000011`), on both paths, so CRM and MCP output stay identical. `cliente_id`
  is returned as the CRM returns it today. *(my call)*
- `agenda_definir_convidados` reads `auth.uid()`; the core passes `p_user` explicitly (new
  argument or overload). Only called when `p_evento ? 'convidados'`, which the MCP never sends,
  so this is for core consistency.
- `agenda_cliente_substituir_pedidos` sets `resolvido_por = auth.uid()` (called by editar and
  excluir before moving or deleting occurrences with pending Hub reschedule requests); it gets a
  `p_user` argument so MCP edits record the actor, not NULL. *(my call)*
- Private masking in `agenda_listar` is inline (`privado AND organizador <> user AND NOT
  participant`), not `agenda_pode_ver_evento`; `p_privados = false` adds its own branch there.
  The 4-arg `agenda_pode_ver_evento` overload serves editar/excluir's visibility checks.

**Triggers.** `guard_agenda_evento_scope` / `guard_agenda_participante_scope` return early
when `auth.uid()` is NULL, which is the MCP's case. The `_as` path therefore runs the same
checks explicitly before writing (client of the new or edited event accessible to `p_user`, no
moving an event between clients the actor cannot access, the participant rule,
`author_immutable`). The CRM path keeps relying on the triggers as today.

**`p_privados boolean`** (the API-key rule). The CRM wrapper passes `true`. The `_as`
wrappers pass what the MCP sends (`true` for OAuth, `false` for API keys). With `false`:
- list/get: every private event is masked (title "Ocupado", no description, client, location,
  link or answers), including the actor's own; masked rows are still returned so the agent
  sees busy time.
- edit/delete of a private event: refused (`agenda: evento privado indisponível nesta conexão`).
- create with `privado: true`, or an edit that sets it: refused with the same error.

**`_as` wrappers** first check that `p_user` is a member of `p_conta` (else raise), then call
the core. `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`.
Cores: explicit `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` (Supabase's
default privileges would otherwise grant EXECUTE, and a core taking `p_user` callable by
`authenticated` would let anyone act as anyone). CRM wrappers keep their
current ACL.

Everything the cores call that already takes explicit arguments (`agenda_validar_payload`,
`agenda_definir_participantes`, `agenda_notificar`, `agenda_cliente_enfileirar`,
`agenda_envios_enfileirar`, `agenda_materializar`, `agenda_regenerar`, `agenda_pode_editar`)
is unchanged, so notifications, Hub sharing, client and guest emails behave as in the CRM.

### MCP scopes

- New `agenda:read` → `calendario:ver`, `agenda:write` → `calendario:editar` in
  `MCP_ALLOWED_SCOPES` / `MCP_SCOPE_PERMISSION` (`_shared/mcp-token.ts`), mirrored in
  `apps/crm/src/lib/mcp-scopes.ts` (`SCOPE_OPTIONS`, "Agenda (leitura)" / "Agenda (escrita)",
  plus the `mcp:scopes.*` i18n keys in pt and en). Not owner-only.
- `agenda:read` joins `MCP_AGENT_PRESET` / `AGENT_PRESET` (read-only like the other read
  scopes). *(my call)*
- API keys skip `MCP_SCOPE_PERMISSION` at issue time; the core's `has_permission_for(p_user…)`
  on every call is what holds them to the creator's role.

### MCP tools (`supabase/functions/mcp/agenda.ts` + `agenda-tools.ts`)

Ids only, English argument names like the rest (`client_id`). Actor = `ctx.created_by`;
`p_privados = ctx.key_id.startsWith("oauth:")`.

| Tool | Scope | Args | Notes |
|---|---|---|---|
| `list_agenda_events` | `agenda:read` | `from`, `to` (ISO, ≤ 100 days apart), `client_id?` | Occurrences in the window, by start. `client_id` filters after the RPC. |
| `get_agenda_event` | `agenda:read` | `occurrence_id` | One occurrence, same shape. |
| `create_agenda_event` | `agenda:write` | `title`; timing (`start`/`end` ISO, or `all_day` + `start_date`/`end_date`); `timezone?` (default `America/Sao_Paulo`); `description?`, `location?`, `meeting_link?`, `type?`, `color?`, `client_id?`, `share_with_client?`, `private?`, `reminders?` (minutes), `recurrence?` (`freq`, `interval`, `weekdays`, `monthly_mode`, `until`/`count`), `participant_member_ids?` | Organizer = actor. Participants are `membros.id` from `list_members`, mapped to their login (`crm_user_id`); a member without a login is an error naming it. |
| `update_agenda_event` | `agenda:write` | `occurrence_id`, `scope` (`this` / `this_and_following` / `all` → `esta` / `seguintes` / `todas`), any create field | Patch semantics: omitted fields keep their value (the builder checks how `agenda_evento_editar` treats a partial `p_evento` and adapts). Guests untouched. |
| `delete_agenda_event` | `agenda:write` | `occurrence_id`, `scope` | `destructive: true`. |

Output per occurrence: `occurrence_id`, `event_id`, `title`, `start`, `end`, `all_day`,
`start_date`/`end_date` (local), `timezone`, `type`, `color`, `description`, `location`,
`meeting_link`, `client_id`, `client_name`, `private`, `masked`, `recurring`, `recurrence`,
`reminders`, `organizer_member_id`, `participants` (`member_id`, `name`, `answer`),
`my_answer`, `can_edit`, `shared_with_client`, `client_answer`, `guest_count`. Guest emails
are **not** returned. *(field list: my call)*

Each tool gets a `TOOL_META` entry (structural test) and an `auditArgs` with ids, scope,
`client_id` and the names of the changed fields; never title, description, location or link.
Flag off: writes surface "A Agenda não está ativa neste workspace."; list returns an empty
list with the same note. RPC errors (already pt-BR `agenda: …`) pass through without the
prefix; anything else is the generic MCP error.

### Tests

- New `supabase/tests/entitlements/99_agenda_mcp_as.sql`: `_as` EXECUTE denied to
  `authenticated`; non-member `p_user` refused; `calendario:ver`/`editar` denial; a restricted
  member cannot read, create, edit into or delete events of a client they do not access but
  can their own; `p_privados = false` masks the actor's own private event and refuses
  edit/delete/create-private; **workspace isolation**: a user whose `active_workspace_id` is
  another workspace gets `p_conta`'s events, not the active one's; CRM wrapper output equals
  `_as` output for the same actor.
- Existing `99_agenda_*` and `99_acesso_por_cliente_agenda.sql` stay green unchanged (the
  regression net for the refactor). `99_acesso_por_cliente_drift.sql` updated if it flags the
  new DEFINER functions.
- Deno: arg mapping (scope names, recurrence, participants), `p_privados` from `key_id`,
  `auditArgs` free of text, scope gating, TOOL_META structural test.

## Deploy order (PR description + CLAUDE.md gotcha)

1. Migration (safe alone: CRM RPC signatures and behavior unchanged).
2. Redeploy `mcp`, `mcp-keys`, `mcp-oauth-consent` (scope list).
3. Merge (CRM scope pickers show the new scopes).
Rollback: frontend first, then functions; the migration can stay.

Existing connections do not gain the new scopes: users create a new key or reauthorize the
connector with "Agenda" ticked. The support reply to the customer should say so.

## Left to the builder

- Mechanics for passing `p_user` to `agenda_definir_convidados` and
  `agenda_cliente_substituir_pedidos` (extra argument vs overload).
- Whether the explicit trigger-equivalent checks live in the cores (behind an MCP flag) or in
  the `_as` wrappers, as long as the CRM path behaves identically.
- Partial-update mapping after reading `agenda_evento_editar`.
