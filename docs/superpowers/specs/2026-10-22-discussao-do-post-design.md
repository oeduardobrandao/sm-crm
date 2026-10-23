# Discussão da equipe dentro do post

Data: 2026-10-22 · Status: aguardando aprovação do documento (UI aprovada nos mockups)

Mockups aprovados: https://claude.ai/artifact/41GPU3e2Qaazsg3R72THuH (7 pranchas: desktop antes e
depois, tema escuro, celular, "Discutir no chat", o post no chat de equipe, avisos).

## Por quê

O chat de equipe (`/mensagens`, grupos e DMs) acabou de sair, mas os usuários querem conversar
sobre **um post específico** sem sair do editor, com a conversa ficando junto do post. Hoje o
editor só tem comentários presos a um trecho selecionado (`post_comment_threads`, `quoted_text`
obrigatório, `field` em `conteudo | ig_caption`), e resposta só avisa quem foi @mencionado. Não
dá para falar do post como um todo, e quem comenta não sabe se alguém viu.

A decisão (do usuário) foi **estender os comentários do post**, não embutir o chat de equipe no
editor: o chat é por participante e gateado por `feature_team_chat` (desligado na maioria dos
planos), enquanto a conversa do post precisa valer para o workspace inteiro em todo plano. Uma
ponte leva o post para o chat quando a conversa precisa de mais gente ou de outro lugar.

### Objetivos

1. Uma **Discussão da equipe** por post: um fio sem trecho, no editor (desktop e celular).
2. Os comentários em trecho aparecem como cartões nessa mesma linha do tempo.
3. **Aviso para quem participa**: quem já escreveu, quem foi mencionado e o responsável do post
   recebem notificação de cada mensagem nova (com agrupamento), e podem deixar de seguir.
4. Marcador de **não lidas** por usuário, no editor, no gatilho do post e no card do quadro.
5. **Discutir no chat**: manda uma mensagem com o post anexado para um grupo ou pessoa do chat de
   equipe, e o post aparece no chat como chip com prévia que volta para a discussão.
6. A seção do cliente passa a se chamar **Conversa com o cliente**, com o selo "O cliente vê".

### Não-objetivos

- Não muda o chat de equipe por dentro (schema, RLS, gate), só lê e envia pelas RPCs existentes.
- Não muda o Hub. Nada da discussão aparece para o cliente, nem a contagem.
- Não traz anexos de arquivo para a discussão (o post já tem mídia). Pode vir depois.
- Não exporta a discussão para o MCP (`list_post_feedback` etc.).
- Não corrige a RLS ampla de `post_comments` (qualquer membro do workspace pode editar ou apagar
  qualquer comentário, só a UI limita ao autor). É pré-existente; fica anotado como risco.
- Sem push no iOS para o tipo novo nesta entrega (o #669 só empurra os tipos que lista).

### Anti-objetivos (seria falha mesmo funcionando)

- Alguém da equipe escrever para o cliente achando que era interno, ou o contrário. Toda caixa de
  texto tem que deixar o público inequívoco (rótulo, selo e, no celular, um seletor só).
- O cliente ver qualquer coisa da discussão por qualquer caminho (Hub, e-mail, PDF, MCP).
- Uma rajada de mensagens virar uma rajada de notificações (precisa agrupar como o chat faz).
- A discussão sumir ou travar num plano sem `feature_team_chat`.
- Quebrar as notificações do chat de equipe ao redefinir a lista de tipos (ver Riscos).

## Comportamento atual (referência)

- Tabelas `post_comment_threads` (fio) e `post_comments` (mensagens), migration `20260423`, mais
  `field`/`anchor_*`/`orphaned` em `20260925000020` com a constraint
  `post_comment_threads_anchor_chk`. RLS por `conta_id` (via `get_my_conta_id()`); `post_comments`
  herda pelo fio.
- `store/comments.ts`: `getPostCommentThreads(postIds)` (select com `post_comments(*)`),
  `createCommentThread`, `addPostComment`, `updatePostComment`, `deletePostComment`,
  `resolveCommentThread`, `reopenCommentThread`, `deleteCommentThread`. Cada escrita chama
  `syncMentions('post_comment', id, membroIds)`, que alimenta `mencoes` e dispara a notificação
  `mention` (link `/entregas?drawer=<workflowId>`).
- Consumidores dos fios: `PostEditorBody` (desktop: `PostCommentSummary` "Comentários internos";
  celular: aba `comentarios` via `PhoneComments`, contagem = aprovações do cliente + fios ativos),
  `PostEditor` (marca `CommentHighlight` no TipTap), `InstagramCaptionField` (âncoras da legenda,
  `utils/captionAnchors.ts`), `HistoryDrawer` (resumo só leitura), `WorkflowDrawer` e
  `StandalonePostDrawer` (carregam com `useQuery`, sem realtime; o gatilho do post mostra
  `drawer-post-comment-badge` com o total de fios; `FluxoPhone.tsx` tem o mesmo selo no celular).
  O `data-import` não grava fios (só os protege ao desfazer uma importação).
- A conversa com o cliente no fim do post é `post_approvals` (bolhas `.approval-bubble--*`, rótulo
  "Comentários", caixa "Responder ao cliente…").
- Chat de equipe: `equipe_conversas` (`grupo | dm`), `send_equipe_mensagem(conversa, content,
  anexos)`, `create_equipe_conversa('dm', null, [user])` idempotente, mensagens renderizadas com
  `MentionText`. `PostChip` (prévia ao passar o mouse) existe em `pages/mensagens/components` e é
  usado na conversa com clientes. Token de post: `@[Título](post:<postId>:<workflowId>)`, link via
  `mentionHref` → `/entregas?drawer=<wf>&post=<id>` (ou `/entregas?post=<id>` para avulso).
- Notificações: CHECK `notifications_type_check` e `notification_inapp_prefs_type_check`, cuja
  definição mais recente está em `20261021100000_equipe_chat_core.sql` e
  `20261021103000_team_message_inapp_pref.sql`. O `team_message` agrupa com índice único parcial
  (`user_id, metadata->>'conversa_id'` onde não lida e não dispensada) e `ON CONFLICT DO NOTHING`,
  e filtra destinatários por `workspace_members` (ex-membro não recebe). Frontend: tipo em
  `store/notifications.ts`, catálogo em `lib/notification-catalog.ts`, render em
  `lib/notification-config.ts`.

## Modelo de dados

### O fio geral

- `post_comment_threads.field` ganha o valor `'geral'`. A constraint `post_comment_threads_anchor_chk`
  é recriada com um terceiro ramo: `field = 'geral'` exige `anchor_start` e `anchor_end` nulos,
  `NOT orphaned`, `quoted_text = ''` e `status = 'active'`. O CHECK de valores de `field` também.
- Um fio geral por post: índice único parcial em `post_comment_threads (post_id) WHERE field = 'geral'`.
- O fio nasce na primeira mensagem, por uma RPC (abaixo), nunca na abertura do editor.
- O fio geral não se resolve, não se reabre e não se apaga pela UI. Apagar o post apaga o fio
  (cascade existente).

### Garantias no banco (as policies de hoje não bastam)

As policies de `post_comment_threads`/`post_comments` (migration `20260423`) só olham
`conta_id` do fio: não conferem que `post_id` é do mesmo workspace, deixam qualquer membro
inserir com `author_id` de outra pessoa e deixam alterar ou apagar qualquer fio. Para o fio
geral isso vira garantia de banco, sem mudar o comportamento dos fios em trecho:

- Policy **RESTRICTIVE** de INSERT em `post_comment_threads` para `authenticated`:
  `field <> 'geral'`. O fio geral só nasce pela RPC (SECURITY DEFINER, abaixo).
- Trigger `BEFORE UPDATE` em `post_comment_threads`: proíbe mudar `field` de ou para `'geral'` e
  proíbe `status`, `post_id` ou `conta_id` diferentes num fio geral.
- Trigger `BEFORE DELETE` em `post_comment_threads`: proíbe apagar um fio geral enquanto o post
  existe. O cascade da exclusão do post precisa continuar passando (teste psql obrigatório).
- Policy **RESTRICTIVE** de INSERT em `post_comments` para `authenticated`:
  `author_id = auth.uid()` (vale para todos os fios; `createCommentThread` e `addPostComment` já
  gravam `profile.id`, que é o `auth.uid()`; o `data-import` usa service role e não é afetado).
- Policy **RESTRICTIVE** de UPDATE e DELETE em `post_comments` para mensagens do fio geral:
  `author_id = auth.uid()`. Nos fios em trecho a regra ampla de hoje fica (não-objetivo).
- Todo caminho novo (RPCs e trigger) deriva o workspace de `workflow_posts.conta_id` e exige que
  seja o workspace do chamador e que `post_comment_threads.conta_id = workflow_posts.conta_id`.

### Participantes e leitura (por post)

Participação e leitura são **por post**, não por fio: a discussão é uma linha do tempo só (fio
geral + cartões dos fios em trecho), então seguir, não lidas e avisos cobrem todos os fios do post.

Tabela nova `post_discussao_participantes`:

| coluna | |
|---|---|
| `post_id` | `bigint` FK `workflow_posts` ON DELETE CASCADE |
| `conta_id` | `uuid` FK `workspaces` ON DELETE CASCADE (copiado de `workflow_posts`) |
| `user_id` | `uuid` FK `auth.users` ON DELETE CASCADE |
| `seguindo` | `boolean NOT NULL DEFAULT true` |
| `last_seen_comment_id` | `bigint NOT NULL DEFAULT 0` (marca d'água sobre `post_comments.id` de qualquer fio do post: id, não timestamp) |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

PK `(post_id, user_id)`. RLS: o usuário lê só as próprias linhas, e só do workspace dele. Não
há INSERT/UPDATE/DELETE para `authenticated`: as linhas são escritas pelas RPCs e pelos triggers
(SECURITY DEFINER).

Quem participa de um post:
- quem escreveu em qualquer fio dele (linha criada no insert do comentário com `seguindo = true`;
  nunca reativa uma linha com `seguindo = false`);
- quem foi mencionado em qualquer fio dele, no envio **ou numa edição** que acrescente a menção
  (trigger `AFTER UPDATE OF content` em `post_comments` cria a linha; edição não gera aviso
  `post_discussion`, a menção nova já gera `mention` pelo `syncMentions` de hoje);
- o responsável do post (`workflow_posts.responsavel_id` → `membros.crm_user_id`), como
  participante implícito sem linha, até ter linha própria (o sino ou a leitura gravam a linha).

Menções: o token `@[Nome](membro:<id>)` carrega `membros.id`. A resolução é sempre: extrair o id,
juntar com `membros` do **mesmo `conta_id`** do post, usar `crm_user_id`. Token com id inválido,
de outro workspace, de membro sem login (`crm_user_id` nulo) ou de quem não está mais em
`workspace_members` é ignorado sem erro.

### RPCs

Todas SECURITY DEFINER com `search_path = public`, conferindo dentro o workspace como descrito
acima; grants no padrão do repo (`REVOKE … FROM PUBLIC, anon, authenticated, service_role`
nomeando os papéis, `GRANT EXECUTE … TO authenticated`).

- `post_discussao_enviar(p_post_id bigint, p_content text, p_thread_id bigint DEFAULT NULL)
  RETURNS post_comments`. Sem `p_thread_id`: busca ou cria o fio geral (`INSERT … ON CONFLICT` no
  índice parcial, para duas primeiras mensagens simultâneas não criarem dois fios). Com
  `p_thread_id`: resposta num fio em trecho, que precisa ser do mesmo post e estar `active`.
  Insere o comentário com `author_id = auth.uid()` e chama `sync_mentions('post_comment', id,
  membro_ids)` **na mesma transação** (se falhar, nada é gravado). Conteúdo vazio ou acima de 4000
  caracteres é erro (mesmo limite do chat).
- `post_discussao_marcar_lido(p_post_id bigint, p_comment_id bigint)`: confere que
  `p_comment_id` é de um fio deste post; upsert da linha do usuário com
  `last_seen_comment_id = GREATEST(atual, p_comment_id)` (cria com `seguindo = true` quando não há).
- `post_discussao_seguir(p_post_id bigint, p_seguir boolean)`: upsert de `seguindo`.
- `get_post_discussao_participacao(p_post_id bigint) RETURNS TABLE (seguindo boolean,
  last_seen_comment_id bigint, implicito boolean)`: o estado do próprio usuário (uma linha
  sempre; `implicito` para o responsável sem linha), para o sino e a marca de lido.
- `get_post_discussao_nao_lidas(p_post_ids bigint[] DEFAULT NULL, p_workflow_ids bigint[] DEFAULT
  NULL) RETURNS TABLE (post_id bigint, workflow_id bigint, total int, nao_lidas int)` (por post ou
  por fluxo, porque o quadro conhece os fluxos e não os ids dos posts; só linhas com `total > 0`):
  por post do workspace do chamador, `total` = comentários de **qualquer fio**
  do post; `nao_lidas` = desses, os com `id > last_seen_comment_id` e autor diferente do usuário,
  **só para participantes que seguem** (linha com `seguindo = true`, ou o responsável implícito
  sem linha, com marca 0). Para quem não participa ou deixou de seguir, `nao_lidas = 0`. Decisão
  do usuário: não lidas existem só para participantes; os demais veem o total sem ponto. Usada
  pelo drawer, pela aba do celular e pelo quadro.

No frontend, `addPostComment` (respostas em trecho) e o envio do fio geral passam a usar
`post_discussao_enviar`. `createCommentThread` (novo fio em trecho, primeira mensagem) continua
como está: o fio é novo, então o único participante possível além do autor é o responsável, e o
aviso dele não depende de menção. Editar e apagar a própria mensagem seguem com
`updatePostComment`/`deletePostComment`.

## Notificações

Tipo novo **`post_discussion`**, um por (usuário, post) enquanto não lido.

- Trigger `AFTER INSERT ON post_comments`, SECURITY DEFINER, embrulhado em `BEGIN … EXCEPTION WHEN
  OTHERS THEN RAISE WARNING` como o `trg_notify_team_message` (falha de aviso nunca derruba o
  envio). Ele também cria as linhas de participante do autor e dos mencionados. Só age quando
  `auth.uid()` não é nulo (inserções por service role, como o `data-import`, não avisam ninguém) e
  quando `post_comment_threads.conta_id = workflow_posts.conta_id`.
- Destinatários: participantes do post com `seguindo = true` (mais o responsável implícito),
  menos o autor, menos quem é **mencionado nesta mensagem**, e só quem ainda está em
  `workspace_members` do `conta_id` (mesmo filtro que `20261021103000` pôs no chat). Tirar os
  mencionados é seguro porque toda mensagem que avisa outras pessoas passa por
  `post_discussao_enviar`, que roda `sync_mentions` na mesma transação: ou a menção (e o aviso
  `mention`) existe, ou nada foi gravado. A exceção é a primeira mensagem de um fio em trecho
  novo (`createCommentThread`, `syncMentions` depois e fora da transação): ali a trigger **não**
  tira os mencionados, e um mencionado pode receber os dois avisos. Aceito.
- Agrupamento: índice único parcial `notifications (user_id, (metadata->>'post_id')) WHERE type =
  'post_discussion' AND read_at IS NULL AND dismissed_at IS NULL`, e `ON CONFLICT DO UPDATE` que
  atualiza `metadata` (último autor, prévia, `count + 1`, lista curta de autores) e `created_at`,
  para o cartão dizer "Carla Mendes e mais 1 pessoa escreveram na discussão de …", "3 mensagens".
  O chat usa `DO NOTHING`; aqui o `DO UPDATE` é o que dá o texto agrupado do mockup.
- `metadata`: `post_id`, `workflow_id`, `post_titulo`, `thread_field` (`geral` ou o do trecho),
  `quoted_text` quando for trecho, `author_name`, `authors` (até 3 nomes), `count`, `preview`
  (com os tokens de menção trocados por `@Nome` antes do `left(…, 280)`, como em `20261021103000`).
- `link`: `/entregas?drawer=<workflowId>&post=<postId>&discussao=1`, ou `/entregas?post=<postId>&discussao=1`
  para avulso.
- Respostas em fio de trecho geram o mesmo tipo (o cartão diz "respondeu no trecho “…”"); o
  agrupamento é por post, então trecho e geral do mesmo post viram um cartão só.
- Abrir a discussão (marcar lido) não marca a notificação como lida; a notificação segue o fluxo
  normal da Central. **Escolha deixada ao builder** se marcar lido na discussão também dispensa a
  notificação do post.

Link da menção: como quem é mencionado recebe só `mention`, o ramo `post_comment` de
`trg_notify_mention` (definição mais recente em `20260830000003`; confira se não há outra depois)
passa a apontar para `/entregas?drawer=<wf>&post=<postId>&discussao=1` (ou `/entregas?post=<postId>&discussao=1`
para avulso), em vez de só `?drawer=<wf>`. Mesma migration da trigger de aviso (passo 3 do rollout).

Participantes de fios antigos: a migration da trigger faz um backfill único em
`post_discussao_participantes` com os autores de comentários de fios em trecho **ativos**, por
post (`seguindo = true`, `last_seen_comment_id` = maior id atual do post, para nada antigo contar
como não lido). Fios resolvidos não entram.

Listas que precisam do tipo novo, copiando da definição mais recente e só acrescentando
`'post_discussion'`:
1. `notifications_type_check` (base: `20261021100000_equipe_chat_core.sql`).
2. `notification_inapp_prefs_type_check` (base: `20261021103000_team_message_inapp_pref.sql`,
   inclui `'__all__'`).
3. Frontend: `NotificationType` em `store/notifications.ts`, entrada em `lib/notification-catalog.ts`
   (categoria `equipe`, rótulo "Mensagem na discussão de um post", `emailEligible: false`), caso
   em `lib/notification-config.ts` (ícone de mensagens, título com o post, corpo com a prévia).

Antes de escrever a migration, procure de novo em `supabase/migrations` a definição mais recente
das duas constraints: se outra branch (o #669 de push, por exemplo) tiver entrado antes, copie
dela, mantendo `team_message`.

## Interface (conforme os mockups)

### Desktop (post expandido no drawer do fluxo e no drawer de post avulso)

Ordem no fim do `PostEditorBody`: … Agendar, automação, **Discussão da equipe**, **Conversa com
o cliente**.

- **Discussão da equipe** substitui o `PostCommentSummary` "Comentários internos". Painel
  `surface-1` com borda e raio 12px. Cabeçalho: ícone de mensagens, título "Discussão da equipe",
  selo neutro com cadeado "Só a equipe vê", à direita o botão fantasma do sino ("Seguindo" /
  "Seguir") e o botão contornado "Discutir no chat" (só com `feature_team_chat === true` ou
  workspace ilimitado; fail-closed como no `ProtectedRoute`).
- Linha do tempo única, em ordem de criação: mensagens do fio geral como linhas (avatar, nome,
  hora, texto com `MentionText`), sem bolhas; e cada fio em trecho **ativo** como cartão na hora
  em que foi criado: "<autor> comentou no trecho · hora", a citação com barra amarela, a primeira
  mensagem e "N respostas", e "Ver no texto" à direita. Clicar no cartão reaproveita o
  `onThreadClick` de hoje (legenda do Instagram: troca de aba e `focusThread`; conteúdo TipTap:
  foca a marca). Fios resolvidos ficam numa linha recolhida no fim: "N comentários no texto
  resolvidos", que expande os cartões.
- Divisores de dia ("Ontem", "Hoje", data) e o divisor amarelo "Não lidas" antes da primeira
  mensagem do fio geral com id acima da marca do usuário, calculado ao abrir e mantido enquanto o
  post está aberto. Cartão de fio em trecho com resposta acima da marca mostra "N novas" no lugar
  de "N respostas" (as não lidas contam todos os fios do post).
- Mensagens próprias: editar e apagar no menu da linha (mesma UX do comentário de hoje; apagar
  pede confirmação "Excluir mensagem?").
- Caixa: o `MentionEditor` de hoje, placeholder "Escreva para a equipe. Use @ para mencionar.",
  botão Enviar (tinta), Enter envia e Shift+Enter quebra linha, com guarda de IME
  (`isComposing`). Abaixo, em texto pequeno: "Quem participa da discussão recebe aviso. Enter
  envia, Shift+Enter quebra a linha."
- Rascunho não enviado ou envio em voo registra `useUnsavedWork` (o drawer não é modal com
  `confirmClose`).
- **Conversa com o cliente**: o bloco de `post_approvals` atual, com o rótulo trocado de
  "Comentários" para "Conversa com o cliente", ícone de olho e selo info "O cliente vê". Bolhas e
  caixa "Responder ao cliente…" sem mudança.
- Gatilho do post (`drawer-post-comment-badge`): passa a mostrar o ícone de mensagens com o número
  de **não lidas** do post e um ponto amarelo quando > 0; com zero não lidas (o que inclui todo
  não participante) mostra o total de mensagens da discussão sem ponto; sem discussão e sem fios,
  nada. O divisor "Não lidas" e o "N novas" dos cartões também só aparecem para participantes que
  seguem.
- Tema escuro: só tokens, nada fixo além do amarelo de destaque já usado em `CommentHighlight`.

### Celular (`PhoneComments`, aba Comentários)

- A aba conta **não lidas** da discussão + `approvals.length` (a parte do cliente fica como hoje,
  `PostEditorBody.tsx` `commentCount`), e não mais fios ativos.
- Dentro da aba, dois botões em pílula: "Equipe · N novas" (cadeado) e "Cliente" (olho). Abre em
  Equipe quando há não lidas da equipe, senão em Cliente quando a `post_approvals` mais recente é
  do cliente (não da equipe), senão em Equipe.
- Equipe: linha "Só a equipe vê esta conversa." com sino e "Discutir no chat" como botões de
  ícone de 40px com `aria-label`; a mesma linha do tempo do desktop; caixa fixa embaixo com
  placeholder "Mensagem para a equipe".
- Cliente: o conteúdo atual da aba para o cliente, com a caixa "Responder ao cliente…" fixa
  embaixo. **Só uma caixa visível por vez**: é a garantia contra mandar para o público errado.
- Painéis sempre montados e só escondidos (regra do `PhoneEditorTabs`).

### Discutir no chat

- Popover (desktop) ou sheet (celular) ancorado no botão, título "Levar este post para o chat",
  subtítulo "A mensagem vai com um link para o post."
- Busca "Buscar conversa ou pessoa"; lista com **Grupos** (conversas `grupo` em que o usuário
  participa, com número de pessoas) e **Pessoas** (colegas do workspace; DM existente ou não,
  como a aba Equipe do `/mensagens` já faz). Seleção única com check.
- Campo "Mensagem para <nome>" (opcional) e, abaixo, o chip do post (não removível).
- "Cancelar" e "Enviar para <nome>". Enviar: para pessoa sem DM, `create_equipe_conversa('dm',
  null, [user])`; depois `send_equipe_mensagem(conversa, conteúdo)` com conteúdo
  `<mensagem>\n@[<título do post>](post:<postId>:<workflowId>)` (sem o `:<workflowId>` quando avulso).
- Sucesso: toast `sonner` "Enviado para <nome>." com ação "Abrir conversa"
  (`/mensagens/equipe/<id>`), e o usuário fica no editor. Erro: toast "Não foi possível enviar.
  Tente novamente." e o popover continua aberto com o texto.
- Nada é gravado na discussão do post por causa do envio. **Escolha deixada ao builder** se vale
  uma linha de sistema "Levado para o chat: Design" na discussão.

### No chat de equipe

- O texto da mensagem continua passando por `MentionText` (toda menção, de post também, segue
  como `MentionChip` inline, sem mudar o contrato do componente). **Abaixo** do texto, cada post
  distinto mencionado na mensagem ganha um `PostChip` em bloco (até 3; acima disso, só os chips
  inline), com a prévia ao passar o mouse que já existe (capa, tipo, status, fluxo), mais "N
  mensagens na discussão" quando houver, e o link "Abrir na discussão do post" com `&discussao=1`.
  Mensagem que é só o token do post mostra só o bloco (o chip inline some quando o texto, sem o
  token, fica vazio).
- Vale no `EquipeThread` do desktop e no `EquipeThreadPhone` (no celular, o toque continua
  abrindo o post; segurar o chip mostra a prévia e o menu traz "Abrir na discussão do post"). Sem mudança no armazenamento.

### Deep link `&discussao=1`

`/entregas` já abre drawer e post por `?drawer=`/`?post=`. Com `discussao=1`, depois de expandir o
post, rola até a seção Discussão da equipe (no celular: abre a aba Comentários em Equipe) e foca a
caixa sem abrir teclado no celular. O parâmetro sai da URL depois de usado, como os outros.

### Avisos e quadro

- Central de notificações: cartões do `post_discussion` como no mockup; clicar segue o `link`.
- Quadro de Entregas: card de fluxo com selo de ícone de mensagens e a **soma de não lidas** dos
  posts do fluxo; card de post (filtro "Posts" e posts avulsos) com as não lidas do próprio post.
  Só quando > 0. `get_post_discussao_nao_lidas` em lote para os posts visíveis, uma chamada por
  carga do quadro, não por card. O selo `drawer-post-comment-badge` do `FluxoPhone` segue a mesma
  regra do gatilho do desktop.
- `HistoryDrawer`: mostra a discussão geral em modo só leitura junto do resumo de hoje.

### Tempo real

Enquanto um post está expandido, assina `postgres_changes` de `post_comment_threads` com filtro
`post_id=eq.<id>` e de `post_comments` com filtro `thread_id=in.(<ids dos fios carregados do
post>)`, refazendo a segunda assinatura quando o conjunto de fios muda; qualquer evento invalida
a query dos fios. As duas tabelas entram na publicação `supabase_realtime` com o mesmo bloco
idempotente + verificação usado para `equipe_mensagens` em `20261021100000`. Também refaz a busca
ao focar a janela. Sem `REPLICA IDENTITY FULL` (mesma escolha do `AuthContext`): um DELETE não
casa com o filtro de coluna, então a mensagem apagada por outra pessoa some no próximo refetch
(foco da janela ou qualquer outro evento). Aceito. A marca de lido avança quando a seção está visível na tela
(IntersectionObserver), com debounce, e nunca para trás.

## Riscos e armadilhas

- **Lista de tipos de notificação**: redefinir a constraint sem `team_message` quebra o chat em
  silêncio (a trigger engole o erro). Teste psql que insere um `team_message` e um
  `post_discussion` depois da migration.
- **`quoted_text NOT NULL`**: o fio geral usa `''`. Todo código que lista fios tem que filtrar
  `field = 'geral'` onde só quer trechos: `CommentHighlight`/sincronização de marcas no TipTap,
  `captionAnchors.ts` (já filtra `ig_caption`), contagens do celular e do gatilho e `HistoryDrawer`.
- **RLS ampla de `post_comments`** (não-objetivo): a UI só oferece editar e apagar a própria
  mensagem.
- Migrations com versão acima da cauda do main no momento do PR (hoje `20261024000010`); renumerar
  antes do `gh pr create` se outra entrar antes.

## Rollout

Duas migrations, aplicadas em momentos diferentes, porque a trigger de aviso passaria a valer
para comentários em trecho criados pelo frontend antigo (avisos de um tipo que ele não sabe
mostrar, com um deep link que ele ignora):

1. **Antes do merge** (staging, depois prod): schema, garantias, tabela de participantes, RPCs,
   realtime e as duas listas de tipos com `post_discussion`. Inofensivo para o frontend atual:
   nada nele cria fio geral, e a nova policy de `author_id` bate com o que ele já grava.
2. **Merge** (Vercel). Sem edge function nova. Sem flag: a discussão vale para todos os planos; o
   botão "Discutir no chat" depende de `feature_team_chat`.
3. **Logo depois do deploy**: a migration da trigger `post_discussion` (e da trigger de
   participante na edição).

Rollback: reverter o frontend e dropar as triggers de aviso basta para parar tudo. Restaurar a
constraint antiga de `field` só depois de apagar os fios `geral` (e suas mensagens), senão a
recriação falha.

Ordem de entrega no plano: a ponte para o chat (popover, DM, `PostChip` no chat) é a última fase
e pode ir num PR próprio depois da discussão, sem mudar o desenho.

## Decisões deixadas ao builder

- Se marcar a discussão como lida também dispensa a notificação `post_discussion` daquele post.
- Linha de sistema na discussão ao levar o post para o chat.
- Detalhe visual do menu de editar/apagar mensagem e do estado vazio da discussão (sugestão:
  só a caixa, com o placeholder, sem texto extra).
- Paginação: carregar tudo do fio geral é aceitável até ~200 mensagens; acima disso, o builder
  decide entre limitar a primeira carga ou paginar.

## Calls feitos por Claude (não confirmados explicitamente pelo usuário)

- Fio geral como linha de `post_comment_threads` com `field = 'geral'` e `quoted_text = ''`, em vez
  de tornar `quoted_text` anulável (menos consumidores mexidos).
- Participantes: autores, mencionados e o responsável do post; sino para seguir ou deixar de seguir.
- Participação, leitura e não lidas por **post** (todos os fios), não por fio.
- Mencionado numa mensagem recebe só `mention`, não `post_discussion`, por aquela mensagem
  (exceto na primeira mensagem de um fio em trecho novo).
- Respostas em fios de trecho também avisam os participantes do post (tipo `post_discussion`).
- Respostas em trecho passam pela RPC nova; `createCommentThread` fica como está.
- Link da notificação `mention` de comentário passa a abrir o post na discussão.
- Backfill de participantes só com autores de fios em trecho ativos, marca de lido no máximo atual.
- Card de post no quadro também ganha o selo, não só o card de fluxo.
- Exclusão de mensagem por outra pessoa aparece no próximo refetch (sem `REPLICA IDENTITY FULL`).
- Endurecimento do banco: `author_id = auth.uid()` no INSERT de todo comentário; editar e apagar
  mensagem do fio geral só pelo autor.
- Agrupamento por (usuário, post) com `DO UPDATE` para o texto "e mais N pessoas".
- Aba Comentários do celular e selo do gatilho contam não lidas, não total.
- Card do quadro soma as não lidas dos posts do fluxo.
- Deep link `&discussao=1`.
- Fios em trecho resolvidos recolhidos no fim da linha do tempo.
- "Discutir no chat" escondido sem `feature_team_chat`; a discussão em si sem gate.

## Verificação

- psql (`supabase/tests/entitlements` ou suíte nova no mesmo runner): constraint aceita `geral`
  só no formato certo; segundo fio geral do mesmo post falha; `post_discussao_enviar` concorrente
  cria um fio; `post_discussao_enviar` com post de outro workspace falha; `authenticated` não
  cria fio geral direto, não troca `field`, não resolve nem apaga o fio geral, não insere
  comentário com `author_id` alheio; apagar o post ainda apaga o fio geral (cascade);
  `marcar_lido` com comentário de outro post falha; RLS de `post_discussao_participantes` (outro
  usuário e outro workspace não leem); trigger: destinatários certos (autor fora, mencionado
  fora, `seguindo = false` fora, ex-membro fora, responsável dentro, insert por service role não
  avisa), agrupamento conta 2 mensagens num cartão; edição com menção nova cria participante sem
  aviso `post_discussion`; `team_message` ainda insere.
- Vitest: linha do tempo intercalando mensagens e cartões, divisor "Não lidas", seletor
  Equipe/Cliente com uma caixa só, popover da ponte (DM nova chama `create_equipe_conversa`),
  botão escondido sem a flag, `MentionText`/`PostChip` no chat, deep link com `discussao=1`.
- Navegador (desktop e 375px, claro e escuro): enviar, receber por realtime em outra aba, marcar
  lido, ponte até o chat e volta pelo chip.
