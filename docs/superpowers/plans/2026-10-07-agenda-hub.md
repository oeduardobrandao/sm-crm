# Agenda in the Hub (sub-project 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Events the team marks "Compartilhar com o cliente" show up in the client's Hub, where the client confirms or declines each occurrence and asks to reschedule (team accepts or declines), and the client gets an e-mail with `.ics` for every invite, change and cancellation, plus a reminder in the "Pendências do Hub" digest.

**Architecture:** One migration adds the share flag, a per-occurrence `sequencia`, three tables (client responses, reschedule requests, an e-mail queue with immutable snapshots) and service-role RPCs. The existing write RPCs gain enqueue calls. Two new Deno functions: `hub-agenda` (Hub API, token auth) and `agenda-cliente-email` (queue drain, cron). `client-event-email-cron` gains a reminder section. The CRM gets the share switch and the client state in the popover; the Hub gets an Agenda page and a home block.

**Tech Stack:** Postgres (plpgsql, SECURITY DEFINER, pg_cron, pg_net), Deno edge functions, Resend, React 19 + TanStack Query + shadcn/Radix (CRM) and the Hub's own Tailwind components, i18next (`packages/i18n`), Vitest, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-10-07-agenda-hub-design.md` is the source of truth. Each task names the spec sections it implements; read them before coding. The contracts below are binding between lanes: a lane may not change a signature another lane consumes.

## Global Constraints

- Migration file: `supabase/migrations/20261007000001_agenda_hub.sql` (main's tail is `20261006000001`). Re-check uniqueness against `origin/main` at PR time.
- Every new table: RLS enabled, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT ALL ... TO service_role`. Composite FKs only: `(ocorrencia_id, conta_id) → agenda_ocorrencias(id, conta_id)` and `(cliente_id, conta_id) → clientes(id, conta_id)`, both `ON DELETE CASCADE`. The queue table has no FK to `agenda_eventos`/`agenda_ocorrencias`.
- Hub RPCs (`agenda_hub_*`), queue RPCs and digest RPCs: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`. Team RPCs (`agenda_remarcacao_resolver`, `agenda_listar`): granted to `authenticated` and `service_role`, never `anon`.
- Hub RPC errors: `RAISE EXCEPTION 'agenda_hub:<codigo>' USING ERRCODE = 'P0001'`, codes exactly: `desligado`, `nao_encontrado`, `horario_mudou`, `ja_aconteceu`, `sugestao_passada`, `hora_obrigatoria`, `pedido_pendente`, `ja_resolvido`.
- Timestamps compared as `timestamptz` inside SQL, never as strings.
- UID `agenda-oc-<ocorrencia_id>@mesaas.com.br`; `METHOD:PUBLISH` only; no `ORGANIZER`, `ATTENDEE`, `RRULE`, `METHOD:CANCEL`.
- Queue: `enviar_apos = now() + interval '60 seconds'`, lease 2 min, 3 attempts, idempotency key `agenda-cliente:<id>:<versao>`, snapshot cap 50 occurrences within 90 days.
- Hub rate limits: reads spend `hub-read:<conta>:<cliente>` (300/300s, shared); writes add `hub-write:hub-agenda:<conta>:<cliente>` 60/3600; bad token `hub-badtoken:<ip>` 30/600.
- User-facing copy in Portuguese (Hub also English via i18n), no em-dashes. CRM icons `lucide-react` only.
- Never use `useBlocker`.
- Lanes must NOT run `deno`, `npm run check:functions` or `npm run test:functions` while sharing `node_modules` with other lanes; the controller runs them after integration, then `git checkout deno.lock && npm ci`.
- Each lane works in its own nested worktree under `.superpowers/` with `node_modules` and `packages/import-parsers/node_modules` symlinked from the session worktree. Never `rm -rf .superpowers` (tracked files live there).

## Shared contracts

### SQL objects (Lane DB produces; everyone else consumes)

Columns:
- `agenda_eventos.compartilhado_cliente boolean NOT NULL DEFAULT false`, CHECK `agenda_eventos_compartilhado_ck`: `NOT compartilhado_cliente OR (cliente_id IS NOT NULL AND NOT privado)`.
- `agenda_ocorrencias.sequencia int NOT NULL DEFAULT 0`.

Tables: `agenda_respostas_cliente`, `agenda_remarcacoes`, `agenda_emails_cliente` exactly as spec §3, §4, §5. Queue columns: `id bigserial PK, conta_id uuid, cliente_id bigint, evento_id bigint, tipo text CHECK IN ('convite','alteracao','cancelamento','remarcacao_aceita','remarcacao_recusada'), ocorrencias jsonb NOT NULL DEFAULT '[]', remarcacao jsonb NULL, versao int NOT NULL DEFAULT 1, status text CHECK IN ('pendente','enviando','enviado','falhou','descartado') DEFAULT 'pendente', enviar_apos timestamptz, tentativas int DEFAULT 0, lease_ate timestamptz, enviado_em timestamptz, ultimo_erro text, criado_em timestamptz DEFAULT now()`. Index `(status, enviar_apos)`.

Occurrence snapshot entry (jsonb, used by queue items and returned by Hub RPCs):
```json
{ "ocorrencia_id": 1, "estado": "ativa", "sequencia": 2,
  "inicio": "2026-10-09T17:00:00+00:00", "fim": "2026-10-09T18:00:00+00:00",
  "dia_inteiro": false, "data_inicio_local": "2026-10-09", "data_fim_local": "2026-10-09",
  "tz": "America/Sao_Paulo", "titulo": "Gravação", "descricao": null,
  "local": null, "link_reuniao": null }
```
`estado` is `ativa` or `cancelada`. Effective content applies `campos_sobrescritos` exactly as `agenda_listar` does.

Queue `remarcacao` jsonb: `{ "remarcacao_id", "inicio_sugerido", "fim_sugerido", "mensagem", "resposta_equipe" }`.

Functions:
- `agenda_cliente_enfileirar(p_conta uuid, p_cliente bigint, p_evento bigint, p_tipo text, p_ocorrencias jsonb, p_remarcacao jsonb DEFAULT NULL) RETURNS void` (internal, no grants to `authenticated`): merges into a mergeable item (`status='pendente' AND lease_ate IS NULL AND enviar_apos > now()` with the same `(cliente_id, evento_id)` and a non-`remarcacao_*` tipo) or inserts. Merge per spec §5. Bumps `agenda_ocorrencias.sequencia` for every `ocorrencia_id` in `p_ocorrencias` whose row still exists, and writes the bumped value into the snapshot.
- `agenda_cliente_ocorrencias_snapshot(p_evento bigint, p_estado text, p_ocorrencia bigint DEFAULT NULL) RETURNS jsonb` (internal): future occurrences (`fim > now()`, `inicio < now() + 90 days`, not cancelled, `ORDER BY inicio LIMIT 50`), or the single `p_ocorrencia`, as snapshot entries with `estado = p_estado`.
- `agenda_cliente_claim_emails(p_limit int DEFAULT 20) RETURNS jsonb` (service_role): first settles gated items as `descartado` (gates in spec §5), then claims due `pendente` items (`enviar_apos <= now()`, `tentativas < 3`) and expired leases with `FOR UPDATE SKIP LOCKED`, sets `status='enviando', lease_ate = now() + 2 min, tentativas = tentativas + 1`. Returns `[{ "id", "versao", "tipo", "conta_id", "cliente_id", "ocorrencias", "remarcacao", "cliente_email", "cliente_nome", "workspace_nome" }]`.
- `agenda_cliente_marcar_email(p_id bigint, p_versao int, p_ok boolean, p_erro text DEFAULT NULL) RETURNS void` (service_role): `ok` → `enviado`; else back to `pendente` with `lease_ate = NULL`, or `falhou` at 3 attempts. No-op when `versao` differs.
- `agenda_cliente_tick() RETURNS void` + pg_cron job `agenda-cliente-email` `* * * * *`: calls `/functions/v1/agenda-cliente-email` with `x-cron-secret` (vault, as `agenda_tick_lembretes` does) only when a due item exists; `net.http_post` wrapped in `BEGIN/EXCEPTION`.
- `agenda_hub_listar(p_conta uuid, p_cliente bigint, p_apos_inicio timestamptz DEFAULT NULL, p_apos_id bigint DEFAULT NULL, p_limite int DEFAULT 100) RETURNS jsonb` → `{ "estado": "ok"|"desligado", "itens": [Item], "proximo": { "inicio", "id" } | null }`. Window: `fim >= now() - 30 days`, keyset `(inicio, id) > (p_apos_inicio, p_apos_id)`, `p_limite` clamped to 1..100.
- `agenda_hub_ocorrencia(p_conta uuid, p_cliente bigint, p_ocorrencia bigint) RETURNS jsonb` → `Item` or NULL.
- `Item` = snapshot entry fields (without `estado`) + `"resposta": "sim"|"nao"|null` (effective, spec §3) + `"remarcacao": { "id", "inicio_sugerido", "fim_sugerido", "mensagem", "criado_em" } | null` (pending only).
- `agenda_hub_responder(p_conta uuid, p_cliente bigint, p_ocorrencia bigint, p_resposta text, p_inicio_visto timestamptz) RETURNS jsonb` → `Item`. Notifies `event_client_rsvp` only when the effective answer changes.
- `agenda_hub_remarcar(p_conta uuid, p_cliente bigint, p_ocorrencia bigint, p_data date, p_hora time, p_mensagem text) RETURNS jsonb` → `Item`. `p_hora` NULL is required for all-day and forbidden otherwise (`hora_obrigatoria`). Notifies `event_reschedule_requested`.
- `agenda_hub_cancelar_remarcacao(p_conta uuid, p_cliente bigint, p_remarcacao bigint) RETURNS void`.
- `agenda_remarcacao_resolver(p_remarcacao bigint, p_aceitar boolean, p_mensagem text DEFAULT NULL) RETURNS void` (authenticated): errors in Portuguese via the same `RAISE EXCEPTION` style as `agenda_evento_editar` ("Este pedido já foi resolvido.", "Esse horário já passou. Combine outro com o cliente.", "Sem permissão para editar este evento.").
- `agenda_cliente_lembretes_pendentes(p_conta uuid, p_cliente bigint, p_now timestamptz) RETURNS jsonb` (service_role) → `[{ "ocorrencia_id", "inicio", "fim", "dia_inteiro", "data_inicio_local", "tz", "titulo" }]` per spec §9, gated by `feature_agenda`, max 20.
- `agenda_cliente_lembretes_marcar(p_conta uuid, p_cliente bigint, p_itens jsonb) RETURNS void` (service_role): `p_itens` = `[{ "ocorrencia_id", "inicio" }]`, upserts `lembrado_inicio`.
- `agenda_listar(...)` same parameters; return columns gain, appended in this order: `compartilhado_cliente boolean, cliente_resposta text, remarcacao_pendente jsonb, sequencia int`.
- `agenda_feed_eventos(p_token)`: each item gains `"sequencia"`.
- Notification types `event_client_rsvp`, `event_reschedule_requested`; metadata `{ "evento_id", "ocorrencia_id", "titulo", "inicio", "cliente_nome", "resposta"? , "inicio_sugerido"? }`, link `/calendario?evento=<ocorrencia_id>`.

### `hub-agenda` HTTP (Lane Hub API produces; Lane Hub UI consumes)

Base `${SUPABASE_URL}/functions/v1/hub-agenda`. JSON errors `{ "error": "<pt>" }`.
- `GET ?token=T[&apos_inicio=ISO&apos_id=N]` → `200 { "itens": [Item], "proximo": {...}|null }`; flag off → 404.
- `GET ?token=T&ocorrencia=N` → `200 { "item": Item }` or 404 (deep link).
- `GET /ocorrencia/<N>.ics?token=T` → `text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>.ics"`.
- `POST { "token", "acao": "responder", "ocorrencia_id", "resposta": "sim"|"nao", "inicio_visto" }` → `200 { "item": Item }`.
- `POST { "token", "acao": "remarcar", "ocorrencia_id", "data": "YYYY-MM-DD", "hora": "HH:MM"|null, "mensagem": string }` → `200 { "item": Item }`.
- `POST { "token", "acao": "cancelar_remarcacao", "remarcacao_id" }` → `200 { "ok": true }`.
- Error map: `nao_encontrado`/`desligado` → 404 "Evento não encontrado."; `horario_mudou` → 409 "Este evento mudou de horário. Atualize a página."; `ja_aconteceu` → 409 "Este evento já aconteceu."; `sugestao_passada` → 400 "Escolha um horário no futuro."; `hora_obrigatoria` → 400 "Informe o horário."; `pedido_pendente` → 409 "Já existe um pedido de remarcação para este evento."; `ja_resolvido` → 409 "Este pedido já foi resolvido."; bad body → 400 "Dados inválidos."; anything else → 500 "Erro interno".
- `hub-bootstrap` response gains optional `feature_agenda?: boolean`.

### CRM store (Lane CRM UI produces)

- `AgendaOcorrencia` gains `compartilhado_cliente: boolean; cliente_resposta: 'sim' | 'nao' | 'aguardando' | null; remarcacao_pendente: { id: number; inicio_sugerido: string; fim_sugerido: string; mensagem: string | null; criado_em: string } | null; sequencia: number`.
- `AgendaEventoPayload` gains `compartilhado_cliente?: boolean`.
- `resolverRemarcacao(id: number, aceitar: boolean, mensagem?: string): Promise<void>` → `supabase.rpc('agenda_remarcacao_resolver', {...})`.

---

### Task 1 (Lane DB): migration, entitlement suite, rollback runbook

**Spec:** §1, §3, §4, §5, §8 (SQL parts), §9 (SQL parts), §10, Rollout.

**Files:**
- Create: `supabase/migrations/20261007000001_agenda_hub.sql`
- Create: `supabase/tests/entitlements/99_agenda_hub.sql`
- Modify: `supabase/tests/entitlements/99_agenda_edicao.sql` (type lists), `docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql` (step 4b)

- [ ] **Step 1: Write the entitlement suite first** (`99_agenda_hub.sql`), modelled on `99_agenda_feed.sql` (fixtures from `current_date`, `pg_temp` helpers, `et_grant_hosted_parity()`). Blocks, each `RAISE EXCEPTION` on failure:
  1. Visibility via `agenda_hub_listar`: shared event of cliente A appears for A; not for cliente B (same workspace); not for another workspace; private event rejected at create (`agenda_validar_payload` message "Evento privado não pode ser compartilhado com o cliente."); cancelled occurrence absent; archived cliente → `agenda_hub:nao_encontrado` on responder; flag off → `{"estado":"desligado"}`.
  2. Responses: `responder` sim → item `resposta = 'sim'`; edit the occurrence `inicio` (as organizer, `esta`) → `resposta` NULL; edit only `fim` → keeps `sim`; switch the series to cliente B with `todas` → A's row deleted; `inicio_visto` mismatch → `agenda_hub:horario_mudou`; ended occurrence → `agenda_hub:ja_aconteceu`.
  3. Reschedule: create → pending; second create → `agenda_hub:pedido_pendente`; past suggestion → `agenda_hub:sugestao_passada`; all-day with hora → `agenda_hub:hora_obrigatoria`; `agenda_remarcacao_resolver(id, true)` moves only that occurrence, sets client `sim` for the new `inicio`, status `aceita`; second resolve → "Este pedido já foi resolvido."; pending request on an occurrence then moved by `agenda_evento_editar` → `substituida`; pending request then series `seguintes` split / `todas` rule change / `excluir todas` → `substituida` row survives (not cascaded) only until its occurrence is deleted; assert status was `substituida` before delete by checking the queue/audit or by using an occurrence that survives the regen.
  4. Queue: create shared event → one `convite` item with N snapshot entries, `sequencia` bumped to 1; second edit within the window → same item, `versao = 2`; item under lease (`UPDATE ... SET status='enviando', lease_ate = now()+2min`) + edit → a second item; `convite` then `excluir todas` before send → item `descartado` or empty; `excluir todas` after send → `cancelamento` item whose snapshot survives the series `DELETE`; un-share → `cancelamento` to the old cliente; `agenda_cliente_claim_emails` skips a cliente with `send_event_email = false` (→ `descartado`) and returns `cliente_email`; `agenda_cliente_marcar_email` with a stale `versao` is a no-op.
  5. Notifications: client RSVP inserts `event_client_rsvp` for the organizer; the same answer twice inserts once; organizer removed from `workspace_members` → owner/admin receive it; reschedule inserts `event_reschedule_requested`.
  6. Digest RPCs: an unanswered shared occurrence starting in 24 h appears in `agenda_cliente_lembretes_pendentes`; after `agenda_cliente_lembretes_marcar` it does not; after moving its `inicio` it appears again.
  7. Composite FKs: inserting a response/remarcação row whose `conta_id` differs from the occurrence's (as service_role) fails with a FK violation.
  8. Grants: `anon` and `authenticated` cannot execute any `agenda_hub_*`, `agenda_cliente_*`; cannot select the three tables; `authenticated` can execute `agenda_remarcacao_resolver`; `anon` cannot.
  9. `agenda_listar` returns the four new columns with the right values for a shared event, NULLs for a masked one.

- [ ] **Step 2: Run it against the local stack and confirm it fails** (objects missing): `bash scripts/test-entitlements.sh` with the per-worktree port overrides (memory: local Supabase on colima; back up and restore `supabase/config.toml`).

- [ ] **Step 3: Write the migration.** Order inside the file:
  1. Columns and CHECK; tables with composite FKs, partial unique index `agenda_remarcacoes(ocorrencia_id) WHERE status = 'pendente'`, RLS, revokes, grants.
  2. Notification types: rebuild `notifications_type_check`, `notification_inapp_prefs_type_check`, `notification_email_prefs_type_check` from the list in `20261005000001` plus the two new types; replace `claim_notification_emails` adding both to its array (copy the current body from `20261005000001:570-612` verbatim, add the two literals).
  3. `agenda_validar_payload`: copy the current body verbatim from `20261005000001`, add `compartilhado_cliente` parsing (boolean, default from base or false), the private/cliente rule and its message, and keep it in the series-only field list for `esta`.
  4. Internal helpers `agenda_cliente_ocorrencias_snapshot`, `agenda_cliente_enfileirar`, plus `agenda_cliente_substituir_pedidos(p_evento bigint, p_ocorrencia bigint DEFAULT NULL)` (marks pending requests `substituida`).
  5. `agenda_evento_criar`, `agenda_evento_editar`, `agenda_evento_excluir`: copy each current body verbatim and add only the enqueue/substitute calls at the points the spec names. In `editar`, compute `v_antes` (cliente_id, compartilhado_cliente, snapshot of affected future occurrences) right after the series `FOR UPDATE` and before any regenerate/split/delete; enqueue after the change. The `seguintes` split `INSERT INTO agenda_eventos` column list gains `compartilhado_cliente`. Deleted occurrences enter the snapshot as `cancelada`. A transaction-local `current_setting('agenda.remarcacao', true)` set by `agenda_remarcacao_resolver` makes the enqueue use tipo `remarcacao_aceita` with the `remarcacao` payload instead of `alteracao`.
  6. `DROP FUNCTION agenda_listar(timestamptz, timestamptz, bigint)` + `CREATE` with the four appended columns; restore its grants.
  7. Replace `agenda_feed_eventos` adding `sequencia` (copy body verbatim from `20261006000001`).
  8. Hub RPCs, `agenda_remarcacao_resolver`, queue RPCs, digest RPCs, `agenda_cliente_tick` and the cron job.
  9. Grants block and a final `DO $$ ... $$` that asserts the grants (pattern of `20261005000001:234-263`).

- [ ] **Step 4: Run the suite until green**, then the whole entitlement run (`bash scripts/test-entitlements.sh`) to catch regressions in `99_agenda_*`.

- [ ] **Step 5: Update `99_agenda_edicao.sql`** type assertions for the two new types; **rollback runbook step 4b** per spec "Rollback", pasting the pre-migration definitions of every replaced function (from `20261005000001` / `20261006000001`), and add the two literals to the `event_*` regex at `2026-10-05-agenda-rollback.sql:66-83`.

- [ ] **Step 6: Commit** `feat(agenda): Hub sharing, client responses, reschedule requests and e-mail queue (DB)`.

---

### Task 2 (Lane Email): `ics.ts`, `sendViaResend` attachments, `agenda-cliente-email`, digest reminders, team digest copy

**Spec:** §5 (send side), §6, §8 (digest copy), §9 (handler side).

**Files:**
- Modify: `supabase/functions/_shared/ics.ts` (optional `sequencia?: number` on `IcsEvento`, emits `SEQUENCE:<n>` after `DTSTAMP` only when present)
- Modify: `supabase/functions/_shared/lifecycle-emails.ts` (`sendViaResend` gains a trailing optional `attachments?: { filename: string; content: string; content_type: string }[]`, sent as `attachments` only when non-empty)
- Create: `supabase/functions/_shared/agenda-cliente-email.ts` (pure: `montarEmailAgendaCliente(item, ctx) → { subject, html, attachments }`)
- Create: `supabase/functions/agenda-cliente-email/{handler.ts,index.ts}` (cron, `x-cron-secret`, deps-injected like `agenda-lembretes-email`)
- Modify: `supabase/functions/client-event-email-cron/handler.ts`, `supabase/functions/_shared/client-event-email.ts` (events section, events-only variant, key with `oc:<id>:<inicio>`)
- Modify: `supabase/functions/_shared/notification-email.ts` (`resolveDigestItem` cases for the two new types)
- Modify: `supabase/config.toml` (`[functions.agenda-cliente-email] verify_jwt = false`)
- Test: `supabase/functions/__tests__/ics_test.ts`, `agenda-cliente-email_test.ts`, `client-event-email-cron_test.ts`, `lifecycle-emails_test.ts` (or the existing sendViaResend test file), `notification-email_test.ts`

**Interfaces:** consumes `agenda_cliente_claim_emails`, `agenda_cliente_marcar_email`, `agenda_cliente_lembretes_pendentes`, `agenda_cliente_lembretes_marcar` (shapes above); `hubUrlFor` / `resolveHubUrl` from `_shared/hub-url.ts`; `signUnsubToken`, `sanitizeSubjectValue`, `escapeHtml` from `_shared/client-event-email.ts`.

- [ ] **Step 1: Failing tests.**
  - `ics_test.ts`: `sequencia: 2` → contains `SEQUENCE:2`; no `sequencia` → output byte-identical to the current fixture (protects the feed).
  - `agenda-cliente-email_test.ts` (fake deps for `rpc`, `send`, `hubUrl`):
    - `convite` with 1 active occurrence → subject `Novo evento: <titulo sanitized>`, attachment `evento.ics` with one `VEVENT`, `SEQUENCE`, button to `<hubUrl>/agenda?ocorrencia=<id>`;
    - no Hub URL → no button, attachment present;
    - all `cancelada` → subject `Evento cancelado: ...`, no attachment, body contains "Se você adicionou este evento ao seu calendário, remova-o.";
    - mixed → `Evento atualizado: ...` with "abra o arquivo anexo para atualizá-lo";
    - `remarcacao_aceita` and `remarcacao_recusada` (with `resposta_equipe` escaped);
    - idempotency key `agenda-cliente:<id>:<versao>`;
    - send throws → `agenda_cliente_marcar_email(id, versao, false, <name only>)`;
    - wrong cron secret → 401;
    - HTML in `titulo` is escaped and a CRLF in `titulo` never reaches the subject.
  - `client-event-email-cron_test.ts`: client with zero posts/messages and one reminder → e-mail sent, events-only title, key includes `oc:<id>:<inicio>`, `agenda_cliente_lembretes_marcar` called after success and not after failure; flag off (RPC returns `[]`) → behaviour unchanged.
  - `sendViaResend` with attachments posts `attachments: [{ filename, content, content_type }]`; without, the body has no `attachments` key.
  - `resolveDigestItem` renders both new types without `ator_nome`.
- [ ] **Step 2:** do not run deno yourself (Global Constraints); hand the test files to the controller list in the report.
- [ ] **Step 3: Implement.** Copy in Portuguese, no em-dashes:
  - subjects `Novo evento: `, `Evento atualizado: `, `Evento cancelado: `, `Remarcação aceita: `, `Remarcação não aceita: `;
  - buttons "Confirmar presença" (convite and alteração) and "Ver no portal" (the rest);
  - From `"<Workspace> <notificacoes@mesaas.com.br>"` with `sanitizeSubjectValue` on the name;
  - `List-Unsubscribe` / `List-Unsubscribe-Post` exactly as `client-event-email-cron` builds them.
  - Times are formatted in the occurrence `tz` with `Intl.DateTimeFormat('pt-BR', { timeZone })`, plus `(<tz>)` when tz ≠ `America/Sao_Paulo`. Recurring snapshots list up to 10 dates in the body and "e mais N datas".
- [ ] **Step 4: Commit** `feat(agenda): client e-mails with .ics and Hub digest reminders`.

---

### Task 3 (Lane Hub API): `hub-agenda`, `hub-bootstrap`, `agenda-feed` sequence

**Spec:** §7, §6 (sequence in downloads), Erros e casos limite.

**Files:**
- Create: `supabase/functions/hub-agenda/{handler.ts,index.ts}`
- Modify: `supabase/functions/hub-bootstrap/handler.ts` (+ `feature("feature_agenda")` in the existing parallel lookups, response field `feature_agenda`)
- Modify: `supabase/functions/agenda-feed/handler.ts` (`paraIcs` passes `sequencia` from rows; `FeedEventoRow` gains `sequencia?: number`; the download path reads `agenda_listar`'s new `sequencia`)
- Modify: `supabase/config.toml` (`[functions.hub-agenda] verify_jwt = false`)
- Test: `supabase/functions/__tests__/hub-agenda_test.ts`, `hub-bootstrap_test.ts`, `agenda-feed_test.ts`

**Interfaces:** consumes the `agenda_hub_*` RPCs and `resolveHubToken`, `checkRateLimit`, `createJsonResponder`, `insertAuditLog`, `gerarCalendario`; produces the HTTP contract above.

- [ ] **Step 1: Failing tests** (fake deps, the `hub-approve` test file is the pattern):
  - unknown token → 404 and the badtoken budget; badtoken exhausted → 429;
  - `hub-read` exhausted → 429 for GET and POST;
  - `hub-write` exhausted → 429 for POST only;
  - list passes `p_apos_inicio`/`p_apos_id` from the query and returns `proximo`;
  - RPC `estado: 'desligado'` → 404;
  - each `agenda_hub:<codigo>` maps to the status and message in the contract;
  - `responder` validates `resposta ∈ {sim, nao}` and `inicio_visto` is an ISO string;
  - `remarcar` validates `data` `^\d{4}-\d{2}-\d{2}$`, `hora` `^\d{2}:\d{2}$` or null, `mensagem` ≤ 1000;
  - `.ics` route returns `text/calendar` with `SEQUENCE`, 404 when the RPC returns NULL;
  - writes call `insertAuditLog` with `action: 'hub_agenda_<acao>'`, `resource_type: 'agenda_ocorrencia'`;
  - OPTIONS 204 with CORS from `buildCorsHeaders`;
  - `hub-bootstrap` returns `feature_agenda` true/false;
  - `agenda-feed` emits `SEQUENCE:<n>` when the row has it.
- [ ] **Step 2:** no deno runs (Global Constraints).
- [ ] **Step 3: Implement.** Order of checks is the house order (token → badtoken → `hub-read` → for POST `hub-write`). Map the RPC error by matching `^agenda_hub:(\w+)$` in `error.message`; log only the code.
- [ ] **Step 4: Commit** `feat(agenda): hub-agenda API for the client portal`.

---

### Task 4 (Lane CRM UI): share switch, client state, reschedule actions, notification types

**Spec:** §1, §8 (CRM parts), §10, Interface (Formulário, Popover).

**Files:**
- Modify: `apps/crm/src/store/agenda.ts` (types + `resolverRemarcacao`)
- Modify: `apps/crm/src/pages/calendario/agenda/eventoFormSchema.ts`, `EventoFormDialog.tsx` (switch under the cliente Select, hidden when `privado`, forced off when cliente is `'none'`; helper texts per spec; needs `clientes.email` and the workspace Hub flag: read `email` in the existing clients query and `feature_hub_portal` from the workspace limits/flags hook the CRM already uses for the Hub tab)
- Modify: `apps/crm/src/pages/calendario/agenda/EventoPopover.tsx` (client line + pending reschedule block with Aceitar / Recusar; Recusar expands a `Textarea` and a "Enviar" button)
- Modify: `apps/crm/src/store/notifications.ts`, `apps/crm/src/lib/notification-catalog.ts`, `apps/crm/src/lib/notification-config.ts`
- Test: `apps/crm/src/pages/calendario/agenda/__tests__/EventoFormDialog.test.tsx`, `EventoPopover.test.tsx`, `apps/crm/src/__tests__/notification-catalog.test.ts`, `notification-config` tests if present

- [ ] **Step 1: Failing tests.**
  - Form:
    - the switch appears only with a cliente;
    - hidden when Privado is on, and turning Privado on clears it;
    - payload carries `compartilhado_cliente`;
    - cliente without e-mail shows "Este cliente não tem e-mail cadastrado. O evento aparece só no portal.";
    - workspace without Hub shows "O cliente recebe o convite por e-mail.".
  - Popover:
    - `cliente_resposta` `sim`/`nao`/`aguardando` → "Confirmou"/"Recusou"/"Aguardando resposta";
    - `remarcacao_pendente` renders "A <cliente> pediu para remarcar para <data formatada>";
    - Aceitar calls `resolverRemarcacao(id, true)` and invalidates the agenda queries;
    - Recusar with text calls `resolverRemarcacao(id, false, 'texto')`;
    - error message from the RPC shown via `toast.error(formatAgendaError(...))`;
    - the block is hidden when `pode_editar` is false (shows the state only).
  - Notifications: the catalog count tests move from 27/13 to 29/15 (adjust to the real current numbers +2), and `getNotificationDisplay` for both types uses `metadata.cliente_nome`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/calendario apps/crm/src/__tests__/notification-catalog.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Copy:
  - switch label "Compartilhar com o cliente", help "Aparece no portal do cliente e ele recebe o convite por e-mail.";
  - popover line "Cliente: <nome> · Confirmou";
  - buttons "Aceitar", "Recusar", "Enviar";
  - catalog labels "Cliente respondeu a um evento" and "Cliente pediu para remarcar";
  - config texts "<cliente> confirmou <titulo>" / "<cliente> recusou <titulo>" / "<cliente> pediu para remarcar <titulo>".
- [ ] **Step 4: Run** the same vitest command → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit`; `npx eslint` on touched files; `npx prettier --check` on touched files.
- [ ] **Step 5: Commit** `feat(agenda): share events with the client and act on reschedule requests (CRM)`.

---

### Task 5 (Lane Hub UI): Agenda page, home block, nav, i18n

**Spec:** §2, §7 (UI), Interface (Hub), Erros e casos limite.

**Files:**
- Modify: `apps/hub/src/types.ts` (`feature_agenda?: boolean`; `HubAgendaItem` mirroring `Item`)
- Modify: `apps/hub/src/api.ts` (`fetchAgenda(token, apos?)`, `fetchAgendaItem(token, id)`, `responderAgenda(token, ocorrenciaId, resposta, inicioVisto)`, `remarcarAgenda(token, ocorrenciaId, data, hora, mensagem)`, `cancelarRemarcacao(token, remarcacaoId)`, `agendaIcsUrl(token, id)`)
- Modify: `apps/hub/src/queries.ts` (keys `['hub-agenda', token]` infinite query, `['hub-agenda-item', token, id]`)
- Modify: `apps/hub/src/shell/navItems.ts` (`getVisibleNavItems(featureMensagens, featureAgenda)`; item "Agenda", lucide `CalendarDays`, path `agenda`, after the posts calendar entry), both nav renderers
- Modify: `apps/hub/src/router.tsx` (lazy child route `agenda`)
- Create: `apps/hub/src/pages/AgendaPage.tsx`, `apps/hub/src/pages/agenda/AgendaCard.tsx`, `apps/hub/src/pages/agenda/RemarcarDialog.tsx`, `apps/hub/src/pages/agenda/formatar.ts` (pure date/time formatting in the item `tz`, Google link builder reusing the CRM logic shape)
- Modify: `apps/hub/src/pages/HomePage.tsx` ("Próximos eventos" block with up to 3 items + "Ver agenda", and a pending-answer notice; only with `feature_agenda`)
- Create: `packages/i18n/locales/pt/hubAgenda.json`, `packages/i18n/locales/en/hubAgenda.json`; modify `apps/hub/src/main.tsx` (register namespace), `packages/i18n/locales/{pt,en}/common.json` (nav label)
- Test: `apps/hub/src/pages/__tests__/AgendaPage.test.tsx`, `apps/hub/src/pages/agenda/__tests__/formatar.test.ts`, `apps/hub/src/shell/__tests__/navItems.test.ts`, HomePage test

- [ ] **Step 1: Failing tests** (mock `api.ts`):
  - list grouped by day with "Próximos" and a collapsed "Anteriores";
  - "Confirmar" sends `inicio_visto` = the item's `inicio` and updates the badge to "Confirmado";
  - 409 "Este evento mudou de horário. Atualize a página." shows the message and refetches;
  - "Não vou" → "Você recusou";
  - "Pedir para remarcar" opens the dialog: all-day item has no time field; submitting sends `data`/`hora` in the item's local wall time (fixture tz `America/Manaus`, browser `America/Sao_Paulo`: the sent `hora` is the Manaus wall time);
  - pending request shows "Você pediu para remarcar para … Aguardando a equipe." and "Cancelar pedido";
  - `?ocorrencia=<id>` scrolls to and highlights the card (fetching it via `fetchAgendaItem` when not in the first page);
  - "Carregar mais" fetches the next page with the cursor;
  - empty state "Nenhum evento por aqui ainda.";
  - nav hides "Agenda" when `feature_agenda` is false or absent;
  - Home block hidden without the flag.
- [ ] **Step 2: Run** `npx vitest run apps/hub` → FAIL.
- [ ] **Step 3: Implement** with the Hub's existing card/button styles (`hub-card`, `--hub-*` variables; no Tailwind variants on `hub-*` classes) and its mobile layout (sheet-like full-width dialog under `md`). Google link: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=..&dates=..&details=..&location=..` (UTC `YYYYMMDDTHHMMSSZ`, all-day `YYYYMMDD/YYYYMMDD` exclusive end).
- [ ] **Step 4: Run** vitest → PASS; `npx tsc -p apps/hub/tsconfig.json --noEmit`; eslint and prettier on touched files.
- [ ] **Step 5: Commit** `feat(agenda): Agenda page and upcoming events in the client Hub`.

---

### Task 6 (Controller): integrate, verify, ship

- [ ] Merge the five lanes; resolve `supabase/config.toml` (two new blocks). Update `CLAUDE.md` (deploy gotcha list: `hub-agenda`, `agenda-cliente-email` need `--no-verify-jwt`) and `README.md` function count 86 → 88.
- [ ] Gates: `npm run lint`, `npm run format:check`, four `tsc`, `npm run test`, `npm run coverage:check`, `npm run check:functions`, `npm run test:functions` (then `git checkout deno.lock && npm ci`), entitlement suites on the local stack.
- [ ] Browser verification on the local stack (memory recipe: seed users, port overrides, stub only what cannot run locally): CRM share switch and avisos, popover client state, accept/decline a request; Hub Agenda page desktop + 375px, confirm, decline, reschedule (all-day and timed), cancel request, deep link, `.ics` download, Google link; Home block; e-mail HTML rendered from a captured `montarEmailAgendaCliente` output.
- [ ] Final whole-branch review (Fable). Open PR. Watch the Codex review.
- [ ] Rollout (needs the user's OK for each prod step): `db push --linked` → verify objects, grants, cron job → deploy `agenda-cliente-email` and `hub-agenda` (`--no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw`), `hub-bootstrap` (`--no-verify-jwt`), `client-event-email-cron` (`--no-verify-jwt`), `agenda-feed` (`--no-verify-jwt`), `notification-email-cron` (`--no-verify-jwt`) → smoke → merge → pilot: share an event with a test cliente, check the e-mail and `.ics` in Gmail and Apple Mail, confirm and reschedule from the Hub.
