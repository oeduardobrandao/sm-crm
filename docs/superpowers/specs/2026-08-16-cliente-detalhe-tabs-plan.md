# Plano de Implementação — Abas em Detalhes do Cliente

## Objetivo

Reduzir `ClienteDetalhePage.tsx` (hoje 2631 linhas) a um layout de rota, distribuir o
conteúdo entre sete abas independentes baseadas em rotas reais, e carregar somente os
dados da aba ativa. Segue o padrão de Configurações (`apps/crm/src/pages/configuracao/`).

Executar as tarefas abaixo em ordem — cada uma depende das interfaces criadas pela
anterior — usando TDD, mantendo o sistema funcional ao final de cada tarefa.

Protótipo aprovado: Visual Companion (referência visual já validada com o usuário antes
deste plano).

## Restrições Globais

Estas restrições valem para TODAS as tarefas e devem ser a lente de atenção de qualquer
revisão de código deste plano:

- **Nenhuma migration, alteração de RLS ou mudança de contrato backend.** É refatoração
  de arquitetura, navegação e carregamento de dados no frontend — nada no Supabase muda.
- **Todas as funcionalidades atuais devem ser preservadas.** Nenhuma feature existente
  pode desaparecer ou regredir; o que muda é onde/quando os dados são buscados.
- **Papéis:** usar `workspaceRole` (de `AuthContext`, valores `owner | admin | agent`)
  para decisões de visibilidade de aba — nunca hardcodear papel. `Relatórios` fica oculto
  para `agent`. `Hub` fica visível para todos, com o aviso `RoleRestrictionNotice`
  existente quando restrito. `workspaceRole === null` é ambíguo por si só — pode
  significar "removido do workspace" OU "lookup ainda não resolveu / falhou" — e
  `membershipResolved` (`boolean | 'error'`, ver `AuthContext.tsx`) é o que desambigua.
  Nenhuma decisão de redirect/visibilidade de aba baseada em papel pode disparar
  enquanto esse estado não estiver assentado. `ConfiguracaoLayout.tsx`
  (`apps/crm/src/pages/configuracao/ConfiguracaoLayout.tsx`) — o padrão que este plano já
  manda seguir — já resolve exatamente esse problema; mirar a mesma ordem de gating
  (aguardar `!loading`, tratar `membershipResolved !== true` de forma conservadora) em
  vez de inventar uma lógica nova.
- **Financeiro:** usar `canSeeFinancials` (tipo `FinancialAccess = boolean | 'unknown'`,
  de `AuthContext`/`lib/financialAccess.ts`) para decidir visibilidade da aba E para
  condicionar toda query financeira (`enabled: canSeeFinancials === true`). `'unknown'`
  é estado de carregamento, não negação — o guard de rota deve tratá-lo como tal (não
  redirecionar, não renderizar dado). Espelhar o modelo de três estados já usado por
  `AppLayout.tsx`'s `financialGuardOutcome` (`'content' | 'loading' | 'denied'`,
  `apps/crm/src/components/layout/AppLayout.tsx`) para o guard da rota
  `/clientes/:id/financeiro`, resolvendo esse estado ANTES de montar `FinanceiroTab` no
  mesmo render — nunca montar a aba e navegar para longe dela via `useEffect`, o que
  deixaria a query financeira disparar antes do redirect. Acesso direto pela URL sem
  `canSeeFinancials === true` nunca renderiza dado financeiro nem dispara a query. Se a
  capacidade for revogada com um diálogo financeiro aberto, fechar o diálogo.
- **Purga de cache na revogação:** `AuthContext.tsx` já purga `FINANCIAL_QUERY_KEYS`
  (`['clientes', 'membros', 'transacoes', 'contratos', 'dashboardStats']`) via
  `removeQueries`/`invalidateQueries` quando `canSeeFinancials` transiciona ao vivo. A
  nova chave `['cliente', id]` (Task 1) carrega `valor_mensal` da mesma `clientes_v` e
  PRECISA entrar nessa lista — do contrário o valor mensal já buscado permanece no cache
  do React Query mesmo depois de revogado, já que `clientes_v` só mascara numa leitura
  NOVA (`can_see_financials()` é avaliado no servidor por query, não é propriedade da
  linha em cache).
- **Isolamento de queries por aba:** abrir uma aba não pode executar queries que
  pertencem a outra aba. Isso deve ser verificável tanto por leitura de código quanto
  por teste (mock dos módulos de store, assert de chamadas).
- **i18n:** todo texto novo ou extraído vai para `packages/i18n/locales/pt/clients.json`
  e `packages/i18n/locales/en/clients.json` (namespace `'clients'`, já usado por
  `ClienteDetalheNav.tsx` via `useTranslation('clients')`). Nenhum texto hardcoded.
- **Compatibilidade de rotas:**
  - `/clientes/:id` continua válido e redireciona para `visao-geral`, preservando
    query parameters.
  - Quando a URL tiver `ig_connected`, `ig_error` ou `tt_error`, o redirecionamento da
    rota-base vai para `redes-sociais` em vez de `visao-geral`, com os parâmetros
    intactos. Depois do processamento desses parâmetros pela aba de Redes sociais,
    removê-los da URL via API do React Router (não `window.location`).
  - Segmentos de aba desconhecidos, ou abas sem permissão para o usuário atual,
    redirecionam para `visao-geral`.
  - `id` inválido (`parseInt(id, 10)` com `isNaN`) redireciona para `/clientes`.
  - Nenhum redirect de edge function (Instagram/TikTok OAuth) muda — o redirect interno
    do CRM é quem interpreta os parâmetros OAuth depois que a edge function já devolveu
    o usuário para `/clientes/:id`.
- **Estilo:** usar os tokens existentes (ver `DESIGN_SYSTEM.md`) e o padrão visual de
  Configurações, com classes CSS próprias (não reaproveitar `.cliente-detalhe-nav*`
  antigo) para não acoplar as duas páginas.
- **Responsividade sem scroll-spy:** navegação lateral agrupada no desktop (≥ 1101px,
  ver `reference_crm_layout_breakpoints`), faixa horizontal rolável abaixo disso. Nada
  de `IntersectionObserver`, `scrollIntoView`, ou `position: sticky` (quebrado pelo
  `overflow-x: hidden` em `#root`, ver `DESIGN_SYSTEM.md`).

## Arquitetura definida

### Tipos e interfaces centrais

Criar em `apps/crm/src/pages/cliente-detalhe/` (arquivo novo, ex.
`clienteTabs.model.ts`, substituindo o atual `clienteDetalheNav.model.ts`):

```ts
export type ClienteTabKey =
  | 'visao-geral'
  | 'entregas'
  | 'redes-sociais'
  | 'relatorios'
  | 'hub'
  | 'arquivos'
  | 'financeiro';

export interface ClienteDetalheOutletContext {
  clienteId: number;
  cliente: Cliente;
}
```

O modelo central das abas deve fornecer, por aba: segmento de rota (`ClienteTabKey`),
grupo (`'cliente' | 'canais' | 'gestao'`), ícone (`lucide-react`), chave i18n do rótulo,
e regra de acesso (função ou flag calculada a partir de `workspaceRole` /
`canSeeFinancials`). Grupos, na ordem de exibição:

1. **Cliente** — Visão geral, Entregas.
2. **Canais e análise** — Redes sociais, Relatórios.
3. **Gestão** — Hub, Arquivos, Financeiro.

### Query do cliente individual

Adicionar ao store (`apps/crm/src/store/clients.ts`):

```ts
export async function getCliente(id: number): Promise<Cliente | null>;
```

- Lê de `clientes_v` (nunca da tabela base — ver o gotcha de
  `CLIENTE_SAFE_COLUMNS`/`clientes_v` no `CLAUDE.md`), filtra por `id`, usa
  `maybeSingle()`, propaga erro do Supabase.
- Query key: `['cliente', clienteId]`.
- Abrir um cliente NÃO pode mais chamar `getClientes()` (que carrega toda a carteira).

### Distribuição do conteúdo por aba

- **Visão geral** (`visao-geral`): informações cadastrais, datas importantes, endereços.
- **Entregas** (`entregas`): workflows ativos, calendário de posts, histórico, drawers e
  ações de aprovação/avanço/reversão.
- **Redes sociais** (`redes-sociais`): Instagram, TikTok, publicação automática.
- **Relatórios** (`relatorios`): preferências de envio mensal, análise por IA, atalho
  para Analytics. Oculta para `agent`.
- **Hub** (`hub`): configuração e acesso ao Hub (token, briefing, marca, páginas,
  ideias). Visível para todos, com `RoleRestrictionNotice` quando restrito.
- **Arquivos** (`arquivos`): pasta e arquivos vinculados ao cliente.
- **Financeiro** (`financeiro`): KPIs, contratos, transações. Só quando
  `canSeeFinancials === true`.

Todas as sete abas ficam sempre visíveis na navegação para quem tem permissão de
acessá-las (Relatórios/Financeiro à parte), mesmo vazias — usar estados vazios dentro do
conteúdo, não esconder a aba por falta de dado.

---

## Task 1 — Consulta individual do cliente

### Alterações

- Adicionar `getCliente(id)` em `apps/crm/src/store/clients.ts`, exportado
  automaticamente por `store/index.ts` (`export * from './clients'`).
- Query key `['cliente', clienteId]`.
- Adicionar `'cliente'` a `FINANCIAL_QUERY_KEYS` em `apps/crm/src/context/AuthContext.tsx`
  (hoje `['clientes', 'membros', 'transacoes', 'contratos', 'dashboardStats']`) — essa
  lista é o que purga (`removeQueries`/`invalidateQueries`) o cache financeiro na
  revogação/concessão ao vivo, e a nova chave `['cliente', id]` carrega `valor_mensal`
  como qualquer uma das outras. `queryClient.removeQueries({ queryKey: ['cliente'] })`
  já casa por prefixo com todo `['cliente', id]` em cache, então basta adicionar a
  string à lista.

### TDD

1. Em `apps/crm/src/__tests__/store.core.test.ts` (ou arquivo de teste do módulo
   `clients.ts` já existente), adicionar um teste que confirme:
   - leitura em `clientes_v`;
   - filtro pelo `id` recebido;
   - retorno da linha encontrada;
   - retorno `null` quando não houver cliente (`maybeSingle()` sem match);
   - propagação de erro do Supabase.
2. Rodar o teste e confirmar a falha (função ainda não existe).
3. Implementar `getCliente`.
4. Rodar novamente até passar.
5. Em `apps/crm/src/context/__tests__/revocation.test.ts`, seguindo o padrão já usado
   para as demais chaves de `FINANCIAL_QUERY_KEYS`, estender a asserção de purga na
   revogação ao vivo para cobrir `'cliente'` (mesmo padrão dos testes já existentes para
   `'clientes'`/`'transacoes'`/etc. nesse arquivo). Confirmar falha antes de editar
   `FINANCIAL_QUERY_KEYS`, depois adicionar a string e confirmar passagem.

### Aceitação

Abrir um cliente não pode mais executar `getClientes()` nem carregar toda a carteira.

Commit sugerido: `refactor(clientes): add single client query`

---

## Task 2 — Modelo de abas, layout e rotas

### Alterações

- Substituir `clienteDetalheNav.model.ts` por um modelo declarativo das sete abas
  (`clienteTabs.model.ts`, ver "Arquitetura definida" acima — segmento, grupo, ícone,
  chave i18n, regra de acesso).
- Reescrever `ClienteDetalheNav.tsx` para consumir esse modelo e renderizar `NavLink`s
  de rota (React Router) agrupados nos três grupos, em vez de âncoras. Uso esperado:
  `<ClienteDetalheNav clienteId={clienteId} cliente={cliente} />`. Remover
  `IntersectionObserver`, `scrollIntoView` e o estado de âncora ativa — o estado ativo
  passa a vir de `useLocation`/`NavLink`'s `aria-current`.
- Extrair o formulário de edição do cliente, hoje embutido no `<Dialog>` inline de
  `ClienteDetalhePage.tsx` (bloco `editOpen`), para um componente próprio
  `ClienteEditDialog.tsx`, recebendo `cliente`, `open`, `onOpenChange` e expondo a
  mesma lógica de salvar/validar que existe hoje.
- Reescrever `ClienteDetalhePage.tsx` como layout: carregamento do cliente via
  `getCliente(clienteId)`, cabeçalho (iniciais + cor do cliente — nunca busca de foto do
  Instagram no layout), botão "Editar cliente" abrindo `ClienteEditDialog`,
  `ClienteDetalheNav`, e `<Outlet context={{ clienteId, cliente } satisfies
  ClienteDetalheOutletContext} />`.
- Configurar as rotas filhas em `App.tsx`, com as sete rotas de `ClienteTabKey` como
  filhas de `/clientes/:id` (mesmo padrão de `<Route path="/configuracao" ...><Route
  index .../><Route path="perfil" .../>...</Route>` já usado ali para
  `ConfiguracaoLayout`), cada uma lazy-carregando seu componente de aba. As Tarefas
  3–7 ainda não existem neste ponto do plano: criar aqui, nesta tarefa, um placeholder
  mínimo em cada um dos sete caminhos de arquivo que as Tarefas 3–7 vão preencher depois
  (`tabs/VisaoGeralTab.tsx`, `tabs/EntregasTab.tsx`, `tabs/RedesSociaisTab.tsx`,
  `tabs/RelatoriosTab.tsx`, `tabs/HubClienteTab.tsx`, `tabs/ArquivosTab.tsx`,
  `tabs/FinanceiroTab.tsx`), cada um só com um `export default function` retornando algo
  mínimo (ex. `null`). As Tarefas seguintes substituem o CONTEÚDO desses arquivos — não
  criam arquivos novos, não tocam mais em `App.tsx`. Ao importar essas sete abas em
  `App.tsx`, usar nomes locais prefixados (`ClienteVisaoGeralTab`,
  `ClienteEntregasTab`, `ClienteRedesSociaisTab`, `ClienteRelatoriosTab`,
  `ClienteHubTab`, `ClienteArquivosTab`, `ClienteFinanceiroTab`) — `App.tsx` já importa
  um `RelatoriosTab` e um `HubTab` de `pages/configuracao/tabs/` para outra rota; um
  segundo `const RelatoriosTab = lazy(...)`/`const HubTab = lazy(...)` sem prefixo
  colide com esse identificador já existente no mesmo arquivo.
- Criar um componente `ClienteDetalheIndexRedirect.tsx` para a rota-índice
  `/clientes/:id`: decide entre `visao-geral` e `redes-sociais` (quando `ig_connected`,
  `ig_error` ou `tt_error` estiverem na query string), preservando os demais query
  parameters no redirect.
- Segmentos de aba desconhecidos, ou aba sem permissão para o usuário atual (via o
  modelo declarativo), redirecionam para `visao-geral`. `id` inválido redireciona para
  `/clientes`.
- O gating de papel/capacidade desta camada (decidir se redireciona para `visao-geral`,
  e o que renderizar enquanto isso não está resolvido) deve espelhar o padrão já usado
  por `ConfiguracaoLayout.tsx` (ordem de gating por `loading`/`membershipResolved`) e por
  `AppLayout.tsx`'s `financialGuardOutcome` (three-state `content | loading | denied`,
  aplicado aqui à rota `financeiro`) — não inventar uma lógica de gating nova. Nenhum
  redirect por falta de permissão pode disparar enquanto o estado relevante
  (`membershipResolved`/`canSeeFinancials`) ainda não assentou.

### Edição

Após salvar o cliente em `ClienteEditDialog`:

```ts
queryClient.invalidateQueries({ queryKey: ['cliente', clienteId] });
queryClient.invalidateQueries({ queryKey: ['clientes'] });
```

Se `canSeeFinancials` for revogado enquanto `ClienteEditDialog` estiver aberto e expuser
`valor_mensal`, fechar o diálogo.

### TDD

Criar `ClienteDetalhePage.test.tsx` (substituindo/complementando os testes atuais da
página) cobrindo:

- ordem e agrupamento das sete abas nos três grupos;
- aba ativa conforme a rota atual;
- estado de carregamento e cliente inexistente;
- rota-base `/clientes/:id` redirecionando para Visão geral;
- preservação de query parameters no redirect;
- parâmetros OAuth (`ig_connected`, `ig_error`, `tt_error`) direcionando o redirect
  para Redes sociais;
- acesso direto a uma aba permitida (renderiza) e a uma sem permissão (redireciona
  para Visão geral) — cobrir tanto Relatórios/agent quanto Financeiro/sem capacidade;
- ausência de redirecionamento prematuro enquanto o papel/capacidade ainda está
  carregando (não pode "piscar" um redirect antes do `AuthContext` resolver);
- edição do cliente invalidando as duas query keys (`['cliente', id]` e `['clientes']`).

Atualizar `clienteDetalheNav.model.test.ts` e o teste de `ClienteDetalheNav` para o
novo modelo de abas/rotas, removendo expectativas de `IntersectionObserver` e
`scrollIntoView`.

Commit sugerido: `refactor(cliente-detalhe): add routed tab shell`

---

## Task 3 — Visão geral

### Alterações

Criar:

- `tabs/VisaoGeralTab.tsx`
- `components/ClienteDatasSection.tsx`
- `components/ClienteEnderecosSection.tsx`

Mover para essa aba (lendo `clienteId`/`cliente` via `useOutletContext<ClienteDetalheOutletContext>()`):

- e-mail, telefone, forma de pagamento, forma de entrega, especialidade, aniversário e
  link do Notion;
- CRUD de datas importantes;
- CRUD de endereços, incluindo preenchimento automático por CEP.

A aba deve consultar somente:

```
['clienteDatas', clienteId]
['clienteEnderecos', clienteId]
```

Preservar confirmações (`AlertDialog` de remoção), validações, toasts e estados vazios
atuais exatamente como estão hoje.

### TDD

- renderização dos dados cadastrais;
- estado vazio de datas e de endereços;
- adicionar, editar e remover data/endereço;
- validação dos campos obrigatórios;
- CEP encontrado, não encontrado e falha na consulta;
- invalidação das query keys corretas após cada mutação;
- nenhuma chamada de query pertencente a Entregas, Instagram, Hub ou Financeiro.

Commit sugerido: `refactor(cliente-detalhe): extract overview tab`

---

## Task 4 — Entregas

### Alterações

Criar:

- `tabs/EntregasTab.tsx`
- `components/ClientePostCalendar.tsx`

Mover todo o domínio operacional de `ClienteDetalhePage.tsx` para essas duas peças:

- workflows e etapas;
- contadores de posts;
- capas;
- calendário de posts;
- atualização de status;
- histórico;
- `WorkflowDrawer`;
- `HistoryDrawer`;
- modais de avançar, reverter, editar etapa e escolher aprovação
  (`ForwardConfirmDialog`, `RevertConfirmDialog`, `ClientApprovalChoiceDialog`).

Mover `ClientCalendarDayButton` e `ScheduledPostOpenButton` (hoje exportados de
`ClienteDetalhePage.tsx`, linhas 173 e 204) para `ClientePostCalendar.tsx`.

Preservar obrigatoriamente (comportamento idêntico ao atual):

- `completeEtapaForAdvance`;
- `notifyRearmOutcome`;
- `hasLaterApprovalEtapa`;
- `{ rearm: false }` no caminho "sem alterar posts";
- criação do ciclo recorrente;
- todos os `invalidateQueries` atuais ligados a workflows/etapas/posts.

A aba Entregas continua visível e acessível quando não houver workflows ativos, com um
estado vazio.

### TDD

- Migrar os testes do calendário (hoje cobrindo `ClientCalendarDayButton` /
  `ScheduledPostOpenButton` dentro de `ClienteDetalhePage.tsx`) para
  `ClientePostCalendar.tsx`.
- Atualizar `ClienteDetalheRearm.test.ts` para o novo dono do código
  (`EntregasTab`/`ClientePostCalendar`) ou substituí-lo por um teste comportamental
  equivalente que continue cobrindo os três caminhos de avanço e os dois caminhos que
  notificam rearm.
- Testar fluxo ativo, histórico vazio, calendário vazio, abertura dos drawers.
- Confirmar que nenhuma query de Entregas roda fora da rota `entregas`.

Commit sugerido: `refactor(cliente-detalhe): extract deliveries tab`

---

## Task 5 — Redes sociais e Relatórios

### Redes sociais

Criar:

- `tabs/RedesSociaisTab.tsx`
- `components/InstagramSection.tsx`

Mover a seção do Instagram (hoje inline em `ClienteDetalhePage.tsx`) para o novo
componente, e reutilizar `TikTokSection.tsx` já existente (condicionado a
`feature_tiktok`, sem mudança de lógica).

As ações "Conectar Instagram" e "Ir para Analytics" (hoje ações do rail de navegação
antigo) passam a viver dentro dessa aba.

Processar e remover `ig_connected`, `ig_error` e `tt_error` da URL usando a API do React
Router (`useSearchParams`/`navigate` com `replace`, em vez do `window.history.replaceState`
cru usado hoje), preservando exatamente o comportamento atual de cada parâmetro:

- `ig_connected`: hoje tratado pelo hook `useInstagramActivationEvent(clienteId)` —
  preservar o disparo do evento `instagram_connected`.
- `ig_error`: hoje resolvido por `resolveIgError(igError)`. Quando o resultado é
  `{ kind: 'off_meta' }`, abre o `AlertDialog` controlado por `igOffMetaOpen`; quando é
  `{ kind: 'toast', level, i18nKey }`, dispara `toast.info`/`toast.error` conforme
  `level`. Ambos os caminhos devem sobreviver à extração.
- `tt_error`: hoje dispara `toast.error(t('detail.ttError'))`.
- Os três parâmetros devem ser processados exatamente uma vez, antes de serem removidos
  da URL — mesma garantia que o `useEffect` atual já dá via array de dependências.

Atualizar os imports que hoje buscam `InstagramSection` a partir de
`ClienteDetalhePage.tsx`.

### Relatórios

Criar `tabs/RelatoriosTab.tsx` com:

- `send_report_email`;
- `include_ai_analysis`;
- atalho para `/analytics/:id`.

Mover os textos hoje hardcoded (se houver) para `clients.json` (pt e en).

Após alterar uma preferência de relatório, invalidar `['cliente', clienteId]`.

### TDD

- Migrar os testes atuais do Instagram (renderização, callback OAuth de sucesso/erro).
- Testar exibição condicional de TikTok por `feature_tiktok`.
- Testar os toggles de Relatórios: sucesso, erro, invalidação da query.
- Testar que `agent` não vê nem consegue acessar `/clientes/:id/relatorios` (redireciona
  para Visão geral).
- Confirmar que nenhuma query de redes sociais roda fora de `redes-sociais`, nem de
  relatórios fora de `relatorios`.

Commit sugerido: `refactor(cliente-detalhe): extract social and reports tabs`

---

## Task 6 — Hub e Arquivos separados

### Hub

Criar `tabs/HubClienteTab.tsx` como adaptador para o `HubTab.tsx` já existente em
`apps/crm/src/pages/cliente-detalhe/HubTab.tsx` (não confundir com
`apps/crm/src/pages/configuracao/tabs/HubTab.tsx`, que é outra página).

- Carregar `getWorkspaceSlug` somente nessa rota.
- Manter o comportamento atual de token e abertura externa do Hub.
- Exibir `RoleRestrictionNotice` para `agent` quando restrito (comportamento já
  existente em `ClienteDetalhePage.tsx`, só precisa ser preservado no novo local).
- Preservar as abas internas de Acesso, Briefing, Marca, Páginas e Ideias que já
  existem dentro do `HubTab` atual.

### Arquivos

Criar `tabs/ArquivosTab.tsx` a partir do bloco `ClienteArquivosSection` hoje inline em
`ClienteDetalhePage.tsx`.

- Buscar a pasta por `source_type = 'client'` e `source_id = clienteId`, preservando
  exatamente a consulta atual — inclusive o uso de `.single()` sem checar `error`, o que
  hoje faz "sem pasta" e "erro real" (RLS/rede) aparecerem da mesma forma (estado
  vazio). Este plano não estende esse comportamento; é puro carry-over, não é bug desta
  tarefa.
- Carregar `getFolderContents` somente depois de encontrar a pasta.
- Preservar o limite inicial de 12 arquivos (`slice(0, 12)`) e o botão "Ver mais", que
  hoje NÃO pagina em página — ele navega para `/arquivos`. Manter esse comportamento tal
  como está; não introduzir paginação real nesta tarefa.

### TDD

- Manter a suíte existente de `HubTab.test.tsx` (`pages/cliente-detalhe/__tests__/`)
  funcionando contra o novo adaptador.
- Testar Hub para `owner`/`admin` e o aviso de restrição para `agent`.
- Testar token válido, expirado e ausente.
- Testar Arquivos carregando, vazio, pasta inexistente (mesmo estado vazio de hoje — não
  é objetivo desta tarefa diferenciar de erro real), e mais de 12 itens ("Ver mais"
  continua navegando para `/arquivos`, não é paginação em página).
- Confirmar que Hub não dispara query de Arquivos e Arquivos não dispara query de Hub.

Commit sugerido: `refactor(cliente-detalhe): split hub and files tabs`

---

## Task 7 — Financeiro e isolamento de dados

### Alterações

Criar `tabs/FinanceiroTab.tsx`.

Mover:

- os três KPIs financeiros;
- contratos;
- transações;
- `ClienteFinanceEmptyState.tsx` (já existe, só precisa ser consumido pelo novo local);
- a formatação financeira já usada hoje.

Proteção redundante nas queries:

```ts
enabled: canSeeFinancials === true;
```

Além da proteção de query, a rota `/clientes/:id/financeiro` deve ser bloqueada pelo
layout (Task 2) antes mesmo de `FinanceiroTab` montar — isolamento em duas camadas. O
guard da Task 2 já resolve o estado `'unknown'` como carregamento (não negação),
espelhando `financialGuardOutcome` de `AppLayout.tsx`; `FinanceiroTab` não precisa
reimplementar esse three-state, só confiar que nunca monta em estado `'unknown'`.

### TDD

- `owner`/`admin` com capacidade autorizada;
- `admin` restrito (sem `canSeeFinancials`);
- `agent`;
- revogação da capacidade "ao vivo" (enquanto a aba está aberta);
- acesso direto à URL sem permissão;
- contratos e transações vazios;
- cálculo de valor recebido e pendente;
- ausência COMPLETA de chamadas a `getContratos`/`getTransacoes` quando
  `canSeeFinancials` for `false` — não só a UI escondida.

Migrar `ClienteFinanceResponsive.test.tsx` (já existe em `__tests__/`) para validar
contra `FinanceiroTab`.

Commit sugerido: `refactor(cliente-detalhe): isolate financial tab`

---

## Task 8 — Estilos, i18n e remoção do legado

### Estilos

Criar classes CSS próprias para o shell do cliente (não reaproveitar
`.cliente-detalhe-nav*`), reutilizando tokens e o comportamento visual de
Configurações:

- desktop ≥ 1101px: navegação lateral agrupada nos três grupos;
- < 1101px: abas horizontais roláveis;
- links ativos com `aria-current`;
- foco visível e alvos de toque de pelo menos 44px no mobile;
- sem `position: fixed` fora do padrão já documentado para UI ancorada na sidebar
  (`DESIGN_SYSTEM.md`), sem `IntersectionObserver`, sem navegação por scroll;
- sem depender de `position: sticky` (quebrado pelo `overflow-x: hidden` do `#root`).

Remover de `style.css`:

- `.cliente-detalhe-nav` antigo e suas variantes;
- estilos desktop/mobile do rail antigo;
- `scroll-margin-top` dos IDs `sec-*`;
- reserva de espaço lateral criada para o rail antigo;
- regras responsivas que só existiam para sustentar a página longa de âncoras.

### i18n

Adicionar em `clients.json` pt e en:

- nomes das sete abas;
- nomes dos três grupos ("Cliente", "Canais e análise", "Gestão");
- títulos, descrições e estados vazios extraídos nas tarefas anteriores;
- textos hardcoded que restarem em Relatórios;
- labels acessíveis da navegação.

### Limpeza

- Remover `clienteDetalheNav.model.ts` antigo (substituído por `clienteTabs.model.ts`
  na Tarefa 2).
- Remover os IDs `sec-*` que sobrarem no DOM.
- Remover imports mortos.
- Atualizar testes estáticos que ainda apontavam para o `ClienteDetalhePage.tsx`
  monolítico.
- Manter `ResponsiveCardRail` apenas se alguma aba ainda precisar dele internamente.
- Confirmar que `ClienteDetalhePage.tsx` terminou como layout puro — carregamento do
  cliente, cabeçalho, `ClienteEditDialog`, `ClienteDetalheNav`, `<Outlet />` — sem
  lógica de domínio das sete áreas.

### TDD e responsividade

- desktop com navegação lateral;
- tablet e mobile com faixa horizontal;
- aba ativa visível dentro da faixa rolável;
- navegação por teclado (tab order, Enter/Space nos links);
- ausência de overflow horizontal na página inteira (só a faixa de abas rola);
- nomes longos de cliente não quebram o cabeçalho;
- visibilidade condicional (Relatórios/Financeiro ausentes) sem reordenar as abas
  restantes.

Commit sugerido: `refactor(cliente-detalhe): finalize responsive tab layout`

---

## Compatibilidade adicional

- Atualizar CTAs cujo propósito explícito seja reconectar redes sociais para apontar
  diretamente a `/clientes/:id/redes-sociais`.
- Links genéricos de clientes podem continuar usando `/clientes/:id` — o redirect para
  Visão geral (Tarefa 2) cobre isso.
- Não alterar os redirects das edge functions de Instagram ou TikTok; o redirect
  interno do CRM (Tarefa 2) é quem interpreta os parâmetros OAuth.
- Nenhuma migration, alteração de RLS ou mudança de contrato backend.

## Verificação final obrigatória

Depois da Tarefa 8, antes da revisão final de branch, rodar primeiro as suítes
direcionadas da pasta `cliente-detalhe` e do `store`, depois exatamente:

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json

npm run test
npm run test:functions
npm run lint
npm run format:check
```

### Critérios finais

- `/clientes/:id` continua válido.
- Refresh em qualquer aba mantém o conteúdo correto.
- Cada aba carrega apenas seus próprios dados.
- Financeiro nunca é buscado nem renderizado sem `canSeeFinancials`.
- Fluxos de aprovação e rearm permanecem intactos.
- OAuth retorna para Redes sociais sem perder parâmetros ou o evento
  `instagram_connected`.
- Todas as funcionalidades existentes continuam acessíveis.
- `ClienteDetalhePage.tsx` contém apenas responsabilidades de layout.

## Premissas

- Nenhuma alteração de banco, RLS ou edge function é necessária.
- As funcionalidades atuais serão preservadas; a mudança é de arquitetura, navegação e
  carregamento.
- Rótulos em português e inglês.
- Visual segue os tokens existentes e o padrão de Configurações, com classes próprias
  para não acoplar as duas páginas.
