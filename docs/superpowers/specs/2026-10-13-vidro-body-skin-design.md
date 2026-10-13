# Vidro body skin: design

**Status:** spec. The owner's approval gates are replaced by a Fable review.
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
  - Switch checked becomes `#34c759`.
  - Checkbox checked becomes ink.
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
| `--vd-switch-on` | `#34c759` | `#30d158` | `.tgl` |
| `--vd-overlay` | `rgba(18,21,26,.32)` | `rgba(0,0,0,.55)` | new |
| `--vd-menu` | `rgba(255,255,255,.86)` | `rgba(30,34,42,.86)` | new (glass menus) |

The existing tokens (`--vd-panel`, `--vd-tile`, `--vd-group`, `--vd-sep`, `--vd-fill`, `--vd-sel`,
`--vd-txt3`, `--vd-cap*`, `--vd-shadow`) keep their values.

### Remapped shared tokens (same selector as the `--vd-*` block)

**Safe to remap.** These are only ever used as surface or border colours:

| Token | Light | Dark |
|---|---|---|
| `--border-color` | `var(--vd-sep)` | `var(--vd-sep)` |
| `--surface-hover` | `var(--vd-fill)` | `var(--vd-fill)` |
| `--surface-1` | `#f4f4f6` | `rgba(255,255,255,.05)` |
| `--surface-2` | `rgba(118,118,128,.12)` | `rgba(118,118,128,.24)` |
| `--surface-3` | `rgba(118,118,128,.2)` | `rgba(118,118,128,.32)` |
| shadcn `--border`, `--input` | opaque HSL of `--vd-sep` composited on the panel: light ≈ `240 3% 91%`, dark ≈ `220 8% 15%` | |
| shadcn `--muted`, `--accent` | opaque HSL of `--vd-fill` on the panel: light ≈ `240 5% 94%`, dark ≈ `223 8% 17%` | |
| shadcn `--popover`, `--card` | light `0 0% 100%`, dark `220 15% 10%` | |

The HSL values must be bare channel triplets, as the design system requires. The implementer computes
the exact composite and records the arithmetic in a comment.

**Not remapped:**

| Token | Why |
|---|---|
| `--card-bg` | Used as a foreground: `[data-tooltip]` text and the kanban avatar ring. `--vd-group` in dark is `rgba(255,255,255,.03)`, which would make tooltip text vanish. |
| `--text-main`, `--text-muted`, `--text-light`, `--danger*`, `--primary*` | Text contrast was audited. |
| shadcn `--background`, `--foreground`, `--ring`, `--primary` | `--background` paints the body behind the panel. |
| `--radius` | Component rules own the radii. |

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
| Dialog | `dialog-overlay`, `dialog-content` (desktop branch only; the phone branch is untouched) |
| AlertDialog | `alert-dialog-overlay`, `alert-dialog-content` |
| Sheet | `sheet-overlay`, `sheet-content` |
| Popover | `popover-content` |
| DropdownMenu | `dropdown-menu-content`, `dropdown-menu-sub-content`, `dropdown-menu-item` (also on checkbox and radio items), `dropdown-menu-separator`, `dropdown-menu-label` |
| Command | `command`, `command-input`, `command-item` |
| ToggleGroup | `toggle-group`, `toggle-group-item` |
| Tooltip | `tooltip-content` |
| Calendar | `calendar` on the root |

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
- **Disabled:** `opacity: .5; cursor: not-allowed`, with hover suppressed.

### 1. Buttons (`buttons.css`)

| Hook | Look |
|---|---|
| `[data-slot='button'][data-variant='default'|'ink']`, `.btn-primary`, `.btn-confirmar`, `.drawer-send-btn`, `.drawer-reply-btn`, `.comment-reply-submit`, `.comment-add-submit`, `.calendar-detail-btn--primary` | **CTA:** height 36px, radius 999px, background `--vd-cta`, colour `--vd-cta-fg`, 13px/600, padding 0 16px, `box-shadow: 0 8px 18px -8px rgba(18,21,26,.5)`. Hover: `filter: brightness(1.12)` on light, `.92` on dark. |
| `[data-variant='outline'|'secondary']`, `.btn-secondary`, `.drawer-close-btn` (when text), `.drawer-selection-bar-btn`, `.drawer-calendar-btn`, `.time-picker-cancel`, `.scheduled-item__open`, `.btn-instagram-action` | **Glass (`.btn2`):** height 36px, radius 999px, 1px `--vd-cap-bd` border, background `--vd-cap`, colour `--text-main`, 13px/600, padding 0 14px, `box-shadow: 0 6px 16px -8px rgba(18,21,26,.2)`. Hover: background `--vd-group`. |
| `[data-variant='ghost']`, `.btn-icon`, `.agenda-icon-btn`, `.calendar-nav button`, `.month-grid-nav-btn`, `.concluded-reopen-btn`, `.drawer-post-history-btn`, `.drawer-kebab-btn` | **Ghost:** transparent, radius 999px, no border. Hover background `--vd-fill`. Icon-only (`[data-size='icon']` or a square class) is a 32px circle. |
| `[data-variant='destructive']`, `.btn-danger`, `.calendar-detail-btn--danger`, `.btn-instagram-action--danger` | **Danger pill:** the CTA geometry, background `--vd-tg-bad-bg`, colour `--vd-tg-bad`. Hover: background `--danger`, colour `#fff`. |
| `[data-variant='link']` | Unchanged. |
| `[data-size='sm']` | height 30px, 12px, padding 0 12px. |
| `[data-size='lg']` | height 40px. |
| `.board-add-card`, `.drawer-add-post-btn` | Dashed outline kept, radius 12px, border `--vd-sep`. |
| `.btn-edit-workflow` | Stays classic: it is `!important`, a residual. |

The shell spec's radius-only button rule in `vidro.css` (`border-radius: 999px` on the button classes) is
deleted; `buttons.css` owns buttons now.

### 2. Tables and list rows (`tables.css`)

- **`[data-slot='table']`, `.data-table`, `.list-view table`** (Entregas ListView/PostsListView: scope by
  their wrapper class) and the Arquivos FileGrid table: `font-size: 13px`.
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
  - `.scheduled-panel`, `.config-shell`, `.post-production`, `.analytics-callout` (keeps its amber wash
    and left rail).
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
- **Count pills** (`.board-column-count`, `.today-group-count`, `.list-group-count`): `--vd-fill`, no
  border, 11px/600, no monospace.
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
- **Checkbox `[data-slot='checkbox']`:** 16px, radius 5px, 1.5px border `--vd-txt3`. Checked or
  indeterminate: background and border `--vd-sel`, check colour `--vd-sel-fg`. Restate the focus ring.
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
  - The fullscreen dialog variant and the phone branch are untouched.
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
  - **Items** (`dropdown-menu-item`, `select-item`, `command-item`): radius 8px, height 30px, 13px.
    Highlighted (`[data-highlighted]`, `[aria-selected='true']`) gets `--vd-fill`.
  - Separators: `--vd-sep`.
- **Tooltip:** unchanged (it is already ink).
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

- **Initial value:**
  - A stored `'1'` or `'0'` wins, as today.
  - When nothing is stored, start pinned exactly when `isVidroAttributeSet()` is true. The pre-paint
    has already set the attribute, so there is no rail-to-pinned shift on load.
- **When the flag resolves later:** if nothing is stored and the resolved `vidroShell` disagrees with the
  initial value, follow `vidroShell` once. Do not write storage until the user clicks the toggle.
- **Classic and flag-off:** unchanged (nothing stored means the rail).

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

## Contract test

`vidroContracts.test.ts` iterates over `vidro.css` and every `vidro-body/*.css`:
- each file keeps the existing guards;
- new rule: every selector containing an overlay hook (`dialog-`, `sheet-`, `popover-`,
  `dropdown-menu-`, `select-content`, `select-item`, `command`, `.drawer-overlay`, `.drawer-panel`, the
  popover classes) must contain `body:has(.app-container)`;
- `tokens.css` declares every new token in both the light and the dark block;
- `main.tsx` imports every `vidro-body` file after `vidro.css`.

## Residuals (accepted)

- **About 700 raw Tailwind `<button>`s with no hook** (261 in Entregas) change colour through the token
  remap only, not shape. Their radius stays whatever the class string says.
- **Call-site inline `TableCell` / `TableHead` padding** (Clientes, Equipe, Financeiro, Automações,
  LeadsPage headers) keeps its padding. Row height still applies.
- **`.btn-edit-workflow`** and the other `!important` classes in style.css stay classic.
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
- Report editor internals (the block canvas). The editor chrome takes the families like any page.
