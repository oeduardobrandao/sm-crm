# Central de Notificações — design

**Data:** 2026-09-02 · **Status:** aprovado (brainstorm + mockups no visual companion)

## Objetivo

Dar ao usuário do CRM clareza total sobre **tudo** que gera notificação — in-app e
e-mail, para a equipe e para os clientes finais (incluindo relatórios) — e controle
onde couber. Hoje essa informação está fragmentada: 22 tipos in-app sem nenhuma
preferência, 8 tipos com opt-out de e-mail numa aba própria, transacionais invisíveis,
e os toggles de relatório do cliente espalhados em duas telas. Aprovações, mensagens e
briefing nunca geram e-mail para o cliente final (gap conhecido, adiado na spec
2026-08-13).

## Escopo e fases

**Fase 1 — a Central (PR 1):** a rota `/configuracao/notificacoes` vira a "Central de
notificações": catálogo completo dirigido por um registry único, preferências in-app
por tipo (novas), preferências de e-mail existentes, transparência dos transacionais e
a seção "Seus clientes" com o relatório mensal. Inclui tornar `post_approved` o 9º
tipo elegível ao digest de e-mail do usuário.

**Fase 2 — Pendências do Hub (PR 2):** o caminho outbound novo de e-mail para o
cliente final (posts aguardando aprovação + mensagens não lidas), em digest por
cliente, controlado pela central.

**Non-goals:** página de inbox ("Ver todas" continua desabilitado), realtime no sino,
central in-app no Hub, e-mails de briefing/ideias para o cliente, preferências por
workspace (as de usuário seguem individuais).

## UI (validada em mockup)

Página com 3 seções, substituindo o conteúdo de
`apps/crm/src/pages/configuracao/tabs/NotificacoesTab.tsx`:

### 1. "Suas notificações" (todos os papéis)

Matriz com duas colunas de toggle — **No app** e **E-mail** — e os 22 tipos agrupados
por categoria (Aprovações e Hub · Entregas e fluxo · Equipe · Integrações · Sistema).
Cada linha traz nome, "Quando: …" e "Quem recebe: …". Tipos não elegíveis a e-mail
mostram "—" com tooltip. Linha mestre "Pausar tudo" por canal no topo (`__all__`).
Preferência é individual (por usuário), como hoje.

### 2. "E-mails automáticos" (todos os papéis, somente leitura + marketing)

Lista de transparência: convite para a equipe, cobrança/dunning, Instagram conectado —
marcados "sempre" (transacionais, sem opt-out), cada um com "Quando"/"Quem recebe".
Marketing ("Novidades e dicas do Mesaas") aparece com o mesmo toggle
`profiles.marketing_opt_in` que existe no Perfil (mesmo dado, duas portas).

### 3. "Seus clientes" (apenas owner/admin)

Matriz **cliente × tipo de e-mail**: uma linha por cliente (nome + e-mail), uma coluna
por tipo — "Relatório mensal" (Fase 1) e "Pendências do Hub" (coluna só aparece na
Fase 2; nada de toggle morto). Linha mestre "Todos os clientes" = interruptor geral do
workspace por coluna. Campo de busca acima da lista. Estados por célula: toggle
normal; "—" quando o cliente não tem e-mail (instrução no rodapé); nota âmbar
"desativado pelo cliente" quando houve descadastro (Fase 2). Os toggles de relatório
são os mesmos dados de `workspaces.send_report_email` / `clientes.send_report_email` —
as telas atuais (RelatoriosTab do workspace e do cliente) continuam funcionando.

### Registry

`apps/crm/src/lib/notification-catalog.ts` (novo) estende `notification-config.ts`:
para cada tipo, categoria, frase de gatilho, frase de destinatários e canais
disponíveis. Fonte única para a central; o popover do sino continua usando
`getNotificationDisplay`. Teste de exaustividade: o catálogo cobre exatamente o union
`NotificationType` (22 tipos) — um tipo novo sem entrada no catálogo quebra o build/teste.

## Fase 1 — backend

**Uma migration**, com **duas tabelas de preferência** — canais fisicamente
separados, porque nenhuma variação de tabela única sobrevive ao rollout: o bundle
antigo do CRM upserta `notification_email_prefs` com `onConflict: 'user_id,type'` e a
tabela tem PRIMARY KEY `(user_id, type)` — trocar a chave para três colunas quebra
esse upsert, e o `SELECT type, enabled` antigo passaria a misturar linhas de e-mail e
in-app. Então:

- **`notification_email_prefs` fica intocada em estrutura** (PK, RLS, colunas). As
  únicas mudanças são aditivas e compatíveis com bundle antigo: `post_approved` entra
  no CHECK de `type` e na lista de elegíveis do `claim_notification_emails` (8 → 9).
- **Nova `notification_inapp_prefs`** `(user_id, type, enabled, updated_at)`, PK
  `(user_id, type)`, CHECK de `type` com os 22 tipos + `__all__`, RLS
  `user_id = auth.uid()` no mesmo shape da irmã (override-only: sem linha = ON).
- **[P0] Endurecer a RLS de `notifications`:** as policies de SELECT e UPDATE hoje
  exigem apenas `user_id = auth.uid()` — um ex-membro removido do workspace continua
  lendo notificações antigas com nomes, títulos e comentários de cliente. Ambas ganham
  `AND EXISTS (… workspace_members vigente para notifications.workspace_id …)`, com
  teste psql de membro removido (o claim de e-mail já re-checa vínculo; o in-app não
  checava).
- Atenção às armadilhas conhecidas: nenhum `REVOKE ... FROM PUBLIC` sem re-grant de
  `service_role`; prefixo de versão único re-verificado na abertura do PR.

**Digest (edge function `notification-email-cron`):** `resolveDigestItem` em
`_shared/notification-email.ts` ganha copy para `post_approved` ("boa notícia",
ordenado por último, depois de `mention`). Redeploy da função faz parte do rollout.
Contract change: atualizar os testes existentes das duas suítes (vitest + deno) que
fixam a lista de 8 tipos.

**Mute in-app = filtro de leitura, não de escrita.** Os ~15 triggers continuam
inserindo; `getNotifications` e `getUnreadNotificationCount` em
`apps/crm/src/store/notifications.ts` passam a excluir tipos silenciados
(`.not('type','in',(…))` construído a partir das prefs; `__all__` in-app = lista
vazia). Reversível — reativou, o histórico reaparece. Prefs entram no cache TanStack
(query própria, `staleTime` alto, invalidada ao salvar) e são pré-condição das queries
do sino. Mute in-app não afeta e-mail; canais independentes.

**`markAllNotificationsAsRead` recebe o mesmo filtro.** Hoje ela marca TODAS as não
lidas — como o claim de e-mail exclui linhas lidas, "marcar todas" silenciaria o
digest de um tipo que o usuário mutou só no app. A mutation passa a excluir os tipos
mutados in-app (e vira no-op sob `__all__`), com teste explícito de independência
entre canais. `dismiss` individual só alcança linhas visíveis e não muda.

**Store:** `notificationPrefs.ts` ganha leitura/escrita por canal contra as duas
tabelas (funções de e-mail existentes intocadas); export `EMAIL_NOTIFICATION_TYPES`
vira parte do catálogo (9 tipos) e nasce `INAPP_NOTIFICATION_TYPES` (22).

## Fase 2 — Pendências do Hub

**Digest de estado, sem tabela de fila.** Cron novo `client-event-email-cron`
(15 min, `x-cron-secret`, `verify_jwt=false` no config.toml) varre clientes elegíveis
e monta o e-mail com o que está pendente **agora**:

- **Aprovações:** posts que entraram em `enviado_cliente` dentro da janela do claim
  (`post_status_events.to_status = 'enviado_cliente'`, `created_at` na janela) **e que
  ainda estão** nesse status canônico no momento do envio (status custom mapeiam via
  `behaves_as`; o canônico é a verdade, mantido pelo trigger z1). **Deduplicado por
  post** (`DISTINCT ON (post_id)`, transição mais recente) — um post pode entrar,
  sair e reentrar no status dentro da mesma janela e deve aparecer uma vez só.
- **Mensagens:** linhas de `mensagens` com `is_workspace_user = true`, `created_at`
  na janela e ainda não vistas pelo cliente (marcador `mensagens_last_seen` com
  `cliente_id`).
- **Janela de conteúdo = `(limite_inferior, claim_through]`**, onde
  `limite_inferior = GREATEST(event_cursor_at, now() - 72h)` — o horizonte de 72 h
  vale **sempre**, não só no primeiro envio: cursor NULL, workspace recém-ligado ou
  religado depois de meses, o digest cobre no máximo as últimas 72 h (o backlog
  completo mora no próprio Hub). O teto `claim_through` é fixado no claim (ver
  protocolo abaixo) — conteúdo inserido depois dele cai na próxima janela em vez de
  se perder atrás do cursor.

**Colunas novas:**

- `workspaces.send_client_event_emails boolean NOT NULL DEFAULT false` — geral OFF
  (opt-in por workspace; nenhum cliente de agência atual recebe e-mail novo sem ação
  explícita do dono).
- `clientes.send_event_email boolean NOT NULL DEFAULT true` — ligou o workspace,
  todos os clientes com e-mail entram; desliga-se pontualmente.
- `clientes.event_cursor_at timestamptz` — **cursor entregue**: limite superior do
  último digest enviado com sucesso; também baseia o cooldown de 4 h.
- `clientes.event_claim_through timestamptz` + `clientes.event_claimed_at
  timestamptz` — **lease do claim** em voo (ver protocolo abaixo).
- `clientes.event_email_unsub_at timestamptz` — carimbo do descadastro do cliente.
- Lembrete da armadilha de allowlist: os toggles/estados lidos pelo CRM entram no
  GRANT de colunas de `clientes`, em `clientes_v` e em `CLIENTE_SAFE_COLUMNS`
  (singular, `store/clients.ts:59`).

**Guarda de papel no banco (não só na UI).** A policy `clientes_update` atual permite
UPDATE a qualquer membro ativo do tenant (só checa `conta_id`) — sem guarda extra, um
`agent` ligaria e-mails de cliente ou limparia `event_email_unsub_at` via PostgREST. E
GRANT de UPDATE por coluna não fecha o buraco de INSERT: um `agent` poderia criar o
cliente já com os campos preenchidos — armadilha que o próprio repo documenta e
resolve em `guard_cliente_foto` (`20260817000001`, POST-REVIEW FIX #1) e
`guard_financial_write`. Portanto:

- **Trigger `BEFORE INSERT OR UPDATE`** em `clientes` (shape do `guard_cliente_foto`:
  branch em `TG_OP`, SECURITY DEFINER, checagem de papel determinística) guardando
  `send_event_email`, `event_email_unsub_at`, **`send_report_email`** (a matriz é
  owner/admin — o campo antigo entra na mesma guarda) e as colunas de cursor/lease
  (`event_cursor_at`, `event_claim_through`, `event_claimed_at` — só o service role
  escreve). O trigger isenta service role (unsub e cron escrevem por ele).
- Escritas legítimas via RPCs `SECURITY DEFINER` owner/admin + tenant (padrão
  `set_membro_crm_user`): toggles por cliente, o toggle
  `workspaces.send_client_event_emails` (inclusive a linha mestre "Todos os
  clientes") e o religar pós-descadastro — único caminho que limpa
  `event_email_unsub_at`.
- **As telas antigas migram para os RPCs**: o toggle de relatório por cliente
  (`cliente-detalhe/tabs/RelatoriosTab.tsx`) e o do workspace
  (`configuracao/tabs/RelatoriosTab.tsx`) passam a escrever pelo mesmo caminho
  guardado que a central.

**Gates (todos):** toggle do workspace + toggle do cliente + **`clientes.status =
'ativo'`** (encerrar um cliente não desativa o token do Hub — sem esse gate, um
cliente encerrado com token válido receberia o outbound novo; pausado também fica de
fora) + e-mail preenchido + cooldown de 4 h sobre `event_cursor_at` + conteúdo
pendente não vazio + **Hub acessível**: o workspace precisa de `feature_hub_portal`
(seleção de candidatos) e `resolveHubUrl` precisa devolver URL não vazia no envio
(token do Hub ativo e não expirado) — sem destino utilizável, o cliente é pulado sem
claim e sem avançar o cursor (um e-mail de "pendências do Hub" sem Hub acessível
seria inacionável).

**Protocolo de claim: cursor entregue separado de lease.** O desenho ingênuo
("avança cursor para `now()` no claim, reseta no catch") perde eventos de dois
jeitos: conteúdo inserido entre a leitura e o claim fica atrás do cursor novo e nunca
mais é buscado; e se o runtime morrer entre o claim e o envio, o catch não roda e o
digest some para sempre. Em vez disso:

1. **Claim (RPC `claim_client_event_emails`)**: para clientes elegíveis (gates
   re-checados dentro do RPC, honrando opt-out tardio) **sem lease vigente**
   (`event_claimed_at IS NULL OR < now() - 30 min`), seta
   `event_claim_through = now()`, `event_claimed_at = now()` — `FOR UPDATE SKIP
   LOCKED`, `RETURNING id, event_cursor_at, event_claim_through`. ACL: somente
   `service_role` (com re-grant explícito).
2. **Leitura**: janela fixa `(GREATEST(event_cursor_at, now()-72h),
   event_claim_through]` — o teto veio do claim, então inserts posteriores caem na
   próxima janela em vez de se perderem.
3. **Sucesso**: `event_cursor_at = event_claim_through`, lease limpo.
4. **Falha tratada**: lease limpo, cursor intacto — retry no próximo tick.
5. **Crash**: o lease expira em 30 min e o próximo run re-claima a MESMA janela —
   at-least-once de verdade. O `Idempotency-Key` do Resend — SHA-1 de `cliente_id` +
   itens como identidades compostas ordenadas (`pse:<post_status_event_id>`,
   `msg:<mensagem_id>`; ids de sequências independentes colidiriam sem prefixo) —
   dedupa o reenvio caso o e-mail tenha saído antes do crash.

**E-mail:** builder `_shared/client-event-email.ts` reutilizando a infra do e-mail de
relatório — remetente whitelabel `${workspace.name} <notificacoes@mesaas.com.br>`, cor
e logo da marca, botão para o Hub via `resolveHubUrl`. Conteúdo: lista dos posts
aguardando aprovação (título/tipo) + contagem de mensagens não lidas. Assunto:
"Você tem pendências com {agência}". Auditoria via `insertAuditLog`
(`client_event_email_sent`). Timeouts (`AbortSignal.timeout`) em todo I/O e
`reportCronFailure` no catch, como os demais crons.

**Descadastro:** rodapé com link para edge function nova `client-email-unsub`
(`verify_jwt=false`): token = HMAC-SHA256 de `cliente_id` com
`TOKEN_ENCRYPTION_KEY` (sem segredo novo, sem token armazenado), comparação em tempo
constante. **GET não muta** — scanners de link, antivírus e gateways de e-mail seguem
GETs antes do destinatário e descadastrariam involuntariamente. O GET valida o token
e mostra uma página de confirmação com botão; o **POST** executa a mutação
(`send_event_email = false` + `event_email_unsub_at = now()` + audit log) e mostra a
confirmação. O e-mail também traz os headers `List-Unsubscribe` +
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), cujo one-click dos
provedores já é POST no mesmo endpoint. **Replay é idempotente por design**: o token
determinístico não tem expiração, nonce nem estado consumido — reapresentá-lo apenas
re-executa o descadastro (inócuo); token inválido responde página de erro genérica.
Rotacionar `TOKEN_ENCRYPTION_KEY` invalida links antigos, que degradam para essa
página de erro. Na central, a célula mostra "desativado pelo cliente"; religar exige
diálogo de confirmação explícita e limpa `event_email_unsub_at` (via RPC
owner/admin).

## Erros e casos-limite

- Prefs indisponíveis (query falhou): sino se comporta como hoje (sem filtro) — falha
  aberta para leitura, nunca esconde por engano um erro de rede como "tudo mutado".
- Tipo desconhecido vindo do banco: catálogo tem fallback (mesmo padrão do
  `default:` do `notification-config.ts`).
- Cliente sem `mensagens_last_seen`: trata como "nada visto" (todas as mensagens do
  período contam).
- Workspace desliga o geral com digests já claimados: o claim re-checa gates; corrida
  residual de segundos é aceitável.

## Testes

- **Vitest:** exaustividade do catálogo vs `NotificationType`; central (render por
  papel, toggles, master `__all__`, matriz de clientes com os 4 estados de célula);
  filtro de leitura no store (mutado some da lista e do contador; falha de prefs =
  sem filtro); `markAllNotificationsAsRead` filtrada (não marca tipos mutados;
  no-op sob `__all__` — teste de independência entre canais); prefs store por canal
  contra as duas tabelas.
- **Deno:** `client-event-email-cron` (gates incl. Hub inacessível e
  `status = 'ativo'`, janela `(cursor, claim_through]`, `GREATEST(…, now()-72h)`
  sempre aplicado, lease expirado re-entrega a mesma janela, dedupe por post,
  idempotency key com identidades compostas); builder do e-mail (headers RFC 8058);
  `client-email-unsub` (GET não muta, POST muta, token válido / inválido / replay
  idempotente); update dos testes do digest para o 9º tipo.
- **psql (entitlements):** **membro removido não lê nem atualiza `notifications`**
  (P0); RLS da `notification_inapp_prefs`; ACLs dos claim RPCs (somente
  `service_role`); gates do `claim_client_event_emails` incl. lease; guarda de papel
  em `clientes` cobrindo **INSERT e UPDATE** e também `send_report_email` e as
  colunas de cursor/lease (agent não escreve nem cria com valor; owner/admin escreve
  via RPC; service role passa).

## Rollout

- **Fase 1:** deploy da função `notification-email-cron` primeiro, depois
  `db push` (ordem do padrão da casa); Vercel automático no merge. Sem rota nova no
  `vercel.json` (`/configuracao` já listada).
- **Fase 2:** `config.toml` com `verify_jwt=false` para as duas funções novas ships
  junto; deploy das funções antes do `db push` (migration inclui o schedule pg_cron).
  Staging não tem `RESEND_API_KEY` — cron loga e pula sem claimar, como os irmãos.

## Referências

- Spec irmã: `docs/superpowers/specs/2026-08-13-agency-notification-emails-design.md`
  (digest da agência; padrões de claim/idempotência reutilizados aqui).
- Mockups: `.superpowers/brainstorm/1595-1788341489/content/central-v3.html`
  (não versionado; `.superpowers/` está no .gitignore).
