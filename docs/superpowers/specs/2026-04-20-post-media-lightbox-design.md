# Post Media Lightbox — Design

## Context

In the CRM app, `PostMediaGallery` (`apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`) renders post media as a grid of square tiles. Today, the tiles are used only for drag-reorder, setting a cover, and deletion — there is no way to view an image at full size or play a video inline.

Users need a lightbox/overlay that shows media at a larger size, with carousel navigation when a post has multiple media items.

## Goals

- Clicking any media tile opens an overlay preview of that item.
- When the post has 2+ media items, the overlay exposes prev/next navigation so the user can browse the full set.
- Videos are previewable (native `<video controls>`); images are previewable as-is.
- Close via: X button, click-outside, `Esc` key.
- Navigate via: arrow buttons, `←` / `→` keys, touch swipe.
- Show a counter ("3 / 7") when there are 2+ items.

## Non-goals

- No zoom / pan / rotate inside the lightbox.
- No thumbnail strip at the bottom — the counter is sufficient.
- No download button.
- No reorder-from-inside-the-lightbox. Reorder stays in the grid.
- No changes to the Hub app or any other page that doesn't use `PostMediaGallery`.

## Architecture

One new component, one small change to `PostMediaGallery`. No new dependencies — `@radix-ui/react-dialog` and `lucide-react` are already installed.

**New file**: `apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx`
**Modified file**: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`

## `PostMediaLightbox` component

### Props

```ts
interface PostMediaLightboxProps {
  media: PostMedia[];        // same list and order the gallery renders
  initialIndex: number;      // which tile was clicked
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

### Internals

- `const [index, setIndex] = useState(initialIndex);`
- Reseed `index` from `initialIndex` whenever `open` transitions to `true` (via an effect keyed on `open`).
- Current item: `const current = media[index];`
- `hasMultiple = media.length >= 2`

### DOM structure

Wrapped in Radix `Dialog` — which provides focus trap, overlay click-to-close, and Esc handling for free.

```
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogPortal>
    <DialogOverlay />                            ← bg-black/80, click-outside closes
    <DialogContent className="... unstyled wrapper ...">
      <button aria-label="Fechar" onClick={close}>X</button>        ← top-right
      <div className="media-wrapper" onPointerDown={swipeStart} onPointerUp={swipeEnd}>
        {current.kind === 'image'
          ? <img src={current.url} alt={current.original_filename} />
          : <video key={current.id} src={current.url} poster={current.thumbnail_url} controls />}
      </div>
      {hasMultiple && (
        <>
          <button aria-label="Anterior" onClick={prev}>ChevronLeft</button>
          <button aria-label="Próximo" onClick={next}>ChevronRight</button>
          <span className="counter">{index + 1} / {media.length}</span>
        </>
      )}
    </DialogContent>
  </DialogPortal>
</Dialog>
```

The existing shadcn `DialogContent` in `dialog.tsx` includes framing styles (rounded card, padding, etc.) plus a built-in close button, and may have unsaved-changes guards — those are wrong for a lightbox. Use Radix's `DialogPrimitive.Content` directly (imported from `@radix-ui/react-dialog`) with custom classes, not the project's `DialogContent` wrapper. Use `DialogPrimitive.Overlay` for the same reason (we want `bg-black/95` or similar, not the project default).

### Media sizing

- Image / video: `max-h-[85vh] max-w-[90vw] object-contain` — fits viewport while preserving aspect ratio.
- Content wrapper centered with `fixed inset-0 flex items-center justify-center z-50 pointer-events-none` on the outer and `pointer-events-auto` on children, so clicks outside the media hit the overlay and close it.

### Navigation logic

```ts
const prev = () => setIndex((i) => (i - 1 + media.length) % media.length);
const next = () => setIndex((i) => (i + 1) % media.length);
```

Wrap-around (last → first) is chosen for simplicity; most lightboxes behave this way.

### Keyboard

`useEffect` attached while `open` is true:

```ts
useEffect(() => {
  if (!open) return;
  const onKey = (e: KeyboardEvent) => {
    if (!hasMultiple) return;
    if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [open, hasMultiple, media.length]);
```

Esc is handled by Radix Dialog; no extra listener needed.

### Swipe

Simple pointer-based threshold (no library):

```ts
const startX = useRef<number | null>(null);
const onPointerDown = (e: React.PointerEvent) => { startX.current = e.clientX; };
const onPointerUp = (e: React.PointerEvent) => {
  if (startX.current == null || !hasMultiple) return;
  const dx = e.clientX - startX.current;
  startX.current = null;
  if (Math.abs(dx) < 50) return;
  if (dx < 0) next(); else prev();
};
```

Attach to the media wrapper, not the overlay, so horizontal swipes on the image navigate but a tap on empty overlay space still closes via the Dialog's click-outside.

### Video behavior across slides

`<video key={current.id} ... controls />` — keying on the media id remounts the element on slide change, which stops any playing clip. No autoplay.

### Styling

Follows existing tile-button pattern:

- Close / prev / next buttons: `rounded-full bg-stone-900/85 text-white hover:bg-stone-900 w-10 h-10 flex items-center justify-center`.
- Positioning: `fixed top-4 right-4` (close), `fixed left-4 top-1/2 -translate-y-1/2` (prev), `fixed right-4 top-1/2 -translate-y-1/2` (next), `fixed bottom-4 left-1/2 -translate-x-1/2` (counter).
- Counter: `rounded-full bg-stone-900/85 text-white text-xs px-2.5 py-1 tabular-nums`.
- Overlay: `bg-black/90` (darker than default `/80` so the media pops).

## `PostMediaGallery` changes

Add lightbox state:

```ts
const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
```

Extend `SortableMediaTile` with `onOpen: () => void`, wire `onClick={onOpen}` on the root div. dnd-kit's `PointerSensor` with `activationConstraint: { distance: 5 }` (already configured) distinguishes a real click from a drag — `onClick` fires on pointer-up only when no drag occurred. The existing hover-action buttons already call `stopPropagation` on `onPointerDown`, so the cover/delete buttons remain isolated.

In the `.map`:

```tsx
media.map((m, i) => (
  <SortableMediaTile
    key={m.id}
    media={m}
    disabled={disabled}
    onOpen={() => setLightboxIndex(i)}
    onSetCover={() => handleSetCover(m.id)}
    onDelete={() => handleDelete(m.id)}
  />
))
```

Mount lightbox at the bottom of the gallery's JSX:

```tsx
<PostMediaLightbox
  media={media}
  initialIndex={lightboxIndex ?? 0}
  open={lightboxIndex !== null}
  onOpenChange={(o) => { if (!o) setLightboxIndex(null); }}
/>
```

Using `media` (local ordered copy) — not `serverMedia` — so a freshly-reordered grid matches what the lightbox shows.

## Edge cases

- **Single item**: `hasMultiple === false` → no arrows, no counter, no keyboard nav, no swipe. X and click-outside still close.
- **Empty gallery**: no tiles → lightbox never opens.
- **Item deleted/removed while lightbox open**: can't happen. Action buttons are behind the overlay (Dialog portals above and traps focus); `media` can't mutate from the gallery while the Dialog is open.
- **Drag-vs-click**: handled by the existing 5px `activationConstraint`. No extra code needed.
- **Hover action buttons firing the lightbox**: prevented by the existing `onPointerDown={(e) => e.stopPropagation()}` on the action-buttons wrapper, which blocks the click before it bubbles to the tile root.
- **Video still playing after close**: on close, the Dialog unmounts the content, which tears down the `<video>` element — no lingering playback.

## Testing

Manual verification:

1. Gallery with a single image → click opens overlay, no arrows/counter, X closes, overlay click closes, Esc closes.
2. Gallery with 3+ mixed images/videos → click on 2nd tile opens at index 1, counter shows "2 / N", arrows + arrow keys + swipe all navigate, wrap-around works at both ends.
3. Video slide → `controls` shown, play works, navigating to the next slide pauses/tears down the video.
4. Drag-reorder still works (click vs drag distinguished by 5px threshold).
5. Cover/delete hover buttons still work and don't open the lightbox.
6. Typecheck: `npm run build` passes.

No automated tests — the project has no test suite for component rendering, per `CLAUDE.md`.

## Files changed

- **Added**: `apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx`
- **Modified**: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`
