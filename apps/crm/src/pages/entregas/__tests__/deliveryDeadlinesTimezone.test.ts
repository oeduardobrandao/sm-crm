// Roda em UTC-3 de propósito: Node relê TZ quando process.env.TZ muda (v13+).
// Com toISOString().split('T')[0] uma data local às 23:30 vira o DIA SEGUINTE
// em UTC; é o bug que a spec §7 manda corrigir nas duas cópias.
process.env.TZ = 'America/Sao_Paulo';
import { describe, expect, it } from 'vitest';
import { computeDeliveryDeadlines } from '../hooks/useEntregasData';
import { _computeDeliveryDeadlines } from '../../../store/workflows';

const etapas = [
  {
    id: 1,
    workflow_id: 1,
    ordem: 0,
    nome: 'Copy',
    prazo_dias: 2,
    tipo_prazo: 'corridos' as const,
    tipo: 'padrao' as const,
    status: 'pendente' as const,
  },
  {
    id: 2,
    workflow_id: 1,
    ordem: 1,
    nome: 'Aprovação',
    prazo_dias: 1,
    tipo_prazo: 'corridos' as const,
    tipo: 'aprovacao_cliente' as const,
    status: 'pendente' as const,
  },
  {
    id: 3,
    workflow_id: 1,
    ordem: 2,
    nome: 'Publicação',
    prazo_dias: 1,
    tipo_prazo: 'corridos' as const,
    tipo: 'padrao' as const,
    status: 'pendente' as const,
  },
];

describe('data_entrega no fuso local', () => {
  it('as duas implementações devolvem o dia LOCAL da entrega às 23:30', () => {
    const delivery = new Date(2026, 8, 15, 23, 30);
    expect(computeDeliveryDeadlines(etapas, delivery).get(1)).toBe('2026-09-15');
    expect(_computeDeliveryDeadlines(etapas, delivery).get(1)).toBe('2026-09-15');
    // Anterior: 15 - 1 dia (prazo da aprovação) = 14; posterior: 15 + 1 = 16.
    expect(computeDeliveryDeadlines(etapas, delivery).get(0)).toBe('2026-09-14');
    expect(computeDeliveryDeadlines(etapas, delivery).get(2)).toBe('2026-09-16');
  });
});
