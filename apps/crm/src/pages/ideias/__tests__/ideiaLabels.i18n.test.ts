import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { IDEIA_STATUS_LABELS } from '../ideiaLabels';

describe('IDEIA_STATUS_LABELS', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  it('reads Portuguese by default', () => {
    expect(IDEIA_STATUS_LABELS.em_analise).toBe('Em análise');
    expect(IDEIA_STATUS_LABELS.convertida).toBe('Virou tarefa');
  });

  it('resolves at read time after switching to English', async () => {
    await i18n.changeLanguage('en');
    expect(IDEIA_STATUS_LABELS.nova).toBe('New');
    expect(IDEIA_STATUS_LABELS.em_analise).toBe('Under review');
    expect(IDEIA_STATUS_LABELS.convertida).toBe('Became a task');
    expect(Object.values(IDEIA_STATUS_LABELS)).toEqual([
      'New',
      'Under review',
      'Approved',
      'Discarded',
      'Became a task',
      'Done',
    ]);
    expect(IDEIA_STATUS_LABELS.unknown ?? 'unknown').toBe('unknown');
  });
});
