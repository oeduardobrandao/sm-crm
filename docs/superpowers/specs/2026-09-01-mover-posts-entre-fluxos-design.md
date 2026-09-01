# Mover posts para outro fluxo (novo ou existente do mesmo modelo)

Data: 2026-09-01 · Status: aprovado (plan mode, com review do usuário)

## Problema

Desmembrar hoje só produz posts avulsos. O usuário quer avançar de etapa com um
subconjunto de posts já aprovados, mantendo-os dentro de um fluxo. Posts não têm
etapa própria (a etapa é do fluxo), então o caminho é mover posts para outro
fluxo:

- **Novo fluxo**: clone das etapas da origem, começando na etapa escolhida no
  diálogo. Etapas anteriores nascem concluídas — preserva a semântica de
  auto-publish do Hub (`isFinalApprovalCycle` lê status das etapas).
- **Fluxo existente**: mover direto (sem passar por avulso) para um fluxo ativo
  do mesmo cliente e MESMO modelo (template) da origem. Cenário motivador: 3
  posts aprovados vão para um fluxo novo; depois mais 2 aprovam e entram nesse
  mesmo fluxo em vez de criar um terceiro.

Decisões de produto: etapa inicial escolhida no diálogo (default = etapa atual
da origem); ação na UI ao lado de "Desmembrar do fluxo" (barra de seleção +
kebab do post no WorkflowDrawer); alvo existente restrito a fluxos do mesmo
modelo; sem mover para fluxo de modelo diferente (o caminho avulso → vincular
continua cobrindo esse caso).

## Backend

Uma migration, `move_posts_to_new_flow` + `move_posts_to_existing_flow`
(SECURITY DEFINER, mesma família de estilo/erros/advisory locks de
`detach_posts_from_flow`/`attach_posts_to_flow`, 20260830000004), mais helpers
privados `move_posts_core` e `remap_moved_posts_select_options`.

Pontos estruturais:

- Locks: `':post_move'` → (new-flow) `':max_active_workflows_per_client'` →
  `':max_posts_per_workflow'` → linhas de workflows → linhas de posts. A ordem
  max_active ANTES de max_posts espelha a transação natural workflow→post dos
  triggers `enforce_plan_count_limit` (evita AB/BA).
- GUC transacional `app.allow_post_move='on'` antes do UPDATE (guard
  `post_move_requires_rpc`).
- Clone de etapas com matriz explícita: `< start` concluída
  (`iniciado_em`/`concluido_em` = coalesce(original, now())); `= start` ativa
  (`iniciado_em = now()`, `concluido_em = NULL`); `> start` pendente (ambos
  NULL). `data_limite` copiado como está.
- Novo fluxo: herda `cliente_id`/`template_id`/`modo_prazo`; `recorrente =
  false`; `created_via = 'human'`; `etapa_atual = p_start_ordem`.
- `workflow_select_options.option_id` é UNIQUE global: cópia impossível; o
  helper faz find-or-create por `(property_definition_id, label)` no destino e
  REMAPEIA os valores dos posts movidos (`select` e `status` = option_id
  escalar; `multiselect` = array jsonb). Origem intacta. O helper impõe
  isolamento de tenant explicitamente (`wso.conta_id`, join com
  `template_property_definitions` da mesma conta e template) porque as FKs da
  tabela são globais e a RLS valida só `conta_id`.
- Limite `max_posts_per_workflow` checado manualmente (trigger é INSERT-only);
  `max_active_workflows_per_client` sai do próprio trigger no INSERT.
- `p_archive_empty_flow`: arquiva a origem só se ela ficou vazia pelo lote.

## Frontend

- `MovePostsToFluxoDialog.tsx`: destino em duas seções de radio (novo fluxo com
  nome + etapa inicial; fluxo existente com lista filtrada por
  `filterMoveTargets` — ativo, mesmo cliente, mesmo template, exclui a origem).
  Checkbox "arquivar origem" quando a seleção é total.
- Store: `movePostsToNewFlow`/`movePostsToExistingFlow` com
  `callRpcWithDeadlockRetry`.
- WorkflowDrawer: botão na barra de seleção + item no kebab; ao mover, abre o
  drawer do fluxo destino via deep link pendente do EntregasPage (segura o alvo
  até o card existir após o refetch).
- Erros: `getMoveErrorToast` — entitlements primeiro
  (`mapEntitlementError`/`entitlementMessage`), depois identificadores da RPC.

## Fora de escopo

- Mover para fluxo de modelo diferente.
- Escolher etapa ao mover para fluxo existente (o fluxo está onde está).
- Eventos de workflow além do `criado` automático.

Plano de implementação: sessão de 2026-09-01 (plan file aprovado); testes em
`supabase/tests/entitlements/72_move_posts_between_flows.sql`, Vitest de store,
helpers do dialog e wiring do drawer/página.
