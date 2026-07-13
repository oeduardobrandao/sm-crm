# Correctness, Accessibility, and Safe Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove confirmed invalid DOM and auth races, restore accessible dialog semantics, and delete only proven stale configuration/code.

**Architecture:** Attach context-menu behavior without inserting DOM wrappers, separate conflicting navigation targets, give dialogs explicit descriptions, and serialize profile loading behind resolved Auth identity with stale-request protection. Keep cleanup limited to entries proven absent or made dead by the audit fixes.

**Tech Stack:** React 19, Radix UI, React Router, Supabase Auth, Testing Library, Vitest, Deno config tests.

## Global Constraints

- `<tbody>` children remain `<tr>` elements.
- Never render nested anchors.
- Dialog content has an accessible title and description.
- A profile request for an old/signed-out user cannot repopulate context.
- Do not delete the stale README/root config, large Hub PostCard, or duplicated inline-image modules in this branch.
- Every production change starts with a failing focused test.

---

### Task 1: Remove the Context-menu Wrapper and Describe File Dialogs

**Files:**
- Modify: `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx`
- Modify: `apps/crm/src/pages/arquivos/__tests__/FileContextMenu.test.tsx`
- Modify: `apps/crm/src/pages/arquivos/__tests__/FilePickerModal.test.tsx`

**Interfaces:**
- `FileContextMenu.children` becomes one `React.ReactElement` so Radix `Slot` can merge `onContextMenu` without a wrapper.

- [ ] **Step 1: Write the failing table-structure test**

```tsx
it("does not insert an element between tbody and tr", () => {
  const { container } = render(
    <table>
      <tbody>
        <FileContextMenu item={makeFile()} type="file" onActionComplete={onActionComplete}>
          <tr data-testid="file-row"><td>Arquivo</td></tr>
        </FileContextMenu>
      </tbody>
    </table>,
  );

  const tbody = container.querySelector("tbody")!;
  expect(tbody.children).toHaveLength(1);
  expect(tbody.children[0].tagName).toBe("TR");
  rightClick(screen.getByTestId("file-row"));
  expect(screen.getByRole("menu")).toBeInTheDocument();
});
```

- [ ] **Step 2: Add failing accessible-description assertions**

For the rename dialog:

```ts
expect(screen.getByRole("dialog", { name: /Renomear/ })).toHaveAccessibleDescription(
  "Informe o novo nome e salve para concluir.",
);
```

For the picker:

```ts
expect(screen.getByRole("dialog", { name: "Selecionar arquivos" })).toHaveAccessibleDescription(
  "Escolha um ou mais arquivos para vincular.",
);
```

- [ ] **Step 3: Run and verify RED**

```bash
npm run test -- apps/crm/src/pages/arquivos/__tests__/FileContextMenu.test.tsx apps/crm/src/pages/arquivos/__tests__/FilePickerModal.test.tsx
```

Expected: table child is `DIV`; both dialog description assertions FAIL.

- [ ] **Step 4: Use `Slot` and `DialogDescription`**

Import `Slot` from `@radix-ui/react-slot`, change the prop to `children: React.ReactElement`, and replace the wrapper with:

```tsx
<Slot onContextMenu={handleContextMenu}>{children}</Slot>
```

Import `DialogDescription` from the local dialog primitive. Add these immediately below their titles:

```tsx
<DialogDescription className="sr-only">
  Informe o novo nome e salve para concluir.
</DialogDescription>
```

```tsx
<DialogDescription className="sr-only">
  Escolha um ou mais arquivos para vincular.
</DialogDescription>
```

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm run test -- apps/crm/src/pages/arquivos/__tests__/FileContextMenu.test.tsx apps/crm/src/pages/arquivos/__tests__/FilePickerModal.test.tsx apps/crm/src/pages/arquivos/__tests__/FileGrid.test.tsx
git add apps/crm/src/pages/arquivos/components/FileContextMenu.tsx apps/crm/src/pages/arquivos/components/FilePickerModal.tsx apps/crm/src/pages/arquivos/__tests__
git commit -m "fix(files): preserve valid table and dialog markup"
```

---

### Task 2: Remove Nested Links from `TodayCard`

**Files:**
- Modify: `apps/crm/src/pages/dashboard/components/TodayCard.tsx`
- Create: `apps/crm/src/pages/dashboard/components/__tests__/TodayCard.test.tsx`

**Interfaces:**
- Preserves: calendar navigation for card header/non-empty event list and clients navigation in the empty state.

- [ ] **Step 1: Write the failing navigation-structure tests**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TodayCard } from "../TodayCard";

function renderCard(events: Parameters<typeof TodayCard>[0]["events"]) {
  return render(<MemoryRouter><TodayCard events={events} /></MemoryRouter>);
}

describe("TodayCard", () => {
  it("keeps calendar and clients as independent links in the empty state", () => {
    const { container } = renderCard([]);
    expect(container.querySelector("a a")).toBeNull();
    expect(screen.getByRole("link", { name: /Hoje/ })).toHaveAttribute("href", "/calendario");
    expect(screen.getByRole("link", { name: "Clientes" })).toHaveAttribute("href", "/clientes");
  });

  it("links non-empty event content to the calendar", () => {
    renderCard([{ kind: "deadline", label: "Entrega", sublabel: "Hoje" }]);
    expect(screen.getByRole("link", { name: /Entrega/ })).toHaveAttribute("href", "/calendario");
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test -- apps/crm/src/pages/dashboard/components/__tests__/TodayCard.test.tsx
```

Expected: nested anchor assertion and independent link lookup FAIL.

- [ ] **Step 3: Restructure the card**

Make the card root a `div`. Render the header as a calendar `Link`. For non-empty events, wrap only the list in a second calendar `Link`; for the empty state, render `EmptyStateGuide` directly so its clients link has no ancestor anchor:

```tsx
<div className="card dashboard-hub-card animate-up">
  <Link to="/calendario" className="dashboard-hub-card-header" style={{ textDecoration: "none", color: "inherit" }}>
    <h3><i className="ph ph-calendar-check" style={{ marginRight: 8 }} />{t("cards.today")}</h3>
    <i className="ph ph-arrow-right" />
  </Link>
  {events.length === 0 ? (
    <EmptyStateGuide icon="📅" title={t("empty.noEventsToday")} description="" actionLabel="Clientes" actionHref="/clientes" />
  ) : (
    <Link to="/calendario" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="dashboard-hub-list">
        {events.map((event, index) => (
          <div key={index} className="dashboard-hub-row">
            <span style={{ fontSize: "0.85rem" }}>
              <i
                className={ICON[event.kind].icon}
                style={{ color: ICON[event.kind].color, marginRight: 4 }}
              />
              {event.label}
            </span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {event.sublabel}
            </span>
          </div>
        ))}
      </div>
    </Link>
  )}
</div>
```

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm run test -- apps/crm/src/pages/dashboard/components/__tests__/TodayCard.test.tsx apps/crm/src/pages/dashboard/__tests__/DashboardPage.test.tsx
git add apps/crm/src/pages/dashboard/components/TodayCard.tsx apps/crm/src/pages/dashboard/components/__tests__/TodayCard.test.tsx
git commit -m "fix(dashboard): remove nested today card links"
```

---

### Task 3: Prevent Stale Auth Profile Results

**Files:**
- Modify: `apps/crm/src/lib/__mocks__/supabase.ts`
- Modify: `apps/crm/src/context/__tests__/AuthContext.test.tsx`
- Modify: `apps/crm/src/context/AuthContext.tsx`

**Interfaces:**
- Test helper: `__queueCurrentProfileResponse(response: Promise<Record<string, unknown> | null>): void`.
- AuthProvider internally separates `sessionReady` from `user` and invalidates older profile loads with a monotonic request ID.

- [ ] **Step 1: Add a deferred profile response to the manual mock**

```ts
let profileResponses: Array<Promise<Record<string, unknown> | null>> = [];

export async function getCurrentProfile(force = false) {
  void force;
  return profileResponses.shift() ?? currentProfile;
}

export function __queueCurrentProfileResponse(
  response: Promise<Record<string, unknown> | null>,
) {
  profileResponses.push(response);
}
```

Reset `profileResponses = []` in `__resetSupabaseMock`.

- [ ] **Step 2: Write the failing stale-result test**

```tsx
it("does not restore a stale profile after sign-out", async () => {
  mockedSupabase.__resetSupabaseMock();
  mockedSupabase.__setCurrentUser({ id: "user-old" });
  mockedSupabase.__setCurrentProfile(null);
  let resolveProfile!: (value: Record<string, unknown>) => void;
  mockedSupabase.__queueCurrentProfileResponse(new Promise((resolve) => { resolveProfile = resolve; }));

  renderWithAuth();
  await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("user-old"));

  await act(async () => mockedSupabase.__emitAuthChange("SIGNED_OUT", null));
  await act(async () => resolveProfile({
    id: "user-old", nome: "Old", role: "owner", conta_id: "conta-old",
  }));

  await waitFor(() => {
    expect(screen.getByTestId("user")).toHaveTextContent("anon");
    expect(screen.getByTestId("role")).toHaveTextContent("agent");
  });
});
```

Add `__queueCurrentProfileResponse` to the mocked module type.

- [ ] **Step 3: Run and verify RED**

```bash
npm run test -- apps/crm/src/context/__tests__/AuthContext.test.tsx
```

Expected: stale owner profile is restored after sign-out.

- [ ] **Step 4: Serialize session/profile loading**

Add `sessionReady` state and `profileRequestId` ref. Initial `getSession` only sets `user` and `sessionReady`; it never fetches the profile. The auth callback sets both identity and readiness. Use one user-dependent effect:

```ts
useEffect(() => {
  if (!sessionReady) return;
  const requestId = ++profileRequestId.current;
  if (!user) {
    setProfile(null);
    setLoading(false);
    return;
  }

  setLoading(true);
  void (async () => {
    try {
      const nextProfile = await getCurrentProfile(true);
      if (requestId !== profileRequestId.current) return;
      setProfile(nextProfile);
      await initStoreRole();
      if (requestId === profileRequestId.current) void healPendingInvite();
    } catch (error) {
      if (requestId === profileRequestId.current) setProfile(null);
      console.error("Profile load error", error);
    } finally {
      if (requestId === profileRequestId.current) setLoading(false);
    }
  })();
}, [sessionReady, user?.id]);
```

Increment `profileRequestId.current` at the start of the context `signOut`, then set `user(null)` only after `supabaseSignOut()` succeeds. Implement `refetchProfile` with the same request-ID guard for the current user.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm run test -- apps/crm/src/context/__tests__/AuthContext.test.tsx
git add apps/crm/src/lib/__mocks__/supabase.ts apps/crm/src/context/AuthContext.tsx apps/crm/src/context/__tests__/AuthContext.test.tsx
git commit -m "fix(auth): ignore stale profile loads"
```

---

### Task 4: Remove Proven Stale Supabase Configuration

**Files:**
- Modify: `supabase/config.toml:112-118`
- Modify: `supabase/functions/__tests__/config-audit_test.ts`

**Interfaces:**
- Removes only function entries with no corresponding directory: `portal-approve` and `portal-data`.

- [ ] **Step 1: Add the failing absence assertions**

```ts
for (const stale of ["portal-approve", "portal-data"]) {
  assert(!configured.has(stale), `Stale function config must be removed: ${stale}`);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
deno test --no-check --allow-read supabase/functions/__tests__/config-audit_test.ts
```

Expected: FAIL because both entries are configured.

- [ ] **Step 3: Delete the two TOML sections and verify GREEN**

Remove exactly:

```toml
[functions.portal-approve]
verify_jwt = false

[functions.portal-data]
verify_jwt = false
```

Run:

```bash
deno test --no-check --allow-read supabase/functions/__tests__/config-audit_test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml supabase/functions/__tests__/config-audit_test.ts
git commit -m "chore(supabase): remove stale portal function config"
```

---

### Task 5: Run the Complete Verification Gate

**Files:**
- No production files; fix only regressions attributable to the preceding tasks.

**Interfaces:**
- Produces: final evidence for tests, builds, lint, audit, worker behavior, and diff review.

- [ ] **Step 1: Run all automated checks**

```bash
npm run test
npm run test:functions
npm run build
npm run build:hub
npm run build:admin
npm run lint
npm audit --omit=dev
npm test --prefix workers/media-proxy
```

Expected: every command exits zero. Record exact test totals and bundle sizes.

- [ ] **Step 2: Check the branch diff and hygiene**

```bash
git diff --check main...HEAD
git status --short
git diff --stat main...HEAD
git diff main...HEAD
```

Expected: no whitespace errors, no untracked implementation files, no environment/credential files, and only approved-scope changes.

- [ ] **Step 3: Prepare the final audit evidence**

Use the final code line numbers to report every finding by category with severity, effort, impact, fix, and file/line references. Include remaining deferred image infrastructure, CSP, stale documentation/root config, apparently unused Hub PostCard, duplicated inline-image code, and the read-only membership audit command.
