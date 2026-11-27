import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { makeSnapshotFixture } from '../fixtures';
import { BLOCK_TYPES, type ReportBlock, type ReportLayout } from '../types';
import { REPORT_TEXT, normalizeReportLang } from '../i18n';
import { fmtCount, fmtPct, fmtPeriodStamp, fmtSignedPct } from '../format';
import {
  fmtDayMonth,
  fmtDayShort,
  fmtMonthYear,
  fmtRating,
  fmtWindowStamp,
} from '../blocks/gbp/format';
import { coverDefaults } from '../platform';
import { formatMetric, verdictFor } from '../health';
import { reportDocsText } from '../../../supabase/functions/_shared/i18n/catalogs/report-docs';

/** Caminhos das folhas do catálogo com o tipo de cada uma (string, function, null). */
function shape(value: unknown, path = ''): string[] {
  if (value === null) return [`${path}:null`];
  if (typeof value === 'function') return [`${path}:function`];
  if (typeof value !== 'object') return [`${path}:${typeof value}`];
  return Object.keys(value as object)
    .sort()
    .flatMap((k) => shape((value as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
}

/** Folhas string do catálogo (para procurar português vazando no render em inglês). */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as object).flatMap(stringLeaves);
}

const allBlocksLayout: ReportLayout = {
  version: 1,
  blocks: BLOCK_TYPES.map((type, i) => ({ id: `b${i}`, type, size: 'full' }) as ReportBlock),
};

describe('catálogo de idiomas dos blocos', () => {
  it('pt e en têm o mesmo formato', () => {
    expect(shape(REPORT_TEXT.en)).toEqual(shape(REPORT_TEXT.pt));
  });

  it('rótulos dos KPIs em inglês iguais aos do catálogo do report-docs', () => {
    const edge = reportDocsText('en');
    expect(REPORT_TEXT.en.kpi.labels).toEqual(edge.kpiInstagram);
    expect(REPORT_TEXT.en.kpi.tiktokLabels).toEqual(edge.kpiTikTok);
    expect(REPORT_TEXT.en.kpi.gbpLabels).toEqual(edge.kpiGoogle);
  });

  it('normalizeReportLang: só "en" vira inglês', () => {
    expect(normalizeReportLang('en')).toBe('en');
    expect(normalizeReportLang('pt')).toBe('pt');
    expect(normalizeReportLang(undefined)).toBe('pt');
    expect(normalizeReportLang('fr')).toBe('pt');
  });
});

describe('formatação por idioma', () => {
  const period = {
    start: '2026-07-01T00:00:00.000Z',
    endExclusive: '2026-08-01T00:00:00.000Z',
    effectiveEnd: '2026-07-29T00:00:00.000Z',
  };

  it('padrão continua pt-BR', () => {
    expect(fmtCount(12450)).toBe('12.450');
    expect(fmtPct(4.7)).toBe('4,7%');
    expect(fmtSignedPct(-3.25)).toBe('-3,3%');
    expect(fmtPeriodStamp(period)).toBe('01–29 de julho · parcial');
    expect(fmtDayMonth('2026-07-18')).toBe('18 de julho');
    expect(fmtMonthYear('2026-07')).toBe('Julho de 2026');
    expect(fmtDayShort('2026-07-18')).toBe('18/07');
    expect(fmtRating(4.82)).toBe('4,8');
    expect(formatMetric('engagement_rate', 0.0193)).toBe('1,93%');
    expect(verdictFor(85).label).toBe('Muito bom');
  });

  it('en usa separadores, datas e textos em inglês', () => {
    expect(fmtCount(12450, 'en')).toBe('12,450');
    expect(fmtPct(4.7, 'en')).toBe('4.7%');
    expect(fmtSignedPct(-3.25, 'en')).toBe('-3.3%');
    expect(fmtPeriodStamp(period, 'en')).toBe('July 01–29 · partial');
    expect(fmtDayMonth('2026-07-18', 'en')).toBe('July 18');
    expect(fmtMonthYear('2026-07', 'en')).toBe('July 2026');
    expect(fmtDayShort('2026-07-18', 'en')).toBe('07/18');
    expect(fmtRating(4.82, 'en')).toBe('4.8');
    expect(
      fmtWindowStamp(
        { start: '2026-07-01', end: '2026-07-31', prevStart: '2026-06-01', prevEnd: '2026-06-30' },
        period.endExclusive,
        'en',
      ),
    ).toBe('July 01–31');
    expect(formatMetric('engagement_rate', 0.0193, 'en')).toBe('1.93%');
    expect(verdictFor(85, 'en').label).toBe('Very good');
  });

  it('kicker da capa em inglês', () => {
    const snap = makeSnapshotFixture();
    expect(coverDefaults(snap, ['instagram', 'google'], 'en').kicker).toBe(
      'Monthly report · Instagram and Google Business Profile',
    );
  });
});

describe('BlockRenderer com lang', () => {
  it('sem lang continua em português', () => {
    const { container } = render(
      <BlockRenderer layout={allBlocksLayout} snapshot={makeSnapshotFixture()} mode="print" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Alcance acumulado');
    expect(text).toContain('45.200');
  });

  it('lang="en" renderiza rótulos e números em inglês', () => {
    const { container } = render(
      <BlockRenderer
        layout={allBlocksLayout}
        snapshot={makeSnapshotFixture()}
        mode="print"
        lang="en"
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Cumulative reach');
    expect(text).toContain('45,200');
    expect(text).toContain('Follower growth');
    expect(text).toContain('Monthly report');
  });

  it('lang="en" não deixa nenhum texto fixo em português no documento', () => {
    const snapshot = makeSnapshotFixture();
    const { container } = render(
      <BlockRenderer layout={allBlocksLayout} snapshot={snapshot} mode="print" lang="en" />,
    );
    const html = container.innerHTML;
    // Dado do snapshot ("Unidade Centro", legendas) é conteúdo do cliente, não rótulo.
    const data = JSON.stringify(snapshot);
    const en = new Set(stringLeaves(REPORT_TEXT.en));
    const leaks = stringLeaves(REPORT_TEXT.pt).filter(
      (s) => s.length > 3 && !en.has(s) && !data.includes(s) && html.includes(s),
    );
    expect(leaks).toEqual([]);
  });
});
