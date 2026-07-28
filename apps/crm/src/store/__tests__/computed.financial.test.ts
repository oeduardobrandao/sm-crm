import { describe, it, expect } from 'vitest';
import { projetarAgendamentos } from '../computed';
import type { Cliente } from '../clients';
import type { Membro } from '../team';
import type { Transacao } from '../finance';

// After Migration B a restricted admin reads valor_mensal/custo_mensal as NULL
// through the views. Number(null) is 0, so anything that infers from the value
// instead of branching on the capability renders phantom "R$ 0" entries that
// look like real scheduled money.
const maskedCliente = {
  id: 1,
  nome: 'Cliente A',
  status: 'ativo',
  data_pagamento: 10,
  valor_mensal: null,
} as unknown as Cliente;

const maskedMembro = {
  id: 1,
  nome: 'Fulano',
  data_pagamento: 5,
  custo_mensal: null,
} as unknown as Membro;

describe('projetarAgendamentos', () => {
  it('projects real amounts when authorized', () => {
    const out = projetarAgendamentos(
      [],
      [{ ...maskedCliente, valor_mensal: 3000 } as Cliente],
      [],
      true,
    );
    expect(out).toHaveLength(1);
    expect(out[0].valor).toBe(3000);
  });

  it('projects NOTHING when the capability is absent', () => {
    const out = projetarAgendamentos([], [maskedCliente], [maskedMembro], false);
    expect(out).toHaveLength(0);
  });

  it('projects nothing while the capability is unknown', () => {
    const out = projetarAgendamentos([], [maskedCliente], [maskedMembro], 'unknown');
    expect(out).toHaveLength(0);
  });

  it('never emits a zero-valued projection from a masked value', () => {
    const out = projetarAgendamentos([], [maskedCliente], [maskedMembro], false);
    expect(out.some((t) => t.valor === 0)).toBe(false);
  });

  it('preserves physical transactions regardless of capability', () => {
    const fisica = { id: 9, tipo: 'saida', valor: 50, data: '2026-07-10' } as Transacao;
    const out = projetarAgendamentos([fisica], [maskedCliente], [], false);
    expect(out).toEqual([fisica]);
  });
});
