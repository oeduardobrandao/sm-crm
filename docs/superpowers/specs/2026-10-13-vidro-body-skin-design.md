# Vidro body skin: design

**Status:** spec, revised after the Fable review (approved with changes) and the Codex review; all points folded in.
**Builds on:** `docs/superpowers/specs/2026-10-12-desktop-vidro-design.md` (the Vidro shell, PR #695).
**Mockups:** https://claude.ai/artifact/Bt1KGGC2PLjqyH2QmVKGUo. The `V3-*` boards are the target. All of
them share one stylesheet, quoted in the token tables below.

## Goal

The Vidro shell shipped with each page body still in the classic look. The owner wants every page body
to look like the mockups (tables, cards, buttons, badges, inputs, controls, menus and dialogs) without
changing any page **layout**. Layout reshapes (the Clientes inspector, the Cliente KPI row, Início as list
rows) are a later, separate decision.

Same constraints as the shell:
- **Flag on, ≥1101px only.** `html[data-look='vidro']`, inside `@media (min-width: 1101px)`.
- **Flag off is pixel-identical** at every width. Markup may gain inert hooks (`data-slot`,
  `data-variant`, `data-size`, a class with no CSS outside the vidro files), following the accepted
  `data-slot` precedent. It may not change any style.
- `style.css` is never edited. No `@layer`, no `!important`.
- Every action stays reachable and every interaction state stays visible.

Also in scope, because the screenshots made it obvious: **under Vidro the sidebar starts pinned open**
when the user has never chosen a pin state.

**What "every button" means here.** The skin reaches:
- every shadcn primitive;
- every hand-written button class used on desktop (listed in §1);
- the parent-scoped `.x button` rules in `style.css`.

A scan of desktop `<button>` elements found 45 that are styled only by Tailwind utilities with no class
hook. Those are the only buttons left on colour-only (through the token remap). The final sweep lists
any that are visibly off-look as a follow-up.

**Selector notation.** In this spec `[data-variant='a'|'b']` and `input[type='x'|'y']` are shorthand for
alternatives. The CSS must spell them as `:is([data-variant='a'], [data-variant='b'])` or as
comma-separated selectors; a literal `|` inside an attribute value matches nothing.

## Decisions

- **D1. Token remap is the main lever.**
  - About 700 raw Tailwind buttons and dozens of hand-written components read the legacy surface and
    border tokens and the shadcn HSL tokens.
  - Remapping those tokens under Vidro reskins colours and borders everywhere, with no per-component rule.
  - Component rules then handle shape (radius, height, padding, type).
- **D2. Hooks on primitives.**
  - The shadcn primitives in `apps/crm/src/components/ui/` gain `data-slot` attributes (shadcn v4
    convention). `Button` also gains `data-variant` and `data-size`.
  - The CSS targets the hooks, not Tailwind class strings.
- **D3. Overlays are in scope.** This reverses the shell spec, which kept them out. Pill buttons inside
  classic dialogs would look broken.
  - Portaled content (Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Select content, Command) renders
    in `body`.
  - So tokens move from `.app-container` to `body:has(.app-container)`, and overlay rules use the prefix
    `html[data-look='vidro'] body:has(.app-container)`.
  - Routes outside AppLayout (afiliados, conectar, oauth, login) do not match and stay classic.
- **D4. Brand mapping, following the mockups:**
  - Default and `ink` Buttons become an **ink pill**: CTA tokens, `#12151a` on light and `#e8eaf0` on dark.
  - Outline and secondary become a **glass pill** (`.btn2`).
  - Ghost becomes transparent with a fill hover.
  - Destructive becomes a danger pill.
  - Switch checked becomes `#34c759` in both themes, as in the mockup.
  - Checkbox checked becomes ink: `--vd-cta` with a `--vd-cta-fg` check, so light is `#12151a` and dark
    is `#e8eaf0`. Not `--vd-sel`, which is translucent in dark.
  - Yellow `#ffbf30` stays for the sidebar's active icon, count badges, the `primary` badge tone and focus
    rings.
- **D5. One CSS file per family** under `apps/crm/src/styles/vidro-body/`, so parallel implementers never
  edit the same file. Rules where two families meet (a button inside a table row, a badge inside a kanban
  card) go only in `compositions.css`.

## Tokens

### Placement

`apps/crm/src/styles/vidro.css` moves the `--vd-*` declarations:
- Today they sit on `html[data-look='vidro'] .app-container`, with a dark mirror.
- They move to `html[data-look='vidro'] body:has(.app-container)`, with the dark mirror
  `html[data-theme='dark'][data-look='vidro'] body:has(.app-container)`.

`.app-container` keeps its own background and `--topbar-height`. Nothing else in the shell changes.

### New `--vd-*` tokens (verbatim from the mockups)

| Token | Light | Dark | Mockup name |
|---|---|---|---|
| `--vd-txt2` | `#4b5563` | `#a1a8b5` | `--txt2` |
| `--vd-icon` | `#4b5563` | `#a1a8b5` | `--icon` |
| `--vd-cta` / `--vd-cta-fg` | `#12151a` / `#ffffff` | `#e8eaf0` / `#12151a` | `--cta-bg`/`--cta-fg` |
| `--vd-ok` / `--vd-warn` | `#15803d` / `#b45309` | `#3ecf8e` / `#f5a342` | `--ok`/`--warn` |
| `--vd-tg-info` / `-bg` | `#1d4ed8` / `#eaf1ff` | `#93b4ff` / `rgba(57,132,255,.18)` | `.tg.info` |
| `--vd-tg-warn` / `-bg` | `#b45309` / `#fff3dc` | `#f5b041` / `rgba(245,163,66,.18)` | `.tg.warn` |
| `--vd-tg-ok` / `-bg` | `#15803d` / `#e6f8ee` | `#5fd4a0` / `rgba(62,207,142,.16)` | `.tg.ok` |
| `--vd-tg-neutral` / `-bg` | `#374151` / `#eceef1` | `#c3c8d1` / `rgba(255,255,255,.09)` | `.tg.neutral` |
| `--vd-tg-bad` / `-bg` | `#b91c1c` / `#fdecec` | `#ff8a7a` / `rgba(245,90,66,.18)` | `.tg.bad` |
| `--vd-switch-on` | `#34c759` | `#34c759` | `.tgl` |
| `--vd-cta-hover` | `var(--cta-hover)` (`#272d39`) | `var(--cta-hover)` | existing `style.css:118` |
| `--vd-overlay` | `rgba(18,21,26,.32)` | `rgba(0,0,0,.55)` | new |
| `--vd-menu` | `rgba(255,255,255,.86)` | `rgba(30,34,42,.86)` | new (glass menus) |

The existing tokens (`--vd-panel`, `--vd-tile`, `--vd-group`, `--vd-sep`, `--vd-fill`, `--vd-sel`,
`--vd-txt3`, `--vd-cap*`, `--vd-shadow`) keep their values.

### Remapped shared tokens (same selector as the `--vd-*` block)

**Safe to remap.** These are only ever used as surface or border colours:

| Token | Light | Dark |
|---|---|---|
| `--border-color` | `var(--vd-sep)` | `var(--vd-sep)` |
| `--surface-main` | `var(--vd-group)` | `var(--vd-group)`; only ever a surface, with 30 rules and 16 inline uses |
| `--surface-hover` | `var(--vd-fill)` | `var(--vd-fill)` |
| `--surface-1` | `#f4f4f6` | `rgba(255,255,255,.05)` |
| `--surface-2` | `rgba(118,118,128,.12)` | `rgba(118,118,128,.24)` |
| `--surface-3` | `rgba(118,118,128,.2)` | `rgba(118,118,128,.32)` |
| shadcn `--border`, `--input` | opaque HSL of `--vd-sep` composited on the panel: light ≈ `240 3% 91%`, dark ≈ `220 8% 15%` | |
| shadcn `--muted`, `--accent` | opaque HSL of `--vd-fill` on the panel: light ≈ `240 5% 94%`, dark ≈ `223 8% 17%` | |
| shadcn `--popover`, `--card` | light `0 0% 100%`, dark `220 15% 10%` | |

The HSL values must be bare channel triplets, as the design system requires. The implementer computes
the exact composite and records the arithmetic in a comment. In dark, the panel is itself translucent
(`rgba(15,17,21,.86)` over `#0a0c0f`, which comes to about `#0e1014`). Composite the panel over the
body first, then the token over that.

**Global rule:** a `position: sticky` or `fixed` element never takes a translucent token. It takes
`--vd-solid` or an opaque composite, so content cannot scroll visibly underneath.

**Not remapped:**

| Token | Why |
|---|---|
| `--card-bg` | Used as a foreground: `[data-tooltip]` text and the kanban avatar ring. `--vd-group` in dark is `rgba(255,255,255,.03)`, which would make tooltip text vanish. |
| `--text-main`, `--text-muted`, `--text-light`, `--danger*`, `--primary*` | Text contrast was audited. |
| shadcn `--background`, `--foreground`, `--ring`, `--primary` | `--background` paints the body behind the panel. |
| `--radius` | Component rules own the radii. |
| `--bg-color`, `--surface-light`, `--surface-darker` | Five or fewer uses each. `--bg-color` paints the body and the fullscreen dialog. The other two are only used inside covered families, which set their own surface. |

**Report editor internals** (the block canvas, `ImageBlockEditor` loading frames, editor notices) take the
token remap: colours only, no component rules. They are in the visual sweep.

## Hooks (D2)

Each hook is added to the primitive's root (or the named part), with no visual change.

| Primitive | Hooks |
|---|---|
| Button | `data-slot="button"` (exists), `data-variant={variant ?? 'default'}`, `data-size={size ?? 'default'}` |
| AlertDialogAction / AlertDialogCancel | `data-slot="button"`, `data-variant="default"` / `"outline"`, `data-size="default"`. They build classes from `buttonVariants()`, so the attributes are added by hand. |
| Card + parts | `card`, `card-header`, `card-title`, `card-description`, `card-content`, `card-footer` |
| Input, Textarea | `input`, `textarea` |
| Table | wrapper `table-container`, `table`, `table-header`, `table-body`, `table-row`, `table-head`, `table-cell`, `table-footer` |
| Select | `select-trigger`, `select-content`, `select-item`, `select-separator` |
| Checkbox, Switch | `checkbox`; `switch` and `switch-thumb` |
| Dialog | `dialog-overlay`; `dialog-content` on the desktop branch only (the phone branch is untouched); `data-layout={layout ?? 'default'}` on the content, so rules can exclude `[data-layout='fullscreen']`. `CommandDialog` passes its `layout` through. |
| AlertDialog | `alert-dialog-overlay`, `alert-dialog-content` |
| Sheet | `sheet-overlay`, `sheet-content` |
| Popover | `popover-content` |
| DropdownMenu | `dropdown-menu-content`, `dropdown-menu-sub-content`, `dropdown-menu-item` (also on checkbox and radio items), `dropdown-menu-sub-trigger`, `dropdown-menu-separator`, `dropdown-menu-label` |
| Command | `command`, `command-input`, `command-item` |
| ToggleGroup | `toggle-group`, `toggle-group-item` |
| Tooltip | `tooltip-content` |
| Calendar (DayPicker) | It builds its controls from `buttonVariants()` class strings, so there is no `data-slot`. Add inert classes through its `classNames` map: `vidro-cal-nav` on the previous/next buttons, `vidro-cal-day` on the day button. Selected, today and outside keep DayPicker's own modifier classes (`day-range-*`, `day-outside`, and the selected/today entries), which the rules key on. |
| Sonner Toaster | `toast` classes already exist (`.toaster [data-sonner-toast]`); no new hook |
| Hand-placed (not primitives) | `data-slot="table"` on the raw `<table>` in `pages/arquivos/components/FileGrid.tsx:255`; `data-slot="card"` on Ideias cards (`pages/ideias/IdeiasPage.tsx` and its card component) and on the Arquivos grid tiles (`FileGrid.tsx:222` children). Attribute only, the class strings unchanged. |

A unit test per primitive pins the attributes, and pins that the class string is unchanged.

### Inline-style escapes (TSX, gated on `useVidroShell()`)

Inline styles beat any stylesheet. Each case below drops its look-defining inline style only while
`useVidroShell()` is true; flag-off markup stays byte-identical. Layout-only inline styles (widths, flex,
gaps) stay.

| Where | Today | Under Vidro |
|---|---|---|
| `components/help/EmptyStateGuide.tsx` | `border`, `background`, three text colours | class `vidro-empty` |
| `components/ui/date-time-picker.tsx:156-166` | trigger `borderRadius`, `background`, `padding` | inline style dropped |
| `pages/calendario/agenda/EventoPopover.tsx:859`, `EventoRapidoCard.tsx:135`, `pages/calendario/camadas/CamadaPopover.tsx:377` | PopoverContent `background`, `borderColor`, `borderRadius` | these three dropped |
| `pages/mensagens/components/ConversationThread.tsx` bubbles | Tailwind look | add classes `vidro-bubble vidro-bubble--me` / `--them` |
| Entregas `ModeToggle`, `EntidadeToggle`, `PropertyPanel`; `AnalyticsContaPage.tsx` (four surfaces) | inline `background: var(--card-bg)` | inline background dropped (the family rule paints it) |
| Board-card actions using `.btn-edit-workflow`, `.btn-complete-etapa`, `.btn-revert-etapa` (all `!important` in style.css, which vidro CSS cannot beat) | classic | under Vidro, render the classes `vidro-board-action` / `--complete` / `--revert` **instead of** the `!important` class. Flag-off keeps the original class. `buttons.css` styles them as ghost, CTA and glass pills. |

## Family rules

Prefix `P` = `html[data-look='vidro'] body:has(.app-container)`. Page-body rules may narrow it to
`P .app-container`. Overlay rules use `P` directly. All values are copied from the mockup stylesheet.

### Global constraint: interaction states

The prefix is at least (0,3,1). Tailwind's `hover:`, `focus-visible:`, `disabled:` and
`data-[state=…]:` utilities are (0,2,0). So any rule that sets `background`, `color`, `box-shadow`,
`border-color` or `opacity` on an element silently kills those states.

**Every restyled interactive element restates:** `:hover`, `:focus-visible`, `:disabled` /
`[aria-disabled='true']`, and each `data-state` / `aria-pressed` / `aria-selected` / `.active` variant it
has.

- **Focus:** a visible ring, `box-shadow: 0 0 0 3px rgba(255,191,48,.55)` or the element's own existing
  ring, plus `outline: none`. When the element also has a resting shadow, both shadows are listed.
- **Disabled:** `opacity: .5; cursor: not-allowed`, with hover suppressed. Menu items restate
  `[data-disabled]` the same way.
- **Open triggers:** a Button that triggers a menu (`[data-state='open']`) shows the hover fill while the
  menu is open.
- **Select placeholder:** `[data-slot='select-trigger'][data-placeholder]` is coloured `--vd-txt3`,
  because a `<button>` has no `::placeholder`.

### 1. Buttons (`buttons.css`)

| Hook | Look |
|---|---|
| `[data-slot='button']` with `[data-variant='default'|'ink']`, `.btn-primary`, `.btn-upgrade`, `.btn-confirmar`, `.drawer-send-btn`, `.drawer-reply-btn`, `.comment-reply-submit`, `.comment-add-submit`, `.calendar-detail-btn--primary`, `.time-picker-confirm`, `.vidro-board-action--complete` | **CTA:** height 36px, radius 999px, background `--vd-cta`, colour `--vd-cta-fg`, 13px/600, padding 0 16px, `box-shadow: 0 8px 18px -8px rgba(18,21,26,.5)`. Hover: background `--vd-cta-hover`. |
| `[data-variant='outline'|'secondary']`, `.btn-secondary`, `.btn-integration`, `.calendar-detail-btn` (base), `.drawer-selection-bar-btn`, `.drawer-calendar-btn`, `.time-picker-cancel`, `.scheduled-item__open`, `.btn-instagram-action`, `.vidro-board-action--revert` | **Glass (`.btn2`):** height 36px, radius 999px, 1px `--vd-cap-bd` border, background `--vd-cap`, colour `--text-main`, 13px/600, padding 0 14px, `box-shadow: 0 6px 16px -8px rgba(18,21,26,.2)`. Hover: background `--vd-group`. `.drawer-calendar-btn.active` takes `--vd-sel`. |
| `[data-variant='ghost']`, `.btn-icon`, `.btn-icon--danger` (danger colour on hover), `.agenda-icon-btn`, `.calendar-nav button`, `.month-grid-nav-btn`, `.concluded-reopen-btn`, `.drawer-post-history-btn`, `.drawer-kebab-btn`, `.drawer-close-btn`, `.drawer-delete-btn`, `.drawer-selection-bar-btn--ghost`, `.post-editor-btn`, `.rb-edit-btn` (`-danger` hovers danger), `.rb-img-seg-btn`, `.callout-emoji-btn`, `.sidebar-action-btn`, `.comment-popover-action-btn`, `.user-dropdown-item`, `.status-cycle-btn`, `.btn-remove-member`, `.vidro-board-action`, `.vidro-cal-nav` | **Ghost:** transparent, radius 999px, no border. Hover background `--vd-fill`. Icon-only (`[data-size='icon']` or a square class) is a 32px circle. `.post-editor-btn.is-active` / `[aria-pressed='true']` takes `--vd-fill` at weight 600. |
| Parent-scoped button rules in style.css: `.board-card-actions button`, `.cliente-date-card button`, `.cliente-address-card button`, `.drawer-post-field--platform button`, `.latest-instagram-posts__pagination button`, `.agenda-mini td button`, and the rest of the `.x button` rules the scaffold task lists by grepping `style.css` for `button\s*[{,:]` | **Ghost.** The pagination and day buttons are circles. |
| `[data-variant='destructive']`, `.btn-danger`, `.btn-danger-outline` (outline: transparent background, `--vd-tg-bad` 1px border), `.calendar-detail-btn--danger`, `.btn-instagram-action--danger` | **Danger pill:** the CTA geometry, background `--vd-tg-bad-bg`, colour `--vd-tg-bad`. Hover: light, background `--danger-text` (`#b91c1c`) with colour `#fff`. Dark, background `--danger` (`#f55a42`) with colour `#12151a`: white on that fill is only about 3.3:1, while the ink label is about 5.6:1. (DESIGN_SYSTEM.md's 5.60:1 is `--danger` as text on the dark card, not white text on a `--danger` fill.) |
| `.vidro-cal-day` (DayPicker) | 32px circle, ghost. Selected becomes `--vd-cta` on `--vd-cta-fg`; today a 2px `#ffbf30` ring; outside days `--vd-txt3`. |
| `[data-variant='link']` | Unchanged. |
| `[data-size='sm']` | height 30px, 12px, padding 0 12px. |
| `[data-size='lg']` | height 40px. |
| `.board-add-card`, `.drawer-add-post-btn` | Dashed outline kept, radius 12px, border `--vd-sep`. |

The Button base `mb-2` is kept: changing a margin would change layout.

The shell spec's radius-only button rule in `vidro.css` (`border-radius: 999px` on the button classes) is
deleted; `buttons.css` owns buttons now.

### 2. Tables and list rows (`tables.css`)

- **`[data-slot='table']` and `.data-table`:** `font-size: 13px`.
  - Entregas ListView and PostsListView already use the shadcn `Table` inside `.card`, so they are
    covered.
  - The Arquivos FileGrid table gets a hand-placed `data-slot="table"`. Its rows and cells are raw, so
    the head and cell rules also match `[data-slot='table'] th` and `[data-slot='table'] td`.
- **Header cell** (`th`, `[data-slot='table-head']`): 11px/600, colour `--vd-txt3`, no uppercase, no
  letter-spacing, padding 10px 12px, 1px `--vd-sep` bottom border, background transparent.
- **Body cell** (`td`, `[data-slot='table-cell']`): padding 0 12px, height 46px, 1px `--vd-sep` bottom
  border. The last row has no border.
- **Row hover:** background `--vd-fill`, with radius 10px on the first and last cell.
  `[data-state='selected']` gets the same fill.
- **`.card:has(> [data-slot='table-container'])`, `.card:has(.data-table)`:** padding 4px, so the table
  sits in the group like the mockup `.group`.
- **List rows** (`.today-row`, `.fila-row`, `.config-member-row`, `.concluded-wf-row`): row radius 12px,
  hover `--vd-fill`, separators `--vd-sep`. `.fila-row.is-top` keeps its inset rail.

### 3. Cards and surfaces (`cards.css`)

- **Group** (background `--vd-group`, 1px `--vd-sep` border, radius 16px, no shadow):
  - `[data-slot='card']`, `.team-card`, `.today-card`, `.analytics-post-card`,
    `.latest-instagram-post-card`, `.agenda-view`, `.agenda-sidebar__card`, `.concluded-client-card`,
    `.fila-group`, `.fila-top` (keeps its primary border).
- **Tile** (background `--vd-tile`, no border, radius 16px):
  - `.config-shell`, `.post-production`, `.analytics-callout` (keeps its amber wash and left rail).
  - `.scheduled-panel` is sticky, so it takes an opaque tile: `--vd-solid`, radius 16px. Its dark
    `#0d1117` override exists for exactly this reason.
- **Analytics surfaces.** The scaffold task greps the `.analytics-*` classes in `style.css` that paint a
  surface (`background` with a border or radius) and assigns each to group or tile in this file.
  Examples are the chart wrappers, `.analytics-callout__item` and `.latest-instagram-posts`.
  `AnalyticsContaPage.tsx`'s four inline `var(--card-bg)` backgrounds join the escape table.
- **Report editor chrome:**
  - `.rb-edit-toolbar`, `.rb-text-toolbar` and `.rb-img-panel` become menus (the `--vd-menu` glass, from
    `overlays.css`'s tokens, in this file).
  - `.rb-layers-rail` becomes a tile, and `.rb-layers-row` gets the list-row rule.
  - `.rb-editor-header[data-stuck]` stays opaque (sticky rule): `--vd-solid` at 92%.
- **Ideias cards and Arquivos grid tiles** (`[data-slot='card']`, hand-placed): group.
- **Inner item** (`--vd-group`, `--vd-sep` border, radius 12px):
  - `.scheduled-item`, `.cliente-date-card`, `.cliente-address-card`, `.niche-month-card`,
    `.drawer-post-item`, `.concluded-wf-row`.
- **`[data-slot='card-title']`:** 15px/600 with -0.01em letter spacing.
- **Empty states** (`.board-empty`, `.drawer-empty`, `.cliente-finance-empty`, `.vidro-empty`): centred,
  13px, `--vd-txt3`, no dashed border except on `.cliente-finance-empty` (border colour `--vd-sep`),
  radius 16px.
  - `.vidro-empty` (EmptyStateGuide) gets background `--vd-tile`, radius 16px, padding 20px, title
    `--text-main`, body `--vd-txt2`.

### 4. Badges and pills (`badges.css`)

Mockup `.tg`: 11px/600, radius 999px, padding 2px 9px, no border (`border-color: transparent`), nowrap.

| Hook | Tone |
|---|---|
| `.badge-success` | `--vd-tg-ok` on `-bg` |
| `.badge-warning` | warn |
| `.badge-danger` | bad |
| `.badge-info` | info |
| `.badge-neutral`, bare `.badge` | neutral |
| `.badge-primary` | `#92400e` on `#fff3dc` light, `#f5b041` on `rgba(245,163,66,.18)` dark |
| `.badge-outline` | keeps its border (`--vd-sep`) |
| `.badge--solid` | keeps its solid colours, takes the geometry |
| `.badge--sm` | 10px, padding 1px 7px |

- **Same geometry, own colours kept:** `.post-status-chip` with its `.post-status--*` variables (border
  dropped), `.post-tipo-badge`, `.board-card-deadline` + `.deadline-*`, `.post-fluxo-tag` (the avulso
  dashed variant keeps its dash), `.fila-pill`, `.fila-tag`, `.auto-schedule-badge`, `.tag-pill`,
  `.board-card-approval-badge`, `.history-step-badge--*`, `.post-production-state`,
  `.board-card-type-status-chip`, `.board-card-posts-chip`, `.comment-summary-chip`.
- **Counts** (`.board-column-count`, `.today-group-count`, `.list-group-count`): as the mockup `.count`,
  plain `--vd-txt3` 11px/600 with no background, no border and no monospace.
- **`.event-pill`:** radius 6px, 11px, no monospace. It stays a compact bar inside calendar cells.

### 5. Form fields (`forms.css`)

- **Text fields** (`[data-slot='input']`, `[data-slot='textarea']`, `[data-slot='select-trigger']`,
  `.drawer-input`, `.drawer-select`, `.time-picker-select`, `.form-input`, `.comment-reply-input`,
  `.comment-add-input`, `.comment-edit-input`, `.post-editor-link-input`, and the raw
  `.app-container input[type='text'|'search'|'email'|'url'|'number'|'date'|'tel']` / `select` /
  `textarea` without another hook):
  - background `--vd-fill`, `border-color: transparent`, radius 10px, height 34px (textarea: auto,
    padding 8px 12px), 13px, colour `--text-main`;
  - placeholder `--vd-txt3`;
  - focus: background `--vd-group`, `box-shadow: 0 0 0 3px rgba(255,191,48,.45)`, plus a
    `--vd-sep` border;
  - `.form-input` loses its monospace and letter-spacing.
- **Search fields** (`input[type='search']`, and inputs with a leading search icon wrapper): pill radius
  999px, height 30px, like the mockup `.search`. The `!rounded-full !text-xs` call sites already match.
- **`[data-slot='select-trigger']`:** the chevron icon colour is `--vd-txt3`.
- **Checkbox `[data-slot='checkbox']`:** 16px, radius 5px (deliberately square: the mockup's round
  `.box` is a to-do marker, not a checkbox), 1.5px border `--vd-txt3`. Checked or indeterminate:
  background and border `--vd-cta`, check colour `--vd-cta-fg`. Restate the focus ring.
- **Switch `[data-slot='switch']`:** 38×22, radius 999px. Unchecked background `--vd-fill`, checked
  `--vd-switch-on`. Thumb (`[data-slot='switch-thumb']`) 18×18, white, `0 1px 2px rgba(0,0,0,.25)`. The
  translate comes from the existing `data-[state=checked]:translate-x-4` (16px); the geometry is
  chosen so that stays exact (border 2px, inner 34px, travel 16px).
- **Native radios:** `accent-color: var(--vd-sel)`.

### 6. Segmented controls, chips and side navs (`controls.css`)

- **The existing segmented rule in `vidro.css` stays where it is.** Added to it in this file:
  - **Segmented capsule** (same look): `.vista-tabs` / `.vista-tab` (`--active` is the selected state;
    `--add` and `-more` stay ghost), `.icon-seg` / `__item`, `[data-slot='toggle-group']` /
    `[data-slot='toggle-group-item']` when not already `.agenda-segmented`.
    - `controls.css` restates the whole track, item and selected set; it cannot append selectors to the
      rule in `vidro.css`.
    - The item rule must beat `toggle.tsx`'s `hover:bg-muted` and `data-[state=on]:bg-accent`.
  - **Chips** (mockup `.chip`: height 28px, radius 999px, `--vd-fill`, 12px/500, padding 0 12px;
    `.on` / `[aria-pressed='true']` / `[data-state='on']` take `--vd-sel` on `--vd-sel-fg`):
    `.today-chip`, `.platform-chip` (`--on`), `.icon-chip`, `.agenda-rapido__tipo`, `.list-groups-toggle`.
  - **In-page side navs** (`.cliente-tabs-nav__item`, `.config-nav-item`): height 30px, radius 10px,
    13px. The active item gets `--vd-fill` background, weight 600, no shadow. These are sub-navigation,
    so they take the quieter grey selection rather than the ink one.
- **PapeisTab's inline ToggleGroupItem styles** (`configuracao/tabs/PapeisTab.tsx:347-413`): stay. It is a
  residual.

### 7. Kanban and calendar (`boards.css`)

- **`.board-column`:** tile (`--vd-tile`, no border, no shadow, radius 16px, padding 10px).
  - `.board-column-header` is transparent with no bottom border.
  - `.board-column-title` is 12px/600, sentence case, no monospace, no letter-spacing.
  - `.board-column-body` is transparent.
- **`.board-card`, `.board-post-card`:** mockup `.kcard` (`--vd-group`, 1px `--vd-sep` border, radius
  12px, padding 10px 12px, no shadow). Hover: `box-shadow: 0 6px 16px -10px rgba(18,21,26,.3)`, and
  the existing translate is kept. `.board-drop-slot` radius is 12px.
- **`.calendar-day`, `.calendar-cell`:** `--vd-group`, `--vd-sep` border, radius 12px.
  - `.today` and `.selected` become a solid 2px `#ffbf30` border and keep the tint.
  - `.calendar-post-card` and `.sidebar-post-card` are radius 8px with a `--vd-sep` border.
- **`.agenda-fc`:** `--fc-border-color: var(--vd-sep)`. The page background and today cell use the
  tokens. Event radius 8px is unchanged.

### 8. Overlays (`overlays.css`; selectors use `P` directly, not `.app-container`)

- **Dialogs** (`[data-slot='dialog-content']`, `[data-slot='alert-dialog-content']`, `.drawer-panel`):
  background `--vd-panel` with `backdrop-filter: blur(30px) saturate(1.6)`, 1px `--vd-glass-bd`
  border, radius 20px, shadow `--vd-shadow`.
  - The fullscreen dialog variant is excluded with `:not([data-layout='fullscreen'])`.
  - The phone branch has no hook.
- **Overlays** (`[data-slot='dialog-overlay']`, `alert-dialog-overlay`, `sheet-overlay`,
  `.drawer-overlay`): background `--vd-overlay`, `backdrop-filter: blur(2px)`.
- **`[data-slot='sheet-content']`:** background `--vd-panel` with blur; radius 20px on the inner edge
  only; a 10px inset from the viewport edge is **not** applied, because the geometry is unchanged.
- **Menus** (`popover-content`, `dropdown-menu-content`, `dropdown-menu-sub-content`,
  `select-content`, `[data-slot='command']` inside the dialog, `.comment-popover`,
  `.comment-add-popover`, `.calendar-day-popover`, `.post-timeline-popover`,
  `.context-help__popover`, `.time-picker-popover`, `.mention-suggestion-list`, `.color-dropdown`):
  background `--vd-menu` with `backdrop-filter: blur(24px) saturate(1.6)`, 1px `--vd-cap-bd`
  border, radius 14px, shadow `0 18px 40px -16px rgba(18,21,26,.35)`, padding 5px.
  - **Items** (`dropdown-menu-item`, `dropdown-menu-sub-trigger`, `select-item`, `command-item`): radius
    8px, height 30px, 13px.
    - Highlighted (`[data-highlighted]`, `[aria-selected='true']`) and an open sub-trigger
      (`[data-state='open']`) get `--vd-fill`.
    - `[data-disabled]` items are at `.5` opacity.
  - Separators: `--vd-sep`.
- **Tooltip:** unchanged (it is already ink).
- **Toasts** (`.toaster [data-sonner-toast]`): menu glass, radius 14px. The action and cancel buttons
  take the CTA and ghost looks.
- **Fallbacks:** under `prefers-reduced-transparency: reduce` and
  `@supports not (backdrop-filter: blur(1px))`, `--vd-menu` and the dialog panel use `--vd-solid`.

### 9. Chat bubbles (`chat.css`)

- **`.vidro-bubble`:** radius 18px, padding 9px 13px, 13px, line-height 1.4.
  - `--me`: `--vd-sel` on `--vd-sel-fg`, bottom-right radius 6px.
  - `--them`: `--vd-fill`, bottom-left radius 6px.
- **`.approval-bubble--team`** takes `--me` and **`--client`** takes `--them`. Their margins are kept.

### 10. Compositions (`compositions.css`, owned by the verification task)

This is the only place where rules combine families. Examples: a button inside a table cell
(`[data-size='icon']` circle at 28px), badges inside kanban cards (`--sm`), a card inside a dialog
(`[data-slot='card']` in `dialog-content` becomes a tile), a table inside a dialog.

### Sidebar default open (TSX, `AppLayout.tsx` `useSidebarPinned`)

- **Tri-state storage:** `useSidebarPinned` reads `'1'`, `'0'` or unset. A storage read that throws
  counts as unset. Only a click on the pin toggle writes storage, as today.
- **Effective value:**
  - `'1'` means pinned and `'0'` means rail, whatever the look. This is today's behaviour.
  - Unset follows the **look**, meaning `vidro.active` (flag on and not opted out). It does not follow
    `vidroShell`, which is also false at tablet widths, where pinning is irrelevant anyway.
  - It is a derived value, not a one-shot effect. While storage is unset:
    `pinned = vidroAttributeSeed || vidro.active` before the limits query resolves, and
    `pinned = vidro.active` after.
  - `useVidro` exposes a new `isResolved` (= the limits query's `isSuccess`) for this.
    `vidroAttributeSeed` is `isVidroAttributeSet()` read once at mount.
- **Consequences:**
  - Opting out with nothing stored returns the rail; opting back in returns the pinned sidebar.
  - A late flag flip follows the look.
  - No storage is written until the user chooses.
- **Classic and flag-off:** unchanged, because unset means the rail.
- **Tests:** the `useVidro` mock in `AppLayout.test.tsx` gains `isResolved`. The flag-off matrix there
  is unaffected, because `active` is false.

## File layout

```
apps/crm/src/styles/
  vidro.css                    shell (existing). Its token block moves to body:has(.app-container); its button radius rule is deleted.
  vidro-body/
    tokens.css                 new --vd-* tokens + remapped shared tokens (light + dark)
    buttons.css  tables.css  cards.css  badges.css  forms.css
    controls.css  boards.css  overlays.css  chat.css
    compositions.css
```

`main.tsx` imports them right after `./styles/vidro.css`, in the order listed (`tokens` first,
`compositions` last). Each file has the same header comment and the same guards as `vidro.css`.

**Ownership rule:** a family file only holds selectors for its own family. A rule that needs two
families goes in `compositions.css`.

**Serial scaffold first.** One task runs before any family task and does every shared edit, so the
family tasks only fill their own CSS file and the TSX escapes they own:
- all primitive hooks and their unit tests;
- the hand-placed hooks;
- the inert hook classes (`vidro-cal-*`);
- the ten `main.tsx` imports;
- the empty family files with headers;
- both `vidro.css` edits (the token move and the button-radius rule deletion);
- `tokens.css` filled in;
- the contract-test extension;
- the sidebar default.

## Contract test

`vidroContracts.test.ts` iterates over `vidro.css` and every `vidro-body/*.css`:
- each file keeps the existing guards;
- new rule: every selector containing an exact overlay hook must contain `body:has(.app-container)`.
  The hooks are `[data-slot='dialog-overlay']`, `dialog-content`, `alert-dialog-overlay`,
  `alert-dialog-content`, `sheet-overlay`, `sheet-content`, `popover-content`, `dropdown-menu-content`,
  `dropdown-menu-sub-content`, `select-content` and `command`, plus `[data-sonner-toast]`;
- the `.card :not()`-chain assertion stays specific to `vidro.css` and `cards.css`, and is not run over
  the other files;
- `tokens.css` declares every new token in both the light and the dark block;
- `main.tsx` imports every `vidro-body` file after `vidro.css`.

## Residuals (accepted)

- **45 Tailwind-only `<button>`s with no class hook** change colour through the token remap only. The
  final sweep lists any that are visibly off-look.
- **Call-site inline `TableCell` / `TableHead` padding** (Clientes, Equipe, Financeiro, Automações,
  LeadsPage headers) keeps its padding. Row height still applies.
- **Remaining inline `var(--card-bg)` / `var(--surface-main)` backgrounds:**
  - In light they are invisible (`#fff` on a 94% white panel). In dark they show as a faint `#12151a`
    patch.
  - Not escaped: `ExpressPostPage.tsx` ×4, `PapeisTab.tsx` ×2, `EventoFormDialog.tsx` ×2,
    `shared/ColorPicker.tsx` ×2, `TarefaDetailSheet`, `AddWidgetDrawer`, `ConversationList`,
    `TikTokSettingsPanel`, `PostAutomationSection`, `EntregasPage`, `AgentPendingSection`.
  - Escaped: the Entregas trio and AnalyticsConta.
- **`.post-detail-row td`** (`!important` background) and the remaining `!important` classes in
  style.css stay classic. The board-card actions are escaped.
- **PapeisTab segment inline styles** stay.
- **Mensagens bubbles** need the class hook (listed above). Any other Tailwind-only bubble stays.
- **Avatars** are unchanged (the mockup uses the same circles).

## Verification

- **Gates:** lint, format, tsc ×4, vitest, plus the contract test.
- **Flag off:** pixel parity against `origin/main`. Same harness as the shell: 21 pages at 1440, plus
  three overlay states (a Dialog, a DropdownMenu, a Select open).
- **Flag on:** a sweep of every page at 1440 light, 1440 dark and 1101 (sidebar pinned, now the
  default), plus a dialog, menu, select, popover and sheet in light and dark.
- **States harness mode** on Clientes, Entregas (board), Tarefas and Configurações:
  - tab to a Button, a table row link, a Switch, a Checkbox and an Input; each `:focus-visible` must
    have an outline or box-shadow other than `none`;
  - hover a table row and a ghost button; the background must change;
  - a disabled Button must have opacity below 1.
- **The behaviour matrix still passes.** Check 6 seeds `sidebar-pinned='0'`. A new check: a fresh user
  with nothing stored gets the sidebar pinned under Vidro and the rail under classic.
- **Pinned 1101 check:** toolbar tooltips must not clip.
- **Real screenshots** are published to the canvas next to the `V3-*` boards.

## Out of scope

- Layout reshapes (inspector, KPI rows, list-row Início, Cliente tabs in the toolbar).
- Tablet and phone.
- The Hub and the Admin.
- The marketing pages and the auth routes.
- Report editor block canvas: token remap only (see Tokens). The editor chrome is covered in §3.
