import { describe, expect, it } from 'vitest';
import type { WorkflowEtapa } from '../../../../store';
import {
  computeDeadlineDate,
  computeWorkflowDeadlineDate,
} from '../useEntregasData';

function makeEtapa(overrides: Partial<WorkflowEtapa>): WorkflowEtapa {
  return {
    id: 1,
    workflow_id: 1,
    ordem: 0,
    nome: 'Etapa',
    tipo: 'interna',
    prazo_dias: 1,
    tipo_prazo: 'corridos',
    status: 'pendente',
    ...overrides,
  } as WorkflowEtapa;
}

describe('computeDeadlineDate', () => {
  it('adds calendar days for tipo_prazo=corridos', () => {
    const start = '2026-04-10T00:00:00Z';
    const result = computeDeadlineDate(start, 3, 'corridos');
    expect(result.toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });

  it('skips weekends when tipo_prazo=uteis', () => {
    // 2026-04-10 is a Friday. Adding 1 business day should land on Monday 2026-04-13.
    const start = '2026-04-10T12:00:00Z';
    const result = computeDeadlineDate(start, 1, 'uteis');
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-13');
  });

  it('returns the start date unchanged when prazo_dias is zero', () => {
    const start = '2026-04-10T00:00:00Z';
    expect(computeDeadlineDate(start, 0, 'corridos').toISOString()).toBe(start.replace('Z', '.000Z'));
    expect(computeDeadlineDate(start, 0, 'uteis').toISOString()).toBe(start.replace('Z', '.000Z'));
  });
});

describe('computeWorkflowDeadlineDate', () => {
  it('returns null when the active etapa has no iniciado_em', () => {
    const active = makeEtapa({ id: 1, ordem: 0 });
    const etapas = [active];
    expect(computeWorkflowDeadlineDate(etapas, active)).toBeNull();
  });

  it('returns null when the active etapa is not in the list', () => {
    const active = makeEtapa({ id: 99, ordem: 0, iniciado_em: '2026-04-10T00:00:00Z' });
    const other = makeEtapa({ id: 1, ordem: 0 });
    expect(computeWorkflowDeadlineDate([other], active)).toBeNull();
  });

  it('chains remaining etapas starting from the active one', () => {
    const etapas = [
      makeEtapa({ id: 1, ordem: 0, prazo_dias: 1, tipo_prazo: 'corridos' }),
      makeEtapa({
        id: 2,
        ordem: 1,
        prazo_dias: 2,
        tipo_prazo: 'corridos',
        iniciado_em: '2026-04-10T00:00:00Z',
        status: 'ativo',
      }),
      makeEtapa({ id: 3, ordem: 2, prazo_dias: 3, tipo_prazo: 'corridos' }),
    ];
    const active = etapas[1];
    const deadline = computeWorkflowDeadlineDate(etapas, active);
    // start (Apr 10) + 2 (active) + 3 (next) = Apr 15
    expect(deadline?.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('sorts etapas by ordem before chaining so order in the input array does not matter', () => {
    const active = makeEtapa({
      id: 2,
      ordem: 1,
      prazo_dias: 2,
      tipo_prazo: 'corridos',
      iniciado_em: '2026-04-10T00:00:00Z',
      status: 'ativo',
    });
    const tail = makeEtapa({ id: 3, ordem: 2, prazo_dias: 1, tipo_prazo: 'corridos' });
    const head = makeEtapa({ id: 1, ordem: 0, prazo_dias: 5, tipo_prazo: 'corridos' });

    const shuffled = [tail, active, head];
    const deadline = computeWorkflowDeadlineDate(shuffled, active);
    expect(deadline?.toISOString().slice(0, 10)).toBe('2026-04-13');
  });
});
