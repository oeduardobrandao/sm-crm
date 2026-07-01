# Hub Mobile Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make five Hub interactions feel intentionally mobile — overflow-aware bottom nav, read-first approval captions, a feed preview + safe date-swap on Postagens, a swipeable Melhores Posts carousel, and Instagram-style finger-following media carousels.

**Architecture:** All work is in `apps/hub` plus one Deno edge function + one SQL migration. UI changes are breakpoint-scoped (desktop information architecture unchanged). The reorder date-swap is made atomic via a new `SECURITY DEFINER` Postgres RPC that the `hub-posts` PATCH handler calls after token resolution. Gesture math is extracted into a pure, unit-tested helper.

**Tech Stack:** React 19, react-router-dom, TanStack Query, Tailwind, Vitest + React Testing Library (frontend); Deno + `deno test` (edge functions); Postgres/plpgsql (migration); i18next (`packages/i18n`).

## Global Constraints

- Package manager / commands: `npm run test` (Vitest), `npm run build:hub` (tsc + vite), `npm run test:functions` (`deno test supabase/functions/`), `npm run lint`, `npm run format` — CI enforces eslint + prettier `format:check` + coverage ratchet + deno tests. Run all before pushing.
- Never break the desktop nav, desktop Melhores Posts grid, or existing API/response shapes.
- Icons: `lucide-react` only. Toasts: none in Hub (inline feedback).
- Edge functions: Deno runtime, `npm:`/relative imports; never wildcard CORS (`buildCorsHeaders(req)`); never return raw error internals; verify workspace ownership (`cliente_id` + `conta_id`) before mutating.
- Reschedule allowlist (verbatim): reschedulable = `enviado_cliente`, `correcao_cliente`, `aprovado_cliente`, `agendado`; always rejected = `rascunho`, `revisao_interna`, `aprovado_interno`, `postado`, `falha_publicacao`.
- Motion honors `prefers-reduced-motion`. New interactive controls target ≥44×44px where space permits.
- Migration timestamps must be unique and later than `20260626000001`; record applied version if pushed via SQL editor (prod db push is blocked by a dup-timestamp migration — see project memory).

---

## Task ordering & dependency map

1. **Task 1 — `carouselGesture.ts` pure helper (+ tests).** Foundation for Task 2. No deps.
2. **Task 2 — InstagramPostCard: continuous media drag (uses Task 1) + read-first caption.** Both edits are in one file; do them in one task to avoid rework. Consumes Task 1.
3. **Task 3 — HubNav mobile "Mais" sheet + i18n.** Isolated.
4. **Task 4 — TopPostsRow mobile scroll-snap carousel + dots.** Isolated.
5. **Task 5 — Backend: reorder RPC migration + `hub-posts` handler allowlist/validation + deno tests.** Defines the PATCH contract Task 6 consumes.
6. **Task 6 — InstagramGridPreview mobility model + PostagensPage selection/preview.** Consumes Task 5's PATCH contract.
7. **Task 7 — Full verification + adversarial review.**

Commit after each task.

---

### Task 1: `carouselGesture.ts` pure gesture helper

**Files:**
- Create: `apps/hub/src/lib/carouselGesture.ts`
- Test: `apps/hub/src/lib/__tests__/carouselGesture.test.ts`

**Interfaces:**
- Produces:
  - `const DRAG_INTENT_THRESHOLD_PX = 8`
  - `const EDGE_RESISTANCE = 0.3`
  - `resolveTarget(opts: { currentIndex: number; count: number; deltaX: number; width: number; velocity: number }): number` — clamped target slide index. Advances when `|deltaX| > 0.18*width` OR `|velocity| > 0.45` (px/ms), in the drag direction; otherwise returns `currentIndex`. Never returns <0 or >count-1.
  - `applyEdgeResistance(deltaX: number, currentIndex: number, count: number): number` — if dragging past the first slide (index 0, deltaX>0) or last slide (index count-1, deltaX<0), multiply the out-of-bounds portion by `EDGE_RESISTANCE`; otherwise return `deltaX` unchanged.
  - `crossedDragThreshold(dx: number, dy: number): boolean` — `Math.abs(dx) > DRAG_INTENT_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveTarget,
  applyEdgeResistance,
  crossedDragThreshold,
  DRAG_INTENT_THRESHOLD_PX,
} from '../carouselGesture';

const W = 300;

describe('resolveTarget', () => {
  it('advances forward when distance exceeds 18% of width', () => {
    expect(resolveTarget({ currentIndex: 0, count: 3, deltaX: -60, width: W, velocity: 0 })).toBe(1);
  });
  it('advances backward on a rightward drag past threshold', () => {
    expect(resolveTarget({ currentIndex: 1, count: 3, deltaX: 60, width: W, velocity: 0 })).toBe(0);
  });
  it('advances on velocity even when distance is small', () => {
    expect(resolveTarget({ currentIndex: 0, count: 3, deltaX: -12, width: W, velocity: -0.6 })).toBe(1);
  });
  it('returns current index below both thresholds', () => {
    expect(resolveTarget({ currentIndex: 1, count: 3, deltaX: -10, width: W, velocity: -0.1 })).toBe(1);
  });
  it('clamps at the last slide', () => {
    expect(resolveTarget({ currentIndex: 2, count: 3, deltaX: -200, width: W, velocity: -2 })).toBe(2);
  });
  it('clamps at the first slide', () => {
    expect(resolveTarget({ currentIndex: 0, count: 3, deltaX: 200, width: W, velocity: 2 })).toBe(0);
  });
});

describe('applyEdgeResistance', () => {
  it('dampens over-drag before the first slide', () => {
    expect(applyEdgeResistance(100, 0, 3)).toBeCloseTo(30);
  });
  it('dampens over-drag after the last slide', () => {
    expect(applyEdgeResistance(-100, 2, 3)).toBeCloseTo(-30);
  });
  it('leaves in-range drags unchanged', () => {
    expect(applyEdgeResistance(-100, 0, 3)).toBe(-100);
    expect(applyEdgeResistance(100, 2, 3)).toBe(100);
  });
});

describe('crossedDragThreshold', () => {
  it('is false for a stationary pointer', () => {
    expect(crossedDragThreshold(2, 1)).toBe(false);
  });
  it('is true for a clearly horizontal move', () => {
    expect(crossedDragThreshold(DRAG_INTENT_THRESHOLD_PX + 1, 2)).toBe(true);
  });
  it('is false when vertical dominates', () => {
    expect(crossedDragThreshold(10, 20)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm run test -- carouselGesture` → FAIL (module not found).
- [ ] **Step 3: Implement `carouselGesture.ts`**

```ts
/** Minimum horizontal travel (px) before a pointer gesture counts as a swipe (vs a tap/scroll). */
export const DRAG_INTENT_THRESHOLD_PX = 8;
/** Fraction of out-of-bounds drag distance that is still applied at the carousel edges. */
export const EDGE_RESISTANCE = 0.3;
/** Advance if the drag passes this fraction of the card width. */
const DISTANCE_RATIO = 0.18;
/** …or this absolute flick velocity in px/ms. */
const VELOCITY_THRESHOLD = 0.45;

function clamp(i: number, count: number): number {
  return Math.max(0, Math.min(count - 1, i));
}

export function resolveTarget(opts: {
  currentIndex: number;
  count: number;
  deltaX: number;
  width: number;
  velocity: number;
}): number {
  const { currentIndex, count, deltaX, width, velocity } = opts;
  const passedDistance = width > 0 && Math.abs(deltaX) > width * DISTANCE_RATIO;
  const passedVelocity = Math.abs(velocity) > VELOCITY_THRESHOLD;
  if (!passedDistance && !passedVelocity) return clamp(currentIndex, count);
  // Negative deltaX / velocity = dragging content left = advancing to the next slide.
  const direction = (deltaX || velocity) < 0 ? 1 : -1;
  return clamp(currentIndex + direction, count);
}

export function applyEdgeResistance(deltaX: number, currentIndex: number, count: number): number {
  const atFirst = currentIndex === 0 && deltaX > 0;
  const atLast = currentIndex === count - 1 && deltaX < 0;
  if (atFirst || atLast) return deltaX * EDGE_RESISTANCE;
  return deltaX;
}

export function crossedDragThreshold(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_INTENT_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy);
}
```

- [ ] **Step 4: Run to verify pass** — `npm run test -- carouselGesture` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(hub): add pure carousel gesture helper (target/resistance/threshold)"`

---

### Task 2: InstagramPostCard — continuous media drag + read-first caption

**Files:**
- Modify: `apps/hub/src/components/InstagramPostCard.tsx`
- Modify: `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx`

**Interfaces:**
- Consumes: `resolveTarget`, `applyEdgeResistance`, `crossedDragThreshold`, `DRAG_INTENT_THRESHOLD_PX` from `../lib/carouselGesture`.
- Produces: no exported API change (same props).

**2a — Continuous media drag.** Replace the single-`currentMedia` render + `onTouchStart/Move/End` index-hop with:
- A horizontal flex **track** rendering every `media` slide; each slide `flex-none w-full`. Only the initially-visible first image keeps `priority`; other images lazy-load. Videos keep thumbnail + play badge.
- State: `currentSlide` (committed index) + `dragOffset` (px, live) + `isDragging`.
- Pointer Events on the viewport, `touch-action: pan-y`:
  1. `pointerdown`: record `pointerId`, `startX/startY`, `startTime`, measured `width` (from a viewport `ref`), reset velocity sample.
  2. `pointermove`: until `crossedDragThreshold(dx,dy)`, do nothing (allow vertical scroll). Once crossed, `setPointerCapture`, set `isDragging`, update `dragOffset = applyEdgeResistance(dx, currentSlide, media.length)`, and keep a `{x,t}` sample for velocity.
  3. `pointerup`: compute `velocity = (x - lastSampleX)/(t - lastSampleT)`, `target = resolveTarget({currentIndex: currentSlide, count: media.length, deltaX: dx, width, velocity})`, then `goToSlide(target)`; clear drag.
  4. `pointercancel`: `goToSlide(currentSlide)` (snap back).
- Track transform: `translateX(calc(${-currentSlide * 100}% + ${dragOffset}px))`. `transition: none` while `isDragging`; else `transform 260ms ease-out` (0ms under `prefers-reduced-motion`). Keep desktop prev/next arrows calling the same clamped `goToSlide`.
- **Tap vs drag:** each slide is its own accessible open-media `button` (`aria-label="Abrir mídia N"`); if the pointer crossed the drag threshold, suppress the click (guard ref) so a drag never opens `PostMediaLightbox`; a stationary tap opens it at that slide.
- Dots: derive a fractional position (`currentSlide - dragOffset/width`) to interpolate active-dot scale/opacity during drag.

**2b — Read-first caption.** Split capability from visibility:
- `canEdit` = `isEditable && !readOnly` (unchanged derivation). New `captionMode: 'preview' | 'edit'`, default `'preview'`.
- Always render the existing 14px caption preview (bold `displayName` + effective caption, `line-clamp-2` unless expanded, `… mais`/`ver menos` for long captions). Effective caption unchanged: `draftIgCaption` (via local `captionDraft`) → fallback parse.
- When `canEdit && captionMode==='preview'`: show a small **"Editar legenda"** text button under the caption.
- When `captionMode==='edit'`: render the existing 14px `textarea` (bump from `text-[11px]`) wired to `saveSuggestion`; secondary action becomes **"Concluir"** which returns to `'preview'` immediately (no wait on debounce). Keep `saving`/`saved` feedback in both modes.
- Add local `captionDraft` so preview reflects edits immediately; sync from a new server value only when `captionMode !== 'edit'`. When a card flips to read-only after approval, reset `captionMode` to `'preview'`.

- [ ] **Step 1: Add/adjust failing tests** in `InstagramPostCard.test.tsx`:

```tsx
// Caption
it('shows the read caption (not a textarea) for a pending post by default', () => {
  renderCard({ status: 'enviado_cliente', ig_caption: 'Olá pessoal' });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByText(/Olá pessoal/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /editar legenda/i })).toBeInTheDocument();
});
it('reveals the editor on "Editar legenda" and returns on "Concluir"', async () => {
  renderCard({ status: 'enviado_cliente', ig_caption: 'Olá' });
  await userEvent.click(screen.getByRole('button', { name: /editar legenda/i }));
  expect(screen.getByRole('textbox')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /concluir/i }));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
// Drag/tap (jsdom lacks layout; assert wiring + suppression, not pixels)
it('opens the lightbox on a stationary tap of a media slide', async () => {
  renderCard({ media: [img(), img()] });
  await userEvent.click(screen.getByRole('button', { name: /abrir mídia 1/i }));
  expect(screen.getByTestId('post-media-lightbox')).toBeInTheDocument();
});
```

(Keep existing carousel/approval tests green; update any that asserted the old `max-h`/`text-[11px]` textarea-always or single-slide DOM.)

- [ ] **Step 2: Run to verify fail** — `npm run test -- InstagramPostCard` → FAIL on new specs.
- [ ] **Step 3: Implement 2a + 2b** in `InstagramPostCard.tsx` per the spec above.
- [ ] **Step 4: Run to verify pass** — `npm run test -- InstagramPostCard` → PASS; then `npm run build:hub` to typecheck.
- [ ] **Step 5: Commit** — `git commit -am "feat(hub): finger-following media carousel + read-first approval captions"`

---

### Task 3: HubNav — mobile "Mais" overflow sheet

**Files:**
- Modify: `apps/hub/src/shell/HubNav.tsx`
- Modify/Create: `apps/hub/src/shell/__tests__/HubNav.test.tsx`
- Modify: `packages/i18n/locales/pt/common.json`, `packages/i18n/locales/en/common.json`

**Interfaces:**
- Produces: mobile bottom bar = 5 primary tabs (`home`, `aprovacoes`, `postagens`, `marca`, `paginas`) + a **"Mais"** button opening a bottom sheet with `briefing`, `ideias`, `relatorios`. Desktop `NAV_ITEMS` and desktop header markup unchanged.

Details:
- Keep the existing `NAV_ITEMS` for desktop. Add `MOBILE_PRIMARY` (first 5) and `MOBILE_OVERFLOW` (briefing, ideias, relatorios) item lists with icons (`Lightbulb` for ideias, `BarChart3`/`FileBarChart` for relatorios, existing `BookOpen` for briefing) and a `Mais` control using `MoreHorizontal`.
- "Mais" is active when `pathname` starts with `${base}/briefing`, `/ideias`, or `/relatorios` (incl. `/relatorios/:month`).
- Bottom sheet: mobile-only fixed backdrop + panel above the bottom bar; `role="dialog"`, `aria-modal="true"`, labelled title ("Mais"), close button. Open from Mais; close on backdrop / close button / Escape / destination select. Focus first destination on open, restore focus to Mais on close. Lock body scroll while open. Include `env(safe-area-inset-bottom)` in padding. Large rows: icon + label + chevron. Do **not** duplicate theme/language (those stay in the mobile top bar).
- i18n: add `nav.mais` (PT "Mais" / EN "More") and `nav.relatorios` (PT "Relatórios" / EN "Reports"). `nav.ideias` already exists.

- [ ] **Step 1: Write failing tests** (render `HubNav` inside a `MemoryRouter` at `/:workspace/hub/:token`, mock `useHub`):

```tsx
it('renders 5 primary mobile tabs plus a Mais control', () => {
  renderNav('/w/hub/t');
  ['Home','Aprovações','Postagens','Marca','Páginas','Mais'].forEach((l) =>
    expect(screen.getAllByText(l).length).toBeGreaterThan(0));
});
it('opens the Mais sheet and exposes overflow destinations', async () => {
  renderNav('/w/hub/t');
  await userEvent.click(screen.getByRole('button', { name: /mais/i }));
  const dialog = screen.getByRole('dialog');
  ['Briefing','Ideias','Relatórios'].forEach((l) =>
    expect(within(dialog).getByText(l)).toBeInTheDocument());
});
it('marks Mais active on an overflow route', () => {
  renderNav('/w/hub/t/relatorios');
  expect(screen.getByRole('button', { name: /mais/i })).toHaveAttribute('data-active', 'true');
});
it('closes the sheet on Escape', async () => {
  renderNav('/w/hub/t');
  await userEvent.click(screen.getByRole('button', { name: /mais/i }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify fail** — `npm run test -- HubNav` → FAIL.
- [ ] **Step 3: Implement** the mobile split + sheet + i18n keys.
- [ ] **Step 4: Run to verify pass** — `npm run test -- HubNav` → PASS; `npm run build:hub` typechecks.
- [ ] **Step 5: Commit** — `git commit -am "feat(hub): mobile bottom-nav overflow sheet (Mais → Briefing/Ideias/Relatórios)"`

---

### Task 4: TopPostsRow — mobile scroll-snap carousel + dots

**Files:**
- Modify: `apps/hub/src/components/dashboard/TopPostsRow.tsx`
- Modify: `apps/hub/src/components/__tests__/TopPostsRow.test.tsx`

**Interfaces:** unchanged props (`posts: DashboardTopPost[]`).

Details:
- `<sm`: wrap cards in a horizontal `flex` track, `overflow-x-auto snap-x snap-mandatory` + hidden scrollbar (`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`); each card `snap-start shrink-0 basis-[84%]` so the next peeks.
- `≥sm`: keep the current `sm:grid-cols-3 md:grid-cols-5` grid; no dots, no horizontal scroll. (Use `hidden sm:grid` / `flex sm:hidden` twin containers, or a single container that switches classes — but rendering the list twice is fine and simplest.)
- Dots (mobile only): one `button` per post below the track, `aria-label="Ir para post N"`, active dot wider/opaque. Clicking scrolls that card into view (`scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'center' })`).
- Active index: `rAF`-throttled scroll handler computing nearest card from `scrollLeft`/child `offsetLeft`; reset to 0 when `posts` identity changes (period switch).
- Preserve outbound Instagram links, image-fallback, metrics, hover.

- [ ] **Step 1: Failing tests**

```tsx
it('renders a dot per post on mobile', () => {
  render(<TopPostsRow posts={[makePost({id:'a'}), makePost({id:'b'}), makePost({id:'c'})]} />);
  expect(screen.getAllByRole('button', { name: /ir para post/i })).toHaveLength(3);
});
it('keeps the desktop grid classes', () => {
  const { container } = render(<TopPostsRow posts={[makePost()]} />);
  expect(container.querySelector('.sm\\:grid-cols-3')).toBeTruthy();
});
it('still shows metrics and the outbound link', () => {
  render(<TopPostsRow posts={[makePost({ reach: 533 })]} />);
  expect(screen.getAllByText('Alcance').length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Verify fail** — `npm run test -- TopPostsRow` → FAIL.
- [ ] **Step 3: Implement** the mobile track + dots; keep grid for `≥sm`.
- [ ] **Step 4: Verify pass** — `npm run test -- TopPostsRow` → PASS; `npm run build:hub`.
- [ ] **Step 5: Commit** — `git commit -am "feat(hub): Melhores Posts becomes a swipeable carousel on mobile"`

---

### Task 5: Backend — atomic reorder RPC + hub-posts allowlist

**Files:**
- Create: `supabase/migrations/20260701000001_hub_atomic_post_schedule_reorder.sql`
- Modify: `supabase/functions/hub-posts/handler.ts`
- Modify: `supabase/functions/__tests__/hub-functions_test.ts` (or the file that already tests `createHubPostsHandler` — grep first)

**Interfaces:**
- Produces (PATCH `/hub-posts` contract, consumed by Task 6):
  - Request: `{ token, updates: { post_id: number; scheduled_at: string | null }[] }`.
  - Success `200`: `{ ok: true, updated: number }`.
  - `400` `{ error }` — malformed body, duplicate ids, null/`too-soon` date for an `agendado` target, unknown/empty updates.
  - `403` `{ error }` — any id outside the token's workflows (whole-batch reject; no silent drop).
  - `409` `{ error, locked_post_ids }` — any id in a forbidden status, or an agendado row already being published.
  - RPC: `hub_reorder_post_schedules(p_cliente_id bigint, p_conta_id bigint, p_updates jsonb) returns jsonb` where `p_updates = [{ "post_id": n, "scheduled_at": "..."|null }]`; returns `{ "ok": true, "updated": n }` or raises with a coded message.

**5a — Migration** `20260701000001_hub_atomic_post_schedule_reorder.sql`:

```sql
-- Atomic, ownership-scoped reschedule for the client Hub feed-preview reorder.
-- Swaps scheduled_at across a batch in one transaction with row locks, enforces
-- the reschedule allowlist, and protects the publishing pipeline for agendado rows.
CREATE OR REPLACE FUNCTION hub_reorder_post_schedules(
  p_cliente_id bigint,
  p_conta_id  bigint,
  p_updates   jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids        bigint[];
  v_count      int;
  v_locked     bigint[];
  v_updated    int := 0;
  r            record;
  v_new_at     timestamptz;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array'
     OR jsonb_array_length(p_updates) = 0 THEN
    RAISE EXCEPTION 'BAD_REQUEST: empty updates';
  END IF;

  SELECT array_agg((e->>'post_id')::bigint) INTO v_ids
  FROM jsonb_array_elements(p_updates) e;

  -- Reject duplicates outright (a swap must reference each post once).
  IF (SELECT count(*) FROM unnest(v_ids)) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'BAD_REQUEST: duplicate post_id';
  END IF;
  v_count := array_length(v_ids, 1);

  -- Lock every target row, scoped to this client + account, in a stable order.
  PERFORM 1 FROM workflow_posts wp
    JOIN workflows w ON w.id = wp.workflow_id
   WHERE wp.id = ANY(v_ids)
     AND w.cliente_id = p_cliente_id
     AND w.conta_id  = p_conta_id
   ORDER BY wp.id
   FOR UPDATE OF wp;

  -- Ownership: every id must resolve to a row owned by this token's client/account.
  IF (SELECT count(*) FROM workflow_posts wp
        JOIN workflows w ON w.id = wp.workflow_id
       WHERE wp.id = ANY(v_ids)
         AND w.cliente_id = p_cliente_id
         AND w.conta_id  = p_conta_id) <> v_count THEN
    RAISE EXCEPTION 'FORBIDDEN: post outside token scope';
  END IF;

  -- Status allowlist (whole-batch reject).
  SELECT array_agg(wp.id) INTO v_locked
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.status NOT IN ('enviado_cliente','correcao_cliente','aprovado_cliente','agendado');
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED: forbidden status: %', v_locked;
  END IF;

  -- Publishing safety for agendado rows already claimed by the cron.
  SELECT array_agg(wp.id) INTO v_locked
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.status = 'agendado'
    AND wp.publish_processing_at IS NOT NULL
    AND wp.publish_processing_at >= now() - interval '10 minutes';
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED: publishing in progress: %', v_locked;
  END IF;

  FOR r IN SELECT e->>'post_id' AS pid, e->>'scheduled_at' AS at
           FROM jsonb_array_elements(p_updates) e LOOP
    v_new_at := CASE WHEN r.at IS NULL THEN NULL ELSE r.at::timestamptz END;

    -- agendado rows must keep a valid, not-immediate future slot and reset any
    -- prepared container so the cron rebuilds it near the new time.
    IF EXISTS (SELECT 1 FROM workflow_posts WHERE id = r.pid::bigint AND status = 'agendado') THEN
      IF v_new_at IS NULL OR v_new_at < now() + interval '10 minutes' THEN
        RAISE EXCEPTION 'BAD_REQUEST: agendado needs a future date';
      END IF;
      UPDATE workflow_posts
         SET scheduled_at = v_new_at,
             instagram_container_id = NULL
       WHERE id = r.pid::bigint
         AND instagram_media_id IS NULL;  -- never touch an already-published media
    ELSE
      UPDATE workflow_posts SET scheduled_at = v_new_at WHERE id = r.pid::bigint;
    END IF;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION hub_reorder_post_schedules(bigint,bigint,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION hub_reorder_post_schedules(bigint,bigint,jsonb) TO service_role;
```

> Note: also clear Stories prepared segment containers here if `instagram_story_segments` exposes a per-segment `container_id`/`media_id` — confirm the column names in `20260625000001_instagram_story_segments.sql` during implementation and add a guarded `UPDATE ... SET container_id = NULL WHERE post_id = r.pid AND media_id IS NULL`. If Stories cannot be selected in the feed preview (they can't — Task 6 excludes them), this is defense-in-depth only.

**5b — Handler** (`hub-posts/handler.ts` PATCH branch): after `resolveHubToken`, replace the manual workflow/status denylist + per-row loop with a single RPC call, mapping coded errors to HTTP:

```ts
if (req.method === "PATCH") {
  const body = await req.json().catch(() => ({}));
  const updates = body.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return json({ error: "updates array required" }, 400);
  }
  for (const u of updates) {
    if (typeof u?.post_id !== "number" || !("scheduled_at" in u)) {
      return json({ error: "malformed update" }, 400);
    }
  }
  const { data, error } = await db.rpc("hub_reorder_post_schedules", {
    p_cliente_id: hubToken.cliente_id,
    p_conta_id: hubToken.conta_id,
    p_updates: updates,
  });
  if (error) {
    const msg = String((error as { message?: string }).message ?? "");
    if (msg.includes("FORBIDDEN")) return json({ error: "Post não autorizado." }, 403);
    if (msg.includes("LOCKED")) {
      const ids = (msg.match(/\{([\d,\s]+)\}/)?.[1] ?? "")
        .split(",").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
      return json({ error: "Não é possível reagendar posts em publicação ou já publicados. Atualize a página.", locked_post_ids: ids }, 409);
    }
    if (msg.includes("BAD_REQUEST")) return json({ error: "Datas inválidas para reagendamento." }, 400);
    return json({ error: "Falha ao reagendar." }, 500); // never leak raw internals
  }
  return json(data ?? { ok: true }, 200);
}
```

- [ ] **Step 1: Failing deno tests** in the hub handler test file — inject a fake `createDb` whose `.rpc()` records the call and returns canned data/errors. Assert:
  - malformed body → 400 (rpc not called);
  - rpc `FORBIDDEN` → 403;
  - rpc `LOCKED: {5,7}` → 409 with `locked_post_ids: [5,7]`;
  - rpc `BAD_REQUEST` → 400;
  - success passes `p_cliente_id/p_conta_id` from the resolved token and returns `{ ok: true, updated }`.
- [ ] **Step 2: Verify fail** — `npm run test:functions` → FAIL.
- [ ] **Step 3: Implement** migration + handler.
- [ ] **Step 4: Verify pass** — `npm run test:functions` → PASS. (Do NOT run `supabase functions deploy`/`deno check` broadly — it pollutes `node_modules`/`deno.lock` and breaks `npm run build`; if lock drift occurs: `git checkout deno.lock && npm ci`.)
- [ ] **Step 5: Commit** — `git commit -am "feat(hub): atomic ownership-scoped reschedule RPC + allowlist for hub reorder"`

---

### Task 6: InstagramGridPreview mobility model + PostagensPage preview

**Files:**
- Modify: `apps/hub/src/components/InstagramGridPreview.tsx`
- Modify: `apps/hub/src/pages/PostagensPage.tsx`
- Modify: `apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx`
- Modify/Create: `apps/hub/src/pages/__tests__/postagensPreview.test.tsx`

**Interfaces:**
- Consumes: PATCH `/hub-posts` contract from Task 5 (via existing `reorderPostSchedules`, plus surfaced `locked_post_ids`/error message).

**6a — PostagensPage** mirrors AprovacoesPage's preview wiring:
- Add `selectedIds: Set<number>`, `showGrid`, the lazy `hub-instagram-feed` query (`enabled: showGrid && instagramProfile != null`), `FeedPreviewButton` in the page header, and `InstagramGridPreview` with an invalidate-on-save callback.
- Selection props (`isSelected`, `onToggleSelect`) go **only** on feed-compatible `InstagramPostCard`s (feed/reels/carrossel with media). Stories and `TextPostCard` get none.
- `selectedPosts` = all visible posts across groups whose id ∈ selectedIds. Prune ids no longer present; derive the button count from `selectedPosts.length` (not the raw Set).

**6b — InstagramGridPreview** — replace the `pending`/`live` binary with a mobility model:
- `mobility: 'movable' | 'fixed'`. Movable = Hub post in `enviado_cliente|correcao_cliente|aprovado_cliente|agendado` **and** (for agendado) scheduled time not already passed. Fixed = `postado|falha_publicacao`, an agendado-now ("Publicando") item, or a live Instagram row.
- Only movable↔movable drops swap date slots; fixed cells never move and never receive draggable handlers (fixed/locked cursor). Dedupe a `postado` Hub item against a live Instagram item by `instagram_permalink`, preferring the live row.
- Initial order by effective timestamp (newest first): unpublished → `scheduled_at`; postado → `published_at ?? scheduled_at`; live → `postedAt`.
- Save: send only movable Hub posts whose `scheduled_at` changed; on error keep dirty state + show the returned message (and `locked_post_ids` if present); on success replace initial map, clear dirty, invalidate.
- Update hint/legend to distinguish **Reordenável / Fixo / Publicado no Instagram**.

- [ ] **Step 1: Failing tests** — (a) PostagensPage: feed-compatible cards get a selection checkbox; stories/text don't; the button appears once ≥1 selected. (b) GridPreview: a `postado` item renders fixed (not draggable) and is excluded from the save payload; a movable↔movable swap produces two changed `scheduled_at`s; a failed save keeps the modal dirty and shows the error.
- [ ] **Step 2: Verify fail** — `npm run test -- InstagramGridPreview PostagensPage` → FAIL.
- [ ] **Step 3: Implement** 6a + 6b.
- [ ] **Step 4: Verify pass** — targeted tests PASS; `npm run build:hub`.
- [ ] **Step 5: Commit** — `git commit -am "feat(hub): Visualizar no Feed on Postagens with fixed-anchor date-swap reorder"`

---

### Task 7: Verification + adversarial review

- [ ] **Step 1: Full frontend suite** — `npm run test` → all green (fix regressions in shared-card/grid tests).
- [ ] **Step 2: Typecheck/build** — `npm run build:hub` (and `npm run build` if CRM types could be touched — they shouldn't be).
- [ ] **Step 3: Edge tests** — `npm run test:functions` → green. If `deno.lock`/`node_modules` drift: `git checkout deno.lock && npm ci`.
- [ ] **Step 4: Lint + format** — `npm run lint` and `npm run format` (CI runs `format:check`).
- [ ] **Step 5: Adversarial review** — run a multi-dimension review (correctness/regression, mobile UX + a11y, edge-function security + swap atomicity, i18n completeness) over the branch diff; triage findings; fix confirmed issues; re-run Steps 1–4.
- [ ] **Step 6: Manual smoke (optional)** — `npm run dev:hub` and exercise: mobile nav sheet, Aprovações caption edit toggle, Postagens feed preview + swap-save, Melhores Posts swipe, in-card media drag.

## Rollout

Ship as one Hub release (all frontend changes are backward-compatible). Deploy the migration **before/with** the `hub-posts` handler (handler must not call the RPC before it exists). Prod db push is blocked by a dup-timestamp migration — apply `20260701000001` via the SQL editor and record the version if pushing to prod. Deploy `hub-posts` with `--use-api` (local Docker bundler is broken) and, since it handles its own token auth, keep `--no-verify-jwt`.

## Self-review notes

- Spec coverage: nav (T3), captions (T2), Postagens preview+swap (T5+T6), Melhores Posts carousel (T4), continuous drag (T1+T2), backend atomicity/allowlist (T5) — all mapped.
- PostMediaLightbox gesture parity is explicitly deferred (spec non-goal); the helper is reusable later.
- Story-segment container reset is guarded/defense-in-depth since Stories are unselectable in the preview.
