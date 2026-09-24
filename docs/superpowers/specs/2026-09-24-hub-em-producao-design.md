# Hub: posts "Em produção" entre aprovações + aba "Texto do post"

Date: 2026-09-24
Status: design approved, pending spec review

## Problem

In a fluxo with two `aprovacao_cliente` etapas (e.g. "Aprovação dupla (texto + arte)"),
completing the first approval etapa re-arms the cycle: `resetApprovedPostsForNextCycle`
(`apps/crm/src/store/posts.ts:1291`, called from `completeEtapaWithRearm`,
`apps/crm/src/store/workflows.ts:423`) moves every `aprovado_cliente` post back to
`rascunho`. Individual post processes do the same in SQL
(`transition_post_process`, `supabase/migrations/20260919000005_transition_post_process.sql:194`).

The Hub hides `rascunho` / `revisao_interna` / `aprovado_interno`
(`apps/hub/src/lib/postView.ts:5` `VISIBLE_STATUSES`), so the post the client just approved
disappears until the agency sends it again. Clients complain.

A second, related gap: once media is attached, the Hub post dialog switches from the text
layout (full `conteudo` + Instagram caption) to the media layout, which shows only the
derived caption. The full post text (slide script, notes) the client approved is no longer
visible anywhere.

## Decisions

- **No setting.** The behaviour is read-only, so it applies to every workspace and client.
- **The re-arm stays.** Client approval is stored only as post status; the reset to
  `rascunho` is what lets the second approval etapa work. No DB status changes, no CRM
  change, no migration.
- **"Em produção" is a presentational Hub state**, like the existing `publicando`: computed,
  never stored.
- Colour: purple `#8b5cf6`. Label: "Em produção".
- The "Texto do post" tab appears on **every** media post with text beyond the caption, not
  only on posts in a two-approval cycle.

## Design

### 1. Signal: `em_producao` (server, `hub-posts`)

```
em_producao = status ∈ {rascunho, revisao_interna, aprovado_interno}
              AND the post has at least one post_status_events row with to_status = 'aprovado_cliente'
```

Source: `post_status_events`, not `post_approvals`. The CRM's "aprovar internamente"
(`approvePostsInternally`, `posts.ts:1276`) flips status to `aprovado_cliente` without writing
`post_approvals`. The status trigger records it in `post_status_events`, so both the client's
approval in the Hub and an approval on the client's behalf count. `post_status_events` exists
since 2026-08-05. Posts approved before that and still sitting in rascunho today stay hidden,
which is acceptable.

`hub-posts` (GET list) runs one extra query:
`post_status_events.select('post_id').in('post_id', internalPostIds).eq('to_status', 'aprovado_cliente')`.
It is limited to the posts currently in an internal status, and the result becomes a Set.
Every post in the response gets `em_producao: boolean`. On query error: log, and treat all as
`false` (fail closed = today's behaviour).

The client can see nothing new that wasn't already in the payload. `hub-posts` already returns
every post of the client, including drafts; the Hub filtered them only on the frontend.

### 2. Hub visibility

Model it through `getPostPublishState`. When `post.em_producao` is true (and status is
internal) it returns `'em_producao'`. Add:

- `STATUS_COLORS.em_producao = '#8b5cf6'`
- `getClientStatusLabel` / `CLIENT_STATUS_LABELS`: `em_producao` → "Em produção"
- `isClientVisible(post)` helper: `VISIBLE_STATUSES.has(post.status) || post.em_producao === true`.
  A missing field means `false`, which makes the deploy window safe.

Sites to switch from `VISIBLE_STATUSES.has(p.status)` to the helper:

| Site | Behaviour for `em_producao` posts |
|---|---|
| `PostagensPage.tsx:63` (list/grid/calendar) | shown, purple tag |
| `PostagensPage.tsx:130` (feed-preview selection) | selectable like any media post |
| `HomePage.tsx:26/55` `CALENDAR_STATUSES` | shown in the calendar |
| `PostHistoryPanel.tsx:87` | history shown, **comment composer hidden** |
| `AprovacoesPage.tsx:102` | unchanged (`enviado_cliente` only), so not shown |
| Mensagens hover preview (`CLIENT_STATUS_LABELS`) | label resolves |
| Deep link / share of a post (`SharePostButton`, `/postagens?post=`) | opens read-only |

Server gates stay as they are, and read-only follows from them:

- `hub-approve` aprovado/correcao requires `enviado_cliente`, and comments require
  `HUB_VISIBLE_STATUSES`, which excludes internal statuses. So comments are **closed** while
  in production, and the UI hides the composer so the client never hits the 400.
- `hub-edit-suggestion` requires `enviado_cliente`.
- `hub-post-history` has no current-status gate. It already emits only client-visible events,
  so history works for these posts.

### 3. Post dialog while in production (read-only)

`PostDetailDialog` derives everything interactive from `isPending = status === 'enviado_cliente'`
(line 235): CorrectionPanel, edit suggestion, approve/correction footer. So read-only comes
almost for free. The plan must confirm that `useEditSuggestion` autosave cannot fire when
`isPending` is false.

Additions:

- **Header tag:** the purple "Em produção" StatusTag.
- **Notice** at the top of the body (purple, clock icon). The wording depends on `tipo`
  **only**. Never check for media: the "arte" wording stays even after the art is attached.
  - feed, carrossel: "**Você aprovou o texto.** A equipe está produzindo a **arte** deste post.
    Ele volta para **Aprovações** quando estiver pronto para a próxima aprovação."
  - reels: "... produzindo o **vídeo** deste post. ..."
  - stories: "... produzindo o **conteúdo** deste post. ..."
- **Footer:** an info line with a lock icon, "Em produção: nada para aprovar agora", instead
  of the action buttons.

### 4. "Texto do post" tab (all media posts)

In the media layout (`kind !== 'text'`) the tabs become **Legenda | Texto do post | Histórico
e comentários**. Show the tab when:

```
conteudo_plain.trim() !== ''  AND  conteudo_plain.trim() !== deriveCaption(post, post.ig_caption).trim()
```

(otherwise it would duplicate Legenda). Content: the same read-only `RichTextContent` body the
text card renders (`conteudo`, falling back to `conteudo_plain`), followed by the "Legenda do
Instagram" block when `ig_caption` is set. Always read-only; editing stays in CorrectionPanel.
The tab applies in every status, including the second approval (`enviado_cliente`), where the
client checks the art against the text they approved. Tab label in the text layout stays
"Texto" (unchanged).

Mobile: three 12px tabs share a 375px row, and "Histórico e comentários" is already long. This
must be verified in the Browser pane at mobile width (jsdom can't). If the row overflows, make
it horizontally scrollable or shorten the history label on mobile.

### 5. i18n

Every new string needs pt + en in `packages/i18n/locales/{pt,en}`:

- `hubPostCard.json`: `status.em_producao`
- `hubPosts.json`:
  - three notice variants (arte / vídeo / conteúdo)
  - footer line
  - `posts.tabPostText` "Texto do post"

No em-dashes in user-facing copy.

### 6. Tests

- Deno, `supabase/functions/__tests__/hub-functions_test.ts` (hub-posts):
  - `em_producao` is true for a rascunho post with a prior `aprovado_cliente` event
  - it is false for a rascunho post without one
  - it is false for visible statuses
  - it falls back to false when the events query errors
- Vitest (Hub):
  - an `em_producao` post appears in Postagens and the Home calendar, and not in Aprovações
  - the purple tag and the per-`tipo` notice render
  - there is no footer action and no comment composer
  - the "Texto do post" tab shows when `conteudo_plain` differs from the caption, and is
    hidden when they're equal or empty
- Update existing tests that assert internal statuses are hidden. Grep `apps/hub/src/**/__tests__`
  and `supabase/functions/__tests__` for `rascunho`, `VISIBLE_STATUSES` and `CALENDAR_STATUSES`.
  `hub-functions_test.ts` and `hub-post-history_test.ts` are the likely hits.
- Browser pane: Hub against staging or a patched fetch, at desktop and at 375px.

### 7. Deploy

Deploy `hub-posts` first (`--no-verify-jwt`, `--use-api`, prod + staging), then merge. The
frontend treats a missing `em_producao` as `false`, so either order is safe. Doing the function
first just means the feature is live the moment the frontend deploys.

## Out of scope

- Any CRM change, including the re-arm itself and the "Posts voltaram para rascunho" toast.
- A per-workspace or per-client toggle.
- Snapshotting the approved version. The client sees the current text and art as the agency
  edits them.

## Open question for spec review

Does the same disappearance happen during **correction rework**, when the agency pulls a
`correcao_cliente` post back through `revisao_interna`? If so, the predicate "ever
`enviado_cliente`" (instead of "ever `aprovado_cliente`") would cover it with a one-line change,
but the notice would need a correction variant ("A equipe está ajustando este post..."). The
default is to ship the current rule.
