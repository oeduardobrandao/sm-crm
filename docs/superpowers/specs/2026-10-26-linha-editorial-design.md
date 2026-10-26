# Linha editorial: design

Status: draft for review · 2026-10-26
Mockups (approved direction, Option B): https://claude.ai/artifact/LYRyx2HdmXXmAmuP45xnU6

## 1. Why

Agencies plan a month of content before producing it: which posts go out, on which days, in
which format, and with what direction. Today that plan lives outside Mesaas, in spreadsheets
or documents, and the client approves it over WhatsApp. Mesaas only enters the picture when
the real posts exist and go to the Hub for approval one by one.

The linha editorial brings that step into the product:

1. The agency builds a monthly plan per client as a table. Each row is a planned post with a
   date, a format, a title, a content direction, and any extra columns the agency defines.
2. The agency sends the plan to the client's Hub. The client comments per row and approves
   the plan as a whole, or asks for changes.
3. Once it is approved, the agency selects rows in bulk and turns them into production work.
   That can be one fluxo per group (6 reels become a "Reels de novembro" fluxo) or one
   individual post per row. Each post arrives pre-filled from its row.

Success looks like this: an agency plans November in Mesaas, gets it approved in the Hub
without leaving the product, and creates all of November's posts in two or three clicks,
without retyping titles, dates or directions.

## 2. Goals, non-goals, anti-goals

**Goals**

- One linha per client per month, edited as a spreadsheet-like table inside Entregas.
- Agency-defined extra columns, shared across the workspace.
- Send to the Hub, with per-row client comments and a whole-linha decision: "Aprovar linha
  editorial" or "Pedir ajustes".
- The agency is notified (in-app plus the e-mail digest) when the client decides.
- Bulk conversion of selected rows into a new fluxo, through the existing NewWorkflowWizard,
  or into individual posts (avulsos), optionally with a post process per format.
- Each converted row stays linked to its post: the linha shows the post's status and fluxo,
  and the post shows where it came from.

**Non-goals (v1)**

- Live multi-user co-editing. Last write wins per cell, and TanStack Query refetches.
- Client edits to the plan. The client only comments and decides.
- "Copiar do mês anterior", templates of linhas, AI drafting, and MCP tools. These are good
  follow-ups (the MCP content agent drafting linhas especially), but out of scope here.
- Converting rows into an existing fluxo.
- Editing the table on the phone. The phone gets a read view; see §6.6.
- Per-row approval states on the client side. The decision is per linha.

**Anti-goals (would make this a failure even if it works)**

- A second, parallel post system. A planned row is not a post. It becomes one only on
  conversion, and from then on the post is the source of truth.
- Silent divergence. After conversion, the linha must not pretend to still own the row's
  title or date.
- Hub noise. The client must not get one notification or e-mail per row.
- Leaking unapproved plans to the wrong client. Every Hub read is scoped by token
  (`cliente_id` + `conta_id`), like `hub-posts`.

## 3. Decisions taken

These came from the conversation and the mockup review.

- **Placement: Option B.** A new Entregas view tab, "Linha editorial", next to Kanban,
  Calendário and Lista. No new route.
- **A planned row is its own entity** (`linha_editorial_itens`), not a `workflow_posts` row
  with a "Planejado" status. Mockup assumption, not contested.
- **Approval is per linha.** The client comments per row and decides once for the whole plan.
  Mockup assumption, not contested.
- **"Criar fluxo" reuses NewWorkflowWizard** with the posts pre-filled, instead of a new
  dialog.
- Extra columns are chosen by each agency.

Calls marked **(my call)** below were made while writing this spec. They are listed in §11
for review.

## 4. Data model

All new tables are scoped by `conta_id` with RLS `conta_id IN (SELECT public.get_my_conta_id())`.
Each one has the `REVOKE ALL … FROM PUBLIC, anon; GRANT … TO authenticated; GRANT ALL … TO
service_role` block used in `20261029000001_transacoes_recorrentes.sql`, plus a BEFORE INSERT
`enforce_plan_feature('feature_linha_editorial', 'direct', 'conta_id')` trigger. The
`enforce_plan_feature` trigger goes on `linhas_editoriais` and `linha_editorial_colunas`.
Items inherit the gate through their parent.

Access follows the rule `workflow_posts` uses today, and the builder confirms it against the
latest `workflow_posts` policy migration. If posts check a module permission, linhas use the
same one; if they only check `conta_id`, so do linhas.

Use composite same-tenant FKs `(id, conta_id)`, as `post_processes` does
(`20260918000002_post_processes_schema.sql`), so a row can never point at another workspace's
parent.

### 4.1 `linhas_editoriais`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `conta_id` | uuid not null → workspaces | |
| `cliente_id` | bigint not null → clientes | same tenant |
| `periodo` | date not null | first day of the month (`CHECK (extract(day from periodo) = 1)`) |
| `status` | text not null default `'rascunho'` | `rascunho` · `enviada` · `ajustes` · `aprovada` |
| `enviada_at`, `enviada_por` | timestamptz, uuid (auth user) | last send |
| `decidida_at` | timestamptz | last client decision |
| `rodada` | int not null default 0 | incremented on each send; comments carry it |
| `created_by`, `created_at`, `updated_at` | | |

`UNIQUE (conta_id, cliente_id, periodo)`: one linha per client per month.

The title is derived for display ("Linha editorial de novembro") and is not stored **(my
call)**.

### 4.2 `linha_editorial_colunas` (workspace-level extra columns)

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `conta_id` | uuid not null | |
| `nome` | text not null | unique per conta, case-insensitive |
| `tipo` | text not null | subset of `PropertyType`: `text`, `number`, `select`, `multiselect`, `date`, `person`, `checkbox`, `url` |
| `config` | jsonb not null default `'{}'` | select options `{options: SelectOption[]}`, same shape as `template_property_definitions.config` |
| `visivel_cliente` | boolean not null default true | shown in the Hub (mirrors `portal_visible`) |
| `oculta` | boolean not null default false | hidden from the CRM table, values kept |
| `ordem` | int not null | |
| `created_at` | | |

Fixed columns are not rows here. They are always present on every item: **Data, Formato,
Título, Direção do conteúdo**. "Direção do conteúdo" can be hidden from the table through a
per-workspace preference **(my call)**. It is still always shown to the client and always
carried into the post. The mockup's "Colunas" menu shows it with a toggle; the other three
show "fixa".

Seed on the workspace's first linha **(my call)**, via the create RPC (§5.1), when the conta
has no columns yet:

- `Pilar` (`select`: Educação, Autoridade, Bastidores, Conexão)
- `CTA` (`select`: Salvar, Comentar, Compartilhar, Seguir)
- `Referência` (`url`)

The agency renames or deletes them freely. Deleting a column also deletes its values: the
JSON keys are cleaned by the delete RPC.

### 4.3 `linha_editorial_itens` (the rows)

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `conta_id` | uuid not null | |
| `linha_id` | uuid not null → linhas_editoriais on delete cascade | same tenant |
| `data` | date null | null means "sem data" |
| `tipo` | text not null | `ContentFormat` (`feed`, `carrossel`, `reels`, `stories`) |
| `titulo` | text not null default `''` | |
| `direcao` | text not null default `''` | plain text, multi-line |
| `valores` | jsonb not null default `'{}'` | `{ [coluna_id]: value }`, same value shapes as `post_property_values.value` |
| `ordem` | int not null | manual order inside the linha |
| `post_id` | → workflow_posts on delete set null | set on conversion (match the `workflow_posts.id` type) |
| `convertido_at`, `convertido_por` | | |
| `created_at`, `updated_at` | | |

A BEFORE INSERT/UPDATE trigger enforces:

- `data` is null or falls inside the parent's month.
- `conta_id` equals the parent's.
- Once `post_id` is set, `data`, `tipo`, `titulo`, `direcao` and `valores` are frozen. The
  post is the source of truth (anti-goal "silent divergence"). Only `ordem` can change, and
  `post_id` can be cleared by the FK.

When the post is deleted, `post_id` goes back to null and the row becomes convertible again.
The row keeps its last values.

Index `(linha_id, ordem)` and a partial index on `post_id`.

### 4.4 `linha_editorial_respostas` (client and team messages, decisions)

This mirrors `post_approvals`.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `conta_id`, `linha_id` | | |
| `item_id` | uuid null → itens on delete set null | null means a comment on the whole linha |
| `acao` | text not null | `comentario` · `aprovado` · `ajustes` |
| `comentario` | text null | |
| `rodada` | int not null | the linha's `rodada` when written |
| `is_workspace_user` | boolean not null | false for the client |
| `author_user_id` | uuid null | team replies |
| `token` | text null | hub token for client rows (as `post_approvals.token`) |
| `created_at` | | |

Client rows are written only by the edge function, through service-role RPCs. Team users may
insert `comentario` rows (replies) through RLS. INSERT is limited to `is_workspace_user = true`
and `author_user_id = auth.uid()`.

## 5. State machine and RPCs

```
rascunho --enviar--> enviada --cliente aprova--> aprovada
                       |  \--cliente pede ajustes--> ajustes --enviar--> enviada
                       \--(team) recolher--> rascunho
aprovada --enviar de novo--> enviada            (re-approval after big changes)
```

- **Editing:** the agency can edit rows in every status **(my call)**. While the linha is
  `enviada`, the client sees edits on the next load. The CRM shows the banner "O cliente vê as
  alterações ao abrir o Hub". Editing an `aprovada` linha does not reopen it. "Enviar de novo"
  is how the agency asks for a fresh approval.
- **Conversion** is allowed in any status. When the linha is not `aprovada`, the selection
  bar's actions first show a confirm: "Esta linha ainda não foi aprovada pelo cliente. Criar
  mesmo assim?" **(my call)**. This keeps the client in the loop without blocking agencies
  that start production early.

### 5.1 CRM RPCs (SECURITY DEFINER, `authenticated`, internal `get_my_conta_id()` check)

- `linha_editorial_criar(p_cliente_id, p_periodo) → uuid`: creates the linha (idempotent per
  unique key, returns the existing id) and seeds the default columns when the conta has none.
- `linha_editorial_enviar(p_linha_id)`: allowed from `rascunho`, `ajustes` and `aprovada`.
  Sets `enviada`, `enviada_at` and `enviada_por`, and runs `rodada = rodada + 1`. Refuses a
  linha with zero rows.
- `linha_editorial_recolher(p_linha_id)`: `enviada` → `rascunho` (the team pulls it back).
- `linha_editorial_coluna_excluir(p_coluna_id)`: deletes the column and strips its key from
  every item's `valores` in that conta.
- `linha_editorial_converter(p_linha_id, p_workflow_id, p_posts jsonb) → jsonb`: see §7. It is
  atomic: it locks the items (`FOR UPDATE`) and fails with `ja_convertido` if any already has
  `post_id`.

Plain cell edits (rows, column definitions, reorder) go through PostgREST with RLS. That
keeps cell editing fast and matches how posts are edited. `status`, `rodada` and the
send/decision timestamps are not writable through PostgREST: a column-level grant or a
trigger blocks them, so only the RPCs move the state machine.

### 5.2 Hub RPCs (service_role only, called by the edge function)

- `record_linha_decision(p_linha_id, p_conta_id, p_cliente_id, p_token, p_acao, p_comentario)`
  locks the linha and requires `status = 'enviada'`. It inserts a `respostas` row with the
  current `rodada`, sets `aprovada` or `ajustes` plus `decidida_at`, and calls
  `create_linha_notification`.
- `record_linha_comment(p_linha_id, p_item_id, p_conta_id, p_cliente_id, p_token, p_comentario)`
  requires `enviada`. The item must belong to the linha. Comments create no notification;
  the decision carries the count (anti-goal "Hub noise").
- `create_linha_notification(p_linha_id, p_acao)` uses the type `linha_editorial_aprovada` or
  `linha_editorial_ajustes`.
  - **Targets:** owner and admin via `resolve_notification_targets`, plus `enviada_por` when
    that user is still a member. Deduplicated.
  - **Link:** `/entregas?view=linha&cliente=<id>&mes=YYYY-MM`.
  - **Metadata:** `cliente_nome`, `periodo`, `comentarios` (count in this rodada).
  - **Insert:** through `insert_notification_batch`.

Grant all three to `service_role` only, per `20260925000001_lockdown_definer_function_grants.sql`.

## 6. CRM: the "Linha editorial" view (Option B)

### 6.1 Plumbing

- `viewQuery.ts`:
  - Add `'linha'` to `ActiveView` and `VIEWS`.
  - Add the view-gated params `cliente` (id) and `mes` (`YYYY-MM`), parsed with the
    `parseInt` + `isNaN` guard and dropped for other views.
  - Saved views need no schema change.
- `VIEW_TABS` in `EntregasPage.tsx`:
  - Add `{ id: 'linha', label: 'Linha editorial', icon: <Table2 /> }` (lucide), after Lista.
  - Show it only when `feature_linha_editorial` is on (same pattern as `postProcessesEnabled`).
  - Update `VIEW_ICONS` (`VistasTabs.tsx`, exhaustive record), `PHONE_VIEWS`
    (`EntregasPhoneHeader.tsx`), the loading-skeleton map and the render branch.
  - Mode, entity and filter toggles are hidden in this view. Only the vista row and the
    search remain.
  - A saved vista or shared link with `view=linha` falls back to Kanban when the flag is off.
- New folder `apps/crm/src/pages/entregas/linha/`. The page is already large, so keep the view
  out of `EntregasPage.tsx` beyond the branch.
- Store: a new `apps/crm/src/store/linhaEditorial.ts` with plain async functions (repo
  convention), wrapped by TanStack Query hooks in the view.

### 6.2 Layout (mockup "Opção B")

- **Left rail.** A month switcher ("Novembro 2026") with every active client. Each client shows:
  - the status badge (`Rascunho` neutral, `Enviada ao cliente` info, `Ajustes pedidos`
    warning, `Aprovada` success), plus a count (posts, comments, or "N de M em produção");
  - "Sem linha neste mês" with a "Criar" button when the client has no linha that month.

  Clients with a linha sort first, then alphabetically. Selecting a client writes `cliente`
  to the URL. The rail uses the client filter list the board already loads.
- **Main.** The header shows the avatar, "Linha editorial de <mês>", a subtitle with the
  client, last send and status line, and the status badge. Actions depend on the status:
  - rascunho or ajustes: "Colunas", "Enviar ao cliente".
  - enviada: "Colunas", "Link do Hub", "Recolher". "Link do Hub" copies the client's Hub
    link with `/aprovacoes?aba=linha`, using `compactHubToken`.
  - aprovada: "Colunas", "Enviar de novo" (overflow menu).

  Under the header sits a summary line ("12 posts · Reels 6 · Carrossel 6"), then the table.

### 6.3 The table (mockup "1 · Montar a linha")

- **Columns:** an optional drag handle, a selection checkbox, Data, Formato, Título, Direção
  do conteúdo, then the extra columns in `ordem`, then **Produção**, which only appears once
  any row is converted.
- **Editing:**
  - Cells edit in place. Tab moves to the next cell, and Enter moves to the cell below.
  - Saves are optimistic per cell, with debounced text fields and `trackUnsavedWork` around
    the in-flight save, per the seamless-updates rule.
  - Formato is a menu of `PostTipoBadge`. Data is a date picker limited to the month. Select
    cells use the existing `PropertyValue` editors where they fit.
- **Rows:** "Nova linha" appends a row; its date defaults to the day after the last dated row
  **(my call)**. Rows are reordered by drag and sorted by date on demand ("Ordenar por data").
  Delete is in the row menu, with a confirm only for converted rows.
- **Converted rows** are read-only (§4.3). They show a `PostStatusChip` and a link to the post
  or fluxo in Produção, and their row menu offers "Abrir post".
- **Client comments:** a row with comments shows a speech-bubble count. Clicking it opens a
  side panel with that row's thread (client comments, team replies, rodada separators), and a
  linha-level thread sits at the top of the panel. Team replies are `respostas` rows with
  `is_workspace_user = true`.
- **"Colunas" popover** (mockup): lists the fixed and extra columns with a visibility toggle,
  and "Nova coluna" with the type grid. Each extra column has a menu: Renomear, Opções (for
  select types), "Visível para o cliente", Excluir. The footnote says "Valem para todas as
  linhas da agência." This is a reduced version of `PropertyDefinitionPanel`. Reuse its
  pieces where possible, but it writes `linha_editorial_colunas`, not template definitions.

### 6.4 Selection and conversion (mockups "3 · Aprovada", "4a", "4b")

- Selecting rows shows a floating selection bar. Only unconverted rows can be selected.
- The bar shows "N selecionados" plus a format breakdown, and three actions:
  - **Criar fluxo** (§7.1)
  - **Criar posts individuais** (§7.2)
  - **Limpar**
- The bar is new in the board area. Style it like the fluxo drawer's `drawer-selection-bar`
  (`WorkflowDrawer.tsx`) and its phone counterpart, and extract a shared component if that
  stays small.

### 6.5 Notifications

- Add the new types `linha_editorial_aprovada` and `linha_editorial_ajustes` to:
  - the SQL checks `notifications_type_check`, `notification_inapp_prefs_type_check` and
    `notification_email_prefs_type_check` (copy the latest full lists, see
    `20261025000002_post_discussao_participantes.sql`);
  - `NotificationType`, `NOTIFICATION_CATALOG` (category "Aprovações", both email-eligible)
    and `getNotificationDisplay()`;
  - the e-mail label map in `_shared/notification-email.ts`.
- Display copy:
  - aprovada: "{cliente} aprovou a linha editorial de {mês}", with body "{n} comentários" when
    n > 0.
  - ajustes: "{cliente} pediu ajustes na linha editorial de {mês}".

### 6.6 Phone

`PHONE_VIEWS` gets the tab. The phone layout is the client list, then a read-only list of item
cards (date, format, title, direction, comment count), the status, and "Enviar ao cliente".
Editing and conversion show "Edite a linha no computador." **(my call)**.

## 7. Conversion

The posts are built client-side by a pure, unit-tested function. The RPC then writes them
atomically.

`buildPostsFromItens(itens, colunas, templatePropertyDefs | null, timezone) → p_posts` returns,
per item:

- `item_id`.
- `scheduled_at`: the item's `data` at 10:00 in the workspace timezone (America/Sao_Paulo
  fallback) **(my call)**. Null when the item has no date.
- `conteudo` / `conteudo_plain`: a TipTap doc with:
  1. a bold paragraph "Direção do conteúdo" and the direction text, one paragraph per line;
  2. "Da linha editorial", a bullet list `Nome: valor` of every extra column that was not
     mapped to a property below, skipping empty values and rendering URLs as links.
- `property_values`: for fluxo conversion only.
  - An extra column maps to a template property definition when the normalized names match
    (case- and accent-insensitive) and the types are compatible.
  - Select values map option labels to the definition's options. A missing label goes to the
    bullet list instead.
  - Avulso posts have no custom properties today (`StandalonePostDrawer`, and the MCP rejects
    it), so for them every column goes to the bullet list.

The RPC `linha_editorial_converter` then:

1. Checks conta, the linha, items that belong to the linha and are unconverted, and the
   workflow (same conta and same `cliente_id` as the linha, when given).
2. Inserts `workflow_posts` with the item's own `titulo` and `tipo` (taken server-side,
   ignoring the payload) and `status = 'rascunho'`, plus:
   - `cliente_id`;
   - `workflow_id` (or null);
   - `ordem` (fluxo order = item date order) or `board_ordem` for avulsos, following
     `createAvulsoPost`;
   - `scheduled_at`, `conteudo`, `conteudo_plain` and `created_via = 'linha_editorial'`.
3. Inserts `post_property_values` after validating that each definition id belongs to the
   workflow's `template_id`.
4. Sets `post_id`, `convertido_at` and `convertido_por` on each item.
5. Returns `[{item_id, post_id}]`.

Check `created_via` and the platform targets: if `workflow_posts.created_via` has a CHECK, add
`'linha_editorial'`. Platform targets follow whatever `addWorkflowPost` and `createAvulsoPost`
do today. The builder mirrors them, for example deriving them from the fluxo's
`plataformas`.

### 7.1 Criar fluxo (mockups "3 · Aprovada" and "4a")

- Opens `NewWorkflowWizard` with a new optional `seed` prop:
  - `{ clienteId, nome, linhaId, itens }`
  - `nome` defaults to "{Formato plural} de {mês}" when every selected item has one format,
    else "Linha de {mês}".
- The Template step pre-selects nothing. The client is locked in O básico. A banner reads "N
  posts vêm da linha editorial de {mês}".
- The Revisar step lists the posts that will be created, as in mockup 4a, without per-post
  deadlines: deadlines stay per etapa of the fluxo, as today. The button reads "Criar fluxo
  com N posts".
- On submit, `createWorkflowFromWizard` runs first (existing code). Then
  `buildPostsFromItens(…, template defs)` and `linha_editorial_converter(linha, workflow.id,
  …)` run. If the RPC fails, call `removeWorkflow(workflow.id)`, the existing cleanup path,
  and show the error.
- The "Levar para cada post" checkboxes in the mockup are **not** built in v1 **(my call)**.
  Everything is always carried. They added choices without a clear use.

### 7.2 Criar posts individuais (mockup "4b")

- A dialog titled "Criar N posts individuais". Its "Processo de produção" choice is shown only
  when `feature_post_processes` is on:
  - **Sem processo**.
  - **Um processo por formato**: one template select per format present in the selection.
    Only templates whose `modo_prazo` is `padrao` are offered, because those apply without
    the manual dialog (as in `NewAvulsoDialog`).
- On submit, run `linha_editorial_converter(linha, null, …)`. Then, for each created post with
  a template chosen, run `applyPostProcess` (existing RPC `apply_post_process`), sequentially
  with a progress line.
  - A process that fails to apply leaves the post created without a process.
  - The toast reads "12 posts criados. 2 sem processo: aplique pelo post."
- Success toast: "N posts criados", with the action "Ver posts", which opens the Lista view
  with `entidade=posts` and the client filter.

### 7.3 The post shows its origin (mockup "5")

`PostEditorBody` (desktop drawer and phone) queries `linha_editorial_itens` by `post_id`. When
a row is found, it renders:

- the chip "Da linha editorial de {mês}", linking to the view;
- a "Comentários do cliente na linha editorial" section, read live from `respostas` for that
  item. It is not copied, so new replies show.

This is one small query, gated by the flag. Pilar, CTA and Referência appear as properties
only when they were mapped (fluxo posts). Otherwise they are in Roteiro e briefing.

## 8. Hub

### 8.1 Edge function `hub-linha-editorial` (new, `--no-verify-jwt`)

- **Auth:** `resolveHubToken()`, plus `effectivePlanFeature(conta, 'feature_linha_editorial')`,
  which fails closed. CORS is `buildCorsHeaders(req)`. Errors are generic outside and logged
  inside.
- **GET** returns the client's linhas with status `enviada`, `ajustes` or `aprovada` and a
  `periodo` within the last 3 months plus all future ones **(my call)**. `rascunho` linhas
  are never returned. Each linha comes with:
  - its items (fixed fields, plus `valores` restricted to columns with `visivel_cliente`);
  - the column definitions for those columns;
  - the `respostas` of the current `rodada`.

  It never returns `post_id` or internal user ids.
- **POST** `{token, linha_id, acao: 'comentario'|'aprovado'|'ajustes', item_id?, comentario?}`
  calls the §5.2 RPCs and writes `insertAuditLog` for decisions.
- **Rate limit:** reuse the hub write limiter used by `hub-approve`. Writes must not debit the
  `hub-read` budget (see the hub rate-limit budgets memory). GET uses `hub-read`.

### 8.2 Bootstrap and navigation

- `hub-bootstrap` adds `feature_linha_editorial` to its flags. `HubBootstrap` gets the
  optional field.
- The Aprovações badge (`usePendingApprovalsCount`) adds the number of `enviada` linhas when
  the flag is on, using a new `hubLinhasQuery`.

### 8.3 Aprovações page (mockups "2 · Hub")

- When the flag is on, the page gets tabs "Posts · n" / "Linha editorial · n", selected by
  `?aba=linha`. With the flag off, the page is unchanged.
- **Linha tab:**
  - `enviada` linhas first, as a card: title, "N posts planejados por {agência} · enviada em
    {data}", format pills, and the line "Este é o plano do mês: temas, formatos e datas. Os
    posts prontos chegam depois, para você aprovar um a um."
  - Rows are grouped by week ("Semana de 2 a 8 de novembro"), with the items without a date
    in a last group, "Sem data".
  - Each row shows the date block, a format pill, the visible extra columns as small text,
    the title, the direction and a "Comentar" action, which opens an inline textarea.
- **Sticky bar:** "{n} comentários" · "Pedir ajustes" (secondary) · "Aprovar linha editorial"
  (primary).
  - "Pedir ajustes" with zero comments opens a required textarea for a general comment.
  - "Aprovar" with comments shows them as notes; there is no extra confirm.
- **After a decision**, the card shows "Aprovada em {data}" or "Ajustes pedidos em {data}" and
  becomes read-only. Older linhas sit under "Anteriores", collapsed.
- **Both Hub identities** (default and Pauta, `feature_hub_pauta`) must render. Use the
  existing `HubCard`, `HubPill` and `HubButton` patterns and the `pauta` branch AprovacoesPage
  already has.
- **i18n:** a new namespace `hubLinha` in `packages/i18n/locales/{pt,en}`.
- **Phone:** the mockup "2 · Hub no celular", with stacked cards and a bottom bar of two
  full-width buttons, primary on top.

### 8.4 Telling the client

v1 extends the client e-mail digest (`client-event-email-cron`, `_shared/client-event-email.ts`,
RPC `claim_client_event_emails`) with a "Linha editorial de {mês} aguardando sua aprovação"
item for linhas sent since the last digest. This is a separate task in the plan, because that
cron has its own claim semantics. The "Link do Hub" button (§6.2) covers the WhatsApp habit
meanwhile.

## 9. Gating and rollout

- **Flag:** `feature_linha_editorial`, a boolean plan column defaulting to false on every plan.
  It is turned on per workspace through `workspace_plan_overrides.feature_overrides`, the
  same way financeiro v2 shipped dark. Which plans get it at launch is decided at launch, not
  in this spec.
- **Files the flag touches:**
  - the migration;
  - `FEATURE_COLUMNS` in `_shared/entitlements.ts`, then redeploy its importers
    (workspace-limits, platform-admin, paywall-report, automation-media, data-import,
    mcp-keys, mcp-oauth-consent);
  - `FeatureFlags` in `useWorkspaceLimits.ts`;
  - `entitlement-errors.ts`;
  - the Admin `api.ts` lists;
  - `hub-bootstrap`.
- **Order** (memory: merging deploys the frontend immediately):
  1. migrations on staging, then prod;
  2. edge functions (`hub-linha-editorial`, `hub-bootstrap`, the entitlements importers, the
     notification-email cron);
  3. merge.

  The flag is dark, so the frontend can merge after the backend is live.
- **Migration prefix:** must sort after main's tail at PR time (today `20261029000003_…`).
  Renumber before `gh pr create`.

## 10. Testing

- **Vitest:**
  - `viewQuery` round-trips `view=linha&cliente&mes`;
  - `buildPostsFromItens` (property mapping, accent-insensitive names, select label misses,
    URL rendering, null dates, timezone);
  - the selection bar's format breakdown;
  - the Hub week grouping;
  - the badge count.
- **Deno:** `hub-linha-editorial` covers the token scope (another client's linha gives 404),
  `rascunho` never returned, decision only from `enviada`, hidden columns stripped, and that
  writes don't debit `hub-read`.
- **Entitlement suite (psql, CI-gated):**
  - RLS isolation for all four tables;
  - the flag trigger blocks inserts when off;
  - the freeze trigger after conversion;
  - the date-in-month trigger;
  - status not writable through PostgREST;
  - `linha_editorial_converter` rejects another conta's workflow, a different client's
    workflow, and already converted items;
  - service-role-only grants on the Hub RPCs.
- **Browser:** build, send, approve via Hub (fake backend per the hub visual-check memory, if
  prod writes are blocked), convert to fluxo, convert to avulsos, open the post and see the
  origin.

## 11. Calls made in this spec (review these)

1. The linha title is derived, not stored.
2. Default columns Pilar, CTA and Referência are seeded on the first linha.
3. "Direção do conteúdo" is a fixed field that can be hidden from the CRM table only.
4. Rows stay editable in every status. Editing an `aprovada` linha doesn't reopen it, and
   "Enviar de novo" asks for re-approval.
5. Conversion is allowed before approval, behind a confirm.
6. Converted rows are frozen. Deleting the post frees the row.
7. Client comments don't notify; the decision notification carries the count.
8. Posts are scheduled at 10:00 on the row's date.
9. The wizard's Revisar step shows no per-post deadlines (fluxo deadlines stay per etapa).
10. The "Levar para cada post" checkboxes are dropped; everything is carried.
11. Bulk "um processo por formato" only offers `padrao` templates.
12. The phone gets a read view only.
13. The Hub shows the last 3 months plus future linhas, never rascunho.
14. The client e-mail digest includes sent linhas, as a separate plan task.

## 12. Left to the builder

- Exact column widths, keyboard details and the empty states' copy, within the mockups.
- Whether the selection bar becomes a shared component with the fluxo drawer's.
- Whether to virtualize the table (a month is 8 to 40 rows, so probably not).
- Query key structure and invalidation.
