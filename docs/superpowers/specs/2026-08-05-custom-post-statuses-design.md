# Status personalizados de posts + automações por status

Data: 2026-08-05 · Status: aprovado (design + mockups validados com o usuário)

## Problema

Os 9 status de post (`rascunho` … `falha_publicacao`) são um `text` + CHECK em
`workflow_posts`, com as strings espalhadas por ~20 arquivos, e controlam
visibilidade no Hub, crons de publicação, RPCs de aprovação e contagens.
Agências querem etapas de produção mais finas ("Em design", "Aguardando mídia")
e ações disparadas quando um post entra em um status, sem quebrar nada disso.

## Decisões

1. **Modelo em camadas "se comporta como"** (padrão Jira/Linear). A coluna
   canônica `status` permanece intocada e continua dirigindo todo o
   comportamento. Cada status personalizado mapeia (`behaves_as`) para um dos 6
   status canônicos não controlados pela máquina: `rascunho`,
   `revisao_interna`, `aprovado_interno`, `enviado_cliente`,
   `aprovado_cliente`, `correcao_cliente`. Os status de máquina (`agendado`,
   `postado`, `falha_publicacao`) não têm stand-ins.
2. Definições são **por workspace** (`conta_id`), gerenciadas por owner/admin
   numa nova aba de Configurações.
3. **O Hub do cliente sempre mostra o label canônico** — nomes personalizados
   são vocabulário interno; zero mudanças no Hub.
4. **Automações v1**: quando um post ENTRA em um status (canônico OU
   personalizado) → `notify` (notificação in-app para membro escolhido /
   responsável do post / owners+admins) ou `assign_responsavel` (define o
   responsável). Disparam para status canônicos e personalizados.
5. Gate de plano: **reutiliza `feature_custom_properties`** (sem coluna nova de
   plano; se um dia for vendido separado, uma migration adiciona
   `feature_custom_statuses` defaultando do valor atual e troca o argumento do
   trigger de gate).

## Arquitetura

### Dados

- `post_status_definitions` (uuid pk, `conta_id`, `nome` 1-40, `cor`,
  `behaves_as` CHECK nos 6 valores, `ordem`, `arquivado`, timestamps). Índice
  único parcial `(conta_id, lower(nome)) WHERE NOT arquivado`.
- `workflow_posts.custom_status_id uuid` FK `ON DELETE SET NULL`.
- `post_status_automations` (`trigger_status` XOR `trigger_custom_status_id`,
  `action_type` in `('notify','assign_responsavel')`, `config jsonb`, `ativo`).
- `post_status_events` ganha `from/to_custom_status_id` + snapshot
  `from/to_custom_nome` (o nome sobrevive à exclusão da definição).

### Invariante e reconciliação (trigger BEFORE `z1`)

`custom_status_id` setado ⇒ `status` = `behaves_as` da definição. Um único
trigger `BEFORE INSERT OR UPDATE OF status, custom_status_id` garante isso em
TODOS os caminhos de escrita (o CRM escreve via PostgREST direto; server-side
via RPCs `record_post_status_change`/`record_client_approval` — todos passam
pelo trigger):

- custom setado/alterado → força `status := behaves_as`;
- `status` movido para outro valor (cron de publicação, aprovação do cliente,
  re-arm, envio em lote) → limpa `custom_status_id`;
- definição arquivada/inexistente/de outro tenant → limpa `custom_status_id`.

`claim_posts_for_publishing` e `hub_reorder_post_schedules` só tocam
`publish_processing_at`/`scheduled_at`, então a lista `OF` evita disparo.

### Automações (trigger BEFORE `z2`, roda após `z1` por ordem alfabética)

- UPDATE-only (INSERTs de import/Post Express não geram spam); guarda
  `pg_trigger_depth()`.
- Fase 1 `assign_responsavel`: muta `NEW.responsavel_id` — sem UPDATE extra,
  sem recursão; o trigger existente `notify_post_assigned` (sem lista `OF`)
  dispara a notificação de atribuição de graça.
- Fase 2 `notify`: best-effort (EXCEPTION → WARNING); alvos via
  `resolve_notification_targets` / `membros.crm_user_id`; insere com
  `insert_notification_batch` usando o novo tipo `post_status_automation`.
- Loops estruturalmente impossíveis: nenhuma ação escreve `status`.

### Frontend (apps/crm)

- Registry puro `statusRegistry.ts` + hook `useStatusRegistry`:
  `StatusKey = canônico | 'custom:<uuid>'`; opções canônicas (de
  `postLabels.ts`, intocado) com personalizados inseridos logo após o status
  âncora, ordenados por `ordem`. Consumidores degradam para canônico enquanto
  carrega.
- Kanban de posts: colunas do registry; header com bolinha da cor.
- Drawer: select agrupado por status canônico; guarda de confirmação de posts
  aprovados passa a olhar o canônico efetivo.
- Chips: canônico usa classes CSS existentes; personalizado usa o padrão de cor
  inline de `PropertyValue.tsx` (`cor+'22'` fundo, `cor` texto, `cor+'55'`
  borda).
- Filtros + URL `pstatus`: aceita canônicos e `custom:<uuid>`; filtrar pelo
  canônico inclui posts em personalizados que se comportam como ele.
- Timeline/histórico: label = `to_custom_nome ?? label canônico`; tom pelo
  canônico. Mapas de label duplicados em `postTimeline.ts` e
  `HistoryDrawer.tsx` consolidados em `postLabels.ts`.
- Nova aba Configurações → "Status de posts" (STAFF): gerenciador de
  definições + editor de automações, com upsell quando o plano não inclui.

### Fora de escopo v1 (anotado como futuro)

- MCP (`EDITABLE_STATUSES` etc.) segue canônico-only.
- Automação "ao criar post" (INSERT) — opt-in futuro.
- Batching de notificações em updates em lote (transition tables).
- Restaurar o status personalizado ao cancelar um agendamento.

## Casos de borda resolvidos

| Caso | Comportamento |
|---|---|
| Arquivar/excluir definição com posts nela | Store limpa ponteiros (arquivar); FK SET NULL (excluir); automações da definição caem em cascata; histórico mantém o nome |
| Agendar post em status personalizado | Personalizado é limpo ao virar `agendado`; não restaurado no cancelamento (documentado na UI) |
| Re-arm (aprovado→rascunho) | Personalizado limpo pelo z1; regras de `rascunho` disparam (aceito) |
| Envio em lote ao cliente | Disparo por linha; N notificações aceitas na v1 |

## Fatiamento

PR1 banco+store (zero mudança de comportamento) → PR2 registry+superfícies →
PR3 aba de configurações → PR4 automações. Testes: vitest (registry, store,
viewQuery) + suítes psql em `supabase/tests/entitlements/` (60-62).
