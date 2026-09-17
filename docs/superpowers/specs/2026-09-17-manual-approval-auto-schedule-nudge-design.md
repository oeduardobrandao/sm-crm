# Aprovação manual na CRM não aciona agendamento automático — Design

## Contexto

Investigando por que 8 posts do workspace Anebi Comunica (cliente 544, "Carlão do Lucídio -
Vereador", `auto_publish_on_approval = true`) ficaram parados em `aprovado_cliente` sem
agendar sozinhos, a suspeita inicial era a regressão de PNG já corrigida no PR #482
(`4dc0ab94`, 2026-09-10). Investigação descartou essa hipótese: `image/png` está em
`ALLOWED_IMAGE_MIMES` desde então e `hub-approve` foi redeployado em 2026-09-16 (já com o
fix). A causa real é outra.

`auto_publish_on_approval` só é lido e agido em UM lugar do código:
`supabase/functions/hub-approve/handler.ts:158-185` (função `isFinalApprovalCycle` em
`:25`), acionado exclusivamente quando o CLIENTE aprova um post pelo Hub (RPC
`record_client_approval`, fluxo por token). `post_status_events` em produção confirma que os
8 posts foram movidos de `rascunho` para `aprovado_cliente` por uma pessoa da equipe da
Anebi (`source: workspace_user`, ator "Fabiane"), um de cada vez, entre 19:06 e 19:15 UTC de
2026-09-17 — nenhum tem linha em `post_approvals`. Ou seja: o cliente nunca aprovou pelo Hub;
alguém da agência marcou os posts como aprovados diretamente na CRM. Esse caminho de escrita
(`updateWorkflowPost` em `apps/crm/src/store/posts.ts`, usado pelo dropdown de status do
`WorkflowDrawer.tsx` e pelo drag-and-drop do kanban via `useUpdatePostStatus.ts`, ou o botão
em lote `approvePostsInternally`) é um `.update()` direto no Supabase — nunca passa por
`hub-approve`, então o agendamento automático nunca é avaliado, PNG ou não.

A mesma pessoa empurrou os 8 posts de `aprovado_cliente` para `agendado` manualmente ~20 min
depois (19:28–19:29 UTC), também por escrita direta de status — não pelo botão "Agendar
publicação" (`ScheduleButton.tsx`), o que explica por que datas já passadas não bloquearam
essa correção manual (ver Decisão 1 abaixo sobre por que isso importa para o design).

**Não é um caso isolado.** Em produção, 22 posts adicionais em 8 outros clientes com
`auto_publish_on_approval = true` estão hoje em `aprovado_cliente` sem nenhuma linha em
`post_approvals` — o mesmo buraco, silencioso, em andamento (verificado via
`npx supabase db query --linked` contra `skjzpekeqefvlojenfsw`, excluindo os 8 posts da
Anebi já corrigidos manualmente e um grupo de 8 linhas de `Débora Kristin` com
`updated_at` de junho, claramente obsoletas/de teste).

### Decisão de produto

Em vez de impor o agendamento automático toda vez que um post entra em `aprovado_cliente`
por qualquer caminho (o que replicaria a lógica de `hub-approve`, incluindo
`isFinalApprovalCycle`, em outro lugar e criaria risco de repetir o bug do PR #400), a
decisão foi **avisar e oferecer um atalho**: quando a CRM detecta que uma aprovação manual
"deveria" ter agendado sozinha, mostra um caminho de um clique para fazer o mesmo que o
agendamento automático teria feito — reaproveitando o botão de agendar manual que já existe,
não construindo um agendamento paralelo.

## Peça já existente sendo reaproveitada

`ScheduleButton.tsx` já renderiza "Agendar publicação" sempre que `post.status ===
'aprovado_cliente'`, dentro do editor completo do post (`PostEditorBody.tsx`, usado tanto por
`WorkflowDrawer.tsx` quanto por `StandalonePostDrawer.tsx`). Ele já faz toda a validação
necessária (mídia, legenda, conta conectada, TikTok) via
`instagram-publish/schedule/:postId` (edge function autenticada por JWT da CRM, que roda o
mesmo `validateForScheduling` usado por `hub-approve`). O problema não é falta de
funcionalidade — é que esse botão não aparece nas visões compactas onde o status
normalmente é trocado (linha da lista de posts no `WorkflowDrawer`, card do kanban), e
ninguém é avisado de que deveria ir abrir o editor completo para agendar.

Este design **não cria nenhuma function nova, tabela nova ou coluna nova**. Extrai a lógica
de agendamento de `ScheduleButton.handleSchedule` para um helper compartilhado e reaproveita
esse helper em três lugares novos.

## Escopo

Só posts de fluxo (`workflow_posts.workflow_id != null`) — kanban/board. Posts avulsos
(`workflow_id == null`, `StandalonePostDrawer.tsx`) ficam de fora desta rodada: o ciclo de
aprovação deles usa `post_processes`/`post_process_steps` em vez de `workflow_etapas`
(`hub-approve/handler.ts:45-65`), um mecanismo diferente que precisaria de investigação
própria. `ScheduleButton` já aparece dentro do `StandalonePostDrawer` (mesmo
`PostEditorBody`), então o buraco prático é menor do que parece — só falta o mesmo tipo de
aviso, que fica como trabalho futuro.

## Decisões (confirmadas em brainstorming 2026-09-17, com revisão do Fable e do Codex antes de fechar)

1. **Elegibilidade para agendar em um clique exige data futura com margem, não só "tem
   data".** `validateForScheduling` (`_shared/instagram-publish-utils.ts:83-85`) rejeita
   `scheduled_at` a menos de 10 minutos no futuro. A maioria dos 22 posts do backlog tem
   `scheduled_at` já no passado (estão parados há dias). Um fluxo que só checasse
   `!!post.scheduled_at` chamaria o schedule endpoint, tomaria 422 e pioraria a experiência
   exatamente nos posts que motivam este trabalho. **Revisão externa (Codex) apontou que o
   limite exato de 10 min no cliente corre risco de virar inválido durante a latência do
   request** (usuário confirma no instante exato do limite, o POST chega alguns segundos
   depois já abaixo dos 10 min do servidor) — regra usada em todo o design tem margem de
   segurança de 2 min:
   ```ts
   const SCHEDULE_SAFETY_MARGIN_MS = 2 * 60 * 1000;
   const isEligibleToScheduleNow = (scheduledAt: string | null) =>
     !!scheduledAt &&
     new Date(scheduledAt).getTime() >= Date.now() + 10 * 60 * 1000 + SCHEDULE_SAFETY_MARGIN_MS;
   ```
   Quando falso, o fluxo abre `DateTimePicker` (o mesmo componente que `PostEditorBody.tsx:429`
   já usa para `scheduled_at`, com `futureOnly`) pré-preenchido com a data antiga se houver,
   em vez de tentar agendar direto. O servidor continua sendo a fonte de verdade: mesmo com a
   margem, um 422 residual (relógio do cliente adiantado, latência anormal) é tratado como
   qualquer outro erro do endpoint (ver seção Design técnico, tratamento de erro) — a margem
   só reduz a frequência, não substitui a validação do servidor.

2. **Cobrir os dois casos: aprovações futuras E o backlog já parado.** Um diálogo disparado
   só na transição de status nunca alcançaria os 22 posts já parados (nenhuma escrita de
   status vai acontecer de novo neles). Por isso o design tem três peças, não uma (ver Design
   técnico): diálogo na transição individual, diálogo de resumo na aprovação em lote, e um
   indicador persistente para o que já está parado.

3. **Gate do "ciclo final de aprovação" espelha `isFinalApprovalCycle` do `hub-approve`, sem
   recomputar onde já existe.** Para a transição individual (dropdown/drag), não existe
   nenhum sinal equivalente calculado no cliente — precisa de um helper novo, mirror direto
   do branch `workflow_id != null` de `isFinalApprovalCycle`
   (`hub-approve/handler.ts:29-43`): contar `workflow_etapas` do `workflow_id` do post com
   `tipo = 'aprovacao_cliente' AND status != 'concluido'`, exigir `< 2`. Vai em
   `apps/crm/src/store/workflows.ts`, ao lado de `hasLaterApprovalEtapa` (`:341`), com
   comentário apontando para a function do servidor para não desalinhar os dois no futuro.
   RLS de `workflow_etapas` é por workspace (`20260315_rls_security_audit.sql:319-322`), então
   a CRM autenticada enxerga exatamente as mesmas linhas que a function com service role — o
   mirror é seguro.

   Para a aprovação em lote (`approvePostsInternally` + avançar etapa), esse sinal **já
   existe**: `decideApprovalAdvance` (`apps/crm/src/pages/entregas/approvalAdvance.ts:24`)
   calcula `willRearm`, guardado em `approvalChoice.willRearm` tanto em
   `KanbanView.tsx:1076` quanto em `EntregasTab.tsx:429` (segundo call site do mesmo fluxo,
   que a primeira versão deste design tinha deixado de fora). Usar `!willRearm` direto —
   recomputar a contagem de etapas seria duplicar um cálculo que o próprio fluxo de avançar
   etapa já fez.

4. **Diálogo de lote abre logo após `approvePostsInternally` resolver — não depois de
   `advanceEtapa`/`completeEtapaForAdvance`.** A primeira versão deste design exigia esperar
   o avanço de etapa "resolver com sucesso" antes de abrir o diálogo, para não oferecer
   agendar posts que `completeEtapaWithRearm` estivesse prestes a devolver para `rascunho`
   (`resetApprovedPostsForNextCycle`). **Revisão externa (Codex) apontou que esse sinal não
   existe**: em `KanbanView.tsx`, `advanceEtapa` (`:1019`) captura o erro de
   `completeEtapaForAdvance` internamente, mostra um toast e retorna `void` sem relançar —
   `await advanceEtapa(...)` sempre resolve (fulfilled), sucesso ou falha, então não há como
   o chamador diferenciar os dois casos por fora.

   A correção não é inventar um contrato de sucesso/exceção novo em `advanceEtapa` — é
   perceber que a garantia que essa ordem tentava proteger já vem de outro lugar:
   `willRearm` é calculado por `decideApprovalAdvance` **antes** de qualquer uma dessas
   chamadas (a partir do tipo da etapa e das contagens do workflow, não do resultado da
   RPC), e `resetApprovedPostsForNextCycle` só roda como parte de um rearm que `willRearm`
   já previu. Como o gate da decisão 3 exige `!willRearm`, um post só chega ao diálogo de
   lote quando um rearm nunca ia acontecer, `completeEtapaForAdvance` tendo sucesso ou não —
   `approvePostsInternally` já é quem efetivamente grava `aprovado_cliente` no banco, e nada
   depois disso desfaz essa escrita quando `!willRearm`. Portanto: abrir o diálogo assim que
   `approvePostsInternally` resolver é seguro e mais simples; esperar `advanceEtapa` não
   adiciona nenhuma garantia real, só um sinal de sucesso que a função não fornece.

5. **`feature_post_scheduling` precisa ser checado antes de qualquer aviso.**
   `instagram-publish/handler.ts:70-76` devolve 403 `feature_disabled` para `action ===
   "schedule"` quando o plano do workspace não inclui `feature_post_scheduling`. Um diálogo
   que aparece sozinho e termina em "feature_disabled" é pior do que não avisar nada. Gate
   adicional em todos os três pontos — **correção (Codex): `useWorkspaceLimits()` não expõe
   o flag no nível raiz, ele vem dentro de `features`** (`useWorkspaceLimits.ts:91-97`
   devolve `{ limits, features, planName, isLoading, isUnlimited }`), então a checagem certa
   é `useWorkspaceLimits().features?.feature_post_scheduling === true` (com `isLoading`
   tratado como "ainda não sabemos" — não mostrar nada até resolver).

6. **`platform === 'both'` chama só `scheduleTikTokPost`, nunca os dois.** Confirmado em
   `ScheduleButton.tsx` (`handleSchedule`, `~L323-339`): para `both`, só `scheduleTikTokPost`
   é chamado — o comentário de cabeçalho do arquivo (`~L38-42`) documenta que o servidor do
   TikTok valida os dois lados nesse caso. O helper compartilhado (Design técnico) precisa
   replicar esse branch exatamente, não "os dois serviços" ingenuamente.

## Design técnico

### Helper compartilhado: `scheduleApprovedPost`

Novo arquivo pequeno, ex. `apps/crm/src/pages/entregas/scheduleApprovedPost.ts`, extraindo o
branch de `ScheduleButton.handleSchedule` (decisão 6):

```ts
export async function scheduleApprovedPost(post: Pick<WorkflowPost, 'id' | 'platform' | 'scheduled_at'>) {
  const targetsTikTok = post.platform === 'tiktok' || post.platform === 'both';
  if (targetsTikTok) return scheduleTikTokPost(post.id!, post.scheduled_at!);
  return scheduleInstagramPost(post.id!);
}
```

`ScheduleButton.tsx` passa a chamar esse helper em vez de duplicar o branch — única fonte da
regra "both usa TikTok", usada pelos três pontos novos abaixo e pelo botão que já existia.

### 1. Diálogo na transição individual

Disparado no `onSuccess`/sucesso da escrita de status para `aprovado_cliente`, nos pontos que
hoje fazem essa escrita direta:
- `useUpdatePostStatus.ts` (usado por `PostsKanbanView.tsx:556` — drag do kanban)
- `WorkflowDrawer.tsx`, os dois call sites de troca de status (`:438` e `:458`)

Gates (todos obrigatórios): `clientes.auto_publish_on_approval`, `feature_post_scheduling`,
gate da decisão 3 (etapas). Se algum falhar, comportamento de hoje sem alteração.

- Elegível (decisão 1): `AlertDialog` bloqueante — "Este cliente agenda automaticamente
  quando um post é aprovado. Deseja agendar agora para {data formatada}?" / Cancelar /
  Agendar. Confirmar chama `scheduleApprovedPost(post)`.
- Não elegível: o mesmo diálogo mostra `DateTimePicker` (pré-preenchido com a data antiga se
  houver) no lugar do texto de confirmação, com botão "Definir e agendar". **Correção
  (Codex): `scheduleApprovedPost` não pode receber o `post` da closure original nesse
  branch** — para TikTok/`both` ele lê `post.scheduled_at` e enviaria a data antiga (ou
  `null`) no request, que o endpoint do TikTok exige e rejeitaria. `updateWorkflowPost`
  devolve a linha atualizada (`Promise<WorkflowPost>`); o botão usa esse retorno:
  `const updated = await updateWorkflowPost(id, { scheduled_at }); await
  scheduleApprovedPost(updated);` — nunca o `post` capturado antes da escolha da data.
- Erro do schedule endpoint (`details` do `validateForScheduling`, ex. legenda faltando):
  **correção (Codex): `ScheduleButton` não tem nenhum padrão de erro inline para reaproveitar**
  — tanto `handleSchedule` quanto o `handlePublishNow` do próprio diálogo de confirmação de
  `ScheduleButton` só fazem `toast.error(err.message)` (e, no caso do diálogo, fecham o
  diálogo antes de disparar o toast). O diálogo novo segue o mesmo padrão em vez de inventar
  um estado de erro inline: fecha e mostra `toast.error(err.message)`. O post permanece em
  `aprovado_cliente` de qualquer forma (a chamada de schedule só muda o status em caso de
  sucesso) — para reagendar, a pessoa usa o indicador persistente (peça 3), que continua
  visível enquanto o post estiver em `aprovado_cliente`.

### 2. Diálogo de resumo na aprovação em lote

Pontos: `handleApproveInternally` em `KanbanView.tsx:1089` e o equivalente em
`EntregasTab.tsx:~452`. Assim que `approvePostsInternally` resolver (decisão 4 — não espera
`advanceEtapa`/`completeEtapaForAdvance`), se `clientes.auto_publish_on_approval`,
`features?.feature_post_scheduling` e `!approvalChoice.willRearm` (decisão 3): diálogo único
— "N posts aprovados. M já têm data definida e podem ser agendados agora." Botão "Agendar N
posts" chama `scheduleApprovedPost` em loop para os M elegíveis (decisão 1) a partir do
snapshot local de posts que `approvePostsInternally` moveu (o `.update()` em
`store/posts.ts:1272` devolve `void`, então N/M vêm do estado do board já carregado antes da
chamada, não do retorno). Toast final com contagem de sucesso/falha. Posts sem data elegível
ficam listados como "sem data — agende manualmente", sem alteração.

Não há chamada em lote no backend — é um loop sequencial de `scheduleApprovedPost`, aceitável
dado que `max_posts_per_workflow` já limita N por workflow (sem endpoint de batch existente
hoje, e criar um seria escopo novo sem necessidade — nenhum workflow observado tem volume que
justifique).

### 3. Indicador persistente para o backlog já parado

Cobre os posts que já estão hoje em `aprovado_cliente` sem nunca mais sofrer uma escrita de
status (os 22 do levantamento, mais qualquer futuro caso que passe pelas peças 1/2 sem ser
resolvido na hora).

**Correção (Codex, P0): a primeira versão desta seção esqueceu o gate da decisão 3.** Sem
ele, um post no PRIMEIRO ciclo de um fluxo de dupla aprovação (ainda em `aprovado_cliente`,
com uma segunda etapa `aprovacao_cliente` pendente à frente) ganharia uma ação "Agendar"
sempre visível e agendaria antes da segunda aprovação — exatamente o bug do PR #400,
reintroduzido por uma superfície de UI nova em vez do fluxo antigo. Nenhum dos dois endpoints
de publicação aplica `isFinalApprovalCycle` por conta própria (ele só existe dentro de
`hub-approve`), então essa checagem tem que vir do lado do indicador. Gates completos, os
mesmos três da peça 1: `clientes.auto_publish_on_approval`, `features?.feature_post_scheduling`,
e o helper mirror de `isFinalApprovalCycle` da decisão 3 — computado a partir das etapas do
workflow que a própria view já carrega (`card.allEtapas` no kanban, etapas do workflow no
`WorkflowDrawer`), sem round-trip novo.

Dois lugares:

- **Badge/ação compacta por post**, onde hoje só aparece o badge estático "Aprovado pelo
  cliente" sem `ScheduleButton` por perto: linha do post no `WorkflowDrawer` (view "Posts") e
  face do card no kanban. Todos os gates acima + `isEligibleToScheduleNow` decide se o clique
  agenda direto ou abre o `DateTimePicker` primeiro. Mesmo helper `scheduleApprovedPost`,
  mesmo padrão de erro (toast, sem estado inline) da peça 1.
- **Resumo no cabeçalho de posts do `WorkflowDrawer`**, ao lado de "N de M aprovados pelo
  cliente": quando há pelo menos um post elegível para este indicador (passando todos os
  gates, inclusive o de ciclo final), mostra "K aguardando agendamento automático" com ação
  "Agendar" que dispara o mesmo loop da peça 2 para os K posts daquele workflow.

### Tipagem

`Cliente` (`apps/crm/src/store/clients.ts:4`) não declara `auto_publish_on_approval`, apesar
de `CLIENTES_SAFE_COLUMNS` (`:77`) já selecioná-lo — o campo existe em runtime, só falta no
tipo. Adicionar `auto_publish_on_approval: boolean` à interface.

## Testes

- Unit: `isEligibleToScheduleNow` (limite de 10 minutos, `null`).
- Unit: novo helper mirror de `isFinalApprovalCycle` (0, 1, 2+ etapas `aprovacao_cliente`
  abertas) — idealmente com os mesmos fixtures/casos de
  `supabase/functions/__tests__/hub-approve_test.ts` para a versão do servidor, para que uma
  mudança na regra do servidor tenha um teste espelho falhando aqui também.
- `scheduleApprovedPost`: platform instagram/tiktok/both chamando o serviço certo (decisão 6).
- Diálogo individual: aparece só com os três gates verdadeiros; ausente com qualquer um
  falso; branch "tem data futura" vs. "abre DateTimePicker"; **branch "definir e agendar"
  chama `scheduleApprovedPost` com a linha retornada por `updateWorkflowPost`, não com o
  `post` original** (regressão específica apontada pelo Codex); erro do endpoint fecha o
  diálogo e dispara `toast.error`, post permanece em `aprovado_cliente`.
- Diálogo de lote: `willRearm = true` nunca mostra diálogo (inclusive quando
  `completeEtapaForAdvance` falha — o diálogo já abriu antes, a partir só de
  `approvePostsInternally`); contagem N/M correta a partir do snapshot local; posts sem data
  elegível listados à parte.
- Indicador persistente: aparece/some conforme os gates e `isEligibleToScheduleNow`;
  **especificamente ausente quando o gate de ciclo final é falso** (post no primeiro ciclo de
  uma dupla aprovação, com uma segunda etapa `aprovacao_cliente` pendente) — regressão do
  PR #400 que a revisão do Codex pegou faltando nesta seção; ação dispara o mesmo helper.
- Elegibilidade: caso de fronteira exatamente em `now + 10min` é tratado como NÃO elegível
  (a margem de segurança da decisão 1), não só `< now + 10min`.

## Fora de escopo

- Posts avulsos (`workflow_id == null` / `StandalonePostDrawer`) — mecanismo de ciclo de
  aprovação diferente (`post_processes`), fica para uma spec própria se decidirem cobrir.
- Qualquer enforcement automático (fazer a aprovação manual agendar sozinha, sem diálogo) —
  decisão explícita de produto por avisar/oferecer atalho, não substituir `hub-approve`.
- Endpoint de agendamento em lote no backend — o loop sequencial no cliente é suficiente no
  volume observado.
- Reincidência do aviso (lembrar de novo se a pessoa ignorar o diálogo/indicador uma vez) —
  o indicador persistente da peça 3 já cobre isso de forma contínua, sem necessidade de
  lembrete adicional.
- Limpeza/backfill dos 22 posts hoje parados em outros clientes — esta spec entrega a
  ferramenta (indicador persistente); resolver o backlog existente é ação manual da agência
  depois do deploy, não um script de dado como no caso do
  `client-event-email-stale-approval` (aqui não há dado incorreto para corrigir, só posts
  aguardando uma ação que agora fica visível).
