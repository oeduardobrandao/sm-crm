# Customização visual dos relatórios de blocos — Design

Data: 2026-08-24. Decisões tomadas em brainstorming com visual companion
(mockups em `.superpowers/brainstorm/72049-1787584790/content/`). Estende o
relatório interativo de blocos (specs de 2026-08-20); o pipeline legado segue
intocado.

## Objetivo

Hoje a única customização visual é a cor de destaque (`layout.accent`). O
usuário passa a escolher, por relatório: **tema** (superfícies e clima),
**dupla de fontes** e **cor de destaque** — com o restante da paleta derivada
automaticamente da cor, com legibilidade garantida. A aparência viaja junto
com o layout, então templates capturam e reaplicam o visual.

## Decisões fechadas (com o usuário, no companion)

1. **Temas (presets)**: `clean` (o atual, refinado), `editorial` (papel creme,
   serifa, linhas finas no lugar de caixas), `bold` (cor da marca em capa,
   cartões tingidos e destaques preenchidos). Tema dark foi DESCARTADO na v1.
2. **Duplas de fontes** — as quatro entram no menu:
   | id | Display | Apoio |
   |---|---|---|
   | `system` | sistema (-apple-system…) | sistema |
   | `fraunces` | Fraunces | Instrument Sans |
   | `grotesk` | Space Grotesk | Inter |
   | `playfair` | Playfair Display | Source Sans 3 |
3. **Modelo de cor**: paleta DERIVADA — o usuário controla UMA cor (accent;
   default = brand_color do workspace congelado no snapshot) e dela derivamos
   os demais tons. Sem botões de fundo/tinta na v1.
4. **UI**: popover "Aparência" no cabeçalho do editor (não drawer).

## Schema

`ReportLayout` ganha duas chaves opcionais ao lado de `accent`:

```ts
theme?: "clean" | "editorial" | "bold";   // ausente = modo herdado (ver abaixo)
fonts?: "system" | "fraunces" | "grotesk" | "playfair"; // ausente = HERDAR (não "system")
```

- **Ausente = HERDADO, para AMBAS as chaves.** É o comportamento de hoje: com
  `theme` ausente, só os tokens de accent são aplicados; fundo, superfícies e
  tinta herdam da página em volta (no Hub, o whitelabel — inclusive paletas
  escuras — decide). Com `fonts` ausente, NENHUMA var de fonte é emitida — no
  Hub o relatório continua herdando a Instrument Sans do `.hub-root`, como
  hoje; `"system"` explícito é uma ESCOLHA (pilha do sistema), distinta de
  ausente. Isso torna "byte-idêntico para docs existentes" verdadeiro de
  fato. Escolher QUALQUER tema/dupla explícitos (inclusive `clean`/`system`)
  fixa a aparência nas três superfícies. O layout padrão do sistema NÃO seta
  `theme` nem `fonts` (docs novos nascem no modo herdado).
- `validateLayout` (TS) valida os enums de forma ESTRITA, como já faz com
  `accent`.
- **Migration de trigger obrigatória (sem coluna nova):** o layout é gravável
  direto via PostgREST, e a função `validate_report_layout` (migration
  20260821000010, compartilhada por `report_documents` e `report_templates`)
  hoje aceita `theme`/`fonts` com qualquer valor. Uma migration atualiza a
  função para validar os dois enums quando presentes — sem isso, valor
  inválido persiste apesar do validador TypeScript.
- Templates armazenam layout, logo "Salvar como template" e o template padrão
  do workspace carregam a aparência sem coluna nova.
- `stripAiTextForTemplate` NÃO remove `theme`/`fonts`/`accent` (aparência é
  parte do template; só o texto de IA sai).

## Tokens: `resolveReportTheme(layout, snapshot)`

Novo módulo no pacote compartilhado (`packages/report-blocks/theme.ts`),
substituindo o atual `resolveLayoutAccent` (que vira chamada interna).
Devolve o conjunto de CSS vars que o container do documento aplica inline
(editor, Hub e print usam o MESMO resolvedor). **No modo herdado** (`theme`
ausente) devolve SÓ `--rb-accent`, `--rb-accent-fg` e `--rb-accent-text` —
sem tokens de fundo/superfície/tinta; com `fonts` ausente, nenhuma var de
fonte (herança da página preservada nos dois eixos). Com tema explícito:

| Token | clean | editorial | bold |
|---|---|---|---|
| `--rb-accent` | cor escolhida | idem | idem |
| `--rb-accent-fg` | contraste sobre accent (resolveAccent, existente) | idem | idem |
| `--rb-accent-text` | accent escurecido até ≥ 4.5:1 sobre `--rb-bg` (uso como TEXTO) | idem, sobre o creme | idem clean |
| `--rb-soft` | tint claro do accent (~92% de mistura com branco) | tint sobre o creme | idem clean |
| `--rb-bg` | `#ffffff` | `#faf6ee` (creme) | `#ffffff` |
| `--rb-surface` | `#ffffff` | transparente | `--rb-soft` nos cartões de KPI |
| `--rb-border` | `rgba(0,0,0,0.08)` | hairline `rgba(42,33,24,0.25)`, só na base dos cartões | `tint médio do accent` |
| `--rb-ink` | `#12151a` | `#2a2118` | `#12151a` |
| `--rb-ink-soft` | ink a ~65% | idem | idem |
| `--rb-radius` | `12px` | `0` | `12px` |
| `--rb-font-display` | pela dupla | idem | idem |
| `--rb-font-body` | pela dupla | idem | idem |

Regras de derivação (REVISADAS 2026-08-24, decisão do usuário pós-implementação):

- **O clamp de luminância CAIU no pipeline de blocos.** Cor de marca clara é
  preservada nos PREENCHIMENTOS (capa, chips, tints do bold) com o foreground
  de maior contraste por cima; hex inválido segue caindo no neutro `#171717`.
  O `resolveAccent` legado (gerador A4) mantém o clamp, intocado.
- Usos como TRAÇO fino (barra de seção, linhas de gráfico, donut, barras de
  progresso, borda do chip de líder) migram para **`--rb-accent-line`**:
  accent escurecido em direção à tinta até ≥ 3:1 sobre o fundo (WCAG 1.4.11,
  contraste não-textual). Accent escuro/médio = identidade (docs existentes
  não mudam); só claro deriva.
- O foreground sobre o accent passa a ser escolhido por **razão de contraste
  WCAG real** (luminância relativa linearizada, não a heurística linear
  atual): entre `#ffffff` e a tinta do tema, vence o de maior razão. Garantia
  testável: o fg escolhido é sempre o de MAIOR contraste disponível, e ≥ 4.5:1
  sempre que o accent permitir (um cinza médio como `#808080` não tem nenhum
  fg com 4.5:1 — o teste cobre o caso e aceita o máximo disponível).
- Tints derivam do accent clampado por mistura sRGB (mesma técnica de
  `resolveHubTheme` em `apps/hub/src/theme.ts`).
- **`--rb-accent-text` (novo, background-aware):** a cor da marca usada COMO
  TEXTO (título de cabeçalho de seção no bold, chip "Formato líder") não pode
  ser o accent cru — `#00ff00` passa pelo clamp de luminância e tem 1,37:1
  sobre branco. O token escurece o accent progressivamente (mistura com a
  tinta do tema) até atingir ≥ 4.5:1 contra `--rb-bg`, com fallback final na
  própria tinta. Todo uso de accent-como-texto no pacote migra para este
  token; `--rb-accent` fica para preenchimentos e traços (com
  `--rb-accent-fg` por cima).
- Cores de delta (verde/vermelho) continuam fixas por tema (par claro no
  clean/bold; par terroso no editorial) — não derivam do accent, legibilidade
  de sinal vem antes de branding.
- Testes: `--rb-ink` sobre `--rb-bg` ≥ 4.5:1 nos três temas (valores fixos,
  verificáveis); fg do accent = escolha de contraste máximo, com extremos
  (branco, preto, amarelo puro, cinza médio) em teste unitário.

## Tokenização dos widgets

Estilo inline vence classe CSS — um "bloco de CSS de tema" sozinho não
consegue transformar cartões em cartões editorial de borda-na-base (a mesma
armadilha do fix de padding do PR #381). Por isso o chrome visual sai dos
widgets:

- Nova classe compartilhada **`.rb-card`** em `packages/report-blocks/styles.css`
  concentra o chrome dos cartões (surface, borda, raio), lendo os tokens via
  `var(--rb-*)` com fallback nos valores atuais. Os widgets REMOVEM `border`,
  `borderRadius` e `background` de cartão do estilo inline e usam a classe
  (conteúdo interno — tamanhos de fonte, espaçamentos internos — pode seguir
  inline).
- **Padding por modificador, não único** (os widgets hoje divergem de
  propósito): `.rb-card--pad` (1rem — KPIs, painéis de chart/audiência),
  `.rb-card--compact` (0.5rem 1rem — lista de publicações) e
  `.rb-card--flush` (0 — cards de top posts, onde a thumbnail encosta na
  borda com `overflow: hidden`). Cada widget declara o seu; os valores são os
  atuais, sem mudança visual.
- Variantes de tema restilizam `.rb-card` por classe no container
  (`rb-theme-editorial .rb-card { border: 0; border-bottom: 1px solid
  var(--rb-border); border-radius: 0; background: transparent; }`) — sem
  `!important`, porque não há mais inline competindo.
- Widgets NÃO ganham lógica condicional de tema; tokens + CSS de tema
  resolvem tudo.
- No modo herdado (`theme` ausente) os fallbacks das vars reproduzem os
  valores atuais; a prova de regressão zero é por browser (ver Verificação),
  não pelos testes jsdom.

## Mapa visual por bloco

O contrato que os mockups sozinhos não fecham — como cada grupo de bloco usa
tokens e fontes:

| Bloco(s) | Fonte display | `.rb-card`? | No tema bold |
|---|---|---|---|
| `cover` | título e mês | não (chrome próprio) | fundo `--rb-accent`, texto `--rb-accent-fg` |
| `section_header` | título | não | título em `--rb-accent-text`, barra em `--rb-accent` |
| `kpi_*` (9) | não (números na body, consistência tabular) | sim | surface = `--rb-soft` |
| `chart_followers`, `chart_formats`, `chart_best_times` | título do painel | sim | surface branco, linha/realces no accent |
| `audience_*` (4) | título do painel | sim | idem charts |
| `top_posts` (cards), `post_list`, `tags_table` | não | sim | idem charts |
| `text`, `ai_*` (rb-prose) | h1–h4 do conteúdo | não | headings na cor `--rb-ink` (accent NÃO vaza para corpo de texto) |
| `divider` | — | não | — |

Corpo de texto, legendas, números e tabelas usam sempre a fonte body. O
"destaque preenchido" do bold é SÓ capa e cabeçalhos de seção — cartões de
KPI usam tint suave, nunca preenchimento accent (o mockup com um KPI
preenchido foi descartado: regra uniforme, sem card "especial" arbitrário).

## Fontes

- Registro `FONT_PAIRINGS` no pacote: id → `{ label, display, body,
  googleHref }` (uma URL do Google Fonts por dupla, com os pesos usados:
  400/600/700).
- Cada superfície injeta `<link rel="stylesheet" href={googleHref}>` quando
  `layout.fonts` ≠ `system` (editor: no componente da página; Hub e print:
  idem). Sem fonte auto-hospedada na v1.
- Print/PDF: a página de impressão já aguarda `document.fonts.ready` antes de
  setar `__REPORT_READY` — o Gotenberg imprime com as webfonts carregadas sem
  mudança de pipeline. Ganho colateral: o PDF deixa de sair com a fonte
  genérica do servidor até no visual atual quando uma dupla é escolhida.
- Fallback stacks completos em todas as famílias (rede falhou = degrada para
  sistema, nunca quebra).

## UI do editor: popover "Aparência"

- Botão "Aparência" (ícone Palette) no cabeçalho, substituindo o ColorPicker
  solto atual (o seletor de cor MUDA para dentro do popover).
- Conteúdo: seção **Tema** (3 cards com thumbnail em miniatura + nome), seção
  **Fontes** (4 linhas com "Ag" renderizado na fonte display real + nome),
  seção **Cor de destaque** (swatch + hex + ação "usar cor da marca" que
  remove o override, voltando ao brand_color do snapshot).
- Toda mudança aplica via `applyLayout` (autosave existente); preview é
  imediato porque os tokens são CSS vars no container do canvas.
- Popover = shadcn `Popover` (Radix), padrão da casa.

## Superfícies e compatibilidade

- **Editor (CRM)**: container do canvas recebe os tokens + classe de tema.
- **Hub**: a página do relatório aplica tokens no container `.rb-*`; o layout
  do Hub em volta (chrome whitelabel) segue com `--hub-*` intocado. Tema
  editorial muda o fundo SÓ dentro do container do documento.
- **Print/PDF (mecanismo paginado, sem condicional na edge function)**:
  padding de wrapper contínuo NÃO se repete após quebra de página — páginas
  2+ colariam na borda da folha. O mecanismo correto é por CSS de página:
  a requisição do Gotenberg zera as margens INCONDICIONALMENTE (a edge
  function não lê layout nem tema — `pdf.ts` nem seleciona `layout` hoje, e
  não precisa passar a fazê-lo); a página de impressão define
  `@page { margin: 10mm }` (o mesmo inset do default atual do Gotenberg,
  repetido em TODA página pela engine) e pinta `--rb-bg` no `body` — o
  background do body propaga para o canvas da página e cobre a folha inteira,
  margens incluídas, em todas as páginas (`printBackground=true` já ligado).
  Modo herdado imprime idêntico ao atual (fundo branco, mesmo inset). Cache
  de PDF invalida sozinho: mudar aparência muda `layout` → `updated_at` sobe
  (trigger condicional existente).
- Snapshots e documentos antigos: sem `theme`/`fonts`, modo herdado — idêntico
  a hoje nas três superfícies, incluindo Hub com paleta escura.

## Fora da v1 (explícito)

- Tema dark (descartado pelo usuário).
- Upload de fonte própria / fontes fora do menu.
- Cores por bloco e o modelo de 3 botões (accent + fundo + tinta) — a
  arquitetura de tokens deixa ambos possíveis depois.
- Customização visual do relatório LEGADO (pipeline intocado).

## Verificação

- Unit (Vitest): derivação de paleta (tints, escolha de fg por contraste WCAG,
  `--rb-accent-text` atinge ≥ 4.5:1 sobre o `--rb-bg` de cada tema para
  accents hostis — `#00ff00`, `#808080`, amarelo puro), `FONT_PAIRINGS`
  completo,
  popover (render, seleção, "usar cor da marca"), widgets usam `.rb-card`
  (presença estrutural), validateLayout (enums estritos, ausência = ok).
  Limite conhecido do jsdom: ele não resolve `var()`/layout — jsdom prova
  estrutura, não visual.
- Deno: validateLayout com theme/fonts nos endpoints de escrita;
  stripAiTextForTemplate preserva aparência.
- SQL (suíte de entitlements/validação): trigger atualizado rejeita
  `theme`/`fonts` fora dos enums e aceita ausência.
- Browser (a prova de regressão de verdade): computed styles de um doc LEGADO
  (sem theme) antes/depois no editor E no Hub — incluindo um Hub de paleta
  escura — confirmando modo herdado idêntico; trocar tema/fonte/cor com
  preview ao vivo e autosave; screenshot por tema; exportar 1 PDF por tema e
  conferir fontes e fundo — incluindo um relatório LONGO (várias páginas) no
  editorial, verificando fundo e inset repetidos nas páginas 2+ (o mecanismo
  `@page` existe exatamente para isso).
