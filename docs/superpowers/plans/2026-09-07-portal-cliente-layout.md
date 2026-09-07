# Portal do Cliente — layout das abas do Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promover as cinco sub-abas do Hub do Cliente a rotas próprias no nav lateral, quebrar o `HubTab.tsx` de 1739 linhas em componentes de rota, e redesenhar Acesso, Briefing, Páginas e Ideias para a coluna larga — incluindo a troca do par markdown/preview de Páginas por um editor rich text.

**Arquitetura:** `clienteTabs.model.ts` continua sendo a fonte única do nav e do guard de rota; ganha as cinco sub-abas com chave composta (`hub/acesso`, …) no lugar da entrada `hub`. `App.tsx` ganha um bloco de rotas aninhadas. O `HubTab.tsx` vira cinco arquivos em `pages/cliente-detalhe/hub/`. Em Páginas, o conteúdo passa a ser gravado como um bloco `{ type: 'richtext', doc }` dentro do array `content` que já existe — aditivo, sem migração de banco.

**Tech Stack:** React 19 · React Router v7 (data router) · TanStack Query · TipTap · dnd-kit · Tailwind + shadcn/ui · Vitest + Testing Library · Supabase (Postgres + Edge Functions em Deno)

Spec: [`docs/superpowers/specs/2026-09-07-portal-cliente-layout-design.md`](../specs/2026-09-07-portal-cliente-layout-design.md)

## Global Constraints

- **Nunca usar `useBlocker`.** React Router honra só o último blocker registrado; registrar um desliga em silêncio a troca de versão entre deploys. Há teste contra o `createMemoryRouter` real (`silent-update.router.test.ts`).
- **`richTextExtensions()` do Hub tem que ser superconjunto do que o editor do CRM persiste.** Nó ou marca desconhecido faz o TipTap descartar o documento inteiro, logando aviso em vez de lançar erro — o cliente vê página em branco.
- **Conjunto de extensões do editor de Páginas, fixo:** `StarterKit`, `UnderlineExt`, `TextStyle`, `Color`, `Highlight({ multicolor: true })`, `Link({ openOnClick: false, autolink: true })`, `Placeholder`, `CalloutExtension`. Fora: `MentionNode`, `CommentHighlight`, `InlineImage`, `Youtube`, `IframeExtension`.
- **Sem botão de imagem em Páginas.** Fora de escopo por decisão do spec.
- **Sem migração de banco neste plano.**
- **UI em português.** Sem travessão (—) em texto que o usuário lê: usar ponto, dois-pontos ou "·".
- **`npm run build` NÃO é o typecheck.** O CI roda quatro `tsc` separados. Antes de qualquer push: `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`.
- **Antes de push:** `npm run lint`, `npm run format:check`, `npm run test`, `npm run test:functions`.
- **Se uma rodada de teste de edge function acontecer neste worktree**, rode `npm ci` antes de confiar em `tsc`/vitest: `deno test` polui `node_modules`.

---

## File Structure

**Criados** — `apps/crm/src/pages/cliente-detalhe/hub/`

| Arquivo | Responsabilidade |
|---|---|
| `HubRoleGate.tsx` | O `RoleRestrictionNotice` para `agent`, compartilhado pelas cinco rotas |
| `AcessoPage.tsx` | Link do portal, estado, ações, painel "O que o cliente vê" |
| `BriefingPage.tsx` | Rail de briefings/seções + perguntas em duas colunas |
| `MarcaPage.tsx` | O `BrandEditor` de hoje, movido sem mudança de comportamento |
| `PaginasPage.tsx` | Rail de páginas + editor rich text |
| `IdeiasPage.tsx` | Chips de contagem + grade de cards |
| `pageEditorSchema.ts` | O array de extensões TipTap. Fonte única para o editor, o conversor e o script |
| `PaginaRichTextEditor.tsx` | O editor TipTap e sua barra |
| `pageContent.ts` | Conversão markdown legado ↔ doc do TipTap, e leitura/escrita do bloco |
| `usePortalFill.ts` | Hook do painel de preenchimento da aba Acesso |
| `usePageDraft.ts` | Rascunho não salvo de página em `localStorage` |

**Modificados**

| Arquivo | Mudança |
|---|---|
| `apps/crm/src/pages/cliente-detalhe/clienteTabs.model.ts` | Entrada `hub` → cinco sub-abas, grupo `portal` |
| `apps/crm/src/App.tsx` | Bloco de rotas aninhadas sob `hub` |
| `apps/crm/src/store/hub.ts` | `display_order` na criação, reordenação, desempate |
| `packages/i18n/locales/{pt,en}/clients.json` | Cinco `detail.tabs.*` + `detail.tabGroups.portal` |
| `apps/hub/src/types.ts` | `HubContentBlock` vira união discriminada |
| `apps/hub/src/pages/PaginaPage.tsx` | `case 'richtext'` |
| `supabase/functions/mcp/content.ts` | `pageContentToMarkdown` entende `richtext` |
| `apps/crm/style.css` | Classes das telas novas |
| `scripts/convert-hub-pages-richtext.ts` | Conversão única das 28 páginas |

**Removidos:** `apps/crm/src/pages/cliente-detalhe/tabs/HubClienteTab.tsx`, `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`

---

### Task 1: Modelo de abas, grupo novo e traduções

O modelo é a fonte única do nav **e** do guard de rota. Ele vai primeiro porque tudo depende dele, e é onde os testes existentes quebram.

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/clienteTabs.model.ts`
- Modify: `packages/i18n/locales/pt/clients.json`, `packages/i18n/locales/en/clients.json`
- Test: `apps/crm/src/pages/cliente-detalhe/__tests__/clienteTabs.model.test.ts`

**Interfaces:**
- Consumes: nada (primeira task)
- Produces: `ClienteTabKey` passa a incluir `'hub/acesso' | 'hub/briefing' | 'hub/marca' | 'hub/paginas' | 'hub/ideias'` e **deixa de incluir** `'hub'`. `ClienteTabGroup` ganha `'portal'`. `CLIENTE_TABS`, `canAccessClienteTab`, `canAccessClienteTabRole`, `visibleClienteTabs`, `financeiroTabGuardOutcome` mantêm assinatura idêntica.

- [ ] **Step 1: Atualizar o teste existente para o contrato novo**

O teste de hoje afirma sete abas com `['hub', 'gestao']`. Substitua os dois primeiros blocos em `clienteTabs.model.test.ts`:

```ts
describe('CLIENTE_TABS', () => {
  it('declares the eleven tabs, grouped, in order', () => {
    expect(CLIENTE_TABS.map((t) => [t.key, t.group])).toEqual([
      ['visao-geral', 'cliente'],
      ['entregas', 'cliente'],
      ['redes-sociais', 'canais'],
      ['relatorios', 'canais'],
      ['hub/acesso', 'portal'],
      ['hub/briefing', 'portal'],
      ['hub/marca', 'portal'],
      ['hub/paginas', 'portal'],
      ['hub/ideias', 'portal'],
      ['arquivos', 'gestao'],
      ['financeiro', 'gestao'],
    ]);
  });

  it('no longer declares a bare hub tab', () => {
    expect(CLIENTE_TABS.some((t) => t.key === 'hub')).toBe(false);
  });
});
```

E no bloco `visibleClienteTabs`, troque a lista de sete pela de onze e, no teste do `agent`, troque `expect(keys).toContain('hub')` por `expect(keys).toContain('hub/marca')`.

No bloco `canAccessClienteTab`, troque o teste "allows visao-geral/entregas/redes-sociais/hub/arquivos to every role" por:

```ts
it('allows every non-restricted tab to every role, sub-abas do portal incluídas', () => {
  for (const key of [
    'visao-geral', 'entregas', 'redes-sociais', 'arquivos',
    'hub/acesso', 'hub/briefing', 'hub/marca', 'hub/paginas', 'hub/ideias',
  ]) {
    expect(canAccessClienteTab(key, 'agent', false)).toBe(true);
  }
});
```

- [ ] **Step 2: Adicionar o teste de i18n**

No fim de `clienteTabs.model.test.ts`:

```ts
import pt from '../../../../../../packages/i18n/locales/pt/clients.json';
import en from '../../../../../../packages/i18n/locales/en/clients.json';

function lookup(bundle: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>(
    (acc, k) => (acc as Record<string, unknown> | undefined)?.[k],
    bundle,
  );
}

describe('i18n coverage', () => {
  it('has a pt and en string for every tab label and group label', () => {
    for (const tab of CLIENTE_TABS) {
      expect(lookup(pt, tab.labelKey), `pt ${tab.labelKey}`).toBeTypeOf('string');
      expect(lookup(en, tab.labelKey), `en ${tab.labelKey}`).toBeTypeOf('string');
    }
    for (const key of Object.values(CLIENTE_TAB_GROUP_LABELS)) {
      expect(lookup(pt, key), `pt ${key}`).toBeTypeOf('string');
      expect(lookup(en, key), `en ${key}`).toBeTypeOf('string');
    }
  });
});
```

Adicione `CLIENTE_TAB_GROUP_LABELS` ao import do topo do arquivo.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/clienteTabs.model.test.ts`
Expected: FAIL — a lista tem `'hub'` e não tem as cinco sub-abas.

- [ ] **Step 4: Atualizar o modelo**

Em `clienteTabs.model.ts`, importe os ícones `KeyRound`, `ClipboardList`, `Palette`, `FileText` e `Lightbulb` de `lucide-react` (mantenha `Globe` fora — a aba `hub` sumiu). Troque o tipo:

```ts
export type ClienteTabKey =
  | 'visao-geral'
  | 'entregas'
  | 'redes-sociais'
  | 'relatorios'
  | 'hub/acesso'
  | 'hub/briefing'
  | 'hub/marca'
  | 'hub/paginas'
  | 'hub/ideias'
  | 'arquivos'
  | 'financeiro';

export type ClienteTabGroup = 'cliente' | 'canais' | 'portal' | 'gestao';
```

Substitua a entrada `hub` de `CLIENTE_TABS` por cinco entradas, **antes** de `arquivos` (a adjacência por grupo é contrato testado):

```ts
  { key: 'hub/acesso',   group: 'portal', icon: KeyRound,      labelKey: 'detail.tabs.hubAcesso',   roles: ALL },
  { key: 'hub/briefing', group: 'portal', icon: ClipboardList, labelKey: 'detail.tabs.hubBriefing', roles: ALL },
  { key: 'hub/marca',    group: 'portal', icon: Palette,       labelKey: 'detail.tabs.hubMarca',    roles: ALL },
  { key: 'hub/paginas',  group: 'portal', icon: FileText,      labelKey: 'detail.tabs.hubPaginas',  roles: ALL },
  { key: 'hub/ideias',   group: 'portal', icon: Lightbulb,     labelKey: 'detail.tabs.hubIdeias',   roles: ALL },
```

E em `CLIENTE_TAB_GROUP_LABELS` adicione `portal: 'detail.tabGroups.portal'`, entre `canais` e `gestao`.

Nenhuma função muda: elas já operam sobre `CLIENTE_TABS` genericamente.

- [ ] **Step 5: Adicionar as traduções**

Em `packages/i18n/locales/pt/clients.json`, dentro de `detail.tabGroups` adicione `"portal": "Portal do cliente"`, e dentro de `detail.tabs`:

```json
      "hubAcesso": "Acesso",
      "hubBriefing": "Briefing",
      "hubMarca": "Marca",
      "hubPaginas": "Páginas",
      "hubIdeias": "Ideias"
```

Em `packages/i18n/locales/en/clients.json`, o mesmo com `"portal": "Client portal"`, `"hubAcesso": "Access"`, `"hubBriefing": "Briefing"`, `"hubMarca": "Brand"`, `"hubPaginas": "Pages"`, `"hubIdeias": "Ideas"`.

Mantenha a chave `detail.tabs.hub` antiga se ela existir: removê-la é limpeza de outro PR e não custa nada agora.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/clienteTabs.model.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/clienteTabs.model.ts \
        apps/crm/src/pages/cliente-detalhe/__tests__/clienteTabs.model.test.ts \
        packages/i18n/locales/pt/clients.json packages/i18n/locales/en/clients.json
git commit -m "feat(portal): sub-abas do hub como entradas do modelo de abas"
```

---

### Task 2: Rotas aninhadas, guard e quebra do HubTab

Movimento mecânico: as cinco telas saem do arquivo de 1739 linhas **sem nenhuma mudança de comportamento**. O redesenho vem nas tasks seguintes. Manter as duas coisas separadas é o que torna o diff revisável.

**Files:**
- Modify: `apps/crm/src/App.tsx`, `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`, `apps/crm/src/components/guide/guideContent.tsx`
- Create: `apps/crm/src/pages/cliente-detalhe/hub/{HubRoleGate,AcessoPage,BriefingPage,MarcaPage,PaginasPage,IdeiasPage}.tsx`
- Delete: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`, `apps/crm/src/pages/cliente-detalhe/tabs/HubClienteTab.tsx`
- Test: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalhePage.test.tsx`, `.../ClienteDetalheNav.test.tsx`, `apps/crm/src/components/guide/__tests__/guideContent.test.ts`

**Interfaces:**
- Consumes: `CLIENTE_TABS` da Task 1
- Produces: cada página exporta `default function <Nome>Page()` e lê `{ clienteId, cliente }` de `useOutletContext<ClienteDetalheOutletContext>()`. `HubRoleGate` exporta `function HubRoleGate({ children }: { children: React.ReactNode })`, que devolve o `RoleRestrictionNotice` quando `workspaceRole === 'agent'` e `children` caso contrário.

- [ ] **Step 1: Escrever os testes de rota**

Em `ClienteDetalhePage.test.tsx`, o harness declara as rotas filhas por volta da linha 83. Troque `<Route path="hub" element={<div>conteudo hub</div>} />` por:

```tsx
<Route path="hub">
  <Route index element={<Navigate to="acesso" replace />} />
  <Route path="acesso" element={<div>conteudo acesso</div>} />
  <Route path="marca" element={<div>conteudo marca</div>} />
</Route>
```

E o teste "renders the seven tabs" vira "renders the eleven tabs". Adicione:

```tsx
describe('sub-abas do portal', () => {
  it('redireciona /hub para /hub/acesso', async () => {
    renderAt('/clientes/42/hub');
    expect(await screen.findByText('conteudo acesso')).toBeInTheDocument();
  });

  it('renderiza uma sub-aba diretamente pela URL', async () => {
    renderAt('/clientes/42/hub/marca');
    expect(await screen.findByText('conteudo marca')).toBeInTheDocument();
  });

  it('redireciona sub-aba desconhecida para visao-geral', async () => {
    renderAt('/clientes/42/hub/bogus');
    expect(await screen.findByText('conteudo visao-geral')).toBeInTheDocument();
  });
});
```

Use o mesmo helper de render das outras suítes do arquivo (`renderAt` ou equivalente já existente) e importe `Navigate` de `react-router-dom` no harness.

Em `ClienteDetalheNav.test.tsx`, o teste de links espera `'/clientes/42/hub'`. Troque pelos cinco: `/clientes/42/hub/acesso`, `/hub/briefing`, `/hub/marca`, `/hub/paginas`, `/hub/ideias`, nas posições entre `relatorios` e `arquivos`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/`
Expected: FAIL — a rota `hub/marca` não existe.

- [ ] **Step 3: Corrigir o guard para o caminho `hub` puro**

Para os caminhos aninhados o guard já funciona: ele extrai o caminho **inteiro** (`hub/marca`) e compara com `CLIENTE_TABS.some((tab) => tab.key === current)`, e a Task 1 pôs `'hub/marca'` como chave.

**Mas `/clientes/:id/hub` sozinho quebra.** `current` vira `'hub'`, que não está mais em `CLIENTE_TABS`, então o guard devolve `<Navigate to=".../visao-geral">` **antes** do `<Outlet>` montar — a rota `index` com `<Navigate to="acesso">` nunca chega a rodar. Sem isto, o redirect prometido no spec não existe e links antigos param de levar ao portal.

Adicione, **antes** da checagem de segmento desconhecido:

```tsx
  // `hub` deixou de ser aba própria (virou o grupo do nav, cf. clienteTabs.model),
  // então cai na checagem de segmento desconhecido abaixo e iria para visao-geral.
  // A rota `index` de App.tsx não salva: o guard resolve ANTES do Outlet montar.
  if (current === 'hub') {
    return <Navigate to={`/clientes/${clienteId}/hub/acesso`} replace />;
  }
```

E atualize o comentário logo abaixo, que diz "not one of the seven registered tabs" — agora são onze.

Teste, junto dos da Step 1:

```tsx
it('redireciona /hub para /hub/acesso mesmo sem a rota index', async () => {
  renderAt('/clientes/42/hub');
  expect(await screen.findByText('conteudo acesso')).toBeInTheDocument();
});
```

O `financeiro` não muda: `current === 'financeiro'` continua correto.

- [ ] **Step 3b: Consertar o CTA do guia de primeiros passos**

`apps/crm/src/components/guide/guideContent.tsx:133` usa `clienteDeepLink('hub')` no CTA "Gere o link do Hub". Com o redirect da Step 3 ele volta a funcionar, mas passa a depender de um salto extra. Aponte direto:

```tsx
          to: clienteDeepLink('hub/acesso'),
```

E em `apps/crm/src/components/guide/__tests__/guideContent.test.ts:42`, a asserção afirma `'/clientes/7/hub'` e **continua passando** hoje — ou seja, a suíte não protege esse link. Atualize para `'/clientes/7/hub/acesso'`.

- [ ] **Step 4: Criar o HubRoleGate**

`apps/crm/src/pages/cliente-detalhe/hub/HubRoleGate.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';

/**
 * As cinco rotas do portal têm `roles: ALL` de propósito: um `agent` chega na
 * URL e vê o aviso, em vez de ser redirecionado pelo guard. Este componente é
 * onde essa checagem mora, para não repetir o bloco cinco vezes.
 */
export function HubRoleGate({ children }: { children: ReactNode }) {
  const { workspaceRole } = useAuth();
  const { t } = useTranslation('clients');

  if (workspaceRole === 'agent') {
    return (
      <RoleRestrictionNotice
        title={t('detail.clientHubRestrictedTitle')}
        description={t('detail.clientHubRestrictedDesc')}
      />
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 5: Mover as cinco telas, sem mudar comportamento**

Para cada uma, crie o arquivo em `hub/` com este esqueleto, movendo o corpo do componente correspondente de `HubTab.tsx` **literalmente** (incluindo os comentários explicativos, que documentam decisões reais):

```tsx
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HubRoleGate } from './HubRoleGate';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

export default function MarcaPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
  const { data: brandData } = useQuery({
    queryKey: ['hub-brand-crm', clienteId],
    queryFn: () => getHubBrand(clienteId),
  });

  if (!cliente.conta_id) return null;

  return (
    <HubRoleGate>
      {/* corpo do BrandEditor, movido de HubTab.tsx */}
    </HubRoleGate>
  );
}
```

Distribuição das queries que hoje vivem no topo do `HubTab`:

| Query | Vai para |
|---|---|
| `['hub-token', clienteId]` | `AcessoPage` |
| `['workspace-slug']` (hoje em `HubClienteTab`) | `AcessoPage` — é a única que monta a URL do portal |
| `['hub-brand-crm', clienteId]` | `MarcaPage` |
| `['hub-pages-crm', clienteId]` | `PaginasPage` |
| `getIdeias({ cliente_id })` | `IdeiasPage` (já é local) |
| briefing | `BriefingPage` (já é local) |

`mapTokenError` e `downloadTextFile` vão junto com quem usa: `mapTokenError` para `AcessoPage`, `downloadTextFile` para `BriefingPage`. `mdComponents` vai para `PaginasPage` — some na Task 11, quando o markdown sai.

Cada página ganha seu próprio cabeçalho, no lugar do card e das pills:

```tsx
<header className="hub-page__head">
  <div>
    <h2 className="hub-page__title">Marca</h2>
    <p className="hub-page__sub">Cores, fontes e referências da marca do cliente.</p>
  </div>
</header>
```

- [ ] **Step 6: Ligar as rotas**

Em `App.tsx`, troque a linha `<Route path="hub" element={<ClienteHubTab />} />` por:

```tsx
<Route path="hub">
  <Route index element={<Navigate to="acesso" replace />} />
  <Route path="acesso" element={<ClienteHubAcesso />} />
  <Route path="briefing" element={<ClienteHubBriefing />} />
  <Route path="marca" element={<ClienteHubMarca />} />
  <Route path="paginas" element={<ClienteHubPaginas />} />
  <Route path="ideias" element={<ClienteHubIdeias />} />
</Route>
```

Os `lazy()` no topo do arquivo: remova `ClienteHubTab` e adicione os cinco, apontando para `./pages/cliente-detalhe/hub/<Nome>Page`.

Mantenha o `<Route path="*" element={null} />` do bloco: o comentário dele explica que existe para o branch `/clientes/:id` casar em vez de cair no 404 de topo.

- [ ] **Step 7: Apagar os arquivos antigos**

```bash
git rm apps/crm/src/pages/cliente-detalhe/HubTab.tsx \
       apps/crm/src/pages/cliente-detalhe/tabs/HubClienteTab.tsx
```

`HubTab.test.tsx` cobre as telas movidas: divida-o em suítes por página em `hub/__tests__/`, mantendo cada asserção. Nenhuma cobertura pode ser perdida nesta task — se um teste não fizer mais sentido, ele vira teste da página nova, não é deletado.

- [ ] **Step 8: Rodar tudo e confirmar que passa**

```bash
npx vitest run apps/crm/src/pages/cliente-detalhe/
npx tsc -p apps/crm/tsconfig.json --noEmit
```
Expected: PASS nos dois.

- [ ] **Step 9: Commit**

```bash
git add -A apps/crm/src/pages/cliente-detalhe apps/crm/src/App.tsx
git commit -m "refactor(portal): quebra HubTab em cinco rotas do nav lateral"
```

---

### Task 3: Acesso

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/hub/AcessoPage.tsx`
- Create: `apps/crm/src/pages/cliente-detalhe/hub/usePortalFill.ts`
- Modify: `apps/crm/src/store/hub.ts`, `apps/crm/style.css`
- Test: `apps/crm/src/pages/cliente-detalhe/hub/__tests__/AcessoPage.test.tsx`

**Interfaces:**
- Consumes: `HubRoleGate` da Task 2
- Produces: `getPortalFill(clienteId: number): Promise<PortalFill>` em `store/hub.ts`, com
  `interface PortalFill { briefingTotal: number; briefingAnswered: number; brandFiles: number; hasBrand: boolean; pages: number; newIdeasWithoutReply: number }`

- [ ] **Step 1: Escrever o teste dos predicados**

O harness segue o padrão das suítes vizinhas (mock do `useAuth`, `MemoryRouter`), mais um duplo do resultado da query:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PortalFill } from '@/store';

const ZERO: PortalFill = {
  briefingTotal: 0, briefingAnswered: 0, brandFiles: 0,
  hasBrand: false, pages: 0, newIdeasWithoutReply: 0,
};

function renderAcesso(q: { fill?: PortalFill; isLoading?: boolean; isError?: boolean }) {
  mockedUsePortalFill.mockReturnValue({
    data: q.fill,
    isLoading: q.isLoading ?? false,
    isError: q.isError ?? false,
  } as never);
  return render(
    <MemoryRouter initialEntries={['/clientes/42/hub/acesso']}>
      <AcessoPage />
    </MemoryRouter>,
  );
}

describe('painel "O que o cliente vê"', () => {
  it('mostra traço, não zero, enquanto carrega', () => {
    renderAcesso({ fill: undefined, isLoading: true });
    expect(screen.getByTestId('fill-paginas')).toHaveTextContent('—');
    expect(screen.queryByText('vazia')).not.toBeInTheDocument();
  });

  it('mostra "vazia" só quando a contagem resolvida é zero', () => {
    renderAcesso({ fill: { ...ZERO, pages: 0, briefingTotal: 12, briefingAnswered: 8 } });
    expect(screen.getByTestId('fill-paginas')).toHaveTextContent('vazia');
    expect(screen.getByTestId('fill-briefing')).toHaveTextContent('8 de 12 respondidas');
  });

  it('não vira link quando a query falha', () => {
    renderAcesso({ fill: undefined, isError: true });
    expect(screen.getByTestId('fill-paginas').querySelector('a')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/AcessoPage.test.tsx`
Expected: FAIL — `getPortalFill` não existe.

- [ ] **Step 3: Implementar a query**

Em `store/hub.ts`:

```ts
export interface PortalFill {
  briefingTotal: number;
  briefingAnswered: number;
  brandFiles: number;
  hasBrand: boolean;
  pages: number;
  newIdeasWithoutReply: number;
}

/** Predicados fixados no spec. Contagens por `head: true` — nenhuma linha trafega. */
export async function getPortalFill(clienteId: number): Promise<PortalFill> {
  const countOf = async (
    table: string,
    apply: (q: any) => any = (q) => q,
  ): Promise<number> => {
    const { count, error } = await apply(
      supabase.from(table).select('id', { count: 'exact', head: true }).eq('cliente_id', clienteId),
    );
    if (error) throw error;
    return count ?? 0;
  };

  const [briefingTotal, briefingAnswered, brandFiles, pages, newIdeasWithoutReply, brand] =
    await Promise.all([
      countOf('hub_briefing_questions'),
      countOf('hub_briefing_questions', (q) => q.not('answer', 'is', null).neq('answer', '')),
      countOf('hub_brand_files'),
      countOf('hub_pages'),
      countOf('ideias', (q) => q.eq('status', 'nova').is('comentario_agencia', null)),
      supabase.from('hub_brand').select('id').eq('cliente_id', clienteId).maybeSingle(),
    ]);

  return {
    briefingTotal,
    briefingAnswered,
    brandFiles,
    pages,
    newIdeasWithoutReply,
    hasBrand: brand.data != null,
  };
}
```

Lança em erro de propósito: a query tem que ficar inconclusiva, nunca tratar falha como zero.

- [ ] **Step 4: Montar a tela**

Duas colunas (`.hub-acesso__grid`, `minmax(0,1fr) 300px`, coluna única abaixo de 900px). À esquerda o card do link com o estado como **primeira linha** (chip Ativo/Inativo + data de expiração), a URL, e os botões abaixo — `Estender +1 ano` continua condicionado a `showRescue`. Abaixo, a linha de ideias novas sem resposta. À direita, o painel com uma linha por seção.

Cada linha é `<Link to="../briefing" relative="path">` (as rotas são irmãs). Renderização do valor:

```tsx
function FillValue({ query, children }: { query: UseQueryResult<PortalFill>; children: ReactNode }) {
  if (query.isLoading || query.isError) return <span className="hub-fill__pending">—</span>;
  return <>{children}</>;
}
```

Zero resolvido renderiza `<span className="hub-fill__empty">vazia</span>`.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/AcessoPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Verificar no navegador**

Abra `/clientes/<id>/hub/acesso` no preview e confira duas coisas que o jsdom não avalia: as duas colunas colapsam abaixo de 900px, e o painel da direita não estoura a largura com número grande.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/hub apps/crm/src/store/hub.ts apps/crm/style.css
git commit -m "feat(portal): painel de preenchimento na aba Acesso"
```

---

### Task 4: Briefing

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/hub/BriefingPage.tsx`, `apps/crm/style.css`
- Test: `apps/crm/src/pages/cliente-detalhe/hub/__tests__/BriefingPage.test.tsx`

**Interfaces:**
- Consumes: `HubRoleGate` (Task 2)
- Produces: nada consumido por outras tasks

- [ ] **Step 1: Escrever o teste dos filtros e do progresso**

```tsx
const QUESTIONS = [
  { id: 'a', question: 'P1', answer: 'R1', section: 'Negócio', display_order: 0 },
  { id: 'b', question: 'P2', answer: null, section: 'Negócio', display_order: 1 },
  { id: 'c', question: 'P3', answer: '',   section: 'Público', display_order: 0 },
];

it('conta respondidas tratando string vazia como não respondida', () => {
  renderBriefing(QUESTIONS);
  expect(screen.getByTestId('chip-todas')).toHaveTextContent('3');
  expect(screen.getByTestId('chip-sem-resposta')).toHaveTextContent('2');
  expect(screen.getByTestId('chip-respondidas')).toHaveTextContent('1');
});

it('filtra para as não respondidas ao clicar no chip', async () => {
  renderBriefing(QUESTIONS);
  await userEvent.click(screen.getByTestId('chip-sem-resposta'));
  expect(screen.getByText('P2')).toBeInTheDocument();
  expect(screen.queryByText('P1')).not.toBeInTheDocument();
});

it('mostra progresso por seção no rail', () => {
  renderBriefing(QUESTIONS);
  expect(screen.getByTestId('secao-Negócio')).toHaveTextContent('1/2');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/BriefingPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Extrair o predicado e implementar**

```ts
/** Resposta vazia é resposta ausente: o cliente pode salvar string vazia pelo portal. */
export function isAnswered(q: { answer: string | null }): boolean {
  return q.answer != null && q.answer.trim() !== '';
}
```

Rail de 250px com a lista de briefings (vertical, no lugar da fita horizontal) e o índice de seções com `respondidas/total`. À direita, os chips de filtro com contagem, a barra de progresso, e as perguntas em grade de três colunas (`250px minmax(0,1fr) 78px`). O `<select>` de filtro sai.

**Não toque** no `DndContext`/`SortableContext`, nos templates, na importação de CSV nem na exportação: só a moldura muda.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/BriefingPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Verificar o arrastar no navegador**

dnd-kit dentro de um grid novo é exatamente o tipo de coisa que jsdom não pega. Arraste uma pergunta dentro de uma seção e confirme que a ordem persiste após recarregar.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/hub apps/crm/style.css
git commit -m "feat(portal): briefing em duas colunas com progresso e filtros"
```

---

### Task 5: Ideias

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/hub/IdeiasPage.tsx`, `apps/crm/style.css`
- Test: `apps/crm/src/pages/cliente-detalhe/hub/__tests__/IdeiasPage.test.tsx`

**Interfaces:**
- Consumes: `HubRoleGate` (Task 2)
- Produces: nada

- [ ] **Step 1: Escrever o teste**

```tsx
it('mostra a contagem por estado nos chips', () => {
  renderIdeias([
    { id: 1, status: 'nova', titulo: 'A', descricao: 'd', ideia_reactions: [], created_at: NOW },
    { id: 2, status: 'nova', titulo: 'B', descricao: 'd', ideia_reactions: [], created_at: NOW },
    { id: 3, status: 'aprovada', titulo: 'C', descricao: 'd', ideia_reactions: [], created_at: NOW },
  ]);
  expect(screen.getByTestId('chip-nova')).toHaveTextContent('2');
  expect(screen.getByTestId('chip-aprovada')).toHaveTextContent('1');
  expect(screen.getByTestId('chip-todas')).toHaveTextContent('3');
});

it('não renderiza chip de estado sem nenhuma ideia', () => {
  renderIdeias([{ id: 1, status: 'nova', titulo: 'A', descricao: 'd', ideia_reactions: [], created_at: NOW }]);
  expect(screen.queryByTestId('chip-descartada')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/IdeiasPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

Troque o `<select>` por chips clicáveis com contagem, derivados da lista já carregada (nenhuma query nova). Chip com contagem zero não renderiza. A lista vira grade de duas colunas (`repeat(auto-fill, minmax(320px, 1fr))`), com a descrição em `line-clamp-3` no lugar de `line-clamp-1`.

O `IdeiaDrawer` continua sendo onde a interação acontece, incluindo o truque de resolver a linha fresca da lista (`ideias.find(...)`) para o drawer não ficar com snapshot velho — mantenha esse bloco como está.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/IdeiasPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/hub apps/crm/style.css
git commit -m "feat(portal): ideias em grade com contadores por estado"
```

---

### Task 6: `HubContentBlock` como união discriminada e o renderer do Hub

Os tipos vão antes do editor: sem isso nada do lado do Hub compila.

**Files:**
- Modify: `apps/hub/src/types.ts`, `apps/hub/src/pages/PaginaPage.tsx`
- Test: `apps/hub/src/pages/__tests__/PaginaPage.test.tsx`

**Interfaces:**
- Consumes: nada
- Produces: `HubContentBlock` vira união discriminada; `HubRichTextBlock = { type: 'richtext'; doc: Record<string, unknown> }`

- [ ] **Step 1: Escrever o teste do renderer**

```tsx
it('renderiza um bloco richtext pelo RichTextContent', () => {
  renderPagina({
    content: [
      {
        type: 'richtext',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Olá cliente' }] }],
        },
      },
    ],
  });
  expect(screen.getByText('Olá cliente')).toBeInTheDocument();
});

it('continua renderizando os blocos legados', () => {
  renderPagina({ content: [{ type: 'markdown', content: '## Título\n\nCorpo' }] });
  expect(screen.getByRole('heading', { name: 'Título' })).toBeInTheDocument();
  expect(screen.getByText('Corpo')).toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run apps/hub/src/pages/__tests__/PaginaPage.test.tsx`
Expected: FAIL — `type: 'richtext'` não é atribuível a `HubContentBlock`.

- [ ] **Step 3: Trocar o tipo**

Em `apps/hub/src/types.ts`, substitua a interface por uma união. O campo `content` era obrigatório e `richtext` não tem:

```ts
export interface HubLegacyBlock {
  type: 'paragraph' | 'heading' | 'image' | 'link' | 'markdown';
  content: string;
  href?: string;
  level?: 1 | 2 | 3;
}

export interface HubRichTextBlock {
  type: 'richtext';
  /** Documento ProseMirror do TipTap. Lido por `RichTextContent`. */
  doc: Record<string, unknown>;
}

export type HubContentBlock = HubLegacyBlock | HubRichTextBlock;
```

- [ ] **Step 4: Adicionar o caso no renderer**

Em `PaginaPage.tsx`, primeiro caso do `switch` em `renderBlock`:

```tsx
    case 'richtext':
      return <RichTextContent key={i} content={block.doc} className="hub-richtext" />;
```

Importe `RichTextContent` de `../components/RichTextContent`. Os demais `case` acessam `block.content`; o TypeScript agora estreita corretamente porque `richtext` sai da união no primeiro caso. Se algum acesso reclamar, é sinal de que falta o `return` no caso novo.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
npx vitest run apps/hub/src/pages/__tests__/PaginaPage.test.tsx
npx tsc -p apps/hub/tsconfig.json --noEmit
```
Expected: PASS nos dois.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/pages/PaginaPage.tsx apps/hub/src/pages/__tests__/
git commit -m "feat(hub): bloco richtext nas páginas do portal"
```

---

### Task 7: `pageContentToMarkdown` entende `richtext`

**Files:**
- Modify: `supabase/functions/mcp/content.ts`
- Test: `supabase/functions/__tests__/mcp_content_test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `pageContentToMarkdown` mantém assinatura `(content: unknown) => string`

- [ ] **Step 1: Escrever o teste (Deno)**

```ts
Deno.test("pageContentToMarkdown serializa um bloco richtext", () => {
  const md = pageContentToMarkdown([
    {
      type: "richtext",
      doc: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Prazos" }] },
          { type: "paragraph", content: [{ type: "text", text: "Até 2 dias úteis." }] },
        ],
      },
    },
  ]);
  assertEquals(md, "## Prazos\n\nAté 2 dias úteis.");
});

Deno.test("pageContentToMarkdown ignora richtext malformado sem lançar", () => {
  assertEquals(pageContentToMarkdown([{ type: "richtext" }]), "");
  assertEquals(pageContentToMarkdown([{ type: "richtext", doc: null }]), "");
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx deno test supabase/functions/__tests__/mcp_content_test.ts --allow-env`
Expected: FAIL — devolve string vazia no primeiro teste.

- [ ] **Step 3: Implementar**

O bloco `richtext` não tem `content: string`, então cai no `default` e some. Adicione **antes** do `switch`, um caso próprio:

```ts
      case "richtext": {
        const doc = b.doc;
        if (typeof doc !== "object" || doc === null) break;
        const text = proseMirrorToMarkdown(doc as Record<string, unknown>);
        if (text) parts.push(text);
        break;
      }
```

E a função pura, no mesmo arquivo. Mantenha o contrato de "falha fechada" do módulo: nada de lançar em entrada malformada.

```ts
/**
 * Serialização mínima de um documento ProseMirror para markdown, para consumo
 * de agentes. Cobre só o conjunto de extensões que o editor de Páginas pode
 * persistir (ver o spec) — nó desconhecido vira o texto dos filhos, nunca erro.
 */
function proseMirrorToMarkdown(doc: Record<string, unknown>): string {
  const blocks: string[] = [];

  function inline(node: any): string {
    if (typeof node?.text === "string") {
      let out = node.text;
      for (const m of Array.isArray(node.marks) ? node.marks : []) {
        if (m?.type === "bold") out = `**${out}**`;
        else if (m?.type === "italic") out = `*${out}*`;
        else if (m?.type === "code") out = `\`${out}\``;
        else if (m?.type === "link" && typeof m?.attrs?.href === "string") {
          out = `[${out}](${m.attrs.href})`;
        }
      }
      return out;
    }
    return (Array.isArray(node?.content) ? node.content : []).map(inline).join("");
  }

  function walk(node: any) {
    const kids: any[] = Array.isArray(node?.content) ? node.content : [];
    switch (node?.type) {
      case "heading": {
        const lvl = Math.min(6, Math.max(1, Math.trunc(Number(node?.attrs?.level)) || 1));
        blocks.push(`${"#".repeat(lvl)} ${inline(node)}`);
        break;
      }
      case "paragraph":
      case "callout": {
        const t = inline(node);
        if (t) blocks.push(t);
        break;
      }
      case "blockquote":
        for (const k of kids) {
          const t = inline(k);
          if (t) blocks.push(`> ${t}`);
        }
        break;
      case "bulletList":
        kids.forEach((li) => blocks.push(`- ${inline(li)}`));
        break;
      case "orderedList":
        kids.forEach((li, i) => blocks.push(`${i + 1}. ${inline(li)}`));
        break;
      default:
        kids.forEach(walk);
    }
  }

  walk(doc);
  return blocks.join("\n\n");
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npx deno test supabase/functions/__tests__/mcp_content_test.ts --allow-env
npm ci   # deno suja node_modules; sem isso os tsc/vitest seguintes mentem
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/content.ts supabase/functions/__tests__/
git commit -m "feat(mcp): serializa bloco richtext de páginas para markdown"
```

---

### Task 8: Schema do editor, contrato com o Hub, e conversor markdown → TipTap

Dois módulos puros, sem React. O schema vem antes do componente de propósito: o conversor (Task 8) e o editor (Task 9) precisam do **mesmo** array de extensões, e se ele morasse no componente teríamos import circular. Aqui ele é dado, não UI.

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/hub/pageEditorSchema.ts`
- Create: `apps/crm/src/pages/cliente-detalhe/hub/pageContent.ts`
- Modify: `package.json`
- Test: `apps/crm/src/pages/cliente-detalhe/hub/__tests__/schemaContract.test.ts`, `.../pageContent.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `pageEditorExtensions(): AnyExtension[]` em `pageEditorSchema.ts` — consumido pelo conversor **e** pelo editor da Task 9
  - `readPageDoc(content: unknown): Record<string, unknown>` — doc do bloco `richtext`, ou converte o legado, ou doc vazio
  - `writePageContent(doc: Record<string, unknown>): [{ type: 'richtext'; doc: Record<string, unknown> }]`
  - `isLegacyContent(content: unknown): boolean`

- [ ] **Step 0: Instalar as duas dependências que faltam**

Nem `marked` nem `@tiptap/html` estão no projeto (`npm ls marked @tiptap/html` volta vazio). `remark-parse`/`remark-rehype` existem só como dependência transitiva do `react-markdown` — importar transitivo direto é frágil e não vale.

```bash
npm install --save-exact marked@16.4.1 @tiptap/html@3.22.4
```

Versão exata nos dois, como já é o padrão de `@tiptap/extension-text-align` e `@tiptap/suggestion` no `package.json`. `@tiptap/html` tem que casar com o `3.22.x` do resto do TipTap. Se `16.4.1` do `marked` não existir mais, escolha a mais recente com pelo menos duas semanas de idade e mantenha o `--save-exact`.

No script da Task 12, que roda em Node sem DOM, importe de `@tiptap/html/server`.

- [ ] **Step 1: Escrever o teste de contrato de schema**

Este é o teste mais importante do plano: é ele que impede a página em branco no portal.

```ts
import { describe, it, expect } from 'vitest';
import { pageEditorExtensions } from '../pageEditorSchema';
import { richTextExtensions } from '../../../../../../hub/src/components/RichTextContent';

/**
 * Se o editor do CRM puder persistir um nó ou marca que o Hub não conhece, o
 * TipTap descarta o DOCUMENTO INTEIRO ao ler — o cliente abre a página do
 * portal e vê branco, sem erro em lugar nenhum. Este teste é a única coisa
 * entre esse bug e produção.
 */
describe('contrato de schema entre o editor de Páginas e o leitor do Hub', () => {
  it('todo nó/marca que o editor persiste é conhecido pelo Hub', () => {
    const names = (exts: { name: string }[]) => new Set(exts.map((e) => e.name));
    const editor = names(pageEditorExtensions() as { name: string }[]);
    const hub = names(richTextExtensions() as { name: string }[]);

    const missing = [...editor].filter((n) => !hub.has(n));
    expect(missing, `Hub não conhece: ${missing.join(', ')}`).toEqual([]);
  });

  it('não inclui as extensões deliberadamente fora', () => {
    const names = new Set((pageEditorExtensions() as { name: string }[]).map((e) => e.name));
    for (const banned of ['mention', 'commentHighlight', 'inlineImage', 'youtube', 'iframe']) {
      expect(names.has(banned), `${banned} não pode estar no editor de Páginas`).toBe(false);
    }
  });
});
```

Se o import cruzando apps não resolver pelo `tsconfig` do CRM, aponte para o caminho relativo real a partir do arquivo de teste e confirme com `npx tsc -p apps/crm/tsconfig.json --noEmit`.

- [ ] **Step 2: Implementar o schema**

`pageEditorSchema.ts` — o array das Global Constraints, e nada além:

```ts
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import UnderlineExt from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { CalloutExtension } from '@/pages/entregas/components/CalloutExtension';

/**
 * Fonte única do schema de páginas do portal: o editor (PaginaRichTextEditor),
 * o conversor (pageContent) e o script de migração usam este mesmo array.
 * Mudar aqui sem mudar `richTextExtensions()` do Hub quebra o teste de
 * contrato — de propósito.
 */
export function pageEditorExtensions(): AnyExtension[] {
  return [
    StarterKit,
    UnderlineExt,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false, autolink: true }),
    Placeholder.configure({ placeholder: 'Escreva o conteúdo da página…' }),
    CalloutExtension,
  ];
}
```

- [ ] **Step 3: Escrever os testes do conversor**

```ts
import { describe, it, expect } from 'vitest';
import { readPageDoc, writePageContent, isLegacyContent } from '../pageContent';

describe('readPageDoc', () => {
  it('devolve o doc de um bloco richtext sem tocar nele', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(readPageDoc([{ type: 'richtext', doc }])).toEqual(doc);
  });

  it('converte um bloco markdown', () => {
    const doc = readPageDoc([{ type: 'markdown', content: '## Prazos\n\nAté **2** dias.' }]);
    expect(doc.type).toBe('doc');
    const [h, p] = doc.content as any[];
    expect(h.type).toBe('heading');
    expect(h.attrs.level).toBe(2);
    expect(h.content[0].text).toBe('Prazos');
    expect(p.content.some((n: any) => n.marks?.some((m: any) => m.type === 'bold'))).toBe(true);
  });

  it('converte um bloco paragraph legado', () => {
    const doc = readPageDoc([{ type: 'paragraph', content: 'Texto solto' }]);
    expect((doc.content as any[])[0].content[0].text).toBe('Texto solto');
  });

  it('devolve doc vazio para conteúdo ausente ou malformado', () => {
    for (const bad of [null, undefined, [], 'x', [{}], [{ type: 'richtext' }]]) {
      expect(readPageDoc(bad).type).toBe('doc');
    }
  });

  it('aguenta um documento de ~47k caracteres', () => {
    const big = '## T\n\n' + 'palavra '.repeat(6000);
    expect(big.length).toBeGreaterThan(45000);
    const doc = readPageDoc([{ type: 'markdown', content: big }]);
    expect((doc.content as any[]).length).toBeGreaterThan(1);
  });

  it('não lança em markdown malformado', () => {
    expect(() => readPageDoc([{ type: 'markdown', content: '### [link sem fim](' }])).not.toThrow();
  });
});

describe('isLegacyContent', () => {
  it('é falso para richtext e verdadeiro para os tipos antigos', () => {
    expect(isLegacyContent([{ type: 'richtext', doc: {} }])).toBe(false);
    expect(isLegacyContent([{ type: 'markdown', content: 'x' }])).toBe(true);
    expect(isLegacyContent([{ type: 'paragraph', content: 'x' }])).toBe(true);
    expect(isLegacyContent([])).toBe(false);
  });
});

describe('writePageContent', () => {
  it('embrulha o doc num array de um bloco', () => {
    const doc = { type: 'doc', content: [] };
    expect(writePageContent(doc)).toEqual([{ type: 'richtext', doc }]);
  });
});
```

- [ ] **Step 4: Rodar e confirmar que os dois falham**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/`
Expected: FAIL — `pageContent` não existe.

- [ ] **Step 5: Implementar o conversor**

Markdown → HTML com `marked`, HTML → doc com `generateJSON` do `@tiptap/html`, alimentado pelo array do `pageEditorSchema`.

```ts
import { generateJSON } from '@tiptap/html';
import { marked } from 'marked';
import { pageEditorExtensions } from './pageEditorSchema';

const EMPTY_DOC = { type: 'doc', content: [] } as const;

export function isLegacyContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some(
    (b) => typeof b === 'object' && b !== null && (b as any).type !== 'richtext',
  );
}

export function readPageDoc(content: unknown): Record<string, unknown> {
  if (!Array.isArray(content) || content.length === 0) return { ...EMPTY_DOC };

  const rich = content.find(
    (b: any) => b?.type === 'richtext' && typeof b?.doc === 'object' && b.doc !== null,
  ) as { doc: Record<string, unknown> } | undefined;
  if (rich) return rich.doc;

  const markdown = content
    .map((b: any) => (typeof b?.content === 'string' ? b.content : ''))
    .filter(Boolean)
    .join('\n\n');
  if (!markdown) return { ...EMPTY_DOC };

  try {
    return generateJSON(markdownToHtml(markdown), pageEditorExtensions()) as Record<string, unknown>;
  } catch {
    // Conteúdo malformado nunca pode derrubar o editor: cai para um parágrafo
    // com o texto cru, que o usuário conserta à mão.
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }],
    };
  }
}

export function writePageContent(doc: Record<string, unknown>) {
  return [{ type: 'richtext' as const, doc }];
}
```

`markdownToHtml` fica neste arquivo e é síncrono, para o script da Task 12 importá-lo sem React:

```ts
/** `marked.parse` é síncrono quando não há extensões async registradas. */
function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false, gfm: true }) as string;
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/`
Expected: PASS nos dois arquivos.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/hub/pageEditorSchema.ts \
        apps/crm/src/pages/cliente-detalhe/hub/pageContent.ts \
        apps/crm/src/pages/cliente-detalhe/hub/__tests__/ package.json package-lock.json
git commit -m "feat(portal): schema de páginas com contrato testado e conversor de markdown"
```

---

### Task 9: O componente do editor

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/hub/PaginaRichTextEditor.tsx`
- Test: `apps/crm/src/pages/cliente-detalhe/hub/__tests__/PaginaRichTextEditor.test.tsx`

**Interfaces:**
- Consumes: `pageEditorExtensions()` de `./pageEditorSchema` (Task 8)
- Produces: `<PaginaRichTextEditor doc={Record<string, unknown>} onChange={(doc: Record<string, unknown>) => void} />`

- [ ] **Step 1: Implementar o editor**

```tsx
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { pageEditorExtensions } from './pageEditorSchema';

export function PaginaRichTextEditor({
  doc,
  onChange,
}: {
  doc: Record<string, unknown>;
  onChange: (doc: Record<string, unknown>) => void;
}) {
  const editor = useEditor({
    extensions: pageEditorExtensions(),
    content: doc,
    onUpdate: ({ editor }) => onChange(editor.getJSON() as Record<string, unknown>),
  });
  // …barra fixa + BubbleMenu + <EditorContent editor={editor} />
}
```

O array de extensões vem inteiro do `pageEditorSchema` — **não** monte outro aqui, é o que o teste de contrato da Task 8 guarda. Barra fixa no topo com os controles listados nas Global Constraints, e `BubbleMenu` de `@tiptap/react/menus` na seleção, como o `ArticleEditor` do Admin faz.

**Não** passe `onUploadInlineImage` nem registre `createInlineImageExtension`: imagem está fora de escopo.

- [ ] **Step 2: Escrever e rodar o teste do editor**

```tsx
it('emite o documento a cada edição', async () => {
  const onChange = vi.fn();
  render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={onChange} />);
  await userEvent.type(screen.getByRole('textbox'), 'Olá');
  expect(onChange).toHaveBeenCalled();
  const last = onChange.mock.calls.at(-1)![0];
  expect(JSON.stringify(last)).toContain('Olá');
});
```

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/hub/PaginaRichTextEditor.tsx \
        apps/crm/src/pages/cliente-detalhe/hub/__tests__/
git commit -m "feat(portal): componente do editor rich text de páginas"
```

---

### Task 10: Ordem das páginas

`display_order` existe, é lida pelos dois lados, e **nunca é escrita**. Sem esta task o rail promete uma ordem que não persiste.

**Files:**
- Modify: `apps/crm/src/store/hub.ts`
- Modify: `supabase/functions/hub-pages/handler.ts`
- Test: `apps/crm/src/__tests__/store.hub.test.ts`, `supabase/functions/__tests__/hub-functions_test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `reorderHubPages(clienteId: number, orderedIds: string[]): Promise<void>`; `upsertHubPage` passa a atribuir `display_order` na criação; `getHubPages` desempata por `created_at`

- [ ] **Step 1: Escrever os testes**

```ts
it('atribui max+1 ao criar uma página', async () => {
  mockMaxOrder(3);
  await store.upsertHubPage({ cliente_id: 42, conta_id: C, title: 'Nova', content: [] });
  expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ display_order: 4 }));
});

it('usa 0 quando o cliente ainda não tem páginas', async () => {
  mockMaxOrder(null);
  await store.upsertHubPage({ cliente_id: 42, conta_id: C, title: 'Primeira', content: [] });
  expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ display_order: 0 }));
});

it('não mexe em display_order ao editar uma página existente', async () => {
  await store.upsertHubPage({ id: 'p1', cliente_id: 42, conta_id: C, title: 'X', content: [] });
  expect(updateSpy.mock.calls[0][0]).not.toHaveProperty('display_order');
});

it('renumera 0..n-1 ao reordenar', async () => {
  await store.reorderHubPages(42, ['c', 'a', 'b']);
  expect(upsertSpy).toHaveBeenCalledWith(
    [
      { id: 'c', display_order: 0 },
      { id: 'a', display_order: 1 },
      { id: 'b', display_order: 2 },
    ],
    expect.anything(),
  );
});

it('desempata por created_at na leitura', async () => {
  await store.getHubPages(42);
  expect(orderSpy).toHaveBeenNthCalledWith(1, 'display_order');
  expect(orderSpy).toHaveBeenNthCalledWith(2, 'created_at');
});
```

E no lado Deno, que `hub-pages` aplica o mesmo desempate:

```ts
Deno.test("hub-pages ordena por display_order e desempata por created_at", async () => {
  const calls: string[] = [];
  await handler(reqWithToken(), depsRecordingOrder(calls));
  assertEquals(calls, ["display_order", "created_at"]);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx vitest run apps/crm/src/__tests__/store.hub.test.ts
npx deno test supabase/functions/__tests__/hub-functions_test.ts --allow-env
```
Expected: FAIL nos dois.

- [ ] **Step 3: Implementar**

```ts
export async function upsertHubPage(
  page: Partial<HubPageRow> & { cliente_id: number; conta_id: string },
) {
  if (page.id) {
    // display_order é do fluxo de reordenação, nunca deste caminho: um form
    // antigo não pode reposicionar a página sem querer.
    const { display_order: _ignored, ...rest } = page;
    const { error } = await supabase.from('hub_pages').update(rest).eq('id', page.id);
    if (error) throw error;
    return;
  }

  const { data: last, error: maxError } = await supabase
    .from('hub_pages')
    .select('display_order')
    .eq('cliente_id', page.cliente_id)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) throw maxError;

  const next = last?.display_order == null ? 0 : last.display_order + 1;
  const { error } = await supabase.from('hub_pages').insert({ ...page, display_order: next });
  if (error) throw error;
}

/** Renumera 0..n-1 numa chamada. `orderedIds` é a ordem final do rail. */
export async function reorderHubPages(clienteId: number, orderedIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('hub_pages')
    .upsert(
      orderedIds.map((id, i) => ({ id, display_order: i })),
      { onConflict: 'id' },
    );
  if (error) throw error;
}
```

Em `getHubPages`, encadeie `.order('display_order').order('created_at')`. Em `hub-pages/handler.ts`, o mesmo depois do `.order("display_order")`.

Note que `upsertHubPage` passou a lançar em erro — hoje ele descarta `error` em silêncio, que é como um "Página salva!" aparece para uma escrita recusada.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npx vitest run apps/crm/src/__tests__/store.hub.test.ts
npx deno test supabase/functions/__tests__/hub-functions_test.ts --allow-env
npm ci
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/hub.ts supabase/functions/hub-pages/handler.ts \
        apps/crm/src/__tests__/store.hub.test.ts supabase/functions/__tests__/
git commit -m "feat(portal): ordem persistida das páginas do hub"
```

---

### Task 11: A tela de Páginas

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/hub/PaginasPage.tsx`, `apps/crm/style.css`
- Create: `apps/crm/src/pages/cliente-detalhe/hub/usePageDraft.ts`
- Test: `apps/crm/src/pages/cliente-detalhe/hub/__tests__/PaginasPage.test.tsx`

**Interfaces:**
- Consumes: `readPageDoc`/`writePageContent`/`isLegacyContent` (Task 8), `PaginaRichTextEditor`/`pageEditorExtensions` (Task 9), `reorderHubPages`/`upsertHubPage` (Task 10)
- Produces: `usePageDraft(pageId: string | null)` → `{ draft, saveDraft, clearDraft }`

- [ ] **Step 1: Escrever os testes do rascunho e das saídas**

```tsx
it('arma o beforeunload só com alteração real', async () => {
  const { rerender } = renderPaginas({ page: PAGE });
  expect(fireBeforeUnload().defaultPrevented).toBe(false);
  await typeInEditor('novo texto');
  expect(fireBeforeUnload().defaultPrevented).toBe(true);
});

it('pede confirmação ao trocar de página no rail com alteração pendente', async () => {
  renderPaginas({ pages: [PAGE, OUTRA] });
  await typeInEditor('x');
  await userEvent.click(screen.getByText('Outra página'));
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

it('restaura o rascunho ao reabrir a página', async () => {
  localStorage.setItem('hub-page-draft:p1', JSON.stringify(DOC_ALTERADO));
  renderPaginas({ page: PAGE });
  expect(await screen.findByText(/alterações não salvas/i)).toBeInTheDocument();
});

it('limpa o rascunho depois de salvar', async () => {
  renderPaginas({ page: PAGE });
  await typeInEditor('x');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(localStorage.getItem('hub-page-draft:p1')).toBeNull());
});

it('não usa useBlocker', async () => {
  // useBlocker desliga a troca silenciosa entre deploys: React Router honra só
  // o último blocker registrado. Ver silent-update.router.test.ts.
  const src = await readFile(
    new URL('../PaginasPage.tsx', import.meta.url),
    'utf8',
  );
  expect(src).not.toMatch(/useBlocker/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/hub/__tests__/PaginasPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar o rascunho**

```ts
const KEY = (id: string) => `hub-page-draft:${id}`;

/**
 * `useBlocker` está proibido no projeto, então a estratégia é não bloquear:
 * o rascunho sobrevive a navegar para fora E a fechar a aba, que é mais do
 * que um blocker daria.
 */
export function usePageDraft(pageId: string | null) {
  const draft = useMemo(() => {
    if (!pageId) return null;
    try {
      const raw = localStorage.getItem(KEY(pageId));
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      return null; // aba privativa, cota estourada, JSON corrompido
    }
  }, [pageId]);

  const saveDraft = useCallback(
    (doc: Record<string, unknown>) => {
      if (!pageId) return;
      try {
        localStorage.setItem(KEY(pageId), JSON.stringify(doc));
      } catch {
        /* rascunho é conveniência, nunca pode derrubar a edição */
      }
    },
    [pageId],
  );

  const clearDraft = useCallback(() => {
    if (!pageId) return;
    try {
      localStorage.removeItem(KEY(pageId));
    } catch {
      /* idem */
    }
  }, [pageId]);

  return { draft, saveDraft, clearDraft };
}
```

- [ ] **Step 4: Montar a tela**

Rail de 250px com as páginas (dnd-kit para reordenar, chamando `reorderHubPages` no `onDragEnd`) e o editor à direita, ambos dentro de `.hub-paginas__split`. O `<Dialog>` sai por completo, junto com `mdComponents`, o `<textarea>` e o `showPreview`.

Estado de alteração:

```ts
const loaded = useMemo(() => readPageDoc(page?.content), [page?.content]);
const [doc, setDoc] = useState(loaded);
const isDirty = JSON.stringify(doc) !== JSON.stringify(loaded);
```

`beforeunload` só enquanto `isDirty`:

```ts
useEffect(() => {
  if (!isDirty) return;
  const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}, [isDirty]);
```

Salvar chama `upsertHubPage({ ...page, content: writePageContent(doc) })` e depois `clearDraft()`.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
npx vitest run apps/crm/src/pages/cliente-detalhe/hub/
npx tsc -p apps/crm/tsconfig.json --noEmit
```
Expected: PASS

- [ ] **Step 6: Verificar no navegador**

Três coisas que jsdom não cobre: abrir uma página legada em markdown e confirmar que o conteúdo aparece formatado; digitar num documento grande sem travar; arrastar no rail e recarregar para ver a ordem persistida.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/hub apps/crm/style.css
git commit -m "feat(portal): páginas com editor rich text e rascunho local"
```

---

### Task 12: Script de conversão das páginas existentes

**Files:**
- Create: `scripts/convert-hub-pages-richtext.ts`
- Test: `scripts/__tests__/convert-hub-pages-richtext.test.ts`

**Interfaces:**
- Consumes: `readPageDoc`, `writePageContent`, `isLegacyContent` (Task 8)
- Produces: nada consumido por código de produção

- [ ] **Step 1: Definir os tipos e o duplo de banco**

No topo do script, para os testes terem contra o que rodar:

```ts
export interface PageRow {
  id: string;
  content: unknown;
}

export interface Db {
  selectPages(): Promise<PageRow[]>;
  /** UPDATE … WHERE id = $1 AND content = $2. Devolve quantas linhas mudaram. */
  updateIfUnchanged(
    id: string,
    expected: unknown,
    next: unknown,
  ): Promise<{ rowsAffected: number }>;
}

export interface Report {
  converted: string[];
  skipped: string[];
  raced: string[];
  failed: { id: string; error: string }[];
}
```

E no arquivo de teste, o duplo:

```ts
function fakeDb(rows: PageRow[]) {
  const db = {
    updates: [] as { id: string; content: any }[],
    onUpdate: undefined as undefined | (() => { rowsAffected: number }),
    selectPages: async () => rows,
    updateIfUnchanged: async (id: string, _expected: unknown, next: any) => {
      const forced = db.onUpdate?.();
      if (forced) return forced;
      db.updates.push({ id, content: next });
      return { rowsAffected: 1 };
    },
  };
  return db;
}
```

- [ ] **Step 2: Escrever os testes da corrida e do skip**

```ts
it('pula linha que já está em richtext', async () => {
  const db = fakeDb([{ id: 'p1', content: [{ type: 'richtext', doc: {} }] }]);
  const r = await convert(db, { dryRun: false });
  expect(r.skipped).toEqual(['p1']);
  expect(db.updates).toHaveLength(0);
});

it('não escreve quando o content mudou entre a leitura e a escrita', async () => {
  const db = fakeDb([{ id: 'p1', content: [{ type: 'markdown', content: '# A' }] }]);
  db.onUpdate = () => ({ rowsAffected: 0 }); // outra escrita ganhou a corrida
  const r = await convert(db, { dryRun: false });
  expect(r.converted).toEqual([]);
  expect(r.raced).toEqual(['p1']);
});

it('converte uma linha legada e registra o id', async () => {
  const db = fakeDb([{ id: 'p1', content: [{ type: 'markdown', content: '# A' }] }]);
  const r = await convert(db, { dryRun: false });
  expect(r.converted).toEqual(['p1']);
  expect(db.updates[0].content[0].type).toBe('richtext');
});

it('dryRun não escreve nada', async () => {
  const db = fakeDb([{ id: 'p1', content: [{ type: 'markdown', content: '# A' }] }]);
  await convert(db, { dryRun: true });
  expect(db.updates).toHaveLength(0);
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run scripts/__tests__/convert-hub-pages-richtext.test.ts`
Expected: FAIL

- [ ] **Step 4: Implementar**

```ts
/**
 * Converte as páginas legadas de hub_pages para o bloco `richtext`.
 *
 * Roda com o editor JÁ NO AR, então existe a janela em que alguém abre, converte
 * e salva uma página antes do script chegar nela. O UPDATE é condicionado ao
 * `content` exato que foi lido: linha alterada no meio do caminho não é escrita,
 * é registrada em `raced` e fica para uma segunda passada.
 */
export async function convert(db: Db, opts: { dryRun: boolean }): Promise<Report> {
  const rows = await db.selectPages();
  const report: Report = { converted: [], skipped: [], raced: [], failed: [] };

  for (const row of rows) {
    if (!isLegacyContent(row.content)) {
      report.skipped.push(row.id);
      continue;
    }
    try {
      const next = writePageContent(readPageDoc(row.content));
      if (opts.dryRun) {
        report.converted.push(row.id);
        continue;
      }
      const { rowsAffected } = await db.updateIfUnchanged(row.id, row.content, next);
      (rowsAffected === 1 ? report.converted : report.raced).push(row.id);
    } catch (e) {
      report.failed.push({ id: row.id, error: String(e) });
    }
  }
  return report;
}
```

O `main` precisa, nesta ordem: gravar o backup (`id` + `content` das linhas lidas) num arquivo JSON com timestamp **antes** de qualquer escrita; rodar `--dry-run` por padrão, exigindo `--apply` para escrever; e imprimir o relatório com as quatro listas ao final.

`updateIfUnchanged` é `UPDATE hub_pages SET content = $3 WHERE id = $1 AND content = $2`, devolvendo a contagem de linhas afetadas.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
npx vitest run scripts/__tests__/convert-hub-pages-richtext.test.ts
npx tsc -p tsconfig.scripts.json
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/convert-hub-pages-richtext.ts scripts/__tests__/
git commit -m "feat(portal): script de conversão das páginas legadas"
```

---

## Verificação final antes do PR

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npx tsc -p apps/crm/tsconfig.json --noEmit`
- [ ] `npx tsc -p apps/hub/tsconfig.json --noEmit`
- [ ] `npx tsc -p apps/admin/tsconfig.json --noEmit`
- [ ] `npx tsc -p tsconfig.scripts.json`
- [ ] `npm run test`
- [ ] `npm run test:functions`
- [ ] `npm ci` se `test:functions` rodou (deno suja `node_modules`; sem isso os checks acima mentem)
- [ ] Nenhuma ocorrência nova de `useBlocker`: `grep -rn "useBlocker" apps/ | grep -v silent-update`

## Rollout

1. **Deploy do `mcp` antes do merge:** `npx supabase functions deploy mcp --project-ref <ref> --use-api`. Ele passa a entender `richtext`; com o front ainda antigo isso é inócuo.
2. **Deploy do `hub-pages`** (mudou o desempate de ordem), mesma forma.
3. **Merge.** CRM e Hub sobem juntos no mesmo deploy da Vercel, então não existe janela em que o CRM grave um formato que o Hub não leia.
4. **Backup + dry-run do script**, conferir o relatório, então `--apply`.
5. Abrir uma página convertida no portal real e confirmar que renderiza.

O caminho legado do `renderBlock` fica. Remover é limpeza de outro PR, depois que a conversão estiver confirmada.
