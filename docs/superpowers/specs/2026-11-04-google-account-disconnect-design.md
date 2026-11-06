# Desconectar conta Google (account-level disconnect) — design

Parent spec: `docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md` (§4.2–§4.6).
Approved UI mockup: https://claude.ai/artifact/NBa54Gy2EAM3RnKJqY21Wk

## 1. Intent

A workspace holds at most one `google_connections` row per Google identity
(`UNIQUE (conta_id, google_sub)`), shared by YouTube and Google Meu Negócio (GMN). Today the only
way out is per client per product (`POST /disconnect/youtube/:clientId`,
`POST /disconnect/gbp/:clientId`). The last of those unlinks revokes the grant only when the
identity is unused everywhere and older than the 1-hour fresh-connection grace; while any other
client of the workspace (or another workspace) still uses it, the row and its tokens stay, and
the user has no way to say "drop this Google account from this workspace". There is also no place
that lists which Google accounts the workspace holds.

This feature adds a Settings tab "Contas conectadas" listing the workspace's Google accounts with
what each one feeds, and a "Desconectar conta" action that, in one transaction: unlinks every
YouTube channel and GMN unit of this workspace on that identity, removes this workspace's
connection row, and revokes the grant at Google only when no other workspace still uses the
identity (§4.2 rule, unchanged).

## 2. Approved UI

### 2.1 Settings tab "Contas conectadas" (`/configuracao/contas-conectadas`)

- `CONFIG_TABS` entry: `{ path: 'contas-conectadas', labelKey: 'tabs.contasConectadas',
  permission: { module: 'configuracoes', action: 'ver' }, group: 'workspace', icon: Plug }`,
  placed after `hub` and before `armazenamento` (the `workspace` group must stay contiguous).
  `Plug` is also the MCP tab's icon; kept because the mockup was approved with it.
- Section heading: "Google (YouTube e Google Meu Negócio)".
- One card per connection of the active workspace, sorted by email:
  - avatar with the email's first letter (uppercase), the email, "Conectada em {{date}}" (date of
    `google_connections.created_at`, `dd/MM/yyyy` via date-fns with the active locale). **No
    "por <name>"**: `google_connections` has no creator column, and deriving it from `audit_log`
    (`google-connect` rows) is fragile; omitted in v1.
  - status pill: "Ativa" (`status = 'active'`, success badge) or "Precisa reconectar"
    (`status = 'revoked'`, warning badge).
  - "YouTube · {{count}} canais" (singular "YouTube · 1 canal"): every channel on this connection,
    `title` + client name. A channel with `authorizationStatus = 'revoked'` is still listed.
    Omitted when the list is empty.
  - "Google Meu Negócio · {{count}} unidades" (singular "1 unidade"): units with status
    `active` or `revoked` (never `disconnected`), `title` + client name; first 3, then
    "+ {{count}} unidades" as a text toggle that expands the rest. Omitted when empty.
  - Connection with neither list: the hint (see §8, corrected copy):
    "Nada vinculado a esta conta. Desconecte para apagar o acesso dela neste workspace."
  - Button "Desconectar conta" (variant `outline`, destructive text) only when
    `can('configuracoes', 'editar') === true`. Everyone else sees the card without it.
- Empty state (no connection): "Nenhuma conta Google conectada. Conecte pelo YouTube ou Google
  Meu Negócio na página de um cliente." When neither `feature_youtube` nor
  `feature_google_business` is on (page reached by URL after a downgrade), only the first
  sentence is shown: the client-tab connect buttons are hidden then.
- Loading: skeleton cards. Error: inline "Não foi possível carregar as contas conectadas." with
  "Tentar de novo".
- Phone (`!useIsDesktop(768)`): `ConfigPhoneScreen` titled "Contas conectadas", one stacked card
  per connection (same content), full-width "Desconectar conta" button at the card's bottom.
  `ConfiguracaoIndex.TILE_COLORS['contas-conectadas'] = '#ff2d55'`.

### 2.2 Confirmation dialog (`AlertDialog`)

- Title: "Desconectar {{email}}?"
- Body: "Isso desvincula:" then the full list (scroll area, max-height 240px): each YouTube channel
  "{{title}} ({{client}})" under "YouTube", each GMN unit "{{title}} ({{client}})" under "Google
  Meu Negócio". With nothing linked, the list is replaced by "Nenhum canal ou unidade vinculado."
- Bullets (each shown only if relevant, the third always):
  - "Os dados do YouTube são apagados do Mesaas em até 7 dias, inclusive dos relatórios gerados."
  - "O histórico do Google Meu Negócio fica guardado por 30 dias. Se você vincular a unidade de
    novo nesse prazo, ele volta."
  - "Revogamos o acesso do Mesaas na sua conta Google. Na próxima conexão, o Google pede
    autorização de novo."
- Note box (always shown, never conditional): "Se essa conta Google também estiver conectada em
  outro workspace do Mesaas, o acesso continua ativo lá e não é revogado no Google."
- Buttons: "Cancelar" / "Desconectar conta" (destructive). The action keeps the dialog open while
  pending (`e.preventDefault()`, same as `GoogleBusinessSection`).
- Success: close, `toast.success('Conta Google desconectada')`, invalidate (§6.3).
  A failed Google-side revoke is not an error (queued; the response is 200 regardless).
- `not_found` (404) means the connection is already gone (another tab, a concurrent unlink or
  the orphan sweep): treated as done, not as an error. Close the dialog, `toast.success('Essa
  conta Google já tinha sido desconectada.')`, refetch the list (invalidate `['googleAccounts']`).
- `conflict` (409, a concurrent link on the same connection): toast "A conta mudou enquanto
  desconectávamos. Tente de novo." and keep the dialog open so the user can retry.
- Other errors: `forbidden` → "Você não tem permissão para desconectar contas."; `rate_limited` → "Muitas
  tentativas. Aguarde um minuto e tente de novo."; anything else → "Não foi possível desconectar
  a conta. Tente de novo."

### 2.3 Client tabs

`apps/crm/src/pages/cliente-detalhe/GoogleBusinessSection.tsx` and `YouTubeSection.tsx`:
- After the "Conta Google: {{email}}" line, a link "Gerenciar contas" (`<Link
  to="/configuracao/contas-conectadas">`), shown only when the user can access the tab
  (`canAccessConfigTab('contas-conectadas', can, workspaceRole)`).
- `YouTubeSection` does **not** render the account line today: add it from
  `summary.youtube.connectionEmail` (already in the payload), reusing a new
  `youtube.account` key ("Conta Google: {{email}}"), hidden when the email is null.
- The per-client disconnect button label becomes "Desconectar deste cliente" on both cards.
  `PlatformActions` hardcodes `t('instagram.disconnectTooltip')` and is shared with
  `TikTokSection`: add an optional `disconnectLabel?: string` prop, defaulting to the current
  string. The per-client confirmation dialogs are unchanged.

All copy is pt with en translations; no em dashes in user-facing copy.

## 3. Backend: RPC `google_disconnect_identity`

New migration `supabase/migrations/20261116000001_google_disconnect_identity.sql` (main's tail is
`20261114000001`; re-check `ls supabase/migrations | tail` against `origin/main` right before
`gh pr create` and renumber if taken). `SET LOCAL lock_timeout = '5s'`.

```
google_disconnect_identity(p_conta_id uuid, p_connection_id uuid)
  RETURNS TABLE(should_revoke boolean, revocation_id uuid,
                youtube_channels_unlinked int, gbp_locations_unlinked int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  -- #variable_conflict use_column
  REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role
```

The first two columns are the unlink RPCs' contract, so `processUnlinkDecisionData` consumes the
result unchanged (it reads `should_revoke`/`revocation_id` from `data[0]`).

### 3.1 Steps

It must **not** loop over `google_unlink_youtube` / `google_unlink_gbp_location`: each ends in
`_google_revoke_if_unused`, so an intermediate call could revoke and delete the connection while
units remain to process. Everything is inlined:

1. `SELECT google_sub FROM google_connections WHERE id = p_connection_id AND conta_id =
   p_conta_id`. Not found → `RAISE 'google connection not found' USING ERRCODE = 'P0002'`
   (covers a foreign id: no cross-tenant probe, same error as missing).
2. `pg_advisory_xact_lock(hashtext('google-sub:' || v_sub))`. One sub lock only: thanks to
   `UNIQUE (conta_id, google_sub)` every channel/unit of this workspace on this identity hangs
   off this one row, so there is no "same sub, different connection row" case inside a
   workspace and no second lock. Lock order is the documented one (advisory sub lock, then row
   locks), same as `google_connection_upsert` and `google_mark_revoked`.
3. Under the lock: `SELECT 1 FROM google_connections WHERE id = p_connection_id AND conta_id =
   p_conta_id FOR UPDATE`. Gone (a concurrent last-unlink, another disconnect or the orphan
   sweep released it between step 1 and the lock) → `RAISE … USING ERRCODE = 'P0002'`, same as
   step 1, so a missing connection is always 404 `not_found` at the route and the UI treats it as
   already done (§2.2). The row lock makes
   a concurrent channel/unit write that references this connection (FK check takes `FOR KEY
   SHARE`) wait for this transaction and then fail on the FK, so nothing can be linked to the
   row between steps 4 and 8.
3b. Consume this workspace's outstanding Google OAuth states (see "Outstanding states" below):
   `UPDATE oauth_states SET consumed_at = now() WHERE provider = 'google' AND conta_id =
   p_conta_id::text AND consumed_at IS NULL`.
4. YouTube, exactly the unlink's purge order: `FOR v_ch IN DELETE FROM youtube_channels WHERE
   conta_id = p_conta_id AND connection_id = p_connection_id RETURNING channel_id, client_id
   LOOP PERFORM youtube_purge_channel(p_conta_id, v_ch.channel_id, v_ch.client_id); count++`.
   `youtube_purge_channel` already does histórico → report lock (`FOR UPDATE`) → PDF queue →
   snapshot update + its `youtube-data-purged` audit row; not restated here. Revoked channels
   (already purged by `google_mark_revoked`) are deleted too; their second purge deletes nothing.
5. GMN. First lock every unit row on this connection, **all statuses**:
   `PERFORM 1 FROM gbp_locations WHERE connection_id = p_connection_id FOR UPDATE`. This closes
   the relink race: `handleLinkLocations` updates this client's own rows in place (including a
   `disconnected` row still pointing at this connection) with plain UPDATEs that take no sub
   lock. With the rows locked, such a concurrent UPDATE waits for this transaction, then
   re-evaluates against the committed row (`connection_id` now NULL after step 8's SET NULL)
   and its FK/CHECK fails, so the disconnect wins. Conversely, an UPDATE that already committed
   before this lock makes the row `active` again, and the UPDATE below disconnects it. If the
   RPC itself ever hits a `23514` (CHECK) or `23503` (FK) from such an interleaving, it rolls
   back and the route answers 409 `conflict` (§4.2); the user retries.
   Then the state `google_unlink_gbp_location` produces: `UPDATE gbp_locations SET status =
   'disconnected', disconnected_at = COALESCE(disconnected_at, now()) WHERE conta_id =
   p_conta_id AND connection_id = p_connection_id AND status IN ('active', 'revoked')`; count
   via `GET DIAGNOSTICS`. A revoked unit keeps its revoke date, as in the per-unit unlink.
   History stays; the 30-day expiry in `google_expire_units` takes it, and a relink within 30
   days restores it (the link route reactivates the `disconnected` row by `location_name`).
6. End the fresh-connection grace for this workspace's row only (as
   `google_workspace_release_identities` does): `UPDATE google_connections SET authorized_at =
   now() - interval '2 hours' WHERE id = p_connection_id AND authorized_at > now() - interval
   '2 hours'`. The grace protects a picker open in this workspace, which the user is
   explicitly abandoning; another workspace's fresh row still counts as "in use".
7. `SELECT * INTO v_decision FROM _google_revoke_if_unused(v_sub)`. Unused everywhere → it
   queues a `google_revocations` row and deletes **every** row of the sub (this one plus any
   idle, non-fresh row in other workspaces, which the orphan sweep would release within the
   hour anyway). In use elsewhere → `(false, NULL)`, nothing deleted.
8. `DELETE FROM google_connections WHERE id = p_connection_id` (no-op after a revoke in step 7).
   Safe against the FKs only because of the order above: no channel references the row
   (`youtube_channels.connection_id` is `NO ACTION`, satisfied by step 4), and every unit still
   referencing it is `disconnected`, so `ON DELETE SET NULL` passes
   `gbp_locations_connection_check`. Do not reorder.
9. `RETURN QUERY SELECT v_decision.should_revoke, v_decision.revocation_id, v_yt, v_gbp`.

Defensive note: a unit or channel of another workspace cannot reference this connection (every
link route runs `connectionInTenant`). If one ever did, step 8 fails on the FK/CHECK and the whole
call rolls back (fail closed), which is the desired outcome.

Status `revoked` connections need no branch: the queued token is dead, Google answers
`invalid_token`, which `revokeGoogleToken` treats as success.

Race with the OAuth callback of the same identity in this workspace:
`google_connection_upsert` takes the same sub lock, so it runs strictly before (and this call then
disconnects the refreshed row) or after (and inserts a fresh row, a new connection). A channel
upsert from a callback already past its upsert blocks on step 3's row lock and then fails its FK;
the callback redirects with `yt_error=unknown`.

Outstanding states (external review, accepted): a connect started before the disconnect, with
Google's consent tab still open (states live 10 minutes), would otherwise reattach the account
after the user removed it. Step 3b (below, under the sub lock, after the tenant check) therefore
consumes every unconsumed Google state of this workspace:
`UPDATE oauth_states SET consumed_at = now() WHERE provider = 'google' AND conta_id =
p_conta_id::text AND consumed_at IS NULL`. `verifyGoogleState` (google-integration/oauth-state.ts)
only accepts a row with `consumed_at IS NULL`, so such a callback answers 400 "Link inválido ou
expirado" and creates nothing. States carry no Google sub (it is only known after Google answers),
so this cancels every in-progress Google connect of the workspace, for any account; the user just
starts it again. Residual window, accepted: a callback that already consumed its state before
step 3b (it is past Google, a few seconds from its upsert) still completes, and the consent-retry
state that `runCallback` mints after its own verify is new. Both are the user's own concurrent
action, not a stale tab.

Fases seguintes (drift guard): step 4 inlines today's per-channel unlink, so it must follow the
unlink when the next phases change it.
- **Phase 3** recreates `google_unlink_youtube` with the target/upload steps (YouTube targets
  marked `falha` / `youtube_not_connected`, `youtube_uploads` deleted). It must recreate
  `google_disconnect_identity` with the same steps in step 4, or (preferred) extract one internal
  per-channel helper, e.g. `_google_unlink_youtube_channel(p_conta_id, p_channel_id,
  p_client_id)` (owner-only EXECUTE like `_google_revoke_if_unused`), that both RPCs call per
  deleted channel, and keep the call to `youtube_purge_channel` inside it.
- **Phase 4** recreates `youtube_purge_channel` (layout block removal, `youtube_channel_id =
  NULL`). It must keep the `(uuid, text, bigint)` signature and the order histórico → lock → PDF
  queue → update, because this RPC calls it by that signature; a changed signature leaves this
  RPC calling a dropped overload.

### 3.2 Why deleting the row in step 8 is allowed

CLAUDE.md says: never delete a `google_connections` row outside the revocation RPC. This function
**is** a revocation RPC: it holds the sub lock, applies the §4.2 decision through
`_google_revoke_if_unused` (which writes `google_revocations` when it revokes), and only deletes
its own workspace's row when the identity stays in use elsewhere. Deleting that row without a
Google revoke is correct: the grant is legitimately held by the other workspace's row, whose own
tokens will be revoked by whichever path later finds the identity unused; the deleted copy of a
refresh token is not a leak. The privacy deadlines are kept: YouTube purge happens in step 4,
GMN units start (or keep) their 30-day clock in step 5.

Proposed CLAUDE.md wording (replace the first sentence of the Google gotcha):

> Nunca apague uma linha de `google_connections` fora das RPCs de revogação
> (`_google_revoke_if_unused` via `google_unlink_*`/`google_release_sub`, o trigger de exclusão
> de workspace e `google_disconnect_identity`): são elas que aplicam a regra do §4.2 sob o lock
> do sub e gravam `google_revocations`. `google_disconnect_identity` ("Desconectar conta" em
> Configurações > Contas conectadas) é a única que apaga a linha do workspace mesmo quando a
> identidade segue em uso em outro workspace (aí não revoga no Google).

Two more CLAUDE.md edits in the same Google gotcha (Task A):

- "Fases seguintes" bullet: name `google_disconnect_identity` next to `google_unlink_youtube`,
  e.g. "A Fase 3 recria `google_unlink_youtube` com os passos de alvo/upload e tem que manter a
  chamada de purge; `google_disconnect_identity` repete esses passos por canal (ou os dois chamam
  o mesmo helper por canal), então a Fase 3 recria as duas. A Fase 4 mantém a assinatura
  `(uuid, text, bigint)` de `youtube_purge_channel`, que `google_disconnect_identity` também chama."
- The `deadlock_detected` sentence about workspace deletion gains "desconectar conta": "Raro: uma
  exclusão de workspace concorrente com um relink, com um `invalid_grant` daquela identidade ou
  com um \"Desconectar conta\" dela pode cair em `deadlock_detected`; repetir a exclusão
  resolve." (`youtube_purge_channel`'s `audit_log` insert takes `KEY SHARE` on the workspace
  row, which the delete holds exclusively.) No code change.

## 4. Edge routes (`supabase/functions/google-integration`)

`index.ts` is unchanged (env wiring only). In `handlers.ts` dispatch, before the final 404:

```
GET  segs.length === 2 && segs[1] === "accounts"                         → handleListAccounts
POST segs.length === 4 && segs[1] === "accounts" && segs[3] === "disconnect" → handleDisconnectAccount(segs[2])
```

CORS via `deps.buildCorsHeaders(req)` (already in the dispatcher), OPTIONS already handled.
Unexpected errors go through the existing `internalServerError(createJsonResponder(cors), …)`
catch: `{ error: "internal" }`-style generic body, details only in logs.

**Plan flags do not gate either route.** Listing and removing access must always be possible,
including after a downgrade or the end of a pilot override (the client-tab sections disappear
then, so this is the only in-app path). Same rule as `handleDisconnectGbp`/`handleDisconnectYouTube`.

### 4.1 `GET /accounts`

Order: `resolveTenant` (401 `{ error: "unauthorized" }`) →
`hasPermissionFor(svc, userId, contaId, "configuracoes", "ver")` false → 403
`{ error: "forbidden" }`. No rate limit (DB reads only, same as `/summary`).

Reads (service role, all filtered by `conta_id = contaId`): `google_connections` (`id, email,
display_name, status, created_at`), `youtube_channels` (`connection_id, channel_id, title,
handle, client_id, authorization_status`), `gbp_locations` with `status IN ('active','revoked')`
(`id, connection_id, title, address_line, client_id, status`), then `clientes` (`id, nome`) for
the referenced client ids. Any read error throws (500).

200:
```json
{
  "accounts": [
    {
      "id": "uuid",
      "email": "agencia@gmail.com",
      "displayName": "Agência X",
      "status": "active",
      "connectedAt": "2026-10-30T14:02:11.000Z",
      "youtube": [
        { "channelId": "UC…", "title": "Canal", "handle": "@canal", "clientId": 42,
          "clientName": "Cliente A", "authorizationStatus": "active" }
      ],
      "gbp": [
        { "id": "uuid", "title": "Loja Centro", "addressLine": "Rua …", "clientId": 42,
          "clientName": "Cliente A", "status": "active" }
      ]
    }
  ]
}
```
Sort: accounts by email; `youtube` by clientName then title; `gbp` by title then clientName.
`displayName`, `title`, `handle`, `addressLine`, `clientName` may be null. No token, scope,
sub or `authorized_at` ever leaves the function.

### 4.2 `POST /accounts/:connectionId/disconnect`

Order:
1. `resolveTenant` → 401 `unauthorized`.
2. `hasPermissionFor(…, "configuracoes", "editar")` false → 403 `forbidden` (before any other
   read, any RPC or rate-limit slot).
3. `checkRateLimit(svc, "google-account-disconnect:" + contaId, 10, 60)` false → 429
   `rate_limited`.
4. `connectionInTenant(svc, connectionId, contaId)` (UUID check included) false → 404
   `not_found`.
5. `svc.rpc("google_disconnect_identity", { p_conta_id, p_connection_id })` (no pre-read of
   channels/units: the RPC returns the counts); error code
   `P0002` → 404 `not_found`; SQLSTATE `23514` (CHECK) or `23503` (FK) → 409
   `{ "error": "conflict" }` (a concurrent link interleaved, see §3.1 step 5; nothing was
   committed, the user retries); other error → throw (500).
6. `await processUnlinkDecisionData(svc, data)` (never throws; a failed revoke stays queued in
   `google_revocations`, retried by `gbp-sync-cron`).
7. `await drainTenantPdfPurges(svc, deps, contaId)` (YouTube report PDFs the purge queued).
8. `insertAuditLog(svc, { conta_id, actor_user_id: userId, action: "google-account-disconnect",
   resource_type: "google_connection", resource_id: connectionId, metadata: {
   youtube_channels_unlinked, gbp_locations_unlinked } })`. Never the email, the sub, or the
   revoke decision: `audit_log` is readable by owner/admin, and `should_revoke = false` would
   reveal that another workspace uses the identity.
9. 200 `{ "ok": true, "youtubeChannelsUnlinked": 2, "gbpLocationsUnlinked": 5 }`. The revoke
   decision is never returned, for the same reason. The counts are read from `data[0]` and
   coerced with `Number(row?.youtube_channels_unlinked) || 0` /
   `Number(row?.gbp_locations_unlinked) || 0` (PostgREST may hand back strings or a bare object).

Error codes in total: `unauthorized` 401, `forbidden` 403, `rate_limited` 429, `not_found` 404,
`conflict` 409, generic 500.

## 5. Permissions

- UI tab: `{ configuracoes, ver }` (agents without a custom role do not see it; their preset is
  `configuracoes: 'none'`). Button: `can('configuracoes', 'editar') === true`.
- Server: `hasPermissionFor` (`_shared/permissions.ts`, the `has_permission_for` SQL core the CRM
  `can()` mirrors; the `mcp-keys` pattern), `ver` for GET, `editar` for POST. Not
  `isWorkspaceEditor`: custom roles can grant `configuracoes:editar` and UI and server must agree.
- The existing per-client disconnect routes keep their current (membership-only) gate; out of
  scope.

## 6. Frontend

### 6.1 Service (`apps/crm/src/services/google.ts`)

```ts
export interface GoogleAccountYouTubeChannel {
  channelId: string; title: string | null; handle: string | null;
  clientId: number; clientName: string | null; authorizationStatus: 'active' | 'revoked';
}
export interface GoogleAccountGbpLocation {
  id: string; title: string | null; addressLine: string | null;
  clientId: number; clientName: string | null; status: 'active' | 'revoked';
}
export interface GoogleAccount {
  id: string; email: string; displayName: string | null; status: 'active' | 'revoked';
  connectedAt: string; youtube: GoogleAccountYouTubeChannel[]; gbp: GoogleAccountGbpLocation[];
}
export interface GoogleAccountDisconnectResult {
  ok: true; youtubeChannelsUnlinked: number; gbpLocationsUnlinked: number;
}
export async function listGoogleAccounts(): Promise<GoogleAccount[]>        // GET /accounts → .accounts
export async function disconnectGoogleAccount(connectionId: string): Promise<GoogleAccountDisconnectResult>
                                                                              // POST /accounts/:id/disconnect
```
Add `'forbidden'`, `'not_found'` and `'conflict'` to `GOOGLE_SERVICE_ERROR_CODES` (today they
collapse to `unknown`). `encodeURIComponent(connectionId)` in the path.

### 6.2 Files

- `pages/configuracao/configTabs.ts`: the entry (§2.1). Visibility: extend `visibleConfigTabs`
  with an optional `features` argument; `contas-conectadas` is listed only when
  `features?.feature_youtube === true || features?.feature_google_business === true`.
  `canAccessConfigTab` (the route guard) keeps checking permission only, so the page is always
  reachable by URL and from the client-tab link, even with both flags off (a downgraded
  workspace can still remove access). This is a deliberate, documented exception to "never
  hidden yet reachable"; update the file's comment. Reason for flag-gating the nav at all: the
  integration is still piloted, and an empty "Google" tab would advertise it to every workspace.
  `ConfiguracaoLayout.tsx` and `ConfiguracaoIndex.tsx` (phone Settings list) both pass
  `useWorkspaceLimits().features`. The tab appears once `features` loads: while it is null
  (loading) the tab is hidden; accepted (a brief pop-in, never a wrong advertisement).
  `configTabs.test.ts`'s owner/admin enumerations must pass a `features` argument too (flags on,
  so the new path is in the expected list), plus a flags-off case without it.
- `App.tsx`: lazy `ContasConectadasTab`, `<Route path="contas-conectadas" element={…} />` inside
  `/configuracao`. `vercel.json` (`configuracao(/.*)?`) and `content/site-meta.ts` (`'configuracao'`)
  already cover the path; nothing to add.
- New `pages/configuracao/tabs/ContasConectadasTab.tsx` (desktop + phone branch),
  `pages/configuracao/tabs/contas-conectadas/GoogleAccountCard.tsx` (shared by both layouts, a
  `layout: 'desktop' | 'phone'` prop), `GoogleAccountDisconnectDialog.tsx`, and
  `pages/configuracao/tabs/phone/contasConectadasPhone.css` (phone card + full-width button).
  Desktop styling with Tailwind/shadcn (`Card`, `Badge`, `Button`, `AlertDialog`); no new
  `app.css` rules unless needed (if added, `app.css`, since only the signed-in shell renders it).
- `pages/cliente-detalhe/components/PlatformActions.tsx`: `disconnectLabel` prop (§2.3).
- `pages/cliente-detalhe/GoogleBusinessSection.tsx`, `YouTubeSection.tsx`: account line (YouTube),
  "Gerenciar contas" link, `disconnectLabel={t('google.disconnectFromClient')}`.

### 6.3 Query keys

- New: `['googleAccounts']` (`listGoogleAccounts`, `staleTime: 30_000`). Workspace switches already
  call `queryClient.clear()`, so the key needs no `conta_id`.
- After a successful disconnect, invalidate by prefix: `['googleAccounts']`, `['googleSummary']`,
  `['youtube-portfolio']`, `['gbp-portfolio']`, `['gbpLocationOptions']`; and with a predicate
  every query whose `queryKey[0]` is one of `yt-overview`, `yt-daily`, `yt-traffic`,
  `yt-demographics`, `yt-videos`, `yt-top-shorts`, `gbp-overview`, `gbp-daily`, `gbp-surfaces`,
  `gbp-keywords`, `gbp-reviews`, `gbp-rating-distribution`, `gbp-units`. Export that list as one
  constant (`GOOGLE_DATA_QUERY_PREFIXES`) from `services/google.ts` so a new tab key is added in
  one place.
- On `not_found` from the disconnect (already done): invalidate `['googleAccounts']` only.
- On `conflict`: no invalidation (nothing committed).

### 6.4 i18n (`packages/i18n/locales/{pt,en}`)

`settings.json`:
- `tabs.contasConectadas`: "Contas conectadas" / "Connected accounts"
- `connectedAccounts.*`: `title`, `subtitle` ("Contas de outras plataformas usadas por este
  workspace." / "Accounts from other platforms used by this workspace."), `googleHeading`,
  `connectedAt` ("Conectada em {{date}}"), `statusActive` ("Ativa"), `statusRevoked` ("Precisa
  reconectar"), `youtubeCount_one|_other` ("YouTube · {{count}} canal" / "YouTube · {{count}}
  canais"), `gbpCount_one|_other` ("Google Meu Negócio · {{count}} unidade|unidades"),
  `unitLine` ("{{title}} ({{client}})"), `moreUnits_one|_other` ("+ {{count}} unidade|unidades"),
  `showLess` ("Mostrar menos"), `emptyHint`, `empty`, `loadError`, `retry`, `disconnectButton`,
  `dialog.title` ("Desconectar {{email}}?"), `dialog.unlinks` ("Isso desvincula:"),
  `dialog.nothingLinked`, `dialog.youtubeData`, `dialog.gbpHistory`, `dialog.revoke`,
  `dialog.otherWorkspaces`, `dialog.cancel`, `dialog.confirm`, `success`, `errors.notFound`,
  `alreadyDisconnected` ("Essa conta Google já tinha sido desconectada."), `errors.conflict`,
  `errors.forbidden`, `errors.rateLimited`, `errors.generic`. pt text exactly as quoted in §2;
  en translated, same plural keys.
- `ConfiguracaoIndex` reads `tabs.contasConectadas` like every tab.

`clients.json` (`google` is a **new top-level block**, in both pt and en; `gmn` and `youtube`
stay as they are):
- `google.manageAccounts`: "Gerenciar contas" / "Manage accounts"
- `google.disconnectFromClient`: "Desconectar deste cliente" / "Disconnect from this client"
- `youtube.account`: "Conta Google: {{email}}" / "Google account: {{email}}"

Run the existing `packages/i18n/__tests__/locales.test.ts` (pt/en key parity) and grep both files
for `—` before committing.

## 7. Tests

**psql** — new `supabase/tests/entitlements/99_google_disconnect_identity.sql` (the CI glob;
reuse `99_google_purge_rpcs.sql`'s seed style, RPCs as `service_role`):
1. Foreign connection id (workspace B's row called with A) → `P0002`, nothing changed.
2. Zero units, connection older than 1 h, sub unused elsewhere → `should_revoke = true`, one
   `google_revocations` row, the row gone.
3. Zero units but `authorized_at = now()` (fresh) → still revoked (grace bypassed for own row).
4. A has 2 channels + 3 units (one `revoked`, one already `disconnected`) on the connection;
   sub unused elsewhere → channels deleted, `youtube_*` history purged, PDF queued for a report
   with a `youtube` snapshot, the 2 active/revoked units `disconnected` with the revoked one's
   `disconnected_at` unchanged, all 3 units now `connection_id IS NULL`, counts `(2, 2)`.
5. Same sub also connected in B with a linked unit → A's channels/units handled as in 4, A's row
   gone, `should_revoke = false`, no `google_revocations` row, B's row and unit untouched.
6. Same sub in B with a fresh (< 1 h) idle row → not revoked, A's row gone, B's row kept.
7. Same sub in B with an idle row older than 1 h → revoked, both rows gone.
8. `status = 'revoked'` connection with revoked channel + revoked unit → handled like 4, revoke
   queued.
9. Second call after success → `P0002` (row gone).
10. `EXECUTE` denied to `authenticated` and `anon`.
11. Outstanding states: workspace A has an unconsumed, unexpired `provider = 'google'` state and
    workspace B has one too → after A's disconnect, A's state has `consumed_at` set and B's is
    still NULL; a non-Google state of A (`provider = 'tiktok'`) is untouched.
12. Unit rows locked: after the call, A's `disconnected` unit that pointed at the connection has
    `connection_id IS NULL`, and an attempt (as postgres, same transaction after the call) to set
    it back to `status = 'active'` on the deleted connection id fails with `23503`. The real
    two-session interleaving is not testable in a single psql script; the Deno 409 test covers
    the route mapping.

**Deno** — `supabase/functions/__tests__/google-integration-routes_test.ts` (mock
`has_permission_for`, `check_rate_limit`, `google_disconnect_identity` by name). `routeDb()`
relies on the mock's default RPC answer being truthy, so `has_permission_for` passes in the
happy-path fixtures without queuing; the 403 cases must `db.queueRpc("has_permission_for",
{ data: false })` explicitly. These routes take no `clientId`, so build a tenant-only fixture
(profiles + workspace_members, no `clientes` queue) instead of reusing `routeDb()` as is:
- `accounts_list_shape`: grouping per connection, `disconnected` units excluded by the query
  filter, client names joined, sort order, no token/sub fields.
- `accounts_list_forbidden`: `has_permission_for` false → 403, no table read.
- `accounts_list_flags_off`: works with both flags off (no `effective_plan_feature` call).
- `accounts_disconnect_forbidden`: `editar` false → 403, no rate-limit slot, no RPC.
- `accounts_disconnect_rate_limited` → 429, no RPC.
- `accounts_disconnect_foreign_or_bad_id` → 404 (`connectionInTenant`), no RPC; RPC `P0002` → 404.
- `accounts_disconnect_revokes_after_commit`: `should_revoke` true → revoke fetch once, queue row
  deleted; revoke HTTP 500 → still 200, `attempts` bumped.
- `accounts_disconnect_no_revoke`: `should_revoke` false → no revoke fetch, body has no revoke
  field, audit metadata has only the two counts.
- `accounts_disconnect_drains_pdfs`: the injected `storage` sees the queued path removed.
- `accounts_disconnect_unexpected_error`: RPC error other than P0002/23514/23503 → generic 500.
- `accounts_disconnect_conflict`: RPC error code `23514`, and separately `23503` → 409
  `{ error: "conflict" }`, no revoke, no drain, no audit row.
- `accounts_disconnect_counts_coerced`: RPC returns `[{ …, youtube_channels_unlinked: "2",
  gbp_locations_unlinked: null }]` → body counts `2` and `0`.

Every disconnect fixture queues `google_disconnect_identity` **by name**
(`db.queueRpc("google_disconnect_identity", { data: [{ should_revoke, revocation_id,
youtube_channels_unlinked, gbp_locations_unlinked }] })` or `{ error: { code } }`): the mock's
unqueued rpc answers `{ data: true }`, which would silently pass as a malformed decision.

**Vitest**
- `pages/configuracao/__tests__/configTabs.test.ts`: add the path to every enumerated array;
  visibility with flags on/off and with `features` null (hidden); `canAccessConfigTab` ignores
  flags; owner/admin enumerations pass `features`.
- `pages/configuracao/tabs/__tests__/ContasConectadasTab.test.tsx`: renders cards, counts and
  plurals, first 3 units + "+ N unidades" expand, revoked pill, empty-connection hint, empty
  state, error + retry, button hidden without `configuracoes:editar`.
- `ContasConectadasTab.phone.test.tsx`: phone branch renders `ConfigPhoneScreen` and the
  full-width button.
- `GoogleAccountDisconnectDialog.test.tsx`: lists channels/units, note always present, confirm
  calls the service once, success toast + invalidations (spy on `invalidateQueries`), each error
  code's toast, dialog stays open while pending; 404 closes the dialog with the "já tinha sido
  desconectada" toast and invalidates only `['googleAccounts']`; 409 keeps it open with the retry toast.
- `pages/cliente-detalhe/__tests__/YouTubeSection.test.tsx` and `GoogleBusinessSection.test.tsx`:
  "Gerenciar contas" link target and its permission gating, "Desconectar deste cliente" label,
  YouTube account line shown/hidden on `connectionEmail`.
- A `PlatformActions` default-label assertion so TikTok keeps "Desconectar".

## 8. Copy correction to the approved mockup

The mockup's empty-connection hint ("Uma conta sem nada vinculado continua guardada para a
próxima conexão não pedir autorização de novo. Desconecte para apagar o acesso.") restates the
Phase 1 §4.2 text, which Phase 2 changed: `gbp-sync-cron` runs `google_orphan_subs` +
`google_release_sub` every hour, so an identity with nothing linked anywhere is revoked and its
rows deleted once the 1-hour grace ends. An idle row survives only while another workspace still
uses the identity, which the UI must not reveal. The spec therefore uses "Nada vinculado a esta
conta. Desconecte para apagar o acesso dela neste workspace.", accurate in both cases.

## 9. Deploy order and rollback

1. Migration `20261116000001` (staging, then prod). Additive: one new function, nothing existing
   changes, so it is safe ahead of any code.
2. `google-integration` with `--no-verify-jwt` (staging, then prod). Old CRM never calls the new
   routes, so this is safe before the merge. Deploying it before the migration makes the new
   POST answer 500 (function missing); GET works.
3. Merge (Vercel deploys the CRM). No other function imports change.

Rollback: frontend first (revert/instant rollback hides the tab and link; nothing persisted by the
UI). Then, if needed, redeploy the previous `google-integration` (the routes 404). The RPC can stay;
dropping it needs a migration and is unnecessary. Disconnects already done are final by design
(rows deleted, YouTube purged, revocations queued); nothing to restore.

## 10. Out of scope

- Instagram and TikTok on the "Contas conectadas" page (the page is structured with a per-provider
  section so they can be added later).
- "Conectada por <name>" (needs a creator column on `google_connections`).
- Changing the gate of the per-client disconnect routes.
- Reconnecting from the Settings tab (reconnect stays on the client tabs, where the product and
  client are known).

## 11. Task split

### Shared API contract (both tasks build against this, nothing else)

- `GET {FN}/google-integration/accounts` → 200 `{ accounts: GoogleAccount[] }` (shape §4.1, types
  §6.1). Errors: 401 `unauthorized`, 403 `forbidden`, 500.
- `POST {FN}/google-integration/accounts/:connectionId/disconnect` (no body) → 200
  `{ ok: true, youtubeChannelsUnlinked: number, gbpLocationsUnlinked: number }` (always numbers).
  Errors: 401 `unauthorized`, 403 `forbidden`, 404 `not_found` (connection already gone: the UI
  treats it as done), 409 `conflict` (concurrent link, nothing committed: the UI offers a retry),
  429 `rate_limited`, 500. Never returns whether the grant was revoked at Google.
- Gates: GET needs `configuracoes:ver`, POST `configuracoes:editar`; no plan-flag gate.

### Task A: backend

Migration `20261116000001_google_disconnect_identity.sql` with `google_disconnect_identity`
(§3: P0002 in steps 1 and 3, step 3b state consumption, step 5's unit-row lock over all
statuses); `handlers.ts` routes + dispatch (§4, including the 23514/23503 → 409 `conflict`
mapping and the `Number(...) || 0` count coercion); psql suite `99_google_disconnect_identity.sql`
(cases 1-12) and the Deno route tests (§7, every disconnect fixture queuing the RPC by name);
header comment of the migration documents the steps, the "Fases seguintes" drift rule and the
CLAUDE.md rule; CLAUDE.md edits (§3.2: the deletion rule, the "Fases seguintes" bullet naming
`google_disconnect_identity`, the `deadlock_detected` sentence) plus the deploy-order line (§9). Verify with
`npm run check:functions`, `npm run test:functions`, `bash scripts/test-entitlements.sh` (local
Supabase), `npm run lint`.

### Task B: frontend

`services/google.ts` additions (§6.1); `configTabs.ts`, `ConfiguracaoLayout.tsx`,
`ConfiguracaoIndex.tsx`, `App.tsx`; the tab (desktop + phone), card and dialog; `PlatformActions`
prop; client-tab changes; i18n pt/en (§6.4, new `google` block in `clients.json`); error
handling for 404 as already done and 409 as retry (§2.2, §6.3); `visibleConfigTabs` `features`
argument passed by the layout, `ConfiguracaoIndex` and `configTabs.test.ts`; Vitest (§7). Build against the contract with
`fetch` mocked; verify in the browser against staging only after Task A is deployed there.
Verify with the five `tsc` commands, `npm run test`, `npm run lint`, `npm run format:check`.
