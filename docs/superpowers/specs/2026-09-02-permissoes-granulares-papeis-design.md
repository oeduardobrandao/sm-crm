# Permissões granulares — Papéis customizados (Fase 1)

**Data:** 2026-09-02
**Status:** aprovado em brainstorming (dono do produto), aguardando plano de implementação
**Fase 2 (fora deste escopo):** restrição de acesso por cliente (membro só vê clientes atribuídos). Nada neste design pode bloquear essa evolução; o escopo por cliente será um eixo separado (join table por membro), ortogonal aos papéis.

## Problema

Hoje a única configuração de permissão da equipe é o papel binário Admin/Agente
(`workspace_members.role`) mais um único boolean (`can_see_financials`, significativo só
para admin). O dono do workspace quer controle fino: quais módulos cada pessoa acessa,
com distinção ver/editar, e papéis nomeados reutilizáveis.

## Decisões de produto (aprovadas)

1. **Modelo de camada única**: cada membro tem exatamente um papel (preset do sistema ou
   customizado). Sem overrides individuais por cima do papel. Para permissões únicas de
   uma pessoa, o dono cria um papel só para ela. Editar um papel propaga imediatamente
   a todos os membros que o têm.
2. **Disponível em todos os planos.** Nenhuma feature flag de entitlements.
3. **Só o dono** cria/edita/exclui papéis. Atribuição de papel a membros segue as regras
   atuais do `manage-workspace-user` (dono e admin podem, com as travas existentes:
   ninguém edita o dono exceto ele mesmo em outras vias; ninguém edita a si próprio).
4. **Dono fica fora do sistema**: sempre tem tudo, não recebe papel, imutável.
5. **Cobrança, Armazenamento e a gestão de Papéis continuam exclusivos do dono** —
   nenhum papel pode concedê-los.
6. **Fases**: papéis primeiro (este design). Restrição por cliente é iniciativa futura.

## Catálogo de permissões (v1)

Cada módulo tem um valor em `{'none' | 'ver' | 'editar'}`; `editar` implica `ver`;
chave ausente ou desconhecida ⇒ `none` (falha fechada — módulo novo lançado depois fica
oculto para papéis customizados até o dono habilitar).

Slugs canônicos (chaves do jsonb):

| Slug | Módulo | Cobre |
|---|---|---|
| `clientes` | Clientes | lista, detalhe, criar/editar/excluir cliente |
| `entregas` | Entregas | fluxos, posts, kanban; editar = criar/mover/aprovar |
| `calendario` | Calendário editorial | |
| `aprovacoes` | Aprovações | |
| `arquivos` | Arquivos | |
| `ideias` | Ideias | |
| `leads` | Leads | hoje bloqueado para agente (RLS) |
| `financeiro` | Financeiro | absorve o switch "Ver financeiro" |
| `contratos` | Contratos | |
| `equipe` | Equipe | roster `membros`, membro-detalhe, convites, aba "Membros" de `/configuracao` |
| `analytics` | Analytics / Relatórios | páginas de analytics e relatórios |
| `automacoes` | Automações | automações de status e comentário→DM |
| `configuracoes` | Configurações do workspace | abas staff: workspace, status, hub, relatórios, MCP; aba Hub do cliente-detalhe |

Fora do catálogo (fixos): Dashboard sempre visível (conteúdo se auto-filtra pelas
permissões); Perfil e Notificações sempre acessíveis (pessoais); Cobrança, Armazenamento
e Papéis = só dono.

### Presets do sistema (virtuais, não editáveis, sem linha em tabela)

Os presets são o comportamento legado expresso como permissões. Membro **sem** `role_id`
usa o preset derivado de `workspace_members.role`:

- **Administrador**: tudo `editar`; `financeiro` condicionado ao `can_see_financials`
  do membro (o switch atual continua funcionando para admins legados).
- **Agente** (= comportamento atual do agente, byte a byte):
  - `none`: `leads`, `financeiro`, `contratos`, `equipe`, `configuracoes`
  - `ver`: `analytics`, `automacoes` (agente hoje vê automações mas RLS de escrita exige owner/admin)
  - `editar`: `clientes`, `entregas`, `calendario`, `aprovacoes`, `arquivos`, `ideias`

O mapa do Agente é hardcoded em DOIS espelhos que devem ser mantidos em paridade (mesmo
padrão do par `can_see_financials()` SQL / `deriveFinancialAccess` TS): a função SQL
`has_permission` e uma constante TS `AGENT_PRESET`. Teste de paridade obrigatório.

## Schema

### Migração A (aditiva — zero mudança observável)

```sql
CREATE TABLE public.workspace_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  nome text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, nome)
);

ALTER TABLE public.workspace_members
  ADD COLUMN role_id uuid NULL REFERENCES public.workspace_roles(id) ON DELETE RESTRICT;

ALTER TABLE public.invites
  ADD COLUMN role_id uuid NULL REFERENCES public.workspace_roles(id) ON DELETE SET NULL;
```

- RLS de `workspace_roles`: SELECT para membros do workspace
  (`conta_id IN (SELECT public.user_workspace_ids())` — usar a função anti-recursão);
  INSERT/UPDATE/DELETE com `false` (escrita só via service role, padrão
  `workspace_members`).
- `ON DELETE RESTRICT` em `workspace_members.role_id`: excluir papel com membros falha;
  o dono reatribui antes (a UI mostra quem está no papel).
- `invites.role_id` com `SET NULL`: papel excluído degrada o convite pendente para o
  `invites.role` legado (`agent`), falha fechada.

### Semântica de compatibilidade (coração do design)

- Membro sem `role_id` ⇒ comportamento atual intacto (`role` + `can_see_financials`).
  **Migração de dados: nenhuma.**
- Atribuir papel customizado ⇒ `role_id = <papel>` **e `role = 'agent'`** (chassi
  falha-fechada: qualquer checagem legada não religada concede menos, nunca mais).
  O espelho `profiles.role` recebe `'agent'` também (best-effort, como hoje).
- Atribuir preset ⇒ `role_id = NULL` e `role = 'admin' | 'agent'` (fluxo atual).

### Função de resolução

```sql
CREATE FUNCTION public.has_permission(p_module text, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$ ... $$;
```

Lógica, na ordem:
1. `role = 'owner'` ⇒ `true`.
2. `role_id IS NOT NULL` ⇒ lookup `permissions ->> p_module`:
   `'editar'` ⇒ true; `'ver'` ⇒ true somente se `p_action = 'ver'`; senão ⇒ false.
3. Fallback legado: `admin` ⇒ true (para `financeiro`, condicionado a
   `can_see_financials`); `agent` ⇒ mapa AGENT_PRESET hardcoded.
4. Sem membership ⇒ false.

Grants iguais a `can_see_financials()`: EXECUTE para `authenticated`, revogado de
PUBLIC/anon/service_role. `p_action` fora de `('ver','editar')` ⇒ false.

## Enforcement backend (Migração B + edge functions)

Religação dos pontos que hoje já têm enforcement por papel:

| Ponto atual | Passa a consultar |
|---|---|
| `can_see_financials()` — RLS de `transacoes`/`contratos` (SELECT), views `membros_v`/`clientes_v`, triggers de escrita financeira | **corpo da função redefinido** → `has_permission('financeiro','ver')` (mantendo o condicional legado de admin). Nenhuma policy financeira é tocada. |
| RLS de escrita de `transacoes`/`contratos` (INSERT/UPDATE/DELETE) | conjunto adicional `has_permission('financeiro','editar')` |
| RLS de `leads` (`get_my_role() IS DISTINCT FROM 'agent'`) | SELECT → `has_permission('leads','ver')`; escrita → `('leads','editar')` |
| RLS de `post_status_definitions` (owner/admin) | `has_permission('configuracoes','editar')` |
| RLS de `post_status_automations` e `instagram_comment_automations` (owner/admin) | `has_permission('automacoes','editar')` |
| `workspaces` `ws_update_owner_admin` | `has_permission('configuracoes','editar')` |
| Edge `invite-user` (agente não convida) | quem tem `equipe` `editar` convida; travas atuais preservadas (admin não convida owner; seats) |
| Edge `automation-media` (`isWorkspaceEditor`) | permissão `automacoes`/`entregas` `editar` (resolvida lendo membership + papel) |
| Edge `mcp-keys` (usa `profiles.role`, desatualizável) e `mcp-oauth-consent` | `configuracoes.editar` via membership do workspace ativo (corrige o bug do `profiles.role` de quebra) |
| Edge `manage-workspace-user` | novo suporte a `role_id` no `update-role`; regras de ator inalteradas |

Policies de storage (logo do workspace, foto do cliente) permanecem owner/admin na v1
(anotar como follow-up; baixo risco).

**Limite honesto da v1:** módulos sem RLS por papel hoje — `clientes`, `entregas`,
`calendario`, `aprovacoes`, `arquivos`, `ideias`, `analytics` — ficam com enforcement de
frontend (idêntico ao status quo deles: RLS por tenant apenas). O ver/editar nesses
módulos é UX, não barreira de banco. Endurecimento por módulo é follow-up. `financeiro`,
`contratos`, `leads`, `automacoes` e `configuracoes` têm barreira real de banco.

### Edge function nova: `manage-workspace-roles`

- Verifica JWT; **ator deve ser dono** do workspace ativo (via `workspace_members`,
  nunca `profiles.role`).
- Ações: `create`, `update`, `delete`. Leitura não passa por aqui (SELECT direto com RLS).
- Validação do payload: `nome` não vazio e único no workspace; `permissions` com chaves
  ⊆ catálogo e valores ∈ `{none, ver, editar}`; chaves fora do catálogo rejeitadas.
- `delete` com membros ⇒ erro `role_in_use` (a UI lista os membros).
- Escreve via RPC `SECURITY DEFINER` (padrão `set_financial_access`): valida dono,
  aplica, insere `audit_log` (`role_created` / `role_updated` / `role_deleted`).
  EXECUTE só para `service_role`.
- Atribuição de papel a membro: **não é aqui** — estende `manage-workspace-user`
  `update-role` para aceitar `role: 'admin' | 'agent'` ou `role_id: uuid` (mutuamente
  exclusivos). `role_id` deve pertencer ao `conta_id` do ator. Audit
  `member_role_assigned` com id e nome do papel.

### Convites

- `invite-user` aceita `role_id` opcional (validado contra o conta_id).
- `accept_workspace_invite` copia `invites.role_id` para `workspace_members.role_id` e
  grava `role = 'agent'` quando `role_id` presente (senão fluxo atual).

## Frontend

### AuthContext

- `getMyMembership()` passa a retornar `{ role, can_see_financials, role_id, permissions }`
  (join com `workspace_roles` — uma query).
- Novo `can(module, action): boolean | 'unknown'` no contexto — espelho TS exato de
  `has_permission`, tri-estado no padrão da casa: `'unknown'` enquanto membership não
  resolve (rotas falham neutro, valores falham fechado).
- `canSeeFinancials` vira derivado de `can('financeiro','ver')`; consumidores existentes
  não mudam de assinatura. `deriveFinancialAccess` é absorvida pela derivação nova
  (mantendo o tipo `FinancialAccess`).
- Revogação ao vivo: canal realtime atual de `workspace_members` já cobre troca de
  `role_id`. **Adicionar** subscription de UPDATE em `workspace_roles` filtrada por
  `conta_id` do workspace ativo + incluir permissões no poll de 60s. Em downgrade de
  qualquer módulo (acessível → inacessível): `removeQueries` das query keys do módulo
  (mapa `MODULE_QUERY_KEYS` generalizando o atual `FINANCIAL_QUERY_KEYS`); em upgrade,
  `invalidateQueries`.

### Religação de guards e navegação

- `ProtectedRoute`: remove `AGENT_BLOCKED` (e o uso de `profiles.role`); entra mapa
  rota → `(módulo, 'ver')`:
  `/clientes*`→clientes, `/entregas*`→entregas, `/calendario`→calendario,
  `/aprovacoes`→aprovacoes, `/arquivos`→arquivos, `/ideias`→ideias, `/leads`→leads,
  `/financeiro`→financeiro, `/contratos`→contratos, `/equipe` e membro-detalhe→equipe,
  `/analytics` e `/relatorios`→analytics, automações→automacoes.
  Bloqueado ⇒ redirect `/dashboard` (comportamento atual). `'unknown'` ⇒ neutro
  (render sem redirect, como o guard financeiro faz hoje).
- `nav-data.ts`: filtros por `can(módulo,'ver')` substituem os checks de `role`;
  o filtro financeiro existente colapsa no mesmo mecanismo.
- `configTabs.ts` e `clienteTabs.model.ts`: arrays `roles:` substituídos por
  `permission: [módulo, ação]`; abas do dono (`cobranca`, `armazenamento`, `papeis`)
  marcadas `ownerOnly`.
- Superfícies de mutação por módulo: botões/formulários de criar/editar/excluir
  escondidos quando `can(módulo,'editar') !== true` — varredura módulo a módulo
  na implementação (Equipe, Clientes, Entregas, Arquivos, Ideias, Aprovações,
  Calendário, Leads).

### UI de gestão (só dono)

- **Aba nova "Papéis" em `/configuracao`**:
  - Lista: Administrador e Agente com selo "do sistema" (somente leitura, grade
    visível), papéis customizados com contagem de membros.
  - Criar: escolher preset de partida (cópia) + nome + grade de módulos com seletor
    de 3 estados (Sem acesso · Pode ver · Pode editar).
  - Editar: mesma grade; salvar propaga (aviso: "afeta N membros").
  - Excluir: bloqueado com membros — diálogo lista quem precisa ser reatribuído.
- **MembrosTab**: select "Função" lista Administrador, Agente + papéis customizados.
  Switch "Ver financeiro" continua aparecendo apenas em linhas de admin legado
  (sem `role_id`).
- **Convites** (MembrosTab e InviteSection da Equipe): mesmo select expandido.

## Testes

- **pgTAP** (`supabase/tests/entitlements/`, arquivos novos):
  `has_permission` (dono; papel custom com ver/editar/none; fallback admin com e sem
  `can_see_financials`; fallback agente = tabela-verdade do preset; módulo ausente ⇒
  nega; sem membership ⇒ nega); policies religadas (leads, automações, status defs,
  workspaces update); escrita financeira exige `editar`; RESTRICT de exclusão de papel;
  `accept_workspace_invite` com `role_id`; RPCs de papéis (só dono, audit).
- **Vitest**: paridade `can()` × tabela-verdade SQL (mesmos casos do pgTAP);
  `AGENT_PRESET` congelado por snapshot; guards de rota; nav; visibilidade das abas;
  aba Papéis (criação, edição, bloqueio de exclusão).
- **Deno**: `manage-workspace-roles` (só dono; validação de payload; `role_in_use`);
  `invite-user` com `role_id`; `manage-workspace-user` `update-role` com `role_id`.
- Suites existentes de contrato que citarem papéis (grep `apps/**/__tests__` +
  `supabase/functions/__tests__`) atualizadas junto.

## Rollout (padrão duas etapas do financeiro)

1. **PR A — aditivo**: migração A, `has_permission`, `manage-workspace-roles`,
   extensões de `manage-workspace-user`/`invite-user`/`accept_workspace_invite`,
   AuthContext com `can()` (alimentado só pelo fallback legado), UI da aba Papéis
   oculta atrás de nada observável (papéis podem ser criados mas nada os consome além
   do próprio `has_permission`). Deploy sem mudança de comportamento.
2. **PR B — religação**: migração B (policies + corpo de `can_see_financials()`),
   guards/nav/abas do frontend trocados para `can()`, aba Papéis e selects de função
   ligados.
- Prefixos de versão das migrations renumerados acima do tail de `origin/main` na hora
  de abrir cada PR (guard do CI).
- Deploy das edge functions alteradas antes do frontend que as consome.
- Functions com auth própria: deploy com `--no-verify-jwt` **não** se aplica às novas
  (verificam JWT), aplica-se apenas às já listadas no CLAUDE.md.

## Riscos e mitigação

- **Drift entre espelhos SQL/TS** (has_permission × can): teste de paridade com
  tabela-verdade única compartilhada por pgTAP e Vitest (mesmos casos, cada um no seu
  runner).
- **Checagens legadas esquecidas**: chassi `role='agent'` garante que esquecimento
  concede menos, nunca mais. Grep de saída no PR B: `role === 'agent'`,
  `get_my_role()`, `profiles.role`, `isWorkspaceEditor` — cada hit ou religado ou
  justificado no PR.
- **Schema drift de produção** (migração `20260315` possivelmente não aplicada em
  prod): a migração B não toca RLS de `clientes`/`membros`, então o drift documentado
  não é acionado.
- **`service_role` e as views**: `has_permission` segue os grants de
  `can_see_financials()` — edge functions continuam lendo tabelas base, nunca as views
  mascaradas.
