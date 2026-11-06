# Métricas de e-mail transacional no Admin

Data: 2026-11-06. Status: rascunho para aprovação.

## Por quê

O fundador não tem hoje nenhuma visibilidade da saúde dos e-mails que a plataforma manda pelo
Resend. A sequência de nurture (PRs #824-#827) foi ligada em 2026-11-06 e os primeiros envios
reais saem na segunda 2026-11-09, entre 9h e 11h (São Paulo). Ele quer saber, para um período,
quantos e-mails saíram, quantos foram entregues e quantos voltaram, no geral e por tipo, para
pegar cedo um domínio com reputação ruim, um template que cai em filtro ou uma base de
endereços ruins.

**Meta de prazo:** webhook e tags do `lifecycle-email-cron` no ar antes de segunda 09:00 SP,
para a estreia do nurture ser medida desde o primeiro envio sem depender do backfill.

## Objetivos

- Página nova no Admin (`/admin/emails`, item "E-mails" no menu) com seletor de período.
- Para o período: total enviado, taxa de entrega, taxa de bounce, reclamações (spam) e
  "não enviados" (failed + suppressed). Geral e por categoria, com detalhe por tipo.
- Lista dos bounces e reclamações recentes do período (tipo, data, motivo, destinatário
  mascarado) para agir sobre endereço ruim.
- Backfill único do que o Resend ainda retém, classificado por remetente e assunto
  (decisão do usuário).

## Não objetivos

- **E-mails de autenticação** (login/magic link, convite do Supabase Auth, recuperar senha):
  em prod saem pelo SMTP da UOL Host (`smtps.uhserver.com:465`, conferido na config de Auth em
  2026-11-06), não pelo Resend. Decisão do usuário: ficam de fora. A página mostra um aviso
  fixo dizendo isso.
- E-mails de marketing da Loops (`loops-sync-cron`): outro provedor, fora.
- Aberturas e cliques: dependem de tracking ligado no domínio e não foram pedidos. Não
  assinamos `email.opened`/`email.clicked`.
- Alertas em tempo real (ex.: avisar quando o bounce passar de X%). Fica para depois.
- Usar `GET /emails/metrics` do Resend como segunda fonte. Ele existe (totais e por período,
  sem dimensão de tag), mas o `sent` dele não bate com a nossa contagem (cache de 15 min,
  retenção do plano, inclui tudo da conta) e criaria "por que os números diferem?". Uma fonte
  só: a nossa tabela.

## Anti-objetivos

- Números que não fecham: na tela, enviados = entregues + bounces + reclamações + atrasados +
  pendentes + não enviados.
- Guardar dado pessoal sem necessidade (LGPD): a métrica não precisa do destinatário.
- Mexer em `_shared/notify.ts` ou `dunning-email.ts` sem necessidade: `notify.ts` é importado
  por ~30 crons via `triage.ts`, e o remetente desses já identifica o tipo.

## Inventário de envios (recon 2026-11-06)

Todos fazem `POST https://api.resend.com/emails` direto; nenhum manda tags hoje.

| Categoria (Admin) | Tipo (tag `type`) | Onde | Remetente |
|---|---|---|---|
| Notificações | `notification_digest` | `_shared/notification-email.ts` (`notification-email-cron`) | notificacoes@ |
| Notificações | `client_event` | `client-event-email-cron` (via `sendViaResend`) | `<workspace> <notificacoes@>` |
| Notificações | `agenda_lembrete` | `agenda-lembretes-email` | notificacoes@ |
| Notificações | `agenda_cliente` | `agenda-cliente-email` (via `sendViaResend`) | `<workspace> <notificacoes@>` |
| Ciclo de vida | `welcome`, `thank_you`, `trial_reminder` | `lifecycle-email-cron` | eduardo@ |
| Ciclo de vida | `nurture_a1`..`nurture_a4`, `nurture_b1`..`nurture_b4` | `lifecycle-email-cron` | eduardo@ |
| Ciclo de vida | `instagram_connect` | `_shared/instagram-connect-email.ts` (`instagram-connect-link`, `instagram-integration`) | eduardo@ |
| Convites | `invite`, `demo_access` | `_shared/invite-email.ts` (`invite-user`, `platform-admin`) | convites@ |
| Cobrança | `dunning` | `_shared/dunning-email.ts` | cobranca@ |
| Relatórios | `report` | `report-worker`, `instagram-analytics` | `<workspace> <relatorios@>` |
| Afiliados | `affiliate_link` | `affiliate-public/email.ts` | afiliados@ |
| Interno | `founder_signup`, `founder_subscription`, `cron_failure`, `retention_radar` | `lifecycle-emails.ts`, `notify.ts`, `retention-radar-cron` | alertas@ |

O builder refaz um grep por `api.resend.com` e
`sendViaResend(` ao implementar, para pegar envio que o recon tenha perdido.

## Desenho

### Fonte dos dados: webhooks do Resend numa tabela nossa

O Resend manda `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
`email.complained`, `email.failed`, `email.suppressed` para uma edge function nova. Cada
payload traz `type`, `created_at` e `data` com `email_id`, `created_at` (hora do envio),
`from`, `to`, `subject`, `tags` (objeto chave/valor) e, no bounce, `bounce {type, subType,
message}`. Retries usam backoff de até ~28 h e repetem o `svix-id`.

### Tabela `email_sends` (uma linha por e-mail)

```
email_id        text primary key          -- id do Resend
category        text not null             -- notificacoes | ciclo_de_vida | convites | cobranca | relatorios | afiliados | interno | outros
type            text not null             -- tag type, ou o inferido; 'desconhecido' se nada bate
sent_at         timestamptz not null      -- data.created_at do Resend (hora do envio)
last_event      text not null             -- sent | delivered | delivery_delayed | bounced | complained | failed | suppressed
bounce_type     text null                 -- Permanent | Transient | Undetermined (como vier)
bounce_subtype  text null
bounce_message  text null                 -- truncado em 500 chars
recipient       text null                 -- SÓ em bounced/complained/failed/suppressed; zerado após 90 dias
subject         text null                 -- idem
source          text not null             -- webhook | backfill
created_at, updated_at timestamptz
```

- Índices em `(sent_at)` e `(category, sent_at)`.
- RLS ligada, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (papéis nomeados
  explicitamente), grants só para `service_role`. Sem coluna `cliente_id` (é dado de
  plataforma; o drift de acesso por cliente não deve pegar).
- **Agregação por `sent_at`, nunca pela hora do evento:** um `delivered` que chega depois da
  meia-noite conta no dia do envio.
- **Upsert monotônico** (o Resend não documenta ordem de entrega): precedência
  `complained` > `bounced` > `failed` = `suppressed` > `delivered` > `delivery_delayed` > `sent`.
  Evento de precedência menor não rebaixa `last_event`. Feito numa função SQL
  `email_sends_apply_event(...)` SECURITY DEFINER, EXECUTE só `service_role`, para a comparação
  ser atômica (`INSERT ... ON CONFLICT DO UPDATE ... WHERE rank(novo) > rank(atual)`).
- `category`/`type`/`sent_at` gravados na primeira vez; eventos seguintes não reclassificam,
  exceto quando a linha veio do backfill e o evento traz tag (webhook ganha).
- **Dedupe:** tabela `email_webhook_events(svix_id text primary key, received_at)`; `INSERT ...
  ON CONFLICT DO NOTHING`; se já existia, responde 200 sem reaplicar. A mesma função SQL faz o
  insert de dedupe e o upsert na mesma transação.
- **Limpeza e PII (minha decisão):** `recipient` e `subject` só são gravados em bounce,
  reclamação, falha e supressão (os casos em que dá para agir). Um passo oportunista na
  função SQL (em ~1% das chamadas) apaga `email_webhook_events` com mais de 7 dias e zera
  `recipient`/`subject`/`bounce_message` com mais de 90 dias. Sem cron novo. Os contadores
  ficam para sempre.

### Classificador único: `_shared/email-classify.ts`

`classifyEmail({ tags, from, subject }) → { category, type }`, usado pelo webhook e pelo
backfill:

1. `tags.type` presente e conhecido → usa; a categoria vem do mapa `type → category`.
2. Senão, pelo endereço do remetente: `alertas@` → interno (tipo pelo assunto quando der),
   `cobranca@` → cobrança/`dunning`, `convites@` → convites (`demo_access` se o assunto bate
   com o do acesso demo, senão `invite`), `afiliados@` → afiliados/`affiliate_link`,
   `notificacoes@` → notificações (tipo pelo assunto quando der, senão `notificacao`).
3. `eduardo@`: pelo assunto, comparando com constantes exportadas dos builders
   (`WELCOME_SUBJECT`, assuntos de nurture por step, trial reminder, thank-you, instagram
   connect, agenda-cliente). Sem match: ciclo de vida/`desconhecido`.
4. `relatorios@` → relatórios/`report`.
5. Remetente fora de `@mesaas.com.br` → `externo`/`desconhecido` (outro projeto na mesma
   conta Resend, se um dia existir).
6. Nada bateu → `outros`/`desconhecido`.

Assuntos vêm de constantes importadas, não de strings copiadas; um teste confere que cada
tipo com assunto fixo é reconhecido pelo fallback, então mudar um assunto sem atualizar a
classificação quebra o teste. Assuntos dinâmicos usam prefixo.

### Tags nos envios

Só onde o remetente é compartilhado e não discrimina o tipo:

- `sendViaResend` ganha um parâmetro opcional `tags?: Record<string, string>` (convertido para
  `[{name, value}]`). Ausente, o payload fica idêntico ao de hoje.
- Callers passam `{ type: "<tipo>" }`: welcome, thank-you, trial reminder, nurture (com o
  step), instagram connect, agenda-cliente, agenda-lembretes, client-event.
- `_shared/notification-email.ts` (digest) e os dois envios de relatório (`report-worker`,
  `instagram-analytics`) ganham `tags: [{ name: "type", value: ... }]` no corpo.
- Valores só `[A-Za-z0-9_-]` (regra do Resend). Rótulos em português num mapa no Admin.
- `notify.ts`, `dunning-email.ts`, `invite-email.ts`, `affiliate-public/email.ts`,
  `retention-radar-cron` e os founder notices **não** mudam: o remetente já classifica.

### Edge function `resend-webhook`

- `--no-verify-jwt` (autentica pela assinatura). Entra na lista do CLAUDE.md.
- Lê o corpo cru (`await req.text()`) antes de qualquer parse.
- Assinatura Svix: headers `svix-id`, `svix-timestamp`, `svix-signature`; conteúdo assinado
  `${id}.${timestamp}.${body}`; HMAC-SHA256 com o segredo `whsec_...` (parte depois do prefixo,
  decodificada de base64); o header pode trazer várias assinaturas `v1,<base64>` separadas por
  espaço, aceita se qualquer uma bate (comparação em tempo constante); timestamp com
  tolerância de ±5 min. O builder confere esses detalhes na doc da Svix antes de codar.
- `RESEND_WEBHOOK_SECRET`: obrigatório, sem default, `throw` no carregamento do módulo.
- Assinatura inválida → 401 sem detalhe. Evento que não tratamos → 200 e ignora. Erro de
  banco → 500 (o Resend tenta de novo), log interno sem payload nem destinatário.
- Sem CORS (servidor a servidor); só POST. Não grava no `audit_log` (volume).

### Backfill: ação `email-backfill` no `platform-admin`

- Ação do Admin, não script local, porque `RESEND_API_KEY` só existe como secret de edge.
- Pagina `GET /emails?limit=100&after=<cursor>` (o builder confere na doc qual cursor anda para
  trás no tempo) até 20 páginas por chamada, com ~120 ms entre páginas (limite de 10 req/s da
  conta, que os crons também usam). Devolve `{ inserted, scanned, nextCursor, oldestReached,
  done }`.
- Cada item (`id`, `from`, `subject`, `created_at`, `last_event`, `to`; sem tags) passa pelo
  mesmo `classifyEmail`. Insere com `ON CONFLICT (email_id) DO NOTHING`: nunca sobrescreve
  linha de webhook. `source = 'backfill'`. PII só nos casos de bounce/reclamação/falha.
- Bounce do backfill não tem `bounce_type` (o list não traz); fica nulo.
- Cursor fica no cliente: a página repete a chamada com `nextCursor` até `done`, mostrando
  progresso. Idempotente; pode ser rodado de novo sem duplicar.
- Não prometo janela de retenção: `oldestReached` mostra até onde o Resend ainda tinha.

### Ação de leitura `email-metrics` no `platform-admin`

Entrada `{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }` (datas de São Paulo, inclusivas; máximo
366 dias; validadas). Agrega numa função SQL `email_metrics(p_start date, p_end date)`
SECURITY DEFINER, EXECUTE só `service_role`, com `sent_at AT TIME ZONE 'America/Sao_Paulo'`:

- Por categoria e tipo: `total`, `delivered`, `bounced`, `complained`, `delayed`
  (`delivery_delayed` sem desfecho), `pending` (`sent` sem desfecho), `not_sent`
  (`failed` + `suppressed`).
- Série diária (total, entregues, bounces, outros) para o gráfico, só das categorias de
  cliente (exclui `interno` e `externo` no SQL).
- Os 50 bounces/reclamações/falhas mais recentes do período, das categorias de cliente: tipo, `sent_at`, `last_event`,
  `bounce_type`, `bounce_message`, destinatário mascarado no servidor (`j***@gmail.com`) e
  assunto.
- `coverage_start`: menor `sent_at` da tabela, para "dados desde ...".

Definições: base = `total − not_sent` (o que o Resend chegou a enviar).
**Taxa de entrega** = (`delivered` + `complained`) / base (reclamação só existe se chegou).
**Taxa de bounce** = `bounced` / base. **Taxa de reclamação** = `complained` /
(`delivered` + `complained`). Com base zero a taxa aparece como "Sem envios".
Comentário e teste deixam as fórmulas explícitas.

Gate: o mesmo de todas as ações do `platform-admin` (`platform_admins`).

### Página `/admin/emails`

- Cabeçalho "E-mails". Seletor de período: 7 dias (padrão), 30 dias, 90 dias, personalizado.
- KPIs **para clientes** (excluem Interno e Externo): Enviados, Taxa de entrega, Taxa de bounce,
  Reclamações. Bounce acima de 4% e reclamação acima de 0,08% em vermelho (limiares usuais de
  reputação; minha decisão, constantes num arquivo só).
- Gráfico diário (barras empilhadas: entregues, bounces, outros), seguindo
  `pages/metricas/charts.tsx`. Mesmo recorte dos KPIs (sem Interno e Externo), para os números
  fecharem com os cards.
- Tabela por categoria, expansível por tipo: Tipo, Enviados, Entregues, Taxa de entrega,
  Bounces, Taxa de bounce, Reclamações, Não enviados. Interno numa linha separada no fim,
  "Interno (fora do total)", e Externo do mesmo jeito quando tiver linhas.
- Card "Bounces e reclamações recentes", também sem Interno e Externo.
- Rodapé: "Dados desde DD/MM/AAAA. E-mails de login, convite e recuperação de senha saem pelo
  SMTP do Supabase e não aparecem aqui."
- "Importar histórico do Resend" num menu do cabeçalho, com progresso.
- Estados: carregando (skeleton), vazio ("Nenhum e-mail no período"), erro (`ErrorState`).
- Desktop e phone, como as outras páginas do Admin. Copy em português, sem travessão.

Mockups num artifact acompanham o plano.

## Restrições

- Migration com prefixo único acima do topo de `main` na hora do PR.
- Testes Deno: assinatura (válida, inválida, timestamp velho, várias assinaturas), classificador
  (paridade de assuntos), handler do webhook com RPC falso, backfill com fetch falso,
  validação de período. A precedência do upsert e a agregação são testadas numa suíte psql em
  `supabase/tests/` (roda no CI).
- Rótulos do Admin num mapa `type → rótulo`; tipo desconhecido mostra o valor cru.
- Testes Vitest para a view-model da página (cálculo de taxas, limiares, ordenação).

## Ordem de deploy

1. Migration (tabelas + funções SQL). Aditiva, segura antes de tudo.
2. No painel do Resend, criar o endpoint `https://<ref>.supabase.co/functions/v1/resend-webhook`
   com os sete eventos `email.*` acima e copiar o segredo de assinatura.
3. `supabase secrets set` de `RESEND_WEBHOOK_SECRET` via `--env-file` temporário (nunca na
   linha de comando), depois deploy de `resend-webhook` (`--no-verify-jwt`). Conferir uma
   entrega 200 no painel do Resend (as anteriores ao deploy falharam e serão retentadas).
4. Redeploy dos remetentes com tags: `lifecycle-email-cron` primeiro (prazo do nurture), depois
   `notification-email-cron`, `client-event-email-cron`, `agenda-cliente-email`,
   `agenda-lembretes-email`, `instagram-connect-link`, `instagram-integration`,
   `report-worker`, `instagram-analytics`. Na janela, eventos sem tag classificam pelo fallback.
5. Redeploy de `platform-admin` (ações novas; antes da migration elas dão 500, o resto segue).
6. Merge (frontend do Admin). Depois, rodar o backfill uma vez pela página.

**Staging não tem `RESEND_API_KEY`** (conferido em 2026-11-06 pela lista de secrets): staging
não manda e-mail pelo Resend, então a conta só carrega envios de prod e não há contaminação
entre ambientes. Em staging sobem só a migration e o `platform-admin` (página vazia); não se
cria endpoint de webhook para staging. Se um dia staging ganhar chave do Resend, tem que ser
outra conta, ou uma tag de ambiente em todo envio.

**Dois PRs (minha decisão):** um rollout de `main` sobrescreve function deployada de branch.
Para as tags do nurture não sumirem por um merge de outro PR no fim de semana:
- **PR A** (antes de segunda 09:00 SP): migration, `resend-webhook`, `_shared/email-classify.ts`
  (com os assuntos exportados como constantes) e as tags nos envios. Passos 1 a 4, depois merge.
- **PR B** (depois): ações `email-metrics`/`email-backfill` do `platform-admin` e a página do
  Admin. Passos 5 e 6.

**Rollback:** remover o endpoint no Resend para de alimentar; a página segue mostrando o que
já tem. Reverter as tags é seguro (o fallback classifica). A tabela pode ficar.

## O que fica para o builder

- Estrutura de componentes da página e o gráfico, seguindo `pages/metricas`.
- Nomes exatos de funções e arquivos fora dos fixados aqui.
- Detalhes do cursor da listagem do Resend.

## Decisões minhas (para revisão)

- Uma linha por e-mail com upsert monotônico, agregado por hora de envio.
- PII só em bounce/reclamação/falha, zerada em 90 dias.
- Tags só nos envios de remetente compartilhado; o resto classifica pelo remetente.
- Limiares de alerta 4% (bounce) e 0,08% (reclamação).
- Sem `GET /emails/metrics` como segunda fonte.
- Dois PRs (webhook e tags antes de segunda; página depois).
- Interno e Externo fora dos KPIs, do gráfico e da lista de bounces.
- Limpeza oportunista na função SQL em vez de cron novo.
