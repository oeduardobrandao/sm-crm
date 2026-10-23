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
  financeiros; valores só aparecem nas ferramentas novas.
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

Plano: as ferramentas também exigem `feature_financial` (ler `effective_plan_feature`), e as do v2
exigem `feature_financeiro_v2`; as RPCs já levantam `feature_disabled:*`, que vira mensagem legível.

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

### Ferramentas

Todas `ownerOnly`. Datas `YYYY-MM-DD`. Valores em reais (number). Erros de negócio
(`feature_disabled:*`, `nao_configurado`, `periodo_invalido`, `funcao_duplicada`, `not_found`,
`owner_only`, `financial_access_denied`, violação de CHECK) viram `McpInputError` com mensagem em
português; o resto continua "Internal error.".

Leitura (`financeiro:read`):

| Ferramenta | O que devolve |
|---|---|
| `list_lancamentos` | Linhas de `transacoes` do workspace: filtros `mes` (YYYY-MM), `tipo`, `status`, `limit` (padrão 100, máx. 500). Campos: id, data, descricao, detalhe, categoria, tipo, valor, status, cliente_id, referencia_agendamento |
| `list_recorrentes` | Modelos de `transacoes_recorrentes` (ativos por padrão; `incluir_encerrados`) |
| `get_cobrancas` | Cobrança cadastrada: clientes (id, nome, status, valor_mensal, data_pagamento) e membros (id, nome, custo_mensal, data_pagamento). É a base dos agendados do mês |
| `get_financeiro_v2` | Config (periodo_dia, meta_margem, seeded), funções, períodos (`_as` de listar) e editáveis |
| `get_rentabilidade` | `financeiro_rentabilidade_as(conta, user, inicio)` |
| `get_versoes` | Versões de um cliente (`financeiro_cliente_versoes`) ou de um acordo de membro (`financeiro_acordo_versoes`) |

Escrita (`financeiro:write`):

| Ferramenta | Faz |
|---|---|
| `create_lancamento` | Insere em `transacoes` (status `pago` ou `agendado`, categoria da lista do CRM) |
| `update_lancamento` / `delete_lancamento` | Altera / remove por id, sempre filtrando `conta_id` |
| `confirmar_agendamento` | Materializa o agendado de um mês como `pago`: `origem` `cliente`/`membro`/`recorrente` + id + `mes`. Usa a mesma `referencia_agendamento` do CRM (`cliente_<id>_<aaaa>_<mm>`, `membro_…`, `recorrente_…`), valor/dia/descrição da origem, e recusa se já existir linha com essa referência |
| `create_recorrente` | Cria modelo (+ opcional `registrar_primeiro_pago`, como o "Repetir todo mês" do CRM) |
| `update_recorrente` / `encerrar_recorrente` | Edita; encerra com a mesma regra do CRM (fim = mês anterior, ou apaga se começou neste mês) |
| `set_cobranca_cliente` | Valor mensal, dia de pagamento, status. Com v2 ligado: `financeiro_cliente_salvar_as` com `vale_desde` (padrão: início do período aberto). Sem v2: colunas legadas |
| `set_custo_membro` | Custo mensal e dia de pagamento. Com v2 ligado: recusa e indica `save_acordo` (no v2 o custo vem do acordo). Sem v2: colunas legadas |
| `seed_financeiro_v2` | `financeiro_seed_as` |
| `save_financeiro_config` | `financeiro_config_salvar_as` |
| `save_funcao` / `delete_funcao` | `financeiro_funcao_salvar_as` / `_excluir_as` |
| `save_acordo` | `financeiro_acordo_salvar_as` (mesmo jsonb que o CRM envia) |
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
- Sem projeção no servidor; `confirmar_agendamento` cobre a ação de confirmar.
- `set_custo_membro` recusa com v2 ligado (o custo é do acordo).
