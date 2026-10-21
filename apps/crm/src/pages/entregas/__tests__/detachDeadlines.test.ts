import { describe, expect, it } from 'vitest';
import { buildDetachDeadlines } from '../detachDeadlines';
import type { WorkflowEtapa } from '../../../store';

const base = {
  workflow_id: 1,
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'padrao' as const,
};
const etapas: WorkflowEtapa[] = [
  {
    ...base,
    id: 1,
    ordem: 0,
    nome: 'Copy',
    status: 'concluido',
    iniciado_em: '2026-09-01T12:00:00Z',
    data_limite: null,
  },
  {
    ...base,
    id: 2,
    ordem: 1,
    nome: 'Design',
    status: 'ativo',
    iniciado_em: '2026-09-10T12:00:00Z',
    data_limite: null,
  },
  {
    ...base,
    id: 3,
    ordem: 2,
    nome: 'Aprovação',
    status: 'pendente',
    iniciado_em: null,
    data_limite: '2026-09-20',
  },
  {
    ...base,
    id: 4,
    ordem: 3,
    nome: 'Publicação',
    status: 'pendente',
    iniciado_em: null,
    data_limite: null,
  },
];

describe('buildDetachDeadlines', () => {
  it('etapa ativa relativa: iniciado_em + prazo; futuras com data_limite entram no mapa como fim do dia local', () => {
    const r = buildDetachDeadlines(etapas, etapas[1]);
    expect(r.activeDeadline).toBe(new Date('2026-09-12T12:00:00Z').toISOString());
    expect(r.stepDeadlines).toEqual({ '2': new Date(2026, 8, 20, 23, 59, 59, 999).toISOString() });
  });
  it('etapa ativa com data_limite: fim daquele dia local; sem futuras com data o mapa é null', () => {
    const withLimit = { ...etapas[1], data_limite: '2026-09-11' };
    const r = buildDetachDeadlines(
      [etapas[0], withLimit, { ...etapas[2], data_limite: null }],
      withLimit,
    );
    expect(r.activeDeadline).toBe(new Date(2026, 8, 11, 23, 59, 59, 999).toISOString());
    expect(r.stepDeadlines).toBeNull();
  });
  it('etapa ativa sem iniciado_em nem data_limite: prazo nulo (o diálogo desabilita Manter etapas)', () => {
    const noStart = { ...etapas[1], iniciado_em: null };
    expect(buildDetachDeadlines([noStart], noStart).activeDeadline).toBeNull();
  });
});
