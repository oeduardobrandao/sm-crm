import { describe, expect, it } from 'vitest';

import {
  buildDeltaPp,
  formatDataCurta,
  formatHoras,
  formatHorasOuSemDados,
  horizonteCaption,
  SEM_DADOS,
} from '../format';

describe('formatHoras', () => {
  it('keeps minutes below an hour', () => {
    expect(formatHoras(0.75)).toBe('45min');
    expect(formatHoras(0.5)).toBe('30min');
  });

  it('drops the minutes when they round away', () => {
    expect(formatHoras(3)).toBe('3h');
    expect(formatHoras(3.004)).toBe('3h');
  });

  it('keeps minutes alongside hours below a day', () => {
    // The mockup's fastest client: 3h20 must not collapse to "3h".
    expect(formatHoras(3.333)).toBe('3h 20min');
    expect(formatHoras(23.5)).toBe('23h 30min');
  });

  it('switches to days above 24h and drops the minutes there', () => {
    expect(formatHoras(28)).toBe('1d 4h');
    expect(formatHoras(28.4)).toBe('1d 4h');
    expect(formatHoras(48)).toBe('2d');
    expect(formatHoras(98)).toBe('4d 2h');
  });

  it('rolls 59.6 minutes up into a whole hour instead of printing "60min"', () => {
    expect(formatHoras(0.995)).toBe('1h');
  });

  it('clamps a negative duration at zero rather than printing "-2h"', () => {
    expect(formatHoras(-2)).toBe('0min');
  });

  it('routes null through SEM_DADOS instead of a fabricated zero', () => {
    expect(formatHorasOuSemDados(null)).toBe(SEM_DADOS);
    expect(formatHorasOuSemDados(28)).toBe('1d 4h');
  });
});

describe('buildDeltaPp', () => {
  it('reports the point difference, not the relative change', () => {
    // 61 vs 69 is 8 points down. The relative reading would be 11.6%, which is
    // the number this helper exists to stop the page from printing.
    expect(buildDeltaPp(61, 69, 43, 40)).toEqual({
      direction: 'down',
      percent: 8,
      caption: 'vs período anterior (pp)',
    });
  });

  it('points up when the metric improved', () => {
    expect(buildDeltaPp(75, 60, 10, 10)?.direction).toBe('up');
    expect(buildDeltaPp(75, 60, 10, 10)?.percent).toBe(15);
  });

  it('calls an unchanged percentage stable', () => {
    expect(buildDeltaPp(61, 61, 5, 5)?.direction).toBe('stable');
  });

  it('refuses to compare when the previous window rated nothing', () => {
    expect(buildDeltaPp(61, 69, 43, 0)).toBeNull();
  });

  it('refuses to compare when the current window rated nothing', () => {
    expect(buildDeltaPp(61, 69, 0, 40)).toBeNull();
  });

  it('refuses to compare when either percentage is missing', () => {
    expect(buildDeltaPp(null, 69, 43, 40)).toBeNull();
    expect(buildDeltaPp(61, null, 43, 40)).toBeNull();
  });
});

describe('formatDataCurta', () => {
  it('renders a timestamptz as pt-BR dd/MM/yyyy', () => {
    expect(formatDataCurta('2026-08-04T14:30:00+00:00')).toBe('04/08/2026');
  });

  it('returns null for a missing or unparseable horizon', () => {
    expect(formatDataCurta(null)).toBeNull();
    expect(formatDataCurta('nao-e-uma-data')).toBeNull();
  });
});

describe('horizonteCaption', () => {
  it('builds the caption from a real horizon', () => {
    expect(horizonteCaption('2026-08-04T14:30:00+00:00')).toBe('Registrado desde 04/08/2026');
  });

  it('omits itself when the source has no events yet', () => {
    expect(horizonteCaption(null)).toBeNull();
  });
});
