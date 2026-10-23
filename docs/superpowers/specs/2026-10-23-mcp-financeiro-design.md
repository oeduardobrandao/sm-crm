# MCP do Financeiro (somente donos)

Data: 2026-10-23. Branch `claude/mcp-financeiro`, empilhada sobre `claude/lancamentos-recorrentes` (PR #739).

## Intenção

O dono da agência quer que um agente (Claude via conector MCP do Mesaas) configure a seção
Financeiro inteira por ele: lançamentos, recorrentes, cobrança dos clientes, custo da equipe e a
configuração do Financeiro v2 (rentabilidade). Pedido do usuário: "MCP tools that allow agents to
configure that whole section for users. Different from the other tools, these ones should only be
available for owners."

Leitura adotada de "a seção inteira" (decisão minha): a página Financeiro (lançamentos e
recorrentes) mais tudo o que o Financeiro v2 configura (config, funções, acordos da equipe,
atribuições, entregas manuais, valores dos clientes, seed, fechar/reabrir período) e a leitura da
rentabilidade. Anexos de contrato dos acordos (bucket `financeiro-acordos`) ficam fora.

## Metas

- Ferramentas MCP de leitura e escrita para tudo acima, no servidor `supabase/functions/mcp`.
- Somente o dono do workspace (`workspace_members.role = 'owner'` no workspace da chave/grant)
  pode usar. Admins e agentes não, mesmo com `financeiro: editar`.
- O gate vale nos dois caminhos de autenticação (chave `mesaas_sk_` e OAuth) e é conferido a cada
  chamada, porque o papel muda.
- Mesmo comportamento de negócio do CRM: versões, `vale_desde`, travas, sincronização com as colunas
  legadas, `enforce_plan_feature`.

## Não metas

- Projeção de agendados no servidor. `projetarAgendamentos` continua só no CRM; as ferramentas
  devolvem as linhas físicas, os modelos recorrentes e a cobrança cadastrada, e documentam que os
  agendados do mês são derivados disso.
- Mudar o que `list_clients`/`get_client`/`list_members` devolvem. Eles continuam sem campos
  financeiros; valores só aparecem nas ferramentas novas. (Exceção na escrita, abaixo:
  `create_client`/`create_member` seguem a regra do PR #740 para os campos financeiros.)
- Anexos de contrato, exportação CSV, MCP do Admin.

## Anti-metas

- Um agente escrevendo no workspace errado. `get_my_conta_id()` lê `profiles.active_workspace_id`
  (o workspace que o dono abriu por último), não o da chave. Por isso nada de "se passar pelo
  usuário" setando `request.jwt.claims`: as RPCs recebem o workspace explícito.
- Um não-dono conseguindo criar chave/grant com escopo financeiro que só falha depois, ou pior,
  que funcione.
- Vazar valores em `audit_log` (a regra do `register` é ids e filtros, nunca payload).

## Desenho

### Escopos

- Novos: `financeiro:read` e `financeiro:write`, em `MCP_ALLOWED_SCOPES`
  (`_shared/mcp-token.ts`) e no espelho do CRM (`apps/crm/src/lib/mcp-scopes.ts`, rótulos
  "Financeiro (leitura, só donos)" e "Financeiro (escrita, só donos)").
- Fora de `MCP_AGENT_PRESET` / `AGENT_PRESET`.
- `financeiro:write` não implica leitura: cada ferramenta exige o seu escopo, como hoje.

### Gate de dono

1. **No contexto.** `McpKeyContext` ganha `role: string | null`, o papel do principal
   (`created_by`) em `workspace_members` do `conta_id`, lido a cada requisição nos dois resolvers
   (`resolveMcpKey` e `resolveOAuthCtx`; este já consulta a membership via `isWorkspaceMember`, que
   passa a devolver o papel). Uma consulta por requisição.
2. **No registro das ferramentas.** `register(...)` ganha a opção `ownerOnly`. Com ela, antes do
   `run`, `ctx.role !== 'owner'` lança um erro próprio (`McpOwnerError`) que vira
   `"Permission denied: somente o dono do workspace pode usar as ferramentas do Financeiro."`.
   Toda ferramenta com escopo `financeiro:*` é registrada com `ownerOnly`; um teste Deno percorre
   as ferramentas registradas e falha se alguma `financeiro:*` não for.
3. **No banco, para o que passa por RPC.** As variantes `_as` (abaixo) conferem de novo:
   `p_user` é `owner` de `p_conta` em `workspace_members`. É a barreira real para o v2, já que o
   service role ignora RLS.
4. **Na emissão.** `mcp-keys` (criar chave) e `mcp-oauth-consent` (gravar grant) recusam escopos
   `financeiro:*` quando o usuário não é dono do workspace (400 `owner_only_scope`). No CRM, os dois
   seletores de escopo mostram esses escopos desabilitados para quem não é dono, com a nota
   "Somente o dono do workspace".

**Ferramentas existentes que já escrevem valores.** Hoje `create_client` aceita `valor_mensal`
(escopo `clientes:write`) e `create_member` aceita `custo_mensal`/`data_pagamento`
(`membros:write`), gravando por service role, onde `guard_financial_write` sai cedo
(`20260904000002:244-247`). Ou seja, um não-dono já consegue gravar valores pelo MCP. Esses
parâmetros seguem a regra do PR #740 (decisão do Eduardo ao combinar os dois PRs, 2026-10-23):
exigem `financeiro:editar` do usuário da conexão OAuth (`ctx.can_write_financials`, resolvido a
cada requisição); chaves de API, que só quem tem `configuracoes:editar` cria, não mudam. Sem a
permissão, a ferramenta recusa se algum deles vier preenchido (não ignora em silêncio). A
descrição das duas ferramentas diz isso. As ferramentas `financeiro:*` continuam só do dono, e na
tela de consentimento os escopos `financeiro:*` só aparecem habilitados para o dono (o servidor os
tira de `allowed_scopes` de quem não é dono).

**Barreira das ferramentas de tabela direta.** Lançamentos, recorrentes e as colunas legadas
(v2 desligado) não passam por RPC: a única barreira de dono é o gate `ownerOnly` do edge, já que
service role ignora RLS e `guard_financial_write`. Decisão aceita: o gate é estrutural (teste
garante que toda `financeiro:*` é `ownerOnly`) e as duas operações que precisam de atomicidade já
viram RPC `_as` com checagem de dono no banco.

Plano: o gate do `register` para `financeiro:*` também confere `feature_financial`
(`effective_plan_feature`) antes de qualquer consulta, leitura ou escrita, porque o service role
ignora RLS e uma leitura direta de `transacoes` não passa por trigger nenhum. As ferramentas do v2
conferem também `feature_financeiro_v2` antes do `run`; as RPCs continuam levantando
`feature_disabled:*` como segunda barreira.

### Variantes `_as` das RPCs do v2 (migração nova)

Migração `20261029000002_financeiro_v2_rpc_as.sql`.

- Para cada RPC pública do v2 usada pelas ferramentas, criar
  `public.<nome>_as(p_conta uuid, p_user uuid, <mesmos parâmetros>)`, `SECURITY DEFINER`,
  `search_path = public, pg_temp`, com o corpo da **última** definição da pública:
  - `financeiro_config_salvar`, `financeiro_funcao_salvar`, `financeiro_funcao_excluir`,
    `financeiro_acordo_salvar`, `financeiro_atribuicoes_salvar`, `financeiro_entregas_salvar`
    (corpo em 000004);
  - `financeiro_cliente_salvar` e `financeiro_seed` (000005);
  - `financeiro_periodo_reabrir`, `financeiro_periodo_fechar`, `financeiro_rentabilidade` (000006);
  - `financeiro_periodos_listar`, `financeiro_periodos_editaveis` (000003).
- Nas `_as`: `v_conta := p_conta`; `auth.uid()` vira `p_user` (ex.: `criado_por`);
  `has_permission(...)` vira `has_permission_for(p_user, p_conta, ...)`; `can_see_financials()`
  vira a checagem equivalente para `p_user`/`p_conta`; toda chamada aninhada a outra pública que
  resolve o workspace pelo JWT (ex.: `financeiro_periodos_editaveis()` dentro de
  `financeiro_rentabilidade`) passa a chamar a `_as` correspondente.
- Cada `_as` começa conferindo `p_user` como `owner` de `p_conta` (erro `owner_only`, 42501).
  Isso é específico do caminho MCP: o CRM continua permitindo quem tem `financeiro: editar`.
- As públicas viram invólucros finos: resolvem `get_my_conta_id()` e `auth.uid()`, fazem as
  checagens de permissão de hoje (`has_permission`), e delegam a um núcleo interno sem a checagem
  de dono. Forma sugerida: núcleo `_<nome>_core(p_conta, p_user, ...)` (service_role only) com o
  corpo; a pública chama o núcleo depois das suas checagens; a `_as` confere dono e chama o núcleo.
  Assim o corpo existe uma vez só.
- Grants: `_as` e `_core` com `REVOKE ALL FROM PUBLIC, anon, authenticated` e
  `GRANT EXECUTE TO service_role`; públicas mantêm `authenticated, service_role`. Bloco de
  autoverificação no fim da migração, como em 000004:620-640.
- Comportamento das públicas não muda. As suítes `99_financeiro_v2_*.sql` existentes têm que
  continuar passando sem edição.
- Rollback: um arquivo `docs/superpowers/rollbacks/20261029000002_financeiro_v2_rpc_as.down.sql`
  com, nesta ordem: as definições originais das públicas (copiadas da última migração de cada uma),
  com os grants originais; `DROP FUNCTION` de todas as `_as` e `_core`. Testado localmente
  (`db reset`, aplicar o down, rodar as suítes `99_financeiro_v2_*.sql` existentes). A migração
  leva um comentário no fim apontando para ele, como 000006:342.

### RPCs de escrita dos lançamentos (mesma migração)

Duas operações do lado legado precisam ser atômicas, então também viram RPCs service_role only:

- `financeiro_agendamento_confirmar_as(p_conta, p_user, p_origem text, p_id bigint)`: confere dono e
  `feature_financial`; calcula o agendado **do mês corrente** (America/Sao_Paulo) a partir da
  origem (`cliente`: ativo e com `data_pagamento`; `membro`: com `data_pagamento`; `recorrente`:
  ativo no mês), monta a mesma `referencia_agendamento` do CRM, pega
  `pg_advisory_xact_lock(hashtextextended('agendamento:' || p_conta || ':' || ref, 0))`, recusa com
  `ja_confirmado` se já existir linha com essa referência no workspace e insere a linha `pago`
  (descrição, valor, tipo, categoria e detalhe iguais aos da projeção do CRM). Devolve a linha.
  Só o mês corrente porque é o único que o CRM projeta e, com v2 ligado, as colunas legadas só
  refletem o período aberto. O CRM não passa por ela (o confirmar do CRM segue sem a trava, como
  hoje); sem índice único por enquanto, porque prod pode ter duplicatas antigas e isso pediria
  migração de dados.
- `financeiro_recorrente_criar_as(p_conta, p_user, p_tipo, p_descricao, p_categoria, p_valor, p_dia,
  p_inicio, p_registrar_primeiro_pago boolean, p_data_primeiro date)`: cria o modelo e, se pedido,
  a primeira ocorrência paga com `detalhe 'Recorrente'` e a referência do mês de `p_data_primeiro`,
  na mesma transação. Sem chave de idempotência: uma repetição cria outro modelo, e a descrição da
  ferramenta diz para listar antes de recriar.

Dia do agendado: as três origens usam `least(dia, último dia do mês)`, como `projetarAgendamentos`
(corrigido no PR #739 para cliente e membro).

### Ferramentas

Todas `ownerOnly`. Datas `YYYY-MM-DD`. Valores em reais (number). Cada ferramenta declara schema
zod explícito de entrada e uma lista fechada de campos de saída (nada de `select('*')`).

Erros: uma tabela única em `mcp/financeiro-errors.ts` mapeia todo código que as RPCs levantam para
português: `feature_disabled:feature_financial`, `feature_disabled:feature_financeiro_v2`,
`financial_access_denied`, `owner_only`, `nao_configurado`, `not_found`, `periodo_invalido`,
`periodo_fechado`, `periodo_estado_invalido`, `periodo_dia_invalido`, `funcao_duplicada`,
`acordo_invalido`, `cliente_encerrado`, `itens_invalidos`, `mudancas_invalidas`,
`sem_atribuicao`, `ja_confirmado`, além de violação de CHECK (23514) e de FK (23503). Um teste
Deno extrai os `RAISE EXCEPTION '<código>'` das migrações `20261027*` e `20261029*` e falha se
algum não estiver na tabela. Fora da tabela continua "Internal error.".

Leitura (`financeiro:read`):

| Ferramenta | O que devolve |
|---|---|
| `list_lancamentos` | Linhas de `transacoes` do workspace: filtros `mes` (YYYY-MM), `tipo`, `status`, `limit` (padrão 100, máx. 500). Campos: id, data, descricao, detalhe, categoria, tipo, valor, status, cliente_id, referencia_agendamento |
| `list_recorrentes` | Modelos de `transacoes_recorrentes` (ativos por padrão; `incluir_encerrados`) |
| `get_cobrancas` | Cobrança cadastrada: clientes (id, nome, status, valor_mensal, data_pagamento) e membros (id, nome, custo_mensal, data_pagamento). É a base dos agendados do mês |
| `get_financeiro_v2` | Config (periodo_dia, meta_margem, seeded), funções, períodos (`_as` de listar) e editáveis |
| `get_rentabilidade` | `financeiro_rentabilidade_as(conta, user, inicio)` |
| `get_cliente_versoes` | Versões de um cliente (`cliente_id` obrigatório): vale_desde, valor_mensal, dia_pagamento, status, created_at. Até 50, mais recentes primeiro |
| `get_acordo_versoes` | Versões do acordo de um membro (`membro_id` obrigatório): vale_desde, funcao_id, tipo e valores do acordo, `tem_contrato` (boolean; o caminho do arquivo não sai). Até 50. `criado_por` não sai em nenhuma das duas |

Escrita (`financeiro:write`):

| Ferramenta | Faz |
|---|---|
| `create_lancamento` | Insere em `transacoes` (status `pago` ou `agendado`, categoria da lista do CRM) |
| `update_lancamento` / `delete_lancamento` | Altera / remove por id, sempre filtrando `conta_id` |
| `confirmar_agendamento` | `origem` (`cliente`/`membro`/`recorrente`) + `id`: materializa como `pago` o agendado do mês corrente via `financeiro_agendamento_confirmar_as` |
| `create_recorrente` | `financeiro_recorrente_criar_as` (modelo + opcional primeira ocorrência paga, atômico) |
| `update_recorrente` / `encerrar_recorrente` | Edita; encerra com a mesma regra do CRM (fim = mês anterior, ou apaga se começou neste mês) |
| `set_cobranca_cliente` | Valor mensal, dia de pagamento, status. Com v2 ligado: `financeiro_cliente_salvar_as` com `vale_desde` (padrão: início do período aberto). Sem v2: colunas legadas |
| `set_custo_membro` | Custo mensal e dia de pagamento. Com v2 ligado: recusa e indica `save_acordo` (no v2 o custo vem do acordo). Sem v2: colunas legadas |
| `seed_financeiro_v2` | `financeiro_seed_as` |
| `save_financeiro_config` | `financeiro_config_salvar_as` |
| `save_funcao` / `delete_funcao` | `financeiro_funcao_salvar_as` / `_excluir_as` |
| `save_acordo` | `financeiro_acordo_salvar_as`. A ferramenta tem schema próprio (campos do acordo nomeados e tipados, ausente = não informado) e monta o jsonb que a RPC espera; o plano copia a forma exata de `apps/crm/src/store/financeiroV2.ts` e das validações `acordo_invalido` |
| `save_atribuicoes` | `financeiro_atribuicoes_salvar_as` |
| `save_entregas` | `financeiro_entregas_salvar_as` |
| `fechar_periodo` / `reabrir_periodo` | `_as` correspondentes |

Auditoria: toda escrita grava `mcp.<ferramenta>` com ids, `mes`/`vale_desde`/`inicio` e contagens,
nunca valores, nomes ou jsonb de acordo.

### Testes

- Suíte de entitlement nova `supabase/tests/entitlements/99_financeiro_v2_rpc_as.sql`: grants
  (`_as`/`_core` só service_role, `authenticated` sem EXECUTE), dono passa, admin com
  `financeiro: editar` recebe `owner_only`, workspace explícito vence o `active_workspace_id`
  (usuário dono de dois workspaces com o ativo apontando para o outro), públicas inalteradas.
- Deno: gate `ownerOnly` (dono passa, admin/agente recebem erro, sem `run`), todas as `financeiro:*`
  são `ownerOnly`, resolvers devolvem o papel, mapeamento de erros, `confirmar_agendamento`
  (referência, duplicata), `encerrar_recorrente` (as duas regras), `set_cobranca_cliente` (v2 vs
  legado), auditoria sem valores. Atualizar testes existentes que montam `McpKeyContext`.
- Vitest: seletores de escopo do CRM desabilitam `financeiro:*` para não-donos.
- `mcp-keys` / `mcp-oauth-consent`: recusa de escopo financeiro para não-dono.

### Implantação (só quando o usuário pedir)

Migração em staging e prod (depois da de #739), deploy de `mcp` (`--no-verify-jwt`), `mcp-keys` e
`mcp-oauth-consent`, depois merge (que publica o CRM). Quem já tem grant precisa reautorizar
marcando os escopos novos.

## Decisões minhas para conferir

- Escopo da "seção inteira" como descrito acima; anexos de contrato fora.
- Dono = `workspace_members.role = 'owner'`; admins ficam de fora mesmo com permissão financeira.
- Sem projeção no servidor; `confirmar_agendamento` cobre a ação de confirmar, só no mês corrente.
- Confirmar atômico por trava consultiva, sem índice único (evita migração de dados em prod).
- `set_custo_membro` recusa com v2 ligado (o custo é do acordo).

## Regras de implementação (da revisão)

- **Workspace em tudo.** Toda consulta direta filtra `conta_id = ctx.conta_id`, inclusive
  `list_recorrentes`, `get_financeiro_v2` (config, funções), `get_cliente_versoes`,
  `get_acordo_versoes`, `get_cobrancas`. Antes de gravar, todo id recebido (lançamento, recorrente,
  `cliente_id` de lançamento, cliente/membro de cobrança e de confirmação) é conferido como do
  workspace: `transacoes.cliente_id` é FK de coluna única para `clientes(id)`, então um id de outro
  workspace passaria.
- **`user_id`.** Inserts em `transacoes` e `transacoes_recorrentes` (NOT NULL) usam
  `user_id = ctx.created_by`, nunca `key_id`. As RPCs `_as` recebem esse mesmo valor em `p_user`.
- **Ordem das checagens.** Pública: flags (`feature_financial`, depois `feature_financeiro_v2`),
  `has_permission` (e, em reabrir/fechar, a checagem de papel `owner` ou `admin` que existe hoje,
  `20261027000006:142-146, 193-197`), então `_core`. `_as`: flags, dono, então `_core`. `_core`:
  trava, `seeded`, período editável, `not_found`, com `p_conta`/`p_user` explícitos. Assim as suítes
  que conferem "flag antes de permissão" seguem passando.
- **`auth.uid()` nos corpos.** Todo uso vira `p_user` no `_core`, inclusive `criado_por` e os
  inserts em `audit_log` de reabrir/fechar (`20261027000006:162-164, 216-218`).
  `can_see_financials()` vira `has_permission_for(p_user, p_conta, 'financeiro', 'ver')` (sempre
  verdadeiro depois da checagem de dono, mantido por paridade).
- **Trigger legado.** `_financeiro_v2_legado_trigger` grava `created_by = auth.uid()`
  (`20261027000005:307, 339, 357`), que fica NULL numa escrita legada por service role. Por isso
  `set_cobranca_cliente` usa `financeiro_cliente_salvar_as` sempre que o workspace tem
  `financeiro_config.seeded_at` preenchido e a flag ligada; senão (nunca houve seed, ou seed com a
  flag desligada) grava nas colunas legadas e aceita `created_by` NULL na versão do trigger (as
  `_as` checam a flag primeiro, então não servem nesse caso). `set_custo_membro` com seed feito e flag desligada grava nas colunas legadas (o
  acordo é do v2) e aceita `created_by` NULL na versão que o trigger gera.
- **`set_cobranca_cliente` com v2.** `p_status` não aceita NULL: campos omitidos (status, dia, valor)
  vêm da versão vigente do cliente, lida antes. `vale_desde` padrão: início do período `aberto`; sem
  período `aberto` (seed feito, job ainda não rodou), o primeiro de `financeiro_periodos_editaveis_as`.
- **Confirmar agendamento.** Elegibilidade igual à projeção do CRM no mês corrente
  (America/Sao_Paulo): cliente `status = 'ativo'` e `data_pagamento` não nulo; membro
  `data_pagamento` não nulo; recorrente `inicio <= mês-01` e (`fim` nulo ou `fim >= mês-01`). Dia
  `least(dia, último dia do mês)`. `detalhe`/`categoria`: `'Agendamento automático'`/`'Agendamento'`
  para cliente e membro, `'Recorrente'`/categoria do modelo para recorrente. Valor nulo ou zero
  (ex.: membro por entrega, cliente sem mensalidade) recusa com `valor_indefinido` em vez de
  confirmar R$ 0. Esse código entra na tabela de erros.
- **Encerrar recorrente.** Mesma regra do CRM: apaga quando `inicio > primeiro dia do mês anterior`
  (começou neste mês ou depois); senão `fim = primeiro dia do mês anterior`. "Mês" em
  America/Sao_Paulo.
- **Plumbing.** `errorResult` mapeia `McpOwnerError`; `audit()` passa a extrair `resource_id`
  também de `lancamento_id`, `recorrente_id`, `membro_id`, `cliente_id`, `funcao_id`, `inicio`.
- **`McpKeyContext.role`.** Campo opcional (`role?: string | null`) para não quebrar os ~15 testes
  que montam o contexto à mão; ausente conta como não-dono. Os resolvers sempre preenchem.
- **Emissão.** `mcp-keys` checa dono no mesmo `contaId` que já usa (o `active_workspace_id` da
  membership); `mcp-oauth-consent` no `conta_id` escolhido. No CRM, `ConsentPage`,
  `IntegracoesClaudePage` e `IntegracoesClaudePhone` desabilitam os escopos (o
  `eligible-workspaces` já devolve `role`).
- **Fora de escopo, registrado.** Chave `mesaas_sk_` cujo criador saiu do workspace continua
  funcionando nas ferramentas não financeiras (comportamento atual); as financeiras param pelo
  gate de papel.

