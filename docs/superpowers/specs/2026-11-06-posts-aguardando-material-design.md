# Posts aguardando material (pedido de material com lista de itens)

Date: 2026-11-06
Status: design approved by the user (canvas + three open points, my picks accepted)
Mockups: https://claude.ai/artifact/DXxohbWsrNUJz8Vh3odxCT (Design canvas; top row = Hub,
"CRM da agência" row = CRM, "Descartadas" row = rejected options, for reference only)
Builds on: `2026-10-08-client-post-references-design.md` (referências do cliente)

## Problem

Agencies often can't finish a post until the client sends something: a video of the
doctor, a photo of the clinic, a price list. Clients can already attach files to a post in
the Hub (Referências tab), but:

- they only see a post once it is `enviado_cliente` (or "em produção" after a send), so a
  draft that is blocked on their material is invisible to them;
- uploads are only open while the post is `enviado_cliente`;
- nothing tells them a post needs something, or what.

Today the ask goes by WhatsApp and the files come back separated from the post.

## Goal

The team marks a post as **waiting for material** and lists the items it needs. The client
sees those posts in the Hub, inside **Aprovações**, as a checklist, sends a file or link for
each item, and the team is told when everything (or everything the client has) arrived.

## Decisions (user, 2026-11-06)

1. **No new Hub route or nav item.** Everything lives under Aprovações, as a third section
   pill next to "Posts" and "Linha editorial": `Material · N`.
2. **Checklist per post.** The team lists named items (name + optional detail); each item
   is checked once it has at least one file or link.
3. **Closing.** The request closes by itself when every item has a file. The client can also
   close it early with "Enviei o que tenho". The team can turn it off at any time.
4. **Drafts.** A post in an internal status (`rascunho`, `revisao_interna`,
   `aprovado_interno`) shows in the Hub **only because of the request**, and only its title,
   type, date and the items. No caption, no media, no Aprovar.
5. **Limits.** Item files are ordinary `post_references` rows linked to an item: they count
   toward the 10-references-per-post limit and the plan's storage quota, exactly like
   references today.

## Non-goals (v1)

- A Hub route, nav item or page for material (decision 1).
- Requests at the workflow or client level ("send me 10 photos for the month"). One request
  belongs to one post.
- Due dates or reminders per request or item. The post's own date shows on the tile.
- E-mail to the client when a request opens. The client finds it in the Hub (nav badge,
  Home banner, Aprovações). A later phase can reuse `client-event-email-cron`.
- E-mail to the team. The new notification is in-app only, like `post_client_reference`.
- Copying requests on "Duplicar post" / "Duplicar fluxo".
- MCP tools for requests.
- "Usar no post" (copy an item file into the post's media). Same rule as references: if it
  is ever built, it must copy the R2 object.

## Concepts

- **Request** (`post_material_requests`): one row per post at most. `status`:
  - `aberto`: the client is asked; the post shows in Aprovações › Material.
  - `concluido`: closed, with `closed_by = 'auto'` (every item has a file) or
    `'client'` ("Enviei o que tenho").
  - `cancelado`: the team turned the switch off (`closed_by = 'team'`), or the post reached
    `agendado`/`postado` (`'system'`).
- **Item** (`post_material_items`): name (required) + detail (optional), ordered.
- **Item done** = at least one `post_references` row with `material_item_id = item.id`.
  Never stored; always computed.

Turning the switch back on reopens the same row (`status = 'aberto'`, `closed_*` cleared);
items and files are kept. One row per post keeps reads and the unique constraint simple;
there is no request history (my call).

## Data model (one migration)

Migration version above main's tail at PR time (see `migration-version-guard`).

### `post_material_requests`

| column | type | notes |
|---|---|---|
| `id` | bigserial PK | |
| `post_id` | bigint NOT NULL | composite FK `(post_id, conta_id)` → `workflow_posts(id, conta_id)` ON DELETE CASCADE, same as `post_references` |
| `conta_id` | uuid NOT NULL | FK `workspaces` ON DELETE CASCADE |
| `status` | text NOT NULL | CHECK in `('aberto','concluido','cancelado')` |
| `closed_by` | text NULL | CHECK in `('auto','client','team','system')`; NULL iff `status = 'aberto'` (CHECK) |
| `closed_at` | timestamptz NULL | NULL iff `status = 'aberto'` |
| `opened_by` | uuid NULL | `auth.users` ON DELETE SET NULL (nullable on purpose: auth-user deletes). Rewritten on every reopen, with `opened_at`: "Pedido por {nome} em {data}" shows the current opening |
| `opened_at` | timestamptz NOT NULL DEFAULT now() | updated on reopen |
| `created_at` / `updated_at` | timestamptz | `updated_at` trigger |

`UNIQUE (post_id)`, plus `UNIQUE (id, post_id, conta_id)` as the target of the items FK.
Index on `(conta_id, status)`.

### `post_material_items`

| column | type | notes |
|---|---|---|
| `id` | bigserial PK | |
| `request_id` | bigint NOT NULL | composite FK `(request_id, post_id, conta_id)` → `post_material_requests(id, post_id, conta_id)` ON DELETE CASCADE |
| `post_id` | bigint NOT NULL | denormalised; the composite FK pins it to the request's post |
| `conta_id` | uuid NOT NULL | denormalised; same |
| `label` | text NOT NULL | 1–120 chars (trimmed) |
| `detail` | text NULL | ≤ 300 chars |
| `position` | int NOT NULL | 0-based order |
| `created_at` / `updated_at` | | |

At most **10 items** per request, and the save RPC also refuses (`too_many_items`) when
items + the post's free-form references (rows with `material_item_id IS NULL`) exceed 10,
so every item can get at least one file. Extra files on one item still count toward the
10-reference cap (decision 5); if a client fills the cap before every item has a file, the
Hub disables "Enviar" with "Este post chegou ao limite de 10 arquivos. Envie o resto como
link ou toque em Enviei o que tenho." (links count too, so the realistic way out is
"Enviei o que tenho"). The CRM editor hides "Adicionar item" at the same bound (my call).

Items also get `UNIQUE (id, post_id, conta_id)` as the target of the reference FK.

### `post_references.material_item_id`

`bigint NULL`, indexed, with composite FK `(material_item_id, post_id, conta_id)` →
`post_material_items(id, post_id, conta_id)` `ON DELETE SET NULL (material_item_id)`
(Postgres 15+ column list, so the delete nulls only the item column, never `post_id` or
`conta_id`). The database, not only the RPCs, guarantees that a reference, its item, the
item's request and the post all belong together, the same way `post_references` already
pins post and file to its workspace. Deleting an item keeps its files as plain references
(they still show in "Referências do cliente").

### Access

Both tables: RLS on, `REVOKE ALL … FROM PUBLIC, anon, authenticated` (name the roles
explicitly), service role only. Every read and write goes through the edge functions below,
like `post_references` writes do. Because they hang off `workflow_posts`, the
acesso-por-cliente drift suite (`99_acesso_por_cliente_drift.sql`) will flag them: add a
commented entry in `v_exempt_no_policy` (`99_acesso_por_cliente_drift.sql`, RLS on and no
non-service-role policy), with the reason "no authenticated grant; edge functions enforce
scope via `_shared/client-scope.ts`".

### RPCs (SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE to `service_role` only)

All take the post row lock (`SELECT … FROM workflow_posts … FOR UPDATE`), the same lock
`post_reference_file_insert` and status changes take, so uploads, saves and closes
serialise per post.

- **`post_material_request_save(p_conta uuid, p_post bigint, p_user uuid, p_open boolean, p_items jsonb)`**
  (team). `p_items` = ordered array of `{id?: bigint, label, detail}`; ids not in the array
  are deleted (their files become plain references), new ones inserted, the rest updated.
  - Refuses (`post_not_requestable`) to open when the post is `agendado`, `postado` or
    `falha_publicacao`.
  - `p_open = true` with zero items → `items_required`.
  - `p_open = false` → `status = 'cancelado'`, `closed_by = 'team'`. Items are kept.
  - `p_open = true`: creates or reopens, then runs the completion check (below) **without**
    notifying (the team itself caused it). So a team that adds an item to a `concluido`
    request reopens it, and a team that removes the last missing item closes it.
  - Returns the request with items and per-item `file_count`.
- **`post_reference_file_insert` / `post_reference_link_insert`** (changed, `CREATE OR REPLACE`
  keeps the ACL). New optional `material_item_id` in the jsonb.
  - Status gate becomes: `status = 'enviado_cliente'` **or** an `aberto` request exists.
  - When the post is not `enviado_cliente`, `material_item_id` is **required**
    (`item_required`): on a draft the client can only answer items, never add free-form
    references.
  - When `material_item_id` is given: it must belong to this post's request and the request
    must be `aberto` (`request_closed` otherwise).
  - After the insert, the **completion check**: if the request is `aberto` and every item has
    ≥1 reference → `status = 'concluido'`, `closed_by = 'auto'`, and the
    `post_material_complete` notification is created in the same transaction. Atomic on
    purpose: a separate, non-fatal call could leave every item checked on a request that
    never closes.
  - The 10-reference limit and quota logic are unchanged (decision 5).
- **`post_material_client_close(p_conta, p_cliente, p_post)`** ("Enviei o que tenho").
  Requires `aberto` and **at least one item done** (`nothing_sent` otherwise; the button is
  disabled in that state; closing with nothing would just be a silent "no"). Sets
  `concluido` / `client` and creates the notification. Returns `'ok' | 'not_found' |
  'request_closed' | 'nothing_sent'`.
- **`post_reference_can_remove`** (changed). An item file (`material_item_id IS NOT NULL`)
  is removable by the client while the request is `aberto`, whatever the post status. Rows
  without an item keep today's rule. Once the request closes, item files lock like
  references do after the team answers. `post_reference_client_delete` and
  `post_reference_client_update` (note edit) both call this predicate under the post lock,
  so while the request is open the client can also edit the note on their own item file.
  That is intended (my call): it's their file, and the note helps the team.
- **`post_reference_list`** (changed): add `material_item_id` to the returned columns. A
  `RETURNS TABLE` change needs `DROP FUNCTION` + `CREATE` + re-grant in the migration.
- **`post_reference_team_delete(p_conta, p_ref_id)`** (new). The CRM `DELETE /:id` today
  deletes the row directly, without the post lock. It moves into this RPC, which takes the
  post lock, deletes, and re-runs the completion check without notifying: a `concluido`
  request whose item lost its last file reopens (`aberto`, `closed_*` cleared), so the
  client is asked again and the CRM counts stay right (my call).
- **Status trigger**: when `workflow_posts.status` changes to `agendado` or `postado`, an
  `aberto` request becomes `cancelado` / `system`. (`falha_publicacao` comes only from
  those, so it never has an open request.)

### Notification `post_material_complete`

- Add to `notifications_type_check` and `notification_inapp_prefs_type_check`. Copy both
  lists from the **latest** migration that redefines them (check with
  `grep -l notifications_type_check supabase/migrations/*` at PR time) and only append.
- Targets and link: same as `create_post_reference_notification` (reads conta/cliente from
  the post; works for posts avulsos). Pass `p_cliente_id` and put `post_id` in metadata,
  per the acesso-por-cliente rule for new emitters.
- Metadata: `{ post_id, closed_by: 'auto' | 'client', done, total }`.
- CRM copy (`notification-catalog.ts` / `notification-config.ts`):
  - auto: "**{cliente}** enviou todos os itens pedidos em **{post}**"
  - client: "**{cliente}** enviou o que tinha ({done} de {total} itens) em **{post}**"
- No e-mail (not in `claim_notification_emails`' allowlist), no coalescing (fires once per
  close).
- **Push: yes**, like `post_client_reference` (which is pushed). The migration redefines
  `claim_notification_pushes` and `push_badge_counts` from their latest definitions
  (today `20261120000001_push_acesso_por_cliente.sql`) appending the type, and
  `_shared/notification-render.ts` gets the copy above.
- The existing per-upload `post_client_reference` keeps firing (15-min coalescing), so the
  team also sees each file arrive.

## Edge functions

### `hub-post-references` (changed, Hub token, `--no-verify-jwt`)

- **`GET /requests`** (new, debits `hub-read`): every `aberto` request of the token's
  `cliente_id` (and `conta_id`). Per post: `post_id`, `titulo`, `tipo`, `scheduled_at`,
  `platform`, `client_visible` (whether `isHubVisiblePost` would show it, so the Hub knows
  whether to offer "Ver post" and the history tab), and the items in order with
  `{id, label, detail, done, files: [...]}` where files are the same item shape the list
  route returns (signed thumbnails, `can_remove`). Nothing else from the post: no caption,
  content, media or properties (decision 4). Batched queries, not one per post.
- **`GET ?post_id`** (list): adds `material_item_id` to each item and `request` (the same
  per-post object, or `null`). `can_add` keeps its meaning (free-form references: status
  `enviado_cliente` and under the limit); item uploads are gated by `request.status`.
- **`POST /upload-url`, `/files`, `/links`**: accept `material_item_id`. The handler's
  best-effort gate becomes "`enviado_cliente` or open request"; the RPC is the real gate.
  Map the new errors (`item_required`, `request_closed`) to 409 with generic copy.
- **`POST /requests/:postId/close`** (new, debits `hub-write`): calls
  `post_material_client_close`.
- **Error contract, end to end.** Extend `ReferenceErrorCode` and `REFERENCE_ERROR_STATUS`
  in `_shared/post-references.ts`, the RPC-exception mapper that turns `P0001` messages into
  codes, and the Hub client's accepted error-code set with: `item_required` (409),
  `request_closed` (409), `nothing_sent` (409), `too_many_items` (409),
  `items_required` (400), `post_not_requestable` (409), `invalid_item` (400, label/detail
  out of bounds). Each gets Hub or CRM copy. A code missing from any layer degrades to a
  generic 500, so the Deno tests assert each one's status.
- Ownership stays "the post's own `cliente_id`/`conta_id` match the token" (404, never 403).

`hub-posts` is **not** changed: drafts never enter `posts`, so Postagens, the calendar and
every other reader of that list stay as they are. Material requests reach the Hub only
through `GET /requests`, which keeps decision 4 enforceable in one place.

### `post-references` (changed, CRM, JWT)

Same auth and client-scope handling it has today. CORS `Access-Control-Allow-Methods`
gains `PUT` (today `GET, DELETE, OPTIONS`, `handler.ts:42`), and the CRM wrapper
`callPostReferences` in `apps/crm/src/store/postReferences.ts` (typed `'GET' | 'DELETE'`, no
body) gains `PUT` with a JSON body. Without both, the browser `PUT` fails.

- **`GET ?post_id`**: adds `material_item_id` per item and `request` (status, closed_by,
  closed_at, opened_by name, items with `file_count`).
- **`PUT /requests/:postId`** (new): body `{ open: boolean, items: [{id?, label, detail?}] }`
  → `post_material_request_save`. 200 `{ request }` (same shape as in `GET`); errors use the
  shared codes above (400 bad body, 403 permission/scope, 404 post, 409 state).
  Requires `hasPermissionFor(…, 'entregas', 'editar')` and the post visible in the caller's
  scope with full access (same rule as the delete route: "é dele" does not grant it, since
  opening a request exposes the post to the client). Own-only members see the request
  read-only.
- **`DELETE /:id`**: calls `post_reference_team_delete` instead of deleting directly.
- **`GET /requests/summary?post_ids=…`** (new, ≤ 200 ids): `{post_id, status, done, total}`
  for the CRM badges and filter. Filters by `conta_id` and scope. The builder may instead
  fold this into whatever already feeds the `post-reference-counts` query if that is cleaner.

## Hub UI (`apps/hub`)

Matches the canvas top row (classic look; the pauta look reuses the same components with
its own pill styling via `filterPillStyle`).

- **Query**: `hubMaterialRequestsQuery(token)` → `GET /requests`. Shared by the nav badge,
  Home and Aprovações.
- **Nav badge** (`usePendingApprovalsCount`): adds the number of open requests (one per
  post). Mobile nav reads the same hook.
- **Aprovações** (`AprovacoesPage.tsx`):
  - `ApprovalTabs` gains `material`, labelled `Material · {{n}}`, shown only when `n > 0`.
    The tab bar shows whenever at least two pills would show (today it requires the linha
    flag; with material it can show without it). URL `?aba=material`, same pattern as
    `?aba=linha`.
  - Header line counts both: "2 posts esperando sua aprovação e 3 pedidos de material."
    (only the non-zero parts).
  - Material section: one tile per request, ordered by `scheduled_at` (nulls last), then
    `opened_at`. Tile: "Aguardando material" pill, title, "X de N itens enviados", progress
    bar, the item names (done ones checked and struck through), "Tipo · data", and
    "Enviar". The whole tile opens the request dialog.
- **Request dialog** (new component, not a mode of `PostDetailDialog`): header with title
  and pills (Aguardando material, tipo, platform, date); "A equipe precisa de N itens" +
  "X de N enviados" + progress; tab "Itens pedidos" with one row per item (check circle,
  label, detail, its files, "Enviar" opening the same file/link picker the Referências tab
  uses, with `material_item_id`); tab "Histórico e comentários" **only when
  `client_visible`** (a never-sent draft has no client history; the canvas shows it on a
  draft, this overrides it); footer "Quando os N itens tiverem arquivo, a equipe é avisada.
  Não tem algum?" + secondary "Enviei o que tenho" (disabled with zero done; confirm in a
  small dialog before closing). Left pane on desktop: "Este post ainda está em produção"
  for drafts; for client-visible posts, a "Ver post" link to the normal post dialog.
  Reuse the reference upload hook, the limits copy ("Fotos e PDFs até 25 MB, vídeos até
  200 MB") and the `trackUnsavedWork` handling from the Referências tab.
- **`PostDetailDialog`** (client-visible posts with an open request): a one-line notice
  above the tabs, "A equipe pediu material para este post · Ver itens", opening the request
  dialog. Its Referências tab shows item files too (they are references), labelled with the
  item name.
- **Home** (`HomePage.tsx`, and `HomePagePauta.tsx` with its own styling): a banner under
  the approvals banner, "A equipe está esperando {{items}} itens seus em {{posts}} posts"
  (singular forms), linking to `aprovacoes?aba=material`. Hidden at zero.
- After a successful upload or close: invalidate the requests query, the post's references
  query and the badge.
- i18n: new keys in the Hub's pt and en bundles (same namespaces as `hubLinha`/`hubPosts`);
  no em-dashes in copy.

## CRM UI (`apps/crm`)

Matches the "CRM da agência" row of the canvas.

- **Post editor, "Referências do cliente" section** (`PostClientReferences.tsx`, rendered by
  `PostEditorBody.tsx`): today it renders nothing without references. It now always renders
  for users with `entregas:editar`, with:
  - Switch "Pedir material ao cliente", helper "O post aparece em Aprovações no Hub, mesmo em
    rascunho, com estes itens."
  - When on: "Itens pedidos · X de N com arquivo", then editable rows (name input, detail
    input, badge "N arquivo(s)" or "Falta", remove, drag handle), "Adicionar item" (hidden
    at 10), and "Pedido por {nome} em {data}". Saves through `PUT /requests/:postId`
    (explicit save or debounced autosave: builder's call; either way wrap in
    `useUnsavedWork`).
  - Header badge in the editor: warning "Aguardando material" while `aberto`; success
    "Material recebido" while `concluido` and the post is still internal.
  - Existing reference tiles below, each showing its item name when it has one.
  - Users without `entregas:editar` see the request read-only, and nothing when there is none.
- **Post cards** (the workflow drawer list and the Publicações list/kanban): badge
  "Material · X de N itens" (warning) while `aberto`; "Material recebido · N de N itens"
  (success) while `concluido` and the post is in an internal status. Nothing otherwise.
- **Filter** in Publicações: "Aguardando material" / "Material recebido", next to the
  existing filters (those read `postStageOf`; this one reads the summary).
- **Notifications**: render `post_material_complete` (icon, copy above, link to the post).

## Security

- The Hub only ever sees requests for its token's `cliente_id`; every write re-checks
  ownership under the post lock inside the RPC.
- A draft's caption, content, media, properties and approvals never leave the server:
  `GET /requests` selects explicit columns and `hub-posts` is untouched.
- The team side respects acesso por cliente through the existing `post-references`
  scope checks; the tables have no `authenticated` grant.
- No raw errors to clients; generic messages, details logged.

## Testing

- **SQL / entitlement suite**: save RPC (open, reopen, cancel, item add/update/delete,
  10-item cap, refuses on `agendado`); file insert on a draft with/without item, wrong
  item, closed request; auto-complete closes and emits exactly one notification; client
  close with zero/one done; `can_remove` for item files open vs closed; status trigger
  cancels on `agendado`/`postado`; ACL check that `authenticated` has nothing on the new
  tables; drift-suite exemption present.
- **Deno**: `hub-post-references` routes (`/requests` shape contains no post content; item
  gate errors; close); `post-references` PUT permission + scope, summary.
- **Vitest**: Hub Material pill visibility and count, tile rendering, dialog (upload per
  item, close button disabled at zero, history tab only when `client_visible`), badge sum,
  Home banner; CRM switch + item editor, card badges, filter, notification copy.
- Grep both `__tests__` trees for reference list shapes: the new `material_item_id` field
  changes the contract.

## Rollout

No plan flag (references aren't gated either). Order:

1. Migration (`db push`). Additive except the redefined RPCs, which stay
   backward-compatible: old callers never send `material_item_id`.
2. Deploy `hub-post-references` (`--no-verify-jwt`), `post-references` and
   `notification-push-cron` (bundles `notification-render.ts`).
3. Merge (Vercel deploys CRM and Hub).

A frontend deployed before steps 1–2 would break the CRM switch and the Hub Material query,
so both go before the merge.

Rollback: frontend first; functions can stay (the new routes are simply unused); the
migration can stay.

## Calls I made (check these)

- One request row per post, reopened in place; no request history.
- Material tiles open a new request dialog instead of a mode of `PostDetailDialog`; visible
  posts link between the two.
- "Histórico e comentários" in the request dialog only for client-visible posts.
- "Enviei o que tenho" needs at least one item done.
- Reaching `agendado`/`postado` cancels an open request.
- Item cap of 10, matching the reference limit.
- Completion and its notification happen inside the upload RPC, atomically.
- `hub-posts` unchanged; material reaches the Hub through `GET /requests` only.
- "Material recebido" badge shows only while the post is still internal.
- Items + free-form references capped at 10 at save; extra files per item still count, and a
  full post leaves "Enviei o que tenho" as the way out.
- A team delete that empties an item reopens a concluded request.
- Push notification on, like `post_client_reference`.
- Opening a request needs full client access; "é dele" members see it read-only.
- While a request is open the client can edit the note on their item files, not only
  remove them.
- `opened_by`/`opened_at` show the latest opening, not the first.
