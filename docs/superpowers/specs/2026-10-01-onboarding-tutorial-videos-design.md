# Tutoriais em vídeo no onboarding + popup de divulgação

Date: 2026-10-01
Mockups: https://claude.ai/artifact/NqqwPM9ECtvbZvjhCtg5GF

## Goal

The Central de Ajuda now has two published video series (prod, 2026-10-01):

- **Primeiros Passos** (8): `primeiro-acesso`, `cadastrar-equipe`, `cadastrar-cliente`,
  `conectar-instagram`, `criar-fluxo`, `criar-post`, `portal-do-cliente`, `agendar-post`
- **Indo Além** (4): `metricas-do-instagram`, `gerar-relatorio`, `automacoes`,
  `conectar-agente-de-ia`

1. New users see the videos as part of onboarding.
2. Existing users learn the videos exist.

## Task 2: popup for existing users (no code)

Created through the Admin MCP `create_popup` as a **draft**. The owner reviews it in the Admin
and activates it; nothing is activated by the agent.

| Field | Value |
|---|---|
| `target_mode` | `all` |
| `frequency` | `once` |
| `require_ack` | false |
| trigger | none |
| `cta_style` | `ink` |
| `cta_label` / `cta_url` | `Assistir agora` / `/ajuda/video/primeiro-acesso` |
| `secondary_label` | default (`Agora não`) |
| image | a frame ~20s into `primeiro-acesso` (its stored thumbnail is a blank browser frame), uploaded with `upload_popup_image` |

One page:

- eyebrow: `Novidade na Central de Ajuda`
- title: `Aprenda o Mesaas em vídeos curtos`
- body: `Gravamos 12 tutoriais de 1 a 2 minutos. Do primeiro acesso ao agendamento de posts,
  passando por métricas, relatórios, automações e o agente de IA.` + new paragraph
  `Seu progresso fica salvo: dá para parar e continuar depois.`

`/ajuda/video/:slug` resolves the slug across all series and renders the playlist rail, so the
CTA lands on the first video with the series beside it.

Known overlap, accepted: there is no "existing users only" targeting. `GlobalPopupHost` already
holds popups while the guide is open or about to auto-open, so a brand-new owner sees the guide in
session 1 and this popup once in a later session. Invited members (who never get the guide) see
the popup on their first visit, which is the intended path for them.

## Task 1: videos inside the Guia de primeiros passos

### Mapping

`GuidePage` gains an optional `videoSlug?: string`. The home screen gets one constant,
`GUIDE_HOME_VIDEO = 'primeiro-acesso'`. Both live in `guideContent.tsx`.

| Page | `videoSlug` |
|---|---|
| `t1p2` Crie o cadastro | `cadastrar-cliente` |
| `t1p3` Conecte o Instagram do cliente | `conectar-instagram` |
| `t1p4` Gere o link do Hub | `portal-do-cliente` |
| `t2p3` Adicione alguém da equipe | `cadastrar-equipe` |
| `t3p2` Crie o primeiro fluxo | `criar-fluxo` |
| `t3p3` O post reúne tudo | `criar-post` |
| `t3p5` O que um post precisa para ser agendado | `agendar-post` |

`t1p4` is already filtered out by `feature_hub_portal`, so its video goes with it. No extra
gating.

The conclusion page (`t3p6`) gets a block pointing at the **Indo Além** series: the series's
video titles and durations, read from the same query, and a `Ver vídeos` button that closes the
guide (`closeForAction`) and navigates to `/ajuda/video/<first video slug of that series>`.
Series is found by slug `indo-alem`; absent or empty, the block is not rendered.

Slugs are editable in the Admin video editor. Renaming one silently drops its card from the guide.
That is the accepted failure mode; the guide never errors over a video. The popup CTA has the same
dependency: renaming `primeiro-acesso` while the popup is active sends its CTA to "Vídeo não
encontrado". Accepted, not enforced: treat the 8 Primeiros Passos slugs as frozen, and if one must
change, update `guideContent.tsx` (and the popup's `cta_url`, if it is still active) in the same
change.

### Components

- **`GuideVideoCard`** (`components/guide/GuideVideoCard.tsx`): props `video: KbVideo`,
  `progress: ProgressMap`, `onSave`, `pageId`, `variant: 'featured' | 'inline'`.
  - Collapsed: a single `<button>` holding the thumbnail (`thumbnail_url`, 16:9, duration badge
    via `formatDuration`), an eyebrow, the video title and a trailing `Assistir` pill.
    `featured` (home) is larger, on a `surface-1` fill, with `Comece por aqui`. `inline` (trail
    pages) says `Prefere ver? Vídeo de 1 minuto`.
  - Length copy, `videoLengthLabel(seconds)`: `max(1, round(seconds / 60))` minutes, so anything
    under 90s (including sub-minute videos) reads `1 minuto`, otherwise `N minutos`. Null, zero or
    non-finite duration gives `''`, and the eyebrow drops the length: `Comece por aqui` /
    `Prefere ver? Assista ao vídeo`. The thumbnail's duration badge (`formatDuration`) is omitted
    when it is `''`.
  - Watched (`isCompleted`): the eyebrow becomes `Assistido` with a check, the thumbnail dims
    behind a check, and the pill becomes `Ver de novo`.
  - Expanded on click: `VideoPlayer` with `controls playsInline autoPlay` (autoplay only after the
    user's click), `poster`, resume from saved progress. Under it: the title, `Ver na Central de
    Ajuda` (closes the guide and goes to `/ajuda/video/<slug>`) and `Fechar vídeo` (collapses,
    flushing progress).
  - Below 480px the trailing pill hides; the whole card is still the button (min height 44px).
  - Fatal player error: the same `Não foi possível carregar este vídeo.` + `Tentar novamente` as
    `VideoStage`.
  - Fires `captureEvent('guide_video_played', { page: pageId | 'home', slug })` once per expansion.
    `AnalyticsEvent` in `lib/analytics.ts` is a closed union: add `'guide_video_played'` next to
    the other `guide_*` events.
- **`usePlaybackProgress`** (`pages/ajuda/videos/usePlaybackProgress.ts`): extracted from
  `VideoStage` so both players save the same way. It owns the refs and returns the
  `onLoadedMetadata`, `onTimeUpdate`, `onPause` and `onEnded` handlers (resume, 10s interval save,
  completion at `COMPLETION_RATIO`, pagehide + unmount flush). `onEnded` takes an optional
  callback so `VideoStage` keeps its next-up overlay. `VideoStage` behaviour does not change.
- **`GuideDialog`**: `useKbVideoSeries()` and `useVideoProgress()` are called from a component
  rendered *inside* `DialogContent` (which Radix unmounts while closed), never in the
  `GuideDialog` body itself, which stays mounted in the layout. So the queries run only while the
  guide is open and `GuideProvider`'s per-page query load does not grow. Resolves `videoSlug` → `KbVideo` over all series. Loading, error, or no match → no
  card, no placeholder. The card sits after `page.body`/recap and before the action box.

Importing `useKbVideos`/`playlist` from `pages/ajuda/videos/` into `components/guide/` is fine
(no lint rule forbids it); moving them is out of scope.

### Progress

Uses the existing `kb_video_progress` table and `save_kb_video_progress` RPC through
`useVideoProgress`. Same query keys as the Central de Ajuda, so a video watched in the guide shows
as watched there and vice versa. Watching a video does not complete a guide page; pages keep their
current completion rules.

The first `play` of each opened guide player also counts as a Central de Ajuda view
(`recordKbViewSafely({ videoId })`, the same call `VideoStage` makes since #615). The
`record_kb_view` RPC dedupes repeats within 30 minutes, so reopening the card does not inflate counts.

### Not doing

- No auto-open video modal, no autoplay.
- No new targeting mode for popups.
- No guide for invited members.
- No schema change, no edge function change, no deploy beyond the frontend.

## Tests

jsdom cannot play HLS, so tests stop at the element level.

- `GuideVideoCard`: renders title/duration for a video; `Assistido` + `Ver de novo` when
  completed; click swaps to a `<video>` and fires `guide_video_played`; `Fechar vídeo` collapses.
- `GuideDialog`: page with a matching slug renders the card; unknown slug, loading and error
  render none; home shows the featured card; `t3p6` shows the Indo Além block only when the
  series exists.
- `guideContent`: every `videoSlug` is unique and only on pages that exist.
- `usePlaybackProgress`: interval save, completion save at 90%, flush on unmount. Existing
  `VideoStage`/`VideoPage` tests pass unchanged.
- Browser check on the dev server: guide home, one trail page, play, dark mode, 375px.
