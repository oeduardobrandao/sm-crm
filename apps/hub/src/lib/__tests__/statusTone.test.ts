import { describe, expect, it } from 'vitest';
import { STATUS_COLORS, statusTone } from '../postView';

describe('statusTone', () => {
  it('maps every STATUS_COLORS status', () => {
    expect(Object.fromEntries(Object.keys(STATUS_COLORS).map((s) => [s, statusTone(s)]))).toEqual({
      enviado_cliente: 'wait',
      aprovado_cliente: 'ok',
      correcao_cliente: 'fix',
      agendado: 'sched',
      publicando: 'sched',
      postado: 'done',
      falha_publicacao: 'fix',
      em_producao: 'prod',
    });
  });
  it('falls back to done', () => {
    expect(statusTone('qualquer')).toBe('done');
  });
});
