import { describe, expect, it } from 'vitest';
import type { TarefaWithRelations } from '../../../store';
import {
  applyTarefaFilters,
  buildDropId,
  computeHeaderStats,
  dueBadge,
  EMPTY_TAREFA_FILTERS,
  groupByDueBucket,
  parseDateOnly,
  parseDropId,
  sortTarefas,
  toDateOnlyString,
} from '../tarefasLogic';

let seq = 0;
function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  seq++;
  return {
    id: seq,
    titulo: `Tarefa ${seq}`,
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: null,
    concluida_em: null,
    created_at: `2026-07-01T10:00:${String(seq % 60).padStart(2, '0')}`,
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: null,
    ...overrides,
  };
}

// Wednesday 2026-07-29, 15:00 local. Current Mon-Sun week ends Sunday 2026-08-02.
const NOW = new Date('2026-07-29T15:00:00');

describe('date helpers', () => {
  it('parseDateOnly keeps the calendar day in local time (no UTC shift)', () => {
    const d = parseDateOnly('2026-07-30');
    expect(d.getDate()).toBe(30);
    expect(d.getMonth()).toBe(6);
  });

  it('toDateOnlyString round-trips with parseDateOnly', () => {
    expect(toDateOnlyString(parseDateOnly('2026-01-05'))).toBe('2026-01-05');
  });
});

describe('groupByDueBucket', () => {
  it('buckets by due date relative to now', () => {
    const atrasada = makeTarefa({ data_limite: '2026-07-28' });
    const hoje = makeTarefa({ data_limite: '2026-07-29' });
    const semanaLimite = makeTarefa({ data_limite: '2026-08-02' }); // Sunday of current week
    const depois = makeTarefa({ data_limite: '2026-08-03' }); // next Monday
    const semData = makeTarefa({ data_limite: null });

    const buckets = groupByDueBucket([depois, semData, hoje, atrasada, semanaLimite], NOW);
    expect(buckets.atrasadas).toEqual([atrasada]);
    expect(buckets.hoje).toEqual([hoje]);
    expect(buckets.estaSemana).toEqual([semanaLimite]);
    expect(buckets.depois).toEqual([depois]);
    expect(buckets.semData).toEqual([semData]);
  });

  it('excludes concluded tasks entirely', () => {
    const done = makeTarefa({ data_limite: '2026-07-28', status: 'concluida' });
    const buckets = groupByDueBucket([done], NOW);
    expect(buckets.atrasadas).toEqual([]);
    expect(buckets.semData).toEqual([]);
  });

  it('sorts each bucket by due date then creation', () => {
    const later = makeTarefa({ data_limite: '2026-08-10', created_at: '2026-07-01T10:00:01' });
    const sooner = makeTarefa({ data_limite: '2026-08-04', created_at: '2026-07-02T10:00:00' });
    const buckets = groupByDueBucket([later, sooner], NOW);
    expect(buckets.depois.map((t) => t.id)).toEqual([sooner.id, later.id]);
  });
});

describe('computeHeaderStats', () => {
  it('counts abertas, vencemHoje, atrasadas and concluidasHoje', () => {
    const tarefas = [
      makeTarefa({ data_limite: '2026-07-28' }), // atrasada
      makeTarefa({ data_limite: '2026-07-29' }), // vence hoje
      makeTarefa({ data_limite: null }), // aberta sem prazo
      makeTarefa({ status: 'concluida', concluida_em: '2026-07-29T10:00:00' }),
      makeTarefa({ status: 'concluida', concluida_em: '2026-07-28T23:59:00' }), // ontem
    ];
    const stats = computeHeaderStats(tarefas, NOW);
    expect(stats).toEqual({ abertas: 3, vencemHoje: 1, atrasadas: 1, concluidasHoje: 1 });
  });

  it('compares concluida_em by local calendar day, not a 24h window', () => {
    // 00:30 local today counts as "hoje" even though more than 0h from a
    // late-evening now; 23:30 yesterday does not.
    const now = new Date('2026-07-29T23:00:00');
    const early = makeTarefa({ status: 'concluida', concluida_em: '2026-07-29T00:30:00' });
    const lateYesterday = makeTarefa({ status: 'concluida', concluida_em: '2026-07-28T23:30:00' });
    expect(computeHeaderStats([early, lateYesterday], now).concluidasHoje).toBe(1);
  });
});

describe('sortTarefas', () => {
  it('orders by due date asc with nulls last, then created_at', () => {
    const noDate = makeTarefa({ data_limite: null, created_at: '2026-07-01T09:00:00' });
    const early = makeTarefa({ data_limite: '2026-07-10' });
    const late = makeTarefa({ data_limite: '2026-07-20' });
    const sorted = [noDate, late, early].sort(sortTarefas);
    expect(sorted.map((t) => t.id)).toEqual([early.id, late.id, noDate.id]);
  });
});

describe('applyTarefaFilters', () => {
  const ana = makeTarefa({
    titulo: 'Gravar reels',
    responsavel_id: 1,
    cliente_id: 10,
    cliente_nome: 'Dra. Marina',
    tags: [{ id: 100, nome: 'Urgente', cor: '#ef4444' }],
  });
  const bia = makeTarefa({ titulo: 'Organizar drive', responsavel_id: 2, status: 'em_andamento' });

  it('matches search against titulo and cliente_nome, case-insensitive', () => {
    expect(
      applyTarefaFilters([ana, bia], { ...EMPTY_TAREFA_FILTERS, filterSearch: 'marina' }),
    ).toEqual([ana]);
    expect(
      applyTarefaFilters([ana, bia], { ...EMPTY_TAREFA_FILTERS, filterSearch: 'DRIVE' }),
    ).toEqual([bia]);
  });

  it('filters by membro, tag and status', () => {
    expect(applyTarefaFilters([ana, bia], { ...EMPTY_TAREFA_FILTERS, filterMembros: [2] })).toEqual(
      [bia],
    );
    expect(applyTarefaFilters([ana, bia], { ...EMPTY_TAREFA_FILTERS, filterTags: [100] })).toEqual([
      ana,
    ]);
    expect(
      applyTarefaFilters([ana, bia], { ...EMPTY_TAREFA_FILTERS, filterStatus: ['em_andamento'] }),
    ).toEqual([bia]);
  });

  it('combines filters with AND', () => {
    expect(
      applyTarefaFilters([ana, bia], {
        ...EMPTY_TAREFA_FILTERS,
        filterMembros: [1],
        filterStatus: ['em_andamento'],
      }),
    ).toEqual([]);
  });
});

describe('drop ids', () => {
  it('round-trips every target kind', () => {
    const targets = [
      { kind: 'status', status: 'em_andamento' },
      { kind: 'membro', membroId: 12 },
      { kind: 'membro', membroId: null },
      { kind: 'day', date: '2026-07-30' },
      { kind: 'day', date: null },
    ] as const;
    for (const t of targets) {
      expect(parseDropId(buildDropId(t))).toEqual(t);
    }
  });

  it('rejects malformed ids', () => {
    expect(parseDropId('status:whatever')).toBeNull();
    expect(parseDropId('membro:abc')).toBeNull();
    expect(parseDropId('day:30/07/2026')).toBeNull();
    expect(parseDropId('nonsense')).toBeNull();
  });
});

describe('dueBadge', () => {
  it('maps overdue, today, tomorrow, soon and far dates to deadline classes', () => {
    expect(dueBadge(makeTarefa({ data_limite: '2026-07-27' }), NOW)).toEqual({
      label: '2 dias de atraso',
      className: 'deadline-overdue',
    });
    expect(dueBadge(makeTarefa({ data_limite: '2026-07-29' }), NOW)).toEqual({
      label: 'Hoje',
      className: 'deadline-warning',
    });
    expect(dueBadge(makeTarefa({ data_limite: '2026-07-30' }), NOW)).toEqual({
      label: 'Amanhã',
      className: 'deadline-caution',
    });
    expect(dueBadge(makeTarefa({ data_limite: '2026-08-01' }), NOW)).toEqual({
      label: '3 dias',
      className: 'deadline-caution',
    });
    expect(dueBadge(makeTarefa({ data_limite: '2026-08-20' }), NOW)?.className).toBe('deadline-ok');
  });

  it('returns null for undated or concluded tasks', () => {
    expect(dueBadge(makeTarefa({ data_limite: null }), NOW)).toBeNull();
    expect(
      dueBadge(makeTarefa({ data_limite: '2026-07-01', status: 'concluida' }), NOW),
    ).toBeNull();
  });
});
