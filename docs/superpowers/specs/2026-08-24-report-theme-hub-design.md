# Tema "Hub" no relatório de blocos — design

Data: 2026-08-24. Status: aprovado em brainstorm; aguardando review da spec.

## Objetivo

Adicionar um quarto tema ao popover Aparência do relatório de blocos: **Hub**, que
renderiza o relatório com a identidade whitelabel do portal do cliente (superfície,
fontes, raio e estilo de card do Personalizar Hub), nos três contextos: editor do
CRM, viewer do Hub e PDF exportado.

O modo herdado só "se mistura" quando renderizado dentro do Hub, e por omissão
(cards com fallback inline sobre o fundo do portal). No editor e no PDF ele não se
parece com o portal. O tema Hub torna os três contextos fiéis à identidade que o
cliente já vê, inclusive o PDF.

## Decisões tomadas com o usuário (2026-08-24)

1. Tema explícito novo (`hub`), não uma mudança no modo herdado.
2. Fidelidade completa: superfície, fontes, raio e estilo de card, não só cores.
3. Só a variante light da paleta do Hub. Relatório é documento; o PDF imprime
   claro. O dark do Hub fica fora da v1.
4. Workspace sem a entitlement `feature_brand_customization` tem o portal no
   visual padrão (neutral + Fraunces); o tema Hub reflete exatamente isso, fail
   closed, espelhando o gate do `hub-bootstrap`.

## Arquitetura

### 1. Extração: `packages/hub-theme`

`apps/hub/src/theme.ts` é um módulo puro (tipos, `PALETTES`, `RADIUS_CARD`,
`RADIUS_CTL`, `CARD_BG`, `CARD_BD`, `HUB_DISPLAY_FONTS`, `HUB_BODY_FONTS`,
`HUB_FONT_PAIRINGS`, `buildGoogleFontsHref`, `resolveHubTheme`,
`relativeLuminance`, `DEFAULT_HUB_THEME`). `packages/report-blocks` não pode
importar de um app, e cópia duplicada da paleta seria fonte de drift (lição do
entitlements: fonte única em `_shared`).

- Criar `packages/hub-theme/` (package.json mínimo, espelhando o de
  `report-blocks`: `@mesaas/hub-theme`, private, `type: module`) com **todo** o
  conteúdo atual de `apps/hub/src/theme.ts`, movido sem alteração de
  comportamento. Única mudança de superfície: `RADIUS_CARD` ganha `export`
  (hoje é const module-local; o resolvedor do relatório precisa dela).
  `RADIUS_CTL`/`CARD_BG`/`CARD_BD` seguem locais (`CARD_BG` embute strings
  `var(--hub-*)`, inútil fora do shell do Hub; o relatório mapeia card_style
  direto para os hexes da paleta).
- `apps/hub/src/theme.ts` vira re-export (`export * from
  '../../../packages/hub-theme/index'`). Os imports existentes seguem intactos:
  `HubShell.tsx` (`./theme`), `HubPreview.tsx` e `HubTab.tsx` do CRM
  (`../../../../hub/src/theme`), e `apps/hub/src/theme.test.ts` continua
  testando via re-export.
- `packages/report-blocks/theme.ts` importa de `../hub-theme/index` (relativo,
  package a package; sem alias novo em vite/tsconfig — YAGNI enquanto só o
  report-blocks consome direto).

### 2. Google Fonts: parâmetro `includeDefaults`

`buildGoogleFontsHref(display, body)` pula as fontes padrão (Fraunces +
Instrument Sans) porque o `index.html` do Hub já as carrega. O editor do CRM não
as carrega. Adicionar terceiro parâmetro opcional
`opts?: { includeDefaults?: boolean }`:

- default ausente/false: comportamento atual, byte-idêntico (Hub shell e
  Personalizar Hub não mudam).
- `includeDefaults: true` (usado pelo resolvedor do relatório): inclui as
  famílias mesmo quando são as padrão, para o `ReportFonts` (React 19, link
  com precedence) carregá-las no editor e na página de print. No viewer do Hub
  o link duplicado é inofensivo.

### 3. Snapshot: config efetiva congelada

`SnapshotBranding` ganha campo opcional:

```ts
export interface SnapshotHubTheme {
  surface: "neutral" | "warm" | "cool";
  font_display: string; // id de HUB_DISPLAY_FONTS; desconhecido => fraunces
  font_body: string;    // id de HUB_BODY_FONTS; desconhecido => instrument-sans
  radius: "square" | "soft" | "pill";
  card_style: "filled" | "outline" | "tonal";
}
// SnapshotBranding.hub_theme?: SnapshotHubTheme
```

Em `report-docs/snapshot-source.ts` (ponto único: generate e refresh-data
passam por ele):

- estender o select de `workspaces` (linha ~130) com `hub_surface_theme,
  hub_font_display, hub_font_body, hub_radius, hub_card_style`;
- resolver `effectivePlanFeature(db, contaId, "feature_brand_customization")`
  (helper já importado no generate para `feature_analytics_reports`);
- com entitlement: snapshot recebe os valores das colunas (com `??` para os
  defaults); sem entitlement: recebe os defaults neutros (`neutral`, `fraunces`,
  `instrument-sans`, `soft`, `filled`), espelhando o `NEUTRAL_HUB_THEME` do
  hub-bootstrap. Fail closed.

Campos do whitelabel irrelevantes ao relatório NÃO entram no snapshot:
`hub_logo_style`, `hub_logo_dark_url`, `hub_hide_branding`,
`hub_default_appearance`.

Semântica de staleness igual ao resto do snapshot: rebrand do portal (ou perda
de entitlement) só chega ao documento via refresh-data ou geração nova.

### 4. Resolvedor: `theme: 'hub'`

`REPORT_THEME_IDS` ganha `'hub'` (em `_shared/report-docs/layout.ts`,
re-exportado por `packages/report-blocks/types.ts`). Em `resolveReportTheme`,
ao lado dos `THEME_DEFS` fixos, o caminho `hub` deriva o def da config
(`snapshot.branding.hub_theme`, com fallback para os defaults neutros quando o
snapshot é antigo e não tem o campo):

| Token | Valor |
|---|---|
| `--rb-bg` | `PALETTES[surface].light.bg` |
| `--rb-ink` | `.light.txt` |
| `--rb-ink-soft` | `.light.tx2` |
| `--rb-border` | `card_style === 'outline'` ? `.light.bd2` : `.light.bd` |
| `--rb-radius` | `RADIUS_CARD[radius]` |
| `--rb-surface` | filled: `.light.card`; outline: `transparent`; tonal: `.light.soft` |
| `--rb-soft` | `mixHex(acc, bg, 0.9)` (igual aos demais temas: tint do accent) |
| accent | pipeline atual inalterado: `--rb-accent`/`-fg`/`-text`/`-line` derivados contra o bg/ink do Hub |

- **Fontes**: precedência `layout.fonts` (escolha explícita do usuário no
  popover) > config do Hub. Sem `layout.fonts`, o tema hub emite
  `--rb-font-display`/`--rb-font-body` dos `HUB_DISPLAY_FONTS`/`HUB_BODY_FONTS`
  (ids desconhecidos caem nos defaults) e `fontHref` via
  `buildGoogleFontsHref(display, body, { includeDefaults: true })`.
- **Capa e seção**: nenhum token `--rb-cover-*`/`--rb-section-title` emitido; a
  capa segue o fallback inline `var(--rb-cover-bg, var(--rb-accent))` (capa na
  cor de destaque, como clean/editorial).
- `themeClass: 'rb-theme-hub'` emitida; sem CSS de classe na v1 (mapeamento é
  100% via tokens). Os demais temas e o herdado permanecem byte-idênticos.

### 5. Trigger SQL

Migration nova (prefixo de versão único; conferir
`git ls-tree origin/main:supabase/migrations | tail` na hora do PR):
`CREATE OR REPLACE` de `validate_report_layout()` preservando o corpo atual de
`20260824000001_report_layout_theme_enums.sql`, com o enum de theme estendido
para `('clean','editorial','bold','hub')` em `report_documents` E
`report_templates`. Enum de fonts inalterado.

### 6. UI: popover Aparência

Em `AppearancePopover.tsx`, opção nova logo após "Padrão":
`{ id: 'hub', label: 'Hub', hint: 'igual ao portal' }`. Chip
`.rb-appearance-thumb-hub` no CSS do editor (miniatura neutra com ponto de
accent; detalhe visual no plano). Sem copy com travessão.

Templates funcionam sem mudança: o layout salva o id `'hub'` e cada documento o
resolve contra o próprio snapshot, então um template da agência aplicado a
outro cliente do mesmo workspace rende a mesma identidade de portal (o
whitelabel é por workspace).

## Compatibilidade e casos de borda

- **Snapshot antigo + theme 'hub'**: resolve com os defaults neutros (igual ao
  portal sem customização); refresh-data atualiza. Sem crash, sem aviso na v1.
- **Ids de fonte/superfície desconhecidos persistidos**: `??` para os defaults,
  mesmo padrão do `resolveHubTheme`.
- **Valor de theme fora do enum** (row anterior ao trigger): já degrada para
  herdado pelo guard existente do resolvedor.
- **PDF**: nada específico; a página de print já aplica `--rb-bg` no wrapper e
  body, e `printBackground` já é true. Superfícies warm/cool imprimem o fundo
  colorido.
- **Dark do Hub**: viewer em dark mostra o documento claro (documento é
  documento). Fora da v1.

## Fora de escopo

- Variante dark do tema hub.
- Refletir `hub_logo_style`/`hub_hide_branding` no relatório.
- Auto-refresh do snapshot quando o Personalizar Hub muda.
- Qualquer mudança no pipeline legado (`_shared/report-template/*`).

## Testes

- **Vitest `packages/report-blocks/__tests__/theme.test.ts`**: mapeamento hub
  (neutral/warm/cool; filled/outline/tonal; radius), fontes do hub vs. override
  `layout.fonts`, snapshot sem `hub_theme` (defaults), ids desconhecidos,
  accent derivado contra o bg do Hub (contraste >= 4.5/3.0), demais temas e
  herdado inalterados (vars idênticas às de hoje).
- **Vitest `apps/hub/src/theme.test.ts`**: segue passando via re-export;
  `buildGoogleFontsHref` sem opts byte-idêntico + caso novo `includeDefaults`.
- **Deno `snapshot-source`/`generate`/`refresh`**: select estendido; entitlement
  on => colunas; entitlement off => defaults neutros; refresh re-snapshot
  atualiza `hub_theme`.
- **SQL `supabase/tests/entitlements/66_report_docs.sql`**: trigger aceita
  `'hub'` e segue rejeitando valor inválido, nas duas tabelas.
- **Browser**: editor com tema Hub (warm + serif de exemplo), viewer do Hub,
  print page; conferir Google Fonts carregadas no editor do CRM.
