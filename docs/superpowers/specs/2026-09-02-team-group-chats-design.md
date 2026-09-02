# Chat de equipe (grupos + DMs) — Design

**Data:** 2026-09-02
**Status:** Aprovado (brainstorming com Eduardo, 2026-09-01/02)

## Objetivo

Habilitar conversas internas entre os membros da equipe do workspace, dentro da
página Mensagens do CRM: grupos nomeados (criados por owner/admin) e conversas
diretas 1:1 (livres para qualquer membro). Mensagens chegam em tempo real, com
@-menções e anexos de imagem/arquivo desde a v1. O chat com clientes existente
fica intocado.

## Decisões de escopo (do brainstorming)

| Decisão | Escolha |
|---|---|
| Localização | Dentro da página Mensagens, lista com seções "Clientes" e "Equipe" |
| Tipos de conversa | Grupos nomeados + DMs 1:1 (mesmo modelo de dados) |
| Criação de grupos | Só owner/admin cria e gerencia (renomear, adicionar/remover); qualquer participante pode sair |
| DMs | Livres para qualquer membro do workspace |
| Entrega | Realtime via Supabase Postgres Changes + polling de 60s como fallback |
| Recursos v1 | Texto (0–4000), @-menções (autocomplete + chip), anexos imagem/arquivo |
| Fora da v1 | Editar/apagar mensagem, reações, threads, busca, e-mail/digest |
| Gating | Nova flag `plans.feature_team_chat`, default `false` (ships dark) |
| Notificações | Toda mensagem nova notifica os participantes, **coalescida por conversa** (sem nova notificação enquanto houver uma não lida da mesma conversa); menções não geram tipo extra |

## Arquitetura

Subsistema novo, paralelo ao messaging de clientes (abordagem "A" do
brainstorming). Nada da tabela `mensagens`, das RPCs `get_mensagens_*` ou dos
componentes do chat com clientes é alterado, exceto os pontos de integração
explícitos (lista de conversas com seções, badge da sidebar, rota).

### Modelo de dados (migration única)

**`equipe_conversas`**

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `conta_id` | uuid NOT NULL → workspaces ON DELETE CASCADE | |
| `tipo` | text CHECK IN ('grupo','dm') | |
| `nome` | text | CHECK: obrigatório (1–120) para grupo, NULL para dm |
| `dm_key` | text | Só para dm: `least(user_a,user_b) || ':' || greatest(...)`; índice único parcial `WHERE tipo='dm'` por (conta_id, dm_key) impede DM duplicada |
| `created_by` | uuid → auth.users ON DELETE SET NULL | |
| `created_at` | timestamptz DEFAULT now() | |

**`equipe_conversa_participantes`**

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `conversa_id` | bigint NOT NULL → equipe_conversas ON DELETE CASCADE | |
| `conta_id` | uuid NOT NULL | desnormalizado para RLS/índices |
| `user_id` | uuid NOT NULL → auth.users ON DELETE CASCADE | |
| `last_seen_at` | timestamptz NOT NULL DEFAULT now() | marcador de leitura |
| `joined_at` | timestamptz DEFAULT now() | |

UNIQUE (conversa_id, user_id). Índice por (user_id, conta_id).

**`equipe_mensagens`**

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `conversa_id` | bigint NOT NULL → equipe_conversas ON DELETE CASCADE | |
| `conta_id` | uuid NOT NULL | |
| `author_user_id` | uuid NOT NULL → auth.users ON DELETE CASCADE | |
| `content` | text NOT NULL CHECK (char_length BETWEEN 0 AND 4000) | vazio permitido (mensagem só-anexo); UI exige texto OU anexo |
| `created_at` | timestamptz DEFAULT now() | |

Índice (conversa_id, created_at DESC, id DESC). Sem UPDATE/DELETE
autenticado: imutável como o chat com clientes.

**`equipe_mensagem_anexos`**

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `conta_id` | uuid NOT NULL | |
| `conversa_id` | bigint NOT NULL → equipe_conversas ON DELETE CASCADE | |
| `mensagem_id` | bigint → equipe_mensagens ON DELETE CASCADE | NULL = staged (upload feito, mensagem ainda não enviada) |
| `r2_key` | text NOT NULL | prefixo `equipe-chat/` |
| `file_name` | text NOT NULL | |
| `mime_type` | text NOT NULL | |
| `size_bytes` | bigint NOT NULL | |
| `created_by` | uuid NOT NULL | |
| `created_at` | timestamptz DEFAULT now() | |

### RLS: escopo por participante

Privacidade é por **participação**, não por workspace: colega de fora de uma
DM/grupo não lê nada. Para evitar recursão de política (participantes ↔
conversas), uma função `SECURITY DEFINER`:

```sql
is_equipe_conversa_member(p_conversa_id bigint) RETURNS boolean
-- EXISTS em equipe_conversa_participantes WHERE user_id = auth.uid()
```

- `equipe_conversas` SELECT: `is_equipe_conversa_member(id)`.
- `equipe_conversa_participantes` SELECT: `is_equipe_conversa_member(conversa_id)`
  (todo participante vê a lista de participantes).
- `equipe_mensagens` SELECT: `is_equipe_conversa_member(conversa_id)`.
  INSERT: participante da conversa E `author_user_id = auth.uid()` E
  `conta_id` = workspace ativo (padrão WITH CHECK tenant-pointer).
- `equipe_mensagem_anexos` SELECT: participante. Escritas só via edge function
  (service role) e RPC de envio.
- INSERT/UPDATE/DELETE de `equipe_conversas` e `equipe_conversa_participantes`
  autenticados: **nenhum** — toda criação/gestão passa pelas RPCs
  `SECURITY DEFINER` (que validam papel owner/admin via `workspace_members`).
- Bypass `service_role` em todas (padrão do repo).

### Gating de plano

- Migration adiciona `plans.feature_team_chat boolean NOT NULL DEFAULT false`.
- Trigger `enforce_plan_feature('feature_team_chat', 'direct', 'conta_id')`
  BEFORE INSERT em `equipe_conversas` e `equipe_mensagens`.
- Frontend: seção "Equipe", badge e rotas só renderizam com
  `features.feature_team_chat === true` (via `useWorkspaceLimits`).
- Nova flag exige **redeploy de `workspace-limits`** (coluna única em
  `_shared/entitlements.ts` — regra conhecida do repo).

### Realtime

- `ALTER PUBLICATION supabase_realtime ADD TABLE equipe_mensagens`
  (idempotente, padrão da migration 20260728000001).
- Cliente: uma assinatura `postgres_changes` (INSERT em `equipe_mensagens`),
  sem filtro — RLS garante que só eventos das conversas do usuário chegam.
- Evento da conversa aberta → append otimista no cache TanStack; de outra
  conversa → invalida `equipe-conversas` (lista + badge).
- Reconexão de canal → invalida tudo uma vez.
- Polling de 60s (refetchInterval) permanece como fallback.

### RPCs (SECURITY DEFINER, `SET search_path = public`)

| RPC | Comportamento |
|---|---|
| `get_equipe_conversas()` | Uma linha por conversa do caller: tipo, nome (para DM: nome/avatar do outro participante), última mensagem (autor + preview), `unread_count` (mensagens com `created_at > last_seen_at` do caller, excluindo as do próprio) |
| `get_equipe_mensagens(p_conversa_id, p_before, p_before_id, p_limit=50)` | Página keyset (created_at, id) com autor resolvido; valida participação |
| `create_equipe_conversa(p_tipo, p_nome, p_user_ids)` | dm: procura `dm_key` existente e devolve; grupo: exige owner/admin, cria conversa + participantes (criador incluso) |
| `manage_equipe_conversa(p_conversa_id, p_action, ...)` | `rename`/`add`/`remove` (owner/admin), `leave` (qualquer participante). Só grupos; DMs não têm gestão |
| `mark_equipe_conversa_seen(p_conversa_id)` | `last_seen_at = now()` do caller |
| `get_equipe_chat_unread()` | Total de não-lidas do caller (badge sidebar) |
| `get_equipe_chat_members()` | Membros do workspace do caller: user_id, nome, avatar — para picker/DM |
| `send_equipe_mensagem(p_conversa_id, p_content, p_anexo_ids)` | Caminho único de envio do composer (com ou sem anexos): insere a mensagem e liga anexos staged (valida que são do caller e da mesma conversa). A política RLS de INSERT em `equipe_mensagens` continua existindo como cinto de segurança para escrita via PostgREST, com as mesmas restrições |

Resolução de identidade (nome/avatar): `membros.crm_user_id` (como o feed
atual), com fallback para `profiles`, e por fim "Equipe".

### Notificações

- Novo tipo `team_message` no CHECK de `notifications.type` (copiar a lista da
  definição mais recente ao escrever a migration — padrão do repo).
- Trigger AFTER INSERT em `equipe_mensagens`: para cada participante ≠ autor,
  insere notificação (link `/mensagens/equipe/:conversaId`, metadata com
  conversa_id, nome da conversa/autor, preview 280 chars) **somente se** ele
  não tiver notificação `team_message` não lida com o mesmo `conversa_id`.
  Corpo com `BEGIN/EXCEPTION WHEN OTHERS → RAISE WARNING` (padrão
  `trg_notify_client_message`): falha de notificação nunca derruba o envio.
- Menções: sem notificação própria na v1 (a por-mensagem já cobre); ficam como
  autocomplete + chip.

### Anexos (edge function `equipe-chat-media`)

Espelha `ideia-media-manage` (rotas, `buildCorsHeaders`, verificação JWT via
service-role + `getUser(token)`, `conta_id` sempre validado):

- `POST /upload-url` — valida participação na conversa, entitlement
  `feature_team_chat`, mime (imagens comuns + PDF/docx/xlsx/zip) e tamanho
  (≤ 25MB); devolve presigned PUT (R2, prefixo `equipe-chat/{conta_id}/`).
- `POST /finalize` — HEAD no objeto (existe? tamanho bate?), cria linha
  staged em `equipe_mensagem_anexos`.
- `GET /anexos/:id/url` — valida participação; devolve presigned GET curto
  (~10min) para preview/download. Objetos são privados.
- Todo I/O com AbortSignal/timeout (lição do incidente R2: presign + fetch
  plano, nunca aws-sdk dentro do handler).
- Deploy com `--no-verify-jwt`? **Não** — função autentica por JWT normal.

Órfãos: leg novo no `post-media-cleanup-cron` apaga anexos staged
(`mensagem_id IS NULL`) com mais de 24h — linha + objeto R2.

### UI (apps/crm)

- **Rotas** (App.tsx): `/mensagens/equipe/:conversaId` declarada **antes** de
  `/mensagens/:clienteId` (senão "equipe" parseia como clienteId inválido).
  `vercel.json` já cobre `/mensagens(/.*)?` — sem mudança.
- **Lista**: `ConversationList` ganha um segmented control "Clientes | Equipe"
  no topo (tabs shadcn). Aba Clientes = comportamento atual intocado. Aba
  Equipe = conversas de `get_equipe_conversas()`, busca local, badge por
  conversa. Aba só aparece com `feature_team_chat`.
- **Nova conversa** (aba Equipe): botão abre lista de colegas
  (`get_equipe_chat_members`) → clique abre/cria DM. Para owner/admin, ação
  extra "Criar grupo": dialog com nome + multi-select de colegas.
- **Thread**: componente novo `EquipeThread` paralelo ao `ConversationThread`
  (sem PostChip/reply-to-post; com menções e anexos). Composer =
  `MentionTextarea` (tokens `@[Label](tipo:id)`) + botão de anexo (dropzone
  padrão da DM de automações); render de corpo via `MentionText`. Anexos:
  imagem = thumbnail clicável (presigned GET sob demanda), arquivo = chip com
  nome/tamanho e download.
- **Detalhes do grupo**: header abre um sheet com participantes; owner/admin
  renomeia/adiciona/remove; qualquer um "Sair do grupo". DM: header mostra só
  o colega.
- **Seen**: abrir a conversa (e refocá-la) chama `mark_equipe_conversa_seen` e
  invalida os unreads.
- **Badge sidebar**: `useEquipeChatUnread()` (gateado pela flag, polling 60s +
  invalidação por realtime) somado ao `useMensagensUnread()` existente no
  ponto único que renderiza o badge de Mensagens (sidebar + MobileNav).
- Mobile: mesmo shell lista↔thread já existente da página.

## Casos-limite

- Removido do grupo/saiu: RLS corta na hora; deep-link mostra "Você não
  participa mais desta conversa" (estado NotFound do shell).
- Removido do workspace: perde acesso via `get_my_conta_id()`; linhas de
  participante/mensagem ficam (histórico dos demais preservado).
- Última pessoa sai do grupo: conversa órfã e invisível; sem deleção na v1.
- Autor sem `membros` vinculado: nome via `profiles`; fallback "Equipe".
- DM consigo mesmo: bloqueada na RPC.
- `content` vazio E sem anexos: rejeitado na RPC de envio.

## Testes

- **Vitest**: lógica de unread/ordenação/cursor da aba Equipe (padrão
  `mensagensLogic.test.ts`); `EquipeThread`, picker de nova conversa, composer
  (menções, estado só-anexo); badge somado.
- **psql (supabase/tests/entitlements/)**: não-participante não lê
  conversa/mensagens/anexos de DM e grupo; agent não cria grupo mas cria DM;
  `feature_team_chat=false` bloqueia INSERT; coalescing de `team_message`;
  `dm_key` único; RPCs rejeitam não-participante.
- **Deno**: `equipe-chat-media` — auth, mime/size, participação, finalize sem
  objeto no R2, presigned GET de anexo de conversa alheia.

## Rollout

1. Migration (tabelas, RLS, RPCs, triggers, flag, publication) → staging →
   prod (`db push --linked`; conferir `supabase/.temp/project-ref` antes).
2. Deploy `equipe-chat-media` e redeploy `workspace-limits` e
   `post-media-cleanup-cron`.
3. Frontend (Vercel) — tudo dark: flag `feature_team_chat` desligada.
4. Ligar a flag por plano no admin quando o pricing for decidido.
