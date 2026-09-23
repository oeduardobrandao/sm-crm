# "Minha fila" em Entregas + teaser no Dashboard

Referências de código são `caminho:linha` relativos a `apps/crm/src/` salvo indicação.
Mockup aprovado pelo PO em 2026-09-23. Nenhuma mudança de backend ou schema.

## Contexto e objetivo

Um membro da equipe (designer, redator) hoje descobre "o que fazer agora" cruzando três
lugares: o Kanban de Fluxos (etapa ativa do fluxo, sem os posts), o quadro Publicações
(posts, sem prazo de etapa) e o card "Minhas pendências" do Dashboard (só agents, ignora
processos individuais, sem data de publicação). Nenhum deles ordena por urgência real nem
mostra a margem entre o prazo da etapa e a data de publicação.

"Minha fila" é uma vista nova de Entregas que responde, para um membro: quais posts estão
comigo agora, em que ordem atacar, quando cada um publica e quanto de margem sobra. O
Dashboard ganha um teaser com os 3 primeiros itens da mesma fila.

## Não-objetivos

- Nenhuma RPC, tabela, coluna ou edge function nova. Tudo é derivado do que Entregas já
  carrega.
- Não muda a semântica de "responsável" em nenhuma outra vista; não cria etapa por cargo.
- Não substitui o card "Hoje" (`TodayCard`) nem o remodela.
- Não adiciona filtros (cliente, tipo, status) à fila na v1. Só o seletor de membro.
- Não adiciona drag-and-drop, priorização manual ou "concluir" inline.

## UX

### Aba

Sexta aba em `VIEW_TABS` (`pages/entregas/EntregasPage.tsx:105-111`), depois de
"Concluídas": `{ id: 'fila', label: 'Minha fila', icon: <ListChecks /> }` (lucide).
`ActiveView` ganha `'fila'` (`pages/entregas/viewQuery.ts:9,17`). `VIEW_ICONS` em
`pages/entregas/components/VistasTabs.tsx:17` é `Record<ActiveView, ...>` e precisa da
entrada `fila` (o `tsc` acusa se faltar).

Os toggles Etapas/Status (`ModeToggle`) e Todos/Fluxos/Posts (`EntidadeToggle`) **já
ficam ocultos sem mudança**: `activeMode` força `'entregas'` para qualquer vista fora de
kanban/calendar/list (`EntregasPage.tsx:428-431`) e as duas condições de render só aceitam
essas três vistas (`:1197`, `:1203-1205`). A barra de filtros e a busca, porém, apareceriam
(`showFilters`, `:731-732`): `showFilters` passa a excluir `'fila'` também. Ver Decisões.

### Layout da vista (`MinhaFilaView`)

```
[Fila de: (Select: membro) ▾]                         12 posts · 3 atrasados

┌ Comece por aqui ─────────────────────────────────────────────────────┐
│ Carrossel dia das mães            Dra. Marina · Fluxo Maio · Design  │
│ etapa vence 22 set (1d atrasado)  publica 25 set · 14h   [sem margem]│
└──────────────────────────────────────────────────────────────────────┘

▾ Atrasado (3)
  ▸ Dra. Marina · Fluxo Maio · Design · [1d atrasado]            ← cabeçalho de fluxo
      Carrossel dia das mães        publica 25 set · 14h  [sem margem]
      Reels bastidores              publica 27 set · 10h  [margem 2d]
    Post avulso X · Individual · Copy                            ← linha avulsa
                                    publica 30 set · 09h  [margem 5d]
▾ Hoje (2)
▾ Amanhã (0)
▸ Próximos 7 dias (4)
▸ Depois (2)
▸ Sem prazo (1)

Chegando
    Stories evento         Dra. Marina · Fluxo Maio · agora em Copy (Nathalie) · chega ~24 set
```

- Cabeçalho: seletor de membro (shadcn `Select`, mesma altura dos pills de filtro) e um
  resumo à direita `N posts · M atrasados` (o "M atrasados" só com M > 0, em `--danger`).
- "Comece por aqui": card destacado (`border-left: 3px solid var(--primary-color)`,
  `background: var(--surface-1)`) com o primeiro item da fila. O item **continua** na sua
  seção logo abaixo; a linha correspondente recebe a mesma borda esquerda.
- Seções na ordem fixa `Atrasado, Hoje, Amanhã, Próximos 7 dias, Depois, Sem prazo`, cada
  uma colapsável com contagem no título. Seções vazias aparecem colapsadas com `(0)` e sem
  chevron ativo. Atrasado/Hoje/Amanhã abrem expandidas; as outras três, colapsadas. Estado
  de expansão é `useState` local (não persiste).
- Cabeçalho de fluxo (grupo): `Cliente · Título do fluxo · Etapa` + chip de prazo
  (`formatEtapaPrazo(card.deadline)`, `pages/entregas/etapaPrazo.ts:192`) + contagem de
  posts. Clicável (abre o drawer do fluxo).
- Linha de post: título, tag de tipo (`TIPO_LABELS`), chip de status
  (`PostStatusChip`, `pages/entregas/components/PostStatusChip.tsx:24`, com o registry
  de `useStatusRegistry`), `publica <formatPostDate(scheduled_at)>` ou
  `sem data de publicação`, chip de margem (§ Margem). Linha avulsa fora de grupo mostra
  ainda `Cliente · Individual · Etapa` na segunda linha (mesma convenção
  "Individual · <etapa>" das Publicações, `EntregasPage.tsx:893-894`).
- Tag `responsável pelo post` (pill neutra, `var(--text-muted)`) quando a linha entrou
  pela regra de responsável do post e não pela etapa.
- Chegando: lista plana abaixo das seções, sem agrupamento e sem card de destaque.

### Responsivo

Mesmo contrato de breakpoints de `EntregasFilters` e do próprio Entregas (`min-[901px]`).
Abaixo de 901px: data de publicação e chip de margem descem para uma segunda linha sob o
título; o cabeçalho de fluxo quebra em duas linhas (cliente · fluxo / etapa + prazo). O
seletor de membro ocupa a largura toda. Nada `position: fixed`; nada ancorado à sidebar
(DESIGN_SYSTEM.md, seção Layout do CRM).

### Copy (PT-BR, sem travessão)

| Chave interna | Texto |
|---|---|
| tab | `Minha fila` |
| picker.label | `Fila de` |
| picker.placeholder | `Escolha um membro` |
| summary | `{n} posts · {m} atrasados` (singular: `1 post`, `1 atrasado`) |
| top.title | `Comece por aqui` |
| section.atrasado / hoje / amanha / proximos7 / depois / sem_prazo | `Atrasado` / `Hoje` / `Amanhã` / `Próximos 7 dias` / `Depois` / `Sem prazo` |
| row.publica | `publica {data}` (data via `formatPostDate`) |
| row.semData | `sem data de publicação` |
| row.assignee | `responsável pelo post` |
| margem.sem | `sem margem` |
| margem.n | `margem {n}d` |
| chegando.title | `Chegando` |
| chegando.subtitle | `Posts cuja próxima etapa é sua.` |
| chegando.row | `agora em {etapa} ({responsável})` · `chega ~{data}` ou `sem previsão` |
| chegando.semResp | `agora em {etapa} (sem responsável)` |
| empty.fila | `Nada na sua fila. Quando uma etapa ou um post for atribuído a você, ele aparece aqui.` |
| empty.outro | `Nada na fila de {nome}.` |
| empty.semMembro | `Seu usuário ainda não está vinculado a um membro da equipe. Peça a um administrador para fazer o vínculo na página Equipe. Você ainda pode ver a fila de outra pessoa pelo seletor acima.` |
| error | `Não foi possível carregar a fila. Recarregue a página.` |
| teaser.title | `Minha fila` |
| teaser.link | `Ver minha fila` |
| teaser.empty | `Nada na sua fila.` |
| teaser.more | `+{n} na fila` |
| teaser.semMembro | `Vincule seu usuário a um membro da equipe para ver sua fila aqui.` |
| teaser.abrirEquipe | `Vincular na Equipe` |
| teaser.semMembroAgent | `Peça a um administrador para vincular seu usuário na página Equipe.` |

Datas de etapa: `formatEtapaDeadlineDay` (`etapaPrazo.ts:186`, "22 set"). Datas de
publicação: `formatPostDate` (`utils/postDate.ts:19`, "25 set · 14h"). O mockup mostrava
`dd/mm`; a spec segue os formatadores existentes (ver Decisões).

## Regras de inclusão

Entrada única: os posts de `useActivePosts` (`ActivePost[]`, todos os posts de fluxos
ativos mais todos os avulsos, `store/posts.ts:388-408`). Para cada post, a etapa em que ele
está vem de `postStageOf(card, entity)` (`pages/entregas/postStage.ts:37`), chamado
exatamente como `filteredPosts` faz (`EntregasPage.tsx:751-755`): `card` =
`cardsByWorkflowId.get(post.workflow_id)` para post amarrado; `entity` =
`postEntityByPostId.get(post.id)` para avulso com processo ativo. Um avulso sem processo
não tem etapa (`stage` undefined).

Um loop, nesta ordem, para o membro `me`:

1. **Exclusão por status.** `post.status ∈ {agendado, postado}` sai, sempre. `status` é a
   coluna canônica: para um status customizado o trigger do banco força `status` ao
   `behaves_as` da definição (`pages/entregas/statusRegistry.ts:109-114`,
   `store/posts.ts` comentário em `custom_status_id`), então a checagem em `post.status`
   já cobre customizados sem consultar o registry. O registry entra só na exibição
   (`registry.resolve(post).label`).
2. **Etapa comigo.** `stage?.responsavelId === me` → linha de etapa (`origem: 'etapa'`).
   Cobre fluxo (etapa ativa = `etapas.find(status==='ativo') ?? etapas[etapa_atual] ??
   etapas[0]`, `hooks/useEntregasData.ts:415-418`) e avulso com processo (step
   `estado==='ativo' ?? ordem===etapa_atual`, `pages/entregas/boardEntity.ts:158-159`).
3. **Responsável pelo post.** Senão, `post.responsavel_id === me` e `post.status ∈
   ASSIGNEE_PENDING_POST_STATUSES` (`store/posts.ts:571-576`: rascunho, revisao_interna,
   correcao_cliente, falha_publicacao) → linha de responsável (`origem: 'responsavel'`,
   tag `responsável pelo post`).
4. Um post entra **uma vez**: a regra 2 vence a 3 (por construção do `else`).

`aprovado_cliente` continua incluído pela regra 2 (decidido com o usuário em 2026-09-23).
`aprovado_interno` e `enviado_cliente` idem: se a etapa é minha, o post está comigo.

## Ordenação e agrupamento

### Prazo e bucket

`prazo` de uma linha:

- origem `etapa`: `stage.prazoDate` e `stage.deadline` (o `DeadlineInfo` da etapa).
- origem `responsavel`: se `stage` existe e `stage.prazoDate != null`, os mesmos; senão
  `scheduled_at` vira o prazo (`prazoDate = new Date(scheduled_at)`, `deadline =
  deadlineFromPrazoEfetivo(scheduled_at, null, now)`); sem os dois, `prazoDate = null` e
  `deadline = deadlineFromPrazoEfetivo(null, null, now)` (zerado).

**Chip de prazo só com `prazoDate != null`** (cabeçalho de grupo, "Comece por aqui", linha
do teaser). `formatEtapaPrazo(deadline)` lê `diasRestantes`/`horasRestantes`, e para uma
etapa de fluxo não iniciada `getDeadlineInfo` devolve `diasRestantes: prazo_dias`
(`store/workflows.ts:682-683`); para um step de processo sem prazo o fallback é zerado e
`postStage.ts:22-26` avisa que não deve ser lido como "vence em 0h". Sem esse gate, um
grupo em "Sem prazo" mostraria "5d restantes" ou "0h restantes".

Bucket, exclusivo, avaliado nesta ordem (mesma semântica de `matchesDeadlineFilter`,
`etapaPrazo.ts:148-157`, mas com faixas disjuntas):

| Bucket | Regra |
|---|---|
| `atrasado` | `deadline.estourado === true` |
| `atrasado` | senão, `prazoDate != null && dayNum(prazoDate) < dayNum(now)` (só cache velho: ver abaixo) |
| `hoje` | `dayNum(prazoDate) === dayNum(now)` |
| `amanha` | `dayNum(prazoDate) === dayNum(now + 1d)` |
| `proximos7` | `dayNum(now + 2d) <= dayNum(prazoDate) <= dayNum(now + 7d)` |
| `depois` | `dayNum(prazoDate) > dayNum(now + 7d)` |
| `sem_prazo` | `prazoDate == null` |

`estourado` vem da flag, nunca de `prazoDate < now`: `getDeadlineInfo` trata `data_limite`
como fim do dia (`store/workflows.ts:666-669`) enquanto `etapaDeadlineDateOf` devolve a
meia-noite local do mesmo campo (`etapaPrazo.ts:63-68`); recalcular a partir da data
marcaria como atrasada às 00:01 uma etapa que vence hoje. `dayNum` é o de
`etapaPrazo.ts:113` (dia local, sem aritmética de ms). `card.deadline` é calculado no
`useMemo` de cards e só se move em refetch (`useEntregasData.ts:407-410`): `now` no builder
decide Hoje/Amanhã/7d/Depois. A segunda linha de `atrasado` na tabela existe só para o
caso de cache velho: `deadline` congelado num refetch de ontem, `prazoDate` de ontem,
`estourado` ainda false. Sem ela, esse item cairia em nenhuma faixa.

`FilaItem.deadline` de uma linha com prazo por `scheduled_at` (fallback da origem
`responsavel`) é construído por `deadlineFromPrazoEfetivo(scheduled_at, null, now)`
(`etapaPrazo.ts:89`), a única fábrica de `DeadlineInfo` a partir de um instante. Ela usa
semântica de instante (`estourado = scheduled_at < now`), o que para um `scheduled_at` de
hoje às 09:00 visto às 10:00 dá `estourado` true e bucket `atrasado`; é o comportamento
desejado (o post deveria ter publicado e não publicou).

Um card de fluxo pode ter `hasPrazo === true` com `prazoDate === null` (etapa ativa sem
`iniciado_em` e sem `data_limite`, `postStage.ts:48`): bucket por `prazoDate`, não por
`hasPrazo`.

### Grupos

Dentro de um bucket, os itens são **grupos**:

- `kind: 'fluxo'`: todos os posts de um mesmo `workflow_id` que caíram no mesmo bucket
  (prazo único, o da etapa ativa). Cabeçalho = card do fluxo.
- `kind: 'post'`: um avulso (com ou sem processo) ou um post amarrado cuja linha veio pela
  regra 3 mas com prazo por `scheduled_at` (não compartilha o prazo do fluxo). Sem
  cabeçalho.

Um post amarrado pela regra 3 que herdou o prazo da etapa do fluxo entra no grupo do fluxo
(mesmo prazo), com a tag `responsável pelo post` na linha.

Ordem dos grupos no bucket: `prazoDate` asc, `null` por último; empate pelo menor
`scheduled_at` entre os filhos (nulls por último); empate final por título do grupo
(`localeCompare('pt-BR')`). Ordem dos filhos no grupo: `scheduled_at` asc, nulls por
último, desempate por `id` (espelha `compareScheduledAtAscNullsLast`,
`store/posts.ts:21-31`).

`items` é a lista plana resultante (bucket → grupo → filho). `top = items[0]`. O teaser lê
`items.slice(0, 3)`.

## Margem

`margem = dayDiff(scheduled_at, prazoDate)` em dias de calendário **locais**: diferença
entre `startOfLocalDay(scheduled_at)` e `startOfLocalDay(prazoDate)` (a mesma
`dayDiff` de `pages/dashboard/todayAgenda.ts:151-155`, movida para `etapaPrazo.ts` para
as duas usarem uma só). Hora do dia é ignorada nos dois lados: uma etapa que vence 22 set
23:59 e um post que publica 23 set 08:00 têm margem 1.

| Valor | Chip | Cor |
|---|---|---|
| `margem <= 0` | `sem margem` | `--danger` (fundo) / `--danger-text` (texto) |
| `1..2` | `margem {n}d` | `--warning` |
| `>= 3` | `margem {n}d` | `--success` |
| `scheduled_at == null` | `sem data de publicação` | `--text-muted`, sem chip de margem |
| `prazoDate == null` | chip omitido | (a seção já diz "Sem prazo") |

Para uma linha de origem `responsavel` cujo prazo **é** o `scheduled_at` (fallback), margem
seria zero por definição: chip omitido, só `publica ...`.

Usar `--danger-text` para o texto do chip vermelho: `--danger` puro não passa AA em fundo
claro (DESIGN_SYSTEM.md, "Two token systems").

## Chegando

Posts cuja **próxima** etapa tem `responsavel_id === me`, excluídos os que já entraram na
fila (regras 2/3) e os `agendado`/`postado`.

- Fluxo: `allEtapas` ordenado por `ordem`; próxima = primeira com `ordem >
  card.etapa.ordem`, sem olhar `status`. Seguro porque `revertEtapa` devolve a etapa que
  deixa para `pendente` (`store/workflows.ts:454`), então tudo depois da ativa é `pendente`.
- Processo individual: `process.steps` ordenado; próxima = primeira com `ordem >
  step.ordem` **e** `estado === 'pendente'`. `ignorado` e `herdado` ficam antes da ativa
  (spec 2026-09-10, linhas 361 e 472), mas o filtro explícito protege contra estados
  futuros.
- Linha por post: título · `Cliente · Fluxo` (ou `Cliente · Individual`) · `agora em
  {etapa} ({responsável atual})` · `chega ~{formatEtapaDeadlineDay(prazoDate atual)}` ou
  `sem previsão` quando `prazoDate == null`.
- Ordem: `scheduled_at` asc, nulls por último, desempate por `id`.
- **Agrupado por fluxo**, como as seções: a etapa de um fluxo é única para todos os seus
  posts (Lacunas), então um fluxo em Copy com 12 posts cuja próxima etapa é Design poria
  12 linhas na Chegando do designer. Grupo de fluxo = uma linha de cabeçalho (`Cliente ·
  Fluxo · agora em {etapa} ({responsável}) · chega ~{data}` + contagem), colapsada por
  padrão, expandível para as linhas de post. Avulsos ficam fora de grupo. Ordem dos grupos:
  menor `scheduled_at` dos filhos. `ChegandoItem` ganha `card` (já previsto) e a vista
  agrupa por `card.workflow.id`; o builder devolve a lista plana ordenada, o agrupamento é
  da vista (mesma divisão de responsabilidade das seções).

## Teaser do Dashboard

### Decisão

Um componente novo `MinhaFilaCard` renderizado em `pages/dashboard/DashboardPage.tsx`
logo abaixo de `<TodayCard />`, **para todos os papéis**. Sem membro vinculado (`useCurrentMembro`,
`hooks/useCurrentMembro.ts:9`) ele mostra o card "vincule seu usuário" (§ Conteúdo), para
qualquer papel.
`AgentPendingSection` (só agents, `DashboardPage.tsx:84`) **perde** as seções "Entregas ·
etapas" e "Entregas · posts" (`components/AgentPendingSection.tsx:251-302`) e as duas
queries `agent-pending-etapas`/`agent-pending-posts` que as alimentam (`:148-157`); fica só
"Tarefas". Assim nenhum post aparece duas vezes entre teaser e Minhas pendências, e o
owner/admin que também produz (comum em agência pequena) ganha a fila sem virar agent.

`TodayCard` continua emitindo `etapa` e `post_pendente` para agents
(`todayAgenda.ts:250-268, 334-354`). É sobreposição anterior a este trabalho, com outro
enquadramento (agenda por data); fica como está. Ver Lacunas.

### Conteúdo

Card compacto (`className="card animate-up"`, mesmo invólucro de `AgentPendingSection`):
título `Minha fila`, link `Ver minha fila` → `/entregas?view=fila`, até 3 linhas
(`items.slice(0,3)`): título · cliente · chip de prazo da etapa
(`formatEtapaPrazo` / `board-card-deadline` com `deadline-overdue|warning|ok` como
`AgentPendingSection.tsx:200-205`) · `publica {data}`. Abaixo, `+{n} na fila` quando
`items.length > 3`. Vazio: `Nada na sua fila.` Sem "Chegando" no teaser.

**Sem membro vinculado:** mesmo invólucro, título `Minha fila`, texto `teaser.semMembro`.
Owner/admin (`AuthContext`) veem o link `teaser.abrirEquipe` → `/equipe`; agent vê
`teaser.semMembroAgent` (sem link, não gerencia a Equipe). O estado "sem membro" de
`AgentPendingSection` sai, para o agent não ver o aviso duas vezes; a seção Tarefas
simplesmente não renderiza sem membro.

Cada linha é um `Link` para `/entregas?view=fila&drawer={workflow_id}&post={id}` (amarrado)
ou `/entregas?view=fila&post={id}` (avulso), padrão de `postHref`
(`todayAgenda.ts:180-184`) acrescido de `view=fila`. Funciona porque `consumeParams` só
remove `drawer`/`post` e preserva o resto (`EntregasPage.tsx:390-402`), e `initialQuery`
lê `view` na montagem (`:127`). Nada a mudar em `vercel.json` (query string em rota já
listada).

### Custo de dados

`useEntregasData` monta ~15 queries (capas, tokens do hub, seis contagens): o teaser não
pode chamá-lo. Um hook `useMinhaFilaData()` observa só as seis chaves abaixo, todas já
usadas por Entregas. O ganho do cache compartilhado é render instantâneo ao navegar
(Dashboard → Entregas ou vice-versa mostra o dado em cache na hora), **não** menos
requisições: cada observer aplica o próprio `staleTime`, e Entregas mantém o padrão (0),
então ao abrir a página ele ainda refaz em background, como hoje. Reduzir refetch em
Entregas está fora de escopo.

| Chave | Fn | Já carregada no Dashboard? |
|---|---|---|
| `['workflows']` | `getWorkflows` | não |
| `['all-active-etapas']` | `fetchEtapasMap` (abaixo) | não (Dashboard usa `getAllActiveEtapas` cru sob `['agent-pending-etapas']` em `AgentPendingSection.tsx:148-152` e `useTodayAgenda.ts:108-113`) |
| `['clientes']` | `getClientes` | sim (`DashboardPage.tsx:60`) |
| `['membros']` | `getMembros` | sim (`useCurrentMembro`) |
| `['active-posts']` | `getActivePosts` | não |
| `['post-processes','vigentes']` | `getVigentePostProcesses` | não |

Quatro requisições novas (`workflows`, `all-active-etapas`, `active-posts`,
`post-processes`), duas leves. O teaser passa `staleTime: 60_000` nos seus observers (só neles) para
não refazer tudo a cada volta ao Dashboard; o observer de `active-posts` do teaser **não**
passa `refetchInterval` (o poll de publicação é do `useActivePosts` de Entregas,
`hooks/useActivePosts.ts:20-21`, e é por observer). Com a saída das duas queries de
`AgentPendingSection`, o Dashboard de um agent troca `agent-pending-etapas` +
`agent-pending-posts` por essas quatro. `useTodayAgenda` segue com `agent-pending-etapas`;
unificar a chave é follow-up (Lacunas).

**Armadilha da chave compartilhada.** O `queryFn` de `['all-active-etapas']` em
`useEntregasData.ts:255-267` **não** devolve linhas: devolve `Map<workflowId,
WorkflowEtapa[]>`. TanStack compartilha o cache por chave, seja quem for o observer que
buscou; se o teaser observasse a mesma chave com `getAllActiveEtapas` como `queryFn`, quem
montasse primeiro decidiria a forma e o outro consumidor quebraria. Por isso o `queryFn`
(linhas → Map) é extraído para `export async function fetchEtapasMap()` ao lado de
`buildBoardCards`, e os dois hooks usam a mesma função. As outras chaves já apontam para a
mesma função do store nos dois lados.

Gate: nada é buscado até `membro != null` (`enabled`), como `AgentPendingSection` já faz.

## Arquitetura

### Novos

**`pages/entregas/minhaFila.ts`** (puro, sem React):

```ts
export type FilaBucket = 'atrasado' | 'hoje' | 'amanha' | 'proximos7' | 'depois' | 'sem_prazo';
export const FILA_BUCKET_ORDER: FilaBucket[];
export const FILA_BUCKET_LABELS: Record<FilaBucket, string>;

export interface FilaItem {
  key: `post:${number}`;
  post: ActivePost;
  origem: 'etapa' | 'responsavel';
  /** postStageOf(card, entity); undefined para avulso sem processo (só origem 'responsavel'). */
  stage: PostStage | undefined;
  /** Card do fluxo quando o post é amarrado; usado por onFluxoClick e pelo cabeçalho do grupo. */
  card: BoardCard | undefined;
  entity: PostEntity | undefined;
  prazoDate: Date | null;
  deadline: DeadlineInfo;
  bucket: FilaBucket;
  margem: { kind: 'sem_margem' | 'dias'; dias: number } | { kind: 'sem_data' } | { kind: 'sem_prazo' };
}

export interface FilaGroup {
  key: `fluxo:${number}` | `post:${number}`;
  kind: 'fluxo' | 'post';
  card?: BoardCard;            // kind 'fluxo'
  prazoDate: Date | null;
  deadline: DeadlineInfo;
  items: FilaItem[];
}

export interface FilaSection { bucket: FilaBucket; groups: FilaGroup[]; count: number }

export interface ChegandoItem {
  key: `post:${number}`;
  post: ActivePost;
  card: BoardCard | undefined;
  entity: PostEntity | undefined;
  etapaAtual: string;
  responsavelAtual: string;      // '' quando sem responsável
  chegaDate: Date | null;        // prazoDate da etapa atual
  proximaEtapa: string;
}

export interface MinhaFilaInput {
  cards: BoardCard[];
  posts: ActivePost[];
  postEntities: PostEntity[];
}

export interface MinhaFila {
  items: FilaItem[];             // plana, na ordem final
  top: FilaItem | null;          // items[0]
  sections: FilaSection[];       // sempre as 6, na ordem FILA_BUCKET_ORDER
  chegando: ChegandoItem[];
  counts: { total: number; atrasados: number };
}

export function buildMinhaFila(input: MinhaFilaInput, membroId: number, now: Date): MinhaFila;
export function filaBucketOf(prazoDate: Date | null, deadline: DeadlineInfo, now: Date): FilaBucket;
export function margemOf(scheduledAt: string | null, prazoDate: Date | null): FilaItem['margem'];
export function nextEtapaResponsavel(card: BoardCard | undefined, entity: PostEntity | undefined): number | null;
```

`buildMinhaFila` constrói `cardsByWorkflowId` e `postEntityByPostId` internamente a partir
de `cards`/`postEntities` (mesmos mapas de `EntregasPage.tsx:579, 737-740`), para que o
Dashboard não precise replicá-los.

**`pages/entregas/hooks/useMinhaFilaData.ts`**: compõe as seis queries da tabela acima,
monta `cards` com `buildBoardCards` (abaixo) e `postEntities` com `toPostEntity`
(`boardEntity.ts:153`, com `clientes`/`membros`, sem capas/avatares), e devolve
`{ cards, posts, postEntities, isLoading, isError }`. Usado só pelo teaser; a vista em
Entregas reusa o que a página já tem.

**`pages/entregas/views/MinhaFilaView.tsx`**: recebe `fila: MinhaFila`, `membros`,
`membroId`, `currentMembroId`, `registry`, `isLoading`, `isError`, `onMembroChange`,
`onPostClick(post)`, `onFluxoClick(workflowId)`. Sem fetch próprio.

**`pages/dashboard/components/MinhaFilaCard.tsx`**: `useCurrentMembro` + `useMinhaFilaData`
+ `buildMinhaFila` + `useStatusRegistry`. Queries component-local (o teste de
`DashboardPage` mocka `useQueries` por índice, `pages/dashboard/__tests__/DashboardPage.test.tsx:85`,
e nada pode entrar naquele batch).

### Modificados

| Arquivo | Mudança |
|---|---|
| `pages/entregas/viewQuery.ts` | `ActiveView` += `'fila'`; `VIEWS` idem; `EntregasViewState` += `filaMembro: number \| null`; `serializeEntregasQuery` escreve `membro=<id>` só quando `view === 'fila'` e `filaMembro != null`; `parseEntregasQuery` lê `membro` com `parseInt` + `isNaN` guard, `null` se ausente. **Não** entra em `FilterState` (mockado literalmente em `EntregasPage.test.tsx:116+` e espelhado campo a campo em `postsFiltersActive`/`filtersToReveal`). |
| `pages/entregas/hooks/useEntregasData.ts` | Extrair o loop de `cards` (`:411-454`) para `export function buildBoardCards(activeWorkflows, etapasMap, clientes, membros, extras?: { covers?, clienteAvatars?, hubTokens?, workspaceSlug? }): BoardCard[]` e o `queryFn` de `['all-active-etapas']` (`:257-266`) para `export async function fetchEtapasMap(): Promise<Map<number, WorkflowEtapa[]>>`; o hook passa a chamar os dois e passa a devolver `isError` agregado (§ Estados). Comportamento idêntico para as vistas existentes; `useEntregasData.test.ts` segue verde. |
| `pages/entregas/hooks/useActivePosts.ts` | Devolver também `isError`. Trocar `query.data ?? []` por uma constante `EMPTY_POSTS` estável (aviso de `useEntregasData.ts:46-55`). |
| `pages/entregas/EntregasPage.tsx` | `VIEW_TABS` += fila; `useActivePosts(postsMode \|\| semProcessoMode \|\| activeView === 'fila')` (`:718-720`); `showFilters` exclui `'fila'` (`:731`); estado `filaMembro` semeado de `initialQuery.filaMembro`, incluído em `currentQuery`; `useCurrentMembro()` para o default; `useStatusRegistry()` (já existe em `hooks/useStatusRegistry.ts`); `useMemo(() => buildMinhaFila({cards, posts: activePosts, postEntities}, membroId, new Date()))` só quando `activeView === 'fila'`; render de `<MinhaFilaView>` com `onPostClick={handlePostClick}` (`:649-661`) e `onFluxoClick={handleFluxoClick}` (`:663-667`); `applySavedView` (`:696-704`) também faz `setFilaMembro(parsed.filaMembro)`, senão uma vista salva "fila de X" volta em silêncio para a própria; `captureEvent` de abertura (§ Analytics). |
| `pages/entregas/components/VistasTabs.tsx` | `VIEW_ICONS.fila`. |
| `pages/entregas/etapaPrazo.ts` | Receber `dayDiff`/`startOfLocalDay` (hoje em `todayAgenda.ts:140-155`); `todayAgenda.ts` passa a importar de lá (mantendo o re-export para não quebrar `todayAgenda.test.ts`). |
| `hooks/useCurrentMembro.ts` | Devolver também `isError` e `isSuccess` (§ Estados). |
| `pages/dashboard/DashboardPage.tsx` | `<MinhaFilaCard />` após `<TodayCard />`. |
| `pages/dashboard/components/AgentPendingSection.tsx` | Remover seções etapas/posts e suas queries e o aviso de sem membro (agora no teaser); manter Tarefas e o vazio. |
| `packages/i18n/locales/pt/dashboard.json` e `en/dashboard.json` | Chaves `minhaFila.*` do teaser (título, link, vazio, `+{n} na fila`, `publica`). |
| `lib/analytics.ts:9` | Dois eventos novos na união `AnalyticsEvent`. |

### Membro selecionado

- Default: `useCurrentMembro().membro?.id`. URL `membro=<id>` vence quando aponta para um
  membro existente em `membros`; id desconhecido cai no default e é removido da URL pelo
  sync (`:441-448`).
- A reconciliação (validar `membro=<id>`, descartar id desconhecido, normalizar o próprio
  id para null) **só roda depois que a query `['membros']` resolveu com sucesso** (e
  `useCurrentMembro` também). Antes disso `membros` é `[]` e todo deep link válido pareceria
  desconhecido: `filaMembro` fica como veio da URL, a vista mostra o estado de carregando e
  nada é reescrito na URL. Se `['membros']` falhar, o parâmetro é mantido intacto e a vista
  mostra o erro.
- `filaMembro` no estado guarda só a escolha **explícita** (null = "o próprio usuário");
  o id efetivo é `filaMembro ?? currentMembro?.id ?? null`. `serializeEntregasQuery` é
  pura e não conhece o membro logado, então a página normaliza antes de serializar:
  `filaMembro: efetivo === currentMembro?.id ? null : filaMembro`. Assim uma URL que chegou
  com `membro=<próprio id>` não fica presa explícita, o serializador omite `membro=` para a
  fila própria e uma vista salva "Minha fila" segue significando "a fila de quem abre".
  Escolher a si mesmo no seletor volta `filaMembro` para null.
- Só a URL persiste a escolha (sem chave nova em `entregasPrefs.ts`; hoje ele só guarda
  modo, entidade e sorts de coluna, `pages/entregas/entregasPrefs.ts`). A vista ativa
  também não é persistida em prefs (verificado: `loadLastMode`/`loadLastEntidade` só);
  `/entregas` sem query continua abrindo o Kanban. Vistas salvas (`VistasTabs`) capturam
  `currentQuery` e portanto podem guardar `view=fila` ou `view=fila&membro=12`.

### Gating de dados na vista

`useActivePosts` hoje só liga em Publicações e na seção Sem processo
(`EntregasPage.tsx:706-720`); a vista fila é o terceiro gatilho. `cards` e `postEntities`
já vêm de `useEntregasData` incondicionalmente. Nenhuma query nova em Entregas.

## Estados

| Estado | Vista (Entregas) | Teaser |
|---|---|---|
| Página carregando | Spinner de página já existente (`EntregasPage.tsx:978-986`) | Spinner dentro do card |
| `active-posts` carregando | Cabeçalho + spinner inline no lugar das seções | idem |
| Login sem membro vinculado | Seletor com placeholder `Escolha um membro`; corpo com `empty.semMembro`; ao escolher alguém, a fila dessa pessoa | Card "vincule seu usuário" (link para `/equipe` só para owner/admin) |
| Fila vazia (próprio) | `empty.fila` | `teaser.empty` |
| Fila vazia (outro membro) | `empty.outro` | n/a |
| Qualquer dependência obrigatória carregando | Cabeçalho + spinner inline; **nunca** o estado vazio | Spinner no card |
| Erro em qualquer dependência obrigatória | `error` inline, seletor continua | `error` inline |
| Chegando vazio | Seção "Chegando" omitida | n/a |

**Dependências obrigatórias** da fila: `workflows`, `all-active-etapas`,
`post-processes/vigentes`, `active-posts` e `membros` (+ `clientes` no teaser). Sem
qualquer uma delas o builder devolveria uma fila vazia ou incompleta com cara de
definitiva (itens por etapa somem sem etapas; avulsos com processo somem sem processos).
Regra: o estado vazio só aparece quando **todas** resolveram com sucesso; qualquer
`isError` mostra o erro em vez da fila.

- Entregas: o spinner de página já cobre o carregamento de `workflows`, etapas e
  processos (`useEntregasData.ts:479`), mas o hook não expõe erro. `useEntregasData`
  passa a devolver `isError` agregado (`workflows || etapasQuery || vigenteQuery`),
  lido só pela vista fila (demais vistas mantêm o comportamento atual). A vista combina
  isso com `isLoading`/`isError` de `useActivePosts` e da query de membros.
- Membros: `useCurrentMembro` (`hooks/useCurrentMembro.ts:9`) hoje devolve só
  `{ membro, isLoading }`, e `useEntregasData` troca a query por `EMPTY_MEMBROS` sem expor
  erro. `useCurrentMembro` passa a devolver também `isError` e `isSuccess` da mesma query
  `['membros']` (aditivo; chamadores atuais não mudam). É essa a fonte que a vista, o teaser
  e a reconciliação de `membro=<id>` (§ Membro selecionado) leem: reconciliar só com
  `isSuccess`; com `isError`, estado de erro e URL intacta.
- Teaser: `useMinhaFilaData` devolve `isLoading` = OR de `isLoading` das seis queries e
  `isError` = OR de `isError` das seis.

## Testes

Vitest, padrões de `pages/entregas/__tests__/*.test.ts` (fixtures inline como
`semProcesso.test.ts`, `vi.mock('../../../lib/supabase')` quando o import puxa o store).

**`pages/entregas/__tests__/minhaFila.test.ts`** (puro):
- inclusão: etapa de fluxo comigo inclui todos os posts do fluxo menos agendado/postado;
  avulso com processo cuja step ativa é minha; responsável do post só nos 4 status
  pendentes; post que casa nas duas regras aparece uma vez com `origem: 'etapa'`;
  status customizado com `behaves_as = 'postado'` (status canônico `postado`) sai.
- bucket: `estourado` → atrasado mesmo com `prazoDate` de hoje; `data_limite` hoje sem
  `estourado` → hoje; +1 → amanhã; +2 e +7 → proximos7; +8 → depois; `prazoDate` null →
  sem_prazo; `now` às 23:59 não muda o bucket (`dayNum`); `prazoDate` de ontem sem
  `estourado` → atrasado.
- fallback de responsável: sem stage usa `scheduled_at`; `scheduled_at` de ontem →
  atrasado; stage de outro membro com prazo → prazo do stage.
- grupos: dois posts do mesmo fluxo num grupo, ordenados por `scheduled_at` nulls last, id
  como desempate; grupos por `prazoDate` asc, null por último, empate por menor
  `scheduled_at`; `top === items[0]`; `sections` sempre 6 na ordem.
- margem: `<= 0` sem margem; 1 e 2 dias; 3; horas ignoradas (22 set 23:59 vs 23 set 08:00
  = 1); sem `scheduled_at`; sem `prazoDate`; fallback por `scheduled_at` omite o chip.
- chegando: próxima etapa do fluxo minha; step `pendente` seguinte minha; step `ignorado`
  depois da ativa (fixture artificial) é pulada; post já na fila não entra; agendado não
  entra; `chegaDate` null → `sem previsão`; ordem por `scheduled_at`.
- chip de prazo: `prazoDate` null com `deadline.diasRestantes = 5` (etapa não iniciada)
  não produz chip; idem com o fallback zerado de processo.

**`pages/entregas/__tests__/viewQuery.test.ts`**: round trip `view=fila&membro=12`;
`membro` ignorado fora de `fila`; `membro=abc` → null.

**`pages/entregas/views/__tests__/MinhaFilaView.test.tsx`** (diretório já existe, ao lado
de `ConcludedView.test.tsx`): renderiza 6 seções com contagens, expansão default (3
abertas), card "Comece por aqui", tag `responsável pelo post`, clique em linha chama
`onPostClick(post)`, clique no cabeçalho chama `onFluxoClick(id)`, Chegando agrupa por
fluxo com contagem e expande, estados vazio/sem membro/erro, troca de membro chama
`onMembroChange`.

**`pages/entregas/__tests__/EntregasPage.test.tsx`**: aba "Minha fila" existe;
`useActivePosts` recebe `true` com `?view=fila`; toggles Etapas/Status e Todos/Fluxos não
renderizam; barra de filtros não renderiza; `membro=12` na URL sobrevive ao sync;
`membro=<próprio id>` é normalizado para fora da URL; vista salva com `membro=12`
seleciona o membro 12. Esse arquivo mocka `../../../store` com um objeto literal
(`:14-21`), então `useCurrentMembro` (`@/store`, mesmo módulo) e `useStatusRegistry`
(`../store`) receberiam `getMembros`/`getPostStatusDefinitions` como `undefined`: mockar
`@/hooks/useCurrentMembro` e `@/hooks/useStatusRegistry` no topo do arquivo.

**`pages/entregas/hooks/__tests__/useEntregasData.test.ts`**: continua verde após a
extração de `buildBoardCards`; um caso direto para `buildBoardCards` (fallback
`etapas[etapa_atual]`, membro resolvido).

**`pages/dashboard/components/__tests__/MinhaFilaCard.test.tsx`**: sem membro mostra o card "vincule" (link `/equipe` para owner/admin, sem link para agent);
3 linhas + `+n na fila`; links com `view=fila`; vazio; erro.
**`AgentPendingSection.test.tsx`**: remover asserções das seções de etapas/posts.
**`DashboardPage.test.tsx`**: mock de `../components/MinhaFilaCard`.

Browser (staging): fila própria e de outro membro, claro/escuro, 375px e 1280px; deep link
do teaser abre o drawer sobre a fila; `?view=fila` numa vista salva.

## Analytics

`captureEvent` (`lib/analytics.ts:177`) com dois eventos novos na união (`:9`):

- `minha_fila_opened` `{ membro_is_self: boolean, total: number, atrasados: number,
  chegando: number }`: uma vez por montagem da vista com `activeView === 'fila'` e dados
  prontos (ref de "já disparou", como `explainerSeen`, `EntregasPage.tsx:295-300`); dispara
  de novo ao trocar o membro.
- `minha_fila_teaser_clicked` `{ target: 'item' | 'ver_fila', position?: 0|1|2 }`: no
  clique de linha ou do link do teaser, com `sendInstantly: true` (navega no mesmo tick,
  `lib/analytics.ts:168-175`).

## i18n

Entregas não usa `react-i18next` (nenhum `useTranslation` em `pages/entregas/`): a vista
segue com strings PT-BR literais, como o resto da página. O Dashboard usa
`useTranslation('dashboard')` com `packages/i18n/locales/pt/dashboard.json` **e**
`en/dashboard.json`: o teaser recebe chaves `minhaFila.*` nos dois arquivos (a versão em
inglês é tradução direta; o produto é PT-BR).

## Lacunas conhecidas

- `getAllActiveEtapas` e `getVigentePostProcesses` trazem o workspace inteiro e o filtro
  por membro é no cliente; cresce linearmente com a conta.
- `getActivePosts` não é paginado (`store/posts.ts:388-408`, sem `fetchAllPaged`): o
  max-rows do PostgREST corta silenciosamente contas grandes. Já afeta Publicações; a fila
  herda.
- A etapa de um fluxo é única para todos os seus posts: não existe "etapa por post" em
  fluxo, então um fluxo em Design com 12 posts coloca os 12 na fila do designer mesmo que
  10 já estejam prontos. O status do post é a única pista (chip).
- Em `modo_prazo = 'padrao'` uma etapa pendente não tem data (`iniciado_em` null): o
  "chega ~" de Chegando só existe quando a etapa atual tem prazo resolvido.
- Sem etapa por cargo: `responsavel_id` é sempre um membro específico.
- `useTodayAgenda`/`AgentPendingSection` usam `['agent-pending-etapas']` para a mesma fn de
  `['all-active-etapas']`: dois fetches iguais no Dashboard de um agent. Unificar a chave é
  follow-up fora desta spec.
- `TodayCard` continua listando `etapa` e `post_pendente` para agents; sobreposição com o
  teaser aceita.
- `card.deadline` congela no último refetch: uma aba deixada aberta por horas pode mostrar
  uma etapa como "Hoje" depois de estourar. Mesmo comportamento do Kanban.

## Decisões / divergências

1. **Assinatura do builder.** Aprovado: `buildMinhaFila({cards, posts, processes}, ...)`.
   Spec: `{cards, posts, postEntities}`. `postStageOf` recebe `PostEntity`
   (`postStage.ts:37-40`), e `toPostEntity` precisa de `clientes`/`membros`
   (`boardEntity.ts:153`); passar processos crus obrigaria o builder a repetir essa
   projeção. `PostEntity` é o que Entregas já tem.
2. **Barra de filtros oculta.** O design só mencionava os toggles; `showFilters`
   (`EntregasPage.tsx:731`) mostraria pills e busca. Ocultar, porque `filters` não é
   aplicado à fila na v1 e um filtro ativo invisível seria enganoso.
3. **Toggles não precisam de mudança.** Já ocultos por `activeMode` (`:428-431`) e pelas
   condições em `:1197` e `:1203`. Registrado para que ninguém adicione uma condição
   redundante.
4. **`membro` fora de `FilterState`.** Vai em `EntregasViewState` (§ Arquitetura).
5. **Formato de data.** Mockup: `dd/mm`. Spec: `formatEtapaDeadlineDay` ("22 set") e
   `formatPostDate` ("25 set · 14h"), os formatadores que o resto de Entregas usa.
6. **Linha de responsável com etapa de outro membro.** O design só dizia "sem prazo de
   etapa cai em `scheduled_at`". Spec: se o post está numa etapa com prazo (de outra
   pessoa), usa esse prazo e entra no grupo do fluxo; só sem prazo cai em `scheduled_at`.
   Motivo: o prazo da etapa é a data real que pressiona o post.
7. **Buckets exclusivos.** `proximos7` da barra de filtros inclui hoje e amanhã
   (`etapaPrazo.ts:157`); na fila as faixas são disjuntas (+2..+7). `PrazoPreset` não é
   estendido (é serializado em URL e vistas salvas); `FilaBucket` é um tipo próprio.
8. **Atrasado pela flag `estourado` primeiro**, e só depois por dia de calendário
   (`dayNum(prazoDate) < dayNum(now)`) para o caso de cache velho (§ Ordenação). Nunca por
   `prazoDate < now` em instante, que marcaria às 00:01 uma `data_limite` de hoje.
9. **Teaser para todos os papéis**, não só agents; `AgentPendingSection` perde as duas
   seções de Entregas em vez de ganhar o teaser dentro dele.
10. **Chegando: próxima etapa de fluxo sem filtro de status** (justificado por
    `revertEtapa`); de processo, com `estado === 'pendente'`.
11. **Persistência do membro só na URL.** Sem chave nova em `entregasPrefs`.

## Decisões do usuário (2026-09-23)

1. `aprovado_cliente` **fica** na fila.
2. Tag `responsável pelo post` **só** nas linhas de origem `responsavel`; não em linhas de etapa.
3. Sem membro vinculado, o teaser mostra um card "vincule seu usuário" para todos os papéis.

## Perguntas abertas

1. Chegando com `scheduled_at` vazio em todos os itens vira uma lista "sem ordem"; vale
   ordenar por `chegaDate` antes de `scheduled_at`?
