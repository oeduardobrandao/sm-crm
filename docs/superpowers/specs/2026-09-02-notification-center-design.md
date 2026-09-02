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

**Uma migration** que generaliza as preferências:

- Renomeia `notification_email_prefs` → `notification_prefs`; adiciona
  `channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','in_app'))`;
  PK/UNIQUE passa a `(user_id, channel, type)`; o CHECK de `type` amplia para os 22
  tipos + `__all__` (o de e-mail continua efetivamente restrito aos elegíveis pelo
  claim RPC). Recria as 4 policies RLS (`user_id = auth.uid()`) na tabela renomeada.
- Atualiza `claim_notification_emails` no mesmo arquivo: filtro `channel = 'email'` no
  `NOT EXISTS` de opt-out e **adiciona `post_approved`** à lista de tipos elegíveis
  (8 → 9).
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

**Store:** `notificationPrefs.ts` generaliza para `(channel, type)`; export
`EMAIL_NOTIFICATION_TYPES` vira parte do catálogo (9 tipos) e nasce
`INAPP_NOTIFICATION_TYPES` (22).

## Fase 2 — Pendências do Hub

**Digest de estado, sem tabela de fila.** Cron novo `client-event-email-cron`
(15 min, `x-cron-secret`, `verify_jwt=false` no config.toml) varre clientes elegíveis
e monta o e-mail com o que está pendente **agora**:

- **Aprovações:** posts que entraram em `enviado_cliente` desde o cursor
  (`post_status_events.to_status = 'enviado_cliente'`, `created_at > cursor`) **e que
  ainda estão** nesse status canônico no momento do envio (status custom mapeiam via
  `behaves_as`; o canônico é a verdade, mantido pelo trigger z1).
- **Mensagens:** linhas de `mensagens` com `is_workspace_user = true`,
  `created_at > cursor` e ainda não vistas pelo cliente (marcador
  `mensagens_last_seen` com `cliente_id`).
- **Primeiro envio (cursor NULL):** horizonte de 72 h — não emaila backlog antigo
  quando o workspace liga a feature.

**Colunas novas:**

- `workspaces.send_client_event_emails boolean NOT NULL DEFAULT false` — geral OFF
  (opt-in por workspace; nenhum cliente de agência atual recebe e-mail novo sem ação
  explícita do dono).
- `clientes.send_event_email boolean NOT NULL DEFAULT true` — ligou o workspace,
  todos os clientes com e-mail entram; desliga-se pontualmente.
- `clientes.last_event_emailed_at timestamptz` — cursor + cooldown.
- `clientes.event_email_unsub_at timestamptz` — carimbo do descadastro do cliente.
- Lembrete da armadilha de allowlist: os toggles/estados lidos pelo CRM entram no
  GRANT de colunas de `clientes`, em `clientes_v` e em `CLIENTES_SAFE_COLUMNS`.

**Gates (todos):** toggle do workspace + toggle do cliente + e-mail preenchido +
cooldown de 4 h + conteúdo pendente não vazio. **Claim atômico** espelhando o padrão
do digest da agência: RPC `claim_client_event_emails(ids)` com
`UPDATE clientes SET last_event_emailed_at = now() WHERE id IN (SELECT … FOR UPDATE
SKIP LOCKED) RETURNING id, last_event_emailed_at (anterior)`, re-checando os gates
dentro do RPC (honra opt-out tardio). Falha no envio → reset do cursor ao valor
anterior (at-least-once); `Idempotency-Key` do Resend = SHA-1 de
`cliente_id + ids ordenados dos itens` dedupa o retry transitório. ACL do RPC:
somente `service_role` (com re-grant explícito).

**E-mail:** builder `_shared/client-event-email.ts` reutilizando a infra do e-mail de
relatório — remetente whitelabel `${workspace.name} <notificacoes@mesaas.com.br>`, cor
e logo da marca, botão para o Hub via `resolveHubUrl`. Conteúdo: lista dos posts
aguardando aprovação (título/tipo) + contagem de mensagens não lidas. Assunto:
"Você tem pendências com {agência}". Auditoria via `insertAuditLog`
(`client_event_email_sent`). Timeouts (`AbortSignal.timeout`) em todo I/O e
`reportCronFailure` no catch, como os demais crons.

**Descadastro:** rodapé com link para edge function nova `client-email-unsub`
(GET, `verify_jwt=false`): token = HMAC-SHA256 de `cliente_id` com
`TOKEN_ENCRYPTION_KEY` (sem segredo novo, sem token armazenado), comparação em tempo
constante; valida, seta `send_event_email = false` + `event_email_unsub_at = now()` +
audit log, responde página simples de confirmação. Na central, a célula mostra
"desativado pelo cliente"; religar exige diálogo de confirmação explícita e limpa
`event_email_unsub_at`.

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
  sem filtro); prefs store por canal.
- **Deno:** `client-event-email-cron` (gates, cursor/cooldown, horizonte de 72 h,
  reset-on-failure, idempotency key); builder do e-mail; `client-email-unsub`
  (token válido/ inválido/ replay); update dos testes do digest para o 9º tipo.
- **psql (entitlements):** RLS da `notification_prefs` renomeada; ACLs dos claim RPCs
  (somente `service_role`); gates do `claim_client_event_emails`.

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
