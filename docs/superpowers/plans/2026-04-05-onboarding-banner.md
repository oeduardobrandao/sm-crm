# Onboarding Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hero banner at the top of the dashboard that guides new users through 6 setup steps, auto-tracks completion from live data, and disappears when all steps are done or the user dismisses it.

**Architecture:** A new `OnboardingBanner` component receives already-fetched data from `DashboardPage` as props — no new queries. It reads `profile.conta_id` from `useAuth()` internally to namespace the `localStorage` dismiss key. `DashboardPage` renders it above the hub grid, hidden for agents.

**Tech Stack:** React, TypeScript, react-router-dom `<Link>`, localStorage, CSS custom properties matching the existing dark theme.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/components/OnboardingBanner.tsx` | Banner component — checklist, progress, dismiss logic |
| Modify | `src/pages/dashboard/DashboardPage.tsx` | Import and render `<OnboardingBanner>` with data props |

---

### Task 1: Create `OnboardingBanner` component (structure + dismiss logic)

**Files:**
- Create: `src/components/OnboardingBanner.tsx`

- [ ] **Step 1: Create the file with types, localStorage logic, and empty render**

```tsx
// src/components/OnboardingBanner.tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Cliente, Lead, Membro, Workflow } from '../store';
import type { PortfolioAccount } from '../services/analytics';

interface OnboardingBannerProps {
  clientes: Cliente[];
  leads: Lead[];
  membros: Membro[];
  portfolioAccounts: PortfolioAccount[];
  workflows: Workflow[];
}

export function OnboardingBanner({ clientes, leads, membros, portfolioAccounts, workflows }: OnboardingBannerProps) {
  const { profile } = useAuth();
  const storageKey = `onboarding_dismissed_${profile?.conta_id ?? 'unknown'}`;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    return localStorage.getItem(storageKey) === 'true';
  });

  const steps = [
    { label: 'Conta criada', done: true, to: null },
    { label: 'Adicionar primeiro cliente', done: clientes.length > 0, to: '/clientes' },
    { label: 'Criar primeiro lead', done: leads.length > 0, to: '/leads' },
    { label: 'Adicionar membro da equipe', done: membros.length > 0, to: '/equipe' },
    { label: 'Conectar conta do Instagram', done: portfolioAccounts.length > 0, to: '/analytics' },
    { label: 'Criar fluxo de entrega', done: workflows.length > 0, to: '/entregas' },
  ];

  const completedCount = steps.filter(s => s.done).length;

  useEffect(() => {
    if (completedCount === steps.length) {
      localStorage.setItem(storageKey, 'true');
      setDismissed(true);
    }
  }, [completedCount, steps.length, storageKey]);

  function handleDismiss() {
    localStorage.setItem(storageKey, 'true');
    setDismissed(true);
  }

  if (dismissed) return null;

  return <div>placeholder</div>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `OnboardingBanner.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/OnboardingBanner.tsx
git commit -m "feat: add OnboardingBanner skeleton with dismiss logic"
```

---

### Task 2: Implement the banner UI

**Files:**
- Modify: `src/components/OnboardingBanner.tsx`

- [ ] **Step 1: Replace the placeholder `return` with the full banner markup**

Replace `return <div>placeholder</div>;` with:

```tsx
  const firstIncompleteIndex = steps.findIndex(s => !s.done);

  const titles: Record<number, { text: string; emoji: string }> = {
    0: { text: 'Bem-vindo ao CRM Fluxo!', emoji: '👋' },
    1: { text: 'Bem-vindo ao CRM Fluxo!', emoji: '👋' },
    2: { text: 'Você está indo bem!', emoji: '🎯' },
    3: { text: 'Você está indo bem!', emoji: '🎯' },
    4: { text: 'Quase lá!', emoji: '🎯' },
    5: { text: 'Quase lá!', emoji: '🎯' },
  };
  const { text: titleText, emoji } = titles[completedCount] ?? { text: 'Bem-vindo!', emoji: '👋' };
  const progressPct = (completedCount / steps.length) * 100;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1e1e3f 0%, #2d1b69 100%)',
      borderBottom: '1px solid var(--accent, #6366f1)',
      padding: '20px 24px',
      position: 'relative',
      marginBottom: '1.5rem',
      borderRadius: 'var(--radius, 8px)',
    }}>
      <button
        onClick={handleDismiss}
        aria-label="Fechar"
        style={{
          position: 'absolute', top: 12, right: 12,
          background: 'transparent', border: 'none',
          color: 'var(--text-muted)', fontSize: '1.1rem',
          cursor: 'pointer', lineHeight: 1,
        }}
      >✕</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: 4 }}>
            {emoji} {titleText}
          </div>
          <div style={{ color: '#a5b4fc', fontSize: '0.82rem', marginBottom: 14 }}>
            Complete estes passos para configurar sua conta
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {steps.map((step, i) => {
              const isNext = i === firstIncompleteIndex;
              const content = (
                <>
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.65rem', flexShrink: 0,
                    background: step.done ? 'var(--success, #22c55e)' : 'transparent',
                    border: step.done ? 'none' : `2px solid ${isNext ? 'var(--accent, #6366f1)' : '#555'}`,
                    color: step.done ? '#000' : (isNext ? 'var(--accent, #6366f1)' : '#555'),
                  }}>
                    {step.done ? '✓' : i + 1}
                  </span>
                  <span style={{ fontSize: '0.8rem' }}>{step.label}</span>
                </>
              );

              const pillStyle: React.CSSProperties = {
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 8px', borderRadius: 6,
                textDecoration: 'none',
                color: step.done ? 'var(--success, #22c55e)' : (isNext ? '#fff' : '#888'),
                background: step.done
                  ? 'rgba(34,197,94,0.1)'
                  : (isNext ? 'rgba(99,102,241,0.2)' : 'transparent'),
                border: step.done
                  ? '1px solid rgba(34,197,94,0.2)'
                  : (isNext ? '1px solid rgba(99,102,241,0.5)' : '1px solid transparent'),
              };

              if (step.to) {
                return (
                  <Link key={i} to={step.to} style={pillStyle}>
                    {content}
                  </Link>
                );
              }
              return (
                <div key={i} style={pillStyle}>
                  {content}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: '2rem', lineHeight: 1 }}>{emoji}</div>
          <div style={{ color: '#a5b4fc', fontSize: '0.75rem', marginTop: 4 }}>
            {completedCount} de {steps.length}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
        <div style={{
          height: 3,
          width: `${progressPct}%`,
          background: 'linear-gradient(90deg, #6366f1, #a5b4fc)',
          borderRadius: 2,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  );
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/OnboardingBanner.tsx
git commit -m "feat: implement OnboardingBanner UI with checklist and progress bar"
```

---

### Task 3: Wire `OnboardingBanner` into `DashboardPage`

**Files:**
- Modify: `src/pages/dashboard/DashboardPage.tsx`

- [ ] **Step 1: Add import at the top of `DashboardPage.tsx` (after existing imports)**

Add after line 23 (`import { useAuth } from '../../context/AuthContext';`):

```tsx
import { OnboardingBanner } from '../../components/OnboardingBanner';
```

- [ ] **Step 2: Render the banner inside the return, above the `dashboard-hub` div**

In the `return (...)` block, find the opening `<div>` and the `{isLoading && ...}` block. After the loading spinner block and before `{/* Dashboard Hub */}`, add:

```tsx
      {/* Onboarding banner — only for non-agents */}
      {!isLoading && role !== 'agent' && (
        <OnboardingBanner
          clientes={clientes}
          leads={leads}
          membros={membros}
          portfolioAccounts={portfolioAccounts}
          workflows={workflows}
        />
      )}
```

The `portfolioAccounts` variable is already defined on line 97 of `DashboardPage.tsx` as `const portfolioAccounts = portfolio?.accounts ?? [];`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manually verify in the browser**

1. Run `npm run dev`
2. Log in as a fresh account (or temporarily clear localStorage key for your account)
3. Visit `/` — banner should appear with step 1 checked, step 2 highlighted as next
4. Navigate to `/clientes`, add a client, return to `/` — step 2 should now be checked
5. Click ✕ — banner should disappear and stay gone on refresh
6. Log in as an agent role — banner should not appear

- [ ] **Step 5: Commit**

```bash
git add src/pages/dashboard/DashboardPage.tsx
git commit -m "feat: render OnboardingBanner on dashboard for new accounts"
```

---

## Self-Review

**Spec coverage:**
- ✓ Hero banner above dashboard-hub grid
- ✓ 6-item checklist with correct conditions
- ✓ Auto-complete tracking from live data (no new queries)
- ✓ Progress bar animated
- ✓ Title changes by progress level
- ✓ Dismiss button → localStorage persist
- ✓ Auto-hide when all 6 complete
- ✓ Hidden for agent role
- ✓ Each pill is a Link to the relevant page (item 1 is a non-link div)
- ✓ First incomplete item highlighted as "next"

**Placeholder scan:** None found.

**Type consistency:** `PortfolioAccount[]` used in props matches the export from `src/services/analytics.ts`. All `store` types (`Cliente`, `Lead`, `Membro`, `Workflow`) are exported from `src/store.ts` and already used in `DashboardPage`.
