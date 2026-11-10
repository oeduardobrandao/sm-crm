# Hub: contas conectadas (Instagram + TikTok)

Date: 2026-11-10
Status: design, awaiting review
Mockups (approved, option A): https://claude.ai/artifact/8GQVPWQS3tnMgYYCV5XvVU

## Intent

The client Hub shows performance numbers for Instagram only, in a "Desempenho" section at the
very bottom of Início. Clients whose agency also runs their TikTok see nothing about it, and
no client can tell at a glance whether their accounts are connected or how fresh the numbers
are. An expired connection is invisible: `hub-dashboard` ignores `authorization_status`, so
the Hub keeps showing stale numbers with no warning.

This change gives the client a live read of each connected account: is it connected, how many
followers, how is it moving, when was it last updated. It adds TikTok next to Instagram
everywhere the Hub shows performance.

## Goals

1. A "Contas conectadas" strip on Início with one card per connected account (Instagram,
   TikTok): handle, connection status, followers, change over 30 days, three headline numbers,
   and the age of the last sync.
2. "Desempenho" works per platform: a switch between Instagram and TikTok, with TikTok's own
   top videos and charts.
3. An expired or revoked connection is visible to the client, with the last known number and
   a line telling them to talk to the agency.
4. TikTok numbers are as fresh as Instagram's: the TikTok sync moves from once a day to the
   same hourly cron + 6 hour staleness window Instagram uses.

## Non-goals

- Connecting or reconnecting an account from the Hub. The Hub only reports status. (Decided
  2026-11-10; a possible follow-up.)
- Fetching numbers from Instagram or TikTok when the Hub opens. "Live" means the age of the
  last sync. (Decided 2026-11-10.)
- YouTube and Google Meu Negócio in the Hub.
- Changing what the Instagram tab of Desempenho shows (top posts, the two charts, their
  metrics and windows stay as they are).
- Any CRM change, and any new notification to the agency when a connection expires.
- A new Hub page or nav item.

## Anti-goals

- A "live" or pulsing realtime indicator. The data is synced, not streamed; the UI says
  "Atualizado há 2 h".
- Platform brand colours. The Hub is whitelabel and its charts are monochrome ink; platforms
  are told apart by icon and name.
- "vs. período anterior" on TikTok summed counts (views, likes, comments, shares). Those are
  lifetime totals of the videos posted in the window, so an older window always looks better.
  `_shared/tiktok-analytics/kpis.ts` returns `prev: null` for them on purpose.
- Numbers the data cannot back: TikTok has no reach, impressions or saves.
- Nagging a client about a platform they do not use (see "Which accounts appear").

## What the client sees

All copy is pt-BR with an English translation, in the `hubHome` i18n namespace
(`packages/i18n/locales/{pt,en}/hubHome.json`). No em dashes in copy.

### Which accounts appear

For each platform, the account is in one of three situations:

| Situation | Rule | In the Hub |
| --- | --- | --- |
| Connected | Row exists, status `active` (Instagram: and `token_expires_at` is null or in the future) | Card, "Conectada" |
| Needs reconnection | Status `revoked` or `expired`; Instagram also when `token_expires_at` is in the past | Card, "Reconexão necessária" |
| Not shown | No row, or status `disconnected` | Nothing for that platform |

The rules are tested in this order: `disconnected` first, then needs reconnection, then
connected. Disconnecting an Instagram account sets its `token_expires_at` to epoch 0
(`instagram-integration/disconnect.ts`), so testing token expiry first would show every
disconnected account as "Reconexão necessária".

TikTok additionally requires the workspace to have `feature_tiktok` (checked with
`effectivePlanFeature`, failing closed like `hub-bootstrap` does). Without it TikTok is never
shown, whatever the row says.

A platform with no account shows nothing: no "connect TikTok" placeholder. *(Claude's call.
The mockup's states board drew a dashed "Não conectada" card as state 2; it is dropped so a
client who does not use TikTok is not told on every visit that something is missing.)*

When no platform has a card, the strip is not rendered at all, and Desempenho keeps today's
empty card ("Conecte o Instagram para ver métricas de desempenho.") unchanged.

### The strip: "Contas conectadas"

Heading "Contas conectadas", subtitle "Seus números, atualizados automaticamente ao longo do
dia". Below it, one card per account, Instagram first, then TikTok. Two accounts sit side by
side; a single account takes the full width in a horizontal layout (mockup "Estados", state 4).

Position on Início (classic look):

- From the Hub's `md` breakpoint up (768px, where the sidebar appears): right after the KPI
  cards, before the pending-approvals banner.
- Below `md`: right after the greeting, above the KPI cards. The KPI grid collapses to one
  column on phones, so under the KPIs the strip would sit about 800px down. With two accounts
  the cards are a horizontal snap carousel (first card about 86% wide, the second peeking),
  with pagination dots, the same pattern `TopPostsRow` uses (its mobile dots and
  `activeIndex` tracking, `TopPostsRow.tsx` from the "Pagination dots" block).

Pauta look (`feature_hub_pauta`): the strip goes right after `PautaKpiStrip` at every width.
That strip is two columns on phones (`grid-cols-2 sm:grid-cols-4`), so it never pushes the
accounts far down and no reordering is needed. Same component, no section number. *(Claude's
call: the mockups only cover the classic look.)*

A connected card shows:

- Platform icon (lucide `Instagram`; lucide `Music2` for TikTok, the convention of
  `packages/report-blocks/PlatformIcon.tsx`), platform name, `@username`.
- Pill "Conectada" with a green dot. The label carries the meaning; the dot only reinforces it.
- Follower count in the display font, the word "seguidores", and the change (see "Follower
  change").
- Three numbers:
  - Instagram: "Alcance, 28 dias" (`reach_28d`), "Visualizações, 28 dias" (`impressions_28d`),
    "Publicações" (`media_count`).
  - TikTok: "Visualizações, 30 dias" (sum of views of the videos posted in the last 30 days),
    "Curtidas no total" (`likes_count`), "Vídeos" (`video_count`).
- Footer: sync age on the left, "Ver desempenho" on the right. The link scrolls to Desempenho
  and selects that platform.

Sync age, from `last_synced_at`:

| Age | Text |
| --- | --- |
| under 1 hour | "Atualizado há {{n}} min" |
| under 24 hours | "Atualizado há {{n}} h" |
| older | "Atualizado em {{dd/mm}}" |
| never synced | "Aguardando a primeira atualização" |

A needs-reconnection card shows:

- Same header, with the pill "Reconexão necessária" (the existing `hub-pill-danger`, with a
  warning icon).
- The last known follower count, muted, followed by "seguidores em {{dd/mm}}" (the date of
  `last_synced_at`). No change figure and no three-number row.
- A soft box: "Os números pararam de atualizar em {{dd/mm}}. Fale com a sua agência para
  reconectar a conta." If the account never synced: "Os números não estão sendo atualizados.
  Fale com a sua agência para reconectar a conta."
- Footer: "Última atualização em {{dd/mm}}" and the link "Ver histórico" (same behaviour as
  "Ver desempenho").

### Follower change

The change is always over a fixed 30-day window, whatever period is selected in Desempenho.
It is the last observed follower point minus the first observed point in that window, and it
needs at least two points; with fewer, no change is shown.

- When the first point used is at the start of the window (within one day of it): "+312 em 30
  dias".
- When the history starts later: "+84 desde 30/10" (the date of the first point used).
- Negative changes are shown with a minus sign in the neutral text colour, never red. Zero is
  "Sem variação em 30 dias" (or "desde {{dd/mm}}").

Instagram only counts points dated on or after the day the account was first connected: the
UTC date of `instagram_accounts.created_at`, because `instagram_follower_history.date` is a
UTC day. (`created_at` is the first connection: a reconnect updates the same row.) Follower
history from before the connection is reconstructed from gross follows and overstates growth;
that is a known, accepted property of the stored data, and this headline number must not
inherit it. *(Claude's call.)* Known limit, accepted: the one-off backfill can also rewrite
the first days after the connection if its first run comes late; the effect is small and
leaves the 30-day window on its own. TikTok history only ever contains observed points, so no
such filter is needed.

### Desempenho

The section keeps its place at the end of Início and its title.

- **Platform switch.** A segmented control "Instagram | TikTok" (icon + name), shown only
  when two accounts have cards. With one account there is no switch and the section shows
  that platform. Default: the first account with a card (Instagram before TikTok).
- **Period selector** 30d / 60d / 90d: unchanged, applies to the selected platform.
- **Account line** under the header: `@username`, the status pill, and the sync age on the
  right. For an account that needs reconnection the pill is "Reconexão necessária" and the
  right side reads "Última atualização em {{dd/mm}}"; the stored data is still shown.
- **Instagram selected:** exactly today's content.
- **TikTok selected:**
  - "Melhores vídeos": up to five cards, ranked by views, among the videos posted in the
    period. Each card: cover image (vertical), a duration tag (m:ss), then Visualizações,
    Engajamento (likes + comments + shares over views, one decimal) and Compartilhamentos. The
    card links to the video's `share_url` in a new tab. On phones the row is a snap carousel
    with cards about 46% wide, because the covers are vertical. Empty: "Nenhum vídeo no
    período selecionado."
  - Chart "Seguidores": the existing follower chart, fed TikTok's observed points. When the
    first point is more than one day later than the start of the period, a caption under the
    chart reads "Histórico disponível desde {{dd/mm}}." The copy does not say why: the gap is
    usually the connection date, but it can also be a stretch without syncs, and the response
    cannot tell the two apart. (The mockup's "quando o TikTok foi conectado" is dropped.)
  - Chart "Visualizações por dia de postagem": bars, one per day that has videos, value = sum
    of the views of the videos posted that day. Caption: "Soma das visualizações dos vídeos
    publicados em cada dia."

### Look

Hub classic look, built only from the existing `hub-*` tokens and classes (`hub-card`,
`hub-pill`, `hub-pill-neutral`, `hub-pill-danger`, the text ramp), so the whitelabel presets
(surface, radius, card style, fonts) and dark mode apply without extra work. Tailwind variants
do not work on `hub-*` classes. The mockups are the visual reference for spacing and
hierarchy; boards: Início desktop, Desempenho with TikTok selected, phone, states, dark.

## Data contract: `hub-dashboard`

One function keeps serving the whole section. *(Claude's call: no new edge function.)* The
change is additive: a Hub bundle from before this change keeps working against the new
function.

Request: `GET hub-dashboard?token=…&period=30|60|90&platform=instagram|tiktok`. `platform` is
optional. Missing or unknown means "the default platform": the first account that has a card
(Instagram before TikTok), or `instagram` when none has. So a TikTok-only client gets TikTok
detail from the plain request, and the Hub needs one request on first load in every case. A
Hub bundle from before this change never sends `platform`; for a TikTok-only client it keeps
receiving `account: null` and empty Instagram arrays, as today, and ignores the rest.

Response:

```ts
interface HubDashboardResponse {
  // Unchanged. Instagram detail when the resolved platform is instagram; empty/null when it is tiktok.
  topPosts: DashboardTopPost[];
  followerHistory: DashboardFollowerEntry[];
  reachHistory: DashboardReachEntry[];
  account: DashboardAccount | null;
  period: number;

  // New. Always present. The platform the detail in this response is for (the resolved one).
  platform: 'instagram' | 'tiktok';
  /** Only the accounts that get a card, Instagram first. Empty when none. */
  accounts: HubAccountSummary[];

  // New. Only when the resolved platform is tiktok AND the TikTok account has a card.
  tiktok?: {
    topVideos: DashboardTopVideo[];
    followerHistory: DashboardFollowerEntry[];
    viewsHistory: { date: string; views: number }[];
  };
}

interface HubAccountSummary {
  platform: 'instagram' | 'tiktok';
  state: 'connected' | 'needs_reconnect';
  username: string | null;
  followerCount: number | null;
  /** Fixed 30-day window. null with fewer than two usable points. */
  followersDelta: { value: number; since: string; fullWindow: boolean } | null;
  lastSyncedAt: string | null;
  /** Present for the matching platform only. */
  instagram?: { reach28d: number | null; impressions28d: number | null; mediaCount: number | null };
  tiktok?: { views30d: number; likesTotal: number | null; videoCount: number | null };
}

interface DashboardTopVideo {
  id: string;
  coverUrl: string | null;
  shareUrl: string | null;
  postedAt: string | null;
  durationSeconds: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** One decimal; null when the video has no views. */
  engagementRate: number | null;
}
```

Rules:

- `accounts` follows the table in "Which accounts appear". The summary is computed on every
  request, whatever `platform` and `period` are.
- A `disconnected` Instagram row now answers like a missing row (`account: null`, empty
  arrays). Today it is served as if connected; after a disconnect the token and synced posts
  are gone, so this only removes stale numbers.
- An Instagram account that needs reconnection still gets its detail (history stays visible).
  The live Graph call that refreshes top-post thumbnails is skipped for it.
- TikTok detail uses the shared readers in `_shared/tiktok-analytics/` (`loadTikTokAccount`,
  `loadVideosInWindow`, `loadFollowerHistory`, `windowFromDays`, `videoEngagementRate`) and
  their São Paulo-day windows, so the Hub and the CRM's TikTok tab agree. Never select the
  encrypted token columns: use `TIKTOK_ACCOUNT_COLUMNS`.
- `topVideos`: videos posted in the window with views above zero, most viewed first, ties
  broken by newest, at most five.
- `tiktok.views30d`: sum of views of the videos posted in the last 30 days (same window
  helper, 30 days).
- An explicit `platform=tiktok` when TikTok has no card: answer 200 with `platform: 'tiktok'`,
  `accounts` as usual, and no `tiktok` block. The frontend falls back to the first account.
- Token resolution, the bad-token throttle, the `hub-read` rate limit, CORS and the generic
  error messages stay exactly as they are. The function still checks nothing but the Hub
  token for tenancy: every query is keyed by the token's `cliente_id`.

## TikTok sync cadence

Today `tiktok-sync-cron` runs once a day (`30 6 * * *`) and syncs every active account that
is more than 6 hours stale, with no batch limit and no attempt tracking. It moves to the
Instagram model:

- **Schedule:** hourly, `30 * * * *`.
- **Eligibility:** `authorization_status = 'active'`, `auto_sync_enabled`, last successful
  sync null or more than 6 hours ago, **and** last attempt null or more than 6 hours ago. The
  second condition keeps a permanently failing account to four attempts (and failure reports)
  a day instead of one per hourly run. *(Claude's call.)*
- **Attempt tracking:** a new column `tiktok_accounts.last_sync_attempt_at timestamptz`,
  stamped for the whole selected batch before any work starts. The stamp is also the claim:
  one `UPDATE … WHERE id IN (batch) AND (last_sync_attempt_at IS NULL OR last_sync_attempt_at <
  six hours ago) RETURNING id`, and only the returned accounts are processed. Two invocations
  that selected the same rows (a manual run next to the scheduled one) therefore cannot both
  sync an account. The schedule alone cannot overlap: runs are an hour apart and an edge
  function lives minutes at most.
- **Order and limit:** least recently attempted first (nulls first, `id` as tie-break), the
  workspace filters (`feature_auto_sync_cron`, `feature_tiktok`, not internal) applied before
  the limit, paging through candidates until the batch fills. Ordering, filtering and paging
  are what `instagram-sync-cron/select.ts` already does: reuse `collectSyncCandidates` as is
  (its `resolveAllowedWorkspaces` can require both flags; `runPool` is already imported from
  that function). The attempt gate is new and TikTok-only: it goes in TikTok's own
  `fetchPage` query. Instagram's eligibility is not changed.
- **Dials:** the batch limit and concurrency read the existing `SYNC_BATCH_LIMIT` (default 25)
  and `SYNC_CONCURRENCY` (default 5) secrets, so one pair of dials moves both crons. *(Claude's
  call.)* At the default that is `6 × 25 = 150` TikTok accounts before data starts aging past
  the window. Display API limits are 600 requests a minute per endpoint, far above this.
- The webhook-event purge keeps running on every invocation.
- The header comments in `core.ts` and the env section of `CLAUDE.md` are updated to say the
  dials and the 6 hour model apply to TikTok too.

Workspaces without `feature_auto_sync_cron` are still not synced by the cron. Their cards
show an honest, older "Atualizado em dd/mm".

## Frontend structure

Left to the builder, within these constraints:

- The requested platform is part of the query identity. Today's key is
  `['hub-dashboard', token, period]`; it becomes `['hub-dashboard', token, period, platform]`
  where `platform` is `'default'` for a request without the parameter. Without this a TikTok
  response would be reused as Instagram after a switch.
- The strip and Desempenho's first view share one network request on first load: both use the
  `(30, 'default')` key, since both render on Início. Desempenho keeps the `'default'` key
  until the client picks a platform, and reads which platform it got from the response's
  `platform`.
- A response without `accounts` (new bundle against the old function during the deploy
  window) hides the strip and makes Desempenho behave exactly as today.
- Strip loading: a skeleton the height of the cards; on error or with no accounts it
  collapses to nothing (Desempenho already returns `null` on error).
- "Ver desempenho" selects the platform and scrolls the section into view, honouring
  `prefers-reduced-motion`. `html, body, #root` are pinned to `overflow-x: hidden`, which
  breaks `position: sticky` and can leave `window.scrollY` at 0: verify the scroll in a real
  browser.
- The phone ordering is a media-query behaviour; jsdom cannot evaluate it, so it is verified
  in a browser, not in a unit test.
- New numbers use one locale-aware compact formatter ("48,2 mil", "12.480"). `TopPostsRow`
  may be moved to it so both tabs of Desempenho match; update its tests if so.
- chart.js stays in the lazily loaded chunk (`DashboardCharts`); the strip must not import it.
- External links go through `sanitizeExternalUrl`.

## Testing

- Deno (`supabase/functions/__tests__/hub-dashboard_test.ts`): the summary for each state of
  each platform; TikTok hidden without `feature_tiktok` and when the entitlement lookup
  throws; `disconnected` rows absent; the follower-change rules (full window, later start,
  fewer than two points, Instagram's connection-date filter); `platform=tiktok` detail and its
  fallback; the default platform for a request without `platform` (Instagram client: legacy
  keys unchanged; TikTok-only client: `tiktok` block present, legacy keys empty); token
  columns never selected.
- Deno (`tiktok-sync-cron_test.ts`) also covers the claim: an account whose stamp another
  run already advanced is not processed.
- Deno (`tiktok-sync-cron_test.ts`): eligibility with the attempt gate, ordering, the limit
  applied after the workspace filters, the batch stamped before work, a failing account not
  blocking the rest.
- Vitest (Hub): the strip in each state, one account vs two, hidden when there are none or the
  response has no `accounts`; the platform switch only with two accounts; the fallback when
  TikTok detail is missing; TikTok cards and the "Histórico disponível desde" caption; both i18n
  languages have every new key. Existing tests that build a `hub-dashboard` response need the
  new fields: grep both `__tests__` trees.
- Browser: classic and Pauta looks, phone order and carousel, dark mode, a whitelabel accent,
  the scroll from a card to Desempenho.

No new table, policy, route or scope: the access-by-client drift suite, `vercel.json` and the
MCP are untouched.

## Deploy order and rollback

1. Migration (new unique version above main's tail at PR time): add
   `tiktok_accounts.last_sync_attempt_at` and reschedule the pg_cron job to `30 * * * *`
   (same idempotent unschedule + schedule block and vault subselect form as
   `20260720000007`). Safe with the old function: it just runs hourly.
2. Deploy `tiktok-sync-cron` (`--no-verify-jwt`). It selects the new column, so never before
   step 1.
3. Deploy `hub-dashboard` (`--no-verify-jwt`). Additive; an old Hub bundle ignores the new
   keys.
4. Merge (the Hub frontend deploys on merge).

Rollback: frontend first. The functions and the column can stay. To return TikTok to a daily
sync, reschedule the job with SQL; nothing else depends on the cadence.

## Decisions on record

Decided by Eduardo on 2026-11-10: option A (cards under the KPIs + platform switch in
Desempenho); freshness = sync age, with TikTok moved to the hourly model; strip above the KPIs
on phones; the client sees the expired state; connecting from the Hub is out of scope.

Claude's calls, to confirm while reviewing:

1. A platform with no account shows nothing (no "Não conectada" placeholder card).
2. Instagram's follower change ignores history from before the connection date.
3. Instagram counts as needing reconnection when its token has expired, not only when the
   status says so.
4. One endpoint with a `platform` parameter rather than a new function.
5. A failing TikTok account is retried every 6 hours, not every hour.
6. TikTok's cron shares the `SYNC_BATCH_LIMIT` and `SYNC_CONCURRENCY` dials with Instagram's.
7. In the Pauta look the strip follows the KPI strip, without a section number.
8. The follower chart's caption is the neutral "Histórico disponível desde dd/mm", without
   "quando o TikTok foi conectado".
