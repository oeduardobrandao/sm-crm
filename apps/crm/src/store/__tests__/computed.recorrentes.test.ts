import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projetarAgendamentos } from '../computed';
import type { Transacao, TransacaoRecorrente } from '../finance';

const canva: TransacaoRecorrente = {
  id: 7,
  tipo: 'saida',
  descricao: 'Canva',
  categoria: 'Ferramenta',
  valor: 99.9,
  dia: 10,
  inicio: '2026-09-01',
  fim: null,
};

describe('projetarAgendamentos with recorrentes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15)); // 15 Nov 2026
  });
  afterEach(() => vi.useRealTimers());

  it('projects the current month occurrence as agendado', () => {
    const out = projetarAgendamentos([], [], [], true, [canva]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      tipo: 'saida',
      descricao: 'Canva',
      categoria: 'Ferramenta',
      valor: 99.9,
      data: '2026-11-10',
      status: 'agendado',
      detalhe: 'Recorrente',
      referencia_agendamento: 'recorrente_7_2026_11',
    });
  });

  it('skips the month once it was confirmed', () => {
    const pago = {
      id: 1,
      tipo: 'saida',
      valor: 99.9,
      data: '2026-11-10',
      status: 'pago',
      referencia_agendamento: 'recorrente_7_2026_11',
    } as Transacao;
    const out = projetarAgendamentos([pago], [], [], true, [canva]);
    expect(out).toEqual([pago]);
  });

  it('uses the last day of a shorter month', () => {
    vi.setSystemTime(new Date(2026, 1, 3)); // February 2026
    const out = projetarAgendamentos([], [], [], true, [
      { ...canva, dia: 31, inicio: '2026-01-01' },
    ]);
    expect(out[0].data).toBe('2026-02-28');
  });

  it('does not project before inicio or after fim', () => {
    expect(
      projetarAgendamentos([], [], [], true, [{ ...canva, inicio: '2026-12-01' }]),
    ).toHaveLength(0);
    expect(projetarAgendamentos([], [], [], true, [{ ...canva, fim: '2026-10-01' }])).toHaveLength(
      0,
    );
    expect(projetarAgendamentos([], [], [], true, [{ ...canva, fim: '2026-11-01' }])).toHaveLength(
      1,
    );
  });

  it('projects nothing without the financial capability', () => {
    expect(projetarAgendamentos([], [], [], false, [canva])).toHaveLength(0);
  });
});
