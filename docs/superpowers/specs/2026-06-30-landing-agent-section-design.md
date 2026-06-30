# Landing page — "Agente de Conteúdo" (Claude MCP) section

**Date:** 2026-06-30
**Branch:** `feat/login-split-screen` (added to the same PR as the login split-screen redesign)
**Scope:** `apps/crm` landing page only.

## Goal

Surface the cloud MCP **"Agente de Conteúdo"** connector on the marketing landing page
([apps/crm/src/pages/landing/LandingPage.tsx](../../../apps/crm/src/pages/landing/LandingPage.tsx)),
mirroring the showcase just added to the login page. The connector links a Mesaas workspace to
Claude (claude.ai / Desktop / API) so AI agents read each client's briefing, brand, posts, and
performance and generate on-brand content.

## Decisions (confirmed with user)

- **Placement:** a standalone **dark section** (`#12151a`), rendered between `<Features />` and
  `<HowItWorks />`. Fits the page's existing dark rhythm (testimonial, final CTA).
- **Visual:** adapt the login showcase — white agent card centered over a blurred, out-of-focus
  content composition. Implemented as a new `AgentVisual` in `landing-visuals.tsx` (inline styles,
  matching that file's convention; NOT reusing the login's `.auth-*` classes).
- **Nav:** add a **"Agente IA"** item to the header nav (after "Funcionalidades"), scrolling to
  `id="agente"`.
- **CTA:** a "Criar conta grátis" button → `/login?tab=register` (consistent with the page).
- **Copy:** Portuguese, hardcoded JSX (the landing page uses no i18n).

## Layout

Mirrors the existing `.feat-row` two-column pattern, but on a dark full-width band:

```
<section className="agent-wrap" id="agente">
  <div className="lp-container">
    <div className="agent-grid reveal">
      <div className="agent-copy">
        <span className="agent-eyebrow">Novo · Agente de IA</span>
        <h2>…headline…</h2>
        <p>…subtext…</p>
        <ul className="agent-bullets"><li>…×3…</li></ul>
        <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">Criar conta grátis <ArrowRight/></a>
      </div>
      <div className="agent-visual"><AgentVisual /></div>
    </div>
  </div>
</section>
```

Reuses `.lp-container`, `.reveal` (IntersectionObserver fade-in), and `.lp-btn lp-btn-primary`.
New CSS lives under an "Agente de Conteúdo section" block in `landing.css`.

## Copy (final)

- **Eyebrow:** Novo · Agente de IA
- **Headline:** Um agente de conteúdo que escreve com a voz de cada cliente.
- **Subtext:** Conecte seu Mesaas ao Claude e gere carrosséis, roteiros de Reels e legendas sob
  medida — a partir do briefing, da marca e dos posts que mais performaram. Sem sair do seu fluxo.
- **Bullets:**
  - Aprende o briefing e a identidade de cada marca
  - Usa o que já performou como referência
  - Conecta com claude.ai, Claude Desktop ou API

## AgentVisual (landing-visuals.tsx)

A decorative composition built with inline styles using the file's `BRAND` constant:
- A blurred backdrop layer (`filter: blur`, reduced opacity) of 4 scattered fragment cards: a
  post preview (gradient media + lines), a mini bar chart, a brand-swatch card, a client/avatar card.
- A sharp white agent card centered on top: "No que vamos trabalhar hoje?" + two suggestion chips
  ("Criar carrossel", "Roteiro de Reels") + a yellow-bordered "Peça ao agente…" input row.

## Files touched

- `apps/crm/src/pages/landing/LandingPage.tsx` — `AgentSection` component, render between Features
  and HowItWorks, `AgentVisual` import, new nav `<button>` ("Agente IA" → `scrollTo('agente')`).
- `apps/crm/src/pages/landing/landing-visuals.tsx` — `export function AgentVisual()`.
- `apps/crm/src/pages/landing/landing.css` — `.agent-wrap` / `.agent-grid` / `.agent-copy` /
  `.agent-eyebrow` / `.agent-bullets` / `.agent-visual` (+ responsive stacking on mobile, matching
  `.feat-row`).
- `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx` — update register-link count
  `8 → 9` (+ comment); add a nav-scroll test for the new "Agente IA" button → `scrollTo('agente')`.

## Responsive

- Desktop: two columns (copy left, visual right).
- Mobile (≤ the page's existing feat-row breakpoint): stack to a single column, visual below copy,
  matching how `.feat-row` collapses. Dark band spans full width in both.

## Out of scope

- No i18n (landing is hardcoded PT — consistent with the rest of the page).
- No change to the login page, auth flow, or other landing sections.
- No new animated/interactive behavior in AgentVisual beyond the existing `.reveal` fade-in.

## Verification

1. `npm run build` (tsc + vite) passes.
2. `npm run test` passes — including the updated register-link count and new nav-scroll test.
3. Run the app, screenshot `/` at desktop and mobile widths: dark section renders between Features
   and HowItWorks; nav "Agente IA" scrolls to it; mobile stacks cleanly.
