import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import type { AgendaRegra } from '../../../../store/agenda';
import { TIPO_LABEL, descreverRegra, opcoesRepetir, rotuloLembrete } from '../agendaLogic';
import { tituloDoPeriodo } from '../AgendaView';
import { diaComSemana } from '../phone/AgendaListasPhone';

const SEG_5 = new Date(2026, 9, 5, 14, 0, 0);
const SAB_31 = new Date(2026, 9, 31, 10, 0, 0);

function regra(p: Partial<AgendaRegra>): AgendaRegra {
  return {
    freq: 'weekly',
    intervalo: 1,
    dias_semana: null,
    mensal_modo: null,
    mensal_ordinal: null,
    ate: null,
    contagem: null,
    ...p,
  };
}

describe('agenda labels follow the UI language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('keeps Portuguese in pt', () => {
    expect(TIPO_LABEL.reuniao).toBe('Reunião');
    expect(tituloDoPeriodo('timeGridWeek', new Date(2026, 9, 5), new Date(2026, 9, 12))).toBe(
      '5 a 11 de outubro de 2026',
    );
    expect(diaComSemana(SEG_5)).toBe('Segunda, 5 de outubro');
  });

  it('switches the tipo map, presets and rule summaries to English', async () => {
    await i18n.changeLanguage('en');
    expect(TIPO_LABEL.reuniao).toBe('Meeting');
    expect(opcoesRepetir(SEG_5).map((o) => o.label)).toEqual([
      'Does not repeat',
      'Every day',
      'Weekly on Monday',
      'Monthly on day 5',
      'Monthly on the first Monday',
      'Annually on October 5',
      'Every weekday (Monday to Friday)',
      'Custom…',
    ]);
    expect(opcoesRepetir(SAB_31).map((o) => o.label)).toContain('Monthly on the last Saturday');
    expect(
      descreverRegra(
        regra({ freq: 'weekly', intervalo: 2, dias_semana: [3, 1], ate: '2026-11-30' }),
        SEG_5,
      ),
    ).toBe('Every 2 weeks on Monday and Wednesday, until November 30, 2026');
    expect(descreverRegra(regra({ freq: 'daily', contagem: 1 }), SEG_5)).toBe('Every day, 1 time');
    expect(descreverRegra(regra({ freq: 'yearly', intervalo: 2 }), SEG_5)).toBe(
      'Every 2 years on October 5',
    );
  });

  it('switches reminder labels to English', async () => {
    await i18n.changeLanguage('en');
    expect(rotuloLembrete(0, false)).toBe('At start time');
    expect(rotuloLembrete(120, false)).toBe('2 hours before');
    expect(rotuloLembrete(-570, true)).toBe('On the day at 9:30');
    expect(rotuloLembrete(9540, true)).toBe('1 week before at 9:00');
  });

  it('switches period titles to English', async () => {
    await i18n.changeLanguage('en');
    expect(tituloDoPeriodo('timeGridWeek', new Date(2026, 9, 5), new Date(2026, 9, 12))).toBe(
      'October 5 to 11, 2026',
    );
    expect(tituloDoPeriodo('dayGridMonth', new Date(2026, 9, 1), new Date(2026, 10, 1))).toBe(
      'October 2026',
    );
    expect(tituloDoPeriodo('timeGridDay', SEG_5, new Date(2026, 9, 6))).toBe(
      'Monday, October 5, 2026',
    );
    expect(diaComSemana(SEG_5)).toBe('Monday, October 5');
  });
});
