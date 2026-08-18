import { describe, expect, it } from 'vitest';
import {
  agendaRangeISO,
  bucketFor,
  buildTodayAgenda,
  type AgendaInput,
  type AgendaItem,
} from '../todayAgenda';
import { dueBadge } from '../../tarefas/tarefasLogic';
import type { TarefaWithRelations } from '../../../store';

// Monday 2026-08-17 at 23:30 LOCAL. Late in the day on purpose: any UTC-parse
// slip or ms-based day math would push "today" into yesterday here.
const NOW = new Date(2026, 7, 17, 23, 30, 0);

function tarefa(over: Partial<TarefaWithRelations>): TarefaWithRelations {
  return {
    id: 1,
    titulo: 'Tarefa',
    descricao: null,
    status: 'pendente',
    responsavel_id: 10,
    cliente_id: null,
    data_limite: '2026-08-17',
    concluida_em: null,
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: 'Cliente X',
    ...over,
  } as TarefaWithRelations;
}

function base(over: Partial<AgendaInput> = {}): AgendaInput {
  return {
    now: NOW,
    scope: 'workspace',
    membroId: 10,
    canSeeFinancials: true,
    tarefas: [],
    etapas: [],
    scheduledPosts: [],
    awaitingClientePosts: [],
    assignedPendingPosts: [],
    clientes: [],
    membros: [
      { id: 10, nome: 'Matilda Kristin' },
      { id: 11, nome: 'Caio Dias' },
    ] as AgendaInput['membros'],
    datas: [],
    ...over,
  };
}

const kinds = (items: AgendaItem[]) => items.map((i) => i.kind);

describe('bucketFor', () => {
  it('uses local calendar days, not ms distance', () => {
    expect(bucketFor(new Date(2026, 7, 16, 23, 59), NOW)).toBe('atrasado');
    expect(bucketFor(new Date(2026, 7, 17, 0, 0), NOW)).toBe('hoje');
    expect(bucketFor(new Date(2026, 7, 18, 0, 5), NOW)).toBe('proximos');
    expect(bucketFor(new Date(2026, 7, 24, 12, 0), NOW)).toBe('proximos'); // +7d
    expect(bucketFor(new Date(2026, 7, 25, 0, 0), NOW)).toBeNull(); // +8d
    expect(bucketFor(null, NOW)).toBe('hoje');
  });
});

describe('agendaRangeISO', () => {
  it('spans start of today through today+7 (exclusive +8)', () => {
    const { startISO, endISO } = agendaRangeISO(NOW);
    expect(new Date(startISO).getDate()).toBe(17);
    expect(new Date(startISO).getHours()).toBe(0);
    expect(new Date(endISO).getDate()).toBe(25);
  });
});

describe('buildTodayAgenda · tarefas', () => {
  it('buckets by data_limite and agrees with dueBadge at 23:30', () => {
    const yesterday = tarefa({ id: 1, data_limite: '2026-08-16' });
    const today = tarefa({ id: 2, data_limite: '2026-08-17' });
    const soon = tarefa({ id: 3, data_limite: '2026-08-24' });
    const far = tarefa({ id: 4, data_limite: '2026-08-25' });
    const undated = tarefa({ id: 5, data_limite: null });
    const done = tarefa({ id: 6, status: 'concluida' });
    const b = buildTodayAgenda(base({ tarefas: [yesterday, today, soon, far, undated, done] }));

    expect(b.atrasado.map((i) => i.tarefaId)).toEqual([1]);
    expect(b.hoje.map((i) => i.tarefaId)).toEqual([2]);
    expect(b.proximos.map((i) => i.tarefaId)).toEqual([3]);

    expect(b.atrasado[0].badge).toEqual(dueBadge(yesterday, NOW));
    expect(b.atrasado[0].badge?.className).toBe('deadline-overdue');
    expect(b.hoje[0].badge?.className).toBe('deadline-warning');
    expect(b.hoje[0].href).toBe('/tarefas?tarefa=2');
    expect(b.hoje[0].tarefaStatus).toBe('pendente');
  });

  it('resolves the responsável in workspace scope and never in mine', () => {
    const t = tarefa({ id: 1, responsavel_id: 11 });
    const ws = buildTodayAgenda(base({ tarefas: [t] }));
    expect(ws.hoje[0].responsavel).toEqual({ id: 11, nome: 'Caio Dias' });

    const mine = buildTodayAgenda(base({ tarefas: [t], scope: 'mine', membroId: 11 }));
    expect(mine.hoje[0].responsavel).toBeNull();
  });

  it('mine scope keeps only tarefas assigned to membroId', () => {
    const b = buildTodayAgenda(
      base({
        scope: 'mine',
        membroId: 10,
        tarefas: [tarefa({ id: 1, responsavel_id: 10 }), tarefa({ id: 2, responsavel_id: 11 })],
      }),
    );
    expect(b.hoje.map((i) => i.tarefaId)).toEqual([1]);
  });
});

describe('buildTodayAgenda · etapas', () => {
  const etapa = (over: Record<string, unknown>) =>
    ({
      id: 1,
      workflow_id: 7,
      ordem: 1,
      nome: 'Copy',
      prazo_dias: 2,
      tipo_prazo: 'corridos',
      responsavel_id: 10,
      status: 'ativo',
      iniciado_em: null,
      data_limite: '2026-08-17',
      workflow_titulo: 'Pack agosto',
      cliente_nome: 'Dra. Ana',
      ...over,
    }) as AgendaInput['etapas'][number];

  it('buckets by the local deadline date, drops undated and non-active', () => {
    const b = buildTodayAgenda(
      base({
        etapas: [
          etapa({ id: 1, data_limite: '2026-08-15' }),
          etapa({ id: 2, data_limite: '2026-08-17' }),
          etapa({ id: 3, data_limite: '2026-08-19' }),
          etapa({ id: 4, data_limite: null, iniciado_em: null }),
          etapa({ id: 5, status: 'pendente' }),
        ],
      }),
    );
    expect(b.atrasado.map((i) => i.key)).toEqual(['etapa:1']);
    expect(b.hoje.map((i) => i.key)).toEqual(['etapa:2']);
    expect(b.proximos.map((i) => i.key)).toEqual(['etapa:3']);
    expect(b.atrasado[0].badge).toEqual({
      label: '2 dias de atraso',
      className: 'deadline-overdue',
    });
    expect(b.hoje[0].badge?.label).toBe('Hoje');
    expect(b.hoje[0].context).toBe('Pack agosto · Dra. Ana');
    expect(b.hoje[0].href).toBe('/entregas?drawer=7');
  });

  it('mine scope filters by responsavel_id', () => {
    const b = buildTodayAgenda(
      base({
        scope: 'mine',
        membroId: 11,
        etapas: [etapa({ id: 1, responsavel_id: 10 }), etapa({ id: 2, responsavel_id: 11 })],
      }),
    );
    expect(b.hoje.map((i) => i.key)).toEqual(['etapa:2']);
  });
});

describe('buildTodayAgenda · posts', () => {
  const scheduled = (over: Record<string, unknown>) =>
    ({
      id: 1,
      workflow_id: 3,
      cliente_id: 1,
      cliente_nome: 'Dr. Paulo',
      workflow_titulo: 'Reels',
      titulo: 'Bastidores',
      tipo: 'reels',
      status: 'agendado',
      scheduled_at: new Date(2026, 7, 17, 18, 0).toISOString(),
      responsavel_id: 11,
      ...over,
    }) as AgendaInput['scheduledPosts'][number];

  it('post_agendado lands in hoje/proximos, never atrasado, and skips postado', () => {
    const b = buildTodayAgenda(
      base({
        scheduledPosts: [
          scheduled({ id: 1 }),
          scheduled({ id: 2, scheduled_at: new Date(2026, 7, 17, 9, 0).toISOString() }), // past today
          scheduled({ id: 3, scheduled_at: new Date(2026, 7, 20, 9, 0).toISOString() }),
          scheduled({ id: 4, status: 'postado' }),
          scheduled({ id: 5, scheduled_at: new Date(2026, 7, 16, 9, 0).toISOString() }), // yesterday
        ],
      }),
    );
    expect(b.atrasado).toHaveLength(0);
    expect(b.hoje.map((i) => i.key)).toEqual(['post_agendado:2', 'post_agendado:1']);
    expect(b.proximos.map((i) => i.key)).toEqual(['post_agendado:3']);
    expect(b.hoje[1].context).toBe('Publica 18:00 · Agendado · Dr. Paulo');
    expect(b.hoje[1].badge).toEqual({ label: 'Agendado', className: 'deadline-ok' });
    expect(b.hoje[1].href).toBe('/entregas?drawer=3&post=1');
  });

  it('flags a not-yet-approved post whose publish date is today', () => {
    const b = buildTodayAgenda(
      base({
        scheduledPosts: [
          scheduled({ id: 1, status: 'rascunho' }),
          scheduled({ id: 2, status: 'aprovado_cliente' }),
          scheduled({
            id: 3,
            status: 'revisao_interna',
            scheduled_at: new Date(2026, 7, 20, 9, 0).toISOString(),
          }),
        ],
      }),
    );
    expect(b.hoje.find((i) => i.key === 'post_agendado:1')?.badge).toEqual({
      label: 'Não aprovado',
      className: 'deadline-warning',
    });
    expect(b.hoje.find((i) => i.key === 'post_agendado:1')?.context).toContain('Rascunho');
    expect(b.hoje.find((i) => i.key === 'post_agendado:2')?.badge?.label).toBe('Agendado');
    expect(b.proximos[0].badge).toEqual({ label: 'Não aprovado', className: 'deadline-caution' });
  });

  it('lists a post scheduled in the horizon once, even if it is also aguardando cliente', () => {
    const b = buildTodayAgenda(
      base({
        scheduledPosts: [scheduled({ id: 1, status: 'enviado_cliente' })],
        awaitingClientePosts: [
          {
            id: 1,
            workflow_id: 3,
            titulo: 'Bastidores',
            status: 'enviado_cliente',
            cliente_nome: 'Dr. Paulo',
            responsavel_id: 11,
            waiting_since: new Date(2026, 7, 10, 8, 0).toISOString(),
          } as AgendaInput['awaitingClientePosts'][number],
        ],
      }),
    );
    const all = [...b.atrasado, ...b.hoje, ...b.proximos];
    expect(all.filter((i) => i.title === 'Bastidores')).toHaveLength(1);
    expect(all[0].kind).toBe('post_agendado');
  });

  it('mine scope keeps only assigned scheduled posts', () => {
    const b = buildTodayAgenda(
      base({
        scope: 'mine',
        membroId: 11,
        scheduledPosts: [
          scheduled({ id: 1, responsavel_id: 11 }),
          scheduled({ id: 2, responsavel_id: 10 }),
        ],
      }),
    );
    expect(b.hoje.map((i) => i.key)).toEqual(['post_agendado:1']);
  });

  it('aguardando cliente: <3d → hoje, ≥3d → atrasado, null → hoje; workspace only', () => {
    const awaiting = (id: number, since: string | null) =>
      ({
        id,
        workflow_id: 3,
        titulo: `Post ${id}`,
        status: 'enviado_cliente',
        cliente_nome: 'Dr. Paulo',
        responsavel_id: 10,
        waiting_since: since,
      }) as AgendaInput['awaitingClientePosts'][number];
    const input = base({
      awaitingClientePosts: [
        awaiting(1, new Date(2026, 7, 16, 8, 0).toISOString()), // 1d
        awaiting(2, new Date(2026, 7, 14, 8, 0).toISOString()), // 3d
        awaiting(3, null),
      ],
    });
    const b = buildTodayAgenda(input);
    expect(b.atrasado.map((i) => i.key)).toEqual(['post_aguardando_cliente:2']);
    expect(b.atrasado[0].badge).toEqual({
      label: '3d sem resposta',
      className: 'deadline-warning',
    });
    expect(b.atrasado[0].context).toBe('Aguardando cliente há 3d · Dr. Paulo');
    expect(b.hoje.map((i) => i.key).sort()).toEqual([
      'post_aguardando_cliente:1',
      'post_aguardando_cliente:3',
    ]);

    const mine = buildTodayAgenda({ ...input, scope: 'mine' });
    expect(kinds([...mine.atrasado, ...mine.hoje])).not.toContain('post_aguardando_cliente');
  });

  it('post_pendente: mine only, always hoje, urgent statuses get warning', () => {
    const input = base({
      scope: 'mine',
      membroId: 10,
      assignedPendingPosts: [
        {
          id: 1,
          workflow_id: 3,
          titulo: 'A',
          status: 'rascunho',
          workflow_titulo: 'W',
          cliente_nome: 'C',
        },
        {
          id: 2,
          workflow_id: 3,
          titulo: 'B',
          status: 'correcao_cliente',
          workflow_titulo: 'W',
          cliente_nome: 'C',
        },
      ],
    });
    const b = buildTodayAgenda(input);
    expect(b.hoje.map((i) => i.key)).toEqual(['post_pendente:1', 'post_pendente:2']);
    expect(b.hoje[0].badge?.className).toBe('deadline-caution');
    expect(b.hoje[1].badge?.className).toBe('deadline-warning');

    const ws = buildTodayAgenda({ ...input, scope: 'workspace' });
    expect(kinds(ws.hoje)).not.toContain('post_pendente');
  });
});

describe('buildTodayAgenda · finance, birthdays, datas', () => {
  const clientes = [
    { id: 1, nome: 'Cliente Hoje', status: 'ativo', data_pagamento: 17, data_aniversario: '08-17' },
    {
      id: 2,
      nome: 'Cliente Futuro',
      status: 'ativo',
      data_pagamento: 25,
      data_aniversario: '01-01',
    },
    { id: 3, nome: 'Inativo', status: 'inativo', data_pagamento: 17 },
  ] as AgendaInput['clientes'];
  const membros = [
    { id: 10, nome: 'Ana', data_pagamento: 17 },
    { id: 11, nome: 'Bia', data_pagamento: 3 },
  ] as AgendaInput['membros'];
  const datas = [
    { id: 1, titulo: 'Lançamento', data: '2026-08-17', cliente_id: 1 },
    { id: 2, titulo: 'Outro', data: '2026-08-18', cliente_id: 1 },
  ] as AgendaInput['datas'];

  it('emits them in workspace scope with financial access', () => {
    const b = buildTodayAgenda(base({ clientes, membros, datas }));
    expect(kinds(b.hoje).sort()).toEqual(['birthday', 'data', 'expense', 'income']);
    expect(b.hoje.find((i) => i.kind === 'income')?.href).toBe('/clientes/1');
    expect(b.hoje.find((i) => i.kind === 'expense')?.title).toBe('Ana');
    expect(b.hoje.find((i) => i.kind === 'data')?.context).toBe('Cliente Hoje');
    expect(b.proximos).toHaveLength(0);
  });

  it('hides finance rows without financial access, keeps birthday/data', () => {
    for (const access of [false, 'unknown'] as const) {
      const b = buildTodayAgenda(base({ clientes, membros, datas, canSeeFinancials: access }));
      expect(kinds(b.hoje).sort()).toEqual(['birthday', 'data']);
    }
  });

  it('emits none of them in mine scope', () => {
    const b = buildTodayAgenda(base({ clientes, membros, datas, scope: 'mine' }));
    expect(b.hoje).toHaveLength(0);
  });
});

describe('buildTodayAgenda · ordering', () => {
  it('sorts dated items first by time, undated last by title', () => {
    const b = buildTodayAgenda(
      base({
        scope: 'mine',
        membroId: 10,
        tarefas: [tarefa({ id: 1, titulo: 'Zeta' })],
        assignedPendingPosts: [
          {
            id: 1,
            workflow_id: 1,
            titulo: 'Beta',
            status: 'rascunho',
            workflow_titulo: '',
            cliente_nome: '',
          },
          {
            id: 2,
            workflow_id: 1,
            titulo: 'Alpha',
            status: 'rascunho',
            workflow_titulo: '',
            cliente_nome: '',
          },
        ],
      }),
    );
    expect(b.hoje.map((i) => i.title)).toEqual(['Zeta', 'Alpha', 'Beta']);
  });
});
