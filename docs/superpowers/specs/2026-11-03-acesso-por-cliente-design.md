# Acesso por cliente (membros restritos a clientes atribuídos)

Status: rascunho para aprovação · 2026-11-03

## Intenção

Agências pedem para que certos membros da equipe vejam **só os clientes que foram atribuídos a eles**.
Hoje todo membro de um workspace vê todos os clientes: os papéis
(`workspace_roles`, spec `2026-09-02-permissoes-granulares-papeis-design.md`) decidem **o que** o
membro pode fazer por módulo (`none | ver | editar`), nunca **em quais clientes**.

Esta feature acrescenta um segundo eixo, independente do papel: o escopo de clientes do membro.
O papel diz o que a pessoa pode fazer; o escopo diz em quais clientes isso vale.

O motivo é confidencialidade (freelancer que atende só uma conta, equipe dividida por carteira),
então o corte precisa ser real no banco, não só um filtro de tela.

## Decisões do usuário

| Tema | Decisão |
|---|---|
| Onde liga | **Por membro**, qualquer papel (admin, agente, papel customizado). Não é uma opção do papel. |
| Onde se atribui | Na linha do membro em **Configuração > Membros** (onde já ficam Função e Financeiro). |
| Rigor | **No banco.** Membro restrito não alcança dados de outro cliente por nenhum caminho. |
| Trabalho sem cliente | **Escondido também** (post avulso, tarefa sem cliente, etc.)... |
| ...exceto o que é dele | Item **atribuído a ele ou criado por ele** continua visível, com ou sem cliente. |
| Criar cliente | **Não.** Membro restrito nunca cria cliente; só o dono atribui. |
| Item dele em cliente oculto | Vê **o que o trabalho pede**: o item com mídia, comentários e feedback, mais nome, foto, perfil de marca e briefing do cliente. Não vê os outros posts, analytics nem Hub desse cliente, e o cliente não entra na lista dele. |
| Financeiro | Restrito com `financeiro`/`contratos` no papel vê **só os clientes dele**: totais, rentabilidade e contratos calculados sobre os clientes atribuídos. |
| Chat da equipe | Grupos e DMs de que ele participa continuam; discussões de post de cliente oculto somem. |

## Objetivos

- O dono marca um membro como "Só os clientes selecionados" e escolhe a lista.
- Para esse membro, todo dado ligado a cliente não atribuído some: lista de clientes, entregas,
  posts, calendário, aprovações, arquivos, ideias, briefing, linha editorial, analytics, relatórios,
  links do Hub, comentários, feedback, tarefas, agenda, KPIs do dashboard e busca.
- Mudança de escopo vale na hora (sem precisar recarregar), pelo mesmo caminho de revogação ao vivo
  que os papéis já usam.
- Nada muda para ninguém no deploy: todo membro existente fica com escopo "Todos os clientes".

## Não objetivos (v1)

- Escopo no convite. Não existe linha em `workspace_members` antes do aceite; o dono ajusta depois.
- Escopo por cliente com nível diferente (ex.: "ver" no cliente A, "editar" no B). O nível vem do papel.
- Restringir o dono. O dono sempre vê tudo.
- Ligar a atribuição à de custo do Financeiro v2 (`financeiro_atribuicoes`). São coisas diferentes.

## Anti-objetivos (falhou mesmo que "funcione")

- Qualquer caminho que **falhe aberto**: embed falho, escopo nulo, lista vazia caindo para "todos",
  edge function com service role que esquece o filtro.
- Um membro restrito que consiga ampliar o próprio escopo.
- Membros não restritos (a grande maioria) pagando custo perceptível de performance.

## Modelo de dados

```sql
ALTER TABLE public.workspace_members
  ADD COLUMN client_scope text NOT NULL DEFAULT 'todos'
  CHECK (client_scope IN ('todos', 'atribuidos'));

CREATE TABLE public.workspace_member_clientes (
  workspace_id uuid   NOT NULL,
  user_id      uuid   NOT NULL,
  cliente_id   bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  PRIMARY KEY (workspace_id, user_id, cliente_id),
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES public.workspace_members (workspace_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id, workspace_id)
    REFERENCES public.clientes (id, conta_id) ON DELETE CASCADE
);
```

- O escopo é **flag explícita**, nunca inferido de "tem linhas de atribuição". Restrito com zero
  clientes vê zero clientes.
- Tudo mora em `workspace_members` (usuário com login), não em `membros` (cadastro de equipe do CRM,
  chave bigint). Isso também evita a armadilha de grant por coluna de `membros`/`clientes`.
- A tabela nova tem `REVOKE ALL FROM PUBLIC, anon, authenticated`; leitura por RLS (dono lê tudo do
  workspace, membro lê só as próprias linhas). Escrita só por RPC.
- Cascatas: excluir cliente apaga as atribuições dele; remover membro apaga as dele.
- Dono: o workspace pode ter mais de um `role = 'owner'` e não existe fluxo de "transferência". Regra:
  **todo owner é irrestrito** (o predicado checa o papel primeiro), e um trigger em `workspace_members`
  zera `client_scope` para `todos` e apaga as linhas quando `role` passa a `owner`.
- Coluna `client_scope_rev bigint NOT NULL DEFAULT 0` em `workspace_members`, incrementada pela RPC na
  mesma transação. O realtime do CRM só escuta `workspace_members` (canal `wm:` no `AuthContext`), então
  mexer só em `workspace_member_clientes` não dispararia a revogação ao vivo; o incremento faz disparar.
- Leitura da lista: `GRANT SELECT` em `workspace_member_clientes` para `authenticated` com RLS (o próprio
  membro lê as suas linhas; owner lê as do workspace). Sem INSERT/UPDATE/DELETE para `authenticated`.

## O predicado (fonte única)

```sql
public.can_access_cliente(p_user uuid, p_conta uuid, p_cliente_id bigint) RETURNS boolean
-- STABLE, SECURITY DEFINER, search_path fixo
-- dono                       -> true
-- client_scope = 'todos'     -> true
-- p_cliente_id IS NULL       -> false   (o "é dele" é decidido pela policy, ver abaixo)
-- senão                      -> EXISTS em workspace_member_clientes
-- sem linha em workspace_members -> false
```

Mais um helper barato, `public.my_client_scope_all()` (initplan), para as policies poderem
curto-circuitar o caso comum (`todos`) sem chamar o predicado por linha.

Ele **compõe** com a checagem de módulo, nunca a substitui. Atenção à ACL: `has_permission_for` tem
EXECUTE só para `service_role`; dentro de policy (que roda como `authenticated`) use o wrapper
`has_permission(module, action)`, que é o que tem EXECUTE para `authenticated`. Os helpers novos seguem o
mesmo desenho: `can_access_cliente(p_user, p_conta, p_cliente_id)` só `service_role` (edge functions, MCP)
e um wrapper `can_access_cliente(p_cliente_id)` (usa `auth.uid()` e `get_my_conta_id()`) para
`authenticated`. Forma nas policies:
`has_permission(...) AND (can_access_cliente(cliente_id) OR <é dele>)`.

Funções que uma policy pode chamar (todas com EXECUTE para `authenticated`): `has_permission(module,
action)`, `can_access_cliente(bigint)`, `can_see_cliente_context(bigint)` (só nas tabelas de contexto),
`my_client_scope_all()`, `my_membro_ids()`, `workflow_in_active_conta(bigint)` (tenant da etapa sem
passar pela RLS de `workflows`), `workflow_has_own_item(bigint)` (workflow legível como contexto do item
dele), `cliente_in_active_conta(bigint)` e `tarefa_serie_in_active_conta(bigint)` (tenant do cliente e da
série sem passar pela RLS de `clientes`/`tarefa_series`, para a tarefa dele e a marca de contexto num
cliente oculto), `folder_scope_cliente_id(bigint)` e `folder_row_scope_cliente_id(text, bigint, bigint)`
(cliente de uma pasta, subindo `parent_id` até a pasta de origem, devolvido só quando ele o acessa; senão
NULL), `file_own_client_less(bigint)` (upload dele sem cliente) e `file_linked_to_visible_post(bigint)`
(INVOKER: o arquivo está ligado a um post que ele vê) `file_is_readable_brand_logo(bigint)` (o arquivo é o
logo de uma marca que ele lê), `file_visible_at_source(bigint)` (visível pela origem: upload dele ou pasta de
cliente acessível) e `file_visible_without_logo(bigint)` (a origem ou um post que ele vê). `agenda_pode_ver_evento(bigint, boolean, uuid)` (helper da agenda que já existia; chamado com `privado = true` responde "organizador ou participante", o "é dele" de `agenda_eventos`). Os resolvedores crus `folder_cliente_id(bigint)` e
`folder_row_cliente_id(text, bigint, bigint)` são só de `service_role` (devolvem o cliente de qualquer
pasta). As funções de trigger das guardas (`guard_client_scope_move`,
`guard_post_child_update`, `guard_post_process_step_assign`, `guard_client_scope_item`,
`guard_scope_child_reparent`, `guard_file_scope_update`, `guard_folder_scope_parent`,
`guard_brand_logo_file`, `guard_post_file_link_swap`, `guard_agenda_evento_scope`,
`guard_agenda_participante_scope`, `guard_report_layout_files`) não têm EXECUTE
para `authenticated` nem `anon`.

Espelho TS: só `isClientScoped(membership)` em `lib/permissions.ts`, para afordâncias de UI
(esconder "Novo cliente", mostrar o aviso). O filtro de dados é sempre do servidor.

### "É dele"

Uma linha é do membro quando uma coluna de responsável ou de autor aponta para ele. Duas identidades:

- colunas uuid de autor (`created_by`, `user_id` de autor): comparam com `auth.uid()`;
- colunas de responsável (`responsavel_id` em `workflow_posts`, `workflow_etapas`, `tarefas`,
  `ideias.autor_membro_id`, etc.) são `bigint` para `membros.id`. Contam via
  `membros.crm_user_id = auth.uid() AND membros.conta_id = <conta>` (helper `my_membro_ids()`, initplan).
  Membro de workspace sem linha ligada em `membros` simplesmente não tem itens "dele" por responsável.
- **Trava:** com essa regra, quem edita `membros.crm_user_id` poderia ampliar o escopo de um restrito
  (ou o próprio). Mudar `crm_user_id` passa a ser só do dono quando o valor antigo ou novo é um usuário
  restrito (trigger em `membros`).

A regra por linha é:

```
visível = can_access_cliente(uid, conta, cliente_id_da_linha)
       OR (é_dele(linha))
```

Isso vale para linhas sem cliente e também para linhas de cliente não atribuído (decisão do
usuário: o que foi atribuído a ele não pode sumir). Tabela sem coluna de responsável nem de autor
esconde toda linha sem cliente para o restrito. **O plano lista, tabela por tabela, qual coluna
conta como "é dele"** a partir do catálogo, não de grep (ver Inventário).

Tabelas com `cliente_id` próprio usam o próprio (inclusive `workflow_posts`, que tem `cliente_id NOT
NULL` desde `20260830000001`, também em post avulso sem `workflow_id`). Tabelas sem ele usam o cliente
do pai.

### Escrita

Toda tabela e RPC que aceita `cliente_id` (ou chega ao cliente por pai) ganha `INSERT ... WITH CHECK` e
`UPDATE ... WITH CHECK` com `can_access_cliente(cliente_id)`, **sem** a exceção "é dele". Senão um restrito
criaria ou moveria uma tarefa/post para um cliente oculto e, como autor, passaria a lê-lo. Hoje
`tarefas`, `workflows` e `workflow_posts` aceitam escrita por workspace, então isso é obrigatório na
Fase 1. Outros membros (não restritos) continuam podendo atribuir trabalho de um cliente oculto a um
restrito; é o caminho pretendido para o "é dele". Filha: WITH CHECK pelo pai visível (a escrita na
tabela filha confere o pai por uma subconsulta que respeita a RLS dele); raiz: WITH CHECK com
`can_access_cliente`, sem a exceção "é dele".

## Quem gerencia

- **Só o dono** edita escopo e atribuições, como já acontece com os papéis (`not_owner`). Um admin
  com `equipe: editar` não edita, para nenhum restrito poder ampliar o próprio escopo.
- Mesmo padrão da gestão de membros: nova ação `set-client-scope` no edge function
  `manage-workspace-user`, que chama a RPC `set_member_client_scope(p_actor, p_workspace, p_user,
  p_scope, p_cliente_ids)` com EXECUTE **só `service_role`**. A RPC confere que o ator é owner do
  workspace, recusa owner como alvo, confere que todo id é cliente do workspace, grava escopo e
  substitui as linhas numa transação, incrementa `client_scope_rev` e grava em `audit_log`.
- Membro restrito nunca cria cliente: a policy de INSERT de `clientes` (e qualquer RPC/edge que crie
  cliente: importação CSV, conversão de lead, MCP `create_client`) exige `client_scope = 'todos'`.

## Aplicação (enforcement)

### A armadilha das views

`clientes_v` é `security_barrier`, **não** `security_invoker`: roda como dono da view e o filtro está
no `WHERE c.conta_id = get_my_conta_id()`. RLS em `clientes` sozinha **não** esconderia nada da lista
principal. O predicado entra no `WHERE` da `clientes_v` (e de qualquer outra view do mesmo tipo
sobre tabelas com cliente; o plano levanta a lista no catálogo). A tabela base também ganha a policy,
porque há leituras diretas de `from('clientes')`, embeds do PostgREST e policies dependentes.

### Inventário (feito no catálogo, não por grep)

O grep encontra ~54 migrations com `cliente_id` e ~13 edge functions que leem dados de cliente, mas
listas de dependência não se acham por grep. O plano monta o inventário a partir do banco:

- `information_schema.columns WHERE column_name IN ('cliente_id','client_id')` e as tabelas filhas que
  chegam ao cliente por FK (posts, slides, comentários, arquivos ligados, etc.);
- `pg_views` sobre essas tabelas (e o `security_invoker` de cada uma);
- `pg_proc WHERE prosecdef` que leem essas tabelas (dashboard, `get_client_health_aggregates()`,
  duplicar post/workflow, busca, notificações). O PR #539 (lockdown de grants de SECURITY DEFINER)
  pode já ter uma lista útil;
- edge functions com service role que leem dados de cliente em nome de um usuário.

### Fase 1: banco + CRM

- Coluna, tabela, RPC, predicado.
- Policies de SELECT/UPDATE/DELETE em todas as tabelas do inventário com o predicado composto.
- Views (`clientes_v` e afins) com o predicado.
- RPCs SECURITY DEFINER que **leem** dados de cliente em nome do usuário (KPIs do dashboard, saúde do
  cliente, busca, duplicação) filtram pelo predicado.
- UI (abaixo) e revogação ao vivo.

### Fase 2: caminhos com service role

Estes rodam com service role e não passam por RLS. "Real no banco" só fica completo quando eles também
filtram. **Até a Fase 2 sair, MCP e notificações ainda alcançam clientes não atribuídos**, então a
flag de liberação só liga depois das duas fases.

- MCP (`mcp`): cada ferramenta que lista ou lê cliente/post filtra por `can_access_cliente` do dono
  da chave/grant; `create_client` recusa restrito.
- Edge functions que leem dados de cliente para o usuário (analytics, relatórios, `report-docs`,
  arquivos, Instagram/TikTok/Google analytics) conferem o predicado antes de devolver.
- Notificações: `resolve_notification_targets` e os crons de e-mail deixam de mandar a um restrito
  eventos de cliente não atribuído (salvo "é dele").
- Chat da equipe: conforme a decisão de chat (ver Decisões em aberto).
- Notificações já guardadas: a policy de leitura de `notifications` (e as menções) filtra pelo cliente
  referenciado no payload, para um restrito não seguir vendo e clicando em eventos de cliente oculto.

O Hub (token do cliente final) não muda: ele não é membro do workspace.

### Liberação

Flag `feature_acesso_por_cliente` no padrão completo das outras features: coluna em `plans`, override
por workspace, `_shared/entitlements.ts` (com os redeploys dos importadores listados no CLAUDE.md),
contrato de `workspace-limits` e `useWorkspaceLimits.ts`. Escura até a Fase 2 estar em prod.

A flag é **só de criação/UI**: desligada, a RPC recusa passar alguém para `atribuidos`, mas aceita voltar
para `todos`, e a coluna Clientes aparece só para quem já está restrito, com a ação "Liberar todos os
clientes". O predicado **não lê a flag**: uma restrição existente continua valendo (falha fechada) até o
dono liberar. Rollback de banco nunca volta as policies antigas com alguém em `atribuidos`; primeiro
todos voltam a `todos` (um `UPDATE` só), depois as policies.

As policies podem entrar antes da flag: com todo mundo em `todos`, elas devolvem o que devolvem hoje.

## UI

### Configuração > Membros (desktop)

- Coluna nova **Clientes** na tabela de membros, ao lado de Financeiro: "Todos" ou "3 clientes". O dono
  clica e abre o diálogo. Na linha do dono aparece "Todos" sem ação.
- Diálogo **Acesso a clientes · {nome}**:
  - Escolha: *Todos os clientes* (padrão) ou *Só os clientes selecionados*.
  - Com a segunda: busca, lista com checkbox (foto, nome, sigla), "Selecionar todos" / "Limpar",
    contador "3 de 24 selecionados".
  - Aviso fixo quando restrito: "Itens atribuídos a {nome} ou criados por ele(a) continuam visíveis,
    mesmo de outros clientes." Sem travessões na copy.
  - Restrito com zero selecionados é permitido, com aviso "{nome} não vai ver nenhum cliente."
  - Salvar chama a RPC; o `DialogContent` usa `confirmClose` com alteração pendente.
- Só o dono vê a coluna como editável; admin vê o valor como leitura.

### Celular

Paridade em `MembrosPhone.tsx`: a linha do membro mostra "Clientes: 3", e tocar abre uma sheet com a
mesma escolha e lista.

### Para o membro restrito

- Lista de clientes, filtros e seletores de cliente mostram só os atribuídos.
- "Novo cliente" some (e importação de clientes, conversão de lead em cliente).
- Um selo discreto no topo da lista de clientes: "Você vê os clientes atribuídos a você."
- Link direto para cliente não atribuído (`/clientes/:id`) cai no estado "Cliente não encontrado"
  existente, sem revelar que ele existe.

### Revogação ao vivo

`AuthContext.applyMembership` + `computePermissionTransitions` já purgam o cache quando a membership
muda, disparados pelo canal realtime de `workspace_members`. O incremento de `client_scope_rev` faz o
canal disparar também quando só a lista muda. `getMyMembership()` passa a trazer `client_scope`,
`client_scope_rev` e a lista de ids; qualquer mudança no escopo ou na lista conta como downgrade do módulo `clientes` (e dos módulos que dependem de cliente) e
purga essas queries. Teste em `context/__tests__/revocation.test.ts`.

## Performance

- Índice da PK `(workspace_id, user_id, cliente_id)` cobre o EXISTS.
- O curto-circuito `my_client_scope_all()` em initplan faz o membro não restrito não pagar por linha.
- O plano mede `EXPLAIN` das listagens grandes (posts, arquivos, calendário) antes e depois.

## Testes

- Nova suíte `supabase/tests/entitlements/acesso_por_cliente.sql` (gate de CI): dono, `todos`,
  restrito com 0/1/n clientes, "é dele" sem cliente e em cliente não atribuído, view `clientes_v`,
  RPCs SECURITY DEFINER do inventário, INSERT em `clientes` recusado, RPC recusando não dono e o
  próprio dono como alvo, cascatas, transferência de propriedade.
- Vitest: `isClientScoped`, diálogo, coluna, revogação.
- Deno: filtros do MCP e das edge functions da Fase 2.

### Contexto do item dele em cliente oculto

Um segundo predicado, `can_see_cliente_context(cliente_id)`: verdadeiro quando `can_access_cliente` ou
quando existe item "dele" naquele cliente. Ele libera **só** as leituras de contexto: as colunas de
identidade do cliente (nome, sigla, cor, foto) por uma RPC/view própria, perfil de marca e briefing. As
filhas do item (mídia, slides, comentários, feedback, versões) seguem o item. Para agendar/publicar, a
conta conectada do cliente é usada pelo servidor em nome do post; o restrito não lê a tabela de contas.
`clientes_v` e as listagens/seletores **não** usam esse predicado, então o cliente não aparece na lista,
e `/clientes/:id` de cliente oculto segue "não encontrado".

### Financeiro restrito

`_financeiro_calcular` e as RPCs de leitura `financeiro_*` (e rentabilidade, contratos, KPIs financeiros
do dashboard) recebem o filtro de clientes do ator. Custos de membro e despesas sem cliente não entram
para o restrito (só o rateio atribuído aos clientes dele). A UI mostra o selo "Valores dos seus clientes"
no topo do Financeiro. Escritas financeiras exigem `can_access_cliente` do cliente da linha.

### Chat da equipe

Salas (grupos e DMs) de que o restrito participa seguem visíveis: participar é atribuição explícita.
Discussão de post (`post_discussao_*`) segue o post: visível se o post é visível para ele.

## Chamadas minhas (o builder pode seguir)

- Admin também pode ser restrito; só o dono nunca.
- Só o dono edita escopo; admin vê como leitura.
- Lista vazia com escopo restrito = zero clientes (nunca cai para todos).
- Sem escopo no convite (v1).
- Link para cliente não atribuído vira "não encontrado".
- Atribuição de acesso não mexe em `financeiro_atribuicoes`.
- Flag de plataforma escura até a Fase 2.

## Deixado para o builder

- Nomes finais das RPCs e helpers, o desenho exato das policies por tabela, a lista de colunas "é
  dele" por tabela (do catálogo), e a ordem de migrations/deploy (a escrever no plano, no formato das
  outras features no CLAUDE.md).
