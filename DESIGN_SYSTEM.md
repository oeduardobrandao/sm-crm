# Mesaas — Design System

**React 19 + Tailwind CSS 3.4 + shadcn/ui (Radix).** There is no Ant Design in this repo.

The three apps do *not* share one design system. They share a Tailwind config and the
shadcn HSL token names; everything else — fonts, palette, component set — differs per app.

| App | Stylesheet | Fonts | Look |
|---|---|---|---|
| `apps/crm` | `apps/crm/style.css` (~9.9k lines) | SF Pro (system) | Dense internal dashboard |
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

### Two token systems, side by side

`style.css` defines shadcn HSL tokens **and** an older hex palette. Both are live. shadcn
components read the first; hand-written CSS and inline styles read the second.

shadcn tokens (`@layer base`, lines 37–82) — light and `[data-theme='dark']`:
`--background --foreground --card --popover --primary --secondary --muted --accent
--destructive --border --input --ring`.

Legacy hex tokens (unlayered `:root`, lines 93–166):

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
`:root` at line 137 then sets `--radius: 12px`. Unlayered declarations outrank layered ones,
so **12px wins** — `rounded-lg` is 12px, `rounded-md` 10px, `rounded-sm` 8px. Editing the
value inside `@layer base` changes nothing.

### Typography

`--font-main` and `--font-mono` are `'SF Pro Text'`; `--font-heading` is `'SF Pro Display'`;
`body` uses `var(--font-main)` at weight 400 with antialiasing. On non-Apple platforms these
fall through to the generic `sans-serif`.

Plus Jakarta Sans *is* loaded from Google Fonts in `apps/crm/index.html`, but only the
marketing landing page references it, and there only as a fallback behind SF Pro. A handful
of files still name `Playfair Display` / `DM Sans` inside `var(--font-heading, …)` fallbacks
and chart configs — leftovers from an older system, not live choices.

### Layout

`--sidebar-width: 260px`, `--topbar-height: 52px`, `--banner-height: 0px` (raised when a
banner shows). `.main-content` offsets itself with `margin-left: var(--sidebar-width)`.

| Viewport | Sidebar |
|---|---|
| ≥ 1101px | Static; `.main-content` is inset by 260px |
| 768–1100px | Off-canvas drawer; `margin-left: 0 !important` |
| ≤ 900px | Drawer + bottom nav |
| ≤ 768px | Further compaction |

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
`style.css`, keyed off the legacy hex tokens.

## Hub (`apps/hub`)

The client portal ships no `.css` file of its own. Its styles are an inline `<style>` block in
`apps/hub/index.html` (36 distinct `.hub-*` selectors) plus Tailwind utilities — **and the
entire CRM stylesheet**, which `apps/hub/src/main.tsx` imports directly:

```ts
import '../../crm/style.css';
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

## Shared

`packages/ui` is small — currently just `FlagIcon`. Icons are `lucide-react` everywhere.

## Changing things

| Change | Where |
|---|---|
| Tailwind colour/radius/font token names | `tailwind.config.js` |
| CRM palette, light + dark | `@layer base` block and unlayered `:root` in `apps/crm/style.css` |
| CRM component styles | search the class name in `apps/crm/style.css` |
| Hub palette / fallbacks | `<style>` in `apps/hub/index.html`; resolved values in `apps/hub/src/theme.ts` |
| Admin palette | `apps/admin/src/globals.css` |
| New shadcn primitive | `npx shadcn@latest add <name>` |

One more trap: `html, body, #root, .app-container` are pinned to `overflow-x: hidden` at the
top of `style.css`. That silently disables `position: sticky` for descendants in **both** apps,
and can leave `window.scrollY` stuck at 0.
