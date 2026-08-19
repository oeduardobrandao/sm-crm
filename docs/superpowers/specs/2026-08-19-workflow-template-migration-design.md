# Migração de template de fluxo (workflow)

**Data:** 2026-08-19
**Status:** aprovado em brainstorming, aguardando plano de implementação

## Problema

`workflows.template_id` é definido só na criação do fluxo e nunca mais muda. As
etapas do template são copiadas para `workflow_etapas` nesse momento e vivem
independentes; `propagateTemplateToWorkflows()` só repassa edições de um template
para fluxos que continuam no MESMO template. Não existe caminho para trocar o
template de um fluxo já criado: agências que mudam de metodologia de produção
precisam recriar o fluxo do zero, perdendo o histórico de aprovação, comentários
e mídia dos posts existentes (caso real de suporte).

## Decisões de produto

| Questão | Decisão |
|---|---|
| Escada de etapas | Substituir por completo pela escada do template destino; usuário escolhe em qual etapa o fluxo está agora |
| Posts | Intocados: status, custom status, comentários, aprovação, mídia, agendamento |
| Propriedades personalizadas | Remap automático por nome+tipo; o resto é descartado com aviso e confirmação explícita |
| Reversibilidade | Sem undo; audit_log com snapshot no metadata; confirmação forte no diálogo |
| Superfície | Só UI do CRM (sem MCP tool nesta fase) |
| Entitlement | Liberado para todos os planos (manutenção de dados, não cria recurso) |
| Fluxos sem template | Entram no escopo: a mesma tela serve para "adotar" um template |

## Semântica da migração

- `workflows.template_id` passa a ser mutável **apenas** por uma operação
  dedicada. O campo continua fora do `updateWorkflow` genérico e do modal de
  edição comum.
- **Escada:** as `workflow_etapas` atuais são apagadas e as do template destino
  instanciadas. O usuário escolhe a etapa atual do fluxo na escada nova:
  - anteriores nascem `concluido` com `iniciado_em`/`concluido_em` **nulos**
    (datas desconhecidas são nulas, não inventadas);
  - a escolhida nasce `ativo` com `iniciado_em = now()`;
  - seguintes nascem `pendente`.
  - `workflows.etapa_atual` = índice escolhido.
- **modo_prazo:** o fluxo adota o `modo_prazo` do template destino. O
  `data_limite` das etapas novas é calculado **no cliente** com o código já
  existente. Para `data_entrega`, a data-âncora é **explicitamente**
  `getNextDeliveryDate(cliente.dia_entrega)` (o próximo mês disponível, mesma
  regra do wizard sem mês escolhido); não há seletor de mês na v1, e as datas
  calculadas aparecem na prévia do diálogo antes de confirmar. `data_fixa`
  nasce sem datas para preenchimento manual; `padrao` não usa datas. O cliente
  monta o array completo de etapas novas e envia ao backend; não se
  reimplementa cálculo de dias úteis em SQL.
- **Posts:** nenhuma escrita em `workflow_posts`. O registry de custom status é
  por workspace, não por template, então nada quebra. O feedback de aprovação do
  cliente vive em `post_approvals` (escopo por post) e não é tocado. A tabela
  legada `portal_approvals` (escopo por etapa, sem writer no código atual,
  cascade em `workflow_etapas`) pode ter linhas históricas em fluxos antigos:
  antes do delete da escada, essas linhas são arquivadas no metadata do
  audit_log (a cascata as apagaria em silêncio).
- **Propriedades personalizadas:** valores em `post_property_values` cujas
  definições no template origem tenham no destino uma definição com **mesmo nome
  (case-insensitive, com trim) e mesmo tipo** são movidos para a definição do
  destino. **Exceção: os tipos `select`, `multiselect` e `status` nunca casam**:
  seus valores guardam ids de opção (`config.options[].id`) gerados por template,
  então um valor remapeado apontaria para uma opção inexistente no destino.
  Esses valores entram na lista de perdidos (reconciliação por label fica como
  evolução futura). Os demais valores sem par são apagados (listados no diálogo
  antes, com confirmação). `workflow_select_options` pertencem sempre a
  definições dos tipos de opção, que nunca casam: são todas apagadas junto.
- **Adoção:** fluxo com `template_id null` usa a mesma operação; não há
  propriedades de origem, logo nada a remapear.
- **Efeito desejado:** após migrar, `propagateTemplateToWorkflows` do template
  destino passa a alcançar este fluxo.

## Backend: RPC atômica

Migration nova (`202608XX000001_workflow_template_migration.sql`, prefixo único
verificado contra o tail de `origin/main` na hora do PR) criando:

```sql
migrate_workflow_template(
  p_workflow_id          bigint,
  p_template_id          bigint,   -- template destino
  p_new_etapas           jsonb,    -- escada completa montada no cliente
  p_active_ordem         integer,  -- índice da etapa ativa na escada nova
  p_modo_prazo           text,
  p_expected_template_id bigint    -- guarda otimista: template_id que o cliente viu (null p/ adoção)
) returns void
```

- `SECURITY DEFINER` com `search_path` fixado; `REVOKE ALL FROM public, anon`;
  `GRANT EXECUTE TO authenticated, service_role`.
- **Validações (dentro da transação):**
  - workflow existe e `conta_id = get_my_conta_id()`;
  - guarda de concorrência: `template_id` atual do fluxo deve ser
    `IS NOT DISTINCT FROM p_expected_template_id`, senão `workflow_changed`
    (duas migrações em sequência não se sobrescrevem em silêncio);
  - template destino existe na mesma conta;
  - workflow com `status = 'ativo'` (não se migra concluído/arquivado);
  - `p_new_etapas` não-vazio; `p_active_ordem` dentro do range;
  - shape de cada etapa: `nome` não-vazio, `prazo_dias` inteiro >= 0,
    `tipo_prazo IN ('uteis','corridos')`, `tipo IN ('padrao','aprovacao_cliente')`,
    `responsavel_id` nulo ou membro da conta. `status`, `iniciado_em` e
    `concluido_em` NÃO vêm no payload: são derivados server-side de
    `p_active_ordem`;
  - `p_modo_prazo IN ('padrao','data_fixa','data_entrega')`.
- **Passos (uma transação, ordem):**
  1. remap de `post_property_values`: para cada definição do template origem com
     par no destino (nome+tipo, excluindo `select`/`multiselect`/`status`),
     `INSERT ... SELECT DISTINCT ON (post_id, def_destino) ... ON CONFLICT
     (post_id, property_definition_id) DO NOTHING` limitado aos posts deste
     workflow, com desempate determinístico por menor `display_order` e depois
     menor `id` da definição de ORIGEM. Isso resolve os dois conflitos
     possíveis: valor pré-existente no destino vence, e duas definições de
     origem casando com a mesma de destino não estouram o UNIQUE (um simples
     UPDATE colidiria consigo mesmo);
  2. snapshot dos valores que serão perdidos (órfãos + perdedores de conflito):
     `(post_id, nome da definição, value)`, para o metadata do audit_log;
  3. delete de TODOS os `post_property_values` restantes sob definições do
     template origem, limitado aos posts do workflow;
  4. delete das `workflow_select_options` deste workflow penduradas em
     definições do template origem (todas: pertencem a tipos de opção, que
     nunca casam);
  5. snapshot das linhas legadas de `portal_approvals` penduradas nas etapas
     atuais (tabela sem writer no código atual; a cascata do delete as
     apagaria), para o metadata;
  6. delete da escada + insert das etapas novas, com a etapa ativa inserida
     como `pendente` e ativada por UPDATE em seguida (`status = 'ativo'`,
     `iniciado_em = now()`), para o trigger `notify_step_activated`
     (AFTER UPDATE) disparar como em todo outro caminho de ativação;
  7. update do workflow: `template_id`, `etapa_atual`, `modo_prazo`;
  8. insert em `audit_log`: `action = 'workflow.template_migrated'`,
     `resource_type = 'workflow'`, `resource_id = p_workflow_id`, `metadata` com
     template origem/destino, snapshot da escada antiga, valores de propriedade
     descartados (post a post), nomes das propriedades descartadas e o snapshot
     de `portal_approvals` legadas. O `SECURITY DEFINER` cobre o insert (RLS de
     `audit_log` é service_role-only).
- Qualquer falha = rollback total.
- Duas definições homônimas do mesmo tipo no destino: casa com a de menor
  `display_order`, depois menor `id` (determinístico).

## Frontend

- `apps/crm/src/store/workflows.ts`:
  - `migrateWorkflowTemplate(...)` chamando `supabase.rpc('migrate_workflow_template', ...)`;
  - helper puro `matchPropertyDefinitions(defsOrigem, defsDestino)` (nome+tipo,
    menor `display_order` e depois menor `id` em empate; `select`/`multiselect`/
    `status` nunca casam) usado pela prévia do diálogo — espelha a regra do SQL;
  - helper puro que monta `p_new_etapas` a partir do template destino +
    `p_active_ordem` + `modo_prazo` (statuses, `iniciado_em`, `data_limite`).
- UI: botão "Migrar template…" no `EditWorkflowModal` abre
  `MigrateTemplateDialog` (arquivo novo em `pages/entregas/components/`), uma
  tela com 3 blocos:
  1. select do template destino (exclui o template atual do fluxo);
  2. select "em qual etapa este fluxo está agora" (etapas do destino);
  3. prévia: escada antes/depois, propriedades que migram e as que serão
     perdidas (com contagem de posts afetados), aviso de irreversibilidade.
  - Confirmação final via `AlertDialog`.
- Sem gate de plano; disponível aos papéis que já editam fluxos.
- Copy em pt-BR, sem em-dash (regra da casa).

## Erros e casos-limite

- Falha da RPC: rollback total; toast com a mensagem da RPC (validações em
  pt-BR; erro inesperado vira mensagem genérica).
- Template destino apagado entre abrir o diálogo e confirmar: RPC falha com
  "template não encontrado".
- `modo_prazo = data_entrega` sem `dia_entrega` no cliente: etapas nascem sem
  `data_limite` (mesmo comportamento do wizard).
- Fluxo recorrente: `duplicateWorkflow` já copia `template_id` do fluxo, então a
  próxima recorrência nasce no template novo automaticamente.
- Concorrência: a guarda `p_expected_template_id` falha com `workflow_changed`
  se outra pessoa migrou o fluxo entre abrir o diálogo e confirmar; o frontend
  pede para recarregar.
- Notificação: a etapa ativa nova dispara `notify_step_activated` normalmente
  (ativação via UPDATE dentro da RPC), como em `completeEtapa`/`revertEtapa`.
- Auditoria vs. undo: o metadata guarda os valores descartados post a post e as
  `portal_approvals` legadas, então o suporte consegue dizer O QUE se perdeu e
  qual era o conteúdo; continua sem botão de undo (decisão explícita), a
  restauração seria manual a partir do audit_log.

## Testes

- **psql** (`supabase/tests/`, roda no job `entitlement-tests`):
  posse entre contas, rollback em validação falha, remap nome+tipo, exclusão de
  select/multiselect/status do remap, descarte de órfãos,
  `workflow_select_options`, conflito UNIQUE (pré-existente no destino e duas
  origens para o mesmo destino), guarda `workflow_changed`, arquivamento de
  `portal_approvals` legadas, notificação da etapa ativada, gravação do
  audit_log com valores descartados.
- **Vitest:** `matchPropertyDefinitions`, montagem da escada nova por
  `modo_prazo`, `MigrateTemplateDialog` (prévia de perdas, confirmação,
  chamada da RPC).
- Verificação manual no browser (`npm run dev:staging`) antes do PR.

## Fora de escopo (nesta fase)

- MCP tool `migrate_workflow_template`.
- Undo/restauração de snapshot.
- Mover posts entre fluxos (`updateWorkflowPost` continua bloqueando `workflow_id`).
- Gate por plano.
