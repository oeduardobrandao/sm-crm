# Onboarding Banner — Design Spec

**Date:** 2026-04-05  
**Status:** Approved

---

## Problem

A freshly registered user sees a dashboard full of zero KPIs and empty tables with no guidance. There is no prompt to take a first action.

## Solution

A hero banner rendered at the top of `DashboardPage` (above the `dashboard-hub` grid) that shows a welcome message, a 6-item setup checklist with automatic completion tracking, a progress bar, and a dismiss button. The banner disappears permanently once all steps are complete or when the user dismisses it early.

---

## Checklist Items

| # | Label | Condition (auto-complete) | Link |
|---|-------|--------------------------|------|
| 1 | Conta criada | Always ✓ | — |
| 2 | Adicionar primeiro cliente | `clientes.length > 0` | `/clientes` |
| 3 | Criar primeiro lead | `leads.length > 0` | `/leads` |
| 4 | Adicionar membro da equipe | `membros.length > 0` | `/equipe` |
| 5 | Conectar conta do Instagram | `portfolioAccounts.length > 0` | `/analytics` |
| 6 | Criar fluxo de entrega | `workflows.length > 0` | `/entregas` |

Items 2–6 are checked against data already fetched by the existing `useQueries` in `DashboardPage`. No new queries needed.

---

## Banner States

| Completed | Title | Emoji |
|-----------|-------|-------|
| 0–2 | "Bem-vindo ao CRM Fluxo!" | 👋 |
| 3–4 | "Você está indo bem!" | 🎯 |
| 5 | "Quase lá!" | 🎯 |
| 6 (all) | banner auto-hides | — |

---

## Persistence (dismiss + auto-hide)

- Dismissed state is stored in `localStorage` under the key `onboarding_dismissed_<contaId>`.
- On mount: if the key exists, skip rendering entirely.
- When ✕ is clicked: set the key and unmount the banner.
- When `completedCount === 6`: set the key and unmount the banner (same path, different trigger).
- `contaId` is read from `useAuth()` (`user.id` or `conta_id`) to scope dismissal per account.

---

## Visual Design

- Full-width banner above `.dashboard-hub`, rendered only for `role !== 'agent'`.
- Background: `linear-gradient(135deg, #1e1e3f, #2d1b69)`, bottom border `1px solid var(--accent)`.
- Checklist: 3-column CSS grid of pill items. Each pill is a `<Link>` to the relevant page.
  - Completed pill: green background tint, green check circle.
  - Next pending pill (first incomplete item only): accent background tint, numbered circle border.
  - Future pending pill: no background, muted text.
- Progress bar: 3px tall, full width, at bottom of banner. Width = `(completedCount / 6) * 100%`, animated with CSS transition.
- Dismiss button: absolute top-right ✕, `color: var(--text-muted)`.
- Emoji/counter badge top-right: shows "N de 6".

---

## Component

A new component `OnboardingBanner` is extracted into `src/components/OnboardingBanner.tsx`.

**Props:**
```ts
interface OnboardingBannerProps {
  clientes: Cliente[];
  leads: Lead[];
  membros: Membro[];
  portfolioAccounts: PortfolioAccount[];
  workflows: Workflow[];
}
```

- Reads `user.id` from `useAuth()` internally for localStorage key.
- Manages `dismissed` state locally with `useState` + `useEffect`.
- Returns `null` when dismissed or all complete.

`DashboardPage` passes the already-fetched data — no new queries.

---

## What is NOT in scope

- No onboarding for `agent` role (banner hidden).
- No server-side persistence of dismissal.
- No animated confetti or completion celebration.
- No changes to individual hub cards (no inline empty-state prompts).
