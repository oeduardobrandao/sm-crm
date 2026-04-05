# Password Reset + BrowserRouter Migration — Design Spec

**Date:** 2026-04-04  
**Status:** Approved

## Problem

The app uses `HashRouter`, so all routes live after `#` in the URL. The password reset email uses `redirectTo: window.location.origin + '/#/configurar-senha'`. Supabase appends its recovery token as a URL fragment (`#access_token=...`), producing a double-fragment URL (`.../#/configurar-senha#access_token=...`). Some email clients truncate or reject double-fragment URLs, causing the reset flow to silently fail. `ConfigurarSenhaPage` relies entirely on `supabase.auth.getSession()` to auto-detect the token on mount, which is fragile when the URL is malformed.

## Solution

Switch to `BrowserRouter` with a Vercel rewrite rule, fix the `redirectTo` to use a clean path, and replace the `getSession()` poll with a reliable `onAuthStateChange` listener that includes an error state for expired/invalid links.

---

## Section 1: Router Migration

**`src/main.tsx`**  
Replace `HashRouter` with `BrowserRouter` from `react-router-dom`. No other changes to this file.

**`vercel.json`** (new file at project root)  
Add a single rewrite rule that sends all paths to `/index.html`, enabling direct navigation and email link clicks to work correctly:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**`src/pages/configurar-senha/ConfigurarSenhaPage.tsx`**  
Update the two hardcoded `href="#/politica-de-privacidade"` anchor links to `href="/politica-de-privacidade"`.

Grep the codebase for any other `href="#/` or `navigate('/#/` patterns and update them to use plain paths.

---

## Section 2: Password Reset `redirectTo`

**`src/lib/supabase.ts`** — `resetPassword()` function (line 167–170)  
Change:
```ts
redirectTo: window.location.origin + '/#/configurar-senha'
```
To:
```ts
redirectTo: window.location.origin + '/configurar-senha'
```

The invite flow is unaffected — it already redirects to the root (`/`) via Supabase's own verify URL.

---

## Section 3: `ConfigurarSenhaPage` — Session Detection

**`src/pages/configurar-senha/ConfigurarSenhaPage.tsx`**

Replace the `useEffect` that calls `supabase.auth.getSession()` with an `onAuthStateChange` listener. Supabase fires the `PASSWORD_RECOVERY` event explicitly when it parses the token from the URL, making this more reliable than polling `getSession()`.

Add a `tokenError` state (boolean). Set a timeout of 8 seconds: if neither `PASSWORD_RECOVERY` nor `SIGNED_IN` fires, set `tokenError = true`.

**New `useEffect` logic (pseudocode):**
```ts
useEffect(() => {
  const timeout = setTimeout(() => setTokenError(true), 8000);

  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
      clearTimeout(timeout);
      if (!session) return;
      // existing logic: populate email, isInvite, inviter info from session
    }
  });

  return () => {
    clearTimeout(timeout);
    subscription.unsubscribe();
  };
}, []);
```

**Error state UI:** when `tokenError === true`, render in place of the form:

> "Este link é inválido ou já expirou."  
> "Solicite um novo link de redefinição de senha."  
> Button: "Solicitar novo link" → navigates to `/login`

The existing `handleSubmit` guard (`if (!session) { toast.error(...); return; }`) is kept as-is.

---

## Scope

**In scope:**
- Migrate `HashRouter` → `BrowserRouter`
- Add `vercel.json` rewrite
- Fix `redirectTo` in `resetPassword()`
- Replace `getSession()` with `onAuthStateChange` in `ConfigurarSenhaPage`
- Add expired-link error state to `ConfigurarSenhaPage`
- Update hardcoded `#/` href links

**Out of scope:**
- Changes to the invite flow
- Any other auth pages
- End-to-end tests (noted as a future need)
