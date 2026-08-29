# Posts avulsos (independentes de fluxo) — Design

Data: 2026-08-28 · Status: aprovado (brainstorming com mockups)

## Problema

Usuários vindos de ferramentas simples (Notion, Trello) têm dificuldade com o modelo de
fluxos. O produto ganha uma forma mais simples de trabalhar: posts que existem sem fluxo,
caminhando apenas pelos status.

O trilho de status já é o trilho do post hoje: posts não têm referência a etapa, e o painel
"Como funciona" da página Entregas já diz que fluxo anda por etapa, post anda por status, e
os dois não se sincronizam. O que falta é deixar o post existir sem o contêiner.

## Escopo

1. **Posts avulsos**: posts com `workflow_id` nulo, donos do próprio `cliente_id`.
2. **Desmembrar**: converter um/vários/todos os posts de um fluxo em avulsos, mantendo
   status (inclusive custom), mídia, comentários e aprovações. Ao desmembrar todos,
   oferecer arquivar o fluxo vazio.
3. **Vincular**: a operação inversa (avulso entra em um fluxo ativo do mesmo cliente).
4. **Post Express migra** para avulsos, eliminando o fluxo descartável de 1 etapa.
5. **Kanban de Publicações vira drag-and-drop de status** para todos os posts.
6. **Hub**: seção "Publicações avulsas" no topo da página Postagens; aprovação funciona.

## Decisões de design

### Modelo de dados: de verdade, não fluxo escondido

`workflow_posts` ganha `cliente_id` (backfill do fluxo, trigger de sincronia) e
`workflow_id` vira anulável. Todos os ~20 pontos do backend que resolvem cliente via
`workflow_id → workflows.cliente_id` passam a ler a coluna local. A alternativa
"fluxo escondido por post" foi descartada: o Post Express provou o custo (cron de limpeza
com heurística por título, poluição de limites de plano, MCP e analytics).

### Descoberta (o medo do "escondido atrás do toggle")

- Botão "Novo" no cabeçalho de Entregas com "Novo fluxo" e "Post avulso", visível nos
  dois modos; criar ou desmembrar troca a página para o modo Publicações.
- O modo (Fluxos/Publicações) passa a ser lembrado por workspace.
- O quadro de Publicações mostra TODOS os posts (com e sem fluxo); avulso não é um gueto.

### UI

- Cards do quadro: chip com o nome do fluxo OU chip "Avulso"; drag entre colunas de status
  muda o status (status de sistema bloqueados; sair de aprovado pede confirmação).
- Drawer de post avulso: reaproveita o editor de post do WorkflowDrawer (extraído como
  `PostEditorBody`); header = título + cliente + chip Avulso + "Vincular a um fluxo";
  deep link universal `/entregas?post=<id>`.
- Desmembrar no WorkflowDrawer: seleção múltipla + barra de ações + item no kebab.

### Integridade no banco (não só na UI)

- `cliente_id` entra com FK composta `(cliente_id, conta_id) → clientes(id, conta_id)`.
- Trigger BEFORE em `workflow_posts` deriva `cliente_id` do fluxo sempre que
  `workflow_id` está presente (valida mesma conta) e exige `cliente_id` quando não está.
- Mudanças diretas de `workflow_id`/`cliente_id` via PostgREST são bloqueadas no banco
  (raise `post_move_requires_rpc`): desmembrar e vincular acontecem SOMENTE pelos RPCs
  transacionais `detach_posts_from_flow` / `attach_posts_to_flow`, que validam posse,
  mesmo cliente, fluxo ativo e limite de plano sob advisory lock.
- Todos os contratos do Hub (`hub-posts`, `hub-approve`, `hub-edit-suggestion`,
  `hub_reorder_post_schedules`) e de publicação passam a autorizar/resolver pelo
  `cliente_id` do próprio post.

### Semântica de aprovação

Avulso não tem ciclo de etapas. Na aprovação pelo Hub com `auto_publish_on_approval`
ativo, um avulso não-express se comporta EXATAMENTE como um post de fluxo hoje: agenda
só se a validação passa (data futura válida + mídia); sem data válida, o post fica
aprovado sem agendar. Somente `is_express` mantém a regra atual de publicar imediato
(`scheduled_at = now()`, sem checagem de data futura).

### Propriedades customizadas ao desmembrar/vincular

`post_property_values` são preservados como dados inativos: os RPCs de detach/attach não
tocam os valores. Eles simplesmente não renderizam enquanto o post está avulso (painel
oculto) e voltam a aparecer se o post for vinculado a um fluxo cujo template tenha as
mesmas definitions. Nada é apagado.

## Limitações aceitas no v1

- Propriedades customizadas são ancoradas em template de fluxo: avulso não tem propriedades
  (painel oculto; MCP `set_post_property` retorna erro claro).
- Filtros de etapa/prazo não se aplicam a avulsos (tratados para não sumirem do quadro).
- Avulsos não saem do quadro sozinhos (sem conclusão de fluxo); ação "arquivar publicação"
  é follow-up de produto.

## Transições e compatibilidade

- **Deep link universal**: `/entregas?post=<id>` passa a resolver qualquer post (avulso
  abre o drawer próprio; com fluxo, cai no drawer do fluxo). Links antigos
  `?drawer=<wf>&post=<id>` continuam funcionando.
- **Express legado**: fluxos Express históricos ficam como estão (posts ganham
  `cliente_id` pelo backfill). O cron de limpeza mantém os passos legados durante a
  transição (com filtro para ignorar avulsos) e ganha um passo novo para rascunhos
  avulsos; a remoção dos passos legados é follow-up quando zerarem em prod.
- **Superfícies**: a matriz completa de queries/telas que passam a incluir avulsos (e as
  que seguem restritas a fluxos, como filtros de etapa/prazo) está enumerada por task no
  plano de implementação.

## Referência

Plano de implementação: `docs/superpowers/specs/2026-08-29-posts-avulsos-plan.md`.
