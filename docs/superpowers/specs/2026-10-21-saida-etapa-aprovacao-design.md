# Saída de etapa de aprovação: o usuário escolhe o status dos posts

Data: 2026-10-21 · Status: aguardando aprovação do documento

## Por quê

Quando um fluxo sai de uma etapa `aprovacao_cliente`, uma regra escondida ("re-arm") manda os
posts `aprovado_cliente` de volta para `rascunho` sempre que existe outra etapa de aprovação mais
adiante (`completeEtapaWithRearm` → `resetApprovedPostsForNextCycle`, e o equivalente dentro da
RPC `transition_post_process` para posts avulsos). Muitos usuários não entendem o que "avançar
etapa" faz com os posts e se assustam quando os posts aprovados voltam para rascunho. Eles querem
**ver e escolher** o que acontece.

Objetivo: toda saída manual de uma etapa de aprovação passa por um diálogo que mostra o estado dos
posts e deixa o usuário escolher. Nada muda de status sem o usuário ter visto.

### Não-objetivos

- Não muda o que acontece ao sair de etapas `padrao` (nunca tocam em status) nem ao voltar etapa.
- Não muda o Hub (aprovação do cliente) nem a regra `isFinalApprovalCycle` do `hub-approve`.
- Não cria configuração por template ("ao sair: perguntar/manter/rascunho"). Pode vir depois.

### Anti-objetivos (seria falha mesmo funcionando)

- Algum caminho continuar mandando posts para rascunho sem o usuário escolher.
- Um post `agendado` ou `postado` ter o status alterado por qualquer opção nova.
- Dois diálogos em sequência para um único avanço.

## Comportamento atual (referência)

- `decideApprovalAdvance` (`apps/crm/src/pages/entregas/approvalAdvance.ts`): fora de
  `aprovacao_cliente` avança direto. Com todos os posts "cleared" (`CLIENT_CLEARED_STATUSES`:
  `aprovado_cliente`, `agendado`, `postado`, `falha_publicacao`) avança direto, com re-arm se
  houver aprovação adiante. Senão abre `ClientApprovalChoiceDialog` (Aprovar internamente / Enviar
  ao portal / Avançar sem alterar posts).
- Antes disso, "Concluir etapa e avançar" abre `ForwardConfirmDialog`.
- Caminhos de fluxo: `useWorkflowStageCommands` (Kanban de Entregas, menus e swipe do phone),
  `EntregasTab` (aba Entregas do cliente, cópia própria da cadeia) e o auto-complete do
  `WorkflowDrawer` (último post aprovado com o drawer aberto → conclui a etapa com re-arm).
- Post avulso: `usePostProcessCommands` → RPC `transition_post_process(p_approval_choice in
  ('aprovar_interno','sem_alterar'))`, que faz o re-arm no banco
  (`supabase/migrations/20260919000005_transition_post_process.sql`, ~linha 188).

## Novo comportamento: fluxos

### O diálogo único

Abre **toda vez** que um fluxo sai manualmente de uma etapa `aprovacao_cliente` (botão "Concluir
etapa e avançar", menus/swipe do phone, drag entre colunas no Kanban, aba Entregas do cliente).
Substitui, nesse caso, **os dois** diálogos atuais (`ForwardConfirmDialog` +
`ClientApprovalChoiceDialog`): um avanço = um diálogo. Saída de etapa `padrao` continua com o
`ForwardConfirmDialog` de hoje.

Conteúdo (mockup aprovado: `.superpowers/brainstorm/*/content/advance-dialog.html`):

- Título: `Avançar "<fluxo>" para <próxima etapa>?` (na última etapa: concluir o fluxo; texto a
  cargo do builder).
- Linha: "Este fluxo está saindo de uma etapa de aprovação. Escolha o que acontece com os posts."
- Chips com a contagem por status dos posts do fluxo (só status com contagem > 0).
- Escolha única (radio cards), cada uma com uma linha de consequência que usa números reais:

| Opção | Aparece quando | Efeito | O fluxo avança? |
|---|---|---|---|
| **Manter status atuais** | sempre | nenhum post muda | sim |
| **Aprovar todos** | existe post pendente (não cleared) | todos os posts que não estão `agendado`/`postado` viram `aprovado_cliente` (= `approvePostsInternally` de hoje) | sim |
| **Voltar todos para rascunho** | existe post alterável **e** o fluxo não está na última etapa | todos os posts que não estão `agendado`/`postado`/`falha_publicacao` viram `rascunho`; histórico de `post_approvals` é preservado | sim |
| **Enviar ao portal** | existe ≥1 post `aprovado_interno` | mesmo efeito de hoje (`sendPostsToCliente`, que só move `aprovado_interno`); a linha de consequência conta só esses posts | **não** |

`falha_publicacao` nunca vai para rascunho: sair desse status reseta os destinos TikTok em
falha/agendados (`workflow_posts_reset_tiktok_target`, migration 20261014000002) e apaga o erro
de publicação.

**Escrita atômica (obrigatório).** Hoje a mudança de status e o avanço são escritas separadas no
cliente (`approvePostsInternally` e depois `completeEtapa`, que por sua vez são 3-4 PATCHes). O
diálogo novo grava escolha + avanço numa **RPC única** `SECURITY DEFINER` (autentica o usuário,
deriva `conta_id`, confere o fluxo no tenant) que:
- recebe o `etapa_id` esperado e falha com `etapa_changed` se a etapa ativa não for mais essa
  (outro membro moveu o fluxo);
- recebe a contagem por status que o diálogo mostrou e falha com `posts_changed` se ela mudou
  (ex.: o cliente aprovou ou pediu correção no Hub com o diálogo aberto). Nos dois casos o CRM
  recarrega os dados e reabre o diálogo com os números novos, com um aviso curto;
- aplica a escolha e conclui a etapa na mesma transação.
"Enviar ao portal" não avança e pode continuar sendo o `sendPostsToCliente` de hoje.

**Contagens.** `WorkflowPostStats` do Kanban não tem a distribuição por status. O diálogo busca
os posts do fluxo ao abrir (consulta dedicada, um único lugar usado por Kanban, phone e aba
Entregas) e calcula chips, opções e números a partir dela. Enquanto carrega, o botão Avançar fica
desabilitado.

- Rodapé fixo: "Posts agendados ou publicados nunca são alterados."
- Botões: Cancelar / **Avançar** (o rótulo vira "Enviar ao portal" quando essa opção está
  marcada).
- Opção pré-selecionada, marcada "Recomendado":
  - há outra etapa `aprovacao_cliente` adiante (`hasLaterApprovalEtapa`) → **Voltar todos para
    rascunho** (é o que acontece hoje, agora visível);
  - senão → **Manter status atuais**.
- Phone: mesma escolha no `PhoneConfirmSheet` (padrão já usado pelo `ClientApprovalChoiceDialog`).

Depois de "Aprovar todos" o nudge de agendamento em lote (`AutoScheduleBatchDialog`) continua
abrindo como hoje, com o mesmo gate (`schedulingEnabled`, `auto_publish_on_approval`), e
`isFinalApprovalCycle` = não há aprovação adiante. A precedência do `RecurringWorkflowDialog`
continua igual.

O toast "Posts voltaram para rascunho para o próximo ciclo de aprovação." sai: o usuário escolheu.
A mensagem de sucesso de cada opção fica a cargo do builder (sem travessão, ver memória de copy).

### Auto-complete do drawer

Quando o cliente aprova o último post pendente com o `WorkflowDrawer` aberto, a etapa continua
sendo concluída sozinha, **sem diálogo e sem alterar status** (sem re-arm). Os posts aprovados
continuam aprovados.

### Fim do re-arm automático

Nenhum caminho do CRM chama mais o re-arm implícito. `completeEtapaWithRearm` deixa de ser usado
para avanço (pode virar código morto e ser removido); a decisão de status vem só da escolha do
usuário. `ComoFuncionaPanel` e qualquer texto de ajuda que descreva o re-arm automático precisam
ser atualizados.

### Banner "Voltar todos para rascunho" (drawer do fluxo)

Mockup aprovado: opção A de `.superpowers/brainstorm/*/content/reset-placement.html` (banner
acima da lista de posts, com X).

- **Aparece quando:** a etapa ativa é `padrao`, vem depois de uma etapa `aprovacao_cliente`
  concluída, existe outra etapa `aprovacao_cliente` adiante e o fluxo tem posts
  `aprovado_cliente`. Sem aprovação adiante, post aprovado ficar aprovado é o correto: sem banner.
  Com a etapa ativa já sendo de aprovação, não há banner: não dá para distinguir post que veio
  aprovado do ciclo anterior de post que o cliente acabou de aprovar. Num fluxo Aprov → Aprov
  direto, a escolha fica só no diálogo (onde rascunho já vem pré-selecionado).
- **Texto:** "N posts continuam aprovados." + "A próxima etapa de aprovação vai precisar deles em
  rascunho para enviar ao cliente de novo." + botão **Voltar todos para rascunho** + X.
- **Ação:** confirmação curta, depois `aprovado_cliente` → `rascunho` (só esses; mesmo filtro do
  `resetApprovedPostsForNextCycle` atual). O banner some.
- **Dispensar (X):** esconde o banner para aquele fluxo **para toda a equipe**. Persistência:
  um timestamp `dispensado_em` no fluxo. O banner aparece só se o `concluido_em` da etapa de
  aprovação concluída mais recente for **posterior** a `dispensado_em`. Assim, sair de outra etapa
  de aprovação (ou voltar e sair da mesma de novo) abre um ciclo novo e o banner pode reaparecer.
- **Escrita da dispensa e do reset:** por RPC `SECURITY DEFINER` que autentica o usuário, deriva
  `conta_id`, confere o fluxo/processo no tenant e recebe o ciclo esperado (o `concluido_em` da
  etapa que originou o banner). `post_processes` só tem `SELECT` para membros, então o caminho
  dos posts avulsos obrigatoriamente passa por RPC; o de fluxos segue o mesmo padrão.
- **Onde:** drawer do fluxo no desktop e no phone. Kanban e aba Entregas do cliente não mostram
  banner (usam só o diálogo).

## Novo comportamento: posts avulsos (processo individual)

Mesma ideia, adaptada a um post (`usePostProcessCommands`, cabeçalho do drawer do post, card do
Kanban, Concluídas):

- Ao **avançar** saindo de um passo `aprovacao_cliente`: diálogo com o status atual do post e as
  opções **Manter status**, **Aprovar** (só se não estiver aprovado/cleared), **Voltar para
  rascunho**, **Enviar ao portal** (só se pendente e enviável, respeitando
  `sendPostToCliente`/`sendToPortalDisabledReasonFor`; o processo não anda). Pré-seleção:
  rascunho se houver passo de aprovação pendente adiante (`hasLaterPendingApprovalStep`), senão
  manter.
- Ao **concluir o processo** a partir de um passo de aprovação: sem "Voltar para rascunho" (o
  processo termina). Opções: Manter / Aprovar / Enviar ao portal.
- Post `agendado`/`postado`: o diálogo mostra só a confirmação do avanço com a nota "O status do
  post não muda."
- Substitui `ForwardConfirmDialog` + `ClientApprovalChoiceDialog` também aqui (um diálogo).
- **Backend:** `transition_post_process` hoje faz o re-arm sozinho. Nova migration (versão única,
  acima da última de main) que:
  - aceita a escolha nova `voltar_rascunho`; `sem_alterar` passa a significar realmente "não
    mexer";
  - remove o re-arm implícito; `p_approval_choice = NULL` num post cleared = manter (abas antigas
    do CRM, que seguem rodando até a troca silenciosa, avançam sem erro e sem re-arm);
  - **rejeita** `voltar_rascunho` com `concluir` e quando o post está `agendado`, `postado` ou
    `falha_publicacao` (não só esconde na UI). Nos demais status, inclusive `enviado_cliente`,
    o post vai para `rascunho`;
  - mantém a checagem de `p_expected_post_status` e a revisão otimista.
- **Banner** no editor/drawer do post avulso, com as mesmas regras do banner do fluxo, no
  singular ("Este post continua aprovado."), com o X persistido por processo.

## Decisões deixadas ao builder

- Nome e tabela exatos das colunas de dispensa (`workflows`, `post_processes`), dentro da regra
  de timestamp acima.
- Copy exata dos toasts de sucesso, do aviso de `posts_changed`/`etapa_changed` e do título na
  última etapa.
- Artigos da Central de Ajuda (no banco, via mcp-admin) que descrevam o re-arm automático: fora
  do código, tratados como tarefa de conteúdo separada depois do merge.
- Se o diálogo novo é um componente novo ou uma reescrita de `ClientApprovalChoiceDialog`.
- Unificar ou não a cópia da cadeia em `EntregasTab` com `useWorkflowStageCommands`.

## Calls feitos por Claude (não confirmados explicitamente pelo usuário)

- Pré-seleção copia o comportamento de hoje (rascunho se houver aprovação adiante).
- "Voltar todos para rascunho" no diálogo pega todos os posts alteráveis (inclusive
  `enviado_cliente`, tirando-os do portal); o banner pega só os `aprovado_cliente`.
- `falha_publicacao` é tratado como travado para "rascunho", mas segue a regra atual de
  `approvePostsInternally` em "Aprovar todos".
- Dispensa do banner vale para a equipe toda, por ciclo de aprovação (timestamp).
- Avanço de fluxo vira RPC atômica com checagem de etapa e de contagens; conflito recarrega e
  reabre o diálogo.
- Sem banner enquanto a etapa ativa for de aprovação.
- Na última etapa do fluxo e no "Concluir" do post avulso não há "Voltar para rascunho".
- `falha_publicacao` nunca vai para rascunho, e a RPC rejeita isso explicitamente.
- `NULL` na RPC de processo = manter.

## Verificação

- Testes unitários da decisão (opções visíveis, pré-seleção) para fluxo e post.
- Testes dos dois suites `__tests__` que assumem re-arm automático precisam ser atualizados.
- Suite SQL/RPC de `transition_post_process` para a nova escolha e para "sem re-arm".
- Verificação no browser: Kanban (botão e drag), phone, aba Entregas do cliente, drawer
  (auto-complete + banner), post avulso.
