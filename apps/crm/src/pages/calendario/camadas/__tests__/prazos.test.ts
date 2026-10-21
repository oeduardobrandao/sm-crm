import { describe, expect, it } from 'vitest';
import type { Cliente, Workflow, WorkflowEtapa } from '../../../../store';
import { calcularDataLimite, calcularPrazos, diasAte } from '../prazos';

const wf = (over: Partial<Workflow>): Workflow => ({
  id: 1,
  cliente_id: 10,
  titulo: 'Fluxo de outubro',
  status: 'ativo',
  etapa_atual: 0,
  recorrente: false,
  ...over,
});

const etapa = (over: Partial<WorkflowEtapa>): WorkflowEtapa => ({
  id: 100,
  workflow_id: 1,
  ordem: 0,
  nome: 'Design',
  prazo_dias: 3,
  tipo_prazo: 'corridos',
  status: 'ativo',
  iniciado_em: new Date(2026, 9, 7, 10).toISOString(), // Wednesday
  ...over,
});

const CLIENTES = [{ id: 10, nome: 'Clínica Sorriso', cor: '#123456' } as Cliente];

describe('calcularDataLimite', () => {
  it('adds calendar days for corridos', () => {
    expect(calcularDataLimite(etapa({ prazo_dias: 3 }))).toEqual(new Date(2026, 9, 10, 10));
  });

  it('skips Saturdays and Sundays for uteis', () => {
    // Wed + 3 working days = Mon (Thu, Fri, Mon).
    expect(calcularDataLimite(etapa({ prazo_dias: 3, tipo_prazo: 'uteis' }))).toEqual(
      new Date(2026, 9, 12, 10),
    );
    // Starting on a Friday, 1 working day lands on Monday.
    expect(
      calcularDataLimite(
        etapa({
          prazo_dias: 1,
          tipo_prazo: 'uteis',
          iniciado_em: new Date(2026, 9, 9, 10).toISOString(),
        }),
      ),
    ).toEqual(new Date(2026, 9, 12, 10));
  });
});

describe('diasAte', () => {
  it('rounds partial days up and goes negative once overdue', () => {
    const limite = new Date(2026, 9, 10, 10);
    expect(diasAte(limite, new Date(2026, 9, 8, 12))).toBe(2);
    expect(diasAte(limite, new Date(2026, 9, 10, 9))).toBe(1);
    expect(diasAte(limite, new Date(2026, 9, 11, 11))).toBe(-1);
  });
});

describe('calcularPrazos', () => {
  const agora = new Date(2026, 9, 8, 10);

  it('one deadline per active workflow with a started active stage', () => {
    const etapas = new Map<number, WorkflowEtapa[]>([
      [1, [etapa({ id: 1, status: 'concluido' }), etapa({ id: 2, nome: 'Copy' })]],
    ]);
    expect(calcularPrazos([wf({})], etapas, CLIENTES, agora)).toEqual([
      {
        workflowId: 1,
        workflowTitle: 'Fluxo de outubro',
        etapaNome: 'Copy',
        clienteId: 10,
        clienteNome: 'Clínica Sorriso',
        clienteCor: '#123456',
        deadlineDate: new Date(2026, 9, 10, 10),
        diasRestantes: 2,
        estourado: false,
      },
    ]);
  });

  it('flags overdue deadlines', () => {
    const etapas = new Map([[1, [etapa({ prazo_dias: 0, tipo_prazo: 'corridos' })]]]);
    const [p] = calcularPrazos([wf({})], etapas, CLIENTES, new Date(2026, 9, 9, 10));
    expect(p).toMatchObject({ diasRestantes: -2, estourado: true });
  });

  it('skips inactive workflows, stages not started and workflows without an active stage', () => {
    const etapas = new Map<number, WorkflowEtapa[]>([
      [1, [etapa({})]],
      [2, [etapa({ workflow_id: 2, iniciado_em: null })]],
      [3, [etapa({ workflow_id: 3, status: 'pendente' })]],
    ]);
    const prazos = calcularPrazos(
      [wf({ id: 1, status: 'concluido' }), wf({ id: 2 }), wf({ id: 3 })],
      etapas,
      CLIENTES,
      agora,
    );
    expect(prazos).toEqual([]);
  });

  it('keeps the old fallbacks for a missing client', () => {
    const etapas = new Map([[1, [etapa({})]]]);
    const [p] = calcularPrazos([wf({ cliente_id: 99 })], etapas, CLIENTES, agora);
    expect(p).toMatchObject({ clienteId: null, clienteNome: '—', clienteCor: '#888' });
  });
});
