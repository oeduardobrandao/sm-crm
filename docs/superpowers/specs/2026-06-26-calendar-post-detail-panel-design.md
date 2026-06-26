# Calendar post detail panel

**Date:** 2026-06-26
**Status:** Approved (design)
**Area:** CRM · Entregas · WorkflowDrawer calendar

## Problem

The calendar inside `WorkflowDrawer` (`apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx`)
shows scheduled posts as compact pills that render only `Tipo · HH:mm` (e.g. "Reels · 20:00").
A user looking at the calendar — or trying to reschedule a post — has **no way to tell which post
a pill represents**. The only current workaround is to drag the pill back to the "Sem data" sidebar
to reveal its title. We want users to click a pill and immediately see the post's full context.

## Goal

Clicking a post pill opens a **right-side detail panel** showing the post's full context, plus the
actions needed to manage it from the calendar (reschedule, remove date, open the full post).

## Confirmed decisions

| Decision | Choice |
| --- | --- |
| Panel depth | **Rich preview** — metadata + body excerpt + media thumbnail |
| Actions (current-workflow posts) | **Reschedule** (date + time), **Remove date**, **Open full post** |
| Other-workflow (green) pills | **Read-only context**; actions hidden, "Pertence ao workflow «X»" note |
| Data strategy | Render metadata instantly from the clicked pill; **lazy-fetch** body/media/responsável on click |
| Panel layout | **Docked third column** inside the calendar body; grid shrinks when open, full-width when closed |

## Data strategy

The fields needed to *identify* a post — title, tipo, status, `scheduled_at`, workflow title — are
already present in the `ClientePost` object backing each pill, so the panel header/metadata render
**instantly with no fetch and no loading flicker**.

The "rich" extras load lazily, keyed by `postId` via `useQuery` (cached, so re-clicking is instant):

- **New store fn `getPostPreview(postId)`** → `{ conteudo_plain, responsavel_id, ig_caption, published_at, instagram_permalink }`
- **`listPostMedia(postId)`** (existing, `apps/crm/src/services/postMedia.ts`) → first media's `thumbnail_url ?? url`
- **Responsável name** resolved locally from `membros` (already available in `WorkflowDrawer`) via `responsavel_id`

**Why lazy-fetch over enriching `getClientePosts`:** keeps the list query and the `ClientePost` type
unchanged → zero blast radius on the ~6 existing fixtures/consumers, and avoids shipping every post's
full body in the calendar's list payload.

## Components

### New: `CalendarPostDetailPanel.tsx`
Presentational panel. Receives the selected `ClientePost` plus context/handlers; does its own two lazy
`useQuery` fetches for body excerpt + media thumbnail.

Props:
```ts
interface CalendarPostDetailPanelProps {
  post: ClientePost;                 // the selected pill's data (instant metadata)
  membros: Membro[];                 // to resolve responsavel_id -> name
  isCurrentWorkflow: boolean;        // pill belongs to the drawer's workflow
  isLocked: boolean;                 // status in {agendado, postado, falha_publicacao}
  onClose: () => void;
  onReschedule: (date: Date) => void;
  onRemoveDate: () => void;
  onOpenPost: () => void;
}
```

Renders:
- **Header** — "Detalhes do post" eyebrow, tipo badge, full title, close (✕).
- **Status chip** — reuse `PUBLISH_STATE_LABELS` / `PUBLISH_STATE_CLASS` + `getPostPublishState` from `../postLabels`.
- **Meta rows** — 📅 `scheduled_at` (date · time, mono), 📁 workflow title, 👤 responsável name.
- **Conteúdo** — media thumbnail (or a tipo-colored placeholder when none) + body excerpt from
  `conteudo_plain` (clamped ~4 lines). IG caption snippet shown when present.
- **Reschedule** — a `DateTimePicker` (`@/components/ui/date-time-picker`, `futureOnly`) — only when
  `isCurrentWorkflow && !isLocked`.
- **Footer actions** — `Abrir post completo`, `Remover data` (current-workflow + unlocked only).
- **Gating notes** — locked posts show the existing lock reason; `postado` posts with
  `instagram_permalink` show a "Ver no Instagram" link; other-workflow posts show
  "Pertence ao workflow «{workflow_titulo}»" and no actions.

### Changed: `CalendarGrid.tsx` / `PostPill`
- Add `selectedPostId: number | null` and `onSelectPost: (post: ClientePost) => void`.
- Pill gets an `onClick` that calls `onSelectPost(post)`. dnd-kit's `PointerSensor` 5px activation
  distance means a no-move click won't start a drag, so click and drag coexist. Green/locked pills
  already carry no drag listeners, so click works plainly.
- Selected pill gets a highlight ring (and its cell an outline), matching the mock.

### Changed: `WorkflowCalendarView.tsx`
- New state `selectedPostId: number | null`.
- **Derive** `selectedPost` from `allPosts` by id (so it auto-updates after a refetch, and the panel
  auto-closes if the post disappears — e.g. deleted elsewhere).
- Owns the reschedule/remove mutations, reusing the existing `invalidateQueries` + `toast` patterns:
  - reschedule → `updateWorkflowPost(id, { scheduled_at: date.toISOString() })`
  - remove date → `updateWorkflowPost(id, { scheduled_at: null })`, then `setSelectedPostId(null)`
    (the post leaves the calendar for the "Sem data" sidebar).
- Renders `CalendarPostDetailPanel` as a third flex column when `selectedPost` is set; grid is
  full-width otherwise.
- New **optional** props `membros?: Membro[]` and `onOpenPost?: (postId: number) => void` (optional so
  the existing tests/mocks keep compiling).

### Changed: `WorkflowDrawer.tsx`
- Pass `membros={membros}` and `onOpenPost={(id) => { setShowCalendar(false); setExpandedId(id); }}`
  into `WorkflowCalendarView`. ("Open full post" is offered only for current-workflow posts, which is
  exactly what the drawer's `expandedId` can target.)

### New store fn: `getPostPreview` (`apps/crm/src/store/posts.ts`)
```ts
export interface PostPreview {
  conteudo_plain: string;
  responsavel_id: number | null;
  ig_caption: string | null;
  published_at: string | null;
  instagram_permalink: string | null;
}
export async function getPostPreview(postId: number): Promise<PostPreview>;
```
Single-row select on `workflow_posts` by `id` (RLS enforces `conta_id`).

## Styling

New classes in `apps/crm/style.css` (`calendar-detail-panel` / `calendar-detail-*`), following
existing calendar + drawer tokens (brand yellow `#eab308`, green `#3ecf8e`, pink `#E1306C`, DM Sans /
DM Mono / Playfair). Panel ≈ 330px, slides in (`slideIn` keyframe); grid flexes down. Selected pill +
cell get the yellow focus treatment from the mock.

## Edge cases

- **Locked posts** (`agendado` / `postado` / `falha_publicacao`): reschedule + remove disabled, lock
  reason shown (reuse `LOCKED_TOOLTIPS` semantics from `CalendarGrid`).
- **Other-workflow posts**: panel is read-only; no reschedule/remove/open.
- **Selected post unscheduled/deleted**: `selectedPost` derived by id → becomes `undefined` → panel closes.
- **No media**: thumbnail falls back to a tipo-colored placeholder.
- **Media fetch failure**: panel still renders metadata + excerpt; thumbnail silently falls back to placeholder.
- **Drag vs click**: relies on the existing 5px activation distance — a click that doesn't move never starts a drag.

## Testing

- **`store.posts.test.ts`** — unit test for `getPostPreview` (select shape, returns the mapped fields).
- **`WorkflowCalendarView.test.tsx`** (mock `getPostPreview` + `listPostMedia` → `[]`):
  - Clicking a current-workflow pill opens the panel and shows the post title.
  - Clicking a green (other-workflow) pill shows the read-only "Pertence ao workflow" note (no action buttons).
  - "Remover data" closes the panel.
- Run `npm run build` (tsc) + `npm run test`; per CI gates, also `format` + `lint` before pushing.

## Out of scope

- Editing the body / caption / comments inside the panel (use "Abrir post completo").
- Cross-drawer navigation to *open* another workflow's post (other-workflow pills are read-only).
- Enriching `getClientePosts` / the list payload.
