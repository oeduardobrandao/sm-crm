# Login page — Klaviyo-style split-screen with MCP connector showcase

**Date:** 2026-06-30
**Scope:** `apps/crm` login page only (CRM app). Desktop layout change; mobile unchanged.

## Goal

Redesign the CRM login page ([apps/crm/src/pages/login/LoginPage.tsx](../../../apps/crm/src/pages/login/LoginPage.tsx))
into a two-column split layout (inspired by Klaviyo's login):

- **Left half** — the existing auth form (login / sign-up toggle / forgot password), on a clean white surface.
- **Right half** — a dark, premium showcase panel promoting the Mesaas **cloud MCP connector**
  (the "Agente de Conteúdo" / Claude (MCP) integration) that lets agencies connect their workspace to
  Claude and generate on-brand content automatically.

The form's behavior, fields, validation, and handlers do **not** change — this is purely layout + a new
decorative panel.

## Decisions (confirmed with user)

- Right-panel treatment: **dark, premium** (`#12151a`), matching the Klaviyo reference. Brand-yellow accents.
- Form-side background: **clean white** (gradient removed on desktop; form card chrome stripped).
- Mobile (≤ 900px): **no change** — keep today's centered white card on the green→yellow gradient.

## Structure

Current:

```
.auth-wrapper            (flex center, gradient bg)
  .auth-card.animate-up  (white card, max-width 440px)
    ...form...
```

New:

```
.auth-wrapper                       (mobile: unchanged; desktop: row, white bg, no gradient)
  .auth-pane                        (left form pane — benign wrapper, centers the card)
    .auth-card.animate-up           (desktop: chrome stripped; mobile: unchanged)
      ...form... (UNCHANGED)
  <aside.auth-showcase aria-hidden> (right panel — display:none on mobile, dark flex on desktop)
    ...decorative showcase collage...
```

`.auth-pane` is a passthrough wrapper that keeps the card centered on mobile (no visual change) and forms
the left 48% column on desktop. `.auth-showcase` is `aria-hidden` (decorative marketing imagery; the
accessible login form is the left pane) and `display:none` below the desktop breakpoint.

## Responsive rule

- Breakpoint: **900px** (CLAUDE.md defines desktop as `> 900px`).
- Base CSS (mobile-first) = today's styles, unchanged. `.auth-showcase { display: none }`.
- `@media (min-width: 901px)`: switch `.auth-wrapper` to `flex-direction: row; padding: 0; background: #fff`
  (drop gradient), size the two panes, strip `.auth-card` chrome (`box-shadow/border/background: none`,
  `max-width` ~400px), and reveal `.auth-showcase` as a dark flex column.
- Auth pages remain forced-light-mode; the showcase panel is intentionally dark regardless of theme.

## Right-panel content (decorative)

From top to bottom, centered vertically:

1. Pill badge: brand-yellow tinted — `showcase.badge` ("Novo · Conector Claude (MCP)" / "New · Claude (MCP) connector").
2. Headline (Playfair Display): `showcase.title` ("Conheça o Agente de Conteúdo" / "Meet your content agent").
3. Description (one line, muted): `showcase.description`.
4. Faux agent collage:
   - White chat card: `showcase.chatPrompt` ("No que vamos trabalhar hoje?") + two suggestion chips
     (`showcase.chip1`, `showcase.chip2`) + an "ask the agent" input row (`showcase.agentInput`).
   - Floating "Performance" mini-card with a tiny bar sparkline (one bar highlighted in brand yellow).
   - Floating "Marca" mini-card with brand color dots.

Copy lives in i18n under a new `showcase` block in both `packages/i18n/locales/pt/auth.json` and
`.../en/auth.json`. Decorative labels (Performance/Marca) are also i18n keys for PT/EN parity.

## Files touched

- `apps/crm/src/pages/login/LoginPage.tsx` — new split wrapper + `auth-showcase` aside; form JSX unchanged.
- `apps/crm/style.css` — new "Auth split / showcase" CSS section; `@media (min-width: 901px)` desktop rules;
  `.auth-showcase` collage styles.
- `packages/i18n/locales/pt/auth.json` + `packages/i18n/locales/en/auth.json` — `showcase` block.

## Out of scope

- No change to auth logic, Supabase calls, routing, or the Hub app.
- No change to mobile layout.
- No real product screenshot asset (the collage is built with markup, fully self-contained).

## Verification

1. `npm run build` (tsc + vite) passes.
2. Run the CRM app; screenshot `/login` at desktop width — split layout, dark right panel, white form left.
3. Resize to ≤ 900px — right panel gone, original centered card on gradient (visually identical to before).
4. Toggle Entrar ↔ Criar Conta and Forgot password — form still works, layout holds.
5. `npm run test` — no regressions.
