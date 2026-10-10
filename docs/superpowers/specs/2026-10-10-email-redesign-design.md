# Redesign dos e-mails transacionais

**Data:** 2026-10-10 · **Status:** visual aprovado; spec revisada após Fable + Codex
**Mockups aprovados:** https://claude.ai/artifact/Qy1HcETnuGdYDqr4MUj5T9

## 1. Objetivo

Os e-mails transacionais têm hoje um terceiro visual (verde `#1a3d2b` sobre creme
`#f5f3ee`, Arial, emoji como ícone) que não existe no produto, larguras diferentes
(440, 520 e 560px), prévia de inbox só em parte deles e quatro cópias do mesmo
layout. O redesign leva todos para a linguagem do CRM (Mesaas Design System):
fundo neutro, cartão branco com linha fina, tinta como cor de ação, amarelo só
como marca pequena, fonte do sistema. Um módulo compartilhado substitui as cópias.

Decisões do dono (2026-10-10):
1. **Tinta** (`#12151a`) é a cor de ação dos e-mails do Mesaas. A alternativa
   verde foi descartada.
2. **A faixa cheia na cor da agência fica** nos e-mails para o cliente final
   (`buildBrandHeaderBand`). Não adotamos a régua de 4px + monograma dos mockups;
   o resto do mockup whitelabel (corpo, linhas, blocos, rodapé) vale.

## 2. Inventário (12 builders, 2 famílias)

### Família Mesaas (remetente Mesaas; destinatário é a agência ou alguém a pedido dela)

| E-mail | Builder | Function(s) que enviam |
|---|---|---|
| Boas-vindas | `_shared/lifecycle-emails.ts` `buildWelcomeEmail` | lifecycle-email-cron |
| Obrigado pelo plano | `lifecycle-emails.ts` `buildThankYouEmail` | lifecycle-email-cron |
| Resumo de notificações | `_shared/notification-email.ts` `buildDigestHtml` | notification-email-cron |
| Cobrança (first, retry, final) | `_shared/dunning-email.ts` `buildDunningEmail` | stripe-webhook, pagarme-webhook (via `dunning-notify.ts`) |
| Convite de equipe | `_shared/invite-email.ts` `buildInviteEmail` | invite-user, platform-admin (via `invite-actions.ts`) |
| Lembrete da Agenda | `_shared/agenda-email.ts` `buildLembreteEmail` | agenda-lembretes-email |
| Pedido de conexão do Instagram | `_shared/instagram-connect-email.ts` `buildConnectLinkEmail` | instagram-connect-link |
| Instagram conectado (aviso à agência) | `instagram-connect-email.ts` `buildConnectedNoticeEmail` | instagram-integration |
| Link do painel de afiliado | `affiliate-public/email.ts` `buildAffiliateLinkEmail` | affiliate-public |

### Família da agência (whitelabel, para o cliente final)

| E-mail | Builder | Function(s) |
|---|---|---|
| Pendências do cliente | `_shared/client-event-email.ts` `buildClientEventEmail` | client-event-email-cron |
| Evento compartilhado (convite, alteração, cancelamento, remarcação aceita/recusada; cliente e convidado) | `_shared/agenda-cliente-email.ts` `montarEmailAgendaCliente` | agenda-cliente-email |
| Relatório mensal | `_shared/report-template/email.ts` `buildReportEmail` | report-worker, instagram-analytics |

A matriz exata de variantes está no §7.

### Fora de escopo

- Avisos internos (`buildFounderSignupNotice` e afins em `lifecycle-emails.ts`,
  `_shared/notify.ts`, `retention-radar-cron/email.ts`): só a equipe lê.
- E-mails do Supabase Auth (confirmação, redefinição de senha): templates no
  painel do Supabase, não no repositório.
- Página HTML de `client-email-unsub` (é página, não e-mail).
- Loops (marketing): templates no painel do Loops.

## 3. Sistema visual

Valores exatos do Mesaas Design System. Todos ficam em `EMAIL` (§4).

| Papel | Valor |
|---|---|
| Fundo da página | `#f5f6f8` (`surface-1`) |
| Cartão | `#ffffff`, borda `1px solid #e5e7eb`, `border-radius: 12px` |
| Divisória interna | `1px solid #eef0f3` |
| Título | `#12151a`, 24px/30px, 700, `letter-spacing: -0.01em` (até 600px: 22/28) |
| Corpo | `#374151`, 15px/24px |
| Apoio (contexto, datas, avisos) | `#4b5563`, 13px/20px; rodapé 12/18 |
| Botão principal | fundo `#12151a`, texto `#ffffff`, `border-radius: 10px`, 14px 600, padding 13px 24px |
| Botão secundário | fundo `#ffffff`, texto `#12151a`, borda `1px solid #d1d5db` |
| Marca | `#ffbf30`, só como ponto de 8px no rótulo e no avatar da assinatura |
| Destaque | fundo `#f5f6f8`, `border-radius: 10px`, padding 16px 18px |
| Alerta | fundo `#fee2e2`, borda `#fecaca`, texto `#b91c1c` |
| Selos (fundo/texto/borda) | danger `#fee2e2/#b91c1c/#fecaca`, warning `#fef3c7/#b45309/#fde68a`, info `#dbeafe/#1d4ed8/#bfdbfe`, success `#dcfce7/#15803d/#bbf7d0`, neutro `#f1f5f9/#475569/#e2e8f0` |
| Formato de post (só em linhas de post) | feed `#eab308`, carrossel `#3ecf8e`, reels `#e1306c`, stories `#42c8f5`; tipo desconhecido `#64748b` |
| Fonte | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif` |

Pares de texto devem passar 4.5:1 no fundo onde aparecem. O plano confere cada
par com uma conta (teste com a fórmula WCAG), não de cabeça.

**Layout:** tabela externa 100% com fundo `#f5f6f8`; cartão `width="560"` com
`style="width:100%;max-width:560px"` (Outlook respeita o atributo `width`);
padding interno 40px inline, reduzido a 24px abaixo de 600px por `@media` num
`<style>` no `<head>`. Cliente que remove `<style>` só perde o ajuste mobile.
Rodapé fora do cartão, alinhado à esquerda com o conteúdo. Abaixo de 600px os
botões ocupam a largura toda e a grade 2×2 das boas-vindas empilha (mesma
`@media`, por classe).

**Cabeçalho Mesaas:** logo preto à esquerda, 158×20, sobre branco, divisória
abaixo. Abaixo dele, o rótulo de categoria (ponto amarelo + texto 13px 600
`#4b5563`): "Boas-vindas", "Resumo de notificações", "Assinatura", "Convite",
"Agenda", "A pedido de {agência}", "Instagram", "Programa de afiliados". No
último aviso de cobrança o ponto é `#dc2626` e o texto `#b91c1c`.

**Cabeçalho da agência:** `buildBrandHeaderBand` continua como está (faixa
cheia na cor da agência, nome e logo, mesmo markup), então `brand-header_test.ts`
não muda. O cartão em volta perde `box-shadow` e passa a 12px de raio com a
borda do sistema. Botão principal na cor da agência, texto por
`pickHeaderTextColor`.

**Sem emoji como ícone.** Linhas de post usam um selo com ponto na cor do
formato e o nome ("Feed", "Carrossel", "Reels", "Stories"; desconhecido:
"Post"). Eventos usam o bloco de data (§4, `dateTile`). Mensagens não lidas
viram um destaque sem ícone. Emoji em assunto continua permitido.

**Modo escuro:** fora. Todo e-mail fixa o tema claro com
`<meta name="color-scheme" content="light">` e
`<meta name="supported-color-schemes" content="light">`, e todos os fundos ficam
explícitos (página, cartão, botões). Clientes que invertem à força (Gmail iOS,
Outlook) escurecem o cartão mas não as imagens: um logo preto sumiria. Mitigação:
o PNG do logo leva um contorno branco de 2px em volta dos glifos, invisível no
cartão branco e legível num cartão invertido.

**Outlook (motor Word):** só tabelas, nada de flex/grid. Botão como tabela de
uma célula com `bgcolor` e `<a>` dentro (padding em `<a>` some no Outlook). Raio
degrada para quina reta, aceito.

## 4. Arquitetura

Novo `supabase/functions/_shared/email/`. **Não importa nada dos módulos de
builder** (evita o ciclo `client-event-email.ts` ↔ `agenda-cliente-email.ts`,
cujo cabeçalho proíbe o import reverso).

- `tokens.ts`: `EMAIL` (cores e fontes da §3), `FONT_STACK` e
  `EMAIL_LOGO_URL = "https://www.mesaas.com.br/logo-black-email.png"`.
  O logo é um asset de marca, igual em todo ambiente, então vira constante
  absoluta. Usa `www.` porque o domínio raiz responde 308. Com isso nenhum
  builder precisa de `appBaseUrl` só para o logo, e convite, cobrança e afiliado
  mantêm a assinatura sem depender de `APP_BASE_URL` (que lança sem a secret).
- `safe.ts`: `linkSeguro` (com `URL_SEGURA = /^https?:\/\/[^\s\x00-\x1f\x7f]+$/i`)
  e `corSegura` (`^#[0-9a-fA-F]{6}$`, fallback `#eab308`), movidos de
  `agenda-cliente-email.ts`, que passa a importá-los daqui. Equivalente do
  `sanitizeUrl()` do frontend para as edge functions.
- `blocks.ts`: funções puras que devolvem HTML de tabela. Contrato:
  - Texto entra **cru** e é escapado por dentro; parâmetros terminados em
    `Html` são HTML confiável montado por outro bloco.
  - **Todo** parâmetro de URL (`href` ou `src`) passa por `linkSeguro` e depois
    por `escapeHtml`. URL inválida ou vazia: `button` devolve `""`; link
    inline (`link`, `fallbackLink`) devolve só o texto, sem `<a>`; imagem
    devolve `""`. Nunca lança.
  - Toda cor recebida de fora passa por `corSegura`.
  - Blocos: `heading`, `paragraph`, `eyebrow`, `button`
    (`variant: "ink" | "outline" | { brandColor }`), `link`, `steps`,
    `callout`, `alert`, `quote` (rótulo + texto, substitui `citacao`),
    `detailRows`, `badge`, `postRow`, `dateTile`, `eventCard`, `dateList`,
    `signature`, `fallbackLink`, `divider`.
  - `dateTile({ mes, dia, color })` recebe **strings já formatadas**. Quem chama
    calcula no fuso do evento com os helpers que já existem no próprio módulo.
- `shell.ts`:
  - `mesaasEmail({ preheader, eyebrow, eyebrowTone?, bodyHtml, footerLines })`
  - `brandedEmail({ preheader, workspaceName, brandColor, logoUrl, bodyHtml, footerHtml })`.
    Chama `buildBrandHeaderBand` (que devolve um `<tr>`, então entra dentro da
    tabela do cartão) com `brandColor` já passado por `corSegura` e `logoUrl`
    já passado por `linkSeguro` (`null` se inválido). Hoje
    `client-event-email.ts` e `report-template/email.ts` interpolam
    `brandColor` cru; isso acaba.

`buildBrandHeaderBand`, `buildPreheader` e `pickHeaderTextColor` ficam em
`report-template/brand-header.ts` só por compatibilidade (testes e imports
existentes); o shell os importa de lá.

Cada builder mantém nome, assinatura e tipo de retorno; só o corpo passa a
montar blocos e chamar o shell. Exceção aditiva: `DigestItem` ganha
`badge?: { tone, label }` **opcional** (ausente = selo neutro "Notificação"),
para os literais de teste existentes continuarem válidos sob `--no-check`.
Saem: `layout()` de `lifecycle-emails.ts` e os HTML inline de `dunning-email.ts`, `invite-email.ts`, `notification-email.ts`,
`affiliate-public/email.ts`, `client-event-email.ts`, `agenda-cliente-email.ts`
e `report-template/email.ts`. `noticeLayout` (aviso interno) fica.

`layout()` tem dois consumidores em produção, migrados no mesmo passo em que
ela sai: `agenda-email.ts` e `instagram-connect-email.ts` passam a chamar
`mesaasEmail` de `_shared/email/shell.ts`. Os demais imports deles de
`lifecycle-emails.ts` ficam onde estão (`sanitizeSubjectValue` nos dois;
`LIFECYCLE_FROM` e `sendViaResend` em `instagram-connect-email.ts`). Nenhum
teste importa `layout()`.

**Datas nos blocos de data:**
- `agenda-cliente-email.ts` exporta `mesDiaAgenda(o)`, ao lado de
  `formatarQuandoAgenda`, usando os mesmos helpers privados (`tzSegura`,
  `partes`). Linha de dia inteiro usa `data_inicio_local` como texto (nunca
  `inicio` convertido), como `formatarQuandoAgenda` já faz, para não errar o dia.
  `client-event-email.ts` importa dele (direção já existente).
- `agenda-email.ts` deriva mês/dia com seus próprios helpers (`ymd`, `tz`).
- Mês abreviado em pt-BR, caixa alta, sem ponto: "OUT".

**Preheader em todos.** Os que hoje não têm ganham um:

| E-mail | Preheader |
|---|---|
| Boas-vindas | "Três passos para deixar sua agência rodando." |
| Obrigado pelo plano | "Obrigado pela confiança no Mesaas." |
| Resumo | até 3 títulos, na ordem recebida (o cron já entrega por prioridade): "Falha ao publicar no Instagram, Correção solicitada pelo cliente e mais 1." |
| Cobrança | first/retry com data: "Vamos tentar novamente em {data}."; sem data: "Atualize sua forma de pagamento para manter o acesso."; final: "Sem um pagamento válido, o workspace vai para o plano Free." |
| Convite | "Defina sua senha para entrar no {workspace}." |
| Lembrete | `whenLine` mais o local, se houver |
| Conexão do Instagram | "{agência} pediu para conectar o Instagram de {cliente}." |
| Instagram conectado | "@{usuário} foi conectado a {cliente}." |
| Afiliado | "Seu link de divulgação, indicações e comissões." |

## 5. Mudanças por e-mail

Princípio: **a cópia atual fica**, salvo o que está listado aqui. A regra de
travessão vale para o texto **escrito por nós** (template, assunto, preheader,
avisos); conteúdo do usuário (nome de workspace, título de post, comentário,
resumo de IA) passa como está, só escapado.

- **Boas-vindas:** h1 "Olá, {nome}! Que bom ter você aqui." (sem nome: "Olá! Que
  bom ter você aqui."); o primeiro parágrafo perde o "Que bom ter você por aqui."
  repetido e fica "Aqui é o Eduardo, do Mesaas. Obrigado por criar sua conta."
  Os quatro cartões viram uma grade 2×2 com título e texto, sem emoji e sem
  ponto colorido. Os três passos viram lista numerada (círculo com contorno em
  tinta) com divisórias; "Importar meus dados" fica no passo 2. Central de Ajuda
  e Novidades num destaque. Assinatura com avatar "E" em amarelo e "Fundador do
  Mesaas". WhatsApp vira botão secundário (mesma regra de `waUrl`). Assunto
  passa a "Boas-vindas ao Mesaas 👋" (neutro em gênero).
- **Obrigado pelo plano:** passos numerados e assinatura; texto atual.
- **Resumo:** h1 "Você tem {n} novidades" (1 item: "Você tem 1 novidade"). Cada
  item: selo, título, contexto, corpo (comentário em destaque) e link "Abrir no
  Mesaas". Selos preenchidos por `resolveDigestItem`:

  | Tipo | Tom | Rótulo |
  |---|---|---|
  | `post_publish_failed` | danger | Falha na publicação |
  | `post_correction` | warning | Correção |
  | `post_approved` | success | Aprovado |
  | `post_message`, `client_message` | info | Mensagem |
  | `mention` | info | Menção |
  | `deadline_approaching` | warning | Prazo |
  | `task_assigned` | neutro | Tarefa |
  | `post_assigned` | neutro | Post |
  | `event_invited`, `event_updated`, `event_cancelled` | neutro | Agenda |
  | `event_client_rsvp`, `event_guest_rsvp` | info | Resposta |
  | `event_reschedule_requested` | warning | Remarcação |
  | qualquer outro | neutro | Notificação |

  Sem botão final (não existe página de central de notificações).
- **Cobrança:** h1 = `copy.heading`. Quadro de detalhes com Workspace e, quando
  há data, Próxima tentativa. Como a data passa a morar no quadro,
  `buildDunningCopy` deixa de pôr a frase "Vamos tentar novamente em {data}." no
  `body` (o teste "names the retry date" passa a olhar o quadro/preheader).
  Último aviso: rótulo vermelho e a consequência num alerta. Botão em tinta nos
  três estágios (hoje o final é vermelho). Assuntos trocam " — " por ": "
  (`Não conseguimos processar seu pagamento: {ws}` e
  `Ainda não conseguimos processar seu pagamento: {ws}`). Mantém "Se você já
  atualizou seu pagamento, pode ignorar este e-mail." Nenhum convite a
  responder: `cobranca@` não tem `reply_to` garantido.
- **Convite:** texto atual + link de reserva ("Se o botão não funcionar, copie
  e cole este endereço no navegador:").
- **Lembrete:** cartão de evento com bloco de data, título, quando, local e
  "Entrar na reunião" (via `linkSeguro`). Botão "Abrir na Agenda" (hoje "Abrir
  na agenda").
- **Conexão do Instagram:** rótulo "A pedido de {agência}", h1 "Conecte o
  Instagram de {cliente}", o texto atual dividido em três passos, botão, link de
  reserva e "Não esperava este pedido?".
- **Instagram conectado:** rótulo "Instagram", h1 "Instagram conectado", texto
  atual, botão "Ver o cliente".
- **Afiliado:** rótulo "Programa de afiliados", texto atual, botão "Abrir meu
  painel", aviso de link pessoal ao pé do cartão.
- **Pendências do cliente:** linhas de post com selo de formato (até
  `RENDERED_POSTS_CAP`, como hoje), eventos com bloco de data na cor da agência
  (cada evento pendente tem o seu, na ordem recebida), mensagens num destaque,
  botão na cor da agência. Em produção o e-mail nunca sai sem `hubUrl` (o cron
  conta `skippedNoHub` e libera o lease antes de chamar o builder, e isso não
  muda); o builder mantém o caminho defensivo de hoje (sem botão) só para
  chamada direta. Saudação com o
  primeiro nome (como hoje).
- **Evento compartilhado:** a **semântica não muda**: mesmas 5 variantes, mesmo
  texto, mesmo anexo `.ics` e mesma regra de quando anexar, mesmo botão e
  destino (`Confirmar presença` / `Ver no portal` / `Responder ao convite`, e
  nenhum botão para convidado em cancelamento). Muda só a apresentação:
  - `eventCard` para a **primeira ocorrência ativa**, com bloco de data dela,
    título, quando, local, "Organizado por {nome}" se houver, e "Entrar na
    reunião". Série: abaixo do cartão, a lista de datas atual (`dateList`, até
    `DIAS_LISTADOS`, depois "e mais N datas"), mantendo um `<li>` por data.
  - Descrição numa linha abaixo do cartão.
  - Datas canceladas: lista atual, riscada, num destaque; sem bloco de data.
    Cancelamento total não tem cartão.
  - "Mensagem da equipe" vira `quote`.
  - Saudação com o **nome completo** (clientes costumam ser empresas).
  - O e-mail do convidado continua sem a palavra "portal" em lugar nenhum
    (teste existente); o rodapé whitelabel não a usa.
- **Relatório mensal:** KPIs em blocos com borda. A regra de ausência fica igual:
  sem `emailKpis`, a fila some; métrica ausente some sozinha (de 0 a 3 blocos);
  delta com as mesmas cores e sinais. "Destaque do mês" num destaque; botão
  "Ver relatório completo" (hoje em caixa de título); "Baixar em PDF" como link.

Rodapé dos e-mails Mesaas: motivo do envio (texto atual de cada um, quando
existe) + "Mesaas · Plataforma de gestão para agências de social media".
Whitelabel: "Enviado por {agência} via Mesaas", e o link de descadastro onde ele
já existe (pendências e evento compartilhado). O relatório mensal **não tem**
descadastro hoje (`buildReportEmail` não recebe URL e `client-email-unsub` só
desliga `send_event_email`) e continua sem: um opt-out de relatório é decisão de
produto à parte, fora deste redesign. "gestão
inteligente para social media managers" sai de todos.

## 6. Logo

Novo `public/logo-black-email.png`, gerado de `public/logo-black.svg` a 474×60
(3× de 158×20), fundo transparente, com o contorno branco de 2px da §3.
`logo-white-email.png` fica: e-mails antigos nas caixas de entrada apontam para
ele, **não apagar**. `alt="Mesaas"` com estilo (tinta, 18px, 700) para quem
bloqueia imagem.

## 7. Testes

**Matriz de fixtures** (contrato e verificação visual usam a mesma):

| Builder | Variantes |
|---|---|
| Boas-vindas | com nome + WhatsApp; sem nome e sem WhatsApp |
| Obrigado pelo plano | 1 |
| Resumo | 1 item; 3 itens de tons diferentes; item sem `badge` |
| Cobrança | first com data; retry sem data; final |
| Convite | 1 |
| Lembrete | com hora, local e link; dia inteiro |
| Conexão do Instagram | 1 |
| Instagram conectado | 1 |
| Afiliado | 1 |
| Pendências | posts + eventos + mensagens; só eventos; sem `hubUrl` (só no teste de contrato, fora da verificação visual: estado inalcançável em produção) |
| Evento compartilhado | convite (cliente, ocorrência única); convite de série com 12 datas; alteração com datas canceladas; cancelamento; remarcação aceita com mensagem; remarcação recusada; convite para convidado; cancelamento para convidado; dia inteiro |
| Relatório | 3 KPIs com delta; 1 KPI; sem KPIs; sem `hubUrl` |

**Contrato** (`__tests__/email-shell_test.ts` + um teste por fixture):
`color-scheme` presente; preheader não vazio; cartão 560; fundos explícitos;
nenhum `—` no HTML com fixtures sem `—`; nenhum dos emoji antigos de ícone
(`🖼 🗂 🎬 📱 📅 💬 👥 📋 ✅ 📈 📚`); cada bloco escapa texto cru (payload com
`<script>` e `"`); `javascript:`, `data:` e vazio em URL não geram `href`/`src`;
`brandColor` inválido cai no padrão; contraste dos pares de texto ≥ 4.5:1.

**Asserções que mudam de propósito:**
- `lifecycle-emails_test.ts`: logo branco (:54), `#f5f3ee` (:250),
  `WELCOME_SUBJECT` (:116).
- `client-event-email_test.ts`: emoji de formato (:134-145), `#f8f9fa` (:154),
  substring do botão `background: #1a3d2b; color: #ffffff` (:195), raio 16
  (:262-265), rodapé creme (:268-271).
- `client-event-email-cron_test.ts`: emoji no HTML enviado (:319-320).
- `report-email_test.ts`: raio 16, creme, slogan (:13-15), `#f8f9fa` (:56).
- `agenda-email_test.ts`: "Abrir na agenda" (:73).
- `dunning-email_test.ts`: assuntos e a frase da data no `body`.
- `agenda-cliente-email_test.ts`: conferir que `<li` = 10 (:250) e a ausência de
  "portal" (:504) continuam valendo.
- `notification-email_test.ts`: literais sem `badge` continuam válidos
  (campo opcional).

Antes de mexer, grep em `supabase/functions/__tests__` e
`supabase/functions/_shared/**/*.test.ts`. Nenhum código de Admin, CRM ou e2e
renderiza esses builders.

**Verificação visual:** script descartável no scratchpad renderiza a matriz e
tira screenshot (Chrome headless) em 640 e 375px, para comparar com os mockups.
Envio real para uma caixa de teste só com OK do dono.

## 8. Deploy

O logo vem sempre de `https://www.mesaas.com.br/` (§4), então staging e prod
dependem do mesmo asset, publicado pelo deploy de produção do frontend.

1. Merge do PR → Vercel publica `public/logo-black-email.png` em prod.
2. Conferir `curl -sI https://www.mesaas.com.br/logo-black-email.png` → `200`
   e `content-type: image/png`. Sem 200, não deployar nada.
3. Redeploy em **staging**, depois em **prod**, das functions que empacotam
   módulos alterados, todas com `--no-verify-jwt` (todas têm `verify_jwt =
   false` em `supabase/config.toml`) e `--use-api`: lifecycle-email-cron,
   loops-sync-cron, notification-email-cron, stripe-webhook, pagarme-webhook,
   invite-user, platform-admin, agenda-lembretes-email, instagram-connect-link,
   instagram-integration, affiliate-public, client-event-email-cron,
   client-email-unsub, agenda-cliente-email, report-worker, instagram-analytics.
   (instagram-report-generator-v2 importa só um tipo e não muda.) O plano
   confirma a lista com `deno info` em cada `index.ts`.
4. Sem migração.

**Rollback:** redeploy das functions a partir do commit anterior ao merge. O
asset novo pode ficar publicado (nada o usa sem as functions novas).

## 9. Riscos

- **Clientes de e-mail:** alvos são Gmail (web e app), Apple Mail e Outlook
  desktop. Outlook perde raio; aceito.
- **Modo escuro forçado:** mitigado pelo contorno branco no logo (§3); cores do
  corpo podem inverter, como hoje.
- **Deploy parcial:** function não redeployada mantém o visual antigo. A lista
  do §8 fecha isso.
- **Dependência de prod para o logo em staging:** e-mails de staging mostram o
  logo de prod. Aceito: o asset é o mesmo.
