# Post Media Lightbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a click-to-preview lightbox over the post media gallery with carousel navigation, keyboard/arrow/swipe controls, and a position counter.

**Architecture:** Create a new `PostMediaLightbox` component built on Radix Dialog primitives (not the project's `DialogContent` wrapper) for overlay, focus trap, Esc-to-close, and click-outside-to-close. Integrate it into `PostMediaGallery` by adding a `lightboxIndex` state that opens the overlay at the clicked tile. The dnd-kit `PointerSensor` 5px activation threshold already distinguishes click from drag, so no interaction refactor is needed.

**Tech Stack:** React 19, TypeScript, `@radix-ui/react-dialog` (already installed), `lucide-react` (already installed), Tailwind, `@dnd-kit/core` / `@dnd-kit/sortable` (unchanged).

**Spec:** `docs/superpowers/specs/2026-04-20-post-media-lightbox-design.md`

**Note on testing:** Per `CLAUDE.md`, the repo has no frontend test suite configured for components. Verification for this plan is typecheck (`npm run build`) + a manual test checklist at the end of each task. No automated component tests are added.

---

## File structure

- **Create**: `apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx` — the overlay component. Self-contained: takes `media`, `initialIndex`, `open`, `onOpenChange`; manages its own current-index, keyboard listener, and swipe state.
- **Modify**: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx` — add `lightboxIndex` state, pass `onOpen` to tiles, wire click, mount the lightbox.

---

## Task 1: Create `PostMediaLightbox` component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx`

- [ ] **Step 1: Create the component file with full implementation**

Create `apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { PostMedia } from '../../../store';

interface PostMediaLightboxProps {
  media: PostMedia[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PostMediaLightbox({
  media,
  initialIndex,
  open,
  onOpenChange,
}: PostMediaLightboxProps) {
  const [index, setIndex] = useState(initialIndex);

  // Reseed index each time the lightbox opens so a subsequent click on a
  // different tile starts at the right slide.
  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  const hasMultiple = media.length >= 2;

  const prev = () =>
    setIndex((i) => (i - 1 + media.length) % media.length);
  const next = () =>
    setIndex((i) => (i + 1) % media.length);

  // Arrow-key navigation. Esc is handled by Radix Dialog itself.
  useEffect(() => {
    if (!open || !hasMultiple) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hasMultiple, media.length]);

  // Pointer-based swipe: record start X on pointerdown, compare on pointerup.
  const startX = useRef<number | null>(null);
  const handlePointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
  };
  const handlePointerUp = (e: React.PointerEvent) => {
    const start = startX.current;
    startX.current = null;
    if (start == null || !hasMultiple) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) < 50) return;
    if (dx < 0) next();
    else prev();
  };

  if (media.length === 0) return null;
  const current = media[index];
  if (!current) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex items-center justify-center focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            Pré-visualização de mídia
          </DialogPrimitive.Title>

          <div
            className="flex items-center justify-center max-h-[85vh] max-w-[90vw]"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            {current.kind === 'image' ? (
              <img
                src={current.url}
                alt={current.original_filename}
                className="max-h-[85vh] max-w-[90vw] object-contain select-none"
                draggable={false}
              />
            ) : (
              <video
                key={current.id}
                src={current.url ?? undefined}
                poster={current.thumbnail_url ?? undefined}
                controls
                className="max-h-[85vh] max-w-[90vw] object-contain"
              />
            )}
          </div>

          <DialogPrimitive.Close
            aria-label="Fechar"
            className="fixed top-4 right-4 w-10 h-10 rounded-full bg-stone-900/85 text-white hover:bg-stone-900 flex items-center justify-center"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>

          {hasMultiple && (
            <>
              <button
                type="button"
                aria-label="Anterior"
                onClick={prev}
                className="fixed left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-stone-900/85 text-white hover:bg-stone-900 flex items-center justify-center"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Próximo"
                onClick={next}
                className="fixed right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-stone-900/85 text-white hover:bg-stone-900 flex items-center justify-center"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <span className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-stone-900/85 text-white text-xs px-2.5 py-1 tabular-nums">
                {index + 1} / {media.length}
              </span>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
```

Notes for the implementer:

- `DialogPrimitive.*` is imported directly from `@radix-ui/react-dialog`, not from `@/components/ui/dialog`. The project's `DialogContent` wrapper adds card framing and an unsaved-changes guard that would be wrong here.
- `aria-describedby={undefined}` silences a Radix accessibility warning when there's no description element.
- `DialogPrimitive.Title` is required for accessibility; we render it `sr-only`.
- `DialogPrimitive.Close` handles X-to-close. Click-outside is automatic on `Overlay`. Esc is automatic on Radix Dialog.
- The media wrapper is centered with `flex items-center justify-center`, but the surrounding `DialogPrimitive.Content` spans the full viewport so clicks on empty space fall through to the overlay and close the dialog. (Radix blocks click-outside only when the click is on Content itself; because Content is the full-viewport flex container, we rely on the Overlay being behind it — `z-50` matches, and Radix handles the dismiss via `onInteractOutside` on Content. If click-outside doesn't work, change Content to `pointer-events-none` and add `pointer-events-auto` on the inner `<div>` and the three floating buttons.)
- `draggable={false}` on `<img>` prevents native image drag from stealing our swipe pointer events.

- [ ] **Step 2: Typecheck**

Run: `npm run build`

Expected: build succeeds, no TypeScript errors. If the build takes too long locally, `npx tsc --noEmit -p apps/crm` is a faster alternative that still catches type errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx
git commit -m "feat: add PostMediaLightbox component"
```

---

## Task 2: Wire lightbox into `PostMediaGallery`

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`

- [ ] **Step 1: Add the import**

At the top of `PostMediaGallery.tsx`, add the lightbox import next to the existing imports from the same folder:

```tsx
import { PostMediaLightbox } from './PostMediaLightbox';
```

- [ ] **Step 2: Add lightbox state**

Inside the `PostMediaGallery` function, next to the other `useState` calls (e.g. after `const [uploading, setUploading] = useState(false);`), add:

```tsx
const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
```

- [ ] **Step 3: Pass index and `onOpen` to each tile**

Find the `media.map((m) => (...))` inside the grid (around line 135). Change it to include the index and an `onOpen` prop:

```tsx
{media.map((m, i) => (
  <SortableMediaTile
    key={m.id}
    media={m}
    disabled={disabled}
    onOpen={() => setLightboxIndex(i)}
    onSetCover={() => handleSetCover(m.id)}
    onDelete={() => handleDelete(m.id)}
  />
))}
```

- [ ] **Step 4: Extend `SortableMediaTileProps`**

Locate the `SortableMediaTileProps` interface (around line 188). Add `onOpen`:

```tsx
interface SortableMediaTileProps {
  media: PostMedia;
  disabled?: boolean;
  onOpen: () => void;
  onSetCover: () => void;
  onDelete: () => void;
}
```

- [ ] **Step 5: Wire `onClick` on the tile root**

In `SortableMediaTile`, destructure `onOpen` from props and add `onClick={onOpen}` to the tile's root `<div>`. Replace the function signature and the root div:

```tsx
function SortableMediaTile({ media: m, disabled, onOpen, onSetCover, onDelete }: SortableMediaTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: m.id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className="relative aspect-square overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-200/80 group cursor-grab active:cursor-grabbing touch-none"
    >
```

The rest of `SortableMediaTile` (image/video rendering, badges, hover buttons) stays unchanged. The existing hover-action wrapper already calls `onPointerDown={(e) => e.stopPropagation()}`, which also prevents the synthetic click event from bubbling to the tile root, so cover/delete buttons remain isolated.

- [ ] **Step 6: Mount the lightbox**

At the bottom of the `PostMediaGallery` JSX (inside the root `<div className="space-y-3">`, after the `pendingVideo` block), add:

```tsx
<PostMediaLightbox
  media={media}
  initialIndex={lightboxIndex ?? 0}
  open={lightboxIndex !== null}
  onOpenChange={(o) => { if (!o) setLightboxIndex(null); }}
/>
```

Use `media` (the local ordered copy), not `serverMedia`, so the lightbox reflects any pending drag-reorder the user has made.

- [ ] **Step 7: Typecheck**

Run: `npm run build`

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 8: Manual verification**

Start dev server: `npm run dev`. Open a post in the Entregas workflow drawer that has a few media items and verify:

1. **Single image**: click the tile → overlay appears; no arrows, no counter; X closes; click outside the image closes; Esc closes.
2. **Multiple media (mixed image + video)**: click the second tile → overlay opens at index 1; counter shows "2 / N"; left/right arrow buttons navigate; `←` / `→` keys navigate; swipe left/right on the image navigates; wrap-around works (prev from first → last; next from last → first).
3. **Video slide**: `controls` visible, play works; navigating to next slide stops playback.
4. **Drag-reorder still works**: press-and-drag a tile more than 5px → reorder fires, no lightbox.
5. **Cover/Delete buttons**: clicking the star or trash on a tile does NOT open the lightbox; they perform their action as before.
6. **Reorder + open**: reorder tiles, then open the lightbox → order inside the lightbox matches the new grid order.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostMediaGallery.tsx
git commit -m "feat: open PostMediaLightbox from gallery tile clicks"
```

---

## Self-review notes

- Spec coverage: all four listed answers (images+videos, carousel across all media in gallery order, full nav set — X/click-outside/Esc/arrows/keys/swipe/counter, tile-click opens) are implemented in Task 1 or wired in Task 2.
- No placeholders; every step shows exact code or exact command.
- Type names used across tasks match `PostMedia` and the actual prop names on `SortableMediaTile`.
- Verification relies on typecheck + manual smoke test, matching repo conventions (no component test suite exists).
