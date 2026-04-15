# Analytics Page Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cliente and Período filter pills to AnalyticsPage, wiring Período to a real `days` parameter in `getPortfolioSummary`.

**Architecture:** Two client-side state values (`clienteFilter` string, `days` number) drive all rendering. `getPortfolioSummary` is updated to accept a `days` param replacing the hardcoded `30`. React Query key includes `days` so changing the period triggers a real refetch. Cliente filtering is pure client-side array filtering applied to the already-fetched `accounts`.

**Tech Stack:** React, TypeScript, TanStack Query, shadcn/ui Select (same pill pattern as IdeiasPage)

---

### Task 1: Add `days` param to `getPortfolioSummary`

**Files:**
- Modify: `apps/crm/src/services/analytics.ts:185-324`

- [ ] **Step 1: Update function signature and replace hardcoded 30**

In `apps/crm/src/services/analytics.ts`, change line 185 from:

```ts
export async function getPortfolioSummary(): Promise<PortfolioSummary> {
```

to:

```ts
export async function getPortfolioSummary(days = 28): Promise<PortfolioSummary> {
```

Then find the two occurrences of the hardcoded `30` inside the function body and replace them with `days`:

Line ~218:
```ts
// Before
const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
// After
const periodAgo = new Date(Date.now() - days * 86400000).toISOString();
```

Update its usage at line ~224:
```ts
// Before
.gte('posted_at', thirtyDaysAgo);
// After
.gte('posted_at', periodAgo);
```

Line ~232 (follower history window):
```ts
// Before
.gte('date', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0])
// After
.gte('date', new Date(Date.now() - days * 86400000).toISOString().split('T')[0])
```

Also update the `posts_last_30d` label in the returned object — rename the field to `posts_last_Nd` is too much churn; leave the field name as-is (it's a type concern, not a bug). The data will correctly reflect the selected period.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit -p apps/crm/tsconfig.json 2>&1 | head -30
```

Expected: no errors related to `getPortfolioSummary`.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/services/analytics.ts
git commit -m "feat: add days param to getPortfolioSummary (default 28)"
```

---

### Task 2: Add filter state and filter bar to AnalyticsPage

**Files:**
- Modify: `apps/crm/src/pages/analytics/AnalyticsPage.tsx`

- [ ] **Step 1: Add imports**

At the top of `apps/crm/src/pages/analytics/AnalyticsPage.tsx`, add these imports alongside the existing ones:

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

- [ ] **Step 2: Add filter state**

Inside `export default function AnalyticsPage()`, add two state variables right after the existing `useState` declarations (after `sortDirection`):

```ts
const [days, setDays] = useState<number>(28);
const [clienteFilter, setClienteFilter] = useState<string>('all');
```

- [ ] **Step 3: Wire `days` into the query**

Update the `useQuery` call to include `days` in the key and pass it to `getPortfolioSummary`:

```ts
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['portfolio-summary', days],
  queryFn: () => getPortfolioSummary(days),
});
```

- [ ] **Step 4: Derive `filteredAccounts`**

After the `const { accounts, summary } = data;` line, add:

```ts
const filteredAccounts = clienteFilter === 'all'
  ? accounts
  : accounts.filter(a => String(a.client_id) === clienteFilter);
```

Then replace every reference to `accounts` in the rendering section with `filteredAccounts`, **except** for `data.accounts` in the `handleSyncAll` function (sync should always operate on all accounts). Specifically:

- `silentAccounts` filter source → `filteredAccounts`
- `totalFollowers`, `totalReach`, `avgEngagement` reducers → `filteredAccounts`
- `specialtyMap` loop → `filteredAccounts`
- `bestByReach`, `mostPosts`, `mostFollowers` sorts → `filteredAccounts`
- `sortedAccounts` spread → `filteredAccounts`
- `accounts.length === 0` empty-state check in table → `filteredAccounts.length === 0`
- `accounts.length > 0` highlight KPI row guard → `filteredAccounts.length > 0`
- `accounts.length >= 2` benchmark/specialty section guard → `filteredAccounts.length >= 2`
- `<AIPortfolioSection accounts={accounts} />` → `<AIPortfolioSection accounts={filteredAccounts} />`
- `<BenchmarkChart accounts={accounts} />` inside the widgets grid → `<BenchmarkChart accounts={filteredAccounts} />`

- [ ] **Step 5: Build the sorted client list for the dropdown**

Just before the `return (` statement, add:

```ts
const sortedClientOptions = [...accounts]
  .sort((a, b) => a.client_name.localeCompare(b.client_name, 'pt-BR'))
  .filter((a, i, arr) => arr.findIndex(x => x.client_id === a.client_id) === i); // dedupe
```

- [ ] **Step 6: Add the filter bar to JSX**

Inside the `return`, after the closing `</header>` tag and before the `{silentAccounts.length > 0 && (` block, insert:

```tsx
<div className="flex flex-wrap items-center gap-3 mb-4 animate-up">
  <Select value={clienteFilter} onValueChange={setClienteFilter}>
    <SelectTrigger className="!rounded-full !text-xs h-9 px-4 w-auto min-w-[160px] mb-0">
      <SelectValue placeholder="Todos os clientes" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">Todos os clientes</SelectItem>
      {sortedClientOptions.map(a => (
        <SelectItem key={a.client_id} value={String(a.client_id)}>
          {a.client_name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>

  <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
    <SelectTrigger className="!rounded-full !text-xs h-9 px-4 w-auto min-w-[130px] mb-0">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="7">Últimos 7 dias</SelectItem>
      <SelectItem value="28">Últimos 28 dias</SelectItem>
      <SelectItem value="90">Últimos 90 dias</SelectItem>
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 7: Update header subtitle to reflect selected period**

Find the `<p>Visão geral de todas as contas conectadas.</p>` line and replace it with:

```tsx
<p>Visão geral de todas as contas conectadas · últimos {days} dias.</p>
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit -p apps/crm/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/analytics/AnalyticsPage.tsx
git commit -m "feat: add cliente and período filters to AnalyticsPage"
```
