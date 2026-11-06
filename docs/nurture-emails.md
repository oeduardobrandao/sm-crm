# Nurture de contas que nunca assinaram (runbook)

Sequência de 4 e-mails, do Eduardo, para donos de workspace que criaram conta e nunca
começaram o teste grátis nem assinaram. Trilha A (sem cliente cadastrado: `a1`..`a4`) e
trilha B (com cliente: `b1`..`b4`). Spec:
`docs/superpowers/specs/2026-11-05-nurture-never-paid-design.md`.

## Como funciona

- Roda dentro do `lifecycle-email-cron` (pg_cron a cada 15 min), como quarta varredura,
  depois de boas-vindas, agradecimento e lembrete de teste.
- Toda regra de elegibilidade, cota diária (15 entradas novas por dia de São Paulo), cap de
  72h por pessoa e o passo devido vivem na RPC `get_nurture_candidates(p_now)`.
- Por candidato: `claim_nurture_email` (grava `sent_at` no ledger `nurture_emails`; devolve
  `null` quando recusa: dono mudou, passo já entregue, claim em andamento ou 30 tentativas)
  → monta o e-mail → envia pelo Resend com Idempotency-Key `nurture_<passo>/<workspace_id>`
  e cabeçalhos `List-Unsubscribe` / `List-Unsubscribe-Post` → grava `delivered_at`.
- Falha no envio deixa o claim sem `delivered_at`; depois de 1h ele fica velho e é tentado de
  novo com a mesma chave (o Resend deduplica por 24h).
- Descadastro em um clique pela function `nurture-unsub` (link no rodapé e no cabeçalho),
  que grava `profiles.nurture_opt_out_at`. O switch no Perfil faz o mesmo.

## Variáveis de ambiente (secrets das edge functions)

| Variável | O que faz |
|---|---|
| `NURTURE_EMAILS` | `on` liga a varredura. Qualquer outro valor (ou ausente) é desligado. Lida a cada execução: mudar não precisa de deploy |
| `NURTURE_UNSUB_SECRET` | HMAC dos links de descadastro. Obrigatória, sem default. `nurture-unsub` não sobe sem ela. No `lifecycle-email-cron` ela é lida só na hora do nurture: ausente, cada candidato (e a prévia) falha com erro no relatório de falhas do cron, sem claim nem envio, e boas-vindas, agradecimento e lembrete de teste seguem normais. Trocar invalida todo link já enviado |
| `WHATSAPP_SUPPORT_NUMBER` | Opcional. Sem ela, os e-mails saem sem o botão de WhatsApp |
| `APP_BASE_URL` | Base dos links dos e-mails (a mesma dos outros e-mails do cron) |

Nunca passe secret na linha de comando: use `npx supabase secrets set --env-file <arquivo
temporário>` e apague o arquivo depois.

## Ordem de deploy

1. Migration `20261119000001_nurture_emails.sql` (`npx supabase db push --linked`): coluna
   `nurture_opt_out_at` + GRANT UPDATE, tabela `nurture_emails`, RPCs de candidatos e de
   claim. Aditiva, segura antes de tudo. Renumere acima do maior prefixo de `main` se outra
   migration entrar antes.
2. Secret `NURTURE_UNSUB_SECRET` e a function `nurture-unsub` (`--no-verify-jwt`).
3. `lifecycle-email-cron` (`--no-verify-jwt`) com `NURTURE_EMAILS` ainda `off`. Sem
   `NURTURE_UNSUB_SECRET` os outros e-mails do cron seguem, mas a prévia e todo envio de
   nurture falham, então o passo 2 vem antes.
4. Merge (frontend: só o switch no Perfil).
5. Prévia manual para o e-mail do Eduardo (abaixo); revisar os 8 no Gmail e no celular.
6. `NURTURE_EMAILS=on`.

## Prévia manual

Manda os 8 e-mails, com dados de exemplo, para um endereço. Não lê `NURTURE_EMAILS` nem
toca em ledger nenhum, então funciona com a varredura desligada. A Idempotency-Key leva o
dia e um hash do destinatário (`nurture_preview/<passo>/<AAAA-MM-DD>/<12 hex do sha256 do
e-mail em minúsculas>`). Atenção: repetir para o **mesmo endereço no mesmo dia** não manda
nada, e mesmo assim a resposta diz `previewSent: 8` (o Resend recusa a chave repetida e o
envio trata isso como sucesso). Para ver de novo no mesmo dia, depois de mexer no texto,
use outro endereço (um alias `eduardo+v2@...` serve); outro endereço sempre recebe.

O secret vem de uma variável de ambiente já carregada no shell, nunca colado no comando:

```bash
# CRON_SECRET e SUPABASE_URL exportados antes (por exemplo com `source` de um arquivo local fora do repo)
curl -sS -X POST "$SUPABASE_URL/functions/v1/lifecycle-email-cron" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"nurture_preview_to":"eduardo@mesaas.com.br"}'
```

Resposta esperada: `{"success":true,"previewSent":8}`. Um `nurture_preview_to` presente mas inválido responde 400 e não roda a varredura. O link de descadastro da prévia usa
um id fixo (`00000000-0000-0000-0000-000000000000`) que não corresponde a nenhum perfil.
O pg_cron manda corpo `{}`, então o caminho agendado nunca cai na prévia.

## Rollback

`NURTURE_EMAILS=off` (secret comum, vale na próxima execução). Nada mais precisa voltar.
Não apague linhas de `nurture_emails`: elas são o registro de "nunca mandar duas vezes".

## Descadastrar alguém à mão

```sql
update profiles set nurture_opt_out_at = now()
 where id = '<profile uuid>' and nurture_opt_out_at is null;
```

A partir da próxima execução a pessoa some de `get_nurture_candidates`.

## Acompanhar

Envios por passo:

```sql
select step,
       count(*) filter (where delivered_at is not null) as entregues,
       count(*) filter (where delivered_at is null)     as pendentes,
       max(attempts)                                    as max_tentativas
  from nurture_emails
 group by step
 order by step;
```

Falhas aparecem no relatório de falhas do cron (`reportCronFailure`, ver
`docs/cron-triage.md`) com o `workspace_id` em `accountId`.

## Conversão por passo

Por passo, donos cujo workspace está com status `trialing` ou `active` em
`workspace_subscriptions` e assinou (ou começou o teste) em até 14 dias depois do último
e-mail de nurture entregue para aquele workspace. O instante da assinatura é
`coalesce(ever_subscribed_at, created_at)`. O crédito vai só para o último passo entregue
antes da assinatura.

```sql
with last_delivered as (
  select distinct on (ne.workspace_id)
         ne.workspace_id, ne.step, ne.recipient_user_id, ne.delivered_at
    from nurture_emails ne
    join workspace_subscriptions ws on ws.workspace_id = ne.workspace_id
   where ne.delivered_at is not null
     and ne.delivered_at <= coalesce(ws.ever_subscribed_at, ws.created_at)
   order by ne.workspace_id, ne.delivered_at desc
),
sent as (
  select step, count(*) as entregues
    from nurture_emails
   where delivered_at is not null
   group by step
)
select s.step,
       s.entregues,
       count(ws.workspace_id) as converteram_em_14_dias
  from sent s
  left join last_delivered ld on ld.step = s.step
  left join workspace_subscriptions ws
         on ws.workspace_id = ld.workspace_id
        and ws.status in ('trialing', 'active')
        and coalesce(ws.ever_subscribed_at, ws.created_at) <= ld.delivered_at + interval '14 days'
 group by s.step, s.entregues
 order by s.step;
```

Limites desta conta:

- `workspace_subscriptions` tem uma linha por workspace (chave primária `workspace_id`), e
  `created_at` **não** é a data da assinatura: o `billing-checkout` cria a linha quando o
  checkout abre, só com `stripe_customer_id`. Por isso a consulta prefere
  `ever_subscribed_at`.
- `ever_subscribed_at` é gravado pelo checkout do Pagar.me, não pelo `stripe-webhook`.
  Numa conversão só pela Stripe ele fica nulo e vale o `created_at`: se a pessoa abriu um
  checkout antes do e-mail, desistiu e assinou depois, a linha já existia antes da entrega e
  essa conversão não aparece aqui.
- O status é o atual: quem começou o teste e cancelou antes desta consulta não conta.
