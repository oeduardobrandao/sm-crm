# Solicitacoes no Hub + conversao em tarefa + tools MCP de tarefas

Data: 2026-07-30
Status: aprovado (revisao externa Codex incorporada, ver secao de decisoes da revisao)

## Problema

O Hub so tem "ideias": o cliente envia sugestoes de conteudo e a agencia responde. Na pratica os clientes tambem usam esse canal para pedir coisas acionaveis (trocar uma arte, ajustar a bio, subir um story). Hoje esses pedidos se perdem no meio do brainstorm e nao viram trabalho rastreavel. Alem disso, agentes de IA conectados via MCP nao conseguem ler nem criar tarefas do rastreador novo (spec 2026-07-30-tarefas-team-task-tracker).

## Decisoes confirmadas com o usuario

- O cliente escolhe o tipo ao criar no Hub: **ideia** (material de brainstorm) ou **solicitacao** (pedido acionavel). Toggle segmentado no modal existente, default ideia. Termo pt-BR: "Solicitacao".
- No CRM, a tabela de Ideias continua unica: ganha coluna com badge de Tipo + chip de filtro por tipo ao lado do filtro de status (sem tabs).
- Converter em tarefa: **apenas solicitacoes**. Ideias continuam sem acao de conversao.
- Conversao: a solicitacao ganha status novo `convertida` + link para a tarefa criada. CRM mostra "Virou tarefa" com link para `/tarefas?tarefa=<id>`; o cliente ve "Em andamento" no Hub.
- Loop de retorno: quando a tarefa vinculada e marcada `concluida`, um trigger marca a solicitacao como `concluida` e o cliente ve "Concluida" no Hub. Arrastar a tarefa de volta (sair de concluida) reverte a solicitacao para `convertida`.
- MCP: tools `list_tasks`, `create_task`, `update_task` com scopes novos `tarefas:read` / `tarefas:write`.
- Branch: **apos o merge do PR #270** (tarefas), branch novo a partir de main atualizado. Esta feature depende das tabelas de tarefas.

## Modelo de dados (1 migration)

Versao: proxima livre apos `20260730000006` (re-checar `ls supabase/migrations | tail` na implementacao; colisao de prefixo e silenciosa no remoto).

Alteracoes em `ideias`:

- `tipo text NOT NULL DEFAULT 'ideia' CHECK (tipo IN ('ideia','solicitacao'))`. Backfill implicito: tudo que existe vira ideia.
- `tarefa_id bigint` + FK **composta** `FOREIGN KEY (tarefa_id, workspace_id) REFERENCES tarefas(id, conta_id) ON DELETE SET NULL (tarefa_id)` + indice em tarefa_id. O column-list no SET NULL (PG 15+; prod verificado em PG 17.6, staging conferir na implementacao) anula so o ponteiro e preserva workspace_id. A FK composta torna ponteiro cross-tenant impossivel no nivel do banco, para TODOS os escritores (RLS, service role, RPCs futuras); por isso NAO ha mudanca de policy RLS. MATCH SIMPLE ignora a constraint quando tarefa_id e NULL.
- `ideias_status_check` recriado: `('nova','em_analise','aprovada','descartada','convertida','concluida')`. NAO adicionar CHECK amarrando status a tarefa_id: quebraria o ON DELETE SET NULL.
- As policies RLS atuais sao as granulares de `20260417000006` (`ideias_select/insert/update/delete` com get_my_conta_id()); ficam como estao.

### Estados derivados (matriz de transicao)

`convertida` e `concluida` sao estados **exclusivamente derivados**: nunca aparecem no seletor manual de status. Escritores unicos: a RPC de conversao (seta `convertida`) e o trigger de sync (alterna `convertida` <-> `concluida`). Os quatro status originais continuam manuais.

- IdeiaDrawer com status em `('nova','em_analise','aprovada','descartada')`: Select com apenas esses quatro valores (como hoje).
- IdeiaDrawer com status `convertida`/`concluida` E `tarefa_id` presente: Select substituido por exibicao read-only (badge + link "Ver tarefa").
- Orfa (tarefa deletada: `tarefa_id` NULL com status `convertida`/`concluida`): o Select reaparece oferecendo os quatro status manuais, para a agencia rearquivar ou reabrir (e entao reconverter, se quiser).

Enforcement no banco alem da RPC/trigger: nenhum (aceito). O seletor da UI e o unico caminho de escrita manual de status no CRM; service role e RPC sao escritores controlados.

### RPC de conversao

`convert_solicitacao_em_tarefa(p_ideia_id uuid, p_titulo text, p_descricao text, p_responsavel_id bigint, p_data_limite date) RETURNS bigint` (id da tarefa). SECURITY INVOKER (RLS do membro cobre as duas tabelas), transacional:

1. `SELECT ... FROM ideias WHERE id = p_ideia_id FOR UPDATE`; valida `tipo = 'solicitacao'`, `status IN ('nova','em_analise','aprovada')`, `tarefa_id IS NULL`. Falha -> RAISE EXCEPTION com mensagem clara ("ja convertida" / "nao e solicitacao" / "status nao elegivel").
2. INSERT em tarefas (`user_id = auth.uid()`, conta_id = workspace_id da ideia, **cliente_id = cliente_id da ideia**, nunca parametro: a solicitacao veio do portal daquele cliente e a tarefa fica amarrada a ele). O trigger task_assigned dispara normalmente (ator = auth.uid(), excluido do batch).
3. UPDATE ideias SET status='convertida', tarefa_id=<novo id>.

Atomico e idempotente-guardado: dois gestores convertendo em paralelo, o segundo falha no claim (sem tarefa duplicada). Grants: `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated, service_role;` (padrao do repo; o default do PG e EXECUTE para PUBLIC, e REVOKE FROM PUBLIC sem re-grant tambem derrubaria service_role).

Tags NAO entram na RPC; semantica de sucesso parcial definida na secao do IdeiaDrawer.

### Trigger de sync tarefa -> solicitacao

`trg_sync_ideia_from_tarefa` (AFTER UPDATE OF status ON tarefas, SECURITY DEFINER, search_path=public). **Atomico, SEM bloco EXCEPTION->WARNING**: este trigger mantem um invariante de dados, nao uma notificacao best-effort. Uma falha no UPDATE de ideias propaga e desfaz a mudanca de status da tarefa (divergencia silenciosa tarefa-concluida / solicitacao-convertida seria irreparavel sem re-transicao manual). O UPDATE e simples e escopado; falha real e rara e prefere-se o erro visivel.

- status virou `concluida`: `UPDATE ideias SET status='concluida' WHERE tarefa_id = NEW.id AND workspace_id = NEW.conta_id AND status = 'convertida'`.
- status saiu de `concluida`: reverte com o mesmo escopo e `AND status = 'concluida'`.

Como `convertida`/`concluida` sao derivados (sem escrita manual), os predicados nunca colidem com edicao humana; o escopo por `workspace_id = NEW.conta_id` e cinto extra alem da FK composta.

## Edge function hub-ideias

- POST (create): aceita `tipo`, valida contra `('ideia','solicitacao')`, default `'ideia'` quando ausente. Valor invalido responde 400.
- PATCH (edit destravado): aceita `tipo` sob o mesmo lock existente (so enquanto status='nova', sem comentario, sem reacao). O lock (`checkLock`: status != 'nova' trava) ja cobre `convertida`/`concluida` sem mudanca.
- GET: inclui `tipo` e `tarefa_id` no select.

## Hub UI (apps/hub)

- `types.ts`: `HubIdeia` ganha `tipo: 'ideia' | 'solicitacao'`; union de status ganha `'convertida' | 'concluida'`.
- `IdeiasPage.tsx`:
  - Modal: toggle segmentado Ideia | Solicitacao acima do titulo (default ideia; em edicao, valor atual). Enviado no create/update.
  - Card: badge de tipo ao lado do badge de status quando tipo = solicitacao ("Solicitacao").
  - `STATUS_LABEL`/`STATUS_COLOR`: `convertida` -> "Em andamento" (tom accent/azul), `concluida` -> "Concluida" (tom verde). Labels sao a visao do cliente, nao os nomes internos.
  - Copy do header: "Envie ideias e solicitacoes e a agencia respondera em breve." Empty state ajustado.
- `api.ts`: payloads de create/update carregam `tipo`.

## CRM (apps/crm)

- `store/ideias.ts`: `Ideia` ganha `tipo` e `tarefa_id`; union de status ganha os dois valores; `getIdeias` seleciona os campos novos. Funcao nova `convertSolicitacaoEmTarefa(...)` chama a RPC e retorna o id da tarefa.
- `IdeiasPage.tsx`: coluna Tipo (badge "Ideia" neutro / "Solicitacao" accent) + chip de filtro por tipo (mesmo padrao dos filtros existentes). `STATUS_LABELS` ganham `convertida` -> "Virou tarefa", `concluida` -> "Concluida".
- Superficies compartilhadas: `IdeiaStatusBadge` (usado na tabela, no drawer e no HubTab de cliente-detalhe) ganha os dois status novos. O filtro de status do HubTab (options hardcoded) ganha os dois valores novos. O HubTab NAO ganha filtro de tipo (lista single-client, curta); o badge de tipo aparece so no drawer nessa superficie.
- `IdeiaDrawer` (compartilhado, entao a conversao funciona no indice global E no HubTab):
  - Solicitacao com status elegivel: botao "Converter em tarefa" abre o `TarefaFormDialog` em modo conversao.
  - Status manual: matriz da secao de estados derivados (Select so com os 4 originais; read-only quando convertida/concluida com link; Select reaberto quando orfa).
  - `tarefa_id` presente: link "Ver tarefa" para `/tarefas?tarefa=<id>`.
- `TarefaFormDialog` ganha props opcionais (retrocompativeis): `initialValues?: { titulo?; descricao?; cliente_id? }` (aplicados no reset do modo create), `lockCliente?: boolean` (campo cliente desabilitado; na conversao o cliente e o da solicitacao e a RPC o fixa de qualquer forma) e `onCreate?: (payload, tagIds) => Promise<void>` que SUBSTITUI o caminho interno `addTarefa` no submit.
- Semantica de sucesso parcial da conversao (a RPC e o commit; tags sao best-effort):
  - RPC falha: erro no dialogo, que permanece aberto; nada foi criado.
  - RPC ok: conversao E sucesso a partir daqui, independente das tags. `setTarefaTags` em try/catch; se falhar, toast de aviso "Tarefa criada, mas as tags nao foram aplicadas. Edite a tarefa para adiciona-las." Em ambos os casos: fechar o dialogo, toast de sucesso, invalidate `['hub-ideias-all']` + `['tarefas']` (+ a query do HubTab quando aberto de la). O caminho de recuperacao e o link "Ver tarefa" (deep link abre o TarefaDetailSheet, onde tags sao editaveis). Nunca re-tentar a RPC apos sucesso: falharia como "ja convertida".

## Notificacao

Sem tipo novo de notificacao. O trigger `trg_notify_idea_submitted` e recriado (a partir da versao MAIS RECENTE em 20260430000003) adicionando `tipo` ao metadata. `notification-config.ts`: quando `metadata.tipo === 'solicitacao'`, titulo "Nova solicitacao do cliente"; caso contrario o texto atual.

## MCP tools (supabase/functions/mcp)

Scopes novos `tarefas:read` e `tarefas:write` em AMBOS os allowlists espelhados: `MCP_ALLOWED_SCOPES` (_shared/mcp-token.ts) e `SCOPE_OPTIONS` (apps/crm/src/lib/mcp-scopes.ts, labels "Tarefas (leitura)" / "Tarefas (escrita)") + testes de espelho (mcp-scopes.test.ts, ConsentPage.test.tsx se fixa a lista). `MCP_AGENT_PRESET`/`AGENT_PRESET` seguem read-only: incluem `tarefas:read`, nao `tarefas:write`.

Tools (padrao `register()` com scope + audit; queries em queries.ts com service-role escopado por `ctx.conta_id`):

- `list_tasks` (`tarefas:read`): filtros opcionais status, responsavel_id, cliente_id, limit. Limit com clamp `min(max(1, limit ?? 50), 200)`, espelhando listPosts. Retorna tarefas com tags (nome/cor), contagens de subtarefas e nome do cliente (mesmo shape achatado do store do CRM), ordenadas por data_limite asc nulls-last.
- `create_task` (`tarefas:write`): titulo obrigatorio; descricao, responsavel_id, cliente_id, data_limite (YYYY-MM-DD) opcionais. Valida explicitamente que responsavel_id/cliente_id pertencem ao workspace ANTES do insert (service role bypassa RLS; a validacao explicita segue o padrao de createWorkflow/updatePost). `user_id` = `ctx.created_by` (uuid do criador da key; nunca `ctx.key_id`, que pode nao ser uuid em sessoes OAuth). Atribuicao dispara o trigger task_assigned existente (auth.uid() NULL sob service role significa sem exclusao de ator: o atribuido e notificado, comportamento desejado).
- `update_task` (`tarefas:write`): task_id + campos mutaveis. `titulo` e `status` opcionais nao-anulaveis; `descricao`, `responsavel_id` e `data_limite` `.nullable().optional()`: **null limpa o campo, omitido preserva** (o patch e construido com `Object.hasOwn`, distinguindo os dois; sem isso o agente nao teria como remover atribuicao, prazo ou descricao). Espelha o contrato de `updatePost`: patch vazio -> McpInputError "Informe ao menos um campo para atualizar."; tarefa inexistente no workspace -> McpInputError "Tarefa nao encontrada neste workspace." (tools de ESCRITA lancam McpInputError; so as de leitura retornam null). Mesma validacao de ownership dos pointers quando nao-null; `concluida_em` continua exclusivo do trigger do banco. Marcar `concluida` via MCP aciona o sync da solicitacao vinculada, se houver.

Contrato de `list_ideas` acompanha o modelo novo: enum de status do filtro ganha `convertida`/`concluida`, filtro opcional `tipo`, e a resposta inclui `tipo` e `tarefa_id`.

Audit: ids e flags apenas (task_id, cliente_id, responsavel_id, status, has_descricao), nunca payloads. Instrucoes do servidor (seed.ts) ganham uma linha sobre gestao de tarefas.

Caveat operacional: keys e grants OAuth existentes nao tem os scopes novos; para usar as tools de tarefas e preciso reemitir a key ou reconsentir o connector.

## Decisoes da revisao externa (Codex, pre-implementacao)

- ACEITO (P0, policies inexistentes): o spec citava a policy catch-all antiga; as reais sao as granulares de 20260417000006. Remedio diferente do sugerido: em vez de editar `ideias_insert`/`ideias_update`, a FK composta (abaixo) fecha o cross-tenant no nivel do banco para todos os escritores, e as policies ficam intactas.
- ACEITO (P1, FK composta): `(tarefa_id, workspace_id) REFERENCES tarefas(id, conta_id) ON DELETE SET NULL (tarefa_id)`. A justificativa original ("SET NULL anularia workspace_id") estava errada: o column-list do PG 15+ resolve. Prod confirmado em PG 17.6.
- ACEITO (P1, contrato do TarefaFormDialog): o dialogo atual cria internamente e nao expoe a tarefa; ganha `initialValues` + `onCreate` opcionais.
- ACEITO (P1, sync vs edicao manual): resolvido tornando `convertida`/`concluida` estados exclusivamente derivados, fora do seletor manual (com a excecao da orfa). Predicados do trigger nunca colidem com edicao humana.
- ACEITO (P1, corrida na conversao em dois writes): conversao vira RPC transacional com claim (`FOR UPDATE` + elegibilidade + `tarefa_id IS NULL`); segundo conversor falha sem tarefa duplicada.
- ACEITO (P2, matriz de transicoes): especificada na secao de estados derivados, incluindo o caso da orfa.
- ACEITO (P2, superficies): IdeiaStatusBadge e o filtro do HubTab atualizados; conversao disponivel onde o IdeiaDrawer renderiza (indice global + HubTab); tipo-filtro so no indice global.
- ACEITO COM AJUSTE (P2, update_task): exigir ao menos um campo mutavel, sim; mas tarefa inexistente lanca McpInputError (padrao das tools de escrita, ver updatePost), nao retorna null (padrao so das de leitura).
- ACEITO (P2, contrato de list_ideas): enum de status estendido + filtro tipo + campos novos na resposta.

Segunda rodada (todos aceitos):

- ACEITO (P1, trigger de sync atomico): EXCEPTION->WARNING removido; o trigger mantem invariante de dados, nao best-effort. Falha propaga e desfaz a transicao da tarefa.
- ACEITO (P1, sucesso parcial na conversao): RPC = commit; tags best-effort com toast de aviso; dialogo sempre fecha e invalida apos RPC ok; recuperacao pelo deep link da tarefa.
- ACEITO (P1, cliente fixo): p_cliente_id removido da RPC; cliente_id vem da propria solicitacao; campo cliente travado no dialogo (`lockCliente`).
- ACEITO (P2, grants): REVOKE ALL FROM PUBLIC + GRANT a authenticated e service_role (default do PG e PUBLIC; padrao do repo em 20260430000001).
- ACEITO (P2, semantica de null no update_task): campos anulaveis com null-limpa / omitido-preserva via Object.hasOwn.
- ACEITO (P2, limit do list_tasks): clamp 1..200 com default 50, espelhando listPosts.

## Fora de escopo (YAGNI deliberado)

- Converter ideias (tipo=ideia) em tarefa.
- Tags e subtarefas via MCP; delete_task via MCP (destruicao fica no CRM).
- Notificacao ao cliente no Hub (o Hub nao tem sistema de notificacao).
- Mostrar a solicitacao de origem dentro da UI da tarefa.
- Enforcement no banco da matriz de transicao manual (UI + RPC + trigger sao os unicos escritores).
- Migracao de dados: solicitacoes antigas nao existem (tudo pre-existente vira tipo=ideia).

## Testes e verificacao

- Deno (`supabase/functions/__tests__` + testes locais da function): hub-ideias valida tipo no create (400 em valor invalido, default ideia), PATCH de tipo sob lock; tools MCP novos (scope negado sem scope, ownership cross-tenant rejeitado, patch vazio rejeitado, create/list/update happy path com db mock). Gotcha de mocks: params de RPC/SQL reais nao sao exercitados por mocks deno; RPC e trigger sao verificados por SQL no staging.
- Vitest: sweep de contrato nas duas suites (`apps/**/__tests__` incl. Hub RTL) por asserts do union de status de Ideia/HubIdeia e da lista de scopes; filtro por tipo na IdeiasPage do CRM; badge/labels novos; TarefaFormDialog com initialValues/onCreate.
- SQL no staging: criar solicitacao via function; converter via RPC (2x: segunda falha); flipar a tarefa para concluida e de volta, conferir os dois sentidos do sync; deletar a tarefa e conferir SET NULL so no ponteiro; conferir versao do PG de staging antes do push.
- Browser: fluxo completo Hub (criar solicitacao, ver badges) -> CRM (filtrar, converter, link Ver tarefa, drawer read-only pos-conversao) -> tarefa concluida -> Hub mostra "Concluida".
- CI: 4 tsc, vitest, deno test, lint, format:check.

## Sequencia de entrega

1. PR #270 (tarefas) merged pelo usuario; branch novo a partir de main atualizado; este spec e o primeiro commit.
2. Migration (colunas + CHECK + FK composta + RPC + trigger sync + trigger de notificacao recriado) + edge function hub-ideias + deploy staging (hub-ideias e mcp com --use-api).
3. Hub UI + CRM UI + notificacao.
4. MCP tools + scopes.
5. Testes, staging E2E, PR. Migrations de prod aplicadas apos merge (lembrar: db push --linked contra prod esta quebrado pelo 20260730000004 sem arquivo; usar db query + registro manual de versao, tecnica ja usada).
