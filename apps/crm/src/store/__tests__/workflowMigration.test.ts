import { describe, it, expect, vi } from 'vitest';

vi.mock('../core', () => ({
  supabase: { rpc: vi.fn() },
  getUserId: vi.fn(),
  getContaId: vi.fn(),
}));

import {
  matchPropertyDefinitions,
  buildMigrationEtapas,
  mapMigrationError,
} from '../workflowMigration';
import type { TemplatePropertyDefinition } from '../posts';
import type { WorkflowTemplate } from '../workflows';

const def = (over: Partial<TemplatePropertyDefinition>): TemplatePropertyDefinition => ({
  id: 1,
  template_id: 1,
  name: 'Tema',
  type: 'text',
  config: {},
  portal_visible: false,
  display_order: 0,
  ...over,
});

describe('matchPropertyDefinitions', () => {
  it('casa por nome (case-insensitive, trim) e tipo', () => {
    const origem = [def({ id: 1, name: 'Tema', type: 'text' })];
    const destino = [def({ id: 10, name: '  tema ', type: 'text' })];
    const [m] = matchPropertyDefinitions(origem, destino);
    expect(m.destino?.id).toBe(10);
  });

  it('nome igual mas tipo diferente não casa', () => {
    const origem = [def({ id: 1, name: 'Tema', type: 'text' })];
    const destino = [def({ id: 10, name: 'Tema', type: 'select' })];
    const [m] = matchPropertyDefinitions(origem, destino);
    expect(m.destino).toBeNull();
  });

  it('empate resolve por menor display_order, depois menor id', () => {
    const origem = [def({ id: 1 })];
    const destino = [
      def({ id: 11, display_order: 2 }),
      def({ id: 10, display_order: 1 }),
      def({ id: 9, display_order: 1 }),
    ];
    const [m] = matchPropertyDefinitions(origem, destino);
    expect(m.destino?.id).toBe(9);
  });

  it('sem par vira destino null (será descartada)', () => {
    const origem = [def({ id: 1, name: 'Briefing' })];
    const [m] = matchPropertyDefinitions(origem, [def({ id: 10, name: 'Tema' })]);
    expect(m.destino).toBeNull();
  });

  it('select/multiselect/status nunca casam, mesmo com nome e tipo iguais', () => {
    for (const type of ['select', 'multiselect', 'status'] as const) {
      const origem = [def({ id: 1, name: 'Formato', type })];
      const destino = [def({ id: 10, name: 'Formato', type })];
      const [m] = matchPropertyDefinitions(origem, destino);
      expect(m.destino).toBeNull();
    }
  });
});

describe('buildMigrationEtapas', () => {
  const template: WorkflowTemplate = {
    id: 5,
    nome: 'B',
    modo_prazo: 'padrao',
    etapas: [
      { nome: 'Roteiro', prazo_dias: 2, tipo_prazo: 'uteis', responsavel_id: 7, tipo: 'padrao' },
      { nome: 'Aprovação', prazo_dias: 3, tipo_prazo: 'corridos', tipo: 'aprovacao_cliente' },
    ],
  };

  it('padrao: mapeia campos e data_limite null', () => {
    const etapas = buildMigrationEtapas(template, null);
    expect(etapas).toEqual([
      {
        nome: 'Roteiro',
        prazo_dias: 2,
        tipo_prazo: 'uteis',
        responsavel_id: 7,
        tipo: 'padrao',
        data_limite: null,
      },
      {
        nome: 'Aprovação',
        prazo_dias: 3,
        tipo_prazo: 'corridos',
        responsavel_id: null,
        tipo: 'aprovacao_cliente',
        data_limite: null,
      },
    ]);
  });

  it('data_entrega com deliveryDate: âncora recebe a data, anteriores recuam', () => {
    const t = { ...template, modo_prazo: 'data_entrega' as const };
    const etapas = buildMigrationEtapas(t, new Date(2026, 8, 10)); // 10/09/2026, quinta
    expect(etapas[1].data_limite).toBe('2026-09-10');
    // Roteiro: 3 dias corridos antes da âncora (prazo da etapa seguinte) = 07/09
    expect(etapas[0].data_limite).toBe('2026-09-07');
  });

  it('data_entrega sem deliveryDate: sem datas (mesmo comportamento do wizard)', () => {
    const t = { ...template, modo_prazo: 'data_entrega' as const };
    expect(buildMigrationEtapas(t, null).every((e) => e.data_limite === null)).toBe(true);
  });
});

describe('mapMigrationError', () => {
  it('mapeia códigos conhecidos para pt-BR', () => {
    expect(mapMigrationError('workflow_not_active')).toBe('Só é possível migrar fluxos ativos.');
    expect(mapMigrationError('template_not_found')).toBe(
      'Template não encontrado neste workspace.',
    );
    expect(mapMigrationError('workflow_changed')).toBe(
      'Este fluxo foi alterado por outra pessoa. Recarregue a página e tente novamente.',
    );
  });
  it('erro desconhecido vira mensagem genérica', () => {
    expect(mapMigrationError('deadlock detected')).toBe(
      'Não foi possível migrar o template. Tente novamente.',
    );
  });
});
