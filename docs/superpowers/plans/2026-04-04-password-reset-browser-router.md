# Password Reset + BrowserRouter Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the double-fragment URL bug in the password reset flow by migrating from HashRouter to BrowserRouter, adding a Vercel rewrite, and making `ConfigurarSenhaPage` reliably detect the recovery token.

**Architecture:** Swap `HashRouter` for `BrowserRouter` in `main.tsx` and add `vercel.json` to serve `index.html` for all paths. Fix `redirectTo` to use a plain path. Replace the fragile `getSession()` poll in `ConfigurarSenhaPage` with an `onAuthStateChange` listener that includes an 8-second timeout and a clear error state.

**Tech Stack:** React 18, React Router v6 (`BrowserRouter`), Supabase JS client (`@supabase/supabase-js`), TypeScript, Vite, Vercel.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/main.tsx` | Swap `HashRouter` → `BrowserRouter` |
| Create | `vercel.json` | SPA rewrite rule |
| Modify | `src/lib/supabase.ts` | Fix `redirectTo` in `resetPassword()` |
| Modify | `src/pages/configurar-senha/ConfigurarSenhaPage.tsx` | Replace `getSession()` with `onAuthStateChange`, add error state, fix `#/` hrefs |

---

## Task 1: Swap HashRouter for BrowserRouter

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Update the import and component in `src/main.tsx`**

Current content of `src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import '../style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
```

Replace with:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import '../style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 2: Verify the dev server starts without errors**

Run: `npm run dev`  
Expected: Vite starts, no TypeScript or import errors. Navigate to `http://localhost:5173/login` in the browser — the login page should render. Navigate to `http://localhost:5173/dashboard` — should redirect to `/login` (auth guard). Kill the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "feat: migrate from HashRouter to BrowserRouter"
```

---

## Task 2: Add Vercel SPA Rewrite Rule

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create `vercel.json` at the project root**

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

This tells Vercel to serve `index.html` for every path, letting React Router handle client-side routing. Without this, navigating directly to `/dashboard` or clicking a link from an email would return a 404.

- [ ] **Step 2: Verify the file is valid JSON**

Run: `node -e "require('./vercel.json'); console.log('valid')"`  
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: add Vercel SPA rewrite rule for BrowserRouter"
```

---

## Task 3: Fix `redirectTo` in `resetPassword()`

**Files:**
- Modify: `src/lib/supabase.ts` (lines 166–170)

- [ ] **Step 1: Update the `redirectTo` value**

In `src/lib/supabase.ts`, find the `resetPassword` function (around line 166):

```ts
export async function resetPassword(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/#/configurar-senha',
  });
}
```

Change to:

```ts
export async function resetPassword(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/configurar-senha',
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "fix: use plain path in resetPassword redirectTo (no hash fragment)"
```

---

## Task 4: Fix Hardcoded `#/` Href Links in `ConfigurarSenhaPage`

**Files:**
- Modify: `src/pages/configurar-senha/ConfigurarSenhaPage.tsx` (lines 183–184)

- [ ] **Step 1: Update the two anchor hrefs**

In `src/pages/configurar-senha/ConfigurarSenhaPage.tsx`, find lines 183–184:

```tsx
Ao aceitar, você concorda com os <a href="#/politica-de-privacidade" style={{ color: '#1a3d2b' }}>Termos de Uso</a> e a{' '}
<a href="#/politica-de-privacidade" style={{ color: '#1a3d2b' }}>Política de Privacidade</a> do Mesaas.
```

Change both `href="#/politica-de-privacidade"` to `href="/politica-de-privacidade"`:

```tsx
Ao aceitar, você concorda com os <a href="/politica-de-privacidade" style={{ color: '#1a3d2b' }}>Termos de Uso</a> e a{' '}
<a href="/politica-de-privacidade" style={{ color: '#1a3d2b' }}>Política de Privacidade</a> do Mesaas.
```

- [ ] **Step 2: Verify no other `#/` href or navigate patterns remain**

Run: `grep -r 'href="#/' src/ && grep -r "navigate('/#/" src/ && grep -r 'navigate("/#/' src/`  
Expected: no output (exit code 1 is fine — means no matches found).

- [ ] **Step 3: Commit**

```bash
git add src/pages/configurar-senha/ConfigurarSenhaPage.tsx
git commit -m "fix: update hardcoded hash hrefs to plain paths in ConfigurarSenhaPage"
```

---

## Task 5: Replace `getSession()` with `onAuthStateChange` + Add Error State

**Files:**
- Modify: `src/pages/configurar-senha/ConfigurarSenhaPage.tsx`

- [ ] **Step 1: Add `tokenError` state and rewrite the `useEffect`**

In `src/pages/configurar-senha/ConfigurarSenhaPage.tsx`:

1. Add `tokenError` to the state declarations (after line 39, alongside the other `useState` calls):

```tsx
const [tokenError, setTokenError] = useState(false);
```

2. Replace the existing `useEffect` (lines 41–64) with:

```tsx
useEffect(() => {
  const timeout = setTimeout(() => setTokenError(true), 8000);

  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
      clearTimeout(timeout);
      if (!session) return;
      const userEmail = session.user.email || '';
      const contaId = session.user.user_metadata?.conta_id || '';
      setEmail(userEmail);
      setIsInvite(!!contaId);

      if (contaId) {
        const { data } = await supabase
          .from('profiles')
          .select('nome, empresa')
          .eq('conta_id', contaId)
          .eq('role', 'owner')
          .maybeSingle();
        if (data) {
          setWorkspaceName(data.empresa || '');
          setInviterName(data.nome || '');
          const initials = (data.nome || '')
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((w: string) => w[0].toUpperCase())
            .join('');
          setInviterInitials(initials);
        }
      }
    }
  });

  return () => {
    clearTimeout(timeout);
    subscription.unsubscribe();
  };
}, []);
```

- [ ] **Step 2: Add the error state UI**

In the JSX, the outer `<div className="invite-page" ...>` contains a single card `<div>` with a header and then either the form or the success state. Add a third branch for `tokenError`.

Find the block that starts with `{!success ? (` (around line 137) and replace it with:

```tsx
{tokenError ? (
  <div style={{ padding: '2rem', textAlign: 'center' }}>
    <div style={{ width: 60, height: 60, background: '#fdecea', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#c0392b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </div>
    <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a3d2b', margin: '0 0 0.5rem' }}>Link inválido ou expirado</h2>
    <p style={{ fontSize: 14, color: '#888780', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
      Este link é inválido ou já expirou. Solicite um novo link de redefinição de senha.
    </p>
    <button
      onClick={() => navigate('/login')}
      style={{ height: 46, background: '#1a3d2b', color: '#fff', border: 'none', borderRadius: 8, padding: '0 2rem', fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%' }}
    >
      Solicitar novo link
    </button>
  </div>
) : !success ? (
  <div style={{ padding: '2rem' }}>
    <form onSubmit={handleSubmit} className="space-y-4">
```

Then close the ternary after the existing success block. The full structure becomes:

```tsx
{tokenError ? (
  /* error UI above */
) : !success ? (
  <div style={{ padding: '2rem' }}>
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ... existing form content unchanged ... */}
    </form>
  </div>
) : (
  <div style={{ textAlign: 'center', padding: '2rem 2rem 2.5rem' }}>
    {/* ... existing success content unchanged ... */}
  </div>
)}
```

- [ ] **Step 3: Verify the page compiles**

Run: `npm run build`  
Expected: Build completes with no TypeScript errors. It's fine if there are unrelated warnings.

- [ ] **Step 4: Manual smoke test — error state**

Run: `npm run dev`  
Navigate to `http://localhost:5173/configurar-senha` directly (no token in URL). Wait 8 seconds.  
Expected: The error card renders with the "Link inválido ou expirado" message and "Solicitar novo link" button. Clicking the button navigates to `/login`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/configurar-senha/ConfigurarSenhaPage.tsx
git commit -m "fix: replace getSession() with onAuthStateChange and add expired-link error state"
```

---

## Self-Review Checklist

- [x] **Spec Section 1 (Router Migration):** Covered by Tasks 1, 2, and 4.
- [x] **Spec Section 2 (redirectTo fix):** Covered by Task 3.
- [x] **Spec Section 3 (onAuthStateChange + error state):** Covered by Task 5.
- [x] **No placeholders:** All steps contain exact code or commands.
- [x] **Type consistency:** `tokenError` (boolean) declared in Task 5 Step 1 and used in Task 5 Step 2. `supabase` imported at line 10 of `ConfigurarSenhaPage.tsx` — no new imports needed.
- [x] **Invite flow unaffected:** `SIGNED_IN` event covers invite token landing; the 8-second timeout is a safe buffer for that flow.
