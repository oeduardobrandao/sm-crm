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
| `r2_key` | text NOT NULL UNIQUE | key FINAL `equipe-chat/{conta_id}/{uuid}.{ext}` (nunca a tmp) |
| `file_name` | text NOT NULL | |
| `mime_type` | text NOT NULL | |
| `size_bytes` | bigint NOT NULL CHECK (> 0) | |
| `created_by` | uuid NOT NULL | |
| `created_at` | timestamptz DEFAULT now() | |

### RLS: escopo por participante

Privacidade é por **participação**, não por workspace: colega de fora de uma
DM/grupo não lê nada. Para evitar recursão de política (participantes ↔
conversas), uma função `SECURITY DEFINER`:

```sql
is_equipe_conversa_member(p_conversa_id bigint) RETURNS boolean
-- 1) EXISTS em equipe_conversa_participantes
--    WHERE conversa_id = p_conversa_id AND user_id = auth.uid()
-- 2) E a conversa pertence ao workspace ativo do caller
--    (equipe_conversas.conta_id IN (SELECT get_my_conta_id()))
-- 3) E o caller ainda é membro desse workspace:
--    EXISTS (SELECT 1 FROM workspace_members
--             WHERE workspace_id = <conta da conversa> AND user_id = auth.uid())
```

A checagem (3) é obrigatória: `get_my_conta_id()` devolve o
`active_workspace_id`, que pode ficar apontando para um workspace do qual o
usuário já foi removido (ponteiro obsoleto). O repo já trata exatamente esse
cenário no `workspace_usage()` (20260808000001) — mesma defesa aqui, senão um
removido do workspace continuaria lendo as conversas de que participava.

- `equipe_conversas` SELECT: `is_equipe_conversa_member(id)`.
- `equipe_conversa_participantes` SELECT: `is_equipe_conversa_member(conversa_id)`
  (todo participante vê a lista de participantes).
- `equipe_mensagens` SELECT: `is_equipe_conversa_member(conversa_id)`.
  INSERT: participante da conversa E `author_user_id = auth.uid()` E
  `conta_id` = workspace ativo (padrão WITH CHECK tenant-pointer) E
  `char_length(content) >= 1` — INSERT direto via PostgREST nunca grava
  mensagem vazia; só a RPC `send_equipe_mensagem` (SECURITY DEFINER, valida
  anexos) pode inserir `content = ''` com anexo. Resolve a contradição
  "texto OU anexo" que uma política sozinha não consegue expressar.
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
- A flag vive em **quatro listas fechadas** — todas precisam da entrada, senão
  ela nunca chega ao cliente nem pode ser ligada no Admin:
  1. `supabase/functions/_shared/entitlements.ts` → `FEATURE_COLUMNS`
     (+ **redeploy de `workspace-limits`**);
  2. `apps/crm/src/hooks/useWorkspaceLimits.ts` → interface `FeatureFlags`;
  3. `apps/admin/src/lib/api.ts` → `FEATURE_FLAG_KEYS` e `FEATURE_FLAG_LABELS`;
  4. o CHECK/teste de paridade em
     `supabase/functions/__tests__/entitlements-shared_test.ts` (se listar colunas).
- Frontend: seção "Equipe", badge e realtime só ativam com
  `features.feature_team_chat === true` (via `useWorkspaceLimits`).
- **Gate de rota**: `ProtectedRoute.FEATURE_GATED['/mensagens']` hoje bloqueia a
  página inteira quando `feature_mensagens === false`. Passa a liberar quando
  **qualquer uma** das duas flags está ligada (a página mostra só as seções
  habilitadas); o item de nav em `nav-data.ts` segue a mesma regra.

### Realtime

- `ALTER PUBLICATION supabase_realtime ADD TABLE equipe_mensagens`
  (DO-block idempotente + assert de pós-condição, padrão da 20260728000001).
- Cliente: uma assinatura `postgres_changes` (INSERT em `equipe_mensagens`),
  sem filtro — RLS restringe a entrega às conversas do usuário. Canal nomeado
  `equipe-chat:{userId}:{workspaceId}` (convenção do canal `wm:` do
  AuthContext), derrubado/recriado na troca de workspace, cleanup via
  `supabase.removeChannel`. Guarda no handler: re-checar `conta_id`/
  `conversa_id` do payload antes de usar (mesma defesa contra bleed do
  AuthContext).
- Evento da conversa aberta → invalida `equipe-mensagens` + `equipe-conversas`
  (o padrão do repo é invalidação, não append manual em infinite query — não
  existe precedente de `setQueryData` em `pages`); de outra conversa →
  invalida só `equipe-conversas` (lista + badge).
- Polling de 60s (refetchInterval) permanece como fallback — mesmo racional do
  AuthContext (canal sem handler de status/reconexão no repo).
- Teste: o mock de canal em `lib/__mocks__/supabase.ts` só suporta um listener
  UPDATE (o do AuthProvider); precisa ser ampliado para o listener INSERT do
  chat.

### RPCs (SECURITY DEFINER, `SET search_path = public`)

| RPC | Comportamento |
|---|---|
| `get_equipe_conversas()` | Uma linha por conversa do caller: tipo, nome (para DM: nome/avatar do outro participante), última mensagem (autor + preview), `unread_count` (mensagens com `created_at > last_seen_at` do caller, excluindo as do próprio) |
| `get_equipe_mensagens(p_conversa_id, p_before, p_before_id, p_limit=50)` | Página keyset (created_at, id) com autor resolvido; valida participação |
| `create_equipe_conversa(p_tipo, p_nome, p_user_ids)` | Valida que **todo** `p_user_id` pertence a `workspace_members` do workspace do caller (senão um usuário externo entraria como participante). dm: `INSERT ... ON CONFLICT (conta_id, dm_key) DO NOTHING` seguido de SELECT — criação simultânea da mesma DM devolve a mesma linha para os dois callers, nunca erro de unicidade. grupo: exige owner/admin, cria conversa + participantes (criador incluso) |
| `manage_equipe_conversa(p_conversa_id, p_action, ...)` | `rename`/`add`/`remove` (owner/admin), `leave` (qualquer participante). Só grupos; DMs não têm gestão. `add` revalida `workspace_members` do usuário adicionado; toda escrita em participantes grava `conta_id` copiado da conversa (nunca do input) |
| `mark_equipe_conversa_seen(p_conversa_id, p_last_message_id)` | High-water mark explícito: `last_seen_message_id = GREATEST(atual, p_last_message_id)`, onde `p_last_message_id` é o maior id **renderizado** pelo cliente. Regra de reconciliação: com a conversa aberta, cada evento realtime re-marca; mensagem que comita depois do mark com id maior permanece não lida. (Evita o furo do `last_seen_at` temporal: transação que começa antes do mark e comita depois.) |
| `get_equipe_chat_unread()` | Total de não-lidas do caller (badge sidebar) |
| `get_equipe_chat_members()` | Membros do workspace do caller: user_id, nome, avatar — para picker/DM |
| `send_equipe_mensagem(p_conversa_id, p_content, p_anexo_ids)` | Caminho único de envio do composer (com ou sem anexos): insere a mensagem e liga anexos staged (valida que são do caller e da mesma conversa). A política RLS de INSERT em `equipe_mensagens` continua existindo como cinto de segurança para escrita via PostgREST, com as mesmas restrições |

Resolução de identidade (nome/avatar): `membros.crm_user_id` (como o feed
atual), com fallback para `profiles`, e por fim "Equipe".

### Notificações

- Novo tipo `team_message` no CHECK de `notifications.type` (copiar a lista da
  definição mais recente — hoje `20260815000004`, 22 valores — e acrescentar;
  padrão do repo).
- Coalescing **atômico** (duas mensagens concorrentes não podem duplicar):
  índice único parcial

  ```sql
  CREATE UNIQUE INDEX notifications_team_message_unread_uq
    ON notifications (user_id, ((metadata->>'conversa_id')))
    WHERE type = 'team_message' AND read_at IS NULL AND dismissed_at IS NULL;
  ```

  e o trigger AFTER INSERT em `equipe_mensagens` insere direto (não via
  `insert_notification_batch`, que não tem ON CONFLICT) com
  `ON CONFLICT ... DO NOTHING` sobre esse índice, para cada participante ≠
  autor. Link `/mensagens/equipe/:conversaId`; metadata com `conversa_id`
  (string), nome da conversa/autor, preview 280 chars. Corpo com
  `BEGIN/EXCEPTION WHEN OTHERS → RAISE WARNING` (padrão
  `trg_notify_client_message`): falha de notificação nunca derruba o envio.
- Ler ou dispensar a notificação a tira do índice parcial; a próxima mensagem
  volta a notificar. É a garantia "no máximo uma não lida por conversa".
- Menções: sem notificação própria na v1 (a por-mensagem já cobre); ficam como
  autocomplete + chip.

### Anexos (edge function `equipe-chat-media`)

Espelha a **`automation-media`** (o padrão mais novo e endurecido do repo,
PR #419), não a `ideia-media-manage`:

- **Auth**: service-role client + `getUser(token)`; tenant =
  `profiles.active_workspace_id` **+ membership confirmada em
  `workspace_members`** (nunca `profiles.conta_id` legado — usuário
  multi-workspace e membro removido). `verify_jwt = false` no `config.toml`
  (o handler mesmo verifica). Client com `makeBoundedFetch()`
  (`_shared/bounded-fetch.ts`) e helpers R2 "signed" (`headObjectSigned`,
  `copyObjectSigned`, `trashObject`) — nunca o transport do aws-sdk em handler
  que grava estado.
- `POST /upload-url` — valida participação na conversa, entitlement
  (`assertPlanFeature`), mime (imagens `jpeg/png/gif/webp` + `application/pdf`
  + `application/zip`, allowlist da `file-upload-url`) e tamanho (≤ 25MB);
  presigned PUT só para o prefixo **temporário**
  `equipe-chat-tmp/{conta_id}/{uuid}.{ext}`.
- `POST /finalize` — `headObjectSigned` na tmp (existe? tamanho e mime batem?)
  → `copyObjectSigned` para a key final imutável
  `equipe-chat/{conta_id}/{uuid}.{ext}` → RPC `equipe_chat_anexo_finalize`
  (uma transação: valida prefixo da key contra o conta_id server-side,
  `FOR UPDATE` na linha de `workspaces`, checa
  `effective_plan_limit('storage_quota_bytes')`, insere a linha staged e soma
  `storage_used_bytes` — padrão `ideia_file_insert_with_quota` /
  `automation_media_finalize`; `quota_exceeded` → 413) → `trashObject` na tmp.
  A URL PUT ainda válida só consegue sobrescrever a **tmp**, nunca o objeto
  final contabilizado.
- `GET`/`POST /anexos/:id/url` — valida participação via
  `is_equipe_conversa_member` (RPC) ou query equivalente; devolve presigned
  GET curto (~10min) para preview/download. Objetos são privados.

**Órfãos e corrida cleanup-vs-send** (legs novos no `post-media-cleanup-cron`):

- Tmp abandonada: `listOrphanKeys('equipe-chat-tmp/', 24h)` → `trashObject`
  em cada uma. Varredura cega é segura: finalize copia logo após o upload;
  um finalize >24h depois falha no copy e o cliente re-envia.
- Staged >24h (`mensagem_id IS NULL`): RPC `equipe_chat_anexo_release` apaga a
  linha e **estorna `storage_used_bytes` na mesma transação** (simétrico ao
  finalize), depois `trashObject` na key final. O envio liga anexos com
  `UPDATE ... SET mensagem_id = X WHERE id = ANY(p_anexo_ids) AND
  mensagem_id IS NULL AND created_by = caller AND conversa_id = p_conversa`
  e exige contagem afetada = pedida — o lock de linha serializa contra o
  release; envio que perde a corrida erra com `anexo_not_found` e o cliente
  re-envia o arquivo.
- O prefixo final `equipe-chat/` fica **fora** do orphan-scan atual (que só
  varre `contas/` contra `post_media`/`files`) — de propósito: o ciclo de
  vida dos objetos finais é inteiramente dono das linhas de anexo. Limitação
  aceita (mesmo trade da automation-media): deleção de workspace via CASCADE
  não apaga os objetos R2.

### UI (apps/crm)

- **Rotas** (App.tsx): adicionar `/mensagens/equipe/:conversaId`. O App usa
  `<Routes>` descendente (matching ranqueado — ordem de declaração não decide
  o match), e a rota nova tem 3 segmentos contra 2 de `/mensagens/:clienteId`,
  então não há colisão possível. A URL de 2 segmentos `/mensagens/equipe`
  (sem id) não existe: a troca de aba é estado local, a URL só muda ao abrir
  uma conversa. `vercel.json` já cobre `/mensagens(/.*)?` — sem mudança.
- **Lista**: `ConversationList` ganha um segmented control "Clientes | Equipe"
  no topo (tabs shadcn). Aba Clientes = comportamento atual intocado. Aba
  Equipe = conversas de `get_equipe_conversas()`, busca local, badge por
  conversa. Aba só aparece com `feature_team_chat`.
- **Nova conversa** (aba Equipe): botão abre lista de colegas
  (`get_equipe_chat_members`) → clique abre/cria DM. Para owner/admin, ação
  extra "Criar grupo": dialog com nome + multi-select de colegas.
- **Thread**: componente novo `EquipeThread` paralelo ao `ConversationThread`
  (sem reply-to-post; com menções e anexos). Composer = `MentionTextarea`
  **como está** (Enter-envia/Shift+Enter quebra, padrão do PostEditor) + botão
  de anexo; render de corpo via `MentionText`. Menções na v1 são
  **display-only**: tokens `@[Label](tipo:id)` do vocabulário existente
  (membro/post/cliente/tarefa via autocomplete atual), sem ledger
  `sync_mentions` (que exigiria estender a whitelist de host_type em 4
  definições SQL) e sem notificação própria — a notificação por mensagem já
  avisa todo participante. Anexos: imagem = thumbnail clicável (presigned GET
  sob demanda), arquivo = chip com nome/tamanho e download; upload via
  presign → PUT com progresso → finalize (reusar `probeImage`/
  `putWithProgress` de `services/postMedia`).
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
