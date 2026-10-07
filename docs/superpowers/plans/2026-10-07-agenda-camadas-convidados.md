# Agenda sub-project 4: layers, Hub calendar events, external guests - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `feature_agenda` on, the CRM Agenda gains read-only layers (scheduled posts, delivery deadlines, receivables, team payments, client dates, commemorative dates) replacing the "Calendário" and "Datas Comemorativas" tabs; the Hub home calendar shows the client's shared events; and the team can invite external guests by e-mail, who confirm or decline each date on a public page.

**Architecture:** Two migrations. `20261008000001_agenda_hub_periodo.sql` adds a date-range RPC for the Hub. `20261008000002_agenda_convidados.sql` adds guests, guest answers, an unsubscribe blocklist, generalizes the client e-mail queue to two recipient kinds, hooks the write RPCs, appends `convidados` to `agenda_listar` and adds the `event_guest_rsvp` notification type. One new Deno function (`agenda-convite`); `hub-agenda`, `agenda-cliente-email`, `client-email-unsub` and `notification-email-cron` change. The CRM layers are pure frontend over existing store functions. The Hub splits `AgendaCard` into a presentational view, then reuses it in the home calendar and in a new public `/convite/:token` page.

**Tech Stack:** Postgres (plpgsql, SECURITY DEFINER, advisory locks), Deno edge functions, Resend, React 19 + TanStack Query + FullCalendar + shadcn/Radix (CRM), the Hub's Tailwind components, i18next (`packages/i18n`), Vitest, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-10-07-agenda-camadas-convidados-design.md` is the source of truth, including its "Revisões aplicadas" section. Each task names the spec sections it implements; read them before coding. The contracts below are binding between lanes: a lane may not change a signature another lane consumes.

## Global Constraints

- Migration files: `supabase/migrations/20261008000001_agenda_hub_periodo.sql` and `supabase/migrations/20261008000002_agenda_convidados.sql` (main's tail is `20261007000001`). Re-check uniqueness against `origin/main` at PR time.
- Every new table: RLS enabled, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT ALL ... TO service_role`. Composite FKs only (`(evento_id, conta_id) → agenda_eventos(id, conta_id)`, `(ocorrencia_id, conta_id) → agenda_ocorrencias(id, conta_id)`, `(convidado_id, conta_id) → agenda_convidados(id, conta_id)`), `ON DELETE CASCADE`. The queue keeps no FK to guests or events.
- Hub/convite/queue RPCs: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`. `agenda_listar` keeps its grants (`authenticated`, `service_role`, never `anon`).
- Replaced functions are copied verbatim from their newest definition (`20261007000001_agenda_hub.sql` for everything sub-project 3 touched) and changed only where this plan says.
- CRM-visible SQL errors carry the `agenda: ` prefix (`formatAgendaError`, `store/agenda.ts`), e.g. `'agenda: evento privado não pode ter convidados externos.'`. Public RPC errors: `RAISE EXCEPTION 'agenda_hub:<codigo>'` (period) and `'agenda_convite:<codigo>'` (guest page), `ERRCODE = 'P0001'`.
- Timestamps compared as `timestamptz` in SQL, never as text. E-mails compared and stored lower-case.
- Guest caps: 20 active guests per series; 50 new distinct guest e-mails per workspace per 24 h; 1000 per platform per 24 h; all checked in the write RPC after `pg_advisory_xact_lock(hashtextextended('agenda-convidados:' || conta_id::text, 0))` (platform cap under a second lock `hashtextextended('agenda-convidados:plataforma', 0)`, taken after the workspace lock).
- Rate limits (`checkRateLimit(db, key, max, windowSeconds)`): `convite-badtoken:<ip>` 30/600, `convite-read:<convidado_id>` 300/300, `convite-write:<convidado_id>` 20/600. `hub-agenda` period reads spend the existing `hub-read:<conta>:<cliente>` 300/300.
- CORS: `buildCorsHeaders(req)` on every response including OPTIONS and errors. Never `*`.
- `.ics`: `METHOD:PUBLISH`, UID `agenda-oc-<ocorrencia_id>@mesaas.com.br`, `SEQUENCE` from the snapshot; no ORGANIZER/ATTENDEE/RRULE.
- User-facing copy in Portuguese (Hub also English via i18n), no em-dashes. Icons `lucide-react` only.
- Never use `useBlocker`. Flag-off `/calendario` must render exactly today's page.
- Lanes must NOT run `deno`, `npm run check:functions` or `npm run test:functions` (shared `node_modules`); the controller runs them, then `git checkout deno.lock && npm ci`.
- Each lane works in its own nested worktree under `.superpowers/sdd/2026-10-07-agenda-camadas/wt/<lane>` with `node_modules` (and `packages/import-parsers/node_modules`) symlinked from the session worktree. Never `rm -rf .superpowers`.

## Shared contracts

### SQL, migration A `20261008000001_agenda_hub_periodo.sql` (Lane Hub API produces)

- `agenda_hub_visivel(e agenda_eventos, o agenda_ocorrencias, p_cliente bigint) RETURNS boolean` (internal, `STABLE`, no grants): `e.compartilhado_cliente AND e.cliente_id = p_cliente AND NOT e.privado AND NOT o.cancelada`. `agenda_hub_listar` is replaced (verbatim body) to use it; no behavior change.
- `agenda_hub_periodo(p_conta uuid, p_cliente bigint, p_de timestamptz, p_ate timestamptz) RETURNS jsonb` → `{ "estado": "ok"|"desligado"|"cliente_inativo", "itens": [Item] }`, `Item` exactly as `agenda_hub_listar` items (built by the same item helper `agenda_hub_listar` uses). Occurrences with `inicio < p_ate AND fim > p_de`, `ORDER BY inicio, id`, `LIMIT 300`. `p_ate <= p_de` or `p_ate - p_de > interval '45 days'` → `agenda_hub:periodo_invalido`.

### SQL, migration B `20261008000002_agenda_convidados.sql` (Lane DB produces)

Tables:
- `agenda_convidados(id bigint generated always as identity PK, conta_id uuid NOT NULL, evento_id bigint NOT NULL, email text NOT NULL CHECK (email = lower(email) AND length(email) <= 254), nome text NULL CHECK (length(nome) <= 120), token text NOT NULL, adicionado_por uuid NULL REFERENCES auth.users ON DELETE SET NULL, criado_em timestamptz NOT NULL DEFAULT now(), removido_em timestamptz NULL, UNIQUE (id, conta_id))`; FK `(evento_id, conta_id)` cascade; unique `(evento_id, email) WHERE removido_em IS NULL`; unique `(evento_id, token) WHERE removido_em IS NULL`; index `(token) WHERE removido_em IS NULL`; index `(conta_id, criado_em)`.
- `agenda_respostas_convidado(ocorrencia_id bigint, convidado_id bigint, conta_id uuid, resposta text NOT NULL CHECK IN ('sim','nao'), respondido_em timestamptz NOT NULL, inicio_respondido timestamptz NOT NULL, PRIMARY KEY (ocorrencia_id, convidado_id))`, composite FKs to occurrences and guests, cascade.
- `agenda_convidados_bloqueio(conta_id uuid, email text CHECK (email = lower(email)), criado_em timestamptz DEFAULT now(), PRIMARY KEY (conta_id, email))`.
- Queue `agenda_emails_cliente`: `cliente_id` drops NOT NULL; adds `convidado_id bigint NULL`, `convidado_email text NULL`; CHECK `agenda_emails_destinatario_ck`: `num_nonnulls(cliente_id, convidado_id) = 1 AND ((convidado_id IS NULL) = (convidado_email IS NULL))`; CHECK: `convidado_id IS NULL OR tipo IN ('convite','alteracao','cancelamento')`; index `(convidado_id, evento_id) WHERE status = 'pendente'`.

Payload: `p_evento` jsonb gains optional `"convidados": [{ "email": string, "nome": string|null }]`. Absent on edit = unchanged; ignored for scope `esta`; `[]` removes all. Validation (in the write RPCs, not `agenda_validar_payload`): each e-mail matches `^[^@\s]+@[^@\s]+\.[^@\s]+$`, length ≤ 254, deduplicated after `lower(trim())`, nome trimmed ≤ 120 or NULL. Errors (exact):
- `'agenda: informe e-mails válidos para os convidados.'`
- `'agenda: no máximo 20 convidados externos por evento.'`
- `'agenda: evento privado não pode ter convidados externos.'` (also when making a series private while it has active guests: `'agenda: remova os convidados externos antes de tornar o evento privado.'`)
- `'agenda: %s já é da equipe. Adicione como participante.'` (first offending e-mail; match `lower(auth.users.email)` of `workspace_members` of the workspace)
- `'agenda: limite diário de convites externos atingido. Tente amanhã.'` (workspace 50 or platform 1000)

Functions:
- `agenda_definir_convidados(p_evento bigint, p_convidados jsonb, p_tail_desde date DEFAULT NULL) RETURNS void` (internal): takes the locks, validates, soft-removes (`removido_em = now()`) guests not in the list (enqueue `cancelamento` with the future snapshot), inserts new ones with `token = encode(gen_random_bytes(32),'hex')` (enqueue `convite`), updates `nome` of kept ones, writes `audit_log` per add/remove (`action` `agenda_convidado_adicionado` / `agenda_convidado_removido`, `resource_type` `agenda_evento`, `resource_id` evento id, `metadata` `{email}`). Called by `agenda_evento_criar` and by `agenda_evento_editar` for `todas`/`seguintes` when the key is present (for `seguintes`, against the tail series `v_alvo`).
- `agenda_cliente_enfileirar(p_conta uuid, p_cliente bigint, p_evento bigint, p_tipo text, p_ocorrencias jsonb, p_remarcacao jsonb DEFAULT NULL, p_convidado bigint DEFAULT NULL)`: the old 6-arg signature is DROPPED and replaced. Exactly one of `p_cliente`/`p_convidado` non-null. Merge key `(cliente_id | convidado_id, evento_id)`; "one live entry per occurrence" applies per recipient. The GUC `agenda.remarcacao` branch runs only when `p_convidado IS NULL`. It no longer bumps `sequencia` (it reads the stored value into the snapshot).
- `agenda_ocorrencias_bump_sequencia(p_ids bigint[]) RETURNS void` (internal): called once per write by the hooks for the changed occurrence ids, before any enqueue.
- Hooks in `agenda_evento_criar`/`editar`/`excluir`/`agenda_remarcacao_resolver` (via `editar`): capture `v_antes` when the series is shared OR has active guests; bump once; enqueue one item for the client (as today) and one per active guest (`p_convidado`, `convidado_email`) with the same snapshot/diff. Split (`seguintes`): copy active guests to `v_alvo` with the SAME token, `UPDATE agenda_respostas_convidado SET convidado_id = <copy>` for moved occurrences, enqueue the same `alteracao` the client gets (to the copy). `excluir todas`: read active guests before the series DELETE and enqueue `cancelamento` to each.
- `agenda_cliente_claim_emails(p_limit int DEFAULT 20) RETURNS jsonb`: LEFT JOINs `clientes` and `agenda_convidados`; discard gates per recipient kind before claiming (guest: `feature_agenda`, guest active unless `cancelamento`, e-mail not in `agenda_convidados_bloqueio` of the workspace, series not private when it still exists). Returns each item as today plus `"destinatario": "cliente"|"convidado"`, `"email"`, `"nome"`, `"convidado_id"`, `"convidado_token"` (NULL when removed or cliente), `"organizador_nome"`, `"organizador_email"` (NULL when the organizer is no longer a member). Existing keys `cliente_email`/`cliente_nome` stay for compatibility (NULL for guests).
- `agenda_convite_ler(p_token text) RETURNS jsonb` (service_role) → `{ "estado": "ok"|"nao_encontrado", "convidado_id", "conta_id", "workspace": { "nome", "brand_color", "logo_url" }, "organizador_nome", "titulo", "itens": [ConviteItem] }`. Resolves every active guest row with that token (one per series after splits; all must share `conta_id`), checks `feature_agenda` and non-private series. `itens`: non-cancelled occurrences of those series with `fim >= now() - 30 days`, `ORDER BY inicio, id`, `LIMIT 100`. `ConviteItem` = `Item` fields without `remarcacao`, with `resposta` = the guest's effective answer (valid only when `inicio_respondido = inicio`). `convidado_id` in the envelope is the id of the newest row (used for rate-limit keys only).
- `agenda_convite_ocorrencia(p_token text, p_ocorrencia bigint) RETURNS jsonb` → `ConviteItem` or NULL (for the `.ics` route).
- `agenda_convite_responder(p_token text, p_ocorrencia bigint, p_resposta text, p_inicio_visto timestamptz) RETURNS jsonb` → `ConviteItem`. Codes `agenda_convite:nao_encontrado|horario_mudou|ja_aconteceu|desligado`. Upserts the answer for the guest row of that occurrence's series; notifies `event_guest_rsvp` only when the effective answer changes (recipients `agenda_cliente_destinatarios(conta, organizador)`, metadata `{ convidado_nome, convidado_email, resposta, data_inicio_local }` plus `agenda_notificar`'s base metadata).
- `agenda_convite_descadastrar(p_convidado bigint) RETURNS void` (service_role): inserts `(conta_id, email)` of that guest row into `agenda_convidados_bloqueio` (`ON CONFLICT DO NOTHING`).
- `agenda_listar` return gains, appended last, `convidados jsonb`: `[{ "id", "email", "nome", "resposta": "sim"|"nao"|null }]` for active guests with the effective answer for that occurrence; NULL when masked; `[]` when none. DROP + CREATE with the same grants.
- Notification type `event_guest_rsvp` in the 3 CHECKs (copy the lists from `20261007000001`) and `claim_notification_emails`' array; link `/calendario?evento=<ocorrencia_id>`.

### HTTP (Lane Convite API produces; Lane Hub UI consumes)

`hub-agenda` (Lane Hub API): `GET ?token=T&de=ISO&ate=ISO` → `200 { "itens": [Item] }`; mutually exclusive with `ocorrencia` and with the cursor pair (both present → 400 "Dados inválidos."); `periodo_invalido` → 400 "Dados inválidos."; `estado != 'ok'` → 404 "Evento não encontrado.".

`agenda-convite` (new, `--no-verify-jwt`), base `${SUPABASE_URL}/functions/v1/agenda-convite`, errors `{ "error": "<pt>" }`:
- `GET ?token=T` → `200 { "workspace": { "nome", "brand_color", "logo_url" }, "organizador_nome", "titulo", "itens": [ConviteItem] }`.
- `GET /ocorrencia/<N>.ics?token=T` → `text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>.ics"`.
- `POST { "token", "acao": "responder", "ocorrencia_id", "resposta": "sim"|"nao", "inicio_visto" }` → `200 { "item": ConviteItem }`.
- Error map: unknown token / `nao_encontrado` / `desligado` → 404 "Este convite não está mais disponível."; `horario_mudou` → 409 "Este evento mudou de horário. Atualize a página."; `ja_aconteceu` → 409 "Este evento já aconteceu."; bad body → 400 "Dados inválidos."; rate limit → 429 "Muitas tentativas. Tente de novo em alguns minutos."; other → 500 "Erro interno".
- Token format check (`^[0-9a-f]{64}$`) before any DB call; a malformed or unknown token spends `convite-badtoken:<ip>`.

### CRM store (Lane CRM Guests produces)

- `AgendaOcorrencia` gains `convidados: { id: number; email: string; nome: string | null; resposta: 'sim' | 'nao' | null }[] | null`.
- `AgendaEventoPayload` gains `convidados?: { email: string; nome: string | null }[]`.
- `NotificationType` gains `'event_guest_rsvp'`.

### Hub (Lane Hub UI produces)

- `apps/hub/src/pages/agenda/AgendaCardView.tsx`: `AgendaCardView({ item, agora, highlighted?, rotulos?, onResponder(resposta, inicioVisto): Promise<void>, onRemarcar?: () => void, onCancelarRemarcacao?: (id) => Promise<void>, icsUrl: string, desabilitado?: boolean })`. `item` type `HubAgendaItem | ConviteItem` (`remarcacao` optional). `AgendaCard` keeps its current props and becomes the Hub wrapper.
- Types `ConviteItem`, `ConviteResponse` in `apps/hub/src/types.ts`.

---

### Task 1 (Lane DB): migration B, entitlement suite, rollback runbook

**Spec:** §3.1-3.5, §3.8 (SQL), Erros e casos limite, Rollout/Rollback.

**Files:**
- Create: `supabase/migrations/20261008000002_agenda_convidados.sql`, `supabase/tests/entitlements/99_agenda_convidados.sql`
- Modify: `supabase/tests/entitlements/99_agenda_edicao.sql` (type lists), `99_agenda_lembretes.sql` (type list at the runbook check), `docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql` (step 4c, placed before 4a; see amendment 4)

- [ ] **Step 1: Write `99_agenda_convidados.sql` first** (pattern of `99_agenda_hub.sql`: fixtures from `current_date`, `pg_temp` helpers, `et_grant_hosted_parity()`, Hub/convite RPCs under `set local role service_role`). Blocks, each `RAISE EXCEPTION` on failure:
  1. Validation: invalid e-mail; 21 guests; private event with guests; making a series private with active guests; member e-mail (case-insensitive) with the exact message; duplicate e-mails collapse to one row.
  2. Caps: 50 distinct new e-mails in 24 h pass, the 51st fails; re-adding the same e-mail to the same event after removal does not count; split copies do not count; platform cap (set a fixture of 1000 rows in another workspace with `criado_em = now()`) fails the next add.
  3. Enqueue: create with 2 guests → 2 `convite` guest items + (if shared) 1 client item, one `sequencia` bump per occurrence (assert `sequencia = 1`, not 3); edit `todas` title → one `alteracao` per recipient, `sequencia = 2`; remove a guest → `cancelamento` for that guest with the future snapshot, row `removido_em` set; `excluir todas` → `cancelamento` per active guest whose snapshot survives the DELETE; `agenda_remarcacao_resolver(id, true)` on a shared series with a guest → guest item `tipo = 'alteracao'`, `remarcacao IS NULL`, client item `remarcacao_aceita`.
  4. Split: guest answered `sim` on a future occurrence; `seguintes` edit from before it changing the title → tail series has a guest row with the SAME token, the answer row now points at the copy and still reads `sim` via `agenda_convite_ler`, exactly one guest `alteracao` item; `agenda_convite_ler(token)` lists head and tail occurrences.
  5. Claim: a guest item is RETURNED by `agenda_cliente_claim_emails` with `destinatario = 'convidado'`, `email`, `convidado_token`, `organizador_email`; a removed guest's `cancelamento` is returned with `convidado_token` NULL; a blocklisted e-mail's item becomes `descartado`; flag off → `descartado`; client items still come back with `cliente_email`.
  6. Convite RPCs: unknown token → `estado = 'nao_encontrado'`; removed guest → same; responder sim → item `resposta = 'sim'`, then edit `inicio` → `resposta` NULL; `inicio_visto` mismatch → `agenda_convite:horario_mudou`; ended → `agenda_convite:ja_aconteceu`; notification `event_guest_rsvp` inserted once for two identical answers; `agenda_convite_descadastrar` inserts the blocklist row.
  7. `agenda_listar.convidados`: visible with answers for the organizer; NULL for a masked private event of another member; `[]` with none.
  8. Concurrency: two `dblink`-free sessions cannot be simulated in one transaction, so assert the lock call exists: `pg_get_functiondef('agenda_definir_convidados'::regproc) LIKE '%pg_advisory_xact_lock%'`.
  9. Grants: `anon`/`authenticated` cannot execute `agenda_convite_*`, `agenda_definir_convidados`, `agenda_ocorrencias_bump_sequencia`, nor select the three new tables; `agenda_listar` still executable by `authenticated`, not `anon`.
- [ ] **Step 2: Run it on the local stack and confirm it fails** (objects missing): port overrides per memory "Local Supabase runs on colima" (back up and restore `supabase/config.toml`), `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres bash scripts/test-entitlements.sh`.
- [ ] **Step 3: Write migration B** in this order: tables + indexes + RLS/grants; queue DDL; notification CHECKs + `claim_notification_emails`; `agenda_ocorrencias_bump_sequencia`; `DROP FUNCTION agenda_cliente_enfileirar(uuid,bigint,bigint,text,jsonb,jsonb)` + new 7-arg version; `agenda_definir_convidados`; replaced `agenda_evento_criar`, `agenda_evento_editar`, `agenda_evento_excluir` (hooks as in Shared contracts; private-with-guests checks), `agenda_remarcacao_resolver` only if its body must change; replaced `agenda_cliente_claim_emails`; convite RPCs; `DROP`/`CREATE agenda_listar`; grants block + a final `DO $$` grant assertion (pattern of `20261007000001`).
- [ ] **Step 4: Run the new suite until green, then the full entitlement run** (all `99_agenda_*` must stay green; update `99_agenda_hub.sql` where it called the 6-arg `enfileirar` or asserted the old claim keys).
- [ ] **Step 5: Type lists and runbook.** `99_agenda_edicao.sql` loops gain `event_guest_rsvp` (e-mail eligible). Rollback step 4c per spec "Rollback" (order: frontend, delete guest queue items, redeploy previous functions, then SQL restoring the `20261007000001` definitions of every replaced function, deleting `event_guest_rsvp` rows, restoring CHECKs, dropping the new tables/columns and `agenda_hub_periodo`/`agenda_hub_visivel`); update the runbook's expected type counts and `event_*` regexes.
- [ ] **Step 6: Commit** `feat(agenda): external guests, guest answers and recipient-aware e-mail queue (DB)`.

### Task 2 (Lane Hub API): migration A, `hub-agenda` period route

**Spec:** §2.1-2.2.

**Files:**
- Create: `supabase/migrations/20261008000001_agenda_hub_periodo.sql`, `supabase/tests/entitlements/99_agenda_hub_periodo.sql`
- Modify: `supabase/functions/hub-agenda/handler.ts`, `supabase/functions/__tests__/hub-agenda_test.ts`

- [ ] **Step 1: Suite first** (`99_agenda_hub_periodo.sql`): an occurrence 40 days ago appears in a period covering it (unlike `agenda_hub_listar`); multi-day all-day event overlapping the window edge appears; another client's / private / cancelled / unshared occurrence absent; flag off → `estado = 'desligado'`; `encerrado` client → `cliente_inativo`; 46-day window and `ate <= de` → `agenda_hub:periodo_invalido`; 301 occurrences → 300 items; grants (service_role only); `agenda_hub_listar` unchanged on the existing fixture (`99_agenda_hub.sql` stays green).
- [ ] **Step 2: Write migration A** (helper `agenda_hub_visivel`, replace `agenda_hub_listar` verbatim using it, `agenda_hub_periodo`, grants + assertion). Run both suites green.
- [ ] **Step 3: Deno tests first** in `hub-agenda_test.ts`: `de`+`ate` calls `agenda_hub_periodo` with ISO values and returns `{ itens }`; only one of the two → 400; with `ocorrencia` or cursor → 400; non-ISO → 400; `periodo_invalido` → 400; `estado: 'desligado'` → 404; spends `hub-read` once. (Controller runs them.)
- [ ] **Step 4: Implement the route** in `handler.ts` (reuse `isIso`, the RPC error map, the existing `hub-read` spend).
- [ ] **Step 5: Commit** `feat(agenda): Hub period query for the calendar`.

### Task 3 (Lane Convite API): `agenda-convite`, guest e-mails, unsubscribe, digest copy

**Spec:** §3.5-3.8.

**Files:**
- Create: `supabase/functions/agenda-convite/{handler.ts,index.ts}`, `supabase/functions/__tests__/agenda-convite_test.ts`
- Modify: `supabase/functions/agenda-cliente-email/handler.ts`, `supabase/functions/_shared/agenda-cliente-email.ts`, `supabase/functions/_shared/client-event-email.ts` (unsub token payload), `supabase/functions/client-email-unsub/{handler.ts,index.ts}`, `supabase/functions/_shared/notification-email.ts` (`resolveDigestItem` case `event_guest_rsvp`), their `__tests__`, `supabase/config.toml` (`[functions.agenda-convite]` `verify_jwt = false`, next to `hub-agenda`)

- [ ] **Step 1: Tests first.**
  - `agenda-convite_test.ts` (pattern: `hub-agenda_test.ts`): OPTIONS → CORS headers from `buildCorsHeaders`; malformed token → 404 + `convite-badtoken` spent, no RPC; unknown token → 404 + badtoken spent; ok → body shape; `.ics` route → `text/calendar`, `SEQUENCE`, filename; responder ok / each error code mapping; 429 bodies carry CORS headers; read and write keys spent with `convidado_id`; `insertAuditLog` called on responder.
  - `agenda-cliente-email_test.ts`: guest item → `montarEmailAgendaCliente` gets `destinatario: 'convidado'`; button URL `${APP_BASE_URL}/convite/<token>?ocorrencia=<id>`; `appBaseUrl` throwing → e-mail sent without button, `.ics` still attached; `Reply-To` header = `organizador_email` when present, absent otherwise; unsub URL uses a `{g}` token; client items unchanged (existing tests stay green); `resolveHubUrl` never called for guests.
  - `_shared` template tests: guest greeting "Olá, <nome>!" / "Olá!", line "<Organizador> convidou você em nome de <Workspace>." only on `convite`, no Hub copy, cancellation has no button and no attachment.
  - unsub tests: `verifyUnsubToken` returns `{ tipo: 'cliente', id }` for `{c}` and `{ tipo: 'convidado', id }` for `{g}`, `null` on tamper; GET page for `{g}` renders; POST `{g}` calls `agenda_convite_descadastrar` and audits; one-click POST works for both.
  - `notification-email_test.ts`: `event_guest_rsvp` digest line uses `convidado_nome ?? convidado_email`.
- [ ] **Step 2: Implement.** `agenda-convite` mirrors `hub-agenda` structure (deps injected, `index.ts` only wires `createClient`, `checkRateLimit`, `getClientIP`, `buildCorsHeaders`, `insertAuditLog`, `gerarCalendario`). The e-mail handler branches on `item.destinatario`. `signUnsubToken` gains a kind parameter (`signUnsubToken({ c: id } | { g: id }, secret)`), keeping the existing call sites compiling (update them).
- [ ] **Step 3: Commit** `feat(agenda): guest invite page API, guest e-mails and unsubscribe`.

### Task 4 (Lane CRM Layers): layers, flag fold

**Spec:** §1 (all), Interface (camadas copy).

**Files:**
- Create under `apps/crm/src/pages/calendario/camadas/`: `tipos.ts`, `prazos.ts`, `recorrencias.ts`, `comemorativas.ts`, `camadasStorage.ts`, `useCamadas.ts`, `toCamadaEventInput.ts`, `CamadaPopover.tsx`, `CamadasGrupo.tsx`, `useConfirmarPagamento.ts`, and `__tests__/` for each pure module plus `CamadasGrupo` and `CamadaPopover`.
- Modify: `CalendarioPage.tsx` (fold, skeleton only while loading, use `prazos.ts` + `useConfirmarPagamento`), `agenda/AgendaTab.tsx` (wire layers), `agenda/AgendaView.tsx` (`eventClick`/`eventAllow`/drag dispatch on `extendedProps.camada`, `eventOrder`), `agenda/AgendaSidebar.tsx` (render `CamadasGrupo` between Pessoas and Legenda), `style.css` (layer item styles: white fill, 1px dashed border in the layer colour, icon), existing tests of those files.

Types (`tipos.ts`):
```ts
export type CamadaId = 'posts' | 'prazos' | 'recebimentos' | 'pagamentos' | 'datas' | 'comemorativas';
export type CamadaItem =
  | { camada: 'posts'; id: string; inicio: string; post: ScheduledPost; estado: PostPublishState }
  | { camada: 'prazos'; id: string; dia: string; prazo: DeadlineEvent }
  | { camada: 'recebimentos' | 'pagamentos'; id: string; dia: string; itens: { nome: string; valor: number; pago: boolean; referencia: string; alvo: { tipo: 'cliente' | 'membro'; id: number } ; ajustado: boolean }[] }
  | { camada: 'datas'; id: string; dia: string; tipo: 'aniversario' | 'data'; titulo: string; cliente: { id: number; nome: string } }
  | { camada: 'comemorativas'; id: string; dia: string; nome: string; tipo: NicheEvent['type']; tags: string[]; rotulo: 'dia' | 'mes' | 'semana'; ate?: string };
```

- [ ] **Step 1: Pure modules test-first.**
  - `comemorativas.test.ts`: Easter 2026-2030 (2026-04-05, 2027-03-28, 2028-04-16, 2029-04-01, 2030-04-21); Carnaval 2026 = 2026-02-17; Corpus Christi 2026 = 2026-06-04; "2º dom." in May 2026 = 2026-05-10; "Últ. sex." Nov 2026 = 2026-11-27; "Seg. pós-BF" 2026 = 2026-11-30; "01–07/08" → dia 2026-08-01 `ate` "07/08"; every entry of the 5 niches resolves without throwing and only `type` `week`/`month` entries resolve to `mes`.
  - `recorrencias.test.ts`: `data_pagamento = 31` in Feb 2026 → 2026-02-28 with `ajustado: true`; birthday "02-29" in 2026 → 2026-02-28; inactive client excluded; range spanning two months yields both.
  - `prazos.test.ts`: same results as the current `CalendarioPage` computation (port its cases, including `uteis`).
  - `camadasStorage.test.ts`: default `{posts, prazos, recebimentos, pagamentos, datas: true, comemorativas: false}`; corrupt/absent storage → default; `localStorage` throwing → default.
  - `toCamadaEventInput.test.ts`: posts timed with 30 min visual end; others `allDay`; `editable: false`; `extendedProps.camada`; class names `agenda-camada agenda-camada--<id>`; overdue prazo class.
- [ ] **Step 2: Implement the pure modules.**
- [ ] **Step 3: `useCamadas(periodo, ativas, canSeeFinancials)`** returns `CamadaItem[]`; each query `enabled` only when its layer is on (financial ones also need `canSeeFinancials === true`); query keys reuse the existing ones (`['scheduled-posts', start, end]`, `['allClienteDatas']`, etc.). Test with mocked store functions: financial queries never run when `canSeeFinancials` is `'unknown'`/`false`.
- [ ] **Step 4: UI.** `CamadasGrupo` (checkbox per layer with dashed swatch; financial ones hidden without access; niche `Select` reusing `readStoredNicheKey`/`writeStoredNicheKey`). `CamadaPopover` per layer with the exact copy of spec §1.7; "Abrir post" → `/entregas?drawer=<workflowId>&post=<id>` or `/entregas?post=<id>`; "Abrir entrega" → `/entregas?drawer=<workflowId>`; "Abrir cliente" → `/clientes/<id>`; payments "Confirmar" through `useConfirmarPagamento` (extracted from `CalendarioPage` lines ~153-184, same `AlertDialog` copy and `referencia_agendamento`). Tests: popovers render and navigate; confirm calls `addTransacao` with the same payload as today.
- [ ] **Step 5: Fold.** `CalendarioPage`: `isLoading` → skeleton; `agendaAtiva === true` → `AgendaTab` without the tab bar (title "Agenda | Mesaas"); else today's page unchanged. Tests: flag on → no tablist; flag off → the two tabs exactly as before (existing tests green); limits error → flag-off page.
- [ ] **Step 6: Commit** `feat(agenda): layers on the Agenda and tab fold behind the flag`.

### Task 5 (Lane CRM Guests): form field, popover, store, notification type

**Spec:** §3.9, §3.8 (CRM side).

**Files:**
- Create: `apps/crm/src/pages/calendario/agenda/ConvidadosInput.tsx` + test.
- Modify: `apps/crm/src/store/agenda.ts`, `agenda/eventoFormSchema.ts`, `agenda/EventoFormDialog.tsx`, `agenda/EventoPopover.tsx`, `apps/crm/src/store/notifications.ts`, `apps/crm/src/lib/notification-catalog.ts`, `apps/crm/src/lib/notification-config.ts`, and tests (`notification-catalog.test.ts` counts and phrases, `notification-config.test.ts`, `notification-prefs-store.test.ts` e-mail type count, form and popover tests).

- [ ] **Step 1: Tests first.** `ConvidadosInput`: Enter/comma/space/blur commit a chip; invalid shows "Informe um e-mail válido." and does not commit; duplicate ignored; counter "N de 20" and no input at 20; Backspace on empty removes last chip; chip remove buttons have `aria-label` "Remover <email>". Form: field hidden when Privado is on; payload carries `convidados` only when changed (edit) and always on create when non-empty; help copy exact (spec §3.9). Popover: "Convidados" section with selo per answer (Confirmou / Recusou / Aguardando); hidden when `convidados` null or empty. Notification config: `event_guest_rsvp` title `"<nome ou e-mail> confirmou|recusou <titulo>"`, body = event date (same helper as `event_client_rsvp`).
- [ ] **Step 2: Implement** (schema: `convidados: z.array(z.object({ email: z.string().email(), nome: z.string().nullable() })).max(20)`; `MAX_CONVIDADOS = 20`; `mesmosConvidados` change detection mirroring `mesmasPessoas`). Map server `agenda:` messages through `formatAgendaError` (no new mapping needed).
- [ ] **Step 3: Commit** `feat(agenda): external guests in the event form and popover`.

### Task 6 (Lane Hub UI): card split, home calendar events, invite page

**Spec:** §2.3-2.5, §3.7 (UI), Interface.

**Files:**
- Create: `apps/hub/src/pages/agenda/AgendaCardView.tsx`, `apps/hub/src/pages/ConvitePage.tsx`, `apps/hub/src/pages/convite/*` as needed, `packages/i18n/locales/{pt,en}/hubConvite.json`, tests.
- Modify: `apps/hub/src/pages/agenda/AgendaCard.tsx`, `apps/hub/src/components/PostCalendar.tsx`, `apps/hub/src/pages/HomePage.tsx`, `apps/hub/src/api.ts`, `apps/hub/src/queries.ts`, `apps/hub/src/types.ts`, `apps/hub/src/router.tsx`, `apps/hub/src/main.tsx` (namespace), `packages/i18n/locales/{pt,en}/hubHome.json`, `vercel.json` (rewrite `/convite/:token` → `/hub/index.html`, header entry `X-Robots-Tag: noindex` for `/convite/:token`), existing tests (`AgendaPage.test.tsx`, `homeCalendarRange.test.tsx`, PostCalendar tests).

- [ ] **Step 1 (first, alone): split `AgendaCard`.** Move markup into `AgendaCardView` (contract above); `AgendaCard` wraps it with the current mutations. All existing `AgendaPage.test.tsx` tests must pass unchanged. Commit `refactor(hub): presentational AgendaCardView`.
- [ ] **Step 2: Home calendar, tests first.** `fetchAgendaPeriodo(token, de, ate)` + `hubAgendaPeriodoQuery` (key `['hub-agenda', token, 'periodo', de]`, `staleTime` 30 s, `placeholderData` previous); `PostCalendar` props `eventos?`, `eventosErro?`, `onRetryEventos?`, `onEventoClick?`. Tests: all-day 3-day event appears on 3 days by `data_inicio_local`/`data_fim_local` (exclusive); timed event placed by its local day in `tz`; desktop pill "N eventos" precedes post pills; mobile dots: event first, max 3; side panel "Eventos" above "Posts"; click opens the dialog with `AgendaCardView` and confirm calls `responderAgenda` then invalidates `['hub-agenda', token]`; query runs for every month shown (including future months past `historyCutoff`); error shows "Não foi possível carregar os eventos." + "Tentar novamente" while posts still render; `feature_agenda` false → no request; initial `today`/`selectedDay` use local date (fake timers at 2026-10-07T23:30:00-03:00 → day 7, not 8).
- [ ] **Step 3: Invite page, tests first.** `ConvitePage` at route `/convite/:token` outside `HubShell`; applies `resolveHubTheme(workspace.brand_color, isDark)` itself; header (logo or initial, workspace name, "Convite de <organizador>"), title, list by day with `AgendaCardView` (no remarcar), `?ocorrencia=` scroll + highlight, 404 state "Este convite não está mais disponível.", 409 copy surfaced as toast/inline error, footer "Enviado pela Mesaas em nome de <workspace>.". Client: `fetchConvite(token)`, `responderConvite(...)`, `conviteIcsUrl(token, id)`; query key `['convite', token]`. Tests for each state and both answers; Google link built like the Hub's.
- [ ] **Step 4: Wire** router, `main.tsx` namespace, i18n pt/en, `vercel.json`.
- [ ] **Step 5: Commit** `feat(hub): events in the home calendar and the guest invite page`.

### Task 7 (Controller): integrate, verify, ship

- [ ] Merge lanes in order DB → Hub API → Convite API → CRM Layers → CRM Guests → Hub UI; resolve `supabase/config.toml`. Update `CLAUDE.md` (deploy gotcha: `agenda-convite` needs `--no-verify-jwt`) and `README.md` function count 88 → 89.
- [ ] Gates: lint, format:check, four `tsc`, `npm run test`, `npm run coverage:check`, `npm run check:functions`, `npm run test:functions` (then `git checkout deno.lock && npm ci`), all entitlement suites on the local stack.
- [ ] Browser verification on the local stack: layers on/off, popovers and navigation, payment confirm, flag off page identical; Hub home calendar desktop + 375 px with events, open card, confirm; invite page desktop + 375 px, answer, 404; e-mail HTML for a guest (captured `montarEmailAgendaCliente`).
- [ ] Final whole-branch review (Fable), open PR, check Codex review.
- [ ] Rollout (authorized only after the user's OK): `db push --linked` (both migrations) → verify objects/grants → deploy `agenda-convite`, `hub-agenda`, `agenda-cliente-email`, `client-email-unsub`, `notification-email-cron` (`--no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw`) → smoke (`agenda-convite` malformed token 404, OPTIONS has CORS; `hub-agenda` period bad token 404) → merge → pilot.

---

## Fable plan review: amendments (binding; they override the task text above)

Line refs: `M3` = `supabase/migrations/20261007000001_agenda_hub.sql`.

### Critical

1. **Grant assertion in B names a dropped signature.** The pattern block (`M3:2185-2204`) and the REVOKE/GRANT pair (`M3:784-785`) list `agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb)`; after B's DROP, `has_function_privilege` on that signature raises and the migration fails. B lists the 7-arg signature everywhere. `agenda_remarcacao_resolver` keeps its two direct 6-arg calls (`M3:1904-1906` `remarcacao_recusada`, `M3:1934-1935` no-change `alteracao`): they bind to the new function via `DEFAULT NULL`, and neither needs a bump (no calendar change). The resolver is not replaced (grants already `authenticated, service_role`, `M3:2163-2164`).

2. **`signUnsubToken`/`verifyUnsubToken` signature change breaks files no lane owns.** Callers: `client-event-email-cron/handler.ts:565`, `__tests__/client-event-email-cron_test.ts:340`, `__tests__/client-event-email_test.ts:318-346` (five tests asserting `42`), `ClientEmailUnsubDeps.verifyToken: (token, secret) => Promise<number | null>` (`client-email-unsub/handler.ts:49`) and `makeVerifyToken` (`client-email-unsub_test.ts:73`). Keep both exports unchanged; add `signUnsubTokenFor({ c: id } | { g: id }, secret)` and `verifyUnsubTokenKind(): Promise<{ tipo: 'cliente' | 'convidado'; id: number } | null>` (the old pair become wrappers). Only `agenda-cliente-email` and `client-email-unsub` switch.

3. **`et_grant_hosted_parity` grants ALL on every non-excluded table** (`tests/entitlements/_helpers.sql:32-43`). Suite block 9 ("anon/authenticated cannot select the three new tables") fails unless `99_agenda_convidados.sql` excludes `agenda_convidados`, `agenda_respostas_convidado`, `agenda_convidados_bloqueio` (pattern `99_agenda_hub.sql:20-21`). The member-e-mail block needs `insert into auth.users (id, email)`: the fixture inserts `id` only (`99_agenda_hub.sql:158`).

4. **The rollback runbook runs in CI.** `99_agenda_lembretes.sql:466` `\i`s `assets/2026-10-05-agenda-rollback.sql` inside its transaction. So: (a) step 4c uses `DROP ... IF EXISTS` for A's objects (`agenda_hub_periodo`, `agenda_hub_visivel`) and `DELETE`s guarded by `to_regclass`, because Lane DB's worktree has no migration A and Lane Hub API's has no B; (b) 4c runs BEFORE 4a (newest sub-project first): 4b.2 pastes the pre-M3 bodies and 4b.3 drops the 6-arg `enfileirar` and `agenda_hub_listar` (`:1053-1070`), so a 4c placed after 4b would re-create M3 objects 4b just removed, and 4b's `DROP IF EXISTS` of the 6-arg would leave the 7-arg alive. 4c drops the 7-arg, re-creates the M3 6-arg `enfileirar` and M3 `agenda_hub_listar`, then drops `agenda_hub_visivel`/`agenda_hub_periodo`; (c) counts `:62-66` 7/7/6 → 8/8/7, `:88` 5 → 6, every regex (`:75,:79,:80,:87,:91,:92`) and the DELETE lists (`:45-52`) gain `guest_rsvp`; (d) `99_agenda_lembretes.sql:479-480` list gains `event_guest_rsvp`. Both files belong to Lane DB's Modify list.

5. **Two lanes start a local stack at once.** Lane DB and Lane Hub API both run `supabase start`; defaults collide (memory "Local Supabase runs on colima"). Lane DB: api/db/studio 54421/54422/54423; Lane Hub API: 54521/54522/54523. Override in the lane's own `supabase/config.toml`, never committed; `SUPABASE_DB_URL` must match.

### Important

6. **The item helper is cliente-bound.** `agenda_hub_item(p_conta, p_cliente, p_ocorrencia)` (`M3:1618-1651`) reads `resposta` from `agenda_respostas_cliente` with `rc.cliente_id = e.cliente_id`, filters `remarcacao` by `p_cliente` and carries the visibility WHERE. `agenda_hub_periodo` reuses it as `agenda_hub_listar` does (`M3:1689-1690`). The convite RPCs must NOT call it: Lane DB writes `agenda_convite_item(p_convidado bigint, p_ocorrencia bigint) RETURNS jsonb` copying the field expressions at `M3:1620-1640` (no `remarcacao`), `resposta` from `agenda_respostas_convidado` valid only when `inicio_respondido = o.inicio`. B never references `agenda_hub_visivel` (A's object).

7. **Bump mechanics, exact.** `enfileirar` bumps at `M3:660-672` (`UPDATE ... sequencia + 1` and the rewrite of `sequencia` into entries): delete both, so every tipo takes the `v_novas := p_ocorrencias` path. Hook order per write: mutate → build every recipient's list first (client diff, guest diff, any `convite` full snapshot, `cancelamento` set) → `agenda_ocorrencias_bump_sequencia(p_ids)` ONCE on the UNION of their ids, `RETURNING id, sequencia` → patch each list with `coalesce(returned, old + 1)` (a `cancelada` entry has no row; today's rule, `M3:667`) → enqueue. Never recompute a diff after the bump, and never bump per recipient: a newly-shared `convite` (`M3:1275-1276`) and a guest `alteracao` in one edit overlap. `criar` bumps once (suite expects `sequencia = 1`); nothing bumps in the resolver's direct calls.

8. **Reply-To is positional.** `sendViaResend(to, subject, html, key, from, replyTo?, headers?, attachments?)` (`_shared/lifecycle-emails.ts:304-316`); `agenda-cliente-email_test.ts:355` already asserts `replyTo === undefined` positionally. Never put it in `headers`.

9. **Template and item types.** `AgendaClienteEmailItem.cliente_id: number` (`_shared/agenda-cliente-email.ts:60`) becomes `number | null`; the button is hardcoded `${hubBase}/agenda?ocorrencia=` (`:458-461`), so `AgendaClienteEmailCtx` gains `botaoUrl: string | null` (handler builds Hub or convite URL; `null` = no button). Inject `appBaseUrl: () => string` into `AgendaClienteEmailDeps` (index.ts wires `_shared/app-url.ts:12`) so the throw path is testable. Claim: `organizador_id` via LEFT JOIN `agenda_eventos` (gone after `excluir todas`), `organizador_email` = `lower(auth.users.email)` only while in `workspace_members`; template tolerates `organizador_nome` NULL.

10. **`resolveHubTheme(config: HubThemeConfig, dark)`** (`packages/hub-theme/theme.ts:9-17, :261`), not `(brand_color, isDark)`. `ConvitePage` builds `{ ...DEFAULT_HUB_THEME, accent: workspace.brand_color }` (`HubShell.tsx:148`), takes `dark` from `useTheme()` (`hooks/useTheme.ts:24`), injects `<style>{`:root { ${vars} }`}</style>` (`HubShell.tsx:153-161`) inside a `.hub-root`. `AgendaCard`, `RemarcarDialog` and `HubDialog` do not call `useHub()` (verified); `AgendaCardView` must stay context-free.

11. **Hub test facts.** `homeCalendarRange.test.tsx:8-12` mocks `../../api` with only `fetchPosts/fetchPostsInRange/fetchAgenda`: add `fetchAgendaPeriodo` or HomePage queries get `undefined`. It mocks `PostCalendar` entirely (`:15`), so event rendering tests go in `components/__tests__/PostCalendar.test.tsx`. `request()` throws `Error(body.error)` without status (`api.ts:62-73`): `ConvitePage` distinguishes the 404 from the two 409s by the exact message strings (contract above); say so in the tests.

12. **`AgendaOcorrencia.convidados` non-optional breaks tsc on fixtures** in `agenda/__tests__/EventoFormDialog.test.tsx`, `eventoFormSchema.test.ts`, `EventoPopover.test.tsx` (the `sequencia:` fixtures); `eventoFormSchema.test.ts` is missing from Lane CRM Guests' list. Controller re-runs CRM tsc after merging Lane CRM Layers (its new fixtures).

13. **Rendering branch.** `ConteudoDoEvento` (`AgendaView.tsx:83-85`) reads `extendedProps.ocorrencia`; camada events need their own branch (icon + title) or they render empty. `eventOrder` is `"rascunho,start,-duration,allDay,title"` (`:244`): add numeric `extendedProps.ordem` (agenda 0, posts 1, prazos 2, financeiro 3, datas 4, comemorativas 5) and prepend it.

14. **Count surfaces, exact:** `__tests__/notification-catalog.test.ts:14` 15 → 16, `:40-50` expected map gains `event_guest_rsvp`, `:60` recipients ternary, `:66` "seis" → "sete"; `__tests__/notification-prefs-store.test.ts:12` 15 → 16; `99_agenda_edicao.sql:285-286, :292-293, :298`. `notification-config.ts:322-331` (`event_client_rsvp`) is the template; the body helper is `formatEventWhen(m)`.

15. **Rate-limit keys need `convidado_id` before any read or write.** Add to B `agenda_convite_resolver(p_token text) RETURNS jsonb` → `{ "convidado_id", "conta_id" }` or NULL (service_role, index lookup only). Handler: format check → resolver → NULL spends `convite-badtoken:<ip>` → else spends the read/write key → then `ler`/`ocorrencia`/`responder`. Lane Convite API fakes it like the other RPCs.

16. **`agenda_hub_periodo` and the inactive cliente (spec §2.1 override).** `agenda_hub_listar` has no `cliente_inativo`: it RAISEs `agenda_hub:nao_encontrado` (`M3:1668-1670`). Mirror that (`estado` ∈ `ok|desligado`, raise for non-`ativo`) so the handler's existing error map applies unchanged; the suite asserts the exception. `isIso` (`hub-agenda/handler.ts:74,93`) accepts full datetimes only; `localMonthRange` (`hub/src/lib/postView.ts:286-290`) returns `toISOString()`, compatible. The 46-day suite case uses `now()`/`now() + 46 days` timestamptz.

17. **Cap counting rule, so lanes agree.** Workspace: `count(DISTINCT email) FROM agenda_convidados WHERE conta_id = X AND criado_em > now() - interval '24 hours'` plus the new e-mails not already in that set must be ≤ 50; platform: the same over all rows (distinct `(conta_id, email)`) ≤ 1000. Split copies keep the source row's `criado_em`/`adicionado_por`; re-adds are the same e-mail. Both therefore never count.

### Minor

18. `DeadlineEvent` is a local, unexported interface (`CalendarioPage.tsx:54-58`): `prazos.ts` owns and exports it; `formatDeadlineStatus` is `calendario/deadlineStatus.ts:9`. `PUBLISH_STATE_LABELS`/`PUBLISH_STATE_CLASS` are `entregas/postLabels.ts:124,129`. Existing keys: `['scheduled-posts', startISO, endISO]` (`dashboard/useTodayAgenda.ts:115`), `['clientes']`, `['membros']`, `['transacoes']`, `['workflows']`, `['allClienteDatas']` (`CalendarioPage.tsx:765-783`); the confirm flow is `:162-187` plus the `AlertDialog` JSX.
19. `CalendarioPage.test.tsx:59-60` mocks `useWorkspaceLimits: () => ({ features })`: add `isLoading` for the skeleton test (`useWorkspaceLimits.ts:97` exposes it). Task 4 Step 5 also tests spec §1.9's "`?evento=`/`?data=` keep working flag-on" (today `:731-733`).
20. Lane Hub UI also edits `apps/crm/src/content/__tests__/vercel-routing.test.ts`: add rewrite + noindex tests for `/convite/:token` mirroring the print pair (`:53-62`). Do NOT add `convite` to `APP_ROUTE_PREFIXES` (`content/site-meta.ts:18`): it is a Hub route and the guard test would demand it in the app-shell source.
21. `99_agenda_hub.sql` has no `enfileirar` call and asserts only surviving claim keys (`:712-713`): drop it from Lane DB's Modify list.
22. Guest selo in the popover: reuse `CLIENTE_RESPOSTA_LABEL` (`EventoPopover.tsx:181-183`).
23. `agenda_validar_payload` only checks required keys (`M3:260-261`); unknown keys pass, so B does not replace it and 4c does not restore it.
24. `agenda-convite/index.ts`: `getClientIP` and `gerarCalendario` are imported by the handler (`hub-agenda/handler.ts:15-16`), not injected; inject only `createDb`, `rateLimit`, `auditLog`, `buildCorsHeaders`, `now` (`hub-agenda/index.ts`).
25. Task 4 Step 1 date math is verified correct (Easter 2026-2030, Carnaval 02-17, Corpus Christi 06-04, 2º dom. 05-10, Últ. sex. 11-27, Seg. pós-BF 11-30, Feb 2026 = 28 days, `2026-10-07T23:30-03:00` = day 7 local). Nobody "fixes" them.
26. README says 88 functions (`README.md:27`); the directory count is 88, so 89 is right.
