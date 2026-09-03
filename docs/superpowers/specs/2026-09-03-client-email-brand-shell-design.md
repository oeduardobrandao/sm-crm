# Shell de marca nos e-mails ao cliente final — design

**Data:** 2026-09-03 · **Status:** aprovado (brainstorm com visual companion)

## Objetivo

Hoje, dos três e-mails revisados nesta conversa, um já usa o sistema visual que a
Mesaas estabeleceu para os próprios e-mails transacionais (`_shared/lifecycle-emails.ts`,
`_shared/notification-email.ts`: card 16px, rodapé creme `#f5f3ee` com a tag
"Mesaas · gestão inteligente para social media managers", família Arial). Os outros
dois — relatório mensal e Pendências do Hub — usam um shell genérico (card 12px,
sem rodapé de marca) e só tocam a cor do workspace no botão. Esta spec alinha os
dois à mesma família visual, usando a **cor real de cada workspace** como acento do
cabeçalho — não a cor da própria Mesaas, que é só do app.

## Escopo

**Dentro:**
- `supabase/functions/_shared/report-template/email.ts` (e-mail de relatório mensal)
- `supabase/functions/_shared/client-event-email.ts` (e-mail de Pendências do Hub,
  Fase 2 da Central de Notificações)

Mudança é de **shell** (cabeçalho, rodapé, radius) — as seções de conteúdo (resumo
de IA, lista de posts, contagem de mensagens, botões) mantêm estrutura e cópia
como estão hoje, com os ajustes pontuais listados abaixo.

**Fora (não mexe):**
- `_shared/notification-email.ts` (digest de notificações da equipe) — já usa a
  família alvo (verde `#1a3d2b`/creme, 16px). Nenhuma mudança.
- `_shared/lifecycle-emails.ts`, e-mails de convite/cobrança — já alinhados,
  fora desta spec.
- Dark mode em cliente de e-mail: nenhum e-mail da casa hoje responde a
  `prefers-color-scheme` (suporte inconsistente entre clientes de e-mail); não
  é objetivo desta mudança.
- Largura do card (560px) — inalterada.
- Família de fonte — inalterada. **Correção:** os dois builders afetados usam
  hoje `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  (`report-template/email.ts:54`, `client-event-email.ts:83`), não Arial —
  Arial/Helvetica é a família da OUTRA família visual
  (`lifecycle-emails.ts`/`notification-email.ts`). Esta spec não unifica
  fontes; cada família mantém a sua.

## Decisões de design (validadas em mockup)

### 1. Cabeçalho: faixa na cor real do workspace

Fundo da faixa = `workspaces.brand_color` — coluna `text`, `CHECK (brand_color ~
'^#[0-9a-fA-F]{6}$')` (`20260526100000_report_branding_columns.sql:11`), único
escritor `updateHubBranding` na aba Hub de Configurações
(`apps/crm/src/pages/configuracao/tabs/HubTab.tsx:818`) — **é a mesma cor que já
aparece no portal do cliente** via `resolveHubTheme`'s `config.accent`. Sem
workspace configurado, mantém o fallback já usado hoje: `#eab308`
(`report-worker/index.ts:209`).

**A cor da faixa nunca é substituída** — nem por uma versão "segura" nem por um
neutro. Somente o texto por cima muda.

### 2. Texto do cabeçalho: inverte por luminância, nunca troca a cor de fundo

Usa a fórmula de `relativeLuminance()` de `packages/hub-theme/theme.ts:36-39` —
**duplicada no módulo novo, NÃO importada**: edge functions não importam de
`packages/` por regra documentada da casa (`_shared/whatsapp.ts:4-6` explica que
compartilhar via packages/ arrastaria o build frontend inteiro para o edge; o
deploy só sobe assets de `supabase/functions/`). Copiar as ~4 linhas com
comentário citando o precedente, mesmo tratamento dado aos helpers de HMAC:

```
luminance = 0.2126*r + 0.7152*g + 0.0722*b   (r,g,b em 0-1, sem correção gamma —
                                               mantém o mesmo formato do precedente,
                                               não é a luminância WCAG "oficial")
texto = luminance > 0.55 ? '#171717' : '#ffffff'
```

**Diferença deliberada em relação ao Hub:** o Hub também tem uma segunda regra
(`lum > 0.85` no modo claro → substitui a cor de acento inteira por `#171717`).
Essa segunda regra **não** é usada aqui — o usuário rejeitou explicitamente trocar
a cor de fundo; só o texto inverte, a cor do workspace fica sempre visível.

### 3. Logo: avatar redondo ao lado do nome

Quando `workspaces.logo_url` está setado (`report-worker/index.ts:210`,
mesma coluna nos dois builders): renderiza como avatar circular — 40×40px, fundo
branco, anel sutil (`box-shadow: 0 0 0 2px rgba(255,255,255,.55)`) para se
destacar em qualquer cor de fundo independente da transparência do PNG do
cliente — colado à esquerda do nome do workspace, ambos centralizados na faixa.
Sem logo: mantém o fallback atual — só o nome centralizado (agora com a cor
calculada pela regra acima, em vez de nome colorido sobre fundo branco).

Detalhes do avatar: `<img>` de no máximo 32×32 centralizado dentro do círculo
de 40px, com `alt=""` (decorativo — o nome do workspace está literalmente ao
lado; alt com o nome faria leitores de tela anunciarem duas vezes, e com
imagens bloqueadas o nome adjacente já identifica o remetente).

Não existe precedente de logo sobre superfície colorida em nenhum lugar do
código (o Hub mantém o logo em área neutra) — este é o primeiro caso, decisão
nova.

### 3b. Markup do cabeçalho: tabela, nunca flex

Os mockups do companion usaram `display:flex` por conveniência de protótipo —
**o e-mail real NÃO pode**: flexbox não renderiza em Outlook desktop e em vários
clientes. A faixa é montada com o mesmo vocabulário de tabelas dos builders
atuais: uma tabela interna centralizada com duas células (`<td>` do avatar +
`<td>` do nome, `vertical-align: middle`). Degradações aceitas e deliberadas em
Outlook desktop (engine Word): `border-radius: 50%` do avatar vira quadrado e o
anel de `box-shadow` some — o logo continua legível sobre fundo branco, que é o
que importa; sem VML, sem hack condicional.

### 4. Rodapé: família creme

Troca o rodapé atual (branco/cinza, borda superior) pelo padrão de
`_shared/lifecycle-emails.ts:41-43` e `_shared/notification-email.ts:91`: fundo
`#f5f3ee`, texto `#888780`. Markup: cada builder MANTÉM sua estrutura de linhas
atual (`<p>` por linha — o rodapé de pendências tem um link dentro de um dos
`<p>`s e não ganha nada sendo reescrito no formato `<br>` do precedente); o que
muda é só fundo, cor de texto e cor do link (o link de descadastro herda o
`#888780` do rodapé, substituindo o `#9ca3af` atual).

Conteúdo por e-mail (os dois builders têm rodapés diferentes hoje — não unificar
o conteúdo, só o tratamento visual):
- **Relatório mensal** (`report-template/email.ts`, sem link de descadastro
  hoje): duas linhas — "Enviado por {workspace} via Mesaas" (texto já
  existente) + "Mesaas · gestão inteligente para social media managers" (linha
  nova, cópia idêntica ao rodapé de `lifecycle-emails.ts:44`, sem em-dash —
  usa `·`).
- **Pendências do Hub** (`client-event-email.ts:97-101`, já tem 3 linhas: nome
  do workspace, link de descadastro, mais a URL): mantém as linhas atuais
  (incluindo o link "Não quero mais receber esses avisos") e só troca a cor de
  fundo/texto para a paleta creme — não adiciona a tagline "gestão
  inteligente..." aqui, para não esticar ainda mais um rodapé que já tem 2
  linhas de conteúdo funcional.

### 5. Radius do card: 16px

Sobe de 12px (valor atual dos dois builders) para 16px, igualando
`lifecycle-emails.ts`/`notification-email.ts`.

### 6. Bloco "Destaque do mês" (resumo de IA): permanece neutro

Decisão explícita, não omissão: o bloco mantém fundo cinza `#f8f9fa` e rótulo
cinza, sem cor do workspace. A cor já aparece na faixa e no botão; um terceiro
lugar colorido pesaria num bloco de texto denso. **Aplica-se só ao e-mail de
relatório mensal** — o e-mail de Pendências do Hub não tem esse bloco.

### 7. Botões: fundo inalterado, texto segue a mesma regra de luminância

O botão primário ("Ver Relatório Completo" / "Ver no Hub") continua com
`brand_color` de fundo, mas o texto — hoje `#ffffff` fixo nos dois builders
(`report-template/email.ts:44`, `client-event-email.ts:77`) — passa a usar
`pickHeaderTextColor(brandColor)`, a MESMA regra do cabeçalho. Sem isso, a
seção 2 resolveria a faixa e deixaria o botão ilegível na mesma cor pálida.

Nota de fidelidade ao mockup: o mockup pálido aprovado mostrava o botão com
FUNDO escuro (`#171717`) — resolvê-lo pelo texto, mantendo o fundo na cor do
workspace, é a aplicação consistente da diretriz do usuário ("se o contraste
ficar ruim, mude a cor do texto") e da decisão 1 ("a cor nunca é substituída").
Divergência do mockup registrada aqui de propósito; se o usuário preferir o
fundo escuro do mockup, é uma troca de 1 linha.

Botão secundário (Baixar PDF, no relatório) continua neutro escuro `#1f2937`
com texto branco — não deriva da cor do workspace, não precisa da regra.

## De onde vem o resumo de IA (contexto, não muda com esta spec)

Gerado por `generateAINarrative()` em `_shared/report-template/ai.ts:201`, via
Gemini `gemini-2.5-flash`, disparado dentro do gerador do relatório
(`instagram-report-generator-v2/index.ts:996`) — não em tempo de envio do
e-mail. O prompt (`ai.ts:32-88`) exige pt-BR, proíbe inventar números, usa
`@handle` em vez do nome real do cliente, e pede JSON estruturado
(`executive_summary`, `detailed_analysis`, `recommendations`,
`suggested_goals`, validado em `ai.ts:94-195`). **Só `executive_summary`**
(50-500 caracteres) vira o texto do e-mail (`report-worker/index.ts:211`); os
demais campos ficam em `analytics_reports.ai_content` para o relatório
completo. Sem `GEMINI_API_KEY`, `ai_content` é `null` e o bloco inteiro some do
e-mail — comportamento já existente, sem mudança.

**Truncamento no e-mail:** apesar de `executive_summary` poder ter até 500
caracteres na geração, o builder do e-mail corta para os primeiros 300
(`report-template/email.ts:38`, `aiSummary.substring(0, 300)`) antes de
escapar e renderizar. Comportamento existente, mantido sem mudança por esta
spec — citado aqui porque a seção 6 (bloco permanece neutro) não altera essa
lógica, só a cor de fundo ao redor dela.

## Implementação: módulo compartilhado

Os dois builders (`report-template/email.ts`, `client-event-email.ts`) hoje
implementam cada um seu próprio `logoSection` com a mesma forma. A fórmula de
luminância e o markup do avatar/faixa seriam a terceira duplicação — em vez
disso, um módulo novo `_shared/report-template/brand-header.ts` exporta:

```ts
export function pickHeaderTextColor(brandColorHex: string): '#171717' | '#ffffff'
export function buildBrandHeaderBand(p: {
  workspaceName: string; brandColor: string; logoUrl: string | null;
}): string  // fragmento <tr><td>...</td></tr> pronto para os dois builders
```

**Contrato de escaping (explícito — evita HTML injetado):** `buildBrandHeaderBand`
recebe `workspaceName`/`logoUrl` **crus** (não escapados) e aplica `escapeHtml`
internamente antes de interpolar, no mesmo padrão que os dois builders já usam
hoje para esses campos (`report-template/email.ts:29,32`,
`client-event-email.ts:40,45` — ambos escapam antes de montar `logoSection`).
`brandColor` não passa por `escapeHtml`: é validado no banco pelo CHECK
`^#[0-9a-fA-F]{6}$` antes de chegar aqui, então é seguro interpolar direto (mesmo
tratamento que os builders já dão a ele hoje). Os builders chamadores passam os
valores crus recebidos em seus próprios parâmetros — não escapam antes de
chamar `buildBrandHeaderBand`, para não escapar duas vezes.

Testes do módulo cobrem nome de workspace e `logoUrl` hostis (`<script>`,
aspas, `&`) confirmando que a saída de `buildBrandHeaderBand` está escapada.

Ambos os builders substituem seu `logoSection` local por uma chamada a
`buildBrandHeaderBand`. Nenhuma mudança de assinatura pública dos dois builders
(`buildReportEmail`, `buildClientEventEmail`) — `brandColor`/`logoUrl` já são
parâmetros existentes.

## Testes

- **Unitários da fórmula:** `pickHeaderTextColor` — cor forte/escura → branco;
  cor pálida → escuro; caso de fronteira em torno de luminância 0.55; hex em
  MAIÚSCULAS (o CHECK aceita `[0-9a-fA-F]`); e o caso âncora do default:
  `#eab308` (fallback de quem nunca configurou marca) tem luminância ≈0.70 →
  **texto escuro** — é o comportamento esperado, não um bug a "consertar".
- **Unitários do markup:** `buildBrandHeaderBand` — fundo da faixa é sempre
  literalmente `brandColor` (nunca substituído); avatar presente se e somente
  se `logoUrl` setado; nome sempre presente; sem em-dash na saída; nome/URL
  hostis (`<script>`, `"`, `&`) saem escapados — nunca HTML cru interpolado.
- **Dos dois builders:** snapshot/contains — radius 16px no card; rodapé com
  fundo creme e conteúdo por builder conforme a seção 4; texto do botão
  primário segue `pickHeaderTextColor`; bloco de IA (só no relatório) permanece
  com fundo cinza `#f8f9fa` de antes.
- **Sweep de contract change (regra da casa):** `client-event-email_test.ts`
  já pina o markup atual do builder de pendências (16+ testes) — os que fixam
  cabeçalho/rodapé antigos DEVEM ser atualizados nesta mudança, não contornados.
  O builder de relatório NÃO tem teste hoje (verificado: nenhum arquivo
  `report-email*` em `supabase/functions/__tests__/`) — ganha o seu primeiro
  arquivo de teste como parte desta spec. Conferir também os testes do cron
  (`client-event-email-cron_test.ts`) que assertam sobre o HTML enviado.
- **Verificação visual manual:** HTML não é testável por fidelidade de
  renderização entre clientes de e-mail via unit test — antes do merge,
  renderizar os dois e-mails com o builder real (mesma técnica usada nesta
  conversa: script Deno chamando o builder direto) e checar visualmente com
  pelo menos uma cor forte e uma cor pálida de exemplo.

## Referências

- Precedente de luminância: `packages/hub-theme/theme.ts:36-39` (`relativeLuminance`)
- Família visual alvo: `supabase/functions/_shared/lifecycle-emails.ts:19-44`
  (`layout()`), `supabase/functions/_shared/notification-email.ts:83-92`
  (`buildDigestHtml`)
- Origem de `brand_color`: `apps/crm/src/pages/configuracao/tabs/HubTab.tsx:818`
  (escrita), `apps/crm/src/pages/configuracao/tabs/RelatoriosTab.tsx:165-169`
  (leitura, comentário confirma escritor único)
