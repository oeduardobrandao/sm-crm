import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../../lib/supabase');

import {
  SUGGESTED_ETAPAS,
  etapasFromPreset,
  etapasFromTemplate,
  suggestName,
  validateEtapas,
  dataEntregaAvailability,
  countApprovals,
  validatePrazos,
} from '../wizardLogic';
import { STANDARD_PRESETS } from '../presets';
import { defaultEtapa } from '../../components/SortableEtapaList';

const membros = [{ id: 7, nome: 'Maria' }] as never[];

describe('wizardLogic', () => {
  it('maps preset etapas to form rows, binding suggestionIds by name', () => {
    const rows = etapasFromPreset(STANDARD_PRESETS.find((p) => p.id === 'posts-mensais')!);
    expect(rows).toHaveLength(5);
    expect(rows[0].nome).toBe('Criação');
    expect(rows[0].suggestionId).toBe('criacao');
    expect(rows[2].tipo).toBe('aprovacao_cliente');
    expect(rows.every((r) => r.responsavelId === null)).toBe(true);
  });

  it('template rows without a matching suggestion carry no suggestionId', () => {
    const rows = etapasFromTemplate({
      nome: 'T',
      etapas: [{ nome: 'Copywriting exótico', prazo_dias: 2, tipo_prazo: 'uteis' }],
    } as never);
    expect(rows[0].suggestionId).toBeUndefined();
  });

  it('suggests "<source> — <Mês de AAAA>" for next month', () => {
    expect(suggestName('Posts mensais', new Date(2026, 6, 20))).toBe(
      'Posts mensais — Agosto de 2026',
    );
  });

  it('flags rows whose responsável is missing or not in membros', () => {
    const ok = defaultEtapa({ nome: 'A', responsavelId: 7 });
    const missing = defaultEtapa({ nome: 'B', responsavelId: null });
    const stale = defaultEtapa({ nome: 'C', responsavelId: 999 });
    const { rowErrors, globalError } = validateEtapas([ok, missing, stale], membros);
    expect(globalError).toBeNull();
    expect(rowErrors.get(missing._id)).toMatch(/responsável/i);
    expect(rowErrors.get(stale._id)).toMatch(/não existe mais/i);
  });

  it('requires at least one named etapa', () => {
    expect(validateEtapas([defaultEtapa()], membros).globalError).toMatch(/pelo menos uma etapa/i);
  });

  it('data_entrega availability matrix', () => {
    const aprov = defaultEtapa({ nome: 'Aprovação', tipo: 'aprovacao_cliente' });
    const semAprov = defaultEtapa({ nome: 'Criação' });
    const cliente = { id: 1, dia_entrega: 5 } as never;
    const clienteSem = { id: 2 } as never;
    expect(dataEntregaAvailability([aprov], cliente).enabled).toBe(true);
    expect(dataEntregaAvailability([semAprov], cliente).reason).toMatch(/aprovação/i);
    expect(dataEntregaAvailability([aprov], clienteSem).reason).toMatch(/dia de entrega/i);
    expect(dataEntregaAvailability([aprov], undefined).enabled).toBe(false);
  });

  it('counts approvals', () => {
    expect(countApprovals([defaultEtapa({ tipo: 'aprovacao_cliente' }), defaultEtapa()])).toBe(1);
  });

  it('validatePrazos requires a data limite on every named etapa in data_fixa mode', () => {
    const comData = defaultEtapa({ nome: 'A', dataLimite: '2026-08-05' });
    const semData = defaultEtapa({ nome: 'B' });
    expect(validatePrazos([comData, semData], 'data_fixa')).toMatch(/data limite/i);
    expect(validatePrazos([comData], 'data_fixa')).toBeNull();
    expect(validatePrazos([semData], 'padrao')).toBeNull();
    expect(validatePrazos([semData], 'data_entrega')).toBeNull();
  });

  it('suggested etapas include one aprovacao_cliente entry', () => {
    expect(SUGGESTED_ETAPAS.filter((s) => s.tipo === 'aprovacao_cliente')).toHaveLength(1);
  });
});
