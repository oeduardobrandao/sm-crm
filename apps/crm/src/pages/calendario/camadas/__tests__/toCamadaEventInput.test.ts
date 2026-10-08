import { describe, expect, it } from 'vitest';
import type { ScheduledPost } from '../../../../store';
import type { DeadlineEvent } from '../prazos';
import { CAMADA_COR, COR_PRAZO_ESTOURADO, type CamadaItem } from '../tipos';
import { tituloDaCamada, toCamadaEventInput } from '../toCamadaEventInput';

const post = (over: Partial<ScheduledPost> = {}): ScheduledPost =>
  ({
    id: 55,
    workflow_id: 3,
    cliente_id: 10,
    cliente_nome: 'Clínica Sorriso',
    workflow_titulo: 'Outubro',
    titulo: 'Carrossel de dicas',
    tipo: 'carrossel',
    status: 'agendado',
    scheduled_at: '2026-10-07T13:00:00.000Z',
    platform: 'instagram',
    ...over,
  }) as ScheduledPost;

const prazo = (over: Partial<DeadlineEvent> = {}): DeadlineEvent => ({
  workflowId: 3,
  workflowTitle: 'Outubro',
  etapaNome: 'Design',
  clienteId: 10,
  clienteNome: 'Clínica Sorriso',
  clienteCor: '#123',
  deadlineDate: new Date(2026, 9, 9, 10),
  diasRestantes: 2,
  estourado: false,
  ...over,
});

const ITENS: CamadaItem[] = [
  { camada: 'prazos', id: 'prazos:3', dia: '2026-10-09', prazo: prazo() },
  {
    camada: 'recebimentos',
    id: 'recebimentos:2026-10-10',
    dia: '2026-10-10',
    itens: [
      {
        nome: 'A',
        valor: 1500,
        pago: false,
        referencia: 'cliente_1_2026_10',
        alvo: { tipo: 'cliente', id: 1 },
        ajustado: false,
        diaConfigurado: 10,
      },
    ],
  },
  {
    camada: 'pagamentos',
    id: 'pagamentos:2026-10-05',
    dia: '2026-10-05',
    itens: [],
  },
  {
    camada: 'datas',
    id: 'datas:aniversario:1:2026-10-12',
    dia: '2026-10-12',
    tipo: 'aniversario',
    titulo: 'Aniversário',
    cliente: { id: 1, nome: 'Ana' },
  },
  {
    camada: 'comemorativas',
    id: 'comemorativas:medico:x',
    dia: '2026-10-01',
    nome: 'Outubro Rosa',
    tipo: 'month',
    tags: [],
    rotulo: 'mes',
  },
];

describe('toCamadaEventInput', () => {
  it('posts are timed with a 30 min visual end', () => {
    const ev = toCamadaEventInput({
      camada: 'posts',
      id: 'posts:55',
      inicio: '2026-10-07T13:00:00.000Z',
      post: post(),
      estado: 'agendado',
    });
    expect(ev.allDay).toBe(false);
    expect((ev.start as Date).toISOString()).toBe('2026-10-07T13:00:00.000Z');
    expect((ev.end as Date).toISOString()).toBe('2026-10-07T13:30:00.000Z');
    expect(ev.id).toBe('camada:posts:55');
    expect(ev.title).toBe('Carrossel de dicas');
    expect(ev.editable).toBe(false);
    expect(ev.classNames).toEqual(['agenda-camada', 'agenda-camada--posts']);
    expect(ev.borderColor).toBe(CAMADA_COR.posts);
    expect(ev.extendedProps).toMatchObject({ ordem: 1, camada: { camada: 'posts' } });
  });

  it.each(ITENS.map((i) => [i.camada, i] as const))(
    '%s items are all-day, read-only and carry the item',
    (camada, item) => {
      const ev = toCamadaEventInput(item);
      expect(ev.allDay).toBe(true);
      expect(ev.start).toBe('dia' in item ? item.dia : '');
      expect(ev.end).toBeUndefined();
      expect(ev.editable).toBe(false);
      expect(ev.id).toBe(`camada:${item.id}`);
      expect(ev.classNames).toEqual(['agenda-camada', `agenda-camada--${camada}`]);
      expect(ev.classNames).not.toContain('agenda-ev');
      expect(ev.extendedProps?.camada).toBe(item);
    },
  );

  it('orders layers after Agenda events: posts, deadlines, money, dates, commemorative', () => {
    const ordem = (i: CamadaItem) => toCamadaEventInput(i).extendedProps?.ordem;
    expect(ITENS.map(ordem)).toEqual([2, 3, 3, 4, 5]);
  });

  it('an overdue deadline gets the overdue class and the red ink', () => {
    const ev = toCamadaEventInput({
      camada: 'prazos',
      id: 'prazos:3',
      dia: '2026-10-05',
      prazo: prazo({ estourado: true, diasRestantes: -2 }),
    });
    expect(ev.classNames).toEqual([
      'agenda-camada',
      'agenda-camada--prazos',
      'agenda-camada--atrasado',
    ]);
    expect(ev.borderColor).toBe(COR_PRAZO_ESTOURADO);
  });
});

describe('tituloDaCamada', () => {
  it('names each kind of item', () => {
    expect(ITENS.map(tituloDaCamada)).toEqual([
      'Design · Clínica Sorriso',
      expect.stringMatching(/^1 recebimento · R\$\s1\.500,00$/),
      expect.stringMatching(/^0 pagamentos · R\$\s0,00$/),
      'Aniversário · Ana',
      'Mês: Outubro Rosa',
    ]);
  });

  it('falls back to "Post de <cliente>" without a title', () => {
    expect(
      tituloDaCamada({
        camada: 'posts',
        id: 'posts:1',
        inicio: '',
        post: post({ titulo: '' }),
        estado: 'agendado',
      }),
    ).toBe('Post de Clínica Sorriso');
  });

  it('does not double a "Semana" prefix', () => {
    const semana = (nome: string): CamadaItem => ({
      camada: 'comemorativas',
      id: 'c',
      dia: '2026-10-01',
      nome,
      tipo: 'week',
      tags: [],
      rotulo: 'semana',
    });
    expect(tituloDaCamada(semana('Semana do Consumidor'))).toBe('Semana do Consumidor');
    expect(tituloDaCamada(semana('Black Week'))).toBe('Semana: Black Week');
  });
});
