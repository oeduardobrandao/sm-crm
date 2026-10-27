import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import type { TarefaWithRelations } from '../../../store';
import {
  DUE_BUCKETS,
  dueBadge,
  groupByBoardColumn,
  STATUS_LABELS,
  STATUS_ORDER,
} from '../tarefasLogic';

function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 1,
    titulo: 'Tarefa',
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: null,
    concluida_em: null,
    created_at: '2026-07-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
  };
}

// Wednesday 2026-07-29.
const NOW = new Date('2026-07-29T15:00:00');

describe('tarefasLogic in English', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('STATUS_LABELS resolves on every read', () => {
    expect(STATUS_ORDER.map((s) => STATUS_LABELS[s])).toEqual(['To do', 'In progress', 'Done']);
    expect(Object.keys(STATUS_LABELS)).toEqual(STATUS_ORDER);
  });

  it('DUE_BUCKETS labels', () => {
    expect(DUE_BUCKETS.map((b) => b.label)).toEqual([
      'Overdue',
      'Today',
      'This week',
      'Later',
      'No due date',
    ]);
  });

  it('dueBadge labels', () => {
    expect(dueBadge(makeTarefa({ data_limite: '2026-07-28' }), NOW)?.label).toBe('1 day overdue');
    expect(dueBadge(makeTarefa({ data_limite: '2026-07-25' }), NOW)?.label).toBe('4 days overdue');
    expect(dueBadge(makeTarefa({ data_limite: '2026-07-29' }), NOW)?.label).toBe('Today');
    expect(dueBadge(makeTarefa({ data_limite: '2026-07-30' }), NOW)?.label).toBe('Tomorrow');
    expect(dueBadge(makeTarefa({ data_limite: '2026-08-01' }), NOW)?.label).toBe('3 days');
    expect(dueBadge(makeTarefa({ data_limite: '2026-08-20' }), NOW)?.label).toBe('8/20/2026');
  });

  it('board column labels', () => {
    expect(groupByBoardColumn([], NOW).map((b) => b.label)).toEqual([
      'Overdue',
      'Today',
      'Tomorrow',
      'Friday',
      'Saturday',
      'Sunday',
      'Later',
      'No due date',
    ]);
  });

  it('Portuguese stays as before', async () => {
    await i18n.changeLanguage('pt');
    expect(STATUS_LABELS.concluida).toBe('Concluída');
    expect(dueBadge(makeTarefa({ data_limite: '2026-07-25' }), NOW)?.label).toBe(
      '4 dias de atraso',
    );
    expect(dueBadge(makeTarefa({ data_limite: '2026-08-20' }), NOW)?.label).toBe('20/08/2026');
    expect(groupByBoardColumn([], NOW).map((b) => b.label)).toEqual([
      'Em atraso',
      'Hoje',
      'Amanhã',
      'Sexta',
      'Sábado',
      'Domingo',
      'Mais tarde',
      'Sem data',
    ]);
  });
});
