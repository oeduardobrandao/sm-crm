import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import type { ScheduledPost } from '../../../../store';
import { formatDeadlineStatus } from '../../deadlineStatus';
import { NICHE_CALENDARS } from '../../nicheCalendars/registry';
import { situacaoDoPrazo } from '../CamadaPopover';
import { CAMADA_ROTULO, type CamadaItem } from '../tipos';
import { tituloDaCamada } from '../toCamadaEventInput';

const comemorativa = (rotulo: 'mes' | 'semana', nome: string): CamadaItem => ({
  camada: 'comemorativas',
  id: `c:${nome}`,
  dia: '2026-10-01',
  nome,
  tipo: 'month',
  tags: ['month'],
  rotulo,
});

describe('Calendário layer labels in English', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('translates the layer names, read at access time', () => {
    expect(CAMADA_ROTULO.posts).toBe('Scheduled posts');
    expect(CAMADA_ROTULO.comemorativas).toBe('Commemorative dates');
  });

  it('builds layer chip titles', () => {
    expect(
      tituloDaCamada({
        camada: 'posts',
        id: 'p',
        inicio: '2026-10-07T13:00:00.000Z',
        post: { titulo: '', cliente_nome: 'Acme' } as unknown as ScheduledPost,
        estado: 'agendado',
      }),
    ).toBe('Post for Acme');
    expect(tituloDaCamada({ camada: 'pagamentos', id: 'x', dia: '2026-10-05', itens: [] })).toMatch(
      /^0 payments · /,
    );
    expect(tituloDaCamada(comemorativa('mes', 'Outubro Rosa'))).toBe('Month: Outubro Rosa');
    // Brazilian names that already carry the Portuguese word are not prefixed again.
    expect(tituloDaCamada(comemorativa('semana', 'Semana do Consumidor'))).toBe(
      'Semana do Consumidor',
    );
  });

  it('formats deadline statuses', () => {
    expect(formatDeadlineStatus(1, false)).toBe('1d left');
    expect(formatDeadlineStatus(-3, true)).toBe('3d overdue');
    expect(formatDeadlineStatus(0, false)).toBe('Due today');
    expect(situacaoDoPrazo(1, false)).toBe('1 day left');
    expect(situacaoDoPrazo(-2, true)).toBe('Overdue by 2 days');
  });

  it('translates the niche chrome but not its dates', () => {
    const medico = NICHE_CALENDARS.find((n) => n.key === 'medico')!;
    expect(medico.label).toBe('Medical');
    expect(medico.filterLabels.cardio).toBe('Cardiology');
    expect(medico.data[0].month).toBe('Janeiro');
  });
});
