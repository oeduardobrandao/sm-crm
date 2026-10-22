# Mesaas — Design System

**React 19 + Tailwind CSS 3.4 + shadcn/ui (Radix).** There is no Ant Design in this repo.

The three apps do *not* share one design system. They share a Tailwind config and the
shadcn HSL token names; everything else — fonts, palette, component set — differs per app.

| App | Stylesheet | Fonts | Look |
|---|---|---|---|
| `apps/crm` | `apps/crm/style.css` (core, ~2.9k lines) + `apps/crm/app.css` (signed-in shell, ~17.6k lines) | SF Pro (system) | Dense internal dashboard |
| `apps/hub` | inline `<style>` in `apps/hub/index.html` | Fraunces + Instrument Sans | Editorial, whitelabelled per client |
| `apps/admin` | `apps/admin/src/globals.css` | SF Pro | Platform admin, liquid-glass chrome |

## How it's wired

One Tailwind config at the repo root, [`tailwind.config.js`](tailwind.config.js), scans all
three apps plus `packages/`. There is no per-app config.

- **Dark mode:** `darkMode: ["class", "[data-theme='dark']"]`. Toggling means setting
  `data-theme="dark"`, not adding a `.dark` class.
- **Colours** are Tailwind names bound to CSS variables holding *HSL channel triplets*:
  `primary: "hsl(var(--primary))"` where `--primary: 47.9 95.8% 53.1%`. A variable must be
  bare channels — putting `#ffbf30` in one of these breaks the `hsl()` wrapper.
- **Fonts:** only two families are registered — `font-mono` → `SF Pro Text`, `font-sf` → the
  Apple system stack. There is no `font-sans` override, so `font-sans` stays Tailwind's default.
- **Radius:** `rounded-lg/md/sm` derive from `--radius`.

shadcn is configured by [`components.json`](components.json) at the root — style `default`,
base colour `neutral`, CSS variables on, `lucide` icons.

**That config predates the monorepo and its paths no longer resolve.** It points `tailwind.css`
at `style.css` and aliases `@/components` to `@/components`, which from the repo root means
`src/components` — and there is no `src/` or `style.css` at the root any more. So
`npx shadcn@latest add <name>` run from the root does *not* land in
`apps/crm/src/components/ui/`. Either fix the paths first, or copy the generated component
into `apps/crm/src/components/ui/` by hand and correct its imports.

## CRM (`apps/crm`)

### Two stylesheets: core (`style.css`) and app (`app.css`)

The hand-written CSS is split in two files. Each starts with a header comment saying what
belongs there.

| File | Loads | Holds |
|---|---|---|
| `apps/crm/style.css` (**core**) | Render-blocking on every page, from `main.tsx` | The `@tailwind` directives, both token systems, global element/reset rules, `.ph-spin`, and every rule a **public** page can render: landing, preços, blog, marketing pages, novidades, legal pages, login/criar conta, configurar-senha, conectar, afiliados, 404, the cookie banner + preferences dialog, toasts and the dialog primitives the entry renders |
| `apps/crm/app.css` (**app**) | With the ProtectedRoute chunk, via `src/styles/app-shell.ts` | Rules only the signed-in shell renders |

A rule belongs in `app.css` only if **every** selector names at least one class (outside
`:is()`/`:not()`/`:has()`/`:where()` arguments) that no public code uses. Element, attribute
and `:root` selectors, `@apply` and `@layer` (they need the Tailwind directives in the same
file), and keyframes a core rule animates with stay in core. Not sure? Put it in core: a rule
in the wrong file costs bytes there, but in `app.css` it leaves a public page unstyled.

[`cssSplitBoundary.test.ts`](apps/crm/src/__tests__/cssSplitBoundary.test.ts) enforces it.
It walks the imports from `main.tsx`, the public lazy routes in `App.tsx` and the prerender
script, without entering `ProtectedRoute`, `AppLayout` or an authenticated page. It collects
the class names in those files' string and template literals (`` `status-${x}` `` makes every
`status-*` class public), and fails on any `app.css` selector whose classes are all public. So a
public page that starts using an app-only class fails CI, not production.

**Cascade:** `app.css` loads after all of `style.css`, on authenticated pages and in the Hub
alike. A rule there beats a `style.css` rule of equal specificity even when it used to come
first in the old single file. The split kept a rule in core whenever moving it could flip such
a tie. Check for that when you move a rule across. Tailwind's **variant** utilities (`hover:`,
`focus-visible:`, `data-[state=on]:`, `md:`, `dark:`...) are emitted at the end of `style.css`, the
file holding `@tailwind utilities`, so they load before `app.css` too: a rule like
`.x[data-state='on']` (0,2,0) on an element that also carries `data-[state=on]:bg-accent` (0,2,0,
often via a `components/ui` primitive's cva) would win from `app.css` where it lost in the old
file. Such rules stay in `style.css`; the guard test checks this as well, asking Tailwind for each
variant's selector and properties.

Tests that assert on CRM rules wherever they live read both files through
`readCrmCss()` (`apps/crm/src/test/readCrmCss.ts`).

### Two token systems, side by side

`style.css` defines shadcn HSL tokens **and** an older hex palette. Both are live. shadcn
components read the first; hand-written CSS and inline styles read the second.

shadcn tokens (`@layer base`, lines 52–99) — light and `[data-theme='dark']`:
`--background --foreground --card --popover --primary --secondary --muted --accent
--destructive --border --input --ring`.

Legacy hex tokens (unlayered `:root` and `[data-theme='dark']`, lines 110–193):

| Token | Light | Dark |
|---|---|---|
| `--primary-color` | `#ffbf30` | same |
| `--primary-hover` | `#ca8a04` | same |
| `--success` / `--warning` / `--danger` | `#3ecf8e` / `#f5a342` / `#f55a42` | same |
| `--danger-text` | `#b91c1c` | `#f55a42` |
| `--teal` / `--pink` / `--dark` | `#42c8f5` / `#f542c8` / `#12151a` | same |
| `--bg-color` | `#fdfdfd` | `#0a0c0f` |
| `--card-bg` | `#ffffff` | `#12151a` |
| `--surface-main` / `--surface-hover` | `#ffffff` / `#f8fafc` | `#1a1e26` / `#1e2430` |
| `--surface-1/2/3` (drawer, editor) | `#f5f6f8` / `#eceef2` / `#e2e4e9` | `#1a1e26` / `#1e2430` / `#252b38` |
| `--text-main` / `--text-muted` / `--text-light` | `#12151a` / `#374151` / `#4b5563` | `#e8eaf0` / `#9ca3af` / `#94a3b8` |
| `--border-color` | `rgba(30,36,48,.102)` | `#1e2430` |

**`--danger` is not an accessible text colour.** At 3.27:1 on a white card it fails the 4.5:1
AA floor, so error *copy* uses `--danger-text`; `--danger` stays a fill/border colour. On dark
`--danger` clears AA at 5.60:1 and the two converge.

### Gotcha: `--radius` is defined twice

`@layer base :root` sets `--radius: 0.625rem` (10px, the shadcn default); the **unlayered**
`:root` at line 160 then sets `--radius: 12px`. Unlayered declarations outrank layered ones,
so **12px wins** — `rounded-lg` is 12px, `rounded-md` 10px, `rounded-sm` 8px. Editing the
value inside `@layer base` changes nothing.

### Typography

`--font-main` and `--font-mono` are `'SF Pro Text'`; `--font-heading` is `'SF Pro Display'`;
`body` uses `var(--font-main)` at weight 400 with antialiasing. On non-Apple platforms these
fall through to the generic `sans-serif`.

No sans web font is loaded: the landing and marketing pages use SF Pro on Apple devices and
`system-ui` elsewhere (Roboto on Android). Plus Jakarta Sans was dropped there because its
late swap shifted the server-rendered hero. A handful
of files still name `Playfair Display` / `DM Sans` inside `var(--font-heading, …)` fallbacks
and chart configs — leftovers from an older system, not live choices.

### Layout

`--sidebar-width: 260px`, `--topbar-height: 52px`, `--banner-height: 0px` (raised when a
banner shows). `.main-content` offsets itself with `margin-left: var(--sidebar-width)`.

| Viewport | Sidebar |
|---|---|
| ≥ 1101px | Static. 64px icon rail by default, expands over the content on hover; pinned open, `.main-content` is inset by 260px |
| 768–1100px | Off-canvas drawer; `margin-left: 0 !important` |
| ≤ 900px | Drawer + bottom nav |
| ≤ 768px | Further compaction |

The pin toggle sits at the top of the sidebar, aligned with the nav icons. Unpinned, `AppLayout` sets
`data-sidebar-collapsed` on `.app-container` and CSS overrides `--sidebar-width: 64px` there;
hovering only widens the sidebar itself (`.sidebar--overlay`), so the content never moves until
the user pins (persisted in localStorage `sidebar-pinned`). Anything inset by the sidebar should
read `var(--sidebar-width)`, never a literal 260px.

**Anything `position: fixed` and anchored to the sidebar must be `display: none` by default
and only shown inside `@media (min-width: 1101px)`** — below that the sidebar isn't there and
the content is flush left. jsdom cannot evaluate media queries, so responsive show/hide has
to be verified in a real browser.

Content padding is `clamp(1.25rem, 3vw, 2.5rem)` block / `clamp(1rem, 3vw, 3rem)` inline.

### Components

34 shadcn primitives in `apps/crm/src/components/ui/` — including `alert-dialog`, `calendar`,
`command`, three date pickers, `dialog`, `dropdown-menu`, `form`, `popover`, `select`, `sheet`,
`table`, `tabs`, `toggle-group`, `tooltip`. Toasts go through `sonner` (`sonner.tsx`); prefer
`toast()` from `sonner` over the legacy `showToast()` in `router.ts`.

Everything else — sidebar, KPI cards, kanban board, avatars — is hand-written CSS in
`style.css` or `app.css`, keyed off the legacy hex tokens.

### Shell-only CSS (`src/styles/app-shell.ts`)

Styles only the signed-in shell renders stay out of the entry's render-blocking stylesheet,
which every public page (landing, pricing, blog, login) downloads. `app-shell.ts` is a
side-effect module imported by `components/layout/ProtectedRoute.tsx` alone, so its CSS rides
that lazy chunk; Vite's preload helper waits for the CSS before the chunk runs, so the shell
never paints unstyled. In order it pulls in:

- **Phosphor icons** (`<i class="ph ph-...">`, also `ph-bold`/`ph-fill`), self-hosted from the
  npm package `@phosphor-icons/web`, pinned exactly at `2.1.2`. Only regular, bold and fill are
  imported; add another weight here if you use one. The fonts are emitted as hashed `/assets/`
  files. There is no CDN loader in `index.html` any more, so a Phosphor icon on a public page
  renders blank: use `lucide-react` there. `.ph-spin` is not part of Phosphor; it lives in
  `style.css`.
- `apps/crm/app.css`.
- **Vidro** (`styles/vidro.css`, then `styles/vidro-body/*.css` in a fixed order that
  `vidroContracts.test.ts` pins). Every rule is scoped to `html[data-look="vidro"]`.

`App.tsx` warms the ProtectedRoute chunk at module scope for visitors with a stored session, but
only on `app.html` (the one page with a `noindex` robots meta), so a signed-in visitor reading a
prerendered public page never downloads the shell CSS or the icon fonts.

## Hub (`apps/hub`)

The client portal ships no `.css` file of its own. Its styles are an inline `<style>` block in
`apps/hub/index.html` (36 distinct `.hub-*` selectors) plus Tailwind utilities — **and the
entire CRM stylesheet**, core and app, which `apps/hub/src/main.tsx` imports directly, in the
same order the CRM's authenticated pages load them:

```ts
import '../../crm/style.css';
import '../../crm/app.css';
```

So the Hub inherits every CRM global: the `body` and `#root` rules, the `overflow-x: hidden`
pin, both token systems, and the reset. A change to CRM globals changes the Hub too, and the
Hub is the app least likely to be re-checked after a CRM styling change.

- **Fonts:** `--hub-font-display` = Fraunces (serif, optical sizing), `--hub-font-sans` =
  Instrument Sans, with `font-feature-settings: 'ss01','cv11'`. `.font-display` opts into the
  serif.
- **Whitelabel:** every `--hub-*` value in `index.html` is a *fallback only*.
  [`HubShell`](apps/hub/src/shell/HubShell.tsx#L66) calls `resolveHubTheme(brand_color, isDark)`
  from [`theme.ts`](apps/hub/src/theme.ts#L41) and writes the resolved variables inline before
  paint. The client's `brand_color` drives `--hub-acc`, and `--hub-acc-fg` is derived for
  contrast (a light accent flips the foreground to `#171717`).
- Surfaces: `--hub-bg --hub-card --hub-soft`; text ramp `--hub-txt --hub-tx2 --hub-tx3`;
  borders `--hub-bd --hub-bd2`. Cards are 12px radius with a two-layer shadow.

**Tailwind variants do not work on `hub-*` classes.** They are hand-written CSS, not Tailwind
utilities, so `hover:hub-card` or `md:hub-txt` compile to nothing. Use arbitrary values or add
an explicit rule.

## Admin (`apps/admin`)

`apps/admin/src/globals.css` carries its own shadcn token set — a cooler, greyer palette
(`--background: 220 17% 95%` against the CRM's near-white), `--radius: 0.75rem`, plus
`--primary-hover`, `--dim-foreground`, `--success` and `--warning`, which the CRM's shadcn
layer does not define. Liquid-glass chrome lives in `apps/admin/src/liquidglass/glass.css`.

That effect is **CSS `backdrop-filter`, deliberately not WebGL.** A real WebGL liquid-glass
pass hides the elements it targets (`opacity: 0`), and its single shared canvas fights layered
fixed/sticky chrome.

### Primitives

`apps/admin/src/components/ui/` holds **copies** of the CRM's shadcn primitives (button, input,
textarea, select, switch, table, dropdown-menu, checkbox, skeleton, tabs, label, separator,
tooltip), plus an admin-only `badge.tsx` (same API as the CRM Badge, implemented on Tailwind
tokens because the admin does not load `apps/crm/style.css`) and `card.tsx`. They import `cn`
from `../../lib/utils`, never `@/lib/utils`. A fix to a primitive on one side must be mirrored
on the other by hand; nothing enforces parity. Composition components (`EmptyState`,
`ErrorState`, `PageHeader`) live in `apps/admin/src/components/`. Clickable rows use
`RowLink`/`RowButton` from `apps/admin/src/components/RowLink.tsx` so the primary cell is a
real link or button.

The Admin's copy is Portuguese throughout.

## Shared

`packages/ui` is small — currently just `FlagIcon`. Icons are `lucide-react` everywhere, plus
Phosphor inside the CRM's signed-in shell (see Shell-only CSS above).

## Changing things

| Change | Where |
|---|---|
| Tailwind colour/radius/font token names | `tailwind.config.js` |
| CRM palette, light + dark | `@layer base` block and unlayered `:root` in `apps/crm/style.css` |
| CRM component styles | search the class name in `apps/crm/style.css` and `apps/crm/app.css` (which file: see "Two stylesheets" above) |
| Hub palette / fallbacks | `<style>` in `apps/hub/index.html`; resolved values in `apps/hub/src/theme.ts` |
| Admin palette | `apps/admin/src/globals.css` |
| New shadcn primitive | `npx shadcn@latest add <name>` |

One more trap: `html, body, #root, .app-container` are pinned to `overflow-x: hidden` at the
top of `style.css`. That silently disables `position: sticky` for descendants in **both** apps,
and can leave `window.scrollY` stuck at 0.
