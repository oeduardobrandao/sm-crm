# Redesign dos e-mails transacionais

**Data:** 2026-10-10 · **Status:** visual aprovado, spec em revisão
**Mockups aprovados:** https://claude.ai/artifact/Qy1HcETnuGdYDqr4MUj5T9

## 1. Objetivo

Os e-mails transacionais têm hoje um terceiro visual (verde `#1a3d2b` sobre creme
`#f5f3ee`, Arial, emoji como ícone) que não existe no produto, larguras diferentes
(440, 520 e 560px), prévia de inbox só em parte deles e quatro cópias do mesmo
layout. O redesign leva todos para a linguagem do CRM (Mesaas Design System):
fundo neutro, cartão branco com linha fina, tinta como cor de ação, amarelo só
como marca pequena, fonte do sistema. Um módulo de shell compartilhado substitui
as cópias.

Decisões do dono (2026-10-10):
1. **Tinta** (`#12151a`) é a cor de ação dos e-mails do Mesaas. A alternativa
   verde foi descartada.
2. **A faixa cheia na cor da agência fica** nos e-mails para o cliente final
   (`buildBrandHeaderBand`). Não adotamos a régua de 4px + monograma dos mockups;
   o resto do mockup whitelabel (corpo, linhas, blocos, rodapé) vale.

## 2. Inventário (14 e-mails, 2 famílias)

### Família Mesaas (remetente Mesaas; destinatário é a agência ou alguém a pedido dela)

| E-mail | Builder | Function(s) que enviam |
|---|---|---|
| Boas-vindas | `_shared/lifecycle-emails.ts` `buildWelcomeEmail` | lifecycle-email-cron |
| Obrigado pelo plano | `lifecycle-emails.ts` `buildThankYouEmail` | lifecycle-email-cron |
| Resumo de notificações | `_shared/notification-email.ts` `buildDigestHtml` | notification-email-cron |
| Cobrança (3 estágios) | `_shared/dunning-email.ts` `buildDunningEmail` | stripe-webhook, pagarme-webhook (via `dunning-notify.ts`) |
| Convite de equipe | `_shared/invite-email.ts` `buildInviteEmail` | invite-user, platform-admin (via `invite-actions.ts`) |
| Lembrete da Agenda | `_shared/agenda-email.ts` `buildLembreteEmail` | agenda-lembretes-email |
| Pedido de conexão do Instagram | `_shared/instagram-connect-email.ts` `buildConnectLinkEmail` | instagram-connect-link |
| Instagram conectado (aviso à agência) | `instagram-connect-email.ts` `buildConnectedNoticeEmail` | instagram-integration |
| Link do painel de afiliado | `affiliate-public/email.ts` `buildAffiliateLinkEmail` | affiliate-public |

### Família da agência (whitelabel, para o cliente final)

| E-mail | Builder | Function(s) |
|---|---|---|
| Pendências do cliente | `_shared/client-event-email.ts` `buildClientEventEmail` | client-event-email-cron |
| Evento compartilhado (5 variantes, cliente e convidado) | `_shared/agenda-cliente-email.ts` `montarEmailAgendaCliente` | agenda-cliente-email |
| Relatório mensal | `_shared/report-template/email.ts` `buildReportEmail` | report-worker, instagram-analytics |

### Fora de escopo

- Avisos internos (`buildFounderSignupNotice` e afins em `lifecycle-emails.ts`,
  `_shared/notify.ts`, `retention-radar-cron/email.ts`): só a equipe lê.
- E-mails do Supabase Auth (confirmação de cadastro, redefinição de senha): os
  templates vivem no painel do Supabase, não no repositório.
- Página HTML de `client-email-unsub` (é página, não e-mail).
- Loops (marketing): templates no painel do Loops.

## 3. Sistema visual

Valores exatos do Mesaas Design System. Todos ficam em `EMAIL` (ver §4).

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
| Selos (fundo/texto/borda) | danger `#fee2e2/#b91c1c/#fecaca`, warning `#fef3c7/#b45309/#fde68a`, info `#dbeafe/#1d4ed8/#bfdbfe`, neutro `#f1f5f9/#475569/#e2e8f0` |
| Formato de post (só em linhas de post) | feed `#eab308`, carrossel `#3ecf8e`, reels `#e1306c`, stories `#42c8f5` |
| Fonte | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif` |

Pares de texto passam 4.5:1 no fundo onde aparecem (`#4b5563` em `#f5f6f8` ≈
7:1; `#b91c1c` em `#fee2e2` ≈ 5.4:1; `#b45309` em `#fef3c7` ≈ 4.6:1). O plano
confere cada par com uma conta, não de cabeça.

**Layout:** tabela externa 100% com fundo `#f5f6f8`; cartão `width="560"` com
`style="width:100%;max-width:560px"`; padding interno 40px, 24px abaixo de 600px
via `@media` num `<style>` no `<head>` (o padding desktop fica inline como
base, então cliente sem suporte a `<style>` só perde o ajuste mobile). Rodapé
fora do cartão, alinhado à esquerda com o conteúdo. Botões ocupam a largura
toda abaixo de 600px (mesma `@media`).

**Cabeçalho Mesaas:** logo preto (`logo-black-email.png`) à esquerda, 158×20,
sobre branco, divisória abaixo. Abaixo dele, o rótulo de categoria (ponto
amarelo + texto 13px 600 `#4b5563`): "Boas-vindas", "Resumo de notificações",
"Assinatura", "Convite", "Agenda", "A pedido de {agência}", "Programa de
afiliados". No último aviso de cobrança o ponto é `#dc2626` e o texto `#b91c1c`.

**Cabeçalho da agência:** `buildBrandHeaderBand` continua (faixa cheia na cor
da agência, nome e logo). Mudança: o cartão perde `box-shadow` e passa a 12px de
raio com a borda do sistema. A faixa em si não muda (alinhamento e tamanho
atuais), então `brand-header_test.ts` não muda. Botão principal na cor da
agência com texto por `pickHeaderTextColor`.

**Sem emoji como ícone.** Linhas de post usam um selo com ponto na cor do
formato e o nome do formato ("Feed", "Carrossel", "Reels", "Stories"; tipo
desconhecido cai em "Post" com ponto neutro `#64748b`). Eventos usam o bloco de
data (mês abreviado em caixa alta sobre o dia, no fuso do evento; topo em tinta
na família Mesaas, na cor da agência na whitelabel, texto por
`pickHeaderTextColor`). Mensagens não lidas viram um destaque sem ícone. Emoji
em assunto continua permitido.

**Modo escuro:** fora. Todo e-mail fixa o tema claro com
`<meta name="color-scheme" content="light">` e
`<meta name="supported-color-schemes" content="light">`, e todos os fundos ficam
explícitos (página, cartão, botões).

**Outlook (motor Word):** só tabelas, nada de flex/grid. Botão como tabela de
uma célula com `bgcolor` e `<a>` dentro (padding em `<a>` some no Outlook). Raio
degrada para quina reta, aceito.

## 4. Arquitetura

Novo `supabase/functions/_shared/email/`:

- `tokens.ts`: `EMAIL` (cores e fontes da §3) e `FONT_STACK`.
- `blocks.ts`: funções puras que devolvem HTML de tabela. Recebem texto **cru**
  e escapam por dentro; parâmetros terminados em `Html` são HTML confiável
  montado por outro bloco. URLs passam por `escapeHtml` (como hoje) e o
  `button` só aceita `http(s)://`. Blocos: `heading`, `paragraph`, `eyebrow`,
  `button` (`variant: "ink" | "outline" | { brandColor }`), `steps`, `callout`,
  `alert`, `detailRows`, `badge`, `postRow`, `dateTile`, `eventCard`,
  `signature`, `fallbackLink`, `divider`.
- `shell.ts`:
  - `mesaasEmail({ preheader, eyebrow, eyebrowTone?, bodyHtml, footerLines, appBaseUrl })`
  - `brandedEmail({ preheader, workspaceName, brandColor, logoUrl, bodyHtml, footerHtml })`
    (usa `buildBrandHeaderBand` e `buildPreheader`, que ficam em
    `report-template/brand-header.ts` porque o relatório em PDF também os usa).

Cada builder mantém nome, assinatura e tipo de retorno; só o corpo passa a
montar blocos e chamar o shell. Saem: `layout()` de `lifecycle-emails.ts` (hoje
usada também por `agenda-email.ts` e `instagram-connect-email.ts`) e os HTML
inline de `dunning-email.ts`, `invite-email.ts`, `notification-email.ts`,
`affiliate-public/email.ts`, `client-event-email.ts`, `agenda-cliente-email.ts`
e `report-template/email.ts`. `noticeLayout` (aviso interno) fica como está.

**Preheader em todos.** Os que hoje não têm ganham um:

| E-mail | Preheader |
|---|---|
| Boas-vindas | "Três passos para deixar sua agência rodando." |
| Obrigado pelo plano | "Obrigado pela confiança no Mesaas." |
| Resumo | até 3 títulos de itens: "Falha ao publicar no Instagram, Correção solicitada pelo cliente e mais 1." |
| Cobrança | first/retry com data: "Vamos tentar de novo em {data}."; sem data: "Atualize sua forma de pagamento para manter o acesso."; final: "Sem um pagamento válido, o workspace vai para o plano Free." |
| Convite | "Defina sua senha para entrar no {workspace}." |
| Lembrete | `whenLine` mais o local, se houver |
| Conexão do Instagram | "{agência} pediu para conectar o Instagram de {cliente}." |
| Instagram conectado | "@{usuário} foi conectado a {cliente}." |
| Afiliado | "Seu link de divulgação, indicações e comissões." |

## 5. Mudanças por e-mail

Princípio: **a cópia atual fica**, salvo o que está listado aqui. Nada de
travessão (—) em texto do usuário.

- **Boas-vindas:** h1 "Olá, {nome}! Que bom ter você aqui." (sem nome: "Olá! Que
  bom ter você aqui."). Os quatro cartões viram uma grade 2×2 com título e
  texto, sem emoji e sem ponto colorido (empilha abaixo de 600px). Os três
  passos viram lista numerada (círculo com contorno em tinta) com divisórias;
  "Importar meus dados" fica no passo 2. Central de Ajuda e Novidades num
  destaque. Assinatura com avatar "E" em amarelo e "Fundador do Mesaas".
  WhatsApp vira botão secundário (mesma regra de `waUrl`). Assunto passa a
  "Boas-vindas ao Mesaas 👋" (neutro em gênero).
- **Obrigado pelo plano:** passos numerados e assinatura; texto atual.
- **Resumo:** h1 "Você tem {n} novidades" (1 item: "Você tem 1 novidade"). Cada
  item: selo, título, contexto, corpo (comentário em destaque) e link "Abrir no
  Mesaas" sublinhado. Selo por tipo, num campo novo `badge: { tone, label }` em
  `DigestItem` preenchido por `resolveDigestItem`:
  `post_publish_failed` danger "Falha na publicação"; `post_correction` warning
  "Correção"; `post_message`/`client_message` info "Mensagem"; `mention` info
  "Menção"; `deadline_approaching` warning "Prazo"; `task_assigned` neutro
  "Tarefa"; `post_assigned` neutro "Post"; qualquer outro tipo neutro
  "Notificação". Sem botão final (não há página de central de notificações).
- **Cobrança:** h1 = `copy.heading`. Quadro de detalhes (Workspace; Próxima
  tentativa só com data). Último aviso: rótulo vermelho e a consequência num
  alerta. Botão em tinta nos três estágios (hoje o final é vermelho). Assuntos
  trocam " — " por ": " (`Não conseguimos processar seu pagamento: {ws}` e
  `Ainda não conseguimos processar seu pagamento: {ws}`). Rodapé "Dúvidas?
  Responda este e-mail." (sem afirmar o papel de quem recebe).
- **Convite:** texto atual + link de reserva ("Se o botão não funcionar, copie
  e cole este endereço no navegador:").
- **Lembrete:** cartão de evento com bloco de data, título, quando, local e
  "Entrar na reunião". Botão "Abrir na Agenda" (hoje "Abrir na agenda").
- **Conexão do Instagram:** rótulo "A pedido de {agência}", h1 "Conecte o
  Instagram de {cliente}", o texto atual dividido em três passos, botão, link de
  reserva e "Não esperava este pedido?".
- **Instagram conectado:** h1 "Instagram conectado", texto atual, botão "Ver o
  cliente".
- **Afiliado:** rótulo "Programa de afiliados", texto atual, botão "Abrir meu
  painel", aviso de link pessoal ao pé do cartão.
- **Pendências do cliente:** linhas de post com selo de formato, eventos com
  bloco de data na cor da agência, mensagens num destaque, botão na cor da
  agência. Saudação continua com o primeiro nome (como hoje).
- **Evento compartilhado:** cartão de evento com bloco de data; descrição numa
  linha abaixo do cartão; "Organizado por {nome}" quando `organizador_nome`
  existe. Saudação continua com o **nome completo** (clientes costumam ser
  empresas, ver comentário em `agenda-cliente-email.ts`). Datas canceladas e
  mensagens da equipe usam destaque.
- **Relatório mensal:** KPIs em três blocos com borda, "Destaque do mês" num
  destaque, botão "Ver relatório completo" (hoje em caixa de título), "Baixar em
  PDF" como link.

Rodapé dos e-mails Mesaas: motivo do envio (texto atual de cada um) + "Mesaas ·
Plataforma de gestão para agências de social media". Whitelabel: "Enviado por
{agência} via Mesaas" + descadastro, como hoje. "gestão inteligente para social
media managers" sai de todos.

## 6. Logo

Novo `public/logo-black-email.png`, gerado de `public/logo-black.svg` a 474×60
(3× de 158×20), fundo transparente. `logo-white-email.png` fica: e-mails antigos
nas caixas de entrada apontam para ele, **não apagar**. `alt="Mesaas"` com estilo
(tinta, 18px, 700) para quem bloqueia imagem.

## 7. Testes

- Contrato do shell (`__tests__/email-shell_test.ts`): `color-scheme` presente;
  preheader presente; cartão 560; nenhum `—`; fundos explícitos; cada bloco
  escapa texto cru (payload com `<script>` e `"` em cada parâmetro de texto);
  `button` recusa URL que não seja http(s).
- Para cada um dos 14 e-mails: nenhum `—`, nenhum emoji antigo de ícone
  (`🖼 🗂 🎬 📱 📅 💬 👥 📋 ✅ 📈 📚`) no corpo, preheader não vazio.
- Asserções que fixam o visual antigo mudam de propósito:
  `lifecycle-emails_test.ts` (logo branco, `#f5f3ee`), `client-event-email_test.ts`
  (emoji de formato, raio 16, rodapé creme), `report-email_test.ts` (raio 16,
  creme, slogan), `dunning-email_test.ts` (assuntos). Grep nos dois `__tests__`
  (`supabase/functions/__tests__` e `_shared/**/*.test.ts`) antes de mexer.
- Verificação visual: script descartável no scratchpad renderiza os 14 com
  dados de exemplo e tira screenshot (Chrome headless) em 640 e 375px, para
  comparar com os mockups. Envio real para uma caixa de teste só com OK do dono.

## 8. Deploy

1. O merge publica o frontend na hora, e com ele `public/logo-black-email.png`.
2. **Depois** do merge (antes, o logo daria 404), redeploy das functions que
   empacotam módulos alterados: lifecycle-email-cron, loops-sync-cron,
   notification-email-cron, stripe-webhook, pagarme-webhook, invite-user,
   platform-admin, agenda-lembretes-email, instagram-connect-link,
   instagram-integration, affiliate-public, client-event-email-cron,
   client-email-unsub, agenda-cliente-email, report-worker, instagram-analytics,
   instagram-report-generator-v2. O plano confirma a lista com `deno info` em
   cada `index.ts`. `--no-verify-jwt` conforme CLAUDE.md; `--use-api`.
3. Staging primeiro, prod depois. Sem migração.

## 9. Riscos

- **Clientes de e-mail:** alvos são Gmail (web e app), Apple Mail e Outlook
  desktop. Outlook perde raio; aceito.
- **Modo escuro forçado** (Gmail iOS, Outlook) pode inverter cores apesar do
  `color-scheme`. É o mesmo risco de hoje.
- **Deploy parcial:** function não redeployada mantém o visual antigo. A lista
  do §8 fecha isso.
