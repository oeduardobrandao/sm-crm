import { describe, it, expect } from 'vitest';
import {
  percentileFromCuts,
  verdictFor,
  overallPercentile,
  bandLabel,
  roundedSampleLabel,
  formatMetric,
} from '../ig-account-health';

// cuts[i] = i + 1  (p1..p99 valores 1..99)
const SEQ_CUTS = Array.from({ length: 99 }, (_, i) => i + 1);

describe('percentileFromCuts', () => {
  it('usa posto médio com empates (40 zeros em p1..p40)', () => {
    const cuts = Array.from({ length: 99 }, (_, i) => (i < 40 ? 0 : i));
    expect(percentileFromCuts(0, cuts)).toBe(21);
  });

  it('interpola entre cortes sem empate', () => {
    expect(percentileFromCuts(50, SEQ_CUTS)).toBe(50);
    expect(percentileFromCuts(50.5, SEQ_CUTS)).toBe(51);
  });

  it('limita a 0 abaixo de p1 e a 100 acima de p99', () => {
    expect(percentileFromCuts(-1, SEQ_CUTS)).toBe(0);
    expect(percentileFromCuts(1000, SEQ_CUTS)).toBe(100);
  });

  it('interpola entre 0 e p1 quando o valor está abaixo de p1', () => {
    expect(percentileFromCuts(0.5, SEQ_CUTS)).toBe(1);
  });
});

describe('verdictFor', () => {
  it.each([
    [80, 'Muito bom', 'great'],
    [79, 'Bom', 'good'],
    [60, 'Bom', 'good'],
    [59, 'Na média', 'avg'],
    [40, 'Na média', 'avg'],
    [39, 'Ruim', 'bad'],
    [20, 'Ruim', 'bad'],
    [19, 'Muito ruim', 'worst'],
  ])('pct %i -> %s (%s)', (pct, label, tone) => {
    expect(verdictFor(pct)).toEqual({ label, tone });
  });
});

describe('overallPercentile', () => {
  it('faz a média arredondada', () => {
    expect(overallPercentile([96, 34, 81, 71])).toBe(71);
  });

  it('retorna null sem métricas', () => {
    expect(overallPercentile([])).toBeNull();
  });
});

describe('bandLabel', () => {
  it('descreve cada faixa de seguidores', () => {
    expect(bandLabel('lt1k')).toBe('com menos de 1 mil seguidores');
    expect(bandLabel('1k_5k')).toBe('de 1 mil a 5 mil seguidores');
    expect(bandLabel('5k_20k')).toBe('de 5 mil a 20 mil seguidores');
    expect(bandLabel('20k_100k')).toBe('de 20 mil a 100 mil seguidores');
    expect(bandLabel('100k_plus')).toBe('com mais de 100 mil seguidores');
  });
});

describe('roundedSampleLabel', () => {
  it('arredonda para baixo, estritamente menor que n', () => {
    expect(roundedSampleLabel(344)).toBe('mais de 300');
    expect(roundedSampleLabel(300)).toBe('mais de 200');
    expect(roundedSampleLabel(100)).toBe('mais de 90');
    expect(roundedSampleLabel(47)).toBe('mais de 40');
    expect(roundedSampleLabel(30)).toBe('mais de 20');
  });
});

describe('formatMetric', () => {
  it('formata cada métrica no padrão pt-BR', () => {
    expect(formatMetric('engagement_rate', 0.0193)).toBe('1,93%');
    expect(formatMetric('posts_30d', 8)).toBe('8');
    expect(formatMetric('reel_views', 3816)).toBe('3.816');
    expect(formatMetric('reels_share', 0.667)).toBe('67%');
  });
});
