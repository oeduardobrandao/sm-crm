# Admin portal revamp, Phase 2a: chrome, linhas navegáveis e páginas de lista

**Data:** 2026-09-05
**App:** `apps/admin`
**Status:** aprovado para plano de implementação
**Antecessor:** `2026-09-04-admin-portal-revamp-phase1-design.md` (PR #460, merged em c7d51b56)

## Objetivo

Terminar o que a Fase 1 deixou de fora nas partes que não envolvem formulários pesados:
a sidebar e o login passam a respeitar o tema, toda linha clicável ganha um caminho por
teclado, e as páginas Admins, Integrações, Base de conhecimento (lista) e Detalhe do
workspace (com os cartões de Eventos e Convites) migram para os primitivos copiados na
Fase 1. Comportamento idêntico ao atual; muda o que o usuário vê e como acessa.

## Decisões tomadas no brainstorming

| Decisão                      | Escolha                                                                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Divisão da Fase 2            | **2a** (este spec): chrome, linhas navegáveis, Admins, Integrações, KB lista, Detalhe do workspace. **2b** (spec futuro): Planos, Banners e Popups (formulários e modais), editor de artigo, toolbar do `ArticleEditor`, primitivo `Dialog`.                   |
| Sidebar no tema claro        | **Segue o tema**, como a sidebar do CRM (`--surface-main`). Usa os tokens do Admin (`card`, `border`, `foreground`, `muted-foreground`, `secondary`). O wordmark do logo vira `currentColor`. O liquid glass continua forçando `data-theme="dark"` e não muda. |
| Acesso por teclado às linhas | **A célula primária vira um elemento interativo de verdade.** Linha que navega: `<Link>` do React Router. Linha que abre modal (Banners, Popups): `<button type="button">`. A linha inteira continua clicável para o mouse.                                    |
| Mudanças de comportamento    | **Nenhuma.** Migração pura: primitivos, tokens, português, tema da sidebar e links nas linhas. Filtros da lista da KB ficam em estado local como hoje.                                                                                                         |
| Primitivos novos             | `textarea.tsx` e `switch.tsx`, copiados do CRM como na Fase 1 (import de `cn` por `../../lib/utils`).                                                                                                                                                          |

## Fora de escopo (2a)

- Formulários e modais de Planos, Banners e Popups (`fixed inset-0` feitos à mão).
- `KbArticleEditorPage` e `components/editor/*` (títulos em inglês, 16 hex).
- Primitivo `Dialog`.
- Estado na URL para a lista da KB ou qualquer outra página.
- Sidebar "sempre escura" via tokens dedicados (opção B, descartada).

---

## 1. Primitivos adicionados a `apps/admin/src/components/ui/`

| Arquivo        | Origem                                    | Ajustes                                                                          |
| -------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `textarea.tsx` | `apps/crm/src/components/ui/textarea.tsx` | `import { cn } from '../../lib/utils'`. Sem outras mudanças.                     |
| `switch.tsx`   | `apps/crm/src/components/ui/switch.tsx`   | Idem. Depende de `@radix-ui/react-switch`, já hoisted em `package.json` da raiz. |

`components/ui/__tests__/primitives.test.tsx` ganha um smoke test por primitivo: o
`Textarea` encaminha `ref`, `value`, `onChange` e `className`; o `Switch` alterna
`aria-checked` ao clicar e respeita `disabled`.

A nota "### Primitives" do `DESIGN_SYSTEM.md` passa a listar os dois novos arquivos.

## 2. Chrome

### 2.1 `layouts/AdminLayout.tsx`

Hoje: 24 literais hex (`#12151a`, `#1e2430`, `#9ca3af`, `#e8eaf0`, `#eab308`,
`#F8F8F8` nos paths do wordmark). Depois:

| Elemento                               | Classes                                                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<aside>`                              | `bg-card border-r border-border` (mantém `glass-surface glass-surface--sidebar`, largura, `fixed`, transição)                                                                 |
| Wordmark (paths hoje `fill="#F8F8F8"`) | `fill="currentColor"`, e o `<svg>` recebe `className="shrink-0 text-foreground"`. O símbolo colorido (retângulos e gradiente `#alg`) continua com as cores de marca literais. |
| Rótulo "admin" sob o logo              | `text-muted-foreground`                                                                                                                                                       |
| Item de navegação ativo                | `bg-secondary text-foreground`                                                                                                                                                |
| Item inativo                           | `text-muted-foreground hover:bg-secondary/50 hover:text-foreground`                                                                                                           |
| Rodapé (`border-t`)                    | `border-border`                                                                                                                                                               |
| Botões de tema e glass                 | `text-muted-foreground hover:text-primary hover:bg-secondary`; o estado "glass ligado" usa `text-primary`                                                                     |
| Botão de fechar (mobile) e hambúrguer  | `text-muted-foreground hover:text-foreground`; o hambúrguer usa `Button variant="ghost" size="icon"`                                                                          |

Liquid glass: `[data-liquid-glass='on'] .glass-surface--sidebar` já sobrescreve o
background com `rgba(13,16,22,.55)` e o efeito só liga com `data-theme="dark"`
forçado, então os tokens escuros entram sozinhos. Nenhuma mudança em
`liquidglass/glass.css`.

Os `NavLink`s de navegação já são links de verdade; nada muda no teclado aqui.

### 2.2 `pages/LoginPage.tsx`

O gradiente de fundo (`linear-gradient(135deg, #eaf0dc 0%, #eab308 100%)`) é a
única literal que permanece: é a splash de marca, não tema. O restante:

- Cartão: `bg-card text-card-foreground rounded-3xl p-10 shadow-xl` (era `bg-white`).
- Rótulo "admin": `text-muted-foreground`.
- Campos: `Label` + `Input` (`type="email"` e `type="password"`, `required`,
  `autoComplete="email"` / `"current-password"`). Os `Label`s recebem `htmlFor` e os
  `Input`s o `id` correspondente (`admin-login-email`, `admin-login-password`).
- Mensagem de erro: `text-destructive` (era `text-red-600`), com `role="alert"`.
- Botão: `Button type="submit" className="w-full" disabled={loading}`; texto
  "Entrando…" / "Entrar" como hoje.

## 3. Linhas navegáveis

### 3.1 Helper de rotas

Novo `apps/admin/src/lib/routes.ts`:

```ts
export const workspaceDetailPath = (id: string) => `/admin/workspaces/${id}`;
export const kbArticleEditPath = (id: string) => `/admin/kb-articles/${id}/edit`;
export const kbArticleNewPath = () => '/admin/kb-articles/new';
```

Todo `navigate(\`/admin/workspaces/${…}\`)`e`navigate(\`/admin/kb-articles/…\`)`nas
páginas tocadas passa a usar esses helpers, para que o`href` do link e o destino do
clique na linha nunca divirjam.

### 3.2 Padrão

A célula primária de cada linha (nome do workspace, título do artigo, conteúdo do
banner, título do popup) renderiza um elemento interativo com classes
`font-medium text-foreground hover:underline focus-visible:outline-none
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
focus-visible:ring-offset-background rounded-sm` e `onClick={(e) => e.stopPropagation()}`
para o clique no link não disparar também o `onClick` da linha.

| Lista                                                                                       | Elemento primário        | Destino                            |
| ------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------- |
| `pages/workspaces/WorkspacesTable.tsx`, coluna `name` (desktop) e título do cartão (mobile) | `<Link>`                 | `workspaceDetailPath(ws.id)`       |
| `pages/DashboardPage.tsx`, as três listas (MRR, pendentes, recentes)                        | `<Link>`                 | `workspaceDetailPath(id)`          |
| `pages/KbArticlesPage.tsx`                                                                  | `<Link>`                 | `kbArticleEditPath(a.id)`          |
| `pages/BannersPage.tsx`                                                                     | `<button type="button">` | `openEdit(b)`                      |
| `pages/PopupsPage.tsx`                                                                      | `<button type="button">` | `setEditing(p); setShowForm(true)` |

A linha (`TableRow`, `li` ou `div`) mantém `onClick` e `cursor-pointer` para o mouse.
Em Banners e Popups só a linha muda nesta fase; o modal que abre fica para a 2b.

`WorkspacesTable` recebe o `to` pelo helper diretamente (não por prop): a rota de
detalhe é única e já é conhecida do Dashboard. `onOpen` continua sendo a prop do clique
na linha.

## 4. Páginas migradas

Todas: `<h1>` + parágrafo viram `PageHeader` (com `actions` quando houver);
"Carregando…" em `<p>` vira `Skeleton` com o número de linhas do caso vazio-típico
(3); erros viram `ErrorState` com `onRetry={refetch}`; listas vazias viram
`EmptyState`. Botões só com ícone ganham `aria-label`.

### 4.1 `pages/AdminsPage.tsx`

- `PageHeader title="Admins" description="Administradores da plataforma"`.
- Formulário de convite: `Input type="email"` + `Button` ("Convidar admin", ícone
  `UserPlus`), `disabled={inviteMutation.isPending}`.
- Lista: `Table` com colunas E-mail, Convidado por, Adicionado em e ação, dentro de
  `Card`. Layout mobile (cartão por linha, `md:hidden`) preservado como hoje, mesmo
  padrão da `WorkspacesTable`.
- Botão remover: `Button variant="ghost" size="icon" aria-label="Remover admin"`,
  oculto para o próprio usuário como hoje.
- Estados: `Skeleton` no carregamento; `EmptyState` "Nenhum admin além de você"
  quando a lista só tem o próprio usuário; `ErrorState` se a query falhar (hoje não
  há tratamento de erro; passa a haver).

### 4.2 `pages/IntegrationsPage.tsx`

- `PageHeader title="Integrações"`.
- Cada bloco (`Conector MCP do Admin`, `Como conectar`, `Permissões`, `Conexões
autorizadas`) vira `Card` com `CardHeader`/`CardTitle`/`CardContent`.
- URL do conector: `Input readOnly` + `Button variant="outline"` copiar, com
  `aria-label="Copiar URL"` e o feedback "Copiado" existente.
- Escopos em `Permissões`: `Badge variant="neutral"` por escopo.
- Conexões autorizadas: `Table` (cliente, escopos, criado em, última atividade,
  ação) com `Button variant="ghost" size="icon" aria-label="Revogar conexão"`.
- Estados: `Skeleton`, `ErrorState` (substitui o botão "tentar novamente" à mão),
  `EmptyState` "Nenhuma conexão autorizada".
- `pages/__tests__/IntegrationsPage.test.tsx` é atualizado onde roles ou rótulos
  mudarem.

### 4.3 `pages/KbArticlesPage.tsx`

- `PageHeader title="Base de conhecimento"` com `actions={<Button>Novo artigo</Button>}`
  navegando para `kbArticleNewPath()`.
- Barra: `Input` de busca (ícone `Search` posicionado como na toolbar de Workspaces),
  dois `Select` (categoria, status) com a mesma composição
  `Select/SelectTrigger/SelectValue/SelectContent/SelectItem` da Fase 1. Estado local
  inalterado.
- Linhas: título vira `<Link>` (§3). Status e categoria em `Badge` (`getStatusBadge`
  passa a devolver `variant` em vez de classe). Rascunhos mantêm `opacity-50`.
- Estados: `Skeleton`, `EmptyState` "Nenhum artigo encontrado" (com "Limpar filtros"
  quando houver filtro ativo), `ErrorState`.

### 4.4 `pages/WorkspaceDetailPage.tsx`

- Botão "Voltar": `Button variant="ghost"` com ícone `ArrowLeft`, navegando para
  `/admin/workspaces`.
- Cabeçalho: status da assinatura em `Badge` usando o mapa `STATUS_VARIANT` já
  existente no Dashboard (movido para `lib/subscription.ts` e exportado);
  `toneBadgeClass()` é **removida** de `lib/subscription.ts` junto com o bloco `describe
('toneBadgeClass')` de `lib/__tests__/subscription.test.ts`.
- Plano: `Select` (mesma composição) + `Button` "Salvar plano".
- Limites de recursos e de taxa: `Input type="number"` por linha, `Label` associado
  por `htmlFor`.
- Funcionalidades: `Switch` com `aria-label={FEATURE_FLAG_LABELS[key]}` no lugar do
  botão de texto ATIVO/INATIVO. O ponto de override (`bg-warning`) continua ao lado,
  com o mesmo `title`.
- Chaves de API e conexões OAuth do MCP: `Table` dentro de `Card`, botões de ação
  como `Button variant="ghost" size="icon"` com `aria-label` ("Revogar chave",
  "Revogar conexão").
- Notas: `Textarea` + `Button` "Salvar notas" / `Button variant="outline"` "Descartar".
- Membros: `Table` (nome, e-mail, papel, entrou em) dentro de `Card`.
- Carregamento: `Skeleton` no lugar do `<p>`; erro da query principal:
  `ErrorState` (hoje inexistente).

### 4.5 `pages/WorkspaceEventsCard.tsx`

- `Card` com `CardHeader` (título com o total) e `Select` de tipo de evento no header.
- Paginação: dois `Button variant="outline" size="sm"` ("Anterior", "Próxima").
- Lista de eventos em `Table` no desktop, cartões no mobile como hoje.
- `Skeleton` no carregamento; `EmptyState` "Nenhum evento".

### 4.6 `pages/WorkspaceInvitesCard.tsx`

- `Card`; formulário com `Input aria-label="E-mail"`, `Select aria-label="Papel"`,
  `Button` "Convidar" e `Button variant="ghost"` "Cancelar".
- Lista em `Table` com `Badge` para papel e status do convite; ações em
  `Button variant="ghost" size="sm"` ("Reenviar", "Revogar").
- `ErrorState` no lugar do botão de refetch à mão.
- `pages/__tests__/WorkspaceInvitesCard.test.tsx` é atualizado onde roles ou rótulos
  mudarem. O `Select` do Radix não abre em jsdom: asserções que dependem de escolher
  um papel passam a usar o valor inicial ou o `onValueChange` exposto, como a Fase 1
  fez na toolbar.

### 4.7 Passada de português

Varredura nos arquivos desta fase (`AdminLayout`, `LoginPage`, `AdminsPage`,
`IntegrationsPage`, `KbArticlesPage`, `WorkspaceDetailPage`, `WorkspaceEventsCard`,
`WorkspaceInvitesCard`, `WorkspacesTable`, `DashboardPage`, linhas de `BannersPage` e
`PopupsPage`) por strings visíveis, `aria-label`, `title` e `placeholder` em inglês.
Um `grep` inicial não encontrou nenhuma; a varredura confirma. Regra da casa: sem
travessão na copy voltada ao usuário (ponto, dois-pontos ou "·").

## 5. Testes

### 5.1 Novos

| Teste                                                    | O que garante                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/__tests__/primitives.test.tsx` (+2 casos) | `Textarea` e `Switch` renderizam e respondem (§1).                                                                                                                                                                                                                                                |
| `src/__tests__/no-hex-literals.test.ts`                  | Lê o fonte dos arquivos da §4.7 e falha se encontrar `#[0-9a-fA-F]{6}` fora de uma allowlist: o gradiente do `LoginPage` e o `<svg>` do logo em `AdminLayout` (cores do símbolo e do gradiente `#alg`). A allowlist é por arquivo e por literal exata, para uma cor nova não passar despercebida. |
| `pages/__tests__/WorkspacesTable.test.tsx` (+1)          | A célula de nome é `role="link"` com `href` igual a `workspaceDetailPath(id)`; clicar no link não chama `onOpen` duas vezes (uma só, pela navegação do link e não pela linha).                                                                                                                    |
| `pages/__tests__/DashboardPage.test.tsx` (+1)            | Cada linha das listas expõe um link com o `href` do workspace.                                                                                                                                                                                                                                    |
| `pages/__tests__/KbArticlesPage.test.tsx` (novo)         | Renderiza a lista; título é link para `kbArticleEditPath`; `EmptyState` com filtro ativo mostra "Limpar filtros".                                                                                                                                                                                 |
| `pages/__tests__/AdminsPage.test.tsx` (novo)             | Lista renderiza em `Table`; botão remover tem `aria-label` e some para o próprio usuário.                                                                                                                                                                                                         |
| `layouts/__tests__/AdminLayout.test.tsx` (novo)          | Sidebar renderiza os links de navegação; o `<aside>` não tem classe `bg-[#`; o toggle de tema alterna `data-theme` no `documentElement`.                                                                                                                                                          |

### 5.2 Atualizados

`IntegrationsPage.test.tsx`, `WorkspaceInvitesCard.test.tsx`, `DashboardPage.test.tsx`
onde roles, rótulos ou estrutura mudarem. Regra da Fase 1 vale: jsdom renderiza os
dois layouts (`hidden md:table` e `md:hidden`), então asserções de tabela escopam com
`within(getByRole('table'))`.

### 5.3 Verificação manual (staging)

`npm run dev:admin:staging` com o login seed, tema claro, tema escuro e glass ligado:

1. Sidebar clara no tema claro, escura no escuro, vidro no glass; wordmark legível nos três.
2. Login com os campos em primitivos; erro em `text-destructive`.
3. Tab pela lista de Workspaces: foco cai nos nomes, Enter abre o detalhe; clique na
   linha continua abrindo; clique no nome abre uma vez só.
4. Mesmo em Dashboard, KB, Banners e Popups (nestes dois, Enter abre o modal).
5. Admins, Integrações, KB lista, Detalhe do workspace: sem regressão de função
   (convidar admin, copiar URL, filtrar KB, salvar plano/limites/features/notas,
   filtrar eventos, convidar membro).

## 6. Rollout

Só frontend: nenhuma migration, nenhuma edge function. Sequência:

1. Antes do push: `npm run lint`, `npm run format:check`, os quatro `tsc`, `npm run test`.
2. PR contra `main`, review externo (Codex), browser check em staging (§5.3).
3. Squash merge; Vercel deploya; conferir que o chunk do `AdminLayout` em produção
   não contém `#12151a`.

## Riscos e mitigação

| Risco                                                                                      | Mitigação                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Liquid glass depende de algum hex da sidebar que os tokens não reproduzem                  | O único hex do glass está em `glass.css`, não no layout; verificação manual com glass ligado no item 1 da §5.3.          |
| `Link` dentro de linha clicável dispara navegação dupla                                    | `stopPropagation` no link; teste em `WorkspacesTable.test.tsx` afirma uma chamada só.                                    |
| `Switch` nas features muda a semântica de "salvar" (hoje o botão só altera `featureEdits`) | O `Switch` chama o mesmo `setFeatureEdits`; o botão "Salvar" continua sendo o único ponto de persistência.               |
| Testes existentes quebram com a troca de `<select>` por Radix `Select`                     | Mesmo tratamento da Fase 1: `onValueChange` e valor inicial em jsdom; cobertura de abrir o select fica no browser check. |
| `toneBadgeClass()` ainda tem outro consumidor                                              | `grep` antes de remover; hoje o único é `WorkspaceDetailPage`.                                                           |
