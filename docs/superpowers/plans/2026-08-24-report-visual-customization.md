# Customização Visual dos Relatórios de Blocos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Temas (clean/editorial/bold), duplas de fontes e paleta derivada da cor da marca nos relatórios de blocos, com modo herdado byte-idêntico para documentos existentes.

**Architecture:** Um resolvedor de tema no pacote compartilhado (`resolveReportTheme`) gera CSS vars + classe de tema aplicadas pelo `BlockRenderer` e pelo `EditorCanvas`; o chrome de cartão sai do estilo inline dos widgets para a classe `.rb-card` (com modificadores de padding), permitindo que CSS de tema restilize sem `!important`. Aparência vive no JSON do layout (`theme`, `fonts`, `accent`), validada em TS e no trigger SQL. PDF paginado via `@page` + fundo no `body` com margens do Gotenberg zeradas incondicionalmente.

**Tech Stack:** React 19, CSS vars, shadcn Popover (Radix), Deno edge functions, SQL trigger, Vitest + deno test + suíte SQL de entitlements.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-24-report-visual-customization-design.md` — em conflito, a spec governa.
- Enums EXATOS: `theme ∈ {"clean","editorial","bold"}`, `fonts ∈ {"system","fraunces","grotesk","playfair"}`.
- **Ausente = HERDADO para ambas as chaves**: `theme` ausente aplica só `--rb-accent`/`--rb-accent-fg`/`--rb-accent-text`; `fonts` ausente não emite NENHUMA var de fonte (Hub continua herdando Instrument Sans). `"system"` explícito ≠ ausente.
- Pipeline LEGADO intocado: `supabase/functions/_shared/report-template/theme.ts` (resolveAccent), `render.ts` e o gerador v2 não mudam.
- Modo herdado byte-idêntico: fallbacks de todas as vars reproduzem os valores atuais dos widgets.
- Copy pt-BR sem travessão (em-dash) em texto de usuário.
- Migration com prefixo de versão ÚNICO acima do tail de `origin/main` (conferir `git ls-tree origin/main:supabase/migrations | tail` na hora de abrir o PR; plano usa `20260824000001`).
- Antes de push: `npm run lint`, `npm run format:check`, os 4 tsc (`crm`, `hub`, `admin`, `tsconfig.scripts.json`), `npm run test`, `npm run test:functions`. Deno test polui `node_modules` (rodar deno ANTES, depois `rm -rf node_modules/.deno && npm ci`, depois os gates npm) e suja `deno.lock` (`git checkout -- deno.lock`).
- Worktree: caminho literal `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/report-restructure-41a80e`; todo comando roda DENTRO dele (conferir `pwd` e branch antes de commitar).
- Branch de trabalho: `claude/report-visual-customization`, criada a partir de `claude/report-editor-refinements`.

---

### Task 1: Resolvedor de tema e paleta (`theme.ts` do pacote)

**Files:**
- Create: `packages/report-blocks/theme.ts`
- Test: `packages/report-blocks/__tests__/theme.test.ts`

**Interfaces:**
- Produces: `resolveReportTheme(layout: ReportLayout, snapshot: ReportDocSnapshot): ReportTheme` onde `ReportTheme = { vars: Record<string, string>; themeClass: string | null; fontHref: string | null }`; `FONT_PAIRINGS: Record<ReportFontId, FontPairing>` com `FontPairing = { label: string; display: string; body: string; googleHref: string | null }`; `contrastRatio(a: string, b: string): number`. Tipos `ReportThemeId`/`ReportFontId` vêm da Task 2 — nesta task use os literais `'clean' | 'editorial' | 'bold'` e `'system' | 'fraunces' | 'grotesk' | 'playfair'` localmente e troque o import quando a Task 2 existir (as tasks 1 e 2 podem inverter de ordem sem prejuízo; se a Task 2 já tiver mergeado, importe direto).
- Consumes: `ReportLayout`, `ReportDocSnapshot` de `./types` (campos `theme`/`fonts` podem ainda não existir no tipo — leia via `(layout as { theme?: string }).theme` até a Task 2, com comentário TODO removido na Task 2).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// packages/report-blocks/__tests__/theme.test.ts
import { describe, expect, it } from 'vitest';
import { FONT_PAIRINGS, contrastRatio, resolveReportTheme } from '../theme';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout } from '../types';

const layout = (over: Partial<ReportLayout> = {}): ReportLayout => ({
  version: 1,
  blocks: [],
  ...over,
});

describe('contrastRatio (WCAG real, luminância linearizada)', () => {
  it('preto sobre branco = 21; branco sobre branco = 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
  it('branco sobre #808080 fica ABAIXO de 4.5 (o caso que a heurística antiga errava)', () => {
    expect(contrastRatio('#ffffff', '#808080')).toBeLessThan(4.5);
  });
});

describe('modo herdado (theme e fonts ausentes)', () => {
  it('emite SÓ accent, accent-fg e accent-text; nenhuma var de fundo/fonte', () => {
    const t = resolveReportTheme(layout(), makeSnapshotFixture());
    expect(Object.keys(t.vars).sort()).toEqual([
      '--rb-accent', '--rb-accent-fg', '--rb-accent-text',
    ]);
    expect(t.themeClass).toBeNull();
    expect(t.fontHref).toBeNull();
  });
  it('accent-text no herdado = o próprio accent (comportamento atual do chip)', () => {
    const t = resolveReportTheme(layout({ accent: '#7c3aed' }), makeSnapshotFixture());
    expect(t.vars['--rb-accent-text']).toBe('#7c3aed');
  });
  it('clamp de accent claro preservado: accent inválido ou claro demais vira #171717', () => {
    const t = resolveReportTheme(layout({ accent: '#ffffff' }), makeSnapshotFixture());
    expect(t.vars['--rb-accent']).toBe('#171717');
    const t2 = resolveReportTheme(layout(), makeSnapshotFixture({
      branding: { workspace_name: 'W', logo_url: null, splash_url: null, accent_color: 'lixo' },
    }));
    expect(t2.vars['--rb-accent']).toBe('#171717');
  });
  it('accent-fg = candidato de MAIOR contraste WCAG entre #ffffff e #171717', () => {
    const t = resolveReportTheme(layout({ accent: '#808080' }), makeSnapshotFixture());
    const acc = t.vars['--rb-accent'];
    const fg = t.vars['--rb-accent-fg'];
    const other = fg === '#ffffff' ? '#171717' : '#ffffff';
    expect(contrastRatio(fg, acc)).toBeGreaterThanOrEqual(contrastRatio(other, acc));
  });
});

describe('temas explícitos', () => {
  it('clean: bg branco, ink #12151a, radius 12px, classe rb-theme-clean', () => {
    const t = resolveReportTheme(layout({ theme: 'clean' }), makeSnapshotFixture());
    expect(t.vars['--rb-bg']).toBe('#ffffff');
    expect(t.vars['--rb-ink']).toBe('#12151a');
    expect(t.vars['--rb-radius']).toBe('12px');
    expect(t.vars['--rb-surface']).toBe('#ffffff');
    expect(t.themeClass).toBe('rb-theme-clean');
  });
  it('editorial: bg creme #faf6ee, ink #2a2118, radius 0, surface transparente', () => {
    const t = resolveReportTheme(layout({ theme: 'editorial' }), makeSnapshotFixture());
    expect(t.vars['--rb-bg']).toBe('#faf6ee');
    expect(t.vars['--rb-ink']).toBe('#2a2118');
    expect(t.vars['--rb-radius']).toBe('0px');
    expect(t.vars['--rb-surface']).toBe('transparent');
  });
  it('bold: surface = soft (tint do accent), bg branco', () => {
    const t = resolveReportTheme(
      layout({ theme: 'bold', accent: '#7c3aed' }),
      makeSnapshotFixture(),
    );
    expect(t.vars['--rb-surface']).toBe(t.vars['--rb-soft']);
    expect(t.vars['--rb-soft']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t.vars['--rb-soft']).not.toBe('#7c3aed');
  });
  it('ink sobre bg tem >= 4.5:1 nos tres temas (valores fixos)', () => {
    for (const theme of ['clean', 'editorial', 'bold'] as const) {
      const t = resolveReportTheme(layout({ theme }), makeSnapshotFixture());
      expect(contrastRatio(t.vars['--rb-ink'], t.vars['--rb-bg'])).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('accent-text atinge >= 4.5:1 sobre o bg do tema para accents hostis', () => {
    for (const accent of ['#00ff00', '#808080', '#ffff00', '#ff69b4']) {
      for (const theme of ['clean', 'editorial', 'bold'] as const) {
        const t = resolveReportTheme(layout({ theme, accent }), makeSnapshotFixture());
        expect(
          contrastRatio(t.vars['--rb-accent-text'], t.vars['--rb-bg']),
          `${accent} em ${theme}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('fontes', () => {
  it('fonts ausente: nenhuma var de fonte, href nulo', () => {
    const t = resolveReportTheme(layout({ theme: 'clean' }), makeSnapshotFixture());
    expect(t.vars['--rb-font-display']).toBeUndefined();
    expect(t.fontHref).toBeNull();
  });
  it('system explicito: vars da pilha do sistema, href nulo', () => {
    const t = resolveReportTheme(layout({ fonts: 'system' }), makeSnapshotFixture());
    expect(t.vars['--rb-font-display']).toContain('-apple-system');
    expect(t.vars['--rb-font-body']).toContain('-apple-system');
    expect(t.fontHref).toBeNull();
  });
  it('fraunces: display serif, body Instrument Sans, href do Google Fonts', () => {
    const t = resolveReportTheme(layout({ fonts: 'fraunces' }), makeSnapshotFixture());
    expect(t.vars['--rb-font-display']).toContain('Fraunces');
    expect(t.vars['--rb-font-body']).toContain('Instrument Sans');
    expect(t.fontHref).toContain('fonts.googleapis.com');
  });
  it('FONT_PAIRINGS cobre os 4 ids com fallback generico em toda familia', () => {
    expect(Object.keys(FONT_PAIRINGS).sort()).toEqual([
      'fraunces', 'grotesk', 'playfair', 'system',
    ]);
    for (const p of Object.values(FONT_PAIRINGS)) {
      expect(p.display).toMatch(/serif|sans-serif/);
      expect(p.body).toMatch(/serif|sans-serif/);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/report-blocks/__tests__/theme.test.ts`
Expected: FAIL (módulo `../theme` não existe)

- [ ] **Step 3: Implementar `packages/report-blocks/theme.ts`**

```ts
// Resolvedor de tema do relatório de blocos. Fonte única para editor (CRM),
// viewer (Hub) e print (PDF). Modo herdado (theme/fonts ausentes) emite o
// mínimo — byte-idêntico ao comportamento pré-temas. O resolveAccent LEGADO
// (_shared/report-template/theme.ts) segue intocado para o gerador v2; aqui
// reproduzimos o clamp dele e trocamos a escolha de foreground por contraste
// WCAG real (spec 2026-08-24 §Tokens).
import type { ReportDocSnapshot, ReportLayout } from './types';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  const int = parseInt(hex.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

// Clamp LEGADO usa esta luminância barata (gamma, não linearizada) com o
// mesmo limiar 0.85 — paridade visual com resolveAccent, de propósito.
function legacyLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** Razão de contraste WCAG 2.x entre duas cores #rrggbb. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mistura sRGB simples (byte a byte), t = fração da cor b. */
function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return toHex([0, 1, 2].map((i) => ra[i] * (1 - t) + rb[i] * t) as [number, number, number]);
}

function clampAccent(hex: string | null | undefined): string {
  let acc = hex && HEX_RE.test(hex) ? hex : '#171717';
  if (legacyLuminance(acc) > 0.85) acc = '#171717';
  return acc;
}

function pickAccentFg(acc: string, ink: string): string {
  return contrastRatio('#ffffff', acc) >= contrastRatio(ink, acc) ? '#ffffff' : ink;
}

/** Accent usável COMO TEXTO sobre bg: escurece em direção à tinta até 4.5:1;
 * fallback = a própria tinta. */
function deriveAccentText(acc: string, bg: string, ink: string): string {
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const candidate = mixHex(acc, ink, t);
    if (contrastRatio(candidate, bg) >= 4.5) return candidate;
  }
  return ink;
}

export interface FontPairing {
  label: string;
  display: string;
  body: string;
  googleHref: string | null;
}

const SYSTEM_STACK = "-apple-system, 'Segoe UI', Roboto, sans-serif";

export const FONT_PAIRINGS: Record<
  'system' | 'fraunces' | 'grotesk' | 'playfair',
  FontPairing
> = {
  system: { label: 'Sistema', display: SYSTEM_STACK, body: SYSTEM_STACK, googleHref: null },
  fraunces: {
    label: 'Fraunces + Instrument Sans',
    display: "'Fraunces', Georgia, serif",
    body: `'Instrument Sans', ${SYSTEM_STACK}`,
    googleHref:
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Instrument+Sans:wght@400;600;700&display=swap',
  },
  grotesk: {
    label: 'Space Grotesk + Inter',
    display: "'Space Grotesk', sans-serif",
    body: `'Inter', ${SYSTEM_STACK}`,
    googleHref:
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;600;700&display=swap',
  },
  playfair: {
    label: 'Playfair Display + Source Sans',
    display: "'Playfair Display', Georgia, serif",
    body: `'Source Sans 3', ${SYSTEM_STACK}`,
    googleHref:
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap',
  },
};

interface ThemeDef {
  bg: string;
  ink: string;
  inkSoft: string;
  border: string;
  radius: string;
  /** base da mistura do --rb-soft (fundo do tema). */
  surface: 'white' | 'transparent' | 'soft';
}

const THEME_DEFS: Record<'clean' | 'editorial' | 'bold', ThemeDef> = {
  clean: {
    bg: '#ffffff', ink: '#12151a', inkSoft: 'rgba(18, 21, 26, 0.65)',
    border: 'rgba(0, 0, 0, 0.08)', radius: '12px', surface: 'white',
  },
  editorial: {
    bg: '#faf6ee', ink: '#2a2118', inkSoft: 'rgba(42, 33, 24, 0.65)',
    border: 'rgba(42, 33, 24, 0.25)', radius: '0px', surface: 'transparent',
  },
  bold: {
    bg: '#ffffff', ink: '#12151a', inkSoft: 'rgba(18, 21, 26, 0.65)',
    border: 'rgba(0, 0, 0, 0.08)', radius: '12px', surface: 'soft',
  },
};

export interface ReportTheme {
  vars: Record<string, string>;
  themeClass: string | null;
  fontHref: string | null;
}

export function resolveReportTheme(
  layout: ReportLayout,
  snapshot: ReportDocSnapshot,
): ReportTheme {
  const acc = clampAccent(layout.accent ?? snapshot.branding.accent_color);
  const theme = layout.theme;
  const fonts = layout.fonts;

  const vars: Record<string, string> = { '--rb-accent': acc };

  if (theme) {
    const def = THEME_DEFS[theme];
    const soft = mixHex(acc, def.bg, 0.9);
    vars['--rb-accent-fg'] = pickAccentFg(acc, def.ink);
    vars['--rb-accent-text'] = deriveAccentText(acc, def.bg, def.ink);
    vars['--rb-bg'] = def.bg;
    vars['--rb-ink'] = def.ink;
    vars['--rb-ink-soft'] = def.inkSoft;
    vars['--rb-border'] = def.border;
    vars['--rb-radius'] = def.radius;
    vars['--rb-soft'] = soft;
    vars['--rb-surface'] =
      def.surface === 'white' ? '#ffffff' : def.surface === 'transparent' ? 'transparent' : soft;
  } else {
    // Modo HERDADO: byte-idêntico ao pré-temas. accent-text = accent cru
    // (o chip "Formato líder" usa a cor crua hoje; mudar seria regressão
    // visual em doc legado).
    vars['--rb-accent-fg'] = pickAccentFg(acc, '#171717');
    vars['--rb-accent-text'] = acc;
  }

  let fontHref: string | null = null;
  if (fonts) {
    const pairing = FONT_PAIRINGS[fonts];
    vars['--rb-font-display'] = pairing.display;
    vars['--rb-font-body'] = pairing.body;
    fontHref = pairing.googleHref;
  }

  return { vars, themeClass: theme ? `rb-theme-${theme}` : null, fontHref };
}
```

Nota: enquanto a Task 2 não existir, `layout.theme`/`layout.fonts` não tipam — use `(layout as ReportLayout & { theme?: 'clean' | 'editorial' | 'bold'; fonts?: 'system' | 'fraunces' | 'grotesk' | 'playfair' })` numa const local no topo da função e troque pelo tipo real quando a Task 2 mergear.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run packages/report-blocks/__tests__/theme.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add packages/report-blocks/theme.ts packages/report-blocks/__tests__/theme.test.ts
git commit -m "feat(relatorios): resolvedor de tema com paleta derivada e contraste WCAG"
```

---

### Task 2: Schema do layout (TS) e preservação em templates

**Files:**
- Modify: `supabase/functions/_shared/report-docs/layout.ts` (BLOCK_TYPES fica; adicionar consts + campos + validação)
- Modify: `packages/report-blocks/types.ts` (re-exports)
- Modify: `packages/report-blocks/theme.ts` (trocar cast local pelos tipos reais)
- Test: `supabase/functions/_shared/report-docs/layout.test.ts`, `apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts`

**Interfaces:**
- Produces: `REPORT_THEME_IDS = ["clean","editorial","bold"] as const`, `ReportThemeId`; `REPORT_FONT_IDS = ["system","fraunces","grotesk","playfair"] as const`, `ReportFontId`; campos `theme?: ReportThemeId; fonts?: ReportFontId` em `ReportLayout`; `validateLayout` rejeita valores fora dos enums.
- Consumes: nada de outras tasks.

- [ ] **Step 1: Testes que falham (Deno)**

Adicionar em `supabase/functions/_shared/report-docs/layout.test.ts`:

```ts
Deno.test("theme e fonts: enums estritos; ausencia ok", () => {
  const base = { version: 1, blocks: [] };
  assert(validateLayout(base).ok);
  assert(validateLayout({ ...base, theme: "clean" }).ok);
  assert(validateLayout({ ...base, theme: "editorial", fonts: "fraunces" }).ok);
  assert(validateLayout({ ...base, fonts: "system" }).ok);
  assert(!validateLayout({ ...base, theme: "dark" }).ok);
  assert(!validateLayout({ ...base, theme: 1 }).ok);
  assert(!validateLayout({ ...base, fonts: "comic-sans" }).ok);
  assert(!validateLayout({ ...base, fonts: "" }).ok);
});
```

(Importar `assert` do mod de assert já usado no arquivo.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/_shared/report-docs/layout.test.ts`
Expected: FAIL (theme "dark" aceito hoje)

- [ ] **Step 3: Implementar em `layout.ts`**

Depois de `BLOCK_TYPES`:

```ts
export const REPORT_THEME_IDS = ["clean", "editorial", "bold"] as const;
export type ReportThemeId = (typeof REPORT_THEME_IDS)[number];
export const REPORT_FONT_IDS = ["system", "fraunces", "grotesk", "playfair"] as const;
export type ReportFontId = (typeof REPORT_FONT_IDS)[number];
```

Em `ReportLayout`, ao lado de `accent`:

```ts
  /** Tema visual. AUSENTE = modo herdado (só accent aplicado; fundo e
   * superfícies herdam da página — Hub whitelabel incluso). */
  theme?: ReportThemeId;
  /** Dupla de fontes. AUSENTE = herdar da página; "system" é escolha
   * explícita da pilha do sistema. */
  fonts?: ReportFontId;
```

Em `validateLayout`, depois do bloco do `accent`:

```ts
  if (
    raw.theme !== undefined &&
    !(REPORT_THEME_IDS as readonly unknown[]).includes(raw.theme)
  ) {
    return { ok: false, error: "invalid theme" };
  }
  if (
    raw.fonts !== undefined &&
    !(REPORT_FONT_IDS as readonly unknown[]).includes(raw.fonts)
  ) {
    return { ok: false, error: "invalid fonts" };
  }
```

Em `packages/report-blocks/types.ts`, acrescentar aos re-exports de layout:
`ReportThemeId`, `ReportFontId`, `REPORT_THEME_IDS`, `REPORT_FONT_IDS` (types nos
`export type`, consts no `export {}`). Em `packages/report-blocks/theme.ts`,
remover o cast local e usar `layout.theme`/`layout.fonts` direto.

- [ ] **Step 4: Teste de preservação no template (Vitest, falha antes por não existir)**

Adicionar em `apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts`:

```ts
it('stripAiTextForTemplate preserva theme, fonts e accent (aparencia e parte do template)', () => {
  const layout: ReportLayout = {
    version: 1,
    accent: '#7c3aed',
    theme: 'editorial',
    fonts: 'fraunces',
    blocks: [{ id: 'a', type: 'ai_summary', size: 'full', text: { type: 'doc', content: [] } }],
  };
  const stripped = stripAiTextForTemplate(layout);
  expect(stripped.theme).toBe('editorial');
  expect(stripped.fonts).toBe('fraunces');
  expect(stripped.accent).toBe('#7c3aed');
});
```

- [ ] **Step 5: Rodar tudo e ver passar**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/_shared/report-docs/ && npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts packages/report-blocks/__tests__/theme.test.ts`
Expected: PASS (se `stripAiTextForTemplate` usar spread do layout, preserva sem mudança de código; se falhar, ajustar a função para spread `{ ...layout, blocks }`)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/report-docs/layout.ts supabase/functions/_shared/report-docs/layout.test.ts packages/report-blocks/types.ts packages/report-blocks/theme.ts apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts
git commit -m "feat(relatorios): schema de theme/fonts com enums estritos"
```

---

### Task 3: Migration do trigger SQL

**Files:**
- Create: `supabase/migrations/20260824000001_report_layout_theme_enums.sql`
- Modify: `supabase/tests/entitlements/66_report_docs.sql` (acrescentar casos)

**Interfaces:**
- Consumes: enums da Task 2 (valores literais espelhados no SQL).
- Produces: `validate_report_layout()` rejeita theme/fonts fora dos enums (vale para `report_documents` E `report_templates`, que compartilham a função).

- [ ] **Step 1: Escrever a migration**

```sql
-- Enums de aparencia no layout (spec 2026-08-24): theme e fonts, quando
-- presentes, precisam estar na lista fechada. A funcao serve report_documents
-- e report_templates; layout e gravavel direto via PostgREST, entao o
-- enforcement REAL e aqui, nao so no validateLayout do TypeScript.
-- Recria a funcao inteira (CREATE OR REPLACE) com os checks novos ANTES dos
-- checks de blocks, mantendo todo o corpo existente da 20260821000010.
CREATE OR REPLACE FUNCTION validate_report_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layout IS NULL
     OR jsonb_typeof(NEW.layout) <> 'object'
     OR (NEW.layout -> 'version') IS DISTINCT FROM to_jsonb(1)
     OR jsonb_typeof(NEW.layout -> 'blocks') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.layout -> 'blocks') > 200 THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'accent' AND (
       jsonb_typeof(NEW.layout -> 'accent') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'accent' !~ '^#[0-9a-fA-F]{6}$'
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- theme/fonts, quando presentes, sao strings dos enums fechados.
  IF NEW.layout ? 'theme' AND (
       jsonb_typeof(NEW.layout -> 'theme') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'theme' NOT IN ('clean', 'editorial', 'bold')
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'fonts' AND (
       jsonb_typeof(NEW.layout -> 'fonts') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'fonts' NOT IN ('system', 'fraunces', 'grotesk', 'playfair')
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
    WHERE jsonb_typeof(b) <> 'object'
       OR jsonb_typeof(b -> 'id') IS DISTINCT FROM 'string'
       OR b ->> 'id' = ''
       OR jsonb_typeof(b -> 'type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(b -> 'size') IS DISTINCT FROM 'string'
       OR b ->> 'size' NOT IN ('third', 'half', 'full')
       OR (b ? 'text' AND b ->> 'type' NOT IN
           ('text', 'ai_summary', 'ai_recommendations', 'ai_goals'))
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  RETURN NEW;
END $$;
```

IMPORTANTE: antes de escrever, ler a `20260821000010_report_docs_pdf_hardening.sql` inteira e copiar o corpo ATUAL COMPLETO da função (o SQL acima parte do trecho conhecido; se a função tiver mais checks, preservá-los todos — a migration substitui a função inteira).

- [ ] **Step 2: Acrescentar casos na suíte SQL**

Em `supabase/tests/entitlements/66_report_docs.sql`, seguindo o padrão dos testes de trigger existentes no arquivo (ler o arquivo primeiro e imitar o harness de asserção dele):

- INSERT/UPDATE de `report_documents.layout` com `"theme": "clean"` e `"fonts": "fraunces"` → aceito.
- `"theme": "dark"` → EXCEPTION INVALID_LAYOUT.
- `"fonts": 42` → EXCEPTION INVALID_LAYOUT.
- Mesmo par de casos em `report_templates` (a função é compartilhada; provar nas duas tabelas).

- [ ] **Step 3: Rodar a suíte local (Docker/colima) OU registrar que o CI cobre**

Run: `bash scripts/test-entitlements.sh` (requer `colima start`; se indisponível no ambiente, anotar no relatório que a suíte roda no CI `entitlement-tests` — ela É gate de merge)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260824000001_report_layout_theme_enums.sql supabase/tests/entitlements/66_report_docs.sql
git commit -m "feat(relatorios): trigger valida enums de theme/fonts no layout"
```

---

### Task 4: `.rb-card` com modificadores e adoção pelos widgets

**Files:**
- Modify: `packages/report-blocks/styles.css`
- Modify: `packages/report-blocks/blocks/KpiCardBlock.tsx`, `FollowerChartBlock.tsx`, `FormatCardsBlock.tsx`, `BestTimesBlock.tsx`, `AudienceGenderBlock.tsx`, `AudienceAgeBlock.tsx`, `AudienceCitiesBlock.tsx`, `AudienceCountriesBlock.tsx`, `TopPostsBlock.tsx`, `PostListBlock.tsx`, `TagsTableBlock.tsx`
- Test: `packages/report-blocks/__tests__/kpi-and-charts.test.tsx`, `packages/report-blocks/__tests__/audience-and-content.test.tsx`

**Interfaces:**
- Produces: classes `.rb-card`, `.rb-card--pad`, `.rb-card--compact`, `.rb-card--flush`, `.rb-card-title` (título de painel, recebe `--rb-font-display`).
- Consumes: nada (tokens têm fallback; funciona sem Task 5).

- [ ] **Step 1: Testes estruturais que falham**

Acrescentar em `kpi-and-charts.test.tsx`:

```ts
it('KPI usa .rb-card com padding padrao e sem chrome inline', () => {
  const { container } = render(
    <BlockRenderer
      layout={l([{ id: 'k1', type: 'kpi_reach', size: 'third' }])}
      snapshot={makeSnapshotFixture()}
      mode="view"
    />,
  );
  const card = container.querySelector('.rb-kpi') as HTMLElement;
  expect(card.classList.contains('rb-card')).toBe(true);
  expect(card.classList.contains('rb-card--pad')).toBe(true);
  expect(card.style.border).toBe('');
  expect(card.style.borderRadius).toBe('');
});
```

Acrescentar em `audience-and-content.test.tsx`:

```ts
it('top posts: article e rb-card--flush (thumbnail encosta na borda)', () => {
  const { container } = render(
    <BlockRenderer
      layout={l([{ id: 'p1', type: 'top_posts', size: 'full', config: { count: 1 } }])}
      snapshot={makeSnapshotFixture()}
      mode="view"
    />,
  );
  const article = container.querySelector('article') as HTMLElement;
  expect(article.classList.contains('rb-card')).toBe(true);
  expect(article.classList.contains('rb-card--flush')).toBe(true);
});

it('lista de publicacoes: rb-card--compact', () => {
  const { container } = render(
    <BlockRenderer
      layout={l([{ id: 'pl', type: 'post_list', size: 'full' }])}
      snapshot={makeSnapshotFixture()}
      mode="view"
    />,
  );
  expect(container.querySelector('.rb-card.rb-card--compact')).not.toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/report-blocks/__tests__/kpi-and-charts.test.tsx packages/report-blocks/__tests__/audience-and-content.test.tsx`
Expected: FAIL (classes não existem)

- [ ] **Step 3: CSS em `styles.css`**

```css
/* Chrome de cartão centralizado: tokens com fallback IGUAL ao valor inline
   que os widgets tinham — modo herdado renderiza byte-idêntico. Estilo
   inline de chrome nos widgets é PROIBIDO daqui em diante (inline vence CSS
   de tema; foi a classe de bug do padding no PR 381). */
.rb-card {
  background: var(--rb-surface, transparent);
  border: 1px solid var(--rb-border, rgba(0, 0, 0, 0.08));
  border-radius: var(--rb-radius, 12px);
}
.rb-card--pad {
  padding: 1rem;
}
.rb-card--compact {
  padding: 0.5rem 1rem;
}
.rb-card--flush {
  padding: 0;
  overflow: hidden;
}
.rb-card-title {
  font-family: var(--rb-font-display, inherit);
}
```

Nota: o fallback de `--rb-surface` é `transparent` (valor atual dos widgets —
eles NÃO setam background hoje); `--rb-radius` 12px e a borda rgba são os
valores inline atuais.

- [ ] **Step 4: Refatorar os widgets**

Para cada widget listado: remover do estilo inline do elemento-cartão APENAS
`border`, `borderRadius`, `background` (quando for o do cartão) e o `padding`
do cartão; acrescentar `className="rb-card rb-card--pad"` (ou o modificador
correto). Mapeamento de modificador:

| Widget | elemento | modificador |
|---|---|---|
| KpiCardBlock (`.rb-kpi`) | div raiz | `--pad` |
| FollowerChartBlock, FormatCardsBlock (cards internos), BestTimesBlock, Audience* (painéis), TagsTableBlock | div do painel | `--pad` |
| PostListBlock | div raiz | `--compact` |
| TopPostsBlock | cada `article` | `--flush` (mantém `overflow: hidden` via classe) |

Títulos de painel ("Evolução de seguidores", "Gênero", nome do formato etc.)
ganham `className="rb-card-title"` mantendo o estilo inline de
tamanho/margem. O texto secundário que usa `opacity` fixa segue como está
(tokens de tinta chegam na Task 5 via herança de cor no container).

No FormatCardsBlock, o chip "Formato líder" e o span que o contém trocam
`color: 'var(--rb-accent)'` / `border...var(--rb-accent)` por
`color: 'var(--rb-accent-text, var(--rb-accent))'` e
`borderColor: 'var(--rb-accent)'` (accent puro só como traço; texto usa o
token legível).

- [ ] **Step 5: Rodar TODOS os testes do pacote e do editor**

Run: `npx vitest run packages/report-blocks apps/crm/src/pages/relatorio-editor`
Expected: PASS — inclusive os testes antigos (o refactor não muda DOM além de classes; se um teste antigo assertar estilo inline removido, atualizar o teste JUNTO com evidência de que o valor migrou para o CSS)

- [ ] **Step 6: Commit**

```bash
git add packages/report-blocks
git commit -m "refactor(relatorios): chrome de cartao vira .rb-card com modificadores"
```

---

### Task 5: Aplicação do tema nos renderers + CSS de variantes

**Files:**
- Modify: `packages/report-blocks/BlockRenderer.tsx`
- Modify: `apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx`
- Modify: `packages/report-blocks/styles.css`
- Create: `packages/report-blocks/ReportFonts.tsx`
- Test: `packages/report-blocks/__tests__/BlockRenderer.test.tsx`

**Interfaces:**
- Consumes: `resolveReportTheme`, `ReportTheme` (Task 1); classes `.rb-card*` (Task 4).
- Produces: `BlockRenderer` e `EditorCanvas` aplicam `theme.vars` + `theme.themeClass` no container `.rb-grid`; componente `ReportFonts({ layout })` que renderiza `<link rel="stylesheet">` quando há `fontHref` (React 19 içá para o head). `resolveLayoutAccent` é REMOVIDO (era exportado; os dois únicos consumidores são BlockRenderer e EditorCanvas — confirmar com grep antes de remover).

- [ ] **Step 1: Testes que falham**

Em `BlockRenderer.test.tsx`:

```ts
it('tema explicito: container ganha classe e vars de tema', () => {
  const { container } = render(
    <BlockRenderer
      layout={{ version: 1, theme: 'editorial', blocks: [] }}
      snapshot={makeSnapshotFixture()}
      mode="view"
    />,
  );
  const grid = container.querySelector('.rb-grid') as HTMLElement;
  expect(grid.classList.contains('rb-theme-editorial')).toBe(true);
  expect(grid.style.getPropertyValue('--rb-bg')).toBe('#faf6ee');
});

it('modo herdado: sem classe de tema, sem var de fundo (byte-identico)', () => {
  const { container } = render(
    <BlockRenderer
      layout={{ version: 1, blocks: [] }}
      snapshot={makeSnapshotFixture()}
      mode="view"
    />,
  );
  const grid = container.querySelector('.rb-grid') as HTMLElement;
  expect(grid.className).not.toContain('rb-theme-');
  expect(grid.style.getPropertyValue('--rb-bg')).toBe('');
  expect(grid.style.getPropertyValue('--rb-accent')).toBe('#7c3aed');
});

it('fonts definido: link do Google Fonts renderizado; ausente: nenhum link', () => {
  render(
    <BlockRenderer
      layout={{ version: 1, fonts: 'fraunces', blocks: [] }}
      snapshot={makeSnapshotFixture()}
      mode="view"
    />,
  );
  expect(
    document.querySelector('link[href*="fonts.googleapis.com"][href*="Fraunces"]'),
  ).not.toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/report-blocks/__tests__/BlockRenderer.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

`packages/report-blocks/ReportFonts.tsx`:

```tsx
// Injeta o stylesheet do Google Fonts da dupla escolhida. React 19 iça
// <link> para o <head>; sem fonts (herdado) ou dupla sem href (system), nada
// renderiza. precedence é exigido pelo React 19 para dedup/ordenação.
import type { ReportLayout } from './types';
import { resolveReportTheme } from './theme';
import type { ReportDocSnapshot } from './types';

export function ReportFonts({
  layout,
  snapshot,
}: {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
}) {
  const { fontHref } = resolveReportTheme(layout, snapshot);
  if (!fontHref) return null;
  return <link rel="stylesheet" href={fontHref} precedence="default" />;
}
```

`BlockRenderer.tsx`: remover `resolveLayoutAccent` e o import de
`resolveAccent`; usar:

```tsx
import { resolveReportTheme } from './theme';
import { ReportFonts } from './ReportFonts';
// ...
const theme = resolveReportTheme(layout, snapshot);
return (
  <>
    <ReportFonts layout={layout} snapshot={snapshot} />
    <div
      className={`rb-grid rb-mode-${mode}${theme.themeClass ? ` ${theme.themeClass}` : ''}`}
      style={theme.vars as React.CSSProperties}
    >
      {/* map de blocos inalterado */}
    </div>
  </>
);
```

`EditorCanvas.tsx`: trocar `resolveLayoutAccent(layout, snapshot)` por
`resolveReportTheme(layout, snapshot)`, aplicar `theme.vars` (substituindo o
style de duas vars atual) + `theme.themeClass` na className do grid, e
renderizar `<ReportFonts layout={layout} snapshot={snapshot} />` antes do
grid. O `DragOverlay` continua igual.

`styles.css` — fundo do documento + variantes de tema:

```css
/* Fundo do documento: transparente no modo herdado (a página decide), token
   nos temas explícitos. */
.rb-grid {
  background: var(--rb-bg, transparent);
  color: var(--rb-ink, inherit);
  font-family: var(--rb-font-body, inherit);
}
/* Editorial: cartões viram linhas — só borda na base, sem caixa. */
.rb-theme-editorial .rb-card {
  border: 0;
  border-bottom: 1px solid var(--rb-border);
  border-radius: 0;
  background: transparent;
}
.rb-theme-editorial .rb-card--flush {
  border-bottom: 0;
}
/* Bold: destaque preenchido SÓ em capa e cabeçalho de seção (spec, mapa
   visual). Os componentes cover/section_header usam os tokens direto; aqui
   só o que é CSS puro. */
.rb-theme-bold .rb-card-title {
  color: var(--rb-accent-text);
}
```

`CoverBlock.tsx` e `SectionHeaderBlock.tsx` (+ `SectionHeaderEditor.tsx` no
CRM para paridade visual no modo edição): título com
`fontFamily: 'var(--rb-font-display, inherit)'`; no CoverBlock, o fundo do
cartão de capa passa a `background: 'var(--rb-cover-bg, #12151a)'` e cor
`var(--rb-cover-fg, #ffffff)` — e o resolvedor (Task 1) NÃO emite essas vars
nos temas clean/editorial/herdado (fallback = visual atual) e emite
`'--rb-cover-bg': acc, '--rb-cover-fg': accFg` SÓ no bold. Acrescentar ao
teste da Task 1:

```ts
it('bold emite cover tokens; demais temas nao', () => {
  const bold = resolveReportTheme(layout({ theme: 'bold', accent: '#7c3aed' }), makeSnapshotFixture());
  expect(bold.vars['--rb-cover-bg']).toBe('#7c3aed');
  const clean = resolveReportTheme(layout({ theme: 'clean' }), makeSnapshotFixture());
  expect(clean.vars['--rb-cover-bg']).toBeUndefined();
});
```

`SectionHeaderBlock`: título `color: 'var(--rb-section-title, inherit)'` e o
resolvedor emite `'--rb-section-title': accentText` só no bold (barra já usa
`--rb-accent`).

- [ ] **Step 4: Rodar pacote + editor inteiros**

Run: `npx vitest run packages/report-blocks apps/crm/src/pages/relatorio-editor`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/report-blocks apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx apps/crm/src/pages/relatorio-editor/SectionHeaderEditor.tsx
git commit -m "feat(relatorios): renderers aplicam tema, fontes e variantes editorial/bold"
```

---

### Task 6: Popover "Aparência" no editor

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/AppearancePopover.tsx`
- Modify: `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx` (substituir o bloco ColorPicker das linhas ~216-230)
- Modify: `apps/crm/src/pages/relatorio-editor/layoutOps.ts`
- Modify: `apps/crm/style.css`
- Test: `apps/crm/src/pages/relatorio-editor/__tests__/AppearancePopover.test.tsx`, `apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts`

**Interfaces:**
- Consumes: `FONT_PAIRINGS`, `REPORT_THEME_IDS`, `REPORT_FONT_IDS` (Tasks 1-2); `applyLayout`/`layoutRef` da página (padrão existente).
- Produces: `setLayoutTheme(layout, theme: ReportThemeId | undefined)`, `setLayoutFonts(layout, fonts: ReportFontId | undefined)` em layoutOps (imutáveis; `undefined` REMOVE a chave; mesmo valor = MESMA referência); componente `AppearancePopover({ layout, snapshot, onChange })` com `onChange(next: ReportLayout)`.

- [ ] **Step 1: Testes de layoutOps que falham**

```ts
describe('setLayoutTheme / setLayoutFonts', () => {
  it('define, troca e remove com undefined', () => {
    let l = setLayoutTheme(layout(), 'editorial');
    expect(l.theme).toBe('editorial');
    l = setLayoutFonts(l, 'fraunces');
    expect(l.fonts).toBe('fraunces');
    const off = setLayoutTheme(l, undefined);
    expect('theme' in off).toBe(false);
    expect(off.fonts).toBe('fraunces');
  });
  it('mesmo valor devolve a MESMA referencia (contrato do autosave)', () => {
    const l = setLayoutTheme(layout(), 'bold');
    expect(setLayoutTheme(l, 'bold')).toBe(l);
    const base = layout();
    expect(setLayoutTheme(base, undefined)).toBe(base);
  });
});
```

- [ ] **Step 2: Implementar layoutOps**

```ts
export function setLayoutTheme(
  layout: ReportLayout,
  theme: ReportThemeId | undefined,
): ReportLayout {
  if (layout.theme === theme) return layout;
  if (theme === undefined) {
    const { theme: _drop, ...rest } = layout;
    return rest as ReportLayout;
  }
  return { ...layout, theme };
}

export function setLayoutFonts(
  layout: ReportLayout,
  fonts: ReportFontId | undefined,
): ReportLayout {
  if (layout.fonts === fonts) return layout;
  if (fonts === undefined) {
    const { fonts: _drop, ...rest } = layout;
    return rest as ReportLayout;
  }
  return { ...layout, fonts };
}
```

- [ ] **Step 3: Componente + testes**

`AppearancePopover.tsx` (shadcn Popover; copy pt-BR sem travessão):

```tsx
// Popover "Aparência": tema, dupla de fontes e cor de destaque num lugar só
// (decisão do visual companion 2026-08-24: popover, não drawer). Toda mudança
// flui por onChange -> applyLayout -> autosave; preview é imediato porque os
// tokens são CSS vars no canvas.
import { Palette } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorPicker } from '@/components/shared/ColorPicker';
import { FONT_PAIRINGS } from '@mesaas/report-blocks/theme';
import type {
  ReportDocSnapshot, ReportFontId, ReportLayout, ReportThemeId,
} from '@mesaas/report-blocks/types';
import { REPORT_FONT_IDS } from '@mesaas/report-blocks/types';
import { setLayoutAccent, setLayoutFonts, setLayoutTheme } from './layoutOps';

const THEME_OPTIONS: { id: ReportThemeId | undefined; label: string; hint: string }[] = [
  { id: undefined, label: 'Padrão', hint: 'segue a página' },
  { id: 'clean', label: 'Clean', hint: 'claro e neutro' },
  { id: 'editorial', label: 'Editorial', hint: 'creme, serifa' },
  { id: 'bold', label: 'Bold', hint: 'marca em tudo' },
];

export interface AppearancePopoverProps {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
  onChange: (next: ReportLayout) => void;
}

export function AppearancePopover({ layout, snapshot, onChange }: AppearancePopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="btn-secondary rb-appearance-trigger">
          <Palette className="h-4 w-4" /> Aparência
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="rb-appearance">
        <p className="rb-appearance-label">Tema</p>
        <div className="rb-appearance-themes" role="radiogroup" aria-label="Tema do relatório">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={layout.theme === opt.id}
              className={`rb-appearance-theme${layout.theme === opt.id ? ' rb-appearance-selected' : ''}`}
              onClick={() => onChange(setLayoutTheme(layout, opt.id))}
            >
              <span className={`rb-appearance-thumb rb-appearance-thumb-${opt.id ?? 'default'}`} />
              <span>
                {opt.label}
                <small>{opt.hint}</small>
              </span>
            </button>
          ))}
        </div>
        <p className="rb-appearance-label">Fontes</p>
        <div role="radiogroup" aria-label="Fontes do relatório">
          {REPORT_FONT_IDS.map((id: ReportFontId) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={layout.fonts === id}
              className={`rb-appearance-font${layout.fonts === id ? ' rb-appearance-selected' : ''}`}
              onClick={() => onChange(setLayoutFonts(layout, layout.fonts === id ? undefined : id))}
            >
              <span
                className="rb-appearance-ag"
                style={{ fontFamily: FONT_PAIRINGS[id].display }}
                aria-hidden
              >
                Ag
              </span>
              {FONT_PAIRINGS[id].label}
            </button>
          ))}
        </div>
        <p className="rb-appearance-label">Cor de destaque</p>
        <div className="rb-appearance-accent">
          <ColorPicker
            value={layout.accent ?? snapshot.branding.accent_color}
            onChange={(hex) => onChange(setLayoutAccent(layout, hex))}
            brandColors={[snapshot.branding.accent_color]}
            allowAlpha={false}
          />
          {layout.accent && (
            <button
              type="button"
              className="rb-appearance-reset"
              onClick={() => onChange(setLayoutAccent(layout, undefined))}
            >
              usar cor da marca
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

ATENÇÃO: conferir a assinatura real do `ColorPicker` compartilhado antes de
copiar as props (o uso atual na página é a referência; `allowAlpha={false}`
já é usado lá — se não for, replicar as props do uso atual). O botão
"Aparência" replica o estilo dos botões existentes do cabeçalho (ver classes
usadas por "Exportar PDF" na página e imitar).

Na `RelatorioEditorPage.tsx`: remover o bloco atual do `ColorPicker` +
botão de reset (linhas ~216-230) e o import de `ColorPicker`; no lugar:

```tsx
<AppearancePopover
  layout={layout}
  snapshot={snapshot}
  onChange={applyLayout}
/>
```

(`layout` já é o estado vivo; `applyLayout` já faz autosave. Os helpers de
layoutOps usam o layout RECEBIDO, então não precisa de layoutRef aqui — o
popover recebe o layout renderizado, mesmo padrão do LayersPanel.)

Teste `AppearancePopover.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppearancePopover } from '../AppearancePopover';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const layout = (over: Partial<ReportLayout> = {}): ReportLayout => ({
  version: 1, blocks: [], ...over,
});

describe('AppearancePopover', () => {
  it('abre com temas, fontes e cor; seleciona tema', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Editorial/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ theme: 'editorial' }));
  });
  it('clicar na fonte ja selecionada volta a herdar (remove a chave)', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover
        layout={layout({ fonts: 'fraunces' })}
        snapshot={makeSnapshotFixture()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Fraunces/ }));
    const next = onChange.mock.calls[0][0];
    expect('fonts' in next).toBe(false);
  });
  it('"usar cor da marca" so aparece com override e remove o accent', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover
        layout={layout({ accent: '#123456' })}
        snapshot={makeSnapshotFixture()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('button', { name: 'usar cor da marca' }));
    const next = onChange.mock.calls[0][0];
    expect('accent' in next).toBe(false);
  });
});
```

(Radix Popover abre com fireEvent.click em jsdom; se o conteúdo não montar,
usar o padrão dos testes existentes de dialog do diretório — ler
`SaveTemplateDialog.test.tsx` e imitar.)

CSS em `apps/crm/style.css` (append, valores exatos a gosto do implementador
DENTRO destas restrições): `.rb-appearance { width: 280px }`, labels
uppercase pequenos, `.rb-appearance-theme`/`.rb-appearance-font` como linhas
clicáveis com estado `.rb-appearance-selected` (borda `--primary-color`),
thumbs de tema como retângulos 40x24 (default: outline tracejado; clean:
branco com borda; editorial: `#faf6ee`; bold: `#7c3aed`), `.rb-appearance-ag`
com 18px.

- [ ] **Step 4: Rodar os testes do editor**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor`
Expected: PASS (inclusive RelatorioEditorPage.test — se ele referenciar o
ColorPicker removido, atualizar as asserções para o popover)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor apps/crm/style.css
git commit -m "feat(relatorios): popover Aparencia com tema, fontes e cor"
```

---

### Task 7: Print/PDF paginado

**Files:**
- Modify: `apps/hub/src/pages/RelatorioPrintPage.tsx`
- Modify: `apps/hub/src/pages/RelatorioDocPage.tsx`
- Modify: `supabase/functions/_shared/report-template/pdf-url.ts`
- Test: `supabase/functions/report-docs/pdf.test.ts` (ou o arquivo que testa `buildGotenbergUrlRequest` — localizar com grep), `apps/hub/src/pages/__tests__/RelatorioPrintPage.test.tsx` (se existir; senão o teste de página do Hub equivalente)

**Interfaces:**
- Consumes: `resolveReportTheme` (Task 1).
- Produces: margens zero na requisição Gotenberg; `@page { margin: 10mm }` + fundo tematizado na página de impressão.

- [ ] **Step 1: Teste Deno que falha (margens na requisição)**

No teste existente de `buildGotenbergUrlRequest` (localizar com
`grep -rn "buildGotenbergUrlRequest" supabase/functions --include="*.test.ts"`),
acrescentar:

```ts
Deno.test("gotenberg: margens zeradas incondicionalmente (inset vem do @page da pagina)", () => {
  const req = buildGotenbergUrlRequest("https://x/print/1", {});
  const form = /* extrair FormData da requisicao como o teste existente ja faz */;
  assertEquals(form.get("marginTop"), "0");
  assertEquals(form.get("marginBottom"), "0");
  assertEquals(form.get("marginLeft"), "0");
  assertEquals(form.get("marginRight"), "0");
});
```

(Adaptar a extração do FormData ao harness do teste existente — ler o
arquivo primeiro.)

- [ ] **Step 2: Implementar `pdf-url.ts`**

Junto do `printBackground`:

```ts
  // Margens da folha ficam a cargo do @page{margin} da própria página de
  // impressão: padding de wrapper contínuo não se repete após quebra de
  // página, @page sim. Zerado aqui para TODOS os temas (a edge function não
  // conhece o layout, e não precisa).
  formData.append("marginTop", "0");
  formData.append("marginBottom", "0");
  formData.append("marginLeft", "0");
  formData.append("marginRight", "0");
```

- [ ] **Step 3: Página de impressão**

Em `RelatorioPrintPage.tsx`, no return de sucesso:

```tsx
const theme = resolveReportTheme(doc.layout as ReportLayout, doc.data_snapshot as ReportDocSnapshot);
return (
  <div style={{ background: theme.vars['--rb-bg'] ?? '#ffffff', minHeight: '100vh' }}>
    {/* Inset por página via @page (repete em TODA página, ao contrário de
        padding de wrapper); 10mm = o default do Gotenberg que as margens
        zeradas da requisição substituem. O fundo do body propaga para o
        canvas da folha inteira, margens incluídas. */}
    <style>{`@page { margin: 10mm; } body { background: ${theme.vars['--rb-bg'] ?? '#ffffff'}; }`}</style>
    <BlockRenderer
      layout={doc.layout as ReportLayout}
      snapshot={doc.data_snapshot as ReportDocSnapshot}
      mode="print"
    />
  </div>
);
```

(O `<link>` das fontes já vem do `ReportFonts` dentro do BlockRenderer —
Task 5 — e o `__REPORT_READY` já espera `document.fonts.ready`.)

`RelatorioDocPage.tsx` (Hub): nenhum código novo além do que o BlockRenderer
já aplica (tokens no `.rb-grid`); verificar apenas que nada da página força
fundo por cima do `.rb-grid` — se o container `max-w-5xl` tiver bg próprio,
não tem (conferido na leitura), então sem mudança de código; registrar no
relatório da task.

- [ ] **Step 4: Rodar Deno + hub tsc**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/ && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/pages/RelatorioPrintPage.tsx supabase/functions/_shared/report-template/pdf-url.ts
git commit -m "feat(relatorios): impressao tematizada com @page e margens zeradas"
```

---

### Task 8: Gates completos + verificação em browser (CONTROLLER, não subagente)

**Files:** nenhum novo (correções pontuais se os gates acharem algo)

- [ ] **Step 1: Gates na ordem anti-poluição**

```bash
npm run test:functions
git checkout -- deno.lock
rm -rf node_modules/.deno && npm ci
npx vitest run
npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json
npm run lint && npm run format:check
```

- [ ] **Step 2: Verificação browser (dev server prod)**

1. Doc LEGADO (ex.: Roberta `92921080-…`): computed styles de um KPI card
   (border, background, radius, font-family) ANTES do checkout do branch e
   DEPOIS — idênticos no editor E no Hub. Incluir um Hub de paleta ESCURA
   (workspace com brand escura ou forçar via Personalizar) e conferir que o
   relatório continua herdando.
2. Popover Aparência: trocar tema (os 3 + Padrão), fonte (as 4 + voltar a
   herdar), cor (+ "usar cor da marca") com preview ao vivo e "Salvo".
3. Salvar como template com aparência; aplicar em outro doc; conferir que o
   visual veio junto.
4. Screenshot por tema no editor e no Hub.
5. Exportar PDF de um relatório LONGO em editorial: fundo creme e inset de
   10mm nas páginas 2+; PDF de doc herdado idêntico ao de antes (comparar com
   um export pré-branch guardado).
6. Enviar os screenshots e o resultado ao usuário.

- [ ] **Step 3: Commit final de ajustes (se houver) e push**

---

## Self-review (feito na escrita)

- Cobertura da spec: schema+herdado (T2), migration (T3), resolvedor+accent-text+cover/section tokens (T1/T5), .rb-card+modificadores+accent-text no chip (T4), variantes editorial/bold (T5), popover (T6), fontes nas 3 superfícies (T5 via ReportFonts dentro do BlockRenderer usado por todas; editor idem), @page/margens (T7), verificação browser incl. Hub escuro e PDF multipágina (T8). Fora da v1 sem task — correto.
- Tipos consistentes: `ReportTheme{vars,themeClass,fontHref}` (T1) consumido em T5/T7; `setLayoutTheme/Fonts` (T6) só em T6; `REPORT_THEME_IDS/FONT_IDS` (T2) em T3 (espelho SQL) e T6.
- Sem placeholders: todos os passos têm código ou comando concreto; os dois pontos "ler o arquivo primeiro e imitar o harness" são instrução deliberada de conformidade com harness existente, com localização dada.
