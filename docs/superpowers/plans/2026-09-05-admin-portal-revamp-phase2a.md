# Admin Portal Revamp Phase 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the admin chrome (sidebar, login), every clickable list row, and the Admins, Integrações, KB list and Workspace detail pages to the shadcn primitives copied in Phase 1, with no behaviour change.

**Architecture:** Frontend-only. Two more primitives (`Textarea`, `Switch`) are copied from the CRM into `apps/admin/src/components/ui/`. A `RowLink`/`RowButton` pair plus a `lib/routes.ts` helper give every clickable row a real keyboard target. Each page is rewritten in place on `PageHeader`, `Card`, `Table`, `Badge`, `Button`, `Input`, `Select`, `Skeleton`, `EmptyState`, `ErrorState`. The sidebar drops its hex palette for the admin tokens so it follows the light/dark theme.

**Tech Stack:** React 19, React Router v7 (`Link`, `NavLink`, `useNavigate`), TanStack Query v5, Radix/shadcn primitives, Tailwind tokens from `apps/admin/src/globals.css`, Vitest + Testing Library (jsdom), lucide-react icons, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-09-05-admin-portal-revamp-phase2a-design.md`

## Ajustes em relação ao spec (decididos ao escrever o plano)

Quatro pontos do spec não batem com o código atual ou com a regra "migração pura". O plano segue o código:

1. **Plano do workspace salva ao selecionar.** O spec §4.4 fala em "Select + Button Salvar plano". Hoje o `<select>` chama `setPlanMutation.mutate` no `onChange`. Manter esse comportamento: o `Select` muta no `onValueChange`, sem botão novo.
2. **Notas sem "Descartar".** O spec §4.4 lista um botão "Descartar" para as notas. Ele não existe hoje e as notas são salvas junto com os overrides ("Salvar overrides"). Nada é adicionado.
3. **Convites mantêm o grid de linhas.** O spec §4.6 diz "Lista em Table". O `InviteRow` usa `md:contents` para reaproveitar os mesmos nós no mobile e no desktop; trocar por `Table` duplicaria o markup. Fica o grid, com `Badge` e `Button`.
4. **Admins: `EmptyState` só com lista vazia.** O spec §4.1 diz "quando a lista só tem o próprio usuário". Isso esconderia a própria linha. O `EmptyState` aparece só quando a API devolve zero admins.

O spec também dizia (Fase 1, memória) que o `Select` do Radix não abre em jsdom. Abre: `fireEvent.click` no `combobox` e depois `findByRole('option')`, com `Element.prototype.scrollIntoView = vi.fn()` no topo do teste (padrão de `apps/crm/src/pages/equipe/__tests__/EquipePage.test.tsx`). As tarefas de teste usam isso.

## Global Constraints

- Copy em **português**, sem travessão (use ponto, dois-pontos ou "·"). Vale para texto visível, `aria-label`, `title` e `placeholder`.
- **Nenhuma mudança de comportamento.** Mesmas queries, mesmas mutations, mesmos `window.confirm`, mesmos toasts, mesmo estado local. Só muda markup, classes e acessibilidade.
- Primitivos do admin importam `cn` de `'../../lib/utils'` (nunca `@/lib/utils`). Páginas importam de `'../lib/utils'`, `'../components/ui/<x>'`, `'../components/<X>'`.
- **Sem literal hex `#rrggbb`** nos arquivos desta fase, exceto: `pages/LoginPage.tsx` (`#eaf0dc`, `#eab308` no gradiente) e `layouts/AdminLayout.tsx` (`#3984FF`, `#FF3F3F`, `#6AC9D0`, `#C6229B`, `#EA0E78`, `#FE3452`, `#FE7340`, `#FFC32E` no símbolo do logo). O teste `no-hex-literals.test.ts` (Task 7) garante isso.
- Ícones só de `lucide-react`. Toasts só via `toast` de `sonner`.
- jsdom renderiza os dois layouts (`hidden md:table` e `md:hidden`): testes de tabela escopam com `within(screen.getByRole('table'))` ou usam `getAllBy*`.
- Toda célula primária de linha clicável usa `RowLink` (navega) ou `RowButton` (abre modal), ambos de `components/RowLink.tsx` (Task 2). A linha mantém `onClick` e `cursor-pointer`.
- Rotas do admin só via `lib/routes.ts` (`workspaceDetailPath`, `kbArticleEditPath`, `kbArticleNewPath`) nos arquivos tocados.
- Antes de cada commit: `npx prettier --write <arquivos>` e `npx eslint <arquivos>`. Antes de dar a task por concluída: `npx tsc -p apps/admin/tsconfig.json --noEmit` e `npx vitest run apps/admin`.
- Commits pequenos, mensagens em português no padrão `feat(admin): …`, `test(admin): …`, `refactor(admin): …`, terminadas com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

| Arquivo                                                        | Ação                | Responsabilidade                                                     |
| -------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| `apps/admin/src/components/ui/textarea.tsx`                    | criar               | cópia do CRM                                                         |
| `apps/admin/src/components/ui/switch.tsx`                      | criar               | cópia do CRM                                                         |
| `apps/admin/src/components/ui/__tests__/primitives.test.tsx`   | editar              | smoke dos dois primitivos                                            |
| `apps/admin/src/lib/subscription.ts`                           | editar              | `STATUS_BADGE_VARIANT` exportado; remover `toneBadgeClass` (Task 11) |
| `apps/admin/src/lib/__tests__/subscription.test.ts`            | editar              | remover bloco `toneBadgeClass` (Task 11)                             |
| `apps/admin/src/lib/routes.ts`                                 | criar               | helpers de rota                                                      |
| `apps/admin/src/components/RowLink.tsx`                        | criar               | `RowLink`, `RowButton`, `ROW_TRIGGER_CLASS`                          |
| `apps/admin/src/pages/workspaces/WorkspacesTable.tsx`          | editar              | nome vira `RowLink`                                                  |
| `apps/admin/src/pages/DashboardPage.tsx`                       | editar              | três listas com `RowLink`, `STATUS_BADGE_VARIANT`                    |
| `apps/admin/src/pages/KbArticlesPage.tsx`                      | reescrever          | primitivos + `RowLink`                                               |
| `apps/admin/src/pages/BannersPage.tsx`, `PopupsPage.tsx`       | editar (só a linha) | `RowButton`                                                          |
| `apps/admin/src/layouts/AdminLayout.tsx`                       | editar              | tokens no lugar de hex                                               |
| `apps/admin/src/layouts/__tests__/AdminLayout.test.tsx`        | criar               | sidebar                                                              |
| `apps/admin/src/pages/LoginPage.tsx`                           | editar              | primitivos + tokens                                                  |
| `apps/admin/src/__tests__/no-hex-literals.test.ts`             | criar               | guarda de hex                                                        |
| `apps/admin/src/pages/AdminsPage.tsx`                          | reescrever          | primitivos                                                           |
| `apps/admin/src/pages/__tests__/AdminsPage.test.tsx`           | criar               |                                                                      |
| `apps/admin/src/pages/IntegrationsPage.tsx`                    | reescrever          | primitivos                                                           |
| `apps/admin/src/pages/__tests__/IntegrationsPage.test.tsx`     | editar              |                                                                      |
| `apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx`       | criar               |                                                                      |
| `apps/admin/src/pages/WorkspaceDetailPage.tsx`                 | reescrever JSX      | primitivos                                                           |
| `apps/admin/src/pages/WorkspaceEventsCard.tsx`                 | reescrever JSX      | primitivos                                                           |
| `apps/admin/src/pages/WorkspaceInvitesCard.tsx`                | reescrever JSX      | primitivos                                                           |
| `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx` | editar              | Radix Select                                                         |
| `apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx`      | editar              | `MemoryRouter` + link                                                |
| `apps/admin/src/pages/__tests__/DashboardPage.test.tsx`        | editar              | link                                                                 |
| `DESIGN_SYSTEM.md`                                             | editar              | nota "### Primitives"                                                |

---

### Task 1: Primitivos `Textarea` e `Switch`, `STATUS_BADGE_VARIANT` compartilhado

**Files:**

- Create: `apps/admin/src/components/ui/textarea.tsx`
- Create: `apps/admin/src/components/ui/switch.tsx`
- Modify: `apps/admin/src/components/ui/__tests__/primitives.test.tsx`
- Modify: `apps/admin/src/lib/subscription.ts`
- Modify: `apps/admin/src/pages/DashboardPage.tsx:23-28`
- Modify: `apps/admin/src/pages/workspaces/WorkspacesTable.tsx:33-38`
- Modify: `DESIGN_SYSTEM.md:156-166`

**Interfaces:**

- Produces: `Textarea` (`React.ComponentProps<'textarea'>`), `Switch` (Radix `Switch.Root` props: `checked`, `onCheckedChange`, `disabled`, `id`), `STATUS_BADGE_VARIANT: Record<StatusTone, 'success' | 'warning' | 'danger' | 'neutral'>` em `lib/subscription.ts`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final do `describe('admin primitives', …)` em `apps/admin/src/components/ui/__tests__/primitives.test.tsx` (e os imports no topo):

```tsx
import { fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { Switch } from '../switch';
import { Textarea } from '../textarea';
```

```tsx
it('Textarea forwards ref, value and className', () => {
  const ref = createRef<HTMLTextAreaElement>();
  const onChange = vi.fn();
  render(
    <Textarea ref={ref} value="nota" onChange={onChange} className="extra" aria-label="Notas" />,
  );
  const el = screen.getByRole('textbox', { name: 'Notas' }) as HTMLTextAreaElement;
  expect(ref.current).toBe(el);
  expect(el.value).toBe('nota');
  expect(el.className).toContain('extra');
  fireEvent.change(el, { target: { value: 'nova' } });
  expect(onChange).toHaveBeenCalled();
});

it('Switch toggles aria-checked and respects disabled', () => {
  const onCheckedChange = vi.fn();
  render(<Switch aria-label="Ativo" onCheckedChange={onCheckedChange} />);
  const sw = screen.getByRole('switch', { name: 'Ativo' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(sw);
  expect(onCheckedChange).toHaveBeenCalledWith(true);
  expect(sw).toHaveAttribute('aria-checked', 'true');
});

it('Switch disabled does not toggle', () => {
  const onCheckedChange = vi.fn();
  render(<Switch aria-label="Travado" disabled onCheckedChange={onCheckedChange} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Travado' }));
  expect(onCheckedChange).not.toHaveBeenCalled();
});
```

Adicionar `vi` ao import de `vitest` se ainda não estiver: `import { describe, expect, it, vi } from 'vitest';`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/admin/src/components/ui/__tests__/primitives.test.tsx`
Expected: FAIL com "Failed to resolve import '../switch'" (ou '../textarea').

- [ ] **Step 3: Criar os primitivos**

`apps/admin/src/components/ui/textarea.tsx`:

```tsx
import * as React from 'react';

import { cn } from '../../lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
```

`apps/admin/src/components/ui/switch.tsx`:

```tsx
import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/components/ui/__tests__/primitives.test.tsx`
Expected: PASS (todos os casos, incluindo os 3 novos).

- [ ] **Step 5: `STATUS_BADGE_VARIANT` em `lib/subscription.ts`**

Logo após `export type StatusTone = …` (linha 48) adicionar:

```ts
/** Badge variant for a subscription status tone. Shared by Dashboard, Workspaces and Workspace detail. */
export const STATUS_BADGE_VARIANT = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  muted: 'neutral',
} as const satisfies Record<StatusTone, 'success' | 'warning' | 'danger' | 'neutral'>;
```

Em `apps/admin/src/pages/DashboardPage.tsx`: apagar o bloco local `const STATUS_VARIANT = { … } as const;` (linhas 23-28), acrescentar `STATUS_BADGE_VARIANT` ao import de `'../lib/subscription'` e trocar as duas ocorrências `STATUS_VARIANT[meta.tone]` por `STATUS_BADGE_VARIANT[meta.tone]`.

Em `apps/admin/src/pages/workspaces/WorkspacesTable.tsx`: apagar o bloco local `const STATUS_VARIANT` (linhas 33-38), acrescentar `STATUS_BADGE_VARIANT` ao import de `'../../lib/subscription'` e trocar `STATUS_VARIANT[meta.tone]` por `STATUS_BADGE_VARIANT[meta.tone]`.

- [ ] **Step 6: DESIGN_SYSTEM.md**

Na seção `### Primitives` do bloco Admin, trocar a lista `(button, input, select, table, dropdown-menu, checkbox, skeleton, tabs, label, separator, tooltip)` por `(button, input, textarea, select, switch, table, dropdown-menu, checkbox, skeleton, tabs, label, separator, tooltip)` e acrescentar ao final do parágrafo: `Clickable rows use \`RowLink\`/\`RowButton\` from \`apps/admin/src/components/RowLink.tsx\` so the primary cell is a real link or button.`

- [ ] **Step 7: Verificar e commitar**

Run: `npx prettier --write apps/admin/src/components/ui apps/admin/src/lib/subscription.ts apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/workspaces/WorkspacesTable.tsx DESIGN_SYSTEM.md && npx tsc -p apps/admin/tsconfig.json --noEmit && npx vitest run apps/admin`
Expected: tsc sem erros; vitest verde.

```bash
git add apps/admin/src/components/ui apps/admin/src/lib/subscription.ts apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/workspaces/WorkspacesTable.tsx DESIGN_SYSTEM.md
git commit -m "feat(admin): primitivos Textarea e Switch, STATUS_BADGE_VARIANT compartilhado"
```

---

### Task 2: `lib/routes.ts`, `RowLink`/`RowButton` e link na tabela de Workspaces

**Files:**

- Create: `apps/admin/src/lib/routes.ts`
- Create: `apps/admin/src/components/RowLink.tsx`
- Modify: `apps/admin/src/pages/workspaces/WorkspacesTable.tsx`
- Modify: `apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx`

**Interfaces:**

- Produces: `workspaceDetailPath(id: string): string`, `kbArticleEditPath(id: string): string`, `kbArticleNewPath(): string`; `RowLink` (props de `Link` do React Router), `RowButton` (props de `<button>`), `ROW_TRIGGER_CLASS: string`.
- `WorkspacesTable` continua com `onOpen(id)` para o clique na linha.

- [ ] **Step 1: Teste que falha (tabela)**

Em `apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx`:

1. Acrescentar `import { MemoryRouter } from 'react-router-dom';`.
2. Em `renderTable`, envolver `<TooltipProvider>` com `<MemoryRouter>…</MemoryRouter>`.
3. Substituir o teste `'navigates when a row is clicked'` por estes dois:

```tsx
it('navigates when a row is clicked outside the name link', () => {
  const { onOpen } = renderTable();
  const table = within(screen.getByRole('table'));
  fireEvent.click(table.getByText('42'));
  expect(onOpen).toHaveBeenCalledWith('ws-1');
});

it('the name cell is a real link to the detail page and does not double-fire the row click', () => {
  const { onOpen } = renderTable();
  const table = within(screen.getByRole('table'));
  const link = table.getByRole('link', { name: 'Agência Norte' });
  expect(link).toHaveAttribute('href', '/admin/workspaces/ws-1');
  fireEvent.click(link);
  expect(onOpen).not.toHaveBeenCalled();
  const card = within(screen.getByRole('list'));
  expect(card.getByRole('link', { name: 'Agência Norte' })).toHaveAttribute(
    'href',
    '/admin/workspaces/ws-1',
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx`
Expected: FAIL em "Unable to find an accessible element with the role 'link'".

- [ ] **Step 3: Criar `lib/routes.ts`**

```ts
/** Admin route builders. Every row link and every navigate() to these pages goes through here. */
export const workspaceDetailPath = (id: string) => `/admin/workspaces/${id}`;
export const kbArticleEditPath = (id: string) => `/admin/kb-articles/${id}/edit`;
export const kbArticleNewPath = () => '/admin/kb-articles/new';
```

- [ ] **Step 4: Criar `components/RowLink.tsx`**

```tsx
import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '../lib/utils';

/**
 * Primary-cell trigger inside a clickable row. The row keeps its onClick for the mouse;
 * this element gives keyboard and screen-reader users a real link/button, and stops
 * propagation so activating it does not also fire the row's handler.
 */
export const ROW_TRIGGER_CLASS =
  'rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function RowLink({ className, onClick, ...props }: LinkProps) {
  return (
    <Link
      className={cn(ROW_TRIGGER_CLASS, className)}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      {...props}
    />
  );
}

export function RowButton({
  className,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(ROW_TRIGGER_CLASS, 'text-left', className)}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      {...props}
    />
  );
}
```

- [ ] **Step 5: Usar `RowLink` em `WorkspacesTable.tsx`**

Imports novos:

```tsx
import { RowLink } from '../../components/RowLink';
import { workspaceDetailPath } from '../../lib/routes';
```

No `cellFor`, caso `'name'`:

```tsx
    case 'name':
      return (
        <span className="flex items-center gap-2">
          <RowLink to={workspaceDetailPath(ws.id)}>{ws.name}</RowLink>
          {ws.has_overrides ? (
            <Badge variant="warning" size="sm">
              overrides
            </Badge>
          ) : null}
        </span>
      );
```

No cartão mobile, trocar `<span className="font-medium text-foreground">{ws.name}</span>` por `<RowLink to={workspaceDetailPath(ws.id)}>{ws.name}</RowLink>`.

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx apps/admin/src/pages/__tests__/WorkspacesPage.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/admin/src/lib/routes.ts apps/admin/src/components/RowLink.tsx apps/admin/src/pages/workspaces/WorkspacesTable.tsx apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx
npx tsc -p apps/admin/tsconfig.json --noEmit
git add apps/admin/src/lib/routes.ts apps/admin/src/components/RowLink.tsx apps/admin/src/pages/workspaces/WorkspacesTable.tsx apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx
git commit -m "feat(admin): nome do workspace vira link real na tabela (RowLink + lib/routes)"
```

---

### Task 3: Links nas três listas do Dashboard

**Files:**

- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Modify: `apps/admin/src/pages/__tests__/DashboardPage.test.tsx`

**Interfaces:**

- Consumes: `RowLink`, `workspaceDetailPath` (Task 2).

- [ ] **Step 1: Teste que falha**

Em `DashboardPage.test.tsx`, dentro do `describe('DashboardPage per-card loading', …)`, acrescentar:

```tsx
it('recent workspace names are real links to the detail page', async () => {
  renderPage();
  const links = await screen.findAllByRole('link', { name: 'A' });
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link).toHaveAttribute('href', '/admin/workspaces/a');
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/admin/src/pages/__tests__/DashboardPage.test.tsx`
Expected: FAIL (nenhum `link` com nome "A").

- [ ] **Step 3: Aplicar `RowLink` nas três listas**

Imports:

```tsx
import { RowLink } from '../components/RowLink';
import { workspaceDetailPath } from '../lib/routes';
```

Trocar os três `onClick={() => navigate(\`/admin/workspaces/${…}\`)}`por`onClick={() => navigate(workspaceDetailPath(…))}`(mantendo`ws.workspace_id`nas listas MRR e pendentes,`ws.id` na lista recente).

Lista MRR (linhas ~268 e ~289): trocar
`<span className="text-foreground font-medium truncate">{ws.name}</span>` (mobile) por
`<RowLink to={workspaceDetailPath(ws.workspace_id)} className="block truncate">{ws.name}</RowLink>`
e
`<span className="text-foreground font-medium text-sm truncate">{ws.name}</span>` (desktop) por
`<RowLink to={workspaceDetailPath(ws.workspace_id)} className="block truncate text-sm">{ws.name}</RowLink>`.

Lista de trials pendentes (linhas ~412 e ~437): mesmas duas trocas, com `ws.workspace_id`.

Lista recente (linhas ~496 e ~510): trocar
`<span className="text-foreground font-medium">{ws.name}</span>` (mobile) por
`<RowLink to={workspaceDetailPath(ws.id)}>{ws.name}</RowLink>`
e
`<span className="hidden md:inline text-foreground font-medium text-sm">{ws.name}</span>` (desktop) por
`<RowLink to={workspaceDetailPath(ws.id)} className="hidden text-sm md:inline">{ws.name}</RowLink>`.

- [ ] **Step 4: Estados das três listas**

Imports: `import { Skeleton } from '../components/ui/skeleton';` e `import { EmptyState } from '../components/EmptyState';`. Definir uma vez, acima de `export default function DashboardPage()`:

```tsx
function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-4">
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-4 w-60" />
    </div>
  );
}
```

Trocar cada `<p className="text-sm text-dim-foreground py-4">Carregando…</p>` das três listas (MRR, trials pendentes, recentes) por `<ListSkeleton />`, e os dois `<p className="text-sm text-dim-foreground py-4">Nenhum … ainda.</p>` por `<EmptyState title="Nenhum workspace pagante ainda" />` e `<EmptyState title="Nenhum workspace em teste no momento" />` respectivamente (mantendo o texto que cada `<p>` tem hoje, sem o ponto final). O KPI grid e o `RiskCard` não mudam.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/pages/__tests__/DashboardPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/__tests__/DashboardPage.test.tsx
git add apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/__tests__/DashboardPage.test.tsx
git commit -m "feat(admin): nomes das listas do Dashboard viram links reais; Skeleton e EmptyState nas listas"
```

---

### Task 4: `RowButton` nas linhas de Banners e Popups

**Files:**

- Modify: `apps/admin/src/pages/BannersPage.tsx:264-315`
- Modify: `apps/admin/src/pages/PopupsPage.tsx:213-232`
- Modify: `apps/admin/src/pages/__tests__/PopupsPage.test.tsx`

**Interfaces:**

- Consumes: `RowButton` (Task 2).

- [ ] **Step 1: Teste que falha (Popups)**

Ler `apps/admin/src/pages/__tests__/PopupsPage.test.tsx` para descobrir o helper de render e um fixture de popup com título. Acrescentar um teste no `describe` principal:

```tsx
it('the popup title is a real button that opens the editor', async () => {
  renderPage();
  const buttons = await screen.findAllByRole('button', { name: FIRST_POPUP_TITLE });
  fireEvent.click(buttons[0]);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});
```

Substituir `FIRST_POPUP_TITLE` pelo título do primeiro popup do fixture existente e `renderPage` pelo nome do helper do arquivo. Se o editor não expõe `role="dialog"`, assertar o que o arquivo já usa para detectar o formulário aberto (procure `showForm`/`PopupEditor` nos testes existentes e reutilize a mesma asserção).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/admin/src/pages/__tests__/PopupsPage.test.tsx`
Expected: FAIL (nenhum `button` com o título).

- [ ] **Step 3: Banners**

Import: `import { RowButton } from '../components/RowLink';`

Mobile (linhas ~273-276): trocar

```tsx
<span className="text-sm font-medium truncate">
  {b.content.slice(0, 60)}
  {b.content.length > 60 ? '...' : ''}
</span>
```

por

```tsx
<RowButton onClick={() => openEdit(b)} className="truncate text-sm">
  {b.content.slice(0, 60)}
  {b.content.length > 60 ? '...' : ''}
</RowButton>
```

Desktop (linhas ~296-299): trocar

```tsx
<div className="text-sm font-medium truncate">
  {b.content.slice(0, 80)}
  {b.content.length > 80 ? '...' : ''}
</div>
```

por

```tsx
<RowButton onClick={() => openEdit(b)} className="block max-w-full truncate text-sm">
  {b.content.slice(0, 80)}
  {b.content.length > 80 ? '...' : ''}
</RowButton>
```

- [ ] **Step 4: Popups**

Import: `import { RowButton } from '../components/RowLink';`

Traduzir a linha de métricas (linha 211): `const metrics = \`vistos ${p.counts.seen} · fechados ${p.counts.closed} · cta ${p.counts.cta} · confirmados ${p.counts.ack}\`;`. No teste `'mostra título da primeira página, badge de páginas, frequência com ack e métricas'`de`PopupsPage.test.tsx`, trocar `/seen 312/`por`/vistos 312/`(o`/cta 87/` fica).

Extrair o handler da linha para reaproveitar:

```tsx
const open = () => {
  setEditing(p);
  setShowForm(true);
};
```

(logo após `const metrics = …`), trocar o `onClick={() => { setEditing(p); setShowForm(true); }}` da `div` por `onClick={open}`, e trocar `<span className="truncate">{first?.title}</span>` por

```tsx
<RowButton onClick={open} className="truncate text-sm">
  {first?.title ?? 'Popup sem título'}
</RowButton>
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/pages/__tests__/PopupsPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/admin/src/pages/BannersPage.tsx apps/admin/src/pages/PopupsPage.tsx apps/admin/src/pages/__tests__/PopupsPage.test.tsx
npx tsc -p apps/admin/tsconfig.json --noEmit
git add apps/admin/src/pages/BannersPage.tsx apps/admin/src/pages/PopupsPage.tsx apps/admin/src/pages/__tests__/PopupsPage.test.tsx
git commit -m "feat(admin): título de banner e popup vira botão real na linha; métricas do popup em português"
```

---

### Task 5: Sidebar segue o tema (`AdminLayout`)

**Files:**

- Modify: `apps/admin/src/layouts/AdminLayout.tsx`
- Create: `apps/admin/src/layouts/__tests__/AdminLayout.test.tsx`

- [ ] **Step 1: Teste que falha**

`apps/admin/src/layouts/__tests__/AdminLayout.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ adminEmail: 'admin@mesaas.com.br', signOut: vi.fn() }),
}));
vi.mock('../../liquidglass/LiquidGlassProvider', () => ({
  useLiquidGlassContext: () => ({ enabled: false, toggle: vi.fn() }),
}));
vi.mock('../../liquidglass/LiquidBackdrop', () => ({ LiquidBackdrop: () => null }));

import AdminLayout from '../AdminLayout';

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<p>conteúdo</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the navigation as real links', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: 'Workspaces' })).toHaveAttribute(
      'href',
      '/admin/workspaces',
    );
    expect(screen.getByRole('link', { name: 'Integrações' })).toHaveAttribute(
      'href',
      '/admin/integrations',
    );
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });

  it('the sidebar has no theme-pinned hex classes', () => {
    renderLayout();
    const aside = screen.getByRole('complementary');
    expect(aside.className).not.toMatch(/#[0-9a-f]{6}/i);
    expect(aside.className).toContain('bg-card');
  });

  it('the theme toggle flips data-theme and persists it', () => {
    renderLayout();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Modo claro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('admin-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Modo escuro' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/admin/src/layouts/__tests__/AdminLayout.test.tsx`
Expected: FAIL em `expect(aside.className).not.toMatch(/#[0-9a-f]{6}/i)` (e o toggle sem `aria-label` pode falhar no `getByRole('button', { name: 'Modo claro' })` dependendo do `title`; ambos são corrigidos no passo 3).

- [ ] **Step 3: Reescrever o JSX do layout**

Substituir o `return (…)` inteiro de `AdminLayout` (linhas 53-212) por este. Os `d="M…"` dos `<path>` do wordmark são mantidos exatamente como estão; só o `fill` muda. Manter os hooks acima intactos.

```tsx
return (
  <div className="flex min-h-screen">
    <LiquidBackdrop />
    {/* Mobile hamburger */}
    <Button
      variant="outline"
      size="icon"
      aria-label="Abrir menu"
      onClick={() => setSidebarOpen(true)}
      className="fixed left-4 top-4 z-30 md:hidden"
    >
      <Menu size={20} />
    </Button>

    {/* Backdrop */}
    {sidebarOpen && (
      <div
        className="md:hidden fixed inset-0 bg-black/50 z-40"
        onClick={() => setSidebarOpen(false)}
      />
    )}

    {/* Sidebar: follows the theme via tokens; frosted glass when liquid glass is ON */}
    <aside
      className={`glass-surface glass-surface--sidebar w-[220px] bg-card border-r border-border flex flex-col fixed inset-y-0 left-0 z-50 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:transform-none`}
    >
      <div className="px-5 pt-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            width="130"
            height="17"
            viewBox="0 0 1468 186"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="shrink-0 text-foreground"
            aria-label="Mesaas"
            role="img"
          >
            {/* …os seis <path> do wordmark, cada um com fill="currentColor" no lugar de fill="#F8F8F8"… */}
            {/* …o <path fill="url(#alg)">, o <path fill="#3984FF">, os dois <rect> e o <defs> ficam idênticos… */}
          </svg>
          <span className="text-[0.6rem] font-medium text-muted-foreground uppercase tracking-widest">
            admin
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
          className="h-8 w-8 text-muted-foreground hover:text-foreground md:hidden"
        >
          <X size={18} />
        </Button>
      </div>

      <nav className="flex-1 px-3 flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/admin'}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-border mt-auto">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-muted-foreground truncate">{adminEmail}</p>
          <div className="flex items-center gap-1">
            {!glassEnabled && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                className="h-7 w-7 text-muted-foreground hover:text-primary"
                aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
                title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleGlass}
              className={`h-7 w-7 ${glassEnabled ? 'text-primary' : 'text-muted-foreground'} hover:text-primary`}
              aria-label={glassEnabled ? 'Desativar Liquid Glass' : 'Ativar Liquid Glass'}
              title={
                glassEnabled
                  ? 'Liquid Glass: ativado (clique para desativar)'
                  : 'Liquid Glass: desativado (clique para ativar)'
              }
            >
              <Sparkles size={14} />
            </Button>
          </div>
        </div>
        <button
          onClick={signOut}
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          Sair
        </button>
      </div>
    </aside>

    <main className="md:ml-[220px] flex-1 min-h-screen">
      {/* pt-16 on mobile keeps the page heading clear of the fixed hamburger button. */}
      <div className="p-4 pt-16 md:p-8">
        <Outlet />
      </div>
    </main>
  </div>
);
```

Import novo: `import { Button } from '../components/ui/button';`

Os comentários `{/* … */}` dentro do `<svg>` acima são instruções para o implementador, não código: o bloco `<svg>` final contém os mesmos oito `<path>`, dois `<rect>` e o `<defs>` de hoje, com apenas os seis `fill="#F8F8F8"` trocados por `fill="currentColor"`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/layouts/__tests__/AdminLayout.test.tsx`
Expected: PASS (3 testes).

- [ ] **Step 5: Conferir que não sobrou hex fora do símbolo**

Run: `grep -o '#[0-9a-fA-F]\{6\}' apps/admin/src/layouts/AdminLayout.tsx | sort -u`
Expected: exatamente `#3984FF #6AC9D0 #C6229B #EA0E78 #FE3452 #FE7340 #FF3F3F #FFC32E` (ordem do sort pode variar). Nenhum `#F8F8F8`, `#12151a`, `#1e2430`, `#9ca3af`, `#e8eaf0`, `#eab308`, `#4b5563`.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/admin/src/layouts
npx tsc -p apps/admin/tsconfig.json --noEmit
git add apps/admin/src/layouts
git commit -m "feat(admin): sidebar segue o tema (tokens no lugar de hex fixo)"
```

---

### Task 6: `LoginPage` em primitivos

**Files:**

- Modify: `apps/admin/src/pages/LoginPage.tsx:51-101`

- [ ] **Step 1: Reescrever o JSX**

Imports novos:

```tsx
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
```

Substituir o `return (…)` por:

```tsx
return (
  <div
    className="min-h-screen flex items-center justify-center p-4"
    style={{ background: 'linear-gradient(135deg, #eaf0dc 0%, #eab308 100%)' }}
  >
    <div className="w-full max-w-[400px] rounded-3xl bg-card p-10 text-card-foreground shadow-xl">
      <div className="flex flex-col items-center mb-8">
        <img src="/logo-black.svg" alt="Mesaas" className="h-5 w-auto" />
        <p className="mt-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          admin
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-login-email" className="text-xs uppercase tracking-wider">
            E-mail
          </Label>
          <Input
            id="admin-login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-login-password" className="text-xs uppercase tracking-wider">
            Senha
          </Label>
          <Input
            id="admin-login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </div>
  </div>
);
```

- [ ] **Step 2: Conferir hex e tipos**

Run: `grep -o '#[0-9a-fA-F]\{6\}' apps/admin/src/pages/LoginPage.tsx | sort -u && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: só `#eab308` e `#eaf0dc`; tsc limpo.

- [ ] **Step 3: Commit**

```bash
npx prettier --write apps/admin/src/pages/LoginPage.tsx
git add apps/admin/src/pages/LoginPage.tsx
git commit -m "feat(admin): login em primitivos e tokens"
```

---

### Task 7: Guarda contra literais hex

**Files:**

- Create: `apps/admin/src/__tests__/no-hex-literals.test.ts`

- [ ] **Step 1: Escrever o teste**

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Files migrated to tokens in the Phase 2a revamp. Add a file here when it is migrated. */
const FILES = [
  'layouts/AdminLayout.tsx',
  'pages/LoginPage.tsx',
  'pages/AdminsPage.tsx',
  'pages/IntegrationsPage.tsx',
  'pages/KbArticlesPage.tsx',
  'pages/WorkspaceDetailPage.tsx',
  'pages/WorkspaceEventsCard.tsx',
  'pages/WorkspaceInvitesCard.tsx',
  'pages/DashboardPage.tsx',
  'pages/workspaces/WorkspacesTable.tsx',
];

/** Brand colours that are data, not theme: the login splash gradient and the logo mark. */
const ALLOW: Record<string, string[]> = {
  'pages/LoginPage.tsx': ['#eaf0dc', '#eab308'],
  'layouts/AdminLayout.tsx': [
    '#3984FF',
    '#FF3F3F',
    '#6AC9D0',
    '#C6229B',
    '#EA0E78',
    '#FE3452',
    '#FE7340',
    '#FFC32E',
  ],
};

describe('admin files migrated in Phase 2a carry no hex colour literals', () => {
  it.each(FILES)('%s', (file) => {
    const source = readFileSync(path.join(SRC, file), 'utf8');
    const found = source.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const allowed = new Set(ALLOW[file] ?? []);
    expect(found.filter((hex) => !allowed.has(hex))).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/__tests__/no-hex-literals.test.ts`
Expected: PASS em todos os 10 arquivos (Tasks 5 e 6 já removeram os hex; os demais arquivos não têm hoje).

- [ ] **Step 3: Provar que o teste morde**

Inserir temporariamente `// #123456` no fim de `apps/admin/src/pages/AdminsPage.tsx`, rodar de novo e ver FAIL com `["#123456"]`. Remover a linha (`git checkout apps/admin/src/pages/AdminsPage.tsx`).

- [ ] **Step 4: Commit**

```bash
npx prettier --write apps/admin/src/__tests__/no-hex-literals.test.ts
git add apps/admin/src/__tests__/no-hex-literals.test.ts
git commit -m "test(admin): guarda contra literais hex nos arquivos migrados"
```

---

### Task 8: `AdminsPage` em primitivos

**Files:**

- Rewrite: `apps/admin/src/pages/AdminsPage.tsx`
- Create: `apps/admin/src/pages/__tests__/AdminsPage.test.tsx`

- [ ] **Step 1: Teste que falha**

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listAdmins: vi.fn(),
  inviteAdmin: vi.fn(),
  removeAdmin: vi.fn(),
}));
vi.mock('../../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ user: { id: 'me' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { inviteAdmin, listAdmins, removeAdmin } from '../../lib/api';
import AdminsPage from '../AdminsPage';

const admins = [
  {
    id: 'a1',
    user_id: 'me',
    email: 'eu@mesaas.com.br',
    invited_by: null,
    invited_by_email: null,
    created_at: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'a2',
    user_id: 'u2',
    email: 'outra@mesaas.com.br',
    invited_by: 'me',
    invited_by_email: 'eu@mesaas.com.br',
    created_at: '2026-02-10T00:00:00.000Z',
  },
];

beforeEach(() => {
  vi.mocked(listAdmins).mockResolvedValue({ admins } as never);
  vi.mocked(inviteAdmin).mockResolvedValue({ admin: admins[1] } as never);
  vi.mocked(removeAdmin).mockResolvedValue({ ok: true } as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminsPage />
    </QueryClientProvider>,
  );
}

describe('AdminsPage', () => {
  it('lists admins in a table and hides the remove button for the current user', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    expect(table.getByText('eu@mesaas.com.br')).toBeInTheDocument();
    expect(table.getByText('outra@mesaas.com.br')).toBeInTheDocument();
    expect(table.getAllByRole('button', { name: 'Remover admin' })).toHaveLength(1);
  });

  it('removing calls the API with the admin id', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    fireEvent.click(table.getByRole('button', { name: 'Remover admin' }));
    await waitFor(() => expect(removeAdmin).toHaveBeenCalledWith('a2'));
  });

  it('inviting submits the typed e-mail', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('E-mail do novo admin'), {
      target: { value: 'nova@mesaas.com.br' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Convidar admin' }));
    await waitFor(() => expect(inviteAdmin).toHaveBeenCalledWith('nova@mesaas.com.br'));
  });

  it('shows an empty state when there are no admins', async () => {
    vi.mocked(listAdmins).mockResolvedValue({ admins: [] } as never);
    renderPage();
    expect(await screen.findByText('Nenhum admin cadastrado')).toBeInTheDocument();
  });

  it('shows an error state with retry when the query fails', async () => {
    vi.mocked(listAdmins).mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/admin/src/pages/__tests__/AdminsPage.test.tsx`
Expected: FAIL (nenhum `table`).

- [ ] **Step 3: Reescrever a página**

Manter as linhas 1-42 (imports, hooks, mutations, `handleInvite`) trocando o import de ícones para `import { UserPlus, Trash2, Users } from 'lucide-react';`, acrescentando `isError, refetch` ao destructuring da query e os imports:

```tsx
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
```

`const { data, isLoading, isError, refetch } = useQuery({ … })`.

Substituir o `return (…)` por:

```tsx
const admins = data?.admins ?? [];
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

return (
  <div>
    <PageHeader title="Admins" description="Administradores da plataforma" />

    <form onSubmit={handleInvite} className="mb-8 flex flex-col gap-3 sm:flex-row">
      <Input
        type="email"
        aria-label="E-mail do novo admin"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="E-mail do novo admin…"
        required
        className="flex-1"
      />
      <Button type="submit" disabled={inviteMutation.isPending}>
        <UserPlus />
        Convidar admin
      </Button>
    </form>

    <Card>
      {isLoading ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-60" />
        </div>
      ) : isError ? (
        <ErrorState message="Não foi possível carregar os admins." onRetry={() => refetch()} />
      ) : admins.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum admin cadastrado" />
      ) : (
        <>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead className="text-[0.7rem] uppercase tracking-wider">E-mail</TableHead>
                <TableHead className="text-[0.7rem] uppercase tracking-wider">
                  Convidado por
                </TableHead>
                <TableHead className="text-[0.7rem] uppercase tracking-wider">
                  Adicionado em
                </TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((admin) => {
                const isSelf = admin.user_id === user?.id;
                return (
                  <TableRow key={admin.id}>
                    <TableCell className="text-sm text-foreground">{admin.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {admin.invited_by_email || '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(admin.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!isSelf && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remover admin"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => removeMutation.mutate(admin.id)}
                          disabled={removeMutation.isPending}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <ul className="flex flex-col md:hidden">
            {admins.map((admin) => {
              const isSelf = admin.user_id === user?.id;
              return (
                <li
                  key={admin.id}
                  className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-3 last:border-0"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm text-foreground">{admin.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {admin.invited_by_email ? `Por ${admin.invited_by_email}` : '—'} ·{' '}
                      {formatDate(admin.created_at)}
                    </span>
                  </div>
                  {!isSelf && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover admin"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMutation.mutate(admin.id)}
                      disabled={removeMutation.isPending}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  </div>
);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/pages/__tests__/AdminsPage.test.tsx apps/admin/src/__tests__/no-hex-literals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/admin/src/pages/AdminsPage.tsx apps/admin/src/pages/__tests__/AdminsPage.test.tsx
npx tsc -p apps/admin/tsconfig.json --noEmit
git add apps/admin/src/pages/AdminsPage.tsx apps/admin/src/pages/__tests__/AdminsPage.test.tsx
git commit -m "feat(admin): página Admins em primitivos"
```

---

### Task 9: `IntegrationsPage` em primitivos

**Files:**

- Rewrite: `apps/admin/src/pages/IntegrationsPage.tsx`
- Modify: `apps/admin/src/pages/__tests__/IntegrationsPage.test.tsx`

- [ ] **Step 1: Atualizar os testes primeiro**

Em `IntegrationsPage.test.tsx`:

1. Acrescentar `within` ao import de `@testing-library/react`.
2. Teste `'lista uma conexão ativa e uma revogada'`: trocar as duas asserções de `getByText('Ativa')`/`getByText('Revogada')` por

```tsx
const table = within(screen.getByRole('table'));
expect(table.getByText('Ativa')).toBeInTheDocument();
expect(table.getByText('Revogada')).toBeInTheDocument();
```

3. Teste `'mostra estado vazio quando não há conexões'`: `'Nenhuma conexão ainda.'` → `'Nenhuma conexão autorizada'`.
4. Nos três testes que usam `getAllByRole('button', { name: /Revogar/ })` / `getByRole('button', { name: /Revogar/ })`, escopar com `within(screen.getByRole('table'))` (a tabela e o cartão mobile renderizam os dois em jsdom):

```tsx
const table = within(screen.getByRole('table'));
const revokeButtons = table.getAllByRole('button', { name: /Revogar/ });
```

e `fireEvent.click(table.getByRole('button', { name: /Revogar/ }));`.

5. Teste de erro: trocar `screen.queryByText('Nenhuma conexão ainda.')` por `screen.queryByText('Nenhuma conexão autorizada')`. O texto `'Não foi possível carregar as conexões.'` e o botão `'Tentar novamente'` continuam (vêm do `ErrorState`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/admin/src/pages/__tests__/IntegrationsPage.test.tsx`
Expected: FAIL (sem `table`, sem "Nenhuma conexão autorizada").

- [ ] **Step 3: Reescrever a página**

Manter as linhas 1-46 (imports de API, `CONNECTOR_URL`, `truncateClientId`, hooks, handlers). Trocar o import de ícones para `import { Copy, Plug, Trash2 } from 'lucide-react';` e acrescentar:

```tsx
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
```

Substituir o `return (…)` por:

```tsx
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

return (
  <div>
    <PageHeader
      title="Integrações"
      description="Conector MCP do Admin da plataforma e conexões OAuth autorizadas."
    />

    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conector MCP do Admin</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Use esta URL para conectar um agente (claude.ai, Claude Code, Codex) ao Admin da
            plataforma via MCP.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="text"
              readOnly
              aria-label="URL do conector MCP"
              value={CONNECTOR_URL}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 font-mono"
            />
            <Button variant="outline" onClick={handleCopy} aria-label="Copiar URL">
              <Copy />
              Copiar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Campos de OAuth ficam em branco. Na tela de autorização, escolha Administração da
            plataforma.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como conectar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <h3 className="mb-1 text-sm font-semibold">claude.ai</h3>
            <p className="text-sm text-muted-foreground">
              Configurações › Conectores › Adicionar conector personalizado › cole a URL acima.
            </p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Claude Code</h3>
            <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
              {`claude mcp add --transport http mesaas-admin ${CONNECTOR_URL}`}
            </pre>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Codex</h3>
            <p className="mb-1 text-sm text-muted-foreground">
              Adicione o bloco abaixo em <code className="font-mono">~/.codex/config.toml</code>:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
              {`[mcp_servers.mesaas_admin]\nurl = "${CONNECTOR_URL}"`}
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permissões</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Escopos disponíveis para uma conexão MCP do Admin. Quem autoriza escolhe quais conceder
            na tela de consentimento.
          </p>
          <ul className="flex flex-col gap-2">
            {ADMIN_SCOPES.map((scope) => (
              <li key={scope.value} className="flex items-center gap-2 text-sm">
                <Badge variant="neutral" size="sm" className="font-mono normal-case">
                  {scope.value}
                </Badge>
                <span className="text-foreground">{scope.label}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conexões autorizadas</CardTitle>
        </CardHeader>
        {isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-60" />
          </div>
        ) : isError ? (
          <ErrorState message="Não foi possível carregar as conexões." onRetry={() => refetch()} />
        ) : grants.length === 0 ? (
          <EmptyState icon={Plug} title="Nenhuma conexão autorizada" />
        ) : (
          <>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[0.7rem] uppercase tracking-wider">E-mail</TableHead>
                  <TableHead className="text-[0.7rem] uppercase tracking-wider">Cliente</TableHead>
                  <TableHead className="text-[0.7rem] uppercase tracking-wider">Escopos</TableHead>
                  <TableHead className="text-[0.7rem] uppercase tracking-wider">
                    Criado em
                  </TableHead>
                  <TableHead className="text-[0.7rem] uppercase tracking-wider">Status</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.map((grant) => {
                  const isActive = !grant.revoked_at;
                  return (
                    <TableRow key={grant.id}>
                      <TableCell className="text-sm text-foreground">
                        {grant.email ?? '—'}
                      </TableCell>
                      <TableCell
                        className="font-mono text-xs text-muted-foreground"
                        title={grant.client_id}
                      >
                        {truncateClientId(grant.client_id)}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          {grant.scopes.map((scope) => (
                            <Badge
                              key={scope}
                              variant="neutral"
                              size="sm"
                              className="font-mono normal-case"
                            >
                              {scope}
                            </Badge>
                          ))}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(grant.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isActive ? 'success' : 'neutral'}>
                          {isActive ? 'Ativa' : 'Revogada'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => handleRevoke(grant)}
                            disabled={revokeMutation.isPending}
                          >
                            <Trash2 />
                            Revogar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <ul className="flex flex-col md:hidden">
              {grants.map((grant) => {
                const isActive = !grant.revoked_at;
                return (
                  <li
                    key={grant.id}
                    className="flex flex-col gap-1.5 border-b border-border/50 px-5 py-3 last:border-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-foreground">{grant.email ?? '—'}</span>
                      <Badge variant={isActive ? 'success' : 'neutral'}>
                        {isActive ? 'Ativa' : 'Revogada'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-mono" title={grant.client_id}>
                        {truncateClientId(grant.client_id)}
                      </span>
                      <span>{formatDate(grant.created_at)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {grant.scopes.map((scope) => (
                        <Badge
                          key={scope}
                          variant="neutral"
                          size="sm"
                          className="font-mono normal-case"
                        >
                          {scope}
                        </Badge>
                      ))}
                    </div>
                    {isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-fit text-muted-foreground hover:text-destructive"
                        onClick={() => handleRevoke(grant)}
                        disabled={revokeMutation.isPending}
                      >
                        <Trash2 />
                        Revogar
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  </div>
);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/pages/__tests__/IntegrationsPage.test.tsx`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/admin/src/pages/IntegrationsPage.tsx apps/admin/src/pages/__tests__/IntegrationsPage.test.tsx
npx tsc -p apps/admin/tsconfig.json --noEmit
git add apps/admin/src/pages/IntegrationsPage.tsx apps/admin/src/pages/__tests__/IntegrationsPage.test.tsx
git commit -m "feat(admin): página Integrações em primitivos"
```

---

### Task 10: `KbArticlesPage` em primitivos

**Files:**

- Rewrite: `apps/admin/src/pages/KbArticlesPage.tsx`
- Create: `apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx`

**Interfaces:**

- Consumes: `RowLink`, `kbArticleEditPath`, `kbArticleNewPath` (Task 2).

- [ ] **Step 1: Teste que falha**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({ listKbArticles: vi.fn() }));

import { listKbArticles } from '../../lib/api';
import KbArticlesPage from '../KbArticlesPage';

const articles = [
  {
    id: 'k1',
    title: 'Primeiro post',
    slug: 'primeiro-post',
    excerpt: null,
    content: null,
    content_plain: '',
    cover_image_url: null,
    category: 'getting-started',
    tags: [],
    status: 'published',
    display_order: 1,
    author_id: null,
  },
  {
    id: 'k2',
    title: 'Rascunho secreto',
    slug: 'rascunho',
    excerpt: null,
    content: null,
    content_plain: '',
    cover_image_url: null,
    category: 'getting-started',
    tags: [],
    status: 'draft',
    display_order: 2,
    author_id: null,
  },
];

beforeEach(() => {
  vi.mocked(listKbArticles).mockResolvedValue({ articles } as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <KbArticlesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbArticlesPage', () => {
  it('renders each title as a link to the editor', async () => {
    renderPage();
    const links = await screen.findAllByRole('link', { name: 'Primeiro post' });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', '/admin/kb-articles/k1/edit');
  });

  it('"Novo artigo" links to the new-article route', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /Novo artigo/ })).toHaveAttribute(
      'href',
      '/admin/kb-articles/new',
    );
  });

  it('shows status badges', async () => {
    renderPage();
    expect((await screen.findAllByText('Publicado')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rascunho').length).toBeGreaterThan(0);
  });

  it('search filters client-side and offers to clear filters when nothing matches', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro post' });
    fireEvent.change(screen.getByPlaceholderText('Buscar artigos…'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('Nenhum artigo encontrado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getAllByRole('link', { name: 'Primeiro post' }).length).toBeGreaterThan(0);
  });

  it('shows an empty state without the clear action when the list is empty', async () => {
    vi.mocked(listKbArticles).mockResolvedValue({ articles: [] } as never);
    renderPage();
    expect(await screen.findByText('Nenhum artigo encontrado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
  });
});
```

Se o rótulo em `KB_CATEGORIES['getting-started']` não existir, troque a categoria dos fixtures pela primeira chave de `apps/admin/src/lib/kb-categories.ts`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx`
Expected: FAIL (nenhum `link`).

- [ ] **Step 3: Reescrever a página**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Pencil, Plus, Search } from 'lucide-react';
import { listKbArticles } from '../lib/api';
import {
  KB_CATEGORIES as CATEGORIES,
  ALL_KB_CATEGORIES as ALL_CATEGORIES,
} from '../lib/kb-categories';
import { kbArticleEditPath, kbArticleNewPath } from '../lib/routes';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { RowLink } from '../components/RowLink';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

const STATUSES = ['draft', 'published'] as const;
const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
};

/** Radix Select rejects '' as an item value; this sentinel stands for "no filter". */
const ALL = '__all__';

function statusBadge(status: string): { label: string; variant: 'success' | 'neutral' } {
  if (status === 'published') return { label: 'Publicado', variant: 'success' };
  return { label: 'Rascunho', variant: 'neutral' };
}

export default function KbArticlesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'kb-articles', statusFilter, categoryFilter],
    queryFn: () =>
      listKbArticles({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(categoryFilter ? { category: categoryFilter } : {}),
      }),
  });

  const articles = (data?.articles || []).filter(
    (a) => !search || a.title.toLowerCase().includes(search.toLowerCase()),
  );
  const hasFilters = search !== '' || statusFilter !== '' || categoryFilter !== '';
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCategoryFilter('');
  };

  return (
    <div>
      <PageHeader
        title="Base de conhecimento"
        description="Gerencie os artigos de ajuda do CRM"
        actions={
          <Button asChild>
            <Link to={kbArticleNewPath()}>
              <Plus />
              Novo artigo
            </Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder="Buscar artigos…"
            aria-label="Buscar artigos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={categoryFilter === '' ? ALL : categoryFilter}
          onValueChange={(v) => setCategoryFilter(v === ALL ? '' : v)}
        >
          <SelectTrigger aria-label="Categoria" className="w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {ALL_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORIES[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter === '' ? ALL : statusFilter}
          onValueChange={(v) => setStatusFilter(v === ALL ? '' : v)}
        >
          <SelectTrigger aria-label="Status" className="w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="p-5">
        <div className="hidden border-b border-border pb-3 text-[0.7rem] uppercase tracking-wider text-muted-foreground md:grid md:grid-cols-[2fr_1fr_0.7fr_0.7fr_0.5fr] md:gap-2">
          <span>Título</span>
          <span>Categoria</span>
          <span>Status</span>
          <span>Ordem</span>
          <span></span>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-60" />
          </div>
        ) : isError ? (
          <ErrorState message="Não foi possível carregar os artigos." onRetry={() => refetch()} />
        ) : articles.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Nenhum artigo encontrado"
            description={hasFilters ? 'Nenhum artigo bate com os filtros atuais.' : undefined}
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          articles.map((a) => {
            const badge = statusBadge(a.status);
            const catLabel = CATEGORIES[a.category] ?? a.category;
            const to = kbArticleEditPath(a.id);
            return (
              <div
                key={a.id}
                onClick={() => navigate(to)}
                className={cn(
                  '-mx-5 cursor-pointer border-b border-border/50 px-5 py-3 transition-colors hover:bg-secondary/30',
                  a.status === 'draft' && 'opacity-50',
                )}
              >
                {/* The whole row is a mouse target; the title link below is the keyboard/AT target. */}
                <div className="flex flex-col gap-1.5 md:hidden">
                  <RowLink to={to} className="truncate text-sm">
                    {a.title}
                  </RowLink>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{catLabel}</span>
                    <Badge variant={badge.variant} size="sm">
                      {badge.label}
                    </Badge>
                  </div>
                </div>
                <div className="hidden items-center gap-2 md:grid md:grid-cols-[2fr_1fr_0.7fr_0.7fr_0.5fr]">
                  <div className="min-w-0">
                    <RowLink to={to} className="block truncate text-sm">
                      {a.title}
                    </RowLink>
                    <div className="mt-0.5 text-xs text-muted-foreground">/{a.slug}</div>
                  </div>
                  <span className="text-sm text-muted-foreground">{catLabel}</span>
                  <Badge variant={badge.variant} size="sm" className="w-fit">
                    {badge.label}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{a.display_order}</span>
                  <span className="text-muted-foreground hover:text-primary">
                    <Pencil size={14} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
```

A linha inteira continua sendo uma `div` com `onClick={() => navigate(to)}` para o mouse (mesmo padrão de Banners e Dashboard); o `RowLink` no título é o único alvo de teclado e leitor de tela. Nunca use `aria-hidden` no contêiner da linha: esconderia o link interno da árvore de acessibilidade.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/admin/src/pages/KbArticlesPage.tsx apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx
npx tsc -p apps/admin/tsconfig.json --noEmit
git add apps/admin/src/pages/KbArticlesPage.tsx apps/admin/src/pages/__tests__/KbArticlesPage.test.tsx
git commit -m "feat(admin): lista da base de conhecimento em primitivos com títulos como links"
```

---

### Task 11: `WorkspaceDetailPage` em primitivos, remover `toneBadgeClass`

**Files:**

- Modify: `apps/admin/src/pages/WorkspaceDetailPage.tsx` (JSX a partir da linha 185; hooks 1-184 ficam)
- Modify: `apps/admin/src/lib/subscription.ts:143-155`
- Modify: `apps/admin/src/lib/__tests__/subscription.test.ts` (remover import e bloco `describe('toneBadgeClass')`)

**Interfaces:**

- Consumes: `Textarea`, `Switch`, `STATUS_BADGE_VARIANT` (Task 1).

- [ ] **Step 1: Remover `toneBadgeClass` e o teste**

Em `lib/subscription.ts` apagar as linhas 143-155 (os dois comentários `/** Kept for … */`, `/** Tailwind classes … */` e a função). Em `lib/__tests__/subscription.test.ts` remover `toneBadgeClass` do import e o bloco `describe('toneBadgeClass', …)` (linhas 67-73).

Run: `npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: FAIL só em `WorkspaceDetailPage.tsx` ("has no exported member 'toneBadgeClass'"). Isso é o vermelho desta task.

- [ ] **Step 2: Imports da página**

Trocar o bloco de import de `'../lib/subscription'` por:

```tsx
import {
  statusMeta,
  STATUS_BADGE_VARIANT,
  hasSubscription,
  intervalLabel,
  intervalSuffix,
  formatMoney,
} from '../lib/subscription';
```

Acrescentar:

```tsx
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { Textarea } from '../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { cn } from '../lib/utils';
```

Logo antes de `export default function WorkspaceDetailPage()`:

```tsx
/** Radix Select rejects '' as an item value; this sentinel stands for "Sem plano". */
const NO_PLAN = '__none__';
const HEAD_CLASS = 'text-[0.7rem] uppercase tracking-wider';
```

Na query principal, destruturar `isError` e `refetch`: `const { data, isLoading, isError, refetch } = useQuery({ … })`.

- [ ] **Step 3: Estado de carregamento e erro**

Substituir

```tsx
if (isLoading || !data) {
  return <p className="text-dim-foreground">Carregando…</p>;
}
```

por

```tsx
if (isError) {
  return <ErrorState message="Não foi possível carregar o workspace." onRetry={() => refetch()} />;
}
if (isLoading || !data) {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
```

- [ ] **Step 4: Cabeçalho, voltar e plano**

Substituir do `<button onClick={() => navigate('/admin/workspaces')}` até o fim do bloco `<div className="flex flex-col items-stretch gap-1 sm:items-end">…</div>` (fecha em `</div>` antes do comentário `Provider subscription`) por:

```tsx
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('/admin/workspaces')}
        className="mb-4 -ml-2 text-muted-foreground"
      >
        <ArrowLeft />
        Voltar
      </Button>

      <div className="flex min-w-0 flex-col gap-4 mb-8 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="w-12 h-12 bg-secondary rounded-xl flex items-center justify-center text-lg font-bold text-foreground shrink-0">
            {data.workspace.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="font-sf text-xl font-bold break-words">{data.workspace.name}</h1>
            <p className="text-sm text-muted-foreground truncate">
              Dono: {data.owner?.email || '—'}
              {data.owner?.telefone ? ` · ${data.owner.telefone}` : ''} · Criado em{' '}
              {new Date(data.workspace.created_at).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Select
            value={selectedPlanId === '' ? NO_PLAN : selectedPlanId}
            onValueChange={(v) => {
              const planId = v === NO_PLAN ? '' : v;
              setSelectedPlanId(planId);
              setPlanMutation.mutate(planId);
            }}
          >
            <SelectTrigger aria-label="Plano do workspace" className="w-full sm:w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PLAN}>Sem plano</SelectItem>
              {plansData?.plans?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data?.workspace.plan_source === 'manual' && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => unsetMutation.mutate()}
              disabled={unsetMutation.isPending}
              className="h-auto px-0 text-muted-foreground"
            >
              Remover comp (voltar à cobrança)
            </Button>
          )}
        </div>
      </div>
```

- [ ] **Step 5: Cartão da assinatura**

Substituir o `<div className="min-w-0 bg-card border border-border rounded-2xl p-5 mb-6">` da assinatura (até seu `</div>` de fechamento, antes de `<div className="grid min-w-0 max-w-full grid-cols-1 gap-6 mb-6 md:grid-cols-2">`) por:

```tsx
<Card className="mb-6 min-w-0">
  <CardHeader>
    <CardTitle>
      {data.subscription?.provider === 'pagarme' ? 'Assinatura Pagar.me' : 'Assinatura Stripe'}
    </CardTitle>
    {data.subscription?.stripe_dashboard_url && (
      <a
        href={sanitizeExternalUrl(data.subscription.stripe_dashboard_url)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
      >
        Abrir no Stripe <ExternalLink size={14} />
      </a>
    )}
  </CardHeader>
  <CardContent>
    {hasSubscription(data.subscription) ? (
      <>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Field label="Status">
            <Badge variant={STATUS_BADGE_VARIANT[statusMeta(data.subscription.status).tone]}>
              {statusMeta(data.subscription.status).label}
            </Badge>
          </Field>
          {/* …os Fields "Plano", "Valor", "Cancela em / Renova em" e "Pagamentos falhos" idênticos aos de hoje… */}
        </div>
        {data.workspace.plan_source === 'manual' && (
          <p className="mt-4 text-xs text-muted-foreground">
            O plano efetivo foi ajustado manualmente (comp). Os dados acima refletem a assinatura
            real do cliente no Stripe.
          </p>
        )}
      </>
    ) : (
      <p className="text-sm text-muted-foreground">Sem assinatura Stripe.</p>
    )}
  </CardContent>
</Card>
```

O comentário `{/* …os Fields… */}` é instrução: copiar os quatro `<Field>` restantes (linhas 285-333 de hoje) sem alteração.

- [ ] **Step 6: Limites e funcionalidades**

Substituir o `<div className="grid min-w-0 max-w-full grid-cols-1 gap-6 mb-6 md:grid-cols-2">…</div>` inteiro por:

```tsx
<div className="mb-6 grid min-w-0 max-w-full grid-cols-1 gap-6 md:grid-cols-2">
  <Card className="min-w-0">
    <CardHeader>
      <CardTitle>Limites de recursos</CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-2">
      {RESOURCE_LIMIT_KEYS.map((key) => (
        <LimitRow
          key={key}
          label={RESOURCE_LIMIT_LABELS[key]}
          fieldKey={key}
          value={resourceEdits[key] ?? ''}
          planValue={plan ? (plan[key] as number | null) : null}
          isOverridden={isOverridden(key, 'resource')}
          onChange={(val) => setResourceEdits((prev) => ({ ...prev, [key]: val }))}
        />
      ))}
      <h3 className="mt-3 text-sm font-semibold text-muted-foreground">Limites de taxa</h3>
      {RATE_LIMIT_KEYS.map((key) => (
        <LimitRow
          key={key}
          label={RATE_LIMIT_LABELS[key]}
          fieldKey={key}
          value={resourceEdits[key] ?? ''}
          planValue={plan ? (plan[key] as number | null) : null}
          isOverridden={isOverridden(key, 'resource')}
          onChange={(val) => setResourceEdits((prev) => ({ ...prev, [key]: val }))}
        />
      ))}
    </CardContent>
  </Card>

  <Card className="min-w-0 overflow-hidden">
    <CardHeader>
      <CardTitle>Funcionalidades</CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {FEATURE_FLAG_KEYS.map((key) => {
        const id = `feature-${key}`;
        return (
          <div key={key} className="flex items-center justify-between gap-2 overflow-hidden">
            <Label htmlFor={id} className="truncate text-sm font-normal text-muted-foreground">
              {FEATURE_FLAG_LABELS[key]}
            </Label>
            <div className="flex shrink-0 items-center gap-2">
              {isOverridden(key, 'feature') && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                  title={`override (plano: ${plan?.[key] ? 'ATIVO' : 'INATIVO'})`}
                />
              )}
              <Switch
                id={id}
                checked={!!featureEdits[key]}
                onCheckedChange={(checked) =>
                  setFeatureEdits((prev) => ({ ...prev, [key]: checked }))
                }
              />
            </div>
          </div>
        );
      })}
    </CardContent>
  </Card>
</div>
```

- [ ] **Step 7: Chaves de API e conexões OAuth do MCP**

Substituir os dois blocos `<div className="min-w-0 bg-card border border-border rounded-2xl p-5 mb-6">` (MCP API Keys e MCP OAuth Connections) por:

```tsx
      <Card className="mb-6 min-w-0">
        <CardHeader>
          <CardTitle>Chaves de API do MCP</CardTitle>
          {mcpKeys?.some((k) => !k.revoked_at) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => revokeAllMcpKeysMutation.mutate()}
              disabled={revokeAllMcpKeysMutation.isPending}
            >
              Revogar todas
            </Button>
          )}
        </CardHeader>
        {!mcpKeys || mcpKeys.length === 0 ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">Nenhuma chave.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD_CLASS}>Nome</TableHead>
                <TableHead className={HEAD_CLASS}>Escopos</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'w-28 text-right')}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mcpKeys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="text-sm">
                    <span className="font-medium">{k.name}</span>
                    <span className="text-muted-foreground"> …{k.token_suffix}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{k.scopes.join(', ')}</TableCell>
                  <TableCell className="text-right">
                    {k.revoked_at ? (
                      <Badge variant="neutral">revogada</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => revokeMcpKeyMutation.mutate(k.id)}
                        disabled={revokeMcpKeyMutation.isPending}
                      >
                        Revogar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="mb-6 min-w-0">
        <CardHeader>
          <CardTitle>Conexões OAuth do MCP</CardTitle>
          {oauthGrants?.some((g) => !g.revoked_at) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => revokeAllOAuthGrantsMutation.mutate()}
              disabled={revokeAllOAuthGrantsMutation.isPending}
            >
              Revogar todas
            </Button>
          )}
        </CardHeader>
        {!oauthGrants || oauthGrants.length === 0 ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">Nenhuma conexão.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD_CLASS}>Conectado por</TableHead>
                <TableHead className={HEAD_CLASS}>Escopos</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'w-28 text-right')}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {oauthGrants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="text-sm font-medium">{g.connected_by ?? 'Claude'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{g.scopes.join(', ')}</TableCell>
                  <TableCell className="text-right">
                    {g.revoked_at ? (
                      <Badge variant="neutral">revogada</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => revokeOAuthGrantMutation.mutate(g.id)}
                        disabled={revokeOAuthGrantMutation.isPending}
                      >
                        Revogar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
```

- [ ] **Step 8: Notas, botões de salvar e membros**

Substituir o bloco de Notas, o bloco dos dois botões e o cartão de Membros (até `<WorkspaceInvitesCard …/>`) por:

```tsx
      <Card className="mb-6 min-w-0">
        <CardHeader>
          <CardTitle>Notas</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas do admin…"
            aria-label="Notas do admin"
            rows={2}
            className="min-h-0 resize-none"
          />
        </CardContent>
      </Card>

      <div className="mb-8 flex min-w-0 flex-col gap-3 sm:flex-row">
        <Button
          onClick={() => saveOverridesMutation.mutate()}
          disabled={saveOverridesMutation.isPending}
          className="w-full sm:w-auto"
        >
          {saveOverridesMutation.isPending ? 'Salvando…' : 'Salvar overrides'}
        </Button>
        <Button
          variant="outline"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          className="w-full sm:w-auto"
        >
          Restaurar padrões do plano
        </Button>
      </div>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Membros ({data.members.length})</CardTitle>
        </CardHeader>
        <Table className="hidden md:table">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD_CLASS}>Nome</TableHead>
              <TableHead className={HEAD_CLASS}>E-mail</TableHead>
              <TableHead className={HEAD_CLASS}>Telefone</TableHead>
              <TableHead className={HEAD_CLASS}>Papel</TableHead>
              <TableHead className={HEAD_CLASS}>Entrou em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((m) => (
              <TableRow key={m.user_id}>
                <TableCell className="text-sm">{m.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m.telefone ? (
                    <span className="inline-flex items-center gap-1.5">
                      {m.telefone}
                      {m.marketing_opt_in && (
                        <Badge variant="success" size="sm" title="Aceitou contato de marketing">
                          MKT
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-dim-foreground">—</span>
                  )}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-sm',
                    m.role === 'owner' ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {m.role}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(m.joined_at).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ul className="flex flex-col md:hidden">
          {data.members.map((m) => (
            <li
              key={m.user_id}
              className="flex min-w-0 items-center justify-between gap-3 border-b border-border/50 px-5 py-3 last:border-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm">{m.name}</span>
                <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                {m.telefone && (
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {m.telefone}
                    {m.marketing_opt_in && (
                      <Badge variant="success" size="sm">
                        MKT
                      </Badge>
                    )}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'shrink-0 text-xs font-medium',
                  m.role === 'owner' ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      </Card>
```

- [ ] **Step 9: `LimitRow` com `Input` e `Label`**

Substituir a função `LimitRow` por:

```tsx
function LimitRow({
  label,
  fieldKey,
  value,
  planValue,
  isOverridden,
  onChange,
}: {
  label: string;
  fieldKey: string;
  value: string;
  planValue: number | null;
  isOverridden: boolean;
  onChange: (val: string) => void;
}) {
  const id = `limit-${fieldKey}`;
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <Label htmlFor={id} className="truncate text-sm font-normal text-muted-foreground">
        {label}
      </Label>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          id={id}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-8 w-20 text-right font-sf text-sm',
            isOverridden && 'border-primary/40 text-primary',
          )}
        />
        {isOverridden ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
            title={`plano: ${planValue ?? '—'}`}
          />
        ) : (
          <span className="hidden whitespace-nowrap text-[0.7rem] text-dim-foreground sm:inline">
            plano: {planValue ?? '—'}
          </span>
        )}
      </div>
    </div>
  );
}
```

`Field` fica como está.

- [ ] **Step 10: Verificar**

Run: `npx prettier --write apps/admin/src/pages/WorkspaceDetailPage.tsx apps/admin/src/lib && npx tsc -p apps/admin/tsconfig.json --noEmit && npx vitest run apps/admin`
Expected: tsc limpo (o único uso de `toneBadgeClass` sumiu); vitest verde, incluindo `no-hex-literals`.

Run: `grep -rn "toneBadgeClass" apps/admin/src`
Expected: nenhuma ocorrência.

- [ ] **Step 11: Commit**

```bash
git add apps/admin/src/pages/WorkspaceDetailPage.tsx apps/admin/src/lib/subscription.ts apps/admin/src/lib/__tests__/subscription.test.ts
git commit -m "feat(admin): detalhe do workspace em primitivos; remove toneBadgeClass"
```

---

### Task 12: `WorkspaceEventsCard` em primitivos

**Files:**

- Modify: `apps/admin/src/pages/WorkspaceEventsCard.tsx` (JSX a partir da linha 76)

- [ ] **Step 1: Imports**

Acrescentar:

```tsx
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
```

Antes de `export default function WorkspaceEventsCard`:

```tsx
/** Radix Select rejects '' as an item value; this sentinel stands for "Todos os eventos". */
const ALL = '__all__';
const HEAD_CLASS = 'text-[0.7rem] uppercase tracking-wider';
```

- [ ] **Step 2: Reescrever o `return`**

```tsx
return (
  <Card className="mt-6 min-w-0">
    <CardHeader>
      <CardTitle>Histórico de eventos ({total})</CardTitle>
      <Select
        value={filterType === '' ? ALL : filterType}
        onValueChange={(v) => {
          setFilterType(v === ALL ? '' : v);
          setPage(0);
        }}
      >
        <SelectTrigger aria-label="Tipo de evento" className="h-8 w-auto gap-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos os eventos</SelectItem>
          {FILTERABLE_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </CardHeader>

    {isLoading ? (
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-60" />
      </CardContent>
    ) : events.length === 0 ? (
      <EmptyState icon={Activity} title="Nenhum evento encontrado" />
    ) : (
      <>
        <Table className="hidden md:table">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD_CLASS}>Quando</TableHead>
              <TableHead className={HEAD_CLASS}>Evento</TableHead>
              <TableHead className={HEAD_CLASS}>Autor</TableHead>
              <TableHead className={HEAD_CLASS}>Detalhes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((evt) => {
              const meta = eventMeta(evt.action);
              const Icon = ICON_MAP[meta.icon] ?? Activity;
              const desc = eventDescription(evt);
              const timeAgo = formatDistanceToNow(new Date(evt.created_at), {
                addSuffix: true,
                locale: ptBR,
              });
              return (
                <TableRow key={evt.id}>
                  <TableCell
                    className="text-sm text-muted-foreground"
                    title={new Date(evt.created_at).toLocaleString('pt-BR')}
                  >
                    {timeAgo}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon size={14} className="shrink-0 text-muted-foreground" />
                      <span className="truncate">{meta.label}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {evt.actor_name ?? evt.actor_email ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-dim-foreground">{desc || '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <ul className="flex flex-col md:hidden">
          {events.map((evt) => {
            const meta = eventMeta(evt.action);
            const Icon = ICON_MAP[meta.icon] ?? Activity;
            const desc = eventDescription(evt);
            const timeAgo = formatDistanceToNow(new Date(evt.created_at), {
              addSuffix: true,
              locale: ptBR,
            });
            return (
              <li
                key={evt.id}
                className="flex items-start gap-3 border-b border-border/50 px-5 py-2.5 last:border-0"
              >
                <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{meta.label}</span>
                    <span className="shrink-0 text-[0.7rem] text-muted-foreground">{timeAgo}</span>
                  </div>
                  {(evt.actor_name || evt.actor_email) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {evt.actor_name ?? evt.actor_email}
                    </p>
                  )}
                  {desc && <p className="truncate text-xs text-dim-foreground">{desc}</p>}
                </div>
              </li>
            );
          })}
        </ul>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft />
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">
              {page + 1} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Próximo
              <ChevronRight />
            </Button>
          </div>
        )}
      </>
    )}
  </Card>
);
```

Para não repetir o cálculo de `meta`/`Icon`/`desc`/`timeAgo` nos dois layouts, extrair antes do `return`:

```tsx
const rows = events.map((evt) => ({
  evt,
  meta: eventMeta(evt.action),
  desc: eventDescription(evt),
  timeAgo: formatDistanceToNow(new Date(evt.created_at), { addSuffix: true, locale: ptBR }),
}));
```

e iterar `rows.map(({ evt, meta, desc, timeAgo }) => { const Icon = ICON_MAP[meta.icon] ?? Activity; … })` nos dois lugares.

- [ ] **Step 3: Verificar e commitar**

Run: `npx prettier --write apps/admin/src/pages/WorkspaceEventsCard.tsx && npx tsc -p apps/admin/tsconfig.json --noEmit && npx vitest run apps/admin`
Expected: verde.

```bash
git add apps/admin/src/pages/WorkspaceEventsCard.tsx
git commit -m "feat(admin): cartão de eventos do workspace em primitivos"
```

---

### Task 13: `WorkspaceInvitesCard` em primitivos e testes com Radix Select

**Files:**

- Modify: `apps/admin/src/pages/WorkspaceInvitesCard.tsx` (JSX a partir da linha 110 e `InviteRow`)
- Modify: `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx`

- [ ] **Step 1: Atualizar os testes primeiro**

No topo de `WorkspaceInvitesCard.test.tsx`, após os imports:

```tsx
// jsdom has no scrollIntoView; Radix's Select calls it when committing a selection.
Element.prototype.scrollIntoView = vi.fn();

/** Opens the Radix role select and picks an option by its visible label. */
async function pickRole(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: /papel/i }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}
```

Mudanças por teste:

- `'offers Admin and Agent roles and NO Owner option in the DOM'`:

```tsx
fireEvent.click(await screen.findByRole('button', { name: /\+ convidar/i }));
const trigger = screen.getByRole('combobox', { name: /papel/i });
expect(trigger).toHaveTextContent('Agente'); // defaults to the lower-privilege role
fireEvent.click(trigger);
const options = await screen.findAllByRole('option');
expect(options.map((o) => o.textContent)).toEqual(['Agente', 'Admin']);
expect(screen.queryByRole('option', { name: /owner/i })).toBeNull();
```

- `'submits the typed values, toasts the returned message and refetches'`: trocar `fireEvent.change(screen.getByLabelText(/papel/i), { target: { value: 'admin' } });` por `await pickRole('Admin');`.
- `'Dismiss resets the role back to the lower-privilege default'`: trocar o `fireEvent.change(...)` por `await pickRole('Admin');`, e as duas asserções `expect((screen.getByLabelText(/papel/i) as HTMLSelectElement).value).toBe('admin')` / `.toBe('agent')` por `expect(screen.getByRole('combobox', { name: /papel/i })).toHaveTextContent('Admin')` / `toHaveTextContent('Agente')`.
- `'collapsing via the header + Invite toggle resets the role…'`: idem.
- `'shows a retry control when the fetch fails'`: acrescentar `expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();`.
- Os testes que fazem `getByLabelText(/e-mail/i)` continuam funcionando (o `Input` mantém `aria-label="E-mail"`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx`
Expected: FAIL nos testes que procuram `combobox` (hoje é `<select>`, role `combobox` também, mas sem `option` clicável via Radix e sem texto no trigger). Pelo menos os testes de reset do papel e o de opções falham.

- [ ] **Step 3: Imports do componente**

```tsx
import { Mail } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
```

- [ ] **Step 4: Reescrever o `return` do card**

```tsx
return (
  <Card className="mb-6 mt-6 min-w-0 overflow-hidden">
    <CardHeader>
      <CardTitle>Convites ({total})</CardTitle>
      <div className="flex items-center gap-3">
        {total > invites.length && (
          <span className="text-xs text-muted-foreground">
            mostrando {invites.length} de {total}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-primary"
          onClick={() => (formOpen ? closeForm() : setFormOpen(true))}
        >
          + Convidar
        </Button>
      </div>
    </CardHeader>

    <CardContent className="flex flex-col gap-4">
      {formOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(false); // unconfirmed; the gate may ask
          }}
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <Input
            aria-label="E-mail"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@exemplo.com"
            className="min-w-0 flex-1"
          />
          <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'agent')}>
            <SelectTrigger aria-label="Papel" className="w-full sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">Agente</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={createMutation.isPending}>
            Enviar
          </Button>
          <Button type="button" variant="ghost" onClick={closeForm}>
            Descartar
          </Button>
        </form>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-4 w-64" />
        </div>
      ) : isError ? (
        <ErrorState message="Falha ao carregar convites." onRetry={() => refetch()} />
      ) : invites.length === 0 ? (
        <EmptyState icon={Mail} title="Nenhum convite" />
      ) : (
        <>
          {/* Desktop header row (finding 8) */}
          <div className="hidden border-b border-border pb-2 text-[0.7rem] uppercase tracking-wider text-muted-foreground md:grid md:grid-cols-[2fr_0.7fr_1fr_1.1fr_1.6fr_1fr] md:gap-2">
            <span>E-mail</span>
            <span>Papel</span>
            <span>Status</span>
            <span>Enviado</span>
            <span>Estado de autenticação</span>
            <span>Ações</span>
          </div>
          <div className="flex flex-col gap-2">
            {invites.map((it) => (
              <InviteRow
                key={it.id}
                invite={it}
                busy={busyId === it.id}
                onResend={() => resendMutation.mutate({ inviteId: it.id, confirm: false })}
                onCancel={() => {
                  if (window.confirm(CANCEL_WARNING)) cancelMutation.mutate(it.id);
                }}
              />
            ))}
          </div>
        </>
      )}
    </CardContent>
  </Card>
);
```

O placeholder do e-mail muda de `person@example.com` para `pessoa@exemplo.com` (passada de português). Nenhum teste depende dele.

- [ ] **Step 5: `InviteRow` com `Badge` e `Button`**

Substituir o `return` de `InviteRow` por:

```tsx
return (
  <div className="min-w-0 border-b border-border/50 py-2.5 md:grid md:grid-cols-[2fr_0.7fr_1fr_1.1fr_1.6fr_1fr] md:gap-2 md:items-center">
    <div className="min-w-0">
      <span className="block truncate text-sm">{invite.email}</span>
      {tags.map((t) => (
        <Badge key={t} variant="warning" size="sm" className="mr-1 mt-0.5">
          {t}
        </Badge>
      ))}
    </div>
    {/* Mobile: same nodes, laid out as a wrapped meta line instead of a hidden grid column
          (md:contents lets them fall back into their normal grid cells at md+, so nothing
          is duplicated and the desktop grid is unaffected). */}
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 md:mt-0 md:contents">
      <span className="text-xs text-muted-foreground">{invite.role}</span>
      <Badge
        variant={
          invite.status === 'accepted'
            ? 'success'
            : invite.status === 'expired'
              ? 'neutral'
              : 'warning'
        }
        size="sm"
        className="w-fit"
      >
        {invite.status}
      </Badge>
      <span className="text-xs text-muted-foreground">{formatSent(invite.created_at)}</span>
      <span className="text-xs text-muted-foreground">{authStateLabel(invite.auth_state)}</span>
    </div>
    <div className="mt-2 flex shrink-0 gap-1 md:mt-0">
      {actable && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-primary"
            onClick={onResend}
            disabled={busy}
          >
            Reenviar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </Button>
        </>
      )}
    </div>
  </div>
);
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx`
Expected: PASS (todos os 19 testes).

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/admin/src/pages/WorkspaceInvitesCard.tsx apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx
npx tsc -p apps/admin/tsconfig.json --noEmit
git add apps/admin/src/pages/WorkspaceInvitesCard.tsx apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx
git commit -m "feat(admin): cartão de convites em primitivos; testes abrem o Select do Radix"
```

---

### Task 14: Passada de português e verificação completa

**Files:**

- Modify: `apps/admin/src/lib/api.ts:199-280` (os três mapas de rótulos)
- Possivelmente: qualquer arquivo listado em `no-hex-literals.test.ts` mais `BannersPage.tsx` e `PopupsPage.tsx` (só as linhas tocadas)

- [ ] **Step 0: Traduzir `RESOURCE_LIMIT_LABELS`, `RATE_LIMIT_LABELS` e `FEATURE_FLAG_LABELS`**

Esses mapas são copy visível nos cartões de limites e funcionalidades do detalhe do workspace (e em `PlansPage`). Manter as chaves; trocar só os valores:

```ts
export const RESOURCE_LIMIT_LABELS: Record<string, string> = {
  max_clients: 'Máx. de clientes',
  max_team_members: 'Máx. de membros da equipe',
  max_workflow_templates: 'Máx. de modelos de fluxo',
  max_active_workflows_per_client: 'Máx. de fluxos por cliente',
  max_instagram_accounts: 'Máx. de contas Instagram',
  max_leads: 'Máx. de leads',
  max_hub_tokens: 'Máx. de tokens do Hub',
  storage_quota_bytes: 'Armazenamento (bytes)',
  max_custom_properties_per_template: 'Máx. de propriedades por modelo',
  max_posts_per_workflow: 'Máx. de posts por fluxo',
  max_workspaces_per_user: 'Máx. de workspaces por usuário',
  max_mcp_keys: 'Máx. de chaves MCP',
};
```

```ts
export const FEATURE_FLAG_LABELS: Record<string, string> = {
  feature_instagram: 'Instagram',
  feature_instagram_ai: 'IA do Instagram',
  feature_analytics_reports: 'Relatórios de analytics',
  feature_best_times: 'Melhores horários',
  feature_audience_demographics: 'Demografia do público',
  feature_hub_portal: 'Portal do Hub',
  feature_leads: 'Leads',
  feature_financial: 'Financeiro',
  feature_contracts: 'Contratos',
  feature_ideas: 'Ideias',
  feature_workflow_gantt: 'Gantt de fluxos',
  feature_workflow_recurrence: 'Recorrência de fluxos',
  feature_csv_import: 'Importação CSV',
  feature_custom_properties: 'Propriedades personalizadas',
  feature_post_scheduling: 'Agendamento de posts',
  feature_auto_sync_cron: 'Sincronização automática',
  feature_post_tagging: 'Marcação de posts',
  feature_brand_customization: 'Personalização de marca',
  feature_mcp: 'MCP (Claude)',
  feature_tiktok: 'TikTok',
  feature_mensagens: 'Mensagens',
  feature_instagram_automation: 'Automação do Instagram',
  feature_briefing_audio: 'Briefing por áudio',
};
```

```ts
export const RATE_LIMIT_LABELS: Record<string, string> = {
  rate_instagram_syncs_per_day: 'Sincronizações do Instagram por dia',
  rate_ai_analyses_per_month: 'Análises de IA por mês',
  rate_report_generations_per_month: 'Relatórios gerados por mês',
};
```

Se algum mapa tiver chaves além das listadas acima (conferir no arquivo), traduzir também, mantendo a chave. Depois: `grep -rn "Max Clients\|Hub Portal\|CSV Import" apps e2e` deve voltar vazio.

- [ ] **Step 1: Varredura**

Run:

```bash
grep -nE "(title|placeholder|aria-label)=\"[A-Za-z ]*\b(Loading|Save|Cancel|Delete|Remove|Copy|Copied|Revoke|Add|Edit|Search|New|Back|Submit|Close|Open|Menu|Settings)\b" apps/admin/src/layouts/AdminLayout.tsx apps/admin/src/pages/LoginPage.tsx apps/admin/src/pages/AdminsPage.tsx apps/admin/src/pages/IntegrationsPage.tsx apps/admin/src/pages/KbArticlesPage.tsx apps/admin/src/pages/WorkspaceDetailPage.tsx apps/admin/src/pages/WorkspaceEventsCard.tsx apps/admin/src/pages/WorkspaceInvitesCard.tsx apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/workspaces/WorkspacesTable.tsx
grep -n "—" apps/admin/src/layouts/AdminLayout.tsx apps/admin/src/pages/LoginPage.tsx apps/admin/src/pages/AdminsPage.tsx apps/admin/src/pages/IntegrationsPage.tsx apps/admin/src/pages/KbArticlesPage.tsx apps/admin/src/pages/WorkspaceDetailPage.tsx apps/admin/src/pages/WorkspaceEventsCard.tsx apps/admin/src/pages/WorkspaceInvitesCard.tsx | grep -v "'—'\|>—<\||| '—'\|?? '—'"
```

Expected: o primeiro grep vazio. O segundo só pode listar o travessão usado como valor vazio (`'—'`), que é dado e não copy; qualquer travessão dentro de frase deve ser trocado por ponto, dois-pontos ou "·".

- [ ] **Step 2: Verificação completa (a mesma do CI)**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: tudo verde. Se `format:check` reclamar, `npm run format` e commitar.

- [ ] **Step 3: Commit (se algo mudou)**

```bash
git add -A apps/admin/src DESIGN_SYSTEM.md
git commit -m "chore(admin): passada de português e formatação da fase 2a"
```

---

## Verificação manual (depois da execução, antes do PR)

Com `npm run dev:admin:staging` e o login seed (ver memória `reference_seed_login_browser_verification`), no Browser pane:

1. Tema claro: sidebar clara (`bg-card`), wordmark escuro legível. Tema escuro: sidebar escura. Glass ligado: vidro escuro.
2. Login (`/admin/login`) com campos em primitivos.
3. `/admin/workspaces`: Tab até o primeiro nome, Enter abre o detalhe; clique na linha abre; clique no nome abre uma vez.
4. Dashboard, Base de conhecimento, Banners, Popups: Tab chega nos títulos; Enter navega (ou abre o modal em Banners/Popups).
5. Admins, Integrações, KB lista, Detalhe do workspace: convidar admin, copiar URL, filtrar KB, trocar plano, editar limites, alternar feature, salvar overrides, filtrar eventos, convidar membro.

## Self-review

- **Cobertura do spec:** §1 → Task 1; §2.1 → Task 5; §2.2 → Task 6; §3 → Tasks 2, 3, 4, 10; §4.1 → Task 8; §4.2 → Task 9; §4.3 → Task 10; §4.4 → Task 11; §4.5 → Task 12; §4.6 → Task 13; §4.7 → Task 14; §5.1 → Tasks 1, 2, 3, 5, 7, 8, 10; §5.2 → Tasks 9, 13, 3; §5.3 e §6 → seção "Verificação manual" e o processo de PR. Desvios do spec listados no topo.
- **Placeholders:** os únicos `{/* … */}` são instruções explícitas para copiar blocos existentes sem alteração (paths do SVG na Task 5, `Field`s da assinatura na Task 11), com as linhas de origem indicadas.
- **Consistência de nomes:** `RowLink`/`RowButton`/`ROW_TRIGGER_CLASS` (Task 2) usados em 3, 4, 10; `workspaceDetailPath`/`kbArticleEditPath`/`kbArticleNewPath` (Task 2) usados em 3, 10; `STATUS_BADGE_VARIANT` (Task 1) usado em 11; `Textarea`/`Switch` (Task 1) usados em 11; `ALL`/`NO_PLAN`/`HEAD_CLASS` são locais a cada arquivo.
