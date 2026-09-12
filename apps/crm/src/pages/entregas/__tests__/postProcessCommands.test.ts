import { describe, expect, it } from 'vitest';
import {
  activeStepOf,
  canConcluir,
  forwardLabelFor,
  nextDeadlineFor,
  nextPendingStepOf,
  previousStepOf,
  sendToPortalDisabledReasonFor,
  SEND_TO_PORTAL_REASON,
} from '../postProcessCommands';
import type { PostProcess, PostProcessStep } from '../../../store';

const step = (
  ordem: number,
  estado: PostProcessStep['estado'],
  extra: Partial<PostProcessStep> = {},
): PostProcessStep => ({
  id: ordem + 1,
  conta_id: 'c',
  process_id: 5,
  ordem,
  nome: `E${ordem}`,
  tipo: 'padrao',
  responsavel_id: null,
  prazo_dias: null,
  tipo_prazo: null,
  prazo_efetivo: null,
  estado,
  iniciado_em: null,
  concluido_em: null,
  interrompido_em: null,
  origem_etapa_ordem: null,
  origem_etapa_nome: null,
  ...extra,
});
const proc = (steps: PostProcessStep[], etapa_atual: number): PostProcess => ({
  id: 5,
  conta_id: 'c',
  post_id: 77,
  template_id: null,
  template_nome: null,
  assinatura: '',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'ativo',
  motivo_encerramento: null,
  etapa_atual,
  modo_prazo: 'padrao',
  board_position: 0,
  revisao: 3,
  created_by: null,
  created_at: '',
  updated_at: '',
  concluido_em: null,
  steps,
});

describe('postProcessCommands helpers', () => {
  const p = proc(
    [
      step(0, 'herdado'),
      step(1, 'ativo'),
      step(2, 'ignorado'),
      step(3, 'pendente', { prazo_dias: 2, tipo_prazo: 'corridos' }),
    ],
    1,
  );
  it('activeStepOf, nextPendingStepOf (pula ignorado), previousStepOf (qualquer estado)', () => {
    expect(activeStepOf(p)?.ordem).toBe(1);
    expect(nextPendingStepOf(p)?.ordem).toBe(3);
    expect(previousStepOf(p)?.ordem).toBe(0);
  });
  it('canConcluir só sem pendente adiante; forwardLabelFor acompanha', () => {
    expect(canConcluir(p)).toBe(false);
    expect(forwardLabelFor(p)).toBe('Avançar etapa');
    const last = proc([step(0, 'concluido'), step(1, 'ativo'), step(2, 'herdado')], 1);
    expect(canConcluir(last)).toBe(true);
    expect(forwardLabelFor(last)).toBe('Concluir processo');
  });
  it('nextDeadlineFor: só prazo relativo sem prazo_efetivo', () => {
    const now = new Date(2026, 8, 14, 10, 0);
    expect(
      new Date(
        nextDeadlineFor(step(3, 'pendente', { prazo_dias: 2, tipo_prazo: 'corridos' }), now)!,
      ).getDate(),
    ).toBe(16);
    expect(
      nextDeadlineFor(
        step(3, 'pendente', {
          prazo_dias: 2,
          tipo_prazo: 'corridos',
          prazo_efetivo: '2026-09-30T00:00:00Z',
        }),
        now,
      ),
    ).toBeNull();
    expect(nextDeadlineFor(step(3, 'pendente'), now)).toBeNull();
    expect(nextDeadlineFor(null, now)).toBeNull();
  });
  it('sendToPortalDisabledReasonFor', () => {
    expect(sendToPortalDisabledReasonFor('aprovado_interno')).toBeUndefined();
    expect(sendToPortalDisabledReasonFor('rascunho')).toBe(SEND_TO_PORTAL_REASON);
  });
});
