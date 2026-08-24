import { describe, expect, it } from 'vitest';
import { FONT_PAIRINGS, contrastRatio, resolveReportTheme } from '../theme';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout, SnapshotHubTheme } from '../types';
import { REPORT_THEME_IDS } from '../types';

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
  it('emite SÓ accent, accent-fg, accent-text e accent-line; nenhuma var de fundo/fonte', () => {
    const t = resolveReportTheme(layout(), makeSnapshotFixture());
    expect(Object.keys(t.vars).sort()).toEqual([
      '--rb-accent',
      '--rb-accent-fg',
      '--rb-accent-line',
      '--rb-accent-text',
    ]);
    expect(t.themeClass).toBeNull();
    expect(t.fontHref).toBeNull();
  });
  it('accent escuro/médio: text e line devolvem a PRÓPRIA cor (identidade = docs legados intactos)', () => {
    const t = resolveReportTheme(layout({ accent: '#7c3aed' }), makeSnapshotFixture());
    expect(t.vars['--rb-accent-text']).toBe('#7c3aed');
    expect(t.vars['--rb-accent-line']).toBe('#7c3aed');
  });
  it('accent CLARO é preservado nos preenchimentos (decisão 2026-08-24: sem clamp)', () => {
    const t = resolveReportTheme(layout({ accent: '#ffdbc1' }), makeSnapshotFixture());
    expect(t.vars['--rb-accent']).toBe('#ffdbc1');
    // Capa clara pede texto escuro por cima.
    expect(t.vars['--rb-accent-fg']).toBe('#171717');
    // Texto e traço derivam tons legíveis contra papel claro.
    expect(contrastRatio(t.vars['--rb-accent-text'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.vars['--rb-accent-line'], '#ffffff')).toBeGreaterThanOrEqual(3.0);
  });
  it('branco puro: preservado, com derivados legíveis', () => {
    const t = resolveReportTheme(layout({ accent: '#ffffff' }), makeSnapshotFixture());
    expect(t.vars['--rb-accent']).toBe('#ffffff');
    expect(t.vars['--rb-accent-fg']).toBe('#171717');
    expect(contrastRatio(t.vars['--rb-accent-line'], '#ffffff')).toBeGreaterThanOrEqual(3.0);
  });
  it('theme/fonts persistidos fora dos enums degradam para herdado, sem crash', () => {
    const t = resolveReportTheme(
      layout({ theme: 'dark', fonts: 'comic-sans' } as unknown as Partial<ReportLayout>),
      makeSnapshotFixture(),
    );
    expect(t.themeClass).toBeNull();
    expect(t.fontHref).toBeNull();
    expect(t.vars['--rb-bg']).toBeUndefined();
    expect(t.vars['--rb-font-display']).toBeUndefined();
  });
  it('hex inválido segue caindo no neutro #171717', () => {
    const t2 = resolveReportTheme(
      layout(),
      makeSnapshotFixture({
        branding: { workspace_name: 'W', logo_url: null, splash_url: null, accent_color: 'lixo' },
      }),
    );
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
  it('bold emite cover tokens; demais temas nao', () => {
    const bold = resolveReportTheme(
      layout({ theme: 'bold', accent: '#7c3aed' }),
      makeSnapshotFixture(),
    );
    expect(bold.vars['--rb-cover-bg']).toBe('#7c3aed');
    const clean = resolveReportTheme(layout({ theme: 'clean' }), makeSnapshotFixture());
    expect(clean.vars['--rb-cover-bg']).toBeUndefined();
  });

  it('bold com accent CLARO: capa fica com a cor crua e texto escuro; traços derivam', () => {
    const t = resolveReportTheme(
      layout({ theme: 'bold', accent: '#ffdbc1' }),
      makeSnapshotFixture(),
    );
    expect(t.vars['--rb-cover-bg']).toBe('#ffdbc1');
    expect(t.vars['--rb-cover-fg']).toBe('#12151a');
    expect(contrastRatio(t.vars['--rb-accent-line'], t.vars['--rb-bg'])).toBeGreaterThanOrEqual(
      3.0,
    );
    expect(contrastRatio(t.vars['--rb-section-title'], t.vars['--rb-bg'])).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('REPORT_THEME_IDS inclui hub ao lado dos temas fixos', () => {
    expect([...REPORT_THEME_IDS]).toEqual(['clean', 'editorial', 'bold', 'hub']);
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
      'fraunces',
      'grotesk',
      'playfair',
      'system',
    ]);
    for (const p of Object.values(FONT_PAIRINGS)) {
      expect(p.display).toMatch(/serif|sans-serif/);
      expect(p.body).toMatch(/serif|sans-serif/);
    }
  });
});

describe('tema hub (deriva da config whitelabel do portal)', () => {
  const hubSnapshot = (hub_theme: SnapshotHubTheme) =>
    makeSnapshotFixture({
      branding: {
        workspace_name: 'W',
        logo_url: null,
        splash_url: null,
        accent_color: '#7c3aed',
        hub_theme,
      },
    });

  it('mapeia superficie, radius e card style filled para os tokens do relatorio', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({
        surface: 'neutral',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'filled',
      }),
    );
    expect(t.vars['--rb-bg']).toBe('#FAFAFA');
    expect(t.vars['--rb-ink']).toBe('#171717');
    expect(t.vars['--rb-border']).toBe('rgba(0,0,0,.08)');
    expect(t.vars['--rb-radius']).toBe('12px');
    expect(t.vars['--rb-surface']).toBe('#FFFFFF');
    expect(t.themeClass).toBe('rb-theme-hub');
  });

  it('card style outline usa a borda mais forte e superficie transparente', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({
        surface: 'neutral',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'outline',
      }),
    );
    expect(t.vars['--rb-border']).toBe('rgba(0,0,0,.2)');
    expect(t.vars['--rb-surface']).toBe('transparent');
  });

  it('card style tonal usa o soft da paleta como superficie', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({
        surface: 'warm',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'tonal',
      }),
    );
    expect(t.vars['--rb-surface']).toBe('#F3EEE7');
  });

  it('superficie warm e cool usam a paleta light correspondente', () => {
    const warm = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({
        surface: 'warm',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'filled',
      }),
    );
    expect(warm.vars['--rb-bg']).toBe('#FAF7F2');
    const cool = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({
        surface: 'cool',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'filled',
      }),
    );
    expect(cool.vars['--rb-bg']).toBe('#F7F9FB');
  });

  it('fontes do hub entram com includeDefaults quando layout.fonts esta ausente', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({
        surface: 'neutral',
        font_display: 'space-grotesk',
        font_body: 'manrope',
        radius: 'soft',
        card_style: 'filled',
      }),
    );
    expect(t.vars['--rb-font-display']).toContain('Space Grotesk');
    expect(t.vars['--rb-font-body']).toContain('Manrope');
    expect(t.fontHref).toContain('Space+Grotesk');
  });

  it('layout.fonts explicito vence a fonte do hub', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub', fonts: 'playfair' }),
      hubSnapshot({
        surface: 'neutral',
        font_display: 'space-grotesk',
        font_body: 'manrope',
        radius: 'soft',
        card_style: 'filled',
      }),
    );
    expect(t.vars['--rb-font-display']).toContain('Playfair');
  });

  it('snapshot antigo sem hub_theme cai nos defaults neutros sem lancar', () => {
    const t = resolveReportTheme(layout({ theme: 'hub' }), makeSnapshotFixture());
    expect(t.vars['--rb-bg']).toBe('#FAFAFA');
    expect(t.vars['--rb-radius']).toBe('12px');
  });

  it('ids desconhecidos persistidos (surface/fonte/radius) caem nos defaults sem lancar', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({
        surface: 'galaxy',
        font_display: 'comic-sans',
        font_body: 'papyrus',
        radius: 'huge',
        card_style: 'glassy',
      } as any),
    );
    expect(t.vars['--rb-bg']).toBe('#FAFAFA');
    expect(t.vars['--rb-radius']).toBe('12px');
    expect(t.vars['--rb-surface']).toBe('#FFFFFF');
  });

  it('accent deriva accent-text/accent-line contra o bg do hub, sem tokens de capa/secao', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({
        surface: 'neutral',
        font_display: 'fraunces',
        font_body: 'instrument-sans',
        radius: 'soft',
        card_style: 'filled',
      }),
    );
    expect(contrastRatio(t.vars['--rb-accent-text'], t.vars['--rb-bg'])).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(t.vars['--rb-accent-line'], t.vars['--rb-bg'])).toBeGreaterThanOrEqual(
      3.0,
    );
    expect(t.vars['--rb-cover-bg']).toBeUndefined();
    expect(t.vars['--rb-section-title']).toBeUndefined();
  });
});
