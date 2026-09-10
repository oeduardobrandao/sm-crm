# Posts individuais no quadro de Fluxos. Design

Data: 2026-09-10 (revisão 2, após conferência contra `origin/main` em `22567d11`).

Status: proposta consolidada para revisão. Este documento não autoriza implantação nem constitui um plano de implementação.

Escopo: primeira versão de processos individuais de produção.

## 0. O que mudou nesta revisão

A revisão 1 foi conferida contra o código atual. As mudanças abaixo corrigem afirmações que não batiam com o produto, removem promessas sem substrato e cortam escopo que trazia risco sem servir ao objetivo.

| Tema | Revisão 1 | Revisão 2 |
| --- | --- | --- |
| Autoagendamento no Hub | "Etapas individuais são internas; não suprimem autoagendamento" | O Hub já lê etapas para decidir o autoagendamento. Processo individual com mais de uma etapa de aprovação aberta **suspende** o autoagendamento. Ver §6.1 |
| Guard de attach | Só `attach_posts_to_flow` | As quatro RPCs que colocam um post em fluxo. Ver §9.3 |
| Versão esperada | Coluna de versão do fluxo | Não existe. Fingerprint recalculado dentro da RPC. Ver §9.4 |
| Papéis | `owner / admin / agent` | `workspace_roles` + `has_permission_for('entregas', 'editar')`. Ver §9.2 |
| FKs compostas por conta | Em todas as referências | Só com `workflow_posts(id, conta_id)`. Demais: `conta_id` + validação + snapshot. Ver §8.1 |
| Ordenação mista | "Não colidir IDs" | `post_processes.board_position` no mesmo espaço de índices de `workflows.position`; correção prévia da renumeração sobre coluna filtrada. Ver §4.2 |
| Prazo congelado | Em `data_limite` | `timestamptz` próprio; uma função de comparação para o quadro misto. Ver §7 |
| Nome da ação | "Separar" | "Desmembrar do fluxo", nome atual do produto |
| Criar post com processo | No formulário de novo post | Cortado. Cria avulso, depois aplica processo |
| Idempotência | Em todos os comandos | Só no desmembrar em lote |
| Preferência anterior de Fluxos | "Workspaces com preferência anterior" | Proxy: chave `entregas_last_mode_<conta>` presente |
| MCP | Attach com conflito | Não existe attach via MCP. Só campos de leitura |
| Sem processo | Paginado | Cache de Publicações com limite; paginação fora da v1 |
| Reabrir processo | "Como hoje, preserva prazo" | `reopenWorkflow` reinicia o prazo. O caminho individual preserva, e isso é divergência declarada |

Ajustes da revisão 2.1, após review externo da rev 2: a aprovação do cliente no Hub não avança a etapa individual (§6.2); a idempotência do desmembrar em lote usa um registro de operação em vez de `request_id` nos eventos (§8.1, §9.4); `apply_post_process` reconstrói o snapshot do template no servidor e só aceita responsável e prazo por etapa do cliente (§5.2, §9.1); a seção Sem processo ordena por id (§4.3); a leitura de processo via MCP sai da v1 (§2, §10).

## 1. Problema e decisão

Hoje um fluxo reúne duas responsabilidades: agrupar publicações e executar um processo de produção. As etapas pertencem ao fluxo; os status pertencem ao post. Desmembrar um post remove `workflow_id` e, por consequência, seu contexto de etapa, responsável e prazo de produção. Ele continua em Publicações, mas desaparece do quadro de Fluxos.

Permitir que um post siga um processo próprio, sem precisar pertencer a um fluxo. O quadro de Fluxos passa a aceitar cards de fluxos e de posts individuais. Desmembrar uma publicação poderá conservar o processo de produção ou manter o comportamento atual de avulso sem etapas.

O usuário continua reconhecendo duas informações distintas:

| Conceito | Pergunta respondida | Exemplos |
| --- | --- | --- |
| Etapa de produção | Em que parte do trabalho estamos? | Copy, Design, Aprovação |
| Status do post | Qual é a situação da aprovação ou publicação? | Rascunho, Enviado ao cliente, Agendado |

Agrupar publicações deixa de ser um requisito para usar etapas. Não criar fluxos ocultos de um post e não converter status em etapas automaticamente.

### Modos suportados

| Situação | Agrupamento | Produção | Disponibilidade |
| --- | --- | --- | --- |
| Post em fluxo existente | Pertence ao fluxo | Acompanha as etapas compartilhadas | Mantido na v1 |
| Post individual com processo | Sem fluxo | Possui etapas, prazos e responsáveis próprios | Novo na v1 |
| Avulso sem processo | Sem fluxo | Usa apenas status | Mantido na v1 |
| Posts agrupados com progressão independente | Pertencem a um grupo organizacional | Cada post possui sua etapa | Evolução posterior, fora da v1 |

Um post tem apenas uma fonte vigente de contexto de produção. Na v1, um post vinculado a um fluxo não pode ter, simultaneamente, um processo individual vigente.

## 2. Escopo e limites

### Pré-requisitos (PRs próprios, antes da feature)

Quatro defeitos existentes no quadro de Fluxos ficam expostos pelo novo tipo de card. Corrigi-los primeiro, em PRs separados, com testes:

1. **Identidade de coluna por posição.** `KanbanView.buildBoardRows` chaveia colunas por nome de etapa (`Map<nome, cards>`) e a adjacência do drag resolve `ordem` pelo primeiro nome igual. Duas etapas chamadas Aprovação colapsam numa coluna e o drag para fora da segunda é rejeitado. Passar a chavear por `(ordem)` dentro da linha, com o nome só como rótulo. Atualiza drop-target ids, chaves de sort e `filterEtapas`.
2. **Renumeração sobre coluna filtrada.** O drag manual renumera `workflows.position` 0..n usando só os cards visíveis (`KanbanView.tsx` ~503-517), em N UPDATEs paralelos. Fluxos ocultos pelo filtro recebem posições colidentes. Renumerar a coluna inteira, numa RPC.
3. **Deep link `?drawer=<wf>&post=<id>` sem fallback.** Quando o fluxo não casa com card nenhum, `pendingDeepLink` fica pendurado sem toast (`EntregasPage.tsx` ~318-331). Cair no resolvedor de `?post=<id>`.
4. **Gate do quadro de exemplo e do tour.** `showExample = activeWorkflows.length === 0` e `shouldAutoStartTour` só olham fluxos. Passar a considerar "nenhum card de nenhum tipo".

### Incluído na v1

- Desmembrar um ou vários posts de um fluxo ativo, mantendo etapas ou transformando-os em avulsos sem etapas.
- Aplicar um template de processo a um avulso existente.
- Exibir e gerenciar posts individuais no Kanban e na Lista de Fluxos.
- Avançar, voltar, concluir, reabrir e encerrar processos individuais, com histórico e controle de concorrência.
- Editar responsáveis e prazos das etapas individuais.
- Exibir contexto de produção individual em Publicações, calendário de publicações e drawer do post.
- Suspender o autoagendamento do Hub enquanto houver outra etapa de aprovação adiante (§6.1).
- Preservar contratos de aprovação, publicação, links, propriedades customizadas e isolamento de workspace.
- Reanexar um post a um fluxo com encerramento explícito do processo individual.

### Fora da v1

- Criar um post já com processo a partir do formulário de novo post. O caminho é criar o avulso e aplicar processo em seguida.
- Progressão individual de posts que continuam agrupados em um fluxo.
- Renomear globalmente Fluxos para Produção, fundir as duas visualizações ou eliminar status customizados.
- Sincronização genérica entre etapas e status, novos gatilhos de automação ou novos canais de notificação.
- Recorrência de processos individuais, múltiplos processos vigentes no mesmo post e migração em massa dos dados existentes.
- Editor de templates novo, propagação de alterações de template para processos já criados ou troca de template em processo em andamento.
- Paginação da seção Sem processo (usa o cache de Publicações com limite).
- Migração das preferências de ordenação guardadas no navegador.
- Qualquer mudança no MCP, inclusive campos de leitura do processo em `get_post` e `list_posts`. Entrega posterior.
- Novas propriedades customizadas para avulsos, métricas conjuntas de produtividade ou alteração de preços e planos.
- Recriar o calendário de Fluxos ou o gráfico de Fluxos para aceitar novos tipos de entidade.

## 3. Referência visual e limites do protótipo

O mockup explorado contém: Entregas com os modos Fluxos e Publicações; colunas Copy, Design e Aprovação do processo "Conteúdo para redes sociais"; cards de fluxo ao lado de posts individuais; drawer do fluxo com a ação de desmembrar por publicação; a escolha entre manter etapas e transformar em avulso; um post em Sem processo com a ação Aplicar processo.

Fonte local: `/Users/eduardosouza/.codex/visualizations/2026/09/09/01a0883b-fcbc-7422-8518-48805d49baaf/fluxos-individuais.html`.

O protótipo usa dados fictícios e simplifica as telas. Preservar a navegação, o menu Novo (que hoje tem exatamente "Novo fluxo" e "Post avulso"), os filtros, todos os status canônicos e customizados e os templates existentes. O botão "Novo post" e as três colunas do protótipo não substituem esses recursos. O protótipo chama a ação de "Separar"; o produto chama de **"Desmembrar do fluxo"** em menu, barra de seleção, diálogo, botão e toast, e esse nome fica.

O protótipo não implementa aprovações reais, conclusão da última etapa, edição de responsáveis e prazos nem persistência. Não reproduzir essas omissões.

Cópias existentes que precisam de revisão porque afirmam que só fluxos são cards: `ComoFuncionaPanel` ("Fluxo: o card do kanban", "Etapas: as fases do fluxo"), os passos do tour em `tour/entregasTour.ts`, e os estados vazios "crie um novo fluxo".

## 4. Experiência na página Entregas

### 4.1 Quadro de Fluxos

Manter o nome Fluxos. `ModeToggle` não tem espaço para subtítulo; a descrição "Quadro por etapa de produção" entra como texto auxiliar na linha da toolbar, não no toggle. Introduzir um filtro de entidade: **Todos / Fluxos / Posts individuais**.

Regra de valor inicial e persistência:

- Parâmetro de URL `entidade` com valores `todos | fluxos | posts`. O parser trata ausente ou malformado como `fluxos`. O serializador omite `fluxos` (default) e emite `todos` e `posts` explicitamente. Assim vistas salvas antigas, que não têm o parâmetro, continuam significando Fluxos e continuam casando por igualdade de string em `VistasTabs` enquanto o quadro estiver em Fluxos. Quando o usuário está em Todos, nenhuma vista antiga fica realçada, e isso é correto.
- Preferência local em `localStorage`, chave `entregas_entidade_<contaId>`, por navegador, como as demais preferências de Entregas. Não existe preferência de Entregas no servidor e esta entrega não cria uma.
- Sem `entidade` na URL e sem preferência gravada: se existir a chave `entregas_last_mode_<contaId>` (o usuário já usou Entregas neste navegador), começar em Fluxos; caso contrário, Todos. É um proxy aceito: "já usou" vale como "prefere o quadro conhecido".
- URL ou vista explícita sempre vence a preferência local. O `hadModeParam` de `EntregasPage` já faz isso para `mode`; replicar para `entidade`.
- Aplicar processo ou desmembrar mantendo etapas abre Fluxos em Kanban, seleciona Todos e revela o card resultante, removendo só os filtros que o ocultariam, com aviso. Seleção múltipla revela sem abrir vários drawers. Desmembrar como avulso sem etapas mantém o comportamento atual: o drawer do fluxo permanece aberto (ou fecha se o fluxo foi arquivado) e não há navegação.
- O filtro de entidade não afeta Publicações, Concluídas nem o gráfico.

O quadro mantém linhas por processo compatível. Um post individual ocupa a coluna da sua própria etapa; um fluxo ocupa a coluna da etapa compartilhada. Nunca mostrar o post como card independente e dentro da contagem de um fluxo ao mesmo tempo.

Identidade de linha: `template:<id>` mais assinatura ordenada das etapas `(ordem, nome, tipo)`. Hoje a chave é só `template:<id>` (ou os nomes unidos quando não há template) e dois fluxos do mesmo template com etapas divergentes já compartilham linha usando a ordem do primeiro card visto. A assinatura corrige isso para fluxos e posts. Linha sem template usa a assinatura como chave e o rótulo "Etapas personalizadas". Colunas usam identidade por posição (pré-requisito 1).

Consequência aceita: `TABS_THRESHOLD = 1` faz o quadro virar abas assim que existe mais de uma linha. Um snapshot divergente cria linha própria e, portanto, abas. Não mudar o threshold nesta entrega; registrar como follow-up de UX.

### 4.2 Cards, movimento e contagem

| Card | Conteúdo | Ação principal |
| --- | --- | --- |
| Fluxo | Cliente, título, ícone de grupo, quantidade de posts, etapa compartilhada, responsável e prazo da etapa, indicadores existentes | Abre o drawer de fluxo existente |
| Post individual | Cliente, título, formato, ícone de post, tag "Individual", status, responsável e prazo da etapa; capa quando disponível | Abre o drawer do post com sua seção de produção |

Identificar o tipo por texto e ícone; cor é complementar. A etapa aparece como coluna; o status como badge, com os rótulos e cores de Publicações (`PostStatusChip`).

Contagens. A contagem da coluna já é quantidade de cards (`stepCards.length`); passa a mostrar a divisão por tipo quando houver os dois ("2 fluxos · 1 post"). O cabeçalho da página mantém o invariante documentado de totais gerais sem filtro e ganha o total de posts individuais ativos ao lado de "fluxos ativos". Contagens internas de um fluxo continuam contando só seus posts vinculados.

Movimento. Arrastar para uma etapa adjacente, na mesma linha, move a entidade arrastada, sem alterar status por causa do nome da coluna. Voltar uma etapa existe hoje por drag (com confirmação) e por botão no card; o card individual oferece os mesmos botões "Avançar etapa" e "Voltar etapa", com `aria-label`. Não há sensor de teclado no dnd-kit hoje e não se adiciona nesta entrega; os botões são a alternativa. Saltos entre etapas e trocas de linha por drag ficam bloqueados. Os diálogos `ForwardConfirmDialog` e `ClientApprovalChoiceDialog` recebem o título da entidade (fluxo ou post) em vez de `workflowTitle`.

Ordenação. Por prazo, comparar o prazo efetivo da etapa ativa dos dois tipos com uma única função (§7). Manual: fluxos continuam em `workflows.position` inteiro; posts individuais ganham `post_processes.board_position integer`. Na coluna, ordenar pelo valor numérico dos dois campos, com desempate por id. Um drag manual envia a ordem completa da coluna (ids mistos, incluindo os cards ocultos pelo filtro, na posição em que estavam) para `reorder_fluxos_board`, que atribui o índice a cada item no campo do seu tipo. É a mesma renumeração densa de hoje, corrigida pelo pré-requisito 2 para cobrir a coluna inteira. Não reutilizar `workflow_posts.board_ordem`, que pertence ao quadro de Publicações.

Preferência de sort por coluna continua em `entregas_fluxos_sorts_<contaId>`, agora chaveada por `<chaveDaLinha>::<ordem>`. Chaves antigas por nome não são migradas: chave desconhecida cai em `prazo`, como já acontece.

### 4.3 Sem processo

Uma seção abaixo das linhas de etapas mostra avulsos sem processo vigente e a ação **Aplicar processo**. Não posicionar esses posts numa coluna por causa do status nem inventar prazo ou responsável de etapa.

- Aparece em Todos e Posts individuais; não aparece em Fluxos.
- Fonte de dados: o cache `['active-posts']` de Publicações, filtrado por `workflow_id IS NULL` e sem execução vigente. Isso liga `useActivePosts` no modo Fluxos, que hoje só roda em Publicações; o poll de 15 s permanece condicionado a haver publicação em andamento.
- A seção mostra no máximo 12 cards, os mais recentes primeiro por `id` (a consulta de `getActivePosts` não expõe `updated_at` nem `created_at`, e o id é serial), com o link "Ver todos em Publicações". Paginação fica fora da v1.
- Aplica busca e cliente, que existem na barra do modo Fluxos. Os filtros de formato e status do post só existem na barra de Publicações e não são adicionados ao modo Fluxos nesta entrega. Filtros de etapa, template, responsável da etapa e prazo não se aplicam à seção; quando algum está ativo, exibir "Filtros de produção não se aplicam aos posts sem processo" em vez de esconder a seção.
- Posts com processo concluído não pertencem a Sem processo.

### 4.4 Outras visualizações

| Superfície | Comportamento na v1 |
| --- | --- |
| Lista de Fluxos | Mesmos tipos e filtro de entidade do Kanban; etapa, responsável e prazo resolvidos pela entidade |
| Publicações, Kanban e Lista | Mantém todos os posts e a organização por status; o card mostra "Individual · <etapa>" quando há processo |
| Calendário de publicações | Mantém a data de publicação como eixo; o painel de detalhe mostra etapa e prazo do processo sem confundir com agendamento |
| Calendário e gráfico de Fluxos | Continuam restritos a fluxos; texto "Somente fluxos" (não existe hoje) com link para o quadro |
| Concluídas | Continua agrupada por cliente; processos individuais concluídos entram no grupo do cliente com a tag "Post individual" e ação "Reabrir processo". O carregamento por fluxo é N+1 hoje e não deve ser copiado: sumários de processos vêm numa consulta por conta. `refresh()` da página passa a invalidar `concluded-*` |
| Analytics de Fluxos | Mantém a população e os cálculos atuais; não inclui processos individuais |
| Onboarding | `ExampleBoard`, tour e `ComoFuncionaPanel` ajustados (pré-requisito 4 e §3) |

## 5. Fluxos de interação

### 5.1 Desmembrar mantendo etapas

No drawer do fluxo, a ação "Desmembrar do fluxo" existe no menu da publicação e na barra de seleção múltipla, ao lado de "Mover para outro fluxo". O diálogo atual só confirma; ele passa a apresentar:

1. **Manter etapas**, recomendada e pré-selecionada.
2. **Transformar em avulso sem etapas**, comportamento atual.

O diálogo lista as publicações afetadas e a etapa atual do fluxo, e informa que status, conteúdo e aprovações são preservados. Com todos os posts selecionados, mantém a opção "Arquivar o fluxo depois de desmembrar". A pasta do post é reparentada para a pasta do cliente pelo trigger `folder_sync_post`, nas duas opções; o diálogo não precisa mencionar isso, mas a implementação não deve tentar impedi-lo.

Manter etapas exige fluxo `ativo` com exatamente uma etapa `ativo`. Se o fluxo estiver concluído ou arquivado, ou as etapas forem inconsistentes, só a opção sem etapas fica disponível, com a explicação de que um processo pode ser aplicado depois.

A RPC `detach_posts_keeping_process` faz, numa transação:

- Verificar `get_my_conta_id()`, `has_permission_for(auth.uid(), conta, 'entregas', 'editar')` e a flag de criação (§11).
- Travar os posts (`ORDER BY id FOR UPDATE`) e o fluxo de origem, depois de tomar os advisory locks na ordem da família (§9.5).
- Recalcular o fingerprint do fluxo (§9.4) e comparar com o enviado; divergência falha com `workflow_changed`.
- Snapshotar as etapas atuais do fluxo, inclusive customizações locais, sem consultar o template.
- Desvincular os posts com o mecanismo sancionado (§9.3), preservando IDs, cliente, conta, conteúdo, status canônico e customizado, mídia, capas, comentários, aprovações e agendamento. Nada disso precisa ser copiado: `post_approvals`, `post_property_values`, `post_file_links` e `post_comments` são chaveados por `post_id`.
- Criar uma execução por post, na etapa atual da origem, com o prazo efetivo congelado (§7).
- Registrar o evento de origem em cada post e arquivar o fluxo se pedido e vazio.

O lote é atômico e idempotente: recebe `p_request_id uuid`; um segundo chamado com o mesmo id retorna o resultado guardado sem repetir efeitos (§9.4). Esse id atravessa `callRpcWithDeadlockRetry`, que hoje reinvoca a RPC às cegas em `40P01`.

Etapas anteriores à atual ficam **herdadas**, com referência textual à origem, sem conclusões individuais fictícias. O histórico do fluxo continua no fluxo. O histórico do post registra "Desmembrado de Conteúdo de setembro na etapa Design".

### 5.2 Aplicar processo a um avulso

Disponível no drawer do post, no menu da publicação em Publicações e na seção Sem processo. O diálogo escolhe template e etapa inicial (padrão: primeira) e mostra responsáveis e prazos previstos antes de confirmar. Template vazio ou de outra conta é inválido.

Regras de prazo no diálogo (§7): modo `padrao` calcula a partir de agora; modo `data_fixa` exige data para cada etapa a partir da inicial; modo `data_entrega` exige uma etapa `aprovacao_cliente` na sequência e o mês de entrega, e usa `clientes.dia_entrega`. Sem esses dados, o botão de confirmar fica desabilitado com o motivo.

A sequência do processo vem do template, nunca do cliente. A RPC `apply_post_process` trava a linha do template (`FOR SHARE`), confere que pertence à conta e que `workflow_templates.etapas` não está vazio, compara `md5(etapas::text)` com o `p_template_fingerprint` que a UI viu (divergência falha com `template_changed`), e constrói `nome`, `tipo`, `ordem`, `prazo_dias` e `tipo_prazo` a partir do jsonb do template. Do cliente ela aceita só `p_step_overrides`: por `ordem`, `responsavel_id` (validado como membro da conta) e `prazo_efetivo` (obrigatório quando a etapa tem prazo relativo ou o modo exige data). Qualquer outra chave é rejeitada.

Etapas anteriores à inicial ficam **ignoradas**. Status e conteúdo do post não mudam, mesmo aprovado, agendado ou publicado. Um processo não libera edição de campos bloqueados por agendamento.

Se outro dispositivo aplicou processo ou vinculou o post a um fluxo, a RPC falha com `post_has_active_process` ou `post_in_workflow` e a UI recarrega.

### 5.3 Criar post

O menu Novo continua com "Novo fluxo" e "Post avulso". `NewAvulsoDialog` não muda: três campos e um INSERT. Depois de criar, o drawer do avulso já oferece "Aplicar processo" no cabeçalho. Post Express continua fora do menu Novo, com seus defaults e sua limpeza; não ganha processo automaticamente.

### 5.4 Drawer individual

Reutilizar `StandalonePostDrawer` e `PostEditorBody`. O cabeçalho troca a tag "Avulso" por **"Avulso · Sem processo"** ou **"Individual · <etapa atual>"**, com um segundo modificador de classe ao lado de `post-fluxo-tag--avulso`.

Seção de produção, nova, colocada logo abaixo da linha de campos e acima da galeria de mídia: origem (template ou fluxo de origem), linha de etapas, responsável e prazo por etapa, estado do processo e histórico. Não existe stepper reutilizável no drawer do fluxo (que só mostra `Etapa: <nome>`); a linha de etapas é construída a partir da marcação de progresso do `WorkflowCard` e do estilo `history-timeline` de `PostTimelinePopover`. `SortableEtapaList` não serve: é formulário de criação com adicionar, remover e reordenar, que a v1 proíbe.

O select existente "Responsável" de `PostEditorBody` passa a "Responsável do post" em todos os drawers, para distinguir do responsável da etapa.

Editar responsável e prazo de etapas `pendente` e `ativo`; etapas `concluido`, `herdado` e `ignorado` são informativas até serem reabertas por "Voltar etapa". Nomes, ordem e tipo não são editáveis na v1.

`PropertyPanel` continua oculto sem fluxo, mesmo com processo de um template que tem propriedades. Mostrar na seção de produção a nota "Propriedades do template só valem dentro de um fluxo".

Histórico: `buildPostTimeline` ganha uma terceira fonte (`post_process_events`) e o `kind: 'process'`, para que o popover "Histórico" mostre desmembrar, aplicar, avanço, retorno, conclusão e encerramento no mesmo lugar onde o usuário já procura. A seção de produção mostra o mesmo feed filtrado ao processo.

`PostEditorBody` é compartilhado com o drawer do fluxo (um por post) e com `HistoryDrawer`. A seção de produção só busca dados quando `workflowId == null` e o drawer está aberto.

Ações no cabeçalho, conforme o estado: Avançar etapa, Voltar etapa, Concluir processo, Reabrir processo, Remover processo, Aplicar processo, Vincular a um fluxo.

### 5.5 Concluir, reabrir, remover e vincular

- Concluir a última etapa marca só o processo como `concluido`. O post mantém status, visibilidade no Hub e agendamento. Se a última etapa é `aprovacao_cliente` com pendência, abre o mesmo diálogo de escolha dos fluxos (§6.2).
- O card sai do quadro ativo e entra em Concluídas; continua em Publicações e no link direto.
- Reabrir reativa a última etapa e **preserva** `iniciado_em` e o prazo salvo, mesmo vencidos, permitindo editar o prazo. `reopenWorkflow` faz `iniciado_em = now` e reinicia o prazo relativo; o caminho individual diverge disso de propósito, e a divergência fica registrada aqui. Não muda status do post.
- Remover pede confirmação e encerra a execução com motivo `removido`. Mantém histórico, status e conteúdo; o post volta a Sem processo e pode receber nova execução.
- Vincular um post com execução vigente (ativa ou concluída) a um fluxo exige aviso de que ele passará a seguir as etapas do fluxo. `AttachToFluxoDialog` ganha esse passo de confirmação. A RPC `attach_post_closing_process` encerra a execução com motivo `vinculado` e chama a lógica de attach na mesma transação, respeitando o limite do fluxo. Estado e prazos individuais não são transferidos.
- Um post desmembrado de novo não retoma uma execução encerrada; recebe uma nova.

## 6. Etapas, status e aprovações

A regra geral é independência. Uma etapa chamada Aprovação ou Publicação não representa veredito nem resultado de publicação. O nome é livre; comportamentos especiais dependem do tipo `aprovacao_cliente` (os únicos tipos são `padrao` e `aprovacao_cliente`) e de comandos explícitos.

### 6.1 Autoagendamento no Hub

Hoje `hub-approve` decide o autoagendamento com `isFinalApprovalCycle`: conta etapas `aprovacao_cliente` do fluxo com status diferente de `concluido` e só autoagenda quando resta no máximo uma. Para `workflow_id` nulo retorna `true` de imediato. `hub-posts` devolve ao portal `autoPublishSuspendedWorkflowIds` para o portal não prometer "aprovar = agendar" num ciclo anterior.

Sem mudança, um post desmembrado no meio de um fluxo de dupla aprovação autoagendaria e publicaria na primeira aprovação. Portanto:

- `isFinalApprovalCycle` passa a receber o post. Com `workflow_id` nulo e execução `ativo`, conta as etapas `aprovacao_cliente` da execução com estado `pendente` ou `ativo` e aplica a mesma regra (`< 2`). Erro de consulta continua falhando fechado.
- `hub-posts` ganha `autoPublishSuspendedPostIds: number[]`, aditivo, com os posts individuais nessa condição. O portal usa os dois arrays. Nenhum campo existente muda de forma.
- A precondição de `hub-approve` (`status ∈ {enviado_cliente, correcao_cliente}`) e a resolução de acesso por `cliente_id` e `conta_id` do post não mudam. `auto_publish_on_approval`, `validateForScheduling` e a exceção `is_express` não mudam.

### 6.2 Avançar uma etapa de aprovação

A árvore de decisão dos fluxos está em três lugares (`KanbanView`, `EntregasTab`, e o auto-complete de `WorkflowDrawer`), não em `advanceEtapa.ts`. Antes de criar a variante individual, extrair a decisão para um módulo puro `approvalAdvance.ts` que recebe `{tipo, total, cleared, temAprovacaoAdiante}` e devolve a ação, e fazer as três chamadas usá-lo. O teste por texto-fonte `EntregasTabRearm.test.ts` é atualizado junto.

| Ação | Processo individual | Post |
| --- | --- | --- |
| Avançar etapa `padrao` ou voltar | Move uma etapa | Preserva status e aprovações |
| Chegar a uma etapa `aprovacao_cliente` | Ativa a etapa | Não envia ao Hub nem aprova |
| Enviar ao cliente | Permanece na etapa | Só elegível com `status = 'aprovado_interno'`, a mesma regra de `sendPostsToCliente`. Com n=1, botão desabilitado com o motivo, em vez de sucesso com zero linhas |
| Cliente aprova ou pede correção no Hub | Permanece na etapa, aguardando avanço manual. O auto-complete dos fluxos (`shouldAutoCompleteApproval`) só dispara quando o `WorkflowDrawer` aberto observa a transição entre duas listas em memória, e `hub-approve` só chama `record_client_approval`, que não conhece processos. Não criar transição server-side no caminho de aprovação na v1. O drawer individual mostra a dica "Cliente aprovou. Avançar etapa?" quando o post está `aprovado_cliente` e a etapa ativa é `aprovacao_cliente` | Transição, histórico e autoagendamento existentes |
| Avançar aprovação com pendência | Diálogo de escolha: aprovar internamente e avançar, enviar ao cliente, avançar sem alterar | Ver linhas abaixo |
| Aprovar internamente e avançar | Move | `status = 'aprovado_cliente'` se não estiver em `agendado`/`postado`, exatamente como `approvePostsInternally`, apesar do nome. O trigger z1 limpa `custom_status_id`, como hoje |
| Avançar sem alterar post | Move ou conclui | Nunca modifica status, custom status ou aprovações |
| Avançar aprovação com outro ciclo adiante | Move e prepara o próximo ciclo | `aprovado_cliente` volta a `rascunho`, só este post, como `resetApprovedPostsForNextCycle`. Histórico de aprovações preservado |
| Agendamento, publicação, falha | Não move etapas | Serviços, Hub e crons existentes |

Detalhes obrigatórios:

- Aprovação liberada = `status ∈ CLIENT_CLEARED_STATUSES` = `aprovado_cliente, agendado, postado, falha_publicacao`. Aplicar ao único post; o guard `total > 0` desaparece porque total é sempre 1.
- "Existe aprovação adiante" para o processo individual considera só etapas `aprovacao_cliente` com estado `pendente`. Etapas `herdado`, `ignorado` e `concluido` não contam. (Para fluxos, `hasLaterApprovalEtapa` ignora status; não mudar.)
- Preparação de ciclo e avanço são uma transação na RPC de transição, com o status esperado do post. Nos fluxos o re-arm é um segundo PATCH com `rearmFailed`; o caminho individual é mais forte, e isso é aceito.
- Não ampliar `resetApprovedPostsForNextCycle` para outros status. Não corrigir o nome ou o contrato de `approvePostsInternally` nesta entrega.
- Toda escrita de `status` por esses comandos passa pelo trigger z1 e pode zerar `custom_status_id`. É o comportamento dos fluxos e fica igual; a UI de confirmação de mudança de status (`statusChangeNeedsConfirm`) continua valendo.
- Desmembrar, aplicar, concluir, remover ou vincular nunca alteram status, aprovação ou agendamento.

## 7. Prazos e atribuição

Campos reais da etapa: `prazo_dias`, `tipo_prazo` (`uteis` ou `corridos`; dias úteis contam segunda a sexta e não há calendário de feriados, semântica atual que fica igual para processos individuais), `responsavel_id`, `data_limite date`, `iniciado_em`, `concluido_em`. `data_fixa` e `data_entrega` são valores de `workflows.modo_prazo`, não da etapa. Não existe coluna de data de entrega: ela deriva de `clientes.dia_entrega` (1 a 31) e de um mês escolhido.

- Responsável do post (`workflow_posts.responsavel_id`) e responsável da etapa continuam distintos, com rótulos "Responsável do post" e "Responsável da etapa" nos filtros e no drawer.
- A etapa individual tem `prazo_efetivo timestamptz`. Ao desmembrar, congelar o prazo efetivo da etapa ativa da origem: se ela tem `data_limite`, fim daquele dia no fuso do navegador que chamou (enviado como timestamptz); senão, `iniciado_em + prazo_dias` conforme `tipo_prazo`. Não reiniciar a contagem.
- Etapas futuras com `data_limite` mantêm a data como `prazo_efetivo`. Etapas futuras relativas mantêm `prazo_dias` e `tipo_prazo` e calculam `prazo_efetivo` quando ativadas.
- Modo `data_entrega`: a RPC exige uma etapa `aprovacao_cliente` na sequência a partir da inicial e a data de entrega já resolvida pelo cliente (dia do cliente + mês). Os prazos resultantes são materializados no snapshot. Calcular a data no fuso local, não com `toISOString().split('T')[0]`, que já produz o dia anterior no Brasil nas duas implementações existentes; a RPC recebe datas prontas e não repete o cálculo.
- Comparação e ordenação no quadro misto usam uma única função, `etapaDeadlineDateOf`, estendida para aceitar `prazo_efetivo`. O badge do card individual deriva de `prazo_efetivo` por um adaptador que devolve o formato de `getDeadlineInfo`. Não criar uma terceira implementação de prazo.
- Quem calcula `prazo_efetivo` é o CRM, com `computeDeadlineDate`, e as RPCs só armazenam o valor recebido: `detach_posts_keeping_process` recebe `p_active_deadline` (prazo congelado da etapa ativa), `apply_post_process` recebe o `prazo_efetivo` de cada etapa em `p_step_overrides`, e `transition_post_process` recebe `p_next_deadline` para a etapa que será ativada. Isso evita reimplementar dias úteis em SQL. A RPC valida só que o valor é um `timestamptz` não nulo quando a etapa tem prazo relativo.
- Início da etapa individual = instante do desmembrar ou da aplicação. Tempo de produção individual não inclui o período no fluxo.
- Voltar uma etapa reabre a anterior preservando seu `iniciado_em` original (como `revertEtapa`) e o último `prazo_efetivo`, inclusive vencido, até edição explícita.
- `responsavel_id` das etapas individuais referencia `membros(id)` com `ON DELETE SET NULL`, a política atual. Remoção de membro é um `DELETE` físico e não pode passar a falhar por causa das tabelas novas. A UI mostra "Sem responsável".

## 8. Modelo de dados

Evolução aditiva. `workflow_id` não muda de significado e `workflows` não vira armazenamento de posts individuais.

### 8.1 Tabelas novas

`post_processes`

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | bigserial | |
| `conta_id` | uuid not null → `workspaces` | |
| `post_id` | bigint not null | FK composta `(post_id, conta_id) → workflow_posts(id, conta_id) ON DELETE CASCADE` |
| `template_id` | bigint null → `workflow_templates` `ON DELETE SET NULL` | validado na RPC como da mesma conta |
| `template_nome` | text | snapshot |
| `assinatura` | text | assinatura ordenada `(ordem, nome, tipo)` |
| `origem_workflow_id` | bigint null → `workflows` `ON DELETE SET NULL` | |
| `origem_descricao` | text | "Conteúdo de setembro, etapa Design" |
| `estado` | text check `ativo, concluido, encerrado` | |
| `motivo_encerramento` | text null check `removido, vinculado` | |
| `etapa_atual` | integer | ordem da etapa ativa |
| `modo_prazo` | text check `padrao, data_fixa, data_entrega` | informativo; datas já materializadas |
| `board_position` | integer not null default 0 | mesmo espaço de índices de `workflows.position` |
| `revisao` | integer not null default 1 | incrementada em toda mutação |
| `created_by`, `created_at`, `updated_at`, `concluido_em` | | `concluido_em` por trigger, como `workflows_set_concluido_em` |

Unicidade parcial: um `post_id` com `estado IN ('ativo','concluido')`. Unicidade `(id, conta_id)` para servir de alvo composto.

`post_process_steps`

| Coluna | Tipo |
| --- | --- |
| `id`, `conta_id`, `process_id` (FK composta `(process_id, conta_id) → post_processes(id, conta_id) ON DELETE CASCADE`) | |
| `ordem` integer, unique `(process_id, ordem)` | |
| `nome`, `tipo` check `padrao, aprovacao_cliente` | |
| `responsavel_id` bigint null → `membros(id) ON DELETE SET NULL` | validado na RPC como da mesma conta |
| `prazo_dias` integer null, `tipo_prazo` check `uteis, corridos` | |
| `prazo_efetivo` timestamptz null | |
| `estado` check `pendente, ativo, concluido, herdado, ignorado, interrompido` | |
| `iniciado_em`, `concluido_em`, `interrompido_em` timestamptz | |
| `origem_etapa_ordem` integer null, `origem_etapa_nome` text null | proveniência herdada por snapshot; ids de etapa de fluxo não são estáveis (a migração de template apaga e reinsere) |

`post_process_events`

| Coluna | Tipo |
| --- | --- |
| `id`, `conta_id`, `post_id`, `process_id` (FKs compostas com CASCADE no post e no processo) | |
| `evento` text | `desmembrado, aplicado, avancou, voltou, concluido, reaberto, removido, vinculado, etapa_editada` |
| `actor_user_id` uuid null, `actor_name` text | nome em snapshot, como `workflow_events` |
| `origem` text check `workspace_user, system` | |
| `antes`, `depois` jsonb | |
| `created_at` | |

`post_process_batch_requests`

| Coluna | Tipo |
| --- | --- |
| `request_id` uuid primary key | gerado pelo CRM por tentativa de desmembrar em lote |
| `conta_id` uuid not null → `workspaces` | |
| `resultado` jsonb not null | o retorno completo da RPC |
| `created_at` | |

Uma linha por operação de desmembrar em lote, gravada na mesma transação dos eventos. A repetição com o mesmo `request_id` localiza a linha (validando `conta_id`) e devolve `resultado` sem tocar em nada. O evento por post não carrega o id da requisição.

Invariantes mantidas por constraints e pela RPC: processo `ativo` tem exatamente uma etapa `ativo` na ordem de `etapa_atual`; `concluido` e `encerrado` não têm etapa ativa; encerrar um processo ativo marca a etapa ativa como `interrompido` com timestamp e deixa as futuras `pendente`. `herdado` e `ignorado` não contam como produção individual.

Decisão sobre FKs compostas: só `workflow_posts` e as tabelas novas expõem `UNIQUE (id, conta_id)`. `workflows`, `workflow_templates` e `membros` não expõem, e `workflow_etapas` nem tem `conta_id`. Não alterar essas tabelas centrais; template, origem e responsável usam FK simples com `SET NULL`, `conta_id` na linha e validação de conta dentro da RPC.

Exclusão: apagar o post apaga suas execuções, etapas e eventos, seguindo a política de todos os filhos de `workflow_posts`. Apagar fluxo ou template de origem só anula a referência. Remover um processo nunca apaga o post.

### 8.2 Relação com o modelo atual

- `workflow_posts.workflow_id` continua significando só pertencimento a um fluxo. Resolução de produção: com fluxo → etapas do fluxo; sem fluxo com execução vigente → etapas individuais; sem ambos → sem processo. Execução `concluido` ainda resolve contexto, mas não entra no quadro ativo nem em Sem processo.
- Status do post não é duplicado nas tabelas novas.
- `post_property_values` não é tocado. Sem fluxo os valores ficam inativos, como hoje; reanexar reativa só definições compatíveis. A RPC de desmembrar não chama `remap_moved_posts_select_options`, que só pertence ao mover entre fluxos.
- Mudanças no template não propagam para snapshots. Excluir o template anula `template_id` e preserva nome, sequência e histórico.
- Processos individuais não consomem limite de fluxos nem de posts por fluxo. Vincular continua checando `max_posts_per_workflow`.

### 8.3 Leitura e apresentação

`BoardCard` é usado como forma de fluxo em `matchesEtapaPrazo`, `sortCardsByPrazo` (desempate por `workflow.position`), `cardsByWorkflowId`, `openableWorkflowIds`, `ListView`, `CalendarView`, `ChartView` e `chartViewData`, além de `BoardRow` declarado duas vezes e um construtor de card duplicado em `EntregasPage`. Introduzir `BoardEntity`, união discriminada `kind: 'workflow' | 'post'` com id estável `workflow:<id>` ou `post:<id>` e projeção comum `{etapaOrdem, etapaNome, responsavel, prazoEfetivo, posicao}`. Kanban e Lista consomem a união; Calendário e Gráfico de Fluxos continuam recebendo só os cards de fluxo. Unificar `BoardRow` e o construtor de card no mesmo passo. Nunca preencher um `Workflow` falso para renderizar um post.

Carregamento em lote por conta: `getActivePostProcesses(contaId)` devolve processo, etapas e resumo do post (`POST_CONTEXT_COLUMNS`, sem conteúdo rico) numa consulta com embed. O drawer carrega eventos sob demanda.

## 9. Comandos, segurança e concorrência

### 9.1 RPCs

| RPC | Entrada | Resultado atômico |
| --- | --- | --- |
| `detach_posts_keeping_process(p_post_ids, p_workflow_id, p_fingerprint, p_active_deadline, p_archive_empty_flow, p_request_id)` | | desvinculação + snapshots + eventos + arquivamento opcional; retorna processos e etapas criados, como `move_posts_to_new_flow` retorna `workflow` e `etapas` |
| `apply_post_process(p_post_id, p_template_id, p_template_fingerprint, p_start_ordem, p_step_overrides jsonb)` | sequência reconstruída do template no servidor; do cliente só responsável e `prazo_efetivo` por etapa (§5.2) | execução + etapas + evento |
| `transition_post_process(p_process_id, p_expected_revisao, p_command, p_approval_choice, p_expected_post_status, p_next_deadline)` | `avancar, voltar, concluir, reabrir` | etapas, ponteiro, estado, alteração permitida no post, re-arm, evento |
| `update_post_process_step(p_process_id, p_expected_revisao, p_ordem, p_responsavel_id, p_prazo_efetivo)` | | dados validados + revisão + evento |
| `remove_post_process(p_process_id, p_expected_revisao)` | | encerramento `removido` + evento |
| `attach_post_closing_process(p_post_id, p_workflow_id, p_expected_revisao)` | | encerramento `vinculado` + attach + evento |
| `reorder_fluxos_board(p_row_key, p_ordem, p_workflow_positions jsonb, p_process_positions jsonb)` | coluna inteira | posições coerentes para os dois tipos |

Todas são `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL FROM public, anon` e `GRANT EXECUTE TO authenticated, service_role`, como a família detach/attach.

### 9.2 Identidade e permissão

- `v_conta := get_my_conta_id()`; nulo falha com `workspace_not_found` antes de qualquer escrita. `conta_id` nunca vem do cliente.
- Permissão: `has_permission_for(auth.uid(), v_conta, 'entregas', 'editar')` em toda RPC de mutação. Os papéis são `workspace_roles` com permissões por módulo; `owner/admin/agent` é só o fallback legado para membros sem `role_id`. Hoje `workflow_posts` não tem enforcement de papel no banco; as tabelas novas não herdam essa lacuna.
- RLS nas três tabelas no padrão de `workspace_roles`: SELECT para membros da conta via `get_my_conta_id()`, INSERT/UPDATE/DELETE com `WITH CHECK (false)` e `USING (false)` para `authenticated`, bypass para `service_role`. Toda mutação passa pelas RPCs.
- Dados de outra conta retornam `not_found` sem revelar existência. Detalhes técnicos só no log.

### 9.3 Compatibilidade com as RPCs existentes

Quatro RPCs colocam um post num fluxo: `attach_posts_to_flow`, `move_posts_to_new_flow`, `move_posts_to_existing_flow` (via `move_posts_core`) e o INSERT de criação. As três primeiras passam a falhar com `post_has_active_process` quando algum post tem execução `ativo` ou `concluido`. Só `attach_post_closing_process` encerra e vincula. Não existe formato de "conflito estruturado" nessa família; todos os erros são `RAISE EXCEPTION '<codigo>' USING ERRCODE = 'P0001'`, e o cliente mapeia por identificador (`getAttachErrorToast`). Um CRM antigo mostra o toast genérico, o que é aceitável: nada é sobrescrito.

`detach_posts_from_flow` mantém assinatura e comportamento.

O guard contra UPDATE direto de `workflow_id` e `cliente_id` é o trigger `post_a0_sync_cliente`, desarmado pelo GUC transacional `app.allow_post_move`. As RPCs novas ligam o GUC imediatamente antes do UPDATE de `workflow_id` e desligam logo depois (`set_config(..., 'off', true)`), para não deixar o guard aberto no resto da transação.

### 9.4 Concorrência, versão e idempotência

- `workflows` e `workflow_etapas` não têm `updated_at` nem versão. O fingerprint de desmembrar é `md5` de `etapa_atual` + lista ordenada de `(ordem, nome, tipo, status, responsavel_id, prazo_dias, tipo_prazo, data_limite, iniciado_em)`. A UI calcula com os dados que exibe; a RPC recalcula sob lock e falha com `workflow_changed` se diferir. Editar uma etapa da origem muda o fingerprint mesmo sem mudar `etapa_atual`.
- Processos individuais usam `revisao` como versão esperada. Comando com revisão velha falha com `process_changed`. Transições que alteram o post também recebem `p_expected_post_status` e falham com `post_changed`.
- Idempotência só em `detach_posts_keeping_process`: a RPC começa consultando `post_process_batch_requests` por `p_request_id` e conta; se existe, devolve `resultado` e encerra. Senão executa e insere a linha na mesma transação. Os demais comandos são retry-safe pela revisão esperada. `callRpcWithDeadlockRetry` passa a reenviar o mesmo `request_id`.
- Duas operações simultâneas não podem criar dois processos (unicidade parcial), pular duas etapas (revisão), apagar a produção de outra aba (revisão) nem agendar e reiniciar aprovação no mesmo estado lógico (status esperado).

### 9.5 Ordem de locks

A família detach/attach/move segue: todo `pg_advisory_xact_lock` antes de qualquer row lock; ordem `:post_move` → `:max_active_workflows_per_client` → `:max_posts_per_workflow`; `:max_posts_per_workflow` antes do `FOR UPDATE` no fluxo. As RPCs novas seguem a mesma ordem, e `attach_post_closing_process` toma `:post_move` e `:max_posts_per_workflow` antes de travar fluxo e post. Arquivar fluxo vazio reaproveita a checagem sob lock de `detach_posts_from_flow`, com a mesma ressalva: a serialização contra INSERT concorrente depende do `FOR SHARE` do trigger na linha do fluxo.

### 9.6 UI

Movimento otimista com rollback em falha, refetch em `workflow_changed`/`process_changed`/`post_changed` e feedback via Sonner com mensagens em português por código. Nunca apresentar sucesso parcial como total. Invalidar `workflows`, `active-posts`, `post-processes`, contagens, `workflow-events`, `concluded-*` e `scheduled-posts` conforme o comando.

## 10. Integrações e compatibilidade

| Área | Requisito |
| --- | --- |
| Hub | Acesso por `cliente_id` e `conta_id` do post. `hub-approve` e `hub-posts` mudam como em §6.1; `hub-edit-suggestion` não muda |
| Aprovações | Nenhum reset por desmembrar, aplicar ou vincular; comandos explícitos respeitam ciclos e estados protegidos |
| Links | `/entregas?post=<id>` resolve todos os modos. `?drawer=<wf>&post=<id>` cai no resolvedor de `?post=` quando o fluxo não casa (pré-requisito 3) |
| Pastas, mídia, capas, comentários | Chaveados por `post_id`; nada é copiado. A pasta é reparentada pelo trigger `folder_sync_post` em qualquer mudança de `workflow_id` |
| Limpeza de Express | A única GC de avulsos é o passo 3 de `express-post-cleanup-cron`: `is_express AND workflow_id IS NULL AND status = 'rascunho' AND created_at < cutoff`, `DELETE` em lote por `service_role`. RLS não protege. O handler exclui posts com execução `ativo` por uma consulta prévia a `post_processes`, e o contador `avulsoSkippedWithProcess` é somado ao resumo do cron. Como Express não ganha processo automaticamente, a interseção é rara, mas o guard fica |
| Recorrência | `duplicateWorkflow` copia só etapas, nunca posts. Nada a fazer |
| MCP | Sem mudança na v1. Não existe attach via MCP: `update_post` não escreve `workflow_id` e `create_post` só define no INSERT, então nenhum guard é necessário. Campos de leitura do processo em `get_post`/`list_posts` e a correção da descrição de `create_workflow` ficam para uma entrega posterior (§13) |
| Notificações | Fluxos mantêm seu comportamento; eventos individuais não disparam automações de fluxo |
| Analytics | Histórico herdado não conta tempo nem conclusões; execuções individuais ficam fora dos gráficos |

## 11. Implantação e reversibilidade

Flag: coluna `plans.feature_post_processes boolean not null default false`, ligável por workspace via `workspace_plan_overrides.feature_overrides` no Admin da plataforma, resolvida por `effective_plan_feature`. É o único mecanismo de flag por workspace do produto; como nasce `false` em todos os planos, não altera o plano comercial (precedente: `20260815000002`). Gate: `enforce_plan_feature('feature_post_processes', 'direct', 'conta_id')` BEFORE INSERT em `post_processes`, que por ser só de INSERT já dá "desligar bloqueia novas execuções e mantém as existentes". As RPCs de criação checam `effective_plan_feature` antes, para devolver `feature_disabled:feature_post_processes` em vez de erro de trigger.

Ordem:

1. Pré-requisitos (§2) mergeados.
2. Migrações: tabelas, índices, RLS, RPCs, guard nas quatro RPCs de attach, coluna da flag. Sem backfill.
3. Edge functions: `hub-approve`, `hub-posts`, `express-post-cleanup-cron`. Deploy com `--use-api` e `--no-verify-jwt` onde a função já exige.
4. CRM capaz de ler e gerenciar processos, com a flag desligada.
5. Ligar em workspace de validação, rodar a matriz de aceitação, ampliar.

Rollback não remove tabelas com histórico nem converte processos em avulsos. Guards de attach, `hub-approve` e limpeza permanecem. Reversão destrutiva só antes da primeira execução persistida.

## 12. Critérios de aceitação

### Produto e persistência

1. Um fluxo com três posts em Design pode desmembrar um deles mantendo etapas. Após reload, dois permanecem no fluxo e um aparece como card individual em Design, com o mesmo ID, status, conteúdo e prazo efetivo congelado.
2. Avançar esse post para Aprovação não move o fluxo, os outros posts nem o status do post. Voltar por drag e por botão produz o mesmo resultado.
3. Desmembrar sem etapas reproduz o comportamento atual: sem navegação, drawer mantido, post em Sem processo quando o filtro permite.
4. Aplicar processo a um avulso aprovado preserva aprovação, mídia e data de publicação. Entrada no meio da sequência marca as anteriores como `ignorado`.
5. Dois posts desmembrados do mesmo fluxo podem ter responsáveis e prazos diferentes; editar um não altera o outro nem o template.
6. Um processo finalizado aparece em Concluídas e continua em Publicações; reabrir devolve à última etapa com o prazo vencido intacto. Remover preserva o histórico e libera nova aplicação.
7. Concluir um processo com post aguardando aprovação não aprova nem publica o post.
8. Templates com duas etapas de mesmo nome e snapshots divergentes renderizam em colunas distintas; editar ou excluir o template não altera o processo.
9. Vistas salvas antigas continuam significando Fluxos; ordenação manual mista sobrevive ao reload; contagens nunca duplicam um post desmembrado.
10. Quadro, drawers e diálogos funcionam em claro e escuro, desktop e mobile, com foco gerenciado e rótulos acessíveis; os botões de etapa são a alternativa ao drag.

### Contratos e segurança

11. Um post desmembrado de um fluxo com duas etapas de aprovação, aprovado pelo cliente no Hub durante a primeira, **não** é autoagendado; `hub-posts` o lista em `autoPublishSuspendedPostIds`. Na segunda aprovação, é autoagendado conforme `auto_publish_on_approval`.
12. Dois ciclos de aprovação reiniciam só o post elegível; `agendado`, `postado` e `falha_publicacao` não são reiniciados. "Avançar sem alterar post" preserva status, custom status e aprovações.
13. Falha em um lote de desmembrar mantém todos os posts na origem. Repetir o mesmo `request_id` devolve o resultado original sem criar novas execuções ou eventos; um comando com revisão velha falha com `process_changed`.
13a. `apply_post_process` com `p_step_overrides` contendo nome, tipo ou ordem é rejeitado; com responsável de outra conta é rejeitado; com template editado depois de abrir o diálogo falha com `template_changed`.
14. Editar uma etapa do fluxo de origem entre abrir o diálogo e confirmar falha com `workflow_changed`.
15. IDs de post, template, fluxo, membro ou processo de outra conta são rejeitados; RLS bloqueia leituras cruzadas; escrita direta nas três tabelas por `authenticated` falha; workspace ativo nulo falha antes de mutar. Membro sem permissão `entregas.editar` recebe erro de permissão.
16. `attach_posts_to_flow` e as duas RPCs de mover falham com `post_has_active_process` para post com execução vigente; `attach_post_closing_process` encerra e vincula respeitando o limite do fluxo.
17. Arquivar fluxo vazio não arquiva fluxo que recebeu outro post. Fluxo ou template excluído não leva o processo.
18. A limpeza de Express não apaga rascunho com execução ativa. Flag desligada mantém execuções visíveis e operáveis.
19. Mídia, capas, comentários, valores de propriedade e histórico de aprovações sobrevivem a desmembrar, aplicar, remover e vincular; nenhum arquivo é duplicado. Remover um membro responsável por etapa individual continua funcionando e a etapa fica sem responsável.

### Validação

- Vitest: `BoardEntity` e composição do quadro misto, `approvalAdvance.ts`, filtro de entidade e `viewQuery`, `etapaDeadlineDateOf` com `prazo_efetivo`, diálogos, rollback e mapeamento de erros.
- SQL em `supabase/tests/entitlements`: invariantes, RLS com duas contas usando `et_grant_hosted_parity`, guard das quatro RPCs, fingerprint, revisão, `request_id`, exclusão de origem, rollback de lote, limite do fluxo, permissão por papel.
- Deno: `hub-approve` com processo individual, `hub-posts` com o novo array, `express-post-cleanup-cron` com o guard.
- E2E: desmembrar mantendo etapas → mover individualmente → conferir fluxo e status → vincular; aplicação, conclusão e reabertura; modo antigo sem etapas.
- Antes de integrar: os quatro typechecks do CI, `npm run test`, `npm run test:functions`, `npm run lint`, `npm run format:check`, `migration-version-guard`, entitlements e E2E aplicáveis.

## 13. Evolução posterior

A segunda fase poderá permitir posts com etapas próprias dentro de um grupo organizacional. Exige definir agrupamento separadamente de `workflow_id`, revisar ações em lote, recorrência e conclusão do grupo, e mostrar distribuição ("3 em Copy, 2 em Design") sem inventar uma etapa única. Não acrescentar flags ou modos parciais dessa fase na v1. Follow-ups registrados aqui: `TABS_THRESHOLD`, filtros de formato e status no modo Fluxos, paginação de Sem processo, sensor de teclado no drag, campos de leitura do processo no MCP (`get_post`/`list_posts`) e a descrição desatualizada de `create_workflow`, e uma transição server-side da etapa de aprovação quando o cliente aprova no Hub, se o avanço manual se mostrar oneroso.

## 14. Referências

- [Design de posts avulsos](2026-08-28-posts-avulsos-design.md) e [plano](2026-08-29-posts-avulsos-plan.md)
- [Mover posts entre fluxos](2026-09-01-mover-posts-entre-fluxos-design.md)
- [Sistema de design](../../../DESIGN_SYSTEM.md)
- `apps/crm/src/store/workflows.ts`: `WorkflowEtapa`, `completeEtapa`, `completeEtapaWithRearm`, `revertEtapa`, `reopenWorkflow`, `duplicateWorkflow`
- `apps/crm/src/store/posts.ts`: `CLIENT_CLEARED_STATUSES`, `sendPostsToCliente`, `approvePostsInternally`, `resetApprovedPostsForNextCycle`, `detachPostsFromWorkflow`, `attachPostToWorkflow`, `movePostsTo*`, `callRpcWithDeadlockRetry`, `getActivePosts`
- `apps/crm/src/pages/entregas/`: `EntregasPage.tsx`, `hooks/useEntregasData.ts`, `views/KanbanView.tsx`, `views/ConcludedView.tsx`, `components/WorkflowDrawer.tsx`, `components/StandalonePostDrawer.tsx`, `components/PostEditorBody.tsx`, `components/AttachToFluxoDialog.tsx`, `components/autoComplete.ts`, `etapaPrazo.ts`, `deadlineStatus.ts`, `postsBoardOrder.ts`, `entregasPrefs.ts`, `viewQuery.ts`, `savedViews.ts`, `postTimeline.ts`, `tour/tourGating.ts`
- `supabase/migrations/`: `20260830000001_workflow_posts_cliente_id.sql` (guard `post_a0_sync_cliente`), `20260830000003_avulso_notifications_folders_views.sql` (`folder_sync_post`), `20260830000004_post_detach_attach_rpcs.sql`, `20260901110000_move_posts_between_flows.sql`, `20260805000001_post_status_definitions.sql` (trigger z1), `20260606000001_post_status_events.sql`, `20260826000001_workflow_events.sql`, `20260903000002` e `20260904000002` (`workspace_roles`, `has_permission_for`), `20260611140001` e `20260611140002` (`effective_plan_feature`, `enforce_plan_feature`), `20260815000002` (precedente de flag dark), `20260903000010_workflows_concluido_em.sql`
- `supabase/functions/`: `hub-approve/handler.ts` (`isFinalApprovalCycle`), `hub-posts/handler.ts` (`autoPublishSuspendedWorkflowIds`), `express-post-cleanup-cron/handler.ts` (passo 3), `mcp/queries.ts`, `_shared/entitlements.ts`
- `supabase/tests/entitlements/`: `_helpers.sql`, `70_workflow_posts_avulsos.sql`, `72_move_posts_between_flows.sql`, `75_permission_rls_rewire.sql`
