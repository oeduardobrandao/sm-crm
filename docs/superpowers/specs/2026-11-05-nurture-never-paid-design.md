# Nurture de contas que nunca assinaram (e-mail) — Design

**Date:** 2026-11-05
**Status:** Draft, aguardando aprovação. Revisado por builder check e por revisão externa (Codex) em 2026-11-05.

## Intent

Mesaas tem dezenas de donos de workspace que criaram conta e nunca começaram o teste grátis
nem assinaram. Ninguém fala com eles depois do e-mail de boas-vindas. Este projeto cria uma
sequência automática de e-mails, do Eduardo, que leva essas pessoas a começar o teste grátis
de 30 dias (e daí a assinar), e que continua rodando para todo cadastro novo.

### Números de prod (2026-11-05)

| | |
|---|---|
| Workspaces (sem demo, sem `plan_source = manual`) | 104 |
| Donos que nunca assinaram (predicado de `hasEverSubscribed`, ver Elegibilidade) | **59** (59 pessoas, um workspace cada) |
| ... sem nenhum cliente cadastrado | 33 |
| ... com cliente, sem assinar | 26 |
| ... cadastrados antes do trial-first (2026-10-27) e que **nunca viram a oferta de teste** | 60 |
| ... com `marketing_opt_in = true` | 29 |
| ... com telefone | 55 |
| ... que entraram no app nos últimos 14 dias | 9 |
| Cadastros novos que nunca pagam, por mês | ~18 |

Os números de cohort, consentimento e telefone abaixo da linha 59 foram medidos com um filtro mais largo (68) e servem de ordem de grandeza. A maior alavanca: a grande maioria nunca soube que existe teste grátis de 30 dias com tudo
liberado. O teste é por workspace e vale para qualquer um que nunca assinou
(`resolveTrialDays` em `_shared/trial.ts`), então todos os 59 são elegíveis.

### Estado atual

- `lifecycle-email-cron` (Resend, pg_cron `9-59/15 * * * *` em prod) manda boas-vindas,
  agradecimento de assinatura e lembrete de fim de teste, com o ledger `lifecycle_emails` e
  Idempotency-Key do Resend. Funciona.
- O pipeline do Loops (`loops-sync-cron`, spec `2026-07-31-loops-lifecycle-marketing-emails-design.md`)
  **nunca rodou em prod**: não tem `LOOPS_API_KEY` e o cron só foi agendado em staging. As 34
  linhas `dormant_signup` do ledger são marcadores de backfill (`attempts = 0`, todas em
  2026-08-03), não envios.
- Não existe envio de SMS nem WhatsApp. `_shared/whatsapp.ts` só monta link `wa.me`.

## Decisions (do usuário, 2026-11-05)

| Decisão | Escolha |
|---|---|
| Quem recebe | **Todos os donos que nunca assinaram**, não só quem marcou `marketing_opt_in`. Base: interesse legítimo (LGPD art. 7º IX) para e-mails de serviço/ativação a quem tem conta, com descadastro em um clique. |
| Onde roda | **Resend, dentro do repo**, estendendo `lifecycle-email-cron`. O Loops fica como está (desligado em prod). |
| Telefone | **Fase 2.** Este spec é só e-mail. WhatsApp (Cloud API, templates aprovados, só opt-in) vira um projeto separado. |
| Gancho | **Só o teste grátis de 30 dias que já existe.** Sem cupom, sem desconto, sem trial estendido. |

Consequência da primeira decisão: o conteúdo precisa ser de produto e ativação (como usar,
o que o teste libera), nunca promoção de terceiros nem desconto. O teste grátis é um recurso
do produto que a pessoa já usa, não uma oferta comercial nova. Se um dia entrar cupom, esse
e-mail passa a exigir `marketing_opt_in = true`.

## Goals

1. Todo dono que nunca assinou recebe uma sequência curta (4 e-mails em ~2,5 semanas)
   adequada ao estágio dele.
2. Medir quantos começam o teste a partir dela.
3. Os 59 atuais entram sem disparar 59 e-mails no mesmo minuto.
4. Cadastros novos entram sozinhos, depois do boas-vindas.

## Non-goals

- SMS e WhatsApp (fase 2).
- Reativar o Loops, editar copy sem deploy.
- Cupom, desconto, trial maior.
- Reconquista de quem já assinou e cancelou (2 workspaces hoje; outro público, outra copy).
- Membros convidados (não são donos, não decidem a compra).
- Teste A/B de copy. Volume baixo demais para ler resultado.

## Anti-goals (falharia mesmo funcionando)

- Mandar e-mail para quem já está em teste ou pagando, ou continuar depois que a pessoa
  começou o teste.
- Mandar dois e-mails do Mesaas no mesmo dia para a mesma pessoa.
- Descadastro que não funciona em um clique, ou que desliga e-mail transacional (convite,
  cobrança, lembrete de fim de teste).
- Tom de spam: assunto em caixa alta, emoji em excesso, "ÚLTIMA CHANCE". É o Eduardo
  escrevendo para alguém que criou conta.
- Queimar a reputação de `mesaas.com.br`, que carrega convites e cobrança.

## Design

### Segmentos

Avaliado a cada envio, não fixado na entrada:

- **A — Não ativado:** workspace com 0 clientes (`clientes.conta_id = workspace`).
- **B — Ativado, sem assinar:** 1 ou mais clientes.

Quem cria o primeiro cliente durante a sequência A sai dela e entra em B no passo 1, desde
que ainda não tenha recebido A4 (regra abaixo).

### Elegibilidade (toda condição em SQL, na RPC de candidatos)

Um dono entra/continua se **todas** valem:

- é o **dono atual** do workspace, resolvido como nas RPCs de agradecimento e lembrete de
  teste (`20261102000001`): `workspace_members` com papel `owner`, preferindo `created_by`,
  depois `joined_at`, depois `user_id`. Revalidado no claim: se o dono mudou entre a leitura
  e o envio, não envia (ex-membro nunca recebe nome de workspace nem de cliente);
- o workspace não é demo (`demo_created_at is null`);
- `plan_source` diferente de `manual`;
- o workspace nunca assinou, pelo **mesmo predicado do checkout** (`hasEverSubscribed`,
  `_shared/billing-logic.ts:55`): `ever_subscribed_at`, `stripe_subscription_id` e
  `pagarme_subscription_id` todos nulos (e não ex-demo), além de status fora de `active`,
  `trialing`, `past_due`; sem linha em `workspace_subscriptions` conta como nunca assinou.
  `ever_subscribed_at` sozinho não basta: o `stripe-webhook` não o grava, então um teste
  Stripe cancelado depois de 2026-08-12 passaria e receberia oferta de teste que o checkout
  recusa;
- a pessoa não é dona de **nenhum** workspace que já assinou (quem paga em outro workspace
  não recebe "comece seu teste"; 0 casos hoje);
- no momento do envio, o workspace ativo da pessoa (`profiles.conta_id`) é o workspace da
  sequência. O `/comecar` age sobre o workspace ativo e não há troca de workspace por link,
  então sem essa regra o CTA abriria o workspace errado. Minha escolha: evita mexer no
  frontend; hoje todos têm um workspace só;
- a conta (`auth.users.created_at`) tem pelo menos 72h. Não exige linha de boas-vindas: 5 dos
  59 se cadastraram antes de o boas-vindas existir e não têm. Um boas-vindas recente já fica
  de fora pelo cap de 72h abaixo;
- o perfil não se descadastrou do nurture (`profiles.nurture_opt_out_at is null`, coluna nova);
- nenhum e-mail do Mesaas foi entregue a essa pessoa nas últimas 72h, contando nurture
  (pelo destinatário gravado no ledger novo, inclusive claims frescos), `welcome` (por
  `user_id`) e os e-mails por workspace (`subscription_thanks`, `trial_reminder`) de qualquer
  workspace em que ela é dona hoje. O ledger atual não grava o destinatário desses dois,
  então a regra usa o dono atual; minha escolha, aceitável porque só serve para espaçar;
- o workspace tem no máximo 180 dias. Mais velho que isso não entra (conta abandonada,
  risco de reputação maior que o ganho). Minha escolha; ajustável. Hoje 55 dos 59 cabem (medido em 2026-11-06).

Dono com mais de um workspace que nunca assinou: **uma sequência por pessoa**, sobre o
workspace criado mais recentemente. Quem já tem qualquer linha de nurture (em qualquer
workspace) não entra em outra sequência. Minha escolha: evita mandar duas séries à mesma
pessoa.

### Sequências

Cadência contada a partir da **entrada** na sequência (entrega do primeiro e-mail dela), não
do cadastro, para que o backlog e os novos sigam o mesmo ritmo. Cada passo sai no primeiro
sweep elegível a partir do dia indicado (o cap de 72h e a janela de horário podem atrasar).
Todos de `Eduardo do Mesaas <eduardo@mesaas.com.br>`, reply-to dele, layout `mesaasEmail`
já usado pelos outros, sem em-dash na copy.

**A — Não ativado** (objetivo: cadastrar o primeiro cliente, depois testar)

| Passo | Dia | Assunto (rascunho) | Conteúdo | CTA |
|---|---|---|---|---|
| A1 | 0 | Seu primeiro cliente no Mesaas leva 3 minutos | O que dá pra fazer com um cliente cadastrado; atalho de importação (Notion, Trello, ClickUp, CSV) | `/clientes` e `/importar` |
| A2 | 4 | Como as agências aprovam posts sem WhatsApp | O Hub do cliente: aprovação por link, sem login, com a marca da agência | `/clientes` |
| A3 | 9 | Teste tudo do Mesaas por 30 dias | O que o teste libera (Hub, equipe, analytics de Instagram, agendamento, relatórios); "você só é cobrado no fim se continuar, e eu te aviso antes" | `/comecar` |
| A4 | 16 | Posso parar de te escrever? | Curto, quase texto puro. Pergunta se o Mesaas não serve, pede uma resposta de uma linha, oferece WhatsApp | responder / WhatsApp |

**B — Ativado, sem assinar** (objetivo: começar o teste)

| Passo | Dia | Assunto (rascunho) | Conteúdo | CTA |
|---|---|---|---|---|
| B1 | 0 | Você já tem {n} cliente(s) no Mesaas. Teste o resto por 30 dias | Personalizado com o nome do workspace e nº de clientes; o que destrava; se tem 2 clientes, diz que o Free para aí | `/comecar` |
| B2 | 4 | Seu cliente aprova o post pelo celular | Hub + aprovações, citando o primeiro cliente dele pelo nome | `/comecar` |
| B3 | 9 | Relatório de Instagram pronto para mandar ao cliente | Analytics + relatório em PDF; a frase muda se ele já conectou um Instagram | `/comecar` |
| B4 | 16 | Posso parar de te escrever? | Igual A4 | responder / WhatsApp |

Regras de fim e migração (minha escolha):

- Depois de A4 ou B4, nada mais desta sequência para aquele workspace, para sempre.
- A → B só se A4 ainda não foi entregue. Pior caso: A1–A3 + B1–B4 = 7 e-mails, espaçados
  pelo cap de 72h.
- Dia 4/9/16 conta da entrega do primeiro passo **da sequência atual** (A1 ou B1). Na
  migração A → B, o B1 sai no primeiro sweep elegível (respeitando 72h e janela) e o relógio
  de B começa nele.

Variações condicionais da copy:

- A3 abre com "quando você criou sua conta, o Mesaas ainda não tinha teste grátis" **só** para
  workspace criado antes de 2026-10-27 (trial-first). Depois disso a frase some.
- B1 cita o limite de 2 clientes do Free **só** quando `client_count >= 2`.
- B2 cita o primeiro cliente pelo nome: `clientes` do workspace em `order by created_at, id`
  (`first_client_name`); sem nome, frase genérica.
- B3 muda a frase se o workspace tem Instagram conectado: existe `instagram_accounts` com
  `authorization_status = 'active'` ligada (`client_id`) a um cliente do workspace.

Os textos finais saem no PR, revisados pelo Eduardo antes do merge. Os mockups estão no
artifact "Nurture: contas que nunca assinaram"
(https://claude.ai/artifact/91DZvrZnCBvQtfC5j9KH2f), renderizados com os blocos reais de
`_shared/email/`.

### Saída

Para de mandar no próximo sweep quando qualquer uma vale (todas já estão na elegibilidade):
começou teste ou assinou; descadastrou; workspace apagado.

### Horário e ritmo do backlog

- Só envia de segunda a sexta, das 9h às 11h59 em America/Sao_Paulo. O cron continua a cada
  15 min; fora da janela a RPC devolve vazio.
- No máximo **15 entradas novas por dia** (A1 ou B1 de quem nunca recebeu nurture; migração
  A → B não conta). Passos seguintes não contam. Os 59 atuais levam ~5 dias úteis para
  entrar; ordem: quem entrou no app mais recentemente primeiro
  (`auth.users.last_sign_in_at desc nulls last`). Volume baixo protege a reputação do
  domínio e deixa o Eduardo responder as respostas.
- Cadastros novos competem pela mesma cota; com ~18/mês nunca enchem.

### Descadastro

- Coluna nova `profiles.nurture_opt_out_at timestamptz null`. Só desliga o nurture; não toca
  em `marketing_opt_in`, convite, cobrança, lembrete de teste nem boas-vindas.
- **Um único endereço** para rodapé e headers: `${SUPABASE_URL}/functions/v1/nurture-unsub/<token>`,
  edge function nova e pública (`--no-verify-jwt`), no mesmo modelo de `client-email-unsub`
  (que já usa `/functions/v1/client-email-unsub/<token>`). Sem rota no app, sem mudança no
  `vercel.json`. GET mostra a página de confirmação; POST sem corpo grava (RFC 8058).
  Token = HMAC do `user_id` com secret novo, sem expiração.
- Headers `List-Unsubscribe: <mesma URL>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  (exigidos pelo Gmail/Yahoo para remetente em volume).
- Em `Configurações > Perfil`, um switch "Dicas por e-mail" que liga/desliga
  `nurture_opt_out_at`. Minha escolha: um lugar visível além do link. `profiles` tem
  `UPDATE` só numa lista fechada de colunas (`20260729000002_profiles_write_lockdown.sql`,
  com asserção): a migration precisa somar `nurture_opt_out_at` ao `GRANT UPDATE (...)` e
  atualizar a asserção, senão o switch falha.
- Rodapé: "Você recebeu este e-mail porque criou uma conta no Mesaas. Não quer mais receber
  dicas? Descadastrar."

### Medição

- Todo link de CTA leva `?utm_source=email&utm_medium=nurture&utm_campaign=<passo>` (ex.
  `nurture_b1`). O PostHog já captura UTM no pageview.
- O ledger `lifecycle_emails` diz quem recebeu o quê e quando; `workspace_subscriptions`
  diz quem começou teste. Conversão = começou teste até 14 dias depois do último nurture
  entregue. Query documentada em `docs/nurture-emails.md` (runbook novo).
- Sem tela nova no Admin nesta fase. Para 59 pessoas a query basta. Minha escolha.

### Arquitetura

```
pg_cron (lifecycle-email-cron, 15 min)
  └─ handler.ts
       ├─ (existentes) welcome, thanks, trial_reminder
       └─ nurture (se NURTURE_EMAILS=on): rpc get_nurture_candidates()
            └─ por linha: claim (upsert lifecycle_emails) → build → sendViaResend(idempotency, headers) → delivered_at
```

- **RPC `get_nurture_candidates()`** (SECURITY DEFINER, EXECUTE só `service_role`; REVOKE
  nomeando `anon` e `authenticated`, não só `PUBLIC`) devolve no
  máximo um passo por usuário por chamada: `user_id`, `workspace_id`, `email`, `nome`,
  `workspace_name`, `workspace_created_at` (variação do A3), `email_type` (`nurture_a1`..`nurture_b4`), `client_count`,
  `first_client_name`, `has_instagram`. Toda regra de elegibilidade, janela de horário, cota
  diária e cap de 72h vive aqui, não no Deno, como nas RPCs atuais.
- **Ledger novo `nurture_emails`**, não `lifecycle_emails`: colunas `workspace_id`, `step`
  (`a1`..`b4`), `recipient_user_id` (imutável, quem recebeu de fato), `sent_at` (claim),
  `delivered_at`, `attempts`; `unique (workspace_id, step)`; RLS ligada sem policy (só
  service role), como `lifecycle_emails`. Motivo: `lifecycle_emails` não grava destinatário
  dos e-mails por workspace e tem `unique (email_type, user_id)`, que impediria a sequência
  certa para dono de vários workspaces. Também deixa de fora as 34 linhas de backfill
  `dormant_signup`, que não podem contar como "já recebeu". Claim, retry de claim velho
  (>1h), limite de tentativas e Idempotency-Key `nurture_<passo>/<workspace_id>` seguem o
  protocolo do handler atual.
- **Builders** em `_shared/nurture-emails.ts`: uma função pura por passo, testável.
- **`sendViaResend`** já aceita `headers` (`lifecycle-emails.ts:321`): só passar o List-Unsubscribe.
- **Rodapé com link:** `mesaasEmail` escapa `footerLines` (`email/shell.ts`), então o link de
  descadastro precisa de um campo novo de rodapé em HTML (ex. `footerHtml`), montado com
  `link()` para o href passar pelo mesmo tratamento dos outros blocos.
- **Kill switch:** env `NURTURE_EMAILS` (`off` padrão | `on`), lido a cada execução;
  desligado, o handler pula o bloco de nurture.
- **Modo de teste:** invocação manual, nunca pelo cron. `POST lifecycle-email-cron` com
  `x-cron-secret` e corpo `{"nurture_preview_to": "<email>"}` manda os 8 passos uma vez para
  esse endereço, com dados de exemplo, sem tocar em ledger nenhum. Idempotency-Key com o
  dia, para um duplo clique não duplicar. O sweep agendado ignora esse caminho.

### Ordem de deploy

1. Migration (prefixo acima do maior em `main` na hora de abrir o PR; hoje o maior é
   `20261118000001`, então **não** `20261105…`, que já tem três): coluna
   `nurture_opt_out_at` + GRANT UPDATE, tabela `nurture_emails`, RPCs de candidatos e de
   claim. Aditiva, segura antes de tudo.
2. Secret `NURTURE_UNSUB_SECRET` + function `nurture-unsub` (`--no-verify-jwt`).
3. `lifecycle-email-cron` com `NURTURE_EMAILS` ainda `off`.
4. Merge (frontend: só o switch no Perfil).
5. Preview manual para o e-mail do Eduardo; revisar os 8 no Gmail e no celular.
6. `NURTURE_EMAILS=on`.

Rollback: `NURTURE_EMAILS=off`. Nada mais precisa voltar.

## Constraints

- E-mail transacional e nurture saem do mesmo domínio e do mesmo remetente. O volume
  (≤15 entradas/dia) é o que protege a reputação. Se crescer muito, um subdomínio só para
  nurture entra numa fase seguinte.
- Copy em português, sem em-dash, sem número de plano que mude pelo Admin (preço, limite),
  exceto "2 clientes no Free", que já aparece no lembrete de teste. Se o limite do Free
  mudar, essa frase muda junto.
- Gotchas do `CLAUDE.md`: edge function pública nova precisa de `--no-verify-jwt`; CORS por
  `buildCorsHeaders`; `/comecar` aceita voltar pelo e-mail (só barra quem já testou, não é
  free, é `manual` ou não é dono: `isTrialOfferEligible`, `plan-display.ts:180`), então
  todos os CTAs de teste podem apontar para lá.

## Deixado para quem constrói

- Texto final de cada e-mail, dentro da direção acima.
- Detalhes do token HMAC e layout da página de confirmação do `nurture-unsub`.
- Como o handler reporta a contagem de nurture no relatório do cron.

## Fase 2 (fora deste spec)

WhatsApp via Cloud API para quem tem telefone **e** `marketing_opt_in = true` (o campo de
telefone foi coletado "para informações da conta", não para marketing). Templates aprovados
pela Meta, mesmo ledger, mesma janela. Avaliar depois de ver a conversão do e-mail.
