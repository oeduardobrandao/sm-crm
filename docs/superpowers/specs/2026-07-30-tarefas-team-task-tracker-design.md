# Tarefas: rastreador de tarefas da equipe + dashboard do agent

Data: 2026-07-30
Status: aprovado

## Problema

O CRM nao tem um conceito de to-do de equipe: o acompanhamento de trabalho existe apenas dentro de Entregas (workflows de cliente). Gestores precisam de um lugar unico para criar tarefas, atribuir a membros, quebrar em subtarefas, definir prazos e tags, e ver por dia quem esta fazendo o que e o que foi concluido. Agents devem, alem disso, abrir o dashboard vendo primeiro "o que esta pendente para mim" (tarefas + trabalho de Entregas atribuido a eles) no lugar do monitor de saude de clientes.

## Decisoes confirmadas com o usuario

- Campos da tarefa: titulo, descricao, status (pendente / em_andamento / concluida), responsavel (membro), vinculo opcional com cliente, prazo (data), tags coloridas do workspace, checklist de subtarefas.
- Quatro visualizacoes: Lista agrupada por prazo (Atrasadas / Hoje / Esta semana / Depois / Sem data), Quadro por membro (arrastar para reatribuir), Kanban por status, Calendario mensal. Cards de estatisticas para gestores (abertas, vencem hoje, atrasadas, concluidas hoje) acima de todas as views.
- Todos os papeis veem todas as tarefas. Sem gating por plano.
- Dashboard do agent: secao "Minhas pendencias" PRIMEIRO, substituindo o ClientHealthMonitor (owners/admins inalterados). Inclui tarefas atribuidas + etapas ativas + posts pendentes atribuidos.
- Fora de escopo (YAGNI deliberado): campo de prioridade (tags cobrem categorizacao), tarefas recorrentes, ordenacao manual no kanban (ordena por prazo), responsavel/prazo em subtarefa.

## Modelo de dados

Quatro tabelas, todas com `conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`, RLS `<t>_tenant_all` (`conta_id IN (SELECT public.get_my_conta_id())`) + `<t>_service_role_bypass`, espelhando `20260626000001_ideia_files.sql`:

- **tarefas**: id bigserial PK, conta_id, user_id (criador), titulo, descricao, status CHECK (pendente|em_andamento|concluida) DEFAULT pendente, responsavel_id -> membros ON DELETE SET NULL, cliente_id -> clientes ON DELETE SET NULL, data_limite date, concluida_em timestamptz, created_at/updated_at. UNIQUE (id, conta_id) para FKs compostas dos filhos. Trigger BEFORE INSERT/UPDATE `tarefas_sync_concluida_em`: transicao para concluida seta `concluida_em = now()`; qualquer outro status limpa. O banco e dono desse invariante; o cliente nunca escreve concluida_em.
- **subtarefas**: checklist simples (titulo, concluida bool, ordem). FK composta (tarefa_id, conta_id) -> tarefas.
- **tarefa_tags**: tags do workspace (nome, cor). UNIQUE (conta_id, nome).
- **tarefa_tag_links**: join N:N com FKs compostas para tarefas e tarefa_tags.

responsavel_id/cliente_id ficam como FK simples (composta + SET NULL anularia conta_id; segue precedente de workflow_etapas.responsavel_id).

## Arquitetura frontend

- `apps/crm/src/store/tarefas.ts`: funcoes async simples no estilo da casa. `getTarefas()` faz uma unica query com embeds (`clientes(nome)`, `tarefa_tag_links(tarefa_tags(...))`, `subtarefas(id, concluida)`) e achata para `TarefaWithRelations`. Query keys: `['tarefas']`, `['tarefa-tags']`, `['subtarefas', tarefaId]`.
- `apps/crm/src/hooks/useCurrentMembro.ts`: resolve o membro do usuario logado via `membros.crm_user_id`.
- `apps/crm/src/pages/tarefas/`: espelha a estrutura de `entregas/` (shell + hooks/useTarefasData + views/ + components/ + logica pura em tarefasLogic.ts com testes).
- Views reutilizam o CSS global do board (`.board-column`, `.board-card`, `.deadline-*`), dnd-kit sem SortableContext (ordenacao por prazo, sem ordem manual), updates otimistas com rollback.
- Contrato de rota (4 pontos, CI): App.tsx, APP_ROUTE_PREFIXES, as duas alternations do vercel.json, nav-data.ts.
- Dashboard: `AgentPendingSection` com queries locais ao componente (nunca no batch useQueries do DashboardPage, cujo teste mocka por indice). `{isAgent ? <AgentPendingSection /> : <ClientHealthMonitor />}`.
- Notificacao `task_assigned`: migration separada estendendo `notifications_type_check` (a partir da lista MAIS RECENTE em 20260521000001) + triggers espelhando `20260504000001_post_assigned_only_target_user.sql`; deep link `/tarefas?tarefa=<id>`.

## Plano de implementacao

Ver `/Users/eduardosouza/.claude/plans/there-is-one-thing-luminous-blossom.md` (fases 1 a 8 + verificacao). Riscos mapeados: mock por indice do DashboardPage.test.tsx, alternations byte-identicas no vercel.json, lista mais recente do notifications_type_check, colisao de prefixo de migration, useDroppable em colunas vazias, bordas de timezone nos buckets.
