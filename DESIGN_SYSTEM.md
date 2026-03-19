# Mesaas — Design System

This project uses **React 18 + Ant Design v5**. Design tokens are configured in `src/App.tsx` via `ConfigProvider`. Global layout/sidebar styles remain in `style.css`.

---

## Ant Design Theme Configuration

Tokens are set in `src/App.tsx`:

```tsx
<ConfigProvider theme={{ token: { colorPrimary: '#eab308', borderRadius: 10 } }}>
```

| Token | Value | Notes |
|-------|-------|-------|
| `colorPrimary` | `#eab308` | Brand yellow — buttons, active states, links |
| `borderRadius` | `10` | Base radius for antd components |

All antd component styling (modals, tables, dropdowns, selects, spinners, toasts via `message`) inherits from this theme configuration.

---

## Color Palette

### Brand Colors
| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--primary-color` | `#eab308` | same | CSS-based elements, active states, accents |
| `--primary-hover` | `#ca8a04` | same | Primary hover |
| `--success` | `#3ecf8e` | same | Success states, positive metrics |
| `--warning` | `#f5a342` | same | Caution states |
| `--danger` | `#f55a42` | same | Errors, destructive actions |
| `--teal` | `#42c8f5` | same | Informational accents |
| `--dark` | `#12151a` | same | Dark backgrounds |
| `--pink` | `#f542c8` | same | Special accents |

### Surface Colors
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `--bg-color` | `#f0f2f5` | `#0a0c0f` |
| `--sidebar-bg` | `#12151a` | `#12151a` |
| `--card-bg` | `#ffffff` | `#12151a` |
| `--surface-main` | `#ffffff` | `#1a1e26` |
| `--surface-hover` | `#f8fafc` | `#1e2430` |
| `--surface-light` | `#ffffff` | `#12151a` |
| `--surface-darker` | `#f1f5f9` | `#050608` |

### Text Colors
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `--text-main` | `#12151a` | `#e8eaf0` |
| `--text-muted` | `#374151` | `#9ca3af` |
| `--text-light` | `#4b5563` | `#94a3b8` |

### Border & Shadow
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `--border-color` | `rgba(30, 36, 48, 0.15)` | `#1e2430` |
| `--shadow` | `0 10px 40px -10px rgba(0,0,0,0.08)` | `0 10px 40px -10px rgba(0,0,0,0.2)` |

### Specialty Colors
- **Auth page background**: `#eaf0dc` with gradient to `#eab308`
- **Auth logo**: `#3462ee`
- **Instagram accent**: `#E1306C`

---

## Typography

### Font Families
| Token | Value | Usage |
|-------|-------|-------|
| `--font-main` | `'DM Sans', sans-serif` | Body text, UI elements (weight: 300 base) |
| `--font-heading` | `'Playfair Display', serif` | Page headings, display text |
| `--font-mono` | `'DM Mono', monospace` | Form inputs, data display, code |

### Type Scale
| Element | Size | Weight | Notes |
|---------|------|--------|-------|
| Page titles (h1) | `clamp(2rem, 4vw, 3.2rem)` | 900 | Fluid/responsive |
| Card headers (h3) | `1.15rem – 1.2rem` | 700 | |
| Body text | `0.9rem` | 300 | DM Sans light |
| Labels / uppercase | `0.75rem – 0.8rem` | 500 – 700 | Often uppercase |
| Badges | `0.65rem` | 600 | Uppercase, letter-spaced |
| Logo | `1.8rem` | 900 | |
| Mono headers | `0.85rem` | 700 | DM Mono |
| Small / micro | `0.65rem – 0.75rem` | 500 – 700 | |

---

## Spacing Scale

| Usage | Value |
|-------|-------|
| Content padding (responsive) | `clamp(1.25rem, 3vw, 2.5rem)` |
| Card padding | `2rem` |
| Standard spacing | `1.5rem` |
| Medium spacing | `1rem` |
| Small spacing | `0.75rem` |
| Extra small | `0.5rem` |
| Grid gap (large) | `2rem` |
| Grid gap (standard) | `1.5rem` |
| Grid gap (medium) | `1rem` |
| Grid gap (small) | `0.75rem` |

---

## Border Radius

| Element | Radius |
|---------|--------|
| `--radius` (cards, large) | `28px` |
| Auth cards | `24px` |
| Card inner elements | `18px` |
| KPI cards, team cards | `16px` |
| Mobile menu items | `14px` |
| Antd components (`borderRadius` token) | `10px` |
| Form inputs, flyout links | `8px` |
| Badges, deadline pills | `2px` |

---

## Shadows

| Usage | Value |
|-------|-------|
| Default card shadow | `var(--shadow)` |
| Card hover (light) | `0 12px 32px rgba(0,0,0,0.12)` |
| Card hover (dark) | `0 12px 32px rgba(0,0,0,0.4)` |
| Tooltips | `0 4px 12px rgba(0,0,0,0.15)` |
| User dropdown | `0 20px 40px rgba(0,0,0,0.15)` |
| Sidebar | `2px 0 10px rgba(0,0,0,0.05)` |

---

## Transitions & Animations

### Default Transition
```
--transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1)
```
Fine-grained durations: `0.15s`, `0.2s`, `0.25s`

### Keyframe Animations
| Name | Effect | Usage |
|------|--------|-------|
| `fadeInUp` | `opacity 0→1, translateY(15px→0)` | Page load, cards |
| `pulse-step` | Pulse effect | Active workflow steps |

### Animation Classes
- `.animate-up` — `fadeInUp 0.4s ease-out forwards`

---

## Components

> Most interactive components (modals, tables, dropdowns, selects, date pickers, spinners, notifications) use **Ant Design v5** components and are not styled via `style.css`.

### CSS-based Components (still in style.css)

#### Buttons
| Class | Style |
|-------|-------|
| `.btn-primary` | Yellow bg (`#eab308`), dark text; hover: transparent + yellow text |
| `.btn-secondary` | Transparent, muted border; hover: yellow bg |
| `.btn-danger` | Transparent, danger border/text; hover: solid danger bg + white text |
| `.btn-icon` | Icon-only, 8px radius; hover: `#fee2e2` bg + danger text |
| `.btn-upgrade` | Full-width, primary bg, 8px radius |
| `.btn-danger-outline` | `0.6rem 1.2rem` padding, 10px radius |

#### Cards
| Class | Style |
|-------|-------|
| `.card` | `bg: var(--card-bg)`, `padding: 2rem`, `border-radius: var(--radius)`, border + shadow |
| `.kpi-card` | `padding: 1.5rem`, `border-radius: 16px`; hover: `translateY(-3px)` |
| `.board-card` | `border-radius: 28px`, `padding: 0.85rem`; deadline-based color variants |

#### Badges
Base: `padding: 0.25rem 0.6rem`, `border-radius: 2px`, `font-size: 0.65rem`, uppercase

| Class | Colors |
|-------|--------|
| `.badge-success` | `bg: #1a2a10`, text: `var(--primary-color)` |
| `.badge-warning` | `bg: rgba(245,163,66,0.1)`, text: `--warning` |
| `.badge-danger` | `bg: rgba(245,90,66,0.1)`, text: `--danger` |
| `.badge-neutral` | Gray variant |

#### Form Inputs (`.form-input`)
- `padding: 0.4rem 0.9rem`, `border-radius: 2px`
- Font: `var(--font-mono)`, uppercase
- Focus: `border-color: var(--primary-color)`

#### Kanban Deadline States
| Class | Color |
|-------|-------|
| `.deadline-ok` | `rgba(62, 207, 142, ...)` green |
| `.deadline-caution` | `#eab308` yellow |
| `.deadline-warning` | `#ea580c` orange |
| `.deadline-overdue` | `var(--danger)` red |

---

## Layout

### Sidebar (CSS-based, `style.css`)
- Width: `--sidebar-width: 68px` (desktop), `64px` (tablet)
- Background: `rgba(18, 21, 26, 0.95)` + `backdrop-filter: blur(20px)`
- Nav item size: `44×44px`, `border-radius: 10px`
- Component: `src/components/layout/Sidebar.tsx`

### Grids
| Grid | Definition |
|------|-----------|
| Stats/KPI | `auto-fit, minmax(220px, 1fr)`, gap `1.5rem` |
| Integrations | `auto-fill, minmax(320px, 1fr)`, gap `2rem` |
| Widgets | `2fr 1fr` (desktop) → `1fr` (mobile) |
| Dashboard hub | `auto-fit, minmax(340px, 1fr)`, gap `1.5rem` |
| Form rows | `1fr 1fr`, gap `1rem` |

---

## Responsive Breakpoints

| Breakpoint | Value | Notes |
|------------|-------|-------|
| Desktop | `> 900px` | Full sidebar layout |
| Tablet | `901px – 1100px` | Adjusted grids |
| Large tablet | `1101px – 1440px` | Alternative layouts |
| Mobile | `≤ 900px` | Bottom nav, single column |
| Mobile small | `≤ 768px` | Further size reductions |

**Mobile layout**: Sidebar hidden → bottom `<nav class="mobile-nav">` (64px height, fixed bottom)
**Bottom sheet**: `border-radius: 24px 24px 0 0`, slides up from `translateY(100%)`

---

## Auth Pages

Auth pages are **forced light mode** regardless of theme:

- Background: `#eaf0dc` + SVG noise filter + `linear-gradient(135deg, #eaf0dc → #eab308)`
- Text: `#1e293b`
- Card: white bg, `border-radius: 24px`, `padding: 3rem`, `max-width: 440px`
- Logo color: `#3462ee`
- Tab bar: `#f1f5f9` bg, `border-radius: 10px`; active tab: white bg + shadow

---

## How to Apply Changes

1. **Ant Design tokens**: Edit `src/App.tsx` → `ConfigProvider` `theme.token`.
2. **CSS variables**: Edit `:root` and `[data-theme="dark"]` blocks in `style.css`.
3. **Component styles**: Search `style.css` for the class name and update directly.
