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
theme?: "clean" | "editorial" | "bold";   // ausente = clean
fonts?: "system" | "fraunces" | "grotesk" | "playfair"; // ausente = system
```

- `validateLayout` valida os enums de forma ESTRITA (valor fora da lista =
  layout inválido), como já faz com `accent`.
- Ausência de ambas = comportamento atual, byte-idêntico: nenhum documento ou
  template existente muda de cara.
- Templates armazenam layout, logo "Salvar como template" e o template padrão
  do workspace carregam a aparência sem nenhuma coluna ou migration nova.
- `stripAiTextForTemplate` NÃO remove `theme`/`fonts`/`accent` (aparência é
  parte do template; só o texto de IA sai).

## Tokens: `resolveReportTheme(layout, snapshot)`

Novo módulo no pacote compartilhado (`packages/report-blocks/theme.ts`),
substituindo o atual `resolveLayoutAccent` (que vira chamada interna).
Devolve o conjunto completo de CSS vars que o container do documento aplica
inline (editor, Hub e print usam o MESMO resolvedor):

| Token | clean | editorial | bold |
|---|---|---|---|
| `--rb-accent` | cor escolhida | idem | idem |
| `--rb-accent-fg` | contraste sobre accent (resolveAccent, existente) | idem | idem |
| `--rb-soft` | tint claro do accent (~92% de mistura com branco) | tint sobre o creme | idem clean |
| `--rb-bg` | `#ffffff` | `#faf6ee` (creme) | `#ffffff` |
| `--rb-surface` | `#ffffff` | transparente | `--rb-soft` nos cartões de KPI |
| `--rb-border` | `rgba(0,0,0,0.08)` | hairline `rgba(42,33,24,0.25)`, só na base dos cartões | `tint médio do accent` |
| `--rb-ink` | `#12151a` | `#2a2118` | `#12151a` |
| `--rb-ink-soft` | ink a ~65% | idem | idem |
| `--rb-radius` | `12px` | `0` | `12px` |
| `--rb-font-display` | pela dupla | idem | idem |
| `--rb-font-body` | pela dupla | idem | idem |

Regras de derivação:

- Tints derivam do accent por mistura em espaço sRGB simples (mesma técnica de
  `resolveHubTheme` em `apps/hub/src/theme.ts`); accent muito claro flipa o
  `--rb-accent-fg` para tinta escura (comportamento existente de
  `resolveAccent`, reaproveitado, não duplicado).
- Cores de delta (verde/vermelho) continuam fixas por tema (par claro no
  clean/bold; par terroso no editorial) — não derivam do accent, legibilidade
  de sinal vem antes de branding.
- Testes de contraste: `--rb-ink` sobre `--rb-bg` e `--rb-accent-fg` sobre
  `--rb-accent` ≥ 4.5:1 nos três temas, com accents extremos (branco, preto,
  amarelo puro) cobertos em teste unitário.

## Tokenização dos widgets

Os widgets trocam os valores fixos inline (`border: 1px solid
rgba(0,0,0,0.08)`, branco, `#12151a`…) por `var(--rb-*)` com fallback igual
ao valor atual — de modo que o tema `clean` renderize IGUAL ao hoje (garantia
de regressão zero, verificada nos testes existentes que continuam passando
sem mudança). O tema editorial precisa de um segundo eixo além dos tokens:
cartões sem caixa (borda só na base). Isso entra como classe de tema no
container (`rb-theme-editorial`) com um bloco pequeno de CSS no
`packages/report-blocks/styles.css` — widgets NÃO ganham lógica condicional
de tema; tokens + CSS de tema resolvem tudo.

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
- **Print/PDF**: mesma renderização do Hub; fundo do tema editorial cobre a
  página inteira via CSS de impressão existente. Cache de PDF invalida
  sozinho: mudar aparência muda `layout` → `updated_at` sobe (trigger
  condicional existente).
- Snapshots e documentos antigos: sem `theme`/`fonts` renderizam exatamente
  como hoje.

## Fora da v1 (explícito)

- Tema dark (descartado pelo usuário).
- Upload de fonte própria / fontes fora do menu.
- Cores por bloco e o modelo de 3 botões (accent + fundo + tinta) — a
  arquitetura de tokens deixa ambos possíveis depois.
- Customização visual do relatório LEGADO (pipeline intocado).

## Verificação

- Unit (Vitest): derivação de paleta (tints, flip de contraste, extremos),
  `FONT_PAIRINGS` completo, popover (render, seleção, "usar cor da marca"),
  widgets sob cada tema (smoke: renderizam e leem tokens), validateLayout
  (enums estritos, ausência = ok).
- Deno: validateLayout com theme/fonts nos endpoints de escrita;
  stripAiTextForTemplate preserva aparência.
- Browser: trocar tema/fonte/cor no editor com preview ao vivo e autosave;
  abrir o mesmo doc no Hub; exportar 1 PDF por tema e conferir fontes e fundo.
