# WorkflowDrawer fullscreen toggle — design

## Problem

`WorkflowDrawer` (apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx) renders as a
centered modal panel capped at `min(1280px, 94vw)` wide and `92vh` tall
(`.drawer-panel`, apps/crm/style.css:5113). Users editing posts with long content, media
galleries, or the embedded calendar view want more working space without leaving the
drawer.

## Solution

Add an expand/collapse toggle button to the drawer header that switches the panel between
its normal centered size and a fullscreen (100vw × 100vh) layout.

### State

- `WorkflowDrawer` owns `isFullscreen` state, lazily initialized from `localStorage`:
  ```ts
  const [isFullscreen, setIsFullscreen] = useState(
    () => localStorage.getItem('workflow-drawer-fullscreen') === '1',
  );
  ```
- Toggling writes the new value back to `localStorage` (`'1'` / `'0'`) so the preference is
  remembered across future drawer opens in the same browser. This is a plain UI preference,
  not user data — no expiry or cross-device sync needed.

### UI

- New icon button in `.drawer-header-actions`, positioned between the existing calendar
  toggle and the close button.
- Icon: `Maximize2` when collapsed, `Minimize2` when expanded (both from `lucide-react`,
  already used elsewhere in this file).
- `title` attribute: "Expandir" / "Recolher", matching the existing button title pattern in
  this component.

### Styling

- `.drawer-panel` gets a conditional `fullscreen` class:
  `` `drawer-panel${isFullscreen ? ' fullscreen' : ''}` ``.
- New CSS rule in apps/crm/style.css, placed after the existing `.drawer-panel` block:
  ```css
  .drawer-panel.fullscreen {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
  }
  ```
- The existing `@media (max-width: 900px)` rule (style.css:5613-5621) already forces the
  drawer fullscreen below 900px unconditionally — no interaction with the new toggle needed;
  the class-based override is simply redundant (and harmless) at that breakpoint.

### Out of scope

- No changes to `HistoryDrawer.tsx` or any other drawer — this toggle is specific to
  `WorkflowDrawer`.
- No keyboard shortcut for toggling fullscreen.
- No animation differences between the two states beyond the existing drawer pop-in.

## Testing

Manual verification via the dev server: open a workflow drawer, click expand, confirm the
panel fills the viewport and the icon swaps to the collapse state; click again to collapse;
reload the page and confirm the last-used state is restored from `localStorage`.
