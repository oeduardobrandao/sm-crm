# Digest de aprovações pendentes nunca notifica posts "velhos" — Design

## Contexto

Investigando uma reclamação do workspace Hanna Marques (`d8074873-596f-49e5-995d-4b51ce62569d`)
de que clientes não estavam recebendo os e-mails de "Pendências do Hub", encontramos um bug
estrutural no `client-event-email-cron` (não específico desse workspace).

O cron roda a cada 15 min, e para cada cliente busca (a) posts atualmente com
`status = 'enviado_cliente'` (aguardando aprovação) e (b) mensagens não lidas do
workspace, dentro da janela `(lower, event_claim_through]`, onde hoje:

```
const floor = new Date(now.getTime() - SEVENTY_TWO_HOURS_MS);
const lower = maxDate(row.event_cursor_at, floor);
```

O piso de 72h é intencional (comentário original em `handler.ts:34-37`): evita despejar
um backlog de dias em quem nunca recebeu e-mail ou reativou o recebimento depois de muito
tempo opt-out. Faz sentido para mensagens, cujo histórico não-lido pode crescer
indefinidamente. **Não faz sentido para aprovações pendentes**, cuja consulta já é limitada
a posts cujo status *atual* ainda é `enviado_cliente` — não existe risco de "despejo", e um
post pendente há mais de 72h é exatamente o caso que mais precisa ser avisado.

Pior: como `event_cursor_at` é um único watermark que avança até `upper` independente do
que o piso excluiu, um post pendente excluído pelo piso numa execução fica **órfão
permanentemente** — toda execução futura usa esse cursor já avançado como piso inferior, e
o post nunca mais entra em nenhuma janela.

### Evidência levantada (produção, 2026-09-15)

No workspace Hanna Marques:

- Nenhum e-mail de evento a cliente foi enviado com sucesso antes de 2026-09-14 12:30
  (primeiro `client_event_email_sent` em `audit_log` para essa conta) — indício de que o
  toggle `workspaces.send_client_event_emails` (default `false`) só foi ligado por volta
  dessa data.
- Cliente 406 (CLD Advogados): 6 posts enviados para aprovação em 2026-09-09, **ainda
  pendentes hoje** (6 dias), nunca notificados — `event_cursor_at` nulo, então após o fix de
  código estes já passam a ser cobertos (piso vira "desde sempre").
- Cliente 417 (Roberta Lopes): mesmo padrão, 6 posts parados desde 2026-09-09.
- **Órfãos por cursor já avançado** (não resolvido só com o fix de código): 15 posts
  atualmente pendentes em 4 clientes (405 Rachel Gonzaga, 407 Universitário & Uni-Jr., 409
  Daniela, 416 Lorena Borges) têm `created_at` anterior ou igual ao `event_cursor_at` atual
  desse cliente — precisam do backfill (ver abaixo) além do fix.
- Confirmado que não é problema de infraestrutura de envio: 7 dos 12 clientes do workspace
  recebem e-mails normalmente (Resend, domínio, `RESEND_API_KEY` — tudo OK), e a conta tem
  `feature_hub_portal` habilitado e tokens de hub válidos para todos os 12 clientes.

## Decisões (confirmadas em brainstorming 2026-09-15)

1. **Piso de 72h se divide por tipo de conteúdo**: removido para aprovações pendentes,
   mantido para mensagens não lidas. Não remover globalmente (perderíamos a proteção
   original contra despejo de mensagens antigas) nem apenas aumentar o valor (adia o
   problema, não resolve).
2. **Sem cadência de lembrete recorrente.** Cada evento continua sendo mencionado uma
   única vez, no primeiro digest cuja janela o alcança — igual ao comportamento atual, só
   removendo o ponto cego. Uma reincidência (lembrar de novo se o cliente continuar
   ignorando) fica fora de escopo, é problema separado.
3. **Rollout é plataforma inteira, não só Hanna Marques.** É um bug estrutural do cron; na
   primeira execução após o deploy, todo workspace com aprovações pendentes há mais de 72h
   dispara uma "onda" de digests de recuperação — cada e-mail cobre só os pendentes daquele
   cliente, não é um flood.
4. **Backfill é script ad-hoc, não migration.** É uma correção de dado point-in-time (quais
   posts estão hoje órfãos por cursor), não uma mudança de schema — rodar de novo em
   staging não teria sentido, já que o estado que motiva o UPDATE é o de produção agora.
   Roda via `npx supabase db query --linked` uma única vez, depois do deploy do fix de
   código.

## Design técnico

Arquivo tocado: `supabase/functions/client-event-email-cron/handler.ts`. Sem migration, sem
mudança de schema.

Hoje um único `lower` alimenta as duas consultas (aprovações e mensagens). Passa a haver
dois limites inferiores independentes:

```ts
// Aprovações: sem piso. A consulta já é limitada a posts cujo status ATUAL ainda é
// enviado_cliente, então não há risco de despejo — um post pendente há muito tempo é
// exatamente o que o cliente mais precisa ver.
const approvalsLower = row.event_cursor_at ? new Date(row.event_cursor_at) : EPOCH;

// Mensagens: mantém o piso de 72h. Histórico de mensagem não lida pode legitimamente
// acumular por meses; sem o piso, reativar o envio para um cliente old opt-out despejaria
// esse backlog inteiro num só e-mail.
const messagesFloor = new Date(now.getTime() - SEVENTY_TWO_HOURS_MS);
const messagesCursorLower = maxDate(row.event_cursor_at, messagesFloor);
const msgLower = maxDate(lastSeenAt, messagesCursorLower);
```

`EPOCH = new Date(0)`.

Nada mais muda: a paginação por `EVENTS_QUERY_CAP` (1000 linhas, drena do mais antigo para
o mais novo entre execuções) e a lógica de fechamento de grupos empatados por `created_at`
já são agnósticas à largura da janela — é exatamente esse mecanismo que torna seguro alargar
a janela de aprovações sem limite.

O comentário de cabeçalho do arquivo (linhas 34-37, que hoje descreve um piso único
compartilhado) precisa ser reescrito para descrever os dois limites independentes.

## Testes

Em `supabase/functions/__tests__/client-event-email-cron_test.ts`:

**Atualizar** (comportamento muda):
- `"NULL cursor: lower bound is now-72h, an event 80h old is excluded"` (linha 393) — o
  evento de 80h deve passar a ser **incluído** e enviado, não pulado.
- `"cursor 5 days old: lower bound is still now-72h (GREATEST)"` (linha 418) — os dois
  eventos (o de 5 dias e o recente) devem aparecer no mesmo digest, já que aprovações não
  usam mais o piso.

**Adicionar** (comportamento novo a travar):
- Equivalente aos dois testes acima, mas para mensagens — provando que o piso de 72h
  continua valendo do lado de mensagens (não foi uma remoção global por acidente).
- Um caso misto: mesmo cliente, mesma execução, uma aprovação pendente há mais de 72h *e*
  uma mensagem não lida há mais de 72h — a aprovação deve ir no digest, a mensagem não.
  Trava que os dois limites são de fato independentes dentro de uma mesma execução.

## Backfill

Cobre os posts que já estão órfãos por cursor **hoje**, em qualquer workspace — o fix de
código sozinho não os resgata, porque o cursor desses clientes já avançou para depois do
`created_at` desses eventos.

Não cobre (nem precisa cobrir) clientes com `event_cursor_at` nulo — esses já passam a ser
descobertos de graça assim que o fix de código for pra produção, já que o piso deles vira
"desde sempre" (`EPOCH`).

**Efeito colateral aceito**: se um cliente tem, junto dos órfãos, um post pendente que já
tinha sido mencionado num digest anterior (não era órfão, só continua sem aprovação), esse
post pode aparecer de novo no digest de recuperação. É informacional, não dispara nenhuma
ação, e é um efeito único do backfill — não um comportamento recorrente.

**Ordem de execução**: deploy do fix de código primeiro, backfill depois — assim a primeira
execução do cron após o backfill já usa a lógica de janela corrigida.

Preview (somente leitura, rodar primeiro para conferir o conjunto afetado):

```sql
SELECT wp.cliente_id, cl.nome, cl.conta_id, cl.event_cursor_at AS current_cursor,
       min(pse.created_at) - interval '1 second' AS new_cursor,
       count(*) AS orphaned_posts
FROM post_status_events pse
JOIN workflow_posts wp ON wp.id = pse.post_id
JOIN clientes cl ON cl.id = wp.cliente_id
WHERE pse.to_status = 'enviado_cliente'
  AND wp.status = 'enviado_cliente'
  AND cl.event_cursor_at IS NOT NULL
  AND pse.created_at <= cl.event_cursor_at
GROUP BY wp.cliente_id, cl.nome, cl.conta_id, cl.event_cursor_at
ORDER BY cl.conta_id, wp.cliente_id;
```

Backfill (rewind do cursor para o cliente voltar a enxergar os posts órfãos):

```sql
UPDATE clientes c
SET event_cursor_at = sub.new_cursor
FROM (
  SELECT wp.cliente_id,
         min(pse.created_at) - interval '1 second' AS new_cursor
  FROM post_status_events pse
  JOIN workflow_posts wp ON wp.id = pse.post_id
  JOIN clientes cl ON cl.id = wp.cliente_id
  WHERE pse.to_status = 'enviado_cliente'
    AND wp.status = 'enviado_cliente'
    AND cl.event_cursor_at IS NOT NULL
    AND pse.created_at <= cl.event_cursor_at
  GROUP BY wp.cliente_id
) sub
WHERE c.id = sub.cliente_id
RETURNING c.id, c.nome, c.conta_id, c.event_cursor_at;
```

Idempotente: rodar de novo depois de já ter rodado não encontra nenhum órfão (o cursor já
foi rebobinado para antes de todos eles), então o `UPDATE` afeta zero linhas.

## Rollout / runbook

1. Deploy de `client-event-email-cron` (`--no-verify-jwt`, autentica via `x-cron-secret`
   como os demais crons do repo).
2. Rodar o preview SQL acima contra produção, revisar a lista.
3. Rodar o `UPDATE` de backfill contra produção.
4. Na execução seguinte do cron (até 15 min depois), conferir em `audit_log`
   (`action = 'client_event_email_sent'`) que os clientes antes silenciosos (nas duas
   categorias — nunca enviados e órfãos por cursor) aparecem.
5. Nenhuma migration, nenhum flag novo, nenhuma mudança em staging necessária além do
   deploy da function em si.

## Fora de escopo

- Lembrete recorrente para posts pendentes há muito tempo (reincidência) — feature
  separada, não bug.
- Qualquer mudança no toggle `workspaces.send_client_event_emails` ou no motivo dele ter
  ficado desligado até 2026-09-14 nesse workspace especificamente — isso é uma decisão de
  configuração da conta, não um bug de código.
- `notification-email-cron` (o equivalente para notificações internas à equipe) não foi
  auditado; esta spec cobre só o digest voltado ao cliente.
