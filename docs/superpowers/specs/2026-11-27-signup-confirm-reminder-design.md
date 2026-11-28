# Lembrete de confirmação de e-mail no cadastro

Data: 2026-11-27. Branch: `claude/signup-confirm-reminder`.

## Por quê

A análise do tráfego pago (anúncios do ChatGPT, 2026-11-24 a 11-27) mostrou que metade dos
cadastros vindos do anúncio nunca clica no link de confirmação. Os logs do Auth mostram o e-mail
aceito pelo servidor de envio (sem erro), e ninguém pediu reenvio. Quem confirma faz isso em cerca
de 1 minuto (um caso de 8 h). Hoje o Supabase manda o "Confirm signup" uma vez só, o link vence
em 24 h (`mailer_otp_exp`) e nada mais acontece: o cadastro pago se perde em silêncio.

## Objetivo

- Quem se cadastrou como dono e não confirmou recebe até dois lembretes nossos: 1 h e 24 h depois
  do cadastro. Cada um traz um link novo, de um clique, que confirma o e-mail e já entra no app.
- Os lembretes aparecem como tipo próprio nas métricas de e-mail do Admin.

## Fora do escopo

- Convidados de workspace (`raw_user_meta_data.conta_id`): o convite tem fluxo próprio.
- Bloquear e-mail descartável, mudar o template do Supabase, mudar a tela de cadastro.
- Reenviar para cadastros antigos (antes da janela abaixo) no primeiro deploy.

## Anti-objetivos

- Mandar lembrete para quem já confirmou (inclusive confirmou entre a varredura e o envio).
- Disparar uma rajada para o histórico inteiro de não confirmados no deploy.
- Garantia de quantidade: no máximo 3 tentativas aceitas por tipo e pessoa (normalmente 1). Uma
  falha ambígua (Resend aceitou, `markDelivered` falhou) pode gerar um segundo e-mail; isso é
  preferível a um único e-mail com link morto (ver Link).
- Link que não confirma (pessoa clica e cai de novo em "confirme seu e-mail").

## Abordagens consideradas

1. **Pedir ao Supabase o mesmo e-mail de novo** (`/auth/v1/resend` a partir do cron). Menor
   mudança, mas é o mesmo e-mail que a pessoa ignorou, com o mesmo assunto, e não entra como tipo
   próprio nas métricas.
2. **E-mail nosso pelo `lifecycle-email-cron`** (escolhida pelo dono). Assunto e texto próprios,
   pt/en, tag Resend, link novo gerado no servidor. Reaproveita o protocolo claim → envio com
   chave de idempotência → `delivered_at` do e-mail de boas-vindas.
3. Cron novo dedicado: descartado, duplica o protocolo e a triagem de falha que o
   `lifecycle-email-cron` já tem.

## Desenho

### Banco (migration nova)

- RPC `get_confirm_reminder_candidates(p_now timestamptz)`, `security definer`,
  `set search_path = public`, `REVOKE ALL ... FROM public, anon, authenticated`, `GRANT EXECUTE`
  só para `service_role`. Devolve `(user_id, email, nome, email_type, attempts)`, até 50 linhas.
- Dois tipos em `lifecycle_emails` (chave única `(email_type, user_id)` já existe):
  - `confirm_reminder_1h`: `p_now - 24h < created_at <= p_now - 1h`.
  - `confirm_reminder_24h`: `p_now - 72h < created_at <= p_now - 24h`.
  Intervalos semiabertos e disjuntos: um cadastro nunca casa os dois no mesmo run.
  O de 24 h exige ainda que não haja `confirm_reminder_1h` com `sent_at > p_now - 12h`: quem se
  cadastrou 23 h antes do deploy (ou de uma pane) não recebe dois lembretes com 1 h de distância.
  A janela fecha a retentativa e impede a rajada no deploy: no primeiro run só entra quem se
  cadastrou nas últimas 72 h.
- Filtro comum: `email_confirmed_at is null`, `email is not null`, sem `conta_id` no metadata,
  dono de um workspace criado por ele (mesmo join do welcome), `deleted_at is null`,
  `is_sso_user = false` e `is_anonymous = false` (as três colunas existem no `auth.users` de prod,
  conferido em 2026-11-27). Elegível ao claim: sem linha, ou não entregue com
  `sent_at <= p_now - 1h` e `attempts < 3`.
- RPC `claim_confirm_reminder(p_user_id uuid, p_email_type text, p_now timestamptz)`, mesma
  ACL: numa transação, trava a linha do usuário (`select ... from auth.users ... for update`),
  revalida TODO o filtro acima (inclusive `email_confirmed_at is null` e a janela do tipo) e faz o
  upsert do claim (`attempts + 1`, `sent_at = p_now`, `delivered_at = null`). Devolve o novo
  `attempts`, ou `null` quando a pessoa não é mais elegível (confirmou, saiu da janela, claim
  fresco ou entregue, teto atingido). O handler pula o candidato no `null`. Mesmo desenho do
  `claim_nurture_email`. Sobra a corrida de segundos entre o claim e o envio, aceita.
- Ordem: `created_at asc`.

### Edge (`lifecycle-email-cron`)

- Varredura nova no `handler.ts`, depois do welcome: para cada candidato, `claim_confirm_reminder`
  (pula no `null`), gerar link, enviar, `markDelivered`. Erro por candidato vai para
  `errors` como os demais.
- Link: `auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo:
  appBaseUrl + "/login" } })`, e o e-mail usa `properties.action_link` (mesmo padrão do
  `resend-link` em `_shared/invite-actions.ts`). Gerado DEPOIS do claim, um por tentativa. Gerar
  um link novo pode invalidar o anterior, então a chave de idempotência inclui a tentativa
  (`${email_type}/${user_id}/${attempts}`): o Resend nunca descarta o corpo novo em favor de um
  corpo antigo com link morto. Dentro de uma mesma tentativa a chave segura duplicata de run
  sobreposto.
  **A verificar em staging antes do merge:** clicar no link de magiclink de um usuário não
  confirmado preenche `email_confirmed_at` e deixa a sessão ativa no CRM. Se não confirmar, o
  plano para e volta aqui.
- Depois do `generateLink`, o handler confere `data.user`: se `email_confirmed_at` veio
  preenchido ou `data.user.id` difere do candidato, pula o envio (a linha fica como tentativa não
  entregue e a RPC não a devolve mais, porque a pessoa saiu do filtro).
- `redirectTo` usa `APP_BASE_URL` + `/login`. A intenção de plano do cadastro original
  (`/login?plan=…`) não é preservada no lembrete: aceito, a pessoa cai no fluxo normal pós-login.
- A varredura só roda com o Resend configurado (`RESEND_API_KEY` presente): sem ele (staging) o
  cron não gera link nem gasta tentativa.
- Dependência nova injetada no handler: `generateConfirmLink(email): Promise<string>` e
  `sendConfirmReminder(p)`, para os testes rodarem sem rede.
- Chave de idempotência: `${email_type}/${user_id}/${attempts}` (ver acima).
- Idioma: `langOf.owner(user_id)` (o mesmo do welcome).
- Contador novo no retorno: `confirmRemindersSent`.

### Conteúdo (`_shared/i18n/catalogs/lifecycle.ts` + builder em `_shared/lifecycle-emails.ts`)

- pt, 1 h: assunto "Falta 1 clique para ativar sua conta no Mesaas". Corpo curto: saudação com
  primeiro nome, "confirme seu e-mail para começar", botão "Confirmar e entrar", nota
  "o link vale por 24 horas" e "se não foi você, ignore este e-mail".
- pt, 24 h: assunto "Sua conta no Mesaas está esperando por você", mesmo corpo com abertura
  diferente.
- en: tradução equivalente (paridade travada pelo `edge-i18n-catalogs_test.ts`).
- Sem travessão no texto (regra da casa). Mesmo layout/remetente do welcome (`LIFECYCLE_FROM`).
- O texto não promete teste de N dias: o welcome decide isso pelo `reverse_trial_offer`; aqui
  basta "começar a usar".

### CRM: link vencido ou já usado (`apps/crm/src/pages/login/LoginPage.tsx`)

Hoje um link morto (vencido, substituído por um mais novo, ou consumido por um antivírus que
abre links do e-mail) cai num `/login` sem explicação. Quando o hash da URL traz `error_code`
(`otp_expired` ou `access_denied`), a tela mostra um aviso: "Este link expirou ou já foi usado.
Entre com seu e-mail e senha, ou peça um novo link de confirmação", com o botão de reenviar que já
existe (`handleResend`), usando o e-mail digitado no campo. O hash é limpo da URL depois de lido.
Vale para o e-mail original do Supabase também. pt/en pelo catálogo do CRM.

### Métricas (`_shared/email-classify.ts`)

- `EMAIL_TYPES`: `confirm_reminder_1h` e `confirm_reminder_24h` em `ciclo_de_vida`; tag Resend
  `type` com o mesmo nome; matcher de assunto (`exact`) para o fallback, em pt e em en.
- Rótulos no Admin (`apps/admin/src/pages/emails/email-metrics-view.ts`) para os dois tipos.

### Testes

- Deno: handler (envia para os dois tipos, pula quando o claim falha, link gerado depois do
  claim, idempotência, erro de geração vira `errors` sem marcar entregue); builder pt/en com
  fixture; paridade de catálogo; classificador reconhece os dois assuntos.
- SQL (suíte de entitlements ou teste novo): candidatos respeitam janela (limites inclusos e
  exclusos), confirmados, convidados, SSO/anônimo e teto; `claim_confirm_reminder` devolve `null`
  para quem confirmou depois da leitura de candidatos, fora da janela e com claim fresco.
- Deno: candidato que vira `null` no claim não gera link nem e-mail; `data.user` confirmado ou
  com outro id não envia. Fixtures: estender `__tests__/fixtures/lifecycle-cases.ts` e
  `lifecycle-pt.json` (saída pt travada byte a byte).
- Vitest: `LoginPage` mostra o aviso com `#error_code=otp_expired` e reenvia com o e-mail digitado.
- Vitest do Admin para o rótulo, se a view tiver teste.

## Deploy

Ordem: migration `20261213000001` → `resend-webhook` e `platform-admin` (empacotam
`email-classify.ts`; `classifyEmail` só honra tags presentes no `EMAIL_TYPES` empacotado, então
vão antes do cron) → `lifecycle-email-cron` (cron, `--no-verify-jwt`) → merge (o merge leva só o
rótulo do Admin).
Antes, em staging: migration + function e o teste manual do link (staging não tem
`RESEND_API_KEY`, então o link é conferido gerando-o à mão com a service role num usuário de
teste não confirmado). Portão de staging (bloqueia o merge), com um usuário de teste não confirmado e o link gerado à
mão pela service role:
1. Clicar no link preenche `email_confirmed_at` e abre o CRM logado.
2. Gerar dois links e clicar no mais antigo: registrar o que acontece (esperado: erro, cai no
   aviso novo do `/login`).
3. O `redirect_to` dentro do `action_link` é o `APP_BASE_URL/login` pedido (não o Site URL):
   conferir também em prod antes de ligar, já que a lista de redirects do Auth é por projeto.
Rollback: redeploy da versão anterior do cron; RPC e linhas ficam.

## Decisões do builder

- Texto final dos e-mails, dentro das regras acima.
- Nome exato do teste SQL e onde ele vive.
