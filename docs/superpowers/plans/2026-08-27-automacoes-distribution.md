# Distribuição da feature Automações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checklist de primeiros passos na página Automações, nav item com cadeado para planos sem a feature levando a uma tela de upsell com pitch, e correção do `UpgradeLockedScreen` para `workspaceRole`. (Os dois banners são dados criados no admin, sem código — passo operacional no fim.)

**Architecture:** Tudo frontend no app CRM. O gate de página vive NA `AutomacoesPage` (nunca no `FEATURE_GATED` do `ProtectedRoute`), combinando a flag de entitlement com o resultado bem-sucedido da query de automações. O nav marca o item como `locked` em vez de filtrá-lo quando o item declara `showLockedWhenGated`. O checklist é um componente presentacional puro que recebe sinais por props.

**Tech Stack:** React 19, TanStack Query, vitest + @testing-library/react, i18next (namespaces `automations` e `common` em `packages/i18n/locales/{pt,en}/`), Tailwind + CSS legado (`apps/crm/style.css`), supabase-js (PostgREST).

**Spec:** `docs/superpowers/specs/2026-08-27-automacoes-distribution-design.md`

## Global Constraints

- SEM travessão (em-dash) em qualquer copy de usuário: ponto, dois-pontos ou "·".
- Toda string de usuário nova entra em pt E en (`packages/i18n/locales/pt/...` + `en/...`).
- Ícones dentro de páginas React: `lucide-react`. Dentro da Sidebar/MobileNav o sistema é phosphor (`<i className="ph ph-..." />`) — seguir o código vizinho.
- Nenhuma migration, nenhuma edge function, nenhuma mudança de backend.
- Typecheck do CI = 4 projetos: `npx tsc -p apps/crm/tsconfig.json --noEmit`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`.
- Antes do push final: `npm run lint`, `npm run format:check` (auto-fix com `npm run format`), `npm run test`.
- Se algum comando deno rodou na sessão (deploy, test:functions), `ls node_modules/.deno` e rode `npm ci` antes de confiar em lint/tsc locais.
- Commits pequenos por task, mensagens em português no padrão do repo (`feat(automacoes): ...`), rodapé `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `UpgradeLockedScreen` — `workspaceRole` + prop `children`

**Files:**
- Modify: `apps/crm/src/components/paywall/UpgradeLockedScreen.tsx`
- Test: `apps/crm/src/components/paywall/__tests__/UpgradeLockedScreen.test.tsx`

**Interfaces:**
- Produces: `UpgradeLockedScreen({ featureLabel: string; feature?: string; children?: ReactNode })`. Decisão de owner passa a ser `workspaceRole === 'owner'` (null = não-owner). `children` renderiza entre o `<h1>` e o bloco de CTA. Task 6 consome exatamente essa assinatura.

- [ ] **Step 1: Atualizar o helper de mock e escrever os testes que falham**

No test file existente, o helper `setRole` fabrica o retorno de `useAuth` só com `role` + `profile`. Substituir por um que também controla `workspaceRole`, e migrar as chamadas existentes (`setRole('owner')` → `setAuth('owner', 'owner')`; `setRole('agent')` → `setAuth('agent', 'agent')` — os testes atuais continuam passando com papel coerente nos dois campos):

```tsx
function setAuth(
  role: 'owner' | 'admin' | 'agent',
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
  contaId: string | null = 'ws-1',
) {
  mockedUseAuth.mockReturnValue({
    role,
    workspaceRole,
    profile: contaId ? { conta_id: contaId } : null,
  } as never);
}
```

Acrescentar no `describe('UpgradeLockedScreen', ...)`:

```tsx
it('decide owner pelo workspaceRole, não pelo role de profiles', () => {
  // owner em profiles mas agent no workspace ativo: NÃO pode ver botão de compra
  setAuth('owner', 'agent');
  renderScreen('Relatórios');
  expect(screen.queryByRole('button', { name: 'Fazer upgrade' })).not.toBeInTheDocument();
  expect(
    screen.getByText('Fale com o dono do workspace para liberar este recurso.'),
  ).toBeInTheDocument();
});

it('workspaceRole null (não resolvido) trata como não-owner', () => {
  setAuth('owner', null);
  renderScreen('Relatórios');
  expect(screen.queryByRole('button', { name: 'Fazer upgrade' })).not.toBeInTheDocument();
});

it('workspaceRole owner vê o CTA mesmo com role de profiles desatualizado', () => {
  setAuth('agent', 'owner');
  renderScreen('Relatórios');
  expect(screen.getByRole('button', { name: 'Fazer upgrade' })).toBeInTheDocument();
});

it('renderiza children entre o título e o CTA', () => {
  setAuth('owner', 'owner');
  render(
    <MemoryRouter>
      <UpgradeLockedScreen featureLabel="Automações">
        <p data-testid="pitch">pitch aqui</p>
      </UpgradeLockedScreen>
    </MemoryRouter>,
  );
  expect(screen.getByTestId('pitch')).toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/components/paywall/__tests__/UpgradeLockedScreen.test.tsx`
Expected: FAIL — os 3 primeiros novos testes quebram (componente ainda usa `role`), o de children quebra (prop inexistente).

- [ ] **Step 3: Implementação mínima**

Em `UpgradeLockedScreen.tsx`:

```tsx
import { ReactNode, useEffect } from 'react';
// ...imports existentes inalterados

export function UpgradeLockedScreen({
  featureLabel,
  feature,
  children,
}: {
  featureLabel: string;
  feature?: string;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  // workspaceRole (workspace_members do workspace ATIVO), não `role`:
  // profiles.role fica obsoleto após trocar de workspace (contrato documentado
  // no AuthContext). null (não resolvido) falha fechado como não-owner.
  const { workspaceRole, profile } = useAuth();
  const isOwner = workspaceRole === 'owner';
  const workspaceId = profile?.conta_id ?? null;
  // ...useEffect de reportPaywallHit inalterado

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-3 p-8">
      <h1 className="text-xl font-bold">{featureLabel} não está no seu plano</h1>
      {children}
      {isOwner ? (
        /* bloco atual inalterado */
      ) : (
        /* bloco atual inalterado */
      )}
    </div>
  );
}
```

(`h-[60vh]` vira `min-h-[60vh]` para o pitch não estourar o container; sem outra mudança visual.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/components/paywall/__tests__/UpgradeLockedScreen.test.tsx`
Expected: PASS (novos + todos os existentes, incluindo os de paywall reporting).

- [ ] **Step 5: Conferir os outros callers e commitar**

`grep -rn "UpgradeLockedScreen" apps/crm/src --include="*.tsx" -l` — os callers (ProtectedRoute etc.) não passam `children`, então nada muda para eles. Rodar também `npx vitest run apps/crm/src/components/layout/__tests__/ProtectedRoute.test.tsx`; se algum teste de ProtectedRoute fabricar `useAuth` sem `workspaceRole`, adicionar `workspaceRole` coerente ao mock (mesmo valor do `role`).

```bash
git add apps/crm/src/components/paywall
git commit -m "fix(paywall): UpgradeLockedScreen decide owner por workspaceRole e aceita children"
```

---

### Task 2: nav-data — `showLockedWhenGated` marca `locked` em vez de esconder

**Files:**
- Modify: `apps/crm/src/components/layout/nav-data.ts`
- Test: `apps/crm/src/components/layout/__tests__/nav-data.test.ts`

**Interfaces:**
- Produces: `NavItem` ganha `showLockedWhenGated?: boolean` (declaração estática, só no item `automacoes`) e `locked?: boolean` (saída de `getNavGroups`, `true` quando a flag do item é explicitamente `false` e o item declara `showLockedWhenGated`). Tasks 3 consome `item.locked`. `getMoreSheetGroups` herda o comportamento por delegação (nada a fazer lá).

- [ ] **Step 1: Testes que falham** (adicionar em `nav-data.test.ts`, seguindo o estilo das chamadas `getNavGroups` existentes no arquivo — copiar os argumentos `canSeeFinancials`/`workspaceRole` de um teste vizinho):

```ts
describe('locked nav items (showLockedWhenGated)', () => {
  const FEATURES_OFF = { feature_instagram_automation: false };

  it('flag false: automacoes fica visível com locked=true em vez de sumir', () => {
    const items = getNavGroups('owner', FEATURES_OFF, true, 'owner').flatMap((g) => g.items);
    const auto = items.find((i) => i.id === 'automacoes');
    expect(auto).toBeDefined();
    expect(auto?.locked).toBe(true);
  });

  it('flag true: item normal, sem locked', () => {
    const items = getNavGroups('owner', { feature_instagram_automation: true }, true, 'owner')
      .flatMap((g) => g.items);
    expect(items.find((i) => i.id === 'automacoes')?.locked).toBeUndefined();
  });

  it('itens gateados SEM showLockedWhenGated continuam sendo escondidos', () => {
    const items = getNavGroups('owner', { feature_leads: false }, true, 'owner')
      .flatMap((g) => g.items);
    expect(items.find((i) => i.id === 'leads')).toBeUndefined();
  });

  it('features null (carregando/ilimitado) não marca nada', () => {
    const items = getNavGroups('owner', null, true, 'owner').flatMap((g) => g.items);
    expect(items.find((i) => i.id === 'automacoes')?.locked).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/nav-data.test.ts`
Expected: FAIL no primeiro teste (`auto` é `undefined` — hoje o item é filtrado).

- [ ] **Step 3: Implementação**

Na interface `NavItem` (após `disabled?: boolean`):

```ts
  /** Flag off: em vez de sumir, renderiza esmaecido com cadeado, clicável
   * (a página destino mostra o paywall). Não combinar com `disabled`. */
  showLockedWhenGated?: boolean;
  /** Saída de getNavGroups; nunca declarar estaticamente. */
  locked?: boolean;
```

No item `automacoes` (~linha 104), adicionar `showLockedWhenGated: true`.

No filtro de features de `getNavGroups` (~linha 288), trocar o `filter` por `map`+`filter`:

```ts
  if (features) {
    groups = groups
      .map((g) => ({
        ...g,
        items: g.items
          .map((i) => {
            const flag = NAV_FEATURE[i.id];
            if (!flag || features[flag] !== false) return i;
            return i.showLockedWhenGated ? { ...i, locked: true } : null;
          })
          .filter((i): i is NavItem => i !== null),
      }))
      .filter((g) => g.items.length > 0);
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/nav-data.test.ts`
Expected: PASS (novos + existentes; se algum teste existente esperar ausência do `automacoes` com flag false, atualizá-lo para esperar `locked: true` — comportamento novo é intencional).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/nav-data.ts apps/crm/src/components/layout/__tests__/nav-data.test.ts
git commit -m "feat(nav): showLockedWhenGated marca automacoes como locked em vez de esconder"
```

---

### Task 3: Sidebar + MobileNav renderizam o item locked (cadeado)

**Files:**
- Modify: `apps/crm/src/components/layout/Sidebar.tsx` (branch de item, ~linha 118)
- Modify: `apps/crm/src/components/layout/MobileNav.tsx` (More sheet, ~linha 209)
- Modify: `apps/crm/style.css` (junto de `.sidebar-sub-link--disabled`, ~linha 341)
- Modify: `packages/i18n/locales/pt/common.json` + `packages/i18n/locales/en/common.json`
- Test: `apps/crm/src/components/layout/__tests__/Sidebar.test.tsx`, `.../MobileNav.test.tsx`

**Interfaces:**
- Consumes: `item.locked` da Task 2.
- Produces: link com `data-testid="nav-locked-automacoes"` (Sidebar) e `data-testid="mobile-nav-locked-automacoes"` (MobileNav), navegação normal para `/automacoes`.

- [ ] **Step 1: Testes que falham.** Antes, `grep -n "automacoes\|feature_instagram_automation" apps/crm/src/components/layout/__tests__/Sidebar.test.tsx .../MobileNav.test.tsx` — testes que hoje afirmam que o item SOME com flag false devem passar a afirmar o estado locked. Adicionar (seguindo o harness de render/mocks já existente em cada arquivo — reutilizar o helper que injeta `features`):

```tsx
it('renderiza automacoes com cadeado quando a flag é false', () => {
  renderSidebar({ features: { feature_instagram_automation: false } }); // adaptar ao helper local
  const locked = screen.getByTestId('nav-locked-automacoes');
  expect(locked).toBeInTheDocument();
  expect(locked.querySelector('.ph-lock')).not.toBeNull();
});
```

(mesma ideia no MobileNav.test.tsx com `mobile-nav-locked-automacoes`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/Sidebar.test.tsx apps/crm/src/components/layout/__tests__/MobileNav.test.tsx`
Expected: FAIL (`getByTestId` não encontra).

- [ ] **Step 3: Implementação.** Sidebar, na cadeia ternária do item (entre o branch `item.disabled` e o `item.newTab`):

```tsx
              ) : item.locked ? (
                <a
                  className="sidebar-sub-link sidebar-sub-link--locked"
                  href={`#${item.route}`}
                  data-testid={`nav-locked-${item.id}`}
                  title={t('sidebar.upgradeToUnlock', 'Disponível nos planos Pro e Max')}
                  onClick={(e) => {
                    e.preventDefault();
                    handleNavClick(item.route);
                  }}
                >
                  <i className={`ph ${item.icon}`} />
                  <span>{t(item.labelKey, item.label)}</span>
                  <i className="ph ph-lock nav-lock-icon" aria-hidden="true" />
                </a>
```

MobileNav (More sheet), logo após o branch `item.disabled` (~linha 224), antes do return normal:

```tsx
                if (item.locked) {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="mobile-more-item mobile-more-item--locked"
                      data-testid={`mobile-nav-locked-${item.id}`}
                      onClick={() => handleNavClick(item.route)} // usar o handler de navegação local do arquivo
                    >
                      <div className="mobile-more-item-icon">
                        <i className={`ph ${item.icon}`} />
                      </div>
                      <span>{t(item.labelKey, item.label)}</span>
                      <i className="ph ph-lock nav-lock-icon" aria-hidden="true" />
                    </button>
                  );
                }
```

(Se os itens normais do More sheet forem `<a>`/outro elemento com outro handler, espelhar exatamente o elemento/handler do branch normal do próprio arquivo, mantendo classe e testid acima.)

`style.css`, logo abaixo de `.sidebar-sub-link--disabled`:

```css
.sidebar-sub-link--locked,
.mobile-more-item--locked {
  opacity: 0.55;
}
.sidebar-sub-link--locked:hover {
  opacity: 0.8;
}
.nav-lock-icon {
  margin-left: auto;
  font-size: 0.8rem;
  flex-shrink: 0;
}
```

`common.json` pt, dentro do objeto `"sidebar"` existente (onde vive `comingSoon`): `"upgradeToUnlock": "Disponível nos planos Pro e Max"`. En: `"upgradeToUnlock": "Available on the Pro and Max plans"`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/components/layout/__tests__/Sidebar.test.tsx apps/crm/src/components/layout/__tests__/MobileNav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout apps/crm/style.css packages/i18n/locales
git commit -m "feat(nav): item Automações esmaecido com cadeado para planos sem a feature"
```

---

### Task 4: Store — `hasAutomationReadyAccount()` (sinal 1 do checklist)

**Files:**
- Modify: `apps/crm/src/store/instagramAutomations.ts`

**Interfaces:**
- Produces: `hasAutomationReadyAccount(): Promise<boolean>` exportada via `@/store` (o barrel `store/index.ts` já reexporta o módulo). TRUE quando ≥1 conta IG do workspace satisfaz a elegibilidade tripla. Task 5/6 consomem.

Sem teste unitário próprio: é um select PostgREST fino, mesmo padrão dos vizinhos não testados do módulo (`getInstagramAutomations`, `countInstagramAutomations`); a cobertura vem dos testes de página (Task 6) com a função mockada, e o filtro em si espelha literalmente a elegibilidade tripla do backend (migration `20260815000007`).

- [ ] **Step 1: Implementar** (após `countInstagramAutomations`):

```ts
/** Sinal do checklist de primeiros passos: TRUE quando pelo menos uma conta IG
 * do workspace satisfaz a elegibilidade tripla do processador de automações
 * (active + os dois escopos + subscription de comentários) — o mesmo trio de
 * condições da claim RPC (migration 20260815000007). RLS limita ao workspace. */
export async function hasAutomationReadyAccount(): Promise<boolean> {
  const { data, error } = await supabase
    .from('instagram_accounts')
    .select('id')
    .eq('authorization_status', 'active')
    .contains('permissions', [
      'instagram_business_manage_comments',
      'instagram_business_manage_messages',
    ])
    .not('comments_subscribed_at', 'is', null)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
```

- [ ] **Step 2: Typecheck e commit**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: sem erros.

```bash
git add apps/crm/src/store/instagramAutomations.ts
git commit -m "feat(store): hasAutomationReadyAccount para o sinal 1 do checklist de automações"
```

---

### Task 5: Componente `AutomacoesChecklist` (formato B, vertical compacto)

**Files:**
- Create: `apps/crm/src/pages/automacoes/AutomacoesChecklist.tsx`
- Create: `apps/crm/src/pages/automacoes/__tests__/AutomacoesChecklist.test.tsx`
- Modify: `packages/i18n/locales/pt/automations.json` + `packages/i18n/locales/en/automations.json`

**Interfaces:**
- Produces:

```ts
interface AutomacoesChecklistProps {
  accountReady: boolean;  // sinal 1
  hasAutomation: boolean; // sinal 2
  hasFirstDm: boolean;    // sinal 3
  canCreate: boolean;     // entitlement: sem ele o CTA do passo 2 NÃO renderiza
  onCreate: () => void;
  onDismiss: () => void;
}
```

Retorna `null` quando os 3 sinais são true. Task 6 consome.

- [ ] **Step 1: i18n.** Em `packages/i18n/locales/pt/automations.json` (merge no objeto raiz do namespace):

```json
  "checklist": {
    "title": "Comece por aqui",
    "subtitle": "3 passos para a primeira DM automática",
    "dismiss": "Dispensar",
    "step1": "Reconecte o Instagram do cliente",
    "step1Cta": "Ver clientes",
    "step2": "Crie sua primeira automação",
    "step2Cta": "Criar",
    "step3": "Teste com um comentário",
    "step3Hint": "Comente a palavra-chave num post e veja a DM chegar."
  }
```

En:

```json
  "checklist": {
    "title": "Start here",
    "subtitle": "3 steps to your first automatic DM",
    "dismiss": "Dismiss",
    "step1": "Reconnect the client's Instagram",
    "step1Cta": "View clients",
    "step2": "Create your first automation",
    "step2Cta": "Create",
    "step3": "Test it with a comment",
    "step3Hint": "Comment the keyword on a post and watch the DM arrive."
  }
```

- [ ] **Step 2: Testes que falham** (mockar `react-i18next` no padrão t-devolve-a-chave do `AutomacoesPage.test.tsx`):

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'pt' } }),
}));

import AutomacoesChecklist from '../AutomacoesChecklist';

const base = {
  accountReady: false,
  hasAutomation: false,
  hasFirstDm: false,
  canCreate: true,
  onCreate: vi.fn(),
  onDismiss: vi.fn(),
};

function renderChecklist(overrides: Partial<typeof base> = {}) {
  return render(
    <MemoryRouter>
      <AutomacoesChecklist {...base} {...overrides} />
    </MemoryRouter>,
  );
}

describe('AutomacoesChecklist', () => {
  it('0/3: três passos pendentes, passo 1 é o atual', () => {
    renderChecklist();
    expect(screen.getByText('checklist.title')).toBeInTheDocument();
    expect(screen.getByTestId('checklist-step-1').dataset.state).toBe('current');
    expect(screen.getByTestId('checklist-step-2').dataset.state).toBe('pending');
    expect(screen.getByTestId('checklist-step-3').dataset.state).toBe('pending');
  });

  it('1/3: passo 1 done, passo 2 atual com CTA que chama onCreate', () => {
    const onCreate = vi.fn();
    renderChecklist({ accountReady: true, onCreate });
    expect(screen.getByTestId('checklist-step-1').dataset.state).toBe('done');
    expect(screen.getByTestId('checklist-step-2').dataset.state).toBe('current');
    fireEvent.click(screen.getByRole('button', { name: 'checklist.step2Cta' }));
    expect(onCreate).toHaveBeenCalled();
  });

  it('sem entitlement (canCreate=false) o CTA do passo 2 não existe', () => {
    renderChecklist({ accountReady: true, canCreate: false });
    expect(screen.queryByRole('button', { name: 'checklist.step2Cta' })).not.toBeInTheDocument();
  });

  it('3/3: não renderiza nada', () => {
    const { container } = renderChecklist({
      accountReady: true,
      hasAutomation: true,
      hasFirstDm: true,
    });
    expect(container.firstChild).toBeNull();
  });

  it('dispensar chama onDismiss', () => {
    const onDismiss = vi.fn();
    renderChecklist({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: 'checklist.dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomacoesChecklist.test.tsx`
Expected: FAIL (módulo inexistente).

- [ ] **Step 4: Implementação**

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface AutomacoesChecklistProps {
  accountReady: boolean;
  hasAutomation: boolean;
  hasFirstDm: boolean;
  /** Entitlement de criação: sem ele o CTA do passo 2 não renderiza (o
   * FeatureGate do header não cobre este caminho e o dialog vive fora dele). */
  canCreate: boolean;
  onCreate: () => void;
  onDismiss: () => void;
}

type StepState = 'done' | 'current' | 'pending';

function stateOf(done: boolean, isCurrent: boolean): StepState {
  return done ? 'done' : isCurrent ? 'current' : 'pending';
}

function StepMarker({ state }: { state: StepState }) {
  if (state === 'done') {
    return <Check className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--success)' }} />;
  }
  return (
    <span
      className="inline-block h-4 w-4 rounded-full border-2 flex-shrink-0"
      style={{ borderColor: state === 'current' ? 'var(--primary-color)' : 'var(--border-color)' }}
    />
  );
}

/** Checklist "Comece por aqui" (formato B do spec 2026-08-27). Presentacional:
 * a página é dona dos sinais, do dismiss persistido e da visibilidade externa. */
export default function AutomacoesChecklist({
  accountReady,
  hasAutomation,
  hasFirstDm,
  canCreate,
  onCreate,
  onDismiss,
}: AutomacoesChecklistProps) {
  const { t } = useTranslation('automations');
  if (accountReady && hasAutomation && hasFirstDm) return null;

  const s1 = stateOf(accountReady, !accountReady);
  const s2 = stateOf(hasAutomation, accountReady && !hasAutomation);
  const s3 = stateOf(hasFirstDm, accountReady && hasAutomation && !hasFirstDm);
  const doneCount = [accountReady, hasAutomation, hasFirstDm].filter(Boolean).length;

  const rowCls = (state: StepState) =>
    `flex items-center gap-2.5 text-sm ${state === 'pending' ? 'opacity-55' : ''}`;
  const labelCls = (state: StepState) =>
    state === 'done' ? 'line-through' : '';

  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
      data-testid="automacoes-checklist"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-semibold text-[15px]">{t('checklist.title')}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('checklist.subtitle')} · {doneCount}/3
          </div>
        </div>
        <button
          type="button"
          className="text-xs underline"
          style={{ color: 'var(--text-muted)' }}
          onClick={onDismiss}
        >
          {t('checklist.dismiss')}
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <div className={rowCls(s1)} data-testid="checklist-step-1" data-state={s1}>
          <StepMarker state={s1} />
          <span className={labelCls(s1)} style={s1 === 'done' ? { color: 'var(--text-muted)' } : undefined}>
            {t('checklist.step1')}
          </span>
          {s1 === 'current' && (
            <Link to="/clientes" className="ml-auto text-xs underline" style={{ color: 'var(--text-muted)' }}>
              {t('checklist.step1Cta')} →
            </Link>
          )}
        </div>
        <div className={rowCls(s2)} data-testid="checklist-step-2" data-state={s2}>
          <StepMarker state={s2} />
          <span className={labelCls(s2)} style={s2 === 'done' ? { color: 'var(--text-muted)' } : undefined}>
            {t('checklist.step2')}
          </span>
          {s2 === 'current' && canCreate && (
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={onCreate}>
              {t('checklist.step2Cta')} →
            </Button>
          )}
        </div>
        <div className={rowCls(s3)} data-testid="checklist-step-3" data-state={s3}>
          <StepMarker state={s3} />
          <span className={labelCls(s3)}>{t('checklist.step3')}</span>
          {s3 === 'current' && (
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('checklist.step3Hint')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

(Conferir no arquivo `apps/crm/src/components/ui/button.tsx` que as variants `outline`/`size sm` existem; se os nomes divergirem, usar os equivalentes do arquivo.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomacoesChecklist.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/automacoes packages/i18n/locales
git commit -m "feat(automacoes): checklist Comece por aqui com sinais reais de progresso"
```

---

### Task 6: `AutomacoesPage` — gate de página (paywall com pitch) + checklist ligado

**Files:**
- Modify: `apps/crm/src/pages/automacoes/AutomacoesPage.tsx`
- Modify: `packages/i18n/locales/pt/automations.json` + `en/automations.json`
- Test: `apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`

**Interfaces:**
- Consumes: `UpgradeLockedScreen` (Task 1, com `children`), `AutomacoesChecklist` (Task 5), `hasAutomationReadyAccount` (Task 4), `useEntitlements().hasFeature` (existente).
- Produces: nada consumido adiante. **Regra dura: NÃO adicionar `/automacoes` ao `FEATURE_GATED` do `ProtectedRoute`.**

- [ ] **Step 1: i18n.** Adicionar ao namespace `automations` (pt):

```json
  "locked": {
    "pitch": "Responda comentários do Instagram com uma DM automática: palavra-chave no comentário, mensagem (com botões de link) na caixa de entrada do seguidor.",
    "cardKeyword": "Palavra-chave no comentário dispara a DM",
    "cardButtons": "Até 3 botões de link na mensagem",
    "cardReply": "Resposta pública automática opcional"
  },
  "loadError": "Não foi possível carregar as automações.",
  "retry": "Tentar de novo"
```

En:

```json
  "locked": {
    "pitch": "Reply to Instagram comments with an automatic DM: keyword in the comment, message (with link buttons) in the follower's inbox.",
    "cardKeyword": "A keyword in the comment triggers the DM",
    "cardButtons": "Up to 3 link buttons in the message",
    "cardReply": "Optional automatic public reply"
  },
  "loadError": "Could not load automations.",
  "retry": "Try again"
```

- [ ] **Step 2: Testes que falham.** No harness existente do `AutomacoesPage.test.tsx`: acrescentar ao `vi.hoisted` um `mockHasReadyAccount: vi.fn()` e um `entitlementsMock`; mockar no bloco `vi.mock('../../../store', ...)` também `hasAutomationReadyAccount: mockHasReadyAccount`; adicionar:

```tsx
vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => entitlementsMock(),
}));

vi.mock('@/components/paywall/UpgradeLockedScreen', () => ({
  UpgradeLockedScreen: ({ children }: { children?: ReactNode }) => (
    <div data-testid="upgrade-locked-screen">{children}</div>
  ),
}));
```

Default no `beforeEach`: `entitlementsMock.mockReturnValue({ isLoading: false, hasFeature: () => true })` e `mockHasReadyAccount.mockResolvedValue(false)`. Novos testes (usando o helper de render existente do arquivo):

```tsx
describe('gate de página (flag off)', () => {
  beforeEach(() => {
    entitlementsMock.mockReturnValue({
      isLoading: false,
      hasFeature: (f: string) => f !== 'feature_instagram_automation',
    });
  });

  it('0 automações (sucesso) → paywall com pitch', async () => {
    mockGetAutomations.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByTestId('upgrade-locked-screen')).toBeInTheDocument();
    expect(screen.getByText('locked.pitch')).toBeInTheDocument();
  });

  it('query em erro → estado de erro com retry, NUNCA paywall', async () => {
    mockGetAutomations.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('loadError')).toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-locked-screen')).not.toBeInTheDocument();
  });

  it('automações legadas → página normal, sem paywall', async () => {
    mockGetAutomations.mockResolvedValue([makeAutomation()]); // usar a factory local do arquivo
    renderPage();
    expect(await screen.findByText('title')).toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-locked-screen')).not.toBeInTheDocument();
  });
});

describe('checklist', () => {
  it('aparece com passos incompletos e some ao dispensar (persistido por workspace)', async () => {
    mockGetAutomations.mockResolvedValue([]);
    mockHasReadyAccount.mockResolvedValue(true);
    renderPage(); // flag ON (default)
    expect(await screen.findByTestId('automacoes-checklist')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'checklist.dismiss' }));
    expect(screen.queryByTestId('automacoes-checklist')).not.toBeInTheDocument();
    expect(localStorage.getItem('automacoes_checklist_dismissed:ws-1')).toBe('1');
  });

  it('não aparece antes das duas queries de sinal resolverem', () => {
    mockGetAutomations.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.queryByTestId('automacoes-checklist')).not.toBeInTheDocument();
  });
});
```

(Adaptar `renderPage`/factories aos nomes reais do harness; o `useAuth` mockado do arquivo deve fornecer `profile.conta_id = 'ws-1'`. `localStorage.clear()` no `beforeEach`.)

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`
Expected: FAIL nos novos testes.

- [ ] **Step 4: Implementação na página.** Mudanças em `AutomacoesPage.tsx`:

Imports novos: `useEffect` (react), `useEntitlements` de `'../../hooks/useEntitlements'`, `UpgradeLockedScreen` de `'@/components/paywall/UpgradeLockedScreen'`, `AutomacoesChecklist` de `'./AutomacoesChecklist'`, `hasAutomationReadyAccount` no import do store, `MessageCircle, Link2, Reply` de `'lucide-react'` (cards do pitch).

Trocar a query destruturada por:

```tsx
  const automationsQuery = useQuery({ queryKey: AUTOMATIONS_KEY, queryFn: getInstagramAutomations });
  const automations = automationsQuery.data ?? [];
  const isLoading = automationsQuery.isLoading;
```

Sinais + dismiss + entitlement (depois dos hooks existentes, antes de qualquer return — ordem de hooks estável):

```tsx
  const { hasFeature, isLoading: entLoading } = useEntitlements();
  const canCreate = !entLoading && hasFeature('feature_instagram_automation');
  const flagOff = !entLoading && !hasFeature('feature_instagram_automation');

  const readyQuery = useQuery({
    queryKey: ['ig-automation-ready-account'],
    queryFn: hasAutomationReadyAccount,
    staleTime: 60_000,
  });

  const dismissKey = `automacoes_checklist_dismissed:${profile?.conta_id ?? ''}`;
  const [checklistDismissed, setChecklistDismissed] = useState(false);
  useEffect(() => {
    setChecklistDismissed(localStorage.getItem(dismissKey) === '1');
  }, [dismissKey]);
  const dismissChecklist = () => {
    localStorage.setItem(dismissKey, '1');
    setChecklistDismissed(true);
  };
```

Gate, imediatamente antes do `return` principal (spec: paywall SÓ com resposta bem-sucedida e vazia; carregando → spinner; erro → retry):

```tsx
  if (flagOff && automationsQuery.isPending) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <Spinner size="lg" />
      </div>
    );
  }
  if (flagOff && automationsQuery.isError) {
    return (
      <div style={{ padding: '4rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{t('loadError')}</p>
        <Button variant="outline" onClick={() => automationsQuery.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (flagOff && automations.length === 0) {
    return (
      <UpgradeLockedScreen featureLabel={t('featureLabel')} feature="feature_instagram_automation">
        <p className="text-sm max-w-md" style={{ color: 'var(--text-muted)' }}>
          {t('locked.pitch')}
        </p>
        <div className="flex flex-wrap justify-center gap-2.5 my-2">
          {[
            { icon: MessageCircle, label: t('locked.cardKeyword') },
            { icon: Link2, label: t('locked.cardButtons') },
            { icon: Reply, label: t('locked.cardReply') },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="rounded-xl border px-4 py-3 text-xs max-w-[180px] flex flex-col items-center gap-1.5"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
            >
              <Icon className="h-4 w-4" />
              {label}
            </div>
          ))}
        </div>
      </UpgradeLockedScreen>
    );
  }
```

(`Spinner` já é importado no arquivo; conferir e reaproveitar.)

Checklist no JSX, logo abaixo do `<p>` do `tiebreakHint` (sinais só depois das duas queries resolverem, para não piscar estado errado):

```tsx
      {!checklistDismissed && automationsQuery.isSuccess && readyQuery.isSuccess && (
        <AutomacoesChecklist
          accountReady={readyQuery.data === true}
          hasAutomation={automations.length > 0}
          hasFirstDm={automations.some((a) => a.dms_sent_count > 0)}
          canCreate={canCreate && !isAgent}
          onCreate={openCreate}
          onDismiss={dismissChecklist}
        />
      )}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`
Expected: PASS (novos + todos os existentes do arquivo).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/automacoes packages/i18n/locales
git commit -m "feat(automacoes): paywall com pitch na página e checklist de primeiros passos"
```

---

### Task 7: Verificação completa + prova no browser

**Files:** nenhum novo (correções pontuais se a verificação achar algo).

- [ ] **Step 1: Suíte completa local**

```bash
ls node_modules/.deno 2>/dev/null && npm ci   # só se poluído
npm run lint
npm run format
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: tudo verde. `npm run test:functions` não é necessário (nenhuma edge function tocada), mas rodar se o CI local do worktree estiver barato; se rodar, `git checkout -- deno.lock` depois.

- [ ] **Step 2: Verificação visual (dev server + browser)**

Subir o CRM via preview (launch.json/preview_start, nunca Bash) e verificar:
1. Workspace Pro (flag on): `/automacoes` mostra o checklist com os estados corretos; "Dispensar" some e persiste no reload; CTA "Criar" abre o dialog.
2. Simular flag off (ex.: workspace Free em staging, ou mock temporário): nav mostra "Automações" esmaecido com cadeado; clicar leva ao paywall com pitch; sem flash de paywall durante o loading.
3. Dark + light e viewport mobile (MobileNav More sheet com o item locked).

- [ ] **Step 3: Commit final de ajustes (se houver) e push/PR**

Branch nova a partir de `origin/main` (regra da casa), cherry-pick/aplicar os commits do worktree se necessário, `gh pr create` — e re-verificar colisão de prefixo de migrations não se aplica (não há migrations).

- [ ] **Step 4 (operacional, pós-merge/deploy): criar os 2 banners no admin**

Na `BannersPage` do admin (dados, não código), com a copy EXATA do spec (§2), `target_mode='plan'`, dismissível, `ends_at` ~3 semanas:
- `target_plan_ids = {pro, max}` → link `https://mesaas.com.br/automacoes`
- `target_plan_ids = {start, free}` → link `https://mesaas.com.br/configuracao/cobranca`
