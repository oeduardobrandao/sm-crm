import { describe, expect, it } from 'vitest';
import { NICHE_CALENDARS } from '../../nicheCalendars/registry';
import type { NicheCalendarDef } from '../../nicheCalendars/types';
import { expandirComemorativas, pascoa, resolverDataComemorativa } from '../comemorativas';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ev = (date: string, name = 'X') => ({ date, name });

describe('pascoa', () => {
  it.each([
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
  ])('Easter %i is %s', (ano, esperado) => {
    expect(ymd(pascoa(ano))).toBe(esperado);
  });
});

describe('resolverDataComemorativa', () => {
  it('DD/MM is that day', () => {
    expect(resolverDataComemorativa(ev('12/05'), 5, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-05-12',
    });
  });

  it('a range starts on its first day and keeps the closing day', () => {
    expect(resolverDataComemorativa(ev('01–07/08'), 8, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-08-01',
      ate: '07/08',
    });
  });

  it('movable feasts follow Easter', () => {
    expect(resolverDataComemorativa(ev('Carnaval'), 2, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-02-17',
    });
    expect(resolverDataComemorativa(ev('Páscoa'), 4, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-04-05',
    });
    expect(
      resolverDataComemorativa(ev('+60d da Páscoa (móvel)', 'Corpus Christi'), 6, 2026),
    ).toEqual({ tipo: 'dia', data: '2026-06-04' });
    expect(
      resolverDataComemorativa(ev('Fev/Mar (móvel)', 'Carnaval — fantasias'), 3, 2026),
    ).toEqual({ tipo: 'dia', data: '2026-02-17' });
    expect(resolverDataComemorativa(ev('Mar/Abr (móvel)', 'Páscoa — data móvel'), 3, 2026)).toEqual(
      { tipo: 'dia', data: '2026-04-05' },
    );
  });

  it('an unnamed movable entry is a month item', () => {
    expect(resolverDataComemorativa(ev('Fev/Mar (móvel)', 'Liquidação'), 2, 2026)).toEqual({
      tipo: 'mes',
    });
  });

  it('ordinals count inside the card month, or the month the text names', () => {
    expect(resolverDataComemorativa(ev('2º dom.'), 5, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-05-10',
    });
    expect(resolverDataComemorativa(ev('1ª sex.'), 6, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-06-05',
    });
    // Card month is ignored when the text names one.
    expect(resolverDataComemorativa(ev('2ª ter. fev.'), 1, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-02-10',
    });
    // A week ordinal anchors on the Monday.
    expect(resolverDataComemorativa(ev('1ª sem. nov.'), 11, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-11-02',
    });
  });

  it('"last" and "second to last" weekdays', () => {
    expect(resolverDataComemorativa(ev('Últ. sex.'), 11, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-11-27',
    });
    expect(resolverDataComemorativa(ev('Último dom.'), 1, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-01-25',
    });
    // "5ª" alone is quinta-feira.
    expect(resolverDataComemorativa(ev('Últ. 5ª'), 8, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-08-27',
    });
    expect(resolverDataComemorativa(ev('Penúlt. sáb.'), 11, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-11-21',
    });
    expect(resolverDataComemorativa(ev('Últ. sem. mai.'), 5, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-05-25',
    });
  });

  it('Cyber Monday is the Monday after Black Friday', () => {
    expect(resolverDataComemorativa(ev('Seg. pós-BF'), 11, 2026)).toEqual({
      tipo: 'dia',
      data: '2026-11-30',
    });
  });

  it.each(['Outubro', 'Junho–Julho', 'Semana anterior'])('"%s" is a month item', (date) => {
    expect(resolverDataComemorativa(ev(date), 6, 2026)).toEqual({ tipo: 'mes' });
  });

  it.each([2026, 2027])(
    'every entry of the 5 niches resolves in %i, and only week/month entries fall to mes',
    (ano) => {
      expect(NICHE_CALENDARS).toHaveLength(5);
      for (const niche of NICHE_CALENDARS) {
        for (const cartao of niche.data) {
          for (const e of cartao.events) {
            const r = resolverDataComemorativa(e, parseInt(cartao.num, 10), ano);
            if (r.tipo === 'mes') {
              expect([niche.key, e.date, e.type]).toEqual([
                niche.key,
                e.date,
                expect.stringMatching(/^(week|month)$/),
              ]);
            } else {
              expect(r.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            }
          }
        }
      }
    },
  );
});

describe('expandirComemorativas', () => {
  const niche: NicheCalendarDef = {
    key: 'teste',
    label: 'Teste',
    title: 'Teste',
    subtitle: '',
    filterLabels: {},
    data: [
      {
        month: 'Fevereiro',
        num: '02',
        events: [
          { date: 'Fev/Mar (móvel)', name: 'Carnaval', type: 'month', tags: ['br'] },
          { date: '14/02', name: 'Dia A', type: 'br', tags: ['br'] },
        ],
      },
      {
        month: 'Março',
        num: '03',
        events: [{ date: 'Fev/Mar (móvel)', name: 'Carnaval', type: 'month', tags: ['br'] }],
      },
      {
        month: 'Junho',
        num: '06',
        events: [
          { date: 'Junho–Julho', name: 'Liquidação de Inverno', type: 'month', tags: [] },
          { date: 'Semana anterior', name: 'Black Week', type: 'week', tags: [] },
          { date: '01–07/06', name: 'Semana Z', type: 'week', tags: [] },
        ],
      },
    ],
  };

  it('keeps only the range and dedupes a feast listed in two cards', () => {
    const itens = expandirComemorativas(niche, new Date(2026, 1, 1), new Date(2026, 2, 1));
    expect(itens.map((i) => ('dia' in i ? `${i.dia} ${'nome' in i ? i.nome : ''}` : ''))).toEqual([
      '2026-02-14 Dia A',
      '2026-02-17 Carnaval',
    ]);
  });

  it('puts month items on the 1st of every month they cover, with their label', () => {
    const itens = expandirComemorativas(niche, new Date(2026, 5, 1), new Date(2026, 7, 1));
    const resumo = itens.map((i) =>
      i.camada === 'comemorativas'
        ? `${i.dia} ${i.nome} ${i.rotulo}${i.ate ? ` ${i.ate}` : ''}`
        : '',
    );
    expect(resumo).toEqual([
      '2026-06-01 Liquidação de Inverno mes',
      '2026-06-01 Black Week semana',
      '2026-06-01 Semana Z semana 07/06',
      '2026-07-01 Liquidação de Inverno mes',
    ]);
  });

  it('crosses a year boundary', () => {
    const itens = expandirComemorativas(niche, new Date(2026, 11, 28), new Date(2027, 1, 20));
    expect(itens.some((i) => 'dia' in i && i.dia === '2027-02-09')).toBe(true); // Carnaval 2027
  });
});
